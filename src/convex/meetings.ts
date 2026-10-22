import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  COPY,
  CREATE_MEETING_LIMIT,
  normalizeMeetingCode,
  PARTICIPANT_STALE_MS,
  PLANS,
} from "../shared/constants";
import type { Participant } from "../shared/types";
import type { GenericDatabaseReader } from "convex/server";
import { mutation, query } from "./_generated/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import { canAccessMeeting, getOrganizationPlan } from "./orgAuth";
import {
  createMeetingRow,
  enforceRateLimit,
  findActiveMeeting,
  getHostPlan,
  requireNexaUser,
  requireSessionId,
  requireUser,
  uniqueMeetingCode,
} from "./utils";

/**
 * Meeting lifecycle + presence.
 *
 * Persistent account data (users) lives apart from temporary meeting data
 * (meetings/participants/signals/chat). The only durable trace a meeting
 * leaves is its code on the (eventually deleted) meetings row.
 */

const mediaArgs = {
  micOn: v.boolean(),
  camOn: v.boolean(),
  sharing: v.boolean(),
} as const;

function toParticipant(
  row: Doc<"participants">,
  hostUserId?: Doc<"meetings">["hostUserId"],
): Participant {
  return {
    sessionId: row.sessionId,
    nexaId: row.nexaId,
    displayName: row.displayName ?? null,
    joinedAt: row.joinedAt,
    micOn: row.micOn,
    camOn: row.camOn,
    sharing: row.sharing,
    isHost: hostUserId !== undefined && row.userId === hostUserId,
  };
}

async function countParticipants(
  db: GenericDatabaseReader<DataModel>,
  code: string,
  /** The host's plan cap; `null` (unlimited) scans up to a hard ceiling. */
  cap: number | null,
) {
  const rows = await db
    .query("participants")
    .withIndex("by_meeting", (q) => q.eq("meetingCode", code))
    .take(cap === null ? 250 : cap + 4);
  return rows.length;
}

/**
 * Has this room outstayed the host's plan? `startedAt` marks the moment the
 * first seat was taken — the plan's meeting-length limit is counted from
 * there, so an upgrade mid-room lifts the ceiling immediately.
 */
function pastTimeLimit(
  meeting: Doc<"meetings">,
  plan: (typeof PLANS)[keyof typeof PLANS],
  now: number,
) {
  if (meeting.startedAt === undefined) return false;
  if (plan.maxMeetingHours === null) return false;
  return now - meeting.startedAt > plan.maxMeetingHours * 3_600_000;
}

/** Create a room server-side and return its unguessable code. */
export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireNexaUser(ctx);
    await enforceRateLimit(
      ctx,
      `meeting-create:${userId}`,
      CREATE_MEETING_LIMIT.max,
      CREATE_MEETING_LIMIT.windowMs,
      "You're creating meetings too quickly. Try again in a few minutes.",
    );
    const code = await uniqueMeetingCode(ctx.db);
    await createMeetingRow(ctx.db, { code, hostUserId: userId });
    console.log("[meeting] created", { code });
    return { code };
  },
});

/**
 * Room metadata for the join screen. null = doesn't exist, has ended, or is
 * an organization/private room this caller may not see. Returning the same
 * null for "missing" and "not allowed" avoids confirming that a private
 * meeting exists.
 */
export const get = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const norm = normalizeMeetingCode(code);
    const meeting = await findActiveMeeting(ctx.db, norm);
    if (meeting === null) return null;

    const userId = await getAuthUserId(ctx);
    const access = await canAccessMeeting(ctx.db, meeting, userId);
    if (!access.allowed) return null;

    const participantCount = await countParticipants(ctx.db, norm, null);
    const organization =
      meeting.organizationId === undefined
        ? null
        : await ctx.db.get(meeting.organizationId);
    return {
      code: meeting.code,
      createdAt: meeting.createdAt,
      participantCount,
      visibility: meeting.visibility ?? "personal",
      organizationName: organization?.name ?? null,
    };
  },
});

/**
 * Reactive roster. Returns null when the room is gone; an empty list to
 * callers who haven't taken a seat yet (the code alone doesn't grant a view
 * of who's inside — joining does).
 */
export const listParticipants = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const { userId } = await requireUser(ctx);
    const norm = normalizeMeetingCode(code);
    const meeting = await findActiveMeeting(ctx.db, norm);
    if (meeting === null) return null;
    const rows = await ctx.db
      .query("participants")
      .withIndex("by_meeting", (q) => q.eq("meetingCode", norm))
      .take(250);
    const isMember = rows.some((r) => r.userId === userId);
    if (!isMember) return [];
    // A closed tab can't always deliver its leave (the socket dies first).
    // Hide seats whose heartbeat has stopped instead of showing them as
    // present until the per-minute sweeper deletes the row.
    const cutoff = Date.now() - PARTICIPANT_STALE_MS;
    return rows
      .filter((row) => row.lastSeenAt >= cutoff)
      .map((row) => toParticipant(row, meeting.hostUserId));
  },
});

/** Take a seat. Idempotent per session, so reconnects are just rejoins. */
export const join = mutation({
  args: {
    code: v.string(),
    sessionId: v.string(),
    ...mediaArgs,
  },
  handler: async (ctx, { code, sessionId: rawSessionId, micOn, camOn, sharing }) => {
    const sessionId = requireSessionId(rawSessionId);
    const { userId, user, nexaId } = await requireNexaUser(ctx);
    const norm = normalizeMeetingCode(code);
    const meeting = await findActiveMeeting(ctx.db, norm);
    if (meeting === null) throw new ConvexError(COPY.meetingGone);
    await enforceRateLimit(ctx, `meeting-join:${userId}`, 60, 60_000);

    const access = await canAccessMeeting(ctx.db, meeting, userId);
    if (!access.allowed) throw new ConvexError(access.reason);

    // An organization room runs on the workspace's plan; a personal room
    // keeps using its host's own plan.
    const planId =
      meeting.organizationId === undefined
        ? await getHostPlan(ctx.db, meeting.hostUserId)
        : await getOrganizationPlan(ctx.db, meeting.organizationId);
    const plan = PLANS[planId];
    const now = Date.now();
    if (pastTimeLimit(meeting, plan, now)) {
      throw new ConvexError(COPY.meetingTimeLimit);
    }

    const existing = await ctx.db
      .query("participants")
      .withIndex("by_meeting_session", (q) =>
        q.eq("meetingCode", norm).eq("sessionId", sessionId),
      )
      .unique();

    if (existing !== null) {
      if (existing.userId !== userId) throw new ConvexError("Session conflict.");
      await ctx.db.patch(existing._id, {
        lastSeenAt: now,
        nexaId,
        displayName: user.name || undefined,
        micOn,
        camOn,
        sharing,
      });
      await ctx.db.patch(meeting._id, {
        emptySince: undefined,
        ...(meeting.startedAt === undefined ? { startedAt: now } : {}),
      });
      return { code: norm, joined: false };
    }

    const count = await countParticipants(ctx.db, norm, plan.maxParticipants);
    if (plan.maxParticipants !== null && count >= plan.maxParticipants) {
      throw new ConvexError(COPY.meetingFull);
    }

    await ctx.db.insert("participants", {
      meetingCode: norm,
      userId,
      sessionId,
      nexaId,
      displayName: user.name || undefined,
      joinedAt: now,
      lastSeenAt: now,
      micOn,
      camOn,
      sharing,
    });
    await ctx.db.patch(meeting._id, {
      emptySince: undefined,
      ...(meeting.startedAt === undefined ? { startedAt: now } : {}),
    });
    console.log("[meeting] participant joined", { code: norm, nexaId });
    return { code: norm, joined: true };
  },
});

/**
 * Presence heartbeat. Also acts as the reconnect path: if a sweeper removed
 * a ghost row while this client was offline, the next heartbeat restores it,
 * which everyone else observes as a fresh join.
 */
export const heartbeat = mutation({
  args: { code: v.string(), sessionId: v.string(), ...mediaArgs },
  handler: async (ctx, { code, sessionId: rawSessionId, micOn, camOn, sharing }) => {
    const sessionId = requireSessionId(rawSessionId);
    const { userId, user, nexaId } = await requireNexaUser(ctx);
    const norm = normalizeMeetingCode(code);
    const meeting = await findActiveMeeting(ctx.db, norm);
    if (meeting === null) return { ok: false as const, error: COPY.roomClosed };

    const now = Date.now();
    const planId =
      meeting.organizationId === undefined
        ? await getHostPlan(ctx.db, meeting.hostUserId)
        : await getOrganizationPlan(ctx.db, meeting.organizationId);
    const plan = PLANS[planId];
    if (pastTimeLimit(meeting, plan, now)) {
      return { ok: false as const, error: COPY.meetingTimeLimit };
    }

    const row = await ctx.db
      .query("participants")
      .withIndex("by_meeting_session", (q) =>
        q.eq("meetingCode", norm).eq("sessionId", sessionId),
      )
      .unique();

    // Re-check authorization on every heartbeat: this is the reconnect path,
    // so membership removal or a lapsed subscription ends here too.
    const access = await canAccessMeeting(ctx.db, meeting, userId);
    if (!access.allowed) {
      if (row !== null && row.userId === userId) {
        await ctx.db.delete(row._id);
      }
      return { ok: false as const, error: access.reason };
    }

    if (row !== null) {
      if (row.userId !== userId) {
        return { ok: false as const, error: COPY.roomClosed };
      }
      await ctx.db.patch(row._id, { lastSeenAt: now });
    } else {
      const count = await countParticipants(ctx.db, norm, plan.maxParticipants);
      if (plan.maxParticipants !== null && count >= plan.maxParticipants) {
        return { ok: false as const, error: COPY.meetingFull };
      }
      await ctx.db.insert("participants", {
        meetingCode: norm,
        userId,
        sessionId,
        nexaId,
        displayName: user.name || undefined,
        joinedAt: now,
        lastSeenAt: now,
        micOn,
        camOn,
        sharing,
      });
      console.log("[meeting] participant rejoined", { code: norm, nexaId });
    }
    if (meeting.emptySince !== undefined || meeting.startedAt === undefined) {
      await ctx.db.patch(meeting._id, {
        emptySince: undefined,
        ...(meeting.startedAt === undefined ? { startedAt: now } : {}),
      });
    }
    return { ok: true as const };
  },
});

/** Immediate mute/camera/screen-share state for the roster. */
export const setMediaState = mutation({
  args: { code: v.string(), sessionId: v.string(), ...mediaArgs },
  handler: async (ctx, { code, sessionId: rawSessionId, micOn, camOn, sharing }) => {
    const sessionId = requireSessionId(rawSessionId);
    const { userId } = await requireUser(ctx);
    const norm = normalizeMeetingCode(code);
    const row = await ctx.db
      .query("participants")
      .withIndex("by_meeting_session", (q) =>
        q.eq("meetingCode", norm).eq("sessionId", sessionId),
      )
      .unique();
    if (row === null || row.userId !== userId) return;
    await ctx.db.patch(row._id, { micOn, camOn, sharing, lastSeenAt: Date.now() });
  },
});

/** Leave: drop my seat, my in-flight signals, and close the room if I was last. */
export const leave = mutation({
  args: { code: v.string(), sessionId: v.string() },
  handler: async (ctx, { code, sessionId: rawSessionId }) => {
    const sessionId = requireSessionId(rawSessionId);
    const { userId, nexaId } = await requireNexaUser(ctx);
    const norm = normalizeMeetingCode(code);

    const row = await ctx.db
      .query("participants")
      .withIndex("by_meeting_session", (q) =>
        q.eq("meetingCode", norm).eq("sessionId", sessionId),
      )
      .unique();
    if (row !== null && row.userId === userId) {
      await ctx.db.delete(row._id);
      console.log("[meeting] participant left", { code: norm, nexaId });
    }

    // Drop signalling rows addressed to or from this session — they only
    // matter while that session is alive.
    const signals = await ctx.db
      .query("signals")
      .withIndex("by_meeting", (q) => q.eq("meetingCode", norm))
      .filter((q) =>
        q.or(
          q.eq(q.field("toSessionId"), sessionId),
          q.eq(q.field("fromSessionId"), sessionId),
        ),
      )
      .take(100);
    for (const s of signals) await ctx.db.delete(s._id);

    const remaining = await countParticipants(ctx.db, norm, null);
    if (remaining === 0) {
      const meeting = await findActiveMeeting(ctx.db, norm);
      if (meeting !== null) {
        // Room is empty: start the grace clock. The per-minute sweeper
        // (cleanup.stale) closes it once the grace period elapses, so the
        // creator can hand out the link for a few minutes after leaving.
        await ctx.db.patch(meeting._id, { emptySince: Date.now() });
      }
    }
    return { ok: true as const };
  },
});
