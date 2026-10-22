import { describe, expect, it } from "vitest";
import { absoluteSiteUrl, DEFAULT_REDIRECT_PATH, SITE_ORIGIN } from "./site";

/**
 * Sign-in destinations are pinned to the published origin. These assertions
 * are the invariant: no environment value, and no `redirectTo` string, can
 * move the browser to another host — the redirect endpoint must not be
 * usable as an open redirect.
 */

const FALLBACK = `${SITE_ORIGIN}${DEFAULT_REDIRECT_PATH}`;

describe("absoluteSiteUrl", () => {
  it("pins the published origin in code", () => {
    expect(SITE_ORIGIN).toBe("https://nexameet.in");
  });

  it("resolves a same-site path on the published origin", () => {
    expect(absoluteSiteUrl("/org/acme")).toBe("https://nexameet.in/org/acme");
    expect(absoluteSiteUrl("/dashboard?tab=meetings")).toBe(
      "https://nexameet.in/dashboard?tab=meetings",
    );
  });

  it("falls back to the dashboard when no destination was given", () => {
    expect(absoluteSiteUrl(undefined)).toBe(FALLBACK);
    expect(absoluteSiteUrl(null)).toBe(FALLBACK);
    expect(absoluteSiteUrl("")).toBe(FALLBACK);
    expect(absoluteSiteUrl("   ")).toBe(FALLBACK);
  });

  it("refuses anything that is not a same-site path", () => {
    expect(absoluteSiteUrl("https://evil.example/dashboard")).toBe(FALLBACK);
    expect(absoluteSiteUrl("http://nexameet.in/dashboard")).toBe(FALLBACK);
    expect(absoluteSiteUrl("//evil.example")).toBe(FALLBACK);
    expect(absoluteSiteUrl("/\\evil.example")).toBe(FALLBACK);
    expect(absoluteSiteUrl("javascript:alert(1)")).toBe(FALLBACK);
    expect(absoluteSiteUrl("/dash\nboard")).toBe(FALLBACK);
  });
});
