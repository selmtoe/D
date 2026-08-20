import {
  RANKS,
  isRawJoker,
  parsePlay,
  rankIndex,
  strengthIsReversed,
  type Card as RuleCard,
  type ParsedPlay,
  type PlayedGroup,
  type Rank as RuleRank,
} from "@daifugo/rules";
import type { CardView, Rank, RoomView, Suit, VisibleCard } from "../app/model";

export const SUIT_SYMBOLS: Record<Suit, "♠" | "♥" | "♦" | "♣"> = {
  spade: "♠",
  heart: "♥",
  diamond: "♦",
  club: "♣",
};

const SUIT_ORDER: Record<Suit, number> = { spade: 0, club: 1, diamond: 2, heart: 3 };

function isVisible(card: CardView): card is VisibleCard {
  return card.visibility === "face";
}

export function compactCardLabel(card: CardView): string {
  if (!isVisible(card)) return "？";
  if (card.joker) return card.joker === "crimson" ? "JOKERⅡ" : "JOKERⅠ";
  return `${card.suit ? SUIT_SYMBOLS[card.suit] : ""}${card.rank ?? ""}`;
}

/** Stable hand order: unknown blind cards last; known cards run weak → strong. */
export function sortHandWeakToStrong(cards: readonly CardView[], reversed = false): CardView[] {
  return cards
    .map((card, originalIndex) => ({ card, originalIndex }))
    .sort((left, right) => {
      const a = left.card;
      const b = right.card;
      if (!isVisible(a) || !isVisible(b)) {
        if (!isVisible(a) && !isVisible(b)) return left.originalIndex - right.originalIndex;
        return isVisible(a) ? -1 : 1;
      }
      const aStrength = a.joker ? RANKS.length : rankIndex(a.rank ?? "3");
      const bStrength = b.joker ? RANKS.length : rankIndex(b.rank ?? "3");
      // A raw Joker remains strongest even under revolution/J-back.
      const aOrder = a.joker ? RANKS.length : reversed ? RANKS.length - 1 - aStrength : aStrength;
      const bOrder = b.joker ? RANKS.length : reversed ? RANKS.length - 1 - bStrength : bStrength;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const suitDifference = (a.suit ? SUIT_ORDER[a.suit] : 9) - (b.suit ? SUIT_ORDER[b.suit] : 9);
      return suitDifference || left.originalIndex - right.originalIndex;
    })
    .map(({ card }) => card);
}

function toRuleCard(card: VisibleCard): RuleCard {
  return card.joker
    ? { id: card.id, suit: null, rank: "JOKER" }
    : { id: card.id, suit: card.suit ?? null, rank: card.rank ?? "3" };
}

function parseField(room: RoomView): PlayedGroup | undefined {
  if (!room.field.length || room.field.some((card) => !isVisible(card))) return undefined;
  try {
    const visible = room.field as VisibleCard[];
    const parsed = parsePlay(
      visible.map(toRuleCard),
      visible.flatMap((card) =>
        card.joker && card.mimic ? [{ cardId: card.id, ...card.mimic }] : [],
      ),
    );
    return {
      ...parsed,
      id: room.trickId ?? "field",
      playerId: "field",
    };
  } catch {
    return undefined;
  }
}

function combinations<T>(items: readonly T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (count > items.length) return [];
  const output: T[][] = [];
  const visit = (start: number, chosen: T[]) => {
    if (chosen.length === count) {
      output.push([...chosen]);
      return;
    }
    for (let index = start; index <= items.length - (count - chosen.length); index += 1) {
      chosen.push(items[index]!);
      visit(index + 1, chosen);
      chosen.pop();
    }
  };
  visit(0, []);
  return output;
}

function groupStrengthAllows(
  previous: PlayedGroup,
  targetRank: RuleRank | "JOKER",
  reversed: boolean,
  selectedNormals: readonly VisibleCard[],
): boolean {
  if (targetRank === "JOKER") return !isRawJoker(previous);
  if (isRawJoker(previous)) {
    return (
      previous.cards.length === 1 &&
      targetRank === "3" &&
      selectedNormals.some((card) => card.suit === "spade" && card.rank === "3")
    );
  }
  const previousRank = previous.cards[0]?.rank;
  if (!previousRank || previousRank === "JOKER") return false;
  const next = rankIndex(targetRank);
  const current = rankIndex(previousRank);
  return next !== current && (reversed ? next < current : next > current);
}

function groupCanContain(room: RoomView, previous: PlayedGroup, candidate: VisibleCard): boolean {
  const count = previous.cards.length;
  const visible = room.hand.filter(isVisible);
  const jokers = visible.filter((card) => Boolean(card.joker));
  const hiddenCount = room.hand.length - visible.length;
  const wildCount = jokers.length + hiddenCount;
  const reversed = strengthIsReversed(room.revolution, room.jackBack);

  if (
    candidate.joker &&
    wildCount >= count &&
    (count === 1 || room.suitLock.length === 0) &&
    room.hand.length !== count &&
    groupStrengthAllows(previous, "JOKER", reversed, [])
  ) {
    return true;
  }

  const targetRanks: readonly Rank[] = candidate.joker
    ? RANKS
    : candidate.rank
      ? [candidate.rank]
      : [];
  return targetRanks.some((targetRank) => {
    // Finishing on a non-straight made only from physical twos/Jokers is forbidden.
    if (room.hand.length === count && targetRank === "2") return false;
    const normals = visible.filter((card) => !card.joker && card.rank === targetRank);
    for (let normalCount = 0; normalCount <= Math.min(count, normals.length); normalCount += 1) {
      const wildNeeded = count - normalCount;
      if (wildNeeded > wildCount || (candidate.joker && wildNeeded === 0)) continue;
      for (const selectedNormals of combinations(normals, normalCount)) {
        if (!candidate.joker && !selectedNormals.some((card) => card.id === candidate.id)) continue;
        if (!groupStrengthAllows(previous, targetRank, reversed, selectedNormals)) continue;
        const selectedSuits = new Set(
          selectedNormals.flatMap((card) => (card.suit ? [card.suit] : [])),
        );
        const missingBoundSuits = room.suitLock.filter((suit) => !selectedSuits.has(suit)).length;
        if (missingBoundSuits <= wildNeeded) return true;
      }
    }
    return false;
  });
}

function straightStart(play: ParsedPlay | PlayedGroup): number {
  return Math.min(
    ...play.cards.map((card) => (card.rank === "JOKER" ? RANKS.length : rankIndex(card.rank))),
  );
}

function straightCanContain(
  room: RoomView,
  previous: PlayedGroup,
  candidate: VisibleCard,
): boolean {
  const count = previous.cards.length;
  const previousStart = straightStart(previous);
  const reversed = strengthIsReversed(room.revolution, room.jackBack);
  const visible = room.hand.filter(isVisible);
  const normalCards = visible.filter((card) => !card.joker && card.suit && card.rank);
  const wildCount =
    visible.filter((card) => Boolean(card.joker)).length + (room.hand.length - visible.length);

  const suits: Suit[] = candidate.joker
    ? ["spade", "heart", "diamond", "club"]
    : candidate.suit
      ? [candidate.suit]
      : [];
  return suits.some((suit) => {
    if (room.suitLock.some((bound) => bound !== suit)) return false;
    for (let start = 0; start <= RANKS.length - count; start += 1) {
      if (start === previousStart || !(reversed ? start < previousStart : start > previousStart)) {
        continue;
      }
      const segment = RANKS.slice(start, start + count);
      if (!candidate.joker && (!candidate.rank || !segment.includes(candidate.rank))) continue;
      const availableRanks = new Set(
        normalCards
          .filter((card) => card.suit === suit && card.rank && segment.includes(card.rank))
          .map((card) => card.rank!),
      );
      const missing = segment.filter((rank) => !availableRanks.has(rank)).length;
      const requiredWilds = candidate.joker ? Math.max(1, missing) : missing;
      if (requiredWilds <= wildCount) return true;
    }
    return false;
  });
}

/**
 * Returns cards which can still participate in at least one response to the
 * current pile. Hidden blind cards stay enabled so the projection never leaks
 * their authoritative face through highlighting.
 */
export function potentiallyPlayableCardIds(room: RoomView): Set<string> {
  if (!room.field.length) return new Set(room.hand.map((card) => card.id));
  const previous = parseField(room);
  if (!previous) return new Set(room.hand.map((card) => card.id));
  const playable = new Set<string>();
  for (const card of room.hand) {
    if (!isVisible(card)) {
      playable.add(card.id);
      continue;
    }
    const possible =
      previous.kind === "group"
        ? groupCanContain(room, previous, card)
        : straightCanContain(room, previous, card);
    if (possible) playable.add(card.id);
  }
  return playable;
}
