import { describe, expect, test } from "vitest";
import {
  createRoomSchema,
  resolveBomberSchema,
  resolveDiscardSchema,
  submitPlaySchema,
} from "../src/security/schemas.js";

const actionId = "12345678-1234-4123-8123-123456789abc";

describe("callable schemas", () => {
  test("normal mode requires zero blind cards", () => {
    const result = createRoomSchema.safeParse({
      clientActionId: actionId,
      profile: { name: "Alice", avatar: { schemaVersion: 1 } },
      visibility: "public",
      settings: { mode: "normal", blindCount: 1 },
    });
    expect(result.success).toBe(false);
  });

  test("unknown uid fields are rejected instead of trusted", () => {
    const result = submitPlaySchema.safeParse({
      roomId: "ABCDE",
      gameId: "g0-example",
      expectedRevision: 3,
      clientActionId: actionId,
      uid: "forged-user",
      cardIds: ["opaque-card-1"],
      mimics: [],
    });
    expect(result.success).toBe(false);
  });

  test("duplicate card ids and duplicate bomber ranks are rejected", () => {
    expect(
      submitPlaySchema.safeParse({
        roomId: "ABCDE",
        gameId: "g0-example",
        expectedRevision: 3,
        clientActionId: actionId,
        cardIds: ["card-1", "card-1"],
        mimics: [],
      }).success,
    ).toBe(false);
    expect(
      resolveBomberSchema.safeParse({
        roomId: "ABCDE",
        gameId: "g0-example",
        expectedRevision: 3,
        clientActionId: actionId,
        ranks: ["Q", "Q"],
      }).success,
    ).toBe(false);
  });

  test("forced selections accept six Joker-augmented effect cards but never seven", () => {
    const base = {
      roomId: "ABCDE",
      gameId: "g0-example",
      expectedRevision: 3,
      clientActionId: actionId,
    };
    const six = Array.from({ length: 6 }, (_, index) => `card-${index}`);
    const seven = [...six, "card-6"];
    expect(resolveDiscardSchema.safeParse({ ...base, cardIds: six }).success).toBe(true);
    expect(resolveDiscardSchema.safeParse({ ...base, cardIds: seven }).success).toBe(false);
    expect(
      resolveBomberSchema.safeParse({
        ...base,
        ranks: ["3", "4", "5", "6", "7", "8"],
      }).success,
    ).toBe(true);
  });
});
