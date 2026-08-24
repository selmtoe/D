import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { PlayerView } from "../app/model";
import {
  containFreeRoamCamera,
  collectCardInteractionLayout,
  handCardHitArea,
  handCardInteractionLayout,
  isFreeRoamControlActivationKey,
  nearestGiveTarget,
  playersAtTable,
  resetFreeRoamInput,
  shouldIgnoreFreeRoamKeyboardTarget,
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

      expect(layout.hitAreaWidth * layout.scale).toBeLessThan(layout.spacing);
    },
  );
});

describe("hand card hit areas", () => {
  it.each([
    [false, 2],
    [false, 20],
    [true, 2],
    [true, 20],
  ])("keeps neighboring input strips separate (mobile=%s, cards=%s)", (mobile, cardCount) => {
    const layout = handCardInteractionLayout(cardCount, mobile as boolean);

    expect(layout.hitAreaWidth * layout.scale).toBeLessThan(layout.spacing);
  });

  it.each([
    [false, 2],
    [false, 20],
    [true, 2],
    [true, 20],
  ])("adds only the visible outer wing to edge cards (mobile=%s, cards=%s)", (mobile, count) => {
    const cardCount = count as number;
    const layout = handCardInteractionLayout(cardCount, mobile as boolean);
    const first = handCardHitArea(0, cardCount, mobile as boolean);
    const last = handCardHitArea(cardCount - 1, cardCount, mobile as boolean);
    const centerHalfWorld = (layout.hitAreaWidth * layout.scale) / 2;
    const cardHalfWorld = (1.22 * layout.scale) / 2;

    expect((first.offsetX - first.width / 2) * layout.scale).toBeCloseTo(-cardHalfWorld);
    expect((first.offsetX + first.width / 2) * layout.scale).toBeCloseTo(centerHalfWorld);
    expect((last.offsetX - last.width / 2) * layout.scale).toBeCloseTo(-centerHalfWorld);
    expect((last.offsetX + last.width / 2) * layout.scale).toBeCloseTo(cardHalfWorld);
  });

  it("uses the whole visible card when the hand has one card", () => {
    expect(handCardHitArea(0, 1, true)).toEqual({ width: 1.22, offsetX: 0 });
  });
});

describe("K-collect card hit areas", () => {
  it.each([false, true])("keeps neighboring rack rows separate (mobile=%s)", (mobile) => {
    const layout = collectCardInteractionLayout(mobile);

    expect(layout.hitAreaHeight * layout.scale).toBeLessThan(layout.rowSpacing);
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

describe("free-roam input reset", () => {
  it("does not replay an old mobile jump after leaving free-roam mode", () => {
    expect(resetFreeRoamInput({ forward: 1, strafe: -1, turn: 1, jump: 4 })).toEqual({
      forward: 0,
      strafe: 0,
      turn: 0,
      jump: 0,
    });
  });

  it("keeps movement keys active after focusing a control button", () => {
    const button = document.createElement("button");
    const input = document.createElement("input");

    expect(shouldIgnoreFreeRoamKeyboardTarget(button)).toBe(false);
    expect(shouldIgnoreFreeRoamKeyboardTarget(input)).toBe(true);
    expect(isFreeRoamControlActivationKey("Enter")).toBe(true);
    expect(isFreeRoamControlActivationKey("Space")).toBe(true);
    expect(isFreeRoamControlActivationKey("KeyW")).toBe(false);
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
