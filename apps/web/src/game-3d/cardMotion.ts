import type { CardView, RoomView } from "../app/model";

export type CardAnchor =
  | { kind: "hand" | "field" | "discard" | "deck" }
  | { kind: "discardRack"; cardIndex: number; cardCount: number }
  | { kind: "seat"; playerId: string };

export function collectCardRackGeometry(mobile: boolean): {
  rowSpacing: number;
  scale: number;
  hitAreaHeight: number;
} {
  return { rowSpacing: mobile ? 0.52 : 0.76, scale: mobile ? 0.29 : 0.39, hitAreaHeight: 1.78 };
}

export function collectCardRackPlacement(
  cardIndex: number,
  cardCount: number,
  mobile: boolean,
): { position: [number, number, number]; rotationZ: number } {
  const columns = Math.min(mobile ? 7 : 14, Math.max(1, cardCount));
  const column = cardIndex % columns;
  const row = Math.floor(cardIndex / columns);
  const centeredColumn =
    column - (Math.min(columns, Math.max(0, cardCount - row * columns)) - 1) / 2;
  return {
    position: [
      centeredColumn * (mobile ? 0.46 : 0.48),
      (mobile ? 0.72 : 0.88) + row * collectCardRackGeometry(mobile).rowSpacing,
      1.48 - row * (mobile ? 0.035 : 0.06),
    ],
    rotationZ: centeredColumn * 0.012,
  };
}

export interface CardMotionEvent {
  id: string;
  batchId: string;
  card: CardView;
  from: CardAnchor;
  to: CardAnchor;
  kind: "play" | "flush" | "acquire" | "give" | "discard" | "collect";
  holdMs?: number;
  showWhileQueued?: boolean;
}

export function cardMotionsForDisplay(motions: CardMotionEvent[]): {
  active: CardMotionEvent[];
  queued: CardMotionEvent[];
} {
  const firstBatchId = motions[0]?.batchId;
  const active = motions.filter((motion) => motion.batchId === firstBatchId);
  const occupiedCardIds = new Set(active.map((motion) => motion.card.id));
  const queued: CardMotionEvent[] = [];
  for (const motion of motions.slice(active.length)) {
    if (motion.showWhileQueued && !occupiedCardIds.has(motion.card.id)) queued.push(motion);
    occupiedCardIds.add(motion.card.id);
  }
  return { active, queued };
}

const cardsAtSeats = (room: RoomView) =>
  new Map(
    room.players.flatMap((player) =>
      (player.cards ?? [])
        .filter((card) => !card.id.startsWith("back_"))
        .map((card) => [card.id, { card, playerId: player.id }] as const),
    ),
  );

/** Cards remain on the table until the whole trick is flushed to the discard stack. */
export const cardsOnTable = (room: RoomView): CardView[] =>
  (room.fieldPlays ?? (room.field.length > 0 ? [room.field] : [])).flat();

export function cardMotionPerspectiveChanged(previous: RoomView, next: RoomView): boolean {
  return (
    previous.roomId !== next.roomId ||
    previous.gameId !== next.gameId ||
    previous.role !== next.role ||
    (next.role === "spectator" && previous.focusedPlayerId !== next.focusedPlayerId)
  );
}

export function deriveCardMotions(
  previous: RoomView,
  next: RoomView,
  movingToDiscard: ReadonlySet<string> = new Set(),
): CardMotionEvent[] {
  if (
    previous.phase === "dealing" ||
    next.phase === "dealing" ||
    cardMotionPerspectiveChanged(previous, next)
  )
    return [];
  const motions: CardMotionEvent[] = [];
  const previousHand = new Map(previous.hand.map((card) => [card.id, card]));
  const nextHand = new Map(next.hand.map((card) => [card.id, card]));
  const previousTable = cardsOnTable(previous);
  const nextTable = cardsOnTable(next);
  const previousField = new Map(previousTable.map((card) => [card.id, card]));
  const nextField = new Map(nextTable.map((card) => [card.id, card]));
  const previousDiscard = new Map(previous.discard.map((card) => [card.id, card]));
  const visiblePreviousDiscard = previous.discard.filter((card) => !movingToDiscard.has(card.id));
  const visibleDiscardIndexes = new Map(
    visiblePreviousDiscard.map((card, index) => [card.id, index]),
  );
  const nextDiscard = new Map(next.discard.map((card) => [card.id, card]));
  const previousSeats = cardsAtSeats(previous);
  const nextSeats = cardsAtSeats(next);
  const used = new Set<string>();
  const push = (motion: Omit<CardMotionEvent, "id" | "batchId"> & { batchId?: string }) => {
    const key = `${motion.kind}:${motion.card.id}:${motion.to.kind}:${"playerId" in motion.to ? motion.to.playerId : ""}`;
    if (used.has(key)) return;
    used.add(key);
    motions.push({
      ...motion,
      batchId: motion.batchId ?? `${next.revision}-${motion.kind}`,
      id: `${next.revision}-${key}`,
    });
  };

  const newLogIds = new Set(previous.log.map((entry) => entry.id));
  const hasNewPlayEvent = next.log.some(
    (entry) => !newLogIds.has(entry.id) && entry.kind === "play",
  );
  const newDiscard = next.discard.filter((card) => !previousDiscard.has(card.id));
  const playedStraightToDiscard =
    nextTable.length === 0 && hasNewPlayEvent
      ? newDiscard.filter((card) => !previousField.has(card.id))
      : [];
  const immediateFlushIds = new Set(
    playedStraightToDiscard.length
      ? [...previousTable.map((card) => card.id), ...playedStraightToDiscard.map((card) => card.id)]
      : [],
  );

  if (playedStraightToDiscard.length) {
    for (const card of playedStraightToDiscard) {
      push({
        card,
        from: previousHand.has(card.id)
          ? { kind: "hand" }
          : previous.currentPlayerId
            ? { kind: "seat", playerId: previous.currentPlayerId }
            : { kind: "deck" },
        to: { kind: "field" },
        kind: "play",
        batchId: `${next.revision}-immediate-play`,
        holdMs: 1000,
      });
    }
    for (const card of [...previousTable, ...playedStraightToDiscard]) {
      push({
        card,
        from: { kind: "field" },
        to: { kind: "discard" },
        kind: "flush",
        batchId: `${next.revision}-immediate-flush`,
        showWhileQueued: previousField.has(card.id),
      });
    }
  }

  for (const card of nextTable) {
    if (previousField.has(card.id)) continue;
    const seated = previousSeats.get(card.id);
    push({
      card,
      from: previousHand.has(card.id)
        ? { kind: "hand" }
        : seated
          ? { kind: "seat", playerId: seated.playerId }
          : previous.currentPlayerId
            ? { kind: "seat", playerId: previous.currentPlayerId }
            : { kind: "deck" },
      to: { kind: "field" },
      kind: "play",
    });
  }

  for (const card of previousTable) {
    if (nextField.has(card.id)) continue;
    if (immediateFlushIds.has(card.id)) continue;
    push({ card, from: { kind: "field" }, to: { kind: "discard" }, kind: "flush" });
  }

  for (const card of next.hand) {
    if (previousHand.has(card.id)) continue;
    const seated = previousSeats.get(card.id);
    const discardRackIndex = visibleDiscardIndexes.get(card.id);
    push({
      card,
      from: seated
        ? { kind: "seat", playerId: seated.playerId }
        : discardRackIndex !== undefined
          ? {
              kind: "discardRack",
              cardIndex: discardRackIndex,
              cardCount: visiblePreviousDiscard.length,
            }
          : previousDiscard.has(card.id)
            ? { kind: "discard" }
            : previousField.has(card.id)
              ? { kind: "field" }
              : { kind: "deck" },
      to: { kind: "hand" },
      kind: seated ? "acquire" : previousDiscard.has(card.id) ? "collect" : "acquire",
    });
  }

  for (const card of previous.hand) {
    if (nextHand.has(card.id) || nextField.has(card.id)) continue;
    if (immediateFlushIds.has(card.id)) continue;
    const seated = nextSeats.get(card.id);
    if (seated) {
      push({
        card,
        from: { kind: "hand" },
        to: { kind: "seat", playerId: seated.playerId },
        kind: "give",
      });
    } else if (nextDiscard.has(card.id)) {
      push({ card, from: { kind: "hand" }, to: { kind: "discard" }, kind: "discard" });
    }
  }

  for (const [cardId, seated] of nextSeats) {
    if (previousSeats.has(cardId) || seated.playerId === next.viewerId) continue;
    const card = seated.card;
    if (previousHand.has(cardId)) continue;
    const from: CardAnchor = previousDiscard.has(cardId)
      ? { kind: "discard" }
      : previousField.has(cardId)
        ? { kind: "field" }
        : { kind: "deck" };
    push({ card, from, to: { kind: "seat", playerId: seated.playerId }, kind: "acquire" });
  }

  // Other players' hidden card IDs are intentionally revision-scoped. Infer transfers only from
  // public count deltas so a chat/revision update never animates an entire hand.
  const previousCounts = new Map(previous.players.map((player) => [player.id, player.cardCount]));
  const sources = next.players.flatMap((player) =>
    Array.from(
      {
        length: Math.max(0, (previousCounts.get(player.id) ?? player.cardCount) - player.cardCount),
      },
      () => player.id,
    ),
  );
  const targets = next.players.flatMap((player) =>
    Array.from(
      {
        length: Math.max(0, player.cardCount - (previousCounts.get(player.id) ?? player.cardCount)),
      },
      () => player.id,
    ),
  );
  const transferCounts = new Map<string, number>();
  for (const motion of motions) {
    const fromId =
      motion.from.kind === "hand"
        ? next.viewerId
        : motion.from.kind === "seat"
          ? motion.from.playerId
          : undefined;
    const toId =
      motion.to.kind === "hand"
        ? next.viewerId
        : motion.to.kind === "seat"
          ? motion.to.playerId
          : undefined;
    if (fromId && toId) {
      const key = `${fromId}>${toId}`;
      transferCounts.set(key, (transferCounts.get(key) ?? 0) + 1);
    }
  }
  for (let index = 0; index < Math.min(sources.length, targets.length); index += 1) {
    const sourceId = sources[index]!;
    const targetId = targets[index]!;
    const key = `${sourceId}>${targetId}`;
    const represented = transferCounts.get(key) ?? 0;
    if (represented > 0) {
      transferCounts.set(key, represented - 1);
      continue;
    }
    push({
      card: { id: `transfer-${next.revision}-${index}`, visibility: "hidden", blind: false },
      from: sourceId === next.viewerId ? { kind: "hand" } : { kind: "seat", playerId: sourceId },
      to: targetId === next.viewerId ? { kind: "hand" } : { kind: "seat", playerId: targetId },
      kind: sourceId === next.viewerId ? "give" : "acquire",
    });
  }
  return motions;
}
