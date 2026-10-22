import type { GenericDatabaseReader } from "convex/server";
import { ConvexError, v, type GenericId } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { enforceRateLimit } from "./utils";

/**
 * The admin credential system — deliberately separate from Nexa accounts.
 *
 * An admin never signs in with a customer account, is not a row in `users`,
 * and shares no session with the product. `/admin/login` is a standalone
 * page that nothing in the app links to.
 *
 * How the secrets are handled:
 *  - the password is stored only as PBKDF2-SHA256(password, random salt);
 *  - the live session token is stored only as SHA-256(token) — the token
 *    exists in exactly two places, the browser and the moment it is issued,
 *    so reading the `admins` table yields nothing that can be replayed;
 *  - both comparisons run in time independent of the inputs;
 *  - logins are rate limited per address and per account.
 *
 * First run: set ADMIN_BOOTSTRAP_TOKEN in the deployment environment, open
 * /admin/setup, and create the account. Provisioning refuses once any admin
 * exists, so the token can never be reused to add a second account.
 */

/**
 * PBKDF2 rounds. High enough that an offline crack of a stolen table is
 * expensive, low enough to stay well inside an action's time budget —
 * WebCrypto's native implementation does ~210k rounds in a fraction of a
 * second. Stored alongside each hash so it can be raised later without
 * invalidating existing admins.
 */
const PBKDF2_ROUNDS = 210_000;
const SALT_BYTES = 16;
const SESSION_HOURS = 12;

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === null ? "=" : B64[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === null ? "=" : B64[b2 & 0x3f];
  }
  return out;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

async function derive(
  password: string,
  salt: BufferSource,
  rounds: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: rounds, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Time-independent byte comparison. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Same, for hex strings of equal length. */
function sameHash(a: string, b: string): boolean {
  let diff = 0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** One message for every failure, so nothing reveals which part was wrong. */
const BAD_CREDENTIALS = "Incorrect email or password.";

const PASSWORD_MIN = 10;

function validateEmail(email: string): string {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
    throw new ConvexError("That doesn't look like an email address.");
  }
  return clean;
}

function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN) {
    throw new ConvexError(
      `Use at least ${PASSWORD_MIN} characters — an admin password is the only thing standing between a stranger and every account here.`,
    );
  }
  if (password.length > 200) {
    throw new ConvexError("That password is too long.");
  }
}

/* ------------------------------------------------------------------ *
 * Internal storage
 * ------------------------------------------------------------------ */

/** Sliding-window counters, called from the actions. */
export const consumeRateLimit = internalMutation({
  args: {
    key: v.string(),
    max: v.number(),
    windowMs: v.number(),
    message: v.string(),
  },
  handler: async (ctx, { key, max, windowMs, message }) => {
    await enforceRateLimit(ctx, key, max, windowMs, message);
  },
});

/** Record a fresh session for an admin, replacing any previous one. */
export const openSession = internalMutation({
  args: {
    adminId: v.id("admins"),
    sessionHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { adminId, sessionHash, expiresAt }) => {
    await ctx.db.patch(adminId, {
      sessionHash,
      sessionExpiresAt: expiresAt,
      lastLoginAt: Date.now(),
      failedLogins: 0,
    });
  },
});

/** Clear an admin's session (logout). */
export const clearSession = internalMutation({
  args: { adminId: v.id("admins") },
  handler: async (ctx, { adminId }) => {
    await ctx.db.patch(adminId, {
      sessionHash: undefined,
      sessionExpiresAt: undefined,
    });
  },
});

/** Insert a new administrator. */
export const createAdmin = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    passwordSetAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("admins", {
      ...args,
      name: args.name ?? undefined,
      failedLogins: 0,
    });
  },
});

/** How many administrators exist — provisioning needs this to be one-shot. */
export const adminCount = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("admins").collect()).length,
});

/** Look up an admin by address (internal: holds the password hash). */
export const byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    await ctx.db
      .query("admins")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique(),
});

/** Id lookup used right after provisioning. */
export const adminIdByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const admin = await ctx.db
      .query("admins")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    return admin === null ? null : admin._id;
  },
});

/* ------------------------------------------------------------------ *
 * Public surface
 * ------------------------------------------------------------------ */

/**
 * Create the very first administrator.
 *
 * Guarded by ADMIN_BOOTSTRAP_TOKEN, and refuses outright once any admin
 * exists — so this is a one-shot, not a back door. Remove the env var after.
 */
export const provision = action({
  args: {
    bootstrapToken: v.string(),
    email: v.string(),
    password: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { bootstrapToken, email, password, name },
  ) => {
    const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;
    if (!expected || expected.trim().length === 0) {
      throw new ConvexError(
        "Provisioning is closed. Set ADMIN_BOOTSTRAP_TOKEN in the deployment environment to open it.",
      );
    }
    const existing = await ctx.runQuery(internal.adminAuth.adminCount, {});
    if (existing > 0) {
      throw new ConvexError(
        "An administrator already exists. Remove ADMIN_BOOTSTRAP_TOKEN.",
      );
    }
    // Rate limited like a login: without this, an open /admin/setup is a free
    // oracle for guessing the bootstrap token.
    await ctx.runMutation(internal.adminAuth.consumeRateLimit, {
      key: "admin-provision",
      max: 10,
      windowMs: 10 * 60_000,
      message: "Too many setup attempts. Wait a few minutes and try again.",
    });
    // Both sides are hashed first, so the comparison is constant-time and
    // reveals nothing about the token's length or content.
    const offeredHash = await sha256Hex(bootstrapToken.trim());
    const expectedHash = await sha256Hex(expected.trim());
    if (!sameHash(offeredHash, expectedHash)) {
      throw new ConvexError("That setup token isn't right.");
    }

    const clean = validateEmail(email);
    validatePassword(password);

    const salt = randomBytes(SALT_BYTES);
    const hash = await derive(password, salt, PBKDF2_ROUNDS);

    await ctx.runMutation(internal.adminAuth.createAdmin, {
      email: clean,
      name: name?.trim() || undefined,
      passwordHash: base64Encode(hash),
      passwordSalt: base64Encode(salt),
      passwordSetAt: Date.now(),
    });

    // Give the new account a live session so setup lands them on the deck.
    const token = base64Encode(randomBytes(32));
    const sessionHash = await sha256Hex(token);
    const expiresAt = Date.now() + SESSION_HOURS * 3_600_000;
    const adminId = await ctx.runQuery(internal.adminAuth.adminIdByEmail, {
      email: clean,
    });
    if (adminId === null) throw new ConvexError("Could not create the account.");
    await ctx.runMutation(internal.adminAuth.openSession, {
      adminId,
      sessionHash,
      expiresAt,
    });

    return { ok: true as const, token, expiresAt };
  },
});

/** Sign in with an admin email and password. Returns a bearer token. */
export const login = action({
  args: { email: v.string(), password: v.string() },
  handler: async (
    ctx,
    { email, password },
  ): Promise<{
    ok: true;
    token: string;
    expiresAt: number;
    email: string;
    name: string | null;
  }> => {
    const clean = email.trim().toLowerCase();

    // Per-address first, so one attacker cannot grind many accounts.
    await ctx.runMutation(internal.adminAuth.consumeRateLimit, {
      key: "admin-login:address",
      max: 20,
      windowMs: 10 * 60_000,
      message: "Too many attempts. Wait a few minutes and try again.",
    });
    await ctx.runMutation(internal.adminAuth.consumeRateLimit, {
      key: `admin-login:${clean}`,
      max: 8,
      windowMs: 10 * 60_000,
      message: "Too many attempts on this account. Wait a few minutes.",
    });

    const record: AdminDoc | null = await ctx.runQuery(
      internal.adminAuth.byEmail,
      { email: clean },
    );

    // Always run the KDF, even for an unknown address, so a missing account
    // and a wrong password take the same time.
    const salt = record?.passwordSalt
      ? base64Decode(record.passwordSalt)
      : randomBytes(SALT_BYTES);
    const candidate = await derive(password, salt, PBKDF2_ROUNDS);
    const matches =
      record !== null && sameBytes(candidate, base64Decode(record.passwordHash));

    if (!matches || record === null) {
      throw new ConvexError(BAD_CREDENTIALS);
    }
    if (record.disabled === true) {
      throw new ConvexError("This administrator account is disabled.");
    }

    const token = base64Encode(randomBytes(32));
    const sessionHash = await sha256Hex(token);
    const expiresAt = Date.now() + SESSION_HOURS * 3_600_000;
    await ctx.runMutation(internal.adminAuth.openSession, {
      adminId: record._id,
      sessionHash,
      expiresAt,
    });

    return {
      ok: true as const,
      token,
      expiresAt,
      email: record.email,
      name: record.name ?? null,
    };
  },
});

/** Who does this bearer token belong to? Null when absent or expired. */
export const session = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    if (!token) return null;
    const admin = await resolveSession(ctx, token);
    if (admin === null) return null;
    return {
      id: admin._id,
      email: admin.email,
      name: admin.name ?? null,
      expiresAt: admin.sessionExpiresAt ?? null,
    };
  },
});

/** Forget this token. */
export const logout = mutation({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    if (!token) return { ok: true as const };
    const admin = await resolveSession(ctx, token);
    if (admin !== null) {
      await ctx.runMutation(internal.adminAuth.clearSession, { adminId: admin._id });
    }
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function base64Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/=+$/, "");
  const bytes = new Uint8Array(
    new ArrayBuffer(Math.floor((clean.length * 6) / 8)),
  );
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    const value = B64.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

type AdminDoc = {
  _id: GenericId<"admins">;
  email: string;
  name?: string | null;
  passwordHash: string;
  passwordSalt: string;
  sessionHash?: string | null;
  sessionExpiresAt?: number | null;
  disabled?: boolean | null;
};

/** The shape `ctx.db` must have to resolve a session — a read-only reader
 *  is enough, so this works from both queries and actions. */
export type AdminReader = { db: GenericDatabaseReader<DataModel> };

/** Resolve a bearer token to a live admin, or null. Never throws. */
export async function resolveSession(
  ctx: { db: GenericDatabaseReader<DataModel> },
  token: string,
): Promise<AdminDoc | null> {
  const sessionHash = await sha256Hex(token);
  const admin = (await ctx.db
    .query("admins")
    .withIndex("by_sessionHash", (q) => q.eq("sessionHash", sessionHash))
    .unique()) as AdminDoc | null;
  if (admin === null) return null;
  if (admin.disabled === true) return null;
  if (
    admin.sessionExpiresAt === undefined ||
    admin.sessionExpiresAt === null ||
    admin.sessionExpiresAt < Date.now()
  ) {
    return null;
  }
  return admin;
}
