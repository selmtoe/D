import {
  buildEffectQueue,
  isSpadeThreeReturn,
  type Card,
  type EffectSelection,
  type GameEvent,
  type GameState,
  type PlayedGroup,
  type QueuedEffect,
} from "@daifugo/rules";
import type { Timestamp } from "firebase-admin/firestore";
import type { PublicEventDetail, PublicEventEntry, RoomDocument } from "../model.js";

export const PUBLIC_EVENT_LIMIT = 300;
const EVENTS_PER_MUTATION_LIMIT = 32;

export interface PublicEventDraft {
  type: string;
  actorUid?: string | null;
  detail?: PublicEventDetail;
}

export interface PublicGameLogContext {
  blindCardIds?: readonly string[];
  selection?: EffectSelection;
  disqualificationReason?: "blind-failure" | "disconnect" | "exit" | "moderation";
}

const SUIT_LABEL: Record<string, string> = {
  spade: "♠",
  heart: "♥",
  diamond: "♦",
  club: "♣",
};
const PUBLIC_CARD_LABEL =
  /^(?:Joker(?:→[♠♥♦♣](?:3|4|5|6|7|8|9|10|J|Q|K|A|2))?|[♠♥♦♣](?:3|4|5|6|7|8|9|10|J|Q|K|A|2))$/u;
const PUBLIC_RANKS = new Set([
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
  "Joker",
]);
const PUBLIC_SUITS = new Set(["spade", "heart", "diamond", "club"]);

function finiteInteger(
  value: number | undefined,
  minimum = 0,
  maximum = 10_000,
): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

/** Runtime allowlist: public log builders cannot persist arbitrary command payloads. */
function sanitizeDetail(detail: PublicEventDetail | undefined): PublicEventDetail {
  if (!detail) return {};
  const cardCount = finiteInteger(detail.cardCount, 0, 54);
  const count = finiteInteger(detail.count, 0, 54);
  const rank = finiteInteger(detail.rank, 1, 6);
  const warningCount = finiteInteger(detail.warningCount, 0, 10_000);
  const graceSeconds = finiteInteger(detail.graceSeconds, 0, 600);
  return {
    ...(cardCount !== undefined ? { cardCount } : {}),
    ...(detail.cards
      ? { cards: detail.cards.filter((value) => PUBLIC_CARD_LABEL.test(value)).slice(0, 54) }
      : {}),
    ...(typeof detail.kind === "string" ? { kind: detail.kind.slice(0, 32) } : {}),
    ...(detail.suits
      ? { suits: detail.suits.filter((value) => PUBLIC_SUITS.has(value)).slice(0, 4) }
      : {}),
    ...(typeof detail.enabled === "boolean" ? { enabled: detail.enabled } : {}),
    ...(detail.direction ? { direction: detail.direction } : {}),
    ...(typeof detail.effect === "string" ? { effect: detail.effect.slice(0, 32) } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(detail.ranks
      ? { ranks: detail.ranks.filter((value) => PUBLIC_RANKS.has(value)).slice(0, 14) }
      : {}),
    ...(detail.targets
      ? { targets: detail.targets.map((value) => value.slice(0, 140)).slice(0, 6) }
      : {}),
    ...(rank !== undefined ? { rank } : {}),
    ...(typeof detail.reason === "string" ? { reason: detail.reason.slice(0, 32) } : {}),
    ...(warningCount !== undefined ? { warningCount } : {}),
    ...(graceSeconds !== undefined ? { graceSeconds } : {}),
    ...(typeof detail.fromHostUid === "string"
      ? { fromHostUid: detail.fromHostUid.slice(0, 128) }
      : {}),
    ...(typeof detail.toHostUid === "string" ? { toHostUid: detail.toHostUid.slice(0, 128) } : {}),
  };
}

function cardLabel(card: Card): string {
  return card.rank === "JOKER" ? "Joker" : `${SUIT_LABEL[card.suit ?? ""] ?? "?"}${card.rank}`;
}

function playedCardLabel(card: PlayedGroup["cards"][number]): string {
  if (card.card.rank !== "JOKER") return cardLabel(card.card);
  return card.mimic ? `Joker→${SUIT_LABEL[card.mimic.suit]}${card.mimic.rank}` : "Joker";
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function handCard(state: GameState, cardId: string): { card: Card; blind: boolean } | undefined {
  return state.players.flatMap((player) => player.hand).find((entry) => entry.card.id === cardId);
}

function publicSelectionDetail(
  state: GameState,
  selection: EffectSelection | undefined,
): PublicEventDetail {
  if (!selection) return {};
  switch (selection.type) {
    case "recover":
      return {
        cards: selection.cardIds.flatMap((id) => {
          const card = state.discard.find((candidate) => candidate.id === id);
          return card ? [cardLabel(card)] : [];
        }),
        cardCount: selection.cardIds.length,
      };
    case "discard":
      return {
        cards: selection.cardIds.flatMap((id) => {
          const entry = handCard(state, id);
          return entry ? [cardLabel(entry.card)] : [];
        }),
        cardCount: selection.cardIds.length,
      };
    case "bomb":
      return { ranks: selection.ranks.map((rank) => (rank === "JOKER" ? "Joker" : rank)) };
    case "give":
    case "steal": {
      const targets = selection.transfers.map(
        (transfer) => `${transfer.playerId}:${transfer.cardIds.length}`,
      );
      // Ordinary transferred hand cards remain private. Only a card whose blind
      // attribute is being removed is newly public and may be named here.
      const cards = selection.transfers.flatMap((transfer) =>
        transfer.cardIds.flatMap((id) => {
          const entry = handCard(state, id);
          return entry?.blind ? [cardLabel(entry.card)] : [];
        }),
      );
      return {
        targets,
        cardCount: selection.transfers.reduce((sum, transfer) => sum + transfer.cardIds.length, 0),
        ...(cards.length > 0 ? { cards } : {}),
      };
    }
  }
}

function effectDetail(effect: QueuedEffect): PublicEventDetail {
  return {
    effect: effect.type,
    ...(effect.type === "skip" ||
    effect.type === "recover" ||
    effect.type === "steal" ||
    effect.type === "give" ||
    effect.type === "discard" ||
    effect.type === "bomb"
      ? { count: effect.count }
      : {}),
    ...(effect.type === "flush" ? { reason: effect.reason } : {}),
  };
}

function ruleEventDrafts(
  before: GameState,
  after: GameState,
  events: readonly GameEvent[],
  actorUid: string,
  context: PublicGameLogContext,
): PublicEventDraft[] {
  const drafts: PublicEventDraft[] = [];
  for (const event of events) {
    switch (event.type) {
      case "played": {
        drafts.push({
          type: "played",
          actorUid: event.playerId,
          detail: {
            cardCount: event.play.cards.length,
            cards: event.play.cards.map(playedCardLabel),
            kind: event.play.kind,
          },
        });
        const spadeThree = before.pile ? isSpadeThreeReturn(event.play, before.pile) : false;
        for (const effect of buildEffectQueue(
          before,
          event.play,
          event.playerId,
          event.play.id,
          spadeThree,
        )) {
          drafts.push({
            type: "effect-triggered",
            actorUid: event.playerId,
            detail: effectDetail(effect),
          });
        }
        break;
      }
      case "passed":
        drafts.push({ type: "passed", actorUid: event.playerId, detail: {} });
        break;
      case "effect-pending":
        drafts.push({
          type: "effect-pending",
          actorUid: event.effect.actorId,
          detail: { effect: event.effect.type, count: event.effect.count },
        });
        break;
      case "trick-flushed":
        drafts.push({ type: "trick-flushed", actorUid, detail: { reason: event.reason } });
        break;
      case "finished":
        for (const playerId of event.playerIds) {
          drafts.push({
            type: "finished",
            actorUid: playerId,
            detail: {
              rank: event.rank,
              reason:
                after.players.find((player) => player.id === playerId)?.finishReason ?? "played",
            },
          });
        }
        break;
      case "disqualified": {
        const previousDiscard = new Set(before.discard.map((card) => card.id));
        const revealedCards = after.discard
          .filter((card) => !previousDiscard.has(card.id))
          .map(cardLabel);
        drafts.push({
          type: "disqualified",
          actorUid: event.playerId,
          detail: {
            rank: event.rank,
            reason: context.disqualificationReason ?? "rule",
            cardCount: revealedCards.length,
            cards: revealedCards,
          },
        });
        break;
      }
      case "game-finished":
        drafts.push({ type: "game-finished", actorUid: null, detail: {} });
        break;
    }
  }

  if (!sameStrings(before.binding, after.binding)) {
    drafts.push({ type: "binding-changed", actorUid, detail: { suits: [...after.binding] } });
  }
  if (before.revolution !== after.revolution) {
    drafts.push({ type: "revolution-changed", actorUid, detail: { enabled: after.revolution } });
  }
  if (before.direction !== after.direction) {
    drafts.push({
      type: "direction-changed",
      actorUid,
      detail: { direction: after.direction === 1 ? "clockwise" : "counterclockwise" },
    });
  }
  if (before.jackBack !== after.jackBack) {
    drafts.push({ type: "jack-back-changed", actorUid, detail: { enabled: after.jackBack } });
  }

  if (before.pendingEffect && before.pendingEffect.id !== after.pendingEffect?.id) {
    drafts.push({
      type: "effect-resolved",
      actorUid: before.pendingEffect.actorId,
      detail: {
        effect: before.pendingEffect.type,
        count: before.pendingEffect.count,
        ...publicSelectionDetail(before, context.selection),
      },
    });
  }

  const blindIds = new Set(context.blindCardIds ?? []);
  if (blindIds.size > 0) {
    const played = events.find(
      (event): event is Extract<GameEvent, { type: "played" }> => event.type === "played",
    );
    if (played) {
      drafts.push({
        type: "blind-success",
        actorUid,
        detail: {
          cardCount: blindIds.size,
          cards: played.play.cards
            .filter((entry) => blindIds.has(entry.card.id))
            .map(playedCardLabel),
        },
      });
    } else if (events.some((event) => event.type === "disqualified")) {
      drafts.push({
        type: "blind-failure",
        actorUid,
        detail: {
          cardCount: before.players.find((player) => player.id === actorUid)?.hand.length ?? 0,
          cards:
            before.players
              .find((player) => player.id === actorUid)
              ?.hand.map((entry) => cardLabel(entry.card)) ?? [],
        },
      });
    }
  }
  return drafts;
}

export function appendPublicEvents(
  room: RoomDocument,
  drafts: readonly PublicEventDraft[],
  now: Timestamp,
): void {
  if (drafts.length === 0) return;
  const revision = room.revision + 1;
  const offset = room.publicEvents.filter((entry) => entry.revision === revision).length;
  const additions: PublicEventEntry[] = drafts
    .slice(0, EVENTS_PER_MUTATION_LIMIT)
    .map((draft, index) => ({
      id: `${revision}_${offset + index}`,
      type: draft.type.slice(0, 64),
      actorUid: draft.actorUid ?? null,
      createdAt: now,
      revision,
      detail: sanitizeDetail(draft.detail),
    }));
  room.publicEvents = [...room.publicEvents, ...additions].slice(-PUBLIC_EVENT_LIMIT);
}

export function appendPublicGameEvents(
  room: RoomDocument,
  before: GameState,
  events: readonly GameEvent[],
  actorUid: string,
  now: Timestamp,
  context: PublicGameLogContext = {},
): void {
  if (!room.game) return;
  appendPublicEvents(room, ruleEventDrafts(before, room.game, events, actorUid, context), now);
}

export const __publicEventTest = { cardLabel, playedCardLabel, ruleEventDrafts, sanitizeDetail };
