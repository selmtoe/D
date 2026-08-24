import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardView, Suit } from "../app/model";
import { canOpenPlayConfirmation, canShowPlayControls, PlayDialog } from "../screens/GameScreen";

afterEach(cleanup);

describe("play confirmation dialog", () => {
  it("invalidates an open confirmation after the turn or selection changes", () => {
    expect(canOpenPlayConfirmation(true, true, false, false)).toBe(true);
    expect(canOpenPlayConfirmation(true, false, false, false)).toBe(false);
    expect(canOpenPlayConfirmation(false, true, false, false)).toBe(false);
    expect(canOpenPlayConfirmation(true, true, false, true)).toBe(false);
  });

  it("hides the play controls while the log panel is open", () => {
    expect(canShowPlayControls(false, false, false, false)).toBe(true);
    expect(canShowPlayControls(false, false, false, true)).toBe(false);
  });

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
    const club = screen.getByRole("radio", { name: "JOKERⅠ: クラブ 7" });
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
    expect(screen.getByRole("radio", { name: "JOKERⅠ: クラブ 7" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "JOKERⅠ: クラブ 7" })).toHaveFocus();
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
