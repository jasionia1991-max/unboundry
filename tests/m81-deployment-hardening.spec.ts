import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { request as openHttpRequest } from "node:http";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { databaseMatchesFrozenSchema38Contract } from "../server/backupInspection";
import { saveAccountCredential } from "../server/accountCredentials";
import {
  currentSchemaManifest,
  currentSchemaVersion,
  openAppDatabase,
} from "../server/database";
import {
  createGenerationTaskStore,
  GenerationProviderAttemptBlockedError,
} from "../server/generationTaskStore";
import { saveProviderProfile } from "../server/providerProfiles";
import {
  coordinateRuntimeShutdown,
  createRuntimeLifecycle,
  type ShutdownResult,
} from "../server/runtimeLifecycle";
import { knownModelParameterSchema } from "../types/modelParameters";
import { expect, test } from "./safe-test";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");
const capturedOutput = new WeakMap<ChildProcess, string[]>();

function childExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function waitForChildExit(
  child: ChildProcess,
  milliseconds: number,
  message: string,
) {
  if (childExited(child)) return Promise.resolve();
  return withTimeout(
    new Promise<void>((resolve) => {
      const finish = () => resolve();
      child.once("exit", finish);
      if (childExited(child)) {
        child.removeListener("exit", finish);
        resolve();
      }
    }),
    milliseconds,
    message,
  );
}

async function startServer(
  dataDirectory: string,
  options: {
    captureOutput?: boolean;
    environment?: NodeJS.ProcessEnv;
    preview?: boolean;
    waitPath?: string;
  } = {},
) {
  const child = spawn(
    process.execPath,
    [
      vite,
      ...(options.preview ? ["preview"] : []),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_TEST_AUTH_BYPASS: undefined,
        UNBOUNDRY_TRUST_PROXY: "1",
        ...options.environment,
      },
      stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "ignore",
    },
  );
  if (options.captureOutput) {
    const output: string[] = [];
    capturedOutput.set(child, output);
    child.stdout?.on("data", (chunk) => output.push(String(chunk)));
    child.stderr?.on("data", (chunk) => output.push(String(chunk)));
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (childExited(child)) break;
    try {
      if ((await fetch(`${origin}${options.waitPath ?? "/api/health/live"}`, {
        signal: AbortSignal.timeout(500),
      })).ok) {
        return child;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopServer(child);
  throw new Error(
    `M81 deployment hardening server did not start\n${
      capturedOutput.get(child)?.join("") ?? ""
    }`,
  );
}

async function stopServer(child: ChildProcess) {
  if (childExited(child)) return;
  const gracefulExit = waitForChildExit(
    child,
    5_000,
    "server did not stop after SIGTERM",
  );
  child.kill("SIGTERM");
  try {
    await gracefulExit;
  } catch {
    if (childExited(child)) return;
    const forcedExit = waitForChildExit(
      child,
      5_000,
      "server did not stop after SIGKILL",
    );
    child.kill("SIGKILL");
    await forcedExit;
  }
}

function outputOf(child: ChildProcess) {
  return capturedOutput.get(child)?.join("") ?? "";
}

function rawHttp(requestText: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.end(requestText);
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
    socket.setTimeout(5_000, () => {
      socket.destroy(new Error("raw HTTP request timed out"));
    });
  });
}

function slowChunkedHttp(requestHead: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(requestHead);
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("close", () => resolve(response));
    socket.on("error", reject);
    socket.setTimeout(5_000, () => {
      socket.destroy(new Error("slow chunked request was not closed"));
    });
  });
}

function openServerEventStream() {
  return new Promise<{
    close: () => void;
    closed: Promise<void>;
    status: number;
    text: () => string;
  }>((resolve, reject) => {
    const request = openHttpRequest(`${origin}/api/updates`, (response) => {
      let body = "";
      let settled = false;
      let settleClosed: (() => void) | undefined;
      const closed = new Promise<void>((resolveClosed) => {
        settleClosed = resolveClosed;
      });
      const finish = () => {
        if (settled) return;
        settled = true;
        settleClosed?.();
      };
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.once("aborted", finish);
      response.once("close", finish);
      response.once("end", finish);
      response.once("error", finish);
      resolve({
        close: () => response.destroy(),
        closed,
        status: response.statusCode ?? 0,
        text: () => body,
      });
    });
    request.once("error", reject);
    request.end();
  });
}

async function expectMissing(path: string) {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function optionalFileSize(path: string) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) return 0;
    throw error;
  }
}

async function directoryFingerprint(root: string) {
  const entries: string[] = [];
  async function visit(directory: string, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push(`d:${relativePath}`);
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const metadata = await stat(absolutePath);
        entries.push(
          `f:${relativePath}:${metadata.size}:${await sha256(absolutePath)}`,
        );
      } else {
        entries.push(`o:${relativePath}`);
      }
    }
  }
  await visit(root);
  return entries.sort();
}

const startupProviderFixtureLogName =
  ".unboundry-startup-provider-fixture.log";

async function seedQueuedStartupGenerationFixture(
  dataDirectory: string,
  fixtureId: string,
) {
  await mkdir(dataDirectory, { recursive: true });
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  try {
    const profile = await saveProviderProfile({
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: `M81 startup ${fixtureId}`,
    });
    const database = openAppDatabase(dataDirectory);
    const ownerId = `${fixtureId}-owner`;
    const textModelId = `${fixtureId}-text-model`;
    const textProviderModelId = "doubao-seed-2-0-lite-260428";
    const videoModelId = `${fixtureId}-video-model`;
    const videoProviderModelId = "doubao-seedance-2-0-mini-260615";
    const timestamp = "2026-08-11T08:00:00.000Z";
    const textParameterSchema = knownModelParameterSchema({
      capability: "text",
      providerDriver: "volcengine-ark",
      providerModelId: textProviderModelId,
    });
    const videoParameterSchema = knownModelParameterSchema({
      capability: "video",
      providerDriver: "volcengine-ark",
      providerModelId: videoProviderModelId,
    });
    try {
      database.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'fixture-only', 'user', 'active', ?, ?)
      `).run(ownerId, ownerId, `M81 ${fixtureId}`, timestamp, timestamp);
      database.prepare(`
        UPDATE provider_profiles
        SET status = 'enabled', key_status = 'valid', key_checked_at = ?
        WHERE id = ?
      `).run(timestamp, profile.id);
      const insertModel = database.prepare(`
        INSERT INTO model_profiles (
          id, display_name, provider_profile_id, provider_model_id,
          capability, status, default_parameters, created_at, updated_at,
          max_cost_microunits, cost_currency, provider_protocol
        ) VALUES (
          ?, ?, ?, ?, ?, 'published', ?, ?, ?,
          100000, 'CNY', 'native'
        )
      `);
      insertModel.run(
        textModelId,
        `M81 ${fixtureId} text`,
        profile.id,
        textProviderModelId,
        "text",
        JSON.stringify(textParameterSchema),
        timestamp,
        timestamp,
      );
      insertModel.run(
        videoModelId,
        `M81 ${fixtureId} video`,
        profile.id,
        videoProviderModelId,
        "video",
        JSON.stringify(videoParameterSchema),
        timestamp,
        timestamp,
      );
      const insertBinding = database.prepare(`
        INSERT INTO node_model_bindings (
          node_type, model_id, enabled, is_default, sort_order,
          created_at, updated_at
        ) VALUES (?, ?, 1, 1, 1, ?, ?)
      `);
      insertBinding.run("text", textModelId, timestamp, timestamp);
      insertBinding.run("video", videoModelId, timestamp, timestamp);
      database.prepare(`
        UPDATE generation_safety_settings
        SET
          global_enabled = 1,
          emergency_stop = 0,
          per_user_concurrency = 5,
          requests_per_minute = 120,
          text_concurrency = 3,
          video_concurrency = 3,
          updated_at = ?
        WHERE id = 1
      `).run(timestamp);
      const credential = await saveAccountCredential(
        database,
        ownerId,
        profile.id,
        "m81-startup-fake-provider-key",
      );
      const tasks = createGenerationTaskStore(dataDirectory);
      try {
        const admitted = tasks.admitOrGet({
          canvasId: `${fixtureId}-canvas`,
          costCurrency: "CNY",
          credentialRevision: credential.credentialVersion,
          estimatedCostMicrounits: 100_000,
          idempotencyKey: `${fixtureId}-startup-key`,
          kind: "text",
          model: textModelId,
          modelConfiguration: {
            credentialVersion: credential.credentialVersion,
            modelId: textModelId,
            parameterSchema: textParameterSchema,
            providerConfigurationVersion: 1,
            providerDriver: "volcengine-ark",
            providerModelId: textProviderModelId,
            providerProfileId: profile.id,
            providerProtocol: "native",
          },
          nodeId: `${fixtureId}-node`,
          ownerId,
          parameters: {
            inputs: [],
            responseFormat: "text",
            thinkingLevel: "minimal",
          },
          prompt: "start this committed task without a generation HTTP request",
          providerModelId: textProviderModelId,
          providerProfileId: profile.id,
        });
        expect(admitted.created).toBe(true);
        const admitVideo = (suffix: string) => tasks.admitOrGet({
          canvasId: `${fixtureId}-canvas`,
          costCurrency: "CNY",
          credentialRevision: credential.credentialVersion,
          estimatedCostMicrounits: 100_000,
          idempotencyKey: `${fixtureId}-${suffix}-key`,
          kind: "video",
          model: videoModelId,
          modelConfiguration: {
            credentialVersion: credential.credentialVersion,
            modelId: videoModelId,
            parameterSchema: videoParameterSchema,
            providerConfigurationVersion: 1,
            providerDriver: "volcengine-ark",
            providerModelId: videoProviderModelId,
            providerProfileId: profile.id,
            providerProtocol: "native",
          },
          nodeId: `${fixtureId}-${suffix}-node`,
          ownerId,
          parameters: {},
          prompt: "recover committed video work without submitting again",
          providerModelId: videoProviderModelId,
          providerProfileId: profile.id,
        }).task;
        const accepted = tasks.transition(
          admitVideo("accepted").id,
          "running",
        )!;
        tasks.recordProviderAttempt(accepted.id);
        const providerTaskId = `${fixtureId}-provider-task`;
        tasks.setProviderTaskId(accepted.id, providerTaskId);
        const preBoundary = tasks.transition(
          admitVideo("pre-boundary").id,
          "running",
        )!;
        const retrying = admitVideo("retrying");
        database.exec("BEGIN IMMEDIATE");
        try {
          database.prepare(`
            UPDATE generation_tasks
            SET state = 'retrying', updated_at = ?
            WHERE id = ? AND state = 'queued'
          `).run(timestamp, retrying.id);
          database.prepare(`
            INSERT INTO generation_task_events (
              task_id, state, created_at
            ) VALUES (?, 'retrying', ?)
          `).run(retrying.id, timestamp);
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        return {
          acceptedTaskId: accepted.id,
          ownerId,
          preBoundaryTaskId: preBoundary.id,
          providerTaskId,
          retryingTaskId: retrying.id,
          taskId: admitted.task.id,
        };
      } finally {
        tasks.close();
      }
    } finally {
      database.close();
    }
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
  }
}

async function moveProviderFixtureCache(
  dataDirectory: string,
) {
  await mkdir(dataDirectory, { recursive: true });
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  try {
    await saveProviderProfile({
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "M81 provider cache sink",
    });
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
  }
}

function makeStandaloneDatabase(dataDirectory: string) {
  const database = openAppDatabase(dataDirectory);
  database.exec(`
    PRAGMA wal_checkpoint(TRUNCATE);
    PRAGMA journal_mode = DELETE;
  `);
  database.close();
}

type OldLocalUploadCandidate = Readonly<{
  assetId: string;
  attemptId: string;
  bytes: Buffer;
  ownerId: string;
  stagingName: string;
  storageName: string;
}>;

function insertOldLocalUploadCandidate(
  database: DatabaseSync,
  fixtureId: string,
): OldLocalUploadCandidate {
  const ownerId = `${fixtureId}-owner`;
  const assetId = `${fixtureId}-asset`;
  const attemptId = `${fixtureId}-attempt`;
  const storageName = `${assetId}.png`;
  const stagingName = `.publication-${fixtureId}.generating`;
  const bytes = Buffer.from(`M81 old local upload ${fixtureId}`);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const timestamp = new Date().toISOString();
  const oldTimestamp = "2000-01-01T00:00:00.000Z";
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'fixture-only', 'user', 'active', ?, ?)
  `).run(ownerId, ownerId, `M81 ${fixtureId}`, timestamp, timestamp);
  database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, storage_profile_id, object_key, content_type,
      checksum_sha256, storage_status, duration_seconds, duration_source,
      duration_status, media_width, media_height
    ) VALUES (
      'image', ?, ?, ?, ?, ?, ?, 'local', NULL, ?, 'image/png', ?,
      'ready', NULL, NULL, 'not-applicable', 2, 3
    )
  `).run(
    assetId,
    ownerId,
    storageName,
    bytes.length,
    oldTimestamp,
    oldTimestamp,
    storageName,
    digest,
  );
  database.prepare(`
    INSERT INTO media_publication_attempts (
      attempt_id, owner_id, kind, asset_id, source, state,
      storage_backend, final_storage_name, object_key, storage_profile_id,
      staging_name, task_id, task_execution_attempt, history_label,
      byte_size, checksum_sha256, content_type, media_width, media_height,
      created_at, updated_at
    ) VALUES (
      ?, ?, 'image', ?, 'upload', 'published',
      'local', ?, ?, NULL, ?, NULL, NULL, NULL,
      ?, ?, 'image/png', 2, 3, ?, ?
    )
  `).run(
    attemptId,
    ownerId,
    assetId,
    storageName,
    storageName,
    stagingName,
    bytes.length,
    digest,
    oldTimestamp,
    oldTimestamp,
  );
  return { assetId, attemptId, bytes, ownerId, stagingName, storageName };
}

async function writeOldLocalUploadCandidate(
  dataDirectory: string,
  candidate: OldLocalUploadCandidate,
) {
  const mediaDirectory = join(dataDirectory, "media");
  await mkdir(mediaDirectory, { recursive: true });
  await writeFile(join(mediaDirectory, candidate.storageName), candidate.bytes, {
    flag: "wx",
  });
}

function rollbackMigration39To38(database: DatabaseSync) {
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TEMP TABLE generation_ledger_sequences_schema39 (
        name TEXT PRIMARY KEY,
        seq INTEGER NOT NULL
      );
      INSERT INTO generation_ledger_sequences_schema39 (name, seq)
      SELECT name, seq
      FROM sqlite_sequence
      WHERE name IN ('generation_task_events', 'generation_provider_attempts');

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

      UPDATE sqlite_sequence
      SET seq = MAX(
        seq,
        COALESCE((
          SELECT saved.seq
          FROM generation_ledger_sequences_schema39 AS saved
          WHERE saved.name = sqlite_sequence.name
        ), 0)
      )
      WHERE name IN ('generation_task_events', 'generation_provider_attempts');
      INSERT INTO sqlite_sequence (name, seq)
      SELECT saved.name, saved.seq
      FROM generation_ledger_sequences_schema39 AS saved
      WHERE NOT EXISTS (
        SELECT 1 FROM sqlite_sequence AS current
        WHERE current.name = saved.name
      );
      DROP TABLE generation_ledger_sequences_schema39;

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

function recreateV5ModelProfiles(
  database: DatabaseSync,
  existingCostColumns: "cost" | "max" | "none",
) {
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("DROP TABLE model_profiles");
  // Keep this base table and index aligned with immutable migration v5. The
  // v21 prepare hook has explicit, known-safe repairs for either missing cost
  // column; the final exact sqlite_schema text depends on their append order.
  database.exec(`
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
    `);
  if (existingCostColumns === "max") {
    database.exec(`
      ALTER TABLE model_profiles
        ADD COLUMN max_cost_microunits INTEGER NOT NULL DEFAULT 0
        CHECK (max_cost_microunits BETWEEN 0 AND 100000000);
    `);
  }
  if (existingCostColumns === "cost") {
    database.exec(`
      ALTER TABLE model_profiles
        ADD COLUMN cost_currency TEXT NOT NULL DEFAULT 'USD'
        CHECK (cost_currency IN ('USD', 'CNY'));
    `);
  }
  database.exec("DELETE FROM schema_migrations WHERE version IN (21, 22)");
}

function recreateV21MissingCatalogTables(database: DatabaseSync) {
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec(`
    DROP TABLE node_model_bindings;
    DROP TABLE model_profiles;
    DROP TABLE admin_audit_events;
    DROP TABLE users;
    DELETE FROM schema_migrations WHERE version IN (21, 22, 37);
  `);
}

function replayKnownIdempotentPrepareMigrations(database: DatabaseSync) {
  database.exec(`
    DELETE FROM schema_migrations
    WHERE version IN (21, 22, 23, 24, 25, 26, 29, 31, 32, 34);
  `);
}

function cookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function request(
  path: string,
  options: RequestInit & {
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const { cookie: session, headers, ...init } = options;
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Cookie: session } : {}),
      ...headers,
    },
  });
}

async function bootstrapAdmin() {
  const bootstrap = await request("/api/auth/bootstrap", {
    body: JSON.stringify({
      displayName: "Owner",
      loginName: "owner",
      password: "owner-password-123",
    }),
    headers: { "X-Forwarded-For": "127.0.0.1" },
    method: "POST",
  });
  expect(bootstrap.ok).toBe(true);
  return cookie(bootstrap);
}

test("trusted proxy mode blocks remote bootstrap through forwarded IP", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-bootstrap-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);

    const remote = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Remote",
        loginName: "remote",
        password: "remote-pass-123",
      }),
      headers: { "X-Forwarded-For": "203.0.113.9" },
      method: "POST",
    });
    expect(remote.status).toBe(403);
    expect(await remote.text()).toContain("首次管理员只能在服务器本机创建");

    const local = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      }),
      headers: { "X-Forwarded-For": "127.0.0.1" },
      method: "POST",
    });
    expect(local.status).toBe(201);
    expect(cookie(local)).not.toBe("");
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("trusted proxy mode requires https forwarding for storage writes", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-storage-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const adminCookie = await bootstrapAdmin();
    const profile = {
      accessKeyId: "m81-test-access-key-id",
      accessKeySecret: "m81-test-secret-key",
      bucket: "m81-private-bucket",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      label: "M81 Test OSS",
      region: "oss-cn-hangzhou",
    };

    const plain = await request("/api/admin/storage/profiles", {
      body: JSON.stringify(profile),
      cookie: adminCookie,
      headers: { "X-Forwarded-For": "127.0.0.1" },
      method: "POST",
    });
    expect(plain.status).toBe(400);
    expect(await plain.text()).toContain("HTTPS");

    const secure = await request("/api/admin/storage/profiles", {
      body: JSON.stringify(profile),
      cookie: adminCookie,
      headers: {
        "X-Forwarded-For": "127.0.0.1",
        "X-Forwarded-Proto": "https",
      },
      method: "POST",
    });
    expect(secure.status).toBe(201);

    const readThroughProxy = await request("/api/admin/storage", {
      cookie: adminCookie,
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    expect(readThroughProxy.status).toBe(200);

    const direct = await request("/api/admin/storage/profiles", {
      body: JSON.stringify({ ...profile, label: "M81 Direct OSS" }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(direct.status).toBe(201);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("liveness stays process-only while readiness verifies the current schema without creating data", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-health-"));
  const missingDataDirectory = join(testRoot, "missing-data");
  let server: ChildProcess | undefined;
  try {
    server = await startServer(missingDataDirectory);
    const live = await fetch(`${origin}/api/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ status: "live" });

    const notReady = await fetch(`${origin}/api/health/ready`);
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toMatchObject({
      code: "DATABASE_DIRECTORY_INVALID",
    });
    await expectMissing(missingDataDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("schema-37 and exact schema-38 startup stay write-free until the explicit migration role", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-schema37-role-"));
  const dataDirectory = join(testRoot, "data");
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const schema38Directory = join(testRoot, "schema38-data");
  const schema38Path = join(schema38Directory, "unboundry.sqlite");
  const hotWalSource = join(testRoot, "hot-wal-source");
  const hotWalTarget = join(testRoot, "hot-wal-target");
  let server: ChildProcess | undefined;
  let writer: DatabaseSync | undefined;
  try {
    await mkdir(dataDirectory);
    const database = openAppDatabase(dataDirectory);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (
        'm81-schema37-owner', 'm81-schema37-owner', 'M81 schema 37 owner',
        'fixture-only', 'user', 'active',
        '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
      )
    `).run();
    database.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at
      ) VALUES (
        'm81-schema37-owner', 'm81-schema37-project',
        'Preserved schema 37 project', 37, 1, 37
      )
    `).run();
    rollbackMigration39To38(database);
    rollbackMigration38To37(database);
    database.exec(`
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA journal_mode = DELETE;
    `);
    database.close();

    const beforeDefaultStartup = await directoryFingerprint(dataDirectory);
    server = await startServer(dataDirectory, {
      environment: { UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION: undefined },
    });
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const defaultReady = await fetch(`${origin}/api/health/ready`);
    expect(defaultReady.status).toBe(503);
    expect(await defaultReady.json()).toMatchObject({
      code: "DATABASE_SCHEMA_MISMATCH",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(
      beforeDefaultStartup,
    );
    await stopServer(server);
    server = undefined;

    server = await startServer(dataDirectory, {
      environment: { UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION: "1" },
    });
    const migratedReady = await fetch(`${origin}/api/health/ready`);
    expect(migratedReady.status).toBe(200);
    expect(await migratedReady.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: currentSchemaVersion,
      status: "ready",
    });
    await stopServer(server);
    server = undefined;

    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(migrated.prepare("PRAGMA user_version").get()).toEqual({
        user_version: currentSchemaVersion,
      });
      expect(migrated.prepare(`
        SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1
      `).get()).toEqual(currentSchemaManifest.at(-1));
      expect(migrated.prepare(`
        SELECT title, updated_at FROM project_metadata
        WHERE owner_id = 'm81-schema37-owner'
          AND id = 'm81-schema37-project'
      `).get()).toEqual({
        title: "Preserved schema 37 project",
        updated_at: 37,
      });
      expect(migrated.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 0 });
    } finally {
      migrated.close();
    }

    await mkdir(schema38Directory);
    const exact38 = openAppDatabase(schema38Directory);
    exact38.exec(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES
        (
          'm81-schema38-owner', 'm81-schema38-owner', 'M81 schema 38 owner',
          'fixture-only', 'user', 'active',
          '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z'
        ),
        (
          'm81-schema38-deleted-key-owner',
          'm81-schema38-deleted-key-owner',
          'M81 schema 38 deleted key owner', 'fixture-only', 'user', 'active',
          '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z'
        );
      INSERT INTO provider_profiles (
        id, display_name, driver, status, created_at, updated_at
      ) VALUES (
        'm81-schema38-provider', 'M81 schema 38 provider', 'openrouter',
        'enabled', '2026-08-11T00:00:00.000Z',
        '2026-08-11T00:00:00.000Z'
      );
      INSERT INTO account_provider_credentials (
        account_id, provider_profile_id, encrypted_key, key_status,
        credential_version, updated_at
      ) VALUES (
        'm81-schema38-owner', 'm81-schema38-provider', 'fixture-only',
        'unchecked', 7, '2026-08-11T00:00:00.000Z'
      );
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
        request_fingerprint, state, attempt, created_at, updated_at, owner_id,
        provider_profile_id, provider_model_id, provider_task_id,
        model_configuration, credential_revision
      ) VALUES (
        'm81-schema38-task', 'm81-schema38-canvas', 'm81-schema38-node',
        'image', 'preserve exact schema 38 migration evidence', '{}',
        'm81-schema38-key', 'm81-schema38-fingerprint', 'success', 3,
        '2026-08-11T00:00:00.000Z', '2026-08-11T00:03:00.000Z',
        'm81-schema38-owner', 'm81-schema38-provider',
        'm81-schema38-model', 'm81-schema38-provider-task',
        '{"credentialVersion":7}', 7
      ), (
        'm81-schema38-gap-task', 'm81-schema38-gap-canvas',
        'm81-schema38-gap-node', 'image',
        'block an unresolved older schema 38 paid attempt', '{}',
        'm81-schema38-gap-key', 'm81-schema38-gap-fingerprint', 'failed', 2,
        '2026-08-11T00:04:00.000Z', '2026-08-11T00:06:00.000Z',
        'm81-schema38-owner', 'm81-schema38-provider',
        'm81-schema38-model', NULL, '{"credentialVersion":7}', 7
      ), (
        'm81-schema38-high-water-task', 'm81-schema38-high-water-canvas',
        'm81-schema38-high-water-node', 'image',
        'preserve a revision newer than the current schema 38 credential', '{}',
        'm81-schema38-high-water-key', 'm81-schema38-high-water-fingerprint',
        'failed', 1, '2026-08-11T00:07:00.000Z',
        '2026-08-11T00:08:00.000Z', 'm81-schema38-owner',
        'm81-schema38-provider', 'm81-schema38-model', NULL,
        '{"credentialVersion":11}', 11
      ), (
        'm81-schema38-deleted-key-task',
        'm81-schema38-deleted-key-canvas', 'm81-schema38-deleted-key-node',
        'image', 'preserve the high water after a credential was deleted',
        '{}', 'm81-schema38-deleted-key',
        'm81-schema38-deleted-key-fingerprint', 'failed', 1,
        '2026-08-11T00:09:00.000Z', '2026-08-11T00:10:00.000Z',
        'm81-schema38-deleted-key-owner', 'm81-schema38-provider',
        'm81-schema38-model', NULL, '{"credentialVersion":13}', 13
      ), (
        'm81-schema38-invalid-key-task',
        'm81-schema38-invalid-key-canvas', 'm81-schema38-invalid-key-node',
        'image', 'malformed historical JSON must not lower the safe high water',
        '{}', 'm81-schema38-invalid-key',
        'm81-schema38-invalid-key-fingerprint', 'failed', 1,
        '2026-08-11T00:11:00.000Z', '2026-08-11T00:12:00.000Z',
        'm81-schema38-owner', 'm81-schema38-provider',
        'm81-schema38-model', NULL, '{}', 0
      );
      INSERT INTO generation_task_events (
        id, task_id, state, error_code, created_at
      ) VALUES (
        41, 'm81-schema38-task', 'success', NULL,
        '2026-08-11T00:03:00.000Z'
      ), (
        42, 'm81-schema38-gap-task', 'failed', NULL,
        '2026-08-11T00:06:00.000Z'
      ), (
        43, 'm81-schema38-high-water-task', 'failed', 'AUTH',
        '2026-08-11T00:08:00.000Z'
      ), (
        44, 'm81-schema38-deleted-key-task', 'failed', 'AUTH',
        '2026-08-11T00:10:00.000Z'
      );
      UPDATE generation_tasks
      SET error_code = 'AUTH', error_message = 'historical credential rejected'
      WHERE id IN (
        'm81-schema38-high-water-task',
        'm81-schema38-deleted-key-task'
      );
      INSERT INTO generation_provider_attempts (
        id, task_id, execution_attempt, provider_profile_id,
        provider_model_id, kind, evidence, created_at, owner_id,
        credential_revision, outcome, provider_task_id, finished_at
      ) VALUES
        (
          51, 'm81-schema38-task', 1, 'm81-schema38-provider',
          'm81-schema38-model', 'image', 'provider-boundary',
          '2026-08-11T00:01:00.000Z', 'm81-schema38-owner', 7,
          'outcome-unknown', NULL, NULL
        ),
        (
          52, 'm81-schema38-task', 2, 'm81-schema38-provider',
          'm81-schema38-model', 'image', 'provider-boundary',
          '2026-08-11T00:02:00.000Z', 'm81-schema38-owner', 7,
          'completed', 'm81-schema38-provider-task',
          '2026-08-11T00:03:00.000Z'
        ),
        (
          53, 'm81-schema38-gap-task', 1, 'm81-schema38-provider',
          'm81-schema38-model', 'image', 'provider-boundary',
          '2026-08-11T00:05:00.000Z', 'm81-schema38-owner', 7,
          'outcome-unknown', NULL, NULL
        ),
        (
          54, 'm81-schema38-high-water-task', 1,
          'm81-schema38-provider', 'm81-schema38-model', 'image',
          'provider-boundary', '2026-08-11T00:07:00.000Z',
          'm81-schema38-owner', 11, 'definitive-rejected', NULL,
          '2026-08-11T00:08:00.000Z'
        ),
        (
          55, 'm81-schema38-deleted-key-task', 1,
          'm81-schema38-provider', 'm81-schema38-model', 'image',
          'provider-boundary', '2026-08-11T00:09:00.000Z',
          'm81-schema38-deleted-key-owner', 13, 'definitive-rejected', NULL,
          '2026-08-11T00:10:00.000Z'
        );
      UPDATE sqlite_sequence SET seq = 91
      WHERE name = 'generation_task_events';
      UPDATE sqlite_sequence SET seq = 92
      WHERE name = 'generation_provider_attempts';
    `);
    rollbackMigration39To38(exact38);
    exact38.prepare(`
      UPDATE generation_tasks
      SET model_configuration = '{not-json'
      WHERE id = 'm81-schema38-invalid-key-task'
    `).run();
    expect(databaseMatchesFrozenSchema38Contract(exact38)).toBe(true);
    expect(exact38.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(exact38.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 38,
    });
    expect(exact38.prepare(`
      SELECT name, seq FROM sqlite_sequence
      WHERE name IN ('generation_task_events', 'generation_provider_attempts')
      ORDER BY name
    `).all()).toEqual([
      { name: "generation_provider_attempts", seq: 92 },
      { name: "generation_task_events", seq: 91 },
    ]);
    exact38.exec(`
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA journal_mode = DELETE;
    `);
    exact38.close();

    const beforeSchema38Default = await directoryFingerprint(schema38Directory);
    server = await startServer(schema38Directory, {
      environment: { UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION: undefined },
    });
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const schema38DefaultReady = await fetch(`${origin}/api/health/ready`);
    expect(schema38DefaultReady.status).toBe(503);
    expect(await schema38DefaultReady.json()).toMatchObject({
      code: "DATABASE_SCHEMA_MISMATCH",
    });
    expect(await directoryFingerprint(schema38Directory)).toEqual(
      beforeSchema38Default,
    );
    await stopServer(server);
    server = undefined;

    server = await startServer(schema38Directory, {
      environment: { UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION: "1" },
    });
    const schema38MigratedReady = await fetch(`${origin}/api/health/ready`);
    expect(schema38MigratedReady.status).toBe(200);
    expect(await schema38MigratedReady.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: 39,
      status: "ready",
    });
    await stopServer(server);
    server = undefined;

    const migrated38 = new DatabaseSync(schema38Path, { readOnly: true });
    try {
      expect(migrated38.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 39,
      });
      expect(migrated38.prepare(`
        SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1
      `).get()).toEqual({
        name: "atomic-generation-admission-and-credential-scope",
        version: 39,
      });
      expect(migrated38.prepare(`
        SELECT credential_revision FROM account_provider_credential_epochs
        WHERE account_id = 'm81-schema38-owner'
          AND provider_profile_id = 'm81-schema38-provider'
      `).get()).toEqual({ credential_revision: 11 });
      expect(migrated38.prepare(`
        SELECT credential_revision FROM account_provider_credential_epochs
        WHERE account_id = 'm81-schema38-deleted-key-owner'
          AND provider_profile_id = 'm81-schema38-provider'
      `).get()).toEqual({ credential_revision: 13 });
      expect(migrated38.prepare(`
        SELECT credential_revision FROM generation_tasks
        WHERE id = 'm81-schema38-invalid-key-task'
      `).get()).toEqual({ credential_revision: 0 });
      expect(migrated38.prepare(`
        SELECT attempt, credential_revision, provider_task_id, state
        FROM generation_tasks WHERE id = 'm81-schema38-task'
      `).get()).toEqual({
        attempt: 3,
        credential_revision: 7,
        provider_task_id: "m81-schema38-provider-task",
        state: "success",
      });
      expect(migrated38.prepare(`
        SELECT
          execution_attempt, credential_revision, outcome, provider_task_id,
          failure_code, finished_at
        FROM generation_provider_attempts
        WHERE task_id = 'm81-schema38-task'
        ORDER BY execution_attempt
      `).all()).toEqual([
        {
          credential_revision: 7,
          execution_attempt: 1,
          failure_code: null,
          finished_at: null,
          outcome: "outcome-unknown",
          provider_task_id: null,
        },
        {
          credential_revision: 7,
          execution_attempt: 2,
          failure_code: null,
          finished_at: "2026-08-11T00:03:00.000Z",
          outcome: "completed",
          provider_task_id: "m81-schema38-provider-task",
        },
      ]);
      expect(migrated38.prepare(`
        SELECT COUNT(*) AS count FROM generation_admission_events
      `).get()).toEqual({ count: 0 });
      expect(migrated38.prepare(`
        SELECT attempt, credential_revision, provider_task_id, state
        FROM generation_tasks WHERE id = 'm81-schema38-gap-task'
      `).get()).toEqual({
        attempt: 2,
        credential_revision: 7,
        provider_task_id: null,
        state: "failed",
      });
      expect(migrated38.prepare(`
        SELECT execution_attempt, outcome, provider_task_id
        FROM generation_provider_attempts
        WHERE task_id = 'm81-schema38-gap-task'
      `).get()).toEqual({
        execution_attempt: 1,
        outcome: "outcome-unknown",
        provider_task_id: null,
      });
      expect(migrated38.prepare(`
        SELECT name, seq FROM sqlite_sequence
        WHERE name IN ('generation_task_events', 'generation_provider_attempts')
        ORDER BY name
      `).all()).toEqual([
        { name: "generation_provider_attempts", seq: 92 },
        { name: "generation_task_events", seq: 91 },
      ]);
      const providerAttemptsAfterMigration = migrated38.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get() as { count: number };
      // Every paid Provider boundary is journaled first. The explicit schema
      // role preserving all five rows is deterministic Provider=0 proof.
      expect(providerAttemptsAfterMigration).toEqual({ count: 5 });
      expect(migrated38.prepare(`
        SELECT owner_id, credential_revision, outcome
        FROM generation_provider_attempts
        WHERE task_id IN (
          'm81-schema38-high-water-task',
          'm81-schema38-deleted-key-task'
        )
        ORDER BY credential_revision
      `).all()).toEqual([
        {
          credential_revision: 11,
          outcome: "definitive-rejected",
          owner_id: "m81-schema38-owner",
        },
        {
          credential_revision: 13,
          outcome: "definitive-rejected",
          owner_id: "m81-schema38-deleted-key-owner",
        },
      ]);
      expect(migrated38.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated38.close();
    }

    const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
    process.env.UNBOUNDRY_DATA_DIR = schema38Directory;
    const migratedCredentials = new DatabaseSync(schema38Path);
    migratedCredentials.exec("PRAGMA foreign_keys = ON");
    try {
      await expect(saveAccountCredential(
        migratedCredentials,
        "m81-schema38-owner",
        "m81-schema38-provider",
        "m81-schema38-rotated-key-12",
      )).resolves.toMatchObject({ credentialVersion: 12 });
      await expect(saveAccountCredential(
        migratedCredentials,
        "m81-schema38-deleted-key-owner",
        "m81-schema38-provider",
        "m81-schema38-readded-key-14",
      )).resolves.toMatchObject({ credentialVersion: 14 });
      expect(migratedCredentials.prepare(`
        SELECT account_id, credential_revision
        FROM account_provider_credential_epochs
        WHERE provider_profile_id = 'm81-schema38-provider'
        ORDER BY account_id
      `).all()).toEqual([
        {
          account_id: "m81-schema38-deleted-key-owner",
          credential_revision: 14,
        },
        { account_id: "m81-schema38-owner", credential_revision: 12 },
      ]);
      expect(migratedCredentials.prepare(`
        SELECT owner_id, credential_revision, outcome
        FROM generation_provider_attempts
        WHERE task_id IN (
          'm81-schema38-high-water-task',
          'm81-schema38-deleted-key-task'
        )
        ORDER BY credential_revision
      `).all()).toEqual([
        {
          credential_revision: 11,
          outcome: "definitive-rejected",
          owner_id: "m81-schema38-owner",
        },
        {
          credential_revision: 13,
          outcome: "definitive-rejected",
          owner_id: "m81-schema38-deleted-key-owner",
        },
      ]);
    } finally {
      migratedCredentials.close();
      if (previousDataDirectory === undefined) {
        delete process.env.UNBOUNDRY_DATA_DIR;
      } else {
        process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
      }
    }

    const migratedStore = createGenerationTaskStore(schema38Directory);
    try {
      const retryTask = migratedStore.get("m81-schema38-gap-task")!;
      const retryInputKey = "m81-schema38-gap-input-key";
      const retryCanvasRevision = 1;
      const retryCanvas = openAppDatabase(schema38Directory);
      try {
        retryCanvas.prepare(`
          INSERT INTO canvas_documents (
            owner_id, id, revision, graph_revision, nodes, edges, viewport,
            updated_at, save_session_id, save_sequence
          ) VALUES (?, ?, 1, ?, ?, '[]', '{}', ?, NULL, 0)
        `).run(
          retryTask.ownerId!,
          retryTask.canvasId,
          retryCanvasRevision,
          JSON.stringify([{
            data: {
              imageGenerationInputKey: retryInputKey,
              imageGenerationTaskId: retryTask.id,
            },
            id: retryTask.nodeId,
            type: retryTask.kind,
          }]),
          retryTask.updatedAt,
        );
      } finally {
        retryCanvas.close();
      }
      expect(
        migratedStore.hasUnsafeProviderAttemptForNewPaidRetry(
          "m81-schema38-gap-task",
        ),
      ).toBe(true);
      expect(() => migratedStore.admitRetry({
        canvasId: retryTask.canvasId,
        expectedAttempt: retryTask.attempt,
        expectedCanvasRevision: retryCanvasRevision,
        expectedGenerationInputKey: retryInputKey,
        expectedUpdatedAt: retryTask.updatedAt,
        kind: retryTask.kind,
        mode: "new-paid-attempt",
        nodeId: retryTask.nodeId,
        snapshot: {
          credentialRevision: 7,
          modelConfiguration: {},
          providerModelId: "m81-schema38-model",
          providerProfileId: "m81-schema38-provider",
        },
        taskId: "m81-schema38-gap-task",
      })).toThrow(GenerationProviderAttemptBlockedError);
    } finally {
      migratedStore.close();
    }
    const afterBlockedRetry = new DatabaseSync(schema38Path, { readOnly: true });
    try {
      expect(afterBlockedRetry.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 5 });
    } finally {
      afterBlockedRetry.close();
    }

    await Promise.all([mkdir(hotWalSource), mkdir(hotWalTarget)]);
    writer = openAppDatabase(hotWalSource);
    rollbackMigration39To38(writer);
    rollbackMigration38To37(writer);
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    writer.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (
        'm81-hot-wal-owner', 'm81-hot-wal-owner', 'M81 hot WAL owner',
        'fixture-only', 'user', 'active',
        '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
      )
    `).run();
    const hotWalSourcePath = join(hotWalSource, "unboundry.sqlite");
    const hotWalTargetPath = join(hotWalTarget, "unboundry.sqlite");
    expect((await stat(`${hotWalSourcePath}-wal`)).size).toBeGreaterThan(0);
    await copyFile(hotWalSourcePath, hotWalTargetPath);
    await copyFile(`${hotWalSourcePath}-wal`, `${hotWalTargetPath}-wal`);
    await expectMissing(`${hotWalTargetPath}-shm`);
    const beforeUnsafeMigration = await directoryFingerprint(hotWalTarget);

    server = await startServer(hotWalTarget, {
      environment: { UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION: "1" },
    });
    const unsafeReady = await fetch(`${origin}/api/health/ready`);
    expect(unsafeReady.status).toBe(503);
    expect(await unsafeReady.json()).toMatchObject({
      code: "DATABASE_FILE_UNAVAILABLE",
    });
    expect(await directoryFingerprint(hotWalTarget)).toEqual(
      beforeUnsafeMigration,
    );
  } finally {
    if (server) await stopServer(server);
    writer?.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("server configure waits for media-only startup recovery before liveness is reachable", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-media-recovery-"));
  let server: ChildProcess | undefined;
  const ownerId = "m81-startup-recovery-owner";
  const assetId = "m81-startup-unadopted-upload";
  const storageName = `${assetId}.png`;
  const bytes = Buffer.from("m81 startup recovery exact local object");
  const digest = createHash("sha256").update(bytes).digest("hex");
  try {
    const database = openAppDatabase(dataDirectory);
    try {
      const timestamp = new Date().toISOString();
      const oldTimestamp = "2000-01-01T00:00:00.000Z";
      database.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (?, ?, 'M81 startup owner', 'fixture-only', 'user', 'active', ?, ?)
      `).run(ownerId, ownerId, timestamp, timestamp);
      database.prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
          storage_backend, storage_profile_id, object_key, content_type,
          checksum_sha256, storage_status, duration_seconds, duration_source,
          duration_status, media_width, media_height
        ) VALUES (
          'image', ?, ?, ?, ?, ?, ?, 'local', NULL, ?, 'image/png', ?,
          'ready', NULL, NULL, 'not-applicable', 2, 3
        )
      `).run(
        assetId,
        ownerId,
        storageName,
        bytes.length,
        oldTimestamp,
        oldTimestamp,
        storageName,
        digest,
      );
      database.prepare(`
        INSERT INTO media_publication_attempts (
          attempt_id, owner_id, kind, asset_id, source, state,
          storage_backend, final_storage_name, object_key, storage_profile_id,
          staging_name, task_id, task_execution_attempt, history_label,
          byte_size, checksum_sha256, content_type, media_width, media_height,
          created_at, updated_at
        ) VALUES (
          'm81-startup-attempt', ?, 'image', ?, 'upload', 'published',
          'local', ?, ?, NULL, '.publication-m81-startup.generating',
          NULL, NULL, NULL, ?, ?, 'image/png', 2, 3, ?, ?
        )
      `).run(
        ownerId,
        assetId,
        storageName,
        storageName,
        bytes.length,
        digest,
        oldTimestamp,
        oldTimestamp,
      );
    } finally {
      database.close();
    }
    await mkdir(join(dataDirectory, "media"), { recursive: true });
    await writeFile(join(dataDirectory, "media", storageName), bytes, {
      flag: "wx",
    });

    server = await startServer(dataDirectory);
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    await expectMissing(join(dataDirectory, "media", storageName));
    const recovered = openAppDatabase(dataDirectory);
    try {
      expect(recovered.prepare(`
        SELECT state, error_code, adopted_at
        FROM media_publication_attempts WHERE attempt_id = 'm81-startup-attempt'
      `).get()).toEqual({
        adopted_at: null,
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "failed",
      });
      expect(recovered.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
        WHERE owner_id = ? AND kind = 'image' AND id = ?
      `).get(ownerId, assetId)).toEqual({ count: 0 });
      expect(recovered.prepare(`
        SELECT state FROM media_delete_intents
        WHERE owner_id = ? AND kind = 'image' AND asset_id = ?
      `).get(ownerId, assetId)).toEqual({ state: "tombstone" });
      expect(recovered.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 0 });
    } finally {
      recovered.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("restore-incomplete blocks old media recovery without changing durable evidence", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-restore-incomplete-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const markerPath = join(dataDirectory, ".unboundry-restore-incomplete");
  let server: ChildProcess | undefined;
  try {
    const database = openAppDatabase(dataDirectory);
    const candidate = insertOldLocalUploadCandidate(
      database,
      "m81-restore-incomplete",
    );
    database.close();
    await writeOldLocalUploadCandidate(dataDirectory, candidate);
    await writeFile(markerPath, "restore publication is incomplete", { flag: "wx" });
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory);
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      code: "DATABASE_RESTORE_INCOMPLETE",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);

    const preserved = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(preserved.prepare(`
        SELECT publication.state, publication.error_code,
               media.storage_status
        FROM media_publication_attempts AS publication
        JOIN media_assets AS media
          ON media.owner_id = publication.owner_id
          AND media.kind = publication.kind
          AND media.id = publication.asset_id
        WHERE publication.attempt_id = ?
      `).get(candidate.attemptId)).toEqual({
        error_code: null,
        state: "published",
        storage_status: "ready",
      });
    } finally {
      preserved.close();
    }
    expect(
      await readFile(join(dataDirectory, "media", candidate.storageName)),
    ).toEqual(candidate.bytes);

    await rm(markerPath);
    const beforeDeferredProbe = await directoryFingerprint(dataDirectory);
    const sameProcess = await fetch(`${origin}/api/health/ready`);
    expect(sameProcess.status).toBe(503);
    expect(await sameProcess.json()).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(
      beforeDeferredProbe,
    );
    expect(
      await readFile(join(dataDirectory, "media", candidate.storageName)),
    ).toEqual(candidate.bytes);

    await stopServer(server);
    server = undefined;
    server = await startServer(dataDirectory);
    const recovered = await fetch(`${origin}/api/health/ready`);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ status: "ready" });
    await expectMissing(join(dataDirectory, "media", candidate.storageName));
    const cleaned = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(cleaned.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(candidate.attemptId)).toEqual({
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "failed",
      });
    } finally {
      cleaned.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("failed startup media cleanup stays not-ready until a restart retries it", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-media-blocked-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const mediaDirectory = join(dataDirectory, "media");
  let server: ChildProcess | undefined;
  try {
    const database = openAppDatabase(dataDirectory);
    const candidate = insertOldLocalUploadCandidate(database, "m81-media-blocked");
    database.close();
    await writeOldLocalUploadCandidate(dataDirectory, candidate);
    const stagingDirectory = join(mediaDirectory, candidate.stagingName);
    const stagingBlocker = join(stagingDirectory, "non-empty");
    await mkdir(stagingDirectory);
    await writeFile(stagingBlocker, "force staging cleanup to fail", {
      flag: "wx",
    });

    server = await startServer(dataDirectory);
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const blocked = await fetch(`${origin}/api/health/ready`);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });

    const durable = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(durable.prepare(`
        SELECT publication.state, publication.error_code,
               media.storage_status
        FROM media_publication_attempts AS publication
        JOIN media_assets AS media
          ON media.owner_id = publication.owner_id
          AND media.kind = publication.kind
          AND media.id = publication.asset_id
        WHERE publication.attempt_id = ?
      `).get(candidate.attemptId)).toEqual({
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "compensating",
        storage_status: "failed",
      });
    } finally {
      durable.close();
    }
    await expectMissing(join(mediaDirectory, candidate.storageName));
    expect(await readFile(stagingBlocker, "utf8")).toBe(
      "force staging cleanup to fail",
    );

    await stopServer(server);
    server = undefined;
    await rm(stagingDirectory, { force: true, recursive: true });
    server = await startServer(dataDirectory);
    const recovered = await fetch(`${origin}/api/health/ready`);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ status: "ready" });
    await expectMissing(join(mediaDirectory, candidate.storageName));

    const cleaned = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(cleaned.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(candidate.attemptId)).toEqual({
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "failed",
      });
      expect(cleaned.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
        WHERE owner_id = ? AND kind = 'image' AND id = ?
      `).get(candidate.ownerId, candidate.assetId)).toEqual({ count: 0 });
    } finally {
      cleaned.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("listening starts one committed queued task while startup gates keep blocked modes Provider-free", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-generation-startup-"));
  const activeDirectory = join(testRoot, "active");
  const oldSchemaDirectory = join(testRoot, "old-schema");
  const restoreDirectory = join(testRoot, "restore-marker");
  const cacheSinkDirectory = join(testRoot, "provider-cache-sink");
  let server: ChildProcess | undefined;
  try {
    const active = await seedQueuedStartupGenerationFixture(
      activeDirectory,
      "m81-startup-active",
    );
    await seedQueuedStartupGenerationFixture(
      oldSchemaDirectory,
      "m81-startup-old",
    );
    await seedQueuedStartupGenerationFixture(
      restoreDirectory,
      "m81-startup-restore",
    );
    await moveProviderFixtureCache(cacheSinkDirectory);
    makeStandaloneDatabase(activeDirectory);
    makeStandaloneDatabase(restoreDirectory);
    const oldSchema = openAppDatabase(oldSchemaDirectory);
    rollbackMigration39To38(oldSchema);
    oldSchema.exec(`
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA journal_mode = DELETE;
    `);
    oldSchema.close();
    await writeFile(
      join(restoreDirectory, ".unboundry-restore-incomplete"),
      "M81 controlled incomplete restore",
      { flag: "wx" },
    );

    const fakeProviderEnvironment = {
      UNBOUNDRY_SAFE_TEST: "1",
      UNBOUNDRY_TEST_GENERATION_STARTUP_FAKE_PROVIDER: "1",
    };
    const activeLog = join(activeDirectory, startupProviderFixtureLogName);
    const activeBeforeMaintenance = await directoryFingerprint(activeDirectory);
    server = await startServer(activeDirectory, {
      environment: {
        ...fakeProviderEnvironment,
        UNBOUNDRY_MAINTENANCE_MODE: "1",
      },
      waitPath: "/api/health/ready",
    });
    const maintenanceReady = await fetch(`${origin}/api/health/ready`);
    expect(maintenanceReady.status).toBe(200);
    expect(await maintenanceReady.json()).toMatchObject({
      mode: "maintenance-api-blocked",
      mutationsAccepted: false,
      status: "ready",
    });
    expect(await directoryFingerprint(activeDirectory)).toEqual(
      activeBeforeMaintenance,
    );
    await expectMissing(activeLog);
    await stopServer(server);
    server = undefined;

    const activeBeforeFailure = await directoryFingerprint(activeDirectory);
    server = await startServer(activeDirectory, {
      environment: {
        ...fakeProviderEnvironment,
        UNBOUNDRY_TEST_GENERATION_STARTUP_FAILURE: "1",
      },
    });
    const failedStartupReady = await fetch(`${origin}/api/health/ready`);
    expect(failedStartupReady.status).toBe(503);
    expect(await failedStartupReady.json()).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    expect(await directoryFingerprint(activeDirectory)).toEqual(
      activeBeforeFailure,
    );
    await expectMissing(activeLog);
    await stopServer(server);
    server = undefined;

    server = await startServer(activeDirectory, {
      environment: fakeProviderEnvironment,
      waitPath: "/api/health/ready",
    });
    const activeReady = await fetch(`${origin}/api/health/ready`);
    expect(activeReady.status).toBe(200);
    expect(await activeReady.json()).toMatchObject({
      databaseProbe: "read-only",
      mode: "active",
      status: "ready",
    });
    const providerRequests = (await readFile(activeLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { method: string; url: string });
    expect(providerRequests).toHaveLength(2);
    expect(providerRequests.filter((request) =>
      request.method === "POST" && request.url.endsWith("/responses")
    )).toEqual([{
      method: "POST",
      url: "https://ark.cn-beijing.volces.com/api/v3/responses",
    }]);
    expect(providerRequests.filter((request) =>
      request.method === "POST" &&
      request.url.includes("/contents/generations/tasks")
    )).toEqual([]);
    expect(providerRequests.filter((request) =>
      request.method === "GET" &&
      request.url.endsWith(`/contents/generations/tasks/${active.providerTaskId}`)
    )).toHaveLength(1);
    const completed = new DatabaseSync(
      join(activeDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
    try {
      expect(completed.prepare(`
        SELECT attempt, result_text, state
        FROM generation_tasks WHERE id = ?
      `).get(active.taskId)).toEqual({
        attempt: 1,
        result_text: "M81 startup worker fake Provider result",
        state: "success",
      });
      expect(completed.prepare(`
        SELECT execution_attempt, outcome
        FROM generation_provider_attempts WHERE task_id = ?
      `).all(active.taskId)).toEqual([{
        execution_attempt: 1,
        outcome: "completed",
      }]);
      expect(completed.prepare(`
        SELECT error_code, state FROM generation_tasks WHERE id = ?
      `).get(active.acceptedTaskId)).toEqual({
        error_code: "PROVIDER_FAILED",
        state: "failed",
      });
      expect(completed.prepare(`
        SELECT execution_attempt, outcome
        FROM generation_provider_attempts WHERE task_id = ?
      `).all(active.acceptedTaskId)).toEqual([{
        execution_attempt: 1,
        outcome: "provider-failed",
      }]);
      expect(completed.prepare(`
        SELECT error_code, state FROM generation_tasks WHERE id = ?
      `).get(active.preBoundaryTaskId)).toEqual({
        error_code: "SERVICE_RESTARTED",
        state: "failed",
      });
      expect(completed.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts WHERE task_id = ?
      `).get(active.preBoundaryTaskId)).toEqual({ count: 0 });
      expect(completed.prepare(`
        SELECT error_code, state FROM generation_tasks WHERE id = ?
      `).get(active.retryingTaskId)).toEqual({
        error_code: "RETRY_INTERRUPTED",
        state: "failed",
      });
      expect(completed.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts WHERE task_id = ?
      `).get(active.retryingTaskId)).toEqual({ count: 0 });
    } finally {
      completed.close();
    }
    await stopServer(server);
    server = undefined;

    for (const blocked of [
      {
        code: "DATABASE_SCHEMA_MISMATCH",
        directory: oldSchemaDirectory,
      },
      {
        code: "DATABASE_RESTORE_INCOMPLETE",
        directory: restoreDirectory,
      },
    ]) {
      const log = join(blocked.directory, startupProviderFixtureLogName);
      const before = await directoryFingerprint(blocked.directory);
      server = await startServer(blocked.directory, {
        environment: fakeProviderEnvironment,
      });
      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({ code: blocked.code });
      expect(await directoryFingerprint(blocked.directory)).toEqual(before);
      await expectMissing(log);
      if (blocked.directory === restoreDirectory) {
        await rm(join(restoreDirectory, ".unboundry-restore-incomplete"));
        const sameProcess = await fetch(`${origin}/api/health/ready`);
        expect(sameProcess.status).toBe(503);
        expect(await sameProcess.json()).toMatchObject({
          code: "DATABASE_UNAVAILABLE",
        });
        await expectMissing(log);
      }
      await stopServer(server);
      server = undefined;
    }
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("readiness leaves inactive generation evidence and the database bytes unchanged", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-ready-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  let server: ChildProcess | undefined;
  try {
    const store = createGenerationTaskStore(dataDirectory);
    const task = store.create({
      canvasId: "m81-readiness-canvas",
      idempotencyKey: "m81-readiness-request",
      kind: "image",
      nodeId: "m81-readiness-node",
      prompt: "readiness must never mutate this inactive synthetic task",
    }).task;
    store.transition(task.id, "running");
    store.transition(task.id, "failed", {
      code: "M81_INACTIVE_FIXTURE",
      message: "synthetic terminal evidence",
    });
    store.close();
    expect(await optionalFileSize(`${databasePath}-wal`)).toBe(0);
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: currentSchemaVersion,
      status: "ready",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);

    const database = new DatabaseSync(
      `${pathToFileURL(databasePath).href}?immutable=1`,
      { readOnly: true },
    );
    try {
      expect(
        database.prepare("SELECT state FROM generation_tasks WHERE id = ?")
          .get(task.id),
      ).toEqual({ state: "failed" });
      expect(
        database.prepare(
          "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?",
        ).get(task.id),
      ).toEqual({ count: 3 });
    } finally {
      database.close();
    }
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness reads a committed WAL without changing database or WAL bytes", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-live-wal-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  let server: ChildProcess | undefined;
  let writer: DatabaseSync | undefined;
  try {
    const store = createGenerationTaskStore(dataDirectory);
    const task = store.create({
      canvasId: "m81-live-wal-canvas",
      idempotencyKey: "m81-live-wal-request",
      kind: "image",
      nodeId: "m81-live-wal-node",
      prompt: "WAL readiness must remain observational for inactive evidence",
    }).task;
    store.transition(task.id, "running");
    store.transition(task.id, "failed", {
      code: "M81_INACTIVE_FIXTURE",
      message: "synthetic terminal evidence",
    });
    store.close();

    writer = openAppDatabase(dataDirectory);
    writer.exec(`
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA user_version = ${currentSchemaVersion - 1};
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA user_version = ${currentSchemaVersion};
    `);
    const immutableMain = new DatabaseSync(
      `${pathToFileURL(databasePath).href}?immutable=1`,
      { readOnly: true },
    );
    try {
      expect(immutableMain.prepare("PRAGMA user_version").get()).toEqual({
        user_version: currentSchemaVersion - 1,
      });
    } finally {
      immutableMain.close();
    }
    expect((await stat(`${databasePath}-wal`)).size).toBeGreaterThan(0);
    expect((await stat(`${databasePath}-shm`)).isFile()).toBe(true);
    const beforeEntries = (await readdir(dataDirectory)).sort();
    const beforeDatabase = await sha256(databasePath);
    const beforeWal = await sha256(`${databasePath}-wal`);
    const beforeTask = writer.prepare(`
      SELECT state,
        (SELECT COUNT(*) FROM generation_task_events WHERE task_id = ?) AS events
      FROM generation_tasks
      WHERE id = ?
    `).get(task.id, task.id);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: currentSchemaVersion,
      status: "ready",
    });
    expect(await sha256(databasePath)).toBe(beforeDatabase);
    expect(await sha256(`${databasePath}-wal`)).toBe(beforeWal);
    expect((await readdir(dataDirectory)).sort()).toEqual(beforeEntries);
    expect(writer.prepare(`
      SELECT state,
        (SELECT COUNT(*) FROM generation_task_events WHERE task_id = ?) AS events
      FROM generation_tasks
      WHERE id = ?
    `).get(task.id, task.id)).toEqual(beforeTask);
  } finally {
    if (server) await stopServer(server);
    writer?.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness fails closed for a hot WAL without SHM until an owned connection recovers it", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-wal-recovery-"));
  const sourceDirectory = join(testRoot, "source");
  const targetDirectory = join(testRoot, "target");
  const sourcePath = join(sourceDirectory, "unboundry.sqlite");
  const targetPath = join(targetDirectory, "unboundry.sqlite");
  let recovery: DatabaseSync | undefined;
  let server: ChildProcess | undefined;
  let writer: DatabaseSync | undefined;
  try {
    await mkdir(sourceDirectory);
    await mkdir(targetDirectory);
    writer = openAppDatabase(sourceDirectory);
    writer.exec(`
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA user_version = ${currentSchemaVersion - 1};
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA user_version = ${currentSchemaVersion};
    `);
    expect((await stat(`${sourcePath}-wal`)).size).toBeGreaterThan(0);
    await copyFile(sourcePath, targetPath);
    await copyFile(`${sourcePath}-wal`, `${targetPath}-wal`);
    expect((await readdir(targetDirectory)).sort()).toEqual([
      "unboundry.sqlite",
      "unboundry.sqlite-wal",
    ]);
    const beforeDatabase = await sha256(targetPath);
    const beforeWal = await sha256(`${targetPath}-wal`);

    server = await startServer(targetDirectory);
    const blocked = await fetch(`${origin}/api/health/ready`);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({
      code: "DATABASE_FILE_UNAVAILABLE",
    });
    expect(await sha256(targetPath)).toBe(beforeDatabase);
    expect(await sha256(`${targetPath}-wal`)).toBe(beforeWal);
    expect((await readdir(targetDirectory)).sort()).toEqual([
      "unboundry.sqlite",
      "unboundry.sqlite-wal",
    ]);

    recovery = new DatabaseSync(targetPath);
    expect(recovery.prepare("PRAGMA user_version").get()).toEqual({
      user_version: currentSchemaVersion,
    });
    expect((await stat(`${targetPath}-shm`)).isFile()).toBe(true);
    const recovered = await fetch(`${origin}/api/health/ready`);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ status: "ready" });
  } finally {
    if (server) await stopServer(server);
    recovery?.close();
    writer?.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("a hot-WAL pending upload remains not-ready until a new process recovers it", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-wal-pending-"));
  const sourceDirectory = join(testRoot, "source");
  const targetDirectory = join(testRoot, "target");
  const sourcePath = join(sourceDirectory, "unboundry.sqlite");
  const targetPath = join(targetDirectory, "unboundry.sqlite");
  let recovery: DatabaseSync | undefined;
  let server: ChildProcess | undefined;
  let writer: DatabaseSync | undefined;
  try {
    await mkdir(sourceDirectory);
    await mkdir(targetDirectory);
    writer = openAppDatabase(sourceDirectory);
    writer.exec(`
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA user_version = ${currentSchemaVersion - 1};
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
    const candidate = insertOldLocalUploadCandidate(writer, "m81-wal-pending");
    writer.exec(`PRAGMA user_version = ${currentSchemaVersion}`);
    expect((await stat(`${sourcePath}-wal`)).size).toBeGreaterThan(0);
    await copyFile(sourcePath, targetPath);
    await copyFile(`${sourcePath}-wal`, `${targetPath}-wal`);
    await writeOldLocalUploadCandidate(targetDirectory, candidate);
    await expectMissing(`${targetPath}-shm`);
    const beforeDatabase = await sha256(targetPath);
    const beforeWal = await sha256(`${targetPath}-wal`);

    server = await startServer(targetDirectory);
    const hotWal = await fetch(`${origin}/api/health/ready`);
    expect(hotWal.status).toBe(503);
    expect(await hotWal.json()).toMatchObject({
      code: "DATABASE_FILE_UNAVAILABLE",
    });
    expect(await sha256(targetPath)).toBe(beforeDatabase);
    expect(await sha256(`${targetPath}-wal`)).toBe(beforeWal);
    expect(
      await readFile(join(targetDirectory, "media", candidate.storageName)),
    ).toEqual(candidate.bytes);

    recovery = new DatabaseSync(targetPath);
    expect(recovery.prepare("PRAGMA user_version").get()).toEqual({
      user_version: currentSchemaVersion,
    });
    expect(recovery.prepare(`
      SELECT state, error_code FROM media_publication_attempts
      WHERE attempt_id = ?
    `).get(candidate.attemptId)).toEqual({
      error_code: null,
      state: "published",
    });
    expect((await stat(`${targetPath}-shm`)).isFile()).toBe(true);

    const sameProcess = await fetch(`${origin}/api/health/ready`);
    expect(sameProcess.status).toBe(503);
    expect(await sameProcess.json()).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    expect(
      await readFile(join(targetDirectory, "media", candidate.storageName)),
    ).toEqual(candidate.bytes);

    await stopServer(server);
    server = undefined;
    server = await startServer(targetDirectory);
    const restarted = await fetch(`${origin}/api/health/ready`);
    expect(restarted.status).toBe(200);
    expect(await restarted.json()).toMatchObject({ status: "ready" });
    await expectMissing(join(targetDirectory, "media", candidate.storageName));
    recovery.close();
    recovery = undefined;

    const cleaned = new DatabaseSync(targetPath, { readOnly: true });
    try {
      expect(cleaned.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(candidate.attemptId)).toEqual({
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "failed",
      });
      expect(cleaned.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
        WHERE owner_id = ? AND kind = 'image' AND id = ?
      `).get(candidate.ownerId, candidate.assetId)).toEqual({ count: 0 });
    } finally {
      cleaned.close();
    }
  } finally {
    if (server) await stopServer(server);
    recovery?.close();
    writer?.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("readiness rejects a counterfeit current-schema ledger without changing it", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-counterfeit-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  let server: ChildProcess | undefined;
  try {
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    const insert = database.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `);
    for (const migration of currentSchemaManifest) {
      insert.run(migration.version, migration.name, "2026-08-09T00:00:00.000Z");
    }
    database.exec(`PRAGMA user_version = ${currentSchemaVersion}`);
    database.close();
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      code: "DATABASE_SCHEMA_MISMATCH",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness accepts the historical v31-to-v32 public template column order", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-v31-v32-"));
  let server: ChildProcess | undefined;
  try {
    let database = openAppDatabase(dataDirectory);
    rollbackMigration39To38(database);
    rollbackMigration38To37(database);
    database.exec("DROP TABLE public_templates");
    // Keep this SQL text aligned with the known hot-reload v31 migration.
    // Exact sqlite_schema fingerprints are intentional: a whitespace-erasing
    // pseudo-lexer can merge declarations with different SQLite semantics.
    database.exec(`
        CREATE TABLE public_templates (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
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
    database.exec("DELETE FROM schema_migrations WHERE version = 32");
    database.close();
    // Reopen through the real immutable v32 prepare hook so this positive case
    // proves the quoted addColumnIfMissing repair rather than hand-writing it.
    database = openAppDatabase(dataDirectory);
    database.close();
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: currentSchemaVersion,
      status: "ready",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness accepts exact known migration repair shapes", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-v21-repair-"));
  let server: ChildProcess | undefined;
  try {
    const fixtures = [
      {
        directory: join(testRoot, "missing-catalog-tables"),
        prepare: recreateV21MissingCatalogTables,
      },
      {
        directory: join(testRoot, "idempotent-prepare-replay"),
        prepare: replayKnownIdempotentPrepareMigrations,
      },
      ...(["none", "max", "cost"] as const).map((existingCostColumns) => ({
        directory: join(testRoot, `model-${existingCostColumns}`),
        prepare: (database: DatabaseSync) =>
          recreateV5ModelProfiles(database, existingCostColumns),
      })),
    ];

    for (const fixture of fixtures) {
      await mkdir(fixture.directory);
      let database = openAppDatabase(fixture.directory);
      rollbackMigration39To38(database);
      rollbackMigration38To37(database);
      fixture.prepare(database);
      database.close();
      database = openAppDatabase(fixture.directory);
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      database.close();
      const beforeDirectory = await directoryFingerprint(fixture.directory);

      server = await startServer(fixture.directory);
      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({
        databaseProbe: "read-only",
        schemaVersion: currentSchemaVersion,
        status: "ready",
      });
      expect(await directoryFingerprint(fixture.directory)).toEqual(
        beforeDirectory,
      );
      await stopServer(server);
      server = undefined;
    }
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("readiness rejects missing or semantically damaged current-schema objects", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-schema-contract-"));
  let server: ChildProcess | undefined;
  try {
    const cases = [
      {
        directory: join(testRoot, "missing-schema39-credential-epochs"),
        damage: "DROP TABLE account_provider_credential_epochs",
      },
      {
        directory: join(testRoot, "missing-schema39-admission-ledger"),
        damage: "DROP TABLE generation_admission_events",
      },
      {
        directory: join(testRoot, "missing-schema39-owner-idempotency"),
        damage: "DROP INDEX generation_tasks_owner_idempotency",
      },
      {
        directory: join(testRoot, "missing-schema39-attempt-circuit"),
        damage: "DROP INDEX generation_provider_attempts_circuit",
      },
      {
        directory: join(testRoot, "missing-table"),
        damage: "DROP TABLE user_templates",
      },
      {
        directory: join(testRoot, "missing-index"),
        damage: "DROP INDEX node_model_bindings_one_default",
      },
      {
        directory: join(testRoot, "missing-canonical-users-index"),
        damage: "DROP INDEX users_status_role",
      },
      {
        directory: join(testRoot, "false-partial-index"),
        damage: `
          DROP INDEX node_model_bindings_one_default;
          CREATE UNIQUE INDEX node_model_bindings_one_default
          ON node_model_bindings (node_type)
          WHERE 0;
        `,
      },
      {
        directory: join(testRoot, "no-op-trigger"),
        damage: `
          DROP TRIGGER archived_models_cannot_enable_binding_insert;
          CREATE TRIGGER archived_models_cannot_enable_binding_insert
          BEFORE INSERT ON node_model_bindings
          BEGIN
            SELECT 1;
          END;
        `,
      },
      {
        directory: join(testRoot, "literal-case-trigger"),
        damage: `
          DROP TRIGGER model_profiles_capture_first_publish_insert;
          CREATE TRIGGER model_profiles_capture_first_publish_insert
          AFTER INSERT ON model_profiles
          WHEN NEW.status = 'PUBLISHED' AND NEW.published_at IS NULL
          BEGIN
            UPDATE model_profiles
            SET published_at = NEW.updated_at
            WHERE id = NEW.id AND published_at IS NULL;
          END;
        `,
      },
      {
        directory: join(testRoot, "split-integer-type"),
        damage: `
          ALTER TABLE schema_migrations
          RENAME TO schema_migrations_original;
          CREATE TABLE schema_migrations (
            version I NTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
          );
          INSERT INTO schema_migrations (version, name, applied_at)
          SELECT version, name, applied_at
          FROM schema_migrations_original;
          DROP TABLE schema_migrations_original;
        `,
      },
      {
        directory: join(testRoot, "extra-destructive-trigger"),
        damage: `
          CREATE TRIGGER unexpected_users_delete
          AFTER INSERT ON users
          BEGIN
            DELETE FROM users WHERE id = NEW.id;
          END;
        `,
      },
      {
        directory: join(testRoot, "extra-unique-index"),
        damage: `
          CREATE UNIQUE INDEX unexpected_users_display_name
          ON users (display_name);
        `,
      },
      {
        directory: join(testRoot, "extra-view"),
        damage: `
          CREATE VIEW unexpected_active_users AS
          SELECT id FROM users WHERE status = 'active';
        `,
      },
    ];
    for (const fixture of cases) {
      await mkdir(fixture.directory);
      const database = openAppDatabase(fixture.directory);
      database.exec(fixture.damage);
      database.close();
      const beforeDirectory = await directoryFingerprint(fixture.directory);

      server = await startServer(fixture.directory);
      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({
        code: "DATABASE_SCHEMA_MISMATCH",
      });
      expect(await directoryFingerprint(fixture.directory)).toEqual(
        beforeDirectory,
      );
      await stopServer(server);
      server = undefined;
    }
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("malformed mounted paths return controlled 400 responses without killing the process", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-url-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory, {
      environment: { UNBOUNDRY_TEST_AUTH_BYPASS: "1" },
    });
    const originalPid = server.pid;
    const paths = [
      "/api/canvas/%",
      "/api/canvas/%C0%AF",
      "/api/canvas/%2Fetc",
      "/api/canvas/%5Cetc",
      "/api/canvas/%00",
      `/api/canvas/${"a".repeat(4_100)}`,
    ];
    for (const path of paths) {
      const response = await rawHttp(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      );
      expect(response).toContain(" 400 ");
      expect(response).toContain('"code":"MALFORMED_URL"');
      expect(server.pid).toBe(originalPid);
      expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("JSON body failures and request IDs have stable safe classifications", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-json-"));
  const sensitiveCanary = "m81-cookie-password-api-key-prompt-secret";
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory, { captureOutput: true });
    const spoofedId = "attacker-controlled-request-id";
    const live = await fetch(`${origin}/api/health/live`, {
      headers: { "X-Request-ID": spoofedId },
    });
    const requestId = live.headers.get("x-request-id") ?? "";
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(requestId).not.toBe(spoofedId);

    const cases: Array<{
      body: BodyInit;
      code: string;
      contentType: string;
      status: number;
    }> = [
      {
        body: "",
        contentType: "application/json",
        code: "INVALID_JSON",
        status: 400,
      },
      {
        body: `{${sensitiveCanary}`,
        contentType: "application/json",
        code: "INVALID_JSON",
        status: 400,
      },
      {
        body: new Uint8Array([0xc3, 0x28]),
        contentType: "application/json",
        code: "INVALID_JSON",
        status: 400,
      },
      {
        body: "{}",
        contentType: "text/plain",
        code: "UNSUPPORTED_MEDIA_TYPE",
        status: 415,
      },
      {
        body: JSON.stringify({ padding: "x".repeat(70_000) }),
        contentType: "application/json",
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
      },
    ];
    for (const fixture of cases) {
      const response = await fetch(`${origin}/api/auth/bootstrap`, {
        body: fixture.body,
        headers: {
          Authorization: `Bearer ${sensitiveCanary}`,
          "Content-Type": fixture.contentType,
          Cookie: `session=${sensitiveCanary}`,
          "X-Forwarded-For": "127.0.0.1",
        },
        method: "POST",
      });
      expect(response.status).toBe(fixture.status);
      expect(await response.json()).toMatchObject({
        code: fixture.code,
        requestId: response.headers.get("x-request-id"),
      });
    }
    const chunkedPayload = JSON.stringify({ padding: "x".repeat(70_000) });
    const chunked = await rawHttp([
      "POST /api/auth/bootstrap HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      "Transfer-Encoding: chunked",
      "X-Forwarded-For: 127.0.0.1",
      "Connection: close",
      "",
      chunkedPayload.length.toString(16),
      chunkedPayload,
      "0",
      "",
      "",
    ].join("\r\n"));
    expect(chunked).toContain(" 413 ");
    expect(chunked).toContain('"code":"PAYLOAD_TOO_LARGE"');

    const compatibleWithoutContentType = await fetch(
      `${origin}/api/auth/bootstrap`,
      {
        body: Buffer.from(JSON.stringify({
          displayName: "Compatible Owner",
          loginName: "compatible-owner",
          password: "compatible-password-123",
        })),
        headers: { "X-Forwarded-For": "127.0.0.1" },
        method: "POST",
      },
    );
    expect(compatibleWithoutContentType.status).toBe(201);
    const structuredJsonSuffix = await fetch(`${origin}/api/auth/login`, {
      body: JSON.stringify({
        loginName: "compatible-owner",
        password: "compatible-password-123",
      }),
      headers: {
        "Content-Type": "application/problem+json",
        "X-Forwarded-For": "127.0.0.1",
      },
      method: "POST",
    });
    expect(structuredJsonSuffix.status).toBe(200);
    const unauthorized = await fetch(`${origin}/api/auth/login`, {
      body: JSON.stringify({
        loginName: "compatible-owner",
        password: "incorrect-password-123",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "127.0.0.1",
      },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
    const duplicateBootstrap = await fetch(`${origin}/api/auth/bootstrap`, {
      body: JSON.stringify({
        displayName: "Duplicate Owner",
        loginName: "duplicate-owner",
        password: "duplicate-password-123",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "127.0.0.1",
      },
      method: "POST",
    });
    expect(duplicateBootstrap.status).toBe(409);
    await expect.poll(() => outputOf(server!).includes('"event":"request"'))
      .toBe(true);
    await expect.poll(() => outputOf(server!).includes('"code":"HTTP_401"'))
      .toBe(true);
    await expect.poll(() => outputOf(server!).includes('"code":"HTTP_409"'))
      .toBe(true);
    expect(outputOf(server)).not.toContain(sensitiveCanary);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("malformed encoded upload names fail before any media path is created", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-filename-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory, {
      environment: { UNBOUNDRY_TEST_AUTH_BYPASS: "1" },
    });
    const uploads = [
      { contentType: "image/png", path: "/api/assets/m81-bad-name" },
      { contentType: "audio/mpeg", path: "/api/audio-assets/m81-bad-name.mp3" },
      { contentType: "video/mp4", path: "/api/video-assets/m81-bad-name.mp4" },
    ];
    for (const upload of uploads) {
      const response = await fetch(`${origin}${upload.path}`, {
        body: new Uint8Array(),
        headers: {
          "Content-Type": upload.contentType,
          "X-File-Name": "%",
        },
        method: "POST",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "MALFORMED_URL" });
    }
    await expectMissing(join(dataDirectory, "media"));
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("maintenance allows only health and version APIs without initializing data", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-maintenance-"));
  const dataDirectory = join(testRoot, "missing-data");
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory, {
      environment: {
        UNBOUNDRY_MAINTENANCE_MODE: "1",
        UNBOUNDRY_TEST_AUTH_BYPASS: "1",
      },
    });
    const blocked = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Must not be created",
        loginName: "blocked-owner",
        password: "blocked-password-123",
      }),
      method: "POST",
    });
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await blocked.json()).toMatchObject({
      code: "SERVICE_MAINTENANCE",
    });
    for (const path of [
      "/api/auth/status",
      "/api/generation-tasks/status",
    ]) {
      const sideEffectingRead = await fetch(`${origin}${path}`);
      expect(sideEffectingRead.status).toBe(503);
      expect(await sideEffectingRead.json()).toMatchObject({
        code: "SERVICE_MAINTENANCE",
      });
    }
    const updates = await fetch(`${origin}/api/updates`);
    expect(updates.status).toBe(503);
    expect(await updates.json()).toMatchObject({
      code: "SERVICE_MAINTENANCE",
    });
    const version = await fetch(`${origin}/api/version`);
    expect(version.status).toBe(200);
    expect(await version.json()).toHaveProperty("version");
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const slowChunked = await slowChunkedHttp([
      "POST /api/auth/bootstrap HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      "Transfer-Encoding: chunked",
      "Connection: keep-alive",
      "",
      "1000",
      "{\"displayName\":\"never-finished",
    ].join("\r\n"));
    expect(slowChunked).toContain(" 503 ");
    expect(slowChunked).toContain("Connection: close");
    await expectMissing(dataDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("shutdown waits for handler cleanup and has a hard close-failure exit", async () => {
  const lifecycle = createRuntimeLifecycle({
    dataDirectory: join(tmpdir(), "unboundry-m81-unused-lifecycle-data"),
    logger: () => undefined,
    shutdownDeadlineMs: 1_000,
  });
  let releaseCleanup: (() => void) | undefined;
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const handler = lifecycle.trackHandler(async () => {
    await cleanupGate;
  });
  const drain = lifecycle.beginShutdown();
  let drainSettled = false;
  void drain.then(() => { drainSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  expect(lifecycle.getInFlightRequests()).toBe(0);
  expect(lifecycle.getActiveHandlers()).toBe(1);
  expect(drainSettled).toBe(false);
  releaseCleanup?.();
  await handler;
  expect(await drain).toEqual({
    activeHandlers: 0,
    drained: true,
    inFlightRequests: 0,
  });

  const drainedResult: ShutdownResult = {
    activeHandlers: 0,
    drained: true,
    inFlightRequests: 0,
  };
  let synchronousFailureConnectionsClosed = 0;
  expect(await coordinateRuntimeShutdown({
    beginShutdown: async () => drainedResult,
    close: () => { throw new Error("synthetic synchronous close failure"); },
    closeAllConnections: () => { synchronousFailureConnectionsClosed += 1; },
    deadlineMs: 20,
    hardExitGraceMs: 20,
  })).toBe(1);
  expect(synchronousFailureConnectionsClosed).toBe(1);

  let hungCloseConnectionsClosed = 0;
  expect(await coordinateRuntimeShutdown({
    beginShutdown: async () => drainedResult,
    close: () => new Promise<void>(() => undefined),
    closeAllConnections: () => { hungCloseConnectionsClosed += 1; },
    deadlineMs: 0,
    hardExitGraceMs: 20,
  })).toBe(1);
  expect(hungCloseConnectionsClosed).toBe(1);
});

test("dev and preview own shutdown signals without erasing host listeners", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-shutdown-"));
  let server: ChildProcess | undefined;
  let updates: Awaited<ReturnType<typeof openServerEventStream>> | undefined;
  try {
    const cases: Array<{
      label: string;
      preview: boolean;
      signal: NodeJS.Signals;
    }> = [
      { label: "dev-term", preview: false, signal: "SIGTERM" },
      { label: "preview-term", preview: true, signal: "SIGTERM" },
      { label: "preview-int", preview: true, signal: "SIGINT" },
    ];
    for (const fixture of cases) {
      const dataDirectory = join(testRoot, fixture.label);
      const sentinelModule = join(dataDirectory, "signal-sentinel.mjs");
      const sentinelOutput = join(dataDirectory, "signal-sentinel.log");
      await mkdir(dataDirectory);
      await writeFile(sentinelModule, `
        import { appendFileSync } from "node:fs";
        const output = ${JSON.stringify(sentinelOutput)};
        const record = (label) => () => appendFileSync(output, label + "\\n");
        process.on("SIGTERM", record("listener-one"));
        process.on("SIGTERM", record("listener-two"));
        process.on("SIGINT", record("listener-one"));
        process.on("SIGINT", record("listener-two"));
        const originalOnce = process.once;
        let lateRegistered = false;
        process.once = function (event, listener) {
          const result = Reflect.apply(originalOnce, this, [event, listener]);
          if (
            !lateRegistered &&
            event === "SIGTERM" &&
            listener?.name === "parentSigtermCallback"
          ) {
            lateRegistered = true;
            process.on("SIGTERM", record("listener-late"));
          }
          return result;
        };
      `);
      server = await startServer(dataDirectory, {
        captureOutput: true,
        environment: {
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${
            pathToFileURL(sentinelModule).href
          }`.trim(),
        },
        preview: fixture.preview,
      });
      updates = await openServerEventStream();
      expect(updates.status).toBe(200);
      await expect.poll(updates.text).toContain('"version"');

      const exited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        server!.once("exit", (code, signal) => resolve({ code, signal }));
      });
      expect(server.kill(fixture.signal)).toBe(true);
      await expect.poll(updates.text).toContain("event: shutdown");
      await expect.poll(updates.text).toContain('"retryAfterSeconds"');
      await withTimeout(updates.closed, 5_000, "shutdown SSE did not close");

      const result = await withTimeout(
        exited,
        5_000,
        "server did not exit after drain",
      );
      expect(result).toEqual({ code: 0, signal: null });
      await expect.poll(
        () => outputOf(server!).includes('"code":"SHUTDOWN_DRAINED"'),
      ).toBe(true);
      const expectedListeners = fixture.signal === "SIGTERM"
        ? ["listener-late", "listener-one", "listener-two"]
        : ["listener-one", "listener-two"];
      expect((await readFile(sentinelOutput, "utf8")).trim().split("\n").sort())
        .toEqual(expectedListeners);
      expect(outputOf(server)).not.toMatch(/cookie|password|api.?key|prompt/i);
      updates.close();
      updates = undefined;
      await stopServer(server);
      server = undefined;
    }
  } finally {
    updates?.close();
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("unexpected database failures stay internal and the server remains alive", async () => {
  const secretCanary = "cookie-password-apikey-prompt-canary";
  const dataDirectory = await mkdtemp(
    join(tmpdir(), `unboundry-m81-${secretCanary}-`),
  );
  let server: ChildProcess | undefined;
  try {
    await mkdir(join(dataDirectory, "unboundry.sqlite"));
    server = await startServer(dataDirectory, {
      captureOutput: true,
      environment: { UNBOUNDRY_TEST_AUTH_BYPASS: "1" },
    });
    const failed = await fetch(`${origin}/api/media-metadata/image/missing`);
    expect(failed.status).toBe(500);
    const body = await failed.text();
    expect(body).toContain('"code":"INTERNAL_ERROR"');
    expect(body).not.toContain(secretCanary);
    await expect.poll(
      () => outputOf(server!).includes('"code":"INTERNAL_ERROR"'),
    ).toBe(true);
    expect(outputOf(server)).not.toContain(secretCanary);
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
