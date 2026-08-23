import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { CardView, RoomView, Suit, Rank } from "../app/model";
import {
  analyzeCardSelection,
  compactCardLabel,
  potentiallyPlayableCardIds,
  selectableCardIds,
  sortHandWeakToStrong,
} from "../gameplay/cardPresentation";

const face = (id: string, suit: Suit, rank: Rank): CardView => ({
  id,
  visibility: "face",
  suit,
  rank,
  blind: false,
});
const joker = (id = "joker"): CardView => ({
  id,
  visibility: "face",
  joker: "monochrome",
  blind: false,
});

function room(overrides: Partial<RoomView> = {}): RoomView {
  return {
    roomId: "ABCDE",
    revision: 1,
    generation: 0,
    phase: "playing",
    role: "player",
    viewerId: "me",
    hostId: "me",
    players: [
      {
        id: "me",
        name: "私",
        avatar: defaultAvatar,
        cardCount: 0,
        connection: "online",
        status: "active",
        host: true,
      },
    ],
    spectators: [],
    settings: { mode: "normal", blindCount: 0 },
    currentPlayerId: "me",
    direction: 1,
    revolution: false,
    jackBack: false,
    suitLock: [],
    field: [],
    discard: [],
    hand: [],
    pendingEffects: [],
    rankings: [],
    log: [],
    ...overrides,
  };
}

describe("card presentation", () => {
  it("uses real suit glyphs instead of Japanese initial letters", () => {
    expect(compactCardLabel(face("s4", "spade", "4"))).toBe("♠4");
    expect(compactCardLabel(face("dA", "diamond", "A"))).toBe("♦A");
  });

  it("sorts known cards weak-to-strong and keeps unknown blind cards last", () => {
    const hidden: CardView = { id: "blind", visibility: "hidden", blind: true };
    expect(
      sortHandWeakToStrong([
        face("a", "heart", "A"),
        joker(),
        hidden,
        face("three", "club", "3"),
      ]).map((card) => card.id),
    ).toEqual(["three", "a", "joker", "blind"]);
  });

  it("keeps Joker strongest while reversing ordinary rank order", () => {
    expect(
      sortHandWeakToStrong(
        [face("three", "club", "3"), face("ace", "heart", "A"), face("two", "spade", "2"), joker()],
        true,
      ).map((card) => card.id),
    ).toEqual(["two", "ace", "three", "joker"]);
  });

  it("dims only cards which cannot join any stronger same-rank response", () => {
    const view = room({
      field: [face("f1", "club", "7"), face("f2", "diamond", "7")],
      hand: [
        face("five", "spade", "5"),
        face("eight-s", "spade", "8"),
        face("eight-h", "heart", "8"),
        face("nine", "club", "9"),
        joker(),
      ],
    });
    expect([...potentiallyPlayableCardIds(view)].sort()).toEqual(
      ["eight-h", "eight-s", "joker", "nine"].sort(),
    );
  });

  it("finds cards that can participate in a stronger straight", () => {
    const view = room({
      field: [face("f3", "spade", "3"), face("f4", "spade", "4"), face("f5", "spade", "5")],
      hand: [
        face("s4", "spade", "4"),
        face("s5", "spade", "5"),
        face("s6", "spade", "6"),
        face("h6", "heart", "6"),
        joker(),
      ],
    });
    expect([...potentiallyPlayableCardIds(view)].sort()).toEqual(
      ["joker", "s4", "s5", "s6"].sort(),
    );
  });

  it("allows only the physical spade three against a raw singleton Joker", () => {
    const view = room({
      field: [joker("field-joker")],
      hand: [face("spade-three", "spade", "3"), face("heart-three", "heart", "3"), joker()],
    });
    expect([...potentiallyPlayableCardIds(view)]).toEqual(["spade-three"]);
  });

  it("never leaks a blind face through the playable highlight", () => {
    const blind: CardView = { id: "secret", visibility: "hidden", blind: true };
    const view = room({ field: [face("f", "heart", "2")], hand: [blind] });
    expect(potentiallyPlayableCardIds(view).has("secret")).toBe(true);
  });

  it("allows only cards that can complete the current selection", () => {
    const view = room({
      hand: [
        face("s5", "spade", "5"),
        face("h5", "heart", "5"),
        face("s6", "spade", "6"),
        face("s7", "spade", "7"),
        face("h9", "heart", "9"),
      ],
    });
    expect([...selectableCardIds(view, ["s5"])].sort()).toEqual(["s5", "h5", "s6", "s7"].sort());
    expect([...selectableCardIds(view, ["s5", "h5"])].sort()).toEqual(["s5", "h5"].sort());
    expect(analyzeCardSelection(view, ["s5", "s6"])).toMatchObject({
      complete: false,
      completable: true,
    });
    expect(analyzeCardSelection(view, ["s5", "s6", "s7"])).toMatchObject({
      complete: true,
      completable: true,
    });
    expect(analyzeCardSelection(view, ["s5", "h9"])).toMatchObject({
      complete: false,
      completable: false,
    });
  });

  it("stops a selected response pair from branching into another rank", () => {
    const view = room({
      field: [face("f1", "club", "7"), face("f2", "diamond", "7")],
      hand: [
        face("eight-s", "spade", "8"),
        face("eight-h", "heart", "8"),
        face("nine-c", "club", "9"),
        face("nine-d", "diamond", "9"),
        joker(),
      ],
    });
    expect([...selectableCardIds(view, ["eight-s"])].sort()).toEqual(
      ["eight-s", "eight-h", "joker"].sort(),
    );
  });

  it("offers only exact Joker declarations that produce a legal play", () => {
    const view = room({
      hand: [face("h7", "heart", "7"), joker(), face("c3", "club", "3")],
    });
    const analysis = analyzeCardSelection(view, ["h7", "joker"]);
    expect(analysis.complete).toBe(true);
    expect(analysis.jokerCandidates).toEqual(
      (["spade", "heart", "diamond", "club"] as Suit[]).map((suit) => [
        { cardId: "joker", suit, rank: "7" },
      ]),
    );
  });

  it("limits a Joker declaration to the suit needed by the current binding", () => {
    const view = room({
      field: [face("field-spade", "spade", "6"), face("field-heart", "heart", "6")],
      suitLock: ["spade", "heart"],
      hand: [face("h7", "heart", "7"), joker(), face("c3", "club", "3")],
    });
    expect(analyzeCardSelection(view, ["h7", "joker"])).toMatchObject({
      complete: true,
      jokerCandidates: [[{ cardId: "joker", suit: "spade", rank: "7" }]],
    });
  });

  it("does not treat a raw Joker pair as declared suits for binding", () => {
    const view = room({
      field: [face("field-spade", "spade", "6"), face("field-heart", "heart", "6")],
      suitLock: ["spade", "heart"],
      hand: [joker("joker-1"), joker("joker-2"), face("c8", "club", "8")],
    });
    expect([...selectableCardIds(view, [])]).toEqual([]);
    expect(analyzeCardSelection(view, ["joker-1", "joker-2"])).toEqual({
      complete: false,
      completable: false,
      jokerCandidates: [],
    });
  });

  it("rejects a two-and-Joker forbidden finish before confirmation", () => {
    const view = room({ hand: [face("s2", "spade", "2"), joker()] });
    expect(analyzeCardSelection(view, ["s2", "joker"])).toEqual({
      complete: false,
      completable: false,
      jokerCandidates: [],
    });
  });

  it("filters the opening selection to combinations that can contain the physical diamond three", () => {
    const view = room({
      firstPlay: true,
      hand: [face("d3", "diamond", "3"), face("h3", "heart", "3"), face("s4", "spade", "4")],
    });
    expect([...selectableCardIds(view, [])].sort()).toEqual(["d3", "h3"].sort());
    expect(analyzeCardSelection(view, ["h3"])).toMatchObject({
      complete: false,
      completable: true,
    });
    expect(analyzeCardSelection(view, ["d3"])).toMatchObject({ complete: true });
  });
});
