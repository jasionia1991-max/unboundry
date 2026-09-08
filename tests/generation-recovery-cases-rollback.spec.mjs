import { createHash, generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createServer } from "vite";

const env = process.env;
const CONTRACT = "unboundry-generation-recovery-cases-rollback-v1";
const BASELINE_CONTRACT = "unboundry-generation-recovery-cases-v3-baseline-v1";
const BASELINE_HEAD = "d7897a5e6bdd836d3d1685a0a1bbb7760373b20f";
const BASELINE_BRANCH = "codex/v0716-release-closeout";
const BASELINE_FILE_COUNT = 572;
const BASELINE_RUNTIME_FILE_COUNT = 193;
const EXACT_V0716_BASELINE_CONTRACT =
  "unboundry-generation-server-types-baseline-v1";
const EXACT_V0716_BASELINE_HEAD =
  "d7897a5e6bdd836d3d1685a0a1bbb7760373b20f";
const EXACT_V0716_BASELINE_TREE =
  "3914f3219eb763dea37253077a5dccf1477998fe";
const EXACT_V0716_BASELINE_FILE_COUNT = 192;
const EVIDENCE_FILE = "generation-recovery-cases-rollback.json";
const OWNER_ID = "__test__";
const ADMIN_ID = "__recovery_admin__";
const CANVAS_ID = "generation-recovery-cases-v4-canvas";
const FIXTURE_SCOPE = "generation-recovery-cases-v4";
const RECOVERY_CASE_CODE = "RECOVERY_CASE_V1";
const ORIGINAL_ONLY_EVENT_CODE = "RECOVERY_ORIGINAL_ONLY_V1";
const MALFORMED_CASE_MARKER = "RECOVERY_CASE_MALFORMED_FIXTURE";
const SUCCESS_RESULT = "same-synthetic-result-survives-v4-v3-v4";
const PROTECTED_PATHS = new Set([
  "spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json",
  "spec/public-templates-director-split-revision.json",
]);

function fail(message) {
  throw new Error(`[generation-recovery-cases-rollback] ${message}`);
}

function requireEnvironment(name) {
  const value = env[name];
  if (!value) fail(`missing ${name}`);
  return value;
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function assertPrivatePath(path, root, label) {
  let resolved;
  try {
    resolved = realpathSync(path);
  } catch (error) {
    fail(`${label} is not a readable real path: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isInside(root, resolved)) fail(`${label} escaped the isolated test root`);
  if ([...PROTECTED_PATHS].some((protectedPath) =>
    resolved.endsWith(`/${protectedPath}`)
  )) fail(`${label} points at a protected workspace path`);
  return resolved;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digest(value) {
  return sha256(Buffer.from(JSON.stringify(stableValue(value)), "utf8"));
}

function stableValue(value) {
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function databasePathFor(dataDirectory) {
  return join(dataDirectory, "unboundry.sqlite");
}

function databaseIdentity(path) {
  const details = lstatSync(path, { bigint: true });
  if (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1n) {
    fail("synthetic SQLite database is not a regular single-linked file");
  }
  return `${details.dev}:${details.ino}`;
}

function openRawDatabase(dataDirectory) {
  const path = databasePathFor(dataDirectory);
  if (!existsSync(path)) fail("synthetic SQLite database was not created");
  return new DatabaseSync(path, { timeout: 5_000 });
}

function readRows(database, table, columns, where, parameters = []) {
  return database.prepare(`SELECT ${columns} FROM ${table} ${where}`)
    .all(...parameters)
    .map(stableValue);
}

function readSnapshot(database, taskIds) {
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    fail("snapshot requires at least one task");
  }
  const placeholders = taskIds.map(() => "?").join(", ");
  const tasks = readRows(
    database,
    "generation_tasks",
    "id, canvas_id, node_id, kind, prompt, model, parameters, idempotency_key, request_fingerprint, state, attempt, error_code, error_message, created_at, updated_at, owner_id, estimated_cost_microunits, provider_profile_id, provider_model_id, cost_currency, model_configuration, credential_revision, provider_task_id, provider_usage_tokens, result_asset_id, result_text, actual_cost_microunits",
    `WHERE id IN (${placeholders}) ORDER BY id ASC`,
    taskIds,
  );
  const attempts = readRows(
    database,
    "generation_provider_attempts",
    "id, task_id, execution_attempt, owner_id, provider_profile_id, provider_model_id, kind, evidence, credential_revision, outcome, provider_task_id, failure_code, finished_at, created_at",
    `WHERE task_id IN (${placeholders}) ORDER BY id ASC`,
    taskIds,
  );
  const events = readRows(
    database,
    "generation_task_events",
    "id, task_id, state, error_code, error_message, created_at",
    `WHERE task_id IN (${placeholders}) ORDER BY id ASC`,
    taskIds,
  );
  const admissionEvents = readRows(
    database,
    "generation_admission_events",
    "id, task_id, execution_attempt, owner_id, kind, admission_type, created_at",
    `WHERE task_id IN (${placeholders}) ORDER BY id ASC`,
    taskIds,
  );
  const canvas = stableValue(database.prepare(`
    SELECT owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_session_id, save_sequence
    FROM canvas_documents WHERE owner_id = ? AND id = ?
  `).get(OWNER_ID, CANVAS_ID));
  const safety = stableValue(database.prepare(`
    SELECT id, global_enabled, emergency_stop, per_user_concurrency,
      requests_per_minute, text_concurrency, image_concurrency,
      video_concurrency, audio_concurrency, failure_threshold,
      cooldown_minutes, running_task_policy, updated_at
    FROM generation_safety_settings WHERE id = 1
  `).get());
  const counts = Object.fromEntries([
    ["tasks", "generation_tasks"],
    ["events", "generation_task_events"],
    ["attempts", "generation_provider_attempts"],
    ["admissions", "generation_admission_events"],
  ].map(([key, table]) => [
    key,
    Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
  ]));
  const ledger = { admissionEvents, attempts, canvas, events, tasks };
  return Object.freeze({
    admissionEvents,
    attempts,
    canvas,
    counts,
    digest: digest({ ...ledger, safety }),
    events,
    ledgerDigest: digest(ledger),
    safety,
    tasks,
  });
}

function setSafety(database, enabled) {
  database.prepare(`
    UPDATE generation_safety_settings
    SET global_enabled = ?, emergency_stop = 0,
      per_user_concurrency = 20, requests_per_minute = 120,
      text_concurrency = 20, image_concurrency = 20,
      video_concurrency = 20, audio_concurrency = 20,
      failure_threshold = 3, cooldown_minutes = 30,
      running_task_policy = 'wait', updated_at = ?
    WHERE id = 1
  `).run(Number(enabled), new Date().toISOString());
}

function taskInput(kind, nodeId, prompt, idempotencyKey) {
  return {
    canvasId: CANVAS_ID,
    idempotencyKey,
    kind,
    model: `fixture-${kind}`,
    modelConfiguration: { fixtureScopeId: FIXTURE_SCOPE },
    nodeId,
    ownerId: OWNER_ID,
    parameters: { fixtureScopeId: FIXTURE_SCOPE },
    prompt,
    providerModelId: `fixture-${kind}-model`,
    providerProfileId: `fixture-${kind}-profile`,
  };
}

function createRunning(store, input) {
  const created = store.create(input).task;
  const running = store.transition(created.id, "running");
  if (!running || running.state !== "running" || running.attempt !== 1) {
    fail(`fixture task did not enter running: ${created.id}`);
  }
  return running;
}

function createProviderFailure(store, input, outcome, failureCode) {
  const running = createRunning(store, input);
  store.recordProviderAttempt(running.id);
  store.settleProviderAttempt({
    executionAttempt: 1,
    failureCode,
    outcome,
    taskId: running.id,
  });
  const failed = store.transition(running.id, "failed", {
    code: failureCode,
    message: `synthetic ${failureCode}`,
  });
  if (!failed || failed.state !== "failed" || failed.errorCode !== failureCode) {
    fail(`fixture task did not enter failed: ${running.id}`);
  }
  return failed;
}

async function createRuntime(sourceRoot, importedRoot, testRoot) {
  const server = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    root: sourceRoot,
    server: {
      fs: {
        allow: [sourceRoot, importedRoot, testRoot],
        strict: true,
      },
      hmr: false,
      middlewareMode: true,
      ws: false,
    },
  });
  const moduleUrl = (path) => `/@fs/${path.split(sep).join("/")}`;
  const load = (path) => server.ssrLoadModule(moduleUrl(path));
  try {
    const storeModule = await load(join(importedRoot, "server/generationTaskStore.ts"));
    const databaseModule = await load(join(importedRoot, "server/database.ts"));
    return Object.freeze({ databaseModule, importedRoot, load, server, storeModule });
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function closeRuntime(runtime, store) {
  try {
    store?.close();
  } finally {
    await runtime.server.close();
  }
}

function ensureSyntheticOwner(database, timestamp) {
  database.prepare(`
    INSERT OR IGNORE INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'safe-fixture', 'user', 'active', ?, ?)
  `).run(OWNER_ID, OWNER_ID, "Recovery cases fixture", timestamp, timestamp);
}

function ensureSyntheticAdmin(database, timestamp) {
  database.prepare(`
    INSERT OR IGNORE INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'safe-fixture', 'admin', 'active', ?, ?)
  `).run(ADMIN_ID, ADMIN_ID, "Recovery cases operator", timestamp, timestamp);
}

function insertCanvas(database, taskIds, timestamp) {
  const nodes = [
    {
      data: {
        textGenerationTaskId: taskIds.successId,
        textGenerationResult: SUCCESS_RESULT,
      },
      id: "recovery-success-node",
      position: { x: 10, y: 20 },
      type: "text",
    },
    {
      data: { textGenerationTaskId: taskIds.unknownId },
      id: "recovery-unknown-node",
      position: { x: 210, y: 20 },
      type: "text",
    },
    {
      data: { videoGenerationTaskId: taskIds.refundParentId },
      id: "recovery-refund-node",
      position: { x: 10, y: 220 },
      type: "video",
    },
    {
      data: { textGenerationTaskId: taskIds.caseTaskId },
      id: "recovery-case-node",
      position: { x: 210, y: 220 },
      type: "text",
    },
  ];
  const edges = [{
    id: "recovery-case-edge",
    source: "recovery-success-node",
    target: "recovery-unknown-node",
  }];
  const viewport = { x: 11, y: 17, zoom: 0.9 };
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_session_id, save_sequence
    ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, 'recovery-cases-session', 1)
  `).run(
    OWNER_ID,
    CANVAS_ID,
    JSON.stringify(nodes),
    JSON.stringify(edges),
    JSON.stringify(viewport),
    timestamp,
  );
}

function insertEvent(database, taskId, state, errorCode, errorMessage, timestamp) {
  database.prepare(`
    INSERT INTO generation_task_events
      (task_id, state, error_code, error_message, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(taskId, state, errorCode, errorMessage, timestamp);
}

function readOriginalOnlyMarker(snapshot, taskId) {
  const rows = snapshot.events.filter((event) =>
    event.task_id === taskId && event.error_code === ORIGINAL_ONLY_EVENT_CODE,
  );
  if (rows.length !== 1 || typeof rows[0].error_message !== "string") {
    fail(`original-only marker count changed for ${taskId}`);
  }
  let marker;
  try {
    marker = JSON.parse(rows[0].error_message);
  } catch {
    fail(`original-only marker is not JSON for ${taskId}`);
  }
  if (
    !marker || typeof marker !== "object" || Array.isArray(marker) ||
    marker.version !== 1 || marker.marker !== "original-only" ||
    marker.taskId !== taskId || marker.ownerId !== OWNER_ID ||
    marker.caseId !== "recovery-original-only-case" ||
    marker.operationId !== "recovery-original-only-operation" ||
    marker.executionAttempt !== 1
  ) fail(`original-only marker identity changed for ${taskId}`);
  return marker;
}

function recoveryFence(snapshot, operationId, actorId, now) {
  return {
    taskId: snapshot.taskId,
    ownerId: snapshot.ownerId,
    caseId: snapshot.caseId,
    executionAttempt: snapshot.executionAttempt,
    expectedCaseEventId: snapshot.eventId,
    expectedCaseRevision: snapshot.caseRevision,
    expectedTaskEventWatermark: snapshot.taskEventWatermark,
    operationId,
    actorId,
    now,
  };
}

function recoveryEvidence(database, taskId) {
  const row = database.prepare(`
    SELECT id, error_message
    FROM generation_task_events
    WHERE task_id = ? AND error_code IS NOT NULL
    ORDER BY id ASC
    LIMIT 1
  `).get(taskId);
  if (!row || typeof row.error_message !== "string") {
    fail("synthetic recovery task has no evidence event");
  }
  return {
    kind: "task_event",
    eventId: Number(row.id),
    sha256: sha256(Buffer.from(row.error_message, "utf8")),
  };
}

function seedRecoveryCaseEvents(database, recoveryModule, taskIds) {
  const recoveryStore = recoveryModule.createGenerationRecoveryCaseStore(database, {
    enabled: true,
  });
  const nowBase = Date.now() + 5_000;
  const at = (offset) => new Date(nowBase + offset).toISOString();

  let snapshot = recoveryStore.ensureCase({
    taskId: taskIds.caseTaskId,
    ownerId: OWNER_ID,
    executionAttempt: 1,
    reason: "operator_incident",
    operationId: "r09-open-case",
    now: at(0),
  });
  snapshot = recoveryStore.claim(recoveryFence(
    snapshot,
    "r09-claim-case",
    ADMIN_ID,
    at(1_000),
  ));
  snapshot = recoveryStore.markProgress({
    ...recoveryFence(snapshot, "r09-check-waiting", ADMIN_ID, at(2_000)),
    phase: "waiting_provider",
  });
  // Synthetic authoritative terminal fact. Maintenance phase is derived from
  // the real settled task; it is never promoted by a claimed phase alone.
  database.prepare(`UPDATE generation_provider_attempts
    SET outcome = 'definitive-rejected', failure_code = 'PROVIDER_NOT_ACCEPTED_NO_CHARGE', finished_at = ?
    WHERE task_id = ? AND execution_attempt = 1`).run(at(33_000), taskIds.caseTaskId);
  database.prepare(`UPDATE generation_tasks SET error_code = 'PROVIDER_NOT_ACCEPTED_NO_CHARGE', updated_at = ?
    WHERE id = ?`).run(at(33_000), taskIds.caseTaskId);
  insertEvent(database, taskIds.caseTaskId, "failed", "PROVIDER_NOT_ACCEPTED_NO_CHARGE", "Synthetic terminal fixture", at(33_000));
  snapshot = recoveryStore.getByTaskAttempt(taskIds.caseTaskId, 1, OWNER_ID);
  snapshot = recoveryStore.settleFromTask(recoveryFence(snapshot, "r09-settle-ready",
    recoveryModule.generationRecoverySystemActorId, at(34_000)));
  snapshot = recoveryStore.acknowledge({
    ...recoveryFence(snapshot, "r09-ack-case", OWNER_ID, at(35_000)),
    expectedProgressVersion: snapshot.progressVersion,
  });
  const closed = recoveryStore.closeCase(recoveryFence(
    snapshot,
    "r09-close-case",
    ADMIN_ID,
    at(36_000),
  ));

  let unread = recoveryStore.ensureCase({
    taskId: taskIds.unreadCaseTaskId,
    ownerId: OWNER_ID,
    executionAttempt: 1,
    reason: "result_recovery_pending",
    operationId: "r09-open-unread",
    now: at(60_000),
  });
  unread = recoveryStore.claim(recoveryFence(
    unread,
    "r09-claim-unread",
    ADMIN_ID,
    at(61_000),
  ));
  unread = recoveryStore.markProgress({
    ...recoveryFence(unread, "r09-check-unread", ADMIN_ID, at(62_000)),
    phase: "waiting_provider",
  });

  // Only the deliberately corrupt fixture bypasses the store API. The valid
  // case histories above are written through the actual V4 store.
  insertEvent(
    database,
    taskIds.malformedCaseTaskId,
    "failed",
    RECOVERY_CASE_CODE,
    `{"version":1,"marker":"${MALFORMED_CASE_MARKER}"`,
    at(63_000),
  );
  return Object.freeze({
    case: closed,
    caseEventCount: 6,
    unread,
    unreadEventCount: 3,
  });
}

function recoveryCaseEventRows(store, taskId) {
  return store.listEvents(taskId).filter((event) => event.errorCode === RECOVERY_CASE_CODE);
}

function assertRecoveryCaseEventHistory(store, seeded) {
  const events = recoveryCaseEventRows(store, seeded.caseTaskId);
  if (events.length !== seeded.caseEventCount) fail("recovery case event count changed");
  const payloads = events.map((event) => {
    try {
      return JSON.parse(event.errorMessage ?? "");
    } catch {
      fail("valid recovery case event was not JSON");
    }
  });
  const expectedPhases = [
    "queued", "claimed", "waiting_provider", "ready_for_user", "ready_for_user", "ready_for_user",
  ];
  const expectedEvents = [
    "opened", "claimed", "progressed", "checked", "acknowledged", "closed",
  ];
  if (payloads.some((payload, index) =>
    payload?.phase !== expectedPhases[index] || payload?.event !== expectedEvents[index]
  )) fail("recovery case phase history changed");
  if (payloads.at(-2)?.closedAt !== undefined || typeof payloads.at(-1)?.closedAt !== "string") {
    fail("closed recovery case did not preserve its close event boundary");
  }
  const unreadEvents = recoveryCaseEventRows(store, seeded.unreadCaseTaskId);
  if (unreadEvents.length !== seeded.unreadEventCount) fail("unread recovery case event count changed");
  const unreadPayload = JSON.parse(unreadEvents.at(-1)?.errorMessage ?? "{}");
  if (unreadPayload.phase !== "waiting_provider" ||
      unreadPayload.progressVersion <= unreadPayload.lastReadProgressVersion) {
    fail("unread recovery case read state changed");
  }
  const malformedEvents = recoveryCaseEventRows(store, seeded.malformedCaseTaskId);
  if (malformedEvents.length !== 1 || malformedEvents[0].errorMessage !==
      `{"version":1,"marker":"${MALFORMED_CASE_MARKER}"`) {
    fail("malformed recovery case event was normalized or discarded");
  }
  return events;
}

function assertRecoveryCaseStoreView(recoveryStore, seeded) {
  const page = recoveryStore.list({ ownerId: OWNER_ID, limit: 200 });
  const closed = page.items.find((item) => item.task.id === seeded.caseTaskId);
  const unread = page.items.find((item) => item.task.id === seeded.unreadCaseTaskId);
  if (!closed || closed.phase !== "ready_for_user" || !closed.closedAt ||
      !unread || unread.phase !== "waiting_provider" ||
      unread.progressVersion <= unread.lastReadProgressVersion) {
    fail("recovery store did not expose closed and unread case summaries");
  }
  if (!page.corrupt?.some((item) => item.taskId === seeded.malformedCaseTaskId)) {
    fail("recovery store did not quarantine the malformed event");
  }
  const serialized = JSON.stringify(page);
  if (serialized.includes(RECOVERY_CASE_CODE) || serialized.includes(MALFORMED_CASE_MARKER)) {
    fail("recovery store owner surface leaked event JSON");
  }
  return true;
}

function assertNoEventJsonInOwnerSurface(store) {
  const visible = [
    ...store.listForOwner(CANVAS_ID, OWNER_ID),
  ];
  const serialized = JSON.stringify(visible);
  if (serialized.includes(RECOVERY_CASE_CODE) ||
      serialized.includes(MALFORMED_CASE_MARKER)) {
    fail("owner task projection leaked recovery event JSON");
  }
  return true;
}

async function seedCandidate(sourceRoot, testRoot, dataDirectory) {
  const runtime = await createRuntime(sourceRoot, sourceRoot, testRoot);
  let store;
  let database;
  try {
    database = runtime.databaseModule.openAppDatabase(dataDirectory);
    const timestamp = "2026-09-08T00:00:00.000Z";
    ensureSyntheticOwner(database, timestamp);
    ensureSyntheticAdmin(database, timestamp);
    setSafety(database, true);
    database.close();
    database = undefined;

    store = runtime.storeModule.createGenerationTaskStore(dataDirectory, {
      recoverRunning: false,
    });
    const successRunning = createRunning(store, taskInput(
      "text",
      "recovery-success-node",
      "success fixture",
      "recovery-success-0001",
    ));
    const success = store.complete(successRunning.id, {
      actualCostMicrounits: 0,
      resultText: SUCCESS_RESULT,
    });
    if (!success || success.state !== "success" || success.resultText !== SUCCESS_RESULT) {
      fail("success fixture did not retain its result");
    }
    const unknown = createProviderFailure(
      store,
      taskInput(
        "text",
        "recovery-unknown-node",
        "unknown fixture",
        "recovery-unknown-0001",
      ),
      "outcome-unknown",
      "OUTCOME_UNKNOWN_BILLING_RISK",
    );
    const refundParent = createProviderFailure(
      store,
      taskInput(
        "video",
        "recovery-refund-node",
        "refunded fixture",
        "recovery-refund-parent-0001",
      ),
      "provider-failed",
      "PROVIDER_REFUNDED",
    );
    const refundChild = store.create(taskInput(
      "video",
      "recovery-refund-node",
      "automatic compensation child",
      "recovery-refund-child-0001",
    )).task;
    const caseTask = createProviderFailure(
      store,
      taskInput(
        "text",
        "recovery-case-node",
        "durable recovery case fixture",
        "recovery-case-0001",
      ),
      "outcome-unknown",
      "OPERATOR_INCIDENT",
    );
    const unreadCaseTask = createProviderFailure(
      store,
      taskInput(
        "text",
        "recovery-unread-node",
        "unread recovery case fixture",
        "recovery-unread-0001",
      ),
      "outcome-unknown",
      "OPERATOR_INCIDENT",
    );
    const malformedCaseTask = createProviderFailure(
      store,
      taskInput(
        "text",
        "recovery-malformed-node",
        "malformed recovery case fixture",
        "recovery-malformed-0001",
      ),
      "outcome-unknown",
      "OPERATOR_INCIDENT",
    );
    const originalOnlyCreated = store.create(taskInput(
      "video",
      "recovery-original-only-node",
      "original-only recovery fixture",
      "recovery-original-only-0001",
    )).task;
    const originalOnlyRunning = store.transition(originalOnlyCreated.id, "running");
    if (!originalOnlyRunning || originalOnlyRunning.state !== "running") {
      fail("original-only fixture did not enter running");
    }
    store.recordProviderAttempt(originalOnlyRunning.id);
    store.setProviderTaskId(originalOnlyRunning.id, "recovery-original-provider-0001");
    const originalOnly = store.transition(originalOnlyRunning.id, "recovering", {
      code: "AUTOMATIC_RESULT_RECOVERY",
      message: "Synthetic original-only recovery",
    });
    if (!originalOnly || originalOnly.state !== "recovering" || originalOnly.attempt !== 1) {
      fail("original-only fixture did not enter protected recovery");
    }
    const taskIds = Object.freeze({
      caseTaskId: caseTask.id,
      childId: refundChild.id,
      malformedCaseTaskId: malformedCaseTask.id,
      originalOnlyId: originalOnly.id,
      refundParentId: refundParent.id,
      successId: success.id,
      unreadCaseTaskId: unreadCaseTask.id,
      unknownId: unknown.id,
      taskIds: Object.freeze([
        success.id,
        unknown.id,
        refundParent.id,
        refundChild.id,
        caseTask.id,
        unreadCaseTask.id,
        malformedCaseTask.id,
        originalOnly.id,
      ]),
    });
    store.close();
    store = undefined;

    database = runtime.databaseModule.openAppDatabase(dataDirectory);
    insertCanvas(database, taskIds, timestamp);
    insertEvent(
      database,
      refundParent.id,
      "failed",
      "USER_GENERATION_INTENT_OPENED_V3",
      JSON.stringify({ taskId: refundParent.id, version: 3 }),
      timestamp,
    );
    insertEvent(
      database,
      refundParent.id,
      "failed",
      "AUTO_REFUND_COMPENSATION_ADMITTED",
      JSON.stringify({ parentTaskId: refundParent.id, taskId: refundChild.id }),
      timestamp,
    );
    insertEvent(
      database,
      refundChild.id,
      "queued",
      "AUTO_REFUND_COMPENSATION_CHILD",
      JSON.stringify({ parentTaskId: refundParent.id }),
      timestamp,
    );
    insertEvent(
      database,
      originalOnly.id,
      "recovering",
      ORIGINAL_ONLY_EVENT_CODE,
      JSON.stringify({
        version: 1,
        marker: "original-only",
        caseId: "recovery-original-only-case",
        taskId: originalOnly.id,
        executionAttempt: originalOnly.attempt,
        ownerId: OWNER_ID,
        operationId: "recovery-original-only-operation",
      }),
      timestamp,
    );
    const recoveryModule = await runtime.load(join(sourceRoot, "server/generationRecoveryCaseStore.ts"));
    const recoverySeed = seedRecoveryCaseEvents(database, recoveryModule, taskIds);
    const recoveryViewStore = recoveryModule.createGenerationRecoveryCaseStore(database, {
      enabled: true,
    });
    assertRecoveryCaseStoreView(recoveryViewStore, {
      ...taskIds,
      ...recoverySeed,
    });
    setSafety(database, true);
    database.close();
    database = undefined;
    const checkStore = runtime.storeModule.createGenerationTaskStore(dataDirectory, {
      recoverRunning: false,
    });
    assertRecoveryCaseEventHistory(checkStore, {
      ...taskIds,
      ...recoverySeed,
    });
    assertNoEventJsonInOwnerSurface(checkStore);
    checkStore.close();
    return Object.freeze({ ...taskIds, ...recoverySeed });
  } finally {
    database?.close();
    await closeRuntime(runtime, store);
  }
}

async function backupAndRestore(sourceRoot, testRoot, dataDirectory, seeded, sourceSnapshot) {
  const runtime = await createRuntime(sourceRoot, sourceRoot, testRoot);
  const databasePath = databasePathFor(dataDirectory);
  const backupRoot = join(testRoot, "generation-recovery-cases-backups");
  const scratchRoot = join(testRoot, "generation-recovery-cases-backup-scratch");
  const restoreRoot = join(testRoot, "generation-recovery-cases-fresh-restore");
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  mkdirSync(scratchRoot, { recursive: true, mode: 0o700 });
  try {
    const control = new DatabaseSync(databasePath, { timeout: 5_000 });
    control.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    control.close();
    const inspectionModule = await runtime.load(join(sourceRoot, "server/backupInspection.ts"));
    const backupModule = await runtime.load(join(sourceRoot, "server/backupPackage.ts"));
    const sourceInspection = inspectionModule.inspectBackupDatabase(
      databasePath,
      dataDirectory,
    );
    if (sourceInspection.userVersion !== 43) {
      fail(`synthetic backup source schema is ${sourceInspection.userVersion}, expected 43`);
    }
    if (sourceInspection.logicalSha256 !== sourceSnapshot.databaseLogicalSha256) {
      fail("backup source logical fingerprint changed before capture");
    }
    const keys = {
      recovery: generateKeyPairSync("rsa", {
        modulusLength: 3_072,
      }),
      signing: generateKeyPairSync("ed25519"),
    };
    const backup = await backupModule.createEncryptedBackup({
      backupRoot,
      recoveryPublicKey: keys.recovery.publicKey,
      scratchRoot,
      signingPrivateKey: keys.signing.privateKey,
      sourceDirectory: dataDirectory,
      sourceFrozen: true,
    });
    if (backup.schemaVersion !== 43) fail("backup package did not record schema43");
    const verified = await backupModule.verifyEncryptedBackup({
      packageDirectory: backup.packageDirectory,
      recoveryPrivateKey: keys.recovery.privateKey,
      scratchRoot,
      trustedSigningPublicKey: keys.signing.publicKey,
    });
    if (verified.schemaVersion !== 43) fail("backup verify did not return schema43");
    const restored = await backupModule.restoreEncryptedBackup({
      packageDirectory: backup.packageDirectory,
      recoveryPrivateKey: keys.recovery.privateKey,
      scratchRoot,
      targetDirectory: restoreRoot,
      trustedSigningPublicKey: keys.signing.publicKey,
    });
    if (restored.schemaVersion !== 43) fail("fresh restore did not return schema43");
    const restoredInspection = inspectionModule.inspectBackupDatabase(
      databasePathFor(restoreRoot),
      restoreRoot,
    );
    const restoredDatabase = new DatabaseSync(databasePathFor(restoreRoot), { timeout: 5_000 });
    const restoredSnapshot = readSnapshot(restoredDatabase, seeded.taskIds);
    restoredDatabase.close();
    if (
      restoredInspection.userVersion !== 43 ||
      restoredInspection.logicalSha256 !== sourceInspection.logicalSha256 ||
      restoredSnapshot.digest !== sourceSnapshot.digest
    ) fail("schema43 fresh restore changed the synthetic recovery ledger");
    return Object.freeze({
      captureMode: backup.captureMode,
      dataPreserved: true,
      freshRestore: true,
      restoredLogicalSha256: restoredInspection.logicalSha256,
      restoredSchemaVersion: restoredInspection.userVersion,
      restoredSnapshotDigest: restoredSnapshot.digest,
      schemaVersion: backup.schemaVersion,
      sourceFreezeContractUsed: false,
      sourceLogicalSha256: sourceInspection.logicalSha256,
      sourceSnapshotDigest: sourceSnapshot.digest,
      strictSchema43: true,
      verifiedSchemaVersion: verified.schemaVersion,
    });
  } finally {
    await runtime.server.close();
  }
}

async function oldPausedPhase(
  sourceRoot,
  baselineRoot,
  testRoot,
  dataDirectory,
  seeded,
  pausedSnapshot,
) {
  const runtime = await createRuntime(sourceRoot, baselineRoot, testRoot);
  let store;
  try {
    store = runtime.storeModule.createGenerationTaskStore(dataDirectory, {
      recoverRunning: false,
    });
    assertRecoveryCaseEventHistory(store, seeded);
    const ownerSurfaceNoEventJson = assertNoEventJsonInOwnerSurface(store);
    let admissionError;
    try {
      store.admitOrGet({
        ...taskInput(
          "text",
          "recovery-unknown-node",
          "changed fingerprint while V3 generation is paused",
          "recovery-old-changed-0001",
        ),
      });
    } catch (error) {
      admissionError = error;
    }
    if (!admissionError || admissionError.code !== "RETRY_OUTCOME_UNKNOWN") {
      fail(`paused V3 unknown attempt lost its original protection: ${admissionError?.code ?? "none"}`);
    }
    const unknownAdmissionCode = admissionError.code;
    admissionError = undefined;
    try {
      store.admitOrGet(taskInput("text", "recovery-paused-new-node",
        "new task while V3 generation is paused", "recovery-old-paused-0001"));
    } catch (error) { admissionError = error; }
    if (!admissionError || admissionError.code !== "GLOBAL_DISABLED") {
      fail(`paused V3 new admission was not rejected as GLOBAL_DISABLED: ${admissionError?.code ?? "none"}`);
    }
    store.close();
    store = undefined;
    const databasePath = databasePathFor(dataDirectory);
    const afterDatabase = openRawDatabase(dataDirectory);
    const after = readSnapshot(afterDatabase, seeded.taskIds);
    afterDatabase.close();
    if (after.digest !== pausedSnapshot.digest) {
      fail("paused V3 changed the shared SQLite ledger");
    }
    return Object.freeze({
      admissionAttempts: 1,
      unknownAdmissionAttempts: 1,
      unknownAdmissionCode,
      admissionCode: admissionError.code,
      admissionRejected: true,
      caseRowsPreserved: after.events.length === pausedSnapshot.events.length,
      databaseWrites: 0,
      generationPaused: after.safety.global_enabled === 0,
      globalGenerationEnabled: after.safety.global_enabled === 1,
      maintenanceControl: "fixture-only-control",
      maintenanceMode: "off",
      malformedEventPreserved: after.events.at(-1)?.error_message ===
        pausedSnapshot.events.at(-1)?.error_message,
      ownerSurfaceNoEventJson,
      providerPostCount: 0,
      readStatePreserved: digest(after.events) === digest(pausedSnapshot.events),
      runtimeScope: "server/types",
    });
  } finally {
    await closeRuntime(runtime, store);
  }
}

async function exactV0716PausedPhase(
  sourceRoot,
  baselineRoot,
  testRoot,
  dataDirectory,
  seeded,
  pausedSnapshot,
  baseline,
) {
  const databasePath = databasePathFor(dataDirectory);
  const beforeDatabase = openRawDatabase(dataDirectory);
  const before = readSnapshot(beforeDatabase, seeded.taskIds);
  const beforeIdentity = databaseIdentity(databasePath);
  beforeDatabase.close();
  if (before.digest !== pausedSnapshot.digest || before.safety.global_enabled !== 0) {
    fail("exact v0.7.16 phase did not start from the paused V4 snapshot");
  }
  const markerBefore = readOriginalOnlyMarker(before, seeded.originalOnlyId);
  const runtime = await createRuntime(sourceRoot, baselineRoot, testRoot);
  let store;
  try {
    // Exercise the historical startup default. This deliberately omits
    // recoverRunning:false; no running fixture is present, so a correct old
    // startup must leave every persisted row untouched.
    store = runtime.storeModule.createGenerationTaskStore(dataDirectory);
    const markerTask = store.get(seeded.originalOnlyId);
    if (!markerTask || markerTask.state !== "recovering" ||
        markerTask.providerTaskId !== "recovery-original-provider-0001") {
      fail("exact v0.7.16 startup did not retain the original-only task");
    }
    let unknownAdmissionError;
    try {
      store.admitOrGet({
        ...taskInput(
          "text",
          "recovery-unknown-node",
          // Keep the semantic request identical while changing only the
          // idempotency key. The exact v0.7.16 guard protects an unresolved
          // same-intent retry before it reaches the global pause check.
          "unknown fixture",
          "recovery-exact-v0716-unknown-0001",
        ),
      });
    } catch (error) {
      unknownAdmissionError = error;
    }
    if (!unknownAdmissionError || unknownAdmissionError.code !== "RETRY_OUTCOME_UNKNOWN") {
      fail(`exact v0.7.16 unknown attempt was not protected: ${unknownAdmissionError?.code ?? "none"}`);
    }
    let newAdmissionError;
    try {
      store.admitOrGet(taskInput(
        "text",
        "recovery-exact-v0716-new-node",
        "new task while exact v0.7.16 generation is paused",
        "recovery-exact-v0716-new-0001",
      ));
    } catch (error) {
      newAdmissionError = error;
    }
    if (!newAdmissionError || newAdmissionError.code !== "GLOBAL_DISABLED") {
      fail(`exact v0.7.16 new admission was not rejected: ${newAdmissionError?.code ?? "none"}`);
    }
    store.close();
    store = undefined;
    const afterDatabase = openRawDatabase(dataDirectory);
    const after = readSnapshot(afterDatabase, seeded.taskIds);
    afterDatabase.close();
    const markerAfter = readOriginalOnlyMarker(after, seeded.originalOnlyId);
    const beforeSuccess = before.tasks.find((task) => task.id === seeded.successId);
    const afterSuccess = after.tasks.find((task) => task.id === seeded.successId);
    const resultBefore = JSON.stringify({
      result_asset_id: beforeSuccess?.result_asset_id,
      result_text: beforeSuccess?.result_text,
    });
    const resultAfter = JSON.stringify({
      result_asset_id: afterSuccess?.result_asset_id,
      result_text: afterSuccess?.result_text,
    });
    const originalOnlyTaskBefore = before.tasks.find((task) => task.id === seeded.originalOnlyId);
    const originalOnlyTaskAfter = after.tasks.find((task) => task.id === seeded.originalOnlyId);
    const originalOnlyAttemptsBefore = before.attempts.filter((attempt) =>
      attempt.task_id === seeded.originalOnlyId,
    );
    const originalOnlyAttemptsAfter = after.attempts.filter((attempt) =>
      attempt.task_id === seeded.originalOnlyId,
    );
    const originalOnlyEventsBefore = before.events.filter((event) =>
      event.task_id === seeded.originalOnlyId,
    );
    const originalOnlyEventsAfter = after.events.filter((event) =>
      event.task_id === seeded.originalOnlyId,
    );
    if (after.digest !== before.digest) {
      fail("exact v0.7.16 paused phase changed the shared SQLite ledger");
    }
    if (beforeIdentity !== databaseIdentity(databasePath)) {
      fail("exact v0.7.16 paused phase changed the shared SQLite inode");
    }
    if (JSON.stringify(markerAfter) !== JSON.stringify(markerBefore)) {
      fail("exact v0.7.16 paused phase changed the original-only marker");
    }
    return Object.freeze({
      admissionCode: newAdmissionError.code,
      admissionRejected: true,
      attemptLedgerPreserved: JSON.stringify(after.attempts) === JSON.stringify(before.attempts),
      canvasPreserved: JSON.stringify(after.canvas) === JSON.stringify(before.canvas),
      databaseWrites: 0,
      eventLedgerPreserved: JSON.stringify(after.events) === JSON.stringify(before.events),
      generationPaused: after.safety.global_enabled === 0,
      globalGenerationEnabled: after.safety.global_enabled === 1,
      originalOnlyMarkerPreserved: true,
      originalOnlyTaskPreserved: JSON.stringify(originalOnlyTaskAfter) ===
        JSON.stringify(originalOnlyTaskBefore),
      originalOnlyAttemptPreserved: JSON.stringify(originalOnlyAttemptsAfter) ===
        JSON.stringify(originalOnlyAttemptsBefore),
      originalOnlyEventPreserved: JSON.stringify(originalOnlyEventsAfter) ===
        JSON.stringify(originalOnlyEventsBefore),
      providerPostCount: 0,
      providerPostCountEvidence: "not-exercised-store-layer",
      providerExecutionExercised: false,
      resultPreserved: resultAfter === resultBefore,
      runtimeStartupMode: "default-recoverRunning",
      runtimeScope: "server/types",
      storeDefaultRecoveryExercised: true,
      fullApplicationStartupExercised: false,
      unknownAdmissionAttempts: 1,
      unknownAdmissionCode: unknownAdmissionError.code,
      unknownAdmissionRejected: true,
      taskLedgerPreserved: JSON.stringify(after.tasks) === JSON.stringify(before.tasks),
      baseline: Object.freeze({
        contract: baseline.contract,
        fileCount: baseline.fileCount,
        filesVerified: baseline.fileCount,
        head: baseline.head,
        manifestDigest: baseline.manifestDigest,
        tree: baseline.tree,
      }),
    });
  } finally {
    await closeRuntime(runtime, store);
  }
}

async function restoredCandidatePhase(
  sourceRoot,
  testRoot,
  dataDirectory,
  seeded,
  pausedSnapshot,
) {
  const control = new DatabaseSync(databasePathFor(dataDirectory), { timeout: 5_000 });
  setSafety(control, true);
  control.close();
  const runtime = await createRuntime(sourceRoot, sourceRoot, testRoot);
  let store;
  let recoveryStore;
  try {
    store = runtime.storeModule.createGenerationTaskStore(dataDirectory, {
      recoverRunning: false,
    });
    const originalOnlyBefore = pausedSnapshot.tasks.find((task) =>
      task.id === seeded.originalOnlyId,
    );
    const originalOnlyEventsBefore = pausedSnapshot.events.filter((event) =>
      event.task_id === seeded.originalOnlyId,
    );
    const originalOnlyAttemptsBefore = pausedSnapshot.attempts.filter((attempt) =>
      attempt.task_id === seeded.originalOnlyId,
    );
    if (!store.hasOriginalRecoveryOnly(seeded.originalOnlyId)) {
      fail("V4 restore lost the original-only marker");
    }
    let originalOnlyResumeError;
    try {
      store.resume(seeded.originalOnlyId);
    } catch (error) {
      originalOnlyResumeError = error;
    }
    if (!originalOnlyResumeError || !/Original-only/.test(String(originalOnlyResumeError.message))) {
      fail("V4 restore allowed original-only recovery into generic execution");
    }
    const originalOnlyTask = store.get(seeded.originalOnlyId);
    if (!originalOnlyTask || store.claimRecovering(
      seeded.originalOnlyId,
      originalOnlyTask.updatedAt,
    ) !== undefined) {
      fail("V4 restore allowed the original-only task to claim a generic recovery slot");
    }
    let unknownError;
    try {
      store.admitOrGet({
        ...taskInput(
          "text",
          "recovery-unknown-node",
          "changed fingerprint after V4 restore",
          "recovery-restored-unknown-0001",
        ),
      });
    } catch (error) {
      unknownError = error;
    }
    if (!unknownError || unknownError.code !== "RETRY_OUTCOME_UNKNOWN") {
      fail(`restored unknown task was not blocked: ${unknownError?.code ?? "none"}`);
    }
    const unknownTask = store.get(seeded.unknownId);
    const unknownAttempt = store.getProviderAttemptForTask(seeded.unknownId);
    if (
      !unknownTask || unknownTask.state !== "failed" ||
      unknownTask.errorCode !== "OUTCOME_UNKNOWN_BILLING_RISK" ||
      unknownAttempt?.outcome !== "outcome-unknown"
    ) fail("restored unknown Provider evidence changed");
    const compensation = store.automaticReplacementTask(seeded.refundParentId);
    const candidates = store.listRefundCompensationCandidates();
    if (
      !compensation || compensation.id !== seeded.childId ||
      candidates.some((task) => task.id === seeded.refundParentId)
    ) fail("one-time compensation budget was reopened after restore");
    assertRecoveryCaseEventHistory(store, seeded);
    const recoveryModule = await runtime.load(join(sourceRoot, "server/generationRecoveryCaseStore.ts"));
    recoveryStore = recoveryModule.openGenerationRecoveryCaseStore(dataDirectory, {
      enabled: true,
    });
    assertRecoveryCaseStoreView(recoveryStore, seeded);
    const ownerSurfaceNoEventJson = assertNoEventJsonInOwnerSurface(store);
    store.close();
    store = undefined;
    recoveryStore.closeDatabase();
    recoveryStore = undefined;
    const database = openRawDatabase(dataDirectory);
    const after = readSnapshot(database, seeded.taskIds);
    database.close();
    const originalOnlyAfter = after.tasks.find((task) => task.id === seeded.originalOnlyId);
    const originalOnlyEventsAfter = after.events.filter((event) =>
      event.task_id === seeded.originalOnlyId,
    );
    const originalOnlyAttemptsAfter = after.attempts.filter((attempt) =>
      attempt.task_id === seeded.originalOnlyId,
    );
    const originalOnlyMarkerAfter = readOriginalOnlyMarker(after, seeded.originalOnlyId);
    if (
      JSON.stringify(originalOnlyAfter) !== JSON.stringify(originalOnlyBefore) ||
      JSON.stringify(originalOnlyEventsAfter) !== JSON.stringify(originalOnlyEventsBefore) ||
      JSON.stringify(originalOnlyAttemptsAfter) !== JSON.stringify(originalOnlyAttemptsBefore) ||
      JSON.stringify(originalOnlyMarkerAfter) !== JSON.stringify(
        readOriginalOnlyMarker(pausedSnapshot, seeded.originalOnlyId),
      )
    ) fail("V4 restore changed the original-only task, attempt, or marker");
    const beforeSuccess = pausedSnapshot.tasks.find((task) => task.id === seeded.successId);
    const afterSuccess = after.tasks.find((task) => task.id === seeded.successId);
    const resultDigest = digest({
      resultAssetId: afterSuccess?.result_asset_id,
      resultText: afterSuccess?.result_text,
    });
    const expectedResultDigest = digest({
      resultAssetId: beforeSuccess?.result_asset_id,
      resultText: beforeSuccess?.result_text,
    });
    const canvasDigest = digest(after.canvas);
    const expectedCanvasDigest = digest(pausedSnapshot.canvas);
    return Object.freeze({
      canvasDigest,
      canvasPreserved: canvasDigest === expectedCanvasDigest,
      caseRowsPreserved: digest(after.events) === digest(pausedSnapshot.events),
      compensationBudgetPreserved: compensation.id === seeded.childId &&
        !candidates.some((task) => task.id === seeded.refundParentId),
      globalGenerationEnabled: after.safety.global_enabled === 1,
      ledgerPreserved: after.ledgerDigest === pausedSnapshot.ledgerDigest,
      maintenanceControl: "fixture-only-control",
      maintenanceMode: "events-retained",
      malformedEventPreserved: after.events.at(-1)?.error_message ===
        pausedSnapshot.events.at(-1)?.error_message,
      ownerSurfaceNoEventJson,
      originalOnlyGenericResumeBlocked: true,
      originalOnlyMarkerPreserved: true,
      originalOnlySweepClaimBlocked: true,
      originalOnlyTaskPreserved: true,
      providerPostCount: 0,
      readStatePreserved: digest(after.events) === digest(pausedSnapshot.events),
      resultDigest,
      resultPreserved: resultDigest === expectedResultDigest,
      unknownAdmissionRejected: true,
      unknownBlockCode: unknownError.code,
      unknownProtectionPreserved: true,
    });
  } finally {
    recoveryStore?.closeDatabase();
    await closeRuntime(runtime, store);
  }
}

function readBaselineManifest(testRoot, baselineRoot, manifestPath) {
  const manifestFile = assertPrivatePath(manifestPath, testRoot, "baseline manifest");
  const stagedRoot = assertPrivatePath(baselineRoot, testRoot, "baseline root");
  const rootDetails = lstatSync(stagedRoot);
  const manifestDetails = lstatSync(manifestFile);
  if (
    !rootDetails.isDirectory() || rootDetails.isSymbolicLink() ||
    (rootDetails.mode & 0o777) !== 0o500 ||
    !manifestDetails.isFile() || manifestDetails.isSymbolicLink() ||
    manifestDetails.nlink !== 1 || (manifestDetails.mode & 0o777) !== 0o400
  ) fail("staged V3 baseline is not private and immutable");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch (error) {
    fail(`staged V3 baseline manifest is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const files = manifest?.runtimeFiles && typeof manifest.runtimeFiles === "object" &&
    !Array.isArray(manifest.runtimeFiles)
    ? Object.keys(manifest.runtimeFiles).sort()
    : [];
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.contract !== BASELINE_CONTRACT ||
    manifest?.branch !== BASELINE_BRANCH ||
    manifest?.head !== BASELINE_HEAD ||
    manifest?.fileCount !== BASELINE_FILE_COUNT ||
    manifest?.runtimeFileCount !== BASELINE_RUNTIME_FILE_COUNT ||
    files.length !== BASELINE_RUNTIME_FILE_COUNT ||
    JSON.stringify(manifest?.runtimeScope) !== JSON.stringify(["server", "types"]) ||
    manifest?.candidateHead !== env.UNBOUNDRY_SOURCE_HEAD ||
    typeof manifest?.candidateSourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.candidateSourceSha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.fullManifestDigest)
  ) fail("staged V3 baseline manifest does not match the accepted 572-file fixture");
  for (const file of files) {
    if (
      !/^(?:server|types)\/[^/]+(?:\/[^/]+)*$/.test(file) ||
      PROTECTED_PATHS.has(file) ||
      file.split("/").some((part) => part === "" || part === "." || part === "..") ||
      !/^[a-f0-9]{64}$/.test(manifest.runtimeFiles[file])
    ) fail(`unsafe V3 runtime manifest entry: ${file}`);
    const absolute = join(stagedRoot, file);
    if (!isInside(stagedRoot, absolute) || !existsSync(absolute)) {
      fail(`V3 runtime file is missing: ${file}`);
    }
    const details = lstatSync(absolute);
    if (
      !details.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
      (details.mode & 0o777) !== 0o400 || sha256(readFileSync(absolute)) !== manifest.runtimeFiles[file]
    ) fail(`V3 runtime file is not immutable or hash-matched: ${file}`);
  }
  return Object.freeze({
    aggregateSha256: manifest.aggregateSha256,
    branch: manifest.branch,
    candidateHead: manifest.candidateHead,
    candidateSourceSha256: manifest.candidateSourceSha256,
    fileCount: manifest.fileCount,
    head: manifest.head,
    runtimeFileCount: manifest.runtimeFileCount,
    manifestDigest: manifest.fullManifestDigest,
    root: stagedRoot,
  });
}

function readExactV0716BaselineManifest(testRoot, baselineRoot, manifestPath) {
  const manifestFile = assertPrivatePath(manifestPath, testRoot, "exact v0.7.16 baseline manifest");
  const stagedRoot = assertPrivatePath(baselineRoot, testRoot, "exact v0.7.16 baseline root");
  const rootDetails = lstatSync(stagedRoot);
  const manifestDetails = lstatSync(manifestFile);
  if (
    !rootDetails.isDirectory() || rootDetails.isSymbolicLink() ||
    (rootDetails.mode & 0o777) !== 0o500 ||
    !manifestDetails.isFile() || manifestDetails.isSymbolicLink() ||
    manifestDetails.nlink !== 1 || (manifestDetails.mode & 0o777) !== 0o400
  ) fail("exact v0.7.16 baseline is not private and immutable");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch (error) {
    fail(`exact v0.7.16 baseline manifest is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const files = manifest?.files && typeof manifest.files === "object" &&
    !Array.isArray(manifest.files)
    ? Object.keys(manifest.files).sort()
    : [];
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.contract !== EXACT_V0716_BASELINE_CONTRACT ||
    manifest?.head !== EXACT_V0716_BASELINE_HEAD ||
    manifest?.tree !== EXACT_V0716_BASELINE_TREE ||
    JSON.stringify(manifest?.scope) !== JSON.stringify(["server", "types"]) ||
    manifest?.fileCount !== EXACT_V0716_BASELINE_FILE_COUNT ||
    files.length !== EXACT_V0716_BASELINE_FILE_COUNT ||
    manifest?.candidateHead !== env.UNBOUNDRY_SOURCE_HEAD ||
    typeof manifest?.candidateSourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.candidateSourceSha256) ||
    files.some((file) =>
      !/^(?:server|types)\/[^/]+(?:\/[^/]+)*$/.test(file) ||
      file.split("/").some((part) => part === "" || part === "." || part === "..") ||
      PROTECTED_PATHS.has(file) ||
      !/^[a-f0-9]{64}$/.test(manifest.files[file])
    )
  ) fail("exact v0.7.16 baseline manifest is not the frozen 192-file scope");
  for (const file of files) {
    const absolute = join(stagedRoot, file);
    if (!isInside(stagedRoot, absolute) || !existsSync(absolute)) {
      fail(`exact v0.7.16 baseline file is missing: ${file}`);
    }
    const details = lstatSync(absolute);
    if (
      !details.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
      (details.mode & 0o777) !== 0o400 ||
      sha256(readFileSync(absolute)) !== manifest.files[file]
    ) fail(`exact v0.7.16 baseline file is not immutable or hash-matched: ${file}`);
  }
  return Object.freeze({
    candidateHead: manifest.candidateHead,
    candidateSourceSha256: manifest.candidateSourceSha256,
    contract: manifest.contract,
    fileCount: manifest.fileCount,
    files: Object.freeze(manifest.files),
    head: manifest.head,
    manifestDigest: digest(manifest.files),
    root: stagedRoot,
    tree: manifest.tree,
  });
}

async function main() {
  if (
    env.UNBOUNDRY_SAFE_TEST !== "1" ||
    env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ROLLBACK !== "1"
  ) fail("this spec only runs through the fixed safe-runner recovery-rehearsal entrypoint");
  const systemTemporaryRoot = assertPrivatePath(
    requireEnvironment("UNBOUNDRY_SYSTEM_TEMPORARY_ROOT"),
    requireEnvironment("UNBOUNDRY_SYSTEM_TEMPORARY_ROOT"),
    "system temporary root",
  );
  const testRoot = assertPrivatePath(
    requireEnvironment("UNBOUNDRY_TEST_ROOT"),
    systemTemporaryRoot,
    "test root",
  );
  const sourceRoot = assertPrivatePath(
    requireEnvironment("UNBOUNDRY_TEST_REPOSITORY_ROOT"),
    systemTemporaryRoot,
    "candidate source root",
  );
  const baselineRoot = assertPrivatePath(
    requireEnvironment("UNBOUNDRY_GENERATION_RECOVERY_CASES_BASELINE_ROOT"),
    testRoot,
    "accepted V3 baseline root",
  );
  const manifestPath = requireEnvironment(
    "UNBOUNDRY_GENERATION_RECOVERY_CASES_BASELINE_MANIFEST",
  );
  const exactV0716BaselineRoot = assertPrivatePath(
    requireEnvironment("UNBOUNDRY_GENERATION_RECOVERY_CASES_EXACT_BASELINE_ROOT"),
    testRoot,
    "exact v0.7.16 baseline root",
  );
  const exactV0716BaselineManifestPath = requireEnvironment(
    "UNBOUNDRY_GENERATION_RECOVERY_CASES_EXACT_BASELINE_MANIFEST",
  );
  const dataDirectory = assertPrivatePath(
    requireEnvironment("UNBOUNDRY_DATA_DIR"),
    testRoot,
    "synthetic data directory",
  );
  const evidencePath = resolve(requireEnvironment(
    "UNBOUNDRY_GENERATION_RECOVERY_CASES_ROLLBACK_EVIDENCE",
  ));
  if (evidencePath !== join(testRoot, EVIDENCE_FILE)) {
    fail("recovery rehearsal evidence path is not fixed under the test root");
  }
  if (env.UNBOUNDRY_TEST_SPEC !== join(sourceRoot, "tests/generation-recovery-cases-rollback.spec.mjs")) {
    fail("spec was not invoked through the fixed runner path");
  }
  const baseline = readBaselineManifest(testRoot, baselineRoot, manifestPath);
  if (baseline.root !== baselineRoot) fail("baseline root identity changed during validation");
  if (env.UNBOUNDRY_SOURCE_HEAD !== baseline.candidateHead) {
    fail("candidate source HEAD does not match the staged accepted V3 manifest");
  }
  const exactV0716Baseline = readExactV0716BaselineManifest(
    testRoot,
    exactV0716BaselineRoot,
    exactV0716BaselineManifestPath,
  );
  if (exactV0716Baseline.root !== exactV0716BaselineRoot) {
    fail("exact v0.7.16 baseline root identity changed during validation");
  }
  const databasePath = databasePathFor(dataDirectory);
  const seeded = await seedCandidate(sourceRoot, testRoot, dataDirectory);
  const seededDatabase = openRawDatabase(dataDirectory);
  const seededSnapshot = readSnapshot(seededDatabase, seeded.taskIds);
  if (seededSnapshot.safety.global_enabled !== 1) {
    seededDatabase.close();
    fail("V4 seed did not begin with generation enabled");
  }
  const databaseLogicalInspectionRuntime = await createRuntime(sourceRoot, sourceRoot, testRoot);
  let inspectionModule;
  try {
    inspectionModule = await databaseLogicalInspectionRuntime.load(join(sourceRoot, "server/backupInspection.ts"));
  } finally {
    await databaseLogicalInspectionRuntime.server.close();
  }
  seededDatabase.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  seededDatabase.close();
  const seededInspection = inspectionModule.inspectBackupDatabase(databasePath, dataDirectory);
  const databaseIdentityBefore = databaseIdentity(databasePath);
  const sourceSnapshot = Object.freeze({
    ...seededSnapshot,
    databaseLogicalSha256: seededInspection.logicalSha256,
  });
  const backup = await backupAndRestore(sourceRoot, testRoot, dataDirectory, seeded, sourceSnapshot);
  const pauseDatabase = openRawDatabase(dataDirectory);
  setSafety(pauseDatabase, false);
  const pausedSnapshot = readSnapshot(pauseDatabase, seeded.taskIds);
  pauseDatabase.close();
  const oldPaused = await oldPausedPhase(
    sourceRoot,
    baselineRoot,
    testRoot,
    dataDirectory,
    seeded,
    pausedSnapshot,
  );
  const exactV0716Paused = await exactV0716PausedPhase(
    sourceRoot,
    exactV0716BaselineRoot,
    testRoot,
    dataDirectory,
    seeded,
    pausedSnapshot,
    exactV0716Baseline,
  );
  const restored = await restoredCandidatePhase(
    sourceRoot,
    testRoot,
    dataDirectory,
    seeded,
    pausedSnapshot,
  );
  const finalDatabase = openRawDatabase(dataDirectory);
  const finalSnapshot = readSnapshot(finalDatabase, seeded.taskIds);
  finalDatabase.close();
  if (databaseIdentity(databasePath) !== databaseIdentityBefore) {
    fail("V4-V3-V4 phases did not use one SQLite inode");
  }
  if (finalSnapshot.safety.global_enabled !== 1) {
    fail("V4 restore did not leave generation enabled in the synthetic DB");
  }
  const evidence = {
    baseline: {
      aggregateSha256: baseline.aggregateSha256,
      branch: baseline.branch,
      fileCount: baseline.fileCount,
      filesVerified: BASELINE_FILE_COUNT,
      head: baseline.head,
      manifestDigest: baseline.manifestDigest,
      runtimeFileCount: baseline.runtimeFileCount,
    },
    candidateHead: baseline.candidateHead,
    candidateSourceSha256: baseline.candidateSourceSha256,
    contract: CONTRACT,
    coverageBoundaries: {
      caseEventsSeededDirectly: true,
      eventRepositoryApiExercised: true,
      exactV0716ServerTypesExercised: true,
      exactV0716FullApplicationStartupExercised: false,
      exactV0716ProviderExecutionExercised: false,
      exactV0716StoreDefaultRecoveryExercised: true,
      maintenanceHttpExercised: false,
      realProviderPosts: 0,
      userMaintenanceApiExercised: false,
    },
    database: {
      absolutePathExposed: false,
      identityVerified: true,
      pathFingerprint: sha256(Buffer.from(databaseIdentityBefore, "utf8")),
      relativePath: "data/unboundry.sqlite",
    },
    phaseIsolation: {
      baselineModuleScope: "server/types",
      baselineRuntime: "accepted-dirty-v3-server-types-only",
      candidateRuntime: "workspace-server-types",
      maintenanceApiExercised: false,
      moduleGraphsIsolated: true,
      sameDatabasePath: true,
    },
    realProductionDataAccessed: false,
    realProviderPosts: 0,
    sameDatabase: true,
    status: "pass",
    syntheticOnly: true,
    testCount: 1,
    exactV0716Paused,
    v3Paused: oldPaused,
    v4Restored: {
      ...restored,
      databaseWritesDuringRestore: 1,
    },
    v4Seeded: {
      caseRowsSeeded: seededSnapshot.events.length,
      generationPaused: false,
      maintenanceControl: "fixture-only-control",
      maintenanceMode: "events-retained",
      resultDigest: digest({
        resultAssetId: seededSnapshot.tasks.find((task) => task.id === seeded.successId)?.result_asset_id,
        resultText: seededSnapshot.tasks.find((task) => task.id === seeded.successId)?.result_text,
      }),
    },
    backup,
    phaseOrder: [
      "v4-seeded",
      "backup-verified",
      "v3-paused",
      "v0.7.16-exact-server-types-paused",
      "v4-restored",
    ],
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: "wx",
    mode: 0o400,
  });
  console.log(JSON.stringify({
    contract: CONTRACT,
    phases: evidence.phaseOrder,
    providerPosts: 0,
    status: "pass",
    testCount: 1,
  }));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
