import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m59-relay-catalog-inference.spec.ts",
  workers: 1,
});
