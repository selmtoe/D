import type { PlayerView, RoomView } from "../app/model";

type TablePose = {
  x: number;
  z: number;
  yaw: number;
};

function normalizeYaw(yaw: number): number {
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

/**
 * Every authority projection keeps one canonical player order. Player views and follow-spectator
 * views rotate that order so their viewpoint seat starts at index zero. Free spectators retain the
 * canonical table. Shared spectator poses therefore use the same rotation as the displayed seats.
 */
export function tablePerspectiveRotation(
  players: readonly PlayerView[],
  role: RoomView["role"],
  viewerId: string,
  focusedPlayerId?: string,
  spectatorMode: "follow" | "free" = "free",
): number {
  const visiblePlayers = players.filter((player) => player.present !== false);
  const viewpointId =
    role === "spectator" ? (spectatorMode === "follow" ? focusedPlayerId : undefined) : viewerId;
  if (!viewpointId) return 0;
  const viewpointIndex = visiblePlayers.findIndex((player) => player.id === viewpointId);
  if (viewpointIndex <= 0 || visiblePlayers.length < 2) return 0;
  return (viewpointIndex / visiblePlayers.length) * Math.PI * 2;
}

/** Rotate one authority-canonical pose into the seat-relative scene shown by this viewer. */
export function canonicalPoseToView<T extends TablePose>(pose: T, rotation: number): T {
  if (Math.abs(rotation) < Number.EPSILON) return pose;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return {
    ...pose,
    x: pose.x * cosine + pose.z * sine,
    z: -pose.x * sine + pose.z * cosine,
    yaw: normalizeYaw(pose.yaw - rotation),
  };
}

/** Convert a local scene pose back to the authority-canonical table coordinates sent to peers. */
export function viewPoseToCanonical<T extends TablePose>(pose: T, rotation: number): T {
  return canonicalPoseToView(pose, -rotation);
}

export function canonicalPoseMapToView<T extends TablePose>(
  poses: ReadonlyMap<string, T>,
  rotation: number,
): ReadonlyMap<string, T> {
  if (Math.abs(rotation) < Number.EPSILON) return poses;
  return new Map([...poses].map(([id, pose]) => [id, canonicalPoseToView(pose, rotation)]));
}
