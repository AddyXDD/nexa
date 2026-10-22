import { NexaMark } from "@/components/NexaMark";
import { loadValue, saveJson } from "@/lib/prefs";
import { COPY } from "@/shared/constants";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/**
 * In-room messages, drawn as small pieces of paper on the ink stage.
 *
 * The room treats notices as physical objects: bone card, ink type, a
 * coloured edge for severity. That is the same material as the masthead and
 * the desk sheet, so a warning reads as part of the instrument rather than
 * as a translucent toast that happened to land on the video.
 */

/** Small in-room banner (connection, media, session problems). */
export function Banner({
  tone = "warning",
  children,
  action,
}: {
  tone?: "warning" | "danger" | "info";
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  // A notice is a strip, not a card: one accent edge states severity, the
  // paper carries the sentence. No radius, no floating shadow.
  const tones = {
    info: "border-l-[color:var(--nexa-ink)]/45 bg-[color:var(--nexa-bone)] text-[color:var(--nexa-ink)]",
    warning: "border-l-[#B99733] bg-[#FBF3D6] text-[#4E3F12]",
    danger: "border-l-[#B3261E] bg-[#FBE7E3] text-[#6E1912]",
  } as const;
  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-xl items-center gap-3 border-l-2 px-3 py-2 text-[12px] shadow-[0_12px_28px_-22px_rgba(0,0,0,0.9)] ${tones[tone]}`}
    >
      <span className="flex-1 leading-relaxed">{children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 border border-black/15 bg-white/40 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--nexa-ink)] transition-colors hover:bg-white/70"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Aggregates camera/microphone/screen-share problems into actionable
 * banners — the user is never left wondering why their tile is dead.
 */
export function MediaNotices({
  cameraError,
  microphoneError,
  screenShareError,
  onRetryCamera,
  onRetryMicrophone,
  onDismissShareError,
}: {
  cameraError: string | null;
  microphoneError: string | null;
  screenShareError: string | null;
  onRetryCamera: () => void;
  onRetryMicrophone: () => void;
  onDismissShareError: () => void;
}) {
  if (!cameraError && !microphoneError && !screenShareError) return null;
  return (
    <>
      {cameraError && (
        <Banner action={{ label: "Retry", onClick: onRetryCamera }}>
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-3.5 shrink-0" />
            {cameraError}
          </span>
        </Banner>
      )}
      {microphoneError && (
        <Banner action={{ label: "Retry", onClick: onRetryMicrophone }}>
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-3.5 shrink-0" />
            {microphoneError}
          </span>
        </Banner>
      )}
      {screenShareError && (
        <Banner action={{ label: "Dismiss", onClick: onDismissShareError }}>
          {screenShareError}
        </Banner>
      )}
    </>
  );
}

/** Full-screen state while we resolve the room / establish a seat. */
export function RoomStatusScreen({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-10 text-center">
      <NexaMark className="size-9" />
      <div className="space-y-2.5">
        <p className="nexa-label text-white/50">Nexa Meet</p>
        <h1 className="text-2xl font-medium tracking-tight text-white sm:text-[2rem]">
          {title}
        </h1>
        {description && (
          <p className="mx-auto max-w-md text-sm leading-relaxed text-white/65">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------ FIRST-RUN ORIENTATION */

/** Remembered per browser, never sent anywhere. */
const FIRST_RUN_KEY = "firstRunTipsSeen";

const FIRST_RUN_POINTS: Array<[string, string]> = [
  ["Controls", "every key is labelled on the left"],
  ["Shortcuts", "M mute · V camera · S present"],
  ["Fullscreen", "keeps controls visible"],
];

/**
 * One line of orientation inside a freshly joined room, shown once per
 * browser. Not a welcome card: the rail is already labelled, so this only
 * adds the three shortcuts and the note that fullscreen keeps the controls.
 * It removes itself after a few seconds.
 */
export function FirstRunTips() {
  const [visible, setVisible] = useState(
    () => !loadValue(FIRST_RUN_KEY, false),
  );

  // Shown once: the flag flips on first render, so a reload stays quiet.
  useEffect(() => {
    if (!visible) return;
    saveJson(FIRST_RUN_KEY, true);
    const timer = window.setTimeout(() => setVisible(false), 9000);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="pointer-events-none flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-[#08090b]/85 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/70"
    >
      {FIRST_RUN_POINTS.map(([label, body], index) => (
        <span key={label} className="flex items-center gap-2">
          {index > 0 && (
            <span aria-hidden className="text-white/30">
              ·
            </span>
          )}
          <span className="text-white">{label}</span>
          <span>{body}</span>
        </span>
      ))}
    </div>
  );
}

export const ROOM_GONE_TITLE = "Meeting unavailable";
export const ROOM_GONE_DESC = COPY.meetingGone;
