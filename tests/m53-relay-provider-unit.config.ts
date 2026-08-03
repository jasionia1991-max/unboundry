import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m53-relay-provider-adapters.spec.ts",
  workers: 1,
});
