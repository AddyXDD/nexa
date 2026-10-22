import { ConvexError, v } from "convex/values";
import { COPY, normalizeMeetingCode } from "../shared/constants";
import type { SignalKind } from "../shared/types";
import { mutation, query } from "./_generated/server";
import {
  enforceRateLimit,
  findActiveMeeting,
  getParticipant,
  requireSessionId,
  requireUser,
} from "./utils";

/**
 * WebRTC signalling over Convex's WebSocket connection.
 *
 * The server is a dumb, authenticated router: it validates that both ends
 * hold a live seat in the room, enforces size/rate limits, and never
 * interprets SDP. Offers/answers/ICE candidates are consumed by the addressee
 * and deleted; anything left behind expires on the sweeper.
 */

const MAX_PAYLOAD_BYTES = 128 * 1024;

const kindValidator = v.union(
  v.literal("offer"),
  v.literal("answer"),
  v.literal("candidate"),
  v.literal("renegotiate"),
  v.literal("reaction"),
  // E2EE public key announcement. The server relays the public key and
  // nothing else — it can never derive a media key from it.
  v.literal("e2ee"),
);

/** Reactions are tiny and ephemeral — hard cap keeps the transport clean. */
const MAX_REACTION_BYTES = 64;

function validatePayload(kind: SignalKind, payload: string) {
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new ConvexError("Signalling payload too large.");
  }
  if (kind === "renegotiate") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new ConvexError("Malformed signalling payload.");
  }
  if (kind === "reaction") {
    const { emoji } = parsed as { emoji?: unknown };
    if (
      typeof emoji !== "string" ||
      emoji.length === 0 ||
      emoji.length > 8 ||
      payload.length > MAX_REACTION_BYTES
    ) {
      throw new ConvexError("Malformed reaction.");
    }
    return;
  }
  if (kind === "e2ee") {
    const { pub } = parsed as { pub?: unknown };
    if (
      typeof pub !== "string" ||
      pub.length === 0 ||
      // An uncompressed P-256 point is 65 bytes → 88 base64 characters.
      // The cap keeps the transport clean without policing the exact size.
      pub.length > 256
    ) {
      throw new ConvexError("Malformed E2EE key.");
    }
    return;
  }
  if (kind === "offer" || kind === "answer") {
    const sdp = parsed as { type?: unknown; sdp?: unknown };
    if (
      typeof sdp.sdp !== "string" ||
      typeof sdp.type !== "string" ||
      !sdp.sdp.includes("v=0")
    ) {
      throw new ConvexError("Malformed SDP.");
    }
  } else if (typeof parsed !== "object" || parsed === null) {
    throw new ConvexError("Malformed ICE candidate.");
  }
}

/** My inbox: signalling messages addressed to this session in this room. */
export const inbox = query({
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
      .query("signals")
      .withIndex("by_meeting_to", (q) =>
        q.eq("meetingCode", norm).eq("toSessionId", sessionId),
      )
      .take(400);
    rows.sort((a, b) => a._creationTime - b._creationTime);
    return rows.map((row) => ({
      id: row._id,
      kind: row.kind,
      fromSessionId: row.fromSessionId,
      toSessionId: row.toSessionId,
      payload: row.payload,
      createdAt: row.createdAt,
    }));
  },
});

/** Send an offer/answer/ICE candidate to another live session. */
export const send = mutation({
  args: {
    code: v.string(),
    sessionId: v.string(),
    toSessionId: v.string(),
    kind: kindValidator,
    payload: v.string(),
  },
  handler: async (ctx, { code, sessionId: rawFrom, toSessionId: rawTo, kind, payload }) => {
    const fromSessionId = requireSessionId(rawFrom);
    const toSessionId = requireSessionId(rawTo);
    const { userId } = await requireUser(ctx);
    if (fromSessionId === toSessionId) return { ok: true as const };

    const norm = normalizeMeetingCode(code);
    const meeting = await findActiveMeeting(ctx.db, norm);
    if (meeting === null) throw new ConvexError(COPY.meetingGone);

    // Authorization: sender must hold a live seat in this room.
    const sender = await getParticipant(ctx.db, norm, userId, fromSessionId);
    if (sender === null) throw new ConvexError("Not a participant in this meeting.");

    // The recipient must be in the room too (routing by session handle only).
    const recipient = await ctx.db
      .query("participants")
      .withIndex("by_meeting", (q) => q.eq("meetingCode", norm))
      .filter((q) => q.eq(q.field("sessionId"), toSessionId))
      .take(1);
    if (recipient.length === 0) {
      return { ok: false as const }; // peer already gone — caller rebuilds later
    }

    validatePayload(kind, payload);
    await enforceRateLimit(
      ctx,
      `signal:${fromSessionId}`,
      900,
      10_000,
      "Signalling is rate-limited. Try again in a moment.",
    );

    await ctx.db.insert("signals", {
      meetingCode: norm,
      fromSessionId,
      toSessionId,
      kind,
      payload,
      createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Acknowledge processed messages so they leave the inbox. */
export const consume = mutation({
  args: {
    code: v.string(),
    sessionId: v.string(),
    ids: v.array(v.string()),
  },
  handler: async (ctx, { code, sessionId: rawSessionId, ids }) => {
    const sessionId = requireSessionId(rawSessionId);
    const { userId } = await requireUser(ctx);
    const norm = normalizeMeetingCode(code);
    const seat = await getParticipant(ctx.db, norm, userId, sessionId);
    if (seat === null) return { ok: false as const };

    for (const rawId of ids.slice(0, 100)) {
      const id = ctx.db.normalizeId("signals", rawId);
      if (id === null) continue;
      const doc = await ctx.db.get(id);
      if (
        doc !== null &&
        doc.meetingCode === norm &&
        doc.toSessionId === sessionId
      ) {
        await ctx.db.delete(id);
      }
    }
    return { ok: true as const };
  },
});
