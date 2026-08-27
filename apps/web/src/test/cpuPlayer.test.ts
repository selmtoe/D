import { defaultAvatar } from "@daifugo/avatar-schema";
import { checkStateInvariants } from "@daifugo/rules";
import { describe, expect, it } from "vitest";
import {
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

describe("trained browser CPU policy", () => {
  it("matches the PyTorch checkpoint on a zero-vector reference", () => {
    expect(cpuPolicyMetadata).toMatchObject({
      checkpointSha256: "43ea62ac3fbd4c8583cc2c2517a45eb903f2bf5dbbf82e6b03f641565f0b5c64",
      stateDim: 111,
      actionDim: 59,
      hiddenDim: 96,
      parameterCount: 44_833,
    });
    const scores = scoreCpuCandidates(new Array<number>(111).fill(0), [
      new Array<number>(59).fill(0),
      new Array<number>(59).fill(0),
    ]);
    expect(scores[0]).toBeCloseTo(-1.543562650680542, 5);
    expect(scores[1]).toBeCloseTo(-1.543562650680542, 5);
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
        expect(candidates.length).toBeGreaterThan(0);
        const decision = chooseCpuDecision(game, view, actorId!);
        expect(decision).toBeDefined();
        if (decision?.policy === "nn") observedNeuralDecision = true;
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
  });
});
