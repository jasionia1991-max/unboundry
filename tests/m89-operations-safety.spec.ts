import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { openAppDatabase } from "../server/database";
import { expect, test } from "./safe-test";

const execute = promisify(execFile);
const typeScriptRuntime = join(
  process.cwd(),
  "scripts/node-typescript-runtime.mjs",
);
const resetScript = join(process.cwd(), "scripts/reset-account-password.mjs");
const repairScript = join(process.cwd(), "scripts/repair-storage-state.mjs");
const timestamp = "2026-08-12T00:00:00.000Z";
const existingPasswordHash =
  `scrypt$16384$8$1$${"00".repeat(16)}$${"00".repeat(64)}`;
const storageAad = Buffer.from("unboundry:storage-profiles:v1", "utf8");
const passwordCanary = "m89-password-canary-never-log-2026!";

type CliResult = Readonly<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

type Fixture = Readonly<{
  actorId: string;
  dataDirectory: string;
  databasePath: string;
  storagePath?: string;
  targetId: string;
}>;

async function runCli(
  script: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv = {},
): Promise<CliResult> {
  try {
    await access(typeScriptRuntime);
    const result = await execute(process.execPath, [script, ...arguments_], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: undefined,
        ...environment,
      },
      maxBuffer: 256 * 1_024,
      timeout: 15_000,
    });
    return { exitCode: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as Error & {
      code?: number | string;
      stderr?: string;
      stdout?: string;
    };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : -1,
      stderr: String(failure.stderr ?? ""),
      stdout: String(failure.stdout ?? ""),
    };
  }
}

async function directoryFileFingerprint(directory: string) {
  const entries: string[] = [];
  async function visit(current: string, prefix = "") {
    for (const name of (await readdir(current)).sort()) {
      const path = join(current, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const details = await lstat(path);
      if (details.isDirectory()) {
        entries.push(`${relative}:${details.mode & 0o777}:directory`);
        await visit(path, relative);
      } else {
        entries.push(details.isFile()
          ? `${relative}:${details.mode & 0o777}:${await fileSha256(path)}`
          : `${relative}:${details.mode & 0o777}:${details.isSymbolicLink() ? "link" : "other"}`);
      }
    }
  }
  await visit(directory);
  return entries;
}

async function waitForPath(path: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

async function fileSha256(path: string) {
  return sha256(await readFile(path));
}

function encryptStorageDocument(key: Buffer, document: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(storageAad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(document), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: 1,
  });
}

async function decryptStorageDocument(dataDirectory: string) {
  const key = await readFile(join(dataDirectory, "secrets/config-master.key"));
  const encrypted = JSON.parse(
    await readFile(
      join(dataDirectory, "secrets/storage-profiles.enc.json"),
      "utf8",
    ),
  ) as {
    ciphertext: string;
    iv: string;
    tag: string;
  };
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAAD(storageAad);
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")) as {
    activeProfileId?: string;
    mediaRoutingEnabled?: boolean;
    profiles: Array<{ id: string; status: string }>;
  };
}

async function createFixture(options: { storage?: boolean } = {}): Promise<Fixture> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m89-ops-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const actorId = "m89-ops-admin";
  const targetId = "m89-ops-target";
  const database = openAppDatabase(dataDirectory);
  try {
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status, protected,
        created_at, updated_at
      ) VALUES (?, 'ops-admin', 'Operations Admin', ?, 'admin', 'active', 1, ?, ?)
    `).run(actorId, existingPasswordHash, timestamp, timestamp);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status, protected,
        created_at, updated_at
      ) VALUES (?, 'ops-target', 'Operations Target', ?, 'user', 'active', 0, ?, ?)
    `).run(targetId, existingPasswordHash, timestamp, timestamp);
    database.prepare(`
      INSERT INTO sessions (
        id, token_hash, user_id, expires_at, created_at, last_seen_at
      ) VALUES ('m89-target-session', ?, ?, '2030-01-01T00:00:00.000Z', ?, ?)
    `).run(sha256("m89-target-session"), targetId, timestamp, timestamp);
    if (options.storage) {
      database.prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
          storage_backend, storage_profile_id, object_key, content_type,
          checksum_sha256, storage_status, duration_seconds, duration_source,
          duration_status, media_width, media_height
        ) VALUES (
          'image', 'm89-oss-image', ?, 'm89-oss-image.png', 1, ?, ?,
          'oss', NULL, 'objects/m89-oss-image.png', 'image/png', ?, 'ready',
          NULL, NULL, 'not-applicable', 1, 1
        )
      `).run(targetId, timestamp, timestamp, "a".repeat(64));
    }
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }

  let storagePath: string | undefined;
  if (options.storage) {
    const secrets = join(dataDirectory, "secrets");
    await mkdir(secrets, { mode: 0o700 });
    const key = randomBytes(32);
    await writeFile(join(secrets, "config-master.key"), key, { mode: 0o600 });
    storagePath = join(secrets, "storage-profiles.enc.json");
    await writeFile(
      storagePath,
      encryptStorageDocument(key, {
        activeProfileId: "m89-storage-profile",
        mediaRoutingEnabled: true,
        profiles: [{
          accessKeyId: "m89-access-key-id",
          accessKeySecret: "m89-access-key-secret",
          bucket: "m89-storage-bucket",
          createdAt: timestamp,
          endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
          id: "m89-storage-profile",
          label: "Synthetic storage",
          lastVerifiedAt: timestamp,
          provider: "aliyun-oss",
          region: "oss-cn-hangzhou",
          status: "verified",
          updatedAt: timestamp,
        }],
        version: 1,
      }),
      { mode: 0o600 },
    );
  }
  return { actorId, dataDirectory, databasePath, storagePath, targetId };
}

async function removeFixture(fixture: Fixture) {
  await rm(fixture.dataDirectory, { force: true, recursive: true });
}

function passwordResetArguments(fixture: Fixture) {
  return [
    "--data-dir",
    fixture.dataDirectory,
    "--actor-login",
    "ops-admin",
    "--target-login",
    "ops-target",
  ];
}

function repairArguments(fixture: Fixture) {
  return [
    "--data-dir",
    fixture.dataDirectory,
    "--actor-login",
    "ops-admin",
  ];
}

test("operations CLIs reject unknown, missing, and relative path arguments", async () => {
  const resetUnknown = await runCli(resetScript, ["--unknown"]);
  const repairRelative = await runCli(repairScript, [
    "--data-dir",
    "relative-data",
    "--actor-login",
    "ops-admin",
  ]);
  expect(resetUnknown.exitCode).toBe(1);
  expect(JSON.parse(resetUnknown.stderr)).toMatchObject({
    code: "PASSWORD_RESET_ARGUMENT_INVALID",
  });
  expect(repairRelative.exitCode).toBe(1);
  expect(JSON.parse(repairRelative.stderr)).toMatchObject({
    code: "STORAGE_REPAIR_DATA_DIRECTORY_INVALID",
  });
});

test("password reset defaults to a byte-stable dry-run without reading a password", async () => {
  const fixture = await createFixture();
  try {
    const before = await fileSha256(fixture.databasePath);
    const result = await runCli(resetScript, passwordResetArguments(fixture));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      applied: false,
      code: "PASSWORD_RESET_DRY_RUN",
      sessionsToRevoke: 1,
    });
    expect(await fileSha256(fixture.databasePath)).toBe(before);
  } finally {
    await removeFixture(fixture);
  }
});

test("password reset apply consumes only a private file and commits actor audit atomically", async () => {
  const fixture = await createFixture();
  const passwordFile = join(fixture.dataDirectory, "new-password.txt");
  try {
    const setup = new DatabaseSync(fixture.databasePath);
    try {
      setup.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
        .run(fixture.targetId);
    } finally {
      setup.close();
    }
    await writeFile(passwordFile, `${passwordCanary}\n`, { mode: 0o600 });
    const result = await runCli(resetScript, [
      ...passwordResetArguments(fixture),
      "--password-file",
      passwordFile,
      "--apply",
    ]);
    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(passwordCanary);
    expect(JSON.parse(result.stdout)).toMatchObject({
      applied: true,
      code: "PASSWORD_RESET_APPLIED",
      sessionsRevoked: 1,
    });
    const database = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try {
      const target = database.prepare(
        "SELECT password_hash FROM users WHERE id = ?",
      ).get(fixture.targetId) as { password_hash: string };
      expect(target.password_hash).not.toBe(existingPasswordHash);
      expect(target.password_hash).toMatch(/^scrypt\$16384\$8\$1\$/);
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?",
      ).get(fixture.targetId)).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT actor_user_id, target_user_id FROM admin_audit_events
        WHERE action = 'reset_password_emergency'
      `).get()).toEqual({
        actor_user_id: fixture.actorId,
        target_user_id: fixture.targetId,
      });
    } finally {
      database.close();
    }
  } finally {
    await removeFixture(fixture);
  }
});

test("password reset rejects a group-readable password file before mutation", async () => {
  const fixture = await createFixture();
  const passwordFile = join(fixture.dataDirectory, "unsafe-password.txt");
  try {
    await writeFile(passwordFile, passwordCanary, { mode: 0o600 });
    await chmod(passwordFile, 0o640);
    const before = await fileSha256(fixture.databasePath);
    const result = await runCli(resetScript, [
      ...passwordResetArguments(fixture),
      "--password-file",
      passwordFile,
      "--apply",
    ]);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(passwordCanary);
    expect(JSON.parse(result.stderr)).toMatchObject({
      code: "PASSWORD_RESET_PASSWORD_FILE_INVALID",
    });
    expect(await fileSha256(fixture.databasePath)).toBe(before);
  } finally {
    await removeFixture(fixture);
  }
});

test("password reset rejects oversized or multiply-linked password files", async () => {
  for (const scenario of ["oversized", "hardlink"] as const) {
    const fixture = await createFixture();
    const passwordFile = join(fixture.dataDirectory, `${scenario}-password.txt`);
    try {
      await writeFile(
        passwordFile,
        scenario === "oversized" ? Buffer.alloc(4_097, 0x61) : passwordCanary,
        { mode: 0o600 },
      );
      if (scenario === "hardlink") {
        await link(passwordFile, join(fixture.dataDirectory, "password-hardlink.txt"));
      }
      const before = await fileSha256(fixture.databasePath);
      const result = await runCli(resetScript, [
        ...passwordResetArguments(fixture),
        "--password-file",
        passwordFile,
        "--apply",
      ]);
      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}${result.stderr}`).not.toContain(passwordCanary);
      expect(JSON.parse(result.stderr)).toMatchObject({
        code: "PASSWORD_RESET_PASSWORD_FILE_INVALID",
      });
      expect(await fileSha256(fixture.databasePath)).toBe(before);
    } finally {
      await removeFixture(fixture);
    }
  }
});

test("password reset rolls back password and sessions when its audit insert fails", async () => {
  const fixture = await createFixture();
  const passwordFile = join(fixture.dataDirectory, "rollback-password.txt");
  try {
    await writeFile(passwordFile, passwordCanary, { mode: 0o600 });
    const database = new DatabaseSync(fixture.databasePath);
    try {
      database.exec(`
        CREATE TRIGGER m89_fail_password_audit
        BEFORE INSERT ON admin_audit_events
        WHEN NEW.action = 'reset_password_emergency'
        BEGIN
          SELECT RAISE(ABORT, 'm89-secret-trigger-canary');
        END;
        PRAGMA wal_checkpoint(TRUNCATE);
      `);
    } finally {
      database.close();
    }
    const result = await runCli(resetScript, [
      ...passwordResetArguments(fixture),
      "--password-file",
      passwordFile,
      "--apply",
    ]);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(
      /m89-secret-trigger-canary|m89-password-canary/,
    );
    expect(JSON.parse(result.stderr)).toEqual({
      code: "PASSWORD_RESET_FAILED",
      message: "Password reset failed safely",
    });
    const inspection = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try {
      expect(inspection.prepare(
        "SELECT password_hash FROM users WHERE id = ?",
      ).get(fixture.targetId)).toEqual({ password_hash: existingPasswordHash });
      expect(inspection.prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?",
      ).get(fixture.targetId)).toEqual({ count: 1 });
    } finally {
      inspection.close();
    }
  } finally {
    await removeFixture(fixture);
  }
});

test("password reset requires an active administrator actor", async () => {
  const fixture = await createFixture();
  try {
    const result = await runCli(resetScript, [
      "--data-dir",
      fixture.dataDirectory,
      "--actor-login",
      "ops-target",
      "--target-login",
      "ops-target",
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      code: "PASSWORD_RESET_ACTOR_INVALID",
    });
  } finally {
    await removeFixture(fixture);
  }
});

test("password reset rejects writable linked or multiply-linked database targets", async () => {
  for (const scenario of ["directory-mode", "database-mode", "database-hardlink", "database-symlink"] as const) {
    const fixture = await createFixture();
    try {
      if (scenario === "directory-mode") {
        await chmod(fixture.dataDirectory, 0o770);
      } else if (scenario === "database-mode") {
        await chmod(fixture.databasePath, 0o660);
      } else if (scenario === "database-hardlink") {
        await link(fixture.databasePath, join(fixture.dataDirectory, "database-hardlink.sqlite"));
      } else {
        const actual = join(fixture.dataDirectory, "database-actual.sqlite");
        await rename(fixture.databasePath, actual);
        await symlink(actual, fixture.databasePath);
      }
      const result = await runCli(resetScript, passwordResetArguments(fixture));
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({
        code: scenario === "directory-mode"
          ? "PASSWORD_RESET_DATA_DIRECTORY_INVALID"
          : "PASSWORD_RESET_DATABASE_INVALID",
      });
    } finally {
      await chmod(fixture.dataDirectory, 0o700).catch(() => undefined);
      await removeFixture(fixture);
    }
  }
});

test("password reset still rejects a disabled target with an active delete intent", async () => {
  const fixture = await createFixture();
  const passwordFile = join(fixture.dataDirectory, "delete-fenced-password.txt");
  try {
    await writeFile(passwordFile, passwordCanary, { mode: 0o600 });
    const setup = new DatabaseSync(fixture.databasePath);
    try {
      setup.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
        .run(fixture.targetId);
      setup.prepare(`
        INSERT INTO account_delete_intents (
          owner_id, state, error_code, retry_count, created_at, updated_at
        ) VALUES (?, 'running', NULL, 0, ?, ?)
      `).run(fixture.targetId, timestamp, timestamp);
    } finally {
      setup.close();
    }
    const result = await runCli(resetScript, [
      ...passwordResetArguments(fixture),
      "--password-file",
      passwordFile,
      "--apply",
    ]);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(passwordCanary);
    expect(JSON.parse(result.stderr)).toEqual({
      code: "ACCOUNT_DELETE_ACTIVE",
      message: "Account mutation is blocked",
    });
    const inspection = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try {
      expect(inspection.prepare(
        "SELECT password_hash FROM users WHERE id = ?",
      ).get(fixture.targetId)).toEqual({ password_hash: existingPasswordHash });
      expect(inspection.prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?",
      ).get(fixture.targetId)).toEqual({ count: 1 });
    } finally {
      inspection.close();
    }
  } finally {
    await removeFixture(fixture);
  }
});

test("storage repair dry-run leaves the database and encrypted profile byte-stable", async () => {
  const fixture = await createFixture({ storage: true });
  try {
    const databaseBefore = await fileSha256(fixture.databasePath);
    const storageBefore = await fileSha256(fixture.storagePath!);
    const result = await runCli(repairScript, [
      ...repairArguments(fixture),
      "--backfill",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      applied: false,
      backfillRows: 1,
      changed: true,
      code: "STORAGE_REPAIR_DRY_RUN",
      mediaRoutingEnabledAfter: false,
      profilePresent: true,
    });
    expect(await fileSha256(fixture.databasePath)).toBe(databaseBefore);
    expect(await fileSha256(fixture.storagePath!)).toBe(storageBefore);
  } finally {
    await removeFixture(fixture);
  }
});

test("storage repair apply binds backfill and audit to the selected administrator", async () => {
  const fixture = await createFixture({ storage: true });
  try {
    const result = await runCli(repairScript, [
      ...repairArguments(fixture),
      "--backfill",
      "--apply",
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      applied: true,
      backfillChanges: 1,
      changed: true,
      code: "STORAGE_REPAIR_APPLIED",
      mediaRoutingEnabled: false,
      profilePresent: true,
    });
    const document = await decryptStorageDocument(fixture.dataDirectory);
    expect(document.mediaRoutingEnabled).toBe(false);
    expect(document.profiles).toContainEqual(expect.objectContaining({
      id: "m89-storage-profile",
      status: "active",
    }));
    const database = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try {
      expect(database.prepare(
        "SELECT storage_profile_id FROM media_assets WHERE id = 'm89-oss-image'",
      ).get()).toEqual({ storage_profile_id: "m89-storage-profile" });
      expect(database.prepare(`
        SELECT actor_user_id, target_user_id FROM admin_audit_events
        WHERE action = 'repair_storage_profile_state'
      `).get()).toEqual({ actor_user_id: fixture.actorId, target_user_id: null });
    } finally {
      database.close();
    }
  } finally {
    await removeFixture(fixture);
  }
});

test("storage repair rolls back backfill and preserves ciphertext on audit failure", async () => {
  const fixture = await createFixture({ storage: true });
  try {
    const database = new DatabaseSync(fixture.databasePath);
    try {
      database.exec(`
        CREATE TRIGGER m89_fail_storage_audit
        BEFORE INSERT ON admin_audit_events
        WHEN NEW.action = 'repair_storage_profile_state'
        BEGIN
          SELECT RAISE(ABORT, 'm89-storage-secret-trigger-canary');
        END;
        PRAGMA wal_checkpoint(TRUNCATE);
      `);
    } finally {
      database.close();
    }
    const storageBefore = await fileSha256(fixture.storagePath!);
    const result = await runCli(repairScript, [
      ...repairArguments(fixture),
      "--backfill",
      "--apply",
    ]);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "m89-storage-secret-trigger-canary",
    );
    expect(JSON.parse(result.stderr)).toEqual({
      code: "STORAGE_REPAIR_FAILED",
      message: "Storage repair failed safely",
    });
    expect(await fileSha256(fixture.storagePath!)).toBe(storageBefore);
    const inspection = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try {
      expect(inspection.prepare(
        "SELECT storage_profile_id FROM media_assets WHERE id = 'm89-oss-image'",
      ).get()).toEqual({ storage_profile_id: null });
    } finally {
      inspection.close();
    }
  } finally {
    await removeFixture(fixture);
  }
});

test("storage repair serializes two CLI processes on the shared secret-document lease", async () => {
  const fixture = await createFixture({ storage: true });
  const ready = join(fixture.dataDirectory, "m89-repair-ready");
  const release = join(fixture.dataDirectory, "m89-repair-release");
  const secondAttempt = join(fixture.dataDirectory, "m89-repair-second-attempt");
  const secondReady = join(fixture.dataDirectory, "m89-repair-second-ready");
  const secondRelease = join(fixture.dataDirectory, "m89-repair-second-release");
  try {
    const first = runCli(
      repairScript,
      [...repairArguments(fixture), "--backfill", "--apply"],
      {
        UNBOUNDRY_SAFE_TEST: "1",
        UNBOUNDRY_TEST_STORAGE_REPAIR_READY_FILE: ready,
        UNBOUNDRY_TEST_STORAGE_REPAIR_RELEASE_FILE: release,
      },
    );
    await waitForPath(ready);
    let secondSettled = false;
    const second = runCli(
      repairScript,
      [...repairArguments(fixture), "--backfill", "--apply"],
      {
        UNBOUNDRY_SAFE_TEST: "1",
        UNBOUNDRY_TEST_STORAGE_LOCK_ATTEMPT_FILE: secondAttempt,
        UNBOUNDRY_TEST_STORAGE_REPAIR_READY_FILE: secondReady,
        UNBOUNDRY_TEST_STORAGE_REPAIR_RELEASE_FILE: secondRelease,
      },
    ).finally(() => { secondSettled = true; });
    await waitForPath(secondAttempt);
    expect(secondSettled).toBe(false);
    await expect(access(secondReady)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(release, "release\n", { mode: 0o600 });
    const firstResult = await first;
    await waitForPath(secondReady);
    await writeFile(secondRelease, "release\n", { mode: 0o600 });
    const secondResult = await second;
    expect(firstResult.exitCode).toBe(0);
    expect(secondResult.exitCode).toBe(0);
    expect(JSON.parse(firstResult.stdout)).toMatchObject({
      backfillChanges: 1,
      changed: true,
    });
    expect(JSON.parse(secondResult.stdout)).toMatchObject({
      backfillChanges: 0,
      changed: false,
    });
  } finally {
    await removeFixture(fixture);
  }
});

test("storage repair compensates a deterministic post-rename commit fault", async () => {
  const fixture = await createFixture({ storage: true });
  try {
    const storageBefore = await fileSha256(fixture.storagePath!);
    const result = await runCli(
      repairScript,
      [...repairArguments(fixture), "--backfill", "--apply"],
      {
        UNBOUNDRY_SAFE_TEST: "1",
        UNBOUNDRY_TEST_STORAGE_REPAIR_FAULT: "throw-after-rename",
      },
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      code: "STORAGE_REPAIR_FAILED",
      message: "Storage repair failed safely",
    });
    expect(await fileSha256(fixture.storagePath!)).toBe(storageBefore);
    const secretNames = await readdir(join(fixture.dataDirectory, "secrets"));
    expect(secretNames.some((name) => name.startsWith(".storage-profile-repair-")))
      .toBe(false);
    const inspection = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try {
      expect(inspection.prepare(
        "SELECT storage_profile_id FROM media_assets WHERE id = 'm89-oss-image'",
      ).get()).toEqual({ storage_profile_id: null });
      expect(inspection.prepare(`
        SELECT COUNT(*) AS count FROM admin_audit_events
        WHERE action = 'repair_storage_profile_state'
      `).get()).toEqual({ count: 0 });
    } finally {
      inspection.close();
    }
  } finally {
    await removeFixture(fixture);
  }
});

test("crashed post-rename repair blocks dry-run without writes and recovers on apply", async () => {
  const fixture = await createFixture({ storage: true });
  try {
    const crashed = await runCli(
      repairScript,
      [...repairArguments(fixture), "--backfill", "--apply"],
      {
        UNBOUNDRY_SAFE_TEST: "1",
        UNBOUNDRY_TEST_STORAGE_REPAIR_FAULT: "exit-after-rename",
      },
    );
    expect(crashed.exitCode).toBe(86);
    const secrets = join(fixture.dataDirectory, "secrets");
    const beforeDryRun = await directoryFileFingerprint(secrets);
    const dryRun = await runCli(repairScript, [
      ...repairArguments(fixture),
      "--backfill",
    ]);
    expect(dryRun.exitCode).toBe(1);
    expect(JSON.parse(dryRun.stderr)).toEqual({
      code: "STORAGE_REPAIR_RECOVERY_REQUIRED",
      message: "Storage repair recovery requires an explicit apply",
    });
    expect(await directoryFileFingerprint(secrets)).toEqual(beforeDryRun);

    const recovered = await runCli(repairScript, [
      ...repairArguments(fixture),
      "--backfill",
      "--apply",
    ]);
    expect(recovered.exitCode).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      backfillChanges: 1,
      changed: true,
    });
    expect((await readdir(secrets)).some((name) =>
      name.startsWith(".storage-profile-repair-"))).toBe(false);
  } finally {
    await removeFixture(fixture);
  }
});

test("storage repair rejects symlinked secret paths without touching their targets", async () => {
  for (const targetName of ["secrets", "config-master.key", "storage-profiles.enc.json"]) {
    const fixture = await createFixture({ storage: true });
    const outside = await mkdtemp(join(tmpdir(), "unboundry-m89-outside-"));
    try {
      const secrets = join(fixture.dataDirectory, "secrets");
      let outsideTarget: string;
      if (targetName === "secrets") {
        outsideTarget = join(outside, "secrets");
        await rename(secrets, outsideTarget);
        await symlink(outsideTarget, secrets);
      } else {
        const selected = join(secrets, targetName);
        outsideTarget = join(outside, targetName);
        await rename(selected, outsideTarget);
        await symlink(outsideTarget, selected);
      }
      const before = await directoryFileFingerprint(outside);
      const result = await runCli(repairScript, repairArguments(fixture));
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({
        code: "STORAGE_REPAIR_FAILED",
      });
      expect(await directoryFileFingerprint(outside)).toEqual(before);
    } finally {
      await removeFixture(fixture);
      await rm(outside, { force: true, recursive: true });
    }
  }
});

test("storage repair rejects unsafe master-key size mode and link count", async () => {
  for (const scenario of ["size", "mode", "hardlink"] as const) {
    const fixture = await createFixture({ storage: true });
    try {
      const secrets = join(fixture.dataDirectory, "secrets");
      const key = join(secrets, "config-master.key");
      if (scenario === "size") {
        await writeFile(key, Buffer.alloc(33, 0x61), { mode: 0o600 });
      } else if (scenario === "mode") {
        await chmod(key, 0o640);
      } else {
        await link(key, join(secrets, "config-master-key-hardlink"));
      }
      const before = await directoryFileFingerprint(secrets);
      const result = await runCli(repairScript, repairArguments(fixture));
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({
        code: "STORAGE_REPAIR_FAILED",
      });
      expect(await directoryFileFingerprint(secrets)).toEqual(before);
    } finally {
      await removeFixture(fixture);
    }
  }
});

test("storage repair dry-run with missing master key is strictly write-free", async () => {
  const fixture = await createFixture({ storage: true });
  try {
    const secrets = join(fixture.dataDirectory, "secrets");
    await rm(join(secrets, "config-master.key"));
    const before = await directoryFileFingerprint(secrets);
    const result = await runCli(repairScript, repairArguments(fixture));
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      code: "STORAGE_REPAIR_FAILED",
    });
    expect(await directoryFileFingerprint(secrets)).toEqual(before);
    await expect(access(join(secrets, "config-master.key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await removeFixture(fixture);
  }
});
