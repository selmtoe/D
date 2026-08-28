import { defaultAvatar } from "@daifugo/avatar-schema";
import { checkStateInvariants, type GameState } from "@daifugo/rules";
import { describe, expect, it } from "vitest";
import type { RoomView } from "../app/model";
import {
  blindPlaySuccessProbability,
  chooseCpuDecision,
  legalCpuCandidates,
  riskFilteredCpuCandidates,
  type CpuCandidate,
} from "../network/cpuPlayer";
import { cpuPolicyMetadata, scoreCpuCandidates } from "../network/cpuPolicyRuntime";
import { SparkAuthority } from "../network/sparkAuthority";

function profile(name: string) {
  return { name, avatar: structuredClone(defaultAvatar) };
}

function action(id: string) {
  return { clientActionId: id };
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

describe("trained browser CPU policy", () => {
  it("matches the PyTorch checkpoint on a zero-vector reference", () => {
    expect(cpuPolicyMetadata).toMatchObject({
      checkpointSha256: "2dba4efb677c6664ca543b31ce08882dafb7127a6969dd0852dc9486724910f8",
      stateDim: 111,
      actionDim: 59,
      hiddenDim: 128,
      parameterCount: 72_065,
    });
    const scores = scoreCpuCandidates(new Array<number>(111).fill(0), [
      new Array<number>(59).fill(0),
      new Array<number>(59).fill(0),
    ]);
    expect(scores[0]).toBeCloseTo(-1.514478087425232, 5);
    expect(scores[1]).toBeCloseTo(-1.5144782066345215, 5);
  });

  it("lets the NN consider blind plays only when every legal choice is blind", () => {
    const visible: CpuCandidate = {
      kind: "play",
      commandName: "submitPlay",
      payload: { cardIds: ["visible"] },
    };
    const blind: CpuCandidate = {
      kind: "play",
      commandName: "submitPlay",
      payload: { cardIds: ["blind"], blindConfirmed: true },
      authorityJudgedBlind: true,
    };
    const pass: CpuCandidate = { kind: "pass", commandName: "submitPass", payload: {} };

    expect(riskFilteredCpuCandidates([blind, visible, pass])).toEqual([visible, pass]);
    expect(riskFilteredCpuCandidates([blind])).toEqual([blind]);
  });

  it("treats a non-finishing blind singleton on an open field as guaranteed safe", () => {
    const blind: CpuCandidate = {
      kind: "play",
      commandName: "submitPlay",
      payload: { cardIds: ["blind"], blindConfirmed: true },
      authorityJudgedBlind: true,
    };
    const visible: CpuCandidate = {
      kind: "play",
      commandName: "submitPlay",
      payload: { cardIds: ["visible"] },
    };
    const game = { firstPlay: false } as GameState;
    const baseView = {
      firstPlay: false,
      field: [],
      fieldPlays: [],
      discard: [],
      hand: [
        { id: "blind", visibility: "hidden", blind: true },
        { id: "visible", visibility: "face", suit: "heart", rank: "3", blind: false },
      ],
      players: [],
      revolution: false,
      jackBack: false,
      suitLock: [],
    } as unknown as RoomView;

    expect(blindPlaySuccessProbability(game, baseView, blind)).toBe(1);
    expect(riskFilteredCpuCandidates([blind, visible], game, baseView)).toEqual([blind, visible]);
    expect(
      blindPlaySuccessProbability(game, { ...baseView, hand: baseView.hand.slice(0, 1) }, blind),
    ).toBeLessThan(1);
  });

  it("adds/removes host-controlled CPU seats and projects them explicitly", () => {
    const authority = SparkAuthority.create("cpu-room", "host", "peer-host", profile("Host"), 1);
    const response = authority.handleCommand("host", "addCpu", action("add-cpu-1"), 2);
    const cpuUid = String(response.cpuUid);

    expect(authority.exportSnapshot().members[cpuUid]).toMatchObject({
      uid: cpuUid,
      role: "player",
      online: true,
      cpu: true,
      name: "CPU 1",
    });
    expect(authority.project("host").players.find((player) => player.id === cpuUid)?.cpu).toBe(
      true,
    );
    expect(() => authority.setCoordinator(cpuUid, cpuUid, 3)).toThrow(/CPU/);

    authority.handleCommand(
      "host",
      "removeCpu",
      { ...action("remove-cpu-1"), targetUid: cpuUid },
      4,
    );
    expect(authority.exportSnapshot().members[cpuUid]).toBeUndefined();
  });

  it("uses NN-ranked legal choices and advances a mixed match to completion", () => {
    const authority = SparkAuthority.create("cpu-match", "host", "peer-host", profile("Host"), 10);
    authority.handleCommand("host", "addCpu", action("add-cpu-a"), 11);
    authority.handleCommand("host", "addCpu", action("add-cpu-b"), 12);
    authority.handleCommand("host", "startGame", action("start-cpu-match"), 13);

    let observedNeuralDecision = false;
    for (let step = 0; step < 1_000; step += 1) {
      const snapshot = authority.exportSnapshot();
      if (snapshot.status === "finished") break;
      const game = snapshot.game!;
      const actorId =
        snapshot.pendingMimic?.actorUid ?? game.pendingEffect?.actorId ?? game.turnPlayerId;
      expect(actorId).toBeTruthy();
      const member = snapshot.members[actorId!];
      const now = 20 + step;
      if (member?.cpu) {
        const view = authority.project(actorId!);
        const candidates = legalCpuCandidates(game, view, actorId!);
        const decision = chooseCpuDecision(game, view, actorId!);
        if (candidates.length > 0) {
          expect(decision).toBeDefined();
          if (decision?.policy === "nn") observedNeuralDecision = true;
        } else {
          expect(decision).toBeUndefined();
        }
        expect(authority.advanceCpu(now)).toBe(true);
      } else {
        expect(authority.timeoutCurrent(now)).toBe(true);
      }
      const after = authority.exportSnapshot();
      if (after.game) expect(checkStateInvariants(after.game)).toEqual({ valid: true, errors: [] });
    }

    expect(observedNeuralDecision).toBe(true);
    expect(authority.exportSnapshot().status).toBe("finished");
    expect(authority.exportSnapshot().hostUid).toBe("host");
    expect(() =>
      authority.handleCommand("host", "startRematch", action("cpu-rematch"), 2_000),
    ).not.toThrow();
  }, 30_000);

  it("keeps blind self-play disqualifications rare across unseen deals", () => {
    const originalRandom = Math.random;
    let completed = 0;
    let disqualified = 0;
    try {
      for (let match = 0; match < 12; match += 1) {
        let authority = SparkAuthority.create(
          `blind-league-${match}`,
          "host",
          "peer-host",
          profile("Host"),
          match * 10_000,
        );
        for (let cpu = 0; cpu < 3; cpu += 1) {
          authority.handleCommand("host", "addCpu", action(`blind-${match}-cpu-${cpu}`), cpu + 1);
        }
        authority.handleCommand(
          "host",
          "updateRoomSettings",
          {
            ...action(`blind-${match}-settings`),
            settings: { mode: "blind", blindCount: 5 },
          },
          10,
        );
        Math.random = seededRandom(91_000 + match);
        authority.handleCommand("host", "startGame", action(`blind-${match}-start`), 20);
        const snapshot = authority.exportSnapshot();
        snapshot.members.host!.cpu = true;
        authority = SparkAuthority.restore(snapshot);

        for (let step = 0; step < 2_000; step += 1) {
          if (authority.exportSnapshot().status === "finished") break;
          expect(authority.advanceCpu(100 + step)).toBe(true);
        }
        const terminal = authority.exportSnapshot();
        if (terminal.status === "finished") completed += 1;
        disqualified +=
          terminal.game?.players.filter((player) => player.status === "disqualified").length ?? 0;
        if (terminal.game) {
          expect(checkStateInvariants(terminal.game)).toEqual({ valid: true, errors: [] });
        }
      }
    } finally {
      Math.random = originalRandom;
    }
    expect(completed).toBeGreaterThanOrEqual(10);
    expect(disqualified).toBeLessThanOrEqual(2);
  }, 30_000);
});
