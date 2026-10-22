import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  CALENDAR,
  CALENDAR_MAX_SYNC_ATTEMPTS,
  CALENDAR_RETRY_BACKOFF_MS,
  DEFAULT_MEETING_MINUTES,
  MAX_MEETING_MINUTES,
  MIN_MEETING_MINUTES,
  SCHEDULING,
  normalizeMeetingCode,
} from "../../shared/constants";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../_generated/server";
import { meetingLink } from "../schedule";
import { ensureAccessToken } from "./connections";
import { calendarProvider } from "./providers/registry";
import {
  asProviderError,
  type EventTarget,
  type ProviderTokens,
} from "./providers/types";
import { randomBase32Hex, requireEncryptionKey } from "./secrets";

/**
 * Calendar sync.
 *
 * The design is deliberately *declarative*: a `calendarEvents` row stores the
 * desired state of the event (title, times, zone, guests, cancelled) and every
 * attempt applies that snapshot from scratch. Retrying therefore converges on
 * the right event instead of replaying an operation, which is what makes
 * duplicate events structurally impossible:
 *
 *   - the event id is chosen by us, stored on the row, and reused, so a create
 *     that succeeded but whose response was lost gets a 409 on retry and is
 *     reconciled to the existing event;
 *   - an update is a PATCH of the same id — applying it twice is a no-op;
 *   - a delete of an already-deleted event is a success.
 *
 * Failures are classified by the provider adapter, and the response differs by
 * kind: transient/rate-limited failures arm a backoff and a scheduled retry,
 * a rejected grant asks the user to reconnect, and a permanent failure stops
 * and says so. A retry job that never arrives is covered by the reconciler
 * cron, which re-arms rows whose attempt lease has expired.
 */

export type SyncOutcomeStatus =
  | "not_connected"
  | "synced"
  | "pending"
  | "needs_reauth"
  | "failed"
  | "cancelled";

export type SyncOutcome = {
  status: SyncOutcomeStatus;
  /** Present when the event exists: where to look at it. */
  htmlLink?: string | null;
  /** User-facing sentence for anything but success. */
  message?: string;
};

/* ------------------------------------------------------------------ *
 * Public API (what the UI calls)
 * ------------------------------------------------------------------ */

/**
 * Create or re-apply the calendar event for one booking.
 *
 * Called when a meeting is scheduled and again whenever it is rescheduled or
 * the user presses Retry. Returns what actually happened — the UI never
 * assumes success.
 */
export const syncMeeting = action({
  args: { code: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { code, force }): Promise<SyncOutcome> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated.");

    const booking = await ctx.runQuery(internal.calendar.sync.bookingForHost, {
      code,
      userId,
    });
    if (booking === null) throw new ConvexError(SCHEDULING.notFound);

    // Fail before touching the calendar if the deployment can't seal tokens.
    requireEncryptionKey();

    const connection = await ctx.runQuery(
      internal.calendar.connections.connectionRow,
      { userId, provider: "google" },
    );
    if (connection === null || connection.status === "revoked") {
      return { status: "not_connected", message: CALENDAR.notConnected };
    }
    if (connection.status === "needs_reauth") {
      return { status: "needs_reauth", message: CALENDAR.needsReauth };
    }

    const linkId = await ctx.runMutation(internal.calendar.sync.ensureLink, {
      provider: connection.provider,
      hostUserId: userId,
      meetingId: booking.id,
      meetingCode: booking.code,
      connectionId: connection._id,
      calendarId: connection.calendarId,
      desired: {
        title: booking.title,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        timeZone: booking.timeZone,
        invitees: booking.invitees,
        joinUrl: meetingLink(booking.code),
        cancelled: booking.status === "cancelled",
      },
      // Only used the first time this booking is linked.
      candidateEventId: randomBase32Hex(32),
      resetAttempts: force === true,
    });

    return await attemptSync(ctx, linkId);
  },
});

/**
 * Cancel both sides of a booking that was mirrored into a calendar.
 *
 * Idempotent by construction: the delete is issued against our own event id,
 * so a second call (or a cancelled-then-retried cancel) is a no-op that still
 * reports the truth. Called right after `schedule.cancel`, which is what
 * actually cancels the Nexa booking.
 */
export const cancelForBooking = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<SyncOutcome> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated.");

    const booking = await ctx.runQuery(internal.calendar.sync.bookingForHost, {
      code,
      userId,
    });
    if (booking === null) throw new ConvexError(SCHEDULING.notFound);

    const link = await ctx.runQuery(internal.calendar.sync.linkByCode, { code });
    if (link === null || link.hostUserId !== userId) {
      // Nothing was ever mirrored: the Nexa booking is cancelled and there is
      // no calendar event to remove.
      return { status: "not_connected", message: CALENDAR.notSynced };
    }

    requireEncryptionKey();
    await ctx.runMutation(internal.calendar.sync.markDesiredCancelled, {
      linkId: link._id,
    });
    return await attemptSync(ctx, link._id);
  },
});

/* ------------------------------------------------------------------ *
 * Attempt machinery
 * ------------------------------------------------------------------ */

function backoffFor(attempts: number): number {
  const index = Math.min(
    Math.max(attempts - 1, 0),
    CALENDAR_RETRY_BACKOFF_MS.length - 1,
  );
  return CALENDAR_RETRY_BACKOFF_MS[index];
}

/**
 * Apply the desired state once, and decide what happens next.
 *
 * Shared by the user-facing action, the scheduled retry, and the reconciler,
 * so a retry follows exactly the same path as a first attempt.
 */
async function attemptSync(
  ctx: ActionCtx,
  linkId: Id<"calendarEvents">,
): Promise<SyncOutcome> {
  const row = await ctx.runQuery(internal.calendar.sync.linkRow, {
    linkId,
  });
  if (row === null) {
    return { status: "failed", message: SCHEDULING.notFound };
  }
  const provider = calendarProvider(row.provider);

  const connection = await ctx.runQuery(
    internal.calendar.connections.connectionById,
    { connectionId: row.connectionId },
  );
  if (connection === null || connection.status !== "connected") {
    await ctx.runMutation(internal.calendar.sync.recordOutcome, {
      linkId,
      status: "failed",
      needsReauth: true,
      message: CALENDAR.needsReauth,
    });
    return { status: "needs_reauth", message: CALENDAR.needsReauth };
  }

  // Claim: bumps the attempt count and takes a short lease. If this action
  // dies before recording an outcome, the lease expires and the reconciler
  // picks the row back up — no booking is ever left silently unsynced.
  const claim = await ctx.runMutation(internal.calendar.sync.claim, { linkId });
  if (!claim.ok) {
    return { status: "failed", message: CALENDAR.failed };
  }

  const target: EventTarget = {
    title: row.desired.title,
    description: eventDescription(row.desired.joinUrl),
    joinUrl: row.desired.joinUrl,
    startsAt: row.desired.startsAt,
    endsAt: row.desired.endsAt,
    timeZone: row.desired.timeZone,
    attendees: row.desired.invitees,
    eventId: row.eventId,
  };

  try {
    // Getting a token is part of the attempt, not a preamble: a refresh that
    // fails transiently deserves the same backoff as a failed API call, and a
    // rejected grant has to be recorded against this link too.
    const tokens: ProviderTokens = {
      accessToken: await ensureSafeToken(ctx, connection._id),
      expiresAt: connection.accessTokenExpiresAt ?? 0,
      scopes: connection.scopes,
    };

    if (row.desired.cancelled) {
      // Our chosen id *is* the provider event id, so this covers both a
      // confirmed event and a create whose response we never saw.
      await provider.deleteEvent({
        tokens,
        calendarId: row.calendarId,
        eventId: row.externalEventId ?? row.eventId,
      });
      await ctx.runMutation(internal.calendar.sync.recordOutcome, {
        linkId,
        status: "cancelled",
      });
      return { status: "cancelled" };
    }

    const event = row.externalEventId
      ? await updateOrRecreate(
          provider,
          tokens,
          row.calendarId,
          row.externalEventId,
          target,
        )
      : await provider.createEvent({
          tokens,
          calendarId: row.calendarId,
          target,
        });

    await ctx.runMutation(internal.calendar.sync.recordOutcome, {
      linkId,
      status: "synced",
      externalEventId: event.id,
      htmlLink: event.htmlLink ?? undefined,
      organizerEmail: event.organizerEmail ?? undefined,
    });
    return { status: "synced", htmlLink: event.htmlLink ?? null };
  } catch (error) {
    const providerError = asProviderError(error);

    if (providerError.retryable) {
      const delay = backoffFor(claim.attempts);
      const exhausted = claim.attempts >= CALENDAR_MAX_SYNC_ATTEMPTS;
      await ctx.runMutation(internal.calendar.sync.recordOutcome, {
        linkId,
        status: exhausted ? "failed" : "pending",
        message: exhausted ? CALENDAR.failed : CALENDAR.retrying,
        nextAttemptAt: exhausted ? undefined : Date.now() + delay,
      });
      if (!exhausted) {
        await ctx.scheduler.runAfter(
          delay,
          internal.calendar.sync.retrySync,
          { linkId },
        );
      }
      return exhausted
        ? { status: "failed", message: CALENDAR.failed }
        : { status: "pending", message: CALENDAR.retrying };
    }

    if (providerError.kind === "reauth_required") {
      await ctx.runMutation(internal.calendar.sync.recordOutcome, {
        linkId,
        status: "failed",
        needsReauth: true,
        message: CALENDAR.needsReauth,
      });
      return { status: "needs_reauth", message: CALENDAR.needsReauth };
    }

    // Permanent: retrying the same request would fail the same way, so stop
    // and let the user act. Only the classification and Google's own phrasing
    // are logged — never the meeting code, the join link, or a guest address.
    console.warn(`[calendar] sync failed permanently: ${providerError.message}`);
    await ctx.runMutation(internal.calendar.sync.recordOutcome, {
      linkId,
      status: "failed",
      message: CALENDAR.failed,
    });
    return { status: "failed", message: CALENDAR.failed };
  }
}

/**
 * Update, or recreate if the event was deleted outside Nexa.
 *
 * Someone deleting the event in Google Calendar is a normal thing to do; the
 * next sync puts the meeting back rather than failing forever with a 404.
 */
async function updateOrRecreate(
  provider: ReturnType<typeof calendarProvider>,
  tokens: ProviderTokens,
  calendarId: string,
  externalEventId: string,
  target: EventTarget,
) {
  try {
    return await provider.updateEvent({
      tokens,
      calendarId,
      eventId: externalEventId,
      target,
    });
  } catch (error) {
    const providerError = asProviderError(error);
    if (providerError.kind !== "not_found") throw providerError;
    return await provider.createEvent({ tokens, calendarId, target });
  }
}

/** Access token for the attempt, with the connection's own failure handling. */
async function ensureSafeToken(
  ctx: ActionCtx,
  connectionId: Id<"calendarConnections">,
): Promise<string> {
  const connection = await ctx.runQuery(
    internal.calendar.connections.connectionById,
    { connectionId },
  );
  if (connection === null) {
    throw new ConvexError(CALENDAR.needsReauth);
  }
  return await ensureAccessToken(ctx, connection, calendarProvider(connection.provider));
}

function eventDescription(joinUrl: string): string {
  return [
    `Join the Nexa meeting: ${joinUrl}`,
    "",
    "No account is needed to join. The room is created when the first person opens the link and its roster, chat and connection data are destroyed when the last one leaves.",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Scheduled retry + reconciliation
 * ------------------------------------------------------------------ */

/**
 * A retry, triggered by the scheduler or the reconciler.
 *
 * Deliberately silent about authorization: the row carries the owner, and
 * only a background job ever reaches this, never a client.
 */
export const retrySync = internalAction({
  args: { linkId: v.id("calendarEvents") },
  handler: async (ctx, { linkId }): Promise<void> => {
    const row = await ctx.runQuery(internal.calendar.sync.linkRow, { linkId });
    if (row === null || row.syncStatus === "synced" || row.syncStatus === "cancelled") {
      return;
    }
    await attemptSync(ctx, linkId);
  },
});

/**
 * Re-arm syncs whose scheduled retry never arrived (a lost job, an expired
 * lease, a deployment restart mid-flight). One cron tick, bounded work.
 */
export const reconcilePending = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("calendarEvents")
      .withIndex("by_status_next", (q) =>
        q.eq("syncStatus", "pending").lt("nextAttemptAt", now),
      )
      .take(20);

    let scheduled = 0;
    let abandoned = 0;
    for (const row of due) {
      if (row.attempts >= CALENDAR_MAX_SYNC_ATTEMPTS) {
        await ctx.db.patch(row._id, {
          syncStatus: "failed",
          nextAttemptAt: undefined,
          lastError: CALENDAR.failed,
        });
        abandoned++;
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.calendar.sync.retrySync, {
        linkId: row._id,
      });
      scheduled++;
    }
    return { scheduled, abandoned };
  },
});

/* ------------------------------------------------------------------ *
 * Data access
 * ------------------------------------------------------------------ */

/**
 * The booking, only if this user owns it. Authorization for every calendar
 * operation on a meeting runs through here — the code alone is not enough,
 * and a wrong owner is indistinguishable from a missing booking.
 */
export const bookingForHost = internalQuery({
  args: { code: v.string(), userId: v.id("users") },
  handler: async (ctx, { code: raw, userId }) => {
    const code = normalizeMeetingCode(raw);
    const booking = await ctx.db
      .query("scheduledMeetings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (booking === null || booking.hostUserId !== userId) return null;

    const duration = Math.min(
      Math.max(booking.durationMinutes ?? DEFAULT_MEETING_MINUTES, MIN_MEETING_MINUTES),
      MAX_MEETING_MINUTES,
    );
    return {
      id: booking._id,
      code: booking.code,
      title: booking.title ?? "Nexa Meet",
      startsAt: booking.startsAt,
      endsAt: booking.startsAt + duration * 60_000,
      timeZone: booking.timeZone ?? "UTC",
      invitees: booking.invitees,
      status: booking.status,
    };
  },
});

export const linkRow = internalQuery({
  args: { linkId: v.id("calendarEvents") },
  handler: async (ctx, { linkId }) => await ctx.db.get(linkId),
});

export const linkByCode = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, { code }) =>
    await ctx.db
      .query("calendarEvents")
      .withIndex("by_meeting_code", (q) => q.eq("meetingCode", normalizeMeetingCode(code)))
      .unique(),
});

/**
 * Make sure exactly one mapping row exists for a booking, and point its
 * desired state at what the booking says now.
 *
 * The unique lookup + insert inside a single mutation is what stops two
 * concurrent requests from linking the same meeting twice: Convex serializes
 * them, so the second transaction sees the first's row.
 */
export const ensureLink = internalMutation({
  args: {
    provider: v.string(),
    hostUserId: v.id("users"),
    meetingId: v.id("scheduledMeetings"),
    meetingCode: v.string(),
    connectionId: v.id("calendarConnections"),
    calendarId: v.string(),
    desired: v.object({
      title: v.string(),
      startsAt: v.number(),
      endsAt: v.number(),
      timeZone: v.string(),
      invitees: v.array(v.string()),
      joinUrl: v.string(),
      cancelled: v.boolean(),
    }),
    candidateEventId: v.string(),
    resetAttempts: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("calendarEvents")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .unique();

    if (existing === null) {
      return await ctx.db.insert("calendarEvents", {
        provider: args.provider,
        hostUserId: args.hostUserId,
        meetingId: args.meetingId,
        meetingCode: args.meetingCode,
        connectionId: args.connectionId,
        calendarId: args.calendarId,
        eventId: args.candidateEventId,
        syncStatus: "pending",
        attempts: 0,
        desired: args.desired,
      });
    }

    // Reconnected with a different account or calendar: the event we used to
    // manage is out of reach, so forget the confirmation and let the next
    // attempt create it on the calendar we can write to now.
    const connectionChanged = existing.connectionId !== args.connectionId;

    await ctx.db.patch(existing._id, {
      connectionId: args.connectionId,
      calendarId: args.calendarId,
      meetingCode: args.meetingCode,
      desired: args.desired,
      ...(connectionChanged ? { externalEventId: undefined } : {}),
      ...(args.resetAttempts
        ? {
            attempts: 0,
            lastError: undefined,
            needsReauth: false,
            syncStatus: "pending" as const,
          }
        : {}),
    });
    return existing._id;
  },
});

export const markDesiredCancelled = internalMutation({
  args: { linkId: v.id("calendarEvents") },
  handler: async (ctx, { linkId }) => {
    const row = await ctx.db.get(linkId);
    if (row === null) return;
    await ctx.db.patch(linkId, {
      desired: { ...row.desired, cancelled: true },
      syncStatus: "pending",
      attempts: 0,
      nextAttemptAt: undefined,
      lastError: undefined,
      needsReauth: false,
    });
  },
});

/**
 * Take the lease for one attempt.
 *
 * `nextAttemptAt` doubles as the lease: it is set 60s ahead so that if this
 * attempt never records an outcome, the reconciler finds the row due again
 * and retries it. `attempts` counts total attempts, which is what the retry
 * ladder and the give-up rule measure.
 */
export const claim = internalMutation({
  args: { linkId: v.id("calendarEvents") },
  handler: async (ctx, { linkId }) => {
    const row = await ctx.db.get(linkId);
    if (row === null) return { ok: false as const };
    const now = Date.now();
    const attempts = row.attempts + 1;
    await ctx.db.patch(linkId, {
      attempts,
      lastAttemptAt: now,
      nextAttemptAt: now + 60_000,
      syncStatus: "pending",
    });
    return { ok: true as const, attempts };
  },
});

/** Record what the provider actually said. Nothing here is optimistic. */
export const recordOutcome = internalMutation({
  args: {
    linkId: v.id("calendarEvents"),
    status: v.union(
      v.literal("pending"),
      v.literal("synced"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    message: v.optional(v.string()),
    externalEventId: v.optional(v.string()),
    htmlLink: v.optional(v.string()),
    organizerEmail: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    needsReauth: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.linkId);
    if (row === null) return;
    const now = Date.now();

    if (args.status === "synced") {
      await ctx.db.patch(args.linkId, {
        syncStatus: "synced",
        externalEventId: args.externalEventId ?? row.externalEventId,
        htmlLink: args.htmlLink ?? row.htmlLink,
        // A dead giveaway if this ever regresses: never store a token here.
        lastSyncedAt: now,
        lastError: undefined,
        needsReauth: false,
        nextAttemptAt: undefined,
      });
      if (args.organizerEmail) {
        const connection = await ctx.db.get(row.connectionId);
        if (connection !== null && !connection.accountEmail) {
          // Learn which account this is from the organiser the provider
          // reports — one less permission to ask the user for up front.
          await ctx.db.patch(connection._id, {
            accountEmail: args.organizerEmail,
          });
        }
      }
      return;
    }

    if (args.status === "cancelled") {
      await ctx.db.patch(args.linkId, {
        syncStatus: "cancelled",
        cancelledAt: now,
        nextAttemptAt: undefined,
        lastError: undefined,
        needsReauth: false,
      });
      return;
    }

    await ctx.db.patch(args.linkId, {
      syncStatus: args.status,
      lastError: args.message,
      needsReauth: args.needsReauth ?? false,
      nextAttemptAt: args.nextAttemptAt,
      ...(args.status === "failed" ? { lastAttemptAt: now } : {}),
    });
  },
});
