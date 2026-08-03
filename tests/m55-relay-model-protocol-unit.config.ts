import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m55-relay-model-protocol.spec.ts",
  workers: 1,
});
