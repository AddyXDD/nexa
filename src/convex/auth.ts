// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { emailOtp } from "./auth/emailOtp";
import { googleSignIn } from "./auth/google";
import { absoluteSiteUrl } from "./site";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  // Google is additive: the email-code and guest paths above are unchanged
  // and remain the fallback whenever someone would rather not use Google.
  providers: [emailOtp, Anonymous, googleSignIn],
  // Post-sign-in destinations resolve against the published origin in
  // `site.ts` rather than the deployment's `SITE_URL` env var. That variable
  // is rewritten on every deploy, which sent people back to a preview host
  // (or a host that no longer exists) after signing in. Passing `redirectTo`
  // from the sign-in screen also keeps the framework from needing `SITE_URL`
  // at all on this path.
  callbacks: {
    async redirect({ redirectTo }) {
      return absoluteSiteUrl(redirectTo);
    },
  },
});
