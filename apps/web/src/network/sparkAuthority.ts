import { migrateAvatar, type AvatarProfileV1 } from "@daifugo/avatar-schema";
import {
  applyGameCommand,
  createInitialGameState,
  findLegalJokerMimics,
  projectGame,
  type EffectSelection,
  type GameCommand,
  type GameEvent,
  type GameState,
  type JokerMimic,
  type PendingEffect,
  type PhysicalRank,
  type ProjectedHandCard,
} from "@daifugo/rules";
import type {
  CardView,
  PendingEffectView,
  PublicRoom,
  Rank,
  Role,
  RoomView,
  Suit,
} from "../app/model";

export interface SparkMember {
  uid: string;
  peerId: string;
  name: string;
  avatar: AvatarProfileV1;
  role: Role;
  joinedAtMs: number;
  online: boolean;
  focusPlayerId?: string;
  lastChatAtMs?: number;
}

export interface SparkPendingMimic {
  actorUid: string;
  cardIds: string[];
  candidates: JokerMimic[][];
  actionId: string;
}

export interface SparkRoomSnapshot {
  schemaVersion: 1;
  roomId: string;
  revision: number;
  generation: number;
  status: "waiting" | "playing" | "finished";
  coordinatorUid: string;
  hostUid: string;
  settings: { mode: "normal" | "blind"; blindCount: number };
  members: Record<string, SparkMember>;
  departedProfiles?: Record<string, { name: string; avatar: AvatarProfileV1 }>;
  game?: GameState;
  pendingMimic?: SparkPendingMimic;
  turnDeadlineMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
  chat: Array<{ id: string; uid: string; name: string; role: Role; text: string; atMs: number }>;
  socialLog: Array<{
    id: string;
    atMs: number;
    text: string;
    kind: "play" | "pass" | "effect" | "system";
  }>;
  appliedRoomActionIds: string[];
  appliedRoomActionResults?: Record<string, Record<string, unknown>>;
}

export interface JoinRequest {
  uid: string;
  peerId: string;
  profile: { name: string; avatar: AvatarProfileV1 };
  role: Role;
}

const MAX_PLAYERS = 6;
const MAX_SPECTATORS = 32;
const TURN_MS = 60_000;

function commandError(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    commandError("invalid-argument", "カード選択の形式が不正です");
  }
  return [...new Set(value as string[])];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jokerStyles(game: GameState): ReadonlyMap<string, "monochrome" | "crimson"> {
  const ids = new Set<string>();
  const add = (card: { id: string; rank: string }) => {
    if (card.rank === "JOKER") ids.add(card.id);
  };
  game.players.forEach((player) => player.hand.forEach((entry) => add(entry.card)));
  game.deck.forEach(add);
  game.discard.forEach(add);
  game.pile?.cards.forEach((entry) => add(entry.card));
  game.trickHistory.forEach((play) => play.cards.forEach((entry) => add(entry.card)));
  return new Map(
    [...ids].sort().map((id, index) => [id, index === 1 ? "crimson" : "monochrome"] as const),
  );
}

function cardView(
  card: ProjectedHandCard,
  styles: ReadonlyMap<string, "monochrome" | "crimson">,
): CardView {
  if (!card.face) return { id: card.id, visibility: "hidden", blind: card.blind };
  if (card.face.rank === "JOKER") {
    return {
      id: card.id,
      visibility: "face",
      joker: styles.get(card.id) ?? "monochrome",
      blind: card.blind,
    };
  }
  return {
    id: card.id,
    visibility: "face",
    suit: card.face.suit as Suit,
    rank: card.face.rank as Rank,
    blind: card.blind,
  };
}

function gameCardView(
  card: {
    card: { id: string; suit: string | null; rank: string };
    mimic?: { suit: string; rank: string } | null;
  },
  styles: ReadonlyMap<string, "monochrome" | "crimson">,
): CardView {
  if (card.card.rank === "JOKER") {
    return {
      id: card.card.id,
      visibility: "face",
      joker: styles.get(card.card.id) ?? "monochrome",
      blind: false,
      ...(card.mimic
        ? { mimic: { suit: card.mimic.suit as Suit, rank: card.mimic.rank as Rank } }
        : {}),
    };
  }
  return {
    id: card.card.id,
    visibility: "face",
    suit: card.card.suit as Suit,
    rank: card.card.rank as Rank,
    blind: false,
  };
}

function plainGameCardView(
  card: { id: string; suit: string | null; rank: string },
  styles: ReadonlyMap<string, "monochrome" | "crimson">,
): CardView {
  return gameCardView({ card }, styles);
}

function requiredEffectCount(game: GameState, effect: PendingEffect): number {
  const actor = game.players.find((player) => player.id === effect.actorId);
  if (!actor) return 0;
  switch (effect.type) {
    case "recover":
      return Math.min(effect.count, game.discard.length);
    case "steal":
      return Math.min(
        effect.count,
        game.players
          .filter((player) => player.id !== actor.id && player.status === "active")
          .reduce((sum, player) => sum + player.hand.length, 0),
      );
    case "give":
      return game.players.some((player) => player.id !== actor.id && player.status === "active")
        ? Math.min(effect.count, actor.hand.length)
        : 0;
    case "discard":
      return Math.min(effect.count, actor.hand.length);
    case "bomb":
      return effect.count;
  }
}

function projectEffect(game: GameState): PendingEffectView[] {
  const effect = game.pendingEffect;
  if (!effect) return [];
  const actor = game.players.find((player) => player.id === effect.actorId);
  const kind = {
    recover: "collect",
    steal: "steal",
    give: "give",
    discard: "discard",
    bomb: "bomber",
  }[effect.type] as PendingEffectView["kind"];
  const eligibleCardIds =
    effect.type === "recover"
      ? game.discard.map((card) => card.id)
      : effect.type === "steal"
        ? game.players
            .filter((player) => player.id !== effect.actorId && player.status === "active")
            .flatMap((player) => player.hand.map((entry) => entry.card.id))
        : effect.type === "give" || effect.type === "discard"
          ? (actor?.hand.map((entry) => entry.card.id) ?? [])
          : undefined;
  return [
    {
      id: effect.id,
      kind,
      actorId: effect.actorId,
      requiredCount: requiredEffectCount(game, effect),
      ...(eligibleCardIds ? { eligibleCardIds } : {}),
      ...(effect.type === "give" || effect.type === "steal"
        ? {
            eligiblePlayerIds: game.players
              .filter((player) => player.id !== effect.actorId && player.status === "active")
              .map((player) => player.id),
          }
        : {}),
      message: `${effect.type} の対象を${requiredEffectCount(game, effect)}件選んでください`,
    },
  ];
}

function eventText(event: GameEvent, members: Record<string, SparkMember>): string {
  const name = (uid: string) => members[uid]?.name ?? "参加者";
  switch (event.type) {
    case "played":
      return `${name(event.playerId)}が${event.play.cards.length}枚出しました`;
    case "passed":
      return `${name(event.playerId)}がパスしました`;
    case "effect-pending":
      return `${name(event.effect.actorId)}が${event.effect.type}を処理しています`;
    case "trick-flushed":
      return `場が流れました（${event.reason}）`;
    case "finished":
      return `${event.playerIds.map(name).join("、")}が${event.rank}位で上がりました`;
    case "disqualified":
      return `${name(event.playerId)}が失格になりました`;
    case "game-finished":
      return "対局が終了しました";
  }
}

export class SparkAuthority {
  private snapshot: SparkRoomSnapshot;
  private evictions: { uid: string; peerId: string }[] = [];

  private constructor(snapshot: SparkRoomSnapshot) {
    this.snapshot = clone(snapshot);
  }

  static create(
    roomId: string,
    uid: string,
    peerId: string,
    profile: { name: string; avatar: AvatarProfileV1 },
    now = Date.now(),
  ): SparkAuthority {
    const member: SparkMember = {
      uid,
      peerId,
      name: profile.name.trim().slice(0, 32) || "ゲスト",
      avatar: migrateAvatar(profile.avatar),
      role: "player",
      joinedAtMs: now,
      online: true,
    };
    return new SparkAuthority({
      schemaVersion: 1,
      roomId,
      revision: 1,
      generation: 0,
      status: "waiting",
      coordinatorUid: uid,
      hostUid: uid,
      settings: { mode: "normal", blindCount: 0 },
      members: { [uid]: member },
      departedProfiles: {},
      createdAtMs: now,
      updatedAtMs: now,
      chat: [],
      socialLog: [
        {
          id: `system-${now}`,
          atMs: now,
          text: `${member.name}が部屋を作りました`,
          kind: "system",
        },
      ],
      appliedRoomActionIds: [],
      appliedRoomActionResults: {},
    });
  }

  static restore(snapshot: SparkRoomSnapshot): SparkAuthority {
    if (snapshot.schemaVersion !== 1) commandError("failed-precondition", "部屋形式が古すぎます");
    const restored = clone(snapshot);
    for (const member of Object.values(restored.members)) {
      // Snapshot/profile data crosses a browser trust boundary. Migration keeps
      // old v1 profiles usable while dropping unknown or oversized paint data.
      member.avatar = migrateAvatar(member.avatar);
    }
    for (const profile of Object.values(restored.departedProfiles ?? {})) {
      profile.avatar = migrateAvatar(profile.avatar);
    }
    return new SparkAuthority({
      ...restored,
      departedProfiles: clone(restored.departedProfiles ?? {}),
      appliedRoomActionResults: clone(restored.appliedRoomActionResults ?? {}),
    });
  }

  exportSnapshot(): SparkRoomSnapshot {
    return clone(this.snapshot);
  }

  get coordinatorUid(): string {
    return this.snapshot.coordinatorUid;
  }

  get isEmpty(): boolean {
    return Object.keys(this.snapshot.members).length === 0;
  }

  setCoordinator(uid: string, peerId: string, now = Date.now()): void {
    const member = this.snapshot.members[uid];
    if (!member) commandError("not-found", "移譲先が部屋にいません");
    member.peerId = peerId;
    member.online = true;
    this.snapshot.coordinatorUid = uid;
    this.commit(now);
  }

  publicRoom(): PublicRoom & {
    coordinatorUid: string;
    coordinatorPeerId: string;
    updatedAtMs: number;
  } {
    const host = this.snapshot.members[this.snapshot.hostUid];
    const members = Object.values(this.snapshot.members);
    return {
      roomId: this.snapshot.roomId,
      hostName: host?.name ?? "ゲスト",
      hostAvatar: clone(host?.avatar ?? members[0]!.avatar),
      playerCount: members.filter((member) => member.role === "player").length,
      spectatorCount: members.filter((member) => member.role === "spectator").length,
      mode: this.snapshot.settings.mode,
      blindCount: this.snapshot.settings.blindCount,
      phase: this.snapshot.status === "waiting" ? "waiting" : "playing",
      createdAtMs: this.snapshot.createdAtMs,
      coordinatorUid: this.snapshot.coordinatorUid,
      coordinatorPeerId: this.snapshot.members[this.snapshot.coordinatorUid]?.peerId ?? "",
      updatedAtMs: this.snapshot.updatedAtMs,
    };
  }

  member(uid: string): SparkMember | undefined {
    const member = this.snapshot.members[uid];
    return member ? clone(member) : undefined;
  }

  join(request: JoinRequest, now = Date.now()): void {
    const existing = this.snapshot.members[request.uid];
    if (!existing) {
      if (request.role === "player") {
        if (this.snapshot.status !== "waiting") {
          commandError("failed-precondition", "対局中は観戦参加を選んでください");
        }
        if (
          Object.values(this.snapshot.members).filter((member) => member.role === "player")
            .length >= MAX_PLAYERS
        ) {
          commandError("resource-exhausted", "プレイヤーは6人までです");
        }
      } else if (
        Object.values(this.snapshot.members).filter((member) => member.role === "spectator")
          .length >= MAX_SPECTATORS
      ) {
        commandError("resource-exhausted", "観戦席が満員です");
      }
    }
    if (
      this.snapshot.departedProfiles &&
      !this.snapshot.game?.players.some((player) => player.id === request.uid)
    ) {
      delete this.snapshot.departedProfiles[request.uid];
    }
    this.snapshot.members[request.uid] = {
      uid: request.uid,
      peerId: request.peerId,
      name: request.profile.name.trim().slice(0, 32) || "ゲスト",
      avatar: migrateAvatar(request.profile.avatar),
      role: existing?.role ?? request.role,
      joinedAtMs: existing?.joinedAtMs ?? now,
      online: true,
      ...(existing?.focusPlayerId ? { focusPlayerId: existing.focusPlayerId } : {}),
      ...(existing?.lastChatAtMs ? { lastChatAtMs: existing.lastChatAtMs } : {}),
    };
    this.snapshot.socialLog.push({
      id: `join-${request.uid}-${now}`,
      atMs: now,
      text: `${this.snapshot.members[request.uid]!.name}が${existing ? "再接続" : "参加"}しました`,
      kind: "system",
    });
    this.commit(now);
  }

  setMemberOnline(uid: string, online: boolean, peerId?: string, now = Date.now()): boolean {
    const member = this.snapshot.members[uid];
    if (!member || (member.online === online && (!peerId || member.peerId === peerId)))
      return false;
    member.online = online;
    if (peerId) member.peerId = peerId;
    this.snapshot.socialLog.push({
      id: `presence-${uid}-${now}`,
      atMs: now,
      text: `${member.name}が${online ? "再接続しました" : "切断されました"}`,
      kind: "system",
    });
    this.commit(now);
    return true;
  }

  disqualifyDisconnected(uid: string, now = Date.now()): boolean {
    const member = this.snapshot.members[uid];
    const player = this.snapshot.game?.players.find((candidate) => candidate.id === uid);
    if (!member || member.online) return false;
    if (this.snapshot.game && player?.status === "active") {
      const result = applyGameCommand(
        this.snapshot.game,
        {
          type: "disqualify",
          reason: "disconnect",
          playerId: uid,
          actionId: `disconnect-${uid}-${now}`,
          expectedVersion: this.snapshot.game.version,
        },
        now,
      );
      if (!result.ok) return false;
      this.snapshot.game = result.state;
      this.appendGameEvents(result.events, now);
      this.afterGameMutation(now);
    }
    this.removeMember(uid, now, `${member.name}を切断のため部屋から追放しました`);
    this.commit(now);
    return true;
  }

  timeoutCurrent(now = Date.now()): boolean {
    const game = this.snapshot.game;
    const pendingMimic = this.snapshot.pendingMimic;
    const actorId = pendingMimic?.actorUid ?? game?.pendingEffect?.actorId ?? game?.turnPlayerId;
    if (!game || !actorId || this.snapshot.status !== "playing") return false;
    if (pendingMimic) {
      const jokerMimics = pendingMimic.candidates[0];
      if (!jokerMimics) return false;
      const actionId = `timeout-mimic-${actorId}-${now}`;
      const result = applyGameCommand(
        game,
        {
          type: "play",
          playerId: actorId,
          actionId,
          expectedVersion: game.version,
          cardIds: pendingMimic.cardIds,
          jokerMimics,
          blindConfirmed: true,
        },
        now,
      );
      if (!result.ok) return false;
      delete this.snapshot.pendingMimic;
      this.snapshot.game = result.state;
      this.appendGameEvents(result.events, now);
      this.recordRoomAction(actionId, {});
      this.afterGameMutation(now);
      return true;
    }
    const result = applyGameCommand(
      game,
      {
        type: "timeout",
        playerId: actorId,
        actionId: `timeout-${actorId}-${now}`,
        expectedVersion: game.version,
      },
      now,
    );
    if (!result.ok) return false;
    this.snapshot.game = result.state;
    this.appendGameEvents(result.events, now);
    this.afterGameMutation(now);
    return true;
  }

  handleCommand(
    uid: string,
    name: string,
    payloadValue: Record<string, unknown>,
    now = Date.now(),
  ): Record<string, unknown> {
    const payload = objectValue(payloadValue);
    const member = this.snapshot.members[uid];
    if (!member) commandError("permission-denied", "部屋の参加者ではありません");
    const actionId =
      typeof payload.clientActionId === "string" ? payload.clientActionId : crypto.randomUUID();
    if (this.snapshot.appliedRoomActionIds.includes(actionId)) {
      return clone(this.snapshot.appliedRoomActionResults?.[actionId] ?? { duplicate: true });
    }
    if (
      typeof payload.expectedRevision === "number" &&
      payload.expectedRevision !== this.snapshot.revision
    ) {
      commandError("failed-precondition", "部屋の状態が更新されています");
    }
    if (
      payload.gameId !== undefined &&
      payload.gameId !== null &&
      payload.gameId !== this.snapshot.game?.id
    ) {
      commandError("failed-precondition", "別の対局が開始されています");
    }

    let response: Record<string, unknown> = {};
    switch (name) {
      case "saveAvatarProfile":
        if (!payload.avatar || typeof payload.avatar !== "object") {
          commandError("invalid-argument", "アバター情報が不正です");
        }
        member.avatar = migrateAvatar(payload.avatar);
        this.finishRoomCommand(actionId, now);
        return response;
      case "updateRoomSettings": {
        this.requireHost(uid);
        if (this.snapshot.status !== "waiting") {
          commandError("failed-precondition", "設定は待機室で変更してください");
        }
        const settings = objectValue(payload.settings);
        const mode = settings.mode === "blind" ? "blind" : "normal";
        const requestedBlindCount = Number(settings.blindCount);
        const blindCount =
          mode === "blind"
            ? Math.min(
                10,
                Math.max(1, Number.isFinite(requestedBlindCount) ? requestedBlindCount : 1),
              )
            : 0;
        this.snapshot.settings = { mode, blindCount };
        this.finishRoomCommand(actionId, now);
        return response;
      }
      case "transferHost": {
        this.requireHost(uid);
        const targetUid = String(payload.targetUid ?? "");
        const target = this.snapshot.members[targetUid];
        if (!target || target.role !== "player" || !target.online) {
          commandError("failed-precondition", "接続中プレイヤーだけに移譲できます");
        }
        this.snapshot.hostUid = targetUid;
        this.snapshot.coordinatorUid = targetUid;
        this.finishRoomCommand(actionId, now);
        return response;
      }
      case "kickMember": {
        this.requireHost(uid);
        const targetUid = String(payload.targetUid ?? "");
        if (!targetUid || targetUid === uid) {
          commandError("invalid-argument", "自分自身はキックできません");
        }
        if (!this.snapshot.members[targetUid]) {
          commandError("failed-precondition", "対象の参加者が見つかりません");
        }
        this.leave(targetUid, actionId, now, "moderation");
        return response;
      }
      case "startGame": {
        this.requireHost(uid);
        if (this.snapshot.status !== "waiting") commandError("failed-precondition", "開始済みです");
        const players = Object.values(this.snapshot.members)
          .filter((candidate) => candidate.role === "player")
          .sort((left, right) => left.joinedAtMs - right.joinedAtMs);
        if (players.length < 3 || players.length > 6) {
          commandError("failed-precondition", "プレイヤー3〜6人で開始してください");
        }
        if (players.filter((candidate) => candidate.online || candidate.uid === uid).length < 3) {
          commandError("failed-precondition", "接続中プレイヤーが3人必要です");
        }
        const gameId = `p2p-${this.snapshot.generation}-${crypto.randomUUID()}`;
        this.snapshot.game = createInitialGameState(
          players.map((candidate) => candidate.uid),
          { ...this.snapshot.settings, gameId },
        );
        this.snapshot.status = "playing";
        delete this.snapshot.pendingMimic;
        this.snapshot.turnDeadlineMs = now + TURN_MS;
        this.snapshot.socialLog.push({
          id: `start-${now}`,
          atMs: now,
          text: `${players.length}人で対局を開始しました`,
          kind: "system",
        });
        const startResponse = { gameId };
        this.finishRoomCommand(actionId, now, startResponse);
        return startResponse;
      }
      case "startRematch":
        this.requireHost(uid);
        if (this.snapshot.status !== "finished") {
          commandError("failed-precondition", "対局終了後に再戦してください");
        }
        this.snapshot.status = "waiting";
        delete this.snapshot.game;
        delete this.snapshot.pendingMimic;
        delete this.snapshot.turnDeadlineMs;
        this.snapshot.departedProfiles = {};
        this.snapshot.generation += 1;
        this.finishRoomCommand(actionId, now);
        return response;
      case "changeSpectatorFocus": {
        const player = this.snapshot.game?.players.find((candidate) => candidate.id === uid);
        if (member.role !== "spectator" && player?.status === "active") {
          commandError("permission-denied", "観戦者専用操作です");
        }
        const focus = String(payload.focusPlayerId ?? "");
        if (
          !this.snapshot.game?.players.some(
            (candidate) => candidate.id === focus && candidate.status === "active",
          )
        ) {
          commandError("invalid-argument", "指定プレイヤーが見つかりません");
        }
        member.focusPlayerId = focus;
        this.finishRoomCommand(actionId, now);
        return response;
      }
      case "sendChat": {
        if (member.lastChatAtMs && now - member.lastChatAtMs < 1_000) {
          commandError("resource-exhausted", "チャットは1秒に1件までです");
        }
        const text = String(payload.text ?? "")
          .trim()
          .slice(0, 120);
        if (!text) commandError("invalid-argument", "メッセージを入力してください");
        member.lastChatAtMs = now;
        const player = this.snapshot.game?.players.find((candidate) => candidate.id === uid);
        this.snapshot.chat.push({
          id: actionId,
          uid,
          name: member.name,
          role:
            member.role === "spectator" || (player && player.status !== "active")
              ? "spectator"
              : "player",
          text,
          atMs: now,
        });
        this.snapshot.chat = this.snapshot.chat.slice(-120);
        this.finishRoomCommand(actionId, now);
        return response;
      }
      case "leaveRoom":
        this.leave(uid, actionId, now);
        return response;
      default:
        response = this.handleGameCommand(uid, name, payload, actionId, now);
        return response;
    }
  }

  consumeEvictions(): { uid: string; peerId: string }[] {
    const evictions = this.evictions;
    this.evictions = [];
    return evictions;
  }

  private handleGameCommand(
    uid: string,
    name: string,
    payload: Record<string, unknown>,
    actionId: string,
    now: number,
  ): Record<string, unknown> {
    const game = this.snapshot.game;
    if (!game || this.snapshot.status !== "playing") {
      commandError("failed-precondition", "対局中ではありません");
    }
    if (this.snapshot.pendingMimic && name !== "declareJokerMimic") {
      commandError("failed-precondition", "ブラインドJoker宣言を先に確定してください");
    }
    let command: GameCommand;
    if (name === "submitPlay") {
      const cardIds = stringArray(payload.cardIds);
      const player = game.players.find((candidate) => candidate.id === uid);
      const selected = cardIds.flatMap((cardId) => {
        const entry = player?.hand.find((candidate) => candidate.card.id === cardId);
        return entry ? [entry] : [];
      });
      const requiresMimic =
        selected.some((entry) => entry.blind && entry.card.rank === "JOKER") &&
        selected.some((entry) => entry.card.rank !== "JOKER");
      if (requiresMimic && !Array.isArray(payload.mimics)) {
        commandError("invalid-argument", "Joker宣言の形式が不正です");
      }
      let sentMimics = (Array.isArray(payload.mimics) ? payload.mimics : []) as JokerMimic[];
      if (requiresMimic && sentMimics.length === 0) {
        const candidates = findLegalJokerMimics(game, uid, cardIds);
        if (candidates.length === 1) {
          sentMimics = candidates[0]!;
        } else if (candidates.length > 1) {
          const mimicResponse = {
            requiresJokerMimic: true,
            candidateCount: candidates.length,
          };
          this.snapshot.pendingMimic = { actorUid: uid, cardIds, candidates, actionId };
          this.finishRoomCommand(actionId, now, mimicResponse);
          return mimicResponse;
        }
      }
      command = {
        type: "play",
        playerId: uid,
        actionId,
        expectedVersion: game.version,
        cardIds,
        jokerMimics: sentMimics,
        blindConfirmed: payload.blindConfirmed === true,
      };
    } else if (name === "declareJokerMimic") {
      const pending = this.snapshot.pendingMimic;
      if (!pending || pending.actorUid !== uid) {
        commandError("failed-precondition", "確定待ちのJoker宣言がありません");
      }
      command = {
        type: "play",
        playerId: uid,
        actionId,
        expectedVersion: game.version,
        cardIds: pending.cardIds,
        jokerMimics: (Array.isArray(payload.mimics) ? payload.mimics : []) as JokerMimic[],
        blindConfirmed: true,
      };
    } else if (name === "submitPass") {
      command = {
        type: "pass",
        playerId: uid,
        actionId,
        expectedVersion: game.version,
      };
    } else {
      const effect = game.pendingEffect;
      if (!effect) commandError("failed-precondition", "確定待ち効果がありません");
      let selection: EffectSelection;
      if (name === "resolveSteal" || name === "resolveGive") {
        const values = name === "resolveSteal" ? payload.selections : payload.transfers;
        if (!Array.isArray(values)) commandError("invalid-argument", "効果選択が不正です");
        const grouped = new Map<string, string[]>();
        for (const value of values) {
          const item = objectValue(value);
          const targetUid = String(item.targetUid ?? "");
          const cardId = String(item.cardId ?? "");
          if (!targetUid || !cardId) commandError("invalid-argument", "効果対象が不正です");
          grouped.set(targetUid, [...(grouped.get(targetUid) ?? []), cardId]);
        }
        selection = {
          type: name === "resolveSteal" ? "steal" : "give",
          transfers: [...grouped].map(([playerId, cardIds]) => ({ playerId, cardIds })),
        };
      } else if (name === "resolveDiscard") {
        selection = { type: "discard", cardIds: stringArray(payload.cardIds) };
      } else if (name === "resolveCollect") {
        selection = { type: "recover", cardIds: stringArray(payload.cardIds) };
      } else if (name === "resolveBomber") {
        const ranks = stringArray(payload.ranks).map((rank) => (rank === "Joker" ? "JOKER" : rank));
        selection = { type: "bomb", ranks: ranks as PhysicalRank[] };
      } else {
        commandError("invalid-argument", `未対応コマンド: ${name}`);
      }
      command = {
        type: "resolve-effect",
        playerId: uid,
        actionId,
        expectedVersion: game.version,
        effectId: effect.id,
        selection,
      };
    }
    const result = applyGameCommand(game, command, now);
    if (!result.ok) commandError("failed-precondition", result.error.message);
    if (name === "declareJokerMimic") delete this.snapshot.pendingMimic;
    this.snapshot.game = result.state;
    this.appendGameEvents(result.events, now);
    this.recordRoomAction(actionId, {});
    this.afterGameMutation(now);
    return {};
  }

  private leave(
    uid: string,
    actionId: string,
    now: number,
    reason: "exit" | "moderation" = "exit",
  ): void {
    const member = this.snapshot.members[uid];
    if (!member) return;
    const player = this.snapshot.game?.players.find((candidate) => candidate.id === uid);
    if (this.snapshot.game && player?.status === "active") {
      const result = applyGameCommand(
        this.snapshot.game,
        {
          type: "disqualify",
          reason,
          playerId: uid,
          actionId,
          expectedVersion: this.snapshot.game.version,
        },
        now,
      );
      if (result.ok) {
        this.snapshot.game = result.state;
        this.appendGameEvents(result.events, now);
        this.afterGameMutation(now);
      }
    }
    if (reason === "moderation") this.evictions.push({ uid, peerId: member.peerId });
    this.removeMember(
      uid,
      now,
      reason === "moderation"
        ? `${member.name}がホストによりキックされました`
        : `${member.name}が退出しました`,
    );
    this.finishRoomCommand(actionId, now);
  }

  private removeMember(uid: string, now: number, logText: string): void {
    if (this.snapshot.pendingMimic?.actorUid === uid) {
      delete this.snapshot.pendingMimic;
    }
    const departingMember = this.snapshot.members[uid];
    if (
      departingMember &&
      this.snapshot.game?.players.some((player) => player.id === departingMember.uid)
    ) {
      this.snapshot.departedProfiles ??= {};
      this.snapshot.departedProfiles[uid] = {
        name: departingMember.name,
        avatar: clone(departingMember.avatar),
      };
    }
    delete this.snapshot.members[uid];
    if (this.snapshot.hostUid === uid) {
      const remaining = Object.values(this.snapshot.members).sort(
        (left, right) => left.joinedAtMs - right.joinedAtMs,
      );
      this.snapshot.hostUid =
        remaining.find((candidate) => candidate.role === "player" && candidate.online)?.uid ??
        remaining.find((candidate) => candidate.online)?.uid ??
        remaining.find((candidate) => candidate.role === "player")?.uid ??
        remaining[0]?.uid ??
        "";
    }
    if (this.snapshot.coordinatorUid === uid) {
      this.snapshot.coordinatorUid =
        Object.values(this.snapshot.members)
          .filter((candidate) => candidate.online)
          .sort((left, right) => left.joinedAtMs - right.joinedAtMs)[0]?.uid ?? "";
    }
    this.snapshot.socialLog.push({
      id: `leave-${uid}-${now}`,
      atMs: now,
      text: logText,
      kind: "system",
    });
  }

  private requireHost(uid: string): void {
    if (this.snapshot.hostUid !== uid) commandError("permission-denied", "ホスト専用操作です");
  }

  private recordRoomAction(actionId: string, response: Record<string, unknown>): void {
    this.snapshot.appliedRoomActionIds.push(actionId);
    this.snapshot.appliedRoomActionIds = this.snapshot.appliedRoomActionIds.slice(-200);
    this.snapshot.appliedRoomActionResults ??= {};
    this.snapshot.appliedRoomActionResults[actionId] = clone(response);
    const retained = new Set(this.snapshot.appliedRoomActionIds);
    for (const storedActionId of Object.keys(this.snapshot.appliedRoomActionResults)) {
      if (!retained.has(storedActionId))
        delete this.snapshot.appliedRoomActionResults[storedActionId];
    }
  }

  private finishRoomCommand(
    actionId: string,
    now: number,
    response: Record<string, unknown> = {},
  ): void {
    this.recordRoomAction(actionId, response);
    this.commit(now);
  }

  private appendGameEvents(events: GameEvent[], now: number): void {
    events.forEach((event, index) => {
      this.snapshot.socialLog.push({
        id: `game-${this.snapshot.revision}-${index}-${now}`,
        atMs: now,
        text: eventText(event, this.snapshot.members),
        kind:
          event.type === "played"
            ? "play"
            : event.type === "passed"
              ? "pass"
              : event.type === "effect-pending"
                ? "effect"
                : "system",
      });
    });
    this.snapshot.socialLog = this.snapshot.socialLog.slice(-300);
  }

  private afterGameMutation(now: number): void {
    if (this.snapshot.game?.phase === "finished") {
      this.snapshot.status = "finished";
      delete this.snapshot.turnDeadlineMs;
    } else {
      this.snapshot.status = "playing";
      this.snapshot.turnDeadlineMs = now + TURN_MS;
    }
    const hostPlayer = this.snapshot.game?.players.find(
      (player) => player.id === this.snapshot.hostUid,
    );
    if (hostPlayer?.status === "disqualified") {
      this.snapshot.hostUid =
        Object.values(this.snapshot.members)
          .filter(
            (member) =>
              member.role === "player" &&
              member.online &&
              this.snapshot.game?.players.find((player) => player.id === member.uid)?.status !==
                "disqualified",
          )
          .sort((left, right) => left.joinedAtMs - right.joinedAtMs)[0]?.uid ??
        this.snapshot.hostUid;
    }
    this.commit(now);
  }

  private commit(now: number): void {
    this.snapshot.revision += 1;
    this.snapshot.updatedAtMs = now;
  }

  project(uid: string): RoomView {
    const member = this.snapshot.members[uid];
    if (!member) commandError("permission-denied", "部屋の参加者ではありません");
    const game = this.snapshot.game;
    if (!game) {
      const players = Object.values(this.snapshot.members)
        .filter((candidate) => candidate.role === "player")
        .sort((left, right) => left.joinedAtMs - right.joinedAtMs);
      return {
        roomId: this.snapshot.roomId,
        revision: this.snapshot.revision,
        generation: this.snapshot.generation,
        phase: "waiting",
        role: member.role,
        viewerId: uid,
        hostId: this.snapshot.hostUid,
        players: players.map((candidate) => ({
          id: candidate.uid,
          name: candidate.name,
          avatar: clone(candidate.avatar),
          cardCount: 0,
          cards: [],
          connection: candidate.online ? "online" : "offline",
          status: "active",
          host: candidate.uid === this.snapshot.hostUid,
        })),
        spectators: Object.values(this.snapshot.members)
          .filter((candidate) => candidate.role === "spectator")
          .map((candidate) => ({ id: candidate.uid, name: candidate.name })),
        settings: clone(this.snapshot.settings),
        direction: 1,
        revolution: false,
        jackBack: false,
        suitLock: [],
        field: [],
        discard: [],
        hand: [],
        pendingEffects: [],
        rankings: [],
        log: clone(this.snapshot.socialLog),
        chat: clone(this.snapshot.chat),
      };
    }
    const gamePlayer = game.players.find((player) => player.id === uid);
    const effectiveRole: Role =
      member.role === "spectator" || gamePlayer?.status !== "active" ? "spectator" : "player";
    const requestedFocus = game.players.find(
      (player) => player.id === member.focusPlayerId && player.status === "active",
    )?.id;
    const focusPlayerId =
      effectiveRole === "spectator"
        ? (requestedFocus ?? game.players.find((player) => player.status === "active")?.id)
        : uid;
    const projected = projectGame(game, {
      ...(effectiveRole === "player" ? { playerId: uid } : {}),
      spectator: effectiveRole === "spectator",
    });
    const projectedJokerStyles = jokerStyles(game);
    const projectedById = new Map(projected.players.map((player) => [player.id, player]));
    const hand =
      projectedById
        .get(focusPlayerId ?? "")
        ?.hand.map((card) => cardView(card, projectedJokerStyles)) ?? [];
    const players = game.players.map((player) => {
      const roomMember = this.snapshot.members[player.id];
      const presentPlayerMember = roomMember?.role === "player" ? roomMember : undefined;
      const departedProfile = this.snapshot.departedProfiles?.[player.id];
      const projectedPlayer = projectedById.get(player.id)!;
      return {
        id: player.id,
        name: presentPlayerMember?.name ?? departedProfile?.name ?? "退出者",
        avatar: clone(presentPlayerMember?.avatar ?? departedProfile?.avatar ?? member.avatar),
        cardCount: projectedPlayer.hand.length,
        cards: projectedPlayer.hand.map((card) => cardView(card, projectedJokerStyles)),
        connection: roomMember?.online ? ("online" as const) : ("offline" as const),
        status: player.status,
        present: Boolean(presentPlayerMember),
        ...(player.rank ? { rank: player.rank } : {}),
        host: player.id === this.snapshot.hostUid,
      };
    });
    const pendingMimic =
      this.snapshot.pendingMimic?.actorUid === uid
        ? {
            cardIds: [...this.snapshot.pendingMimic.cardIds],
            candidates: clone(this.snapshot.pendingMimic.candidates) as Array<
              Array<{ cardId: string; suit: Suit; rank: Rank }>
            >,
            revealedJokerIds: [
              ...new Set(
                this.snapshot.pendingMimic.candidates.flatMap((candidate) =>
                  candidate.map((mimic) => mimic.cardId),
                ),
              ),
            ],
            revealedCards: this.snapshot.pendingMimic.cardIds.flatMap((cardId) => {
              const entry = gamePlayer?.hand.find((candidate) => candidate.card.id === cardId);
              return entry?.card.rank === "JOKER"
                ? [plainGameCardView(entry.card, projectedJokerStyles)]
                : [];
            }),
          }
        : undefined;
    return {
      roomId: this.snapshot.roomId,
      revision: this.snapshot.revision,
      gameId: game.id,
      ...(game.pile ? { trickId: game.pile.id } : {}),
      generation: this.snapshot.generation,
      phase:
        this.snapshot.status === "finished"
          ? "finished"
          : game.pendingEffect || this.snapshot.pendingMimic
            ? "effect"
            : "playing",
      role: effectiveRole,
      viewerId: uid,
      hostId: this.snapshot.hostUid,
      players,
      spectators: Object.values(this.snapshot.members)
        .filter((candidate) => candidate.role === "spectator")
        .map((candidate) => ({ id: candidate.uid, name: candidate.name })),
      settings: clone(this.snapshot.settings),
      ...(game.turnPlayerId ? { currentPlayerId: game.turnPlayerId } : {}),
      ...(this.snapshot.turnDeadlineMs ? { turnDeadlineMs: this.snapshot.turnDeadlineMs } : {}),
      direction: game.direction,
      revolution: game.revolution,
      jackBack: game.jackBack,
      suitLock: [...game.binding],
      firstPlay: game.firstPlay,
      fieldPlays: [...game.trickHistory, ...(game.pile ? [game.pile] : [])].map((play) =>
        play.cards.map((card) => gameCardView(card, projectedJokerStyles)),
      ),
      field: game.pile?.cards.map((card) => gameCardView(card, projectedJokerStyles)) ?? [],
      discard: game.discard.map((card) => plainGameCardView(card, projectedJokerStyles)),
      hand,
      pendingEffects: projectEffect(game),
      ...(pendingMimic ? { pendingJokerMimic: pendingMimic } : {}),
      rankings: game.players
        .filter((player) => player.rank !== null)
        .map((player) => ({
          playerId: player.id,
          place: player.rank!,
          ...(player.finishReason ? { reason: player.finishReason } : {}),
        })),
      log: clone(this.snapshot.socialLog),
      chat: clone(this.snapshot.chat),
      ...(focusPlayerId ? { focusedPlayerId: focusPlayerId } : {}),
    };
  }
}
