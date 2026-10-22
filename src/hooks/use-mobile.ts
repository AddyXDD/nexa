import * as React from "react"

const MOBILE_BREAKPOINT = 768

const DESKTOP_QUERY = `(min-width: ${MOBILE_BREAKPOINT}px)`

function subscribeToDesktop(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const mql = window.matchMedia(DESKTOP_QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function desktopSnapshot(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia(DESKTOP_QUERY).matches
}

/**
 * True only on a viewport at least `MOBILE_BREAKPOINT` wide.
 *
 * Read through `useSyncExternalStore` rather than an effect because the
 * usual `useState` + `useEffect` pairing cannot know the width until after
 * the first paint, so it answers `false` on every device for one frame.
 * That is harmless for "shrink this when small", but it makes a control
 * meant for desktop only flash in on phones before hiding again.
 */
export function useIsDesktopViewport(): boolean {
  return React.useSyncExternalStore(
    subscribeToDesktop,
    desktopSnapshot,
    desktopSnapshot,
  )
}

/** True below `MOBILE_BREAKPOINT`. The exact inverse of `useIsDesktopViewport`. */
export function useIsMobile(): boolean {
  return !useIsDesktopViewport()
}
