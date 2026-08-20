import { describe, expect, it } from "vitest";
import {
  FACE_PAINT_LIMITS,
  avatarBodyMetrics,
  avatarCatalog,
  avatarColorPalettes,
  avatarFixtures,
  bodyPresetIdFor,
  defaultAvatar,
  migrateAvatar,
  randomAvatar,
  validateAvatar,
  validateFacePaint,
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
      hair: 144,
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
  it("keeps old v1 profiles valid and strictly validates an optional face-paint extension", () => {
    expect(validateAvatar(defaultAvatar)).not.toHaveProperty("facePaint");
    const facePaint = {
      version: 1 as const,
      strokes: [
        {
          mode: "paint" as const,
          color: "#bc2942",
          width: 0.035,
          points: [
            { x: 0.1, y: 0.2 },
            { x: 0.8, y: 0.7 },
          ],
        },
        {
          mode: "erase" as const,
          color: "#bc2942",
          width: 0.05,
          points: [{ x: 0.4, y: 0.5 }],
        },
      ],
    };
    expect(validateFacePaint(facePaint)).toEqual(facePaint);
    expect(validateAvatar({ ...defaultAvatar, facePaint })).toEqual({
      ...defaultAvatar,
      facePaint,
    });
    expect(() =>
      validateAvatar({
        ...defaultAvatar,
        facePaint: { ...facePaint, unsafeTextureUrl: "https://example.invalid/x" },
      }),
    ).toThrow(/フェイスペイント/);
    expect(() =>
      validateFacePaint({
        version: 1,
        strokes: [{ ...facePaint.strokes[0], points: [{ x: -0.01, y: 0.5 }] }],
      }),
    ).toThrow(/座標/);
    expect(() =>
      validateFacePaint({
        version: 1,
        strokes: [{ ...facePaint.strokes[0], width: FACE_PAINT_LIMITS.maxWidth + 0.001 }],
      }),
    ).toThrow(/範囲外/);
  });
  it("enforces paint stroke, point and serialized-size limits", () => {
    const stroke = {
      mode: "paint" as const,
      color: "#123456",
      width: 0.02,
      points: [{ x: 0.5, y: 0.5 }],
    };
    expect(() =>
      validateFacePaint({
        version: 1,
        strokes: Array.from({ length: FACE_PAINT_LIMITS.maxStrokes + 1 }, () => stroke),
      }),
    ).toThrow(/ストローク数/);
    expect(() =>
      validateFacePaint({
        version: 1,
        strokes: [
          {
            ...stroke,
            points: Array.from({ length: FACE_PAINT_LIMITS.maxPointsPerStroke + 1 }, () => ({
              x: 0.5,
              y: 0.5,
            })),
          },
        ],
      }),
    ).toThrow(/範囲外/);
    const largeButStructurallyBounded = {
      version: 1,
      strokes: Array.from({ length: FACE_PAINT_LIMITS.maxStrokes }, () => ({
        ...stroke,
        points: Array.from({ length: 64 }, () => ({
          x: 0.12345678901234566,
          y: 0.9876543210987654,
        })),
      })),
    };
    expect(JSON.stringify(largeButStructurallyBounded).length).toBeGreaterThan(
      FACE_PAINT_LIMITS.maxSerializedLength,
    );
    expect(() => validateFacePaint(largeButStructurallyBounded)).toThrow(/保存サイズ/);
  });
  it("migrates a valid paint layer and drops only a corrupt optional layer", () => {
    const facePaint = {
      version: 1 as const,
      strokes: [
        {
          mode: "paint" as const,
          color: "#123456",
          width: 0.03,
          points: [{ x: 0.25, y: 0.75 }],
        },
      ],
    };
    expect(migrateAvatar({ ...defaultAvatar, facePaint }).facePaint).toEqual(facePaint);
    const corrupt = migrateAvatar({
      ...defaultAvatar,
      facePaint: { ...facePaint, strokes: [{ ...facePaint.strokes[0], color: "url(x)" }] },
    });
    expect(corrupt).not.toHaveProperty("facePaint");
    expect(corrupt.parts.hair).toBe(defaultAvatar.parts.hair);
  });
  it("contains the expanded procedural head and face accessory catalogs", () => {
    expect(avatarCatalog.hair).toHaveLength(144);
    expect(avatarCatalog.marks).toHaveLength(97);
    expect(avatarCatalog.eyewear).toHaveLength(81);
    expect(avatarCatalog.headwear).toHaveLength(121);
  });
  it("ships full validated color palettes and representative fixtures", () => {
    expect(avatarColorPalettes.skin).toHaveLength(24);
    expect(avatarColorPalettes.hair.length).toBeGreaterThanOrEqual(18);
    expect(Object.values(avatarFixtures).map(validateAvatar)).toHaveLength(3);
  });
});
