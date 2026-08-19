import {
  countRank,
  isRawJoker,
  sortedStraightEffectRanks,
  strengthIsReversed,
  type ParsedPlay,
} from "./plays.js";
import type { GameState, PhysicalRank, QueuedEffect, Rank } from "./types.js";

type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;
type UnidentifiedEffect = WithoutId<QueuedEffect>;

function rankEffect(rank: PhysicalRank, count: number, straight: boolean): UnidentifiedEffect[] {
  switch (rank) {
    case "A":
      return [{ type: "steal", actorId: "", count }];
    case "4":
      return count % 2 === 1 ? [{ type: "reverse" }] : [];
    case "5":
      return [{ type: "skip", count: straight ? 1 : 2 * count - 1 }];
    case "6":
      return !straight && count >= 2 ? [{ type: "flush", reason: "rokurokubi" }] : [];
    case "7":
      return [{ type: "give", actorId: "", count }];
    case "8":
      return [{ type: "flush", reason: "eight-cut" }];
    case "9":
      return !straight && count >= 2 ? [{ type: "flush", reason: "ambulance" }] : [];
    case "10":
      return [{ type: "discard", actorId: "", count }];
    case "J":
      return [{ type: "toggle-jack-back" }];
    case "Q":
      return [{ type: "bomb", actorId: "", count }];
    case "K":
      return [{ type: "recover", actorId: "", count }];
    case "2":
    case "3":
    case "JOKER":
      return [];
  }
}

function withActor(effect: UnidentifiedEffect, actorId: string): UnidentifiedEffect {
  if (
    effect.type === "recover" ||
    effect.type === "steal" ||
    effect.type === "give" ||
    effect.type === "discard" ||
    effect.type === "bomb"
  ) {
    return { ...effect, actorId };
  }
  return effect;
}

export function buildEffectQueue(
  state: GameState,
  play: ParsedPlay,
  actorId: string,
  playId: string,
  spadeThree: boolean,
): QueuedEffect[] {
  const effects: UnidentifiedEffect[] = [];
  if (spadeThree) {
    effects.push({ type: "flush", reason: "spade-three" });
  } else if (play.kind === "group") {
    if (play.cards.length >= 4) effects.push({ type: "toggle-revolution" });
    if (isRawJoker(play)) {
      if (play.cards.length === 2) effects.push({ type: "flush", reason: "joker-pair" });
    } else {
      effects.push(...rankEffect(play.cards[0]!.rank, play.cards.length, false));
    }
  } else {
    if (countRank(play, "K") > 0) effects.push(...rankEffect("K", 1, true));
    const togglesJackBack = countRank(play, "J") > 0;
    if (togglesJackBack) effects.push({ type: "toggle-jack-back" });
    const togglesRevolution = play.cards.length >= 4;
    if (togglesRevolution) effects.push({ type: "toggle-revolution" });
    const reversedAfterToggles = strengthIsReversed(
      togglesRevolution ? !state.revolution : state.revolution,
      togglesJackBack ? !state.jackBack : state.jackBack,
    );
    for (const rank of sortedStraightEffectRanks(play, reversedAfterToggles)) {
      effects.push(...rankEffect(rank as Rank, 1, true));
    }
    if (countRank(play, "8") > 0) effects.push(...rankEffect("8", 1, true));
  }
  return effects.map(
    (effect, index) =>
      ({ ...withActor(effect, actorId), id: `${playId}:effect:${index + 1}` }) as QueuedEffect,
  );
}
