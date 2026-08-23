import { afterEach, describe, expect, test, vi } from "vitest";
import { defaultAvatar } from "@daifugo/avatar-schema";
import { SparkAuthority } from "../network/sparkAuthority";

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  onSnapshot: vi.fn(() => vi.fn()),
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
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => "server-time"),
  setDoc: firestore.setDoc,
  Timestamp: { fromMillis: vi.fn((value: number) => value) },
  where: vi.fn((...parts: unknown[]) => ({ parts })),
}));

import { SparkP2PSession } from "../network/sparkP2P";

type StartupInternals = {
  startCommon(): Promise<void>;
  connectToCoordinator(): Promise<void>;
  request(value: unknown): Promise<Record<string, unknown>>;
  writePresence(online: boolean): Promise<void>;
  enqueueCoordinator<T>(task: () => Promise<T>): Promise<T>;
  persistAndBroadcast(): Promise<void>;
  sendWire(targetUid: string, targetPeerId: string, wire: unknown): Promise<void>;
  authority?: SparkAuthority;
  coordinatorUid: string;
  coordinatorPeerId: string;
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
  afterEach(() => vi.restoreAllMocks());

  test("stops a partially started session when its handshake fails", async () => {
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ coordinatorUid: "host", coordinatorPeerId: "host-peer" }),
    });
    const prototype = SparkP2PSession.prototype as unknown as StartupInternals;
    vi.spyOn(prototype, "startCommon").mockResolvedValue();
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
});
