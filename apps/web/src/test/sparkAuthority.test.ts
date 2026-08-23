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
      cardIds: ["spade-6", "joker-1"],
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

  it("projects the two physical Jokers with distinct faces", () => {
    const authority = waitingRoom();
    authority.join({
      uid: "watcher",
      peerId: "watcher-peer",
      profile: profile("観戦者"),
      role: "spectator",
    });
    authority.handleCommand("p1", "startGame", { clientActionId: "start-for-joker-faces" }, 2_000);

    const jokerFaces = authority
      .project("watcher")
      .players.flatMap((player) => player.cards ?? [])
      .flatMap((card) => (card.visibility === "face" && card.joker ? [card.joker] : []))
      .sort();
    expect(jokerFaces).toEqual(["crimson", "monochrome"]);
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

  it("bounds peer face paint and migrates old snapshot profiles before projection", () => {
    const authority = waitingRoom();
    authority.join({
      uid: "p4",
      peerId: "peer-4",
      profile: {
        name: "四郎",
        avatar: {
          ...structuredClone(defaultAvatar),
          facePaint: {
            version: 1,
            strokes: [
              {
                mode: "paint",
                color: "#abcdef",
                width: 0.04,
                points: [{ x: 0.25, y: 0.75 }],
              },
            ],
            unsafeTextureUrl: "https://example.invalid/private.png",
          },
        } as never,
      },
      role: "player",
    });
    expect(authority.member("p4")?.avatar).not.toHaveProperty("facePaint");

    const legacySnapshot = authority.exportSnapshot();
    legacySnapshot.members.p2!.avatar = { schemaVersion: 1 } as never;
    const restored = SparkAuthority.restore(legacySnapshot);
    expect(restored.member("p2")?.avatar).toEqual(defaultAvatar);
    expect(restored.project("p1").players.find((player) => player.id === "p2")?.avatar).toEqual(
      defaultAvatar,
    );
  });

  it("sanitizes avatar updates and rejects a missing profile", () => {
    const authority = waitingRoom();
    authority.handleCommand(
      "p2",
      "saveAvatarProfile",
      {
        clientActionId: "avatar-update",
        avatar: {
          ...structuredClone(defaultAvatar),
          facePaint: {
            version: 1,
            strokes: [],
            unsafeTextureUrl: "https://example.invalid/private.png",
          },
        },
      },
      2_000,
    );

    expect(authority.member("p2")?.avatar).not.toHaveProperty("facePaint");
    expect(() =>
      authority.handleCommand(
        "p2",
        "saveAvatarProfile",
        { clientActionId: "avatar-missing" },
        2_001,
      ),
    ).toThrow(/アバター情報が不正/);
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

  it("hands the waiting-room host role to a connected player", () => {
    const authority = waitingRoom();
    authority.setMemberOnline("p2", false, undefined, 1_100);
    authority.handleCommand(
      "p1",
      "leaveRoom",
      { clientActionId: "host-leaves-with-offline-successor" },
      1_200,
    );

    expect(authority.exportSnapshot().hostUid).toBe("p3");
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

  it("does not let the host reset a game before it finishes", () => {
    const authority = waitingRoom();
    expect(() =>
      authority.handleCommand(
        "p1",
        "startRematch",
        { clientActionId: "early-rematch-waiting" },
        1_500,
      ),
    ).toThrow(/対局終了後/);
    authority.handleCommand(
      "p1",
      "startGame",
      {
        clientActionId: "start-before-early-rematch",
        expectedRevision: authority.exportSnapshot().revision,
      },
      2_000,
    );

    expect(() =>
      authority.handleCommand(
        "p1",
        "startRematch",
        { clientActionId: "early-rematch-playing" },
        2_001,
      ),
    ).toThrow(/対局終了後/);
    expect(authority.exportSnapshot().status).toBe("playing");
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

    const chosen = authority.project("p1").pendingJokerMimic!.candidates[0]!;
    authority.handleCommand(
      "p1",
      "declareJokerMimic",
      {
        clientActionId: "valid-declaration",
        expectedRevision: authority.exportSnapshot().revision,
        gameId: authority.exportSnapshot().game!.id,
        mimics: chosen,
      },
      2_201,
    );
    expect(authority.project("p1").pendingJokerMimic).toBeUndefined();
    // A pair of sixes triggers rokurokubi and moves both cards to discard.
    expect(authority.exportSnapshot().game?.pile).toBeNull();
    expect(authority.exportSnapshot().game?.discard).toHaveLength(2);
  });

  it("applies a uniquely determined blind Joker without opening a declaration step", () => {
    const authority = pendingBlindJokerAuthority();
    const result = authority.handleCommand(
      "p1",
      "submitPlay",
      {
        clientActionId: "unique-blind-joker",
        expectedRevision: authority.exportSnapshot().revision,
        gameId: authority.exportSnapshot().game!.id,
        cardIds: ["spade-6", "joker-1", "spade-8"],
        mimics: [],
        blindConfirmed: true,
      },
      2_100,
    );

    expect(result).toEqual({});
    expect(authority.project("p1").pendingJokerMimic).toBeUndefined();
    expect(authority.exportSnapshot().game?.pile?.cards).toHaveLength(3);
    expect(
      authority.exportSnapshot().game?.pile?.cards.find((entry) => entry.card.id === "joker-1")
        ?.mimic,
    ).toEqual({ cardId: "joker-1", suit: "spade", rank: "7" });
  });

  it("resolves a pending blind Joker declaration deterministically on timeout", () => {
    const authority = pendingBlindJokerAuthority();
    beginPendingMimic(authority, "blind-joker-timeout");
    expect(authority.timeoutCurrent(62_101)).toBe(true);
    const snapshot = authority.exportSnapshot();
    expect(snapshot.pendingMimic).toBeUndefined();
    expect(snapshot.game?.pile).toBeNull();
    expect(snapshot.game?.discard.map((card) => card.id)).toContain("joker-1");
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

  it("moves browser authority together with an explicit host transfer", () => {
    const authority = waitingRoom();
    authority.handleCommand(
      "p1",
      "transferHost",
      {
        clientActionId: "transfer-host-and-authority",
        expectedRevision: authority.exportSnapshot().revision,
        targetUid: "p2",
      },
      2_000,
    );
    expect(authority.exportSnapshot()).toMatchObject({ hostUid: "p2", coordinatorUid: "p2" });
    expect(authority.publicRoom().coordinatorPeerId).toBe("peer-2");
  });

  it("lets only the host kick a member and removes the kicked player from the room", () => {
    const authority = waitingRoom();
    expect(() =>
      authority.handleCommand(
        "p2",
        "kickMember",
        {
          clientActionId: "not-host-kick",
          expectedRevision: authority.exportSnapshot().revision,
          targetUid: "p3",
        },
        2_000,
      ),
    ).toThrow(/ホスト専用/);
    authority.handleCommand(
      "p1",
      "kickMember",
      {
        clientActionId: "host-kick",
        expectedRevision: authority.exportSnapshot().revision,
        targetUid: "p3",
      },
      2_001,
    );
    expect(authority.member("p3")).toBeUndefined();
    expect(authority.consumeEvictions()).toEqual([{ uid: "p3", peerId: "peer-3" }]);
    expect(authority.project("p1").players.map((player) => player.id)).not.toContain("p3");
  });

  it("disqualifies an active player before removing their room membership", () => {
    const authority = waitingRoom();
    authority.handleCommand(
      "p1",
      "startGame",
      {
        clientActionId: "start-before-kick",
        expectedRevision: authority.exportSnapshot().revision,
      },
      2_000,
    );
    authority.handleCommand(
      "p1",
      "kickMember",
      {
        clientActionId: "active-kick",
        expectedRevision: authority.exportSnapshot().revision,
        gameId: authority.exportSnapshot().game?.id,
        targetUid: "p2",
      },
      2_001,
    );
    const snapshot = authority.exportSnapshot();
    expect(snapshot.members.p2).toBeUndefined();
    expect(snapshot.game?.players.find((player) => player.id === "p2")?.status).toBe(
      "disqualified",
    );
  });

  it("expels a disconnected waiting member after the grace deadline", () => {
    const authority = waitingRoom();
    expect(authority.setMemberOnline("p2", false, undefined, 2_000)).toBe(true);
    expect(authority.disqualifyDisconnected("p2", 122_001)).toBe(true);
    expect(authority.member("p2")).toBeUndefined();
    expect(authority.exportSnapshot().socialLog.at(-1)?.text).toMatch(/追放/);
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

    authority.handleCommand(
      "p1",
      "kickMember",
      {
        clientActionId: "kick-focused-player",
        expectedRevision: authority.exportSnapshot().revision,
        gameId: authority.exportSnapshot().game?.id,
        targetUid: "p2",
      },
      2_005,
    );
    const fallbackView = authority.project("watcher");
    const fallbackId = authority
      .exportSnapshot()
      .game?.players.find((player) => player.status === "active")?.id;
    expect(fallbackView.focusedPlayerId).toBe(fallbackId);
    expect(fallbackView.hand).toEqual(
      fallbackView.players.find((player) => player.id === fallbackId)?.cards,
    );
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
