import type { RoomView } from "./model";

export interface ReplayFrame {
  capturedAtMs: number;
  room: RoomView;
}

const MAX_REPLAY_FRAMES = 480;

export function replayGameKey(room: RoomView): string {
  return `${room.roomId}:${room.viewerId}:${room.generation}:${room.gameId ?? "no-game-id"}`;
}

function cloneRoomView(room: RoomView): RoomView {
  return structuredClone(room);
}

/**
 * Records only the already-projected room view received by this client. This is
 * deliberate: a player's replay must not reveal cards that were hidden from
 * that player while the hand was in progress.
 */
export function appendReplayFrame(
  frames: readonly ReplayFrame[],
  room: RoomView,
  capturedAtMs = Date.now(),
): ReplayFrame[] {
  if (room.phase === "waiting") return [];
  const last = frames.at(-1);
  const sameGame = last && replayGameKey(last.room) === replayGameKey(room);
  const current = sameGame ? frames : [];
  const lastRevision = current.at(-1)?.room.revision;
  if (lastRevision !== undefined && room.revision <= lastRevision) return [...current];

  const next = [...current, { capturedAtMs, room: cloneRoomView(room) }];
  if (next.length <= MAX_REPLAY_FRAMES) return next;
  return [next[0]!, ...next.slice(-(MAX_REPLAY_FRAMES - 1))];
}

export function replayFrameSummary(frame: ReplayFrame): string {
  const latestLog = frame.room.log.at(-1)?.text;
  if (latestLog) return latestLog;
  if (frame.room.phase === "dealing") return "カードを配っています";
  if (frame.room.phase === "finished") return "対局終了";
  const current = frame.room.players.find((player) => player.id === frame.room.currentPlayerId);
  return current ? `${current.name}の手番` : "対局の進行を再生中";
}

export function replayElapsedMs(frames: readonly ReplayFrame[], index: number): number {
  const first = frames[0]?.capturedAtMs;
  const current = frames[index]?.capturedAtMs;
  return first === undefined || current === undefined ? 0 : Math.max(0, current - first);
}
