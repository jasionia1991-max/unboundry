import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fileConstants,
  fchmodSync,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
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
  {
    version: 35,
    name: "account-consumption-limits",
    sql: `
      CREATE TABLE IF NOT EXISTS account_consumption_limits (
        owner_id TEXT PRIMARY KEY,
        daily_cost_limit_cny_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (daily_cost_limit_cny_microunits BETWEEN 0 AND 1000000000000),
        monthly_cost_limit_cny_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (monthly_cost_limit_cny_microunits BETWEEN 0 AND 10000000000000),
        daily_cost_limit_usd_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (daily_cost_limit_usd_microunits BETWEEN 0 AND 1000000000000),
        monthly_cost_limit_usd_microunits INTEGER NOT NULL DEFAULT 0
          CHECK (monthly_cost_limit_usd_microunits BETWEEN 0 AND 10000000000000),
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      );
      UPDATE project_metadata
      SET title = '默认画布'
      WHERE
        id = 'default'
        AND is_project = 0
        AND deleted_at IS NULL
        AND title LIKE '%TapNow%';
    `,
  },
  {
    version: 36,
    name: "remove-generation-cost-limits",
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
        failure_threshold INTEGER NOT NULL DEFAULT 3
          CHECK (failure_threshold BETWEEN 1 AND 20),
        cooldown_minutes INTEGER NOT NULL DEFAULT 30
          CHECK (cooldown_minutes BETWEEN 1 AND 1440),
        running_task_policy TEXT NOT NULL DEFAULT 'wait'
          CHECK (running_task_policy IN ('wait', 'cancel')),
        updated_at TEXT NOT NULL,
        text_concurrency INTEGER NOT NULL DEFAULT 1
          CHECK (text_concurrency BETWEEN 1 AND 1000)
      );
      INSERT INTO generation_safety_settings_next (
        id, global_enabled, emergency_stop, per_user_concurrency,
        requests_per_minute, image_concurrency, video_concurrency,
        audio_concurrency, failure_threshold, cooldown_minutes,
        running_task_policy, updated_at, text_concurrency
      )
      SELECT
        id, global_enabled, emergency_stop, per_user_concurrency,
        requests_per_minute, image_concurrency, video_concurrency,
        audio_concurrency, failure_threshold, cooldown_minutes,
        running_task_policy, updated_at, text_concurrency
      FROM generation_safety_settings;
      DROP TABLE generation_safety_settings;
      ALTER TABLE generation_safety_settings_next
        RENAME TO generation_safety_settings;
      DROP TABLE IF EXISTS account_consumption_limits;
    `,
  },
  {
    version: 37,
    name: "protected-root-admin",
    sql: `
      ALTER TABLE users
        ADD COLUMN protected INTEGER NOT NULL DEFAULT 0
        CHECK (protected IN (0, 1));
      UPDATE users
      SET protected = 1
      WHERE id = (
        SELECT id
        FROM users
        WHERE role = 'admin' AND status = 'active'
        ORDER BY created_at ASC, rowid ASC
        LIMIT 1
      );
    `,
  },
  {
    version: 38,
    name: "durable-media-publications",
    sql: `
      CREATE TABLE media_delete_intents (
        owner_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
        asset_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'tombstone' CHECK (
          state IN ('tombstone', 'delete-requested', 'delete-failed')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, kind, asset_id),
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE account_delete_intents (
        owner_id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('running', 'failed')),
        error_code TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
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
      CREATE TRIGGER account_delete_guard_user_template_insert
        BEFORE INSERT ON user_templates
        WHEN EXISTS (
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = NEW.owner_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'account deletion blocks template mutation');
      END;
      CREATE TRIGGER account_delete_guard_user_template_owner_update
        BEFORE UPDATE OF owner_id ON user_templates
        WHEN EXISTS (
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = NEW.owner_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'account deletion blocks template mutation');
      END;
      CREATE TRIGGER account_delete_guard_public_template_insert
        BEFORE INSERT ON public_templates
        WHEN EXISTS (
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = NEW.created_by OR owner_id = NEW.updated_by
        )
      BEGIN
        SELECT RAISE(ABORT, 'account deletion blocks template mutation');
      END;
      CREATE TRIGGER account_delete_guard_public_template_actor_update
        BEFORE UPDATE OF created_by, updated_by ON public_templates
        WHEN EXISTS (
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = NEW.created_by OR owner_id = NEW.updated_by
        )
      BEGIN
        SELECT RAISE(ABORT, 'account deletion blocks template mutation');
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
      CREATE TRIGGER account_delete_guard_session_insert
        BEFORE INSERT ON sessions
        WHEN EXISTS (
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = NEW.user_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'account deletion blocks session creation');
      END;
      CREATE TRIGGER account_delete_guard_user_reactivation
        BEFORE UPDATE OF status ON users
        WHEN NEW.status = 'active' AND EXISTS (
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = NEW.id
        )
      BEGIN
        SELECT RAISE(ABORT, 'account deletion blocks user reactivation');
      END;
    `,
  },
  {
    version: 39,
    name: "atomic-generation-admission-and-credential-scope",
    sql: `
      CREATE TABLE account_provider_credential_epochs (
        account_id TEXT NOT NULL,
        provider_profile_id TEXT NOT NULL,
        credential_revision INTEGER NOT NULL CHECK (credential_revision >= 1),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, provider_profile_id),
        FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id)
          ON DELETE CASCADE
      );
      INSERT INTO account_provider_credential_epochs (
        account_id, provider_profile_id, credential_revision, updated_at
      )
      WITH task_credential_revision_candidates AS (
        SELECT
          tasks.owner_id AS account_id,
          tasks.provider_profile_id,
          CASE
            WHEN json_valid(tasks.model_configuration) THEN
              CASE
                WHEN
                  json_type(
                    tasks.model_configuration,
                    '$.credentialVersion'
                  ) = 'integer'
                  AND json_extract(
                    tasks.model_configuration,
                    '$.credentialVersion'
                  ) BETWEEN 1 AND 9007199254740991
                THEN CAST(
                  json_extract(
                    tasks.model_configuration,
                    '$.credentialVersion'
                  ) AS INTEGER
                )
                ELSE NULL
              END
            ELSE NULL
          END AS credential_revision
        FROM generation_tasks AS tasks
        JOIN users AS owners ON owners.id = tasks.owner_id
        JOIN provider_profiles AS profiles
          ON profiles.id = tasks.provider_profile_id
        WHERE
          tasks.owner_id IS NOT NULL
          AND tasks.provider_profile_id IS NOT NULL
      ),
      credential_revision_candidates AS (
        SELECT
          account_id,
          provider_profile_id,
          credential_version AS credential_revision
        FROM account_provider_credentials
        UNION ALL
        SELECT
          account_id,
          provider_profile_id,
          credential_revision
        FROM task_credential_revision_candidates
        WHERE credential_revision IS NOT NULL
      )
      SELECT
        account_id,
        provider_profile_id,
        MAX(credential_revision),
        '1970-01-01T00:00:00.000Z'
      FROM credential_revision_candidates
      GROUP BY account_id, provider_profile_id;

      CREATE TEMP TABLE generation_ledger_sequences_schema38 (
        name TEXT PRIMARY KEY,
        seq INTEGER NOT NULL
      );
      INSERT INTO generation_ledger_sequences_schema38 (name, seq)
      SELECT name, seq
      FROM sqlite_sequence
      WHERE name IN ('generation_task_events', 'generation_provider_attempts');

      DROP TRIGGER generation_tasks_capture_model_display_name;
      DROP TRIGGER media_publication_guard_task_delete;
      DROP TRIGGER media_publication_guard_owner_delete;
      DROP TRIGGER account_delete_guard_generation_task_insert;
      DROP TRIGGER account_delete_guard_generation_task_activation;

      ALTER TABLE generation_task_events
        RENAME TO generation_task_events_schema38;
      ALTER TABLE generation_provider_attempts
        RENAME TO generation_provider_attempts_schema38;
      ALTER TABLE media_publication_attempts
        RENAME TO media_publication_attempts_schema38;
      ALTER TABLE generation_tasks
        RENAME TO generation_tasks_schema38;

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
        credential_revision INTEGER NOT NULL DEFAULT 0 CHECK (
          credential_revision >= 0
        )
      );
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        estimated_cost_microunits, actual_cost_microunits,
        provider_profile_id, provider_model_id, result_asset_id,
        cost_currency, provider_task_id, provider_usage_tokens,
        model_configuration, result_text, credential_revision
      )
      SELECT
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        estimated_cost_microunits, actual_cost_microunits,
        provider_profile_id, provider_model_id, result_asset_id,
        cost_currency, provider_task_id, provider_usage_tokens,
        model_configuration, result_text,
        CASE
          WHEN json_valid(model_configuration) THEN
            CASE
              WHEN
                json_type(model_configuration, '$.credentialVersion') = 'integer'
                AND json_extract(
                  model_configuration,
                  '$.credentialVersion'
                ) BETWEEN 1 AND 9007199254740991
              THEN json_extract(model_configuration, '$.credentialVersion')
              ELSE 0
            END
          ELSE 0
        END
      FROM generation_tasks_schema38;

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
      INSERT INTO generation_task_events (
        id, task_id, state, error_code, error_message, created_at
      )
      SELECT id, task_id, state, error_code, error_message, created_at
      FROM generation_task_events_schema38;

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
        owner_id TEXT,
        credential_revision INTEGER NOT NULL DEFAULT 0 CHECK (
          credential_revision >= 0
        ),
        outcome TEXT NOT NULL CHECK (
          outcome IN (
            'boundary-claimed', 'definitive-rejected', 'accepted',
            'response-received', 'provider-failed', 'completed',
            'outcome-unknown'
          )
        ),
        provider_task_id TEXT,
        failure_code TEXT,
        finished_at TEXT,
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
        UNIQUE (task_id, execution_attempt)
      );
      INSERT INTO generation_provider_attempts (
        id, task_id, execution_attempt, provider_profile_id,
        provider_model_id, kind, evidence, created_at, owner_id,
        credential_revision, outcome, provider_task_id, failure_code,
        finished_at
      )
      WITH associated_attempts AS (
        SELECT
          tasks.id AS task_id,
          COALESCE(
            CASE WHEN tasks.provider_task_id IS NOT NULL THEN (
              SELECT paid.id
              FROM generation_provider_attempts_schema38 AS paid
              WHERE paid.task_id = tasks.id
              ORDER BY paid.execution_attempt DESC, paid.id DESC
              LIMIT 1
            ) END,
            (
              SELECT current_attempt.id
              FROM generation_provider_attempts_schema38 AS current_attempt
              WHERE
                current_attempt.task_id = tasks.id
                AND current_attempt.execution_attempt = tasks.attempt
              ORDER BY current_attempt.id DESC
              LIMIT 1
            )
          ) AS attempt_id
        FROM generation_tasks AS tasks
      )
      SELECT
        attempts.id, attempts.task_id, attempts.execution_attempt,
        attempts.provider_profile_id, attempts.provider_model_id,
        attempts.kind, attempts.evidence, attempts.created_at,
        attempts.owner_id, tasks.credential_revision,
        CASE
          WHEN associated.attempt_id = attempts.id
            AND tasks.state = 'success' THEN 'completed'
          WHEN associated.attempt_id = attempts.id
            AND tasks.error_code = 'PROVIDER_FAILED' THEN 'provider-failed'
          WHEN associated.attempt_id = attempts.id
            AND tasks.provider_task_id IS NOT NULL THEN 'accepted'
          WHEN associated.attempt_id = attempts.id
            AND tasks.error_code IN ('AUTH', 'PERMISSION', 'RATE_LIMIT')
            THEN 'definitive-rejected'
          ELSE 'outcome-unknown'
        END,
        CASE
          WHEN associated.attempt_id = attempts.id
          THEN tasks.provider_task_id
          ELSE NULL
        END,
        CASE
          WHEN associated.attempt_id = attempts.id
            AND tasks.error_code IS NOT NULL THEN tasks.error_code
          ELSE NULL
        END,
        CASE
          WHEN associated.attempt_id = attempts.id
            AND tasks.state IN ('success', 'failed', 'cancelled')
          THEN tasks.updated_at
          ELSE NULL
        END
      FROM generation_provider_attempts_schema38 AS attempts
      JOIN generation_tasks AS tasks ON tasks.id = attempts.task_id
      JOIN associated_attempts AS associated
        ON associated.task_id = attempts.task_id;

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
      FROM media_publication_attempts_schema38;

      DROP TABLE generation_task_events_schema38;
      DROP TABLE generation_provider_attempts_schema38;
      DROP TABLE media_publication_attempts_schema38;
      DROP TABLE generation_tasks_schema38;

      UPDATE sqlite_sequence
      SET seq = MAX(
        seq,
        COALESCE((
          SELECT saved.seq
          FROM generation_ledger_sequences_schema38 AS saved
          WHERE saved.name = sqlite_sequence.name
        ), 0)
      )
      WHERE name IN ('generation_task_events', 'generation_provider_attempts');
      INSERT INTO sqlite_sequence (name, seq)
      SELECT saved.name, saved.seq
      FROM generation_ledger_sequences_schema38 AS saved
      WHERE NOT EXISTS (
        SELECT 1 FROM sqlite_sequence AS current
        WHERE current.name = saved.name
      );
      DROP TABLE generation_ledger_sequences_schema38;

      CREATE UNIQUE INDEX generation_tasks_owner_idempotency
        ON generation_tasks (owner_id, canvas_id, idempotency_key)
        WHERE owner_id IS NOT NULL;
      CREATE UNIQUE INDEX generation_tasks_legacy_idempotency
        ON generation_tasks (canvas_id, idempotency_key)
        WHERE owner_id IS NULL;
      CREATE UNIQUE INDEX generation_tasks_provider_task_owner_credential
        ON generation_tasks (
          owner_id, provider_profile_id, credential_revision, provider_task_id
        )
        WHERE owner_id IS NOT NULL AND provider_task_id IS NOT NULL;
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

      CREATE INDEX generation_task_events_task_created
        ON generation_task_events (task_id, created_at ASC, id ASC);
      CREATE INDEX generation_provider_attempts_profile_kind_created
        ON generation_provider_attempts (
          provider_profile_id, kind, created_at DESC, id DESC
        );
      CREATE INDEX generation_provider_attempts_task_created
        ON generation_provider_attempts (task_id, created_at ASC, id ASC);
      CREATE INDEX generation_provider_attempts_owner_profile_created
        ON generation_provider_attempts (
          owner_id, provider_profile_id, created_at DESC
        );
      CREATE INDEX generation_provider_attempts_circuit
        ON generation_provider_attempts (
          provider_profile_id, kind, finished_at DESC, id DESC
        )
        WHERE outcome IN ('provider-failed', 'completed');

      CREATE UNIQUE INDEX media_publication_attempts_active_asset
        ON media_publication_attempts (kind, asset_id)
        WHERE state IN ('reserved', 'staged', 'external-ready', 'compensating');
      CREATE UNIQUE INDEX media_publication_attempts_active_task
        ON media_publication_attempts (task_id, task_execution_attempt)
        WHERE task_id IS NOT NULL
          AND state IN ('reserved', 'staged', 'external-ready', 'compensating');
      CREATE INDEX media_publication_attempts_owner_state_updated
        ON media_publication_attempts (owner_id, state, updated_at DESC);

      CREATE TABLE generation_admission_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        execution_attempt INTEGER NOT NULL CHECK (execution_attempt >= 1),
        owner_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'video', 'audio')),
        admission_type TEXT NOT NULL CHECK (
          admission_type IN (
            'initial', 'new-paid-retry'
          )
        ),
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
        UNIQUE (task_id, execution_attempt)
      );
      CREATE INDEX generation_admission_events_owner_created
        ON generation_admission_events (owner_id, created_at DESC, id DESC);
      CREATE INDEX generation_admission_events_kind_created
        ON generation_admission_events (kind, created_at DESC, id DESC);

      CREATE TRIGGER generation_tasks_capture_model_display_name
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
    `,
  },
];

export const currentSchemaManifest = Object.freeze(
  migrations.map(({ name, version }) => Object.freeze({ name, version })),
);

export const currentSchemaVersion = currentSchemaManifest.at(-1)?.version ?? 0;

// This is the known-safe physical schema that a v39 process can use. Keep the
// migration ledger as the source of version ordering, and keep the column-name
// checks order-independent so the finite documented v21 catalog repairs and
// v31/v32 template repair can each be admitted only by an exact sqlite_schema
// fingerprint.
export const currentSchemaContract = Object.freeze({
  tables: Object.freeze({
    account_delete_intents: Object.freeze([
      "owner_id", "state", "error_code", "retry_count", "created_at",
      "updated_at",
    ]),
    account_permissions: Object.freeze([
      "account_id", "permission", "granted_by", "created_at",
    ]),
    account_provider_credentials: Object.freeze([
      "account_id", "provider_profile_id", "encrypted_key", "key_status",
      "key_checked_at", "credential_version", "updated_at",
    ]),
    account_provider_credential_epochs: Object.freeze([
      "account_id", "provider_profile_id", "credential_revision", "updated_at",
    ]),
    admin_audit_events: Object.freeze([
      "id", "actor_user_id", "action", "target_user_id", "details",
      "created_at",
    ]),
    asset_history: Object.freeze([
      "account_id", "id", "kind", "label", "preview", "created_at",
      "owner_id",
    ]),
    canvas_documents: Object.freeze([
      "owner_id", "id", "revision", "nodes", "edges", "viewport",
      "updated_at", "save_session_id", "save_sequence", "graph_revision",
    ]),
    generation_admission_events: Object.freeze([
      "id", "task_id", "execution_attempt", "owner_id", "kind",
      "admission_type", "created_at",
    ]),
    generation_provider_attempts: Object.freeze([
      "id", "task_id", "execution_attempt", "provider_profile_id",
      "provider_model_id", "kind", "evidence", "created_at", "owner_id",
      "credential_revision", "outcome", "provider_task_id", "failure_code",
      "finished_at",
    ]),
    generation_safety_settings: Object.freeze([
      "id", "global_enabled", "emergency_stop", "per_user_concurrency",
      "requests_per_minute", "image_concurrency", "video_concurrency",
      "audio_concurrency", "failure_threshold", "cooldown_minutes",
      "running_task_policy", "updated_at", "text_concurrency",
    ]),
    generation_task_events: Object.freeze([
      "id", "task_id", "state", "error_code", "error_message", "created_at",
    ]),
    generation_tasks: Object.freeze([
      "id", "canvas_id", "node_id", "kind", "prompt", "model",
      "parameters", "idempotency_key", "request_fingerprint", "state",
      "attempt", "error_code", "error_message", "created_at", "updated_at",
      "owner_id", "estimated_cost_microunits", "actual_cost_microunits",
      "provider_profile_id", "provider_model_id", "result_asset_id",
      "cost_currency", "provider_task_id", "provider_usage_tokens",
      "model_configuration", "result_text", "credential_revision",
    ]),
    media_assets: Object.freeze([
      "kind", "id", "owner_id", "storage_name", "byte_size", "created_at",
      "updated_at", "storage_backend", "object_key", "content_type",
      "checksum_sha256", "storage_status", "duration_seconds",
      "duration_source", "duration_status", "media_width", "media_height",
      "storage_profile_id",
    ]),
    media_delete_intents: Object.freeze([
      "owner_id", "kind", "asset_id", "state", "created_at", "updated_at",
    ]),
    media_publication_attempts: Object.freeze([
      "attempt_id", "owner_id", "kind", "asset_id", "source", "state",
      "storage_backend", "final_storage_name", "object_key",
      "storage_profile_id", "staging_name", "task_id",
      "task_execution_attempt", "history_label", "byte_size",
      "checksum_sha256", "content_type", "duration_seconds",
      "duration_source", "media_width", "media_height",
      "actual_cost_microunits", "provider_usage_tokens", "error_code",
      "retry_count", "adopted_at", "adopted_canvas_id", "created_at",
      "updated_at",
    ]),
    model_profiles: Object.freeze([
      "id", "display_name", "provider_profile_id", "provider_model_id",
      "capability", "status", "default_parameters", "created_at",
      "updated_at", "max_cost_microunits", "cost_currency", "archived_at",
      "published_at", "provider_protocol",
    ]),
    node_model_bindings: Object.freeze([
      "node_type", "model_id", "enabled", "is_default", "sort_order",
      "created_at", "updated_at",
    ]),
    project_metadata: Object.freeze([
      "owner_id", "id", "title", "updated_at", "is_project", "created_at",
      "deleted_at",
    ]),
    provider_profiles: Object.freeze([
      "id", "display_name", "driver", "status", "created_at", "updated_at",
      "key_status", "key_checked_at", "catalog_key_status",
      "catalog_checked_at", "catalog_synced_at", "catalog_last_error_code",
      "catalog_models", "catalog_endpoints", "catalog_model_count",
      "catalog_endpoint_count", "catalog_control_request_count",
      "catalog_credential_revision", "provider_configuration_version",
      "catalog_sync_token", "catalog_diagnostics",
    ]),
    public_templates: Object.freeze([
      "id", "title", "description", "category", "graph", "cover_asset_id",
      "preview_image", "status", "created_by", "created_at", "updated_by",
      "updated_at", "archived_at",
    ]),
    schema_migrations: Object.freeze(["version", "name", "applied_at"]),
    sessions: Object.freeze([
      "id", "token_hash", "user_id", "expires_at", "created_at",
      "last_seen_at",
    ]),
    user_templates: Object.freeze([
      "id", "owner_id", "title", "category", "graph", "cover_asset_id",
      "created_at", "updated_at",
    ]),
    users: Object.freeze([
      "id", "login_name", "display_name", "password_hash", "role", "status",
      "created_at", "updated_at", "protected",
    ]),
  }),
  indexes: Object.freeze({
    generation_tasks_legacy_idempotency: Object.freeze({
      columns: Object.freeze(["canvas_id", "idempotency_key"]),
      partial: true,
      sqlHash: "b6e62cc0af2bea5ca38f4ef7d498d45ddc8c29c2ff6b5f2ebeb8966a9e02269b",
      table: "generation_tasks",
      unique: true,
    }),
    generation_tasks_owner_idempotency: Object.freeze({
      columns: Object.freeze(["owner_id", "canvas_id", "idempotency_key"]),
      partial: true,
      sqlHash: "59c513a4caa00328f6e795acb2b6083daf4c8ebd61cc74a755faffb53eb0d573",
      table: "generation_tasks",
      unique: true,
    }),
    generation_tasks_provider_task_owner_credential: Object.freeze({
      columns: Object.freeze([
        "owner_id", "provider_profile_id", "credential_revision",
        "provider_task_id",
      ]),
      partial: true,
      sqlHash: "8492fb34e9d939311a870fba18caa77151a6ab9b6b193d8b8e97c3e00c6ddfb2",
      table: "generation_tasks",
      unique: true,
    }),
    media_assets_backend_object_key: Object.freeze({
      columns: Object.freeze(["storage_backend", "object_key"]),
      partial: true,
      sqlHash: "ada21d8be6bd9e005155da7cd938901f2da5991b6defa42b5e718b1986f9a789",
      table: "media_assets",
      unique: true,
    }),
    media_publication_attempts_active_asset: Object.freeze({
      columns: Object.freeze(["kind", "asset_id"]),
      partial: true,
      sqlHash: "9a973fcbbcee9321f4b993114de33ea6b1eb7a642056bfa38bee8ba62a462448",
      table: "media_publication_attempts",
      unique: true,
    }),
    media_publication_attempts_active_task: Object.freeze({
      columns: Object.freeze(["task_id", "task_execution_attempt"]),
      partial: true,
      sqlHash: "a93727e31eda4fe8aae75d20f877bd45a745cfba606936870fa7b06bc9f693fe",
      table: "media_publication_attempts",
      unique: true,
    }),
    node_model_bindings_one_default: Object.freeze({
      columns: Object.freeze(["node_type"]),
      partial: true,
      sqlHash: "82c0cf67eb17beea7e63586c25c836f403362c3059d4b8957a502f44370631f9",
      table: "node_model_bindings",
      unique: true,
    }),
  }),
  explicitIndexes: Object.freeze({
    account_permissions_account: Object.freeze({
      sqlHash: "667457c5faa9dfb027030e9ca7a60318d696b44775a6b7b687511734c290e864",
      table: "account_permissions",
    }),
    admin_audit_actor_created: Object.freeze({
      acceptedSqlHashes: Object.freeze([
        "96af96d20bc9bd30cd0edee0c9d6f065b4de5241893891c5b31dfe5723d60669",
        "8804ecb45ddfbc8cf9e670190989bd3a64b7dce1a579753cb26f454e5f0fc0be",
      ]),
      sqlHash: "96af96d20bc9bd30cd0edee0c9d6f065b4de5241893891c5b31dfe5723d60669",
      table: "admin_audit_events",
    }),
    asset_history_owner_created: Object.freeze({
      sqlHash: "8530ea7ce975418d08fb4ad4c8ef50bae408641ca5748b84bd5df7502d56e5d2",
      table: "asset_history",
    }),
    canvas_documents_owner_updated: Object.freeze({
      sqlHash: "c49d60c37be7eb32471b6a5256226ee2010cf180bd4b547f36e60a503fc7df80",
      table: "canvas_documents",
    }),
    generation_admission_events_kind_created: Object.freeze({
      sqlHash: "519d8bdf6e603abc65cb2b476d47313d0282206db8a63ed3e9f2c0b5a367db7b",
      table: "generation_admission_events",
    }),
    generation_admission_events_owner_created: Object.freeze({
      sqlHash: "0e72c7320ba2fdff1e09b88392ef2de1c2389357b98534cce4f60d54ff662e38",
      table: "generation_admission_events",
    }),
    generation_provider_attempts_circuit: Object.freeze({
      sqlHash: "288d95b6e8e6beb8f46cfeb385725d5c45084886bba1f3afba8ae190139cec0e",
      table: "generation_provider_attempts",
    }),
    generation_provider_attempts_owner_profile_created: Object.freeze({
      sqlHash: "081e929882ef4fc6682e9d1432d3e691c96e60e212dbe12473128595ab93a762",
      table: "generation_provider_attempts",
    }),
    generation_provider_attempts_profile_kind_created: Object.freeze({
      sqlHash: "16b559cf338f977ca119dddb8a97c090e67e68f5eb494cc7f1ec86176e27d65a",
      table: "generation_provider_attempts",
    }),
    generation_provider_attempts_task_created: Object.freeze({
      sqlHash: "2b48b857158465de8155dac5d69aeff3ac50daf44a3cef06dbaa0c4c799d8c7f",
      table: "generation_provider_attempts",
    }),
    generation_task_events_task_created: Object.freeze({
      sqlHash: "20ee2bfe83616ee3f69c391c65a4d1831b713084000303417695df4c09ae7529",
      table: "generation_task_events",
    }),
    generation_tasks_canvas_updated: Object.freeze({
      sqlHash: "0f449e39429ad05e27054e89b480dfec111b1ffb213baf409e5d3e2e9b35dad8",
      table: "generation_tasks",
    }),
    generation_tasks_currency_created: Object.freeze({
      sqlHash: "a5cd31190264ecac91713ef770c9fce1b850fdc7577537fd5135d732f1d8ca39",
      table: "generation_tasks",
    }),
    generation_tasks_owner_canvas_updated: Object.freeze({
      sqlHash: "1a733ae3056e8235e4ee492f83c448aefcdaf1caa92c7a9170f1afd4b6d36842",
      table: "generation_tasks",
    }),
    generation_tasks_owner_state_created: Object.freeze({
      sqlHash: "4ccaf8c1a22e10bb6f03ff9c03782f2050ac1048569b774858ed3ead42363fd0",
      table: "generation_tasks",
    }),
    generation_tasks_legacy_idempotency: Object.freeze({
      sqlHash: "b6e62cc0af2bea5ca38f4ef7d498d45ddc8c29c2ff6b5f2ebeb8966a9e02269b",
      table: "generation_tasks",
    }),
    generation_tasks_owner_idempotency: Object.freeze({
      sqlHash: "59c513a4caa00328f6e795acb2b6083daf4c8ebd61cc74a755faffb53eb0d573",
      table: "generation_tasks",
    }),
    generation_tasks_provider_task_owner_credential: Object.freeze({
      sqlHash: "8492fb34e9d939311a870fba18caa77151a6ab9b6b193d8b8e97c3e00c6ddfb2",
      table: "generation_tasks",
    }),
    generation_tasks_result_asset: Object.freeze({
      sqlHash: "7ad17024f45755bc24df2eeb3bf4a9c47225e8d96f83c4ab7dd90f1555c36f45",
      table: "generation_tasks",
    }),
    media_assets_backend_object_key: Object.freeze({
      sqlHash: "ada21d8be6bd9e005155da7cd938901f2da5991b6defa42b5e718b1986f9a789",
      table: "media_assets",
    }),
    media_assets_owner_created: Object.freeze({
      sqlHash: "566cfd24a9bdf80384f08b4544a0d7d2cb86a00e73f94b5d214188776f34460f",
      table: "media_assets",
    }),
    media_assets_owner_storage: Object.freeze({
      sqlHash: "795bdfac70e907fe1ff5201fcdb84a5dc9cd75ad80b4b946b4b651312f039549",
      table: "media_assets",
    }),
    media_publication_attempts_active_asset: Object.freeze({
      sqlHash: "9a973fcbbcee9321f4b993114de33ea6b1eb7a642056bfa38bee8ba62a462448",
      table: "media_publication_attempts",
    }),
    media_publication_attempts_active_task: Object.freeze({
      sqlHash: "a93727e31eda4fe8aae75d20f877bd45a745cfba606936870fa7b06bc9f693fe",
      table: "media_publication_attempts",
    }),
    media_publication_attempts_owner_state_updated: Object.freeze({
      sqlHash: "46179b75c9f60cc6a26c99490586904ef5b3b2b168b1d89c0712adca868afeb9",
      table: "media_publication_attempts",
    }),
    model_profiles_archived_capability: Object.freeze({
      sqlHash: "04aa10e58830c898de1f6c8e20951dd33efda140ab73b457da9c8ff3c87ac47e",
      table: "model_profiles",
    }),
    model_profiles_capability_status: Object.freeze({
      acceptedSqlHashes: Object.freeze([
        "0c604faba324c65236374c4d557a600beabc53551f45a286b24897af19544c22",
        "3416b5cb3fb2e1aeef9c518a96326675ce08d9387f7f48242c6f04b598209b62",
      ]),
      sqlHash: "0c604faba324c65236374c4d557a600beabc53551f45a286b24897af19544c22",
      table: "model_profiles",
    }),
    model_profiles_provider_protocol: Object.freeze({
      sqlHash: "0da6e04e559ca0cefc0c09d023a5eb022b025d251464af78ab2c42fd27a1ee4a",
      table: "model_profiles",
    }),
    node_model_bindings_one_default: Object.freeze({
      acceptedSqlHashes: Object.freeze([
        "82c0cf67eb17beea7e63586c25c836f403362c3059d4b8957a502f44370631f9",
        "21849a735c41aae7fdec38122d29146846d9030a1f170e7a699cd01f81348665",
      ]),
      sqlHash: "82c0cf67eb17beea7e63586c25c836f403362c3059d4b8957a502f44370631f9",
      table: "node_model_bindings",
    }),
    node_model_bindings_order: Object.freeze({
      acceptedSqlHashes: Object.freeze([
        "c6bf5c70659e14f4d413aa98c610116751c4a80972070c78b535088432907e81",
        "4fbb934ed2d70e76a115ae56b06457028b92b7bb44ec4855a0395940ca35ce26",
      ]),
      sqlHash: "c6bf5c70659e14f4d413aa98c610116751c4a80972070c78b535088432907e81",
      table: "node_model_bindings",
    }),
    project_metadata_owner_updated: Object.freeze({
      sqlHash: "1b5d9c2ac1f179e9728351fedaf1519a8b8d1509afccf71b7357dd7c148e6612",
      table: "project_metadata",
    }),
    public_templates_status_updated: Object.freeze({
      sqlHash: "95ad36824c8d49f4b53c97a66fc36fe34c1b194d2c189722a8399968ab101f5a",
      table: "public_templates",
    }),
    sessions_user_expires: Object.freeze({
      sqlHash: "e52358562e4cccce65828dbe358431c188e35ba2204cc4c0e53d9649cb68beb4",
      table: "sessions",
    }),
    user_templates_owner_updated: Object.freeze({
      sqlHash: "451f2da493e6b738635ed059b645d2899e9b873e2802e893201de3a53e66bd68",
      table: "user_templates",
    }),
    users_status_role: Object.freeze({
      sqlHash: "57a909e3331fd64620bb5264305aafa1b16b0b9f91df06889d32bafe0e65b52c",
      table: "users",
    }),
  }),
  // The documented v21 partial-backup repair creates users but did not create
  // this non-unique lookup index. Permit that performance-only omission only
  // when the users table itself has the exact v21-repair fingerprint; a fresh
  // users table must still have the complete canonical index set.
  conditionallyOptionalExplicitIndexes: Object.freeze({
    users_status_role: Object.freeze({
      table: "users",
      tableSqlHash:
        "80159c4cbfb80a7ef8071d04ed65acd127b62d6c434289a1b713a91cc81d7205",
    }),
  }),
  // Hashes cover the exact sqlite_schema SQL text. This deliberately fails
  // closed instead of maintaining a partial SQL lexer whose whitespace or
  // quoting rules could merge semantically different declarations.
  // public_templates permits the fresh and known v31-to-v32 repair shapes.
  // The v21 catalog repair and its exact missing-cost-column outcomes are the
  // only other admitted variants; unknown imported DDL remains fail-closed.
  tableSqlHashes: Object.freeze({
    account_delete_intents: Object.freeze([
      "b24c9a531de8f5b8e19cf0042844cdde333fc3bbcb6be9fd5834569495603506",
    ]),
    account_permissions: Object.freeze([
      "b56c6c726385ab6f9020a6d6133c5ca90fa69c0b04cd73d03cd6aee3c6eff155",
    ]),
    account_provider_credentials: Object.freeze([
      "4542efd2209893278fd8bcb73760848fa61e252ca15d0d5f526e5672dbda32cb",
    ]),
    account_provider_credential_epochs: Object.freeze([
      "c12d09e4ec04cc600751be13908d39db96da082d101aea4e0162c956781a17f9",
    ]),
    admin_audit_events: Object.freeze([
      "82e604628c4a2ce90c37ad6cba7f5d82fb71e6a21703d361bb03bf980730c0ce",
      "9b5cd05337e0787660d20beabbd57e55ae0384618304e74ec60410adccfe98ab",
    ]),
    asset_history: Object.freeze([
      "700ecc72764b59b1bcd84eb921cab728e5f66e8c4f2affd70a41e6a51aade6c6",
    ]),
    canvas_documents: Object.freeze([
      "c1513fd4d7a98acd1826e952f442877b40f8395a8052b15e85479559da0cefdf",
    ]),
    generation_admission_events: Object.freeze([
      "8362b1eb7fc4f3c513b74e51f3d29423382efaaac1eca8f3da8053de3553d86f",
    ]),
    generation_provider_attempts: Object.freeze([
      "ffd55e9a53fa99988acd831f01c34455af42ef4b9a4132597412718ff581af25",
    ]),
    generation_safety_settings: Object.freeze([
      "f40be7744655d146b2ecd0f8897b024d98a1db94a39284e53cc27d40ba9bc38c",
    ]),
    generation_task_events: Object.freeze([
      "7453ccc55754e39777e76119214bb9c98c6d9587ce2b73d55a11823cf20de2c9",
    ]),
    generation_tasks: Object.freeze([
      "34a5d6e841bb07800c51a7f53c3016d98c3128580aa85f1d18006748cb13ee1d",
    ]),
    media_assets: Object.freeze([
      "cedbe47b7f996d78b4a03b8e9ec75bf08853aa2539932ad1dad657b1c47c115c",
    ]),
    media_delete_intents: Object.freeze([
      "11ec2869f50bb802e8ee1cfe0cc728a4650b197195c3345a48c638f838ad1cea",
    ]),
    media_publication_attempts: Object.freeze([
      "b6ec4ac1cb1db8bce63ff1cf839103d070ea77119698f4df67907a850ab09ca3",
    ]),
    model_profiles: Object.freeze([
      "b649651de07c626a927f2184dca573844256ee3208f3b660ba36887200e11a66",
      "2ee6b6c2ee53a4106b66c19fe179292d6d55ec7feeed227eda8a1498c07ea090",
      "aabb891e26289960f0e414649d2e6f80393ffd773693cb96e3eb44d0ad716632",
      "c8d3c009843c0d1f41f12750eb52240a1ca268fb1e3ec4f3aeee8d78d49ca93e",
      "d616105a3a22b6c20bf6fdd57486dbd479e111a6e5cd940b13d1282ea48729be",
    ]),
    node_model_bindings: Object.freeze([
      "300aa2ced2205b3cd0ed723a00a604917f68603feb31ecbd12529fdd39784553",
      "7c3c7e2f42885cd3ce92c2284761bbcb99715d8f9eafe8cd575002a5a894f35a",
    ]),
    project_metadata: Object.freeze([
      "343804fcd2f4d99f4acab95c0e604bab64efd1f09c0a5ebb0e9df0347d14511e",
    ]),
    provider_profiles: Object.freeze([
      "5a123ee9694b90e7bfb5cd43bcb4df3b00a367ac25974f48052068b178085809",
    ]),
    public_templates: Object.freeze([
      "dbe59ae26271823809c64e9acc2cbac41c2873de127723d746b5c3335f0423b9",
      "181a61ea6c1dd6ecadb314598b354bad1cab669bddd2057963d0d80e6eab1809",
    ]),
    schema_migrations: Object.freeze([
      "c1b7313cc662808476c3815653e069743817c9d0a29a423d0c7810d995d94ec7",
    ]),
    sessions: Object.freeze([
      "01b47e65e5743d9b335e194619fc4b12520644e7146b935502de8f273a73cbd1",
    ]),
    user_templates: Object.freeze([
      "31dbd72b7c75acde5872a24a49944e587d01546b583f5c6c12d723ca69f7f91f",
    ]),
    users: Object.freeze([
      "3f6ff917f5c58dcceafbc36da7286b3c5b3b4ebf17959434d39e75e226a7219d",
      "80159c4cbfb80a7ef8071d04ed65acd127b62d6c434289a1b713a91cc81d7205",
    ]),
  }),
  triggers: Object.freeze({
    account_delete_guard_generation_task_activation: Object.freeze({
      sqlHash: "10f141d8a48d7ed9dd6a16e49f3c6e956a2e70d0ab4787ee3a6181e2d0d753d3",
      table: "generation_tasks",
    }),
    account_delete_guard_generation_task_insert: Object.freeze({
      sqlHash: "d00738c36501ba252313207a4b0643a9c5d7e25944798b1e627dee96f7654d12",
      table: "generation_tasks",
    }),
    account_delete_guard_public_template_actor_update: Object.freeze({
      sqlHash: "fa2f8a2d1359e413eafc5422eac6f54c6d8cc98e217bceea3a1d99a087155dc7",
      table: "public_templates",
    }),
    account_delete_guard_public_template_insert: Object.freeze({
      sqlHash: "80e3c565d213ff336163b47d3e74c78bac15751c7c8948edfa8a7bebf2c3bc9e",
      table: "public_templates",
    }),
    account_delete_guard_session_insert: Object.freeze({
      sqlHash: "37822025467ab8097811df9d19bad9f595975f82d4790c93ee8d9d9b85d380d6",
      table: "sessions",
    }),
    account_delete_guard_user_template_insert: Object.freeze({
      sqlHash: "eb9bee1e651e043eee8f345f85f3fa422125e7bfef46e89c35fa0e28efe25d0f",
      table: "user_templates",
    }),
    account_delete_guard_user_template_owner_update: Object.freeze({
      sqlHash: "9f6c16c058d889462ea76f1d8816b55e7d4e02f004d12a92b5d0305df07f6e19",
      table: "user_templates",
    }),
    account_delete_guard_user_reactivation: Object.freeze({
      sqlHash: "f67ad13e59c5050e802319f9c3c9a36869715a96bb8540f03287debf948e3522",
      table: "users",
    }),
    archived_models_cannot_enable_binding_insert: Object.freeze({
      sqlHash: "df41b6cb986c87a6cec9123e2368358127f80693ba0f56c44ac31f113097245d",
      table: "node_model_bindings",
    }),
    archived_models_cannot_enable_binding_update: Object.freeze({
      sqlHash: "acadc33d6989310e541cdfab4382725536b2a43e8874279f5bfb2de50e83634b",
      table: "node_model_bindings",
    }),
    generation_tasks_capture_model_display_name: Object.freeze({
      sqlHash: "53134517eabb56121add52886258a41e864acad5ede012650e88d68440d26379",
      table: "generation_tasks",
    }),
    media_publication_guard_owner_delete: Object.freeze({
      sqlHash: "fe8f8819e746f2a7c91c5759cbe7999eb9cc4cf29cd9d57d9cf2b62d62d9781e",
      table: "users",
    }),
    media_publication_guard_task_delete: Object.freeze({
      sqlHash: "5e5a3d715ecfd7de6dae4f3b8a40ea0756f8d0db12da4d7916ae8867a26f15e4",
      table: "generation_tasks",
    }),
    model_profiles_capture_first_publish_insert: Object.freeze({
      sqlHash: "387ea10071a57d572ba4fbc8842eaeadc1b9451d949c91a0f8fa25cdb11743cd",
      table: "model_profiles",
    }),
    model_profiles_capture_first_publish_update: Object.freeze({
      sqlHash: "644e840c516f0d3fc56a4a7a1c936aedc02f8ba19a7c7573afc0174089c9ead9",
      table: "model_profiles",
    }),
  }),
});

function sameSchemaStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function schemaSqlHash(sql: unknown) {
  return createHash("sha256").update(String(sql ?? "")).digest("hex");
}

function acceptedSchemaSqlHashes(contract: {
  acceptedSqlHashes?: readonly string[];
  sqlHash: string;
}) {
  return contract.acceptedSqlHashes ?? [contract.sqlHash];
}

function schemaObject(
  database: DatabaseSync,
  type: "index" | "table" | "trigger",
  name: string,
) {
  return database.prepare(`
    SELECT sql, tbl_name
    FROM sqlite_schema
    WHERE type = ? AND name = ?
  `).get(type, name) as { sql?: unknown; tbl_name?: unknown } | undefined;
}

/** Exact physical-schema guard shared by runtime readiness and writer opens. */
export function databaseMatchesSchemaContract(database: DatabaseSync) {
  const expectedTables = Object.keys(currentSchemaContract.tables).sort();
  const actualTables = (database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name?: unknown }>).map((row) => String(row.name));
  if (!sameSchemaStrings(actualTables, expectedTables)) return false;

  for (const tableName of expectedTables) {
    if (!/^[a-z][a-z0-9_]*$/.test(tableName)) return false;
    const expectedColumns = [
      ...currentSchemaContract.tables[
        tableName as keyof typeof currentSchemaContract.tables
      ],
    ].sort();
    const actualColumns = (database
      .prepare(`PRAGMA table_xinfo("${tableName}")`)
      .all() as Array<{ name?: unknown }>).map((column) => String(column.name))
      .sort();
    if (!sameSchemaStrings(actualColumns, expectedColumns)) return false;
    const table = schemaObject(database, "table", tableName);
    const acceptedSqlHashes = currentSchemaContract.tableSqlHashes[
      tableName as keyof typeof currentSchemaContract.tableSqlHashes
    ];
    if (!table || !acceptedSqlHashes.includes(schemaSqlHash(table.sql))) {
      return false;
    }
  }

  const expectedExplicitIndexNames = Object.keys(
    currentSchemaContract.explicitIndexes,
  ).sort();
  const optionalExplicitIndexNames = new Set<string>();
  for (const [indexName, condition] of Object.entries(
    currentSchemaContract.conditionallyOptionalExplicitIndexes,
  )) {
    const table = schemaObject(database, "table", condition.table);
    if (schemaSqlHash(table?.sql) === condition.tableSqlHash) {
      optionalExplicitIndexNames.add(indexName);
    }
  }
  const requiredExplicitIndexNames = expectedExplicitIndexNames.filter(
    (name) => !optionalExplicitIndexNames.has(name),
  );
  const actualExplicitIndexNames = (database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'index' AND sql IS NOT NULL
    ORDER BY name
  `).all() as Array<{ name?: unknown }>).map((row) => String(row.name));
  if (
    actualExplicitIndexNames.some(
      (name) => !expectedExplicitIndexNames.includes(name),
    ) ||
    requiredExplicitIndexNames.some(
      (name) => !actualExplicitIndexNames.includes(name),
    )
  ) return false;
  for (const indexName of actualExplicitIndexNames) {
    const expected = currentSchemaContract.explicitIndexes[
      indexName as keyof typeof currentSchemaContract.explicitIndexes
    ];
    const index = schemaObject(database, "index", indexName);
    if (
      String(index?.tbl_name ?? "") !== expected.table ||
      !acceptedSchemaSqlHashes(expected).includes(schemaSqlHash(index?.sql))
    ) return false;
  }

  for (const [indexName, expected] of Object.entries(
    currentSchemaContract.indexes,
  )) {
    if (
      !/^[a-z][a-z0-9_]*$/.test(indexName) ||
      !/^[a-z][a-z0-9_]*$/.test(expected.table)
    ) return false;
    const index = (database
      .prepare(`PRAGMA index_list("${expected.table}")`)
      .all() as Array<{
        name?: unknown;
        partial?: unknown;
        unique?: unknown;
      }>).find((candidate) => String(candidate.name) === indexName);
    if (
      !index ||
      Boolean(Number(index.unique)) !== expected.unique ||
      Boolean(Number(index.partial)) !== expected.partial
    ) return false;
    const columns = (database
      .prepare(`PRAGMA index_xinfo("${indexName}")`)
      .all() as Array<{ key?: unknown; name?: unknown }>).filter(
        (column) => Number(column.key) === 1,
      ).map((column) => String(column.name));
    if (!sameSchemaStrings(columns, expected.columns)) return false;
    const schemaIndex = schemaObject(database, "index", indexName);
    const explicitIndex = currentSchemaContract.explicitIndexes[
      indexName as keyof typeof currentSchemaContract.explicitIndexes
    ];
    if (
      String(schemaIndex?.tbl_name ?? "") !== expected.table ||
      !acceptedSchemaSqlHashes(explicitIndex).includes(
        schemaSqlHash(schemaIndex?.sql),
      )
    ) return false;
  }

  const expectedTriggerNames = Object.keys(currentSchemaContract.triggers).sort();
  const actualTriggerNames = (database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'trigger'
    ORDER BY name
  `).all() as Array<{ name?: unknown }>).map((row) => String(row.name));
  if (!sameSchemaStrings(actualTriggerNames, expectedTriggerNames)) return false;
  for (const [triggerName, expected] of Object.entries(
    currentSchemaContract.triggers,
  )) {
    const trigger = schemaObject(database, "trigger", triggerName);
    if (
      String(trigger?.tbl_name ?? "") !== expected.table ||
      schemaSqlHash(trigger?.sql) !== expected.sqlHash
    ) return false;
  }
  const actualViewNames = (database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'view'
    ORDER BY name
  `).all() as Array<{ name?: unknown }>).map((row) => String(row.name));
  return actualViewNames.length === 0;
}

export function appDataDirectory() {
  return process.env.UNBOUNDRY_DATA_DIR ?? join(process.cwd(), "data");
}

let afterGreenfieldDatabasePublishForTests:
  | ((databasePath: string) => void)
  | undefined;

export type GreenfieldDatabaseInitializationCheckpoint =
  | "marker-published"
  | "reservation-closed"
  | "database-closed"
  | "final-validation-complete";

export type CurrentDatabaseOpenCheckpoint =
  | "inspection-schema-validated"
  | "before-writer-sidecar-validation";

let duringGreenfieldDatabaseInitializationForTests:
  | ((checkpoint: GreenfieldDatabaseInitializationCheckpoint) => void)
  | undefined;

let duringCurrentDatabaseOpenForTests:
  | ((checkpoint: CurrentDatabaseOpenCheckpoint, databasePath: string) => void)
  | undefined;

export function setAfterGreenfieldDatabasePublishForTests(
  hook: ((databasePath: string) => void) | undefined,
) {
  afterGreenfieldDatabasePublishForTests = hook;
}

export function setDuringGreenfieldDatabaseInitializationForTests(
  hook:
    | ((checkpoint: GreenfieldDatabaseInitializationCheckpoint) => void)
    | undefined,
) {
  duringGreenfieldDatabaseInitializationForTests = hook;
}

export function setDuringCurrentDatabaseOpenForTests(
  hook:
    | ((checkpoint: CurrentDatabaseOpenCheckpoint, databasePath: string) => void)
    | undefined,
) {
  duringCurrentDatabaseOpenForTests = hook;
}

const maximumLegacyMediaBytes = 20 * 1_024 * 1_024 * 1_024;

function safeLegacyMediaDescriptor(path: string) {
  const descriptor = openSync(
    path,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  const details = fstatSync(descriptor, { bigint: true });
  if (
    !details.isFile() || details.nlink !== 1n || details.size < 0n ||
    details.size > BigInt(maximumLegacyMediaBytes) ||
    (details.mode & 0o022n) !== 0n ||
    typeof process.getuid !== "function" ||
    details.uid !== BigInt(process.getuid())
  ) {
    closeSync(descriptor);
    throw new Error("Unsafe legacy media file");
  }
  return { descriptor, details };
}

function sameFileIdentity(
  left: BigIntStats,
  right: BigIntStats,
) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs && right.nlink === 1n && right.isFile();
}

export type LegacyMediaPathIdentity = Readonly<{
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
  mode: bigint;
  mtimeNs: bigint;
  nlink: bigint;
  size: bigint;
  uid: bigint;
}>;

export type LegacyMediaBackfillEvidence = Readonly<{
  checksumSha256?: string;
  durationSeconds?: number;
  durationSource?: "provider-task" | "server-probe";
  id: string;
  identity: LegacyMediaPathIdentity;
  kind: string;
  path: string;
  purpose: "checksum" | "duration";
  storageName: string;
}>;

export const legacyMediaDurationProbeArguments = Object.freeze([
  "-v",
  "error",
  "-protocol_whitelist",
  "file,pipe",
  "-show_entries",
  "format=duration",
  "-of",
  "default=noprint_wrappers=1:nokey=1",
  "/dev/fd/3",
] as const);

export type LegacyMediaDurationProbe = Readonly<{
  executable?: string;
  onEvent?: (event: Readonly<{
    arguments: typeof legacyMediaDurationProbeArguments;
    phase: "complete" | "start";
  }>) => void;
}>;

function legacyMediaPathIdentity(details: BigIntStats): LegacyMediaPathIdentity {
  return Object.freeze({
    ctimeNs: details.ctimeNs,
    dev: details.dev,
    ino: details.ino,
    mode: details.mode,
    mtimeNs: details.mtimeNs,
    nlink: details.nlink,
    size: details.size,
    uid: details.uid,
  });
}

function sameLegacyMediaPathIdentity(
  expected: LegacyMediaPathIdentity,
  actual: BigIntStats,
) {
  return actual.isFile() && !actual.isSymbolicLink() &&
    actual.dev === expected.dev && actual.ino === expected.ino &&
    actual.uid === expected.uid && actual.mode === expected.mode &&
    actual.nlink === expected.nlink && actual.nlink === 1n &&
    actual.size === expected.size && actual.mtimeNs === expected.mtimeNs &&
    actual.ctimeNs === expected.ctimeNs;
}

function fileSha256(path: string) {
  const hash = createHash("sha256");
  const { descriptor, details } = safeLegacyMediaDescriptor(path);
  const buffer = Buffer.allocUnsafe(64 * 1_024);
  try {
    let bytesRead = 0;
    let total = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      total += bytesRead;
      if (total > maximumLegacyMediaBytes) {
        throw new Error("Legacy media file exceeds the migration limit");
      }
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
    const after = fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(details, after) || BigInt(total) !== details.size) {
      throw new Error("Legacy media changed while hashing");
    }
  } finally {
    closeSync(descriptor);
  }
  return Object.freeze({
    identity: legacyMediaPathIdentity(details),
    path,
    sha256: hash.digest("hex"),
  });
}

function trustedDurationFromFile(
  path: string,
  probe: LegacyMediaDurationProbe = {},
) {
  const { descriptor, details } = safeLegacyMediaDescriptor(path);
  let output: string;
  try {
    probe.onEvent?.(Object.freeze({
      arguments: legacyMediaDurationProbeArguments,
      phase: "start" as const,
    }));
    output = execFileSync(
      probe.executable ?? "ffprobe",
      [...legacyMediaDurationProbeArguments],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1_024,
        stdio: ["ignore", "pipe", "ignore", descriptor],
        timeout: 20_000,
        windowsHide: true,
      },
    );
    probe.onEvent?.(Object.freeze({
      arguments: legacyMediaDurationProbeArguments,
      phase: "complete" as const,
    }));
    if (!sameFileIdentity(details, fstatSync(descriptor, { bigint: true }))) {
      throw new Error("Legacy media changed while probing");
    }
  } finally {
    closeSync(descriptor);
  }
  const durationSeconds = Number(output.trim());
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 7 * 24 * 60 * 60
  ) {
    throw new Error("Invalid media duration");
  }
  return Object.freeze({
    durationSeconds: Math.round(durationSeconds * 1_000) / 1_000,
    identity: legacyMediaPathIdentity(details),
    path,
  });
}

export type SchemaMigrationCheckpoint = Readonly<{
  name: string;
  version: number;
}>;

export function databaseMatchesMigrationManifest(
  database: DatabaseSync,
  version = currentSchemaVersion,
) {
  if (!Number.isInteger(version) || version < 0 || version > currentSchemaVersion) {
    return false;
  }
  const userVersion = database.prepare("PRAGMA user_version").get() as
    | { user_version?: unknown }
    | undefined;
  if (Number(userVersion?.user_version) !== version) return false;
  const rows = database.prepare(
    "SELECT version, name FROM schema_migrations ORDER BY version",
  ).all() as Array<{ name?: unknown; version?: unknown }>;
  const expected = currentSchemaManifest.slice(0, version);
  return rows.length === expected.length && rows.every((row, index) =>
    Number(row.version) === expected[index]?.version &&
    String(row.name) === expected[index]?.name
  );
}

export function applyPendingSchemaMigrationsInTransaction(
  database: DatabaseSync,
  options: Readonly<{
    appliedAt?: () => string;
    onMigrationApplied?: (checkpoint: SchemaMigrationCheckpoint) => void;
    sourceVersion: number;
    targetVersion?: number;
  }>,
) {
  const targetVersion = options.targetVersion ?? currentSchemaVersion;
  if (!database.isTransaction) {
    throw new Error("Schema migrations require an existing write transaction");
  }
  if (
    !Number.isInteger(options.sourceVersion) ||
    options.sourceVersion < 0 ||
    options.sourceVersion > currentSchemaVersion ||
    !Number.isInteger(targetVersion) ||
    targetVersion < options.sourceVersion ||
    targetVersion > currentSchemaVersion ||
    !databaseMatchesMigrationManifest(database, options.sourceVersion)
  ) {
    throw new Error("Database migration source manifest is not exact");
  }
  const appliedAt = options.appliedAt ?? (() => new Date().toISOString());
  for (const migration of migrations) {
    if (
      migration.version <= options.sourceVersion ||
      migration.version > targetVersion
    ) continue;
    migration.prepare?.(database);
    database.exec(migration.sql);
    database.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `).run(migration.version, migration.name, appliedAt());
    options.onMigrationApplied?.(Object.freeze({
      name: migration.name,
      version: migration.version,
    }));
  }
  database.exec(`PRAGMA user_version = ${targetVersion}`);
}

export type LegacyMediaBackfillSummary = Readonly<{
  checksums: number;
  durations: number;
  evidence: readonly LegacyMediaBackfillEvidence[];
}>;

export function revalidateLegacyMediaBackfillEvidence(
  database: DatabaseSync,
  evidence: readonly LegacyMediaBackfillEvidence[],
) {
  const metadata = database.prepare(`
    SELECT
      byte_size, checksum_sha256, duration_seconds, duration_source,
      duration_status, storage_backend, storage_name, storage_status
    FROM media_assets
    WHERE kind = ? AND id = ?
  `);
  for (const item of evidence) {
    let pathDetails: BigIntStats;
    try {
      pathDetails = lstatSync(item.path, { bigint: true });
    } catch {
      throw new Error(`Legacy media path changed for ${item.kind}:${item.id}`);
    }
    if (!sameLegacyMediaPathIdentity(item.identity, pathDetails)) {
      throw new Error(`Legacy media path changed for ${item.kind}:${item.id}`);
    }
    const row = metadata.get(item.kind, item.id) as
      | {
          byte_size?: unknown;
          checksum_sha256?: unknown;
          duration_seconds?: unknown;
          duration_source?: unknown;
          duration_status?: unknown;
          storage_backend?: unknown;
          storage_name?: unknown;
          storage_status?: unknown;
        }
      | undefined;
    if (
      !row || String(row.storage_name) !== item.storageName ||
      String(row.storage_backend) !== "local" ||
      String(row.storage_status) !== "ready" ||
      Number(row.byte_size) !== Number(item.identity.size) ||
      (item.purpose === "checksum" &&
        String(row.checksum_sha256) !== item.checksumSha256) ||
      (item.purpose === "duration" && (
        Number(row.duration_seconds) !== item.durationSeconds ||
        String(row.duration_source) !== item.durationSource ||
        String(row.duration_status) !== "ready"
      ))
    ) {
      throw new Error(`Legacy media metadata changed for ${item.kind}:${item.id}`);
    }
  }
}

/**
 * A committed migration marker can outlive the transaction that populated
 * legacy media metadata. Rebuild physical evidence from every ready local
 * object before that marker is cleared: an empty incremental backfill is not
 * proof that the files still match the committed rows.
 */
export function verifyCommittedMigrationMediaStrict(
  database: DatabaseSync,
  dataDirectory: string,
  options: Readonly<{
    durationProbe?: LegacyMediaDurationProbe;
  }> = {},
) {
  if (
    !database.isTransaction ||
    !databaseMatchesMigrationManifest(database) ||
    !databaseMatchesSchemaContract(database) ||
    !databaseHasCompleteLegacyMediaMetadata(database)
  ) throw new Error("Committed migration media verification requires an exact current transaction");
  const rows = database.prepare(`
    SELECT
      byte_size, checksum_sha256, duration_seconds, duration_source,
      id, kind, storage_name
    FROM media_assets
    WHERE storage_backend = 'local' AND storage_status = 'ready'
    ORDER BY kind, id
  `).all() as Array<{
    byte_size: number;
    checksum_sha256: string;
    duration_seconds: number | null;
    duration_source: string | null;
    id: string;
    kind: string;
    storage_name: string;
  }>;
  if (rows.length === 0) return Object.freeze([]) as readonly LegacyMediaBackfillEvidence[];

  const canonicalDataDirectory = realpathSync(dataDirectory);
  const mediaDirectory = join(canonicalDataDirectory, "media");
  const mediaDetails = lstatSync(mediaDirectory);
  if (
    mediaDetails.isSymbolicLink() || !mediaDetails.isDirectory() ||
    realpathSync(mediaDirectory) !== mediaDirectory ||
    typeof process.getuid !== "function" ||
    mediaDetails.uid !== process.getuid() || (mediaDetails.mode & 0o022) !== 0
  ) throw new Error("Unsafe committed migration media directory");

  const evidence: LegacyMediaBackfillEvidence[] = [];
  for (const row of rows) {
    if (basename(row.storage_name) !== row.storage_name) {
      throw new Error(`Unsafe committed migration media name for ${row.kind}:${row.id}`);
    }
    const mediaPath = join(mediaDirectory, row.storage_name);
    const checksum = fileSha256(mediaPath);
    if (
      checksum.sha256 !== row.checksum_sha256 ||
      Number(checksum.identity.size) !== Number(row.byte_size)
    ) {
      throw new Error(`Committed migration media checksum changed for ${row.kind}:${row.id}`);
    }
    evidence.push(Object.freeze({
      checksumSha256: checksum.sha256,
      id: row.id,
      identity: checksum.identity,
      kind: row.kind,
      path: checksum.path,
      purpose: "checksum" as const,
      storageName: row.storage_name,
    }));

    if (
      (row.kind === "video" || row.kind === "audio") &&
      row.duration_source === "server-probe"
    ) {
      const duration = trustedDurationFromFile(
        mediaPath,
        options.durationProbe,
      );
      if (duration.durationSeconds !== Number(row.duration_seconds)) {
        throw new Error(`Committed migration media duration changed for ${row.kind}:${row.id}`);
      }
      evidence.push(Object.freeze({
        durationSeconds: duration.durationSeconds,
        durationSource: "server-probe" as const,
        id: row.id,
        identity: duration.identity,
        kind: row.kind,
        path: duration.path,
        purpose: "duration" as const,
        storageName: row.storage_name,
      }));
    }
  }
  revalidateLegacyMediaBackfillEvidence(database, evidence);
  return Object.freeze(evidence);
}

/** Strict, retryable legacy metadata completion owned by the one-shot role. */
export function backfillLegacyMediaStrict(
  database: DatabaseSync,
  dataDirectory: string,
  options: Readonly<{
    callerOwnsTransaction?: boolean;
    durationProbe?: LegacyMediaDurationProbe;
    now?: () => string;
    onRow?: (kind: "checksum" | "duration", id: string) => void;
  }> = {},
): LegacyMediaBackfillSummary {
  if (
    !databaseMatchesMigrationManifest(database) ||
    !databaseMatchesSchemaContract(database)
  ) throw new Error("Legacy media backfill requires the exact current schema");
  const now = options.now ?? (() => new Date().toISOString());
  const canonicalDataDirectory = realpathSync(dataDirectory);
  const mediaDirectory = join(canonicalDataDirectory, "media");
  const needsPhysicalMedia = database.prepare(`
    SELECT 1
    FROM media_assets
    WHERE storage_backend = 'local' AND storage_status = 'ready' AND (
      checksum_sha256 IS NULL OR length(checksum_sha256) <> 64
      OR checksum_sha256 GLOB '*[^0-9a-f]*'
      OR (kind IN ('video', 'audio') AND (
        duration_status <> 'ready'
        OR duration_seconds IS NULL OR duration_seconds <= 0
        OR duration_source IS NULL
        OR duration_source NOT IN ('server-probe', 'provider-task')
      ))
    )
    LIMIT 1
  `).get();
  if (needsPhysicalMedia) {
    const mediaDetails = lstatSync(mediaDirectory);
    if (
      mediaDetails.isSymbolicLink() || !mediaDetails.isDirectory() ||
      realpathSync(mediaDirectory) !== mediaDirectory ||
      typeof process.getuid !== "function" ||
      mediaDetails.uid !== process.getuid() || (mediaDetails.mode & 0o022) !== 0
    ) throw new Error("Unsafe legacy media directory");
  }
  let checksums = 0;
  let durations = 0;
  const evidence: LegacyMediaBackfillEvidence[] = [];
  if (options.callerOwnsTransaction) {
    if (!database.isTransaction) {
      throw new Error("Legacy media backfill requires the caller write lock");
    }
  } else {
    database.exec("BEGIN IMMEDIATE");
  }
  try {
    const checksumRows = database.prepare(`
      SELECT kind, id, storage_name
      FROM media_assets
      WHERE storage_backend = 'local'
        AND storage_status = 'ready'
        AND (
          checksum_sha256 IS NULL OR length(checksum_sha256) <> 64
          OR checksum_sha256 GLOB '*[^0-9a-f]*'
        )
      ORDER BY kind, id
    `).all() as Array<{ id: string; kind: string; storage_name: string }>;
    const updateChecksum = database.prepare(`
      UPDATE media_assets
      SET checksum_sha256 = ?, updated_at = ?
      WHERE kind = ? AND id = ? AND (
        checksum_sha256 IS NULL OR length(checksum_sha256) <> 64
        OR checksum_sha256 GLOB '*[^0-9a-f]*'
      )
    `);
    for (const row of checksumRows) {
      if (basename(row.storage_name) !== row.storage_name) {
        throw new Error(`Unsafe legacy media name for ${row.kind}:${row.id}`);
      }
      const mediaPath = join(mediaDirectory, row.storage_name);
      const verified = fileSha256(mediaPath);
      if (updateChecksum.run(
        verified.sha256,
        now(),
        row.kind,
        row.id,
      ).changes !== 1) throw new Error("Legacy checksum row changed concurrently");
      const item = Object.freeze({
        checksumSha256: verified.sha256,
        id: row.id,
        identity: verified.identity,
        kind: row.kind,
        path: verified.path,
        purpose: "checksum" as const,
        storageName: row.storage_name,
      });
      revalidateLegacyMediaBackfillEvidence(database, [item]);
      evidence.push(item);
      checksums += 1;
      options.onRow?.("checksum", row.id);
    }

    const updateDuration = database.prepare(`
      UPDATE media_assets
      SET duration_seconds = ?, duration_source = ?, duration_status = 'ready'
      WHERE kind = ? AND id = ? AND (
        duration_status <> 'ready'
        OR duration_seconds IS NULL OR duration_seconds <= 0
        OR duration_source IS NULL
        OR duration_source NOT IN ('server-probe', 'provider-task')
      )
    `);
    const generatedVideos = database.prepare(`
      SELECT media_assets.id, generation_tasks.parameters
      FROM media_assets
      JOIN generation_tasks
        ON generation_tasks.result_asset_id = media_assets.id
        AND generation_tasks.kind = 'video'
        AND generation_tasks.state = 'success'
      WHERE media_assets.kind = 'video'
        AND media_assets.storage_status = 'ready'
        AND (
          media_assets.duration_status <> 'ready'
          OR media_assets.duration_seconds IS NULL
          OR media_assets.duration_seconds <= 0
          OR media_assets.duration_source IS NULL
          OR media_assets.duration_source NOT IN (
            'server-probe', 'provider-task'
          )
        )
      ORDER BY generation_tasks.updated_at DESC
    `).all() as Array<{ id: string; parameters: string }>;
    const updatedGenerated = new Set<string>();
    for (const row of generatedVideos) {
      if (updatedGenerated.has(row.id)) continue;
      let parameters: Record<string, unknown>;
      try {
        parameters = JSON.parse(row.parameters) as Record<string, unknown>;
      } catch {
        continue;
      }
      const durationSeconds = Number(parameters.duration);
      if (
        !Number.isInteger(durationSeconds) ||
        durationSeconds < 2 || durationSeconds > 15
      ) continue;
      if (updateDuration.run(
        durationSeconds,
        "provider-task",
        "video",
        row.id,
      ).changes) {
        updatedGenerated.add(row.id);
        durations += 1;
        options.onRow?.("duration", row.id);
      }
    }

    const localRows = database.prepare(`
      SELECT kind, id, storage_name
      FROM media_assets
      WHERE kind IN ('video', 'audio')
        AND storage_backend = 'local'
        AND storage_status = 'ready'
        AND (
          duration_status <> 'ready'
          OR duration_seconds IS NULL OR duration_seconds <= 0
          OR duration_source IS NULL
          OR duration_source NOT IN ('server-probe', 'provider-task')
        )
      ORDER BY kind, id
    `).all() as Array<{
      id: string;
      kind: "audio" | "video";
      storage_name: string;
    }>;
    for (const row of localRows) {
      if (basename(row.storage_name) !== row.storage_name) {
        throw new Error(`Unsafe legacy duration file for ${row.kind}:${row.id}`);
      }
      const verified = trustedDurationFromFile(
        join(mediaDirectory, row.storage_name),
        options.durationProbe,
      );
      if (updateDuration.run(
        verified.durationSeconds,
        "server-probe",
        row.kind,
        row.id,
      ).changes !== 1) throw new Error("Legacy duration row changed concurrently");
      const item = Object.freeze({
        durationSeconds: verified.durationSeconds,
        durationSource: "server-probe" as const,
        id: row.id,
        identity: verified.identity,
        kind: row.kind,
        path: verified.path,
        purpose: "duration" as const,
        storageName: row.storage_name,
      });
      revalidateLegacyMediaBackfillEvidence(database, [item]);
      evidence.push(item);
      durations += 1;
      options.onRow?.("duration", row.id);
    }
    const unresolved = database.prepare(`
      SELECT COUNT(*) AS count
      FROM media_assets
      WHERE storage_status = 'ready' AND (
        checksum_sha256 IS NULL OR length(checksum_sha256) <> 64
        OR checksum_sha256 GLOB '*[^0-9a-f]*'
        OR (kind IN ('video', 'audio') AND (
          duration_status <> 'ready'
          OR duration_seconds IS NULL OR duration_seconds <= 0
          OR duration_source IS NULL
          OR duration_source NOT IN ('server-probe', 'provider-task')
        ))
      )
    `).get() as { count?: unknown } | undefined;
    if (Number(unresolved?.count) !== 0) {
      throw new Error("Legacy media metadata remains incomplete");
    }
    revalidateLegacyMediaBackfillEvidence(database, evidence);
    if (!options.callerOwnsTransaction) database.exec("COMMIT");
  } catch (error) {
    if (!options.callerOwnsTransaction && database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
  return Object.freeze({
    checksums,
    durations,
    evidence: Object.freeze(evidence),
  });
}

type CurrentDatabaseSidecarSnapshot = Readonly<{
  journal?: BigIntStats;
  shm?: BigIntStats;
  wal?: BigIntStats;
}>;

function currentDatabaseSidecarDetails(path: string) {
  try {
    const details = lstatSync(path, { bigint: true });
    if (
      !details.isFile() || details.isSymbolicLink() || details.nlink !== 1n ||
      typeof process.getuid !== "function" ||
      details.uid !== BigInt(process.getuid()) ||
      (details.mode & 0o022n) !== 0n
    ) throw new Error("Current database sidecar is unsafe");
    return details;
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return undefined;
    throw error;
  }
}

function collectCurrentDatabaseSidecars(
  databasePath: string,
): CurrentDatabaseSidecarSnapshot {
  const wal = currentDatabaseSidecarDetails(`${databasePath}-wal`);
  const shm = currentDatabaseSidecarDetails(`${databasePath}-shm`);
  const journal = currentDatabaseSidecarDetails(`${databasePath}-journal`);
  return Object.freeze({ journal, shm, wal });
}

function captureCurrentDatabaseSidecars(
  databasePath: string,
): CurrentDatabaseSidecarSnapshot {
  const sidecars = collectCurrentDatabaseSidecars(databasePath);
  const { journal, shm, wal } = sidecars;
  // An idle live WAL-mode connection legitimately keeps a private SHM file
  // together with a zero-byte WAL. Treat that pair as a complete topology,
  // not as an orphan: subsequent checks pin both identities across inspection
  // and writer acquisition. A lone WAL/SHM or any rollback journal remains a
  // fail-closed shape.
  if (journal || Boolean(wal) !== Boolean(shm)) {
    throw new Error("Current database WAL sidecars are incomplete");
  }
  return sidecars;
}

function exactCurrentInspectionLocation(
  databasePath: string,
  sidecars = captureCurrentDatabaseSidecars(databasePath),
) {
  return sidecars.wal && sidecars.wal.size > 0n
    ? databasePath
    : `${pathToFileURL(databasePath).href}?immutable=1`;
}

function sameSidecarIdentity(actual: BigIntStats, expected: BigIntStats) {
  return actual.isFile() && !actual.isSymbolicLink() && actual.nlink === 1n &&
    actual.dev === expected.dev && actual.ino === expected.ino &&
    actual.uid === expected.uid && actual.mode === expected.mode;
}

function assertCurrentDatabaseSidecarsBeforeWriterOpen(
  databasePath: string,
  expected: CurrentDatabaseSidecarSnapshot,
) {
  const actual = captureCurrentDatabaseSidecars(databasePath);
  if (expected.wal) {
    if (
      !actual.wal || !actual.shm ||
      !sameSidecarIdentity(actual.wal, expected.wal) ||
      !sameSidecarIdentity(actual.shm, expected.shm!)
    ) throw new Error("Application database sidecars changed before writer open");
    return;
  }
  if (actual.wal || actual.shm || actual.journal) {
    throw new Error("Application database sidecars changed before writer open");
  }
}

function assertCurrentDatabaseSidecarsAfterWriterLock(
  databasePath: string,
  expected: CurrentDatabaseSidecarSnapshot,
) {
  // Once BEGIN IMMEDIATE owns the writer lock, SQLite may legitimately have
  // created a new WAL/SHM pair without having written the first WAL frame yet.
  // Collect safety properties without applying the pre-writer hot-WAL topology
  // rule so a zero-byte WAL plus its private SHM is accepted here.
  const actual = collectCurrentDatabaseSidecars(databasePath);
  if (expected.wal) {
    if (
      !actual.wal || !actual.shm ||
      !sameSidecarIdentity(actual.wal, expected.wal) ||
      !sameSidecarIdentity(actual.shm, expected.shm!)
    ) throw new Error("Application database sidecars changed while opening");
    return;
  }
  // A normal WAL-mode writer may create its own new WAL/SHM pair. It is
  // admissible only if both names were absent, the pair is now
  // private/single-link, and no rollback journal appeared. A pair captured
  // before inspection, including an idle zero-byte WAL, took the pinned branch
  // above instead.
  if (actual.journal || Boolean(actual.wal) !== Boolean(actual.shm)) {
    throw new Error("Application database sidecars changed while opening");
  }
}

export function databaseHasCompleteLegacyMediaMetadata(database: DatabaseSync) {
  const unresolved = database.prepare(`
    SELECT 1
    FROM media_assets
    WHERE storage_status = 'ready' AND (
      checksum_sha256 IS NULL OR length(checksum_sha256) <> 64
      OR checksum_sha256 GLOB '*[^0-9a-f]*'
      OR (kind IN ('video', 'audio') AND (
        duration_status <> 'ready'
        OR duration_seconds IS NULL OR duration_seconds <= 0
        OR duration_source IS NULL
        OR duration_source NOT IN ('server-probe', 'provider-task')
      ))
    )
    LIMIT 1
  `).get();
  return !unresolved;
}

function assertExactCurrentDatabase(database: DatabaseSync) {
  const quickCheck = database.prepare("PRAGMA quick_check").all() as
    Array<{ quick_check?: unknown }>;
  if (
    quickCheck.length !== 1 ||
    String(quickCheck[0]?.quick_check) !== "ok" ||
    !databaseMatchesMigrationManifest(database) ||
    !databaseMatchesSchemaContract(database) ||
    !databaseHasCompleteLegacyMediaMetadata(database) ||
    database.prepare("PRAGMA foreign_key_check").all().length !== 0
  ) throw new Error("Application database is not the exact current schema");
}

function inspectExistingCurrentDatabase(databasePath: string) {
  const details = lstatSync(databasePath);
  const owned = typeof process.getuid === "function" &&
    details.uid === process.getuid();
  if (
    !details.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
    !owned || (details.mode & 0o022) !== 0
  ) {
    throw new Error("Application database must be an owned regular file");
  }
  const sidecars = captureCurrentDatabaseSidecars(databasePath);
  const inspection = new DatabaseSync(
    exactCurrentInspectionLocation(databasePath, sidecars),
    { readOnly: true, timeout: 5_000 },
  );
  let transactionOpen = false;
  try {
    inspection.exec("BEGIN");
    transactionOpen = true;
    assertExactCurrentDatabase(inspection);
    duringCurrentDatabaseOpenForTests?.(
      "inspection-schema-validated",
      databasePath,
    );
    const result = Object.freeze({
      contentDigest: exactCurrentContentDigest(inspection),
      details,
      sidecars,
    });
    inspection.exec("ROLLBACK");
    transactionOpen = false;
    return result;
  } finally {
    if (transactionOpen && inspection.isTransaction) {
      try {
        inspection.exec("ROLLBACK");
      } catch {
        // Preserve the exact-current inspection failure.
      }
    }
    inspection.close();
  }
}

function assertSameCurrentDatabaseIdentity(
  databasePath: string,
  expected: NonNullable<ReturnType<typeof lstatSync>>,
) {
  const actual = lstatSync(databasePath);
  if (
    !actual.isFile() || actual.isSymbolicLink() || actual.nlink !== 1 ||
    actual.dev !== expected.dev || actual.ino !== expected.ino ||
    actual.uid !== expected.uid || actual.mode !== expected.mode ||
    actual.nlink !== expected.nlink || typeof process.getuid !== "function" ||
    actual.uid !== process.getuid() || (actual.mode & 0o022) !== 0
  ) throw new Error("Application database changed while opening");
}

export const migrationIncompleteMarker = ".unboundry-migration-incomplete";

const greenfieldMarkerContract = "unboundry-greenfield-initialization-v1";
const currentDatabaseOpenReservation =
  ".unboundry-current-database-open-reservation";

type GreenfieldDirectoryPin = Readonly<{
  descriptor: number;
  details: BigIntStats;
}>;

type GreenfieldFilePin = Readonly<{
  details: BigIntStats;
  path: string;
}>;

function directoryEntryExists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return false;
    throw error;
  }
}

function assertApplicationDataDirectory(dataDirectory: string) {
  const details = lstatSync(dataDirectory);
  if (
    details.isSymbolicLink() || !details.isDirectory() ||
    typeof process.getuid !== "function" || details.uid !== process.getuid() ||
    (details.mode & 0o022) !== 0
  ) throw new Error("Application data directory is unsafe");
}

function pinApplicationDataDirectory(
  dataDirectory: string,
): GreenfieldDirectoryPin {
  const descriptor = openSync(
    dataDirectory,
    fileConstants.O_RDONLY |
      (fileConstants.O_DIRECTORY ?? 0) |
      (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const details = fstatSync(descriptor, { bigint: true });
    if (
      !details.isDirectory() || typeof process.getuid !== "function" ||
      details.uid !== BigInt(process.getuid()) ||
      (details.mode & 0o022n) !== 0n
    ) throw new Error("Application data directory is unsafe");
    const pathDetails = lstatSync(dataDirectory, { bigint: true });
    if (
      pathDetails.isSymbolicLink() || !pathDetails.isDirectory() ||
      pathDetails.dev !== details.dev || pathDetails.ino !== details.ino ||
      pathDetails.uid !== details.uid || pathDetails.mode !== details.mode
    ) throw new Error("Application data directory changed");
    return Object.freeze({ descriptor, details });
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function assertPinnedApplicationDataDirectory(
  dataDirectory: string,
  pin: GreenfieldDirectoryPin,
) {
  const descriptorDetails = fstatSync(pin.descriptor, { bigint: true });
  const pathDetails = lstatSync(dataDirectory, { bigint: true });
  for (const actual of [descriptorDetails, pathDetails]) {
    if (
      !actual.isDirectory() || actual.isSymbolicLink() ||
      actual.dev !== pin.details.dev || actual.ino !== pin.details.ino ||
      actual.uid !== pin.details.uid || actual.mode !== pin.details.mode
    ) throw new Error("Application data directory changed");
  }
}

function exactDirectoryEntries(dataDirectory: string, expected: string[]) {
  const actual = readdirSync(dataDirectory).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((name, index) => name !== sortedExpected[index])
  ) throw new Error("Application data directory entries changed");
}

function assertPrivateOwnedRegularFile(details: BigIntStats) {
  if (
    !details.isFile() || details.isSymbolicLink() ||
    typeof process.getuid !== "function" ||
    details.uid !== BigInt(process.getuid()) ||
    (details.mode & 0o777n) !== 0o600n
  ) throw new Error("Greenfield initialization file is unsafe");
}

function samePinnedFileCore(actual: BigIntStats, expected: BigIntStats) {
  return actual.dev === expected.dev && actual.ino === expected.ino &&
    actual.uid === expected.uid && actual.mode === expected.mode;
}

function assertPinnedFilePath(
  pin: GreenfieldFilePin,
  expectedLinks: bigint,
  options: { exactContentMetadata?: boolean } = {},
) {
  const actual = lstatSync(pin.path, { bigint: true });
  assertPrivateOwnedRegularFile(actual);
  if (
    !samePinnedFileCore(actual, pin.details) || actual.nlink !== expectedLinks ||
    (options.exactContentMetadata && (
      actual.size !== pin.details.size ||
      actual.mtimeNs !== pin.details.mtimeNs ||
      actual.ctimeNs !== pin.details.ctimeNs
    ))
  ) throw new Error("Greenfield initialization entry changed");
  return actual;
}

function assertPinnedDescriptor(
  descriptor: number,
  pin: GreenfieldFilePin,
  expectedLinks: bigint,
  options: { exactContentMetadata?: boolean } = {},
) {
  const actual = fstatSync(descriptor, { bigint: true });
  assertPrivateOwnedRegularFile(actual);
  if (
    !samePinnedFileCore(actual, pin.details) || actual.nlink !== expectedLinks ||
    (options.exactContentMetadata && (
      actual.size !== pin.details.size ||
      actual.mtimeNs !== pin.details.mtimeNs ||
      actual.ctimeNs !== pin.details.ctimeNs
    ))
  ) throw new Error("Greenfield initialization entry changed");
}

function createPinnedGreenfieldFile(path: string) {
  const descriptor = openSync(
    path,
    fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_RDWR |
      (fileConstants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    fchmodSync(descriptor, 0o600);
    const details = fstatSync(descriptor, { bigint: true });
    assertPrivateOwnedRegularFile(details);
    if (details.nlink !== 1n) {
      throw new Error("Greenfield initialization file link count is unsafe");
    }
    return Object.freeze({ descriptor, details });
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

type CurrentDatabaseOpenReservation = Readonly<{
  dataDirectory: string;
  descriptor: number;
  directoryPin: GreenfieldDirectoryPin;
  pin: GreenfieldFilePin;
}>;

const currentDatabaseOpenReservationWaitMilliseconds = 25;
const currentDatabaseOpenReservationTimeoutMilliseconds = 5_000;
const nanosecondsPerMillisecond = 1_000_000n;
const currentDatabaseOpenReservationWaitCell = new Int32Array(
  new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
);

function isFileAlreadyExistsError(error: unknown) {
  return Boolean(
    error && typeof error === "object" && "code" in error &&
      error.code === "EEXIST",
  );
}

function isFileMissingError(error: unknown) {
  return Boolean(
    error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT",
  );
}

function assertActiveCompetingCurrentDatabaseOpenReservation(
  dataDirectory: string,
  directoryPin: GreenfieldDirectoryPin,
) {
  const reservationPath = join(dataDirectory, currentDatabaseOpenReservation);
  const descriptor = openSync(
    reservationPath,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const details = fstatSync(descriptor, { bigint: true });
    const pin = Object.freeze({ details, path: reservationPath });
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    assertPinnedDescriptor(descriptor, pin, 1n, { exactContentMetadata: true });
    assertPinnedFilePath(pin, 1n, { exactContentMetadata: true });
    if (details.size < 1n || details.size > 512n) {
      throw new Error("Application data maintenance is incomplete");
    }
    const bytes = Buffer.alloc(Number(details.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) {
        throw new Error("Application data maintenance is incomplete");
      }
      offset += count;
    }
    assertPinnedDescriptor(descriptor, pin, 1n, { exactContentMetadata: true });
    assertPinnedFilePath(pin, 1n, { exactContentMetadata: true });
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("Application data maintenance is incomplete");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Application data maintenance is incomplete");
    }
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (
      keys.length !== 3 || keys[0] !== "contract" || keys[1] !== "nonce" ||
      keys[2] !== "pid" ||
      record.contract !== "unboundry-current-database-open-reservation-v1" ||
      typeof record.nonce !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(record.nonce) ||
      !Number.isSafeInteger(record.pid) || Number(record.pid) <= 0 ||
      record.pid === process.pid
    ) throw new Error("Application data maintenance is incomplete");
    try {
      process.kill(Number(record.pid), 0);
    } catch {
      // A stale or foreign reservation is never removed or waited through.
      throw new Error("Application data maintenance is incomplete");
    }
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    assertPinnedDescriptor(descriptor, pin, 1n, { exactContentMetadata: true });
    assertPinnedFilePath(pin, 1n, { exactContentMetadata: true });
  } finally {
    closeSync(descriptor);
  }
}

function acquireCurrentDatabaseOpenReservationOnce(
  dataDirectory: string,
): CurrentDatabaseOpenReservation {
  const directoryPin = pinApplicationDataDirectory(dataDirectory);
  const reservationPath = join(dataDirectory, currentDatabaseOpenReservation);
  let descriptor: number | undefined;
  let pin: GreenfieldFilePin | undefined;
  try {
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    const created = createPinnedGreenfieldFile(reservationPath);
    descriptor = created.descriptor;
    writeFileSync(descriptor, `${JSON.stringify({
      contract: "unboundry-current-database-open-reservation-v1",
      nonce: randomUUID(),
      pid: process.pid,
    })}\n`, { encoding: "utf8" });
    fsyncSync(descriptor);
    pin = Object.freeze({
      details: fstatSync(descriptor, { bigint: true }),
      path: reservationPath,
    });
    assertPinnedDescriptor(descriptor, pin, 1n, {
      exactContentMetadata: true,
    });
    assertPinnedFilePath(pin, 1n, { exactContentMetadata: true });
    fsyncSync(directoryPin.descriptor);
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    return Object.freeze({ dataDirectory, descriptor, directoryPin, pin });
  } catch (error) {
    if (descriptor !== undefined && pin) {
      try {
        removeCapturedPathIfPresent(dataDirectory, directoryPin, pin);
        fsyncSync(directoryPin.descriptor);
      } catch {
        // Never remove a replacement reservation while preserving acquisition
        // failure. A retained reservation keeps later opens fail-closed.
      }
    }
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the acquisition failure.
      }
    }
    try {
      closeSync(directoryPin.descriptor);
    } catch {
      // Preserve the acquisition failure.
    }
    throw error;
  }
}

function acquireCurrentDatabaseOpenReservation(
  dataDirectory: string,
): CurrentDatabaseOpenReservation {
  const deadline = process.hrtime.bigint() +
    BigInt(currentDatabaseOpenReservationTimeoutMilliseconds) *
      nanosecondsPerMillisecond;
  while (true) {
    try {
      return acquireCurrentDatabaseOpenReservationOnce(dataDirectory);
    } catch (error) {
      if (!isFileAlreadyExistsError(error)) throw error;
    }

    const directoryPin = pinApplicationDataDirectory(dataDirectory);
    let disappeared = false;
    try {
      assertActiveCompetingCurrentDatabaseOpenReservation(
        dataDirectory,
        directoryPin,
      );
    } catch (error) {
      if (isFileMissingError(error)) disappeared = true;
      else throw error;
    } finally {
      closeSync(directoryPin.descriptor);
    }
    if (disappeared) continue;

    const remainingNanoseconds = deadline - process.hrtime.bigint();
    if (remainingNanoseconds <= 0n) {
      throw new Error("Application data maintenance is incomplete");
    }
    const remainingMilliseconds = Number(
      (remainingNanoseconds + nanosecondsPerMillisecond - 1n) /
        nanosecondsPerMillisecond,
    );
    Atomics.wait(
      currentDatabaseOpenReservationWaitCell,
      0,
      0,
      Math.min(
        currentDatabaseOpenReservationWaitMilliseconds,
        remainingMilliseconds,
      ),
    );
  }
}

function releaseCurrentDatabaseOpenReservation(
  reservation: CurrentDatabaseOpenReservation,
) {
  let releaseError: unknown;
  try {
    assertPinnedApplicationDataDirectory(
      reservation.dataDirectory,
      reservation.directoryPin,
    );
    assertPinnedDescriptor(reservation.descriptor, reservation.pin, 1n, {
      exactContentMetadata: true,
    });
    assertPinnedFilePath(reservation.pin, 1n, { exactContentMetadata: true });
    unlinkSync(reservation.pin.path);
    fsyncSync(reservation.directoryPin.descriptor);
    // unlink() necessarily changes ctime together with nlink. Preserve every
    // other pinned property without treating that kernel-owned ctime update as
    // a replacement or content mutation.
    assertPinnedDescriptor(reservation.descriptor, reservation.pin, 0n);
    const released = fstatSync(reservation.descriptor, { bigint: true });
    if (
      released.size !== reservation.pin.details.size ||
      released.mtimeNs !== reservation.pin.details.mtimeNs
    ) throw new Error("Greenfield initialization entry changed");
    assertPinnedApplicationDataDirectory(
      reservation.dataDirectory,
      reservation.directoryPin,
    );
  } catch (error) {
    releaseError = error;
  }
  for (const descriptor of [
    reservation.descriptor,
    reservation.directoryPin.descriptor,
  ]) {
    try {
      closeSync(descriptor);
    } catch (error) {
      releaseError ??= error;
    }
  }
  if (releaseError) throw releaseError;
}

function assertCurrentDatabaseOpenReservation(
  reservation: CurrentDatabaseOpenReservation,
) {
  assertPinnedApplicationDataDirectory(
    reservation.dataDirectory,
    reservation.directoryPin,
  );
  assertPinnedDescriptor(reservation.descriptor, reservation.pin, 1n, {
    exactContentMetadata: true,
  });
  assertPinnedFilePath(reservation.pin, 1n, { exactContentMetadata: true });
}

function bestEffortEnsureGreenfieldFailureMarker(
  dataDirectory: string,
  opId: string,
) {
  let descriptor: number | undefined;
  try {
    if (!directoryEntryExists(dataDirectory)) {
      mkdirSync(dataDirectory, { mode: 0o700 });
    }
    assertApplicationDataDirectory(dataDirectory);
    const markerPath = join(dataDirectory, migrationIncompleteMarker);
    if (directoryEntryExists(markerPath)) return;
    descriptor = openSync(
      markerPath,
      fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_WRONLY |
        (fileConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify({
      contract: greenfieldMarkerContract,
      failed: true,
      opId,
    })}\n`, { encoding: "utf8" });
    fsyncSync(descriptor);
    const directory = openSync(
      dataDirectory,
      fileConstants.O_RDONLY |
        (fileConstants.O_DIRECTORY ?? 0) |
        (fileConstants.O_NOFOLLOW ?? 0),
    );
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } catch {
    // A foreign directory or marker is preserved. Startup remains fail-closed
    // whenever the best-effort marker could be installed.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function removeCapturedPathIfPresent(
  dataDirectory: string,
  directoryPin: GreenfieldDirectoryPin,
  pin: GreenfieldFilePin,
) {
  assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
  try {
    const actual = lstatSync(pin.path, { bigint: true });
    if (!samePinnedFileCore(actual, pin.details)) return false;
    unlinkSync(pin.path);
    return true;
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return true;
    throw error;
  }
}

function openPinnedGreenfieldDatabase(
  dataDirectory: string,
  directoryPin: GreenfieldDirectoryPin,
  markerPin: GreenfieldFilePin,
  markerDescriptor: number,
  databasePin: GreenfieldFilePin,
) {
  const databasePath = databasePin.path;
  assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
  exactDirectoryEntries(dataDirectory, [
    migrationIncompleteMarker,
    "unboundry.sqlite",
  ]);
  assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
  assertPinnedDescriptor(markerDescriptor, markerPin, 1n, {
    exactContentMetadata: true,
  });
  assertPinnedFilePath(databasePin, 1n, { exactContentMetadata: true });
  const database = new DatabaseSync(
    exactCurrentInspectionLocation(databasePath),
    { readOnly: true, timeout: 5_000 },
  );
  try {
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    assertPinnedFilePath(databasePin, 1n, { exactContentMetadata: true });
    assertExactCurrentDatabase(database);
    assertPinnedFilePath(databasePin, 1n, { exactContentMetadata: true });
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    exactDirectoryEntries(dataDirectory, [
      migrationIncompleteMarker,
      "unboundry.sqlite",
    ]);
    assertPinnedFilePath(databasePin, 1n, { exactContentMetadata: true });
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
  } finally {
    database.close();
  }
}

function exactCurrentContentDigest(database: DatabaseSync) {
  const hash = createHash("sha256");
  const objects = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    ORDER BY type, name
  `);
  objects.setReturnArrays(true);
  for (const row of objects.iterate() as Iterable<unknown[]>) {
    hash.update(JSON.stringify(row));
  }
  const tableNames = (database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table'
    ORDER BY name
  `).all() as Array<{ name?: unknown }>).map((row) => String(row.name));
  for (const tableName of tableNames) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
      throw new Error("Application database table name is unsafe");
    }
    hash.update(`table:${tableName}\n`);
    const rows = database.prepare(
      `SELECT * FROM "${tableName}" ORDER BY rowid`,
    );
    rows.setReturnArrays(true);
    for (const row of rows.iterate() as Iterable<unknown[]>) {
      hash.update(JSON.stringify(row, (_key, value) =>
        typeof value === "bigint" ? { $bigint: value.toString() }
        : Buffer.isBuffer(value) || value instanceof Uint8Array
        ? { $bytes: Buffer.from(value).toString("base64") }
        : value));
    }
  }
  return hash.digest("hex");
}

function openFinalPinnedGreenfieldWriter(
  dataDirectory: string,
  directoryPin: GreenfieldDirectoryPin,
  markerPin: GreenfieldFilePin,
  markerDescriptor: number,
  databasePin: GreenfieldFilePin,
  expectedDigest: string,
) {
  assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
  exactDirectoryEntries(dataDirectory, [
    migrationIncompleteMarker,
    "unboundry.sqlite",
  ]);
  assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
  assertPinnedDescriptor(markerDescriptor, markerPin, 1n, {
    exactContentMetadata: true,
  });
  assertPinnedFilePath(databasePin, 1n, { exactContentMetadata: true });
  const database = new DatabaseSync(databasePin.path, { timeout: 5_000 });
  let transactionOpen = false;
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    assertPinnedFilePath(databasePin, 1n, { exactContentMetadata: true });
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
    assertExactCurrentDatabase(database);
    if (exactCurrentContentDigest(database) !== expectedDigest) {
      throw new Error("Greenfield database content changed before final open");
    }
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    assertPinnedFilePath(databasePin, 1n, { exactContentMetadata: true });
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
    // Return with the write transaction held. The caller removes the marker,
    // revalidates content/identity, and only then commits this same connection.
    return database;
  } catch (error) {
    if (transactionOpen && database.isTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the pinned final-open failure.
      }
    }
    database.close();
    throw error;
  }
}

function assertFinalGreenfieldOpenEntries(
  dataDirectory: string,
  directoryPin: GreenfieldDirectoryPin,
  databasePin: GreenfieldFilePin,
  allowMarker = false,
) {
  assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
  const names = readdirSync(dataDirectory).sort();
  const allowed = new Set([
    "unboundry.sqlite",
    "unboundry.sqlite-shm",
    "unboundry.sqlite-wal",
  ]);
  if (allowMarker) allowed.add(migrationIncompleteMarker);
  if (
    !names.includes("unboundry.sqlite") ||
    (allowMarker && !names.includes(migrationIncompleteMarker)) ||
    names.some((name) => !allowed.has(name))
  ) throw new Error("Application data directory entries changed");
  assertPinnedFilePath(databasePin, 1n, { exactContentMetadata: true });
  for (const name of names) {
    if (name === "unboundry.sqlite" || name === migrationIncompleteMarker) {
      continue;
    }
    const details = lstatSync(join(dataDirectory, name), { bigint: true });
    if (
      !details.isFile() || details.isSymbolicLink() || details.nlink !== 1n ||
      typeof process.getuid !== "function" ||
      details.uid !== BigInt(process.getuid()) ||
      (details.mode & 0o022n) !== 0n
    ) throw new Error("Current database sidecar is unsafe");
  }
  assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
  assertPinnedFilePath(databasePin, 1n, { exactContentMetadata: true });
}

/**
 * Bootstrap a first-install database only from an already-provisioned private
 * data directory. Startup must not reinterpret a pre-existing empty, legacy,
 * linked or maintenance-blocked database as a greenfield installation; those
 * shapes remain owned by the read-only lifecycle probe and explicit recovery
 * roles. `openAppDatabase` performs the private build and atomic no-replace
 * publication after this eligibility check.
 */
export function initializeGreenfieldAppDatabaseAtProcessStartup(
  dataDirectory = appDataDirectory(),
) {
  try {
    if (!directoryEntryExists(dataDirectory)) return false;
    assertApplicationDataDirectory(dataDirectory);
    // Vite invokes this hook before media recovery or any business store. No
    // startup control entry is required at this point, so a genuine first
    // install is an entry-free directory. In particular, existing media,
    // secrets, backup residue, or an unknown name must not be paired with a
    // newly-created empty database after the original database is lost.
    if (readdirSync(dataDirectory).length !== 0) return false;
    if (
      directoryEntryExists(join(dataDirectory, "unboundry.sqlite")) ||
      directoryEntryExists(join(dataDirectory, ".unboundry-restore-incomplete")) ||
      directoryEntryExists(join(dataDirectory, migrationIncompleteMarker))
    ) return false;
  } catch {
    // Startup bootstrap is deliberately narrower than ordinary database open.
    // Inaccessible or unsafe state remains untouched and is classified by the
    // process-only liveness/read-only readiness path.
    return false;
  }

  const database = openAppDatabase(dataDirectory);
  try {
    assertExactCurrentDatabase(database);
  } finally {
    database.close();
  }
  return true;
}

export function openAppDatabase(
  dataDirectory = appDataDirectory(),
): DatabaseSync {
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  if (directoryEntryExists(dataDirectory)) {
    assertApplicationDataDirectory(dataDirectory);
  }
  for (const marker of [
    ".unboundry-restore-incomplete",
    migrationIncompleteMarker,
  ]) {
    if (directoryEntryExists(join(dataDirectory, marker))) {
      throw new Error("Application data maintenance is incomplete");
    }
  }

  if (directoryEntryExists(databasePath)) {
    // This read-only guard runs before any writer connection, journal pragma,
    // backfill or schema statement. Historic and counterfeit schemas therefore
    // fail without being upgraded by an ordinary API request.
    // The private O_EXCL reservation serializes every cooperative app/CLI open
    // from initial inspection through acquisition of SQLite's writer lock. The
    // directory is owner-only and the reservation is inode-pinned and durable;
    // an uncooperative process running as the same OS user remains outside this
    // cooperative boundary and is not claimed to be made impossible here.
    const reservation = acquireCurrentDatabaseOpenReservation(dataDirectory);
    let openedDatabase: DatabaseSync | undefined;
    let openFailure: unknown;
    try {
      const inspected = inspectExistingCurrentDatabase(databasePath);
      duringCurrentDatabaseOpenForTests?.(
        "before-writer-sidecar-validation",
        databasePath,
      );
      assertCurrentDatabaseOpenReservation(reservation);
      assertSameCurrentDatabaseIdentity(databasePath, inspected.details);
      assertCurrentDatabaseSidecarsBeforeWriterOpen(
        databasePath,
        inspected.sidecars,
      );
      const database = new DatabaseSync(databasePath, { timeout: 5_000 });
      let transactionOpen = false;
      try {
        database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
        database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentDatabaseOpenReservation(reservation);
        assertSameCurrentDatabaseIdentity(databasePath, inspected.details);
        assertCurrentDatabaseSidecarsAfterWriterLock(
          databasePath,
          inspected.sidecars,
        );
        // Close the read-only-check/writer-open TOCTOU under the write lock.
        assertExactCurrentDatabase(database);
        if (exactCurrentContentDigest(database) !== inspected.contentDigest) {
          throw new Error("Application database changed while opening");
        }
        assertSameCurrentDatabaseIdentity(databasePath, inspected.details);
        assertCurrentDatabaseSidecarsAfterWriterLock(
          databasePath,
          inspected.sidecars,
        );
        assertCurrentDatabaseOpenReservation(reservation);
        database.exec("COMMIT");
        transactionOpen = false;
        assertSameCurrentDatabaseIdentity(databasePath, inspected.details);
        openedDatabase = database;
      } catch (error) {
        if (transactionOpen && database.isTransaction) {
          try {
            database.exec("ROLLBACK");
          } catch {
            // Preserve the current-schema failure.
          }
        }
        database.close();
        throw error;
      }
    } catch (error) {
      openFailure = error;
    }
    try {
      releaseCurrentDatabaseOpenReservation(reservation);
    } catch (error) {
      openFailure ??= error;
    }
    if (openFailure) {
      if (openedDatabase) {
        try {
          openedDatabase.close();
        } catch {
          // Preserve the open/reservation failure.
        }
      }
      throw openFailure;
    }
    return openedDatabase!;
  }

  // Greenfield publication is a maintenance operation, not a fallback for a
  // missing database in an occupied directory. Pin the initially empty private
  // directory, publish an exclusive durable marker before building anything,
  // and keep that marker until the exact-current inode is fully validated.
  if (!directoryEntryExists(dataDirectory)) {
    mkdirSync(dataDirectory, { mode: 0o700 });
  }
  assertApplicationDataDirectory(dataDirectory);
  if (
    directoryEntryExists(join(dataDirectory, currentDatabaseOpenReservation))
  ) throw new Error("Application data maintenance is incomplete");
  const directoryPin = pinApplicationDataDirectory(dataDirectory);
  const opId = randomUUID();
  const markerPath = join(dataDirectory, migrationIncompleteMarker);
  const temporaryPath = join(
    dataDirectory,
    `.unboundry-greenfield-${opId}.sqlite`,
  );
  let markerDescriptor: number | undefined;
  let markerPin: GreenfieldFilePin | undefined;
  let temporaryDescriptor: number | undefined;
  let temporaryPin: GreenfieldFilePin | undefined;
  let database: DatabaseSync | undefined;
  let returnedDatabase: DatabaseSync | undefined;
  let expectedContentDigest: string | undefined;
  let transactionOpen = false;
  let rollbackProvedSafe = false;
  let destructiveRollbackAllowed = true;
  let terminalPublicationComplete = false;
  try {
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    exactDirectoryEntries(dataDirectory, []);

    const createdMarker = createPinnedGreenfieldFile(markerPath);
    markerDescriptor = createdMarker.descriptor;
    const markerDocument = `${JSON.stringify({
      contract: greenfieldMarkerContract,
      dataDirectory: {
        dev: directoryPin.details.dev.toString(),
        ino: directoryPin.details.ino.toString(),
        mode: directoryPin.details.mode.toString(8),
        uid: directoryPin.details.uid.toString(),
      },
      opId,
    })}\n`;
    writeFileSync(markerDescriptor, markerDocument, { encoding: "utf8" });
    fsyncSync(markerDescriptor);
    markerPin = Object.freeze({
      details: fstatSync(markerDescriptor, { bigint: true }),
      path: markerPath,
    });
    assertPrivateOwnedRegularFile(markerPin.details);
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
    fsyncSync(directoryPin.descriptor);
    duringGreenfieldDatabaseInitializationForTests?.("marker-published");
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    exactDirectoryEntries(dataDirectory, [migrationIncompleteMarker]);
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });

    const reservation = createPinnedGreenfieldFile(temporaryPath);
    temporaryDescriptor = reservation.descriptor;
    temporaryPin = Object.freeze({
      details: reservation.details,
      path: temporaryPath,
    });
    closeSync(temporaryDescriptor);
    temporaryDescriptor = undefined;
    duringGreenfieldDatabaseInitializationForTests?.("reservation-closed");
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    exactDirectoryEntries(dataDirectory, [
      migrationIncompleteMarker,
      basename(temporaryPath),
    ]);
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
    assertPinnedFilePath(temporaryPin, 1n, { exactContentMetadata: true });

    database = new DatabaseSync(temporaryPath, { timeout: 5_000 });
    database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;" +
        "PRAGMA busy_timeout = 5000;" +
        "CREATE TABLE IF NOT EXISTS schema_migrations (\n" +
        "      version INTEGER PRIMARY KEY,\n" +
        "      name TEXT NOT NULL,\n" +
        "      applied_at TEXT NOT NULL\n" +
        "    );",
    );
    database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    applyPendingSchemaMigrationsInTransaction(database, { sourceVersion: 0 });
    backfillLegacyMediaStrict(database, dataDirectory, {
      callerOwnsTransaction: true,
    });
    assertExactCurrentDatabase(database);
    expectedContentDigest = exactCurrentContentDigest(database);
    database.exec("COMMIT");
    transactionOpen = false;
    database.close();
    database = undefined;

    temporaryDescriptor = openSync(
      temporaryPath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    );
    const completedTemporary = fstatSync(temporaryDescriptor, { bigint: true });
    assertPrivateOwnedRegularFile(completedTemporary);
    if (!samePinnedFileCore(completedTemporary, temporaryPin.details)) {
      throw new Error("Greenfield initialization entry changed");
    }
    temporaryPin = Object.freeze({
      details: completedTemporary,
      path: temporaryPath,
    });
    fsyncSync(temporaryDescriptor);
    duringGreenfieldDatabaseInitializationForTests?.("database-closed");
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    exactDirectoryEntries(dataDirectory, [
      migrationIncompleteMarker,
      basename(temporaryPath),
    ]);
    assertPinnedDescriptor(temporaryDescriptor, temporaryPin, 1n, {
      exactContentMetadata: true,
    });
    assertPinnedFilePath(temporaryPin, 1n, { exactContentMetadata: true });
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });

    // link(2) is an atomic no-replace publication on this pinned filesystem.
    linkSync(temporaryPath, databasePath);
    fsyncSync(directoryPin.descriptor);
    afterGreenfieldDatabasePublishForTests?.(databasePath);
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    exactDirectoryEntries(dataDirectory, [
      migrationIncompleteMarker,
      basename(temporaryPath),
      "unboundry.sqlite",
    ]);
    const linkedDetails = fstatSync(temporaryDescriptor, { bigint: true });
    assertPrivateOwnedRegularFile(linkedDetails);
    if (
      !samePinnedFileCore(linkedDetails, temporaryPin.details) ||
      linkedDetails.nlink !== 2n ||
      linkedDetails.size !== temporaryPin.details.size ||
      linkedDetails.mtimeNs !== temporaryPin.details.mtimeNs
    ) throw new Error("Greenfield publication identity mismatch");
    const linkedPin = Object.freeze({
      details: linkedDetails,
      path: temporaryPath,
    });
    assertPinnedDescriptor(temporaryDescriptor, linkedPin, 2n, {
      exactContentMetadata: true,
    });
    const privateLink = assertPinnedFilePath(linkedPin, 2n, {
      exactContentMetadata: true,
    });
    const publishedPin = Object.freeze({
      details: linkedPin.details,
      path: databasePath,
    });
    const publicLink = assertPinnedFilePath(publishedPin, 2n, {
      exactContentMetadata: true,
    });
    if (
      privateLink.dev !== publicLink.dev || privateLink.ino !== publicLink.ino
    ) throw new Error("Greenfield publication identity mismatch");
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });

    removeCapturedPathIfPresent(dataDirectory, directoryPin, linkedPin);
    fsyncSync(directoryPin.descriptor);
    const publishedDetails = fstatSync(temporaryDescriptor, { bigint: true });
    assertPrivateOwnedRegularFile(publishedDetails);
    if (
      !samePinnedFileCore(publishedDetails, linkedPin.details) ||
      publishedDetails.nlink !== 1n ||
      publishedDetails.size !== linkedPin.details.size ||
      publishedDetails.mtimeNs !== linkedPin.details.mtimeNs
    ) throw new Error("Greenfield publication identity mismatch");
    const singlyLinkedPublishedPin = Object.freeze({
      details: publishedDetails,
      path: databasePath,
    });
    assertPinnedDescriptor(temporaryDescriptor, singlyLinkedPublishedPin, 1n, {
      exactContentMetadata: true,
    });
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    exactDirectoryEntries(dataDirectory, [
      migrationIncompleteMarker,
      "unboundry.sqlite",
    ]);
    assertPinnedFilePath(singlyLinkedPublishedPin, 1n, {
      exactContentMetadata: true,
    });
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });

    openPinnedGreenfieldDatabase(
      dataDirectory,
      directoryPin,
      markerPin,
      markerDescriptor,
      singlyLinkedPublishedPin,
    );
    if (!expectedContentDigest) {
      throw new Error("Greenfield database content digest is unavailable");
    }
    returnedDatabase = openFinalPinnedGreenfieldWriter(
      dataDirectory,
      directoryPin,
      markerPin,
      markerDescriptor,
      singlyLinkedPublishedPin,
      expectedContentDigest,
    );
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    assertFinalGreenfieldOpenEntries(
      dataDirectory,
      directoryPin,
      singlyLinkedPublishedPin,
      true,
    );
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
    assertExactCurrentDatabase(returnedDatabase);
    if (exactCurrentContentDigest(returnedDatabase) !== expectedContentDigest) {
      throw new Error("Greenfield database content changed before final commit");
    }
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    assertPinnedFilePath(singlyLinkedPublishedPin, 1n, {
      exactContentMetadata: true,
    });
    // A COMMIT attempt can be durably successful even if surfacing its result
    // fails. From this point onward the published inode is never removed; every
    // failure retains or recreates the maintenance marker fail-closed.
    destructiveRollbackAllowed = false;
    returnedDatabase.exec("COMMIT");
    assertExactCurrentDatabase(returnedDatabase);
    if (exactCurrentContentDigest(returnedDatabase) !== expectedContentDigest) {
      throw new Error("Greenfield database content changed after final commit");
    }
    assertFinalGreenfieldOpenEntries(
      dataDirectory,
      directoryPin,
      singlyLinkedPublishedPin,
      true,
    );
    assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
    assertPinnedFilePath(singlyLinkedPublishedPin, 1n, {
      exactContentMetadata: true,
    });
    assertPinnedDescriptor(markerDescriptor, markerPin, 1n, {
      exactContentMetadata: true,
    });
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
    duringGreenfieldDatabaseInitializationForTests?.(
      "final-validation-complete",
    );

    // This is the publication point. No fallible product validation follows:
    // remove only the still-pinned marker, durably publish that removal, and
    // return the already-validated writer connection immediately.
    assertPinnedDescriptor(markerDescriptor, markerPin, 1n, {
      exactContentMetadata: true,
    });
    assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
    unlinkSync(markerPath);
    fsyncSync(directoryPin.descriptor);
    terminalPublicationComplete = true;
    return returnedDatabase!;
  } catch (error) {
    if (transactionOpen && database?.isTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the initialization failure.
      }
    }
    try {
      database?.close();
    } catch {
      // Preserve the initialization failure.
    }
    database = undefined;
    try {
      if (returnedDatabase?.isTransaction) returnedDatabase.exec("ROLLBACK");
      returnedDatabase?.close();
    } catch {
      // Preserve the initialization failure.
    }
    returnedDatabase = undefined;

    if (!destructiveRollbackAllowed) {
      bestEffortEnsureGreenfieldFailureMarker(dataDirectory, opId);
    } else if (markerPin && temporaryPin) {
      try {
        assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
        const publishedPin = Object.freeze({
          details: temporaryPin.details,
          path: databasePath,
        });
        removeCapturedPathIfPresent(dataDirectory, directoryPin, publishedPin);
        removeCapturedPathIfPresent(dataDirectory, directoryPin, temporaryPin);
        fsyncSync(directoryPin.descriptor);
        assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
        exactDirectoryEntries(dataDirectory, [migrationIncompleteMarker]);
        if (markerDescriptor === undefined) {
          throw new Error("Greenfield marker descriptor is unavailable");
        }
        assertPinnedDescriptor(markerDescriptor, markerPin, 1n, {
          exactContentMetadata: true,
        });
        assertPinnedFilePath(markerPin, 1n, { exactContentMetadata: true });
        if (directoryEntryExists(databasePath)) {
          throw new Error("Greenfield rollback left a public database");
        }
        unlinkSync(markerPath);
        fsyncSync(directoryPin.descriptor);
        assertPinnedDescriptor(markerDescriptor, markerPin, 0n);
        assertPinnedApplicationDataDirectory(dataDirectory, directoryPin);
        exactDirectoryEntries(dataDirectory, []);
        rollbackProvedSafe = true;
      } catch {
        // Foreign entries, replacement directories, markers and sidecars are
        // retained. The marker below keeps current-path startup fail-closed.
      }
    }
    if (destructiveRollbackAllowed && !rollbackProvedSafe) {
      bestEffortEnsureGreenfieldFailureMarker(dataDirectory, opId);
    }
    throw error;
  } finally {
    for (const descriptor of [
      temporaryDescriptor,
      markerDescriptor,
      directoryPin.descriptor,
    ]) {
      if (descriptor === undefined) continue;
      try {
        closeSync(descriptor);
      } catch {
        // All descriptors are fsynced before the terminal marker unlink. Once
        // publication is complete, a close error must not turn success into an
        // unmarked failure; before then, the primary error/marker is preserved.
        if (!terminalPublicationComplete) {
          bestEffortEnsureGreenfieldFailureMarker(dataDirectory, opId);
        }
      }
    }
  }
}
