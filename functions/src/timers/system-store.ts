import { Timestamp } from "firebase-admin/firestore";
import { firestore, paths } from "../config.js";
import type { AuditEvent, RoomDocument } from "../model.js";
import { deleteRoomProjections, writeRoomProjections } from "../projections/write-projections.js";
import { finalizeRoom, type MutationResult } from "../callable/command-store.js";

export async function executeSystemMutation(
  roomId: string,
  command: string,
  actionId: string,
  source: "presence" | "scheduler",
  mutate: (room: RoomDocument, now: Timestamp) => MutationResult | null,
): Promise<boolean> {
  const now = Timestamp.now();
  return firestore.runTransaction(async (transaction) => {
    const roomRef = paths.room(roomId);
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists) return false;
    const original = snapshot.data() as RoomDocument;
    if (original.schemaVersion !== 2) return false;
    const mutation = mutate(original, now);
    if (!mutation) return false;

    const room = mutation.room
      ? finalizeRoom(original, mutation.room, now, mutation.options?.resetTurnDeadline === true)
      : null;
    const revision = room?.revision ?? original.revision + 1;
    if (room) {
      transaction.set(roomRef, room);
      writeRoomProjections(transaction, room, original);
    } else {
      transaction.delete(roomRef);
      deleteRoomProjections(transaction, original);
    }
    const audit: AuditEvent = {
      schemaVersion: 2,
      roomId,
      gameId: room?.gameId ?? original.gameId,
      actorUid: null,
      command,
      actionId,
      revision,
      createdAt: now,
      source,
      summary: mutation.options?.summary ?? {},
    };
    transaction.create(paths.audit(roomId, revision, actionId), audit);
    return true;
  });
}
