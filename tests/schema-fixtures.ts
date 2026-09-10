import { DatabaseSync } from "node:sqlite";
import { databaseMatchesSchema43Contract } from "../server/database";

/**
 * Freeze a synthetic current-schema database at the exact schema43 contract.
 *
 * This helper exists only for historical migration/operations tests.  It is
 * deliberately explicit about 44 -> 43 and never downgrades an arbitrary
 * database or changes a real application database.
 */
export function freezeSyntheticSchema43(database: DatabaseSync) {
  const version = Number((database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  }).user_version);
  if (version === 43) {
    if (!databaseMatchesSchema43Contract(database)) {
      throw new Error("synthetic schema43 fixture is not the frozen contract");
    }
    return;
  }
  if (version !== 44) return;

  database.exec(`
    BEGIN IMMEDIATE;
    DROP TABLE workflow_run_continuations;
    DROP TABLE generation_result_adoptions;
    DROP TABLE generation_result_save_leases;
    DROP INDEX media_publication_attempts_task_slot;
    DROP TRIGGER media_publication_guard_generation_output_slot_insert;
    DROP TRIGGER media_publication_guard_generation_output_slot_update;
    DROP INDEX media_publication_attempts_active_asset;
    DROP INDEX media_publication_attempts_active_task;
    DROP INDEX media_publication_attempts_owner_state_updated;
    DROP TRIGGER media_publication_guard_task_delete;
    DROP TRIGGER media_publication_guard_owner_delete;

    ALTER TABLE media_publication_attempts
      RENAME TO media_publication_attempts_schema44;

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
      staging_name, task_id, task_execution_attempt, history_label, byte_size,
      checksum_sha256, content_type, duration_seconds, duration_source,
      media_width, media_height, actual_cost_microunits, provider_usage_tokens,
      error_code, retry_count, adopted_at, adopted_canvas_id, created_at,
      updated_at
    )
    SELECT
      attempt_id, owner_id, kind, asset_id, source, state,
      storage_backend, final_storage_name, object_key, storage_profile_id,
      staging_name, task_id, task_execution_attempt, history_label, byte_size,
      checksum_sha256, content_type, duration_seconds, duration_source,
      media_width, media_height, actual_cost_microunits, provider_usage_tokens,
      error_code, retry_count, adopted_at, adopted_canvas_id, created_at,
      updated_at
    FROM media_publication_attempts_schema44;
    DROP TABLE media_publication_attempts_schema44;

    CREATE UNIQUE INDEX media_publication_attempts_active_asset
        ON media_publication_attempts (kind, asset_id)
        WHERE state IN ('reserved', 'staged', 'external-ready', 'compensating');
    CREATE UNIQUE INDEX media_publication_attempts_active_task
        ON media_publication_attempts (task_id, task_execution_attempt)
        WHERE task_id IS NOT NULL
          AND state IN ('reserved', 'staged', 'external-ready', 'compensating');
    CREATE INDEX media_publication_attempts_owner_state_updated
        ON media_publication_attempts (owner_id, state, updated_at DESC);
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
    DELETE FROM schema_migrations WHERE version = 44;
    PRAGMA user_version = 43;
    COMMIT;
  `);
  if (!databaseMatchesSchema43Contract(database)) {
    throw new Error("synthetic schema44 fixture did not freeze to exact schema43");
  }
}
