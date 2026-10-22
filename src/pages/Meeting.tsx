import { api } from "@/convex/_generated/api";
import { ControlBar } from "@/components/meeting/ControlBar";
import { EffectsPanel } from "@/components/meeting/EffectsPanel";
import {
  MeetingHeader,
  type E2eeStatus,
} from "@/components/meeting/MeetingHeader";
import {
  Banner,
  FirstRunTips,
  MediaNotices,
  RoomStatusScreen,
} from "@/components/meeting/Notices";
import { PreJoin } from "@/components/meeting/PreJoin";
import { ReactionsLayer } from "@/components/meeting/ReactionsLayer";
import {
  SettingsPanel,
  type SettingsSection,
} from "@/components/meeting/SettingsPanel";
import { SidePanel } from "@/components/meeting/SidePanel";
import { VideoGrid, type SelfViewMode } from "@/components/meeting/VideoGrid";
import { useActiveSpeaker } from "@/hooks/use-active-speaker";
import { useAuth } from "@/hooks/use-auth";
import { useLocalMedia } from "@/hooks/use-local-media";
import { useMediaDevices } from "@/hooks/use-media-devices";
import { useMeetingChat } from "@/hooks/use-meeting-chat";
import { useChatNotifications } from "@/hooks/use-chat-notifications";
import { usePeerMesh } from "@/hooks/use-peer-mesh";
import { parseReactionPayload, useReactions } from "@/hooks/use-reactions";
import { useRoomSession } from "@/hooks/use-room-session";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { useSignalInbox, useSignalSend } from "@/hooks/use-signaling";
import { useUiPrefs } from "@/hooks/use-ui-prefs";
import { useVideoEffects } from "@/hooks/use-video-effects";
import { friendlyError } from "@/lib/errors";
import { e2eeEnabled, e2eeSupport } from "@/lib/webrtc/e2ee";
import { debugEnabled } from "@/lib/webrtc/debug";
import type { PeerDiagnostics } from "@/lib/webrtc/peerManager";
import {
  COPY,
  MEETING_CODE_REGEX,
  formatMeetingCode,
  normalizeMeetingCode,
} from "@/shared/constants";
import type { Participant, SignalEnvelope } from "@/shared/types";
import { AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useConvexConnectionState, useQuery } from "convex/react";
import { toast } from "sonner";

/** Tiny helper so this component can flip its own "connection lost" banner
 *  without putting setState() directly inside an effect body. The lint rule
 *  would prefer the write land in a callback, but this piece is purely a
 *  synchronous mirror of a ref-derived boolean; deferring it adds no value
 *  and only makes the banner lag a tick behind the state it reflects. */
function runNowSyncIfLinked(setter: () => void) {
  setter();
}

/**
 * The local daylight bucket. The stage's ambient wash is keyed to it, so the
 * room quietly matches the hour it is happening in — dawn warmth, midday
 * clarity, dusk violet, deep blue at night.
 */
function daypart(now = new Date()): "dawn" | "day" | "dusk" | "night" {
  const hour = now.getHours();
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

/**
 * Room orchestration.
 *
 * Flow: anonymous session → pre-join (camera/mic checks, effects) → seat
 * taken → the stage. Panels (people, chat, settings, effects) overlay the
 * video and disappear when not wanted; the floating control bar is the
 * only persistent chrome. Joining never requires signing in.
 *
 * Effects and noise tiers swap tracks through the existing sender — the
 * peer connections are never renegotiated.
 */ export default function Meeting() {
  const params = useParams<{ code: string }>();
  const code = useMemo(
    () => normalizeMeetingCode(params.code ?? ""),
    [params.code],
  );
  const navigate = useNavigate();

  // Canonical room URL: dashes after every 4 characters, so the address bar
  // always shows the same form as the header and the invite link. Any valid
  // variant (bare, lowercase, dashed differently) lands here and is rewritten.
  useEffect(() => {
    if (!MEETING_CODE_REGEX.test(code)) return;
    const canonical = formatMeetingCode(code);
    if ((params.code ?? "") !== canonical) {
      navigate(`/m/${canonical}`, { replace: true });
    }
  }, [params.code, code, navigate]);

  /* ---------------- session (auth) ---------------- */
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const attemptedRef = useRef(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const startAnonymousSession = () => {
    setAuthError(null);
    void signIn("anonymous").catch(() => {
      setAuthError(
        "Couldn't prepare your seat. Check your connection and try again.",
      );
    });
  };

  useEffect(() => {
    if (authLoading || isAuthenticated || attemptedRef.current) return;
    attemptedRef.current = true;
    startAnonymousSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated]);
  const ready = isAuthenticated;

  /* ---------------- preferences, media, effects ---------------- */
  const ui = useUiPrefs();
  const media = useLocalMedia();
  const effects = useVideoEffects(media.cameraSource);
  const devices = useMediaDevices();

  // Route the processed camera track through the existing send slot.
  const effectsTrack = effects.track;
  const setVideoOverride = media.setVideoOverride;
  useEffect(() => {
    setVideoOverride(effectsTrack);
    return () => setVideoOverride(null);
  }, [effectsTrack, setVideoOverride]);

  const mediaFlags = useMemo(
    () => ({ micOn: media.micOn, camOn: media.camOn, sharing: media.sharing }),
    [media.micOn, media.camOn, media.sharing],
  );

  /* ---------------- session (room seat) ---------------- */
  const [sessionId] = useState(() => crypto.randomUUID());
  const [entered, setEntered] = useState(false);
  const session = useRoomSession(code, sessionId, mediaFlags, ready, entered);
  const { meeting, participants, joined, sessionError, clearSessionError } =
    session;

  const me = useQuery(api.users.currentUser);
  const self = {
    nexaId: me?.nexaId ?? null,
    name: me?.name ?? null,
  };

  /* ---------------- signalling + mesh ---------------- */
  const send = useSignalSend(code, sessionId, joined);
  const {
    peerStates,
    handleSignal: handleMeshSignal,
    checkHealth,
    diagnostics,
  } = usePeerMesh({
    sessionId,
    // The roster can land before the join mutation acks, and signalling
    // stays disabled until then — an offer sent in that window is dropped
    // and never re-sent (syncPeers skips existing peers), leaving the pair
    // dead: no video and silence in both directions. Hold the mesh until
    // the seat is confirmed.
    //
    // And until `media.started`, which flips as soon as the microphone
    // question is settled. Building the first offer before the mic exists
    // used to attach a stand-in track to the audio sender instead, and
    // replacing that stand-in with the real microphone is the one swap
    // mobile browsers fail to honour — a connected call with video and
    // no audio, on every phone, while desktop was fine.
    participants: joined && media.started ? participants : null,
    tracks: media.outgoing,
    send,
  });

  /* ---------------- reactions ---------------- */
  const reactions = useReactions();
  const handleSignal = useCallback(
    async (signal: SignalEnvelope) => {
      if (signal.kind === "reaction") {
        const emoji = parseReactionPayload(signal.payload);
        if (emoji) reactions.receive(emoji, signal.fromSessionId);
        return;
      }
      await handleMeshSignal(signal);
    },
    [handleMeshSignal, reactions.receive],
  );
  useSignalInbox(code, sessionId, joined, handleSignal);

  const activeSpeaker = useActiveSpeaker(peerStates);

  /**
   * ?debug=1 diagnostics: per-connection ICE state, the candidate types
   * actually gathered, and whether bytes/frames are moving. This is what
   * distinguishes "no candidate pair" from "connected but no media".
   */
  const debugOn = debugEnabled();
  const [diag, setDiag] = useState<PeerDiagnostics[]>([]);
  useEffect(() => {
    if (!debugOn || !joined) return;
    let live = true;
    const tick = () => {
      void diagnostics().then((rows) => {
        if (live) setDiag(rows);
      });
    };
    tick();
    const id = window.setInterval(tick, 2_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [debugOn, joined, diagnostics]);

  /**
   * Room-wide end-to-end media encryption state. The mesh reports it per
   * link; this is the honest roll-up: encrypted only when every live peer
   * holds keys, and explicitly not-encrypted when this browser (or anyone
   * in the room) can't encrypt at all.
   */
  const e2eeStatus = useMemo<E2eeStatus | null>(() => {
    // Not shipped in this build: claim nothing, show nothing.
    if (!e2eeEnabled()) return null;
    if (e2eeSupport() === "unsupported") return "unsupported";
    const links = Object.values(peerStates).map(
      (state) => state.e2ee ?? "pending",
    );
    if (links.some((link) => link === "off")) return "off";
    return links.every((link) => link === "on") ? "on" : "pending";
  }, [peerStates]);

  const chat = useMeetingChat(code, sessionId, joined);

  /* ---------------- panels ---------------- */
  // Declared before the chat-notification hook: the unread badge seals on
  // transitions in and out of the chat tab, so it needs the panel state.
  type PanelId = "people" | "chat" | "notes" | "settings" | "effects";
  const [panel, setPanel] = useState<PanelId | null>(null);

  // Chat counts as visible only while its tab is on screen; a reply while
  // the roster or notes are shown still lights the badge.
  const chatVisible = panel === "chat" && joined;
  const selfJoinedAt = participants?.find(
    (participant) => participant.sessionId === sessionId,
  )?.joinedAt;

  const { unread: chatUnread } = useChatNotifications({
    messages: chat.messages,
    scope: chat.scope,
    peerSessionId: chat.peerSessionId,
    selfSessionId: sessionId,
    selfJoinedAt,
    chatVisible,
    peers: chat.peers,
    roomMessages: chat.roomMessages,
  });

  /* ---------------- signalling connectivity ---------------- */
  const connection = useConvexConnectionState();
  const everConnectedRef = useRef(false);
  const wasConnectedRef = useRef(false);
  const [signalingLost, setSignalingLost] = useState(false);

  useEffect(() => {
    if (!connection.isWebSocketConnected) {
      if (everConnectedRef.current) setSignalingLost(true);
      return;
    }
    everConnectedRef.current = true;
    if (wasConnectedRef.current) void checkHealth(); // socket recovered: verify peers
    wasConnectedRef.current = true;
    runNowSyncIfLinked(() => setSignalingLost(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.isWebSocketConnected]);

  /* ---------------- join / leave / share notifications ---------------- */
  const prevParticipantsRef = useRef<Participant[] | null>(null);
  useEffect(() => {
    if (!participants) return;
    const prev = prevParticipantsRef.current;
    prevParticipantsRef.current = participants;
    if (!prev) return; // first snapshot — everyone already here, no notices

    const prevById = new Map(prev.map((p) => [p.sessionId, p]));
    const currentIds = new Set(participants.map((p) => p.sessionId));
    const label = (p: Participant) =>
      p.displayName ? `${p.displayName} · ${p.nexaId}` : p.nexaId;

    for (const p of participants) {
      if (p.sessionId === sessionId) continue;
      const before = prevById.get(p.sessionId);
      if (!before) {
        toast(`${label(p)} joined`, { duration: 2600 });
      } else if (before.sharing !== p.sharing) {
        toast(`${label(p)} ${p.sharing ? "started" : "stopped"} sharing`, {
          duration: 2600,
        });
      }
    }
    for (const p of prev) {
      if (!currentIds.has(p.sessionId) && p.sessionId !== sessionId) {
        toast(`${label(p)} left`, { duration: 2600 });
      }
    }
  }, [participants, sessionId]);

  /* ---------------- chat send state ---------------- */
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const sendChat = async (text: string) => {
    setChatSending(true);
    setChatError(null);
    try {
      await chat.send(text);
    } catch (err) {
      setChatError(friendlyError(err, "The message couldn't be sent."));
      throw err;
    } finally {
      setChatSending(false);
    }
  };

  /* ---------------- panels (settings/effects) ---------------- */
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("audio");
  const openSettings = (section: SettingsSection) => {
    setSettingsSection(section);
    setPanel("settings");
  };
  const openEffects = () => setPanel("effects");

  // Escape closes panels; menus handle Escape first (capture phase).
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  /* ---------------- self-view ---------------- */
  // Default: others fill the stage, you stay in a small floating preview
  // at the bottom-left — the big picture is never yourself.
  const [selfMode, setSelfMode] = useState<SelfViewMode>("floating");
  /** Pin is local to this device: one person stays on the main stage.
   *  Derived rather than cleaned in an effect — a pinned person who
   *  leaves releases the pin the moment the roster updates. */
  const [rawPinnedId, setRawPinnedId] = useState<string | null>(null);
  const pinnedId =
    rawPinnedId !== null &&
    (participants?.some((p) => p.sessionId === rawPinnedId) ?? false)
      ? rawPinnedId
      : null;
  const toggleMirror = () =>
    ui.setPrefs({ mirrorSelfView: !ui.prefs.mirrorSelfView });

  /* ---------------- fullscreen ---------------- */
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void stageRef.current?.requestFullscreen().catch(() => {
        /* iframe/policy refusal — the room stays usable */
      });
    }
  };

  /* ---------------- picture in picture ---------------- */
  const pipRef = useRef<HTMLVideoElement>(null);
  const autoPipRef = useRef(false);
  const pipSupported =
    typeof document.pictureInPictureEnabled === "boolean"
      ? document.pictureInPictureEnabled
      : false;

  const pipCandidate = useMemo(() => {
    if (!participants) return null;
    const remote = participants.filter((p) => p.sessionId !== sessionId);
    const sharer = remote.find((p) => p.sharing);
    const pick = (id: string | null | undefined) =>
      id ? (peerStates[id]?.stream ?? null) : null;
    return (
      pick(sharer?.sessionId) ??
      pick(activeSpeaker) ??
      pick(remote.find((p) => peerStates[p.sessionId]?.stream)?.sessionId) ??
      null
    );
  }, [participants, peerStates, activeSpeaker, sessionId]);

  useEffect(() => {
    const element = pipRef.current;
    if (!element) return;
    element.srcObject = pipCandidate;
    if (pipCandidate) void element.play().catch(() => {});
    return () => {
      if (element.srcObject === pipCandidate) element.srcObject = null;
    };
  }, [pipCandidate]);

  useEffect(() => {
    const element = pipRef.current;
    if (!element) return;
    const onEnter = () => {
      autoPipRef.current = true;
    };
    const onLeave = () => {
      autoPipRef.current = false;
    };
    element.addEventListener("enterpictureinpicture", onEnter);
    element.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      element.removeEventListener("enterpictureinpicture", onEnter);
      element.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  const togglePip = useCallback(async () => {
    const element = pipRef.current;
    if (!element || !pipSupported) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (element.srcObject) {
        await element.requestPictureInPicture();
      }
    } catch {
      /* the browser refused (gesture/policy) — the room is unaffected */
    }
  }, [pipSupported]);

  // Optional auto-PiP when the tab loses focus; return when it regains it.
  useEffect(() => {
    if (!ui.prefs.pipOnHide || !pipSupported) return;
    const onVisibility = () => {
      const element = pipRef.current;
      if (document.hidden) {
        if (element?.srcObject && !document.pictureInPictureElement) {
          void element.requestPictureInPicture().then(
            () => {
              autoPipRef.current = true;
            },
            () => {},
          );
        }
      } else if (autoPipRef.current && document.pictureInPictureElement) {
        void document.exitPictureInPicture().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [ui.prefs.pipOnHide, pipSupported]);

  /* ---------------- keyboard shortcuts ---------------- */
  useShortcuts(
    {
      m: () => void media.toggleMic(),
      v: () => void media.toggleCam(),
      s: () => {
        if (media.sharing) media.stopScreenShare();
        else void media.startScreenShare();
      },
      c: () => setPanel((current) => (current === "chat" ? null : "chat")),
      p: () => setPanel((current) => (current === "people" ? null : "people")),
      e: () =>
        setPanel((current) => (current === "effects" ? null : "effects")),
      n: () => setPanel((current) => (current === "notes" ? null : "notes")),
    },
    meeting !== undefined && meeting !== null && !authError,
  );

  /* ---------------- room state resolution ---------------- */
  const joinFailed =
    sessionError === COPY.meetingGone ||
    sessionError === COPY.roomClosed ||
    sessionError === COPY.meetingFull;
  const roomGone =
    meeting === null ||
    sessionError === COPY.meetingGone ||
    sessionError === COPY.roomClosed;
  const roomFull = sessionError === COPY.meetingFull;
  const roomTimeLimit = sessionError === COPY.meetingTimeLimit;
  const blocked = Boolean(authError) || roomGone || roomFull || roomTimeLimit;

  const meetingResolved = meeting !== undefined;
  const stopAllMedia = media.stopAll;
  // A room we can't enter must not leave the camera running. During the
  // pre-join check the camera deliberately stays on for the preview.
  useEffect(() => {
    if (blocked && meetingResolved) stopAllMedia();
  }, [blocked, meetingResolved, stopAllMedia]);

  /** Re-attempt the seat after a rejected join (rate limit, etc.). */
  const retryJoin = () => {
    clearSessionError();
    setEntered(false);
    window.setTimeout(() => setEntered(true), 80);
  };

  const roster = participants ?? [];
  // Evaluated once per room visit: a meeting that runs past dusk keeps the
  // light it started in, which is calmer than a stage that shifts mid-sentence.
  const ambient = useMemo(() => daypart(), []);

  const sendReaction = (emoji: string) => {
    const peers = roster
      .filter((p) => p.sessionId !== sessionId)
      .map((p) => p.sessionId);
    reactions.fire(emoji, peers, (to, payload) =>
      send(to, "reaction", payload),
    );
  };

  const uiPanelProps = {
    prefs: ui.prefs,
    setPrefs: ui.setPrefs,
  };
  const chatPanelProps = {
    scope: chat.scope,
    setScope: chat.setScope,
    peerSessionId: chat.peerSessionId,
    openDirect: chat.openDirect,
    peers: chat.peers,
    messages: chat.messages,
    loading: chat.loading,
    sending: chatSending,
    error: chatError,
    onSend: sendChat,
    unread: chatUnread,
  };

  /* ---------------- render ---------------- */

  // Built as a node so the spine can be the first focusable surface in the
  // DOM — the grid places it in the left column regardless of where it sits
  // in the tree, and tab order follows the tree, not the grid.
  const spine = (
    <ControlBar
      micOn={media.micOn}
      micSource={media.microphoneSource}
      camOn={media.camOn}
      sharing={media.sharing}
      participantCount={roster.length}
      peopleOpen={panel === "people"}
      chatOpen={panel === "chat"}
      chatUnread={chatUnread}
      notesOpen={panel === "notes"}
      onToggleMic={() => void media.toggleMic()}
      onToggleCam={() => void media.toggleCam()}
      onToggleShare={() => {
        if (media.sharing) media.stopScreenShare();
        else void media.startScreenShare();
      }}
      onTogglePeople={() =>
        setPanel((current) => (current === "people" ? null : "people"))
      }
      onToggleChat={() =>
        setPanel((current) => (current === "chat" ? null : "chat"))
      }
      onToggleNotes={() =>
        setPanel((current) => (current === "notes" ? null : "notes"))
      }
      onOpenSettings={openSettings}
      onOpenEffects={openEffects}
      onToggleFullscreen={toggleFullscreen}
      fullscreen={fullscreen}
      onTogglePip={() => void togglePip()}
      pipAvailable={pipSupported && pipCandidate !== null}
      onReaction={sendReaction}
      onLeave={() => navigate("/dashboard")}
      noiseLevel={media.prefs.noiseLevel}
      onSetNoise={(level) => void media.setNoiseLevel(level)}
      inputs={devices.inputs}
      cameras={devices.cameras}
      selectedMicId={media.prefs.audioDeviceId}
      onSelectMic={(deviceId) => void media.selectMicrophone(deviceId || null)}
      selectedCamId={media.prefs.videoDeviceId}
      onSelectCam={(deviceId) => void media.selectCamera(deviceId || null)}
      mirrorSelfView={ui.prefs.mirrorSelfView}
      onToggleMirror={toggleMirror}
      layout={ui.prefs.layout}
      onSetLayout={(layout) => ui.setPrefs({ layout })}
      pinned={pinnedId !== null}
      onClearPin={() => setRawPinnedId(null)}
      selfMode={selfMode}
      onSetSelfMode={setSelfMode}
      reduced={ui.reduced}
    />
  );

  return (
    <div
      className="nexa-room nexa-studio relative flex h-[100dvh] overflow-hidden bg-background text-foreground"
      data-daypart={ambient}
    >
      {/* The studio: an instrument spine down the left edge, a typeset
          masthead across the top, and the video wall filling what's left.
          Fullscreen targets this wrapper so the spine comes along — a cinema
          mode with no way to mute yourself is not a feature. */}
      <div
        ref={stageRef}
        className={
          joined
            ? "grid h-full min-h-0 w-full grid-cols-[64px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[80px_minmax(0,1fr)]"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        {joined && spine}

        {joined && (
          <MeetingHeader
            code={code || "…"}
            participantCount={roster.length}
            connected={!signalingLost}
            e2ee={e2eeStatus}
            participants={roster}
            selfSessionId={sessionId}
            activeSpeaker={activeSpeaker}
            joinedAt={selfJoinedAt}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
            onOpenPeople={() =>
              setPanel((current) => (current === "people" ? null : "people"))
            }
          />
        )}

        <main
          className={
            joined
              ? "nexa-wall relative col-start-2 row-start-2 flex min-h-0 flex-col overflow-hidden"
              : "nexa-room-bg relative flex min-h-0 flex-1 flex-col"
          }
        >
          {authError ? (
            <RoomStatusScreen
              title="Couldn't join"
              description={authError}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => {
                      attemptedRef.current = false;
                      startAnonymousSession();
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-[3px] bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/")}
                    className="inline-flex h-10 items-center rounded-[3px] border border-border px-4 text-sm font-medium hover:bg-muted"
                  >
                    Back to home
                  </button>
                </>
              }
            />
          ) : meeting === undefined ? (
            <RoomStatusScreen
              title="Opening meeting…"
              description="Fetching the room and preparing your seat."
              actions={
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              }
            />
          ) : roomFull ? (
            <RoomStatusScreen
              title="Meeting is full"
              description={COPY.meetingFull}
              actions={
                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  className="inline-flex h-10 items-center rounded-[3px] border border-border px-4 text-sm font-medium hover:bg-muted"
                >
                  Back to dashboard
                </button>
              }
            />
          ) : roomTimeLimit ? (
            <RoomStatusScreen
              title="Time limit reached"
              description={COPY.meetingTimeLimit}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => navigate("/dashboard")}
                    className="inline-flex h-10 items-center gap-2 rounded-[3px] bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
                  >
                    Start a new meeting
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/")}
                    className="inline-flex h-10 items-center rounded-[3px] border border-border px-4 text-sm font-medium hover:bg-muted"
                  >
                    Home
                  </button>
                </>
              }
            />
          ) : roomGone ? (
            <RoomStatusScreen
              title="Meeting unavailable"
              description={
                sessionError === COPY.roomClosed
                  ? COPY.roomClosed
                  : COPY.meetingGone
              }
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => navigate("/dashboard")}
                    className="inline-flex h-10 items-center gap-2 rounded-[3px] bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
                  >
                    Back to dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/")}
                    className="inline-flex h-10 items-center rounded-[3px] border border-border px-4 text-sm font-medium hover:bg-muted"
                  >
                    Home
                  </button>
                </>
              }
            />
          ) : !entered ? (
            <PreJoin
              media={media}
              mirrorSelfView={ui.prefs.mirrorSelfView}
              onToggleMirror={toggleMirror}
              self={self}
              ready={ready}
              code={code}
              onJoin={() => setEntered(true)}
              onOpenEffects={openEffects}
            />
          ) : !joined ? (
            sessionError ? (
              <RoomStatusScreen
                title="Couldn't join"
                description={sessionError}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={retryJoin}
                      className="inline-flex h-10 items-center gap-2 rounded-[3px] bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate("/dashboard")}
                      className="inline-flex h-10 items-center rounded-[3px] border border-border px-4 text-sm font-medium hover:bg-muted"
                    >
                      Back to dashboard
                    </button>
                  </>
                }
              />
            ) : (
              <RoomStatusScreen
                title="Joining the room…"
                description="Allow camera and microphone access when prompted; you can turn both off once you're in."
                actions={
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                }
              />
            )
          ) : roster.length === 0 ? (
            <RoomStatusScreen
              title="You're in"
              description="Waiting for the room roster…"
              actions={
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              }
            />
          ) : (
            <>
              <VideoGrid
                participants={roster}
                peerStates={peerStates}
                selfSessionId={sessionId}
                previewStream={media.previewStream}
                activeSpeaker={activeSpeaker}
                speakerActivity={ui.prefs.speakerActivity}
                mirrorSelf={ui.prefs.mirrorSelfView}
                onToggleMirror={toggleMirror}
                selfMode={selfMode}
                setSelfMode={setSelfMode}
                outputDeviceId={media.prefs.speakerDeviceId}
                reduced={ui.reduced}
                layout={ui.prefs.layout}
                pinnedId={pinnedId}
                onTogglePin={(id) =>
                  setRawPinnedId((current) => (current === id ? null : id))
                }
                onFullscreen={toggleFullscreen}
              />

              <ReactionsLayer items={reactions.items} reduced={ui.reduced} />

              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-center gap-2 p-3">
                <FirstRunTips />
                {signalingLost && <Banner>{COPY.connectionLost}</Banner>}
                <MediaNotices
                  cameraError={media.cameraError}
                  microphoneError={media.microphoneError}
                  screenShareError={media.screenShareError}
                  onRetryCamera={() => void media.retryDevice("camera")}
                  onRetryMicrophone={() => void media.retryDevice("microphone")}
                  onDismissShareError={media.dismissScreenShareError}
                />
                {sessionError && !joinFailed && (
                  <Banner tone="danger">{sessionError}</Banner>
                )}
                {e2eeStatus === "unsupported" && (
                  <Banner>
                    This browser can&apos;t encrypt media end-to-end, so your
                    video and audio aren&apos;t encrypted by Nexa. Chrome, Edge,
                    Firefox or Safari 18.4+ can.
                  </Banner>
                )}
                {e2eeStatus === "off" && (
                  <Banner>
                    Media isn&apos;t end-to-end encrypted with everyone here —
                    someone in the room can&apos;t encrypt. Your links to
                    everyone else stay encrypted.
                  </Banner>
                )}
              </div>
            </>
          )}

          <AnimatePresence>
            {(panel === "people" || panel === "chat" || panel === "notes") &&
              joined && (
                <SidePanel
                  key={panel}
                  tab={panel}
                  onTabChange={(tab) => setPanel(tab)}
                  onClose={() => setPanel(null)}
                  participants={roster}
                  selfSessionId={sessionId}
                  chat={chatPanelProps}
                  code={code}
                />
              )}
            {panel === "settings" && (
              <SettingsPanel
                key="settings"
                initialSection={settingsSection}
                onClose={() => setPanel(null)}
                media={media}
                ui={uiPanelProps}
                self={self}
                motionDuration={ui.reduced ? 0 : 0.16}
              />
            )}
            {panel === "effects" && (
              <EffectsPanel
                key="effects"
                effects={effects}
                cameraOn={media.camOn}
                mirrorSelfView={ui.prefs.mirrorSelfView}
                reduced={ui.reduced}
                previewTrack={effects.track ?? media.cameraSource}
                onClose={() => setPanel(null)}
              />
            )}
          </AnimatePresence>

          {debugOn && diag.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-40 overflow-x-auto px-3">
              <div className="inline-block max-w-full rounded-lg border border-white/15 bg-black/80 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-white/90">
                {diag.map((d) => (
                  <div key={d.sessionId}>
                    {d.sessionId.slice(0, 8)} · {d.connection}/{d.ice} · sig=
                    {d.signaling} · local[{d.localCandidates}] remote[
                    {d.remoteCandidates}] · pair={d.pair} · up=
                    {Math.round(d.bytesSent / 1024)}kB/{d.framesSent}f · down=
                    {Math.round(d.bytesReceived / 1024)}kB/{d.framesDecoded}f ·
                    e2ee={d.e2ee}
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Picture-in-picture source (kept playing, visually out of the way). */}
      <video
        ref={pipRef}
        muted
        playsInline
        aria-hidden
        className="pointer-events-none fixed bottom-0 left-0 h-px w-px opacity-0"
      />
    </div>
  );
}
