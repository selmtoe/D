import { describe, expect, it } from "vitest";
import { defaultAvatar } from "@daifugo/avatar-schema";
import type { RoomView } from "../app/model";
import { initialAppState, retainSelectedCardIds, transition } from "../app/stateMachine";

const room = (phase: RoomView["phase"], role: RoomView["role"] = "player"): RoomView => ({
  roomId: "ABCDE",
  revision: 1,
  generation: 0,
  phase,
  role,
  viewerId: "me",
  hostId: "me",
  players: [
    {
      id: "me",
      name: "私",
      avatar: defaultAvatar,
      cardCount: 0,
      connection: "online",
      status: "active",
      host: true,
    },
  ],
  spectators: [],
  settings: { mode: "normal", blindCount: 1 },
  direction: 1,
  revolution: false,
  jackBack: false,
  suitLock: [],
  field: [],
  discard: [],
  hand: [],
  pendingEffects: [],
  rankings: [],
  log: [],
});

describe("application state machine", () => {
  it("boots through authentication and entrance", () => {
    const authenticating = transition(initialAppState, { type: "BOOT" });
    expect(authenticating.phase).toBe("AUTHENTICATING");
    expect(transition(authenticating, { type: "AUTH_OK" }).phase).toBe("ENTRANCE");
  });
  it.each([
    ["waiting", "ROOM_WAITING"],
    ["dealing", "DEALING"],
    ["playing", "PLAYING_TURN"],
    ["effect", "AWAITING_FORCED_EFFECT"],
    ["finished", "FINISHED"],
  ] as const)("maps %s to %s", (serverPhase, appPhase) =>
    expect(transition(initialAppState, { type: "ROOM_VIEW", room: room(serverPhase) }).phase).toBe(
      appPhase,
    ),
  );
  it("keeps spectators read-only while crossing game phases", () =>
    expect(
      transition(initialAppState, { type: "ROOM_VIEW", room: room("playing", "spectator") }).role,
    ).toBe("spectator"));
  it("ignores an out-of-order room projection", () => {
    const current = { ...room("playing"), revision: 4 };
    const state = transition(initialAppState, { type: "ROOM_VIEW", room: current });
    expect(
      transition(state, {
        type: "ROOM_VIEW",
        room: { ...current, revision: 3, phase: "finished" },
      }),
    ).toBe(state);
  });
  it("retains only selected cards still present across social revisions", () => {
    const previous = {
      ...room("playing"),
      gameId: "game-1",
      hand: [
        { id: "keep", visibility: "hidden" as const, blind: true },
        { id: "gone", visibility: "hidden" as const, blind: false },
      ],
    };
    const next = {
      ...previous,
      revision: 2,
      hand: [{ id: "keep", visibility: "hidden" as const, blind: true }],
    };
    expect(retainSelectedCardIds(["keep", "gone"], previous, next)).toEqual(["keep"]);
    expect(retainSelectedCardIds(["keep"], previous, { ...next, gameId: "game-2" })).toEqual([]);
  });
  it("shows a non-authoritative dealing transition when a waiting room starts", () => {
    const waiting = room("waiting");
    const waitingState = transition(initialAppState, { type: "ROOM_VIEW", room: waiting });
    const started = { ...room("playing"), revision: 2, gameId: "game-1" };
    const dealing = transition(waitingState, { type: "ROOM_VIEW", room: started });
    expect(dealing.phase).toBe("DEALING");
    expect(transition(dealing, { type: "DEALING_DONE" }).phase).toBe("PLAYING_TURN");
  });
  it("returns a kicked participant to the salon with an explicit reason", () => {
    const playing = transition(initialAppState, { type: "ROOM_VIEW", room: room("playing") });
    expect(
      transition(playing, { type: "EVICTED", message: "ホストによりキックされました" }),
    ).toMatchObject({
      phase: "SALON_LOBBY",
      connection: "offline",
      error: "ホストによりキックされました",
    });
  });
  it("restores a reconnect profile without changing the current phase", () => {
    const entrance = { ...initialAppState, phase: "ENTRANCE" as const };
    expect(
      transition(entrance, {
        type: "RESTORE_PROFILE",
        profile: { name: "復帰者", avatar: defaultAvatar },
      }),
    ).toMatchObject({ phase: "ENTRANCE", profile: { name: "復帰者" } });
  });
});
