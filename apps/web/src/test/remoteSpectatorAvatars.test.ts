import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { RoomView } from "../app/model";
import { remoteSpectatorParticipants } from "../game-3d/RemoteSpectatorAvatars";
import { spectatorPoseCue } from "../network/peerCues";

function room(): RoomView {
  return {
    roomId: "ABCDE",
    revision: 1,
    generation: 1,
    phase: "playing",
    role: "spectator",
    viewerId: "self-watcher",
    hostId: "player",
    players: [
      {
        id: "player",
        name: "終了プレイヤー",
        avatar: defaultAvatar,
        cardCount: 0,
        connection: "online",
        status: "finished",
        host: true,
      },
      {
        id: "departed",
        name: "退出済み",
        avatar: defaultAvatar,
        cardCount: 0,
        connection: "offline",
        status: "finished",
        present: false,
        host: false,
      },
    ],
    spectators: [
      { id: "self-watcher", name: "自分", avatar: defaultAvatar },
      { id: "other-watcher", name: "観戦者" },
    ],
    settings: { mode: "normal", blindCount: 0 },
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
  };
}

describe("remote free-roam spectators", () => {
  it("renders trusted room members, including finished players, but never the local or departed avatar", () => {
    const active = (atMs: number) =>
      spectatorPoseCue({ x: 1, y: 0.05, z: 2, yaw: 0, moving: true, freeSpectating: true }, atMs);
    const poses = new Map([
      ["self-watcher", active(1)],
      ["other-watcher", active(2)],
      ["player", active(3)],
      ["departed", active(4)],
      ["forged-outsider", active(5)],
    ]);

    const participants = remoteSpectatorParticipants(room(), poses);

    expect(participants.map((participant) => participant.id)).toEqual(["other-watcher", "player"]);
    expect(participants[0]?.avatar).toEqual(defaultAvatar);
  });
});
