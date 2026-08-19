import { Timestamp } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { ROOM_RETENTION_MS, firestore, paths } from "../config.js";
import type { AuditEvent, RoomDocument, StoredActionResult } from "../model.js";
import { writeRoomProjections } from "../projections/write-projections.js";
import { asHttpsError, CommandError, parseInput } from "../security/command-error.js";
import { createReconnectToken, createRoomId, hashReconnectToken } from "../security/crypto.js";
import { createRoomSchema } from "../security/schemas.js";
import { authenticatedUid } from "./context.js";
import { callableOptions } from "./options.js";

export const createRoom = onCall(callableOptions, async (request) => {
  try {
    const uid = authenticatedUid(request);
    const input = parseInput(createRoomSchema, request.data);
    const actionRef = paths.createAction(uid, input.clientActionId);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidateRoomId = createRoomId();
      const reconnectToken = createReconnectToken();
      const now = Timestamp.now();
      const result = await firestore.runTransaction(async (transaction) => {
        const actionSnapshot = await transaction.get(actionRef);
        if (actionSnapshot.exists) {
          const stored = actionSnapshot.data() as StoredActionResult;
          if (stored.uid !== uid || stored.command !== "createRoom") {
            throw new CommandError(
              "already-exists",
              "The action id was already used by another command.",
            );
          }
          return { kind: "done" as const, response: stored.response };
        }

        const roomRef = paths.room(candidateRoomId);
        const roomSnapshot = await transaction.get(roomRef);
        if (roomSnapshot.exists) return { kind: "collision" as const };

        const room: RoomDocument = {
          schemaVersion: 2,
          roomId: candidateRoomId,
          status: "waiting",
          visibility: input.visibility,
          revision: 0,
          gameId: null,
          rematchGeneration: 0,
          hostUid: uid,
          settings: input.settings,
          members: {
            [uid]: {
              uid,
              name: input.profile.name,
              role: "player",
              connectionStatus: "connected",
              joinedAt: now,
              joinedOrder: 0,
              avatar: input.profile.avatar,
              focusPlayerId: null,
              reconnectTokenHash: hashReconnectToken(reconnectToken),
              disconnectDeadlineAt: null,
              reconnectExpired: false,
              timeoutWarnings: 0,
              lastChatAt: null,
            },
          },
          game: null,
          cardTokens: {},
          pendingMimic: null,
          publicChat: [],
          publicEvents: [],
          createdAt: now,
          updatedAt: now,
          lastActivityAt: now,
          expiresAt: Timestamp.fromMillis(now.toMillis() + ROOM_RETENTION_MS),
          turnDeadlineAt: null,
          nextDeadlineAt: null,
          nextDeadlineKind: null,
          frozenReason: null,
        };
        const response: Record<string, unknown> = {
          ok: true,
          roomId: candidateRoomId,
          gameId: null,
          revision: 0,
          reconnectToken,
        };
        const storedAction: StoredActionResult = {
          schemaVersion: 2,
          uid,
          command: "createRoom",
          roomId: candidateRoomId,
          clientActionId: input.clientActionId,
          response,
          createdAt: now,
        };
        const audit: AuditEvent = {
          schemaVersion: 2,
          roomId: candidateRoomId,
          gameId: null,
          actorUid: uid,
          command: "createRoom",
          actionId: input.clientActionId,
          revision: 0,
          createdAt: now,
          source: "callable",
          summary: { visibility: input.visibility, mode: input.settings.mode },
        };

        transaction.create(roomRef, room);
        writeRoomProjections(transaction, room);
        transaction.create(actionRef, storedAction);
        transaction.create(paths.audit(candidateRoomId, 0, input.clientActionId), audit);
        return { kind: "done" as const, response };
      });

      if (result.kind === "done") return result.response;
    }
    throw new CommandError("resource-exhausted", "A unique room id could not be allocated.");
  } catch (cause) {
    throw asHttpsError(cause);
  }
});
