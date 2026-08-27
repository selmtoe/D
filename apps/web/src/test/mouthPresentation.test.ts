import { avatarCatalog } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import { beardPresentation, mouthPresentation } from "../avatar-3d/mouthPresentation";

describe("avatar mouth presentation", () => {
  it("keeps the five semantic mouth families horizontal with fixed arc rotations", () => {
    const neutral = mouthPresentation("mouth-1", "expression-1");
    const smile = mouthPresentation("mouth-2", "expression-1");
    const frown = mouthPresentation("mouth-3", "expression-1");
    const toothy = mouthPresentation("mouth-4", "expression-1");
    const surprised = mouthPresentation("mouth-5", "expression-1");

    expect([neutral.shape, smile.shape, frown.shape, toothy.shape, surprised.shape]).toEqual([
      "neutral",
      "smile",
      "frown",
      "toothy",
      "surprised",
    ]);
    expect(
      [neutral, smile, frown, toothy, surprised].every(
        (mouth) => mouth.orientation === "horizontal",
      ),
    ).toBe(true);
    expect(smile).toMatchObject({ rotationZ: Math.PI, arc: Math.PI });
    expect(frown).toMatchObject({ rotationZ: 0, arc: Math.PI });
    expect(surprised).toMatchObject({ rotationZ: 0, arc: Math.PI * 2 });
  });

  it("never applies the old quarter-turn to a semicircle catalog mouth", () => {
    for (const id of avatarCatalog.mouth) {
      const mouth = mouthPresentation(id, "expression-1");
      if (mouth.arc === Math.PI) expect(Math.abs(mouth.rotationZ)).not.toBeCloseTo(Math.PI / 2);
    }
  });

  it("keeps every beard semicircle horizontal around the chin", () => {
    for (const id of avatarCatalog.beard.filter((beardId) => beardId !== "none")) {
      const beard = beardPresentation(id);
      expect(beard.orientation).toBe("horizontal");
      expect(Math.abs(beard.rotationZ)).not.toBeCloseTo(Math.PI / 2);
      expect(beard.rotationZ).toBe(Math.PI);
    }
  });
});
