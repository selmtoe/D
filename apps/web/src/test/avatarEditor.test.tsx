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
    ).toHaveLength(72);
    fireEvent.click(screen.getByRole("option", { name: "髪色 18" }));
    expect(screen.getByRole("option", { name: "髪色 18" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "装飾" }));
    expect(
      within(screen.getByRole("listbox", { name: "eyewearのパーツ" })).getAllByRole("option"),
    ).toHaveLength(29);
    expect(
      within(screen.getByRole("listbox", { name: "headwearのパーツ" })).getAllByRole("option"),
    ).toHaveLength(41);
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
