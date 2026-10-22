/**
 * Frame-level crypto for Nexa E2EE.
 *
 * Pure WebCrypto with no WebRTC types, so the exact same code runs on the
 * main thread and inside the encoded-transform worker.
 *
 * Scheme, per peer pair:
 *  - ECDH (P-256) over the signalling transport gives both ends the same
 *    shared secret; the server only ever relays the public keys.
 *  - HKDF splits that secret into two AES-256-GCM keys — one per direction
 *    of the call — plus a 4-byte epoch. Because both ends derive the same
 *    pair, one end's `out` is the other end's `in`: the two directions then
 *    never share an AES-GCM IV space, which is what makes a per-frame IV
 *    safe.
 *  - Every encoded frame is sealed on its own with an IV built from the
 *    epoch and the frame's RTP timestamp.
 */

export const E2EE_IV_BYTES = 12;

export type FrameDirection = "encrypt" | "decrypt";

/** The bits of an encoded frame we care about (RTCEncoded*Chunk shaped). */
export type FrameLike = {
  data: ArrayBuffer;
  type?: string;
  timestamp: number;
};

export type FrameKeys = {
  /**
   * What *this* browser encrypts with. The peer's `in` is these same bytes.
   */
  out: CryptoKey;
  /** What this browser decrypts with; identical to the peer's `out`. */
  in: CryptoKey;
  /** 4-byte per-pair salt mixed into every IV. */
  epoch: Uint8Array<ArrayBuffer>;
};

const encoder = new TextEncoder();
// Held as ArrayBuffer rather than Uint8Array: every WebCrypto call site
// wants a BufferSource, and `Uint8Array<ArrayBuffer>` generics churn with
// the lib version.
const KEY_INFO_DIR1 = encoder.encode("nexa-e2ee/dir1/v1").buffer as ArrayBuffer;
const KEY_INFO_DIR2 = encoder.encode("nexa-e2ee/dir2/v1").buffer as ArrayBuffer;
const KEY_INFO_EPOCH = encoder.encode("nexa-e2ee/epoch/v1").buffer as ArrayBuffer;

/**
 * Split an ECDH shared secret into this pair's two keys and the epoch.
 *
 * Two keys are mandatory, not decoration: each direction of the call needs
 * its own key, or both ends would be sealing frames under the same AES-GCM
 * key and could reuse an IV (which breaks GCM outright).
 *
 * Which key belongs to which direction can't be a local choice, so it is
 * pinned by an ordering both ends agree on: the lower session id sends
 * with `dir1` and receives with `dir2`, the higher does the opposite. Pass
 * `amFirst = selfSessionId < peerSessionId`.
 */
export async function deriveFrameKeys(
  shared: ArrayBuffer,
  amFirst: boolean,
): Promise<FrameKeys> {
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveBits",
  ]);
  // A fixed salt is correct here: the input is already 32 uniform bytes
  // from ECDH, which is exactly what HKDF wants as its IKM.
  const salt = new Uint8Array(32);
  const bits = async (info: ArrayBuffer, length: number) =>
    crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      hkdf,
      length,
    );
  const [dir1Bits, dir2Bits, epochBits] = await Promise.all([
    bits(KEY_INFO_DIR1, 256),
    bits(KEY_INFO_DIR2, 256),
    bits(KEY_INFO_EPOCH, 32),
  ]);
  // Both keys carry both usages: the same bytes are the *outbound* key for
  // one end and the *inbound* key for the other, so whichever end we are,
  // the key it needs must be usable for that operation.
  const [dir1, dir2] = await Promise.all([
    crypto.subtle.importKey("raw", dir1Bits, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]),
    crypto.subtle.importKey("raw", dir2Bits, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]),
  ]);
  return {
    out: amFirst ? dir1 : dir2,
    in: amFirst ? dir2 : dir1,
    epoch: new Uint8Array(epochBits).slice(0, 4),
  };
}

/**
 * IV = epoch ‖ RTP timestamp ‖ zeros.
 *
 * The receiver has to rebuild the exact same IV for every frame, so the IV
 * is derived from data the frame itself carries rather than from a
 * counter. A counter would look simpler and be wrong: the moment UDP
 * drops a packet the two sides' counters disagree and every later frame
 * fails to open. The RTP timestamp is unique per encoded frame and — this
 * is the property that matters — is carried inside the packet, so a lost
 * frame costs exactly that frame.
 */
export function buildIv(
  epoch: Uint8Array<ArrayBuffer>,
  timestamp: number,
): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(E2EE_IV_BYTES);
  iv.set(epoch.subarray(0, 4), 0);
  new DataView(iv.buffer).setUint32(4, timestamp >>> 0, false);
  return iv;
}

/**
 * Replace a frame's payload in place.
 *
 * The pipeline hands us an RTCEncoded*Chunk whose `data` the spec exposes
 * as readonly, but every shipping implementation lets a transform assign
 * it. Mutating in place also preserves the prototype — spreading the
 * object instead would produce a bare `{data}` and lose the frame's type
 * and timestamp, since those live on the prototype as getters.
 */
export function withData<T extends FrameLike>(frame: T, data: ArrayBuffer): T {
  try {
    frame.data = data;
  } catch {
    Object.defineProperty(frame, "data", { value: data, configurable: true });
  }
  return frame;
}

/**
 * The key this direction uses. Encrypt always `out`, decrypt always `in`
 * — on both ends — so each direction of the call runs on its own key.
 */
export function keyFor(keys: FrameKeys, direction: FrameDirection): CryptoKey {
  return direction === "encrypt" ? keys.out : keys.in;
}

/**
 * Seal (encrypt) or open (decrypt) one frame with AES-GCM.
 *
 * Decryption throws when a frame doesn't authenticate (wrong key, or a
 * frame we never sealed). Callers treat that as "drop this frame" — never
 * forward it, and never fall back to cleartext.
 */
export async function sealFrame(
  frame: FrameLike,
  key: CryptoKey,
  epoch: Uint8Array<ArrayBuffer>,
  direction: FrameDirection,
): Promise<ArrayBuffer> {
  const params: AesGcmParams = {
    name: "AES-GCM",
    iv: buildIv(epoch, frame.timestamp),
  };
  return direction === "encrypt"
    ? await crypto.subtle.encrypt(params, key, frame.data)
    : await crypto.subtle.decrypt(params, key, frame.data);
}

/**
 * Direction-aware wrapper used by the main thread. Returns null when no
 * key has arrived yet: the frame is dropped rather than passed through,
 * because cleartext media must never fall out of an "encrypted" call.
 */
export async function transformFrame(
  frame: FrameLike,
  direction: FrameDirection,
  keys: FrameKeys | null,
): Promise<ArrayBuffer | null> {
  if (keys === null) return null;
  return sealFrame(frame, keyFor(keys, direction), keys.epoch, direction);
}

/**
 * Round-trip proof used by the dev self-check: a frame sealed here must
 * open back to the identical bytes with a frame-shaped IV. This is what
 * tells us the media path is genuinely encrypted rather than merely
 * labelled so.
 */
export async function selfTest(): Promise<boolean> {
  try {
    const shared = crypto.getRandomValues(new Uint8Array(32));
    // The two ends of one pair: same secret, opposite roles.
    const first = await deriveFrameKeys(shared.buffer as ArrayBuffer, true);
    const second = await deriveFrameKeys(shared.buffer as ArrayBuffer, false);
    const original = crypto.getRandomValues(new Uint8Array(512));
    const frame: FrameLike = {
      data: original.buffer as ArrayBuffer,
      type: "key",
      timestamp: 90_000,
    };
    const sealed = await transformFrame(frame, "encrypt", first);
    if (sealed === null) return false;
    // The ciphertext must not be the plaintext.
    if (new Uint8Array(sealed).every((byte, i) => byte === original[i])) return false;
    const opened = await transformFrame(
      { data: sealed, type: "key", timestamp: frame.timestamp },
      "decrypt",
      second,
    );
    if (opened === null) return false;
    const roundTripped = new Uint8Array(opened);
    if (
      roundTripped.length !== original.length ||
      !roundTripped.every((byte, i) => byte === original[i])
    ) {
      return false;
    }
    // The far end must not be able to decrypt what it never sent: the two
    // directions really are on different keys.
    const wrongWay = await transformFrame(
      { data: sealed, type: "key", timestamp: frame.timestamp },
      "decrypt",
      first,
    ).catch(() => null);
    return wrongWay === null;
  } catch {
    return false;
  }
}