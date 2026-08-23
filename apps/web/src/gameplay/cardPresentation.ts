import {
  RANKS,
  SUITS,
  effectiveSuits,
  includesPhysicalDiamondThree,
  isForbiddenFinish,
  isRawJoker,
  isSpadeThreeReturn,
  isStrictlyStronger,
  parsePlay,
  rankIndex,
  strengthIsReversed,
  type Card as RuleCard,
  type ParsedPlay,
  type PlayedGroup,
  type JokerMimic,
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

function playMatchesRoom(room: RoomView, play: ParsedPlay): boolean {
  if (room.firstPlay && !includesPhysicalDiamondThree(play)) return false;
  if (isForbiddenFinish(play, room.hand.length)) return false;
  if (!room.field.length) return true;
  const previous = parseField(room);
  if (!previous) return false;
  if (isSpadeThreeReturn(play, previous)) return true;
  if (play.kind !== previous.kind || play.cards.length !== previous.cards.length) return false;
  const ignoresBinding = play.cards.length === 1 && isRawJoker(play);
  const suits = new Set(effectiveSuits(play));
  if (!ignoresBinding && room.suitLock.some((suit) => !suits.has(suit))) return false;
  return isStrictlyStronger(play, previous, strengthIsReversed(room.revolution, room.jackBack));
}

function declarationSets(jokerIds: readonly string[]): JokerMimic[][] {
  let candidates: JokerMimic[][] = [[]];
  for (const cardId of jokerIds) {
    candidates = candidates.flatMap((prefix) =>
      SUITS.flatMap((suit) => RANKS.map((rank) => [...prefix, { cardId, suit, rank }])),
    );
  }
  return candidates;
}

function exactVisibleCandidates(room: RoomView, cards: readonly VisibleCard[]): JokerMimic[][] {
  const jokers = cards.filter((card) => Boolean(card.joker));
  const declarations =
    jokers.length === 0 || jokers.length === cards.length
      ? [[]]
      : declarationSets(jokers.map((card) => card.id));
  return declarations.filter((mimics) => {
    try {
      return playMatchesRoom(room, parsePlay(cards.map(toRuleCard), mimics));
    } catch {
      return false;
    }
  });
}

function candidateRanksForGroup(selectedNormals: readonly VisibleCard[]): readonly Rank[] {
  const ranks = new Set(selectedNormals.flatMap((card) => (card.rank ? [card.rank] : [])));
  return ranks.size > 1 ? [] : ranks.size === 1 ? [...ranks] : RANKS;
}

function rawJokerGroupCanComplete(
  room: RoomView,
  selected: readonly CardView[],
  exact: boolean,
): boolean {
  if (room.firstPlay || selected.some((card) => isVisible(card) && !card.joker)) return false;
  const previous = parseField(room);
  if (room.field.length && (!previous || previous.kind !== "group" || isRawJoker(previous))) {
    return false;
  }
  const possibleJokers = room.hand.filter(
    (card) => !isVisible(card) || (isVisible(card) && Boolean(card.joker)),
  ).length;
  const targetCounts = previous ? [previous.cards.length] : exact ? [selected.length] : [1, 2];
  return targetCounts.some(
    (count) =>
      count >= selected.length &&
      count <= 2 &&
      count <= possibleJokers &&
      (!exact || count === selected.length) &&
      (count === 1 || room.suitLock.length === 0) &&
      count !== room.hand.length,
  );
}

function groupCanCompleteSelection(
  room: RoomView,
  selected: readonly CardView[],
  exact: boolean,
): boolean {
  const previous = parseField(room);
  if (room.field.length && (!previous || previous.kind !== "group")) return false;
  const selectedNormals = selected.filter(
    (card): card is VisibleCard => isVisible(card) && !card.joker,
  );
  const selectedHiddenCount = selected.filter((card) => !isVisible(card)).length;
  const selectedWilds = selected.length - selectedNormals.length;
  const handNormals = room.hand.filter(
    (card): card is VisibleCard => isVisible(card) && !card.joker,
  );
  const handWilds = room.hand.length - handNormals.length;
  const remainingHiddenCount =
    room.hand.filter((card) => !isVisible(card)).length - selectedHiddenCount;
  const targetCounts = previous
    ? [previous.cards.length]
    : exact
      ? [selected.length]
      : Array.from(
          { length: Math.max(0, room.hand.length - Math.max(1, selected.length) + 1) },
          (_, index) => Math.max(1, selected.length) + index,
        );
  const reversed = strengthIsReversed(room.revolution, room.jackBack);

  for (const targetRank of candidateRanksForGroup(selectedNormals)) {
    const selectedRankCards = selectedNormals.filter((card) => card.rank === targetRank);
    if (selectedRankCards.length !== selectedNormals.length) continue;
    const availableNormals = handNormals.filter((card) => card.rank === targetRank);
    const selectedNormalIds = new Set(selectedRankCards.map((card) => card.id));
    const remainingNormals = availableNormals.filter((card) => !selectedNormalIds.has(card.id));
    for (const targetCount of targetCounts) {
      if (targetCount < selected.length || targetCount > availableNormals.length + handWilds)
        continue;
      if (exact && targetCount !== selected.length) continue;
      if (previous) {
        if (isRawJoker(previous)) {
          const selectedSpadeThree = selectedRankCards.some(
            (card) => card.suit === "spade" && card.rank === "3",
          );
          const possibleHiddenSpadeThree = selected.some((card) => !isVisible(card));
          if (
            targetCount !== 1 ||
            targetRank !== "3" ||
            (!selectedSpadeThree && !possibleHiddenSpadeThree)
          ) {
            continue;
          }
        } else {
          const previousRank = previous.cards[0]?.rank;
          if (!previousRank || previousRank === "JOKER") continue;
          const next = rankIndex(targetRank);
          const current = rankIndex(previousRank);
          if (next === current || (reversed ? next > current : next < current)) continue;
        }
      }
      const slotsToAdd = targetCount - selected.length;
      if (slotsToAdd > remainingNormals.length + (handWilds - selectedWilds)) continue;
      if (targetCount === room.hand.length && targetRank === "2") continue;

      // Try each possible set of physical same-rank cards. This keeps the
      // binding check honest: a remaining slot cannot simultaneously be a
      // normal card and a Joker declaring a second bound suit.
      for (let mask = 0; mask < 1 << remainingNormals.length; mask += 1) {
        const addedNormals = remainingNormals.filter((_, index) => mask & (1 << index));
        if (addedNormals.length > slotsToAdd) continue;
        const addedWilds = slotsToAdd - addedNormals.length;
        if (addedWilds > handWilds - selectedWilds) continue;
        const canAddHidden = Math.min(addedWilds, remainingHiddenCount) > 0;
        // An all-Joker final selection parses as a raw group and cannot declare
        // invented faces. rawJokerGroupCanComplete judges that separate route.
        if (
          selectedNormals.length === 0 &&
          addedNormals.length === 0 &&
          selectedHiddenCount === 0 &&
          !canAddHidden
        ) {
          continue;
        }
        if (!previous || !isRawJoker(previous)) {
          const normalSuits = new Set(
            [...selectedRankCards, ...addedNormals].flatMap((card) =>
              card.suit ? [card.suit] : [],
            ),
          );
          const missingBound = room.suitLock.filter((suit) => !normalSuits.has(suit));
          if (missingBound.length > selectedWilds + addedWilds) continue;
        }
        if (room.firstPlay) {
          if (targetRank !== "3") continue;
          const knownDiamondThree = [...selectedRankCards, ...addedNormals].some(
            (card) => card.suit === "diamond" && card.rank === "3",
          );
          if (!knownDiamondThree && selectedHiddenCount === 0 && !canAddHidden) continue;
        }
        return true;
      }
    }
  }
  return false;
}

function straightCanCompleteSelection(
  room: RoomView,
  selected: readonly CardView[],
  exact: boolean,
): boolean {
  const previous = parseField(room);
  if (room.field.length && (!previous || previous.kind !== "straight")) return false;
  const selectedNormals = selected.filter(
    (card): card is VisibleCard => isVisible(card) && !card.joker,
  );
  const selectedContainsHidden = selected.some((card) => !isVisible(card));
  const selectedWilds = selected.length - selectedNormals.length;
  const suits = new Set(selectedNormals.flatMap((card) => (card.suit ? [card.suit] : [])));
  const ranks = new Set(selectedNormals.flatMap((card) => (card.rank ? [card.rank] : [])));
  if (suits.size > 1 || ranks.size !== selectedNormals.length) return false;
  const targetSuits: readonly Suit[] = suits.size === 1 ? [...suits] : SUITS;
  const targetLengths = previous
    ? [previous.cards.length]
    : exact
      ? [selected.length]
      : Array.from(
          { length: Math.max(0, RANKS.length - Math.max(3, selected.length) + 1) },
          (_, index) => Math.max(3, selected.length) + index,
        );
  const selectedIds = new Set(selected.map((card) => card.id));
  const availableWilds = room.hand.filter(
    (card) => !isVisible(card) || (isVisible(card) && Boolean(card.joker)),
  ).length;
  const reversed = strengthIsReversed(room.revolution, room.jackBack);
  const previousStart = previous ? straightStart(previous) : undefined;

  for (const suit of targetSuits) {
    if (room.suitLock.some((bound) => bound !== suit)) continue;
    const normalByRank = new Map(
      room.hand
        .filter(
          (card): card is VisibleCard =>
            isVisible(card) && !card.joker && card.suit === suit && Boolean(card.rank),
        )
        .map((card) => [card.rank!, card]),
    );
    for (const length of targetLengths) {
      if (length < 3 || length < selected.length || length > RANKS.length) continue;
      for (let start = 0; start <= RANKS.length - length; start += 1) {
        if (
          previousStart !== undefined &&
          (start === previousStart || (reversed ? start > previousStart : start < previousStart))
        ) {
          continue;
        }
        const segment = RANKS.slice(start, start + length);
        if (selectedNormals.some((card) => !card.rank || !segment.includes(card.rank))) continue;
        const missingSlots = length - selectedNormals.length;
        if (selectedWilds > missingSlots) continue;
        const remainingNormalCount = segment.filter((rank) => {
          const card = normalByRank.get(rank);
          return card && !selectedIds.has(card.id);
        }).length;
        const remainingWilds = availableWilds - selectedWilds;
        const remainingSlots = length - selected.length;
        // A straight needs at least one physical normal card. An all-Joker final
        // selection parses as a raw group and may not mimic a straight.
        if (
          selectedNormals.length === 0 &&
          !selectedContainsHidden &&
          (remainingSlots === 0 || remainingNormalCount === 0)
        ) {
          continue;
        }
        if (remainingSlots > remainingNormalCount + remainingWilds) continue;
        if (room.firstPlay) {
          if (suit !== "diamond" || !segment.includes("3")) continue;
          const diamondThree = normalByRank.get("3");
          const selectedHidden = selected.some((card) => !isVisible(card));
          const remainingHidden = room.hand.some(
            (card) => !isVisible(card) && !selectedIds.has(card.id),
          );
          if (
            !selectedHidden &&
            !remainingHidden &&
            (!diamondThree || (exact && !selectedIds.has(diamondThree.id)))
          ) {
            continue;
          }
        }
        return true;
      }
    }
  }
  return false;
}

function selectionCanComplete(room: RoomView, cards: readonly CardView[], exact: boolean): boolean {
  if (cards.length === 0) return false;
  return (
    rawJokerGroupCanComplete(room, cards, exact) ||
    groupCanCompleteSelection(room, cards, exact) ||
    straightCanCompleteSelection(room, cards, exact)
  );
}

export interface CardSelectionAnalysis {
  complete: boolean;
  completable: boolean;
  jokerCandidates: JokerMimic[][];
}

export function analyzeCardSelection(
  room: RoomView,
  selectedIds: readonly string[],
): CardSelectionAnalysis {
  const selected = selectedIds.flatMap((id) => {
    const card = room.hand.find((candidate) => candidate.id === id);
    return card ? [card] : [];
  });
  const completable = selectionCanComplete(room, selected, false);
  if (!selected.length || !selectionCanComplete(room, selected, true)) {
    return { complete: false, completable, jokerCandidates: [] };
  }
  if (selected.every(isVisible)) {
    const jokerCandidates = exactVisibleCandidates(room, selected);
    return {
      complete: jokerCandidates.length > 0,
      completable,
      jokerCandidates,
    };
  }
  return { complete: true, completable, jokerCandidates: [[]] };
}

export function selectableCardIds(room: RoomView, selectedIds: readonly string[]): Set<string> {
  const selected = new Set(selectedIds);
  const selectable = new Set<string>();
  for (const card of room.hand) {
    if (selected.has(card.id)) {
      selectable.add(card.id);
      continue;
    }
    // A blind card stays selectable regardless of its hidden face so disabled styling never
    // becomes an oracle for the card that only the authority may inspect.
    if (!isVisible(card)) {
      selectable.add(card.id);
      continue;
    }
    if (
      selectionCanComplete(
        room,
        [
          ...selectedIds
            .map((id) => room.hand.find((item) => item.id === id))
            .filter((item): item is CardView => Boolean(item)),
          card,
        ],
        false,
      )
    ) {
      selectable.add(card.id);
    }
  }
  return selectable;
}

function straightStart(play: ParsedPlay | PlayedGroup): number {
  return Math.min(
    ...play.cards.map((card) => (card.rank === "JOKER" ? RANKS.length : rankIndex(card.rank))),
  );
}

/**
 * Returns cards which can still participate in at least one response to the
 * current pile. Hidden blind cards stay enabled so the projection never leaks
 * their authoritative face through highlighting.
 */
export function potentiallyPlayableCardIds(room: RoomView): Set<string> {
  return selectableCardIds(room, []);
}
