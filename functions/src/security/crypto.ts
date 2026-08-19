import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createRoomId(): string {
  let result = "";
  for (let index = 0; index < 5; index += 1) {
    result += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  }
  return result;
}

export function createReconnectToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashReconnectToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function reconnectTokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashReconnectToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createGameId(generation: number): string {
  return `g${generation}-${randomBytes(12).toString("base64url")}`;
}
