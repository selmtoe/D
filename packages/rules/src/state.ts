import type { GameEvent, GameState, PlayerState } from "./types.js";

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

export function playerById(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((player) => player.status === "active");
}

export function nextActivePlayer(
  state: GameState,
  fromPlayerId: string,
  steps = 1,
): PlayerState | null {
  const from = playerById(state, fromPlayerId);
  const active = activePlayers(state);
  if (from === undefined || active.length === 0 || steps < 1) return null;
  let seat = from.seat;
  let found = 0;
  const limit = state.players.length * (steps + 1);
  for (let attempt = 0; attempt < limit; attempt += 1) {
    seat = (seat + state.direction + state.players.length) % state.players.length;
    const candidate = state.players.find((player) => player.seat === seat);
    if (candidate?.status === "active") {
      found += 1;
      if (found === steps) return candidate;
    }
  }
  throw new Error("active-player traversal invariant violated");
}

function usedRanks(state: GameState): Set<number> {
  return new Set(state.players.flatMap((player) => (player.rank === null ? [] : [player.rank])));
}

export function assignFinishGroup(
  state: GameState,
  playerIds: readonly string[],
  reason: "played" | "effect" | "last-standing",
  events: GameEvent[],
): number | null {
  const players = playerIds
    .map((id) => playerById(state, id))
    .filter((player): player is PlayerState => player?.status === "active");
  if (players.length === 0) return null;
  const used = usedRanks(state);
  let rank = state.nextFinishRank;
  while (used.has(rank)) rank += 1;
  for (const player of players) {
    player.status = "finished";
    player.rank = rank;
    player.finishReason = reason;
  }
  state.nextFinishRank = rank + players.length;
  while (used.has(state.nextFinishRank)) state.nextFinishRank += 1;
  events.push({ type: "finished", playerIds: players.map((player) => player.id), rank });
  state.log.push({
    id: `log-${state.log.length + 1}`,
    type: "finished",
    playerIds: players.map((player) => player.id),
    detail: `${reason}: rank ${rank}`,
  });
  return rank;
}

export function reserveDisqualificationRank(
  state: GameState,
  player: PlayerState,
  events: GameEvent[],
): number {
  const used = usedRanks(state);
  let rank = state.players.length;
  while (used.has(rank) && rank > 0) rank -= 1;
  if (rank === 0) throw new Error("no rank remains for disqualification");
  player.status = "disqualified";
  player.rank = rank;
  player.finishReason = "disqualified";
  events.push({ type: "disqualified", playerId: player.id, rank });
  state.log.push({
    id: `log-${state.log.length + 1}`,
    type: "disqualified",
    playerIds: [player.id],
    detail: `reserved bottom rank ${rank}`,
  });
  return rank;
}

export function finishGameIfReady(state: GameState, events: GameEvent[]): boolean {
  if (state.effectBatch !== null) return false;
  const active = activePlayers(state);
  if (active.length > 1) return false;
  if (active.length === 1) assignFinishGroup(state, [active[0]!.id], "last-standing", events);
  state.phase = "finished";
  state.turnPlayerId = null;
  state.pendingEffect = null;
  state.effectBatch = null;
  events.push({ type: "game-finished" });
  state.log.push({
    id: `log-${state.log.length + 1}`,
    type: "game-finished",
    playerIds: [],
    detail: "all ranks assigned",
  });
  return true;
}
