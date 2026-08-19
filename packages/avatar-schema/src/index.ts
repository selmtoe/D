export const AVATAR_SCHEMA_VERSION = 1 as const;

export const avatarCatalog = {
  skinTone: Array.from({ length: 24 }, (_, index) => `skin-${index + 1}`),
  bodyPresetId: Array.from({ length: 12 }, (_, index) => `body-${index + 1}`),
  headPresetId: Array.from({ length: 16 }, (_, index) => `head-${index + 1}`),
  hair: Array.from({ length: 72 }, (_, index) => `hair-${index + 1}`),
  eyes: Array.from({ length: 36 }, (_, index) => `eyes-${index + 1}`),
  iris: Array.from({ length: 18 }, (_, index) => `iris-${index + 1}`),
  brows: Array.from({ length: 28 }, (_, index) => `brows-${index + 1}`),
  nose: Array.from({ length: 24 }, (_, index) => `nose-${index + 1}`),
  mouth: Array.from({ length: 32 }, (_, index) => `mouth-${index + 1}`),
  ears: Array.from({ length: 12 }, (_, index) => `ears-${index + 1}`),
  beard: ["none", ...Array.from({ length: 24 }, (_, index) => `beard-${index + 1}`)],
  marks: ["none", ...Array.from({ length: 32 }, (_, index) => `marks-${index + 1}`)],
  eyewear: ["none", ...Array.from({ length: 28 }, (_, index) => `eyewear-${index + 1}`)],
  headwear: ["none", ...Array.from({ length: 40 }, (_, index) => `headwear-${index + 1}`)],
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

export function validateAvatar(input: unknown): AvatarProfileV1 {
  if (!input || typeof input !== "object") throw new Error("アバター情報が不正です");
  const value = input as Partial<AvatarProfileV1>;
  if (
    value.schemaVersion !== 1 ||
    !allowed("bodyPresetId", value.bodyPresetId) ||
    !allowed("headPresetId", value.headPresetId)
  )
    throw new Error("未対応のアバタープリセットです");
  if (!value.morphs || !Object.values(value.morphs).every(range))
    throw new Error("体格値が範囲外です");
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
  if (!value.parts || !partKeys.every((key) => allowed(key, value.parts?.[key])))
    throw new Error("未対応のアバターパーツです");
  if (
    !value.colors ||
    !Object.values(value.colors).every((color) => typeof color === "string" && hex.test(color))
  )
    throw new Error("色指定が不正です");
  if (
    !value.materials ||
    !["velvet", "satin", "wool", "silk"].includes(value.materials.outfit) ||
    !["brass", "silver", "enamel"].includes(value.materials.accent)
  )
    throw new Error("素材指定が不正です");
  if (!allowed("animationSetId", value.animationSetId))
    throw new Error("アニメーション指定が不正です");
  return structuredClone(value) as AvatarProfileV1;
}

export function migrateAvatar(input: unknown): AvatarProfileV1 {
  try {
    return validateAvatar(input);
  } catch {
    return structuredClone(defaultAvatar);
  }
}

export function randomAvatar(random = Math.random): AvatarProfileV1 {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)] ?? items[0]!;
  const colors = ["#f1c7a5", "#d89b72", "#bd7e5a", "#8c583c", "#5c3828", "#30211d"];
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
      skin: pick(colors),
      outfit: pick(["#123f32", "#21375a", "#682e3d", "#342650"]),
      accent: "#d7b668",
    },
  });
}
