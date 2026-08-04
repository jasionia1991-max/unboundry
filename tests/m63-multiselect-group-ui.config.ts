import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const testDataDirectory = join(
  process.cwd(),
  "tmp",
  `playwright-multiselect-group-${process.pid}`,
);

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  testDir: ".",
  testMatch:
    /(?:m1-selection-drag|m1-multi-source-connect|m2-(?:text-node|image-node|video-node|audio-node|playlist-node|group-node)|m3-persistence|m63-multiselect-group-ui)\.spec\.ts/,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4179",
    browserName: "chromium",
    channel: "chrome",
    colorScheme: "dark",
    deviceScaleFactor: 2,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { height: 917, width: 1135 },
  },
  webServer: {
    command: "npm run dev -- --port 4179 --strictPort",
    env: {
      TAPNOW_DATA_DIR: testDataDirectory,
      TAPNOW_TEST_AUTH_BYPASS: "1",
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4179",
  },
  workers: 1,
});
