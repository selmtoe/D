import { createInitialGameState } from "@daifugo/rules";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, test } from "vitest";
import {
  finalizeRoom,
  MAX_AUTHORITY_REPLAY_BYTES,
  MAX_AUTHORITY_REPLAY_FRAMES,
} from "../src/callable/command-store.js";
import { createCardTokenMap } from "../src/game/rules-adapter.js";
import type { RoomDocument, RoomMember } from "../src/model.js";
import { projectRoomForViewer } from "../src/projections/project-room.js";

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

function playingRoom(): RoomDocument {
  const game = createInitialGameState(["alice", "bob", "carol"], {
    gameId: "authority-replay-game",
    mode: "normal",
    rng: () => 0.25,
  });
  const now = Timestamp.fromMillis(1_000);
  return {
    schemaVersion: 2,
    roomId: "REPLY",
    status: "playing",
    visibility: "private",
    revision: 1,
    gameId: game.id,
    rematchGeneration: 0,
    hostUid: "alice",
    settings: { mode: "normal", blindCount: 0 },
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
    expiresAt: Timestamp.fromMillis(100_000),
    turnDeadlineAt: Timestamp.fromMillis(61_000),
    nextDeadlineAt: Timestamp.fromMillis(61_000),
    nextDeadlineKind: "turn",
    frozenReason: null,
  };
}

function advance(room: RoomDocument, atMs: number): RoomDocument {
  const game = structuredClone(room.game!);
  game.version += 1;
  return finalizeRoom(room, { ...room, game }, Timestamp.fromMillis(atMs), false);
}

describe("Firebase authority replay", () => {
  test("records revision-stamped GameStates through the shared command/system finalizer", () => {
    const first = advance(playingRoom(), 2_000);
    const second = advance(first, 2_500);

    expect(
      second.authoritativeReplay?.map(({ revision, capturedAtMs, game }) => ({
        revision,
        capturedAtMs,
        version: game.version,
      })),
    ).toEqual([
      { revision: 2, capturedAtMs: 2_000, version: 1 },
      { revision: 3, capturedAtMs: 2_500, version: 2 },
    ]);
  });

  test("never includes replay hands in an active player's live projection", () => {
    const room = advance(playingRoom(), 2_000);
    const bob = room.game!.players.find((player) => player.id === "bob")!;
    const bobCard = bob.hand[0]!.card;
    const view = projectRoomForViewer(room, "alice");

    expect(view).not.toHaveProperty("authoritativeReplay");
    const bobView = (view.players as Array<Record<string, unknown>>).find(
      (player) => player.id === "bob",
    )!;
    expect((bobView.cards as Array<Record<string, unknown>>)[0]).toMatchObject({
      visibility: "hidden",
    });
    expect(JSON.stringify(view)).not.toContain(bobCard.id);
  });

  test("does not spend replay capacity on a room-only revision", () => {
    const first = advance(playingRoom(), 2_000);
    const roomOnly = finalizeRoom(
      first,
      { ...first, publicEvents: [...first.publicEvents] },
      Timestamp.fromMillis(2_100),
      false,
    );
    expect(roomOnly.authoritativeReplay).toHaveLength(1);
  });

  test("projects tokenized face-up history only after room finish", () => {
    const room = advance(playingRoom(), 2_000);
    const physicalIds = room.game!.players.flatMap((player) =>
      player.hand.map((entry) => entry.card.id),
    );
    expect(projectRoomForViewer(room, "watcher")).not.toHaveProperty("authoritativeReplay");

    room.status = "finished";
    const finishedPlayerView = projectRoomForViewer(room, "alice");
    const frames = finishedPlayerView.authoritativeReplay as Array<Record<string, unknown>>;
    const replayGame = frames[0]!.game as Record<string, unknown>;
    const replayPlayers = replayGame.players as Array<Record<string, unknown>>;
    const replayCards = replayPlayers.flatMap(
      (player) => player.hand as Array<Record<string, unknown>>,
    );

    expect(replayCards).toHaveLength(54);
    expect(replayCards.every((card) => card.visibility === "face")).toBe(true);
    expect(physicalIds.every((id) => !JSON.stringify(frames).includes(id))).toBe(true);

    expect(finishedPlayerView.authoritativeReplay).toHaveLength(1);
  });

  test("keeps legacy snapshots valid and bounds both count and serialized capacity", () => {
    let room = playingRoom();
    expect(projectRoomForViewer(room, "watcher").authoritativeReplay).toBeUndefined();

    for (let index = 0; index < MAX_AUTHORITY_REPLAY_FRAMES + 24; index += 1) {
      room = advance(room, 2_000 + index);
    }

    expect(room.authoritativeReplay!.length).toBeLessThanOrEqual(MAX_AUTHORITY_REPLAY_FRAMES);
    expect(
      new TextEncoder().encode(JSON.stringify(room.authoritativeReplay)).byteLength,
    ).toBeLessThanOrEqual(MAX_AUTHORITY_REPLAY_BYTES);
    expect(room.authoritativeReplay?.at(-1)?.revision).toBe(room.revision);
  });
});
