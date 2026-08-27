import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import { OfflineCpuSession } from "../network/offlineCpuSession";

describe("offline CPU room session", () => {
  it("creates the normal four-player waiting room entirely in memory", async () => {
    const session = OfflineCpuSession.create({ name: "デバッグ担当", avatar: defaultAvatar });
    try {
      const view = session.currentView();
      expect(view).toMatchObject({
        roomId: session.roomId,
        localOnly: true,
        phase: "waiting",
        role: "player",
        viewerId: session.uid,
        hostId: session.uid,
      });
      expect(view.players).toHaveLength(4);
      expect(view.players.filter((player) => player.cpu).map((player) => player.name)).toEqual([
        "CPU 1",
        "CPU 2",
        "CPU 3",
      ]);
      expect(session.currentMode()).toBe("webrtc");
    } finally {
      await session.stop();
    }
  });

  it("uses production room commands and projections when starting a match", async () => {
    const session = OfflineCpuSession.create({ name: "私", avatar: defaultAvatar });
    try {
      const waiting = session.currentView();
      await session.sendCommand("updateRoomSettings", {
        expectedRevision: waiting.revision,
        settings: { mode: "blind", blindCount: 2 },
      });
      const configured = session.currentView();
      expect(configured.settings).toEqual({ mode: "blind", blindCount: 2 });

      await session.sendCommand("startGame", {
        expectedRevision: configured.revision,
        gameId: null,
      });
      const playing = session.currentView();
      expect(playing.localOnly).toBe(true);
      expect(playing.phase).toBe("playing");
      expect(playing.gameId).toBeTruthy();
      expect(playing.players).toHaveLength(4);
      expect(playing.hand.length).toBeGreaterThan(0);
    } finally {
      await session.stop();
    }
  });
});
