import { describe, expect, test, vi } from "vitest";
import {
  nextSparkActivityMetadata,
  parseSparkIceCandidate,
  parseSparkWire,
  SparkP2PSession,
  sparkDirectoryHeartbeatMs,
} from "../network/sparkP2P";
import { emoteCue } from "../network/peerCues";

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
  test("accepts only bounded ICE candidate fields", () => {
    expect(
      parseSparkIceCandidate({
        candidate: "candidate:1 1 UDP 1 127.0.0.1 1234 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "fragment",
      }),
    ).toMatchObject({ sdpMid: "0", sdpMLineIndex: 0 });
    expect(parseSparkIceCandidate({ candidate: "x".repeat(4_097) })).toBeNull();
    expect(parseSparkIceCandidate({ candidate: "candidate", sdpMLineIndex: -1 })).toBeNull();
    expect(parseSparkIceCandidate({ candidate: { nested: true } })).toBeNull();
  });

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
      parseSparkWire(JSON.stringify({ type: "cue", cue: validCue, directOnly: true })),
    ).toEqual({ type: "cue", cue: validCue, directOnly: true });
    expect(
      parseSparkWire(JSON.stringify({ type: "cue", cue: validCue, directOnly: false })),
    ).toBeNull();
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
    expect(
      parseSparkWire(
        JSON.stringify({
          type: "command",
          requestId: "short-request",
          name: "saveAvatarProfile",
          payload: { clientActionId: "x".repeat(129) },
        }),
      ),
    ).toBeNull();
    expect(
      parseSparkWire(
        JSON.stringify({
          type: "command",
          requestId: "oversized-command",
          name: "saveAvatarProfile",
          payload: { clientActionId: "valid-action", padding: "x".repeat(65_536) },
        }),
      ),
    ).toBeNull();
    expect(
      parseSparkWire(JSON.stringify({ type: "view", view: { padding: "x".repeat(256 * 1_024) } })),
    ).toBeNull();
  });
});

describe("Spark direct-only cues", () => {
  test("drops movement when no data channel is open without writing a Firebase relay", async () => {
    const sendRelay = vi.fn();
    const session = Object.create(SparkP2PSession.prototype) as {
      sendCueDirect: (cue: ReturnType<typeof emoteCue>) => Promise<boolean>;
      [key: string]: unknown;
    };
    Object.assign(session, {
      stopped: false,
      uid: "viewer",
      authority: undefined,
      coordinatorUid: "host",
      coordinatorPeerId: "host_peer",
      peers: new Map(),
      cueListeners: new Set(),
      mode: "firebase",
      modeListeners: new Set(),
      sendRelay,
    });

    await expect(session.sendCueDirect(emoteCue("thinking"))).resolves.toBe(false);
    expect(sendRelay).not.toHaveBeenCalled();
  });
});
