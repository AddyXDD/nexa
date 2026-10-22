import { ConvexError } from "convex/values";
import type { GenericDatabaseReader } from "convex/server";
import {
  ORGANIZATION_GRACE_DAYS,
  ORGANIZATIONS,
  ORG_SLUG_REGEX,
  PLANS,
  paidPlanFromCheckoutId,
  type PlanId,
} from "../shared/constants";
import type { DataModel, Doc } from "./_generated/dataModel";
import { requireUser } from "./utils";

/**
 * Organization authorization and entitlement resolution.
 *
 * This module is the single place where three things are decided:
 *   1. who the caller is (from the Convex Auth session only),
 *   2. whether their email is verified, and
 *   3. what the organization's subscription currently entitles it to.
 *
 * Every organization query and mutation goes through these helpers, so a
 * client cannot grant itself a role, a seat, a plan, or access to another
 * tenant's meeting by sending different arguments.
 */

type Db = GenericDatabaseReader<DataModel>;

export type OrgRole = Doc<"organizationMemberships">["role"];

export type OrgEntitlementStatus = "none" | "active" | "grace" | "expired";

export type OrgEntitlement = {
  /** "free" means no paid plan backs this workspace. */
  planId: PlanId;
  planName: string;
  status: OrgEntitlementStatus;
  activeUntil: number | null;
  /** Seats granted by the active entitlement. 0 when there is none. */
  seats: number;
  /** New meetings and invitations require an active (not grace) period. */
  canCreate: boolean;
  /** Existing meetings remain joinable through the grace period. */
  canJoin: boolean;
  /** Billing, member and meeting management require an active period. */
  canManage: boolean;
};

const DAY_MS = 86_400_000;

/** Lower-case and trim — the only form ever stored or compared. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeSlugInput(slug: string): string {
  return slug.trim().toLowerCase();
}

export function isValidSlug(slug: string): boolean {
  return ORG_SLUG_REGEX.test(slug);
}

/**
 * The verified address behind an account, or null.
 *
 * A user-entered address is never enough. `emailVerificationTime` is written
 * by Convex Auth only after an email code is redeemed or a Google ID token
 * carries `email_verified`, so it is the one trustworthy signal. Anonymous
 * guest sessions never qualify.
 */
export function verifiedEmailFor(user: Doc<"users">): string | null {
  if (user.isAnonymous === true) return null;
  const email = user.email ? normalizeEmail(user.email) : "";
  if (!email) return null;
  if (user.emailVerificationTime === undefined) return null;
  return email;
}

/** Authenticated + verified + real email. Used by every org-only write. */
export async function requireVerifiedUser(ctx: { db: Db }) {
  const { userId, user } = await requireUser(ctx);
  if (user.isAnonymous === true) throw new ConvexError(ORGANIZATIONS.anonymous);
  const email = verifiedEmailFor(user);
  if (email === null) throw new ConvexError(ORGANIZATIONS.unverified);
  return { userId, user, email };
}

/**
 * Resolve the subscription that backs an organization.
 *
 * Payments are the source of truth — verified by Razorpay's HMAC before a row
 * can be marked paid. A workspace with no paid, organization-scoped payment
 * has no entitlement at all, which is why a freshly created workspace shows
 * the upgrade screen instead of pretending to be subscribed.
 */
export async function getOrgEntitlement(
  db: Db,
  organizationId: Doc<"organizations">["_id"],
  now = Date.now(),
): Promise<OrgEntitlement> {
  const rows = await db
    .query("payments")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .take(20);

  const latest = rows.find(
    (row) => row.status === "paid" && row.paidAt !== undefined,
  );
  const planId = latest ? paidPlanFromCheckoutId(latest.planId) : null;
  if (!latest || latest.paidAt === undefined || planId === null) {
    return {
      planId: "free",
      planName: PLANS.free.name,
      status: "none",
      activeUntil: null,
      seats: 0,
      canCreate: false,
      canJoin: false,
      canManage: false,
    };
  }

  const plan = PLANS[planId];
  const periodMs = (plan.billingPeriodDays ?? 30) * DAY_MS;
  const activeUntil = latest.paidAt + periodMs;
  const graceUntil = activeUntil + ORGANIZATION_GRACE_DAYS * DAY_MS;
  const status: OrgEntitlementStatus =
    now < activeUntil ? "active" : now < graceUntil ? "grace" : "expired";

  return {
    planId,
    planName: plan.name,
    status,
    activeUntil,
    seats: plan.organizationSeats,
    canCreate: status === "active",
    canJoin: status === "active" || status === "grace",
    canManage: status === "active",
  };
}

/** The plan that governs a room, for participant/time limits. */
export async function getOrganizationPlan(
  db: Db,
  organizationId: Doc<"organizations">["_id"],
): Promise<PlanId> {
  const entitlement = await getOrgEntitlement(db, organizationId);
  // Grace still joins under the paid plan's limits; a lapsed workspace falls
  // back to the Free ceilings so it can never host beyond what was paid.
  if (entitlement.status === "active" || entitlement.status === "grace") {
    return entitlement.planId;
  }
  return "free";
}

export async function findMembership(
  db: Db,
  organizationId: Doc<"organizations">["_id"],
  userId: Doc<"users">["_id"],
) {
  return await db
    .query("organizationMemberships")
    .withIndex("by_org_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId),
    )
    .unique();
}

export async function activeMemberCount(
  db: Db,
  organizationId: Doc<"organizations">["_id"],
): Promise<number> {
  const rows = await db
    .query("organizationMemberships")
    .withIndex("by_org_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", "active"),
    )
    .take(200);
  return rows.length;
}

export function isManager(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

/** The caller's active membership in a workspace, resolved by slug. */
export async function requireOrgMembership(ctx: { db: Db }, slugInput: string) {
  const { userId, user } = await requireUser(ctx);
  const slug = normalizeSlugInput(slugInput);
  const org = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (org === null) throw new ConvexError(ORGANIZATIONS.notFound);

  const membership = await findMembership(ctx.db, org._id, userId);
  const isActive = membership !== null && membership.status === "active";
  if (!isActive) {
    throw new ConvexError(
      org.status === "archived" ? ORGANIZATIONS.archived : ORGANIZATIONS.notFound,
    );
  }
  if (org.status === "archived") {
    throw new ConvexError(ORGANIZATIONS.archived);
  }

  return {
    userId,
    user,
    org,
    membership,
    entitlement: await getOrgEntitlement(ctx.db, org._id),
  };
}

/** Owner or admin, with an active subscription for privileged writes. */
export async function requireOrgManager(
  ctx: { db: Db },
  slug: string,
  options: { requireActive?: boolean } = {},
) {
  const { entitlement, ...rest } = await requireOrgMembership(ctx, slug);
  if (!isManager(rest.membership.role)) {
    throw new ConvexError(ORGANIZATIONS.forbidden);
  }
  const requireActive = options.requireActive ?? true;
  if (requireActive && !entitlement.canManage) {
    throw new ConvexError(
      entitlement.status === "none" || entitlement.status === "expired"
        ? ORGANIZATIONS.subscribe
        : ORGANIZATIONS.grace,
    );
  }
  return { ...rest, entitlement };
}

export async function requireOrgOwner(ctx: { db: Db }, slug: string) {
  const result = await requireOrgMembership(ctx, slug);
  if (result.membership.role !== "owner") {
    throw new ConvexError(ORGANIZATIONS.forbidden);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Meeting access
 * ------------------------------------------------------------------ */

export type MeetingAccessResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Authorization for a room, evaluated from the live database every time.
 *
 * Personal rooms are untouched: the 80-bit code is the capability, exactly
 * as before organizations existed. An organization room additionally needs
 * an active membership, a verified email and a subscription that can still
 * join. A private room needs an explicit `meetingAccess` row (or to be the
 * organizer) — membership alone is not enough.
 */
export async function canAccessMeeting(
  db: Db,
  meeting: Pick<
    Doc<"meetings">,
    "code" | "hostUserId" | "organizationId" | "visibility"
  >,
  userId: Doc<"users">["_id"] | null,
): Promise<MeetingAccessResult> {
  const visibility = meeting.visibility ?? "personal";
  if (meeting.organizationId === undefined || visibility === "personal") {
    return { allowed: true };
  }
  if (userId === null) {
    return { allowed: false, reason: ORGANIZATIONS.unverified };
  }

  const user = await db.get(userId);
  if (user === null) return { allowed: false, reason: ORGANIZATIONS.unverified };
  if (verifiedEmailFor(user) === null) {
    return { allowed: false, reason: ORGANIZATIONS.unverified };
  }

  const org = await db.get(meeting.organizationId);
  if (org === null || org.status !== "active") {
    return { allowed: false, reason: ORGANIZATIONS.notFound };
  }
  const membership = await findMembership(db, org._id, userId);
  if (membership === null || membership.status !== "active") {
    return { allowed: false, reason: ORGANIZATIONS.notMember };
  }
  const entitlement = await getOrgEntitlement(db, org._id);
  if (!entitlement.canJoin) {
    return { allowed: false, reason: ORGANIZATIONS.expired };
  }

  if (visibility === "private" && meeting.hostUserId !== userId) {
    const booking = await db
      .query("scheduledMeetings")
      .withIndex("by_code", (q) => q.eq("code", meeting.code))
      .unique();
    if (booking === null || booking.hostUserId !== userId) {
      const granted =
        booking === null
          ? null
          : await db
              .query("meetingAccess")
              .withIndex("by_meeting_user", (q) =>
                q.eq("meetingId", booking._id).eq("userId", userId),
              )
              .unique();
      if (granted === null) {
        return { allowed: false, reason: ORGANIZATIONS.privateOnly };
      }
    }
  }

  return { allowed: true };
}

/**
 * Can this caller manage (edit/cancel) a booking? The organizer always can;
 * an owner or admin of the booking's organization can manage organization
 * meetings. Personal bookings remain creator-only.
 */
export async function canManageBooking(
  db: Db,
  booking: Pick<Doc<"scheduledMeetings">, "hostUserId" | "organizationId">,
  userId: Doc<"users">["_id"],
  now = Date.now(),
): Promise<boolean> {
  if (booking.hostUserId === userId) return true;
  if (booking.organizationId === undefined) return false;
  const membership = await findMembership(db, booking.organizationId, userId);
  if (membership === null || membership.status !== "active") return false;
  if (!isManager(membership.role)) return false;
  const entitlement = await getOrgEntitlement(db, booking.organizationId, now);
  return entitlement.canManage;
}

/* ------------------------------------------------------------------ *
 * Tokens
 * ------------------------------------------------------------------ */

/** SHA-256 hex of an invitation bearer token. Only the hash is stored. */
export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 32 bytes of CSPRNG entropy, hex-encoded: an unguessable invite link. */
export function randomInvitationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
