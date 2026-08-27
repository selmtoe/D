import {
  avatarCatalog,
  avatarColorPalettes,
  defaultAvatar,
  migrateAvatar,
  type AvatarPartKey,
  type AvatarProfileV1,
} from "@daifugo/avatar-schema";

export type CpuAvatarRandom = () => number;

function safeUnit(random: CpuAvatarRandom): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1 - Number.EPSILON, value));
}

function pick<T>(items: readonly T[], random: CpuAvatarRandom): T {
  return items[Math.floor(safeUnit(random) * items.length)] ?? items[0]!;
}

/**
 * Creates a schema-safe CPU appearance without carrying user face paint.
 * RNG injection makes authority-side generation deterministic in tests.
 */
export function randomCpuAvatar(random: CpuAvatarRandom = Math.random): AvatarProfileV1 {
  const parts = Object.fromEntries(
    Object.keys(defaultAvatar.parts).map((key) => [
      key,
      pick(avatarCatalog[key as AvatarPartKey], random),
    ]),
  ) as AvatarProfileV1["parts"];

  return migrateAvatar({
    schemaVersion: 1,
    bodyPresetId: pick(avatarCatalog.bodyPresetId, random),
    headPresetId: pick(avatarCatalog.headPresetId, random),
    morphs: {
      height: 0.15 + safeUnit(random) * 0.7,
      build: 0.15 + safeUnit(random) * 0.7,
      faceWidth: 0.15 + safeUnit(random) * 0.7,
    },
    parts,
    colors: {
      skin: pick(avatarColorPalettes.skin, random),
      hair: pick(avatarColorPalettes.hair, random),
      eyes: pick(avatarColorPalettes.eyes, random),
      outfit: pick(avatarColorPalettes.outfit, random),
      accent: pick(avatarColorPalettes.accent, random),
    },
    materials: {
      outfit: pick(["velvet", "satin", "wool", "silk"] as const, random),
      accent: pick(["brass", "silver", "enamel"] as const, random),
    },
    animationSetId: pick(avatarCatalog.animationSetId, random),
  });
}
