import type { CardView, RoomView } from "./model";

export type ReplayPlayerHands = Record<string, CardView[]>;

export interface ReplayFrame {
  capturedAtMs: number;
  room: RoomView;
  /**
   * Cards that this client was allowed to know for each player at capture time.
   * This is optional so replays recorded before perspective support remain valid.
   */
  playerHands?: ReplayPlayerHands;
}

const MAX_REPLAY_FRAMES = 480;

export function replayGameKey(room: RoomView): string {
  return `${room.roomId}:${room.viewerId}:${room.generation}:${room.gameId ?? "no-game-id"}`;
}

function cloneRoomView(room: RoomView): RoomView {
  return structuredClone(room);
}

function cloneCards(cards: readonly CardView[]): CardView[] {
  return structuredClone([...cards]);
}

/**
 * Collects every projected hand available in a room view without revealing any
 * additional card faces. The focused hand is authoritative because it can
 * contain information that the matching player entry intentionally omits.
 */
export function replayPlayerHands(
  frame: Pick<ReplayFrame, "room" | "playerHands">,
): ReplayPlayerHands {
  const hands: ReplayPlayerHands = {};
  for (const player of frame.room.players) {
    if (player.cards) hands[player.id] = cloneCards(player.cards);
  }

  const focusedPlayerId =
    frame.room.role === "spectator" ? frame.room.focusedPlayerId : frame.room.viewerId;
  if (focusedPlayerId) hands[focusedPlayerId] = cloneCards(frame.room.hand);

  for (const [playerId, cards] of Object.entries(frame.playerHands ?? {})) {
    hands[playerId] = cloneCards(cards);
  }
  return hands;
}

export function replayPerspectivePlayerId(
  frame: Pick<ReplayFrame, "room">,
  requestedPlayerId?: string,
): string | undefined {
  const available = frame.room.players.filter((player) => player.present !== false);
  if (requestedPlayerId && available.some((player) => player.id === requestedPlayerId)) {
    return requestedPlayerId;
  }
  if (
    frame.room.focusedPlayerId &&
    available.some((player) => player.id === frame.room.focusedPlayerId)
  ) {
    return frame.room.focusedPlayerId;
  }
  if (available.some((player) => player.id === frame.room.viewerId)) {
    return frame.room.viewerId;
  }
  return available[0]?.id;
}

function replayObserverId(room: RoomView): string {
  let observerId = `replay-observer:${room.viewerId}`;
  while (room.players.some((player) => player.id === observerId)) observerId = `_${observerId}`;
  return observerId;
}

/**
 * Adapts a recorded client projection to SalonScene's read-only spectator
 * contract. Unknown cards stay hidden; this function never manufactures card
 * faces that were absent from the replay frame.
 */
export function replayRoomForPerspective(frame: ReplayFrame, requestedPlayerId?: string): RoomView {
  const room = frame.room;
  const focusedPlayerId = replayPerspectivePlayerId(frame, requestedPlayerId);
  const hands = replayPlayerHands(frame);
  const replayRoom: RoomView = {
    ...room,
    role: "spectator",
    viewerId: replayObserverId(room),
    players: room.players.map((player) => {
      const cards = hands[player.id];
      return {
        ...player,
        ...(cards ? { cards: cloneCards(cards) } : {}),
      };
    }),
    hand: focusedPlayerId ? cloneCards(hands[focusedPlayerId] ?? []) : [],
  };
  if (focusedPlayerId) replayRoom.focusedPlayerId = focusedPlayerId;
  else delete replayRoom.focusedPlayerId;
  return replayRoom;
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

  const roomSnapshot = cloneRoomView(room);
  const next = [
    ...current,
    {
      capturedAtMs,
      room: roomSnapshot,
      playerHands: replayPlayerHands({ room: roomSnapshot }),
    },
  ];
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
