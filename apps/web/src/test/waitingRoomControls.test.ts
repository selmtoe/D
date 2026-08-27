import { defaultAvatar } from "@daifugo/avatar-schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerView, RoomView } from "../app/model";
import {
  canAddCpu,
  canEditRoomSettings,
  startablePlayerCount,
  WaitingRoomScreen,
} from "../screens/WaitingRoomScreen";

vi.mock("../avatar-3d/AvatarPortrait", () => ({
  AvatarPortrait: () => null,
}));

vi.mock("../waiting-3d/WaitingPlayground", () => ({
  default: ({
    members,
    onClose,
  }: {
    members: Array<{ id: string; name: string }>;
    onClose: () => void;
  }) =>
    createElement(
      "section",
      { role: "dialog", "aria-label": "3D待機室テスト" },
      ...members.map((member) => createElement("span", { key: member.id }, member.name)),
      createElement("button", { type: "button", onClick: onClose }, "待機画面へ戻る"),
    ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const player = (
  id: string,
  options: Partial<Pick<PlayerView, "name" | "connection" | "host" | "cpu">> = {},
): PlayerView => ({
  id,
  name: options.name ?? id,
  avatar: defaultAvatar,
  ...(options.cpu === undefined ? {} : { cpu: options.cpu }),
  cardCount: 0,
  connection: options.connection ?? "online",
  status: "active",
  host: options.host ?? false,
});

const roomWith = (players: PlayerView[], viewerId = "host"): RoomView => ({
  roomId: "CPU01",
  revision: 4,
  generation: 0,
  phase: "waiting",
  role: "player",
  viewerId,
  hostId: "host",
  players,
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
});

const renderWaitingRoom = (
  room: RoomView,
  overrides: Partial<ComponentProps<typeof WaitingRoomScreen>> = {},
) => {
  const props: ComponentProps<typeof WaitingRoomScreen> = {
    room,
    connection: "connected",
    busy: false,
    leave: vi.fn(),
    start: vi.fn(),
    addCpu: vi.fn(),
    removeCpu: vi.fn(),
    transferHost: vi.fn(),
    kick: vi.fn(),
    updateSettings: vi.fn(),
    openRules: vi.fn(),
    ...overrides,
  };
  render(createElement(WaitingRoomScreen, props));
  return props;
};

describe("waiting room controls", () => {
  it("allows only an idle host to change room settings or add a CPU to an open seat", () => {
    expect(canEditRoomSettings(true, false)).toBe(true);
    expect(canEditRoomSettings(true, true)).toBe(false);
    expect(canEditRoomSettings(false, false)).toBe(false);
    expect(canAddCpu(true, false, 5)).toBe(true);
    expect(canAddCpu(true, true, 5)).toBe(false);
    expect(canAddCpu(false, false, 5)).toBe(false);
    expect(canAddCpu(true, false, 6)).toBe(false);
  });

  it("lets an idle host add a CPU", () => {
    const addCpu = vi.fn();
    renderWaitingRoom(roomWith([player("host", { host: true })]), { addCpu });

    fireEvent.click(screen.getByRole("button", { name: "CPUを追加" }));

    expect(addCpu).toHaveBeenCalledOnce();
  });

  it("hides the add action from a non-host and when all six seats are occupied", () => {
    const host = player("host", { host: true });
    const guest = player("guest");
    const view = renderWaitingRoom(roomWith([host, guest], "guest"));
    expect(screen.queryByRole("button", { name: "CPUを追加" })).toBeNull();

    cleanup();
    renderWaitingRoom(
      roomWith([host, guest, player("p3"), player("p4"), player("p5"), player("p6")]),
    );
    expect(screen.queryByRole("button", { name: "CPUを追加" })).toBeNull();
    expect(view.addCpu).not.toHaveBeenCalled();
  });

  it("disables CPU mutations while another command is busy", () => {
    renderWaitingRoom(
      roomWith([
        player("host", { host: true }),
        player("cpu-1", { name: "CPU 1", cpu: true, connection: "offline" }),
      ]),
      { busy: true },
    );

    expect(screen.getByRole("button", { name: "CPUを追加" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "CPU 1のCPU席を削除" })).toBeDisabled();
  });

  it("marks an experimental CPU seat and removes it through removeCpu only", () => {
    const removeCpu = vi.fn();
    const kick = vi.fn();
    const transferHost = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWaitingRoom(
      roomWith([
        player("host", { host: true }),
        player("cpu-1", { name: "CPU 1", cpu: true, connection: "offline" }),
      ]),
      { removeCpu, kick, transferHost },
    );

    expect(screen.getByText("CPU")).toBeVisible();
    expect(screen.getByText("CPUプレイヤー · 常時接続")).toBeVisible();
    expect(screen.queryByRole("button", { name: "CPU 1へホストを移譲" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "CPU 1のCPU席を削除" }));

    expect(removeCpu).toHaveBeenCalledWith("cpu-1");
    expect(kick).not.toHaveBeenCalled();
    expect(transferHost).not.toHaveBeenCalled();
  });

  it("counts connected humans and CPU seats toward the existing three-player start minimum", () => {
    const room = roomWith([
      player("host", { host: true }),
      player("offline-human", { connection: "offline" }),
      player("cpu-1", { cpu: true, connection: "offline" }),
    ]);
    expect(startablePlayerCount(room)).toBe(2);

    const view = renderWaitingRoom(room);
    expect(screen.getByRole("button", { name: "ゲームを始める" })).toBeDisabled();

    cleanup();
    const readyRoom = roomWith([...room.players, player("online-human")]);
    expect(startablePlayerCount(readyRoom)).toBe(3);
    renderWaitingRoom(readyRoom, { start: view.start });
    expect(screen.getByRole("button", { name: "ゲームを始める" })).toBeEnabled();
    expect(screen.getByText("3人で開始できます")).toBeVisible();
  });

  it("opens the 3D playground with waiting members and returns to the room screen", async () => {
    renderWaitingRoom(
      roomWith([
        player("host", { name: "ホスト", host: true }),
        player("guest", { name: "参加者" }),
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "3D待機室で遊ぶ" }));

    const playground = await screen.findByRole("dialog", { name: "3D待機室テスト" });
    expect(playground).toHaveTextContent("ホスト");
    expect(playground).toHaveTextContent("参加者");

    fireEvent.click(screen.getByRole("button", { name: "待機画面へ戻る" }));
    expect(screen.queryByRole("dialog", { name: "3D待機室テスト" })).toBeNull();
  });
});
