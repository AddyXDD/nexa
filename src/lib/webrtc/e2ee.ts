import {
  deriveFrameKeys,
  keyFor,
  sealFrame,
  withData,
  type FrameDirection,
  type FrameKeys,
  type FrameLike,
} from "./e2ee-crypto";
import { log } from "./logger";

/**
 * End-to-end encryption for the peer mesh.
 *
 * Keys come from ECDH (P-256) between the two participants and travel over
 * the existing signalling transport as an additive `e2ee` signal — the
 * server relays public keys only and can never derive a media key. Media
 * is then sealed frame by frame with AES-GCM *before* it leaves the
 * browser, so neither the signalling server nor the network sees a
 * picture or a word.
 *
 * Nothing here changes how connections are made: the transforms are
 * bolted onto the senders and receivers the mesh already created, and if
 * the browser can't do encoded transforms we report that rather than
 * pretending.
 */

/** How this browser can insert frame transforms, if at all. */
export type E2eeSupport = "worker" | "main-thread" | "unsupported";

/**
 * Master switch.
 *
 * OFF right now: the key exchange and status work, but the media path is
 * not yet proven in a real browser — keys install ("Encrypted" in the
 * header) and then no frames come out, which is why meetings show blank
 * tiles. Until that is diagnosed on a device rather than reasoned about,
 * the app ships exactly as it behaved before this feature: no transforms,
 * no key exchange, no signalling. Flip to true to bring it back; the
 * kill switch lives here, in one place, for that reason.
 */
const E2EE_ENABLED = false;

export function e2eeEnabled(): boolean {
  return E2EE_ENABLED;
}

export function e2eeSupport(): E2eeSupport {
  if (!E2EE_ENABLED) return "unsupported";
  // Preferred: the same transform pipeline without a cross-thread hop.
  // The worker path (RTCRtpScriptTransform) is kept for browsers that
  // don't expose the streams API — Safari among them — but nothing about
  // the product depends on it.
  const proto = (globalThis.RTCRtpSender as { prototype?: unknown } | undefined)
    ?.prototype as { createEncodedStreams?: unknown } | undefined;
  if (typeof proto?.createEncodedStreams === "function") return "main-thread";
  if (
    typeof Worker === "function" &&
    typeof globalThis.RTCRtpScriptTransform === "function"
  ) {
    return "worker";
  }
  return "unsupported";
}

/** Uncompressed P-256 point: 0x04 || X(32) || Y(32). */
const EC_PUBLIC_KEY_BYTES = 65;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

/**
 * One participant's E2EE identity for the life of the room: an ECDH key
 * pair generated locally. The private key never leaves the browser and is
 * non-extractable, so no code path can hand it out.
 */
export class E2eeSession {
  private readonly cache = new Map<string, Promise<FrameKeys>>();
  private readonly keyPair: CryptoKeyPair;
  private readonly sessionId: string;

  private constructor(keyPair: CryptoKeyPair, sessionId: string) {
    this.keyPair = keyPair;
    this.sessionId = sessionId;
  }

  static async create(sessionId: string): Promise<E2eeSession | null> {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    try {
      const keyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveBits"],
      );
      return new E2eeSession(keyPair as CryptoKeyPair, sessionId);
    } catch (err) {
      log.webrtc("e2ee keygen unavailable", {
        reason: err instanceof Error ? err.message : "unknown",
      });
      return null;
    }
  }

  /** Base64 raw public key — safe to put in a signalling payload. */
  async publicKey(): Promise<string> {
    return toBase64(await crypto.subtle.exportKey("raw", this.keyPair.publicKey));
  }

  /**
   * Both ends run this with each other's public key and land on the same
   * pair of direction keys. Memoised because a peer may announce itself
   * more than once (reconnect, late announce).
   */
  async deriveKeys(peerSessionId: string, remotePublicKey: string): Promise<FrameKeys> {
    const cacheKey = `${peerSessionId}:${remotePublicKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const task = (async () => {
      const raw = fromBase64(remotePublicKey);
      if (raw.byteLength !== EC_PUBLIC_KEY_BYTES) {
        throw new Error("Unexpected E2EE public key size");
      }
      const peer = await crypto.subtle.importKey(
        "raw",
        raw,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      );
      const shared = await crypto.subtle.deriveBits(
        { name: "ECDH", public: peer },
        this.keyPair.privateKey,
        256,
      );
      // Which of the two keys is "outbound" has to be agreed by both ends,
      // so it's pinned to the ordering of the two session ids.
      return deriveFrameKeys(shared, this.sessionId < peerSessionId);
    })();
    this.cache.set(cacheKey, task);
    return task;
  }

  dispose() {
    this.cache.clear();
  }
}

type TransformTarget = RTCRtpSender | RTCRtpReceiver;

/** Minimal shape for the legacy encoded-streams API. */
type EncodedStreamsTarget = {
  transform: RTCRtpTransform | null;
  createEncodedStreams?: () => {
    readable: ReadableStream;
    writable: WritableStream;
  };
};

/**
 * One transform on one sender or receiver.
 *
 * Installed before any media can flow, so the very first frame is already
 * covered. If the key hasn't arrived yet, frames wait (bounded) instead of
 * leaving in the clear — the alternative, sending cleartext for a few
 * hundred milliseconds, would quietly break the promise the lock icon
 * makes.
 *
 * Construction never throws. A transform that cannot be installed leaves
 * the pipeline exactly as it found it and reports `failed`, so the caller
 * can drop to an unencrypted link rather than take the call down with it.
 */
export class FrameTransform {
  private worker: Worker | null = null;
  private pipe: Promise<void> | null = null;
  private keys: FrameKeys | null = null;
  private release: (() => void) | null = null;
  private readonly ready: Promise<void>;
  private closed = false;
  private readonly direction: FrameDirection;
  private readonly mode: Exclude<E2eeSupport, "unsupported">;
  private readonly target: TransformTarget;
  /** True when the transform could not be installed; the link stays clear. */
  readonly failed: boolean;
  /** Link dropped to cleartext: the transform now forwards frames as-is. */
  private passThrough = false;

  constructor(
    target: TransformTarget,
    direction: FrameDirection,
    mode: Exclude<E2eeSupport, "unsupported">,
  ) {
    this.direction = direction;
    this.mode = mode;
    this.target = target;
    this.ready = new Promise<void>((resolve) => {
      this.release = resolve;
    });
    try {
      let installed = false;
      if (mode === "worker") {
        installed = this.installWorker(target);
        // Worker path refused (strict CSP, blocked module): same crypto on the
        // main thread beats a pipeline that silently never delivers a frame.
        if (!installed) {
          installed = this.installStreams(target as EncodedStreamsTarget);
        }
      } else {
        installed = this.installStreams(target as EncodedStreamsTarget);
      }
      this.failed = !installed;
      if (this.failed) {
        log.webrtc("e2ee transform not installed", { direction });
      }
    } catch (err) {
      // Belt and braces: a throwing transform must never reach the mesh,
      // which would leave peers stuck in "connecting".
      this.failed = true;
      log.webrtc("e2ee transform install failed", {
        direction,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  /** Returns false when the worker path couldn't be set up at all. */
  private installWorker(target: TransformTarget): boolean {
    try {
      const worker = new Worker(new URL("./e2ee.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker = worker;
      target.transform = new RTCRtpScriptTransform(worker, {
        operation: this.direction,
      });
      return true;
    } catch (err) {
      log.webrtc("e2ee worker unavailable — using main-thread crypto", {
        reason: err instanceof Error ? err.message : "unknown",
      });
      return false;
    }
  }

  /** Returns true when the legacy main-thread path is in place. */
  private installStreams(target: EncodedStreamsTarget): boolean {
    const streams = target.createEncodedStreams?.();
    if (!streams) {
      // Should be unreachable: support detection checked this first.
      log.webrtc("e2ee streams unavailable — transform skipped");
      return false;
    }
    target.transform = streams.readable;
    const transform = new TransformStream<FrameLike, FrameLike>({
      transform: async (frame, controller) => {
        // The stream is serialised, so waiting here also preserves frame
        // order across the key hand-over.
        await this.ready;
        if (this.closed) return;
        if (this.passThrough) {
          controller.enqueue(frame);
          return;
        }
        const keys = this.keys;
        if (keys === null) return;
        try {
          const out = await sealFrame(
            frame,
            keyFor(keys, this.direction),
            keys.epoch,
            this.direction,
          );
          controller.enqueue(withData(frame, out));
        } catch {
          /* frame didn't authenticate — drop it, never forward */
        }
      },
    });
    this.pipe = streams.readable
      .pipeThrough(transform)
      .pipeTo(streams.writable)
      .catch(() => {
        /* the peer went away mid-flight */
      });
    return true;
  }

  /**
   * Stop encrypting on this link and let frames through untouched.
   *
   * Preferred over detaching the transform: clearing `transform` mid-call
   * is refused by some implementations, and a transform that stays attached
   * but goes transparent keeps media flowing no matter what the browser
   * allows.
   */
  disable() {
    if (this.closed || this.passThrough) return;
    this.passThrough = true;
    this.worker?.postMessage({ operation: "passThrough" });
    // Release anything queued waiting for a key that will never come.
    this.release?.();
    this.release = null;
  }

  /** Install the pair's keys. Safe to call more than once. */
  setKeys(keys: FrameKeys) {
    if (this.closed || this.passThrough) return;
    this.keys = keys;
    if (this.worker) {
      try {
        this.worker.postMessage({
          operation: "setKey",
          key: keyFor(keys, this.direction),
          epoch: keys.epoch.slice().buffer as ArrayBuffer,
        });
      } catch (err) {
        log.webrtc("e2ee key hand-off failed", {
          direction: this.direction,
          reason: err instanceof Error ? err.message : "unknown",
        });
      }
    }
    this.release?.();
    this.release = null;
  }

  close() {
    this.closed = true;
    this.keys = null;
    // Release any frame waiting on the key so it is dropped rather than
    // holding the pipe open for the rest of the call.
    this.release?.();
    this.release = null;
    this.worker?.terminate();
    this.worker = null;
    this.pipe = null;
    // Detach from the pipeline: this is what lets a link fall back to
    // cleartext when the other end can't do transforms at all.
    try {
      this.target.transform = null;
    } catch {
      /* pipeline already torn down with the peer */
    }
  }
}