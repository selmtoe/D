import { defaultAvatar } from "@daifugo/avatar-schema";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerView, RoomView } from "../app/model";
import { ResultScreen } from "../screens/ResultScreen";

vi.mock("../avatar-3d/AvatarPortrait", () => ({
  AvatarPortrait: ({ label }: { label: string }) => <span aria-label={label} />,
}));

afterEach(cleanup);

const player = (id: string, name: string): PlayerView => ({
  id,
  name,
  avatar: defaultAvatar,
  cardCount: 0,
  connection: "online",
  status: "finished",
  host: id === "p1",
});

describe("result rankings", () => {
  it("renders seat-ordered ranking data in actual place order", () => {
    const room: RoomView = {
      roomId: "RESULT",
      revision: 9,
      generation: 0,
      phase: "finished",
      role: "player",
      viewerId: "p1",
      hostId: "p1",
      players: [player("p1", "一郎"), player("p2", "二郎"), player("p3", "三郎")],
      spectators: [],
      settings: { mode: "normal", blindCount: 0 },
      direction: 1,
      revolution: false,
      jackBack: false,
      suitLock: [],
      field: [],
      discard: [],
      hand: [],
      pendingEffects: [],
      rankings: [
        { playerId: "p1", place: 1 },
        { playerId: "p2", place: 3 },
        { playerId: "p3", place: 2 },
      ],
      log: [],
    };

    render(
      <ResultScreen room={room} busy={false} leave={() => undefined} rematch={() => undefined} />,
    );

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("1位一郎"),
      expect.stringContaining("2位三郎"),
      expect.stringContaining("3位二郎"),
    ]);
  });

  it("does not offer the host-only rematch action to another player", () => {
    const room: RoomView = {
      roomId: "RESULT",
      revision: 9,
      generation: 0,
      phase: "finished",
      role: "player",
      viewerId: "p2",
      hostId: "p1",
      players: [player("p1", "一郎"), player("p2", "二郎"), player("p3", "三郎")],
      spectators: [],
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

    render(<ResultScreen room={room} busy={false} leave={() => undefined} rematch={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "同じ部屋で次のゲーム" })).toBeNull();
    expect(screen.getByText(/ホストが次のゲーム/)).toBeInTheDocument();
  });

  it("does not offer a rematch to a spectator even if a stale host id matches", () => {
    const room: RoomView = {
      roomId: "RESULT",
      revision: 9,
      generation: 0,
      phase: "finished",
      role: "spectator",
      viewerId: "watcher",
      hostId: "watcher",
      players: [player("p1", "一郎")],
      spectators: [{ id: "watcher", name: "観戦者" }],
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

    render(<ResultScreen room={room} busy={false} leave={vi.fn()} rematch={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "同じ部屋で次のゲーム" })).toBeNull();
  });

  it("does not offer a rematch to a disqualified player with a stale host id", () => {
    const disqualifiedHost = { ...player("p1", "一郎"), status: "disqualified" as const };
    const room: RoomView = {
      roomId: "RESULT",
      revision: 9,
      generation: 0,
      phase: "finished",
      role: "spectator",
      viewerId: "p1",
      hostId: "p1",
      players: [disqualifiedHost, player("p2", "二郎"), player("p3", "三郎")],
      spectators: [],
      settings: { mode: "blind", blindCount: 1 },
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

    render(<ResultScreen room={room} busy={false} leave={vi.fn()} rematch={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "同じ部屋で次のゲーム" })).toBeNull();
  });

  it("shows a rematch or connection failure", () => {
    const room: RoomView = {
      roomId: "RESULT",
      revision: 9,
      generation: 0,
      phase: "finished",
      role: "player",
      viewerId: "p1",
      hostId: "p1",
      players: [player("p1", "一郎"), player("p2", "二郎"), player("p3", "三郎")],
      spectators: [],
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

    render(
      <ResultScreen
        room={room}
        busy={false}
        error="ホストへ接続できません"
        leave={() => undefined}
        rematch={() => undefined}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("ホストへ接続できません");
  });
});
