import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CardView, Suit } from "../app/model";
import { PlayDialog } from "../screens/GameScreen";

describe("play confirmation dialog", () => {
  it("lets the player choose a legal Joker suit and rank", () => {
    const cards: CardView[] = [
      { id: "heart-7", visibility: "face", suit: "heart", rank: "7", blind: false },
      { id: "joker", visibility: "face", joker: "monochrome", blind: false },
    ];
    const candidates = (["spade", "heart", "diamond", "club"] as Suit[]).map((suit) => [
      { cardId: "joker", suit, rank: "7" as const },
    ]);
    const submit = vi.fn();
    render(
      <PlayDialog
        cards={cards}
        candidates={candidates}
        close={() => undefined}
        submit={submit}
        busy={false}
      />,
    );

    const confirm = screen.getByRole("button", { name: "この札を出す" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Joker 1のスート"), {
      target: { value: "club" },
    });
    fireEvent.change(screen.getByLabelText("Joker 1のランク"), {
      target: { value: "7" },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(submit).toHaveBeenCalledWith([{ cardId: "joker", suit: "club", rank: "7" }]);
  });
});
