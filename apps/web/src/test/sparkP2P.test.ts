import { describe, expect, test } from "vitest";
import {
  nextSparkActivityMetadata,
  parseSparkWire,
  sparkDirectoryHeartbeatMs,
} from "../network/sparkP2P";

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

  test("uses the Firestore server heartbeat instead of a skewed client clock", () => {
    expect(
      sparkDirectoryHeartbeatMs({
        heartbeatAtMs: 999_999,
        heartbeatAt: { toMillis: () => 5_000 },
      }),
    ).toBe(5_000);
    expect(sparkDirectoryHeartbeatMs({ heartbeatAtMs: 7_000 })).toBe(7_000);
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
  test("applies the strict cosmetic cue schema on the P2P wire", () => {
    const validCue = {
      version: 1,
      type: "emote",
      eventId: "emote-1",
      emote: "applause",
      atMs: 1,
    };
    expect(parseSparkWire(JSON.stringify({ type: "cue", cue: validCue }))).toEqual({
      type: "cue",
      cue: validCue,
    });
    expect(
      parseSparkWire(JSON.stringify({ type: "cue", cue: validCue, senderUid: "actor" })),
    ).toEqual({ type: "cue", cue: validCue, senderUid: "actor" });
    expect(
      parseSparkWire(JSON.stringify({ type: "cue", cue: { ...validCue, turnPlayerId: "forged" } })),
    ).toBeNull();
  });

  test("rejects malformed peer requests before authority dispatch", () => {
    const avatar = { schemaVersion: 1 };
    expect(
      parseSparkWire(
        JSON.stringify({
          type: "hello",
          requestId: "hello-1",
          role: "player",
          profile: { name: "guest", avatar },
        }),
      ),
    ).toMatchObject({ type: "hello", role: "player" });
    expect(
      parseSparkWire(
        JSON.stringify({
          type: "hello",
          requestId: "hello-2",
          role: "administrator",
          profile: { name: "guest", avatar },
        }),
      ),
    ).toBeNull();
    expect(
      parseSparkWire(
        JSON.stringify({ type: "command", requestId: "command-1", name: "submitPass" }),
      ),
    ).toBeNull();
    expect(
      parseSparkWire(JSON.stringify({ type: "response", requestId: "response-1", ok: true })),
    ).toBeNull();
    expect(
      parseSparkWire(
        JSON.stringify({
          type: "command",
          requestId: "",
          name: "submitPass",
          payload: {},
        }),
      ),
    ).toBeNull();
  });
});
