import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import {
  createGenerationTaskStore,
  type GenerationTask,
} from "../server/generationTaskStore";
import {
  createGenerationRecoveryCaseStore,
  GenerationRecoveryCaseError,
  openGenerationRecoveryCaseStore,
  generationRecoverySystemActorId,
} from "../server/generationRecoveryCaseStore";

const ownerId = "recovery-case-owner";
const adminId = "recovery-case-admin";
const takeoverAdminId = "recovery-case-admin-two";
const baseTime = "2026-01-01T00:00:00.000Z";

function seedUser(database: ReturnType<typeof openAppDatabase>, id: string, role: "admin" | "user") {
  database.prepare(`
    INSERT OR IGNORE INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'safe-test', ?, 'active', ?, ?)
  `).run(id, id, id, role, baseTime, baseTime);
}

async function createFixture(options: Readonly<{ attemptRow?: boolean; suffix?: string }> = {}) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-recovery-case-"));
  const database = openAppDatabase(dataDirectory);
  seedUser(database, ownerId, "user");
  seedUser(database, adminId, "admin");
  seedUser(database, takeoverAdminId, "admin");
  database.close();

  const taskStore = createGenerationTaskStore(dataDirectory, { recoverRunning: false });
  const created = taskStore.create({
    canvasId: `recovery-case-canvas-${options.suffix ?? "one"}`,
    idempotencyKey: `recovery-case-key-${options.suffix ?? "one"}`,
    kind: "video",
    model: "recovery-case-model",
    modelConfiguration: { providerProtocol: "media-generate", providerDriver: "multi-protocol-relay" },
    nodeId: `recovery-case-node-${options.suffix ?? "one"}`,
    ownerId,
    parameters: { safeFixture: true },
    prompt: "safe recovery case fixture",
    providerModelId: "recovery-case-provider-model",
    providerProfileId: "recovery-case-provider",
  }).task;
  taskStore.close();

  const prepared = openAppDatabase(dataDirectory);
  prepared.prepare(`
    UPDATE generation_tasks
    SET state = 'failed', attempt = 1,
        error_code = 'OUTCOME_UNKNOWN_BILLING_RISK',
        created_at = ?, updated_at = ?
    WHERE id = ?
  `).run(baseTime, baseTime, created.id);
  if (options.attemptRow !== false) {
    prepared.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, created_at, owner_id, credential_revision, outcome
      ) VALUES (?, 1, ?, ?, 'video', 'provider-boundary', ?, ?, 0, 'outcome-unknown')
    `).run(
      created.id,
      "recovery-case-provider",
      "recovery-case-provider-model",
      baseTime,
      ownerId,
    );
  }
  prepared.close();

  const recovery = openGenerationRecoveryCaseStore(dataDirectory, { enabled: true });
  return { dataDirectory, recovery, task: created };
}

function expectRecoveryError(action: () => unknown, code: string) {
  try {
    action();
    throw new Error("expected recovery error");
  } catch (error) {
    if (error instanceof Error && error.message === "expected recovery error") throw error;
    expect(error).toBeInstanceOf(GenerationRecoveryCaseError);
    expect((error as GenerationRecoveryCaseError).code).toBe(code);
  }
}

function caseInput(task: GenerationTask, operationId: string, now = baseTime) {
  return {
    taskId: task.id,
    ownerId,
    executionAttempt: 1,
    reason: "outcome_unknown" as const,
    operationId,
    now,
  };
}

test("recovery cases deduplicate by task attempt without changing the task timestamp", async () => {
  const fixture = await createFixture();
  try {
    const first = fixture.recovery.ensureCase(caseInput(fixture.task, "open-one"));
    const second = fixture.recovery.ensureCase(caseInput(fixture.task, "open-replay"));
    expect(second.caseId).toBe(first.caseId);
    expect(second.eventId).toBe(first.eventId);
    expect(first.openedAt).toBe(baseTime);
    expect(second.task.updatedAt).toBe(baseTime);
    expect(fixture.recovery.list({ limit: 10 }).items).toHaveLength(1);
    expect(fixture.recovery.hasOriginalOnly(fixture.task.id, 1)).toBe(false);

    fixture.recovery.closeDatabase();
    const database = openAppDatabase(fixture.dataDirectory);
    const counts = database.prepare(`
      SELECT error_code, COUNT(*) AS count
      FROM generation_task_events
      WHERE task_id = ?
      GROUP BY error_code
      ORDER BY error_code
    `).all(fixture.task.id) as Array<{ error_code: string | null; count: number }>;
    expect(counts).toContainEqual({ error_code: "RECOVERY_CASE_V1", count: 1 });
    expect(counts.some((row) => row.error_code === "RECOVERY_ORIGINAL_ONLY_V1")).toBe(false);
    database.close();

    const reopened = openGenerationRecoveryCaseStore(fixture.dataDirectory, { enabled: true });
    expect(reopened.getByTaskAttempt(fixture.task.id, 1).caseId).toBe(first.caseId);
    reopened.closeDatabase();
  } finally {
    await rm(fixture.dataDirectory, { force: true, recursive: true });
  }
});

test("claim, backoff and result progress use the case fence while owner read acknowledgement is separate", async () => {
  const fixture = await createFixture();
  try {
    const opened = fixture.recovery.ensureCase(caseInput(fixture.task, "open-cas"));
    const claimed = fixture.recovery.claim({
      ...opened,
      taskId: fixture.task.id,
      ownerId,
      actorId: adminId,
      operationId: "claim-one",
      expectedCaseEventId: opened.eventId,
      expectedCaseRevision: opened.caseRevision,
      now: "2026-01-01T00:00:01.000Z",
    });
    expect(claimed.phase).toBe("claimed");
    expectRecoveryError(() => fixture.recovery.claim({
      ...claimed,
      taskId: fixture.task.id,
      ownerId,
      actorId: adminId,
      operationId: "claim-stale",
      expectedCaseEventId: opened.eventId,
      expectedCaseRevision: opened.caseRevision,
      now: "2026-01-01T00:00:02.000Z",
    }), "RECOVERY_CASE_CONFLICT");

    const checked = fixture.recovery.recordCheck({
      ...claimed,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "check-one",
      expectedCaseEventId: claimed.eventId,
      expectedCaseRevision: claimed.caseRevision,
      outcome: "no_match",
      now: "2026-01-01T00:00:03.000Z",
    });
    expect(checked.checkCount).toBe(1);
    expect(checked.progressVersion).toBe(claimed.progressVersion);
    expect(checked.nextCheckAt).toBe("2026-01-01T00:00:33.000Z");
    expectRecoveryError(() => fixture.recovery.recordCheck({
      ...checked,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "check-too-early",
      expectedCaseEventId: checked.eventId,
      expectedCaseRevision: checked.caseRevision,
      outcome: "still_running",
      now: "2026-01-01T00:00:10.000Z",
    }), "RECOVERY_CASE_NOT_DUE");

    const recovered = fixture.recovery.recordCheck({
      ...checked,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "check-result",
      expectedCaseEventId: checked.eventId,
      expectedCaseRevision: checked.caseRevision,
      outcome: "result_found",
      phase: "result_recovered",
      evidenceRef: { kind: "task_event", eventId: 1, sha256: "a".repeat(64) },
      now: "2026-01-01T00:00:34.000Z",
    });
    expect(recovered.phase).toBe("result_recovered");
    expect(recovered.progressVersion).toBe(claimed.progressVersion + 1);
    const read = fixture.recovery.acknowledge({
      ...recovered,
      taskId: fixture.task.id,
      ownerId,
      actorId: ownerId,
      operationId: "read-one",
      expectedCaseEventId: recovered.eventId,
      expectedCaseRevision: recovered.caseRevision,
      expectedProgressVersion: recovered.progressVersion,
      now: "2026-01-01T00:00:35.000Z",
    });
    expect(read.lastReadProgressVersion).toBe(recovered.progressVersion);
    expect(read.progressVersion).toBe(recovered.progressVersion);
    expect(read.progressAt).toBe(recovered.progressAt);
  } finally {
    fixture.recovery.closeDatabase();
    await rm(fixture.dataDirectory, { force: true, recursive: true });
  }
});

test("an expired claim can be renewed by its owner and explicitly taken over after the takeover window", async () => {
  const fixture = await createFixture({ suffix: "claim-expiry" });
  try {
    const opened = fixture.recovery.ensureCase(caseInput(fixture.task, "claim-expiry-open"));
    const first = fixture.recovery.claim({
      ...opened,
      taskId: fixture.task.id,
      ownerId,
      actorId: adminId,
      operationId: "claim-expiry-first",
      expectedCaseEventId: opened.eventId,
      expectedCaseRevision: opened.caseRevision,
      now: "2026-01-01T00:00:01.000Z",
    });
    const renewed = fixture.recovery.claim({
      ...first,
      taskId: fixture.task.id,
      ownerId,
      actorId: adminId,
      operationId: "claim-expiry-renewed",
      expectedCaseEventId: first.eventId,
      expectedCaseRevision: first.caseRevision,
      now: "2026-01-01T00:16:00.000Z",
    });
    expect(renewed.eventId).toBeGreaterThan(first.eventId);
    expect(renewed.claimedBy).toBe(adminId);
    expect(renewed.claimLeaseUntil).toBe("2026-01-01T00:31:00.000Z");
    expectRecoveryError(() => fixture.recovery.claim({
      ...renewed,
      taskId: fixture.task.id,
      ownerId,
      actorId: takeoverAdminId,
      operationId: "claim-expiry-too-early",
      expectedCaseEventId: renewed.eventId,
      expectedCaseRevision: renewed.caseRevision,
      now: "2026-01-02T00:15:59.000Z",
    }), "RECOVERY_CASE_CONFLICT");
    const takeover = fixture.recovery.claim({
      ...renewed,
      taskId: fixture.task.id,
      ownerId,
      actorId: takeoverAdminId,
      operationId: "claim-expiry-takeover",
      expectedCaseEventId: renewed.eventId,
      expectedCaseRevision: renewed.caseRevision,
      now: "2026-01-02T00:16:01.000Z",
    });
    expect(takeover.claimedBy).toBe(takeoverAdminId);
    expect(takeover.caseRevision).toBe(renewed.caseRevision + 1);
  } finally {
    fixture.recovery.closeDatabase();
    await rm(fixture.dataDirectory, { force: true, recursive: true });
  }
});

test("an expired inspection lease only accepts query_failed cleanup and derives window expiry from the clock", async () => {
  const fixture = await createFixture({ suffix: "inspection-expiry" });
  try {
    let current = fixture.recovery.ensureCase(caseInput(fixture.task, "inspection-expiry-open"));
    const inspectionStart = "2026-01-02T02:00:00.000Z";
    current = fixture.recovery.beginInspection({
      ...current,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "inspection-expiry-start-1",
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      now: inspectionStart,
    });
    const leaseId = current.inspectionLeaseId!;
    expectRecoveryError(() => fixture.recovery.finishInspection({
      ...current,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "inspection-expiry-late-result",
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      inspectionLeaseId: leaseId,
      outcome: "result_found",
      evidenceRef: { kind: "task_event", eventId: 1, sha256: "b".repeat(64) },
      now: "2026-01-02T02:00:11.000Z",
    }), "RECOVERY_CASE_CONFLICT");
    current = fixture.recovery.finishInspection({
      ...current,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "inspection-expiry-query-failed",
      retryAfterAt: "2026-01-02T02:00:12.000Z",
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      inspectionLeaseId: leaseId,
      outcome: "query_failed",
      now: "2026-01-02T02:00:11.000Z",
    });
    expect(current.checkOutcome).toBe("query_failed");
    expect(current.inspectionUsed).toBe(1);
    expect(current.nextCheckAt).toBe("2026-01-02T02:00:41.000Z");
    current = fixture.recovery.beginInspection({
      ...current,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "inspection-expiry-start-2",
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      now: "2026-01-02T02:01:00.000Z",
    });
    expectRecoveryError(() => fixture.recovery.finishInspection({
      ...current,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "inspection-expiry-not-checked",
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      inspectionLeaseId: current.inspectionLeaseId!,
      outcome: "not_checked",
      now: "2026-01-02T02:01:01.000Z",
    }), "RECOVERY_INVALID_COMMAND");
    const expired = fixture.recovery.finishInspection({
      ...current,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "inspection-expiry-window",
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      inspectionLeaseId: current.inspectionLeaseId!,
      outcome: "result_found",
      evidenceRef: { kind: "task_event", eventId: 1, sha256: "c".repeat(64) },
      now: "2026-01-03T02:00:00.000Z",
    });
    expect(expired.checkOutcome).toBe("window_expired");
    expect(expired.inspectionUsed).toBe(2);
    expect(expired.evidenceRef).toBeUndefined();
  } finally {
    fixture.recovery.closeDatabase();
    await rm(fixture.dataDirectory, { force: true, recursive: true });
  }
});

test("missing attempt evidence creates a visible case without inventing a time budget", async () => {
  const fixture = await createFixture({ attemptRow: false, suffix: "missing" });
  try {
    const missing = fixture.recovery.ensureCase({
      ...caseInput(fixture.task, "missing-open"),
      reason: "missing_attempt_evidence",
    });
    expect(missing.attemptStartedAt).toBeUndefined();
    expect(missing.automaticDeadlineAt).toBeUndefined();
    expect(missing.nextCheckAt).toBeUndefined();
    expect(missing.inspectionUsed).toBe(0);
    expectRecoveryError(() => fixture.recovery.beginInspection({
      ...missing,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "missing-check",
      expectedCaseEventId: missing.eventId,
      expectedCaseRevision: missing.caseRevision,
    }), "RECOVERY_CASE_CONFLICT");
  } finally {
    fixture.recovery.closeDatabase();
    await rm(fixture.dataDirectory, { force: true, recursive: true });
  }
});

test("ensureCase rejects stale attempts and tasks whose execution or Provider attempt is already terminal", async () => {
  const fixture = await createFixture({ suffix: "ensure-guards" });
  let recovery = fixture.recovery;
  try {
    expectRecoveryError(() => recovery.ensureCase({
      ...caseInput(fixture.task, "ensure-wrong-attempt"),
      executionAttempt: 2,
    }), "RECOVERY_CASE_CONFLICT");
    recovery.closeDatabase();
    const database = openAppDatabase(fixture.dataDirectory);
    database.prepare(`
      UPDATE generation_provider_attempts
      SET outcome = 'provider-failed', failure_code = 'PROVIDER_NOT_ACCEPTED_NO_CHARGE',
          finished_at = ?
      WHERE task_id = ? AND execution_attempt = 1
    `).run("2026-01-01T00:00:01.000Z", fixture.task.id);
    database.close();
    recovery = openGenerationRecoveryCaseStore(fixture.dataDirectory, { enabled: true });
    expectRecoveryError(() => recovery.ensureCase(caseInput(fixture.task, "ensure-terminal-provider")), "RECOVERY_CASE_CONFLICT");

    recovery.closeDatabase();
    const terminalDatabase = openAppDatabase(fixture.dataDirectory);
    terminalDatabase.prepare(`
      UPDATE generation_tasks SET state = 'success', result_text = 'already saved'
      WHERE id = ?
    `).run(fixture.task.id);
    terminalDatabase.close();
    recovery = openGenerationRecoveryCaseStore(fixture.dataDirectory, { enabled: true });
    expectRecoveryError(() => recovery.ensureCase(caseInput(fixture.task, "ensure-success-task")), "RECOVERY_CASE_CONFLICT");
  } finally {
    recovery.closeDatabase();
    await rm(fixture.dataDirectory, { force: true, recursive: true });
  }
});

test("terminal publication or projection quarantine requires a real ledger conflict and never mutates the task", async () => {
  for (const ledger of ["publication", "projection"] as const) {
    const fixture = await createFixture({ suffix: `terminal-quarantine-${ledger}` });
    let recovery = fixture.recovery;
    try {
      expect(recovery.ensurePublicationQuarantineCase({
        taskId: fixture.task.id,
        ownerId,
        executionAttempt: 1,
        operationId: `quarantine-before-${ledger}`,
        now: "2026-01-01T00:00:01.000Z",
      })).toBeUndefined();

      recovery.closeDatabase();
      const database = openAppDatabase(fixture.dataDirectory);
      database.prepare(`
        UPDATE generation_provider_attempts
        SET outcome = 'completed', finished_at = ?
        WHERE task_id = ? AND execution_attempt = 1
      `).run("2026-01-01T00:00:01.000Z", fixture.task.id);
      if (ledger === "publication") {
        database.prepare(`
          INSERT INTO media_publication_attempts (
            attempt_id, owner_id, kind, asset_id, source, state,
            storage_backend, final_storage_name, object_key, staging_name,
            task_id, task_execution_attempt, content_type, created_at, updated_at,
            error_code
          ) VALUES (?, ?, 'video', ?, 'generation', 'failed', 'local', ?, ?, ?,
            ?, 1, 'video/mp4', ?, ?, 'OSS_IDENTITY_QUARANTINED')
        `).run(
          `quarantine-publication-${fixture.task.id}`,
          ownerId,
          `quarantine-asset-${fixture.task.id}`,
          `quarantine-asset-${fixture.task.id}.mp4`,
          `safe/quarantine-asset-${fixture.task.id}.mp4`,
          `.quarantine-${fixture.task.id}.generating`,
          fixture.task.id,
          baseTime,
          baseTime,
        );
      } else {
        database.prepare(`
          INSERT INTO canvas_documents (
            owner_id, id, revision, graph_revision, nodes, edges, viewport,
            updated_at, save_session_id, save_sequence
          ) VALUES (?, ?, 1, 1, '[]', '[]', '{}', ?, ?, 0)
        `).run(ownerId, fixture.task.canvasId, baseTime, `quarantine-${fixture.task.id}`);
        database.prepare(`
          INSERT INTO generation_canvas_projection_states (
            task_id, owner_id, canvas_id, operation_id, state, failure_count,
            last_error_class, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'conflict', 0, NULL, ?, ?)
        `).run(
          fixture.task.id,
          ownerId,
          fixture.task.canvasId,
          `quarantine-projection-${fixture.task.id}`,
          baseTime,
          baseTime,
        );
      }
      const taskBefore = database.prepare(`
        SELECT task.state, task.attempt, task.error_code, task.updated_at,
          task.result_asset_id, task.result_text, attempt.outcome,
          attempt.failure_code, attempt.finished_at
        FROM generation_tasks AS task
        JOIN generation_provider_attempts AS attempt
          ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
        WHERE task.id = ?
      `).get(fixture.task.id);
      const caseEventsBefore = (database.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
      `).get(fixture.task.id) as { count: number }).count;
      database.close();

      recovery = openGenerationRecoveryCaseStore(fixture.dataDirectory, { enabled: true });
      const quarantined = recovery.ensurePublicationQuarantineCase({
        taskId: fixture.task.id,
        ownerId,
        executionAttempt: 1,
        operationId: `quarantine-${ledger}`,
        now: "2026-01-01T00:00:02.000Z",
      });
      expect(quarantined).toMatchObject({
        phase: "queued",
        reason: "provider_evidence_conflict",
        checkOutcome: "not_checked",
      });
      expect(quarantined?.progressVersion).toBe(0);
      expectRecoveryError(() => recovery.ensureCase(
        caseInput(fixture.task, `ordinary-terminal-${ledger}`),
      ), "RECOVERY_CASE_CONFLICT");

      const replay = recovery.ensurePublicationQuarantineCase({
        taskId: fixture.task.id,
        ownerId,
        executionAttempt: 1,
        operationId: `quarantine-replay-${ledger}`,
        now: "2026-01-01T00:00:03.000Z",
      });
      expect(replay?.eventId).toBe(quarantined?.eventId);
      const after = openAppDatabase(fixture.dataDirectory);
      const taskAfter = after.prepare(`
        SELECT task.state, task.attempt, task.error_code, task.updated_at,
          task.result_asset_id, task.result_text, attempt.outcome,
          attempt.failure_code, attempt.finished_at
        FROM generation_tasks AS task
        JOIN generation_provider_attempts AS attempt
          ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
        WHERE task.id = ?
      `).get(fixture.task.id);
      const caseEventsAfter = (after.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
      `).get(fixture.task.id) as { count: number }).count;
      expect(taskAfter).toEqual(taskBefore);
      expect(caseEventsAfter).toBe(caseEventsBefore + 1);
      after.close();
    } finally {
      recovery.closeDatabase();
      await rm(fixture.dataDirectory, { force: true, recursive: true });
    }
  }
});

test("a local publication conflict escalates an existing operator case without reopening the task or adding a Provider conflict event", async () => {
  const fixture = await createFixture({ suffix: "operator-quarantine-escalation" });
  let recovery = fixture.recovery;
  try {
    const opened = recovery.ensureCase({
      ...caseInput(fixture.task, "operator-incident-open"),
      reason: "operator_incident",
    });
    const claimed = recovery.claim({
      ...opened,
      taskId: fixture.task.id,
      ownerId,
      actorId: adminId,
      operationId: "operator-incident-claim",
      expectedCaseEventId: opened.eventId,
      expectedCaseRevision: opened.caseRevision,
      now: "2026-01-01T00:00:01.000Z",
    });
    const inspected = recovery.beginInspection({
      ...claimed,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "operator-incident-inspection",
      expectedCaseEventId: claimed.eventId,
      expectedCaseRevision: claimed.caseRevision,
      now: "2026-01-02T02:00:00.000Z",
    });
    expect(inspected.inspectionStarted).toBe(true);
    expect(inspected.inspectionUsed).toBe(1);

    recovery.closeDatabase();
    const database = openAppDatabase(fixture.dataDirectory);
    database.prepare(`
      UPDATE generation_provider_attempts
      SET outcome = 'completed', finished_at = ?
      WHERE task_id = ? AND execution_attempt = 1
    `).run("2026-01-02T02:00:01.000Z", fixture.task.id);
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        task_id, task_execution_attempt, content_type, created_at, updated_at,
        error_code
      ) VALUES (?, ?, 'video', ?, 'generation', 'failed', 'local', ?, ?, ?,
        ?, 1, 'video/mp4', ?, ?, 'OSS_IDENTITY_QUARANTINED')
    `).run(
      `operator-quarantine-publication-${fixture.task.id}`,
      ownerId,
      `operator-quarantine-asset-${fixture.task.id}`,
      `operator-quarantine-asset-${fixture.task.id}.mp4`,
      `safe/operator-quarantine-asset-${fixture.task.id}.mp4`,
      `.operator-quarantine-${fixture.task.id}.generating`,
      fixture.task.id,
      baseTime,
      baseTime,
    );
    const taskBefore = database.prepare(`
      SELECT task.state, task.attempt, task.error_code, task.updated_at,
        task.result_asset_id, task.result_text, attempt.outcome,
        attempt.failure_code, attempt.finished_at
      FROM generation_tasks AS task
      JOIN generation_provider_attempts AS attempt
        ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
      WHERE task.id = ?
    `).get(fixture.task.id);
    database.close();

    recovery = openGenerationRecoveryCaseStore(fixture.dataDirectory, { enabled: true });
    const escalated = recovery.ensurePublicationQuarantineCase({
      taskId: fixture.task.id,
      ownerId,
      executionAttempt: 1,
      operationId: "operator-quarantine-escalation",
      now: "2026-01-02T02:00:02.000Z",
    });
    expect(escalated).toMatchObject({
      caseId: inspected.caseId,
      phase: "queued",
      reason: "provider_evidence_conflict",
      checkOutcome: "not_checked",
      inspectionUsed: inspected.inspectionUsed,
      attemptStartedAt: inspected.attemptStartedAt,
      providerWindowMs: inspected.providerWindowMs,
      automaticDeadlineAt: inspected.automaticDeadlineAt,
    });
    expect(escalated?.caseRevision).toBe(inspected.caseRevision + 1);
    expect(escalated?.progressVersion).toBe(inspected.progressVersion + 1);
    expect(escalated?.inspectionStartedAt).toBe(inspected.inspectionStartedAt);
    expect(escalated?.inspectionDeadlineAt).toBe(inspected.inspectionDeadlineAt);
    expect(escalated?.claimedBy).toBeUndefined();
    expect(escalated?.claimLeaseId).toBeUndefined();
    expect(escalated?.claimLeaseUntil).toBeUndefined();
    expect(escalated?.inspectionLeaseId).toBeUndefined();
    expect(escalated?.inspectionLeaseUntil).toBeUndefined();
    expect(escalated?.nextCheckAt).toBeUndefined();

    const replay = recovery.ensurePublicationQuarantineCase({
      taskId: fixture.task.id,
      ownerId,
      executionAttempt: 1,
      operationId: "operator-quarantine-escalation-replay",
      now: "2026-01-02T02:00:03.000Z",
    });
    expect(replay?.caseId).toBe(escalated?.caseId);
    expect(replay?.eventId).toBe(escalated?.eventId);
    expect(replay?.caseRevision).toBe(escalated?.caseRevision);

    const after = openAppDatabase(fixture.dataDirectory);
    const taskAfter = after.prepare(`
      SELECT task.state, task.attempt, task.error_code, task.updated_at,
        task.result_asset_id, task.result_text, attempt.outcome,
        attempt.failure_code, attempt.finished_at
      FROM generation_tasks AS task
      JOIN generation_provider_attempts AS attempt
        ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
      WHERE task.id = ?
    `).get(fixture.task.id);
    const caseEvents = after.prepare(`
      SELECT error_message FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
      ORDER BY id ASC
    `).all(fixture.task.id) as Array<{ error_message: string }>;
    const conflictEvents = (after.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1'
    `).get(fixture.task.id) as { count: number }).count;
    expect(taskAfter).toEqual(taskBefore);
    expect(caseEvents).toHaveLength(4);
    expect(new Set(caseEvents.map(({ error_message }) => JSON.parse(error_message).caseId)).size).toBe(1);
    expect(caseEvents.filter(({ error_message }) => JSON.parse(error_message).event === "opened")).toHaveLength(1);
    expect(caseEvents.filter(({ error_message }) => JSON.parse(error_message).reason === "provider_evidence_conflict")).toHaveLength(1);
    expect(conflictEvents).toBe(0);
    after.close();
  } finally {
    recovery.closeDatabase();
    await rm(fixture.dataDirectory, { force: true, recursive: true });
  }
});

test("a malformed case event is reported for its task while other cases remain listable", async () => {
  const first = await createFixture({ suffix: "corrupt-first" });
  const second = await createFixture({ suffix: "corrupt-second" });
  let reopenedFirst: ReturnType<typeof openGenerationRecoveryCaseStore> | undefined;
  try {
    const firstCase = first.recovery.ensureCase(caseInput(first.task, "corrupt-open"));
    const secondCase = second.recovery.ensureCase(caseInput(second.task, "healthy-open"));
    first.recovery.closeDatabase();
    const database = openAppDatabase(first.dataDirectory);
    database.prepare(`
      INSERT INTO generation_task_events (
        task_id, state, error_code, error_message, created_at
      ) VALUES (?, 'failed', 'RECOVERY_CASE_V1', '{', ?)
    `).run(first.task.id, "2026-01-01T00:00:01.000Z");
    database.close();

    second.recovery.closeDatabase();
    const healthyDatabase = openAppDatabase(second.dataDirectory);
    const healthyStore = createGenerationRecoveryCaseStore(healthyDatabase, { enabled: true });
    const listed = healthyStore.list({ limit: 10 });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.caseId).toBe(secondCase.caseId);
    expect(firstCase.caseId).not.toBe(secondCase.caseId);
    expect(listed.corrupt ?? []).toHaveLength(0);
    healthyStore.getTaskEventWatermark(second.task.id);
    healthyDatabase.close();
    // The malformed task is isolated by its own list call; it does not make
    // the store crash while healthy tasks are read.
    reopenedFirst = openGenerationRecoveryCaseStore(first.dataDirectory, { enabled: true });
    const corruptListed = reopenedFirst.list({ limit: 10 });
    expect(corruptListed.items).toHaveLength(0);
    expect(corruptListed.corrupt?.[0]).toMatchObject({
      taskId: first.task.id,
      reason: "invalid_event",
    });
  } finally {
    reopenedFirst?.closeDatabase();
    await rm(first.dataDirectory, { force: true, recursive: true });
    await rm(second.dataDirectory, { force: true, recursive: true });
  }
});

test("case event counters and phase transitions are validated before a history is exposed", async () => {
  const fixture = await createFixture({ suffix: "relation" });
  try {
    fixture.recovery.ensureCase(caseInput(fixture.task, "relation-open"));
    fixture.recovery.closeDatabase();
    const database = openAppDatabase(fixture.dataDirectory);
    const opening = database.prepare(`
      SELECT error_message FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
      ORDER BY id ASC LIMIT 1
    `).get(fixture.task.id) as { error_message: string };
    const payload = JSON.parse(opening.error_message) as Record<string, unknown>;
    database.prepare(`
      INSERT INTO generation_task_events (
        task_id, state, error_code, error_message, created_at
      ) VALUES (?, 'failed', 'RECOVERY_CASE_V1', ?, ?)
    `).run(
      fixture.task.id,
      JSON.stringify({
        ...payload,
        event: "checked",
        caseRevision: 2,
        operationId: "relation-invalid-check",
        actorId: generationRecoverySystemActorId,
        checkCount: 0,
        checkOutcome: "no_match",
        lastCheckedAt: "2026-01-01T00:00:01.000Z",
      }),
      "2026-01-01T00:00:01.000Z",
    );
    database.close();
    const reopened = openGenerationRecoveryCaseStore(fixture.dataDirectory, { enabled: true });
    try {
      expectRecoveryError(() => reopened.getByTaskAttempt(fixture.task.id, 1), "RECOVERY_CASE_CORRUPT");
    } finally {
      reopened.closeDatabase();
    }
  } finally {
    // The reopened store owns the connection after the malformed-history read.
    // Closing the original is harmless only when the read above did not throw
    // before it was replaced, so guard the already-closed connection here.
    try { fixture.recovery.closeDatabase(); } catch { /* already closed */ }
    await rm(fixture.dataDirectory, { force: true, recursive: true });
  }
});

test("the case list rotates through more than 200 cases with an opaque cursor", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-recovery-page-"));
  let recovery: ReturnType<typeof openGenerationRecoveryCaseStore> | undefined;
  try {
    const database = openAppDatabase(dataDirectory);
    seedUser(database, ownerId, "user");
    seedUser(database, adminId, "admin");
    database.close();
    const taskStore = createGenerationTaskStore(dataDirectory, { recoverRunning: false });
    const tasks: GenerationTask[] = [];
    for (let index = 0; index < 205; index += 1) {
      tasks.push(taskStore.create({
        canvasId: `recovery-page-canvas-${index}`,
        idempotencyKey: `recovery-page-key-${index}`,
        kind: "video",
        model: "recovery-page-model",
        nodeId: `recovery-page-node-${index}`,
        ownerId,
        parameters: { safeFixture: true },
        prompt: "safe recovery page fixture",
        providerModelId: "recovery-page-provider-model",
        providerProfileId: "recovery-page-provider",
      }).task);
    }
    taskStore.close();
    const prepared = openAppDatabase(dataDirectory);
    for (const task of tasks) {
      prepared.prepare(`
        UPDATE generation_tasks
        SET state = 'failed', attempt = 1, error_code = 'OUTCOME_UNKNOWN_BILLING_RISK',
            created_at = ?, updated_at = ?
        WHERE id = ?
      `).run(baseTime, baseTime, task.id);
      prepared.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, provider_profile_id, provider_model_id,
          kind, evidence, created_at, owner_id, credential_revision, outcome
        ) VALUES (?, 1, 'recovery-page-provider', 'recovery-page-provider-model',
                  'video', 'provider-boundary', ?, ?, 0, 'outcome-unknown')
      `).run(task.id, baseTime, ownerId);
    }
    prepared.close();
    recovery = openGenerationRecoveryCaseStore(dataDirectory, { enabled: true });
    const recoveryStore = recovery;
    if (!recoveryStore) throw new Error("recovery store was not opened");
    for (const [index, task] of tasks.entries()) {
      recoveryStore.ensureCase(caseInput(
        task,
        `page-open-${index}`,
        index === 0 ? baseTime : "2026-01-02T00:00:00.000Z",
      ));
    }
    const first = recoveryStore.list({ limit: 200 });
    expect(first.items).toHaveLength(200);
    expect(first.nextCursor).toBeTruthy();
    const second = recoveryStore.list({ limit: 200, cursor: first.nextCursor });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.items, ...second.items].map((item) => item.caseId)).size).toBe(205);

    const adminFirst = recoveryStore.list({
      limit: 1,
      now: "2026-01-02T12:00:00.000Z",
      order: "admin",
    });
    expect(adminFirst.items[0]?.taskId).toBe(tasks[0]?.id);
    expect(adminFirst.items[0]?.openedAt).toBe(baseTime);
    expect(adminFirst.nextCursor).toBeTruthy();
    const adminSecond = recoveryStore.list({
      limit: 1,
      cursor: adminFirst.nextCursor,
      order: "admin",
      now: "2026-01-02T12:00:00.000Z",
    });
    expect(adminSecond.items[0]?.taskId).not.toBe(tasks[0]?.id);
    expectRecoveryError(
      () => recoveryStore.list({ limit: 1, cursor: adminFirst.nextCursor }),
      "RECOVERY_INVALID_COMMAND",
    );
  } finally {
    recovery?.closeDatabase();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("post-window inspection consumes at most twelve durable reads and keeps one in flight", async () => {
  const fixture = await createFixture({ suffix: "inspection" });
  const inspectionStart = Date.parse("2026-01-02T02:00:00.000Z");
  try {
    let current = fixture.recovery.ensureCase(caseInput(fixture.task, "inspection-open"));
    current = fixture.recovery.beginInspection({
      ...current,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "inspection-start-1",
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      now: new Date(inspectionStart).toISOString(),
    });
    expect(current.inspectionUsed).toBe(1);
    expect(current.inspectionLeaseId).toBeTruthy();
    expectRecoveryError(() => fixture.recovery.beginInspection({
      ...current,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "inspection-start-race",
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      now: new Date(inspectionStart + 1_000).toISOString(),
    }), "RECOVERY_CASE_CONFLICT");
    current = fixture.recovery.finishInspection({
      ...current,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "inspection-finish-1",
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      inspectionLeaseId: current.inspectionLeaseId!,
      outcome: "no_match",
      now: new Date(inspectionStart + 2_000).toISOString(),
    });
    expect(current.inspectionUsed).toBe(1);
    expect(current.inspectionLeaseId).toBeUndefined();
    expect(current.checkCount).toBe(1);
    expect(current.nextCheckAt).toBe("2026-01-02T02:00:32.000Z");
    let nextMinute = inspectionStart + 2 * 60_000;
    for (let index = 2; index <= 12; index += 1) {
      const dueAt = current.nextCheckAt ? Date.parse(current.nextCheckAt) : nextMinute;
      const timestampMilliseconds = Math.max(nextMinute, dueAt + 1_000);
      const timestamp = new Date(timestampMilliseconds).toISOString();
      current = fixture.recovery.beginInspection({
        ...current,
        taskId: fixture.task.id,
        ownerId,
        actorId: generationRecoverySystemActorId,
        operationId: `inspection-start-${index}`,
        expectedCaseEventId: current.eventId,
        expectedCaseRevision: current.caseRevision,
        now: timestamp,
      });
      current = fixture.recovery.finishInspection({
        ...current,
        taskId: fixture.task.id,
        ownerId,
        actorId: generationRecoverySystemActorId,
        operationId: `inspection-finish-${index}`,
        expectedCaseEventId: current.eventId,
        expectedCaseRevision: current.caseRevision,
        inspectionLeaseId: current.inspectionLeaseId!,
        outcome: "no_match",
        now: new Date(Date.parse(timestamp) + 1_000).toISOString(),
      });
      nextMinute = timestampMilliseconds + 60_000;
    }
    expect(current.inspectionUsed).toBe(12);
    expectRecoveryError(() => fixture.recovery.beginInspection({
      ...current,
      taskId: fixture.task.id,
      ownerId,
      actorId: generationRecoverySystemActorId,
      operationId: "inspection-start-13",
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      now: new Date(Date.parse(current.nextCheckAt!) + 1_000).toISOString(),
    }), "RECOVERY_CASE_CONFLICT");
  } finally {
    fixture.recovery.closeDatabase();
    await rm(fixture.dataDirectory, { force: true, recursive: true });
  }
});

test("settleFromTask derives a saved success once, publishes unread progress, and leaves the task timestamp unchanged", async () => {
  const fixture = await createFixture({ suffix: "settle-success" });
  let recovery = fixture.recovery;
  try {
    const opened = recovery.ensureCase(caseInput(fixture.task, "settle-success-open"));
    recovery.closeDatabase();
    const database = openAppDatabase(fixture.dataDirectory);
    database.prepare(`
      UPDATE generation_tasks
      SET state = 'success', result_text = 'saved recovery result', error_code = NULL,
          error_message = NULL
      WHERE id = ?
    `).run(fixture.task.id);
    database.prepare(`
      INSERT INTO generation_task_events (task_id, state, error_code, error_message, created_at)
      VALUES (?, 'success', NULL, NULL, ?)
    `).run(fixture.task.id, "2026-01-01T00:00:02.000Z");
    database.close();
    recovery = openGenerationRecoveryCaseStore(fixture.dataDirectory, { enabled: true });
    const current = recovery.getByTaskAttempt(fixture.task.id, 1);
    const watermark = recovery.getTaskEventWatermark(fixture.task.id);
    const fence = {
      taskId: fixture.task.id,
      ownerId,
      caseId: current.caseId,
      executionAttempt: 1,
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      expectedTaskEventWatermark: watermark,
      actorId: generationRecoverySystemActorId,
      operationId: "settle-success-one",
      now: "2026-01-01T00:00:03.000Z",
    } as const;
    const settled = recovery.settleFromTask(fence);
    expect(settled.phase).toBe("result_recovered");
    expect(settled.checkOutcome).toBe("result_found");
    expect(settled.progressVersion).toBe(current.progressVersion + 1);
    expect(settled.checkCount).toBe(current.checkCount + 1);
    expect(settled.evidenceRef).toMatchObject({ kind: "task_event" });
    expect(settled.nextCheckAt).toBeUndefined();
    expect(settled.inspectionLeaseId).toBeUndefined();
    expect(settled.claimLeaseId).toBeUndefined();
    const replay = recovery.settleFromTask(fence);
    expect(replay.eventId).toBe(settled.eventId);
    expect(replay.caseRevision).toBe(settled.caseRevision);

    recovery.closeDatabase();
    const checked = openAppDatabase(fixture.dataDirectory);
    const taskRow = checked.prepare(`
      SELECT updated_at FROM generation_tasks WHERE id = ?
    `).get(fixture.task.id) as { updated_at: string };
    const recoveryCount = checked.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
    `).get(fixture.task.id) as { count: number };
    expect(taskRow.updated_at).toBe(baseTime);
    expect(recoveryCount.count).toBe(2);
    checked.close();
    recovery = openGenerationRecoveryCaseStore(fixture.dataDirectory, { enabled: true });
  } finally {
    recovery.closeDatabase();
    await rm(fixture.dataDirectory, { force: true, recursive: true });
  }
});

test("settleFromTask marks only an authoritative failure as terminal_verified and keeps an unknown result blocked", async () => {
  const reliable = await createFixture({ suffix: "settle-failure" });
  const unresolved = await createFixture({ suffix: "settle-unknown" });
  let reliableRecovery = reliable.recovery;
  let unresolvedRecovery = unresolved.recovery;
  try {
    const opened = reliableRecovery.ensureCase(caseInput(reliable.task, "settle-failure-open"));
    reliableRecovery.closeDatabase();
    const database = openAppDatabase(reliable.dataDirectory);
    database.prepare(`
      UPDATE generation_tasks
      SET error_code = 'GENERATION_FAILED', error_message = 'provider rejected without charge'
      WHERE id = ?
    `).run(reliable.task.id);
    database.prepare(`
      UPDATE generation_provider_attempts
      SET outcome = 'provider-failed', failure_code = 'PROVIDER_REFUNDED',
          finished_at = ?
      WHERE task_id = ? AND execution_attempt = 1
    `).run("2026-01-01T00:00:01.000Z", reliable.task.id);
    database.prepare(`
      INSERT INTO generation_task_events (task_id, state, error_code, error_message, created_at)
      VALUES (?, 'failed', 'GENERATION_FAILED', 'provider rejected without charge', ?)
    `).run(reliable.task.id, "2026-01-01T00:00:02.000Z");
    database.close();
    reliableRecovery = openGenerationRecoveryCaseStore(reliable.dataDirectory, { enabled: true });
    const current = reliableRecovery.getByTaskAttempt(reliable.task.id, 1);
    const settled = reliableRecovery.settleFromTask({
      taskId: reliable.task.id,
      ownerId,
      caseId: current.caseId,
      executionAttempt: 1,
      expectedCaseEventId: current.eventId,
      expectedCaseRevision: current.caseRevision,
      expectedTaskEventWatermark: reliableRecovery.getTaskEventWatermark(reliable.task.id),
      actorId: generationRecoverySystemActorId,
      operationId: "settle-failure-one",
      now: "2026-01-01T00:00:03.000Z",
    });
    expect(settled.phase).toBe("ready_for_user");
    expect(settled.checkOutcome).toBe("terminal_verified");
    expect(settled.evidenceRef).toMatchObject({ kind: "task_event" });
    const closed = reliableRecovery.closeCase({
      ...settled,
      taskId: reliable.task.id,
      ownerId,
      actorId: adminId,
      operationId: "settle-failure-close",
      expectedCaseEventId: settled.eventId,
      expectedCaseRevision: settled.caseRevision,
      now: "2026-01-01T00:00:04.000Z",
    });
    expect(closed.phase).toBe("ready_for_user");

    const unknownOpened = unresolvedRecovery.ensureCase(caseInput(unresolved.task, "settle-unknown-open"));
    expectRecoveryError(() => unresolvedRecovery.settleFromTask({
      taskId: unresolved.task.id,
      ownerId,
      caseId: unknownOpened.caseId,
      executionAttempt: 1,
      expectedCaseEventId: unknownOpened.eventId,
      expectedCaseRevision: unknownOpened.caseRevision,
      expectedTaskEventWatermark: unresolvedRecovery.getTaskEventWatermark(unresolved.task.id),
      actorId: generationRecoverySystemActorId,
      operationId: "settle-unknown-blocked",
      now: "2026-01-01T00:00:03.000Z",
    }), "RECOVERY_CASE_CONFLICT");
  } finally {
    reliableRecovery.closeDatabase();
    unresolvedRecovery.closeDatabase();
    await rm(reliable.dataDirectory, { force: true, recursive: true });
    await rm(unresolved.dataDirectory, { force: true, recursive: true });
  }
});
