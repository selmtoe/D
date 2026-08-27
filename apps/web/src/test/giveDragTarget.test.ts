import { defaultAvatar } from "@daifugo/avatar-schema";
import { Group, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { CardView, PlayerView } from "../app/model";
import {
  canInspectProjectedOpponentHand,
  canInspectSpectatorOpponentHand,
  containFreeRoamCamera,
  collectCardInteractionLayout,
  handCardHitArea,
  handCardInteractionLayout,
  hiddenSeatPlayerIdsForScene,
  isFreeRoamControlActivationKey,
  isGiveCardReturnTarget,
  nearestGiveTarget,
  opponentHandCardForDisplay,
  opponentHandRackPresentation,
  shouldShowOpponentFaceFromBack,
  playersAtTable,
  playersForPerspective,
  resetFreeRoamInput,
  sceneFrameRate,
  shouldDimCollectRackCard,
  shouldDimHandCard,
  shouldExitFreeRoam,
  shouldIgnoreFreeRoamKeyboardTarget,
  shouldResetFreeRoamInput,
  shouldShowSeatedAvatar,
  stealCardHitArea,
  stealCardInteractionLayout,
} from "../game-3d/SalonScene";
import { dragPointInParentSpace, hitAreaCounterRotation } from "../game-3d/Card3D";

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
  it("lets a following spectator inspect only hands other than the possessed player", () => {
    expect(canInspectSpectatorOpponentHand("spectator", "follow", "right", "self")).toBe(true);
    expect(canInspectSpectatorOpponentHand("spectator", "follow", "self", "self")).toBe(false);
    expect(canInspectSpectatorOpponentHand("spectator", "free", "right", "self")).toBe(false);
    expect(canInspectSpectatorOpponentHand("player", "follow", "right", "self")).toBe(false);
  });

  it("allows free spectators and blind-mode players to inspect projected opponent cards", () => {
    expect(canInspectProjectedOpponentHand("spectator", "free", "normal", "right", "self")).toBe(
      true,
    );
    expect(canInspectProjectedOpponentHand("player", "follow", "blind", "right", "self")).toBe(
      true,
    );
    expect(canInspectProjectedOpponentHand("player", "follow", "normal", "right", "self")).toBe(
      false,
    );
    expect(canInspectProjectedOpponentHand("player", "follow", "blind", "self", "self")).toBe(
      false,
    );
  });

  it("accepts only an eligible seat near the drop point", () => {
    const eligible = new Set(["right", "opposite"]);
    expect(nearestGiveTarget(players, eligible, [-5.35, 1.2, 0.1])).toBe("right");
    expect(nearestGiveTarget(players, eligible, [0, 1.2, -5.3])).toBe("opposite");
    expect(nearestGiveTarget(players, eligible, [5.4, 1.2, 0])).toBeUndefined();
    expect(nearestGiveTarget(players, eligible, [0, 1.2, 0])).toBeUndefined();
  });

  it.each([false, true])(
    "returns an assigned card only inside the own-hand region (mobile=%s)",
    (mobile) => {
      expect(isGiveCardReturnTarget([0, 1.32, 4.1], mobile)).toBe(true);
      expect(isGiveCardReturnTarget([0, 1.32, 2.9], mobile)).toBe(false);
      expect(isGiveCardReturnTarget([0, 1.32, 6.1], mobile)).toBe(false);
      expect(isGiveCardReturnTarget([mobile ? 4 : 5.3, 1.32, 4.1], mobile)).toBe(false);
    },
  );

  it("converts nested assigned-card dragging back into its parent coordinate space", () => {
    const parent = new Group();
    parent.position.set(-4, 0.5, 2);
    parent.rotation.y = Math.PI / 2;
    parent.updateMatrixWorld(true);
    const localPoint = new Vector3(0.75, 1.32, -0.4);
    const worldPoint = localPoint.clone().applyMatrix4(parent.matrixWorld);

    expect(dragPointInParentSpace(parent, worldPoint)).toEqual([
      expect.closeTo(localPoint.x),
      expect.closeTo(localPoint.y),
      expect.closeTo(localPoint.z),
    ]);
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

  it.each([false, true])("covers one whole opponent card (mobile=%s)", (mobile) => {
    expect(stealCardHitArea(0, 1, mobile)).toEqual({ width: 1.22, offsetX: 0 });
  });

  it.each([false, true])("adds only the outer wings for a card row (mobile=%s)", (mobile) => {
    const layout = stealCardInteractionLayout(mobile);
    const first = stealCardHitArea(0, 8, mobile);
    const last = stealCardHitArea(7, 8, mobile);
    const centerHalfWorld = (layout.hitAreaWidth * layout.scale) / 2;
    const cardHalfWorld = (1.22 * layout.scale) / 2;

    expect((first.offsetX - first.width / 2) * layout.scale).toBeCloseTo(-cardHalfWorld);
    expect((first.offsetX + first.width / 2) * layout.scale).toBeCloseTo(centerHalfWorld);
    expect((last.offsetX - last.width / 2) * layout.scale).toBeCloseTo(-centerHalfWorld);
    expect((last.offsetX + last.width / 2) * layout.scale).toBeCloseTo(cardHalfWorld);
  });
});

describe("opponent hand ownership orientation", () => {
  it("uses a fixed inner-table rack whose front faces back toward its owner", () => {
    const presentation = opponentHandRackPresentation();

    expect(presentation.cameraFacing).toBe(false);
    expect(presentation.position[2]).toBeGreaterThan(0);
    expect(presentation.rotation).toEqual([0, Math.PI, 0]);
  });

  it("allows a camera-facing rack only while A-steal interaction is active", () => {
    expect(opponentHandRackPresentation("steal")).toMatchObject({
      cameraFacing: true,
      rotation: [0, 0, 0],
    });
    expect(opponentHandRackPresentation("give").cameraFacing).toBe(false);
    expect(opponentHandRackPresentation("collect").cameraFacing).toBe(false);
  });

  it("forces a normal opponent rack to card backs even if face data is present", () => {
    const face: CardView = {
      id: "opponent-secret",
      visibility: "face",
      suit: "heart",
      rank: "2",
      blind: false,
    };

    expect(opponentHandCardForDisplay(face, false)).toEqual({
      id: face.id,
      visibility: "hidden",
      blind: false,
    });
    expect(opponentHandCardForDisplay(face, true)).toBe(face);
  });

  it("keeps a blind opponent card face visible because blind faces are public", () => {
    const blindFace: CardView = {
      id: "opponent-blind",
      visibility: "face",
      suit: "diamond",
      rank: "9",
      blind: true,
    };

    expect(opponentHandCardForDisplay(blindFace, false)).toBe(blindFace);
    expect(shouldShowOpponentFaceFromBack(blindFace, false)).toBe(true);
  });
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
  it.each([false, true])(
    "covers each visible card while keeping neighboring rack rows separate (mobile=%s)",
    (mobile) => {
      const layout = collectCardInteractionLayout(mobile);

      expect(layout.hitAreaHeight).toBe(1.78);
      expect(layout.hitAreaHeight * layout.scale).toBeLessThan(layout.rowSpacing);
    },
  );

  it("keeps the own hand bright while the collect rack decides eligibility separately", () => {
    const noPlayableHandCards = new Set<string>();

    expect(shouldDimHandCard("hand-card", noPlayableHandCards, "collect")).toBe(false);
    expect(shouldDimHandCard("hand-card", noPlayableHandCards, "discard")).toBe(true);
    expect(shouldDimHandCard("hand-card", new Set(["hand-card"]), undefined)).toBe(false);
    expect(shouldDimCollectRackCard("rack-card", true, new Set())).toBe(true);
    expect(shouldDimCollectRackCard("rack-card", true, new Set(["rack-card"]))).toBe(false);
  });
});

describe("free-roam camera bounds", () => {
  it("lets the third-person camera cross the former walls and caps only distant travel", () => {
    const formerWalls = { x: -12, z: -13 };
    const distant = { x: 19, z: -21 };

    containFreeRoamCamera(formerWalls);
    containFreeRoamCamera(distant);

    expect(formerWalls).toEqual({ x: -12, z: -13 });
    expect(distant).toEqual({ x: 15, z: -15 });
  });
});

describe("3D frame scheduling", () => {
  it("keeps full frame rates only for active scene motion", () => {
    expect(sceneFrameRate(false, true, false)).toBe(60);
    expect(sceneFrameRate(true, true, false)).toBe(30);
    expect(sceneFrameRate(false, false, true)).toBe(60);
    expect(sceneFrameRate(true, false, true)).toBe(30);
    expect(sceneFrameRate(false, false, false)).toBe(8);
    expect(sceneFrameRate(true, false, false)).toBe(1);
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

  it("keeps chat Escape local and releases hidden mobile controls", () => {
    const input = document.createElement("input");
    expect(shouldExitFreeRoam("Escape", input)).toBe(false);
    expect(shouldExitFreeRoam("Escape", document.createElement("button"))).toBe(true);
    expect(shouldResetFreeRoamInput("free", true)).toBe(true);
    expect(shouldResetFreeRoamInput("free", false)).toBe(false);
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

describe("card hit-area fan compensation", () => {
  it("cancels only the fan angle so tall hit planes do not cover neighboring strips", () => {
    expect(hitAreaCounterRotation([-0.42, 0, -0.3325])).toEqual([0, 0, 0.3325]);
    expect(hitAreaCounterRotation([-0.42, 0, 0.21])).toEqual([0, 0, -0.21]);
  });

  it("removes the tall plane's horizontal projection with the actual Three.js transforms", () => {
    const rotation: [number, number, number] = [-0.42, 0, -0.3325];
    const width = handCardHitArea(0, 20, false).width;
    const height = 2.32;
    const scale = handCardInteractionLayout(20, false).scale;
    const cardGroup = new Group();
    cardGroup.rotation.set(...rotation);
    cardGroup.scale.setScalar(scale);
    const hitGroup = new Group();
    hitGroup.rotation.set(...hitAreaCounterRotation(rotation));
    cardGroup.add(hitGroup);
    cardGroup.updateMatrixWorld(true);
    const corners = [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [-width / 2, height / 2],
      [width / 2, height / 2],
    ].map(([x, y]) => new Vector3(x, y, 0).applyMatrix4(hitGroup.matrixWorld));
    const projectedWidth =
      Math.max(...corners.map((point) => point.x)) - Math.min(...corners.map((point) => point.x));

    expect(projectedWidth).toBeCloseTo(width * scale, 10);
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

  it("rotates a player view so the viewer owns the front seat", () => {
    expect(playersForPerspective(players, "player", "opposite").map((player) => player.id)).toEqual(
      ["opposite", "left", "self", "right"],
    );
    expect(playersForPerspective(players, "spectator", "opposite")).toEqual(players);
  });

  it("hides a finished viewer's old avatar without removing its canonical seat", () => {
    const finishedViewer = { ...players[1]!, status: "finished" as const };
    const tablePlayers = playersAtTable([players[0]!, finishedViewer, players[2]!, players[3]!]);

    expect(tablePlayers).toHaveLength(4);
    const hiddenSeatPlayerIds = new Set([finishedViewer.id]);
    expect(shouldShowSeatedAvatar(finishedViewer.id, hiddenSeatPlayerIds)).toBe(false);
    expect(shouldShowSeatedAvatar(players[0]!.id, hiddenSeatPlayerIds)).toBe(true);
  });

  it("hides another finished player's old seat while their remote spectator pose is active", () => {
    const remoteFreeRoamIds = new Set([players[2]!.id]);

    expect(shouldShowSeatedAvatar(players[2]!.id, remoteFreeRoamIds)).toBe(false);
    expect(shouldShowSeatedAvatar(players[3]!.id, remoteFreeRoamIds)).toBe(true);
  });

  it("hides both the finished viewer's old seat and the followed player's avatar", () => {
    const hiddenSeatPlayerIds = hiddenSeatPlayerIdsForScene("finished-viewer", "followed-player", [
      "remote-free-roamer",
    ]);

    expect([...hiddenSeatPlayerIds]).toEqual([
      "finished-viewer",
      "followed-player",
      "remote-free-roamer",
    ]);
    expect(shouldShowSeatedAvatar("finished-viewer", hiddenSeatPlayerIds)).toBe(false);
    expect(shouldShowSeatedAvatar("followed-player", hiddenSeatPlayerIds)).toBe(false);
    expect(shouldShowSeatedAvatar("still-seated", hiddenSeatPlayerIds)).toBe(true);
  });
});
