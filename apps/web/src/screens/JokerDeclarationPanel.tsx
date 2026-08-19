import { useState } from "react";
import type { Rank, RoomView, Suit } from "../app/model";

const suits = { spade: "スペード", heart: "ハート", diamond: "ダイヤ", club: "クラブ" } as const;
export function JokerDeclarationPanel({
  pending,
  busy,
  confirm,
}: {
  pending: NonNullable<RoomView["pendingJokerMimic"]>;
  busy: boolean;
  confirm: (mimics: { cardId: string; suit: Suit; rank: Rank }[]) => void;
}) {
  const [candidateIndex, setCandidateIndex] = useState<number>();
  const chosen = candidateIndex === undefined ? undefined : pending.candidates[candidateIndex];
  return (
    <section className="effect-panel joker-declaration" aria-labelledby="joker-declaration-title">
      <p className="eyebrow">BLIND JOKER REVEALED</p>
      <h2 id="joker-declaration-title">Jokerの擬態を宣言</h2>
      <p>
        ブラインドJokerが公開されました。組合せ依存を保った合法候補セットから一つ選んでください。
      </p>
      <div className="joker-candidate-sets" role="radiogroup" aria-label="Joker擬態の合法候補">
        {pending.candidates.map((candidateSet, index) => (
          <label key={index}>
            <input
              type="radio"
              name="joker-candidate"
              checked={candidateIndex === index}
              onChange={() => setCandidateIndex(index)}
            />
            <span>
              {candidateSet
                .map(
                  (candidate, jokerIndex) =>
                    `Joker ${jokerIndex + 1}: ${suits[candidate.suit]} ${candidate.rank}`,
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
