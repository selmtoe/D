import {
  RANKS,
  SUITS,
  type Card,
  type CreateGameOptions,
  type GameState,
  type HandCard,
  type PlayerState,
} from "./types.js";

export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) cards.push({ id: `${suit}-${rank}`, suit, rank });
  }
  cards.push({ id: "joker-1", suit: null, rank: "JOKER" });
  cards.push({ id: "joker-2", suit: null, rank: "JOKER" });
  return cards;
}

export function shuffle<T>(values: readonly T[], rng: () => number = Math.random): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const sample = rng();
    if (!(sample >= 0 && sample < 1)) throw new RangeError("rng must return a number in [0, 1)");
    const other = Math.floor(sample * (index + 1));
    const value = result[index];
    const swapped = result[other];
    if (value === undefined || swapped === undefined)
      throw new Error("shuffle index invariant violated");
    result[index] = swapped;
    result[other] = value;
  }
  return result;
}

function markBlind(cards: readonly Card[], count: number, rng: () => number): HandCard[] {
  if (count === 0) return cards.map((card) => ({ card, blind: false }));
  const selected = new Set(
    shuffle(
      cards.map((_, index) => index),
      rng,
    ).slice(0, Math.min(count, cards.length)),
  );
  const visible = cards
    .filter((_, index) => !selected.has(index))
    .map((card) => ({ card, blind: false }));
  const blind = shuffle(
    cards.filter((_, index) => selected.has(index)).map((card) => ({ card, blind: true })),
    rng,
  );
  return [...visible, ...blind];
}

function normalizedOptions(
  optionsOrBlindCount: CreateGameOptions | number | undefined,
): Required<Omit<CreateGameOptions, "rng">> & { rng: () => number } {
  const options: CreateGameOptions =
    typeof optionsOrBlindCount === "number"
      ? { mode: optionsOrBlindCount > 0 ? "blind" : "normal", blindCount: optionsOrBlindCount }
      : (optionsOrBlindCount ?? {});
  const mode = options.mode ?? "normal";
  const blindCount = options.blindCount ?? (mode === "blind" ? 1 : 0);
  if (mode === "normal" && blindCount !== 0)
    throw new RangeError("normal mode must use zero blind cards");
  if (mode === "blind" && (blindCount < 1 || blindCount > 10))
    throw new RangeError("blindCount must be from 1 to 10");
  return { mode, blindCount, rng: options.rng ?? Math.random, gameId: options.gameId ?? "game" };
}

export function createInitialGameState(
  playerIds: readonly string[],
  optionsOrBlindCount?: CreateGameOptions | number,
): GameState {
  if (playerIds.length < 3 || playerIds.length > 6)
    throw new RangeError("a game requires 3 to 6 players");
  if (new Set(playerIds).size !== playerIds.length || playerIds.some((id) => id.length === 0)) {
    throw new RangeError("player ids must be non-empty and unique");
  }
  const options = normalizedOptions(optionsOrBlindCount);
  const seatedIds = shuffle(playerIds, options.rng);
  // Faces are shuffled before IDs are assigned, so an ID never encodes or has a
  // stable public mapping to a hidden card's suit/rank.
  const deck = shuffle(createDeck(), options.rng).map((card, index) => ({
    ...card,
    id: `${options.gameId}-card-${String(index + 1).padStart(2, "0")}`,
  }));
  const dealt = new Map(seatedIds.map((id) => [id, [] as Card[]]));
  deck.forEach((card, index) => dealt.get(seatedIds[index % seatedIds.length]!)!.push(card));
  const diamondThreeOwner = seatedIds.find((id) =>
    dealt.get(id)!.some((card) => card.suit === "diamond" && card.rank === "3"),
  );
  if (diamondThreeOwner === undefined)
    throw new Error("deck invariant: diamond three has no owner");
  const start = seatedIds.indexOf(diamondThreeOwner);
  const rotated = [...seatedIds.slice(start), ...seatedIds.slice(0, start)];
  const players: PlayerState[] = rotated.map((id, seat) => ({
    id,
    seat,
    hand: markBlind(dealt.get(id)!, options.blindCount, options.rng),
    status: "active",
    rank: null,
    finishReason: null,
    timeoutWarnings: 0,
  }));
  return {
    id: options.gameId,
    version: 0,
    phase: "playing",
    mode: options.mode,
    blindCount: options.blindCount,
    players,
    deck: [],
    turnPlayerId: diamondThreeOwner,
    direction: 1,
    revolution: false,
    jackBack: false,
    binding: [],
    pile: null,
    trickHistory: [],
    discard: [],
    lastPlayerId: null,
    passedSincePlay: [],
    firstPlay: true,
    pendingEffect: null,
    effectBatch: null,
    nextFinishRank: 1,
    appliedActionIds: [],
    log: [],
  };
}

export const createGame = createInitialGameState;

export function startGame(state: GameState, _rng: () => number = Math.random): GameState {
  return state;
}
