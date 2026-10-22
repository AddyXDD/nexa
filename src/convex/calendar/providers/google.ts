import { CALENDAR } from "../../../shared/constants";
import { toProviderDateTime } from "../../../shared/time";
import {
  CalendarProviderError,
  asProviderError,
  type CalendarProvider,
  type EventTarget,
  type ProviderEvent,
  type ProviderTokens,
} from "./types";

/**
 * Google Calendar adapter.
 *
 * Everything Google-specific lives here: endpoint URLs, the scope string, the
 * request bodies, and — most importantly — the translation of an HTTP status
 * into Nexa's failure taxonomy. Nothing above this file knows what a Google
 * error code looks like.
 *
 * Two properties matter for correctness upstream:
 *
 *  1. Event creation is idempotent. We choose the event id before the first
 *     request and reuse it forever, and Google accepts a caller-supplied id in
 *     base32hex. If a create times out after Google committed it, the retry
 *     gets 409 duplicate and we confirm the existing event instead of making a
 *     second one.
 *  2. Every call has a deadline. A hung request is not a failed request — the
 *     outcome is unknown — so it is classified transient and retried against
 *     the same id.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The narrowest Google scopes that do this job:
 *
 *  - `calendar.events.owned` — "See, create, change, and delete events on
 *    Google calendars you own." It is the one Calendar scope that permits
 *    insert/patch/delete without asking for the whole calendar or for sharing
 *    control, so it is what we request. Deliberately NOT `calendar.events`
 *    (every calendar the user can see) and NOT `calendar` (which can also
 *    change sharing and settings).
 *  - `openid email` — only so the settings card can say *which* Google account
 *    is connected instead of an anonymous "Connected". These are basic
 *    identity scopes, not calendar access, and Nexa stores only the address.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.owned",
] as const;

export const GOOGLE_CALENDAR_SCOPE = GOOGLE_SCOPES[2];

const DEFAULT_SYNC_CALENDAR_ID = "primary";

export function googleClientCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new CalendarProviderError("permanent", CALENDAR.configuredMissing);
  }
  return { clientId, clientSecret };
}

/** A fetch with a deadline, so a stalled connection can't hang an action. */
async function request(
  url: string,
  init: RequestInit & { fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const { fetchImpl = fetch, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...rest, signal: controller.signal });
  } catch (error) {
    // Network failure or deadline: the outcome is unknown, never "no".
    throw asProviderError(error);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    if (!text) return {};
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Google's error envelope, reduced to a reason string for classification. */
function errorReason(body: Record<string, unknown>): string {
  const error = body.error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const details = (error as { errors?: unknown }).errors;
    if (Array.isArray(details) && details.length > 0) {
      const first = details[0] as { reason?: unknown };
      if (typeof first?.reason === "string") return first.reason;
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function errorMessageOf(body: Record<string, unknown>): string {
  const error = body.error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof body.error_description === "string") return body.error_description;
  return "";
}

/** HTTP status + Google reason → Nexa's failure taxonomy. */
function classify(
  status: number,
  body: Record<string, unknown>,
): CalendarProviderError {
  const reason = errorReason(body);
  const detail = errorMessageOf(body);
  if (status === 401) {
    return new CalendarProviderError("reauth_required", "Access token rejected.", {
      status,
      detail,
    });
  }
  if (status === 403) {
    // Quota and throttling are 403s on Google APIs; they are retryable,
    // while a genuine permission problem is not.
    if (
      reason === "rateLimitExceeded" ||
      reason === "userRateLimitExceeded" ||
      reason === "quotaExceeded" ||
      reason === "backendError"
    ) {
      return new CalendarProviderError("rate_limited", "Google is throttling us.", {
        status,
        detail,
      });
    }
    return new CalendarProviderError("permanent", "Google refused the request.", {
      status,
      detail,
    });
  }
  if (status === 404 || status === 410) {
    return new CalendarProviderError("not_found", "The event no longer exists.", {
      status,
      detail,
    });
  }
  if (status === 408 || status === 429) {
    return new CalendarProviderError("rate_limited", "Google asked us to slow down.", {
      status,
      detail,
    });
  }
  if (status >= 500) {
    return new CalendarProviderError("transient", "Google had a server error.", {
      status,
      detail,
    });
  }
  return new CalendarProviderError("permanent", "Google rejected the request.", {
    status,
    detail,
  });
}

/** Token-endpoint failures: `invalid_grant` means the user must reconnect. */
function classifyTokenError(
  status: number,
  body: Record<string, unknown>,
): CalendarProviderError {
  const reason = errorReason(body);
  if (reason === "invalid_grant") {
    return new CalendarProviderError(
      "reauth_required",
      "The Google grant is no longer valid.",
      { status, detail: errorMessageOf(body) },
    );
  }
  if (status >= 500 || status === 429) {
    return new CalendarProviderError("transient", "Google's token endpoint is busy.", {
      status,
      detail: errorMessageOf(body),
    });
  }
  return new CalendarProviderError("permanent", "Google refused the token request.", {
    status,
    detail: errorMessageOf(body),
  });
}

/**
 * Pull `email` / `sub` out of the id_token. The token came straight from
 * Google over TLS in this server-to-server call, so the payload is read
 * without re-verifying the signature; nothing is trusted for authorization.
 */
function identityFromIdToken(
  idToken: string | undefined,
): { email: string | null; sub: string | null } {
  if (!idToken) return { email: null, sub: null };
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return { email: null, sub: null };
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const claims = JSON.parse(decoded) as { email?: unknown; sub?: unknown };
    return {
      email: typeof claims.email === "string" ? claims.email : null,
      sub: typeof claims.sub === "string" ? claims.sub : null,
    };
  } catch {
    return { email: null, sub: null };
  }
}

function tokensFromResponse(
  body: Record<string, unknown>,
  fallbackRefreshToken?: string,
  scopesFallback: readonly string[] = GOOGLE_SCOPES,
): ProviderTokens {
  const accessToken = typeof body.access_token === "string" ? body.access_token : null;
  if (!accessToken) {
    throw new CalendarProviderError(
      "permanent",
      "Google's token response had no access token.",
    );
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  const grantedScopes =
    typeof body.scope === "string" && body.scope.length > 0
      ? body.scope.split(/\s+/)
      : [...scopesFallback];
  // A refresh response usually omits the refresh token: keep the stored one.
  const refreshToken =
    typeof body.refresh_token === "string" && body.refresh_token.length > 0
      ? body.refresh_token
      : fallbackRefreshToken;
  const identity = identityFromIdToken(
    typeof body.id_token === "string" ? body.id_token : undefined,
  );
  return {
    accessToken,
    refreshToken,
    // Expire a minute early so a call never starts with a token that dies
    // mid-flight; the sync layer also re-checks before every request.
    expiresAt: Date.now() + Math.max(0, expiresIn - 60) * 1000,
    scopes: grantedScopes,
    accountEmail: identity.email,
    accountId: identity.sub,
  };
}

function eventBody(target: EventTarget): Record<string, unknown> {
  const start = toProviderDateTime(target.startsAt, target.timeZone);
  const end = toProviderDateTime(target.endsAt, start.timeZone);
  const body: Record<string, unknown> = {
    id: target.eventId,
    summary: target.title,
    start: { dateTime: start.dateTime, timeZone: start.timeZone },
    end: { dateTime: end.dateTime, timeZone: end.timeZone },
    // A marker, not a payload: lets a human tell where the event came from
    // without duplicating anything sensitive into the calendar.
    extendedProperties: { private: { nexaIntegration: "nexa-meet" } },
  };
  if (target.description) body.description = target.description;
  if (target.joinUrl) body.location = target.joinUrl;
  if (target.attendees.length > 0) {
    body.attendees = target.attendees.map((email) => ({ email }));
  }
  return body;
}

function toProviderEvent(body: Record<string, unknown>): ProviderEvent {
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    throw new CalendarProviderError("permanent", "Google returned an event without an id.");
  }
  const organizer = body.organizer as { email?: unknown } | undefined;
  return {
    id,
    htmlLink: typeof body.htmlLink === "string" ? body.htmlLink : null,
    organizerEmail: typeof organizer?.email === "string" ? organizer.email : null,
  };
}

function authHeader(tokens: ProviderTokens): Record<string, string> {
  return {
    Authorization: `Bearer ${tokens.accessToken}`,
    "Content-Type": "application/json",
  };
}

function eventUrl(calendarId: string, eventId: string, sendUpdates: boolean): string {
  const params = new URLSearchParams();
  // Guests are notified by Google, which is the whole point of the
  // integration: the invitation comes from the organiser's own calendar.
  params.set("sendUpdates", sendUpdates ? "all" : "none");
  return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(
    eventId,
  )}?${params.toString()}`;
}

export const googleCalendarProvider: CalendarProvider = {
  id: "google",
  label: "Google Calendar",
  scopes: GOOGLE_SCOPES,

  authorizeUrl({ state, codeChallenge, redirectUri }) {
    const { clientId } = googleClientCredentials();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      state,
      // PKCE, on top of the client secret: a stolen authorization code is
      // useless without the verifier we keep server-side.
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      // Offline access + an explicit consent prompt is what reliably returns
      // a refresh token, including on a reconnect after a revoke.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  },

  async exchangeCode({ code, codeVerifier, redirectUri }) {
    const { clientId, clientSecret } = googleClientCredentials();
    const response = await request(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    const body = await readJson(response);
    if (!response.ok) throw classifyTokenError(response.status, body);
    return tokensFromResponse(body);
  },

  async refresh(refreshToken) {
    const { clientId, clientSecret } = googleClientCredentials();
    const response = await request(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }).toString(),
    });
    const body = await readJson(response);
    if (!response.ok) throw classifyTokenError(response.status, body);
    return tokensFromResponse(body, refreshToken);
  },

  async revoke(token) {
    // Best effort: Google returns 200 for a valid token, 400 for one it
    // doesn't know (already revoked). Neither should block a disconnect.
    try {
      await request(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {
      /* a network failure here must not trap the user in "connected" */
    }
  },

  async createEvent({ tokens, calendarId, target }) {
    const params = new URLSearchParams({ sendUpdates: "all" });
    const response = await request(
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      {
        method: "POST",
        headers: authHeader(tokens),
        body: JSON.stringify(eventBody(target)),
      },
    );
    if (response.status === 409) {
      // Our chosen id already exists, which means a previous attempt did
      // commit. This is the idempotency path, not an error: confirm the
      // event and treat the create as done.
      return await googleCalendarProvider.getEvent({
        tokens,
        calendarId,
        eventId: target.eventId,
      });
    }
    const body = await readJson(response);
    if (!response.ok) throw classify(response.status, body);
    return toProviderEvent(body);
  },

  async updateEvent({ tokens, calendarId, eventId, target }) {
    const response = await request(eventUrl(calendarId, eventId, true), {
      method: "PATCH",
      headers: authHeader(tokens),
      // PATCH changes only what we send; arrays we send replace the old ones,
      // so the attendee list always ends up matching the booking.
      body: JSON.stringify(eventBody(target)),
    });
    const body = await readJson(response);
    if (!response.ok) throw classify(response.status, body);
    return toProviderEvent(body);
  },

  async deleteEvent({ tokens, calendarId, eventId }) {
    const response = await request(eventUrl(calendarId, eventId, true), {
      method: "DELETE",
      headers: authHeader(tokens),
    });
    if (response.ok || response.status === 404 || response.status === 410) return;
    const body = await readJson(response);
    throw classify(response.status, body);
  },

  async getEvent({ tokens, calendarId, eventId }) {
    const params = new URLSearchParams({ fields: "id,htmlLink,organizer,start,end" });
    const response = await request(
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(
        eventId,
      )}?${params.toString()}`,
      { method: "GET", headers: authHeader(tokens) },
    );
    const body = await readJson(response);
    if (!response.ok) throw classify(response.status, body);
    return toProviderEvent(body);
  },
};

/**
 * Fallback used only when the id_token carries no address (some Workspace
 * configurations). Costs one HTTP call, once per connection.
 */
export async function fetchGoogleAccountEmail(
  accessToken: string,
): Promise<string | null> {
  try {
    const response = await request(USERINFO_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body = await readJson(response);
    return typeof body.email === "string" ? body.email : null;
  } catch {
    return null;
  }
}

export const DEFAULT_GOOGLE_CALENDAR_ID = DEFAULT_SYNC_CALENDAR_ID;
