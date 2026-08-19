import { useCallback, useEffect, useRef, useState } from "react";
import { getFirebase } from "./firebaseClient";
import { isE2ETransport } from "./e2eTransport";
import { PeerCueNetwork, type CueEvent } from "./peerCues";

export function usePeerCues(roomId: string, uid: string, peerIds: string[]) {
  const network = useRef<PeerCueNetwork | undefined>(undefined);
  const [mode, setMode] = useState<"connecting" | "webrtc" | "firebase" | "offline">("connecting");
  const [lastCue, setLastCue] = useState<{ cue: CueEvent; sender: string }>();
  const peerKey = peerIds.join("|");
  useEffect(() => {
    if (import.meta.env.DEV && isE2ETransport()) {
      setMode("offline");
      return;
    }
    let alive = true;
    const stablePeerIds = peerKey ? peerKey.split("|") : [];
    getFirebase()
      .then(({ db }) => {
        if (!alive) return;
        const next = new PeerCueNetwork(
          db,
          roomId,
          uid,
          (cue, sender) => setLastCue({ cue, sender }),
          setMode,
        );
        network.current = next;
        return next.start(stablePeerIds);
      })
      .catch(() => setMode("offline"));
    return () => {
      alive = false;
      network.current?.close();
      network.current = undefined;
    };
  }, [peerKey, roomId, uid]);
  const send = useCallback(
    (cue: CueEvent) => network.current?.send(cue) ?? Promise.resolve(false),
    [],
  );
  return { mode, lastCue, send };
}
