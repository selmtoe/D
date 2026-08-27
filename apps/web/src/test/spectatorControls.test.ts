import { describe, expect, it } from "vitest";
import type { CardView } from "../app/model";
import { opponentHandCardForDisplay } from "../game-3d/SalonScene";
import {
  applyFreeRoamLookDelta,
  canRequestFreeRoamPointerLock,
  containFreeRoamPosition,
  FREE_ROAM_GROUND_Y,
  freeRoamSpawn,
  mobileFreeRoamControlsStyle,
  separateFreeRoamAvatars,
  separateFreeRoamFromSeats,
  shouldUseSpectatorOrbitArc,
  stepFreeRoamVertical,
  stepOrbitArc,
} from "../game-3d/spectatorControls";

describe("spectator-authorized card faces", () => {
  const face: CardView = {
    id: "spectator-visible-card",
    visibility: "face",
    suit: "heart",
    rank: "A",
    blind: true,
  };

  it("keeps public blind faces visible to opponents and spectators", () => {
    expect(opponentHandCardForDisplay(face, false, false)).toBe(face);
    expect(opponentHandCardForDisplay(face, false, true)).toBe(face);
  });
});

describe("spectator camera controls", () => {
  it("uses FPS pointer direction on desktop and touch drag", () => {
    expect(applyFreeRoamLookDelta(0, 0, 100, -20, false)).toEqual({
      yaw: 0.24,
      pitch: 0.04,
    });
    expect(applyFreeRoamLookDelta(0, 0, 100, -20, true)).toEqual({
      yaw: 0.4,
      pitch: 0.06,
    });
  });

  it("moves between possessed seats on a table-centred arc", () => {
    const next = stepOrbitArc({ x: 0, y: 6, z: 10 }, { x: -10, y: 8, z: 0 }, 0.5);

    expect(Math.hypot(next.x, next.z)).toBeCloseTo(10);
    expect(next.x).toBeCloseTo(-Math.sqrt(50));
    expect(next.z).toBeCloseTo(Math.sqrt(50));
    expect(next.y).toBe(7);
  });

  it("uses the orbit only for ordinary possessed spectator views", () => {
    expect(shouldUseSpectatorOrbitArc(true, undefined, false)).toBe(true);
    expect(shouldUseSpectatorOrbitArc(false, undefined, false)).toBe(false);
    expect(shouldUseSpectatorOrbitArc(true, "victim", false)).toBe(false);
    expect(shouldUseSpectatorOrbitArc(true, undefined, true)).toBe(false);
  });

  it("reserves pointer lock for an active desktop primary click", () => {
    expect(canRequestFreeRoamPointerLock(false, false, 0)).toBe(true);
    expect(canRequestFreeRoamPointerLock(true, false, 0)).toBe(false);
    expect(canRequestFreeRoamPointerLock(false, true, 0)).toBe(false);
    expect(canRequestFreeRoamPointerLock(false, false, 2)).toBe(false);
  });

  it("moves the mobile movement pad to the left without changing desktop layout", () => {
    expect(mobileFreeRoamControlsStyle(true)).toEqual({
      left: "max(0.65rem, env(safe-area-inset-left))",
      right: "auto",
    });
    expect(mobileFreeRoamControlsStyle(false)).toBeUndefined();
  });

  it("allows traversal through the table centre and occupied seat coordinates", () => {
    const tableCentre = { x: 0, z: 0 };
    const seatCentre = { x: 0, z: 5.45 };

    containFreeRoamPosition(tableCentre, false);
    containFreeRoamPosition(seatCentre, false);

    expect(tableCentre).toEqual({ x: 0, z: 0 });
    expect(seatCentre).toEqual({ x: 0, z: 5.45 });
  });

  it("opens the former wall area while retaining a distant floor-edge boundary", () => {
    const formerWall = { x: 7.4, z: -8.2 };
    const outsideFloor = { x: 20, z: -20 };

    containFreeRoamPosition(formerWall, false);
    containFreeRoamPosition(outsideFloor, false);

    expect(formerWall).toEqual({ x: 7.4, z: -8.2 });
    expect(outsideFloor).toEqual({ x: 13.5, z: -13.5 });
  });

  it("separates free-roaming avatars while leaving scene geometry traversable", () => {
    const sameSpot = { x: 1, z: 2 };
    separateFreeRoamAvatars(sameSpot, new Map([["watcher-b", { x: 1, z: 2 }]]), "watcher-a");

    expect(Math.hypot(sameSpot.x - 1, sameSpot.z - 2)).toBeCloseTo(1.4);
    const ownEcho = { x: 1, z: 2 };
    separateFreeRoamAvatars(ownEcho, new Map([["watcher-a", { x: 1, z: 2 }]]), "watcher-a");
    expect(ownEcho).toEqual({ x: 1, z: 2 });
  });

  it("keeps a roaming spectator from overlapping the host's visible avatar", () => {
    const sameAsHost = { x: 0, z: 5.45 };
    separateFreeRoamFromSeats(sameAsHost, [{ x: 0, z: 5.45 }]);

    expect(Math.hypot(sameAsHost.x, sameAsHost.z - 5.45)).toBeCloseTo(1.4, 5);
  });

  it("gives different spectator IDs stable entry positions", () => {
    expect(freeRoamSpawn("watcher-a")).toEqual(freeRoamSpawn("watcher-a"));
    expect(freeRoamSpawn("watcher-a")).not.toEqual(freeRoamSpawn("watcher-b"));
  });

  it("jumps above the tabletop before returning to the floor", () => {
    let height = FREE_ROAM_GROUND_Y;
    let velocity = 0;
    let peak = height;
    for (let frame = 0; frame < 180; frame += 1) {
      const next = stepFreeRoamVertical(height, velocity, 1 / 60, frame === 0);
      height = next.height;
      velocity = next.velocity;
      peak = Math.max(peak, height);
    }

    expect(peak).toBeGreaterThan(1);
    expect(height).toBe(FREE_ROAM_GROUND_Y);
  });
});
