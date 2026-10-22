import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

export const organizationRoleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
);
export type OrganizationRole = Infer<typeof organizationRoleValidator>;

export const meetingVisibilityValidator = v.union(
  // Personal rooms are the pre-organizations product: the code is the
  // capability, exactly as before.
  v.literal("personal"),
  // Every active member of the organization may discover and join.
  v.literal("organization"),
  // Only the organizer and explicitly authorized people may discover/join.
  v.literal("private"),
);
export type MeetingVisibility = Infer<typeof meetingVisibilityValidator>;

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // PERSISTENT ACCOUNT DATA.
    // The users table is the default users table brought in by authTables,
    // extended with the anonymous Nexa identity.
    users: defineTable({
      name: v.optional(v.string()), // display name. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // the role of the user. do not remove

      // Nexa ID, e.g. NX-7F42K9. Generated server-side once per account,
      // never derived from email or any other personal data. It is the ONLY
      // identity other participants ever see.
      nexaId: v.optional(v.string()),
      nexaIdAssignedAt: v.optional(v.number()),
    })
      .index("email", ["email"]) // index for the email. do not remove or modify
      .index("by_nexaId", ["nexaId"]),

    // ---- TEMPORARY MEETING DATA -------------------------------------
    // Everything below exists only while a meeting is alive. Nothing here
    // is a record of past meetings: rows are deleted when the room closes
    // and swept if a client disappears without saying goodbye.

    meetings: defineTable({
      code: v.string(), // 16-char, 80-bit unguessable room code
      hostUserId: v.id("users"), // server-side attribution only
      createdAt: v.number(),
      active: v.boolean(),
      endedAt: v.optional(v.number()),
      emptySince: v.optional(v.number()),
      // When the first seat was taken — the host's plan allows a fixed
      // meeting length (2h Free / 8h Business), counted from here.
      startedAt: v.optional(v.number()),
      // Absent on every pre-organizations row, which is why personal rooms
      // keep their exact old behaviour.
      organizationId: v.optional(v.id("organizations")),
      visibility: v.optional(meetingVisibilityValidator),
    })
      .index("by_code", ["code"])
      .index("by_createdAt", ["createdAt"])
      .index("by_organization", ["organizationId"]),

    participants: defineTable({
      meetingCode: v.string(),
      userId: v.id("users"),
      sessionId: v.string(), // per-tab session handle (client-generated UUID)
      nexaId: v.string(), // snapshot for fast, minimal presence queries
      displayName: v.optional(v.string()),
      joinedAt: v.number(),
      lastSeenAt: v.number(), // heartbeat: ghosts are swept automatically
      micOn: v.boolean(),
      camOn: v.boolean(),
      sharing: v.boolean(),
    })
      .index("by_meeting", ["meetingCode"])
      .index("by_meeting_session", ["meetingCode", "sessionId"])
      .index("by_user", ["userId"])
      .index("by_lastSeen", ["lastSeenAt"]),

    // SDP offers/answers/ICE candidates in flight. Consumed by the addressee
    // and deleted; a sweeper removes anything left behind.
    signals: defineTable({
      meetingCode: v.string(),
      fromSessionId: v.string(),
      toSessionId: v.string(),
      kind: v.union(
        v.literal("offer"),
        v.literal("answer"),
        v.literal("candidate"),
        v.literal("renegotiate"),
        v.literal("reaction"),
        // E2EE public key announcement. Additive: existing rows and the
        // existing kinds are untouched.
        v.literal("e2ee"),
      ),
      payload: v.string(), // JSON-encoded SDP or ICE candidate
      createdAt: v.number(),
    })
      .index("by_meeting_to", ["meetingCode", "toSessionId"])
      .index("by_meeting", ["meetingCode"])
      .index("by_createdAt", ["createdAt"]),

    // Ephemeral meeting chat. Destroyed when the meeting ends; never a
    // durable message history.
    chatMessages: defineTable({
      meetingCode: v.string(),
      sessionId: v.string(),
      userId: v.id("users"),
      nexaId: v.string(),
      displayName: v.optional(v.string()),
      text: v.string(), // validated: trimmed, non-empty, <= MAX_CHAT_LENGTH
      sentAt: v.number(),
      // "everyone" (the room) or "dm" (one other participant). Optional so
      // rows written before direct messages existed still read as room chat.
      scope: v.optional(v.union(v.literal("everyone"), v.literal("dm"))),
      // Direct messages only. The addressee's session, and a snapshot of
      // their name so a thread still reads correctly after they leave.
      toSessionId: v.optional(v.string()),
      toNexaId: v.optional(v.string()),
      toDisplayName: v.optional(v.string()),
      // Direct messages only: the two session ids in a fixed order, so both
      // sides of a conversation read the same thread.
      dmPair: v.optional(v.string()),
    })
      .index("by_meeting_sentAt", ["meetingCode", "sentAt"])
      // Room chat is only ever read through scope=eq("everyone"), so a direct
      // message is structurally unable to surface in the room transcript.
      .index("by_meeting_scope_sentAt", ["meetingCode", "scope", "sentAt"])
      .index("by_meeting_pair_sentAt", ["meetingCode", "dmPair", "sentAt"])
      .index("by_sentAt", ["sentAt"]),

    // Short-lived sliding-window counters for abuse protection.
    // Deleted by the sweeper as soon as their window expires.
    rateLimits: defineTable({
      key: v.string(),
      windowStart: v.number(),
      count: v.number(),
    }).index("by_key", ["key"]),

    // ADMINISTRATORS — deliberately a separate credential system from the
    // customer accounts above. An admin does not sign in with a Nexa account,
    // holds no row in `users`, and shares no session with the product. Its
    // password is stored only as a PBKDF2 hash; the live session is stored
    // only as a hash too, so reading this table yields nothing usable.
    admins: defineTable({
      email: v.string(), // lowercased, unique
      name: v.optional(v.string()),
      passwordHash: v.string(), // base64 PBKDF2-SHA256(password, salt)
      passwordSalt: v.string(), // base64, 16 random bytes
      passwordSetAt: v.number(),
      lastLoginAt: v.optional(v.number()),
      failedLogins: v.optional(v.number()),
      // SHA-256 of the bearer token the browser holds; the token itself is
      // never persisted.
      sessionHash: v.optional(v.string()),
      sessionExpiresAt: v.optional(v.number()),
      disabled: v.optional(v.boolean()),
    })
      .index("by_email", ["email"])
      .index("by_sessionHash", ["sessionHash"]),

    // DEPLOYMENT METRICS.
    // One durable number per metric and nothing else: no room code, no
    // account, no per-meeting timestamp. Meeting rows are deleted when a room
    // closes — that is the product's promise — so a counter is the only way
    // to answer "how many meetings have been held". It stores a running total
    // rather than a log deliberately: it cannot become a de-facto history of
    // who met whom.
    counters: defineTable({
      key: v.string(), // e.g. "meetings.created"
      value: v.number(),
      since: v.number(), // when counting began, set on the first increment
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    // PERSISTENT ACCOUNT DATA (billing). Payment records are the one thing
    // a privacy-first product must keep: they are financial records. They
    // are never mixed with temporary meeting state.
    payments: defineTable({
      userId: v.id("users"),
      razorpayOrderId: v.string(),
      razorpayPaymentId: v.optional(v.string()),
      amount: v.number(), // smallest currency unit (paise)
      currency: v.string(),
      planId: v.string(),
      status: v.union(
        v.literal("created"),
        v.literal("paid"),
        v.literal("failed"),
      ),
      createdAt: v.number(),
      paidAt: v.optional(v.number()),
      // When the purchase is for a workspace, the entitlement belongs to the
      // organization — never to the paying member's personal account.
      organizationId: v.optional(v.id("organizations")),
    })
      .index("by_user", ["userId"])
      .index("by_orderId", ["razorpayOrderId"])
      .index("by_createdAt", ["createdAt"])
      .index("by_organization", ["organizationId"]),

    // SCHEDULED MEETINGS
    // A booking is not room state: it outlives the call it points at, so it
    // lives with payments rather than with the ephemeral tables above. Only
    // what is needed to honour the booking is kept — who made it, when, the
    // code, and the addresses it was sent to (so the host can resend or
    // cancel). Nothing about who actually attends is recorded here.
    scheduledMeetings: defineTable({
      code: v.string(), // the room code; the room itself is created on demand
      hostUserId: v.id("users"),
      title: v.optional(v.string()),
      startsAt: v.number(), // epoch ms, chosen by the host
      timeZone: v.optional(v.string()), // IANA zone the host picked it in
      invitees: v.array(v.string()), // addresses the booking was sent to
      createdAt: v.number(),
      status: v.union(v.literal("scheduled"), v.literal("cancelled")),
      invitesSentAt: v.optional(v.number()),
      invitesSent: v.optional(v.number()),
      /** How long the meeting runs. StartsAt + this = the end, in UTC ms. */
      durationMinutes: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      calendarProvider: v.optional(v.string()), // provider mirrored in a calendar, if any
      // Organization meetings reuse the booking as their durable record.
      organizationId: v.optional(v.id("organizations")),
      visibility: v.optional(meetingVisibilityValidator),
      createdByUserId: v.optional(v.id("users")),
    })
      .index("by_host", ["hostUserId"])
      .index("by_host_created", ["hostUserId", "createdAt"])
      .index("by_code", ["code"])
      .index("by_organization_starts", ["organizationId", "startsAt"]),

    /* ---------------------------------------------------------------- *
     * CALENDAR INTEGRATION (persistent account data)
     *
     * Three tables, one per concern:
     *   calendarConnections  — one OAuth grant per (account, provider).
     *                          Tokens are AES-256-GCM ciphertext; the key
     *                          lives only in the deployment environment and
     *                          is used only inside actions/http actions.
     *   calendarOAuthStates  — single-use, short-lived CSRF state for a
     *                          connect flow, plus the PKCE verifier for it.
     *   calendarEvents       — the mapping between a Nexa meeting and the
     *                          provider's event, carrying the desired state
     *                          so a retry reconciles instead of duplicating.
     * ---------------------------------------------------------------- */

    calendarConnections: defineTable({
      userId: v.id("users"),
      provider: v.string(), // "google" today; "microsoft" later
      status: v.union(
        v.literal("connected"),
        v.literal("needs_reauth"),
        v.literal("revoked"),
      ),
      // Display only: which Google account is connected. Never an identifier.
      accountEmail: v.optional(v.string()),
      accountId: v.optional(v.string()), // provider subject id
      scopes: v.array(v.string()), // scopes actually granted, not requested
      // SECRETS. Encrypted at rest; never returned by any query, never logged.
      accessTokenEnc: v.optional(v.string()),
      refreshTokenEnc: v.optional(v.string()),
      accessTokenExpiresAt: v.optional(v.number()),
      keyVersion: v.optional(v.number()), // encryption scheme version
      calendarId: v.string(), // the calendar Nexa writes to
      connectedAt: v.number(),
      lastRefreshAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      lastErrorAt: v.optional(v.number()),
      disconnectedAt: v.optional(v.number()),
    })
      .index("by_user_provider", ["userId", "provider"])
      .index("by_provider_status", ["provider", "status"]),

    calendarOAuthStates: defineTable({
      // SHA-256 of the state token: a database read cannot forge a callback.
      stateHash: v.string(),
      provider: v.string(),
      userId: v.id("users"),
      // PKCE verifier, encrypted. Consumed once, then the row is dead.
      codeVerifierEnc: v.string(),
      /** Validated, same-origin destination the callback may redirect to. */
      redirectTo: v.string(),
      createdAt: v.number(),
      expiresAt: v.number(),
      consumedAt: v.optional(v.number()),
    })
      .index("by_stateHash", ["stateHash"])
      .index("by_expiresAt", ["expiresAt"]),

    /* ---------------------------------------------------------------- *
     * ORGANIZATIONS (paid workspace data)
     *
     * A workspace is its own tenant. Every organization query and mutation
     * resolves membership from the authenticated session; no client-supplied
     * user id, role, seat count or subscription flag is trusted.
     * ---------------------------------------------------------------- */

    organizations: defineTable({
      name: v.string(),
      slug: v.string(), // normalized, unique
      ownerUserId: v.id("users"),
      status: v.union(v.literal("active"), v.literal("archived")),
      // Snapshot of the seats the active entitlement grants. Enforcement
      // always derives the value from the current subscription.
      seatLimit: v.number(),
      settings: v.object({
        membersCanCreateMeetings: v.boolean(),
      }),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_slug", ["slug"])
      .index("by_owner", ["ownerUserId"])
      .index("by_status", ["status"]),

    organizationMemberships: defineTable({
      organizationId: v.id("organizations"),
      userId: v.id("users"),
      role: organizationRoleValidator,
      status: v.union(v.literal("active"), v.literal("removed")),
      joinedAt: v.number(),
      updatedAt: v.number(),
      invitedByUserId: v.optional(v.id("users")),
    })
      .index("by_org", ["organizationId"])
      .index("by_org_status", ["organizationId", "status"])
      .index("by_user", ["userId"])
      .index("by_user_status", ["userId", "status"])
      .index("by_org_user", ["organizationId", "userId"]),

    organizationInvitations: defineTable({
      organizationId: v.id("organizations"),
      email: v.string(), // normalized lower-case address
      inviterUserId: v.id("users"),
      role: v.union(v.literal("admin"), v.literal("member")),
      // SHA-256 of the bearer token. The token itself is shown once and
      // never stored, so a database read cannot mint an invitation link.
      tokenHash: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("revoked"),
        v.literal("expired"),
      ),
      createdAt: v.number(),
      expiresAt: v.number(),
      acceptedAt: v.optional(v.number()),
      acceptedByUserId: v.optional(v.id("users")),
      revokedAt: v.optional(v.number()),
    })
      .index("by_tokenHash", ["tokenHash"])
      .index("by_org", ["organizationId"])
      .index("by_org_status", ["organizationId", "status"])
      .index("by_org_email", ["organizationId", "email"])
      .index("by_email_status", ["email", "status"]),

    // Explicit access to a private organization meeting. Organization
    // membership alone never grants access.
    meetingAccess: defineTable({
      meetingId: v.id("scheduledMeetings"),
      userId: v.id("users"),
      grantedByUserId: v.id("users"),
      grantedAt: v.number(),
    })
      .index("by_meeting", ["meetingId"])
      .index("by_meeting_user", ["meetingId", "userId"])
      .index("by_user", ["userId"]),

    calendarEvents: defineTable({
      provider: v.string(),
      hostUserId: v.id("users"),
      meetingId: v.id("scheduledMeetings"),
      meetingCode: v.string(),
      connectionId: v.id("calendarConnections"),
      calendarId: v.string(),
      /**
       * The provider event id we *choose* before creating anything. Google
       * accepts a caller-supplied id (base32hex), which makes creation
       * idempotent: a retry after a timeout re-sends the same id and gets
       * 409 duplicate instead of a second event.
       */
      eventId: v.string(),
      externalEventId: v.optional(v.string()), // set once the provider confirms
      htmlLink: v.optional(v.string()),
      syncStatus: v.union(
        v.literal("pending"),
        v.literal("synced"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      attempts: v.number(),
      lastAttemptAt: v.optional(v.number()),
      /** When the retry job should next look at this row. */
      nextAttemptAt: v.optional(v.number()),
      lastSyncedAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      needsReauth: v.optional(v.boolean()),
      cancelledAt: v.optional(v.number()),
      /**
       * The declarative target: what the calendar event *should* look like.
       * Every attempt applies this snapshot, so retries converge instead of
       * replaying an operation and duplicating it.
       */
      desired: v.object({
        title: v.string(),
        startsAt: v.number(),
        endsAt: v.number(),
        timeZone: v.string(),
        invitees: v.array(v.string()),
        joinUrl: v.string(),
        cancelled: v.boolean(),
      }),
    })
      .index("by_meeting", ["meetingId"])
      .index("by_meeting_code", ["meetingCode"])
      .index("by_host", ["hostUserId"])
      .index("by_host_status", ["hostUserId", "syncStatus"])
      .index("by_status_next", ["syncStatus", "nextAttemptAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
