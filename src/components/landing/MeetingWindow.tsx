import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ShieldCheck,
  SmilePlus,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { useEffect, useState } from "react";

type Quality = "auto" | "1080p" | "720p" | "480p";

const PARTICIPANTS = [
  { id: "NX-7F42K9", name: "Priya", host: true, mic: true },
  { id: "NX-3B8TQM", name: null, host: false, mic: false },
  { id: "NX-K5WD2R", name: "Marco", host: false, mic: true },
  { id: "NX-9QX4TR", name: "You", host: false, mic: true, self: true },
];

/**
 * The interactive Nexa meeting window — the landing's product centerpiece.
 *
 * It behaves like the real room: mic/camera/share/people/chat controls all
 * work, the timer ticks, the speaking hairline drifts between participants,
 * connection bars fluctuate, and in `lab` mode the demo bench adds blur,
 * quality and poor-network simulation so visitors can watch the UI adapt.
 *
 * Everything is simulated locally — no camera or network access, labelled as
 * a demo where it matters. Decorative layers are aria-hidden; controls are
 * real buttons with labels.
 */
export function MeetingWindow({ lab = false }: { lab?: boolean }) {
  const reduceMotion = useReducedMotion();

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [panel, setPanel] = useState<"people" | "chat" | null>("people");
  const [blurOn, setBlurOn] = useState(false);
  const [quality, setQuality] = useState<Quality>("auto");
  const [poor, setPoor] = useState(false);
  const [level, setLevel] = useState(4); // 4 good … 1 poor
  const [speaking, setSpeaking] = useState(0);
  const [seconds, setSeconds] = useState(432); // 07:12

  // clock
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // connection fluctuation (hero) — skipped in lab mode and for reduced motion
  useEffect(() => {
    if (lab || reduceMotion) return;
    const id = window.setInterval(
      () => setLevel((current) => (current === 4 ? 3 : 4)),
      4500,
    );
    return () => window.clearInterval(id);
  }, [lab, reduceMotion]);

  // speaking drifts between participants (audio-driven in the real room)
  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(
      () => setSpeaking((current) => (current + 1) % 4),
      3200,
    );
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  const effectiveLevel = lab && poor ? 1 : level;
  const effectiveQuality: Quality =
    quality !== "auto"
      ? quality
      : effectiveLevel <= 2
        ? "480p"
        : effectiveLevel === 3
          ? "720p"
          : "1080p";
  const adapting = effectiveLevel <= 2 || (lab && poor);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  const qualityBlur =
    effectiveQuality === "480p"
      ? "blur(1.4px) saturate(0.85)"
      : effectiveQuality === "720p"
        ? "blur(0.5px)"
        : "none";

  const togglePanel = (next: "people" | "chat") =>
    setPanel((current) => (current === next ? null : next));

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0e0e10]">
        {/* ------------------------------------------------- window chrome */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-[#131316] px-3.5 py-2.5 sm:px-4">
          <span className="hidden items-center gap-2 font-mono text-[11px] tracking-wide text-white/45 sm:flex">
            <span className="size-1.5 rounded-full bg-[color:var(--nexa-accent)]" />
            nexa.app/m/7K2M-9QX4-TRBD-1HYN
          </span>
          <span className="ml-auto flex items-center gap-2 sm:gap-2.5">
            <span className="tabular-nums font-mono text-[11px] text-white/70">
              {mm}:{ss}
            </span>
            <span className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
              <ShieldCheck className="size-3 text-[color:var(--nexa-accent)]" />
              Ephemeral
            </span>
            <ConnectionBars level={effectiveLevel} />
            <span className="hidden rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] text-white/55 sm:inline">
              {PARTICIPANTS.length} here
            </span>
          </span>
        </div>

        {/* ------------------------------------------------------- room body */}
        <div className="flex min-h-[300px] sm:min-h-[340px]">
          {/* stage / grid */}
          <div className="relative flex-1 p-2.5 sm:p-3">
            {sharing ? (
              <div className="flex h-full flex-col gap-2.5">
                {/* shared content takes the stage */}
                <div className="relative flex-1 overflow-hidden rounded-lg border border-white/10 bg-[#16161a]">
                  <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 font-mono text-[10px] text-white/75 backdrop-blur-sm">
                    <MonitorUp className="size-3 text-[color:var(--nexa-accent)]" />
                    Marco is presenting
                  </div>
                  <div className="flex h-full items-center justify-center p-6">
                    <div className="w-full max-w-md space-y-2.5">
                      <div className="h-2.5 w-2/5 rounded-full bg-white/25" />
                      <div className="h-1.5 w-full rounded-full bg-white/10" />
                      <div className="h-1.5 w-4/5 rounded-full bg-white/10" />
                      <div className="flex items-end gap-1.5 pt-3">
                        {[38, 55, 44, 72, 61, 84].map((h, i) => (
                          <span
                            key={i}
                            className="w-6 rounded-sm bg-[color:var(--nexa-accent)]/50"
                            style={{ height: `${h}px` }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 nexa-grain"
                  />
                </div>
                {/* compact strip */}
                <div className="grid grid-cols-3 gap-2.5">
                  <MiniTile label="You" muted={!camOn} mirrored />
                  <MiniTile label="Priya" />
                  <MiniTile label="NX-3B8TQM" muted />
                </div>
              </div>
            ) : (
              <div className="grid h-full grid-cols-2 gap-2.5">
                {/* Priya — feed, sometimes speaking */}
                <Tile
                  speaking={speaking === 0 && !reduceMotion}
                  label="Priya"
                  micOn
                >
                  <Feed tone="warm" blur={qualityBlur} />
                </Tile>

                {/* anonymous participant — camera off */}
                <Tile
                  speaking={speaking === 1 && !reduceMotion}
                  label="NX-3B8TQM"
                  micOn={false}
                >
                  <div className="flex items-center justify-center">
                    <span className="flex size-12 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] font-mono text-sm text-white/55 sm:size-14">
                      3B8
                    </span>
                  </div>
                </Tile>

                {/* Marco — feed */}
                <Tile
                  speaking={speaking === 2 && !reduceMotion}
                  label="Marco"
                  micOn
                >
                  <Feed tone="cool" blur={qualityBlur} />
                </Tile>

                {/* self view */}
                <Tile
                  speaking={speaking === 3 && !reduceMotion}
                  label="You"
                  micOn={micOn}
                >
                  {camOn ? (
                    <>
                      <div
                        className="absolute inset-0 -scale-x-100"
                        aria-hidden="true"
                      >
                        <Feed
                          tone="self"
                          blur={blurOn ? "blur(6px)" : qualityBlur}
                        />
                      </div>
                      {blurOn ? (
                        <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-white/15 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/80">
                          Background blurred
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="font-mono text-sm tracking-[0.18em] text-white/55">
                      NX-9QX4TR
                    </span>
                  )}
                </Tile>
              </div>
            )}

            {/* quality chip */}
            <span className="absolute left-5 top-5 z-10 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/55 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/65 backdrop-blur-sm sm:left-6 sm:top-6">
              <span
                className={`size-1.5 rounded-full ${
                  adapting
                    ? "bg-amber-400"
                    : "bg-[color:var(--nexa-accent)]"
                }`}
              />
              {adapting ? `Adapting · ${effectiveQuality}` : effectiveQuality}
            </span>

            {/* chat overlay */}
            <AnimatePresence>
              {panel === "chat" && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute bottom-4 right-4 z-20 w-56 rounded-lg border border-white/10 bg-[#131316] p-3"
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
                    Chat · nothing is kept
                  </p>
                  <div className="mt-2.5 space-y-2">
                    <p className="text-xs leading-relaxed text-white/75">
                      <span className="font-mono text-white/45">NX-3B8TQM </span>
                      link works on my end
                    </p>
                    <p className="text-xs leading-relaxed text-white/75">
                      <span className="font-mono text-white/45">NX-7F42K9 </span>
                      same, starting in a minute
                    </p>
                  </div>
                  <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-xs text-white/35">
                    Message the room…
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* participants rail */}
          <AnimatePresence initial={false}>
            {panel === "people" && (
              <motion.aside
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 186, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="hidden shrink-0 overflow-hidden border-l border-white/10 bg-[#101012] md:block"
              >
                <div className="h-full w-[186px] p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
                    Participants · {PARTICIPANTS.length}
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {PARTICIPANTS.map((person) => (
                      <li
                        key={person.id}
                        className="flex items-center gap-2.5 rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-2"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] font-mono text-[9px] text-white/60">
                          {person.name
                            ? person.name.slice(0, 2).toUpperCase()
                            : person.id.slice(3, 6)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[11px] text-white/75">
                            {person.self ? "You" : person.id}
                          </span>
                          <span className="block truncate text-[10px] text-white/40">
                            {person.name ?? "No display name"}
                          </span>
                        </span>
                        {person.host ? (
                          <span className="rounded border border-[color:var(--nexa-accent)]/40 px-1 font-mono text-[8px] uppercase tracking-wider text-[color:var(--nexa-accent)]">
                            Host
                          </span>
                        ) : (
                          <span
                            className={
                              person.mic && !person.self
                                ? "text-white/45"
                                : "text-[color:var(--destructive)]"
                            }
                          >
                            {person.mic && !person.self ? (
                              <Mic className="size-3" />
                            ) : (
                              <MicOff className="size-3" />
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>

        {/* --------------------------------------------------- control slab */}
        <div className="flex items-center justify-center gap-1.5 border-t border-white/10 bg-[#131316] px-3 py-2.5">
          <ControlButton
            label={micOn ? "Mute microphone" : "Unmute microphone"}
            active={!micOn}
            danger={!micOn}
            onClick={() => setMicOn((on) => !on)}
          >
            {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          </ControlButton>
          <ControlButton
            label={camOn ? "Turn camera off" : "Turn camera on"}
            active={!camOn}
            danger={!camOn}
            onClick={() => setCamOn((on) => !on)}
          >
            {camOn ? <Video className="size-4" /> : <VideoOff className="size-4" />}
          </ControlButton>
          <ControlButton
            label={sharing ? "Stop sharing" : "Share screen"}
            active={sharing}
            onClick={() => setSharing((on) => !on)}
          >
            <MonitorUp className="size-4" />
          </ControlButton>
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/55"
          >
            <SmilePlus className="size-4" />
          </span>
          <span className="mx-1 h-5 w-px bg-white/10" />
          <ControlButton
            label="Toggle participants"
            active={panel === "people"}
            onClick={() => togglePanel("people")}
          >
            <Users className="size-4" />
          </ControlButton>
          <ControlButton
            label="Toggle chat"
            active={panel === "chat"}
            onClick={() => togglePanel("chat")}
          >
            <MessageSquare className="size-4" />
          </ControlButton>
          <span className="mx-1 h-5 w-px bg-white/10" />
          <ControlButton label="Leave meeting (demo)" danger onClick={() => undefined}>
            <PhoneOff className="size-4" />
          </ControlButton>
        </div>
      </div>

      {/* ------------------------------------------------------- demo bench */}
      {lab && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <Toggle
              label="Background blur"
              checked={blurOn}
              onChange={setBlurOn}
              disabled={!camOn}
            />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Quality
              </p>
              <div className="mt-1.5 inline-flex rounded-lg border border-border bg-muted p-1">
                {(["auto", "1080p", "720p", "480p"] as Quality[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setQuality(option)}
                    aria-pressed={quality === option}
                    className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
                      quality === option
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option === "auto" ? "AUTO" : option.replace("p", "P")}
                  </button>
                ))}
              </div>
            </div>
            <Toggle
              label="Simulate poor network"
              checked={poor}
              onChange={(next) => {
                setPoor(next);
                if (next) setQuality("auto");
              }}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Everything here runs locally: a simulation of the real room, with
            no camera or network access.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function ControlButton({
  label,
  active = false,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-9 items-center justify-center rounded-lg border transition-all active:scale-95 ${
        active && danger
          ? "border-[color:var(--destructive)]/50 bg-[color:var(--destructive)]/15 text-[color:var(--destructive)]"
          : danger && !active
            ? "border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 text-[color:var(--destructive)] hover:bg-[color:var(--destructive)]/20"
            : active
              ? "border-[color:var(--nexa-accent)]/60 bg-[color:var(--nexa-accent)]/10 text-[color:var(--nexa-accent)]"
              : "border-white/10 bg-white/[0.03] text-white/65 hover:border-white/20 hover:bg-white/[0.06] hover:text-white/90"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-3 text-left disabled:opacity-40"
    >
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked
            ? "bg-[color:var(--nexa-accent)]"
            : "bg-muted group-hover:bg-muted-foreground/40"
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
      <span className="text-sm text-foreground">{label}</span>
    </button>
  );
}

function ConnectionBars({ level }: { level: number }) {
  const tone =
    level >= 3
      ? "bg-[color:var(--nexa-accent)]"
      : level === 2
        ? "bg-amber-400"
        : "bg-[color:var(--destructive)]";
  return (
    <span
      className="flex items-end gap-[2px] rounded-md border border-white/10 px-2 py-1.5"
      title={level >= 3 ? "Good connection" : "Poor connection, adapting"}
      aria-label={level >= 3 ? "Good connection" : "Poor connection"}
    >
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={`w-[3px] rounded-sm transition-all duration-500 ${
            bar <= level ? tone : "bg-white/15"
          }`}
          style={{ height: `${4 + bar * 2.5}px` }}
        />
      ))}
      <span className="ml-1.5 font-mono text-[10px] text-white/55">
        {level >= 3 ? "Good" : level === 2 ? "Fair" : "Poor"}
      </span>
    </span>
  );
}

function Tile({
  children,
  label,
  micOn,
  speaking = false,
}: {
  children: React.ReactNode;
  label: string;
  micOn: boolean;
  speaking?: boolean;
}) {
  return (
    <div
      className={`relative flex min-h-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#16161a] transition-shadow duration-700 ${
        speaking ? "nexa-pulse" : ""
      }`}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        aria-hidden="true"
      >
        {children}
      </div>
      <span className="absolute bottom-2 left-2.5 z-10 flex items-center gap-1.5 text-[11px] text-white/80">
        {micOn ? null : <MicOff className="size-3 text-[color:var(--destructive)]" />}
        {label}
      </span>
      {micOn && speaking ? (
        <span
          aria-hidden="true"
          className="nexa-wave absolute bottom-2.5 right-2.5 z-10 flex h-3 items-end gap-[2px]"
        >
          <span style={{ animationDelay: "0ms" }} />
          <span style={{ animationDelay: "140ms" }} />
          <span style={{ animationDelay: "280ms" }} />
        </span>
      ) : null}
    </div>
  );
}

function MiniTile({
  label,
  muted = false,
  mirrored = false,
}: {
  label: string;
  muted?: boolean;
  mirrored?: boolean;
}) {
  return (
    <div className="relative flex h-16 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-[#16161a]">
      {muted ? (
        <span className="font-mono text-[10px] tracking-[0.16em] text-white/50">
          {label === "You" ? "NX-9QX4TR" : label}
        </span>
      ) : (
        <div
          className={`absolute inset-0 ${mirrored ? "-scale-x-100" : ""}`}
          aria-hidden="true"
        >
          <Feed tone={label === "Priya" ? "warm" : "cool"} blur="none" />
        </div>
      )}
      <span className="absolute bottom-1 left-2 z-10 text-[9px] text-white/70">
        {label}
      </span>
      {muted ? (
        <MicOff className="absolute bottom-1 right-2 z-10 size-3 text-[color:var(--destructive)]" />
      ) : null}
    </div>
  );
}

/**
 * A simulated camera feed: a dim, slowly shifting light field with a soft
 * out-of-focus figure and film grain. Reads as "live video" at tile scale
 * without stock photography or fake faces.
 */
function Feed({ tone, blur }: { tone: "warm" | "cool" | "self"; blur: string }) {
  const field =
    tone === "warm"
      ? "radial-gradient(140% 120% at 28% 18%, oklch(0.32 0.035 70 / 0.9), transparent 62%)"
      : tone === "cool"
        ? "radial-gradient(140% 120% at 68% 22%, oklch(0.3 0.03 230 / 0.85), transparent 64%)"
        : "radial-gradient(140% 120% at 50% 20%, oklch(0.33 0.03 150 / 0.8), transparent 60%)";
  return (
    <div
      className="absolute inset-0 overflow-hidden bg-[#141519] transition-[filter] duration-700"
      style={{ filter: blur }}
      aria-hidden="true"
    >
      <div
        className="nexa-drift-c absolute inset-0"
        style={{ background: field }}
      />
      {/* soft figure */}
      <div className="absolute left-1/2 top-[24%] size-[24%] -translate-x-1/2 rounded-full bg-white/10 blur-[6px]" />
      <div className="absolute bottom-[-20%] left-1/2 h-[54%] w-[56%] -translate-x-1/2 rounded-t-full bg-white/[0.07] blur-[10px]" />
      {/* vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 42%, transparent 52%, rgb(0 0 0 / 0.5))",
        }}
      />
      <div className="nexa-grain absolute inset-0" />
    </div>
  );
}
