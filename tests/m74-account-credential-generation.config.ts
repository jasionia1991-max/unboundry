import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  testDir: ".",
  testMatch: /m74-account-credential-generation\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
});
