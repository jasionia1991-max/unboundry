import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const testDataDirectory = join(
  process.cwd(),
  "tmp",
  `playwright-regression-${process.pid}`,
);

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  testDir: ".",
  testMatch: [
    /m0-shell\.spec\.ts/,
    /m2-group-node\.spec\.ts/,
    /m20-api-contract\.spec\.ts/,
    /m22-group-execution\.spec\.ts/,
    /m22-template-contract\.spec\.ts/,
    /m63-multiselect-group-ui\.spec\.ts/,
    /m66-multi-project\.spec\.ts/,
    /m69-edge-selection-highlight\.spec\.ts/,
    /m70-template-placement\.spec\.ts/,
    /m71-user-templates\.spec\.ts/,
  ],
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4192",
    browserName: "chromium",
    channel: "chrome",
    colorScheme: "dark",
    deviceScaleFactor: 2,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { height: 917, width: 1135 },
  },
  webServer: {
    command: "npm run dev -- --port 4192 --strictPort",
    env: {
      TAPNOW_DATA_DIR: testDataDirectory,
      TAPNOW_TEST_AUTH_BYPASS: "1",
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4192",
  },
  workers: 1,
});
