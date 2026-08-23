import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { AuthoritativeE2EServer } from "./support/authoritativeServer";

async function openSalon(page: Page, name: string): Promise<void> {
  await page.goto("/");
  const nameInput = page.getByLabel("プレイヤー名");
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await page.getByRole("button", { name: "サロンへ入る" }).click();
  await expect(page.getByRole("heading", { name: "今夜の円卓を選ぶ" })).toBeVisible();
}

async function contextPage(
  browser: Browser,
  authority: AuthoritativeE2EServer,
  uid: string,
  renderCanvas = false,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  await authority.install(context, uid, { renderCanvas });
  return { context, page: await context.newPage() };
}

async function joinByCode(page: Page, roomId: string, role: "player" | "spectator") {
  await page.getByLabel("5文字の部屋ID").fill(roomId);
  await page
    .getByRole("button", {
      name: role === "player" ? "プレイヤー参加" : "観戦参加",
      exact: true,
    })
    .click();
}

async function playCard(page: Page, cardName: RegExp): Promise<void> {
  const card = page.getByRole("option", { name: cardName });
  await expect(card).toBeVisible();
  await card.click();
  await page.getByRole("button", { name: "選んだ札を出す" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "この札を出す" }).click();
  await expect(dialog).toBeHidden();
}

async function expectTurn(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("timer").getByText(`${name}の手番`, { exact: true })).toBeVisible();
}

test.describe("browser-injected authoritative room transport", () => {
  test("three players, effects, spectator projection, blind outcomes and reconnect", async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "The multi-context authority flow runs once; mobile coverage remains in smoke.spec.ts.",
    );
    test.setTimeout(180_000);
    const authority = new AuthoritativeE2EServer();
    const capturePerspective = process.env.DAIFUGO_CAPTURE_VISUAL_EVIDENCE;
    const host = await contextPage(browser, authority, "uid-host");
    const player2 = await contextPage(
      browser,
      authority,
      "uid-player-2",
      capturePerspective === "victim",
    );
    const player3 = await contextPage(
      browser,
      authority,
      "uid-player-3",
      capturePerspective === "actor" || capturePerspective === "1",
    );
    const spectator = await contextPage(browser, authority, "uid-spectator");
    const contexts = [host.context, player2.context, player3.context, spectator.context];

    try {
      await Promise.all([
        openSalon(host.page, "ホスト"),
        openSalon(player2.page, "プレイヤー2"),
        openSalon(player3.page, "プレイヤー3"),
      ]);
      await host.page.getByRole("button", { name: "新しい部屋を作る" }).click();
      await expect(
        host.page.getByRole("heading", { name: `部屋 ${authority.roomId}` }),
      ).toBeVisible();

      await joinByCode(player2.page, authority.roomId, "player");
      await expect(player2.page.getByText("ホストの開始を待っています")).toBeVisible();
      await joinByCode(player3.page, authority.roomId, "player");
      await expect(host.page.getByText("3人で開始できます")).toBeVisible();

      await host.page.getByRole("button", { name: "ゲームを始める" }).click();
      const skipDeal = host.page.getByRole("button", { name: "配札演出をスキップ" });
      if (await skipDeal.isVisible()) await skipDeal.click({ force: true });
      await expect(host.page.getByRole("button", { name: "パス" })).toBeEnabled();
      await expect(player2.page.getByRole("button", { name: "パス" })).toBeVisible();
      await expect(player3.page.getByRole("button", { name: "パス" })).toBeVisible();
      if (capturePerspective === "actor" || capturePerspective === "1") {
        await player3.page.waitForTimeout(800);
        await player3.page.screenshot({ path: testInfo.outputPath("hand-right-card-front.png") });
      }

      const tokenBeforeReload = await host.page.evaluate(() =>
        sessionStorage.getItem("daifugo-reconnect-TST23"),
      );
      expect(tokenBeforeReload).toBeTruthy();
      await host.page.reload();
      await expect(host.page.getByRole("button", { name: "パス" })).toBeVisible();
      const tokenAfterReload = await host.page.evaluate(() =>
        sessionStorage.getItem("daifugo-reconnect-TST23"),
      );
      expect(tokenAfterReload).toBeTruthy();
      expect(tokenAfterReload).not.toBe(tokenBeforeReload);
      const staleReconnectError = await host.page.evaluate(
        async ({ roomId, oldToken }) => {
          const bridge = (
            window as unknown as {
              __DAIFUGO_E2E__: {
                call: (request: Record<string, unknown>) => Promise<unknown>;
              };
            }
          ).__DAIFUGO_E2E__;
          const base = (await bridge.call({ op: "roomBase", roomId })) as Record<string, unknown>;
          try {
            await bridge.call({
              op: "command",
              name: "reconnectRoom",
              payload: {
                ...base,
                reconnectToken: oldToken,
                clientActionId: "stale-token-e2e-check",
              },
            });
            return "accepted";
          } catch (cause) {
            return cause instanceof Error ? cause.message : String(cause);
          }
        },
        { roomId: authority.roomId, oldToken: tokenBeforeReload },
      );
      expect(staleReconnectError).toContain("permission-denied");

      await openSalon(spectator.page, "観戦者");
      await joinByCode(spectator.page, authority.roomId, "spectator");
      await expect(spectator.page.getByText("プレイヤー視点", { exact: true })).toBeVisible();
      await expect(spectator.page.getByRole("button", { name: "パス" })).toHaveCount(0);
      const spectatorLabels = await spectator.page
        .getByRole("listbox", { name: /手札/ })
        .getByRole("option")
        .evaluateAll((options) => options.map((option) => option.getAttribute("aria-label") ?? ""));
      expect(spectatorLabels).toHaveLength(3);
      expect(spectatorLabels.every((label) => !label.includes("中身は非公開"))).toBe(true);
      expect(spectatorLabels.some((label) => label.includes("ブラインド札"))).toBe(true);
      const freeMode = spectator.page.getByRole("button", { name: "キャラ移動" });
      await freeMode.click();
      await expect(freeMode).toHaveAttribute("aria-pressed", "true");
      await expect(spectator.page.getByRole("listbox", { name: /観戦中の手札/ })).toHaveCount(0);
      await spectator.page.getByRole("button", { name: "憑依" }).click();
      await expect(spectator.page.getByRole("listbox", { name: /観戦中の手札/ })).toBeVisible();

      authority.pauseViewer("uid-spectator");
      authority.bumpRevision();
      await spectator.page.getByRole("button", { name: "プレイヤー2" }).click();
      await expect(spectator.page.getByRole("alert")).toContainText("部屋の状態が更新されています");
      authority.resumeViewer("uid-spectator");
      await expect(spectator.page.getByRole("alert")).toHaveCount(0);
      await spectator.page.getByRole("button", { name: "プレイヤー3" }).click();
      await expect(spectator.page.getByRole("button", { name: "プレイヤー3" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(spectator.page.getByRole("option", { name: /ハートA/ })).toBeVisible();

      await playCard(host.page, /ダイヤ3/);
      await expectTurn(player2.page, "プレイヤー2");
      await playCard(player2.page, /ハート4/);
      await expectTurn(player3.page, "プレイヤー3");
      await playCard(player3.page, /ハートA/);
      const effect = player3.page.getByRole("region", { name: "A奪い" });
      await expect(effect).toBeVisible();
      await player3.page.getByRole("option").click();
      if (capturePerspective === "actor" || capturePerspective === "1") {
        await player3.page.waitForTimeout(900);
        await player3.page.screenshot({ path: testInfo.outputPath("a-steal-actor-view.png") });
      }
      if (capturePerspective === "victim") {
        await expect(player2.page.getByText(/プレイヤー3が効果を処理しています/)).toBeVisible();
        await player2.page.waitForTimeout(900);
        await player2.page.screenshot({ path: testInfo.outputPath("a-steal-victim-view.png") });
      }
      await effect.getByRole("button", { name: "A奪いを確定" }).click();
      await expect(effect).toBeHidden();
      await expectTurn(host.page, "ホスト");

      await playCard(host.page, /ブラインド札.*中身は非公開/);
      await expectTurn(player2.page, "プレイヤー2");
      await playCard(player2.page, /ブラインド札.*中身は非公開/);
      await expect(player2.page.getByRole("button", { name: "選んだ札を出す" })).toHaveCount(0);
      await player2.page.getByRole("button", { name: "ログ／チャット" }).click();
      await expect(player2.page.getByText(/ブラインド札の不正手で失格/)).toBeVisible();
      await host.page.getByRole("button", { name: "ログ／チャット" }).click();
      await expect(host.page.getByText(/ブラインド札は有効でした/)).toBeVisible();

      expect(authority.commandNames).toEqual(
        expect.arrayContaining([
          "createRoom",
          "joinRoomAsPlayer",
          "startGame",
          "reconnectRoom",
          "joinRoomAsSpectator",
          "changeSpectatorFocus",
          "submitPlay",
          "resolveSteal",
        ]),
      );
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });
});
