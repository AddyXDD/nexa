import {
  PEER_DISCONNECT_GRACE_MS,
  PEER_REBUILD_BACKOFF_MS,
} from "@/shared/constants";
import type { PeerStatus, SignalKind } from "@/shared/types";
import { getIceServers } from "./ice";
import { log, payloadSummary } from "./logger";
import { E2eeSession, FrameTransform, e2eeEnabled, e2eeSupport, type E2eeSupport } from "./e2ee";
import { selfTest, type FrameKeys } from "./e2ee-crypto";

/**
 * PeerManager — the WebRTC layer, deliberately free of React.
 *
 * Topology: full mesh. Every pair of sessions gets one RTCPeerConnection.
 * Role assignment is deterministic (lexicographically smaller sessionId is
 * always the offerer), so there is no offer glare.
 *
 * Negotiation carries a per-session `gen` counter: each new offer from the
 * offerer increments it, answers echo it, and stale offers/answers from an
 * earlier generation are ignored. That makes rebuild races converge instead
 * of cross-wiring two generations of SDP.
 *
 * Media track changes (mute, camera on/off, screen share) never renegotiate:
 * each connection owns one audio and one video sender created up front, and
 * track swaps happen with replaceTrack(). The exception is a kind that was
 * not in the SDP when the pair last negotiated (device off at connect time)
 * — its SSRC was never signalled, so replaceTrack alone sends nothing. That
 * is repaired by a late renegotiation *owned by the side that has the
 * track*: the deterministic offerer rebuilds and re-offers, the answering
 * side creates the offer itself so its track lands in SDP it authors.
 */

export type LocalTracks = {
  audio: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
};

export type PeerState = {
  status: PeerStatus;
  stream: MediaStream | null;
  hasAudio: boolean;
  hasVideo: boolean;
  /**
   * Media encryption state for this link:
   *  - `on`      both ends hold each other's keys; frames are sealed
   *  - `pending` keys are being exchanged
   *  - `off`     this browser can't encrypt, or the peer can't
   */
  e2ee?: E2eeLinkState;
};

/** Per-link end-to-end encryption status. */
export type E2eeLinkState = "on" | "pending" | "off";

/**
 * A live snapshot of one connection, for the ?debug=1 overlay.
 *
 * Everything here is something that actually explains a bad call: ICE
 * state, which candidate types were gathered (host / srflx / relay), the
 * pair that was chosen, and whether bytes or frames are actually moving.
 */
export type PeerDiagnostics = {
  sessionId: string;
  connection: string;
  ice: string;
  gathering: string;
  signaling: string;
  /** Candidate types gathered, e.g. "host:2 srflx:1". */
  localCandidates: string;
  remoteCandidates: string;
  /** The pair in use, e.g. "srflx ↔ srflx"; "none" before one is selected. */
  pair: string;
  bytesSent: number;
  bytesReceived: number;
  framesSent: number;
  framesDecoded: number;
  e2ee: E2eeLinkState;
};

export type IncomingSignal = {
  id: string;
  kind: SignalKind;
  fromSessionId: string;
  payload: string;
};

type Peer = {
  sessionId: string;
  pc: RTCPeerConnection;
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
  stream: MediaStream;
  negotiated: boolean;
  /** Local kinds present in the last offer/answer I created (null = none yet). */
  negotiatedKinds: { audio: boolean; video: boolean } | null;
  status: PeerStatus;
  graceTimer: ReturnType<typeof setTimeout> | null;
  offerTimer: ReturnType<typeof setTimeout> | null;
  renegTimer: ReturnType<typeof setTimeout> | null;
  /* --- end-to-end encryption (additive; unrelated to negotiation) --- */
  /** Frame transforms installed on this link: both senders, both receivers. */
  e2eeTransforms: FrameTransform[];
  /** Keys are in: media on this link is sealed. */
  e2eeReady: boolean;
  /** Set when this link deliberately runs without encryption. */
  e2eeDisabled: boolean;
  /** Gives up waiting for a peer's E2EE announcement (legacy clients). */
  e2eeTimer: ReturnType<typeof setTimeout> | null;
  /** Watches for media that never arrives through a broken transform. */
  e2eeMediaTimer: ReturnType<typeof setTimeout> | null;
};

type Options = {
  sessionId: string;
  send: (toSessionId: string, kind: SignalKind, payload: string) => void;
  onChange: (sessionId: string, state: PeerState) => void;
};

const MAX_BUFFERED_CANDIDATES = 100;

/**
 * Quality profile: a generous ceiling plus a keep-resolution bias, so the
 * encoder spends bits on sharpness instead of silently downgrading to a
 * potato under mild bandwidth pressure. The ceiling is only a ceiling —
 * the network sampler below resizes the actual budget to what the link
 * can genuinely carry, shrinking fast on congestion (so video never
 * freezes) and growing back slowly once the link stays healthy.
 */
const VIDEO_MAX_BITRATE = 5_000_000; // 5 Mbps — ceiling, not a target
/** Floor when the link is genuinely bad: small but moving beats big and frozen. */
const VIDEO_MIN_BITRATE = 300_000;

/**
 * Cap the remote jitter buffer instead of letting it grow adaptively:
 * shorter buffer = noticeably lower glass-to-glass latency at the cost of
 * the occasional glitch on a jittery link. While a link is congested the
 * cap is released (null = browser default, adaptive) — a fixed short
 * buffer on a bad network drops frames and freezes the picture.
 */
const JITTER_BUFFER_TARGET_MS = 50;

/** How often each connection's health is sampled for the bitrate budget. */
const NET_POLL_MS = 2_500;
/** Healthy samples in a row required before the budget starts climbing. */
const NET_RECOVERY_SAMPLES = 4;

type NetProbe = {
  /** Current video bitrate budget (bits/s). */
  target: number;
  /** The link is genuinely congested right now. */
  congested: boolean;
  packetsSent: number;
  packetsLost: number;
  healthyStreak: number;
};

/** Pull the congestion signals out of an RTCPeerConnection stats report. */
function readNetworkStats(stats: RTCStatsReport): {
  available: number | null;
  rttMs: number | null;
  packetsSent: number;
  packetsLost: number;
  bandwidthLimited: boolean;
} {
  let available: number | null = null;
  let rttMs: number | null = null;
  let packetsSent = 0;
  let packetsLost = 0;
  let bandwidthLimited = false;
  stats.forEach((report) => {
    if (report.type === "candidate-pair" && report.state === "succeeded") {
      if (
        typeof report.availableOutgoingBitrate === "number" &&
        report.availableOutgoingBitrate > 0
      ) {
        available = report.availableOutgoingBitrate;
      }
      if (typeof report.currentRoundTripTime === "number") {
        rttMs = report.currentRoundTripTime * 1000;
      }
    } else if (report.type === "outbound-rtp" && report.kind === "video") {
      if (typeof report.packetsSent === "number") packetsSent += report.packetsSent;
      if (typeof report.packetsLost === "number") packetsLost += report.packetsLost;
      if (report.qualityLimitationReason === "bandwidth") {
        bandwidthLimited = true;
      }
    }
  });
  return { available, rttMs, packetsSent, packetsLost, bandwidthLimited };
}

/**
 * An offer that never comes back as an answer (lost in signalling, or sent
 * before the seat was confirmed) leaves the pair dead forever, because
 * syncPeers skips peers that already exist. Rebuild and re-offer instead.
 */
const OFFER_UNANSWERED_MS = 6_000;

/**
 * How long a link waits for the peer's E2EE announcement before deciding
 * it can't encrypt. Generous enough for a slow signalling round trip,
 * short enough that a stale client (an older build that never announces)
 * costs a moment of silence instead of a dead call.
 */
const E2EE_ANNOUNCE_TIMEOUT_MS = 5_000;

/**
 * How long a connected link may sit without a single decoded remote frame
 * before we drop E2EE on it. Catches the failure mode a frame transform can
 * have but cannot report: installed cleanly, keys delivered, and then never
 * delivers a frame. Media matters more than the lock icon.
 */
const E2EE_MEDIA_WATCHDOG_MS = 8_000;

/** Delay before re-checking a renegotiation that was requested but unconfirmed. */
const LATE_NEGOTIATION_RETRY_MS = 6_000;

export class PeerManager {
  private readonly sessionId: string;
  private readonly send: Options["send"];
  private readonly onChange: Options["onChange"];

  private readonly peers = new Map<string, Peer>();
  /** Offer generation I last sent per remote session (offerer side). */
  private readonly localGens = new Map<string, number>();
  /** Remote offer generation I last applied (answerer side). */
  private readonly remoteGens = new Map<string, number>();
  /** ICE candidates that arrived before their remote description. */
  private readonly pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private readonly rebuildTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lastRebuildAt = new Map<string, number>();
  /** Per-connection bitrate budget (survives peer rebuilds). */
  private readonly net = new Map<string, NetProbe>();
  private netTimer: ReturnType<typeof setInterval> | null = null;

  /* --- end-to-end encryption (additive; orthogonal to negotiation) --- */

  /** How this browser can encrypt frames, if at all. */
  private readonly e2eeMode: E2eeSupport = e2eeSupport();
  /** Local ECDH identity; resolves to null only if keygen is unavailable. */
  private readonly e2eeBoot: Promise<E2eeSession | null>;
  /** Derived pair keys per peer, once its public key has arrived. */
  private readonly e2eeKeys = new Map<string, FrameKeys>();
  /** Peers we've already announced our capability/key to. */
  private readonly e2eeAnnounced = new Set<string>();
  /** Peers we've already answered with our own announcement (once each). */
  private readonly e2eeReplied = new Set<string>();
  /** Peers that have delivered at least one decoded frame to us. */
  private readonly e2eeMediaSeen = new Set<string>();
  /**
   * Set when a transform refuses to install anywhere. Stops us retrying the
   * same broken path on every later peer in this session.
   */
  private e2eeBroken = false;

  private tracks: LocalTracks = { audio: null, video: null };
  /**
   * Video placeholder that holds the video m-line's SSRC from the first
   * negotiation onward: a kind with no sender at connect time gets no SSRC,
   * and a later replaceTrack() onto a never-signalled m-line sends nothing
   * while the connection looks healthy (one-way media, mystery "white
   * screen" gaps on every camera/effect toggle). The camera is never
   * involved: the stand-in is a painted-black canvas capture.
   *
   * Audio deliberately has NO placeholder. The old one was a track off a
   * shared AudioContext, and that is exactly what broke mobile: browsers
   * start an AudioContext suspended outside a user gesture (iOS never
   * resumes it without one), so the sender's first audio source was a
   * permanently-silent WebAudio node — and swapping it later for the real
   * microphone with replaceTrack() is the swap WebKit and Android Chrome
   * handle worst. Symptom: a healthy connection, video flowing, and no
   * audio at all on phones while desktop is fine. The real microphone is
   * now attached before the first offer (the mesh waits for local media),
   * and a microphone that appears later is repaired by the existing
   * late-renegotiation path rather than by a synthetic track.
   */
  private dummyVideoTrack: MediaStreamTrack | null = null;
  private destroyed = false;

  constructor(options: Options) {
    this.sessionId = options.sessionId;
    this.send = options.send;
    this.onChange = options.onChange;
    this.netTimer = setInterval(() => void this.sampleNetwork(), NET_POLL_MS);
    this.e2eeBoot = E2eeSession.create(this.sessionId);
    // Dev-only proof that the media path really seals frames: a round trip
    // through the exact key derivation and IV construction used on the wire.
    if (import.meta.env.DEV) {
      void selfTest().then((ok) => log.webrtc("e2ee self-test", { pass: ok }));
    }
    log.webrtc("mesh ready", {
      sessionId: this.sessionId,
      e2ee: this.e2eeMode,
    });
  }

  /* ---------------------------------------------------------------- *
   * Local media
   * ---------------------------------------------------------------- */

  /** Swap local tracks into every connection (mute/camera/screen share). */
  setLocalTracks(tracks: LocalTracks) {
    this.tracks = tracks;
    for (const peer of this.peers.values()) {
      void this.safeReplace(peer.audioSender, this.mediaFor("audio"));
      void this.safeReplace(peer.videoSender, this.mediaFor("video"));
      this.requestLateNegotiation(peer);
    }
  }

  /**
   * Real local track for `kind`, or the video placeholder when none is on.
   * Audio has no placeholder on purpose — see `dummyVideoTrack`.
   */
  private mediaFor(kind: "audio" | "video"): MediaStreamTrack | null {
    if (kind === "video") {
      return this.tracks.video ?? this.ensureDummyVideoTrack();
    }
    return this.tracks.audio;
  }

  /** Solid-black canvas track — never the camera; only holds the SSRC. */
  private ensureDummyVideoTrack(): MediaStreamTrack | null {
    if (this.dummyVideoTrack && this.dummyVideoTrack.readyState !== "ended") {
      return this.dummyVideoTrack;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 18;
      canvas.getContext("2d")?.fillRect(0, 0, 32, 18);
      this.dummyVideoTrack = canvas.captureStream(1).getVideoTracks()[0] ?? null;
      return this.dummyVideoTrack;
    } catch {
      return null; // very old browser — falls back to the pre-dummy behaviour
    }
  }

  

  /**
   * Apply the current local tracks to both senders and wait. replaceTrack
   * runs on a queued task: without this, an offer/answer created straight
   * afterwards can advertise m-lines with no SSRC — the remote then
   * receives nothing from us while we happily receive from it (one-way
   * audio/video, connection perfectly healthy).
   */
  private async syncSenders(peer: Peer) {
    await Promise.all([
      this.safeReplace(peer.audioSender, this.mediaFor("audio")),
      this.safeReplace(peer.videoSender, this.mediaFor("video")),
    ]);
  }

  /**
   * A kind that was missing when the pair last negotiated (device off at
   * connect time) can never start flowing through replaceTrack alone — its
   * SSRC was never signalled. Re-offer so both descriptions carry it.
   *
   * The renegotiation is driven by the side that owns the track: as the
   * deterministic offerer I rebuild and re-offer; as the answering side I
   * create the offer myself (see offerFromAnswerer) — asking the other end
   * to re-offer would leave my track to be signalled in *my answer*, which
   * is exactly the case that can silently carry no SSRC.
   */
  private requestLateNegotiation(peer: Peer) {
    if (this.destroyed) return;
    if (peer.renegTimer !== null) return; // one attempt in flight

    const missing =
      peer.negotiatedKinds !== null &&
      ((this.tracks.audio !== null && !peer.negotiatedKinds.audio) ||
        (this.tracks.video !== null && !peer.negotiatedKinds.video));
    const stable = peer.pc.signalingState === "stable";

    if (missing && stable) {
      log.webrtc("late local track — renegotiating", {
        sessionId: peer.sessionId,
      });
      if (this.isOfferer(peer.sessionId)) {
        this.scheduleRebuild(
          peer.sessionId,
          "local track appeared after connect",
        );
      } else {
        void this.offerFromAnswerer(peer);
      }
    }

    // Re-check later: the first negotiation may still be pending or an
    // offer/answer may be in flight — neither is actionable right now, and
    // without this timer a track that appeared in that window would be
    // stranded forever with no renegotiation ever scheduled.
    if (
      (peer.negotiatedKinds === null || missing) &&
      this.peers.get(peer.sessionId) === peer
    ) {
      peer.renegTimer = setTimeout(() => {
        peer.renegTimer = null;
        if (this.destroyed || this.peers.get(peer.sessionId) !== peer) return;
        this.requestLateNegotiation(peer); // re-checks; retries if still missing
      }, LATE_NEGOTIATION_RETRY_MS);
    }
  }

  /**
   * Renegotiate from the answering side: I create the offer so the SDP that
   * carries my track is one I author — its SSRC is then guaranteed to be
   * signalled, whatever my earlier answer did or did not contain.
   */
  private async offerFromAnswerer(peer: Peer) {
    if (this.destroyed || this.peers.get(peer.sessionId) !== peer) return;
    if (peer.pc.signalingState !== "stable") return;
    try {
      await this.sendOffer(peer);
    } catch (err) {
      log.webrtc("self-renegotiation offer failed", {
        sessionId: peer.sessionId,
        reason: err instanceof Error ? err.message : "unknown",
      });
      // Fall back to the old path: ask the deterministic offerer to rebuild.
      this.emit(peer.sessionId, "renegotiate", "{}");
    }
  }

  private async safeReplace(sender: RTCRtpSender, track: MediaStreamTrack | null) {
    try {
      await sender.replaceTrack(track);
    } catch (err) {
      // The connection may be closing — that's fine.
      log.webrtc("replaceTrack skipped", {
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * Roster sync (called whenever presence changes)
   * ---------------------------------------------------------------- */

  syncPeers(remoteSessionIds: string[]) {
    if (this.destroyed) return;
    const wanted = new Set(remoteSessionIds.filter((id) => id !== this.sessionId));

    for (const sessionId of [...this.peers.keys()]) {
      if (!wanted.has(sessionId)) {
        log.webrtc("peer removed (participant left)", { sessionId });
        this.closePeer(sessionId);
      }
    }

    for (const sessionId of wanted) {
      if (this.peers.has(sessionId)) continue;
      const peer = this.ensurePeer(sessionId);
      if (this.isOfferer(sessionId)) {
        void this.negotiate(peer);
      }
    }
  }

  /** Whether my session is the deterministic offerer for this pair. */
  private isOfferer(remoteSessionId: string) {
    return this.sessionId < remoteSessionId;
  }

  /* ---------------------------------------------------------------- *
   * Peer lifecycle
   * ---------------------------------------------------------------- */

  private ensurePeer(sessionId: string): Peer {
    const existing = this.peers.get(sessionId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: getIceServers(),
      iceCandidatePoolSize: 0,
    });

    // Fixed transceivers up front: audio and video always negotiated, so
    // muting / camera-on / screen share are pure replaceTrack() swaps and
    // never require renegotiation.
    const audioTransceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
    const videoTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });

    const peer: Peer = {
      sessionId,
      pc,
      audioSender: audioTransceiver.sender,
      videoSender: videoTransceiver.sender,
      stream: new MediaStream(),
      negotiated: false,
      negotiatedKinds: null,
      status: "new",
      graceTimer: null,
      offerTimer: null,
      renegTimer: null,
      e2eeTransforms: [],
      e2eeReady: false,
      e2eeDisabled: false,
      e2eeTimer: null,
      e2eeMediaTimer: null,
    };
    this.peers.set(sessionId, peer);

    // E2EE goes in before any media can flow, so the very first frame is
    // already covered. The transforms hold frames until keys arrive rather
    // than letting cleartext escape for a few hundred milliseconds.
    this.installE2ee(peer);
    this.scheduleE2eeFallback(peer);
    void this.announceE2ee(sessionId);

    void this.safeReplace(peer.audioSender, this.mediaFor("audio"));
    void this.safeReplace(peer.videoSender, this.mediaFor("video"));

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.emit(sessionId, "candidate", JSON.stringify(event.candidate.toJSON()));
    };

    pc.ontrack = (event) => {
      const track = event.track;
      log.webrtc("remote track received", { sessionId, kind: track.kind });
      // The transform goes on before anything is awaited, but never at the
      // cost of the media itself: the track is registered first so a failed
      // install can't cost this peer its video and audio.
      if (this.e2eeMode !== "unsupported" && !peer.e2eeDisabled) {
        try {
          this.installE2eeOnReceiver(peer, event.receiver);
        } catch (err) {
          this.disableE2ee(peer);
          log.webrtc("e2ee receiver install failed", {
            sessionId,
            reason: err instanceof Error ? err.message : "unknown",
          });
        }
      }
      if (!peer.stream.getTracks().some((t) => t.id === track.id)) {
        peer.stream.addTrack(track);
      }
      track.addEventListener("ended", () => {
        peer.stream.removeTrack(track);
        this.notify(peer);
      });
      // First real media off this link — the watchdog stands down, and the
      // tile stops claiming "Connecting…".
      track.addEventListener("unmute", () => {
        this.e2eeMediaSeen.add(sessionId);
        this.notify(peer);
      });
      this.notify(peer);
    };

    pc.onconnectionstatechange = () => {
      if (this.peers.get(sessionId) !== peer) return;
      const state = pc.connectionState;
      log.webrtc("connection state", { sessionId, state });

      if (state === "connected") {
        this.clearGrace(peer);
        this.cancelRebuild(sessionId);
        // Report first: encoder tuning below is best-effort and must never
        // delay the room learning the call is up.
        this.notify(peer, "connected");
        this.applyQualityProfile(peer);
        this.startE2eeMediaWatchdog(peer);
      } else if (state === "connecting") {
        this.notify(peer, "connecting");
      } else if (state === "disconnected") {
        this.notify(peer, "reconnecting");
        this.startGrace(peer);
      } else if (state === "failed") {
        this.notify(peer, "failed");
        this.scheduleRebuild(sessionId, "connection failed");
      } else if (state === "closed") {
        this.notify(peer, "closed");
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (this.peers.get(sessionId) !== peer) return;
      log.webrtc("ICE state", { sessionId, state: pc.iceConnectionState });
    };

    log.webrtc("peer connection created", {
      sessionId,
      offerer: this.isOfferer(sessionId),
    });
    this.notify(peer, "new");
    return peer;
  }

  private async negotiate(peer: Peer) {
    if (this.destroyed || peer.negotiated) return;
    if (this.peers.get(peer.sessionId) !== peer) return;
    peer.negotiated = true;
    try {
      await this.sendOffer(peer);
    } catch (err) {
      peer.negotiated = false;
      log.webrtc("offer failed", {
        sessionId: peer.sessionId,
        reason: err instanceof Error ? err.message : "unknown",
      });
      this.scheduleRebuild(peer.sessionId, "offer failed");
    }
  }

  /** Create and send an offer for this peer (connect time and later re-offers). */
  private async sendOffer(peer: Peer) {
    if (this.destroyed || this.peers.get(peer.sessionId) !== peer) return;
    if (peer.pc.signalingState !== "stable") {
      throw new Error("signaling not stable");
    }
    // SDP must see the live tracks — see syncSenders().
    await this.syncSenders(peer);
    const gen = (this.localGens.get(peer.sessionId) ?? 0) + 1;
    this.localGens.set(peer.sessionId, gen);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    const sdp = peer.pc.localDescription?.sdp;
    if (!sdp) throw new Error("no local description");
    this.applyNegotiatedKinds(peer, sdp);
    this.emit(peer.sessionId, "offer", JSON.stringify({ type: "offer", sdp, gen }));
    log.signaling("offer sent", {
      to: peer.sessionId,
      gen,
      bytes: sdp.length,
    });
    this.notify(peer, "connecting");
    this.armOfferWatchdog(peer);
  }

  /**
   * Record which kinds carry an a=ssrc in the description I just created.
   * With the placeholder tracks attached both kinds are always present, so
   * mute/camera/effect toggles stay pure replaceTrack swaps. If a browser
   * ever omits a kind I am sending, report it as un-negotiated so
   * requestLateNegotiation re-offers with it instead of silently sending
   * nothing forever.
   */
  private applyNegotiatedKinds(peer: Peer, sdp: string) {
    peer.negotiatedKinds = {
      audio: this.sdpCarriesKind(sdp, "audio"),
      video: this.sdpCarriesKind(sdp, "video"),
    };
  }

  /**
   * Net optimiser: sample what each link can genuinely carry and size the
   * video budget to it. Congestion (loss, a low availableOutgoingBitrate,
   * high RTT, or the encoder itself reporting bandwidth-limitation) shrinks
   * the budget immediately — a smaller, moving picture instead of a big,
   * frozen one; a healthy link for a few seconds starts climbing back to
   * the ceiling. The jitter-buffer cap is released while a link is rocky.
   */
  private async sampleNetwork() {
    if (this.destroyed) return;
    for (const peer of [...this.peers.values()]) {
      if (peer.pc.connectionState !== "connected") {
        // Still worth asking whether media says otherwise: a missed state
        // event should not strand a working call on "Connecting…".
        const before = peer.status;
        this.syncStatus(peer);
        if (peer.status !== before) this.notify(peer);
        continue;
      }
      try {
        const stats = await peer.pc.getStats();
        if (this.destroyed || this.peers.get(peer.sessionId) !== peer) continue;
        this.judgeNetwork(peer, stats);
      } catch {
        /* stats unavailable — try again next tick */
      }
    }
  }

  private judgeNetwork(peer: Peer, stats: RTCStatsReport) {
    const reading = readNetworkStats(stats);
    const probe = this.net.get(peer.sessionId) ?? {
      target: VIDEO_MAX_BITRATE,
      congested: false,
      packetsSent: 0,
      packetsLost: 0,
      healthyStreak: 0,
    };
    this.net.set(peer.sessionId, probe);

    const sentDelta = reading.packetsSent - probe.packetsSent;
    const lostDelta = reading.packetsLost - probe.packetsLost;
    probe.packetsSent = reading.packetsSent;
    probe.packetsLost = reading.packetsLost;
    const lossRatio = sentDelta > 60 ? Math.max(0, lostDelta) / sentDelta : 0;

    const rttBad = reading.rttMs !== null && reading.rttMs > 400;
    const congested =
      (reading.available !== null && reading.available < probe.target * 0.85) ||
      lossRatio > 0.05 ||
      rttBad ||
      reading.bandwidthLimited;

    if (congested) {
      probe.healthyStreak = 0;
      probe.congested = true;
      let next = probe.target;
      if (reading.available !== null) {
        next = Math.min(next, reading.available * 0.8);
      }
      if (lossRatio > 0.05 || rttBad) {
        next = Math.min(next, probe.target * 0.6);
      }
      if (reading.bandwidthLimited) {
        next = Math.min(next, probe.target * 0.75);
      }
      probe.target = Math.round(Math.max(VIDEO_MIN_BITRATE, next));
      this.applyNetworkState(peer, probe);
      return;
    }

    // Healthy link: restore the low-latency buffer immediately, then let
    // the budget grow after a short clean streak.
    if (probe.congested) {
      probe.congested = false;
      this.applyNetworkState(peer, probe);
    }
    probe.healthyStreak += 1;
    if (
      probe.target < VIDEO_MAX_BITRATE &&
      probe.healthyStreak >= NET_RECOVERY_SAMPLES
    ) {
      probe.healthyStreak = 0;
      probe.target = Math.min(
        VIDEO_MAX_BITRATE,
        Math.round(probe.target * 1.5),
      );
      this.applyNetworkState(peer, probe);
    }
  }

  /** Push the current budget onto the connection (idempotent). */
  private applyNetworkState(peer: Peer, probe: NetProbe) {
    const preference: RTCDegradationPreference =
      probe.target <= 900_000
        ? "maintain-framerate" // tiny budget: keep it moving, not sharp
        : "maintain-resolution"; // healthy: keep the picture sharp
    try {
      const params = peer.videoSender.getParameters();
      if (params.encodings && params.encodings.length > 0) {
        let changed = params.degradationPreference !== preference;
        if (changed) params.degradationPreference = preference;
        for (const encoding of params.encodings) {
          if (encoding.maxBitrate !== probe.target) {
            encoding.maxBitrate = probe.target;
            changed = true;
          }
          const perEncoding = encoding as {
            degradationPreference?: RTCDegradationPreference;
          };
          if (perEncoding.degradationPreference !== preference) {
            perEncoding.degradationPreference = preference;
            changed = true;
          }
        }
        if (changed) void peer.videoSender.setParameters(params);
      }
    } catch {
      /* encoder parameters not editable on this browser — defaults apply */
    }
    try {
      const jitterTarget = probe.congested ? null : JITTER_BUFFER_TARGET_MS;
      for (const receiver of peer.pc.getReceivers()) {
        if (receiver.track?.kind !== "video") continue;
        if (receiver.jitterBufferTarget !== jitterTarget) {
          receiver.jitterBufferTarget = jitterTarget;
        }
      }
    } catch {
      /* unsupported — adaptive jitter buffer stays */
    }
  }

  /**
   * Wire-level quality & latency profile, applied (idempotently) whenever
   * the connection is usable: the current bitrate budget, a keep-resolution
   * bias, and a capped remote jitter buffer for lower glass-to-glass delay.
   */
  private applyQualityProfile(peer: Peer) {
    const probe = this.net.get(peer.sessionId);
    if (probe) {
      this.applyNetworkState(peer, probe);
      return;
    }
    try {
      const params = peer.videoSender.getParameters();
      let changed = false;
      if (params.degradationPreference !== "maintain-resolution") {
        params.degradationPreference = "maintain-resolution";
        changed = true;
      }
      if (params.encodings && params.encodings.length > 0) {
        for (const encoding of params.encodings) {
          if (encoding.maxBitrate !== VIDEO_MAX_BITRATE) {
            encoding.maxBitrate = VIDEO_MAX_BITRATE;
            changed = true;
          }
          // Newer specs put it per-encoding; older Chrome on send params.
          const perEncoding = encoding as {
            degradationPreference?: RTCDegradationPreference;
          };
          if (perEncoding.degradationPreference !== "maintain-resolution") {
            perEncoding.degradationPreference = "maintain-resolution";
            changed = true;
          }
        }
      }
      if (changed) void peer.videoSender.setParameters(params);
    } catch {
      /* encoder parameters not editable on this browser — defaults apply */
    }
    for (const receiver of peer.pc.getReceivers()) {
      if (receiver.track?.kind !== "video") continue;
      try {
        if (receiver.jitterBufferTarget !== JITTER_BUFFER_TARGET_MS) {
          receiver.jitterBufferTarget = JITTER_BUFFER_TARGET_MS;
        }
      } catch {
        /* unsupported — adaptive jitter buffer stays */
      }
    }
  }

  /** Whether my own SDP's section for `kind` declares an a=ssrc line. */
  private sdpCarriesKind(sdp: string, kind: "audio" | "video"): boolean {
    const sections = sdp.split(/^m=/m);
    for (const section of sections) {
      if (section.startsWith(`${kind} `)) return /a=ssrc:/m.test(section);
    }
    return false;
  }

  /** Rebuild and re-offer if this offer never becomes an answer. */
  private armOfferWatchdog(peer: Peer) {
    this.clearOfferWatchdog(peer);
    peer.offerTimer = setTimeout(() => {
      peer.offerTimer = null;
      if (this.destroyed || this.peers.get(peer.sessionId) !== peer) return;
      if (peer.pc.signalingState !== "have-local-offer") return; // answered
      log.webrtc("offer unanswered — rebuilding", {
        sessionId: peer.sessionId,
      });
      this.scheduleRebuild(peer.sessionId, "offer unanswered");
    }, OFFER_UNANSWERED_MS);
  }

  private clearOfferWatchdog(peer: Peer) {
    if (peer.offerTimer !== null) {
      clearTimeout(peer.offerTimer);
      peer.offerTimer = null;
    }
  }

  private clearRenegotiation(peer: Peer) {
    if (peer.renegTimer !== null) {
      clearTimeout(peer.renegTimer);
      peer.renegTimer = null;
    }
  }

  /**
   * Ground truth for "this link works": media is actually arriving.
   *
   * `connectionState` events are the primary signal, but a single missed
   * or reordered event leaves a perfectly good call showing "Connecting…"
   * forever — and the sampler skips non-connected peers, so nothing would
   * ever correct it. A live, unmuted remote track is proof the pipe is up.
   */
  private peerHasLiveMedia(peer: Peer): boolean {
    for (const track of peer.stream.getTracks()) {
      if (track.readyState === "live" && !track.muted) return true;
    }
    return false;
  }

  /** Promote a peer to connected once its media proves it. Never demotes. */
  private syncStatus(peer: Peer) {
    if (peer.status === "connected" || peer.status === "closed") return;
    if (!this.peerHasLiveMedia(peer)) return;
    log.webrtc("status corrected from live media", {
      sessionId: peer.sessionId,
      was: peer.status,
    });
    peer.status = "connected";
  }

  private notify(peer: Peer, status?: PeerStatus) {
    if (this.destroyed) return;
    if (status !== undefined) peer.status = status;
    this.syncStatus(peer);
    const stream = peer.stream;
    this.onChange(peer.sessionId, {
      status: peer.status,
      stream,
      hasAudio: stream.getAudioTracks().length > 0,
      hasVideo: stream.getVideoTracks().length > 0,
      e2ee: this.e2eeState(peer),
    });
  }

  /* ---------------------------------------------------------------- *
   * End-to-end encryption
   *
   * Bolted onto the senders and receivers this mesh already created —
   * nothing about how connections are made changes. Keys come from ECDH
   * with the other participant and travel as an additive `e2ee` signal;
   * the server relays public keys only and never sees a media key.
   * ---------------------------------------------------------------- */

  /** Seal this link's outgoing media (senders were created above). */
  private installE2ee(peer: Peer) {
    if (this.e2eeMode === "unsupported" || this.e2eeBroken) return;
    for (const sender of [peer.audioSender, peer.videoSender]) {
      const transform = new FrameTransform(sender, "encrypt", this.e2eeMode);
      if (transform.failed) {
        // This browser claims it can transform frames but couldn't. Trust
        // the failure over the claim and never touch this path again.
        this.e2eeBroken = true;
        for (const installed of peer.e2eeTransforms) installed.close();
        peer.e2eeTransforms = [];
        this.disableE2ee(peer);
        return;
      }
      peer.e2eeTransforms.push(transform);
      this.keyTransform(peer, transform);
    }
    this.markE2eeReady(peer);
  }

  /** Open this link's incoming media. Called from ontrack, before frames. */
  private installE2eeOnReceiver(peer: Peer, receiver: RTCRtpReceiver) {
    if (this.e2eeMode === "unsupported" || this.e2eeBroken) return;
    const transform = new FrameTransform(receiver, "decrypt", this.e2eeMode);
    if (transform.failed) {
      this.e2eeBroken = true;
      this.disableE2ee(peer);
      return;
    }
    peer.e2eeTransforms.push(transform);
    // Keys often land before the first track does (the announce rides
    // signalling, ontrack rides negotiation) — hand them over here or the
    // receiver would sit holding frames forever.
    this.keyTransform(peer, transform);
    this.markE2eeReady(peer);
  }

  /**
   * Last line of defence: a transform that installs but never delivers a
   * frame can't report itself, so watch for the media that never arrives.
   */
  private startE2eeMediaWatchdog(peer: Peer) {
    if (this.e2eeMode === "unsupported" || this.e2eeBroken) return;
    if (peer.e2eeMediaTimer !== null) return;
    if (peer.e2eeTransforms.length === 0 || peer.e2eeDisabled) return;
    peer.e2eeMediaTimer = setTimeout(() => {
      peer.e2eeMediaTimer = null;
      if (this.destroyed || this.peers.get(peer.sessionId) !== peer) return;
      if (peer.e2eeDisabled || peer.e2eeTransforms.length === 0) return;
      if (this.e2eeMediaSeen.has(peer.sessionId)) return;
      log.webrtc("no media through the transform — dropping e2ee here", {
        sessionId: peer.sessionId,
      });
      this.disableE2ee(peer);
    }, E2EE_MEDIA_WATCHDOG_MS);
  }

  private clearE2eeMediaWatchdog(peer: Peer) {
    if (peer.e2eeMediaTimer === null) return;
    clearTimeout(peer.e2eeMediaTimer);
    peer.e2eeMediaTimer = null;
  }

  /** Give one transform the peer's keys, if they have arrived yet. */
  private keyTransform(peer: Peer, transform: FrameTransform) {
    if (peer.e2eeDisabled) return;
    const keys = this.e2eeKeys.get(peer.sessionId);
    if (keys !== undefined) transform.setKeys(keys);
  }

  /** Hand the peer's keys to every transform on the link. */
  private applyE2eeKeys(peer: Peer) {
    if (peer.e2eeDisabled) return;
    for (const transform of peer.e2eeTransforms) {
      this.keyTransform(peer, transform);
    }
    this.markE2eeReady(peer);
  }

  /** The link is fully keyed once keys exist and no transform was skipped. */
  private markE2eeReady(peer: Peer) {
    if (peer.e2eeReady || peer.e2eeDisabled) return;
    if (this.e2eeMode === "unsupported" || this.e2eeBroken) return;
    // Keys with no transform attached would report "Encrypted" while
    // encrypting nothing.
    if (peer.e2eeTransforms.length === 0) return;
    if (this.e2eeKeys.get(peer.sessionId) === undefined) return;
    peer.e2eeReady = true;
    log.webrtc("e2ee enabled", { sessionId: peer.sessionId });
    this.notify(peer);
  }

  /**
   * Tell one peer what we can do. An incapable peer says so explicitly
   * so the other end stops waiting instead of stalling a call.
   */
  private async announceE2ee(to: string) {
    try {
      // Feature switched off: stay completely silent on the wire, so a
      // disabled build is indistinguishable from one without this feature.
      if (this.destroyed || !e2eeEnabled()) return;
      const announce = (payload: object) => {
        if (this.destroyed) return;
        this.e2eeAnnounced.add(to);
        this.emit(to, "e2ee", JSON.stringify(payload));
      };
      if (this.e2eeMode === "unsupported" || this.e2eeBroken) {
        announce({ support: false });
        return;
      }
      const session = await this.e2eeBoot;
      if (this.destroyed) return;
      if (session === null) {
        announce({ support: false });
        return;
      }
      announce({ support: true, pub: await session.publicKey() });
    } catch (err) {
      // Fire-and-forget: a failed announcement must not reject anywhere it
      // was awaited, and must not stop the peer announcing in reply.
      log.signaling("e2ee announce failed", {
        to,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  /** A peer's E2EE announcement: exchange keys, or agree to run clear. */
  private async handleE2eeAnnounce(from: string, payload: string) {
    try {
      await this.processE2eeAnnounce(from, payload);
    } catch (err) {
      // Signal handlers share one sequential inbox: if this rejects, the
      // offers and answers behind it would never be read and every peer
      // would sit on "Connecting…". Nothing here may escape.
      log.signaling("e2ee announcement handler failed", {
        from,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  private async processE2eeAnnounce(from: string, payload: string) {
    // Nothing to do when this build doesn't ship E2EE: stay inert rather
    // than derive keys and report a lock we aren't honouring.
    if (this.destroyed || !e2eeEnabled() || this.e2eeMode === "unsupported") {
      return;
    }
    let parsed: { support?: unknown; pub?: unknown };
    try {
      parsed = JSON.parse(payload) as { support?: unknown; pub?: unknown };
    } catch {
      log.signaling("e2ee announcement dropped (malformed)", { from });
      return;
    }

    const peer = this.peers.get(from);
    if (peer) this.clearE2eeFallback(peer);

    if (parsed.support === true && typeof parsed.pub === "string") {
      const session = await this.e2eeBoot;
      if (this.destroyed) return;
      if (session === null) {
        // Our own keygen is unavailable: say so rather than leave the peer
        // waiting for keys we can never produce.
        log.webrtc("e2ee keygen unavailable — answering unsupported", { from });
        if (peer) this.disableE2ee(peer);
        void this.announceE2ee(from);
        return;
      }
      try {
        this.e2eeKeys.set(from, await session.deriveKeys(from, parsed.pub));
      } catch (err) {
        log.signaling("e2ee key exchange failed", {
          from,
          reason: err instanceof Error ? err.message : "unknown",
        });
        // Never leave one side sealing what the other can't open.
        if (peer) this.disableE2ee(peer);
        return;
      }
      log.webrtc("e2ee key exchange complete", { from });
      if (peer) this.applyE2eeKeys(peer);
    } else {
      log.webrtc("e2ee unsupported by peer", { from });
      if (peer) this.disableE2ee(peer);
    }

    // Answer once with our own key. An announcement can be dropped when the
    // peer isn't seated yet on our side of the relay, and without this
    // reply one direction would encrypt while the other waited and gave
    // up. Replying exactly once keeps it from becoming a ping-pong.
    if (!this.e2eeReplied.has(from)) {
      this.e2eeReplied.add(from);
      void this.announceE2ee(from);
    }
  }

  /** Run this one link in the clear: transforms go transparent, state says so. */
  private disableE2ee(peer: Peer) {
    if (peer.e2eeReady || peer.e2eeDisabled) return;
    peer.e2eeDisabled = true;
    // `disable` keeps the pipeline attached and simply forwards frames, so
    // media resumes even if the browser refuses to clear the transform.
    for (const transform of peer.e2eeTransforms) transform.disable();
    this.e2eeKeys.delete(peer.sessionId);
    log.webrtc("e2ee off for this link", { sessionId: peer.sessionId });
    this.notify(peer);
  }

  /** Don't hold a call hostage: a peer that never announces runs clear. */
  private scheduleE2eeFallback(peer: Peer) {
    if (this.e2eeMode === "unsupported" || peer.e2eeTimer !== null) return;
    peer.e2eeTimer = setTimeout(() => {
      peer.e2eeTimer = null;
      if (peer.e2eeReady || this.peers.get(peer.sessionId) !== peer) return;
      log.webrtc("e2ee announcement timeout — link unencrypted", {
        sessionId: peer.sessionId,
      });
      this.disableE2ee(peer);
    }, E2EE_ANNOUNCE_TIMEOUT_MS);
  }

  private clearE2eeFallback(peer: Peer) {
    if (peer.e2eeTimer === null) return;
    clearTimeout(peer.e2eeTimer);
    peer.e2eeTimer = null;
  }

  private e2eeState(peer: Peer): E2eeLinkState {
    if (this.e2eeMode === "unsupported" || peer.e2eeDisabled) return "off";
    return peer.e2eeReady ? "on" : "pending";
  }

  /* ---------------------------------------------------------------- *
   * Signalling input
   * ---------------------------------------------------------------- */

  async handleSignal(signal: IncomingSignal) {
    if (this.destroyed) return;
    const from = signal.fromSessionId;
    if (from === this.sessionId) return;

    switch (signal.kind) {
      case "offer":
        await this.handleOffer(from, signal.payload);
        break;
      case "answer":
        await this.handleAnswer(from, signal.payload);
        break;
      case "candidate":
        await this.handleCandidate(from, signal.payload);
        break;
      case "renegotiate":
        // Sent by a peer whose connection died. Only the offerer reacts by
        // rebuilding and re-offering; the answerer already rebuilt locally
        // and is waiting for exactly that offer.
        log.signaling("renegotiate received", { from });
        if (this.isOfferer(from)) {
          this.scheduleRebuild(from, "remote requested renegotiation");
        }
        break;
      case "e2ee":
        // Key material exchange. Never triggers negotiation: the
        // transforms sit on pipelines that already exist.
        await this.handleE2eeAnnounce(from, signal.payload);
        break;
    }
  }

  private async handleOffer(from: string, payload: string) {
    let parsed: { type: RTCSdpType; sdp: string; gen: number };
    try {
      parsed = JSON.parse(payload);
    } catch {
      log.signaling("offer dropped (malformed)", { from });
      return;
    }
    const applied = this.remoteGens.get(from);
    if (applied !== undefined && parsed.gen <= applied) {
      log.signaling("stale offer ignored", { from, gen: parsed.gen, applied });
      return;
    }
    log.signaling("offer received", {
      from,
      gen: parsed.gen,
      bytes: parsed.sdp.length,
    });

    let peer = this.ensurePeer(from);
    if (peer.pc.signalingState !== "stable") {
      // A previous generation is mid-flight — start clean for this offer.
      this.closePeer(from, { keepGenerations: true });
      peer = this.ensurePeer(from);
    }

    try {
      await peer.pc.setRemoteDescription({ type: "offer", sdp: parsed.sdp });
    } catch (err) {
      log.webrtc("setRemoteDescription(offer) failed — recreating peer", {
        sessionId: from,
        reason: err instanceof Error ? err.message : "unknown",
      });
      this.closePeer(from, { keepGenerations: true });
      peer = this.ensurePeer(from);
      await peer.pc.setRemoteDescription({ type: "offer", sdp: parsed.sdp });
    }
    this.remoteGens.set(from, parsed.gen);
    await this.flushCandidates(from, peer);

    try {
      await this.syncSenders(peer); // the answer must describe our tracks
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      const sdp = peer.pc.localDescription?.sdp;
      if (!sdp) throw new Error("no local description");
      this.applyNegotiatedKinds(peer, sdp);
      this.emit(from, "answer", JSON.stringify({ type: "answer", sdp, gen: parsed.gen }));
      log.signaling("answer sent", { to: from, gen: parsed.gen, bytes: sdp.length });
      this.notify(peer, "connecting");
      this.applyQualityProfile(peer);
      this.requestLateNegotiation(peer);
    } catch (err) {
      log.webrtc("answer failed", {
        sessionId: from,
        reason: err instanceof Error ? err.message : "unknown",
      });
      this.scheduleRebuild(from, "answer failed");
    }
  }

  private async handleAnswer(from: string, payload: string) {
    let parsed: { type: RTCSdpType; sdp: string; gen: number };
    try {
      parsed = JSON.parse(payload);
    } catch {
      log.signaling("answer dropped (malformed)", { from });
      return;
    }
    const expected = this.localGens.get(from);
    if (expected === undefined || parsed.gen !== expected) {
      log.signaling("stale answer ignored", { from, gen: parsed.gen, expected });
      return;
    }
    const peer = this.peers.get(from);
    if (!peer) return;
    if (peer.pc.signalingState !== "have-local-offer") {
      log.signaling("answer ignored (unexpected state)", {
        from,
        state: peer.pc.signalingState,
      });
      return;
    }
    try {
      await peer.pc.setRemoteDescription({ type: "answer", sdp: parsed.sdp });
      await this.flushCandidates(from, peer);
      log.signaling("answer received", { from, gen: parsed.gen });
      this.notify(peer, "connecting");
      this.applyQualityProfile(peer);
      this.requestLateNegotiation(peer);
    } catch (err) {
      log.webrtc("setRemoteDescription(answer) failed", {
        sessionId: from,
        reason: err instanceof Error ? err.message : "unknown",
      });
      this.scheduleRebuild(from, "remote description failed");
    }
  }

  private async handleCandidate(from: string, payload: string) {
    let candidate: RTCIceCandidateInit;
    try {
      candidate = JSON.parse(payload);
    } catch {
      return;
    }
    const peer = this.peers.get(from);
    if (peer && peer.pc.remoteDescription) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (err) {
        log.webrtc("ICE candidate rejected (stale generation)", { sessionId: from });
      }
    } else {
      // Arrived before its offer — buffer it (or, if I'm the offerer and have
      // no connection at all, my offer never went out: start it now).
      const buffer = this.pendingCandidates.get(from) ?? [];
      if (buffer.length < MAX_BUFFERED_CANDIDATES) {
        buffer.push(candidate);
        this.pendingCandidates.set(from, buffer);
      }
      if (!peer && this.isOfferer(from)) {
        const fresh = this.ensurePeer(from);
        void this.negotiate(fresh);
      }
    }
  }

  private async flushCandidates(sessionId: string, peer: Peer) {
    const buffered = this.pendingCandidates.get(sessionId);
    if (!buffered || buffered.length === 0) return;
    this.pendingCandidates.delete(sessionId);
    for (const candidate of buffered) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch {
        log.webrtc("buffered ICE candidate discarded", { sessionId });
      }
    }
    log.webrtc("buffered ICE candidates flushed", {
      sessionId,
      count: buffered.length,
    });
  }

  /* ---------------------------------------------------------------- *
   * Failure handling / rebuilds
   * ---------------------------------------------------------------- */

  private startGrace(peer: Peer) {
    if (peer.graceTimer !== null) return;
    peer.graceTimer = setTimeout(() => {
      peer.graceTimer = null;
      if (this.peers.get(peer.sessionId) !== peer) return;
      const state = peer.pc.connectionState;
      if (state === "disconnected" || state === "failed" || state === "closed") {
        this.scheduleRebuild(peer.sessionId, "disconnected too long");
      }
    }, PEER_DISCONNECT_GRACE_MS);
  }

  private clearGrace(peer: Peer) {
    if (peer.graceTimer !== null) {
      clearTimeout(peer.graceTimer);
      peer.graceTimer = null;
    }
  }

  private cancelRebuild(sessionId: string) {
    const timer = this.rebuildTimers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.rebuildTimers.delete(sessionId);
    }
  }

  /**
   * Tear the connection down and build a fresh one. The offerer re-offers;
   * the answerer just waits for that offer (its own rebuild already ran).
   * Backoff prevents a rebuild storm during a network blip.
   */
  private scheduleRebuild(sessionId: string, reason: string) {
    if (this.destroyed) return;
    if (this.rebuildTimers.has(sessionId)) return;
    const last = this.lastRebuildAt.get(sessionId) ?? 0;
    const wait = Math.max(0, PEER_REBUILD_BACKOFF_MS - (Date.now() - last));

    const run = () => {
      this.rebuildTimers.delete(sessionId);
      if (this.destroyed || !this.peers.has(sessionId)) return;
      this.lastRebuildAt.set(sessionId, Date.now());
      log.webrtc("rebuilding peer connection", { sessionId, reason });
      this.closePeer(sessionId, { keepGenerations: true });
      const peer = this.ensurePeer(sessionId);
      if (this.isOfferer(sessionId)) {
        void this.negotiate(peer);
      } else {
        // Tell the offerer to rebuild and re-offer.
        this.emit(sessionId, "renegotiate", "{}");
      }
    };

    if (wait === 0) run();
    else this.rebuildTimers.set(sessionId, setTimeout(run, wait));
  }

  /** Manual health pass — used when the signalling socket reconnects. */
  checkHealth() {
    if (this.destroyed) return;
    for (const peer of this.peers.values()) {
      const state = peer.pc.connectionState;
      if (state === "failed") {
        this.scheduleRebuild(peer.sessionId, "health check: failed");
      } else if (state === "disconnected") {
        this.startGrace(peer);
      } else if (state === "closed") {
        this.scheduleRebuild(peer.sessionId, "health check: closed");
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Cleanup
   * ---------------------------------------------------------------- */

  private closePeer(sessionId: string, opts: { keepGenerations?: boolean } = {}) {
    const peer = this.peers.get(sessionId);
    if (!peer) return;
    this.peers.delete(sessionId);
    this.clearGrace(peer);
    this.clearOfferWatchdog(peer);
    this.clearRenegotiation(peer);
    this.clearE2eeFallback(peer);
    this.clearE2eeMediaWatchdog(peer);
    this.cancelRebuild(sessionId);

    for (const transform of peer.e2eeTransforms) transform.close();
    peer.e2eeTransforms = [];
    this.e2eeKeys.delete(sessionId);
    this.e2eeAnnounced.delete(sessionId);
    this.e2eeReplied.delete(sessionId);
    this.e2eeMediaSeen.delete(sessionId);

    // Detach every listener before closing so no zombie callback can fire.
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.oniceconnectionstatechange = null;
    for (const track of peer.stream.getTracks()) {
      track.stop();
      peer.stream.removeTrack(track);
    }
    try {
      peer.pc.close();
    } catch {
      /* already closed */
    }

    this.onChange(sessionId, {
      status: "closed",
      stream: null,
      hasAudio: false,
      hasVideo: false,
    });
    log.webrtc("peer connection closed", { sessionId });

    if (!opts.keepGenerations) {
      this.localGens.delete(sessionId);
      this.remoteGens.delete(sessionId);
      this.pendingCandidates.delete(sessionId);
      this.lastRebuildAt.delete(sessionId);
    } else {
      // Generations must survive rebuilds so stale SDP stays rejected.
      this.pendingCandidates.delete(sessionId);
    }
  }

  /** Close every connection and stop delivering callbacks. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const sessionId of [...this.peers.keys()]) {
      this.closePeer(sessionId);
    }
    for (const timer of this.rebuildTimers.values()) clearTimeout(timer);
    this.rebuildTimers.clear();
    if (this.netTimer !== null) {
      clearInterval(this.netTimer);
      this.netTimer = null;
    }
    this.net.clear();
    this.pendingCandidates.clear();
    this.e2eeKeys.clear();
    this.e2eeAnnounced.clear();
    this.e2eeReplied.clear();
    this.e2eeMediaSeen.clear();
    void this.e2eeBoot.then((session) => session?.dispose());
    this.localGens.clear();
    this.remoteGens.clear();
    this.dummyVideoTrack?.stop();
    this.dummyVideoTrack = null;
    log.webrtc("mesh destroyed", { sessionId: this.sessionId });
  }

  private emit(to: string, kind: SignalKind, payload: string) {
    if (this.destroyed) return;
    try {
      this.send(to, kind, payload);
      log.signaling(kind === "candidate" ? "ICE candidate sent" : `${kind} sent`, {
        to,
        via: payloadSummary(kind, payload),
      });
    } catch (err) {
      log.signaling("send failed", { to, kind });
    }
  }

  get peerCount() {
    return this.peers.size;
  }

  /** Live per-connection snapshot. Read-only; safe to call at any time. */
  async diagnostics(): Promise<PeerDiagnostics[]> {
    const out: PeerDiagnostics[] = [];
    for (const peer of this.peers.values()) {
      const snapshot: PeerDiagnostics = {
        sessionId: peer.sessionId,
        connection: peer.pc.connectionState,
        ice: peer.pc.iceConnectionState,
        gathering: peer.pc.iceGatheringState,
        signaling: peer.pc.signalingState,
        localCandidates: "-",
        remoteCandidates: "-",
        pair: "none",
        bytesSent: 0,
        bytesReceived: 0,
        framesSent: 0,
        framesDecoded: 0,
        e2ee: this.e2eeState(peer),
      };
      try {
        const stats = await peer.pc.getStats();
        const candidates = new Map<string, string>();
        stats.forEach((report) => {
          const row = report as unknown as Record<string, unknown>;
          if (row.type === "local-candidate" || row.type === "remote-candidate") {
            const id = row.id as string | undefined;
            if (id) candidates.set(id, String(row.candidateType ?? "?"));
          }
        });
        const tally = (kind: "local-candidate" | "remote-candidate") => {
          const counts = new Map<string, number>();
          stats.forEach((report) => {
            const row = report as unknown as Record<string, unknown>;
            if (row.type !== kind) return;
            const type = String(row.candidateType ?? "?");
            counts.set(type, (counts.get(type) ?? 0) + 1);
          });
          const parts = [...counts.entries()].map(([t, n]) => `${t}:${n}`);
          return parts.length > 0 ? parts.join(" ") : "-";
        };
        snapshot.localCandidates = tally("local-candidate");
        snapshot.remoteCandidates = tally("remote-candidate");

        stats.forEach((report) => {
          const row = report as unknown as Record<string, unknown>;
          if (row.type === "candidate-pair") {
            if (row.state === "succeeded" || row.nominated === true) {
              const local = candidates.get(String(row.localCandidateId ?? ""));
              const remote = candidates.get(String(row.remoteCandidateId ?? ""));
              snapshot.pair = `${local ?? "?"} ↔ ${remote ?? "?"}`;
            }
          }
          if (row.type === "outbound-rtp") {
            snapshot.bytesSent += Number(row.bytesSent ?? 0);
            snapshot.framesSent += Number(row.framesEncoded ?? 0);
          }
          if (row.type === "inbound-rtp") {
            snapshot.bytesReceived += Number(row.bytesReceived ?? 0);
            snapshot.framesDecoded += Number(row.framesDecoded ?? 0);
          }
        });
      } catch {
        /* connection already closed mid-read */
      }
      out.push(snapshot);
    }
    return out;
  }
}
