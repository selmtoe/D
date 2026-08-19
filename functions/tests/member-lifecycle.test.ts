import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { createInitialGameState } from "@daifugo/rules";
import { describe, expect, test, vi } from "vitest";
import type { RoomDocument, RoomMember } from "../src/model.js";
import { writeRoomProjections } from "../src/projections/write-projections.js";
import {
  activeSpectatorCount,
  endMembership,
  MAX_ACTIVE_SPECTATORS,
  pruneNonParticipantTombstones,
  requireSpectatorCapacity,
} from "../src/room/member-lifecycle.js";

function member(
  uid: string,
  role: "player" | "spectator",
  order: number,
  connectionStatus: RoomMember["connectionStatus"] = "connected",
): RoomMember {
  const now = Timestamp.fromMillis(1_000);
  return {
    uid,
    name: uid,
    role,
    connectionStatus,
    joinedAt: now,
    joinedOrder: order,
    avatar: { schemaVersion: 1 },
    focusPlayerId: null,
    reconnectTokenHash: "00".repeat(32),
    disconnectDeadlineAt: null,
    reconnectExpired: false,
    timeoutWarnings: 0,
    lastChatAt: null,
  };
}

function roomWith(members: Record<string, RoomMember>): RoomDocument {
  const now = Timestamp.fromMillis(1_000);
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
    members,
    game: null,
    cardTokens: {},
    pendingMimic: null,
    publicChat: [],
    publicEvents: [],
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    expiresAt: Timestamp.fromMillis(10_000),
    turnDeadlineAt: null,
    nextDeadlineAt: null,
    nextDeadlineKind: null,
    frozenReason: null,
  };
}

describe("bounded room membership", () => {
  test("caps connected and grace spectators at 32 while ignoring old left tombstones", () => {
    const members: Record<string, RoomMember> = {
      alice: member("alice", "player", 0),
      old: member("old", "spectator", 99, "left"),
    };
    for (let index = 0; index < MAX_ACTIVE_SPECTATORS; index += 1) {
      const uid = `watcher-${index}`;
      members[uid] = member(uid, "spectator", index + 1, index === 0 ? "grace" : "connected");
    }

    expect(activeSpectatorCount(members)).toBe(32);
    expect(() => requireSpectatorCapacity(members)).toThrow(/gallery is full/i);
    delete members["watcher-31"];
    expect(() => requireSpectatorCapacity(members)).not.toThrow();
  });

  test("removes spectators and waiting players but retains only actual game players", () => {
    const waiting = roomWith({
      alice: member("alice", "player", 0),
      bob: member("bob", "player", 1),
      watcher: member("watcher", "spectator", 2),
    });
    expect(endMembership(waiting, "watcher")).toBe("removed");
    expect(endMembership(waiting, "bob")).toBe("removed");
    expect(waiting.members).not.toHaveProperty("watcher");
    expect(waiting.members).not.toHaveProperty("bob");

    const playing = roomWith({
      alice: member("alice", "player", 0),
      bob: member("bob", "player", 1),
      carol: member("carol", "player", 2),
      stale: member("stale", "spectator", 3, "left"),
    });
    playing.status = "playing";
    playing.gameId = "game-membership";
    playing.game = createInitialGameState(["alice", "bob", "carol"], {
      mode: "normal",
      gameId: playing.gameId,
      rng: () => 0.4,
    });
    expect(endMembership(playing, "bob")).toBe("retained");
    expect(playing.members.bob?.connectionStatus).toBe("left");
    pruneNonParticipantTombstones(playing);
    expect(playing.members).not.toHaveProperty("stale");
    expect(playing.members).toHaveProperty("bob");
  });

  test("deletes a removed member's viewer projection in the same transaction", () => {
    const previous = roomWith({
      alice: member("alice", "player", 0),
      watcher: member("watcher", "spectator", 1),
    });
    const room = roomWith({ alice: member("alice", "player", 0) });
    room.revision = 2;
    const deletedPaths: string[] = [];
    const transaction = {
      set: vi.fn(),
      delete: vi.fn((reference: { path: string }) => {
        deletedPaths.push(reference.path);
      }),
    } as unknown as Transaction;

    writeRoomProjections(transaction, room, previous);

    expect(deletedPaths).toContain("v2RoomViews/ABCDE/viewers/watcher");
    expect(deletedPaths).not.toContain("v2RoomViews/ABCDE/viewers/alice");
  });
});
