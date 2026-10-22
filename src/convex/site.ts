/**
 * The published web origin — fixed in code, not read from the environment.
 *
 * Convex Auth's default redirect handling resolves post-sign-in destinations
 * against the deployment's `SITE_URL` variable, and this project's deployment
 * rewrites that value on every deploy (it follows the preview host). People
 * then finished signing in on a URL that had already been torn down, or on a
 * preview origin that isn't the product.
 *
 * Where the app lives is a property of the product, not of a deployment, so
 * it lives here and every sign-in destination is resolved against it.
 */

/** The public origin of the web app, with no trailing slash. */
export const SITE_ORIGIN = "https://nexameet.in";

/** Where a sign-in lands when the caller asked for nothing in particular. */
export const DEFAULT_REDIRECT_PATH = "/dashboard";

/**
 * Resolve a `redirectTo` value to an absolute URL on the published origin.
 *
 * Only same-site paths are honoured — never an absolute URL, a
 * protocol-relative one, a backslash-smuggled one, or anything carrying
 * control characters. That keeps the callback from becoming an open
 * redirect while still letting the sign-in screen choose between
 * `/dashboard`, `/org/:slug`, or a `returnTo` path.
 */
export function absoluteSiteUrl(redirectTo: string | null | undefined): string {
  const raw = (redirectTo ?? "").trim();
  const isSafePath =
    raw.startsWith("/") &&
    !raw.startsWith("//") &&
    !raw.includes("\\") &&
    ![...raw].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    });
  return `${SITE_ORIGIN}${isSafePath ? raw : DEFAULT_REDIRECT_PATH}`;
}
