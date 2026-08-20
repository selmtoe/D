import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type Auth,
  type User,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { migrateAvatar } from "@daifugo/avatar-schema";
import type { PublicRoom, Role, RoomView } from "../app/model";
import {
  e2eCall,
  e2eViewerUid,
  isE2ETransport,
  subscribeE2EPublicRooms,
  subscribeE2ERoomView,
} from "./e2eTransport";
import { cleanupStaleSparkRooms, SparkP2PSession } from "./sparkP2P";

type FirebaseContext = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  user: User;
};

export type CommandName =
  | "createRoom"
  | "joinRoomAsPlayer"
  | "joinRoomAsSpectator"
  | "leaveRoom"
  | "reconnectRoom"
  | "transferHost"
  | "updateRoomSettings"
  | "startGame"
  | "submitPlay"
  | "submitPass"
  | "declareJokerMimic"
  | "resolveSteal"
  | "resolveGive"
  | "resolveDiscard"
  | "resolveBomber"
  | "resolveCollect"
  | "changeSpectatorFocus"
  | "sendChat"
  | "startRematch"
  | "saveAvatarProfile";

type BaseCommand = {
  roomId?: string;
  gameId?: string | null;
  expectedRevision?: number;
  clientActionId?: string;
};

interface ReconnectRecord {
  roomId: string;
  token: string;
  role: Role;
  profile: { name: string; avatar: AvatarProfileV1 };
}

const requiredEnv = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(requiredEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (requiredEnv.projectId && requiredEnv.projectId !== "daifugo-8e039") {
  throw new Error(`接続先Project IDが不正です: ${requiredEnv.projectId}`);
}

let singleton: Promise<FirebaseContext> | undefined;
let emulatorsConnected = false;
let activeSession: SparkP2PSession | undefined;

export const firebaseMode = {
  projectId: requiredEnv.projectId || "未設定",
  emulator: import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true",
  configured: missing.length === 0,
  missing,
  transport: "WebRTC P2P + Firestore signaling" as const,
  sparkCompatible: true,
};

/** Pure helper retained for UI/tests; Spark presence stores equivalent fields in Firestore. */
export function presenceRecord(
  online: boolean,
  connectionId: string,
  lastChanged: unknown,
): { online: boolean; connectionId: string; lastChanged: unknown } {
  return { online, connectionId, lastChanged };
}

function authReady(auth: Auth): Promise<User> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        if (user) resolve(user);
        else {
          signInAnonymously(auth)
            .then(({ user: signedIn }) => resolve(signedIn))
            .catch(reject);
        }
      },
      reject,
    );
  });
}

export async function getFirebase(): Promise<FirebaseContext> {
  const viewerUid = import.meta.env.DEV ? e2eViewerUid() : undefined;
  if (viewerUid) {
    return { user: { uid: viewerUid } } as unknown as FirebaseContext;
  }
  if (!firebaseMode.configured) {
    throw new Error(
      `Firebase接続設定が不足しています（${missing.join("、")}）。apps/web/.env.exampleを参照してください。`,
    );
  }
  singleton ??= (async () => {
    const app = initializeApp(requiredEnv);
    const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY;
    if (appCheckSiteKey && !firebaseMode.emulator) {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }
    const auth = getAuth(app);
    const db = getFirestore(app);
    if (firebaseMode.emulator && !emulatorsConnected) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
      emulatorsConnected = true;
    }
    const user = await authReady(auth);
    return { app, auth, db, user };
  })();
  return singleton;
}

function reconnectKey(roomId: string): string {
  return `daifugo-spark-reconnect-${roomId}`;
}

function saveReconnect(record: ReconnectRecord): void {
  localStorage.setItem(reconnectKey(record.roomId), JSON.stringify(record));
}

function loadReconnect(roomId: string): ReconnectRecord | undefined {
  try {
    const raw = localStorage.getItem(reconnectKey(roomId));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as ReconnectRecord;
    return value.roomId === roomId && typeof value.token === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function freshToken(): string {
  return crypto.randomUUID();
}

async function replaceActiveSession(session: SparkP2PSession): Promise<void> {
  if (activeSession && activeSession !== session) await activeSession.stop(false);
  activeSession = session;
}

export function getActiveSparkSession(): SparkP2PSession | undefined {
  return activeSession;
}

export async function startRoomPresence(
  roomId: string,
  onError: (error: Error) => void,
  onRestored?: () => void,
): Promise<() => void> {
  if (import.meta.env.DEV && isE2ETransport()) {
    await e2eCall({ op: "presence", roomId });
    return () => undefined;
  }
  const session = activeSession;
  if (!session || session.roomId !== roomId) {
    throw new Error("failed-precondition: P2P部屋セッションがありません");
  }
  let previous: "webrtc" | "firebase" | "offline" | undefined;
  return session.onMode((mode) => {
    if (previous === "offline" && mode !== "offline") onRestored?.();
    previous = mode;
    if (mode === "offline") onError(new Error("P2P接続がオフラインです"));
  });
}

function actionId(): string {
  return crypto.randomUUID();
}

export async function sendCommand<
  TResponse extends Record<string, unknown> = Record<string, unknown>,
>(name: CommandName, payload: BaseCommand & Record<string, unknown> = {}): Promise<TResponse> {
  const commandPayload = {
    ...payload,
    clientActionId: payload.clientActionId ?? actionId(),
  };
  if (import.meta.env.DEV && isE2ETransport()) {
    return e2eCall<TResponse>({ op: "command", name, payload: commandPayload });
  }
  if (name === "saveAvatarProfile" && !activeSession) return {} as TResponse;
  if (!activeSession) throw new Error("failed-precondition: P2P部屋へ接続していません");
  const roomId = activeSession.roomId;
  const result = (await activeSession.sendCommand(name, commandPayload)) as TResponse;
  if (name === "leaveRoom") {
    await activeSession.stop();
    activeSession = undefined;
    localStorage.removeItem(reconnectKey(roomId));
  }
  return result;
}

export async function createRoom(profile: {
  name: string;
  avatar: AvatarProfileV1;
}): Promise<{ roomId: string; reconnectToken?: string }> {
  if (import.meta.env.DEV && isE2ETransport()) {
    return sendCommand("createRoom", {
      profile,
      settings: { mode: "normal", blindCount: 0 },
    });
  }
  const { db, user } = await getFirebase();
  const session = await SparkP2PSession.create(db, user, profile);
  await replaceActiveSession(session);
  const token = freshToken();
  saveReconnect({ roomId: session.roomId, token, role: "player", profile });
  return { roomId: session.roomId, reconnectToken: token };
}

export async function joinRoom(
  roomId: string,
  role: Role,
  profile: { name: string; avatar: AvatarProfileV1 },
): Promise<{ roomId: string; reconnectToken?: string }> {
  const normalized = roomId.toUpperCase().slice(0, 5);
  if (import.meta.env.DEV && isE2ETransport()) {
    const identity = await getRoomCommandBase(normalized);
    const result = await sendCommand<{ reconnectToken?: string }>(
      role === "player" ? "joinRoomAsPlayer" : "joinRoomAsSpectator",
      { ...identity, profile },
    );
    return { roomId: normalized, ...result };
  }
  const { db, user } = await getFirebase();
  const session = await SparkP2PSession.connect(db, user, normalized, role, profile);
  await replaceActiveSession(session);
  const token = freshToken();
  saveReconnect({ roomId: normalized, token, role, profile });
  return { roomId: normalized, reconnectToken: token };
}

export async function getRoomCommandBase(
  roomId: string,
): Promise<{ roomId: string; gameId: string | null; expectedRevision: number }> {
  if (import.meta.env.DEV && isE2ETransport()) {
    return e2eCall({ op: "roomBase", roomId });
  }
  const view = activeSession?.roomId === roomId ? activeSession.currentView() : undefined;
  if (view) {
    return { roomId, gameId: view.gameId ?? null, expectedRevision: view.revision };
  }
  const { db } = await getFirebase();
  const snapshot = await getDoc(doc(db, "sparkRoomSnapshots", roomId));
  if (!snapshot.exists()) throw new Error("not-found: 指定された部屋が見つかりません");
  const data = snapshot.data();
  return {
    roomId,
    gameId:
      data.game && typeof data.game === "object" && typeof data.game.id === "string"
        ? data.game.id
        : null,
    expectedRevision: Number(data.revision ?? 0),
  };
}

export async function reconnectWithToken(
  roomId: string,
  reconnectToken: string,
): Promise<{ reconnectToken: string; reconnectOutcome: "restored" | "expired" }> {
  if (import.meta.env.DEV && isE2ETransport()) {
    return sendCommand("reconnectRoom", {
      ...(await getRoomCommandBase(roomId)),
      reconnectToken,
    }) as Promise<{ reconnectToken: string; reconnectOutcome: "restored" | "expired" }>;
  }
  const saved = loadReconnect(roomId);
  if (saved && saved.token !== reconnectToken) {
    throw new Error("permission-denied: 再接続情報が更新されています");
  }
  const { db, user } = await getFirebase();
  const session = await SparkP2PSession.connect(
    db,
    user,
    roomId,
    saved?.role ?? "spectator",
    saved?.profile,
  );
  await replaceActiveSession(session);
  const nextToken = freshToken();
  const member = session.currentMember();
  if (saved) saveReconnect({ ...saved, token: nextToken });
  else if (member) {
    saveReconnect({
      roomId,
      token: nextToken,
      role: member.role,
      profile: { name: member.name, avatar: member.avatar },
    });
  }
  return { reconnectToken: nextToken, reconnectOutcome: "restored" };
}

export function subscribeRoomView(
  roomId: string,
  uid: string,
  onView: (view: RoomView) => void,
  onError: (error: Error) => void,
): Promise<Unsubscribe> {
  if (import.meta.env.DEV && isE2ETransport()) {
    return Promise.resolve(subscribeE2ERoomView(roomId, uid, onView, onError));
  }
  const session = activeSession;
  if (!session || session.roomId !== roomId || session.uid !== uid) {
    return Promise.reject(new Error("failed-precondition: P2P部屋ビューがありません"));
  }
  return Promise.resolve(session.onView(onView));
}

export async function subscribePublicRooms(
  onRooms: (rooms: PublicRoom[]) => void,
  onError: (error: Error) => void,
): Promise<Unsubscribe> {
  if (import.meta.env.DEV && isE2ETransport()) {
    return subscribeE2EPublicRooms(onRooms, onError);
  }
  const { db } = await getFirebase();
  await cleanupStaleSparkRooms(db);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const publicQuery = query(
    collection(db, "sparkRoomDirectory"),
    where("visibility", "==", "public"),
    where("heartbeatAtMs", ">=", cutoff),
    orderBy("heartbeatAtMs", "desc"),
    limit(40),
  );
  return onSnapshot(
    publicQuery,
    (snapshot) =>
      onRooms(
        snapshot.docs.map((roomDocument) => {
          const data = roomDocument.data();
          return {
            roomId: roomDocument.id,
            hostName: String(data.hostName ?? "ゲスト"),
            hostAvatar: migrateAvatar(data.hostAvatar),
            playerCount: Number(data.playerCount ?? 0),
            spectatorCount: Number(data.spectatorCount ?? 0),
            mode: data.mode === "blind" ? "blind" : "normal",
            blindCount: Number(data.blindCount ?? 0),
            phase: data.phase === "waiting" ? "waiting" : "playing",
            createdAtMs: Number(data.createdAtMs ?? Date.now()),
          } satisfies PublicRoom;
        }),
      ),
    (cause) => onError(new Error(`公開部屋の取得に失敗しました: ${cause.message}`)),
  );
}

export function firebaseErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "不明な通信エラーです";
  if (message.includes("auth/configuration-not-found")) {
    return "Firebase匿名認証が未設定です。Authenticationで匿名ログインを有効にしてください。";
  }
  if (message.includes("resource-exhausted")) return message.split(":").slice(1).join(":").trim();
  if (message.includes("stale revision") || message.includes("aborted")) {
    return "部屋の状態が更新されています。もう一度操作してください。";
  }
  if (message.includes("permission-denied")) {
    return "このP2P部屋へ接続する権限がありません。部屋を再読み込みしてください。";
  }
  if (message.includes("failed-precondition")) {
    return message.split(":").slice(1).join(":").trim() || "部屋の状態が更新されています。";
  }
  if (message.includes("not-found")) return "指定された部屋が見つかりません。";
  if (message.includes("unavailable") || message.includes("network")) {
    return "ホストへ接続できません。通信状態を確認してください。";
  }
  return message;
}
