import { afterEach, describe, expect, test, vi } from "vitest";
import { defaultAvatar } from "@daifugo/avatar-schema";
import { SparkAuthority } from "../network/sparkAuthority";

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  onSnapshot: vi.fn((..._args: unknown[]) => vi.fn()),
  runTransaction: vi.fn(),
  setDoc: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: vi.fn((...path: unknown[]) => ({ path })),
  deleteDoc: vi.fn(),
  doc: vi.fn((...path: unknown[]) => ({ path })),
  getDoc: firestore.getDoc,
  getDocs: firestore.getDocs,
  limit: vi.fn((value: unknown) => value),
  onSnapshot: firestore.onSnapshot,
  query: vi.fn((...parts: unknown[]) => ({ parts })),
  runTransaction: firestore.runTransaction,
  serverTimestamp: vi.fn(() => "server-time"),
  setDoc: firestore.setDoc,
  Timestamp: { fromMillis: vi.fn((value: number) => value) },
  where: vi.fn((...parts: unknown[]) => ({ parts })),
}));

import {
  SparkP2PSession,
  sparkEstimatedServerNowMs,
  sparkRelayExpiresAtMs,
} from "../network/sparkP2P";

type StartupInternals = {
  startCommon(): Promise<void>;
  listenDirectory(): void;
  connectToCoordinator(): Promise<void>;
  request(value: unknown): Promise<Record<string, unknown>>;
  writePresence(online: boolean): Promise<void>;
  tick(): Promise<void>;
  tryCoordinatorElection(now: number): Promise<void>;
  reconcilePresence(now: number): Promise<void>;
  enqueueCoordinator<T>(task: () => Promise<T>): Promise<T>;
  persistDirectory(initial: boolean): Promise<void>;
  persistAndBroadcast(): Promise<void>;
  sendWire(targetUid: string, targetPeerId: string, wire: unknown): Promise<void>;
  authority?: SparkAuthority;
  coordinatorUid: string;
  coordinatorPeerId: string;
  directory?: { heartbeatAtMs: number };
  directoryObservedAtMs: number;
  lastCoordinatorElectionAttemptAt: number;
  presenceSeen: Map<string, { online: boolean; peerId: string; atMs: number }>;
  handleWire(wire: unknown, senderUid: string, senderPeerId: string): void;
  mode: "webrtc" | "firebase" | "offline";
};

type SparkSessionConstructor = new (options: {
  db: never;
  user: { uid: string };
  roomId: string;
  peerId: string;
}) => SparkP2PSession;

describe("Spark P2P startup cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("stops a partially started session when its handshake fails", async () => {
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ coordinatorUid: "host", coordinatorPeerId: "host-peer" }),
    });
    const prototype = SparkP2PSession.prototype as unknown as StartupInternals;
    vi.spyOn(prototype, "startCommon").mockResolvedValue();
    vi.spyOn(prototype, "tryCoordinatorElection").mockResolvedValue();
    vi.spyOn(prototype, "connectToCoordinator").mockResolvedValue();
    vi.spyOn(prototype, "request").mockRejectedValue(new Error("handshake failed"));
    const stop = vi.spyOn(SparkP2PSession.prototype, "stop").mockResolvedValue();

    await expect(
      SparkP2PSession.connect({} as never, { uid: "guest" } as never, "ABCDE", "spectator", {
        name: "guest",
        avatar: {} as never,
      }),
    ).rejects.toThrow("handshake failed");

    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith(false);
  });

  test("retains a room-closed notification when the directory disappears", async () => {
    let directoryUpdate: ((snapshot: { exists(): boolean }) => void) | undefined;
    const unsubscribe = vi.fn();
    firestore.onSnapshot.mockImplementationOnce((...args: unknown[]) => {
      directoryUpdate = args[1] as (snapshot: { exists(): boolean }) => void;
      return unsubscribe;
    });
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "guest" },
      roomId: "ABCDE",
      peerId: "guest-peer",
    });

    (session as unknown as StartupInternals).listenDirectory();
    directoryUpdate?.({ exists: () => false });
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());

    const evicted = vi.fn();
    session.onEvicted(evicted);
    await vi.waitFor(() => expect(evicted).toHaveBeenCalledWith("room-closed"));
  });

  test("recovers a stale room before attempting a coordinator handshake", async () => {
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ coordinatorUid: "host", coordinatorPeerId: "host-peer" }),
    });
    const prototype = SparkP2PSession.prototype as unknown as StartupInternals;
    vi.spyOn(prototype, "startCommon").mockResolvedValue();
    const election = vi
      .spyOn(prototype, "tryCoordinatorElection")
      .mockImplementation(async function (this: StartupInternals) {
        this.authority = SparkAuthority.create(
          "ABCDE",
          "guest",
          "guest-peer",
          { name: "guest", avatar: structuredClone(defaultAvatar) },
          1_000,
        );
      });
    const connect = vi.spyOn(prototype, "connectToCoordinator").mockResolvedValue();
    const request = vi.spyOn(prototype, "request").mockResolvedValue({});

    const session = await SparkP2PSession.connect(
      {} as never,
      { uid: "guest" } as never,
      "ABCDE",
      "player",
      { name: "guest", avatar: structuredClone(defaultAvatar) },
    );

    expect(election).toHaveBeenCalledOnce();
    expect(connect).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    await session.stop(false);
  });

  test("serializes presence writes so offline is the final update", async () => {
    let releaseOnline: () => void = () => undefined;
    firestore.setDoc
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseOnline = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "guest" },
      roomId: "ABCDE",
      peerId: "guest-peer",
    });
    const internals = session as unknown as StartupInternals;

    const heartbeat = internals.writePresence(true);
    await vi.waitFor(() => expect(firestore.setDoc).toHaveBeenCalledOnce());
    const stopping = session.stop();
    await Promise.resolve();
    expect(firestore.setDoc).toHaveBeenCalledOnce();

    releaseOnline();
    await heartbeat;
    await stopping;
    expect(firestore.setDoc).toHaveBeenCalledTimes(2);
    expect(firestore.setDoc.mock.calls[0]?.[1]).toMatchObject({ online: true });
    expect(firestore.setDoc.mock.calls[1]?.[1]).toMatchObject({ online: false });
  });

  test("serializes coordinator mutations", async () => {
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "host" },
      roomId: "ABCDE",
      peerId: "host-peer",
    });
    const internals = session as unknown as StartupInternals;
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;

    const first = internals.enqueueCoordinator(
      () =>
        new Promise<void>((resolve) => {
          order.push("first-start");
          releaseFirst = () => {
            order.push("first-end");
            resolve();
          };
        }),
    );
    const second = internals.enqueueCoordinator(async () => {
      order.push("second");
    });

    await vi.waitFor(() => expect(order).toEqual(["first-start"]));
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  test("continues broadcasting views after one peer delivery fails", async () => {
    firestore.setDoc.mockResolvedValue(undefined);
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "host" },
      roomId: "ABCDE",
      peerId: "host-peer",
    });
    const internals = session as unknown as StartupInternals;
    internals.authority = SparkAuthority.create(
      "ABCDE",
      "host",
      "host-peer",
      { name: "host", avatar: structuredClone(defaultAvatar) },
      1_000,
    );
    internals.authority.join({
      uid: "guest-1",
      peerId: "guest-peer-1",
      profile: { name: "guest-1", avatar: structuredClone(defaultAvatar) },
      role: "player",
    });
    internals.authority.join({
      uid: "guest-2",
      peerId: "guest-peer-2",
      profile: { name: "guest-2", avatar: structuredClone(defaultAvatar) },
      role: "spectator",
    });
    const sendWire = vi
      .spyOn(internals, "sendWire")
      .mockRejectedValueOnce(new Error("peer unavailable"))
      .mockResolvedValue(undefined);

    await expect(internals.persistAndBroadcast()).resolves.toBeUndefined();

    expect(sendWire).toHaveBeenCalledTimes(2);
    expect(sendWire.mock.calls.map(([uid]) => uid)).toEqual(["guest-1", "guest-2"]);
  });

  test("rejects commands after the session has stopped", async () => {
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "guest" },
      roomId: "ABCDE",
      peerId: "guest-peer",
    });

    await session.stop(false);

    await expect(session.sendCommand("submitPass", {})).rejects.toThrow("P2P接続は終了しています");
    await expect(
      session.sendCue({
        version: 1,
        type: "emote",
        eventId: "after-stop",
        emote: "thinking",
        atMs: 1,
      }),
    ).rejects.toThrow("P2P接続は終了しています");
  });

  test("trusts forwarded cue attribution only from the current coordinator", () => {
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "spectator" },
      roomId: "ABCDE",
      peerId: "spectator-peer",
    });
    const internals = session as unknown as StartupInternals;
    internals.coordinatorUid = "host";
    internals.coordinatorPeerId = "host-peer";
    const cueListener = vi.fn();
    session.onCue(cueListener);
    const wire = {
      type: "cue",
      senderUid: "actor",
      cue: {
        version: 1,
        type: "emote",
        eventId: "forwarded",
        emote: "applause",
        atMs: 1,
      },
    };

    internals.handleWire(wire, "attacker", "attacker-peer");
    expect(cueListener).not.toHaveBeenCalled();
    internals.handleWire(wire, "host", "host-peer");
    expect(cueListener).toHaveBeenCalledWith(wire.cue, "actor");
  });

  test("rejects commands from a peer replaced by a newer session", async () => {
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "host" },
      roomId: "ABCDE",
      peerId: "host-peer",
    });
    const internals = session as unknown as StartupInternals;
    internals.authority = SparkAuthority.create(
      "ABCDE",
      "host",
      "host-peer",
      { name: "host", avatar: structuredClone(defaultAvatar) },
      1_000,
    );
    internals.authority.join({
      uid: "guest",
      peerId: "new-peer",
      profile: { name: "guest", avatar: structuredClone(defaultAvatar) },
      role: "spectator",
    });
    const revision = internals.authority.exportSnapshot().revision;
    const sendWire = vi.spyOn(internals, "sendWire").mockResolvedValue();

    internals.handleWire(
      {
        type: "command",
        requestId: "old-peer-command",
        name: "sendChat",
        payload: { expectedRevision: revision, text: "old tab" },
      },
      "guest",
      "old-peer",
    );

    await vi.waitFor(() => expect(sendWire).toHaveBeenCalledOnce());
    expect(sendWire).toHaveBeenCalledWith(
      "guest",
      "old-peer",
      expect.objectContaining({ ok: false, requestId: "old-peer-command" }),
    );
    expect(internals.authority.exportSnapshot().revision).toBe(revision);
    await session.stop(false);
  });

  test("rejects an oversized hello peer ID before snapshot mutation", async () => {
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "host" },
      roomId: "ABCDE",
      peerId: "host-peer",
    });
    const internals = session as unknown as StartupInternals;
    internals.authority = SparkAuthority.create(
      "ABCDE",
      "host",
      "host-peer",
      { name: "host", avatar: structuredClone(defaultAvatar) },
      1_000,
    );
    const revision = internals.authority.exportSnapshot().revision;
    const sendWire = vi.spyOn(internals, "sendWire").mockResolvedValue();

    internals.handleWire(
      {
        type: "hello",
        requestId: "oversized-peer",
        role: "spectator",
        profile: { name: "guest", avatar: structuredClone(defaultAvatar) },
      },
      "guest",
      "p".repeat(193),
    );

    await vi.waitFor(() => expect(sendWire).toHaveBeenCalledOnce());
    expect(internals.authority.member("guest")).toBeUndefined();
    expect(internals.authority.exportSnapshot().revision).toBe(revision);
    expect(sendWire).toHaveBeenCalledWith(
      "guest",
      "p".repeat(193),
      expect.objectContaining({ ok: false, requestId: "oversized-peer" }),
    );
    await session.stop(false);
  });

  test("does not deliver a queued mode update after unsubscribe", async () => {
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "guest" },
      roomId: "ABCDE",
      peerId: "guest-peer",
    });
    const listener = vi.fn();

    session.onMode(listener)();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
  });

  test("reports offline when a required Firestore subscription terminates", async () => {
    firestore.setDoc.mockResolvedValue(undefined);
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "guest" },
      roomId: "ABCDE",
      peerId: "guest-peer",
    });
    const internals = session as unknown as StartupInternals;

    await internals.startCommon();
    const snapshotCalls = firestore.onSnapshot.mock.calls as unknown as Array<
      [unknown, unknown, (() => void)?]
    >;
    const onError = snapshotCalls[0]?.[2];
    expect(onError).toBeTypeOf("function");
    onError?.();

    expect(internals.mode).toBe("offline");
    await session.stop(false);
  });

  test("periodically retries a dropped coordinator data channel", async () => {
    vi.stubGlobal("RTCPeerConnection", class {});
    const now = vi.spyOn(Date, "now");
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "guest" },
      roomId: "ABCDE",
      peerId: "guest-peer",
    });
    const internals = session as unknown as StartupInternals;
    internals.coordinatorUid = "host";
    internals.coordinatorPeerId = "host-peer";
    internals.directory = { heartbeatAtMs: 100_000 };
    const reconnect = vi.spyOn(internals, "connectToCoordinator").mockResolvedValue();

    now.mockReturnValue(100_000);
    await internals.tick();
    now.mockReturnValue(110_000);
    await internals.tick();
    expect(reconnect).toHaveBeenCalledTimes(1);

    now.mockReturnValue(131_000);
    await internals.tick();
    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  test("detects a stale directory by elapsed receipt time despite a skewed wall heartbeat", async () => {
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "guest" },
      roomId: "ABCDE",
      peerId: "guest-peer",
    });
    const internals = session as unknown as StartupInternals;
    internals.directory = { heartbeatAtMs: 9_999_999 };
    internals.directoryObservedAtMs = 1_000;
    const election = vi.spyOn(internals, "tryCoordinatorElection").mockResolvedValue();
    const now = vi.spyOn(Date, "now").mockReturnValue(76_001);

    await internals.tick();
    now.mockReturnValue(78_001);
    await internals.tick();

    expect(election).toHaveBeenCalledOnce();
    now.mockReturnValue(91_001);
    await internals.tick();
    expect(election).toHaveBeenCalledTimes(2);
  });

  test("heartbeats by elapsed receipt time despite a skewed server wall clock", async () => {
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "host" },
      roomId: "ABCDE",
      peerId: "host-peer",
    });
    const internals = session as unknown as StartupInternals;
    internals.authority = SparkAuthority.create(
      "ABCDE",
      "host",
      "host-peer",
      { name: "host", avatar: structuredClone(defaultAvatar) },
      1_000,
    );
    internals.directory = { heartbeatAtMs: 9_999_999 };
    internals.directoryObservedAtMs = 1_000;
    const heartbeat = vi.spyOn(internals, "persistDirectory").mockResolvedValue();
    vi.spyOn(Date, "now").mockReturnValue(31_000);

    await internals.tick();

    expect(heartbeat).toHaveBeenCalledWith(false);
  });

  test("demotes an old coordinator after another peer wins the directory lease", async () => {
    firestore.setDoc.mockResolvedValue(undefined);
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "host" },
      roomId: "ABCDE",
      peerId: "host-peer",
    });
    const internals = session as unknown as StartupInternals;
    internals.authority = SparkAuthority.create(
      "ABCDE",
      "host",
      "host-peer",
      { name: "host", avatar: structuredClone(defaultAvatar) },
      1_000,
    );

    await internals.startCommon();
    const snapshotCalls = firestore.onSnapshot.mock.calls as unknown as Array<
      [unknown, (snapshot: unknown) => void, (() => void)?]
    >;
    const directorySnapshot = snapshotCalls.at(-2)?.[1];
    directorySnapshot?.({
      exists: () => true,
      data: () => ({
        coordinatorUid: "successor",
        coordinatorPeerId: "successor-peer",
        heartbeatAtMs: Date.now(),
      }),
    });
    await vi.waitFor(() => expect(internals.authority).toBeUndefined());

    expect(internals.coordinatorUid).toBe("successor");
    expect(internals.coordinatorPeerId).toBe("successor-peer");
    await session.stop(false);
  });

  test("lets a later live member contend when the oldest successor is absent", async () => {
    const authority = SparkAuthority.create(
      "ABCDE",
      "host",
      "host-peer",
      { name: "host", avatar: structuredClone(defaultAvatar) },
      1_000,
    );
    authority.join(
      {
        uid: "absent",
        peerId: "absent-peer",
        profile: { name: "absent", avatar: structuredClone(defaultAvatar) },
        role: "player",
      },
      1_100,
    );
    authority.join(
      {
        uid: "successor",
        peerId: "successor-peer",
        profile: { name: "successor", avatar: structuredClone(defaultAvatar) },
        role: "player",
      },
      1_200,
    );
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => authority.exportSnapshot(),
    });
    firestore.runTransaction.mockResolvedValueOnce(false);
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "successor" },
      roomId: "ABCDE",
      peerId: "successor-peer",
    });
    const internals = session as unknown as StartupInternals;

    await internals.tryCoordinatorElection(100_000);

    expect(firestore.runTransaction).toHaveBeenCalledOnce();
    await session.stop(false);
  });

  test("lets Firestore server time decide whether a coordinator lease is stale", async () => {
    const authority = SparkAuthority.create(
      "ABCDE",
      "host",
      "host-peer",
      { name: "host", avatar: structuredClone(defaultAvatar) },
      1_000,
    );
    authority.join(
      {
        uid: "successor",
        peerId: "successor-peer",
        profile: { name: "successor", avatar: structuredClone(defaultAvatar) },
        role: "player",
      },
      1_100,
    );
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => authority.exportSnapshot(),
    });
    const update = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (...args: unknown[]) => {
      const operation = args[1] as (transaction: {
        get: () => Promise<{ exists: () => boolean; data: () => Record<string, unknown> }>;
        update: typeof update;
      }) => Promise<boolean>;
      await operation({
        get: async () => ({
          exists: () => true,
          data: () => ({
            coordinatorUid: "host",
            coordinatorPeerId: "host-peer",
            heartbeatAtMs: 9_999_999,
          }),
        }),
        update,
      });
      return false;
    });
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "successor" },
      roomId: "ABCDE",
      peerId: "successor-peer",
    });
    const internals = session as unknown as StartupInternals;

    await internals.tryCoordinatorElection(1_000);

    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      coordinatorUid: "successor",
      coordinatorPeerId: "successor-peer",
      heartbeatAtMs: 1_000,
    });
    await session.stop(false);
  });

  test("uses coordinator receipt time instead of a peer's skewed wall clock", async () => {
    firestore.setDoc.mockResolvedValue(undefined);
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "host" },
      roomId: "ABCDE",
      peerId: "host-peer",
    });
    const internals = session as unknown as StartupInternals;
    internals.authority = SparkAuthority.create(
      "ABCDE",
      "host",
      "host-peer",
      { name: "host", avatar: structuredClone(defaultAvatar) },
      1_000,
    );
    internals.authority.setMemberOnline("host", false, undefined, 1_100);

    await internals.startCommon();
    const snapshotCalls = firestore.onSnapshot.mock.calls as unknown as Array<
      [unknown, (snapshot: unknown) => void, (() => void)?]
    >;
    const presenceSnapshot = snapshotCalls.at(-1)?.[1];
    presenceSnapshot?.({
      docChanges: () => [
        {
          type: "added",
          doc: {
            id: "host",
            data: () => ({ online: true, peerId: "host-peer", lastSeenMs: 1 }),
          },
        },
      ],
    });
    await vi.waitFor(() => expect(internals.authority?.member("host")?.online).toBe(true));

    await session.stop(false);
  });

  test("ignores delayed presence from an older session of the same member", async () => {
    firestore.setDoc.mockResolvedValue(undefined);
    const Session = SparkP2PSession as unknown as SparkSessionConstructor;
    const session = new Session({
      db: {} as never,
      user: { uid: "host" },
      roomId: "ABCDE",
      peerId: "host-peer",
    });
    const internals = session as unknown as StartupInternals;
    internals.authority = SparkAuthority.create(
      "ABCDE",
      "host",
      "host-peer",
      { name: "host", avatar: structuredClone(defaultAvatar) },
      1_000,
    );
    internals.authority.join(
      {
        uid: "guest",
        peerId: "guest-new-peer",
        profile: { name: "guest", avatar: structuredClone(defaultAvatar) },
        role: "player",
      },
      1_100,
    );

    internals.presenceSeen.set("host", {
      online: true,
      peerId: "host-peer",
      atMs: 2_000,
    });
    internals.presenceSeen.set("guest", {
      online: false,
      peerId: "guest-old-peer",
      atMs: 2_000,
    });

    await internals.reconcilePresence(2_000);

    expect(internals.authority.member("guest")).toMatchObject({
      online: true,
      peerId: "guest-new-peer",
    });

    await session.stop(false);
  });
});

describe("Spark relay clock normalization", () => {
  test("accepts a fresh relay when sender and receiver wall clocks are fourteen minutes apart", () => {
    const relayCreatedAtServerMs = 2_000_000;
    const receiverLocalObservedAtMs = relayCreatedAtServerMs + 7 * 60_000;
    const receiverLocalNowMs = receiverLocalObservedAtMs + 1_000;
    const serverNowMs = sparkEstimatedServerNowMs(
      { heartbeatAtMs: relayCreatedAtServerMs },
      receiverLocalObservedAtMs,
      receiverLocalNowMs,
    );
    const expiresAtMs = sparkRelayExpiresAtMs({
      createdAt: { toMillis: () => relayCreatedAtServerMs },
      // A sender clock seven minutes slow makes this look expired on the receiver clock.
      expiresAtMs: relayCreatedAtServerMs - 7 * 60_000 + 10 * 60_000,
    });

    expect(serverNowMs).toBe(relayCreatedAtServerMs + 1_000);
    expect(expiresAtMs).toBe(relayCreatedAtServerMs + 10 * 60_000);
    expect(expiresAtMs).toBeGreaterThan(serverNowMs);
  });

  test("still expires a relay after ten minutes on the server timeline", () => {
    const relayCreatedAtServerMs = 3_000_000;
    const serverNowMs = sparkEstimatedServerNowMs(
      { heartbeatAtMs: relayCreatedAtServerMs },
      9_000_000,
      9_000_000 + 10 * 60_000 + 1,
    );

    expect(
      sparkRelayExpiresAtMs({
        createdAt: { toMillis: () => relayCreatedAtServerMs },
        expiresAtMs: Number.MAX_SAFE_INTEGER,
      }),
    ).toBeLessThan(serverNowMs);
  });

  test("keeps the millisecond expiry fallback for rolling deployments", () => {
    expect(sparkRelayExpiresAtMs({ expiresAtMs: 42_000 })).toBe(42_000);
  });
});
