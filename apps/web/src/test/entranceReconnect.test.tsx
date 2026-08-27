import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultAvatar } from "@daifugo/avatar-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntranceScreen } from "../screens/EntranceScreen";

vi.mock("../game-3d/SalonScene", () => ({ SalonScene: () => <div aria-hidden="true" /> }));

afterEach(cleanup);

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
        mobileMode={false}
        setMobileMode={() => undefined}
        muted
        setMuted={() => undefined}
        openEditor={openEditor}
        openRules={() => undefined}
        enter={enter}
        enterCpuRoom={() => undefined}
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

  it("branches into the stored mobile control mode from the entrance", () => {
    const setMobileMode = vi.fn();
    render(
      <EntranceScreen
        app={{ phase: "ENTRANCE", connection: "connected" }}
        avatar={defaultAvatar}
        setAvatar={() => undefined}
        lowPower={false}
        setLowPower={() => undefined}
        mobileMode={false}
        setMobileMode={setMobileMode}
        muted={false}
        setMuted={() => undefined}
        openEditor={() => undefined}
        openRules={() => undefined}
        enter={() => undefined}
        enterCpuRoom={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "スマホ版" }));
    expect(setMobileMode).toHaveBeenCalledWith(true);
  });

  it("can enter a CPU room while Firebase authentication is still pending", () => {
    const enter = vi.fn();
    const enterCpuRoom = vi.fn();
    render(
      <EntranceScreen
        app={{ phase: "AUTHENTICATING", connection: "connecting" }}
        avatar={defaultAvatar}
        setAvatar={() => undefined}
        lowPower={false}
        setLowPower={() => undefined}
        mobileMode={false}
        setMobileMode={() => undefined}
        muted={false}
        setMuted={() => undefined}
        openEditor={() => undefined}
        openRules={() => undefined}
        enter={enter}
        enterCpuRoom={enterCpuRoom}
      />,
    );

    expect(screen.getByRole("button", { name: "認証中…" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "プレイヤー名" }), {
      target: { value: "ローカル太郎" },
    });
    fireEvent.click(screen.getByRole("button", { name: "CPU部屋（オフライン）" }));
    expect(enter).not.toHaveBeenCalled();
    expect(enterCpuRoom).toHaveBeenCalledWith("ローカル太郎", defaultAvatar);
  });
});
