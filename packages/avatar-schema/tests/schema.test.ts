import { describe, expect, it } from "vitest";
import { avatarCatalog, defaultAvatar, migrateAvatar, randomAvatar, validateAvatar } from "../src";

describe("avatar schema", () => {
  it("accepts the default profile", () =>
    expect(validateAvatar(defaultAvatar)).toEqual(defaultAvatar));
  it("rejects arbitrary mesh ids", () =>
    expect(() =>
      validateAvatar({ ...defaultAvatar, parts: { ...defaultAvatar.parts, hair: "uploaded.glb" } }),
    ).toThrow());
  it("migrates corrupt legacy data to a safe preset", () =>
    expect(migrateAvatar({ strokes: [] })).toEqual(defaultAvatar));
  it("generates valid profiles", () =>
    expect(validateAvatar(randomAvatar(() => 0.25))).toBeTruthy());
  it("contains every required distinct part family", () =>
    expect({
      skin: avatarCatalog.skinTone.length,
      heads: avatarCatalog.headPresetId.length,
      bodies: avatarCatalog.bodyPresetId.length,
      eyes: avatarCatalog.eyes.length,
      iris: avatarCatalog.iris.length,
      hair: avatarCatalog.hair.length,
      tops: avatarCatalog.tops.length,
      animations: avatarCatalog.animationSetId.length,
    }).toEqual({
      skin: 24,
      heads: 16,
      bodies: 12,
      eyes: 36,
      iris: 18,
      hair: 72,
      tops: 60,
      animations: 24,
    }));
});
