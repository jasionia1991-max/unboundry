import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import publicTemplateSeeds from "./publicTemplateSeeds.json" with { type: "json" };

type Migration = {
  name: string;
  prepare?: (database: DatabaseSync) => void;
  sql: string;
  version: number;
};

function addColumnIfMissing(
  database: DatabaseSync,
  tableName: string,
  columnName: string,
  definition: string,
) {
  const sqlIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (!sqlIdentifier.test(tableName) || !sqlIdentifier.test(columnName)) {
    throw new Error("Unsafe migration identifier");
  }
  const table = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName);
  if (!table) return;
  const columns = database
    .prepare(`PRAGMA table_info("${tableName}")`)
    .all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return;
  database.exec(
    `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`,
  );
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "canvas-history-and-project-metadata",
    sql: `
      CREATE TABLE IF NOT EXISTS canvas_documents (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        nodes TEXT NOT NULL,
        edges TEXT NOT NULL,
        viewport TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS asset_history (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        preview TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      );
      CREATE TABLE IF NOT EXISTS project_metadata (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "persistent-generation-tasks",
    sql: `
      CREATE TABLE IF NOT EXISTS generation_tasks (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (
          kind IN ('image', 'video', 'audio')
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
        UNIQUE (canvas_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS generation_tasks_canvas_updated
        ON generation_tasks (canvas_id, updated_at DESC);
    `,
  },
  {
    version: 3,
    name: "generation-task-state-events",
    sql: `
      CREATE TABLE IF NOT EXISTS generation_task_events (
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
      CREATE INDEX IF NOT EXISTS generation_task_events_task_created
        ON generation_task_events (task_id, created_at ASC, id ASC);
    `,
  },
  {
    version: 4,
    name: "accounts-sessions-and-owned-data",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        login_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS users_status_role
        ON users (status, role, created_at ASC);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS sessions_user_expires
        ON sessions (user_id, expires_at);

      CREATE TABLE IF NOT EXISTS admin_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user_id TEXT,
        details TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS admin_audit_actor_created
        ON admin_audit_events (actor_user_id, created_at DESC);

      ALTER TABLE canvas_documents RENAME TO canvas_documents_unowned;
      CREATE TABLE canvas_documents (
        owner_id TEXT,
        id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        nodes TEXT NOT NULL,
        edges TEXT NOT NULL,
        viewport TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (owner_id, id),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
      INSERT INTO canvas_documents (
        owner_id, id, revision, nodes, edges, viewport, updated_at
      )
      SELECT NULL, id, revision, nodes, edges, viewport, updated_at
      FROM canvas_documents_unowned;
      DROP TABLE canvas_documents_unowned;
      CREATE INDEX canvas_documents_owner_updated
        ON canvas_documents (owner_id, updated_at DESC);

      ALTER TABLE project_metadata RENAME TO project_metadata_unowned;
      CREATE TABLE project_metadata (
        owner_id TEXT,
        id TEXT NOT NULL,
        title TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (owner_id, id),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
      INSERT INTO project_metadata (owner_id, id, title, updated_at)
      SELECT NULL, id, title, updated_at
      FROM project_metadata_unowned;
      DROP TABLE project_metadata_unowned;
      CREATE INDEX project_metadata_owner_updated
        ON project_metadata (owner_id, updated_at DESC);

      ALTER TABLE asset_history ADD COLUMN owner_id TEXT;
      CREATE INDEX asset_history_owner_created
        ON asset_history (owner_id, created_at DESC);

      ALTER TABLE generation_tasks ADD COLUMN owner_id TEXT;
      CREATE INDEX generation_tasks_owner_canvas_updated
        ON generation_tasks (owner_id, canvas_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS media_assets (
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
        id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        storage_name TEXT NOT NULL UNIQUE,
        byte_size INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, id),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS media_assets_owner_created
        ON media_assets (owner_id, created_at DESC);
    `,
  },
  {
    version: 5,
    name: "administrator-model-catalog",
    sql: `
      CREATE TABLE IF NOT EXISTS provider_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        driver TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('disabled', 'enabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        provider_profile_id TEXT NOT NULL,
        provider_model_id TEXT NOT NULL,
        capability TEXT NOT NULL CHECK (
          capability IN ('text', 'image', 'video', 'audio')
        ),
        status TEXT NOT NULL CHECK (
          status IN ('draft', 'published', 'disabled')
        ),
        default_parameters TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id)
      );
      CREATE INDEX IF NOT EXISTS model_profiles_capability_status
        ON model_profiles (capability, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS node_model_bindings (
        node_type TEXT NOT NULL CHECK (
          node_type IN ('text', 'image', 'video', 'audio')
        ),
        model_id TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (node_type, model_id),
        FOREIGN KEY (model_id) REFERENCES model_profiles(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS node_model_bindings_one_default
        ON node_model_bindings (node_type)
        WHERE enabled = 1 AND is_default = 1;
      CREATE INDEX IF NOT EXISTS node_model_bindings_order
        ON node_model_bindings (node_type, enabled, sort_order, model_id);

      INSERT OR IGNORE INTO provider_profiles (
        id, display_name, driver, status, created_at, updated_at
      )
      VALUES (
        'provider-unconfigured',
        '尚未接入 Provider',
        'unconfigured',
        'disabled',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      );

      INSERT OR IGNORE INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at
      )
      VALUES
        (
          'model-text-gemini-3-1-flash-lite',
          'Gemini 3.1 Flash Lite',
          'provider-unconfigured',
          'unconfigured:text',
          'text',
          'published',
          '{}',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        ),
        (
          'model-image-nano-banana-2-lite',
          'Nano Banana 2 Lite',
          'provider-unconfigured',
          'unconfigured:image',
          'image',
          'published',
          '{}',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        ),
        (
          'model-video-seedance-2-mini',
          'Seedance 2.0 Mini',
          'provider-unconfigured',
          'unconfigured:video',
          'video',
          'published',
          '{}',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        ),
        (
          'model-audio-mureka-v8',
          'Mureka V8',
          'provider-unconfigured',
          'unconfigured:audio',
          'audio',
          'published',
          '{}',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        );

      INSERT OR IGNORE INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      )
      VALUES
        ('text', 'model-text-gemini-3-1-flash-lite', 1, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('image', 'model-image-nano-banana-2-lite', 1, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('video', 'model-video-seedance-2-mini', 1, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('audio', 'model-audio-mureka-v8', 1, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    `,
  },
  {
    version: 6,
    name: "remove-unconfigured-example-models",
    sql: `
      DELETE FROM node_model_bindings
      WHERE model_id IN (
        'model-text-gemini-3-1-flash-lite',
        'model-image-nano-banana-2-lite',
        'model-video-seedance-2-mini',
        'model-audio-mureka-v8'
      );

      DELETE FROM model_profiles
      WHERE provider_profile_id = 'provider-unconfigured'
        AND id IN (
          'model-text-gemini-3-1-flash-lite',
          'model-image-nano-banana-2-lite',
          'model-video-seedance-2-mini',
          'model-audio-mureka-v8'
      );
    `,
  },
  {
    version: 7,
    name: "private-object-storage-metadata",
    sql: `
      ALTER TABLE media_assets
        ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'local'
        CHECK (storage_backend IN ('local', 'oss'));
      ALTER TABLE media_assets ADD COLUMN object_key TEXT;
      ALTER TABLE media_assets ADD COLUMN content_type TEXT;
      ALTER TABLE media_assets ADD COLUMN checksum_sha256 TEXT;
      ALTER TABLE media_assets
        ADD COLUMN storage_status TEXT NOT NULL DEFAULT 'ready'
        CHECK (storage_status IN ('pending', 'ready', 'failed'));

      UPDATE media_assets
      SET
        object_key = storage_name,
        content_type = CASE kind
          WHEN 'image' THEN 'image/png'
          WHEN 'video' THEN 'video/mp4'
          ELSE CASE
            WHEN lower(storage_name) LIKE '%.mp3' THEN 'audio/mpeg'
            WHEN lower(storage_name) LIKE '%.m4a' THEN 'audio/mp4'
            WHEN lower(storage_name) LIKE '%.aac' THEN 'audio/aac'
            ELSE 'audio/wav'
          END
        END,
        storage_status = 'ready'
      WHERE object_key IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS media_assets_backend_object_key
        ON media_assets (storage_backend, object_key)
        WHERE object_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS media_assets_owner_storage
        ON media_assets (owner_id, storage_backend, storage_status);
    `,
  },
  {
    version: 8,
    name: "generation-safety-controls",
    sql: `
      CREATE TABLE IF NOT EXISTS generation_safety_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        global_enabled INTEGER NOT NULL DEFAULT 0
          CHECK (global_enabled IN (0, 1)),
        emergency_stop INTEGER NOT NULL DEFAULT 0
          CHECK (emergency_stop IN (0, 1)),
        per_user_concurrency INTEGER NOT NULL DEFAULT 1
          CHECK (per_user_concurrency BETWEEN 1 AND 20),
        requests_per_minute INTEGER NOT NULL DEFAULT 3
          CHECK (requests_per_minute BETWEEN 1 AND 120),
        image_concurrency INTEGER NOT NULL DEFAULT 1
          CHECK (image_concurrency BETWEEN 1 AND 20),
        video_concurrency INTEGER NOT NULL DEFAULT 1
          CHECK (video_concurrency BETWEEN 1 AND 20),
        audio_concurrency INTEGER NOT NULL DEFAULT 1
          CHECK (audio_concurrency BETWEEN 1 AND 20),
        daily_cost_limit_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (daily_cost_limit_microunits BETWEEN 0 AND 1000000000000),
        monthly_cost_limit_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (monthly_cost_limit_microunits BETWEEN 0 AND 10000000000000),
        unknown_cost_policy TEXT NOT NULL DEFAULT 'block'
          CHECK (unknown_cost_policy = 'block'),
        failure_threshold INTEGER NOT NULL DEFAULT 3
          CHECK (failure_threshold BETWEEN 1 AND 20),
        cooldown_minutes INTEGER NOT NULL DEFAULT 30
          CHECK (cooldown_minutes BETWEEN 1 AND 1440),
        running_task_policy TEXT NOT NULL DEFAULT 'wait'
          CHECK (running_task_policy IN ('wait', 'cancel')),
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO generation_safety_settings (
        id, updated_at
      )
      VALUES (1, CURRENT_TIMESTAMP);

      ALTER TABLE generation_tasks
        ADD COLUMN estimated_cost_microunits INTEGER
        CHECK (
          estimated_cost_microunits IS NULL
          OR estimated_cost_microunits >= 0
        );
      ALTER TABLE generation_tasks
        ADD COLUMN actual_cost_microunits INTEGER
        CHECK (
          actual_cost_microunits IS NULL
          OR actual_cost_microunits >= 0
        );
      CREATE INDEX IF NOT EXISTS generation_tasks_owner_state_created
        ON generation_tasks (owner_id, state, created_at DESC);
    `,
  },
  {
    version: 9,
    name: "generation-provider-results-and-model-cost-caps",
    sql: `
      ALTER TABLE model_profiles
        ADD COLUMN max_cost_microunits INTEGER NOT NULL DEFAULT 0
        CHECK (max_cost_microunits BETWEEN 0 AND 100000000);

      ALTER TABLE generation_tasks ADD COLUMN provider_profile_id TEXT;
      ALTER TABLE generation_tasks ADD COLUMN provider_model_id TEXT;
      ALTER TABLE generation_tasks ADD COLUMN result_asset_id TEXT;

      CREATE INDEX IF NOT EXISTS generation_tasks_result_asset
        ON generation_tasks (result_asset_id)
        WHERE result_asset_id IS NOT NULL;
    `,
  },
  {
    version: 10,
    name: "multi-currency-video-generation",
    sql: `
      ALTER TABLE model_profiles
        ADD COLUMN cost_currency TEXT NOT NULL DEFAULT 'USD'
        CHECK (cost_currency IN ('USD', 'CNY'));

      ALTER TABLE generation_tasks
        ADD COLUMN cost_currency TEXT NOT NULL DEFAULT 'USD'
        CHECK (cost_currency IN ('USD', 'CNY'));
      ALTER TABLE generation_tasks ADD COLUMN provider_task_id TEXT;
      ALTER TABLE generation_tasks
        ADD COLUMN provider_usage_tokens INTEGER
        CHECK (provider_usage_tokens IS NULL OR provider_usage_tokens >= 0);

      ALTER TABLE generation_safety_settings
        ADD COLUMN daily_cost_limit_cny_microunits INTEGER NOT NULL DEFAULT 0
        CHECK (daily_cost_limit_cny_microunits BETWEEN 0 AND 1000000000000);
      ALTER TABLE generation_safety_settings
        ADD COLUMN monthly_cost_limit_cny_microunits INTEGER NOT NULL DEFAULT 0
        CHECK (monthly_cost_limit_cny_microunits BETWEEN 0 AND 10000000000000);

      CREATE INDEX IF NOT EXISTS generation_tasks_currency_created
        ON generation_tasks (cost_currency, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS generation_tasks_provider_task
        ON generation_tasks (provider_profile_id, provider_task_id)
        WHERE provider_task_id IS NOT NULL;
    `,
  },
  {
    version: 11,
    name: "generation-model-configuration-snapshot",
    sql: `
      ALTER TABLE generation_tasks
        ADD COLUMN model_configuration TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 12,
    name: "canvas-save-session-ordering",
    sql: `
      ALTER TABLE canvas_documents ADD COLUMN save_session_id TEXT;
      ALTER TABLE canvas_documents
        ADD COLUMN save_sequence INTEGER NOT NULL DEFAULT 0
        CHECK (save_sequence >= 0);
    `,
  },
  {
    version: 13,
    name: "trusted-media-duration-metadata",
    sql: `
      ALTER TABLE media_assets
        ADD COLUMN duration_seconds REAL
        CHECK (
          duration_seconds IS NULL
          OR (duration_seconds > 0 AND duration_seconds <= 604800)
        );
      ALTER TABLE media_assets
        ADD COLUMN duration_source TEXT
        CHECK (
          duration_source IS NULL
          OR duration_source IN ('provider-task', 'server-probe')
        );
      ALTER TABLE media_assets
        ADD COLUMN duration_status TEXT NOT NULL DEFAULT 'not-applicable'
        CHECK (
          duration_status IN ('not-applicable', 'pending', 'ready', 'failed')
        );

      UPDATE media_assets
      SET duration_status = 'pending'
      WHERE kind IN ('video', 'audio');
    `,
  },
  {
    version: 14,
    name: "text-generation-task-results",
    sql: `
      ALTER TABLE generation_safety_settings
        ADD COLUMN text_concurrency INTEGER NOT NULL DEFAULT 1
        CHECK (text_concurrency BETWEEN 1 AND 20);

      ALTER TABLE generation_task_events
        RENAME TO generation_task_events_schema13;
      ALTER TABLE generation_tasks
        RENAME TO generation_tasks_schema13;

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
        model_configuration
      )
      SELECT
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        estimated_cost_microunits, actual_cost_microunits,
        provider_profile_id, provider_model_id, result_asset_id,
        cost_currency, provider_task_id, provider_usage_tokens,
        model_configuration
      FROM generation_tasks_schema13;

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
      FROM generation_task_events_schema13;

      DROP TABLE generation_task_events_schema13;
      DROP TABLE generation_tasks_schema13;

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
    `,
  },
  {
    version: 15,
    name: "exact-provider-generation-attempts",
    sql: `
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
      WITH RECURSIVE historical_attempts (
        task_id,
        execution_attempt,
        provider_profile_id,
        provider_model_id,
        kind,
        created_at,
        maximum_attempt
      ) AS (
        SELECT
          id,
          1,
          provider_profile_id,
          provider_model_id,
          kind,
          updated_at,
          attempt
        FROM generation_tasks
        WHERE
          attempt > 0
          AND provider_profile_id IS NOT NULL
          AND provider_model_id IS NOT NULL
        UNION ALL
        SELECT
          task_id,
          execution_attempt + 1,
          provider_profile_id,
          provider_model_id,
          kind,
          created_at,
          maximum_attempt
        FROM historical_attempts
        WHERE execution_attempt < maximum_attempt
      )
      INSERT INTO generation_provider_attempts (
        task_id,
        execution_attempt,
        provider_profile_id,
        provider_model_id,
        kind,
        evidence,
        created_at
      )
      SELECT
        task_id,
        execution_attempt,
        provider_profile_id,
        provider_model_id,
        kind,
        'historical-execution-attempt',
        created_at
      FROM historical_attempts;
      CREATE INDEX generation_provider_attempts_profile_kind_created
        ON generation_provider_attempts (
          provider_profile_id, kind, created_at DESC, id DESC
        );
      CREATE INDEX generation_provider_attempts_task_created
        ON generation_provider_attempts (task_id, created_at ASC, id ASC);
    `,
  },
  {
    version: 16,
    name: "provider-key-check-status",
    sql: `
      CREATE TABLE IF NOT EXISTS provider_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        driver TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('disabled', 'enabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      ALTER TABLE provider_profiles
        ADD COLUMN key_status TEXT NOT NULL DEFAULT 'unchecked'
        CHECK (key_status IN ('unchecked', 'valid', 'invalid', 'unknown'));
      ALTER TABLE provider_profiles ADD COLUMN key_checked_at TEXT;

      UPDATE provider_profiles
      SET
        key_status = CASE
          WHEN status = 'enabled' THEN 'valid'
          ELSE 'unchecked'
        END,
        key_checked_at = CASE
          WHEN status = 'enabled' THEN updated_at
          ELSE NULL
        END;
    `,
  },
  {
    version: 17,
    name: "provider-read-only-model-catalog",
    sql: `
      ALTER TABLE provider_profiles
        ADD COLUMN catalog_key_status TEXT NOT NULL DEFAULT 'unchecked'
        CHECK (
          catalog_key_status IN (
            'unchecked',
            'valid',
            'invalid',
            'permission',
            'unknown'
          )
        );
      ALTER TABLE provider_profiles ADD COLUMN catalog_checked_at TEXT;
      ALTER TABLE provider_profiles ADD COLUMN catalog_synced_at TEXT;
      ALTER TABLE provider_profiles ADD COLUMN catalog_last_error_code TEXT;
      ALTER TABLE provider_profiles
        ADD COLUMN catalog_models TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(catalog_models));
      ALTER TABLE provider_profiles
        ADD COLUMN catalog_endpoints TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(catalog_endpoints));
      ALTER TABLE provider_profiles
        ADD COLUMN catalog_model_count INTEGER NOT NULL DEFAULT 0
        CHECK (catalog_model_count >= 0);
      ALTER TABLE provider_profiles
        ADD COLUMN catalog_endpoint_count INTEGER NOT NULL DEFAULT 0
        CHECK (catalog_endpoint_count >= 0);
      ALTER TABLE provider_profiles
        ADD COLUMN catalog_control_request_count INTEGER NOT NULL DEFAULT 0
        CHECK (catalog_control_request_count >= 0);
    `,
  },
  {
    version: 18,
    name: "provider-catalog-credential-revision",
    sql: `
      ALTER TABLE provider_profiles
        ADD COLUMN catalog_credential_revision TEXT;
    `,
  },
  {
    version: 19,
    name: "provider-configuration-version",
    sql: `
      ALTER TABLE provider_profiles
        ADD COLUMN provider_configuration_version INTEGER NOT NULL DEFAULT 0
        CHECK (provider_configuration_version >= 0);
    `,
  },
  {
    version: 20,
    name: "provider-catalog-sync-token",
    sql: `
      ALTER TABLE provider_profiles ADD COLUMN catalog_sync_token TEXT;
    `,
  },
  {
    version: 21,
    name: "model-lifecycle-archive-and-snapshots",
    prepare(database) {
      // Some early local backups recorded the model-catalog migration while
      // containing only the media/task subset of that schema. Repair that
      // partial legacy shape before adding lifecycle fields so an unrelated
      // media restore never fails because the optional model tables are absent.
      database.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          login_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
          status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS admin_audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_user_id TEXT NOT NULL,
          action TEXT NOT NULL,
          target_user_id TEXT,
          details TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (actor_user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS admin_audit_actor_created
          ON admin_audit_events (actor_user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS model_profiles (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          provider_profile_id TEXT NOT NULL,
          provider_model_id TEXT NOT NULL,
          capability TEXT NOT NULL CHECK (
            capability IN ('text', 'image', 'video', 'audio')
          ),
          status TEXT NOT NULL CHECK (
            status IN ('draft', 'published', 'disabled')
          ),
          default_parameters TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          max_cost_microunits INTEGER NOT NULL DEFAULT 0
            CHECK (max_cost_microunits BETWEEN 0 AND 100000000),
          cost_currency TEXT NOT NULL DEFAULT 'USD'
            CHECK (cost_currency IN ('USD', 'CNY')),
          FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id)
        );
        CREATE TABLE IF NOT EXISTS node_model_bindings (
          node_type TEXT NOT NULL CHECK (
            node_type IN ('text', 'image', 'video', 'audio')
          ),
          model_id TEXT NOT NULL,
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
          sort_order INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (node_type, model_id),
          FOREIGN KEY (model_id) REFERENCES model_profiles(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS model_profiles_capability_status
          ON model_profiles (capability, status, updated_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS node_model_bindings_one_default
          ON node_model_bindings (node_type)
          WHERE enabled = 1 AND is_default = 1;
        CREATE INDEX IF NOT EXISTS node_model_bindings_order
          ON node_model_bindings (node_type, enabled, sort_order, model_id);
      `);
      const columns = new Set(
        (database.prepare("PRAGMA table_info(model_profiles)").all() as Array<{
          name: string;
        }>).map((column) => column.name),
      );
      if (!columns.has("max_cost_microunits")) {
        database.exec(`
          ALTER TABLE model_profiles
          ADD COLUMN max_cost_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (max_cost_microunits BETWEEN 0 AND 100000000)
        `);
      }
      if (!columns.has("cost_currency")) {
        database.exec(`
          ALTER TABLE model_profiles
          ADD COLUMN cost_currency TEXT NOT NULL DEFAULT 'USD'
          CHECK (cost_currency IN ('USD', 'CNY'))
        `);
      }
      if (!columns.has("archived_at")) {
        database.exec("ALTER TABLE model_profiles ADD COLUMN archived_at TEXT");
      }
      if (!columns.has("published_at")) {
        database.exec("ALTER TABLE model_profiles ADD COLUMN published_at TEXT");
      }
    },
    sql: `
      UPDATE model_profiles
      SET published_at = COALESCE(
        (
          SELECT MIN(admin_audit_events.created_at)
          FROM admin_audit_events
          WHERE
            json_valid(admin_audit_events.details)
            AND json_extract(admin_audit_events.details, '$.modelId') =
              model_profiles.id
            AND json_extract(admin_audit_events.details, '$.status') =
              'published'
        ),
        CASE
          WHEN model_profiles.status = 'published'
          THEN model_profiles.updated_at
          ELSE NULL
        END
      )
      WHERE published_at IS NULL;

      CREATE INDEX IF NOT EXISTS model_profiles_archived_capability
        ON model_profiles (archived_at, capability, status, updated_at DESC);

      CREATE TRIGGER IF NOT EXISTS model_profiles_capture_first_publish_insert
      AFTER INSERT ON model_profiles
      WHEN NEW.status = 'published' AND NEW.published_at IS NULL
      BEGIN
        UPDATE model_profiles
        SET published_at = NEW.updated_at
        WHERE id = NEW.id AND published_at IS NULL;
      END;

      CREATE TRIGGER IF NOT EXISTS model_profiles_capture_first_publish_update
      AFTER UPDATE OF status ON model_profiles
      WHEN NEW.status = 'published' AND NEW.published_at IS NULL
      BEGIN
        UPDATE model_profiles
        SET published_at = NEW.updated_at
        WHERE id = NEW.id AND published_at IS NULL;
      END;

      CREATE TRIGGER IF NOT EXISTS archived_models_cannot_enable_binding_insert
      BEFORE INSERT ON node_model_bindings
      WHEN
        (NEW.enabled = 1 OR NEW.is_default = 1)
        AND EXISTS (
          SELECT 1
          FROM model_profiles
          WHERE id = NEW.model_id AND archived_at IS NOT NULL
        )
      BEGIN
        SELECT RAISE(ABORT, 'archived model binding cannot be enabled');
      END;

      CREATE TRIGGER IF NOT EXISTS archived_models_cannot_enable_binding_update
      BEFORE UPDATE OF enabled, is_default ON node_model_bindings
      WHEN
        (NEW.enabled = 1 OR NEW.is_default = 1)
        AND EXISTS (
          SELECT 1
          FROM model_profiles
          WHERE id = NEW.model_id AND archived_at IS NOT NULL
        )
      BEGIN
        SELECT RAISE(ABORT, 'archived model binding cannot be enabled');
      END;

      UPDATE generation_tasks
      SET model_configuration = json_set(
        model_configuration,
        '$.displayName',
        (
          SELECT model_profiles.display_name
          FROM model_profiles
          WHERE model_profiles.id = generation_tasks.model
        )
      )
      WHERE
        model IS NOT NULL
        AND json_valid(model_configuration)
        AND EXISTS (
          SELECT 1
          FROM model_profiles
          WHERE model_profiles.id = generation_tasks.model
        )
        AND (
          json_type(model_configuration, '$.displayName') IS NULL
          OR (
            json_type(model_configuration, '$.displayName') = 'text'
            AND trim(json_extract(model_configuration, '$.displayName')) = ''
          )
        );

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
    `,
  },
  {
    version: 22,
    name: "provider-model-protocol",
    prepare(database) {
      const columns = new Set(
        (database.prepare("PRAGMA table_info(model_profiles)").all() as Array<{
          name: string;
        }>).map((column) => column.name),
      );
      if (!columns.has("provider_protocol")) {
        database.exec(`
          ALTER TABLE model_profiles
          ADD COLUMN provider_protocol TEXT NOT NULL DEFAULT 'native'
          CHECK (
            provider_protocol IN (
              'native',
              'openai-chat',
              'openai-responses',
              'claude-messages',
              'gemini-generate-content',
              'gpt-image',
              'media-generate'
            )
          )
        `);
      }
    },
    sql: `
      CREATE INDEX IF NOT EXISTS model_profiles_provider_protocol
        ON model_profiles (
          provider_profile_id,
          provider_protocol,
          provider_model_id,
          capability
        );
    `,
  },
  {
    version: 23,
    name: "provider-catalog-diagnostics",
    prepare(database) {
      // Imported/local databases can contain the physical column while their
      // migration ledger still predates it. Reconcile that recoverable shape
      // under the migration write lock instead of replaying ALTER TABLE.
      addColumnIfMissing(
        database,
        "provider_profiles",
        "catalog_diagnostics",
        "TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(catalog_diagnostics))",
      );
    },
    sql: "",
  },
  {
    version: 24,
    name: "canvas-graph-revision",
    prepare(database) {
      addColumnIfMissing(
        database,
        "canvas_documents",
        "graph_revision",
        "INTEGER NOT NULL DEFAULT 0 CHECK (graph_revision >= 0)",
      );
    },
    sql: `
      UPDATE canvas_documents
      SET graph_revision = revision
      WHERE graph_revision = 0 AND revision > 0;
    `,
  },
  {
    version: 25,
    name: "media-asset-dimensions",
    prepare(database) {
      addColumnIfMissing(
        database,
        "media_assets",
        "media_width",
        "INTEGER CHECK (media_width IS NULL OR media_width > 0)",
      );
      addColumnIfMissing(
        database,
        "media_assets",
        "media_height",
        "INTEGER CHECK (media_height IS NULL OR media_height > 0)",
      );
    },
    sql: "",
  },
  {
    version: 26,
    name: "multi-project-workspace",
    prepare(database) {
      addColumnIfMissing(
        database,
        "project_metadata",
        "is_project",
        "INTEGER NOT NULL DEFAULT 0 CHECK (is_project IN (0, 1))",
      );
      addColumnIfMissing(
        database,
        "project_metadata",
        "created_at",
        "INTEGER CHECK (created_at IS NULL OR created_at > 0)",
      );
      addColumnIfMissing(
        database,
        "project_metadata",
        "deleted_at",
        "INTEGER CHECK (deleted_at IS NULL OR deleted_at > 0)",
      );
    },
    sql: `
      UPDATE project_metadata
      SET is_project = 1, created_at = updated_at
      WHERE id = 'default' AND is_project = 0;
    `,
  },
  {
    version: 27,
    name: "global-cost-budget",
    prepare(database) {
      addColumnIfMissing(
        database,
        "generation_safety_settings",
        "single_task_default_cost_cny_microunits",
        "INTEGER NOT NULL DEFAULT 20000000 CHECK (single_task_default_cost_cny_microunits BETWEEN 0 AND 1000000000000)",
      );
      addColumnIfMissing(
        database,
        "generation_safety_settings",
        "usd_to_cny_rate_microunits",
        "INTEGER NOT NULL DEFAULT 7200000 CHECK (usd_to_cny_rate_microunits BETWEEN 10000 AND 1000000000000)",
      );
    },
    sql: "",
  },
  {
    version: 28,
    name: "user-templates",
    sql: `
      CREATE TABLE IF NOT EXISTS user_templates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT,
        graph TEXT NOT NULL,
        cover_asset_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS user_templates_owner_updated
        ON user_templates (owner_id, updated_at DESC);
    `,
  },
  {
    version: 29,
    name: "account-provider-credentials",
    prepare(database) {
      addColumnIfMissing(
        database,
        "generation_provider_attempts",
        "owner_id",
        "TEXT",
      );
    },
    sql: `
      CREATE TABLE IF NOT EXISTS account_provider_credentials (
        account_id TEXT NOT NULL,
        provider_profile_id TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        key_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (
          key_status IN ('unchecked', 'valid', 'invalid', 'unknown')
        ),
        key_checked_at TEXT,
        credential_version INTEGER NOT NULL DEFAULT 1
          CHECK (credential_version >= 1),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, provider_profile_id),
        FOREIGN KEY (account_id) REFERENCES users(id),
        FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id)
      );
      CREATE INDEX IF NOT EXISTS generation_provider_attempts_owner_profile_created
        ON generation_provider_attempts (
          owner_id,
          provider_profile_id,
          created_at DESC
        );
      UPDATE generation_provider_attempts
      SET owner_id = (
        SELECT generation_tasks.owner_id
        FROM generation_tasks
        WHERE generation_tasks.id = generation_provider_attempts.task_id
      )
      WHERE owner_id IS NULL;
    `,
  },
  {
    version: 30,
    name: "account-permissions",
    sql: `
      CREATE TABLE IF NOT EXISTS account_permissions (
        account_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (account_id, permission),
        FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS account_permissions_account
        ON account_permissions (account_id, permission);
    `,
  },
  {
    version: 31,
    name: "public-templates",
    prepare(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS public_templates (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          category TEXT CHECK (category IS NULL OR json_valid(category)),
          graph TEXT NOT NULL,
          cover_asset_id TEXT,
          preview_image TEXT,
          status TEXT NOT NULL DEFAULT 'published'
            CHECK (status IN ('draft', 'published', 'archived')),
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_by TEXT,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          FOREIGN KEY (created_by) REFERENCES users(id),
          FOREIGN KEY (updated_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS public_templates_status_updated
          ON public_templates (status, updated_at DESC);
      `);
      const insert = database.prepare(`
        INSERT OR IGNORE INTO public_templates (
          id, title, description, category, graph, cover_asset_id, preview_image,
          status, created_by, created_at, updated_by, updated_at, archived_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, ?, 'published', NULL, ?, NULL, ?, NULL)
      `);
      const timestamp = new Date().toISOString();
      for (const seed of publicTemplateSeeds) {
        insert.run(
          seed.id,
          seed.title,
          seed.description,
          JSON.stringify(seed.categories),
          JSON.stringify(seed.graph),
          seed.previewImage,
          timestamp,
          timestamp,
        );
      }
    },
    sql: "",
  },
  {
    version: 32,
    name: "public-templates-description",
    prepare(database) {
      // 真实库的 v31 是在迁移开发中途被开发服务热重载写入的，缺少 description 列；
      // 本迁移幂等补齐，保证旧真实库与全新库结构一致。
      addColumnIfMissing(
        database,
        "public_templates",
        "description",
        "TEXT",
      );
    },
    sql: "",
  },
  {
    version: 33,
    name: "generation-safety-concurrency-range",
    sql: `
      CREATE TABLE generation_safety_settings_next (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        global_enabled INTEGER NOT NULL DEFAULT 0
          CHECK (global_enabled IN (0, 1)),
        emergency_stop INTEGER NOT NULL DEFAULT 0
          CHECK (emergency_stop IN (0, 1)),
        per_user_concurrency INTEGER NOT NULL DEFAULT 1
          CHECK (per_user_concurrency BETWEEN 1 AND 1000),
        requests_per_minute INTEGER NOT NULL DEFAULT 3
          CHECK (requests_per_minute BETWEEN 1 AND 1000),
        image_concurrency INTEGER NOT NULL DEFAULT 1
          CHECK (image_concurrency BETWEEN 1 AND 1000),
        video_concurrency INTEGER NOT NULL DEFAULT 1
          CHECK (video_concurrency BETWEEN 1 AND 1000),
        audio_concurrency INTEGER NOT NULL DEFAULT 1
          CHECK (audio_concurrency BETWEEN 1 AND 1000),
        daily_cost_limit_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (daily_cost_limit_microunits BETWEEN 0 AND 1000000000000),
        monthly_cost_limit_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (monthly_cost_limit_microunits BETWEEN 0 AND 10000000000000),
        unknown_cost_policy TEXT NOT NULL DEFAULT 'block'
          CHECK (unknown_cost_policy = 'block'),
        failure_threshold INTEGER NOT NULL DEFAULT 3
          CHECK (failure_threshold BETWEEN 1 AND 20),
        cooldown_minutes INTEGER NOT NULL DEFAULT 30
          CHECK (cooldown_minutes BETWEEN 1 AND 1440),
        running_task_policy TEXT NOT NULL DEFAULT 'wait'
          CHECK (running_task_policy IN ('wait', 'cancel')),
        updated_at TEXT NOT NULL,
        daily_cost_limit_cny_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (daily_cost_limit_cny_microunits BETWEEN 0 AND 1000000000000),
        monthly_cost_limit_cny_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (monthly_cost_limit_cny_microunits BETWEEN 0 AND 10000000000000),
        text_concurrency INTEGER NOT NULL DEFAULT 1
          CHECK (text_concurrency BETWEEN 1 AND 1000),
        single_task_default_cost_cny_microunits INTEGER NOT NULL DEFAULT 20000000
          CHECK (single_task_default_cost_cny_microunits BETWEEN 0 AND 1000000000000),
        usd_to_cny_rate_microunits INTEGER NOT NULL DEFAULT 7200000
          CHECK (usd_to_cny_rate_microunits BETWEEN 10000 AND 1000000000000)
      );
      INSERT INTO generation_safety_settings_next (
        id, global_enabled, emergency_stop, per_user_concurrency,
        requests_per_minute, image_concurrency, video_concurrency,
        audio_concurrency, daily_cost_limit_microunits,
        monthly_cost_limit_microunits, unknown_cost_policy,
        failure_threshold, cooldown_minutes, running_task_policy,
        updated_at, daily_cost_limit_cny_microunits,
        monthly_cost_limit_cny_microunits, text_concurrency,
        single_task_default_cost_cny_microunits, usd_to_cny_rate_microunits
      )
      SELECT
        id, global_enabled, emergency_stop, per_user_concurrency,
        requests_per_minute, image_concurrency, video_concurrency,
        audio_concurrency, daily_cost_limit_microunits,
        monthly_cost_limit_microunits, unknown_cost_policy,
        failure_threshold, cooldown_minutes, running_task_policy,
        updated_at, daily_cost_limit_cny_microunits,
        monthly_cost_limit_cny_microunits, text_concurrency,
        single_task_default_cost_cny_microunits, usd_to_cny_rate_microunits
      FROM generation_safety_settings;
      DROP TABLE generation_safety_settings;
      ALTER TABLE generation_safety_settings_next
        RENAME TO generation_safety_settings;
    `,
  },
  {
    version: 34,
    name: "media-asset-storage-profile",
    prepare(database) {
      // 记录每个 OSS 素材所属的存储配置，防止以后更换正式配置后旧素材按新桶签名而失读。
      addColumnIfMissing(
        database,
        "media_assets",
        "storage_profile_id",
        "TEXT",
      );
    },
    sql: "",
  },
];

export const currentSchemaVersion = migrations.at(-1)?.version ?? 0;

export function appDataDirectory() {
  return process.env.UNBOUNDRY_DATA_DIR ?? join(process.cwd(), "data");
}

function fileSha256(path: string) {
  const hash = createHash("sha256");
  const handle = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(64 * 1_024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    closeSync(handle);
  }
  return hash.digest("hex");
}

function backfillLocalMediaChecksums(
  database: DatabaseSync,
  dataDirectory: string,
) {
  const rows = database
    .prepare(`
      SELECT kind, id, storage_name
      FROM media_assets
      WHERE
        storage_backend = 'local'
        AND storage_status = 'ready'
        AND checksum_sha256 IS NULL
    `)
    .all() as Array<{ id: string; kind: string; storage_name: string }>;
  if (!rows.length) return;
  const update = database.prepare(`
    UPDATE media_assets
    SET checksum_sha256 = ?, updated_at = ?
    WHERE kind = ? AND id = ? AND checksum_sha256 IS NULL
  `);
  const timestamp = new Date().toISOString();
  for (const row of rows) {
    if (basename(row.storage_name) !== row.storage_name) continue;
    try {
      update.run(
        fileSha256(join(dataDirectory, "media", row.storage_name)),
        timestamp,
        row.kind,
        row.id,
      );
    } catch {
      // Missing legacy files remain visible as unverified instead of blocking boot.
    }
  }
}

function trustedDurationFromFile(path: string) {
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1_024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
      windowsHide: true,
    },
  );
  const durationSeconds = Number(output.trim());
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 7 * 24 * 60 * 60
  ) {
    throw new Error("Invalid media duration");
  }
  return Math.round(durationSeconds * 1_000) / 1_000;
}

function backfillTrustedMediaDurations(
  database: DatabaseSync,
  dataDirectory: string,
) {
  const update = database.prepare(`
    UPDATE media_assets
    SET duration_seconds = ?, duration_source = ?, duration_status = 'ready'
    WHERE kind = ? AND id = ? AND duration_status = 'pending'
  `);

  const generatedVideos = database.prepare(`
    SELECT media_assets.id, generation_tasks.parameters
    FROM media_assets
    JOIN generation_tasks
      ON generation_tasks.result_asset_id = media_assets.id
      AND generation_tasks.kind = 'video'
      AND generation_tasks.state = 'success'
    WHERE
      media_assets.kind = 'video'
      AND media_assets.duration_status = 'pending'
    ORDER BY generation_tasks.updated_at DESC
  `).all() as Array<{ id: string; parameters: string }>;
  const updatedGenerated = new Set<string>();
  for (const row of generatedVideos) {
    if (updatedGenerated.has(row.id)) continue;
    try {
      const parameters = JSON.parse(row.parameters) as Record<string, unknown>;
      const durationSeconds = Number(parameters.duration);
      if (
        !Number.isInteger(durationSeconds) ||
        durationSeconds < 2 ||
        durationSeconds > 15
      ) continue;
      if (update.run(durationSeconds, "provider-task", "video", row.id).changes) {
        updatedGenerated.add(row.id);
      }
    } catch {
      // Historical tasks without a validated duration remain pending below.
    }
  }

  const localRows = database.prepare(`
    SELECT kind, id, storage_name
    FROM media_assets
    WHERE
      kind IN ('video', 'audio')
      AND storage_backend = 'local'
      AND storage_status = 'ready'
      AND duration_status = 'pending'
  `).all() as Array<{ id: string; kind: "audio" | "video"; storage_name: string }>;
  const failed = database.prepare(`
    UPDATE media_assets
    SET duration_seconds = NULL, duration_source = NULL, duration_status = 'failed'
    WHERE kind = ? AND id = ? AND duration_status = 'pending'
  `);
  for (const row of localRows) {
    if (basename(row.storage_name) !== row.storage_name) {
      failed.run(row.kind, row.id);
      continue;
    }
    try {
      update.run(
        trustedDurationFromFile(join(dataDirectory, "media", row.storage_name)),
        "server-probe",
        row.kind,
        row.id,
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        // Do not permanently mark metadata failed when ffprobe is unavailable.
        return;
      }
      failed.run(row.kind, row.id);
    }
  }
}

export function openAppDatabase(dataDirectory = appDataDirectory()) {
  mkdirSync(dataDirectory, { recursive: true });
  const database = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"), {
    timeout: 5_000,
  });
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  let migrationTransactionOpen = false;
  try {
    // Lock the whole migration plan before reading its ledger. A second OS
    // process waits here, then observes the first process's committed plan;
    // it can never act on a pre-lock schema snapshot or see a partial version
    // sequence.
    database.exec("BEGIN IMMEDIATE");
    migrationTransactionOpen = true;

    const appliedRows = database
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as Array<{ name: string; version: number }>;
    const knownVersions = new Map(
      migrations.map(({ name, version }) => [version, name]),
    );
    for (const row of appliedRows) {
      if (knownVersions.get(row.version) !== row.name) {
        throw new Error(`Unknown database migration ${row.version}:${row.name}`);
      }
    }

    const appliedVersions = new Set(appliedRows.map(({ version }) => version));
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      migration.prepare?.(database);
      database.exec(migration.sql);
      database
        .prepare(`
          INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (?, ?, ?)
        `)
        .run(migration.version, migration.name, new Date().toISOString());
    }
    database.exec(`PRAGMA user_version = ${currentSchemaVersion}`);
    database.exec("COMMIT");
    migrationTransactionOpen = false;
  } catch (error) {
    if (migrationTransactionOpen) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the migration failure; close() below releases any lock even
        // when SQLite has already rolled the transaction back internally.
      }
    }
    database.close();
    throw error;
  }

  backfillLocalMediaChecksums(database, dataDirectory);
  backfillTrustedMediaDurations(database, dataDirectory);
  return database;
}
