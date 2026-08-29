import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { saveAccountCredential } from "../server/accountCredentials";
import {
  applyPendingSchemaMigrationsInTransaction,
  openAppDatabase,
} from "../server/database";
import { bootstrapPublishedModelContracts } from
  "../server/modelReleaseBootstrap";
import { modelContractState } from "../server/modelReleaseRevisionStore";
import {
  createGenerationTaskStore,
  failRecoveredGenerationTasks,
  generationProviderAttemptCounts,
  GenerationProviderAttemptBlockedError,
  GenerationTaskAdmissionError,
  GenerationTaskConflictError,
  GenerationTaskProviderBoundaryError,
  GenerationTaskRetryFenceError,
  GenerationTaskTransitionError,
  type GenerationTask,
} from "../server/generationTaskStore";
import { saveProviderProfile } from "../server/providerProfiles";
import { openRouterImagePostBoundaryRecovery } from "../server/generationTasks";
import { OpenRouterImageError } from "../server/openRouterImageProvider";
import { knownModelParameterSchema } from "../types/modelParameters";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";

type AdmissionChildOutcome = {
  created?: boolean;
  errorCode?: string;
  errorName?: string;
  message?: string;
  taskId?: string;
};

let atomicModelReleaseRevision: ModelReleaseRevision | undefined;

test("native GPT Image post-boundary uncertainty enters durable recovery", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-gpt-image-unknown-"));
  const store = createGenerationTaskStore(dataDirectory);
  try {
    for (const code of ["CANCELLED", "FORMAT", "NETWORK", "TIMEOUT"] as const) {
      const created = store.create({
        canvasId: `gpt-image-post-boundary-${code.toLowerCase()}`,
        idempotencyKey: `gpt-image-post-boundary-${code.toLowerCase()}`,
        kind: "image",
        nodeId: `gpt-image-${code.toLowerCase()}`,
        ownerId: "__test__",
        prompt: `${code} after provider boundary`,
        providerModelId: "openai/gpt-image-2",
        providerProfileId: `gpt-image-post-boundary-${code.toLowerCase()}`,
      }).task;
      const running = store.transition(created.id, "running")!;
      store.recordProviderAttempt(created.id);
      const providerAttempt = store.getProviderAttemptForTask(created.id)!;
      const decision = openRouterImagePostBoundaryRecovery({
        error: new OpenRouterImageError(code, code),
        latest: running,
        providerAttempt,
      });
      expect(decision).toBeDefined();
      store.transition(created.id, "failed", decision!.failure);
      store.transition(created.id, "recovering", decision!.recovery);
      expect(store.get(created.id)).toMatchObject({
        attempt: 1,
        errorCode: "AUTOMATIC_RESULT_RECOVERY",
        state: "recovering",
      });
      expect(store.getProviderAttemptForTask(created.id)).toMatchObject({
        executionAttempt: 1,
        failureCode: "OUTCOME_UNKNOWN_BILLING_RISK",
        outcome: "outcome-unknown",
      });
      expect(store.hasUnsafeProviderAttemptForNewPaidRetry(created.id)).toBe(true);
    }
    expect(openRouterImagePostBoundaryRecovery({
      error: new OpenRouterImageError("AUTH", "definitive"),
      latest: { attempt: 1, state: "running" },
      providerAttempt: { executionAttempt: 1, outcome: "boundary-claimed" },
    })).toBeUndefined();
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

const atomicAdmissionChildBootstrap = `
  import { access } from "node:fs/promises";
  import { createServer } from "vite";

  const [firstReleasePath, secondReleasePath, firstPayload, secondPayload] =
    process.argv.slice(1);
  const waitForRelease = async (path) => {
    while (true) {
      try {
        await access(path);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  };
  const server = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { hmr: false, middlewareMode: true, ws: false },
  });
  let store;
  try {
    const module = await server.ssrLoadModule("/server/generationTaskStore.ts");
    store = module.createGenerationTaskStore(process.env.UNBOUNDRY_DATA_DIR);
    const admit = (payload) => {
      try {
        const admitted = store.admitOrGet(JSON.parse(
          Buffer.from(payload, "base64url").toString("utf8"),
        ));
        return {
          created: admitted.created,
          taskId: admitted.task.id,
        };
      } catch (error) {
        return {
          errorCode: error && typeof error === "object" && "code" in error
            ? String(error.code)
            : undefined,
          errorName: error instanceof Error ? error.name : typeof error,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    };
    process.stdout.write("READY\\n");
    await waitForRelease(firstReleasePath);
    process.stdout.write("FIRST " + JSON.stringify(admit(firstPayload)) + "\\n");
    await waitForRelease(secondReleasePath);
    process.stdout.write("SECOND " + JSON.stringify(admit(secondPayload)) + "\\n");
  } finally {
    store?.close();
    await server.close();
  }
`;

function runAtomicAdmissionChild(
  dataDirectory: string,
  firstReleasePath: string,
  secondReleasePath: string,
  firstRequest: Record<string, unknown>,
  secondRequest: Record<string, unknown>,
) {
  const payload = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    atomicAdmissionChildBootstrap,
    firstReleasePath,
    secondReleasePath,
    payload(firstRequest),
    payload(secondRequest),
  ], {
    cwd: process.cwd(),
    env: { ...process.env, UNBOUNDRY_DATA_DIR: dataDirectory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let readySettled = false;
  let firstSettled = false;
  let secondSettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveFirst!: (value: AdmissionChildOutcome) => void;
  let rejectFirst!: (error: Error) => void;
  let resolveSecond!: (value: AdmissionChildOutcome) => void;
  let rejectSecond!: (error: Error) => void;
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const first = new Promise<AdmissionChildOutcome>((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  const second = new Promise<AdmissionChildOutcome>((resolve, reject) => {
    resolveSecond = resolve;
    rejectSecond = reject;
  });
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line === "READY") {
        readySettled = true;
        resolveReady();
      } else if (line.startsWith("FIRST ")) {
        firstSettled = true;
        resolveFirst(JSON.parse(line.slice(6)) as AdmissionChildOutcome);
      } else if (line.startsWith("SECOND ")) {
        secondSettled = true;
        resolveSecond(JSON.parse(line.slice(7)) as AdmissionChildOutcome);
      }
    }
  });
  child.once("error", (error) => {
    if (!readySettled) rejectReady(error);
    if (!firstSettled) rejectFirst(error);
    if (!secondSettled) rejectSecond(error);
    rejectDone(error);
  });
  child.once("exit", (code) => {
    if (code === 0 && readySettled && firstSettled && secondSettled) {
      resolveDone();
      return;
    }
    const error = new Error(
      `Atomic admission child exited with ${code}: ${stderr || buffer}`,
    );
    if (!readySettled) rejectReady(error);
    if (!firstSettled) rejectFirst(error);
    if (!secondSettled) rejectSecond(error);
    rejectDone(error);
  });
  return {
    done,
    first,
    ready,
    second,
    terminate: () => child.kill("SIGTERM"),
  };
}

function seedAtomicGenerationFixture(
  database: ReturnType<typeof openAppDatabase>,
  owners = ["atomic-owner-a", "atomic-owner-b"],
) {
  const timestamp = "2026-08-11T08:00:00.000Z";
  const profileId = "atomic-provider-profile";
  const modelId = "atomic-image-model";
  for (const ownerId of owners) {
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'test-only', 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, ownerId, timestamp, timestamp);
  }
  database.prepare(`
    INSERT INTO provider_profiles (
      id, display_name, driver, status, provider_configuration_version,
      created_at, updated_at
    ) VALUES (?, 'Atomic Provider', 'openrouter', 'enabled', 1, ?, ?)
  `).run(profileId, timestamp, timestamp);
  database.prepare(`
    INSERT INTO model_profiles (
      id, display_name, provider_profile_id, provider_model_id,
      capability, status, default_parameters, created_at, updated_at,
      max_cost_microunits, cost_currency
    ) VALUES (
      ?, 'Atomic Image', ?, 'openai/gpt-image-2', 'image', 'published',
      ?, ?, ?, 1000000, 'USD'
    )
  `).run(
    modelId,
    profileId,
    JSON.stringify(knownModelParameterSchema({
      capability: "image",
      providerDriver: "openrouter",
      providerModelId: "openai/gpt-image-2",
    })),
    timestamp,
    timestamp,
  );
  database.prepare(`
    INSERT INTO node_model_bindings (
      node_type, model_id, enabled, is_default, sort_order,
      created_at, updated_at
    ) VALUES ('image', ?, 1, 1, 1, ?, ?)
  `).run(modelId, timestamp, timestamp);
  for (const ownerId of owners) {
    database.prepare(`
      INSERT INTO account_provider_credential_epochs (
        account_id, provider_profile_id, credential_revision, updated_at
      ) VALUES (?, ?, 1, ?)
    `).run(ownerId, profileId, timestamp);
    database.prepare(`
      INSERT INTO account_provider_credentials (
        account_id, provider_profile_id, encrypted_key, key_status,
        key_checked_at, credential_version, updated_at
      ) VALUES (?, ?, 'fixture-encrypted-key', 'valid', ?, 1, ?)
    `).run(ownerId, profileId, timestamp, timestamp);
  }
  database.prepare(`
    UPDATE generation_safety_settings
    SET
      global_enabled = 1,
      emergency_stop = 0,
      per_user_concurrency = 1,
      requests_per_minute = 1000,
      image_concurrency = 1000,
      failure_threshold = 3,
      cooldown_minutes = 30,
      updated_at = ?
    WHERE id = 1
  `).run(timestamp);
  bootstrapPublishedModelContracts(database, owners[0]);
  atomicModelReleaseRevision = modelContractState(database, modelId).active;
  if (!atomicModelReleaseRevision) {
    throw new Error("atomic fixture model release was not published");
  }
  return { modelId, profileId, timestamp };
}

function atomicImageRequest(input: {
  credentialRevision?: number;
  idempotencyKey: string;
  modelConfiguration?: Record<string, unknown>;
  nodeId?: string;
  ownerId?: string;
  profileId?: string;
}) {
  const ownerId = input.ownerId ?? "atomic-owner-a";
  const profileId = input.profileId ?? "atomic-provider-profile";
  const nodeId = input.nodeId ?? "atomic-image-node";
  const credentialRevision = input.credentialRevision ?? 1;
  return {
    canvasId: "atomic-canvas",
    credentialRevision,
    idempotencyKey: input.idempotencyKey,
    kind: "image" as const,
    model: "atomic-image-model",
    modelConfiguration: input.modelConfiguration ?? {
      credentialVersion: credentialRevision,
      modelId: "atomic-image-model",
      modelReleaseRevision: atomicModelReleaseRevision,
      parameterSchema: atomicModelReleaseRevision?.document.capabilitySchema,
      providerConfigurationVersion: 1,
      providerDriver: "openrouter",
      providerModelId: "openai/gpt-image-2",
      providerProfileId: profileId,
      providerProtocol: "native",
    },
    nodeId,
    ownerId,
    parameters: { count: 1, size: "1k" },
    prompt: "atomic admission image",
    providerModelId: "openai/gpt-image-2",
    providerProfileId: profileId,
    requestIntent: {
      canvasId: "atomic-canvas",
      kind: "image",
      model: "atomic-image-model",
      nodeId,
      parameters: { count: 1, size: "1k" },
      prompt: "atomic admission image",
    },
  };
}

function seedGenerationRetryBinding(
  dataDirectory: string,
  task: Pick<
    GenerationTask,
    "attempt" | "canvasId" | "id" | "kind" | "modelConfiguration" |
      "nodeId" | "ownerId" | "updatedAt"
  >,
  generationInputKey: string,
  expectedCanvasRevision = 1,
  generationOwnershipKey = "fixture-retry-ownership",
  workflowExecutionRunId?: string,
) {
  const database = openAppDatabase(dataDirectory);
  const modelConfigurationRevision = "fixture-config-revision";
  const modelInputContractFingerprint = "mic2:fixture-retry-contract";
  const modelReleaseRevision = "00000000-0000-4000-8000-000000000005";
  try {
    const ownerId = task.ownerId ?? "__test__";
    database.prepare(`
      INSERT OR IGNORE INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'test-only', 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, ownerId, task.updatedAt, task.updatedAt);
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES (?, ?, 1, ?, ?, '[]', '{}', ?, NULL, 0)
      ON CONFLICT(owner_id, id) DO UPDATE SET
        graph_revision = excluded.graph_revision,
        nodes = excluded.nodes,
        updated_at = excluded.updated_at
    `).run(
      ownerId,
      task.canvasId,
      expectedCanvasRevision,
      JSON.stringify([{
        data: {
          [`${task.kind}GenerationInputKey`]: generationInputKey,
          [`${task.kind}GenerationOwnershipKey`]: generationOwnershipKey,
          [`${task.kind}GenerationTaskId`]: task.id,
          workflowExecutionRunId,
        },
        id: task.nodeId,
        type: task.kind,
      }]),
      task.updatedAt,
    );
    database.prepare(`
      UPDATE generation_tasks
      SET model_configuration = ?
      WHERE id = ?
    `).run(JSON.stringify({
      ...task.modelConfiguration,
      fixtureScopeId: "",
      generationIdentityVersion: 2,
      generationInputKey,
      generationOwnershipKey,
      modelConfigurationRevision,
      modelInputContractFingerprint,
      modelReleaseRevision: {
        revisionId: modelReleaseRevision,
      },
    }), task.id);
  } finally {
    database.close();
  }
  return {
    canvasId: task.canvasId,
    expectedAttempt: task.attempt,
    expectedCanvasRevision,
    expectedFixtureScopeId: "",
    expectedGenerationInputKey: generationInputKey,
    expectedGenerationOwnershipKey: generationOwnershipKey,
    expectedModelConfigurationRevision: modelConfigurationRevision,
    expectedModelInputContractFingerprint: modelInputContractFingerprint,
    expectedModelReleaseRevision: modelReleaseRevision,
    expectedUpdatedAt: task.updatedAt,
    kind: task.kind,
    nodeId: task.nodeId,
  };
}

test("generation task creation is idempotent and a running task recovers after reopen", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-task-store-"));
  const request = {
    canvasId: "canvas-generation-test",
    idempotencyKey: "request-generation-0001",
    kind: "image" as const,
    model: "provider-not-selected",
    nodeId: "image-generation-test",
    parameters: {
      count: 1,
      references: [
        {
          assetId: "reference-asset-1",
          kind: "image",
          sourceNodeId: "reference-node-1",
        },
      ],
      size: "1k",
    },
    prompt: "A quiet window with morning light",
  };

  try {
    const firstStore = createGenerationTaskStore(dataDirectory);
    const first = firstStore.create(request);
    const duplicate = firstStore.create({
      ...request,
      parameters: {
        references: [
          {
            sourceNodeId: "reference-node-1",
            kind: "image",
            assetId: "reference-asset-1",
          },
        ],
        size: "1k",
        count: 1,
      },
    });

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.task.id).toBe(first.task.id);
    expect(firstStore.list(request.canvasId)).toHaveLength(1);
    expect(firstStore.listEvents(first.task.id).map(({ state }) => state)).toEqual([
      "queued",
    ]);

    expect(() =>
      firstStore.create({
        ...request,
        prompt: "A different request must not reuse the same key",
      }),
    ).toThrow(GenerationTaskConflictError);
    expect(() =>
      firstStore.create({
        ...request,
        parameters: {
          ...request.parameters,
          references: [
            {
              assetId: "reference-asset-2",
              kind: "image",
              sourceNodeId: "reference-node-1",
            },
          ],
        },
      }),
    ).toThrow(GenerationTaskConflictError);

    const running = firstStore.transition(first.task.id, "running");
    expect(running).toMatchObject({ attempt: 1, state: "running" });
    seedGenerationRetryBinding(
      dataDirectory,
      running!,
      "active-input-proof",
      1,
      "active-ownership-proof",
      "active-run-proof",
    );
    expect(firstStore.retryBindingsForCanvas(request.canvasId).get(first.task.id))
      .toMatchObject({
        generationInputKey: "active-input-proof",
        generationOwnershipKey: "active-ownership-proof",
        taskId: first.task.id,
        workflowExecutionRunId: "active-run-proof",
      });
    expect(firstStore.listEvents(first.task.id).map(({ state }) => state)).toEqual([
      "queued",
      "running",
    ]);
    firstStore.close();

    const recoveryStore = createGenerationTaskStore(dataDirectory);
    const recovering = recoveryStore.get(first.task.id);
    expect(recovering).toMatchObject({ attempt: 1, state: "recovering" });
    expect(
      recoveryStore.listEvents(first.task.id).map(({ state }) => state),
    ).toEqual(["queued", "running", "recovering"]);
    expect(recoveryStore.listRecovering().map(({ id }) => id)).toEqual([
      first.task.id,
    ]);
    expect(() => recoveryStore.transition(first.task.id, "success")).toThrow(
      GenerationTaskTransitionError,
    );
    expect(recoveryStore.transition(first.task.id, "queued")).toMatchObject({
      attempt: 1,
      state: "queued",
    });
    expect(recoveryStore.listRecovering()).toEqual([]);
    expect(
      recoveryStore.listEvents(first.task.id).map(({ state }) => state),
    ).toEqual(["queued", "running", "recovering", "queued"]);

    const retryable = recoveryStore.create({
      canvasId: "canvas-retry",
      idempotencyKey: "request-retry-001",
      kind: "image",
      nodeId: "image-retry",
      prompt: "retry",
    }).task;
    recoveryStore.transition(retryable.id, "running");
    recoveryStore.transition(retryable.id, "failed", {
      code: "TIMEOUT",
      message: "timeout",
    });
    recoveryStore.transition(retryable.id, "retrying");
    recoveryStore.transition(retryable.id, "queued");
    expect(recoveryStore.transition(retryable.id, "running")).toMatchObject({
      attempt: 2,
      state: "running",
    });
    expect(
      recoveryStore.listEvents(retryable.id).map(({ state }) => state),
    ).toEqual([
      "queued",
      "running",
      "failed",
      "retrying",
      "queued",
      "running",
    ]);
    recoveryStore.transition(retryable.id, "failed", {
      code: "TEST_COMPLETE",
      message: "test complete",
    });
    recoveryStore.close();

    const runningStore = createGenerationTaskStore(dataDirectory);
    const second = runningStore.create({
      ...request,
      idempotencyKey: "request-generation-0002",
      nodeId: "image-generation-recovery",
    });
    runningStore.transition(second.task.id, "running");
    runningStore.close();

    const reopenedStore = createGenerationTaskStore(dataDirectory);
    expect(reopenedStore.get(second.task.id)).toMatchObject({
      attempt: 1,
      state: "recovering",
    });
    expect(failRecoveredGenerationTasks(reopenedStore)).toMatchObject([
      {
        attempt: 1,
        errorCode: "SERVICE_RESTARTED",
        state: "failed",
      },
    ]);
    expect(
      reopenedStore.listEvents(second.task.id).map(({ state }) => state),
    ).toEqual(["queued", "running", "recovering", "failed"]);
    expect(reopenedStore.list(request.canvasId)).toHaveLength(2);
    reopenedStore.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("provider-attempt migration preserves the conservative historical count", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-provider-attempt-history-"));
  try {
    const taskId = "historical-provider-attempts-task";
    const migrated = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    try {
      migrated.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        BEGIN IMMEDIATE;
      `);
      applyPendingSchemaMigrationsInTransaction(migrated, {
        sourceVersion: 0,
        targetVersion: 14,
      });
      migrated.exec("COMMIT");
      const timestamp = new Date().toISOString();
      migrated.prepare(`
        INSERT INTO generation_tasks (
          id, canvas_id, node_id, kind, prompt, model, parameters,
          idempotency_key, request_fingerprint, state, attempt,
          created_at, updated_at, owner_id, provider_profile_id,
          provider_model_id, model_configuration
        ) VALUES (?, ?, ?, 'image', ?, ?, '{}', ?, ?, 'failed', 3,
          ?, ?, '__test__', ?, ?, '{}')
      `).run(
        taskId,
        "historical-provider-count",
        "historical-image-node",
        "preserve old provider attempt observations",
        "historical-image-model",
        "historical-provider-attempts-001",
        "f".repeat(64),
        timestamp,
        timestamp,
        "historical-provider",
        "openai/gpt-image-2",
      );
      migrated.exec("BEGIN IMMEDIATE");
      applyPendingSchemaMigrationsInTransaction(migrated, { sourceVersion: 14 });
      migrated.exec("COMMIT");

      const attempts = migrated.prepare(`
        SELECT execution_attempt, evidence
        FROM generation_provider_attempts
        WHERE task_id = ?
        ORDER BY execution_attempt
      `).all(taskId) as Array<{
        evidence: string;
        execution_attempt: number;
      }>;
      expect(attempts).toEqual([
        { evidence: "historical-execution-attempt", execution_attempt: 1 },
        { evidence: "historical-execution-attempt", execution_attempt: 2 },
        { evidence: "historical-execution-attempt", execution_attempt: 3 },
      ]);
      expect(generationProviderAttemptCounts(migrated)).toEqual({
        historicalEstimatedProviderAttempts: 3,
        paidProviderRequests: 0,
      });
    } finally {
      if (migrated.isTransaction) migrated.exec("ROLLBACK");
      migrated.close();
    }
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("cancellation and the Provider boundary are atomic in both race orders", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-provider-cancel-race-"));
  const store = createGenerationTaskStore(dataDirectory);
  const task = (suffix: string) => store.create({
    canvasId: "provider-cancel-race",
    costCurrency: "CNY" as const,
    idempotencyKey: `provider-cancel-race-${suffix}`,
    kind: "text" as const,
    model: "provider-cancel-text",
    nodeId: `provider-cancel-node-${suffix}`,
    ownerId: "__test__",
    parameters: {},
    prompt: "atomic cancellation test",
    providerModelId: "doubao-seed-2-0-lite-260428",
    providerProfileId: "provider-cancel-ark",
  }).task;
  try {
    const cancelledFirst = task("cancel-first");
    store.transition(cancelledFirst.id, "running");
    expect(store.cancelBeforeProviderAttempt(cancelledFirst.id, {
      code: "USER_CANCELLED",
      message: "cancel before provider boundary",
    })).toMatchObject({ state: "cancelled" });
    expect(() => store.recordProviderAttempt(cancelledFirst.id)).toThrow(
      GenerationProviderAttemptBlockedError,
    );

    const boundaryFirst = task("boundary-first");
    store.transition(boundaryFirst.id, "running");
    store.recordProviderAttempt(boundaryFirst.id);
    expect(() => store.cancelBeforeProviderAttempt(boundaryFirst.id, {
      code: "USER_CANCELLED",
      message: "must not abort an unknown paid outcome",
    })).toThrow(GenerationTaskProviderBoundaryError);
    expect(store.get(boundaryFirst.id)).toMatchObject({ state: "running" });

    const database = openAppDatabase(dataDirectory);
    try {
      expect(generationProviderAttemptCounts(database)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 1,
      });
    } finally {
      database.close();
    }
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("asynchronous retries preserve paid Provider task IDs and only terminal failure starts over", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-provider-task-resume-"));
  let store = createGenerationTaskStore(dataDirectory);
  const createAsyncTask = (
    kind: "audio" | "video",
    suffix: string,
  ) => store.create({
    canvasId: "provider-task-resume",
    costCurrency: kind === "video" ? "CNY" : "USD",
    idempotencyKey: `provider-task-resume-${kind}-${suffix}`,
    kind,
    model: `provider-task-model-${kind}`,
    nodeId: `provider-task-node-${kind}-${suffix}`,
    ownerId: "__test__",
    parameters: {},
    prompt: "resume existing provider task",
    providerModelId: kind === "video"
      ? "doubao-seedance-2-0-mini-260615"
      : "mureka-8",
    providerProfileId: `provider-task-${kind}`,
  }).task;
  try {
    for (const [kind, failureCode] of [
      ["video", "NETWORK"],
      ["audio", "REMOTE"],
    ] as const) {
      const task = createAsyncTask(kind, "resume");
      store.transition(task.id, "running");
      store.recordProviderAttempt(task.id);
      const providerTaskId = `${kind}-provider-task-resume`;
      store.setProviderTaskId(task.id, providerTaskId);
      store.transition(task.id, "failed", {
        code: failureCode,
        message: "poll or download interrupted",
      });
      expect(store.transition(
        task.id,
        "retrying",
        undefined,
        { preserveProviderTaskId: true },
      )).toMatchObject({ providerTaskId, state: "retrying" });
      expect(() => store.cancelBeforeProviderAttempt(task.id, {
        code: "USER_CANCELLED",
        message: "a retrying Provider task cannot be discarded locally",
      })).toThrow(GenerationTaskProviderBoundaryError);
      store.transition(task.id, "queued");
      expect(() => store.cancelBeforeProviderAttempt(task.id, {
        code: "USER_CANCELLED",
        message: "a preserved Provider task cannot be discarded locally",
      })).toThrow(GenerationTaskProviderBoundaryError);
      expect(store.transition(task.id, "running")).toMatchObject({
        attempt: 2,
        providerTaskId,
        state: "running",
      });
    }

    store.close();
    store = createGenerationTaskStore(dataDirectory);
    const recovering = store.listRecovering();
    expect(recovering).toHaveLength(2);
    expect(recovering.every((task) => Boolean(task.providerTaskId))).toBe(true);
    expect(failRecoveredGenerationTasks(store)).toEqual([]);
    for (const task of recovering) {
      expect(store.resume(task.id)).toMatchObject({
        providerTaskId: task.providerTaskId,
        state: "running",
      });
      store.transition(task.id, "failed", {
        code: "TIMEOUT",
        message: "resume fixture complete",
      });
    }

    for (const kind of ["video", "audio"] as const) {
      const terminal = createAsyncTask(kind, "terminal");
      store.transition(terminal.id, "running");
      store.recordProviderAttempt(terminal.id);
      store.setProviderTaskId(
        terminal.id,
        `${kind}-provider-task-terminal`,
      );
      store.transition(terminal.id, "failed", {
        code: "PROVIDER_FAILED",
        message: "provider reported a terminal failure",
      });
      expect(store.transition(terminal.id, "retrying")).toMatchObject({
        providerTaskId: undefined,
        state: "retrying",
      });
      store.transition(terminal.id, "queued");
      store.transition(terminal.id, "running");
      expect(store.recordProviderAttempt(terminal.id)).toMatchObject({
        executionAttempt: 2,
      });
    }

    const database = openAppDatabase(dataDirectory);
    try {
      expect(generationProviderAttemptCounts(database)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 6,
      });
    } finally {
      database.close();
    }
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("explicit abandon preserves accepted paid evidence and cannot create a retry request", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  let store: ReturnType<typeof createGenerationTaskStore> | undefined =
    createGenerationTaskStore(dataDirectory);
  const task = store.create({
    canvasId: "provider-result-abandon",
    idempotencyKey: `provider-result-abandon-${crypto.randomUUID()}`,
    kind: "video",
    model: "provider-result-abandon-video",
    modelConfiguration: { providerProtocol: "native" },
    nodeId: "provider-result-abandon-node",
    ownerId: "__test__",
    parameters: {},
    prompt: "preserve the unknown paid result without polling it again",
    providerModelId: "provider-result-abandon-model",
    providerProfileId: "provider-result-abandon-profile",
  }).task;
  const providerTaskId = `abandoned-remote-${crypto.randomUUID()}`;
  try {
    store.transition(task.id, "running");
    store.recordProviderAttempt(task.id);
    store.setProviderTaskId(task.id, providerTaskId);
    const failed = store.transition(task.id, "failed", {
      code: "AUTH",
      message: "poll authorization failed after the remote task was accepted",
    })!;
    const retryFence = seedGenerationRetryBinding(
      dataDirectory,
      failed,
      "provider-result-abandon-input-key",
    );
    expect(store.getProviderAttemptForTask(task.id)).toMatchObject({
      failureCode: "AUTH",
      outcome: "accepted",
      providerTaskId,
    });
    store.close();
    store = undefined;

    const unacknowledged = await request.post(
      `/api/generation-tasks/${task.id}/abandon`,
      {
        data: {
          expectedAttempt: failed.attempt,
          expectedUpdatedAt: failed.updatedAt,
        },
      },
    );
    expect(unacknowledged.status()).toBe(400);
    await expect(unacknowledged.json()).resolves.toMatchObject({
      code: "ABANDON_ACK_REQUIRED",
    });

    const staleView = await request.post(
      `/api/generation-tasks/${task.id}/abandon`,
      {
        data: {
          acknowledgeRemoteResultMayBeLost: true,
          expectedAttempt: failed.attempt,
          expectedFixtureScopeId: "",
          expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
        },
      },
    );
    expect(staleView.status()).toBe(409);
    await expect(staleView.json()).resolves.toMatchObject({
      code: "PROVIDER_RESULT_NOT_ABANDONABLE",
    });

    const abandoned = await request.post(
      `/api/generation-tasks/${task.id}/abandon`,
      {
        data: {
          acknowledgeRemoteResultMayBeLost: true,
          expectedAttempt: failed.attempt,
          expectedFixtureScopeId: "",
          expectedUpdatedAt: failed.updatedAt,
        },
      },
    );
    expect(abandoned.status()).toBe(200);
    const abandonedTask = await abandoned.json() as GenerationTask;
    expect(abandonedTask).toMatchObject({
      errorCode: "USER_ABANDONED",
      abandonAllowed: false,
      retryAllowed: false,
      retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
      state: "cancelled",
    });

    const retry = await request.post(
      `/api/generation-tasks/${task.id}/retry`,
      {
        data: {
          ...retryFence,
          expectedAttempt: abandonedTask.attempt,
          expectedUpdatedAt: abandonedTask.updatedAt,
        },
      },
    );
    expect(retry.status()).toBe(409);
    await expect(retry.json()).resolves.toMatchObject({
      code: "RETRY_OUTCOME_UNKNOWN",
    });

    store = createGenerationTaskStore(dataDirectory);
    expect(store.getProviderAttemptForTask(task.id)).toMatchObject({
      failureCode: "AUTH",
      outcome: "accepted",
      providerTaskId,
    });
    expect(store.listEvents(task.id).map(({ errorCode, state }) => ({
      errorCode,
      state,
    }))).toEqual([
      { errorCode: undefined, state: "queued" },
      { errorCode: undefined, state: "running" },
      { errorCode: "AUTH", state: "failed" },
      { errorCode: "USER_ABANDONED", state: "cancelled" },
    ]);
    const database = openAppDatabase(dataDirectory);
    try {
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts
        WHERE task_id = ? AND evidence = 'provider-boundary'
      `).get(task.id)).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  } finally {
    store?.close();
  }
});

test("explicit abandon also releases a failed synchronous result without a remote task ID", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  let store: ReturnType<typeof createGenerationTaskStore> | undefined =
    createGenerationTaskStore(dataDirectory);
  const task = store.create({
    canvasId: "synchronous-result-abandon",
    idempotencyKey: `synchronous-result-abandon-${crypto.randomUUID()}`,
    kind: "image",
    model: "synchronous-result-image",
    modelConfiguration: { providerProtocol: "native" },
    nodeId: "synchronous-result-abandon-node",
    ownerId: "__test__",
    parameters: {},
    prompt: "abandon a response that failed local publication",
    providerModelId: "synchronous-result-model",
    providerProfileId: "synchronous-result-profile",
  }).task;
  try {
    const running = store.transition(task.id, "running")!;
    const paid = store.recordProviderAttempt(task.id);
    store.markProviderResponseReceived({
      executionAttempt: paid.executionAttempt,
      taskId: task.id,
    });
    const failed = store.transition(task.id, "failed", {
      code: "MEDIA_PUBLICATION_FAILED",
      message: "the paid response could not be published locally",
    })!;
    expect(failed).toMatchObject({
      attempt: running.attempt,
      providerTaskId: undefined,
      state: "failed",
    });
    expect(store.getProviderAttemptForTask(task.id)).toMatchObject({
      executionAttempt: running.attempt,
      outcome: "response-received",
      providerTaskId: undefined,
    });
    store.close();
    store = undefined;

    const summary = await request.get(`/api/generation-tasks/${task.id}`);
    expect(summary.status()).toBe(200);
    const summaryBody = await summary.json();
    expect(summaryBody).toMatchObject({
      abandonAllowed: true,
      retryAllowed: false,
      retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
    });
    expect(summaryBody).not.toHaveProperty("providerTaskId");

    const abandoned = await request.post(
      `/api/generation-tasks/${task.id}/abandon`,
      {
        data: {
          acknowledgeRemoteResultMayBeLost: true,
          expectedAttempt: failed.attempt,
          expectedFixtureScopeId: "",
          expectedUpdatedAt: failed.updatedAt,
        },
      },
    );
    expect(abandoned.status()).toBe(200);
    await expect(abandoned.json()).resolves.toMatchObject({
      abandonAllowed: false,
      errorCode: "USER_ABANDONED",
      retryAllowed: false,
      retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
      state: "cancelled",
    });

    store = createGenerationTaskStore(dataDirectory);
    expect(store.getProviderAttemptForTask(task.id)).toMatchObject({
      executionAttempt: running.attempt,
      outcome: "response-received",
      providerTaskId: undefined,
    });
    expect(store.listEvents(task.id).map(({ errorCode, state }) => ({
      errorCode,
      state,
    }))).toEqual([
      { errorCode: undefined, state: "queued" },
      { errorCode: undefined, state: "running" },
      { errorCode: "MEDIA_PUBLICATION_FAILED", state: "failed" },
      { errorCode: "USER_ABANDONED", state: "cancelled" },
    ]);
    const database = openAppDatabase(dataDirectory);
    try {
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts
        WHERE task_id = ? AND evidence = 'provider-boundary'
      `).get(task.id)).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  } finally {
    store?.close();
  }
});

test("new paid retry blocks an unresolved older ledger when the current execution has none", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  let store: ReturnType<typeof createGenerationTaskStore> | undefined =
    createGenerationTaskStore(dataDirectory);
  const task = store.create({
    canvasId: "older-unknown-paid-ledger",
    idempotencyKey: `older-unknown-paid-ledger-${crypto.randomUUID()}`,
    kind: "image",
    model: "older-unknown-image",
    modelConfiguration: { providerProtocol: "native" },
    nodeId: "older-unknown-node",
    ownerId: "__test__",
    parameters: {},
    prompt: "never duplicate an unresolved older paid request",
    providerModelId: "older-unknown-model",
    providerProfileId: "older-unknown-profile",
  }).task;
  try {
    store.transition(task.id, "running");
    store.recordProviderAttempt(task.id);
    store.transition(task.id, "failed", {
      code: "NETWORK",
      message: "the first paid outcome is unknown",
    });
    store.transition(task.id, "retrying");
    store.transition(task.id, "queued");
    store.transition(task.id, "running");
    const failed = store.transition(task.id, "failed", {
      code: "MODEL_UNAVAILABLE",
      message: "the next local execution failed before its Provider boundary",
    })!;
    const retryFence = seedGenerationRetryBinding(
      dataDirectory,
      failed,
      "older-unknown-paid-ledger-input-key",
    );
    expect(failed.attempt).toBe(2);
    expect(store.getProviderAttemptForTask(task.id)).toBeUndefined();
    expect(store.hasUnsafeProviderAttemptForNewPaidRetry(task.id)).toBe(true);
    store.close();
    store = undefined;

    const before = openAppDatabase(dataDirectory);
    let paidBefore = 0;
    try {
      paidBefore = generationProviderAttemptCounts(before).paidProviderRequests;
    } finally {
      before.close();
    }
    const summary = await request.get(`/api/generation-tasks/${task.id}`);
    expect(summary.status()).toBe(200);
    await expect(summary.json()).resolves.toMatchObject({
      retryAllowed: false,
      retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
    });
    const retry = await request.post(`/api/generation-tasks/${task.id}/retry`, {
      data: retryFence,
    });
    expect(retry.status()).toBe(409);
    await expect(retry.json()).resolves.toMatchObject({
      code: "RETRY_OUTCOME_UNKNOWN",
    });
    const after = openAppDatabase(dataDirectory);
    try {
      expect(generationProviderAttemptCounts(after).paidProviderRequests)
        .toBe(paidBefore);
      expect(after.prepare(`
        SELECT execution_attempt, outcome
        FROM generation_provider_attempts
        WHERE task_id = ?
        ORDER BY execution_attempt
      `).all(task.id)).toEqual([
        { execution_attempt: 1, outcome: "outcome-unknown" },
      ]);
    } finally {
      after.close();
    }
  } finally {
    store?.close();
  }
});

test("retry refuses a new paid attempt when a sibling with the same input already holds accepted evidence", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  let store: ReturnType<typeof createGenerationTaskStore> | undefined =
    createGenerationTaskStore(dataDirectory);
  const input = {
    canvasId: "sibling-retry-gate",
    kind: "image" as const,
    model: "sibling-retry-image",
    modelConfiguration: { providerProtocol: "native" },
    nodeId: "sibling-retry-node",
    ownerId: "__test__",
    parameters: {},
    prompt: "identical sibling retry input",
    providerModelId: "sibling-retry-model",
    providerProfileId: "sibling-retry-profile",
  };
  try {
    const first = store.create({
      ...input,
      idempotencyKey: "sibling-retry-first-0001",
    }).task;
    const second = store.create({
      ...input,
      idempotencyKey: "sibling-retry-second-0002",
    }).task;
    store.transition(first.id, "running");
    const paid = store.recordProviderAttempt(first.id);
    store.attachProviderTaskId({
      executionAttempt: paid.executionAttempt,
      providerTaskId: "sibling-retry-remote-0001",
      taskId: first.id,
    });
    store.transition(first.id, "failed", {
      code: "NETWORK",
      message: "polling stopped after Provider acceptance",
    });
    store.transition(second.id, "running");
    const failed = store.transition(second.id, "failed", {
      code: "RATE_LIMIT",
      message: "local failure before a new paid attempt",
    })!;
    const retryFence = seedGenerationRetryBinding(
      dataDirectory,
      failed,
      "sibling-retry-input-key",
    );
    expect(store.getProviderAttemptForTask(first.id)).toMatchObject({
      outcome: "accepted",
    });
    store.close();
    store = undefined;

    const before = openAppDatabase(dataDirectory);
    let paidBefore = 0;
    try {
      paidBefore = generationProviderAttemptCounts(before).paidProviderRequests;
    } finally {
      before.close();
    }
    const retry = await request.post(
      `/api/generation-tasks/${second.id}/retry`,
      { data: retryFence },
    );
    expect(retry.status()).toBe(409);
    await expect(retry.json()).resolves.toMatchObject({
      code: "RETRY_OUTCOME_UNKNOWN",
    });
    const after = openAppDatabase(dataDirectory);
    try {
      expect(generationProviderAttemptCounts(after).paidProviderRequests)
        .toBe(paidBefore);
    } finally {
      after.close();
    }
  } finally {
    store?.close();
  }
});

test("atomic admission serializes 20 contenders and replays stable owner-scoped intent first", async () => {
  test.setTimeout(120_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-atomic-admission-"));
  const seed = openAppDatabase(dataDirectory);
  seedAtomicGenerationFixture(seed);
  seed.close();
  const stores = Array.from(
    { length: 4 },
    () => createGenerationTaskStore(dataDirectory),
  );
  const firstReleasePath = join(dataDirectory, "atomic-first.release");
  const secondReleasePath = join(dataDirectory, "atomic-second.release");
  let children: Array<ReturnType<typeof runAtomicAdmissionChild>> = [];
  let childrenFinished = false;
  try {
    const staleConfiguration = atomicImageRequest({
      idempotencyKey: "atomic-stale-configuration-0000",
    });
    expect(() => stores[0].admitOrGet({
      ...staleConfiguration,
      modelConfiguration: {
        ...staleConfiguration.modelConfiguration,
        providerConfigurationVersion: 2,
      },
    })).toThrow(GenerationProviderAttemptBlockedError);

    const replayRequest = atomicImageRequest({
      idempotencyKey: "atomic-same-intent-0001",
    });
    // Current-schema opens deliberately fail closed while another cooperative
    // process holds the short open reservation. Start each child/store
    // serially, then release all 20 already-open stores together so this case
    // continues to test the intended cross-process admission race rather than
    // an unsupported concurrent startup race.
    for (let index = 0; index < 20; index += 1) {
      const child = runAtomicAdmissionChild(
        dataDirectory,
        firstReleasePath,
        secondReleasePath,
        atomicImageRequest({
          idempotencyKey: `atomic-distinct-${String(index).padStart(3, "0")}`,
          nodeId: `atomic-node-${index}`,
        }),
        replayRequest,
      );
      children.push(child);
      await child.ready;
    }
    await writeFile(firstReleasePath, "release", { flag: "wx" });
    const distinct = await Promise.all(children.map(({ first }) => first));
    expect(distinct.filter(({ taskId }) => taskId)).toHaveLength(1);
    expect(distinct.filter(({ errorCode }) =>
      errorCode === "USER_CONCURRENCY"
    )).toHaveLength(19);

    const control = openAppDatabase(dataDirectory);
    control.prepare(`
      UPDATE generation_tasks
      SET state = 'failed', error_code = 'FIXTURE_DONE',
        error_message = 'fixture complete'
      WHERE state = 'queued'
    `).run();
    control.prepare(`
      UPDATE generation_safety_settings
      SET per_user_concurrency = 100, image_concurrency = 100
      WHERE id = 1
    `).run();
    control.close();

    await writeFile(secondReleasePath, "release", { flag: "wx" });
    const replayed = await Promise.all(children.map(({ second }) => second));
    await Promise.all(children.map(({ done }) => done));
    childrenFinished = true;
    expect(replayed.filter(({ created }) => created)).toHaveLength(1);
    expect(new Set(replayed.map(({ taskId }) => taskId)).size).toBe(1);
    const original = stores[0].get(replayed[0].taskId!);
    expect(original).toBeDefined();
    const sameIntentEvidence = openAppDatabase(dataDirectory);
    try {
      expect(sameIntentEvidence.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_tasks
        WHERE owner_id = ? AND canvas_id = ? AND idempotency_key = ?
      `).get(
        replayRequest.ownerId,
        replayRequest.canvasId,
        replayRequest.idempotencyKey,
      )).toEqual({ count: 1 });
      expect(sameIntentEvidence.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_task_events AS events
        JOIN generation_tasks AS tasks ON tasks.id = events.task_id
        WHERE tasks.owner_id = ? AND tasks.canvas_id = ?
          AND tasks.idempotency_key = ? AND events.state = 'queued'
      `).get(
        replayRequest.ownerId,
        replayRequest.canvasId,
        replayRequest.idempotencyKey,
      )).toEqual({ count: 1 });
    } finally {
      sameIntentEvidence.close();
    }

    const rawClientIntent = {
      canvasId: "atomic-canvas",
      kind: "image",
      nodeId: "raw-client-intent-node",
      parameters: { count: 1, size: "1k" },
      prompt: "the original client prompt before upstream composition",
    };
    const composedRequest = {
      ...atomicImageRequest({
        idempotencyKey: "atomic-raw-client-intent-0002",
        nodeId: "raw-client-intent-node",
      }),
      prompt: "resolved upstream text plus the client prompt",
      requestIntent: rawClientIntent,
    };
    const composed = stores[0].admitOrGet(composedRequest).task;

    const stopped = openAppDatabase(dataDirectory);
    stopped.prepare(`
      UPDATE generation_safety_settings
      SET emergency_stop = 1, global_enabled = 0
      WHERE id = 1
    `).run();
    stopped.prepare(`
      UPDATE model_profiles
      SET status = 'draft', updated_at = '2026-08-11T09:00:00.000Z'
      WHERE id = 'atomic-image-model'
    `).run();
    stopped.close();

    expect(stores[0].getIdempotentIntent({
      canvasId: replayRequest.canvasId,
      idempotencyKey: replayRequest.idempotencyKey,
      ownerId: replayRequest.ownerId!,
      requestIntent: replayRequest.requestIntent!,
    })?.id).toBe(original!.id);
    expect(stores[1].admitOrGet({
      ...replayRequest,
      expectedCanvasRevision: 999,
      modelConfiguration: { providerConfigurationVersion: 999 },
    })).toMatchObject({ created: false, task: { id: original!.id } });
    expect(stores[1].admitOrGet({
      ...composedRequest,
      expectedCanvasRevision: 999,
      model: "a-different-currently-resolved-model",
      modelConfiguration: {},
      prompt: "a different recomposition of the same raw client intent",
    })).toMatchObject({ created: false, task: { id: composed.id } });
    expect(stores[0].getIdempotentIntent({
      canvasId: composedRequest.canvasId,
      idempotencyKey: composedRequest.idempotencyKey,
      ownerId: composedRequest.ownerId!,
      requestIntent: rawClientIntent,
    })?.id).toBe(composed.id);

    const differentIntent = {
      ...replayRequest,
      prompt: "a different stable client intent",
      requestIntent: {
        ...replayRequest.requestIntent,
        prompt: "a different stable client intent",
      },
    };
    expect(() => stores[2].admitOrGet(differentIntent)).toThrow(
      GenerationTaskConflictError,
    );

    const enabled = openAppDatabase(dataDirectory);
    enabled.prepare(`
      UPDATE generation_safety_settings
      SET emergency_stop = 0, global_enabled = 1
      WHERE id = 1
    `).run();
    enabled.prepare(`
      UPDATE model_profiles
      SET status = 'published', updated_at = '2026-08-11T09:01:00.000Z'
      WHERE id = 'atomic-image-model'
    `).run();
    enabled.close();
    const otherOwner = stores[3].admitOrGet(atomicImageRequest({
      idempotencyKey: replayRequest.idempotencyKey,
      ownerId: "atomic-owner-b",
    }));
    expect(otherOwner.created).toBe(true);
    expect(otherOwner.task.id).not.toBe(original!.id);
  } finally {
    await Promise.all([
      writeFile(firstReleasePath, "release").catch(() => undefined),
      writeFile(secondReleasePath, "release").catch(() => undefined),
    ]);
    if (!childrenFinished) {
      for (const child of children) child.terminate();
      await Promise.all(children.map(({ done }) => done.catch(() => undefined)));
    }
    for (const store of stores) store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("the final boundary preserves stop evidence, auth outcomes, and Provider ID scope", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-final-boundary-"));
  const seed = openAppDatabase(dataDirectory);
  seedAtomicGenerationFixture(seed);
  seed.prepare(`
    UPDATE generation_safety_settings
    SET per_user_concurrency = 20, image_concurrency = 20
    WHERE id = 1
  `).run();
  seed.close();
  const store = createGenerationTaskStore(dataDirectory);
  const control = openAppDatabase(dataDirectory);
  try {
    const taskA = store.admitOrGet(atomicImageRequest({
      idempotencyKey: "boundary-owner-a-0001",
      ownerId: "atomic-owner-a",
    })).task;
    store.transition(taskA.id, "running");
    control.prepare(`
      UPDATE generation_safety_settings SET emergency_stop = 1 WHERE id = 1
    `).run();
    expect(() => store.recordProviderAttempt(taskA.id)).toThrow(
      GenerationProviderAttemptBlockedError,
    );
    expect(store.getProviderAttemptForTask(taskA.id)).toBeUndefined();

    control.prepare(`
      UPDATE generation_safety_settings SET emergency_stop = 0 WHERE id = 1
    `).run();
    const paidA = store.recordProviderAttempt(taskA.id);
    control.prepare(`
      UPDATE generation_safety_settings SET emergency_stop = 1 WHERE id = 1
    `).run();
    store.attachProviderTaskId({
      credentialRevision: 1,
      executionAttempt: paidA.executionAttempt,
      providerTaskId: "shared-remote-task-0001",
      taskId: taskA.id,
    });
    expect(store.getProviderAttemptForTask(taskA.id)).toMatchObject({
      executionAttempt: 1,
      outcome: "accepted",
      providerTaskId: "shared-remote-task-0001",
    });
    expect(() => store.settleProviderAttempt({
      executionAttempt: paidA.executionAttempt,
      failureCode: "AUTH",
      outcome: "definitive-rejected",
      taskId: taskA.id,
    })).toThrow();

    control.prepare(`
      UPDATE generation_safety_settings SET emergency_stop = 0 WHERE id = 1
    `).run();
    const taskB = store.admitOrGet(atomicImageRequest({
      idempotencyKey: "boundary-owner-b-0001",
      ownerId: "atomic-owner-b",
    })).task;
    store.transition(taskB.id, "running");
    const paidB = store.recordProviderAttempt(taskB.id);
    expect(() => store.attachProviderTaskId({
      credentialRevision: 1,
      executionAttempt: paidB.executionAttempt,
      providerTaskId: "shared-remote-task-0001",
      taskId: taskB.id,
    })).not.toThrow();

    const duplicateForA = store.admitOrGet(atomicImageRequest({
      idempotencyKey: "boundary-owner-a-0002",
      nodeId: "atomic-image-node-2",
      ownerId: "atomic-owner-a",
    })).task;
    store.transition(duplicateForA.id, "running");
    const duplicateAttempt = store.recordProviderAttempt(duplicateForA.id);
    expect(() => store.attachProviderTaskId({
      credentialRevision: 1,
      executionAttempt: duplicateAttempt.executionAttempt,
      providerTaskId: "shared-remote-task-0001",
      taskId: duplicateForA.id,
    })).toThrow();
    expect(store.get(duplicateForA.id)?.providerTaskId).toBeUndefined();
    expect(store.getProviderAttemptForTask(duplicateForA.id)).toMatchObject({
      outcome: "boundary-claimed",
    });

    const bypassedAdmission = store.create(atomicImageRequest({
      idempotencyKey: "boundary-bypassed-admission-0003",
      nodeId: "bypassed-admission-node",
      ownerId: "atomic-owner-b",
    })).task;
    store.transition(bypassedAdmission.id, "running");
    expect(() => store.recordProviderAttempt(bypassedAdmission.id)).toThrow(
      GenerationProviderAttemptBlockedError,
    );

    store.transition(taskA.id, "failed", {
      code: "AUTH",
      message: "poll authentication failed after acceptance",
    });
    expect(store.getProviderAttemptForTask(taskA.id)).toMatchObject({
      failureCode: "AUTH",
      finishedAt: expect.any(String),
      outcome: "accepted",
    });

    const rejected = store.create({
      canvasId: "boundary-outcome-fixture",
      idempotencyKey: "boundary-definitive-auth-0001",
      kind: "image",
      model: "fixture-image-model",
      nodeId: "boundary-definitive-node",
      ownerId: "__test__",
      prompt: "definitive submit rejection",
      providerModelId: "fixture-provider-model",
      providerProfileId: "fixture-provider",
    }).task;
    store.transition(rejected.id, "running");
    store.recordProviderAttempt(rejected.id);
    store.transition(rejected.id, "failed", {
      code: "AUTH",
      message: "submit was definitively rejected",
    });
    expect(store.getProviderAttemptForTask(rejected.id)).toMatchObject({
      failureCode: "AUTH",
      outcome: "outcome-unknown",
    });
  } finally {
    control.close();
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("current credential success outranks a late old-revision auth incident", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-auth-late-old-revision-"));
  const seed = openAppDatabase(dataDirectory);
  seedAtomicGenerationFixture(seed, ["atomic-owner-a"]);
  seed.prepare(`
    UPDATE generation_safety_settings
    SET per_user_concurrency = 10, image_concurrency = 10
    WHERE id = 1
  `).run();
  seed.close();
  const store = createGenerationTaskStore(dataDirectory);
  const control = openAppDatabase(dataDirectory);
  try {
    const revisionOne = store.admitOrGet(atomicImageRequest({
      idempotencyKey: "late-auth-revision-one-0001",
    })).task;
    store.transition(revisionOne.id, "running");
    store.recordProviderAttempt(revisionOne.id);
    store.transition(revisionOne.id, "failed", {
      code: "AUTH",
      message: "revision one auth incident",
    });
    control.prepare(`
      UPDATE generation_provider_attempts
      SET finished_at = '2026-08-11T10:00:00.000Z'
      WHERE task_id = ? AND execution_attempt = 1
    `).run(revisionOne.id);
    control.prepare(`
      UPDATE account_provider_credential_epochs
      SET credential_revision = 2, updated_at = '2026-08-11T10:01:00.000Z'
      WHERE account_id = 'atomic-owner-a'
        AND provider_profile_id = 'atomic-provider-profile'
    `).run();
    control.prepare(`
      UPDATE account_provider_credentials
      SET credential_version = 2, key_status = 'valid',
        updated_at = '2026-08-11T10:01:00.000Z'
      WHERE account_id = 'atomic-owner-a'
        AND provider_profile_id = 'atomic-provider-profile'
    `).run();

    const recovered = store.admitOrGet(atomicImageRequest({
      credentialRevision: 2,
      idempotencyKey: "late-auth-revision-two-success-0002",
      nodeId: "late-auth-revision-two-success",
    })).task;
    store.transition(recovered.id, "running");
    const recoveredAttempt = store.recordProviderAttempt(recovered.id);
    store.settleProviderAttempt({
      executionAttempt: recoveredAttempt.executionAttempt,
      finishedAt: new Date("2026-08-11T10:02:00.000Z"),
      outcome: "completed",
      taskId: recovered.id,
    });
    control.prepare(`
      UPDATE generation_tasks SET state = 'success' WHERE id = ?
    `).run(recovered.id);

    // A delayed old-revision observation must not poison the already-proven
    // current credential revision, even when its timestamp sorts later.
    control.prepare(`
      UPDATE generation_provider_attempts
      SET finished_at = '2099-01-01T00:00:00.000Z'
      WHERE task_id = ? AND execution_attempt = 1
    `).run(revisionOne.id);
    const afterLateOldAuth = store.admitOrGet(atomicImageRequest({
      credentialRevision: 2,
      idempotencyKey: "late-auth-current-revision-0003",
      nodeId: "late-auth-current-revision",
    })).task;
    store.transition(afterLateOldAuth.id, "running");
    expect(store.recordProviderAttempt(afterLateOldAuth.id)).toMatchObject({
      executionAttempt: 1,
    });
  } finally {
    control.close();
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("resume settles the original paid execution and complete rolls back with its ledger", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-resume-ledger-"));
  const store = createGenerationTaskStore(dataDirectory);
  const createFixture = (suffix: string) => store.create({
    canvasId: "resume-ledger",
    idempotencyKey: `resume-ledger-${suffix}`,
    kind: "image",
    model: "fixture-image-model",
    nodeId: `resume-ledger-${suffix}`,
    ownerId: "__test__",
    prompt: "resume one accepted remote task",
    providerModelId: "fixture-provider-model",
    providerProfileId: "fixture-provider",
  }).task;
  try {
    const resumed = createFixture("original-0001");
    store.transition(resumed.id, "running");
    const paid = store.recordProviderAttempt(resumed.id);
    store.attachProviderTaskId({
      executionAttempt: paid.executionAttempt,
      providerTaskId: "resume-original-provider-task",
      taskId: resumed.id,
    });
    store.transition(resumed.id, "failed", {
      code: "NETWORK",
      message: "poll interrupted after the Provider accepted the task",
    });
    const failedResume = store.get(resumed.id)!;
    const retryFence = seedGenerationRetryBinding(
      dataDirectory,
      failedResume,
      "resume-ledger-input-key",
    );
    expect(() => store.admitRetry({
      ...retryFence,
      mode: "new-paid-attempt",
      snapshot: {
        credentialRevision: 1,
        modelConfiguration: {},
        providerModelId: "fixture-provider-model",
        providerProfileId: "fixture-provider",
      },
      taskId: resumed.id,
    })).toThrow(GenerationProviderAttemptBlockedError);
    expect(store.admitRetry({
      ...retryFence,
      mode: "resume-provider-task",
      taskId: resumed.id,
    })).toMatchObject({
      attempt: 1,
      providerTaskId: "resume-original-provider-task",
      state: "running",
    });
    expect(() => store.recordProviderAttempt(resumed.id)).toThrow(
      GenerationProviderAttemptBlockedError,
    );
    expect(store.markProviderResponseReceivedForTask(resumed.id)).toEqual({
      executionAttempt: 1,
    });
    store.complete(resumed.id, {
      actualCostMicrounits: 123,
      resultAssetId: "resume-result-asset",
    });
    expect(store.getProviderAttemptForTask(resumed.id)).toMatchObject({
      executionAttempt: 1,
      outcome: "completed",
      providerTaskId: "resume-original-provider-task",
    });

    const rollback = createFixture("rollback-0002");
    store.transition(rollback.id, "running");
    const rollbackPaid = store.recordProviderAttempt(rollback.id);
    store.attachProviderTaskId({
      executionAttempt: rollbackPaid.executionAttempt,
      providerTaskId: "rollback-provider-task",
      taskId: rollback.id,
    });
    const database = openAppDatabase(dataDirectory);
    database.exec(`
      CREATE TRIGGER reject_provider_attempt_completion
      BEFORE UPDATE OF outcome ON generation_provider_attempts
      WHEN NEW.outcome = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'fixture provider ledger fault');
      END;
    `);
    try {
      expect(() => store.complete(rollback.id, {
        actualCostMicrounits: 456,
        resultAssetId: "rollback-result-asset",
      })).toThrow();
    } finally {
      database.exec("DROP TRIGGER reject_provider_attempt_completion");
      database.close();
    }
    expect(store.get(rollback.id)).toMatchObject({ state: "running" });
    expect(store.getProviderAttemptForTask(rollback.id)).toMatchObject({
      outcome: "accepted",
    });
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("queued reopen loses neither dispatch work nor Provider-boundary evidence", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-queued-reopen-"));
  let store = createGenerationTaskStore(dataDirectory);
  try {
    const queued = store.create({
      canvasId: "queued-reopen",
      idempotencyKey: "queued-reopen-0001",
      kind: "image",
      nodeId: "queued-reopen-node",
      ownerId: "__test__",
      prompt: "committed before launch",
    }).task;
    expect(store.listQueued().map(({ id }) => id)).toContain(queued.id);
    store.close();

    store = createGenerationTaskStore(dataDirectory);
    expect(store.listQueued().map(({ id }) => id)).toContain(queued.id);
    expect(store.listActive().map(({ id }) => id)).toContain(queued.id);
    expect(store.getProviderAttemptForTask(queued.id)).toBeUndefined();
    store.close();

    store = createGenerationTaskStore(dataDirectory);
    expect(store.listQueued().map(({ id }) => id)).toContain(queued.id);
    const database = openAppDatabase(dataDirectory);
    try {
      expect(generationProviderAttemptCounts(database).paidProviderRequests)
        .toBe(0);
    } finally {
      database.close();
    }
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("a new paid retry and a new task consume one concurrency slot atomically", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-retry-admission-race-"));
  const seed = openAppDatabase(dataDirectory);
  seedAtomicGenerationFixture(seed, ["atomic-owner-a"]);
  seed.close();
  const setup = createGenerationTaskStore(dataDirectory);
  const failed = setup.admitOrGet(atomicImageRequest({
    idempotencyKey: "retry-race-original-0001",
  })).task;
  setup.transition(failed.id, "running");
  setup.recordProviderAttempt(failed.id);
  setup.transition(failed.id, "failed", {
    code: "PROVIDER_REFUNDED",
    message: "Provider reported a terminal failure and confirmed refund",
  });
  const retryFence = seedGenerationRetryBinding(
    dataDirectory,
    setup.get(failed.id)!,
    "retry-race-input-key",
  );
  setup.close();

  const retryStore = createGenerationTaskStore(dataDirectory);
  const newTaskStore = createGenerationTaskStore(dataDirectory);
  try {
    const modelConfiguration = atomicImageRequest({
      idempotencyKey: "retry-race-snapshot-ignored",
    }).modelConfiguration!;
    const results = await Promise.all([
      Promise.resolve().then(() => {
        try {
          return {
            error: undefined,
            value: retryStore.admitRetry({
              ...retryFence,
              mode: "new-paid-attempt",
              snapshot: {
                credentialRevision: 1,
                modelConfiguration,
                providerModelId: "openai/gpt-image-2",
                providerProfileId: "atomic-provider-profile",
              },
              taskId: failed.id,
            }),
          };
        } catch (error) {
          return { error, value: undefined };
        }
      }),
      Promise.resolve().then(() => {
        try {
          return {
            error: undefined,
            value: newTaskStore.admitOrGet(atomicImageRequest({
              idempotencyKey: "retry-race-new-task-0002",
              nodeId: "retry-race-new-node",
            })).task,
          };
        } catch (error) {
          return { error, value: undefined };
        }
      }),
    ]);
    expect(results.filter(({ value }) => value)).toHaveLength(1);
    expect(results.filter(({ error }) =>
      error instanceof GenerationTaskAdmissionError &&
      error.code === "USER_CONCURRENCY"
    )).toHaveLength(1);

    const database = openAppDatabase(dataDirectory);
    try {
      const active = database.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_tasks
        WHERE owner_id = 'atomic-owner-a'
          AND state IN ('queued', 'running', 'retrying', 'recovering')
      `).get() as { count: number };
      expect(Number(active.count)).toBe(1);
    } finally {
      database.close();
    }
  } finally {
    newTaskStore.close();
    retryStore.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("retry admission rejects a task detached from its durable canvas binding", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-retry-binding-"));
  const store = createGenerationTaskStore(dataDirectory);
  try {
    const task = store.create({
      canvasId: "retry-binding-canvas",
      idempotencyKey: "retry-binding-task-0001",
      kind: "image",
      model: "fixture-image-model",
      nodeId: "retry-binding-node",
      ownerId: "__test__",
      prompt: "retry only while this node owns the task",
      providerModelId: "fixture-provider-model",
      providerProfileId: "fixture-provider",
    }).task;
    store.transition(task.id, "running");
    const paid = store.recordProviderAttempt(task.id);
    store.attachProviderTaskId({
      executionAttempt: paid.executionAttempt,
      providerTaskId: "retry-binding-provider-task",
      taskId: task.id,
    });
    store.transition(task.id, "failed", {
      code: "NETWORK",
      message: "polling stopped after Provider acceptance",
    });
    const failed = store.get(task.id)!;
    const fence = seedGenerationRetryBinding(
      dataDirectory,
      failed,
      "retry-binding-input-key",
      4,
    );
    const database = openAppDatabase(dataDirectory);
    try {
      database.prepare(`
        UPDATE canvas_documents
        SET nodes = '[]'
        WHERE owner_id = '__test__' AND id = 'retry-binding-canvas'
      `).run();
    } finally {
      database.close();
    }

    expect(() => store.admitRetry({
      ...fence,
      mode: "resume-provider-task",
      taskId: task.id,
    })).toThrow(GenerationTaskRetryFenceError);
    expect(store.get(task.id)).toMatchObject({
      attempt: failed.attempt,
      state: "failed",
      updatedAt: failed.updatedAt,
    });
    expect(store.listEvents(task.id).map(({ state }) => state)).not.toContain(
      "retrying",
    );
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("GPT Image uncertain failures after the send boundary block paid retry", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-gpt-image-not-submitted-"));
  const store = createGenerationTaskStore(dataDirectory);
  try {
    const created = store.create({
      canvasId: "gpt-image-not-submitted",
      idempotencyKey: "gpt-image-not-submitted-0001",
      kind: "image",
      modelConfiguration: { providerProtocol: "gpt-image" },
      nodeId: "gpt-image-not-submitted-node",
      ownerId: "__test__",
      prompt: "short network fail must not look submitted",
      providerModelId: "gpt-image-2",
      providerProfileId: "gpt-image-profile",
    }).task;
    store.transition(created.id, "running");
    store.recordProviderAttempt(created.id);
    store.transition(created.id, "failed", {
      code: "NETWORK",
      message: "无法连接中转站",
    });
    expect(store.getProviderAttemptForTask(created.id)).toMatchObject({
      failureCode: "NETWORK",
      outcome: "outcome-unknown",
    });
    expect(store.hasUnsafeProviderAttemptForNewPaidRetry(created.id)).toBe(true);

    for (const [index, code] of [
      "AUTH",
      "PERMISSION",
      "RATE_LIMIT",
      "TIMEOUT",
      "REMOTE",
      "PROVIDER_RESULT_FORMAT",
    ].entries()) {
      const uncertain = store.create({
        canvasId: "gpt-image-not-submitted",
        idempotencyKey: `gpt-image-not-submitted-${index + 2}`,
        kind: "image",
        modelConfiguration: { providerProtocol: "gpt-image" },
        nodeId: `gpt-image-not-submitted-${code.toLowerCase()}`,
        ownerId: "__test__",
        prompt: `${code} after the paid boundary must remain uncertain`,
        providerModelId: "gpt-image-2",
        providerProfileId: "gpt-image-profile",
      }).task;
      store.transition(uncertain.id, "running");
      store.recordProviderAttempt(uncertain.id);
      store.transition(uncertain.id, "failed", {
        code,
        message: `${code} after the paid boundary`,
      });
      expect(store.getProviderAttemptForTask(uncertain.id)).toMatchObject({
        failureCode: code,
        outcome: "outcome-unknown",
      });
      expect(store.hasUnsafeProviderAttemptForNewPaidRetry(uncertain.id))
        .toBe(true);
    }
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("empty Provider search preserves billing risk while authoritative refund unlocks one retry", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-provider-certainty-"));
  const store = createGenerationTaskStore(dataDirectory);
  try {
    const unknown = store.create({
      canvasId: "provider-certainty",
      idempotencyKey: "provider-certainty-unknown-0001",
      kind: "video",
      modelConfiguration: { fixtureScopeId: "scope-a" },
      nodeId: "provider-certainty-unknown",
      ownerId: "__test__",
      prompt: "lost response",
      providerModelId: "provider-video",
      providerProfileId: "provider-profile",
    }).task;
    store.transition(unknown.id, "running");
    store.recordProviderAttempt(unknown.id);
    const failed = store.transition(unknown.id, "failed", {
      code: "PROVIDER_REQUEST_FAILED",
      message: "response lost",
    })!;
    expect(() => store.markOutcomeUnknownBillingRisk({
      expectedFixtureScopeId: "scope-b",
      expectedUpdatedAt: failed.updatedAt,
      taskId: failed.id,
    })).toThrow("Generation task changed concurrently");
    const marked = store.markOutcomeUnknownBillingRisk({
      expectedFixtureScopeId: "scope-a",
      expectedUpdatedAt: failed.updatedAt,
      taskId: failed.id,
    });
    expect(marked).toMatchObject({
      errorCode: "OUTCOME_UNKNOWN_BILLING_RISK",
      state: "failed",
    });
    expect(store.getProviderAttemptForTask(unknown.id)).toMatchObject({
      failureCode: "OUTCOME_UNKNOWN_BILLING_RISK",
      outcome: "outcome-unknown",
    });
    expect(store.hasUnsafeProviderAttemptForNewPaidRetry(unknown.id)).toBe(true);
    expect(store.listFailedOutcomeUnknown().map(({ id }) => id)).toContain(
      unknown.id,
    );

    const refunded = store.create({
      canvasId: "provider-certainty",
      idempotencyKey: "provider-certainty-refunded-0002",
      kind: "video",
      nodeId: "provider-certainty-refunded",
      ownerId: "__test__",
      prompt: "authoritative refund",
      providerModelId: "provider-video",
      providerProfileId: "provider-profile",
    }).task;
    store.transition(refunded.id, "running");
    store.recordProviderAttempt(refunded.id);
    store.transition(refunded.id, "failed", {
      code: "PROVIDER_REFUNDED",
      message: "Provider confirmed refund",
    });
    expect(store.getProviderAttemptForTask(refunded.id)).toMatchObject({
      failureCode: "PROVIDER_REFUNDED",
      outcome: "provider-failed",
    });
    expect(store.hasUnsafeProviderAttemptForNewPaidRetry(refunded.id)).toBe(false);
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("a lost accepted response persists automatic recovery across store restart", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-persistent-reconcile-"));
  let store = createGenerationTaskStore(dataDirectory);
  try {
    const task = store.create({
      canvasId: "persistent-reconcile",
      idempotencyKey: "persistent-reconcile-0001",
      kind: "video",
      nodeId: "persistent-reconcile-video",
      ownerId: "__test__",
      prompt: "lost accepted response",
      providerModelId: "grok-video-3",
      providerProfileId: "provider-profile",
    }).task;
    store.transition(task.id, "running");
    store.recordProviderAttempt(task.id);

    expect(store.transition(task.id, "recovering")).toMatchObject({
      attempt: 1,
      providerTaskId: undefined,
      state: "recovering",
    });
    store.close();

    store = createGenerationTaskStore(dataDirectory);
    expect(store.get(task.id)).toMatchObject({
      attempt: 1,
      providerTaskId: undefined,
      state: "recovering",
    });
    expect(store.listRecovering().map(({ id }) => id)).toContain(task.id);
    expect(store.hasUnsafeProviderAttemptForNewPaidRetry(task.id)).toBe(true);
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("automatic recovery uses a durable CAS lease and binds one provider task without a new attempt", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-recovery-lease-"));
  let store = createGenerationTaskStore(dataDirectory);
  try {
    const task = store.create({
      canvasId: "recovery-lease",
      idempotencyKey: "recovery-lease-0001",
      kind: "video",
      modelConfiguration: { providerProtocol: "media-generate" },
      nodeId: "recovery-lease-video",
      ownerId: "__test__",
      prompt: "recover without resubmission",
      providerModelId: "grok-video-3",
      providerProfileId: "provider-profile",
    }).task;
    store.transition(task.id, "running");
    store.recordProviderAttempt(task.id);
    const recovering = store.transition(task.id, "recovering", {
      code: "AUTOMATIC_RESULT_RECOVERY",
      message: "automatic recovery",
    })!;
    const recoveryWindow = store.providerRecoveryWindow(task.id);
    expect(recoveryWindow).toBeDefined();

    const repeatedEvidence = {
      failureStage: "poll",
      fieldPaths: ["status:string"],
      httpStatus: 200,
    } as const;
    store.recordProviderResponseEvidence(task.id, repeatedEvidence);
    store.recordProviderResponseEvidence(task.id, repeatedEvidence);
    for (let index = 0; index < 70; index += 1) {
      store.recordProviderResponseEvidence(task.id, {
        failureStage: `poll-${index}`,
        fieldPaths: ["status:string"],
        httpStatus: 200,
      });
    }
    expect(store.listEvents(task.id).filter((event) =>
      event.errorCode === "PROVIDER_RESPONSE_EVIDENCE"
    )).toHaveLength(64);

    const claimed = store.claimRecovering(task.id, recovering.updatedAt);
    expect(claimed).toMatchObject({
      attempt: 1,
      errorCode: "AUTOMATIC_RESULT_RECOVERY",
      state: "recovering",
    });
    expect(store.claimRecovering(task.id, recovering.updatedAt)).toBeUndefined();
    const checkpoint = store.get(task.id)!;
    expect(store.claimRecovering(
      task.id,
      checkpoint.updatedAt,
      new Date(Date.parse(checkpoint.updatedAt) + 29_999),
    )).toBeUndefined();
    expect(store.claimRecovering(
      task.id,
      checkpoint.updatedAt,
      new Date(Date.parse(checkpoint.updatedAt) + 30_000),
    )).toMatchObject({ state: "recovering" });
    expect(store.providerRecoveryWindow(task.id)).toEqual(recoveryWindow);

    store.setProviderTaskId(task.id, "provider-task-recovered-1");
    expect(store.getProviderAttemptForTask(task.id)).toMatchObject({
      executionAttempt: 1,
      outcome: "accepted",
      providerTaskId: "provider-task-recovered-1",
    });
    expect(store.resume(task.id)).toMatchObject({
      attempt: 1,
      providerTaskId: "provider-task-recovered-1",
      state: "running",
    });
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("recovery windows are scoped to the current paid execution attempt", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-recovery-window-attempt-"));
  const store = createGenerationTaskStore(dataDirectory);
  try {
    const task = store.create({
      canvasId: "recovery-window-attempt",
      idempotencyKey: "recovery-window-attempt-0001",
      kind: "video",
      modelConfiguration: { providerProtocol: "media-generate" },
      nodeId: "recovery-window-attempt-video",
      ownerId: "__test__",
      prompt: "bind recovery expiry to the current paid attempt",
      providerModelId: "grok-video-3",
      providerProfileId: "provider-profile",
    }).task;
    store.transition(task.id, "running");
    store.recordProviderAttempt(task.id);
    store.transition(task.id, "recovering", {
      code: "AUTOMATIC_RESULT_RECOVERY",
      message: "attempt one recovery",
    });
    store.resume(task.id);
    store.transition(task.id, "failed", {
      code: "PROVIDER_REFUNDED",
      message: "attempt one authoritatively refunded",
    });
    store.transition(task.id, "retrying");
    store.transition(task.id, "queued");
    store.transition(task.id, "running");
    store.recordProviderAttempt(task.id);
    store.transition(task.id, "recovering", {
      code: "AUTOMATIC_RESULT_RECOVERY",
      message: "attempt two recovery",
    });

    const database = openAppDatabase(dataDirectory);
    try {
      database.prepare(`
        UPDATE generation_task_events
        SET created_at = '2020-01-01T00:00:00.000Z'
        WHERE id = (
          SELECT id FROM generation_task_events
          WHERE task_id = ? AND state = 'recovering'
          ORDER BY id ASC LIMIT 1
        )
      `).run(task.id);
    } finally {
      database.close();
    }
    const window = store.providerRecoveryWindow(task.id);
    expect(window).toBeDefined();
    expect(window!.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(Date.parse(window!.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(window!.createdAt),
    );
    expect(store.get(task.id)).toMatchObject({ attempt: 2, state: "recovering" });
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("automatic recovery expires into the administrator incident queue", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-recovery-incident-"));
  const store = createGenerationTaskStore(dataDirectory);
  try {
    const task = store.create({
      canvasId: "recovery-incident",
      idempotencyKey: "recovery-incident-0001",
      kind: "video",
      modelConfiguration: { providerProtocol: "media-generate" },
      nodeId: "recovery-incident-video",
      ownerId: "__test__",
      prompt: "operator incident fixture",
      providerModelId: "grok-video-3",
      providerProfileId: "provider-profile",
    }).task;
    store.transition(task.id, "running");
    store.recordProviderAttempt(task.id);
    store.setProviderTaskId(task.id, "operator-incident-provider-task");
    const recovering = store.transition(task.id, "recovering", {
      code: "AUTOMATIC_RESULT_RECOVERY",
      message: "automatic recovery",
    })!;
    expect(store.claimRecovering(
      task.id,
      recovering.updatedAt,
      new Date(Date.parse(task.createdAt) + 26 * 60 * 60_000),
    )).toBeUndefined();
    expect(store.get(task.id)).toMatchObject({
      errorCode: "OPERATOR_INCIDENT",
      state: "failed",
    });
    expect(store.listOperatorIncidents().map(({ id }) => id)).toContain(task.id);
    expect(store.listFailedAutoRecoverable(
      new Date(Date.parse(task.createdAt) + 27 * 60 * 60_000),
    ).map(({ id }) => id)).not.toContain(task.id);
    expect(store.listEvents(task.id).at(-1)).toMatchObject({
      errorCode: "OPERATOR_INCIDENT",
      state: "failed",
    });
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("the same input cannot open a second paid task while the last outcome is unknown", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-unknown-same-input-"));
  const seed = openAppDatabase(dataDirectory);
  seedAtomicGenerationFixture(seed, ["atomic-owner-a"]);
  seed.close();
  const store = createGenerationTaskStore(dataDirectory);
  try {
    const first = store.admitOrGet(atomicImageRequest({
      idempotencyKey: "same-input-unknown-0001",
    })).task;
    store.transition(first.id, "running");
    store.recordProviderAttempt(first.id);
    store.transition(first.id, "failed", {
      code: "TIMEOUT",
      message: "等待中转站响应超时；异步任务可能仍在运行",
    });
    expect(store.getProviderAttemptForTask(first.id)).toMatchObject({
      outcome: "outcome-unknown",
    });
    expect(() => store.admitOrGet(atomicImageRequest({
      idempotencyKey: "same-input-unknown-0002",
    }))).toThrow(GenerationProviderAttemptBlockedError);
    try {
      store.admitOrGet(atomicImageRequest({
        idempotencyKey: "same-input-unknown-0002",
      }));
    } catch (error) {
      expect(error).toMatchObject({ code: "RETRY_OUTCOME_UNKNOWN" });
    }
    const otherNode = store.admitOrGet(atomicImageRequest({
      idempotencyKey: "same-input-unknown-other-node",
      nodeId: "atomic-image-other-node",
    }));
    expect(otherNode.created).toBe(true);
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("the same input cannot mint a sibling key while the first task is queued before Provider attempt", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-queued-same-input-"));
  const seed = openAppDatabase(dataDirectory);
  seedAtomicGenerationFixture(seed, ["atomic-owner-a"]);
  seed.close();
  const store = createGenerationTaskStore(dataDirectory);
  try {
    const first = store.admitOrGet(atomicImageRequest({
      idempotencyKey: "same-input-queued-0001",
    }));
    expect(first).toMatchObject({ created: true, task: { state: "queued" } });
    expect(store.getProviderAttemptForTask(first.task.id)).toBeUndefined();
    expect(() => store.admitOrGet(atomicImageRequest({
      idempotencyKey: "same-input-queued-0002",
    }))).toThrow(GenerationProviderAttemptBlockedError);
    try {
      store.admitOrGet(atomicImageRequest({
        idempotencyKey: "same-input-queued-0002",
      }));
    } catch (error) {
      expect(error).toMatchObject({ code: "RETRY_OUTCOME_UNKNOWN" });
    }
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("the same input cannot open a new task after a sibling already holds accepted or response-received evidence", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-sibling-paid-"));
  const seed = openAppDatabase(dataDirectory);
  seedAtomicGenerationFixture(seed, ["atomic-owner-a", "atomic-owner-b"]);
  seed.prepare(`
    UPDATE generation_safety_settings
    SET per_user_concurrency = 20, image_concurrency = 20
    WHERE id = 1
  `).run();
  seed.close();
  const store = createGenerationTaskStore(dataDirectory);
  try {
    const accepted = store.admitOrGet(atomicImageRequest({
      idempotencyKey: "sibling-paid-accepted-0001",
    })).task;
    store.transition(accepted.id, "running");
    const acceptedPaid = store.recordProviderAttempt(accepted.id);
    store.attachProviderTaskId({
      credentialRevision: 1,
      executionAttempt: acceptedPaid.executionAttempt,
      providerTaskId: "sibling-paid-remote-0001",
      taskId: accepted.id,
    });
    store.transition(accepted.id, "failed", {
      code: "NETWORK",
      message: "polling stopped after Provider acceptance",
    });
    expect(store.getProviderAttemptForTask(accepted.id)).toMatchObject({
      outcome: "accepted",
    });
    expect(() => store.admitOrGet(atomicImageRequest({
      idempotencyKey: "sibling-paid-accepted-0002",
    }))).toThrow(GenerationProviderAttemptBlockedError);
    try {
      store.admitOrGet(atomicImageRequest({
        idempotencyKey: "sibling-paid-accepted-0002",
      }));
    } catch (error) {
      expect(error).toMatchObject({ code: "RETRY_OUTCOME_UNKNOWN" });
    }

    const responseReceived = store.admitOrGet(atomicImageRequest({
      idempotencyKey: "sibling-paid-response-0001",
      nodeId: "atomic-image-response-node",
    })).task;
    store.transition(responseReceived.id, "running");
    const responsePaid = store.recordProviderAttempt(responseReceived.id);
    store.markProviderResponseReceived({
      executionAttempt: responsePaid.executionAttempt,
      taskId: responseReceived.id,
    });
    store.transition(responseReceived.id, "failed", {
      code: "MEDIA_PUBLICATION_FAILED",
      message: "the paid response could not be published locally",
    });
    expect(store.getProviderAttemptForTask(responseReceived.id)).toMatchObject({
      outcome: "response-received",
    });
    expect(() => store.admitOrGet(atomicImageRequest({
      idempotencyKey: "sibling-paid-response-0002",
      nodeId: "atomic-image-response-node",
    }))).toThrow(GenerationProviderAttemptBlockedError);

    const otherNode = store.admitOrGet(atomicImageRequest({
      idempotencyKey: "sibling-paid-other-node-0003",
      nodeId: "atomic-image-other-node",
    }));
    expect(otherNode.created).toBe(true);

    const changedPrompt = store.admitOrGet({
      ...atomicImageRequest({
        idempotencyKey: "sibling-paid-changed-prompt-0004",
      }),
      prompt: "a genuinely different prompt",
      requestIntent: {
        canvasId: "atomic-canvas",
        kind: "image",
        model: "atomic-image-model",
        nodeId: "atomic-image-node",
        parameters: { count: 1, size: "1k" },
        prompt: "a genuinely different prompt",
      },
    });
    expect(changedPrompt.created).toBe(true);
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("canvas lists keep every active task and only the latest 500 terminal tasks", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-task-window-"));
  const store = createGenerationTaskStore(dataDirectory);
  try {
    const terminalIds: string[] = [];
    for (let index = 0; index < 501; index += 1) {
      const created = store.create({
        canvasId: "task-window-canvas",
        idempotencyKey: `task-window-terminal-${String(index).padStart(4, "0")}`,
        kind: "text",
        nodeId: `task-window-node-${String(index).padStart(4, "0")}`,
        ownerId: "__test__",
        prompt: `terminal ${index}`,
      }).task;
      store.transition(created.id, "running");
      store.transition(created.id, "failed", {
        code: "OFFLINE_FIXTURE",
        message: "terminal fixture without a Provider request",
      });
      terminalIds.push(created.id);
    }
    const active = store.create({
      canvasId: "task-window-canvas",
      idempotencyKey: "task-window-active-0502",
      kind: "audio",
      nodeId: "task-window-active-node",
      ownerId: "__test__",
      prompt: "newest active task",
    }).task;

    const listedIds = store.list("task-window-canvas").map(({ id }) => id);
    expect(listedIds).toHaveLength(501);
    expect(listedIds).toContain(active.id);
    expect(listedIds).toContain(terminalIds.at(-1));
    expect(listedIds).not.toContain(terminalIds[0]);
    expect(store.listActiveForCanvas("task-window-canvas", "__test__"))
      .toEqual([expect.objectContaining({ id: active.id, state: "queued" })]);
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("generation submission stays disabled until a real Provider is configured", async ({
  request,
}) => {
  const status = await request.get("/api/generation-tasks/status");
  expect(status.status()).toBe(200);
  const initialStatus = await status.json() as {
    paidProviderRequests: number;
    [key: string]: unknown;
  };
  expect(initialStatus).toEqual({
    audioProviderConfigured: false,
    audioSubmissionEnabled: false,
    emergencyStop: false,
    globalGenerationEnabled: false,
    imageProviderConfigured: false,
    imageSubmissionEnabled: false,
    historicalEstimatedProviderAttempts: 0,
    incGen017FeatureFlags: {
      modelInputContractV2: true,
      workflowSelfHealingV2: true,
    },
    paidProviderRequests: expect.any(Number),
    persistentQueueReady: true,
    protectionReady: true,
    providerConfigured: false,
    submissionEnabled: false,
    textProviderConfigured: false,
    textSubmissionEnabled: false,
    videoProviderConfigured: false,
    videoSubmissionEnabled: false,
  });

  const canvasId = `generation-empty-${crypto.randomUUID()}`;
  const tasks = await request.get(
    `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
  );
  expect(tasks.status()).toBe(200);
  await expect(tasks.json()).resolves.toEqual({ tasks: [] });

  const missing = await request.get(
    `/api/generation-tasks/${crypto.randomUUID()}`,
  );
  expect(missing.status()).toBe(404);
  await expect(missing.json()).resolves.toEqual({
    error: "Generation task not found",
  });

  const submission = await request.post("/api/generation-tasks", {
    data: {
      canvasId,
      idempotencyKey: "request-generation-disabled",
      kind: "image",
      // Select an explicitly absent model so this assertion remains about the
      // MODEL_UNAVAILABLE gate even when an earlier model-admin test has
      // published an unconfigured fixture model in the shared test server.
      model: `missing-image-model-${crypto.randomUUID()}`,
      nodeId: "image-generation-test",
      prompt: "This must not create a paid request",
    },
  });
  expect(submission.status()).toBe(503);
  await expect(submission.json()).resolves.toMatchObject({
    code: "MODEL_UNAVAILABLE",
    error: "管理员尚未发布可用的图片模型",
    problems: [{
      code: "MODEL_UNSUPPORTED",
      message: "管理员尚未发布可用的图片模型",
    }],
  });

  const afterTasks = await request.get(
    `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
  );
  await expect(afterTasks.json()).resolves.toEqual({ tasks: [] });
  const afterStatus = await request.get("/api/generation-tasks/status");
  await expect(afterStatus.json()).resolves.toMatchObject({
    paidProviderRequests: initialStatus.paidProviderRequests,
  });
});

test("an initial admission committed before response failure returns 5xx and remains one recoverable task", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = await dataDirectoryResponse.json() as {
    dataDirectory: string;
  };
  const profile = await saveProviderProfile({
    apiKey: "sk-post-commit-fixture-provider",
    baseUrl: "https://openrouter.ai/api/v1",
    driver: "openrouter",
    label: "Post-commit response fixture",
  });
  const database = openAppDatabase(dataDirectory);
  const timestamp = new Date().toISOString();
  const modelId = `post-commit-model-${crypto.randomUUID()}`;
  const canvasId = `post-commit-canvas-${crypto.randomUUID()}`;
  const nodeId = `post-commit-node-${crypto.randomUUID()}`;
  const idempotencyKey = `post-commit-key-${crypto.randomUUID()}`;
  try {
    database.prepare(`
      INSERT OR IGNORE INTO users (
        id, login_name, display_name, password_hash, role, status,
        protected, created_at, updated_at
      ) VALUES (
        '__test__', '__test__', 'Test User', 'test-only', 'admin', 'active',
        1, ?, ?
      )
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency, provider_protocol
      ) VALUES (
        ?, 'Post-commit image', ?, 'openai/gpt-image-2',
        'image', 'published', ?, ?, ?, 1000000, 'USD', 'native'
      )
    `).run(
      modelId,
      profile.id,
      JSON.stringify(knownModelParameterSchema({
        capability: "image",
        providerDriver: "openrouter",
        providerModelId: "openai/gpt-image-2",
      })),
      timestamp,
      timestamp,
    );
    database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      ) VALUES ('image', ?, 1, 1, 1, ?, ?)
    `).run(modelId, timestamp, timestamp);
    database.prepare(`
      UPDATE provider_profiles
      SET status = 'enabled', key_status = 'valid', key_checked_at = ?
      WHERE id = ?
    `).run(timestamp, profile.id);
    database.prepare(`
      UPDATE generation_safety_settings
      SET
        global_enabled = 1,
        emergency_stop = 0,
        per_user_concurrency = 5,
        requests_per_minute = 120,
        image_concurrency = 5,
        updated_at = ?
      WHERE id = 1
    `).run(timestamp);
    await saveAccountCredential(
      database,
      "__test__",
      profile.id,
      "sk-post-commit-fixture-account",
    );
    database.prepare(`
      UPDATE account_provider_credentials
      SET key_status = 'valid', key_checked_at = ?
      WHERE account_id = '__test__' AND provider_profile_id = ?
    `).run(timestamp, profile.id);
    bootstrapPublishedModelContracts(database, "__test__");

    const saved = await request.put(`/api/canvas/${canvasId}`, {
      data: {
        edges: [],
        nodes: [{
          data: {
            imageAspectRatio: "auto",
            imageModelId: modelId,
            imageParameters: {
              aspectRatio: "auto",
              inputMode: "text",
              outputCount: 1,
              quality: "auto",
            },
            imagePrompt: "post-commit response must reconcile",
            imageQuality: "auto",
            label: "Image",
            title: "Post-commit image",
          },
          id: nodeId,
          position: { x: 0, y: 0 },
          type: "image",
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    const savedCanvas = await saved.json() as {
      graphRevision?: number;
      revision: number;
    };
    const canvasRevision = savedCanvas.graphRevision ?? savedCanvas.revision;
    const submissionBody = {
      canvasId,
      canvasRevision,
      idempotencyKey,
      inputSchemaVersion: 1,
      inputs: [],
      kind: "image",
      model: modelId,
      nodeId,
      ownPrompt: "post-commit response must reconcile",
      parameters: {
        aspectRatio: "auto",
        inputMode: "text",
        outputCount: 1,
        quality: "auto",
      },
      prompt: "post-commit response must reconcile",
    };

    const submission = await request.post("/api/generation-tasks", {
      data: submissionBody,
      headers: {
        "x-unboundry-test-generation-post-commit-failure": "before-launch",
      },
    });
    expect(submission.status()).toBe(500);
    await expect(submission.json()).resolves.toEqual({
      code: "GENERATION_TASK_ACCEPTED_RESPONSE_FAILED",
      error: "生成任务已提交，响应暂不可用；系统会自动跟进",
    });

    const recovered = await request.get(
      "/api/generation-tasks/by-idempotency" +
        `?canvasId=${encodeURIComponent(canvasId)}` +
        `&idempotencyKey=${encodeURIComponent(idempotencyKey)}`,
    );
    expect(recovered.status()).toBe(200);
    await expect(recovered.json()).resolves.toMatchObject({
      canvasId,
      kind: "image",
      nodeId,
      state: "queued",
    });

    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_tasks
      WHERE owner_id = '__test__' AND canvas_id = ? AND idempotency_key = ?
    `).get(canvasId, idempotencyKey)).toEqual({ count: 1 });
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_admission_events AS admissions
      JOIN generation_tasks AS tasks ON tasks.id = admissions.task_id
      WHERE
        tasks.owner_id = '__test__' AND tasks.canvas_id = ?
        AND tasks.idempotency_key = ? AND admissions.admission_type = 'initial'
    `).get(canvasId, idempotencyKey)).toEqual({ count: 1 });
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_provider_attempts AS attempts
      JOIN generation_tasks AS tasks ON tasks.id = attempts.task_id
      WHERE
        tasks.owner_id = '__test__' AND tasks.canvas_id = ?
        AND tasks.idempotency_key = ?
    `).get(canvasId, idempotencyKey)).toEqual({ count: 0 });
  } finally {
    database.close();
  }
});
