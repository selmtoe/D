import { defaultAvatar } from "@daifugo/avatar-schema";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicRoom } from "../app/model";
import { LobbyScreen } from "../screens/LobbyScreen";

vi.mock("../avatar-3d/AvatarPortrait", () => ({
  AvatarPortrait: ({ label }: { label: string }) => <span aria-label={label} />,
}));

afterEach(cleanup);

describe("public room actions", () => {
  it("disables player entry before submitting a full table", () => {
    const room: PublicRoom = {
      roomId: "ABCDE",
      hostName: "主催者",
      hostAvatar: defaultAvatar,
      playerCount: 6,
      spectatorCount: 1,
      mode: "normal",
      blindCount: 0,
      phase: "waiting",
      createdAtMs: Date.now(),
    };
    const join = vi.fn();

    render(
      <LobbyScreen
        profile={{ name: "私", avatar: defaultAvatar }}
        rooms={[room]}
        connection="connected"
        busy={false}
        create={() => undefined}
        join={join}
      />,
    );

    const playerEntry = screen.getByRole("button", {
      name: "主催者の部屋 ABCDE にプレイヤー参加",
    });
    expect(playerEntry).toBeDisabled();
    expect(playerEntry).toHaveTextContent("満席");
    expect(screen.getByRole("button", { name: /を観戦/ })).toBeEnabled();
    expect(join).not.toHaveBeenCalled();
  });
});
