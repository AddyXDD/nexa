import { COPY } from "@/shared/constants";
import type { MediaErrorKind } from "@/shared/types";
import {
  createStrongMicTrack,
  getAudioContext,
  resumeAudioOnInteraction,
} from "@/lib/media/audio";
import { log } from "@/lib/webrtc/logger";
import { loadJson, saveJson } from "@/lib/prefs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Local media for a meeting room.
 *
 * - Acquires microphone and camera separately so a blocked camera doesn't
 *   take the microphone down with it (and vice versa), and so each failure
 *   gets its own precise, actionable message.
 * - Muting/camera-off actually stops the track (browser recording indicator
 *   turns off); turning it back on re-acquires the device.
 * - Screen share rides on the same outgoing video slot via replaceTrack,
 *   and restores the camera when it ends — including when the user stops
 *   sharing from the browser's own UI.
 * - Effects ride the same slot: `setVideoOverride` swaps in a processed
 *   canvas track without touching the peer connection.
 * - Noise reduction has three honest tiers (off / browser-standard /
 *   browser-standard + native low-cut chain), each applied at the source —
 *   switching tiers re-acquires the mic, it never renegotiates anything.
 */

type Device = "camera" | "microphone";

export type NoiseLevel = "off" | "standard" | "strong";

export type MediaPrefs = {
  audioDeviceId: string | null;
  videoDeviceId: string | null;
  speakerDeviceId: string | null;
  noiseLevel: NoiseLevel;
};

const DEFAULT_PREFS: MediaPrefs = {
  audioDeviceId: null,
  videoDeviceId: null,
  speakerDeviceId: null,
  noiseLevel: "standard",
};

const PREFS_KEY = "media";

function mediaErrorKind(err: unknown): MediaErrorKind {
  if (!navigator.mediaDevices || !window.isSecureContext) return "insecure";
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "SecurityError") {
      return "blocked";
    }
    if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
      return "not-found";
    }
    if (
      err.name === "NotReadableError" ||
      err.name === "AbortError" ||
      err.name === "TrackStartError"
    ) {
      return "in-use";
    }
  }
  return "unknown";
}

function messageFor(kind: MediaErrorKind, device: Device): string {
  if (kind === "insecure") return COPY.insecureContext;
  if (kind === "blocked") {
    return device === "camera" ? COPY.cameraBlocked : COPY.micBlocked;
  }
  if (kind === "not-found") return COPY.noDevice;
  if (kind === "in-use") {
    return device === "camera"
      ? "Camera is already in use by another application."
      : "Microphone is already in use by another application.";
  }
  return device === "camera"
    ? "Camera couldn't be started."
    : "Microphone couldn't be started.";
}

const VIDEO_BASE: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

function videoConstraints(prefs: MediaPrefs): MediaTrackConstraints {
  return prefs.videoDeviceId
    ? { ...VIDEO_BASE, deviceId: { exact: prefs.videoDeviceId } }
    : { ...VIDEO_BASE };
}

/**
 * Tell the encoder this is speech. Mobile browsers tune their audio pipeline
 * (and, on iOS, the capture path itself) off this hint; a track left at the
 * default "music" hint is the difference between a voice that arrives and
 * one that never gets picked up on a phone.
 */
function markSpeech(track: MediaStreamTrack | null): MediaStreamTrack | null {
  if (track) {
    try {
      track.contentHint = "speech";
    } catch {
      /* not settable on this browser — the default applies */
    }
  }
  return track;
}

function audioConstraints(prefs: MediaPrefs): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: prefs.noiseLevel !== "off",
  };
  if (prefs.audioDeviceId) base.deviceId = { exact: prefs.audioDeviceId };
  return base;
}

/** getUserMedia with one fallback: a remembered device that disappeared. */
async function acquire(
  kind: "audio" | "video",
  constraints: MediaTrackConstraints,
  fallback: MediaTrackConstraints,
): Promise<MediaStream> {
  const build = (track: MediaTrackConstraints): MediaStreamConstraints =>
    kind === "audio" ? { audio: track } : { video: track };
  try {
    return await navigator.mediaDevices.getUserMedia(build(constraints));
  } catch (err) {
    if (
      err instanceof DOMException &&
      err.name === "OverconstrainedError" &&
      constraints !== fallback
    ) {
      return await navigator.mediaDevices.getUserMedia(build(fallback));
    }
    throw err;
  }
}

export function useLocalMedia() {
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [camTrack, setCamTrack] = useState<MediaStreamTrack | null>(null);
  const [screenTrack, setScreenTrack] = useState<MediaStreamTrack | null>(null);
  /** Tab/system audio captured alongside a screen share (when offered). */
  const [screenAudio, setScreenAudio] = useState<MediaStreamTrack | null>(null);
  /** Mic + share audio mixed into one outgoing track (see the mixer below). */
  const [shareMix, setShareMix] = useState<MediaStreamTrack | null>(null);
  const [strongTrack, setStrongTrack] = useState<MediaStreamTrack | null>(null);
  const [videoOverride, setVideoOverrideState] =
    useState<MediaStreamTrack | null>(null);
  const [starting, setStarting] = useState(true);
  const [started, setStarted] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<MediaPrefs>(() =>
    loadJson(PREFS_KEY, DEFAULT_PREFS),
  );

  // Ref mirrors so async callbacks never act on stale track references.
  const audioRef = useRef<MediaStreamTrack | null>(null);
  const camRef = useRef<MediaStreamTrack | null>(null);
  const screenRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioRef = useRef<MediaStreamTrack | null>(null);
  const strongRef = useRef<{ track: MediaStreamTrack; stop: () => void } | null>(
    null,
  );
  const prefsRef = useRef(prefs);
  const busyRef = useRef(false);

  const setAudio = useCallback((track: MediaStreamTrack | null) => {
    audioRef.current = track;
    setAudioTrack(track);
  }, []);
  const setCam = useCallback((track: MediaStreamTrack | null) => {
    camRef.current = track;
    setCamTrack(track);
  }, []);
  const setScreen = useCallback((track: MediaStreamTrack | null) => {
    screenRef.current = track;
    setScreenTrack(track);
  }, []);

  const setPrefs = useCallback((patch: Partial<MediaPrefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      prefsRef.current = next;
      saveJson(PREFS_KEY, next);
      return next;
    });
  }, []);

  const micOn = audioTrack !== null;
  const camOn = camTrack !== null;
  const sharing = screenTrack !== null;

  /** Effects (or null) override the camera on the wire and in previews. */
  const setVideoOverride = useCallback(
    (track: MediaStreamTrack | null) => setVideoOverrideState(track),
    [],
  );

  /** What actually goes on the wire (screen share wins, then effects).
   *  Audio: the share mix (mic + tab) when both exist, else the mic, else
   *  the shared tab's own audio. */
  const outgoing = useMemo(
    () => ({
      audio: shareMix ?? strongTrack ?? audioTrack ?? screenAudio,
      video: screenTrack ?? videoOverride ?? camTrack,
    }),
    [audioTrack, strongTrack, screenTrack, videoOverride, camTrack, shareMix, screenAudio],
  );

  /** Local preview: microphone + active video source (share, effects, cam). */
  const previewStream = useMemo(() => {
    const tracks: MediaStreamTrack[] = [];
    const audio = strongTrack ?? audioTrack;
    if (audio) tracks.push(audio);
    const video = screenTrack ?? videoOverride ?? camTrack;
    if (video) tracks.push(video);
    const out = tracks.length > 0 ? new MediaStream(tracks) : null;
    if (out) {
      // Tag the stream so the renderer can tell a camera self-view from a
      // captured presenter stream and only mirror the former.
      (out as { isCapture?: boolean }).isCapture = screenTrack !== null;
    }
    return out;
  }, [audioTrack, strongTrack, screenTrack, videoOverride, camTrack]);

  /**
   * Browsers keep the shared AudioContext suspended until a real gesture.
   * Everything routed through WebAudio (the strong noise tier, the level
   * meter) would otherwise run on silence — resume it on the first input.
   */
  useEffect(() => resumeAudioOnInteraction(), []);

  /** Initial acquisition: microphone first, then camera, independently. */
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const currentPrefs = prefsRef.current;
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicrophoneError(COPY.insecureContext);
        setCameraError(COPY.insecureContext);
        setStarting(false);
        setStarted(true);
        return;
      }

      try {
        const stream = await acquire(
          "audio",
          audioConstraints(currentPrefs),
          audioConstraints({ ...currentPrefs, audioDeviceId: null }),
        );
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setAudio(markSpeech(stream.getAudioTracks()[0] ?? null));
        setMicrophoneError(null);
        log.meeting("local microphone acquired");
      } catch (err) {
        if (cancelled) return;
        const kind = mediaErrorKind(err);
        setMicrophoneError(messageFor(kind, "microphone"));
        log.meeting("local microphone unavailable", { kind });
      }

      // The microphone is decided from here on, for better or worse. Publish
      // that now instead of waiting on the camera: the camera can sit on a
      // slow permission prompt or be held by another app, and the room mesh
      // only needs the mic to build a correct first offer. Waiting for both
      // is what left mobile peers connected with no audio on the wire.
      if (!cancelled) setStarted(true);

      try {
        const stream = await acquire(
          "video",
          videoConstraints(currentPrefs),
          videoConstraints({ ...currentPrefs, videoDeviceId: null }),
        );
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setCam(stream.getVideoTracks()[0] ?? null);
        setCameraError(null);
        log.meeting("local camera acquired");
      } catch (err) {
        if (cancelled) return;
        const kind = mediaErrorKind(err);
        setCameraError(messageFor(kind, "camera"));
        log.meeting("local camera unavailable", { kind });
      }

      if (!cancelled) {
        setStarting(false);
        setStarted(true);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Stop everything when the room unmounts. */
  useEffect(() => {
    return () => {
      audioRef.current?.stop();
      camRef.current?.stop();
      screenRef.current?.stop();
      strongRef.current?.stop();
      audioRef.current = null;
      camRef.current = null;
      screenRef.current = null;
      strongRef.current = null;
    };
  }, []);

  /* ---------------- strong noise-reduction chain ---------------- */

  useEffect(() => {
    if (prefs.noiseLevel !== "strong" || !audioTrack) {
      strongRef.current?.stop();
      strongRef.current = null;
      setStrongTrack(null);
      return;
    }
    const processed = createStrongMicTrack(audioTrack);
    if (processed) {
      strongRef.current = processed;
      setStrongTrack(processed.track);
      return () => {
        processed.stop();
        if (strongRef.current === processed) strongRef.current = null;
        setStrongTrack(null);
      };
    }

    // WebAudio unavailable, or the context is still waiting for its first
    // gesture (a suspended context would put silence on the wire). Keep the
    // raw mic outgoing and upgrade the moment the context starts running.
    const ctx = getAudioContext();
    if (!ctx) return; // raw mic keeps working
    let upgraded: ReturnType<typeof createStrongMicTrack> = null;
    const onStateChange = () => {
      if (ctx.state !== "running") return;
      ctx.removeEventListener("statechange", onStateChange);
      upgraded = createStrongMicTrack(audioTrack);
      if (!upgraded) return;
      strongRef.current = upgraded;
      setStrongTrack(upgraded.track);
    };
    ctx.addEventListener("statechange", onStateChange);
    return () => {
      ctx.removeEventListener("statechange", onStateChange);
      if (upgraded !== null) {
        upgraded.stop();
        if (strongRef.current === upgraded) strongRef.current = null;
        setStrongTrack(null);
      }
    };
  }, [audioTrack, prefs.noiseLevel]);

  /* ---------------- device & noise operations ---------------- */

  const reacquireMic = useCallback(
    async (nextPrefs: MediaPrefs) => {
      const fresh = await acquire(
        "audio",
        audioConstraints(nextPrefs),
        audioConstraints({ ...nextPrefs, audioDeviceId: null }),
      );
      const track = markSpeech(fresh.getAudioTracks()[0] ?? null);
      audioRef.current?.stop();
      setAudio(track);
    },
    [setAudio],
  );

  const reacquireCamera = useCallback(
    async (nextPrefs: MediaPrefs) => {
      const fresh = await acquire(
        "video",
        videoConstraints(nextPrefs),
        videoConstraints({ ...nextPrefs, videoDeviceId: null }),
      );
      const track = fresh.getVideoTracks()[0] ?? null;
      camRef.current?.stop();
      setCam(track);
    },
    [setCam],
  );

  const selectMicrophone = useCallback(
    async (deviceId: string | null) => {
      if (busyRef.current) return;
      busyRef.current = true;
      const next = { ...prefsRef.current, audioDeviceId: deviceId };
      setPrefs({ audioDeviceId: deviceId });
      try {
        if (audioRef.current) await reacquireMic(next);
        setMicrophoneError(null);
        log.meeting("microphone selected", { deviceId });
      } catch (err) {
        setMicrophoneError(messageFor(mediaErrorKind(err), "microphone"));
      } finally {
        busyRef.current = false;
      }
    },
    [setPrefs, reacquireMic],
  );

  const selectCamera = useCallback(
    async (deviceId: string | null) => {
      if (busyRef.current) return;
      busyRef.current = true;
      const next = { ...prefsRef.current, videoDeviceId: deviceId };
      setPrefs({ videoDeviceId: deviceId });
      try {
        if (camRef.current) await reacquireCamera(next);
        setCameraError(null);
        log.meeting("camera selected", { deviceId });
      } catch (err) {
        setCameraError(messageFor(mediaErrorKind(err), "camera"));
      } finally {
        busyRef.current = false;
      }
    },
    [setPrefs, reacquireCamera],
  );

  const setNoiseLevel = useCallback(
    async (noiseLevel: NoiseLevel) => {
      if (busyRef.current) return;
      busyRef.current = true;
      const next = { ...prefsRef.current, noiseLevel };
      setPrefs({ noiseLevel });
      try {
        if (audioRef.current) await reacquireMic(next);
        log.meeting("noise level changed", { noiseLevel });
      } catch (err) {
        setMicrophoneError(messageFor(mediaErrorKind(err), "microphone"));
      } finally {
        busyRef.current = false;
      }
    },
    [setPrefs, reacquireMic],
  );

  const setSpeaker = useCallback(
    (deviceId: string | null) => setPrefs({ speakerDeviceId: deviceId }),
    [setPrefs],
  );

  /* ---------------- share audio (mic + tab mixed) ---------------- */

  /** Adopt/replace the share-audio track, stopping the previous one. */
  const adoptScreenAudio = useCallback((track: MediaStreamTrack | null) => {
    if (screenAudioRef.current && screenAudioRef.current !== track) {
      screenAudioRef.current.stop();
    }
    screenAudioRef.current = track;
    setScreenAudio(track);
  }, []);

  /**
   * While a share carries audio and the mic is on, mix both into one track
   * so remote peers hear the presenter talking over the shared tab's sound.
   * The graph lives on the shared AudioContext; the raw paths above remain
   * the fallback whenever this can't run.
   */
  useEffect(() => {
    const mic = strongTrack ?? audioTrack;
    if (!screenAudio || !mic) {
      queueMicrotask(() => setShareMix(null));
      return;
    }
    const ctx = getAudioContext();
    if (!ctx) {
      queueMicrotask(() => setShareMix(null));
      return;
    }
    let cancelled = false;
    let track: MediaStreamTrack | null = null;
    let teardown: (() => void) | null = null;
    try {
      const destination = ctx.createMediaStreamDestination();
      const micSource = ctx.createMediaStreamSource(new MediaStream([mic]));
      const tabSource = ctx.createMediaStreamSource(
        new MediaStream([screenAudio]),
      );
      micSource.connect(destination);
      tabSource.connect(destination);
      track = destination.stream.getAudioTracks()[0] ?? null;
      teardown = () => {
        try {
          micSource.disconnect();
          tabSource.disconnect();
        } catch {
          /* already torn down */
        }
        track?.stop();
      };
    } catch {
      track = null; // raw paths keep working
    }
    queueMicrotask(() => {
      if (!cancelled) setShareMix(track);
    });
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [screenAudio, strongTrack, audioTrack]);

  /* ---------------- toggles ---------------- */

  const toggleMic = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (audioRef.current) {
        const track = audioRef.current;
        setAudio(null);
        track.stop();
        log.meeting("microphone muted");
        return;
      }
      try {
        const fresh = await acquire(
          "audio",
          audioConstraints(prefsRef.current),
          audioConstraints({ ...prefsRef.current, audioDeviceId: null }),
        );
        setAudio(markSpeech(fresh.getAudioTracks()[0] ?? null));
        setMicrophoneError(null);
        log.meeting("microphone unmuted");
      } catch (err) {
        const kind = mediaErrorKind(err);
        setMicrophoneError(messageFor(kind, "microphone"));
        log.meeting("microphone unmute failed", { kind });
      }
    } finally {
      busyRef.current = false;
    }
  }, [setAudio]);

  const toggleCam = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (camRef.current) {
        const track = camRef.current;
        setCam(null);
        track.stop();
        log.meeting("camera turned off");
        return;
      }
      try {
        const fresh = await acquire(
          "video",
          videoConstraints(prefsRef.current),
          videoConstraints({ ...prefsRef.current, videoDeviceId: null }),
        );
        setCam(fresh.getVideoTracks()[0] ?? null);
        setCameraError(null);
        log.meeting("camera turned on");
      } catch (err) {
        const kind = mediaErrorKind(err);
        setCameraError(messageFor(kind, "camera"));
        log.meeting("camera start failed", { kind });
      }
    } finally {
      busyRef.current = false;
    }
  }, [setCam]);

  const startScreenShare = useCallback(async () => {
    if (screenRef.current) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenShareError("Screen sharing isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        // An explicit rate: without one the browser may capture too slowly
        // and the share looks jittery. Ideal 30fps keeps it video-smooth.
        video: { frameRate: { ideal: 30, max: 60 } },
        // Tab audio when the picker's "Share tab audio" box is ticked.
        audio: true,
      });
      const track = stream.getVideoTracks()[0] ?? null;
      if (!track) {
        setScreenShareError("Screen sharing couldn't start.");
        return;
      }
      // Smooth playback over per-frame sharpness — video-like shares stay
      // fluid under load instead of stuttering frame by frame.
      track.contentHint = "motion";
      // The browser's own "Stop sharing" bar ends the track.
      track.addEventListener("ended", () => {
        if (screenRef.current?.id === track.id) {
          setScreen(null);
          adoptScreenAudio(null);
          log.meeting("screen share stopped (browser UI)");
        }
      });
      const tabAudio = stream.getAudioTracks()[0] ?? null;
      if (tabAudio) {
        tabAudio.addEventListener("ended", () => {
          if (screenAudioRef.current?.id === tabAudio.id) {
            adoptScreenAudio(null);
          }
        });
        adoptScreenAudio(tabAudio);
      }
      setScreen(track);
      setScreenShareError(null);
      log.meeting("screen share started", { audio: tabAudio !== null });
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        return; // user dismissed the picker — not a failure
      }
      setScreenShareError("Screen sharing couldn't start.");
      log.meeting("screen share failed");
    }
  }, [setScreen, adoptScreenAudio]);

  const stopScreenShare = useCallback(() => {
    const track = screenRef.current;
    if (!track) return;
    setScreen(null);
    track.stop();
    adoptScreenAudio(null);
    log.meeting("screen share stopped");
  }, [setScreen, adoptScreenAudio]);

  /** Re-attempt a device after a permission/hardware failure. */
  const retryDevice = useCallback(
    async (device: Device) => {
      if (device === "microphone") {
        if (audioRef.current) return;
        try {
          const fresh = await acquire(
            "audio",
            audioConstraints(prefsRef.current),
            audioConstraints({ ...prefsRef.current, audioDeviceId: null }),
          );
          setAudio(markSpeech(fresh.getAudioTracks()[0] ?? null));
          setMicrophoneError(null);
        } catch (err) {
          setMicrophoneError(messageFor(mediaErrorKind(err), "microphone"));
        }
      } else {
        if (camRef.current) return;
        try {
          const fresh = await acquire(
            "video",
            videoConstraints(prefsRef.current),
            videoConstraints({ ...prefsRef.current, videoDeviceId: null }),
          );
          setCam(fresh.getVideoTracks()[0] ?? null);
          setCameraError(null);
        } catch (err) {
          setCameraError(messageFor(mediaErrorKind(err), "camera"));
        }
      }
    },
    [setAudio, setCam],
  );

  const dismissScreenShareError = useCallback(
    () => setScreenShareError(null),
    [],
  );

  /** Stop every local track immediately (used when a room can't be entered). */
  const stopAll = useCallback(() => {
    audioRef.current?.stop();
    camRef.current?.stop();
    screenRef.current?.stop();
    screenAudioRef.current?.stop();
    strongRef.current?.stop();
    audioRef.current = null;
    camRef.current = null;
    screenRef.current = null;
    screenAudioRef.current = null;
    strongRef.current = null;
    setAudioTrack(null);
    setCamTrack(null);
    setScreenTrack(null);
    setScreenAudio(null);
    setShareMix(null);
    setStrongTrack(null);
    setVideoOverrideState(null);
  }, []);

  return {
    previewStream,
    outgoing,
    micOn,
    camOn,
    sharing,
    starting,
    started,
    cameraError,
    microphoneError,
    screenShareError,
    dismissScreenShareError,
    stopAll,
    toggleMic,
    toggleCam,
    startScreenShare,
    stopScreenShare,
    retryDevice,
    /** Raw sources (for meters/effects) and the wire overrides. */
    cameraSource: camTrack,
    microphoneSource: audioTrack,
    setVideoOverride,
    /** Persisted device + noise preferences. */
    prefs,
    selectMicrophone,
    selectCamera,
    setNoiseLevel,
    setSpeaker,
  };
}

export type LocalMedia = ReturnType<typeof useLocalMedia>;
