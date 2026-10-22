import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { Resend } from "resend";
import {
  DEFAULT_MEETING_MINUTES,
  formatMeetingCode,
  MAX_BOOKINGS_PER_HOUR,
  MAX_INVITEES_PER_HOUR,
  MAX_INVITEES_PER_MEETING,
  MAX_SCHEDULE_AHEAD_MS,
  MEETING_CODE_REGEX,
  normalizeMeetingCode,
  normalizeMeetingMinutes,
  ORGANIZATIONS,
  parseInviteEmails,
  SCHEDULING,
} from "../shared/constants";
import { isValidTimeZone } from "../shared/time";
import { siteOrigin } from "./calendar/config";
import {
  canAccessMeeting,
  canManageBooking,
  findMembership,
  getOrgEntitlement,
  isManager,
  requireVerifiedUser,
} from "./orgAuth";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  createMeetingRow,
  enforceRateLimit,
  requireUser,
  uniqueMeetingCode,
} from "./utils";

/**
 * Scheduled meetings.
 *
 * A booking points at a room code, not a live room: creating the room up
 * front would hand it straight to the sweeper (an unoccupied room is marked
 * empty and then deleted), so the room is opened on demand the first time
 * somebody follows the link — see `openRoom`.
 *
 * Sending email is the one part that leaves the database, and it is
 * deliberately hard to abuse: only real (non-anonymous) accounts may book,
 * and both the number of bookings and the number of recipients are rate
 * limited per account.
 */

/**
 * Invite links are built here, never from something the browser claims, and
 * from the deployment's own origin (`calendar/config.ts`). The calendar sync
 * uses the same function for the link it puts in an event, so the two can
 * never disagree.
 */
export function meetingLink(code: string): string {
  return `${siteOrigin()}/m/${formatMeetingCode(code)}`;
}

/**
 * Book a meeting and reserve the addresses it will be sent to.
 *
 * Guests are optional. With addresses, Nexa emails the join link and (if a
 * calendar is connected) Google Calendar sends its own invitation. Without
 * them the booking is still a real meeting record — a room code, a join link
 * and a time — which is what a personal meeting on your own calendar is.
 */
export const schedule = mutation({
  args: {
    title: v.optional(v.string()),
    startsAt: v.number(),
    timeZone: v.optional(v.string()),
    invitees: v.array(v.string()),
    /** Meeting length. Defaults to 30 minutes. */
    durationMinutes: v.optional(v.number()),
    /** Set for organization meetings; absent for personal bookings. */
    organizationId: v.optional(v.id("organizations")),
    visibility: v.optional(
      v.union(
        v.literal("personal"),
        v.literal("organization"),
        v.literal("private"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    // An anonymous guest has no address to answer to and no way to be
    // stopped; sending mail on their behalf is a spam relay.
    if (user.isAnonymous === true || !user.email) {
      throw new ConvexError(SCHEDULING.guestsBlocked);
    }

    const visibility =
      args.organizationId === undefined
        ? "personal"
        : (args.visibility ?? "organization");
    if (
      args.organizationId !== undefined &&
      visibility !== "organization" &&
      visibility !== "private"
    ) {
      throw new ConvexError("Choose organization or private visibility.");
    }

    if (args.organizationId !== undefined) {
      // Hosting inside a workspace is a paid, verified, member-only act.
      const verified = await requireVerifiedUser(ctx);
      if (verified.userId !== userId) {
        throw new ConvexError(ORGANIZATIONS.forbidden);
      }
      const organization = await ctx.db.get(args.organizationId);
      const membership = await findMembership(
        ctx.db,
        args.organizationId,
        userId,
      );
      if (
        organization === null ||
        organization.status !== "active" ||
        membership === null ||
        membership.status !== "active"
      ) {
        throw new ConvexError(ORGANIZATIONS.notFound);
      }
      const entitlement = await getOrgEntitlement(ctx.db, organization._id);
      if (!entitlement.canCreate) {
        throw new ConvexError(
          entitlement.status === "none" || entitlement.status === "expired"
            ? ORGANIZATIONS.subscribe
            : ORGANIZATIONS.grace,
        );
      }
      if (
        !isManager(membership.role) &&
        !organization.settings.membersCanCreateMeetings
      ) {
        throw new ConvexError(ORGANIZATIONS.meetingsOff);
      }
      // An organization meeting is discovered through the workspace, never
      // through an emailed guest link: membership is the access rule.
      if (args.invitees.length > 0) {
        throw new ConvexError(
          "Organization meetings are shared with members from the workspace — external invitees aren't allowed.",
        );
      }
    }

    const { emails, invalid } = parseInviteEmails(args.invitees);
    if (invalid.length > 0) throw new ConvexError(SCHEDULING.badAddress);
    if (emails.length > MAX_INVITEES_PER_MEETING) {
      throw new ConvexError(SCHEDULING.tooMany);
    }

    const now = Date.now();
    if (!Number.isFinite(args.startsAt) || args.startsAt < now - 60_000) {
      throw new ConvexError(SCHEDULING.pastDate);
    }
    if (args.startsAt > now + MAX_SCHEDULE_AHEAD_MS) {
      throw new ConvexError(SCHEDULING.tooFar);
    }
    const durationMinutes = normalizeMeetingMinutes(args.durationMinutes);
    if (durationMinutes === null) throw new ConvexError(SCHEDULING.badDuration);
    if (args.timeZone !== undefined && !isValidTimeZone(args.timeZone)) {
      throw new ConvexError("That timezone isn't recognized.");
    }

    await enforceRateLimit(
      ctx,
      `schedule:${userId}`,
      MAX_BOOKINGS_PER_HOUR,
      60 * 60_000,
      SCHEDULING.rateLimited,
    );
    // One unit per recipient, so the budget tracks mail actually sent
    // rather than bookings made.
    for (let i = 0; i < emails.length; i++) {
      await enforceRateLimit(
        ctx,
        `invite:${userId}`,
        MAX_INVITEES_PER_HOUR,
        60 * 60_000,
        SCHEDULING.rateLimited,
      );
    }

    const code = await uniqueMeetingCode(ctx.db);
    const title = (args.title ?? "").trim().slice(0, 120);
    const timeZone = (args.timeZone ?? "").trim().slice(0, 64);

    await ctx.db.insert("scheduledMeetings", {
      code,
      hostUserId: userId,
      title: title.length > 0 ? title : undefined,
      startsAt: args.startsAt,
      timeZone: timeZone.length > 0 ? timeZone : undefined,
      invitees: emails,
      createdAt: now,
      status: "scheduled",
      durationMinutes,
      ...(args.organizationId === undefined
        ? {}
        : {
            organizationId: args.organizationId,
            visibility,
            createdByUserId: userId,
          }),
    });

    return { code, inviteeCount: emails.length, durationMinutes };
  },
});

/**
 * Change a booking in place.
 *
 * Deliberately does not email anyone: the calendar update already notifies
 * guests (Google sends its own invitations), and a second email from Nexa
 * about the same change would be noise. Only the host may move their booking,
 * and a cancelled booking stays cancelled.
 */
export const reschedule = mutation({
  args: {
    code: v.string(),
    title: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
    timeZone: v.optional(v.string()),
    invitees: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const code = normalizeMeetingCode(args.code);
    const { userId } = await requireUser(ctx);

    const row = await ctx.db
      .query("scheduledMeetings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (row === null || row.status === "cancelled") {
      throw new ConvexError(SCHEDULING.notFound);
    }
    // The organizer, or an owner/admin of the workspace that owns it.
    if (!(await canManageBooking(ctx.db, row, userId))) {
      throw new ConvexError(SCHEDULING.notFound);
    }
    if (row.organizationId !== undefined && (args.invitees?.length ?? 0) > 0) {
      throw new ConvexError(
        "Organization meetings are shared with members from the workspace — external invitees aren't allowed.",
      );
    }

    await enforceRateLimit(ctx, `reschedule:${userId}`, 30, 60 * 60_000);

    const now = Date.now();
    const patch: {
      startsAt?: number;
      title?: string | undefined;
      durationMinutes?: number;
      timeZone?: string | undefined;
      invitees?: string[];
      updatedAt: number;
    } = { updatedAt: now };

    if (args.startsAt !== undefined) {
      if (!Number.isFinite(args.startsAt) || args.startsAt < now - 60_000) {
        throw new ConvexError(SCHEDULING.pastDate);
      }
      if (args.startsAt > now + MAX_SCHEDULE_AHEAD_MS) {
        throw new ConvexError(SCHEDULING.tooFar);
      }
      patch.startsAt = args.startsAt;
    }

    if (args.durationMinutes !== undefined) {
      const duration = normalizeMeetingMinutes(args.durationMinutes);
      if (duration === null) throw new ConvexError(SCHEDULING.badDuration);
      patch.durationMinutes = duration;
    }

    if (args.timeZone !== undefined) {
      if (!isValidTimeZone(args.timeZone)) {
        throw new ConvexError("That timezone isn't recognized.");
      }
      patch.timeZone = args.timeZone;
    }

    if (args.title !== undefined) {
      const title = args.title.trim().slice(0, 120);
      patch.title = title.length > 0 ? title : undefined;
    }

    if (args.invitees !== undefined) {
      const { emails, invalid } = parseInviteEmails(args.invitees);
      if (invalid.length > 0) throw new ConvexError(SCHEDULING.badAddress);
      if (emails.length > MAX_INVITEES_PER_MEETING) {
        throw new ConvexError(SCHEDULING.tooMany);
      }
      patch.invitees = emails;
    }

    await ctx.db.patch(row._id, patch);
    return { ok: true as const, code };
  },
});

/**
 * Open the room behind a booking, on demand.
 *
 * Runs when somebody follows an invite link before the call starts. A code
 * that was never scheduled simply fails, so the existing "this meeting
 * doesn't exist" path is untouched.
 */
export const openRoom = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code: raw }) => {
    const code = normalizeMeetingCode(raw);
    if (!MEETING_CODE_REGEX.test(code)) return { opened: false as const };
    const { userId } = await requireUser(ctx);
    // One call per link is plenty; this only guards against a render loop.
    await enforceRateLimit(ctx, `openroom:${userId}`, 30, 60_000);

    const booking = await ctx.db
      .query("scheduledMeetings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (booking === null || booking.status === "cancelled") {
      return { opened: false as const };
    }

    const existing = await ctx.db
      .query("meetings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (existing !== null) return { opened: true as const };

    // Opening a room is itself an access decision: don't create one for a
    // caller who could not join it. `join` repeats the check, so a race
    // between opening and joining cannot grant a seat either.
    const access = await canAccessMeeting(ctx.db, booking, userId);
    if (!access.allowed) return { opened: false as const };

    // Same helper meetings.create uses, so a booked room is not just shaped
    // like a normal room — it is born in the same place, which is what puts
    // bookings on the lifetime counter too.
    await createMeetingRow(ctx.db, {
      code,
      hostUserId: booking.hostUserId,
      ...(booking.organizationId === undefined
        ? {}
        : {
            organizationId: booking.organizationId,
            visibility: booking.visibility ?? "organization",
          }),
    });
    return { opened: true as const };
  },
});

/** The signed-in account's bookings, newest first. Addresses stay server-side. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    const rows = await ctx.db
      .query("scheduledMeetings")
      .withIndex("by_host", (q) => q.eq("hostUserId", userId))
      .order("desc")
      .take(60);
    // Organization bookings live in the workspace, not on the personal
    // dashboard — listing them here would duplicate the workspace view.
    return rows
      .filter((row) => row.organizationId === undefined)
      .map((row) => {
        const durationMinutes = row.durationMinutes ?? DEFAULT_MEETING_MINUTES;
        return {
          code: row.code,
          title: row.title ?? null,
          startsAt: row.startsAt,
          timeZone: row.timeZone ?? null,
          durationMinutes,
          endsAt: row.startsAt + durationMinutes * 60_000,
          inviteeCount: row.invitees.length,
          invitesSent: row.invitesSent ?? 0,
          invitesSentAt: row.invitesSentAt ?? null,
          status: row.status,
          createdAt: row.createdAt,
        };
      });
  },
});

/** Cancel a booking. The organizer or a workspace manager; the room is untouched. */
export const cancel = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code: raw }) => {
    const code = normalizeMeetingCode(raw);
    const { userId } = await requireUser(ctx);
    const row = await ctx.db
      .query("scheduledMeetings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (row === null) throw new ConvexError(SCHEDULING.notFound);
    if (!(await canManageBooking(ctx.db, row, userId))) {
      throw new ConvexError(SCHEDULING.notFound);
    }
    await ctx.db.patch(row._id, { status: "cancelled" });
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------------ *
 * Internal helpers (actions can't read the database directly)
 * ------------------------------------------------------------------ */

export const getForInvite = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, { code: raw }) => {
    const code = normalizeMeetingCode(raw);
    if (!MEETING_CODE_REGEX.test(code)) return null;
    const row = await ctx.db
      .query("scheduledMeetings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (row === null || row.status === "cancelled") return null;
    const host = await ctx.db.get(row.hostUserId);
    return {
      code: row.code,
      title: row.title ?? null,
      startsAt: row.startsAt,
      timeZone: row.timeZone ?? null,
      invitees: row.invitees,
      hostUserId: row.hostUserId,
      hostName: host?.name ?? null,
      hostEmail: host?.email ?? null,
    };
  },
});

/** Charge the sender's hourly recipient budget, atomically. */
export const consumeInviteQuota = internalMutation({
  args: { hostUserId: v.id("users"), count: v.number() },
  handler: async (ctx, { hostUserId, count }) => {
    for (let i = 0; i < count; i++) {
      await enforceRateLimit(
        ctx,
        `invite:${hostUserId}`,
        MAX_INVITEES_PER_HOUR,
        60 * 60_000,
        SCHEDULING.rateLimited,
      );
    }
    return { ok: true as const };
  },
});

export const markInvitesSent = internalMutation({
  args: { code: v.string(), sent: v.number() },
  handler: async (ctx, { code: raw, sent }) => {
    const code = normalizeMeetingCode(raw);
    const row = await ctx.db
      .query("scheduledMeetings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (row === null) return { ok: false as const };
    await ctx.db.patch(row._id, {
      invitesSent: (row.invitesSent ?? 0) + sent,
      invitesSentAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/**
 * Sender identity. Falls back to Resend's onboarding address, which works
 * out of the box but can only deliver to the account owner's own inbox —
 * verify the published domain (nexameet.in) in Resend and set
 * RESEND_EMAIL_FROM, e.g. "Nexa Meet <meetings@nexameet.in>", to reach
 * anyone else. Support mail goes to SUPPORT_EMAIL, not here.
 */
const DEFAULT_FROM = "Nexa Meet <onboarding@resend.dev>";

/**
 * Deterministic idempotency key for one (booking, recipient) pair, hashed so
 * it stays well under Resend's 256-character limit however long the address.
 */
function inviteKey(code: string, to: string): string {
  const input = `${code} ${to.toLowerCase()}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `nexa-invite-${code}-${hash.toString(16)}`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );
}

/** The host's wall-clock time, in the zone they booked it in. */
function formatWhen(startsAt: number, timeZone: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "full",
    timeStyle: "short",
  };
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        ...options,
        timeZone,
      }).format(new Date(startsAt));
    } catch {
      /* unknown zone — fall through to UTC */
    }
  }
  return `${new Intl.DateTimeFormat("en-US", options).format(
    new Date(startsAt),
  )} UTC`;
}

function inviteEmail(args: {
  hostName: string | null;
  title: string | null;
  when: string;
  link: string;
}) {
  const subject = args.title
    ? `${args.title} — Nexa Meet`
    : "You're invited to a Nexa Meet";
  const heading = args.title
    ? escapeHtml(args.title)
    : "You're invited to a meeting";
  const from = args.hostName
    ? `${escapeHtml(args.hostName)} scheduled a Nexa Meet with you.`
    : "Someone scheduled a Nexa Meet with you.";
  return {
    subject,
    /** Plain-text alternative — HTML-only mail is a deliverability risk. */
    text: `${heading}\n\n${from}\n\nWhen: ${args.when}\n\nJoin the meeting:\n${args.link}\n\nNo account needed to join. When the last person leaves, the room's roster, chat and connection data are deleted.`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:14px;padding:28px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#78716c">Nexa Meet</p>
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${heading}</h1>
    <p style="margin:0 0 6px;font-size:15px;line-height:1.6">${from}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6"><strong>${escapeHtml(
      args.when,
    )}</strong></p>
    <a href="${args.link}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 22px;border-radius:10px">Join the meeting</a>
    <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#57534e">Or paste this link into your browser:<br><span style="color:#1d4ed8;word-break:break-all">${args.link}</span></p>
    <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e7e5e4;font-size:12px;line-height:1.6;color:#78716c">No account needed to join. When the last person leaves, the room's roster, chat and connection data are deleted.</p>
  </div>
</body></html>`,
  };
}

/**
 * Send the invitations for a booking.
 *
 * Called by the client right after `schedule` so the host sees the result
 * immediately. Delivery goes through Resend's official SDK; the key is read
 * from the server environment and never leaves it.
 */
export const sendInvites = action({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    // Only the host may fire their booking's invitations — otherwise any
    // signed-in account could keep emailing someone else's invitees.
    const caller = await getAuthUserId(ctx);
    if (caller === null) throw new ConvexError("Not authenticated.");

    const booking = await ctx.runQuery(internal.schedule.getForInvite, { code });
    if (booking === null) throw new ConvexError(SCHEDULING.notFound);
    if (booking.hostUserId !== caller) throw new ConvexError(SCHEDULING.notFound);

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new ConvexError(SCHEDULING.emailNotConfigured);
    const configuredFrom = process.env.RESEND_EMAIL_FROM;
    const from =
      configuredFrom && configuredFrom.length > 0
        ? configuredFrom
        : DEFAULT_FROM;
    const resend = new Resend(apiKey);

    await ctx.runMutation(internal.schedule.consumeInviteQuota, {
      hostUserId: booking.hostUserId,
      count: booking.invitees.length,
    });

    const link = meetingLink(booking.code);
    const when = formatWhen(booking.startsAt, booking.timeZone);
    const { subject, text, html } = inviteEmail({
      hostName: booking.hostName,
      title: booking.title,
      when,
      link,
    });

    let sent = 0;
    let failed = 0;
    for (const to of booking.invitees) {
      try {
        const { error } = await resend.emails.send(
          {
            from,
            to: [to],
            subject,
            text,
            html,
            tags: [{ name: "kind", value: "meeting_invite" }],
          },
          // Same booking + same recipient => one email, however many times
          // the host (or a double-tap) retries.
          { idempotencyKey: inviteKey(booking.code, to) },
        );
        if (error) {
          failed++;
          console.warn(`[schedule] invite failed for ${booking.code}`, error);
        } else {
          sent++;
        }
      } catch (err) {
        failed++;
        console.warn(`[schedule] invite threw for ${booking.code}`, err);
      }
    }

    if (sent > 0) {
      await ctx.runMutation(internal.schedule.markInvitesSent, { code, sent });
    }
    return { sent, failed, link };
  },
});