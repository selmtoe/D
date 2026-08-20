import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { CardView, RoomView, Suit, Rank } from "../app/model";
import {
  compactCardLabel,
  potentiallyPlayableCardIds,
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
});
