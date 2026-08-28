import {
  RANKS,
  SUITS,
  findLegalJokerMimics,
  strengthIsReversed,
  validatePlayForState,
  type GameState,
  type JokerMimic,
  type PhysicalRank,
} from "@daifugo/rules";
import type { CardView, PendingEffectView, RoomView } from "../app/model";
import { scoreCpuCandidates } from "./cpuPolicyRuntime";

const PHASES = ["lobby", "playing", "finished"] as const;
const PLAYER_STATUSES = ["active", "finished", "disqualified", "other"] as const;
const PENDING_EFFECTS = ["steal", "give", "discard", "bomber", "collect", "clearField"] as const;
const COMMANDS = [
  "submitPlay",
  "submitPass",
  "declareJokerMimic",
  "resolveSteal",
  "resolveGive",
  "resolveDiscard",
  "resolveBomber",
  "resolveCollect",
] as const;
const KINDS = ["play", "pass", "effect", "joker-mimic"] as const;
const MAX_PLAYERS = 6;
const MAX_CANDIDATES = 512;
const PHYSICAL_RANKS = [...RANKS, "JOKER"] as const;

export type CpuDecisionName = (typeof COMMANDS)[number];

export type CpuDecision = {
  name: CpuDecisionName;
  payload: Record<string, unknown>;
  policy: "nn" | "fallback";
  score?: number;
};

export type CpuCandidate = {
  kind: (typeof KINDS)[number];
  commandName: CpuDecisionName;
  payload: Record<string, unknown>;
  cardIds?: string[];
  mimics?: JokerMimic[];
  authorityJudgedBlind?: boolean;
};

function oneHot(value: string, vocabulary: readonly string[]): number[] {
  return vocabulary.map((item) => (value === item ? 1 : 0));
}

function ratio(value: number, denominator: number): number {
  return Math.max(0, Math.min(value / denominator, 1));
}

function visibleRank(card: CardView): PhysicalRank | undefined {
  if (card.visibility !== "face") return undefined;
  return card.joker ? "JOKER" : card.rank;
}

function candidateCards(candidate: CpuCandidate, view: RoomView): CardView[] {
  const catalog = new Map(
    [
      ...view.hand,
      ...view.field,
      ...view.discard,
      ...(view.fieldPlays?.flat() ?? []),
      ...view.players.flatMap((player) => player.cards ?? []),
      ...(view.pendingJokerMimic?.revealedCards ?? []),
    ].map((card) => [card.id, card]),
  );
  return candidateCardIds(candidate).flatMap((id) => {
    const card = catalog.get(id);
    return card ? [card] : [];
  });
}

function normalizedStrength(rank: PhysicalRank | undefined, reversed: boolean): number {
  if (!rank) return 0.5;
  if (rank === "JOKER") return 1;
  const value = RANKS.indexOf(rank) / Math.max(1, RANKS.length - 1);
  return reversed ? 1 - value : value;
}

function knownPublicCards(view: RoomView): CardView[] {
  const byId = new Map<string, CardView>();
  for (const card of [
    ...view.hand,
    ...view.field,
    ...view.discard,
    ...(view.fieldPlays?.flat() ?? []),
    ...view.players.flatMap((player) => player.cards ?? []),
  ]) {
    if (card.visibility === "face") byId.set(card.id, card);
  }
  return [...byId.values()];
}

/**
 * Probability that a one-card blind submission is legal from information the
 * owner is actually allowed to observe. No hidden face or card ID is decoded.
 */
export function blindPlaySuccessProbability(
  game: GameState,
  view: RoomView,
  candidate: CpuCandidate,
): number {
  if (!candidate.authorityJudgedBlind) return 1;
  const selectedIds = candidateCardIds(candidate);
  if (selectedIds.length !== 1 || candidate.commandName !== "submitPlay") return 0;
  if (view.firstPlay ?? game.firstPlay) return 0;

  const remainingAfterPlay = Math.max(0, view.hand.length - selectedIds.length);
  const rankCounts = new Map<PhysicalRank, number>(
    PHYSICAL_RANKS.map((rank) => [rank, rank === "JOKER" ? 2 : 4]),
  );
  const suitRankCounts = new Map<string, number>();
  for (const suit of SUITS) {
    for (const rank of RANKS) suitRankCounts.set(`${suit}:${rank}`, 1);
  }
  for (const card of knownPublicCards(view)) {
    const rank = visibleRank(card);
    if (!rank || card.visibility !== "face") continue;
    rankCounts.set(rank, Math.max(0, (rankCounts.get(rank) ?? 0) - 1));
    if (rank !== "JOKER" && card.suit) {
      const key = `${card.suit}:${rank}`;
      suitRankCounts.set(key, Math.max(0, (suitRankCounts.get(key) ?? 0) - 1));
    }
  }

  const total = [...rankCounts.values()].reduce((sum, count) => sum + count, 0);
  if (total <= 0) return 0;
  const finishAllowed = (rank: PhysicalRank) =>
    remainingAfterPlay > 0 || (rank !== "2" && rank !== "JOKER");
  if (view.field.length === 0) {
    const legal = PHYSICAL_RANKS.reduce(
      (sum, rank) => sum + (finishAllowed(rank) ? (rankCounts.get(rank) ?? 0) : 0),
      0,
    );
    return legal / total;
  }
  if (view.field.length !== 1) return 0;

  const previous = view.field[0];
  const previousRank =
    previous?.visibility === "face" ? (previous.mimic?.rank ?? visibleRank(previous)) : undefined;
  const previousIsRawJoker =
    previous?.visibility === "face" && Boolean(previous.joker) && previous.mimic === undefined;
  if (!previous || !previousRank) return 0;
  const reversed = strengthIsReversed(view.revolution, view.jackBack);
  let legal = 0;
  for (const rank of PHYSICAL_RANKS) {
    if (!finishAllowed(rank)) continue;
    if (rank === "JOKER") {
      if (!previousIsRawJoker) legal += rankCounts.get(rank) ?? 0;
      continue;
    }
    for (const suit of SUITS) {
      const count = suitRankCounts.get(`${suit}:${rank}`) ?? 0;
      if (count === 0) continue;
      const spadeThreeReturn = previousIsRawJoker && rank === "3" && suit === "spade";
      const obeysLock = view.suitLock.length === 0 || view.suitLock.includes(suit);
      const stronger =
        previousRank !== "JOKER" &&
        (reversed
          ? RANKS.indexOf(rank) < RANKS.indexOf(previousRank)
          : RANKS.indexOf(rank) > RANKS.indexOf(previousRank));
      if (spadeThreeReturn || (obeysLock && stronger)) legal += count;
    }
  }
  return Math.max(0, Math.min(1, legal / total));
}

function rankHistogram(cards: readonly CardView[]): number[] {
  return [...RANKS, "JOKER"].map((rank) =>
    ratio(cards.filter((card) => visibleRank(card) === rank).length, rank === "JOKER" ? 2 : 4),
  );
}

function suitHistogram(cards: readonly CardView[]): number[] {
  return SUITS.map((suit) =>
    ratio(cards.filter((card) => card.visibility === "face" && card.suit === suit).length, 13),
  );
}

export function encodeCpuState(view: RoomView, actorId: string): number[] {
  const visibleHand = view.hand.filter((card) => card.visibility === "face");
  const hiddenHand = view.hand.filter((card) => card.visibility === "hidden");
  const actorIndex = Math.max(
    0,
    view.players.findIndex((player) => player.id === actorId),
  );
  const relativePlayers = [...view.players.slice(actorIndex), ...view.players.slice(0, actorIndex)];
  const features: number[] = [];
  features.push(...oneHot(view.phase, PHASES));
  features.push(view.settings.mode === "normal" ? 1 : 0, view.settings.mode === "blind" ? 1 : 0);
  features.push(
    ratio(view.players.length, MAX_PLAYERS),
    ratio(view.hand.length, 54),
    ratio(visibleHand.length, 54),
    ratio(hiddenHand.length, 54),
  );
  features.push(...rankHistogram(visibleHand), ...suitHistogram(visibleHand));
  features.push(
    ratio(view.field.length, 54),
    ...rankHistogram(view.field),
    ...suitHistogram(view.field),
  );
  features.push(view.revolution ? 1 : 0, view.jackBack ? 1 : 0, view.direction === 1 ? 1 : 0);
  features.push(...SUITS.map((suit) => (view.suitLock.includes(suit) ? 1 : 0)));
  features.push(ratio(view.pendingEffects.length, 6));
  features.push(
    ...PENDING_EFFECTS.map((kind) =>
      view.pendingEffects.some((effect) => effect.kind === kind) ? 1 : 0,
    ),
  );
  features.push(
    ratio(
      view.pendingEffects.reduce((sum, effect) => sum + effect.requiredCount, 0),
      6,
    ),
    view.pendingJokerMimic ? 1 : 0,
    ratio(view.pendingJokerMimic?.candidates.length ?? 0, 16),
  );
  for (let seat = 0; seat < MAX_PLAYERS; seat += 1) {
    const player = relativePlayers[seat];
    if (!player) {
      features.push(...new Array<number>(4 + PLAYER_STATUSES.length).fill(0));
      continue;
    }
    const status = PLAYER_STATUSES.includes(player.status) ? player.status : "other";
    features.push(
      1,
      player.id === actorId ? 1 : 0,
      player.id === view.currentPlayerId ? 1 : 0,
      ratio(player.cardCount, 54),
      ...oneHot(status, PLAYER_STATUSES),
    );
  }
  if (features.length !== 111 || features.some((value) => !Number.isFinite(value))) {
    throw new Error(`invalid CPU state features: ${features.length}`);
  }
  return features;
}

function candidateCardIds(candidate: CpuCandidate): string[] {
  const payload = candidate.payload;
  const direct = candidate.cardIds ?? [];
  const payloadIds = Array.isArray(payload.cardIds)
    ? payload.cardIds.filter((value): value is string => typeof value === "string")
    : [];
  const transferIds = [payload.transfers, payload.selections]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .flatMap((value) =>
      value &&
      typeof value === "object" &&
      typeof (value as { cardId?: unknown }).cardId === "string"
        ? [(value as { cardId: string }).cardId]
        : [],
    );
  return [...new Set([...direct, ...payloadIds, ...transferIds])];
}

function candidateTargetIds(candidate: CpuCandidate): string[] {
  return [
    ...new Set(
      [candidate.payload.transfers, candidate.payload.selections]
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .flatMap((value) =>
          value &&
          typeof value === "object" &&
          typeof (value as { targetUid?: unknown }).targetUid === "string"
            ? [(value as { targetUid: string }).targetUid]
            : [],
        ),
    ),
  ];
}

export function encodeCpuAction(
  candidate: CpuCandidate,
  view: RoomView,
  actorId: string,
): number[] {
  const catalog = new Map(
    [...view.hand, ...view.field, ...(view.pendingJokerMimic?.revealedCards ?? [])].map((card) => [
      card.id,
      card,
    ]),
  );
  const cardIds = candidateCardIds(candidate);
  const knownCards = cardIds.flatMap((id) => {
    const card = catalog.get(id);
    return card && card.visibility === "face" ? [card] : [];
  });
  const actorIndex = Math.max(
    0,
    view.players.findIndex((player) => player.id === actorId),
  );
  const relativeIds = [...view.players.slice(actorIndex), ...view.players.slice(0, actorIndex)].map(
    (player) => player.id,
  );
  const targetIds = candidateTargetIds(candidate);
  const targetSeats = targetIds.flatMap((id) => {
    const index = relativeIds.indexOf(id);
    return index >= 0 ? [index] : [];
  });
  const bomberRanks = new Set(
    (Array.isArray(candidate.payload.ranks) ? candidate.payload.ranks : []).map((rank) =>
      String(rank).toUpperCase() === "JOKER" ? "JOKER" : String(rank),
    ),
  );
  const mimics =
    candidate.mimics ?? (Array.isArray(candidate.payload.mimics) ? candidate.payload.mimics : []);
  const features: number[] = [];
  features.push(
    ...oneHot(candidate.commandName, COMMANDS),
    COMMANDS.includes(candidate.commandName) ? 0 : 1,
  );
  features.push(...oneHot(candidate.kind, KINDS));
  features.push(
    ratio(cardIds.length, 8),
    ratio(knownCards.length, 8),
    ratio(cardIds.length - knownCards.length, 8),
    ...rankHistogram(knownCards),
    ...suitHistogram(knownCards),
    ratio(targetIds.length, MAX_PLAYERS),
    ratio(targetIds.length - targetSeats.length, MAX_PLAYERS),
    ...Array.from({ length: MAX_PLAYERS }, (_, seat) => (targetSeats.includes(seat) ? 1 : 0)),
    ...[...RANKS, "JOKER"].map((rank) => (bomberRanks.has(rank) ? 1 : 0)),
    ratio(mimics.length, 8),
    candidate.payload.blindConfirmed ? 1 : 0,
    candidate.authorityJudgedBlind ? 1 : 0,
  );
  if (features.length !== 59 || features.some((value) => !Number.isFinite(value))) {
    throw new Error(`invalid CPU action features: ${features.length}`);
  }
  return features;
}

function combinations<T>(values: readonly T[], count: number, limit = MAX_CANDIDATES): T[][] {
  const result: T[][] = [];
  const visit = (start: number, selected: T[]) => {
    if (result.length >= limit) return;
    if (selected.length === count) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= values.length - (count - selected.length); index += 1) {
      selected.push(values[index]!);
      visit(index + 1, selected);
      selected.pop();
      if (result.length >= limit) return;
    }
  };
  if (count >= 0 && count <= values.length) visit(0, []);
  return result;
}

function effectCandidates(view: RoomView, effect: PendingEffectView): CpuCandidate[] {
  const eligibleIds = new Set(effect.eligibleCardIds ?? []);
  const eligiblePlayers = new Set(effect.eligiblePlayerIds ?? []);
  const ownEligible = view.hand.filter((card) => eligibleIds.has(card.id));
  const cardSets = combinations(ownEligible, effect.requiredCount, 96);
  if (effect.kind === "give") {
    return view.players
      .filter((player) => player.id !== effect.actorId && eligiblePlayers.has(player.id))
      .flatMap((player) =>
        cardSets.map((cards) => ({
          kind: "effect" as const,
          commandName: "resolveGive" as const,
          payload: { transfers: cards.map((card) => ({ targetUid: player.id, cardId: card.id })) },
        })),
      )
      .slice(0, MAX_CANDIDATES);
  }
  if (effect.kind === "discard") {
    return cardSets.map((cards) => ({
      kind: "effect",
      commandName: "resolveDiscard",
      payload: { cardIds: cards.map((card) => card.id) },
    }));
  }
  if (effect.kind === "collect") {
    return combinations(
      view.discard.filter((card) => eligibleIds.has(card.id)),
      effect.requiredCount,
      MAX_CANDIDATES,
    ).map((cards) => ({
      kind: "effect",
      commandName: "resolveCollect",
      payload: { cardIds: cards.map((card) => card.id) },
    }));
  }
  if (effect.kind === "steal") {
    const targets = view.players.flatMap((player) =>
      player.id !== effect.actorId && eligiblePlayers.has(player.id)
        ? (player.cards ?? [])
            .filter((card) => eligibleIds.has(card.id))
            .map((card) => ({ targetUid: player.id, cardId: card.id }))
        : [],
    );
    return combinations(targets, effect.requiredCount, MAX_CANDIDATES).map((selections) => ({
      kind: "effect",
      commandName: "resolveSteal",
      payload: { selections },
    }));
  }
  if (effect.kind === "bomber") {
    const ranks = [...RANKS, "JOKER"] as PhysicalRank[];
    return combinations(ranks, effect.requiredCount, MAX_CANDIDATES).map((selected) => ({
      kind: "effect",
      commandName: "resolveBomber",
      payload: { ranks: selected.map((rank) => (rank === "JOKER" ? "Joker" : rank)) },
    }));
  }
  return [];
}

function playCandidateKey(cardIds: readonly string[], mimics: readonly JokerMimic[]): string {
  return `${[...cardIds].sort().join(",")}|${[...mimics]
    .sort((left, right) => left.cardId.localeCompare(right.cardId))
    .map((mimic) => `${mimic.cardId}:${mimic.suit}:${mimic.rank}`)
    .join(",")}`;
}

function visiblePlayCandidates(game: GameState, view: RoomView, actorId: string): CpuCandidate[] {
  const visible = view.hand.filter((card) => card.visibility === "face");
  const jokers = visible.filter((card) => Boolean(card.joker));
  const normals = visible.filter((card) => !card.joker && card.rank && card.suit);
  const candidateIds: string[][] = [];
  const targetCount = game.pile?.cards.length;

  for (const rank of RANKS) {
    const sameRank = normals.filter((card) => card.rank === rank);
    const minimum = targetCount ?? 1;
    const maximum = targetCount ?? Math.min(sameRank.length + jokers.length, 6);
    for (let count = minimum; count <= maximum; count += 1) {
      for (let jokerCount = 0; jokerCount <= Math.min(jokers.length, count); jokerCount += 1) {
        const normalCount = count - jokerCount;
        if (normalCount < 1) continue;
        for (const selectedNormals of combinations(sameRank, normalCount, 32)) {
          for (const selectedJokers of combinations(jokers, jokerCount, 4)) {
            candidateIds.push([...selectedNormals, ...selectedJokers].map((card) => card.id));
          }
        }
      }
    }
  }
  for (let count = 1; count <= jokers.length; count += 1) {
    if (targetCount === undefined || targetCount === count) {
      candidateIds.push(
        ...combinations(jokers, count).map((cards) => cards.map((card) => card.id)),
      );
    }
  }

  const straightLengths = targetCount
    ? [targetCount]
    : Array.from({ length: 11 }, (_, index) => index + 3);
  for (const suit of SUITS) {
    const byRank = new Map(
      normals.filter((card) => card.suit === suit).map((card) => [card.rank!, card]),
    );
    for (const length of straightLengths) {
      if (length < 3 || length > RANKS.length) continue;
      for (let start = 0; start <= RANKS.length - length; start += 1) {
        const segment = RANKS.slice(start, start + length);
        const missing = segment.filter((rank) => !byRank.has(rank));
        if (missing.length > jokers.length) continue;
        const optionalRanks = segment.filter((rank) => byRank.has(rank));
        for (let extraJokers = 0; extraJokers <= jokers.length - missing.length; extraJokers += 1) {
          for (const replacedRanks of combinations(optionalRanks, extraJokers, 32)) {
            const replaced = new Set(replacedRanks);
            const selectedNormals = segment.flatMap((rank) => {
              const card = byRank.get(rank);
              return card && !replaced.has(rank) ? [card.id] : [];
            });
            const selectedJokers = jokers
              .slice(0, missing.length + extraJokers)
              .map((card) => card.id);
            candidateIds.push([...selectedNormals, ...selectedJokers]);
          }
        }
      }
    }
  }

  const result: CpuCandidate[] = [];
  const seen = new Set<string>();
  for (const cardIds of candidateIds) {
    if (result.length >= MAX_CANDIDATES) break;
    const hasJoker = cardIds.some((id) => jokers.some((joker) => joker.id === id));
    let mimicSets: JokerMimic[][];
    try {
      mimicSets = hasJoker ? findLegalJokerMimics(game, actorId, cardIds) : [[]];
    } catch {
      continue;
    }
    for (const mimics of mimicSets) {
      try {
        validatePlayForState(game, actorId, cardIds, mimics);
      } catch {
        continue;
      }
      const key = playCandidateKey(cardIds, mimics);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        kind: "play",
        commandName: "submitPlay",
        cardIds: [...cardIds],
        mimics: [...mimics],
        payload: { cardIds: [...cardIds], mimics: [...mimics], blindConfirmed: false },
      });
      if (result.length >= MAX_CANDIDATES) break;
    }
  }
  return result;
}

export function legalCpuCandidates(
  game: GameState,
  view: RoomView,
  actorId: string,
): CpuCandidate[] {
  if (view.pendingJokerMimic) {
    return view.pendingJokerMimic.candidates.map((mimics) => ({
      kind: "joker-mimic",
      commandName: "declareJokerMimic",
      mimics,
      payload: { mimics, blindConfirmed: true },
    }));
  }
  const effect = view.pendingEffects.find((candidate) => candidate.actorId === actorId);
  if (effect) return effectCandidates(view, effect);
  if (game.turnPlayerId !== actorId) return [];
  const hiddenCards = view.hand.filter((card) => card.visibility === "hidden");
  const reserve = hiddenCards.length + (view.field.length > 0 ? 1 : 0);
  const candidates = visiblePlayCandidates(game, view, actorId).slice(
    0,
    Math.max(0, MAX_CANDIDATES - reserve),
  );
  for (const hidden of hiddenCards) {
    candidates.push({
      kind: "play",
      commandName: "submitPlay",
      cardIds: [hidden.id],
      mimics: [],
      payload: { cardIds: [hidden.id], mimics: [], blindConfirmed: true },
      authorityJudgedBlind: true,
    });
  }
  if (view.field.length > 0) {
    candidates.push({ kind: "pass", commandName: "submitPass", payload: {} });
  }
  return candidates.slice(0, MAX_CANDIDATES);
}

function safeFallback(candidates: readonly CpuCandidate[]): CpuCandidate | undefined {
  return (
    candidates.find((candidate) => candidate.kind === "play" && !candidate.authorityJudgedBlind) ??
    candidates.find((candidate) => candidate.kind === "pass") ??
    candidates[0]
  );
}

/**
 * A blind play can disqualify its owner. Guaranteed-safe blind singles may be
 * ranked normally; probabilistic blind choices stay a last resort.
 */
export function riskFilteredCpuCandidates(
  candidates: readonly CpuCandidate[],
  game?: GameState,
  view?: RoomView,
): readonly CpuCandidate[] {
  const safe = candidates.filter(
    (candidate) =>
      !candidate.authorityJudgedBlind ||
      (game !== undefined &&
        view !== undefined &&
        blindPlaySuccessProbability(game, view, candidate) >= 1 - Number.EPSILON),
  );
  return safe.length > 0 ? safe : candidates;
}

function targetCardCounts(candidate: CpuCandidate, view: RoomView): number[] {
  const targets = new Set(candidateTargetIds(candidate));
  return view.players.filter((player) => targets.has(player.id)).map((player) => player.cardCount);
}

/** A fair-information tactical prior used both by self-play and browser inference. */
export function scoreCpuCandidateTactics(
  game: GameState,
  view: RoomView,
  actorId: string,
  candidate: CpuCandidate,
): number {
  const cards = candidateCards(candidate, view);
  const knownRanks = cards.map(visibleRank).filter((rank): rank is PhysicalRank => Boolean(rank));
  const hiddenCount = cards.filter((card) => card.visibility === "hidden").length;
  const reversed = strengthIsReversed(view.revolution, view.jackBack);
  const opponentCounts = view.players
    .filter((player) => player.id !== actorId && player.status === "active")
    .map((player) => player.cardCount);
  const leaderCount = Math.min(...opponentCounts, 54);

  if (candidate.kind === "pass") {
    return -2 - (leaderCount <= 2 ? 16 : 0) + (view.hand.some((card) => card.blind) ? 1 : 0);
  }
  if (candidate.kind === "joker-mimic") {
    const mimicRanks = candidate.mimics?.map((mimic) => mimic.rank) ?? [];
    return (
      2 -
      mimicRanks.reduce((sum, rank) => sum + normalizedStrength(rank, reversed), 0) /
        Math.max(1, mimicRanks.length)
    );
  }
  if (candidate.kind === "effect") {
    const targetCounts = targetCardCounts(candidate, view);
    const targetLeaderBonus = targetCounts.some((count) => count === leaderCount) ? 5 : 0;
    const averageStrength =
      knownRanks.reduce((sum, rank) => sum + normalizedStrength(rank, reversed), 0) /
      Math.max(1, knownRanks.length);
    if (candidate.commandName === "resolveDiscard") {
      return 30 + hiddenCount * 14 + (1 - averageStrength) * 5;
    }
    if (candidate.commandName === "resolveGive") {
      return 18 + hiddenCount * 12 + (1 - averageStrength) * 5 + targetLeaderBonus;
    }
    if (candidate.commandName === "resolveSteal") {
      return 8 + averageStrength * 7 + targetLeaderBonus;
    }
    if (candidate.commandName === "resolveCollect") {
      return -8 + averageStrength * 6;
    }
    if (candidate.commandName === "resolveBomber") {
      const bombRanks = new Set(
        (Array.isArray(candidate.payload.ranks) ? candidate.payload.ranks : []).map((rank) =>
          String(rank).toUpperCase() === "JOKER" ? "JOKER" : String(rank),
        ),
      );
      const ownLoss = view.hand.filter((card) => {
        const rank = visibleRank(card);
        return rank ? bombRanks.has(rank) : false;
      }).length;
      const publicOpponentLoss = view.players
        .filter((player) => player.id !== actorId)
        .flatMap((player) => player.cards ?? [])
        .filter((card) => {
          const rank = visibleRank(card);
          return rank ? bombRanks.has(rank) : false;
        }).length;
      return 10 + publicOpponentLoss * 8 - ownLoss * 7;
    }
    return 0;
  }

  const cardCount = candidateCardIds(candidate).length;
  const remaining = Math.max(0, view.hand.length - cardCount);
  const selectedIds = new Set(candidateCardIds(candidate));
  const remainingCards = view.hand.filter((card) => !selectedIds.has(card.id));
  const forbiddenSingleton =
    remainingCards.length === 1 &&
    (visibleRank(remainingCards[0]!) === "2" || visibleRank(remainingCards[0]!) === "JOKER");
  const averageStrength =
    knownRanks.reduce((sum, rank) => sum + normalizedStrength(rank, reversed), 0) /
    Math.max(1, knownRanks.length);
  let score = cardCount * 9 - averageStrength * (view.field.length === 0 ? 4 : 2);
  if (remaining === 0) score += 80;
  if (forbiddenSingleton) score -= 140;
  if (remaining > 0 && knownRanks.some((rank) => rank === "2" || rank === "JOKER")) score += 7;
  if (knownRanks.includes("JOKER")) score -= 8;
  score += knownRanks.filter((rank) => rank === "8").length * 14;
  score += knownRanks.filter((rank) => rank === "10").length * 10;
  score += knownRanks.filter((rank) => rank === "7").length * 7;
  score += knownRanks.filter((rank) => rank === "Q").length * 5;
  score += knownRanks.filter((rank) => rank === "A").length * 3;
  score -= knownRanks.filter((rank) => rank === "K").length * 3;
  if (cardCount >= 4) score += 7;
  if (candidate.authorityJudgedBlind) {
    const success = blindPlaySuccessProbability(game, view, candidate);
    score += success >= 1 - Number.EPSILON ? 13 : -70 * (1 - success);
    if (remaining > 0) score += 7;
  }
  if (leaderCount <= 2 && view.field.length > 0) score += 8;
  return score;
}

function standardize(values: readonly number[]): number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
  const deviation = Math.sqrt(variance);
  return deviation < 1e-6 ? values.map(() => 0) : values.map((value) => (value - mean) / deviation);
}

/**
 * Chooses among authority-validated candidates with the trained CandidateScorer neural network.
 * The model never sees another player's hidden face; rule validation remains authoritative.
 */
export function chooseCpuDecision(
  game: GameState,
  view: RoomView,
  actorId: string,
): CpuDecision | undefined {
  const legalCandidates = legalCpuCandidates(game, view, actorId);
  if (legalCandidates.length === 0) return undefined;
  const candidates = riskFilteredCpuCandidates(legalCandidates, game, view);
  try {
    const state = encodeCpuState(view, actorId);
    const neuralScores = scoreCpuCandidates(
      state,
      candidates.map((candidate) => encodeCpuAction(candidate, view, actorId)),
    );
    const tacticalScores = candidates.map((candidate) =>
      scoreCpuCandidateTactics(game, view, actorId, candidate),
    );
    const normalizedNeural = standardize(neuralScores);
    const normalizedTactical = standardize(tacticalScores);
    const scores = normalizedNeural.map(
      (score, index) => score + (normalizedTactical[index] ?? 0) * 1.15,
    );
    let selectedIndex = 0;
    for (let index = 1; index < scores.length; index += 1) {
      if (
        (scores[index] ?? Number.NEGATIVE_INFINITY) >
        (scores[selectedIndex] ?? Number.NEGATIVE_INFINITY)
      ) {
        selectedIndex = index;
      }
    }
    const selected = candidates[selectedIndex]!;
    return {
      name: selected.commandName,
      payload: selected.payload,
      policy: "nn",
      score: scores[selectedIndex] ?? Number.NEGATIVE_INFINITY,
    };
  } catch {
    const selected = safeFallback(candidates);
    return selected
      ? { name: selected.commandName, payload: selected.payload, policy: "fallback" }
      : undefined;
  }
}
