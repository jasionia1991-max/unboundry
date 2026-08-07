import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const testDataDirectory = join(
  process.cwd(),
  "tmp",
  `playwright-audio-text-input-${process.pid}`,
);

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  testDir: ".",
  testMatch: /m64-audio-text-input\.spec\.ts/,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4182",
    browserName: "chromium",
    channel: "chrome",
    colorScheme: "dark",
    deviceScaleFactor: 2,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { height: 917, width: 1135 },
  },
  webServer: {
    command: "npm run dev -- --port 4182 --strictPort",
    env: {
      UNBOUNDRY_DATA_DIR: testDataDirectory,
      UNBOUNDRY_TEST_AUTH_BYPASS: "1",
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4182",
  },
  workers: 1,
});
