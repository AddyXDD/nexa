import { api } from "@/convex/_generated/api";
import { friendlyError } from "@/lib/errors";
import {
  COPY,
  HEARTBEAT_INTERVAL_MS,
  MEETING_CODE_REGEX,
} from "@/shared/constants";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

export type MediaFlags = {
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
};

/**
 * Session lifecycle for one seat in a room: Nexa ID assignment, join,
 * heartbeat (presence + reconnect), media-state sync, and leave.
 *
 * `ready` is the caller's auth state: joining a meeting never requires the
 * visitor to sign in — the page establishes an anonymous session first and
 * flips `ready`. `entered` is the pre-join gate: the seat is only taken
 * once the user has checked their camera and pressed Join.
 *
 * Join is debounced past React StrictMode's transient mount so a dev
 * double-render can't emit a phantom join/leave pair to other participants.
 */
export function useRoomSession(
  code: string,
  sessionId: string,
  media: MediaFlags,
  ready: boolean,
  entered: boolean,
) {
  const meeting = useQuery(api.meetings.get, { code });
  const participants = useQuery(
    api.meetings.listParticipants,
    ready ? { code } : "skip",
  );

  const join = useMutation(api.meetings.join);
  const leave = useMutation(api.meetings.leave);
  const openScheduledRoom = useMutation(api.schedule.openRoom);
  const heartbeat = useMutation(api.meetings.heartbeat);
  const setMediaState = useMutation(api.meetings.setMediaState);
  const ensureIdentity = useMutation(api.identity.ensure);

  const [joined, setJoined] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const triedOpenRef = useRef<string | null>(null);

  const mediaRef = useRef(media);
  const joinedRef = useRef(false);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  /** Assign the Nexa ID once per account (idempotent). */
  useEffect(() => {
    if (!ready) return;
    void ensureIdentity({}).catch(() => {
      /* transient — retried on the next mount */
    });
  }, [ready, ensureIdentity]);

  /**
   * A scheduled meeting's invite link arrives before its room exists. Open
   * the room on demand, once per code — a code that was never scheduled
   * simply fails and the normal "doesn't exist" path runs untouched.
   */
  useEffect(() => {
    if (!ready || meeting !== null) return;
    if (!MEETING_CODE_REGEX.test(code)) return;
    if (triedOpenRef.current === code) return;
    triedOpenRef.current = code;
    void openScheduledRoom({ code }).catch(() => {
      /* not a scheduled code — the room-gone screen handles it */
    });
  }, [ready, meeting, code, openScheduledRoom]);

  /** Take the seat once the user enters; release it on unmount. */
  useEffect(() => {
    if (!ready || !entered) return;
    let cancelled = false;
    let didJoin = false;

    const timer = setTimeout(() => {
      void join({ code, sessionId, ...mediaRef.current })
        .then(() => {
          if (cancelled) return;
          didJoin = true;
          joinedRef.current = true;
          setJoined(true);
        })
        .catch((err) => {
          if (cancelled) return;
          setSessionError(friendlyError(err, COPY.meetingGone));
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (didJoin) {
        joinedRef.current = false;
        setJoined(false);
        void leave({ code, sessionId }).catch(() => {
          /* sweeper releases the seat if this never lands */
        });
      }
    };
  }, [ready, entered, code, sessionId, join, leave]);

  /** Heartbeat keeps the seat live; a call after a drop doubles as rejoin. */
  useEffect(() => {
    if (!joined) return;
    const beat = () => {
      void heartbeat({ code, sessionId, ...mediaRef.current })
        .then((res) => {
          if (!res.ok) {
            joinedRef.current = false;
            setJoined(false);
            setSessionError(res.error ?? COPY.roomClosed);
          }
        })
        .catch(() => {
          /* offline — Convex queues it; the next beat retries */
        });
    };
    beat();
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [joined, code, sessionId, heartbeat]);

  /** Push mute/camera/screen-share changes to the roster immediately. */
  useEffect(() => {
    if (!joined) return;
    void setMediaState({ code, sessionId, ...media }).catch(() => {});
  }, [joined, code, sessionId, media, setMediaState]);

  /** Best-effort leave when the tab goes away (sweeper covers the rest). */
  useEffect(() => {
    const release = () => {
      if (joinedRef.current) {
        void leave({ code, sessionId }).catch(() => {});
      }
    };
    // beforeunload fires while the socket is still open; pagehide is the
    // reliable late event. Send on both — leave is idempotent.
    window.addEventListener("beforeunload", release);
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("beforeunload", release);
      window.removeEventListener("pagehide", release);
    };
  }, [code, sessionId, leave]);

  return {
    /** undefined = loading, null = doesn't exist / has ended */
    meeting,
    participants,
    joined,
    sessionError,
    clearSessionError: () => setSessionError(null),
  };
}
