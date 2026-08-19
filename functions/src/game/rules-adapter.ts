import { randomBytes } from "node:crypto";
import {
  applyGameCommand,
  createInitialGameState,
  findLegalJokerMimics,
  type GameCommand,
  type GameState,
} from "@daifugo/rules";
import { CommandError } from "../security/command-error.js";

export interface AppliedGameCommand {
  state: GameState;
  eventTypes: string[];
}

function secureRandom(): number {
  return randomBytes(6).readUIntBE(0, 6) / 0x1_0000_0000_0000;
}

export function createAuthoritativeGame(
  playerIds: string[],
  mode: "normal" | "blind",
  blindCount: number,
  gameId: string,
): GameState {
  return createInitialGameState(playerIds, { mode, blindCount, gameId, rng: secureRandom });
}

export function createCardTokenMap(state: GameState): Record<string, string> {
  const ids = new Set<string>([
    ...state.deck.map((card) => card.id),
    ...state.players.flatMap((player) => player.hand.map((entry) => entry.card.id)),
    ...state.discard.map((card) => card.id),
  ]);
  return Object.fromEntries(
    [...ids].map((id) => [id, `c_${randomBytes(18).toString("base64url")}`]),
  );
}

export function resolveCardToken(cardTokens: Record<string, string>, opaqueId: string): string {
  const match = Object.entries(cardTokens).find(([, token]) => token === opaqueId);
  if (!match) {
    throw new CommandError("invalid-argument", "The opaque card id is not valid for this game.");
  }
  return match[0];
}

export function resolveCommandCardTokens(
  value: unknown,
  cardTokens: Record<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveCommandCardTokens(item, cardTokens));
  }
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "cardId" && typeof item === "string") {
      result[key] = resolveCardToken(cardTokens, item);
    } else if (key === "cardIds" && Array.isArray(item)) {
      result[key] = item.map((id) => {
        if (typeof id !== "string") {
          throw new CommandError("invalid-argument", "Every opaque card id must be a string.");
        }
        return resolveCardToken(cardTokens, id);
      });
    } else {
      result[key] = resolveCommandCardTokens(item, cardTokens);
    }
  }
  return result;
}

export function selectedBlindJokers(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
): string[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return [];
  return cardIds.filter((id) => {
    const entry = player.hand.find((candidate) => candidate.card.id === id);
    return entry?.blind === true && entry.card.rank === "JOKER";
  });
}

/**
 * A blind Joker needs the committed reveal/declaration step only when it is
 * mixed with at least one physical non-Joker. A raw Joker-only group (including
 * a blind Joker paired with the other Joker) is legal without any mimic.
 */
export function requiresBlindJokerMimicDeclaration(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
): boolean {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return false;
  const selected = cardIds.map((id) => player.hand.find((candidate) => candidate.card.id === id));
  return (
    selected.some((entry) => entry?.blind === true && entry.card.rank === "JOKER") &&
    selected.some((entry) => entry !== undefined && entry.card.rank !== "JOKER")
  );
}

export function selectionContainsBlindCard(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
): boolean {
  const player = state.players.find((candidate) => candidate.id === playerId);
  return player?.hand.some((entry) => entry.blind && cardIds.includes(entry.card.id)) ?? false;
}

export function legalJokerMimicCandidates(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
) {
  return findLegalJokerMimics(state, playerId, cardIds);
}

function eventType(event: unknown): string {
  if (typeof event === "string") return event.slice(0, 64);
  if (typeof event === "object" && event !== null && "type" in event) {
    return String((event as { type: unknown }).type).slice(0, 64);
  }
  return "game_event";
}

export function runGameCommand(
  state: GameState,
  command: Record<string, unknown>,
  nowMs: number,
): AppliedGameCommand {
  const result = applyGameCommand(state, command as unknown as GameCommand, nowMs);
  if (!result.ok) {
    const error = result.error;
    const message =
      typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "The game command is illegal in the current state.";
    throw new CommandError("failed-precondition", message, {
      ruleError:
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "illegal-command",
    });
  }
  return { state: result.state, eventTypes: result.events.map(eventType) };
}

export function disqualifyGamePlayer(
  state: GameState,
  playerId: string,
  reason: "blind-failure" | "disconnect" | "exit" | "moderation",
  actionId: string,
  nowMs: number,
): AppliedGameCommand {
  return runGameCommand(
    state,
    {
      type: "disqualify",
      playerId,
      reason,
      actionId,
      expectedVersion: state.version,
    },
    nowMs,
  );
}

export function disqualifyAfterResolvingEffects(
  initialState: GameState,
  playerId: string,
  reason: "blind-failure" | "disconnect" | "exit" | "moderation",
  actionId: string,
  nowMs: number,
): AppliedGameCommand {
  let state = initialState;
  const eventTypes: string[] = [];
  let resolvedEffects = 0;
  while (state.pendingEffect?.actorId === playerId) {
    if (resolvedEffects >= 32) {
      throw new CommandError("internal", "Forced-effect recovery exceeded its safety bound.");
    }
    const resolved = timeoutGame(state, `${actionId}_effect_${resolvedEffects}`, nowMs);
    state = resolved.state;
    eventTypes.push(...resolved.eventTypes);
    resolvedEffects += 1;
  }

  if (!gamePlayerIsActive(state, playerId)) {
    return { state, eventTypes };
  }
  const disqualified = disqualifyGamePlayer(
    state,
    playerId,
    reason,
    `${actionId}_disqualify`,
    nowMs,
  );
  return {
    state: disqualified.state,
    eventTypes: [...eventTypes, ...disqualified.eventTypes],
  };
}

export function timeoutGame(state: GameState, actionId: string, nowMs: number): AppliedGameCommand {
  const playerId = state.pendingEffect?.actorId ?? state.turnPlayerId;
  if (!playerId) {
    throw new CommandError("failed-precondition", "No player owns the expired game deadline.");
  }
  return runGameCommand(
    state,
    {
      type: "timeout",
      playerId,
      actionId,
      expectedVersion: state.version,
    },
    nowMs,
  );
}

export function gameIsFinished(state: GameState): boolean {
  const value = state as unknown as Record<string, unknown>;
  return (
    value.status === "finished" || value.phase === "finished" || value.gameState === "finished"
  );
}

export function gamePlayerIsActive(state: GameState, uid: string): boolean {
  const value = state as unknown as Record<string, unknown>;
  const players = value.players;
  if (Array.isArray(players)) {
    const player = players.find((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return false;
      const object = candidate as Record<string, unknown>;
      return object.id === uid || object.playerId === uid || object.uid === uid;
    });
    if (typeof player === "object" && player !== null) {
      const status = (player as Record<string, unknown>).status;
      return status === undefined || status === "active";
    }
  }
  return true;
}
