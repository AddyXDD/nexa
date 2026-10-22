/**
 * Shared constants used by both the Convex backend and the client.
 * Keep this file free of `import.meta` / `process.env` access so it can be
 * imported safely from Convex functions and browser code alike.
 */

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

/**
 * 32 characters, no I/L/O/U — every code maps 1:1 to 5 bits of entropy
 * and reads unambiguously over a phone call.
 * (U is omitted only because it is easy to mistype next to V.)
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Unambiguous digit subset of CODE_ALPHABET (used for display checks). */
export const NEXA_ID_PREFIX = "NX-";

/** Meeting codes: 16 chars × 5 bits = 80 bits of entropy. Unguessable. */
export const MEETING_CODE_LENGTH = 16;

/** Nexa IDs: 7 chars × 5 bits ≈ 35 bits. Uniqueness is enforced by index. */
export const NEXA_ID_LENGTH = 7;

const ALPHABET_REGEX_SRC = `[${CODE_ALPHABET}]`;
export const MEETING_CODE_REGEX = new RegExp(
  `^${ALPHABET_REGEX_SRC}{${MEETING_CODE_LENGTH}}$`,
);
export const NEXA_ID_REGEX = new RegExp(
  `^${NEXA_ID_PREFIX}${ALPHABET_REGEX_SRC}{${NEXA_ID_LENGTH}}$`,
);

/** Tolerate hyphens/lowercase when a user pastes or types a code. */
export function normalizeMeetingCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * Canonical display/link form: a dash after every 4 characters
 * (2F4S-4T64-FXTB-A2QS). Routes and the backend always normalize the
 * dashes back out, so this form is safe to share as a URL.
 */
export function formatMeetingCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

/**
 * Parse whatever a user pasted into a room code: accepts a bare code or a
 * full invite link (.../m/<code>). Returns "" when nothing plausible is found.
 */
export function parseMeetingCodeInput(raw: string): string {
  const trimmed = raw.trim();
  const fromLink = trimmed.match(/\/m\/([0-9A-Za-z-]+)/i);
  const candidate = fromLink ? fromLink[1] : trimmed;
  const code = normalizeMeetingCode(candidate);
  return MEETING_CODE_REGEX.test(code) ? code : "";
}

/* ------------------------------------------------------------------ *
 * Limits (server-side validation mirrors these)
 * ------------------------------------------------------------------ */

export const MAX_DISPLAY_NAME_LENGTH = 32;
export const MAX_CHAT_LENGTH = 1000;

/** Presence heartbeat cadence / staleness (seconds).
 *  A closed tab can't always deliver its leave (the socket dies first), so
 *  everyone else hides a seat once its heartbeat is this stale: two missed
 *  beats at the cadence below — a gone participant disappears in ≤30s
 *  instead of lingering on "reconnecting" for over a minute. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const PARTICIPANT_STALE_MS = 30_000;

/**
 * A room stays joinable for this long after it empties so the creator can
 * copy the link in and out — then it closes and its state is destroyed.
 */
export const MEETING_EMPTY_GRACE_MS = 5 * 60_000;
/** Ended meeting rows are dropped entirely after this (no meeting history). */
export const ENDED_MEETING_RETENTION_MS = 10 * 60_000;
/** Signalling messages are ephemeral: they only matter during connect. */
export const SIGNAL_RETENTION_MS = 10 * 60_000;
/** Chat survives only while the room is alive. */
export const CHAT_RETENTION_MS = 12 * 60 * 60_000;

/** Rate limits. */
export const CREATE_MEETING_LIMIT = { max: 6, windowMs: 10 * 60_000 };
export const CHAT_SEND_LIMIT = { max: 30, windowMs: 10_000 };
export const OTP_SEND_LIMIT = { max: 3, windowMs: 15 * 60_000 };

/* ------------------------------------------------------------------ *
 * Client tuning
 * ------------------------------------------------------------------ */

export const SIGNAL_CONSUME_BATCH = 50;
export const CHAT_LIST_LIMIT = 100;
/** Rows scanned when assembling the list of direct-message threads. */
export const CHAT_PEER_SCAN_LIMIT = 400;
/** How long a peer may sit in `disconnected` before we rebuild it. */
export const PEER_DISCONNECT_GRACE_MS = 8_000;
/** Backoff floor between automatic peer rebuilds. */
export const PEER_REBUILD_BACKOFF_MS = 1_500;

/* ------------------------------------------------------------------ *
 * User-facing copy
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Plans
 * ------------------------------------------------------------------ */

/**
 * The three plans Nexa Meet offers. This object is the one source of truth
 * for prices, room limits, organization seats and the Razorpay line items:
 * the pricing page, checkout, entitlement checks and tests all read it.
 * `null` means no limit. Prices are in the currency's smallest unit (paise
 * for INR), because that's what payment gateways charge in.
 */
export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    pricePaise: 0,
    maxParticipants: 15,
    maxMeetingHours: 2,
    billingPeriodDays: null,
    organizations: false,
    organizationSeats: 0,
    checkoutId: null,
  },
  business: {
    id: "business",
    name: "Business",
    pricePaise: 29_900,
    maxParticipants: 100,
    maxMeetingHours: 8,
    billingPeriodDays: 30,
    organizations: true,
    /** Seats in one organization; part of the entitlement, not a UI setting. */
    organizationSeats: 25,
    checkoutId: "nexa-meet-business-monthly",
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    pricePaise: 79_900,
    maxParticipants: null,
    maxMeetingHours: null,
    billingPeriodDays: 30,
    organizations: true,
    /** A larger allowance, not an unlimited one. */
    organizationSeats: 100,
    checkoutId: "nexa-meet-enterprise-monthly",
  },
} as const;

export type PlanId = keyof typeof PLANS;

/** Plans sold through self-serve checkout. Free is the default. */
export const PAID_PLAN_IDS = ["business", "enterprise"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

/**
 * Map a stored Razorpay line item back to its plan. Payment rows written
 * before Enterprise existed carry only the Business id, so they keep
 * resolving to Business.
 */
export function paidPlanFromCheckoutId(id: string): PaidPlanId | null {
  for (const planId of PAID_PLAN_IDS) {
    if (PLANS[planId].checkoutId === id) return planId;
  }
  return null;
}

/** Narrow an untrusted argument to a self-serve plan id. */
export function isPaidPlanId(value: string): value is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(value);
}

/**
 * Public contact inbox — Enterprise enquiries from the landing page, data
 * and legal requests, and in-room problem reports. Lives on the domain the
 * app is published on; change it here, never in a component.
 */
export const SUPPORT_EMAIL = "support@nexameet.in";

/* ------------------------------------------------------------------ *
 * Billing (Razorpay)
 * ------------------------------------------------------------------ */

/**
 * The one plan sold through self-serve checkout — Business. Amounts are in
 * the currency's smallest unit (paise for INR).
 */
export const RAZORPAY_PLAN = {
  id: PLANS.business.checkoutId,
  name: "Nexa Meet Business",
  description:
    "Up to 100 participants, eight-hour meetings, and a shared workspace for up to 25 people.",
  amountPaise: PLANS.business.pricePaise,
  currency: "INR",
  billingPeriodDays: PLANS.business.billingPeriodDays,
} as const;

/**
 * The checkout catalogue. Amounts are read from PLANS, never from the
 * browser, so a request cannot buy Enterprise at Business prices.
 */
export const CHECKOUT_PLANS = {
  business: {
    id: PLANS.business.checkoutId as string,
    name: "Nexa Meet Business",
    description:
      "100 participants, 8-hour meetings, and organizations with 25 seats.",
    amountPaise: PLANS.business.pricePaise,
    currency: "INR",
    billingPeriodDays: PLANS.business.billingPeriodDays,
  },
  enterprise: {
    id: PLANS.enterprise.checkoutId as string,
    name: "Nexa Meet Enterprise",
    description:
      "Unlimited participants, no meeting time limit, and organizations with 100 seats.",
    amountPaise: PLANS.enterprise.pricePaise,
    currency: "INR",
    billingPeriodDays: PLANS.enterprise.billingPeriodDays,
  },
} as const satisfies Record<
  PaidPlanId,
  {
    id: string;
    name: string;
    description: string;
    amountPaise: number;
    currency: string;
    billingPeriodDays: number;
  }
>;

/* ------------------------------------------------------------------ *
 * Organizations
 * ------------------------------------------------------------------ */

export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const MEETING_VISIBILITIES = [
  "personal",
  "organization",
  "private",
] as const;
export type MeetingVisibility = (typeof MEETING_VISIBILITIES)[number];

/** One address, one use, one week. */
export const ORGANIZATION_INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
export const MAX_PENDING_INVITATIONS = 50;
export const MAX_OWNED_ORGANIZATIONS = 3;
export const MAX_ORGANIZATIONS_PER_USER = 20;
export const INVITATION_LIMIT = { max: 20, windowMs: 60 * 60_000 };

/**
 * Subscription expiry policy.
 *
 * A workspace keeps its data forever; only functionality narrows. For the
 * first ORGANIZATION_GRACE_DAYS after the paid period ends, existing
 * meetings stay joinable so a call in progress is not cut off. After that,
 * organization meetings can no longer be joined and only the owner can open
 * the workspace (to renew or delete it). No meeting, member, invitation or
 * payment row is deleted on expiry.
 */
export const ORGANIZATION_GRACE_DAYS = 7;

export const ORG_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
export const ORG_NAME_MAX = 64;
export const ORG_MEETING_TITLE_MAX = 120;

export function normalizeOrganizationSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

export function isValidOrganizationSlug(slug: string): boolean {
  return ORG_SLUG_REGEX.test(slug);
}

/** Everything organization surfaces say, in one place. */
export const ORGANIZATIONS = {
  notFound: "That workspace doesn't exist, or you don't have access to it.",
  notMember: "You're not a member of this workspace.",
  archived: "This workspace has been deleted. Its billing records are retained.",
  unverified:
    "Confirm your email address before joining a workspace. Sign in with Google, or with an email code, so we know the address is yours.",
  anonymous:
    "A guest session can't join a workspace. Sign in with a verified email address first.",
  orgsDisabled:
    "Organizations are part of the Business and Enterprise plans. Upgrade to create a workspace.",
  subscribe:
    "This workspace needs an active Business or Enterprise subscription before members can meet.",
  expired:
    "This workspace's subscription has ended. Existing data is safe; renew to start meeting again.",
  grace:
    "The subscription has ended. Existing meetings stay joinable for a short grace period; renew to create new ones.",
  noSeats:
    "This workspace has no free seats left. Remove a member or upgrade the plan to add more.",
  lastOwner: "An organization must keep at least one owner. Transfer ownership first.",
  forbidden: "You don't have permission to do that in this workspace.",
  badSlug:
    "Use 3–32 lower-case letters, numbers or hyphens, starting and ending with a letter or number.",
  takenSlug: "That address is already taken. Try a different one.",
  badEmail: "That doesn't look like an email address.",
  alreadyMember: "That person is already a member of this workspace.",
  invitePending: "There's already a pending invitation for that address.",
  inviteInvalid:
    "This invitation is invalid, has expired, or was already used.",
  inviteEmailMismatch:
    "This invitation was sent to a different email address. Sign in with that address to accept it.",
  inviteRevoked: "That invitation has been revoked.",
  meetingsOff:
    "Members can't create organization meetings right now. Ask an owner or admin.",
  privateOnly:
    "Private meetings are visible only to the organizer and the people they invite.",
  revoked:
    "Your access to this meeting was removed because your workspace membership changed.",
  cannotRemoveSelf: "Use “Leave workspace” to remove yourself.",
  cannotRemoveOwner: "The workspace owner can't be removed. Transfer ownership first.",
  cannotInviteAdmin: "Only the owner can invite another admin.",
  cannotChangeOwnerRole: "Ownership can only change through Transfer ownership.",
  transferNeedsMember: "Choose an active member to take ownership.",
  deleteConfirm: "Type the workspace address to confirm deletion.",
  rateLimited:
    "You're doing that too quickly. Wait a moment and try again.",
} as const;

export const PAYMENT_NOT_CONFIGURED =
  "Payments aren't configured on this deployment yet. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the Convex environment to enable checkout.";

export const COPY = {
  meetingGone: "This meeting doesn't exist or has ended.",
  cameraBlocked:
    "Camera access was blocked. Allow camera access in your browser settings.",
  micBlocked:
    "Microphone access was blocked. Allow microphone access in your browser settings.",
  noDevice: "No camera or microphone was found on this device.",
  insecureContext:
    "Camera and microphone require a secure (HTTPS) connection.",
  mediaUnavailable: "You're in the meeting, but your camera and microphone are unavailable.",
  connectionLost: "Connection lost. Reconnecting…",
  peerFailed: "Unable to establish a video connection.",
  meetingFull: "This meeting has reached its participant limit.",
  meetingTimeLimit:
    "This meeting has reached its time limit. Start a new meeting to continue.",
  rateLimited: "Too many requests. Please wait a moment and try again.",
  roomClosed: "This room closed because it was empty. Start a new meeting.",
  chatDmSelf:
    "You're already looking at this conversation — you can't message yourself.",
  chatDmNotInRoom: "That person isn't in this meeting any more.",
  chatDmPickPeer: "Pick someone to message privately.",
  chatNotificationRoom:
    "Someone messaged the room.",
  chatNotificationRoomLine:
    "%s: %s",
  chatNotificationDm:
    "Direct message from %s: %s",
  chatNotificationDmFrom:
    "DM from %s",
} as const;

/* ------------------------------------------------------------------ *
 * Scheduled meetings
 * ------------------------------------------------------------------ */

/** Invitees on a single invitation. */
export const MAX_INVITEES_PER_MEETING = 20; // per booking
/** Recipients one account may email per hour, across all its bookings. */
export const MAX_INVITEES_PER_HOUR = 60;
/** Bookings one account may create per hour. */
export const MAX_BOOKINGS_PER_HOUR = 10;
/** How far ahead a meeting may be booked (a year). */
export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** Deliberately conservative: one @, a dotted domain, nothing exotic. */
const INVITE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/**
 * Split a free-text list of addresses into clean, de-duplicated ones.
 *
 * Returns the bad ones rather than throwing so the caller can name them:
 * silently dropping an address the host typed would look like the invite
 * went out when it didn't.
 */
export function parseInviteEmails(raw: string[]): {
  emails: string[];
  invalid: string[];
} {
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const entry of raw) {
    for (const part of entry.split(/[\s,;]+/)) {
      const email = part.trim().toLowerCase();
      if (email.length === 0) continue;
      if (email.length > 254 || !INVITE_EMAIL_RE.test(email)) {
        invalid.push(email);
        continue;
      }
      seen.add(email);
    }
  }
  return { emails: [...seen], invalid };
}

export const SCHEDULING = {
  guestsBlocked:
    "Sign in with an email address to schedule meetings and send invites.",
  noInvitees: "Add at least one email address to invite.",
  badAddress: "That doesn't look like an email address.",
  tooMany: `You can invite up to ${MAX_INVITEES_PER_MEETING} people at once.`,
  pastDate: "Pick a time in the future.",
  tooFar: "Meetings can be booked up to a year ahead.",
  rateLimited:
    "You've scheduled a lot just now. Try again in a little while.",
  emailNotConfigured:
    "Email isn't set up on this deployment yet, so no invites can be sent.",
  sendFailed: "The invites couldn't be sent. Nothing was scheduled.",
  notFound: "That scheduled meeting no longer exists.",
  badDuration: "Pick a meeting length between 5 minutes and 8 hours.",
  updateFailed: "That change couldn't be saved. The previous details still stand.",
} as const;

/* ------------------------------------------------------------------ *
 * Meeting length
 * ------------------------------------------------------------------ */

/** Lengths offered in the scheduling UI, in minutes. */
export const MEETING_DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;
/** Used when the host doesn't choose one. */
export const DEFAULT_MEETING_MINUTES = 30;
export const MIN_MEETING_MINUTES = 5;
export const MAX_MEETING_MINUTES = 8 * 60;

/**
 * Coerce a meeting length to a sane, five-minute-aligned value.
 *
 * Returns `null` for anything that isn't a real length, so the server can
 * reject it and the browser can say why before sending anything. The default
 * applies when nothing was chosen at all.
 */
export function normalizeMeetingMinutes(
  value: number | null | undefined,
): number | null {
  if (value === undefined || value === null) return DEFAULT_MEETING_MINUTES;
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value / 5) * 5;
  if (rounded < MIN_MEETING_MINUTES || rounded > MAX_MEETING_MINUTES) return null;
  return rounded;
}

/* ------------------------------------------------------------------ *
 * Calendar integration (provider-independent)
 * ------------------------------------------------------------------ */

/** The providers the calendar service knows about. */
export const CALENDAR_PROVIDER_IDS = ["google"] as const;
export type CalendarProviderId = (typeof CALENDAR_PROVIDER_IDS)[number];

/** How long a connect flow's single-use state stays valid. */
export const CALENDAR_OAUTH_STATE_TTL_MS = 10 * 60_000;

/** Give up automatic retries after this many attempts, and say so. */
export const CALENDAR_MAX_SYNC_ATTEMPTS = 8;
/**
 * Retry backoff, indexed by attempt (0-based). Transient network/5xx/429
 * failures walk this ladder; the last value repeats.
 */
export const CALENDAR_RETRY_BACKOFF_MS = [
  15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 3_600_000,
  6 * 3_600_000, 12 * 3_600_000,
] as const;
/** Refresh an access token this long before it actually expires. */
export const CALENDAR_TOKEN_SKEW_MS = 60_000;
/** Connect attempts allowed per hour, per account. */
export const CALENDAR_CONNECT_LIMIT = { max: 20, windowMs: 60 * 60_000 };

/**
 * Everything the calendar surfaces say, so the wording lives in one place.
 * Provider-neutral on purpose: the same strings will describe Microsoft
 * Graph once that adapter exists.
 */
export const CALENDAR = {
  providerLabel: { google: "Google Calendar" } as Record<string, string>,
  notConnected: "Connect a calendar to put your Nexa meetings on it.",
  /**
   * A guest session has an id but no account behind it, so it cannot own a
   * calendar grant: nothing it could book would ever reach the calendar. Say
   * so before offering a button that cannot work.
   */
  guestNeedsSignIn:
    "A calendar attaches to the account you're signed in with, and a guest session has none. Sign in with Google or an email address to connect one.",
  configuredMissing:
    "Calendar sync isn't configured on this deployment yet — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the Convex environment.",
  keyMissing:
    "Calendar credentials can't be stored securely yet — set CALENDAR_TOKEN_KEY in the Convex environment (openssl rand -base64 32).",
  connectFailed:
    "The calendar connection couldn't be started. Please try again.",
  stateExpired:
    "That connection link expired or was already used. Start the connection again.",
  denied: "Calendar access wasn't granted, so nothing was connected.",
  callbackFailed:
    "Google didn't complete the connection. Please start again.",
  connected: "Calendar connected.",
  disconnected: "Calendar disconnected.",
  needsReauth:
    "The calendar access was revoked or expired. Reconnect to keep meetings syncing.",
  /** Wording for a transient provider failure — the retry is automatic. */
  retrying:
    "The calendar didn't respond. Nexa will retry on its own — your meeting is booked either way.",
  failed:
    "The calendar event couldn't be created. Your meeting is still booked; retry the sync.",
  notSynced: "Not on the calendar yet.",
  synced: "On your calendar.",
  cancelled: "Cancelled on your calendar too.",
  pendingApproval:
    "The event is queued for your calendar and will be created automatically.",
  /** Shown on the disconnect confirmation. */
  disconnectKeepsEvents:
    "Disconnecting stops any further syncing. Events Nexa already created stay in your calendar — Nexa just won't update or delete them any more.",
  guestCopies:
    "Google Calendar and anyone you invite may keep their own copy of the event details.",
  scopeExplanation:
    "Nexa asks Google only for permission to create, change and delete events on calendars you own — enough to manage the meetings you schedule here, nothing else. It never records what it can see, and Google always shows you the exact permission on the consent screen.",
  outlookPlanned:
    "Microsoft Outlook is next: the calendar service is provider-independent, so the same scheduling flow will work with Graph.",
} as const;

/** Where a callback sends the browser back to. Always our own origin. */
export const CALENDAR_CALLBACK_PATH = "/dashboard";

/* ------------------------------------------------------------------ *
 * Desktop app
 * ------------------------------------------------------------------ */

/**
 * Where the topbar's "Download app" button points.
 *
 * A web page cannot execute an installer — no browser will let a page run
 * a downloaded `.exe` or `.dmg`. What a click can do is hand the file to
 * the browser's download manager, after which the operating system's own
 * setup wizard takes over. That is the same flow Slack, Zoom and Discord
 * use, and it is the most a browser tab can do.
 *
 * An installer runs to tens of megabytes and the web host rejects deploys
 * over 60MB, so the file is built to `release/` and uploaded to the public
 * Vercel Blob store — never committed under `public/`, which is copied into
 * the deploy verbatim.
 *
 * The URL is baked in as the default rather than required from the
 * environment, because Vite inlines env values at build time and a value
 * missing from the deploying build silently removes the button from the
 * live site. The URL is public — there is nothing to keep out of the
 * bundle — and the upload script keeps it stable across re-uploads.
 * `VITE_DESKTOP_DOWNLOAD_URL` still overrides it, for a proxy or a
 * differently-hosted build.
 *
 * To offer per-OS installers, turn this into a map keyed by platform and
 * choose between the entries from the user agent.
 *
 * This constant can be imported from Convex functions without crashing only
 * when the env lookup is guarded: Convex function modules do not expose
 * `import.meta.env`, so the override is resolved here behind a try/catch and
 * the default is used for the rare server-side import.
 */
const DEFAULT_INSTALLER_URL =
  "https://adpuw9cdw8vaxi0o.public.blob.vercel-storage.com/downloads/Nexa-Meet-Setup.exe";

export const DESKTOP_APP_DOWNLOAD_HREF: string = (() => {
  try {
    const env = (import.meta as { env?: { VITE_DESKTOP_DOWNLOAD_URL?: string } }).env;
    if (env?.VITE_DESKTOP_DOWNLOAD_URL) return env.VITE_DESKTOP_DOWNLOAD_URL;
  } catch {
    /* Convex/server environments do not expose import.meta.env */
  }
  return DEFAULT_INSTALLER_URL;
})();
