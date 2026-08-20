import { describe, expect, test } from "vitest";
import {
  avatarProfileSchema,
  createRoomSchema,
  resolveBomberSchema,
  resolveDiscardSchema,
  submitPlaySchema,
} from "../src/security/schemas.js";

const actionId = "12345678-1234-4123-8123-123456789abc";
const avatar = {
  schemaVersion: 1,
  bodyPresetId: "body-5",
  headPresetId: "head-4",
  morphs: { height: 0.5, build: 0.45, faceWidth: 0.5 },
  parts: {
    skinTone: "skin-1",
    hair: "hair-144",
    eyes: "eyes-1",
    iris: "iris-1",
    brows: "brows-1",
    nose: "nose-1",
    mouth: "mouth-1",
    ears: "ears-1",
    beard: "none",
    marks: "marks-96",
    eyewear: "eyewear-80",
    headwear: "headwear-120",
    earrings: "none",
    jewelry: "none",
    tops: "tops-1",
    outerwear: "none",
    bottoms: "bottoms-1",
    fullOutfit: "none",
    shoes: "shoes-1",
    gloves: "none",
    expression: "expression-1",
  },
  colors: {
    skin: "#f8dcc4",
    hair: "#120f10",
    eyes: "#243331",
    outfit: "#123f32",
    accent: "#d7b668",
  },
  materials: { outfit: "velvet", accent: "brass" },
  animationSetId: "animation-1",
} as const;

describe("callable schemas", () => {
  test("normal mode requires zero blind cards", () => {
    const result = createRoomSchema.safeParse({
      clientActionId: actionId,
      profile: { name: "Alice", avatar: { schemaVersion: 1 } },
      visibility: "public",
      settings: { mode: "normal", blindCount: 1 },
    });
    expect(result.success).toBe(false);
  });

  test("unknown uid fields are rejected instead of trusted", () => {
    const result = submitPlaySchema.safeParse({
      roomId: "ABCDE",
      gameId: "g0-example",
      expectedRevision: 3,
      clientActionId: actionId,
      uid: "forged-user",
      cardIds: ["opaque-card-1"],
      mimics: [],
    });
    expect(result.success).toBe(false);
  });

  test("duplicate card ids and duplicate bomber ranks are rejected", () => {
    expect(
      submitPlaySchema.safeParse({
        roomId: "ABCDE",
        gameId: "g0-example",
        expectedRevision: 3,
        clientActionId: actionId,
        cardIds: ["card-1", "card-1"],
        mimics: [],
      }).success,
    ).toBe(false);
    expect(
      resolveBomberSchema.safeParse({
        roomId: "ABCDE",
        gameId: "g0-example",
        expectedRevision: 3,
        clientActionId: actionId,
        ranks: ["Q", "Q"],
      }).success,
    ).toBe(false);
  });

  test("forced selections accept six Joker-augmented effect cards but never seven", () => {
    const base = {
      roomId: "ABCDE",
      gameId: "g0-example",
      expectedRevision: 3,
      clientActionId: actionId,
    };
    const six = Array.from({ length: 6 }, (_, index) => `card-${index}`);
    const seven = [...six, "card-6"];
    expect(resolveDiscardSchema.safeParse({ ...base, cardIds: six }).success).toBe(true);
    expect(resolveDiscardSchema.safeParse({ ...base, cardIds: seven }).success).toBe(false);
    expect(
      resolveBomberSchema.safeParse({
        ...base,
        ranks: ["3", "4", "5", "6", "7", "8"],
      }).success,
    ).toBe(true);
  });

  test("expanded avatars and optional bounded face paint remain v1 compatible", () => {
    expect(avatarProfileSchema.safeParse(avatar).success).toBe(true);
    const facePaint = {
      version: 1,
      strokes: [
        {
          mode: "paint",
          color: "#aabbcc",
          width: 0.04,
          points: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.6 },
          ],
        },
      ],
    };
    expect(avatarProfileSchema.safeParse({ ...avatar, facePaint }).success).toBe(true);
    expect(
      avatarProfileSchema.safeParse({
        ...avatar,
        facePaint: {
          ...facePaint,
          strokes: [{ ...facePaint.strokes[0], width: 0.2 }],
        },
      }).success,
    ).toBe(false);
    expect(
      avatarProfileSchema.safeParse({ ...avatar, facePaint, unexpectedPaintAuthority: true })
        .success,
    ).toBe(false);
    expect(
      avatarProfileSchema.safeParse({
        ...avatar,
        facePaint: {
          ...facePaint,
          strokes: [{ ...facePaint.strokes[0], points: [] }],
        },
      }).success,
    ).toBe(false);
    expect(
      avatarProfileSchema.safeParse({
        ...avatar,
        facePaint: { ...facePaint, unsafeTextureUrl: "https://example.invalid/private.png" },
      }).success,
    ).toBe(false);
  });
});
