import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PERSONAL_SETTINGS, type AutoPassDelayMode } from "../app/browserStorage";
import { PersonalSettingsDialog } from "../components/PersonalSettingsDialog";
import { autoPassDelayMs, canAutoPass, useAutoPass } from "../screens/GameScreen";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("personal settings dialog", () => {
  it("exposes local options and updates a single setting without losing the others", () => {
    const change = vi.fn();
    render(
      <PersonalSettingsDialog
        settings={{ ...DEFAULT_PERSONAL_SETTINGS }}
        close={() => undefined}
        change={change}
      />,
    );

    expect(screen.getByRole("dialog", { name: "個人設定" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /出せないカードを暗くする/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /手札を自動整列/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /すぐにパス/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /出せる札がない時に自動パス/ }));
    expect(change).toHaveBeenCalledWith({
      ...DEFAULT_PERSONAL_SETTINGS,
      autoPass: true,
    });
  });

  it("closes with Escape", () => {
    const close = vi.fn();
    render(
      <PersonalSettingsDialog
        settings={{ ...DEFAULT_PERSONAL_SETTINGS }}
        close={close}
        change={() => undefined}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});

function AutoPassHarness({
  eligible,
  turnKey,
  delayMode,
  submitPass,
  random,
}: {
  eligible: boolean;
  turnKey: string;
  delayMode: AutoPassDelayMode;
  submitPass: () => Promise<boolean>;
  random: () => number;
}) {
  const autoPass = useAutoPass({ eligible, turnKey, delayMode, submitPass, random });
  return (
    <button
      type="button"
      onClick={() => {
        autoPass.markHandled();
        void submitPass();
      }}
    >
      手動パス
    </button>
  );
}

describe("automatic pass", () => {
  it("only becomes eligible for a connected, unobstructed turn with no legal card", () => {
    const base = {
      enabled: true,
      myTurn: true,
      readOnly: false,
      busy: false,
      dealing: false,
      playBlocked: false,
      connected: true,
      roomPhase: "playing" as const,
      handCount: 5,
      playableCardCount: 0,
    };
    expect(canAutoPass(base)).toBe(true);
    expect(canAutoPass({ ...base, playableCardCount: 1 })).toBe(false);
    expect(canAutoPass({ ...base, playBlocked: true })).toBe(false);
    expect(canAutoPass({ ...base, connected: false })).toBe(false);
  });

  it("bounds random delays between zero and five seconds", () => {
    expect(autoPassDelayMs("instant", () => 0.9)).toBe(0);
    expect(autoPassDelayMs("random", () => 0)).toBe(0);
    expect(autoPassDelayMs("random", () => 0.5)).toBe(2500);
    expect(autoPassDelayMs("random", () => 1)).toBe(5000);
  });

  it("fires once per turn and cancels the old timer when the turn changes", () => {
    vi.useFakeTimers();
    const submitPass = vi.fn().mockResolvedValue(true);
    const view = render(
      <AutoPassHarness
        eligible
        turnKey="turn-1"
        delayMode="random"
        submitPass={submitPass}
        random={() => 0.5}
      />,
    );

    act(() => vi.advanceTimersByTime(2000));
    view.rerender(
      <AutoPassHarness
        eligible
        turnKey="turn-2"
        delayMode="random"
        submitPass={submitPass}
        random={() => 0.5}
      />,
    );
    act(() => vi.advanceTimersByTime(501));
    expect(submitPass).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1999));
    expect(submitPass).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(10000));
    expect(submitPass).toHaveBeenCalledOnce();
  });

  it("cancels its reservation when the player passes manually", () => {
    vi.useFakeTimers();
    const submitPass = vi.fn().mockResolvedValue(true);
    render(
      <AutoPassHarness
        eligible
        turnKey="turn-1"
        delayMode="random"
        submitPass={submitPass}
        random={() => 0.5}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "手動パス" }));
    act(() => vi.advanceTimersByTime(10000));
    expect(submitPass).toHaveBeenCalledOnce();
  });
});
