import { expect, test, type Page } from "@playwright/test";

async function openWithFirebaseUnavailable(page: Page): Promise<void> {
  await page.route("**/identitytoolkit.googleapis.com/**", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: 429, message: "RESOURCE_EXHAUSTED" } }),
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "大富豪" })).toBeVisible();
}

test("CPU room keeps the multiplayer UI usable without Firebase", async ({ page }) => {
  const pageErrors: Error[] = [];
  const firebaseRequestsAfterEntry: string[] = [];
  let cpuEntryStarted = false;
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("request", (request) => {
    if (
      cpuEntryStarted &&
      /(googleapis\.com|firebaseio\.com|firebaseapp\.com)/i.test(request.url())
    ) {
      firebaseRequestsAfterEntry.push(request.url());
    }
  });

  await openWithFirebaseUnavailable(page);
  await page.getByRole("textbox", { name: "プレイヤー名" }).fill("CPUデバッグ");
  cpuEntryStarted = true;
  await page.getByRole("button", { name: "CPU部屋（オフライン）" }).click();

  await expect(page.getByText("CPU専用部屋・Firebase未使用")).toBeVisible();
  await expect(page.getByText("接続済み · ローカルCPU")).toHaveText("接続済み · ローカルCPU");
  await expect(page.getByRole("heading", { name: /^部屋 CPU/ })).toBeVisible();
  await expect(page.getByLabel("CPU 1の3Dアバター")).toBeVisible();
  await expect(page.getByLabel("CPU 2の3Dアバター")).toBeVisible();
  await expect(page.getByLabel("CPU 3の3Dアバター")).toBeVisible();

  await page.getByRole("button", { name: "ゲームを始める" }).click();
  await expect(page.locator("main.game-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("main.game-screen canvas").first()).toBeVisible({ timeout: 20_000 });
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
  expect(firebaseRequestsAfterEntry).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(page.getByRole("heading", { name: "大富豪" })).toBeVisible();
});
