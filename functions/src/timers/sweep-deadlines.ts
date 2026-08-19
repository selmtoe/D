import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { firestore } from "../config.js";
import { cloneRoom } from "../callable/command-store.js";
import {
  disqualifyAfterResolvingEffects,
  gameIsFinished,
  timeoutGame,
} from "../game/rules-adapter.js";
import { applyDefaultPendingMimic } from "../game/pending-mimic.js";
import { appendPublicEvents, appendPublicGameEvents } from "../logging/public-events.js";
import type { RoomDocument } from "../model.js";
import { endMembership } from "../room/member-lifecycle.js";
import { executeSystemMutation } from "./system-store.js";

function nextHost(room: RoomDocument): string | null {
  const candidate = Object.values(room.members)
    .filter((member) => member.role === "player" && member.connectionStatus === "connected")
    .sort((left, right) => left.joinedOrder - right.joinedOrder)[0];
  return candidate?.uid ?? null;
}

function expireDeadlines(original: RoomDocument, now: Timestamp) {
  const room = cloneRoom(original);
  let changed = false;
  let resetTurnDeadline = false;
  let disconnectedExpired = 0;
  let gameAdvancedForDisconnect = false;
  let turnExpired = false;

  for (const [uid, member] of Object.entries(room.members)) {
    if (
      member.connectionStatus !== "grace" ||
      !member.disconnectDeadlineAt ||
      now.toMillis() <= member.disconnectDeadlineAt.toMillis()
    ) {
      continue;
    }
    disconnectedExpired += 1;
    changed = true;

    if (room.status === "playing" && member.role === "player" && room.game) {
      if (room.pendingMimic?.actorUid === uid) {
        const beforeMimic = room.game;
        const pendingCardIds = [...room.pendingMimic.cardIds];
        const blindCardIds =
          beforeMimic.players
            .find((player) => player.id === uid)
            ?.hand.filter((entry) => entry.blind && pendingCardIds.includes(entry.card.id))
            .map((entry) => entry.card.id) ?? [];
        const mimicApplied = applyDefaultPendingMimic(
          room,
          `disconnect_${uid}_${member.disconnectDeadlineAt.toMillis()}_mimic`,
          now.toMillis(),
        );
        appendPublicGameEvents(room, beforeMimic, mimicApplied.events, uid, now, {
          blindCardIds,
        });
      }
      const beforeDisqualification = room.game;
      const applied = disqualifyAfterResolvingEffects(
        room.game,
        uid,
        "disconnect",
        `disconnect_${uid}_${member.disconnectDeadlineAt.toMillis()}`,
        now.toMillis(),
      );
      room.game = applied.state;
      appendPublicGameEvents(room, beforeDisqualification, applied.events, uid, now, {
        disqualificationReason: "disconnect",
      });
      gameAdvancedForDisconnect = true;
      resetTurnDeadline = true;
      room.members[uid] = {
        ...member,
        disconnectDeadlineAt: null,
        reconnectExpired: true,
        timeoutWarnings: member.timeoutWarnings + 1,
      };
      if (gameIsFinished(applied.state)) room.status = "finished";
    } else {
      endMembership(room, uid);
    }
    appendPublicEvents(
      room,
      [
        {
          type: "reconnect-expired",
          actorUid: uid,
          detail: { warningCount: member.timeoutWarnings + 1 },
        },
        {
          type: "timeout-warning",
          actorUid: uid,
          detail: { warningCount: member.timeoutWarnings + 1, reason: "disconnect" },
        },
      ],
      now,
    );
  }

  const currentHost = room.members[room.hostUid];
  if (!currentHost || currentHost.connectionStatus === "left" || currentHost.reconnectExpired) {
    const replacement = nextHost(room);
    if (replacement && replacement !== room.hostUid) {
      room.hostUid = replacement;
      changed = true;
    }
  }
  if (original.hostUid !== room.hostUid) {
    appendPublicEvents(
      room,
      [
        {
          type: "host-transferred",
          actorUid: original.hostUid,
          detail: { fromHostUid: original.hostUid, toHostUid: room.hostUid },
        },
      ],
      now,
    );
  }

  if (
    room.status === "playing" &&
    room.game &&
    room.turnDeadlineAt &&
    !gameAdvancedForDisconnect &&
    now.toMillis() > room.turnDeadlineAt.toMillis()
  ) {
    if (room.pendingMimic) {
      const actorUid = room.pendingMimic.actorUid;
      const beforeMimic = room.game;
      const pendingCardIds = [...room.pendingMimic.cardIds];
      const blindCardIds =
        beforeMimic.players
          .find((player) => player.id === actorUid)
          ?.hand.filter((entry) => entry.blind && pendingCardIds.includes(entry.card.id))
          .map((entry) => entry.card.id) ?? [];
      const mimicApplied = applyDefaultPendingMimic(
        room,
        `timeout_${room.turnDeadlineAt.toMillis()}_mimic`,
        now.toMillis(),
      );
      appendPublicGameEvents(room, beforeMimic, mimicApplied.events, actorUid, now, {
        blindCardIds,
      });
      const warningCount = (room.members[actorUid]?.timeoutWarnings ?? 0) + 1;
      if (room.members[actorUid]) {
        room.members[actorUid] = { ...room.members[actorUid]!, timeoutWarnings: warningCount };
      }
      appendPublicEvents(
        room,
        [{ type: "timeout-warning", actorUid, detail: { warningCount, reason: "turn" } }],
        now,
      );
    } else {
      const beforeTimeout = room.game;
      const actorUid = beforeTimeout.pendingEffect?.actorId ?? beforeTimeout.turnPlayerId;
      const applied = timeoutGame(
        room.game,
        `timeout_${room.turnDeadlineAt.toMillis()}`,
        now.toMillis(),
      );
      room.game = applied.state;
      room.status = gameIsFinished(applied.state) ? "finished" : "playing";
      if (actorUid) {
        appendPublicGameEvents(room, beforeTimeout, applied.events, actorUid, now);
        const warningCount =
          applied.state.players.find((player) => player.id === actorUid)?.timeoutWarnings ?? 0;
        if (room.members[actorUid]) {
          room.members[actorUid] = {
            ...room.members[actorUid]!,
            timeoutWarnings: warningCount,
          };
        }
        appendPublicEvents(
          room,
          [{ type: "timeout-warning", actorUid, detail: { warningCount, reason: "turn" } }],
          now,
        );
      }
    }
    resetTurnDeadline = room.status === "playing";
    turnExpired = true;
    changed = true;
  }

  const remainingPlayers = Object.values(room.members).filter(
    (member) => member.role === "player" && member.connectionStatus !== "left",
  );
  if (remainingPlayers.length === 0) {
    return { room: null, options: { summary: { disconnectedExpired, roomDeleted: true } } };
  }
  if (!changed) return null;
  return {
    room,
    options: {
      resetTurnDeadline,
      summary: { disconnectedExpired, turnExpired },
    },
  };
}

export const sweepV2Deadlines = onSchedule(
  {
    schedule: "* * * * *",
    region: "asia-northeast1",
    timeZone: "UTC",
    timeoutSeconds: 55,
    memory: "256MiB",
    maxInstances: 1,
  },
  async () => {
    const now = Timestamp.now();
    const dueRooms = await firestore
      .collection("v2Rooms")
      .where("nextDeadlineAt", "<", now)
      .orderBy("nextDeadlineAt", "asc")
      .limit(50)
      .get();

    const results = await Promise.allSettled(
      dueRooms.docs.map((snapshot) =>
        executeSystemMutation(
          snapshot.id,
          "deadlineSweep",
          `deadline_${now.toMillis()}`,
          "scheduler",
          (room, transactionNow) => expireDeadlines(room, transactionNow),
        ),
      ),
    );
    const rejected = results.filter((result) => result.status === "rejected");
    logger.info("v2 deadline sweep completed", {
      projectId: "daifugo-8e039",
      consideredRooms: dueRooms.size,
      failedRooms: rejected.length,
    });
    for (const failure of rejected.slice(0, 5)) {
      logger.error("v2 deadline sweep room failed", failure.reason);
    }
  },
);

export const cleanupExpiredV2Rooms = onSchedule(
  {
    schedule: "every 60 minutes",
    region: "asia-northeast1",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    maxInstances: 1,
  },
  async () => {
    const now = Timestamp.now();
    const expired = await firestore
      .collection("v2Rooms")
      .where("expiresAt", "<", now)
      .orderBy("expiresAt", "asc")
      .limit(100)
      .get();
    await Promise.allSettled(
      expired.docs.map((snapshot) =>
        executeSystemMutation(
          snapshot.id,
          "roomRetentionExpired",
          `retention_${now.toMillis()}`,
          "scheduler",
          (room) =>
            room.expiresAt.toMillis() < now.toMillis()
              ? { room: null, options: { summary: { retentionExpired: true } } }
              : null,
        ),
      ),
    );
    logger.info("v2 room retention sweep completed", {
      projectId: "daifugo-8e039",
      consideredRooms: expired.size,
    });
  },
);

export const __timerTest = { expireDeadlines };
