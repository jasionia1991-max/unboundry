import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  currentSchemaVersion,
  openAppDatabase,
} from "../server/database";

const execute = promisify(execFile);

test("legacy data is preserved while schema migrations become repeatable", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-migration-"));
  try {
    const legacy = new DatabaseSync(join(dataDirectory, "tapnow.sqlite"));
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
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-duration-migration-"));
  try {
    const legacy = new DatabaseSync(join(dataDirectory, "tapnow.sqlite"));
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
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

test("a database and its media restore from a checksummed backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "tapnow-backup-"));
  const dataDirectory = join(root, "data");
  const backupRoot = join(root, "backups");
  try {
    await mkdir(join(dataDirectory, "media"), { recursive: true });
    await writeFile(
      join(dataDirectory, "media", "preserved-image.png"),
      Buffer.from("safe-test-media"),
    );
    const database = openAppDatabase(dataDirectory);
    database
      .prepare(`
        INSERT INTO project_metadata (id, title, updated_at)
        VALUES (?, ?, ?)
      `)
      .run("backup-project", "备份验证", Date.now());
    database.close();

    const backupResult = await execute(
      process.execPath,
      [
        "scripts/backup-data.mjs",
        "--data-dir",
        dataDirectory,
        "--backup-root",
        backupRoot,
      ],
      { cwd: process.cwd() },
    );
    const backup = JSON.parse(backupResult.stdout.trim()) as {
      backupDirectory: string;
      mediaFiles: number;
      schemaVersion: number;
    };
    expect(backup).toMatchObject({
      mediaFiles: 1,
      schemaVersion: currentSchemaVersion,
    });

    const manifest = JSON.parse(
      await readFile(join(backup.backupDirectory, "manifest.json"), "utf8"),
    ) as {
      database: { quickCheck: string; tableCounts: Record<string, number> };
      media: { files: Array<{ path: string }> };
    };
    expect(manifest.database.quickCheck).toBe("ok");
    expect(manifest.database.tableCounts.project_metadata).toBe(1);
    expect(manifest.media.files.map(({ path }) => path)).toEqual([
      "preserved-image.png",
    ]);

    const restoreResult = await execute(
      process.execPath,
      [
        "scripts/verify-backup.mjs",
        "--backup-dir",
        backup.backupDirectory,
      ],
      { cwd: process.cwd() },
    );
    expect(JSON.parse(restoreResult.stdout.trim())).toMatchObject({
      databaseQuickCheck: "ok",
      mediaFiles: 1,
      restoredToTemporaryDirectory: true,
      schemaVersion: currentSchemaVersion,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
