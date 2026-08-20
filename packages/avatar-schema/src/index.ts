export const AVATAR_SCHEMA_VERSION = 1 as const;

export const avatarCatalog = {
  skinTone: Array.from({ length: 24 }, (_, index) => `skin-${index + 1}`),
  bodyPresetId: Array.from({ length: 12 }, (_, index) => `body-${index + 1}`),
  headPresetId: Array.from({ length: 16 }, (_, index) => `head-${index + 1}`),
  hair: Array.from({ length: 144 }, (_, index) => `hair-${index + 1}`),
  eyes: Array.from({ length: 36 }, (_, index) => `eyes-${index + 1}`),
  iris: Array.from({ length: 18 }, (_, index) => `iris-${index + 1}`),
  brows: Array.from({ length: 28 }, (_, index) => `brows-${index + 1}`),
  nose: Array.from({ length: 24 }, (_, index) => `nose-${index + 1}`),
  mouth: Array.from({ length: 32 }, (_, index) => `mouth-${index + 1}`),
  ears: Array.from({ length: 12 }, (_, index) => `ears-${index + 1}`),
  beard: ["none", ...Array.from({ length: 24 }, (_, index) => `beard-${index + 1}`)],
  marks: ["none", ...Array.from({ length: 96 }, (_, index) => `marks-${index + 1}`)],
  eyewear: ["none", ...Array.from({ length: 80 }, (_, index) => `eyewear-${index + 1}`)],
  headwear: ["none", ...Array.from({ length: 120 }, (_, index) => `headwear-${index + 1}`)],
  earrings: ["none", ...Array.from({ length: 28 }, (_, index) => `earrings-${index + 1}`)],
  jewelry: ["none", ...Array.from({ length: 32 }, (_, index) => `jewelry-${index + 1}`)],
  tops: Array.from({ length: 60 }, (_, index) => `tops-${index + 1}`),
  outerwear: ["none", ...Array.from({ length: 36 }, (_, index) => `outerwear-${index + 1}`)],
  bottoms: Array.from({ length: 40 }, (_, index) => `bottoms-${index + 1}`),
  fullOutfit: ["none", ...Array.from({ length: 40 }, (_, index) => `full-outfit-${index + 1}`)],
  shoes: Array.from({ length: 36 }, (_, index) => `shoes-${index + 1}`),
  gloves: ["none", ...Array.from({ length: 20 }, (_, index) => `gloves-${index + 1}`)],
  expression: Array.from({ length: 20 }, (_, index) => `expression-${index + 1}`),
  animationSetId: Array.from({ length: 24 }, (_, index) => `animation-${index + 1}`),
} as const;

export const avatarColorPalettes = {
  skin: [
    "#f8dcc4",
    "#f2cbae",
    "#e9b890",
    "#dfa77d",
    "#d49a70",
    "#c98b62",
    "#bd7e5a",
    "#ad704f",
    "#9d6346",
    "#8c583f",
    "#7d4c37",
    "#6f4231",
    "#62392b",
    "#553126",
    "#492a22",
    "#3e241e",
    "#34201c",
    "#2b1b18",
    "#f0c6aa",
    "#d9a07f",
    "#b9785c",
    "#945842",
    "#71402f",
    "#4c2d25",
  ],
  hair: [
    "#120f10",
    "#241810",
    "#3a2418",
    "#593520",
    "#78492b",
    "#9a6237",
    "#c18b55",
    "#e0bd81",
    "#e8ddd0",
    "#7a1f27",
    "#b74633",
    "#d8795d",
    "#183a4a",
    "#245d63",
    "#31543b",
    "#6c3d7e",
    "#9b5ba5",
    "#d8a8c4",
  ],
  eyes: [
    "#243331",
    "#365b55",
    "#47796d",
    "#315a79",
    "#497ca0",
    "#6e91b0",
    "#65452f",
    "#8b6545",
    "#ad8659",
    "#596538",
    "#75834a",
    "#7d506f",
  ],
  outfit: [
    "#123f32",
    "#1d5848",
    "#21375a",
    "#304f78",
    "#682e3d",
    "#8b3e50",
    "#342650",
    "#5b3268",
    "#6d4a2d",
    "#8f6840",
    "#3b4148",
    "#676e75",
  ],
  accent: ["#d7b668", "#f0d999", "#b98245", "#d7dce1", "#9fa8b2", "#9a4552"],
} as const;

export type AvatarPartKey =
  | "skinTone"
  | "hair"
  | "eyes"
  | "iris"
  | "brows"
  | "nose"
  | "mouth"
  | "ears"
  | "beard"
  | "marks"
  | "eyewear"
  | "headwear"
  | "earrings"
  | "jewelry"
  | "tops"
  | "outerwear"
  | "bottoms"
  | "fullOutfit"
  | "shoes"
  | "gloves"
  | "expression";

export const FACE_PAINT_LIMITS = {
  maxStrokes: 32,
  maxPointsPerStroke: 128,
  maxTotalPoints: 2048,
  maxSerializedLength: 65_536,
  minWidth: 0.004,
  maxWidth: 0.12,
} as const;

export interface FacePaintPoint {
  x: number;
  y: number;
}

export interface FacePaintStroke {
  mode: "paint" | "erase";
  color: string;
  width: number;
  points: FacePaintPoint[];
}

export interface FacePaintLayer {
  version: 1;
  strokes: FacePaintStroke[];
}

export interface AvatarProfileV1 {
  schemaVersion: 1;
  bodyPresetId: string;
  headPresetId: string;
  morphs: { height: number; build: number; faceWidth: number };
  parts: Record<AvatarPartKey, string>;
  colors: { skin: string; hair: string; eyes: string; outfit: string; accent: string };
  materials: {
    outfit: "velvet" | "satin" | "wool" | "silk";
    accent: "brass" | "silver" | "enamel";
  };
  animationSetId: string;
  /** Optional v1 extension: old schemaVersion 1 profiles remain valid without it. */
  facePaint?: FacePaintLayer;
}

export interface AvatarBodyMetrics {
  heightScale: number;
  shoulderWidth: number;
  torsoLength: number;
  legLength: number;
  armLength: number;
  hipWidth: number;
  bodyDepth: number;
  frame: 0 | 1 | 2;
  torsoLegStep: 0 | 1 | 2 | 3;
}

/**
 * The existing twelve body IDs are a backward-compatible 3 × 4 matrix:
 * frame (slender/balanced/strong) × torso-to-leg balance. Continuous height
 * and shoulder width remain in the original safe 0..1 morph fields.
 */
export function avatarBodyMetrics(profile: AvatarProfileV1): AvatarBodyMetrics {
  const rawIndex = avatarCatalog.bodyPresetId.indexOf(
    profile.bodyPresetId as (typeof avatarCatalog.bodyPresetId)[number],
  );
  const index = Math.max(0, rawIndex);
  const frame = Math.min(2, Math.floor(index / 4)) as 0 | 1 | 2;
  const torsoLegStep = (index % 4) as 0 | 1 | 2 | 3;
  const balance = torsoLegStep / 3;
  const centeredBuild = profile.morphs.build - 0.5;
  return {
    heightScale: 0.86 + profile.morphs.height * 0.28,
    shoulderWidth: 0.8 + profile.morphs.build * 0.36 + frame * 0.055,
    torsoLength: 1.13 - balance * 0.25 + frame * 0.025,
    legLength: 0.86 + balance * 0.28 - frame * 0.015,
    armLength: 0.91 + balance * 0.12 + profile.morphs.height * 0.06,
    hipWidth: 0.88 + frame * 0.08 + centeredBuild * 0.14,
    bodyDepth: 0.88 + frame * 0.075 + profile.morphs.build * 0.12,
    frame,
    torsoLegStep,
  };
}

export function bodyPresetIdFor(frame: number, torsoLegStep: number): string {
  const safeFrame = Math.max(0, Math.min(2, Math.round(frame)));
  const safeStep = Math.max(0, Math.min(3, Math.round(torsoLegStep)));
  return avatarCatalog.bodyPresetId[safeFrame * 4 + safeStep]!;
}

export const defaultAvatar: AvatarProfileV1 = {
  schemaVersion: 1,
  bodyPresetId: "body-5",
  headPresetId: "head-4",
  morphs: { height: 0.5, build: 0.45, faceWidth: 0.5 },
  parts: {
    skinTone: "skin-9",
    hair: "hair-8",
    eyes: "eyes-4",
    iris: "iris-3",
    brows: "brows-3",
    nose: "nose-2",
    mouth: "mouth-6",
    ears: "ears-2",
    beard: "none",
    marks: "none",
    eyewear: "none",
    headwear: "none",
    earrings: "none",
    jewelry: "none",
    tops: "tops-11",
    outerwear: "outerwear-2",
    bottoms: "bottoms-8",
    fullOutfit: "none",
    shoes: "shoes-4",
    gloves: "none",
    expression: "expression-1",
  },
  colors: {
    skin: "#bd7e5a",
    hair: "#241810",
    eyes: "#365b55",
    outfit: "#123f32",
    accent: "#d7b668",
  },
  materials: { outfit: "velvet", accent: "brass" },
  animationSetId: "animation-1",
};

const hex = /^#[0-9a-f]{6}$/i;
const range = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const allowed = (key: keyof typeof avatarCatalog, value: unknown): value is string =>
  typeof value === "string" && (avatarCatalog[key] as readonly string[]).includes(value);
const hasExactKeys = (value: object, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const hasRequiredKeysAndNoExtras = (
  value: object,
  required: readonly string[],
  optional: readonly string[],
): boolean => {
  const allowedKeys = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowedKeys.has(key))
  );
};

export function validateFacePaint(input: unknown): FacePaintLayer {
  if (!input || typeof input !== "object" || !hasExactKeys(input, ["version", "strokes"]))
    throw new Error("フェイスペイント情報が不正です");
  const value = input as Partial<FacePaintLayer>;
  if (
    value.version !== 1 ||
    !Array.isArray(value.strokes) ||
    value.strokes.length > FACE_PAINT_LIMITS.maxStrokes
  )
    throw new Error("フェイスペイントのストローク数が上限を超えています");
  let totalPoints = 0;
  for (const stroke of value.strokes) {
    if (
      !stroke ||
      typeof stroke !== "object" ||
      !hasExactKeys(stroke, ["mode", "color", "width", "points"])
    )
      throw new Error("フェイスペイントの線情報が不正です");
    if (
      (stroke.mode !== "paint" && stroke.mode !== "erase") ||
      typeof stroke.color !== "string" ||
      !hex.test(stroke.color) ||
      typeof stroke.width !== "number" ||
      !Number.isFinite(stroke.width) ||
      stroke.width < FACE_PAINT_LIMITS.minWidth ||
      stroke.width > FACE_PAINT_LIMITS.maxWidth ||
      !Array.isArray(stroke.points) ||
      stroke.points.length === 0 ||
      stroke.points.length > FACE_PAINT_LIMITS.maxPointsPerStroke
    )
      throw new Error("フェイスペイントの線情報が範囲外です");
    totalPoints += stroke.points.length;
    if (totalPoints > FACE_PAINT_LIMITS.maxTotalPoints)
      throw new Error("フェイスペイントの点数が上限を超えています");
    for (const point of stroke.points) {
      if (
        !point ||
        typeof point !== "object" ||
        !hasExactKeys(point, ["x", "y"]) ||
        !range(point.x) ||
        !range(point.y)
      )
        throw new Error("フェイスペイントの座標が不正です");
    }
  }
  if (JSON.stringify(input).length > FACE_PAINT_LIMITS.maxSerializedLength)
    throw new Error("フェイスペイントの保存サイズが上限を超えています");
  return structuredClone(value) as FacePaintLayer;
}

const partKeys: AvatarPartKey[] = [
  "skinTone",
  "hair",
  "eyes",
  "iris",
  "brows",
  "nose",
  "mouth",
  "ears",
  "beard",
  "marks",
  "eyewear",
  "headwear",
  "earrings",
  "jewelry",
  "tops",
  "outerwear",
  "bottoms",
  "fullOutfit",
  "shoes",
  "gloves",
  "expression",
];

export function validateAvatar(input: unknown): AvatarProfileV1 {
  if (!input || typeof input !== "object") throw new Error("アバター情報が不正です");
  const requiredAvatarKeys = [
    "schemaVersion",
    "bodyPresetId",
    "headPresetId",
    "morphs",
    "parts",
    "colors",
    "materials",
    "animationSetId",
  ] as const;
  if (!hasRequiredKeysAndNoExtras(input, requiredAvatarKeys, ["facePaint"]))
    throw new Error("アバター情報に未対応の項目があります");
  const value = input as Partial<AvatarProfileV1>;
  if (
    value.schemaVersion !== 1 ||
    !allowed("bodyPresetId", value.bodyPresetId) ||
    !allowed("headPresetId", value.headPresetId)
  )
    throw new Error("未対応のアバタープリセットです");
  if (
    !value.morphs ||
    !hasExactKeys(value.morphs, ["height", "build", "faceWidth"]) ||
    !range(value.morphs.height) ||
    !range(value.morphs.build) ||
    !range(value.morphs.faceWidth)
  )
    throw new Error("体格値が範囲外です");
  if (
    !value.parts ||
    !hasExactKeys(value.parts, partKeys) ||
    !partKeys.every((key) => allowed(key, value.parts?.[key]))
  )
    throw new Error("未対応のアバターパーツです");
  if (
    !value.colors ||
    !hasExactKeys(value.colors, ["skin", "hair", "eyes", "outfit", "accent"]) ||
    !Object.values(value.colors).every((color) => typeof color === "string" && hex.test(color))
  )
    throw new Error("色指定が不正です");
  if (
    !value.materials ||
    !hasExactKeys(value.materials, ["outfit", "accent"]) ||
    !["velvet", "satin", "wool", "silk"].includes(value.materials.outfit) ||
    !["brass", "silver", "enamel"].includes(value.materials.accent)
  )
    throw new Error("素材指定が不正です");
  if (!allowed("animationSetId", value.animationSetId))
    throw new Error("アニメーション指定が不正です");
  if (Object.prototype.hasOwnProperty.call(input, "facePaint")) validateFacePaint(value.facePaint);
  return structuredClone(value) as AvatarProfileV1;
}

export function migrateAvatar(input: unknown): AvatarProfileV1 {
  try {
    return validateAvatar(input);
  } catch {
    if (!input || typeof input !== "object") return structuredClone(defaultAvatar);
    const legacy = input as Partial<AvatarProfileV1>;
    const legacyMorphs = legacy.morphs as Partial<AvatarProfileV1["morphs"]> | undefined;
    const legacyParts = legacy.parts as Partial<AvatarProfileV1["parts"]> | undefined;
    const legacyColors = legacy.colors as Partial<AvatarProfileV1["colors"]> | undefined;
    const legacyMaterials = legacy.materials as Partial<AvatarProfileV1["materials"]> | undefined;
    let facePaint: FacePaintLayer | undefined;
    if (legacy.facePaint !== undefined) {
      try {
        facePaint = validateFacePaint(legacy.facePaint);
      } catch {
        // A corrupt optional paint layer must not make an otherwise usable v1 avatar unreadable.
      }
    }
    const migrated: AvatarProfileV1 = {
      schemaVersion: 1,
      bodyPresetId: allowed("bodyPresetId", legacy.bodyPresetId)
        ? legacy.bodyPresetId
        : defaultAvatar.bodyPresetId,
      headPresetId: allowed("headPresetId", legacy.headPresetId)
        ? legacy.headPresetId
        : defaultAvatar.headPresetId,
      morphs: {
        height: range(legacyMorphs?.height) ? legacyMorphs.height : defaultAvatar.morphs.height,
        build: range(legacyMorphs?.build) ? legacyMorphs.build : defaultAvatar.morphs.build,
        faceWidth: range(legacyMorphs?.faceWidth)
          ? legacyMorphs.faceWidth
          : defaultAvatar.morphs.faceWidth,
      },
      parts: Object.fromEntries(
        partKeys.map((key) => [
          key,
          allowed(key, legacyParts?.[key]) ? legacyParts[key] : defaultAvatar.parts[key],
        ]),
      ) as AvatarProfileV1["parts"],
      colors: Object.fromEntries(
        (["skin", "hair", "eyes", "outfit", "accent"] as const).map((key) => [
          key,
          typeof legacyColors?.[key] === "string" && hex.test(legacyColors[key])
            ? legacyColors[key]
            : defaultAvatar.colors[key],
        ]),
      ) as AvatarProfileV1["colors"],
      materials: {
        outfit: ["velvet", "satin", "wool", "silk"].includes(legacyMaterials?.outfit ?? "")
          ? legacyMaterials!.outfit!
          : defaultAvatar.materials.outfit,
        accent: ["brass", "silver", "enamel"].includes(legacyMaterials?.accent ?? "")
          ? legacyMaterials!.accent!
          : defaultAvatar.materials.accent,
      },
      animationSetId: allowed("animationSetId", legacy.animationSetId)
        ? legacy.animationSetId
        : defaultAvatar.animationSetId,
    };
    if (facePaint) migrated.facePaint = facePaint;
    return validateAvatar(migrated);
  }
}

export function randomAvatar(random = Math.random): AvatarProfileV1 {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)] ?? items[0]!;
  const parts = Object.fromEntries(
    Object.entries(defaultAvatar.parts).map(([key]) => [
      key,
      pick(avatarCatalog[key as AvatarPartKey]),
    ]),
  ) as unknown as AvatarProfileV1["parts"];
  return validateAvatar({
    ...structuredClone(defaultAvatar),
    bodyPresetId: pick(avatarCatalog.bodyPresetId),
    headPresetId: pick(avatarCatalog.headPresetId),
    parts,
    colors: {
      ...defaultAvatar.colors,
      skin: pick(avatarColorPalettes.skin),
      hair: pick(avatarColorPalettes.hair),
      eyes: pick(avatarColorPalettes.eyes),
      outfit: pick(avatarColorPalettes.outfit),
      accent: pick(avatarColorPalettes.accent),
    },
  });
}

export const avatarFixtures = {
  classic: structuredClone(defaultAvatar),
  tallRegal: validateAvatar({
    ...structuredClone(defaultAvatar),
    bodyPresetId: bodyPresetIdFor(2, 3),
    headPresetId: "head-13",
    morphs: { height: 0.92, build: 0.72, faceWidth: 0.42 },
    parts: {
      ...defaultAvatar.parts,
      hair: "hair-61",
      eyewear: "eyewear-21",
      headwear: "headwear-30",
      jewelry: "jewelry-18",
    },
    colors: {
      ...defaultAvatar.colors,
      skin: avatarColorPalettes.skin[3],
      hair: avatarColorPalettes.hair[14],
      accent: avatarColorPalettes.accent[1],
    },
  }),
  compactModern: validateAvatar({
    ...structuredClone(defaultAvatar),
    bodyPresetId: bodyPresetIdFor(0, 0),
    headPresetId: "head-2",
    morphs: { height: 0.12, build: 0.22, faceWidth: 0.7 },
    parts: {
      ...defaultAvatar.parts,
      hair: "hair-24",
      eyewear: "eyewear-10",
      headwear: "none",
      earrings: "earrings-12",
    },
    colors: {
      ...defaultAvatar.colors,
      skin: avatarColorPalettes.skin[19],
      hair: avatarColorPalettes.hair[12],
      eyes: avatarColorPalettes.eyes[4],
    },
  }),
} as const;
