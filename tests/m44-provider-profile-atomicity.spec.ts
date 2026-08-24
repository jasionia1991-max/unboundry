import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { saveAccountCredential } from "../server/accountCredentials";
import { currentSchemaVersion, openAppDatabase } from "../server/database";
import { executeTextTaskWithDependencies } from "../server/generationTasks";
import {
  createGenerationTaskStore,
  generationProviderAttemptCounts,
} from "../server/generationTaskStore";
import {
  acquireProviderGenerationRequestLease,
  getProviderGenerationProfileState,
  getProviderProfile,
  getProviderProfileForGeneration,
  prepareArkControlPlaneCredentials,
  providerConfigurationVersion,
  ProviderProfileInUseError,
  saveArkControlPlaneCredentials,
  saveProviderProfile,
  verifyProviderProfile,
  type ProviderProfile,
} from "../server/providerProfiles";

const childBootstrap = `
  import { createServer } from "vite";
  const startAt = Number(process.argv[1]);
  const mode = process.argv[2];
  const server = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { hmr: false, middlewareMode: true, ws: false },
  });
  try {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, startAt - Date.now()))
    );
    if (mode === "save" || mode === "save-paused") {
      const profileId = process.argv[3];
      const label = process.argv[4];
      const module = await server.ssrLoadModule("/server/providerProfiles.ts");
      if (mode === "save-paused") {
        const readyPath = process.argv[5];
        const releasePath = process.argv[6];
        const { access, writeFile } = await import("node:fs/promises");
        module.setProviderProfileAfterDocumentWriteHookForTests(async () => {
          await writeFile(readyPath, "document-renamed", { flag: "wx" });
          while (true) {
            try {
              await access(releasePath);
              break;
            } catch {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          }
        });
      }
      const profile = await module.saveProviderProfile({
        apiKey: mode === "save-paused" ? process.argv[7] : "",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
        label,
      }, profileId);
      process.stdout.write(JSON.stringify({
        id: profile.id,
        label: profile.label,
        pid: process.pid,
        version: profile.configurationVersion,
      }));
    } else if (mode === "release") {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(process.argv[3], "continue", { flag: "wx" });
      process.stdout.write(JSON.stringify({ pid: process.pid, released: true }));
    } else {
      const module = await server.ssrLoadModule("/server/database.ts");
      const database = module.openAppDatabase(process.env.UNBOUNDRY_DATA_DIR);
      const version = database.prepare("PRAGMA user_version").get().user_version;
      database.close();
      process.stdout.write(JSON.stringify({ pid: process.pid, version }));
    }
  } finally {
    await server.close();
  }
`;

function runChild(
  dataDirectory: string,
  startAt: number,
  mode: "migrate" | "release" | "save" | "save-paused",
  ...args: string[]
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        childBootstrap,
        String(startAt),
        mode,
        ...args,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          UNBOUNDRY_DATA_DIR: dataDirectory,
          ...(mode === "save-paused"
            ? { UNBOUNDRY_TEST_PROVIDER_PROFILE_BARRIER: "1" }
            : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Provider child exited with ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error(`Provider child returned invalid output: ${stdout}\n${stderr}`));
      }
    });
  });
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPath(path: string) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await delay(10);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function within<T>(promise: Promise<T>, milliseconds = 5_000) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Provider lock test timed out")), milliseconds)
    ),
  ]);
}

function restoreDataDirectory(previous: string | undefined) {
  if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
  else process.env.UNBOUNDRY_DATA_DIR = previous;
}

function rollbackMigration39To38(database: DatabaseSync) {
  if (Number((database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  }).user_version) === 40) {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE seedance_asset_bindings;
      DROP TABLE seedance_authorization_sessions;
      DROP TABLE seedance_identity_groups;
      DROP INDEX media_assets_owner_kind_id;
      DELETE FROM schema_migrations WHERE version = 40;
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

test("two OS processes serialize complete Provider saves and metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-provider-os-save-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    openAppDatabase(directory).close();
    const initial = await saveProviderProfile({
      apiKey: `ark-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Initial",
    });
    const startAt = Date.now() + 500;
    const children = await Promise.all([
      runChild(directory, startAt, "save", initial.id, "OS writer A"),
      runChild(directory, startAt, "save", initial.id, "OS writer B"),
    ]);
    expect(new Set(children.map((item) => item.pid)).size).toBe(2);

    const stored = await getProviderProfile(initial.id);
    expect(stored?.configurationVersion).toBe(3);
    expect(["OS writer A", "OS writer B"]).toContain(stored?.label);
    const database = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(database.prepare(`
        SELECT display_name, driver, key_status,
          provider_configuration_version, status
        FROM provider_profiles WHERE id = ?
      `).get(initial.id)).toEqual({
        display_name: stored?.label,
        driver: "volcengine-ark",
        key_status: "unchecked",
        provider_configuration_version: stored?.configurationVersion,
        status: "disabled",
      });
    } finally {
      database.close();
    }
  } finally {
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("split document and metadata versions block a real task before fake fetch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-provider-split-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    openAppDatabase(directory).close();
    const original = await saveProviderProfile({
      apiKey: `ark-old-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Ark split",
    });
    await verifyProviderProfile(original.id, async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const updated = await saveProviderProfile({
      apiKey: `ark-new-${randomUUID()}`,
      baseUrl: original.baseUrl,
      driver: original.driver,
      label: original.label,
    }, original.id);

    // This is the durable state left by a crash after the encrypted rename but
    // before the metadata transaction: new document, old green metadata.
    const database = new DatabaseSync(join(directory, "unboundry.sqlite"));
    database.prepare(`
      UPDATE provider_profiles
      SET provider_configuration_version = ?, status = 'enabled',
        key_status = 'valid'
      WHERE id = ?
    `).run(providerConfigurationVersion(original), original.id);
    database.close();

    await expect(getProviderProfileForGeneration(original.id, "__test__")).rejects
      .toMatchObject({ code: "PROVIDER_CONFIGURATION_MISMATCH" });
    expect(
      await getProviderGenerationProfileState(original.id, "__test__"),
    ).toMatchObject({
      configurationAligned: false,
      documentConfigurationVersion: providerConfigurationVersion(updated),
      metadataConfigurationVersion: providerConfigurationVersion(original),
      reason: "configuration-mismatch",
    });

    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "split-brain-text-task",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-split-target",
      ownerId: "__test__",
      parameters: { inputs: [], outputCount: 1, responseFormat: "text" },
      prompt: "不得发出请求",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: original.id,
    });
    let providerCalls = 0;
    await executeTextTaskWithDependencies(created.task.id, {
      fetcher: async () => {
        providerCalls += 1;
        return new Response("{}", { status: 200 });
      },
      acquireProfile: acquireProviderGenerationRequestLease,
      mediaUrlForOwner: async () => "unused",
      store,
    });
    expect(providerCalls).toBe(0);
    expect(store.get(created.task.id)).toMatchObject({
      errorCode: "PROVIDER_CONFIGURATION_MISMATCH",
      state: "failed",
    });
    const attemptsDatabase = openAppDatabase(directory);
    try {
      expect(generationProviderAttemptCounts(attemptsDatabase)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 0,
      });
    } finally {
      attemptsDatabase.close();
    }
    store.close();
  } finally {
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("frozen Provider and credential revisions reject a newer lease before fake fetch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-provider-frozen-lease-"));
  const frozenProviderVersion = 7;
  const frozenCredentialRevision = 11;
  const profile = {
    apiKey: "fixture-frozen-lease-secret",
    baseUrl: "https://relay.example.test/v1",
    configurationVersion: frozenProviderVersion,
    createdAt: "2026-08-11T00:00:00.000Z",
    driver: "multi-protocol-relay",
    id: "frozen-lease-profile",
    label: "Frozen lease profile",
    updatedAt: "2026-08-11T00:00:00.000Z",
  } satisfies ProviderProfile;
  const store = createGenerationTaskStore(directory);
  try {
    const cases = [
      {
        expectedCode: "PROVIDER_CONFIGURATION_MISMATCH",
        expectedMessage: "平台连接配置已变化，已阻止旧任务继续请求",
        id: "provider-version",
        lease: {
          credentialRevision: frozenCredentialRevision,
          profile: {
            ...profile,
            configurationVersion: frozenProviderVersion + 1,
          },
        },
      },
      {
        expectedCode: "ACCOUNT_CREDENTIAL_CHANGED",
        expectedMessage: "你的平台密钥已变更，请重新提交",
        id: "credential-revision",
        lease: {
          credentialRevision: frozenCredentialRevision + 1,
          profile,
        },
      },
    ] as const;
    let fakeFetches = 0;
    for (const fixture of cases) {
      const created = store.create({
        canvasId: "frozen-lease-canvas",
        credentialRevision: frozenCredentialRevision,
        idempotencyKey: `frozen-lease-${fixture.id}-0001`,
        kind: "text",
        modelConfiguration: {
          credentialVersion: frozenCredentialRevision,
          providerConfigurationVersion: frozenProviderVersion,
          providerDriver: "multi-protocol-relay",
          providerProtocol: "openai-chat",
        },
        nodeId: `frozen-lease-${fixture.id}-node`,
        ownerId: "__test__",
        parameters: { inputSchemaVersion: 1, inputs: [] },
        prompt: "must fail before fake fetch",
        providerModelId: "relay-text-model",
        providerProfileId: profile.id,
      });
      await executeTextTaskWithDependencies(created.task.id, {
        acquireProfile: async () => ({
          ...fixture.lease,
          release() {},
        }),
        fetcher: async () => {
          fakeFetches += 1;
          return Response.json({});
        },
        mediaUrlForOwner: async () => "unused",
        store,
      });
      expect(store.get(created.task.id)).toMatchObject({
        errorCode: fixture.expectedCode,
        errorMessage: fixture.expectedMessage,
        state: "failed",
      });
      expect(store.getProviderAttemptForTask(created.task.id)).toBeUndefined();
    }
    expect(fakeFetches).toBe(0);
    const database = openAppDatabase(directory);
    try {
      expect(generationProviderAttemptCounts(database)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 0,
      });
    } finally {
      database.close();
    }
  } finally {
    store.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("an active paid request blocks Provider mutation until its response is settled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-provider-fetch-lease-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  let store: ReturnType<typeof createGenerationTaskStore> | undefined;
  let execution: Promise<void> | undefined;
  let finishFetch = (_response: Response) => {};
  try {
    openAppDatabase(directory).close();
    const profile = await saveProviderProfile({
      apiKey: `ark-old-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Fetch lease profile",
    });
    const credentialStore = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    credentialStore
      .prepare(`
        INSERT OR IGNORE INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES ('__test__', '__test__', 'Test User', 'test-only', 'admin', 'active', ?, ?)
      `)
      .run(timestamp, timestamp);
    await saveAccountCredential(
      credentialStore,
      "__test__",
      profile.id,
      "sk-lease-credential-1234",
    );
    credentialStore.close();
    await verifyProviderProfile(profile.id, "__test__", async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 }));
    store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "fetch-lease-text-task",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-fetch-lease-target",
      ownerId: "__test__",
      parameters: { inputs: [], outputCount: 1, responseFormat: "text" },
      prompt: "请求已发出后阻止管理员改写连接",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: profile.id,
    });
    let fetchStarted = () => {};
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    const pendingResponse = new Promise<Response>((resolve) => {
      finishFetch = resolve;
    });
    execution = executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: acquireProviderGenerationRequestLease,
      fetcher: () => {
        fetchStarted();
        return pendingResponse;
      },
      mediaUrlForOwner: async () => "unused",
      store,
    });
    await within(started);

    const rotatedApiKey = `ark-new-${randomUUID()}`;
    await expect(within(saveProviderProfile({
      apiKey: rotatedApiKey,
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: profile.label,
    }, profile.id))).rejects.toThrow(ProviderProfileInUseError);
    expect(providerConfigurationVersion(
      (await getProviderProfile(profile.id))!,
    )).toBe(providerConfigurationVersion(profile));

    finishFetch(new Response(JSON.stringify({
      output: [{
        content: [{ text: "已完成", type: "output_text" }],
        status: "completed",
        type: "message",
      }],
      status: "completed",
      usage: { total_tokens: 1 },
    }), { status: 200 }));
    await within(execution);
    expect(store.get(created.task.id)).toMatchObject({
      resultText: "已完成",
      state: "success",
    });
    const saved = await within(saveProviderProfile({
      apiKey: rotatedApiKey,
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: profile.label,
    }, profile.id));
    expect(providerConfigurationVersion(saved)).toBe(
      providerConfigurationVersion(profile) + 1,
    );
  } finally {
    finishFetch(new Response("{}", { status: 500 }));
    await execution?.catch(() => undefined);
    store?.close();
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("a request lease waits across the document-to-metadata window without using either mismatched Key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-provider-reader-lock-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  const readyPath = join(directory, "provider-writer.ready");
  const releasePath = join(directory, "provider-writer.release");
  let writer: Promise<Record<string, unknown>> | undefined;
  let store: ReturnType<typeof createGenerationTaskStore> | undefined;
  try {
    openAppDatabase(directory).close();
    const profile = await saveProviderProfile({
      apiKey: `ark-old-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Reader lock profile",
    });
    const credentialStore = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    credentialStore
      .prepare(`
        INSERT OR IGNORE INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES ('__test__', '__test__', 'Test User', 'test-only', 'admin', 'active', ?, ?)
      `)
      .run(timestamp, timestamp);
    await saveAccountCredential(
      credentialStore,
      "__test__",
      profile.id,
      "sk-reader-credential-1234",
    );
    credentialStore.close();
    await verifyProviderProfile(profile.id, "__test__", async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 }));
    store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "reader-lock-text-task",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-reader-lock-target",
      ownerId: "__test__",
      parameters: { inputs: [], outputCount: 1, responseFormat: "text" },
      prompt: "锁内不得发出请求",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: profile.id,
    });

    writer = runChild(
      directory,
      Date.now(),
      "save-paused",
      profile.id,
      "Rotated while reader waits",
      readyPath,
      releasePath,
      `ark-new-${randomUUID()}`,
    );
    await waitForPath(readyPath);

    let providerCalls = 0;
    const releaser = runChild(
      directory,
      Date.now() + 150,
      "release",
      releasePath,
    );
    const execution = executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: acquireProviderGenerationRequestLease,
      fetcher: async () => {
        providerCalls += 1;
        return new Response("{}", { status: 200 });
      },
      mediaUrlForOwner: async () => "unused",
      store,
    });
    const [saved] = await within(
      Promise.all([writer, execution, releaser]),
      10_000,
    );
    expect(saved.version).toBe(2);
    expect(providerCalls).toBe(0);
    expect(store.get(created.task.id)).toMatchObject({
      errorCode: "PROVIDER_REVERIFY_REQUIRED",
      state: "failed",
    });
    const database = openAppDatabase(directory);
    try {
      expect(generationProviderAttemptCounts(database).paidProviderRequests).toBe(0);
    } finally {
      database.close();
    }
  } finally {
    await writeFile(releasePath, "continue").catch(() => undefined);
    await writer?.catch(() => undefined);
    store?.close();
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("version zero and metadata-ahead states fail closed without losing usable snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-provider-align-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    openAppDatabase(directory).close();
    const profile = await saveProviderProfile({
      apiKey: `ark-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Ark align",
    });
    await saveArkControlPlaneCredentials(profile.id, {
      accessKeyId: `AKLT${randomUUID().replaceAll("-", "")}`,
      projectName: "default",
      secretAccessKey: `secret-${randomUUID()}`,
    });
    const documentProfile = await getProviderProfile(profile.id);
    expect(documentProfile?.arkControlPlane).toBeTruthy();
    const snapshot = JSON.stringify([{ discoveryId: "kept-model" }]);
    const syncedAt = "2026-08-03T10:00:00.000Z";
    const database = new DatabaseSync(join(directory, "unboundry.sqlite"));
    database.prepare(`
      UPDATE provider_profiles
      SET provider_configuration_version = 0,
        status = 'enabled', key_status = 'valid',
        catalog_key_status = 'valid', catalog_checked_at = ?,
        catalog_synced_at = ?, catalog_models = ?, catalog_model_count = 1
      WHERE id = ?
    `).run(syncedAt, syncedAt, snapshot, profile.id);
    database.close();

    await prepareArkControlPlaneCredentials(profile.id);
    const aligned = new DatabaseSync(join(directory, "unboundry.sqlite"));
    try {
      expect(aligned.prepare(`
        SELECT status, key_status, catalog_key_status, catalog_models,
          catalog_synced_at, provider_configuration_version
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        catalog_key_status: "unchecked",
        catalog_models: snapshot,
        catalog_synced_at: syncedAt,
        key_status: "unchecked",
        provider_configuration_version:
          providerConfigurationVersion(documentProfile!),
        status: "disabled",
      });

      aligned.prepare(`
        UPDATE provider_profiles
        SET provider_configuration_version = 0, driver = 'openrouter',
          status = 'enabled', key_status = 'valid',
          catalog_key_status = 'valid', catalog_checked_at = ?,
          catalog_synced_at = ?, catalog_models = ?, catalog_model_count = 1
        WHERE id = ?
      `).run(syncedAt, syncedAt, snapshot, profile.id);
    } finally {
      aligned.close();
    }
    await prepareArkControlPlaneCredentials(profile.id);
    const cleared = new DatabaseSync(join(directory, "unboundry.sqlite"));
    try {
      expect(cleared.prepare(`
        SELECT driver, status, key_status, catalog_key_status,
          catalog_models, catalog_synced_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        catalog_key_status: "unchecked",
        catalog_models: "[]",
        catalog_synced_at: null,
        driver: "volcengine-ark",
        key_status: "unchecked",
        status: "disabled",
      });
      cleared.prepare(`
        UPDATE provider_profiles
        SET provider_configuration_version = ?, status = 'enabled',
          key_status = 'valid', catalog_key_status = 'valid',
          catalog_models = ?, catalog_model_count = 1,
          catalog_synced_at = ?
        WHERE id = ?
      `).run(
        providerConfigurationVersion(documentProfile!) + 10,
        snapshot,
        syncedAt,
        profile.id,
      );
    } finally {
      cleared.close();
    }

    await expect(prepareArkControlPlaneCredentials(profile.id)).rejects
      .toMatchObject({ code: "PROVIDER_CONFIGURATION_MISMATCH" });
    const ahead = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(ahead.prepare(`
        SELECT status, key_status, catalog_key_status,
          catalog_last_error_code, provider_configuration_version
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        catalog_key_status: "unchecked",
        catalog_last_error_code: "CONFIGURATION_MISMATCH",
        key_status: "unchecked",
        provider_configuration_version:
          providerConfigurationVersion(documentProfile!) + 10,
        status: "disabled",
      });
    } finally {
      ahead.close();
    }
    await expect(getProviderProfileForGeneration(profile.id, "__test__")).rejects
      .toMatchObject({ code: "PROVIDER_CONFIGURATION_MISMATCH" });
  } finally {
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("a late old Key check cannot write green after the metadata CAS changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-provider-key-cas-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    openAppDatabase(directory).close();
    const profile = await saveProviderProfile({
      apiKey: `openrouter-${randomUUID()}`,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "CAS profile",
    });
    const validResponse = () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
    });
    await verifyProviderProfile(profile.id, async () => validResponse());

    let release = () => {};
    let started = () => {};
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    const requestReleased = new Promise<void>((resolve) => { release = resolve; });
    const late = verifyProviderProfile(profile.id, async () => {
      started();
      await requestReleased;
      return validResponse();
    });
    await requestStarted;
    const database = new DatabaseSync(join(directory, "unboundry.sqlite"));
    database.prepare(`
      UPDATE provider_profiles
      SET provider_configuration_version = provider_configuration_version + 1,
        status = 'disabled', key_status = 'unchecked', key_checked_at = NULL
      WHERE id = ?
    `).run(profile.id);
    database.close();
    release();
    await expect(late).rejects.toThrow("CONFIG_CHANGED");

    const checked = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(checked.prepare(`
        SELECT status, key_status, key_checked_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        key_checked_at: null,
        key_status: "unchecked",
        status: "disabled",
      });
    } finally {
      checked.close();
    }
  } finally {
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("two OS processes cooperatively open the exact current database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-provider-open-"));
  try {
    openAppDatabase(directory).close();
    const snapshot = () => {
      const database = new DatabaseSync(join(directory, "unboundry.sqlite"), {
        readOnly: true,
      });
      try {
        return {
          ledger: database.prepare(`
            SELECT version, name, applied_at
            FROM schema_migrations ORDER BY version
          `).all(),
          schema: database.prepare(`
            SELECT type, name, tbl_name, sql
            FROM sqlite_schema ORDER BY type, name
          `).all(),
          userVersion: database.prepare("PRAGMA user_version").get(),
        };
      } finally {
        database.close();
      }
    };
    const before = snapshot();

    const startAt = Date.now() + 500;
    const opened = await Promise.all([
      runChild(directory, startAt, "migrate"),
      runChild(directory, startAt, "migrate"),
    ]);
    expect(new Set(opened.map((item) => item.pid)).size).toBe(2);
    expect(new Set(opened.map((item) => item.version))).toEqual(
      new Set([currentSchemaVersion]),
    );
    expect(snapshot()).toEqual(before);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
