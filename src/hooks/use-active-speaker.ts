import { getAudioContext } from "@/lib/media/audio";
import type { PeerState } from "@/lib/webrtc/peerManager";
import { useEffect, useRef, useState } from "react";

/**
 * Active-speaker detection from actual audio activity — the loudest remote
 * stream above a floor wins the badge; silence releases it after a short
 * hold so the highlight breathes instead of flickering.
 *
 * Analysis runs on one shared AudioContext over the raw remote streams; it
 * never touches the peer connections.
 */

const POLL_MS = 140;
const SPEECH_FLOOR = 0.018;
const HOLD_MS = 900;

type Watch = {
  sessionId: string;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Uint8Array<ArrayBuffer>;
};

export function useActiveSpeaker(
  peers: Record<string, PeerState>,
): string | null {
  const [active, setActive] = useState<string | null>(null);
  const watchesRef = useRef(new Map<string, Watch>());
  const lastLoudRef = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const watches = watchesRef.current;

    // Sync watchers with the current roster/streams.
    for (const [sessionId, state] of Object.entries(peers)) {
      const existing = watches.get(sessionId);
      const stream = state.stream;
      const audible =
        stream !== null &&
        stream.getAudioTracks().length > 0 &&
        (state.status === "connected" || state.status === "reconnecting");

      if (!audible) {
        if (existing) {
          try {
            existing.source.disconnect();
            existing.analyser.disconnect();
          } catch {
            /* already torn down */
          }
          watches.delete(sessionId);
        }
        continue;
      }
      if (existing && existing.stream === stream) continue;
      if (existing) {
        try {
          existing.source.disconnect();
          existing.analyser.disconnect();
        } catch {
          /* replaced below */
        }
      }
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        watches.set(sessionId, {
          sessionId,
          stream,
          source,
          analyser,
          buffer: new Uint8Array(analyser.fftSize),
        });
      } catch {
        /* stream not analysable — badge simply stays off for this peer */
      }
    }

    const timer = window.setInterval(() => {
      const now = Date.now();
      let loudestId: string | null = null;
      let loudest = 0;
      for (const watch of watches.values()) {
        watch.analyser.getByteTimeDomainData(watch.buffer);
        let sum = 0;
        for (let i = 0; i < watch.buffer.length; i++) {
          const value = (watch.buffer[i] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / watch.buffer.length);
        if (rms > loudest) {
          loudest = rms;
          loudestId = watch.sessionId;
        }
      }

      if (loudestId && loudest > SPEECH_FLOOR) {
        lastLoudRef.current = { id: loudestId, at: now };
        setActive((current) => (current === loudestId ? current : loudestId));
      } else if (
        lastLoudRef.current &&
        now - lastLoudRef.current.at > HOLD_MS
      ) {
        lastLoudRef.current = null;
        setActive(null);
      }
    }, POLL_MS);

    return () => {
      window.clearInterval(timer);
      for (const watch of watches.values()) {
        try {
          watch.source.disconnect();
          watch.analyser.disconnect();
        } catch {
          /* already torn down */
        }
      }
      watches.clear();
      lastLoudRef.current = null;
    };
  }, [peers]);

  return active;
}
