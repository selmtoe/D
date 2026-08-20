import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { defaultAvatar } from "@daifugo/avatar-schema";
import { stealAnimationCue } from "../src/network/peerCues";
import { AuthoritativeE2EServer } from "./support/authoritativeServer";

const profile = (name: string) => ({ name, avatar: defaultAvatar });

async function roomBase(authority: AuthoritativeE2EServer) {
  return (await authority.handle("uid-host", {
    op: "roomBase",
    roomId: authority.roomId,
  })) as Record<string, unknown>;
}

async function seedStartedRoom(authority: AuthoritativeE2EServer): Promise<void> {
  await authority.handle("uid-host", {
    op: "command",
    name: "createRoom",
    payload: { clientActionId: "visual-create", profile: profile("ホスト") },
  });
  await authority.handle("uid-player-2", {
    op: "command",
    name: "joinRoomAsPlayer",
    payload: {
      ...(await roomBase(authority)),
      clientActionId: "visual-join-2",
      profile: profile("プレイヤー2"),
    },
  });
  await authority.handle("uid-player-3", {
    op: "command",
    name: "joinRoomAsPlayer",
    payload: {
      ...(await roomBase(authority)),
      clientActionId: "visual-join-3",
      profile: profile("プレイヤー3"),
    },
  });
  await authority.handle("uid-host", {
    op: "command",
    name: "startGame",
    payload: { ...(await roomBase(authority)), clientActionId: "visual-start" },
  });
}

async function advanceToSteal(authority: AuthoritativeE2EServer): Promise<void> {
  for (const [uid, cardId] of [
    ["uid-host", "c-a1"],
    ["uid-player-2", "c-b1"],
    ["uid-player-3", "c-c1"],
  ] as const) {
    await authority.handle(uid, {
      op: "command",
      name: "submitPlay",
      payload: {
        ...(await roomBase(authority)),
        clientActionId: `visual-play-${cardId}`,
        cardIds: [cardId],
        mimics: [],
        blindConfirmed: false,
      },
    });
  }
}

async function reconnectPage(
  browser: Browser,
  authority: AuthoritativeE2EServer,
  uid: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await authority.install(context, uid, { renderCanvas: true, cueBridge: true });
  await context.addInitScript(
    ({ roomId, token }) => {
      sessionStorage.setItem(`daifugo-reconnect-${roomId}`, token);
    },
    { roomId: authority.roomId, token: authority.currentToken(uid) },
  );
  const page = await context.newPage();
  await page.goto(`/?room=${authority.roomId}&role=player`);
  await expect(page.getByRole("button", { name: "パス" })).toBeVisible();
  return { context, page };
}

test.describe("single-canvas visual gameplay inspection", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "視覚証拠はdesktopで一度だけ撮影");
  });

  test("right cards stay in front and the A-steal actor camera shows the victim row", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    const actor = await reconnectPage(browser, authority, "uid-player-3");
    try {
      await actor.page.waitForTimeout(900);
      await actor.page.screenshot({ path: testInfo.outputPath("hand-right-card-front.png") });
      await advanceToSteal(authority);
      const effect = actor.page.getByRole("region", { name: "A奪い" });
      await expect(effect).toBeVisible();
      await effect.getByRole("button", { name: "プレイヤー2から奪う枚数を増やす" }).click();
      await effect.getByRole("button", { name: "この配分で位置を選ぶ" }).click();
      await effect.getByRole("option", { name: /1番目/ }).hover();
      await effect.getByRole("option", { name: /1番目/ }).click();
      await actor.page.waitForTimeout(900);
      await actor.page.screenshot({ path: testInfo.outputPath("a-steal-actor-view.png") });
    } finally {
      await actor.context.close();
    }
  });

  test("the victim keeps a table view and receives the stealer finger position", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    await advanceToSteal(authority);
    const victim = await reconnectPage(browser, authority, "uid-player-2");
    try {
      await authority.handle("uid-player-3", {
        op: "cueSend",
        roomId: authority.roomId,
        payload: {
          cue: stealAnimationCue("point", "uid-player-2", {
            cardCount: 2,
            takeCount: 1,
            slot: 1,
            pointerX: 0.75,
            selectedSlots: [],
          }),
        },
      });
      await expect(victim.page.getByRole("heading", { name: "相手が札を選択中" })).toBeVisible();
      await victim.page.waitForTimeout(900);
      await victim.page.screenshot({ path: testInfo.outputPath("a-steal-victim-view.png") });
    } finally {
      await victim.context.close();
    }
  });
});
