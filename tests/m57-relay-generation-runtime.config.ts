import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m57-relay-generation-runtime.spec.ts",
  workers: 1,
});
