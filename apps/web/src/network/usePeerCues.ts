import { useCallback, useEffect, useState } from "react";
import { getActiveSparkSession } from "./firebaseClient";
import { e2eSendCue, isE2ECueTransport, isE2ETransport, subscribeE2ECues } from "./e2eTransport";
import type { CueEvent } from "./peerCues";

export function usePeerCues(roomId: string, uid: string, peerIds: string[]) {
  const [mode, setMode] = useState<"connecting" | "webrtc" | "firebase" | "offline">("connecting");
  const [lastCue, setLastCue] = useState<{ cue: CueEvent; sender: string }>();
  const peerKey = peerIds.join("|");
  useEffect(() => {
    if (import.meta.env.DEV && isE2ETransport()) {
      if (isE2ECueTransport()) {
        setMode("webrtc");
        return subscribeE2ECues(roomId, (cue, sender) => setLastCue({ cue, sender }));
      }
      setMode("offline");
      return;
    }
    const session = getActiveSparkSession();
    if (!session || session.roomId !== roomId || session.uid !== uid) {
      setMode("offline");
      return;
    }
    const stopCue = session.onCue((cue, sender) => setLastCue({ cue, sender }));
    const stopMode = session.onMode(setMode);
    return () => {
      stopCue();
      stopMode();
    };
  }, [peerKey, roomId, uid]);
  const send = useCallback(
    async (cue: CueEvent) => {
      if (import.meta.env.DEV && isE2ECueTransport()) {
        await e2eSendCue(roomId, cue);
        return true;
      }
      const session = getActiveSparkSession();
      if (!session || session.roomId !== roomId || session.uid !== uid) return false;
      await session.sendCue(cue);
      return true;
    },
    [roomId, uid],
  );
  return { mode, lastCue, send };
}
