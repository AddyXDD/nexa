import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Floating reactions.
 *
 * Sent to every peer over the existing ephemeral signalling transport
 * (kind "reaction", short JSON, consumed like any other signal) — nothing
 * is stored anywhere else. Rate-limited locally so a held key can't spam
 * the room; each reaction expires on its own after a couple of seconds.
 */

export const REACTIONS = ["👍", "😂", "❤️", "👏", "🎉", "😮", "🔥"] as const;

export type Reaction = {
  id: string;
  emoji: string;
  from: string; // "self" or the sender's session id
  at: number;
  /** Horizontal position 0..1 — stable per reaction so the float feels natural. */
  lane: number;
};

const LIFETIME_MS = 2_200;
const MIN_INTERVAL_MS = 350;
const MAX_LIVE = 16;

export function useReactions() {
  const [items, setItems] = useState<Reaction[]>([]);
  const timersRef = useRef(new Map<string, number>());
  const lastSentRef = useRef(0);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const scheduleExpiry = useCallback((id: string) => {
    const timers = timersRef.current;
    const timer = window.setTimeout(() => {
      timers.delete(id);
      setItems((current) => current.filter((item) => item.id !== id));
    }, LIFETIME_MS);
    timers.set(id, timer);
  }, []);

  /** Send to every peer and float it locally. Returns false when rate-limited. */
  const fire = useCallback(
    (emoji: string, peers: string[], send: (to: string, payload: string) => void): boolean => {
      const now = Date.now();
      if (now - lastSentRef.current < MIN_INTERVAL_MS) return false;
      lastSentRef.current = now;

      const reaction: Reaction = {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        emoji,
        from: "self",
        at: now,
        lane: 0.18 + Math.random() * 0.64,
      };
      setItems((current) => [...current.slice(-MAX_LIVE + 1), reaction]);
      scheduleExpiry(reaction.id);
      const payload = JSON.stringify({ emoji });
      for (const peer of peers) send(peer, payload);
      return true;
    },
    [scheduleExpiry],
  );

  /** Handle an incoming reaction signal (already validated by the server). */
  const receive = useCallback(
    (emoji: string, from: string) => {
      const now = Date.now();
      const reaction: Reaction = {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        emoji,
        from,
        at: now,
        lane: 0.18 + Math.random() * 0.64,
      };
      setItems((current) => [...current.slice(-MAX_LIVE + 1), reaction]);
      scheduleExpiry(reaction.id);
    },
    [scheduleExpiry],
  );

  return { items, fire, receive };
}

/** Parse a reaction payload defensively; null when it isn't one. */
export function parseReactionPayload(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as { emoji?: unknown };
    return typeof parsed.emoji === "string" ? parsed.emoji : null;
  } catch {
    return null;
  }
}
