import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomView } from "../app/model";
import { JokerDeclarationPanel } from "../screens/JokerDeclarationPanel";

afterEach(cleanup);

const candidates: NonNullable<RoomView["pendingJokerMimic"]>["candidates"] = [
  [{ cardId: "joker-1", suit: "spade", rank: "7" }],
  [{ cardId: "joker-1", suit: "club", rank: "7" }],
];

const pending: NonNullable<RoomView["pendingJokerMimic"]> = {
  cardIds: ["heart-7", "joker-1"],
  candidates,
  revealedJokerIds: ["joker-1"],
  revealedCards: [{ id: "joker-1", visibility: "face", joker: "monochrome", blind: true }],
};

describe("blind Joker declaration", () => {
  it("keeps the chosen suit across parent rerenders and confirms that candidate", () => {
    const confirm = vi.fn();
    const view = render(<JokerDeclarationPanel pending={pending} busy={false} confirm={confirm} />);

    const club = screen.getByRole("radio", { name: "JOKERⅠ: クラブ 7" });
    fireEvent.click(club);
    view.rerender(
      <JokerDeclarationPanel
        pending={{ ...pending, candidates: [...candidates].reverse() }}
        busy={false}
        confirm={confirm}
      />,
    );

    expect(screen.getByRole("radio", { name: "JOKERⅠ: クラブ 7" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "擬態を確定する" }));
    expect(confirm).toHaveBeenCalledWith([{ cardId: "joker-1", suit: "club", rank: "7" }]);
  });

  it("does not change the submitted candidate while confirmation is busy", () => {
    const confirm = vi.fn();
    const view = render(<JokerDeclarationPanel pending={pending} busy={false} confirm={confirm} />);
    fireEvent.click(screen.getByRole("button", { name: "擬態を確定する" }));
    expect(confirm).toHaveBeenCalledWith([{ cardId: "joker-1", suit: "spade", rank: "7" }]);

    view.rerender(<JokerDeclarationPanel pending={pending} busy confirm={confirm} />);
    const spade = screen.getByRole("radio", { name: "JOKERⅠ: スペード 7" });
    const club = screen.getByRole("radio", { name: "JOKERⅠ: クラブ 7" });
    expect(spade).toBeDisabled();
    expect(club).toBeDisabled();
    club.click();
    expect(spade).toBeChecked();
    expect(club).not.toBeChecked();
  });
});
