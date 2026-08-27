import type { CardView, RoomView } from "../app/model";

export type CardAnchor =
  | { kind: "hand" | "deck" }
  | {
      kind: "field";
      playIndex?: number;
      playCount?: number;
      cardIndex?: number;
      cardCount?: number;
      layerIndex?: number;
    }
  | { kind: "discard"; cardIndex?: number; cardCount?: number }
  | { kind: "discardRack"; cardIndex: number; cardCount: number }
  | { kind: "seat"; playerId: string };

export const CARD_BODY_THICKNESS = 0.075;
export const FIELD_CARD_SCALE = 0.72;
export const FIELD_LAYER_SPACING = 0.066;
export const DISCARD_CARD_SCALE = 0.62;
export const DISCARD_LAYER_SPACING = 0.058;
export const DISCARD_VISIBLE_LIMIT = 12;

const COLLECT_RANK_ORDER = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "2",
] as const;
const COLLECT_SUIT_ORDER = ["spade", "heart", "diamond", "club"] as const;

export function sortCardsForCollectRack(cards: readonly CardView[]): CardView[] {
  const rankIndexes = new Map<string, number>(
    COLLECT_RANK_ORDER.map((rank, index) => [rank, index]),
  );
  const suitIndexes = new Map<string, number>(
    COLLECT_SUIT_ORDER.map((suit, index) => [suit, index]),
  );
  return cards
    .map((card, originalIndex) => {
      if (card.visibility === "hidden") {
        return { card, originalIndex, rankIndex: COLLECT_RANK_ORDER.length + 2, suitIndex: 0 };
      }
      const rankIndex = card.joker
        ? COLLECT_RANK_ORDER.length
        : (rankIndexes.get(card.rank ?? "") ?? COLLECT_RANK_ORDER.length + 1);
      return {
        card,
        originalIndex,
        rankIndex,
        suitIndex: suitIndexes.get(card.suit ?? "") ?? COLLECT_SUIT_ORDER.length,
      };
    })
    .sort(
      (left, right) =>
        left.rankIndex - right.rankIndex ||
        left.suitIndex - right.suitIndex ||
        left.originalIndex - right.originalIndex,
    )
    .map(({ card }) => card);
}

export function fieldCardPlacement(
  playIndex: number,
  playCount: number,
  cardIndex: number,
  cardCount: number,
  layerIndex: number,
): {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  renderOrder: number;
} {
  const centeredPlay = playIndex - (Math.max(1, playCount) - 1) / 2;
  const centeredCard = cardIndex - (Math.max(1, cardCount) - 1) / 2;
  return {
    position: [
      centeredPlay * 0.38 + centeredCard * 0.54,
      0.16 + layerIndex * FIELD_LAYER_SPACING,
      centeredPlay * 0.5 + Math.abs(centeredCard) * 0.025,
    ],
    rotation: [-Math.PI / 2, 0, centeredPlay * 0.018 + centeredCard * 0.022],
    scale: FIELD_CARD_SCALE,
    renderOrder: 100 + layerIndex,
  };
}

export function discardStackPlacement(cardIndex: number): {
  position: [number, number, number];
  rotation: [number, number, number];
} {
  return {
    position: [2.9, 0.15 + cardIndex * DISCARD_LAYER_SPACING, -1.45],
    rotation: [-Math.PI / 2, 0, ((cardIndex % 5) - 2) * 0.018],
  };
}

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
  const rowCount = Math.ceil(Math.max(1, cardCount) / columns);
  const centeredColumn =
    column - (Math.min(columns, Math.max(0, cardCount - row * columns)) - 1) / 2;
  return {
    position: [
      centeredColumn * (mobile ? 0.46 : 0.48),
      (mobile ? 0.72 : 0.88) + (rowCount - row - 1) * collectCardRackGeometry(mobile).rowSpacing,
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

const fieldPlays = (room: RoomView): CardView[][] =>
  room.fieldPlays ?? (room.field.length > 0 ? [room.field] : []);

function fieldAnchors(room: RoomView): Map<string, Extract<CardAnchor, { kind: "field" }>> {
  const plays = fieldPlays(room);
  const anchors = new Map<string, Extract<CardAnchor, { kind: "field" }>>();
  let layerIndex = 0;
  for (const [playIndex, play] of plays.entries()) {
    for (const [cardIndex, card] of play.entries()) {
      anchors.set(card.id, {
        kind: "field",
        playIndex,
        playCount: plays.length,
        cardIndex,
        cardCount: play.length,
        layerIndex,
      });
      layerIndex += 1;
    }
  }
  return anchors;
}

function discardAnchor(
  cards: readonly CardView[],
  cardId: string,
): Extract<CardAnchor, { kind: "discard" }> {
  const index = cards.findIndex((card) => card.id === cardId);
  if (index < 0) return { kind: "discard" };
  const firstVisibleIndex = Math.max(0, cards.length - DISCARD_VISIBLE_LIMIT);
  return {
    kind: "discard",
    cardIndex: Math.max(0, index - firstVisibleIndex),
    cardCount: Math.min(DISCARD_VISIBLE_LIMIT, cards.length),
  };
}

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
  const previousFieldAnchors = fieldAnchors(previous);
  const nextFieldAnchors = fieldAnchors(next);
  const previousDiscard = new Map(previous.discard.map((card) => [card.id, card]));
  const visiblePreviousDiscard = sortCardsForCollectRack(
    previous.discard.filter((card) => !movingToDiscard.has(card.id)),
  );
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
    const immediatePlayIndex = fieldPlays(previous).length;
    const immediatePlayCount = immediatePlayIndex + 1;
    for (const [cardIndex, card] of playedStraightToDiscard.entries()) {
      push({
        card,
        from: previousHand.has(card.id)
          ? { kind: "hand" }
          : previous.currentPlayerId
            ? { kind: "seat", playerId: previous.currentPlayerId }
            : { kind: "deck" },
        to: {
          kind: "field",
          playIndex: immediatePlayIndex,
          playCount: immediatePlayCount,
          cardIndex,
          cardCount: playedStraightToDiscard.length,
          layerIndex: previousTable.length + cardIndex,
        },
        kind: "play",
        batchId: `${next.revision}-immediate-play`,
        holdMs: 1000,
      });
    }
    for (const card of [...previousTable, ...playedStraightToDiscard]) {
      push({
        card,
        from:
          previousFieldAnchors.get(card.id) ??
          (playedStraightToDiscard.includes(card)
            ? {
                kind: "field",
                playIndex: immediatePlayIndex,
                playCount: immediatePlayCount,
                cardIndex: playedStraightToDiscard.indexOf(card),
                cardCount: playedStraightToDiscard.length,
                layerIndex: previousTable.length + playedStraightToDiscard.indexOf(card),
              }
            : { kind: "field" }),
        to: discardAnchor(next.discard, card.id),
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
      to: nextFieldAnchors.get(card.id) ?? { kind: "field" },
      kind: "play",
    });
  }

  for (const card of previousTable) {
    if (nextField.has(card.id)) continue;
    if (immediateFlushIds.has(card.id)) continue;
    push({
      card,
      from: previousFieldAnchors.get(card.id) ?? { kind: "field" },
      to: discardAnchor(next.discard, card.id),
      kind: "flush",
    });
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
            ? discardAnchor(previous.discard, card.id)
            : previousField.has(card.id)
              ? (previousFieldAnchors.get(card.id) ?? { kind: "field" })
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
      push({
        card,
        from: { kind: "hand" },
        to: discardAnchor(next.discard, card.id),
        kind: "discard",
        holdMs: 220,
        showWhileQueued: true,
      });
    }
  }

  for (const [cardId, seated] of nextSeats) {
    if (previousSeats.has(cardId) || seated.playerId === next.viewerId) continue;
    const card = seated.card;
    if (previousHand.has(cardId)) continue;
    const from: CardAnchor = previousDiscard.has(cardId)
      ? discardAnchor(previous.discard, cardId)
      : previousField.has(cardId)
        ? (previousFieldAnchors.get(cardId) ?? { kind: "field" })
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
