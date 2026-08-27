import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({
  onError: undefined as ((error: Error) => void) | undefined,
  activeSession: undefined as { roomId: string; uid: string } | undefined,
  getFirebase: vi.fn(async () => ({ user: { uid: "viewer" } })),
  stop: vi.fn(),
  subscribeRoomView: vi.fn(),
}));

vi.mock("../network/firebaseClient", () => ({
  firebaseErrorMessage: (error: Error) => error.message,
  getActiveSparkSession: vi.fn(() => network.activeSession),
  getFirebase: network.getFirebase,
  subscribePublicRooms: vi.fn(),
  subscribeRoomView: network.subscribeRoomView.mockImplementation(
    async (
      _roomId: string,
      _uid: string,
      _onView: (view: unknown) => void,
      onError: (error: Error) => void,
    ) => {
      network.onError = onError;
      return network.stop;
    },
  ),
}));

import { useRoomSubscription } from "../network/useRealtime";

describe("room eviction subscription", () => {
  beforeEach(() => {
    network.activeSession = undefined;
    network.getFirebase.mockClear();
    network.subscribeRoomView.mockClear();
    network.stop.mockClear();
  });

  it("reports the exact room immediately when an eviction arrives", async () => {
    const evicted = vi.fn();
    const { unmount } = renderHook(() => useRoomSubscription("ABCDE", evicted));
    await waitFor(() => expect(network.subscribeRoomView).toHaveBeenCalledOnce());

    act(() => network.onError?.(new Error("evicted: kicked")));

    expect(evicted).toHaveBeenCalledWith("ABCDE");
    unmount();
    expect(network.stop).toHaveBeenCalledOnce();
  });

  it("subscribes an active local session without initializing Firebase", async () => {
    network.activeSession = { roomId: "CPU01", uid: "local-player" };
    const { unmount } = renderHook(() => useRoomSubscription("CPU01"));
    await waitFor(() => expect(network.subscribeRoomView).toHaveBeenCalledOnce());

    expect(network.getFirebase).not.toHaveBeenCalled();
    expect(network.subscribeRoomView).toHaveBeenCalledWith(
      "CPU01",
      "local-player",
      expect.any(Function),
      expect.any(Function),
    );
    unmount();
  });
});
