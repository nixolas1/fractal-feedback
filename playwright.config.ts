import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  outputDir: process.env.FEEDBACK_CLOUD_TEST
    ? "test-results/cloud"
    : "test-results/local",
  testMatch: "**/*.spec.ts",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: process.env.FEEDBACK_CLOUD_TEST
      ? "http://localhost:5174"
      : "http://localhost:5173",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      args: [
        "--use-angle=metal",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: process.env.FEEDBACK_CLOUD_TEST
          ? "playwright-report/cloud"
          : "playwright-report/local",
      },
    ],
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
  },
});
