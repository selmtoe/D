import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { ROOM_RETENTION_MS, TURN_TIMEOUT_MS, firestore, paths } from "../config.js";
import type { AuditEvent, RoomDocument, StoredActionResult } from "../model.js";
import { deleteRoomProjections, writeRoomProjections } from "../projections/write-projections.js";
import { pruneNonParticipantTombstones } from "../room/member-lifecycle.js";
import { CommandError } from "../security/command-error.js";

export interface CommandIdentity {
  uid: string;
  command: string;
  roomId: string;
  gameId: string | null;
  expectedRevision: number;
  clientActionId: string;
  source?: AuditEvent["source"];
}

export interface MutationOptions {
  resetTurnDeadline?: boolean;
  summary?: Record<string, string | number | boolean | null>;
}

export interface MutationResult {
  room: RoomDocument | null;
  response?: Record<string, unknown>;
  options?: MutationOptions;
}

export type RoomMutator = (
  room: RoomDocument,
  now: Timestamp,
  transaction: Transaction,
) => MutationResult | Promise<MutationResult>;

function requireMatchingRoomVersion(room: RoomDocument, identity: CommandIdentity): void {
  if (room.revision !== identity.expectedRevision) {
    throw new CommandError("aborted", "The room revision is stale.", {
      expectedRevision: identity.expectedRevision,
      currentRevision: room.revision,
    });
  }
  if (room.gameId !== identity.gameId) {
    throw new CommandError("failed-precondition", "The game generation is stale.", {
      expectedGameId: identity.gameId,
      currentGameId: room.gameId,
    });
  }
}

export function earliestDeadline(room: RoomDocument): {
  at: Timestamp | null;
  kind: RoomDocument["nextDeadlineKind"];
} {
  const candidates: Array<{ at: Timestamp; kind: "turn" | "disconnect" }> = [];
  if (room.turnDeadlineAt) candidates.push({ at: room.turnDeadlineAt, kind: "turn" });
  for (const member of Object.values(room.members)) {
    if (member.connectionStatus === "grace" && member.disconnectDeadlineAt) {
      candidates.push({ at: member.disconnectDeadlineAt, kind: "disconnect" });
    }
  }
  candidates.sort((left, right) => left.at.toMillis() - right.at.toMillis());
  return candidates[0] ?? { at: null, kind: null };
}

export function finalizeRoom(
  original: RoomDocument,
  mutated: RoomDocument,
  now: Timestamp,
  resetTurnDeadline: boolean,
): RoomDocument {
  pruneNonParticipantTombstones(mutated);
  const revision = original.revision + 1;
  const room: RoomDocument = {
    ...mutated,
    revision,
    updatedAt: now,
    lastActivityAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + ROOM_RETENTION_MS),
    turnDeadlineAt:
      resetTurnDeadline && mutated.status === "playing"
        ? Timestamp.fromMillis(now.toMillis() + TURN_TIMEOUT_MS)
        : mutated.status === "playing"
          ? mutated.turnDeadlineAt
          : null,
  };
  const deadline = earliestDeadline(room);
  room.nextDeadlineAt = deadline.at;
  room.nextDeadlineKind = deadline.kind;
  return room;
}

export async function executeRoomMutation(
  identity: CommandIdentity,
  mutator: RoomMutator,
): Promise<Record<string, unknown>> {
  const now = Timestamp.now();
  const actionRef = paths.action(identity.roomId, identity.clientActionId);
  const roomRef = paths.room(identity.roomId);

  return firestore.runTransaction(async (transaction) => {
    const actionSnapshot = await transaction.get(actionRef);
    if (actionSnapshot.exists) {
      const stored = actionSnapshot.data() as StoredActionResult;
      if (stored.uid !== identity.uid || stored.command !== identity.command) {
        throw new CommandError(
          "already-exists",
          "The action id was already used by another command.",
        );
      }
      return stored.response;
    }

    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists) {
      throw new CommandError("not-found", "The room does not exist.");
    }
    const original = roomSnapshot.data() as RoomDocument;
    if (original.schemaVersion !== 2 || original.roomId !== identity.roomId) {
      throw new CommandError("data-loss", "The room schema is invalid.");
    }
    requireMatchingRoomVersion(original, identity);

    const mutation = await mutator(original, now, transaction);
    const room = mutation.room
      ? finalizeRoom(original, mutation.room, now, mutation.options?.resetTurnDeadline === true)
      : null;
    const revision = room?.revision ?? original.revision + 1;
    const response: Record<string, unknown> = {
      ok: true,
      roomId: identity.roomId,
      gameId: room?.gameId ?? original.gameId,
      revision,
      ...(mutation.response ?? {}),
    };

    if (room) {
      transaction.set(roomRef, room);
      writeRoomProjections(transaction, room, original);
    } else {
      transaction.delete(roomRef);
      deleteRoomProjections(transaction, original);
    }

    const storedAction: StoredActionResult = {
      schemaVersion: 2,
      uid: identity.uid,
      command: identity.command,
      roomId: identity.roomId,
      clientActionId: identity.clientActionId,
      response,
      createdAt: now,
    };
    transaction.create(actionRef, storedAction);

    const audit: AuditEvent = {
      schemaVersion: 2,
      roomId: identity.roomId,
      gameId: room?.gameId ?? original.gameId,
      actorUid: identity.uid,
      command: identity.command,
      actionId: identity.clientActionId,
      revision,
      createdAt: now,
      source: identity.source ?? "callable",
      summary: mutation.options?.summary ?? {},
    };
    transaction.create(paths.audit(identity.roomId, revision, identity.clientActionId), audit);
    return response;
  });
}

export function cloneRoom(room: RoomDocument): RoomDocument {
  return {
    ...room,
    settings: { ...room.settings },
    members: { ...room.members },
    publicChat: [...room.publicChat],
    publicEvents: [...room.publicEvents],
  };
}

export function requireMember(room: RoomDocument, uid: string) {
  const member = room.members[uid];
  if (!member || member.connectionStatus === "left") {
    throw new CommandError(
      "permission-denied",
      "The authenticated user is not an active room member.",
    );
  }
  return member;
}

export function requirePlayer(room: RoomDocument, uid: string) {
  const member = requireMember(room, uid);
  if (member.role !== "player") {
    throw new CommandError("permission-denied", "Spectators cannot perform game commands.");
  }
  return member;
}

export function requireHost(room: RoomDocument, uid: string): void {
  requirePlayer(room, uid);
  if (room.hostUid !== uid) {
    throw new CommandError("permission-denied", "Only the current host can perform this command.");
  }
}

export function ensureBeforeTurnDeadline(room: RoomDocument, now: Timestamp): void {
  if (room.turnDeadlineAt && now.toMillis() > room.turnDeadlineAt.toMillis()) {
    throw new CommandError("deadline-exceeded", "The authoritative turn deadline has elapsed.");
  }
}
