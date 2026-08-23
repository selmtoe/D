export type BrowserStorageKind = "local" | "session";

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
