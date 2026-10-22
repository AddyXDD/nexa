import { useEffect, useRef } from "react";

/**
 * Everything the web app needs from the desktop shell.
 *
 * In a browser `window.nexaDesktop` is simply absent, so every path here
 * returns early and the app behaves exactly as it always has. Inside
 * Electron it does three things a tab cannot:
 *
 *  - turns OS deep links (`nexameet://start`, `nexameet://join/CODE`)
 *    into ordinary app intents, including from a cold start where the link
 *    arrived before this component mounted;
 *  - hands outbound links to the user's real browser instead of trying to
 *    navigate the app window off-origin;
 *  - toggles "open at login" through the OS rather than the browser.
 */

/** True when running inside the Electron shell. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.nexaDesktop !== undefined;
}

export type DesktopIntents = {
  /** `nexameet://start` or the tray's "New meeting". */
  onStart?: () => void;
  /** `nexameet://join/CODE` — the code is unvalidated; the app owns that. */
  onJoin?: (code: string) => void;
  /**
   * The tray's "Join with code…", and any link we couldn't interpret.
   * Focuses whatever code field the current screen already has.
   */
  onPromptJoin?: () => void;
};

/**
 * Wire the desktop intents to this screen.
 *
 * Runs on every render by design: the handlers are expected to be cheap
 * and stable in practice, and re-subscribing avoids an effect that
 * depends on a growing list of callbacks.
 */
export function useDesktopBridge(intents: DesktopIntents): void {
  // The latest intents, held in a ref so the subscription can be created
  // once and still call today's handlers. Writing it in an effect (rather
  // than during render) keeps this free of render-time side effects.
  const latest = useRef(intents);
  useEffect(() => {
    latest.current = intents;
  });

  useEffect(() => {
    const desktop = window.nexaDesktop;
    if (desktop === undefined) return;

    return desktop.onDeepLink((link) => {
      const current = latest.current;
      if (link.kind === "start") {
        current.onStart?.();
        return;
      }
      if (link.kind === "join") {
        current.onJoin?.(link.code);
        return;
      }
      current.onPromptJoin?.();
    });
  }, []);
}

/**
 * Send outbound links to the real browser.
 *
 * Mounted once, app-wide. In a browser this never fires, so the usual
 * anchor behaviour is untouched.
 */
export function useExternalLinks(): void {
  useEffect(() => {
    const desktop = window.nexaDesktop;
    if (desktop === undefined) return;

    const onClick = (event: MouseEvent) => {
      // Modified clicks are explicit browser intent; leave them alone.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (anchor === null || anchor === undefined) return;

      const href = anchor.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return;
      // Already leaving? Let the shell's own handler take it.
      if (anchor.getAttribute("target") === "_blank") return;

      event.preventDefault();
      void desktop.openExternal(href);
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

/** Ask the OS to start the app when the user logs in. */
export function setLaunchOnLogin(enabled: boolean): Promise<boolean> {
  return window.nexaDesktop?.setLaunchOnLogin(enabled) ?? Promise.resolve(false);
}