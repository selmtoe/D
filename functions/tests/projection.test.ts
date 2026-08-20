import { Timestamp } from "firebase-admin/firestore";
import { createInitialGameState } from "@daifugo/rules";
import { describe, expect, test } from "vitest";
import { createCardTokenMap } from "../src/game/rules-adapter.js";
import type { RoomDocument, RoomMember } from "../src/model.js";
import {
  projectPendingEffect,
  projectPublicRoom,
  projectRoomForViewer,
} from "../src/projections/project-room.js";

function member(uid: string, role: "player" | "spectator", order: number): RoomMember {
  const now = Timestamp.fromMillis(1_000);
  return {
    uid,
    name: uid,
    role,
    connectionStatus: "connected",
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

function blindRoom(): RoomDocument {
  const game = createInitialGameState(["alice", "bob", "carol"], {
    mode: "blind",
    blindCount: 10,
    gameId: "game-test",
    rng: () => 0.125,
  });
  const now = Timestamp.fromMillis(1_000);
  return {
    schemaVersion: 2,
    roomId: "ABCDE",
    status: "playing",
    visibility: "public",
    revision: 1,
    gameId: "game-test",
    rematchGeneration: 0,
    hostUid: "alice",
    settings: { mode: "blind", blindCount: 10 },
    members: {
      alice: member("alice", "player", 0),
      bob: member("bob", "player", 1),
      carol: member("carol", "player", 2),
      watcher: member("watcher", "spectator", 3),
    },
    game,
    cardTokens: createCardTokenMap(game),
    pendingMimic: null,
    publicChat: [],
    publicEvents: [],
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    expiresAt: Timestamp.fromMillis(10_000),
    turnDeadlineAt: Timestamp.fromMillis(61_000),
    nextDeadlineAt: Timestamp.fromMillis(61_000),
    nextDeadlineKind: "turn",
    frozenReason: null,
  };
}

describe("viewer-specific projection", () => {
  test("expanded optional face paint survives private and lobby avatar projections", () => {
    const room = blindRoom();
    const avatar = {
      schemaVersion: 1,
      facePaint: {
        version: 1,
        strokes: [
          {
            mode: "paint",
            color: "#aabbcc",
            width: 0.04,
            points: [{ x: 0.25, y: 0.75 }],
          },
        ],
      },
    };
    room.members.alice!.avatar = avatar;
    const view = projectRoomForViewer(room, "alice");
    const alice = (view.players as Array<Record<string, unknown>>).find(
      (player) => player.id === "alice",
    );
    expect(alice?.avatar).toEqual(avatar);
    expect(projectPublicRoom(room).hostAvatar).toEqual(avatar);
  });

  test("public game events keep their authoritative timestamps in the log", () => {
    const room = blindRoom();
    room.publicEvents = [
      {
        id: "evt-1",
        type: "played",
        actorUid: "alice",
        createdAt: Timestamp.fromMillis(777),
        revision: 2,
      },
    ];
    room.updatedAt = Timestamp.fromMillis(999);
    const view = projectRoomForViewer(room, "alice");
    expect(view.log).toEqual([
      { id: "evt-1", atMs: 777, text: "alice: 札を出しました", kind: "play" },
    ]);
  });

  test("rankings preserve a user-facing finish reason", () => {
    const room = blindRoom();
    const alice = room.game!.players.find((player) => player.id === "alice")!;
    alice.status = "disqualified";
    alice.rank = 3;
    alice.finishReason = "disqualified";
    const view = projectRoomForViewer(room, "watcher");
    expect(view.rankings).toContainEqual({ playerId: "alice", place: 3, reason: "失格" });
  });

  test("the owner receives no face or physical card id for blind cards", () => {
    const room = blindRoom();
    const view = projectRoomForViewer(room, "alice");
    const hand = view.hand as Array<Record<string, unknown>>;
    const blind = hand.filter((card) => card.blind === true);
    expect(blind.length).toBeGreaterThan(0);
    for (const card of blind) {
      expect(card.visibility).toBe("hidden");
      expect(String(card.id)).toMatch(/^c_[A-Za-z0-9_-]+$/);
      expect(card).not.toHaveProperty("suit");
      expect(card).not.toHaveProperty("rank");
    }
    for (const entry of room.game!.players[0]!.hand.filter((card) => card.blind)) {
      expect(JSON.stringify(view)).not.toContain(entry.card.id);
    }
  });

  test("opponents see blind faces while normal opponent cards stay hidden", () => {
    const view = projectRoomForViewer(blindRoom(), "alice");
    const bob = (view.players as Array<Record<string, unknown>>).find(
      (player) => player.id === "bob",
    )!;
    const cards = bob.cards as Array<Record<string, unknown>>;
    expect(cards.some((card) => card.blind === true && card.visibility === "face")).toBe(true);
    expect(cards.some((card) => card.blind === false && card.visibility === "hidden")).toBe(true);
    expect(
      cards
        .filter((card) => card.blind === false && card.visibility === "hidden")
        .every((card) => String(card.id).startsWith("back_1_bob_")),
    ).toBe(true);
  });

  test("opponent back tokens cannot be correlated across revisions except for the steal actor", () => {
    const room = blindRoom();
    const first = projectRoomForViewer(room, "alice");
    const firstBob = (first.players as Array<Record<string, unknown>>).find(
      (player) => player.id === "bob",
    )!;
    const firstHidden = (firstBob.cards as Array<Record<string, unknown>>)
      .filter((card) => card.visibility === "hidden")
      .map((card) => card.id);
    expect(firstHidden.some((id) => Object.values(room.cardTokens).includes(String(id)))).toBe(
      false,
    );

    room.revision = 2;
    const second = projectRoomForViewer(room, "alice");
    const secondBob = (second.players as Array<Record<string, unknown>>).find(
      (player) => player.id === "bob",
    )!;
    const secondHidden = (secondBob.cards as Array<Record<string, unknown>>)
      .filter((card) => card.visibility === "hidden")
      .map((card) => card.id);
    expect(secondHidden).not.toEqual(firstHidden);

    room.game!.pendingEffect = { id: "steal-1", type: "steal", actorId: "alice", count: 1 };
    const stealView = projectRoomForViewer(room, "alice");
    const stealBob = (stealView.players as Array<Record<string, unknown>>).find(
      (player) => player.id === "bob",
    )!;
    const selectableHidden = (stealBob.cards as Array<Record<string, unknown>>)
      .filter((card) => card.visibility === "hidden")
      .map((card) => String(card.id));
    expect(selectableHidden.every((id) => id.startsWith("c_"))).toBe(true);
  });

  test("pending effect counts are clamped and eligibility is visible only to its actor", () => {
    const room = blindRoom();
    const discarded = room.game!.players[1]!.hand.pop()!;
    room.game!.discard.push(discarded.card);
    room.game!.pendingEffect = { id: "recover-1", type: "recover", actorId: "alice", count: 4 };
    const actor = projectPendingEffect(room, "alice")[0]!;
    const spectator = projectPendingEffect(room, "watcher")[0]!;
    expect(actor.requiredCount).toBe(1);
    expect(actor.eligibleCardIds).toEqual([room.cardTokens[discarded.card.id]]);
    expect(spectator).not.toHaveProperty("eligibleCardIds");

    room.game!.pendingEffect = { id: "give-1", type: "give", actorId: "alice", count: 99 };
    const actorHandCount = room.game!.players.find((player) => player.id === "alice")!.hand.length;
    expect(projectPendingEffect(room, "alice")[0]?.requiredCount).toBe(actorHandCount);
    room.game!.pendingEffect = { id: "discard-1", type: "discard", actorId: "alice", count: 99 };
    expect(projectPendingEffect(room, "alice")[0]?.requiredCount).toBe(actorHandCount);
    room.game!.pendingEffect = { id: "steal-1", type: "steal", actorId: "alice", count: 99 };
    const available = room
      .game!.players.filter((player) => player.id !== "alice" && player.status === "active")
      .reduce((sum, player) => sum + player.hand.length, 0);
    expect(projectPendingEffect(room, "alice")[0]?.requiredCount).toBe(available);
  });

  test("spectators receive every hand face and never the token map", () => {
    const view = projectRoomForViewer(blindRoom(), "watcher");
    expect(view.role).toBe("spectator");
    const players = view.players as Array<Record<string, unknown>>;
    const cards = players.flatMap((player) => player.cards as Array<Record<string, unknown>>);
    expect(cards.length).toBe(54);
    expect(cards.every((card) => card.visibility === "face")).toBe(true);
    expect(view).not.toHaveProperty("cardTokens");
  });
});
