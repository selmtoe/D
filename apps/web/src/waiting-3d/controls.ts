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

export function containPlaygroundPosition(position: PlaygroundPosition): PlaygroundPosition {
  return {
    x: MathUtils.clamp(position.x, -PLAYGROUND_BOUNDARY, PLAYGROUND_BOUNDARY),
    z: MathUtils.clamp(position.z, -PLAYGROUND_BOUNDARY, PLAYGROUND_BOUNDARY),
  };
}

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
  return containPlaygroundPosition({ x, z });
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
  const performanceLimited = lowPower || limitedDevice;
  return {
    // Low-power mode preserves native sharpness and antialiasing. It saves work
    // through frame rate, shadows, and effects instead of reducing image quality.
    dpr: [1, mobile ? 1.35 : 1.45],
    fps: reducedMotion ? 30 : performanceLimited ? 30 : mobile ? 45 : 60,
    shadows: !performanceLimited && !mobile,
    economical: false,
  };
}
