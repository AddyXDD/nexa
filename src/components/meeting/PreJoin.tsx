import { api } from "@/convex/_generated/api";
import { MeetingTermsDialog } from "@/components/MeetingTermsDialog";
import type { LocalMedia } from "@/hooks/use-local-media";
import { useMediaDevices, deviceLabel } from "@/hooks/use-media-devices";
import { friendlyError } from "@/lib/errors";
import { playSpeakerTest, startLevelMeter } from "@/lib/media/audio";
import { MAX_DISPLAY_NAME_LENGTH } from "@/shared/constants";
import { useMutation } from "convex/react";
import {
  ArrowRight,
  Check,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MediaErrorRow } from "./SettingsPanel";

const LEVEL_SEGMENTS = 12;

/**
 * The lobby: the last honest look at yourself before the room does.
 *
 * It is laid out as an instrument panel rather than a form — the camera feed
 * fills the stage at whatever height the viewport allows (nothing below it is
 * allowed to push it off-screen), a vertical fader on the left edge is the
 * live mic level, and the pass on the right carries only what is decided once:
 * who you are, whether the hardware works, and the door.
 *
 * Nothing here requires an account. Taking a seat does gate on the
 * acceptable-use prompt, because it is the one door every joiner passes.
 */
export function PreJoin({
  media,
  mirrorSelfView,
  onToggleMirror,
  self,
  ready,
  code,
  onJoin,
  onOpenEffects,
}: {
  media: LocalMedia;
  mirrorSelfView: boolean;
  onToggleMirror: () => void;
  self: { nexaId: string | null; name: string | null };
  ready: boolean;
  code?: string;
  onJoin: () => void;
  onOpenEffects: () => void;
}) {
  const { inputs, cameras, outputs } = useMediaDevices();
  const previewRef = useRef<HTMLVideoElement>(null);
  const [rawLevel, setRawLevel] = useState(0);
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  /* ---------------- display name (no account needed) ---------------- */
  const setName = useMutation(api.identity.setDisplayName);
  const [nameDraft, setNameDraft] = useState(self.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Adopt the server value once the session loads; never clobber typing.
  // Adjusting during render (rather than in an effect) is the documented way
  // to reconcile state with a prop exactly once per change.
  const [syncedName, setSyncedName] = useState(self.name);
  if (self.name !== syncedName) {
    setSyncedName(self.name);
    if (self.name) setNameDraft(self.name);
  }

  const saveName = async () => {
    if (!ready || savingName) return;
    const trimmed = nameDraft.trim();
    if (trimmed === (self.name ?? "")) return;
    setSavingName(true);
    setNameError(null);
    try {
      await setName({ name: trimmed });
    } catch (err) {
      setNameError(friendlyError(err, "The name couldn't be saved."));
    } finally {
      setSavingName(false);
    }
  };

  // Taking a seat is gated on the acceptable-use prompt — this is the single
  // door every joiner passes through, whether they arrived from an invite
  // link, a pasted code, or a scheduled booking.
  const handleJoin = () => setTermsOpen(true);

  const joinNow = () => {
    setTermsOpen(false);
    // The seat is taken after the name lands, so the roster shows it from
    // the first moment instead of "Guest" until a later edit.
    void saveName().finally(() => onJoin());
  };

  const previewStream = media.previewStream;
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    element.srcObject = previewStream;
    if (previewStream) void element.play().catch(() => {});
    return () => {
      if (element.srcObject === previewStream) element.srcObject = null;
    };
  }, [previewStream]);

  const micSource = media.microphoneSource;
  // Only a real meter writes to this; with no microphone the reading is zero
  // rather than whatever the last device left behind.
  const level = micSource ? rawLevel : 0;
  useEffect(() => {
    if (!micSource) return;
    const meter = startLevelMeter(new MediaStream([micSource]), setRawLevel);
    if (!meter) return;
    return () => meter.stop();
  }, [micSource]);

  // Cheap enough to read per render, and it avoids a stale memo when the
  // track swaps resolution without changing identity.
  const resolution = (() => {
    const track = media.cameraSource;
    if (!track) return null;
    const settings = track.getSettings();
    if (!settings.width || !settings.height) return null;
    return `${settings.width} × ${settings.height}`;
  })();

  const testSpeaker = async () => {
    setSpeakerTesting(true);
    const test = await playSpeakerTest(media.prefs.speakerDeviceId);
    if (!test) setSpeakerTesting(false);
    else window.setTimeout(() => setSpeakerTesting(false), 1400);
  };

  const showVideo = media.camOn && previewStream !== null;
  const initials =
    (self.name ?? self.nexaId ?? "NX")
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "NX";
  const lit = Math.round(
    Math.min(1, Math.sqrt(Math.max(0, Math.min(1, level))) * 1.15) *
      LEVEL_SEGMENTS,
  );

  return (
    <div className="nexa-room-bg flex h-full min-h-0 flex-col overflow-hidden">
      {/* ---------- lobby bar ---------- */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[color:var(--nexa-accent)] font-mono text-[11px] font-semibold text-[color:var(--nexa-accent-ink)]">
            N
          </span>
          <span className="nexa-label truncate text-white/65">
            Nexa Meet
            <span className="mx-2 text-white/30">/</span>
            <span className="text-white/90">Lobby</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          {code && (
            <span className="nexa-label hidden items-center gap-1.5 text-white/60 sm:flex">
              Room
              <span className="font-mono text-[11px] tracking-[0.14em] text-white/90">
                {code}
              </span>
            </span>
          )}
          <span className="nexa-label flex items-center gap-2 text-white/55">
            <span className="size-1.5 rounded-full bg-[color:var(--nexa-accent)] nexa-live" />
            No account
          </span>
        </div>
      </div>

      {/* ---------- stage + pass ---------- */}
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_21.5rem] lg:overflow-hidden">
        {/* =============== stage =============== */}
        <div className="flex min-h-0 flex-col gap-3 p-3 sm:p-4">
          <div className="relative aspect-[4/3] shrink-0 overflow-hidden rounded-2xl bg-[#08090b] ring-1 ring-white/10 sm:aspect-video lg:aspect-auto lg:min-h-0 lg:flex-1">
            <video
              ref={previewRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover transition-opacity duration-300 ${
                mirrorSelfView ? "-scale-x-100" : ""
              } ${showVideo ? "opacity-100" : "opacity-0"}`}
            />

            {!showVideo && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <span className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-[clamp(4rem,16vw,11rem)] font-medium tracking-[0.12em] text-white/[0.045] select-none">
                  {self.nexaId ?? "NEXA"}
                </span>
                <span className="relative grid size-12 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-[13px] font-semibold tracking-wide text-white/85">
                  {initials}
                </span>
                <p className="relative flex items-center gap-1.5 text-[11px] text-white/65">
                  <VideoOff className="size-3.5" />
                  {media.cameraError ? "Camera unavailable" : "Camera is off"}
                </p>
              </div>
            )}

            {/* viewfinder ticks */}
            <span className="pointer-events-none absolute left-3 top-3 size-3 border-l border-t border-[color:var(--nexa-accent)]/45" />
            <span className="pointer-events-none absolute right-3 top-3 size-3 border-r border-t border-[color:var(--nexa-accent)]/45" />
            <span className="pointer-events-none absolute bottom-3 left-3 size-3 border-b border-l border-[color:var(--nexa-accent)]/45" />
            <span className="pointer-events-none absolute bottom-3 right-3 size-3 border-b border-r border-[color:var(--nexa-accent)]/45" />

            {/* status chips */}
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-white/70 uppercase ring-1 ring-white/10 backdrop-blur-md">
                <span className="size-1.5 rounded-full bg-[color:var(--nexa-accent)]" />
                Preview
              </span>
              <span className="flex flex-col items-end gap-1.5">
                {resolution && (
                  <span className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[9.5px] tracking-wide text-white/65 ring-1 ring-white/10 backdrop-blur-md">
                    {resolution}
                  </span>
                )}
                {media.sharing && (
                  <span className="rounded-md bg-[color:var(--nexa-accent)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--nexa-accent-ink)]">
                    Screen share queued
                  </span>
                )}
              </span>
            </div>

            {/* mic fader — the live level, as furniture rather than a bar */}
            <div
              className="pointer-events-none absolute left-4 top-1/2 hidden -translate-y-1/2 flex-col-reverse gap-[3px] sm:flex"
              role="meter"
              aria-label="Microphone input level"
              aria-valuenow={Math.round(level * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {Array.from({ length: LEVEL_SEGMENTS }, (_, index) => (
                <span
                  key={index}
                  className={`block w-[3px] rounded-full transition-colors duration-75 ${
                    index < lit
                      ? "bg-[color:var(--nexa-accent)]"
                      : "bg-white/15"
                  }`}
                  style={{ height: 6 }}
                />
              ))}
            </div>

            {/* slate */}
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-3.5 pb-3 pt-10 sm:px-4">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium leading-tight text-white sm:text-base">
                  {nameDraft.trim() || "Guest"}
                </p>
                <p className="mt-1 truncate font-mono text-[10px] tracking-[0.14em] text-white/60 uppercase">
                  {self.nexaId ?? "anonymous seat"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void media.toggleMic()}
                  aria-pressed={media.micOn}
                  title={media.micOn ? "Mute microphone" : "Unmute microphone"}
                  className={`grid size-9 place-items-center rounded-full ring-1 backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)] ${
                    media.micOn
                      ? "bg-white/10 text-white ring-white/15 hover:bg-white/20"
                      : "bg-[#B3261E] text-white ring-white/20 hover:bg-[#9C2019]"
                  }`}
                >
                  {media.micOn ? (
                    <Mic className="size-4" />
                  ) : (
                    <MicOff className="size-4" />
                  )}
                  <span className="sr-only">
                    {media.micOn ? "Mute microphone" : "Unmute microphone"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void media.toggleCam()}
                  aria-pressed={media.camOn}
                  title={media.camOn ? "Turn camera off" : "Turn camera on"}
                  className={`grid size-9 place-items-center rounded-full ring-1 backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)] ${
                    media.camOn
                      ? "bg-white/10 text-white ring-white/15 hover:bg-white/20"
                      : "bg-[#B3261E] text-white ring-white/20 hover:bg-[#9C2019]"
                  }`}
                >
                  {media.camOn ? (
                    <Video className="size-4" />
                  ) : (
                    <VideoOff className="size-4" />
                  )}
                  <span className="sr-only">
                    {media.camOn ? "Turn camera off" : "Turn camera on"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onOpenEffects}
                  title="Effects"
                  className="grid size-9 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/15 backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
                >
                  <Sparkles className="size-4" />
                  <span className="sr-only">Effects</span>
                </button>
              </div>
            </div>
          </div>

          {/* device rail under the stage */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="inline-flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 sm:flex-none">
              <Mic className="size-3.5 shrink-0 text-white/55" />
              <span className="sr-only">Microphone</span>
              <select
                aria-label="Microphone"
                value={media.prefs.audioDeviceId ?? ""}
                onChange={(event) =>
                  void media.selectMicrophone(event.target.value || null)
                }
                className="min-w-0 max-w-44 flex-1 bg-transparent text-[11.5px] text-white/75 outline-none"
              >
                <option value="" className="text-black">
                  System default
                </option>
                {inputs.map((device, index) => (
                  <option
                    key={device.deviceId || index}
                    value={device.deviceId}
                    className="text-black"
                  >
                    {deviceLabel(device, index)}
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 sm:flex-none">
              <Video className="size-3.5 shrink-0 text-white/55" />
              <span className="sr-only">Camera</span>
              <select
                aria-label="Camera"
                value={media.prefs.videoDeviceId ?? ""}
                onChange={(event) =>
                  void media.selectCamera(event.target.value || null)
                }
                className="min-w-0 max-w-44 flex-1 bg-transparent text-[11.5px] text-white/75 outline-none"
              >
                <option value="" className="text-black">
                  System default
                </option>
                {cameras.map((device, index) => (
                  <option
                    key={device.deviceId || index}
                    value={device.deviceId}
                    className="text-black"
                  >
                    {deviceLabel(device, index)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={onToggleMirror}
              aria-pressed={mirrorSelfView}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[11.5px] font-medium text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
            >
              <RotateCcw className="size-3.5" />
              {mirrorSelfView ? "Mirrored" : "Mirror"}
            </button>
          </div>

          {(media.cameraError || media.microphoneError) && (
            <div className="shrink-0 space-y-2">
              {media.cameraError && (
                <MediaErrorRow
                  message={media.cameraError}
                  onRetry={() => void media.retryDevice("camera")}
                />
              )}
              {media.microphoneError && (
                <MediaErrorRow
                  message={media.microphoneError}
                  onRetry={() => void media.retryDevice("microphone")}
                />
              )}
            </div>
          )}
        </div>

        {/* =============== pass =============== */}
        <div className="flex min-h-0 flex-col justify-center px-3 py-3 sm:px-4 lg:pl-0">
          <div className="nexa-chrome relative flex max-h-full min-h-0 flex-col overflow-y-auto rounded-2xl border border-black/10 bg-[color:var(--nexa-bone)] p-4 text-[color:var(--nexa-ink)] shadow-[0_30px_70px_-40px_rgba(0,0,0,0.95)]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="nexa-label text-[color:var(--nexa-accent)]">
                  Admit one
                </p>
                <h1 className="mt-2 text-[22px] leading-[1.1] font-medium tracking-tight">
                  Take your seat
                </h1>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  Nothing to install, nothing to sign up for. Set it here,
                  change it again from inside.
                </p>
              </div>
              <span className="mt-0.5 shrink-0 rounded-full border border-black/10 px-2 py-0.5 font-mono text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
                01 / 01
              </span>
            </div>

            {/* name — signed, not typed into a box */}
            <div className="mt-4">
              <label
                htmlFor="prejoin-display-name"
                className="nexa-label text-muted-foreground"
              >
                Sign as
              </label>
              <div className="mt-1 flex items-center gap-2 border-b border-black/20 pb-1 focus-within:border-[color:var(--nexa-accent)]">
                <input
                  id="prejoin-display-name"
                  type="text"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={() => void saveName()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveName();
                    }
                  }}
                  maxLength={MAX_DISPLAY_NAME_LENGTH}
                  placeholder="Guest"
                  autoComplete="name"
                  className="min-w-0 flex-1 bg-transparent text-[17px] font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
                />
                {savingName && (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                )}
              </div>
              {nameError ? (
                <p className="mt-1.5 text-[11px] text-red-600">{nameError}</p>
              ) : (
                <p className="mt-1.5 font-mono text-[9.5px] tracking-[0.12em] text-muted-foreground uppercase">
                  {self.nexaId ?? "Anonymous seat"} · no account needed
                </p>
              )}
            </div>

            {/* perforation */}
            <div className="relative my-3.5 -mx-4 flex items-center">
              <span className="size-3 shrink-0 -translate-x-1/2 rounded-full bg-[oklch(0.163_0.008_258)]" />
              <span className="h-px flex-1 border-t border-dashed border-black/20" />
              <span className="size-3 shrink-0 translate-x-1/2 rounded-full bg-[oklch(0.163_0.008_258)]" />
            </div>

            <div className="space-y-1.5">
              {/* microphone level */}
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[12px] font-medium">
                  <Mic className="size-3.5 text-muted-foreground" />
                  Microphone
                </span>
                <span className="flex items-center gap-1" aria-hidden>
                  {Array.from({ length: 8 }, (_, index) => (
                    <span
                      key={index}
                      className={`block h-3 w-[3px] rounded-full transition-colors duration-75 ${
                        !micSource
                          ? "bg-black/15"
                          : index < Math.ceil((lit / LEVEL_SEGMENTS) * 8)
                            ? "bg-[color:var(--nexa-accent)]"
                            : "bg-black/15"
                      }`}
                    />
                  ))}
                </span>
              </div>
              <p className="pl-5 text-[10.5px] leading-relaxed text-muted-foreground">
                {!micSource
                  ? (media.microphoneError ?? "Microphone is off.")
                  : lit > 0
                    ? "Level looks good."
                    : "Say a few words — the bars should move."}
              </p>

              {/* speaker */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="flex items-center gap-2 text-[12px] font-medium">
                  <Volume2 className="size-3.5 text-muted-foreground" />
                  Speaker
                </span>
                <button
                  type="button"
                  onClick={() => void testSpeaker()}
                  disabled={speakerTesting}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-black/15 bg-white/40 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-white/70 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-accent)]"
                >
                  {speakerTesting ? (
                    <>
                      <Check className="size-3 text-[color:var(--nexa-accent)]" />{" "}
                      Ringing
                    </>
                  ) : (
                    "Test"
                  )}
                </button>
              </div>
              {outputs.length > 0 && (
                <label className="flex h-7 items-center gap-2 rounded-md border border-black/10 bg-white/30 px-2">
                  <span className="sr-only">Speaker output</span>
                  <select
                    aria-label="Speaker output"
                    value={media.prefs.speakerDeviceId ?? ""}
                    onChange={(event) =>
                      media.setSpeaker(event.target.value || null)
                    }
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none"
                  >
                    <option value="" className="text-black">
                      System default
                    </option>
                    {outputs.map((device, index) => (
                      <option
                        key={device.deviceId || index}
                        value={device.deviceId}
                        className="text-black"
                      >
                        {deviceLabel(device, index)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* noise */}
              <div className="flex items-center justify-between gap-2 pt-1.5">
                <span className="text-[12px] font-medium">Noise</span>
                <div className="inline-flex rounded-md border border-black/10 bg-white/30 p-0.5">
                  {(
                    [
                      ["off", "Off"],
                      ["standard", "Std"],
                      ["strong", "Strong"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => void media.setNoiseLevel(value)}
                      aria-pressed={media.prefs.noiseLevel === value}
                      title={
                        value === "strong"
                          ? "Strong adds a native low-cut filter — no cloud processing"
                          : undefined
                      }
                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)] ${
                        media.prefs.noiseLevel === value
                          ? "bg-[color:var(--nexa-ink)] text-[color:var(--nexa-bone)]"
                          : "text-[color:var(--nexa-ink)]/50 hover:text-[color:var(--nexa-ink)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ticket stub — the fine print, ruled like a receipt */}
            <dl className="mt-4 space-y-1.5 border-t border-dashed border-black/15 pt-3 font-mono text-[9.5px] tracking-[0.1em] uppercase">
              {[
                ["Room", code ?? "—"],
                ["Preview", "this device only"],
                ["Recording", "never"],
              ].map(([term, value]) => (
                <div key={term} className="flex items-baseline gap-2">
                  <dt className="shrink-0 text-muted-foreground">{term}</dt>
                  <span className="min-w-0 flex-1 border-b border-dotted border-black/20" />
                  <dd className="shrink-0 text-foreground/80">{value}</dd>
                </div>
              ))}
            </dl>

            {/* door */}
            <div className="pt-3">
              <button
                type="button"
                onClick={handleJoin}
                disabled={!ready}
                className="group inline-flex h-11 w-full items-center justify-between gap-2 rounded-xl bg-[color:var(--nexa-signal)] pl-4 pr-1.5 text-[13px] font-semibold text-[color:var(--nexa-accent-ink)] transition-all hover:brightness-[1.03] active:scale-[0.995] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nexa-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--nexa-bone)]"
              >
                <span className="inline-flex items-center gap-2">
                  {!ready && <Loader2 className="size-4 animate-spin" />}
                  {ready ? "Enter the room" : "Preparing your seat…"}
                </span>
                <span className="grid size-8 place-items-center rounded-lg bg-black/15 transition-transform group-hover:translate-x-0.5">
                  <ArrowRight className="size-4" />
                </span>
              </button>
              <p className="mt-2 text-center font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                {ready
                  ? "All set — the room is waiting"
                  : "Setting up your seat…"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <MeetingTermsDialog
        open={termsOpen}
        action="join"
        onOpenChange={setTermsOpen}
        onAgree={joinNow}
      />
    </div>
  );
}
