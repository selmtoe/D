import { onCall } from "firebase-functions/v2/https";
import { asHttpsError, CommandError, parseInput } from "../security/command-error.js";
import { chatSchema, focusSchema } from "../security/schemas.js";
import { cloneRoom, executeRoomMutation, requireMember } from "./command-store.js";
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

export const changeSpectatorFocus = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(focusSchema, request.data);
    return await executeRoomMutation(identity(uid, "changeSpectatorFocus", input), (original) => {
      const member = requireMember(original, uid);
      if (input.focusPlayerId) {
        const target = original.members[input.focusPlayerId];
        if (!target || target.role !== "player" || target.connectionStatus === "left") {
          throw new CommandError(
            "invalid-argument",
            "The focus target is not an active room player.",
          );
        }
      }
      const room = cloneRoom(original);
      room.members[uid] = { ...member, focusPlayerId: input.focusPlayerId };
      return { room, options: { summary: { hasFocus: input.focusPlayerId !== null } } };
    });
  } catch (cause) {
    throw asHttpsError(cause);
  }
});

export const sendChat = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(chatSchema, request.data);
    return await executeRoomMutation(identity(uid, "sendChat", input), (original, now) => {
      const member = requireMember(original, uid);
      if (member.lastChatAt && now.toMillis() - member.lastChatAt.toMillis() < 1_000) {
        throw new CommandError("resource-exhausted", "Chat is limited to one message per second.");
      }
      const room = cloneRoom(original);
      room.members[uid] = { ...member, lastChatAt: now };
      room.publicChat = [
        ...room.publicChat,
        {
          id: input.clientActionId,
          uid,
          name: member.name,
          role: member.role,
          text: input.text,
          createdAt: now,
        },
      ].slice(-100);
      return { room, options: { summary: { textLength: input.text.length } } };
    });
  } catch (cause) {
    throw asHttpsError(cause);
  }
});
