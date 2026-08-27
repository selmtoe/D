import { defaultAvatar } from "@daifugo/avatar-schema";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PendingEffectView, RoomView } from "../app/model";
import { stealAnimationCue } from "../network/peerCues";
import { shuffleStealCandidates, StealSequence } from "../screens/StealSequence";

describe("A-steal presentation shuffle", () => {
  it("is deterministic, preserves all candidates, and does not mutate authority order", () => {
    const original = ["a", "b", "c", "d", "e"];
    const shuffled = shuffleStealCandidates(original, "victim-event-1");
    expect(shuffled).toEqual(shuffleStealCandidates(original, "victim-event-1"));
    expect([...shuffled].sort()).toEqual(original);
    expect(original).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("allocates counts across players, selects each victim position, then resolves atomically", async () => {
    const hidden = (id: string) => ({ id, visibility: "hidden" as const, blind: false });
    const room: RoomView = {
      roomId: "ABCDE",
      revision: 4,
      gameId: "game-1",
      generation: 0,
      phase: "effect",
      role: "player",
      viewerId: "p1",
      hostId: "p1",
      players: [
        {
          id: "p1",
          name: "一郎",
          avatar: defaultAvatar,
          cardCount: 3,
          cards: [],
          connection: "online",
          status: "active",
          host: true,
        },
        {
          id: "p2",
          name: "二郎",
          avatar: defaultAvatar,
          cardCount: 2,
          cards: [hidden("p2-a"), hidden("p2-b")],
          connection: "online",
          status: "active",
          host: false,
        },
        {
          id: "p3",
          name: "三郎",
          avatar: defaultAvatar,
          cardCount: 2,
          cards: [hidden("p3-a"), hidden("p3-b")],
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
      hand: [],
      pendingEffects: [],
      rankings: [],
      log: [],
    };
    const effect: PendingEffectView = {
      id: "steal-two",
      kind: "steal",
      actorId: "p1",
      requiredCount: 2,
      eligiblePlayerIds: ["p2", "p3"],
      eligibleCardIds: ["p2-a", "p2-b", "p3-a", "p3-b"],
      message: "2枚奪ってください",
    };
    const resolve = vi.fn(
      async (_payload: { selections: { targetUid: string; cardId: string }[] }) => true,
    );
    render(
      createElement(StealSequence, {
        effect,
        room,
        busy: false,
        lowPower: false,
        reducedMotion: false,
        sendCue: vi.fn(async () => true),
        resolve,
        onVisual: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "二郎から奪う枚数を増やす" }));
    fireEvent.click(screen.getByRole("button", { name: "三郎から奪う枚数を増やす" }));
    fireEvent.click(screen.getByRole("button", { name: "この配分で位置を選ぶ" }));
    fireEvent.click(screen.getAllByRole("option")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "次のプレイヤーへ" }));
    fireEvent.click(screen.getAllByRole("option")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "選択内容を確認" }));
    fireEvent.click(screen.getByRole("button", { name: "A奪いを確定" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    const payload = resolve.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    if (!payload) throw new Error("A奪いpayloadがありません");
    expect(payload.selections).toHaveLength(2);
    expect(payload.selections.map((selection) => selection.targetUid).sort()).toEqual(["p2", "p3"]);
  });

  it("shows a victim's face-up projected cards to spectators during the steal animation", async () => {
    const cards = [
      {
        id: "p2-a",
        visibility: "face" as const,
        suit: "spade" as const,
        rank: "7" as const,
        blind: false,
      },
      {
        id: "p2-b",
        visibility: "face" as const,
        suit: "heart" as const,
        rank: "9" as const,
        blind: false,
      },
    ];
    const room: RoomView = {
      roomId: "ABCDE",
      revision: 5,
      gameId: "game-1",
      generation: 0,
      phase: "effect",
      role: "spectator",
      viewerId: "watcher",
      hostId: "p1",
      focusedPlayerId: "p1",
      players: [
        {
          id: "p1",
          name: "一郎",
          avatar: defaultAvatar,
          cardCount: 1,
          cards: [],
          connection: "online",
          status: "active",
          host: true,
        },
        {
          id: "p2",
          name: "二郎",
          avatar: defaultAvatar,
          cardCount: cards.length,
          cards,
          connection: "online",
          status: "active",
          host: false,
        },
      ],
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
    const effect: PendingEffectView = {
      id: "steal-watch",
      kind: "steal",
      actorId: "p1",
      requiredCount: 1,
      eligiblePlayerIds: ["p2"],
      eligibleCardIds: cards.map((card) => card.id),
      message: "1枚奪ってください",
    };
    const onVisual = vi.fn();
    render(
      createElement(StealSequence, {
        effect,
        room,
        busy: false,
        lowPower: false,
        reducedMotion: false,
        lastCue: {
          cue: stealAnimationCue("target", "p2", { cardCount: 2, takeCount: 1 }),
          sender: "p1",
        },
        sendCue: vi.fn(async () => true),
        resolve: vi.fn(async () => true),
        onVisual,
      }),
    );

    await waitFor(() =>
      expect(onVisual).toHaveBeenCalledWith(
        expect.objectContaining({ perspective: "observer", cards }),
      ),
    );
  });
});
