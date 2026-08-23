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
});
