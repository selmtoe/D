import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveSparkSession } from "./firebaseClient";
import { e2eSendCue, isE2ECueTransport, isE2ETransport, subscribeE2ECues } from "./e2eTransport";
import type { CueEvent, SpectatorPoseCue } from "./peerCues";

export function usePeerCues(roomId: string, uid: string, peerIds: string[]) {
  const [mode, setMode] = useState<"connecting" | "webrtc" | "firebase" | "offline">("connecting");
  const [lastCue, setLastCue] = useState<{ cue: CueEvent; sender: string }>();
  const [spectatorPoses, setSpectatorPoses] = useState<ReadonlyMap<string, SpectatorPoseCue>>(
    () => new Map(),
  );
  const latestSpectatorPoseAtMs = useRef(new Map<string, number>());
  const peerKey = peerIds.join("|");

  const receiveCue = useCallback((cue: CueEvent, sender: string) => {
    if (cue.type !== "spectatorPose") {
      setLastCue({ cue, sender });
      return;
    }

    const previousAtMs = latestSpectatorPoseAtMs.current.get(sender);
    if (previousAtMs !== undefined && cue.atMs <= previousAtMs) return;
    latestSpectatorPoseAtMs.current.set(sender, cue.atMs);
    setLastCue({ cue, sender });
    setSpectatorPoses((current) => {
      const next = new Map(current);
      if (cue.freeSpectating) next.set(sender, cue);
      else next.delete(sender);
      return next;
    });
  }, []);

  useEffect(() => {
    latestSpectatorPoseAtMs.current.clear();
    setSpectatorPoses(new Map());
  }, [roomId, uid]);

  useEffect(() => {
    const activePeers = new Set(peerKey ? peerKey.split("|") : []);
    for (const sender of latestSpectatorPoseAtMs.current.keys()) {
      if (!activePeers.has(sender)) latestSpectatorPoseAtMs.current.delete(sender);
    }
    setSpectatorPoses((current) => {
      const next = new Map([...current].filter(([sender]) => activePeers.has(sender)));
      return next.size === current.size ? current : next;
    });
  }, [peerKey]);

  useEffect(() => {
    if (import.meta.env.DEV && isE2ETransport()) {
      if (isE2ECueTransport()) {
        setMode("webrtc");
        return subscribeE2ECues(roomId, receiveCue);
      }
      setMode("offline");
      return;
    }
    const session = getActiveSparkSession();
    if (!session || session.roomId !== roomId || session.uid !== uid) {
      setMode("offline");
      return;
    }
    const stopCue = session.onCue(receiveCue);
    const stopMode = session.onMode(setMode);
    return () => {
      stopCue();
      stopMode();
    };
  }, [peerKey, receiveCue, roomId, uid]);
  const send = useCallback(
    async (cue: CueEvent) => {
      try {
        if (import.meta.env.DEV && isE2ECueTransport()) {
          await e2eSendCue(roomId, cue);
          return true;
        }
        const session = getActiveSparkSession();
        if (!session || session.roomId !== roomId || session.uid !== uid) {
          setMode("offline");
          return false;
        }
        await session.sendCue(cue);
        return true;
      } catch {
        setMode("offline");
        return false;
      }
    },
    [roomId, uid],
  );
  return { mode, lastCue, spectatorPoses, send };
}
