import { useEffect, useRef, useState } from "react";
import type { CardView, PendingEffectView, RoomView } from "../app/model";
import { stealAnimationCue, type CueEvent } from "../network/peerCues";
import { compactCardLabel } from "../gameplay/cardPresentation";

export interface StealVisualState {
  stage: "preview" | "shuffle" | "point" | "confirm";
  actorId: string;
  targetPlayerId: string;
  cardCount: number;
  slot?: number;
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

type StealCue = Extract<CueEvent, { type: "animation"; cue: "steal" }>;

export function StealSequence({
  effect,
  room,
  busy,
  lowPower,
  reducedMotion,
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
  resolve: (payload: { selections: { targetUid: string; cardId: string }[] }) => Promise<boolean>;
  onVisual: (state: StealVisualState | undefined) => void;
}) {
  const actor = effect.actorId === room.viewerId;
  const [stage, setStage] = useState<"target" | "waiting" | "point" | "review">("target");
  const [targetId, setTargetId] = useState<string>();
  const [cards, setCards] = useState<CardView[]>([]);
  const [slot, setSlot] = useState<number>();
  const [selections, setSelections] = useState<{ targetUid: string; cardId: string }[]>([]);
  const [presentation, setPresentation] = useState<StealCue>();
  const [shuffling, setShuffling] = useState(false);
  const [status, setStatus] = useState("");
  const advanceTimer = useRef<number | undefined>(undefined);
  const eligiblePlayers = room.players.filter(
    (player) =>
      player.id !== effect.actorId &&
      player.status === "active" &&
      (!effect.eligiblePlayerIds || effect.eligiblePlayerIds.includes(player.id)),
  );
  const cardsFor = (playerId: string) =>
    (room.players.find((player) => player.id === playerId)?.cards ?? []).filter(
      (card) =>
        !selections.some((selection) => selection.cardId === card.id) &&
        (!effect.eligibleCardIds || effect.eligibleCardIds.includes(card.id)),
    );
  const presentationCards = (items: CardView[]) =>
    items.map((card) =>
      card.visibility === "face" && card.blind
        ? card
        : ({ id: card.id, visibility: "hidden", blind: false } as CardView),
    );
  useEffect(() => {
    setStage(effect.requiredCount === 0 ? "review" : "target");
    setTargetId(undefined);
    setCards([]);
    setSlot(undefined);
    setSelections([]);
    setPresentation(undefined);
    setStatus("");
    onVisual(undefined);
    return () => {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
      onVisual(undefined);
    };
  }, [effect.id, onVisual]);
  useEffect(() => {
    const cue = lastCue?.cue;
    if (cue?.type !== "animation" || cue.cue !== "steal") return;
    const sender = lastCue?.sender;
    if (cue.stage === "shuffle") {
      if (sender !== cue.targetPlayerId && sender !== effect.actorId) return;
    } else if (sender !== effect.actorId) {
      return;
    }
    setPresentation(cue);
    const count = cardsFor(cue.targetPlayerId).length;
    onVisual({
      stage: cue.stage,
      actorId: effect.actorId,
      targetPlayerId: cue.targetPlayerId,
      cardCount: count,
      ...(cue.slot === undefined ? {} : { slot: cue.slot }),
    });
    if (
      actor &&
      stage === "waiting" &&
      cue.stage === "shuffle" &&
      cue.targetPlayerId === targetId
    ) {
      const shuffled = shuffleStealCandidates(cardsFor(cue.targetPlayerId), cue.eventId);
      setCards(shuffled);
      setStage("point");
      onVisual({
        stage: "point",
        actorId: effect.actorId,
        targetPlayerId: cue.targetPlayerId,
        cardCount: shuffled.length,
        cards: presentationCards(shuffled),
      });
      setStatus(
        `${room.players.find((player) => player.id === cue.targetPlayerId)?.name ?? "対象"}がシャッフルしました`,
      );
    }
  }, [actor, effect.actorId, lastCue, onVisual, room.players, stage, targetId]);
  const selectTarget = (playerId: string) => {
    const available = cardsFor(playerId);
    if (!available.length) return;
    setTargetId(playerId);
    setCards(available);
    setSlot(undefined);
    setStage("waiting");
    setStatus("相手のシャッフルを待っています");
    const cue = stealAnimationCue("preview", playerId);
    setPresentation(cue as StealCue);
    onVisual({
      stage: "preview",
      actorId: effect.actorId,
      targetPlayerId: playerId,
      cardCount: available.length,
      cards: presentationCards(available),
    });
    void sendCue(cue).catch(() =>
      setStatus("共有演出を送れませんでした。代理シャッフルを使えます"),
    );
  };
  const shuffle = (playerId: string, localActor: boolean) => {
    setShuffling(true);
    setStatus("カードを混ぜています…");
    const available = cardsFor(playerId);
    onVisual({
      stage: "shuffle",
      actorId: effect.actorId,
      targetPlayerId: playerId,
      cardCount: available.length,
      ...(localActor ? { cards: presentationCards(available) } : {}),
    });
    const delay = reducedMotion ? 0 : lowPower ? 240 : 760;
    advanceTimer.current = window.setTimeout(() => {
      const cue = stealAnimationCue("shuffle", playerId);
      setPresentation(cue as StealCue);
      setShuffling(false);
      void sendCue(cue).catch(() => setStatus("演出共有に失敗しました"));
      if (localActor) {
        const shuffled = shuffleStealCandidates(cardsFor(playerId), cue.eventId);
        setCards(shuffled);
        setStage("point");
        onVisual({
          stage: "point",
          actorId: effect.actorId,
          targetPlayerId: playerId,
          cardCount: shuffled.length,
          cards: presentationCards(shuffled),
        });
        setStatus("混ぜ終わりました。取る位置を選んでください");
      } else {
        setStatus("シャッフルしました");
      }
    }, delay);
  };
  const point = (nextSlot: number) => {
    if (!targetId) return;
    setSlot(nextSlot);
    onVisual({
      stage: "point",
      actorId: effect.actorId,
      targetPlayerId: targetId,
      cardCount: cards.length,
      slot: nextSlot,
      cards: presentationCards(cards),
    });
    void sendCue(stealAnimationCue("point", targetId, nextSlot)).catch(() => undefined);
  };
  const takePointed = () => {
    if (slot === undefined || !targetId) return;
    const selected = cards[slot];
    if (!selected) return;
    const next = [...selections, { targetUid: targetId, cardId: selected.id }];
    setSelections(next);
    setSlot(undefined);
    if (next.length >= effect.requiredCount) {
      setStage("review");
      setStatus("選択をまとめて確定できます");
    } else {
      setStage("target");
      setTargetId(undefined);
      setCards([]);
      setStatus(`あと${effect.requiredCount - next.length}枚です`);
      onVisual(undefined);
    }
  };
  const confirm = async () => {
    if (selections.length !== effect.requiredCount) return;
    if (!(await resolve({ selections }))) return;
    const last = selections.at(-1);
    if (last) {
      const cue = stealAnimationCue("confirm", last.targetUid);
      void sendCue(cue).catch(() => undefined);
      onVisual({
        stage: "confirm",
        actorId: effect.actorId,
        targetPlayerId: last.targetUid,
        cardCount: 1,
      });
    }
  };
  const targetRequest =
    !actor && presentation?.stage === "preview" && presentation.targetPlayerId === room.viewerId;
  if (!actor) {
    if (!targetRequest && !(shuffling && presentation?.targetPlayerId === room.viewerId))
      return null;
    return (
      <section className="steal-panel victim" aria-labelledby="steal-victim-title">
        <p className="eyebrow">A STEAL</p>
        <h2 id="steal-victim-title">あなたの札をシャッフル</h2>
        <p>カードの中身や並びは相手へ送られません。見た目の位置だけを混ぜます。</p>
        <button
          type="button"
          className="primary"
          disabled={shuffling}
          onClick={() => shuffle(room.viewerId, false)}
        >
          {shuffling ? "シャッフル中…" : "カードを混ぜる"}
        </button>
        <p role="status" aria-live="polite">
          {status}
        </p>
      </section>
    );
  }
  return (
    <section className="steal-panel" aria-labelledby="steal-title">
      <p className="eyebrow">FORCED EFFECT · A STEAL</p>
      <h2 id="steal-title">A奪い</h2>
      <p>{effect.message}</p>
      <ol className="steal-progress" aria-label="A奪いの進行">
        <li className={stage === "target" ? "active" : ""}>対象</li>
        <li className={stage === "waiting" ? "active" : ""}>シャッフル</li>
        <li className={stage === "point" ? "active" : ""}>位置</li>
        <li className={stage === "review" ? "active" : ""}>確定</li>
      </ol>
      {stage === "target" && (
        <div className="steal-targets" role="group" aria-label="奪う相手">
          {eligiblePlayers.map((player) => (
            <button
              type="button"
              key={player.id}
              disabled={!cardsFor(player.id).length}
              onClick={() => selectTarget(player.id)}
            >
              {player.name} <span>{cardsFor(player.id).length}枚</span>
            </button>
          ))}
        </div>
      )}
      {stage === "waiting" && targetId && (
        <div className="steal-waiting">
          <p>
            {room.players.find((player) => player.id === targetId)?.name}
            へシャッフルを依頼しました。
          </p>
          <button type="button" disabled={shuffling} onClick={() => shuffle(targetId, true)}>
            {shuffling ? "代理シャッフル中…" : "応答がない場合は卓上で代理シャッフル"}
          </button>
        </div>
      )}
      {stage === "point" && (
        <div className="steal-slots" role="listbox" aria-label="奪う位置">
          {cards.map((card, index) => (
            <button
              type="button"
              role="option"
              key={card.id}
              aria-selected={slot === index}
              aria-label={`${index + 1}番目 ${cardLabel(card)}`}
              onPointerEnter={() => point(index)}
              onFocus={() => point(index)}
              onClick={() => point(index)}
            >
              {card.visibility === "hidden" ? "◆" : cardLabel(card)}
              <small>{index + 1}</small>
            </button>
          ))}
          <button
            type="button"
            className="primary"
            disabled={slot === undefined}
            onClick={takePointed}
          >
            この位置から奪う
          </button>
        </div>
      )}
      {stage === "review" && (
        <div className="steal-review">
          <p>{selections.length}枚を一回のコマンドで確定します。</p>
          <ul>
            {selections.map((selection, index) => (
              <li key={selection.cardId}>
                {index + 1}.{" "}
                {room.players.find((player) => player.id === selection.targetUid)?.name}から選択
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
