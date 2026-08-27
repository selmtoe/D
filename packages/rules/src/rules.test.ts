import { describe, expect, it } from "vitest";
import {
  applyGameCommand,
  assertStateInvariants,
  buildEffectQueue,
  checkStateInvariants,
  createDeck,
  createInitialGameState,
  findLegalJokerMimics,
  isForbiddenFinish,
  isStrictlyStronger,
  parsePlay,
  projectGame,
  recomputeBinding,
  strengthIsReversed,
  validatePlayForState,
  type Card,
  type GameState,
  type HandCard,
  type JokerMimic,
  type PlayedGroup,
} from "./index.js";

const card = (id: string): Card => {
  const found = createDeck().find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`unknown fixture card ${id}`);
  return found;
};

function rig(
  playerIds = ["p1", "p2", "p3"],
  hands: Record<string, Array<string | [string, boolean]>> = {},
): GameState {
  const state = createInitialGameState(playerIds, { rng: () => 0.42, gameId: "test" });
  state.players.sort((a, b) => playerIds.indexOf(a.id) - playerIds.indexOf(b.id));
  const used = new Set<string>();
  for (const player of state.players) {
    player.hand = (hands[player.id] ?? []).map((value): HandCard => {
      const [id, blind] = typeof value === "string" ? [value, false] : value;
      used.add(id);
      return { card: card(id), blind };
    });
  }
  state.deck = createDeck().filter((candidate) => !used.has(candidate.id));
  state.players.forEach((player, seat) => (player.seat = seat));
  state.turnPlayerId = "p1";
  state.firstPlay = false;
  return state;
}

function played(
  id: string,
  playerId: string,
  ids: string[],
  mimics: JokerMimic[] = [],
): PlayedGroup {
  const parsed = parsePlay(ids.map(card), mimics);
  return { id, playerId, ...parsed };
}

function play(
  state: GameState,
  playerId: string,
  cardIds: string[],
  extra: Partial<{ jokerMimics: JokerMimic[]; blindConfirmed: boolean }> = {},
) {
  return applyGameCommand(state, {
    type: "play",
    actionId: `a-${state.version + 1}`,
    expectedVersion: state.version,
    playerId,
    cardIds,
    ...extra,
  });
}

describe("deck, deal, and blind assignment", () => {
  it("creates 54 unique cards including two distinct Jokers", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(54);
    expect(new Set(deck.map((entry) => entry.id)).size).toBe(54);
    expect(deck.filter((entry) => entry.rank === "JOKER").map((entry) => entry.id)).toEqual([
      "joker-1",
      "joker-2",
    ]);
  });

  it("deals every card round-robin and starts with the physical diamond three owner", () => {
    const state = createInitialGameState(["a", "b", "c", "d", "e"], { rng: () => 0.31 });
    expect(state.players.map((player) => player.hand.length).sort((a, b) => b - a)).toEqual([
      11, 11, 11, 11, 10,
    ]);
    expect(
      state.players
        .find((player) => player.id === state.turnPlayerId)
        ?.hand.some((entry) => entry.card.suit === "diamond" && entry.card.rank === "3"),
    ).toBe(true);
    assertStateInvariants(state);
  });

  it("marks the requested count, keeps blinds at the end, and always exposes diamond three", () => {
    const state = createInitialGameState(["a", "b", "c"], {
      mode: "blind",
      blindCount: 10,
      rng: () => 0,
    });
    for (const player of state.players) {
      expect(player.hand.filter((entry) => entry.blind)).toHaveLength(10);
      const firstBlind = player.hand.findIndex((entry) => entry.blind);
      expect(player.hand.slice(firstBlind).every((entry) => entry.blind)).toBe(true);
    }
    const owner = state.players.find((player) =>
      player.hand.some((entry) => entry.card.suit === "diamond" && entry.card.rank === "3"),
    )!;
    expect(
      owner.hand.find((entry) => entry.card.suit === "diamond" && entry.card.rank === "3")?.blind,
    ).toBe(false);
    expect(owner.hand.find((entry) => entry.blind)?.card.id).not.toMatch(
      /spade|heart|diamond|club|joker/i,
    );
  });
});

describe("play parsing and comparison", () => {
  it("parses groups, raw Joker groups, and Joker-completed straights", () => {
    expect(parsePlay([card("spade-5"), card("heart-5")]).kind).toBe("group");
    expect(parsePlay([card("joker-1"), card("joker-2")]).kind).toBe("group");
    const straight = parsePlay(
      [card("club-6"), card("joker-1"), card("club-8")],
      [{ cardId: "joker-1", suit: "club", rank: "7" }],
    );
    expect(straight.kind).toBe("straight");
    expect(straight.cards[1]?.mimic).toEqual({ cardId: "joker-1", suit: "club", rank: "7" });
  });

  it("rejects wraparound, duplicate ranks, undeclared mixed Jokers, and mimicked Joker-only groups", () => {
    expect(() => parsePlay([card("spade-A"), card("spade-2"), card("spade-3")])).toThrow();
    expect(() => parsePlay([card("spade-3"), card("spade-4"), card("joker-1")])).toThrow();
    expect(() =>
      parsePlay([card("joker-1")], [{ cardId: "joker-1", suit: "spade", rank: "9" }]),
    ).toThrow();
  });

  it("uses revolution XOR J-back and keeps raw Joker strongest", () => {
    const five = parsePlay([card("spade-5")]);
    const king = played("pile", "p2", ["heart-K"]);
    expect(isStrictlyStronger(five, king, false)).toBe(false);
    expect(isStrictlyStronger(five, king, true)).toBe(true);
    expect(strengthIsReversed(false, false)).toBe(false);
    expect(strengthIsReversed(true, false)).toBe(true);
    expect(strengthIsReversed(false, true)).toBe(true);
    expect(strengthIsReversed(true, true)).toBe(false);
    expect(isStrictlyStronger(parsePlay([card("joker-1")]), king, true)).toBe(true);
  });

  it("compares equal-length straights by their start and rejects equal starts", () => {
    const low = played("low", "p2", ["heart-4", "heart-5", "heart-6"]);
    const high = parsePlay([card("club-5"), card("club-6"), card("club-7")]);
    const equal = parsePlay([card("spade-4"), card("spade-5"), card("spade-6")]);
    expect(isStrictlyStronger(high, low, false)).toBe(true);
    expect(isStrictlyStronger(equal, low, false)).toBe(false);
    expect(isStrictlyStronger(high, low, true)).toBe(false);
  });

  it("recomputes bindings from only the previous and new effective suits", () => {
    const previous = played("old", "p2", ["spade-6", "heart-6"]);
    const next = parsePlay([card("spade-7"), card("heart-7")]);
    expect(recomputeBinding(previous, next)).toEqual(["spade", "heart"]);
    const following = parsePlay([card("spade-9"), card("diamond-9")]);
    expect(recomputeBinding({ id: "new", playerId: "p1", ...next }, following)).toEqual(["spade"]);
  });

  it("implements the physical-two/Joker forbidden finish and straight exception", () => {
    const pair = parsePlay(
      [card("spade-2"), card("joker-1")],
      [{ cardId: "joker-1", suit: "heart", rank: "2" }],
    );
    expect(isForbiddenFinish(pair, 2)).toBe(true);
    expect(
      isForbiddenFinish(
        parsePlay([card("spade-Q"), card("spade-K"), card("spade-A"), card("spade-2")]),
        4,
      ),
    ).toBe(false);
  });

  it("enumerates only legal declarations after a committed blind Joker is revealed", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-6", ["joker-1", true], "spade-8", "club-3"],
      p2: ["heart-4"],
      p3: ["diamond-5"],
    });
    expect(findLegalJokerMimics(state, "p1", ["spade-6", "joker-1", "spade-8"])).toEqual([
      [{ cardId: "joker-1", suit: "spade", rank: "7" }],
    ]);
  });
});

describe("effect planning", () => {
  it("orders straight K first, then J-back, revolution, choices, and 8 last", () => {
    const state = rig();
    const jqk = parsePlay([card("heart-10"), card("heart-J"), card("heart-Q"), card("heart-K")]);
    expect(buildEffectQueue(state, jqk, "p1", "x", false).map((effect) => effect.type)).toEqual([
      "recover",
      "toggle-jack-back",
      "toggle-revolution",
      "discard",
      "bomb",
    ]);
    const sevenToTen = parsePlay([card("club-7"), card("club-8"), card("club-9"), card("club-10")]);
    const effects = buildEffectQueue(state, sevenToTen, "p1", "y", false).map(
      (effect) => effect.type,
    );
    expect(effects.at(-1)).toBe("flush");
    expect(effects).toContain("give");
    expect(effects).toContain("discard");
    expect(effects).not.toContain("ambulance");
  });
});

describe("state transitions and rank effects", () => {
  it("requires the physical diamond three on only the first play", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["diamond-3", "heart-3", "club-4"],
      p2: ["spade-5"],
      p3: ["spade-6"],
    });
    state.firstPlay = true;
    expect(() => validatePlayForState(state, "p1", ["heart-3"])).toThrow(/diamond three/);
    expect(validatePlayForState(state, "p1", ["diamond-3", "heart-3"]).kind).toBe("group");
  });

  it("recovers a legacy blind diamond three by playing it safely on opening timeout", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: [["diamond-3", true], "club-4"],
      p2: ["spade-5"],
      p3: ["spade-6"],
    });
    state.mode = "blind";
    state.blindCount = 1;
    state.firstPlay = true;

    const result = applyGameCommand(state, {
      type: "timeout",
      actionId: "blind-opening-timeout",
      expectedVersion: state.version,
      playerId: "p1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.find((player) => player.id === "p1")?.status).toBe("active");
    expect(result.state.pile?.cards[0]?.card).toMatchObject({ suit: "diamond", rank: "3" });
  });

  it("four fours revolutionize but do not reverse", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-4", "heart-4", "diamond-4", "club-4", "spade-9"],
      p2: ["heart-6"],
      p3: ["heart-7"],
    });
    const result = play(state, "p1", ["spade-4", "heart-4", "diamond-4", "club-4"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.revolution).toBe(true);
    expect(result.state.direction).toBe(1);
  });

  it("an odd number of fours reverses while an even number does not", () => {
    const odd = rig(["p1", "p2", "p3"], {
      p1: ["spade-4", "heart-9"],
      p2: ["heart-5"],
      p3: ["club-6"],
    });
    const oddResult = play(odd, "p1", ["spade-4"]);
    expect(oddResult.ok && oddResult.state.direction).toBe(-1);
    const even = rig(["p1", "p2", "p3"], {
      p1: ["spade-4", "heart-4", "heart-9"],
      p2: ["heart-5"],
      p3: ["club-6"],
    });
    const evenResult = play(even, "p1", ["spade-4", "heart-4"]);
    expect(evenResult.ok && evenResult.state.direction).toBe(1);
  });

  it("a pair of fives skips three and flushes after a complete four-player cycle", () => {
    const state = rig(["p1", "p2", "p3", "p4"], {
      p1: ["spade-5", "heart-5", "club-9"],
      p2: ["spade-6"],
      p3: ["spade-7"],
      p4: ["spade-8"],
    });
    const result = play(state, "p1", ["spade-5", "heart-5"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pile).toBeNull();
    expect(result.state.turnPlayerId).toBe("p1");
    expect(result.events).toContainEqual({ type: "trick-flushed", reason: "skip-cycle" });
  });

  it.each([
    { count: 1, playerCount: 4, direction: 1 as const, expectedTurn: "p3", flush: false },
    { count: 1, playerCount: 4, direction: -1 as const, expectedTurn: "p3", flush: false },
    { count: 3, playerCount: 6, direction: 1 as const, expectedTurn: "p1", flush: true },
    { count: 4, playerCount: 6, direction: 1 as const, expectedTurn: "p3", flush: false },
  ])(
    "applies 2n-1 skip for n=$count with direction $direction",
    ({ count, playerCount, direction, expectedTurn, flush }) => {
      const ids = Array.from({ length: playerCount }, (_, index) => `p${index + 1}`);
      const fives = ["spade-5", "heart-5", "diamond-5", "club-5"].slice(0, count);
      const hands = Object.fromEntries(
        ids.map((id, index) => [id, index === 0 ? [...fives, "club-K"] : [`spade-${index + 6}`]]),
      );
      // Avoid non-existent fixture ranks once the generated value reaches 11.
      for (const [index, id] of ids.entries()) {
        if (index > 0)
          hands[id] = [["spade-6", "heart-7", "diamond-8", "club-9", "spade-10"][index - 1]!];
      }
      const state = rig(ids, hands);
      state.direction = direction;
      const result = play(state, "p1", fives);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.turnPlayerId).toBe(expectedTurn);
      expect(result.state.pile === null).toBe(flush);
    },
  );

  it.each([
    [["spade-6", "heart-6"], "rokurokubi"],
    [["spade-9", "heart-9"], "ambulance"],
    [["joker-1", "joker-2"], "joker-pair"],
  ] as const)("flushes %j immediately for %s", (ids, reason) => {
    const state = rig(["p1", "p2", "p3"], {
      p1: [...ids, "club-K"],
      p2: ["spade-3"],
      p3: ["heart-4"],
    });
    const result = play(state, "p1", [...ids]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events).toContainEqual({ type: "trick-flushed", reason });
  });

  it("allows spade-three over a raw Joker regardless of reversed strength and binding", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-3", "club-9"],
      p2: ["heart-4"],
      p3: ["heart-5"],
    });
    state.pile = played("old", "p2", ["joker-1"]);
    state.deck = state.deck.filter((entry) => entry.id !== "joker-1");
    state.binding = ["heart"];
    state.revolution = true;
    const result = play(state, "p1", ["spade-3"]);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.events).toContainEqual({ type: "trick-flushed", reason: "spade-three" });
  });

  it("keeps passed players eligible after another player resets the pass run", () => {
    let state = rig(["p1", "p2", "p3"], {
      p1: ["spade-3", "heart-8"],
      p2: ["heart-5", "heart-7"],
      p3: ["club-6", "club-9"],
    });
    const first = play(state, "p1", ["spade-3"]);
    if (!first.ok) throw new Error(first.error.message);
    state = first.state;
    const pass = applyGameCommand(state, {
      type: "pass",
      actionId: "pass",
      expectedVersion: state.version,
      playerId: "p2",
    });
    if (!pass.ok) throw new Error(pass.error.message);
    state = pass.state;
    const third = play(state, "p3", ["club-6"]);
    if (!third.ok) throw new Error(third.error.message);
    state = third.state;
    const p1Pass = applyGameCommand(state, {
      type: "pass",
      actionId: "pass2",
      expectedVersion: state.version,
      playerId: "p1",
    });
    expect(p1Pass.ok && p1Pass.state.turnPlayerId).toBe("p2");
    if (!p1Pass.ok) return;
    expect(play(p1Pass.state, "p2", ["heart-7"]).ok).toBe(true);
  });

  it("forces 7 transfer selection and removes blind status after transfer", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-7", ["heart-A", true], "club-9"],
      p2: ["heart-5"],
      p3: ["club-6"],
    });
    const submitted = play(state, "p1", ["spade-7"]);
    if (!submitted.ok) throw new Error(submitted.error.message);
    expect(submitted.state.pendingEffect?.type).toBe("give");
    const effect = submitted.state.pendingEffect!;
    const resolved = applyGameCommand(submitted.state, {
      type: "resolve-effect",
      actionId: "give",
      expectedVersion: submitted.state.version,
      playerId: "p1",
      effectId: effect.id,
      selection: { type: "give", transfers: [{ playerId: "p2", cardIds: ["heart-A"] }] },
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok)
      expect(
        resolved.state.players
          .find((player) => player.id === "p2")
          ?.hand.find((entry) => entry.card.id === "heart-A")?.blind,
      ).toBe(false);
  });

  it("A steals the required card, clears blind status, and finishes an emptied target", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-A", "club-3"],
      p2: [["heart-5", true]],
      p3: ["diamond-6", "club-7"],
    });
    const submitted = play(state, "p1", ["spade-A"]);
    if (!submitted.ok) throw new Error(submitted.error.message);
    const effect = submitted.state.pendingEffect!;
    const resolved = applyGameCommand(submitted.state, {
      type: "resolve-effect",
      actionId: "steal",
      expectedVersion: submitted.state.version,
      playerId: "p1",
      effectId: effect.id,
      selection: { type: "steal", transfers: [{ playerId: "p2", cardIds: ["heart-5"] }] },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.players.find((player) => player.id === "p2")?.rank).toBe(1);
    expect(
      resolved.state.players
        .find((player) => player.id === "p1")
        ?.hand.find((entry) => entry.card.id === "heart-5")?.blind,
    ).toBe(false);
  });

  it("10 discards the forced maximum and permits effect-based hand exhaustion", () => {
    const state = rig(["p1", "p2", "p3", "p4"], {
      p1: ["spade-10", ["heart-3", true]],
      p2: ["heart-5", "club-5"],
      p3: ["diamond-6"],
      p4: ["club-7"],
    });
    const submitted = play(state, "p1", ["spade-10"]);
    if (!submitted.ok) throw new Error(submitted.error.message);
    const effect = submitted.state.pendingEffect!;
    const resolved = applyGameCommand(submitted.state, {
      type: "resolve-effect",
      actionId: "ten",
      expectedVersion: submitted.state.version,
      playerId: "p1",
      effectId: effect.id,
      selection: { type: "discard", cardIds: ["heart-3"] },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.discard.some((entry) => entry.id === "heart-3")).toBe(true);
    expect(resolved.state.players.find((player) => player.id === "p1")?.rank).toBe(1);
  });

  it("K recovers every available discard when fewer than n exist", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-K", "heart-K", "club-3"],
      p2: ["spade-4"],
      p3: ["club-5"],
    });
    state.discard = [card("diamond-A")];
    state.deck = state.deck.filter((entry) => entry.id !== "diamond-A");
    const submitted = play(state, "p1", ["spade-K", "heart-K"]);
    if (!submitted.ok) throw new Error(submitted.error.message);
    const effect = submitted.state.pendingEffect!;
    const wrong = applyGameCommand(submitted.state, {
      type: "resolve-effect",
      actionId: "wrong-k",
      expectedVersion: submitted.state.version,
      playerId: "p1",
      effectId: effect.id,
      selection: { type: "recover", cardIds: [] },
    });
    expect(wrong.ok).toBe(false);
    const recovered = applyGameCommand(submitted.state, {
      type: "resolve-effect",
      actionId: "right-k",
      expectedVersion: submitted.state.version,
      playerId: "p1",
      effectId: effect.id,
      selection: { type: "recover", cardIds: ["diamond-A"] },
    });
    expect(recovered.ok).toBe(true);
    if (recovered.ok)
      expect(
        recovered.state.players
          .find((player) => player.id === "p1")
          ?.hand.some((entry) => entry.card.id === "diamond-A"),
      ).toBe(true);
  });

  it("K recovers only the discard stack, never cards still lying on the table", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-K", "club-3"],
      p2: ["spade-4"],
      p3: ["club-5"],
    });
    state.trickHistory = [played("older", "p3", ["heart-J"])];
    state.pile = played("old", "p2", ["heart-Q"]);
    state.discard = [card("diamond-A")];
    state.deck = state.deck.filter(
      (entry) => !["heart-J", "heart-Q", "diamond-A"].includes(entry.id),
    );

    const submitted = play(state, "p1", ["spade-K"]);
    if (!submitted.ok) throw new Error(submitted.error.message);
    const effect = submitted.state.pendingEffect!;
    const tableRecovery = applyGameCommand(submitted.state, {
      type: "resolve-effect",
      actionId: "table-card-k",
      expectedVersion: submitted.state.version,
      playerId: "p1",
      effectId: effect.id,
      selection: { type: "recover", cardIds: ["heart-Q"] },
    });
    expect(tableRecovery.ok).toBe(false);

    const discardRecovery = applyGameCommand(submitted.state, {
      type: "resolve-effect",
      actionId: "discard-card-k",
      expectedVersion: submitted.state.version,
      playerId: "p1",
      effectId: effect.id,
      selection: { type: "recover", cardIds: ["diamond-A"] },
    });
    expect(discardRecovery.ok).toBe(true);
    if (!discardRecovery.ok) return;
    expect(
      discardRecovery.state.trickHistory.flatMap((play) =>
        play.cards.map((entry) => entry.card.id),
      ),
    ).toEqual(["heart-J", "heart-Q"]);
  });

  it("runs K recovery before other straight state changes", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["heart-10", "heart-J", "heart-Q", "heart-K", "club-3"],
      p2: ["spade-4"],
      p3: ["club-5"],
    });
    state.discard = [card("diamond-A")];
    state.deck = state.deck.filter((entry) => entry.id !== "diamond-A");
    const submitted = play(state, "p1", ["heart-10", "heart-J", "heart-Q", "heart-K"]);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.state.pendingEffect?.type).toBe("recover");
    expect(submitted.state.jackBack).toBe(false);
    expect(submitted.state.revolution).toBe(false);
  });

  it("resolves all 7-8-9-10 choices before the final eight cut", () => {
    let state = rig(["p1", "p2", "p3"], {
      p1: ["club-7", "club-8", "club-9", "club-10", "heart-3", "heart-4", "heart-5"],
      p2: ["spade-6"],
      p3: ["diamond-6"],
    });
    const submitted = play(state, "p1", ["club-7", "club-8", "club-9", "club-10"]);
    if (!submitted.ok) throw new Error(submitted.error.message);
    state = submitted.state;
    expect(state.pendingEffect?.type).toBe("discard");
    let resolved = applyGameCommand(state, {
      type: "resolve-effect",
      actionId: "discard",
      expectedVersion: state.version,
      playerId: "p1",
      effectId: state.pendingEffect!.id,
      selection: { type: "discard", cardIds: ["heart-3"] },
    });
    if (!resolved.ok) throw new Error(resolved.error.message);
    state = resolved.state;
    expect(state.pendingEffect?.type).toBe("give");
    resolved = applyGameCommand(state, {
      type: "resolve-effect",
      actionId: "give2",
      expectedVersion: state.version,
      playerId: "p1",
      effectId: state.pendingEffect!.id,
      selection: { type: "give", transfers: [{ playerId: "p2", cardIds: ["heart-4"] }] },
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.state.pile).toBeNull();
      expect(resolved.events).toContainEqual({ type: "trick-flushed", reason: "eight-cut" });
      expect(resolved.state.revolution).toBe(true);
    }
  });

  it("assigns the same rank to opponents emptied by one Q bomb and consumes both slots", () => {
    const state = rig(["p1", "p2", "p3", "p4"], {
      p1: ["spade-Q", "club-3"],
      p2: ["heart-5"],
      p3: ["club-5"],
      p4: ["diamond-6"],
    });
    state.nextFinishRank = 2;
    const submitted = play(state, "p1", ["spade-Q"]);
    if (!submitted.ok) throw new Error(submitted.error.message);
    const effect = submitted.state.pendingEffect!;
    const resolved = applyGameCommand(submitted.state, {
      type: "resolve-effect",
      actionId: "bomb",
      expectedVersion: submitted.state.version,
      playerId: "p1",
      effectId: effect.id,
      selection: { type: "bomb", ranks: ["5"] },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.players.find((player) => player.id === "p2")?.rank).toBe(2);
    expect(resolved.state.players.find((player) => player.id === "p3")?.rank).toBe(2);
    expect(resolved.state.nextFinishRank).toBe(4);
  });

  it("gives the Q player and opponents one simultaneous rank when the bomb empties them together", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-Q", "heart-5"],
      p2: ["club-5"],
      p3: ["diamond-6"],
    });
    const submitted = play(state, "p1", ["spade-Q"]);
    if (!submitted.ok) throw new Error(submitted.error.message);
    const resolved = applyGameCommand(submitted.state, {
      type: "resolve-effect",
      actionId: "self-bomb",
      expectedVersion: submitted.state.version,
      playerId: "p1",
      effectId: submitted.state.pendingEffect!.id,
      selection: { type: "bomb", ranks: ["5"] },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.players.find((player) => player.id === "p1")?.rank).toBe(1);
    expect(resolved.state.players.find((player) => player.id === "p2")?.rank).toBe(1);
    expect(resolved.state.players.find((player) => player.id === "p3")?.rank).toBe(3);
  });

  it("clears J-back and binding after 8-cut but preserves resulting revolution and direction", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-8", "heart-8", "diamond-8", "club-8", "club-K"],
      p2: ["spade-4"],
      p3: ["heart-5"],
    });
    state.pile = played("nines", "p2", ["spade-9", "heart-9", "diamond-9", "club-9"]);
    state.deck = state.deck.filter(
      (entry) => !["spade-9", "heart-9", "diamond-9", "club-9"].includes(entry.id),
    );
    state.binding = ["spade", "heart", "diamond", "club"];
    state.jackBack = true;
    state.direction = -1;
    const result = play(state, "p1", ["spade-8", "heart-8", "diamond-8", "club-8"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pile).toBeNull();
    expect(result.state.binding).toEqual([]);
    expect(result.state.jackBack).toBe(false);
    expect(result.state.revolution).toBe(true);
    expect(result.state.direction).toBe(-1);
  });

  it("flushes after every remaining active player passes when the last player already finished", () => {
    let state = rig(["p1", "p2", "p3", "p4"], {
      p1: ["spade-3"],
      p2: ["heart-4"],
      p3: ["club-5"],
      p4: ["diamond-6"],
    });
    const submitted = play(state, "p1", ["spade-3"]);
    if (!submitted.ok) throw new Error(submitted.error.message);
    state = submitted.state;
    for (const playerId of ["p2", "p3", "p4"]) {
      const passed = applyGameCommand(state, {
        type: "pass",
        actionId: `pass-${playerId}`,
        expectedVersion: state.version,
        playerId,
      });
      if (!passed.ok) throw new Error(passed.error.message);
      state = passed.state;
    }
    expect(state.pile).toBeNull();
    expect(state.turnPlayerId).toBe("p2");
  });

  it("disqualifies a confirmed illegal blind play, reveals its hand, and reserves bottom rank", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: [
        ["spade-4", true],
        ["heart-7", true],
      ],
      p2: ["club-5"],
      p3: ["diamond-6"],
    });
    state.mode = "blind";
    state.blindCount = 2;
    const result = play(state, "p1", ["spade-4", "heart-7"], { blindConfirmed: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const disqualified = result.state.players.find((player) => player.id === "p1")!;
    expect(disqualified.status).toBe("disqualified");
    expect(disqualified.rank).toBe(3);
    expect(disqualified.hand).toHaveLength(0);
    expect(result.state.discard.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["spade-4", "heart-7"]),
    );
  });

  it("reserves successive bottom ranks for multiple invalid blind submissions", () => {
    let state = rig(["p1", "p2", "p3", "p4"], {
      p1: [
        ["spade-4", true],
        ["heart-7", true],
      ],
      p2: [
        ["club-5", true],
        ["diamond-8", true],
      ],
      p3: ["diamond-6"],
      p4: ["club-9"],
    });
    state.mode = "blind";
    state.blindCount = 2;
    const first = play(state, "p1", ["spade-4", "heart-7"], { blindConfirmed: true });
    if (!first.ok) throw new Error(first.error.message);
    state = first.state;
    const second = play(state, "p2", ["club-5", "diamond-8"], { blindConfirmed: true });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.players.find((player) => player.id === "p1")?.rank).toBe(4);
    expect(second.state.players.find((player) => player.id === "p2")?.rank).toBe(3);
  });

  it("rejects normal forbidden finish but allows a two-containing straight", () => {
    const forbidden = rig(["p1", "p2", "p3"], {
      p1: ["spade-2"],
      p2: ["club-4", "heart-5"],
      p3: ["diamond-6", "heart-7"],
    });
    expect(play(forbidden, "p1", ["spade-2"]).ok).toBe(false);
    const allowed = rig(["p1", "p2", "p3"], {
      p1: ["spade-Q", "spade-K", "spade-A", "spade-2"],
      p2: ["club-4", "heart-5"],
      p3: ["diamond-6", "heart-7"],
    });
    expect(play(allowed, "p1", ["spade-Q", "spade-K", "spade-A", "spade-2"]).ok).toBe(true);
  });

  it("makes commands idempotent and rejects a new stale command", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-4", "heart-9"],
      p2: ["heart-5"],
      p3: ["club-6"],
    });
    const command = {
      type: "play",
      actionId: "same",
      expectedVersion: 0,
      playerId: "p1",
      cardIds: ["spade-4"],
    } as const;
    const first = applyGameCommand(state, command);
    if (!first.ok) throw new Error(first.error.message);
    const retry = applyGameCommand(first.state, command);
    expect(retry.ok).toBe(true);
    expect(retry.state.version).toBe(1);
    expect(applyGameCommand(first.state, { ...command, actionId: "different" }).ok).toBe(false);
  });

  it("reserves disqualification ranks from the bottom without colliding with normal ranks", () => {
    let state = rig(["p1", "p2", "p3", "p4"], {
      p1: ["spade-3"],
      p2: ["heart-4"],
      p3: ["club-5"],
      p4: ["diamond-6"],
    });
    const dq2 = applyGameCommand(state, {
      type: "disqualify",
      actionId: "dq2",
      expectedVersion: 0,
      playerId: "p2",
      reason: "disconnect",
    });
    if (!dq2.ok) throw new Error(dq2.error.message);
    state = dq2.state;
    const dq3 = applyGameCommand(state, {
      type: "disqualify",
      actionId: "dq3",
      expectedVersion: 1,
      playerId: "p3",
      reason: "exit",
    });
    if (!dq3.ok) throw new Error(dq3.error.message);
    state = dq3.state;
    expect(state.players.find((player) => player.id === "p2")?.rank).toBe(4);
    expect(state.players.find((player) => player.id === "p3")?.rank).toBe(3);
    const finish = play(state, "p1", ["spade-3"]);
    expect(finish.ok).toBe(true);
    if (!finish.ok) return;
    expect(finish.state.players.find((player) => player.id === "p1")?.rank).toBe(1);
    expect(finish.state.players.find((player) => player.id === "p4")?.rank).toBe(2);
    expect(finish.state.phase).toBe("finished");
  });

  it("enforces every current bound suit while raw singleton Joker bypasses it", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-7", "club-7", "joker-1", "club-3"],
      p2: ["heart-4"],
      p3: ["diamond-5"],
    });
    state.pile = played("old", "p2", ["spade-6", "heart-6"]);
    state.deck = state.deck.filter((entry) => !["spade-6", "heart-6"].includes(entry.id));
    state.binding = ["spade", "heart"];
    expect(play(state, "p1", ["spade-7", "club-7"]).ok).toBe(false);

    state.pile = played("single", "p2", ["heart-K"]);
    state.binding = ["heart"];
    expect(play(state, "p1", ["joker-1"]).ok).toBe(true);
  });

  it("blocks pass and play commands while a forced choice remains", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-7", "club-3"],
      p2: ["heart-4"],
      p3: ["diamond-5"],
    });
    const submitted = play(state, "p1", ["spade-7"]);
    if (!submitted.ok) throw new Error(submitted.error.message);
    const blocked = applyGameCommand(submitted.state, {
      type: "pass",
      actionId: "blocked",
      expectedVersion: submitted.state.version,
      playerId: "p1",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("EFFECT_PENDING");
  });
});

describe("privacy projection and invariants", () => {
  it("shows a blind card to everyone except its owner and normal cards only to owner/spectators", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-4", ["heart-A", true]],
      p2: ["club-5"],
      p3: ["diamond-6"],
    });
    const owner = projectGame(state, { playerId: "p1" }).players.find(
      (player) => player.id === "p1",
    )!;
    expect(owner.hand.find((entry) => entry.id === "spade-4")?.face?.rank).toBe("4");
    expect(owner.hand.find((entry) => entry.id === "heart-A")?.face).toBeUndefined();
    const opponentView = projectGame(state, { playerId: "p2" }).players.find(
      (player) => player.id === "p1",
    )!;
    expect(opponentView.hand.find((entry) => entry.id === "spade-4")?.face).toBeUndefined();
    expect(opponentView.hand.find((entry) => entry.id === "heart-A")?.face?.rank).toBe("A");
    const spectator = projectGame(state, { spectator: true }).players.find(
      (player) => player.id === "p1",
    )!;
    expect(spectator.hand.every((entry) => entry.face !== undefined)).toBe(true);
  });

  it("never duplicates cards through a normal transition", () => {
    const state = rig(["p1", "p2", "p3"], {
      p1: ["spade-4", "heart-9"],
      p2: ["heart-5"],
      p3: ["club-6"],
    });
    expect(checkStateInvariants(state)).toEqual({ valid: true, errors: [] });
    const result = play(state, "p1", ["spade-4"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(checkStateInvariants(result.state)).toEqual({ valid: true, errors: [] });
  });
});
