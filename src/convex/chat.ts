import { ConvexError, v } from "convex/values";
import type { GenericDatabaseReader } from "convex/server";
import {
  CHAT_LIST_LIMIT,
  CHAT_PEER_SCAN_LIMIT,
  CHAT_SEND_LIMIT,
  COPY,
  MAX_CHAT_LENGTH,
  normalizeMeetingCode,
  PARTICIPANT_STALE_MS,
} from "../shared/constants";
import type { ChatMessage, DirectPeer } from "../shared/types";
import type { DataModel } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  enforceRateLimit,
  findActiveMeeting,
  getParticipant,
  requireNexaUser,
  requireSessionId,
  requireUser,
} from "./utils";

/**
 * Temporary meeting chat: one room-wide channel and one-to-one direct
 * messages, both of which exist only while the room is alive.
 *
 * Privacy model: a direct message is stored under a `dmPair` index covering
 * exactly the two sessions involved, and the room transcript is only ever
 * read through `scope = "everyone"`. Neither query can return the other's
 * rows, so isolation is a property of the indexes rather than of a filter
 * somebody could later get wrong. Everything is deleted with the room.
 */

/** Fixed order so both sides of a conversation derive the same key. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function toMessage(row: {
  _id: string;
  sessionId: string;
  nexaId: string;
  displayName?: string;
  text: string;
  sentAt: number;
  scope?: "everyone" | "dm";
  toSessionId?: string;
  toNexaId?: string;
  toDisplayName?: string;
}): ChatMessage {
  return {
    id: row._id,
    sessionId: row.sessionId,
    nexaId: row.nexaId,
    displayName: row.displayName ?? null,
    text: row.text,
    sentAt: row.sentAt,
    scope: row.scope ?? "everyone",
    ...(row.toSessionId ? { toSessionId: row.toSessionId } : {}),
    ...(row.toNexaId ? { toNexaId: row.toNexaId } : {}),
    ...(row.toDisplayName ? { toDisplayName: row.toDisplayName } : {}),
  };
}

/** Visible only to people currently holding a seat in the room. */
export const list = query({
  args: { code: v.string(), sessionId: v.string() },
  handler: async (ctx, { code, sessionId: rawSessionId }) => {
    const sessionId = requireSessionId(rawSessionId);
    const { userId } = await requireUser(ctx);
    const norm = normalizeMeetingCode(code);
    const meeting = await findActiveMeeting(ctx.db, norm);
    if (meeting === null) return null;
    const seat = await getParticipant(ctx.db, norm, userId, sessionId);
    if (seat === null) return [];
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_meeting_scope_sentAt", (q) =>
        q.eq("meetingCode", norm).eq("scope", "everyone"),
      )
      .order("desc")
      .take(CHAT_LIST_LIMIT);
    rows.reverse();
    return rows.map(toMessage);
  },
});

/** One-to-one thread between the caller and a single other participant. */
export const listDirect = query({
  args: {
    code: v.string(),
    sessionId: v.string(),
    peerSessionId: v.string(),
  },
  handler: async (ctx, { code, sessionId: rawSessionId, peerSessionId: rawPeer }) => {
    const sessionId = requireSessionId(rawSessionId);
    const peerSessionId = requireSessionId(rawPeer);
    const { userId } = await requireUser(ctx);
    const norm = normalizeMeetingCode(code);
    const meeting = await findActiveMeeting(ctx.db, norm);
    if (meeting === null) return null;
    const seat = await getParticipant(ctx.db, norm, userId, sessionId);
    if (seat === null) return [];
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_meeting_pair_sentAt", (q) =>
        q
          .eq("meetingCode", norm)
          .eq("dmPair", pairKey(sessionId, peerSessionId)),
      )
      .order("desc")
      .take(CHAT_LIST_LIMIT);
    rows.reverse();
    return rows.map(toMessage);
  },
});

/**
 * Everyone the caller has a direct-message thread with, newest first —
 * including people who have already left, so a thread never goes missing
 * while its room is still open.
 */
export const directPeers = query({
  args: { code: v.string(), sessionId: v.string() },
  handler: async (ctx, { code, sessionId: rawSessionId }) => {
    const sessionId = requireSessionId(rawSessionId);
    const { userId } = await requireUser(ctx);
    const norm = normalizeMeetingCode(code);
    const meeting = await findActiveMeeting(ctx.db, norm);
    if (meeting === null) return null;
    const seat = await getParticipant(ctx.db, norm, userId, sessionId);
    if (seat === null) return [];

    // Room roster, so threads can be labelled present or departed.
    const present = new Map<string, { nexaId: string; name: string | null }>();
    const rows = await ctx.db
      .query("participants")
      .withIndex("by_meeting", (q) => q.eq("meetingCode", norm))
      .take(32);
    const now = Date.now();
    for (const row of rows) {
      if (now - row.lastSeenAt > PARTICIPANT_STALE_MS) continue;
      present.set(row.sessionId, {
        nexaId: row.nexaId,
        name: row.displayName ?? null,
      });
    }

    const threads = new Map<
      string,
      { lastSentAt: number; nexaId: string; displayName: string | null }
    >();
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_meeting_pair_sentAt", (q) => q.eq("meetingCode", norm))
      .order("desc")
      .take(CHAT_PEER_SCAN_LIMIT);
    for (const row of messages) {
      const [a, b] = (row.dmPair ?? "").split("|");
      const peerSessionId = a === sessionId ? b : b === sessionId ? a : null;
      if (peerSessionId === null || peerSessionId === "") continue;
      const seen = threads.get(peerSessionId);
      // Ordered newest-first, so the first hit carries the best snapshot.
      if (seen !== undefined) continue;
      const inRoom = present.get(peerSessionId);
      threads.set(peerSessionId, {
        lastSentAt: row.sentAt,
        nexaId: inRoom?.nexaId ?? toPeerNexaId(row, sessionId, peerSessionId),
        displayName:
          inRoom?.name ??
          (row.sessionId === sessionId ? row.toDisplayName : row.displayName) ??
          null,
      });
    }

    return [...threads.entries()]
      .map(
        ([peerSessionId, thread]): DirectPeer => ({
          sessionId: peerSessionId,
          nexaId: thread.nexaId,
          displayName: thread.displayName,
          lastSentAt: thread.lastSentAt,
          inRoom: present.has(peerSessionId),
        }),
      )
      .sort((a, b) => b.lastSentAt - a.lastSentAt);
  },
});

/** The addressee's Nexa ID, whichever side of the thread this row is. */
function toPeerNexaId(
  row: { sessionId: string; nexaId: string; toNexaId?: string },
  sessionId: string,
  peerSessionId: string,
): string {
  if (row.sessionId === sessionId) return row.toNexaId ?? "";
  return row.nexaId;
}

/** The addressee's seat, validated so a direct message can only ever be
 *  read by the two people who wrote it. */
async function resolvePeer(
  db: GenericDatabaseReader<DataModel>,
  meetingCode: string,
  peerSessionId: string,
) {
  return await db
    .query("participants")
    .withIndex("by_meeting_session", (q) =>
      q.eq("meetingCode", meetingCode).eq("sessionId", peerSessionId),
    )
    .unique();
}

export const send = mutation({
  args: {
    code: v.string(),
    sessionId: v.string(),
    text: v.string(),
    /** Present = direct message to that one participant, absent = the room. */
    toSessionId: v.optional(v.string()),
  },
  handler: async (ctx, { code, sessionId: rawSessionId, text, toSessionId }) => {
    const sessionId = requireSessionId(rawSessionId);
    const { userId, user, nexaId } = await requireNexaUser(ctx);
    const norm = normalizeMeetingCode(code);
    const meeting = await findActiveMeeting(ctx.db, norm);
    if (meeting === null) throw new ConvexError(COPY.meetingGone);

    const seat = await getParticipant(ctx.db, norm, userId, sessionId);
    if (seat === null) throw new ConvexError("Not a participant in this meeting.");

    const direct = toSessionId !== undefined;
    if (direct && requireSessionId(toSessionId) === sessionId) {
      throw new ConvexError(COPY.chatDmSelf);
    }

    // Room and direct traffic are counted separately so a busy thread can't
    // be used to push past the limit by spreading sends around.
    await enforceRateLimit(
      ctx,
      direct ? `chat:dm:${sessionId}` : `chat:${sessionId}`,
      CHAT_SEND_LIMIT.max,
      CHAT_SEND_LIMIT.windowMs,
      "You're sending messages too quickly.",
    );

    const cleaned = text.replace(/\s+/g, " ").trim();
    if (cleaned.length === 0) return { ok: false as const };
    if (cleaned.length > MAX_CHAT_LENGTH) {
      throw new ConvexError(`Messages are limited to ${MAX_CHAT_LENGTH} characters.`);
    }

    if (!direct) {
      await ctx.db.insert("chatMessages", {
        meetingCode: norm,
        sessionId,
        userId,
        nexaId,
        displayName: user.name || undefined,
        text: cleaned,
        sentAt: Date.now(),
        scope: "everyone",
      });
      return { ok: true as const, scope: "everyone" as const };
    }

    const peerSessionId = requireSessionId(toSessionId);
    const peer = await resolvePeer(ctx.db, norm, peerSessionId);
    if (peer === null) throw new ConvexError(COPY.chatDmNotInRoom);
    if (Date.now() - peer.lastSeenAt > PARTICIPANT_STALE_MS) {
      throw new ConvexError(COPY.chatDmNotInRoom);
    }

    await ctx.db.insert("chatMessages", {
      meetingCode: norm,
      sessionId,
      userId,
      nexaId,
      displayName: user.name || undefined,
      text: cleaned,
      sentAt: Date.now(),
      scope: "dm",
      toSessionId: peerSessionId,
      toNexaId: peer.nexaId,
      toDisplayName: peer.displayName,
      dmPair: pairKey(sessionId, peerSessionId),
    });
    return { ok: true as const, scope: "dm" as const };
  },
});
