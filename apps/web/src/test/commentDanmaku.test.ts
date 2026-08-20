import { describe, expect, it } from "vitest";
import { allocateDanmakuLane } from "../screens/CommentDanmaku";

describe("comment lane scheduling", () => {
  it("uses another free lane before delaying a comment", () => {
    const first = allocateDanmakuLane([0, 0, 0], 1_000, 10, 390);
    const lanes = [first.laneReadyAt, 0, 0];
    const second = allocateDanmakuLane(lanes, 1_000, 8, 390);
    lanes[second.lane] = second.laneReadyAt;
    const third = allocateDanmakuLane(lanes, 1_000, 6, 390);
    expect([first.lane, second.lane, third.lane]).toEqual([0, 1, 2]);
    expect(third.startsAt).toBe(1_000);
  });

  it("delays reuse until the prior comment tail has cleared", () => {
    const first = allocateDanmakuLane([0], 5_000, 30, 390);
    const next = allocateDanmakuLane([first.laneReadyAt], 5_100, 4, 390);
    expect(next.startsAt).toBe(first.laneReadyAt);
    expect(next.durationMs).toBeGreaterThanOrEqual(6_500);
  });
});
