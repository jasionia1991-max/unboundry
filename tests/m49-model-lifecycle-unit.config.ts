import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m49-model-lifecycle-server.spec.ts",
  workers: 1,
});
