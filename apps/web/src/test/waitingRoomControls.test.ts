import { describe, expect, it } from "vitest";
import { canEditRoomSettings } from "../screens/WaitingRoomScreen";

describe("waiting room controls", () => {
  it("allows only an idle host to change room settings", () => {
    expect(canEditRoomSettings(true, false)).toBe(true);
    expect(canEditRoomSettings(true, true)).toBe(false);
    expect(canEditRoomSettings(false, false)).toBe(false);
  });
});
