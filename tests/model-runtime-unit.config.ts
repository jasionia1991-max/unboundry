import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m32-model-runtime-availability.spec.ts",
  workers: 1,
});
