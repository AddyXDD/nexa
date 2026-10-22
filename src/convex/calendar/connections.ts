import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  CALENDAR,
  CALENDAR_CONNECT_LIMIT,
  CALENDAR_OAUTH_STATE_TTL_MS,
  CALENDAR_PROVIDER_IDS,
} from "../../shared/constants";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "../_generated/server";
import { enforceRateLimit } from "../utils";
import {
  calendarReadiness,
  calendarRedirectUri,
  resolveReturnTo,
} from "./config";
import { calendarProvider } from "./providers/registry";
import {
  CalendarProviderError,
  asProviderError,
  type CalendarProvider,
} from "./providers/types";
import {
  decryptSecret,
  encryptSecret,
  randomToken,
  requireEncryptionKey,
  sha256Base64Url,
  sha256Hex,
} from "./secrets";

/**
 * Calendar connections.
 *
 * One OAuth grant per (account, provider). This module owns the connect flow,
 * the status the UI reads, disconnection, and the only code path that turns a
 * stored refresh token back into a live access token.
 *
 * The connect flow, end to end:
 *   1. `startConnect` (this file) mints a single-use state token, stores its
 *      SHA-256 plus an encrypted PKCE verifier, and returns the consent URL.
 *   2. The browser goes to the provider and comes back to the callback route
 *      registered in `../http.ts`, which lives on the Convex deployment.
 *   3. The callback consumes the state, exchanges the code, seals the tokens,
 *      and redirects to a path on our own origin.
 *
 * Nothing here ever returns a token to the client, and no query selects one.
 */

/**
 * Can this account own a calendar grant?
 *
 * A connection belongs to an account, and its whole purpose is to carry events
 * for meetings that account booked. Booking requires an address
 * (`schedule.schedule` refuses guests), so a guest session — or any account
 * with no email — could never have a connection that does anything. Refusing
 * up front is what stops the settings card from offering a grant that cannot
 * work, and stops the connected state from contradicting the schedule form.
 */
function canOwnCalendar(user: Doc<"users"> | null): boolean {
  return user !== null && user.isAnonymous !== true && Boolean(user.email);
}

/* ------------------------------------------------------------------ *
 * Public: status
 * ------------------------------------------------------------------ */

/**
 * What the settings card renders. Field-by-field: the token columns are
 * deliberately not part of this shape, so they cannot leak through a query
 * even by accident.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      // A visitor with no session is in the same position as a guest: there
      // is no account to attach a grant to, so the card asks for a sign-in
      // rather than offering a Connect button that would be refused.
      return {
        ready: false,
        reason: CALENDAR.notConnected,
        requiresSignIn: true,
        providers: [],
      };
    }
    if (!canOwnCalendar(await ctx.db.get(userId))) {
      // Deliberately no provider list: a guest may already hold a connection
      // from before this rule existed, and reporting it as "Connected" beside
      // a scheduling form that refuses guests is the exact contradiction this
      // return removes. The row is left untouched, never shown.
      return {
        ready: false,
        reason: CALENDAR.guestNeedsSignIn,
        requiresSignIn: true,
        providers: [],
      };
    }
    const rows = await ctx.db
      .query("calendarConnections")
      .withIndex("by_user_provider", (q) => q.eq("userId", userId))
      .collect();
    const readiness = calendarReadiness();

    return {
      ready: readiness.ready,
      reason: readiness.reason,
      requiresSignIn: false,
      providers: CALENDAR_PROVIDER_IDS.map((id) => {
        const row = rows.find((entry) => entry.provider === id);
        return {
          id,
          status: row
            ? (row.status as "connected" | "needs_reauth" | "revoked")
            : ("not_connected" as const),
          accountEmail: row?.accountEmail ?? null,
          calendarId: row?.calendarId ?? null,
          connectedAt: row?.connectedAt ?? null,
          disconnectedAt: row?.disconnectedAt ?? null,
          scopes: row?.scopes ?? [],
          lastError: row?.lastError ?? null,
          lastErrorAt: row?.lastErrorAt ?? null,
        };
      }),
    };
  },
});

/** Per-booking sync state, for the scheduling UI. Host-scoped. */
export const listLinks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("calendarEvents")
      .withIndex("by_host", (q) => q.eq("hostUserId", userId))
      .order("desc")
      .take(50);
    return rows.map((row) => ({
      meetingCode: row.meetingCode,
      provider: row.provider,
      syncStatus: row.syncStatus,
      htmlLink: row.htmlLink ?? null,
      lastError: row.lastError ?? null,
      attempts: row.attempts,
      needsReauth: row.needsReauth ?? false,
      lastSyncedAt: row.lastSyncedAt ?? null,
      nextAttemptAt: row.nextAttemptAt ?? null,
      cancelled: row.desired.cancelled,
    }));
  },
});

/* ------------------------------------------------------------------ *
 * Public: connect / disconnect
 * ------------------------------------------------------------------ */

/** Begin a connect flow. Returns the consent URL; nothing else leaves here. */
export const startConnect = action({
  args: {
    provider: v.optional(v.string()),
    /** A path on our own origin to land on; absolute URLs are rejected. */
    returnTo: v.optional(v.string()),
  },
  handler: async (ctx, { provider: rawProvider, returnTo }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated.");

    // Checked before readiness: a guest cannot use a calendar at all, so that
    // is the honest answer, not "the deployment isn't configured". Actions
    // have no database access, hence the internal query.
    const canOwn = await ctx.runQuery(
      internal.calendar.connections.accountCanOwnCalendar,
      { userId },
    );
    if (!canOwn) throw new ConvexError(CALENDAR.guestNeedsSignIn);

    const readiness = calendarReadiness();
    if (!readiness.ready) throw new ConvexError(readiness.reason ?? CALENDAR.connectFailed);

    const provider = calendarProvider(rawProvider ?? "google");
    await ctx.runMutation(internal.calendar.connections.consumeConnectLimit, {
      userId,
    });

    const state = randomToken(32);
    const codeVerifier = randomToken(32);
    const redirectUri = calendarRedirectUri();

    await ctx.runMutation(internal.calendar.connections.recordState, {
      // Only the hash is stored: a database read cannot forge a callback.
      stateHash: await sha256Hex(state),
      provider: provider.id,
      userId,
      codeVerifierEnc: await encryptSecret(codeVerifier),
      redirectTo: resolveReturnTo(returnTo),
      expiresAt: Date.now() + CALENDAR_OAUTH_STATE_TTL_MS,
    });

    return {
      url: provider.authorizeUrl({
        state,
        codeChallenge: await sha256Base64Url(codeVerifier),
        redirectUri,
      }),
      provider: provider.id,
    };
  },
});

/**
 * Disconnect.
 *
 * Revokes the grant at the provider when we can (so the access really ends,
 * not just locally), then drops the sealed tokens from our database for good.
 * Events already created are left where they are — the confirmation text tells
 * the user exactly that — and any sync still waiting stops retrying.
 */
export const disconnect = action({
  args: { provider: v.optional(v.string()) },
  handler: async (
    ctx,
    { provider: rawProvider },
  ): Promise<{ ok: true; revoked: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated.");
    const provider = calendarProvider(rawProvider ?? "google");

    // Annotated deliberately: this reads a function from its own module, and
    // leaving the type to inference makes TypeScript chase the generated api
    // object back into this file, which it resolves as an implicit `any` and
    // then propagates to every other caller of the api. The annotation is what
    // keeps the module's own types intact.
    const row: Doc<"calendarConnections"> | null = await ctx.runQuery(
      internal.calendar.connections.connectionRow,
      { userId, provider: provider.id },
    );
    if (row === null) return { ok: true as const, revoked: false };
    // Nothing stored means nothing to revoke: a second disconnect is a no-op
    // rather than another round trip to the provider.
    const hadCredentials = Boolean(row.refreshTokenEnc ?? row.accessTokenEnc);

    if (row.refreshTokenEnc && process.env.CALENDAR_TOKEN_KEY) {
      try {
        const token = await decryptSecret(row.refreshTokenEnc);
        await provider.revoke(token);
      } catch {
        // Revoking is best effort: a provider outage must not leave someone
        // stuck "connected". The local tokens are cleared regardless.
      }
    }

    await ctx.runMutation(internal.calendar.connections.markRevoked, {
      userId,
      provider: provider.id,
    });
    return { ok: true as const, revoked: hadCredentials };
  },
});

/* ------------------------------------------------------------------ *
 * Internal storage
 * ------------------------------------------------------------------ */

export const consumeConnectLimit = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await enforceRateLimit(
      ctx,
      `calendar-connect:${userId}`,
      CALENDAR_CONNECT_LIMIT.max,
      CALENDAR_CONNECT_LIMIT.windowMs,
    );
  },
});

export const recordState = internalMutation({
  args: {
    stateHash: v.string(),
    provider: v.string(),
    userId: v.id("users"),
    codeVerifierEnc: v.string(),
    redirectTo: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Tidy up this user's expired flows so the table can't grow unbounded.
    const now = Date.now();
    const stale = await ctx.db
      .query("calendarOAuthStates")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(20);
    for (const row of stale) await ctx.db.delete(row._id);
    await ctx.db.insert("calendarOAuthStates", { ...args, createdAt: now });
  },
});

/**
 * Consume a state token, exactly once.
 *
 * Transactional, so two concurrent callbacks with the same state can't both
 * win; the loser sees `null` and is sent back with an error.
 */
export const consumeState = internalMutation({
  args: { stateHash: v.string() },
  handler: async (ctx, { stateHash }) => {
    const row = await ctx.db
      .query("calendarOAuthStates")
      .withIndex("by_stateHash", (q) => q.eq("stateHash", stateHash))
      .unique();
    if (row === null) return null;
    if (row.consumedAt !== undefined) return null;
    if (row.expiresAt < Date.now()) {
      await ctx.db.delete(row._id);
      return null;
    }
    await ctx.db.patch(row._id, { consumedAt: Date.now() });
    return {
      provider: row.provider,
      userId: row.userId,
      codeVerifierEnc: row.codeVerifierEnc,
      redirectTo: row.redirectTo,
    };
  },
});

/**
 * `canOwnCalendar` for an action, which has no database access of its own.
 *
 * Takes the id explicitly rather than reading the session: the caller has just
 * resolved it and both must agree on who is being checked.
 */
export const accountCanOwnCalendar = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    canOwnCalendar(await ctx.db.get(userId)),
});

/** Internal: the raw connection row, including sealed tokens. Actions only. */
export const connectionRow = internalQuery({
  args: { userId: v.id("users"), provider: v.string() },
  handler: async (ctx, { userId, provider }) =>
    await ctx.db
      .query("calendarConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", provider),
      )
      .unique(),
});

export const connectionById = internalQuery({
  args: { connectionId: v.id("calendarConnections") },
  handler: async (ctx, { connectionId }) => await ctx.db.get(connectionId),
});

/** A finished OAuth exchange: seal the tokens and mark the account connected. */
export const upsertConnection = internalMutation({
  args: {
    userId: v.id("users"),
    provider: v.string(),
    calendarId: v.string(),
    accessTokenEnc: v.string(),
    refreshTokenEnc: v.optional(v.string()),
    accessTokenExpiresAt: v.number(),
    scopes: v.array(v.string()),
    accountEmail: v.optional(v.string()),
    accountId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("calendarConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider),
      )
      .unique();

    if (existing === null) {
      return await ctx.db.insert("calendarConnections", {
        userId: args.userId,
        provider: args.provider,
        status: "connected",
        accountEmail: args.accountEmail,
        accountId: args.accountId,
        scopes: args.scopes,
        accessTokenEnc: args.accessTokenEnc,
        refreshTokenEnc: args.refreshTokenEnc,
        accessTokenExpiresAt: args.accessTokenExpiresAt,
        keyVersion: 1,
        calendarId: args.calendarId,
        connectedAt: now,
        lastRefreshAt: now,
      });
    }

    // Reconnecting over an existing grant: keep the stored refresh token if
    // this exchange didn't return a new one (Google usually doesn't).
    await ctx.db.patch(existing._id, {
      status: "connected",
      accountEmail: args.accountEmail ?? existing.accountEmail,
      accountId: args.accountId ?? existing.accountId,
      scopes: args.scopes,
      accessTokenEnc: args.accessTokenEnc,
      ...(args.refreshTokenEnc !== undefined
        ? { refreshTokenEnc: args.refreshTokenEnc }
        : {}),
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      keyVersion: 1,
      calendarId: args.calendarId,
      connectedAt: existing.connectedAt,
      lastRefreshAt: now,
      lastError: undefined,
      lastErrorAt: undefined,
      disconnectedAt: undefined,
    });
    return existing._id;
  },
});

export const storeTokens = internalMutation({
  args: {
    connectionId: v.id("calendarConnections"),
    accessTokenEnc: v.string(),
    refreshTokenEnc: v.optional(v.string()),
    accessTokenExpiresAt: v.number(),
    accountEmail: v.optional(v.string()),
    accountId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      accessTokenEnc: args.accessTokenEnc,
      ...(args.refreshTokenEnc !== undefined
        ? { refreshTokenEnc: args.refreshTokenEnc }
        : {}),
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      lastRefreshAt: Date.now(),
      status: "connected",
      lastError: undefined,
      lastErrorAt: undefined,
      ...(args.accountEmail !== undefined ? { accountEmail: args.accountEmail } : {}),
      ...(args.accountId !== undefined ? { accountId: args.accountId } : {}),
    });
  },
});

/**
 * The grant is gone for good: the user has to reconnect. Called when a refresh
 * is rejected, so the UI can say so before the next meeting is attempted.
 */
export const markNeedsReauth = internalMutation({
  args: { connectionId: v.id("calendarConnections"), message: v.string() },
  handler: async (ctx, { connectionId, message }) => {
    const row = await ctx.db.get(connectionId);
    if (row === null) return;
    await ctx.db.patch(connectionId, {
      status: "needs_reauth",
      // The access token is useless now; the refresh token is kept so a
      // reconnect can start cleanly rather than showing a blank state.
      accessTokenEnc: undefined,
      accessTokenExpiresAt: undefined,
      lastError: message,
      lastErrorAt: Date.now(),
    });
  },
});

/** A short, non-sensitive note about the last failure, for the settings card. */
export const noteError = internalMutation({
  args: { connectionId: v.id("calendarConnections"), message: v.string() },
  handler: async (ctx, { connectionId, message }) => {
    await ctx.db.patch(connectionId, {
      lastError: message.slice(0, 200),
      lastErrorAt: Date.now(),
    });
  },
});

/**
 * Forget the credentials, keep the record.
 *
 * Sealing is dropped, every sync still waiting is stopped with an honest
 * message, and rows already synced are left alone: those events exist in the
 * user's calendar and Nexa simply stops managing them.
 */
export const markRevoked = internalMutation({
  args: { userId: v.id("users"), provider: v.string() },
  handler: async (ctx, { userId, provider }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("calendarConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", provider),
      )
      .collect();
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        status: "revoked",
        accessTokenEnc: undefined,
        refreshTokenEnc: undefined,
        accessTokenExpiresAt: undefined,
        scopes: [],
        disconnectedAt: now,
        lastError: undefined,
        lastErrorAt: undefined,
      });
    }

    const links = await ctx.db
      .query("calendarEvents")
      .withIndex("by_host_status", (q) =>
        q.eq("hostUserId", userId).eq("syncStatus", "pending"),
      )
      .take(100);
    for (const link of links) {
      if (link.provider !== provider) continue;
      await ctx.db.patch(link._id, {
        syncStatus: "failed",
        needsReauth: true,
        nextAttemptAt: undefined,
        lastError: CALENDAR.needsReauth,
        lastAttemptAt: now,
      });
    }
  },
});

/* ------------------------------------------------------------------ *
 * Token access (actions only)
 * ------------------------------------------------------------------ */

/**
 * A usable access token for a connection, refreshing it when needed.
 *
 * This is the convergence point for "expired token" handling: a token that is
 * close to expiry is refreshed *before* the API call, and a refresh that is
 * rejected turns the connection into `needs_reauth` so the user is asked to
 * reconnect rather than shown a mystery failure.
 */
export async function ensureAccessToken(
  ctx: ActionCtx,
  connection: Doc<"calendarConnections">,
  provider: CalendarProvider,
): Promise<string> {
  const key = requireEncryptionKey();
  const expiresAt = connection.accessTokenExpiresAt ?? 0;
  if (connection.accessTokenEnc && expiresAt > Date.now() + 60_000) {
    return await decryptSecret(connection.accessTokenEnc, key);
  }
  if (!connection.refreshTokenEnc) {
    await ctx.runMutation(internal.calendar.connections.markNeedsReauth, {
      connectionId: connection._id,
      message: CALENDAR.needsReauth,
    });
    throw new CalendarProviderError("reauth_required", CALENDAR.needsReauth);
  }

  const refreshToken = await decryptSecret(connection.refreshTokenEnc, key);
  try {
    const tokens = await provider.refresh(refreshToken);
    await ctx.runMutation(internal.calendar.connections.storeTokens, {
      connectionId: connection._id,
      accessTokenEnc: await encryptSecret(tokens.accessToken, key),
      refreshTokenEnc: tokens.refreshToken
        ? await encryptSecret(tokens.refreshToken, key)
        : undefined,
      accessTokenExpiresAt: tokens.expiresAt,
      accountEmail: tokens.accountEmail ?? undefined,
      accountId: tokens.accountId ?? undefined,
    });
    return tokens.accessToken;
  } catch (error) {
    const providerError = asProviderError(error);
    if (
      providerError.kind === "reauth_required" ||
      providerError.kind === "permanent"
    ) {
      await ctx.runMutation(internal.calendar.connections.markNeedsReauth, {
        connectionId: connection._id,
        message: CALENDAR.needsReauth,
      });
    }
    throw providerError;
  }
}
