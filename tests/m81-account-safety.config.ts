import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const testDataDirectory = join(
  process.cwd(),
  "tmp",
  `playwright-m81-${process.pid}`,
);

// m81 账号独立消耗限额：真实登录（无 auth bypass）、独立端口 4196、临时数据目录。
export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  testDir: ".",
  testMatch: "m81-account-safety.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:4196",
    browserName: "chromium",
    channel: "chrome",
    colorScheme: "dark",
    deviceScaleFactor: 2,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { height: 917, width: 1135 },
  },
  webServer: {
    command: "npm run dev -- --port 4196 --strictPort",
    env: {
      UNBOUNDRY_DATA_DIR: testDataDirectory,
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4196",
  },
  workers: 1,
});
