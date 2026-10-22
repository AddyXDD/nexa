import { api } from "@/convex/_generated/api";
import { log } from "@/lib/webrtc/logger";
import type { SignalEnvelope, SignalKind } from "@/shared/types";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef } from "react";

/**
 * Signalling transport over Convex's WebSocket connection.
 *
 * The inbox is a reactive query (messages addressed to *this* session in
 * *this* room). Each message is handled at most once — the processed set
 * guards against redelivery (e.g. a failed consume), and messages are
 * acknowledged so they leave the server immediately. Anything the client
 * never consumes expires on the sweeper.
 */

const MAX_PROCESSED_IDS = 2000;

/** Outbound signalling: routes SDP/ICE to a session via the server. */
export function useSignalSend(
  code: string,
  sessionId: string,
  enabled: boolean,
) {
  const sendSignal = useMutation(api.signaling.send);

  return useCallback(
    (toSessionId: string, kind: SignalKind, payload: string) => {
      if (!enabled) return;
      void sendSignal({ code, sessionId, toSessionId, kind, payload }).catch(
        () => {
          // Peer left the room or the room closed — both are expected races.
          log.signaling("send rejected", { kind, to: toSessionId });
        },
      );
    },
    [code, sessionId, enabled, sendSignal],
  );
}

/**
 * Inbound signalling: a reactive inbox of messages addressed to this
 * session. Each message is handled at most once — the processed set guards
 * against redelivery (e.g. a failed consume), and messages are
 * acknowledged so they leave the server immediately. Anything the client
 * never consumes expires on the sweeper.
 */
export function useSignalInbox(
  code: string,
  sessionId: string,
  enabled: boolean,
  handleSignal: (signal: SignalEnvelope) => Promise<void> | void,
) {
  const inbox = useQuery(
    api.signaling.inbox,
    enabled ? { code, sessionId } : "skip",
  );
  const consumeSignals = useMutation(api.signaling.consume);

  const processedRef = useRef(new Set<string>());
  const handlerRef = useRef(handleSignal);

  useEffect(() => {
    handlerRef.current = handleSignal;
  }, [handleSignal]);

  useEffect(() => {
    if (!inbox || inbox.length === 0) return;
    const fresh = inbox.filter((m) => !processedRef.current.has(m.id));
    if (fresh.length === 0) return;

    if (processedRef.current.size > MAX_PROCESSED_IDS) {
      processedRef.current.clear();
    }
    for (const message of fresh) processedRef.current.add(message.id);

    void (async () => {
      try {
        // In order: offers before their candidates, answers after offers.
        for (const message of fresh) {
          await handlerRef.current(message);
        }
      } finally {
        void consumeSignals({
          code,
          sessionId,
          ids: fresh.map((m) => m.id),
        }).catch(() => {
          /* redelivery is safe: the processed set dedupes it */
        });
      }
    })();
  }, [inbox, code, sessionId, consumeSignals]);

  return inbox;
}
