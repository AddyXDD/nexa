import { getAuthUserId } from "@convex-dev/auth/server";
import { Resend } from "resend";
import { ConvexError, v } from "convex/values";
import {
  formatMeetingCode,
  INVITATION_LIMIT,
  MAX_ORGANIZATIONS_PER_USER,
  MAX_OWNED_ORGANIZATIONS,
  MAX_PENDING_INVITATIONS,
  MEETING_CODE_REGEX,
  normalizeMeetingCode,
  normalizeMeetingMinutes,
  normalizeOrganizationSlug,
  ORGANIZATION_INVITE_TTL_MS,
  ORGANIZATIONS,
} from "../shared/constants";
import { siteOrigin } from "./calendar/config";
import { internal } from "./_generated/api";
import {
  action,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  activeMemberCount,
  canManageBooking,
  findMembership,
  getOrgEntitlement,
  hashInvitationToken,
  isManager,
  isValidSlug,
  normalizeEmail,
  randomInvitationToken,
  requireOrgManager,
  requireOrgMembership,
  requireOrgOwner,
  requireVerifiedUser,
  verifiedEmailFor,
  type OrgEntitlement,
} from "./orgAuth";
import {
  createMeetingRow,
  enforceRateLimit,
  uniqueMeetingCode,
} from "./utils";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Organizations: paid team workspaces.
 *
 * Every mutation re-resolves the caller from the session, then checks the
 * membership row it just read — never a role, seat count or plan the browser
 * supplied. Cross-tenant operations fail closed because the organization id
 * always comes from a slug the caller is a member of.
 */

const INVITE_ROLE = v.union(v.literal("admin"), v.literal("member"));
const VISIBILITY = v.union(v.literal("organization"), v.literal("private"));

type ListCtx = QueryCtx | MutationCtx;

/** Public shape of a workspace summary. Never includes payment secrets. */
function entitlementView(entitlement: OrgEntitlement) {
  return {
    planId: entitlement.planId,
    planName: entitlement.planName,
    status: entitlement.status,
    activeUntil: entitlement.activeUntil,
    seats: entitlement.seats,
    canCreate: entitlement.canCreate,
    canJoin: entitlement.canJoin,
    canManage: entitlement.canManage,
  };
}

function slugRedirect(slug: string): string {
  return `${siteOrigin()}/org/${slug}`;
}

async function nameFor(
  ctx: ListCtx,
  userId: Id<"users">,
): Promise<string | null> {
  const user = await ctx.db.get(userId);
  return user?.name ?? null;
}

/**
 * The caller's personal workspace plus every active organization they
 * belong to. This drives the workspace switcher.
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (user === null) return null;

    const memberships = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .take(MAX_ORGANIZATIONS_PER_USER);

    const organizations = [];
    for (const membership of memberships) {
      const org = await ctx.db.get(membership.organizationId);
      if (org === null || org.status !== "active") continue;
      const entitlement = await getOrgEntitlement(ctx.db, org._id);
      const memberCount = await activeMemberCount(ctx.db, org._id);
      organizations.push({
        id: org._id,
        name: org.name,
        slug: org.slug,
        url: slugRedirect(org.slug),
        role: membership.role,
        memberCount,
        seatLimit: Math.max(1, entitlement.seats),
        entitlement: entitlementView(entitlement),
      });
    }
    organizations.sort((a, b) => a.name.localeCompare(b.name));

    return {
      personal: {
        name: user.name ?? "Personal workspace",
        nexaId: user.nexaId ?? null,
        verified: verifiedEmailFor(user) !== null,
      },
      organizations,
    };
  },
});

/**
 * One workspace, from the caller's point of view. Null means "missing, or
 * not yours" — the same answer, so the page cannot be used to enumerate
 * other tenants.
 */
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", normalizeOrganizationSlug(slug)))
      .unique();
    if (org === null) return null;
    const user = await ctx.db.get(userId);
    if (user === null) return null;
    const membership = await findMembership(ctx.db, org._id, userId);
    const activeMembership =
      membership !== null && membership.status === "active" ? membership : null;
    const ownerView = org.status === "archived" && org.ownerUserId === userId;
    if (activeMembership === null && !ownerView) return null;
    if (org.status === "archived" && !ownerView) return null;

    const role = activeMembership?.role ?? "owner";
    const entitlement = await getOrgEntitlement(ctx.db, org._id);
    const memberCount = await activeMemberCount(ctx.db, org._id);
    const pendingInvitations = isManager(role)
      ? (
          await ctx.db
            .query("organizationInvitations")
            .withIndex("by_org_status", (q) =>
              q.eq("organizationId", org._id).eq("status", "pending"),
            )
            .take(MAX_PENDING_INVITATIONS)
        ).length
      : 0;

    return {
      id: org._id,
      name: org.name,
      slug: org.slug,
      url: slugRedirect(org.slug),
      status: org.status,
      role,
      isManager: isManager(role),
      available: activeMembership !== null && org.status === "active",
      memberCount,
      pendingInvitations,
      seatLimit: Math.max(1, entitlement.seats),
      seatsUsed: memberCount,
      settings: org.settings,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      entitlement: entitlementView(entitlement),
      verifiedEmail: verifiedEmailFor(user),
      myNexaId: user.nexaId ?? null,
      myUserId: userId,
    };
  },
});

/* ------------------------------------------------------------------ *\
 * Creation and settings
 * ------------------------------------------------------------------ */

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    membersCanCreateMeetings: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireVerifiedUser(ctx);
    const name = args.name.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 64) {
      throw new ConvexError("Give the workspace a name of 2–64 characters.");
    }
    const slug = normalizeOrganizationSlug(args.slug);
    if (!isValidSlug(slug)) throw new ConvexError(ORGANIZATIONS.badSlug);

    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing !== null) throw new ConvexError(ORGANIZATIONS.takenSlug);

    const owned = await ctx.db
      .query("organizations")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .take(MAX_OWNED_ORGANIZATIONS + 2);
    if (
      owned.filter((org) => org.status === "active").length >=
      MAX_OWNED_ORGANIZATIONS
    ) {
      throw new ConvexError(
        `You can own up to ${MAX_OWNED_ORGANIZATIONS} workspaces.`,
      );
    }

    await enforceRateLimit(
      ctx,
      `org-create:${userId}`,
      INVITATION_LIMIT.max,
      INVITATION_LIMIT.windowMs,
      ORGANIZATIONS.rateLimited,
    );

    const now = Date.now();
    // The workspace starts with exactly one seat (its owner) and no paid
    // entitlement. Nothing pretends it is subscribed; the billing screen is
    // where a real Razorpay payment turns it on.
    const organizationId = await ctx.db.insert("organizations", {
      name,
      slug,
      ownerUserId: userId,
      status: "active",
      seatLimit: 1,
      settings: {
        membersCanCreateMeetings: args.membersCanCreateMeetings ?? true,
      },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      userId,
      role: "owner",
      status: "active",
      joinedAt: now,
      updatedAt: now,
    });
    console.log("[org] created", { slug });
    return { slug };
  },
});

export const updateSettings = mutation({
  args: {
    slug: v.string(),
    name: v.optional(v.string()),
    newSlug: v.optional(v.string()),
    membersCanCreateMeetings: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { org, membership, entitlement, userId } = await requireOrgMembership(
      ctx,
      args.slug,
    );
    if (!isManager(membership.role)) {
      throw new ConvexError(ORGANIZATIONS.forbidden);
    }

    const patch: {
      name?: string;
      slug?: string;
      settings?: { membersCanCreateMeetings: boolean };
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const name = args.name.trim().replace(/\s+/g, " ");
      if (name.length < 2 || name.length > 64) {
        throw new ConvexError("Give the workspace a name of 2–64 characters.");
      }
      patch.name = name;
    }

    if (args.newSlug !== undefined) {
      // Changing the tenant's address is an ownership decision: it breaks
      // every saved link, so admins cannot do it.
      if (membership.role !== "owner") {
        throw new ConvexError(ORGANIZATIONS.forbidden);
      }
      const slug = normalizeOrganizationSlug(args.newSlug);
      if (!isValidSlug(slug)) throw new ConvexError(ORGANIZATIONS.badSlug);
      if (slug !== org.slug) {
        const taken = await ctx.db
          .query("organizations")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .unique();
        if (taken !== null) throw new ConvexError(ORGANIZATIONS.takenSlug);
        patch.slug = slug;
      }
    }

    if (args.membersCanCreateMeetings !== undefined) {
      patch.settings = {
        membersCanCreateMeetings: args.membersCanCreateMeetings,
      };
    }

    // Renaming or re-addressing a lapsed workspace is not a paid feature, but
    // flipping member permissions is: keep it behind the entitlement.
    if (
      !entitlement.canManage &&
      args.membersCanCreateMeetings !== undefined
    ) {
      throw new ConvexError(ORGANIZATIONS.subscribe);
    }

    await ctx.db.patch(org._id, patch);
    await enforceRateLimit(
      ctx,
      `org-settings:${userId}`,
      30,
      60 * 60_000,
      ORGANIZATIONS.rateLimited,
    );
    return { slug: patch.slug ?? org.slug };
  },
});

/* ------------------------------------------------------------------ *\
 * Invitations
 * ------------------------------------------------------------------ */

async function requireSeatAvailable(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  entitlement: OrgEntitlement,
) {
  if (!entitlement.canCreate) {
    throw new ConvexError(
      entitlement.status === "none" || entitlement.status === "expired"
        ? ORGANIZATIONS.subscribe
        : ORGANIZATIONS.grace,
    );
  }
  const members = await activeMemberCount(ctx.db, org._id);
  if (members >= entitlement.seats) throw new ConvexError(ORGANIZATIONS.noSeats);
}

/**
 * Create a single-use invitation. Returns the raw token exactly once — only
 * its SHA-256 hash is persisted, so even a full database read cannot produce
 * a working invite link.
 */
export const createInvitation = mutation({
  args: {
    slug: v.string(),
    email: v.string(),
    role: INVITE_ROLE,
  },
  handler: async (ctx, args) => {
    const { org, membership, entitlement, userId } = await requireOrgManager(
      ctx,
      args.slug,
    );
    const email = normalizeEmail(args.email);
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email) || email.length > 254) {
      throw new ConvexError(ORGANIZATIONS.badEmail);
    }
    if (args.role === "admin" && membership.role !== "owner") {
      throw new ConvexError(ORGANIZATIONS.cannotInviteAdmin);
    }
    await requireSeatAvailable(ctx, org, entitlement);

    await enforceRateLimit(
      ctx,
      `org-invite:${userId}`,
      INVITATION_LIMIT.max,
      INVITATION_LIMIT.windowMs,
      ORGANIZATIONS.rateLimited,
    );
    await enforceRateLimit(
      ctx,
      `org-invite-org:${org._id}`,
      INVITATION_LIMIT.max * 3,
      INVITATION_LIMIT.windowMs,
      ORGANIZATIONS.rateLimited,
    );

    // Already a member? Look the account up by its email index — never by an
    // id supplied in the request.
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (existingUser !== null) {
      const existingMembership = await findMembership(
        ctx.db,
        org._id,
        existingUser._id,
      );
      if (
        existingMembership !== null &&
        existingMembership.status === "active"
      ) {
        throw new ConvexError(ORGANIZATIONS.alreadyMember);
      }
    }

    const pending = await ctx.db
      .query("organizationInvitations")
      .withIndex("by_org_status", (q) =>
        q.eq("organizationId", org._id).eq("status", "pending"),
      )
      .take(MAX_PENDING_INVITATIONS + 1);
    if (pending.some((row) => row.email === email)) {
      throw new ConvexError(ORGANIZATIONS.invitePending);
    }
    if (pending.length >= MAX_PENDING_INVITATIONS) {
      throw new ConvexError(
        "This workspace has too many pending invitations. Revoke one first.",
      );
    }

    const token = randomInvitationToken();
    const tokenHash = await hashInvitationToken(token);
    const now = Date.now();
    const invitationId = await ctx.db.insert("organizationInvitations", {
      organizationId: org._id,
      email,
      inviterUserId: userId,
      role: args.role,
      tokenHash,
      status: "pending",
      createdAt: now,
      expiresAt: now + ORGANIZATION_INVITE_TTL_MS,
    });

    return {
      invitationId,
      token,
      link: `${siteOrigin()}/org/join/${token}`,
      email,
      role: args.role,
      expiresAt: now + ORGANIZATION_INVITE_TTL_MS,
      emailConfigured: Boolean(process.env.RESEND_API_KEY),
    };
  },
});

export const revokeInvitation = mutation({
  args: { slug: v.string(), invitationId: v.id("organizationInvitations") },
  handler: async (ctx, { slug, invitationId }) => {
    const { org } = await requireOrgManager(ctx, slug);
    const invitation = await ctx.db.get(invitationId);
    if (invitation === null || invitation.organizationId !== org._id) {
      throw new ConvexError(ORGANIZATIONS.notFound);
    }
    if (invitation.status !== "pending") return { ok: true as const };
    await ctx.db.patch(invitation._id, {
      status: "revoked",
      revokedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** A public preview of an invitation: only what the landing screen needs. */
export const invitationPreview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = await hashInvitationToken(token);
    const invitation = await ctx.db
      .query("organizationInvitations")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (invitation === null) return null;
    const org = await ctx.db.get(invitation.organizationId);
    if (org === null) return null;
    const expired = invitation.expiresAt <= Date.now();
    return {
      organizationName: org.name,
      organizationSlug: org.slug,
      role: invitation.role,
      email: invitation.email,
      status:
        invitation.status === "pending" && expired
          ? "expired"
          : invitation.status,
      expiresAt: invitation.expiresAt,
    };
  },
});

/** Accept an invitation. The link is one-shot and bound to its address. */
export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { userId, email } = await requireVerifiedUser(ctx);
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw new ConvexError(ORGANIZATIONS.inviteInvalid);
    }
    const tokenHash = await hashInvitationToken(token);
    const invitation = await ctx.db
      .query("organizationInvitations")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (invitation === null) throw new ConvexError(ORGANIZATIONS.inviteInvalid);

    if (invitation.status === "revoked") {
      throw new ConvexError(ORGANIZATIONS.inviteRevoked);
    }
    if (invitation.status !== "pending") {
      throw new ConvexError(ORGANIZATIONS.inviteInvalid);
    }
    if (invitation.expiresAt <= Date.now()) {
      await ctx.db.patch(invitation._id, { status: "expired" });
      throw new ConvexError(ORGANIZATIONS.inviteInvalid);
    }
    if (invitation.email !== email) {
      throw new ConvexError(ORGANIZATIONS.inviteEmailMismatch);
    }

    const org = await ctx.db.get(invitation.organizationId);
    if (org === null || org.status !== "active") {
      throw new ConvexError(ORGANIZATIONS.notFound);
    }
    const entitlement = await getOrgEntitlement(ctx.db, org._id);
    if (!entitlement.canCreate) {
      throw new ConvexError(
        entitlement.status === "none" || entitlement.status === "expired"
          ? ORGANIZATIONS.subscribe
          : ORGANIZATIONS.grace,
      );
    }

    const existing = await findMembership(ctx.db, org._id, userId);
    const now = Date.now();
    if (existing !== null && existing.status === "active") {
      // Idempotent acceptance of an invitation for an existing member.
      await ctx.db.patch(invitation._id, {
        status: "accepted",
        acceptedAt: now,
        acceptedByUserId: userId,
      });
      return { slug: org.slug, alreadyMember: true as const };
    }

    const memberships = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .take(MAX_ORGANIZATIONS_PER_USER + 1);
    if (memberships.length >= MAX_ORGANIZATIONS_PER_USER) {
      throw new ConvexError(
        `You can belong to up to ${MAX_ORGANIZATIONS_PER_USER} workspaces.`,
      );
    }

    await requireSeatAvailable(ctx, org, entitlement);

    if (existing === null) {
      await ctx.db.insert("organizationMemberships", {
        organizationId: org._id,
        userId,
        role: invitation.role,
        status: "active",
        joinedAt: now,
        updatedAt: now,
        invitedByUserId: invitation.inviterUserId,
      });
    } else {
      await ctx.db.patch(existing._id, {
        role: invitation.role,
        status: "active",
        joinedAt: now,
        updatedAt: now,
        invitedByUserId: invitation.inviterUserId,
      });
    }

    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedAt: now,
      acceptedByUserId: userId,
    });
    await ctx.db.patch(org._id, { updatedAt: now });
    console.log("[org] invitation accepted", { slug: org.slug });
    return { slug: org.slug, alreadyMember: false as const };
  },
});

/* ------------------------------------------------------------------ *\
 * Members, roles and ownership
 * ------------------------------------------------------------------ */

export const members = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org, membership } = await requireOrgMembership(ctx, slug);
    const manager = isManager(membership.role);
    const rows = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_org_status", (q) =>
        q.eq("organizationId", org._id).eq("status", "active"),
      )
      .take(200);
    const result = [];
    for (const row of rows) {
      const user = await ctx.db.get(row.userId);
      result.push({
        userId: row.userId,
        name: user?.name ?? null,
        nexaId: user?.nexaId ?? null,
        role: row.role,
        joinedAt: row.joinedAt,
        // Addresses are only shown to the people who manage membership.
        email: manager ? (user?.email ?? null) : null,
        verified: user ? verifiedEmailFor(user) !== null : false,
      });
    }
    result.sort((a, b) => {
      const order = { owner: 0, admin: 1, member: 2 } as const;
      return order[a.role] - order[b.role] || a.joinedAt - b.joinedAt;
    });
    return { members: result, myUserId: membership.userId };
  },
});

/** Invitations — managers only. Emails never reach plain members. */
export const invitations = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org, membership } = await requireOrgMembership(ctx, slug);
    if (!isManager(membership.role)) return [];
    const rows = await ctx.db
      .query("organizationInvitations")
      .withIndex("by_org", (q) => q.eq("organizationId", org._id))
      .order("desc")
      .take(MAX_PENDING_INVITATIONS + 20);
    return rows.map((row) => ({
      id: row._id,
      email: row.email,
      role: row.role,
      status:
        row.status === "pending" && row.expiresAt <= Date.now()
          ? ("expired" as const)
          : row.status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      inviterUserId: row.inviterUserId,
    }));
  },
});

export const changeRole = mutation({
  args: {
    slug: v.string(),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, { slug, userId, role }) => {
    const { org, userId: callerId } = await requireOrgOwner(ctx, slug);
    const target = await findMembership(ctx.db, org._id, userId);
    if (target === null || target.status !== "active") {
      throw new ConvexError(ORGANIZATIONS.notFound);
    }
    if (target.role === "owner") {
      throw new ConvexError(ORGANIZATIONS.cannotChangeOwnerRole);
    }
    if (userId === callerId) throw new ConvexError(ORGANIZATIONS.forbidden);
    await ctx.db.patch(target._id, { role, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/**
 * Remove every live trace of a member from this organization's rooms.
 * Their seat, their signalling rows and their private-meeting grants go in
 * the same transaction as the membership change, so access is revoked before
 * the mutation returns rather than when their client next polls.
 */
async function revokeMemberFromOrg(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
  email: string | null,
) {
  const seats = await ctx.db
    .query("participants")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(64);
  for (const seat of seats) {
    const room = await ctx.db
      .query("meetings")
      .withIndex("by_code", (q) => q.eq("code", seat.meetingCode))
      .unique();
    if (room === null || room.organizationId !== organizationId) continue;
    await ctx.db.delete(seat._id);
    const signals = await ctx.db
      .query("signals")
      .withIndex("by_meeting", (q) => q.eq("meetingCode", seat.meetingCode))
      .filter((q) =>
        q.or(
          q.eq(q.field("toSessionId"), seat.sessionId),
          q.eq(q.field("fromSessionId"), seat.sessionId),
        ),
      )
      .take(100);
    for (const signal of signals) await ctx.db.delete(signal._id);
    const remaining = await ctx.db
      .query("participants")
      .withIndex("by_meeting", (q) => q.eq("meetingCode", seat.meetingCode))
      .take(1);
    if (remaining.length === 0) {
      await ctx.db.patch(room._id, { emptySince: Date.now() });
    }
  }

  const grants = await ctx.db
    .query("meetingAccess")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(100);
  for (const grant of grants) {
    const booking = await ctx.db.get(grant.meetingId);
    if (booking?.organizationId === organizationId) {
      await ctx.db.delete(grant._id);
    }
  }

  if (email !== null) {
    // A pending invitation would otherwise let a removed member walk back in.
    const pending = await ctx.db
      .query("organizationInvitations")
      .withIndex("by_org_email", (q) =>
        q.eq("organizationId", organizationId).eq("email", email),
      )
      .take(10);
    for (const invitation of pending) {
      if (invitation.status === "pending") {
        await ctx.db.patch(invitation._id, {
          status: "revoked",
          revokedAt: Date.now(),
        });
      }
    }
  }
}

export const removeMember = mutation({
  args: { slug: v.string(), userId: v.id("users") },
  handler: async (ctx, { slug, userId }) => {
    // Members may need to be removed even when the plan has lapsed (for
    // example after an offboarding): security does not wait for a renewal.
    const { org, membership, userId: callerId } = await requireOrgManager(
      ctx,
      slug,
      { requireActive: false },
    );
    if (userId === callerId) {
      throw new ConvexError(ORGANIZATIONS.cannotRemoveSelf);
    }
    const target = await findMembership(ctx.db, org._id, userId);
    if (target === null || target.status !== "active") {
      throw new ConvexError(ORGANIZATIONS.notFound);
    }
    if (target.role === "owner") {
      throw new ConvexError(ORGANIZATIONS.cannotRemoveOwner);
    }
    // Admins manage members, but not peers: only the owner removes an admin.
    if (target.role === "admin" && membership.role !== "owner") {
      throw new ConvexError(ORGANIZATIONS.forbidden);
    }
    const user = await ctx.db.get(userId);
    await ctx.db.patch(target._id, {
      status: "removed",
      updatedAt: Date.now(),
    });
    await revokeMemberFromOrg(
      ctx,
      org._id,
      userId,
      user?.email ? normalizeEmail(user.email) : null,
    );
    return { ok: true as const };
  },
});

export const leave = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org, membership, userId, user } = await requireOrgMembership(
      ctx,
      slug,
    );
    if (membership.role === "owner") {
      throw new ConvexError(
        "Transfer ownership or delete the workspace before leaving it.",
      );
    }
    await ctx.db.patch(membership._id, {
      status: "removed",
      updatedAt: Date.now(),
    });
    await revokeMemberFromOrg(
      ctx,
      org._id,
      userId,
      user.email ? normalizeEmail(user.email) : null,
    );
    return { ok: true as const };
  },
});

/**
 * Transfer ownership. One transaction moves both the role and the
 * organization's owner pointer, so there is never a moment with no owner.
 */
export const transferOwnership = mutation({
  args: { slug: v.string(), userId: v.id("users") },
  handler: async (ctx, { slug, userId }) => {
    const { org, membership } = await requireOrgOwner(ctx, slug);
    if (userId === membership.userId) {
      throw new ConvexError(ORGANIZATIONS.forbidden);
    }
    const target = await findMembership(ctx.db, org._id, userId);
    if (target === null || target.status !== "active") {
      throw new ConvexError(ORGANIZATIONS.transferNeedsMember);
    }
    const now = Date.now();
    await ctx.db.patch(membership._id, { role: "admin", updatedAt: now });
    await ctx.db.patch(target._id, { role: "owner", updatedAt: now });
    await ctx.db.patch(org._id, { ownerUserId: userId, updatedAt: now });
    return { ok: true as const };
  },
});

/** Soft-delete with a typed confirmation. Financial rows are retained. */
export const deleteOrganization = mutation({
  args: { slug: v.string(), confirmSlug: v.string() },
  handler: async (ctx, { slug, confirmSlug }) => {
    const { org, userId } = await requireOrgOwner(ctx, slug);
    if (confirmSlug.trim().toLowerCase() !== org.slug) {
      throw new ConvexError(ORGANIZATIONS.deleteConfirm);
    }
    const now = Date.now();

    const memberships = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_org", (q) => q.eq("organizationId", org._id))
      .take(200);
    for (const row of memberships) {
      if (row.userId !== userId) {
        const user = await ctx.db.get(row.userId);
        await revokeMemberFromOrg(
          ctx,
          org._id,
          row.userId,
          user?.email ? normalizeEmail(user.email) : null,
        );
        await ctx.db.patch(row._id, { status: "removed", updatedAt: now });
      }
    }

    const pending = await ctx.db
      .query("organizationInvitations")
      .withIndex("by_org_status", (q) =>
        q.eq("organizationId", org._id).eq("status", "pending"),
      )
      .take(MAX_PENDING_INVITATIONS + 20);
    for (const invitation of pending) {
      await ctx.db.patch(invitation._id, {
        status: "revoked",
        revokedAt: now,
      });
    }

    const bookings = await ctx.db
      .query("scheduledMeetings")
      .withIndex("by_organization_starts", (q) =>
        q.eq("organizationId", org._id),
      )
      .take(200);
    for (const booking of bookings) {
      if (booking.status === "scheduled") {
        await ctx.db.patch(booking._id, { status: "cancelled", updatedAt: now });
      }
    }

    const rooms = await ctx.db
      .query("meetings")
      .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
      .take(100);
    for (const room of rooms) {
      if (!room.active) continue;
      const seats = await ctx.db
        .query("participants")
        .withIndex("by_meeting", (q) => q.eq("meetingCode", room.code))
        .take(64);
      for (const seat of seats) await ctx.db.delete(seat._id);
      const signals = await ctx.db
        .query("signals")
        .withIndex("by_meeting", (q) => q.eq("meetingCode", room.code))
        .take(200);
      for (const signal of signals) await ctx.db.delete(signal._id);
      await ctx.db.patch(room._id, {
        active: false,
        endedAt: now,
        emptySince: undefined,
      });
    }

    await ctx.db.patch(org._id, {
      status: "archived",
      updatedAt: now,
      // Archived workspaces cannot be used again; a fresh one gets a new slug.
      slug: `${org.slug}-deleted-${now.toString(36)}`,
    });
    console.log("[org] archived", { organizationId: org._id });
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------------ *\
 * Organization meetings
 * ------------------------------------------------------------------ */

type Booking = Doc<"scheduledMeetings">;

function bookingEndsAt(booking: Booking): number {
  return booking.startsAt + (booking.durationMinutes ?? 30) * 60_000;
}

/** Which org bookings may this member see? Private ones need a grant. */
async function visibleBookings(
  ctx: ListCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
): Promise<Booking[]> {
  const rows = await ctx.db
    .query("scheduledMeetings")
    .withIndex("by_organization_starts", (q) => q.eq("organizationId", orgId))
    .order("desc")
    .take(200);
  const visible: Booking[] = [];
  for (const row of rows) {
    if ((row.visibility ?? "organization") === "organization") {
      visible.push(row);
      continue;
    }
    if (row.hostUserId === userId) {
      visible.push(row);
      continue;
    }
    const grant = await ctx.db
      .query("meetingAccess")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", row._id).eq("userId", userId),
      )
      .unique();
    if (grant !== null) visible.push(row);
  }
  return visible;
}

async function serializeBookings(ctx: ListCtx, rows: Booking[]) {
  const result = [];
  for (const row of rows) {
    result.push({
      id: row._id,
      code: row.code,
      formattedCode: formatMeetingCode(row.code),
      title: row.title ?? null,
      startsAt: row.startsAt,
      endsAt: bookingEndsAt(row),
      durationMinutes: row.durationMinutes ?? 30,
      timeZone: row.timeZone ?? null,
      visibility: row.visibility ?? "organization",
      status: row.status,
      organizerUserId: row.hostUserId,
      organizerName: await nameFor(ctx, row.hostUserId),
      createdAt: row.createdAt,
    });
  }
  return result;
}

export const meetings = query({
  args: {
    slug: v.string(),
    scope: v.optional(
      v.union(v.literal("upcoming"), v.literal("past"), v.literal("all")),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { slug, scope = "upcoming", search }) => {
    const { org, userId } = await requireOrgMembership(ctx, slug);
    const all = await visibleBookings(ctx, org._id, userId);
    const now = Date.now();
    const term = (search ?? "").trim().toLowerCase();

    const filtered = all.filter((row) => {
      if (scope === "upcoming" && bookingEndsAt(row) < now) return false;
      if (scope === "past" && bookingEndsAt(row) >= now) return false;
      if (term.length > 0) {
        const title = (row.title ?? "").toLowerCase();
        if (!title.includes(term) && !row.code.toLowerCase().includes(term)) {
          return false;
        }
      }
      return true;
    });

    filtered.sort((a, b) =>
      scope === "past" ? b.startsAt - a.startsAt : a.startsAt - b.startsAt,
    );
    return await serializeBookings(ctx, filtered.slice(0, 60));
  },
});

export const overview = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org, userId, membership } = await requireOrgMembership(ctx, slug);
    const visible = await visibleBookings(ctx, org._id, userId);
    const now = Date.now();
    const upcoming = visible
      .filter((row) => row.status === "scheduled" && bookingEndsAt(row) >= now)
      .sort((a, b) => a.startsAt - b.startsAt)
      .slice(0, 5);
    const recent = visible
      .filter((row) => bookingEndsAt(row) < now || row.status === "cancelled")
      .sort((a, b) => b.startsAt - a.startsAt)
      .slice(0, 5);
    const memberCount = await activeMemberCount(ctx.db, org._id);
    const pendingInvitations = isManager(membership.role)
      ? (
          await ctx.db
            .query("organizationInvitations")
            .withIndex("by_org_status", (q) =>
              q.eq("organizationId", org._id).eq("status", "pending"),
            )
            .take(MAX_PENDING_INVITATIONS)
        ).length
      : 0;

    return {
      upcoming: await serializeBookings(ctx, upcoming),
      recent: await serializeBookings(ctx, recent),
      memberCount,
      pendingInvitations,
      myRole: membership.role,
    };
  },
});

/**
 * Create an organization meeting and open its room.
 *
 * Members may create when the workspace setting allows it; admins and owners
 * always may. The plan is checked here and again on every join, so a lapsed
 * subscription cannot be bypassed with a link.
 */
export const createMeeting = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    startsAt: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
    visibility: VISIBILITY,
    participantIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const { org, membership, entitlement, userId } =
      await requireOrgMembership(ctx, args.slug);
    const verified = await requireVerifiedUser(ctx);
    if (verified.userId !== userId) {
      throw new ConvexError(ORGANIZATIONS.forbidden);
    }

    if (!entitlement.canCreate) {
      throw new ConvexError(
        entitlement.status === "none" || entitlement.status === "expired"
          ? ORGANIZATIONS.subscribe
          : ORGANIZATIONS.grace,
      );
    }
    if (!isManager(membership.role) && !org.settings.membersCanCreateMeetings) {
      throw new ConvexError(ORGANIZATIONS.meetingsOff);
    }

    const title = args.title.trim().slice(0, 120);
    if (title.length < 2) {
      throw new ConvexError(
        "Give the meeting a title of at least 2 characters.",
      );
    }
    const durationMinutes = normalizeMeetingMinutes(args.durationMinutes);
    if (durationMinutes === null) {
      throw new ConvexError(
        "Pick a meeting length between 5 minutes and 8 hours.",
      );
    }
    const now = Date.now();
    const startsAt = args.startsAt ?? now;
    if (!Number.isFinite(startsAt) || startsAt < now - 60_000) {
      throw new ConvexError("Pick a time in the future.");
    }

    await enforceRateLimit(
      ctx,
      `org-meeting:${userId}`,
      30,
      60 * 60_000,
      ORGANIZATIONS.rateLimited,
    );

    // Private meetings: the organizer plus explicitly authorized members.
    const participants: Id<"users">[] = [];
    if (args.visibility === "private" && args.participantIds) {
      for (const participantId of [...new Set(args.participantIds)]) {
        if (participantId === userId) continue;
        const target = await findMembership(ctx.db, org._id, participantId);
        if (target === null || target.status !== "active") {
          throw new ConvexError(
            "Private meetings can only include active members of this workspace.",
          );
        }
        participants.push(participantId);
      }
    }

    const code = await uniqueMeetingCode(ctx.db);
    const bookingId = await ctx.db.insert("scheduledMeetings", {
      code,
      hostUserId: userId,
      createdByUserId: userId,
      title,
      startsAt,
      invitees: [],
      createdAt: now,
      status: "scheduled",
      durationMinutes,
      organizationId: org._id,
      visibility: args.visibility,
    });

    for (const participantId of participants) {
      await ctx.db.insert("meetingAccess", {
        meetingId: bookingId,
        userId: participantId,
        grantedByUserId: userId,
        grantedAt: now,
      });
    }

    await createMeetingRow(ctx.db, {
      code,
      hostUserId: userId,
      organizationId: org._id,
      visibility: args.visibility,
    });
    // The workspace's plan governs the room, not the organizer's personal
    // account — an owner on Free can still host the team's Business meeting.
    await ctx.db.patch(org._id, { updatedAt: now });
    console.log("[org] meeting created", {
      slug: org.slug,
      visibility: args.visibility,
    });
    return {
      code,
      formattedCode: formatMeetingCode(code),
      visibility: args.visibility,
      startsAt,
      durationMinutes,
    };
  },
});

/** Organizer or a workspace manager may cancel an organization meeting. */
export const cancelMeeting = mutation({
  args: { slug: v.string(), code: v.string() },
  handler: async (ctx, { slug, code: raw }) => {
    const { org, userId } = await requireOrgMembership(ctx, slug);
    const code = normalizeMeetingCode(raw);
    if (!MEETING_CODE_REGEX.test(code)) {
      throw new ConvexError(ORGANIZATIONS.notFound);
    }
    const booking = await ctx.db
      .query("scheduledMeetings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (booking === null || booking.organizationId !== org._id) {
      throw new ConvexError(ORGANIZATIONS.notFound);
    }
    const allowed = await canManageBooking(ctx.db, booking, userId);
    if (!allowed) throw new ConvexError(ORGANIZATIONS.forbidden);
    if (booking.status !== "cancelled") {
      await ctx.db.patch(booking._id, {
        status: "cancelled",
        updatedAt: Date.now(),
      });
    }
    return { ok: true as const };
  },
});

/** Authorize more people for a private organization meeting. */
export const grantMeetingAccess = mutation({
  args: {
    slug: v.string(),
    code: v.string(),
    participantIds: v.array(v.id("users")),
  },
  handler: async (ctx, { slug, code: raw, participantIds }) => {
    const { org, userId } = await requireOrgMembership(ctx, slug);
    const code = normalizeMeetingCode(raw);
    const booking = await ctx.db
      .query("scheduledMeetings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (booking === null || booking.organizationId !== org._id) {
      throw new ConvexError(ORGANIZATIONS.notFound);
    }
    if ((booking.visibility ?? "organization") !== "private") {
      throw new ConvexError("Only private meetings carry an access list.");
    }
    const allowed = await canManageBooking(ctx.db, booking, userId);
    if (!allowed) throw new ConvexError(ORGANIZATIONS.forbidden);

    const added: Id<"users">[] = [];
    for (const participantId of [...new Set(participantIds)]) {
      if (participantId === booking.hostUserId) continue;
      const target = await findMembership(ctx.db, org._id, participantId);
      if (target === null || target.status !== "active") {
        throw new ConvexError(
          "Only active members can be added to a private meeting.",
        );
      }
      const existing = await ctx.db
        .query("meetingAccess")
        .withIndex("by_meeting_user", (q) =>
          q.eq("meetingId", booking._id).eq("userId", participantId),
        )
        .unique();
      if (existing !== null) continue;
      await ctx.db.insert("meetingAccess", {
        meetingId: booking._id,
        userId: participantId,
        grantedByUserId: userId,
        grantedAt: Date.now(),
      });
      added.push(participantId);
    }
    return { added: added.length };
  },
});

/* ------------------------------------------------------------------ *\
 * Subscription view
 * ------------------------------------------------------------------ */

export const subscription = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org, membership } = await requireOrgMembership(ctx, slug);
    if (!isManager(membership.role)) {
      throw new ConvexError(ORGANIZATIONS.forbidden);
    }
    const entitlement = await getOrgEntitlement(ctx.db, org._id);
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
      .order("desc")
      .take(20);
    const memberCount = await activeMemberCount(ctx.db, org._id);

    return {
      configured: Boolean(
        process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
      ),
      entitlement: entitlementView(entitlement),
      seatsUsed: memberCount,
      seatLimit: Math.max(1, entitlement.seats),
      canPurchase: membership.role === "owner",
      payments: payments.map((row) => ({
        id: row._id,
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

/* ------------------------------------------------------------------ *\
 * Invitation email and billing helpers (actions can't read the database)
 * ------------------------------------------------------------------ */

export const getInvitationForEmail = internalQuery({
  args: { invitationId: v.id("organizationInvitations") },
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId);
    if (invitation === null) return null;
    const org = await ctx.db.get(invitation.organizationId);
    if (org === null) return null;
    const inviter = await ctx.db.get(invitation.inviterUserId);
    return {
      invitationId: invitation._id,
      organizationId: org._id,
      organizationName: org.name,
      organizationSlug: org.slug,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      tokenHash: invitation.tokenHash,
      inviterName: inviter?.name ?? null,
    };
  },
});

export const getMembershipForEmail = internalQuery({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, { organizationId, userId }) => {
    const membership = await findMembership(ctx.db, organizationId, userId);
    if (membership === null || membership.status !== "active") return null;
    return { role: membership.role };
  },
});

/** Billing actions can't read tables; this is what they may look at. */
export const getForBilling = internalQuery({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const org = await ctx.db.get(organizationId);
    if (org === null) return null;
    return {
      id: org._id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      ownerUserId: org.ownerUserId,
    };
  },
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Email a freshly created invitation.
 *
 * The raw token never touches the database, so the client passes it back and
 * the server verifies its hash against the stored invitation before sending
 * anything. Only a current manager may trigger the send. Without Resend
 * configured this returns `configured: false` and the caller keeps showing
 * the copyable link — no message is pretended to have been sent.
 */
export const sendInvitationEmail = action({
  args: {
    slug: v.string(),
    invitationId: v.id("organizationInvitations"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated.");
    if (!/^[a-f0-9]{64}$/.test(args.token)) {
      throw new ConvexError(ORGANIZATIONS.inviteInvalid);
    }
    const invitation = await ctx.runQuery(
      internal.organizations.getInvitationForEmail,
      { invitationId: args.invitationId },
    );
    if (invitation === null) throw new ConvexError(ORGANIZATIONS.notFound);
    if (invitation.organizationSlug !== args.slug.trim().toLowerCase()) {
      throw new ConvexError(ORGANIZATIONS.notFound);
    }
    if (invitation.status !== "pending" || invitation.expiresAt <= Date.now()) {
      throw new ConvexError(ORGANIZATIONS.inviteInvalid);
    }
    if ((await hashInvitationToken(args.token)) !== invitation.tokenHash) {
      throw new ConvexError(ORGANIZATIONS.inviteInvalid);
    }
    const membership = await ctx.runQuery(
      internal.organizations.getMembershipForEmail,
      { organizationId: invitation.organizationId, userId },
    );
    if (membership === null || !isManager(membership.role)) {
      throw new ConvexError(ORGANIZATIONS.forbidden);
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_EMAIL_FROM?.trim();
    if (!apiKey || !from) {
      return { configured: false as const, sent: false as const };
    }

    const link = `${siteOrigin()}/org/join/${args.token}`;
    const inviter = invitation.inviterName ?? "A teammate";
    const subject = `${inviter} invited you to ${invitation.organizationName} on Nexa Meet`;
    const text = [
      `${inviter} invited you to join ${invitation.organizationName} on Nexa Meet as ${invitation.role}.`,
      "",
      "Accept the invitation:",
      link,
      "",
      "This link works once, for this email address only, and expires in seven days.",
      "Nexa Meet — private video meetings.",
    ].join("\n");

    try {
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from,
        to: [invitation.email],
        subject,
        text,
        html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:14px;padding:28px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#78716c">Nexa Meet</p>
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">Join ${escapeHtml(invitation.organizationName)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escapeHtml(inviter)} invited you to join as <strong>${invitation.role}</strong>.</p>
    <a href="${link}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 22px;border-radius:10px">Accept invitation</a>
    <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#57534e">Or paste this link into your browser:<br><span style="color:#1d4ed8;word-break:break-all">${link}</span></p>
    <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e7e5e4;font-size:12px;line-height:1.6;color:#78716c">This link works once, for this email address only, and expires in seven days.</p>
  </div>
</body></html>`,
      });
      if (error) return { configured: true as const, sent: false as const };
      return { configured: true as const, sent: true as const };
    } catch {
      // The invitation itself is valid; delivery failing must not destroy it.
      return { configured: true as const, sent: false as const };
    }
  },
});
