import { defaultAvatar, migrateAvatar, type AvatarProfileV1 } from "@daifugo/avatar-schema";
import { getStoredValue, setStoredValue } from "../app/browserStorage";

const ACTIVE_KEY = "daifugo-avatar-v1";
const PRESETS_KEY = "daifugo-avatar-presets-v1";

export function loadAvatar(): AvatarProfileV1 {
  try {
    return migrateAvatar(JSON.parse(getStoredValue("local", ACTIVE_KEY) ?? "null"));
  } catch {
    return structuredClone(defaultAvatar);
  }
}

export function saveAvatar(profile: AvatarProfileV1): void {
  setStoredValue("local", ACTIVE_KEY, JSON.stringify(profile));
}
export function loadPresets(): { id: string; name: string; profile: AvatarProfileV1 }[] {
  try {
    const parsed = JSON.parse(getStoredValue("local", PRESETS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 8).map((item, index) => ({
      id: typeof item?.id === "string" ? item.id : `preset-${index}`,
      name: typeof item?.name === "string" ? item.name.slice(0, 16) : `仕立て ${index + 1}`,
      profile: migrateAvatar(item?.profile),
    }));
  } catch {
    return [];
  }
}
export function savePresets(
  presets: { id: string; name: string; profile: AvatarProfileV1 }[],
): void {
  setStoredValue("local", PRESETS_KEY, JSON.stringify(presets.slice(0, 8)));
}
