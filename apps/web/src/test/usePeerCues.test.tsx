import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emoteCue } from "../network/peerCues";

const peer = vi.hoisted(() => ({
  sendCue: vi.fn(),
  onCue: vi.fn(() => vi.fn()),
  onMode: vi.fn(() => vi.fn()),
}));

vi.mock("../network/firebaseClient", () => ({
  getActiveSparkSession: () => ({
    roomId: "ABCDE",
    uid: "viewer",
    sendCue: peer.sendCue,
    onCue: peer.onCue,
    onMode: peer.onMode,
  }),
}));

vi.mock("../network/e2eTransport", () => ({
  e2eSendCue: vi.fn(),
  isE2ECueTransport: () => false,
  isE2ETransport: () => false,
  subscribeE2ECues: vi.fn(),
}));

import { usePeerCues } from "../network/usePeerCues";

describe("peer cue hook", () => {
  it("turns a rejected cue send into an offline result", async () => {
    peer.sendCue.mockRejectedValueOnce(new Error("relay unavailable"));
    const { result } = renderHook(() => usePeerCues("ABCDE", "viewer", ["viewer", "host"]));

    let sent = true;
    await act(async () => {
      sent = await result.current.send(emoteCue("applause"));
    });

    expect(sent).toBe(false);
    expect(result.current.mode).toBe("offline");
  });
});
