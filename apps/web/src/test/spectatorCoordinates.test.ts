import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { PlayerView } from "../app/model";
import {
  canonicalPoseMapToView,
  canonicalPoseToView,
  tablePerspectiveRotation,
  viewPoseToCanonical,
} from "../game-3d/spectatorCoordinates";

const players: PlayerView[] = ["p1", "p2", "p3", "p4"].map((id) => ({
  id,
  name: id,
  avatar: defaultAvatar,
  cardCount: 1,
  connection: "online",
  status: "active",
  host: id === "p1",
}));

describe("spectator canonical table coordinates", () => {
  it("derives the scene rotation from the visible viewpoint seat", () => {
    expect(tablePerspectiveRotation(players, "player", "p3")).toBeCloseTo(Math.PI);
    expect(tablePerspectiveRotation(players, "spectator", "watcher", "p3", "follow")).toBeCloseTo(
      Math.PI,
    );
    expect(tablePerspectiveRotation(players, "spectator", "watcher", "p3", "free")).toBe(0);
  });

  it("ignores departed seats without changing canonical geometry for present players", () => {
    const withDeparture = players.map((player) =>
      player.id === "p2" ? { ...player, present: false } : player,
    );
    expect(tablePerspectiveRotation(withDeparture, "player", "p3")).toBeCloseTo((Math.PI * 2) / 3);
  });

  it("round-trips position and facing between canonical and viewer-relative space", () => {
    const canonical = { x: 2.4, y: 0.05, z: -3.1, yaw: 2.75, moving: true };
    const rotation = (Math.PI * 3) / 2;
    const viewed = canonicalPoseToView(canonical, rotation);
    const restored = viewPoseToCanonical(viewed, rotation);

    expect(restored.x).toBeCloseTo(canonical.x);
    expect(restored.z).toBeCloseTo(canonical.z);
    expect(restored.yaw).toBeCloseTo(canonical.yaw);
    expect(restored.y).toBe(canonical.y);
    expect(restored.moving).toBe(true);
  });

  it("transforms every remote pose while preserving cue metadata", () => {
    const cue = {
      x: 0,
      y: 0.05,
      z: 5,
      yaw: 0,
      moving: false,
      freeSpectating: true,
      atMs: 123,
    };
    const transformed = canonicalPoseMapToView(new Map([["spectator", cue]]), Math.PI / 2).get(
      "spectator",
    );

    expect(transformed?.x).toBeCloseTo(5);
    expect(transformed?.z).toBeCloseTo(0);
    expect(transformed?.yaw).toBeCloseTo(-Math.PI / 2);
    expect(transformed?.atMs).toBe(123);
  });

  it("shows one canonical spectator pose consistently from every table viewpoint", () => {
    const canonical = { x: 0, y: 0.05, z: 6, yaw: 0, moving: true };
    const expected = [
      { x: 0, z: 6, yaw: 0 },
      { x: 6, z: 0, yaw: -Math.PI / 2 },
      { x: 0, z: -6, yaw: -Math.PI },
      { x: -6, z: 0, yaw: Math.PI / 2 },
    ];

    players.forEach((player, index) => {
      const rotation = tablePerspectiveRotation(players, "player", player.id);
      const viewed = canonicalPoseToView(canonical, rotation);
      expect(viewed.x).toBeCloseTo(expected[index]!.x);
      expect(viewed.z).toBeCloseTo(expected[index]!.z);
      expect(viewed.yaw).toBeCloseTo(expected[index]!.yaw);
      expect(Math.hypot(viewed.x, viewed.z)).toBeCloseTo(6);
    });
  });
});
