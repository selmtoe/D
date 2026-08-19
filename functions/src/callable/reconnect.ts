import { onCall } from "firebase-functions/v2/https";
import { disqualifyAfterResolvingEffects, gameIsFinished } from "../game/rules-adapter.js";
import { applyDefaultPendingMimic } from "../game/pending-mimic.js";
import { asHttpsError, CommandError, parseInput } from "../security/command-error.js";
import {
  createReconnectToken,
  hashReconnectToken,
  reconnectTokenMatches,
} from "../security/crypto.js";
import { reconnectRoomSchema } from "../security/schemas.js";
import { cloneRoom, executeRoomMutation, requireMember } from "./command-store.js";
import { authenticatedUid } from "./context.js";
import { callableOptions } from "./options.js";

export const reconnectRoom = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(reconnectRoomSchema, request.data);
    const rotatedToken = createReconnectToken();
    return await executeRoomMutation(
      {
        uid,
        command: "reconnectRoom",
        roomId: input.roomId,
        gameId: input.gameId,
        expectedRevision: input.expectedRevision,
        clientActionId: input.clientActionId,
      },
      (original, now) => {
        const member = requireMember(original, uid);
        if (!reconnectTokenMatches(input.reconnectToken, member.reconnectTokenHash)) {
          throw new CommandError("permission-denied", "The reconnect token is invalid.");
        }
        const room = cloneRoom(original);
        const expired =
          member.reconnectExpired ||
          (member.connectionStatus === "grace" &&
            member.disconnectDeadlineAt !== null &&
            now.toMillis() > member.disconnectDeadlineAt.toMillis());

        if (
          expired &&
          !member.reconnectExpired &&
          room.status === "playing" &&
          member.role === "player" &&
          room.game
        ) {
          if (room.pendingMimic?.actorUid === uid) {
            applyDefaultPendingMimic(room, `${input.clientActionId}_mimic`, now.toMillis());
          }
          const applied = disqualifyAfterResolvingEffects(
            room.game,
            uid,
            "disconnect",
            input.clientActionId,
            now.toMillis(),
          );
          room.game = applied.state;
          if (gameIsFinished(applied.state)) room.status = "finished";
        }

        room.members[uid] = {
          ...member,
          connectionStatus: expired && original.status === "waiting" ? "left" : "connected",
          reconnectTokenHash: hashReconnectToken(rotatedToken),
          disconnectDeadlineAt: null,
          reconnectExpired: false,
          timeoutWarnings: member.timeoutWarnings + (expired ? 1 : 0),
        };
        if (
          expired &&
          original.status === "waiting" &&
          Object.values(room.members).every(
            (candidate) => candidate.role !== "player" || candidate.connectionStatus === "left",
          )
        ) {
          return {
            room: null,
            response: { reconnectOutcome: "expired", roomDeleted: true },
            options: { summary: { expired: true, roomDeleted: true } },
          };
        }
        if (expired && room.hostUid === uid) {
          const successor = Object.values(room.members)
            .filter(
              (candidate) =>
                candidate.uid !== uid &&
                candidate.role === "player" &&
                candidate.connectionStatus !== "left",
            )
            .sort((left, right) => {
              if (left.connectionStatus === "connected" && right.connectionStatus !== "connected")
                return -1;
              if (right.connectionStatus === "connected" && left.connectionStatus !== "connected")
                return 1;
              return left.joinedOrder - right.joinedOrder;
            })[0];
          if (successor) room.hostUid = successor.uid;
        }
        return {
          room,
          response: {
            reconnectToken: rotatedToken,
            reconnectOutcome: expired ? "expired" : "restored",
          },
          options: { summary: { expired } },
        };
      },
    );
  } catch (cause) {
    throw asHttpsError(cause);
  }
});
