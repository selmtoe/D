import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children: ReactNode }) => <div data-testid="three-html">{children}</div>,
}));

import {
  AVATAR_EMOTE_DURATION_MS,
  AvatarEmote,
  avatarEmotePresentation,
  avatarEmoteRemainingMs,
  latestAvatarEmotesByPlayer,
  type AvatarEmoteCue,
  type PlayerEmoteCue,
} from "../game-3d/AvatarEmote";

function cue(eventId: string, emote: AvatarEmoteCue["emote"], atMs: number): AvatarEmoteCue {
  return { version: 1, type: "emote", eventId, emote, atMs };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("avatar emote presentation", () => {
  it("maps every existing peer cue kind to a visible symbol", () => {
    expect(avatarEmotePresentation("surprise")).toMatchObject({ symbol: "!", label: "びっくり" });
    expect(avatarEmotePresentation("applause")).toMatchObject({ symbol: "👏", label: "拍手" });
    expect(avatarEmotePresentation("thinking")).toMatchObject({ symbol: "🤔", label: "考え中" });
  });

  it("selects the newest unexpired cue independently for each player", () => {
    const emotes: PlayerEmoteCue[] = [
      { sender: "alice", cue: cue("alice-new", "surprise", 9_900) },
      {
        sender: "bob",
        cue: cue("bob-expired", "thinking", 10_000 - AVATAR_EMOTE_DURATION_MS - 1),
      },
      { sender: "alice", cue: cue("alice-old", "applause", 9_000) },
      { sender: "carol", cue: cue("carol-future", "applause", 10_500) },
    ];

    const active = latestAvatarEmotesByPlayer(emotes, 10_000);

    expect([...active.keys()]).toEqual(["alice", "carol"]);
    expect(active.get("alice")).toMatchObject({
      playerId: "alice",
      cue: { eventId: "alice-new" },
      presentation: { symbol: "!" },
      remainingMs: AVATAR_EMOTE_DURATION_MS - 100,
    });
    expect(active.get("carol")?.remainingMs).toBe(AVATAR_EMOTE_DURATION_MS);
  });

  it("uses the later input when timestamps tie and handles invalid durations safely", () => {
    const tied: PlayerEmoteCue[] = [
      { sender: "alice", cue: cue("first", "surprise", 100) },
      { sender: "alice", cue: cue("second", "applause", 100) },
    ];

    expect(latestAvatarEmotesByPlayer(tied, 101).get("alice")?.cue.eventId).toBe("second");
    expect(avatarEmoteRemainingMs(tied[0]!.cue, 101, 0)).toBe(0);
  });

  it("renders only the requested player's latest emote above the avatar", () => {
    const emotes: PlayerEmoteCue[] = [
      { sender: "alice", cue: cue("alice-1", "applause", 1_000) },
      { sender: "bob", cue: cue("bob-1", "surprise", 1_100) },
      { sender: "alice", cue: cue("alice-2", "thinking", 1_200) },
    ];

    const { rerender } = render(<AvatarEmote playerId="alice" emotes={emotes} nowMs={1_300} />);

    expect(screen.getByRole("img", { name: "考え中のエモート" })).toHaveTextContent("🤔");
    expect(screen.getByRole("img")).toHaveAttribute("data-avatar-emote-player-id", "alice");
    expect(screen.getByRole("img")).toHaveAttribute("data-avatar-emote-event-id", "alice-2");

    rerender(
      <AvatarEmote playerId="alice" emotes={emotes} nowMs={1_200 + AVATAR_EMOTE_DURATION_MS + 1} />,
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("removes a wall-clock driven emote when its display period ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const emotes: PlayerEmoteCue[] = [
      { sender: "alice", cue: cue("alice-live", "surprise", 20_000) },
    ];
    render(<AvatarEmote playerId="alice" emotes={emotes} durationMs={500} />);

    expect(screen.getByRole("img", { name: "びっくりのエモート" })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(501);
    });
    expect(screen.queryByRole("img")).toBeNull();
  });
});
