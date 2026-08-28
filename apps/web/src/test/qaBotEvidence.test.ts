import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultAvatar } from "@daifugo/avatar-schema";
import { checkStateInvariants, type GameLogEntry, type JokerMimic } from "@daifugo/rules";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardView, RoomView } from "../app/model";
import {
  legalCpuCandidates,
  riskFilteredCpuCandidates,
  scoreCpuCandidateTactics,
  type CpuCandidate,
} from "../network/cpuPlayer";
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
  outcomeReward?: number;
  sampleWeight?: number;
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

function candidateLabel(candidate: CpuCandidate): string {
  const cardIds = candidate.cardIds ?? [];
  return `${candidate.commandName}:${cardIds.join(",") || JSON.stringify(candidate.payload)}`;
}

function selectSelfPlayCandidate(
  game: NonNullable<SparkRoomSnapshot["game"]>,
  view: RoomView,
  actorId: string,
  candidates: readonly CpuCandidate[],
  rng: () => number,
): CpuCandidate {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCpuCandidateTactics(game, view, actorId, candidate),
      noise: rng(),
    }))
    .sort((left, right) => right.score - left.score || left.noise - right.noise);
  const exploration = rng();
  const poolSize = Math.min(ranked.length, exploration < 0.08 ? 6 : exploration < 0.22 ? 3 : 1);
  return ranked[Math.floor(rng() * poolSize)]!.candidate;
}

function decisionFor(
  authority: SparkAuthority,
  actorId: string,
  rng: () => number,
):
  | { view: RoomView; candidates: BotCandidate[]; selected: BotCandidate; reason: string }
  | undefined {
  const view = authority.project(actorId);
  const game = authority.exportSnapshot().game;
  if (!game) throw new Error("self-play decision requires an active game");
  const legal = legalCpuCandidates(game, view, actorId);
  const safe = riskFilteredCpuCandidates(legal, game, view);
  if (safe.length === 0) return undefined;
  const selected = selectSelfPlayCandidate(game, view, actorId, safe, rng);
  const candidates = safe.map((candidate) => ({ ...candidate, label: candidateLabel(candidate) }));
  const selectedIndex = safe.indexOf(selected);
  return {
    view,
    candidates,
    selected: candidates[selectedIndex]!,
    reason: "公開情報だけの戦術評価に探索を混ぜ、終局順位で重み付けする自己対局方策。",
  };
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
  blindCount = 3,
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
        settings: { mode: "blind", blindCount },
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
  const decisionRandom = seededRandom(seed ^ 0x9e3779b9);
  for (let sequence = 1; sequence <= 700; sequence += 1) {
    const snapshot = authority.exportSnapshot();
    if (snapshot.status !== "playing" || !snapshot.game) break;
    const actorId =
      snapshot.pendingMimic?.actorUid ??
      snapshot.game.pendingEffect?.actorId ??
      snapshot.game.turnPlayerId;
    if (!actorId) break;
    const decision = decisionFor(authority, actorId, decisionRandom);
    if (!decision) {
      if (!authority.timeoutCurrent(baseNow + 1_000 + sequence * 1_000)) break;
      continue;
    }
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
    if (!record.authorityResult.ok) break;
  }
  const terminal = authority.exportSnapshot();
  for (const decision of decisions) {
    const player = terminal.game?.players.find((candidate) => candidate.id === decision.actorId);
    const rank = player?.rank ?? playerCount;
    const reward =
      player?.status === "disqualified"
        ? -1
        : 1 - (2 * Math.max(0, rank - 1)) / Math.max(1, playerCount - 1);
    decision.outcomeReward = reward;
    decision.sampleWeight = Math.exp(reward * 1.15);
  }
  return {
    matchId,
    seed,
    playerCount,
    mode,
    blindCount: mode === "blind" ? blindCount : 0,
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

  const matchCount = Math.max(24, Number(process.env.CPU_SELFPLAY_MATCHES ?? 24));

  it(
    `runs ${matchCount} real 3-6 player self-play matches and writes decision evidence`,
    () => {
      const matches = Array.from({ length: matchCount }, (_, matchIndex) => {
        const playerCount = 3 + (matchIndex % 4);
        const mode = matchIndex % 2 === 0 ? "normal" : "blind";
        const seed = 31_001 + matchIndex * 17;
        const blindCount = mode === "blind" ? 1 + (Math.floor(matchIndex / 2) % 5) : 0;
        return runMatch(playerCount, mode, seed, matchIndex, blindCount);
      });
      const summary = aggregate(matches);
      const showcase = [...matches].sort(
        (left, right) => showcaseScore(right) - showcaseScore(left),
      )[0]!;
      const bundle: EvidenceBundle = {
        schemaVersion: 1,
        generator: "apps/web/src/test/qaBotEvidence.test.ts",
        replayCommand:
          matchCount === 24
            ? "pnpm ai:selfplay"
            : `CPU_SELFPLAY_MATCHES=${matchCount} pnpm ai:selfplay`,
        deterministicInputs: {
          matchesPerSeatCount: matchCount / 4,
          playerCounts: [3, 4, 5, 6],
          seeds: matches.map((match) => match.seed),
        },
        summary,
        showcaseMatchId: showcase.matchId,
        matches,
      };
      mkdirSync(qaRoot, { recursive: true });
      writeFileSync(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
      writeFileSync(markdownPath, markdown(bundle), "utf8");
      writeFileSync(proofPath, proofMarkdown(bundle), "utf8");

      expect(summary.matches).toBe(matchCount);
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
    },
    Math.max(30_000, matchCount * 2_000),
  );
});
