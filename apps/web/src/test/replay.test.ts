import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { RoomView } from "../app/model";
import {
  appendReplayFrame,
  replayElapsedMs,
  replayFrameSummary,
  replayGameKey,
} from "../app/replay";

const room = (revision: number, gameId = "game-1"): RoomView => ({
  roomId: "REPLY",
  revision,
  gameId,
  generation: 1,
  phase: "playing",
  role: "player",
  viewerId: "me",
  hostId: "me",
  players: [
    {
      id: "me",
      name: "私",
      avatar: defaultAvatar,
      cardCount: 1,
      connection: "online",
      status: "active",
      host: true,
    },
  ],
  spectators: [],
  settings: { mode: "blind", blindCount: 1 },
  currentPlayerId: "me",
  direction: 1,
  revolution: false,
  jackBack: false,
  suitLock: [],
  field: [],
  discard: [],
  hand: [{ id: "secret", visibility: "hidden", blind: true }],
  pendingEffects: [],
  rankings: [],
  log: [],
});

describe("client-view replay recording", () => {
  it("keeps projected hidden cards hidden and takes an immutable snapshot", () => {
    const projected = room(1);
    const frames = appendReplayFrame([], projected, 1_000);
    projected.hand.splice(0, 1);
    expect(frames[0]?.room.hand).toEqual([{ id: "secret", visibility: "hidden", blind: true }]);
  });

  it("deduplicates revisions and resets when a new game starts", () => {
    const first = appendReplayFrame([], room(1), 1_000);
    const duplicate = appendReplayFrame(first, room(1), 1_100);
    const second = appendReplayFrame(duplicate, room(2), 1_700);
    const stale = appendReplayFrame(second, room(1), 1_800);
    const rematch = appendReplayFrame(second, room(1, "game-2"), 2_000);
    expect(duplicate).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(stale).toHaveLength(2);
    expect(rematch).toHaveLength(1);
    expect(replayGameKey(rematch[0]!.room)).toBe("REPLY:me:1:game-2");
  });

  it("uses visible log text for the caption and computes elapsed time", () => {
    const first = appendReplayFrame([], room(1), 1_000);
    const nextRoom = {
      ...room(2),
      log: [{ id: "play", atMs: 1_500, text: "私が3を出した", kind: "play" as const }],
    };
    const frames = appendReplayFrame(first, nextRoom, 2_500);
    expect(replayFrameSummary(frames[1]!)).toBe("私が3を出した");
    expect(replayElapsedMs(frames, 1)).toBe(1_500);
  });

  it("does not retain waiting-room snapshots", () => {
    expect(appendReplayFrame([], { ...room(1), phase: "waiting" })).toEqual([]);
  });
});
