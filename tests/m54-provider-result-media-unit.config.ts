import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m54-provider-result-media.spec.ts",
  workers: 1,
});
