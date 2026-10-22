import { ConvexError, v } from "convex/values";
import { MAX_DISPLAY_NAME_LENGTH } from "../shared/constants";
import { mutation } from "./_generated/server";
import { enforceRateLimit, requireUser, uniqueNexaId } from "./utils";

/**
 * Nexa identity.
 *
 * A Nexa ID (NX-7F42K9) is generated once per account, server-side, from a
 * CSPRNG — never derived from email, name, or any other personal data. It is
 * the only identity other participants are ever shown.
 */

/** Idempotent: assigns the Nexa ID on first sign-in. Safe to call often. */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId, user } = await requireUser(ctx);
    if (user.nexaId) return user.nexaId;
    const nexaId = await uniqueNexaId(ctx.db);
    await ctx.db.patch(userId, { nexaId, nexaIdAssignedAt: Date.now() });
    return nexaId;
  },
});

/** Optional display name shown alongside (never instead of) the Nexa ID. */
export const setDisplayName = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const { userId, user } = await requireUser(ctx);
    await enforceRateLimit(ctx, `name:${userId}`, 10, 60_000);
    const trimmed = name.trim().replace(/\s+/g, " ").slice(0, MAX_DISPLAY_NAME_LENGTH);
    if (trimmed.length > 0 && trimmed.length < 2) {
      throw new ConvexError("Display name must be at least 2 characters.");
    }
    await ctx.db.patch(userId, { name: trimmed.length > 0 ? trimmed : undefined });
    // Keep live presence rows in sync so the room updates immediately.
    const rows = await ctx.db
      .query("participants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(64);
    for (const row of rows) {
      await ctx.db.patch(row._id, { displayName: trimmed || undefined });
    }
    return user.nexaId ?? null;
  },
});
