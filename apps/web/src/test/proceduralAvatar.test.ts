import { avatarCatalog } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import {
  animationNames,
  animationPose,
  avatarFacingYaw,
  proceduralPartStyle,
  type CatalogKey,
} from "../avatar-3d/proceduralAvatar";

describe("procedural avatar catalog", () => {
  it("gives every non-none catalog ID a deterministic unique geometry signature", () => {
    for (const [key, ids] of Object.entries(avatarCatalog) as [CatalogKey, readonly string[]][]) {
      if (key === "animationSetId") continue;
      const active = ids.filter((id) => id !== "none");
      const first = active.map((id) => proceduralPartStyle(key, id));
      const second = active.map((id) => proceduralPartStyle(key, id));
      expect(second).toEqual(first);
      expect(new Set(first.map((style) => style.signature)).size, key).toBe(active.length);
    }
  });

  it("connects all 24 animation IDs to named, distinct semantic poses", () => {
    expect(animationNames).toHaveLength(24);
    expect(new Set(animationNames).size).toBe(24);
    const signatures = avatarCatalog.animationSetId.map((id) =>
      JSON.stringify(animationPose(id, 0.73, false)),
    );
    expect(new Set(signatures).size).toBe(24);
  });

  it("turns the avatar front toward the supplied first-person view yaw", () => {
    expect(avatarFacingYaw(undefined)).toBe(0);
    expect(avatarFacingYaw(0)).toBeCloseTo(Math.PI);
    expect(avatarFacingYaw(Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(avatarFacingYaw(-Math.PI / 2, 0.2)).toBeCloseTo(Math.PI / 2 + 0.2);
  });
});
