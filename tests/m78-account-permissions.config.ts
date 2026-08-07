import { defineConfig } from "@playwright/test";

// m78 自行拉起独立端口（4198）与临时数据目录（无 bypass），
// 测试结束后自清理，不污染共享临时库。
export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m78-account-permissions.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:4198",
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
