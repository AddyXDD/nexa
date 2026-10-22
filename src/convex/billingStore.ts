import { v } from "convex/values";
import {
  CHECKOUT_PLANS,
  paidPlanFromCheckoutId,
  PLANS,
  RAZORPAY_PLAN,
} from "../shared/constants";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { enforceRateLimit, requireUser } from "./utils";

/**
 * Persistent billing records — deliberately kept apart from temporary
 * meeting state. A payment row is a financial record tied to an account;
 * nothing here describes what happened in any meeting.
 */

/** Created by the createOrder action before checkout opens. */
export const recordOrder = internalMutation({
  args: {
    userId: v.id("users"),
    orderId: v.string(),
    amount: v.number(),
    currency: v.string(),
    planId: v.string(),
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (
    ctx,
    { userId, orderId, amount, currency, planId, organizationId },
  ) => {
    await ctx.db.insert("payments", {
      userId,
      razorpayOrderId: orderId,
      amount,
      currency,
      planId,
      status: "created",
      createdAt: Date.now(),
      ...(organizationId === undefined ? {} : { organizationId }),
    });
  },
});

/** Ownership lookup used during server-side signature verification. */
export const getOrder = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const row = await ctx.db
      .query("payments")
      .withIndex("by_orderId", (q) => q.eq("razorpayOrderId", orderId))
      .unique();
    if (row === null) return null;
    return { orderId: row.razorpayOrderId, userId: row.userId, status: row.status };
  },
});

/** Mark an order paid — only reachable after HMAC verification succeeds. */
export const markPaid = internalMutation({
  args: { orderId: v.string(), paymentId: v.string() },
  handler: async (ctx, { orderId, paymentId }) => {
    const row = await ctx.db
      .query("payments")
      .withIndex("by_orderId", (q) => q.eq("razorpayOrderId", orderId))
      .unique();
    if (row === null) return { ok: false as const };

    if (row.organizationId !== undefined) {
      // Keep the stored snapshot aligned with the entitlement that was just
      // purchased. Enforcement still derives seats from this payment.
      const planId = paidPlanFromCheckoutId(row.planId);
      const organization = await ctx.db.get(row.organizationId);
      if (planId !== null && organization !== null) {
        await ctx.db.patch(organization._id, {
          seatLimit: PLANS[planId].organizationSeats,
          updatedAt: Date.now(),
        });
      }
    }

    if (row.status !== "paid") {
      await ctx.db.patch(row._id, {
        status: "paid",
        paidAt: Date.now(),
        razorpayPaymentId: paymentId,
      });
    }
    return { ok: true as const };
  },
});

/**
 * Operator grant — support handing an account a paid plan without a
 * Razorpay checkout (complimentary access, comped renewal, offline payment).
 *
 * `internal`, so no client can ever call it: it is reachable only from the
 * CLI against this deployment (`bunx convex run billingStore:grantPlanByEmail
 * '{"email":...,"planId":"enterprise"}'`). The row it inserts is shape-for-
 * shape what `markPaid` leaves after a real purchase, so `status` reads it as
 * an ordinary personal entitlement — no billing code paths change.
 */
export const grantPlanByEmail = internalMutation({
  args: {
    email: v.string(),
    planId: v.union(v.literal("business"), v.literal("enterprise")),
  },
  handler: async (ctx, { email, planId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (user === null) {
      return { ok: false as const, reason: `No account is signed in as ${email}.` };
    }

    const plan = CHECKOUT_PLANS[planId];
    const now = Date.now();
    await ctx.db.insert("payments", {
      userId: user._id,
      // Not a Razorpay id — unique per grant, so a repeated grant can never
      // collide with an order or with another grant.
      razorpayOrderId: `grant-${now.toString(36)}-${user._id.slice(-6)}`,
      amount: plan.amountPaise,
      currency: plan.currency,
      planId: plan.id,
      status: "paid",
      createdAt: now,
      paidAt: now,
    });
    console.log("[billing] plan granted by operator", { email, planId });
    return {
      ok: true as const,
      userId: user._id,
      planId,
      activeUntil: now + plan.billingPeriodDays * 86_400_000,
    };
  },
});

/** Sliding-window limit on checkout starts, called from the action. */
export const consumeOrderRateLimit = internalMutation({
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

/**
 * Billing status for the signed-in account: plan, whether it's currently
 * active, and the account's payment history.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    const configured = Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
    );

    const rows = await ctx.db
      .query("payments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);

    // Organization purchases are not personal entitlements, even for the
    // member who paid for them.
    const latestPaid = rows.find(
      (r) =>
        r.status === "paid" &&
        r.paidAt !== undefined &&
        r.organizationId === undefined,
    );
    const personalPlanId = latestPaid
      ? paidPlanFromCheckoutId(latestPaid.planId)
      : null;
    const personalPlan =
      personalPlanId === null ? null : CHECKOUT_PLANS[personalPlanId];
    const activeUntil =
      latestPaid?.paidAt && personalPlan
        ? latestPaid.paidAt + personalPlan.billingPeriodDays * 86_400_000
        : null;

    return {
      configured,
      planId: personalPlanId,
      plan: {
        id: personalPlan?.id ?? RAZORPAY_PLAN.id,
        name: personalPlan?.name ?? RAZORPAY_PLAN.name,
        description: personalPlan?.description ?? RAZORPAY_PLAN.description,
        amountPaise: personalPlan?.amountPaise ?? RAZORPAY_PLAN.amountPaise,
        currency: personalPlan?.currency ?? RAZORPAY_PLAN.currency,
        billingPeriodDays:
          personalPlan?.billingPeriodDays ?? RAZORPAY_PLAN.billingPeriodDays,
      },
      activeUntil,
      active: activeUntil !== null && activeUntil > Date.now(),
      payments: rows.map((row) => ({
        id: row._id,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        createdAt: row.createdAt,
        paidAt: row.paidAt ?? null,
      })),
    };
  },
});
