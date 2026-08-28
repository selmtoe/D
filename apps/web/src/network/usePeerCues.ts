import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveSparkSession } from "./firebaseClient";
import { e2eSendCue, isE2ECueTransport, isE2ETransport, subscribeE2ECues } from "./e2eTransport";
import type { CueEvent, SpectatorPoseCue, WaitingPoseCue } from "./peerCues";

export function usePeerCues(roomId: string, uid: string, peerIds: string[]) {
  const [mode, setMode] = useState<"connecting" | "webrtc" | "firebase" | "offline">("connecting");
  const [lastCue, setLastCue] = useState<{ cue: CueEvent; sender: string }>();
  const [recentEmotes, setRecentEmotes] = useState<
    Array<{ cue: Extract<CueEvent, { type: "emote" }>; sender: string }>
  >([]);
  const [spectatorPoses, setSpectatorPoses] = useState<ReadonlyMap<string, SpectatorPoseCue>>(
    () => new Map(),
  );
  const [waitingPoses, setWaitingPoses] = useState<ReadonlyMap<string, WaitingPoseCue>>(
    () => new Map(),
  );
  const latestSpectatorPoseAtMs = useRef(new Map<string, number>());
  const latestWaitingPoseAtMs = useRef(new Map<string, number>());
  const waitingPoseReceivedAtMs = useRef(new Map<string, number>());
  const receivedCueIds = useRef(new Set<string>());
  const peerKey = peerIds.join("|");

  const receiveCue = useCallback((cue: CueEvent, sender: string) => {
    if (cue.type !== "spectatorPose" && cue.type !== "waitingPose") {
      if (receivedCueIds.current.has(cue.eventId)) return;
      receivedCueIds.current.add(cue.eventId);
      if (receivedCueIds.current.size > 256) {
        receivedCueIds.current.delete(receivedCueIds.current.values().next().value!);
      }
      setLastCue({ cue, sender });
      if (cue.type === "emote") {
        setRecentEmotes((current) => [...current, { cue, sender }].slice(-8));
      }
      return;
    }

    const latestPoseAtMs =
      cue.type === "spectatorPose" ? latestSpectatorPoseAtMs : latestWaitingPoseAtMs;
    const previousAtMs = latestPoseAtMs.current.get(sender);
    if (previousAtMs !== undefined && cue.atMs <= previousAtMs) return;
    latestPoseAtMs.current.set(sender, cue.atMs);
    setLastCue({ cue, sender });
    if (cue.type === "waitingPose") {
      waitingPoseReceivedAtMs.current.set(sender, Date.now());
      setWaitingPoses((current) => {
        const next = new Map(current);
        if (cue.inPlayground) next.set(sender, cue);
        else next.delete(sender);
        return next;
      });
      return;
    }
    setSpectatorPoses((current) => {
      const next = new Map(current);
      if (cue.freeSpectating) next.set(sender, cue);
      else next.delete(sender);
      return next;
    });
  }, []);

  useEffect(() => {
    latestSpectatorPoseAtMs.current.clear();
    latestWaitingPoseAtMs.current.clear();
    waitingPoseReceivedAtMs.current.clear();
    receivedCueIds.current.clear();
    setRecentEmotes([]);
    setSpectatorPoses(new Map());
    setWaitingPoses(new Map());
  }, [roomId, uid]);

  useEffect(() => {
    const activePeers = new Set(peerKey ? peerKey.split("|") : []);
    for (const sender of latestSpectatorPoseAtMs.current.keys()) {
      if (!activePeers.has(sender)) latestSpectatorPoseAtMs.current.delete(sender);
    }
    for (const sender of latestWaitingPoseAtMs.current.keys()) {
      if (!activePeers.has(sender)) {
        latestWaitingPoseAtMs.current.delete(sender);
        waitingPoseReceivedAtMs.current.delete(sender);
      }
    }
    setSpectatorPoses((current) => {
      const next = new Map([...current].filter(([sender]) => activePeers.has(sender)));
      return next.size === current.size ? current : next;
    });
    setWaitingPoses((current) => {
      const next = new Map([...current].filter(([sender]) => activePeers.has(sender)));
      return next.size === current.size ? current : next;
    });
  }, [peerKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - 4_000;
      setWaitingPoses((current) => {
        const next = new Map(current);
        for (const sender of current.keys()) {
          if ((waitingPoseReceivedAtMs.current.get(sender) ?? 0) < cutoff) next.delete(sender);
        }
        return next.size === current.size ? current : next;
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, []);

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
  const sendDirect = useCallback(
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
        return await session.sendCueDirect(cue);
      } catch {
        return false;
      }
    },
    [roomId, uid],
  );
  return { mode, lastCue, recentEmotes, spectatorPoses, waitingPoses, send, sendDirect };
}
