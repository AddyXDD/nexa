import { v } from "convex/values";
import {
  CHAT_RETENTION_MS,
  ENDED_MEETING_RETENTION_MS,
  MEETING_EMPTY_GRACE_MS,
  PARTICIPANT_STALE_MS,
  PLANS,
  SIGNAL_RETENTION_MS,
} from "../shared/constants";
import type { GenericDatabaseWriter } from "convex/server";
import { mutation } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import { findActiveMeeting, getHostPlan } from "./utils";

/**
 * Privacy cleanup — the "Forget" half of Nexa.
 *
 * Temporary meeting state (roster, signals, chat) is destroyed as soon as a
 * room is no longer needed. One scheduled sweeper runs every minute (crons.ts)
 * and handles everything deferred:
 *
 *  - rooms empty longer than the grace period → state destroyed, room closed
 *  - ghost participants (no heartbeat, e.g. crashed tab) → seat released
 *  - expired signalling rows and rate-limit counters → deleted
 *  - ended meeting rows past retention → deleted (no meeting history)
 */

type Db = GenericDatabaseWriter<DataModel>;

/** Delete everything ephemeral about a room and mark it inactive. */
async function destroyMeetingState(db: Db, code: string): Promise<boolean> {
  const meeting = await findActiveMeeting(db, code);
  if (meeting === null) return false;

  const participants = await db
    .query("participants")
    .withIndex("by_meeting", (q) => q.eq("meetingCode", code))
    .take(64);
  for (const p of participants) await db.delete(p._id);

  const signals = await db
    .query("signals")
    .withIndex("by_meeting", (q) => q.eq("meetingCode", code))
    .take(400);
  for (const s of signals) await db.delete(s._id);

  const chat = await db
    .query("chatMessages")
    .withIndex("by_meeting_sentAt", (q) => q.eq("meetingCode", code))
    .take(400);
  for (const c of chat) await db.delete(c._id);

  await db.patch(meeting._id, {
    active: false,
    endedAt: Date.now(),
    emptySince: undefined,
  });
  console.log("[meeting] ended, temporary state destroyed", { code });
  return true;
}

/**
 * Close a room that has been empty past the grace period. Idempotent: it
 * re-checks occupancy, so a room someone rejoined is never closed.
 * (The grace window is enforced by the caller — the cron — which runs every
 * minute, so the empty-grace is accurate to within a minute.)
 */
export const endIfEmpty = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const meeting = await findActiveMeeting(ctx.db, code);
    if (meeting === null) return { ended: false as const };

    const remaining = await ctx.db
      .query("participants")
      .withIndex("by_meeting", (q) => q.eq("meetingCode", code))
      .take(1);
    if (remaining.length > 0) {
      if (meeting.emptySince !== undefined) {
        await ctx.db.patch(meeting._id, { emptySince: undefined });
      }
      return { ended: false as const };
    }

    const emptySince = meeting.emptySince ?? Date.now();
    if (Date.now() - emptySince < MEETING_EMPTY_GRACE_MS) {
      return { ended: false as const }; // cron retries next tick
    }
    return { ended: await destroyMeetingState(ctx.db, code) };
  },
});

/** Every-minute sweep of stale, expired, and abandoned ephemeral rows. */
export const stale = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let swept = 0;
    const emptied = new Set<string>();

    // 1. Ghost participants: no heartbeat for > PARTICIPANT_STALE_MS.
    const ghosts = await ctx.db
      .query("participants")
      .withIndex("by_lastSeen", (q) =>
        q.lt("lastSeenAt", now - PARTICIPANT_STALE_MS),
      )
      .take(100);
    for (const ghost of ghosts) {
      console.log("[meeting] participant swept (stale heartbeat)", {
        code: ghost.meetingCode,
        nexaId: ghost.nexaId,
      });
      await ctx.db.delete(ghost._id);
      emptied.add(ghost.meetingCode);
      swept++;
    }

    // 2. Meeting rows: end abandoned and time-expired rooms, drop ended rows
    //    past retention, and stamp rooms that a sweep just emptied.
    const meetings = await ctx.db.query("meetings").take(200);
    for (const meeting of meetings) {
      if (!meeting.active) {
        if (
          meeting.endedAt !== undefined &&
          now - meeting.endedAt > ENDED_MEETING_RETENTION_MS
        ) {
          await ctx.db.delete(meeting._id);
          swept++;
        }
        continue;
      }

      if (emptied.has(meeting.code)) {
        const remaining = await ctx.db
          .query("participants")
          .withIndex("by_meeting", (q) => q.eq("meetingCode", meeting.code))
          .take(1);
        if (remaining.length === 0 && meeting.emptySince === undefined) {
          await ctx.db.patch(meeting._id, { emptySince: now });
        }
      }

      // Rooms that outstayed the host's plan: the meeting-length limit
      // (2h Free / 8h Business) counts from the first seat taken. Closing
      // here releases everyone still inside and destroys the room state.
      if (meeting.startedAt !== undefined) {
        const plan = PLANS[await getHostPlan(ctx.db, meeting.hostUserId)];
        const hours = plan.maxMeetingHours;
        if (hours !== null && now - meeting.startedAt > hours * 3_600_000) {
          if (await destroyMeetingState(ctx.db, meeting.code)) swept++;
          continue;
        }
      }

      if (
        meeting.emptySince !== undefined &&
        now - meeting.emptySince >= MEETING_EMPTY_GRACE_MS
      ) {
        if (await destroyMeetingState(ctx.db, meeting.code)) swept++;
      }
    }

    // 3. Expired signalling rows (they only matter during connect).
    const oldSignals = await ctx.db
      .query("signals")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", now - SIGNAL_RETENTION_MS))
      .take(200);
    for (const s of oldSignals) {
      await ctx.db.delete(s._id);
      swept++;
    }

    // 4. Chat rows in rooms that somehow stayed alive for half a day.
    const oldChat = await ctx.db
      .query("chatMessages")
      .withIndex("by_sentAt", (q) => q.lt("sentAt", now - CHAT_RETENTION_MS))
      .take(200);
    for (const c of oldChat) {
      await ctx.db.delete(c._id);
      swept++;
    }

    // 5. Expired rate-limit counters.
    const limits = await ctx.db.query("rateLimits").take(200);
    for (const rl of limits) {
      if (now - rl.windowStart > 60 * 60_000) {
        await ctx.db.delete(rl._id);
        swept++;
      }
    }

    if (swept > 0) console.log("[cleanup] swept ephemeral rows", { swept });
    return { swept };
  },
});
