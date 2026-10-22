import { api } from "@/convex/_generated/api";
import { loadValue, saveJson } from "@/lib/prefs";
import { useQuery } from "convex/react";
import { useCallback, useState } from "react";

/**
 * The admin session — deliberately its own thing.
 *
 * Nothing here touches Convex Auth, the customer token, or anything the
 * product stores: an admin signs in on a standalone page, gets a bearer
 * token minted by adminAuth.login, and that token is the only thing that
 * opens /admin. Signing out of Nexa does not sign you out of the deck, and
 * signing in as an admin does not sign you into anything else.
 *
 * The token lives in localStorage because a Convex action cannot set an
 * httpOnly cookie on the app's own origin. That is the usual SPA trade:
 * the token is readable by script on this origin, so it is kept short-lived
 * (12h) and rotatable by signing in again.
 */

const TOKEN_KEY = "admin-token";

export function useAdminToken() {
  const [token, setToken] = useState<string | null>(() =>
    loadValue<string | null>(TOKEN_KEY, null),
  );

  const store = useCallback((next: string | null) => {
    setToken(next);
    saveJson(TOKEN_KEY, next);
  }, []);

  return { token, store };
}

/** Who the stored token belongs to; null when absent, wrong or expired. */
export function useAdminSession(token: string | null) {
  return useQuery(api.adminAuth.session, token === null ? "skip" : { token });
}
