import { Timestamp } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import type { MemberRole, RoomMember } from "../model.js";
import { appendPublicEvents } from "../logging/public-events.js";
import { MAX_ACTIVE_SPECTATORS, requireSpectatorCapacity } from "../room/member-lifecycle.js";
import { asHttpsError, CommandError, parseInput } from "../security/command-error.js";
import { createReconnectToken, hashReconnectToken } from "../security/crypto.js";
import { joinRoomSchema } from "../security/schemas.js";
import { cloneRoom, executeRoomMutation } from "./command-store.js";
import { authenticatedUid } from "./context.js";
import { callableOptions } from "./options.js";

function nextJoinOrder(members: Record<string, RoomMember>): number {
  return Math.max(-1, ...Object.values(members).map((member) => member.joinedOrder)) + 1;
}

function joinRoom(role: MemberRole) {
  const command = role === "player" ? "joinRoomAsPlayer" : "joinRoomAsSpectator";
  return onCall(callableOptions, async (request) => {
    try {
      const uid = authenticatedUid(request);
      const input = parseInput(joinRoomSchema, request.data);
      const reconnectToken = createReconnectToken();
      return await executeRoomMutation(
        {
          uid,
          command,
          roomId: input.roomId,
          gameId: input.gameId,
          expectedRevision: input.expectedRevision,
          clientActionId: input.clientActionId,
        },
        (original, now) => {
          if (original.status === "frozen") {
            throw new CommandError(
              "failed-precondition",
              "The room is frozen for operator review.",
            );
          }
          const existingMember = original.members[uid];
          if (existingMember && existingMember.connectionStatus !== "left") {
            throw new CommandError(
              "already-exists",
              "This authenticated user already belongs to the room.",
            );
          }
          const activeMembers = Object.values(original.members).filter(
            (member) => member.connectionStatus !== "left",
          );
          if (role === "player") {
            if (original.status !== "waiting") {
              throw new CommandError(
                "failed-precondition",
                "Players cannot join after the game starts.",
              );
            }
            if (activeMembers.filter((member) => member.role === "player").length >= 6) {
              throw new CommandError("resource-exhausted", "The player table is full.");
            }
            if (
              activeMembers.some(
                (member) => member.role === "player" && member.name === input.profile.name,
              )
            ) {
              throw new CommandError(
                "already-exists",
                "That player name is already in use in this room.",
              );
            }
          } else {
            requireSpectatorCapacity(original.members);
          }

          const room = cloneRoom(original);
          room.members[uid] = {
            uid,
            name: input.profile.name,
            role,
            connectionStatus: "connected",
            joinedAt: Timestamp.fromMillis(now.toMillis()),
            joinedOrder: nextJoinOrder(original.members),
            avatar: input.profile.avatar,
            focusPlayerId: null,
            reconnectTokenHash: hashReconnectToken(reconnectToken),
            disconnectDeadlineAt: null,
            reconnectExpired: false,
            timeoutWarnings: 0,
            lastChatAt: null,
          };
          appendPublicEvents(
            room,
            [{ type: "joined", actorUid: uid, detail: { kind: role } }],
            now,
          );
          return {
            room,
            response: { reconnectToken, role },
            options: {
              summary: {
                role,
                ...(role === "spectator" ? { spectatorLimit: MAX_ACTIVE_SPECTATORS } : {}),
              },
            },
          };
        },
      );
    } catch (cause) {
      throw asHttpsError(cause);
    }
  });
}

export const joinRoomAsPlayer = joinRoom("player");
export const joinRoomAsSpectator = joinRoom("spectator");
