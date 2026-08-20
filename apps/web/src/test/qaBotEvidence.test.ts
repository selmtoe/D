import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultAvatar } from "@daifugo/avatar-schema";
import {
  RANKS,
  checkStateInvariants,
  validatePlayForState,
  type GameLogEntry,
  type JokerMimic,
  type PhysicalRank,
} from "@daifugo/rules";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardView, PendingEffectView, RoomView } from "../app/model";
import { SparkAuthority, type SparkRoomSnapshot } from "../network/sparkAuthority";

type BotCandidate = {
  kind: "play" | "pass" | "effect" | "joker-mimic";
  label: string;
  cardIds?: string[];
  mimics?: JokerMimic[];
  commandName: string;
  payload: Record<string, unknown>;
  authorityJudgedBlind?: boolean;
};

type Observation = {
  phase: RoomView["phase"];
  revision: number;
  gameId?: string;
  currentPlayerId?: string;
  field: string[];
  hand: { count: number; visible: string[]; hiddenPositions: string[] };
  players: Array<{ id: string; status: string; cardCount: number }>;
  pendingEffects: Array<{ kind: string; actorId: string; requiredCount: number }>;
  pendingJokerMimic?: { cardIds: string[]; candidateCount: number; revealed: string[] };
  ruleFlags: {
    revolution: boolean;
    jackBack: boolean;
    direction: 1 | -1;
    suitLock: string[];
  };
};

type DecisionRecord = {
  sequence: number;
  actorId: string;
  observation: Observation;
  legalCandidates: BotCandidate[];
  selected: BotCandidate;
  selectionReason: string;
  sentCommand: { name: string; payload: Record<string, unknown> };
  authorityResult: { ok: boolean; response?: Record<string, unknown>; error?: string };
  authorityEvents: {
    publicLog: SparkRoomSnapshot["socialLog"];
    ruleLog: GameLogEntry[];
  };
  appliedVerification: {
    revisionBefore: number;
    revisionAfter: number;
    gameVersionBefore: number;
    gameVersionAfter: number;
    actionRecorded: boolean;
    invariantValid: boolean;
    actorHandBefore: number;
    actorHandAfter: number;
    actorStatusBefore?: string;
    actorStatusAfter?: string;
    pileCardIdsBefore: string[];
    pileCardIdsAfter: string[];
    pendingEffectAfter?: string;
    pendingJokerMimicAfter: boolean;
  };
  auditTags: string[];
};

type MatchEvidence = {
  matchId: string;
  seed: number;
  playerCount: number;
  mode: "normal" | "blind";
  blindCount: number;
  completed: boolean;
  terminalStatus: SparkRoomSnapshot["status"];
  rankings: RoomView["rankings"];
  decisions: DecisionRecord[];
  stats: {
    commands: number;
    accepted: number;
    rejected: number;
    plays: number;
    passes: number;
    effectResolutions: number;
    stealResolutions: number;
    blindAttempts: number;
    blindDisqualifications: number;
    jokerSubmissions: number;
    jokerMimicDeclarations: number;
    finishes: number;
    invariantFailures: number;
  };
};

type EvidenceBundle = {
  schemaVersion: 1;
  generator: string;
  replayCommand: string;
  deterministicInputs: { matchesPerSeatCount: number; playerCounts: number[]; seeds: number[] };
  summary: {
    matches: number;
    completed: number;
    stalled: number;
    commands: number;
    accepted: number;
    rejected: number;
    plays: number;
    passes: number;
    effectResolutions: number;
    stealResolutions: number;
    blindAttempts: number;
    blindDisqualifications: number;
    jokerSubmissions: number;
    jokerMimicDeclarations: number;
    finishes: number;
    invariantFailures: number;
  };
  showcaseMatchId: string;
  matches: MatchEvidence[];
};

const rankPriority: PhysicalRank[] = [
  "A",
  "Q",
  "10",
  "K",
  "7",
  "8",
  "J",
  "4",
  "5",
  "6",
  "9",
  "3",
  "2",
  "JOKER",
];

const qaRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../artifacts/qa");
const jsonPath = resolve(qaRoot, "bot-match-evidence.json");
const markdownPath = resolve(qaRoot, "bot-match-evidence.md");
const proofPath = resolve(qaRoot, "bot-match-proof.md");
const originalMathRandom = Math.random;
let uuidCounter = 0;

function deterministicUuid(): `${string}-${string}-${string}-${string}-${string}` {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let sample = value;
    sample = Math.imul(sample ^ (sample >>> 15), sample | 1);
    sample ^= sample + Math.imul(sample ^ (sample >>> 7), sample | 61);
    return ((sample ^ (sample >>> 14)) >>> 0) / 4294967296;
  };
}

function profile(name: string) {
  return { name, avatar: structuredClone(defaultAvatar) };
}

function cardLabel(card: CardView): string {
  if (card.visibility === "hidden") return `blind-position(${card.id})`;
  if (card.joker) return `${card.blind ? "blind-revealed:" : ""}JOKER(${card.id})`;
  return `${card.blind ? "blind-revealed:" : ""}${card.suit}-${card.rank}(${card.id})`;
}

function observe(view: RoomView): Observation {
  return {
    phase: view.phase,
    revision: view.revision,
    ...(view.gameId ? { gameId: view.gameId } : {}),
    ...(view.currentPlayerId ? { currentPlayerId: view.currentPlayerId } : {}),
    field: view.field.map(cardLabel),
    hand: {
      count: view.hand.length,
      visible: view.hand.filter((card) => card.visibility === "face").map(cardLabel),
      hiddenPositions: view.hand
        .filter((card) => card.visibility === "hidden")
        .map((card) => card.id),
    },
    players: view.players.map((player) => ({
      id: player.id,
      status: player.status,
      cardCount: player.cardCount,
    })),
    pendingEffects: view.pendingEffects.map((effect) => ({
      kind: effect.kind,
      actorId: effect.actorId,
      requiredCount: effect.requiredCount,
    })),
    ...(view.pendingJokerMimic
      ? {
          pendingJokerMimic: {
            cardIds: [...view.pendingJokerMimic.cardIds],
            candidateCount: view.pendingJokerMimic.candidates.length,
            revealed: (view.pendingJokerMimic.revealedCards ?? []).map(cardLabel),
          },
        }
      : {}),
    ruleFlags: {
      revolution: view.revolution,
      jackBack: view.jackBack,
      direction: view.direction,
      suitLock: [...view.suitLock],
    },
  };
}

function validVisiblePlay(
  snapshot: SparkRoomSnapshot,
  actorId: string,
  cardIds: string[],
  mimics: JokerMimic[] = [],
): boolean {
  if (!snapshot.game) return false;
  try {
    validatePlayForState(snapshot.game, actorId, cardIds, mimics);
    return true;
  } catch {
    return false;
  }
}

function playCandidates(
  authority: SparkAuthority,
  actorId: string,
  view: RoomView,
  allowBlindPair: boolean,
): BotCandidate[] {
  const snapshot = authority.exportSnapshot();
  const visible = view.hand.filter((card) => card.visibility === "face");
  const hidden = view.hand.filter((card) => card.visibility === "hidden");
  const candidates: BotCandidate[] = [];
  const pushPlay = (
    label: string,
    cardIds: string[],
    mimics: JokerMimic[] = [],
    authorityJudgedBlind = false,
  ) => {
    candidates.push({
      kind: "play",
      label,
      cardIds,
      mimics,
      commandName: "submitPlay",
      payload: { cardIds, mimics, blindConfirmed: authorityJudgedBlind },
      ...(authorityJudgedBlind ? { authorityJudgedBlind: true } : {}),
    });
  };

  for (const card of visible) {
    if (validVisiblePlay(snapshot, actorId, [card.id])) pushPlay(cardLabel(card), [card.id]);
  }

  const normalsByRank = new Map<string, CardView[]>();
  const visibleJokers = visible.filter((card) => card.visibility === "face" && Boolean(card.joker));
  for (const card of visible) {
    if (card.visibility !== "face" || card.joker || !card.rank) continue;
    normalsByRank.set(card.rank, [...(normalsByRank.get(card.rank) ?? []), card]);
  }
  for (const cards of normalsByRank.values()) {
    for (let count = 2; count <= cards.length; count += 1) {
      const selected = cards.slice(0, count);
      const ids = selected.map((card) => card.id);
      if (validVisiblePlay(snapshot, actorId, ids))
        pushPlay(`visible-group:${selected.map(cardLabel).join("+")}`, ids);
    }
    const normal = cards[0];
    if (!normal || normal.visibility !== "face" || !normal.rank || !normal.suit) continue;
    for (const joker of visibleJokers) {
      const ids = [normal.id, joker.id];
      const mimics: JokerMimic[] = [{ cardId: joker.id, suit: normal.suit, rank: normal.rank }];
      if (validVisiblePlay(snapshot, actorId, ids, mimics))
        pushPlay(`visible-joker-group:${cardLabel(normal)}+${cardLabel(joker)}`, ids, mimics);
    }
  }
  if (visibleJokers.length >= 2) {
    const ids = visibleJokers.slice(0, 2).map((card) => card.id);
    if (validVisiblePlay(snapshot, actorId, ids)) pushPlay("raw-joker-pair", ids);
  }

  for (const card of hidden) {
    pushPlay(`blind-single:${card.id}`, [card.id], [], true);
  }
  if (
    allowBlindPair &&
    !snapshot.game?.firstPlay &&
    snapshot.game?.pile === null &&
    hidden[0] &&
    visible.find((card) => !card.joker)
  ) {
    const partner = visible.find((card) => !card.joker)!;
    pushPlay(
      `blind-unknown-pair:${hidden[0].id}+${cardLabel(partner)}`,
      [hidden[0].id, partner.id],
      [],
      true,
    );
  }
  if (view.field.length > 0) {
    candidates.push({
      kind: "pass",
      label: "pass:場に札があるため合法",
      commandName: "submitPass",
      payload: {},
    });
  }
  return candidates;
}

function effectCandidate(view: RoomView, effect: PendingEffectView): BotCandidate {
  const eligibleIds = new Set(effect.eligibleCardIds ?? []);
  const eligiblePlayers = new Set(effect.eligiblePlayerIds ?? []);
  if (effect.kind === "steal") {
    const selections = view.players
      .filter((player) => player.id !== effect.actorId && eligiblePlayers.has(player.id))
      .flatMap((player) =>
        (player.cards ?? [])
          .filter((card) => eligibleIds.has(card.id))
          .map((card) => ({ targetUid: player.id, cardId: card.id })),
      )
      .slice(0, effect.requiredCount);
    return {
      kind: "effect",
      label: `A奪い:${selections.map((item) => `${item.targetUid}/${item.cardId}`).join(",")}`,
      commandName: "resolveSteal",
      payload: { selections },
    };
  }
  if (effect.kind === "give") {
    const targetUid = view.players.find(
      (player) => player.id !== effect.actorId && eligiblePlayers.has(player.id),
    )?.id;
    const transfers = targetUid
      ? view.hand
          .filter((card) => eligibleIds.has(card.id))
          .slice(0, effect.requiredCount)
          .map((card) => ({ targetUid, cardId: card.id }))
      : [];
    return {
      kind: "effect",
      label: `7渡し:${transfers.map((item) => item.cardId).join(",")}→${targetUid ?? "none"}`,
      commandName: "resolveGive",
      payload: { transfers },
    };
  }
  if (effect.kind === "discard") {
    const cardIds = view.hand
      .filter((card) => eligibleIds.has(card.id))
      .slice(0, effect.requiredCount)
      .map((card) => card.id);
    return {
      kind: "effect",
      label: `10捨て:${cardIds.join(",")}`,
      commandName: "resolveDiscard",
      payload: { cardIds },
    };
  }
  if (effect.kind === "collect") {
    const cardIds = view.discard
      .filter((card) => eligibleIds.has(card.id))
      .slice(0, effect.requiredCount)
      .map((card) => card.id);
    return {
      kind: "effect",
      label: `K回収:${cardIds.join(",")}`,
      commandName: "resolveCollect",
      payload: { cardIds },
    };
  }
  const ranks = ([...RANKS, "JOKER"] as PhysicalRank[]).slice(0, effect.requiredCount);
  return {
    kind: "effect",
    label: `Qボンバー:${ranks.join(",")}`,
    commandName: "resolveBomber",
    payload: { ranks: ranks.map((rank) => (rank === "JOKER" ? "Joker" : rank)) },
  };
}

function choosePlay(
  candidates: BotCandidate[],
  view: RoomView,
  allowBlindPair: boolean,
): { selected: BotCandidate; reason: string } {
  const plays = candidates.filter((candidate) => candidate.kind === "play");
  const blindPair = plays.find((candidate) => candidate.label.startsWith("blind-unknown-pair"));
  if (allowBlindPair && blindPair) {
    return {
      selected: blindPair,
      reason:
        "場が空なので、所有者からは未知のblind位置と表向き札の組を試す。authorityが公開後に合法性または失格を確定する。",
    };
  }
  if (view.field.length === 0) {
    const effectPlay = rankPriority
      .map((rank) =>
        plays.find((candidate) =>
          rank === "JOKER"
            ? candidate.label.includes("JOKER")
            : candidate.label.includes(`-${rank}(`),
        ),
      )
      .find(Boolean);
    if (effectPlay)
      return {
        selected: effectPlay,
        reason: "場が空なので、特殊効果またはJokerを実地検証できる合法候補を優先した。",
      };
  }
  const facePlay = plays.find((candidate) => !candidate.authorityJudgedBlind);
  if (facePlay)
    return {
      selected: facePlay,
      reason: "観測できる表面だけでrules validationを通過した先頭の合法候補を選んだ。",
    };
  const blindPlay = plays.find((candidate) => candidate.authorityJudgedBlind);
  if (blindPlay)
    return {
      selected: blindPlay,
      reason: "表向き合法手がないためblind位置を選び、不可逆確認付きでauthority判定へ送る。",
    };
  const pass = candidates.find((candidate) => candidate.kind === "pass");
  if (!pass) throw new Error("bot has neither a play nor a legal pass");
  return { selected: pass, reason: "場に勝てる観測可能候補がないため合法なパスを選んだ。" };
}

function decisionFor(
  authority: SparkAuthority,
  actorId: string,
  attemptedBlindRisk: boolean,
): { view: RoomView; candidates: BotCandidate[]; selected: BotCandidate; reason: string } {
  const view = authority.project(actorId);
  if (view.pendingJokerMimic) {
    const mimics = view.pendingJokerMimic.candidates[0] ?? [];
    const candidate: BotCandidate = {
      kind: "joker-mimic",
      label: `blind Joker擬態:${mimics.map((item) => `${item.suit}-${item.rank}`).join(",")}`,
      commandName: "declareJokerMimic",
      payload: { mimics, blindConfirmed: true },
    };
    return {
      view,
      candidates: view.pendingJokerMimic.candidates.map((items) => ({
        kind: "joker-mimic",
        label: items.map((item) => `${item.suit}-${item.rank}`).join(","),
        commandName: "declareJokerMimic",
        payload: { mimics: items, blindConfirmed: true },
      })),
      selected: candidate,
      reason: "authorityが公開後に提示した合法擬態候補の先頭を決定論的に選んだ。",
    };
  }
  const effect = view.pendingEffects.find((candidate) => candidate.actorId === actorId);
  if (effect) {
    const candidate = effectCandidate(view, effect);
    return {
      view,
      candidates: [candidate],
      selected: candidate,
      reason: `${effect.kind}のrequiredCount=${effect.requiredCount}を満たす観測可能な対象を先頭から選んだ。`,
    };
  }
  const candidates = playCandidates(authority, actorId, view, !attemptedBlindRisk);
  const choice = choosePlay(candidates, view, !attemptedBlindRisk);
  return { view, candidates, selected: choice.selected, reason: choice.reason };
}

function executeDecision(
  authority: SparkAuthority,
  matchId: string,
  sequence: number,
  actorId: string,
  view: RoomView,
  candidates: BotCandidate[],
  selected: BotCandidate,
  reason: string,
  now: number,
): DecisionRecord {
  const before = authority.exportSnapshot();
  const actionId = `${matchId}-action-${String(sequence).padStart(4, "0")}`;
  const payload = {
    roomId: view.roomId,
    gameId: view.gameId,
    expectedRevision: view.revision,
    ...selected.payload,
    clientActionId: actionId,
  };
  let response: Record<string, unknown> | undefined;
  let error: string | undefined;
  try {
    response = authority.handleCommand(actorId, selected.commandName, payload, now);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const after = authority.exportSnapshot();
  const invariant = after.game ? checkStateInvariants(after.game) : { valid: true, errors: [] };
  const actorBefore = before.game?.players.find((player) => player.id === actorId);
  const actorAfter = after.game?.players.find((player) => player.id === actorId);
  const selectedEntries = selected.cardIds?.flatMap((cardId) => {
    const entry = actorBefore?.hand.find((candidate) => candidate.card.id === cardId);
    return entry ? [entry] : [];
  });
  const auditTags = [
    selected.kind === "effect" ? `effect:${selected.commandName}` : selected.kind,
    ...(selectedEntries?.some((entry) => entry.blind) ? ["blind-attempt"] : []),
    ...(selectedEntries?.some((entry) => entry.card.rank === "JOKER") ? ["joker-submission"] : []),
    ...(actorBefore?.status === "active" && actorAfter?.status === "disqualified"
      ? ["blind-disqualification"]
      : []),
    ...(selected.kind === "joker-mimic" ? ["blind-joker-mimic"] : []),
    ...(after.game?.players.some(
      (player, index) =>
        player.status === "finished" && before.game?.players[index]?.status === "active",
    )
      ? ["finish"]
      : []),
  ];
  return {
    sequence,
    actorId,
    observation: observe(view),
    legalCandidates: candidates,
    selected,
    selectionReason: reason,
    sentCommand: { name: selected.commandName, payload },
    authorityResult: error ? { ok: false, error } : { ok: true, response: response ?? {} },
    authorityEvents: {
      publicLog: after.socialLog.slice(before.socialLog.length),
      ruleLog: (after.game?.log ?? []).slice(before.game?.log.length ?? 0),
    },
    appliedVerification: {
      revisionBefore: before.revision,
      revisionAfter: after.revision,
      gameVersionBefore: before.game?.version ?? -1,
      gameVersionAfter: after.game?.version ?? -1,
      actionRecorded: after.appliedRoomActionIds.includes(actionId),
      invariantValid: invariant.valid,
      actorHandBefore: actorBefore?.hand.length ?? 0,
      actorHandAfter: actorAfter?.hand.length ?? 0,
      ...(actorBefore ? { actorStatusBefore: actorBefore.status } : {}),
      ...(actorAfter ? { actorStatusAfter: actorAfter.status } : {}),
      pileCardIdsBefore: before.game?.pile?.cards.map((card) => card.card.id) ?? [],
      pileCardIdsAfter: after.game?.pile?.cards.map((card) => card.card.id) ?? [],
      ...(after.game?.pendingEffect ? { pendingEffectAfter: after.game.pendingEffect.type } : {}),
      pendingJokerMimicAfter: Boolean(after.pendingMimic),
    },
    auditTags,
  };
}

function statsFor(
  decisions: DecisionRecord[],
  snapshot: SparkRoomSnapshot,
): MatchEvidence["stats"] {
  return {
    commands: decisions.length,
    accepted: decisions.filter((record) => record.authorityResult.ok).length,
    rejected: decisions.filter((record) => !record.authorityResult.ok).length,
    plays: decisions.filter((record) => record.sentCommand.name === "submitPlay").length,
    passes: decisions.filter((record) => record.sentCommand.name === "submitPass").length,
    effectResolutions: decisions.filter((record) => record.selected.kind === "effect").length,
    stealResolutions: decisions.filter((record) => record.sentCommand.name === "resolveSteal")
      .length,
    blindAttempts: decisions.filter((record) => record.auditTags.includes("blind-attempt")).length,
    blindDisqualifications: decisions.filter((record) =>
      record.auditTags.includes("blind-disqualification"),
    ).length,
    jokerSubmissions: decisions.filter((record) => record.auditTags.includes("joker-submission"))
      .length,
    jokerMimicDeclarations: decisions.filter((record) =>
      record.auditTags.includes("blind-joker-mimic"),
    ).length,
    finishes: snapshot.game?.players.filter((player) => player.status === "finished").length ?? 0,
    invariantFailures: decisions.filter((record) => !record.appliedVerification.invariantValid)
      .length,
  };
}

function runMatch(
  playerCount: number,
  mode: "normal" | "blind",
  seed: number,
  matchIndex: number,
): MatchEvidence {
  const matchId = `${mode}-${playerCount}p-seed-${seed}`;
  const playerIds = Array.from({ length: playerCount }, (_, index) => `bot-${index + 1}`);
  const baseNow = 1_700_000_000_000 + matchIndex * 1_000_000;
  const authority = SparkAuthority.create(
    `Q${String(matchIndex).padStart(4, "0")}`,
    playerIds[0]!,
    `peer-${playerIds[0]}`,
    profile("Bot 1"),
    baseNow,
  );
  playerIds.slice(1).forEach((playerId, index) =>
    authority.join(
      {
        uid: playerId,
        peerId: `peer-${playerId}`,
        profile: profile(`Bot ${index + 2}`),
        role: "player",
      },
      baseNow + index + 1,
    ),
  );
  if (mode === "blind") {
    authority.handleCommand(
      playerIds[0]!,
      "updateRoomSettings",
      {
        clientActionId: `${matchId}-settings`,
        expectedRevision: authority.exportSnapshot().revision,
        settings: { mode: "blind", blindCount: 3 },
      },
      baseNow + 100,
    );
  }
  Math.random = seededRandom(seed);
  try {
    authority.handleCommand(
      playerIds[0]!,
      "startGame",
      {
        clientActionId: `${matchId}-start`,
        expectedRevision: authority.exportSnapshot().revision,
      },
      baseNow + 200,
    );
  } finally {
    Math.random = originalMathRandom;
  }

  const decisions: DecisionRecord[] = [];
  const attemptedBlindRisk = new Set<string>();
  for (let sequence = 1; sequence <= 700; sequence += 1) {
    const snapshot = authority.exportSnapshot();
    if (snapshot.status !== "playing" || !snapshot.game) break;
    const actorId =
      snapshot.pendingMimic?.actorUid ??
      snapshot.game.pendingEffect?.actorId ??
      snapshot.game.turnPlayerId;
    if (!actorId) break;
    const decision = decisionFor(authority, actorId, attemptedBlindRisk.has(actorId));
    const record = executeDecision(
      authority,
      matchId,
      sequence,
      actorId,
      decision.view,
      decision.candidates,
      decision.selected,
      decision.reason,
      baseNow + 1_000 + sequence * 1_000,
    );
    decisions.push(record);
    if (decision.selected.label.startsWith("blind-unknown-pair")) attemptedBlindRisk.add(actorId);
    if (!record.authorityResult.ok) break;
  }
  const terminal = authority.exportSnapshot();
  return {
    matchId,
    seed,
    playerCount,
    mode,
    blindCount: mode === "blind" ? 3 : 0,
    completed: terminal.status === "finished",
    terminalStatus: terminal.status,
    rankings: authority.project(playerIds[0]!).rankings,
    decisions,
    stats: statsFor(decisions, terminal),
  };
}

function aggregate(matches: MatchEvidence[]): EvidenceBundle["summary"] {
  const sum = (key: keyof MatchEvidence["stats"]) =>
    matches.reduce((total, match) => total + match.stats[key], 0);
  return {
    matches: matches.length,
    completed: matches.filter((match) => match.completed).length,
    stalled: matches.filter((match) => !match.completed).length,
    commands: sum("commands"),
    accepted: sum("accepted"),
    rejected: sum("rejected"),
    plays: sum("plays"),
    passes: sum("passes"),
    effectResolutions: sum("effectResolutions"),
    stealResolutions: sum("stealResolutions"),
    blindAttempts: sum("blindAttempts"),
    blindDisqualifications: sum("blindDisqualifications"),
    jokerSubmissions: sum("jokerSubmissions"),
    jokerMimicDeclarations: sum("jokerMimicDeclarations"),
    finishes: sum("finishes"),
    invariantFailures: sum("invariantFailures"),
  };
}

function showcaseScore(match: MatchEvidence): number {
  return (
    (match.completed ? 100 : 0) +
    match.stats.jokerMimicDeclarations * 80 +
    match.stats.stealResolutions * 40 +
    match.stats.effectResolutions * 5 +
    match.stats.blindAttempts * 2
  );
}

function markdown(bundle: EvidenceBundle): string {
  const showcase = bundle.matches.find((match) => match.matchId === bundle.showcaseMatchId)!;
  const lines = [
    "# 大富豪 bot実対局QA証拠",
    "",
    "この証拠は`SparkAuthority.handleCommand`を通し、各遷移後に`checkStateInvariants`で検証した決定論的bot対局から生成しています。botの観測欄には`RoomView`投影だけを使用し、所有者のblind札の表面は記録していません。",
    "",
    `再実行: \`${bundle.replayCommand}\``,
    "",
    "## 全対局統計",
    "",
    "```json",
    JSON.stringify(bundle.summary, null, 2),
    "```",
    "",
    "## 対局一覧",
    "",
    "| match | 人数 | mode | 完了 | command | rejected | effect | A奪い | blind | Joker | mimic |",
    "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...bundle.matches.map(
      (match) =>
        `| ${match.matchId} | ${match.playerCount} | ${match.mode} | ${match.completed ? "yes" : "no"} | ${match.stats.commands} | ${match.stats.rejected} | ${match.stats.effectResolutions} | ${match.stats.stealResolutions} | ${match.stats.blindAttempts} | ${match.stats.jokerSubmissions} | ${match.stats.jokerMimicDeclarations} |`,
    ),
    "",
    `## 人が読む詳細証拠: ${showcase.matchId}`,
    "",
    `- seed: ${showcase.seed}`,
    `- players: ${showcase.playerCount}`,
    `- mode: ${showcase.mode} / blindCount ${showcase.blindCount}`,
    `- terminal: ${showcase.terminalStatus}`,
    `- rankings: ${JSON.stringify(showcase.rankings)}`,
    "",
  ];
  for (const record of showcase.decisions) {
    lines.push(
      `### 手番/効果 ${record.sequence}: ${record.actorId}`,
      "",
      "観測した場・手札要約:",
      "",
      "```json",
      JSON.stringify(record.observation, null, 2),
      "```",
      "",
      "合法候補（blind候補は表面未知のためauthority判定対象）:",
      "",
      ...record.legalCandidates.map((candidate) => `- ${candidate.label}`),
      "",
      `選択理由: ${record.selectionReason}`,
      "",
      "送信command:",
      "",
      "```json",
      JSON.stringify(record.sentCommand, null, 2),
      "```",
      "",
      "authority結果・event:",
      "",
      "```json",
      JSON.stringify(
        { result: record.authorityResult, events: record.authorityEvents, tags: record.auditTags },
        null,
        2,
      ),
      "```",
      "",
      "本当に適用されたか:",
      "",
      "```json",
      JSON.stringify(record.appliedVerification, null, 2),
      "```",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function proofMarkdown(bundle: EvidenceBundle): string {
  const records = bundle.matches.flatMap((match) =>
    match.decisions.map((record) => ({ match, record })),
  );
  const examples = [
    {
      label: "通常play",
      value: records.find(
        ({ match, record }) =>
          match.mode === "normal" &&
          record.sentCommand.name === "submitPlay" &&
          !record.auditTags.includes("blind-attempt"),
      ),
    },
    {
      label: "A奪い",
      value: records.find(({ record }) => record.sentCommand.name === "resolveSteal"),
    },
    {
      label: "blind authority判定",
      value: records.find(({ record }) => record.auditTags.includes("blind-attempt")),
    },
  ].filter(
    (example): example is { label: string; value: (typeof records)[number] } =>
      example.value !== undefined,
  );
  const lines = [
    "# 大富豪 bot実対局QA — 短い証拠",
    "",
    "実`SparkAuthority.handleCommand`と`@daifugo/rules`を通した決定論的対局の抜粋です。完全履歴はgit管理外の`bot-match-evidence.json` / `.md`へ同じテストから再生成できます。",
    "",
    `再実行: \`${bundle.replayCommand}\``,
    "",
    "## 統計",
    "",
    "```json",
    JSON.stringify(bundle.summary, null, 2),
    "```",
    "",
    "## 対局一覧",
    "",
    "| match | 人数 | mode | 完了 | command | rejected | 効果 | A奪い | blind | Joker |",
    "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...bundle.matches.map(
      (match) =>
        `| ${match.matchId} | ${match.playerCount} | ${match.mode} | ${match.completed ? "yes" : "no"} | ${match.stats.commands} | ${match.stats.rejected} | ${match.stats.effectResolutions} | ${match.stats.stealResolutions} | ${match.stats.blindAttempts} | ${match.stats.jokerSubmissions} |`,
    ),
    "",
    "## 代表判断",
    "",
  ];
  for (const example of examples) {
    const { match, record } = example.value;
    lines.push(
      `### ${example.label}: ${match.matchId} / #${record.sequence} / ${record.actorId}`,
      "",
      `- 観測: field=${JSON.stringify(record.observation.field)}, hand=${JSON.stringify(record.observation.hand)}, flags=${JSON.stringify(record.observation.ruleFlags)}`,
      `- 合法候補: ${record.legalCandidates.map((candidate) => candidate.label).join(" / ")}`,
      `- 選択理由: ${record.selectionReason}`,
      `- 送信command: \`${JSON.stringify(record.sentCommand)}\``,
      `- authority結果: \`${JSON.stringify(record.authorityResult)}\``,
      `- event: \`${JSON.stringify(record.authorityEvents)}\``,
      `- 適用確認: \`${JSON.stringify(record.appliedVerification)}\``,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

describe("reproducible Spark/rules bot match evidence", () => {
  beforeAll(() => {
    uuidCounter = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(deterministicUuid);
  });

  afterAll(() => {
    Math.random = originalMathRandom;
    vi.restoreAllMocks();
  });

  it("runs 24 real 3-6 player matches and writes decision evidence", () => {
    const seeds = [3101, 3102, 3103, 3104, 3105, 3106];
    const matches = [3, 4, 5, 6].flatMap((playerCount, playerIndex) =>
      seeds.map((seed, seedIndex) =>
        runMatch(
          playerCount,
          seedIndex % 2 === 0 ? "normal" : "blind",
          seed + playerIndex * 100,
          playerIndex * seeds.length + seedIndex,
        ),
      ),
    );
    const summary = aggregate(matches);
    const showcase = [...matches].sort(
      (left, right) => showcaseScore(right) - showcaseScore(left),
    )[0]!;
    const bundle: EvidenceBundle = {
      schemaVersion: 1,
      generator: "apps/web/src/test/qaBotEvidence.test.ts",
      replayCommand: "pnpm --filter @daifugo/web exec vitest run src/test/qaBotEvidence.test.ts",
      deterministicInputs: { matchesPerSeatCount: seeds.length, playerCounts: [3, 4, 5, 6], seeds },
      summary,
      showcaseMatchId: showcase.matchId,
      matches,
    };
    mkdirSync(qaRoot, { recursive: true });
    writeFileSync(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    writeFileSync(markdownPath, markdown(bundle), "utf8");
    writeFileSync(proofPath, proofMarkdown(bundle), "utf8");

    expect(summary.matches).toBe(24);
    expect(summary.commands).toBeGreaterThan(200);
    expect(summary.accepted).toBe(summary.commands);
    expect(summary.rejected).toBe(0);
    expect(summary.invariantFailures).toBe(0);
    expect(summary.completed).toBeGreaterThan(12);
    expect(summary.effectResolutions).toBeGreaterThan(0);
    expect(summary.stealResolutions).toBeGreaterThan(0);
    expect(summary.blindAttempts).toBeGreaterThan(0);
    expect(summary.jokerSubmissions).toBeGreaterThan(0);
    expect(
      matches.some((match) =>
        match.decisions.some((record) => record.auditTags.includes("finish")),
      ),
    ).toBe(true);
  }, 30_000);
});
