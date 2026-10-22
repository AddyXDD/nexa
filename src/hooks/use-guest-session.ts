import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useCallback, useRef } from "react";

/** How long a fresh guest session may take to come up before we give up. */
const SESSION_TIMEOUT_MS = 10_000;
const POLL_MS = 50;

/**
 * Starts an anonymous session and waits until Convex is really using it.
 *
 * `signIn()` only *stores* the token. The client picks it up on the next
 * React commit (the auth provider's effect calls `setAuth`) and the
 * backend still has to confirm it. A mutation fired in that window runs
 * unauthenticated — which is why a visitor's very first "Start meeting"
 * could answer "Not authenticated." while every later click worked: by
 * then the token was already in localStorage and live before the click.
 *
 * The wait is on Convex's own `isAuthenticated`, which flips only after
 * the server has confirmed the token on the socket.
 */
export function useGuestSession() {
  const { isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();

  // Read through a ref: the waiting loop must see the latest value without
  // restarting the callback (and losing its deadline) on every auth change.
  const live = useRef(isAuthenticated);
  live.current = isAuthenticated;

  const ensureSession = useCallback(async () => {
    if (live.current) return;
    await signIn("anonymous");
    const deadline = Date.now() + SESSION_TIMEOUT_MS;
    while (!live.current) {
      if (Date.now() > deadline) {
        throw new Error("Your guest session didn't start. Please try again.");
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }, [signIn]);

  return { ensureSession, isAuthenticated };
}