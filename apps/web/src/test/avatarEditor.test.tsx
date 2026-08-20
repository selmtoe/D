import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { defaultAvatar } from "@daifugo/avatar-schema";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-three/fiber", () => ({
  Canvas: () => <div data-testid="avatar-canvas" />,
}));
vi.mock("../avatar-3d/Avatar3D", () => ({
  Avatar3D: ({ profile }: { profile: typeof defaultAvatar }) => (
    <output data-testid="avatar-profile">{`${profile.bodyPresetId}|${profile.colors.hair}`}</output>
  ),
}));
vi.mock("../network/firebaseClient", () => ({
  firebaseErrorMessage: () => "error",
  sendCommand: vi.fn().mockResolvedValue({ ok: true }),
}));

import { AvatarEditor } from "../avatar-3d/AvatarEditor";

afterEach(cleanup);

describe("avatar editor breadth and mobile controls", () => {
  it("previews every hair, eyewear and headwear choice", () => {
    render(<AvatarEditor value={defaultAvatar} onCancel={vi.fn()} onSave={vi.fn()} lowPower />);

    fireEvent.click(screen.getByRole("tab", { name: "髪" }));
    expect(
      within(screen.getByRole("listbox", { name: "hairのパーツ" })).getAllByRole("option"),
    ).toHaveLength(144);
    fireEvent.click(screen.getByRole("option", { name: "髪色 18" }));
    expect(screen.getByRole("option", { name: "髪色 18" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "装飾" }));
    expect(
      within(screen.getByRole("listbox", { name: "eyewearのパーツ" })).getAllByRole("option"),
    ).toHaveLength(81);
    expect(
      within(screen.getByRole("listbox", { name: "headwearのパーツ" })).getAllByRole("option"),
    ).toHaveLength(121);
  });

  it("offers touch drawing tools with eraser, per-stroke undo and clear", () => {
    const context = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const painted = {
      ...defaultAvatar,
      facePaint: {
        version: 1 as const,
        strokes: [
          {
            mode: "paint" as const,
            color: "#bc2942",
            width: 0.035,
            points: [{ x: 0.2, y: 0.3 }],
          },
        ],
      },
    };
    render(<AvatarEditor value={painted} onCancel={vi.fn()} onSave={vi.fn()} lowPower />);
    fireEvent.click(screen.getByRole("tab", { name: "ペイント" }));
    const paintCanvas = screen.getByLabelText("顔へペイントする描画領域") as HTMLCanvasElement;
    expect(paintCanvas).toHaveAttribute("width", "512");
    expect(screen.getByRole("slider", { name: "フェイスペイントの太さ" })).toHaveAttribute(
      "max",
      "120",
    );
    fireEvent.click(screen.getByRole("button", { name: "消しゴム" }));
    expect(screen.getByRole("button", { name: "消しゴム中" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "1本戻す" }));
    expect(screen.getByRole("button", { name: "1本戻す" })).toBeDisabled();
    vi.spyOn(paintCanvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      width: 300,
      height: 300,
      toJSON: () => ({}),
    });
    Object.assign(paintCanvas, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    });
    fireEvent.pointerDown(paintCanvas, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 60,
      clientY: 80,
    });
    fireEvent.pointerMove(paintCanvas, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 170,
    });
    fireEvent.pointerUp(paintCanvas, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 170,
    });
    expect(screen.getByText(`1/32 本`)).toBeVisible();
    expect(screen.getByRole("button", { name: "1本戻す" })).toBeEnabled();
    contextSpy.mockRestore();
  });

  it("offers independent safe body controls and explicit touch-friendly preview buttons", () => {
    render(<AvatarEditor value={defaultAvatar} onCancel={vi.fn()} onSave={vi.fn()} lowPower />);
    fireEvent.click(screen.getByRole("tab", { name: "体格" }));
    expect(screen.getByRole("slider", { name: /^身長/ })).toHaveAttribute("min", "0");
    expect(screen.getByRole("slider", { name: /^肩幅/ })).toHaveAttribute("max", "1");
    expect(screen.getByRole("slider", { name: /^胴と脚/ })).toHaveAttribute("max", "3");
    fireEvent.change(screen.getByRole("slider", { name: /^胴と脚/ }), {
      target: { value: "3" },
    });
    expect(screen.getByText(/胴脚 4\/4/)).toBeVisible();
    expect(screen.getByRole("button", { name: "左へ回す" })).toBeVisible();
    expect(screen.getByRole("button", { name: "右へ回す" })).toBeVisible();
    expect(screen.getByRole("button", { name: "プレビューを拡大" })).toBeVisible();
  });
});
