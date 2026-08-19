import { projectGame } from "@daifugo/rules";
import type { Timestamp } from "firebase-admin/firestore";
import type { RoomDocument, RoomMember } from "../model.js";
import { MAX_ACTIVE_SPECTATORS } from "../room/member-lifecycle.js";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function tokenizeCardIdentifiers(
  value: unknown,
  cardTokens: Record<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => tokenizeCardIdentifiers(item, cardTokens));
  }
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if ((key === "id" || key === "cardId") && typeof item === "string" && cardTokens[item]) {
      result[key] = cardTokens[item];
    } else if ((key === "cardIds" || key === "revealedJokerIds") && Array.isArray(item)) {
      result[key] = item.map((id) =>
        typeof id === "string" && cardTokens[id] ? cardTokens[id] : id,
      );
    } else {
      result[key] = tokenizeCardIdentifiers(item, cardTokens);
    }
  }
  return result;
}

function redactBlindCard(card: unknown): unknown {
  if (!isObject(card)) return card;
  const isBlind = card.isBlind === true || card.blind === true || card.visibility === "blind";
  if (!isBlind) return card;
  const redacted = { ...card };
  for (const key of ["face", "suit", "rank", "number", "mimic", "mimics", "declaration"] as const) {
    delete redacted[key];
  }
  return redacted;
}

/** Defense in depth over the rules package's projection. */
export function redactOwnerBlindFaces(projected: unknown, viewerUid: string): unknown {
  if (Array.isArray(projected)) {
    return projected.map((value) => redactOwnerBlindFaces(value, viewerUid));
  }
  if (!isObject(projected)) return projected;

  const identity = projected.playerId ?? projected.uid ?? projected.id;
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(projected)) {
    if (identity === viewerUid && (key === "hand" || key === "cards") && Array.isArray(value)) {
      result[key] = value.map(redactBlindCard);
    } else {
      result[key] = redactOwnerBlindFaces(value, viewerUid);
    }
  }
  return result;
}

function visibleMembers(room: RoomDocument): RoomMember[] {
  return Object.values(room.members)
    .filter((member) => member.connectionStatus !== "left")
    .sort((left, right) => left.joinedOrder - right.joinedOrder);
}

export function projectPendingEffect(
  room: RoomDocument,
  viewerUid?: string,
): Array<Record<string, unknown>> {
  const effect = room.game?.pendingEffect;
  if (!effect || !room.game) return [];
  const actor = room.game.players.find((player) => player.id === effect.actorId);
  const activeTargets = room.game.players.filter(
    (player) => player.id !== effect.actorId && player.status === "active",
  );
  let requiredCount = effect.count;
  let eligibleCardIds: string[] = [];
  let eligiblePlayerIds: string[] = [];
  let kind: string = effect.type;

  switch (effect.type) {
    case "recover":
      kind = "collect";
      requiredCount = Math.min(effect.count, room.game.discard.length);
      eligibleCardIds = room.game.discard.map((card) => card.id);
      break;
    case "steal": {
      const available = activeTargets.flatMap((player) => player.hand);
      requiredCount = Math.min(effect.count, available.length);
      eligibleCardIds = available.map((entry) => entry.card.id);
      eligiblePlayerIds = activeTargets
        .filter((player) => player.hand.length > 0)
        .map((player) => player.id);
      break;
    }
    case "give":
      requiredCount = Math.min(effect.count, actor?.hand.length ?? 0);
      eligibleCardIds = actor?.hand.map((entry) => entry.card.id) ?? [];
      eligiblePlayerIds = activeTargets.map((player) => player.id);
      break;
    case "discard":
      requiredCount = Math.min(effect.count, actor?.hand.length ?? 0);
      eligibleCardIds = actor?.hand.map((entry) => entry.card.id) ?? [];
      break;
    case "bomb":
      kind = "bomber";
      break;
  }

  return [
    {
      id: effect.id,
      kind,
      actorId: effect.actorId,
      requiredCount,
      ...(viewerUid === effect.actorId && eligibleCardIds.length > 0
        ? {
            eligibleCardIds: eligibleCardIds.map((id) => {
              const token = room.cardTokens[id];
              if (!token)
                throw new Error("A pending effect references a card without an opaque token.");
              return token;
            }),
          }
        : {}),
      ...(viewerUid === effect.actorId && eligiblePlayerIds.length > 0
        ? { eligiblePlayerIds }
        : {}),
      message: kind,
    },
  ];
}

export interface PublicRoomProjection {
  schemaVersion: 2;
  roomId: string;
  gameId: string | null;
  status: RoomDocument["status"];
  visibility: RoomDocument["visibility"];
  revision: number;
  playerCount: number;
  spectatorCount: number;
  spectatorCapacity: number;
  capacity: 6;
  hostName: string;
  hostAvatar: unknown;
  mode: "normal" | "blind";
  blindCount: number;
  phase: "waiting" | "playing";
  settings: RoomDocument["settings"];
  createdAt: Timestamp;
  createdAtMs: number;
  heartbeatAt: Timestamp;
  lastActivityAt: Timestamp;
  expiresAt: Timestamp;
}

export function projectPublicRoom(room: RoomDocument): PublicRoomProjection {
  const members = visibleMembers(room);
  return {
    schemaVersion: 2,
    roomId: room.roomId,
    gameId: room.gameId,
    status: room.status,
    visibility: room.visibility,
    revision: room.revision,
    playerCount: members.filter((member) => member.role === "player").length,
    spectatorCount: members.filter((member) => member.role === "spectator").length,
    spectatorCapacity: MAX_ACTIVE_SPECTATORS,
    capacity: 6,
    hostName: room.members[room.hostUid]?.name ?? "",
    hostAvatar: room.members[room.hostUid]?.avatar ?? null,
    mode: room.settings.mode,
    blindCount: room.settings.blindCount,
    phase: room.status === "waiting" ? "waiting" : "playing",
    settings: room.settings,
    createdAt: room.createdAt,
    createdAtMs: room.createdAt.toMillis(),
    heartbeatAt: room.lastActivityAt,
    lastActivityAt: room.lastActivityAt,
    expiresAt: room.expiresAt,
  };
}

export function projectRoomForViewer(
  room: RoomDocument,
  viewerUid: string,
): Record<string, unknown> {
  const viewer = room.members[viewerUid];
  if (!viewer || viewer.connectionStatus === "left") {
    throw new Error("Cannot project a room for a non-member viewer.");
  }

  const rawGame = room.game
    ? projectGame(
        room.game,
        viewer.role === "spectator"
          ? { spectator: true }
          : { playerId: viewerUid, spectator: false },
      )
    : null;
  const game = tokenizeCardIdentifiers(rawGame, room.cardTokens) as JsonObject | null;
  const gamePlayers = Array.isArray(game?.players) ? game.players.filter(isObject) : [];
  const viewerGamePlayer = gamePlayers.find((player) => player.id === viewerUid);
  const effectiveRole =
    viewer.role === "spectator" ||
    (viewerGamePlayer !== undefined && viewerGamePlayer.status !== "active")
      ? "spectator"
      : "player";
  const focusedPlayerId =
    effectiveRole === "spectator"
      ? (viewer.focusPlayerId ??
        (String(gamePlayers.find((player) => player.status === "active")?.id ?? "") || null))
      : viewerUid;

  function cardView(card: unknown, forceFace = false): Record<string, unknown> {
    if (!isObject(card)) return { id: "invalid", visibility: "hidden", blind: false };
    const face = isObject(card.face) ? card.face : undefined;
    const cardObject = isObject(card.card) ? card.card : undefined;
    const rank = face?.rank ?? card.rank ?? cardObject?.rank;
    const suit = face?.suit ?? card.suit ?? cardObject?.suit;
    const id = String(card.id ?? cardObject?.id ?? "invalid");
    const blind = card.blind === true;
    if (!face && !forceFace && rank === undefined) {
      return { id, visibility: "hidden", blind };
    }
    return {
      id,
      visibility: "face",
      ...(rank === "JOKER" ? { joker: "monochrome" } : { suit: String(suit), rank: String(rank) }),
      blind,
      ...(isObject(card.mimic) ? { mimic: card.mimic } : {}),
    };
  }

  const projectedPlayers = visibleMembers(room)
    .filter((member) => member.role === "player")
    .map((member) => {
      const player = gamePlayers.find((candidate) => candidate.id === member.uid);
      const hand = Array.isArray(player?.hand)
        ? player.hand.map((card, position) => {
            const projected = cardView(card);
            const temporaryStealSelection =
              room.game?.pendingEffect?.type === "steal" &&
              room.game.pendingEffect.actorId === viewerUid;
            if (
              projected.visibility === "hidden" &&
              member.uid !== viewerUid &&
              !temporaryStealSelection
            ) {
              return {
                ...projected,
                id: `back_${room.revision}_${member.uid}_${position}`,
              };
            }
            return projected;
          })
        : [];
      return {
        id: member.uid,
        name: member.name,
        avatar: member.avatar,
        cardCount: hand.length,
        cards: hand,
        connection:
          member.connectionStatus === "connected"
            ? "online"
            : member.connectionStatus === "grace"
              ? "grace"
              : "offline",
        status: player?.status ?? "active",
        ...(typeof player?.rank === "number" ? { rank: player.rank } : {}),
        host: member.uid === room.hostUid,
      };
    });
  const focused = gamePlayers.find((player) => player.id === focusedPlayerId);
  const hand = Array.isArray(focused?.hand) ? focused.hand.map((card) => cardView(card)) : [];
  const pile = isObject(game?.pile) ? game.pile : undefined;
  const pending = isObject(game?.pendingEffect) ? game.pendingEffect : undefined;
  const pendingMimic =
    room.pendingMimic?.actorUid === viewerUid
      ? (tokenizeCardIdentifiers(
          {
            cardIds: room.pendingMimic.cardIds,
            candidates: room.pendingMimic.candidates,
            revealedCards: room.pendingMimic.cardIds.flatMap((cardId) => {
              const entry = room.game?.players
                .find((player) => player.id === viewerUid)
                ?.hand.find((candidate) => candidate.card.id === cardId);
              return entry
                ? [
                    {
                      id: entry.card.id,
                      face: { suit: entry.card.suit, rank: entry.card.rank },
                      blind: entry.blind,
                    },
                  ]
                : [];
            }),
            revealedJokerIds: [
              ...new Set(
                room.pendingMimic.candidates.flatMap((candidate) =>
                  candidate.map((mimic) => mimic.cardId),
                ),
              ),
            ],
          },
          room.cardTokens,
        ) as JsonObject)
      : null;
  const eventLabels: Record<string, string> = {
    played: "札を出しました",
    passed: "パスしました",
    "effect-pending": "強制効果を処理しています",
    "trick-flushed": "場が流れました",
    finished: "上がりました",
    disqualified: "失格になりました",
    "game-finished": "対局が終了しました",
  };
  const log = room.publicEvents.map((entry) => ({
    id: entry.id,
    atMs: entry.createdAt.toMillis(),
    text: `${entry.actorUid ? `${room.members[entry.actorUid]?.name ?? "参加者"}: ` : ""}${eventLabels[entry.type] ?? entry.type}`,
    kind:
      entry.type === "played"
        ? "play"
        : entry.type === "passed"
          ? "pass"
          : entry.type.includes("effect")
            ? "effect"
            : "system",
  }));

  return {
    schemaVersion: 2,
    roomId: room.roomId,
    revision: room.revision,
    ...(room.gameId ? { gameId: room.gameId } : {}),
    ...(typeof pile?.id === "string" ? { trickId: pile.id } : {}),
    generation: room.rematchGeneration,
    phase:
      room.status === "waiting"
        ? "waiting"
        : room.status === "finished"
          ? "finished"
          : pending || room.pendingMimic
            ? "effect"
            : "playing",
    role: effectiveRole,
    viewerId: viewerUid,
    hostId: room.hostUid,
    players: projectedPlayers,
    spectators: visibleMembers(room)
      .filter((member) => member.role === "spectator")
      .map((member) => ({ id: member.uid, name: member.name })),
    settings: room.settings,
    ...(typeof game?.turnPlayerId === "string" ? { currentPlayerId: game.turnPlayerId } : {}),
    ...(room.turnDeadlineAt ? { turnDeadlineMs: room.turnDeadlineAt.toMillis() } : {}),
    direction: game?.direction === -1 ? -1 : 1,
    revolution: game?.revolution === true,
    jackBack: game?.jackBack === true,
    suitLock: Array.isArray(game?.binding) ? game.binding : [],
    field: Array.isArray(pile?.cards) ? pile.cards.map((card) => cardView(card, true)) : [],
    discard: Array.isArray(game?.discard) ? game.discard.map((card) => cardView(card, true)) : [],
    hand:
      effectiveRole === "spectator" ? hand : (redactOwnerBlindFaces(hand, viewerUid) as unknown[]),
    pendingEffects: projectPendingEffect(room, viewerUid),
    ...(pendingMimic ? { pendingJokerMimic: pendingMimic } : {}),
    rankings: gamePlayers
      .filter((player) => typeof player.rank === "number")
      .map((player) => ({
        playerId: String(player.id),
        place: Number(player.rank),
        ...(typeof player.finishReason === "string"
          ? {
              reason:
                (
                  {
                    played: "通常上がり",
                    effect: "効果解決後の上がり",
                    "last-standing": "最終プレイヤー",
                    disqualified: "失格",
                  } as Record<string, string>
                )[player.finishReason] ?? player.finishReason,
            }
          : {}),
      })),
    log,
    ...(focusedPlayerId ? { focusedPlayerId } : {}),
    chat: room.publicChat,
    events: room.publicEvents,
    serverProjectedAtMs: room.updatedAt.toMillis(),
  };
}
