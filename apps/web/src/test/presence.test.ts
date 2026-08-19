import { describe, expect, it } from "vitest";
import { presenceRecord } from "../network/firebaseClient";

describe("RTDB presence payload", () => {
  it("matches the strict v2Presence rules shape", () =>
    expect(presenceRecord(true, "connection-id", 123)).toEqual({
      online: true,
      connectionId: "connection-id",
      lastChanged: 123,
    }));
  it("represents an onDisconnect transition without authoritative game data", () =>
    expect(Object.keys(presenceRecord(false, "connection-id", 456)).sort()).toEqual([
      "connectionId",
      "lastChanged",
      "online",
    ]));
});
