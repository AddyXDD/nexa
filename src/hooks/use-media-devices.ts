import { useEffect, useState } from "react";

/**
 * Enumerate media devices for the settings and pre-join selectors.
 * Labels only appear once permission is granted — that's the browser's
 * rule, not ours. Refreshes on the hardware `devicechange` event.
 */
export function useMediaDevices() {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setInputs(devices.filter((device) => device.kind === "audioinput"));
        setCameras(devices.filter((device) => device.kind === "videoinput"));
        setOutputs(devices.filter((device) => device.kind === "audiooutput"));
      } catch {
        /* enumeration blocked — selectors fall back to defaults */
      }
    };

    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  return { inputs, cameras, outputs };
}

/** Device label, falling back to a stable generic name before permission. */
export function deviceLabel(device: MediaDeviceInfo, index: number): string {
  return device.label || `Device ${index + 1}`;
}
