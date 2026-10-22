import {
  VideoEffectsProcessor,
  effectSettingsActive,
  isNeutralAdjustments,
  loadSegmentation,
  supportsCanvasCapture,
  supportsCanvasFilter,
  type EffectSettings,
} from "@/lib/effects/videoEffects";
import { loadJson, saveJson } from "@/lib/prefs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Camera effects for one room mount.
 *
 * The processor is started only while an effect is active; its canvas track
 * is handed to the media layer, which swaps it onto the existing sender with
 * `replaceTrack` — no renegotiation, no stream churn for the remote side.
 * Settings changes while active are applied live (no restart at all).
 */

const PREFS_KEY = "effects";

const DEFAULT_SETTINGS: EffectSettings = {
  mode: "off",
  blurStrength: 0.55,
  backgroundSrc: null,
  adjustments: { brightness: 1, contrast: 1, saturation: 1 },
};

export function useVideoEffects(source: MediaStreamTrack | null) {
  const [settings, setSettingsState] = useState<EffectSettings>(() =>
    loadJson(PREFS_KEY, DEFAULT_SETTINGS),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);

  const processorRef = useRef<VideoEffectsProcessor | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const capabilities = useMemo(
    () => ({
      capture: supportsCanvasCapture(),
      filter: supportsCanvasFilter(),
      segmentation: "available" as "available" | "unavailable",
    }),
    [],
  );

  const active = effectSettingsActive(settings) && capabilities.capture;

  /** Start/stop the processor when processing becomes needed or unneeded. */
  useEffect(() => {
    if (!source || !active) {
      setTrack(null);
      return;
    }
    const processor = new VideoEffectsProcessor({
      settings: settingsRef.current,
      onNotice: (message) => setNotice(message),
      // The processor publishes its track only after the first painted
      // frame; until then track is null and the raw camera stays on the
      // wire — receivers never see a blank canvas.
      onFirstFrame: () => setTrack(processor.track),
    });
    processor.start(source);
    processorRef.current = processor;
    setTrack(processor.track);
    return () => {
      processor.stop();
      if (processorRef.current === processor) processorRef.current = null;
      setTrack(null);
    };
  }, [source, active]);

  /** Live settings: applied without restarting the pipeline. */
  useEffect(() => {
    processorRef.current?.setSettings(settings);
    saveJson(PREFS_KEY, settings);
  }, [settings]);

  const setSettings = useCallback(
    (patch: Partial<EffectSettings> | ((current: EffectSettings) => EffectSettings)) => {
      setSettingsState((current) =>
        typeof patch === "function" ? patch(current) : { ...current, ...patch },
      );
    },
    [],
  );

  /** Turn everything off but keep the tuning the user chose. */
  const clearEffects = useCallback(() => {
    setSettingsState((current) => ({ ...current, mode: "off" }));
  }, []);

  const adjustmentsNeutral = isNeutralAdjustments(settings.adjustments);

  return {
    settings,
    setSettings,
    clearEffects,
    track,
    active,
    notice,
    clearNotice: () => setNotice(null),
    capabilities,
    adjustmentsNeutral,
    /** Ask the loader up-front so the panel can show availability honestly. */
    probeSegmentation: () =>
      loadSegmentation().then(
        () => true,
        () => false,
      ),
  };
}
