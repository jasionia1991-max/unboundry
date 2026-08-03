import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: ".",
  testMatch: "m53-multi-protocol-relay-server.spec.ts",
  workers: 1,
});
