import { describe, expect, it, vi } from "vitest";
import { getStoredValue, removeStoredValue, setStoredValue } from "../app/browserStorage";

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
