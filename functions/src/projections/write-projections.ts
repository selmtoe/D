import type { Transaction } from "firebase-admin/firestore";
import { paths } from "../config.js";
import type { RoomDocument } from "../model.js";
import { projectPublicRoom, projectRoomForViewer } from "./project-room.js";

export function writeRoomProjections(
  transaction: Transaction,
  room: RoomDocument,
  previousRoom?: RoomDocument,
): void {
  transaction.set(paths.roomView(room.roomId), projectPublicRoom(room));

  for (const member of Object.values(room.members)) {
    const viewerRef = paths.viewer(room.roomId, member.uid);
    if (member.connectionStatus === "left") {
      transaction.delete(viewerRef);
    } else {
      transaction.set(viewerRef, projectRoomForViewer(room, member.uid));
    }
  }

  if (previousRoom) {
    for (const previousMember of Object.values(previousRoom.members)) {
      if (!room.members[previousMember.uid]) {
        transaction.delete(paths.viewer(room.roomId, previousMember.uid));
      }
    }
  }
}

export function deleteRoomProjections(transaction: Transaction, room: RoomDocument): void {
  transaction.delete(paths.roomView(room.roomId));
  for (const member of Object.values(room.members)) {
    transaction.delete(paths.viewer(room.roomId, member.uid));
  }
}
