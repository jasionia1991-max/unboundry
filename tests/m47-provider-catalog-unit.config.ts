import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m47-provider-catalog-multi-provider-server.spec.ts",
  workers: 1,
});
