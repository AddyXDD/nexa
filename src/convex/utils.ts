import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, GenericId } from "convex/values";
import type { GenericDatabaseReader, GenericDatabaseWriter } from "convex/server";
import {
  CODE_ALPHABET,
  MEETING_CODE_LENGTH,
  NEXA_ID_LENGTH,
  NEXA_ID_PREFIX,
  paidPlanFromCheckoutId,
  PLANS,
} from "../shared/constants";
import type { DataModel } from "./_generated/dataModel";
import { resolveSession } from "./adminAuth";

type Ctx = {
  db: GenericDatabaseReader<DataModel> | GenericDatabaseWriter<DataModel>;
};

/**
 * Cryptographically secure random string from CODE_ALPHABET.
 * Runs in the Convex runtime where `crypto.getRandomValues` is available
 * (the same primitive the OTP provider already uses).
 */
export function randomCode(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** A fresh, unguessable meeting code (retry handles the rare collision). */
export async function uniqueMeetingCode(
  db: GenericDatabaseReader<DataModel>,
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode(MEETING_CODE_LENGTH);
    const existing = await db
      .query("meetings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (existing === null) return code;
  }
  throw new ConvexError("Could not allocate a meeting code. Try again.");
}

/** A fresh Nexa ID, unique by index (retry on the rare collision). */
export async function uniqueNexaId(
  db: GenericDatabaseReader<DataModel>,
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const nexaId = NEXA_ID_PREFIX + randomCode(NEXA_ID_LENGTH);
    const existing = await db
      .query("users")
      .withIndex("by_nexaId", (q) => q.eq("nexaId", nexaId))
      .unique();
    if (existing === null) return nexaId;
  }
  throw new ConvexError("Could not allocate a Nexa ID. Try again.");
}

/** Resolves the authenticated user or throws. Identity always comes from
 *  the session — never from anything the client claims about itself. */
export async function requireUser(ctx: Ctx) {
  const userId = await getAuthUserId(ctx as never);
  if (userId === null) throw new ConvexError("Not authenticated.");
  const user = await ctx.db.get(userId);
  if (user === null) throw new ConvexError("Not authenticated.");
  return { userId: userId as GenericId<"users">, user };
}

/** Like requireUser, but also demands an assigned Nexa ID. */
export async function requireNexaUser(ctx: Ctx) {
  const { userId, user } = await requireUser(ctx);
  if (!user.nexaId) throw new ConvexError("Nexa ID not assigned yet.");
  return { userId, user, nexaId: user.nexaId };
}

/**
 * Admin access.
 *
 * Deliberately independent of customer accounts: an admin is not a row in
 * `users`, is not a Convex Auth session, and cannot be reached by signing
 * in through the product. Access is a bearer token issued only by
 * adminAuth.login (or one-shot provisioning) and checked here against a
 * stored hash.
 *
 * The message is deliberately the one an unknown route would give, so a
 * visitor with no valid token learns nothing about what lives behind
 * /admin.
 */
export async function requireAdmin(ctx: Ctx, token: string | undefined) {
  if (!token) throw new ConvexError("Not found.");
  const admin = await resolveSession({ db: ctx.db }, token);
  if (admin === null) throw new ConvexError("Not found.");
  return admin;
}

/** Validates the client-generated per-tab session handle. */
const SESSION_ID_REGEX = /^[0-9a-fA-F-]{32,36}$/;
export function requireSessionId(raw: string): string {
  const s = raw.trim();
  if (!SESSION_ID_REGEX.test(s)) throw new ConvexError("Invalid session.");
  return s.toLowerCase();
}

/**
 * The plan currently in force for a personal room's host: the plan behind
 * their most recent personal payment while it covers today, Free otherwise.
 * Limits (room size, meeting length) are derived live from this, so an
 * upgrade takes effect on the next check rather than only in the next room.
 * Organization purchases are deliberately excluded — they entitle the
 * workspace, not the member who paid.
 */
export async function getHostPlan(
  db: GenericDatabaseReader<DataModel>,
  hostUserId: GenericId<"users">,
): Promise<keyof typeof PLANS> {
  const rows = await db
    .query("payments")
    .withIndex("by_user", (q) => q.eq("userId", hostUserId))
    .order("desc")
    .take(20);
  const latest = rows.find(
    (row) =>
      row.status === "paid" &&
      row.paidAt !== undefined &&
      row.organizationId === undefined,
  );
  if (latest === undefined || latest.paidAt === undefined) return "free";
  const planId = paidPlanFromCheckoutId(latest.planId);
  if (planId === null) return "free";
  const periodDays = PLANS[planId].billingPeriodDays;
  if (periodDays === null) return "free";
  const activeUntil = latest.paidAt + periodDays * 86_400_000;
  return activeUntil > Date.now() ? planId : "free";
}

/* ---------------------------------------------------------------- *
 * Lifetime counters
 * ---------------------------------------------------------------- */

/**
 * Names live here rather than at the call sites so a typo cannot quietly
 * start a second counter that always reads zero.
 */
export const MEETINGS_CREATED_COUNTER = "meetings.created";

/** Add to a durable counter, creating it — and stamping `since` — on first
 *  use. Both halves run in the caller's transaction, so a counter can never
 *  count a room that was not written, or miss one that was. */
export async function bumpCounter(
  db: GenericDatabaseWriter<DataModel>,
  key: string,
  by = 1,
): Promise<number> {
  const now = Date.now();
  const row = await db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (row === null) {
    await db.insert("counters", { key, value: by, since: now, updatedAt: now });
    return by;
  }

  const value = row.value + by;
  await db.patch(row._id, { value, updatedAt: now });
  return value;
}

/**
 * Read a counter. A missing row means "nothing has happened since this was
 * introduced", which is reported as zero with no start date — never as an
 * error, so the admin overview works on a deployment that has never had a
 * meeting.
 */
export async function readCounter(
  db: GenericDatabaseReader<DataModel>,
  key: string,
): Promise<{ value: number; since: number | null }> {
  const row = await db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return { value: row?.value ?? 0, since: row?.since ?? null };
}

/**
 * Create a room row and count it.
 *
 * Every room in the product is born here — `meetings.create` for a room
 * started from scratch, `schedule.openRoom` for a booking opened from its
 * link — so the insert and the lifetime total are always written together.
 * The room is temporary (the sweeper deletes it once it ends); the count is
 * not.
 */
export async function createMeetingRow(
  db: GenericDatabaseWriter<DataModel>,
  {
    code,
    hostUserId,
    organizationId,
    visibility,
  }: {
    code: string;
    hostUserId: GenericId<"users">;
    organizationId?: GenericId<"organizations">;
    visibility?: "personal" | "organization" | "private";
  },
): Promise<void> {
  const now = Date.now();
  await db.insert("meetings", {
    code,
    hostUserId,
    createdAt: now,
    active: true,
    emptySince: now,
    ...(organizationId === undefined ? {} : { organizationId }),
    ...(visibility === undefined ? {} : { visibility }),
  });
  await bumpCounter(db, MEETINGS_CREATED_COUNTER);
}

export async function findActiveMeeting(
  db: GenericDatabaseReader<DataModel>,
  code: string,
) {
  const meeting = await db
    .query("meetings")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
  if (meeting === null || !meeting.active) return null;
  return meeting;
}

/**
 * Sliding-window rate limit backed by the (ephemeral) rateLimits table.
 * Throws a user-safe message when the window is exhausted.
 */
export async function enforceRateLimit(
  ctx: { db: GenericDatabaseWriter<DataModel> },
  key: string,
  max: number,
  windowMs: number,
  message = "Too many requests. Please wait a moment and try again.",
) {
  const now = Date.now();
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (row === null || now - row.windowStart > windowMs) {
    if (row) await ctx.db.delete(row._id);
    await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    return;
  }
  if (row.count >= max) throw new ConvexError(message);
  await ctx.db.patch(row._id, { count: row.count + 1 });
}

/** True when this user holds a live seat in this room. Authorization for
 *  every meeting-scoped operation (signals, chat, presence) runs through here. */
export async function getParticipant(
  db: GenericDatabaseReader<DataModel>,
  meetingCode: string,
  userId: GenericId<"users">,
  sessionId?: string,
) {
  const rows = await db
    .query("participants")
    .withIndex("by_meeting", (q) => q.eq("meetingCode", meetingCode))
    .filter((q) => q.eq(q.field("userId"), userId));
  const list = await rows.take(32);
  if (sessionId === undefined) return list[0] ?? null;
  return list.find((p) => p.sessionId === sessionId) ?? null;
}

/** Client-facing error extraction for ConvexError messages. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError && typeof err.data === "string") return err.data;
  if (err instanceof ConvexError) return fallback;
  return fallback;
}
