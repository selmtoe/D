import { describe, expect, it } from "vitest";
import { canApplyPwaUpdate } from "../app/pwaUpdate";

describe("PWA update safety", () => {
  it("applies a waiting update only from an idle room-free lobby", () => {
    expect(canApplyPwaUpdate("SALON_LOBBY", false, false)).toBe(true);
    expect(canApplyPwaUpdate("SALON_LOBBY", true, false)).toBe(false);
    expect(canApplyPwaUpdate("SALON_LOBBY", false, true)).toBe(false);
    expect(canApplyPwaUpdate("ENTRANCE", false, false)).toBe(false);
    expect(canApplyPwaUpdate("ROOM_WAITING", false, true)).toBe(false);
    expect(canApplyPwaUpdate("PLAYING_TURN", false, true)).toBe(false);
    expect(canApplyPwaUpdate("AWAITING_FORCED_EFFECT", false, true)).toBe(false);
    expect(canApplyPwaUpdate("FINISHED", false, true)).toBe(false);
  });
});
