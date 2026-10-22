/**
 * The contract between the Electron main process and the Nexa renderer.
 *
 * Kept dependency-free and framework-free on purpose: this file is imported
 * by the main process, by the preload bridge, and (type-only) by the web
 * app. If it ever reaches for `electron`, the split between the trusted
 * main process and the sandboxed renderer is gone.
 */

/** OS protocol the app registers, e.g. `nexameet://join/ABCD`. */
export const APP_SCHEME = "nexameet";

/**
 * Custom protocol the built web app is served over.
 *
 * Not `file://`: the renderer needs a real origin to get a secure context
 * (camera, microphone and service workers all refuse otherwise), and a
 * custom standard scheme gives us one without standing up a local server.
 */
export const APP_PROTOCOL = "nexa";

/** IPC channel names. Namespaced so nothing collides with the web app. */
export const CHANNEL = {
  deepLink: "nexa:deep-link",
  openExternal: "nexa:open-external",
  appInfo: "nexa:app-info",
  setLaunchOnLogin: "nexa:launch-on-login",
  badge: "nexa:badge",
} as const;

/** What a `nexameet://` URL is asking us to do. */
export type DeepLink =
  | { kind: "start" }
  | { kind: "join"; code: string }
  | { kind: "unknown"; raw: string };

export type AppInfo = {
  /** True only inside the desktop shell — the web app branches on this. */
  desktop: true;
  platform: "darwin" | "win32" | "linux" | "other";
  version: string;
  electron: string;
};

/** The API exposed on `window.nexaDesktop` by the preload bridge. */
export type DesktopApi = {
  getAppInfo(): Promise<AppInfo>;
  openExternal(url: string): Promise<void>;
  setLaunchOnLogin(enabled: boolean): Promise<boolean>;
  /** Called once on load, and again for every link clicked while running. */
  onDeepLink(handler: (link: DeepLink) => void): () => void;
};

/**
 * `nexameet://start` · `nexameet://join/ABCD-1234` ·
 * `nexameet://join?code=ABCD`
 *
 * Deliberately forgiving: the meeting code is validated by the app itself
 * (it owns the canonical format), so this only has to find it in the URL
 * and hand it over. Anything unrecognised comes back as `unknown` rather
 * than throwing, because a malformed link should never crash the launcher.
 */
export function parseDeepLink(raw: string): DeepLink {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "unknown", raw };
  }
  if (url.protocol !== `${APP_SCHEME}:`) return { kind: "unknown", raw };

  const verb = (url.hostname || url.pathname.replace(/^\/+/, "").split("/")[0] || "")
    .toLowerCase()
    .trim();

  if (verb === "start" || verb === "new" || verb === "newmeeting") {
    return { kind: "start" };
  }

  if (verb === "join") {
    const fromPath = url.pathname
      .replace(/^\/+/, "")
      .split("/")
      .slice(1)
      .join("/")
      .trim();
    const code = (fromPath || url.searchParams.get("code") || "").trim();
    if (code) return { kind: "join", code };
  }

  return { kind: "unknown", raw };
}

/**
 * Deep links waiting for a window to exist. The OS can hand us a link
 * before the app has finished launching (macOS especially), so it is held
 * here and flushed once the renderer announces itself.
 */
let queued: DeepLink | null = null;

export function queueDeepLink(link: DeepLink): void {
  queued = link;
}

export function takeQueuedDeepLink(): DeepLink | null {
  const link = queued;
  queued = null;
  return link;
}