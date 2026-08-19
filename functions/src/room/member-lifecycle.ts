import type { RoomDocument, RoomMember } from "../model.js";
import { CommandError } from "../security/command-error.js";

export const MAX_ACTIVE_SPECTATORS = 32;

export function activeSpectatorCount(members: Record<string, RoomMember>): number {
  return Object.values(members).filter(
    (member) => member.role === "spectator" && member.connectionStatus !== "left",
  ).length;
}

export function requireSpectatorCapacity(members: Record<string, RoomMember>): void {
  if (activeSpectatorCount(members) >= MAX_ACTIVE_SPECTATORS) {
    throw new CommandError("resource-exhausted", "The spectator gallery is full.");
  }
}

export function isRetainedGamePlayer(room: RoomDocument, uid: string): boolean {
  const member = room.members[uid];
  return (
    member?.role === "player" && (room.game?.players.some((player) => player.id === uid) ?? false)
  );
}

/**
 * Spectators and players who never entered a game have no result history to
 * preserve. Removing their map entry keeps the authoritative document bounded;
 * only the at-most-six actual game players may remain as `left`.
 */
export function endMembership(room: RoomDocument, uid: string): "removed" | "retained" {
  const member = room.members[uid];
  if (!member) return "removed";
  if (!isRetainedGamePlayer(room, uid)) {
    delete room.members[uid];
    return "removed";
  }
  room.members[uid] = {
    ...member,
    connectionStatus: "left",
    disconnectDeadlineAt: null,
  };
  return "retained";
}

/** Remove stale non-participant tombstones from pre-fix room documents. */
export function pruneNonParticipantTombstones(room: RoomDocument): void {
  for (const [uid, member] of Object.entries(room.members)) {
    if (member.connectionStatus === "left" && !isRetainedGamePlayer(room, uid)) {
      delete room.members[uid];
    }
  }
}
