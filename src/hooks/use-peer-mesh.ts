import { PeerManager, type PeerDiagnostics, type PeerState } from "@/lib/webrtc/peerManager";
import type { LocalTracks } from "@/lib/webrtc/peerManager";
import type { SignalEnvelope, SignalKind } from "@/shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * React binding for the PeerManager.
 *
 * The manager itself is React-free: this hook owns its lifetime, feeds it
 * roster changes and local track swaps, and projects its callbacks into
 * component state. All WebRTC state transitions stay in the manager;
 * React only sees the resulting per-peer view.
 */
export function usePeerMesh(options: {
  sessionId: string;
  participants: { sessionId: string }[] | null | undefined;
  tracks: LocalTracks;
  send: (toSessionId: string, kind: SignalKind, payload: string) => void;
}) {
  const { sessionId, participants, tracks, send } = options;

  const [peerStates, setPeerStates] = useState<Record<string, PeerState>>({});
  const managerRef = useRef<PeerManager | null>(null);

  const sendRef = useRef(send);
  const tracksRef = useRef(tracks);
  const remoteIds = useMemo(
    () =>
      (participants ?? [])
        .map((p) => p.sessionId)
        .filter((id) => id !== sessionId),
    [participants, sessionId],
  );
  const remoteIdsRef = useRef(remoteIds);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  /** One manager per room mount; destroyed on unmount (closes every PC). */
  useEffect(() => {
    const manager = new PeerManager({
      sessionId,
      send: (to, kind, payload) => sendRef.current(to, kind, payload),
      onChange: (id, state) => {
        setPeerStates((prev) => {
          if (state.status === "closed") {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          }
          const existing = prev[id];
          return { ...prev, [id]: { ...existing, ...state } };
        });
      },
    });
    managerRef.current = manager;
    manager.setLocalTracks(tracksRef.current);
    manager.syncPeers(remoteIdsRef.current);

    return () => {
      manager.destroy();
      if (managerRef.current === manager) managerRef.current = null;
      setPeerStates({});
    };
  }, [sessionId]);

  /** Roster changed: connect new peers, tear down departed ones. */
  useEffect(() => {
    remoteIdsRef.current = remoteIds;
    managerRef.current?.syncPeers(remoteIds);
  }, [remoteIds]);

  /** Local media changed (mute / camera / screen share): swap tracks. */
  useEffect(() => {
    tracksRef.current = tracks;
    managerRef.current?.setLocalTracks(tracks);
  }, [tracks]);

  const handleSignal = useCallback(async (signal: SignalEnvelope) => {
    await managerRef.current?.handleSignal(signal);
  }, []);

  /** Called when the signalling socket reconnects: verify live peers. */
  const checkHealth = useCallback(() => {
    managerRef.current?.checkHealth();
  }, []);

  /** Live per-connection stats for the ?debug=1 overlay. */
  const diagnostics = useCallback(async (): Promise<PeerDiagnostics[]> => {
    return (await managerRef.current?.diagnostics()) ?? [];
  }, []);

  return { peerStates, handleSignal, checkHealth, diagnostics };
}
