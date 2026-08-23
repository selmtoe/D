import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { defaultAvatar } from "@daifugo/avatar-schema";
import { AuthoritativeE2EServer } from "./support/authoritativeServer";

const profile = (name: string) => ({ name, avatar: defaultAvatar });
const captureScreenshots =
  process.env.CI !== "true" || process.env.DAIFUGO_CAPTURE_VISUAL_E2E === "1";

async function capture(page: Page, path: string): Promise<void> {
  if (!captureScreenshots) return;
  await page.waitForTimeout(900);
  await page.screenshot({ path });
}

async function closeContext(context: BrowserContext): Promise<void> {
  await Promise.race([
    context.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

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

async function advanceToThirdPlayer(authority: AuthoritativeE2EServer): Promise<void> {
  for (const [uid, cardId, blindConfirmed] of [
    ["uid-host", "c-a1", false],
    ["uid-player-2", "c-b3", true],
  ] as const) {
    await authority.handle(uid, {
      op: "command",
      name: "submitPlay",
      payload: {
        ...(await roomBase(authority)),
        clientActionId: `visual-stack-${cardId}`,
        cardIds: [cardId],
        mimics: [],
        blindConfirmed,
      },
    });
  }
}

async function reconnectPage(
  browser: Browser,
  authority: AuthoritativeE2EServer,
  uid: string,
  role: "player" | "spectator" = "player",
  viewport = { width: 1280, height: 900 },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  await authority.install(context, uid, { renderCanvas: true, cueBridge: true });
  await context.addInitScript(
    ({ roomId, token }) => {
      sessionStorage.setItem(`daifugo-reconnect-${roomId}`, token);
    },
    { roomId: authority.roomId, token: authority.currentToken(uid) },
  );
  const page = await context.newPage();
  await page.goto(`/?room=${authority.roomId}&role=${role}`);
  if (role === "player") {
    await expect(page.getByRole("button", { name: "パス" })).toBeVisible();
  } else {
    await expect(page.getByText("プレイヤー視点", { exact: true })).toBeVisible();
  }
  return { context, page };
}

test.describe("single-canvas visual gameplay inspection", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    void browserName;
    const spectatorCoverage = testInfo.title.includes("spectators can inspect");
    test.skip(
      testInfo.project.name !== "desktop-chromium" && !spectatorCoverage,
      "視覚証拠はdesktopで一度だけ撮影",
    );
  });

  test("right cards stay in front and the A-steal actor camera shows the victim row", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    const actor = await reconnectPage(browser, authority, "uid-player-3");
    try {
      await expect(actor.page.locator("canvas").first()).toBeVisible();
      await capture(actor.page, testInfo.outputPath("hand-right-card-front.png"));
      await advanceToSteal(authority);
      const effect = actor.page.getByRole("region", { name: "A奪い" });
      await expect(effect).toBeVisible();
      await actor.page.getByRole("option").click();
      await capture(actor.page, testInfo.outputPath("a-steal-actor-view.png"));
    } finally {
      await closeContext(actor.context);
    }
  });

  test("selected cards lift while field plays and the flowed-card pile stay on the table", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    await advanceToThirdPlayer(authority);
    const player = await reconnectPage(browser, authority, "uid-player-3");
    try {
      await expect(player.page.locator("canvas").first()).toBeVisible();
      const king = player.page.getByRole("option", { name: /クラブK/ });
      await king.click();
      await expect(king).toHaveAttribute("aria-selected", "true");
      await capture(player.page, testInfo.outputPath("selected-field-stack.png"));
    } finally {
      await closeContext(player.context);
    }
  });

  test("the victim keeps an unobstructed table view during a direct A-steal", async ({
    browser,
  }, testInfo) => {
    test.skip(
      process.env.CI === "true",
      "奪われる側の実WebGL画像検査は実機専用（CIのソフトウェアGPUではP2Pポーリングが不安定）",
    );
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    await advanceToSteal(authority);
    const victim = await reconnectPage(browser, authority, "uid-player-2");
    try {
      await expect(victim.page.getByText(/プレイヤー3が効果を処理しています/)).toBeVisible();
      await capture(victim.page, testInfo.outputPath("a-steal-victim-view.png"));
    } finally {
      await closeContext(victim.context);
    }
  });

  test("spectators can inspect a player view and walk freely around the table", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    await authority.handle("uid-spectator", {
      op: "command",
      name: "joinRoomAsSpectator",
      payload: {
        ...(await roomBase(authority)),
        clientActionId: "visual-join-spectator",
        profile: profile("観戦者"),
      },
    });
    const mobile = testInfo.project.name === "mobile-chromium";
    const spectator = await reconnectPage(
      browser,
      authority,
      "uid-spectator",
      "spectator",
      mobile ? { width: 412, height: 915 } : { width: 1280, height: 900 },
    );
    try {
      await expect(spectator.page.locator("canvas").first()).toBeVisible();
      await expect(spectator.page.getByRole("listbox", { name: /観戦中の手札/ })).toBeVisible();
      await capture(spectator.page, testInfo.outputPath("spectator-follow-view.png"));

      await spectator.page.getByRole("button", { name: "自由移動" }).click();
      await expect(
        spectator.page.getByText(mobile ? /ボタンで移動/ : /WASD／矢印で移動/),
      ).toBeVisible();
      await expect(spectator.page.getByRole("listbox", { name: /観戦中の手札/ })).toHaveCount(0);
      const canvas = spectator.page.locator("canvas").first();
      const bounds = await canvas.boundingBox();
      expect(bounds).not.toBeNull();
      if (bounds) {
        await spectator.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await spectator.page.mouse.down();
        await spectator.page.mouse.move(
          bounds.x + bounds.width / 2 + 85,
          bounds.y + bounds.height / 2 - 20,
          { steps: 8 },
        );
        await spectator.page.mouse.up();
      }
      if (mobile) {
        const moveRight = spectator.page.getByRole("button", { name: "右へ移動" });
        await moveRight.dispatchEvent("pointerdown");
        await spectator.page.waitForTimeout(450);
        await moveRight.dispatchEvent("pointerup");
      } else {
        await spectator.page.keyboard.down("d");
        await spectator.page.waitForTimeout(650);
        await spectator.page.keyboard.up("d");
      }
      await capture(spectator.page, testInfo.outputPath("spectator-free-roam.png"));
      expect(
        await spectator.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
    } finally {
      await closeContext(spectator.context);
    }
  });
});
