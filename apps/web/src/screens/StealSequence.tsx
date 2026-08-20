import { useEffect, useMemo, useRef, useState } from "react";
import type { CardView, PendingEffectView, RoomView } from "../app/model";
import { compactCardLabel } from "../gameplay/cardPresentation";
import { stealAnimationCue, type CueEvent } from "../network/peerCues";

export interface StealVisualState {
  stage: "target" | "point" | "take" | "complete";
  perspective: "actor" | "victim" | "observer";
  actorId: string;
  targetPlayerId: string;
  cardCount: number;
  takeCount: number;
  slot?: number;
  pointerX?: number;
  selectedSlots?: number[];
  cards?: CardView[];
}

export function shuffleStealCandidates<T>(items: readonly T[], nonce: string): T[] {
  let seed = 2166136261;
  for (const character of nonce) {
    seed ^= character.codePointAt(0) ?? 0;
    seed = Math.imul(seed, 16777619);
  }
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const random = (seed >>> 0) / 4294967296;
    const other = Math.floor(random * (index + 1));
    [next[index], next[other]] = [next[other]!, next[index]!];
  }
  return next;
}

const cardLabel = (card: CardView) =>
  card.visibility === "hidden"
    ? "裏向きの札"
    : card.blind
      ? `${compactCardLabel(card)}（ブラインド公開札）`
      : compactCardLabel(card);

type Selection = { targetUid: string; cardId: string };
type Allocation = { playerId: string; count: number };

export function StealSequence({
  effect,
  room,
  busy,
  lastCue,
  sendCue,
  resolve,
  onVisual,
}: {
  effect: PendingEffectView;
  room: RoomView;
  busy: boolean;
  lowPower: boolean;
  reducedMotion: boolean;
  lastCue?: { cue: CueEvent; sender: string } | undefined;
  sendCue: (cue: CueEvent) => Promise<boolean>;
  resolve: (payload: { selections: Selection[] }) => Promise<boolean>;
  onVisual: (state: StealVisualState | undefined) => void;
}) {
  const actor = effect.actorId === room.viewerId;
  const [stage, setStage] = useState<"allocate" | "select" | "review">("allocate");
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [targetIndex, setTargetIndex] = useState(0);
  const [cards, setCards] = useState<CardView[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [status, setStatus] = useState("");
  const lastPointerCueAt = useRef(0);
  const eligiblePlayers = useMemo(
    () =>
      room.players.filter(
        (player) =>
          player.id !== effect.actorId &&
          player.status === "active" &&
          (!effect.eligiblePlayerIds || effect.eligiblePlayerIds.includes(player.id)),
      ),
    [effect.actorId, effect.eligiblePlayerIds, room.players],
  );
  const allCardsFor = (playerId: string) =>
    (room.players.find((player) => player.id === playerId)?.cards ?? []).filter(
      (card) => !effect.eligibleCardIds || effect.eligibleCardIds.includes(card.id),
    );
  const presentationCards = (items: CardView[]) =>
    items.map((card) =>
      card.visibility === "face" && card.blind
        ? card
        : ({ id: card.id, visibility: "hidden", blind: false } as CardView),
    );
  const allocationList: Allocation[] = eligiblePlayers
    .map((player) => ({ playerId: player.id, count: allocations[player.id] ?? 0 }))
    .filter((allocation) => allocation.count > 0);
  const allocatedCount = allocationList.reduce((sum, allocation) => sum + allocation.count, 0);
  const currentAllocation = allocationList[targetIndex];

  useEffect(() => {
    setStage(effect.requiredCount === 0 ? "review" : "allocate");
    setAllocations({});
    setTargetIndex(0);
    setCards([]);
    setSelectedSlots([]);
    setSelections([]);
    setStatus("");
    onVisual(undefined);
    return () => onVisual(undefined);
  }, [effect.id, effect.requiredCount, onVisual]);

  useEffect(() => {
    if (actor) return;
    const cue = lastCue?.cue;
    if (cue?.type !== "animation" || cue.cue !== "steal" || lastCue?.sender !== effect.actorId)
      return;
    const isVictim = cue.targetPlayerId === room.viewerId;
    onVisual({
      stage: cue.stage,
      perspective: isVictim ? "victim" : "observer",
      actorId: effect.actorId,
      targetPlayerId: cue.targetPlayerId,
      cardCount: cue.cardCount,
      takeCount: cue.takeCount,
      ...(cue.slot === undefined ? {} : { slot: cue.slot }),
      ...(cue.pointerX === undefined ? {} : { pointerX: cue.pointerX }),
      ...(cue.selectedSlots ? { selectedSlots: cue.selectedSlots } : {}),
    });
    if (isVictim) {
      const actorName = room.players.find((player) => player.id === effect.actorId)?.name ?? "相手";
      setStatus(
        cue.stage === "complete"
          ? `${actorName}の選択が終わりました`
          : `${actorName}があなたの札を選んでいます`,
      );
    }
  }, [actor, effect.actorId, lastCue, onVisual, room.players, room.viewerId]);

  const updateAllocation = (playerId: string, delta: number) => {
    setAllocations((current) => {
      const otherTotal = Object.entries(current).reduce(
        (sum, [id, count]) => sum + (id === playerId ? 0 : count),
        0,
      );
      const capacity = allCardsFor(playerId).length;
      const next = Math.max(
        0,
        Math.min(capacity, effect.requiredCount - otherTotal, (current[playerId] ?? 0) + delta),
      );
      return { ...current, [playerId]: next };
    });
  };

  const showTarget = (allocation: Allocation, nextTargetIndex: number) => {
    const shuffled = shuffleStealCandidates(
      allCardsFor(allocation.playerId),
      `${effect.id}:${allocation.playerId}`,
    );
    setTargetIndex(nextTargetIndex);
    setCards(shuffled);
    setSelectedSlots([]);
    setStage("select");
    onVisual({
      stage: "target",
      perspective: "actor",
      actorId: effect.actorId,
      targetPlayerId: allocation.playerId,
      cardCount: shuffled.length,
      takeCount: allocation.count,
      cards: presentationCards(shuffled),
      selectedSlots: [],
    });
    void sendCue(
      stealAnimationCue("target", allocation.playerId, {
        cardCount: shuffled.length,
        takeCount: allocation.count,
      }),
    ).catch(() => setStatus("指先の共有に失敗しました。位置選択は続けられます"));
    setStatus(
      `${room.players.find((player) => player.id === allocation.playerId)?.name ?? "対象"}から${allocation.count}枚選んでください`,
    );
  };

  const startSelecting = () => {
    const first = allocationList[0];
    if (!first || allocatedCount !== effect.requiredCount) return;
    showTarget(first, 0);
  };

  const point = (slot: number, pointerX: number, force = false) => {
    if (!currentAllocation) return;
    onVisual({
      stage: "point",
      perspective: "actor",
      actorId: effect.actorId,
      targetPlayerId: currentAllocation.playerId,
      cardCount: cards.length,
      takeCount: currentAllocation.count,
      slot,
      pointerX,
      selectedSlots,
      cards: presentationCards(cards),
    });
    const now = performance.now();
    if (!force && now - lastPointerCueAt.current < 75) return;
    lastPointerCueAt.current = now;
    void sendCue(
      stealAnimationCue("point", currentAllocation.playerId, {
        cardCount: cards.length,
        takeCount: currentAllocation.count,
        slot,
        pointerX,
        selectedSlots,
      }),
    ).catch(() => undefined);
  };

  const chooseSlot = (slot: number) => {
    if (!currentAllocation) return;
    const already = selectedSlots.includes(slot);
    if (!already && selectedSlots.length >= currentAllocation.count) return;
    const nextSlots = already
      ? selectedSlots.filter((selected) => selected !== slot)
      : [...selectedSlots, slot];
    setSelectedSlots(nextSlots);
    const pointerX = cards.length <= 1 ? 0 : (slot / (cards.length - 1)) * 2 - 1;
    onVisual({
      stage: "take",
      perspective: "actor",
      actorId: effect.actorId,
      targetPlayerId: currentAllocation.playerId,
      cardCount: cards.length,
      takeCount: currentAllocation.count,
      slot,
      pointerX,
      selectedSlots: nextSlots,
      cards: presentationCards(cards),
    });
    void sendCue(
      stealAnimationCue("take", currentAllocation.playerId, {
        cardCount: cards.length,
        takeCount: currentAllocation.count,
        slot,
        pointerX,
        selectedSlots: nextSlots,
      }),
    ).catch(() => undefined);
  };

  const finishTarget = () => {
    if (!currentAllocation || selectedSlots.length !== currentAllocation.count) return;
    const targetSelections = selectedSlots.flatMap((slot) => {
      const card = cards[slot];
      return card ? [{ targetUid: currentAllocation.playerId, cardId: card.id }] : [];
    });
    const nextSelections = [...selections, ...targetSelections];
    setSelections(nextSelections);
    const nextAllocation = allocationList[targetIndex + 1];
    if (nextAllocation) showTarget(nextAllocation, targetIndex + 1);
    else {
      setStage("review");
      setStatus(`${nextSelections.length}枚の位置を選び終えました`);
      onVisual(undefined);
    }
  };

  const confirm = async () => {
    if (selections.length !== effect.requiredCount || busy) return;
    const last = allocationList.at(-1);
    if (last) {
      onVisual({
        stage: "complete",
        perspective: "actor",
        actorId: effect.actorId,
        targetPlayerId: last.playerId,
        cardCount: allCardsFor(last.playerId).length,
        takeCount: last.count,
      });
      void sendCue(
        stealAnimationCue("complete", last.playerId, {
          cardCount: allCardsFor(last.playerId).length,
          takeCount: last.count,
        }),
      ).catch(() => undefined);
    }
    await resolve({ selections });
  };

  if (!actor) {
    if (!status) return null;
    return (
      <section className="steal-panel victim" aria-live="polite">
        <p className="eyebrow">A STEAL · LIVE</p>
        <h2>相手が札を選択中</h2>
        <p>{status}</p>
        <p className="steal-victim-note">相手の指先は卓上に表示されます。操作は必要ありません。</p>
      </section>
    );
  }

  return (
    <section className="steal-panel" aria-labelledby="steal-title">
      <p className="eyebrow">FORCED EFFECT · A STEAL</p>
      <h2 id="steal-title">A奪い</h2>
      <p>{effect.message}</p>
      <ol className="steal-progress" aria-label="A奪いの進行">
        <li className={stage === "allocate" ? "active" : ""}>枚数配分</li>
        <li className={stage === "select" ? "active" : ""}>位置選択</li>
        <li className={stage === "review" ? "active" : ""}>一括確定</li>
      </ol>
      {stage === "allocate" && (
        <div className="steal-allocations">
          <p>
            合計 <strong>{allocatedCount}</strong> / {effect.requiredCount}枚
          </p>
          {eligiblePlayers.map((player) => {
            const count = allocations[player.id] ?? 0;
            return (
              <div className="steal-allocation-row" key={player.id}>
                <span>
                  <strong>{player.name}</strong>
                  <small>手札 {allCardsFor(player.id).length}枚</small>
                </span>
                <button
                  type="button"
                  aria-label={`${player.name}から奪う枚数を減らす`}
                  disabled={count === 0}
                  onClick={() => updateAllocation(player.id, -1)}
                >
                  −
                </button>
                <output aria-label={`${player.name}から${count}枚`}>{count}</output>
                <button
                  type="button"
                  aria-label={`${player.name}から奪う枚数を増やす`}
                  disabled={
                    allocatedCount >= effect.requiredCount || count >= allCardsFor(player.id).length
                  }
                  onClick={() => updateAllocation(player.id, 1)}
                >
                  ＋
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="primary"
            disabled={allocatedCount !== effect.requiredCount}
            onClick={startSelecting}
          >
            この配分で位置を選ぶ
          </button>
        </div>
      )}
      {stage === "select" && currentAllocation && (
        <div>
          <p>
            {room.players.find((player) => player.id === currentAllocation.playerId)?.name}から{" "}
            <strong>
              {selectedSlots.length} / {currentAllocation.count}枚
            </strong>
          </p>
          <div
            className="steal-slots"
            role="listbox"
            aria-label="奪う位置"
            aria-multiselectable="true"
          >
            {cards.map((card, index) => (
              <button
                type="button"
                role="option"
                key={card.id}
                aria-selected={selectedSlots.includes(index)}
                aria-label={`${index + 1}番目 ${cardLabel(card)}`}
                onPointerMove={(event) => {
                  const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
                  const pointerX = bounds
                    ? Math.max(
                        -1,
                        Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1),
                      )
                    : 0;
                  point(index, pointerX);
                }}
                onFocus={() =>
                  point(index, cards.length <= 1 ? 0 : (index / (cards.length - 1)) * 2 - 1, true)
                }
                onClick={() => chooseSlot(index)}
              >
                {card.visibility === "hidden" ? "◆" : cardLabel(card)}
                <small>{index + 1}</small>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="primary steal-next-target"
            disabled={selectedSlots.length !== currentAllocation.count}
            onClick={finishTarget}
          >
            {allocationList[targetIndex + 1] ? "次のプレイヤーへ" : "選択内容を確認"}
          </button>
        </div>
      )}
      {stage === "review" && (
        <div className="steal-review">
          <p>{selections.length}枚を一回のコマンドで確定します。</p>
          <ul>
            {allocationList.map((allocation) => (
              <li key={allocation.playerId}>
                {room.players.find((player) => player.id === allocation.playerId)?.name}から
                {allocation.count}枚
              </li>
            ))}
          </ul>
          <button type="button" className="primary" disabled={busy} onClick={() => void confirm()}>
            {busy ? "確定中…" : "A奪いを確定"}
          </button>
        </div>
      )}
      <p role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
