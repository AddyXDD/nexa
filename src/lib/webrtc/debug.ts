/**
 * Debug switch.
 *
 * Logs are normally compiled out of production builds, which leaves the
 * deployed app impossible to diagnose — everything looks the same whether
 * ICE is failing, the transform is eating frames, or a peer simply never
 * signalled. This turns the same instrumentation on in production when
 * it's asked for:
 *
 *   https://your-app/m/CODE?debug=1     (this device)
 *   localStorage.setItem("nexa.debug", "1")   (sticky, every device you set it on)
 *
 * It only ever adds logging and a small overlay — no call behaviour changes.
 */
export function debugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    const flag = new URLSearchParams(window.location.search).get("debug");
    if (flag === "1" || flag === "true") return true;
    return window.localStorage.getItem("nexa.debug") === "1";
  } catch {
    /* private mode or blocked storage — dev flag only */
    return false;
  }
}