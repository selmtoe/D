import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import {
  MAX_SPARK_AUTHORITY_REPLAY_BYTES,
  MAX_SPARK_AUTHORITY_REPLAY_FRAMES,
  SparkAuthority,
} from "../network/sparkAuthority";

const profile = (name: string) => ({ name, avatar: structuredClone(defaultAvatar) });

function startedAuthority(): SparkAuthority {
  const authority = SparkAuthority.create("REPLY", "p1", "peer-1", profile("一郎"), 1_000);
  authority.join({ uid: "p2", peerId: "peer-2", profile: profile("二郎"), role: "player" }, 1_001);
  authority.join({ uid: "p3", peerId: "peer-3", profile: profile("三郎"), role: "player" }, 1_002);
  authority.handleCommand(
    "p1",
    "startGame",
    {
      clientActionId: "start-authority-replay",
      expectedRevision: authority.exportSnapshot().revision,
    },
    2_000,
  );
  return authority;
}

describe("Spark authority replay", () => {
  it("records complete GameStates but never projects them to an active player", () => {
    const authority = startedAuthority();
    const snapshot = authority.exportSnapshot({ includeReplay: true });
    const opponent = snapshot.game!.players.find((player) => player.id === "p2")!;
    const view = authority.project("p1");

    expect(snapshot.authoritativeReplay).toHaveLength(1);
    expect(snapshot.authoritativeReplay?.[0]).toMatchObject({
      revision: snapshot.revision,
      capturedAtMs: 2_000,
      game: { id: snapshot.game!.id },
    });
    expect(view.authoritativeReplay).toBeUndefined();
    expect(view.players.find((player) => player.id === "p2")?.cards?.[0]).toMatchObject({
      visibility: "hidden",
    });
    expect(
      view.players
        .find((player) => player.id === "p2")
        ?.cards?.some(
          (card) =>
            card.visibility === "face" &&
            card.suit === opponent.hand[0]!.card.suit &&
            card.rank === opponent.hand[0]!.card.rank,
        ),
    ).toBe(false);
  });

  it("projects every recorded hand face-up only after the room finishes", () => {
    const authority = startedAuthority();
    authority.join(
      {
        uid: "watcher",
        peerId: "peer-watcher",
        profile: profile("観戦者"),
        role: "spectator",
      },
      2_100,
    );

    expect(authority.project("watcher").authoritativeReplay).toBeUndefined();
    expect(authority.project("p1").authoritativeReplay).toBeUndefined();

    const finished = authority.exportSnapshot({ includeReplay: true });
    finished.status = "finished";
    finished.game!.phase = "finished";
    const finishedReplay = SparkAuthority.restore(finished).project("p1").authoritativeReplay;
    const cards = finishedReplay!.at(-1)!.game.players.flatMap((player) => player.hand);
    expect(cards).toHaveLength(54);
    expect(cards.every((card) => card.visibility === "face")).toBe(true);
  });

  it("restores snapshots written before the optional replay field existed", () => {
    const legacy = startedAuthority().exportSnapshot({ includeReplay: true });
    delete legacy.authoritativeReplay;
    const restored = SparkAuthority.restore(legacy);

    expect(restored.exportSnapshot({ includeReplay: true }).authoritativeReplay).toEqual([]);
    expect(restored.project("p1").authoritativeReplay).toBeUndefined();
  });

  it("does not spend replay capacity on chat-only room revisions", () => {
    const authority = startedAuthority();
    authority.handleCommand(
      "p1",
      "sendChat",
      {
        clientActionId: "replay-chat-only",
        expectedRevision: authority.exportSnapshot().revision,
        text: "よろしく",
      },
      2_100,
    );

    expect(authority.exportSnapshot({ includeReplay: true }).authoritativeReplay).toHaveLength(1);
  });

  it("rejects malformed frames and enforces count and byte caps on restore", () => {
    const snapshot = startedAuthority().exportSnapshot({ includeReplay: true });
    const game = snapshot.game!;
    snapshot.authoritativeReplay = [
      ...Array.from({ length: MAX_SPARK_AUTHORITY_REPLAY_FRAMES + 24 }, (_, index) => ({
        revision: 10 + index,
        capturedAtMs: 2_000 + index,
        game: { ...structuredClone(game), version: index },
      })),
      { revision: -1, capturedAtMs: Number.NaN, game },
    ];

    const restored = SparkAuthority.restore(snapshot).exportSnapshot({
      includeReplay: true,
    }).authoritativeReplay!;
    expect(restored.length).toBeLessThanOrEqual(MAX_SPARK_AUTHORITY_REPLAY_FRAMES);
    expect(new TextEncoder().encode(JSON.stringify(restored)).byteLength).toBeLessThanOrEqual(
      MAX_SPARK_AUTHORITY_REPLAY_BYTES,
    );
    expect(restored.every((frame) => frame.revision >= 0)).toBe(true);
  });
});
