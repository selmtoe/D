import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { Timestamp as AdminTimestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { firestore as adminFirestore } from "../../src/config.js";
import { cloneRoom, executeRoomMutation } from "../../src/callable/command-store.js";
import type { RoomDocument } from "../../src/model.js";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
let environment: RulesTestEnvironment;

beforeAll(async () => {
  const firestoreRules = await readFile(`${projectRoot}/firestore.rules`, "utf8");
  environment = await initializeTestEnvironment({
    projectId: "daifugo-8e039",
    firestore: { rules: firestoreRules },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await Promise.all([
      setDoc(doc(context.firestore(), "v2Rooms/ABCDE"), {
        schemaVersion: 2,
        secret: "full-card-state",
        members: {
          alice: { connectionStatus: "connected" },
          bob: { connectionStatus: "connected" },
        },
      }),
      setDoc(doc(context.firestore(), "v2RoomViews/ABCDE"), { schemaVersion: 2, roomId: "ABCDE" }),
      setDoc(doc(context.firestore(), "v2RoomViews/ABCDE/viewers/alice"), {
        viewerId: "alice",
        hand: [],
      }),
      setDoc(doc(context.firestore(), "v2RoomViews/ABCDE/viewers/bob"), {
        viewerId: "bob",
        hand: [],
      }),
      setDoc(doc(context.firestore(), "v2Events/ABCDE/actions/action-1234567890"), {
        secret: true,
      }),
    ]);
  });
});

afterAll(async () => environment.cleanup());

describe("Firestore v2 isolation", () => {
  test("authenticated users can read lobby projection but unauthenticated users cannot", async () => {
    await assertSucceeds(
      getDoc(doc(environment.authenticatedContext("alice").firestore(), "v2RoomViews/ABCDE")),
    );
    await assertFails(
      getDoc(doc(environment.unauthenticatedContext().firestore(), "v2RoomViews/ABCDE")),
    );
  });

  test("a viewer can get only the document addressed by their Auth UID", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(alice, "v2RoomViews/ABCDE/viewers/alice")));
    await assertFails(getDoc(doc(alice, "v2RoomViews/ABCDE/viewers/bob")));
    await assertFails(setDoc(doc(alice, "v2RoomViews/ABCDE/viewers/alice"), { forged: true }));
  });

  test("authoritative rooms and audit events reject all client access", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    await assertFails(getDoc(doc(alice, "v2Rooms/ABCDE")));
    await assertFails(setDoc(doc(alice, "v2Rooms/ABCDE"), { forged: true }));
    await assertFails(getDoc(doc(alice, "v2Events/ABCDE/actions/action-1234567890")));
  });

  test("legacy rooms remain non-destructively accessible during migration", async () => {
    const legacy = doc(environment.unauthenticatedContext().firestore(), "rooms/OLD01");
    await assertSucceeds(setDoc(legacy, { gameState: "waiting" }));
    await assertSucceeds(getDoc(legacy));
    await assertSucceeds(deleteDoc(legacy));
  });
});

describe("Spark-plan P2P storage boundary", () => {
  const directory = {
    roomId: "P2P22",
    visibility: "public",
    coordinatorUid: "alice",
    coordinatorPeerId: "alice_peer",
    heartbeatAt: serverTimestamp(),
    heartbeatAtMs: 1_000,
    updatedAtMs: 1_000,
    lastActivityAt: serverTimestamp(),
    lastActivityAtMs: 1_000,
    authorityRevision: 1,
    hostName: "Alice",
    hostAvatar: { schemaVersion: 1 },
    playerCount: 1,
    spectatorCount: 0,
    mode: "normal",
    blindCount: 0,
    phase: "waiting",
    createdAtMs: 1_000,
  };

  test("the signed-in coordinator can create the directory and crash snapshot", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    const snapshot = {
      schemaVersion: 1,
      roomId: "P2P22",
      coordinatorUid: "alice",
      revision: 1,
    };
    // This is the production regression: snapshot-first bootstrap has no lease
    // document for Rules to authorize against and must fail.
    await assertFails(setDoc(doc(alice, "sparkRoomSnapshots/P2P22"), snapshot));
    await assertFails(
      setDoc(doc(alice, "sparkRoomDirectory/P2P22"), {
        ...directory,
        coordinatorPeerId: "p".repeat(193),
      }),
    );
    await assertSucceeds(setDoc(doc(alice, "sparkRoomDirectory/P2P22"), directory));
    // A directory without a snapshot cannot be heartbeated/revived. Bootstrap
    // must finish directory -> snapshot before the normal snapshot -> directory cycle.
    await assertFails(
      updateDoc(doc(alice, "sparkRoomDirectory/P2P22"), {
        heartbeatAt: serverTimestamp(),
        heartbeatAtMs: 2_000,
      }),
    );
    await assertSucceeds(setDoc(doc(alice, "sparkRoomSnapshots/P2P22"), snapshot));
    await assertFails(
      updateDoc(doc(alice, "sparkRoomDirectory/P2P22"), {
        heartbeatAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        lastActivityAtMs: 2_000,
        authorityRevision: 1,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(alice, "sparkRoomDirectory/P2P22"), {
        heartbeatAt: serverTimestamp(),
        heartbeatAtMs: 2_000,
      }),
    );
    await assertSucceeds(
      setDoc(doc(alice, "sparkRoomSnapshots/P2P22"), { ...snapshot, revision: 2 }),
    );
    await assertSucceeds(
      updateDoc(doc(alice, "sparkRoomDirectory/P2P22"), {
        heartbeatAt: serverTimestamp(),
        heartbeatAtMs: 3_000,
        lastActivityAt: serverTimestamp(),
        lastActivityAtMs: 3_000,
        authorityRevision: 2,
      }),
    );
    await assertSucceeds(
      getDoc(doc(environment.authenticatedContext("bob").firestore(), "sparkRoomSnapshots/P2P22")),
    );
    await assertFails(
      setDoc(doc(environment.authenticatedContext("bob").firestore(), "sparkRoomSnapshots/P2P22"), {
        schemaVersion: 1,
        roomId: "P2P22",
        coordinatorUid: "bob",
        revision: 2,
      }),
    );
  });

  test("stale cleanup is server-time gated and enforces snapshot then directory", async () => {
    const oldHeartbeat = Timestamp.fromMillis(Date.now() - 31 * 60_000);
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "sparkRoomDirectory/P2P22"), {
        ...directory,
        heartbeatAt: oldHeartbeat,
        lastActivityAt: oldHeartbeat,
      });
      await setDoc(doc(context.firestore(), "sparkRoomSnapshots/P2P22"), {
        schemaVersion: 1,
        roomId: "P2P22",
        coordinatorUid: "alice",
        revision: 1,
      });
    });

    const cleaner = environment.authenticatedContext("bob").firestore();
    await assertFails(deleteDoc(doc(cleaner, "sparkRoomDirectory/P2P22")));
    await assertSucceeds(deleteDoc(doc(cleaner, "sparkRoomSnapshots/P2P22")));
    await assertSucceeds(deleteDoc(doc(cleaner, "sparkRoomDirectory/P2P22")));
  });

  test("an abandoned pre-lastActivityAt directory uses its stale heartbeat as a safe fallback", async () => {
    const oldHeartbeat = Timestamp.fromMillis(Date.now() - 31 * 60_000);
    await environment.withSecurityRulesDisabled(async (context) => {
      const legacyDirectory: Record<string, unknown> = { ...directory };
      delete legacyDirectory.lastActivityAt;
      delete legacyDirectory.lastActivityAtMs;
      delete legacyDirectory.authorityRevision;
      await setDoc(doc(context.firestore(), "sparkRoomDirectory/P2P22"), {
        ...legacyDirectory,
        heartbeatAt: oldHeartbeat,
      });
      await setDoc(doc(context.firestore(), "sparkRoomSnapshots/P2P22"), {
        schemaVersion: 1,
        roomId: "P2P22",
        coordinatorUid: "alice",
        revision: 1,
      });
    });
    const cleaner = environment.authenticatedContext("bob").firestore();
    await assertSucceeds(deleteDoc(doc(cleaner, "sparkRoomSnapshots/P2P22")));
    await assertSucceeds(deleteDoc(doc(cleaner, "sparkRoomDirectory/P2P22")));
  });

  test("rolling deploy permits a legacy coordinator until the new client migrates it", async () => {
    const legacyDirectory: Record<string, unknown> = { ...directory };
    delete legacyDirectory.lastActivityAt;
    delete legacyDirectory.lastActivityAtMs;
    delete legacyDirectory.authorityRevision;
    const alice = environment.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(alice, "sparkRoomDirectory/P2P22"), legacyDirectory));
    await assertSucceeds(
      setDoc(doc(alice, "sparkRoomSnapshots/P2P22"), {
        schemaVersion: 1,
        roomId: "P2P22",
        coordinatorUid: "alice",
        revision: 1,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(alice, "sparkRoomDirectory/P2P22"), {
        heartbeatAt: serverTimestamp(),
        heartbeatAtMs: 2_000,
      }),
    );
  });

  test("a non-coordinator cannot reap a fresh room", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(alice, "sparkRoomDirectory/P2P22"), directory));
    await assertSucceeds(
      setDoc(doc(alice, "sparkRoomSnapshots/P2P22"), {
        schemaVersion: 1,
        roomId: "P2P22",
        coordinatorUid: "alice",
        revision: 1,
      }),
    );
    const bob = environment.authenticatedContext("bob").firestore();
    await assertFails(deleteDoc(doc(bob, "sparkRoomSnapshots/P2P22")));
    await assertFails(deleteDoc(doc(bob, "sparkRoomDirectory/P2P22")));
  });

  test("presence is writable only by the addressed anonymous Auth UID", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    const valid = {
      uid: "alice",
      peerId: "alice_peer",
      online: true,
      role: "player",
      name: "Alice",
      lastSeenMs: 1_000,
    };
    await assertSucceeds(setDoc(doc(alice, "sparkPresence/P2P22/members/alice"), valid));
    await assertFails(
      setDoc(doc(alice, "sparkPresence/P2P22/members/bob"), { ...valid, uid: "bob" }),
    );
    await assertFails(
      setDoc(doc(alice, "sparkPresence/P2P22/members/alice"), { ...valid, gameState: {} }),
    );
  });

  test("mailbox packets bind sender identity and can be queried only for the recipient", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    const packet = {
      senderUid: "alice",
      senderPeerId: "alice_peer",
      targetUid: "bob",
      targetPeerId: "bob_peer",
      kind: "wire",
      payload: JSON.stringify({ type: "hello" }),
      createdAtMs: 1_000,
      expiresAtMs: 61_000,
    };
    await assertSucceeds(setDoc(doc(alice, "sparkMailboxes/P2P22/items/message-1"), packet));
    await assertSucceeds(
      setDoc(doc(alice, "sparkMailboxes/P2P22/items/message-2"), {
        ...packet,
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(alice, "sparkMailboxes/P2P22/items/forged-clock"), {
        ...packet,
        createdAt: Timestamp.fromMillis(1_000),
      }),
    );
    const bob = environment.authenticatedContext("bob").firestore();
    await assertSucceeds(
      getDocs(
        query(collection(bob, "sparkMailboxes/P2P22/items"), where("targetUid", "==", "bob")),
      ),
    );
    await assertFails(
      getDocs(
        query(
          collection(
            environment.authenticatedContext("carol").firestore(),
            "sparkMailboxes/P2P22/items",
          ),
          where("targetUid", "==", "bob"),
        ),
      ),
    );
    await assertFails(
      setDoc(doc(alice, "sparkMailboxes/P2P22/items/spoof"), {
        ...packet,
        senderUid: "bob",
      }),
    );
    await assertSucceeds(
      setDoc(doc(alice, "sparkMailboxes/P2P22/items/peer-boundary"), {
        ...packet,
        senderPeerId: "p".repeat(192),
        targetPeerId: "q".repeat(192),
      }),
    );
    await assertFails(
      setDoc(doc(alice, "sparkMailboxes/P2P22/items/sender-peer-too-long"), {
        ...packet,
        senderPeerId: "p".repeat(193),
      }),
    );
    await assertFails(
      setDoc(doc(alice, "sparkMailboxes/P2P22/items/target-peer-too-long"), {
        ...packet,
        targetPeerId: "q".repeat(193),
      }),
    );
    await assertSucceeds(
      setDoc(doc(alice, "sparkSignals/P2P22/items/signal-boundary"), {
        ...packet,
        senderPeerId: "p".repeat(192),
        targetPeerId: "q".repeat(192),
        kind: "offer",
      }),
    );
    await assertFails(
      setDoc(doc(alice, "sparkSignals/P2P22/items/signal-peer-too-long"), {
        ...packet,
        senderPeerId: "p".repeat(193),
        kind: "offer",
      }),
    );
  });
});

describe("WebRTC signaling boundary", () => {
  test("only the authenticated sender can create a bounded signal for a room member", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    const signal = doc(alice, "webrtcRooms/ABCDE/signals/signal-1");
    await assertSucceeds(
      setDoc(signal, {
        senderUid: "alice",
        targetUid: "bob",
        kind: "offer",
        payload: "short-sdp",
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60_000),
      }),
    );
    await assertSucceeds(
      getDoc(
        doc(
          environment.authenticatedContext("bob").firestore(),
          "webrtcRooms/ABCDE/signals/signal-1",
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          environment.authenticatedContext("carol").firestore(),
          "webrtcRooms/ABCDE/signals/signal-1",
        ),
      ),
    );
  });

  test("sender spoofing, non-member targets, and oversized payloads are denied", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    const base = {
      senderUid: "alice",
      targetUid: "bob",
      kind: "ice",
      payload: "candidate",
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    };
    await assertFails(
      setDoc(doc(alice, "webrtcRooms/ABCDE/signals/spoof"), { ...base, senderUid: "bob" }),
    );
    await assertFails(
      setDoc(doc(alice, "webrtcRooms/ABCDE/signals/nonmember"), { ...base, targetUid: "carol" }),
    );
    await assertFails(
      setDoc(doc(alice, "webrtcRooms/ABCDE/signals/large"), {
        ...base,
        payload: "x".repeat(32769),
      }),
    );
  });
});

describe("ephemeral cue fallback boundary", () => {
  test("room members can publish and read only bounded presentation cues", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    const cue = doc(alice, "webrtcRooms/ABCDE/cues/cue-1");
    await assertSucceeds(
      setDoc(cue, {
        senderUid: "alice",
        kind: "emote",
        payload: JSON.stringify({ emote: "applause" }),
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      }),
    );
    await assertSucceeds(
      getDoc(
        doc(environment.authenticatedContext("bob").firestore(), "webrtcRooms/ABCDE/cues/cue-1"),
      ),
    );
    await assertFails(
      getDoc(
        doc(environment.authenticatedContext("carol").firestore(), "webrtcRooms/ABCDE/cues/cue-1"),
      ),
    );
  });

  test("authoritative fields, sender spoofing, bad kinds, and large payloads are denied", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    const base = {
      senderUid: "alice",
      kind: "focus",
      payload: "player-bob",
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    };
    await assertFails(
      setDoc(doc(alice, "webrtcRooms/ABCDE/cues/authority"), { ...base, turnPlayerId: "alice" }),
    );
    await assertFails(
      setDoc(doc(alice, "webrtcRooms/ABCDE/cues/spoof"), { ...base, senderUid: "bob" }),
    );
    await assertFails(
      setDoc(doc(alice, "webrtcRooms/ABCDE/cues/bad-kind"), { ...base, kind: "cardMove" }),
    );
    await assertFails(
      setDoc(doc(alice, "webrtcRooms/ABCDE/cues/large"), { ...base, payload: "x".repeat(2049) }),
    );
  });
});

describe("authoritative transaction boundary", () => {
  test("same action id is returned once and stale revisions are rejected", async () => {
    const now = AdminTimestamp.fromMillis(1_000);
    const room: RoomDocument = {
      schemaVersion: 2,
      roomId: "FGHJK",
      status: "waiting",
      visibility: "public",
      revision: 0,
      gameId: null,
      rematchGeneration: 0,
      hostUid: "alice",
      settings: { mode: "normal", blindCount: 0 },
      members: {
        alice: {
          uid: "alice",
          name: "Alice",
          role: "player",
          connectionStatus: "connected",
          joinedAt: now,
          joinedOrder: 0,
          avatar: { schemaVersion: 1 },
          focusPlayerId: null,
          reconnectTokenHash: "00".repeat(32),
          disconnectDeadlineAt: null,
          reconnectExpired: false,
          timeoutWarnings: 0,
          lastChatAt: null,
        },
      },
      game: null,
      cardTokens: {},
      pendingMimic: null,
      publicChat: [],
      publicEvents: [],
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      expiresAt: AdminTimestamp.fromMillis(100_000),
      turnDeadlineAt: null,
      nextDeadlineAt: null,
      nextDeadlineKind: null,
      frozenReason: null,
    };
    await adminFirestore.doc("v2Rooms/FGHJK").set(room);
    let mutatorCalls = 0;
    const identity = {
      uid: "alice",
      command: "testMutation",
      roomId: "FGHJK",
      gameId: null,
      expectedRevision: 0,
      clientActionId: "idempotent-action-1234",
    };
    const mutate = (current: RoomDocument) => {
      mutatorCalls += 1;
      const next = cloneRoom(current);
      next.visibility = "private";
      return { room: next };
    };

    const first = await executeRoomMutation(identity, mutate);
    const duplicate = await executeRoomMutation(identity, mutate);
    expect(first).toEqual(duplicate);
    expect(mutatorCalls).toBe(1);
    expect((await adminFirestore.doc("v2Rooms/FGHJK").get()).get("revision")).toBe(1);

    await expect(
      executeRoomMutation(
        { ...identity, clientActionId: "stale-action-123456", expectedRevision: 0 },
        mutate,
      ),
    ).rejects.toMatchObject({ code: "aborted" });
  });
});
