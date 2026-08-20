import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { CardView, RoomView } from "../app/model";
import { deriveCardMotions } from "../game-3d/cardMotion";

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
});
