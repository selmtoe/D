import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import type { AvatarProfileV1 } from "@daifugo/avatar-schema";
import type { PublicRoom, Role, RoomView } from "../app/model";
import { parseCue, type CueEvent } from "./peerCues";
import {
  isValidRoomActionId,
  isValidSparkPeerId,
  SparkAuthority,
  type SparkMember,
  type SparkRoomSnapshot,
} from "./sparkAuthority";

interface DirectoryDocument extends PublicRoom {
  visibility: "public";
  coordinatorUid: string;
  coordinatorPeerId: string;
  heartbeatAtMs: number;
  heartbeatAt?: unknown;
  updatedAtMs: number;
  lastActivityAtMs?: number;
  lastActivityAt?: unknown;
  authorityRevision?: number;
}

interface RelayDocument {
  senderUid: string;
  senderPeerId: string;
  targetUid: string;
  targetPeerId: string;
  kind: string;
  payload: string;
  createdAtMs: number;
  expiresAtMs: number;
  createdAt?: unknown;
}

export type WireMessage =
  | {
      type: "hello";
      requestId: string;
      role: Role;
      profile: { name: string; avatar: AvatarProfileV1 };
    }
  | {
      type: "command";
      requestId: string;
      name: string;
      payload: Record<string, unknown>;
    }
  | { type: "response"; requestId: string; ok: true; result: Record<string, unknown> }
  | { type: "response"; requestId: string; ok: false; error: string }
  | { type: "view"; view: RoomView }
  | { type: "cue"; cue: CueEvent; senderUid?: string }
  | { type: "evicted"; reason: "kick" };

interface PeerState {
  uid: string;
  peerId: string;
  connection: RTCPeerConnection;
  channel?: RTCDataChannel;
  pendingCandidates: RTCIceCandidateInit[];
}

type EarlyIceCandidate = {
  candidate: RTCIceCandidateInit;
  receivedAtMs: number;
};

type PendingRequest = {
  promise: Promise<Record<string, unknown>>;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  targetUid: string;
  targetPeerId: string;
  fingerprint: string;
};

const HEARTBEAT_MS = 30_000;
const PEER_RECONNECT_MS = 30_000;
const COORDINATOR_STALE_MS = 75_000;
const COORDINATOR_ELECTION_RETRY_MS = 15_000;
const MEMBER_OFFLINE_MS = 70_000;
const DISCONNECT_LIMIT_MS = 120_000;
const RELAY_TTL_MS = 10 * 60_000;
const EARLY_ICE_TTL_MS = 60_000;
const MAX_EARLY_ICE_PEERS = 48;
const MAX_EARLY_ICE_PER_PEER = 32;
const MAX_EARLY_ICE_TOTAL = 256;
const MAX_ACTIVE_PEERS = 48;
const MAX_PENDING_PEER_HANDSHAKES = 4;
const PENDING_PEER_HANDSHAKE_TTL_MS = 20_000;
const MAX_COMMAND_WIRE_BYTES = 64 * 1_024;
const MAX_WIRE_BYTES = 256 * 1_024;
export const SPARK_ROOM_STALE_MS = 30 * 60_000;
const STALE_CLEANUP_BATCH_SIZE = 12;

export function nextSparkActivityMetadata(
  markActivity: boolean,
  previous: { lastActivityAtMs?: number; authorityRevision?: number } | undefined,
  now: number,
  snapshotUpdatedAtMs: number,
): { recordsActivity: boolean; lastActivityAtMs: number } {
  const recordsActivity =
    markActivity || previous?.lastActivityAtMs == null || previous.authorityRevision == null;
  return {
    recordsActivity,
    lastActivityAtMs: recordsActivity ? now : (previous?.lastActivityAtMs ?? snapshotUpdatedAtMs),
  };
}

export function sparkDirectoryHeartbeatMs(directory: {
  heartbeatAtMs?: number;
  heartbeatAt?: unknown;
}): number {
  const timestamp = directory.heartbeatAt;
  if (timestamp && typeof timestamp === "object") {
    const toMillis = (timestamp as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") {
      try {
        const value = Number(toMillis.call(timestamp));
        if (Number.isFinite(value)) return value;
      } catch {
        // Fall back to the rolling-deploy millisecond field below.
      }
    }
  }
  const fallback = Number(directory.heartbeatAtMs ?? 0);
  return Number.isFinite(fallback) ? fallback : 0;
}

function firestoreTimestampMs(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return undefined;
  try {
    const milliseconds = Number(toMillis.call(value));
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  } catch {
    return undefined;
  }
}

export function sparkEstimatedServerNowMs(
  directory: { heartbeatAtMs?: number } | undefined,
  directoryObservedAtMs: number,
  localNowMs: number,
): number {
  const heartbeatAtMs = directory?.heartbeatAtMs;
  if (!Number.isFinite(heartbeatAtMs) || !Number.isFinite(directoryObservedAtMs)) {
    return localNowMs;
  }
  return Number(heartbeatAtMs) + Math.max(0, localNowMs - directoryObservedAtMs);
}

export function sparkRelayExpiresAtMs(relay: { createdAt?: unknown; expiresAtMs: number }): number {
  const serverCreatedAtMs = firestoreTimestampMs(relay.createdAt);
  return serverCreatedAtMs === undefined ? relay.expiresAtMs : serverCreatedAtMs + RELAY_TTL_MS;
}

function normalizeDirectory(directory: DirectoryDocument): DirectoryDocument {
  return {
    ...directory,
    coordinatorPeerId: isValidSparkPeerId(directory.coordinatorPeerId)
      ? directory.coordinatorPeerId
      : "",
    heartbeatAtMs: sparkDirectoryHeartbeatMs(directory),
  };
}

/**
 * Best-effort Spark-plan garbage collection. Client time is used only to find
 * candidates; Firestore Rules compare the current directory heartbeat against
 * request.time before either delete is authorized. The recovery snapshot must
 * disappear first so a room can never be advertised without its authority
 * state after cleanup completes.
 */
export async function cleanupStaleSparkRooms(db: Firestore): Promise<number> {
  const cutoff = Timestamp.fromMillis(Date.now() - SPARK_ROOM_STALE_MS);
  const candidates = new Map<string, ReturnType<typeof doc>>();
  // heartbeatAt is queried as a migration fallback for old directory documents
  // that predate lastActivityAt. Rules use lastActivityAt whenever it exists,
  // so including a fresh new-format document here can never delete it early.
  for (const field of ["lastActivityAt", "heartbeatAt"] as const) {
    try {
      const batch = await getDocs(
        query(
          collection(db, "sparkRoomDirectory"),
          where(field, "<", cutoff),
          limit(STALE_CLEANUP_BATCH_SIZE),
        ),
      );
      for (const candidate of batch.docs) candidates.set(candidate.id, candidate.ref);
    } catch {
      // A failed best-effort query must not block the room flow or the other
      // (legacy/new-format) candidate query.
    }
  }

  let removed = 0;
  for (const [roomId, directoryRef] of candidates) {
    if (!/^[A-HJ-NP-Z2-9]{5}$/.test(roomId)) continue;
    const snapshotRef = doc(db, "sparkRoomSnapshots", roomId);
    try {
      // Rules re-read the current directory and reject this if a heartbeat won
      // the race after the query. Never reverse these two operations.
      await deleteDoc(snapshotRef);
      if ((await getDoc(snapshotRef)).exists()) continue;
      await deleteDoc(directoryRef);
      removed += 1;
    } catch {
      // Cleanup is opportunistic. A concurrent heartbeat or another cleaner is
      // an expected race and must not block room creation/connection.
    }
  }
  return removed;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value);
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function wireRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseSparkIceCandidate(value: unknown): RTCIceCandidateInit | null {
  if (!wireRecord(value)) return null;
  if (typeof value.candidate !== "string" || value.candidate.length > 4_096) return null;
  if (
    value.sdpMid !== undefined &&
    value.sdpMid !== null &&
    (typeof value.sdpMid !== "string" || value.sdpMid.length > 256)
  )
    return null;
  if (
    value.sdpMLineIndex !== undefined &&
    value.sdpMLineIndex !== null &&
    (typeof value.sdpMLineIndex !== "number" ||
      !Number.isInteger(value.sdpMLineIndex) ||
      value.sdpMLineIndex < 0 ||
      value.sdpMLineIndex > 65_535)
  )
    return null;
  if (
    value.usernameFragment !== undefined &&
    value.usernameFragment !== null &&
    (typeof value.usernameFragment !== "string" || value.usernameFragment.length > 256)
  )
    return null;
  return {
    candidate: value.candidate,
    ...(value.sdpMid !== undefined ? { sdpMid: value.sdpMid as string | null } : {}),
    ...(value.sdpMLineIndex !== undefined
      ? { sdpMLineIndex: value.sdpMLineIndex as number | null }
      : {}),
    ...(value.usernameFragment !== undefined
      ? { usernameFragment: value.usernameFragment as string | null }
      : {}),
  };
}

function validWireId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function wireByteSize(payload: string): number {
  return new TextEncoder().encode(payload).byteLength;
}

export function parseSparkWire(payload: string): WireMessage | null {
  try {
    if (payload.length > MAX_WIRE_BYTES) return null;
    const payloadBytes = wireByteSize(payload);
    if (payloadBytes > MAX_WIRE_BYTES) return null;
    const value = JSON.parse(payload) as unknown;
    if (!wireRecord(value) || typeof value.type !== "string") return null;
    if (
      (value.type === "hello" || value.type === "command" || value.type === "response") &&
      !validWireId(value.requestId)
    ) {
      return null;
    }
    if (value.type === "view" && value.view && typeof value.view === "object") {
      return value as unknown as WireMessage;
    }
    if (value.type === "cue") {
      const cue = parseCue(value.cue);
      const senderUid = value.senderUid;
      if (
        !cue ||
        (senderUid !== undefined &&
          (typeof senderUid !== "string" || senderUid.length === 0 || senderUid.length > 128))
      )
        return null;
      return { type: "cue", cue, ...(senderUid ? { senderUid } : {}) };
    }
    if (
      value.type === "hello" &&
      (value.role === "player" || value.role === "spectator") &&
      wireRecord(value.profile) &&
      typeof value.profile.name === "string" &&
      value.profile.name.length <= 128 &&
      wireRecord(value.profile.avatar)
    ) {
      return value as unknown as WireMessage;
    }
    if (
      value.type === "command" &&
      payloadBytes <= MAX_COMMAND_WIRE_BYTES &&
      typeof value.name === "string" &&
      value.name.length > 0 &&
      value.name.length <= 64 &&
      wireRecord(value.payload) &&
      (value.payload.clientActionId === undefined ||
        isValidRoomActionId(value.payload.clientActionId))
    ) {
      return value as unknown as WireMessage;
    }
    if (
      value.type === "response" &&
      ((value.ok === true && wireRecord(value.result)) ||
        (value.ok === false && typeof value.error === "string" && value.error.length <= 1_000))
    ) {
      return value as unknown as WireMessage;
    }
    if (value.type === "evicted" && value.reason === "kick") {
      return value as unknown as WireMessage;
    }
    return null;
  } catch {
    return null;
  }
}

function randomRoomId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function randomPeerId(uid: string): string {
  return `${uid.slice(0, 40)}_${crypto.randomUUID()}`;
}

export interface SparkSessionOptions {
  db: Firestore;
  user: User;
  roomId: string;
  peerId?: string;
}

export class SparkP2PSession {
  readonly roomId: string;
  readonly uid: string;
  readonly peerId: string;
  private readonly db: Firestore;
  private authority?: SparkAuthority;
  private role: Role = "spectator";
  private profile?: { name: string; avatar: AvatarProfileV1 };
  private coordinatorUid = "";
  private coordinatorPeerId = "";
  private directory?: DirectoryDocument;
  private directoryObservedAtMs = Date.now();
  private lastView?: RoomView;
  private readonly peers = new Map<string, PeerState>();
  private readonly earlyCandidates = new Map<string, EarlyIceCandidate[]>();
  private readonly pendingPeerHandshakes = new Map<string, number>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly processedRequests = new Map<string, WireMessage>();
  private readonly viewListeners = new Set<(view: RoomView) => void>();
  private readonly cueListeners = new Set<(cue: CueEvent, senderUid: string) => void>();
  private readonly evictionListeners = new Set<(reason: "kick" | "room-closed") => void>();
  private readonly modeListeners = new Set<(mode: "webrtc" | "firebase" | "offline") => void>();
  private readonly unsubscribes: Unsubscribe[] = [];
  private readonly disconnectSince = new Map<string, number>();
  private readonly presenceSeen = new Map<
    string,
    { online: boolean; peerId: string; atMs: number }
  >();
  private intervals: Array<ReturnType<typeof setInterval>> = [];
  private stopped = false;
  private intentionalLeave = false;
  private evictionReason?: "kick" | "room-closed";
  private tickPending = false;
  private coordinatorQueue: Promise<void> = Promise.resolve();
  private mode: "webrtc" | "firebase" | "offline" = "firebase";
  private presenceListening = false;
  private presenceWriteQueue: Promise<void> = Promise.resolve();
  private lastPeerConnectAttemptAt = 0;
  private lastCoordinatorElectionAttemptAt = 0;

  private constructor(options: SparkSessionOptions) {
    this.db = options.db;
    this.roomId = options.roomId;
    this.uid = options.user.uid;
    this.peerId = options.peerId ?? randomPeerId(options.user.uid);
  }

  static async create(
    db: Firestore,
    user: User,
    profile: { name: string; avatar: AvatarProfileV1 },
  ): Promise<SparkP2PSession> {
    await cleanupStaleSparkRooms(db);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const roomId = randomRoomId();
      const directoryRef = doc(db, "sparkRoomDirectory", roomId);
      if ((await getDoc(directoryRef)).exists()) continue;
      const session = new SparkP2PSession({ db, user, roomId });
      session.role = "player";
      session.profile = plain(profile);
      session.authority = SparkAuthority.create(roomId, user.uid, session.peerId, profile);
      session.coordinatorUid = user.uid;
      session.coordinatorPeerId = session.peerId;
      // Snapshot writes are authorized through an existing directory lease.
      // Creation therefore has its own directory -> snapshot contract; normal
      // mutations and handoff keep the recovery-safe snapshot -> directory order.
      await session.persistInitialRoom();
      await session.startCommon();
      return session;
    }
    throw new Error("resource-exhausted: 部屋IDを確保できませんでした");
  }

  static async connect(
    db: Firestore,
    user: User,
    roomId: string,
    role: Role,
    profile?: { name: string; avatar: AvatarProfileV1 },
  ): Promise<SparkP2PSession> {
    const normalized = roomId.toUpperCase().slice(0, 5);
    await cleanupStaleSparkRooms(db);
    const directorySnapshot = await getDoc(doc(db, "sparkRoomDirectory", normalized));
    if (!directorySnapshot.exists()) throw new Error("not-found: 指定された部屋が見つかりません");
    const directory = normalizeDirectory(directorySnapshot.data() as DirectoryDocument);
    let recoverySnapshot: SparkRoomSnapshot | undefined;
    if (!directory.coordinatorPeerId) {
      const recoveryDocument = await getDoc(doc(db, "sparkRoomSnapshots", normalized));
      recoverySnapshot = recoveryDocument.data() as SparkRoomSnapshot | undefined;
      const recoveryPeerId = recoverySnapshot?.members?.[directory.coordinatorUid]?.peerId;
      if (isValidSparkPeerId(recoveryPeerId)) directory.coordinatorPeerId = recoveryPeerId;
    }
    const session = new SparkP2PSession({ db, user, roomId: normalized });
    session.directory = directory;
    session.directoryObservedAtMs = Date.now();
    session.coordinatorUid = directory.coordinatorUid;
    session.coordinatorPeerId = directory.coordinatorPeerId;

    let resolvedProfile = profile;
    let resolvedRole = role;
    if (!resolvedProfile) {
      const snapshot =
        recoverySnapshot ??
        ((await getDoc(doc(db, "sparkRoomSnapshots", normalized))).data() as
          SparkRoomSnapshot | undefined);
      const member = snapshot?.members[user.uid];
      if (!member) throw new Error("permission-denied: 再接続情報がありません");
      resolvedProfile = { name: member.name, avatar: member.avatar };
      resolvedRole = member.role;
    }
    session.role = resolvedRole;
    session.profile = plain(resolvedProfile);

    if (directory.coordinatorUid === user.uid) {
      const snapshot =
        recoverySnapshot ??
        ((await getDoc(doc(db, "sparkRoomSnapshots", normalized))).data() as
          SparkRoomSnapshot | undefined);
      if (!snapshot) throw new Error("not-found: 部屋状態がありません");
      session.authority = SparkAuthority.restore(snapshot);
      session.authority.setCoordinator(user.uid, session.peerId);
      session.coordinatorPeerId = session.peerId;
    }
    await session.startCommon();
    try {
      if (session.authority) {
        await session.persistAndBroadcast();
      } else {
        // A returning non-host can arrive after every live peer has left an otherwise
        // recoverable room. Probe the lease once before the 15-second hello timeout;
        // Firestore Rules, not the candidate's wall clock, decides whether takeover is legal.
        await session.tryCoordinatorElection(Date.now()).catch(() => undefined);
        if (!session.authority) {
          await session.connectToCoordinator();
          await session.request({
            type: "hello",
            requestId: crypto.randomUUID(),
            role: resolvedRole,
            profile: plain(resolvedProfile),
          });
          await session.waitForInitialView();
        }
      }
      return session;
    } catch (cause) {
      // startCommon installs Firestore listeners and recurring heartbeats. A
      // failed handshake must not leave that unreturned session running.
      await session.stop(false);
      throw cause;
    }
  }

  private async startCommon(): Promise<void> {
    await this.writePresence(true);
    this.listenForRelays("sparkSignals", (relay) => {
      void this.handleSignal(relay).catch(() => {
        this.closePeer(relay.senderPeerId);
        if (!this.authority) this.setMode(navigator.onLine ? "firebase" : "offline");
      });
    });
    this.listenForRelays("sparkMailboxes", (relay) => {
      const wire = parseSparkWire(relay.payload);
      if (wire) this.handleWire(wire, relay.senderUid, relay.senderPeerId);
    });
    this.listenDirectory();
    if (this.authority) this.listenPresence();
    this.intervals.push(
      setInterval(() => void this.writePresence(true), HEARTBEAT_MS),
      setInterval(() => {
        if (this.tickPending) return;
        this.tickPending = true;
        void this.tick()
          .catch(() => this.setMode(navigator.onLine ? "firebase" : "offline"))
          .finally(() => {
            this.tickPending = false;
          });
      }, 2_000),
    );
    const pageHide = () => void this.writePresence(false);
    addEventListener("pagehide", pageHide);
    this.unsubscribes.push(() => removeEventListener("pagehide", pageHide));
  }

  private enqueueCoordinator<T>(task: () => Promise<T>): Promise<T> {
    const result = this.coordinatorQueue.then(async () => {
      if (this.stopped) throw new Error("offline: P2P接続は終了しています");
      return task();
    });
    this.coordinatorQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private handleSnapshotFailure(): void {
    const peerConnected = [...this.peers.values()].some(
      (peer) => peer.channel?.readyState === "open",
    );
    this.setMode(peerConnected ? "webrtc" : "offline");
  }

  private listenForRelays(
    collectionName: "sparkSignals" | "sparkMailboxes",
    receive: (relay: RelayDocument) => void,
  ): void {
    const items = query(
      collection(this.db, collectionName, this.roomId, "items"),
      where("targetUid", "==", this.uid),
    );
    this.unsubscribes.push(
      onSnapshot(
        items,
        (snapshot) => {
          for (const change of snapshot.docChanges()) {
            if (change.type !== "added") continue;
            const relay = change.doc.data() as RelayDocument;
            if (relay.targetUid !== this.uid) continue;
            if (
              !isValidSparkPeerId(relay.senderPeerId) ||
              !isValidSparkPeerId(relay.targetPeerId)
            ) {
              void deleteDoc(change.doc.ref).catch(() => undefined);
              continue;
            }
            const serverNowMs = sparkEstimatedServerNowMs(
              this.directory,
              this.directoryObservedAtMs,
              Date.now(),
            );
            if (sparkRelayExpiresAtMs(relay) < serverNowMs) {
              void deleteDoc(change.doc.ref).catch(() => undefined);
              continue;
            }
            if (relay.targetPeerId !== this.peerId) continue;
            receive(relay);
            void deleteDoc(change.doc.ref).catch(() => undefined);
          }
        },
        () => this.handleSnapshotFailure(),
      ),
    );
  }

  private listenDirectory(): void {
    this.unsubscribes.push(
      onSnapshot(
        doc(this.db, "sparkRoomDirectory", this.roomId),
        (snapshot) => {
          if (!snapshot.exists()) {
            this.setMode("offline");
            if (!this.intentionalLeave) this.notifyEvicted("room-closed");
            void this.stop(false);
            return;
          }
          const next = normalizeDirectory(snapshot.data() as DirectoryDocument);
          this.directoryObservedAtMs = Date.now();
          const previousCoordinatorPeerId = this.coordinatorPeerId;
          const changed = next.coordinatorPeerId !== this.coordinatorPeerId;
          this.directory = next;
          this.coordinatorUid = next.coordinatorUid;
          this.coordinatorPeerId = next.coordinatorPeerId;
          if (next.coordinatorUid === this.uid && !this.authority) {
            void this.promoteToCoordinator().catch(() =>
              this.setMode(navigator.onLine ? "firebase" : "offline"),
            );
          } else if (next.coordinatorUid !== this.uid && this.authority) {
            // A stale coordinator can come back after another peer won the
            // election. Demote only after any in-flight authority write so an
            // explicit host transfer can finish its snapshot/directory pair.
            void this.enqueueCoordinator(async () => {
              if (!this.authority || this.coordinatorUid === this.uid) return;
              delete this.authority;
              this.peers.forEach((peer) => peer.connection.close());
              this.peers.clear();
              this.earlyCandidates.clear();
              await this.connectToCoordinator();
            }).catch(() => this.setMode(navigator.onLine ? "firebase" : "offline"));
          } else if (changed && !this.authority) {
            this.closePeer(previousCoordinatorPeerId);
            void this.connectToCoordinator();
          }
        },
        () => this.handleSnapshotFailure(),
      ),
    );
  }

  private listenPresence(): void {
    if (this.presenceListening) return;
    this.presenceListening = true;
    const members = collection(this.db, "sparkPresence", this.roomId, "members");
    this.unsubscribes.push(
      onSnapshot(
        members,
        (snapshot) => {
          const now = Date.now();
          for (const change of snapshot.docChanges()) {
            if (change.type === "removed") {
              this.presenceSeen.delete(change.doc.id);
              continue;
            }
            const data = change.doc.data() as {
              online?: boolean;
              peerId?: string;
            };
            if (!isValidSparkPeerId(data.peerId)) {
              this.presenceSeen.delete(change.doc.id);
              continue;
            }
            // Compare on the coordinator's clock. Client wall clocks can be
            // minutes apart, while each Firestore change arrives locally now.
            this.presenceSeen.set(change.doc.id, {
              online: data.online === true,
              peerId: data.peerId,
              atMs: now,
            });
          }
          if (this.authority) {
            void this.enqueueCoordinator(() => this.reconcilePresence(now)).catch(() =>
              this.setMode(navigator.onLine ? "firebase" : "offline"),
            );
          }
        },
        () => this.handleSnapshotFailure(),
      ),
    );
  }

  private async reconcilePresence(now: number): Promise<void> {
    if (!this.authority) return;
    let changed = false;
    const snapshot = this.authority.exportSnapshot();
    for (const member of Object.values(snapshot.members)) {
      const presence = this.presenceSeen.get(member.uid);
      // A reloaded tab gets a new peer ID while an older tab can still deliver a delayed
      // heartbeat/pagehide write for the same UID. Never let that stale session replace or
      // disconnect the peer that most recently completed the authority handshake.
      if (presence && presence.peerId !== member.peerId) continue;
      const online = Boolean(presence?.online && now - presence.atMs < MEMBER_OFFLINE_MS);
      if (this.authority.setMemberOnline(member.uid, online, presence?.peerId, now)) changed = true;
      if (!online) {
        this.disconnectSince.set(
          member.uid,
          this.disconnectSince.get(member.uid) ?? presence?.atMs ?? now,
        );
      } else this.disconnectSince.delete(member.uid);
    }
    if (changed) await this.persistAndBroadcast();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const now = Date.now();
    this.pruneTransientPeerState(now);
    if (this.authority) {
      await this.enqueueCoordinator(async () => {
        const authority = this.authority;
        if (!authority) return;
        if (this.directory && now - this.directoryObservedAtMs >= HEARTBEAT_MS) {
          await this.persistDirectory(false).catch(() => this.setMode("offline"));
        }
        const snapshot = authority.exportSnapshot();
        if (
          snapshot.turnDeadlineMs &&
          snapshot.turnDeadlineMs <= now &&
          authority.timeoutCurrent(now)
        ) {
          await this.persistAndBroadcast();
        }
        for (const [uid, since] of this.disconnectSince) {
          if (now - since >= DISCONNECT_LIMIT_MS && authority.disqualifyDisconnected(uid, now)) {
            this.disconnectSince.delete(uid);
            await this.persistAndBroadcast();
          }
        }
      });
      return;
    }
    if (this.directory && now - this.directoryObservedAtMs > COORDINATOR_STALE_MS) {
      if (now - this.lastCoordinatorElectionAttemptAt >= COORDINATOR_ELECTION_RETRY_MS) {
        this.lastCoordinatorElectionAttemptAt = now;
        await this.tryCoordinatorElection(now);
      }
      return;
    }
    const coordinatorPeer = this.peers.get(this.coordinatorPeerId);
    if (
      typeof RTCPeerConnection !== "undefined" &&
      this.coordinatorPeerId &&
      this.coordinatorPeerId !== this.peerId &&
      coordinatorPeer?.channel?.readyState !== "open" &&
      now - this.lastPeerConnectAttemptAt >= PEER_RECONNECT_MS
    ) {
      this.lastPeerConnectAttemptAt = now;
      await this.connectToCoordinator();
    }
  }

  private async tryCoordinatorElection(now: number): Promise<void> {
    const snapshotDocument = await getDoc(doc(this.db, "sparkRoomSnapshots", this.roomId));
    if (!snapshotDocument.exists()) return;
    const snapshot = snapshotDocument.data() as SparkRoomSnapshot;
    // Every locally active room member may contend for the stale lease. Selecting one successor
    // from the recovery snapshot can deadlock the room when that peer disappeared alongside the
    // coordinator but was still marked online in the coordinator's final snapshot. The Firestore
    // transaction below serializes contenders and lets only the first live peer win.
    if (!snapshot.members[this.uid] || snapshot.coordinatorUid === this.uid) return;
    const directoryRef = doc(this.db, "sparkRoomDirectory", this.roomId);
    const elected = await runTransaction(this.db, async (transaction) => {
      const current = await transaction.get(directoryRef);
      if (!current.exists()) return false;
      const data = current.data() as DirectoryDocument;
      transaction.update(directoryRef, {
        coordinatorUid: this.uid,
        coordinatorPeerId: this.peerId,
        heartbeatAtMs: now,
        heartbeatAt: serverTimestamp(),
        updatedAtMs: now,
        ...(data.lastActivityAt
          ? {}
          : {
              lastActivityAt: serverTimestamp(),
              lastActivityAtMs: now,
              authorityRevision: snapshot.revision,
            }),
      });
      return true;
    }).catch(() => false);
    if (elected) await this.promoteToCoordinator();
  }

  private async promoteToCoordinator(): Promise<void> {
    if (this.authority || this.stopped) return;
    const snapshotDocument = await getDoc(doc(this.db, "sparkRoomSnapshots", this.roomId));
    if (this.authority || this.stopped || !snapshotDocument.exists()) return;
    this.peers.forEach((peer) => peer.connection.close());
    this.peers.clear();
    this.earlyCandidates.clear();
    this.authority = SparkAuthority.restore(snapshotDocument.data() as SparkRoomSnapshot);
    this.authority.setCoordinator(this.uid, this.peerId);
    this.coordinatorUid = this.uid;
    this.coordinatorPeerId = this.peerId;
    this.listenPresence();
    await this.persistAndBroadcast();
  }

  private async writePresence(online: boolean): Promise<void> {
    if (online && this.stopped) return;
    const write = async () => {
      if (online && this.stopped) return;
      await setDoc(
        doc(this.db, "sparkPresence", this.roomId, "members", this.uid),
        {
          uid: this.uid,
          peerId: this.peerId,
          online,
          role: this.role,
          name: this.profile?.name ?? "ゲスト",
          lastSeenMs: Date.now(),
        },
        { merge: true },
      ).catch(() => undefined);
    };
    const pending = this.presenceWriteQueue.then(write, write);
    this.presenceWriteQueue = pending.catch(() => undefined);
    await pending;
  }

  private async persistAndBroadcast(): Promise<void> {
    if (!this.authority) return;
    if (this.authority.isEmpty) {
      await deleteDoc(doc(this.db, "sparkRoomSnapshots", this.roomId)).catch(() => undefined);
      await deleteDoc(doc(this.db, "sparkRoomDirectory", this.roomId)).catch(() => undefined);
      return;
    }
    const snapshot = this.authority.exportSnapshot();
    // Firestore only lets the directory's current coordinator write a recovery snapshot. During an
    // explicit handoff, persist every mutation under the outgoing lease first; the successor then
    // replaces this transitional coordinatorUid as soon as the directory pointer reaches it.
    const recoverySnapshot =
      snapshot.coordinatorUid === this.uid ? snapshot : { ...snapshot, coordinatorUid: this.uid };
    await setDoc(doc(this.db, "sparkRoomSnapshots", this.roomId), plain(recoverySnapshot));
    await this.persistDirectory(true);
    for (const eviction of this.authority.consumeEvictions()) {
      await this.sendWire(eviction.uid, eviction.peerId, { type: "evicted", reason: "kick" }).catch(
        () => undefined,
      );
    }
    for (const member of Object.values(snapshot.members)) {
      const view = this.authority.project(member.uid);
      if (member.uid === this.uid) this.acceptView(view);
      else if (member.online) {
        await this.sendWire(member.uid, member.peerId, { type: "view", view }).catch(
          () => undefined,
        );
      }
    }
    if (snapshot.coordinatorUid !== this.uid) {
      const stillMember = snapshot.members[this.uid];
      delete this.authority;
      this.peers.forEach((peer) => peer.connection.close());
      this.peers.clear();
      this.earlyCandidates.clear();
      if (stillMember) await this.connectToCoordinator();
    }
  }

  private async persistInitialRoom(): Promise<void> {
    if (!this.authority) return;
    const snapshotRef = doc(this.db, "sparkRoomSnapshots", this.roomId);
    const directoryRef = doc(this.db, "sparkRoomDirectory", this.roomId);
    await this.persistDirectory(true);
    try {
      await setDoc(snapshotRef, plain(this.authority.exportSnapshot()));
      this.acceptView(this.authority.project(this.uid));
    } catch (error) {
      // A failed bootstrap must not leave a public directory pointing at a
      // missing recovery snapshot. Rules enforce the same deletion order.
      await deleteDoc(snapshotRef).catch(() => undefined);
      await deleteDoc(directoryRef).catch(() => undefined);
      throw error;
    }
  }

  private async persistDirectory(markActivity: boolean): Promise<void> {
    if (!this.authority) return;
    const now = Date.now();
    const publicRoom = this.authority.publicRoom();
    const snapshot = this.authority.exportSnapshot();
    // Existing rooms without the field are migrated conservatively to "active
    // now" by their coordinator; abandoned legacy rooms use heartbeatAt only.
    const activity = nextSparkActivityMetadata(
      markActivity,
      this.directory,
      now,
      snapshot.updatedAtMs,
    );
    const directory: DirectoryDocument = {
      ...publicRoom,
      visibility: "public",
      coordinatorUid: publicRoom.coordinatorUid,
      coordinatorPeerId: publicRoom.coordinatorPeerId,
      heartbeatAtMs: now,
      updatedAtMs: now,
      lastActivityAtMs: activity.lastActivityAtMs,
      authorityRevision: snapshot.revision,
      ...(this.directory?.lastActivityAt ? { lastActivityAt: this.directory.lastActivityAt } : {}),
    };
    this.directory = directory;
    this.directoryObservedAtMs = now;
    this.coordinatorUid = directory.coordinatorUid;
    this.coordinatorPeerId = directory.coordinatorPeerId;
    await setDoc(
      doc(this.db, "sparkRoomDirectory", this.roomId),
      {
        ...directory,
        heartbeatAt: serverTimestamp(),
        ...(activity.recordsActivity ? { lastActivityAt: serverTimestamp() } : {}),
      },
      { merge: true },
    );
  }

  private async connectToCoordinator(): Promise<void> {
    if (
      this.stopped ||
      !this.coordinatorPeerId ||
      this.coordinatorPeerId === this.peerId ||
      typeof RTCPeerConnection === "undefined"
    ) {
      this.setMode("firebase");
      return;
    }
    this.lastPeerConnectAttemptAt = Date.now();
    this.closePeer(this.coordinatorPeerId);
    try {
      const peer = this.createPeer(this.coordinatorUid, this.coordinatorPeerId);
      const channel = peer.connection.createDataChannel("daifugo", { ordered: true });
      this.attachChannel(peer, channel);
      const offer = await peer.connection.createOffer();
      if (this.stopped) {
        this.closePeer(this.coordinatorPeerId);
        return;
      }
      await peer.connection.setLocalDescription(offer);
      await this.sendRelay("sparkSignals", this.coordinatorUid, this.coordinatorPeerId, "offer", {
        sdp: offer.sdp,
      });
    } catch {
      this.closePeer(this.coordinatorPeerId);
      this.setMode(navigator.onLine ? "firebase" : "offline");
    }
  }

  private createPeer(uid: string, peerId: string): PeerState {
    this.pruneEarlyCandidates(Date.now());
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const peer: PeerState = {
      uid,
      peerId,
      connection,
      pendingCandidates: (this.earlyCandidates.get(peerId) ?? []).map((entry) => entry.candidate),
    };
    this.earlyCandidates.delete(peerId);
    this.peers.set(peerId, peer);
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        void this.sendRelay("sparkSignals", uid, peerId, "ice", {
          candidate: event.candidate.toJSON(),
        });
      }
    };
    connection.ondatachannel = (event) => this.attachChannel(peer, event.channel);
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") this.setMode("webrtc");
      if (["failed", "closed", "disconnected"].includes(connection.connectionState)) {
        this.setMode(navigator.onLine ? "firebase" : "offline");
      }
    };
    return peer;
  }

  private closePeer(peerId: string, preserveEarlyCandidates = false): void {
    if (!peerId) return;
    this.peers.get(peerId)?.connection.close();
    this.peers.delete(peerId);
    this.pendingPeerHandshakes.delete(peerId);
    if (!preserveEarlyCandidates) this.earlyCandidates.delete(peerId);
  }

  private pruneEarlyCandidates(now: number): void {
    for (const [candidatePeerId, entries] of this.earlyCandidates) {
      const fresh = entries.filter((entry) => now - entry.receivedAtMs <= EARLY_ICE_TTL_MS);
      if (fresh.length === 0) this.earlyCandidates.delete(candidatePeerId);
      else this.earlyCandidates.set(candidatePeerId, fresh);
    }
  }

  private pruneTransientPeerState(now: number): void {
    this.pruneEarlyCandidates(now);
    for (const [peerId, receivedAtMs] of this.pendingPeerHandshakes) {
      if (now - receivedAtMs > PENDING_PEER_HANDSHAKE_TTL_MS) this.closePeer(peerId);
    }
  }

  private reserveIncomingHandshake(
    senderUid: string,
    senderPeerId: string,
    now = Date.now(),
  ): void {
    if (!this.authority || this.authority.member(senderUid)?.peerId === senderPeerId) return;
    this.pruneTransientPeerState(now);
    if (this.pendingPeerHandshakes.has(senderPeerId)) return;
    if (this.pendingPeerHandshakes.size >= MAX_PENDING_PEER_HANDSHAKES) {
      const oldestPeerId = [...this.pendingPeerHandshakes.entries()].sort(
        (left, right) => left[1] - right[1],
      )[0]?.[0];
      if (oldestPeerId) this.closePeer(oldestPeerId);
    }
    this.pendingPeerHandshakes.set(senderPeerId, now);
  }

  private queueEarlyCandidate(
    peerId: string,
    candidate: RTCIceCandidateInit,
    now = Date.now(),
  ): void {
    this.pruneEarlyCandidates(now);
    const total = [...this.earlyCandidates.values()].reduce(
      (sum, entries) => sum + entries.length,
      0,
    );
    const current = this.earlyCandidates.get(peerId) ?? [];
    if (
      current.length >= MAX_EARLY_ICE_PER_PEER ||
      total >= MAX_EARLY_ICE_TOTAL ||
      (!this.earlyCandidates.has(peerId) && this.earlyCandidates.size >= MAX_EARLY_ICE_PEERS)
    )
      return;
    this.earlyCandidates.set(peerId, [...current, { candidate, receivedAtMs: now }]);
  }

  private attachChannel(peer: PeerState, channel: RTCDataChannel): void {
    peer.channel = channel;
    channel.onopen = () => this.setMode("webrtc");
    channel.onclose = () => this.setMode(navigator.onLine ? "firebase" : "offline");
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const wire = parseSparkWire(event.data);
      if (wire) this.handleWire(wire, peer.uid, peer.peerId);
    };
  }

  private async handleSignal(relay: RelayDocument): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(relay.payload) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!wireRecord(payload)) return;
    if (typeof RTCPeerConnection === "undefined") return;
    if (relay.kind === "offer") {
      if (typeof payload.sdp !== "string" || !payload.sdp || payload.sdp.length > 60_000) return;
      if (!this.authority) return;
      const existingPeer = this.peers.get(relay.senderPeerId);
      if (existingPeer && existingPeer.uid !== relay.senderUid) return;
      const authorityPeerId = this.authority.member(relay.senderUid)?.peerId;
      const presence = this.presenceSeen.get(relay.senderUid);
      const livePresence = Boolean(
        presence?.online && Date.now() - presence.atMs < MEMBER_OFFLINE_MS,
      );
      if (livePresence && presence?.peerId !== relay.senderPeerId) return;
      if (authorityPeerId !== relay.senderPeerId && !livePresence) return;
      for (const [peerId, peer] of this.peers) {
        if (peer.uid === relay.senderUid && peerId !== relay.senderPeerId) this.closePeer(peerId);
      }
      this.closePeer(relay.senderPeerId, true);
      this.reserveIncomingHandshake(relay.senderUid, relay.senderPeerId);
      if (this.peers.size >= MAX_ACTIVE_PEERS) {
        this.pendingPeerHandshakes.delete(relay.senderPeerId);
        return;
      }
      const peer = this.createPeer(relay.senderUid, relay.senderPeerId);
      await peer.connection.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      for (const candidate of peer.pendingCandidates.splice(0)) {
        await peer.connection.addIceCandidate(candidate).catch(() => undefined);
      }
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      await this.sendRelay("sparkSignals", relay.senderUid, relay.senderPeerId, "answer", {
        sdp: answer.sdp,
      });
      return;
    }
    const peer = this.peers.get(relay.senderPeerId);
    if (relay.kind === "answer" && peer) {
      if (typeof payload.sdp !== "string" || !payload.sdp || payload.sdp.length > 60_000) return;
      await peer.connection.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      for (const candidate of peer.pendingCandidates.splice(0)) {
        await peer.connection.addIceCandidate(candidate).catch(() => undefined);
      }
      return;
    }
    if (relay.kind === "ice") {
      const candidate = parseSparkIceCandidate(payload.candidate);
      if (!candidate) return;
      if (peer?.connection.remoteDescription) {
        await peer.connection.addIceCandidate(candidate).catch(() => undefined);
      } else if (peer && peer.pendingCandidates.length < MAX_EARLY_ICE_PER_PEER)
        peer.pendingCandidates.push(candidate);
      else if (!peer) this.queueEarlyCandidate(relay.senderPeerId, candidate);
    }
  }

  private handleWire(wire: WireMessage, senderUid: string, senderPeerId: string): void {
    const pendingResponse =
      wire.type === "response" ? this.pendingRequests.get(wire.requestId) : undefined;
    const expectedResponseSender = Boolean(
      pendingResponse &&
      pendingResponse.targetUid === senderUid &&
      pendingResponse.targetPeerId === senderPeerId,
    );
    if (
      !this.authority &&
      ["response", "view", "cue", "evicted"].includes(wire.type) &&
      !expectedResponseSender &&
      (senderUid !== this.coordinatorUid || senderPeerId !== this.coordinatorPeerId)
    ) {
      return;
    }
    if (wire.type === "response") {
      const pending = this.pendingRequests.get(wire.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(wire.requestId);
      if (wire.ok) pending.resolve(wire.result);
      else pending.reject(new Error(wire.error));
      return;
    }
    if (wire.type === "view") {
      this.acceptView(wire.view);
      return;
    }
    if (wire.type === "cue") {
      const cueSenderUid = this.authority ? senderUid : (wire.senderUid ?? senderUid);
      this.cueListeners.forEach((listener) => listener(wire.cue, cueSenderUid));
      if (this.authority) void this.broadcastCue(wire.cue, senderUid).catch(() => undefined);
      return;
    }
    if (wire.type === "evicted") {
      this.notifyEvicted(wire.reason);
      void this.stop(false);
      return;
    }
    if (!this.authority) return;
    void this.enqueueCoordinator(async () => {
      const authority = this.authority;
      if (!authority) return;
      if (wire.type === "command" && authority.member(senderUid)?.peerId !== senderPeerId) {
        await this.sendWire(senderUid, senderPeerId, {
          type: "response",
          requestId: wire.requestId,
          ok: false,
          error: "permission-denied: この接続は新しいセッションに置き換えられました",
        }).catch(() => undefined);
        return;
      }
      const cached = this.processedRequests.get(wire.requestId);
      if (cached) {
        await this.sendWire(senderUid, senderPeerId, cached);
        return;
      }
      try {
        let result: Record<string, unknown> = {};
        if (wire.type === "hello") {
          authority.join({
            uid: senderUid,
            peerId: senderPeerId,
            profile: wire.profile,
            role: wire.role,
          });
        } else {
          result = authority.handleCommand(senderUid, wire.name, wire.payload);
        }
        const response: WireMessage = {
          type: "response",
          requestId: wire.requestId,
          ok: true,
          result,
        };
        await this.persistAndBroadcast();
        if (wire.type === "hello") this.pendingPeerHandshakes.delete(senderPeerId);
        this.processedRequests.set(wire.requestId, response);
        await this.sendWire(senderUid, senderPeerId, response).catch(() => undefined);
      } catch (cause) {
        const response: WireMessage = {
          type: "response",
          requestId: wire.requestId,
          ok: false,
          error: cause instanceof Error ? cause.message : "unknown: P2P command failed",
        };
        this.processedRequests.set(wire.requestId, response);
        await this.sendWire(senderUid, senderPeerId, response).catch(() => undefined);
        if (wire.type === "hello") this.closePeer(senderPeerId);
      }
      if (this.processedRequests.size > 300) {
        const first = this.processedRequests.keys().next().value as string | undefined;
        if (first) this.processedRequests.delete(first);
      }
    }).catch(() => undefined);
  }

  private acceptView(view: RoomView): void {
    if (this.lastView && view.revision < this.lastView.revision) return;
    this.lastView = plain(view);
    this.viewListeners.forEach((listener) => listener(plain(view)));
  }

  private async broadcastCue(cue: CueEvent, senderUid: string): Promise<void> {
    if (!this.authority) return;
    const snapshot = this.authority.exportSnapshot();
    for (const member of Object.values(snapshot.members)) {
      if (member.uid !== senderUid && member.online) {
        await this.sendWire(member.uid, member.peerId, { type: "cue", cue, senderUid }).catch(
          () => undefined,
        );
      }
    }
  }

  async sendCue(cue: CueEvent): Promise<void> {
    if (this.stopped) throw new Error("offline: P2P接続は終了しています");
    this.cueListeners.forEach((listener) => listener(cue, this.uid));
    if (this.authority) await this.broadcastCue(cue, this.uid);
    else await this.sendWire(this.coordinatorUid, this.coordinatorPeerId, { type: "cue", cue });
  }

  async sendCommand(
    name: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.stopped) throw new Error("offline: P2P接続は終了しています");
    if (name === "leaveRoom") this.intentionalLeave = true;
    const requestId =
      typeof payload.clientActionId === "string" ? payload.clientActionId : crypto.randomUUID();
    const withAction = { ...payload, clientActionId: requestId };
    if (this.authority) {
      return this.enqueueCoordinator(async () => {
        const authority = this.authority;
        if (!authority) throw new Error("unavailable: ホストが切り替わりました");
        const result = authority.handleCommand(this.uid, name, withAction);
        await this.persistAndBroadcast();
        return result;
      });
    }
    return this.request({ type: "command", requestId, name, payload: withAction });
  }

  private request(
    wire: Extract<WireMessage, { type: "hello" | "command" }>,
  ): Promise<Record<string, unknown>> {
    const targetUid = this.coordinatorUid;
    const targetPeerId = this.coordinatorPeerId;
    const fingerprint = safeJson({ wire, targetUid, targetPeerId });
    const existing = this.pendingRequests.get(wire.requestId);
    if (existing) {
      if (existing.fingerprint === fingerprint) return existing.promise;
      return Promise.reject(new Error("invalid-argument: 同じ操作IDに異なる操作が指定されました"));
    }
    let resolveRequest!: (result: Record<string, unknown>) => void;
    let rejectRequest!: (error: Error) => void;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const pending: PendingRequest = {
      promise,
      resolve: resolveRequest,
      reject: rejectRequest,
      timer: setTimeout(() => {
        if (this.pendingRequests.get(wire.requestId) !== pending) return;
        this.pendingRequests.delete(wire.requestId);
        rejectRequest(new Error("unavailable: ホストから応答がありません"));
      }, 15_000),
      targetUid,
      targetPeerId,
      fingerprint,
    };
    this.pendingRequests.set(wire.requestId, pending);
    void this.sendWire(targetUid, targetPeerId, wire).catch((cause) => {
      if (this.pendingRequests.get(wire.requestId) !== pending) return;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(wire.requestId);
      rejectRequest(cause instanceof Error ? cause : new Error("P2P送信に失敗しました"));
    });
    return promise;
  }

  private async sendWire(
    targetUid: string,
    targetPeerId: string,
    wire: WireMessage,
  ): Promise<void> {
    const serialized = safeJson(wire);
    const serializedBytes = wireByteSize(serialized);
    if (
      serializedBytes > MAX_WIRE_BYTES ||
      (wire.type === "command" && serializedBytes > MAX_COMMAND_WIRE_BYTES)
    ) {
      throw new Error("resource-exhausted: P2Pメッセージが大きすぎます");
    }
    const peer = this.peers.get(targetPeerId);
    if (peer?.channel?.readyState === "open") {
      peer.channel.send(serialized);
      this.setMode("webrtc");
      return;
    }
    this.setMode(navigator.onLine ? "firebase" : "offline");
    await this.sendRelay("sparkMailboxes", targetUid, targetPeerId, "wire", wire);
  }

  private async sendRelay(
    collectionName: "sparkSignals" | "sparkMailboxes",
    targetUid: string,
    targetPeerId: string,
    kind: string,
    payload: unknown,
  ): Promise<void> {
    if (!isValidSparkPeerId(this.peerId) || !isValidSparkPeerId(targetPeerId)) {
      throw new Error("invalid-argument: 接続IDが不正です");
    }
    const now = sparkEstimatedServerNowMs(this.directory, this.directoryObservedAtMs, Date.now());
    const relay: RelayDocument = {
      senderUid: this.uid,
      senderPeerId: this.peerId,
      targetUid,
      targetPeerId,
      kind,
      payload: safeJson(payload),
      createdAtMs: now,
      expiresAtMs: now + RELAY_TTL_MS,
      createdAt: serverTimestamp(),
    };
    await addDoc(collection(this.db, collectionName, this.roomId, "items"), relay);
  }

  private waitForInitialView(): Promise<void> {
    if (this.lastView) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error("unavailable: 部屋ビューを受信できませんでした"));
      }, 15_000);
      const stop = this.onView(() => {
        clearTimeout(timer);
        stop();
        resolve();
      });
    });
  }

  onView(listener: (view: RoomView) => void): () => void {
    this.viewListeners.add(listener);
    if (this.lastView) {
      const view = plain(this.lastView);
      queueMicrotask(() => {
        if (this.viewListeners.has(listener)) listener(view);
      });
    }
    return () => this.viewListeners.delete(listener);
  }

  onCue(listener: (cue: CueEvent, senderUid: string) => void): () => void {
    this.cueListeners.add(listener);
    return () => this.cueListeners.delete(listener);
  }

  private notifyEvicted(reason: "kick" | "room-closed"): void {
    if (this.evictionReason) return;
    this.evictionReason = reason;
    this.evictionListeners.forEach((listener) => listener(reason));
  }

  onEvicted(listener: (reason: "kick" | "room-closed") => void): () => void {
    this.evictionListeners.add(listener);
    const reason = this.evictionReason;
    if (reason) {
      queueMicrotask(() => {
        if (this.evictionListeners.has(listener)) listener(reason);
      });
    }
    return () => this.evictionListeners.delete(listener);
  }

  onMode(listener: (mode: "webrtc" | "firebase" | "offline") => void): () => void {
    this.modeListeners.add(listener);
    const mode = this.mode;
    queueMicrotask(() => {
      if (this.modeListeners.has(listener)) listener(mode);
    });
    return () => this.modeListeners.delete(listener);
  }

  currentMode(): "webrtc" | "firebase" | "offline" {
    return this.mode;
  }

  private setMode(mode: "webrtc" | "firebase" | "offline"): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.modeListeners.forEach((listener) => listener(mode));
  }

  currentView(): RoomView | undefined {
    return this.lastView ? plain(this.lastView) : undefined;
  }

  currentMember(): SparkMember | undefined {
    return this.authority?.member(this.uid);
  }

  async stop(markOffline = true): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
    this.intervals.splice(0).forEach((interval) => clearInterval(interval));
    if (markOffline) await this.writePresence(false);
    this.viewListeners.clear();
    this.cueListeners.clear();
    this.evictionListeners.clear();
    this.modeListeners.clear();
    this.peers.forEach((peer) => peer.connection.close());
    this.peers.clear();
    this.earlyCandidates.clear();
    this.pendingPeerHandshakes.clear();
    this.processedRequests.clear();
    this.disconnectSince.clear();
    this.presenceSeen.clear();
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error("offline: P2P接続を終了しました"));
    });
    this.pendingRequests.clear();
  }
}
