import { Timestamp } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";
import { onValueWritten } from "firebase-functions/v2/database";
import { RECONNECT_GRACE_MS } from "../config.js";
import { cloneRoom } from "../callable/command-store.js";
import { executeSystemMutation } from "./system-store.js";

interface PresenceValue {
  online?: unknown;
  connectionId?: unknown;
  lastChanged?: unknown;
}

export function shouldIgnoreDisconnectEvent(
  eventValue: PresenceValue | null,
  currentValue: PresenceValue | null,
): boolean {
  if (currentValue?.online === true) return true;
  const eventChanged = typeof eventValue?.lastChanged === "number" ? eventValue.lastChanged : -1;
  const currentChanged =
    typeof currentValue?.lastChanged === "number" ? currentValue.lastChanged : -1;
  return currentChanged > eventChanged;
}

export const onV2PresenceWritten = onValueWritten(
  {
    ref: "/v2Presence/{roomId}/{uid}",
    region: "asia-northeast1",
    maxInstances: 50,
  },
  async (event) => {
    const roomId = event.params.roomId;
    const uid = event.params.uid;
    const after = event.data.after.val() as PresenceValue | null;
    if (after?.online === true) {
      // Online presence alone cannot reclaim a seat: reconnectRoom must also
      // prove possession of the short-lived reconnect token.
      return;
    }

    // Database triggers are at-least-once and may arrive after a newer write.
    // Re-read the leaf before starting grace so a stale offline event cannot
    // override a restored connection.
    const currentSnapshot = await getDatabase().ref(`/v2Presence/${roomId}/${uid}`).get();
    const current = currentSnapshot.val() as PresenceValue | null;
    if (shouldIgnoreDisconnectEvent(after, current)) return;

    const eventId = String(event.id)
      .replace(/[^A-Za-z0-9_-]/gu, "_")
      .slice(0, 80);
    await executeSystemMutation(
      roomId,
      "presenceDisconnected",
      eventId,
      "presence",
      (original, now) => {
        const member = original.members[uid];
        if (!member || member.connectionStatus !== "connected") return null;
        const room = cloneRoom(original);
        room.members[uid] = {
          ...member,
          connectionStatus: "grace",
          disconnectDeadlineAt: Timestamp.fromMillis(now.toMillis() + RECONNECT_GRACE_MS),
          reconnectExpired: false,
        };
        return { room, options: { summary: { uid, graceMs: RECONNECT_GRACE_MS } } };
      },
    );
  },
);

export const __presenceTest = { shouldIgnoreDisconnectEvent };
