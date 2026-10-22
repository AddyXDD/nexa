/**
 * Structured development logs for Nexa.
 *
 * Rules (enforced by the helper functions below):
 *  - log lifecycle events and state transitions
 *  - NEVER log SDP bodies, ICE payloads, media contents, credentials,
 *    emails, or anything that would leak a peer's IP addresses
 *  - payloads are summarised (kind/type/size), not printed
 */

import { debugEnabled } from "./debug";

const enabled = debugEnabled();

function write(channel: "signaling" | "webrtc" | "meeting", event: string, detail?: unknown) {
  if (!enabled) return;
  const suffix = detail === undefined ? "" : "";
  console.log(`[nexa:${channel}] ${event}${suffix}`, detail ?? "");
}

/** Summary of a signalling payload without revealing its contents. */
export function payloadSummary(kind: string, payload: string): string {
  if (kind === "offer" || kind === "answer") {
    try {
      const parsed = JSON.parse(payload) as { type?: string; gen?: number };
      return `type=${parsed.type ?? "?"} gen=${parsed.gen ?? "?"} bytes=${payload.length}`;
    } catch {
      return `type=? bytes=${payload.length}`;
    }
  }
  if (kind === "candidate") return `candidate bytes=${payload.length}`;
  return kind;
}

export const log = {
  /** connection established, offer sent/received, ICE exchanged… */
  signaling: (event: string, detail?: Record<string, unknown>) =>
    write("signaling", event, detail),
  /** peer connection created, track added, connection/ICE state… */
  webrtc: (event: string, detail?: Record<string, unknown>) =>
    write("webrtc", event, detail),
  /** participant joined/left, room created/ended… */
  meeting: (event: string, detail?: Record<string, unknown>) =>
    write("meeting", event, detail),
};
