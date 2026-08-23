import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { defaultAvatar } from "@daifugo/avatar-schema";
import type { RoomView } from "../src/app/model";
import { AuthoritativeE2EServer } from "./support/authoritativeServer";

let actionSequence = 0;

function desktopOnly(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Authority contracts run once; mobile rendering remains covered by smoke.spec.ts.",
  );
}

function mobileOnly(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile gameplay runs on Pixel 7 only.");
}

function profile(name: string) {
  return { name, avatar: structuredClone(defaultAvatar) };
}

async function roomBase(authority: AuthoritativeE2EServer) {
  return (await authority.handle("anonymous", {
    op: "roomBase",
    roomId: authority.roomId,
  })) as { roomId: string; gameId: string | null; expectedRevision: number };
}

async function directCommand(
  authority: AuthoritativeE2EServer,
  uid: string,
  name: string,
  payload: Record<string, unknown> = {},
  clientActionId = `contract-action-${++actionSequence}`,
) {
  const identity = name === "createRoom" ? {} : await roomBase(authority);
  return authority.handle(uid, {
    op: "command",
    name,
    payload: { ...identity, ...payload, clientActionId },
  });
}

async function createRoom(authority: AuthoritativeE2EServer, hostUid = "host") {
  await directCommand(authority, hostUid, "createRoom", { profile: profile("ホスト") });
}

async function joinPlayer(authority: AuthoritativeE2EServer, uid: string, name = uid) {
  return directCommand(authority, uid, "joinRoomAsPlayer", { profile: profile(name) });
}

async function view(authority: AuthoritativeE2EServer, uid: string): Promise<RoomView> {
  return (await authority.handle(uid, {
    op: "roomView",
    roomId: authority.roomId,
  })) as RoomView;
}

async function contextPage(
  browser: Browser,
  authority: AuthoritativeE2EServer,
  uid: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await authority.install(context, uid);
  return { context, page: await context.newPage() };
}

async function openSalon(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByLabel("プレイヤー名")).toBeVisible();
  await page.getByLabel("プレイヤー名").fill(name);
  await page.getByRole("button", { name: "サロンへ入る" }).click();
  await expect(page.getByRole("heading", { name: "今夜の円卓を選ぶ" })).toBeVisible();
}

async function playSingle(page: Page, cardName: RegExp): Promise<void> {
  await page.getByRole("option", { name: cardName }).click();
  await page.getByRole("button", { name: "選んだ札を出す" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "この札を出す" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

test.describe("rulebook authority contracts", () => {
  test("six-player capacity rejects player seven and starts with all six seats", async ({
    browser: _browser,
  }, testInfo) => {
    desktopOnly(testInfo);
    const authority = new AuthoritativeE2EServer();
    await createRoom(authority);
    for (let index = 2; index <= 6; index += 1)
      await joinPlayer(authority, `player-${index}`, `プレイヤー${index}`);

    const fullView = await view(authority, "host");
    expect(fullView.players).toHaveLength(6);
    const revisionAtCapacity = fullView.revision;
    await expect(joinPlayer(authority, "player-7", "プレイヤー7")).rejects.toThrow(
      /resource-exhausted.*6人で満員/,
    );
    expect((await view(authority, "host")).revision).toBe(revisionAtCapacity);

    await directCommand(authority, "host", "startGame");
    const started = await view(authority, "host");
    expect(started.phase).toBe("playing");
    expect(started.players).toHaveLength(6);
    expect(started.players.every((player) => player.cardCount > 0)).toBe(true);
    expect(started.currentPlayerId).toBe("host");
  });

  test("public list supports player and spectator join, then finished player spectates and leaves", async ({
    browser,
  }, testInfo) => {
    desktopOnly(testInfo);
    test.setTimeout(90_000);
    const authority = new AuthoritativeE2EServer();
    const host = await contextPage(browser, authority, "host-ui");
    const player = await contextPage(browser, authority, "player-ui");
    const spectator = await contextPage(browser, authority, "spectator-ui");
    const contexts = [host.context, player.context, spectator.context];
    try {
      await openSalon(host.page, "公開ホスト");
      await host.page.getByRole("button", { name: "新しい部屋を作る" }).click();
      await expect(
        host.page.getByRole("heading", { name: `部屋 ${authority.roomId}` }),
      ).toBeVisible();

      await openSalon(player.page, "一覧参加者");
      await player.page
        .getByRole("button", {
          name: `公開ホストの部屋 ${authority.roomId} にプレイヤー参加`,
        })
        .click();
      await expect(player.page.getByText("ホストの開始を待っています")).toBeVisible();
      await joinPlayer(authority, "third-player", "3人目");
      await expect(host.page.getByText("3人で開始できます")).toBeVisible();
      await host.page.getByRole("button", { name: "ゲームを始める" }).click();
      await expect(host.page.getByRole("heading", { name: "カードを配っています" })).toBeVisible();
      await host.page
        .getByRole("button", { name: "配札演出をスキップ" })
        .click({ force: true, timeout: 2_000 })
        .catch(() => undefined);

      await openSalon(spectator.page, "一覧観戦者");
      const roomRow = spectator.page.locator(".room-row").filter({ hasText: authority.roomId });
      await expect(roomRow.getByRole("button", { name: /プレイヤー参加/ })).toHaveCount(0);
      await roomRow
        .getByRole("button", { name: `公開ホストの部屋 ${authority.roomId} を観戦` })
        .click();
      await expect(spectator.page.getByText("プレイヤー視点", { exact: true })).toBeVisible();
      await spectator.page.getByRole("button", { name: "ログ／チャット" }).click();
      await spectator.page.getByPlaceholder("メッセージ").fill("観戦からよろしくお願いします");
      await spectator.page.getByRole("button", { name: "送信", exact: true }).click();
      await host.page.getByRole("button", { name: "ログ／チャット" }).click();
      const hostChatPanel = host.page.getByRole("region", { name: "ログ／チャット" });
      await expect(
        hostChatPanel.getByRole("listitem").filter({ hasText: "観戦からよろしくお願いします" }),
      ).toBeVisible();
      await expect(hostChatPanel.getByText("一覧観戦者（観戦）", { exact: true })).toBeVisible();

      await spectator.page.getByRole("button", { name: "一覧参加者", exact: true }).click();
      await expect(spectator.page.getByText("一覧参加者を観戦中", { exact: true })).toBeVisible();
      authority.forceFinish("player-ui", 1);
      await expect(spectator.page.getByText("公開ホストを観戦中", { exact: true })).toBeVisible();
      await expect(
        spectator.page.getByRole("button", { name: "公開ホスト", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        spectator.page.getByRole("listbox", { name: /公開ホストを観戦中の手札/ }),
      ).toBeVisible();
      const spectatorFallback = await view(authority, "spectator-ui");
      expect(spectatorFallback.focusedPlayerId).toBe("host-ui");
      await expect(player.page.getByText("プレイヤー視点", { exact: true })).toBeVisible();
      const finishedView = await view(authority, "player-ui");
      expect(finishedView.role).toBe("spectator");
      expect(finishedView.rankings).toContainEqual({
        playerId: "player-ui",
        place: 1,
        reason: "finished",
      });
      await player.page.getByRole("button", { name: "退出", exact: true }).click();
      await expect(player.page.getByRole("heading", { name: "今夜の円卓を選ぶ" })).toBeVisible();
      await expect(view(authority, "player-ui")).rejects.toThrow(/部屋のメンバーではありません/);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    }
  });

  test("blind diamond three is hidden from its owner JSON, DOM and aria but can open the game", async ({
    browser,
  }, testInfo) => {
    desktopOnly(testInfo);
    test.setTimeout(60_000);
    const authority = new AuthoritativeE2EServer({ blindDiamond3: true });
    const owner = await contextPage(browser, authority, "blind-owner");
    try {
      await openSalon(owner.page, "ブラインド親");
      await owner.page.getByRole("button", { name: "新しい部屋を作る" }).click();
      await joinPlayer(authority, "other-1", "相手1");
      await joinPlayer(authority, "other-2", "相手2");
      await expect(owner.page.getByText("3人で開始できます")).toBeVisible();
      await owner.page.getByRole("button", { name: "ゲームを始める" }).click();
      await expect(owner.page.getByRole("heading", { name: "カードを配っています" })).toBeVisible();
      await owner.page
        .getByRole("button", { name: "配札演出をスキップ" })
        .click({ force: true, timeout: 2_000 })
        .catch(() => undefined);

      const ownerView = await view(authority, "blind-owner");
      const ownerBlind = ownerView.hand.find((card) => card.id === "c-a1");
      expect(ownerBlind).toEqual({ id: "c-a1", visibility: "hidden", blind: true });
      expect(JSON.stringify(ownerBlind)).not.toMatch(/diamond|rank|"3"/);
      const opponentView = await view(authority, "other-1");
      const opponentSeesDiamond3 = opponentView.players
        .find((candidate) => candidate.id === "blind-owner")
        ?.cards?.find((card) => card.id === "c-a1");
      expect(opponentSeesDiamond3).toMatchObject({
        visibility: "face",
        suit: "diamond",
        rank: "3",
      });

      const blindOption = owner.page.getByRole("option", { name: /ブラインド札.*中身は非公開/ });
      await expect(blindOption).toHaveCount(1);
      expect(await blindOption.getAttribute("aria-label")).not.toMatch(/ダイヤ|ダイヤモンド/);
      expect(await owner.page.locator("body").innerText()).not.toContain("ダイヤ3");
      expect(await owner.page.locator("body").evaluate((body) => body.outerHTML)).not.toContain(
        "ダイヤ3",
      );

      await playSingle(owner.page, /ブラインド札.*中身は非公開/);
      const afterPlay = await view(authority, "blind-owner");
      expect(afterPlay.field).toContainEqual(
        expect.objectContaining({ visibility: "face", suit: "diamond", rank: "3" }),
      );
      expect(afterPlay.log.at(-1)?.text).toMatch(/ブラインド札は有効/);
    } finally {
      await owner.context.close().catch(() => undefined);
    }
  });

  test("disconnect restores before 120 seconds and disqualifies after the grace deadline", async ({
    browser: _browser,
  }, testInfo) => {
    desktopOnly(testInfo);
    const authority = new AuthoritativeE2EServer();
    await createRoom(authority);
    await joinPlayer(authority, "grace-player", "猶予対象");
    await joinPlayer(authority, "third", "3人目");
    await directCommand(authority, "host", "startGame");

    const disconnectedAt = 1_000_000;
    authority.disconnect("grace-player", disconnectedAt);
    expect(
      (await view(authority, "host")).players.find((player) => player.id === "grace-player")
        ?.connection,
    ).toBe("grace");
    authority.sweepDisconnected(disconnectedAt + 119_999);
    expect(
      (await view(authority, "host")).players.find((player) => player.id === "grace-player")
        ?.status,
    ).toBe("active");

    const tokenBeforeRestore = authority.currentToken("grace-player");
    const restored = (await directCommand(authority, "grace-player", "reconnectRoom", {
      reconnectToken: tokenBeforeRestore,
    })) as { reconnectToken: string; reconnectOutcome: string };
    expect(restored.reconnectOutcome).toBe("restored");
    expect(restored.reconnectToken).not.toBe(tokenBeforeRestore);
    expect(
      (await view(authority, "host")).players.find((player) => player.id === "grace-player")
        ?.connection,
    ).toBe("online");

    authority.disconnect("grace-player", disconnectedAt);
    authority.sweepDisconnected(disconnectedAt + 120_001);
    const expiredView = await view(authority, "host");
    const expiredPlayer = expiredView.players.find((player) => player.id === "grace-player");
    expect(expiredPlayer).toMatchObject({
      status: "disqualified",
      connection: "offline",
      cardCount: 0,
    });
    expect(expiredView.discard.length).toBeGreaterThan(0);
    expect((await view(authority, "grace-player")).role).toBe("spectator");
    const expiredReconnect = (await directCommand(authority, "grace-player", "reconnectRoom", {
      reconnectToken: authority.currentToken("grace-player"),
    })) as { reconnectOutcome: string };
    expect(expiredReconnect.reconnectOutcome).toBe("expired");
  });

  test("same action is idempotent while double-tap and multiple-tab stale commands apply once", async ({
    browser: _browser,
  }, testInfo) => {
    desktopOnly(testInfo);
    const authority = new AuthoritativeE2EServer();
    await createRoom(authority);
    await joinPlayer(authority, "tab-player", "複数タブ");
    await joinPlayer(authority, "double-player", "二重タップ");
    await directCommand(authority, "host", "startGame");

    const hostBase = await roomBase(authority);
    const retryPayload = { ...hostBase, clientActionId: "same-action", roomId: authority.roomId };
    const first = await authority.handle("host", {
      op: "command",
      name: "submitPass",
      payload: retryPayload,
    });
    const afterFirstRevision = (await view(authority, "host")).revision;
    const retry = await authority.handle("host", {
      op: "command",
      name: "submitPass",
      payload: retryPayload,
    });
    expect(retry).toEqual(first);
    expect((await view(authority, "host")).revision).toBe(afterFirstRevision);
    expect(authority.appliedCommandNames.filter((name) => name === "submitPass")).toHaveLength(1);
    await expect(
      authority.handle("host", {
        op: "command",
        name: "submitPass",
        payload: { ...retryPayload, clientActionId: "late-retry" },
      }),
    ).rejects.toThrow(/stale revision/);

    const tabBase = await roomBase(authority);
    const tabResults = await Promise.allSettled(
      ["tab-a", "tab-b"].map((clientActionId) =>
        authority.handle("tab-player", {
          op: "command",
          name: "submitPass",
          payload: { ...tabBase, clientActionId },
        }),
      ),
    );
    expect(tabResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(tabResults.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      String(
        (tabResults.find((result) => result.status === "rejected") as PromiseRejectedResult).reason,
      ),
    ).toMatch(/stale revision/);

    const doubleBase = await roomBase(authority);
    const doublePayload = { ...doubleBase, clientActionId: "double-tap" };
    const beforeDoubleRevision = doubleBase.expectedRevision;
    const doubleResults = await Promise.all([
      authority.handle("double-player", {
        op: "command",
        name: "submitPass",
        payload: doublePayload,
      }),
      authority.handle("double-player", {
        op: "command",
        name: "submitPass",
        payload: doublePayload,
      }),
    ]);
    expect(doubleResults[1]).toEqual(doubleResults[0]);
    expect((await view(authority, "host")).revision).toBe(beforeDoubleRevision + 1);
    expect(authority.appliedCommandNames.filter((name) => name === "submitPass")).toHaveLength(3);
  });

  test("mobile viewport can create, deal and submit the opening play without clipped controls", async ({
    context,
    page,
  }, testInfo) => {
    mobileOnly(testInfo);
    const authority = new AuthoritativeE2EServer();
    await authority.install(context, "mobile-host");

    await openSalon(page, "モバイル親");
    await page.getByRole("button", { name: "新しい部屋を作る" }).click();
    await joinPlayer(authority, "mobile-player-2", "モバイル2");
    await joinPlayer(authority, "mobile-player-3", "モバイル3");
    await expect(page.getByText("3人で開始できます")).toBeVisible();
    await page.getByRole("button", { name: "ゲームを始める" }).click();
    await expect(page.getByRole("heading", { name: "カードを配っています" })).toBeVisible();
    await page
      .getByRole("button", { name: "配札演出をスキップ" })
      .click({ force: true, timeout: 2_000 })
      .catch(() => undefined);

    const diamondThree = page.getByRole("option", { name: /ダイヤ3/ });
    await expect(diamondThree).toBeVisible();
    await diamondThree.click();
    const playButton = page.getByRole("button", { name: "選んだ札を出す" });
    await expect(playButton).toBeVisible();
    const geometry = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === "選んだ札を出す",
      );
      const rectangle = button?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        button: rectangle && {
          left: rectangle.left,
          right: rectangle.right,
          top: rectangle.top,
          bottom: rectangle.bottom,
          height: rectangle.height,
        },
        viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      };
    });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.button).toBeDefined();
    expect(geometry.button!.left).toBeGreaterThanOrEqual(0);
    expect(geometry.button!.right).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.button!.top).toBeGreaterThanOrEqual(0);
    expect(geometry.button!.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.button!.height).toBeGreaterThanOrEqual(44);

    await playButton.click();
    await page.getByRole("dialog").getByRole("button", { name: "この札を出す" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect
      .poll(async () => (await view(authority, "mobile-host")).currentPlayerId)
      .toBe("mobile-player-2");
  });
});
