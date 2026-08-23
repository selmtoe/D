import type { AppPhase } from "./model";

export function shouldClearRoomAfterViewLoss(
  phase: AppPhase,
  activeRoomId: string | undefined,
  roomId: string | undefined,
  joinedRoomId: string | undefined,
): boolean {
  return (
    phase === "SALON_LOBBY" && Boolean(activeRoomId) && !roomId && joinedRoomId === activeRoomId
  );
}
