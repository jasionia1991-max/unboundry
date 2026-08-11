import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import {
  createGenerationTaskStore,
  failRecoveredGenerationTasks,
  generationProviderAttemptCounts,
  GenerationProviderAttemptBlockedError,
  GenerationTaskAdmissionError,
  GenerationTaskConflictError,
  GenerationTaskProviderBoundaryError,
  GenerationTaskTransitionError,
} from "../server/generationTaskStore";
import { knownModelParameterSchema } from "../types/modelParameters";

type AdmissionChildOutcome = {
  created?: boolean;
  errorCode?: string;
  errorName?: string;
  message?: string;
  taskId?: string;
};

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
      '{}', ?, ?, 1000000, 'USD'
    )
  `).run(modelId, profileId, timestamp, timestamp);
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
      parameterSchema: knownModelParameterSchema({
        capability: "image",
        providerDriver: "openrouter",
        providerModelId: "openai/gpt-image-2",
      }),
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
    const store = createGenerationTaskStore(dataDirectory);
    const task = store.create({
      canvasId: "historical-provider-count",
      idempotencyKey: "historical-provider-attempts-001",
      kind: "image",
      model: "historical-image-model",
      nodeId: "historical-image-node",
      ownerId: "__test__",
      parameters: {},
      prompt: "preserve old provider attempt observations",
      providerModelId: "openai/gpt-image-2",
      providerProfileId: "historical-provider",
    }).task;
    store.close();

    const schema14 = openAppDatabase(dataDirectory);
    schema14.prepare(`UPDATE generation_tasks SET attempt = 3 WHERE id = ?`)
      .run(task.id);
    schema14.exec(`
      DROP TABLE generation_provider_attempts;
      DELETE FROM schema_migrations WHERE version = 15;
      PRAGMA user_version = 14;
    `);
    schema14.close();

    const migrated = openAppDatabase(dataDirectory);
    try {
      const attempts = migrated.prepare(`
        SELECT execution_attempt, evidence
        FROM generation_provider_attempts
        WHERE task_id = ?
        ORDER BY execution_attempt
      `).all(task.id) as Array<{
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
          expectedUpdatedAt: failed.updatedAt,
        },
      },
    );
    expect(abandoned.status()).toBe(200);
    await expect(abandoned.json()).resolves.toMatchObject({
      errorCode: "USER_ABANDONED",
      abandonAllowed: false,
      retryAllowed: false,
      retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
      state: "cancelled",
    });

    const retry = await request.post(
      `/api/generation-tasks/${task.id}/retry`,
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
    const retry = await request.post(`/api/generation-tasks/${task.id}/retry`);
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
    children = Array.from({ length: 20 }, (_, index) =>
      runAtomicAdmissionChild(
        dataDirectory,
        firstReleasePath,
        secondReleasePath,
        atomicImageRequest({
          idempotencyKey: `atomic-distinct-${String(index).padStart(3, "0")}`,
          nodeId: `atomic-node-${index}`,
        }),
        replayRequest,
      )
    );
    await Promise.all(children.map(({ ready }) => ready));
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
      outcome: "definitive-rejected",
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
    expect(() => store.admitRetry({
      mode: "new-paid-attempt",
      snapshot: {
        credentialRevision: 1,
        modelConfiguration: {},
        providerModelId: "fixture-provider-model",
        providerProfileId: "fixture-provider",
      },
      taskId: resumed.id,
    })).toThrow(GenerationProviderAttemptBlockedError);
    store.admitRetry({ mode: "resume-provider-task", taskId: resumed.id });
    expect(store.transition(resumed.id, "running")).toMatchObject({
      attempt: 2,
      providerTaskId: "resume-original-provider-task",
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
    code: "PROVIDER_FAILED",
    message: "Provider reported a terminal failure",
  });
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
