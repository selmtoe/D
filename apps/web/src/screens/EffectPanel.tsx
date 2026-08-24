import { useMemo, useState } from "react";
import type { CardView, PendingEffectView, Rank, RoomView } from "../app/model";
import { compactCardLabel } from "../gameplay/cardPresentation";

const ranks: Rank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const cardText = (card: CardView) =>
  card.visibility === "hidden" ? "ブラインド札" : compactCardLabel(card);

export function EffectPanel({
  effect,
  room,
  busy,
  resolve,
}: {
  effect: PendingEffectView;
  room: RoomView;
  busy: boolean;
  resolve: (effect: PendingEffectView, payload: Record<string, unknown>) => void;
}) {
  const [cardIds, setCardIds] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [selectedRanks, setSelectedRanks] = useState<Rank[]>([]);
  const eligibleCards = useMemo(() => {
    const source =
      effect.kind === "steal"
        ? room.players
            .filter((player) => player.id !== room.viewerId && player.status === "active")
            .flatMap((player) => (player.cards ?? []).map((card) => ({ card, ownerId: player.id })))
        : [...room.hand, ...room.discard].map((card) => ({ card, ownerId: room.viewerId }));
    return source.filter(
      ({ card }) => !effect.eligibleCardIds || effect.eligibleCardIds.includes(card.id),
    );
  }, [effect.eligibleCardIds, effect.kind, room.discard, room.hand, room.players, room.viewerId]);
  const eligiblePlayers = room.players.filter(
    (player) =>
      player.id !== room.viewerId &&
      player.status === "active" &&
      (!effect.eligiblePlayerIds || effect.eligiblePlayerIds.includes(player.id)),
  );
  const toggleCard = (id: string) =>
    setCardIds((items) =>
      items.includes(id)
        ? items.filter((item) => item !== id)
        : items.length < effect.requiredCount
          ? [...items, id]
          : items,
    );
  const toggleRank = (rank: Rank) =>
    setSelectedRanks((items) =>
      items.includes(rank)
        ? items.filter((item) => item !== rank)
        : items.length < effect.requiredCount
          ? [...items, rank]
          : items,
    );
  const assigned = cardIds.every((cardId) => Boolean(targets[cardId]));
  const ready =
    effect.kind === "bomber"
      ? selectedRanks.length === effect.requiredCount
      : cardIds.length === effect.requiredCount &&
        (!["steal", "give"].includes(effect.kind) || assigned);
  return (
    <section className="effect-panel" aria-labelledby="effect-title">
      <p className="eyebrow">FORCED EFFECT</p>
      <h2 id="effect-title">
        {
          {
            steal: "A奪い",
            give: "7渡し",
            discard: "10捨て",
            bomber: "Qボンバー",
            collect: "K回収",
            clearField: "場流し",
          }[effect.kind]
        }
      </h2>
      <p>{effect.message}</p>
      {effect.kind === "bomber" ? (
        <div className="rank-grid" role="group" aria-label="捨てるランク">
          {[...ranks, "Joker"].map((rank) => (
            <button
              type="button"
              key={rank}
              disabled={busy}
              aria-pressed={selectedRanks.includes(rank as Rank)}
              onClick={() => toggleRank(rank as Rank)}
            >
              {rank}
            </button>
          ))}
        </div>
      ) : (
        <div className="effect-cards" role="group" aria-label="効果に使うカード">
          {eligibleCards.map(({ card, ownerId }) => (
            <div key={card.id}>
              <button
                type="button"
                aria-pressed={cardIds.includes(card.id)}
                onClick={() => {
                  toggleCard(card.id);
                  if (effect.kind === "steal")
                    setTargets((current) => ({ ...current, [card.id]: ownerId }));
                }}
              >
                {cardText(card)}
              </button>
              {cardIds.includes(card.id) && effect.kind === "give" && (
                <select
                  aria-label={`${cardText(card)}の渡し先`}
                  value={targets[card.id] ?? ""}
                  onChange={(event) =>
                    setTargets((current) => ({ ...current, [card.id]: event.target.value }))
                  }
                >
                  <option value="">渡し先</option>
                  {eligiblePlayers.map((player) => (
                    <option value={player.id} key={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
      <p aria-live="polite">
        {effect.kind === "bomber"
          ? `${selectedRanks.length}/${effect.requiredCount}ランク選択`
          : `${cardIds.length}/${effect.requiredCount}枚選択`}
      </p>
      <button
        type="button"
        className="primary"
        disabled={!ready || busy}
        onClick={() =>
          resolve(
            effect,
            effect.kind === "bomber"
              ? { ranks: selectedRanks }
              : effect.kind === "steal"
                ? { selections: cardIds.map((cardId) => ({ targetUid: targets[cardId], cardId })) }
                : effect.kind === "give"
                  ? { transfers: cardIds.map((cardId) => ({ targetUid: targets[cardId], cardId })) }
                  : { cardIds },
          )
        }
      >
        {busy ? "確定中…" : "効果を確定する"}
      </button>
    </section>
  );
}
