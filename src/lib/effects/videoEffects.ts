/**
 * Camera effects pipeline — blur, backgrounds, image adjustments.
 *
 * Design rules (from the product spec):
 *  - The WebRTC connection is never touched. The processor emits its own
 *    canvas track; the sender swaps it in with `replaceTrack`, exactly like
 *    mute/share. Switching Original → Blur → Background → Original causes
 *    zero renegotiation on the remote side.
 *  - The camera never goes black. Every failure path falls back to drawing
 *    the plain frame (or hands the raw track back when processing stops).
 *  - If the device can't keep up, we shed processing quality (resolution,
 *    then frame rate), say so once, and keep going.
 *  - No fake features: background replacement uses real browser-side
 *    segmentation, loaded lazily; when it can't load, that one mode is
 *    disabled with an explanation while blur/adjustments keep working.
 */

export type Adjustments = {
  brightness: number; // 1 = neutral
  contrast: number;
  saturation: number;
};

export type EffectMode = "off" | "blur" | "background";

export type EffectSettings = {
  mode: EffectMode;
  /** 0..1 — light blur toward strong blur. */
  blurStrength: number;
  /** data: URL or same-origin image; null = solid dark backdrop. */
  backgroundSrc: string | null;
  adjustments: Adjustments;
};

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
};

export function isNeutralAdjustments(a: Adjustments): boolean {
  return (
    Math.abs(a.brightness - 1) < 0.01 &&
    Math.abs(a.contrast - 1) < 0.01 &&
    Math.abs(a.saturation - 1) < 0.01
  );
}

export function effectSettingsActive(s: EffectSettings): boolean {
  return s.mode !== "off" || !isNeutralAdjustments(s.adjustments);
}

/* ------------------------------------------------------------------ *
 * Capability detection
 * ------------------------------------------------------------------ */

export function supportsCanvasFilter(): boolean {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    (ctx as CanvasRenderingContext2D & { filter?: string }).filter =
      "blur(1px)";
    return (
      (ctx as CanvasRenderingContext2D & { filter?: string }).filter ===
      "blur(1px)"
    );
  } catch {
    return false;
  }
}

export function supportsCanvasCapture(): boolean {
  try {
    return typeof document.createElement("canvas").captureStream === "function";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Lazy segmentation loader (background replacement only)
 * ------------------------------------------------------------------ */

type SegmentationResults = {
  segmentationMask: CanvasImageSource;
  image: CanvasImageSource;
};

type SegmentationInstance = {
  setOptions: (options: Record<string, unknown>) => void;
  onResults: (callback: (results: SegmentationResults) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  close?: () => void;
};

type SegmentationCtor = new (options: {
  locateFile: (file: string) => string;
}) => SegmentationInstance;

const SEGMENTATION_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747";

let segmentationPromise: Promise<SegmentationCtor> | null = null;

/**
 * Load the on-device segmentation model once. Rejections are never cached:
 * a timeout or a flaky CDN must stay retryable on the next attempt, and a
 * script that finishes loading late is picked up by the `existing` check on
 * the retry.
 */
export function loadSegmentation(): Promise<SegmentationCtor> {
  if (segmentationPromise) return segmentationPromise;
  segmentationPromise = new Promise<SegmentationCtor>((resolve, reject) => {
    const existing = (window as unknown as { SelfieSegmentation?: SegmentationCtor })
      .SelfieSegmentation;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      segmentationPromise = null; // slow load — allow a retry
      reject(new Error("segmentation-timeout"));
    }, 20_000);
    const succeed = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      const ctor = (window as unknown as { SelfieSegmentation?: SegmentationCtor })
        .SelfieSegmentation;
      if (ctor) resolve(ctor);
      else {
        segmentationPromise = null;
        reject(new Error("segmentation-missing"));
      }
    };
    script.src = `${SEGMENTATION_CDN}/selfie_segmentation.js`;
    script.async = true;
    script.onload = succeed;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      segmentationPromise = null; // allow a retry on the next attempt
      reject(new Error("segmentation-load-failed"));
    };
    document.head.appendChild(script);
  });
  return segmentationPromise;
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

/** Destination rect that covers `dw×dh` with `sw×sh` (object-fit: cover). */
function coverRect(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ *
 * Processor
 * ------------------------------------------------------------------ */

const DEGRADED_NOTICE =
  "Effects are running at reduced quality to keep your video smooth.";

export class VideoEffectsProcessor {
  private readonly onNotice: (message: string) => void;
  private settings: EffectSettings;
  private source: MediaStreamTrack | null = null;

  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private tempCanvas: HTMLCanvasElement | null = null;
  private blurCanvas: HTMLCanvasElement | null = null;
  private output: MediaStreamTrack | null = null;

  private frame = 0;
  private lastDrawAt = 0;
  private running = false;
  private sendInFlight = false;
  private segmentation: SegmentationInstance | null = null;
  private segmentationFailed = false;
  private background: HTMLImageElement | null = null;
  private backgroundId = 0;

  private drawTimes: number[] = [];
  private step = 0; // 0 = full quality, then shed fps/resolution
  private noticedReduction = false;
  private drawErrors = 0;
  private firstPainted = false;
  private lastPlayAttempt = 0;
  private readonly onFirstFrame: () => void;

  constructor(options: {
    settings: EffectSettings;
    onNotice?: (message: string) => void;
    onFirstFrame?: () => void;
  }) {
    this.settings = options.settings;
    this.onNotice = options.onNotice ?? (() => {});
    this.onFirstFrame = options.onFirstFrame ?? (() => {});
  }

  get track(): MediaStreamTrack | null {
    return this.output;
  }

  get degraded(): boolean {
    return this.step > 0;
  }

  /** Live settings change — no restart, no track swap. */
  setSettings(settings: EffectSettings): void {
    this.settings = settings;
    if (settings.mode === "background" && settings.backgroundSrc) {
      this.ensureBackground(settings.backgroundSrc);
    }
    if (
      (settings.mode === "background" || settings.mode === "blur") &&
      !this.segmentationFailed
    ) {
      void this.ensureSegmentation();
    }
  }

  start(source: MediaStreamTrack): void {
    this.stop();
    this.source = source;
    this.running = true;
    this.step = 0;
    this.drawTimes = [];

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([source]);
    this.video = video;
    void video.play().catch(() => {});

    const canvas = document.createElement("canvas");
    this.canvas = canvas;
    // The output track is only created once a frame has actually been
    // painted (markPainted). Until then the caller keeps the raw camera
    // track on the wire — receivers never see a blank/white canvas.

    if (this.settings.mode === "background" && this.settings.backgroundSrc) {
      this.ensureBackground(this.settings.backgroundSrc);
    }
    if (this.settings.mode === "background" || this.settings.mode === "blur") {
      void this.ensureSegmentation();
    }

    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    if (this.output) {
      this.output.stop();
      this.output = null;
    }
    if (this.segmentation) {
      try {
        this.segmentation.close?.();
      } catch {
        /* nothing to close */
      }
      this.segmentation = null;
    }
    this.sendInFlight = false;
    this.canvas = null;
    this.tempCanvas = null;
    this.blurCanvas = null;
    this.source = null;
    this.firstPainted = false;
    this.lastPlayAttempt = 0;
  }

  /* ---------------- internals ---------------- */

  private async ensureSegmentation(): Promise<void> {
    if (this.segmentation || this.segmentationFailed) return;
    try {
      const Ctor = await loadSegmentation();
      if (!this.running) return;
      const instance = new Ctor({
        locateFile: (file: string) => `${SEGMENTATION_CDN}/${file}`,
      });
      instance.setOptions({ modelSelection: 1 });
      instance.onResults((results) => {
        this.sendInFlight = false;
        if (this.settings.mode === "background") {
          this.composeBackground(results);
        } else if (this.settings.mode === "blur") {
          this.composeBlur(results);
        }
        // Any other mode: the plain loop owns the canvas again.
      });
      this.segmentation = instance;
    } catch {
      this.segmentationFailed = true;
      this.onNotice(
        this.settings.mode === "blur"
          ? "Background blur couldn't load on this device — showing your plain camera."
          : "Background replacement couldn't load on this device — adjustments still work.",
      );
    }
  }

  private ensureBackground(src: string): void {
    if (this.background && this.background.src === src) return;
    const id = ++this.backgroundId;
    const image = new Image();
    image.onload = () => {
      if (id === this.backgroundId) this.background = image;
    };
    image.src = src;
  }

  private blurFilter(): string {
    if (this.settings.mode !== "blur") return "";
    // Blur radius scales with frame height so strength feels consistent.
    const strength = clamp(this.settings.blurStrength, 0.05, 1);
    const height = this.canvas?.height ?? 720;
    const radius = (6 + strength * 22) * (height / 720);
    return `blur(${radius.toFixed(1)}px)`;
  }

  private targetFps(): number {
    if (this.step >= 2) return 18;
    if (this.step >= 1) return 24;
    return 30;
  }

  private loop = (): void => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (now - this.lastDrawAt < 1000 / this.targetFps()) return;
    this.lastDrawAt = now;

    const video = this.video;
    const canvas = this.canvas;
    if (!video || !canvas) return;

    // Autoplay can be refused (e.g. inside an iframe until a gesture);
    // keep retrying so effects start without a page reload.
    if (video.paused && now - this.lastPlayAttempt > 1_000) {
      this.lastPlayAttempt = now;
      void video.play().catch(() => {});
    }
    if (video.readyState < 2) return;

    const started = performance.now();

    // Size the canvas to the source (scaled down only under overload).
    const scale = this.step >= 2 ? 0.85 : 1;
    const width = Math.round((video.videoWidth || 1280) * scale);
    const height = Math.round((video.videoHeight || 720) * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const segmented =
      this.settings.mode === "background" || this.settings.mode === "blur";
    if (segmented && this.segmentation) {
      if (!this.sendInFlight) {
        this.sendInFlight = true;
        void this.segmentation.send({ image: video }).catch(() => {
          this.sendInFlight = false;
        });
      }
      // The frame is drawn by onResults; keep the last one in between.
    } else {
      this.drawPlain();
    }

    const elapsed = performance.now() - started;
    this.trackFrameTime(elapsed);
  };

  /** Plain frame path: adjustments only — deliberately never blurred, so
   *  the person stays sharp until segmentation can isolate the background. */
  private drawPlain(): void {
    const ctx = this.canvas?.getContext("2d");
    const video = this.video;
    if (!ctx || !video) return;
    try {
      const filter = supportsCanvasFilter() ? this.adjustmentsFilter() : "";
      if (filter) {
        ctx.filter = filter;
        ctx.drawImage(video, 0, 0, this.canvas!.width, this.canvas!.height);
        ctx.filter = "none";
      } else {
        ctx.drawImage(video, 0, 0, this.canvas!.width, this.canvas!.height);
      }
      this.drawErrors = 0;
      this.markPainted();
    } catch {
      // Never go black: retry plainly next frame, surface once after repeats.
      try {
        ctx.drawImage(video, 0, 0, this.canvas!.width, this.canvas!.height);
        this.markPainted();
      } catch {
        /* transient — the next frame recovers */
      }
      if (++this.drawErrors === 30) {
        this.onNotice("Video effects hit a problem — showing your plain camera.");
      }
    }
  }

  /** First frame painted: publish the output track and let the caller swap
   *  it in. Before this moment the raw camera stays on the wire, so a slow
   *  camera/effects start shows real video instead of a white canvas. */
  private markPainted(): void {
    if (this.firstPainted || !this.running) return;
    this.firstPainted = true;
    try {
      const stream = this.canvas?.captureStream(30);
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      track.contentHint = "motion";
      this.output = track;
      this.onFirstFrame();
    } catch {
      /* capture unsupported — the raw camera track stays on the wire */
    }
  }

  /** Blur without ctx.filter support: downscale → upscale (box blur). */
  private drawFallbackBlur(): void {
    const canvas = this.canvas!;
    const video = this.video!;
    if (!this.blurCanvas) this.blurCanvas = document.createElement("canvas");
    const blur = this.blurCanvas;
    const strong = this.settings.blurStrength > 0.5;
    const factor = strong ? 16 : 8;
    blur.width = Math.max(2, Math.round(canvas.width / factor));
    blur.height = Math.max(2, Math.round(canvas.height / factor));
    const bctx = blur.getContext("2d");
    const ctx = canvas.getContext("2d");
    if (!bctx || !ctx) return;
    bctx.drawImage(video, 0, 0, blur.width, blur.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(blur, 0, 0, canvas.width, canvas.height);
  }

  /** Segmented composition: background image behind the person layer. */
  private composeBackground(results: SegmentationResults): void {
    const canvas = this.canvas;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    try {
      const width = canvas.width;
      const height = canvas.height;

      // 1. Background (image, or a quiet dark field).
      if (this.background) {
        const bgRect = coverRect(
          this.background.naturalWidth || 1920,
          this.background.naturalHeight || 1080,
          width,
          height,
        );
        ctx.drawImage(
          this.background,
          bgRect.x,
          bgRect.y,
          bgRect.w,
          bgRect.h,
        );
      } else {
        ctx.fillStyle = "#0b0c0f";
        ctx.fillRect(0, 0, width, height);
      }

      // 2. Sharp person on top, cut out through the segmentation mask.
      const person = this.buildPersonLayer(results, width, height);
      if (!person) {
        this.drawPlain();
        return;
      }
      ctx.drawImage(person, 0, 0);
      this.drawErrors = 0;
      this.markPainted();
    } catch {
      if (++this.drawErrors === 30) {
        this.onNotice(
          "Background replacement hit a problem — showing your plain camera.",
        );
      }
      this.drawPlain();
    }
  }

  /**
   * Person-aware blur: the whole frame is blurred (plus adjustments) as the
   * background layer, then the sharp, adjusted person is composited over it
   * through the segmentation mask — the person is never blurred.
   */
  private composeBlur(results: SegmentationResults): void {
    const canvas = this.canvas;
    const ctx = canvas?.getContext("2d");
    const video = this.video;
    if (!canvas || !ctx || !video) return;
    try {
      const width = canvas.width;
      const height = canvas.height;

      // 1. Background layer: blurred frame.
      if (supportsCanvasFilter()) {
        const parts = [this.blurFilter(), this.adjustmentsFilter()].filter(
          Boolean,
        );
        ctx.filter = parts.length > 0 ? parts.join(" ") : "none";
        ctx.drawImage(video, 0, 0, width, height);
        ctx.filter = "none";
      } else {
        // No canvas filters: box-blur the frame, the person is overlaid next.
        this.drawFallbackBlur();
      }

      // 2. Sharp person on top, cut out through the segmentation mask.
      const person = this.buildPersonLayer(results, width, height);
      if (!person) {
        this.drawPlain();
        return;
      }
      ctx.drawImage(person, 0, 0);
      this.drawErrors = 0;
      this.markPainted();
    } catch {
      if (++this.drawErrors === 30) {
        this.onNotice(
          "Background blur hit a problem — showing your plain camera.",
        );
      }
      this.drawPlain();
    }
  }

  /**
   * Sharp, adjusted person cutout on a transparent canvas — shared by blur
   * and background replacement. The frame is drawn at 0,0,width,height: the
   * canvas is sized to the source every loop, so aspects match exactly and
   * the mask lines up with the person.
   */
  private buildPersonLayer(
    results: SegmentationResults,
    width: number,
    height: number,
  ): HTMLCanvasElement | null {
    if (!this.tempCanvas) this.tempCanvas = document.createElement("canvas");
    const temp = this.tempCanvas;
    if (temp.width !== width || temp.height !== height) {
      temp.width = width;
      temp.height = height;
    }
    const tctx = temp.getContext("2d");
    if (!tctx) return null;

    // 1. Person layer with image adjustments (never blurred).
    tctx.globalCompositeOperation = "source-over";
    tctx.filter = supportsCanvasFilter() ? this.adjustmentsFilter() : "none";
    tctx.drawImage(results.image, 0, 0, width, height);
    tctx.filter = "none";

    // 2. Keep only the person (feathered mask).
    tctx.globalCompositeOperation = "destination-in";
    if (supportsCanvasFilter()) tctx.filter = "blur(2px)";
    tctx.drawImage(results.segmentationMask, 0, 0, width, height);
    tctx.filter = "none";
    tctx.globalCompositeOperation = "source-over";
    return temp;
  }

  private adjustmentsFilter(): string {
    const a = this.settings.adjustments;
    const parts: string[] = [];
    if (Math.abs(a.brightness - 1) >= 0.01)
      parts.push(`brightness(${a.brightness.toFixed(2)})`);
    if (Math.abs(a.contrast - 1) >= 0.01)
      parts.push(`contrast(${a.contrast.toFixed(2)})`);
    if (Math.abs(a.saturation - 1) >= 0.01)
      parts.push(`saturate(${a.saturation.toFixed(2)})`);
    return parts.join(" ");
  }

  private trackFrameTime(elapsed: number): void {
    this.drawTimes.push(elapsed);
    if (this.drawTimes.length < 90) return;
    const avg =
      this.drawTimes.reduce((sum, value) => sum + value, 0) /
      this.drawTimes.length;
    this.drawTimes = [];
    // Shed only under real overload — frame rate first, and never below
    // 85% resolution: a sharp, slightly slower frame beats a blurry one.
    const needed = avg > 28 ? 2 : avg > 20 ? 1 : 0;
    if (needed > this.step) {
      this.step = needed;
      if (!this.noticedReduction) {
        this.noticedReduction = true;
        this.onNotice(DEGRADED_NOTICE);
      }
    }
  }
}
