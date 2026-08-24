import { describe, expect, it } from "vitest";
import { connectionStateOnBrowserOnline } from "../app/connectionState";

describe("browser online connection state", () => {
  it("keeps an already live room transport connected", () => {
    expect(connectionStateOnBrowserOnline(true, "webrtc")).toBe("connected");
    expect(connectionStateOnBrowserOnline(true, "firebase")).toBe("connected");
  });

  it("shows reconnecting only when an active room transport is not live", () => {
    expect(connectionStateOnBrowserOnline(true, "offline")).toBe("reconnecting");
    expect(connectionStateOnBrowserOnline(true)).toBe("reconnecting");
    expect(connectionStateOnBrowserOnline(false)).toBe("connected");
  });
});
