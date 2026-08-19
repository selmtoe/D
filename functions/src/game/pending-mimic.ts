import type { JokerMimic } from "@daifugo/rules";
import type { RoomDocument } from "../model.js";
import { CommandError } from "../security/command-error.js";
import { gameIsFinished, runGameCommand } from "./rules-adapter.js";

function normalized(mimics: readonly JokerMimic[]): string {
  return JSON.stringify(
    [...mimics]
      .sort((left, right) => left.cardId.localeCompare(right.cardId))
      .map(({ cardId, suit, rank }) => ({ cardId, suit, rank })),
  );
}

export function candidateIsAllowed(
  candidates: readonly JokerMimic[][],
  declaration: readonly JokerMimic[],
): boolean {
  const selected = normalized(declaration);
  return candidates.some((candidate) => normalized(candidate) === selected);
}

export function applyPendingMimic(
  room: RoomDocument,
  declaration: readonly JokerMimic[],
  actionId: string,
  nowMs: number,
): string[] {
  const pending = room.pendingMimic;
  if (!pending || !room.game) {
    throw new CommandError("failed-precondition", "There is no pending Joker declaration.");
  }
  if (!candidateIsAllowed(pending.candidates, declaration)) {
    throw new CommandError(
      "invalid-argument",
      "The Joker declaration is not one of the authoritative legal candidates.",
    );
  }
  const applied = runGameCommand(
    room.game,
    {
      type: "play",
      actionId,
      expectedVersion: room.game.version,
      playerId: pending.actorUid,
      cardIds: pending.cardIds,
      jokerMimics: declaration,
      blindConfirmed: true,
    },
    nowMs,
  );
  room.game = applied.state;
  room.pendingMimic = null;
  room.status = gameIsFinished(applied.state) ? "finished" : "playing";
  return applied.eventTypes;
}

export function applyDefaultPendingMimic(
  room: RoomDocument,
  actionId: string,
  nowMs: number,
): string[] {
  const candidate = room.pendingMimic?.candidates[0];
  if (!candidate) {
    throw new CommandError("internal", "A pending Joker declaration has no legal candidate.");
  }
  return applyPendingMimic(room, candidate, actionId, nowMs);
}
