import { avatarCatalog, migrateAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import { randomCpuAvatar } from "../network/cpuAvatar";

function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length]!;
}

describe("random CPU avatar", () => {
  it("is deterministic with an injected RNG and migrates without face paint", () => {
    const values = [0.01, 0.23, 0.47, 0.69, 0.91];
    const first = randomCpuAvatar(sequenceRandom(values));
    const second = randomCpuAvatar(sequenceRandom(values));

    expect(second).toEqual(first);
    expect(first).not.toHaveProperty("facePaint");
    expect(migrateAvatar(first)).toEqual(first);
  });

  it("uses only catalog values and safely clamps a hostile RNG", () => {
    const profile = randomCpuAvatar(() => Number.POSITIVE_INFINITY);

    expect(avatarCatalog.bodyPresetId).toContain(profile.bodyPresetId);
    expect(avatarCatalog.headPresetId).toContain(profile.headPresetId);
    for (const [key, value] of Object.entries(profile.parts)) {
      expect(avatarCatalog[key as keyof typeof avatarCatalog]).toContain(value);
    }
    expect(profile.morphs).toEqual({ height: 0.15, build: 0.15, faceWidth: 0.15 });
    expect(profile).not.toHaveProperty("facePaint");
  });

  it("can produce visibly different CPU appearances", () => {
    const low = randomCpuAvatar(() => 0);
    const high = randomCpuAvatar(() => 1);

    expect(high).not.toEqual(low);
    expect(high.parts.mouth).not.toBe(low.parts.mouth);
    expect(high.colors.outfit).not.toBe(low.colors.outfit);
  });
});
