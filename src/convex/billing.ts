import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  CHECKOUT_PLANS,
  isPaidPlanId,
  ORGANIZATIONS,
  PAYMENT_NOT_CONFIGURED,
} from "../shared/constants";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

/**
 * Razorpay checkout, server side.
 *
 * Flow (standard order + signature verification, no SDK):
 *   1. createOrder  → authenticates the caller, rate-limits, creates an order
 *                     on Razorpay's API, records it locally, returns the
 *                     public key id + order id for the checkout widget.
 *   2. the browser opens Razorpay Checkout and the user pays.
 *   3. verifyPayment → recomputes HMAC-SHA256(order_id + "|" + payment_id)
 *                     with the SECRET key and compares it to the signature
 *                     Razorpay handed the browser, then confirms ownership
 *                     of the order before marking it paid.
 *
 * Secrets (RAZORPAY_KEY_SECRET) never leave this server. The key id is
 * public by design and is safe to hand to the client.
 */

const RAZORPAY_API = "https://api.razorpay.com/v1";
const ORDER_ID_RE = /^order_[A-Za-z0-9]{8,64}$/;
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{8,64}$/;
const SIGNATURE_RE = /^[a-f0-9]{64}$/i;

function requirePaymentEnv() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new ConvexError(PAYMENT_NOT_CONFIGURED);
  return { keyId, keySecret };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish string comparison so signatures can't be probed. */
function signaturesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Minimal base64 for HTTP Basic auth (no Buffer/btoa dependency). */
const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === null ? "=" : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === null ? "=" : B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * Create a Razorpay order.
 *
 * The plan id is an enum, and the amount is looked up from the server-side
 * catalogue — a browser cannot ask for Enterprise at Business prices, or
 * attach a personal purchase to somebody else's workspace.
 *
 * `planId` defaults to Business so older clients keep working; a workspace
 * purchase additionally requires the caller to be its owner.
 */
export const createOrder = action({
  args: {
    planId: v.optional(
      v.union(v.literal("business"), v.literal("enterprise")),
    ),
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated.");
    const { keyId, keySecret } = requirePaymentEnv();
    const planId = args.planId ?? "business";
    if (!isPaidPlanId(planId)) throw new ConvexError("Unknown plan.");
    const plan = CHECKOUT_PLANS[planId];

    if (args.organizationId !== undefined) {
      const organization = await ctx.runQuery(
        internal.organizations.getForBilling,
        { organizationId: args.organizationId },
      );
      if (organization === null || organization.status !== "active") {
        throw new ConvexError(ORGANIZATIONS.notFound);
      }
      const membership = await ctx.runQuery(
        internal.organizations.getMembershipForEmail,
        { organizationId: args.organizationId, userId },
      );
      if (membership === null || membership.role !== "owner") {
        // Billing ownership follows the owner, never an admin who happens to
        // be signed in.
        throw new ConvexError(ORGANIZATIONS.forbidden);
      }
    }

    await ctx.runMutation(internal.billingStore.consumeOrderRateLimit, {
      key:
        args.organizationId === undefined
          ? `checkout:${userId}`
          : `checkout-org:${args.organizationId}`,
      max: 8,
      windowMs: 10 * 60_000,
      message: "You're starting checkouts too quickly. Please wait a moment.",
    });

    const response = await fetch(`${RAZORPAY_API}/orders`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${base64Encode(
          new TextEncoder().encode(`${keyId}:${keySecret}`),
        )}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: plan.amountPaise,
        currency: plan.currency,
        receipt: `nexa-${Date.now().toString(36)}`,
        notes: {
          plan: plan.id,
          ...(args.organizationId === undefined
            ? {}
            : { organizationId: args.organizationId }),
        },
      }),
    });

    if (!response.ok) {
      throw new ConvexError(
        "Razorpay couldn't start the checkout. Please try again shortly.",
      );
    }
    const order = (await response.json()) as {
      id: string;
      amount: number;
      currency: string;
    };

    // Razorpay echoes the amount it accepted. Refuse a mismatch rather than
    // record an order whose amount is not the plan's price.
    if (order.amount !== plan.amountPaise) {
      throw new ConvexError(
        "Razorpay returned an unexpected amount. Nothing was charged.",
      );
    }

    await ctx.runMutation(internal.billingStore.recordOrder, {
      userId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planId: plan.id,
      ...(args.organizationId === undefined
        ? {}
        : { organizationId: args.organizationId }),
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
      planId,
      planName: plan.name,
    };
  },
});

/** Verify Razorpay's payment signature and mark the order paid. */
export const verifyPayment = action({
  args: {
    orderId: v.string(),
    paymentId: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, { orderId, paymentId, signature }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated.");
    const { keySecret } = requirePaymentEnv();

    const normalizedSignature = signature.toLowerCase();
    if (
      !ORDER_ID_RE.test(orderId) ||
      !PAYMENT_ID_RE.test(paymentId) ||
      !SIGNATURE_RE.test(normalizedSignature)
    ) {
      throw new ConvexError("Payment verification failed.");
    }

    const expected = await hmacSha256Hex(
      keySecret,
      `${orderId}|${paymentId}`,
    );
    if (!signaturesMatch(expected, normalizedSignature)) {
      throw new ConvexError("Payment verification failed.");
    }

    const order = await ctx.runQuery(internal.billingStore.getOrder, {
      orderId,
    });
    if (order === null || order.userId !== userId) {
      throw new ConvexError("This payment doesn't belong to your account.");
    }

    await ctx.runMutation(internal.billingStore.markPaid, {
      orderId,
      paymentId,
    });
    return { ok: true as const };
  },
});
