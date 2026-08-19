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
  Timestamp,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import {
  connectDatabaseEmulator,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  serverTimestamp as databaseServerTimestamp,
  set,
  type Database,
} from "firebase/database";
import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import { migrateAvatar } from "@daifugo/avatar-schema";
import type { PublicRoom, Role, RoomView } from "../app/model";

type FirebaseContext = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  rtdb: Database;
  functions: Functions;
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
if (requiredEnv.projectId && requiredEnv.projectId !== "daifugo-8e039")
  throw new Error(`接続先Project IDが不正です: ${requiredEnv.projectId}`);

let singleton: Promise<FirebaseContext> | undefined;
let emulatorsConnected = false;

export const firebaseMode = {
  projectId: requiredEnv.projectId || "未設定",
  emulator: import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true",
  configured: missing.length === 0,
  missing,
};

function authReady(auth: Auth): Promise<User> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        if (user) resolve(user);
        else
          signInAnonymously(auth)
            .then(({ user: signedIn }) => resolve(signedIn))
            .catch(reject);
      },
      reject,
    );
  });
}

export async function getFirebase(): Promise<FirebaseContext> {
  if (!firebaseMode.configured)
    throw new Error(
      `Firebase接続設定が不足しています（${missing.join("、")}）。apps/web/.env.exampleを参照してください。`,
    );
  singleton ??= (async () => {
    const app = initializeApp(requiredEnv);
    const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY;
    if (appCheckSiteKey && !firebaseMode.emulator)
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    const auth = getAuth(app);
    const db = getFirestore(app);
    const databaseUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL;
    const rtdb = databaseUrl ? getDatabase(app, databaseUrl) : getDatabase(app);
    const functions = getFunctions(
      app,
      import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "asia-northeast1",
    );
    if (firebaseMode.emulator && !emulatorsConnected) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
      connectDatabaseEmulator(rtdb, "127.0.0.1", 9000);
      connectFunctionsEmulator(functions, "127.0.0.1", 5001);
      emulatorsConnected = true;
    }
    const user = await authReady(auth);
    return { app, auth, db, rtdb, functions, user };
  })();
  return singleton;
}

export function presenceRecord(
  online: boolean,
  connectionId: string,
  lastChanged: unknown,
): { online: boolean; connectionId: string; lastChanged: unknown } {
  return { online, connectionId, lastChanged };
}

export async function startRoomPresence(
  roomId: string,
  onError: (error: Error) => void,
  onRestored?: () => void,
): Promise<() => void> {
  const { rtdb, user } = await getFirebase();
  const presence = ref(rtdb, `v2Presence/${roomId}/${user.uid}`);
  const connected = ref(rtdb, ".info/connected");
  const connectionId = crypto.randomUUID();
  const disconnect = onDisconnect(presence);
  let stopped = false;
  let connectedOnce = false;
  let disconnectedAfterConnect = false;
  const unsubscribe = onValue(
    connected,
    (snapshot) => {
      if (stopped) return;
      if (snapshot.val() !== true) {
        if (connectedOnce) disconnectedAfterConnect = true;
        return;
      }
      const shouldRestoreMembership = disconnectedAfterConnect;
      connectedOnce = true;
      disconnectedAfterConnect = false;
      disconnect
        .set(presenceRecord(false, connectionId, databaseServerTimestamp()))
        .then(() => set(presence, presenceRecord(true, connectionId, databaseServerTimestamp())))
        .then(() => {
          if (shouldRestoreMembership) onRestored?.();
        })
        .catch((cause: unknown) =>
          onError(cause instanceof Error ? cause : new Error("presenceの更新に失敗しました")),
        );
    },
    (cause) => onError(new Error(`presenceへ接続できません: ${cause.message}`)),
  );
  return () => {
    stopped = true;
    unsubscribe();
    void disconnect.cancel().catch(() => undefined);
    void set(presence, presenceRecord(false, connectionId, databaseServerTimestamp())).catch(
      () => undefined,
    );
  };
}

function actionId(): string {
  return crypto.randomUUID();
}

export async function sendCommand<
  TResponse extends Record<string, unknown> = Record<string, unknown>,
>(name: CommandName, payload: BaseCommand & Record<string, unknown> = {}): Promise<TResponse> {
  const { functions } = await getFirebase();
  const callable = httpsCallable<Record<string, unknown>, TResponse>(functions, name);
  const result = await callable({
    ...payload,
    clientActionId: payload.clientActionId ?? actionId(),
  });
  return result.data;
}

export async function createRoom(profile: {
  name: string;
  avatar: AvatarProfileV1;
}): Promise<{ roomId: string; reconnectToken?: string }> {
  return sendCommand("createRoom", { profile, settings: { mode: "normal", blindCount: 0 } });
}

export async function joinRoom(
  roomId: string,
  role: Role,
  profile: { name: string; avatar: AvatarProfileV1 },
): Promise<{ roomId: string; reconnectToken?: string }> {
  const identity = await getRoomCommandBase(roomId);
  const result = await sendCommand<{ reconnectToken?: string }>(
    role === "player" ? "joinRoomAsPlayer" : "joinRoomAsSpectator",
    { ...identity, profile },
  );
  return { roomId, ...result };
}

export async function getRoomCommandBase(
  roomId: string,
): Promise<{ roomId: string; gameId: string | null; expectedRevision: number }> {
  const { db } = await getFirebase();
  const snapshot = await getDoc(doc(db, "v2RoomViews", roomId));
  if (!snapshot.exists()) throw new Error("指定された部屋が見つかりません");
  const data = snapshot.data();
  if (typeof data.revision !== "number") throw new Error("部屋の接続情報が不正です");
  return {
    roomId,
    gameId: typeof data.gameId === "string" ? data.gameId : null,
    expectedRevision: data.revision,
  };
}

export async function reconnectWithToken(
  roomId: string,
  reconnectToken: string,
): Promise<{ reconnectToken: string; reconnectOutcome: "restored" | "expired" }> {
  return sendCommand("reconnectRoom", { ...(await getRoomCommandBase(roomId)), reconnectToken });
}

export function subscribeRoomView(
  roomId: string,
  uid: string,
  onView: (view: RoomView) => void,
  onError: (error: Error) => void,
): Promise<Unsubscribe> {
  return getFirebase().then(({ db }) =>
    onSnapshot(
      doc(db, "v2RoomViews", roomId, "viewers", uid),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (
          typeof data.revision !== "number" ||
          !Array.isArray(data.players) ||
          !Array.isArray(data.hand)
        ) {
          onError(new Error("サーバーから受け取った部屋ビューの形式が不正です"));
          return;
        }
        const chat = Array.isArray(data.chat)
          ? data.chat.map((entry: Record<string, unknown>) => ({
              id: String(entry.id ?? ""),
              uid: String(entry.uid ?? ""),
              name: String(entry.name ?? ""),
              role: entry.role === "spectator" ? ("spectator" as const) : ("player" as const),
              text: String(entry.text ?? ""),
              atMs: timestampMs(entry.createdAt),
            }))
          : undefined;
        onView({ ...data, ...(chat ? { chat } : {}) } as RoomView);
      },
      (cause) => onError(new Error(`部屋との同期に失敗しました: ${cause.message}`)),
    ),
  );
}

function timestampMs(value: unknown): number {
  return value instanceof Timestamp
    ? value.toMillis()
    : typeof value === "number"
      ? value
      : Date.now();
}

export async function subscribePublicRooms(
  onRooms: (rooms: PublicRoom[]) => void,
  onError: (error: Error) => void,
): Promise<Unsubscribe> {
  const { db } = await getFirebase();
  const cutoff = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  const publicQuery = query(
    collection(db, "v2RoomViews"),
    where("visibility", "==", "public"),
    where("heartbeatAt", ">=", cutoff),
    orderBy("heartbeatAt", "desc"),
    limit(40),
  );
  return onSnapshot(
    publicQuery,
    (snapshot) =>
      onRooms(
        snapshot.docs.map((roomDoc) => {
          const data = roomDoc.data();
          return {
            roomId: roomDoc.id,
            hostName: String(data.hostName ?? "ゲスト"),
            hostAvatar: migrateAvatar(data.hostAvatar),
            playerCount: Number(data.playerCount ?? 0),
            spectatorCount: Number(data.spectatorCount ?? 0),
            mode: data.mode === "blind" ? "blind" : "normal",
            blindCount: Number(data.blindCount ?? 1),
            phase: data.phase === "waiting" ? "waiting" : "playing",
            createdAtMs: timestampMs(data.createdAt),
          } satisfies PublicRoom;
        }),
      ),
    (cause) => onError(new Error(`公開部屋の取得に失敗しました: ${cause.message}`)),
  );
}

export function firebaseErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "不明な通信エラーです";
  if (message.includes("auth/configuration-not-found"))
    return "Firebase匿名認証が未設定です。プロジェクト管理者がAuthenticationを有効にしてください。";
  if (message.includes("permission-denied"))
    return "この操作を行う権限がありません。部屋を再読み込みしてください。";
  if (message.includes("unauthenticated"))
    return "認証の有効期限が切れました。再接続してください。";
  if (message.includes("failed-precondition"))
    return "部屋の状態が更新されています。最新の状態でもう一度お試しください。";
  if (message.includes("unavailable") || message.includes("network"))
    return "サーバーへ接続できません。通信状態を確認してください。";
  return message;
}
