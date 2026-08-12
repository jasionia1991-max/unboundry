import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { safeTestEnvironment } from "./tests/test-environment";

const environment = safeTestEnvironment();
const requestedSpec = process.env.UNBOUNDRY_TEST_SPEC?.trim();
if (!requestedSpec) {
  throw new Error("UNBOUNDRY_TEST_SPEC is required; use scripts/run-safe-tests.mjs");
}

type TestMode = "dev" | "hybrid" | "node" | "preview" | "self";
const manifest = JSON.parse(
  readFileSync(
    join(environment.repositoryRoot, "tests/safe-test-manifest.json"),
    "utf8",
  ),
) as Record<TestMode, string[]>;
const relativeSpec =
  requestedSpec === "*" ? "*" : relative(environment.repositoryRoot, requestedSpec);
const mode = (Object.entries(manifest) as Array<[TestMode, string[]]>).find(
  ([, files]) => files.includes(relativeSpec),
)?.[0];
if (requestedSpec !== "*" && !mode) {
  throw new Error(`test spec is missing from safe-test-manifest.json: ${relativeSpec}`);
}
const preview = mode === "preview";
const usesMainServer = mode === "dev" || mode === "hybrid" || mode === "preview";
const usesSelfServer = mode === "self";
const vite = join(environment.repositoryRoot, "node_modules/vite/bin/vite.js");
// Chromium treats plain-http localhost as a trustworthy origin for Secure
// cookies, but intentionally does not send them to a numeric loopback host.
// Production preview sets Secure on sessions, so exercise it through localhost
// while the owned server remains bound to 127.0.0.1.
const browserHost = preview ? "localhost" : "127.0.0.1";
const baseURL = `http://${browserHost}:${
  usesSelfServer ? environment.auxiliaryPort : environment.port
}`;
const testMatch =
  requestedSpec === "*"
    ? /.*\.spec\.ts/
    : relative(join(environment.repositoryRoot, "tests"), requestedSpec);
const reportFile = process.env.UNBOUNDRY_TEST_REPORT;

export default defineConfig({
  expect: { timeout: 5_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: join(environment.testRoot, "test-results"),
  reporter: reportFile
    ? [
        ["line"],
        ["json", { outputFile: reportFile }],
      ]
    : [["line"]],
  retries: 0,
  testDir: "./tests",
  testMatch,
  timeout: 60_000,
  use: {
    baseURL,
    browserName: "chromium",
    colorScheme: "dark",
    deviceScaleFactor: 2,
    screenshot: "only-on-failure",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    viewport: { height: 917, width: 1135 },
  },
  webServer: usesMainServer
    ? {
        command: [
          JSON.stringify(process.execPath),
          JSON.stringify(vite),
          preview ? "preview" : "--host",
          preview ? "--host" : "127.0.0.1",
          preview ? "127.0.0.1" : "--port",
          preview ? "--port" : String(environment.port),
          preview ? String(environment.port) : "--strictPort",
          ...(preview ? ["--strictPort"] : []),
        ].join(" "),
        env: preview
          ? {
              UNBOUNDRY_DATA_DIR: environment.dataDirectory,
              UNBOUNDRY_OFFLINE_GUARD_SCRUB_TEST_ENV: "1",
            }
          : {
              UNBOUNDRY_DATA_DIR: environment.dataDirectory,
              UNBOUNDRY_TEST_AUTH_BYPASS: "1",
            },
        reuseExistingServer: false,
        timeout: 30_000,
        url: `http://127.0.0.1:${environment.port}`,
      }
    : undefined,
  workers: 1,
});
