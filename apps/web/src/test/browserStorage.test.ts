import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PERSONAL_SETTINGS,
  getStoredValue,
  loadPersonalSettings,
  PERSONAL_SETTINGS_STORAGE_KEY,
  removeStoredValue,
  savePersonalSettings,
  setStoredValue,
} from "../app/browserStorage";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("browser storage fallback", () => {
  it("keeps the app usable when privacy settings reject storage access", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(getStoredValue("local", "setting")).toBeNull();
    expect(() => setStoredValue("local", "setting", "value")).not.toThrow();
    expect(() => removeStoredValue("session", "token")).not.toThrow();
    expect(get).toHaveBeenCalled();
    expect(set).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });
});

describe("personal settings storage", () => {
  it("round-trips valid local settings", () => {
    const settings = {
      autoPass: true,
      autoPassDelay: "random" as const,
      dimUnplayableCards: false,
      autoSortHand: false,
    };

    savePersonalSettings(settings);

    expect(loadPersonalSettings()).toEqual(settings);
  });

  it("restores defaults from malformed JSON", () => {
    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, "{not-json");
    expect(loadPersonalSettings()).toEqual(DEFAULT_PERSONAL_SETTINGS);
  });

  it("falls back per field without trusting unknown or mistyped values", () => {
    localStorage.setItem(
      PERSONAL_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        autoPass: true,
        autoPassDelay: "tomorrow",
        dimUnplayableCards: "yes",
        autoSortHand: false,
        unexpected: true,
      }),
    );

    expect(loadPersonalSettings()).toEqual({
      autoPass: true,
      autoPassDelay: DEFAULT_PERSONAL_SETTINGS.autoPassDelay,
      dimUnplayableCards: DEFAULT_PERSONAL_SETTINGS.dimUnplayableCards,
      autoSortHand: false,
    });
  });
});
