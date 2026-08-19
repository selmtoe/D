import { describe, expect, test } from "vitest";
import { shouldIgnoreDisconnectEvent } from "../src/timers/presence.js";

describe("presence trigger ordering", () => {
  test("ignores a delayed offline event after the same connection restored online", () => {
    expect(
      shouldIgnoreDisconnectEvent(
        { online: false, connectionId: "tab-a", lastChanged: 100 },
        { online: true, connectionId: "tab-a", lastChanged: 101 },
      ),
    ).toBe(true);
  });

  test("ignores any offline event older than the current leaf and accepts the newest one", () => {
    expect(
      shouldIgnoreDisconnectEvent(
        { online: false, connectionId: "tab-a", lastChanged: 100 },
        { online: false, connectionId: "tab-b", lastChanged: 101 },
      ),
    ).toBe(true);
    expect(
      shouldIgnoreDisconnectEvent(
        { online: false, connectionId: "tab-a", lastChanged: 101 },
        { online: false, connectionId: "tab-a", lastChanged: 101 },
      ),
    ).toBe(false);
  });
});
