import { COPY } from "@/shared/constants";
import type { Participant, PeerStatus } from "@/shared/types";
import { Maximize2, Mic, MicOff, MonitorUp, Pin } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * One plate on the wall.
 *
 * The video is the object: a square panel, edge to edge, with a hairline
 * that separates it from its neighbour. Identification is a single strip of
 * paper resting on the bottom edge — name, Nexa ID where there is room, mic
 * state. When that person is speaking the strip prints on signal lime and
 * carries a three-bar meter; nothing else about the plate changes.
 *
 * No rounded card, no glowing ring, no frame number, no glass. The plate is
 * furniture; the strip is the label on it.
 *
 * The local tile is muted at the element level — hearing yourself is never
 * useful and it's how feedback loops start.
 */
export function VideoTile({
  participant,
  isLocal,
  stream,
  status,
  speaking = false,
  mirror = false,
  fit = "cover",
  onFullscreen,
  outputDeviceId,
  rootRef,
  pinned = false,
  onTogglePin,
  variant = "plate",
}: {
  participant: Participant;
  isLocal: boolean;
  stream: MediaStream | null;
  status: PeerStatus;
  speaking?: boolean;
  mirror?: boolean;
  fit?: "cover" | "contain";
  onFullscreen?: () => void;
  outputDeviceId?: string | null;
  rootRef?: React.RefObject<HTMLDivElement | null>;
  pinned?: boolean;
  onTogglePin?: () => void;
  /** `plate` is a wall panel; `mini` is a filmstrip frame with an inline tab. */
  variant?: "plate" | "mini";
}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const tileRef = rootRef ?? internalRef;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsTap, setNeedsTap] = useState(false);

  const mini = variant === "mini";
  const hasVideoTrack = !!stream && stream.getVideoTracks().length > 0;
  const showVideo = (participant.camOn || participant.sharing) && hasVideoTrack;

  // Mirroring is a camera convention, never a tile convention: a screen
  // share replaces the camera in this same tile, so the decision has to
  // follow the content. Both the presenter flag and the tag use-local-media
  // puts on a preview built from a captured track mean "not a camera".
  const streamIsCapture =
    participant.sharing ||
    (stream !== null && (stream as { isCapture?: boolean }).isCapture === true);

  // Attach the stream and start playback (autoplay policies can block it —
  // if so, we surface a tap-to-unmute affordance instead of silence).
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (!stream) return;
    const tryPlay = () => {
      const attempt = el.play();
      if (attempt) attempt.catch(() => setNeedsTap(true));
    };
    tryPlay();
    // Remote tracks land on the stream after the connection completes, so
    // playback can start before this peer's audio exists — retry as tracks
    // arrive (and if it was blocked, the tap affordance appears).
    stream.addEventListener("addtrack", tryPlay);
    // Mobile browsers hand over the remote audio track in a *muted* state
    // and only unmute it once the first RTP arrives, which can be well
    // after play() has already resolved. The element then sits "playing"
    // and permanently silent. Nudging it when the track actually unmutes
    // is what makes sound appear on a phone.
    const audioTracks = stream.getAudioTracks();
    for (const track of audioTracks) track.addEventListener("unmute", tryPlay);
    return () => {
      stream.removeEventListener("addtrack", tryPlay);
      for (const track of audioTracks) {
        track.removeEventListener("unmute", tryPlay);
      }
      if (el.srcObject === stream) el.srcObject = null;
    };
  }, [stream]);

  // Route remote audio to the chosen output when the browser allows it.
  useEffect(() => {
    const el = videoRef.current as
      | (HTMLVideoElement & {
          setSinkId?: (id: string) => Promise<void>;
        })
      | null;
    if (!el || isLocal || !outputDeviceId) return;
    if (typeof el.setSinkId !== "function") return;
    void el.setSinkId(outputDeviceId).catch(() => {
      /* device vanished — default output keeps working */
    });
  }, [outputDeviceId, isLocal, stream]);

  const statusLabel =
    status === "failed"
      ? COPY.peerFailed
      : status === "reconnecting"
        ? "Unstable"
        : status === "connected"
          ? null
          : "Connecting";

  const monogram = (participant.displayName ?? participant.nexaId)
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  const displayName = participant.displayName ?? participant.nexaId;

  return (
    <div
      ref={tileRef}
      className="group/tile relative h-full min-h-0 w-full"
    >
      <div className="nexa-plate absolute inset-0 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          onClick={() => {
            if (!needsTap) return;
            void videoRef.current?.play().then(() => setNeedsTap(false));
          }}
          className={`h-full w-full bg-transparent ${
            fit === "contain" ? "object-contain" : "object-cover"
          } ${showVideo ? "opacity-100" : "opacity-0"} ${
            mirror && !streamIsCapture ? "-scale-x-100" : ""
          }`}
        />

        {!showVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[#101115]">
            {/* The Nexa ID is the portrait: a watermark, then the initials. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 flex select-none items-center justify-center"
            >
              <span className="font-mono text-[clamp(1.4rem,7vw,3.5rem)] font-medium tracking-[0.16em] text-white/[0.04]">
                {participant.nexaId}
              </span>
            </span>
            <span className="nexa-display relative grid size-12 place-items-center rounded-full border border-white/20 bg-white/[0.06] text-[17px] text-white/90 sm:size-14 sm:text-[19px]">
              {monogram || "NX"}
            </span>
            {!mini && (
              <span className="relative font-mono text-[9px] uppercase tracking-[0.18em] text-white/70">
                Camera off
              </span>
            )}
          </div>
        )}

        {/* Remote link and presentation state — small, factual, no glass. */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          <div className="flex flex-col items-start gap-1">
            {participant.sharing && (
              <span className="inline-flex items-center gap-1 bg-[#08090b]/85 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-white/90 outline outline-1 outline-white/10">
                <MonitorUp className="size-2.5 text-[color:var(--nexa-accent)]" />
                {isLocal ? "You're sharing" : "Sharing"}
              </span>
            )}
            {!isLocal && statusLabel && (
              <span
                className={`inline-flex items-center gap-1 bg-[#08090b]/85 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] outline outline-1 outline-white/10 ${
                  status === "reconnecting" || status === "failed"
                    ? "text-amber-300"
                    : "text-white/75"
                }`}
              >
                <span
                  className={`size-1 rounded-full ${
                    status === "reconnecting" || status === "failed"
                      ? "nexa-live bg-amber-400"
                      : "bg-white/40"
                  }`}
                />
                {statusLabel}
              </span>
            )}
          </div>

          {/* Hover keys stay out of the way until the plate is touched. */}
          {!mini && (
            <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/tile:opacity-100">
              {onTogglePin && (
                <button
                  type="button"
                  onClick={onTogglePin}
                  title={pinned ? "Unpin" : "Pin to the stage"}
                  aria-label={
                    pinned
                      ? "Unpin this participant"
                      : "Pin this participant to the stage"
                  }
                  aria-pressed={pinned}
                  className={`pointer-events-auto inline-flex size-6 items-center justify-center bg-[#08090b]/85 outline outline-1 outline-white/12 transition-colors hover:bg-[#08090b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)] ${
                    pinned
                      ? "text-[color:var(--nexa-accent)] opacity-100"
                      : "text-white/65 hover:text-white"
                  } ${pinned ? "opacity-100" : ""}`}
                >
                  <Pin className="size-3" />
                </button>
              )}
              <button
                type="button"
                onClick={
                  onFullscreen ??
                  (() => {
                    void tileRef.current?.requestFullscreen().catch(() => {
                      /* fullscreen unavailable (e.g. iframe policy) */
                    });
                  })
                }
                title="Fullscreen the room — controls stay on screen"
                aria-label={`Fullscreen the room while ${displayName} is on the wall`}
                className="pointer-events-auto inline-flex size-6 items-center justify-center bg-[#08090b]/85 text-white/65 outline outline-1 outline-white/12 transition-colors hover:bg-[#08090b] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
              >
                <Maximize2 className="size-3" />
              </button>
            </div>
          )}
        </div>

        {/* Shown for audio-only plates too — a blocked play() there used to
            be completely silent with no way to discover the cause. */}
        {needsTap && !isLocal && (
          <button
            type="button"
            onClick={() => {
              void videoRef.current?.play().then(() => setNeedsTap(false));
            }}
            className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 bg-[color:var(--nexa-bone)] px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--nexa-ink)] shadow-lg"
          >
            Tap for sound
          </button>
        )}

        {mini && (
          <NameTab
            participant={participant}
            isLocal={isLocal}
            speaking={speaking}
            pinned={pinned}
            mini
            className="absolute bottom-1 left-1 z-10"
          />
        )}
      </div>

      {!mini && (
        <NameTab
          participant={participant}
          isLocal={isLocal}
          speaking={speaking}
          pinned={pinned}
          className="absolute bottom-2 left-2 z-10"
        />
      )}
    </div>
  );
}

/**
 * The caption strip. It is the only piece of paper on the wall, so it reads
 * as a label rather than as another card: name, ID where there is room, mic
 * state. Speaking prints the same strip on lime.
 */
function NameTab({
  participant,
  isLocal,
  speaking,
  pinned,
  mini = false,
  className = "",
}: {
  participant: Participant;
  isLocal: boolean;
  speaking: boolean;
  pinned: boolean;
  mini?: boolean;
  className?: string;
}) {
  const name = participant.displayName ?? participant.nexaId;
  return (
    <span
      data-live={speaking ? "true" : undefined}
      className={`nexa-tab pointer-events-none inline-flex max-w-[calc(100%-0.5rem)] items-center gap-1.5 ${
        mini ? "px-1.5 py-[3px]" : "px-2 py-1"
      } ${className}`}
    >
      {speaking && (
        <span className="nexa-eq" aria-hidden>
          <span />
          <span style={{ animationDelay: "120ms" }} />
          <span style={{ animationDelay: "240ms" }} />
        </span>
      )}
      {isLocal && (
        <span className="font-mono text-[7.5px] uppercase tracking-[0.14em] opacity-65">
          You
        </span>
      )}
      <span
        className={`truncate font-medium leading-none ${
          mini ? "text-[10px]" : "text-[11px]"
        }`}
      >
        {name}
      </span>
      {!mini && (
        <span className="hidden font-mono text-[8.5px] tracking-[0.06em] opacity-70 md:inline">
          {participant.nexaId}
        </span>
      )}
      {pinned && <Pin className="size-2.5 opacity-65" />}
      <span
        title={participant.micOn ? "Microphone on" : "Muted"}
        className={`inline-flex items-center ${
          participant.micOn
            ? "opacity-55"
            : speaking
              ? "opacity-80"
              : "text-[#B3261E]"
        }`}
      >
        {participant.micOn ? (
          <Mic className={mini ? "size-2.5" : "size-3"} />
        ) : (
          <MicOff className={mini ? "size-2.5" : "size-3"} />
        )}
        <span className="sr-only">
          {participant.micOn ? "Microphone on" : "Muted"}
        </span>
      </span>
    </span>
  );
}
