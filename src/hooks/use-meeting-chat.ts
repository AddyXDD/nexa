import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { COPY } from "@/shared/constants";
import type { ChatScope } from "@/shared/types";

/**
 * Temporary meeting chat: the room transcript plus one-to-one direct
 * messages. Nothing is persisted beyond the meeting — the server deletes
 * every message, room-wide or direct, when the room closes.
 *
 * The active scope lives here rather than in the panel so a thread keeps
 * its place when the panel is swapped for the roster or the notes.
 */
export function useMeetingChat(
  code: string,
  sessionId: string,
  enabled: boolean,
) {
  const [scope, setScope] = useState<ChatScope>("everyone");
  const [peerSessionId, setPeerSessionId] = useState<string | null>(null);

  const room = useQuery(
    api.chat.list,
    enabled ? { code, sessionId } : "skip",
  );
  const direct = useQuery(
    api.chat.listDirect,
    enabled && peerSessionId !== null
      ? { code, sessionId, peerSessionId }
      : "skip",
  );
  const peers = useQuery(
    api.chat.directPeers,
    enabled ? { code, sessionId } : "skip",
  );
  const sendMessage = useMutation(api.chat.send);

  // Goes to the person, or to the room when no thread is open. The direct
  // branch refuses rather than falling back to the room — a message meant
  // to be private must never be posted where everyone can read it.
  const send = useCallback(
    (text: string) => {
      if (scope === "dm" && peerSessionId === null) {
        return Promise.reject(new Error(COPY.chatDmPickPeer));
      }
      return sendMessage({
        code,
        sessionId,
        text,
        ...(scope === "dm" && peerSessionId !== null
          ? { toSessionId: peerSessionId }
          : {}),
      });
    },
    [code, sessionId, scope, peerSessionId, sendMessage],
  );

  /** Picking a person opens their thread; null goes back to the room. */
  const openDirect = useCallback((next: string | null) => {
    setPeerSessionId(next);
    setScope(next === null ? "everyone" : "dm");
  }, []);

  return {
    scope,
    setScope,
    peerSessionId,
    openDirect,
    /** Threads with whoever is here plus anyone already DMed. */
    peers: peers ?? [],
    // A Direct tab with nobody picked yet has no transcript of its own —
    // it must never fall back to showing the room's.
    messages: scope === "dm" ? (direct ?? []) : (room ?? []),
    /** Room transcript regardless of the active channel — the unread badge
     *  counts room traffic even while a DM thread is on screen. */
    roomMessages: room ?? [],
    loading:
      enabled &&
      (scope === "dm"
        ? peerSessionId !== null && direct === undefined
        : room === undefined),
    gone: room === null,
    send,
  };
}
