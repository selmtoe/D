import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import type { RoomDocument, RoomMember } from "../src/model.js";
import { __timerTest } from "../src/timers/sweep-deadlines.js";

function member(
  uid: string,
  order: number,
  connectionStatus: RoomMember["connectionStatus"],
  deadline: number | null,
): RoomMember {
  return {
    uid,
    name: uid,
    role: "player",
    connectionStatus,
    joinedAt: Timestamp.fromMillis(0),
    joinedOrder: order,
    avatar: { schemaVersion: 1 },
    focusPlayerId: null,
    reconnectTokenHash: "00".repeat(32),
    disconnectDeadlineAt: deadline === null ? null : Timestamp.fromMillis(deadline),
    reconnectExpired: false,
    timeoutWarnings: 0,
    lastChatAt: null,
  };
}

function waitingRoom(): RoomDocument {
  const now = Timestamp.fromMillis(0);
  return {
    schemaVersion: 2,
    roomId: "ABCDE",
    status: "waiting",
    visibility: "public",
    revision: 1,
    gameId: null,
    rematchGeneration: 0,
    hostUid: "alice",
    settings: { mode: "normal", blindCount: 0 },
    members: {
      alice: member("alice", 0, "grace", 120_000),
      bob: member("bob", 1, "connected", null),
    },
    game: null,
    cardTokens: {},
    pendingMimic: null,
    publicChat: [],
    publicEvents: [],
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    expiresAt: Timestamp.fromMillis(1_000_000),
    turnDeadlineAt: null,
    nextDeadlineAt: Timestamp.fromMillis(120_000),
    nextDeadlineKind: "disconnect",
    frozenReason: null,
  };
}

describe("authoritative reconnect deadline", () => {
  test("keeps the seat through exactly 120 seconds and expires it only after the boundary", () => {
    const room = waitingRoom();
    expect(__timerTest.expireDeadlines(room, Timestamp.fromMillis(120_000))).toBeNull();
    expect(room.hostUid).toBe("alice");

    const expired = __timerTest.expireDeadlines(room, Timestamp.fromMillis(120_001));
    expect(expired?.room).not.toBeNull();
    const next = expired?.room as RoomDocument;
    // A waiting player has no game result to retain, so expiry removes the
    // member instead of accumulating an unbounded `left` tombstone.
    expect(next.members).not.toHaveProperty("alice");
    expect(next.hostUid).toBe("bob");
    expect(next.publicEvents.map((entry) => entry.type)).toEqual([
      "reconnect-expired",
      "timeout-warning",
      "host-transferred",
    ]);
    expect(next.publicEvents[0]).toMatchObject({
      actorUid: "alice",
      detail: { warningCount: 1 },
    });
    expect(next.publicEvents.every((entry) => entry.createdAt.toMillis() === 120_001)).toBe(true);
  });
});
