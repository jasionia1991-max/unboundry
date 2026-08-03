import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openAppDatabase } from "../server/database";
import {
  createGenerationTaskStore,
  failRecoveredGenerationTasks,
  generationProviderAttemptCounts,
  GenerationProviderAttemptBlockedError,
  GenerationTaskConflictError,
  GenerationTaskProviderBoundaryError,
  GenerationTaskTransitionError,
} from "../server/generationTaskStore";

test("generation task creation is idempotent and a running task recovers after reopen", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-task-store-"));
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
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-provider-attempt-history-"));
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
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-provider-cancel-race-"));
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
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-provider-task-resume-"));
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

test("generation submission stays disabled until a real Provider is configured", async ({
  request,
}) => {
  const status = await request.get("/api/generation-tasks/status");
  expect(status.status()).toBe(200);
  await expect(status.json()).resolves.toEqual({
    audioProviderConfigured: false,
    audioSubmissionEnabled: false,
    emergencyStop: false,
    globalGenerationEnabled: false,
    imageProviderConfigured: false,
    imageSubmissionEnabled: false,
    historicalEstimatedProviderAttempts: 0,
    paidProviderRequests: 0,
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
    paidProviderRequests: 0,
  });
});
