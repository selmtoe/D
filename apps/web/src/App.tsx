import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { useUiStore } from "./app/store";
import type { LocalProfile, Role, RoomView } from "./app/model";
import { loadAvatar, saveAvatar } from "./avatar-3d/avatarStorage";
import {
  clearRoomReconnect,
  createRoom,
  firebaseErrorMessage,
  firebaseMode,
  getActiveSparkSession,
  getStoredRoomReconnect,
  isTerminalRoomReconnectError,
  joinRoom,
  reconnectWithToken,
  sendCommand,
  startRoomPresence,
  type CommandName,
} from "./network/firebaseClient";
import {
  useAuthentication,
  usePublicRoomSubscription,
  useRoomSubscription,
} from "./network/useRealtime";
import { EntranceScreen } from "./screens/EntranceScreen";
import { GameScreen } from "./screens/GameScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { WaitingRoomScreen } from "./screens/WaitingRoomScreen";
import { feedback, primeFeedback } from "./components/feedback";
import { getStoredValue, setStoredValue } from "./app/browserStorage";
import { connectionStateOnBrowserOnline } from "./app/connectionState";
import { canApplyPwaUpdate, useApplyPwaUpdateWhenSafe } from "./app/pwaUpdate";
import { appendReplayFrame, authoritativeReplayFrames, type ReplayFrame } from "./app/replay";

const AvatarEditor = lazy(() =>
  import("./avatar-3d/AvatarEditor").then((module) => ({ default: module.AvatarEditor })),
);
const RulesDialog = lazy(() =>
  import("./components/RulesDialog").then((module) => ({ default: module.RulesDialog })),
);

function commandBase(room: RoomView): Record<string, unknown> {
  return { roomId: room.roomId, gameId: room.gameId ?? null, expectedRevision: room.revision };
}

export default function App() {
  const app = useUiStore((state) => state.app);
  const rooms = useUiStore((state) => state.publicRooms);
  const dispatch = useUiStore((state) => state.dispatch);
  const lowPower = useUiStore((state) => state.lowPower);
  const mobileMode = useUiStore((state) => state.mobileMode);
  const reducedMotion = useUiStore((state) => state.reducedMotion);
  const soundMuted = useUiStore((state) => state.soundMuted);
  const editorOpen = useUiStore((state) => state.editorOpen);
  const activeDialog = useUiStore((state) => state.activeDialog);
  const setSettings = useUiStore((state) => state.setSettings);
  const [avatar, setAvatar] = useState<AvatarProfileV1>(loadAvatar);
  const reconnectRoomId = new URLSearchParams(location.search)
    .get("room")
    ?.toUpperCase()
    .slice(0, 5);
  const [activeRoomId, setActiveRoomId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [replayFrames, setReplayFrames] = useState<ReplayFrame[]>([]);
  const resultReplayFrames = useMemo(
    () =>
      app.room?.authoritativeReplay?.length ? authoritativeReplayFrames(app.room) : replayFrames,
    [app.room, replayFrames],
  );
  const operationsInFlight = useRef(0);
  useEffect(() => {
    document.documentElement.classList.toggle("daifugo-mobile-mode", mobileMode);
    return () => document.documentElement.classList.remove("daifugo-mobile-mode");
  }, [mobileMode]);
  useApplyPwaUpdateWhenSafe(canApplyPwaUpdate(app.phase, busy, Boolean(activeRoomId || app.room)));
  const handleRoomEvicted = useCallback((roomId: string) => {
    clearRoomReconnect(roomId);
    setActiveRoomId((current) => {
      if (current !== roomId) return current;
      history.replaceState(null, "", location.pathname);
      return undefined;
    });
  }, []);

  useAuthentication();
  usePublicRoomSubscription(app.phase === "SALON_LOBBY");
  useRoomSubscription(activeRoomId, handleRoomEvicted);

  useEffect(() => {
    if (!activeRoomId) return;
    let alive = true;
    let stop: (() => void) | undefined;
    startRoomPresence(
      activeRoomId,
      (error) => {
        if (!alive) return;
        dispatch({ type: "ERROR", message: error.message });
        dispatch({
          type: "CONNECTION",
          connection: navigator.onLine ? "reconnecting" : "offline",
        });
      },
      () => {
        if (!alive) return;
        dispatch({ type: "CONNECTION", connection: "connected" });
      },
    )
      .then((cleanup) => {
        if (alive) stop = cleanup;
        else cleanup();
      })
      .catch(
        (cause: unknown) =>
          alive && dispatch({ type: "ERROR", message: firebaseErrorMessage(cause) }),
      );
    return () => {
      alive = false;
      stop?.();
    };
  }, [activeRoomId, dispatch]);

  useEffect(() => {
    const online = () => {
      const session = getActiveSparkSession();
      const transportMode =
        session && session.roomId === activeRoomId ? session.currentMode() : undefined;
      dispatch({
        type: "CONNECTION",
        connection: connectionStateOnBrowserOnline(Boolean(activeRoomId), transportMode),
      });
    };
    const offline = () =>
      dispatch({ type: "CONNECTION", connection: activeRoomId ? "grace" : "offline" });
    addEventListener("online", online);
    addEventListener("offline", offline);
    return () => {
      removeEventListener("online", online);
      removeEventListener("offline", offline);
    };
  }, [activeRoomId, dispatch]);

  useEffect(() => {
    if (app.phase !== "DEALING") return;
    const timer = window.setTimeout(
      () => dispatch({ type: "DEALING_DONE" }),
      lowPower || reducedMotion ? 0 : 1_800,
    );
    return () => window.clearTimeout(timer);
  }, [app.phase, dispatch, lowPower, reducedMotion]);

  useEffect(() => {
    if (!app.room) return;
    if (app.room.authoritativeReplay?.length) return;
    setReplayFrames((frames) => appendReplayFrame(frames, app.room!));
  }, [app.room]);

  useEffect(() => {
    if (app.phase !== "ENTRANCE" || !reconnectRoomId || activeRoomId) return;
    const storedReconnect = getStoredRoomReconnect(reconnectRoomId);
    const reconnectToken =
      storedReconnect?.token ?? getStoredValue("session", `daifugo-reconnect-${reconnectRoomId}`);
    if (!reconnectToken) return;
    setBusy(true);
    reconnectWithToken(reconnectRoomId, reconnectToken)
      .then((result) => {
        setStoredValue("session", `daifugo-reconnect-${reconnectRoomId}`, result.reconnectToken);
        if (!app.profile) {
          dispatch({
            type: "RESTORE_PROFILE",
            profile: storedReconnect?.profile ?? {
              name: getStoredValue("local", "daifugo-player-name")?.trim() || "ゲスト",
              avatar,
            },
          });
        }
        setActiveRoomId(reconnectRoomId);
      })
      .catch((cause) => {
        if (isTerminalRoomReconnectError(cause)) {
          clearRoomReconnect(reconnectRoomId);
          history.replaceState(null, "", location.pathname);
        }
        dispatch({ type: "ERROR", message: firebaseErrorMessage(cause) });
      })
      .finally(() => setBusy(false));
  }, [activeRoomId, app.phase, app.profile, avatar, dispatch, reconnectRoomId]);

  const run = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
      primeFeedback(soundMuted);
      operationsInFlight.current += 1;
      setBusy(true);
      dispatch({ type: "CLEAR_ERROR" });
      try {
        const result = await operation();
        feedback("confirm", soundMuted);
        return result;
      } catch (cause) {
        feedback("error", soundMuted);
        dispatch({ type: "ERROR", message: firebaseErrorMessage(cause) });
        return undefined;
      } finally {
        operationsInFlight.current = Math.max(0, operationsInFlight.current - 1);
        if (operationsInFlight.current === 0) setBusy(false);
      }
    },
    [dispatch, soundMuted],
  );

  const enter = (name: string, nextAvatar: AvatarProfileV1) =>
    dispatch({ type: "ENTER_SALON", profile: { name, avatar: nextAvatar } });
  const connectToRoom = (roomId: string, role: Role) => {
    if (!app.profile) return;
    void run(async () => {
      const result = await joinRoom(roomId, role, app.profile!);
      if (result.reconnectToken)
        setStoredValue("session", `daifugo-reconnect-${result.roomId}`, result.reconnectToken);
      setActiveRoomId(result.roomId);
      history.replaceState(null, "", `${location.pathname}?room=${result.roomId}&role=${role}`);
    });
  };
  const create = () => {
    if (!app.profile) return;
    void run(async () => {
      const result = await createRoom(app.profile!);
      if (result.reconnectToken)
        setStoredValue("session", `daifugo-reconnect-${result.roomId}`, result.reconnectToken);
      setActiveRoomId(result.roomId);
      history.replaceState(null, "", `${location.pathname}?room=${result.roomId}&role=player`);
    });
  };
  const leave = () => {
    const room = app.room;
    if (!room) return;
    void run(async () => {
      try {
        await sendCommand("leaveRoom", commandBase(room));
      } finally {
        // Leaving must remain possible when the coordinator or network is
        // already gone. Server presence expires separately if delivery failed.
        clearRoomReconnect(room.roomId);
        setActiveRoomId(undefined);
        history.replaceState(null, "", location.pathname);
        setReplayFrames([]);
        dispatch({ type: "LEAVE_ROOM" });
        dispatch({
          type: "CONNECTION",
          connection: navigator.onLine ? "connected" : "offline",
        });
      }
    });
  };
  const command = async (name: string, payload: Record<string, unknown> = {}): Promise<boolean> =>
    (await run(() => sendCommand(name as CommandName, payload))) !== undefined;

  if (app.phase === "BOOT" || app.phase === "AUTHENTICATING")
    return (
      <div className="boot-screen">
        <div className="brand-seal" aria-hidden="true">
          大
        </div>
        <p role="status">ロビーへ接続しています…</p>
      </div>
    );

  let screen: React.ReactNode;
  if (app.phase === "ENTRANCE")
    screen = (
      <EntranceScreen
        app={app}
        avatar={avatar}
        setAvatar={setAvatar}
        lowPower={lowPower}
        setLowPower={(value) => setSettings({ lowPower: value })}
        mobileMode={mobileMode}
        setMobileMode={(value) => setSettings({ mobileMode: value })}
        muted={soundMuted}
        setMuted={(value) => setSettings({ soundMuted: value })}
        openEditor={() => setSettings({ editorOpen: true })}
        openRules={() => setSettings({ activeDialog: "rules" })}
        enter={enter}
        reconnecting={busy && Boolean(reconnectRoomId)}
      />
    );
  else if (app.phase === "SALON_LOBBY" && app.profile)
    screen = (
      <LobbyScreen
        profile={app.profile}
        rooms={rooms}
        connection={app.connection}
        error={app.error}
        busy={busy}
        create={create}
        join={connectToRoom}
      />
    );
  else if (app.phase === "ROOM_WAITING" && app.room)
    screen = (
      <WaitingRoomScreen
        room={app.room}
        connection={app.connection}
        busy={busy}
        error={app.error}
        leave={leave}
        openRules={() => setSettings({ activeDialog: "rules" })}
        start={() => void command("startGame", commandBase(app.room!))}
        addCpu={() => void command("addCpu", commandBase(app.room!))}
        removeCpu={(targetUid) =>
          void command("removeCpu", { ...commandBase(app.room!), targetUid })
        }
        transferHost={(targetUid) =>
          void command("transferHost", { ...commandBase(app.room!), targetUid })
        }
        kick={(targetUid) => void command("kickMember", { ...commandBase(app.room!), targetUid })}
        updateSettings={(settings) =>
          void command("updateRoomSettings", { ...commandBase(app.room!), settings })
        }
      />
    );
  else if (
    (app.phase === "DEALING" ||
      app.phase === "PLAYING_TURN" ||
      app.phase === "AWAITING_FORCED_EFFECT" ||
      app.phase === "FINISHING") &&
    app.room
  )
    screen = (
      <GameScreen
        room={app.room}
        connection={app.connection}
        lowPower={lowPower}
        reducedMotion={reducedMotion}
        busy={busy}
        error={app.error}
        dealing={app.phase === "DEALING" && !lowPower && !reducedMotion}
        skipDeal={() => dispatch({ type: "DEALING_DONE" })}
        finishing={app.phase === "FINISHING"}
        finishPresentation={() => dispatch({ type: "FINISH_PRESENTATION_DONE" })}
        leave={leave}
        command={command}
      />
    );
  else if (app.phase === "FINISHED" && app.room)
    screen = (
      <ResultScreen
        room={app.room}
        busy={busy}
        error={app.error}
        replayFrames={resultReplayFrames}
        lowPower={lowPower}
        reducedMotion={reducedMotion}
        leave={leave}
        rematch={() => void command("startRematch", commandBase(app.room!))}
      />
    );
  else
    screen = (
      <div className="boot-screen">
        <p>部屋の状態を復元しています…</p>
      </div>
    );

  return (
    <>
      {firebaseMode.emulator && (
        <p className="emulator-banner" role="status">
          Firebase Emulatorへ接続中（本番データではありません）
        </p>
      )}
      {screen}
      <Suspense
        fallback={
          <div className="modal-backdrop" role="status">
            アバター編集画面を準備しています…
          </div>
        }
      >
        {editorOpen && (
          <AvatarEditor
            value={avatar}
            lowPower={lowPower}
            onCancel={() => setSettings({ editorOpen: false })}
            onSave={(next) => {
              saveAvatar(next);
              setAvatar(next);
              if (app.profile)
                dispatch({
                  type: "ENTER_SALON",
                  profile: { ...app.profile, avatar: next } as LocalProfile,
                });
              setSettings({ editorOpen: false });
            }}
          />
        )}
        {activeDialog === "rules" && (
          <RulesDialog onClose={() => setSettings({ activeDialog: undefined })} />
        )}
      </Suspense>
    </>
  );
}
