import { defaultAvatar } from "@daifugo/avatar-schema";
import { describe, expect, it } from "vitest";
import type { RoomView } from "../app/model";
import { formatEffectNotice } from "../screens/GameScreen";

const players: RoomView["players"] = [
  {
    id: "actor",
    name: "あかり",
    avatar: defaultAvatar,
    cardCount: 4,
    connection: "online",
    status: "active",
    present: true,
    host: true,
  },
  {
    id: "target",
    name: "ゆうき",
    avatar: defaultAvatar,
    cardCount: 4,
    connection: "online",
    status: "active",
    present: true,
    host: false,
  },
];

describe("effect notification wording", () => {
  it("describes A-steal from the actor, victim, and observer viewpoints", () => {
    const notice = { kind: "steal", actorId: "actor", targetId: "target", cardCount: 2 } as const;

    expect(formatEffectNotice(notice, "actor", players)).toBe(
      "A奪い！ ゆうきからカードを2枚奪った！",
    );
    expect(formatEffectNotice(notice, "target", players)).toBe(
      "A奪いであかりにカードを2枚奪われた！",
    );
    expect(formatEffectNotice(notice, "watcher", players)).toContain("あかりがゆうきから");
  });

  it("tells the 7-give receiver who sent the card", () => {
    expect(
      formatEffectNotice(
        { kind: "give", actorId: "actor", targetId: "target", cardCount: 1 },
        "target",
        players,
      ),
    ).toBe("7渡し！ あかりからカードを1枚受け取った！");
  });

  it("names Q-bomber, K-collect, and 10-discard results", () => {
    expect(
      formatEffectNotice(
        { kind: "bomber", actorId: "actor", ranks: ["9", "Joker"], cardCount: 5 },
        "actor",
        players,
      ),
    ).toBe("Qボンバー！ 9・Jokerを5枚捨てた！");
    expect(
      formatEffectNotice({ kind: "collect", actorId: "actor", cardCount: 3 }, "target", players),
    ).toBe("あかりのK回収！ カードを3枚回収した！");
    expect(
      formatEffectNotice({ kind: "discard", actorId: "actor", cardCount: 1 }, "actor", players),
    ).toBe("10捨て！ カードを1枚捨てた！");
  });
});
