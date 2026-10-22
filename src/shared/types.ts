/**
 * Client-facing types for Nexa.
 *
 * These describe exactly what the server exposes to participants:
 * Nexa IDs and display names only — never emails, never Convex IDs.
 */

export type MediaState = {
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
};

export type Participant = MediaState & {
  /** Session-scoped handle, unique per tab/session. Not an account ID. */
  sessionId: string;
  nexaId: string;
  displayName: string | null;
  joinedAt: number;
  /** True for the session that created the room (host badge in the roster). */
  isHost: boolean;
};

export type MeetingInfo = {
  code: string;
  createdAt: number;
  participantCount: number;
};

/**
 * "everyone" is the room transcript. "dm" is a one-to-one conversation that
 * only the two participants can read — the server keeps it in a separate
 * index so a direct message can never be served to the room.
 */
export type ChatScope = "everyone" | "dm";

export type ChatMessage = {
  id: string;
  sessionId: string;
  nexaId: string;
  displayName: string | null;
  text: string;
  sentAt: number;
  scope: ChatScope;
  /** Direct messages only — who it was addressed to. */
  toSessionId?: string;
  toNexaId?: string;
  toDisplayName?: string;
};

/** Someone you have a direct-message thread with. */
export type DirectPeer = {
  sessionId: string;
  nexaId: string;
  displayName: string | null;
  lastSentAt: number;
  /** Still holds a seat in the room (false once they've left). */
  inRoom: boolean;
};

/**
 * Signalling envelope. Payload is a JSON string so SDP/candidate blobs stay
 * opaque to the server — the server validates routing, not media semantics.
 * `reaction` rides the same ephemeral transport: short JSON, consumed like
 * any other signal, never stored anywhere else.
 */
export type SignalKind =
  | "offer"
  | "answer"
  | "candidate"
  | "renegotiate"
  | "reaction"
  /** E2EE public key announcement — additive; rides the same relay. */
  | "e2ee";

export type SignalEnvelope = {
  id: string;
  kind: SignalKind;
  fromSessionId: string;
  toSessionId: string;
  payload: string;
  createdAt: number;
};

export type SdpPayload = { type: RTCSdpType; sdp: string };

/** Per-peer UI state derived from RTCPeerConnection events. */
export type PeerStatus =
  | "new"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "closed";

export type MediaErrorKind =
  | "blocked"
  | "not-found"
  | "insecure"
  | "in-use"
  | "unknown";

export type MediaError = { kind: MediaErrorKind; device: "camera" | "microphone" };
