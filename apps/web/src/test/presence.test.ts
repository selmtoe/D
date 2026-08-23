import { describe, expect, it } from "vitest";
import { clearRoomReconnect, presenceRecord } from "../network/firebaseClient";

describe("presence payload helper", () => {
  it("keeps the connection marker independent from gameplay state", () =>
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
  it("clears both reconnect stores after leaving or being evicted", () => {
    localStorage.setItem("daifugo-spark-reconnect-ABCDE", "saved");
    sessionStorage.setItem("daifugo-reconnect-ABCDE", "token");
    localStorage.setItem("unrelated", "keep");

    clearRoomReconnect("ABCDE");

    expect(localStorage.getItem("daifugo-spark-reconnect-ABCDE")).toBeNull();
    expect(sessionStorage.getItem("daifugo-reconnect-ABCDE")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
    localStorage.removeItem("unrelated");
  });
});
