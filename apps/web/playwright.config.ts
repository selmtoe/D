import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.DAIFUGO_E2E_PORT ?? "43991");
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const e2eOutputDir =
  process.env.DAIFUGO_E2E_OUTPUT_DIR ??
  (process.env.DAIFUGO_E2E_PORT
    ? `../../.playwright-results/test-results-${e2ePort}`
    : "../../.playwright-results/test-results");

export default defineConfig({
  testDir: "./e2e",
  outputDir: e2eOutputDir,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
