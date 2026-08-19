import { Timestamp } from "firebase-admin/firestore";
import { createInitialGameState } from "@daifugo/rules";
import { describe, expect, test } from "vitest";
import {
  createCardTokenMap,
  legalJokerMimicCandidates,
  requiresBlindJokerMimicDeclaration,
  runGameCommand,
} from "../src/game/rules-adapter.js";
import { applyPendingMimic } from "../src/game/pending-mimic.js";
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
    reconnectTokenHash: "00".repeat(32),
    disconnectDeadlineAt: null,
    reconnectExpired: false,
    timeoutWarnings: 0,
    lastChatAt: null,
  };
}

describe("blind Joker declaration boundary", () => {
  test("publishes candidates only to the owner and atomically applies the committed cards", () => {
    const game = createInitialGameState(["alice", "bob", "carol"], {
      mode: "blind",
      blindCount: 1,
      gameId: "mimic-test",
      rng: () => 0.4,
    });
    game.firstPlay = false;
    game.turnPlayerId = "alice";
    const alice = game.players.find((player) => player.id === "alice")!;
    alice.hand = [
      { card: { id: "test-spade-5", suit: "spade", rank: "5" }, blind: false },
      { card: { id: "test-joker", suit: null, rank: "JOKER" }, blind: true },
      { card: { id: "test-spade-7", suit: "spade", rank: "7" }, blind: false },
    ];
    const cardIds = alice.hand.map((entry) => entry.card.id);
    expect(requiresBlindJokerMimicDeclaration(game, "alice", cardIds)).toBe(true);
    const candidates = legalJokerMimicCandidates(game, "alice", cardIds);
    expect(candidates).toEqual([[{ cardId: "test-joker", suit: "spade", rank: "6" }]]);

    const now = Timestamp.fromMillis(1_000);
    const room: RoomDocument = {
      schemaVersion: 2,
      roomId: "ABCDE",
      status: "playing",
      visibility: "public",
      revision: 4,
      gameId: "mimic-test",
      rematchGeneration: 0,
      hostUid: "alice",
      settings: { mode: "blind", blindCount: 1 },
      members: {
        alice: member("alice", 0),
        bob: member("bob", 1),
        carol: member("carol", 2),
      },
      game,
      cardTokens: createCardTokenMap(game),
      pendingMimic: {
        actorUid: "alice",
        cardIds,
        candidates,
        committedActionId: "commit-action-1234",
        createdAt: now,
      },
      publicChat: [],
      publicEvents: [],
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      expiresAt: Timestamp.fromMillis(100_000),
      turnDeadlineAt: Timestamp.fromMillis(61_000),
      nextDeadlineAt: Timestamp.fromMillis(61_000),
      nextDeadlineKind: "turn",
      frozenReason: null,
    };

    const ownerView = projectRoomForViewer(room, "alice");
    const opponentView = projectRoomForViewer(room, "bob");
    expect(ownerView).toHaveProperty("pendingJokerMimic");
    const pendingView = ownerView.pendingJokerMimic as {
      revealedCards: Array<{ id: string; face: { rank: string }; blind: boolean }>;
    };
    expect(pendingView.revealedCards).toHaveLength(3);
    expect(pendingView.revealedCards.find((card) => card.face.rank === "JOKER")).toMatchObject({
      id: expect.stringMatching(/^c_/),
      blind: true,
    });
    expect(JSON.stringify(ownerView)).not.toContain("test-joker");
    expect(opponentView).not.toHaveProperty("pendingJokerMimic");

    applyPendingMimic(room, candidates[0]!, "declare-action-1234", 2_000);
    expect(room.pendingMimic).toBeNull();
    expect(room.game?.pile?.cards.find((card) => card.card.id === "test-joker")?.mimic).toEqual({
      cardId: "test-joker",
      suit: "spade",
      rank: "6",
    });
  });

  test("plays a blind Joker plus the other Joker as a raw pair without a mimic declaration", () => {
    const game = createInitialGameState(["alice", "bob", "carol"], {
      mode: "blind",
      blindCount: 1,
      gameId: "raw-joker-pair-test",
      rng: () => 0.4,
    });
    game.firstPlay = false;
    game.turnPlayerId = "alice";
    const alice = game.players.find((player) => player.id === "alice")!;
    alice.hand = [
      { card: { id: "blind-joker", suit: null, rank: "JOKER" }, blind: true },
      { card: { id: "visible-joker", suit: null, rank: "JOKER" }, blind: false },
      { card: { id: "remaining-five", suit: "spade", rank: "5" }, blind: false },
    ];
    const cardIds = ["blind-joker", "visible-joker"];

    expect(requiresBlindJokerMimicDeclaration(game, "alice", cardIds)).toBe(false);
    expect(legalJokerMimicCandidates(game, "alice", cardIds)).toEqual([[]]);

    const applied = runGameCommand(
      game,
      {
        type: "play",
        playerId: "alice",
        cardIds,
        jokerMimics: [],
        blindConfirmed: true,
        actionId: "raw-joker-pair-action",
        expectedVersion: game.version,
      },
      2_000,
    );
    const resultingAlice = applied.state.players.find((player) => player.id === "alice")!;
    expect(resultingAlice.status).toBe("active");
    expect(resultingAlice.hand.map((entry) => entry.card.id)).toEqual(["remaining-five"]);
    expect(applied.eventTypes).toContain("played");
    expect(applied.state.discard.filter((card) => card.rank === "JOKER")).toHaveLength(2);
  });
});
