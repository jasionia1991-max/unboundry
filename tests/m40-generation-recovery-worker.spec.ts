import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import {
  createGenerationTaskStore,
  type GenerationTask,
} from "../server/generationTaskStore";
import {
  openGenerationRecoveryCaseStore,
} from "../server/generationRecoveryCaseStore";
import { configureGenerationRecoveryCasePorts } from "../server/generationRecoveryCaseApplication";
import {
  inspectGenerationRecoveryCase,
  abortGenerationRecoveryInspections,
  configureGenerationRecoveryWorkerPorts,
  runGenerationRecoveryCasesSweep,
} from "../server/generationRecoveryCaseWorker";

const ownerId = "worker-recovery-owner";
const recoveryEnabled = "UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED";
const modelInputContractFlag = "UNBOUNDRY_MODEL_INPUT_CONTRACT_V2";
const workflowSelfHealingFlag = "UNBOUNDRY_WORKFLOW_SELF_HEALING_V2";

type FixtureTaskKind = "text" | "video";
type IncidentOptions = Readonly<{
  suffix: string;
  kind?: FixtureTaskKind;
  errorCode?: "OUTCOME_UNKNOWN_BILLING_RISK" | "OPERATOR_INCIDENT";
  attemptAgeMs?: number;
  providerProtocol?: "media-generate" | "native";
  includeProviderAttempt?: boolean;
}>;

type WorkerProbe = {
  inspectedTaskIds: string[];
  appliedTaskIds: string[];
  normalSweepCalls: number;
  slowTaskIds: Set<string>;
  ambiguousTaskIds: Set<string>;
  abortedTaskIds: string[];
  releaseInspection: (taskId: string) => void;
  frozen: boolean;
};

type WorkerFixture = Readonly<{
  dataDirectory: string;
  probe: WorkerProbe;
}>;

test.describe.configure({ mode: "serial" });

function seedOwner(database: ReturnType<typeof openAppDatabase>) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'safe-worker-fixture', 'user', 'active', ?, ?)
  `).run(ownerId, ownerId, "Worker recovery fixture", now, now);
}

function installWorkerPorts(probe: WorkerProbe) {
  configureGenerationRecoveryCasePorts({
    frozen: () => probe.frozen,
    inspecting: () => false,
    inspect: async () => undefined,
  });
  configureGenerationRecoveryWorkerPorts({
    inspect: async (task, signal) => {
      probe.inspectedTaskIds.push(task.id);
      signal.throwIfAborted();
      if (probe.slowTaskIds.has(task.id)) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            probe.abortedTaskIds.push(task.id);
            probe.releaseInspection = () => {};
            reject(signal.reason ?? new Error("synthetic worker inspection aborted"));
          };
          probe.releaseInspection = (taskId) => {
            if (taskId !== task.id) return;
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
      }
      signal.throwIfAborted();
      if (probe.ambiguousTaskIds.has(task.id)) {
        return { state: "ambiguous" as const };
      }
      return task.providerTaskId
        ? { state: "running" as const, providerTaskId: task.providerTaskId }
        : { state: "running" as const };
    },
    capture: (taskId, caseId) => ({ taskId, caseId, fixture: true }),
    apply: async ({ task, signal }) => {
      signal.throwIfAborted();
      probe.appliedTaskIds.push(task.id);
      const database = openAppDatabase(process.env.UNBOUNDRY_DATA_DIR!);
      try {
        database.prepare(`INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at)
          VALUES(?,?,'RECOVERY_TEST_INSPECTED','Synthetic admitted observation',?)`)
          .run(task.id, task.state, new Date().toISOString());
        const fence = database.prepare(`SELECT MAX(id) AS watermark,
          MAX(CASE WHEN error_code = 'RECOVERY_CASE_V1' THEN id END) AS case_id
          FROM generation_task_events WHERE task_id = ?`).get(task.id) as { watermark: number; case_id: number };
        return { taskEventWatermark: Number(fence.watermark), caseEventId: Number(fence.case_id) };
      } finally { database.close(); }
    },
    normalSweep: async () => {
      probe.normalSweepCalls += 1;
    },
    registered: async <T>(work: () => Promise<T>, _abort: () => void) => work(),
  });
}

async function withWorkerFixture<T>(work: (fixture: WorkerFixture) => Promise<T>) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-recovery-worker-"));
  const previous = {
    dataDirectory: process.env.UNBOUNDRY_DATA_DIR,
    recovery: process.env[recoveryEnabled],
    modelInputContract: process.env[modelInputContractFlag],
    workflowSelfHealing: process.env[workflowSelfHealingFlag],
  };
  const probe: WorkerProbe = {
    inspectedTaskIds: [],
    appliedTaskIds: [],
    normalSweepCalls: 0,
    slowTaskIds: new Set(),
    ambiguousTaskIds: new Set(),
    abortedTaskIds: [],
    releaseInspection: () => {},
    frozen: false,
  };
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  process.env[recoveryEnabled] = "1";
  process.env[modelInputContractFlag] = "1";
  process.env[workflowSelfHealingFlag] = "1";
  installWorkerPorts(probe);
  try {
    const database = openAppDatabase(dataDirectory);
    try {
      seedOwner(database);
    } finally {
      database.close();
    }
    return await work({ dataDirectory, probe });
  } finally {
    configureGenerationRecoveryWorkerPorts({
      inspect: async () => ({ state: "unsupported" as const }),
      capture: () => undefined,
      apply: async () => undefined,
      normalSweep: async () => undefined,
      registered: async <T>(job: () => Promise<T>, _abort: () => void) => job(),
    });
    configureGenerationRecoveryCasePorts({
      frozen: () => true,
      inspecting: () => false,
      inspect: async () => undefined,
    });
    if (previous.dataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous.dataDirectory;
    if (previous.recovery === undefined) delete process.env[recoveryEnabled];
    else process.env[recoveryEnabled] = previous.recovery;
    if (previous.modelInputContract === undefined) delete process.env[modelInputContractFlag];
    else process.env[modelInputContractFlag] = previous.modelInputContract;
    if (previous.workflowSelfHealing === undefined) delete process.env[workflowSelfHealingFlag];
    else process.env[workflowSelfHealingFlag] = previous.workflowSelfHealing;
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

async function seedIncident(
  dataDirectory: string,
  options: IncidentOptions,
): Promise<GenerationTask> {
  const kind = options.kind ?? "video";
  const errorCode = options.errorCode ?? "OUTCOME_UNKNOWN_BILLING_RISK";
  const providerProtocol = options.providerProtocol ?? "media-generate";
  const providerProfileId = `worker-provider-${kind}`;
  const providerModelId = `worker-provider-model-${kind}`;
  const tasks = createGenerationTaskStore(dataDirectory, { recoverRunning: false });
  const created = tasks.create({
    canvasId: `worker-canvas-${options.suffix}`,
    idempotencyKey: `worker-recovery-key-${options.suffix}`,
    kind,
    model: `worker-model-${kind}`,
    modelConfiguration: {
      fixtureScopeId: "m40-generation-recovery-worker",
      providerDriver: "multi-protocol-relay",
      providerProtocol,
    },
    nodeId: `worker-node-${options.suffix}`,
    ownerId,
    parameters: { fixtureScopeId: "m40-generation-recovery-worker" },
    prompt: "Synthetic worker recovery fixture",
    providerModelId,
    providerProfileId,
  }).task;
  const running = tasks.transition(created.id, "running");
  if (!running) throw new Error(`worker fixture did not enter running: ${created.id}`);
  tasks.close();

  const startedAt = new Date(Date.now() - (options.attemptAgeMs ?? 1_000)).toISOString();
  const database = openAppDatabase(dataDirectory);
  try {
    if (options.includeProviderAttempt !== false) {
      database.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, provider_profile_id, provider_model_id,
          kind, evidence, created_at, owner_id, credential_revision, outcome
        ) VALUES (?, 1, ?, ?, ?, 'provider-boundary', ?, ?, 0, 'outcome-unknown')
      `).run(
        running.id,
        providerProfileId,
        providerModelId,
        kind,
        startedAt,
        ownerId,
      );
    }
    database.prepare(`
      UPDATE generation_tasks
      SET state = 'failed', error_code = ?,
          error_message = ?, created_at = ?, updated_at = ?
      WHERE id = ?
    `).run(errorCode, `Synthetic ${errorCode}`, startedAt, startedAt, running.id);
  } finally {
    database.close();
  }
  return running;
}

function seedPublicationState(
  dataDirectory: string,
  task: GenerationTask,
  errorCode?: string,
) {
  const timestamp = new Date().toISOString();
  const database = openAppDatabase(dataDirectory);
  try {
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key,
        storage_profile_id, staging_name, task_id,
        task_execution_attempt, content_type, created_at, updated_at,
        error_code, output_slot, output_set_count
      ) VALUES (?, ?, ?, ?, 'generation', 'staged',
        'local', ?, ?, NULL, ?, ?, ?, 'video/mp4', ?, ?, ?, 0, 1)
    `).run(
      `worker-publication-${task.id}`,
      ownerId,
      task.kind,
      `worker-asset-${task.id}`,
      `worker-${task.id}.mp4`,
      `worker-${task.id}.mp4`,
      `worker-${task.id}.staging`,
      task.id,
      task.attempt,
      timestamp,
      timestamp,
      errorCode ?? null,
    );
  } finally {
    database.close();
  }
}

function recoveryCase(dataDirectory: string, task: GenerationTask) {
  const store = openGenerationRecoveryCaseStore(dataDirectory, { enabled: true });
  return {
    store,
    get: () => store.getByTaskAttempt(task.id, task.attempt, ownerId),
  };
}

function caseEventCount(database: ReturnType<typeof openAppDatabase>, taskId: string) {
  return Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM generation_task_events
    WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
  `).get(taskId) as { count: number }).count);
}

async function waitForWorkerProbe(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("worker fixture condition was not observed");
}

test("worker keeps original-window unknown requests separate from unsupported and queued maintenance cases", async () => {
  await withWorkerFixture(async ({ dataDirectory, probe }) => {
    const withinWindowUnknown = await seedIncident(dataDirectory, {
      suffix: "unknown-within-window",
      attemptAgeMs: 1_000,
    });
    const exhaustedUnknown = await seedIncident(dataDirectory, {
      suffix: "unknown-window-exhausted",
      attemptAgeMs: 2 * 60 * 60_000,
    });
    const unsupported = await seedIncident(dataDirectory, {
      suffix: "unsupported-text",
      kind: "text",
      providerProtocol: "native",
      attemptAgeMs: 1_000,
    });
    const operatorIncident = await seedIncident(dataDirectory, {
      suffix: "operator-incident",
      errorCode: "OPERATOR_INCIDENT",
      attemptAgeMs: 1_000,
    });
    const missingAttempt = await seedIncident(dataDirectory, {
      suffix: "missing-attempt",
      includeProviderAttempt: false,
      attemptAgeMs: 2 * 60 * 60_000,
    });
    const quarantinedPublication = await seedIncident(dataDirectory, {
      suffix: "quarantined-publication",
      attemptAgeMs: 2 * 60 * 60_000,
    });
    seedPublicationState(dataDirectory, quarantinedPublication, "OSS_IDENTITY_QUARANTINED");
    const completedQuarantine = await seedIncident(dataDirectory, {
      suffix: "completed-quarantined-publication",
      errorCode: "OPERATOR_INCIDENT",
    });
    seedPublicationState(dataDirectory, completedQuarantine, "OSS_IDENTITY_QUARANTINED");
    const completedDatabase = openAppDatabase(dataDirectory);
    try {
      completedDatabase.prepare("UPDATE generation_provider_attempts SET outcome='completed' WHERE task_id=?")
        .run(completedQuarantine.id);
    } finally { completedDatabase.close(); }
    const pendingPublication = await seedIncident(dataDirectory, {
      suffix: "pending-publication",
      attemptAgeMs: 2 * 60 * 60_000,
    });
    seedPublicationState(dataDirectory, pendingPublication);
    const ambiguousMatch = await seedIncident(dataDirectory, {
      suffix: "ambiguous-no-id-match",
      attemptAgeMs: 1_000,
    });
    probe.ambiguousTaskIds.add(ambiguousMatch.id);
    const ambiguousCaseStore = openGenerationRecoveryCaseStore(dataDirectory, { enabled: true });
    try {
      ambiguousCaseStore.ensureCase({
        taskId: ambiguousMatch.id,
        ownerId,
        executionAttempt: ambiguousMatch.attempt,
        reason: "provider_evidence_conflict",
        operationId: "worker-ambiguous-no-id-case",
      });
    } finally {
      ambiguousCaseStore.closeDatabase();
    }
    const corruptCaseTask = await seedIncident(dataDirectory, {
      suffix: "corrupt-case-event",
      attemptAgeMs: 1_000,
    });
    probe.ambiguousTaskIds.add(corruptCaseTask.id);
    const corruptCaseEventId = (() => {
      const corruptCaseStore = openGenerationRecoveryCaseStore(dataDirectory, { enabled: true });
      try {
        return corruptCaseStore.ensureCase({
          taskId: corruptCaseTask.id,
          ownerId,
          executionAttempt: corruptCaseTask.attempt,
          reason: "operator_incident",
          operationId: "worker-corrupt-case-event",
        }).eventId;
      } finally {
        corruptCaseStore.closeDatabase();
      }
    })();
    const corruptDatabase = openAppDatabase(dataDirectory);
    try {
      corruptDatabase.prepare(`
        UPDATE generation_task_events
        SET error_message = ?
        WHERE id = ? AND error_code = 'RECOVERY_CASE_V1'
      `).run("not-json", corruptCaseEventId);
    } finally {
      corruptDatabase.close();
    }

    await runGenerationRecoveryCasesSweep();

    const withinCase = recoveryCase(dataDirectory, withinWindowUnknown);
    const exhaustedCase = recoveryCase(dataDirectory, exhaustedUnknown);
    const unsupportedCase = recoveryCase(dataDirectory, unsupported);
    const operatorCase = recoveryCase(dataDirectory, operatorIncident);
    const missingCase = recoveryCase(dataDirectory, missingAttempt);
    const quarantinedCase = recoveryCase(dataDirectory, quarantinedPublication);
    const pendingCase = recoveryCase(dataDirectory, pendingPublication);
    const ambiguousCase = recoveryCase(dataDirectory, ambiguousMatch);
    const completedCase = recoveryCase(dataDirectory, completedQuarantine);
    try {
      expect(() => withinCase.get()).toThrow("维护事项不存在");
      expect(exhaustedCase.get()).toMatchObject({
        reason: "recovery_window_exhausted",
        checkCount: 1,
        checkOutcome: "still_running",
      });
      expect(unsupportedCase.get()).toMatchObject({
        reason: "unsupported_recovery",
        checkCount: 0,
        checkOutcome: "not_checked",
      });
      expect(operatorCase.get()).toMatchObject({
        reason: "operator_incident",
        checkCount: 1,
        checkOutcome: "still_running",
      });
      expect(missingCase.get()).toMatchObject({
        reason: "missing_attempt_evidence",
        checkCount: 0,
        checkOutcome: "not_checked",
      });
      expect(quarantinedCase.get()).toMatchObject({
        reason: "provider_evidence_conflict",
        checkCount: 0,
        checkOutcome: "not_checked",
      });
      expect(completedCase.get()).toMatchObject({
        phase: "queued", reason: "provider_evidence_conflict", checkCount: 0, inspectionUsed: 0,
      });
      expect(pendingCase.get()).toMatchObject({
        reason: "recovery_window_exhausted",
        checkCount: 0,
        checkOutcome: "not_checked",
      });
      expect(ambiguousCase.get()).toMatchObject({
        reason: "provider_evidence_conflict",
        checkCount: 0,
        inspectionUsed: 0,
        checkOutcome: "not_checked",
      });
      expect(new Set(probe.inspectedTaskIds)).toEqual(
        new Set([exhaustedUnknown.id, operatorIncident.id]),
      );
      expect(probe.inspectedTaskIds).toHaveLength(2);
      expect(probe.appliedTaskIds).toEqual(
        expect.arrayContaining([exhaustedUnknown.id, operatorIncident.id]),
      );
      expect(probe.normalSweepCalls).toBe(0);
      for (const task of [unsupported, missingAttempt, quarantinedPublication, completedQuarantine, pendingPublication, ambiguousMatch, corruptCaseTask]) {
        await inspectGenerationRecoveryCase(task.id, "system:generation-recovery", `direct-${task.id}`);
      }
      expect(probe.inspectedTaskIds).toHaveLength(2);
      expect(probe.normalSweepCalls).toBe(1);
      expect(pendingCase.get().inspectionUsed).toBe(0);
      expect(quarantinedCase.get().inspectionUsed).toBe(0);
      expect(ambiguousCase.get().inspectionUsed).toBe(0);
      const corruptDatabase = openAppDatabase(dataDirectory);
      try {
        expect(Number((corruptDatabase.prepare(`
          SELECT COUNT(*) AS count
          FROM generation_task_events
          WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
        `).get(corruptCaseTask.id) as { count: number }).count)).toBe(1);
      } finally {
        corruptDatabase.close();
      }
    } finally {
      withinCase.store.closeDatabase();
      exhaustedCase.store.closeDatabase();
      unsupportedCase.store.closeDatabase();
      operatorCase.store.closeDatabase();
      missingCase.store.closeDatabase();
      quarantinedCase.store.closeDatabase();
      pendingCase.store.closeDatabase();
      ambiguousCase.store.closeDatabase();
      completedCase.store.closeDatabase();
    }

    const database = openAppDatabase(dataDirectory);
    try {
      expect(Number((database.prepare(
        "SELECT COUNT(*) AS count FROM generation_provider_attempts",
      ).get() as { count: number }).count)).toBe(9);
    } finally {
      database.close();
    }
  });
});

test("worker lets a fast inspection finish while another is slow, then aborts the slow inspection when frozen", async () => {
  await withWorkerFixture(async ({ dataDirectory, probe }) => {
    const slowTask = await seedIncident(dataDirectory, {
      suffix: "slow-inspection",
      attemptAgeMs: 2 * 60 * 60_000,
    });
    const fastTask = await seedIncident(dataDirectory, {
      suffix: "fast-inspection",
      attemptAgeMs: 2 * 60 * 60_000,
    });
    probe.slowTaskIds.add(slowTask.id);

    let sweepSettled = false;
    const sweep = runGenerationRecoveryCasesSweep();
    void sweep.then(
      () => { sweepSettled = true; },
      () => { sweepSettled = true; },
    );
    await waitForWorkerProbe(() =>
      probe.inspectedTaskIds.includes(slowTask.id) &&
      probe.inspectedTaskIds.includes(fastTask.id));
    expect(sweepSettled).toBe(false);

    const fastCase = recoveryCase(dataDirectory, fastTask);
    try {
      await expect.poll(() => fastCase.get().checkCount).toBe(1);
      expect(sweepSettled).toBe(false);
      expect(fastCase.get()).toMatchObject({
        reason: "recovery_window_exhausted",
        checkCount: 1,
        checkOutcome: "still_running",
      });
    } finally {
      fastCase.store.closeDatabase();
    }
    expect(probe.appliedTaskIds).toContain(fastTask.id);
    expect(probe.abortedTaskIds).toEqual([]);

    probe.frozen = true;
    abortGenerationRecoveryInspections();
    await sweep;

    expect(probe.abortedTaskIds).toContain(slowTask.id);
    expect(probe.appliedTaskIds).not.toContain(slowTask.id);
    const slowCase = recoveryCase(dataDirectory, slowTask);
    try {
      expect(slowCase.get()).toMatchObject({
        reason: "recovery_window_exhausted",
        checkCount: 0,
        checkOutcome: "not_checked",
      });
    } finally {
      slowCase.store.closeDatabase();
    }

    const database = openAppDatabase(dataDirectory);
    try {
      expect(caseEventCount(database, slowTask.id)).toBe(1);
      expect(caseEventCount(database, fastTask.id)).toBe(2);
    } finally {
      database.close();
    }
  });
});

test("worker settles a saved terminal result into one unread recovery progress event without a Provider read", async () => {
  await withWorkerFixture(async ({ dataDirectory, probe }) => {
    const task = await seedIncident(dataDirectory, {
      suffix: "terminal-success",
      attemptAgeMs: 1_000,
    });
    const openedStore = openGenerationRecoveryCaseStore(dataDirectory, { enabled: true });
    const opened = openedStore.ensureCase({
      taskId: task.id,
      ownerId,
      executionAttempt: task.attempt,
      reason: "outcome_unknown",
      operationId: "worker-terminal-open",
    });
    const originalUpdatedAt = opened.task.updatedAt;
    openedStore.closeDatabase();

    const terminalAt = new Date(Date.now() + 1).toISOString();
    const database = openAppDatabase(dataDirectory);
    try {
      database.prepare(`
        UPDATE generation_tasks
        SET state = 'success', result_asset_id = ?, result_text = NULL,
            error_code = NULL, error_message = NULL, updated_at = ?
        WHERE id = ?
      `).run("synthetic-worker-result", originalUpdatedAt, task.id);
      database.prepare(`
        INSERT INTO generation_task_events (
          task_id, state, error_code, error_message, created_at
        ) VALUES (?, 'success', NULL, NULL, ?)
      `).run(task.id, terminalAt);
    } finally {
      database.close();
    }

    await runGenerationRecoveryCasesSweep();

    const settledStore = openGenerationRecoveryCaseStore(dataDirectory, { enabled: true });
    try {
      const settled = settledStore.getByTaskAttempt(task.id, task.attempt, ownerId);
      expect(settled).toMatchObject({
        phase: "result_recovered",
        checkOutcome: "result_found",
        lastReadProgressVersion: 0,
      });
      expect(settled!.progressVersion).toBeGreaterThan(settled!.lastReadProgressVersion);
      expect(settled!.evidenceRef).toMatchObject({ kind: "task_event" });
    } finally {
      settledStore.closeDatabase();
    }
    expect(probe.inspectedTaskIds).toEqual([]);

    const checked = openAppDatabase(dataDirectory);
    try {
      expect(caseEventCount(checked, task.id)).toBe(2);
      const row = checked.prepare(
        "SELECT updated_at FROM generation_tasks WHERE id = ?",
      ).get(task.id) as { updated_at: string };
      expect(row.updated_at).toBe(originalUpdatedAt);
    } finally {
      checked.close();
    }
  });
});

test("worker rolls back a failed recovery event and backfills it on the next sweep", async () => {
  await withWorkerFixture(async ({ dataDirectory, probe }) => {
    const task = await seedIncident(dataDirectory, {
      suffix: "event-write-failure",
      errorCode: "OPERATOR_INCIDENT",
      attemptAgeMs: 1_000,
    });
    const originalPrepare = DatabaseSync.prototype.prepare;
    try {
      DatabaseSync.prototype.prepare = function(this: DatabaseSync, sql: string) {
        const statement = originalPrepare.call(this, sql);
        if (/INSERT\s+INTO\s+generation_task_events/i.test(sql)) {
          statement.run = new Proxy(statement.run, {
            apply(target, receiver, args) {
              if (args.includes("RECOVERY_CASE_V1")) throw new Error("synthetic recovery event write failure");
              return Reflect.apply(target, receiver, args);
            },
          });
        }
        return statement;
      };
      await runGenerationRecoveryCasesSweep();
    } finally {
      DatabaseSync.prototype.prepare = originalPrepare;
    }

    const failedSweep = recoveryCase(dataDirectory, task);
    try {
      expect(() => failedSweep.get()).toThrow("维护事项不存在");
    } finally {
      failedSweep.store.closeDatabase();
    }
    expect(probe.inspectedTaskIds).toEqual([]);

    const afterFailure = openAppDatabase(dataDirectory);
    try {
      expect(caseEventCount(afterFailure, task.id)).toBe(0);
    } finally {
      afterFailure.close();
    }

    await runGenerationRecoveryCasesSweep();
    const recovered = recoveryCase(dataDirectory, task);
    try {
      expect(recovered.get()).toMatchObject({
        reason: "operator_incident",
        checkCount: 1,
        checkOutcome: "still_running",
      });
    } finally {
      recovered.store.closeDatabase();
    }
    expect(probe.inspectedTaskIds).toEqual([task.id]);
    const checked = openAppDatabase(dataDirectory);
    try {
      expect(caseEventCount(checked, task.id)).toBe(2);
    } finally {
      checked.close();
    }
  });
});

test("worker feature-off is inert, concurrent sweeps coalesce, and the automatic budget survives a reopened read", async () => {
  await withWorkerFixture(async ({ dataDirectory, probe }) => {
    const task = await seedIncident(dataDirectory, {
      suffix: "flag-and-restart",
      errorCode: "OPERATOR_INCIDENT",
      attemptAgeMs: 10_000,
    });
    const before = openAppDatabase(dataDirectory);
    let originalUpdatedAt: string;
    try {
      originalUpdatedAt = (before.prepare(
        "SELECT updated_at FROM generation_tasks WHERE id = ?",
      ).get(task.id) as { updated_at: string }).updated_at;
    } finally {
      before.close();
    }

    process.env[recoveryEnabled] = "0";
    await runGenerationRecoveryCasesSweep();
    const disabledStore = recoveryCase(dataDirectory, task);
    try {
      expect(() => disabledStore.get()).toThrow("维护事项不存在");
    } finally {
      disabledStore.store.closeDatabase();
    }
    expect(probe.inspectedTaskIds).toEqual([]);
    const disabledDatabase = openAppDatabase(dataDirectory);
    try {
      expect(caseEventCount(disabledDatabase, task.id)).toBe(0);
      expect((disabledDatabase.prepare(
        "SELECT updated_at FROM generation_tasks WHERE id = ?",
      ).get(task.id) as { updated_at: string }).updated_at).toBe(originalUpdatedAt);
    } finally {
      disabledDatabase.close();
    }

    process.env[recoveryEnabled] = "1";
    const first = runGenerationRecoveryCasesSweep();
    const second = runGenerationRecoveryCasesSweep();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(probe.inspectedTaskIds).toEqual([task.id]);

    const firstStore = recoveryCase(dataDirectory, task);
    let firstCase: ReturnType<typeof firstStore.get> | undefined;
    try {
      firstCase = firstStore.get();
      expect(firstCase).toMatchObject({ checkCount: 1, checkOutcome: "still_running" });
    } finally {
      firstStore.store.closeDatabase();
    }
    if (!firstCase || !firstCase.nextCheckAt) throw new Error("worker fixture did not persist a check deadline");

    const dueAt = new Date(Date.now() - 1).toISOString();
    const reopen = openAppDatabase(dataDirectory);
    try {
      const checkpointRow = reopen.prepare(`
        SELECT id, error_message
        FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_AUTOMATIC_CHECK_V1'
        ORDER BY id DESC LIMIT 1
      `).get(task.id) as { id: number; error_message: string };
      const checkpoint = JSON.parse(checkpointRow.error_message) as Record<string, unknown>;
      reopen.prepare(`
        UPDATE generation_task_events
        SET error_message = ?
        WHERE id = ?
      `).run(JSON.stringify({
        ...checkpoint,
        lastCheckedAt: dueAt,
        nextCheckAt: dueAt,
        leaseUntil: dueAt,
      }), checkpointRow.id);
      const caseRow = reopen.prepare(`
        SELECT id, error_message
        FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
        ORDER BY id DESC LIMIT 1
      `).get(task.id) as { id: number; error_message: string };
      const payload = JSON.parse(caseRow.error_message) as Record<string, unknown>;
      reopen.prepare(`
        UPDATE generation_task_events
        SET error_message = ?
        WHERE id = ?
      `).run(JSON.stringify({ ...payload, nextCheckAt: dueAt }), caseRow.id);
    } finally {
      reopen.close();
    }

    await runGenerationRecoveryCasesSweep();
    expect(probe.inspectedTaskIds).toEqual([task.id, task.id]);
    const finalStore = recoveryCase(dataDirectory, task);
    try {
      const finalCase = finalStore.get();
      expect(finalCase).toMatchObject({ checkCount: 2, checkOutcome: "still_running" });
      expect(finalCase!.caseId).toBe(firstCase.caseId);
    } finally {
      finalStore.store.closeDatabase();
    }
    const checked = openAppDatabase(dataDirectory);
    try {
      expect(caseEventCount(checked, task.id)).toBe(3);
      expect(Number((checked.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_task_events
        WHERE task_id = ? AND error_code = 'RECOVERY_AUTOMATIC_CHECK_V1'
      `).get(task.id) as { count: number }).count)).toBe(2);
    } finally {
      checked.close();
    }
  });
});
