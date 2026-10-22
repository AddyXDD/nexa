import { ConvexError } from "convex/values";

/**
 * Extract a message that is safe and useful to show in the UI.
 * Server ConvexErrors carry user-safe strings; everything else falls back.
 */
export function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) {
    return typeof err.data === "string" ? err.data : fallback;
  }
  return fallback;
}
