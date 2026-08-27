import { fireEvent, render, screen } from "@testing-library/react";
import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it, vi } from "vitest";
import { EntranceScreen } from "../screens/EntranceScreen";

vi.mock("../game-3d/SalonScene", () => ({ SalonScene: () => <div aria-hidden="true" /> }));

describe("entrance reconnect guard", () => {
  it("prevents a second room flow while an URL reconnect is pending", () => {
    const enter = vi.fn();
    const openEditor = vi.fn();
    render(
      <EntranceScreen
        app={{ phase: "ENTRANCE", connection: "connected" }}
        avatar={defaultAvatar}
        setAvatar={() => undefined}
        lowPower
        setLowPower={() => undefined}
        muted
        setMuted={() => undefined}
        openEditor={openEditor}
        openRules={() => undefined}
        enter={enter}
        reconnecting
      />,
    );

    const reconnect = screen.getByRole("button", { name: "部屋へ再接続中…" });
    expect(reconnect).toBeDisabled();
    expect(screen.getByRole("button", { name: "アバターを編集" })).toBeDisabled();
    fireEvent.submit(reconnect.closest("form")!);
    expect(enter).not.toHaveBeenCalled();
    expect(openEditor).not.toHaveBeenCalled();
  });
});
