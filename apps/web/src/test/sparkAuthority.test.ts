import { defaultAvatar } from "@daifugo/avatar-schema";
import { checkStateInvariants, createDeck, type HandCard } from "@daifugo/rules";
import { describe, expect, it } from "vitest";
import { SparkAuthority } from "../network/sparkAuthority";

const profile = (name: string) => ({ name, avatar: structuredClone(defaultAvatar) });

function waitingRoom(mode: "normal" | "blind" = "normal") {
  const authority = SparkAuthority.create("ABCDE", "p1", "peer-1", profile("一郎"), 1_000);
  authority.join({ uid: "p2", peerId: "peer-2", profile: profile("二郎"), role: "player" }, 1_001);
  authority.join({ uid: "p3", peerId: "peer-3", profile: profile("三郎"), role: "player" }, 1_002);
  if (mode === "blind") {
    authority.handleCommand(
      "p1",
      "updateRoomSettings",
      {
        clientActionId: "settings",
        expectedRevision: authority.exportSnapshot().revision,
        settings: { mode: "blind", blindCount: 1 },
      },
      1_003,
    );
  }
  return authority;
}

function pendingBlindJokerAuthority() {
  const authority = waitingRoom("blind");
  authority.handleCommand(
    "p1",
    "startGame",
    { clientActionId: "start-joker", expectedRevision: authority.exportSnapshot().revision },
    2_000,
  );
  const snapshot = authority.exportSnapshot();
  const game = snapshot.game!;
  const ids = new Set(["spade-6", "joker-1", "spade-8", "club-3", "heart-4", "diamond-5"]);
  const hand = (...entries: Array<[string, boolean]>): HandCard[] =>
    entries.map(([id, blind]) => ({
      card: createDeck().find((candidate) => candidate.id === id)!,
      blind,
    }));
  game.players.find((player) => player.id === "p1")!.hand = hand(
    ["spade-6", false],
    ["joker-1", true],
    ["spade-8", false],
    ["club-3", false],
  );
  game.players.find((player) => player.id === "p2")!.hand = hand(["heart-4", false]);
  game.players.find((player) => player.id === "p3")!.hand = hand(["diamond-5", false]);
  game.deck = createDeck().filter((card) => !ids.has(card.id));
  game.turnPlayerId = "p1";
  game.firstPlay = false;
  return SparkAuthority.restore(snapshot);
}

function beginPendingMimic(authority: SparkAuthority, actionId: string) {
  return authority.handleCommand(
    "p1",
    "submitPlay",
    {
      clientActionId: actionId,
      expectedRevision: authority.exportSnapshot().revision,
      gameId: authority.exportSnapshot().game!.id,
      cardIds: ["spade-6", "joker-1", "spade-8"],
      mimics: [],
      blindConfirmed: true,
    },
    2_100,
  );
}

describe("Spark browser authority", () => {
  it("runs the pure rules engine and applies the opening diamond 3 exactly once", () => {
    const authority = waitingRoom();
    authority.handleCommand(
      "p1",
      "startGame",
      {
        clientActionId: "start",
        expectedRevision: authority.exportSnapshot().revision,
      },
      2_000,
    );
    const started = authority.exportSnapshot();
    const opener = started.game!.players.find((player) =>
      player.hand.some((entry) => entry.card.suit === "diamond" && entry.card.rank === "3"),
    )!;
    const diamondThree = opener.hand.find(
      (entry) => entry.card.suit === "diamond" && entry.card.rank === "3",
    )!;
    const payload = {
      clientActionId: "opening-play",
      expectedRevision: started.revision,
      gameId: started.game!.id,
      cardIds: [diamondThree.card.id],
      mimics: [],
      blindConfirmed: false,
    };

    authority.handleCommand(opener.id, "submitPlay", payload, 2_100);
    const after = authority.exportSnapshot();
    expect(after.game?.pile?.cards[0]?.card.rank).toBe("3");
    expect(after.game?.pile?.cards[0]?.card.suit).toBe("diamond");
    expect(after.game?.players.find((player) => player.id === opener.id)?.hand).toHaveLength(
      opener.hand.length - 1,
    );
    expect(authority.handleCommand(opener.id, "submitPlay", payload, 2_101)).toEqual({});
  });

  it("keeps the owner's blind card hidden while friends can see its face", () => {
    const authority = waitingRoom("blind");
    authority.handleCommand(
      "p1",
      "startGame",
      {
        clientActionId: "start-blind",
        expectedRevision: authority.exportSnapshot().revision,
      },
      2_000,
    );
    const snapshot = authority.exportSnapshot();
    const owner = snapshot.game!.players.find((player) =>
      player.hand.some((entry) => entry.blind),
    )!;
    const observer = snapshot.game!.players.find((player) => player.id !== owner.id)!;
    const blindId = owner.hand.find((entry) => entry.blind)!.card.id;
    const ownerCard = authority.project(owner.id).hand.find((card) => card.id === blindId);
    const observerCard = authority
      .project(observer.id)
      .players.find((player) => player.id === owner.id)
      ?.cards?.find((card) => card.id === blindId);

    expect(ownerCard?.visibility).toBe("hidden");
    expect(observerCard?.visibility).toBe("face");
  });

  it("enforces the documented six-player room cap", () => {
    const authority = waitingRoom();
    for (let index = 4; index <= 6; index += 1) {
      authority.join({
        uid: `p${index}`,
        peerId: `peer-${index}`,
        profile: profile(`${index}郎`),
        role: "player",
      });
    }
    expect(() =>
      authority.join({
        uid: "p7",
        peerId: "peer-7",
        profile: profile("七郎"),
        role: "player",
      }),
    ).toThrow(/6人まで/);
  });

  it("marks a one-person waiting room empty when its coordinator leaves", () => {
    const authority = SparkAuthority.create("ABCDE", "p1", "peer-1", profile("一郎"), 1_000);
    authority.handleCommand(
      "p1",
      "leaveRoom",
      {
        clientActionId: "leave-empty-room",
        expectedRevision: authority.exportSnapshot().revision,
      },
      2_000,
    );
    expect(authority.isEmpty).toBe(true);
  });

  it("returns the original start response for the same room action id", () => {
    const authority = waitingRoom();
    const payload = {
      clientActionId: "start-idempotent",
      expectedRevision: authority.exportSnapshot().revision,
    };
    const first = authority.handleCommand("p1", "startGame", payload, 2_000);
    expect(first.gameId).toEqual(expect.any(String));
    expect(authority.handleCommand("p1", "startGame", payload, 2_001)).toEqual(first);
    expect(authority.exportSnapshot().generation).toBe(0);
  });

  it("blocks a different play during blind Joker declaration and accepts the declaration", () => {
    const authority = pendingBlindJokerAuthority();
    expect(beginPendingMimic(authority, "blind-joker-invalid")).toMatchObject({
      requiresJokerMimic: true,
    });
    expect(() =>
      authority.handleCommand(
        "p1",
        "submitPlay",
        {
          clientActionId: "different-play-during-declaration",
          expectedRevision: authority.exportSnapshot().revision,
          gameId: authority.exportSnapshot().game!.id,
          cardIds: ["club-3"],
          mimics: [],
          blindConfirmed: false,
        },
        2_200,
      ),
    ).toThrow(/Joker宣言/);
    expect(authority.project("p1").pendingJokerMimic).toBeDefined();

    authority.handleCommand(
      "p1",
      "declareJokerMimic",
      {
        clientActionId: "valid-declaration",
        expectedRevision: authority.exportSnapshot().revision,
        gameId: authority.exportSnapshot().game!.id,
        mimics: [{ cardId: "joker-1", suit: "spade", rank: "7" }],
      },
      2_201,
    );
    expect(authority.project("p1").pendingJokerMimic).toBeUndefined();
    expect(authority.exportSnapshot().game?.pile?.cards).toHaveLength(3);
  });

  it("resolves a pending blind Joker declaration deterministically on timeout", () => {
    const authority = pendingBlindJokerAuthority();
    beginPendingMimic(authority, "blind-joker-timeout");
    expect(authority.timeoutCurrent(62_101)).toBe(true);
    const snapshot = authority.exportSnapshot();
    expect(snapshot.pendingMimic).toBeUndefined();
    expect(snapshot.game?.pile?.cards).toHaveLength(3);
    expect(
      snapshot.game?.pile?.cards.find((entry) => entry.card.id === "joker-1")?.mimic,
    ).toMatchObject({ suit: "spade", rank: "7" });
  });

  it("hands coordinator ownership to the oldest online member on explicit leave", () => {
    const authority = waitingRoom();
    authority.handleCommand(
      "p1",
      "leaveRoom",
      {
        clientActionId: "coordinator-leave",
        expectedRevision: authority.exportSnapshot().revision,
      },
      2_000,
    );
    const snapshot = authority.exportSnapshot();
    expect(snapshot.coordinatorUid).toBe("p2");
    expect(snapshot.hostUid).toBe("p2");
    expect(authority.publicRoom().coordinatorPeerId).toBe("peer-2");
  });

  it("restricts focus changes to spectators and projects spectator chat roles", () => {
    const authority = waitingRoom();
    authority.handleCommand(
      "p1",
      "startGame",
      { clientActionId: "start-spectator", expectedRevision: authority.exportSnapshot().revision },
      2_000,
    );
    authority.join(
      {
        uid: "watcher",
        peerId: "peer-watcher",
        profile: profile("観戦者"),
        role: "spectator",
      },
      2_001,
    );

    expect(() =>
      authority.handleCommand(
        "p1",
        "changeSpectatorFocus",
        {
          clientActionId: "player-focus",
          expectedRevision: authority.exportSnapshot().revision,
          focusPlayerId: "p2",
        },
        2_002,
      ),
    ).toThrow(/観戦者専用/);

    authority.handleCommand(
      "watcher",
      "changeSpectatorFocus",
      {
        clientActionId: "watcher-focus",
        expectedRevision: authority.exportSnapshot().revision,
        focusPlayerId: "p2",
      },
      2_003,
    );
    authority.handleCommand(
      "watcher",
      "sendChat",
      {
        clientActionId: "watcher-chat",
        expectedRevision: authority.exportSnapshot().revision,
        text: "観戦しています",
      },
      2_004,
    );

    expect(authority.project("watcher").focusedPlayerId).toBe("p2");
    expect(authority.project("p1").chat?.at(-1)).toMatchObject({
      uid: "watcher",
      role: "spectator",
      text: "観戦しています",
    });
  });

  it("runs hundreds of automatic legal turns and effects for 3 to 6 players without corruption", () => {
    for (let playerCount = 3; playerCount <= 6; playerCount += 1) {
      const authority = SparkAuthority.create(
        `ROOM${playerCount}`,
        "p1",
        "peer-1",
        profile("一郎"),
        1_000,
      );
      for (let index = 2; index <= playerCount; index += 1) {
        authority.join(
          {
            uid: `p${index}`,
            peerId: `peer-${index}`,
            profile: profile(`${index}郎`),
            role: "player",
          },
          1_000 + index,
        );
      }
      authority.handleCommand(
        "p1",
        "startGame",
        {
          clientActionId: `start-${playerCount}`,
          expectedRevision: authority.exportSnapshot().revision,
        },
        2_000,
      );
      let turns = 0;
      while (authority.exportSnapshot().status === "playing" && turns < 400) {
        expect(authority.timeoutCurrent(62_001 + turns * 60_001)).toBe(true);
        turns += 1;
      }
      const finished = authority.exportSnapshot();
      expect(checkStateInvariants(finished.game!)).toEqual({ valid: true, errors: [] });
      if (finished.status === "playing") {
        const active = finished.game!.players.filter((player) => player.status === "active");
        expect(active.length).toBeGreaterThan(1);
        expect(
          active.every(
            (player) =>
              player.hand.length === 1 && ["2", "JOKER"].includes(player.hand[0]?.card.rank ?? ""),
          ),
        ).toBe(true);
      } else {
        expect(finished.game?.players.every((player) => player.rank !== null)).toBe(true);
      }
    }
  });
});
