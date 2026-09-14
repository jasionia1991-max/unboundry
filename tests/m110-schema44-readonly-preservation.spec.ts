import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { promisify } from "node:util";
import { expect, test } from "./safe-test";
import {
  currentSchemaVersion,
  databaseMatchesSchemaContract,
  openAppDatabase,
} from "../server/database";

const executeFile = promisify(execFile);
const OWNER_ID = "m110-owner";
const CANVAS_ID = "m110-canvas";
const UNKNOWN_TASK_ID = "m110-unknown-task";
const STAGED_TASK_ID = "m110-staged-task";
const STAGED_ASSET_ID = "m110-staged-asset";
const STAGED_ATTEMPT_ID = "m110-staged-publication";
const IDLE_TASK_ID = "m110-idle-published-task";
const IDLE_ASSET_ID = "m110-idle-published-asset";
const IDLE_ATTEMPT_ID = "m110-idle-published-publication";
const UNKNOWN_PROFILE = "m110-profile";
const UNKNOWN_MODEL = "m110-model";
const MEDIA_BYTES = Buffer.from("m110-staged-video-payload");
const IDLE_MEDIA_BYTES = Buffer.from("m110-idle-published-video-payload");

const activeApplicationBootstrap = String.raw`
  import { appendFileSync } from "node:fs";
  import { resolve } from "node:path";
  import { createServer } from "vite";

  const [dataDirectory, runtimeDirectory, providerCounterFile, testPortValue] = process.argv.slice(1);
  const testPort = Number(testPortValue);
  if (!Number.isInteger(testPort) || testPort < 1 || testPort > 65535) {
    throw new Error("R16 requires a registered test port");
  }
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  process.env.UNBOUNDRY_RUNTIME_DIR = runtimeDirectory;
  process.env.UNBOUNDRY_SAFE_TEST = "1";
  process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP = "0";
  process.env.UNBOUNDRY_TEST_GENERATION_STARTUP_OBSERVE = "1";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    if (method === "POST") {
      appendFileSync(providerCounterFile, "POST\\n", { mode: 0o600 });
      return new Response(JSON.stringify({ error: "unexpected provider POST" }), {
        status: 599,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
  async function waitForHealth() {
    const deadline = Date.now() + 15_000;
    let last = "";
    while (Date.now() < deadline) {
      try {
        const live = await fetch("http://127.0.0.1:" + testPort + "/api/health/live");
        const ready = await fetch("http://127.0.0.1:" + testPort + "/api/health/ready");
        last = "live=" + live.status + " ready=" + ready.status;
        if (live.status === 200 && ready.status === 200) {
          return { liveStatus: live.status, readyStatus: ready.status };
        }
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error("application health did not become ready: " + last);
  }
  const server = await createServer({
    configFile: resolve(process.cwd(), "vite.config.ts"),
    server: { host: "127.0.0.1", port: testPort, strictPort: true, hmr: false, ws: false },
    logLevel: "silent",
  });
  try {
    await server.listen();
    const health = await waitForHealth();
    process.send?.({ type: "worker-ready", port: testPort, health });
    process.on("message", async (message) => {
      if (message?.action !== "drain") return;
      try {
        // The normal Vite server owns the runtime lifecycle wrapper. Calling
        // server.close() is the production drain path; do not duplicate it
        // with a test-only coordinator or recovery seam here.
        await server.close();
        process.send?.({ type: "drained", drained: true });
        setTimeout(() => process.exit(0), 25);
      } catch (error) {
        process.send?.({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
    setInterval(() => {}, 1_000);
  } catch (error) {
    process.send?.({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
`;

type Fixture = Readonly<{
  root: string;
  dataDirectory: string;
  runtimeDirectory: string;
  providerCounterFile: string;
}>;

type FixtureOptions = Readonly<{
  includeUnknown?: boolean;
  includeExistingMedia?: boolean;
}>;

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function databasePath(fixture: Fixture) {
  return join(fixture.dataDirectory, "unboundry.sqlite");
}

function createFixture(label: string, options: FixtureOptions = {}): Fixture {
  const includeUnknown = options.includeUnknown ?? true;
  const includeExistingMedia = options.includeExistingMedia ?? true;
  const root = mkdtempSync(join(tmpdir(), `unboundry-m110-r16-${label}-`));
  chmodSync(root, 0o700);
  const dataDirectory = join(root, "data");
  const runtimeDirectory = join(root, "runtime");
  const providerCounterFile = join(root, "provider-post-count.log");
  mkdirSync(dataDirectory, { mode: 0o700 });
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  writeFileSync(providerCounterFile, "", { mode: 0o600, flag: "wx" });
  const database = openAppDatabase(dataDirectory);
  const timestamp = "2026-09-10T00:00:00.000Z";
  try {
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status, protected,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'fixture-only', 'user', 'active', 0, ?, ?)
    `).run(OWNER_ID, OWNER_ID, "M110 owner", timestamp, timestamp);
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, nodes, edges, viewport, updated_at
      ) VALUES (?, ?, 7, ?, ?, ?, ?)
    `).run(
      OWNER_ID,
      CANVAS_ID,
      JSON.stringify([{ id: "m110-node", type: "video", data: { draft: true } }]),
      JSON.stringify([]),
      JSON.stringify({ x: 12, y: 24, zoom: 1 }),
      timestamp,
    );
    for (const [id, groupId] of [
      ["m110-parent-run", "m110-parent-group"],
      ["m110-child-run", "m110-child-group"],
    ]) {
      database.prepare(`
        INSERT INTO workflow_runs (
          id, owner_id, canvas_id, group_id, graph_revision,
          semantic_fingerprint, plan_json, state, stop_requested,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 7, ?, '{"version":1}', 'success', 0, ?, ?)
      `).run(id, OWNER_ID, CANVAS_ID, groupId, `${id}-fingerprint`, timestamp, timestamp);
    }
    if (includeUnknown) {
      database.prepare(`
        INSERT INTO generation_tasks (
          id, canvas_id, node_id, kind, prompt, model, parameters,
          idempotency_key, request_fingerprint, state, attempt, error_code,
          error_message, created_at, updated_at, owner_id,
          provider_profile_id, provider_model_id, model_configuration
        ) VALUES (?, ?, 'm110-unknown-node', 'video', 'unknown result', ?, '{}',
          'm110-unknown-idempotency', 'm110-unknown-fingerprint', 'recovering', 1,
          'OUTCOME_UNKNOWN_BILLING_RISK', 'provider outcome is unknown', ?, ?, ?,
          ?, ?, '{"providerProtocol":"native"}')
      `).run(
        UNKNOWN_TASK_ID, CANVAS_ID, UNKNOWN_MODEL, timestamp, timestamp, OWNER_ID,
        UNKNOWN_PROFILE, UNKNOWN_MODEL,
      );
      database.prepare(`
        INSERT INTO generation_task_events (
          task_id, state, error_code, error_message, created_at
        ) VALUES (?, 'recovering', 'OUTCOME_UNKNOWN_BILLING_RISK',
          'provider outcome is unknown', ?)
      `).run(UNKNOWN_TASK_ID, timestamp);
      database.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, provider_profile_id, provider_model_id,
          kind, evidence, owner_id, credential_revision, outcome,
          provider_task_id, failure_code, finished_at, created_at
        ) VALUES (?, 1, ?, ?, 'video', 'provider-boundary', ?, 0,
          'outcome-unknown', NULL, 'OUTCOME_UNKNOWN_BILLING_RISK', NULL, ?)
      `).run(UNKNOWN_TASK_ID, UNKNOWN_PROFILE, UNKNOWN_MODEL, OWNER_ID, timestamp);
      database.prepare(`
        INSERT INTO generation_admission_events (
          task_id, execution_attempt, owner_id, kind, admission_type, created_at
        ) VALUES (?, 1, ?, 'video', 'initial', ?)
      `).run(UNKNOWN_TASK_ID, OWNER_ID, timestamp);
      database.prepare(`
        INSERT INTO generation_result_save_leases (
          task_id, execution_attempt, owner_id, kind, runtime_instance_id,
          fence_epoch, holder_token, phase, heartbeat_at, lease_until, released_at
        ) VALUES (?, 1, ?, 'video', 'm110-fixture:released', 1,
          'm110-fixture-holder-token', 'released', ?, ?, ?)
      `).run(UNKNOWN_TASK_ID, OWNER_ID, timestamp, timestamp, timestamp);
      database.prepare(`
        INSERT INTO generation_result_adoptions (
          id, owner_id, task_id, execution_attempt, incident_digest,
          receipt_version, receipt_json, created_at
        ) VALUES (
          'm110-adoption', ?, ?, 1, 'm110-incident', 1,
          '{"kind":"m110","providerPostCount":0}', ?
        )
      `).run(OWNER_ID, UNKNOWN_TASK_ID, timestamp);
      database.prepare(`
        INSERT INTO workflow_run_continuations (
          id, owner_id, parent_run_id, child_run_id, intent_id,
          preview_digest, parent_graph_revision, child_graph_revision,
          parent_plan_digest, child_plan_digest, selected_node_ids_json,
          frozen_external_inputs_json, canonical_adoption_receipt_id,
          created_at, updated_at
        ) VALUES (
          'm110-continuation', ?, 'm110-parent-run', 'm110-child-run',
          'm110-intent', 'm110-preview', 7, 7, 'm110-parent-plan',
          'm110-child-plan', '["m110-node"]', '[{"nodeId":"m110-node"}]',
          'm110-adoption', ?, ?
        )
      `).run(OWNER_ID, timestamp, timestamp);
    }
    if (includeExistingMedia) {
      database.prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
          storage_backend, object_key, content_type, checksum_sha256,
          storage_status, duration_seconds, duration_source, duration_status,
          media_width, media_height, storage_profile_id
        ) VALUES ('video', 'm110-existing-asset', ?, 'm110-existing.mp4', 16,
          ?, ?, 'local', 'm110-existing.mp4', 'video/mp4', ?, 'ready',
          1, 'server-probe', 'ready', 720, 480, NULL)
      `).run(OWNER_ID, timestamp, timestamp, sha256(Buffer.from("existing-media")));
    }
    database.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    expect(currentSchemaVersion).toBe(44);
    expect(databaseMatchesSchemaContract(database)).toBe(true);
  } finally {
    database.close();
  }
  chmodSync(databasePath({ dataDirectory } as Fixture), 0o600);
  const mediaDirectory = join(dataDirectory, "media");
  mkdirSync(mediaDirectory, { mode: 0o700 });
  if (includeExistingMedia) {
    writeFileSync(join(mediaDirectory, "m110-existing.mp4"), Buffer.from("existing-media"), {
      mode: 0o600,
      flag: "wx",
    });
  }
  return Object.freeze({ root, dataDirectory, runtimeDirectory, providerCounterFile });
}

function insertStagedResult(fixture: Fixture) {
  const timestamp = "2026-09-10T00:00:01.000Z";
  const database = openAppDatabase(fixture.dataDirectory);
  try {
    database.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        provider_profile_id, provider_model_id, model_configuration,
        provider_task_id
      ) VALUES (?, ?, 'm110-staged-node', 'video', 'staged result', ?, '{}',
        'm110-staged-idempotency', 'm110-staged-fingerprint', 'recovering', 1,
        'AUTOMATIC_RESULT_RECOVERY', 'recover staged result', ?, ?, ?,
        ?, ?, '{"providerProtocol":"native"}', 'm110-staged-provider-task')
    `).run(
      STAGED_TASK_ID, CANVAS_ID, UNKNOWN_MODEL, timestamp, timestamp, OWNER_ID,
      UNKNOWN_PROFILE, UNKNOWN_MODEL,
    );
    database.prepare(`
      INSERT INTO generation_task_events (
        task_id, state, error_code, error_message, created_at
      ) VALUES (?, 'recovering', 'AUTOMATIC_RESULT_RECOVERY',
        'recover staged result', ?)
    `).run(STAGED_TASK_ID, timestamp);
    database.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, owner_id, credential_revision, outcome,
        provider_task_id, failure_code, finished_at, created_at
      ) VALUES (?, 1, ?, ?, 'video', 'provider-boundary', ?, 0,
        'completed', 'm110-staged-provider-task', NULL, ?, ?)
    `).run(STAGED_TASK_ID, UNKNOWN_PROFILE, UNKNOWN_MODEL, OWNER_ID, timestamp, timestamp);
    database.prepare(`
      INSERT INTO generation_admission_events (
        task_id, execution_attempt, owner_id, kind, admission_type, created_at
      ) VALUES (?, 1, ?, 'video', 'initial', ?)
    `).run(STAGED_TASK_ID, OWNER_ID, timestamp);
    database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height, storage_profile_id
      ) VALUES ('video', ?, ?, 'm110-staged-video.mp4', ?, ?, ?, 'local',
        'm110-staged-video.mp4', 'video/mp4', ?, 'pending', 5,
        'provider-task', 'ready', 720, 480, NULL)
    `).run(STAGED_ASSET_ID, OWNER_ID, MEDIA_BYTES.length, timestamp, timestamp, sha256(MEDIA_BYTES));
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state, storage_backend,
        final_storage_name, object_key, storage_profile_id, staging_name,
        task_id, task_execution_attempt, output_slot, output_set_count,
        history_label, byte_size, checksum_sha256, content_type,
        duration_seconds, duration_source, media_width, media_height,
        actual_cost_microunits, provider_usage_tokens, error_code,
        retry_count, adopted_at, adopted_canvas_id, created_at, updated_at
      ) VALUES (?, ?, 'video', ?, 'generation', 'staged', 'local',
        'm110-staged-video.mp4', 'm110-staged-video.mp4', NULL,
        '.m110-staged-video.mp4.stage', ?, 1, 0, 1, 'm110-r16', ?, ?,
        'video/mp4', 5, 'provider-task', 720, 480, 0, NULL, NULL, 0,
        NULL, NULL, ?, ?)
    `).run(
      STAGED_ATTEMPT_ID,
      OWNER_ID,
      STAGED_ASSET_ID,
      STAGED_TASK_ID,
      MEDIA_BYTES.length,
      sha256(MEDIA_BYTES),
      timestamp,
      timestamp,
    );
    database.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  } finally {
    database.close();
  }
  writeFileSync(
    join(fixture.dataDirectory, "media", ".m110-staged-video.mp4.stage"),
    MEDIA_BYTES,
    { mode: 0o600, flag: "wx" },
  );
}

/** Storage-only sentinels: the narrow command tests own proof/eligibility checks. */
function insertQueryRecoveryPreservationEvidence(fixture: Fixture) {
  const database = new DatabaseSync(databasePath(fixture));
  const timestamp = "2026-09-13T00:00:00.000Z";
  const identity = sha256("m110-original-video-projection");
  const operationId = `server-projection:${identity}`;
  try {
    database.prepare(`
      INSERT INTO canvas_operation_receipts (
        owner_id, canvas_id, operation_id, payload_sha256, command_type,
        actor_type, baseline_kind, outcome, http_status, original_request_id,
        result_document_revision, result_input_revision,
        result_document_sha256, result_input_sha256, created_at, settled_at,
        base_document_revision, base_input_revision, baseline_load_token_sha256, baseline_epoch
      ) VALUES (?, ?, ?, ?, 'server.projection', 'server', 'existing',
        'APPLIED', 200, 'm110-query-recovery-preservation', 7, 7, ?, ?, ?, ?, 6, 6, ?, 'm110-epoch')
    `).run(OWNER_ID, CANVAS_ID, operationId, identity, identity, identity,
      timestamp, timestamp, identity);
    database.prepare(`
      UPDATE workflow_run_continuations SET frozen_external_inputs_json = ?,
        canonical_adoption_receipt_id = NULL
      WHERE id = 'm110-continuation'
    `).run(JSON.stringify([{
      kind: "video", nodeId: "m110-node", source: "successful-task",
      sourceRunId: "m110-parent-run", sourceTaskId: "m110-completed-source",
      serverProjectionOperationId: operationId,
      serverProjectionPayloadSha256: identity,
    }]));
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally { database.close(); }
}


function insertIdlePublishedStagingResult(fixture: Fixture) {
  const timestamp = "2026-09-10T00:00:01.000Z";
  const database = openAppDatabase(fixture.dataDirectory);
  try {
    database.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        provider_profile_id, provider_model_id, result_asset_id,
        model_configuration, provider_task_id
      ) VALUES (?, ?, 'm110-idle-node', 'video', 'already published', ?, '{}',
        'm110-idle-idempotency', 'm110-idle-fingerprint', 'success', 1,
        NULL, NULL, ?, ?, ?, ?, ?, ?,
        '{"providerProtocol":"native"}', 'm110-idle-provider-task')
    `).run(
      IDLE_TASK_ID, CANVAS_ID, UNKNOWN_MODEL, timestamp, timestamp, OWNER_ID,
      UNKNOWN_PROFILE, UNKNOWN_MODEL, IDLE_ASSET_ID,
    );
    database.prepare(`
      INSERT INTO generation_task_events (
        task_id, state, error_code, error_message, created_at
      ) VALUES (?, 'success', NULL, NULL, ?)
    `).run(IDLE_TASK_ID, timestamp);
    database.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, owner_id, credential_revision, outcome,
        provider_task_id, failure_code, finished_at, created_at
      ) VALUES (?, 1, ?, ?, 'video', 'provider-boundary', ?, 0,
        'completed', 'm110-idle-provider-task', NULL, ?, ?)
    `).run(IDLE_TASK_ID, UNKNOWN_PROFILE, UNKNOWN_MODEL, OWNER_ID, timestamp, timestamp);
    database.prepare(`
      INSERT INTO generation_admission_events (
        task_id, execution_attempt, owner_id, kind, admission_type, created_at
      ) VALUES (?, 1, ?, 'video', 'initial', ?)
    `).run(IDLE_TASK_ID, OWNER_ID, timestamp);
    database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height, storage_profile_id
      ) VALUES ('video', ?, ?, 'm110-idle-published-video.mp4', ?, ?, ?, 'local',
        'm110-idle-published-video.mp4', 'video/mp4', ?, 'ready', 5,
        'provider-task', 'ready', 720, 480, NULL)
    `).run(
      IDLE_ASSET_ID, OWNER_ID, IDLE_MEDIA_BYTES.length, timestamp, timestamp,
      sha256(IDLE_MEDIA_BYTES),
    );
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state, storage_backend,
        final_storage_name, object_key, storage_profile_id, staging_name,
        task_id, task_execution_attempt, output_slot, output_set_count,
        history_label, byte_size, checksum_sha256, content_type,
        duration_seconds, duration_source, media_width, media_height,
        actual_cost_microunits, provider_usage_tokens, error_code, retry_count,
        adopted_at, adopted_canvas_id, created_at, updated_at
      ) VALUES (?, ?, 'video', ?, 'generation', 'published', 'local',
        'm110-idle-published-video.mp4', 'm110-idle-published-video.mp4', NULL,
        '.m110-idle-published-video.mp4.stage', ?, 1, 0, 1,
        'm110-r16-idle', ?, ?, 'video/mp4', 5, 'provider-task', 720, 480,
        0, NULL, NULL, 0, NULL, NULL, ?, ?)
    `).run(
      IDLE_ATTEMPT_ID, OWNER_ID, IDLE_ASSET_ID, IDLE_TASK_ID,
      IDLE_MEDIA_BYTES.length, sha256(IDLE_MEDIA_BYTES), timestamp, timestamp,
    );
    database.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  } finally {
    database.close();
  }
  const mediaDirectory = join(fixture.dataDirectory, "media");
  writeFileSync(join(mediaDirectory, "m110-idle-published-video.mp4"), IDLE_MEDIA_BYTES, {
    mode: 0o600,
    flag: "wx",
  });
  writeFileSync(join(mediaDirectory, ".m110-idle-published-video.mp4.stage"), IDLE_MEDIA_BYTES, {
    mode: 0o600,
    flag: "wx",
  });
}


function readIdlePublishedSnapshot(fixture: Fixture) {
  const database = new DatabaseSync(databasePath(fixture), { readOnly: true });
  const get = (sql: string, ...parameters: SQLInputValue[]) => database.prepare(sql).get(...parameters);
  const all = (sql: string, ...parameters: SQLInputValue[]) => database.prepare(sql).all(...parameters);
  const mediaDirectory = join(fixture.dataDirectory, "media");
  const readMedia = (name: string) => {
    const path = join(mediaDirectory, name);
    return existsSync(path) ? sha256(readFileSync(path)) : null;
  };
  try {
    return {
      tasks: all("SELECT id, state, attempt, result_asset_id, provider_task_id FROM generation_tasks ORDER BY id"),
      publication: get(`
        SELECT state, output_slot, output_set_count, error_code, retry_count
        FROM media_publication_attempts WHERE attempt_id = ?
      `, IDLE_ATTEMPT_ID),
      asset: get(`
        SELECT storage_status, storage_name, byte_size, checksum_sha256
        FROM media_assets WHERE id = ?
      `, IDLE_ASSET_ID),
      leases: all(`
        SELECT task_id, execution_attempt, phase, released_at
        FROM generation_result_save_leases WHERE task_id = ?
      `, IDLE_TASK_ID),
      media: {
        final: readMedia("m110-idle-published-video.mp4"),
        staging: readMedia(".m110-idle-published-video.mp4.stage"),
      },
    };
  } finally {
    database.close();
  }
}

function readSnapshot(fixture: Fixture) {
  const database = new DatabaseSync(databasePath(fixture), { readOnly: true });
  const get = (sql: string, ...parameters: SQLInputValue[]) => database.prepare(sql).get(...parameters);
  const all = (sql: string, ...parameters: SQLInputValue[]) => database.prepare(sql).all(...parameters);
  try {
    const mediaDirectory = join(fixture.dataDirectory, "media");
    const readMedia = (name: string) => {
      const path = join(mediaDirectory, name);
      return existsSync(path) ? sha256(readFileSync(path)) : null;
    };
    return {
      canvas: get("SELECT revision, nodes, edges, viewport, updated_at FROM canvas_documents WHERE owner_id = ? AND id = ?", OWNER_ID, CANVAS_ID),
      unknownTask: get("SELECT state, attempt, error_code, result_asset_id, provider_task_id FROM generation_tasks WHERE id = ?", UNKNOWN_TASK_ID),
      unknownEvents: all("SELECT state, error_code, error_message FROM generation_task_events WHERE task_id = ? ORDER BY id", UNKNOWN_TASK_ID),
      unknownProvider: all("SELECT execution_attempt, outcome, failure_code, provider_task_id, finished_at FROM generation_provider_attempts WHERE task_id = ? ORDER BY id", UNKNOWN_TASK_ID),
      unknownAdmission: all("SELECT execution_attempt, admission_type FROM generation_admission_events WHERE task_id = ? ORDER BY id", UNKNOWN_TASK_ID),
      stagedTask: get("SELECT state, attempt, error_code, result_asset_id, provider_task_id FROM generation_tasks WHERE id = ?", STAGED_TASK_ID),
      stagedEvents: all("SELECT state, error_code, error_message FROM generation_task_events WHERE task_id = ? ORDER BY id", STAGED_TASK_ID),
      stagedProvider: all("SELECT execution_attempt, outcome, failure_code, provider_task_id, finished_at FROM generation_provider_attempts WHERE task_id = ? ORDER BY id", STAGED_TASK_ID),
      stagedPublication: get("SELECT state, output_slot, output_set_count, error_code, retry_count FROM media_publication_attempts WHERE attempt_id = ?", STAGED_ATTEMPT_ID),
      stagedAsset: get("SELECT storage_status, storage_name, byte_size, checksum_sha256 FROM media_assets WHERE kind = 'video' AND id = ?", STAGED_ASSET_ID),
      lease: get("SELECT task_id, execution_attempt, phase, fence_epoch, released_at FROM generation_result_save_leases WHERE task_id = ?", UNKNOWN_TASK_ID),
      adoption: get("SELECT id, task_id, incident_digest, receipt_version, receipt_json FROM generation_result_adoptions WHERE id = 'm110-adoption'"),
      continuation: get("SELECT * FROM workflow_run_continuations WHERE id = 'm110-continuation'"),
      projectionReceipts: all("SELECT * FROM canvas_operation_receipts WHERE owner_id = ? AND canvas_id = ? ORDER BY operation_id", OWNER_ID, CANVAS_ID),
      media: {
        existing: readMedia("m110-existing.mp4"),
        staging: readMedia(".m110-staged-video.mp4.stage"),
        final: readMedia("m110-staged-video.mp4"),
      },
    };
  } finally {
    database.close();
  }
}

function waitForMessage(child: ChildProcess, type: string, timeoutMs = 10_000) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`child did not emit ${type}`));
    }, timeoutMs);
    const onMessage = (message: Record<string, unknown>) => {
      if (message.type === "error") {
        cleanup();
        reject(new Error(String(message.message)));
      } else if (message.type === type) {
        cleanup();
        resolve(message);
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`child exited before ${type}: ${code}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

const applicationOutput = new WeakMap<ChildProcess, string>();

function startActiveApplication(fixture: Fixture) {
  const testPort = Number(process.env.UNBOUNDRY_TEST_PORT);
  if (!Number.isInteger(testPort) || testPort < 1 || testPort > 65535) {
    throw new Error("UNBOUNDRY_TEST_PORT must be a registered nonzero port");
  }
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", activeApplicationBootstrap,
      fixture.dataDirectory, fixture.runtimeDirectory, fixture.providerCounterFile,
      String(testPort),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: fixture.dataDirectory,
        UNBOUNDRY_RUNTIME_DIR: fixture.runtimeDirectory,
        UNBOUNDRY_SAFE_TEST: "1",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const capture = (chunk: Buffer) => applicationOutput.set(child,
    ((applicationOutput.get(child) ?? "") + chunk.toString("utf8")).slice(-12_000));
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  return child;
}

async function stopActiveApplication(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.send?.({ action: "drain" });
  await waitForMessage(child, "drained");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function waitForStagedTaskSuccess(fixture: Fixture, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const database = new DatabaseSync(databasePath(fixture), { readOnly: true });
    try {
      const row = database.prepare("SELECT state, result_asset_id FROM generation_tasks WHERE id = ?").get(STAGED_TASK_ID) as { state?: string; result_asset_id?: string | null } | undefined;
      if (row?.state === "success" && row.result_asset_id === STAGED_ASSET_ID) return;
    } finally {
      database.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const database = new DatabaseSync(databasePath(fixture), { readOnly: true });
  try {
    const task = database.prepare(`
      SELECT state, attempt, error_code, error_message, result_asset_id, provider_task_id
      FROM generation_tasks WHERE id = ?
    `).get(STAGED_TASK_ID);
    const publication = database.prepare(`
      SELECT state, error_code, retry_count, output_slot, output_set_count
      FROM media_publication_attempts WHERE attempt_id = ?
    `).get(STAGED_ATTEMPT_ID);
    const asset = database.prepare(`
      SELECT storage_status, storage_name, byte_size, checksum_sha256
      FROM media_assets WHERE id = ?
    `).get(STAGED_ASSET_ID);
    throw new Error(`normal generation worker did not recover staged result: ${JSON.stringify({ task, publication, asset })}`);
  } finally {
    database.close();
  }
}

async function waitForStagingCleanup(fixture: Fixture, child: ChildProcess, timeoutMs = 40_000) {
  const staging = join(fixture.dataDirectory, "media", ".m110-staged-video.mp4.stage");
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (!existsSync(staging)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const database = new DatabaseSync(databasePath(fixture), { readOnly: true });
  try {
    const lease = database.prepare("SELECT * FROM generation_result_save_leases WHERE task_id = ?")
      .get(STAGED_TASK_ID);
    const observerPath = join(fixture.dataDirectory, ".unboundry-startup-worker-observer.log");
    throw new Error("normal generation recovery sweep did not clean published staging: " + JSON.stringify({
      lease, pid: child.pid, output: applicationOutput.get(child), startup: existsSync(observerPath) ? readFileSync(observerPath, "utf8") : "not observed",
    }));
  } finally { database.close(); }
}


async function waitForIdlePublishedStagingCleanup(fixture: Fixture, child: ChildProcess, timeoutMs = 40_000) {
  const staging = join(fixture.dataDirectory, "media", ".m110-idle-published-video.mp4.stage");
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (!existsSync(staging)) {
      const snapshot = readIdlePublishedSnapshot(fixture);
      if (snapshot.leases.length === 1 && snapshot.leases[0].released_at) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("idle published staging was not cleaned and released: " + JSON.stringify({
    pid: child.pid,
    snapshot: readIdlePublishedSnapshot(fixture),
    output: applicationOutput.get(child),
  }));
}

async function waitForReadonlyServer(child: ChildProcess) {
  return new Promise<number>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("readonly bridge did not start")), 10_000);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const line = buffer.split("\n")[0];
      if (!line) return;
      try {
        const message = JSON.parse(line) as { port?: number };
        if (!message.port) throw new Error("missing port");
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        resolve(message.port);
      } catch (error) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        reject(error);
      }
    };
    child.stdout?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`readonly bridge exited before listen: ${code}`));
    });
  });
}

async function stopReadonlyServer(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function responseText(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  return { response, text: await response.text() };
}

function activeApplicationPort() {
  const port = Number(process.env.UNBOUNDRY_TEST_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("UNBOUNDRY_TEST_PORT must be a registered nonzero port");
  }
  return port;
}

async function assertActiveApplicationHealth() {
  const origin = "http://127.0.0.1:" + activeApplicationPort();
  const live = await responseText(origin + "/api/health/live");
  const ready = await responseText(origin + "/api/health/ready");
  expect(live.response.status).toBe(200);
  expect(ready.response.status).toBe(200);
  expect(JSON.parse(live.text)).toMatchObject({ status: "live" });
  expect(JSON.parse(ready.text)).toMatchObject({ status: "ready" });
}

test.describe.configure({ mode: "serial" });


test("idle active app cleans published generated staging without a Provider retry", async () => {
  test.setTimeout(50_000);
  const fixture = createFixture("idle-published", {
    includeUnknown: false,
    includeExistingMedia: false,
  });
  let application: ChildProcess | undefined;
  try {
    insertIdlePublishedStagingResult(fixture);
    const before = readIdlePublishedSnapshot(fixture);
    expect(before.tasks).toEqual([{
      id: IDLE_TASK_ID,
      state: "success",
      attempt: 1,
      result_asset_id: IDLE_ASSET_ID,
      provider_task_id: "m110-idle-provider-task",
    }]);
    expect(before.publication).toMatchObject({
      state: "published", output_slot: 0, output_set_count: 1,
    });
    expect(before.asset).toMatchObject({
      storage_status: "ready", byte_size: IDLE_MEDIA_BYTES.length,
      checksum_sha256: sha256(IDLE_MEDIA_BYTES),
    });
    expect(before.leases).toEqual([]);
    expect(before.media.final).toBe(sha256(IDLE_MEDIA_BYTES));
    expect(before.media.staging).toBe(sha256(IDLE_MEDIA_BYTES));

    application = startActiveApplication(fixture);
    const ready = await waitForMessage(application, "worker-ready");
    expect(ready).toMatchObject({
      port: activeApplicationPort(),
      health: { liveStatus: 200, readyStatus: 200 },
    });
    await assertActiveApplicationHealth();
    await waitForIdlePublishedStagingCleanup(fixture, application);

    const after = readIdlePublishedSnapshot(fixture);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.publication).toEqual(before.publication);
    expect(after.asset).toEqual(before.asset);
    expect(after.media.final).toBe(before.media.final);
    expect(after.media.staging).toBeNull();
    expect(after.leases).toHaveLength(1);
    expect(after.leases[0]).toMatchObject({
      task_id: IDLE_TASK_ID, execution_attempt: 1,
    });
    expect(after.leases[0].released_at).toEqual(expect.any(String));
    expect(readFileSync(fixture.providerCounterFile, "utf8")).toBe("");
  } finally {
    if (application) {
      try { await stopActiveApplication(application); } catch { application.kill("SIGKILL"); }
    }
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test("schema44 bridge is an independent read-only process with no data routes", async () => {
  const fixture = createFixture("bridge");
  const packageDirectory = join(fixture.root, "preservation-package");
  const cli = join(process.cwd(), "scripts/schema44-readonly-preservation.mjs");
  try {
    const sourceSha = sha256File(databasePath(fixture));
    const packaged = await executeFile(process.execPath, [
      cli, "package", "--data-dir", fixture.dataDirectory,
      "--output-dir", packageDirectory, "--expected-database-sha256", sourceSha,
    ], { cwd: process.cwd(), env: process.env });
    const receipt = JSON.parse(packaged.stdout) as { manifest: Record<string, unknown> };
    expect(receipt.manifest).toMatchObject({
      mode: "read-only", providerRequests: 0, schemaVersion: 44, writesAccepted: false,
      sourceDataDirectory: fixture.dataDirectory,
    });
    expect(readFileSync(join(packageDirectory, "preservation-manifest.json"), "utf8"))
      .toContain("media-publication-output-slots-and-recovery");
    const runtime = join(packageDirectory, "schema44-readonly-preservation-runtime.mjs");
    expect(readdirSync(packageDirectory).sort()).toEqual([
      "maintenance.html",
      "preservation-manifest.json",
      "schema44-readonly-preservation-runtime.mjs",
    ]);
    expect(existsSync(runtime)).toBe(true);
    const runtimeSource = readFileSync(runtime, "utf8");
    expect(runtimeSource).not.toContain('from "vite"');
    expect(runtimeSource).not.toContain("/server/");
    expect(existsSync(join(packageDirectory, "unboundry.sqlite"))).toBe(false);
    expect(existsSync(join(packageDirectory, "media"))).toBe(false);

    const bridge = spawn(process.execPath, [
      runtime, "serve", "--package-dir", packageDirectory, "--port", String(process.env.UNBOUNDRY_TEST_AUX_PORT),
    ], { cwd: fixture.root, stdio: ["ignore", "pipe", "pipe"] });
    const port = await waitForReadonlyServer(bridge);
    try {
      const page = await responseText(`http://127.0.0.1:${port}/`);
      expect(page.response.status).toBe(200);
      expect(page.text).toContain("schema44");
      for (const route of ["/health", "/results", "/api/health"]) {
        const unavailable = await responseText(`http://127.0.0.1:${port}${route}`);
        expect(unavailable.response.status).toBe(503);
        expect(unavailable.text).not.toContain(UNKNOWN_TASK_ID);
      }
      const write = await responseText(`http://127.0.0.1:${port}/generate`, {
        method: "POST", body: "{}", headers: { "content-type": "application/json" },
      });
      expect(write.response.status).toBe(503);
      expect(JSON.parse(write.text)).toMatchObject({ code: "SCHEMA44_READONLY_MAINTENANCE" });
    } finally {
      await stopReadonlyServer(bridge);
    }
    expect(sha256File(databasePath(fixture))).toBe(sourceSha);
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test("schema44 new-app to readonly to new-app preserves ledgers and auto-recovers staged media", async () => {
  test.setTimeout(60_000);
  const fixture = createFixture("rehearsal");
  const packageDirectory = join(fixture.root, "rehearsal-package");
  const cli = join(process.cwd(), "scripts/schema44-readonly-preservation.mjs");
  let firstApplication: ChildProcess | undefined;
  let secondApplication: ChildProcess | undefined;
  let bridge: ChildProcess | undefined;
  try {
    insertQueryRecoveryPreservationEvidence(fixture);
    firstApplication = startActiveApplication(fixture);
    const firstReady = await waitForMessage(firstApplication, "worker-ready");
    expect(firstReady).toMatchObject({
      port: activeApplicationPort(),
      health: { liveStatus: 200, readyStatus: 200 },
    });
    await assertActiveApplicationHealth();
    await stopActiveApplication(firstApplication);
    firstApplication = undefined;

    // This is the synthetic crash boundary: the new app has stopped, and a
    // staged result plus its unknown provider ledger are now frozen in CURRENT.
    insertStagedResult(fixture);
    const beforeReadonly = readSnapshot(fixture);
    const sourceSha = sha256File(databasePath(fixture));
    await executeFile(process.execPath, [
      cli, "package", "--data-dir", fixture.dataDirectory,
      "--output-dir", packageDirectory, "--expected-database-sha256", sourceSha,
    ], { cwd: process.cwd(), env: process.env });

    const runtime = join(packageDirectory, "schema44-readonly-preservation-runtime.mjs");
    bridge = spawn(process.execPath, [
      runtime, "serve", "--package-dir", packageDirectory, "--port", String(process.env.UNBOUNDRY_TEST_AUX_PORT),
    ], { cwd: fixture.root, stdio: ["ignore", "pipe", "pipe"] });
    const port = await waitForReadonlyServer(bridge);
    const readonlyPage = await responseText(`http://127.0.0.1:${port}/maintenance`);
    expect(readonlyPage.response.status).toBe(200);
    const readonlyResults = await responseText(`http://127.0.0.1:${port}/results`);
    expect(readonlyResults.response.status).toBe(503);
    await stopReadonlyServer(bridge);
    bridge = undefined;

    // The read-only bridge used the exact same data directory. It must not
    // settle the task, rewrite the draft, or alter any recovery receipt.
    expect(readSnapshot(fixture)).toEqual(beforeReadonly);

    secondApplication = startActiveApplication(fixture);
    const secondReady = await waitForMessage(secondApplication, "worker-ready");
    expect(secondReady).toMatchObject({
      port: activeApplicationPort(),
      health: { liveStatus: 200, readyStatus: 200 },
    });
    await assertActiveApplicationHealth();
    await waitForStagedTaskSuccess(fixture);
    await waitForStagingCleanup(fixture, secondApplication);
    await stopActiveApplication(secondApplication);
    secondApplication = undefined;
    const afterRecovery = readSnapshot(fixture);
    // A real stageMediaPublication marks known duration ready before setting
    // publication=staged. Reopening exercises the complete current-data gate
    // after recovery, including metadata consistency and released ownership.
    const reopened = openAppDatabase(fixture.dataDirectory);
    reopened.close();
    expect(afterRecovery.canvas).toEqual(beforeReadonly.canvas);
    expect(afterRecovery.unknownTask).toEqual(beforeReadonly.unknownTask);
    expect(afterRecovery.unknownEvents).toEqual(beforeReadonly.unknownEvents);
    expect(afterRecovery.unknownProvider).toEqual(beforeReadonly.unknownProvider);
    expect(afterRecovery.unknownAdmission).toEqual(beforeReadonly.unknownAdmission);
    expect(afterRecovery.lease).toEqual(beforeReadonly.lease);
    expect(afterRecovery.adoption).toEqual(beforeReadonly.adoption);
    expect(afterRecovery.continuation).toEqual(beforeReadonly.continuation);
    expect(afterRecovery.projectionReceipts).toEqual(beforeReadonly.projectionReceipts);
    expect(afterRecovery.stagedTask).toMatchObject({
      state: "success", result_asset_id: STAGED_ASSET_ID,
    });
    expect(afterRecovery.stagedPublication).toMatchObject({
      state: "published", output_slot: 0, output_set_count: 1,
    });
    expect(afterRecovery.stagedAsset).toMatchObject({ storage_status: "ready" });
    expect(afterRecovery.media.existing).toBe(beforeReadonly.media.existing);
    expect(afterRecovery.media.final).toBe(sha256(MEDIA_BYTES));
    expect(afterRecovery.media.staging).toBeNull();
    expect(readFileSync(fixture.providerCounterFile, "utf8")).toBe("");
  } finally {
    if (bridge) await stopReadonlyServer(bridge);
    if (firstApplication) {
      try { await stopActiveApplication(firstApplication); } catch { firstApplication.kill("SIGKILL"); }
    }
    if (secondApplication) {
      try { await stopActiveApplication(secondApplication); } catch { secondApplication.kill("SIGKILL"); }
    }
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

function sha256File(path: string) {
  return sha256(readFileSync(path));
}
