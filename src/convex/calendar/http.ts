import { CALENDAR, DEFAULT_MEETING_MINUTES } from "../../shared/constants";
import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";
import { calendarRedirectUri, resolveReturnTo, withParams } from "./config";
import {
  DEFAULT_GOOGLE_CALENDAR_ID,
  fetchGoogleAccountEmail,
} from "./providers/google";
import { calendarProvider, isSupportedProvider } from "./providers/registry";
import { asProviderError } from "./providers/types";
import { decryptSecret, encryptSecret, sha256Hex } from "./secrets";

/**
 * The OAuth callback.
 *
 * Lives on the Convex deployment's site URL rather than the web origin so the
 * authorization code is exchanged server-to-server: it never appears in the
 * browser's history, never reaches client JavaScript, and the client secret
 * never leaves this function.
 *
 * What it validates, in order:
 *   1. `state` — single-use and short-lived, consumed atomically by a mutation
 *      so a replayed callback cannot connect twice;
 *   2. `error` — a user who declined is sent back with an honest message;
 *   3. `code` — missing means a malformed callback, and the flow restarts.
 *
 * The redirect destination comes from the state row, where only a path on our
 * own origin is ever stored, so a crafted query string cannot turn this route
 * into an open redirect. The browser learns "connected" or a reason code and
 * nothing else — no token, no code, no account identifier.
 */

function redirect(location: string, params: Record<string, string>): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: withParams(location, params),
      "Cache-Control": "no-store",
    },
  });
}

export const calendarOAuthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error");

  // Consume first: an unknown, expired, or already-used state is the CSRF
  // case, and it must not proceed even if the rest of the callback looks fine.
  const pending = state
    ? await ctx.runMutation(internal.calendar.connections.consumeState, {
        stateHash: await sha256Hex(state),
      })
    : null;

  if (pending === null) {
    return redirect(resolveReturnTo(null), {
      calendar: "error",
      reason: "state",
    });
  }
  if (providerError) {
    return redirect(pending.redirectTo, {
      calendar: "error",
      // `access_denied` is the only one worth distinguishing: the user chose
      // not to grant access, which is not a failure of ours.
      reason: providerError === "access_denied" ? "denied" : "provider",
    });
  }
  if (!code) {
    return redirect(pending.redirectTo, { calendar: "error", reason: "code" });
  }
  if (!isSupportedProvider(pending.provider)) {
    return redirect(pending.redirectTo, { calendar: "error", reason: "provider" });
  }

  const provider = calendarProvider(pending.provider);

  try {
    const codeVerifier = await decryptSecret(pending.codeVerifierEnc);
    const tokens = await provider.exchangeCode({
      code,
      codeVerifier,
      redirectUri: calendarRedirectUri(),
    });

    // The address is display-only. The id_token usually carries it; a
    // Workspace setup that omits it falls back to a single userinfo call.
    const accountEmail =
      tokens.accountEmail ??
      (await fetchGoogleAccountEmail(tokens.accessToken).catch(() => null));

    await ctx.runMutation(internal.calendar.connections.upsertConnection, {
      userId: pending.userId,
      provider: provider.id,
      calendarId: DEFAULT_GOOGLE_CALENDAR_ID,
      accessTokenEnc: await encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken
        ? await encryptSecret(tokens.refreshToken)
        : undefined,
      accessTokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      accountEmail: accountEmail ?? undefined,
      accountId: tokens.accountId ?? undefined,
    });

    return redirect(pending.redirectTo, {
      calendar: "connected",
      provider: provider.id,
    });
  } catch (error) {
    // Log the provider's classification, never the code, the verifier, or
    // anything from the token response.
    const failure = asProviderError(error);
    console.warn(
      `[calendar] connect failed (${failure.kind}${
        failure.status ? ` ${failure.status}` : ""
      })`,
    );
    return redirect(pending.redirectTo, {
      calendar: "error",
      reason: "provider",
    });
  }
});

/**
 * A tiny health route for the integration, so a deployment can be checked
 * without opening the app: reports whether the env is wired, never a value.
 */
export const calendarIntegrationStatus = httpAction(async () => {
  const configured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  const keyConfigured = Boolean(process.env.CALENDAR_TOKEN_KEY?.trim());
  let redirectUri: string | null = null;
  try {
    redirectUri = calendarRedirectUri();
  } catch {
    // Reported as null; the body describes what is missing.
  }
  return new Response(
    JSON.stringify({
      provider: "google",
      configured,
      tokenKeyConfigured: keyConfigured,
      redirectUri,
      defaultMeetingMinutes: DEFAULT_MEETING_MINUTES,
      outlook: "planned",
      reason:
        configured && keyConfigured
          ? null
          : configured
            ? CALENDAR.keyMissing
            : CALENDAR.configuredMissing,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
});
