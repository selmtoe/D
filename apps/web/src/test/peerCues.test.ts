import { describe, expect, it } from "vitest";
import { decodeCueWire, encodeCueWire, parseCue, stealAnimationCue } from "../network/peerCues";

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
    const cue = stealAnimationCue("point", "player-2", 3);
    expect(parseCue(cue)).toEqual(cue);
    expect(parseCue({ ...cue, cardId: "secret-card" })).toBeNull();
    expect(parseCue({ ...cue, slot: 54 })).toBeNull();
    expect(parseCue({ ...cue, stage: "confirm", slot: 3 })).toBeNull();
  });
});
