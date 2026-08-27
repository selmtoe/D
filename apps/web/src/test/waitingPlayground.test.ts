import { describe, expect, it } from "vitest";
import {
  applyPlaygroundLook,
  playgroundPerformanceProfile,
  stepPlaygroundPosition,
} from "../waiting-3d/controls";

describe("waiting playground controls", () => {
  it("turns right for a rightward pointer movement and clamps vertical look", () => {
    const right = applyPlaygroundLook({ yaw: 0, pitch: 0 }, 20, 0);
    expect(right.yaw).toBeLessThan(0);

    const vertical = applyPlaygroundLook({ yaw: 0, pitch: 0 }, 0, 100_000);
    expect(Math.abs(vertical.pitch)).toBeLessThan(Math.PI / 2);
  });

  it("moves forward in the camera direction and keeps the player on the playground", () => {
    expect(
      stepPlaygroundPosition({ x: 0, z: 0 }, { yaw: 0, pitch: 0 }, { forward: 1, right: 0 }, 2),
    ).toEqual({ x: 0, z: -2 });

    const edge = stepPlaygroundPosition(
      { x: 10.7, z: 10.7 },
      { yaw: 0, pitch: 0 },
      { forward: -1, right: 1 },
      8,
    );
    expect(edge.x).toBeLessThanOrEqual(10.8);
    expect(edge.z).toBeLessThanOrEqual(10.8);
  });

  it("uses a restrained renderer profile on mobile, low-power, and reduced-motion devices", () => {
    const full = playgroundPerformanceProfile({
      lowPower: false,
      mobile: false,
      reducedMotion: false,
      hardwareConcurrency: 12,
      deviceMemory: 16,
    });
    const mobile = playgroundPerformanceProfile({
      lowPower: false,
      mobile: true,
      reducedMotion: false,
    });
    const reduced = playgroundPerformanceProfile({
      lowPower: false,
      mobile: false,
      reducedMotion: true,
    });

    expect(full).toMatchObject({ fps: 60, shadows: true, economical: false });
    expect(mobile).toMatchObject({ fps: 30, shadows: false, economical: true });
    expect(reduced).toMatchObject({ fps: 24, shadows: false, economical: true });
  });
});
