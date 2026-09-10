import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import {
  createGenerationRecoveryOriginalCommands,
  GenerationRecoveryOriginalCommandError,
  issueAdapterVerifiedOriginalRecoveryEvidence,
  type OriginalRecoveryRelatedLedgerSnapshot,
  type OriginalProviderEvidence,
} from "../server/generationRecoveryOriginalCommands";
import { newGenerationForNodeInTransaction } from "../server/generationAttemptQueries";

const ownerId = "v4-recovery-owner";
const adminId = "v4-recovery-admin";
const baseTime = "2026-01-01T00:00:00.000Z";

type FixtureOptions = Readonly<{
  taskState?: "failed" | "recovering" | "running";
  taskErrorCode?: string;
  providerTaskId?: string;
  suffix?: string;
}>;

type Fixture = Readonly<{
  dataDirectory: string;
  database: ReturnType<typeof openAppDatabase>;
  commands: ReturnType<typeof createGenerationRecoveryOriginalCommands>;
  taskId: string;
  canvasId: string;
  nodeId: string;
  caseId: string;
  requestFingerprint: string;
}>;

function seedUser(database: ReturnType<typeof openAppDatabase>, id: string, role: "admin" | "user") {
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'safe-test', ?, 'active', ?, ?)
  `).run(id, id, id, role, baseTime, baseTime);
}

function errorCode(error: unknown) {
  return error instanceof GenerationRecoveryOriginalCommandError ? error.code : undefined;
}

const readRelatedLedgers = (
  database: ReturnType<typeof openAppDatabase>,
  input: Readonly<{ taskId: string; ownerId: string; canvasId: string; nodeId: string }>,
): OriginalRecoveryRelatedLedgerSnapshot => {
  const canvas = database.prepare(`
    SELECT owner_id, id, revision, nodes, edges, viewport, updated_at,
      save_session_id, save_sequence, graph_revision
    FROM canvas_documents WHERE owner_id = ? AND id = ?
  `).get(input.ownerId, input.canvasId) as Record<string, unknown> | undefined;
  const canvasNode = canvas && typeof canvas.nodes === "string"
    ? (JSON.parse(canvas.nodes) as unknown[]).find((value) =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        (value as { id?: unknown }).id === input.nodeId,
      ) as Record<string, unknown> | undefined
    : undefined;
  const publications = database.prepare(
    "SELECT * FROM media_publication_attempts WHERE task_id = ? ORDER BY attempt_id",
  ).all(input.taskId) as Array<Record<string, unknown>>;
  const assets = database.prepare(
    "SELECT * FROM media_assets WHERE owner_id = ? ORDER BY kind, id",
  ).all(input.ownerId) as Array<Record<string, unknown>>;
  const projectionStates = database.prepare(
    "SELECT * FROM generation_canvas_projection_states WHERE task_id = ?",
  ).all(input.taskId) as Array<Record<string, unknown>>;
  return {
    canvas: canvas as NonNullable<OriginalRecoveryRelatedLedgerSnapshot["canvas"]> | undefined,
    canvasNode,
    publications,
    assets,
    projectionStates,
  };
};

function expectRecoveryError(action: () => unknown, expectedCode: string) {
  let thrown: unknown;
  try { action(); } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(GenerationRecoveryOriginalCommandError);
  expect(errorCode(thrown)).toBe(expectedCode);
}

async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const suffix = options.suffix ?? Math.random().toString(36).slice(2, 9);
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-original-recovery-"));
  const database = openAppDatabase(dataDirectory);
  seedUser(database, ownerId, "user");
  seedUser(database, adminId, "admin");
  const canvasId = `v4-canvas-${suffix}`;
  const nodeId = `v4-node-${suffix}`;
  const taskId = `v4-task-${suffix}`;
  const caseId = `v4-case-${suffix}`;
  const requestFingerprint = `intent-v3:${"a".repeat(64)}`;
  const state = options.taskState ?? "failed";
  const taskErrorCode = options.taskErrorCode ?? "OUTCOME_UNKNOWN_BILLING_RISK";
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_sequence
    ) VALUES (?, ?, 1, 1, ?, '[]', ?, ?, 0)
  `).run(
    ownerId,
    canvasId,
    JSON.stringify([{ id: nodeId, type: "video", data: { title: "safe node" } }]),
    JSON.stringify({ x: 0, y: 0, zoom: 1 }),
    baseTime,
  );
  database.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, node_id, kind, prompt, model, parameters,
      idempotency_key, request_fingerprint, state, attempt, error_code,
      error_message, created_at, updated_at, owner_id,
      provider_profile_id, provider_model_id, cost_currency, provider_task_id,
      model_configuration, credential_revision
    ) VALUES (?, ?, ?, 'video', 'safe recovery prompt', 'safe-model', '{}',
      ?, ?, ?, 1, ?, 'safe incident', ?, ?, ?, 'safe-profile',
      'safe-provider/model', 'USD', ?, '{}', 0)
  `).run(
    taskId,
    canvasId,
    nodeId,
    `v4-key-${suffix}`,
    requestFingerprint,
    state,
    taskErrorCode,
    baseTime,
    baseTime,
    ownerId,
    options.providerTaskId ?? null,
  );
  database.prepare(`
    INSERT INTO generation_provider_attempts (
      task_id, execution_attempt, provider_profile_id, provider_model_id,
      kind, evidence, created_at, owner_id, credential_revision, outcome,
      provider_task_id
    ) VALUES (?, 1, 'safe-profile', 'safe-provider/model', 'video',
      'provider-boundary', ?, ?, 0, 'outcome-unknown', ?)
  `).run(taskId, baseTime, ownerId, options.providerTaskId ?? null);
  database.prepare(`
    INSERT INTO generation_admission_events (
      task_id, execution_attempt, owner_id, kind, admission_type, created_at
    ) VALUES (?, 1, ?, 'video', 'initial', ?)
  `).run(taskId, ownerId, baseTime);
  database.prepare(`
    INSERT INTO generation_task_events (
      task_id, state, error_code, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(taskId, state, taskErrorCode, "safe incident", baseTime);
  const casePayload = {
    version: 1,
    event: "opened",
    caseId,
    taskId,
    executionAttempt: 1,
    ownerId,
    phase: "queued",
    reason: "outcome_unknown",
    attemptStartedAt: baseTime,
    providerWindowMs: 75 * 60_000,
    automaticDeadlineAt: new Date(Date.parse(baseTime) + (75 * 60_000) + (24 * 60 * 60_000)).toISOString(),
    caseRevision: 1,
    operationId: `case-open-${suffix}`,
    actorId: "system:generation-recovery",
    checkCount: 0,
    checkOutcome: "not_checked",
    inspectionUsed: 0,
    progressVersion: 0,
    readVersion: 0,
    lastReadProgressVersion: 0,
  };
  database.prepare(`
    INSERT INTO generation_task_events (
      task_id, state, error_code, error_message, created_at
    ) VALUES (?, ?, 'RECOVERY_CASE_V1', ?, ?)
  `).run(taskId, state, JSON.stringify(casePayload), baseTime);
  return {
    dataDirectory,
    database,
    commands: createGenerationRecoveryOriginalCommands(database, {
      enabled: true,
      readRelatedLedgers,
    }),
    taskId,
    canvasId,
    nodeId,
    caseId,
    requestFingerprint,
  };
}

function issueEvidence(fixture: Fixture, overrides: Partial<{
  providerState: "matched" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  feeDisposition: "unknown" | "charged" | "not_charged";
  providerTaskId?: string;
  observedAt?: string;
  evidenceSha256?: string;
}> = {}) {
  const providerTaskId = Object.hasOwn(overrides, "providerTaskId")
    ? overrides.providerTaskId
    : "provider-v4-original";
  const facts = {
    taskId: fixture.taskId,
    ownerId,
    canvasId: fixture.canvasId,
    nodeId: fixture.nodeId,
    kind: "video" as const,
    executionAttempt: 1,
    providerProfileId: "safe-profile",
    providerModelId: "safe-provider/model",
    requestFingerprint: fixture.requestFingerprint,
    ...(providerTaskId ? { providerTaskId } : {}),
    providerState: overrides.providerState ?? "running",
    feeDisposition: overrides.feeDisposition ?? "unknown",
    observedAt: overrides.observedAt ?? "2026-01-01T00:00:02.000Z",
  } as const;
  return issueAdapterVerifiedOriginalRecoveryEvidence(facts, (value) => ({
    adapterId: "safe-test-adapter",
    protocolContractId: "safe-test-contract-v1",
    evidenceSha256: overrides.evidenceSha256 ?? createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  }));
}

function seedPublishedRelayCandidate(fixture: Fixture, suffix: string) {
  const assetId = `v4-relay-asset-${suffix}`;
  const attemptId = `v4-relay-publication-${suffix}`;
  const stagingName = `.v4-relay-${suffix}.generating`;
  const objectKey = `safe/${assetId}.mp4`;
  const storageName = `${assetId}.mp4`;
  const checksum = createHash("sha256").update(assetId).digest("hex");
  fixture.database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, storage_profile_id, object_key, content_type,
      checksum_sha256, storage_status, duration_seconds, duration_source,
      duration_status, media_width, media_height
    ) VALUES ('video', ?, ?, ?, 1, ?, ?, 'local', NULL, ?, 'video/mp4', ?,
      'ready', 1, 'provider-task', 'ready', 1, 1)
  `).run(assetId, ownerId, storageName, baseTime, baseTime, objectKey, checksum);
  fixture.database.prepare(`
    INSERT INTO media_publication_attempts (
      attempt_id, owner_id, kind, asset_id, source, state,
      storage_backend, final_storage_name, object_key, storage_profile_id,
      staging_name, task_id, task_execution_attempt, history_label,
      byte_size, checksum_sha256, content_type, duration_seconds,
      duration_source, media_width, media_height, actual_cost_microunits,
      provider_usage_tokens, error_code, retry_count, adopted_at,
      adopted_canvas_id, created_at, updated_at, output_slot, output_set_count
    ) VALUES (?, ?, 'video', ?, 'generation', 'published', 'local', ?, ?, NULL,
      ?, ?, 1, 'safe relay candidate', 1, ?, 'video/mp4', 1, 'provider-task',
      1, 1, 0, NULL, NULL, 0, NULL, NULL, ?, ?, ?, ?)
  `).run(
    attemptId, ownerId, assetId, storageName, objectKey, stagingName,
    fixture.taskId, checksum, baseTime, baseTime,
    Number((fixture.database.prepare("SELECT COUNT(*) AS count FROM media_publication_attempts WHERE task_id = ?")
      .get(fixture.taskId) as { count: number }).count),
    Number(JSON.parse(String((fixture.database.prepare("SELECT model_configuration FROM generation_tasks WHERE id = ?")
      .get(fixture.taskId) as { model_configuration: string }).model_configuration)).modelResultCount ?? 1),
  );
  return assetId;
}

function inputFor(fixture: Fixture, evidence: OriginalProviderEvidence, operationId: string, actorId = adminId) {
  const expected = fixture.commands.captureOriginalRecovery({
    taskId: fixture.taskId,
    caseId: fixture.caseId,
    ownerId,
    executionAttempt: 1,
  });
  return {
    taskId: fixture.taskId,
    caseId: fixture.caseId,
    ownerId,
    executionAttempt: 1,
    expectedTaskUpdatedAt: expected.task.updated_at,
    expectedTaskEventWatermark: expected.taskEventWatermark,
    expectedCaseEventId: expected.caseEventId,
    expected,
    evidence,
    actorId,
    operationId,
    now: "2026-01-01T00:00:03.000Z",
  } as const;
}

async function closeFixture(fixture: Fixture) {
  if (fixture.database.isTransaction) fixture.database.exec("ROLLBACK");
  fixture.database.close();
  await rm(fixture.dataDirectory, { force: true, recursive: true });
}

test("capture contains the complete task, attempt, admission, canvas and projection fence", async () => {
  const fixture = await createFixture();
  try {
    const capture = fixture.commands.captureOriginalRecovery({
      taskId: fixture.taskId, caseId: fixture.caseId, ownerId, executionAttempt: 1,
    });
    expect(capture.version).toBe(1);
    expect(capture.taskEvents.length).toBe(2);
    expect(capture.attempts).toHaveLength(1);
    expect(capture.admissionEvents).toHaveLength(1);
    expect(capture.canvas?.id).toBe(fixture.canvasId);
    expect(capture.canvasNode?.id).toBe(fixture.nodeId);
    expect(capture.projectionStates).toHaveLength(0);
    expect(capture.taskEventWatermark).toBe(capture.caseEventId);
    expect(capture.logicalSha256).toMatch(/^[a-f0-9]{64}$/);
    const evidence = issueEvidence(fixture);
    const before = fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events",
    ).get() as { count: number };
    const dryRun = fixture.commands.dryRunOriginalRecovery(inputFor(fixture, evidence, "dry-run"));
    expect(dryRun).toMatchObject({ allowed: true, action: "resume_original_only", noProviderPost: true });
    const after = fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events",
    ).get() as { count: number };
    expect(after.count).toBe(before.count);
  } finally {
    await closeFixture(fixture);
  }
});

test("verified unresolved evidence enters original-only recovery exactly once", async () => {
  const fixture = await createFixture();
  try {
    const evidence = issueEvidence(fixture);
    const input = inputFor(fixture, evidence, "resume-once");
    const first = fixture.commands.applyOriginalRecovery(input);
    expect(first).toMatchObject({ changed: true, action: "resume_original_only" });
    const task = fixture.database.prepare(
      "SELECT state, error_code, attempt, created_at, provider_task_id FROM generation_tasks WHERE id = ?",
    ).get(fixture.taskId) as Record<string, unknown>;
    expect(task).toMatchObject({ state: "recovering", error_code: "AUTOMATIC_RESULT_RECOVERY", attempt: 1, created_at: baseTime });
    expect(task.provider_task_id).toBe("provider-v4-original");
    const marker = fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_ORIGINAL_ONLY_V1'
    `).get(fixture.taskId) as { count: number };
    const evidenceEvent = fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_ORIGINAL_EVIDENCE_V1'
    `).get(fixture.taskId) as { count: number };
    expect(marker.count).toBe(1);
    expect(evidenceEvent.count).toBe(1);
    const second = fixture.commands.applyOriginalRecovery(input);
    expect(second).toMatchObject({ changed: false, action: "resume_original_only" });
    expect((fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_ORIGINAL_ONLY_V1'
    `).get(fixture.taskId) as { count: number }).count).toBe(1);
    expect((fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'generation_recovery.original_resume'
    `).get() as { count: number }).count).toBe(1);
  } finally {
    await closeFixture(fixture);
  }
});

test("a verified original result admits recovery before the existing publication path", async () => {
  const fixture = await createFixture({ providerTaskId: "provider-result" });
  try {
    const evidence = issueEvidence(fixture, {
      providerTaskId: "provider-result",
      providerState: "succeeded",
    });
    const input = inputFor(fixture, evidence, "result-recovery");
    const applied = fixture.commands.applyOriginalRecovery(input);
    expect(applied).toMatchObject({ changed: true, action: "resume_original_only" });
    const row = fixture.database.prepare(`
      SELECT state, error_code, provider_task_id FROM generation_tasks WHERE id = ?
    `).get(fixture.taskId) as Record<string, unknown>;
    expect(row).toMatchObject({ state: "recovering", error_code: "AUTOMATIC_RESULT_RECOVERY", provider_task_id: "provider-result" });
    expect((fixture.database.prepare(`
      SELECT outcome FROM generation_provider_attempts
      WHERE task_id = ? AND execution_attempt = 1
    `).get(fixture.taskId) as { outcome: string }).outcome).toBe("accepted");
    const taskStore = createGenerationTaskStore(fixture.dataDirectory, { recoverRunning: false });
    try {
      expect(taskStore.markProviderResponseReceivedForTask(fixture.taskId))
        .toEqual({ executionAttempt: 1 });
    } finally {
      taskStore.close();
    }
    expect((fixture.database.prepare(`
      SELECT outcome FROM generation_provider_attempts
      WHERE task_id = ? AND execution_attempt = 1
    `).get(fixture.taskId) as { outcome: string }).outcome).toBe("response-received");
    const marker = fixture.database.prepare(`
      SELECT error_message FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_ORIGINAL_ONLY_V1'
    `).get(fixture.taskId) as { error_message: string };
    expect(Object.keys(JSON.parse(marker.error_message)).sort()).toEqual([
      "caseId", "executionAttempt", "marker", "operationId", "ownerId", "taskId", "version",
    ]);
    // Outputs are intentionally absent: saveOriginalGenerationProviderResult
    // remains the only path allowed to publish a verified result.
    expect(fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM media_publication_attempts WHERE task_id = ?
    `).get(fixture.taskId) as { count: number }).toEqual({ count: 0 });
  } finally {
    await closeFixture(fixture);
  }
});

test("a verified result on an already recovering original task delegates to the existing save path", async () => {
  const fixture = await createFixture({
    taskState: "recovering",
    taskErrorCode: "AUTOMATIC_RESULT_RECOVERY",
    providerTaskId: "provider-already-recovering",
  });
  try {
    const evidence = issueEvidence(fixture, {
      providerTaskId: "provider-already-recovering",
      providerState: "succeeded",
    });
    const input = inputFor(fixture, evidence, "already-recovering-result");
    const before = fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events",
    ).get() as { count: number };
    const dryRun = fixture.commands.dryRunOriginalRecovery(input);
    expect(dryRun).toMatchObject({
      allowed: true,
      action: "resume_existing_result",
      reasonCode: "RESULT_USES_EXISTING_PUBLICATION_PATH",
      noProviderPost: true,
    });
    const applied = fixture.commands.applyOriginalRecovery(input);
    expect(applied).toMatchObject({ changed: true, action: "resume_existing_result" });
    const task = fixture.database.prepare(
      "SELECT state, error_code, provider_task_id FROM generation_tasks WHERE id = ?",
    ).get(fixture.taskId) as Record<string, unknown>;
    expect(task).toMatchObject({
      state: "recovering",
      error_code: "AUTOMATIC_RESULT_RECOVERY",
      provider_task_id: "provider-already-recovering",
    });
    expect(fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_ORIGINAL_EVIDENCE_V1'
    `).get(fixture.taskId) as { count: number }).toEqual({ count: 1 });
    const after = fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events",
    ).get() as { count: number };
    expect(after.count).toBe(before.count + 1);
    expect(fixture.commands.applyOriginalRecovery(input)).toMatchObject({
      changed: false,
      action: "resume_existing_result",
    });
  } finally {
    await closeFixture(fixture);
  }
});

test("a complete ledger CAS rejects a late event before any marker or Provider action", async () => {
  const fixture = await createFixture();
  try {
    const evidence = issueEvidence(fixture);
    const input = inputFor(fixture, evidence, "stale-cas");
    fixture.database.prepare(`
      INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at)
      VALUES (?, 'failed', 'LATE_PROVIDER_RESPONSE', 'retained', ?)
    `).run(fixture.taskId, "2026-01-01T00:00:02.500Z");
    expectRecoveryError(() => fixture.commands.applyOriginalRecovery(input), "RECOVERY_CAS_CONFLICT");
    const task = fixture.database.prepare(
      "SELECT state, error_code, provider_task_id FROM generation_tasks WHERE id = ?",
    ).get(fixture.taskId) as Record<string, unknown>;
    expect(task).toMatchObject({ state: "failed", error_code: "OUTCOME_UNKNOWN_BILLING_RISK", provider_task_id: null });
    expect((fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_ORIGINAL_ONLY_V1'
    `).get(fixture.taskId) as { count: number }).count).toBe(0);
  } finally {
    await closeFixture(fixture);
  }
});

test("a unique no-ID match atomically attaches without original-only marker and preserves recovery state", async () => {
  const fixture = await createFixture({ taskState: "recovering" });
  try {
    const evidence = issueEvidence(fixture, { providerState: "matched" });
    const input = inputFor(fixture, evidence, "attach-one");
    const first = fixture.commands.applyOriginalRecovery(input);
    expect(first).toMatchObject({ changed: true, action: "attach_provider_task" });
    const row = fixture.database.prepare(`
      SELECT task.provider_task_id AS taskProviderTaskId, task.state,
        attempt.provider_task_id AS attemptProviderTaskId, attempt.outcome
      FROM generation_tasks AS task
      JOIN generation_provider_attempts AS attempt ON attempt.task_id = task.id
        AND attempt.execution_attempt = task.attempt
      WHERE task.id = ?
    `).get(fixture.taskId) as Record<string, unknown>;
    expect(row).toMatchObject({
      taskProviderTaskId: "provider-v4-original",
      attemptProviderTaskId: "provider-v4-original",
      outcome: "accepted",
      state: "recovering",
    });
    expect((fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_ORIGINAL_ONLY_V1'
    `).get(fixture.taskId) as { count: number }).count).toBe(0);
    expect(fixture.commands.applyOriginalRecovery(input)).toMatchObject({ changed: false, action: "attach_provider_task" });
  } finally {
    await closeFixture(fixture);
  }
});

test("a succeeded original observation can continue a bounded ready relay publication set", async () => {
  const fixture = await createFixture({ providerTaskId: "provider-relay-original" });
  try {
    fixture.database.prepare("UPDATE generation_tasks SET model_configuration = ? WHERE id = ?")
      .run(JSON.stringify({ providerProtocol: "media-generate", modelResultCount: 2 }), fixture.taskId);
    const assetId = seedPublishedRelayCandidate(fixture, "one");
    const evidence = issueEvidence(fixture, {
      providerTaskId: "provider-relay-original",
      providerState: "succeeded",
    });
    const input = inputFor(fixture, evidence, "relay-partial-original");
    const before = {
      attempts: (fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM generation_provider_attempts WHERE task_id = ?",
      ).get(fixture.taskId) as { count: number }).count,
      admissions: (fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM generation_admission_events WHERE task_id = ?",
      ).get(fixture.taskId) as { count: number }).count,
      publications: (fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM media_publication_attempts WHERE task_id = ?",
      ).get(fixture.taskId) as { count: number }).count,
    };
    expect(fixture.commands.dryRunOriginalRecovery(input)).toMatchObject({
      allowed: true,
      action: "resume_original_only",
      noProviderPost: true,
    });
    const applied = fixture.commands.applyOriginalRecovery(input);
    expect(applied).toMatchObject({
      changed: true,
      action: "resume_original_only",
    });
    expect(fixture.database.prepare(
      "SELECT state, error_code, result_asset_id FROM generation_tasks WHERE id = ?",
    ).get(fixture.taskId)).toEqual({
      state: "recovering",
      error_code: "AUTOMATIC_RESULT_RECOVERY",
      result_asset_id: null,
    });
    expect((fixture.database.prepare(`
      SELECT asset_id, state FROM media_publication_attempts
      WHERE task_id = ? AND task_execution_attempt = 1
    `).get(fixture.taskId) as { asset_id: string; state: string })).toEqual({
      asset_id: assetId,
      state: "published",
    });
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_provider_attempts WHERE task_id = ?",
    ).get(fixture.taskId) as { count: number }).count).toBe(before.attempts);
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_admission_events WHERE task_id = ?",
    ).get(fixture.taskId) as { count: number }).count).toBe(before.admissions);
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM media_publication_attempts WHERE task_id = ?",
    ).get(fixture.taskId) as { count: number }).count).toBe(before.publications);
  } finally {
    await closeFixture(fixture);
  }

  const complete = await createFixture({
    providerTaskId: "provider-relay-complete",
    suffix: "complete",
  });
  try {
    complete.database.prepare("UPDATE generation_tasks SET model_configuration = ? WHERE id = ?")
      .run(JSON.stringify({ providerProtocol: "media-generate", modelResultCount: 2 }), complete.taskId);
    seedPublishedRelayCandidate(complete, "complete-one");
    seedPublishedRelayCandidate(complete, "complete-two");
    const evidence = issueEvidence(complete, {
      providerTaskId: "provider-relay-complete",
      providerState: "succeeded",
    });
    expectRecoveryError(
      () => complete.commands.dryRunOriginalRecovery(
        inputFor(complete, evidence, "relay-complete-original"),
      ),
      "RECOVERY_PUBLICATION_CONFLICT",
    );
  } finally {
    await closeFixture(complete);
  }
});

test("a late branded succeeded observation is durably quarantined after failure settlement", async () => {
  const fixture = await createFixture({ providerTaskId: "provider-late-success" });
  try {
    const lateSucceeded = issueEvidence(fixture, {
      providerState: "succeeded",
      feeDisposition: "unknown",
      providerTaskId: "provider-late-success",
      observedAt: "2026-01-01T00:00:04.000Z",
      evidenceSha256: "b".repeat(64),
    });
    // Capture before the independent terminal failure settlement to exercise
    // the real stale-fence path used by generationTasks.ts.
    const staleInput = inputFor(fixture, lateSucceeded, "late-succeeded-conflict");
    const settled = issueEvidence(fixture, {
      providerState: "failed",
      feeDisposition: "charged",
      providerTaskId: "provider-late-success",
      observedAt: "2026-01-01T00:00:03.000Z",
      evidenceSha256: "a".repeat(64),
    });
    expect(fixture.commands.applyOriginalRecovery(
      inputFor(fixture, settled, "late-failure-settlement"),
    )).toMatchObject({ changed: true, action: "settle_charged_failure" });
    expect(fixture.commands.dryRunOriginalRecovery(staleInput)).toMatchObject({
      allowed: false,
      reasonCode: "CAS_CONFLICT",
      noProviderPost: true,
    });

    const fresh = fixture.commands.captureOriginalRecovery({
      taskId: fixture.taskId, caseId: fixture.caseId, ownerId, executionAttempt: 1,
    });
    const lateInput = {
      ...staleInput,
      expected: fresh,
      expectedTaskUpdatedAt: fresh.task.updated_at,
      expectedTaskEventWatermark: fresh.taskEventWatermark,
      expectedCaseEventId: fresh.caseEventId,
      now: "2026-01-01T00:00:05.000Z",
    } as const;
    const before = {
      task: fixture.database.prepare(
        "SELECT state, error_code, error_message, updated_at, provider_task_id, result_asset_id, result_text FROM generation_tasks WHERE id = ?",
      ).get(fixture.taskId),
      attempt: fixture.database.prepare(
        "SELECT outcome, failure_code, finished_at, provider_task_id FROM generation_provider_attempts WHERE task_id = ? AND execution_attempt = 1",
      ).get(fixture.taskId),
      admissions: (fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM generation_admission_events WHERE task_id = ?",
      ).get(fixture.taskId) as { count: number }).count,
      publications: (fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM media_publication_attempts WHERE task_id = ?",
      ).get(fixture.taskId) as { count: number }).count,
      taskEvents: (fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?",
      ).get(fixture.taskId) as { count: number }).count,
      caseEvents: (fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'",
      ).get(fixture.taskId) as { count: number }).count,
      audits: (fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'generation_recovery.case_progressed'",
      ).get() as { count: number }).count,
    };
    const applied = fixture.commands.recordLateSucceededOriginalRecoveryConflict(lateInput);
    expect(applied).toMatchObject({
      changed: true,
      action: "record_provider_evidence_conflict",
      maintenance: "provider_evidence_conflict",
    });
    expect(fixture.database.prepare(
      "SELECT state, error_code, error_message, updated_at, provider_task_id, result_asset_id, result_text FROM generation_tasks WHERE id = ?",
    ).get(fixture.taskId)).toEqual(before.task);
    expect(fixture.database.prepare(
      "SELECT outcome, failure_code, finished_at, provider_task_id FROM generation_provider_attempts WHERE task_id = ? AND execution_attempt = 1",
    ).get(fixture.taskId)).toEqual(before.attempt);
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_admission_events WHERE task_id = ?",
    ).get(fixture.taskId) as { count: number }).count).toBe(before.admissions);
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM media_publication_attempts WHERE task_id = ?",
    ).get(fixture.taskId) as { count: number }).count).toBe(before.publications);
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?",
    ).get(fixture.taskId) as { count: number }).count).toBe(before.taskEvents + 2);
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'",
    ).get(fixture.taskId) as { count: number }).count).toBe(before.caseEvents + 1);
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'generation_recovery.case_progressed'",
    ).get() as { count: number }).count).toBe(before.audits + 1);
    const conflictPayload = JSON.parse((fixture.database.prepare(`
      SELECT error_message FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1'
      ORDER BY id DESC LIMIT 1
    `).get(fixture.taskId) as { error_message: string }).error_message) as Record<string, unknown>;
    expect(conflictPayload).toMatchObject({
      conflict: "provider_evidence_conflict",
      conflictKind: "provider_state",
      priorReceiptEventCode: "PROVIDER_FAILURE_CHARGE_SETTLED",
      priorEvidenceSha256: "a".repeat(64),
      incomingEvidenceSha256: "b".repeat(64),
      incomingObservedAt: "2026-01-01T00:00:04.000Z",
      incomingFeeDisposition: "unknown",
      incomingProviderState: "succeeded",
      incomingProviderTaskId: "provider-late-success",
    });
    expect(Object.keys(conflictPayload).some((key) => /url|body|response/i.test(key))).toBe(false);
    const casePayload = JSON.parse((fixture.database.prepare(`
      SELECT error_message FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
      ORDER BY id DESC LIMIT 1
    `).get(fixture.taskId) as { error_message: string }).error_message) as Record<string, unknown>;
    expect(casePayload).toMatchObject({
      event: "progressed", phase: "queued", reason: "provider_evidence_conflict", progressVersion: 1,
    });

    // An exact replay is idempotent and cannot append a second conflict or
    // wake the case again.
    expect(fixture.commands.recordLateSucceededOriginalRecoveryConflict(lateInput)).toMatchObject({
      changed: false,
      action: "record_provider_evidence_conflict",
      maintenance: "provider_evidence_conflict",
    });
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?",
    ).get(fixture.taskId) as { count: number }).count).toBe(before.taskEvents + 2);
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'",
    ).get(fixture.taskId) as { count: number }).count).toBe(before.caseEvents + 1);
    expect((fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'generation_recovery.case_progressed'",
    ).get() as { count: number }).count).toBe(before.audits + 1);
  } finally {
    await closeFixture(fixture);
  }
});

test("terminal evidence is idempotent by receipt identity and quarantines contradictory observations", async () => {
  for (const feeDisposition of ["charged", "not_charged"] as const) {
    const fixture = await createFixture({ providerTaskId: "provider-terminal" });
    try {
      const evidence = issueEvidence(fixture, {
        providerState: "failed", feeDisposition, providerTaskId: "provider-terminal",
        evidenceSha256: "a".repeat(64),
      });
      const input = inputFor(fixture, evidence, `settle-${feeDisposition}`);
      const first = fixture.commands.applyOriginalRecovery(input);
      expect(first.changed).toBe(true);
      const expectedCode = feeDisposition === "charged"
        ? "PROVIDER_FAILED_CHARGE_SETTLED"
        : "PROVIDER_NOT_ACCEPTED_NO_CHARGE";
      const row = fixture.database.prepare(`
        SELECT task.error_code AS taskErrorCode, attempt.outcome, attempt.failure_code AS failureCode
        FROM generation_tasks AS task JOIN generation_provider_attempts AS attempt
          ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
        WHERE task.id = ?
      `).get(fixture.taskId) as Record<string, unknown>;
      expect(row).toMatchObject({ taskErrorCode: expectedCode, failureCode: expectedCode });
      expect(row.outcome).toBe(feeDisposition === "charged" ? "provider-failed" : "definitive-rejected");
      expect(fixture.commands.applyOriginalRecovery(input)).toMatchObject({ changed: false });
      const sameReceiptDifferentObservation = issueEvidence(fixture, {
        providerState: "failed", feeDisposition, providerTaskId: "provider-terminal",
        observedAt: "2026-01-01T00:00:03.000Z",
        evidenceSha256: evidence.evidenceSha256,
      });
      expect(fixture.commands.applyOriginalRecovery(
        inputFor(fixture, sameReceiptDifferentObservation, `settle-observed-at-${feeDisposition}`),
      )).toMatchObject({ changed: false, action: `settle_${feeDisposition === "charged" ? "charged" : "no_charge"}_failure` });

      const stateBeforeConflict = fixture.database.prepare(`
        SELECT task.state, task.error_code, task.updated_at, task.provider_task_id,
          attempt.outcome, attempt.failure_code, attempt.finished_at
        FROM generation_tasks AS task JOIN generation_provider_attempts AS attempt
          ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
        WHERE task.id = ?
      `).get(fixture.taskId);
      const countsBeforeConflict = {
        attempts: (fixture.database.prepare(
          "SELECT COUNT(*) AS count FROM generation_provider_attempts WHERE task_id = ?",
        ).get(fixture.taskId) as { count: number }).count,
        admissions: (fixture.database.prepare(
          "SELECT COUNT(*) AS count FROM generation_admission_events WHERE task_id = ?",
        ).get(fixture.taskId) as { count: number }).count,
        publications: (fixture.database.prepare(
          "SELECT COUNT(*) AS count FROM media_publication_attempts WHERE task_id = ?",
        ).get(fixture.taskId) as { count: number }).count,
        caseEvents: (fixture.database.prepare(
          "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'",
        ).get(fixture.taskId) as { count: number }).count,
        audits: (fixture.database.prepare(
          "SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'generation_recovery.case_progressed'",
        ).get() as { count: number }).count,
      };

      const oppositeFee = feeDisposition === "charged" ? "not_charged" : "charged";
      const oppositeEvidence = issueEvidence(fixture, {
        providerState: "failed", feeDisposition: oppositeFee, providerTaskId: "provider-terminal",
        observedAt: "2026-01-01T00:00:04.000Z",
        evidenceSha256: "b".repeat(64),
      });
      const oppositeInput = inputFor(fixture, oppositeEvidence, `settle-opposite-${feeDisposition}`);
      const firstConflict = fixture.commands.applyOriginalRecovery(oppositeInput);
      expect(firstConflict).toMatchObject({
        changed: true,
        maintenance: "provider_evidence_conflict",
      });
      expect(fixture.database.prepare(`
        SELECT task.state, task.error_code, task.updated_at, task.provider_task_id,
          attempt.outcome, attempt.failure_code, attempt.finished_at
        FROM generation_tasks AS task JOIN generation_provider_attempts AS attempt
          ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
        WHERE task.id = ?
      `).get(fixture.taskId)).toEqual(stateBeforeConflict);
      expect((fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM generation_provider_attempts WHERE task_id = ?",
      ).get(fixture.taskId) as { count: number }).count).toBe(countsBeforeConflict.attempts);
      expect((fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM generation_admission_events WHERE task_id = ?",
      ).get(fixture.taskId) as { count: number }).count).toBe(countsBeforeConflict.admissions);
      expect((fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM media_publication_attempts WHERE task_id = ?",
      ).get(fixture.taskId) as { count: number }).count).toBe(countsBeforeConflict.publications);
      expect((fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1'
      `).get(fixture.taskId) as { count: number }).count).toBe(1);
      expect((fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
      `).get(fixture.taskId) as { count: number }).count).toBe(countsBeforeConflict.caseEvents + 1);
      expect((fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'generation_recovery.case_progressed'",
      ).get() as { count: number }).count).toBe(countsBeforeConflict.audits + 1);
      const conflictRow = fixture.database.prepare(`
        SELECT error_message FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1'
        ORDER BY id DESC LIMIT 1
      `).get(fixture.taskId) as { error_message: string };
      const conflictPayload = JSON.parse(conflictRow.error_message) as Record<string, unknown>;
      expect(conflictPayload).toMatchObject({
        conflict: "provider_evidence_conflict",
        conflictKind: "fee_disposition",
        incomingFeeDisposition: oppositeFee,
        incomingEvidenceSha256: "b".repeat(64),
      });
      expect(Object.keys(conflictPayload).some((key) => /url|body|response/i.test(key))).toBe(false);
      const firstCasePayload = JSON.parse((fixture.database.prepare(`
        SELECT error_message FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
        ORDER BY id DESC LIMIT 1
      `).get(fixture.taskId) as { error_message: string }).error_message) as Record<string, unknown>;
      expect(firstCasePayload).toMatchObject({
        event: "progressed", phase: "queued", reason: "provider_evidence_conflict", progressVersion: 1,
      });

      const hashConflictEvidence = issueEvidence(fixture, {
        providerState: "failed", feeDisposition, providerTaskId: "provider-terminal",
        observedAt: "2026-01-01T00:00:05.000Z",
        evidenceSha256: "c".repeat(64),
      });
      const hashConflictInput = inputFor(fixture, hashConflictEvidence, `settle-hash-${feeDisposition}`);
      expect(fixture.commands.applyOriginalRecovery(hashConflictInput)).toMatchObject({
        changed: true,
        maintenance: "provider_evidence_conflict",
      });
      const secondCasePayload = JSON.parse((fixture.database.prepare(`
        SELECT error_message FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
        ORDER BY id DESC LIMIT 1
      `).get(fixture.taskId) as { error_message: string }).error_message) as Record<string, unknown>;
      expect(secondCasePayload).toMatchObject({
        event: "progressed", phase: "queued", reason: "provider_evidence_conflict", progressVersion: 2,
      });
      expect((fixture.database.prepare(`
        SELECT json_extract(error_message, '$.conflictKind') AS conflictKind
        FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1'
        ORDER BY id DESC LIMIT 1
      `).get(fixture.taskId) as { conflictKind: string }).conflictKind).toBe("evidence_hash");
      expect((fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1'
      `).get(fixture.taskId) as { count: number }).count).toBe(2);
      expect((fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'generation_recovery.case_progressed'",
      ).get() as { count: number }).count).toBe(countsBeforeConflict.audits + 2);
      expect(fixture.commands.applyOriginalRecovery(hashConflictInput)).toMatchObject({
        changed: false,
        maintenance: "provider_evidence_conflict",
      });
      expect((fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1'
      `).get(fixture.taskId) as { count: number }).count).toBe(2);
      expect((fixture.database.prepare(
        "SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'generation_recovery.case_progressed'",
      ).get() as { count: number }).count).toBe(countsBeforeConflict.audits + 2);
      const admission = newGenerationForNodeInTransaction(fixture.database, {
        ownerId,
        canvasId: fixture.canvasId,
        nodeId: fixture.nodeId,
        kind: "video",
        excludeTaskId: `other-task-${feeDisposition}`,
      });
      expect(admission).toMatchObject({ allowed: false, taskId: fixture.taskId });
    } finally {
      await closeFixture(fixture);
    }
  }
});

test("plain or incomplete evidence cannot be promoted to trusted maintenance proof", async () => {
  const fixture = await createFixture();
  try {
    const validEvidence = issueEvidence(fixture);
    const {
      adapterId: _adapterId,
      protocolContractId: _protocolContractId,
      evidenceSha256: _evidenceSha256,
      ...facts
    } = validEvidence;
    const legacyFacts = { ...facts, requestFingerprint: "e".repeat(64) };
    expect(issueAdapterVerifiedOriginalRecoveryEvidence(legacyFacts, () => ({
      adapterId: "safe-test-adapter",
      protocolContractId: "safe-test-contract-v1",
      evidenceSha256: "f".repeat(64),
    })).requestFingerprint).toBe("e".repeat(64));
    expect(() => issueAdapterVerifiedOriginalRecoveryEvidence(
      { ...facts, requestFingerprint: "intent-v3:not-a-sha256" },
      () => ({
        adapterId: "safe-test-adapter",
        protocolContractId: "safe-test-contract-v1",
        evidenceSha256: "f".repeat(64),
      }),
    )).toThrow("请求指纹无效");
    const capture = fixture.commands.captureOriginalRecovery({
      taskId: fixture.taskId, caseId: fixture.caseId, ownerId, executionAttempt: 1,
    });
    const fake = {
      taskId: fixture.taskId,
      ownerId,
      canvasId: fixture.canvasId,
      nodeId: fixture.nodeId,
      kind: "video",
      executionAttempt: 1,
      providerProfileId: "safe-profile",
      providerModelId: "safe-provider/model",
      requestFingerprint: fixture.requestFingerprint,
      providerTaskId: "provider-v4-original",
      providerState: "running",
      feeDisposition: "unknown",
      observedAt: "2026-01-01T00:00:02.000Z",
    } as unknown as OriginalProviderEvidence;
    expectRecoveryError(() => fixture.commands.applyOriginalRecovery({
      taskId: fixture.taskId, caseId: fixture.caseId, ownerId, executionAttempt: 1,
      expectedTaskUpdatedAt: capture.task.updated_at,
      expectedTaskEventWatermark: capture.taskEventWatermark,
      expectedCaseEventId: capture.caseEventId,
      expected: capture,
      evidence: fake,
      actorId: adminId,
      operationId: "fake-proof",
    }), "RECOVERY_EVIDENCE_UNTRUSTED");
  } finally {
    await closeFixture(fixture);
  }
});

test("original recovery rejects changed attempt fields and rolls back when its admin audit cannot be written", async () => {
  const mutations = [
    ["provider_profile_id", "changed-profile"], ["provider_model_id", "changed-model"],
    ["credential_revision", 9], ["created_at", "2026-01-01T00:00:01.000Z"],
    ["outcome", "completed"], ["failure_code", "CHANGED_EVIDENCE"],
    ["finished_at", "2026-01-01T00:00:01.000Z"], ["provider_task_id", "changed-provider-task"],
    ["owner_id", adminId], ["kind", "image"], ["execution_attempt", 2],
  ] as const;
  for (const [field, value] of mutations) {
    const fixture = await createFixture();
    try {
      const input = inputFor(fixture, issueEvidence(fixture), `cas-field-${field}`);
      fixture.database.prepare(`UPDATE generation_provider_attempts SET ${field} = ? WHERE task_id = ?`)
        .run(value, fixture.taskId);
      expect(() => fixture.commands.applyOriginalRecovery(input)).toThrow();
      expect((fixture.database.prepare("SELECT state FROM generation_tasks WHERE id = ?").get(fixture.taskId) as { state: string }).state).toBe("failed");
      expect((fixture.database.prepare("SELECT COUNT(*) AS n FROM generation_task_events WHERE error_code = 'RECOVERY_ORIGINAL_ONLY_V1'").get() as { n: number }).n).toBe(0);
    } finally { await closeFixture(fixture); }
  }
  const fixture = await createFixture();
  try {
    const input = inputFor(fixture, issueEvidence(fixture), "audit-failure");
    const before = JSON.stringify(fixture.database.prepare("SELECT * FROM generation_provider_attempts").all());
    fixture.database.exec(`CREATE TEMP TRIGGER reject_recovery_audit BEFORE INSERT ON admin_audit_events
      WHEN NEW.action = 'generation_recovery.original_resume'
      BEGIN SELECT RAISE(ABORT, 'synthetic audit write failure'); END`);
    expect(() => fixture.commands.applyOriginalRecovery(input)).toThrow("synthetic audit write failure");
    expect(JSON.stringify(fixture.database.prepare("SELECT * FROM generation_provider_attempts").all())).toBe(before);
    expect((fixture.database.prepare("SELECT state FROM generation_tasks WHERE id = ?").get(fixture.taskId) as { state: string }).state).toBe("failed");
    expect((fixture.database.prepare("SELECT COUNT(*) AS n FROM generation_task_events WHERE error_code = 'RECOVERY_ORIGINAL_ONLY_V1'").get() as { n: number }).n).toBe(0);
  } finally { await closeFixture(fixture); }

  const conflictFixture = await createFixture({ providerTaskId: "provider-conflict-audit" });
  try {
    const settled = issueEvidence(conflictFixture, {
      providerState: "failed", feeDisposition: "charged",
      providerTaskId: "provider-conflict-audit", evidenceSha256: "a".repeat(64),
    });
    conflictFixture.commands.applyOriginalRecovery(inputFor(conflictFixture, settled, "audit-conflict-settle"));
    const opposite = issueEvidence(conflictFixture, {
      providerState: "failed", feeDisposition: "not_charged",
      providerTaskId: "provider-conflict-audit", evidenceSha256: "b".repeat(64),
    });
    const input = inputFor(conflictFixture, opposite, "audit-conflict-register");
    const before = {
      task: conflictFixture.database.prepare(
        "SELECT state, error_code, updated_at FROM generation_tasks WHERE id = ?",
      ).get(conflictFixture.taskId),
      attempt: conflictFixture.database.prepare(
        "SELECT outcome, failure_code, finished_at FROM generation_provider_attempts WHERE task_id = ?",
      ).get(conflictFixture.taskId),
      taskEvents: (conflictFixture.database.prepare(
        "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?",
      ).get(conflictFixture.taskId) as { count: number }).count,
      caseEvents: (conflictFixture.database.prepare(
        "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'",
      ).get(conflictFixture.taskId) as { count: number }).count,
      conflictEvents: (conflictFixture.database.prepare(
        "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ? AND error_code = 'RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1'",
      ).get(conflictFixture.taskId) as { count: number }).count,
      caseAudits: (conflictFixture.database.prepare(
        "SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'generation_recovery.case_progressed'",
      ).get() as { count: number }).count,
    };
    conflictFixture.database.exec(`CREATE TEMP TRIGGER reject_conflict_recovery_audit BEFORE INSERT ON admin_audit_events
      WHEN NEW.action = 'generation_recovery.case_progressed'
      BEGIN SELECT RAISE(ABORT, 'synthetic conflict audit write failure'); END`);
    expect(() => conflictFixture.commands.applyOriginalRecovery(input))
      .toThrow("synthetic conflict audit write failure");
    expect(conflictFixture.database.prepare(
      "SELECT state, error_code, updated_at FROM generation_tasks WHERE id = ?",
    ).get(conflictFixture.taskId)).toEqual(before.task);
    expect(conflictFixture.database.prepare(
      "SELECT outcome, failure_code, finished_at FROM generation_provider_attempts WHERE task_id = ?",
    ).get(conflictFixture.taskId)).toEqual(before.attempt);
    expect((conflictFixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?",
    ).get(conflictFixture.taskId) as { count: number }).count).toBe(before.taskEvents);
    expect((conflictFixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'",
    ).get(conflictFixture.taskId) as { count: number }).count).toBe(before.caseEvents);
    expect((conflictFixture.database.prepare(
      "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ? AND error_code = 'RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1'",
    ).get(conflictFixture.taskId) as { count: number }).count).toBe(before.conflictEvents);
    expect((conflictFixture.database.prepare(
      "SELECT COUNT(*) AS count FROM admin_audit_events WHERE action = 'generation_recovery.case_progressed'",
    ).get() as { count: number }).count).toBe(before.caseAudits);
  } finally { await closeFixture(conflictFixture); }
});
