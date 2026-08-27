import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emoteCue, spectatorPoseCue } from "../network/peerCues";

const peer = vi.hoisted(() => {
  const state: { cueListener: ((cue: unknown, sender: string) => void) | undefined } = {
    cueListener: undefined,
  };
  return {
    state,
    sendCue: vi.fn(),
    onCue: vi.fn((listener: (cue: unknown, sender: string) => void) => {
      state.cueListener = listener;
      return vi.fn();
    }),
    onMode: vi.fn(() => vi.fn()),
  };
});

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
  beforeEach(() => {
    vi.clearAllMocks();
    peer.state.cueListener = undefined;
  });

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

  it("tracks the latest active spectator pose by trusted sender", () => {
    const { result } = renderHook(() => usePeerCues("ABCDE", "viewer", ["viewer", "host"]));
    const first = spectatorPoseCue(
      { x: 1, y: 2, z: 3, yaw: 0.25, moving: true, freeSpectating: true },
      100,
    );
    const newer = spectatorPoseCue(
      { x: 4, y: 5, z: 6, yaw: 0.5, moving: false, freeSpectating: true },
      200,
    );
    const other = spectatorPoseCue(
      { x: -1, y: 1, z: -2, yaw: -0.5, moving: true, freeSpectating: true },
      150,
    );

    act(() => {
      peer.state.cueListener?.(first, "spectator-a");
      peer.state.cueListener?.(newer, "spectator-a");
      peer.state.cueListener?.(first, "spectator-a");
      peer.state.cueListener?.(other, "spectator-b");
    });

    expect(result.current.spectatorPoses.get("spectator-a")).toEqual(newer);
    expect(result.current.spectatorPoses.get("spectator-b")).toEqual(other);
    expect(result.current.spectatorPoses.size).toBe(2);
  });

  it("removes a spectator on free-view exit and rejects delayed resurrection", () => {
    const { result } = renderHook(() => usePeerCues("ABCDE", "viewer", ["viewer", "host"]));
    const active = spectatorPoseCue(
      { x: 1, y: 2, z: 3, yaw: 0, moving: true, freeSpectating: true },
      100,
    );
    const exited = spectatorPoseCue(
      { x: 1, y: 2, z: 3, yaw: 0, moving: false, freeSpectating: false },
      200,
    );

    act(() => {
      peer.state.cueListener?.(active, "spectator-a");
      peer.state.cueListener?.(exited, "spectator-a");
      peer.state.cueListener?.(active, "spectator-a");
    });

    expect(result.current.spectatorPoses.has("spectator-a")).toBe(false);
    expect(result.current.lastCue).toEqual({ cue: exited, sender: "spectator-a" });
  });
});
