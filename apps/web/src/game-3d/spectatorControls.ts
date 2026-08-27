export type OrbitPoint = { x: number; y: number; z: number };

export const FREE_ROAM_GROUND_Y = 0.05;
export const FREE_ROAM_JUMP_VELOCITY = 5.2;
export const FREE_ROAM_GRAVITY = 12.8;
export const FREE_ROAM_AVATAR_CLEARANCE = 1.4;

export function freeRoamSpawn(viewerId: string): { x: number; z: number; yaw: number } {
  let hash = 2166136261;
  for (const character of viewerId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  const slot = (hash >>> 0) % 16;
  const angle = Math.PI / 2 + (slot / 16) * Math.PI * 2;
  const radius = 7.2 + (((hash >>> 4) & 1) === 0 ? 0 : 1.15);
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return { x, z, yaw: Math.atan2(-x, z) };
}

function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Advances a camera around the table centre without cutting through the table.
 * Radius and height may still ease when mobile/keyboard layouts change.
 */
export function stepOrbitArc(current: OrbitPoint, target: OrbitPoint, factor: number): OrbitPoint {
  const progress = Math.max(0, Math.min(factor, 1));
  const currentRadius = Math.hypot(current.x, current.z);
  const targetRadius = Math.hypot(target.x, target.z);
  if (currentRadius < 0.001 || targetRadius < 0.001) {
    return {
      x: current.x + (target.x - current.x) * progress,
      y: current.y + (target.y - current.y) * progress,
      z: current.z + (target.z - current.z) * progress,
    };
  }
  const currentAngle = Math.atan2(current.z, current.x);
  const targetAngle = Math.atan2(target.z, target.x);
  const angle = currentAngle + shortestAngleDelta(currentAngle, targetAngle) * progress;
  const radius = currentRadius + (targetRadius - currentRadius) * progress;
  return {
    x: Math.cos(angle) * radius,
    y: current.y + (target.y - current.y) * progress,
    z: Math.sin(angle) * radius,
  };
}

export function shouldUseSpectatorOrbitArc(
  spectator: boolean,
  effectPerspective: "actor" | "victim" | "observer" | undefined,
  effectOverview: boolean,
): boolean {
  return spectator && !effectPerspective && !effectOverview;
}

export function canRequestFreeRoamPointerLock(
  mobile: boolean,
  controlsPaused: boolean,
  mouseButton: number,
): boolean {
  return !mobile && !controlsPaused && mouseButton === 0;
}

export function mobileFreeRoamControlsStyle(mobile: boolean):
  | {
      left: string;
      right: "auto";
    }
  | undefined {
  return mobile
    ? {
        left: "max(0.65rem, env(safe-area-inset-left))",
        right: "auto",
      }
    : undefined;
}

/** Keeps a spectator over the broad floor, without wall, table, or seat collision. */
export function containFreeRoamPosition(target: { x: number; z: number }, _mobile: boolean): void {
  target.x = Math.max(-13.5, Math.min(target.x, 13.5));
  target.z = Math.max(-13.5, Math.min(target.z, 13.5));
}

/** Separates only free-roaming avatars; seated players and the table stay traversable. */
export function separateFreeRoamAvatars(
  target: { x: number; z: number },
  remotePoses: ReadonlyMap<string, { x: number; z: number }>,
  selfId: string,
  clearance = FREE_ROAM_AVATAR_CLEARANCE,
): void {
  for (const [remoteId, pose] of [...remotePoses].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (remoteId === selfId) continue;
    let dx = target.x - pose.x;
    let dz = target.z - pose.z;
    let distance = Math.hypot(dx, dz);
    if (distance >= clearance) continue;
    if (distance < 0.001) {
      dx = selfId.localeCompare(remoteId) <= 0 ? 1 : -1;
      dz = 0;
      distance = 1;
    }
    target.x = pose.x + (dx / distance) * clearance;
    target.z = pose.z + (dz / distance) * clearance;
  }
}

/** Prevents a roaming spectator from occupying the same body space as a visible seated avatar. */
export function separateFreeRoamFromSeats(
  target: { x: number; z: number },
  seatedAvatars: readonly { x: number; z: number }[],
  clearance = FREE_ROAM_AVATAR_CLEARANCE,
): void {
  for (const [index, seat] of seatedAvatars.entries()) {
    let dx = target.x - seat.x;
    let dz = target.z - seat.z;
    let distance = Math.hypot(dx, dz);
    if (distance >= clearance) continue;
    if (distance < 0.001) {
      const angle = (index * 2.399963229728653 + Math.PI / 4) % (Math.PI * 2);
      dx = Math.cos(angle);
      dz = Math.sin(angle);
      distance = 1;
    }
    target.x = seat.x + (dx / distance) * clearance;
    target.z = seat.z + (dz / distance) * clearance;
  }
}

export function stepFreeRoamVertical(
  height: number,
  velocity: number,
  delta: number,
  jumpRequested: boolean,
): { height: number; velocity: number } {
  let nextVelocity =
    jumpRequested && height <= FREE_ROAM_GROUND_Y + 0.001 ? FREE_ROAM_JUMP_VELOCITY : velocity;
  nextVelocity -= FREE_ROAM_GRAVITY * delta;
  const nextHeight = Math.max(FREE_ROAM_GROUND_Y, height + nextVelocity * delta);
  if (nextHeight <= FREE_ROAM_GROUND_Y) nextVelocity = 0;
  return { height: nextHeight, velocity: nextVelocity };
}
