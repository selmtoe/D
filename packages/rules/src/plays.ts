import {
  RANKS,
  SUITS,
  type Card,
  type GameState,
  type JokerMimic,
  type PhysicalRank,
  type PlayedGroup,
  type Rank,
  type Suit,
} from "./types.js";

export class PlayValidationError extends Error {
  constructor(
    readonly code: "DUPLICATE_CARD" | "FORBIDDEN_FINISH" | "INVALID_PLAY" | "UNKNOWN_CARD",
    message: string,
  ) {
    super(message);
    this.name = "PlayValidationError";
  }
}

export type ParsedPlay = Omit<PlayedGroup, "id" | "playerId">;

export function rankIndex(rank: Rank): number {
  return RANKS.indexOf(rank);
}

export function parsePlay(
  cards: readonly Card[],
  jokerMimics: readonly JokerMimic[] = [],
): ParsedPlay {
  if (cards.length === 0)
    throw new PlayValidationError("INVALID_PLAY", "at least one card is required");
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new PlayValidationError("DUPLICATE_CARD", "the same card cannot be submitted twice");
  }
  const jokerIds = new Set(cards.filter((card) => card.rank === "JOKER").map((card) => card.id));
  if (new Set(jokerMimics.map((mimic) => mimic.cardId)).size !== jokerMimics.length) {
    throw new PlayValidationError("INVALID_PLAY", "a Joker has more than one declaration");
  }
  if (
    jokerMimics.some(
      (mimic) =>
        !jokerIds.has(mimic.cardId) || !SUITS.includes(mimic.suit) || !RANKS.includes(mimic.rank),
    )
  ) {
    throw new PlayValidationError(
      "INVALID_PLAY",
      "Joker declarations must refer to selected Jokers and valid faces",
    );
  }
  const onlyJokers = jokerIds.size === cards.length;
  if (onlyJokers && jokerMimics.length > 0) {
    throw new PlayValidationError("INVALID_PLAY", "a Joker-only group may not mimic another card");
  }
  if (!onlyJokers && jokerIds.size > 0 && jokerMimics.length !== jokerIds.size) {
    throw new PlayValidationError(
      "INVALID_PLAY",
      "every Joker mixed with normal cards must declare a suit and rank",
    );
  }
  const mimicById = new Map(jokerMimics.map((mimic) => [mimic.cardId, mimic]));
  const effective = cards.map((card) => {
    const mimic = mimicById.get(card.id) ?? null;
    return { card, suit: mimic?.suit ?? card.suit, rank: mimic?.rank ?? card.rank, mimic };
  });
  if (onlyJokers) return { kind: "group", cards: effective };

  const firstRank = effective[0]?.rank;
  if (firstRank !== undefined && effective.every((card) => card.rank === firstRank)) {
    return { kind: "group", cards: effective };
  }

  if (effective.length >= 3) {
    const firstSuit = effective[0]?.suit;
    const ranks = effective.map((card) => card.rank);
    if (
      firstSuit !== null &&
      firstSuit !== undefined &&
      effective.every((card) => card.suit === firstSuit && card.rank !== "JOKER") &&
      new Set(ranks).size === ranks.length
    ) {
      const indexes = (ranks as Rank[]).map(rankIndex).sort((a, b) => a - b);
      if (indexes.every((value, index) => index === 0 || value === indexes[index - 1]! + 1)) {
        return { kind: "straight", cards: effective };
      }
    }
  }
  throw new PlayValidationError(
    "INVALID_PLAY",
    "cards are neither a same-rank group nor a same-suit straight",
  );
}

export function isRawJoker(play: ParsedPlay | PlayedGroup): boolean {
  return play.cards.every((card) => card.rank === "JOKER" && card.mimic === null);
}

export function isSpadeThreeReturn(next: ParsedPlay, previous: PlayedGroup): boolean {
  return (
    previous.kind === "group" &&
    previous.cards.length === 1 &&
    isRawJoker(previous) &&
    next.kind === "group" &&
    next.cards.length === 1 &&
    next.cards[0]?.card.suit === "spade" &&
    next.cards[0]?.card.rank === "3"
  );
}

export function effectiveSuits(play: ParsedPlay | PlayedGroup): Suit[] {
  return SUITS.filter((suit) => play.cards.some((card) => card.suit === suit));
}

export function recomputeBinding(previous: PlayedGroup, next: ParsedPlay): Suit[] {
  const previousSuits = new Set(effectiveSuits(previous));
  return effectiveSuits(next).filter((suit) => previousSuits.has(suit));
}

export function strengthIsReversed(revolution: boolean, jackBack: boolean): boolean {
  return revolution !== jackBack;
}

function comparisonRank(play: ParsedPlay | PlayedGroup): number {
  if (play.kind === "group") {
    if (isRawJoker(play)) return RANKS.length;
    const rank = play.cards[0]?.rank;
    if (rank === undefined || rank === "JOKER") throw new Error("invalid effective group rank");
    return rankIndex(rank);
  }
  const indexes = play.cards.map((card) => {
    if (card.rank === "JOKER") throw new Error("a straight cannot contain a raw Joker");
    return rankIndex(card.rank);
  });
  return Math.min(...indexes);
}

export function isStrictlyStronger(
  next: ParsedPlay,
  previous: PlayedGroup,
  reversed: boolean,
): boolean {
  const nextRank = comparisonRank(next);
  const previousRank = comparisonRank(previous);
  if (nextRank === previousRank) return false;
  if (nextRank === RANKS.length) return true;
  if (previousRank === RANKS.length) return false;
  return reversed ? nextRank < previousRank : nextRank > previousRank;
}

export function includesPhysicalDiamondThree(play: ParsedPlay): boolean {
  return play.cards.some((card) => card.card.suit === "diamond" && card.card.rank === "3");
}

export function isForbiddenFinish(play: ParsedPlay, handSize: number): boolean {
  return (
    play.cards.length === handSize &&
    play.kind !== "straight" &&
    play.cards.every((card) => card.card.rank === "2" || card.card.rank === "JOKER")
  );
}

export function validatePlayForState(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
  jokerMimics: readonly JokerMimic[] = [],
): ParsedPlay {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (player === undefined) throw new PlayValidationError("UNKNOWN_CARD", "unknown player");
  const cards = cardIds.map((id) => {
    const owned = player.hand.find((entry) => entry.card.id === id);
    if (owned === undefined)
      throw new PlayValidationError("UNKNOWN_CARD", `card ${id} is not in the player's hand`);
    return owned.card;
  });
  const play = parsePlay(cards, jokerMimics);
  if (state.firstPlay && !includesPhysicalDiamondThree(play)) {
    throw new PlayValidationError(
      "INVALID_PLAY",
      "the first play must contain the physical diamond three",
    );
  }
  if (isForbiddenFinish(play, player.hand.length)) {
    throw new PlayValidationError(
      "FORBIDDEN_FINISH",
      "a non-straight made only of physical twos and Jokers may not finish",
    );
  }
  if (state.pile === null) return play;
  const spadeThree = isSpadeThreeReturn(play, state.pile);
  if (!spadeThree) {
    if (play.kind !== state.pile.kind || play.cards.length !== state.pile.cards.length) {
      throw new PlayValidationError(
        "INVALID_PLAY",
        "a response must match the pile's kind and card count",
      );
    }
    const ignoresBinding = play.cards.length === 1 && isRawJoker(play);
    const suits = new Set(effectiveSuits(play));
    if (!ignoresBinding && state.binding.some((suit) => !suits.has(suit))) {
      throw new PlayValidationError(
        "INVALID_PLAY",
        "the response does not contain every bound suit",
      );
    }
    if (
      !isStrictlyStronger(play, state.pile, strengthIsReversed(state.revolution, state.jackBack))
    ) {
      throw new PlayValidationError(
        "INVALID_PLAY",
        "the response is not strictly stronger than the pile",
      );
    }
  }
  return play;
}

/**
 * Server-side helper for the blind-Joker reveal step. It returns every final
 * declaration that makes the already committed card positions legal. The
 * caller must reveal the selected Joker before presenting these choices to its
 * owner; this function itself never projects hidden faces.
 */
export function findLegalJokerMimics(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
): JokerMimic[][] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (player === undefined) return [];
  const jokerIds = cardIds.filter(
    (id) => player.hand.find((entry) => entry.card.id === id)?.card.rank === "JOKER",
  );
  if (jokerIds.length === 0) {
    try {
      validatePlayForState(state, playerId, cardIds);
      return [[]];
    } catch {
      return [];
    }
  }
  if (jokerIds.length === cardIds.length) {
    try {
      validatePlayForState(state, playerId, cardIds);
      return [[]];
    } catch {
      return [];
    }
  }
  let candidates: JokerMimic[][] = [[]];
  for (const cardId of jokerIds) {
    candidates = candidates.flatMap((prefix) =>
      SUITS.flatMap((suit) => RANKS.map((rank) => [...prefix, { cardId, suit, rank }])),
    );
  }
  return candidates.filter((declarations) => {
    try {
      validatePlayForState(state, playerId, cardIds, declarations);
      return true;
    } catch {
      return false;
    }
  });
}

export function countRank(play: ParsedPlay | PlayedGroup, rank: PhysicalRank): number {
  return play.cards.filter((card) => card.rank === rank).length;
}

export function sortedStraightEffectRanks(play: ParsedPlay, reversedAfterToggles: boolean): Rank[] {
  const excluded = new Set<PhysicalRank>(["K", "J", "8"]);
  return play.cards
    .map((card) => card.rank)
    .filter((rank): rank is Rank => rank !== "JOKER" && !excluded.has(rank))
    .sort((a, b) => (rankIndex(a) - rankIndex(b)) * (reversedAfterToggles ? -1 : 1));
}
