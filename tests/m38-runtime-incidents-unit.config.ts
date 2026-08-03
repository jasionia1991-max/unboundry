import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m38-generation-runtime-incidents.spec.ts",
  workers: 1,
});
