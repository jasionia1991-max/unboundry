import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createServer } from "vite";

const BASELINE_HEAD = "d7897a5e6bdd836d3d1685a0a1bbb7760373b20f";
const BASELINE_TREE = "3914f3219eb763dea37253077a5dccf1477998fe";
const BASELINE_FILE_COUNT = 192;
const BASELINE_CONTRACT = "unboundry-generation-server-types-baseline-v1";
const REHEARSAL_CONTRACT =
  "unboundry-generation-server-rollback-rehearsal-v1";
const EVIDENCE_FILE = "generation-server-rollback-rehearsal.json";
const OWNER_ID = "__test__";
const CANVAS_ID = "rollback-rehearsal-canvas";
const FIXTURE_SCOPE = "generation-server-rollback-v1";
const REFUND_MODEL_ID = "rollback-image-model";
const REFUND_PROVIDER_PROFILE_ID = "rollback-provider-profile";
const REFUND_PROVIDER_MODEL_ID = "openai/gpt-image-2";
const GENERATED_RESULT = "same-sqlite-result-survives-old-version";
const PROTECTED_PATHS = new Set([
  "spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json",
  "spec/public-templates-director-split-revision.json",
]);

const env = process.env;

function fail(message) {
  throw new Error(`[generation-server-rollback] ${message}`);
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
  if ([...PROTECTED_PATHS].some((protectedPath) => resolved.endsWith(`/${protectedPath}`))) {
    fail(`${label} points at a protected workspace path`);
  }
  return resolved;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function digest(value) {
  return sha256(Buffer.from(JSON.stringify(stableValue(value)), "utf8"));
}

function assertHex(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    fail(`${label} is not a SHA-256 digest`);
  }
}

function readBaselineManifest(testRoot, baselineRoot, manifestPath) {
  const manifestFile = assertPrivatePath(manifestPath, testRoot, "baseline manifest");
  const stagedRoot = assertPrivatePath(baselineRoot, testRoot, "baseline root");
  const rootDetails = lstatSync(stagedRoot);
  if (
    !rootDetails.isDirectory() || rootDetails.isSymbolicLink() ||
    (rootDetails.mode & 0o777) !== 0o500
  ) fail("baseline root is not a private read-only directory");
  const manifestDetails = lstatSync(manifestFile);
  if (
    !manifestDetails.isFile() || manifestDetails.isSymbolicLink() ||
    manifestDetails.nlink !== 1 || (manifestDetails.mode & 0o777) !== 0o400
  ) fail("baseline manifest is not a private immutable file");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch (error) {
    fail(`baseline manifest JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const files = manifest?.files && typeof manifest.files === "object" &&
    !Array.isArray(manifest.files)
    ? Object.keys(manifest.files).sort()
    : [];
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.contract !== BASELINE_CONTRACT ||
    manifest?.head !== BASELINE_HEAD ||
    manifest?.tree !== BASELINE_TREE ||
    JSON.stringify(manifest?.scope) !== JSON.stringify(["server", "types"]) ||
    manifest?.fileCount !== BASELINE_FILE_COUNT ||
    files.length !== BASELINE_FILE_COUNT ||
    files.some((file) =>
      !/^(?:server|types)\/[^/]+(?:\/[^/]+)*$/.test(file) ||
      file.split("/").some((part) => part === "" || part === "." || part === "..") ||
      PROTECTED_PATHS.has(file)
    )
  ) fail("baseline manifest does not match the frozen 192-file server/types scope");
  if (
    manifest?.candidateHead !== env.UNBOUNDRY_SOURCE_HEAD ||
    typeof manifest?.candidateSourceSha256 !== "string"
  ) fail("baseline manifest is not bound to the candidate snapshot");
  assertHex(manifest.candidateSourceSha256, "candidate source");

  for (const file of files) {
    const expected = manifest.files[file];
    assertHex(expected, `baseline ${file}`);
    const absolute = join(stagedRoot, file);
    if (!isInside(stagedRoot, absolute) || !existsSync(absolute)) {
      fail(`baseline file is missing or escaped: ${file}`);
    }
    const details = lstatSync(absolute);
    if (
      !details.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
      (details.mode & 0o777) !== 0o400
    ) fail(`baseline file is not immutable: ${file}`);
    if (sha256(readFileSync(absolute)) !== expected) {
      fail(`baseline file hash mismatch: ${file}`);
    }
  }
  return Object.freeze({
    candidateHead: manifest.candidateHead,
    candidateSourceSha256: manifest.candidateSourceSha256,
    fileCount: manifest.fileCount,
    files: Object.freeze(manifest.files),
    head: manifest.head,
    manifestDigest: digest(manifest.files),
    manifestPath: manifestFile,
    root: stagedRoot,
    tree: manifest.tree,
  });
}

function assertSafeDatabaseDirectory(dataDirectory, testRoot) {
  const resolved = assertPrivatePath(dataDirectory, testRoot, "synthetic data directory");
  const details = lstatSync(resolved);
  if (
    !details.isDirectory() || details.isSymbolicLink() ||
    (details.mode & 0o777) !== 0o700
  ) fail("synthetic data directory is not private");
  return resolved;
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
  const rows = database.prepare(
    `SELECT ${columns} FROM ${table} ${where}`,
  ).all(...parameters);
  return rows.map((row) => stableValue(row));
}

function readSnapshot(database, taskIds) {
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
  const canvas = database.prepare(`
    SELECT owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_session_id, save_sequence
    FROM canvas_documents WHERE owner_id = ? AND id = ?
  `).get(OWNER_ID, CANVAS_ID);
  const safety = database.prepare(`
    SELECT id, global_enabled, emergency_stop, per_user_concurrency,
      requests_per_minute, text_concurrency, image_concurrency,
      video_concurrency, audio_concurrency, failure_threshold,
      cooldown_minutes, running_task_policy, updated_at
    FROM generation_safety_settings WHERE id = 1
  `).get();
  const counts = Object.fromEntries([
    ["tasks", "generation_tasks"],
    ["events", "generation_task_events"],
    ["attempts", "generation_provider_attempts"],
    ["admissions", "generation_admission_events"],
  ].map(([key, table]) => [
    key,
    Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
  ]));
  return Object.freeze({
    admissionEvents,
    attempts,
    canvas: stableValue(canvas),
    counts,
    digest: digest({ admissionEvents, attempts, canvas, events, safety, tasks }),
    events,
    safety: stableValue(safety),
    tasks,
  });
}

function setSafety(database, globalEnabled) {
  database.prepare(`
    UPDATE generation_safety_settings
    SET global_enabled = ?, emergency_stop = 0,
      per_user_concurrency = 20, requests_per_minute = 120,
      text_concurrency = 20, image_concurrency = 20,
      video_concurrency = 20, audio_concurrency = 20,
      failure_threshold = 3, cooldown_minutes = 30,
      running_task_policy = 'wait', updated_at = ?
    WHERE id = 1
  `).run(Number(globalEnabled), new Date().toISOString());
}

function insertEvent(database, taskId, state, errorCode, errorMessage = null) {
  database.prepare(`
    INSERT INTO generation_task_events
      (task_id, state, error_code, error_message, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(taskId, state, errorCode, errorMessage, new Date().toISOString());
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

async function authoritativeRefundInput(runtime, dataDirectory) {
  const [bootstrapModule, configurationModule, configurationIdentityModule,
    executionModule, modelParametersModule, releaseStoreModule] = await Promise.all([
    runtime.load(join(runtime.importedRoot, "server/modelReleaseBootstrap.ts")),
    runtime.load(join(runtime.importedRoot, "server/authoritativeGenerationModelConfiguration.ts")),
    runtime.load(join(runtime.importedRoot, "server/modelConfigurationIdentity.ts")),
    runtime.load(join(runtime.importedRoot, "server/modelExecutionRegistry.ts")),
    runtime.load(join(runtime.importedRoot, "types/modelParameters.ts")),
    runtime.load(join(runtime.importedRoot, "server/modelReleaseRevisionStore.ts")),
  ]);
  const database = runtime.databaseModule.openAppDatabase(dataDirectory);
  const timestamp = "2026-08-11T08:00:00.000Z";
  try {
    database.prepare(`
      INSERT OR IGNORE INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, 'Rollback rehearsal fixture', 'safe-fixture', 'user', 'active', ?, ?)
    `).run(OWNER_ID, OWNER_ID, timestamp, timestamp);
    database.prepare(`
      INSERT OR IGNORE INTO provider_profiles (
        id, display_name, driver, status, provider_configuration_version,
        created_at, updated_at
      ) VALUES (?, 'Rollback rehearsal provider', 'openrouter', 'enabled', 1, ?, ?)
    `).run(REFUND_PROVIDER_PROFILE_ID, timestamp, timestamp);
    const parameterSchema = modelParametersModule.knownModelParameterSchema({
      capability: "image",
      providerDriver: "openrouter",
      providerModelId: REFUND_PROVIDER_MODEL_ID,
    });
    database.prepare(`
      INSERT OR IGNORE INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency
      ) VALUES (?, 'Rollback rehearsal image', ?, ?, 'image', 'published', ?, ?, ?, 1000000, 'USD')
    `).run(
      REFUND_MODEL_ID,
      REFUND_PROVIDER_PROFILE_ID,
      REFUND_PROVIDER_MODEL_ID,
      JSON.stringify(parameterSchema),
      timestamp,
      timestamp,
    );
    database.prepare(`
      INSERT OR IGNORE INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      ) VALUES ('image', ?, 1, 1, 1, ?, ?)
    `).run(REFUND_MODEL_ID, timestamp, timestamp);
    setSafety(database, true);
    bootstrapModule.bootstrapPublishedModelContracts(database, OWNER_ID);
    const release = releaseStoreModule.modelContractState(database, REFUND_MODEL_ID).active;
    if (!release) fail("authoritative fixture model release was not published");
    const modelConfigurationRevision = configurationIdentityModule.authoritativeModelConfigurationRevision({
      capability: "image",
      id: REFUND_MODEL_ID,
      modelConfigurationUpdatedAt: timestamp,
      parameterSchema: release.document.capabilitySchema,
      providerDriver: "openrouter",
      providerModelId: REFUND_PROVIDER_MODEL_ID,
    });
    const execution = executionModule.assertRegisteredModelExecutionTotality({
      capability: "image",
      capabilitySchema: release.document.capabilitySchema,
      providerDriver: "openrouter",
      providerModelId: REFUND_PROVIDER_MODEL_ID,
      providerProtocol: "native",
      revisionIdentity: release.revisionId,
    });
    const generationInputKey = "rollback-image-input:rollback-refund-node";
    const generationOwnershipKey = "rollback-canvas:rollback-refund-node";
    const modelInputContractFingerprint = "mic2:rollback-image-contract";
    const modelConfiguration = configurationModule.buildAuthoritativeGenerationModelConfiguration({
      credentialVersion: 1,
      fixtureScopeId: FIXTURE_SCOPE,
      generationInputKey,
      generationOwnershipKey,
      modelCapability: "image",
      modelConfigurationRevision,
      modelExecutionAdapterId: execution.adapterId,
      modelId: REFUND_MODEL_ID,
      modelInputContractFingerprint,
      modelReleaseRevision: release,
      modelResultCount: execution.resultCount,
      parameterSchema: release.document.capabilitySchema,
      providerConfigurationVersion: 1,
      providerDriver: "openrouter",
      providerModelId: REFUND_PROVIDER_MODEL_ID,
      providerProfileId: REFUND_PROVIDER_PROFILE_ID,
      providerProtocol: "native",
    });
    return Object.freeze({
      canvasId: CANVAS_ID,
      credentialRevision: 1,
      idempotencyKey: "rollback-refund-parent-0001",
      kind: "image",
      model: REFUND_MODEL_ID,
      modelConfiguration,
      nodeId: "rollback-refund-node",
      ownerId: OWNER_ID,
      parameters: { count: 1, size: "1k" },
      prompt: "refunded fixture",
      providerModelId: REFUND_PROVIDER_MODEL_ID,
      providerProfileId: REFUND_PROVIDER_PROFILE_ID,
      requestIntent: {
        canvasId: CANVAS_ID,
        fixtureScopeId: FIXTURE_SCOPE,
        generationIdentityVersion: 2,
        generationInputKey,
        generationOwnershipKey,
        kind: "image",
        model: REFUND_MODEL_ID,
        modelConfigurationRevision,
        modelInputContractFingerprint,
        modelReleaseRevision: release.revisionId,
        nodeId: "rollback-refund-node",
        parameters: { count: 1, size: "1k" },
        prompt: "refunded fixture",
      },
    });
  } finally {
    database.close();
  }
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
  return settleProviderFailure(store, running, outcome, failureCode);
}

function createAuthoritativeProviderFailure(store, input, outcome, failureCode) {
  const admitted = store.admitAuthoritativeOrGet(input);
  if (!admitted.created || admitted.task.state !== "queued") {
    fail(`authoritative fixture task was not admitted: ${input.idempotencyKey}`);
  }
  const running = store.transition(admitted.task.id, "running");
  if (!running || running.state !== "running" || running.attempt !== 1) {
    fail(`authoritative fixture task did not enter running: ${admitted.task.id}`);
  }
  return settleProviderFailure(store, running, outcome, failureCode);
}

function settleProviderFailure(store, running, outcome, failureCode) {
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
    fail(`fixture task did not enter ${failureCode}: ${running.id}`);
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

function ensureSyntheticOwnerAndCanvas(database, timestamp) {
  database.prepare(`
    INSERT OR IGNORE INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'safe-fixture', 'user', 'active', ?, ?)
  `).run(OWNER_ID, OWNER_ID, "Rollback rehearsal fixture", timestamp, timestamp);
}

function insertCanvas(database, nodes, timestamp) {
  const edges = [{ id: "rollback-edge", source: "rollback-success-node", target: "rollback-unknown-node" }];
  const viewport = { x: 11, y: 17, zoom: 0.9 };
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_session_id, save_sequence
    ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, 'rollback-session', 1)
  `).run(
    OWNER_ID,
    CANVAS_ID,
    JSON.stringify(nodes),
    JSON.stringify(edges),
    JSON.stringify(viewport),
    timestamp,
  );
}

async function seedCandidate(sourceRoot, testRoot, dataDirectory) {
  const runtime = await createRuntime(sourceRoot, sourceRoot, testRoot);
  let store;
  try {
    const refundInput = await authoritativeRefundInput(runtime, dataDirectory);
    store = runtime.storeModule.createGenerationTaskStore(dataDirectory, {
      recoverRunning: false,
    });
    const successRunning = createRunning(store, taskInput(
      "text",
      "rollback-success-node",
      "successful fixture result",
      "rollback-success-0001",
    ));
    const success = store.complete(successRunning.id, {
      actualCostMicrounits: 0,
      resultText: GENERATED_RESULT,
    });
    if (!success || success.state !== "success" || success.resultText !== GENERATED_RESULT) {
      fail("candidate fixture success did not settle with its result");
    }
    const unknown = createProviderFailure(
      store,
      taskInput(
        "text",
        "rollback-unknown-node",
        "unknown fixture result",
        "rollback-unknown-0001",
      ),
      "outcome-unknown",
      "OUTCOME_UNKNOWN_BILLING_RISK",
    );
    const replaceParent = createProviderFailure(
      store,
      taskInput(
        "video",
        "rollback-replace-node",
        "known rejected fixture",
        "rollback-replace-parent-0001",
      ),
      "definitive-rejected",
      "PROVIDER_NOT_ACCEPTED_NO_CHARGE",
    );
    const refundParent = createAuthoritativeProviderFailure(
      store,
      refundInput,
      "provider-failed",
      "PROVIDER_REFUNDED",
    );
    store.close();
    store = undefined;

    const database = runtime.databaseModule.openAppDatabase(dataDirectory);
    const timestamp = new Date().toISOString();
    try {
      ensureSyntheticOwnerAndCanvas(database, timestamp);
      insertCanvas(database, [
        {
          data: {
            textGenerationTaskId: success.id,
            textGenerationResult: GENERATED_RESULT,
          },
          id: "rollback-success-node",
          position: { x: 10, y: 20 },
          type: "text",
        },
        {
          data: { textGenerationTaskId: unknown.id },
          id: "rollback-unknown-node",
          position: { x: 210, y: 20 },
          type: "text",
        },
        {
          data: { videoGenerationTaskId: replaceParent.id },
          id: "rollback-replace-node",
          position: { x: 10, y: 220 },
          type: "video",
        },
        {
          data: { imageGenerationTaskId: refundParent.id },
          id: "rollback-refund-node",
          position: { x: 210, y: 220 },
          type: "image",
        },
      ], timestamp);
      for (const task of [replaceParent]) {
        insertEvent(database, task.id, "failed", "USER_GENERATION_INTENT_OPENED_V3");
      }
      setSafety(database, true);
    } finally {
      database.close();
    }

    const childRuntime = await createRuntime(sourceRoot, sourceRoot, testRoot);
    let childStore;
    try {
      childStore = childRuntime.storeModule.createGenerationTaskStore(dataDirectory, {
        recoverRunning: false,
      });
      const childConfiguration = await childRuntime.load(join(sourceRoot, "server/authoritativeGenerationModelConfiguration.ts"));
      const refundChild = childStore.admitAuthoritativeOrGet({
        ...refundInput,
        modelConfiguration: childConfiguration.buildAuthoritativeGenerationModelConfiguration(refundInput.modelConfiguration),
        idempotencyKey: `auto-refund:${refundParent.id}`,
        requestIntent: {
          ...refundInput.requestIntent,
          replacesTaskId: refundParent.id,
        },
        replacesTaskId: refundParent.id,
      }, {
        automaticRefund: {
          expectedAttempt: refundParent.attempt,
          expectedUpdatedAt: refundParent.updatedAt,
          parentTaskId: refundParent.id,
        },
        beforeCommit: () => undefined,
      }).task;
      if (!refundChild || refundChild.state !== "queued") {
        fail("candidate fixture compensation child was not admitted");
      }
      const refundParentEvents = childStore.listEvents(refundParent.id);
      const refundChildEvents = childStore.listEvents(refundChild.id);
      if (
        !expectedReplacementEvent(
          refundParentEvents,
          "AUTO_REFUND_COMPENSATION_ADMITTED",
          refundChild.id,
        ) ||
        !expectedReplacementEvent(
          refundChildEvents,
          "AUTO_REFUND_COMPENSATION_CHILD",
          refundParent.id,
        ) ||
        refundChildEvents.some(({ errorCode }) =>
          errorCode === "USER_GENERATION_INTENT_OPENED_V3",
        )
      ) fail("automatic refund fixture did not consume the one registered intent budget");
      childStore.close();
      childStore = undefined;
      return Object.freeze({
        refundChildId: refundChild.id,
        refundParentId: refundParent.id,
        replaceParentId: replaceParent.id,
        successId: success.id,
        taskIds: Object.freeze([
          success.id,
          unknown.id,
          replaceParent.id,
          refundParent.id,
          refundChild.id,
        ]),
        unknownId: unknown.id,
      });
    } finally {
      if (childStore) childStore.close();
      await childRuntime.server.close();
    }
  } finally {
    if (store) store.close();
    await runtime.server.close();
  }
}

function expectedReplacementEvent(events, code, taskId) {
  return events.find((event) => {
    const eventCode = event.errorCode ?? event.error_code;
    const eventMessage = event.errorMessage ?? event.error_message;
    if (eventCode !== code || typeof eventMessage !== "string") return false;
    try {
      return JSON.parse(eventMessage).taskId === taskId;
    } catch {
      return false;
    }
  });
}

function comparePreservedLedger(before, after, ids, replaceParentId, replacementTaskId) {
  const beforeTasks = before.tasks.filter((task) => ids.includes(task.id));
  const afterTasks = after.tasks.filter((task) => ids.includes(task.id));
  if (JSON.stringify(afterTasks) !== JSON.stringify(beforeTasks)) return false;
  if (JSON.stringify(after.attempts) !== JSON.stringify(before.attempts)) return false;
  if (JSON.stringify(after.canvas) !== JSON.stringify(before.canvas)) return false;
  const expected = expectedReplacementEvent(
    after.events,
    "NEW_GENERATION_REQUESTED",
    replacementTaskId,
  );
  if (!expected || (expected.taskId ?? expected.task_id) !== replaceParentId) return false;
  const withoutExpected = after.events.filter((event) => event.id !== expected.id);
  return JSON.stringify(withoutExpected) === JSON.stringify(before.events);
}

async function oldDisabledPhase(sourceRoot, baselineRoot, testRoot, dataDirectory, ids) {
  const runtime = await createRuntime(sourceRoot, baselineRoot, testRoot);
  let store;
  try {
    store = runtime.storeModule.createGenerationTaskStore(dataDirectory, {
      recoverRunning: false,
    });
    const databasePath = databasePathFor(dataDirectory);
    const beforeIdentity = databaseIdentity(databasePath);
    const beforeDatabase = openRawDatabase(dataDirectory);
    const before = readSnapshot(beforeDatabase, ids);
    beforeDatabase.close();
    let admissionError;
    try {
      store.admitOrGet({
        ...taskInput(
          "text",
          "rollback-unknown-node",
          "changed fingerprint while old version is disabled",
          "rollback-old-changed-0001",
        ),
      });
    } catch (error) {
      admissionError = error;
    }
    if (!admissionError || admissionError.code !== "GLOBAL_DISABLED") {
      fail(`old disabled admission was not rejected as GLOBAL_DISABLED: ${admissionError?.code ?? "none"}`);
    }
    store.close();
    store = undefined;
    const afterDatabase = openRawDatabase(dataDirectory);
    const after = readSnapshot(afterDatabase, ids);
    afterDatabase.close();
    if (before.digest !== after.digest) fail("old disabled phase changed the shared SQLite ledger");
    if (beforeIdentity !== databaseIdentity(databasePath)) {
      fail("old disabled phase changed the shared SQLite inode");
    }
    return Object.freeze({
      admissionAttempts: 1,
      admissionCode: admissionError.code,
      admissionRejected: true,
      databaseWrites: 0,
      fingerprintChangedAttempted: true,
      generationPostCount: 0,
      globalGenerationEnabled: after.safety.global_enabled === 1,
      providerPostCount: 0,
      runtimeScope: "server/types",
    });
  } finally {
    if (store) store.close();
    await runtime.server.close();
  }
}

async function restoredCandidatePhase(
  sourceRoot,
  testRoot,
  dataDirectory,
  ids,
  replaceParentId,
  refundParentId,
  successId,
  unknownId,
  before,
) {
  const controlDatabase = new DatabaseSync(databasePathFor(dataDirectory), { timeout: 5_000 });
  setSafety(controlDatabase, true);
  controlDatabase.close();
  const runtime = await createRuntime(sourceRoot, sourceRoot, testRoot);
  let store;
  try {
    store = runtime.storeModule.createGenerationTaskStore(dataDirectory, {
      recoverRunning: false,
    });
    const unknownBeforeCounts = before.counts;
    let unknownError;
    try {
      store.admitOrGet({
        ...taskInput(
          "text",
          "rollback-unknown-node",
          "second changed fingerprint after restore",
          "rollback-restored-unknown-0001",
        ),
      });
    } catch (error) {
      unknownError = error;
    }
    if (!unknownError || unknownError.code !== "RETRY_OUTCOME_UNKNOWN") {
      fail(`restored unknown task was not blocked as RETRY_OUTCOME_UNKNOWN: ${unknownError?.code ?? "none"}`);
    }
    const unknownTask = store.get(unknownId);
    const unknownAttempt = store.getProviderAttemptForTask(unknownId);
    if (
      !unknownTask || unknownTask.state !== "failed" ||
      unknownTask.errorCode !== "OUTCOME_UNKNOWN_BILLING_RISK" ||
      unknownAttempt?.outcome !== "outcome-unknown"
    ) fail("restored unknown task or Provider evidence changed");

    const parent = store.get(replaceParentId);
    if (!parent || parent.state !== "failed") fail("known failed replacement parent disappeared");
    const admitted = store.admitOrGet({
      ...taskInput(
        "video",
        "rollback-replace-node",
        parent.prompt,
        "rollback-replacement-after-restore-0001",
      ),
      model: parent.model,
      modelConfiguration: parent.modelConfiguration,
      parameters: parent.parameters,
      providerModelId: parent.providerModelId,
      providerProfileId: parent.providerProfileId,
      replacesTaskId: replaceParentId,
    });
    if (!admitted.created || admitted.task.state !== "queued") {
      fail("restored known failure did not create one replacement task");
    }
    const replacementTaskId = admitted.task.id;
    const replacementEvents = store.listEvents(replacementTaskId);
    if (!expectedReplacementEvent(
      replacementEvents,
      "NEW_GENERATION_REPLACES_FAILED_TASK",
      replaceParentId,
    )) fail("replacement task does not retain its failed parent identity");
    const parentEvents = store.listEvents(replaceParentId);
    if (!expectedReplacementEvent(parentEvents, "NEW_GENERATION_REQUESTED", replacementTaskId)) {
      fail("failed parent does not retain its replacement child identity");
    }
    const refundReplacement = store.automaticReplacementTask(refundParentId);
    if (!refundReplacement || refundReplacement.state !== "queued") {
      fail("existing compensation child was not recoverable after rollback");
    }
    const refundCandidates = store.listRefundCompensationCandidates();
    if (refundCandidates.some((task) => task.id === refundParentId)) {
      fail("compensation budget was incorrectly reopened after rollback");
    }
    const database = openRawDatabase(dataDirectory);
    const after = readSnapshot(database, ids);
    database.close();
    if (after.counts.attempts !== unknownBeforeCounts.attempts) {
      fail("restored admission unexpectedly created a Provider attempt");
    }
    const preserved = comparePreservedLedger(
      before,
      after,
      ids,
      replaceParentId,
      replacementTaskId,
    );
    const beforeSuccess = before.tasks.find((task) => task.id === successId);
    const afterSuccess = after.tasks.find((task) => task.id === successId);
    const resultDigestBefore = digest({
      resultAssetId: beforeSuccess?.result_asset_id,
      resultText: beforeSuccess?.result_text,
    });
    const resultDigestAfter = digest({
      resultAssetId: afterSuccess?.result_asset_id,
      resultText: afterSuccess?.result_text,
    });
    const canvasDigestBefore = digest(before.canvas);
    const canvasDigestAfter = digest(after.canvas);
    const safety = after.safety;
    return Object.freeze({
      canvasDigestAfter,
      canvasDigestBefore,
      canvasPreserved: canvasDigestBefore === canvasDigestAfter,
      compensationBudgetPreserved: refundReplacement.id !== refundParentId &&
        !refundCandidates.some((task) => task.id === refundParentId),
      existingLedgerUnchanged: preserved,
      generationPostCount: 0,
      globalGenerationEnabled: safety.global_enabled === 1,
      providerBoundaryCalls: 0,
      providerPostCount: 0,
      replacesTaskPreserved: Boolean(expectedReplacementEvent(
        replacementEvents,
        "NEW_GENERATION_REPLACES_FAILED_TASK",
        replaceParentId,
      )),
      replacementTaskCreated: true,
      replacementTaskId,
      resultDigestAfter,
      resultDigestBefore,
      resultPreserved: resultDigestBefore === resultDigestAfter,
      unknownAdmissionRejected: true,
      unknownBlockCode: unknownError.code,
      unknownPreserved: true,
    });
  } finally {
    if (store) store.close();
    await runtime.server.close();
  }
}

async function main() {
  if (env.UNBOUNDRY_SAFE_TEST !== "1" ||
      env.UNBOUNDRY_GENERATION_SERVER_ROLLBACK_REHEARSAL !== "1") {
    fail("this spec only runs through the fixed safe-runner rehearsal entrypoint");
  }
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
    requireEnvironment("UNBOUNDRY_GENERATION_SERVER_BASELINE_ROOT"),
    testRoot,
    "baseline root",
  );
  const manifestPath = requireEnvironment("UNBOUNDRY_GENERATION_SERVER_BASELINE_MANIFEST");
  const dataDirectory = assertSafeDatabaseDirectory(
    requireEnvironment("UNBOUNDRY_DATA_DIR"),
    testRoot,
  );
  const auditFile = assertPrivatePath(
    requireEnvironment("UNBOUNDRY_TEST_NETWORK_AUDIT"),
    testRoot,
    "network audit",
  );
  const evidencePath = resolve(
    requireEnvironment("UNBOUNDRY_GENERATION_SERVER_ROLLBACK_EVIDENCE"),
  );
  if (!isInside(testRoot, dirname(evidencePath))) {
    fail("rehearsal evidence path escaped the test root");
  }
  if (evidencePath !== join(testRoot, EVIDENCE_FILE)) {
    fail("rehearsal evidence path is not fixed under the test root");
  }
  const baseline = readBaselineManifest(testRoot, baselineRoot, manifestPath);
  if (baseline.root !== baselineRoot) fail("baseline root identity changed during manifest validation");
  if (env.UNBOUNDRY_SOURCE_HEAD !== baseline.candidateHead) {
    fail("candidate source HEAD does not match the staged baseline manifest");
  }
  if (env.UNBOUNDRY_TEST_SPEC !== join(sourceRoot, "tests/generation-server-rollback-rehearsal.spec.mjs")) {
    fail("spec was not invoked through the fixed runner path");
  }
  const initialIdentity = databasePathFor(dataDirectory);
  const seeded = await seedCandidate(sourceRoot, testRoot, dataDirectory);
  const beforeDatabase = openRawDatabase(dataDirectory);
  const before = readSnapshot(beforeDatabase, seeded.taskIds);
  if (before.safety.global_enabled !== 1) {
    beforeDatabase.close();
    fail("candidate seed did not begin with generation enabled");
  }
  setSafety(beforeDatabase, false);
  const beforeOldDatabase = readSnapshot(beforeDatabase, seeded.taskIds);
  beforeDatabase.close();
  const databaseIdentityBefore = databaseIdentity(initialIdentity);

  const oldDisabled = await oldDisabledPhase(
    sourceRoot,
    baselineRoot,
    testRoot,
    dataDirectory,
    seeded.taskIds,
  );
  if (oldDisabled.globalGenerationEnabled !== false) {
    fail("old phase did not observe durable global generation disabled");
  }
  const restored = await restoredCandidatePhase(
    sourceRoot,
    testRoot,
    dataDirectory,
    seeded.taskIds,
    seeded.replaceParentId,
    seeded.refundParentId,
    seeded.successId,
    seeded.unknownId,
    beforeOldDatabase,
  );
  if (databaseIdentity(initialIdentity) !== databaseIdentityBefore) {
    fail("new-old-new phases did not use one SQLite inode");
  }
  const finalDatabase = openRawDatabase(dataDirectory);
  const final = readSnapshot(finalDatabase, seeded.taskIds);
  finalDatabase.close();
  if (final.safety.global_enabled !== 1) fail("restored phase did not leave generation enabled in the synthetic DB");
  const databasePathFingerprint = sha256(Buffer.from(databaseIdentityBefore, "utf8"));
  const evidence = {
    baseline: {
      fileCount: baseline.fileCount,
      filesVerified: baseline.fileCount,
      head: baseline.head,
      manifestDigest: baseline.manifestDigest,
      tree: baseline.tree,
    },
    candidateHead: baseline.candidateHead,
    candidateSourceSha256: baseline.candidateSourceSha256,
    contract: REHEARSAL_CONTRACT,
    database: {
      absolutePathExposed: false,
      identityVerified: true,
      pathFingerprint: databasePathFingerprint,
      relativePath: "data/unboundry.sqlite",
    },
    newRestored: restored,
    oldDisabled,
    phaseIsolation: {
      baselineModuleScope: "server/types",
      baselineRuntime: "frozen-server-types-only",
      candidateRuntime: "workspace-server-types",
      moduleGraphsIsolated: true,
      sameDatabasePath: true,
    },
    phaseOrder: ["new-seed", "old-disabled", "new-restored"],
    realProductionDataAccessed: false,
    realProviderPosts: 0,
    sameDatabase: true,
    status: "pass",
    syntheticOnly: true,
    testCount: 1,
  };
  if (oldDisabled.databaseWrites !== 0 || restored.providerPostCount !== 0) {
    fail("rehearsal crossed its no-write/no-Provider boundary");
  }
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: "wx",
    mode: 0o400,
  });
  console.log(JSON.stringify({
    contract: REHEARSAL_CONTRACT,
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
