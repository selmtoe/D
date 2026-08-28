import { expect, test, type Page } from "@playwright/test";

async function openOfflineEntrance(page: Page): Promise<void> {
  const firebaseRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /(?:identitytoolkit|securetoken|firestore|firebaseappcheck)\.googleapis\.com|firebaseio\.com|firebaseapp\.com/i.test(
        request.url(),
      )
    )
      firebaseRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "大富豪" })).toBeVisible();
  await expect.poll(() => firebaseRequests).toEqual([]);
}

test("entrance renders its 3D scene without horizontal overflow", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await openOfflineEntrance(page);
  await expect(page.locator("canvas")).toBeVisible();
  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
  expect(pageErrors).toEqual([]);
});

test("rules dialog traps focus and Escape returns it to the opener", async ({ page }) => {
  await openOfflineEntrance(page);
  const opener = page.getByRole("button", { name: "利用規約・ルール" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "ルールブック要約" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("avatar editor exposes real catalog choices and restores focus", async ({ page }) => {
  await openOfflineEntrance(page);
  const opener = page.getByRole("button", { name: "アバターを編集" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "アバターを編集" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(
    dialog.getByRole("region", { name: "3Dアバタープレビュー" }).locator("canvas"),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "頭部形状 16", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
