import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { defaultAvatar } from "@daifugo/avatar-schema";
import type { RoomView } from "../src/app/model";
import { AuthoritativeE2EServer } from "./support/authoritativeServer";

const profile = (name: string) => ({ name, avatar: defaultAvatar });
const captureScreenshots =
  process.env.CI !== "true" || process.env.DAIFUGO_CAPTURE_VISUAL_E2E === "1";

async function capture(page: Page, path: string): Promise<void> {
  if (!captureScreenshots) return;
  await page.waitForTimeout(900);
  await page.screenshot({ path });
}

async function readFreeRoamPose(page: Page): Promise<{
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}> {
  const raw = await page.locator("canvas").first().getAttribute("data-free-roam-pose");
  expect(raw).not.toBeNull();
  const [x = 0, y = 0, z = 0, yaw = 0, pitch = 0] = String(raw).split(",").map(Number);
  return { x, y, z, yaw, pitch };
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

async function roomView(authority: AuthoritativeE2EServer, uid: string): Promise<RoomView> {
  return (await authority.handle(uid, {
    op: "roomView",
    roomId: authority.roomId,
  })) as RoomView;
}

async function canvasPoints(page: Page, attribute: string): Promise<[number, number][]> {
  const canvas = page.locator("canvas").first();
  await expect(canvas).toHaveAttribute(attribute, /\d/, { timeout: 15_000 });
  const raw = (await canvas.getAttribute(attribute)) ?? "";
  return raw.split(";").map((point) => {
    const [x = 0, y = 0] = point.split(":").map(Number);
    return [x, y];
  });
}

async function canvasPoint(page: Page, attribute: string): Promise<[number, number]> {
  const canvas = page.locator("canvas").first();
  await expect(canvas).toHaveAttribute(attribute, /\d/, { timeout: 15_000 });
  const [x = 0, y = 0] = ((await canvas.getAttribute(attribute)) ?? "").split(",").map(Number);
  return [x, y];
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
  options: { lowPower?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  await authority.install(context, uid, { renderCanvas: true, cueBridge: true });
  await context.addInitScript(
    ({ roomId, token, lowPower }) => {
      sessionStorage.setItem(`daifugo-reconnect-${roomId}`, token);
      if (lowPower) localStorage.setItem("daifugo-low-power", "true");
    },
    { roomId: authority.roomId, token: authority.currentToken(uid), lowPower: options.lowPower },
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
    const mobileCoverage =
      testInfo.title.includes("spectators can inspect") ||
      testInfo.title.includes("A-steal actor") ||
      testInfo.title.includes("selected cards") ||
      testInfo.title.includes("K recovery") ||
      testInfo.title.includes("7-give") ||
      testInfo.title.includes("10-discard") ||
      testInfo.title.includes("Joker") ||
      testInfo.title.includes("rankings");
    test.skip(
      testInfo.project.name !== "desktop-chromium" && !mobileCoverage,
      "視覚証拠はdesktopで一度だけ撮影",
    );
  });

  test("right cards stay in front and the A-steal actor camera shows the victim row", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    const actor = await reconnectPage(
      browser,
      authority,
      "uid-player-3",
      "player",
      testInfo.project.name === "mobile-chromium"
        ? { width: 412, height: 915 }
        : { width: 1280, height: 900 },
    );
    try {
      await expect(actor.page.locator("canvas").first()).toBeVisible();
      await capture(actor.page, testInfo.outputPath("hand-right-card-front.png"));
      await advanceToSteal(authority);
      const effect = actor.page.getByRole("region", { name: "A奪い" });
      await expect(effect).toBeVisible({ timeout: 15_000 });
      const canvas = actor.page.locator("canvas").first();
      const [cardX, cardY] = await canvasPoint(actor.page, "data-effect-steal-card");
      await canvas.click({ position: { x: cardX, y: cardY } });
      await expect(effect).toContainText("1/1枚");
      await capture(actor.page, testInfo.outputPath("a-steal-actor-view.png"));
      await actor.page.getByRole("button", { name: "A奪いを確定" }).click();
      await expect(effect).toHaveCount(0, { timeout: 15_000 });
      expect(authority.appliedCommandNames).toContain("resolveSteal");
      const resolved = await roomView(authority, "uid-player-3");
      expect(resolved.hand.map((card) => card.id)).toContain("c-b2");
      expect(resolved.hand.find((card) => card.id === "c-b2")).toMatchObject({
        visibility: "face",
        blind: false,
      });
      expect(resolved.pendingEffects).toHaveLength(0);
      expect(resolved.phase).toBe("playing");
      expect(
        resolved.hand
          .filter((card) => ["rack-0", "rack-1"].includes(card.id))
          .every((card) => card.visibility === "face" && !card.blind),
      ).toBe(true);
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
    const player = await reconnectPage(
      browser,
      authority,
      "uid-player-3",
      "player",
      testInfo.project.name === "mobile-chromium"
        ? { width: 412, height: 915 }
        : { width: 1280, height: 900 },
    );
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
    test.setTimeout(240_000);
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
    const observer = await reconnectPage(
      browser,
      authority,
      "uid-host",
      "player",
      mobile ? { width: 412, height: 915 } : { width: 1280, height: 900 },
      { lowPower: true },
    );
    try {
      await expect(spectator.page.locator("canvas").first()).toBeVisible();
      await expect(spectator.page.getByRole("listbox", { name: /観戦中の手札/ })).toBeVisible();
      if (mobile) {
        expect(
          await spectator.page.locator(".spectator-focus button").evaluateAll((buttons) =>
            buttons.every((button) => {
              const rect = button.getBoundingClientRect();
              return rect.left >= 0 && rect.right <= innerWidth;
            }),
          ),
        ).toBe(true);
      }
      await capture(spectator.page, testInfo.outputPath("spectator-follow-view.png"));

      await spectator.page.getByRole("button", { name: "キャラ移動" }).click();
      await expect(
        spectator.page.getByText(mobile ? /キャラクターを移動/ : /WASD／矢印で移動/),
      ).toBeVisible();
      await expect(spectator.page.getByRole("button", { name: "ジャンプ" })).toBeVisible();
      await expect(spectator.page.getByRole("listbox", { name: /観戦中の手札/ })).toHaveCount(0);
      const canvas = spectator.page.locator("canvas").first();
      await expect(canvas).toHaveAttribute("data-free-roam-pose", /.+/);
      const observerCanvas = observer.page.locator("canvas").first();
      await expect(observerCanvas).toHaveAttribute("data-remote-spectator-count", "1", {
        timeout: 15_000,
      });
      expect(await spectator.page.evaluate(() => document.activeElement?.tagName)).toBe("CANVAS");
      const poseBeforeTurn = await readFreeRoamPose(spectator.page);
      const bounds = await canvas.boundingBox();
      expect(bounds).not.toBeNull();
      if (bounds) {
        await spectator.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await spectator.page.mouse.down();
        await spectator.page.mouse.move(
          bounds.x + bounds.width / 2 + 85,
          bounds.y + bounds.height / 2 - 20,
        );
        await spectator.page.mouse.up();
      }
      const poseAfterTurn = await readFreeRoamPose(spectator.page);
      expect(Math.abs(poseAfterTurn.yaw - poseBeforeTurn.yaw)).toBeGreaterThan(0.05);
      expect(Math.abs(poseAfterTurn.pitch - poseBeforeTurn.pitch)).toBeGreaterThan(0.02);
      const poseBeforeMove = poseAfterTurn;
      if (mobile) {
        const moveForward = spectator.page.getByRole("button", { name: "前へ進む" });
        const moveRight = spectator.page.getByRole("button", { name: "右へ移動" });
        await moveForward.dispatchEvent("pointerdown", {
          pointerId: 11,
          pointerType: "touch",
          buttons: 1,
        });
        await moveRight.dispatchEvent("pointerdown", {
          pointerId: 12,
          pointerType: "touch",
          buttons: 1,
        });
        await spectator.page.waitForTimeout(260);
        await moveRight.dispatchEvent("pointerup", {
          pointerId: 12,
          pointerType: "touch",
        });
        const poseAfterRightRelease = await readFreeRoamPose(spectator.page);
        await spectator.page.waitForTimeout(260);
        await moveForward.dispatchEvent("pointerup", {
          pointerId: 11,
          pointerType: "touch",
        });
        const poseAfterForwardContinues = await readFreeRoamPose(spectator.page);
        expect(
          Math.hypot(
            poseAfterForwardContinues.x - poseAfterRightRelease.x,
            poseAfterForwardContinues.z - poseAfterRightRelease.z,
          ),
        ).toBeGreaterThan(0.08);
      } else {
        await spectator.page.keyboard.down("d");
        await spectator.page.waitForTimeout(650);
        await spectator.page.keyboard.up("d");
      }
      await expect
        .poll(async () => {
          const pose = await readFreeRoamPose(spectator.page);
          return Math.hypot(pose.x - poseBeforeMove.x, pose.z - poseBeforeMove.z);
        })
        .toBeGreaterThan(0.15);
      const peakBeforeJump = Number(
        (await canvas.getAttribute("data-free-roam-peak-y")) ?? Number.NaN,
      );
      expect(peakBeforeJump).toBeGreaterThanOrEqual(0.05);
      await spectator.page.getByRole("button", { name: "ジャンプ" }).click();
      await expect
        .poll(
          async () => Number((await canvas.getAttribute("data-free-roam-peak-y")) ?? Number.NaN),
          { timeout: 15_000 },
        )
        .toBeGreaterThan(peakBeforeJump + 0.08);
      await capture(spectator.page, testInfo.outputPath("spectator-free-roam.png"));
      await capture(observer.page, testInfo.outputPath("remote-spectator-visible.png"));
      expect(
        await spectator.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await spectator.page.keyboard.press("Escape");
      await expect(spectator.page.getByRole("listbox", { name: /観戦中の手札/ })).toBeVisible();
      await expect(observerCanvas).toHaveAttribute("data-remote-spectator-count", "0", {
        timeout: 15_000,
      });
    } finally {
      await closeContext(spectator.context);
      await closeContext(observer.context);
    }
  });

  test("a finished player's old seat disappears while their spectator avatar remains", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    authority.forceFinish("uid-player-3");
    const spectator = await reconnectPage(browser, authority, "uid-player-3", "spectator");
    try {
      const oldSeatName = spectator.page
        .locator(".character-name-tag--player")
        .filter({ hasText: "プレイヤー3" });
      await expect(oldSeatName).toHaveCount(0);

      await spectator.page.getByRole("button", { name: "キャラ移動" }).click();
      await expect(oldSeatName).toHaveCount(0);
      await expect(
        spectator.page.locator(".character-name-tag--spectator").filter({ hasText: "プレイヤー3" }),
      ).toBeVisible();
    } finally {
      await closeContext(spectator.context);
    }
  });

  test("player names remain above seated avatars and the turn marker follows play", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    const player = await reconnectPage(browser, authority, "uid-player-3");
    try {
      const playerNames = player.page.locator(".character-name-tag--player");
      await expect(playerNames.filter({ hasText: "ホスト" })).toBeVisible();
      await expect(playerNames.filter({ hasText: "プレイヤー2" })).toBeVisible();
      await expect(playerNames.filter({ hasText: "プレイヤー3" })).toHaveCount(0);
      await expect(playerNames.filter({ hasText: "ホスト" })).toHaveAttribute(
        "data-current-turn",
        "true",
      );

      await authority.handle("uid-host", {
        op: "command",
        name: "submitPlay",
        payload: {
          ...(await roomBase(authority)),
          clientActionId: "visual-turn-marker-play",
          cardIds: ["c-a1"],
          mimics: [],
          blindConfirmed: false,
        },
      });
      await expect
        .poll(async () => (await roomView(authority, "uid-player-3")).currentPlayerId)
        .toBe("uid-player-2");
      await expect(playerNames.filter({ hasText: "プレイヤー2" })).toHaveAttribute(
        "data-current-turn",
        "true",
        { timeout: 15_000 },
      );
      await expect(playerNames.filter({ hasText: "ホスト" })).not.toHaveAttribute(
        "data-current-turn",
        "true",
      );
    } finally {
      await closeContext(player.context);
    }
  });

  test("K recovery floats in a readable rack", async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const collectAuthority = new AuthoritativeE2EServer();
    await seedStartedRoom(collectAuthority);
    const collector = await reconnectPage(
      browser,
      collectAuthority,
      "uid-player-3",
      "player",
      testInfo.project.name === "mobile-chromium"
        ? { width: 412, height: 915 }
        : { width: 1280, height: 900 },
    );
    try {
      collectAuthority.forceCollectEffect(
        "uid-player-3",
        testInfo.project.name === "mobile-chromium" ? 54 : 32,
      );
      const effect = collector.page.getByRole("region", { name: "K回収" });
      await expect(effect).toBeVisible({
        timeout: 15_000,
      });
      await expect(collector.page.getByText("空中に並んだ回収札を直接タップ")).toBeVisible();
      await capture(collector.page, testInfo.outputPath("k-recovery-floating-rack.png"));
      const canvas = collector.page.locator("canvas").first();
      const bounds = await canvas.boundingBox();
      expect(bounds).not.toBeNull();
      const points = await canvasPoints(collector.page, "data-effect-card-points");
      expect(points).toHaveLength(testInfo.project.name === "mobile-chromium" ? 54 : 32);
      expect(
        points.every(
          ([x, y]) => x >= 0 && y >= 0 && x <= (bounds?.width ?? 0) && y <= (bounds?.height ?? 0),
        ),
      ).toBe(true);
      expect(
        await collector.page.evaluate(
          ({ points, origin }) =>
            points.every(([x, y]) =>
              document.elementFromPoint(origin.x + x, origin.y + y)?.matches("canvas"),
            ),
          { points, origin: { x: bounds?.x ?? 0, y: bounds?.y ?? 0 } },
        ),
      ).toBe(true);
      for (const [x, y] of points.slice(0, 2)) {
        await collector.page.mouse.click((bounds?.x ?? 0) + x, (bounds?.y ?? 0) + y);
      }
      await expect(effect).toContainText("2/2枚");
      const confirm = collector.page.getByRole("button", { name: "K回収を確定" });
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(effect).toHaveCount(0, { timeout: 15_000 });
      expect(collectAuthority.appliedCommandNames).toContain("resolveCollect");
      const resolved = await roomView(collectAuthority, "uid-player-3");
      expect(resolved.hand).toHaveLength(5);
      expect(resolved.discard).toHaveLength(testInfo.project.name === "mobile-chromium" ? 52 : 30);
      expect(resolved.pendingEffects).toHaveLength(0);
      expect(resolved.phase).toBe("playing");
    } finally {
      await closeContext(collector.context);
    }
  });

  test("7-give drags the actual card to its destination", async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const giveAuthority = new AuthoritativeE2EServer();
    await seedStartedRoom(giveAuthority);
    const giver = await reconnectPage(
      browser,
      giveAuthority,
      "uid-host",
      "player",
      testInfo.project.name === "mobile-chromium"
        ? { width: 412, height: 915 }
        : { width: 1280, height: 900 },
    );
    try {
      giveAuthority.forceGiveEffect();
      const effect = giver.page.getByRole("region", { name: "7渡し" });
      await expect(effect).toBeVisible({
        timeout: 15_000,
      });
      await capture(giver.page, testInfo.outputPath("seven-give-before-drag.png"));
      const canvas = giver.page.locator("canvas").first();
      const bounds = await canvas.boundingBox();
      expect(bounds).not.toBeNull();
      await expect(canvas).toHaveAttribute("data-effect-give-drag", /\d/, { timeout: 15_000 });
      const [startX = 0, startY = 0, endX = 0, endY = 0] = String(
        await canvas.getAttribute("data-effect-give-drag"),
      )
        .split(",")
        .map(Number);
      if (bounds) {
        await giver.page.mouse.move(bounds.x + startX, bounds.y + startY);
        await giver.page.mouse.down();
        await expect(effect).toContainText("1/1枚");
        await giver.page.mouse.move(bounds.x + endX, bounds.y + endY, { steps: 12 });
        await giver.page.mouse.up();
      }
      await expect(giver.page.getByLabel("7渡しの割り当て")).toContainText("♠7 → プレイヤー2");
      await capture(giver.page, testInfo.outputPath("seven-give-assigned-seat.png"));
      await expect(canvas).toHaveAttribute("data-effect-give-return-card", /\d/, {
        timeout: 15_000,
      });
      const [returnX = 0, returnY = 0] = String(
        await canvas.getAttribute("data-effect-give-return-card"),
      )
        .split(",")
        .map(Number);
      if (bounds) {
        await giver.page.mouse.move(bounds.x + returnX, bounds.y + returnY);
        await giver.page.mouse.down();
        await giver.page.mouse.move(bounds.x + startX, bounds.y + startY, { steps: 12 });
        await giver.page.mouse.up();
      }
      await expect(giver.page.getByLabel("7渡しの割り当て")).toHaveCount(0);
      await expect(effect).toContainText("0/1枚");
      if (bounds) {
        await giver.page.mouse.move(bounds.x + startX, bounds.y + startY);
        await giver.page.mouse.down();
        await giver.page.mouse.move(bounds.x + endX, bounds.y + endY, { steps: 12 });
        await giver.page.mouse.up();
      }
      await expect(giver.page.getByLabel("7渡しの割り当て")).toContainText("♠7 → プレイヤー2");
      await giver.page.getByRole("button", { name: "7渡しを確定" }).click();
      await expect(giver.page.getByRole("region", { name: "7渡し" })).toHaveCount(0, {
        timeout: 15_000,
      });
      expect(giveAuthority.appliedCommandNames).toContain("resolveGive");
      const resolved = await roomView(giveAuthority, "uid-host");
      expect(resolved.hand).toHaveLength(2);
      expect(resolved.players.find((player) => player.id === "uid-player-2")?.cardCount).toBe(4);
      expect(resolved.pendingEffects).toHaveLength(0);
      expect(resolved.phase).toBe("playing");
      const targetView = await roomView(giveAuthority, "uid-player-2");
      expect(targetView.hand.find((card) => card.id === "c-a3")).toMatchObject({
        visibility: "face",
        blind: false,
      });
    } finally {
      await closeContext(giver.context);
    }
  });

  test("10-discard taps an actual hand card and resolves it", async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const discardAuthority = new AuthoritativeE2EServer();
    await seedStartedRoom(discardAuthority);
    const discarder = await reconnectPage(
      browser,
      discardAuthority,
      "uid-host",
      "player",
      testInfo.project.name === "mobile-chromium"
        ? { width: 412, height: 915 }
        : { width: 1280, height: 900 },
    );
    try {
      discardAuthority.forceDiscardEffect();
      const effect = discarder.page.getByRole("region", { name: "10捨て" });
      await expect(effect).toBeVisible({ timeout: 15_000 });
      await discarder.page.getByRole("option", { name: /ハート10/ }).click();
      await capture(discarder.page, testInfo.outputPath("ten-discard-selected-card.png"));
      await discarder.page.getByRole("button", { name: "10捨てを確定" }).click();
      await expect(effect).toHaveCount(0, { timeout: 15_000 });
      expect(discardAuthority.appliedCommandNames).toContain("resolveDiscard");
      const resolved = await roomView(discardAuthority, "uid-host");
      expect(resolved.hand.map((card) => card.id)).not.toContain("effect-ten-discard");
      expect(resolved.discard.map((card) => card.id)).toContain("effect-ten-discard");
      expect(resolved.pendingEffects).toHaveLength(0);
      expect(resolved.phase).toBe("playing");
    } finally {
      await closeContext(discarder.context);
    }
  });

  test("Joker suit choices remain selectable before the play is submitted", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    authority.forceJokerChoice();
    const player = await reconnectPage(
      browser,
      authority,
      "uid-host",
      "player",
      testInfo.project.name === "mobile-chromium"
        ? { width: 412, height: 915 }
        : { width: 1280, height: 900 },
    );
    try {
      await player.page.getByRole("option", { name: /スペード7/ }).click();
      await player.page.getByRole("option", { name: /ジョーカー1/ }).click();
      await player.page.getByRole("button", { name: "選んだ札を出す" }).click();
      const dialog = player.page.getByRole("dialog", { name: "選んだ札を出しますか？" });
      await expect(dialog).toBeVisible();
      const choices = dialog.getByRole("radio");
      await expect(choices).toHaveCount(4);
      await expect(choices.first()).toBeChecked();
      await choices.nth(1).check();
      await expect(choices.nth(1)).toBeChecked();
      await expect(choices.first()).not.toBeChecked();
      await capture(player.page, testInfo.outputPath("joker-suit-choice-selected.png"));
    } finally {
      await closeContext(player.context);
    }
  });

  test("rankings are displayed in numerical place order", async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    await seedStartedRoom(authority);
    authority.forceFinishedRankings();
    const context = await browser.newContext({
      viewport:
        testInfo.project.name === "mobile-chromium"
          ? { width: 412, height: 915 }
          : { width: 1280, height: 900 },
    });
    await authority.install(context, "uid-host", { renderCanvas: true, cueBridge: true });
    await context.addInitScript(
      ({ roomId, token }) => sessionStorage.setItem(`daifugo-reconnect-${roomId}`, token),
      { roomId: authority.roomId, token: authority.currentToken("uid-host") },
    );
    const page = await context.newPage();
    try {
      await page.goto(`/?room=${authority.roomId}&role=player`);
      await expect(page.getByRole("heading", { name: "対局結果" })).toBeVisible();
      const rows = page.getByRole("listitem");
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toContainText("1位ホスト");
      await expect(rows.nth(1)).toContainText("2位プレイヤー3");
      await expect(rows.nth(2)).toContainText("3位プレイヤー2");
      await capture(page, testInfo.outputPath("rankings-numerical-order.png"));
    } finally {
      await closeContext(context);
    }
  });
});
