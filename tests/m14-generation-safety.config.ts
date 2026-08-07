import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const testDataDirectory = join(
  process.cwd(),
  "tmp",
  `playwright-m14-${process.pid}`,
);

// m14 自行拉起独立端口（4198）与临时数据目录，不占用共享 webServer。
export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m14-generation-safety.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:4176",
    browserName: "chromium",
    channel: "chrome",
    colorScheme: "dark",
    deviceScaleFactor: 2,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { height: 917, width: 1135 },
  },
  webServer: {
    command: "npm run dev -- --port 4176 --strictPort",
    env: {
      TAPNOW_DATA_DIR: testDataDirectory,
      TAPNOW_TEST_AUTH_BYPASS: "1",
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4176",
  },
  workers: 1,
});
