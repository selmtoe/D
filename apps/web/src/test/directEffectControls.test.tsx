import { defaultAvatar } from "@daifugo/avatar-schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingEffectView, RoomView } from "../app/model";
import { DirectEffectControls } from "../screens/GameScreen";

afterEach(cleanup);

const room: RoomView = {
  roomId: "ROOM1",
  revision: 1,
  generation: 0,
  phase: "effect",
  role: "player",
  viewerId: "actor",
  hostId: "actor",
  players: [
    {
      id: "actor",
      name: "自分",
      avatar: defaultAvatar,
      cardCount: 2,
      connection: "online",
      status: "active",
      host: true,
    },
    {
      id: "target",
      name: "相手",
      avatar: defaultAvatar,
      cardCount: 2,
      connection: "online",
      status: "active",
      host: false,
    },
  ],
  spectators: [],
  settings: { mode: "normal", blindCount: 0 },
  direction: 1,
  revolution: false,
  jackBack: false,
  suitLock: [],
  field: [],
  discard: [],
  hand: [{ id: "own-card", visibility: "face", suit: "heart", rank: "7", blind: false }],
  pendingEffects: [],
  rankings: [],
  log: [],
};

const steal: PendingEffectView = {
  id: "steal",
  kind: "steal",
  actorId: "actor",
  requiredCount: 1,
  eligibleCardIds: ["back"],
  eligiblePlayerIds: ["target"],
  message: "steal",
};

describe("direct table effect controls", () => {
  it("confirms A-steal after an actual opponent card has been selected", () => {
    const confirm = vi.fn();
    render(
      <DirectEffectControls
        effect={steal}
        room={room}
        selectedIds={["back"]}
        targets={{ back: "target" }}
        busy={false}
        chooseTarget={() => undefined}
        clear={() => undefined}
        confirm={confirm}
      />,
    );
    expect(screen.getByText("相手の席にある裏向きのカードを直接タップ")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "A奪いを確定" }));
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("directs a selected 7 card to a character instead of a select box", () => {
    const chooseTarget = vi.fn();
    render(
      <DirectEffectControls
        effect={{ ...steal, id: "give", kind: "give" }}
        room={room}
        selectedIds={["own-card"]}
        targets={{}}
        pendingGiveCardId="own-card"
        busy={false}
        chooseTarget={chooseTarget}
        clear={() => undefined}
        confirm={() => undefined}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "相手へ" }));
    expect(chooseTarget).toHaveBeenCalledWith("target");
    expect(screen.getByRole("button", { name: "7渡しを確定" })).toBeDisabled();
  });

  it("shows the card-to-player relationship after a 7 has been dropped", () => {
    render(
      <DirectEffectControls
        effect={{ ...steal, id: "give", kind: "give" }}
        room={room}
        selectedIds={["own-card"]}
        targets={{ "own-card": "target" }}
        busy={false}
        chooseTarget={() => undefined}
        clear={() => undefined}
        confirm={() => undefined}
      />,
    );
    expect(screen.getByLabelText("7渡しの割り当て")).toHaveTextContent("♥7 → 相手");
    expect(screen.getByRole("button", { name: "7渡しを確定" })).toBeEnabled();
  });
});
