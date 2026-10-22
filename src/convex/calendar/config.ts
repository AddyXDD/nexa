import { ConvexError } from "convex/values";
import { CALENDAR, CALENDAR_CALLBACK_PATH } from "../../shared/constants";
import { SITE_ORIGIN } from "../site";

/**
 * Calendar configuration, in one place.
 *
 * Three environment variables drive the whole integration:
 *
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  — the OAuth client (Convex env)
 *   CALENDAR_TOKEN_KEY                       — 32-byte AES key for tokens
 *
 * The callback lives on the Convex deployment's own site URL, not on the web
 * origin, so the authorization code is exchanged server-to-server and never
 * travels through the browser's history. `CONVEX_SITE_URL` is already part of
 * Convex Auth's setup, so there is nothing extra to configure.
 */

/**
 * Where Nexa is published. The origin itself is fixed in code (`site.ts`),
 * so a rotated deployment variable can never move invite links; the
 * `NEXA_SITE_URL` override below exists only for deliberate local testing.
 */
export const DEFAULT_SITE_URL = SITE_ORIGIN;

/** The published origin, no trailing slash. Used to build invite links. */
export function siteOrigin(): string {
  const configured = process.env.NEXA_SITE_URL;
  const base =
    configured && configured.length > 0 ? configured : DEFAULT_SITE_URL;
  return base.replace(/\/+$/, "");
}

/** The path the OAuth callback is registered on. */
export const CALENDAR_CALLBACK_PATH_ON_SERVER = "/oauth/calendar/callback";

export function calendarRedirectUri(): string {
  const override = process.env.CALENDAR_REDIRECT_URI;
  if (override && override.trim().length > 0) return override.trim();
  const site = process.env.CONVEX_SITE_URL;
  if (!site || site.trim().length === 0) {
    throw new ConvexError(
      "CONVEX_SITE_URL is not set, so the calendar callback URL is unknown. Set it in the Convex environment.",
    );
  }
  return `${site.replace(/\/+$/, "")}${CALENDAR_CALLBACK_PATH_ON_SERVER}`;
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function tokenKeyConfigured(): boolean {
  return Boolean(process.env.CALENDAR_TOKEN_KEY?.trim());
}

/**
 * Resolve the browser destination for a callback.
 *
 * Only a *path* on our own origin is ever honoured — never an absolute URL and
 * never a protocol-relative one — so a crafted `returnTo` cannot turn the
 * callback into an open redirect. Anything unrecognized lands on the default.
 */
export function resolveReturnTo(returnTo?: string | null): string {
  const origin = siteOrigin();
  const fallback = `${origin}${CALENDAR_CALLBACK_PATH}`;
  if (!returnTo) return fallback;
  const trimmed = returnTo.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("\\")) return fallback;
  return `${origin}${trimmed}`;
}

/** Append query params to a resolved destination, preserving its own query. */
export function withParams(url: string, params: Record<string, string>): string {
  const separator = url.includes("?") ? "&" : "?";
  const query = new URLSearchParams(params).toString();
  return `${url}${separator}${query}`;
}

/** True when the deployment can actually run a connect flow. */
export function calendarReadiness(): {
  ready: boolean;
  reason: string | null;
} {
  if (!googleConfigured()) {
    return { ready: false, reason: CALENDAR.configuredMissing };
  }
  if (!tokenKeyConfigured()) {
    return { ready: false, reason: CALENDAR.keyMissing };
  }
  return { ready: true, reason: null };
}
