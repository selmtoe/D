import { describe, expect, it } from "vitest";
import {
  avatarBodyMetrics,
  avatarCatalog,
  avatarColorPalettes,
  avatarFixtures,
  bodyPresetIdFor,
  defaultAvatar,
  migrateAvatar,
  randomAvatar,
  validateAvatar,
} from "../src";

describe("avatar schema", () => {
  it("accepts the default profile", () =>
    expect(validateAvatar(defaultAvatar)).toEqual(defaultAvatar));
  it("rejects arbitrary mesh ids", () =>
    expect(() =>
      validateAvatar({ ...defaultAvatar, parts: { ...defaultAvatar.parts, hair: "uploaded.glb" } }),
    ).toThrow());
  it("migrates corrupt legacy data to a safe preset", () =>
    expect(migrateAvatar({ strokes: [] })).toEqual(defaultAvatar));
  it("migrates partial v1 profiles field-by-field without discarding valid choices", () => {
    const migrated = migrateAvatar({
      schemaVersion: 1,
      bodyPresetId: "body-12",
      morphs: { height: 0.84, build: 99 },
      parts: { hair: "hair-72", eyewear: "eyewear-28", headwear: "uploaded.glb" },
      colors: { hair: "#abcdef" },
    });
    expect(migrated.bodyPresetId).toBe("body-12");
    expect(migrated.morphs.height).toBe(0.84);
    expect(migrated.morphs.build).toBe(defaultAvatar.morphs.build);
    expect(migrated.parts.hair).toBe("hair-72");
    expect(migrated.parts.eyewear).toBe("eyewear-28");
    expect(migrated.parts.headwear).toBe("none");
    expect(migrated.colors.hair).toBe("#abcdef");
    expect(validateAvatar(migrated)).toEqual(migrated);
  });
  it("rejects missing or extra fields in persisted profiles", () => {
    const missingMorph = structuredClone(defaultAvatar) as unknown as Record<string, unknown>;
    missingMorph.morphs = { height: 0.5, build: 0.5 };
    expect(() => validateAvatar(missingMorph)).toThrow(/体格/);
    expect(() => validateAvatar({ ...defaultAvatar, arbitrary: true })).toThrow(/未対応/);
  });
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
  it("maps all twelve legacy body IDs to safe, visibly distinct body metrics", () => {
    const metrics = avatarCatalog.bodyPresetId.map((bodyPresetId) =>
      avatarBodyMetrics({ ...defaultAvatar, bodyPresetId }),
    );
    expect(new Set(metrics.map((value) => JSON.stringify(value))).size).toBe(12);
    expect(bodyPresetIdFor(0, 0)).toBe("body-1");
    expect(bodyPresetIdFor(2, 3)).toBe("body-12");
    expect(Math.min(...metrics.map((value) => value.shoulderWidth))).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...metrics.map((value) => value.legLength))).toBeCloseTo(1.14, 5);
  });
  it("ships full validated color palettes and representative fixtures", () => {
    expect(avatarColorPalettes.skin).toHaveLength(24);
    expect(avatarColorPalettes.hair.length).toBeGreaterThanOrEqual(18);
    expect(Object.values(avatarFixtures).map(validateAvatar)).toHaveLength(3);
  });
});
