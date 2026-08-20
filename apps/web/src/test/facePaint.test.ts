import { FACE_PAINT_LIMITS, type FacePaintStroke } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import {
  appendFacePaintStroke,
  canAddFacePaintPoint,
  normalizedFacePaintPoint,
  undoFacePaintStroke,
} from "../avatar-3d/facePaint";

const stroke: FacePaintStroke = {
  mode: "paint",
  color: "#123456",
  width: 0.03,
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.4 },
  ],
};

describe("face paint editing helpers", () => {
  it("clamps and rounds pointer coordinates before persistence", () => {
    expect(normalizedFacePaintPoint(-3, 1.123456)).toEqual({ x: 0, y: 1 });
    expect(normalizedFacePaintPoint(0.123456, 0.654321)).toEqual({ x: 0.1235, y: 0.6543 });
    expect(normalizedFacePaintPoint(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("appends validated strokes and supports per-stroke undo", () => {
    const first = appendFacePaintStroke(undefined, stroke);
    const second = appendFacePaintStroke(first, { ...stroke, mode: "erase" });
    expect(second.strokes).toHaveLength(2);
    expect(undoFacePaintStroke(second)).toEqual(first);
    expect(undoFacePaintStroke(first)).toBeUndefined();
  });

  it("stops collecting points at the per-line and total limits", () => {
    expect(canAddFacePaintPoint(undefined, FACE_PAINT_LIMITS.maxPointsPerStroke)).toBe(false);
    const full = {
      version: 1 as const,
      strokes: Array.from({ length: 16 }, () => ({
        ...stroke,
        points: Array.from({ length: 128 }, () => ({ x: 0.5, y: 0.5 })),
      })),
    };
    expect(canAddFacePaintPoint(full, 0)).toBe(false);
  });
});
