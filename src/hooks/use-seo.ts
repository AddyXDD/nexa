import { applySeo, type SeoConfig } from "@/lib/seo";
import { useEffect } from "react";

/**
 * Apply a route's SEO tags while it is mounted.
 *
 * Pass a module-scope constant rather than an inline object: the effect keys
 * off the config's identity, so a stable reference runs once per navigation
 * instead of on every render.
 */
export function useSeo(config: SeoConfig): void {
  useEffect(() => applySeo(config), [config]);
}
