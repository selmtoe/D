import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { CardView, RoomView } from "../app/model";
import {
  cardAnchorPosition,
  cardMotionEndpointPosition,
  MOTION_SOURCE_CARD_SPACING,
} from "../game-3d/CardMotionLayer";
import {
  CARD_BODY_THICKNESS,
  cardMotionsForDisplay,
  collectCardRackPlacement,
  deriveCardMotions,
  DISCARD_LAYER_SPACING,
  discardStackPlacement,
  FIELD_CARD_SPACING,
  FIELD_CARD_SCALE,
  fieldCardPlacement,
  sortCardsForCollectRack,
} from "../game-3d/cardMotion";

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
        expect.objectContaining({
          kind: "play",
          from: { kind: "hand" },
          to: expect.objectContaining({ kind: "field" }),
        }),
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
      expect.objectContaining({
        kind: "play",
        card: newPlay,
        to: expect.objectContaining({ kind: "field" }),
      }),
    );
    expect(motions.some((motion) => motion.card.id === oldPlay.id)).toBe(false);
    const targets = motions
      .filter((motion) => motion.kind === "play" && motion.to.kind === "field")
      .map((motion) => motion.to);
    expect(targets).toEqual([
      expect.objectContaining({ playIndex: 1, cardIndex: 0, layerIndex: 1 }),
    ]);
  });

  it("gives every card in consecutive pair plays a distinct horizontal field position", () => {
    const oldPair = [card("old-1"), card("old-2")];
    const nines = [card("nine-1"), card("nine-2")];
    const previous = view(2, nines, oldPair);
    previous.fieldPlays = [oldPair];
    const next = view(3, [], nines);
    next.fieldPlays = [oldPair, nines];

    const playMotions = deriveCardMotions(previous, next).filter(
      (motion) => motion.kind === "play" && motion.to.kind === "field",
    );
    expect(playMotions).toHaveLength(2);
    expect(playMotions.map((motion) => motion.to)).toEqual([
      expect.objectContaining({ playIndex: 1, cardIndex: 0, layerIndex: 2 }),
      expect.objectContaining({ playIndex: 1, cardIndex: 1, layerIndex: 3 }),
    ]);
    const positions = playMotions.map((motion) => {
      const target = motion.to;
      if (target.kind !== "field") throw new Error("expected a field target");
      return fieldCardPlacement(
        target.playIndex!,
        target.playCount!,
        target.cardIndex!,
        target.cardCount!,
        target.layerIndex!,
      ).position;
    });
    expect(positions[1]![0] - positions[0]![0]).toBeCloseTo(FIELD_CARD_SPACING);
    expect(positions[1]![1]).toBeCloseTo(positions[0]![1]);

    const sourcePositions = playMotions.map((motion) =>
      cardMotionEndpointPosition(motion, "from", previous, false, previous.viewerId),
    );
    expect(sourcePositions[1]![0] - sourcePositions[0]![0]).toBeCloseTo(MOTION_SOURCE_CARD_SPACING);
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

  it("collects a K-recovery card from its visible rack position", () => {
    const firstDiscard = card("discard-1");
    const recovered = card("discard-2");
    const previous = view(4, [], [], [firstDiscard, recovered]);
    const next = view(5, [recovered], [], [firstDiscard]);

    expect(deriveCardMotions(previous, next)).toContainEqual(
      expect.objectContaining({
        kind: "collect",
        card: recovered,
        from: { kind: "discardRack", cardIndex: 1, cardCount: 2 },
        to: { kind: "hand" },
      }),
    );
  });

  it("uses the compacted K-recovery rack position while another card is moving to discard", () => {
    const incomingDiscard = card("incoming-discard");
    const recovered = card("recovered");
    const previous = view(5, [], [], [incomingDiscard, recovered]);
    const next = view(6, [recovered], [], [incomingDiscard]);

    expect(deriveCardMotions(previous, next, new Set([incomingDiscard.id]))).toContainEqual(
      expect.objectContaining({
        kind: "collect",
        card: recovered,
        from: { kind: "discardRack", cardIndex: 0, cardCount: 1 },
        to: { kind: "hand" },
      }),
    );
  });

  it("sorts the K-recovery rack by rank and suit while preserving equal-card order", () => {
    const cards: CardView[] = [
      { id: "hidden-1", visibility: "hidden", blind: false },
      { id: "heart-3-a", visibility: "face", suit: "heart", rank: "3", blind: false },
      { id: "spade-2", visibility: "face", suit: "spade", rank: "2", blind: false },
      { id: "spade-3", visibility: "face", suit: "spade", rank: "3", blind: false },
      { id: "joker", visibility: "face", joker: "monochrome", blind: false },
      { id: "club-10", visibility: "face", suit: "club", rank: "10", blind: false },
      { id: "heart-3-b", visibility: "face", suit: "heart", rank: "3", blind: false },
      { id: "diamond-a", visibility: "face", suit: "diamond", rank: "A", blind: false },
      { id: "hidden-2", visibility: "hidden", blind: true },
    ];

    expect(sortCardsForCollectRack(cards).map((entry) => entry.id)).toEqual([
      "spade-3",
      "heart-3-a",
      "heart-3-b",
      "club-10",
      "diamond-a",
      "spade-2",
      "joker",
      "hidden-1",
      "hidden-2",
    ]);
  });

  it("uses the same sorted K-rack index as the visible collect layout", () => {
    const three = { ...card("three"), rank: "3" as const };
    const ace = { ...card("ace"), rank: "A" as const };
    const ten = { ...card("ten"), rank: "10" as const };
    const previous = view(4, [], [], [ace, ten, three]);
    const next = view(5, [ten], [], [ace, three]);
    const sorted = sortCardsForCollectRack(previous.discard);

    expect(deriveCardMotions(previous, next)).toContainEqual(
      expect.objectContaining({
        kind: "collect",
        card: ten,
        from: {
          kind: "discardRack",
          cardIndex: sorted.findIndex((entry) => entry.id === ten.id),
          cardCount: sorted.length,
        },
      }),
    );
  });

  it.each([false, true])(
    "lays a multi-row K-recovery rack out from top to bottom (mobile=%s)",
    (mobile) => {
      const cardCount = mobile ? 20 : 32;
      const columns = mobile ? 7 : 14;
      const firstRow = collectCardRackPlacement(0, cardCount, mobile);
      const secondRow = collectCardRackPlacement(columns, cardCount, mobile);

      expect(firstRow.position[1]).toBeGreaterThan(secondRow.position[1]);
    },
  );

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

  it("does not animate a spectator focus change as a real card transfer", () => {
    const previous = view(9, [card("p1-card")], []);
    previous.role = "spectator";
    previous.focusedPlayerId = "p1";
    const next = view(10, [card("p2-card")], []);
    next.role = "spectator";
    next.focusedPlayerId = "p2";

    expect(deriveCardMotions(previous, next)).toEqual([]);
  });

  it("does not carry card motions across rooms, games, or dealing", () => {
    const previous = view(10, [card("old-card")], []);
    const nextRoom = view(11, [card("new-card")], []);
    nextRoom.roomId = "OTHER";
    expect(deriveCardMotions(previous, nextRoom)).toEqual([]);

    const nextGame = view(11, [card("new-card")], []);
    nextGame.gameId = "game-2";
    expect(deriveCardMotions(previous, nextGame)).toEqual([]);

    const dealingRoom = view(11, [], []);
    dealingRoom.phase = "dealing";
    expect(deriveCardMotions(previous, dealingRoom)).toEqual([]);
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

  it("keeps a direct 10-discard card visible while its motion batch is queued", () => {
    const discarded = { ...card("ten-discard"), rank: "6" as const };
    const previous = view(20, [discarded], []);
    const next = view(21, [], [], [discarded]);
    next.log = [{ id: "effect-21", atMs: 21, kind: "effect", text: "10捨て" }];
    const discardMotion = deriveCardMotions(previous, next).find(
      (motion) => motion.kind === "discard" && motion.card.id === discarded.id,
    );

    expect(discardMotion).toMatchObject({
      from: { kind: "hand" },
      to: { kind: "discard", cardIndex: 0, cardCount: 1 },
      holdMs: 220,
      showWhileQueued: true,
    });
    const blockingMotion = {
      ...discardMotion!,
      id: "blocking",
      batchId: "blocking-batch",
      card: card("blocking-card"),
      kind: "play" as const,
      showWhileQueued: false,
    };
    expect(cardMotionsForDisplay([blockingMotion, discardMotion!]).queued).toEqual([discardMotion]);
  });
});

describe("physical card stack placement", () => {
  it("rotates the focused spectator hand anchor to the matching canonical seat", () => {
    const room = view(1, [], []);
    room.role = "spectator";
    room.viewerId = "watcher";

    expect(cardAnchorPosition({ kind: "hand" }, room, false, "other")).toEqual([
      expect.closeTo(0),
      1.15,
      expect.closeTo(-4.15),
    ]);
  });

  it("lays cards from one play side by side on the same physical layer", () => {
    const lower = fieldCardPlacement(0, 2, 0, 2, 0);
    const upper = fieldCardPlacement(0, 2, 1, 2, 1);

    expect(upper.position[0] - lower.position[0]).toBeCloseTo(FIELD_CARD_SPACING);
    expect(FIELD_CARD_SPACING).toBeGreaterThan(1.22 * FIELD_CARD_SCALE);
    expect(upper.position[1]).toBeCloseTo(lower.position[1]);
    expect(upper.rotation).toEqual(lower.rotation);
  });

  it("raises only the next play above the previous horizontal row", () => {
    const firstRow = [fieldCardPlacement(0, 2, 0, 2, 0), fieldCardPlacement(0, 2, 1, 2, 1)];
    const secondRow = [fieldCardPlacement(1, 2, 0, 2, 2), fieldCardPlacement(1, 2, 1, 2, 3)];

    expect(firstRow[0]!.position[1]).toBeCloseTo(firstRow[1]!.position[1]);
    expect(secondRow[0]!.position[1]).toBeCloseTo(secondRow[1]!.position[1]);
    expect(secondRow[0]!.position[1] - firstRow[0]!.position[1]).toBeGreaterThan(
      CARD_BODY_THICKNESS * FIELD_CARD_SCALE,
    );
    expect(secondRow[1]!.position[0] - secondRow[0]!.position[0]).toBeCloseTo(FIELD_CARD_SPACING);
  });

  it("separates discard layers enough for both static and moving cards", () => {
    const lower = discardStackPlacement(0);
    const upper = discardStackPlacement(1);

    expect(DISCARD_LAYER_SPACING).toBeGreaterThan(CARD_BODY_THICKNESS * 0.74);
    expect(upper.position[1] - lower.position[1]).toBeCloseTo(DISCARD_LAYER_SPACING);
    expect(Math.abs(lower.position[0] - 2.9)).toBeLessThanOrEqual(0.12);
    expect(Math.abs(upper.position[2] + 1.45)).toBeLessThanOrEqual(0.09);
  });
});
