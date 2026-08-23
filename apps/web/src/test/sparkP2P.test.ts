import { describe, expect, test } from "vitest";
import { nextSparkActivityMetadata, parseSparkWire } from "../network/sparkP2P";

describe("Spark directory activity metadata", () => {
  test("lease-only heartbeats do not advance last activity", () => {
    expect(
      nextSparkActivityMetadata(
        false,
        { lastActivityAtMs: 1_000, authorityRevision: 7 },
        99_000,
        1_000,
      ),
    ).toEqual({ recordsActivity: false, lastActivityAtMs: 1_000 });
  });

  test("authority mutations advance activity and legacy rooms migrate safely", () => {
    expect(
      nextSparkActivityMetadata(
        true,
        { lastActivityAtMs: 1_000, authorityRevision: 7 },
        99_000,
        1_000,
      ),
    ).toEqual({ recordsActivity: true, lastActivityAtMs: 99_000 });
    expect(nextSparkActivityMetadata(false, undefined, 99_000, 500)).toEqual({
      recordsActivity: true,
      lastActivityAtMs: 99_000,
    });
  });
});

describe("Spark wire decoding", () => {
  test("accepts only a valid kick eviction notification", () => {
    expect(parseSparkWire(JSON.stringify({ type: "evicted", reason: "kick" }))).toEqual({
      type: "evicted",
      reason: "kick",
    });
    expect(parseSparkWire(JSON.stringify({ type: "evicted", reason: "leave" }))).toBeNull();
  });
});
