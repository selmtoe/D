import { describe, expect, it } from "vitest";
import {
  characterNameForDisplay,
  currentTurnSpotlightPresentation,
} from "../game-3d/PlayerPresentation";

describe("3D player presentation", () => {
  it("keeps Japanese names intact while normalizing surrounding whitespace", () => {
    expect(characterNameForDisplay("  山田　太郎  ")).toBe("山田 太郎");
    expect(characterNameForDisplay("　 ")).toBe("プレイヤー");
  });

  it("uses restrained lower-cost spotlight geometry on mobile and low-power devices", () => {
    const desktop = currentTurnSpotlightPresentation(false, false);
    const mobile = currentTurnSpotlightPresentation(false, true);
    const lowPower = currentTurnSpotlightPresentation(true, false);

    expect(mobile.intensity).toBeLessThan(desktop.intensity);
    expect(mobile.segments).toBeLessThan(desktop.segments);
    expect(lowPower.intensity).toBeLessThan(mobile.intensity);
    expect(lowPower.segments).toBeLessThan(mobile.segments);
    expect(desktop.poolOpacity).toBeLessThanOrEqual(0.1);
  });
});
