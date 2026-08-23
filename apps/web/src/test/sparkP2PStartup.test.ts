import { afterEach, describe, expect, test, vi } from "vitest";

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
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
  onSnapshot: vi.fn(() => vi.fn()),
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
});
