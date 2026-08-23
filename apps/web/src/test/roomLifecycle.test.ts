import { describe, expect, it } from "vitest";
import { shouldClearRoomAfterViewLoss } from "../app/roomLifecycle";

describe("room lifecycle cleanup", () => {
  it("does not mistake the first room-view wait for an eviction", () => {
    expect(shouldClearRoomAfterViewLoss("SALON_LOBBY", "ABCDE", undefined, undefined)).toBe(false);
  });

  it("clears an active room only after its previously received view disappears", () => {
    expect(shouldClearRoomAfterViewLoss("SALON_LOBBY", "ABCDE", undefined, "ABCDE")).toBe(true);
    expect(shouldClearRoomAfterViewLoss("PLAYING_TURN", "ABCDE", "ABCDE", "ABCDE")).toBe(false);
  });
});
