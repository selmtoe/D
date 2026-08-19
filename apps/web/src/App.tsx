import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { useUiStore } from "./app/store";
import type { LocalProfile, Role, RoomView } from "./app/model";
import { loadAvatar, saveAvatar } from "./avatar-3d/avatarStorage";
import {
  createRoom,
  firebaseErrorMessage,
  firebaseMode,
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
import { useVisualViewport } from "./app/visualViewport";

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
  useVisualViewport();
  const app = useUiStore((state) => state.app);
  const rooms = useUiStore((state) => state.publicRooms);
  const dispatch = useUiStore((state) => state.dispatch);
  const lowPower = useUiStore((state) => state.lowPower);
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

  useAuthentication();
  usePublicRoomSubscription(app.phase === "SALON_LOBBY");
  useRoomSubscription(activeRoomId);

  useEffect(() => {
    if (!activeRoomId) return;
    let alive = true;
    let stop: (() => void) | undefined;
    startRoomPresence(
      activeRoomId,
      (error) => alive && dispatch({ type: "ERROR", message: error.message }),
      () => {
        if (!alive) return;
        dispatch({ type: "CONNECTION", connection: "reconnecting" });
        const reconnectToken = sessionStorage.getItem(`daifugo-reconnect-${activeRoomId}`);
        if (!reconnectToken) return;
        void reconnectWithToken(activeRoomId, reconnectToken)
          .then((result) =>
            sessionStorage.setItem(`daifugo-reconnect-${activeRoomId}`, result.reconnectToken),
          )
          .catch((cause) => dispatch({ type: "ERROR", message: firebaseErrorMessage(cause) }));
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
      dispatch({ type: "CONNECTION", connection: "reconnecting" });
    };
    const offline = () =>
      dispatch({ type: "CONNECTION", connection: activeRoomId ? "grace" : "offline" });
    addEventListener("online", online);
    addEventListener("offline", offline);
    return () => {
      removeEventListener("online", online);
      removeEventListener("offline", offline);
    };
  }, [activeRoomId, app.room, dispatch]);

  useEffect(() => {
    if (app.phase !== "DEALING") return;
    const timer = window.setTimeout(
      () => dispatch({ type: "DEALING_DONE" }),
      lowPower || reducedMotion ? 0 : 1_800,
    );
    return () => window.clearTimeout(timer);
  }, [app.phase, dispatch, lowPower, reducedMotion]);

  useEffect(() => {
    if (app.phase !== "ENTRANCE" || !reconnectRoomId || activeRoomId) return;
    const reconnectToken = sessionStorage.getItem(`daifugo-reconnect-${reconnectRoomId}`);
    if (!reconnectToken) return;
    setBusy(true);
    reconnectWithToken(reconnectRoomId, reconnectToken)
      .then((result) => {
        sessionStorage.setItem(`daifugo-reconnect-${reconnectRoomId}`, result.reconnectToken);
        setActiveRoomId(reconnectRoomId);
      })
      .catch((cause) => dispatch({ type: "ERROR", message: firebaseErrorMessage(cause) }))
      .finally(() => setBusy(false));
  }, [activeRoomId, app.phase, dispatch, reconnectRoomId]);

  const run = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
      primeFeedback(soundMuted);
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
        setBusy(false);
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
        sessionStorage.setItem(`daifugo-reconnect-${result.roomId}`, result.reconnectToken);
      setActiveRoomId(result.roomId);
      history.replaceState(null, "", `${location.pathname}?room=${result.roomId}&role=${role}`);
    });
  };
  const create = () => {
    if (!app.profile) return;
    void run(async () => {
      const result = await createRoom(app.profile!);
      if (result.reconnectToken)
        sessionStorage.setItem(`daifugo-reconnect-${result.roomId}`, result.reconnectToken);
      setActiveRoomId(result.roomId);
      history.replaceState(null, "", `${location.pathname}?room=${result.roomId}&role=player`);
    });
  };
  const leave = () => {
    if (!app.room) return;
    void run(async () => {
      await sendCommand("leaveRoom", commandBase(app.room!));
      sessionStorage.removeItem(`daifugo-reconnect-${app.room!.roomId}`);
      setActiveRoomId(undefined);
      history.replaceState(null, "", location.pathname);
      dispatch({ type: "LEAVE_ROOM" });
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
        <p role="status">サロンへ接続しています…</p>
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
        muted={soundMuted}
        setMuted={(value) => setSettings({ soundMuted: value })}
        openEditor={() => setSettings({ editorOpen: true })}
        openRules={() => setSettings({ activeDialog: "rules" })}
        enter={enter}
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
        transferHost={(targetUid) =>
          void command("transferHost", { ...commandBase(app.room!), targetUid })
        }
        updateSettings={(settings) =>
          void command("updateRoomSettings", { ...commandBase(app.room!), settings })
        }
      />
    );
  else if (
    (app.phase === "DEALING" ||
      app.phase === "PLAYING_TURN" ||
      app.phase === "AWAITING_FORCED_EFFECT") &&
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
        leave={leave}
        command={command}
      />
    );
  else if (app.phase === "FINISHED" && app.room)
    screen = (
      <ResultScreen
        room={app.room}
        busy={busy}
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
      {!firebaseMode.emulator && !import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY && (
        <p className="configuration-banner" role="status">
          App Check site key未設定 — 本番公開前に設定してください
        </p>
      )}
      {firebaseMode.emulator && (
        <p className="emulator-banner" role="status">
          Firebase Emulatorへ接続中（本番データではありません）
        </p>
      )}
      {screen}
      <Suspense
        fallback={
          <div className="modal-backdrop" role="status">
            仕立て室を準備しています…
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
