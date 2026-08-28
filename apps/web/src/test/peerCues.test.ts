import { describe, expect, it } from "vitest";
import {
  decodeCueWire,
  encodeCueWire,
  parseCue,
  spectatorPoseCue,
  stealAnimationCue,
  waitingPoseCue,
} from "../network/peerCues";

describe("non-authoritative peer cues", () => {
  it("accepts the strict cosmetic schema", () =>
    expect(
      parseCue({ version: 1, type: "emote", eventId: "e1", emote: "applause", atMs: 1 }),
    ).toBeTruthy());
  it.each(["cardId", "cardIds", "rank", "turnPlayerId", "revision", "winner", "hand"])(
    "rejects authoritative key %s",
    (key) =>
      expect(
        parseCue({
          version: 1,
          type: "emote",
          eventId: "e1",
          emote: "applause",
          atMs: 1,
          [key]: "forged",
        }),
      ).toBeNull(),
  );
  it("matches the Firestore rules kind/string-payload contract", () => {
    const cue = {
      version: 1,
      type: "focus",
      eventId: "f1",
      focusPlayerId: "player-2",
      atMs: 2,
    } as const;
    const wire = encodeCueWire(cue);
    expect(wire.kind).toBe("focus");
    expect(typeof wire.payload).toBe("string");
    expect(decodeCueWire(wire)).toEqual(cue);
    expect(decodeCueWire({ kind: "emote", payload: wire.payload })).toBeNull();
  });
  it("accepts only non-authoritative A-steal presentation slots", () => {
    const cue = stealAnimationCue("point", "player-2", {
      cardCount: 8,
      takeCount: 2,
      slot: 3,
      pointerX: 0.25,
      selectedSlots: [1],
    });
    expect(parseCue(cue)).toEqual(cue);
    expect(parseCue({ ...cue, cardId: "secret-card" })).toBeNull();
    expect(parseCue({ ...cue, slot: 54 })).toBeNull();
    expect(parseCue({ ...cue, stage: "complete", slot: 3 })).toBeNull();
    expect(parseCue({ ...cue, pointerX: 2 })).toBeNull();
  });
  it("accepts a strict spectator pose without a spoofable sender id", () => {
    const cue = spectatorPoseCue({
      x: 6.5,
      y: 3,
      z: -7.25,
      yaw: Math.PI / 2,
      moving: true,
      freeSpectating: true,
    });

    expect(parseCue(cue)).toEqual(cue);
    expect(cue).not.toHaveProperty("sender");
    expect(parseCue({ ...cue, senderUid: "another-player" })).toBeNull();
    expect(parseCue({ ...cue, x: Number.NaN })).toBeNull();
    expect(parseCue({ ...cue, y: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseCue({ ...cue, z: 16.001 })).toBeNull();
    expect(parseCue({ ...cue, y: -0.001 })).toBeNull();
    expect(parseCue({ ...cue, yaw: Math.PI + 0.001 })).toBeNull();
    expect(parseCue({ ...cue, atMs: 1.5 })).toBeNull();
    expect(parseCue({ ...cue, atMs: Date.now() + 60_000 })).toBeNull();
    expect(parseCue({ ...cue, moving: "yes" })).toBeNull();
    expect(parseCue({ ...cue, freeSpectating: false, moving: true })).toBeNull();
    const { yaw: _yaw, ...withoutYaw } = cue;
    expect(parseCue(withoutYaw)).toBeNull();
  });
  it("accepts only bounded, ephemeral waiting-room poses", () => {
    const cue = waitingPoseCue({
      x: 2,
      y: 0.05,
      z: -3,
      yaw: -0.5,
      moving: true,
      inPlayground: true,
    });

    expect(parseCue(cue)).toEqual(cue);
    expect(parseCue({ ...cue, x: 16.01 })).toBeNull();
    expect(parseCue({ ...cue, inPlayground: false, moving: true })).toBeNull();
    expect(parseCue({ ...cue, cardIds: ["secret"] })).toBeNull();
  });
});
