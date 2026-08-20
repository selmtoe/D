import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccessibleHand, cardLabel } from "../accessibility/AccessibleHand";
import type { CardView } from "../app/model";

const face: CardView = {
  id: "face-1",
  visibility: "face",
  suit: "diamond",
  rank: "3",
  blind: false,
};
const hidden: CardView = { id: "opaque-blind-token", visibility: "hidden", blind: true };

describe("accessible hand", () => {
  it("never reveals an owner's blind face in its accessible name", () => {
    expect(cardLabel(hidden, 0, false)).toBe("ブラインド札 1、中身は非公開、未選択");
    expect(cardLabel(hidden, 0, false)).not.toMatch(/ダイヤ|スペード|[3-9]|10|J|Q|K|A|2/);
  });
  it("supports selection and keyboard submission", () => {
    const toggle = vi.fn();
    const submit = vi.fn();
    render(
      <AccessibleHand
        cards={[face, hidden]}
        selectedIds={[]}
        onToggle={toggle}
        onSubmit={submit}
      />,
    );
    const first = screen.getByRole("option", { name: /ダイヤ3/ });
    fireEvent.keyDown(first, { key: " " });
    fireEvent.keyDown(first, { key: "Enter" });
    expect(toggle).toHaveBeenCalledWith(face);
    expect(submit).toHaveBeenCalledOnce();
  });
  it("uses suit glyphs and prevents selecting a provably impossible card", () => {
    const toggle = vi.fn();
    const { container } = render(
      <AccessibleHand
        cards={[face, hidden]}
        selectedIds={[]}
        playableIds={new Set([hidden.id])}
        onToggle={toggle}
        onSubmit={() => undefined}
      />,
    );
    expect(container).toHaveTextContent("♦3");
    const unavailable = screen.getByRole("option", { name: /現在の場には出せません/ });
    expect(unavailable).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(unavailable);
    expect(toggle).not.toHaveBeenCalled();
  });
});
