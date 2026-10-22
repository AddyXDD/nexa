import { loadJson, saveJson } from "@/lib/prefs";
import { useEffect, useMemo, useState } from "react";

/**
 * Appearance and behaviour preferences (persisted — they are device
 * preferences, never meeting data): theme, motion, self-view mirror,
 * picture-in-picture-on-blur, and speaker-activity hints.
 *
 * The meeting is dark-first: "dark" is the default, "system" follows the
 * OS, and "light" is available for people who want the chrome to match the
 * rest of the app.
 */

export type ThemeChoice = "dark" | "light" | "system";
export type MotionChoice = "system" | "reduced";
/**
 * Participant composition: "auto" is the wall, "sidebar" is a stage with a
 * filmstrip of everyone else beneath it, "spotlight" shows the stage alone
 * (pinned, else active speaker). A pin always wins and forces the stage view
 * for that person — per device, never per meeting.
 */
export type LayoutChoice = "auto" | "sidebar" | "spotlight";

export type UiPrefs = {
  theme: ThemeChoice;
  motion: MotionChoice;
  mirrorSelfView: boolean;
  pipOnHide: boolean;
  speakerActivity: boolean;
  layout: LayoutChoice;
};

const DEFAULT_PREFS: UiPrefs = {
  theme: "dark",
  motion: "system",
  mirrorSelfView: true,
  pipOnHide: false,
  speakerActivity: true,
  layout: "auto",
};

const PREFS_KEY = "ui";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useUiPrefs() {
  const [prefs, setPrefsState] = useState<UiPrefs>(() =>
    loadJson(PREFS_KEY, DEFAULT_PREFS),
  );
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  // Follow the OS colour scheme while the choice is "system".
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const dark =
    prefs.theme === "dark" ||
    (prefs.theme === "system" && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const reduced =
    prefs.motion === "reduced" ||
    (prefs.motion === "system" && prefersReducedMotion());

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);

  const setPrefs = useMemo(
    () => (patch: Partial<UiPrefs>) => {
      setPrefsState((current) => {
        const next = { ...current, ...patch };
        saveJson(PREFS_KEY, next);
        return next;
      });
    },
    [],
  );

  /** Short framer-motion/CSS transition honouring the reduced-motion choice. */
  const motion = useMemo(
    () =>
      reduced
        ? { duration: 0 }
        : { duration: 0.16, ease: "easeOut" as const },
    [reduced],
  );

  return { prefs, setPrefs, dark, reduced, motion };
}
