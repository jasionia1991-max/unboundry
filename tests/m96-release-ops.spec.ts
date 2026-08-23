import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./safe-test";

test.describe.configure({ mode: "serial" });

const execute = promisify(execFile);
const validator = join(process.cwd(), "scripts/validate-release-ops.mjs");
const nginxTemplate = join(process.cwd(), "deploy/nginx.template.conf");
const systemdTemplate = join(process.cwd(), "deploy/unboundry.service.template");
const migrationSystemdTemplate = join(
  process.cwd(),
  "deploy/unboundry-migrate-schema37-to39.service.template",
);

function releaseManifests() {
  const bridge = process.env.UNBOUNDRY_BRIDGE_RELEASE_MANIFEST;
  const final = process.env.UNBOUNDRY_FINAL_RELEASE_MANIFEST;
  const bridgeSha256 = process.env.UNBOUNDRY_BRIDGE_RELEASE_MANIFEST_SHA256;
  const finalSha256 = process.env.UNBOUNDRY_FINAL_RELEASE_MANIFEST_SHA256;
  if (!bridge || !final || !bridgeSha256 || !finalSha256) {
    throw new Error("m96 release attestation environment is incomplete");
  }
  return Object.freeze({ bridge, bridgeSha256, final, finalSha256 });
}

async function attestedReleaseRelationship() {
  const path = process.env.UNBOUNDRY_RELEASE_ATTESTATION_PATH;
  if (!path) throw new Error("m96 release attestation path is missing");
  const document = JSON.parse(await readFile(path, "utf8")) as {
    relationship?: Record<string, unknown>;
  };
  if (!document.relationship) {
    throw new Error("m96 release relationship is missing");
  }
  return document.relationship;
}

type CommandResult = Readonly<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

type Fixture = Awaited<ReturnType<typeof createFixture>>;

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function command(
  arguments_: string[],
  environmentOverrides: NodeJS.ProcessEnv = {},
): Promise<CommandResult> {
  const inherited = Object.fromEntries([
    "UNBOUNDRY_BRIDGE_RELEASE_MANIFEST",
    "UNBOUNDRY_BRIDGE_RELEASE_MANIFEST_SHA256",
    "UNBOUNDRY_FINAL_RELEASE_MANIFEST",
    "UNBOUNDRY_FINAL_RELEASE_MANIFEST_SHA256",
    "UNBOUNDRY_RELEASE_ATTESTATION_PATH",
    "UNBOUNDRY_RELEASE_ATTESTATION_ROOT",
    "UNBOUNDRY_RELEASE_ATTESTATION_SHA256",
    "UNBOUNDRY_RELEASE_SOURCE_SHA256",
    "UNBOUNDRY_SAFE_RUN_NONCE",
    "UNBOUNDRY_SAFE_TEST",
    "UNBOUNDRY_TEST_ROOT",
  ].map((name) => {
    const value = process.env[name];
    if (!value) throw new Error(`m96 is missing ${name}`);
    return [name, value];
  }));
  try {
    const result = await execute(process.execPath, [validator, ...arguments_], {
      env: {
        LANG: "C",
        PATH: "/usr/bin:/bin",
        ...inherited,
        ...environmentOverrides,
      },
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });
    return { exitCode: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as Error & { code?: number; stderr?: string; stdout?: string };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : -1,
      stderr: String(failure.stderr ?? ""),
      stdout: String(failure.stdout ?? ""),
    };
  }
}

function argumentsFor(fixture: Fixture) {
  const releases = releaseManifests();
  return [
    "--bridge-release-manifest",
    releases.bridge,
    "--final-release-manifest",
    releases.final,
    "--nginx-template",
    fixture.nginx,
    "--systemd-template",
    fixture.systemd,
    "--migration-systemd-template",
    fixture.migrationSystemd,
  ];
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m96-ops-"));
  await chmod(root, 0o700);
  const nginx = join(root, "nginx.template.conf");
  const systemd = join(root, "unboundry.service.template");
  const migrationSystemd = join(
    root,
    "unboundry-migrate-schema37-to39.service.template",
  );
  const nginxBytes = await readFile(nginxTemplate);
  const systemdBytes = await readFile(systemdTemplate);
  const migrationSystemdBytes = await readFile(migrationSystemdTemplate);
  await writeFile(nginx, nginxBytes, { mode: 0o600 });
  await writeFile(systemd, systemdBytes, { mode: 0o600 });
  await writeFile(migrationSystemd, migrationSystemdBytes, { mode: 0o600 });
  return {
    migrationSystemd,
    migrationSystemdBytes,
    nginx,
    nginxBytes,
    root,
    systemd,
    systemdBytes,
  };
}

async function failureDocument(result: CommandResult) {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const document = JSON.parse(result.stderr) as Record<string, unknown>;
  expect(document).toMatchObject({
    evidenceClass: "artifact-bound-static-contract",
    format: "unboundry-release-ops-validation-v2",
    valid: false,
  });
  return document;
}

test("static ops contract validates the loopback nginx and hardened current-release unit", async () => {
    const fixture = await createFixture();
  try {
    const relationship = await attestedReleaseRelationship();
    const result = await command(argumentsFor(fixture));
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    const document = JSON.parse(result.stdout) as {
      crossContract: Record<string, unknown>;
      evidenceClass: string;
      limitations: string[];
      migrationSystemd: Record<string, unknown>;
      nginx: Record<string, unknown>;
      releases: Record<string, unknown>;
      systemd: Record<string, unknown>;
      valid: boolean;
    };
    expect(document).toMatchObject({
      crossContract: {
        bridgeManifestSha256: releaseManifests().bridgeSha256,
        currentLink: "/opt/unboundry/current",
        dataDirectory: "/var/lib/unboundry",
        loopbackAddress: "127.0.0.1",
        port: 4173,
        runtimeDirectory: "/run/unboundry",
        migrationBridgeReleaseDirectory: "/opt/unboundry/releases/v0.5.2",
        migrationExpectedSourceLogicalSha256Placeholder:
          "UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256",
        finalManifestSha256: releaseManifests().finalSha256,
        releaseRelationship: relationship,
      },
      evidenceClass: "artifact-bound-static-contract",
      limitations: [
        ...(relationship.crossCommitProof === true
          ? []
          : ["cross-commit-proof-not-established"]),
        "nginx-t-not-executed",
        "systemd-analyze-not-executed",
        "production-host-not-inspected",
      ],
      valid: true,
    });
    expect(document).toMatchObject({
      releases: {
        bridge: {
          manifestSha256: releaseManifests().bridgeSha256,
          releaseId: "v0.5.2",
          version: "0.5.2",
        },
        final: {
          manifestSha256: releaseManifests().finalSha256,
          releaseId: "v0.6.0",
          version: "0.6.0",
        },
      },
    });
    expect(document.nginx).toMatchObject({ sha256: sha256(fixture.nginxBytes) });
    expect(document.systemd).toMatchObject({ sha256: sha256(fixture.systemdBytes) });
    expect(document.migrationSystemd).toMatchObject({
      sha256: sha256(fixture.migrationSystemdBytes),
    });
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("tampered and incomplete templates fail closed", async () => {
  const fixture = await createFixture();
  try {
    const nginxText = fixture.nginxBytes.toString("utf8");
    await writeFile(
      fixture.nginx,
      nginxText.replace("127.0.0.1:4173", "127.0.0.1:4174"),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    await writeFile(
      fixture.nginx,
      nginxText.replace("server_tokens off;\n", ""),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    await writeFile(
      fixture.nginx,
      nginxText.replace(
        "    location = /robots.txt {\n        return 404;\n    }",
        "    location = /robots.txt {\n        return 200;\n    }",
      ),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    await writeFile(
      fixture.nginx,
      nginxText.replaceAll(
        "X-Forwarded-For $remote_addr",
        "X-Forwarded-For $proxy_add_x_forwarded_for",
      ),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    await writeFile(
      fixture.nginx,
      nginxText.replace("        if ($unboundry_maintenance_mode = 1) { return 503; }\n", ""),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    const apiStart = nginxText.indexOf("    location ^~ /api/ {");
    const apiWithoutGuard = `${nginxText.slice(0, apiStart)}${nginxText.slice(apiStart).replace(
      "        if ($unboundry_maintenance_mode = 1) { return 503; }\n",
      "",
    )}`;
    await writeFile(fixture.nginx, apiWithoutGuard, { mode: 0o600 });
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    const nestedErrorPage = nginxText
      .replace("    error_page 503 =503 @unboundry_api_maintenance;\n", "")
      .replace(
        "    location / {\n",
        "    location / {\n        error_page 503 =503 @unboundry_api_maintenance;\n",
      );
    await writeFile(fixture.nginx, nestedErrorPage, { mode: 0o600 });
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    await writeFile(fixture.nginx, fixture.nginxBytes, { mode: 0o600 });
    await writeFile(
      fixture.systemd,
      fixture.systemdBytes.toString("utf8").replace("TimeoutStopSec=150s\n", ""),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    await writeFile(
      fixture.systemd,
      fixture.systemdBytes.toString("utf8").replace(
        "RuntimeDirectoryPreserve=yes",
        "RuntimeDirectoryPreserve=restart",
      ),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    for (const variable of [
      "UNBOUNDRY_LEGACY_RUNTIME_ROOT",
      "UNBOUNDRY_RELEASE_ROLE",
    ]) {
      await writeFile(
        fixture.systemd,
        fixture.systemdBytes.toString("utf8").replace(` ${variable}`, ""),
        { mode: 0o600 },
      );
      expect(
        await failureDocument(await command(argumentsFor(fixture))),
      ).toMatchObject({ code: "OPS_TEMPLATE_INVALID" });
    }

    await writeFile(
      fixture.systemd,
      fixture.systemdBytes,
      { mode: 0o600 },
    );
    await writeFile(
      fixture.migrationSystemd,
      fixture.migrationSystemdBytes.toString("utf8").replace(
        "/opt/unboundry/releases/v0.5.2/scripts/migrate-schema37-to39.mjs",
        "/opt/unboundry/current/scripts/migrate-schema37-to39.mjs",
      ),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("automatic upstream retry and environment expansion are rejected", async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      fixture.nginx,
      fixture.nginxBytes.toString("utf8").replace(
        "proxy_next_upstream off;",
        "proxy_next_upstream error timeout http_502;",
      ),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    await writeFile(
      fixture.nginx,
      fixture.nginxBytes.toString("utf8").replace(
        /\n}\n$/,
        "\n    location /leak/ {\n        alias /etc/;\n        autoindex on;\n    }\n}\n",
      ),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });

    await writeFile(fixture.nginx, fixture.nginxBytes, { mode: 0o600 });
    await writeFile(
      fixture.systemd,
      fixture.systemdBytes.toString("utf8").replace(
        "Environment=\"NODE_ENV=production\"\n",
        "Environment=\"NODE_ENV=production\"\nEnvironmentFile=-/etc/unboundry/runtime.env\n",
      ),
      { mode: 0o600 },
    );
    expect(await failureDocument(await command(argumentsFor(fixture)))).toMatchObject({
      code: "OPS_TEMPLATE_INVALID",
    });
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("relative, aliased, duplicate, and unknown template paths are rejected", async () => {
  const fixture = await createFixture();
  try {
    const alias = join(fixture.root, "nginx-alias.conf");
    await symlink(fixture.nginx, alias);
    const failures = [
      await command([
        "--bridge-release-manifest",
        releaseManifests().bridge,
        "--final-release-manifest",
        releaseManifests().final,
        "--nginx-template",
        "deploy/nginx.template.conf",
        "--systemd-template",
        fixture.systemd,
        "--migration-systemd-template",
        fixture.migrationSystemd,
      ]),
      await command([
        "--bridge-release-manifest",
        releaseManifests().bridge,
        "--final-release-manifest",
        releaseManifests().final,
        "--nginx-template",
        alias,
        "--systemd-template",
        fixture.systemd,
        "--migration-systemd-template",
        fixture.migrationSystemd,
      ]),
      await command([
        "--bridge-release-manifest",
        releaseManifests().bridge,
        "--final-release-manifest",
        releaseManifests().final,
        "--nginx-template",
        fixture.nginx,
        "--systemd-template",
        fixture.nginx,
        "--migration-systemd-template",
        fixture.migrationSystemd,
      ]),
      await command([
        "--bridge-release-manifest",
        releaseManifests().bridge,
        "--final-release-manifest",
        releaseManifests().final,
        "--nginx-template",
        fixture.nginx,
        "--unexpected",
        fixture.systemd,
        "--migration-systemd-template",
        fixture.migrationSystemd,
      ]),
    ];
    for (const result of failures) {
      const document = await failureDocument(result);
      expect(["OPS_ARGUMENT_INVALID", "OPS_PATH_UNSAFE"]).toContain(document.code);
    }

    const swapped = await command([
      "--bridge-release-manifest",
      releaseManifests().final,
      "--final-release-manifest",
      releaseManifests().bridge,
      "--nginx-template",
      fixture.nginx,
      "--systemd-template",
      fixture.systemd,
      "--migration-systemd-template",
      fixture.migrationSystemd,
    ]);
    expect(await failureDocument(swapped)).toMatchObject({
      code: "OPS_RELEASE_INVALID",
    });

    expect(await failureDocument(await command(
      argumentsFor(fixture),
      { UNBOUNDRY_SAFE_TEST: undefined },
    ))).toMatchObject({ code: "OPS_RELEASE_INVALID" });

    const noAttestationEnvironment = Object.fromEntries([
      "UNBOUNDRY_BRIDGE_RELEASE_MANIFEST",
      "UNBOUNDRY_BRIDGE_RELEASE_MANIFEST_SHA256",
      "UNBOUNDRY_FINAL_RELEASE_MANIFEST",
      "UNBOUNDRY_FINAL_RELEASE_MANIFEST_SHA256",
      "UNBOUNDRY_RELEASE_ATTESTATION_PATH",
      "UNBOUNDRY_RELEASE_ATTESTATION_ROOT",
      "UNBOUNDRY_RELEASE_ATTESTATION_SHA256",
      "UNBOUNDRY_RELEASE_SOURCE_SHA256",
      "UNBOUNDRY_SAFE_RUN_NONCE",
      "UNBOUNDRY_SAFE_TEST",
      "UNBOUNDRY_TEST_ROOT",
    ].map((name) => [name, undefined]));
    expect(await failureDocument(await command(
      argumentsFor(fixture),
      noAttestationEnvironment,
    ))).toMatchObject({ code: "OPS_RELEASE_RELATIONSHIP_UNPROVEN" });
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});
