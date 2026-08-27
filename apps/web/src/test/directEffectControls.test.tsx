import { defaultAvatar } from "@daifugo/avatar-schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingEffectView, RoomView } from "../app/model";
import { EffectPanel } from "../screens/EffectPanel";
import {
  DirectEffectControls,
  eligibleEffectTargetPlayerIds,
  selectableEffectCardIds,
  shouldKeepOwnHandBright,
} from "../screens/GameScreen";

afterEach(cleanup);

describe("direct effect card eligibility", () => {
  it("keeps the hand bright while choosing Q bomber or K collect", () => {
    expect(shouldKeepOwnHandBright("bomber")).toBe(true);
    expect(shouldKeepOwnHandBright("collect")).toBe(true);
    expect(shouldKeepOwnHandBright("give")).toBe(false);
    expect(shouldKeepOwnHandBright(undefined)).toBe(false);
  });

  it("temporarily excludes a K-recovery card that is still moving into discard", () => {
    const selectable = selectableEffectCardIds(["moving", "ready"], "collect", new Set(["moving"]));

    expect([...selectable]).toEqual(["ready"]);
    expect([...selectableEffectCardIds(["moving"], "discard", new Set(["moving"]))]).toEqual([
      "moving",
    ]);
  });
});

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
  it("allows every active opponent when A-steal omits an explicit player list", () => {
    expect([...eligibleEffectTargetPlayerIds(room)]).toEqual(["target"]);
    expect([...eligibleEffectTargetPlayerIds(room, [])]).toEqual([]);
  });

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
        effect={{ ...steal, id: "give", kind: "give", eligibleCardIds: ["own-card"] }}
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
        effect={{ ...steal, id: "give", kind: "give", eligibleCardIds: ["own-card"] }}
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

  it("rejects selections whose card or target is no longer eligible", () => {
    const confirm = vi.fn();
    const { rerender } = render(
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
    const button = screen.getByRole("button", { name: "A奪いを確定" });
    expect(button).toBeEnabled();

    rerender(
      <DirectEffectControls
        effect={{ ...steal, eligibleCardIds: [] }}
        room={room}
        selectedIds={["back"]}
        targets={{ back: "target" }}
        busy={false}
        chooseTarget={() => undefined}
        clear={() => undefined}
        confirm={confirm}
      />,
    );
    expect(button).toBeDisabled();

    rerender(
      <DirectEffectControls
        effect={{ ...steal, eligiblePlayerIds: [] }}
        room={room}
        selectedIds={["back"]}
        targets={{ back: "target" }}
        busy={false}
        chooseTarget={() => undefined}
        clear={() => undefined}
        confirm={confirm}
      />,
    );
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("Q bomber controls", () => {
  it("keeps the submitted ranks fixed while resolution is busy", () => {
    const bomber: PendingEffectView = {
      id: "bomber",
      kind: "bomber",
      actorId: "actor",
      requiredCount: 1,
      message: "bomber",
    };
    const resolve = vi.fn();
    const view = render(<EffectPanel effect={bomber} room={room} busy={false} resolve={resolve} />);
    const ace = screen.getByRole("button", { name: "A" });
    fireEvent.click(ace);
    fireEvent.click(screen.getByRole("button", { name: "効果を確定する" }));
    expect(resolve).toHaveBeenCalledWith(bomber, { ranks: ["A"] });

    view.rerender(<EffectPanel effect={bomber} room={room} busy resolve={resolve} />);
    const king = screen.getByRole("button", { name: "K" });
    expect(ace).toBeDisabled();
    expect(king).toBeDisabled();
    fireEvent.click(king);
    expect(ace).toHaveAttribute("aria-pressed", "true");
    expect(king).toHaveAttribute("aria-pressed", "false");
  });
});
