import { MathUtils } from "three";

export type PlaygroundMovement = {
  forward: number;
  right: number;
};

export type PlaygroundLook = {
  yaw: number;
  pitch: number;
};

export type PlaygroundPosition = {
  x: number;
  z: number;
};

export type PlaygroundPerformanceProfile = {
  dpr: number | [number, number];
  fps: number;
  shadows: boolean;
  economical: boolean;
};

const MAX_PITCH = Math.PI * 0.47;
const PLAYGROUND_BOUNDARY = 10.8;

export function applyPlaygroundLook(
  look: PlaygroundLook,
  movementX: number,
  movementY: number,
  sensitivity = 0.0024,
): PlaygroundLook {
  return {
    // A rightward mouse/finger movement turns the camera to the right.
    yaw: look.yaw - movementX * sensitivity,
    pitch: MathUtils.clamp(look.pitch - movementY * sensitivity, -MAX_PITCH, MAX_PITCH),
  };
}

export function stepPlaygroundPosition(
  position: PlaygroundPosition,
  look: PlaygroundLook,
  movement: PlaygroundMovement,
  distance: number,
): PlaygroundPosition {
  const magnitude = Math.hypot(movement.forward, movement.right);
  if (magnitude < 0.001) return position;
  const forward = movement.forward / Math.max(1, magnitude);
  const right = movement.right / Math.max(1, magnitude);
  const x = position.x + (-Math.sin(look.yaw) * forward + Math.cos(look.yaw) * right) * distance;
  const z = position.z + (-Math.cos(look.yaw) * forward - Math.sin(look.yaw) * right) * distance;
  return {
    x: MathUtils.clamp(x, -PLAYGROUND_BOUNDARY, PLAYGROUND_BOUNDARY),
    z: MathUtils.clamp(z, -PLAYGROUND_BOUNDARY, PLAYGROUND_BOUNDARY),
  };
}

export function playgroundPerformanceProfile({
  lowPower,
  mobile,
  reducedMotion,
  hardwareConcurrency,
  deviceMemory,
}: {
  lowPower: boolean;
  mobile: boolean;
  reducedMotion: boolean;
  hardwareConcurrency?: number | undefined;
  deviceMemory?: number | undefined;
}): PlaygroundPerformanceProfile {
  const limitedDevice =
    (hardwareConcurrency !== undefined && hardwareConcurrency <= 4) ||
    (deviceMemory !== undefined && deviceMemory <= 4);
  const economical = lowPower || mobile || reducedMotion || limitedDevice;
  return {
    dpr: economical ? (mobile ? 0.72 : 0.85) : [1, 1.45],
    fps: reducedMotion ? 24 : economical ? 30 : 60,
    shadows: !economical,
    economical,
  };
}
