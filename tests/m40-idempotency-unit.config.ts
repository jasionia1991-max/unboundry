import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m40-generation-idempotency-recovery.spec.ts",
  workers: 1,
});
