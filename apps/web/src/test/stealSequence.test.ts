import { describe, expect, it } from "vitest";
import { shuffleStealCandidates } from "../screens/StealSequence";

describe("A-steal presentation shuffle", () => {
  it("is deterministic, preserves all candidates, and does not mutate authority order", () => {
    const original = ["a", "b", "c", "d", "e"];
    const shuffled = shuffleStealCandidates(original, "victim-event-1");
    expect(shuffled).toEqual(shuffleStealCandidates(original, "victim-event-1"));
    expect([...shuffled].sort()).toEqual(original);
    expect(original).toEqual(["a", "b", "c", "d", "e"]);
  });
});
