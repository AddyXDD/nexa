import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { COPY } from "@/shared/constants";
import type { ChatMessage, DirectPeer } from "@/shared/types";

type SeenId = string;

/** Room messages from others that arrived after `watermark`. */
function countRoomUnread(
  messages: ChatMessage[],
  selfSessionId: string,
  watermark: number | undefined,
): number {
  if (watermark === undefined) return 0;
  let count = 0;
  for (const message of messages) {
    if (message.scope !== "everyone") continue;
    if (message.sessionId === selfSessionId) continue;
    if (message.sentAt > watermark) count++;
  }
  return count;
}

/**
 * Room-wide "someone messaged" badge + toast.
 *
 * Fires once per new message from another participant, in the room channel
 * or in an open DM thread. The same message id is never announced twice in
 * one session. DM notifications only fire when the DM tab is the active
 * channel — a room message while you're reading a private thread is still
 * announced, because that one is genuinely unrelated to what you're looking
 * at.
 *
 * Alongside the toasts it returns an `unread` count for the Chat badge on
 * the control bar and the side panel, so backgrounded chat stays visible
 * without relying on a toast. Room traffic is counted from the room
 * transcript; direct messages from `directPeers`' last-activity stamps, so
 * a DM that lands in a thread nobody has open still lights the badge. Both
 * counters seal (mark everything then-current as read) whenever the chat
 * panel is opened or closed.
 */
export function useChatNotifications({
  messages,
  scope,
  peerSessionId,
  selfSessionId,
  selfJoinedAt,
  chatVisible,
  peers,
  roomMessages,
}: {
  messages: ChatMessage[];
  scope: "everyone" | "dm";
  peerSessionId: string | null;
  selfSessionId: string;
  /** Server timestamp of this seat's join — earlier traffic is backlog.
   *  Undefined until the roster reports our seat. */
  selfJoinedAt: number | undefined;
  /** True while the chat panel is on screen. */
  chatVisible: boolean;
  /** Direct threads known to the server, newest activity first. */
  peers: DirectPeer[];
  /** The room transcript regardless of the active chat channel, so room
   *  traffic keeps being counted while a DM thread is open. */
  roomMessages?: ChatMessage[];
}) {
  const effectiveRoomMessages: ChatMessage[] = roomMessages ?? messages.filter(
    (message) => message.scope === "everyone",
  );
  const seenRef = useRef<Set<SeenId>>(new Set());
  const pendingRef = useRef<ChatMessage | null>(null);

  const announce = useCallback(
    (message: ChatMessage) => {
      // Don't announce your own messages back to yourself.
      if (message.sessionId === selfSessionId) return;

      const label =
        message.displayName ??
        message.nexaId.slice(0, 7) ??
        "Someone";

      const line = message.text.length > 60
        ? message.text.slice(0, 57) + "..."
        : message.text;

      if (scope === "dm" && peerSessionId !== null) {
        // DM tab open: only this thread's messages are "relevant" to the
        // foreground. A room message while you're in a DM is still worth a
        // glance, but it isn't who you're looking at.
        if (message.scope === "dm" && message.toSessionId === peerSessionId) {
          toast(
          COPY.chatNotificationDm.replace("%s", label).replace(
            "%s",
            line,
          ),
          {
            duration: 3500,
            cancel: true,
            style: {
              backgroundColor: "var(--nexa-accent)",
              color: "#fff",
            },
          },
        );
        } else if (message.scope === "everyone") {
          toast(COPY.chatNotificationRoom, {
            duration: 3500,
            cancel: true,
            style: {
              backgroundColor: "var(--nexa-accent)",
              color: "#fff",
            },
          });
        }
        return;
      }

      // Room channel (or DM with no thread open): announce room traffic
      // and DM traffic aimed at us.
      if (message.scope === "everyone") {
        toast(
          COPY.chatNotificationRoomLine
            .replace("%s", label)
            .replace("%s", line),
          {
            duration: 3500,
            cancel: true,
            style: { backgroundColor: "var(--nexa-accent)", color: "#fff" },
          },
        );
        return;
      }

      if (
        message.scope === "dm" &&
        (message.toSessionId === selfSessionId ||
          message.sessionId === selfSessionId)
      ) {
        const other = message.toSessionId === selfSessionId
          ? message.displayName ?? message.nexaId.slice(0, 7) ?? "Someone"
          : label;
        toast(
          COPY.chatNotificationDm.replace("%s", other).replace(
            "%s",
            line,
          ),
          {
            duration: 3500,
            cancel: true,
            style: { backgroundColor: "var(--nexa-accent)", color: "#fff" },
          },
        );
      }
    },
    [peerSessionId, selfSessionId, scope],
  );

  useEffect(() => {
    const seen = seenRef.current;
    let last: ChatMessage | null = null;

    for (const message of messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      last = message;
    }

    if (last) pendingRef.current = last;
  }, [messages]);

  useEffect(() => {
    const next = pendingRef.current;
    if (!next) return;
    pendingRef.current = null;
    announce(next);
  }, [announce]);

  /* ---------------- unread badge ---------------- */

  // Watermarks: everything at or below them has been "seen". Undefined
  // until the seat is known, so backlog from before we arrived never badges.
  const [roomWatermark, setRoomWatermark] = useState<number | undefined>(
    undefined,
  );
  const [dmWatermark, setDmWatermark] = useState<number | undefined>(
    undefined,
  );
  const [prevVisible, setPrevVisible] = useState(chatVisible);
  const [prevJoinedAt, setPrevJoinedAt] = useState(selfJoinedAt);

  // The seat appearing (or re-joining) starts the count from its join time.
  // Opening or closing the chat panel seals chat as read: everything in the
  // room transcript and every thread stamp up to now was on screen or the
  // user is (just was) looking at chat. React's documented "adjust state
  // when a prop changes" pattern — guarded by the previous values, so each
  // block runs once per transition, is idempotent under StrictMode, and
  // needs no effect (and no setState-in-effect).
  if (selfJoinedAt !== prevJoinedAt) {
    setPrevJoinedAt(selfJoinedAt);
    setRoomWatermark(selfJoinedAt);
    setDmWatermark(selfJoinedAt);
  }
  if (chatVisible !== prevVisible) {
    setPrevVisible(chatVisible);
    let latestRoom = roomWatermark;
    for (const message of effectiveRoomMessages) {
      if (
        message.scope === "everyone" &&
        (latestRoom === undefined || message.sentAt > latestRoom)
      ) {
        latestRoom = message.sentAt;
      }
    }
    setRoomWatermark(latestRoom);
    let latestDm = dmWatermark;
    for (const peer of peers) {
      if (latestDm === undefined || peer.lastSentAt > latestDm) {
        latestDm = peer.lastSentAt;
      }
    }
    setDmWatermark(latestDm);
  }

  // Derived straight from the snapshots: room messages from others past the
  // room watermark, plus threads whose last activity is newer than the DM
  // watermark. While the panel is open everything is on screen — never
  // badge. Works with the tab backgrounded: no timers, no focus listeners.
  const roomUnread = countRoomUnread(effectiveRoomMessages, selfSessionId, roomWatermark);
  const dmUnread =
    dmWatermark === undefined
      ? 0
      : peers.reduce(
          (count, peer) => (peer.lastSentAt > dmWatermark ? count + 1 : count),
          0,
        );
  const unread = chatVisible ? 0 : roomUnread + dmUnread;

  // Per-channel counts for the panel's Everyone/Direct tabs, so the badge
  // shows where the unread is. They are not zeroed by chatVisible: whichever
  // channel is on screen, the other one may still hold unread traffic.

  // Ask permission for the browser notification bar on first real traffic.
  // The in-app toast is the primary channel; the native one is a nicety for
  // people with the tab backgrounded.
  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") return;

    const ok = async () => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      // Fire one illustrative notification so the permission isn't entirely
      // abstract.
      new Notification("Nexa Meet", {
        body: "Notifications on — you'll see when someone messages the room.",
        silent: true,
      });
    };

    // Don't prompt on mount — that's annoying. Prompt on first incoming
    // message instead.
    if (messages.length > 0 && scope !== "everyone") return;
    const first = messages.find((m) => m.sessionId !== selfSessionId);
    if (!first) return;
    ok();
  }, [messages, scope, selfSessionId]);

  return { unread, roomUnread, dmUnread };
}
