import { useEffect, useRef } from "react";
import type { CardView } from "../app/model";

const suits = { spade: "スペード", heart: "ハート", diamond: "ダイヤ", club: "クラブ" } as const;
export function cardLabel(card: CardView, index: number, selected: boolean): string {
  const state = selected ? "選択中" : "未選択";
  if (card.visibility === "hidden") return `ブラインド札 ${index + 1}、中身は非公開、${state}`;
  const face = card.joker
    ? `ジョーカー${card.joker === "crimson" ? "2" : "1"}`
    : `${card.suit ? suits[card.suit] : ""}${card.rank ?? ""}`;
  const blind = card.blind ? "、所有者本人には見えていないブラインド札" : "";
  const mimic = card.mimic ? `、${suits[card.mimic.suit]}${card.mimic.rank}に擬態中` : "";
  return `${face}${blind}${mimic}、${state}`;
}

export function AccessibleHand({
  cards,
  selectedIds,
  onToggle,
  onSubmit,
}: {
  cards: CardView[];
  selectedIds: string[];
  onToggle: (card: CardView) => void;
  onSubmit: () => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    refs.current = refs.current.slice(0, cards.length);
  }, [cards.length]);
  return (
    <section className="accessible-hand" aria-labelledby="hand-title">
      <h2 id="hand-title" className="sr-only">
        手札
      </h2>
      <div role="listbox" aria-multiselectable="true" aria-label={`手札 ${cards.length}枚`}>
        {cards.map((card, index) => (
          <button
            key={card.id}
            type="button"
            role="option"
            aria-selected={selectedIds.includes(card.id)}
            aria-label={cardLabel(card, index, selectedIds.includes(card.id))}
            ref={(node) => {
              refs.current[index] = node;
            }}
            onClick={() => onToggle(card)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const direction = event.key === "ArrowRight" ? 1 : -1;
                refs.current[(index + direction + cards.length) % cards.length]?.focus();
              }
              if (event.key === " ") {
                event.preventDefault();
                onToggle(card);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
          >
            <span aria-hidden="true">
              {card.visibility === "hidden"
                ? "？"
                : card.joker
                  ? "JOKER"
                  : `${card.suit ? suits[card.suit].slice(0, 1) : ""}${card.rank}`}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
