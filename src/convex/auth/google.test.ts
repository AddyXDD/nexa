import { describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import type { GoogleProfile } from "@auth/core/providers/google";
import schema from "../schema";
import { api } from "../_generated/api";
import { GOOGLE_SIGN_IN_OPTIONS, mapGoogleProfile } from "./google";

/**
 * Google sign-in, checked against the real auth stack.
 *
 * Two layers, because the OAuth round trip spans two servers:
 *
 *  - Offline. Our half of the contract: the configuration the deployment
 *    hands the provider (client, callback, scopes, CSRF checks), the handoff
 *    the sign-in action returns, the profile mapping that decides whether an
 *    address may ever link to an existing account, and the fact that the
 *    existing providers are untouched. Everything here runs on every test
 *    run with no network.
 *
 *  - Online (opt-in, `NEXA_ONLINE_TESTS=1`). Follows that handoff through the
 *    deployment's own `/api/auth/signin/google` route, which is where Convex
 *    Auth resolves Google's OpenID Connect discovery document and builds the
 *    authorization URL. That step needs network access, so it is skipped by
 *    default and never claimed as passing when it did not run.
 *
 * Credentials are read at module load, exactly as a deployment does, so the
 * environment is set before the modules are imported.
 */

// `vi.hoisted` runs before the imports above, which matters: the provider
// reads its credentials the moment its module is evaluated — the same
// load-time read a deployment performs — so the environment has to exist
// before `./google` is imported, not merely before a test runs.
const { CLIENT_ID, SITE_URL, APP_ORIGIN } = vi.hoisted(() => {
  const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  /** The deployment's own origin (Convex site). */
  const SITE_URL = "https://test-deployment.convex.site";
  /** The web app; Convex Auth validates redirects against SITE_URL. */
  const APP_ORIGIN = "https://nexa.test";

  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.CONVEX_SITE_URL = SITE_URL;
  process.env.SITE_URL = APP_ORIGIN;

  return { CLIENT_ID, SITE_URL, APP_ORIGIN };
});

const online = process.env.NEXA_ONLINE_TESTS === "1";

const modules: Record<string, () => Promise<unknown>> = {
  "./_generated/server.ts": () => import("../_generated/server"),
  "./auth.ts": () => import("../auth"),
  "./auth/google.ts": () => import("./google"),
  "./auth/emailOtp.ts": () => import("./emailOtp"),
  "./http.ts": () => import("../http"),
};

function deployment() {
  return convexTest({ schema, modules });
}

/** What Convex Auth's sign-in action hands back for an OAuth provider. */
type Handoff = { redirect?: string; verifier?: string };

async function signInHandoff(t: ReturnType<typeof deployment>) {
  const handoff = (await t.action(api.auth.signIn, {
    provider: "google",
  })) as Handoff;
  expect(handoff.redirect).toBeTruthy();
  return handoff;
}

describe("Google sign-in configuration", () => {
  test("asks Google for identity, and nothing else", () => {
    const params: Record<string, unknown> =
      GOOGLE_SIGN_IN_OPTIONS.authorization?.params ?? {};

    // openid proves who the person is; email and profile fill the account.
    // Calendar is a separate grant and must never ride along with sign-in.
    const scope = String(params.scope ?? "");
    expect(scope.split(/\s+/).sort()).toEqual(["email", "openid", "profile"]);
    expect(scope).not.toContain("calendar");

    // No offline access: sign-in must not mint a refresh token, because then
    // it would have to be stored somewhere.
    expect(params.access_type).toBeUndefined();

    // The account chooser, rather than silently reusing whichever Google
    // session the browser already holds.
    expect(params.prompt).toBe("select_account");
  });

  test("carries every check the callback later validates", () => {
    // Convex Auth 0.0.90 defaults to PKCE alone; state and nonce only exist
    // because they are asked for here.
    expect(GOOGLE_SIGN_IN_OPTIONS.checks).toEqual(
      expect.arrayContaining(["pkce", "state", "nonce"]),
    );
  });

  test("signs in with the deployment's own Google client", () => {
    expect(GOOGLE_SIGN_IN_OPTIONS.clientId).toBe(CLIENT_ID);
    // The secret stays server-side in the Convex environment; it is never
    // sent to the browser (the web app only ever sees a deployment URL).
    expect(GOOGLE_SIGN_IN_OPTIONS.clientSecret).toBe("test-client-secret");
  });
});

describe("Google sign-in handoff", () => {
  test("sends the browser to this deployment, not to Google directly", async () => {
    const t = deployment();
    const handoff = await signInHandoff(t);
    const url = new URL(handoff.redirect!);

    // The first hop is Convex Auth's own route: that is where the state,
    // nonce and PKCE cookies are set before Google is ever contacted, and
    // where the OIDC discovery document is resolved. It is the deployment,
    // not the web app — which is what keeps the exchange server-side.
    expect(url.origin).toBe(SITE_URL);
    expect(url.origin).not.toBe(APP_ORIGIN);
    expect(url.pathname).toBe("/api/auth/signin/google");

    // PKCE: the verifier travels in the URL as a one-time code and is stored
    // as an httpOnly cookie, never in the client's reach.
    expect(url.searchParams.get("code")).toBe(handoff.verifier);
    expect(handoff.verifier).toBeTruthy();

    // Nothing the browser can see may carry the client secret: the whole
    // value of an action-backed handoff is that the secret stays server-side.
    expect(handoff.redirect).not.toContain("test-client-secret");
    expect(url.searchParams.get("client_secret")).toBeNull();
  });

  test("carries the destination the person was heading for", async () => {
    const t = deployment();
    // The screen passes the page that asked for sign-in (`/dashboard`, or a
    // `returnTo` path). Convex Auth stores it in a cookie here and redirects
    // the browser to it after the callback — without it, the callback returns
    // to the site root and the destination is lost.
    const handoff = (await t.action(api.auth.signIn, {
      provider: "google",
      params: { redirectTo: "/dashboard" },
    })) as Handoff;
    expect(
      new URL(handoff.redirect!).searchParams.get("redirectTo"),
    ).toBe("/dashboard");
  });

  test("mints fresh, unguessable values for every attempt", async () => {
    const t = deployment();
    const first = await signInHandoff(t);
    const second = await signInHandoff(t);
    expect(first.verifier).not.toBe(second.verifier);
  });

  test("keeps the existing providers registered", async () => {
    const t = deployment();
    // The code for email sign-in is sent by the Freebuff gateway, which needs
    // a deployment secret this test does not have — so the guard firing is
    // the signal that the email provider is still wired in and reachable.
    await expect(
      t.action(api.auth.signIn, {
        provider: "email-otp",
        params: { email: "host@example.test" },
      }),
    ).rejects.toThrow(/VLY_INTEGRATION_KEY/);
  });

  test("accepts no provider that was not registered", async () => {
    const t = deployment();
    await expect(
      t.action(api.auth.signIn, { provider: "github" }),
    ).rejects.toThrow();
  });

  test.skipIf(!online)(
    "continues to Google's authorization endpoint with the full request",
    async () => {
      const t = deployment();
      const handoff = await signInHandoff(t);
      const route = new URL(handoff.redirect!);

      const response = await t.fetch(`${route.pathname}${route.search}`, {
        redirect: "manual",
      });
      expect([302, 303, 307]).toContain(response.status);

      // All three checks really were materialised — one cookie each — and
      // none of them is readable from JavaScript. `SameSite=None; Secure` is
      // correct here: Google sends the browser back cross-site, so a stricter
      // value would drop the very cookies the callback needs to compare.
      const cookies = response.headers.getSetCookie();
      const names = cookies.map((cookie) => cookie.split("=")[0]);
      expect(names).toHaveLength(3);
      for (const suffix of ["state", "pkce", "nonce"]) {
        expect(names.filter((name) => name.endsWith(suffix))).toHaveLength(1);
      }
      for (const cookie of cookies) {
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/Secure/);
      }

      const location = response.headers.get("location");
      expect(location).toBeTruthy();
      const url = new URL(location!);

      // Really Google, really our client — and the secret is nowhere in
      // anything the browser could read.
      expect(url.host).toBe("accounts.google.com");
      expect(url.pathname).toContain("/o/oauth2/v2/auth");
      expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("client_secret")).toBeNull();
      expect(location).not.toContain("test-client-secret");

      // Google calls back the deployment, which exchanges the code
      // server-side with the client secret.
      expect(url.searchParams.get("redirect_uri")).toBe(
        `${SITE_URL}/api/auth/callback/google`,
      );

      // Identity only, no refresh token, account chooser shown.
      const scope = url.searchParams.get("scope") ?? "";
      expect(scope.split(/\s+/).sort()).toEqual(["email", "openid", "profile"]);
      expect(scope).not.toContain("calendar");
      expect(url.searchParams.get("access_type")).toBeNull();
      expect(url.searchParams.get("prompt")).toBe("select_account");

      // The checks the callback will validate against its cookies.
      expect(url.searchParams.get("state")).toBeTruthy();
      expect(url.searchParams.get("nonce")).toBeTruthy();
      expect(url.searchParams.get("code_challenge")).toBeTruthy();
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    },
  );
});

describe("Google profile mapping", () => {
  const base: GoogleProfile = {
    sub: "102938475610293847561",
    name: "Priya Raman",
    email: "priya@example.com",
    picture: "https://lh3.googleusercontent.com/a/example",
    email_verified: true,
  } as GoogleProfile;

  test("a verified address maps to a verified profile", () => {
    expect(mapGoogleProfile(base)).toEqual({
      id: base.sub,
      name: base.name,
      email: base.email,
      image: base.picture,
      emailVerified: true,
    });
  });

  test("an unverified address is never marked verified", () => {
    // Convex Auth links an OAuth sign-in to an existing account only when the
    // profile's address counts as verified, so this flag is what stops an
    // unverified address from ever walking into someone else's account.
    expect(mapGoogleProfile({ ...base, email_verified: false }).emailVerified).toBe(
      false,
    );
    expect(
      mapGoogleProfile({
        ...base,
        email_verified: undefined as unknown as boolean,
      }).emailVerified,
    ).toBe(false);
  });

  test("the Google subject is the account id, not the email", () => {
    // Google's `sub` is stable per account; the address is not (it can be
    // renamed, or reassigned), so identity must key off `sub`.
    const a = mapGoogleProfile(base);
    const b = mapGoogleProfile({ ...base, email: "priya.raman@example.com" });
    expect(a.id).toBe(b.id);
  });
});
