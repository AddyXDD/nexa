import type { CalendarProviderId } from "../../../shared/constants";
import type { ZonedDateTime } from "../../../shared/time";

/**
 * The calendar provider contract.
 *
 * Nexa's scheduling feature talks to *this*, never to Google directly. The
 * shapes below are deliberately provider-neutral (an instant, an IANA zone,
 * an attendee list, an opaque event id) so a Microsoft Graph adapter can be
 * dropped in beside the Google one without the sync service, the schema, or
 * the UI changing.
 */

export type ProviderTokens = {
  accessToken: string;
  /** Absent on refresh responses; always keep the stored one. */
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
  /** Display only — which account the user connected. */
  accountEmail?: string | null;
  accountId?: string | null;
};

/** What the calendar event should look like. Applied on every attempt. */
export type EventTarget = {
  title: string;
  description: string;
  /** The Nexa join link; also placed in the event's location. */
  joinUrl: string;
  startsAt: number;
  endsAt: number;
  timeZone: string;
  attendees: string[];
  /**
   * The id we ask the provider to use. Stable for the life of the mapping, so
   * a retry after an uncertain outcome cannot create a second event.
   */
  eventId: string;
};

export type ProviderEvent = {
  id: string;
  htmlLink?: string | null;
  organizerEmail?: string | null;
  start?: ZonedDateTime | null;
  end?: ZonedDateTime | null;
};

/**
 * How a provider failure should be handled — the single most important thing
 * an adapter decides. Everything the sync service does (retry, ask the user to
 * reconnect, give up, or claim success) follows from this classification.
 */
export type CalendarErrorKind =
  /** Network blip, 5xx, timeout: retry with backoff. */
  | "transient"
  /** Too many requests: retry, but slowly. */
  | "rate_limited"
  /** Token revoked or expired beyond recovery: the user must reconnect. */
  | "reauth_required"
  /** Our fault (bad input, missing permission): retrying won't help. */
  | "permanent"
  /** The event is gone on the provider side. Safe to treat as deleted. */
  | "not_found";

export class CalendarProviderError extends Error {
  readonly kind: CalendarErrorKind;
  readonly status?: number;
  /** Provider-supplied detail, for logs only. Never shown verbatim. */
  readonly detail?: string;

  constructor(
    kind: CalendarErrorKind,
    message: string,
    options: { status?: number; detail?: string } = {},
  ) {
    super(message);
    this.name = "CalendarProviderError";
    this.kind = kind;
    this.status = options.status;
    this.detail = options.detail;
  }

  /** Worth another attempt later, without the user doing anything. */
  get retryable(): boolean {
    return this.kind === "transient" || this.kind === "rate_limited";
  }
}

/** Normalize anything thrown by an adapter (or fetch) into our taxonomy. */
export function asProviderError(error: unknown): CalendarProviderError {
  if (error instanceof CalendarProviderError) return error;
  // A bare fetch rejection is a network failure: outcome unknown, so retry.
  return new CalendarProviderError(
    "transient",
    "The calendar service could not be reached.",
  );
}

export type OAuthExchangeArgs = {
  code: string;
  codeVerifier: string;
  redirectUri: string;
};

/**
 * One provider, as the rest of the system sees it. `registry.ts` returns
 * these objects; nothing else imports a provider adapter.
 */
export type CalendarProvider = {
  id: CalendarProviderId;
  /** Product-facing name, e.g. "Google Calendar". */
  label: string;
  /** The scopes we ask for, in provider syntax. */
  scopes: readonly string[];
  /** Consent screen URL to send the browser to. */
  authorizeUrl(args: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  /** Authorization code + PKCE verifier → tokens. */
  exchangeCode(args: OAuthExchangeArgs): Promise<ProviderTokens>;
  /** Refresh token → a fresh access token. */
  refresh(refreshToken: string): Promise<ProviderTokens>;
  /** Best-effort revoke of a grant, so disconnecting really disconnects. */
  revoke(token: string): Promise<void>;
  /** Create the event under our own id. Must be idempotent. */
  createEvent(args: {
    tokens: ProviderTokens;
    calendarId: string;
    target: EventTarget;
  }): Promise<ProviderEvent>;
  /** Apply the target to an existing event. */
  updateEvent(args: {
    tokens: ProviderTokens;
    calendarId: string;
    eventId: string;
    target: EventTarget;
  }): Promise<ProviderEvent>;
  /** Remove an event. `not_found` is a success for the caller. */
  deleteEvent(args: {
    tokens: ProviderTokens;
    calendarId: string;
    eventId: string;
  }): Promise<void>;
  /** Read an event back — used to confirm an uncertain create. */
  getEvent(args: {
    tokens: ProviderTokens;
    calendarId: string;
    eventId: string;
  }): Promise<ProviderEvent>;
};
