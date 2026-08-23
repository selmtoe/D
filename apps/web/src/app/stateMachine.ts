import type { AppEvent, AppPhase, AppState, RoomView } from "./model";

export const initialAppState: AppState = { phase: "BOOT", connection: "connecting" };

export function phaseForRoom(room: RoomView): AppPhase {
  if (room.phase === "waiting") return "ROOM_WAITING";
  if (room.phase === "dealing") return "DEALING";
  if (room.phase === "effect") return "AWAITING_FORCED_EFFECT";
  if (room.phase === "finished") return "FINISHED";
  return "PLAYING_TURN";
}

export function retainSelectedCardIds(
  selectedIds: readonly string[],
  previousRoom: RoomView | undefined,
  nextRoom: RoomView,
): string[] {
  if (previousRoom?.roomId !== nextRoom.roomId || previousRoom.gameId !== nextRoom.gameId)
    return [];
  const available = new Set(nextRoom.hand.map((card) => card.id));
  return selectedIds.filter((id) => available.has(id));
}

export function transition(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case "BOOT":
      return state.phase === "BOOT"
        ? { ...state, phase: "AUTHENTICATING", connection: "connecting", error: undefined }
        : state;
    case "AUTH_OK":
      return state.phase === "AUTHENTICATING"
        ? { ...state, phase: "ENTRANCE", connection: "connected", error: undefined }
        : state;
    case "AUTH_FAILED":
      return { ...state, phase: "ENTRANCE", connection: "offline", error: event.message };
    case "ENTER_SALON":
      return state.phase === "ENTRANCE"
        ? { ...state, phase: "SALON_LOBBY", profile: event.profile, error: undefined }
        : state;
    case "RESTORE_PROFILE":
      return { ...state, profile: event.profile };
    case "ROOM_VIEW":
      if (
        state.room?.roomId === event.room.roomId &&
        state.room.gameId === event.room.gameId &&
        event.room.revision <= state.room.revision
      ) {
        return state;
      }
      return {
        ...state,
        room: event.room,
        role: event.room.role,
        phase:
          state.phase === "DEALING" &&
          state.room?.roomId === event.room.roomId &&
          state.room.gameId === event.room.gameId &&
          event.room.phase === "playing"
            ? "DEALING"
            : state.room?.phase === "waiting" &&
                event.room.phase === "playing" &&
                state.room.gameId !== event.room.gameId
              ? "DEALING"
              : phaseForRoom(event.room),
        connection: "connected",
        error: undefined,
      };
    case "DEALING_DONE":
      return state.phase === "DEALING" ? { ...state, phase: "PLAYING_TURN" } : state;
    case "LEAVE_ROOM":
      return { phase: "SALON_LOBBY", connection: state.connection, profile: state.profile };
    case "EVICTED":
      return {
        phase: "SALON_LOBBY",
        // An eviction is itself an authoritative network message. The room
        // session ended, but the lobby transport is still available.
        connection: "connected",
        profile: state.profile,
        error: event.message,
      };
    case "CONNECTION":
      return { ...state, connection: event.connection };
    case "ERROR":
      return { ...state, error: event.message };
    case "CLEAR_ERROR":
      return { ...state, error: undefined };
  }
}
