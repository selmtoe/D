import { createInitialGameState, type RecoverEffect } from "@daifugo/rules";
import { describe, expect, test } from "vitest";
import { disqualifyAfterResolvingEffects } from "../src/game/rules-adapter.js";

describe("disconnect forced-effect recovery", () => {
  test("resolves every pending effect owned by the disconnecting actor before disqualification", () => {
    const state = createInitialGameState(["alice", "bob", "carol"], {
      gameId: "disconnect-test",
      rng: () => 0.25,
    });
    const recovered = state.players[1]!.hand.pop()!;
    state.discard.push(recovered.card);
    const effect: RecoverEffect = {
      id: "effect-recover",
      type: "recover",
      actorId: "alice",
      count: 1,
    };
    state.pendingEffect = effect;
    state.effectBatch = {
      actorId: "alice",
      playId: "play-before-disconnect",
      effects: [effect],
      nextEffectIndex: 1,
      skipCount: 0,
      flushReason: null,
    };

    const result = disqualifyAfterResolvingEffects(
      state,
      "alice",
      "disconnect",
      "disconnect-action",
      10_000,
    );

    expect(result.state.pendingEffect).toBeNull();
    expect(result.state.players.find((player) => player.id === "alice")?.status).toBe(
      "disqualified",
    );
    expect(result.state.appliedActionIds).toContain("disconnect-action_effect_0");
    expect(result.state.appliedActionIds).toContain("disconnect-action_disqualify");
  });
});
