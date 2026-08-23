import { afterEach, describe, expect, it, vi } from "vitest";

describe("optional interaction feedback", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("does not block interaction when AudioContext construction is denied", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("audio denied");
        }
      },
    );
    const { primeFeedback } = await import("../components/feedback");

    expect(() => primeFeedback(false)).not.toThrow();
  });

  it("does not block interaction when vibration is denied", async () => {
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("vibration denied");
      },
    });
    const { feedback } = await import("../components/feedback");

    expect(() => feedback("select", true)).not.toThrow();
  });
});
