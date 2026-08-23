import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import type { EffectSelection } from "@daifugo/rules";
import type { ZodType } from "zod";
import {
  gameIsFinished,
  legalJokerMimicCandidates,
  requiresBlindJokerMimicDeclaration,
  resolveCommandCardTokens,
  runGameCommand,
  selectionContainsBlindCard,
} from "../game/rules-adapter.js";
import { applyPendingMimic } from "../game/pending-mimic.js";
import { appendPublicEvents, appendPublicGameEvents } from "../logging/public-events.js";
import type { RoomDocument } from "../model.js";
import { asHttpsError, CommandError, parseInput } from "../security/command-error.js";
import {
  declareJokerMimicSchema,
  resolveBomberSchema,
  resolveCollectSchema,
  resolveDiscardSchema,
  resolveGiveSchema,
  resolveStealSchema,
  simpleCommandSchema,
  submitPlaySchema,
} from "../security/schemas.js";
import {
  cloneRoom,
  ensureBeforeTurnDeadline,
  executeRoomMutation,
  requirePlayer,
} from "./command-store.js";
import { authenticatedUid } from "./context.js";
import { callableOptions } from "./options.js";

interface BaseInput {
  roomId: string;
  gameId: string | null;
  expectedRevision: number;
  clientActionId: string;
}

function transferHostAfterDisqualification(room: RoomDocument): void {
  const hostState = room.game?.players.find((player) => player.id === room.hostUid);
  if (hostState?.status !== "disqualified") return;
  const successor = Object.values(room.members)
    .filter((member) => {
      if (
        member.uid === room.hostUid ||
        member.role !== "player" ||
        member.connectionStatus !== "connected"
      ) {
        return false;
      }
      return (
        room.game?.players.find((player) => player.id === member.uid)?.status !== "disqualified"
      );
    })
    .sort((left, right) => left.joinedOrder - right.joinedOrder)[0];
  if (successor) room.hostUid = successor.uid;
}

function gameCallable<TInput extends BaseInput>(
  commandName: string,
  schema: ZodType<TInput>,
  buildCommand: (input: TInput, uid: string) => Record<string, unknown>,
  summary: (input: TInput) => Record<string, string | number | boolean | null>,
) {
  return onCall(callableOptions, async (request: CallableRequest<unknown>) => {
    try {
      const uid = authenticatedUid(request);
      const input = parseInput(schema, request.data);
      return await executeRoomMutation(
        {
          uid,
          command: commandName,
          roomId: input.roomId,
          gameId: input.gameId,
          expectedRevision: input.expectedRevision,
          clientActionId: input.clientActionId,
        },
        (original, now) => {
          requirePlayer(original, uid);
          if (original.status !== "playing" || !original.game) {
            throw new CommandError("failed-precondition", "The room is not in an active game.");
          }
          if (original.pendingMimic) {
            throw new CommandError(
              "failed-precondition",
              "A committed blind Joker declaration must be completed first.",
            );
          }
          ensureBeforeTurnDeadline(original, now);
          const built = resolveCommandCardTokens(
            buildCommand(input, uid),
            original.cardTokens,
          ) as Record<string, unknown>;
          const gameCommand: Record<string, unknown> = {
            ...built,
            actionId: input.clientActionId,
            expectedVersion: original.game.version,
            playerId: uid,
          };
          if (built.type === "resolve-effect") {
            gameCommand.effectId = original.game.pendingEffect?.id ?? "";
          }
          const applied = runGameCommand(original.game, gameCommand, now.toMillis());
          const room = cloneRoom(original);
          room.game = applied.state;
          room.status = gameIsFinished(applied.state) ? "finished" : "playing";
          const previousHostUid = room.hostUid;
          transferHostAfterDisqualification(room);
          const selection = gameCommand.selection as EffectSelection | undefined;
          appendPublicGameEvents(room, original.game, applied.events, uid, now, {
            ...(selection ? { selection } : {}),
          });
          if (previousHostUid !== room.hostUid) {
            appendPublicEvents(
              room,
              [
                {
                  type: "host-transferred",
                  actorUid: previousHostUid,
                  detail: { fromHostUid: previousHostUid, toHostUid: room.hostUid },
                },
              ],
              now,
            );
          }
          return {
            room,
            options: {
              resetTurnDeadline: room.status === "playing",
              summary: summary(input),
            },
          };
        },
      );
    } catch (cause) {
      throw asHttpsError(cause);
    }
  });
}

export const submitPlay = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(submitPlaySchema, request.data);
    return await executeRoomMutation(
      {
        uid,
        command: "submitPlay",
        roomId: input.roomId,
        gameId: input.gameId,
        expectedRevision: input.expectedRevision,
        clientActionId: input.clientActionId,
      },
      (original, now) => {
        requirePlayer(original, uid);
        if (original.status !== "playing" || !original.game) {
          throw new CommandError("failed-precondition", "The room is not in an active game.");
        }
        if (original.pendingMimic) {
          throw new CommandError(
            "failed-precondition",
            "A committed blind Joker declaration must be completed first.",
          );
        }
        ensureBeforeTurnDeadline(original, now);
        const actual = resolveCommandCardTokens(
          { cardIds: input.cardIds, jokerMimics: input.mimics },
          original.cardTokens,
        ) as {
          cardIds: string[];
          jokerMimics: Array<{
            cardId: string;
            suit: "spade" | "heart" | "diamond" | "club";
            rank: "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A" | "2";
          }>;
        };
        const containsBlind = selectionContainsBlindCard(original.game, uid, actual.cardIds);
        const blindCardIds =
          original.game.players
            .find((player) => player.id === uid)
            ?.hand.filter((entry) => entry.blind && actual.cardIds.includes(entry.card.id))
            .map((entry) => entry.card.id) ?? [];
        if (containsBlind && !input.blindConfirmed) {
          throw new CommandError(
            "failed-precondition",
            "Blind submissions require explicit irreversible confirmation.",
          );
        }
        const requiresBlindJokerMimic = requiresBlindJokerMimicDeclaration(
          original.game,
          uid,
          actual.cardIds,
        );
        let authoritativeJokerMimics = actual.jokerMimics;
        if (requiresBlindJokerMimic) {
          const candidates = legalJokerMimicCandidates(original.game, uid, actual.cardIds);
          if (candidates.length === 1) {
            authoritativeJokerMimics = candidates[0]!;
          } else if (candidates.length > 1) {
            const room = cloneRoom(original);
            room.pendingMimic = {
              actorUid: uid,
              cardIds: actual.cardIds,
              candidates,
              committedActionId: input.clientActionId,
              createdAt: now,
            };
            return {
              room,
              response: { requiresJokerMimic: true, candidateCount: candidates.length },
              options: {
                resetTurnDeadline: true,
                summary: { cardCount: actual.cardIds.length, jokerMimicPending: true },
              },
            };
          }
        }

        const applied = runGameCommand(
          original.game,
          {
            type: "play",
            cardIds: actual.cardIds,
            // A unique authoritative declaration is applied immediately; only
            // genuinely ambiguous blind Jokers enter the committed reveal stage.
            jokerMimics: requiresBlindJokerMimic ? authoritativeJokerMimics : actual.jokerMimics,
            blindConfirmed: input.blindConfirmed,
            actionId: input.clientActionId,
            expectedVersion: original.game.version,
            playerId: uid,
          },
          now.toMillis(),
        );
        const room = cloneRoom(original);
        room.game = applied.state;
        room.status = gameIsFinished(applied.state) ? "finished" : "playing";
        const previousHostUid = room.hostUid;
        transferHostAfterDisqualification(room);
        appendPublicGameEvents(room, original.game, applied.events, uid, now, {
          blindCardIds,
          ...(containsBlind ? { disqualificationReason: "blind-failure" as const } : {}),
        });
        if (previousHostUid !== room.hostUid) {
          appendPublicEvents(
            room,
            [
              {
                type: "host-transferred",
                actorUid: previousHostUid,
                detail: { fromHostUid: previousHostUid, toHostUid: room.hostUid },
              },
            ],
            now,
          );
        }
        return {
          room,
          options: {
            resetTurnDeadline: room.status === "playing",
            summary: { cardCount: actual.cardIds.length, mimicCount: actual.jokerMimics.length },
          },
        };
      },
    );
  } catch (cause) {
    throw asHttpsError(cause);
  }
});

export const submitPass = gameCallable(
  "submitPass",
  simpleCommandSchema,
  () => ({ type: "pass" }),
  () => ({}),
);

export const declareJokerMimic = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(declareJokerMimicSchema, request.data);
    return await executeRoomMutation(
      {
        uid,
        command: "declareJokerMimic",
        roomId: input.roomId,
        gameId: input.gameId,
        expectedRevision: input.expectedRevision,
        clientActionId: input.clientActionId,
      },
      (original, now) => {
        requirePlayer(original, uid);
        if (original.status !== "playing" || !original.game) {
          throw new CommandError("failed-precondition", "The room is not in an active game.");
        }
        if (original.pendingMimic?.actorUid !== uid) {
          throw new CommandError(
            "permission-denied",
            "Only the committed blind Joker owner may declare its mimic.",
          );
        }
        ensureBeforeTurnDeadline(original, now);
        const resolved = resolveCommandCardTokens(
          { jokerMimics: input.mimics },
          original.cardTokens,
        ) as {
          jokerMimics: Array<{
            cardId: string;
            suit: "spade" | "heart" | "diamond" | "club";
            rank: "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A" | "2";
          }>;
        };
        const room = cloneRoom(original);
        const pendingCardIds = [...original.pendingMimic.cardIds];
        const blindCardIds =
          original.game.players
            .find((player) => player.id === uid)
            ?.hand.filter((entry) => entry.blind && pendingCardIds.includes(entry.card.id))
            .map((entry) => entry.card.id) ?? [];
        const applied = applyPendingMimic(
          room,
          resolved.jokerMimics,
          input.clientActionId,
          now.toMillis(),
        );
        const previousHostUid = room.hostUid;
        transferHostAfterDisqualification(room);
        appendPublicGameEvents(room, original.game, applied.events, uid, now, { blindCardIds });
        if (previousHostUid !== room.hostUid) {
          appendPublicEvents(
            room,
            [
              {
                type: "host-transferred",
                actorUid: previousHostUid,
                detail: { fromHostUid: previousHostUid, toHostUid: room.hostUid },
              },
            ],
            now,
          );
        }
        return {
          room,
          options: {
            resetTurnDeadline: room.status === "playing",
            summary: { mimicCount: resolved.jokerMimics.length },
          },
        };
      },
    );
  } catch (cause) {
    throw asHttpsError(cause);
  }
});

export const resolveSteal = gameCallable(
  "resolveSteal",
  resolveStealSchema,
  (input) => ({
    type: "resolve-effect",
    selection: {
      type: "steal",
      transfers: Object.entries(
        input.selections.reduce<Record<string, string[]>>((grouped, selection) => {
          (grouped[selection.targetUid] ??= []).push(selection.cardId);
          return grouped;
        }, {}),
      ).map(([playerId, cardIds]) => ({ playerId, cardIds })),
    },
  }),
  (input) => ({ selectionCount: input.selections.length }),
);

export const resolveGive = gameCallable(
  "resolveGive",
  resolveGiveSchema,
  (input) => ({
    type: "resolve-effect",
    selection: {
      type: "give",
      transfers: Object.entries(
        input.transfers.reduce<Record<string, string[]>>((grouped, transfer) => {
          (grouped[transfer.targetUid] ??= []).push(transfer.cardId);
          return grouped;
        }, {}),
      ).map(([playerId, cardIds]) => ({ playerId, cardIds })),
    },
  }),
  (input) => ({ transferCount: input.transfers.length }),
);

export const resolveDiscard = gameCallable(
  "resolveDiscard",
  resolveDiscardSchema,
  (input) => ({ type: "resolve-effect", selection: { type: "discard", cardIds: input.cardIds } }),
  (input) => ({ cardCount: input.cardIds.length }),
);

export const resolveBomber = gameCallable(
  "resolveBomber",
  resolveBomberSchema,
  (input) => ({
    type: "resolve-effect",
    selection: {
      type: "bomb",
      ranks: input.ranks.map((rank) => (rank === "Joker" ? "JOKER" : rank)),
    },
  }),
  (input) => ({ rankCount: input.ranks.length }),
);

export const resolveCollect = gameCallable(
  "resolveCollect",
  resolveCollectSchema,
  (input) => ({ type: "resolve-effect", selection: { type: "recover", cardIds: input.cardIds } }),
  (input) => ({ cardCount: input.cardIds.length }),
);
