import { describe, expect, it } from "vitest";
import type { Rank } from "../app/model";
import { isCourtRank, standardPipLayout } from "../game-3d/cardDesign";

describe("standard playing-card face layout", () => {
  it.each([
    ["A", 1],
    ["2", 2],
    ["3", 3],
    ["4", 4],
    ["5", 5],
    ["6", 6],
    ["7", 7],
    ["8", 8],
    ["9", 9],
    ["10", 10],
  ] as const)("draws %s with %d suit marks", (rank, count) => {
    expect(standardPipLayout(rank)).toHaveLength(count);
  });

  it("uses mirrored court artwork for J, Q and K", () => {
    for (const rank of ["J", "Q", "K"] satisfies Rank[]) {
      expect(isCourtRank(rank)).toBe(true);
      expect(standardPipLayout(rank)).toEqual([]);
    }
  });
});
