import { buildEffectQueue } from "./effects.js";
import {
  isSpadeThreeReturn,
  PlayValidationError,
  rankIndex,
  recomputeBinding,
  validatePlayForState,
  type ParsedPlay,
} from "./plays.js";
import {
  activePlayers,
  assignFinishGroup,
  cloneState,
  finishGameIfReady,
  nextActivePlayer,
  playerById,
  reserveDisqualificationRank,
} from "./state.js";
import {
  RANKS,
  type BombEffect,
  type CardTransferSelection,
  type CommandResult,
  type DiscardEffect,
  type EffectSelection,
  type GameCommand,
  type GameEvent,
  type GameState,
  type GiveEffect,
  type FlushReason,
  type PendingEffect,
  type PhysicalRank,
  type PlayCommand,
  type PlayedGroup,
  type RecoverEffect,
  type RuleError,
  type StealEffect,
} from "./types.js";

function failure(state: GameState, code: RuleError["code"], message: string): CommandResult {
  return { ok: false, state, error: { code, message } };
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function flushTrick(state: GameState, reason: FlushReason, events: GameEvent[]): void {
  const plays = [...state.trickHistory, ...(state.pile === null ? [] : [state.pile])];
  state.discard.push(...plays.flatMap((play) => play.cards.map((card) => card.card)));
  const leader = state.lastPlayerId;
  state.pile = null;
  state.trickHistory = [];
  state.binding = [];
  state.jackBack = false;
  state.passedSincePlay = [];
  if (leader !== null) {
    const leaderState = playerById(state, leader);
    state.turnPlayerId =
      leaderState?.status === "active" ? leader : (nextActivePlayer(state, leader)?.id ?? null);
  } else {
    state.turnPlayerId = activePlayers(state)[0]?.id ?? null;
  }
  events.push({ type: "trick-flushed", reason });
  state.log.push({
    id: `log-${state.log.length + 1}`,
    type: "trick-flushed",
    playerIds: leader === null ? [] : [leader],
    detail: reason,
  });
}

function advanceAfterPass(
  state: GameState,
  passerId: string,
  events: GameEvent[],
  allowEmpty: boolean,
): RuleError | null {
  if (state.pile === null && !allowEmpty)
    return { code: "PASS_NOT_ALLOWED", message: "passing is not allowed on an empty pile" };
  if (!state.passedSincePlay.includes(passerId)) state.passedSincePlay.push(passerId);
  events.push({ type: "passed", playerId: passerId });
  if (state.pile === null) {
    state.turnPlayerId = nextActivePlayer(state, passerId)?.id ?? null;
    return null;
  }
  const next = nextActivePlayer(state, passerId);
  if (next === null) return null;
  const last = state.lastPlayerId === null ? undefined : playerById(state, state.lastPlayerId);
  const shouldFlush =
    (last?.status === "active" && next.id === last.id) ||
    (last?.status !== "active" &&
      activePlayers(state).every((player) => state.passedSincePlay.includes(player.id)));
  if (shouldFlush) flushTrick(state, "passes", events);
  else state.turnPlayerId = next.id;
  return null;
}

function effectHasTargets(state: GameState, effect: PendingEffect): boolean {
  const actor = playerById(state, effect.actorId);
  if (actor === undefined) return false;
  switch (effect.type) {
    case "recover":
      return state.discard.length > 0;
    case "steal":
      return state.players.some(
        (player) => player.id !== actor.id && player.status === "active" && player.hand.length > 0,
      );
    case "give":
      return (
        actor.hand.length > 0 &&
        state.players.some((player) => player.id !== actor.id && player.status === "active")
      );
    case "discard":
      return actor.hand.length > 0;
    case "bomb":
      return true;
  }
}

function completeBatch(state: GameState, events: GameEvent[]): void {
  const batch = state.effectBatch;
  if (batch === null) return;
  const actor = playerById(state, batch.actorId);
  if (actor?.status === "active" && actor.hand.length === 0)
    assignFinishGroup(state, [actor.id], "played", events);
  const skipCount = batch.skipCount;
  const flushReason = batch.flushReason;
  state.effectBatch = null;
  state.pendingEffect = null;
  if (finishGameIfReady(state, events)) return;
  if (flushReason !== null) {
    flushTrick(state, flushReason, events);
    return;
  }
  const steps = skipCount + 1;
  const target = nextActivePlayer(state, batch.actorId, steps);
  if (target === null) return;
  if (skipCount > 0 && actor?.status === "active" && target.id === actor.id) {
    flushTrick(state, "skip-cycle", events);
  } else {
    state.turnPlayerId = target.id;
  }
}

function processEffectQueue(state: GameState, events: GameEvent[]): void {
  const batch = state.effectBatch;
  if (batch === null || state.pendingEffect !== null) return;
  while (batch.nextEffectIndex < batch.effects.length) {
    const effect = batch.effects[batch.nextEffectIndex]!;
    batch.nextEffectIndex += 1;
    switch (effect.type) {
      case "toggle-jack-back":
        state.jackBack = !state.jackBack;
        break;
      case "toggle-revolution":
        state.revolution = !state.revolution;
        break;
      case "reverse":
        state.direction = state.direction === 1 ? -1 : 1;
        break;
      case "skip":
        batch.skipCount += effect.count;
        break;
      case "flush":
        batch.flushReason = effect.reason;
        break;
      case "recover":
      case "steal":
      case "give":
      case "discard":
      case "bomb":
        if (!effectHasTargets(state, effect)) break;
        state.pendingEffect = effect;
        events.push({ type: "effect-pending", effect });
        return;
    }
  }
  completeBatch(state, events);
}

function selectedTransferCards(transfers: readonly CardTransferSelection[]): string[] {
  return transfers.flatMap((transfer) => transfer.cardIds);
}

function resolveRecover(
  state: GameState,
  effect: RecoverEffect,
  selection: EffectSelection,
): RuleError | null {
  if (selection.type !== "recover" || !unique(selection.cardIds))
    return { code: "INVALID_SELECTION", message: "invalid K recovery selection" };
  const required = Math.min(effect.count, state.discard.length);
  if (selection.cardIds.length !== required)
    return { code: "INVALID_SELECTION", message: `K recovery requires exactly ${required} cards` };
  const actor = playerById(state, effect.actorId)!;
  for (const id of selection.cardIds) {
    const index = state.discard.findIndex((card) => card.id === id);
    if (index < 0)
      return { code: "INVALID_SELECTION", message: `discard card ${id} does not exist` };
    const [card] = state.discard.splice(index, 1);
    actor.hand.push({ card: card!, blind: false });
  }
  return null;
}

function validateTransferTargets(
  state: GameState,
  actorId: string,
  transfers: readonly CardTransferSelection[],
): RuleError | null {
  if (!unique(selectedTransferCards(transfers)))
    return { code: "INVALID_SELECTION", message: "a card may be selected only once" };
  if (!unique(transfers.map((transfer) => transfer.playerId)))
    return { code: "INVALID_SELECTION", message: "combine selections for the same target" };
  for (const transfer of transfers) {
    const target = playerById(state, transfer.playerId);
    if (target === undefined || target.id === actorId || target.status !== "active") {
      return {
        code: "INVALID_SELECTION",
        message: "transfer targets must be other active players",
      };
    }
  }
  return null;
}

function resolveSteal(
  state: GameState,
  effect: StealEffect,
  selection: EffectSelection,
  events: GameEvent[],
): RuleError | null {
  if (selection.type !== "steal")
    return { code: "INVALID_SELECTION", message: "invalid A steal selection" };
  const targetError = validateTransferTargets(state, effect.actorId, selection.transfers);
  if (targetError !== null) return targetError;
  const available = state.players
    .filter((player) => player.id !== effect.actorId && player.status === "active")
    .reduce((sum, player) => sum + player.hand.length, 0);
  const required = Math.min(effect.count, available);
  if (selectedTransferCards(selection.transfers).length !== required) {
    return { code: "INVALID_SELECTION", message: `A steal requires exactly ${required} cards` };
  }
  const actor = playerById(state, effect.actorId)!;
  for (const transfer of selection.transfers) {
    const target = playerById(state, transfer.playerId)!;
    for (const id of transfer.cardIds) {
      const index = target.hand.findIndex((entry) => entry.card.id === id);
      if (index < 0) return { code: "INVALID_SELECTION", message: `target does not own ${id}` };
      const [entry] = target.hand.splice(index, 1);
      actor.hand.push({ card: entry!.card, blind: false });
    }
  }
  const emptied = state.players
    .filter(
      (player) => player.id !== actor.id && player.status === "active" && player.hand.length === 0,
    )
    .map((player) => player.id);
  assignFinishGroup(state, emptied, "effect", events);
  return null;
}

function resolveGive(
  state: GameState,
  effect: GiveEffect,
  selection: EffectSelection,
): RuleError | null {
  if (selection.type !== "give")
    return { code: "INVALID_SELECTION", message: "invalid 7 give selection" };
  const targetError = validateTransferTargets(state, effect.actorId, selection.transfers);
  if (targetError !== null) return targetError;
  const actor = playerById(state, effect.actorId)!;
  const required = state.players.some(
    (player) => player.id !== actor.id && player.status === "active",
  )
    ? Math.min(effect.count, actor.hand.length)
    : 0;
  const ids = selectedTransferCards(selection.transfers);
  if (ids.length !== required)
    return { code: "INVALID_SELECTION", message: `7 give requires exactly ${required} cards` };
  const moves = selection.transfers.map((transfer) => ({
    target: playerById(state, transfer.playerId)!,
    cards: transfer.cardIds.map((id) => {
      const entry = actor.hand.find((candidate) => candidate.card.id === id);
      if (entry === undefined)
        throw new PlayValidationError("UNKNOWN_CARD", `actor does not own ${id}`);
      return entry;
    }),
  }));
  for (const move of moves) {
    for (const entry of move.cards) {
      actor.hand.splice(
        actor.hand.findIndex((candidate) => candidate.card.id === entry.card.id),
        1,
      );
      move.target.hand.push({ card: entry.card, blind: false });
    }
  }
  return null;
}

function resolveDiscard(
  state: GameState,
  effect: DiscardEffect,
  selection: EffectSelection,
): RuleError | null {
  if (selection.type !== "discard" || !unique(selection.cardIds))
    return { code: "INVALID_SELECTION", message: "invalid 10 discard selection" };
  const actor = playerById(state, effect.actorId)!;
  const required = Math.min(effect.count, actor.hand.length);
  if (selection.cardIds.length !== required)
    return { code: "INVALID_SELECTION", message: `10 discard requires exactly ${required} cards` };
  for (const id of selection.cardIds) {
    const index = actor.hand.findIndex((entry) => entry.card.id === id);
    if (index < 0) return { code: "INVALID_SELECTION", message: `actor does not own ${id}` };
    const [entry] = actor.hand.splice(index, 1);
    state.discard.push(entry!.card);
  }
  return null;
}

function resolveBomb(
  state: GameState,
  effect: BombEffect,
  selection: EffectSelection,
  events: GameEvent[],
): RuleError | null {
  const validRanks: PhysicalRank[] = [...RANKS, "JOKER"];
  if (
    selection.type !== "bomb" ||
    selection.ranks.length !== effect.count ||
    new Set(selection.ranks).size !== selection.ranks.length ||
    selection.ranks.some((rank) => !validRanks.includes(rank))
  ) {
    return {
      code: "INVALID_SELECTION",
      message: `Q bomb requires exactly ${effect.count} distinct valid ranks`,
    };
  }
  const selected = new Set(selection.ranks);
  for (const player of activePlayers(state)) {
    const survivors = [];
    for (const entry of player.hand) {
      if (selected.has(entry.card.rank)) state.discard.push(entry.card);
      else survivors.push(entry);
    }
    player.hand = survivors;
  }
  const actorCanGainLater =
    state.effectBatch?.effects
      .slice(state.effectBatch.nextEffectIndex)
      .some((queued) => queued.type === "steal" && effectHasTargets(state, queued)) ?? false;
  const emptiedByAtomicBomb = activePlayers(state)
    .filter(
      (player) => player.hand.length === 0 && (player.id !== effect.actorId || !actorCanGainLater),
    )
    .map((player) => player.id);
  assignFinishGroup(state, emptiedByAtomicBomb, "effect", events);
  return null;
}

function resolvePendingSelection(
  state: GameState,
  selection: EffectSelection,
  events: GameEvent[],
): RuleError | null {
  const effect = state.pendingEffect;
  if (effect === null) return { code: "INVALID_EFFECT", message: "there is no pending effect" };
  try {
    let error: RuleError | null;
    switch (effect.type) {
      case "recover":
        error = resolveRecover(state, effect, selection);
        break;
      case "steal":
        error = resolveSteal(state, effect, selection, events);
        break;
      case "give":
        error = resolveGive(state, effect, selection);
        break;
      case "discard":
        error = resolveDiscard(state, effect, selection);
        break;
      case "bomb":
        error = resolveBomb(state, effect, selection, events);
        break;
    }
    if (error !== null) return error;
  } catch (error) {
    return {
      code: "INVALID_SELECTION",
      message: error instanceof Error ? error.message : "invalid selection",
    };
  }
  state.pendingEffect = null;
  processEffectQueue(state, events);
  return null;
}

export function deterministicEffectSelection(
  state: GameState,
  effect: PendingEffect,
): EffectSelection {
  const actor = playerById(state, effect.actorId)!;
  switch (effect.type) {
    case "recover":
      return {
        type: "recover",
        cardIds: state.discard.slice(0, effect.count).map((card) => card.id),
      };
    case "steal": {
      let remaining = effect.count;
      const transfers: CardTransferSelection[] = [];
      for (const target of state.players.filter(
        (player) => player.id !== actor.id && player.status === "active",
      )) {
        const cardIds = target.hand.slice(0, remaining).map((entry) => entry.card.id);
        if (cardIds.length > 0) transfers.push({ playerId: target.id, cardIds });
        remaining -= cardIds.length;
      }
      return { type: "steal", transfers };
    }
    case "give": {
      const target = state.players.find(
        (player) => player.id !== actor.id && player.status === "active",
      );
      return {
        type: "give",
        transfers:
          target === undefined
            ? []
            : [
                {
                  playerId: target.id,
                  cardIds: actor.hand.slice(0, effect.count).map((entry) => entry.card.id),
                },
              ],
      };
    }
    case "discard":
      return {
        type: "discard",
        cardIds: actor.hand.slice(0, effect.count).map((entry) => entry.card.id),
      };
    case "bomb":
      return {
        type: "bomb",
        ranks: ([...RANKS, "JOKER"] as PhysicalRank[]).slice(0, effect.count),
      };
  }
}

function applyPlay(state: GameState, command: PlayCommand, events: GameEvent[]): RuleError | null {
  const player = playerById(state, command.playerId)!;
  const selectedBlind = command.cardIds.some(
    (id) => player.hand.find((entry) => entry.card.id === id)?.blind === true,
  );
  if (selectedBlind && command.blindConfirmed !== true) {
    return {
      code: "INVALID_PLAY",
      message: "a blind submission requires explicit irreversible confirmation",
    };
  }
  let parsed: ParsedPlay;
  try {
    parsed = validatePlayForState(state, player.id, command.cardIds, command.jokerMimics ?? []);
  } catch (error) {
    if (selectedBlind && state.mode === "blind" && error instanceof PlayValidationError) {
      disqualifyPlayer(state, player.id, events);
      return null;
    }
    if (error instanceof PlayValidationError) return { code: error.code, message: error.message };
    throw error;
  }
  const previous = state.pile;
  const spadeThree = previous !== null && isSpadeThreeReturn(parsed, previous);
  if (previous !== null) state.trickHistory.push(previous);
  for (const card of parsed.cards) {
    const index = player.hand.findIndex((entry) => entry.card.id === card.card.id);
    player.hand.splice(index, 1);
  }
  const played: PlayedGroup = {
    id: command.actionId,
    playerId: player.id,
    kind: parsed.kind,
    cards: parsed.cards,
  };
  state.pile = played;
  state.binding = previous === null ? [] : recomputeBinding(previous, parsed);
  state.lastPlayerId = player.id;
  state.passedSincePlay = [];
  state.firstPlay = false;
  state.effectBatch = {
    actorId: player.id,
    playId: command.actionId,
    effects: buildEffectQueue(state, parsed, player.id, command.actionId, spadeThree),
    nextEffectIndex: 0,
    skipCount: 0,
    flushReason: null,
  };
  events.push({ type: "played", playerId: player.id, play: played });
  processEffectQueue(state, events);
  return null;
}

function disqualifyPlayer(
  state: GameState,
  playerId: string,
  events: GameEvent[],
): RuleError | null {
  const player = playerById(state, playerId);
  if (player === undefined) return { code: "UNKNOWN_PLAYER", message: "unknown player" };
  if (player.status !== "active")
    return { code: "NOT_ACTIVE", message: "only an active player can be disqualified" };
  state.discard.push(...player.hand.map((entry) => entry.card));
  player.hand = [];
  reserveDisqualificationRank(state, player, events);
  if (state.firstPlay && state.pile === null) state.firstPlay = false;
  if (state.effectBatch?.actorId === playerId) {
    state.pendingEffect = null;
    state.effectBatch = null;
  }
  if (finishGameIfReady(state, events)) return null;
  if (state.turnPlayerId === playerId || state.turnPlayerId === null) {
    state.turnPlayerId = nextActivePlayer(state, playerId)?.id ?? null;
  }
  if (
    state.pile !== null &&
    state.lastPlayerId === playerId &&
    activePlayers(state).every((active) => state.passedSincePlay.includes(active.id))
  ) {
    flushTrick(state, "passes", events);
  }
  return null;
}

function weakestVisibleOpening(
  state: GameState,
  playerId: string,
): { cardIds: string[]; blindConfirmed?: boolean } | null {
  const player = playerById(state, playerId)!;
  if (state.firstPlay) {
    const diamondThree = player.hand.find(
      (entry) => entry.card.suit === "diamond" && entry.card.rank === "3",
    );
    return diamondThree === undefined
      ? null
      : { cardIds: [diamondThree.card.id], blindConfirmed: diamondThree.blind };
  }
  const candidates = player.hand
    .filter((entry) => !entry.blind)
    .sort((a, b) => {
      const aRank = a.card.rank === "JOKER" ? RANKS.length : rankIndex(a.card.rank);
      const bRank = b.card.rank === "JOKER" ? RANKS.length : rankIndex(b.card.rank);
      return aRank - bRank;
    });
  for (const entry of candidates) {
    try {
      validatePlayForState(state, playerId, [entry.card.id]);
      return { cardIds: [entry.card.id] };
    } catch {
      // Keep looking for the weakest legal visible singleton.
    }
  }
  return null;
}

export function applyGameCommand(
  state: GameState,
  command: GameCommand,
  _now = Date.now(),
): CommandResult {
  if (state.appliedActionIds.includes(command.actionId)) return { ok: true, state, events: [] };
  if (command.expectedVersion !== state.version)
    return failure(state, "BAD_VERSION", `expected version ${state.version}`);
  const player = playerById(state, command.playerId);
  if (player === undefined) return failure(state, "UNKNOWN_PLAYER", "unknown player");
  const next = cloneState(state);
  const mutablePlayer = playerById(next, command.playerId)!;
  const events: GameEvent[] = [];
  let error: RuleError | null = null;

  if (command.type === "resolve-effect") {
    if (
      next.pendingEffect === null ||
      next.pendingEffect.id !== command.effectId ||
      next.pendingEffect.actorId !== command.playerId
    ) {
      return failure(
        state,
        "INVALID_EFFECT",
        "the effect id or actor does not match the pending effect",
      );
    }
    error = resolvePendingSelection(next, command.selection, events);
  } else if (command.type === "disqualify") {
    error = disqualifyPlayer(next, command.playerId, events);
  } else if (command.type === "timeout") {
    mutablePlayer.timeoutWarnings += 1;
    if (next.pendingEffect !== null) {
      if (next.pendingEffect.actorId !== command.playerId)
        return failure(state, "INVALID_EFFECT", "only the pending actor can time out");
      error = resolvePendingSelection(
        next,
        deterministicEffectSelection(next, next.pendingEffect),
        events,
      );
    } else {
      if (next.turnPlayerId !== command.playerId)
        return failure(state, "NOT_YOUR_TURN", "it is not this player's turn");
      if (next.pile !== null) error = advanceAfterPass(next, command.playerId, events, false);
      else {
        const opening = weakestVisibleOpening(next, command.playerId);
        if (opening === null) error = advanceAfterPass(next, command.playerId, events, true);
        else
          error = applyPlay(
            next,
            {
              ...command,
              type: "play",
              cardIds: opening.cardIds,
              ...(opening.blindConfirmed === undefined
                ? {}
                : { blindConfirmed: opening.blindConfirmed }),
            },
            events,
          );
      }
    }
  } else {
    if (mutablePlayer.status !== "active")
      return failure(state, "NOT_ACTIVE", "only active players may act");
    if (next.pendingEffect !== null || next.effectBatch !== null)
      return failure(state, "EFFECT_PENDING", "all forced effects must finish first");
    if (next.turnPlayerId !== command.playerId)
      return failure(state, "NOT_YOUR_TURN", "it is not this player's turn");
    if (command.type === "play") error = applyPlay(next, command, events);
    else {
      const exceptionalEmptyPass =
        next.pile === null &&
        mutablePlayer.hand.every((entry) => entry.card.rank === "2" || entry.card.rank === "JOKER");
      error = advanceAfterPass(next, command.playerId, events, exceptionalEmptyPass);
    }
  }
  if (error !== null) return failure(state, error.code, error.message);
  next.version += 1;
  next.appliedActionIds.push(command.actionId);
  return { ok: true, state: next, events };
}
