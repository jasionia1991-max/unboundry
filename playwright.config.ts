import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const preview = process.env.UNBOUNDRY_TEST_PREVIEW === "1";
const testDataDirectory = join(
  process.cwd(),
  "tmp",
  `playwright-data-${process.pid}`,
);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    channel: "chrome",
    viewport: { width: 1135, height: 917 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: preview
      ? "npm run preview -- --port 4173 --strictPort"
      : "npm run dev -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      UNBOUNDRY_DATA_DIR: testDataDirectory,
      UNBOUNDRY_TEST_AUTH_BYPASS: "1",
    },
  },
});
