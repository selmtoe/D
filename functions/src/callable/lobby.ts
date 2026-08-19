import { onCall } from "firebase-functions/v2/https";
import {
  createAuthoritativeGame,
  createCardTokenMap,
  disqualifyAfterResolvingEffects,
  gameIsFinished,
} from "../game/rules-adapter.js";
import { applyDefaultPendingMimic } from "../game/pending-mimic.js";
import type { RoomDocument, RoomMember } from "../model.js";
import { asHttpsError, CommandError, parseInput } from "../security/command-error.js";
import { createGameId } from "../security/crypto.js";
import { endMembership } from "../room/member-lifecycle.js";
import {
  simpleCommandSchema,
  transferHostSchema,
  updateRoomSettingsSchema,
} from "../security/schemas.js";
import {
  cloneRoom,
  executeRoomMutation,
  requireHost,
  requireMember,
  requirePlayer,
} from "./command-store.js";
import { authenticatedUid } from "./context.js";
import { callableOptions } from "./options.js";

function identity(
  uid: string,
  command: string,
  input: {
    roomId: string;
    gameId: string | null;
    expectedRevision: number;
    clientActionId: string;
  },
) {
  return {
    uid,
    command,
    roomId: input.roomId,
    gameId: input.gameId,
    expectedRevision: input.expectedRevision,
    clientActionId: input.clientActionId,
  };
}

function connectedHostCandidate(room: RoomDocument, excludingUid?: string): RoomMember | undefined {
  const players = Object.values(room.members)
    .filter(
      (member) =>
        member.uid !== excludingUid &&
        member.role === "player" &&
        member.connectionStatus !== "left",
    )
    .sort((left, right) => {
      if (left.connectionStatus === "connected" && right.connectionStatus !== "connected")
        return -1;
      if (right.connectionStatus === "connected" && left.connectionStatus !== "connected") return 1;
      return left.joinedOrder - right.joinedOrder;
    });
  return players[0];
}

export const leaveRoom = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(simpleCommandSchema, request.data);
    return await executeRoomMutation(identity(uid, "leaveRoom", input), (original, now) => {
      const member = requireMember(original, uid);
      const room = cloneRoom(original);

      if (room.status === "playing" && member.role === "player" && room.game) {
        if (room.pendingMimic?.actorUid === uid) {
          applyDefaultPendingMimic(room, `${input.clientActionId}_mimic`, now.toMillis());
        }
        const applied = disqualifyAfterResolvingEffects(
          room.game,
          uid,
          "exit",
          input.clientActionId,
          now.toMillis(),
        );
        room.game = applied.state;
        if (gameIsFinished(applied.state)) room.status = "finished";
      }
      const membershipOutcome = endMembership(room, uid);

      const remainingPlayers = Object.values(room.members).filter(
        (candidate) => candidate.role === "player" && candidate.connectionStatus !== "left",
      );
      if (remainingPlayers.length === 0) {
        return {
          room: null,
          options: {
            summary: { role: member.role, membershipOutcome, roomDeleted: true },
          },
        };
      }
      if (room.hostUid === uid) {
        const nextHost = connectedHostCandidate(room, uid);
        if (!nextHost) throw new CommandError("internal", "No host successor could be selected.");
        room.hostUid = nextHost.uid;
      }
      return {
        room,
        options: {
          summary: { role: member.role, membershipOutcome, roomDeleted: false },
        },
      };
    });
  } catch (cause) {
    throw asHttpsError(cause);
  }
});

export const transferHost = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(transferHostSchema, request.data);
    return await executeRoomMutation(identity(uid, "transferHost", input), (original) => {
      requireHost(original, uid);
      const target = requirePlayer(original, input.targetUid);
      if (target.connectionStatus !== "connected") {
        throw new CommandError(
          "failed-precondition",
          "Host can only be transferred to a connected player.",
        );
      }
      const room = cloneRoom(original);
      room.hostUid = target.uid;
      return { room, options: { summary: { targetUid: target.uid } } };
    });
  } catch (cause) {
    throw asHttpsError(cause);
  }
});

export const updateRoomSettings = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(updateRoomSettingsSchema, request.data);
    return await executeRoomMutation(identity(uid, "updateRoomSettings", input), (original) => {
      requireHost(original, uid);
      if (original.status !== "waiting") {
        throw new CommandError(
          "failed-precondition",
          "Room settings are locked after the game starts.",
        );
      }
      const room = cloneRoom(original);
      room.settings = input.settings;
      return {
        room,
        options: { summary: { mode: input.settings.mode, blindCount: input.settings.blindCount } },
      };
    });
  } catch (cause) {
    throw asHttpsError(cause);
  }
});

export const startGame = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(simpleCommandSchema, request.data);
    return await executeRoomMutation(identity(uid, "startGame", input), (original) => {
      requireHost(original, uid);
      if (original.status !== "waiting" || original.game !== null) {
        throw new CommandError("failed-precondition", "The room is not ready to start.");
      }
      const players = Object.values(original.members)
        .filter((member) => member.role === "player" && member.connectionStatus !== "left")
        .sort((left, right) => left.joinedOrder - right.joinedOrder);
      if (players.length < 3 || players.length > 6) {
        throw new CommandError("failed-precondition", "A game requires 3-6 players.");
      }

      const room = cloneRoom(original);
      room.gameId = createGameId(room.rematchGeneration);
      room.game = createAuthoritativeGame(
        players.map((player) => player.uid),
        room.settings.mode,
        room.settings.blindCount,
        room.gameId,
      );
      room.cardTokens = createCardTokenMap(room.game);
      room.pendingMimic = null;
      room.status = gameIsFinished(room.game) ? "finished" : "playing";
      return {
        room,
        response: { gameId: room.gameId },
        options: {
          resetTurnDeadline: room.status === "playing",
          summary: { playerCount: players.length, mode: room.settings.mode },
        },
      };
    });
  } catch (cause) {
    throw asHttpsError(cause);
  }
});

export const startRematch = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(simpleCommandSchema, request.data);
    return await executeRoomMutation(identity(uid, "startRematch", input), (original) => {
      requireHost(original, uid);
      if (original.status !== "finished") {
        throw new CommandError(
          "failed-precondition",
          "A rematch can only be prepared after the game finishes.",
        );
      }
      const room = cloneRoom(original);
      room.rematchGeneration += 1;
      room.status = "waiting";
      room.gameId = null;
      room.game = null;
      room.cardTokens = {};
      room.pendingMimic = null;
      room.turnDeadlineAt = null;
      room.publicEvents = [];
      for (const [memberUid, member] of Object.entries(room.members)) {
        room.members[memberUid] = { ...member, focusPlayerId: null, timeoutWarnings: 0 };
      }
      return { room, options: { summary: { generation: room.rematchGeneration } } };
    });
  } catch (cause) {
    throw asHttpsError(cause);
  }
});
