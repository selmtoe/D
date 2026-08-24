import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { PlayerView } from "../app/model";
import {
  containFreeRoamCamera,
  nearestGiveTarget,
  playersAtTable,
  resetFreeRoamInput,
  stealCardInteractionLayout,
} from "../game-3d/SalonScene";

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

describe("A-steal card hit areas", () => {
  it.each([false, true])(
    "keeps adjacent card centers outside each hit area (mobile=%s)",
    (mobile) => {
      const layout = stealCardInteractionLayout(mobile);

      expect((layout.hitAreaWidth * layout.scale) / 2).toBeLessThan(layout.spacing);
    },
  );
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

describe("free-roam input reset", () => {
  it("does not replay an old mobile jump after leaving free-roam mode", () => {
    expect(resetFreeRoamInput({ forward: 1, strafe: -1, turn: 1, jump: 4 })).toEqual({
      forward: 0,
      strafe: 0,
      turn: 0,
      jump: 0,
    });
  });
});

describe("3D table membership", () => {
  it("keeps disconnected members during grace but removes players who left the room", () => {
    const departed = { ...players[1]!, connection: "offline" as const, present: false };
    const reconnecting = { ...players[2]!, connection: "grace" as const, present: true };

    expect(
      playersAtTable([players[0]!, departed, reconnecting]).map((player) => player.id),
    ).toEqual(["self", "opposite"]);
  });
});
