/**
 * Shared WebAudio utilities for Nexa's microphone and speaker tooling.
 *
 * Everything here is built on browser-native DSP — there is no "AI noise
 * cancellation" in Nexa, and the UI never pretends otherwise. The strong
 * noise-reduction tier is exactly what it says: the browser's own noise
 * suppression plus a low-cut filter and a gentle compressor to tame fans,
 * hum, and keyboard clatter without chewing up the voice.
 */

let sharedContext: AudioContext | null = null;

/** Lazily created, shared AudioContext (created suspended until a gesture). */
export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext || sharedContext.state === "closed") {
    try {
      sharedContext = new Ctor();
    } catch {
      return null;
    }
  }
  if (sharedContext.state === "suspended") {
    void sharedContext.resume().catch(() => {
      /* resumed on the next user gesture */
    });
  }
  return sharedContext;
}

/**
 * Browsers suspend AudioContext until a real gesture. Register once per
 * page; resumes the shared context on the first click/key/touch.
 */
export function resumeAudioOnInteraction(): () => void {
  const resume = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
  };
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  for (const event of events) {
    window.addEventListener(event, resume, { once: false, passive: true });
  }
  return () => {
    for (const event of events) window.removeEventListener(event, resume);
  };
}

/* ------------------------------------------------------------------ *
 * Level meter
 * ------------------------------------------------------------------ */

export type LevelMeter = { stop: () => void };

/**
 * Poll RMS level (0..1, perceptually curved) from a stream's audio track.
 * Runs on rAF — stops cleanly in background tabs. Returns null when audio
 * isn't available at all (no WebAudio, dead track).
 */
export function startLevelMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
): LevelMeter | null {
  if (stream.getAudioTracks().length === 0) return null;
  const ctx = getAudioContext();
  if (!ctx) return null;

  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx.createMediaStreamSource(stream);
  } catch {
    return null;
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);

  const buffer = new Uint8Array(analyser.fftSize);
  let frame = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    frame = requestAnimationFrame(tick);
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const value = (buffer[i] - 128) / 128;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / buffer.length);
    // Curve small speech amplitudes up so the meter feels alive but honest.
    onLevel(Math.min(1, Math.pow(rms * 3.4, 0.8)));
  };
  tick();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* already torn down */
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Speaker test
 * ------------------------------------------------------------------ */

export type SpeakerTest = { stop: () => void };

/**
 * Play a short two-note chime through a specific output device (when the
 * browser supports `setSinkId`), otherwise the system default. Returns
 * null when WebAudio isn't available.
 */
export async function playSpeakerTest(
  sinkId?: string | null,
): Promise<SpeakerTest | null> {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});

  const destination = ctx.createMediaStreamDestination();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(destination);

  const noteA = ctx.createOscillator();
  const noteB = ctx.createOscillator();
  noteA.type = "sine";
  noteB.type = "sine";
  noteA.frequency.value = 523.25; // C5
  noteB.frequency.value = 659.26; // E5
  noteA.connect(gain);
  noteB.connect(gain);

  const element = new Audio();
  element.srcObject = destination.stream;
  const anyElement = element as HTMLAudioElement & {
    setSinkId?: (id: string) => Promise<void>;
  };
  if (sinkId && typeof anyElement.setSinkId === "function") {
    await anyElement.setSinkId(sinkId).catch(() => {});
  }

  const start = ctx.currentTime;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.2, start + 0.05);
  gain.gain.linearRampToValueAtTime(0, start + 0.38);
  gain.gain.linearRampToValueAtTime(0.2, start + 0.55);
  gain.gain.linearRampToValueAtTime(0, start + 0.95);
  noteA.start(start);
  noteB.start(start);
  noteA.stop(start + 1.05);
  noteB.stop(start + 1.05);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      noteA.stop();
      noteB.stop();
    } catch {
      /* already stopped */
    }
    element.pause();
    destination.stream.getTracks().forEach((track) => track.stop());
  };

  try {
    await element.play();
  } catch {
    stop();
    return null;
  }
  window.setTimeout(stop, 1200);
  return { stop };
}

/* ------------------------------------------------------------------ *
 * Microphone processing (strong tier)
 * ------------------------------------------------------------------ */

export type ProcessedMic = { track: MediaStreamTrack; stop: () => void };

/**
 * Wrap the raw microphone in a native WebAudio chain:
 * low-cut at 90 Hz (fans, handling noise, rumble) → gentle compressor
 * (evens out distance changes without pumping). The browser's own noise
 * suppression still runs at the source — this adds on top of it.
 *
 * Returns null when WebAudio can't start — or while the context is still
 * waiting for its first gesture, because a suspended context renders
 * silence and would make the microphone inaudible to everyone else.
 * Callers then keep the raw track, so the mic never goes dark.
 */
export function createStrongMicTrack(
  raw: MediaStreamTrack,
): ProcessedMic | null {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state !== "running") return null;
  try {
    const source = ctx.createMediaStreamSource(new MediaStream([raw]));
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = "highpass";
    lowCut.frequency.value = 90;
    lowCut.Q.value = 0.7;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -32;
    compressor.knee.value = 24;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    const out = ctx.createMediaStreamDestination();
    source.connect(lowCut);
    lowCut.connect(compressor);
    compressor.connect(out);

    const track = out.stream.getAudioTracks()[0];
    if (!track) return null;
    track.contentHint = "speech";

    return {
      track,
      stop() {
        try {
          source.disconnect();
          lowCut.disconnect();
          compressor.disconnect();
        } catch {
          /* already torn down */
        }
        track.stop();
      },
    };
  } catch {
    return null;
  }
}
