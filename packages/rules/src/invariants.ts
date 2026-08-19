import type { Card, GameState } from "./types.js";

export interface InvariantReport {
  valid: boolean;
  errors: string[];
}

export function checkStateInvariants(state: GameState): InvariantReport {
  const errors: string[] = [];
  const zones: Array<{ zone: string; cards: Card[] }> = [
    { zone: "deck", cards: state.deck },
    ...state.players.map((player) => ({
      zone: `hand:${player.id}`,
      cards: player.hand.map((entry) => entry.card),
    })),
    ...state.trickHistory.map((play, index) => ({
      zone: `trick:${index}`,
      cards: play.cards.map((entry) => entry.card),
    })),
    ...(state.pile === null
      ? []
      : [{ zone: "pile", cards: state.pile.cards.map((entry) => entry.card) }]),
    { zone: "discard", cards: state.discard },
  ];
  const location = new Map<string, string>();
  for (const zone of zones) {
    for (const card of zone.cards) {
      const previous = location.get(card.id);
      if (previous !== undefined)
        errors.push(`card ${card.id} exists in both ${previous} and ${zone.zone}`);
      else location.set(card.id, zone.zone);
    }
  }
  if (location.size !== 54)
    errors.push(`expected 54 unique cards across zones, found ${location.size}`);
  if (state.pendingEffect !== null && state.effectBatch === null)
    errors.push("a pending effect requires an effect batch");
  if (
    state.effectBatch !== null &&
    state.pendingEffect !== null &&
    state.pendingEffect.actorId !== state.effectBatch.actorId
  ) {
    errors.push("pending effect actor differs from batch actor");
  }
  const activeIds = new Set(
    state.players.filter((player) => player.status === "active").map((player) => player.id),
  );
  if (
    state.phase === "playing" &&
    state.pendingEffect === null &&
    state.turnPlayerId !== null &&
    !activeIds.has(state.turnPlayerId)
  ) {
    errors.push("turn player is not active");
  }
  return { valid: errors.length === 0, errors };
}

export function assertStateInvariants(state: GameState): void {
  const report = checkStateInvariants(state);
  if (!report.valid) throw new Error(report.errors.join("; "));
}
