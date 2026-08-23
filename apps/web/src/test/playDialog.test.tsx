import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardView, Suit } from "../app/model";
import { PlayDialog } from "../screens/GameScreen";

afterEach(cleanup);

describe("play confirmation dialog", () => {
  it("keeps a complete legal Joker candidate selectable across parent rerenders", () => {
    const cards: CardView[] = [
      { id: "heart-7", visibility: "face", suit: "heart", rank: "7", blind: false },
      { id: "joker", visibility: "face", joker: "monochrome", blind: false },
    ];
    const candidates = (["spade", "heart", "diamond", "club"] as Suit[]).map((suit) => [
      { cardId: "joker", suit, rank: "7" as const },
    ]);
    const submit = vi.fn();
    const view = render(
      <PlayDialog
        cards={cards}
        candidates={candidates}
        close={() => undefined}
        submit={submit}
        busy={false}
      />,
    );

    const confirm = screen.getByRole("button", { name: "この札を出す" });
    expect(confirm).toBeEnabled();
    const club = screen.getByRole("radio", { name: "クラブ 7" });
    fireEvent.click(club);
    club.focus();
    view.rerender(
      <PlayDialog
        cards={cards}
        candidates={[...candidates].reverse()}
        close={() => undefined}
        submit={submit}
        busy={false}
      />,
    );
    expect(screen.getByRole("radio", { name: "クラブ 7" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "クラブ 7" })).toHaveFocus();
    fireEvent.click(confirm);
    expect(submit).toHaveBeenCalledWith([{ cardId: "joker", suit: "club", rank: "7" }]);
  });

  it("prepares a unique Joker declaration without showing redundant controls", () => {
    const cards: CardView[] = [
      { id: "heart-7", visibility: "face", suit: "heart", rank: "7", blind: false },
      { id: "joker", visibility: "face", joker: "monochrome", blind: false },
    ];
    const submit = vi.fn();
    render(
      <PlayDialog
        cards={cards}
        candidates={[[{ cardId: "joker", suit: "spade", rank: "7" }]]}
        close={() => undefined}
        submit={submit}
        busy={false}
      />,
    );

    expect(screen.queryByRole("radiogroup", { name: "Jokerの擬態" })).not.toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "この札を出す" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(submit).toHaveBeenCalledWith([{ cardId: "joker", suit: "spade", rank: "7" }]);
  });
});
