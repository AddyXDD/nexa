import { api } from "@/convex/_generated/api";
import { useMediaDevices, deviceLabel } from "@/hooks/use-media-devices";
import type { LocalMedia } from "@/hooks/use-local-media";
import { SHORTCUTS } from "@/hooks/use-shortcuts";
import type { UiPrefs } from "@/hooks/use-ui-prefs";
import { friendlyError } from "@/lib/errors";
import { playSpeakerTest, startLevelMeter } from "@/lib/media/audio";
import { MAX_DISPLAY_NAME_LENGTH, SUPPORT_EMAIL } from "@/shared/constants";
import { useMutation } from "convex/react";
import { motion } from "framer-motion";
import {
  Copy,
  Loader2,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";

/**
 * Meeting settings: a slide-in drawer with five focused sections. Every
 * control here changes something real — there are no decorative toggles.
 * Escape (handled by the room) closes it; the close button does too.
 */

export type SettingsSection =
  | "audio"
  | "video"
  | "appearance"
  | "accessibility"
  | "privacy";

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "audio", label: "Audio" },
  { id: "video", label: "Video" },
  { id: "appearance", label: "Appearance" },
  { id: "accessibility", label: "Access" },
  { id: "privacy", label: "Privacy" },
];

export function SettingsPanel({
  initialSection,
  onClose,
  media,
  ui,
  self,
  motionDuration,
}: {
  initialSection: SettingsSection;
  onClose: () => void;
  media: LocalMedia;
  ui: { prefs: UiPrefs; setPrefs: (patch: Partial<UiPrefs>) => void };
  self: { nexaId: string | null; name: string | null };
  motionDuration: number;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);

  return (
    <motion.aside
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 32, opacity: 0 }}
      transition={{ duration: motionDuration, ease: "easeOut" }}
      className="nexa-chrome absolute inset-y-0 right-0 z-30 flex w-full flex-col overflow-hidden border-l border-[color:var(--nexa-ink)]/15 bg-[color:var(--nexa-bone)] text-[color:var(--nexa-ink)] shadow-[-24px_0_60px_-40px_rgba(0,0,0,0.85)] sm:w-[23rem]"
      aria-label="Meeting settings"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[color:var(--nexa-ink)]/12 px-3">
        <span className="nexa-label text-[color:var(--nexa-ink)]/40">
          Settings
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="ml-auto inline-flex size-8 items-center justify-center text-[color:var(--nexa-ink)]/35 transition-colors hover:bg-black/[0.06] hover:text-[color:var(--nexa-ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)]"
        >
          <X className="size-4" />
        </button>
      </div>

      <nav
        aria-label="Settings sections"
        className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-[color:var(--nexa-ink)]/10 px-2"
      >
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setSection(entry.id)}
            aria-current={section === entry.id}
            className={`relative inline-flex shrink-0 items-center px-2 py-3 font-mono text-[9.5px] uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)] ${
              section === entry.id
                ? "text-[color:var(--nexa-ink)]"
                : "text-[color:var(--nexa-ink)]/35 hover:text-[color:var(--nexa-ink)]/70"
            }`}
          >
            {entry.label}
            {section === entry.id && (
              <span className="absolute inset-x-1 bottom-0 h-[2px] bg-[color:var(--nexa-ink)]" />
            )}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {section === "audio" && <AudioSection media={media} />}
        {section === "video" && (
          <VideoSection media={media} ui={ui} />
        )}
        {section === "appearance" && <AppearanceSection ui={ui} />}
        {section === "accessibility" && <AccessibilitySection />}
        {section === "privacy" && <PrivacySection self={self} />}
      </div>
    </motion.aside>
  );
}

/* ------------------------------------------------------------------ *
 * Shared rows
 * ------------------------------------------------------------------ */

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {children}
      </div>
      {hint && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 max-w-[14rem] rounded-[3px] border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Pills<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-[3px] border border-border bg-muted p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-[2px] px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Audio
 * ------------------------------------------------------------------ */

function AudioSection({ media }: { media: LocalMedia }) {
  const { inputs, outputs } = useMediaDevices();
  const [rawLevel, setRawLevel] = useState(0);
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const [speakerError, setSpeakerError] = useState<string | null>(null);

  // Level meter runs only while this section is visible and the mic is live.
  // With no microphone the reading is zero rather than whatever the last
  // device left behind — derived, not reset from inside the effect.
  const micSource = media.microphoneSource;
  const level = micSource ? rawLevel : 0;
  useEffect(() => {
    if (!micSource) return;
    const meter = startLevelMeter(new MediaStream([micSource]), setRawLevel);
    if (!meter) return;
    return () => meter.stop();
  }, [micSource]);

  const testSpeaker = async () => {
    setSpeakerError(null);
    setSpeakerTesting(true);
    const test = await playSpeakerTest(media.prefs.speakerDeviceId);
    if (!test) {
      setSpeakerError("The test sound couldn't play in this browser.");
    }
    window.setTimeout(() => setSpeakerTesting(false), 1400);
  };

  const selectedMic =
    inputs.find((device) => device.deviceId === media.prefs.audioDeviceId) ??
    inputs[0];

  return (
    <div className="divide-y divide-border">
      <div className="pb-3">
        <p className="text-sm font-medium">Microphone</p>
        <div className="mt-2 space-y-2">
          <Select
            ariaLabel="Microphone"
            value={media.prefs.audioDeviceId ?? ""}
            onChange={(value) => void media.selectMicrophone(value || null)}
            options={[
              { value: "", label: "System default" },
              ...inputs.map((device, index) => ({
                value: device.deviceId,
                label: deviceLabel(device, index),
              })),
            ]}
          />
          {/* Live input meter */}
          <div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-label="Microphone input level"
              aria-valuenow={Math.round(level * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-[color:var(--nexa-accent)] transition-[width] duration-75"
                style={{ width: `${Math.min(100, level * 100).toFixed(0)}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {!micSource
                ? "Turn the microphone on to run the test."
                : level > 0.04
                  ? "Speak normally — the level should bounce as you talk."
                  : "Listening… say something to check the input."}
            </p>
            {selectedMic?.label && (
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {selectedMic.label}
              </p>
            )}
          </div>
        </div>
      </div>

      <Row
        label="Noise reduction"
        hint={
          media.prefs.noiseLevel === "off"
            ? "Raw input — nothing is filtered."
            : media.prefs.noiseLevel === "standard"
              ? "Your browser's built-in noise suppression (keyboards, fans, hum)."
              : "Standard suppression plus a native low-cut filter and gentle compressor."
        }
      >
        <Pills
          ariaLabel="Noise reduction"
          value={media.prefs.noiseLevel}
          onChange={(value) => void media.setNoiseLevel(value)}
          options={[
            { value: "off", label: "Off" },
            { value: "standard", label: "Standard" },
            { value: "strong", label: "Strong" },
          ]}
        />
      </Row>

      <div className="py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Speaker</span>
          <button
            type="button"
            onClick={() => void testSpeaker()}
            disabled={speakerTesting}
            className="inline-flex h-8 items-center gap-1.5 rounded-[3px] border border-border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {speakerTesting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Volume2 className="size-3.5" />
            )}
            {speakerTesting ? "Playing…" : "Test speaker"}
          </button>
        </div>
        {outputs.length > 0 && (
          <div className="mt-2">
            <Select
              ariaLabel="Speaker output"
              value={media.prefs.speakerDeviceId ?? ""}
              onChange={(value) => media.setSpeaker(value || null)}
              options={[
                { value: "", label: "System default" },
                ...outputs.map((device, index) => ({
                  value: device.deviceId,
                  label: deviceLabel(device, index),
                })),
              ]}
            />
          </div>
        )}
        {outputs.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            This browser doesn&apos;t expose output selection — the test uses
            your system default.
          </p>
        )}
        {speakerError && (
          <p className="mt-1 text-xs text-red-500">{speakerError}</p>
        )}
      </div>

      {(media.microphoneError || media.cameraError) && (
        <div className="space-y-2 py-3">
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
  );
}

export function MediaErrorRow({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-[3px] border border-red-500/40 bg-red-500/10 px-3 py-2">
      <p className="text-xs leading-relaxed text-red-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1.5 text-xs font-medium text-red-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        Try again
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Video
 * ------------------------------------------------------------------ */

function VideoSection({
  media,
  ui,
}: {
  media: LocalMedia;
  ui: { prefs: UiPrefs; setPrefs: (patch: Partial<UiPrefs>) => void };
}) {
  const { cameras } = useMediaDevices();
  const [quality, setQuality] = useState("720");

  const applyQuality = async (value: string) => {
    setQuality(value);
    const track = media.cameraSource;
    if (!track) return;
    const dims: Record<string, { width: number; height: number }> = {
      "1080": { width: 1920, height: 1080 },
      "720": { width: 1280, height: 720 },
      "480": { width: 854, height: 480 },
    };
    const target = dims[value];
    if (!target) return;
    try {
      await track.applyConstraints({
        width: { ideal: target.width },
        height: { ideal: target.height },
      });
    } catch {
      /* device doesn't offer that exact step — it stays at its native mode */
    }
  };

  return (
    <div className="divide-y divide-border">
      <div className="py-3">
        <p className="text-sm font-medium">Camera</p>
        <div className="mt-2">
          <Select
            ariaLabel="Camera"
            value={media.prefs.videoDeviceId ?? ""}
            onChange={(value) => void media.selectCamera(value || null)}
            options={[
              { value: "", label: "System default" },
              ...cameras.map((device, index) => ({
                value: device.deviceId,
                label: deviceLabel(device, index),
              })),
            ]}
          />
        </div>
      </div>

      <Row
        label="Quality"
        hint="Preferences are sent to the camera; the network still adapts to conditions."
      >
        <Pills
          ariaLabel="Camera quality"
          value={quality}
          onChange={(value) => void applyQuality(value)}
          options={[
            { value: "480", label: "480p" },
            { value: "720", label: "720p" },
            { value: "1080", label: "1080p" },
          ]}
        />
      </Row>

      <Row
        label="Mirror self-view"
        hint="Display only — people on the other side see you the right way round."
      >
        <input
          type="checkbox"
          role="switch"
          aria-label="Mirror self-view"
          checked={ui.prefs.mirrorSelfView}
          onChange={(event) =>
            ui.setPrefs({ mirrorSelfView: event.target.checked })
          }
          className="size-4 accent-[color:var(--nexa-accent)]"
        />
      </Row>

      <div className="py-3 text-xs leading-relaxed text-muted-foreground">
        Effects (blur, backgrounds, adjustments) live in the effects panel —
        open it from the camera menu or press{" "}
        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
          E
        </kbd>
        .
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Appearance
 * ------------------------------------------------------------------ */

function AppearanceSection({
  ui,
}: {
  ui: { prefs: UiPrefs; setPrefs: (patch: Partial<UiPrefs>) => void };
}) {
  return (
    <div className="divide-y divide-border">
      <Row
        label="Theme"
        hint="Meeting rooms stay dark — video reads best on dark. This sets the rest of the app."
      >
        <Pills
          ariaLabel="Theme"
          value={ui.prefs.theme}
          onChange={(value) => ui.setPrefs({ theme: value })}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "system", label: "System" },
          ]}
        />
      </Row>
      <Row
        label="Animations"
        hint="Reduced keeps every function and drops the movement."
      >
        <Pills
          ariaLabel="Animations"
          value={ui.prefs.motion}
          onChange={(value) => ui.setPrefs({ motion: value })}
          options={[
            { value: "system", label: "System" },
            { value: "reduced", label: "Reduced" },
          ]}
        />
      </Row>
      <Row
        label="Speaker activity ring"
        hint="Thin outline on whoever is actually talking."
      >
        <input
          type="checkbox"
          role="switch"
          aria-label="Speaker activity ring"
          checked={ui.prefs.speakerActivity}
          onChange={(event) =>
            ui.setPrefs({ speakerActivity: event.target.checked })
          }
          className="size-4 accent-[color:var(--nexa-accent)]"
        />
      </Row>
      <Row
        label="Picture-in-picture on tab switch"
        hint="Attempts to keep the video visible when you leave the tab (browser permitting)."
      >
        <input
          type="checkbox"
          role="switch"
          aria-label="Picture-in-picture on tab switch"
          checked={ui.prefs.pipOnHide}
          onChange={(event) =>
            ui.setPrefs({ pipOnHide: event.target.checked })
          }
          className="size-4 accent-[color:var(--nexa-accent)]"
        />
      </Row>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Accessibility
 * ------------------------------------------------------------------ */

function AccessibilitySection() {
  return (
    <div>
      <p className="text-sm font-medium">Keyboard shortcuts</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Shortcuts pause while you&apos;re typing in a text field.
      </p>
      <dl className="mt-3 space-y-1.5">
        {SHORTCUTS.map((shortcut) => (
          <div
            key={shortcut.keys}
            className="flex items-center justify-between gap-3 rounded-[3px] border border-border bg-card px-3 py-2"
          >
            <dt className="text-xs text-muted-foreground">{shortcut.action}</dt>
            <dd>
              <kbd className="min-w-8 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[11px] font-medium">
                {shortcut.keys}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 rounded-[3px] border border-border bg-card px-3 py-3">
        <p className="text-xs font-medium">Live captions</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Not available in this build. Nexa bundles no speech-recognition
          service, and nothing transcribes, stores, or sends what anyone says.
          When captions arrive they will run on-device and be off by default.
        </p>
      </div>

      <div className="mt-4 rounded-[3px] border border-border bg-card px-3 py-3">
        <p className="text-xs font-medium">Reduced motion</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Your system preference is respected automatically; you can also
          force it under Appearance.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Privacy
 * ------------------------------------------------------------------ */

function PrivacySection({
  self,
}: {
  self: { nexaId: string | null; name: string | null };
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  // Inline rename — works for guest (anonymous) sessions too, so nobody is
  // sent to the dashboard or asked to make an account mid-meeting.
  const setName = useMutation(api.identity.setDisplayName);
  const [nameDraft, setNameDraft] = useState(self.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Reconcile against the server's name during render (the pattern React
  // recommends over writing state from an effect): a name that lands later
  // — or changes on another device — updates the field without cascading
  // renders, and typing is never overwritten while the name is unchanged.
  const [seenName, setSeenName] = useState(self.name ?? null);
  if ((self.name ?? null) !== seenName) {
    setSeenName(self.name ?? null);
    setNameDraft(self.name ?? "");
  }

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const copyId = async () => {
    if (!self.nexaId) return;
    try {
      await navigator.clipboard.writeText(self.nexaId);
      setCopied(true);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the ID is on screen */
    }
  };

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingName) return;
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

  return (
    <div>
      <p className="text-sm font-medium">Your identity here</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded-[3px] border border-border bg-muted px-2.5 py-1.5 font-mono text-sm tracking-wide">
          {self.nexaId ?? "assigned on join"}
        </span>
        <Tooltip label={copied ? "Copied" : "Copy Nexa ID"}>
          <button
            type="button"
            onClick={() => void copyId()}
            aria-label="Copy Nexa ID"
            className="inline-flex size-8 items-center justify-center rounded-[3px] border border-border text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {copied ? (
              <Copy className="size-3.5 text-[color:var(--nexa-accent)]" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        </Tooltip>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        This ID is generated from randomness, never from your email or name —
        it&apos;s the only identity others see.
      </p>

      <div className="mt-4 py-3 border-t border-border">
        <p className="text-sm font-medium">Display name</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Optional. Shown next to your Nexa ID; change it any time, no
          account required.
        </p>
        <form onSubmit={saveName} className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            placeholder="e.g. Priya"
            aria-label="Display name"
            className="h-9 min-w-0 flex-1 rounded-[3px] border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={savingName || nameDraft.trim() === (self.name ?? "")}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[3px] border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {savingName ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            Save
          </button>
        </form>
        {nameError && (
          <p className="mt-1.5 text-xs text-red-500">{nameError}</p>
        )}
      </div>

      <div className="border-t border-border py-3">
        <p className="text-sm font-medium">What this room keeps</p>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>— A live roster while the meeting runs.</li>
          <li>— Chat only until the room closes, then it&apos;s erased.</li>
          <li>— Connection signals, swept within minutes.</li>
          <li>— No recordings, no transcripts, no meeting history.</li>
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          The full{" "}
          <a
            href="/privacy"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Privacy Policy
          </a>{" "}
          explains what Nexa keeps, including what it receives from Google when
          you sign in or connect a calendar and how to disconnect or delete it.
          Questions about data go to{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
