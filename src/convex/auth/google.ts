import Google from "@auth/core/providers/google";
import type { GoogleProfile } from "@auth/core/providers/google";
import type { OAuthUserConfig } from "@auth/core/providers";
import type { User } from "@auth/core/types";

/**
 * Google sign-in for Nexa accounts.
 *
 * Identity only. This provider proves who someone is; it asks for nothing
 * else. Calendar access is a separate, optional grant with its own callback
 * and its own scopes (see `calendar/`), so signing in never requests calendar
 * permission and connecting a calendar never signs anybody in.
 *
 * Credentials: the same OAuth client the calendar flow already uses
 * (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, Convex environment
 * variables). One Google client can carry both flows because Google matches
 * a request's exact `redirect_uri` against the client's registered list —
 * this flow registers `<CONVEX_SITE_URL>/api/auth/callback/google` beside the
 * calendar's `<CONVEX_SITE_URL>/oauth/calendar/callback`. Scopes belong to
 * each request, not to the client, so the two never mix.
 */

/**
 * Map Google's ID-token claims onto the profile Convex Auth stores.
 *
 * The load-bearing field is `emailVerified`: Convex Auth reads it to decide
 * whether the address counts as verified on a new account *and* whether an
 * existing account that already owns that email may be linked to this
 * sign-in. Returning Google's `email_verified` claim — rather than letting
 * the framework assume every OIDC profile is trustworthy — keeps automatic
 * account linking from ever being driven by an address the provider itself
 * has not verified.
 *
 * Convex Auth's own types describe `emailVerified` as a boolean; Auth.js's
 * `User` type has no such field. Declaring the intersection here keeps the
 * extra property explicit instead of hiding the difference in a cast.
 */
export function mapGoogleProfile(
  profile: GoogleProfile,
): User & { emailVerified: boolean } {
  return {
    id: profile.sub,
    name: profile.name,
    email: profile.email,
    image: profile.picture,
    emailVerified: profile.email_verified === true,
  };
}

/**
 * The configuration handed to the provider, exported so tests can assert on
 * the exact object this deployment uses rather than a copy of it.
 */
export const GOOGLE_SIGN_IN_OPTIONS: OAuthUserConfig<GoogleProfile> = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  authorization: {
    params: {
      /**
       * Only what signing in needs. `openid` gets us the ID token that
       * proves identity; `email` and `profile` fill the account's email,
       * name and picture. Nothing from Calendar, Drive or Gmail.
       */
      scope: "openid email profile",
      /**
       * Show the account chooser instead of silently reusing whichever
       * Google session the browser happens to hold — on a shared machine,
       * signing the wrong person in is a real failure, not a convenience.
       */
      prompt: "select_account",
      /**
       * Deliberately no `access_type: offline`: sign-in must not mint a
       * refresh token, because then it would have to be stored. Offline
       * access is the calendar flow's job, under its own consent.
       */
    },
  },
  /**
   * Convex Auth 0.0.90 defaults to `["pkce"]` and only adds `state` when a
   * redirect proxy is configured, so both `state` and `nonce` have to be
   * asked for. With all three on, the authorization request carries `state`
   * and `nonce` and the callback validates them — plus PKCE — before any
   * code is exchanged.
   */
  checks: ["pkce", "state", "nonce"],
  profile: mapGoogleProfile,
};

export const googleSignIn = Google(GOOGLE_SIGN_IN_OPTIONS);
