import { execFile } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { expect, test } from "./safe-test";
import {
  databaseMatchesFrozenSchema37Contract,
  databaseMatchesFrozenSchema38Contract,
  inspectBackupDatabase,
} from "../server/backupInspection";
import { currentSchemaVersion, openAppDatabase } from "../server/database";
import { inspectMediaIntegrity } from "../server/mediaIntegrity";
import { freezeSyntheticSchema43 } from "./schema-fixtures";

const execute = promisify(execFile);
const timestamp = "2026-08-09T00:00:00.000Z";
const digestA = createHash("sha256").update("aaaaa").digest("hex");
const digestB = createHash("sha256").update("bbbbb").digest("hex");
const logicalDatabaseHash = "1".repeat(64);
const providerDocumentAad = Buffer.from(
  "unboundry:provider-profiles:v1",
  "utf8",
);
const storageDocumentAad = Buffer.from(
  "unboundry:storage-profiles:v1",
  "utf8",
);

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

function rollbackMigration43To42(database: DatabaseSync) {
  freezeSyntheticSchema43(database);
  if (Number((database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  }).user_version) !== 43) return;
  database.exec(`
    BEGIN IMMEDIATE;
    DROP TABLE generation_canvas_projection_states;
    DROP TABLE canvas_operation_receipts;
    DROP TABLE media_image_metadata;
    DELETE FROM schema_migrations WHERE version = 43;
    PRAGMA user_version = 42;
    COMMIT;
  `);
}

function rollbackMigration39To38(database: DatabaseSync) {
  rollbackMigration43To42(database);
  if (Number((database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  }).user_version) === 42) {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE media_capacity_reservations;
      DROP TABLE workflow_run_locks;
      DROP TABLE workflow_run_nodes;
      DROP TABLE workflow_runs;
      DELETE FROM schema_migrations WHERE version = 42;
      PRAGMA user_version = 41;
      COMMIT;
    `);
  }
  if (Number((database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  }).user_version) === 41) {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE seedance_character_compliance_attempts;
      DROP TABLE seedance_character_compliance_checks;
      DROP TABLE seedance_character_compliance_disclosures;
      DROP TABLE seedance_asset_bindings;
      DROP TABLE seedance_authorization_sessions;
      DROP TABLE seedance_identity_groups;
      DROP INDEX media_assets_owner_kind_id;
      DELETE FROM schema_migrations WHERE version >= 40;
      PRAGMA user_version = 39;
      COMMIT;
    `);
  }
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

async function fixtureRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await chmod(root, 0o700);
  const dataDirectory = join(root, "data");
  const mediaDirectory = join(dataDirectory, "media");
  // Greenfield publication requires an entry-free private data directory.
  // Establish the exact current database before adding fixture media residue.
  const database = openAppDatabase(dataDirectory);
  database.close();
  await mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
  await chmod(dataDirectory, 0o700);
  await chmod(mediaDirectory, 0o700);
  return { dataDirectory, mediaDirectory, root };
}

function seedUser(database: ReturnType<typeof openAppDatabase>) {
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status, protected,
      created_at, updated_at
    ) VALUES ('media-user', 'media-user', 'Media User', 'disabled',
      'admin', 'active', 1, ?, ?)
  `).run(timestamp, timestamp);
}

function insertMedia(
  database: ReturnType<typeof openAppDatabase>,
  input: {
    checksum?: string;
    durationSeconds?: number | null;
    durationSource?: "provider-task" | "server-probe" | null;
    durationStatus?: "failed" | "not-applicable" | "pending" | "ready";
    height?: number | null;
    id: string;
    kind?: "audio" | "image" | "video";
    name: string;
    size?: number;
    status?: "failed" | "pending" | "ready";
    width?: number | null;
  },
) {
  const kind = input.kind ?? "image";
  database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, object_key, content_type, checksum_sha256,
      storage_status, duration_seconds, duration_source, duration_status,
      media_width, media_height
    ) VALUES (?, ?, 'media-user', ?, ?, ?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    kind,
    input.id,
    input.name,
    input.size ?? 5,
    timestamp,
    timestamp,
    input.name,
    kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
    input.checksum ?? digestA,
    input.status ?? "ready",
    input.durationSeconds === undefined ? (kind === "image" ? null : 1) : input.durationSeconds,
    input.durationSource === undefined
      ? kind === "image" ? null : "server-probe"
      : input.durationSource,
    input.durationStatus ?? (kind === "image" ? "not-applicable" : "ready"),
    input.width === undefined ? (kind === "audio" ? null : 1) : input.width,
    input.height === undefined ? (kind === "audio" ? null : 1) : input.height,
  );
}

function insertTask(
  database: ReturnType<typeof openAppDatabase>,
  input: {
    id: string;
    resultAssetId?: string;
    state: "running" | "success";
  },
) {
  database.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
      request_fingerprint, state, attempt, created_at, updated_at, owner_id,
      result_asset_id, model_configuration
    ) VALUES (?, 'media-canvas', ?, 'image', 'safe', '{}', ?, ?, ?, 1,
      ?, ?, 'media-user', ?, '{}')
  `).run(
    input.id,
    `node-${input.id}`,
    `key-${input.id}`,
    `fingerprint-${input.id}`,
    input.state,
    timestamp,
    timestamp,
    input.resultAssetId ?? null,
  );
}

function insertHistory(
  database: ReturnType<typeof openAppDatabase>,
  id: string,
) {
  database.prepare(`
    INSERT INTO asset_history (
      account_id, id, kind, label, preview, created_at, owner_id
    ) VALUES ('media-user', ?, 'image', 'Generated image', ?, ?, 'media-user')
  `).run(id, `/api/assets/${id}`, timestamp);
}

function insertPublishedGeneration(
  database: ReturnType<typeof openAppDatabase>,
  input: { assetId: string; finalStorageName: string; taskId: string },
) {
  database.prepare(`
    INSERT INTO media_publication_attempts (
      attempt_id, owner_id, kind, asset_id, source, state, storage_backend,
      final_storage_name, object_key, staging_name, task_id,
      task_execution_attempt, history_label, byte_size, checksum_sha256,
      content_type, media_width, media_height, created_at, updated_at, output_slot, output_set_count
    ) VALUES (
      ?, 'media-user', 'image', ?, 'generation', 'published', 'local',
      ?, ?, ?, ?, 1, 'Generated image', 5, ?, 'image/png', 1, 1, ?, ?, 0, 1
    )
  `).run(
    `publication-${input.assetId}`,
    input.assetId,
    input.finalStorageName,
    input.finalStorageName,
    `staging-${input.finalStorageName}`,
    input.taskId,
    digestA,
    timestamp,
    timestamp,
  );
}

test("media integrity report is deterministic for a coherent current-schema publication", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-clean-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    insertMedia(database, { id: "ready-image", name: "ready-image.png" });
    insertTask(database, {
      id: "ready-task",
      resultAssetId: "ready-image",
      state: "success",
    });
    insertHistory(database, "ready-image");
    insertPublishedGeneration(database, {
      assetId: "ready-image",
      finalStorageName: "ready-image.png",
      taskId: "ready-task",
    });
    database.close();

    const input = {
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: [{
        logicalPath: "ready-image.png",
        sha256: digestA,
        size: 5,
      }],
      storageProfileIds: [],
    } as const;
    const first = inspectMediaIntegrity(input);
    const second = inspectMediaIntegrity(input);
    expect(first).toMatchObject({
      backupComplete: true,
      clean: true,
      counts: {
        assets: 1,
        issues: 0,
        publicationAttempts: 1,
        ready: 1,
      },
      schemaVersion: currentSchemaVersion,
      version: 1,
    });
    expect(second).toEqual(first);
    expect(first.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("schema-38 reads publications while schema-37 omits them and evidence hashes bind sorted proof", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-schema37-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    insertMedia(database, { id: "legacy-image", name: "legacy.png" });
    insertTask(database, {
      id: "legacy-task",
      resultAssetId: "legacy-image",
      state: "success",
    });
    insertHistory(database, "legacy-image");
    insertPublishedGeneration(database, {
      assetId: "legacy-image",
      finalStorageName: "legacy.png",
      taskId: "legacy-task",
    });
    rollbackMigration39To38(database);
    expect(databaseMatchesFrozenSchema38Contract(database)).toBe(true);
    const base = {
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: [
        { logicalPath: "z-orphan.bin", sha256: digestB, size: 5 },
        { logicalPath: "legacy.png", sha256: digestA, size: 5 },
      ],
      ossEvidence: [
        {
          byteSize: 5,
          checksumSha256: digestA,
          objectKey: "objects/z",
          versionId: "version-z",
        },
        {
          byteSize: 5,
          checksumSha256: digestB,
          objectKey: "objects/a",
          versionId: "version-a",
        },
      ],
      storageProfileIds: [],
    } as const;
    const schema38 = inspectMediaIntegrity(base);
    expect(schema38).toMatchObject({
      counts: { publicationAttempts: 1 },
      schemaVersion: 38,
    });

    rollbackMigration38To37(database);
    expect(databaseMatchesFrozenSchema37Contract(database)).toBe(true);
    database.close();
    const first = inspectMediaIntegrity(base);
    const reordered = inspectMediaIntegrity({
      ...base,
      files: [...base.files].reverse(),
      ossEvidence: [...base.ossEvidence].reverse(),
    });
    const changedVersion = inspectMediaIntegrity({
      ...base,
      ossEvidence: base.ossEvidence.map((item) => item.objectKey === "objects/a"
        ? { ...item, versionId: "version-a-2" }
        : item),
    });
    expect(first).toMatchObject({
      counts: { publicationAttempts: 0 },
      schemaVersion: 37,
    });
    expect(reordered).toEqual(first);
    expect(changedVersion.evidenceSha256).not.toBe(first.evidenceSha256);
    expect(changedVersion.sha256).not.toBe(first.sha256);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("ready duration, video dimensions, and publication metadata drift are reported", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-metadata-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    insertMedia(database, {
      durationSeconds: null,
      durationSource: null,
      durationStatus: "pending",
      id: "bad-audio",
      kind: "audio",
      name: "bad-audio.mp3",
    });
    insertMedia(database, {
      height: null,
      id: "bad-video",
      kind: "video",
      name: "bad-video.mp4",
      width: null,
    });
    insertMedia(database, { id: "drift-image", name: "drift.png" });
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        content_type, byte_size, checksum_sha256, media_width, media_height,
        created_at, updated_at
      ) VALUES (
        'published-drift', 'media-user', 'image', 'drift-image', 'upload',
        'published', 'local', 'drift.png', 'drift.png',
        '.publication-published-drift.generating', 'image/png', 5, ?, 1, 1,
        ?, ?
      )
    `).run(digestB, timestamp, timestamp);
    database.close();
    const report = inspectMediaIntegrity({
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: [
        { logicalPath: "bad-audio.mp3", sha256: digestA, size: 5 },
        { logicalPath: "bad-video.mp4", sha256: digestA, size: 5 },
        { logicalPath: "drift.png", sha256: digestA, size: 5 },
      ],
      storageProfileIds: [],
    });
    expect(report.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "MEDIA_INTEGRITY_DURATION_METADATA_INVALID",
      "MEDIA_INTEGRITY_PUBLICATION_MEDIA_MISMATCH",
      "MEDIA_INTEGRITY_VIDEO_DIMENSIONS_MISSING",
    ]));
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("OSS media and publication journals bind to decrypted storage profile ids without exposing them", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-storage-profile-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height, storage_profile_id
      ) VALUES (
        'image', 'remote-image', 'media-user', 'remote-image.png', 5, ?, ?,
        'oss', 'objects/remote-image', 'image/png', ?, 'ready', NULL, NULL,
        'not-applicable', 1, 1, 'private-profile-id'
      )
    `).run(timestamp, timestamp, digestA);
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, storage_profile_id,
        staging_name, content_type, created_at, updated_at
      ) VALUES (
        'failed-remote-publication', 'media-user', 'image', 'failed-remote',
        'upload', 'failed', 'oss', 'failed-remote.png',
        'objects/failed-remote', 'private-profile-id',
        '.publication-failed-remote.generating', 'image/png', ?, ?
      )
    `).run(timestamp, timestamp);
    database.close();
    const input = {
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: [],
      ossEvidence: [{
        byteSize: 5,
        checksumSha256: digestA,
        objectKey: "objects/remote-image",
        versionId: "remote-version",
      }],
    } as const;
    const missing = inspectMediaIntegrity({
      ...input,
      storageProfileIds: [],
    });
    const profileIssues = missing.issues.filter(({ code }) =>
      code === "MEDIA_INTEGRITY_OSS_PROFILE_MISSING"
    );
    expect(profileIssues).toHaveLength(2);
    expect(profileIssues.every(({ backupBlocking }) => backupBlocking)).toBe(true);
    expect(JSON.stringify(profileIssues)).not.toContain("private-profile-id");
    expect(missing.backupComplete).toBe(false);

    const exact = inspectMediaIntegrity({
      ...input,
      storageProfileIds: ["private-profile-id"],
    });
    expect(exact.clean).toBe(true);
    expect(exact.backupComplete).toBe(true);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("generic history rows report exact owner, kind, and readiness drift without a success task", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-history-relationship-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status, protected,
        created_at, updated_at
      ) VALUES (
        'other-media-user', 'other-media-user', 'Other Media User', 'disabled',
        'user', 'active', 0, ?, ?
      )
    `).run(timestamp, timestamp);
    insertMedia(database, { id: "history-owner", name: "history-owner.png" });
    insertMedia(database, { id: "history-kind", name: "history-kind.png" });
    insertMedia(database, {
      id: "history-pending",
      name: "history-pending.png",
      status: "pending",
    });
    const insert = database.prepare(`
      INSERT INTO asset_history (
        account_id, id, kind, label, preview, created_at, owner_id
      ) VALUES (?, ?, ?, 'History relationship', ?, ?, ?)
    `);
    insert.run(
      "media-user",
      "history-owner",
      "image",
      "/api/assets/history-owner",
      timestamp,
      "other-media-user",
    );
    insert.run(
      "media-user",
      "history-kind",
      "video",
      "/api/video-assets/history-kind",
      timestamp,
      "media-user",
    );
    insert.run(
      "media-user",
      "history-pending",
      "image",
      "/api/assets/history-pending",
      timestamp,
      "media-user",
    );
    database.close();

    const report = inspectMediaIntegrity({
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: [
        { logicalPath: "history-kind.png", sha256: digestA, size: 5 },
        { logicalPath: "history-owner.png", sha256: digestA, size: 5 },
        { logicalPath: "history-pending.png", sha256: digestA, size: 5 },
      ],
      storageProfileIds: [],
    });
    const relationshipIssues = report.issues.filter(({ code }) =>
      code.startsWith("MEDIA_INTEGRITY_HISTORY_MEDIA_")
    );
    expect(relationshipIssues.map(({ code }) => code)).toEqual([
      "MEDIA_INTEGRITY_HISTORY_MEDIA_KIND_MISMATCH",
      "MEDIA_INTEGRITY_HISTORY_MEDIA_NOT_READY",
      "MEDIA_INTEGRITY_HISTORY_MEDIA_OWNER_MISMATCH",
    ]);
    expect(relationshipIssues.every(({ backupBlocking }) => !backupBlocking))
      .toBe(true);
    expect(report.clean).toBe(false);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("media integrity reports orphan, status, checksum, journal, task, and dimension faults without mutation", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-matrix-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    insertMedia(database, { id: "checksum-image", name: "checksum.png" });
    insertTask(database, {
      id: "checksum-task",
      resultAssetId: "checksum-image",
      state: "success",
    });
    insertHistory(database, "checksum-image");
    insertMedia(database, { id: "missing-image", name: "missing.png" });
    insertMedia(database, {
      height: null,
      id: "dimension-image",
      name: "dimension.png",
      width: null,
    });
    insertMedia(database, {
      id: "pending-image",
      name: "pending.png",
      status: "pending",
    });
    insertMedia(database, {
      id: "failed-image",
      name: "failed.png",
      status: "failed",
    });
    insertTask(database, { id: "missing-result-task", state: "success" });
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        content_type, byte_size, checksum_sha256, created_at, updated_at
      ) VALUES (
        'active-upload', 'media-user', 'image', 'pending-image', 'upload',
        'staged', 'local', 'pending.png', 'pending.png',
        '.publication-active-upload.generating', 'image/png', 5, ?, ?, ?
      )
    `).run(digestA, timestamp, timestamp);
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        content_type, created_at, updated_at
      ) VALUES (
        'compensating-upload', 'media-user', 'image', 'lost-image', 'upload',
        'compensating', 'local', 'lost.png', 'lost.png',
        '.publication-compensating-upload.generating', 'image/png', ?, ?
      )
    `).run(timestamp, timestamp);
    database.close();
    const databasePath = join(fixture.dataDirectory, "unboundry.sqlite");
    const before = createHash("sha256").update(await readFile(databasePath)).digest("hex");
    const report = inspectMediaIntegrity({
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath,
      files: [
        { logicalPath: "checksum.png", sha256: digestB, size: 5 },
        { logicalPath: "dimension.png", sha256: digestA, size: 5 },
        { logicalPath: "orphan.bin", sha256: digestA, size: 5 },
      ],
      storageProfileIds: [],
    });
    const after = createHash("sha256").update(await readFile(databasePath)).digest("hex");
    expect(after).toBe(before);
    expect(report.clean).toBe(false);
    expect(report.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "MEDIA_INTEGRITY_CHECKSUM_MISMATCH",
      "MEDIA_INTEGRITY_IMAGE_DIMENSIONS_MISSING",
      "MEDIA_INTEGRITY_LOCAL_FILE_MISSING",
      "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
      "MEDIA_INTEGRITY_PUBLICATION_ACTIVE",
      "MEDIA_INTEGRITY_PUBLICATION_COMPENSATING",
      "MEDIA_INTEGRITY_PUBLICATION_MEDIA_MISSING",
      "MEDIA_INTEGRITY_PUBLICATION_STAGING_MISSING",
      "MEDIA_INTEGRITY_STATUS_FAILED",
      "MEDIA_INTEGRITY_STATUS_PENDING",
      "MEDIA_INTEGRITY_TASK_RESULT_ID_MISSING",
    ]));
    const codes = report.issues.map(({ code }) => code);
    expect(codes).toEqual([...codes].sort());
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("media integrity distinguishes upload adoption warnings from durable deletion blockers", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-lifecycle-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status, protected,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'disabled', 'user', 'active', 0, ?, ?)
    `).run(
      "media-user-delete-failed",
      "media-user-delete-failed",
      "Media User Delete Failed",
      timestamp,
      timestamp,
    );
    database.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at, deleted_at
      ) VALUES ('media-user', 'adoption-canvas', 'Adoption canvas', 1, 1, 1, NULL)
    `).run();
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES (
        'media-user', 'adoption-canvas', 1, 1, ?, '[]',
        '{"x":0,"y":0,"zoom":1}', ?, NULL, 0
      )
    `).run(JSON.stringify([{
      data: { assetId: "adoption-coherent" },
      id: "image-node",
      type: "image",
    }]), timestamp);

    const publications = [
      {
        adoptedAt: timestamp,
        adoptedCanvasId: "adoption-canvas",
        assetId: "adoption-coherent",
        attemptId: "published-adoption-coherent",
      },
      {
        adoptedAt: timestamp,
        adoptedCanvasId: "adoption-canvas",
        assetId: "adoption-mismatch",
        attemptId: "published-adoption-mismatch",
      },
      {
        adoptedAt: timestamp,
        adoptedCanvasId: "missing-adoption-canvas",
        assetId: "adoption-provenance-missing",
        attemptId: "published-adoption-provenance-missing",
      },
      {
        adoptedAt: null,
        adoptedCanvasId: null,
        assetId: "upload-unadopted",
        attemptId: "published-upload-unadopted",
      },
    ] as const;
    const insertPublication = database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        content_type, byte_size, checksum_sha256, media_width, media_height,
        adopted_at, adopted_canvas_id, created_at, updated_at
      ) VALUES (
        ?, 'media-user', 'image', ?, 'upload', 'published',
        'local', ?, ?, ?, 'image/png', 5, ?, 1, 1, ?, ?, ?, ?
      )
    `);
    for (const publication of publications) {
      const storageName = `${publication.assetId}.png`;
      insertMedia(database, {
        id: publication.assetId,
        name: storageName,
      });
      insertPublication.run(
        publication.attemptId,
        publication.assetId,
        storageName,
        storageName,
        `.publication-${publication.attemptId}.generating`,
        digestA,
        publication.adoptedAt,
        publication.adoptedCanvasId,
        timestamp,
        timestamp,
      );
    }
    database.prepare(`
      INSERT INTO media_delete_intents (
        owner_id, kind, asset_id, state, created_at, updated_at
      ) VALUES ('media-user', 'image', 'delete-active', 'delete-requested', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO media_delete_intents (
        owner_id, kind, asset_id, state, created_at, updated_at
      ) VALUES ('media-user', 'video', 'delete-failed', 'delete-failed', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO account_delete_intents (
        owner_id, state, error_code, retry_count, created_at, updated_at
      ) VALUES ('media-user', 'running', NULL, 0, ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO account_delete_intents (
        owner_id, state, error_code, retry_count, created_at, updated_at
      ) VALUES (
        'media-user-delete-failed', 'failed',
        'ACCOUNT_MEDIA_CLEANUP_FAILED', 1, ?, ?
      )
    `).run(timestamp, timestamp);
    database.close();

    const report = inspectMediaIntegrity({
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: publications.map(({ assetId }) => ({
        logicalPath: `${assetId}.png`,
        sha256: digestA,
        size: 5,
      })),
      storageProfileIds: [],
    });
    const lifecycleIssues = report.issues.filter(({ code }) =>
      code.includes("_ADOPTION_") ||
      code.endsWith("_UPLOAD_UNADOPTED") ||
      code.includes("_DELETE_"));
    expect(lifecycleIssues.map(({ code }) => code)).toEqual([
      "MEDIA_INTEGRITY_ACCOUNT_DELETE_ACTIVE",
      "MEDIA_INTEGRITY_ACCOUNT_DELETE_FAILED",
      "MEDIA_INTEGRITY_DELETE_ACTIVE",
      "MEDIA_INTEGRITY_DELETE_FAILED",
      "MEDIA_INTEGRITY_UPLOAD_ADOPTION_MISMATCH",
      "MEDIA_INTEGRITY_UPLOAD_ADOPTION_PROVENANCE_MISSING",
      "MEDIA_INTEGRITY_UPLOAD_UNADOPTED",
    ]);
    expect(lifecycleIssues.filter(({ backupBlocking }) => backupBlocking)
      .map(({ code }) => code)).toEqual([
        "MEDIA_INTEGRITY_ACCOUNT_DELETE_ACTIVE",
        "MEDIA_INTEGRITY_ACCOUNT_DELETE_FAILED",
        "MEDIA_INTEGRITY_DELETE_ACTIVE",
        "MEDIA_INTEGRITY_DELETE_FAILED",
        "MEDIA_INTEGRITY_UPLOAD_UNADOPTED",
      ]);
    expect(lifecycleIssues.filter(({ severity }) => severity === "warning")
      .map(({ code }) => code)).toEqual([
        "MEDIA_INTEGRITY_UPLOAD_ADOPTION_MISMATCH",
        "MEDIA_INTEGRITY_UPLOAD_ADOPTION_PROVENANCE_MISSING",
      ]);
    expect(report.issues.filter(({ assetId }) =>
      assetId === "adoption-coherent"
    )).toEqual([]);
    expect(report.backupComplete).toBe(false);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("the read-only media report CLI requires a frozen absolute source and leaves it unchanged", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-cli-");
  const scratchRoot = join(fixture.root, "scratch");
  await mkdir(scratchRoot, { mode: 0o700 });
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    database.close();
    const databasePath = join(fixture.dataDirectory, "unboundry.sqlite");
    const before = createHash("sha256").update(await readFile(databasePath)).digest("hex");
    const result = await execute(process.execPath, [
      "scripts/report-media-integrity.mjs",
      "--data-dir",
      fixture.dataDirectory,
      "--scratch-root",
      scratchRoot,
      "--source-frozen",
      "--external-freeze-non-final",
    ], { cwd: process.cwd() });
    expect(JSON.parse(result.stdout)).toMatchObject({
      captureMode: "external-unverified",
      clean: true,
      finalCandidate: false,
      schemaVersion: currentSchemaVersion,
      version: 1,
    });
    const after = createHash("sha256").update(await readFile(databasePath)).digest("hex");
    expect(after).toBe(before);
    expect(await readdir(scratchRoot)).toEqual([]);

    const frozenAt = "2026-01-01T00:02:00.000Z";
    const frozenDatabase = openAppDatabase(fixture.dataDirectory);
    try {
      seedUser(frozenDatabase);
      frozenDatabase.prepare(`
        UPDATE generation_safety_settings
        SET global_enabled = 0, emergency_stop = 1, updated_at = ?
        WHERE id = 1
      `).run(frozenAt);
      frozenDatabase.prepare(`
        INSERT INTO admin_audit_events (
          actor_user_id, action, details, created_at
        ) VALUES ('media-user', 'generation_safety.update', ?, ?)
      `).run(JSON.stringify({
        after: {
          emergencyStop: true,
          globalEnabled: false,
          updatedAt: frozenAt,
        },
      }), frozenAt);
      rollbackMigration43To42(frozenDatabase);
      frozenDatabase.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      frozenDatabase.close();
    }
    const secretsDirectory = join(fixture.dataDirectory, "secrets");
    await mkdir(secretsDirectory, { mode: 0o700 });
    const secretLockPath = join(
      secretsDirectory,
      "provider-profile-write-lock.sqlite",
    );
    const secretLock = new DatabaseSync(secretLockPath);
    secretLock.exec(`
      PRAGMA journal_mode = DELETE;
      CREATE TABLE provider_profile_write_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        marker INTEGER NOT NULL
      );
      INSERT INTO provider_profile_write_lock (id, marker) VALUES (1, 1);
    `);
    secretLock.close();
    await chmod(secretLockPath, 0o600);
    const masterKey = randomBytes(32);
    try {
      await writeFile(
        join(secretsDirectory, "config-master.key"),
        masterKey,
        { mode: 0o600 },
      );
      await writeFile(
        join(secretsDirectory, "provider-profiles.enc.json"),
        encryptedDocument(masterKey, providerDocumentAad, {
          profiles: [],
          version: 1,
        }),
        { mode: 0o600 },
      );
      await writeFile(
        join(secretsDirectory, "storage-profiles.enc.json"),
        encryptedDocument(masterKey, storageDocumentAad, {
          activeProfileId: null,
          mediaRoutingEnabled: false,
          profiles: [],
          version: 1,
        }),
        { mode: 0o600 },
      );
    } finally {
      masterKey.fill(0);
    }
    const inspection = inspectBackupDatabase(databasePath, fixture.dataDirectory);
    expect(inspection.userVersion).toBe(42);
    const locked = await execute(process.execPath, [
      "scripts/report-media-integrity.mjs",
      "--data-dir",
      fixture.dataDirectory,
      "--historical-recovery",
      "--scratch-root",
      scratchRoot,
      "--source-frozen",
      "--expected-database-logical-sha256",
      inspection.logicalSha256,
      "--expected-schema-version",
      "42",
      "--generation-frozen-at",
      frozenAt,
      "--last-provider-admission-at",
      "none",
    ], { cwd: process.cwd() });
    const lockedReport = JSON.parse(locked.stdout) as Record<string, unknown>;
    expect(lockedReport).toMatchObject({
      captureMode: "locked-exact",
      clean: true,
      finalCandidate: false,
      schemaVersion: 42,
      version: 1,
    });
    expect(lockedReport.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lockedReport.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readdir(scratchRoot)).toEqual([]);

    let rejected: Error & { stderr?: string } | undefined;
    try {
      await execute(process.execPath, [
        "scripts/report-media-integrity.mjs",
        "--data-dir",
        fixture.dataDirectory,
      ], { cwd: process.cwd() });
    } catch (error) {
      rejected = error as Error & { stderr?: string };
    }
    expect(JSON.parse(rejected?.stderr ?? "{}")).toMatchObject({
      code: "MEDIA_REPORT_ARGUMENT_INVALID",
    });
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});
