import { defaultAvatar } from "@daifugo/avatar-schema";
import { expect, test, type Page } from "@playwright/test";
import { AuthoritativeE2EServer } from "./support/authoritativeServer";

const profile = (name: string) => ({ name, avatar: defaultAvatar });

async function seedWaitingRoom(authority: AuthoritativeE2EServer): Promise<void> {
  await authority.handle("uid-host", {
    op: "command",
    name: "createRoom",
    payload: { clientActionId: "waiting-playground-create", profile: profile("ホスト") },
  });
  const roomBase = (await authority.handle("uid-host", {
    op: "roomBase",
    roomId: authority.roomId,
  })) as Record<string, unknown>;
  await authority.handle("uid-guest", {
    op: "command",
    name: "joinRoomAsPlayer",
    payload: {
      ...roomBase,
      clientActionId: "waiting-playground-join",
      profile: profile("参加者"),
    },
  });
}

function poseOf(raw: string | null): { x: number; z: number; yaw: number; pitch: number } {
  const [x = 0, , z = 0, yaw = 0, pitch = 0] = String(raw).split(",").map(Number);
  return { x, z, yaw, pitch };
}

async function waitForPose(page: Page): Promise<string> {
  const canvas = page.locator(".waiting-playground canvas");
  await expect(canvas).toHaveAttribute("data-waiting-playground-pose", /,/, {
    timeout: 15_000,
  });
  return (await canvas.getAttribute("data-waiting-playground-pose")) ?? "";
}

test.describe("3D waiting playground", () => {
  test("renders every member and supports viewport-specific FPS controls", async ({
    context,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const authority = new AuthoritativeE2EServer();
    await seedWaitingRoom(authority);
    await authority.install(context, "uid-host", { renderCanvas: true });
    await context.addInitScript(
      ({ roomId, token }) => {
        sessionStorage.setItem(`daifugo-reconnect-${roomId}`, token);
      },
      { roomId: authority.roomId, token: authority.currentToken("uid-host") },
    );
    await page.goto(`/?room=${authority.roomId}&role=player`);
    await page.getByRole("button", { name: "3D待機室で遊ぶ" }).click();

    const dialog = page.getByRole("dialog", { name: "3D待機室" });
    await expect(dialog).toBeVisible();
    await expect(page.locator(".waiting-member-label")).toHaveCount(2);
    await expect(page.locator(".waiting-playground-roster")).toContainText("ホスト");
    await expect(page.locator(".waiting-playground-roster")).toContainText("参加者");
    const initial = poseOf(await waitForPose(page));

    const layout = await page.evaluate(() => {
      const viewportHeight = window.visualViewport?.height ?? innerHeight;
      return [
        ".waiting-playground",
        ".waiting-playground canvas",
        ".waiting-playground-close",
        ".waiting-playground-guide",
      ].map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        const rect = element?.getBoundingClientRect();
        return {
          selector,
          inside: Boolean(
            rect &&
            rect.left >= -0.5 &&
            rect.top >= -0.5 &&
            rect.right <= innerWidth + 0.5 &&
            rect.bottom <= viewportHeight + 0.5,
          ),
        };
      });
    });
    expect(layout.every((entry) => entry.inside)).toBe(true);

    const canvas = page.locator(".waiting-playground canvas");
    if (testInfo.project.name === "mobile-chromium") {
      const pad = page.getByRole("group", { name: "移動パッド" });
      await expect(pad).toBeVisible();
      const canvasBox = await canvas.boundingBox();
      expect(canvasBox).not.toBeNull();
      if (canvasBox) {
        await page.mouse.move(canvasBox.x + canvasBox.width * 0.52, canvasBox.y + 320);
        await page.mouse.down();
        await page.mouse.move(canvasBox.x + canvasBox.width * 0.78, canvasBox.y + 320, {
          steps: 5,
        });
        await page.mouse.up();
      }
      const afterLook = poseOf(await waitForPose(page));
      expect(afterLook.yaw).toBeLessThan(initial.yaw);

      const padBox = await pad.boundingBox();
      expect(padBox).not.toBeNull();
      if (padBox) {
        await page.mouse.move(padBox.x + padBox.width / 2, padBox.y + padBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(padBox.x + padBox.width / 2, padBox.y + 12, { steps: 8 });
        await page.waitForTimeout(180);
        await page.mouse.up();
      }
      const afterPad = poseOf(await waitForPose(page));
      expect(Math.hypot(afterPad.x - initial.x, afterPad.z - initial.z)).toBeGreaterThan(0.05);
    } else {
      await expect(page.getByRole("group", { name: "移動パッド" })).toBeHidden();
      await canvas.click();
      await expect(page.locator(".waiting-playground-viewport")).toHaveAttribute(
        "data-pointer-locked",
        "true",
      );
      await page.waitForTimeout(100);
      await page.keyboard.down("KeyW");
      try {
        await expect
          .poll(async () => poseOf(await waitForPose(page)).z, {
            timeout: 5_000,
            intervals: [50, 100, 250],
          })
          .toBeLessThan(initial.z - 0.05);
      } finally {
        await page.keyboard.up("KeyW");
      }

      // Absolute mouse moves under Pointer Lock are browser/runner dependent.
      // Dispatch one explicit delta to exercise the locked-mouse handler and
      // verify the same rightward look direction deterministically.
      const beforeLook = poseOf(await waitForPose(page));
      await page.evaluate(() => {
        document.dispatchEvent(new MouseEvent("mousemove", { movementX: 90, movementY: 0 }));
      });
      await expect
        .poll(async () => poseOf(await waitForPose(page)).yaw, {
          timeout: 5_000,
          intervals: [50, 100, 250],
        })
        .toBeLessThan(beforeLook.yaw);
      await page.keyboard.press("Escape");
      await expect(page.locator(".waiting-playground-viewport")).toHaveAttribute(
        "data-pointer-locked",
        "false",
      );
    }

    await page.screenshot({ path: testInfo.outputPath("waiting-playground.png") });
    await page.getByRole("button", { name: "待機画面へ戻る" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
