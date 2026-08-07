import { defineConfig } from "@playwright/test";

// m77 自行拉起独立端口（4191）与临时数据目录（无 bypass），
// 测试结束后自清理，不污染共享临时库（m22 total=2 不受影响）。
export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m77-public-templates.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:4191",
    browserName: "chromium",
    channel: "chrome",
    colorScheme: "dark",
    deviceScaleFactor: 2,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { height: 917, width: 1135 },
  },
  workers: 1,
});
