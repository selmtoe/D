import { useState } from "react";
import type { Rank, RoomView, Suit } from "../app/model";

const suits = { spade: "スペード", heart: "ハート", diamond: "ダイヤ", club: "クラブ" } as const;
const candidateKey = (candidate: { cardId: string; suit: Suit; rank: Rank }[]) =>
  [...candidate]
    .sort((left, right) => left.cardId.localeCompare(right.cardId))
    .map(({ cardId, suit, rank }) => `${cardId}:${suit}:${rank}`)
    .join("|");

export function JokerDeclarationPanel({
  pending,
  busy,
  confirm,
}: {
  pending: NonNullable<RoomView["pendingJokerMimic"]>;
  busy: boolean;
  confirm: (mimics: { cardId: string; suit: Suit; rank: Rank }[]) => void;
}) {
  // The legal list is authoritative, so make the first valid declaration ready
  // immediately instead of forcing an otherwise meaningless extra click.
  const [selectedKey, setSelectedKey] = useState(() => candidateKey(pending.candidates[0] ?? []));
  const chosen =
    pending.candidates.find((candidate) => candidateKey(candidate) === selectedKey) ??
    pending.candidates[0];
  const jokerName = (cardId: string, jokerIndex: number) => {
    const joker = pending.revealedCards?.find((card) => card.id === cardId);
    return joker?.visibility === "face" && joker.joker === "crimson"
      ? "JOKERⅡ"
      : joker?.visibility === "face" && joker.joker === "monochrome"
        ? "JOKERⅠ"
        : `Joker ${jokerIndex + 1}`;
  };
  return (
    <section className="effect-panel joker-declaration" aria-labelledby="joker-declaration-title">
      <p className="eyebrow">BLIND JOKER REVEALED</p>
      <h2 id="joker-declaration-title">Jokerの擬態を宣言</h2>
      <p>
        ブラインドJokerが公開されました。組合せ依存を保った合法候補セットから一つ選んでください。
      </p>
      <div className="joker-candidate-sets" role="radiogroup" aria-label="Joker擬態の合法候補">
        {pending.candidates.map((candidateSet) => (
          <label key={candidateKey(candidateSet)}>
            <input
              type="radio"
              name="pending-joker-candidate"
              disabled={busy}
              checked={candidateKey(chosen ?? []) === candidateKey(candidateSet)}
              onChange={() => setSelectedKey(candidateKey(candidateSet))}
            />
            <span>
              {candidateSet
                .map(
                  (candidate, jokerIndex) =>
                    `${jokerName(candidate.cardId, jokerIndex)}: ${suits[candidate.suit]} ${candidate.rank}`,
                )
                .join(" / ")}
            </span>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="primary"
        disabled={busy || !chosen}
        onClick={() => chosen && confirm(chosen)}
      >
        {busy ? "確定中…" : "擬態を確定する"}
      </button>
    </section>
  );
}
