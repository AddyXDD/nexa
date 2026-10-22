/**
 * ICE configuration for RTCPeerConnection.
 *
 * Defaults to Google's public STUN servers (discovery only — STUN cannot
 * relay media). Production deployments should add a TURN server via the
 * VITE_ICE_SERVERS env var for restrictive NATs, e.g.:
 *
 *   VITE_ICE_SERVERS=[{"urls":"turn:turn.example.com:3478","username":"…","credential":"…"}]
 */

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];

export function getIceServers(): RTCIceServer[] {
  const raw = import.meta.env.VITE_ICE_SERVERS as string | undefined;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as RTCIceServer[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      console.warn("[nexa:webrtc] VITE_ICE_SERVERS is not valid JSON — using STUN defaults");
    }
  }
  return DEFAULT_ICE_SERVERS;
}
