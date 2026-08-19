import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { get, ref, remove, set } from "firebase/database";
import { Timestamp as AdminTimestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { firestore as adminFirestore } from "../../src/config.js";
import { cloneRoom, executeRoomMutation } from "../../src/callable/command-store.js";
import type { RoomDocument } from "../../src/model.js";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
let environment: RulesTestEnvironment;

beforeAll(async () => {
  const [firestoreRules, databaseRules] = await Promise.all([
    readFile(`${projectRoot}/firestore.rules`, "utf8"),
    readFile(`${projectRoot}/database.rules.json`, "utf8"),
  ]);
  environment = await initializeTestEnvironment({
    projectId: "daifugo-8e039",
    firestore: { rules: firestoreRules },
    database: { rules: databaseRules },
  });
});

beforeEach(async () => {
  await Promise.all([environment.clearFirestore(), environment.clearDatabase()]);
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

describe("Realtime Database presence", () => {
  test("users can write only their bounded presence leaf", async () => {
    const alice = environment.authenticatedContext("alice").database();
    const valid = ref(alice, "v2Presence/ABCDE/alice");
    await assertSucceeds(set(valid, { online: true, connectionId: "tab-a", lastChanged: 1234 }));
    await assertSucceeds(get(ref(alice, "v2Presence/ABCDE")));
    await assertSucceeds(remove(valid));
  });

  test("impersonation, malformed room ids, and extra fields are denied", async () => {
    const alice = environment.authenticatedContext("alice").database();
    await assertFails(
      set(ref(alice, "v2Presence/ABCDE/bob"), { online: true, connectionId: "x", lastChanged: 1 }),
    );
    await assertFails(
      set(ref(alice, "v2Presence/bad/alice"), { online: true, connectionId: "x", lastChanged: 1 }),
    );
    await assertFails(
      set(ref(alice, "v2Presence/ABCDE/alice"), {
        online: true,
        connectionId: "x",
        lastChanged: 1,
        injected: true,
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
