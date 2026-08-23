import type { BrowserContext } from "@playwright/test";
import { defaultAvatar, type AvatarProfileV1 } from "@daifugo/avatar-schema";
import type {
  CardView,
  PendingEffectView,
  PublicRoom,
  Rank,
  Role,
  RoomView,
  Suit,
} from "../../src/app/model";
import type { CueEvent } from "../../src/network/peerCues";

type BridgeRequest = {
  op: "command" | "presence" | "publicRooms" | "roomBase" | "roomView" | "cueSend" | "cueLast";
  name?: string;
  payload?: Record<string, unknown>;
  roomId?: string;
  uid?: string;
};

type AuthorityCard = {
  id: string;
  suit: Suit;
  rank: Rank;
  blind: boolean;
  blindOutcome?: "success" | "disqualify";
};

type AuthorityMember = {
  uid: string;
  name: string;
  avatar: AvatarProfileV1;
  role: Role;
  status: "active" | "finished" | "disqualified";
  hand: AuthorityCard[];
  focusPlayerId?: string;
  reconnectToken: string;
  tokenGeneration: number;
  connection: "online" | "grace" | "offline";
  disconnectedAtMs?: number;
};

type AuthorityRoom = {
  roomId: string;
  revision: number;
  gameId?: string;
  phase: RoomView["phase"];
  hostId: string;
  members: AuthorityMember[];
  currentPlayerId?: string;
  fieldPlays: AuthorityCard[][];
  field: AuthorityCard[];
  discard: AuthorityCard[];
  pendingEffects: PendingEffectView[];
  rankings: RoomView["rankings"];
  log: RoomView["log"];
  chat: NonNullable<RoomView["chat"]>;
  createdAtMs: number;
  openingPlayPending: boolean;
};

type AuthorityOptions = {
  blindDiamond3?: boolean;
};

const face = (card: AuthorityCard): CardView => ({
  id: card.id,
  visibility: "face",
  suit: card.suit,
  rank: card.rank,
  blind: card.blind,
});

const hidden = (card: AuthorityCard): CardView => ({
  id: card.id,
  visibility: "hidden",
  blind: card.blind,
});

function profileOf(payload: Record<string, unknown>): { name: string; avatar: AvatarProfileV1 } {
  const value = payload.profile as { name?: unknown; avatar?: unknown } | undefined;
  return {
    name: typeof value?.name === "string" ? value.name : "ゲスト",
    avatar: (value?.avatar as AvatarProfileV1 | undefined) ?? structuredClone(defaultAvatar),
  };
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string") throw new Error(`invalid-argument: ${key}`);
  return value;
}

export class AuthoritativeE2EServer {
  readonly roomId = "TST23";
  readonly commandNames: string[] = [];
  readonly appliedCommandNames: string[] = [];
  private readonly rooms = new Map<string, AuthorityRoom>();
  private readonly pausedViewers = new Set<string>();
  private readonly cachedViews = new Map<string, RoomView>();
  private readonly processedActions = new Map<string, { name: string; result: unknown }>();
  private readonly latestCues = new Map<string, { cue: CueEvent; sender: string }>();

  constructor(private readonly options: AuthorityOptions = {}) {}

  async install(
    context: BrowserContext,
    uid: string,
    options: { renderCanvas?: boolean; cueBridge?: boolean } = {},
  ): Promise<void> {
    await context.exposeBinding("__daifugoE2ECall", (_source, request: BridgeRequest) =>
      this.handle(uid, request),
    );
    await context.addInitScript(
      ({ viewerUid, renderCanvas, cueBridge }) => {
        (
          window as unknown as { __DAIFUGO_E2E_RENDER_CANVAS__?: boolean }
        ).__DAIFUGO_E2E_RENDER_CANVAS__ = renderCanvas;
        // Semantic multi-context scenarios may suppress WebGL so several pages do not starve
        // React timers. Dedicated visual gameplay tests opt into a visible real Canvas.
        if (!renderCanvas) {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "hidden",
          });
        }
        const call = (window as unknown as Record<string, unknown>).__daifugoE2ECall as (
          request: BridgeRequest,
        ) => Promise<unknown>;
        (
          window as unknown as {
            __DAIFUGO_E2E__: { uid: string; cues: boolean; call: typeof call };
          }
        ).__DAIFUGO_E2E__ = { uid: viewerUid, cues: cueBridge, call };
      },
      {
        viewerUid: uid,
        renderCanvas: options.renderCanvas === true,
        cueBridge: options.cueBridge === true,
      },
    );
  }

  pauseViewer(uid: string): void {
    this.pausedViewers.add(uid);
  }

  resumeViewer(uid: string): void {
    this.pausedViewers.delete(uid);
  }

  bumpRevision(roomId = this.roomId): void {
    const room = this.room(roomId);
    room.revision += 1;
    this.log(room, "外部更新によりrevisionが進みました", "system");
  }

  currentToken(uid: string): string {
    return this.member(this.room(this.roomId), uid).reconnectToken;
  }

  forceFinish(uid: string, place = 1): void {
    const room = this.room(this.roomId);
    const member = this.member(room, uid);
    if (member.role !== "player") throw new Error("failed-precondition: player required");
    member.status = "finished";
    member.hand = [];
    member.focusPlayerId = room.members.find(
      (candidate) => candidate.role === "player" && candidate.status === "active",
    )?.uid;
    room.rankings.push({ playerId: uid, place, reason: "finished" });
    if (room.currentPlayerId === uid) room.currentPlayerId = this.nextPlayer(room, uid);
    room.revision += 1;
    this.log(room, `${member.name}が${place}位で上がり、観戦へ移りました`, "system");
  }

  forceGiveEffect(uid = "uid-host"): void {
    const room = this.room(this.roomId);
    const actor = this.member(room, uid);
    const card = actor.hand.find((candidate) => candidate.rank === "7");
    if (!card) throw new Error("failed-precondition: 7 card required");
    const targets = room.members
      .filter(
        (member) => member.role === "player" && member.status === "active" && member.uid !== uid,
      )
      .map((member) => member.uid);
    room.phase = "effect";
    room.currentPlayerId = uid;
    room.pendingEffects = [
      {
        id: "effect-give-visual",
        kind: "give",
        actorId: uid,
        requiredCount: 1,
        eligibleCardIds: [card.id],
        eligiblePlayerIds: targets,
        message: "7渡しの相手を選んでください",
      },
    ];
    room.revision += 1;
  }

  forceCollectEffect(uid = "uid-player-3", discardCount = 32): void {
    const room = this.room(this.roomId);
    const ranks: Rank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
    const suits: Suit[] = ["spade", "heart", "diamond", "club"];
    room.discard = Array.from({ length: discardCount }, (_, index) => ({
      id: `rack-${index}`,
      suit: suits[index % suits.length]!,
      rank: ranks[index % ranks.length]!,
      blind: false,
    }));
    room.phase = "effect";
    room.currentPlayerId = uid;
    room.pendingEffects = [
      {
        id: "effect-collect-visual",
        kind: "collect",
        actorId: uid,
        requiredCount: 2,
        eligibleCardIds: room.discard.map((card) => card.id),
        message: "回収する札を選んでください",
      },
    ];
    room.revision += 1;
  }

  disconnect(uid: string, disconnectedAtMs: number): void {
    const room = this.room(this.roomId);
    const member = this.member(room, uid);
    member.connection = "grace";
    member.disconnectedAtMs = disconnectedAtMs;
    room.revision += 1;
  }

  sweepDisconnected(nowMs: number): void {
    for (const room of this.rooms.values()) {
      for (const member of room.members) {
        if (
          member.role !== "player" ||
          member.status !== "active" ||
          member.connection !== "grace" ||
          member.disconnectedAtMs === undefined ||
          nowMs - member.disconnectedAtMs < 120_000
        )
          continue;
        member.connection = "offline";
        member.status = "disqualified";
        room.discard.push(...member.hand);
        member.hand = [];
        member.focusPlayerId = room.members.find(
          (candidate) => candidate.role === "player" && candidate.status === "active",
        )?.uid;
        const used = new Set(room.rankings.map((ranking) => ranking.place));
        let place = room.members.filter((candidate) => candidate.role === "player").length;
        while (used.has(place) && place > 1) place -= 1;
        room.rankings.push({ playerId: member.uid, place, reason: "disconnect_timeout" });
        if (room.currentPlayerId === member.uid)
          room.currentPlayerId = this.nextPlayer(room, member.uid);
        room.revision += 1;
        this.log(room, `${member.name}は切断120秒超過で失格になりました`, "system");
      }
    }
  }

  private room(roomId: string): AuthorityRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("not-found: 指定された部屋が見つかりません");
    return room;
  }

  private member(room: AuthorityRoom, uid: string): AuthorityMember {
    const member = room.members.find((candidate) => candidate.uid === uid);
    if (!member) throw new Error("permission-denied: 部屋のメンバーではありません");
    return member;
  }

  private assertRevision(room: AuthorityRoom, payload: Record<string, unknown>): void {
    if (payload.expectedRevision !== room.revision)
      throw new Error(
        `failed-precondition: stale revision ${String(payload.expectedRevision)} != ${room.revision}`,
      );
    const gameId = payload.gameId;
    if ((room.gameId ?? null) !== (gameId ?? null))
      throw new Error("failed-precondition: stale gameId");
  }

  private nextPlayer(room: AuthorityRoom, fromUid: string): string | undefined {
    const active = room.members.filter(
      (member) => member.role === "player" && member.status === "active",
    );
    const index = active.findIndex((member) => member.uid === fromUid);
    if (!active.length) return undefined;
    return active[(index + 1 + active.length) % active.length]?.uid;
  }

  private log(room: AuthorityRoom, text: string, kind: RoomView["log"][number]["kind"]): void {
    room.log.push({ id: `l-${room.revision}-${room.log.length}`, atMs: Date.now(), text, kind });
  }

  private projectOwned(card: AuthorityCard): CardView {
    return card.blind ? hidden(card) : face(card);
  }

  private projectOther(card: AuthorityCard): CardView {
    return card.blind ? face(card) : hidden(card);
  }

  private projectView(room: AuthorityRoom, uid: string): RoomView {
    const viewer = this.member(room, uid);
    const viewerRole: Role =
      viewer.role === "spectator" || viewer.status !== "active" ? "spectator" : "player";
    const focusedPlayerId =
      viewerRole === "spectator"
        ? (viewer.focusPlayerId ??
          room.members.find((member) => member.role === "player" && member.status === "active")
            ?.uid)
        : undefined;
    const focused = focusedPlayerId
      ? room.members.find((member) => member.uid === focusedPlayerId)
      : undefined;
    const hand =
      viewerRole === "spectator"
        ? (focused?.hand.map(face) ?? [])
        : viewer.hand.map((card) => this.projectOwned(card));
    return {
      roomId: room.roomId,
      revision: room.revision,
      ...(room.gameId ? { gameId: room.gameId } : {}),
      trickId: room.gameId ? "trick-1" : undefined,
      generation: 1,
      phase: room.phase,
      role: viewerRole,
      viewerId: uid,
      hostId: room.hostId,
      players: room.members
        .filter((member) => member.role === "player")
        .map((member) => ({
          id: member.uid,
          name: member.name,
          avatar: structuredClone(member.avatar),
          cardCount: member.hand.length,
          cards:
            viewerRole === "spectator"
              ? member.hand.map(face)
              : member.uid === uid
                ? member.hand.map((card) => this.projectOwned(card))
                : member.hand.map((card) => this.projectOther(card)),
          connection: member.connection,
          status: member.status,
          host: member.uid === room.hostId,
          ...(room.rankings.find((ranking) => ranking.playerId === member.uid)?.place
            ? { rank: room.rankings.find((ranking) => ranking.playerId === member.uid)!.place }
            : {}),
        })),
      spectators: room.members
        .filter((member) => member.role === "spectator")
        .map((member) => ({ id: member.uid, name: member.name })),
      settings: { mode: "blind", blindCount: 1 },
      ...(room.currentPlayerId ? { currentPlayerId: room.currentPlayerId } : {}),
      turnDeadlineMs: room.currentPlayerId ? Date.now() + 60_000 : undefined,
      direction: 1,
      revolution: false,
      jackBack: false,
      suitLock: [],
      firstPlay: room.openingPlayPending,
      fieldPlays: room.fieldPlays.map((play) => play.map(face)),
      field: room.field.map(face),
      discard: room.discard.map(face),
      hand,
      pendingEffects: structuredClone(room.pendingEffects),
      rankings: structuredClone(room.rankings),
      log: structuredClone(room.log),
      chat: structuredClone(room.chat),
      ...(focusedPlayerId ? { focusedPlayerId } : {}),
    };
  }

  private publicRooms(): PublicRoom[] {
    return [...this.rooms.values()].map((room) => ({
      roomId: room.roomId,
      hostName: this.member(room, room.hostId).name,
      hostAvatar: structuredClone(this.member(room, room.hostId).avatar),
      playerCount: room.members.filter((member) => member.role === "player").length,
      spectatorCount: room.members.filter((member) => member.role === "spectator").length,
      mode: "blind",
      blindCount: 1,
      phase: room.phase === "waiting" ? "waiting" : "playing",
      createdAtMs: room.createdAtMs,
    }));
  }

  private create(uid: string, payload: Record<string, unknown>): Record<string, unknown> {
    const profile = profileOf(payload);
    const token = `reconnect-${uid}-1`;
    const room: AuthorityRoom = {
      roomId: this.roomId,
      revision: 1,
      phase: "waiting",
      hostId: uid,
      members: [
        {
          uid,
          ...profile,
          role: "player",
          status: "active",
          hand: [],
          reconnectToken: token,
          tokenGeneration: 1,
          connection: "online",
        },
      ],
      fieldPlays: [],
      field: [],
      discard: [],
      pendingEffects: [],
      rankings: [],
      log: [],
      chat: [],
      createdAtMs: Date.now(),
      openingPlayPending: false,
    };
    this.rooms.set(room.roomId, room);
    return { roomId: room.roomId, reconnectToken: token };
  }

  private join(uid: string, role: Role, payload: Record<string, unknown>): Record<string, unknown> {
    const room = this.room(payloadString(payload, "roomId"));
    this.assertRevision(room, payload);
    if (room.members.some((member) => member.uid === uid))
      throw new Error("already-exists: 既に参加しています");
    if (role === "player" && room.phase !== "waiting")
      throw new Error("failed-precondition: 対局開始後はプレイヤー参加できません");
    if (role === "player" && room.members.filter((member) => member.role === "player").length >= 6)
      throw new Error("resource-exhausted: プレイヤー枠は6人で満員です");
    const profile = profileOf(payload);
    const token = `reconnect-${uid}-1`;
    room.members.push({
      uid,
      ...profile,
      role,
      status: "active",
      hand: [],
      reconnectToken: token,
      tokenGeneration: 1,
      connection: "online",
      ...(role === "spectator"
        ? {
            focusPlayerId: room.members.find((member) => member.role === "player")?.uid,
          }
        : {}),
    });
    room.revision += 1;
    this.log(room, `${profile.name}が${role === "player" ? "参加" : "観戦参加"}しました`, "system");
    return { reconnectToken: token };
  }

  private start(room: AuthorityRoom, uid: string): void {
    if (room.hostId !== uid) throw new Error("permission-denied: ホストのみ開始できます");
    const players = room.members.filter((member) => member.role === "player");
    if (players.length < 3) throw new Error("failed-precondition: 3人以上必要です");
    const hands: AuthorityCard[][] = [
      [
        {
          id: "c-a1",
          suit: "diamond",
          rank: "3",
          blind: Boolean(this.options.blindDiamond3),
          ...(this.options.blindDiamond3 ? { blindOutcome: "success" as const } : {}),
        },
        {
          id: "c-a2",
          suit: "club",
          rank: "5",
          blind: !this.options.blindDiamond3,
          ...(!this.options.blindDiamond3 ? { blindOutcome: "success" as const } : {}),
        },
        { id: "c-a3", suit: "spade", rank: "7", blind: false },
      ],
      [
        { id: "c-b1", suit: "heart", rank: "4", blind: false },
        { id: "c-b2", suit: "club", rank: "6", blind: false },
        { id: "c-b3", suit: "spade", rank: "3", blind: true, blindOutcome: "disqualify" },
      ],
      [
        { id: "c-c1", suit: "heart", rank: "A", blind: false },
        { id: "c-c2", suit: "diamond", rank: "9", blind: false },
        { id: "c-c3", suit: "club", rank: "K", blind: false },
      ],
      [{ id: "c-d1", suit: "club", rank: "8", blind: false }],
      [{ id: "c-e1", suit: "spade", rank: "9", blind: false }],
      [{ id: "c-f1", suit: "heart", rank: "10", blind: false }],
    ];
    players.forEach((player, index) => {
      player.hand = hands[index] ?? [];
    });
    room.gameId = "game-e2e-1";
    room.phase = "playing";
    room.currentPlayerId = players[0]?.uid;
    room.openingPlayPending = true;
    room.revision += 1;
    this.log(room, `${players.length}人で対局を開始しました`, "system");
  }

  private submitPlay(
    room: AuthorityRoom,
    member: AuthorityMember,
    payload: Record<string, unknown>,
  ) {
    if (room.currentPlayerId !== member.uid)
      throw new Error("failed-precondition: あなたの手番ではありません");
    const cardIds = payload.cardIds;
    if (!Array.isArray(cardIds) || cardIds.length !== 1 || typeof cardIds[0] !== "string")
      throw new Error("invalid-argument: cardIds");
    const cardIndex = member.hand.findIndex((card) => card.id === cardIds[0]);
    if (cardIndex < 0) throw new Error("permission-denied: 手札にないカードです");
    const card = member.hand[cardIndex]!;
    if (card.blind && payload.blindConfirmed !== true)
      throw new Error("failed-precondition: blind confirmation required");
    if (room.openingPlayPending && (card.suit !== "diamond" || card.rank !== "3")) {
      if (!card.blind)
        throw new Error("failed-precondition: 最初の提出には実物のダイヤ3が必要です");
      member.hand.splice(cardIndex, 1);
      member.status = "disqualified";
      room.discard.push(card, ...member.hand);
      member.hand = [];
      room.rankings.push({ playerId: member.uid, place: 3, reason: "blind_opening_miss" });
      room.currentPlayerId = this.nextPlayer(room, member.uid);
      room.revision += 1;
      this.log(room, `${member.name}はブラインドの初手を外して失格になりました`, "system");
      return;
    }
    member.hand.splice(cardIndex, 1);
    room.field = [card];
    room.fieldPlays.push([card]);
    room.openingPlayPending = false;
    room.revision += 1;
    if (card.blindOutcome === "disqualify") {
      member.status = "disqualified";
      room.discard.push(...member.hand);
      member.hand = [];
      room.rankings.push({ playerId: member.uid, place: 3, reason: "blind_illegal" });
      room.currentPlayerId = this.nextPlayer(room, member.uid);
      this.log(room, `${member.name}はブラインド札の不正手で失格になりました`, "system");
      return;
    }
    this.log(
      room,
      card.blindOutcome === "success"
        ? `${member.name}のブラインド札は有効でした`
        : `${member.name}が${card.suit}${card.rank}を出しました`,
      "play",
    );
    if (card.rank === "A") {
      const target = room.members
        .filter((candidate) => candidate.uid !== member.uid && candidate.role === "player")
        .flatMap((candidate) => candidate.hand)
        .find((candidate) => candidate.id === "c-b2");
      room.phase = "effect";
      room.pendingEffects = [
        {
          id: "effect-steal-1",
          kind: "steal",
          actorId: member.uid,
          requiredCount: 1,
          ...(target ? { eligibleCardIds: [target.id] } : {}),
          message: "相手の手札を1枚奪ってください",
        },
      ];
    } else {
      room.currentPlayerId = this.nextPlayer(room, member.uid);
    }
  }

  private resolveSteal(
    room: AuthorityRoom,
    actor: AuthorityMember,
    payload: Record<string, unknown>,
  ): void {
    const effect = room.pendingEffects.find(
      (pending) => pending.kind === "steal" && pending.actorId === actor.uid,
    );
    if (!effect) throw new Error("failed-precondition: 解決すべき効果がありません");
    const selections = payload.selections;
    if (!Array.isArray(selections) || selections.length !== 1)
      throw new Error("invalid-argument: selections");
    const selection = selections[0] as { targetUid?: unknown; cardId?: unknown };
    if (typeof selection.targetUid !== "string" || typeof selection.cardId !== "string")
      throw new Error("invalid-argument: selection");
    if (!effect.eligibleCardIds?.includes(selection.cardId))
      throw new Error("permission-denied: 対象外のカードです");
    const target = this.member(room, selection.targetUid);
    const cardIndex = target.hand.findIndex((card) => card.id === selection.cardId);
    if (cardIndex < 0) throw new Error("failed-precondition: カードが移動済みです");
    actor.hand.push(target.hand.splice(cardIndex, 1)[0]!);
    room.pendingEffects = [];
    room.phase = "playing";
    room.currentPlayerId = room.hostId;
    room.revision += 1;
    this.log(room, `${actor.name}がA奪いを解決しました`, "effect");
  }

  private applyCommand(uid: string, name: string, payload: Record<string, unknown>): unknown {
    if (name === "createRoom") return this.create(uid, payload);
    if (name === "joinRoomAsPlayer") return this.join(uid, "player", payload);
    if (name === "joinRoomAsSpectator") return this.join(uid, "spectator", payload);
    const room = this.room(payloadString(payload, "roomId"));
    this.assertRevision(room, payload);
    const member = this.member(room, uid);
    if (name === "reconnectRoom") {
      if (payload.reconnectToken !== member.reconnectToken)
        throw new Error("permission-denied: reconnect token is stale");
      if (member.status === "disqualified")
        return { reconnectToken: member.reconnectToken, reconnectOutcome: "expired" };
      member.connection = "online";
      delete member.disconnectedAtMs;
      member.tokenGeneration += 1;
      member.reconnectToken = `reconnect-${uid}-${member.tokenGeneration}`;
      room.revision += 1;
      return { reconnectToken: member.reconnectToken, reconnectOutcome: "restored" };
    }
    if (name === "startGame") {
      this.start(room, uid);
      return {};
    }
    if (name === "submitPlay") {
      this.submitPlay(room, member, payload);
      return {};
    }
    if (name === "submitPass") {
      if (room.currentPlayerId !== uid)
        throw new Error("failed-precondition: あなたの手番ではありません");
      room.currentPlayerId = this.nextPlayer(room, uid);
      room.revision += 1;
      this.log(room, `${member.name}がパスしました`, "pass");
      return {};
    }
    if (name === "resolveSteal") {
      this.resolveSteal(room, member, payload);
      return {};
    }
    if (name === "changeSpectatorFocus") {
      if (member.role !== "spectator" && member.status === "active")
        throw new Error("permission-denied: 観戦者専用です");
      const focusPlayerId = payloadString(payload, "focusPlayerId");
      if (!room.members.some((candidate) => candidate.uid === focusPlayerId))
        throw new Error("invalid-argument: focusPlayerId");
      member.focusPlayerId = focusPlayerId;
      room.revision += 1;
      return {};
    }
    if (name === "sendChat") {
      const text = String(payload.text ?? "")
        .trim()
        .slice(0, 120);
      if (!text) throw new Error("invalid-argument: メッセージを入力してください");
      room.chat.push({
        id: payloadString(payload, "clientActionId"),
        uid,
        name: member.name,
        role: member.role === "spectator" || member.status !== "active" ? "spectator" : "player",
        text,
        atMs: Date.now(),
      });
      room.chat = room.chat.slice(-120);
      room.revision += 1;
      return {};
    }
    if (name === "leaveRoom") {
      room.members = room.members.filter((candidate) => candidate.uid !== uid);
      room.revision += 1;
      return {};
    }
    throw new Error(`unimplemented: ${name}`);
  }

  private command(uid: string, name: string, payload: Record<string, unknown>): unknown {
    const clientActionId = payloadString(payload, "clientActionId");
    this.commandNames.push(name);
    const key = `${uid}:${clientActionId}`;
    const cached = this.processedActions.get(key);
    if (cached) {
      if (cached.name !== name)
        throw new Error("invalid-argument: clientActionId was already used for another command");
      return structuredClone(cached.result);
    }
    const result = this.applyCommand(uid, name, payload);
    this.appliedCommandNames.push(name);
    this.processedActions.set(key, { name, result: structuredClone(result) });
    return result;
  }

  async handle(uid: string, request: BridgeRequest): Promise<unknown> {
    if (request.op === "presence") return {};
    if (request.op === "publicRooms") return this.publicRooms();
    if (request.op === "cueSend") {
      const cue = request.payload?.cue as CueEvent | undefined;
      if (!cue) throw new Error("invalid-argument: cue");
      this.latestCues.set(String(request.roomId), { cue: structuredClone(cue), sender: uid });
      return {};
    }
    if (request.op === "cueLast") {
      return structuredClone(this.latestCues.get(String(request.roomId)) ?? null);
    }
    if (request.op === "roomBase") {
      const room = this.room(String(request.roomId));
      return {
        roomId: room.roomId,
        gameId: room.gameId ?? null,
        expectedRevision: room.revision,
      };
    }
    if (request.op === "roomView") {
      const key = `${String(request.roomId)}:${uid}`;
      if (this.pausedViewers.has(uid)) {
        const cached = this.cachedViews.get(key);
        if (cached) return structuredClone(cached);
      }
      const view = this.projectView(this.room(String(request.roomId)), uid);
      this.cachedViews.set(key, structuredClone(view));
      return view;
    }
    if (request.op === "command")
      return this.command(uid, String(request.name), request.payload ?? {});
    throw new Error(`unknown E2E operation: ${request.op}`);
  }
}
