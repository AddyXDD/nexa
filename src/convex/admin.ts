import type { GenericDatabaseReader } from "convex/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { PLANS } from "../shared/constants";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { MEETINGS_CREATED_COUNTER, readCounter, requireAdmin } from "./utils";

/**
 * Admin read surface.
 *
 * Every function here takes a bearer token issued by adminAuth.login and
 * runs it through `requireAdmin`, so authorisation lives in exactly one
 * place and cannot be forgotten by a new query. There is no session of the
 * customer's making that can open these: an admin is not a `users` row.
 *
 * Reads only — nothing here can mutate an account, change a role, or touch
 * a payment. Admin is an observation deck, not a control panel.
 */

/** A seat counts as live while its heartbeat is younger than this. */
const LIVE_WINDOW_MS = 2 * 60_000;
const DAY_MS = 86_400_000;

type Plan = keyof typeof PLANS;

/** Which plan a user's most recent settled payment puts them on. */
function planFor(paidAt: number | undefined): Plan {
  if (paidAt === undefined) return "free";
  const until = paidAt + PLANS.business.billingPeriodDays * DAY_MS;
  return until > Date.now() ? "business" : "free";
}

/** Newest `paidAt` that still stands, i.e. the one that sets the plan. */
function latestPaidAt(
  payments: ReadonlyArray<{ status: string; paidAt?: number }>,
): number | undefined {
  return payments
    .filter((row) => row.status === "paid" && row.paidAt !== undefined)
    .map((row) => row.paidAt as number)
    .sort((a, b) => b - a)[0];
}

type Row = {
  userId: string;
  nexaId: string | null;
  displayName: string | null;
  meetingCode: string;
  lastSeenAt: number;
};

/** Distinct accounts holding a seat right now, newest heartbeat first. */
async function activeAccounts(
  db: GenericDatabaseReader<DataModel>,
): Promise<{ count: number; rooms: number; rows: Row[] }> {
  const cutoff = Date.now() - LIVE_WINDOW_MS;
  const live = await db
    .query("participants")
    .withIndex("by_lastSeen", (q) => q.gte("lastSeenAt", cutoff))
    .collect();

  const byUser = new Map<string, Row>();
  for (const row of live) {
    const existing = byUser.get(row.userId);
    if (existing === undefined || row.lastSeenAt > existing.lastSeenAt) {
      byUser.set(row.userId, {
        userId: row.userId,
        nexaId: row.nexaId,
        displayName: row.displayName ?? null,
        meetingCode: row.meetingCode,
        lastSeenAt: row.lastSeenAt,
      });
    }
  }
  const rows = [...byUser.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return {
    count: rows.length,
    rooms: new Set(live.map((row) => row.meetingCode)).size,
    rows,
  };
}

/**
 * The dashboard's headline numbers. One round trip so the tiles and the
 * tables can never disagree about "how many users are there".
 */
export const overview = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    await requireAdmin(ctx, token);
    const now = Date.now();

    const users = await ctx.db.query("users").collect();
    const payments = await ctx.db.query("payments").collect();
    const active = await activeAccounts(ctx.db);

    const settled = payments.filter((row) => row.status === "paid");
    const revenuePaise = settled.reduce(
      (sum, row) => sum + (row.paidAt !== undefined ? row.amount : 0),
      0,
    );

    const paidByUser = new Map<string, number>();
    for (const row of settled) {
      if (row.paidAt === undefined) continue;
      const previous = paidByUser.get(row.userId) ?? 0;
      if (row.paidAt > previous) paidByUser.set(row.userId, row.paidAt);
    }

    let subscribed = 0;
    for (const paidAt of paidByUser.values()) {
      if (planFor(paidAt) === "business") subscribed++;
    }

    const seenRecently = new Set<string>();
    for (const row of await ctx.db
      .query("participants")
      .withIndex("by_lastSeen", (q) => q.gte("lastSeenAt", now - DAY_MS))
      .collect()) {
      seenRecently.add(row.userId);
    }

    const meetings = await ctx.db.query("meetings").collect();
    const held = await readCounter(ctx.db, MEETINGS_CREATED_COUNTER);

    return {
      users: {
        total: users.length,
        guests: users.filter((user) => user.isAnonymous === true).length,
        accounts: users.filter((user) => user.isAnonymous !== true).length,
        live: active.count,
        liveRooms: active.rooms,
        seenToday: seenRecently.size,
        admins: users.filter((user) => user.role === "admin").length,
      },
      meetings: {
        // `total` is what still exists as a row (live rooms, plus ended ones
        // the sweeper has not reached yet). It is not a lifetime figure and
        // never was: rooms are deleted when they end. `lifetime` is the
        // counter, and is the only number that answers "how many meetings
        // have been held since launch".
        total: meetings.length,
        active: meetings.filter((meeting) => meeting.active).length,
        lifetime: held.value,
        since: held.since,
      },
      payments: {
        total: payments.length,
        paid: settled.length,
        initiated: payments.filter((row) => row.status === "created").length,
        revenuePaise,
        subscribers: subscribed,
      },
      liveNow: active.rows.slice(0, 12),
    };
  },
});

/** Newest accounts first, with each one's plan and last sighting. */
export const users = query({
  args: { token: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { token, paginationOpts }) => {
    await requireAdmin(ctx, token);

    const payments = await ctx.db.query("payments").collect();
    const paidByUser = new Map<string, number>();
    for (const row of payments) {
      if (row.status !== "paid" || row.paidAt === undefined) continue;
      const previous = paidByUser.get(row.userId) ?? 0;
      if (row.paidAt > previous) paidByUser.set(row.userId, row.paidAt);
    }

    const countsByUser = new Map<string, number>();
    for (const row of payments) {
      countsByUser.set(row.userId, (countsByUser.get(row.userId) ?? 0) + 1);
    }

    const since = new Map<string, number>();
    for (const row of await ctx.db.query("participants").collect()) {
      const previous = since.get(row.userId) ?? 0;
      if (row.lastSeenAt > previous) since.set(row.userId, row.lastSeenAt);
    }

    const page = await ctx.db.query("users").order("desc").paginate(paginationOpts);

    return {
      ...page,
      page: page.page.map((user) => {
        const paidAt = paidByUser.get(user._id);
        return {
          id: user._id,
          name: user.name ?? null,
          email: user.email ?? null,
          nexaId: user.nexaId ?? null,
          isAnonymous: user.isAnonymous === true,
          role: user.role ?? null,
          createdAt: user._creationTime,
          lastSeenAt: since.get(user._id) ?? null,
          plan: planFor(paidAt),
          planPaidAt: paidAt ?? null,
          paymentCount: countsByUser.get(user._id) ?? 0,
        };
      }),
    };
  },
});

/** One account in full: identity, plan, payments, rooms it has opened. */
export const user = query({
  args: { token: v.optional(v.string()), userId: v.id("users") },
  handler: async (ctx, { token, userId }) => {
    await requireAdmin(ctx, token);
    const account = await ctx.db.get(userId);
    if (account === null) return null;

    const payments = await ctx.db
      .query("payments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    const paidAt = latestPaidAt(payments);
    const seats = await ctx.db
      .query("participants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);

    const hosted = await ctx.db
      .query("meetings")
      .filter((q) => q.eq(q.field("hostUserId"), userId))
      .collect();

    return {
      id: account._id,
      name: account.name ?? null,
      email: account.email ?? null,
      nexaId: account.nexaId ?? null,
      image: account.image ?? null,
      isAnonymous: account.isAnonymous === true,
      role: account.role ?? null,
      emailVerified: account.emailVerificationTime !== undefined,
      createdAt: account._creationTime,
      plan: planFor(paidAt),
      planPaidAt: paidAt ?? null,
      lifetimePaise: payments
        .filter((row) => row.status === "paid")
        .reduce((sum, row) => sum + (row.paidAt !== undefined ? row.amount : 0), 0),
      lastSeenAt: seats.reduce<number | null>(
        (latest, seat) =>
          latest === null || seat.lastSeenAt > latest ? seat.lastSeenAt : latest,
        null,
      ),
      liveNow: seats.some(
        (seat) => Date.now() - seat.lastSeenAt < LIVE_WINDOW_MS,
      ),
      roomsHosted: hosted.length,
      roomsLive: hosted.filter((meeting) => meeting.active).length,
      payments: payments.map((row) => ({
        id: row._id,
        orderId: row.razorpayOrderId,
        paymentId: row.razorpayPaymentId ?? null,
        amount: row.amount,
        currency: row.currency,
        planId: row.planId,
        status: row.status,
        createdAt: row.createdAt,
        paidAt: row.paidAt ?? null,
      })),
      recentSeats: seats.map((seat) => ({
        id: seat._id,
        nexaId: seat.nexaId,
        displayName: seat.displayName ?? null,
        meetingCode: seat.meetingCode,
        joinedAt: seat.joinedAt,
        lastSeenAt: seat.lastSeenAt,
      })),
    };
  },
});

/** Newest payments first, joined to the account that made them. */
export const payments = query({
  args: { token: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { token, paginationOpts }) => {
    await requireAdmin(ctx, token);

    const accounts = new Map<string, { name: string | null; email: string | null }>();
    for (const account of await ctx.db.query("users").collect()) {
      accounts.set(account._id, {
        name: account.name ?? null,
        email: account.email ?? null,
      });
    }

    const page = await ctx.db
      .query("payments")
      .withIndex("by_createdAt")
      .order("desc")
      .paginate(paginationOpts);

    return {
      ...page,
      page: page.page.map((row) => ({
        id: row._id,
        userId: row.userId,
        user: accounts.get(row.userId) ?? { name: null, email: null },
        orderId: row.razorpayOrderId,
        amount: row.amount,
        currency: row.currency,
        planId: row.planId,
        status: row.status,
        createdAt: row.createdAt,
        paidAt: row.paidAt ?? null,
      })),
    };
  },
});
