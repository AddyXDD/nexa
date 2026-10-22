import { COPY, formatMeetingCode } from "@/shared/constants";
import type { Participant } from "@/shared/types";
import {
  Check,
  Copy,
  Lock,
  LockOpen,
  Maximize,
  MicOff,
  Minimize,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { RoomClock } from "./RoomClock";

/** Room-wide end-to-end media encryption status. */
export type E2eeStatus = "on" | "pending" | "off" | "unsupported";

/** Up to this many names in the running line before it condenses. */
const MAX_NAMES = 6;

/**
 * The masthead.
 *
 * A typeset line, not a toolbar: the brand and the room code on the left,
 * the room's roll call running as text in the middle, and the clock,
 * security and headcount on the right. There is no card, no fill and no
 * shadow — one hairline rule separates it from the wall, the way a masthead
 * sits over a printed page.
 *
 * Presence is text rather than a row of avatar bubbles. The person speaking
 * is set in signal lime; someone muted carries a small struck microphone.
 */
export function MeetingHeader({
  code,
  participantCount,
  connected,
  e2ee = null,
  participants,
  selfSessionId,
  activeSpeaker = null,
  joinedAt,
  fullscreen = false,
  onToggleFullscreen,
  onOpenPeople,
}: {
  code: string;
  participantCount: number;
  connected: boolean;
  /**
   * End-to-end encryption state, shown beside the connection. `null` means
   * the feature isn't shipped in this build, so nothing is claimed either way.
   */
  e2ee?: E2eeStatus | null;
  /** Roster for the running line; omitted on screens too narrow for it. */
  participants?: Participant[];
  selfSessionId?: string;
  activeSpeaker?: string | null;
  /** When this seat joined, for the elapsed clock. */
  joinedAt?: number;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onOpenPeople?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const displayCode = formatMeetingCode(code);
  // The copied link matches the code shown in the masthead — dashes included
  // — so what people see is exactly what they share. The route accepts both.
  const inviteLink = `${window.location.origin}/m/${displayCode}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the code is visible for manual sharing */
    }
  };

  const shown = participants?.slice(0, MAX_NAMES) ?? [];
  const extra = (participants?.length ?? 0) - shown.length;

  return (
    <header className="nexa-masthead relative z-30 col-start-2 row-start-1 flex h-12 shrink-0 items-center gap-2.5 px-3 text-[color:var(--nexa-bone)] sm:gap-3 sm:px-4">
      {/* ---------------------------------------------------------- identity */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="nexa-label hidden text-white/65 md:inline">
          Nexa Meet
        </span>
        <span aria-hidden className="hidden h-4 w-px bg-white/10 md:block" />

        <button
          type="button"
          onClick={copy}
          title="Copy the room link"
          aria-label={`Copy room link — ${displayCode}`}
          className="group flex min-w-0 items-center gap-1.5 px-0.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
        >
          <span className="nexa-label hidden text-white/65 sm:inline">
            Room
          </span>
          <span className="truncate font-mono text-[11.5px] tracking-[0.16em] text-white/85 group-hover:text-white">
            {displayCode}
          </span>
          {copied ? (
            <Check className="size-3 shrink-0 text-[color:var(--nexa-accent)]" />
          ) : (
            <Copy className="size-3 shrink-0 text-white/60 transition-colors group-hover:text-white" />
          )}
        </button>
      </div>

      <span aria-hidden className="h-4 w-px shrink-0 bg-white/10" />

      {/* ---------------------------------------------------------- roll call */}
      {onOpenPeople ? (
        <button
          type="button"
          onClick={onOpenPeople}
          aria-label={`${participantCount} ${
            participantCount === 1 ? "person" : "people"
          } here — open the roster`}
          className="group flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
        >
          <span className="nexa-label hidden shrink-0 text-white/65 sm:inline">
            Here
          </span>
          <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
            {shown.map((participant, index) => {
              const speaking = participant.sessionId === activeSpeaker;
              const isSelf = participant.sessionId === selfSessionId;
              const name = participant.displayName ?? participant.nexaId;
              return (
                <span
                  key={participant.sessionId}
                  className="flex shrink-0 items-center gap-1.5"
                >
                  {index > 0 && (
                    <span
                      aria-hidden
                      className="font-mono text-[10px] text-white/45"
                    >
                      /
                    </span>
                  )}
                  <span
                    title={
                      participant.displayName
                        ? `${participant.displayName} · ${participant.nexaId}`
                        : participant.nexaId
                    }
                    className={`text-[11.5px] font-medium leading-none ${
                      speaking
                        ? "text-[color:var(--nexa-accent)]"
                        : isSelf
                          ? "text-white/95"
                          : "text-white/75"
                    }`}
                  >
                    {name}
                    {isSelf && (
                      <span className="ml-1.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-white/70">
                        you
                      </span>
                    )}
                  </span>
                  {!participant.micOn && (
                    <MicOff className="size-2.5 shrink-0 text-white/65" />
                  )}
                </span>
              );
            })}
            {extra > 0 && (
              <span className="shrink-0 font-mono text-[10px] tracking-[0.14em] text-white/65">
                +{extra}
              </span>
            )}
          </span>
        </button>
      ) : (
        <span className="flex-1" />
      )}

      {/* ------------------------------------------------------------ status */}
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={
              fullscreen
                ? "Exit fullscreen"
                : "Fullscreen the room — the controls stay on screen"
            }
            className="inline-flex items-center gap-1.5 border border-white/15 px-1.5 py-1 text-white/65 transition-colors hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
          >
            {fullscreen ? (
              <Minimize className="size-3.5" />
            ) : (
              <Maximize className="size-3.5" />
            )}
            <span className="nexa-label hidden lg:inline">
              {fullscreen ? "Exit" : "Fullscreen"}
            </span>
          </button>
        )}

        {e2ee !== null && (
          <span
            className="hidden items-center sm:inline-flex"
            title={
              e2ee === "on"
                ? "Media is end-to-end encrypted — only participants can decode it."
                : e2ee === "pending"
                  ? "Establishing end-to-end encryption…"
                  : e2ee === "off"
                    ? "Someone in this room can't encrypt — media isn't end-to-end encrypted with them."
                    : "This browser can't encrypt media end-to-end."
            }
          >
            {e2ee === "on" ? (
              <Lock className="size-3.5 text-[color:var(--nexa-accent)]" />
            ) : e2ee === "pending" ? (
              <Lock className="nexa-live size-3.5 text-white/70" />
            ) : (
              <LockOpen className="size-3.5 text-amber-500" />
            )}
          </span>
        )}

        <span
          className="hidden items-center sm:inline-flex"
          title={connected ? "Signalling connected" : COPY.connectionLost}
        >
          {connected ? (
            <Wifi className="size-3.5 text-white/65" />
          ) : (
            <WifiOff className="nexa-live size-3.5 text-amber-500" />
          )}
        </span>

        <span aria-hidden className="hidden h-4 w-px bg-white/10 sm:block" />

        <RoomClock joinedAt={joinedAt} />
      </div>
    </header>
  );
}
