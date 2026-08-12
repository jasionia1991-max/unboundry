import { execFile, spawn } from "node:child_process";
import {
  createCipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import { constants as fileConstants } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable, Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { expect, test } from "./safe-test";
import {
  applyPendingSchemaMigrationsInTransaction,
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
  quarantineIncompleteReservation,
  restoreEncryptedBackup,
  validateMaterializedBackupDatabase,
  verifyEncryptedBackup,
  type BackupCheckpointName,
} from "../server/backupPackage";
import {
  createFakeOssRecoveryIndex,
  encodeFakeOssObjectIdentity,
  fakeOssRecoveryClaimPath,
  fakeOssRecoveryOwnershipMarkerName,
  ossRecoveryIndexFileName,
  readOssRecoveryIndex,
  rehydrateFakeOss,
} from "../server/fakeOssRecovery";
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

type ReservationMarkerFixture = Readonly<{
  backupId: string;
  databaseLogicalSha256: string;
}>;

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
  await mkdir(root, { mode: 0o700, recursive: true });
  // Product startup only initializes an entry-free private data directory.
  // Establish the exact current database before this rich fixture adds media
  // and secret residue; ordinary runtime code must never infer greenfield from
  // a directory that already contains business data.
  const database = openAppDatabase(dataDirectory);
  database.exec("PRAGMA wal_autocheckpoint = 0");
  await Promise.all([
    mkdir(join(dataDirectory, "media"), { recursive: true }),
    mkdir(join(dataDirectory, "secrets"), { mode: 0o700, recursive: true }),
    mkdir(backupRoot, { recursive: true }),
    mkdir(scratchRoot, { recursive: true }),
    mkdir(keyDirectory, { recursive: true }),
    mkdir(mirrorDirectory, { recursive: true }),
  ]);
  await chmod(dataDirectory, 0o700);

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
  ]);
  const secretLockPath = join(
    dataDirectory,
    "secrets",
    "provider-profile-write-lock.sqlite",
  );
  const secretLock = new DatabaseSync(secretLockPath);
  secretLock.exec(`
    PRAGMA journal_mode = DELETE;
    CREATE TABLE provider_profile_write_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      marker INTEGER NOT NULL
    );
    INSERT INTO provider_profile_write_lock (id, marker) VALUES (1, 0);
  `);
  secretLock.close();
  await chmod(secretLockPath, 0o600);

  const masterKey = randomBytes(32);
  await writeFile(
    join(dataDirectory, "secrets", "config-master.key"),
    masterKey,
    { mode: 0o600 },
  );
  await writeFile(
    join(dataDirectory, "secrets", "provider-profiles.enc.json"),
    encryptedDocument(masterKey, providerDocumentAad, {
      profiles: [{
        apiKey: `provider-${fixtureSentinel}`,
        baseUrl: "https://provider.invalid/v1",
        configurationVersion: 1,
        createdAt: "2026-08-09T00:00:00.000Z",
        driver: "openrouter",
        id: "provider-one",
        label: "Synthetic Provider",
        updatedAt: "2026-08-09T00:00:00.000Z",
      }],
      version: 1,
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(dataDirectory, "secrets", "storage-profiles.enc.json"),
    encryptedDocument(masterKey, storageDocumentAad, {
      activeProfileId: "storage-one",
      mediaRoutingEnabled: true,
      profiles: [{
        accessKeyId: "synthetic-storage-access-key",
        accessKeySecret: `storage-${fixtureSentinel}`,
        bucket: "synthetic-private-bucket",
        createdAt: "2026-08-09T00:00:00.000Z",
        endpoint: "https://oss.invalid",
        id: "storage-one",
        label: "Synthetic storage",
        provider: "aliyun-oss",
        region: "synthetic-region",
        status: "active",
        updatedAt: "2026-08-09T00:00:00.000Z",
      }],
      version: 1,
    }),
    { mode: 0o600 },
  );

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
    UPDATE provider_profiles
    SET provider_configuration_version = 1
    WHERE id = 'provider-one'
  `).run();
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

async function createFinalSchema37Fixture(root: string) {
  const fixture = await createBackupFixture(root);
  const { database } = fixture;
  const objectKey = "../../../../must-not-escape/fake-oss-object.png";
  database.prepare(`
    UPDATE media_assets
    SET object_key = ?
    WHERE id = 'preserved-oss-image'
  `).run(objectKey);
  const providerAttemptAt = "2026-01-01T00:00:00.000Z";
  const generationFrozenAt = "2026-01-01T00:02:00.000Z";
  const legacyAudioName = "preserved-legacy-audio.bin";
  const legacyAudioBytes = Buffer.from("REM009B exact-v37 local audio duration fixture");
  await writeFile(
    join(fixture.dataDirectory, "media", legacyAudioName),
    legacyAudioBytes,
    { mode: 0o600 },
  );
  database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, object_key, content_type, checksum_sha256,
      storage_status, duration_seconds, duration_source, duration_status,
      media_width, media_height, storage_profile_id
    ) VALUES (
      'audio', 'preserved-legacy-audio', 'backup-user', ?, ?, ?, ?,
      'local', ?, 'audio/mpeg', ?, 'ready', NULL, NULL, 'pending',
      NULL, NULL, NULL
    )
  `).run(
    legacyAudioName,
    legacyAudioBytes.length,
    providerAttemptAt,
    providerAttemptAt,
    legacyAudioName,
    sha256(legacyAudioBytes),
  );
  database.prepare(`
    DELETE FROM provider_profiles WHERE id = 'provider-unconfigured'
  `).run();
  const graph = JSON.stringify({
    edges: [],
    nodes: [{
      data: {
        assetId: "preserved-local-image",
        kind: "image",
      },
      id: "backup-node",
      position: { x: 10, y: 20 },
      type: "image",
    }],
  });
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_session_id, save_sequence
    ) VALUES (?, ?, 7, 3, ?, '[]', ?, ?, ?, 11)
  `).run(
    "backup-user",
    "backup-project",
    JSON.stringify(JSON.parse(graph).nodes),
    JSON.stringify({ x: 1, y: 2, zoom: 0.8 }),
    providerAttemptAt,
    "backup-save-session",
  );
  database.prepare(`
    INSERT INTO asset_history (
      account_id, id, kind, label, preview, created_at, owner_id
    ) VALUES (?, ?, 'image', ?, ?, ?, ?)
  `).run(
    "backup-user",
    "preserved-local-image",
    "Preserved local image",
    "/api/assets/preserved-local-image",
    providerAttemptAt,
    "backup-user",
  );
  database.prepare(`
    INSERT INTO user_templates (
      id, owner_id, title, category, graph, cover_asset_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "backup-user-template",
    "backup-user",
    "Backup user template",
    "images",
    graph,
    "preserved-local-image",
    providerAttemptAt,
    providerAttemptAt,
  );
  database.prepare(`
    INSERT INTO public_templates (
      id, title, graph, cover_asset_id, status,
      created_by, created_at, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?)
  `).run(
    "backup-public-template",
    "Backup public template",
    graph,
    "preserved-local-image",
    "backup-user",
    providerAttemptAt,
    "backup-user",
    providerAttemptAt,
  );
  database.prepare(`
    INSERT INTO model_profiles (
      id, display_name, provider_profile_id, provider_model_id,
      capability, status, default_parameters, created_at, updated_at,
      max_cost_microunits, cost_currency
    ) VALUES (?, ?, ?, ?, 'image', 'published', '{}', ?, ?, 1000000, 'USD')
  `).run(
    "backup-model",
    "Backup model",
    "provider-one",
    "synthetic/backup-model",
    providerAttemptAt,
    providerAttemptAt,
  );
  database.prepare(`
    INSERT INTO node_model_bindings (
      node_type, model_id, enabled, is_default, sort_order,
      created_at, updated_at
    ) VALUES ('image', ?, 1, 1, 1, ?, ?)
  `).run("backup-model", providerAttemptAt, providerAttemptAt);
  database.prepare(`
    UPDATE generation_tasks
    SET state = 'failed', attempt = 1, error_code = 'AUTH',
      error_message = 'synthetic terminal attempt', model = 'backup-model',
      provider_profile_id = 'provider-one',
      provider_model_id = 'synthetic/backup-model',
      model_configuration = ?, credential_revision = 1, updated_at = ?
    WHERE id = 'backup-task'
  `).run(
    JSON.stringify({ credentialVersion: 1, displayName: "Backup model" }),
    providerAttemptAt,
  );
  database.prepare(`
    INSERT INTO generation_task_events (
      task_id, state, error_code, error_message, created_at
    ) VALUES (?, 'failed', 'AUTH', 'synthetic terminal attempt', ?)
  `).run("backup-task", providerAttemptAt);
  database.prepare(`
    INSERT INTO generation_provider_attempts (
      task_id, execution_attempt, provider_profile_id, provider_model_id,
      kind, evidence, created_at, owner_id, credential_revision, outcome,
      failure_code, finished_at
    ) VALUES (
      ?, 1, ?, ?, 'image', 'provider-boundary', ?, ?, 1,
      'definitive-rejected', 'AUTH', ?
    )
  `).run(
    "backup-task",
    "provider-one",
    "synthetic/backup-model",
    providerAttemptAt,
    "backup-user",
    providerAttemptAt,
  );
  database.prepare(`
    UPDATE generation_safety_settings
    SET global_enabled = 0, emergency_stop = 1, updated_at = ?
    WHERE id = 1
  `).run(generationFrozenAt);
  database.prepare(`
    INSERT INTO admin_audit_events (
      actor_user_id, action, details, created_at
    ) VALUES (?, 'generation_safety.update', ?, ?)
  `).run(
    "backup-user",
    JSON.stringify({
      after: {
        emergencyStop: true,
        globalEnabled: false,
        updatedAt: generationFrozenAt,
      },
    }),
    generationFrozenAt,
  );

  rollbackMigration39To38(database);
  rollbackMigration38To37(database);
  database.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  await chmod(fixture.dataDirectory, 0o700);
  const inspection = inspectBackupDatabase(
    join(fixture.dataDirectory, "unboundry.sqlite"),
    fixture.dataDirectory,
  );
  return Object.freeze({
    ...fixture,
    expectedDatabaseLogicalSha256: inspection.logicalSha256,
    generationFrozenAt,
    legacyAudioName,
    objectKey,
    providerAttemptAt,
  });
}

async function readReservationFixture(
  targetDirectory: string,
  markerName: string,
) {
  const parsed = JSON.parse(await readFile(
    join(targetDirectory, markerName),
    "utf8",
  )) as ReservationMarkerFixture;
  return Object.freeze({
    backupId: parsed.backupId,
    databaseLogicalSha256: parsed.databaseLogicalSha256,
  });
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

async function productionBuildArtifactSummary(root: string) {
  const records: Array<
    | { kind: "directory"; mode: number; path: string }
    | {
      kind: "file";
      mode: number;
      path: string;
      sha256: string;
      size: number;
    }
  > = [];
  let buildBytes = 0;
  let buildFiles = 0;
  let indexSha256: string | undefined;
  async function visit(directory: string, prefix = "") {
    const directoryDetails = await lstat(directory);
    if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) {
      throw new Error("production build artifact contains a non-directory root");
    }
    records.push({
      kind: "directory",
      path: prefix,
      mode: directoryDetails.mode & 0o777,
    });
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      const path = join(directory, child.name);
      const logicalPath = prefix ? `${prefix}/${child.name}` : child.name;
      const details = await lstat(path);
      if (details.isDirectory()) {
        await visit(path, logicalPath);
        continue;
      }
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new Error("production build artifact contains a non-file entry");
      }
      const value = await readFile(path);
      const record = {
        kind: "file" as const,
        path: logicalPath,
        mode: details.mode & 0o777,
        size: value.length,
        sha256: sha256(value),
      };
      records.push(record);
      buildBytes += record.size;
      buildFiles += 1;
      if (logicalPath === "index.html") indexSha256 = record.sha256;
    }
  }
  await visit(root);
  records.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const index = records.find((record) =>
    record.kind === "file" && record.path === "index.html");
  if (!index || index.kind !== "file" || index.size === 0 || !indexSha256) {
    throw new Error("production build artifact has no nonempty index.html");
  }
  return Object.freeze({
    buildArtifactSha256: sha256(JSON.stringify(records)),
    buildBytes,
    buildFiles,
    indexSha256,
  });
}

async function restoredStateSummary(root: string) {
  const maximumEntries = 100_000;
  const maximumBytes = 1024 * 1024 * 1024 * 1024;
  const maximumDepth = 64;
  const maximumNameBytes = 255;
  const maximumPathBytes = 16 * 1024;
  const maximumInventoryPathBytes = 16 * 1024 * 1024;
  const canonicalRoot = await realpath(root);
  const records: Array<Record<string, unknown>> = [];
  const databaseLogicalSha256 = inspectBackupDatabase(
    join(canonicalRoot, "unboundry.sqlite"),
    canonicalRoot,
  ).logicalSha256;
  let encounteredEntries = 1;
  let encounteredPathBytes = 0;
  let restoredStateBytes = 0;
  const stable = (left: Awaited<ReturnType<typeof lstat>>, right: typeof left) =>
    left.dev === right.dev && left.ino === right.ino &&
    left.uid === right.uid && left.mode === right.mode &&
    left.nlink === right.nlink && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
  const assertSafe = (
    details: Awaited<ReturnType<typeof lstat>>,
    kind: "directory" | "file",
  ) => {
    const correctKind = kind === "directory"
      ? details.isDirectory()
      : details.isFile();
    if (
      !correctKind || details.isSymbolicLink() ||
      typeof process.getuid !== "function" || details.uid !== process.getuid() ||
      (Number(details.mode) & 0o022) !== 0 ||
      (kind === "file" && details.nlink !== 1)
    ) throw new Error("restored state contains an unsafe entry");
  };
  async function inspectFile(path: string, logicalPath: string) {
    const handle = await open(
      path,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
        fileConstants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat();
      assertSafe(before, "file");
      let fileSha256: string | undefined;
      if (logicalPath !== "unboundry.sqlite") {
        restoredStateBytes += before.size;
        if (restoredStateBytes > maximumBytes) {
          throw new Error("restored state exceeds its byte limit");
        }
        const hash = createHash("sha256");
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        for (;;) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            position,
          );
          if (bytesRead === 0) break;
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
        if (position !== before.size) throw new Error("restored file changed");
        fileSha256 = hash.digest("hex");
      }
      const after = await handle.stat();
      const pathIdentity = await lstat(path);
      if (!stable(before, after) || !stable(before, pathIdentity)) {
        throw new Error("restored file identity changed");
      }
      records.push(logicalPath === "unboundry.sqlite"
        ? {
          kind: "database",
          path: logicalPath,
          mode: before.mode & 0o777,
          logicalSha256: databaseLogicalSha256,
        }
        : {
          kind: "file",
          path: logicalPath,
          mode: before.mode & 0o777,
          size: before.size,
          sha256: fileSha256,
        });
    } finally {
      await handle.close();
    }
  }
  async function visit(directory: string, prefix = "", depth = 0) {
    let pin = await open(
      directory,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
        fileConstants.O_NONBLOCK,
    );
    const before = await pin.stat();
    assertSafe(before, "directory");
    await pin.close();
    const children: Array<{ logicalPath: string; name: string }> = [];
    const directoryHandle = await opendir(directory);
    try {
      for (;;) {
        const child = await directoryHandle.read();
        if (child === null) break;
        encounteredEntries += 1;
        const logicalPath = prefix ? `${prefix}/${child.name}` : child.name;
        const logicalPathBytes = Buffer.byteLength(logicalPath, "utf8");
        encounteredPathBytes += logicalPathBytes;
        if (
          encounteredEntries > maximumEntries ||
          Buffer.byteLength(child.name, "utf8") === 0 ||
          Buffer.byteLength(child.name, "utf8") > maximumNameBytes ||
          logicalPathBytes > maximumPathBytes ||
          encounteredPathBytes > maximumInventoryPathBytes ||
          depth + 1 > maximumDepth
        ) throw new Error("restored state exceeds its inventory limits");
        children.push({ logicalPath, name: child.name });
      }
    } finally {
      try {
        await directoryHandle.close();
      } catch {
        // Completed iteration may already close the directory handle.
      }
    }
    children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      const path = join(directory, child.name);
      const details = await lstat(path);
      if (details.isDirectory() && !details.isSymbolicLink()) {
        await visit(path, child.logicalPath, depth + 1);
      } else if (details.isFile() && !details.isSymbolicLink()) {
        if (new Set([
          "unboundry.sqlite-journal",
          "unboundry.sqlite-shm",
          "unboundry.sqlite-wal",
        ]).has(child.logicalPath)) {
          assertSafe(details, "file");
        } else {
          await inspectFile(path, child.logicalPath);
        }
      } else {
        throw new Error("restored state contains a link or special entry");
      }
    }
    pin = await open(
      directory,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
        fileConstants.O_NONBLOCK,
    );
    try {
      const after = await pin.stat();
      const pathIdentity = await lstat(directory);
      if (!stable(before, after) || !stable(before, pathIdentity)) {
        throw new Error("restored directory changed");
      }
    } finally {
      await pin.close();
    }
    records.push({
      kind: "directory",
      path: prefix,
      mode: before.mode & 0o777,
    });
  }
  await visit(canonicalRoot);
  records.sort((left, right) => {
    const leftPath = String(left.path);
    const rightPath = String(right.path);
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
  return Object.freeze({
    restoredStateBytes,
    restoredStateEntries: records.length,
    restoredStateSha256: sha256(JSON.stringify(records)),
  });
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

function finalFrozenContract(
  fixture: Awaited<ReturnType<typeof createFinalSchema37Fixture>>,
) {
  return {
    expectedDatabaseLogicalSha256: fixture.expectedDatabaseLogicalSha256,
    expectedSchemaVersion: 37 as const,
    freezeEvidence: {
      generationFrozenAt: fixture.generationFrozenAt,
      lastProviderAdmissionAt: fixture.providerAttemptAt,
      sourceDatabaseLogicalSha256: fixture.expectedDatabaseLogicalSha256,
    },
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

test("legacy data is preserved while explicit schema migrations remain repeatable", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-migration-"));
  try {
    const legacy = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    legacy.exec(
      "CREATE TABLE schema_migrations (\n" +
        "      version INTEGER PRIMARY KEY,\n" +
        "      name TEXT NOT NULL,\n" +
        "      applied_at TEXT NOT NULL\n" +
        "    )",
    );
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
    legacy.exec("BEGIN IMMEDIATE");
    applyPendingSchemaMigrationsInTransaction(legacy, { sourceVersion: 0 });
    legacy.exec("COMMIT");
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

test("explicit trusted-duration migration preserves historical media and marks it unverified", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-duration-migration-"));
  try {
    const legacy = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    legacy.exec(
      "CREATE TABLE schema_migrations (\n" +
        "      version INTEGER PRIMARY KEY,\n" +
        "      name TEXT NOT NULL,\n" +
        "      applied_at TEXT NOT NULL\n" +
        "    )",
    );
    legacy.exec(`
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
    legacy.exec("PRAGMA user_version = 12");
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
    legacy.exec("BEGIN IMMEDIATE");
    applyPendingSchemaMigrationsInTransaction(legacy, { sourceVersion: 12 });
    legacy.exec("COMMIT");

    const migrated = legacy;
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

    const reopened = new DatabaseSync(
      join(dataDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
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
        "--external-freeze-non-final",
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
      captureMode: string;
      databaseLogicalSha256: string;
      finalCandidate: boolean;
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
      captureMode: "external-unverified",
      finalCandidate: false,
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
      captureMode: "external-unverified",
      databaseLogicalSha256: backup.databaseLogicalSha256,
      finalCandidate: false,
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
      captureMode: "external-unverified",
      databaseLogicalSha256: backup.databaseLogicalSha256,
      finalCandidate: false,
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
    let ambiguousFreeze: (Error & { stderr?: string }) | undefined;
    try {
      await execute(
        process.execPath,
        [...baseArguments, "--source-frozen"],
        { cwd: process.cwd() },
      );
    } catch (error) {
      ambiguousFreeze = error as Error & { stderr?: string };
    }
    expect(JSON.parse(ambiguousFreeze?.stderr ?? "{}")).toMatchObject({
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
          "--external-freeze-non-final",
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
      await execute(process.execPath, [
        ...baseArguments,
        "--source-frozen",
        "--external-freeze-non-final",
      ], {
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
      await execute(process.execPath, [
        ...baseArguments,
        "--source-frozen",
        "--external-freeze-non-final",
      ], {
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
          "--external-freeze-non-final",
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
          "--external-freeze-non-final",
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
        const packageDirectory = join(fixture.backupRoot, packages[0]);
        const marker = await readReservationFixture(
          packageDirectory,
          ".unboundry-backup-incomplete",
        );
        const quarantined = await quarantineIncompleteReservation({
          expectedBackupId: marker.backupId,
          expectedDatabaseLogicalSha256: marker.databaseLogicalSha256,
          kind: "backup",
          targetDirectory: packageDirectory,
        });
        await expect(lstat(packageDirectory)).rejects.toMatchObject({ code: "ENOENT" });
        expect((await lstat(join(
          quarantined.quarantineDirectory,
          ".unboundry-backup-incomplete",
        ))).isFile()).toBe(true);
        const retry = await createEncryptedBackup({
          ...backupOptions(fixture),
          retryBackupId: marker.backupId,
        });
        expect(retry).toMatchObject({
          backupId: marker.backupId,
          databaseLogicalSha256: marker.databaseLogicalSha256,
          packageDirectory,
        });
        await rm(retry.packageDirectory, { force: true, recursive: true });
        await rm(quarantined.quarantineDirectory, {
          force: true,
          recursive: true,
        });
      } else {
        expect(await emptyOrMissing(fixture.backupRoot)).toBe(true);
      }
      expect(await emptyOrMissing(fixture.scratchRoot)).toBe(true);
      expect(await treeFingerprint(fixture.dataDirectory)).toBe(before);
    }

    const backupCrashScript = `
      import "./scripts/node-typescript-runtime.mjs";
      const { createEncryptedBackup } = await import("./server/backupPackage.ts");
      const options = JSON.parse(process.env.UNBOUNDRY_BACKUP_CRASH_OPTIONS);
      await createEncryptedBackup({
        ...options,
        onCheckpoint(checkpoint) {
          if (checkpoint === "after-backup-reservation") process.exit(74);
        },
      });
    `;
    await expect(execute(process.execPath, [
      "--input-type=module",
      "--eval",
      backupCrashScript,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UNBOUNDRY_BACKUP_CRASH_OPTIONS: JSON.stringify(backupOptions(fixture)),
      },
    })).rejects.toMatchObject({ code: 74 });
    const crashPackage = (await readdir(fixture.backupRoot)).find((name) =>
      name.endsWith(".ubbackup"));
    expect(crashPackage).toBeTruthy();
    const crashPackageDirectory = join(fixture.backupRoot, crashPackage!);
    const crashMarker = await readReservationFixture(
      crashPackageDirectory,
      ".unboundry-backup-incomplete",
    );
    const quarantinedCrash = await quarantineIncompleteReservation({
      expectedBackupId: crashMarker.backupId,
      expectedDatabaseLogicalSha256: crashMarker.databaseLogicalSha256,
      kind: "backup",
      targetDirectory: crashPackageDirectory,
    });
    await expect(lstat(crashPackageDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(quarantinedCrash.quarantineDirectory, {
      force: true,
      recursive: true,
    });

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

    const foreignTarget = join(fixture.backupRoot, "foreign.ubbackup");
    await mkdir(foreignTarget, { mode: 0o700 });
    await writeFile(
      join(foreignTarget, ".unboundry-backup-incomplete"),
      "foreign marker",
      { mode: 0o600 },
    );
    await expectPackageError(
      quarantineIncompleteReservation({
        expectedBackupId: "00000000-0000-4000-8000-000000000000",
        expectedDatabaseLogicalSha256: "0".repeat(64),
        kind: "backup",
        targetDirectory: foreignTarget,
      }),
      "BACKUP_RESERVATION_MARKER_INVALID",
    );
    expect(await readFile(
      join(foreignTarget, ".unboundry-backup-incomplete"),
      "utf8",
    )).toBe("foreign marker");
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
        const marker = await readReservationFixture(
          targetDirectory,
          ".unboundry-restore-incomplete",
        );
        const quarantined = await quarantineIncompleteReservation({
          expectedBackupId: marker.backupId,
          expectedDatabaseLogicalSha256: marker.databaseLogicalSha256,
          kind: "restore",
          targetDirectory,
        });
        await expect(lstat(targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(restoreEncryptedBackup({
          ...verifyOptions(fixture, backup.packageDirectory),
          targetDirectory,
        })).resolves.toMatchObject({ backupId: marker.backupId });
        await rm(targetDirectory, { force: true, recursive: true });
        await rm(quarantined.quarantineDirectory, { force: true, recursive: true });
      } else {
        await expect(lstat(targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      }
      expect(
        (await readdir(root)).some((name) =>
          name.startsWith(`.${expected}.restore-`) ||
          name.startsWith(`.restore-${expected}.restore-`)),
      ).toBe(false);
    }

    const processExitTarget = join(root, "restore-process-exit");
    const restoreCrashScript = `
      import "./scripts/node-typescript-runtime.mjs";
      const { restoreEncryptedBackup } = await import("./server/backupPackage.ts");
      const options = JSON.parse(process.env.UNBOUNDRY_RESTORE_CRASH_OPTIONS);
      await restoreEncryptedBackup({
        ...options,
        onCheckpoint(checkpoint) {
          if (checkpoint === "after-restore-reservation") process.exit(75);
        },
      });
    `;
    await expect(execute(process.execPath, [
      "--input-type=module",
      "--eval",
      restoreCrashScript,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UNBOUNDRY_RESTORE_CRASH_OPTIONS: JSON.stringify({
          ...verifyOptions(fixture, backup.packageDirectory),
          targetDirectory: processExitTarget,
        }),
      },
    })).rejects.toMatchObject({ code: 75 });
    const processExitMarker = await readReservationFixture(
      processExitTarget,
      ".unboundry-restore-incomplete",
    );
    const quarantinedProcessExit = await quarantineIncompleteReservation({
      expectedBackupId: processExitMarker.backupId,
      expectedDatabaseLogicalSha256: processExitMarker.databaseLogicalSha256,
      kind: "restore",
      targetDirectory: processExitTarget,
    });
    await expect(lstat(processExitTarget)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(quarantinedProcessExit.quarantineDirectory, {
      force: true,
      recursive: true,
    });

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
  let database: ReturnType<typeof openAppDatabase> | undefined;
  try {
    database = openAppDatabase(dataDirectory);
    await Promise.all([
      mkdir(join(dataDirectory, "media"), { mode: 0o700, recursive: true }),
      mkdir(join(dataDirectory, "secrets"), { mode: 0o700, recursive: true }),
      mkdir(backupRoot, { mode: 0o700 }),
      mkdir(scratchRoot, { mode: 0o700 }),
    ]);
    await chmod(dataDirectory, 0o700);
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

test("final-candidate exact-v37 chain rehydrates fake OSS offline and validates normal runtime startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-final-v37-"));
  const productionBuildRoot = join(process.cwd(), "dist", "client");
  const finalCandidateSource = await readFile(
    join(process.cwd(), "scripts", "backup-final-candidate.mjs"),
    "utf8",
  );
  expect(finalCandidateSource).not.toContain(
    "UNBOUNDRY_TEST_FINAL_INVENTORY_SWAP_MARKER",
  );
  expect(finalCandidateSource).not.toContain(
    "UNBOUNDRY_TEST_FINAL_INVENTORY_SWAP_RELEASE",
  );
  const buildArtifactBefore = await productionBuildArtifactSummary(
    productionBuildRoot,
  );
  const buildTreeBefore = await treeFingerprint(productionBuildRoot);
  let fixture: Awaited<ReturnType<typeof createFinalSchema37Fixture>> | undefined;
  try {
    fixture = await createFinalSchema37Fixture(root);
    const targetDirectory = join(root, "restored-v37");
    const fakeOssTarget = join(root, "rehydrated-fake-oss");
    const result = await execute(
      process.execPath,
      [
        "scripts/backup-final-candidate.mjs",
        "--data-dir",
        fixture.dataDirectory,
        "--backup-root",
        fixture.backupRoot,
        "--target-data-dir",
        targetDirectory,
        "--fake-oss-target-dir",
        fakeOssTarget,
        "--scratch-root",
        fixture.scratchRoot,
        "--expected-database-logical-sha256",
        fixture.expectedDatabaseLogicalSha256,
        "--generation-frozen-at",
        fixture.generationFrozenAt,
        "--last-provider-admission-at",
        fixture.providerAttemptAt,
        "--allow-media-warning",
        "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
        "--allow-media-warning",
        "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
        "--oss-mirror",
        JSON.stringify({
          filePath: fixture.mirrorPath,
          objectKey: fixture.objectKey,
          versionId: "fake-version-1",
        }),
        "--recovery-private-key",
        fixture.paths.recoveryPrivate,
        "--recovery-public-key",
        fixture.paths.recoveryPublic,
        "--signing-private-key",
        fixture.paths.signingPrivate,
        "--trusted-signing-public-key",
        fixture.paths.signingPublic,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          UNBOUNDRY_SAFE_TEST: "1",
          UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK: "1",
          UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK_MS: "0",
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const summary = JSON.parse(result.stdout) as {
      backup: { backupId: string; ossMirrors: number; schemaVersion: number };
      expectedDatabaseLogicalSha256: string;
      expectedSchemaVersion: number;
      fakeOssRecovery: {
        databaseLogicalSha256: string;
        objects: Array<{
          metadataFile: string;
          objectFile: string;
          objectKey: string;
          versionId: string;
        }>;
      };
      migrationApplied: {
        backfilledDurations: number;
        drainMilliseconds: number;
        nativeDurationProbeAuditSha256: string;
        nativeDurationProbes: number;
        sourceVersion: number;
        targetLogicalSha256: string;
        targetVersion: number;
      };
      migrationNativeAudit: {
        argumentContractSha256: string;
        externalNetworkAttempts: number;
        nativeDurationProbes: number;
        sha256: string;
      };
      migrationInspection: {
        logicalSha256: string;
        userVersion: number;
      };
      restored: { schemaVersion: number };
      startupValidation: {
        activeGenerationTasks: number;
        authStatus: {
          authenticated: boolean;
          bootstrapRequired: boolean;
        };
        canvasDocumentsRead: number;
        buildArtifactSha256: string;
        buildBytes: number;
        buildFiles: number;
        externalNetworkAttempts: number;
        guardLoads: number;
        listenerReleased: boolean;
        localMediaBytesRead: number;
        localMediaRead: number;
        ordinaryDatabaseOpen: boolean;
        ossRequests: number;
        providerRequests: number;
        readyLegacyDurationAssets: number;
        readiness: {
          databaseProbe: string;
          mode: string;
          mutationsAccepted: boolean;
          schemaVersion: number;
          status: string;
        };
        sessionRowsRead: number;
        shutdown: string;
        startupMediaRecoveryCandidates: number;
        targetLogicalSha256: string;
        indexSha256: string;
        restoredStateBytes: number;
        restoredStateEntries: number;
        restoredStateSha256: string;
      };
    };
    const restoredStateAfterPreview = await restoredStateSummary(targetDirectory);
    expect(summary).toMatchObject({
      backup: { ossMirrors: 1, schemaVersion: 37 },
      expectedDatabaseLogicalSha256: fixture.expectedDatabaseLogicalSha256,
      expectedSchemaVersion: 37,
      fakeOssRecovery: {
        databaseLogicalSha256: fixture.expectedDatabaseLogicalSha256,
      },
      migrationApplied: {
        backfilledDurations: 1,
        drainMilliseconds: 0,
        nativeDurationProbes: 2,
        sourceVersion: 37,
        targetVersion: 39,
      },
      migrationNativeAudit: {
        externalNetworkAttempts: 0,
        nativeDurationProbes: 2,
      },
      migrationInspection: { userVersion: currentSchemaVersion },
      restored: { schemaVersion: 37 },
      startupValidation: {
        activeGenerationTasks: 0,
        authStatus: {
          authenticated: false,
          bootstrapRequired: false,
        },
        canvasDocumentsRead: 1,
        ...buildArtifactBefore,
        externalNetworkAttempts: 0,
        listenerReleased: true,
        localMediaRead: 1,
        ordinaryDatabaseOpen: true,
        ossRequests: 0,
        providerRequests: 0,
        readyLegacyDurationAssets: 1,
        ...restoredStateAfterPreview,
        readiness: {
          databaseProbe: "read-only",
          mode: "active",
          mutationsAccepted: true,
          schemaVersion: currentSchemaVersion,
          status: "ready",
        },
        sessionRowsRead: 1,
        shutdown: "graceful",
        startupMediaRecoveryCandidates: 0,
      },
    });
    expect({
      buildArtifactSha256: summary.startupValidation.buildArtifactSha256,
      buildBytes: summary.startupValidation.buildBytes,
      buildFiles: summary.startupValidation.buildFiles,
      indexSha256: summary.startupValidation.indexSha256,
    }).toEqual(buildArtifactBefore);
    expect(await productionBuildArtifactSummary(productionBuildRoot))
      .toEqual(buildArtifactBefore);
    expect(await treeFingerprint(productionBuildRoot)).toBe(buildTreeBefore);
    expect({
      restoredStateBytes: summary.startupValidation.restoredStateBytes,
      restoredStateEntries: summary.startupValidation.restoredStateEntries,
      restoredStateSha256: summary.startupValidation.restoredStateSha256,
    }).toEqual(restoredStateAfterPreview);
    expect(summary.startupValidation.guardLoads).toBeGreaterThanOrEqual(1);
    expect(summary.startupValidation.localMediaBytesRead).toBeGreaterThan(0);
    expect(summary.migrationInspection.logicalSha256)
      .toBe(summary.migrationApplied.targetLogicalSha256);
    expect(summary.migrationApplied.nativeDurationProbeAuditSha256)
      .toBe(summary.migrationNativeAudit.sha256);
    expect(summary.migrationNativeAudit.argumentContractSha256)
      .toMatch(/^[a-f0-9]{64}$/);
    expect(summary.startupValidation.targetLogicalSha256)
      .toBe(summary.migrationApplied.targetLogicalSha256);
    expect(summary.fakeOssRecovery.objects).toHaveLength(1);
    expect(summary.fakeOssRecovery.objects[0]).toMatchObject({
      objectKey: fixture.objectKey,
      versionId: "fake-version-1",
    });
    expect(dirname(summary.fakeOssRecovery.objects[0]!.objectFile))
      .toBe(join(fakeOssTarget, "objects"));
    expect(dirname(summary.fakeOssRecovery.objects[0]!.metadataFile))
      .toBe(join(fakeOssTarget, "objects"));
    expect(basename(summary.fakeOssRecovery.objects[0]!.objectFile))
      .toMatch(/^[a-f0-9]{64}\.bin$/);
    expect(basename(summary.fakeOssRecovery.objects[0]!.metadataFile))
      .toMatch(/^[a-f0-9]{64}\.json$/);
    expect(await readFile(summary.fakeOssRecovery.objects[0]!.objectFile))
      .toEqual(await readFile(fixture.mirrorPath));

    const indexPath = join(targetDirectory, ossRecoveryIndexFileName);
    expect((await lstat(indexPath)).mode & 0o777).toBe(0o600);
    const recoveryIndex = await readOssRecoveryIndex(indexPath);
    expect(recoveryIndex).toMatchObject({
      backupId: summary.backup.backupId,
      databaseLogicalSha256: fixture.expectedDatabaseLogicalSha256,
    });
    expect(recoveryIndex.entries).toHaveLength(1);
    expect(recoveryIndex.entries[0]).toMatchObject({
      objectKey: fixture.objectKey,
      storageProfileId: "storage-one",
      versionId: "fake-version-1",
    });

    const restoredInspection = inspectBackupDatabase(
      join(targetDirectory, "unboundry.sqlite"),
      targetDirectory,
    );
    expect(restoredInspection).toMatchObject({
      userVersion: currentSchemaVersion,
    });
    const restored = new DatabaseSync(
      join(targetDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
    try {
      for (const [table, expected] of [
        ["canvas_documents", 1],
        ["project_metadata", 1],
        ["user_templates", 1],
        ["public_templates", 3],
        ["asset_history", 1],
        ["generation_tasks", 1],
        ["generation_provider_attempts", 1],
        ["account_provider_credentials", 1],
        ["media_assets", 3],
      ] as const) {
        expect(restored.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get())
          .toEqual({ count: expected });
      }
      expect(restored.prepare(`
        SELECT state FROM generation_tasks WHERE id = 'backup-task'
      `).get()).toEqual({ state: "failed" });
      expect(restored.prepare(`
        SELECT global_enabled, emergency_stop, updated_at
        FROM generation_safety_settings WHERE id = 1
      `).get()).toEqual({
        emergency_stop: 1,
        global_enabled: 0,
        updated_at: fixture.generationFrozenAt,
      });
      expect(restored.prepare(`
        SELECT duration_seconds, duration_source, duration_status
        FROM media_assets
        WHERE kind = 'audio' AND id = 'preserved-legacy-audio'
      `).get()).toEqual({
        duration_seconds: 7.125,
        duration_source: "server-probe",
        duration_status: "ready",
      });
    } finally {
      restored.close();
    }
    await expect(validateBackupSecrets(
      join(targetDirectory, "unboundry.sqlite"),
      join(targetDirectory, "secrets"),
      targetDirectory,
    )).resolves.toEqual({
      accountCredentials: 1,
      masterKeyPresent: true,
      providerDocumentProfiles: 1,
      storageDocumentProfiles: 1,
    });
    expect(await restoredStateSummary(targetDirectory))
      .toEqual(restoredStateAfterPreview);
    expect(await readdir(fixture.scratchRoot)).toEqual([]);
  } finally {
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("final-candidate preflight rejects physical path aliases and keys under work roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-final-path-isolation-"));
  let fixture: Awaited<ReturnType<typeof createFinalSchema37Fixture>> | undefined;
  try {
    fixture = await createFinalSchema37Fixture(root);
    const sourceBefore = await treeFingerprint(fixture.dataDirectory);
    const targetDirectory = join(root, "restored-v37");
    const fakeOssTarget = join(root, "rehydrated-fake-oss");
    const finalArguments = (overrides: {
      fakeOssTarget?: string;
      includeOssMirror?: boolean;
      mirrorPath?: string;
      recoveryPrivateKey?: string;
      recoveryPublicKey?: string;
      signingPrivateKey?: string;
      targetDirectory?: string;
      trustedSigningPublicKey?: string;
    } = {}) => {
      const arguments_ = [
        "scripts/backup-final-candidate.mjs",
        "--data-dir",
        fixture!.dataDirectory,
        "--backup-root",
        fixture!.backupRoot,
        "--target-data-dir",
        overrides.targetDirectory ?? targetDirectory,
        "--fake-oss-target-dir",
        overrides.fakeOssTarget ?? fakeOssTarget,
        "--scratch-root",
        fixture!.scratchRoot,
        "--expected-database-logical-sha256",
        fixture!.expectedDatabaseLogicalSha256,
        "--generation-frozen-at",
        fixture!.generationFrozenAt,
        "--last-provider-admission-at",
        fixture!.providerAttemptAt,
        "--allow-media-warning",
        "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
        "--allow-media-warning",
        "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
        "--recovery-private-key",
        overrides.recoveryPrivateKey ?? fixture!.paths.recoveryPrivate,
        "--recovery-public-key",
        overrides.recoveryPublicKey ?? fixture!.paths.recoveryPublic,
        "--signing-private-key",
        overrides.signingPrivateKey ?? fixture!.paths.signingPrivate,
        "--trusted-signing-public-key",
        overrides.trustedSigningPublicKey ?? fixture!.paths.signingPublic,
      ];
      if (overrides.includeOssMirror !== false) {
        arguments_.push(
          "--oss-mirror",
          JSON.stringify({
            filePath: overrides.mirrorPath ?? fixture!.mirrorPath,
            objectKey: fixture!.objectKey,
            versionId: "fake-version-1",
          }),
        );
      }
      return arguments_;
    };
    const expectPreflightFailure = async (arguments_: string[]) => {
      let failure: (Error & { stderr?: string }) | undefined;
      try {
        await execute(process.execPath, arguments_, { cwd: process.cwd() });
      } catch (error) {
        failure = error as Error & { stderr?: string };
      }
      expect(failure).toBeDefined();
      expect(JSON.parse(failure?.stderr ?? "{}")).toMatchObject({
        code: "FINAL_BACKUP_ARGUMENT_INVALID",
      });
    };
    const expectInventoryRootSwapFailure = async (
      kind: "build" | "restored",
    ) => {
      const caseRoot = join(root, `inventory-root-swap-${kind}`);
      await mkdir(caseRoot, { mode: 0o700 });
      const swapFixture = await createFinalSchema37Fixture(caseRoot);
      swapFixture.database.close();
      const swapTarget = join(caseRoot, "restored-v37");
      const swapFakeOss = join(caseRoot, "rehydrated-fake-oss");
      const arguments_ = [
        "scripts/backup-final-candidate.mjs",
        "--data-dir",
        swapFixture.dataDirectory,
        "--backup-root",
        swapFixture.backupRoot,
        "--target-data-dir",
        swapTarget,
        "--fake-oss-target-dir",
        swapFakeOss,
        "--scratch-root",
        swapFixture.scratchRoot,
        "--expected-database-logical-sha256",
        swapFixture.expectedDatabaseLogicalSha256,
        "--generation-frozen-at",
        swapFixture.generationFrozenAt,
        "--last-provider-admission-at",
        swapFixture.providerAttemptAt,
        "--allow-media-warning",
        "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
        "--allow-media-warning",
        "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
        "--oss-mirror",
        JSON.stringify({
          filePath: swapFixture.mirrorPath,
          objectKey: swapFixture.objectKey,
          versionId: "fake-version-1",
        }),
        "--recovery-private-key",
        swapFixture.paths.recoveryPrivate,
        "--recovery-public-key",
        swapFixture.paths.recoveryPublic,
        "--signing-private-key",
        swapFixture.paths.signingPrivate,
        "--trusted-signing-public-key",
        swapFixture.paths.signingPublic,
      ];
      const child = spawn(process.execPath, arguments_, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK: "1",
          UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK_MS: "0",
          UNBOUNDRY_TEST_FINAL_INVENTORY_SWAP_KIND: kind,
        },
        stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
      });
      const stderr: Buffer[] = [];
      child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
      const notificationPipe = child.stdio[3] as Readable;
      const releasePipe = child.stdio[4] as Writable;
      const exit = new Promise<{ code: number | null; signal: string | null }>(
        (resolveExit, rejectExit) => {
          child.once("error", rejectExit);
          child.once("exit", (code, signal) => resolveExit({ code, signal }));
        },
      );
      const rootToSwap = kind === "build"
        ? join(process.cwd(), "dist", "client")
        : swapTarget;
      const displacedRoot = `${rootToSwap}.m10-root-swap`;
      let swapped = false;
      try {
        const notification = await new Promise<string>((resolveNotification, reject) => {
          const chunks: Buffer[] = [];
          const timer = setTimeout(() => {
            reject(new Error(`inventory ${kind} checkpoint notification timed out`));
          }, 10_000);
          notificationPipe.on("data", (chunk) => {
            chunks.push(Buffer.from(chunk));
            const value = Buffer.concat(chunks);
            if (value.length > 64) {
              clearTimeout(timer);
              reject(new Error(`inventory ${kind} checkpoint notification was oversized`));
              return;
            }
            if (!value.includes(0x0a)) return;
            clearTimeout(timer);
            resolveNotification(value.toString("utf8").trim());
          });
          notificationPipe.once("error", reject);
          notificationPipe.once("end", () => {
            clearTimeout(timer);
            reject(new Error(`inventory ${kind} checkpoint pipe ended early`));
          });
        });
        expect(notification).toBe(`inventory:${kind}`);
        await rename(rootToSwap, displacedRoot);
        swapped = true;
        await mkdir(rootToSwap, { mode: 0o700 });
        releasePipe.end(Buffer.from([1]));
        const result = await new Promise<{
          code: number | null;
          signal: string | null;
        }>((resolveExit, rejectExit) => {
          const timer = setTimeout(
            () => rejectExit(new Error(`inventory ${kind} child did not exit`)),
            10_000,
          );
          exit.then(
            (value) => {
              clearTimeout(timer);
              resolveExit(value);
            },
            (error) => {
              clearTimeout(timer);
              rejectExit(error);
            },
          );
        });
        expect(result.signal).toBeNull();
        expect(result.code).not.toBe(0);
        expect(JSON.parse(Buffer.concat(stderr).toString("utf8").trim()))
          .toMatchObject({
            code: kind === "build"
              ? "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED"
              : "FINAL_BACKUP_RESTORED_STATE_CHANGED",
          });
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exit;
        }
        notificationPipe.destroy();
        releasePipe.destroy();
        if (swapped) {
          await rm(rootToSwap, { force: true, recursive: true });
          await rename(displacedRoot, rootToSwap);
        }
      }
    };

    const sourceAlias = join(root, "data-alias");
    await symlink(fixture.dataDirectory, sourceAlias);
    const aliasedRestoreTarget = join(sourceAlias, "aliased-restore");
    await expectPreflightFailure(finalArguments({
      targetDirectory: aliasedRestoreTarget,
    }));
    const aliasedFakeOssTarget = join(sourceAlias, "aliased-fake-oss");
    await expectPreflightFailure(finalArguments({
      fakeOssTarget: aliasedFakeOssTarget,
    }));
    await expect(lstat(aliasedRestoreTarget)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(aliasedFakeOssTarget)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(fixture.backupRoot)).toEqual([]);

    await expectPreflightFailure(finalArguments({ includeOssMirror: false }));
    expect(await readdir(fixture.backupRoot)).toEqual([]);
    await expect(lstat(targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(fakeOssTarget)).rejects.toMatchObject({ code: "ENOENT" });

    const nestedKeyCases = [
      {
        argumentsFor: (path: string) => finalArguments({ recoveryPrivateKey: path }),
        material: fixture.keys.recovery.privateKey,
        name: "recovery-private.pem",
      },
      {
        argumentsFor: (path: string) => finalArguments({ recoveryPublicKey: path }),
        material: fixture.keys.recovery.publicKey,
        name: "recovery-public.pem",
      },
      {
        argumentsFor: (path: string) => finalArguments({ signingPrivateKey: path }),
        material: fixture.keys.signing.privateKey,
        name: "signing-private.pem",
      },
      {
        argumentsFor: (path: string) => finalArguments({
          trustedSigningPublicKey: path,
        }),
        material: fixture.keys.signing.publicKey,
        name: "trusted-signing-public.pem",
      },
    ];
    for (const keyCase of nestedKeyCases) {
      const nestedKey = join(fixture.backupRoot, keyCase.name);
      await writeFile(nestedKey, keyCase.material, { mode: 0o600 });
      await expectPreflightFailure(keyCase.argumentsFor(nestedKey));
      expect(await readdir(fixture.backupRoot)).toEqual([keyCase.name]);
      await rm(nestedKey);
    }

    const duplicateKeyAlias = join(root, "duplicate-key-alias.pem");
    await symlink(fixture.paths.recoveryPrivate, duplicateKeyAlias);
    await expectPreflightFailure(finalArguments({
      signingPrivateKey: duplicateKeyAlias,
    }));
    await rm(duplicateKeyAlias);

    for (const keyPath of [
      fixture.paths.recoveryPrivate,
      fixture.paths.signingPublic,
    ]) {
      await expectPreflightFailure(finalArguments({ mirrorPath: keyPath }));
      expect(await treeFingerprint(fixture.dataDirectory)).toBe(sourceBefore);
      expect(await readdir(fixture.backupRoot)).toEqual([]);
      expect(await emptyOrMissing(fixture.scratchRoot)).toBe(true);
      await expect(lstat(targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(fakeOssTarget)).rejects.toMatchObject({ code: "ENOENT" });
    }

    const nestedMirrorCases = [
      {
        argumentsFor: (directory: string, mirrorPath: string) => finalArguments({
          mirrorPath,
          targetDirectory: directory,
        }),
        directory: join(root, "restore-target-with-mirror"),
      },
      {
        argumentsFor: (directory: string, mirrorPath: string) => finalArguments({
          fakeOssTarget: directory,
          mirrorPath,
        }),
        directory: join(root, "fake-oss-target-with-mirror"),
      },
    ];
    for (const mirrorCase of nestedMirrorCases) {
      await mkdir(mirrorCase.directory, { mode: 0o700 });
      const nestedMirror = join(mirrorCase.directory, "object.bin");
      await writeFile(nestedMirror, "preexisting-target-content", { mode: 0o600 });
      const targetBefore = await treeFingerprint(mirrorCase.directory);
      await expectPreflightFailure(
        mirrorCase.argumentsFor(mirrorCase.directory, nestedMirror),
      );
      expect(await treeFingerprint(mirrorCase.directory)).toBe(targetBefore);
      expect(await treeFingerprint(fixture.dataDirectory)).toBe(sourceBefore);
      expect(await readdir(fixture.backupRoot)).toEqual([]);
      expect(await emptyOrMissing(fixture.scratchRoot)).toBe(true);
      await rm(mirrorCase.directory, { force: true, recursive: true });
    }

    await expectInventoryRootSwapFailure("build");
    await expectInventoryRootSwapFailure("restored");

    expect(await treeFingerprint(fixture.dataDirectory)).toBe(sourceBefore);
    expect(await readdir(fixture.backupRoot)).toEqual([]);
    expect(await emptyOrMissing(fixture.scratchRoot)).toBe(true);
    await expect(lstat(targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(fakeOssTarget)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("final source capture acquires the shared secret lease before the app database lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-final-secret-lease-"));
  let fixture: Awaited<ReturnType<typeof createFinalSchema37Fixture>> | undefined;
  let heldLock: DatabaseSync | undefined;
  try {
    fixture = await createFinalSchema37Fixture(root);
    heldLock = new DatabaseSync(join(
      fixture.dataDirectory,
      "secrets",
      "provider-profile-write-lock.sqlite",
    ));
    heldLock.exec("BEGIN IMMEDIATE");
    let reachedSnapshot = false;
    await expectPackageError(
      createEncryptedBackup({
        ...backupOptions(fixture),
        frozenSourceContract: finalFrozenContract(fixture),
        mediaWarningAllowlist: [
          "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
          "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
        ],
        onCheckpoint(checkpoint) {
          if (checkpoint === "after-database-snapshot") reachedSnapshot = true;
        },
      }),
      "BACKUP_SECRET_DOCUMENT_LOCK_UNAVAILABLE",
    );
    expect(reachedSnapshot).toBe(false);
    expect(await emptyOrMissing(fixture.backupRoot)).toBe(true);
    heldLock.exec("ROLLBACK");
    heldLock.close();
    heldLock = undefined;
    const heldAppDatabase = new DatabaseSync(join(
      fixture.dataDirectory,
      "unboundry.sqlite",
    ));
    heldAppDatabase.exec("BEGIN IMMEDIATE");
    try {
      await expectPackageError(
        createEncryptedBackup({
          ...backupOptions(fixture),
          frozenSourceContract: finalFrozenContract(fixture),
          mediaWarningAllowlist: [
            "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
            "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
          ],
        }),
        "BACKUP_SOURCE_WRITE_LOCK_UNAVAILABLE",
      );
    } finally {
      heldAppDatabase.exec("ROLLBACK");
      heldAppDatabase.close();
    }
    await expect(createEncryptedBackup({
      ...backupOptions(fixture),
      frozenSourceContract: finalFrozenContract(fixture),
      mediaWarningAllowlist: [
        "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
        "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
      ],
    })).resolves.toMatchObject({
      databaseLogicalSha256: fixture.expectedDatabaseLogicalSha256,
      schemaVersion: 37,
    });
  } finally {
    if (heldLock?.isTransaction) heldLock.exec("ROLLBACK");
    heldLock?.close();
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("final source capture rejects provider document and SQLite revision split", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-final-provider-split-"));
  let fixture: Awaited<ReturnType<typeof createFinalSchema37Fixture>> | undefined;
  try {
    fixture = await createFinalSchema37Fixture(root);
    const key = await readFile(join(
      fixture.dataDirectory,
      "secrets",
      "config-master.key",
    ));
    try {
      await writeFile(
        join(fixture.dataDirectory, "secrets", "provider-profiles.enc.json"),
        encryptedDocument(key, providerDocumentAad, {
          profiles: [{
            apiKey: `provider-${fixtureSentinel}`,
            baseUrl: "https://provider.invalid/v1",
            configurationVersion: 2,
            createdAt: "2026-08-09T00:00:00.000Z",
            driver: "openrouter",
            id: "provider-one",
            label: "Synthetic Provider split",
            updatedAt: "2026-08-09T00:01:00.000Z",
          }],
          version: 1,
        }),
        { mode: 0o600 },
      );
    } finally {
      key.fill(0);
    }
    await expectPackageError(
      createEncryptedBackup({
        ...backupOptions(fixture),
        frozenSourceContract: finalFrozenContract(fixture),
        mediaWarningAllowlist: [
          "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
          "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
        ],
      }),
      "BACKUP_PROVIDER_DOCUMENT_MISMATCH",
    );
    expect(await emptyOrMissing(fixture.backupRoot)).toBe(true);
    const tooRecentFreeze = new Date(Date.now() - 30_000).toISOString();
    fixture.database.prepare(`
      UPDATE generation_tasks SET error_code = 'AUTH' WHERE id = 'backup-task'
    `).run();
    fixture.database.prepare(`
      UPDATE generation_safety_settings SET updated_at = ? WHERE id = 1
    `).run(tooRecentFreeze);
    fixture.database.prepare(`
      INSERT INTO admin_audit_events (
        actor_user_id, action, details, created_at
      ) VALUES ('backup-user', 'generation_safety.update', ?, ?)
    `).run(JSON.stringify({
      after: {
        emergencyStop: true,
        globalEnabled: false,
        updatedAt: tooRecentFreeze,
      },
    }), tooRecentFreeze);
    fixture.database.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    const quietInspection = inspectBackupDatabase(
      join(fixture.dataDirectory, "unboundry.sqlite"),
      fixture.dataDirectory,
    );
    await expectPackageError(
      createEncryptedBackup({
        ...backupOptions(fixture),
        frozenSourceContract: {
          expectedDatabaseLogicalSha256: quietInspection.logicalSha256,
          expectedSchemaVersion: 37,
          freezeEvidence: {
            generationFrozenAt: tooRecentFreeze,
            lastProviderAdmissionAt: fixture.providerAttemptAt,
            sourceDatabaseLogicalSha256: quietInspection.logicalSha256,
          },
        },
        mediaWarningAllowlist: [
          "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
          "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
        ],
      }),
      "BACKUP_FREEZE_QUIET_PERIOD_INCOMPLETE",
    );
  } finally {
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("final source capture rejects an unsettled schema37 Provider boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-final-provider-boundary-"));
  let fixture: Awaited<ReturnType<typeof createFinalSchema37Fixture>> | undefined;
  let schema38Fixture: Fixture | undefined;
  try {
    fixture = await createFinalSchema37Fixture(root);
    fixture.database.prepare(`
      UPDATE generation_tasks
      SET error_code = 'UNKNOWN_PROVIDER_RESULT'
      WHERE id = 'backup-task'
    `).run();
    fixture.database.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    const changed = inspectBackupDatabase(
      join(fixture.dataDirectory, "unboundry.sqlite"),
      fixture.dataDirectory,
    );
    await expectPackageError(
      createEncryptedBackup({
        ...backupOptions(fixture),
        frozenSourceContract: {
          ...finalFrozenContract(fixture),
          expectedDatabaseLogicalSha256: changed.logicalSha256,
          freezeEvidence: {
            ...finalFrozenContract(fixture).freezeEvidence,
            sourceDatabaseLogicalSha256: changed.logicalSha256,
          },
        },
        mediaWarningAllowlist: [
          "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
          "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
        ],
      }),
      "BACKUP_UNSETTLED_PROVIDER_ATTEMPTS",
    );
    expect(await emptyOrMissing(fixture.backupRoot)).toBe(true);

    schema38Fixture = await createBackupFixture(join(root, "schema38-case"));
    schema38Fixture.database.prepare(`
      UPDATE generation_tasks
      SET state = 'failed', error_code = 'AUTH', error_message = 'settled'
      WHERE id = 'backup-task'
    `).run();
    rollbackMigration39To38(schema38Fixture.database);
    const frozenAt = "2026-01-01T00:02:00.000Z";
    schema38Fixture.database.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 0, emergency_stop = 1, updated_at = ?
      WHERE id = 1
    `).run(frozenAt);
    schema38Fixture.database.prepare(`
      INSERT INTO admin_audit_events (
        actor_user_id, action, details, created_at
      ) VALUES ('backup-user', 'generation_safety.update', ?, ?)
    `).run(JSON.stringify({
      after: {
        emergencyStop: true,
        globalEnabled: false,
        updatedAt: frozenAt,
      },
    }), frozenAt);
    schema38Fixture.database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name, content_type,
        created_at, updated_at
      ) VALUES (
        'active-publication', 'backup-user', 'image', 'active-publication',
        'upload', 'reserved', 'local', 'active-publication.png',
        'active-publication.png', '.active-publication.generating',
        'image/png', ?, ?
      )
    `).run(frozenAt, frozenAt);
    schema38Fixture.database.exec(
      "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE",
    );
    const schema38Inspection = inspectBackupDatabase(
      join(schema38Fixture.dataDirectory, "unboundry.sqlite"),
      schema38Fixture.dataDirectory,
    );
    await expectPackageError(
      createEncryptedBackup({
        ...backupOptions(schema38Fixture),
        frozenSourceContract: {
          expectedDatabaseLogicalSha256: schema38Inspection.logicalSha256,
          expectedSchemaVersion: 38,
          freezeEvidence: {
            generationFrozenAt: frozenAt,
            lastProviderAdmissionAt: null,
            sourceDatabaseLogicalSha256: schema38Inspection.logicalSha256,
          },
        },
        mediaWarningAllowlist: [
          "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
          "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
        ],
      }),
      "BACKUP_ACTIVE_MEDIA_PUBLICATIONS",
    );
  } finally {
    schema38Fixture?.database.close();
    fixture?.database.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("fake OSS rehydrate retries after staging failure and preserves foreign targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-fake-oss-retry-"));
  let fixture: Awaited<ReturnType<typeof createFinalSchema37Fixture>> | undefined;
  try {
    fixture = await createFinalSchema37Fixture(root);
    const targetDirectory = join(root, "fake-oss-target");
    const index = createFakeOssRecoveryIndex({
      backupId: "00000000-0000-4000-8000-000000000001",
      databaseLogicalSha256: fixture.expectedDatabaseLogicalSha256,
      entries: [{
        byteSize: (await lstat(fixture.mirrorPath)).size,
        checksumSha256: sha256(await readFile(fixture.mirrorPath)),
        logicalPath: "oss-mirrors/00000000-0000-4000-8000-000000000002",
        objectKey: fixture.objectKey,
        storageProfileId: "storage-one",
        versionId: "fake-version-1",
      }],
    });
    async function createCrashClaim(directory: string) {
      const stageDirectory = join(
        root,
        `.${basename(directory)}.fake-oss-stage-manual-${randomBytes(4).toString("hex")}`,
      );
      const stageMarkerPath = join(
        stageDirectory,
        ".unboundry-fake-oss-recovery-stage.json",
      );
      const objectId = encodeFakeOssObjectIdentity(
        index.entries[0]!.objectKey,
        index.entries[0]!.versionId,
      );
      const objectMetadata = {
        backupId: index.backupId,
        byteSize: index.entries[0]!.byteSize,
        checksumSha256: index.entries[0]!.checksumSha256,
        databaseLogicalSha256: index.databaseLogicalSha256,
        format: "unboundry-fake-oss-object",
        logicalPath: index.entries[0]!.logicalPath,
        objectId,
        objectKey: index.entries[0]!.objectKey,
        storageProfileId: index.entries[0]!.storageProfileId,
        version: 1,
        versionId: index.entries[0]!.versionId,
      };
      await mkdir(join(stageDirectory, "objects"), {
        mode: 0o700,
        recursive: true,
      });
      await writeFile(stageMarkerPath, JSON.stringify({
        backupId: index.backupId,
        databaseLogicalSha256: index.databaseLogicalSha256,
        entriesSha256: index.entriesSha256,
        format: "unboundry-fake-oss-recovery-stage",
        targetName: basename(directory),
        version: 1,
      }), { mode: 0o600 });
      await copyFile(
        fixture!.mirrorPath,
        join(stageDirectory, "objects", `${objectId}.bin`),
      );
      await writeFile(
        join(stageDirectory, "objects", `${objectId}.json`),
        `${JSON.stringify(objectMetadata)}\n`,
        { mode: 0o600 },
      );
      await writeFile(
        join(stageDirectory, ossRecoveryIndexFileName),
        `${JSON.stringify(index)}\n`,
        { mode: 0o600 },
      );
      await chmod(stageDirectory, 0o700);
      await chmod(join(stageDirectory, "objects"), 0o700);
      await chmod(join(stageDirectory, "objects", `${objectId}.bin`), 0o600);
      const markerPath = fakeOssRecoveryClaimPath(directory);
      const claim = new DatabaseSync(markerPath);
      try {
        claim.exec(`
          PRAGMA journal_mode = DELETE;
          CREATE TABLE fake_oss_recovery_claim (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            backup_id TEXT NOT NULL,
            database_logical_sha256 TEXT NOT NULL,
            entries_sha256 TEXT NOT NULL,
            format TEXT NOT NULL,
            stage_marker_sha256 TEXT NOT NULL,
            stage_name TEXT NOT NULL,
            target_name TEXT NOT NULL,
            version INTEGER NOT NULL CHECK (version = 1)
          );
        `);
        claim.prepare(`
          INSERT INTO fake_oss_recovery_claim (
            id, backup_id, database_logical_sha256, entries_sha256, format,
            stage_marker_sha256, stage_name, target_name, version
          ) VALUES (
            1, ?, ?, ?, 'unboundry-fake-oss-recovery-claim', ?, ?, ?, 1
          )
        `).run(
          index.backupId,
          index.databaseLogicalSha256,
          index.entriesSha256,
          sha256(await readFile(stageMarkerPath)),
          basename(stageDirectory),
          basename(directory),
        );
      } finally {
        claim.close();
      }
      await chmod(markerPath, 0o600);
      await link(
        markerPath,
        join(directory, fakeOssRecoveryOwnershipMarkerName),
      );
      return { markerPath, stageDirectory };
    }
    const restoredSource = join(root, "fake-oss-source");
    await mkdir(join(restoredSource, "oss-mirrors"), {
      mode: 0o700,
      recursive: true,
    });
    await copyFile(
      join(fixture.dataDirectory, "unboundry.sqlite"),
      join(restoredSource, "unboundry.sqlite"),
    );
    await copyFile(
      fixture.mirrorPath,
      join(restoredSource, ...index.entries[0]!.logicalPath.split("/")),
    );
    await chmod(restoredSource, 0o700);
    await chmod(join(restoredSource, "unboundry.sqlite"), 0o600);
    await chmod(join(
      restoredSource,
      ...index.entries[0]!.logicalPath.split("/"),
    ), 0o600);

    await expect(rehydrateFakeOss({
      index,
      onCheckpoint(checkpoint) {
        if (checkpoint === "after-object-copy") throw new Error("fault-after-copy");
      },
      sourceDirectory: restoredSource,
      targetDirectory,
    })).rejects.toThrow("fault-after-copy");
    await expect(lstat(targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(root)).some((name) =>
      name.startsWith(".fake-oss-target.fake-oss-stage-"))).toBe(false);

    const racedEmptyTarget = join(root, "raced-empty-fake-oss-target");
    await expect(rehydrateFakeOss({
      index,
      async onCheckpoint(checkpoint) {
        if (checkpoint === "before-publish") {
          await mkdir(racedEmptyTarget, { mode: 0o700 });
        }
      },
      sourceDirectory: restoredSource,
      targetDirectory: racedEmptyTarget,
    })).rejects.toMatchObject({ code: "FAKE_OSS_TARGET_CONFLICT" });
    expect(await readdir(racedEmptyTarget)).toEqual([]);

    const racedForeignTarget = join(root, "raced-foreign-fake-oss-target");
    await expect(rehydrateFakeOss({
      index,
      async onCheckpoint(checkpoint) {
        if (checkpoint !== "before-publish") return;
        await mkdir(racedForeignTarget, { mode: 0o700 });
        await writeFile(
          join(racedForeignTarget, "foreign.txt"),
          "keep-raced-foreign",
          { mode: 0o600 },
        );
      },
      sourceDirectory: restoredSource,
      targetDirectory: racedForeignTarget,
    })).rejects.toMatchObject({ code: "FAKE_OSS_TARGET_CONFLICT" });
    expect(await readFile(join(racedForeignTarget, "foreign.txt"), "utf8"))
      .toBe("keep-raced-foreign");
    expect((await readdir(root)).some((name) =>
      name.startsWith(".raced-foreign-fake-oss-target.fake-oss-stage-")))
      .toBe(false);

    const crashedChildTarget = join(root, "crashed-child-fake-oss-target");
    const crashedObjectId = encodeFakeOssObjectIdentity(
      index.entries[0]!.objectKey,
      index.entries[0]!.versionId,
    );
    const crashScript = `
      import "./scripts/node-typescript-runtime.mjs";
      const { rehydrateFakeOss } = await import("./server/fakeOssRecovery.ts");
      await rehydrateFakeOss({
        index: JSON.parse(process.env.UNBOUNDRY_FAKE_OSS_TEST_INDEX),
        onCheckpoint(checkpoint) {
          if (checkpoint === "after-target-mkdir") process.exit(73);
        },
        sourceDirectory: process.env.UNBOUNDRY_FAKE_OSS_TEST_SOURCE,
        targetDirectory: process.env.UNBOUNDRY_FAKE_OSS_TEST_TARGET,
      });
    `;
    await expect(execute(process.execPath, [
      "--input-type=module",
      "--eval",
      crashScript,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UNBOUNDRY_FAKE_OSS_TEST_INDEX: JSON.stringify(index),
        UNBOUNDRY_FAKE_OSS_TEST_SOURCE: restoredSource,
        UNBOUNDRY_FAKE_OSS_TEST_TARGET: crashedChildTarget,
      },
    })).rejects.toMatchObject({ code: 73 });
    expect(await readdir(crashedChildTarget)).toEqual([
      fakeOssRecoveryOwnershipMarkerName,
    ]);
    expect((await lstat(fakeOssRecoveryClaimPath(crashedChildTarget))).isFile())
      .toBe(true);
    expect((await readdir(root)).some((name) =>
      name.startsWith(
        `.${basename(crashedChildTarget)}.fake-oss-stage-`,
      ))).toBe(true);
    const foreignStage = join(
      root,
      `.${basename(crashedChildTarget)}.fake-oss-stage-foreign`,
    );
    await mkdir(foreignStage, { mode: 0o700 });
    await writeFile(join(foreignStage, "foreign.txt"), "keep-foreign-stage", {
      mode: 0o600,
    });

    const firstOwnedCrash = join(root, "first-owned-crash-target");
    const preservedEmptyForeign = join(root, "preserved-empty-foreign-target");
    await expect(rehydrateFakeOss({
      index,
      async onCheckpoint(checkpoint) {
        if (checkpoint !== "before-owned-target-cleanup") return;
        await rename(crashedChildTarget, firstOwnedCrash);
        await mkdir(crashedChildTarget, { mode: 0o700 });
      },
      sourceDirectory: restoredSource,
      targetDirectory: crashedChildTarget,
    })).rejects.toMatchObject({ code: "FAKE_OSS_TARGET_CONFLICT" });
    expect(await readdir(crashedChildTarget)).toEqual([]);
    expect(await readdir(firstOwnedCrash)).toEqual([
      fakeOssRecoveryOwnershipMarkerName,
    ]);
    await rename(crashedChildTarget, preservedEmptyForeign);
    await rename(firstOwnedCrash, crashedChildTarget);

    const secondOwnedCrash = join(root, "second-owned-crash-target");
    const preservedAllowedForeign = join(root, "preserved-allowed-foreign-target");
    await expect(rehydrateFakeOss({
      index,
      async onCheckpoint(checkpoint) {
        if (checkpoint !== "before-owned-target-cleanup") return;
        await rename(crashedChildTarget, secondOwnedCrash);
        await mkdir(join(crashedChildTarget, "objects"), {
          mode: 0o700,
          recursive: true,
        });
        await writeFile(
          join(crashedChildTarget, "objects", `${crashedObjectId}.bin`),
          "keep-allowed-name-foreign",
          { mode: 0o600 },
        );
      },
      sourceDirectory: restoredSource,
      targetDirectory: crashedChildTarget,
    })).rejects.toMatchObject({ code: "FAKE_OSS_TARGET_CONFLICT" });
    expect(await readFile(join(
      crashedChildTarget,
      "objects",
      `${crashedObjectId}.bin`,
    ), "utf8")).toBe("keep-allowed-name-foreign");
    expect(await readdir(secondOwnedCrash)).toEqual([
      fakeOssRecoveryOwnershipMarkerName,
    ]);
    await rename(crashedChildTarget, preservedAllowedForeign);
    await rename(secondOwnedCrash, crashedChildTarget);

    await expect(rehydrateFakeOss({
      index,
      sourceDirectory: restoredSource,
      targetDirectory: crashedChildTarget,
    })).resolves.toMatchObject({
      backupId: index.backupId,
      targetDirectory: crashedChildTarget,
    });
    await expect(lstat(fakeOssRecoveryClaimPath(crashedChildTarget)))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(root)).filter((name) =>
      name.startsWith(
        `.${basename(crashedChildTarget)}.fake-oss-stage-`,
      ))).toEqual([basename(foreignStage)]);
    expect(await readFile(join(foreignStage, "foreign.txt"), "utf8"))
      .toBe("keep-foreign-stage");
    expect(await readdir(preservedEmptyForeign)).toEqual([]);
    expect(await readFile(join(
      preservedAllowedForeign,
      "objects",
      `${crashedObjectId}.bin`,
    ), "utf8")).toBe("keep-allowed-name-foreign");

    const cleanupFailureTarget = join(root, "cleanup-failure-target");
    await mkdir(cleanupFailureTarget, { mode: 0o700 });
    const cleanupFailureClaim = await createCrashClaim(cleanupFailureTarget);
    await rm(join(
      cleanupFailureClaim.stageDirectory,
      "objects",
      `${crashedObjectId}.bin`,
    ));
    await expect(rehydrateFakeOss({
      index,
      sourceDirectory: restoredSource,
      targetDirectory: cleanupFailureTarget,
    })).rejects.toMatchObject({ code: "FAKE_OSS_INVENTORY_INVALID" });
    const releasedClaim = new DatabaseSync(cleanupFailureClaim.markerPath, {
      timeout: 25,
    });
    try {
      releasedClaim.exec("PRAGMA busy_timeout = 25; BEGIN IMMEDIATE; ROLLBACK");
    } finally {
      if (releasedClaim.isTransaction) releasedClaim.exec("ROLLBACK");
      releasedClaim.close();
    }

    await mkdir(join(targetDirectory, "objects"), {
      mode: 0o700,
      recursive: true,
    });
    await createCrashClaim(targetDirectory);
    await writeFile(
      join(targetDirectory, "objects", `${crashedObjectId}.bin`),
      "truncated-crash-copy",
      { mode: 0o600 },
    );
    const first = await rehydrateFakeOss({
      index,
      sourceDirectory: restoredSource,
      targetDirectory,
    });
    await createCrashClaim(targetDirectory);
    const retry = await rehydrateFakeOss({
      index,
      sourceDirectory: restoredSource,
      targetDirectory,
    });
    expect(retry).toEqual(first);
    await expect(lstat(fakeOssRecoveryClaimPath(targetDirectory)))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(first.objects[0]!.objectFile))
      .toEqual(await readFile(fixture.mirrorPath));

    const foreignTarget = join(root, "foreign-fake-oss-target");
    await mkdir(foreignTarget, { mode: 0o700 });
    await writeFile(join(foreignTarget, "foreign.txt"), "keep-foreign", {
      mode: 0o600,
    });
    await expect(rehydrateFakeOss({
      index,
      sourceDirectory: restoredSource,
      targetDirectory: foreignTarget,
    })).rejects.toMatchObject({ code: "FAKE_OSS_TARGET_CONFLICT" });
    expect(await readFile(join(foreignTarget, "foreign.txt"), "utf8"))
      .toBe("keep-foreign");
  } finally {
    fixture?.database.close();
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
