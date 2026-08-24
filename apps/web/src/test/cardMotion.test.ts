import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { CardView, RoomView } from "../app/model";
import { cardMotionsForDisplay, deriveCardMotions } from "../game-3d/cardMotion";

const card = (id: string): CardView => ({
  id,
  visibility: "face",
  suit: "spade",
  rank: "A",
  blind: false,
});
const view = (
  revision: number,
  hand: CardView[],
  field: CardView[],
  discard: CardView[] = [],
): RoomView => ({
  roomId: "ABCDE",
  revision,
  gameId: "game-1",
  generation: 1,
  phase: "playing",
  role: "player",
  viewerId: "me",
  hostId: "me",
  players: [
    {
      id: "me",
      name: "Me",
      avatar: defaultAvatar,
      cardCount: hand.length,
      cards: hand,
      connection: "online",
      status: "active",
      host: true,
    },
    {
      id: "other",
      name: "Other",
      avatar: defaultAvatar,
      cardCount: 1,
      cards: [card("other-1")],
      connection: "online",
      status: "active",
      host: false,
    },
  ],
  spectators: [],
  settings: { mode: "normal", blindCount: 0 },
  currentPlayerId: "me",
  direction: 1,
  revolution: false,
  jackBack: false,
  suitLock: [],
  field,
  discard,
  hand,
  pendingEffects: [],
  rankings: [],
  log: [],
});

describe("card motion projection diff", () => {
  it("moves a submitted card from the viewer hand to the field", () => {
    const ace = card("ace");
    const motions = deriveCardMotions(view(1, [ace], []), view(2, [], [ace]));
    expect(motions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "play", from: { kind: "hand" }, to: { kind: "field" } }),
      ]),
    );
  });

  it("keeps earlier plays on the table when a new play is stacked on top", () => {
    const oldPlay = card("old-play");
    const newPlay = card("new-play");
    const previous = view(2, [newPlay], [oldPlay]);
    previous.fieldPlays = [[oldPlay]];
    const next = view(3, [], [newPlay]);
    next.fieldPlays = [[oldPlay], [newPlay]];

    const motions = deriveCardMotions(previous, next);
    expect(motions).toContainEqual(
      expect.objectContaining({ kind: "play", card: newPlay, to: { kind: "field" } }),
    );
    expect(motions.some((motion) => motion.card.id === oldPlay.id)).toBe(false);
  });

  it("moves a cleared field to discard and a stolen card from its seat to hand", () => {
    const field = card("field");
    const previous = view(3, [], [field]);
    const stolen = card("other-1");
    const next = view(4, [stolen], [], [field]);
    next.players[1] = { ...next.players[1]!, cardCount: 0, cards: [] };
    const motions = deriveCardMotions(previous, next);
    expect(motions.some((motion) => motion.kind === "flush" && motion.card.id === "field")).toBe(
      true,
    );
    expect(motions.some((motion) => motion.kind === "acquire" && motion.from.kind === "seat")).toBe(
      true,
    );
  });

  it("does not treat revision-scoped opponent backs as newly acquired cards", () => {
    const previous = view(8, [card("mine")], []);
    previous.players[1] = {
      ...previous.players[1]!,
      cards: [{ id: "back_8_other_0", visibility: "hidden", blind: false }],
    };
    const next = view(9, [card("mine")], []);
    next.players[1] = {
      ...next.players[1]!,
      cards: [{ id: "back_9_other_0", visibility: "hidden", blind: false }],
    };
    expect(deriveCardMotions(previous, next)).toEqual([]);
  });

  it("holds an immediately-cleared play on the field before flushing it", () => {
    const eight = card("eight");
    const oldField = card("old-field");
    const previous = view(10, [eight], [oldField]);
    const next = view(11, [], [], [oldField, eight]);
    next.log = [{ id: "played-11", atMs: 11, kind: "play", text: "8を出しました" }];
    const motions = deriveCardMotions(previous, next);
    const play = motions.find((motion) => motion.card.id === "eight" && motion.kind === "play");
    const flushes = motions.filter((motion) => motion.kind === "flush");
    expect(play).toMatchObject({ holdMs: 1000, batchId: "11-immediate-play" });
    expect(flushes).toHaveLength(2);
    expect(flushes.every((motion) => motion.batchId === "11-immediate-flush")).toBe(true);
    expect(flushes.find((motion) => motion.card.id === oldField.id)).toMatchObject({
      showWhileQueued: true,
    });
    expect(flushes.find((motion) => motion.card.id === eight.id)?.showWhileQueued).toBe(false);

    const firstFrame = cardMotionsForDisplay(motions);
    expect(firstFrame.active).toEqual([play]);
    expect(firstFrame.queued.map((motion) => motion.card.id)).toEqual([oldField.id]);

    const afterPlay = cardMotionsForDisplay(
      motions.filter((motion) => motion.batchId !== "11-immediate-play"),
    );
    expect(afterPlay.active).toEqual(flushes);
    expect(afterPlay.queued).toEqual([]);
  });
});
