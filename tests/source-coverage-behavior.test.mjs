import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE_VERSION = "22.23.1";
const testPath = fileURLToPath(import.meta.url);
const repositoryRoot = realpathSync(resolve(dirname(testPath), ".."));
const operationalScript = "scripts/check-greenfield.mjs";

function inheritedOfflineGuardEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        key === "NODE_OPTIONS" ||
        key === "UNBOUNDRY_SAFE_TEST" ||
        key.startsWith("UNBOUNDRY_TEST_"),
    ),
  );
}

test("the greenfield operational script has an offline behavior check", () => {
  assert.equal(process.versions.node, REQUIRED_NODE_VERSION);
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "unboundry-source-coverage-behavior-"),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [join(repositoryRoot, operationalScript)],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...inheritedOfflineGuardEnvironment(),
          HOME: temporaryRoot,
          LANG: "C",
          LC_ALL: "C",
          PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
          TMPDIR: temporaryRoot,
          npm_config_audit: "false",
          npm_config_fund: "false",
          npm_config_offline: "true",
        },
        maxBuffer: 8 * 1024 * 1024,
        timeout: 60_000,
      },
    );
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
    assert.match(
      result.stdout,
      /^Greenfield check passed \(\d+ implementation files\)\.\n?$/,
    );
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
