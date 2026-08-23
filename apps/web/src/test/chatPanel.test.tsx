import { defaultAvatar } from "@daifugo/avatar-schema";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomView } from "../app/model";
import { ChatPanel } from "../screens/GameScreen";

afterEach(cleanup);

const room: RoomView = {
  roomId: "ROOM1",
  revision: 1,
  generation: 0,
  phase: "playing",
  role: "player",
  viewerId: "actor",
  hostId: "actor",
  players: [
    {
      id: "actor",
      name: "自分",
      avatar: defaultAvatar,
      cardCount: 1,
      connection: "online",
      status: "active",
      host: true,
    },
  ],
  spectators: [],
  settings: { mode: "normal", blindCount: 0 },
  direction: 1,
  revolution: false,
  jackBack: false,
  suitLock: [],
  field: [],
  discard: [],
  hand: [],
  pendingEffects: [],
  rankings: [],
  log: [],
};

describe("chat panel", () => {
  it("keeps the draft when delivery is rejected", async () => {
    const sendChat = vi.fn(async () => false);
    render(<ChatPanel room={room} sendChat={sendChat} />);

    fireEvent.change(screen.getByLabelText("チャット"), {
      target: { value: "  再送したい文章  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(sendChat).toHaveBeenCalledWith("再送したい文章");
    await waitFor(() =>
      expect(screen.getByLabelText("チャット")).toHaveValue("  再送したい文章  "),
    );
  });

  it("clears only the draft that was delivered", async () => {
    const sendChat = vi.fn(async () => true);
    render(<ChatPanel room={room} sendChat={sendChat} />);

    fireEvent.change(screen.getByLabelText("チャット"), { target: { value: "届く文章" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => expect(screen.getByLabelText("チャット")).toHaveValue(""));
  });
});
