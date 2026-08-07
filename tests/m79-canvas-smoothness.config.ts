import { defineConfig } from "@playwright/test";
import { join } from "node:path";

// 丝滑度专项：跑在 vite preview（生产构建）上，与日常 4173 最终形态一致。
const testDataDirectory = join(
  process.cwd(),
  "tmp",
  `playwright-smoothness-${process.pid}`,
);

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m79-canvas-smoothness.spec.ts",
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://127.0.0.1:4193",
    browserName: "chromium",
    channel: "chrome",
    colorScheme: "dark",
    deviceScaleFactor: 2,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { height: 917, width: 1135 },
  },
  webServer: {
    command: "npm run preview -- --port 4193 --strictPort",
    env: {
      TAPNOW_DATA_DIR: testDataDirectory,
      TAPNOW_TEST_AUTH_BYPASS: "1",
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4193",
  },
  workers: 1,
});
