import type { Rank } from "../app/model";

export interface PipPlacement {
  x: number;
  y: number;
  upsideDown: boolean;
  scale?: number;
}

const pip = (x: number, y: number, upsideDown = y > 192): PipPlacement => ({
  x,
  y,
  upsideDown,
});

const sideRows = (rows: readonly number[]): PipPlacement[] =>
  rows.flatMap((y) => [pip(72, y), pip(184, y)]);

/** Traditional French-suited pip counts and approximate positions for A–10. */
export function standardPipLayout(rank: Rank): PipPlacement[] {
  switch (rank) {
    case "A":
      return [{ ...pip(128, 192, false), scale: 1.9 }];
    case "2":
      return [pip(128, 108, false), pip(128, 276, true)];
    case "3":
      return [pip(128, 102, false), pip(128, 192, false), pip(128, 282, true)];
    case "4":
      return sideRows([112, 272]);
    case "5":
      return [...sideRows([105, 279]), pip(128, 192, false)];
    case "6":
      return sideRows([100, 192, 284]);
    case "7":
      return [...sideRows([96, 192, 288]), pip(128, 145, false)];
    case "8":
      return [...sideRows([92, 192, 292]), pip(128, 142, false), pip(128, 242, true)];
    case "9":
      return [...sideRows([88, 150, 234, 296]), pip(128, 192, false)];
    case "10":
      return [...sideRows([86, 146, 238, 298]), pip(128, 174, false), pip(128, 210, true)];
    default:
      return [];
  }
}

export function isCourtRank(rank: Rank | undefined): rank is "J" | "Q" | "K" {
  return rank === "J" || rank === "Q" || rank === "K";
}
