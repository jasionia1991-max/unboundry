import { execFile } from "node:child_process";
import {
  createCipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { expect, test } from "./safe-test";
import {
  currentSchemaVersion,
  openAppDatabase,
} from "../server/database";
import { authApi, hashPassword } from "../server/auth";
import {
  BackupInspectionError,
  inspectBackupDatabase,
  validateBackupSecrets,
} from "../server/backupInspection";
import {
  BackupPackageError,
  createEncryptedBackup,
  inspectFrozenMediaIntegrity,
  restoreEncryptedBackup,
  validateMaterializedBackupDatabase,
  verifyEncryptedBackup,
  type BackupCheckpointName,
} from "../server/backupPackage";
import { createRuntimeLifecycle } from "../server/runtimeLifecycle";

const execute = promisify(execFile);

const fixtureSentinel = "REM009A-PLAINTEXT-MUST-STAY-PRIVATE";
const fixturePassword = "Synthetic-Backup-Password-2026!";
const providerDocumentAad = Buffer.from(
  "unboundry:provider-profiles:v1",
  "utf8",
);
const storageDocumentAad = Buffer.from(
  "unboundry:storage-profiles:v1",
  "utf8",
);
const accountCredentialAad = Buffer.from(
  "unboundry:account-credentials:v1",
  "utf8",
);

type Fixture = Awaited<ReturnType<typeof createBackupFixture>>;

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function encryptedDocument(
  key: Buffer,
  aad: Buffer,
  document: Record<string, unknown>,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
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

function encryptedCredential(key: Buffer, plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(accountCredentialAad);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join("$");
}

function createKeys() {
  const recovery = generateKeyPairSync("rsa", {
    modulusLength: 3_072,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const signing = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  return { recovery, signing };
}

function rollbackMigration39To38(database: DatabaseSync) {
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TRIGGER generation_tasks_capture_model_display_name;
      DROP TRIGGER media_publication_guard_task_delete;
      DROP TRIGGER media_publication_guard_owner_delete;
      DROP TRIGGER account_delete_guard_generation_task_insert;
      DROP TRIGGER account_delete_guard_generation_task_activation;
      DROP TABLE generation_admission_events;
      DROP TABLE account_provider_credential_epochs;

      ALTER TABLE generation_task_events
        RENAME TO generation_task_events_schema39;
      ALTER TABLE generation_provider_attempts
        RENAME TO generation_provider_attempts_schema39;
      ALTER TABLE media_publication_attempts
        RENAME TO media_publication_attempts_schema39;
      ALTER TABLE generation_tasks
        RENAME TO generation_tasks_schema39;

      CREATE TABLE generation_tasks (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (
          kind IN ('text', 'image', 'video', 'audio')
        ),
        prompt TEXT NOT NULL,
        model TEXT,
        parameters TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN (
            'queued',
            'running',
            'success',
            'failed',
            'cancelled',
            'retrying',
            'recovering'
          )
        ),
        attempt INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_id TEXT,
        estimated_cost_microunits INTEGER CHECK (
          estimated_cost_microunits IS NULL
          OR estimated_cost_microunits >= 0
        ),
        actual_cost_microunits INTEGER CHECK (
          actual_cost_microunits IS NULL
          OR actual_cost_microunits >= 0
        ),
        provider_profile_id TEXT,
        provider_model_id TEXT,
        result_asset_id TEXT,
        cost_currency TEXT NOT NULL DEFAULT 'USD' CHECK (
          cost_currency IN ('USD', 'CNY')
        ),
        provider_task_id TEXT,
        provider_usage_tokens INTEGER CHECK (
          provider_usage_tokens IS NULL OR provider_usage_tokens >= 0
        ),
        model_configuration TEXT NOT NULL DEFAULT '{}',
        result_text TEXT CHECK (
          result_text IS NULL OR length(result_text) BETWEEN 1 AND 200000
        ),
        UNIQUE (canvas_id, idempotency_key)
      );
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        estimated_cost_microunits, actual_cost_microunits,
        provider_profile_id, provider_model_id, result_asset_id,
        cost_currency, provider_task_id, provider_usage_tokens,
        model_configuration, result_text
      )
      SELECT
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        estimated_cost_microunits, actual_cost_microunits,
        provider_profile_id, provider_model_id, result_asset_id,
        cost_currency, provider_task_id, provider_usage_tokens,
        model_configuration, result_text
      FROM generation_tasks_schema39;

      CREATE TABLE generation_task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN (
            'queued',
            'running',
            'success',
            'failed',
            'cancelled',
            'retrying',
            'recovering'
          )
        ),
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
      );
      INSERT INTO generation_task_events (
        id, task_id, state, error_code, error_message, created_at
      )
      SELECT id, task_id, state, error_code, error_message, created_at
      FROM generation_task_events_schema39;

      CREATE TABLE generation_provider_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        execution_attempt INTEGER NOT NULL CHECK (execution_attempt >= 1),
        provider_profile_id TEXT NOT NULL,
        provider_model_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (
          kind IN ('text', 'image', 'video', 'audio')
        ),
        evidence TEXT NOT NULL CHECK (
          evidence IN ('historical-execution-attempt', 'provider-boundary')
        ),
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
        UNIQUE (task_id, execution_attempt)
      );
      INSERT INTO generation_provider_attempts (
        id, task_id, execution_attempt, provider_profile_id,
        provider_model_id, kind, evidence, created_at
      )
      SELECT
        id, task_id, execution_attempt, provider_profile_id,
        provider_model_id, kind, evidence, created_at
      FROM generation_provider_attempts_schema39;
      ALTER TABLE "generation_provider_attempts" ADD COLUMN "owner_id" TEXT;
      UPDATE generation_provider_attempts
      SET owner_id = (
        SELECT generation_provider_attempts_schema39.owner_id
        FROM generation_provider_attempts_schema39
        WHERE generation_provider_attempts_schema39.id =
          generation_provider_attempts.id
      );

      CREATE TABLE media_publication_attempts (
        attempt_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
        asset_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('upload', 'generation')),
        state TEXT NOT NULL CHECK (
          state IN (
            'reserved', 'staged', 'external-ready',
            'compensating', 'published', 'failed'
          )
        ),
        storage_backend TEXT NOT NULL CHECK (storage_backend IN ('local', 'oss')),
        final_storage_name TEXT NOT NULL,
        object_key TEXT NOT NULL,
        storage_profile_id TEXT,
        staging_name TEXT NOT NULL UNIQUE,
        task_id TEXT,
        task_execution_attempt INTEGER CHECK (
          task_execution_attempt IS NULL OR task_execution_attempt >= 1
        ),
        history_label TEXT,
        byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
        checksum_sha256 TEXT,
        content_type TEXT NOT NULL,
        duration_seconds REAL,
        duration_source TEXT CHECK (
          duration_source IS NULL
          OR duration_source IN ('server-probe', 'provider-task')
        ),
        media_width INTEGER CHECK (media_width IS NULL OR media_width > 0),
        media_height INTEGER CHECK (media_height IS NULL OR media_height > 0),
        actual_cost_microunits INTEGER CHECK (
          actual_cost_microunits IS NULL OR actual_cost_microunits >= 0
        ),
        provider_usage_tokens INTEGER CHECK (
          provider_usage_tokens IS NULL OR provider_usage_tokens >= 0
        ),
        error_code TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
        adopted_at TEXT,
        adopted_canvas_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
        CHECK (
          (source = 'upload' AND task_id IS NULL AND task_execution_attempt IS NULL)
          OR
          (source = 'generation' AND task_id IS NOT NULL AND task_execution_attempt IS NOT NULL)
        ),
        CHECK (
          (adopted_at IS NULL AND adopted_canvas_id IS NULL)
          OR
          (source = 'upload' AND adopted_at IS NOT NULL AND adopted_canvas_id IS NOT NULL)
        )
      );
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, storage_profile_id,
        staging_name, task_id, task_execution_attempt, history_label,
        byte_size, checksum_sha256, content_type, duration_seconds,
        duration_source, media_width, media_height, actual_cost_microunits,
        provider_usage_tokens, error_code, retry_count, adopted_at,
        adopted_canvas_id, created_at, updated_at
      )
      SELECT
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, storage_profile_id,
        staging_name, task_id, task_execution_attempt, history_label,
        byte_size, checksum_sha256, content_type, duration_seconds,
        duration_source, media_width, media_height, actual_cost_microunits,
        provider_usage_tokens, error_code, retry_count, adopted_at,
        adopted_canvas_id, created_at, updated_at
      FROM media_publication_attempts_schema39;

      DROP TABLE generation_task_events_schema39;
      DROP TABLE generation_provider_attempts_schema39;
      DROP TABLE media_publication_attempts_schema39;
      DROP TABLE generation_tasks_schema39;

      CREATE INDEX generation_tasks_canvas_updated
        ON generation_tasks (canvas_id, updated_at DESC);
      CREATE INDEX generation_tasks_owner_canvas_updated
        ON generation_tasks (owner_id, canvas_id, updated_at DESC);
      CREATE INDEX generation_tasks_owner_state_created
        ON generation_tasks (owner_id, state, created_at DESC);
      CREATE INDEX generation_tasks_result_asset
        ON generation_tasks (result_asset_id)
        WHERE result_asset_id IS NOT NULL;
      CREATE INDEX generation_tasks_currency_created
        ON generation_tasks (cost_currency, created_at DESC);
      CREATE UNIQUE INDEX generation_tasks_provider_task
        ON generation_tasks (provider_profile_id, provider_task_id)
        WHERE provider_task_id IS NOT NULL;
      CREATE INDEX generation_task_events_task_created
        ON generation_task_events (task_id, created_at ASC, id ASC);
      CREATE INDEX generation_provider_attempts_profile_kind_created
        ON generation_provider_attempts (
          provider_profile_id, kind, created_at DESC, id DESC
        );
      CREATE INDEX generation_provider_attempts_task_created
        ON generation_provider_attempts (task_id, created_at ASC, id ASC);
      CREATE INDEX IF NOT EXISTS generation_provider_attempts_owner_profile_created
        ON generation_provider_attempts (
          owner_id,
          provider_profile_id,
          created_at DESC
        );
      CREATE UNIQUE INDEX media_publication_attempts_active_asset
        ON media_publication_attempts (kind, asset_id)
        WHERE state IN ('reserved', 'staged', 'external-ready', 'compensating');
      CREATE UNIQUE INDEX media_publication_attempts_active_task
        ON media_publication_attempts (task_id, task_execution_attempt)
        WHERE task_id IS NOT NULL
          AND state IN ('reserved', 'staged', 'external-ready', 'compensating');
      CREATE INDEX media_publication_attempts_owner_state_updated
        ON media_publication_attempts (owner_id, state, updated_at DESC);

      CREATE TRIGGER IF NOT EXISTS generation_tasks_capture_model_display_name
      AFTER INSERT ON generation_tasks
      WHEN
        NEW.model IS NOT NULL
        AND json_valid(NEW.model_configuration)
        AND EXISTS (
          SELECT 1 FROM model_profiles WHERE id = NEW.model
        )
        AND (
          json_type(NEW.model_configuration, '$.displayName') IS NULL
          OR (
            json_type(NEW.model_configuration, '$.displayName') = 'text'
            AND trim(json_extract(NEW.model_configuration, '$.displayName')) = ''
          )
        )
      BEGIN
        UPDATE generation_tasks
        SET model_configuration = json_set(
          model_configuration,
          '$.displayName',
          (SELECT display_name FROM model_profiles WHERE id = NEW.model)
        )
        WHERE id = NEW.id;
      END;
      CREATE TRIGGER media_publication_guard_task_delete
        BEFORE DELETE ON generation_tasks
        WHEN EXISTS (
          SELECT 1 FROM media_publication_attempts
          WHERE task_id = OLD.id
            AND state IN ('reserved', 'staged', 'external-ready', 'compensating')
        )
      BEGIN
        SELECT RAISE(ABORT, 'active media publication blocks task deletion');
      END;
      CREATE TRIGGER media_publication_guard_owner_delete
        BEFORE DELETE ON users
        WHEN EXISTS (
          SELECT 1 FROM media_publication_attempts
          WHERE owner_id = OLD.id
            AND state IN ('reserved', 'staged', 'external-ready', 'compensating')
        )
      BEGIN
        SELECT RAISE(ABORT, 'active media publication blocks owner deletion');
      END;
      CREATE TRIGGER account_delete_guard_generation_task_insert
        BEFORE INSERT ON generation_tasks
        WHEN NEW.owner_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = NEW.owner_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'account deletion blocks generation task mutation');
      END;
      CREATE TRIGGER account_delete_guard_generation_task_activation
        BEFORE UPDATE OF owner_id, state ON generation_tasks
        WHEN NEW.owner_id IS NOT NULL
          AND NEW.state IN ('queued', 'running', 'retrying', 'recovering')
          AND EXISTS (
            SELECT 1 FROM account_delete_intents
            WHERE owner_id = NEW.owner_id
          )
      BEGIN
        SELECT RAISE(ABORT, 'account deletion blocks generation task mutation');
      END;

      DELETE FROM schema_migrations WHERE version = 39;
      PRAGMA user_version = 38;
      COMMIT;
    `);
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function rollbackMigration38To37(database: DatabaseSync) {
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TRIGGER account_delete_guard_generation_task_activation;
      DROP TRIGGER account_delete_guard_generation_task_insert;
      DROP TRIGGER account_delete_guard_public_template_actor_update;
      DROP TRIGGER account_delete_guard_public_template_insert;
      DROP TRIGGER account_delete_guard_session_insert;
      DROP TRIGGER account_delete_guard_user_template_insert;
      DROP TRIGGER account_delete_guard_user_template_owner_update;
      DROP TRIGGER account_delete_guard_user_reactivation;
      DROP TRIGGER media_publication_guard_task_delete;
      DROP TRIGGER media_publication_guard_owner_delete;
      DROP TABLE media_publication_attempts;
      DROP TABLE media_delete_intents;
      DROP TABLE account_delete_intents;
      DELETE FROM schema_migrations WHERE version = 38;
      PRAGMA user_version = 37;
      COMMIT;
    `);
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

async function createBackupFixture(root: string) {
  const dataDirectory = join(root, "data");
  const backupRoot = join(root, "backups");
  const scratchRoot = join(root, "scratch");
  const keyDirectory = join(root, "keys");
  const mirrorDirectory = join(root, "fake-oss");
  await Promise.all([
    mkdir(join(dataDirectory, "media"), { recursive: true }),
    mkdir(join(dataDirectory, "secrets"), { mode: 0o700, recursive: true }),
    mkdir(backupRoot),
    mkdir(scratchRoot),
    mkdir(keyDirectory),
    mkdir(mirrorDirectory),
  ]);

  const localBytes = Buffer.from(`local-${fixtureSentinel}`, "utf8");
  const orphanBytes = Buffer.from(`orphan-${fixtureSentinel}`, "utf8");
  const mirrorBytes = Buffer.from(`oss-${fixtureSentinel}`, "utf8");
  const localName = "preserved-image.png";
  const objectKey = "objects/synthetic/preserved-oss-image.png";
  const mirrorPath = join(mirrorDirectory, "preserved-oss-image.png");
  await Promise.all([
    writeFile(join(dataDirectory, "media", localName), localBytes),
    writeFile(join(dataDirectory, "media", "orphan.bin"), orphanBytes),
    writeFile(mirrorPath, mirrorBytes),
    writeFile(
      join(dataDirectory, "secrets", "provider-profile-write-lock.sqlite"),
      "synthetic-transient-lock",
      { mode: 0o600 },
    ),
  ]);

  const masterKey = randomBytes(32);
  await writeFile(
    join(dataDirectory, "secrets", "config-master.key"),
    masterKey,
    { mode: 0o600 },
  );
  await writeFile(
    join(dataDirectory, "secrets", "provider-profiles.enc.json"),
    encryptedDocument(masterKey, providerDocumentAad, {
      profiles: [{ apiKey: `provider-${fixtureSentinel}`, id: "provider-one" }],
      version: 1,
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(dataDirectory, "secrets", "storage-profiles.enc.json"),
    encryptedDocument(masterKey, storageDocumentAad, {
      profiles: [{ accessKeySecret: `storage-${fixtureSentinel}`, id: "storage-one" }],
      version: 1,
    }),
    { mode: 0o600 },
  );

  const database = openAppDatabase(dataDirectory);
  database.exec("PRAGMA wal_autocheckpoint = 0");
  const timestamp = "2026-08-09T00:00:00.000Z";
  const userId = "backup-user";
  const sessionToken = "synthetic-backup-session-token";
  const passwordHash = await hashPassword(fixturePassword);
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status, protected,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'admin', 'active', 1, ?, ?)
  `).run(
    userId,
    "backup-user",
    "Backup User",
    passwordHash,
    timestamp,
    timestamp,
  );
  database.prepare(`
    INSERT INTO sessions (
      id, token_hash, user_id, expires_at, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "backup-session",
    sha256(sessionToken),
    userId,
    "2030-01-01T00:00:00.000Z",
    timestamp,
    timestamp,
  );
  database.prepare(`
    INSERT INTO provider_profiles (
      id, display_name, driver, status, created_at, updated_at
    ) VALUES (?, ?, 'openrouter', 'enabled', ?, ?)
  `).run("provider-one", "Synthetic Provider", timestamp, timestamp);
  database.prepare(`
    INSERT INTO account_provider_credentials (
      account_id, provider_profile_id, encrypted_key, key_status,
      credential_version, updated_at
    ) VALUES (?, ?, ?, 'valid', 1, ?)
  `).run(
    userId,
    "provider-one",
    encryptedCredential(masterKey, `account-${fixtureSentinel}`),
    timestamp,
  );
  const insertMedia = database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, object_key, content_type, checksum_sha256,
      storage_status, duration_status, media_width, media_height,
      storage_profile_id
    ) VALUES (
      'image', ?, ?, ?, ?, ?, ?, ?, ?, 'image/png', ?, 'ready',
      'not-applicable', 1, 1, ?
    )
  `);
  insertMedia.run(
    "preserved-local-image",
    userId,
    localName,
    localBytes.length,
    timestamp,
    timestamp,
    "local",
    localName,
    sha256(localBytes),
    null,
  );
  insertMedia.run(
    "preserved-oss-image",
    userId,
    "preserved-oss-image.png",
    mirrorBytes.length,
    timestamp,
    timestamp,
    "oss",
    objectKey,
    sha256(mirrorBytes),
    "storage-one",
  );
  database.prepare(`
    INSERT INTO project_metadata (
      owner_id, id, title, updated_at, is_project, created_at
    ) VALUES (?, ?, ?, ?, 1, ?)
  `).run(userId, "backup-project", "Backup Project", 1, 1);
  database.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
      request_fingerprint, state, attempt, created_at, updated_at, owner_id,
      model_configuration
    ) VALUES (?, ?, ?, 'image', ?, '{}', ?, ?, 'queued', 0, ?, ?, ?, '{}')
  `).run(
    "backup-task",
    "backup-project",
    "backup-node",
    `prompt-${fixtureSentinel}`,
    "backup-idempotency",
    "backup-fingerprint",
    timestamp,
    timestamp,
    userId,
  );
  database.prepare(`
    INSERT INTO generation_task_events (
      task_id, state, created_at
    ) VALUES (?, 'queued', ?)
  `).run("backup-task", timestamp);

  const keys = createKeys();
  const paths = {
    recoveryPrivate: join(keyDirectory, "recovery-private.pem"),
    recoveryPublic: join(keyDirectory, "recovery-public.pem"),
    signingPrivate: join(keyDirectory, "signing-private.pem"),
    signingPublic: join(keyDirectory, "signing-public.pem"),
  };
  await Promise.all([
    writeFile(paths.recoveryPrivate, keys.recovery.privateKey, { mode: 0o600 }),
    writeFile(paths.recoveryPublic, keys.recovery.publicKey, { mode: 0o600 }),
    writeFile(paths.signingPrivate, keys.signing.privateKey, { mode: 0o600 }),
    writeFile(paths.signingPublic, keys.signing.publicKey, { mode: 0o600 }),
  ]);
  masterKey.fill(0);

  return {
    backupRoot,
    dataDirectory,
    database,
    keys,
    localName,
    mirrorPath,
    objectKey,
    paths,
    scratchRoot,
    sessionToken,
  };
}

async function treeFingerprint(root: string) {
  const entries: Array<Record<string, unknown>> = [];
  async function visit(directory: string, prefix = "") {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = join(directory, child.name);
      const logical = prefix ? `${prefix}/${child.name}` : child.name;
      const details = await lstat(path);
      if (details.isDirectory()) {
        entries.push({ kind: "directory", path: logical });
        await visit(path, logical);
      } else if (details.isFile()) {
        const value = await readFile(path);
        entries.push({
          kind: "file",
          mode: details.mode & 0o777,
          path: logical,
          sha256: sha256(value),
          size: value.length,
        });
      } else if (details.isSymbolicLink()) {
        entries.push({ kind: "link", path: logical });
      } else {
        entries.push({ kind: "special", path: logical });
      }
    }
  }
  await visit(root);
  return sha256(JSON.stringify(entries));
}

async function packageContains(packageDirectory: string, needle: string) {
  let found = false;
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && (await readFile(path)).includes(Buffer.from(needle))) {
        found = true;
      }
    }
  }
  await visit(packageDirectory);
  return found;
}

function backupOptions(fixture: Fixture) {
  return {
    backupRoot: fixture.backupRoot,
    ossMirrors: [{
      filePath: fixture.mirrorPath,
      objectKey: fixture.objectKey,
      versionId: "fake-version-1",
    }],
    recoveryPublicKey: fixture.keys.recovery.publicKey,
    scratchRoot: fixture.scratchRoot,
    signingPrivateKey: fixture.keys.signing.privateKey,
    sourceDirectory: fixture.dataDirectory,
    sourceFrozen: true as const,
  };
}

function verifyOptions(fixture: Fixture, packageDirectory: string) {
  return {
    packageDirectory,
    recoveryPrivateKey: fixture.keys.recovery.privateKey,
    scratchRoot: fixture.scratchRoot,
    trustedSigningPublicKey: fixture.keys.signing.publicKey,
  };
}

async function expectPackageError(
  operation: Promise<unknown>,
  expectedCode: string,
) {
  try {
    await operation;
    throw new Error("Expected backup operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(BackupPackageError);
    expect((error as BackupPackageError).code).toBe(expectedCode);
  }
}

function expectInspectionError(operation: () => unknown, expectedCode: string) {
  try {
    operation();
    throw new Error("Expected backup inspection to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(BackupInspectionError);
    expect((error as BackupInspectionError).code).toBe(expectedCode);
  }
}

async function emptyOrMissing(path: string) {
  try {
    return (await readdir(path)).length === 0;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function localAuthLogin(dataDirectory: string) {
  const payload = JSON.stringify({
    loginName: "backup-user",
    password: fixturePassword,
  });
  const request = Readable.from([Buffer.from(payload, "utf8")]);
  Object.assign(request, {
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1",
      origin: "http://127.0.0.1",
    },
    method: "POST",
    socket: { remoteAddress: "127.0.0.1" },
    url: "/login",
  });
  const headers: Record<string, string | string[]> = {};
  let responseBody = "";
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | string[]) {
      headers[name.toLocaleLowerCase()] = value;
      return this;
    },
    end(value?: string | Buffer) {
      responseBody = value === undefined ? "" : String(value);
      return this;
    },
  };
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "0";
  try {
    await authApi(
      request as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );
  } finally {
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    if (previousBypass === undefined) delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    else process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
  }
  return {
    body: JSON.parse(responseBody) as { user?: { id: string } },
    headers,
    statusCode: response.statusCode,
  } as {
    body: { user?: { id: string } };
    headers: Record<string, string | string[]>;
    statusCode: number;
  };
}

test("legacy data is preserved while schema migrations become repeatable", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-migration-"));
  try {
    const legacy = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    legacy.exec(`
      CREATE TABLE canvas_documents (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        nodes TEXT NOT NULL,
        edges TEXT NOT NULL,
        viewport TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy
      .prepare(`
        INSERT INTO canvas_documents (
          id,
          revision,
          nodes,
          edges,
          viewport,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        "preserved-canvas",
        7,
        '[{"id":"existing-node"}]',
        "[]",
        '{"x":1,"y":2,"zoom":0.8}',
        new Date().toISOString(),
      );
    legacy.close();

    const migrated = openAppDatabase(dataDirectory);
    expect(
      migrated
        .prepare("SELECT revision FROM canvas_documents WHERE id = ?")
        .get("preserved-canvas"),
    ).toEqual({ revision: 7 });
    expect(
      migrated.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toEqual({ count: currentSchemaVersion });
    expect(
      migrated.prepare("PRAGMA user_version").get(),
    ).toEqual({ user_version: currentSchemaVersion });
    migrated.close();

    const reopened = openAppDatabase(dataDirectory);
    expect(
      reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toEqual({ count: currentSchemaVersion });
    expect(
      reopened.prepare("SELECT COUNT(*) AS count FROM canvas_documents").get(),
    ).toEqual({ count: 1 });
    reopened.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("trusted-duration migration preserves historical media and marks it unverified", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-duration-migration-"));
  try {
    const legacy = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE canvas_documents (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        nodes TEXT NOT NULL,
        edges TEXT NOT NULL,
        viewport TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE project_metadata (
        owner_id TEXT,
        id TEXT NOT NULL,
        title TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (owner_id, id)
      );
      INSERT INTO project_metadata (owner_id, id, title, updated_at)
      VALUES (NULL, 'default', '默认项目', 1);
      -- This reduced fixture records migration 4 as applied, so it must still
      -- materialize the canonical table later account-deletion guards target.
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX sessions_user_expires
        ON sessions (user_id, expires_at);
      CREATE TABLE media_assets (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        storage_name TEXT NOT NULL UNIQUE,
        byte_size INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        storage_backend TEXT NOT NULL,
        object_key TEXT,
        content_type TEXT,
        checksum_sha256 TEXT,
        storage_status TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE TABLE generation_tasks (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
        prompt TEXT NOT NULL,
        model TEXT,
        parameters TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN (
            'queued', 'running', 'success', 'failed', 'cancelled',
            'retrying', 'recovering'
          )
        ),
        attempt INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_id TEXT,
        estimated_cost_microunits INTEGER,
        actual_cost_microunits INTEGER,
        provider_profile_id TEXT,
        provider_model_id TEXT,
        result_asset_id TEXT,
        cost_currency TEXT NOT NULL DEFAULT 'USD' CHECK (
          cost_currency IN ('USD', 'CNY')
        ),
        provider_task_id TEXT,
        provider_usage_tokens INTEGER,
        model_configuration TEXT NOT NULL DEFAULT '{}',
        UNIQUE (canvas_id, idempotency_key)
      );
      CREATE TABLE generation_task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN (
            'queued', 'running', 'success', 'failed', 'cancelled',
            'retrying', 'recovering'
          )
        ),
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE generation_safety_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        global_enabled INTEGER NOT NULL DEFAULT 0,
        emergency_stop INTEGER NOT NULL DEFAULT 0,
        per_user_concurrency INTEGER NOT NULL DEFAULT 1,
        requests_per_minute INTEGER NOT NULL DEFAULT 3,
        image_concurrency INTEGER NOT NULL DEFAULT 1,
        video_concurrency INTEGER NOT NULL DEFAULT 1,
        audio_concurrency INTEGER NOT NULL DEFAULT 1,
        daily_cost_limit_microunits INTEGER NOT NULL DEFAULT 0,
        monthly_cost_limit_microunits INTEGER NOT NULL DEFAULT 0,
        unknown_cost_policy TEXT NOT NULL DEFAULT 'block',
        failure_threshold INTEGER NOT NULL DEFAULT 3,
        cooldown_minutes INTEGER NOT NULL DEFAULT 30,
        running_task_policy TEXT NOT NULL DEFAULT 'wait',
        updated_at TEXT NOT NULL,
        daily_cost_limit_cny_microunits INTEGER NOT NULL DEFAULT 0,
        monthly_cost_limit_cny_microunits INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO generation_safety_settings (id, updated_at)
      VALUES (1, '2026-08-01T00:00:00.000Z');
    `);
    const migrationNames = [
      "canvas-history-and-project-metadata",
      "persistent-generation-tasks",
      "generation-task-state-events",
      "accounts-sessions-and-owned-data",
      "administrator-model-catalog",
      "remove-unconfigured-example-models",
      "private-object-storage-metadata",
      "generation-safety-controls",
      "generation-provider-results-and-model-cost-caps",
      "multi-currency-video-generation",
      "generation-model-configuration-snapshot",
      "canvas-save-session-ordering",
    ];
    const insertMigration = legacy.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `);
    migrationNames.forEach((name, index) =>
      insertMigration.run(index + 1, name, "2026-08-01T00:00:00.000Z"));
    legacy.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status
      ) VALUES ('video', ?, ?, ?, ?, ?, ?, 'oss', ?, 'video/mp4', ?, 'ready')
    `).run(
      "historical-video.mp4",
      "historical-owner",
      "historical-video.mp4",
      1_024,
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      "objects/2026/08/video/historical-video.mp4",
      "a".repeat(64),
    );
    legacy.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        estimated_cost_microunits, actual_cost_microunits,
        provider_profile_id, provider_model_id, result_asset_id,
        cost_currency, provider_task_id, provider_usage_tokens,
        model_configuration
      ) VALUES (
        ?, ?, ?, 'image', ?, ?, ?, ?, ?, 'failed', 2, ?, ?, ?, ?, ?,
        ?, NULL, ?, ?, NULL, 'CNY', NULL, NULL, ?
      )
    `).run(
      "preserved-generation-task",
      "preserved-canvas",
      "preserved-image-node",
      "保留的提示词",
      "preserved-model",
      '{"quality":"high"}',
      "preserved-idempotency",
      "preserved-fingerprint",
      "REMOTE",
      "保留的失败原因",
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:02:00.000Z",
      "preserved-owner",
      500_000,
      "preserved-provider",
      "preserved-provider-model",
      '{"maxCostMicrounits":500000}',
    );
    const insertEvent = legacy.prepare(`
      INSERT INTO generation_task_events (
        id, task_id, state, error_code, error_message, created_at
      ) VALUES (?, 'preserved-generation-task', ?, ?, ?, ?)
    `);
    insertEvent.run(
      41,
      "queued",
      null,
      null,
      "2026-08-01T00:00:00.000Z",
    );
    insertEvent.run(
      42,
      "failed",
      "REMOTE",
      "保留的失败原因",
      "2026-08-01T00:02:00.000Z",
    );
    legacy.close();

    const migrated = openAppDatabase(dataDirectory);
    expect(migrated.prepare(`
      SELECT
        byte_size, duration_seconds, duration_source, duration_status,
        storage_backend, storage_name
      FROM media_assets WHERE kind = 'video' AND id = ?
    `).get("historical-video.mp4")).toEqual({
      byte_size: 1_024,
      duration_seconds: null,
      duration_source: null,
      duration_status: "pending",
      storage_backend: "oss",
      storage_name: "historical-video.mp4",
    });
    expect(migrated.prepare("PRAGMA user_version").get()).toEqual({
      user_version: currentSchemaVersion,
    });
    expect(migrated.prepare(`
      SELECT
        id, state, attempt, error_code, error_message,
        estimated_cost_microunits, cost_currency, model_configuration,
        result_text
      FROM generation_tasks WHERE id = ?
    `).get("preserved-generation-task")).toEqual({
      attempt: 2,
      cost_currency: "CNY",
      error_code: "REMOTE",
      error_message: "保留的失败原因",
      estimated_cost_microunits: 500_000,
      id: "preserved-generation-task",
      model_configuration: '{"maxCostMicrounits":500000}',
      result_text: null,
      state: "failed",
    });
    expect(migrated.prepare(`
      SELECT id, state, error_code, error_message
      FROM generation_task_events
      WHERE task_id = ?
      ORDER BY id
    `).all("preserved-generation-task")).toEqual([
      { error_code: null, error_message: null, id: 41, state: "queued" },
      {
        error_code: "REMOTE",
        error_message: "保留的失败原因",
        id: 42,
        state: "failed",
      },
    ]);
    expect(migrated.prepare(`
      SELECT text_concurrency FROM generation_safety_settings WHERE id = 1
    `).get()).toEqual({ text_concurrency: 1 });
    migrated.close();

    const reopened = openAppDatabase(dataDirectory);
    expect(reopened.prepare(`
      SELECT COUNT(*) AS count FROM media_assets WHERE id = ?
    `).get("historical-video.mp4")).toEqual({ count: 1 });
    reopened.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("an encrypted frozen snapshot verifies and restores without plaintext or source writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-backup-roundtrip-"));
  let fixture: Fixture | undefined;
  try {
    fixture = await createBackupFixture(root);
    expect((await lstat(`${join(fixture.dataDirectory, "unboundry.sqlite")}-wal`)).size)
      .toBeGreaterThan(0);
    const sourceBefore = await treeFingerprint(fixture.dataDirectory);
    const backupResult = await execute(
      process.execPath,
      [
        "scripts/backup-data.mjs",
        "--source-frozen",
        "--data-dir",
        fixture.dataDirectory,
        "--backup-root",
        fixture.backupRoot,
        "--scratch-root",
        fixture.scratchRoot,
        "--recovery-public-key",
        fixture.paths.recoveryPublic,
        "--signing-private-key",
        fixture.paths.signingPrivate,
        "--oss-mirror",
        JSON.stringify({
          filePath: fixture.mirrorPath,
          objectKey: fixture.objectKey,
          versionId: "fake-version-1",
        }),
      ],
      { cwd: process.cwd() },
    );
    const backup = JSON.parse(backupResult.stdout.trim()) as {
      databaseLogicalSha256: string;
      mediaFiles: number;
      mediaIntegrity: {
        backupBlockingIssues: number;
        clean: boolean;
        evidenceSha256: string;
        issues: number;
        sha256: string;
      };
      ossMirrors: number;
      packageDirectory: string;
      schemaVersion: number;
      secretFiles: number;
    };
    expect(backup).toMatchObject({
      mediaFiles: 2,
      mediaIntegrity: {
        backupBlockingIssues: 0,
        clean: false,
        issues: 1,
      },
      ossMirrors: 1,
      schemaVersion: currentSchemaVersion,
      secretFiles: 3,
    });
    expect(backup.databaseLogicalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(backup.mediaIntegrity.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await treeFingerprint(fixture.dataDirectory)).toBe(sourceBefore);
    expect(await packageContains(backup.packageDirectory, fixtureSentinel)).toBe(false);

    await chmod(root, 0o777);
    await expectPackageError(
      verifyEncryptedBackup(verifyOptions(fixture, backup.packageDirectory)),
      "BACKUP_DIRECTORY_PERMISSIONS_INVALID",
    );
    await chmod(root, 0o700);

    await chmod(fixture.paths.recoveryPrivate, 0o644);
    let insecureVerifyKey: (Error & { stderr?: string }) | undefined;
    try {
      await execute(
        process.execPath,
        [
          "scripts/verify-backup.mjs",
          "--backup-dir",
          backup.packageDirectory,
          "--recovery-private-key",
          fixture.paths.recoveryPrivate,
          "--trusted-signing-public-key",
          fixture.paths.signingPublic,
        ],
        { cwd: process.cwd() },
      );
    } catch (error) {
      insecureVerifyKey = error as Error & { stderr?: string };
    }
    expect(JSON.parse(insecureVerifyKey?.stderr ?? "{}")).toMatchObject({
      code: "BACKUP_KEY_INVALID",
    });
    await chmod(fixture.paths.recoveryPrivate, 0o600);

    await chmod(fixture.paths.signingPublic, 0o666);
    let writableTrustAnchor: (Error & { stderr?: string }) | undefined;
    try {
      await execute(
        process.execPath,
        [
          "scripts/verify-backup.mjs",
          "--backup-dir",
          backup.packageDirectory,
          "--recovery-private-key",
          fixture.paths.recoveryPrivate,
          "--trusted-signing-public-key",
          fixture.paths.signingPublic,
        ],
        { cwd: process.cwd() },
      );
    } catch (error) {
      writableTrustAnchor = error as Error & { stderr?: string };
    }
    expect(JSON.parse(writableTrustAnchor?.stderr ?? "{}")).toMatchObject({
      code: "BACKUP_KEY_INVALID",
    });
    await chmod(fixture.paths.signingPublic, 0o600);

    const verifyResult = await execute(
      process.execPath,
      [
        "scripts/verify-backup.mjs",
        "--backup-dir",
        backup.packageDirectory,
        "--recovery-private-key",
        fixture.paths.recoveryPrivate,
        "--trusted-signing-public-key",
        fixture.paths.signingPublic,
      ],
      { cwd: process.cwd() },
    );
    const verified = JSON.parse(verifyResult.stdout.trim()) as typeof backup;
    expect(verified).toMatchObject({
      databaseLogicalSha256: backup.databaseLogicalSha256,
      mediaFiles: 2,
      mediaIntegrity: backup.mediaIntegrity,
      ossMirrors: 1,
      schemaVersion: currentSchemaVersion,
      secretFiles: 3,
    });

    const targetDirectory = join(root, "restored-data");
    await chmod(fixture.paths.recoveryPrivate, 0o644);
    let insecureRestoreKey: (Error & { stderr?: string }) | undefined;
    try {
      await execute(
        process.execPath,
        [
          "scripts/restore-backup.mjs",
          "--backup-dir",
          backup.packageDirectory,
          "--target-data-dir",
          targetDirectory,
          "--scratch-root",
          fixture.scratchRoot,
          "--recovery-private-key",
          fixture.paths.recoveryPrivate,
          "--trusted-signing-public-key",
          fixture.paths.signingPublic,
        ],
        { cwd: process.cwd() },
      );
    } catch (error) {
      insecureRestoreKey = error as Error & { stderr?: string };
    }
    expect(JSON.parse(insecureRestoreKey?.stderr ?? "{}")).toMatchObject({
      code: "BACKUP_KEY_INVALID",
    });
    await expect(lstat(targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await chmod(fixture.paths.recoveryPrivate, 0o600);
    const restoreResult = await execute(
      process.execPath,
      [
        "scripts/restore-backup.mjs",
        "--backup-dir",
        backup.packageDirectory,
        "--target-data-dir",
        targetDirectory,
        "--scratch-root",
        fixture.scratchRoot,
        "--recovery-private-key",
        fixture.paths.recoveryPrivate,
        "--trusted-signing-public-key",
        fixture.paths.signingPublic,
      ],
      { cwd: process.cwd() },
    );
    const restored = JSON.parse(restoreResult.stdout.trim()) as typeof backup;
    expect(restored).toMatchObject({
      databaseLogicalSha256: backup.databaseLogicalSha256,
      mediaFiles: 2,
      mediaIntegrity: backup.mediaIntegrity,
      ossMirrors: 1,
      schemaVersion: currentSchemaVersion,
      secretFiles: 3,
    });
    expect((await readdir(root)).some((name) =>
      name.startsWith(".restored-data.restore-"))).toBe(false);
    const restoredInspection = inspectBackupDatabase(
      join(targetDirectory, "unboundry.sqlite"),
      targetDirectory,
    );
    expect(restoredInspection.logicalSha256).toBe(backup.databaseLogicalSha256);
    expect(
      restoredInspection.tables.map(({ name }) => name),
    ).toContain("sqlite_sequence");
    await expect(
      validateBackupSecrets(
        join(targetDirectory, "unboundry.sqlite"),
        join(targetDirectory, "secrets"),
        targetDirectory,
      ),
    ).resolves.toEqual({
      accountCredentials: 1,
      masterKeyPresent: true,
      providerDocumentProfiles: 1,
      storageDocumentProfiles: 1,
    });
    expect(await readFile(join(targetDirectory, "media", "orphan.bin"), "utf8"))
      .toContain(fixtureSentinel);
    const restoredMirrorNames = await readdir(join(targetDirectory, "oss-mirrors"));
    expect(restoredMirrorNames).toHaveLength(1);
    expect(
      await readFile(join(targetDirectory, "oss-mirrors", restoredMirrorNames[0])),
    ).toEqual(await readFile(fixture.mirrorPath));
    await expect(
      lstat(join(
        targetDirectory,
        "secrets",
        "provider-profile-write-lock.sqlite",
      )),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await lstat(targetDirectory)).mode & 0o777).toBe(0o700);
    const restoredDatabase = new DatabaseSync(
      join(targetDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
    try {
      expect(restoredDatabase.prepare(`
        SELECT user_id FROM sessions WHERE token_hash = ?
      `).get(sha256(fixture.sessionToken))).toEqual({ user_id: "backup-user" });
    } finally {
      restoredDatabase.close();
    }
    await expect(localAuthLogin(targetDirectory)).resolves.toMatchObject({
      body: { user: { id: "backup-user" } },
      headers: { "set-cookie": expect.stringContaining("unboundry_session=") },
      statusCode: 200,
    });
    const restoreMarker = join(targetDirectory, ".unboundry-restore-incomplete");
    await writeFile(restoreMarker, "restore-incomplete\n", { mode: 0o600 });
    const lifecycle = createRuntimeLifecycle({
      dataDirectory: targetDirectory,
      logger() {},
    });
    expect(lifecycle.probeDatabase()).toEqual({
      code: "DATABASE_RESTORE_INCOMPLETE",
      ok: false,
    });
    await rm(restoreMarker);
    await symlink("missing-restore-marker-target", restoreMarker);
    expect(lifecycle.probeDatabase()).toEqual({
      code: "DATABASE_RESTORE_INCOMPLETE",
      ok: false,
    });
    await rm(restoreMarker);
    expect(lifecycle.probeDatabase()).toMatchObject({
      ok: true,
      schemaVersion: currentSchemaVersion,
    });
    expect(await emptyOrMissing(fixture.scratchRoot)).toBe(true);
  } finally {
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("backup creation fails closed when the integrity report has a backup-blocking issue", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-backup-integrity-block-"));
  let fixture: Fixture | undefined;
  try {
    fixture = await createBackupFixture(root);
    fixture.database.prepare(`
      UPDATE media_assets
      SET storage_profile_id = 'missing-storage-profile'
      WHERE kind = 'image' AND id = 'preserved-oss-image'
    `).run();
    const report = await inspectFrozenMediaIntegrity({
      ossMirrors: backupOptions(fixture).ossMirrors,
      scratchRoot: fixture.scratchRoot,
      sourceDirectory: fixture.dataDirectory,
      sourceFrozen: true,
    });
    expect(report.issues).toContainEqual(expect.objectContaining({
      assetId: "preserved-oss-image",
      backupBlocking: true,
      code: "MEDIA_INTEGRITY_OSS_PROFILE_MISSING",
      storageBackend: "oss",
    }));
    expect(JSON.stringify(report)).not.toContain("missing-storage-profile");
    expect(report.backupComplete).toBe(false);
    await expectPackageError(
      createEncryptedBackup(backupOptions(fixture)),
      "BACKUP_MEDIA_INTEGRITY_INCOMPLETE",
    );
    expect(await readdir(fixture.backupRoot)).toEqual([]);
    expect(await emptyOrMissing(fixture.scratchRoot)).toBe(true);
  } finally {
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("backup CLI requires a freeze confirmation and external regular key files", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-backup-cli-guard-"));
  let fixture: Fixture | undefined;
  try {
    fixture = await createBackupFixture(root);
    await chmod(root, 0o777);
    await expectPackageError(
      createEncryptedBackup(backupOptions(fixture)),
      "BACKUP_DIRECTORY_PERMISSIONS_INVALID",
    );
    await chmod(root, 0o700);
    const baseArguments = [
      "scripts/backup-data.mjs",
      "--data-dir",
      fixture.dataDirectory,
      "--backup-root",
      fixture.backupRoot,
      "--scratch-root",
      fixture.scratchRoot,
      "--recovery-public-key",
      fixture.paths.recoveryPublic,
      "--signing-private-key",
      fixture.paths.signingPrivate,
    ];
    let missingFreeze: (Error & { stderr?: string }) | undefined;
    try {
      await execute(process.execPath, baseArguments, { cwd: process.cwd() });
    } catch (error) {
      missingFreeze = error as Error & { stderr?: string };
    }
    expect(missingFreeze).toBeDefined();
    expect(JSON.parse(missingFreeze?.stderr ?? "{}")).toMatchObject({
      code: "BACKUP_ARGUMENT_INVALID",
    });

    const linkedKey = join(root, "linked-recovery.pem");
    await symlink(fixture.paths.recoveryPublic, linkedKey);
    let linkedFailure: (Error & { stderr?: string }) | undefined;
    try {
      await execute(
        process.execPath,
        [
          ...baseArguments,
          "--source-frozen",
        ].map((value) =>
          value === fixture?.paths.recoveryPublic ? linkedKey : value),
        { cwd: process.cwd() },
      );
    } catch (error) {
      linkedFailure = error as Error & { stderr?: string };
    }
    expect(JSON.parse(linkedFailure?.stderr ?? "{}")).toMatchObject({
      code: "BACKUP_KEY_INVALID",
    });
    expect(linkedFailure?.stderr).not.toContain(linkedKey);

    await chmod(fixture.paths.signingPrivate, 0o644);
    let permissiveFailure: (Error & { stderr?: string }) | undefined;
    try {
      await execute(process.execPath, [...baseArguments, "--source-frozen"], {
        cwd: process.cwd(),
      });
    } catch (error) {
      permissiveFailure = error as Error & { stderr?: string };
    }
    expect(JSON.parse(permissiveFailure?.stderr ?? "{}")).toMatchObject({
      code: "BACKUP_KEY_INVALID",
    });
    await chmod(fixture.paths.signingPrivate, 0o600);

    const hardLink = join(root, "hard-linked-signing-private.pem");
    await link(fixture.paths.signingPrivate, hardLink);
    let hardLinkFailure: (Error & { stderr?: string }) | undefined;
    try {
      await execute(process.execPath, [...baseArguments, "--source-frozen"], {
        cwd: process.cwd(),
      });
    } catch (error) {
      hardLinkFailure = error as Error & { stderr?: string };
    }
    expect(JSON.parse(hardLinkFailure?.stderr ?? "{}")).toMatchObject({
      code: "BACKUP_KEY_INVALID",
    });
    await rm(hardLink);

    let keyAsMirrorFailure: (Error & { stderr?: string }) | undefined;
    try {
      await execute(
        process.execPath,
        [
          ...baseArguments,
          "--source-frozen",
          "--oss-mirror",
          JSON.stringify({
            filePath: fixture.paths.signingPrivate,
            objectKey: fixture.objectKey,
            versionId: "fake-version-1",
          }),
        ],
        { cwd: process.cwd() },
      );
    } catch (error) {
      keyAsMirrorFailure = error as Error & { stderr?: string };
    }
    expect(JSON.parse(keyAsMirrorFailure?.stderr ?? "{}")).toMatchObject({
      code: "BACKUP_KEY_LOCATION_INVALID",
    });

    const nestedKey = join(fixture.dataDirectory, "nested-private-key.pem");
    await writeFile(nestedKey, fixture.keys.signing.privateKey, { mode: 0o600 });
    let nestedFailure: (Error & { stderr?: string }) | undefined;
    try {
      await execute(
        process.execPath,
        [
          ...baseArguments,
          "--source-frozen",
        ].map((value) =>
          value === fixture?.paths.signingPrivate ? nestedKey : value),
        { cwd: process.cwd() },
      );
    } catch (error) {
      nestedFailure = error as Error & { stderr?: string };
    }
    expect(JSON.parse(nestedFailure?.stderr ?? "{}")).toMatchObject({
      code: "BACKUP_KEY_LOCATION_INVALID",
    });
    expect(nestedFailure?.stderr).not.toContain(nestedKey);
    expect(await emptyOrMissing(fixture.backupRoot)).toBe(true);
  } finally {
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("backup refuses inconsistent media, links, broken secrets, and false OSS mirrors", async () => {
  const cases: Array<{
    code: string;
    mutate: (fixture: Fixture) => Promise<void>;
    name: string;
  }> = [
    {
      code: "BACKUP_SOURCE_PERMISSIONS_INVALID",
      mutate: async (fixture) => {
        await chmod(join(fixture.dataDirectory, "unboundry.sqlite"), 0o666);
      },
      name: "writable-database",
    },
    {
      code: "BACKUP_DATABASE_SCHEMA_UNSUPPORTED",
      mutate: async (fixture) => {
        fixture.database.exec(`
          CREATE VIEW unexpected_backup_users AS
          SELECT id FROM users WHERE status = 'active';
        `);
      },
      name: "unexpected-database-view",
    },
    {
      code: "BACKUP_SOURCE_PERMISSIONS_INVALID",
      mutate: async (fixture) => {
        const writableDirectory = join(fixture.dataDirectory, "media", "unsafe-nested");
        await mkdir(writableDirectory);
        await chmod(writableDirectory, 0o777);
      },
      name: "writable-media-directory",
    },
    {
      code: "BACKUP_MEDIA_MISSING",
      mutate: async (fixture) => {
        await writeFile(join(fixture.dataDirectory, "media", fixture.localName), "wrong-size");
      },
      name: "local-size",
    },
    {
      code: "BACKUP_LINK_REJECTED",
      mutate: async (fixture) => {
        await symlink(
          fixture.localName,
          join(fixture.dataDirectory, "media", "linked-image.png"),
        );
      },
      name: "media-link",
    },
    {
      code: "BACKUP_SECRET_DOCUMENT_INVALID",
      mutate: async (fixture) => {
        await writeFile(
          join(fixture.dataDirectory, "secrets", "provider-profiles.enc.json"),
          "{broken-secret",
        );
      },
      name: "broken-secret",
    },
    {
      code: "BACKUP_SECRET_FILE_UNKNOWN",
      mutate: async (fixture) => {
        await writeFile(
          join(fixture.dataDirectory, "secrets", "unexpected-secret.txt"),
          "must-not-be-backed-up",
        );
      },
      name: "unknown-secret",
    },
    {
      code: "BACKUP_OSS_MIRROR_MISSING",
      mutate: async (fixture) => {
        await writeFile(fixture.mirrorPath, "wrong-mirror");
      },
      name: "oss-mirror",
    },
    {
      code: "BACKUP_MEDIA_INTEGRITY_INCOMPLETE",
      mutate: async (fixture) => {
        fixture.database.prepare(`
          UPDATE media_assets SET storage_profile_id = 'missing-storage-profile'
          WHERE id = 'preserved-oss-image'
        `).run();
      },
      name: "missing-storage-profile",
    },
    {
      code: "BACKUP_MEDIA_INTEGRITY_INCOMPLETE",
      mutate: async (fixture) => {
        fixture.database.prepare(`
          INSERT INTO media_publication_attempts (
            attempt_id, owner_id, kind, asset_id, source, state,
            storage_backend, final_storage_name, object_key,
            storage_profile_id, staging_name, content_type,
            created_at, updated_at
          ) VALUES (
            'missing-profile-journal', 'backup-user', 'image',
            'missing-profile-journal', 'upload', 'failed', 'oss',
            'missing-profile-journal.png', 'objects/missing-profile-journal',
            'missing-storage-profile',
            '.publication-missing-profile-journal.generating', 'image/png',
            '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
          )
        `).run();
      },
      name: "missing-storage-profile-journal",
    },
    {
      code: "BACKUP_OSS_STATE_UNRECOVERABLE",
      mutate: async (fixture) => {
        fixture.database.prepare(`
          UPDATE media_assets SET storage_status = 'pending'
          WHERE id = 'preserved-oss-image'
        `).run();
      },
      name: "pending-oss-object",
    },
    {
      code: "BACKUP_OSS_STATE_UNRECOVERABLE",
      mutate: async (fixture) => {
        fixture.database.prepare(`
          UPDATE media_assets SET storage_status = 'failed'
          WHERE id = 'preserved-oss-image'
        `).run();
      },
      name: "failed-oss-object",
    },
  ];
  for (const candidate of cases) {
    const root = await mkdtemp(join(tmpdir(), `unboundry-backup-${candidate.name}-`));
    let fixture: Fixture | undefined;
    try {
      fixture = await createBackupFixture(root);
      await candidate.mutate(fixture);
      await expectPackageError(
        createEncryptedBackup(backupOptions(fixture)),
        candidate.code,
      );
      expect(await emptyOrMissing(fixture.backupRoot)).toBe(true);
      expect(await emptyOrMissing(fixture.scratchRoot)).toBe(true);
    } finally {
      fixture?.database.close();
      await rm(root, { force: true, recursive: true });
    }
  }
});

test("wrong keys, signature damage, ciphertext damage, and extra objects are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-backup-corruption-"));
  let fixture: Fixture | undefined;
  try {
    fixture = await createBackupFixture(root);
    const backup = await createEncryptedBackup(backupOptions(fixture));
    let restoreCase = 0;
    const expectRestoreRejected = async (expectedCode: string) => {
      const targetDirectory = join(root, `rejected-restore-${restoreCase++}`);
      await expectPackageError(
        restoreEncryptedBackup({
          ...verifyOptions(fixture!, backup.packageDirectory),
          targetDirectory,
        }),
        expectedCode,
      );
      await expect(lstat(targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    };
    const wrongRecovery = createKeys().recovery.privateKey;
    await expectPackageError(
      verifyEncryptedBackup({
        ...verifyOptions(fixture, backup.packageDirectory),
        recoveryPrivateKey: wrongRecovery,
      }),
      "BACKUP_RECOVERY_KEY_MISMATCH",
    );
    const wrongSigning = createKeys().signing.publicKey;
    await expectPackageError(
      verifyEncryptedBackup({
        ...verifyOptions(fixture, backup.packageDirectory),
        trustedSigningPublicKey: wrongSigning,
      }),
      "BACKUP_SIGNING_KEY_MISMATCH",
    );

    const envelopePath = join(backup.packageDirectory, "envelope.json");
    const originalEnvelope = await readFile(envelopePath);
    const envelope = JSON.parse(originalEnvelope.toString("utf8")) as {
      signature: string;
    };
    const signature = Buffer.from(envelope.signature, "base64");
    signature[0] ^= 1;
    envelope.signature = signature.toString("base64");
    await writeFile(envelopePath, `${JSON.stringify(envelope)}\n`);
    await expectPackageError(
      verifyEncryptedBackup(verifyOptions(fixture, backup.packageDirectory)),
      "BACKUP_SIGNATURE_INVALID",
    );
    await expectRestoreRejected("BACKUP_SIGNATURE_INVALID");
    await writeFile(envelopePath, originalEnvelope);

    const extraPath = join(backup.packageDirectory, "objects", "extra.bin");
    await writeFile(extraPath, "unexpected-object");
    await expectPackageError(
      verifyEncryptedBackup(verifyOptions(fixture, backup.packageDirectory)),
      "BACKUP_PACKAGE_INVENTORY_INVALID",
    );
    await expectRestoreRejected("BACKUP_PACKAGE_INVENTORY_INVALID");
    await rm(extraPath);

    const manifestPath = join(backup.packageDirectory, "manifest.bin");
    const manifestBytes = await readFile(manifestPath);
    const damagedManifest = Buffer.from(manifestBytes);
    damagedManifest[0] ^= 1;
    await writeFile(manifestPath, damagedManifest);
    await expectPackageError(
      verifyEncryptedBackup(verifyOptions(fixture, backup.packageDirectory)),
      "BACKUP_MANIFEST_CIPHERTEXT_INVALID",
    );
    await expectRestoreRejected("BACKUP_MANIFEST_CIPHERTEXT_INVALID");
    await writeFile(manifestPath, manifestBytes);

    const objectDirectory = join(backup.packageDirectory, "objects");
    for (const [index, objectName] of (await readdir(objectDirectory)).sort().entries()) {
      const objectPath = join(objectDirectory, objectName);
      const objectBytes = await readFile(objectPath);
      const damagedObject = Buffer.from(objectBytes);
      damagedObject[index % damagedObject.length] ^= 1;
      await writeFile(objectPath, damagedObject);
      await expectPackageError(
        verifyEncryptedBackup(verifyOptions(fixture, backup.packageDirectory)),
        "BACKUP_OBJECT_CHECKSUM_INVALID",
      );
      await expectRestoreRejected("BACKUP_OBJECT_CHECKSUM_INVALID");
      await writeFile(objectPath, objectBytes);
    }
    expect(await emptyOrMissing(fixture.scratchRoot)).toBe(true);
  } finally {
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("backup checkpoint failures never publish a partial package", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-backup-faults-"));
  let fixture: Fixture | undefined;
  try {
    fixture = await createBackupFixture(root);
    const before = await treeFingerprint(fixture.dataDirectory);
    const checkpoints: BackupCheckpointName[] = [
      "after-database-snapshot",
      "after-media-encryption",
      "after-secrets-encryption",
      "after-package-seal",
      "before-backup-publish",
      "after-backup-reservation",
    ];
    for (const expected of checkpoints) {
      await expectPackageError(
        createEncryptedBackup({
          ...backupOptions(fixture),
          onCheckpoint(checkpoint) {
            if (checkpoint === expected) throw new Error(`fault:${expected}`);
          },
        }),
        "BACKUP_CREATE_FAILED",
      );
      if (expected === "after-backup-reservation") {
        const packages = (await readdir(fixture.backupRoot)).filter((name) =>
          name.endsWith(".ubbackup"));
        expect(packages).toHaveLength(1);
        expect((await lstat(join(
          fixture.backupRoot,
          packages[0],
          ".unboundry-backup-incomplete",
        ))).isFile()).toBe(true);
        await expectPackageError(
          verifyEncryptedBackup(verifyOptions(
            fixture,
            join(fixture.backupRoot, packages[0]),
          )),
          "BACKUP_PACKAGE_INCOMPLETE",
        );
        await rm(join(fixture.backupRoot, packages[0]), {
          force: true,
          recursive: true,
        });
      } else {
        expect(await emptyOrMissing(fixture.backupRoot)).toBe(true);
      }
      expect(await emptyOrMissing(fixture.scratchRoot)).toBe(true);
      expect(await treeFingerprint(fixture.dataDirectory)).toBe(before);
    }

    let foreignPackageDirectory = "";
    await expectPackageError(
      createEncryptedBackup({
        ...backupOptions(fixture),
        async onCheckpoint(checkpoint) {
          if (checkpoint !== "after-backup-reservation") return;
          const packageName = (await readdir(fixture!.backupRoot)).find((name) =>
            name.endsWith(".ubbackup"));
          expect(packageName).toBeTruthy();
          foreignPackageDirectory = join(fixture!.backupRoot, packageName!);
          await writeFile(
            join(foreignPackageDirectory, "envelope.json"),
            "keep-foreign-package-entry",
          );
        },
      }),
      "BACKUP_TARGET_CHANGED",
    );
    expect(await readFile(
      join(foreignPackageDirectory, "envelope.json"),
      "utf8",
    )).toBe("keep-foreign-package-entry");
    expect((await lstat(join(
      foreignPackageDirectory,
      ".unboundry-backup-incomplete",
    ))).isFile()).toBe(true);
    expect((await readdir(fixture.backupRoot)).some((name) =>
      name.startsWith(".partial-"))).toBe(false);
  } finally {
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("restore failures stay fail-closed, clean staging, and preserve foreign targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-restore-faults-"));
  let fixture: Fixture | undefined;
  try {
    fixture = await createBackupFixture(root);
    const backup = await createEncryptedBackup(backupOptions(fixture));
    const occupied = join(root, "occupied-target");
    await mkdir(occupied);
    await writeFile(join(occupied, "sentinel.txt"), "keep-me");
    await expectPackageError(
      restoreEncryptedBackup({
        ...verifyOptions(fixture, backup.packageDirectory),
        targetDirectory: occupied,
      }),
      "BACKUP_RESTORE_TARGET_EXISTS",
    );
    expect(await readFile(join(occupied, "sentinel.txt"), "utf8")).toBe("keep-me");

    const checkpoints: BackupCheckpointName[] = [
      "after-restore-database",
      "after-restore-media",
      "after-restore-secrets",
      "before-restore-publish",
      "after-restore-reservation",
    ];
    for (const expected of checkpoints) {
      const targetDirectory = join(root, `restore-${expected}`);
      await expectPackageError(
        restoreEncryptedBackup({
          ...verifyOptions(fixture, backup.packageDirectory),
          onCheckpoint(checkpoint) {
            if (checkpoint === expected) throw new Error(`fault:${expected}`);
          },
          targetDirectory,
        }),
        "BACKUP_RESTORE_FAILED",
      );
      if (expected === "after-restore-reservation") {
        expect((await lstat(join(
          targetDirectory,
          ".unboundry-restore-incomplete",
        ))).isFile()).toBe(true);
        const lifecycle = createRuntimeLifecycle({
          dataDirectory: targetDirectory,
          logger() {},
        });
        expect(lifecycle.probeDatabase()).toEqual({
          code: "DATABASE_RESTORE_INCOMPLETE",
          ok: false,
        });
      } else {
        await expect(lstat(targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      }
      expect(
        (await readdir(root)).some((name) =>
          name.startsWith(`.${expected}.restore-`) ||
          name.startsWith(`.restore-${expected}.restore-`)),
      ).toBe(false);
    }

    const racedTarget = join(root, "restore-raced-target");
    await expectPackageError(
      restoreEncryptedBackup({
        ...verifyOptions(fixture, backup.packageDirectory),
        async onCheckpoint(checkpoint) {
          if (checkpoint !== "after-restore-reservation") return;
          await rm(racedTarget, { force: true, recursive: true });
          await mkdir(racedTarget, { mode: 0o700 });
          await writeFile(join(racedTarget, "foreign-sentinel.txt"), "keep-foreign");
        },
        targetDirectory: racedTarget,
      }),
      "BACKUP_RESTORE_TARGET_CHANGED",
    );
    expect(await readFile(join(racedTarget, "foreign-sentinel.txt"), "utf8"))
      .toBe("keep-foreign");

    const foreignEntryTarget = join(root, "restore-foreign-entry");
    await expectPackageError(
      restoreEncryptedBackup({
        ...verifyOptions(fixture, backup.packageDirectory),
        async onCheckpoint(checkpoint) {
          if (checkpoint !== "after-restore-reservation") return;
          await writeFile(
            join(foreignEntryTarget, "foreign-sentinel.txt"),
            "keep-foreign-entry",
          );
        },
        targetDirectory: foreignEntryTarget,
      }),
      "BACKUP_RESTORE_TARGET_CHANGED",
    );
    expect(await readFile(
      join(foreignEntryTarget, "foreign-sentinel.txt"),
      "utf8",
    )).toBe("keep-foreign-entry");
    expect((await lstat(join(
      foreignEntryTarget,
      ".unboundry-restore-incomplete",
    ))).isFile()).toBe(true);

    const conflictingEntryTarget = join(root, "restore-conflicting-entry");
    await expectPackageError(
      restoreEncryptedBackup({
        ...verifyOptions(fixture, backup.packageDirectory),
        async onCheckpoint(checkpoint) {
          if (checkpoint !== "after-restore-reservation") return;
          await writeFile(
            join(conflictingEntryTarget, "unboundry.sqlite"),
            "keep-conflicting-file",
          );
        },
        targetDirectory: conflictingEntryTarget,
      }),
      "BACKUP_RESTORE_TARGET_CHANGED",
    );
    expect(await readFile(
      join(conflictingEntryTarget, "unboundry.sqlite"),
      "utf8",
    )).toBe("keep-conflicting-file");
    expect((await lstat(join(
      conflictingEntryTarget,
      ".unboundry-restore-incomplete",
    ))).isFile()).toBe(true);
    expect((await readdir(root)).some((name) => name.includes(".restore-")))
      .toBe(false);
  } finally {
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("schema-38 and schema-37 backups stay exact through inspection, format-2 verify, and restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-backup-schema37-"));
  const dataDirectory = join(root, "data");
  const backupRoot = join(root, "backups");
  const scratchRoot = join(root, "scratch");
  await Promise.all([
    mkdir(join(dataDirectory, "media"), { mode: 0o700, recursive: true }),
    mkdir(join(dataDirectory, "secrets"), { mode: 0o700, recursive: true }),
    mkdir(backupRoot, { mode: 0o700 }),
    mkdir(scratchRoot, { mode: 0o700 }),
  ]);
  await chmod(dataDirectory, 0o700);
  let database: ReturnType<typeof openAppDatabase> | undefined;
  try {
    database = openAppDatabase(dataDirectory);
    database.exec(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status, protected,
        created_at, updated_at
      ) VALUES (
        'schema-backup-user', 'schema-backup-user', 'Schema Backup User',
        'disabled', 'admin', 'active', 1,
        '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z'
      );
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
        request_fingerprint, state, attempt, created_at, updated_at, owner_id,
        model_configuration
      ) VALUES (
        'schema-backup-task', 'schema-backup-canvas', 'schema-backup-node',
        'image', 'safe fixture', '{}', 'schema-backup-key',
        'schema-backup-fingerprint', 'queued', 0,
        '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z',
        'schema-backup-user', '{}'
      );
      INSERT INTO generation_task_events (task_id, state, created_at)
      VALUES (
        'schema-backup-task', 'queued', '2026-08-11T00:00:00.000Z'
      );
    `);
    rollbackMigration39To38(database);
    database.exec(`
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA journal_mode = DELETE;
    `);
    database.close();
    database = undefined;

    const databasePath = join(dataDirectory, "unboundry.sqlite");
    const direct38 = inspectBackupDatabase(databasePath, dataDirectory);
    expect(direct38).toMatchObject({
      userVersion: 38,
      schema: { objectCounts: { trigger: 15, view: 0 } },
    });
    expect(direct38.migrationLedger).toHaveLength(38);
    expect(direct38.migrationLedger.at(-1)).toEqual({
      name: "durable-media-publications",
      version: 38,
    });
    expect(direct38.tables).toHaveLength(23);
    expect(direct38.tables.map(({ name }) => name)).not.toContain(
      "account_provider_credential_epochs",
    );
    expect(direct38.tables.map(({ name }) => name)).not.toContain(
      "generation_admission_events",
    );
    expect(validateMaterializedBackupDatabase(
      databasePath,
      dataDirectory,
      direct38,
    )).toEqual(direct38);
    await expect(inspectFrozenMediaIntegrity({
      scratchRoot,
      sourceDirectory: dataDirectory,
      sourceFrozen: true,
    })).resolves.toMatchObject({
      backupComplete: true,
      counts: { publicationAttempts: 0 },
      schemaVersion: 38,
    });

    const keys = createKeys();
    const schema38SourceBefore = await treeFingerprint(dataDirectory);
    const schema38Backup = await createEncryptedBackup({
      backupRoot,
      recoveryPublicKey: keys.recovery.publicKey,
      scratchRoot,
      signingPrivateKey: keys.signing.privateKey,
      sourceDirectory: dataDirectory,
      sourceFrozen: true,
    });
    expect(schema38Backup).toMatchObject({ schemaVersion: 38 });
    const schema38PackageOptions = {
      packageDirectory: schema38Backup.packageDirectory,
      recoveryPrivateKey: keys.recovery.privateKey,
      scratchRoot,
      trustedSigningPublicKey: keys.signing.publicKey,
    };
    await expect(verifyEncryptedBackup(schema38PackageOptions)).resolves
      .toMatchObject({ schemaVersion: 38 });
    const schema38Target = join(root, "schema38-restore");
    await expect(restoreEncryptedBackup({
      ...schema38PackageOptions,
      targetDirectory: schema38Target,
    })).resolves.toMatchObject({ schemaVersion: 38 });
    const restored38 = inspectBackupDatabase(
      join(schema38Target, "unboundry.sqlite"),
      schema38Target,
    );
    expect(restored38.userVersion).toBe(38);
    expect(restored38.migrationLedger).toEqual(direct38.migrationLedger);
    expect(restored38.logicalSha256).toBe(direct38.logicalSha256);
    expect(await treeFingerprint(dataDirectory)).toBe(schema38SourceBefore);
    expect(await emptyOrMissing(scratchRoot)).toBe(true);

    const schema38 = new DatabaseSync(databasePath);
    schema38.exec("PRAGMA foreign_keys = ON");
    rollbackMigration38To37(schema38);
    schema38.close();

    const direct = inspectBackupDatabase(databasePath, dataDirectory);
    expect(direct).toMatchObject({
      userVersion: 37,
      schema: { objectCounts: { trigger: 5, view: 0 } },
    });
    expect(direct.migrationLedger).toHaveLength(37);
    expect(direct.migrationLedger.at(-1)).toEqual({
      name: "protected-root-admin",
      version: 37,
    });
    expect(direct.tables).toHaveLength(20);
    expect(direct.tables.map(({ name }) => name)).not.toContain(
      "media_publication_attempts",
    );
    expect(direct.tables.map(({ name }) => name)).not.toContain(
      "media_delete_intents",
    );
    expect(direct.tables.map(({ name }) => name)).not.toContain(
      "account_delete_intents",
    );
    expect(validateMaterializedBackupDatabase(
      databasePath,
      dataDirectory,
      direct,
    )).toEqual(direct);

    await expect(inspectFrozenMediaIntegrity({
      scratchRoot,
      sourceDirectory: dataDirectory,
      sourceFrozen: true,
    })).resolves.toMatchObject({
      backupComplete: true,
      counts: { publicationAttempts: 0 },
      schemaVersion: 37,
    });

    const sourceBefore = await treeFingerprint(dataDirectory);
    const backup = await createEncryptedBackup({
      backupRoot,
      recoveryPublicKey: keys.recovery.publicKey,
      scratchRoot,
      signingPrivateKey: keys.signing.privateKey,
      sourceDirectory: dataDirectory,
      sourceFrozen: true,
    });
    expect(backup).toMatchObject({ schemaVersion: 37 });
    const packageOptions = {
      packageDirectory: backup.packageDirectory,
      recoveryPrivateKey: keys.recovery.privateKey,
      scratchRoot,
      trustedSigningPublicKey: keys.signing.publicKey,
    };
    await expect(verifyEncryptedBackup(packageOptions)).resolves.toMatchObject({
      schemaVersion: 37,
    });
    const targetDirectory = join(root, "schema37-restore");
    await expect(restoreEncryptedBackup({
      ...packageOptions,
      targetDirectory,
    })).resolves.toMatchObject({ schemaVersion: 37 });
    const restored = inspectBackupDatabase(
      join(targetDirectory, "unboundry.sqlite"),
      targetDirectory,
    );
    expect(restored.userVersion).toBe(37);
    expect(restored.migrationLedger).toEqual(direct.migrationLedger);
    expect(await treeFingerprint(dataDirectory)).toBe(sourceBefore);
    expect(await emptyOrMissing(scratchRoot)).toBe(true);

    const unsupported = new DatabaseSync(databasePath);
    unsupported.exec("CREATE TABLE schema37_extra (id TEXT PRIMARY KEY)");
    unsupported.close();
    expectInspectionError(
      () => inspectBackupDatabase(databasePath, dataDirectory),
      "BACKUP_DATABASE_SCHEMA_UNSUPPORTED",
    );
  } finally {
    database?.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("logical fingerprints cover every table and sqlite_sequence independent of page layout", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-backup-fingerprint-"));
  let fixture: Fixture | undefined;
  try {
    fixture = await createBackupFixture(root);
    const backup = await createEncryptedBackup(backupOptions(fixture));
    const targetDirectory = join(root, "fingerprint-restore");
    await restoreEncryptedBackup({
      ...verifyOptions(fixture, backup.packageDirectory),
      targetDirectory,
    });
    const inspectionRoot = join(root, "inspection-private");
    await mkdir(inspectionRoot, { mode: 0o700 });
    const original = join(inspectionRoot, "original.sqlite");
    const reorganized = join(inspectionRoot, "reorganized.sqlite");
    expectInspectionError(
      () => inspectBackupDatabase(
        join(targetDirectory, "unboundry.sqlite"),
        inspectionRoot,
      ),
      "BACKUP_INSPECTION_PATH_OUTSIDE_ROOT",
    );
    await copyFile(join(targetDirectory, "unboundry.sqlite"), original);
    await copyFile(original, reorganized);
    await writeFile(`${original}-wal`, "not-a-real-sidecar");
    expectInspectionError(
      () => inspectBackupDatabase(original, inspectionRoot),
      "BACKUP_DATABASE_SIDECAR_REJECTED",
    );
    await rm(`${original}-wal`);
    const physical = new DatabaseSync(reorganized);
    physical.exec("VACUUM");
    physical.close();
    const before = inspectBackupDatabase(original, inspectionRoot);
    const afterVacuum = inspectBackupDatabase(reorganized, inspectionRoot);
    expect(afterVacuum.logicalSha256).toBe(before.logicalSha256);
    expect(before.tables).toHaveLength(25);
    expect(before.tables.map(({ name }) => name)).toEqual([
      "account_delete_intents",
      "account_permissions",
      "account_provider_credential_epochs",
      "account_provider_credentials",
      "admin_audit_events",
      "asset_history",
      "canvas_documents",
      "generation_admission_events",
      "generation_provider_attempts",
      "generation_safety_settings",
      "generation_task_events",
      "generation_tasks",
      "media_assets",
      "media_delete_intents",
      "media_publication_attempts",
      "model_profiles",
      "node_model_bindings",
      "project_metadata",
      "provider_profiles",
      "public_templates",
      "schema_migrations",
      "sessions",
      "sqlite_sequence",
      "user_templates",
      "users",
    ]);
    expect(before.schema.objectCounts.trigger).toBe(15);

    const damaged = join(inspectionRoot, "damaged.sqlite");
    await copyFile(original, damaged);
    const damagedDatabase = new DatabaseSync(damaged);
    damagedDatabase.exec(`
      PRAGMA journal_mode = DELETE;
      DROP TRIGGER account_delete_guard_generation_task_insert;
    `);
    damagedDatabase.close();
    expectInspectionError(
      () => inspectBackupDatabase(damaged, inspectionRoot),
      "BACKUP_DATABASE_SCHEMA_UNSUPPORTED",
    );

    const withView = join(inspectionRoot, "unexpected-view.sqlite");
    await copyFile(original, withView);
    const viewDatabase = new DatabaseSync(withView);
    viewDatabase.exec(`
      CREATE VIEW unexpected_backup_users AS
      SELECT id FROM users WHERE status = 'active';
    `);
    viewDatabase.close();
    expectInspectionError(
      () => inspectBackupDatabase(withView, inspectionRoot),
      "BACKUP_DATABASE_SCHEMA_UNSUPPORTED",
    );

    const changed = new DatabaseSync(reorganized);
    changed.prepare(`
      UPDATE sqlite_sequence SET seq = seq + 1
      WHERE name = 'generation_task_events'
    `).run();
    changed.close();
    const afterSequenceChange = inspectBackupDatabase(reorganized, inspectionRoot);
    expect(afterSequenceChange.logicalSha256).not.toBe(before.logicalSha256);
    expect(
      afterSequenceChange.tables.find(({ name }) => name === "sqlite_sequence")?.sha256,
    ).not.toBe(
      before.tables.find(({ name }) => name === "sqlite_sequence")?.sha256,
    );
  } finally {
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});
