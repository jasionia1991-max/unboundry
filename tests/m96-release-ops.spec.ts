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

type CommandResult = Readonly<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

type Fixture = Awaited<ReturnType<typeof createFixture>>;

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function command(arguments_: string[]): Promise<CommandResult> {
  try {
    const result = await execute(process.execPath, [validator, ...arguments_], {
      env: { LANG: "C", PATH: "/usr/bin:/bin" },
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
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
  return [
    "--nginx-template",
    fixture.nginx,
    "--systemd-template",
    fixture.systemd,
  ];
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m96-ops-"));
  await chmod(root, 0o700);
  const nginx = join(root, "nginx.template.conf");
  const systemd = join(root, "unboundry.service.template");
  const nginxBytes = await readFile(nginxTemplate);
  const systemdBytes = await readFile(systemdTemplate);
  await writeFile(nginx, nginxBytes, { mode: 0o600 });
  await writeFile(systemd, systemdBytes, { mode: 0o600 });
  return { nginx, nginxBytes, root, systemd, systemdBytes };
}

async function failureDocument(result: CommandResult) {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const document = JSON.parse(result.stderr) as Record<string, unknown>;
  expect(document).toMatchObject({
    evidenceClass: "static-contract",
    format: "unboundry-release-ops-validation-v1",
    valid: false,
  });
  return document;
}

test("static ops contract validates the loopback nginx and hardened current-release unit", async () => {
  const fixture = await createFixture();
  try {
    const result = await command(argumentsFor(fixture));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const document = JSON.parse(result.stdout) as {
      crossContract: Record<string, unknown>;
      evidenceClass: string;
      limitations: string[];
      nginx: Record<string, unknown>;
      systemd: Record<string, unknown>;
      valid: boolean;
    };
    expect(document).toMatchObject({
      crossContract: {
        currentLink: "/opt/unboundry/current",
        dataDirectory: "/var/lib/unboundry",
        loopbackAddress: "127.0.0.1",
        port: 4173,
        runtimeDirectory: "/run/unboundry",
      },
      evidenceClass: "static-contract",
      limitations: [
        "nginx-t-not-executed",
        "systemd-analyze-not-executed",
        "production-host-not-inspected",
      ],
      valid: true,
    });
    expect(document.nginx).toMatchObject({ sha256: sha256(fixture.nginxBytes) });
    expect(document.systemd).toMatchObject({ sha256: sha256(fixture.systemdBytes) });
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
        "--nginx-template",
        "deploy/nginx.template.conf",
        "--systemd-template",
        fixture.systemd,
      ]),
      await command([
        "--nginx-template",
        alias,
        "--systemd-template",
        fixture.systemd,
      ]),
      await command([
        "--nginx-template",
        fixture.nginx,
        "--systemd-template",
        fixture.nginx,
      ]),
      await command([
        "--nginx-template",
        fixture.nginx,
        "--unexpected",
        fixture.systemd,
      ]),
    ];
    for (const result of failures) {
      const document = await failureDocument(result);
      expect(["OPS_ARGUMENT_INVALID", "OPS_PATH_UNSAFE"]).toContain(document.code);
    }
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});
