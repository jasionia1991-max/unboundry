import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const testDataDirectory = join(
  process.cwd(),
  "tmp",
  `playwright-provider-regression-${process.pid}`,
);

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  testDir: ".",
  testMatch: [
    /m9-provider-secret-safety\.spec\.ts/,
    /m15-provider-profiles\.spec\.ts/,
    /m21-account-contract\.spec\.ts/,
    /m26-mureka-audio-generation\.spec\.ts/,
    /m32-model-runtime-availability\.spec\.ts/,
    /m38-generation-runtime-incidents\.spec\.ts/,
    /m40-generation-idempotency-recovery\.spec\.ts/,
    /m43-provider-catalog\.spec\.ts/,
    /m44-provider-profile-atomicity\.spec\.ts/,
    /m46-provider-multi-catalog-ui\.spec\.ts/,
    /m47-provider-catalog-multi-provider-server\.spec\.ts/,
    /m48-provider-catalog-adapters\.spec\.ts/,
    /m49-model-lifecycle-server\.spec\.ts/,
    /m50-node-model-no-fallback\.spec\.ts/,
    /m53-multi-protocol-relay-server\.spec\.ts/,
    /m55-relay-model-protocol\.spec\.ts/,
    /m56-multi-protocol-relay-ui\.spec\.ts/,
    /m57-relay-generation-runtime\.spec\.ts/,
    /m58-provider-proxy-configuration\.spec\.ts/,
    /m59-relay-catalog-inference\.spec\.ts/,
    /m60-relay-model-parameters-ui\.spec\.ts/,
    /m73-account-credentials\.spec\.ts/,
  ],
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4197",
    browserName: "chromium",
    channel: "chrome",
    colorScheme: "dark",
    deviceScaleFactor: 2,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { height: 917, width: 1135 },
  },
  webServer: {
    command: "npm run dev -- --port 4197 --strictPort",
    env: {
      TAPNOW_DATA_DIR: testDataDirectory,
      TAPNOW_TEST_AUTH_BYPASS: "1",
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4197",
  },
  workers: 1,
});
