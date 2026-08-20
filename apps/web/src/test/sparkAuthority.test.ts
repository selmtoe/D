import { defaultAvatar } from "@daifugo/avatar-schema";
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
    expect(authority.handleCommand(opener.id, "submitPlay", payload, 2_101)).toEqual({
      duplicate: true,
    });
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
});
