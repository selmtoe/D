export type BrowserStorageKind = "local" | "session";

export type AutoPassDelayMode = "instant" | "random";

export interface PersonalSettings {
  autoPass: boolean;
  autoPassDelay: AutoPassDelayMode;
  dimUnplayableCards: boolean;
  autoSortHand: boolean;
}

export const DEFAULT_PERSONAL_SETTINGS: Readonly<PersonalSettings> = {
  autoPass: false,
  autoPassDelay: "instant",
  dimUnplayableCards: true,
  autoSortHand: true,
};

export const PERSONAL_SETTINGS_STORAGE_KEY = "daifugo-personal-settings-v1";

function browserStorage(kind: BrowserStorageKind): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function getStoredValue(kind: BrowserStorageKind, key: string): string | null {
  try {
    return browserStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function setStoredValue(kind: BrowserStorageKind, key: string, value: string): void {
  try {
    browserStorage(kind)?.setItem(key, value);
  } catch {
    // Storage can be disabled by browser privacy settings. Runtime state still works.
  }
}

export function removeStoredValue(kind: BrowserStorageKind, key: string): void {
  try {
    browserStorage(kind)?.removeItem(key);
  } catch {
    // Treat an inaccessible store as already cleared.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Loads only known, correctly typed settings. Invalid fields fall back independently. */
export function loadPersonalSettings(): PersonalSettings {
  const stored = getStoredValue("local", PERSONAL_SETTINGS_STORAGE_KEY);
  if (!stored) return { ...DEFAULT_PERSONAL_SETTINGS };

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) return { ...DEFAULT_PERSONAL_SETTINGS };
    return {
      autoPass:
        typeof parsed.autoPass === "boolean" ? parsed.autoPass : DEFAULT_PERSONAL_SETTINGS.autoPass,
      autoPassDelay:
        parsed.autoPassDelay === "instant" || parsed.autoPassDelay === "random"
          ? parsed.autoPassDelay
          : DEFAULT_PERSONAL_SETTINGS.autoPassDelay,
      dimUnplayableCards:
        typeof parsed.dimUnplayableCards === "boolean"
          ? parsed.dimUnplayableCards
          : DEFAULT_PERSONAL_SETTINGS.dimUnplayableCards,
      autoSortHand:
        typeof parsed.autoSortHand === "boolean"
          ? parsed.autoSortHand
          : DEFAULT_PERSONAL_SETTINGS.autoSortHand,
    };
  } catch {
    return { ...DEFAULT_PERSONAL_SETTINGS };
  }
}

export function savePersonalSettings(settings: PersonalSettings): void {
  setStoredValue("local", PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
