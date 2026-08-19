import {
  createInitialGameState,
  type EffectSelection,
  type GameEvent,
  type GameState,
} from "@daifugo/rules";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import {
  appendPublicEvents,
  appendPublicGameEvents,
  PUBLIC_EVENT_LIMIT,
} from "../src/logging/public-events.js";
import type { RoomDocument, RoomMember } from "../src/model.js";
import { projectRoomForViewer } from "../src/projections/project-room.js";

function member(uid: string, order: number): RoomMember {
  const now = Timestamp.fromMillis(1_000);
  return {
    uid,
    name: uid,
    role: "player",
    connectionStatus: "connected",
    joinedAt: now,
    joinedOrder: order,
    avatar: { schemaVersion: 1 },
    focusPlayerId: null,
    reconnectTokenHash: "reconnect-secret-hash",
    disconnectDeadlineAt: null,
    reconnectExpired: false,
    timeoutWarnings: 0,
    lastChatAt: null,
  };
}

function cloneGame(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function roomWith(game: GameState): RoomDocument {
  const now = Timestamp.fromMillis(1_000);
  return {
    schemaVersion: 2,
    roomId: "ABCDE",
    status: "playing",
    visibility: "public",
    revision: 7,
    gameId: game.id,
    rematchGeneration: 0,
    hostUid: "alice",
    settings: { mode: "normal", blindCount: 0 },
    members: {
      alice: member("alice", 0),
      bob: member("bob", 1),
      carol: member("carol", 2),
    },
    game,
    cardTokens: {
      "secret-card-id": "c_private-token",
      "secret-joker-id": "c_private-joker-token",
    },
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

function game(): GameState {
  return createInitialGameState(["alice", "bob", "carol"], {
    mode: "normal",
    gameId: "public-log-game",
    rng: () => 0.4,
  });
}

describe("safe authoritative public events", () => {
  test("records public card faces and state/effect changes without physical ids or tokens", () => {
    const before = game();
    const after = cloneGame(before);
    after.binding = ["spade"];
    after.revolution = true;
    after.direction = -1;
    after.jackBack = true;
    const events: GameEvent[] = [
      {
        type: "played",
        playerId: "alice",
        play: {
          id: "secret-action-id",
          playerId: "alice",
          kind: "group",
          cards: [
            {
              card: { id: "secret-card-id", suit: "spade", rank: "5" },
              suit: "spade",
              rank: "5",
              mimic: null,
            },
            {
              card: { id: "secret-joker-id", suit: null, rank: "JOKER" },
              suit: "heart",
              rank: "5",
              mimic: { cardId: "secret-joker-id", suit: "heart", rank: "5" },
            },
          ],
        },
      },
    ];
    const room = roomWith(after);
    const now = Timestamp.fromMillis(9_876);

    appendPublicGameEvents(room, before, events, "alice", now, {
      blindCardIds: ["secret-joker-id"],
    });

    const serialized = JSON.stringify(room.publicEvents);
    expect(serialized).toContain("♠5");
    expect(serialized).toContain("Joker→♥5");
    expect(room.publicEvents.map((entry) => entry.type)).toEqual(
      expect.arrayContaining([
        "played",
        "effect-triggered",
        "binding-changed",
        "revolution-changed",
        "direction-changed",
        "jack-back-changed",
        "blind-success",
      ]),
    );
    expect(room.publicEvents.every((entry) => entry.createdAt.toMillis() === 9_876)).toBe(true);
    expect(serialized).not.toContain("secret-card-id");
    expect(serialized).not.toContain("secret-joker-id");
    expect(serialized).not.toContain("c_private-token");
    expect(serialized).not.toContain("reconnect-secret-hash");
    const projection = projectRoomForViewer(room, "bob");
    expect(JSON.stringify(projection.log)).toContain("♠5");
    expect(JSON.stringify(projection.log)).toContain("革命状態が変わりました");
    expect(JSON.stringify(projection.events)).not.toContain("secret-card-id");
  });

  test("effect resolution names only cards that became public", () => {
    const before = game();
    const alice = before.players.find((player) => player.id === "alice")!;
    alice.hand = [
      { card: { id: "private-normal-nine", suit: "spade", rank: "9" }, blind: false },
      { card: { id: "revealed-blind-seven", suit: "diamond", rank: "7" }, blind: true },
    ];
    before.pendingEffect = { id: "private-effect-id", type: "give", actorId: "alice", count: 2 };
    const after = cloneGame(before);
    after.pendingEffect = null;
    const room = roomWith(after);
    const selection: EffectSelection = {
      type: "give",
      transfers: [{ playerId: "bob", cardIds: ["private-normal-nine", "revealed-blind-seven"] }],
    };

    appendPublicGameEvents(room, before, [], "alice", Timestamp.fromMillis(2_000), {
      selection,
    });

    const resolution = room.publicEvents.find((entry) => entry.type === "effect-resolved")!;
    expect(resolution.detail).toMatchObject({
      effect: "give",
      cardCount: 2,
      cards: ["♦7"],
      targets: ["bob:2"],
    });
    const serialized = JSON.stringify(resolution);
    expect(serialized).not.toContain("private-normal-nine");
    expect(serialized).not.toContain("revealed-blind-seven");
    expect(serialized).not.toContain("♠9");
  });

  test("caps history at 300 and filters arbitrary values from card labels", () => {
    const room = roomWith(game());
    room.publicEvents = Array.from({ length: 295 }, (_, index) => ({
      id: `old-${index}`,
      type: "passed",
      actorUid: "alice",
      createdAt: Timestamp.fromMillis(index),
      revision: index,
      detail: {},
    }));
    const now = Timestamp.fromMillis(50_000);
    appendPublicEvents(
      room,
      Array.from({ length: 20 }, (_, index) => ({
        type: "played",
        actorUid: "alice",
        detail: { cards: [index === 0 ? "raw-secret-card-id" : "♣3"], cardCount: 1 },
      })),
      now,
    );

    expect(room.publicEvents).toHaveLength(PUBLIC_EVENT_LIMIT);
    expect(room.publicEvents.at(-1)?.createdAt.toMillis()).toBe(50_000);
    expect(JSON.stringify(room.publicEvents)).not.toContain("raw-secret-card-id");
  });
});
