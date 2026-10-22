import type { LayoutChoice } from "@/hooks/use-ui-prefs";
import { useIsMobile } from "@/hooks/use-mobile";
import type { PeerState } from "@/lib/webrtc/peerManager";
import type { Participant } from "@/shared/types";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, FlipHorizontal2, Minimize2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { VideoTile } from "./VideoTile";

/**
 * The wall.
 *
 * Not a grid of floating cards — one surface, divided by 3px joints, with
 * each participant in a square plate and a single strip of paper for a
 * caption. The geometry never reorders itself for speech: the room stays
 * still and the voice is marked in the caption instead.
 *
 * Three compositions:
 *  - Wall (auto): rows of equal plates. Rows are built explicitly so the
 *    last row stretches instead of leaving a hole — five people read as
 *    three over two, never three over two-plus-a-gap.
 *  - Stage: a presenter, a pinned person, or a speaker on a large plate,
 *    with everyone else on a filmstrip shelf beneath it. The shelf replaces
 *    the usual right-hand thumbnail rail.
 *  - Spotlight: the stage alone.
 *
 * Motion is a 120ms fade and nothing else — no scaling plates, no layout
 * animation while video is playing.
 */

export type SelfViewMode = "grid" | "floating" | "hidden";

export function VideoGrid({
  participants,
  peerStates,
  selfSessionId,
  previewStream,
  activeSpeaker,
  speakerActivity,
  mirrorSelf,
  onToggleMirror,
  selfMode,
  setSelfMode,
  outputDeviceId,
  reduced,
  layout,
  pinnedId,
  onTogglePin,
  onFullscreen,
}: {
  participants: Participant[];
  peerStates: Record<string, PeerState>;
  selfSessionId: string;
  previewStream: MediaStream | null;
  activeSpeaker: string | null;
  speakerActivity: boolean;
  mirrorSelf: boolean;
  onToggleMirror: () => void;
  selfMode: SelfViewMode;
  setSelfMode: (mode: SelfViewMode) => void;
  outputDeviceId: string | null;
  reduced: boolean;
  layout: LayoutChoice;
  pinnedId: string | null;
  onTogglePin: (sessionId: string) => void;
  /** Fullscreens the studio, so the spine and masthead stay on screen. */
  onFullscreen: () => void;
}) {
  const isMobile = useIsMobile();
  const self = participants.find((p) => p.sessionId === selfSessionId);
  const others = participants.filter((p) => p.sessionId !== selfSessionId);
  const sharer = participants.find((p) => p.sharing);

  const tileFor = (participant: Participant) => {
    const isLocal = participant.sessionId === selfSessionId;
    const peerState = isLocal ? undefined : peerStates[participant.sessionId];
    return {
      participant,
      isLocal,
      stream: isLocal ? previewStream : (peerState?.stream ?? null),
      status: isLocal ? ("connected" as const) : (peerState?.status ?? "new"),
      speaking:
        speakerActivity && participant.sessionId === activeSpeaker && !isLocal,
      mirror: isLocal && mirrorSelf,
      outputDeviceId: isLocal ? null : outputDeviceId,
      pinned: participant.sessionId === pinnedId,
      onTogglePin: () => onTogglePin(participant.sessionId),
      onFullscreen,
    };
  };

  // Motion only marks a real change: a person taking or leaving the stage.
  // Nothing scales, nothing glows, nothing moves on a timer.
  const transition = reduced ? { duration: 0 } : { duration: 0.12 };
  const pop = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  };

  const floatingSelf = (subjectId: string | null) =>
    self !== undefined &&
    selfMode === "floating" &&
    subjectId !== selfSessionId;

  /* ---------------- presenting ---------------- */

  if (sharer) {
    const shelf = participants.filter(
      (p) =>
        p.sessionId !== sharer.sessionId &&
        (selfMode === "grid" || p.sessionId !== selfSessionId),
    );
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative min-h-0 flex-1">
          <AnimatePresence initial={false}>
            <motion.div
              key={sharer.sessionId}
              {...pop}
              transition={transition}
              className="absolute inset-0"
            >
              <VideoTile {...tileFor(sharer)} fit="contain" />
            </motion.div>
          </AnimatePresence>

          {floatingSelf(sharer.sessionId) && self && (
            <FloatingSelfView
              tileProps={tileFor(self)}
              reduced={reduced}
              selfMode={selfMode}
              setSelfMode={setSelfMode}
              onToggleMirror={onToggleMirror}
            />
          )}
        </div>

        <Shelf people={shelf} tileFor={tileFor} transition={transition} />
      </div>
    );
  }

  /* ---------------- stage (pin / sidebar / spotlight) ---------------- */

  if (pinnedId !== null || layout !== "auto") {
    const subject =
      participants.find((p) => p.sessionId === pinnedId) ??
      (activeSpeaker !== null
        ? participants.find((p) => p.sessionId === activeSpeaker)
        : undefined) ??
      others[0] ??
      self ??
      participants[0];

    const showShelf = layout !== "spotlight";
    const shelf = showShelf
      ? participants.filter(
          (p) =>
            p.sessionId !== subject.sessionId &&
            (selfMode === "grid" || p.sessionId !== selfSessionId),
        )
      : [];

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative min-h-0 flex-1">
          <AnimatePresence initial={false}>
            <motion.div
              key={subject.sessionId}
              {...pop}
              transition={transition}
              className="absolute inset-0"
            >
              <VideoTile {...tileFor(subject)} />
            </motion.div>
          </AnimatePresence>

          {floatingSelf(subject.sessionId) && self && (
            <FloatingSelfView
              tileProps={tileFor(self)}
              reduced={reduced}
              selfMode={selfMode}
              setSelfMode={setSelfMode}
              onToggleMirror={onToggleMirror}
            />
          )}
        </div>

        <Shelf people={shelf} tileFor={tileFor} transition={transition} />
      </div>
    );
  }

  /* ---------------- wall (auto) ---------------- */

  const list = selfMode === "grid" ? participants : others;

  if (list.length === 0) {
    return (
      <div className="relative flex h-full min-h-0 flex-col items-center justify-center px-8 text-center">
        <h2 className="nexa-display max-w-md text-[1.4rem] leading-tight text-white/80">
          You&apos;re the only one here.
        </h2>
        <p className="mt-2.5 max-w-sm text-[13px] leading-relaxed text-white/60">
          Copy the room code from the top bar and share it with whoever should
          join.
        </p>
        {selfMode === "hidden" && (
          <button
            type="button"
            onClick={() => setSelfMode("grid")}
            className="mt-5 inline-flex h-9 items-center gap-2 bg-[color:var(--nexa-bone)] px-3.5 text-[12px] font-semibold text-[color:var(--nexa-ink)] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
          >
            <Eye className="size-3.5" /> Show self-view
          </button>
        )}

        {selfMode === "floating" && self && (
          <FloatingSelfView
            tileProps={tileFor(self)}
            reduced={reduced}
            selfMode={selfMode}
            setSelfMode={setSelfMode}
            onToggleMirror={onToggleMirror}
          />
        )}
      </div>
    );
  }

  const count = list.length;
  const columns = columnsFor(count, isMobile);
  const rows: Participant[][] = [];
  for (let index = 0; index < list.length; index += columns) {
    rows.push(list.slice(index, index + columns));
  }
  const alone = count === 1 && list[0].sessionId === selfSessionId;

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-[3px] p-[3px]">
      {rows.map((row, rowIndex) => (
        <div
          key={`row-${rowIndex}`}
          className="flex min-h-0 flex-1 gap-[3px]"
        >
          {row.map((participant) => (
            <motion.div
              key={participant.sessionId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={transition}
              className="relative min-h-0 min-w-0 flex-1"
            >
              <VideoTile {...tileFor(participant)} />
            </motion.div>
          ))}
        </div>
      ))}

      {alone && (
        <p className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-4 font-mono text-[9px] uppercase tracking-[0.14em] text-white/55">
          Waiting for the room — the code is at the top
        </p>
      )}

      {selfMode === "floating" && self && (
        <FloatingSelfView
          tileProps={tileFor(self)}
          reduced={reduced}
          selfMode={selfMode}
          setSelfMode={setSelfMode}
          onToggleMirror={onToggleMirror}
        />
      )}
    </div>
  );
}

/**
 * How many plates per row. Rows are explicit, so the last one stretches to
 * fill the width instead of leaving a hole.
 */
function columnsFor(count: number, isMobile: boolean): number {
  if (isMobile) return count <= 2 ? 1 : 2;
  if (count <= 3) return count;
  if (count === 4) return 2;
  if (count <= 6) return 3;
  if (count <= 8) return 4;
  if (count === 9) return 3;
  if (count <= 12) return 4;
  return 5;
}

/* ------------------------------------------------------------------ *
 * The filmstrip shelf
 * ------------------------------------------------------------------ */

function Shelf({
  people,
  tileFor,
  transition,
}: {
  people: Participant[];
  tileFor: (participant: Participant) => Parameters<typeof VideoTile>[0];
  transition: { duration: number };
}) {
  if (people.length === 0) return null;
  return (
    <div className="flex h-[4.75rem] shrink-0 gap-[3px] overflow-x-auto px-[3px] pb-[3px] pt-[3px] sm:h-[6.25rem]">
      <AnimatePresence initial={false}>
        {people.map((participant) => (
          <motion.div
            key={participant.sessionId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            className="h-full w-[7.5rem] shrink-0 sm:w-[10rem]"
          >
            <VideoTile {...tileFor(participant)} variant="mini" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Floating self-view — a small plate you can park anywhere
 * ------------------------------------------------------------------ */

const SELF_W = 176;
const SELF_H = 99;
const EDGE = 10;

type TileProps = Parameters<typeof VideoTile>[0];

function FloatingSelfView({
  tileProps,
  reduced,
  selfMode,
  setSelfMode,
  onToggleMirror,
}: {
  tileProps: TileProps;
  reduced: boolean;
  selfMode: SelfViewMode;
  setSelfMode: (mode: SelfViewMode) => void;
  onToggleMirror: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const clamp = (x: number, y: number, rect: DOMRect) => ({
    x: Math.min(Math.max(EDGE, x), Math.max(EDGE, rect.width - SELF_W - EDGE)),
    y: Math.min(
      Math.max(EDGE, y),
      Math.max(EDGE, rect.height - SELF_H - EDGE),
    ),
  });

  // Park it in the bottom-left of the wall, and keep it in bounds when the
  // composition changes.
  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    parentRef.current = parent;
    const rect = parent.getBoundingClientRect();
    if (!pos) {
      // Bottom-right: gallery labels live at each plate's bottom-left, so
      // this corner is the one place a floating plate covers no caption.
      setPos({
        x: rect.width - SELF_W - 10,
        y: rect.height - SELF_H - 10,
      });
      return;
    }
    const onResize = () => {
      const next = parent.getBoundingClientRect();
      setPos((current) =>
        current ? clamp(current.x, current.y, next) : current,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos === null]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const parent = parentRef.current;
    if (!parent || !pos) return;
    const rect = parent.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      dx: event.clientX - rect.left - pos.x,
      dy: event.clientY - rect.top - pos.y,
    };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const parent = parentRef.current;
    if (!drag || !parent) return;
    const rect = parent.getBoundingClientRect();
    setPos(
      clamp(
        event.clientX - rect.left - drag.dx,
        event.clientY - rect.top - drag.dy,
        rect,
      ),
    );
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
      setDragging(false);
    }
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        width: SELF_W,
        height: SELF_H,
        left: pos?.x ?? -9999,
        top: pos?.y ?? -9999,
        zIndex: 25,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`shadow-[0_18px_40px_-24px_rgba(0,0,0,0.95)] ${
        dragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      aria-label="Self view (drag to move)"
    >
      <VideoTile {...tileProps} variant="mini" />

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.14 }}
            className="absolute right-1 top-1 z-20 flex gap-1"
          >
            <SelfButton
              label="Put self-view on the wall"
              onClick={() => setSelfMode("grid")}
            >
              <Minimize2 className="size-3" />
            </SelfButton>
            <SelfButton label="Mirror self-view" onClick={onToggleMirror}>
              <FlipHorizontal2 className="size-3" />
            </SelfButton>
            <SelfButton
              label="Hide self-view"
              onClick={() => setSelfMode("hidden")}
            >
              <EyeOff className="size-3" />
            </SelfButton>
          </motion.div>
        )}
      </AnimatePresence>

      {selfMode === "hidden" && (
        <span className="sr-only">Self-view hidden</span>
      )}
    </div>
  );
}

function SelfButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      className="inline-flex size-5 items-center justify-center bg-[color:var(--nexa-bone)] text-[color:var(--nexa-ink)] shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
    >
      {children}
    </button>
  );
}
