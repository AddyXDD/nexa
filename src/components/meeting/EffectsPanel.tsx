import type { useVideoEffects } from "@/hooks/use-video-effects";
import type { EffectMode } from "@/lib/effects/videoEffects";
import { motion } from "framer-motion";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Video effects panel — preview-first.
 *
 * The preview shows exactly what the room will see (processed track when
 * an effect is on, the raw camera otherwise). Backgrounds are generated on
 * this device or uploaded from this device; neither is ever uploaded
 * anywhere, and the panel says so. If segmentation can't load, the
 * background mode explains itself and blur/adjustments keep working.
 */

type Preset = { id: string; label: string; src: string };

function buildGradient(
  stops: [number, string][],
  vignette: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 720);
  if (vignette > 0) {
    const shade = ctx.createRadialGradient(640, 360, 220, 640, 360, 820);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, `rgba(0,0,0,${vignette})`);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 1280, 720);
  }
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Downscale a chosen image so the settings store stays small. */
function fileToBackground(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read-failed"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("decode-failed"));
      image.onload = () => {
        const scale = Math.min(1, 1280 / image.naturalWidth);
        const width = Math.round(image.naturalWidth * scale);
        const height = Math.round(image.naturalHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas-unavailable"));
          return;
        }
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function EffectsPanel({
  effects,
  cameraOn,
  mirrorSelfView,
  reduced,
  previewTrack,
  onClose,
}: {
  effects: ReturnType<typeof useVideoEffects>;
  cameraOn: boolean;
  mirrorSelfView: boolean;
  reduced: boolean;
  previewTrack: MediaStreamTrack | null;
  onClose: () => void;
}) {
  const presets = useMemo<Preset[]>(
    () => [
      {
        id: "charcoal",
        label: "Charcoal",
        src: buildGradient(
          [
            [0, "#17191e"],
            [1, "#0a0b0d"],
          ],
          0.4,
        ),
      },
      {
        id: "slate",
        label: "Slate",
        src: buildGradient(
          [
            [0, "#1d2530"],
            [1, "#0c1015"],
          ],
          0.35,
        ),
      },
      {
        id: "jade",
        label: "Jade night",
        src: buildGradient(
          [
            [0, "#0f2019"],
            [1, "#07110d"],
          ],
          0.45,
        ),
      },
      {
        id: "dusk",
        label: "Warm dusk",
        src: buildGradient(
          [
            [0, "#2a1d14"],
            [1, "#0f0b09"],
          ],
          0.4,
        ),
      },
    ],
    [],
  );

  const previewRef = useRef<HTMLVideoElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewStream = useMemo(
    () => (previewTrack ? new MediaStream([previewTrack]) : null),
    [previewTrack],
  );

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    element.srcObject = previewStream;
    if (previewStream) void element.play().catch(() => {});
    return () => {
      if (element.srcObject === previewStream) element.srcObject = null;
    };
  }, [previewStream]);

  const { settings, setSettings, notice, clearNotice, capabilities } = effects;
  const backgroundFailed = notice?.startsWith("Background replacement");

  const chooseMode = (mode: EffectMode) => {
    if (mode === "background" && !settings.backgroundSrc) {
      setSettings({ mode, backgroundSrc: presets[0]?.src ?? null });
    } else {
      setSettings({ mode });
    }
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const src = await fileToBackground(file);
      setSettings({ mode: "background", backgroundSrc: src });
    } catch {
      setUploadError("That image couldn't be read — try another file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <motion.aside
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 32, opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
      className="nexa-chrome absolute inset-y-0 right-0 z-30 flex w-full flex-col overflow-hidden border-l border-[color:var(--nexa-ink)]/15 bg-[color:var(--nexa-bone)] text-[color:var(--nexa-ink)] shadow-[-24px_0_60px_-40px_rgba(0,0,0,0.85)] sm:w-[23rem]"
      aria-label="Video effects"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[color:var(--nexa-ink)]/12 px-3">
        <span className="nexa-label text-[color:var(--nexa-ink)]/40">
          Effects
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close effects"
          className="ml-auto inline-flex size-8 items-center justify-center text-[color:var(--nexa-ink)]/35 transition-colors hover:bg-black/[0.06] hover:text-[color:var(--nexa-ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)]"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* Preview */}
        <div className="relative aspect-video overflow-hidden border border-[color:var(--nexa-ink)]/15 bg-[#0a0b0d]">
          <video
            ref={previewRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover ${
              mirrorSelfView ? "-scale-x-100" : ""
            } ${previewTrack ? "opacity-100" : "opacity-0"}`}
          />
          {!previewTrack && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
              <ImageIcon className="size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                {cameraOn
                  ? "Preparing the preview…"
                  : "Turn the camera on to preview effects."}
              </p>
            </div>
          )}
          <span className="absolute bottom-2 left-2 rounded-[2px] bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/80">
            Preview · what others see
          </span>
        </div>

        {notice && (
          <div className="flex items-start gap-2 rounded-[3px] border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <p className="flex-1 text-xs leading-relaxed text-amber-700">
              {notice}
            </p>
            <button
              type="button"
              onClick={clearNotice}
              aria-label="Dismiss notice"
              className="text-amber-700/70 hover:text-amber-800"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* Mode */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Background
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <ModeCard
              label="Original"
              active={settings.mode === "off"}
              onSelect={() => chooseMode("off")}
            />
            <ModeCard
              label="Blur"
              active={settings.mode === "blur"}
              onSelect={() => chooseMode("blur")}
            />
            <ModeCard
              label="Replace"
              active={settings.mode === "background"}
              onSelect={() => chooseMode("background")}
            />
          </div>

          {settings.mode === "blur" && (
            <label className="mt-3 block">
              <span className="flex items-center justify-between text-xs text-muted-foreground">
                Blur strength
                <span className="font-mono">
                  {Math.round(settings.blurStrength * 100)}%
                </span>
              </span>
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(settings.blurStrength * 100)}
                onChange={(event) =>
                  setSettings({ blurStrength: Number(event.target.value) / 100 })
                }
                className="mt-1.5 w-full accent-[color:var(--nexa-accent)]"
                aria-label="Blur strength"
              />
            </label>
          )}

          {settings.mode === "background" && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-4 gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      setSettings({ mode: "background", backgroundSrc: preset.src })
                    }
                    title={preset.label}
                    aria-label={`Background: ${preset.label}`}
                    className={`aspect-video overflow-hidden rounded-[2px] ring-2 transition-all ${
                      settings.backgroundSrc === preset.src
                        ? "ring-[color:var(--nexa-accent)]"
                        : "ring-border hover:ring-muted-foreground/50"
                    }`}
                  >
                    <img
                      src={preset.src}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[3px] border border-border text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  Use an image…
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSettings({ mode: "background", backgroundSrc: null })
                  }
                  className="inline-flex h-8 items-center rounded-[3px] border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Dark field
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void onUpload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Images stay on this device — they&apos;re drawn into your video
                here and never uploaded.
              </p>
              {backgroundFailed && (
                <p className="text-[11px] leading-relaxed text-red-600">
                  On-device background segmentation couldn&apos;t start on this
                  device or network. Blur and adjustments still work.
                </p>
              )}
              {uploadError && (
                <p className="text-[11px] text-red-600">{uploadError}</p>
              )}
            </div>
          )}
        </div>

        {/* Adjustments */}
        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Image adjustments
            </p>
            <button
              type="button"
              onClick={() =>
                setSettings({
                  adjustments: { brightness: 1, contrast: 1, saturation: 1 },
                })
              }
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Reset
            </button>
          </div>

          {!capabilities.filter ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              This browser doesn&apos;t support image adjustments (canvas
              filters). Original and blur still work.
            </p>
          ) : (
            <div className="mt-2 space-y-3">
              <AdjustmentSlider
                label="Brightness"
                value={settings.adjustments.brightness}
                onChange={(brightness) =>
                  setSettings({
                    adjustments: { ...settings.adjustments, brightness },
                  })
                }
              />
              <AdjustmentSlider
                label="Contrast"
                value={settings.adjustments.contrast}
                onChange={(contrast) =>
                  setSettings({
                    adjustments: { ...settings.adjustments, contrast },
                  })
                }
              />
              <AdjustmentSlider
                label="Saturation"
                value={settings.adjustments.saturation}
                onChange={(saturation) =>
                  setSettings({
                    adjustments: { ...settings.adjustments, saturation },
                  })
                }
              />
            </div>
          )}
        </div>

        <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
          Effects run on this device and leave through your existing video
          stream — switching them never restarts the connection, and nothing
          is processed on a server.
        </p>
      </div>
    </motion.aside>
  );
}

function ModeCard({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`rounded-[3px] border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--nexa-accent)] ${
        active
          ? "border-[color:var(--nexa-accent)] bg-[color:var(--nexa-accent)]/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function AdjustmentSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs text-muted-foreground">
        {label}
        <span className="font-mono">{value.toFixed(2)}×</span>
      </span>
      <input
        type="range"
        min={60}
        max={140}
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="mt-1 w-full accent-[color:var(--nexa-accent)]"
        aria-label={label}
      />
    </label>
  );
}
