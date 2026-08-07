import { defineConfig } from "@playwright/test";

// m11 自行拉起独立端口（4194）与临时数据目录，不占用共享 webServer。
export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m11-auth.spec.ts",
  workers: 1,
});
