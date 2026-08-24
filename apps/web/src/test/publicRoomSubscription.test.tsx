import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicRoom } from "../app/model";

vi.mock("../network/firebaseClient", () => ({
  firebaseErrorMessage: (error: Error) => error.message,
  getFirebase: vi.fn(),
  subscribePublicRooms: vi.fn(),
  subscribeRoomView: vi.fn(),
}));

import { useUiStore } from "../app/store";
import { usePublicRoomSubscription } from "../network/useRealtime";

describe("public room subscription", () => {
  afterEach(() => useUiStore.getState().setPublicRooms([]));

  it("clears the previous lobby snapshot while the subscription is disabled", async () => {
    useUiStore.getState().setPublicRooms([{ roomId: "ABCDE" } as PublicRoom]);

    renderHook(() => usePublicRoomSubscription(false));

    await waitFor(() => expect(useUiStore.getState().publicRooms).toEqual([]));
  });
});
