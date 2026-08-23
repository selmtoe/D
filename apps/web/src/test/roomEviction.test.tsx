import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({
  onError: undefined as ((error: Error) => void) | undefined,
  stop: vi.fn(),
  subscribeRoomView: vi.fn(),
}));

vi.mock("../network/firebaseClient", () => ({
  firebaseErrorMessage: (error: Error) => error.message,
  getFirebase: vi.fn(async () => ({ user: { uid: "viewer" } })),
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
  it("reports the exact room immediately when an eviction arrives", async () => {
    const evicted = vi.fn();
    const { unmount } = renderHook(() => useRoomSubscription("ABCDE", evicted));
    await waitFor(() => expect(network.subscribeRoomView).toHaveBeenCalledOnce());

    act(() => network.onError?.(new Error("evicted: kicked")));

    expect(evicted).toHaveBeenCalledWith("ABCDE");
    unmount();
    expect(network.stop).toHaveBeenCalledOnce();
  });
});
