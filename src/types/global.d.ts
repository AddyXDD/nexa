declare global {
  interface Window {
    /**
     * Navigate to the auth page with a custom redirect URL
     * @param redirectUrl - URL to redirect to after successful authentication
     */
    navigateToAuth: (redirectUrl: string) => void;

    /**
     * Present only in the Electron shell, injected by desktop/preload.ts.
     *
     * Typed structurally rather than imported from `desktop/shared.ts`, so
     * the web app still compiles if the desktop folder is deleted — the
     * browser build must never depend on it. Keep the two in step.
     */
    nexaDesktop?: {
      getAppInfo(): Promise<{
        desktop: true;
        platform: "darwin" | "win32" | "linux" | "other";
        version: string;
        electron: string;
      }>;
      openExternal(url: string): Promise<void>;
      setLaunchOnLogin(enabled: boolean): Promise<boolean>;
      onDeepLink(handler: (link: DesktopDeepLink) => void): () => void;
    };
  }

  /** What a `nexameet://` URL is asking the app to do. */
  type DesktopDeepLink =
    | { kind: "start" }
    | { kind: "join"; code: string }
    | { kind: "unknown"; raw: string };
}

export {};