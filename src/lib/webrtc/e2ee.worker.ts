import {
  sealFrame,
  withData,
  type FrameDirection,
  type FrameLike,
} from "./e2ee-crypto";

/**
 * Encoded-transform worker for RTCRtpScriptTransform.
 *
 * One worker per sender/receiver. The browser hands us frames one at a
 * time and expects them back in order, so work is chained on `tail`
 * rather than run concurrently.
 *
 * Typed against small local shapes rather than the `webworker` lib types
 * so this file compiles inside the app's DOM-lib project without needing
 * a second tsconfig.
 */

type TransformerPort = {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent) => unknown) | null;
};

const scope = globalThis as unknown as WorkerScope;

/** The key this transformer was installed with, once it arrives. */
let key: CryptoKey | null = null;
let epoch: Uint8Array<ArrayBuffer> | null = null;
/** The link fell back to cleartext: forward every frame untouched. */
let passThrough = false;

let tail: Promise<void> = Promise.resolve();

type Pending = {
  frame: FrameLike;
  port: TransformerPort;
  direction: FrameDirection;
};

/** Frames held while the key is still being exchanged (~1 signalling RTT). */
let pending: Pending[] = [];
/** Bounded: a key that never arrives must not grow this without limit. */
const MAX_PENDING = 60;

async function handle(entry: Pending): Promise<void> {
  if (passThrough) {
    entry.port.postMessage(entry.frame);
    return;
  }
  if (key === null || epoch === null) return;
  try {
    const out = await sealFrame(entry.frame, key, epoch, entry.direction);
    // Mutated in place so the frame keeps its type and timestamp, which
    // the pipeline reads straight off the object.
    entry.port.postMessage(withData(entry.frame, out));
  } catch {
    // A frame that doesn't authenticate is dropped. Forwarding it would
    // push ciphertext at the decoder — or worse, look like it worked.
  }
}

function enqueue(entry: Pending): void {
  if (passThrough) {
    tail = tail
      .then(() => {
        entry.port.postMessage(entry.frame);
      })
      .catch(() => {});
    return;
  }
  if (key === null) {
    if (pending.length >= MAX_PENDING) pending.shift();
    pending.push(entry);
    return;
  }
  tail = tail.then(() => handle(entry)).catch(() => {});
}

scope.onmessage = (event: MessageEvent): void => {
  const data = event.data as
    | { operation: string; key?: CryptoKey; epoch?: ArrayBuffer }
    | undefined;
  if (!data) return;

  if (data.operation === "passThrough") {
    passThrough = true;
    // Anything held while we waited for a key now goes straight through.
    const queued = pending;
    pending = [];
    for (const entry of queued) enqueue(entry);
    return;
  }

  if (data.operation === "setKey") {
    if (data.key && data.epoch) {
      key = data.key;
      epoch = new Uint8Array(data.epoch);
      // Release what we held while waiting, in arrival order.
      const queued = pending;
      pending = [];
      for (const entry of queued) enqueue(entry);
    }
    return;
  }

  const direction: FrameDirection | null =
    data.operation === "encrypt" || data.operation === "decrypt"
      ? data.operation
      : null;
  if (direction === null) return;

  // Per the encoded-transform spec the control message's target is the
  // transformer's own port, and that port delivers the frames.
  const port = event.target as unknown as TransformerPort;
  if (!port || typeof port.postMessage !== "function") return;

  port.onmessage = (frameEvent: MessageEvent): void => {
    const frame = frameEvent.data as FrameLike | undefined;
    if (!frame || typeof frame.timestamp !== "number") return;
    enqueue({ frame, port, direction });
  };
};