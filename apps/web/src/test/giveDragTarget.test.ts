import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { PlayerView } from "../app/model";
import { containFreeRoamCamera, nearestGiveTarget } from "../game-3d/SalonScene";

const players: PlayerView[] = ["self", "right", "opposite", "left"].map((id) => ({
  id,
  name: id,
  avatar: defaultAvatar,
  cardCount: 1,
  connection: "online",
  status: "active",
  host: id === "self",
}));

describe("7-give drag target", () => {
  it("accepts only an eligible seat near the drop point", () => {
    const eligible = new Set(["right", "opposite"]);
    expect(nearestGiveTarget(players, eligible, [-5.35, 1.2, 0.1])).toBe("right");
    expect(nearestGiveTarget(players, eligible, [0, 1.2, -5.3])).toBe("opposite");
    expect(nearestGiveTarget(players, eligible, [5.4, 1.2, 0])).toBeUndefined();
    expect(nearestGiveTarget(players, eligible, [0, 1.2, 0])).toBeUndefined();
  });
});

describe("free-roam camera bounds", () => {
  it("keeps the third-person camera in front of the solid salon walls", () => {
    const behindLeftWall = { x: -12, z: 3 };
    const behindRightAndRearWalls = { x: 11, z: -13 };

    containFreeRoamCamera(behindLeftWall);
    containFreeRoamCamera(behindRightAndRearWalls);

    expect(behindLeftWall).toEqual({ x: -6.62, z: 3 });
    expect(behindRightAndRearWalls).toEqual({ x: 6.62, z: -7.62 });
  });
});
