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
import { SparkAuthority, type SparkMember, type SparkRoomSnapshot } from "./sparkAuthority";

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

type PendingRequest = {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const HEARTBEAT_MS = 30_000;
const COORDINATOR_STALE_MS = 75_000;
const MEMBER_OFFLINE_MS = 70_000;
const DISCONNECT_LIMIT_MS = 120_000;
const RELAY_TTL_MS = 10 * 60_000;
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

export function parseSparkWire(payload: string): WireMessage | null {
  try {
    const value = JSON.parse(payload) as Record<string, unknown>;
    if (!value || typeof value.type !== "string") return null;
    if (
      (value.type === "hello" || value.type === "command" || value.type === "response") &&
      typeof value.requestId !== "string"
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
    if (value.type === "hello" && value.profile && typeof value.profile === "object") {
      return value as unknown as WireMessage;
    }
    if (value.type === "command" && typeof value.name === "string") {
      return value as unknown as WireMessage;
    }
    if (value.type === "response" && typeof value.ok === "boolean") {
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
  private lastView?: RoomView;
  private readonly peers = new Map<string, PeerState>();
  private readonly earlyCandidates = new Map<string, RTCIceCandidateInit[]>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly processedRequests = new Map<string, WireMessage>();
  private readonly viewListeners = new Set<(view: RoomView) => void>();
  private readonly cueListeners = new Set<(cue: CueEvent, senderUid: string) => void>();
  private readonly evictionListeners = new Set<(reason: "kick") => void>();
  private readonly modeListeners = new Set<(mode: "webrtc" | "firebase" | "offline") => void>();
  private readonly unsubscribes: Unsubscribe[] = [];
  private readonly disconnectSince = new Map<string, number>();
  private readonly presenceSeen = new Map<
    string,
    { online: boolean; peerId: string; atMs: number }
  >();
  private intervals: Array<ReturnType<typeof setInterval>> = [];
  private stopped = false;
  private coordinatorQueue: Promise<void> = Promise.resolve();
  private mode: "webrtc" | "firebase" | "offline" = "firebase";
  private presenceListening = false;
  private presenceWriteQueue: Promise<void> = Promise.resolve();

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
    const directory = directorySnapshot.data() as DirectoryDocument;
    const session = new SparkP2PSession({ db, user, roomId: normalized });
    session.directory = directory;
    session.coordinatorUid = directory.coordinatorUid;
    session.coordinatorPeerId = directory.coordinatorPeerId;

    let resolvedProfile = profile;
    let resolvedRole = role;
    if (!resolvedProfile) {
      const snapshotDocument = await getDoc(doc(db, "sparkRoomSnapshots", normalized));
      const snapshot = snapshotDocument.data() as SparkRoomSnapshot | undefined;
      const member = snapshot?.members[user.uid];
      if (!member) throw new Error("permission-denied: 再接続情報がありません");
      resolvedProfile = { name: member.name, avatar: member.avatar };
      resolvedRole = member.role;
    }
    session.role = resolvedRole;
    session.profile = plain(resolvedProfile);

    if (directory.coordinatorUid === user.uid) {
      const snapshotDocument = await getDoc(doc(db, "sparkRoomSnapshots", normalized));
      if (!snapshotDocument.exists()) throw new Error("not-found: 部屋状態がありません");
      session.authority = SparkAuthority.restore(snapshotDocument.data() as SparkRoomSnapshot);
      session.authority.setCoordinator(user.uid, session.peerId);
      session.coordinatorPeerId = session.peerId;
    }
    await session.startCommon();
    try {
      if (session.authority) {
        await session.persistAndBroadcast();
      } else {
        await session.connectToCoordinator();
        await session.request({
          type: "hello",
          requestId: crypto.randomUUID(),
          role: resolvedRole,
          profile: plain(resolvedProfile),
        });
        await session.waitForInitialView();
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
      setInterval(
        () => void this.tick().catch(() => this.setMode(navigator.onLine ? "firebase" : "offline")),
        2_000,
      ),
    );
    const pageHide = () => void this.writePresence(false);
    addEventListener("pagehide", pageHide);
    this.unsubscribes.push(() => removeEventListener("pagehide", pageHide));
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
      onSnapshot(items, (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type !== "added") continue;
          const relay = change.doc.data() as RelayDocument;
          if (relay.targetUid !== this.uid) continue;
          if (relay.expiresAtMs < Date.now()) {
            void deleteDoc(change.doc.ref).catch(() => undefined);
            continue;
          }
          if (relay.targetPeerId !== this.peerId) continue;
          receive(relay);
          void deleteDoc(change.doc.ref).catch(() => undefined);
        }
      }),
    );
  }

  private listenDirectory(): void {
    this.unsubscribes.push(
      onSnapshot(doc(this.db, "sparkRoomDirectory", this.roomId), (snapshot) => {
        if (!snapshot.exists()) {
          this.setMode("offline");
          void this.stop(false);
          return;
        }
        const next = snapshot.data() as DirectoryDocument;
        const previousCoordinatorPeerId = this.coordinatorPeerId;
        const changed = next.coordinatorPeerId !== this.coordinatorPeerId;
        this.directory = next;
        this.coordinatorUid = next.coordinatorUid;
        this.coordinatorPeerId = next.coordinatorPeerId;
        if (next.coordinatorUid === this.uid && !this.authority) {
          void this.promoteToCoordinator().catch(() =>
            this.setMode(navigator.onLine ? "firebase" : "offline"),
          );
        } else if (changed && !this.authority) {
          this.closePeer(previousCoordinatorPeerId);
          void this.connectToCoordinator();
        }
      }),
    );
  }

  private listenPresence(): void {
    if (this.presenceListening) return;
    this.presenceListening = true;
    const members = collection(this.db, "sparkPresence", this.roomId, "members");
    this.unsubscribes.push(
      onSnapshot(members, (snapshot) => {
        const now = Date.now();
        for (const presence of snapshot.docs) {
          const data = presence.data() as {
            online?: boolean;
            peerId?: string;
            lastSeenMs?: number;
          };
          this.presenceSeen.set(presence.id, {
            online: data.online === true,
            peerId: String(data.peerId ?? ""),
            atMs: Number(data.lastSeenMs ?? now),
          });
        }
        if (this.authority) {
          void this.reconcilePresence(now).catch(() =>
            this.setMode(navigator.onLine ? "firebase" : "offline"),
          );
        }
      }),
    );
  }

  private async reconcilePresence(now: number): Promise<void> {
    if (!this.authority) return;
    let changed = false;
    const snapshot = this.authority.exportSnapshot();
    for (const member of Object.values(snapshot.members)) {
      const presence = this.presenceSeen.get(member.uid);
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
    if (this.authority) {
      if (this.directory && now - this.directory.heartbeatAtMs >= HEARTBEAT_MS) {
        await this.persistDirectory(false).catch(() => this.setMode("offline"));
      }
      const snapshot = this.authority.exportSnapshot();
      if (
        snapshot.turnDeadlineMs &&
        snapshot.turnDeadlineMs <= now &&
        this.authority.timeoutCurrent(now)
      ) {
        await this.persistAndBroadcast();
      }
      for (const [uid, since] of this.disconnectSince) {
        if (now - since >= DISCONNECT_LIMIT_MS && this.authority.disqualifyDisconnected(uid, now)) {
          this.disconnectSince.delete(uid);
          await this.persistAndBroadcast();
        }
      }
      return;
    }
    if (this.directory && now - this.directory.heartbeatAtMs > COORDINATOR_STALE_MS) {
      await this.tryCoordinatorElection(now);
    }
  }

  private async tryCoordinatorElection(now: number): Promise<void> {
    const snapshotDocument = await getDoc(doc(this.db, "sparkRoomSnapshots", this.roomId));
    if (!snapshotDocument.exists()) return;
    const snapshot = snapshotDocument.data() as SparkRoomSnapshot;
    const successor = Object.values(snapshot.members)
      .filter((member) => member.online && member.uid !== snapshot.coordinatorUid)
      .sort((left, right) => left.joinedAtMs - right.joinedAtMs)[0];
    if (successor?.uid !== this.uid) return;
    const directoryRef = doc(this.db, "sparkRoomDirectory", this.roomId);
    const elected = await runTransaction(this.db, async (transaction) => {
      const current = await transaction.get(directoryRef);
      if (!current.exists()) return false;
      const data = current.data() as DirectoryDocument;
      if (now - data.heartbeatAtMs <= COORDINATOR_STALE_MS) return false;
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
        await this.sendWire(member.uid, member.peerId, { type: "view", view });
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
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const peer: PeerState = {
      uid,
      peerId,
      connection,
      pendingCandidates: this.earlyCandidates.get(peerId) ?? [],
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

  private closePeer(peerId: string): void {
    if (!peerId) return;
    this.peers.get(peerId)?.connection.close();
    this.peers.delete(peerId);
    this.earlyCandidates.delete(peerId);
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
    if (typeof RTCPeerConnection === "undefined") return;
    if (relay.kind === "offer") {
      this.closePeer(relay.senderPeerId);
      const peer = this.createPeer(relay.senderUid, relay.senderPeerId);
      await peer.connection.setRemoteDescription({ type: "offer", sdp: String(payload.sdp) });
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
      await peer.connection.setRemoteDescription({ type: "answer", sdp: String(payload.sdp) });
      for (const candidate of peer.pendingCandidates.splice(0)) {
        await peer.connection.addIceCandidate(candidate).catch(() => undefined);
      }
      return;
    }
    if (relay.kind === "ice" && payload.candidate && typeof payload.candidate === "object") {
      const candidate = payload.candidate as RTCIceCandidateInit;
      if (peer?.connection.remoteDescription) {
        await peer.connection.addIceCandidate(candidate).catch(() => undefined);
      } else if (peer) peer.pendingCandidates.push(candidate);
      else {
        this.earlyCandidates.set(relay.senderPeerId, [
          ...(this.earlyCandidates.get(relay.senderPeerId) ?? []),
          candidate,
        ]);
      }
    }
  }

  private handleWire(wire: WireMessage, senderUid: string, senderPeerId: string): void {
    if (
      !this.authority &&
      ["response", "view", "cue", "evicted"].includes(wire.type) &&
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
      this.evictionListeners.forEach((listener) => listener(wire.reason));
      void this.stop(false);
      return;
    }
    if (!this.authority) return;
    this.coordinatorQueue = this.coordinatorQueue
      .catch(() => undefined)
      .then(async () => {
        const cached = this.processedRequests.get(wire.requestId);
        if (cached) {
          await this.sendWire(senderUid, senderPeerId, cached);
          return;
        }
        try {
          let result: Record<string, unknown> = {};
          if (wire.type === "hello") {
            this.authority!.join({
              uid: senderUid,
              peerId: senderPeerId,
              profile: wire.profile,
              role: wire.role,
            });
          } else {
            result = this.authority!.handleCommand(senderUid, wire.name, wire.payload);
          }
          const response: WireMessage = {
            type: "response",
            requestId: wire.requestId,
            ok: true,
            result,
          };
          this.processedRequests.set(wire.requestId, response);
          await this.sendWire(senderUid, senderPeerId, response);
          await this.persistAndBroadcast();
        } catch (cause) {
          const response: WireMessage = {
            type: "response",
            requestId: wire.requestId,
            ok: false,
            error: cause instanceof Error ? cause.message : "unknown: P2P command failed",
          };
          this.processedRequests.set(wire.requestId, response);
          await this.sendWire(senderUid, senderPeerId, response).catch(() => undefined);
        }
        if (this.processedRequests.size > 300) {
          const first = this.processedRequests.keys().next().value as string | undefined;
          if (first) this.processedRequests.delete(first);
        }
      });
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
        await this.sendWire(member.uid, member.peerId, { type: "cue", cue, senderUid });
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
    const requestId =
      typeof payload.clientActionId === "string" ? payload.clientActionId : crypto.randomUUID();
    const withAction = { ...payload, clientActionId: requestId };
    if (this.authority) {
      const result = this.authority.handleCommand(this.uid, name, withAction);
      await this.persistAndBroadcast();
      return result;
    }
    return this.request({ type: "command", requestId, name, payload: withAction });
  }

  private request(
    wire: Extract<WireMessage, { type: "hello" | "command" }>,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(wire.requestId);
        reject(new Error("unavailable: ホストから応答がありません"));
      }, 15_000);
      this.pendingRequests.set(wire.requestId, { resolve, reject, timer });
      void this.sendWire(this.coordinatorUid, this.coordinatorPeerId, wire).catch((cause) => {
        clearTimeout(timer);
        this.pendingRequests.delete(wire.requestId);
        reject(cause instanceof Error ? cause : new Error("P2P送信に失敗しました"));
      });
    });
  }

  private async sendWire(
    targetUid: string,
    targetPeerId: string,
    wire: WireMessage,
  ): Promise<void> {
    const peer = this.peers.get(targetPeerId);
    if (peer?.channel?.readyState === "open") {
      peer.channel.send(safeJson(wire));
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
    const now = Date.now();
    const relay: RelayDocument = {
      senderUid: this.uid,
      senderPeerId: this.peerId,
      targetUid,
      targetPeerId,
      kind,
      payload: safeJson(payload),
      createdAtMs: now,
      expiresAtMs: now + RELAY_TTL_MS,
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

  onEvicted(listener: (reason: "kick") => void): () => void {
    this.evictionListeners.add(listener);
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
