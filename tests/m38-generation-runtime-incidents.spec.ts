import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openAppDatabase } from "../server/database";
import { createGenerationSafetyStore } from "../server/generationSafety";
import {
  createGenerationTaskStore,
  generationProviderAttemptCounts,
  GenerationProviderAttemptBlockedError,
  type GenerationTask,
} from "../server/generationTaskStore";
import {
  executeTextTaskWithDependencies,
  generationTaskCancellationMode,
  retrySnapshotCompatibilityProblem,
} from "../server/generationTasks";
import { evaluateModelRuntimeAvailability } from "../server/modelAvailability";
import type { ProviderProfile } from "../server/providerProfiles";
import {
  createVolcengineArkTextResponse,
} from "../server/volcengineArkTextProvider";
import { knownModelParameterSchema } from "../types/modelParameters";

const arkProfile: ProviderProfile = {
  apiKey: "test-only-ark-key-never-sent",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  createdAt: "2026-08-03T03:20:00.000Z",
  driver: "volcengine-ark",
  id: "provider-ark-incident",
  label: "Ark incident test",
  updatedAt: "2026-08-03T03:20:00.000Z",
};

const textModelId = "doubao-seed-2-0-lite-260428";
const incidentPort = 4201;
const incidentOrigin = `http://127.0.0.1:${incidentPort}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");

async function startIncidentServer(dataDirectory: string) {
  const child = spawn(
    process.execPath,
    [
      vite,
      "--host",
      "127.0.0.1",
      "--port",
      String(incidentPort),
      "--strictPort",
    ],
    {
      env: {
        ...process.env,
        TAPNOW_DATA_DIR: dataDirectory,
        TAPNOW_TEST_AUTH_BYPASS: "1",
      },
      stdio: "ignore",
    },
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${incidentOrigin}/api/models`)).ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("Runtime incident test server did not start");
}

async function stopIncidentServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function incidentRequest(path: string, init: RequestInit = {}) {
  return fetch(`${incidentOrigin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

test("Ark Text distinguishes authentication and permission failures without leaking Provider details", async () => {
  const cases = [
    {
      code: "AUTH",
      message: "火山方舟API Key无效或已失效，请由管理员更新平台连接",
      status: 401,
    },
    {
      code: "PERMISSION",
      message: "当前API Key没有所选文字模型权限，请在方舟控制台开通模型服务并更新平台连接",
      status: 403,
    },
  ] as const;
  let providerCalls = 0;

  for (const incident of cases) {
    let captured: unknown;
    try {
      await createVolcengineArkTextResponse(
        arkProfile,
        {
          model: textModelId,
          prompt: "识别图片中的服饰特征",
          thinkingLevel: "medium",
        },
        async (input, init) => {
          providerCalls += 1;
          expect(String(input)).toBe(`${arkProfile.baseUrl}/responses`);
          expect(init?.method).toBe("POST");
          return new Response(
            JSON.stringify({
              api_key: "must-not-reach-error-message",
              message: "raw-provider-detail-must-not-leak",
            }),
            { status: incident.status },
          );
        },
      );
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({
      code: incident.code,
      message: incident.message,
    });
    expect(String(captured)).not.toContain("must-not-reach-error-message");
    expect(String(captured)).not.toContain("raw-provider-detail-must-not-leak");
    expect(String(captured)).not.toContain(arkProfile.apiKey);
  }

  expect(providerCalls).toBe(2);
});

test("Text authentication failures persist once with no result or recorded cost", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-text-auth-incident-"));
  try {
    const store = createGenerationTaskStore(dataDirectory);
    const cases = [
      { code: "AUTH", status: 401 },
      { code: "PERMISSION", status: 403 },
    ] as const;
    let providerCalls = 0;

    for (const [index, incident] of cases.entries()) {
      const created = store.create({
        canvasId: "default",
        costCurrency: "CNY",
        estimatedCostMicrounits: 5_000_000,
        idempotencyKey: `text-auth-incident-${index}`,
        kind: "text",
        model: `text-model-${index}`,
        nodeId: `text-node-${index}`,
        ownerId: "__test__",
        parameters: {
          inputs: [{
            assetId: "garment.png",
            kind: "image",
            order: 1,
            role: "context-image",
            sourceNodeId: "image-source",
          }],
          outputCount: 1,
          responseFormat: "text",
          thinkingLevel: "medium",
        },
        prompt: "根据服装图片生成商品描述",
        providerModelId: textModelId,
        providerProfileId: `${arkProfile.id}-${index}`,
      });
      await executeTextTaskWithDependencies(created.task.id, {
        fetcher: async () => {
          providerCalls += 1;
          return new Response("{}", { status: incident.status });
        },
        acquireProfile: async () => ({ profile: arkProfile, release() {} }),
        mediaUrlForOwner: async () =>
          `data:image/png;base64,${Buffer.from("fake-image").toString("base64")}`,
        store,
      });

      expect(store.get(created.task.id)).toMatchObject({
        actualCostMicrounits: undefined,
        attempt: 1,
        errorCode: incident.code,
        providerUsageTokens: undefined,
        resultText: undefined,
        state: "failed",
      });
      expect(store.listEvents(created.task.id).map((event) => ({
        code: event.errorCode,
        state: event.state,
      }))).toEqual([
        { code: undefined, state: "queued" },
        { code: undefined, state: "running" },
        { code: incident.code, state: "failed" },
      ]);

      // A failed task is never silently submitted again.
      await executeTextTaskWithDependencies(created.task.id, {
        fetcher: async () => {
          providerCalls += 1;
          return new Response("{}", { status: incident.status });
        },
        acquireProfile: async () => ({ profile: arkProfile, release() {} }),
        mediaUrlForOwner: async () => "unused",
        store,
      });
    }

    expect(providerCalls).toBe(2);
    expect(store.list("default")).toHaveLength(2);
    store.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("an auth incident grants one atomic provider-kind recovery attempt and isolates other kinds", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-provider-recovery-slot-"));
  const store = createGenerationTaskStore(dataDirectory);
  const database = openAppDatabase(dataDirectory);
  try {
    const providerProfileId = "provider-recovery-slot";
    const modelProfileId = "model-recovery-text";
    const baseline = new Date(Date.now() - 60_000).toISOString();
    database.prepare(`
      INSERT INTO provider_profiles (
        id, display_name, driver, status, created_at, updated_at
      ) VALUES (?, 'Recovery Ark', 'volcengine-ark', 'enabled', ?, ?)
    `).run(providerProfileId, baseline, baseline);
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency
      ) VALUES (
        ?, 'Recovery Text', ?, ?, 'text', 'published', '{}', ?, ?,
        5000000, 'CNY'
      )
    `).run(
      modelProfileId,
      providerProfileId,
      textModelId,
      baseline,
      baseline,
    );

    let sequence = 0;
    const runningTask = (kind: "image" | "text" | "video", model: string) => {
      sequence += 1;
      const created = store.create({
        canvasId: "default",
        costCurrency: kind === "image" ? "USD" : "CNY",
        estimatedCostMicrounits: 5_000_000,
        idempotencyKey: `provider-recovery-${sequence}`,
        kind,
        model,
        nodeId: `recovery-node-${sequence}`,
        ownerId: "__test__",
        parameters: {},
        prompt: "recovery boundary test",
        providerModelId: kind === "text"
          ? textModelId
          : kind === "video"
            ? "doubao-seedance-2-0-mini-260615"
            : "openai/gpt-image-2",
        providerProfileId,
      });
      return store.transition(created.task.id, "running")!;
    };

    const incident = runningTask("text", modelProfileId);
    store.recordProviderAttempt(incident.id);
    store.transition(incident.id, "failed", {
      code: "AUTH",
      message: "safe auth incident",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    database.prepare(`UPDATE model_profiles SET updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), modelProfileId);

    const firstRecovery = runningTask("text", modelProfileId);
    const competingRecovery = runningTask("text", modelProfileId);
    store.recordProviderAttempt(firstRecovery.id);
    let competingError: unknown;
    try {
      store.recordProviderAttempt(competingRecovery.id);
    } catch (error) {
      competingError = error;
    }
    expect(competingError).toBeInstanceOf(GenerationProviderAttemptBlockedError);
    expect(competingError).toMatchObject({
      code: "PROVIDER_RECOVERY_ATTEMPT_USED",
    });
    store.transition(competingRecovery.id, "failed", {
      code: "PROVIDER_RECOVERY_ATTEMPT_USED",
      message: "recovery slot already used",
    });

    store.transition(firstRecovery.id, "failed", {
      code: "PERMISSION",
      message: "recovery still lacks permission",
    });
    const blockedAfterFailure = runningTask("text", modelProfileId);
    expect(() => store.recordProviderAttempt(blockedAfterFailure.id)).toThrow(
      GenerationProviderAttemptBlockedError,
    );
    try {
      store.recordProviderAttempt(blockedAfterFailure.id);
    } catch (error) {
      expect(error).toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
    }
    store.transition(blockedAfterFailure.id, "failed", {
      code: "PROVIDER_AUTH_FAILED",
      message: "auth incident remains blocked",
    });

    // The incident is provider+kind scoped: Image and Video remain independent.
    const image = runningTask("image", "model-unrelated-image");
    expect(store.recordProviderAttempt(image.id)).toMatchObject({
      executionAttempt: 1,
    });
    store.transition(image.id, "failed", {
      code: "RATE_LIMIT",
      message: "unrelated image result",
    });
    const video = runningTask("video", "model-unrelated-video");
    expect(store.recordProviderAttempt(video.id)).toMatchObject({
      executionAttempt: 1,
    });
    store.transition(video.id, "failed", {
      code: "RATE_LIMIT",
      message: "unrelated video result",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    database.prepare(`UPDATE model_profiles SET updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), modelProfileId);
    const secondRecovery = runningTask("text", modelProfileId);
    store.recordProviderAttempt(secondRecovery.id);
    store.complete(secondRecovery.id, {
      actualCostMicrounits: 5_000_000,
      resultText: "recovered",
    });

    // A later same provider+kind success clears the incident completely.
    const afterSuccess = runningTask("text", modelProfileId);
    expect(store.recordProviderAttempt(afterSuccess.id)).toMatchObject({
      executionAttempt: 1,
    });
    const attempts = database.prepare(`
      SELECT evidence, kind
      FROM generation_provider_attempts
      ORDER BY id
    `).all() as Array<{ evidence: string; kind: string }>;
    expect(attempts).toHaveLength(6);
    expect(attempts.every(({ evidence }) => evidence === "provider-boundary"))
      .toBe(true);
    expect(attempts.filter(({ kind }) => kind === "image")).toHaveLength(1);
    expect(attempts.filter(({ kind }) => kind === "video")).toHaveLength(1);
  } finally {
    database.close();
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("the incident cooldown ignores stale and unrelated Provider failures", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-cooldown-incident-"));
  const safety = createGenerationSafetyStore(dataDirectory);
  const database = openAppDatabase(dataDirectory);
  const now = new Date("2026-08-03T03:40:00.000Z");
  try {
    safety.update({
      audioConcurrency: 5,
      cooldownMinutes: 30,
      dailyCostLimitCnyMicrounits: 100_000_000,
      dailyCostLimitMicrounits: 100_000_000,
      emergencyStop: false,
      failureThreshold: 3,
      globalEnabled: true,
      imageConcurrency: 5,
      monthlyCostLimitCnyMicrounits: 100_000_000,
      monthlyCostLimitMicrounits: 100_000_000,
      perUserConcurrency: 5,
      requestsPerMinute: 120,
      runningTaskPolicy: "wait",
      textConcurrency: 5,
      videoConcurrency: 5,
    });
    const ownerId = "owner-incident";
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, 'Incident Owner', 'test-only', 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, now.toISOString(), now.toISOString());
    const insertTask = database.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt,
        error_code, error_message, created_at, updated_at, owner_id,
        estimated_cost_microunits, actual_cost_microunits,
        provider_profile_id, provider_model_id, cost_currency
      ) VALUES (
        ?, 'default', ?, ?, 'test', NULL, '{}', ?, ?, 'failed', 1,
        ?, 'safe failure', ?, ?, ?, 5000000, NULL, ?, ?, ?
      )
    `);
    const insertFailure = (input: {
      code: string;
      id: string;
      kind: "audio" | "image" | "text" | "video";
      profileId: string;
      timestamp: string;
    }) => insertTask.run(
      input.id,
      `node-${input.id}`,
      input.kind,
      `key-${input.id}`,
      `fingerprint-${input.id}`,
      input.code,
      input.timestamp,
      input.timestamp,
      ownerId,
      input.profileId,
      input.kind === "text" ? textModelId : `model-${input.kind}`,
      input.kind === "image" || input.kind === "audio" ? "USD" : "CNY",
    );

    insertFailure({
      code: "RATE_LIMIT",
      id: "old-audio-failure",
      kind: "audio",
      profileId: "provider-mureka",
      timestamp: "2026-08-01T18:10:23.134Z",
    });
    insertFailure({
      code: "AUTH",
      id: "text-auth-one",
      kind: "text",
      profileId: arkProfile.id,
      timestamp: "2026-08-03T03:37:28.128Z",
    });
    insertFailure({
      code: "AUTH",
      id: "text-auth-two",
      kind: "text",
      profileId: arkProfile.id,
      timestamp: "2026-08-03T03:37:46.455Z",
    });

    expect(safety.admission({
      costCurrency: "CNY",
      estimatedCostMicrounits: 5_000_000,
      kind: "text",
      now,
      ownerId,
      providerProfileId: arkProfile.id,
    })).toEqual({ allowed: true, code: "ALLOWED" });

    insertFailure({
      code: "PERMISSION",
      id: "text-permission-three",
      kind: "text",
      profileId: arkProfile.id,
      timestamp: "2026-08-03T03:38:00.000Z",
    });
    expect(safety.admission({
      costCurrency: "CNY",
      estimatedCostMicrounits: 5_000_000,
      kind: "text",
      now,
      ownerId,
      providerProfileId: arkProfile.id,
    })).toMatchObject({ allowed: false, code: "PROVIDER_COOLDOWN" });
    expect(safety.admission({
      costCurrency: "USD",
      estimatedCostMicrounits: 5_000_000,
      kind: "image",
      now,
      ownerId,
      providerProfileId: "provider-openrouter",
    })).toEqual({ allowed: true, code: "ALLOWED" });
    expect(safety.admission({
      costCurrency: "CNY",
      estimatedCostMicrounits: 5_000_000,
      kind: "video",
      now,
      ownerId,
      providerProfileId: arkProfile.id,
    })).toEqual({ allowed: true, code: "ALLOWED" });
  } finally {
    database.close();
    safety.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("a generic Provider check cannot clear a newer capability authentication failure", () => {
  const ready = {
    capability: "text" as const,
    costCurrency: "CNY" as const,
    emergencyStop: false,
    globalEnabled: true,
    maxCostMicrounits: 5_000_000,
    providerDriver: "volcengine-ark",
    providerModelId: textModelId,
    providerStatus: "enabled" as const,
    storedProviderDriver: "volcengine-ark",
  };
  expect(evaluateModelRuntimeAvailability({
    ...ready,
    latestAuthFailureAt: "2026-08-03T03:37:46.455Z",
    modelConfigurationUpdatedAt: "2026-08-03T03:27:15.823Z",
    providerConfigurationUpdatedAt: "2026-08-03T03:20:00.000Z",
  })).toMatchObject({
    generationAvailable: false,
    generationUnavailableReasonCode: "PROVIDER_AUTH_FAILED",
  });
  expect(evaluateModelRuntimeAvailability({
    ...ready,
    latestAuthFailureAt: "2026-08-03T03:37:46.455Z",
    modelConfigurationUpdatedAt: "2026-08-03T03:45:00.000Z",
    providerConfigurationUpdatedAt: "2026-08-03T03:20:00.000Z",
  })).toEqual({
    generationAvailable: true,
    generationUnavailableReason: "",
    generationUnavailableReasonCode: null,
  });
});

test("retry snapshot compatibility stays structural for Text Image Video and Audio", () => {
  type RetryModel = Parameters<typeof retrySnapshotCompatibilityProblem>[1];
  const timestamp = "2026-08-03T04:00:00.000Z";
  const model = (
    kind: "audio" | "image" | "text" | "video",
  ): RetryModel => {
    const providerDriver = kind === "image"
      ? "openrouter"
      : kind === "audio"
        ? "mureka"
        : "volcengine-ark";
    const providerModelId = kind === "image"
      ? "openai/gpt-image-2"
      : kind === "video"
        ? "doubao-seedance-2-0-mini-260615"
        : kind === "audio"
          ? "mureka-8"
          : textModelId;
    return {
      cost_currency: kind === "image" || kind === "audio" ? "USD" : "CNY",
      default_parameters: JSON.stringify(knownModelParameterSchema({
        capability: kind,
        providerDriver,
        providerModelId,
      })),
      id: `retry-model-${kind}`,
      latest_auth_failure_at: null,
      latest_capability_success_at: null,
      latest_provider_attempt_at: null,
      max_cost_microunits: 5_000_000,
      model_configuration_updated_at: timestamp,
      provider_configuration_updated_at: timestamp,
      provider_driver: providerDriver,
      provider_model_id: providerModelId,
      provider_profile_id: `retry-provider-${kind}`,
      provider_status: "enabled",
    };
  };
  const task = (
    currentModel: RetryModel,
    kind: "audio" | "image" | "text" | "video",
    parameters: Record<string, unknown>,
  ): GenerationTask => ({
    attempt: 1,
    canvasId: "retry-compatibility",
    costCurrency: currentModel.cost_currency,
    createdAt: timestamp,
    errorCode: "RATE_LIMIT",
    errorMessage: "safe fixture",
    id: `retry-task-${kind}`,
    idempotencyKey: `retry-compatibility-${kind}`,
    kind,
    model: currentModel.id,
    modelConfiguration: {},
    nodeId: `retry-target-${kind}`,
    ownerId: "__test__",
    parameters: { inputSchemaVersion: 1, ...parameters },
    prompt: "已保存的最终Prompt",
    providerModelId: currentModel.provider_model_id,
    providerProfileId: currentModel.provider_profile_id,
    state: "failed",
    updatedAt: timestamp,
  });
  const fixtures = [
    {
      kind: "text" as const,
      parameters: {
        inputMode: "text",
        inputs: [{
          assetId: "text-context-image",
          kind: "image",
          order: 1,
          role: "context-image",
          sourceNodeId: "text-image-source",
        }],
        outputCount: 1,
        responseFormat: "text",
        thinkingLevel: "medium",
      },
    },
    {
      kind: "image" as const,
      parameters: {
        aspectRatio: "auto",
        inputMode: "image",
        inputs: [
          {
            kind: "text",
            order: 1,
            role: "instruction",
            sourceNodeId: "image-text-source",
          },
          {
            assetId: "image-reference",
            kind: "image",
            order: 2,
            role: "reference-image",
            sourceNodeId: "image-reference-source",
          },
        ],
        outputCount: 1,
        quality: "auto",
        references: [{
          assetId: "image-reference",
          kind: "image",
          sourceNodeId: "image-reference-source",
        }],
      },
    },
    {
      kind: "video" as const,
      parameters: {
        aspectRatio: "16:9",
        duration: 5,
        generateAudio: true,
        inputMode: "multimodal",
        inputs: [
          {
            kind: "text",
            order: 1,
            role: "instruction",
            sourceNodeId: "video-text-source",
          },
          {
            assetId: "video-reference-image",
            kind: "image",
            order: 2,
            role: "reference-image",
            sourceNodeId: "video-image-source",
          },
        ],
        outputCount: 1,
        resolution: "480p",
      },
    },
    {
      kind: "audio" as const,
      parameters: {
        inputs: [{
          kind: "text",
          order: 1,
          role: "instruction",
          sourceNodeId: "audio-text-source",
        }],
        musicGenerationMode: "instrumental",
        outputCount: 1,
        streamPlayback: false,
      },
    },
  ];

  for (const fixture of fixtures) {
    const currentModel = model(fixture.kind);
    const compatible = task(currentModel, fixture.kind, fixture.parameters);
    expect(retrySnapshotCompatibilityProblem(compatible, currentModel)).toBeUndefined();

    const incompatible = structuredClone(compatible);
    const inputs = incompatible.parameters.inputs as Array<Record<string, unknown>>;
    inputs[0].role = "wrong-role";
    expect(retrySnapshotCompatibilityProblem(incompatible, currentModel))
      .toContain("当前模型不支持");
  }
});

test("preserved asynchronous Provider IDs stay resumable and cannot be discarded locally", () => {
  const timestamp = "2026-08-03T04:10:00.000Z";
  const task = (
    kind: "audio" | "video",
    state: "failed" | "queued" | "retrying",
  ): GenerationTask => ({
    attempt: 1,
    canvasId: "async-provider-intent",
    costCurrency: kind === "video" ? "CNY" : "USD",
    createdAt: timestamp,
    errorCode: state === "failed" ? "NETWORK" : undefined,
    errorMessage: state === "failed" ? "safe network fixture" : undefined,
    id: `async-provider-intent-${kind}-${state}`,
    idempotencyKey: `async-provider-intent-${kind}-${state}`,
    kind,
    model: `missing-${kind}-model`,
    modelConfiguration: {},
    nodeId: `async-provider-node-${kind}`,
    ownerId: "__test__",
    parameters: {},
    prompt: "resume paid provider task",
    providerModelId: kind === "video"
      ? "doubao-seedance-2-0-mini-260615"
      : "mureka-8",
    providerProfileId: `missing-${kind}-provider`,
    providerTaskId: `${kind}-provider-task-id`,
    state,
    updatedAt: timestamp,
  });

  expect(generationTaskCancellationMode(task("video", "queued")))
    .toBe("cancel-provider-video");
  expect(generationTaskCancellationMode(task("video", "retrying")))
    .toBe("cancel-provider-video");
  expect(generationTaskCancellationMode(task("audio", "queued")))
    .toBe("provider-cancel-unavailable");
  expect(generationTaskCancellationMode(task("audio", "retrying")))
    .toBe("provider-cancel-unavailable");
});

test("only capability success or an explicit Provider/model update clears an auth incident", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-auth-reset-"));
  const safety = createGenerationSafetyStore(dataDirectory);
  let server: ChildProcess | undefined;
  try {
    safety.update({
      audioConcurrency: 5,
      cooldownMinutes: 30,
      dailyCostLimitCnyMicrounits: 100_000_000,
      dailyCostLimitMicrounits: 100_000_000,
      emergencyStop: false,
      failureThreshold: 3,
      globalEnabled: true,
      imageConcurrency: 5,
      monthlyCostLimitCnyMicrounits: 100_000_000,
      monthlyCostLimitMicrounits: 100_000_000,
      perUserConcurrency: 5,
      requestsPerMinute: 120,
      runningTaskPolicy: "wait",
      textConcurrency: 5,
      videoConcurrency: 5,
    });
    server = await startIncidentServer(dataDirectory);

    const saveProfile = async (input: Record<string, unknown>) => {
      const response = await incidentRequest("/api/admin/providers", {
        body: JSON.stringify(input),
        method: "POST",
      });
      expect(response.status).toBe(201);
      return (await response.json() as { profile: { id: string } }).profile.id;
    };
    const arkProfileId = await saveProfile({
      apiKey: "test-only-ark-reset-key",
      driver: "volcengine-ark",
      label: "Ark reset test",
    });
    const openRouterProfileId = await saveProfile({
      apiKey: "test-only-openrouter-reset-key",
      driver: "openrouter",
      label: "OpenRouter reset test",
    });

    const createModel = async (input: Record<string, unknown>) => {
      const response = await incidentRequest("/api/admin/models", {
        body: JSON.stringify({
          isDefault: true,
          maxCostMicrounits: 5_000_000,
          sortOrder: 1,
          status: "published",
          ...input,
        }),
        method: "POST",
      });
      expect(response.status).toBe(201);
      return (await response.json() as { model: { id: string } }).model.id;
    };
    const textModelProfileId = await createModel({
      capability: "text",
      displayName: "Ark Text incident",
      providerModelId: textModelId,
      providerProfileId: arkProfileId,
    });
    const videoModelProfileId = await createModel({
      capability: "video",
      displayName: "Ark Video unaffected",
      providerModelId: "doubao-seedance-2-0-mini-260615",
      providerProfileId: arkProfileId,
    });
    const imageModelProfileId = await createModel({
      capability: "image",
      displayName: "OpenRouter Image unaffected",
      providerModelId: "openai/gpt-image-2",
      providerProfileId: openRouterProfileId,
    });

    const database = openAppDatabase(dataDirectory);
    try {
      const baseline = "2026-08-03T03:30:00.000Z";
      const firstFailure = "2026-08-03T03:31:00.000Z";
      const genericCheck = "2026-08-03T03:32:00.000Z";
      const modelUpdate = "2026-08-03T03:33:00.000Z";
      const secondFailure = "2026-08-03T03:34:00.000Z";
      const providerUpdate = "2026-08-03T03:35:00.000Z";
      const postUpdateCheck = "2026-08-03T03:36:00.000Z";
      const thirdFailure = "2026-08-03T03:37:00.000Z";
      const capabilitySuccess = "2026-08-03T03:38:00.000Z";

      database.prepare(`
        UPDATE model_profiles
        SET updated_at = ?
        WHERE id IN (?, ?, ?)
      `).run(
        baseline,
        textModelProfileId,
        videoModelProfileId,
        imageModelProfileId,
      );
      database.prepare(`
        UPDATE admin_audit_events
        SET created_at = ?
        WHERE action = 'provider_profile.create'
          AND json_extract(details, '$.profileId') IN (?, ?)
      `).run(baseline, arkProfileId, openRouterProfileId);
      database.prepare(`
        UPDATE provider_profiles
        SET status = 'enabled', updated_at = ?
        WHERE id IN (?, ?)
      `).run(genericCheck, arkProfileId, openRouterProfileId);

      const insertTask = database.prepare(`
        INSERT INTO generation_tasks (
          id, canvas_id, node_id, kind, prompt, model, parameters,
          idempotency_key, request_fingerprint, state, attempt,
          error_code, error_message, created_at, updated_at, owner_id,
          estimated_cost_microunits, actual_cost_microunits,
          provider_profile_id, provider_model_id, cost_currency
        ) VALUES (
          ?, 'default', ?, 'text', 'test', ?, '{}', ?, ?, ?, 1,
          ?, ?, ?, ?, '__test__', 5000000, ?, ?, ?, 'CNY'
        )
      `);
      const insertTextOutcome = (input: {
        code?: "AUTH" | "PERMISSION";
        id: string;
        state: "failed" | "success";
        timestamp: string;
      }) => insertTask.run(
        input.id,
        `node-${input.id}`,
        textModelProfileId,
        `key-${input.id}`,
        `fingerprint-${input.id}`,
        input.state,
        input.code ?? null,
        input.code ? "safe incident" : null,
        input.timestamp,
        input.timestamp,
        input.state === "success" ? 0 : null,
        arkProfileId,
        textModelId,
      );
      const insertAudit = database.prepare(`
        INSERT INTO admin_audit_events (
          actor_user_id, action, target_user_id, details, created_at
        ) VALUES ('__test__', ?, NULL, ?, ?)
      `);
      const publicModels = async () => {
        const response = await incidentRequest("/api/models");
        expect(response.status).toBe(200);
        return (await response.json() as {
          models: Array<{
            generationAvailable: boolean;
            generationUnavailableReasonCode: string | null;
            id: string;
          }>;
        }).models;
      };
      const byId = (
        models: Awaited<ReturnType<typeof publicModels>>,
        id: string,
      ) => models.find((model) => model.id === id)!;

      insertTextOutcome({
        code: "AUTH",
        id: "text-auth-after-config",
        state: "failed",
        timestamp: firstFailure,
      });
      insertAudit.run(
        "provider_profile.verify",
        JSON.stringify({ driver: "volcengine-ark", profileId: arkProfileId }),
        genericCheck,
      );
      let models = await publicModels();
      expect(byId(models, textModelProfileId)).toMatchObject({
        generationAvailable: false,
        generationUnavailableReasonCode: "PROVIDER_AUTH_FAILED",
      });
      expect(byId(models, videoModelProfileId)).toMatchObject({
        generationAvailable: true,
        generationUnavailableReasonCode: null,
      });
      expect(byId(models, imageModelProfileId)).toMatchObject({
        generationAvailable: true,
        generationUnavailableReasonCode: null,
      });

      const modelPatch = await incidentRequest(
        `/api/admin/models/${textModelProfileId}`,
        {
          body: JSON.stringify({ displayName: "Ark Text updated" }),
          method: "PATCH",
        },
      );
      expect(modelPatch.status).toBe(200);
      database.prepare(`
        UPDATE model_profiles SET updated_at = ? WHERE id = ?
      `).run(modelUpdate, textModelProfileId);
      models = await publicModels();
      expect(byId(models, textModelProfileId).generationAvailable).toBe(true);

      insertTextOutcome({
        code: "PERMISSION",
        id: "text-permission-after-model-update",
        state: "failed",
        timestamp: secondFailure,
      });
      models = await publicModels();
      expect(byId(models, textModelProfileId).generationAvailable).toBe(false);

      const providerPatch = await incidentRequest(
        `/api/admin/providers/${arkProfileId}`,
        {
          body: JSON.stringify({
            apiKey: "test-only-ark-reset-key-2",
            driver: "volcengine-ark",
            label: "Ark reset test updated",
          }),
          method: "PATCH",
        },
      );
      expect(providerPatch.status).toBe(200);
      database.prepare(`
        UPDATE admin_audit_events
        SET created_at = ?
        WHERE id = (
          SELECT id FROM admin_audit_events
          WHERE action = 'provider_profile.update'
            AND json_extract(details, '$.profileId') = ?
          ORDER BY id DESC LIMIT 1
        )
      `).run(providerUpdate, arkProfileId);
      database.prepare(`
        UPDATE provider_profiles
        SET status = 'enabled', updated_at = ?
        WHERE id = ?
      `).run(postUpdateCheck, arkProfileId);
      insertAudit.run(
        "provider_profile.verify",
        JSON.stringify({ driver: "volcengine-ark", profileId: arkProfileId }),
        postUpdateCheck,
      );
      models = await publicModels();
      expect(byId(models, textModelProfileId).generationAvailable).toBe(true);

      insertTextOutcome({
        code: "AUTH",
        id: "text-auth-after-provider-update",
        state: "failed",
        timestamp: thirdFailure,
      });
      models = await publicModels();
      expect(byId(models, textModelProfileId).generationAvailable).toBe(false);
      insertTextOutcome({
        id: "text-success-after-auth",
        state: "success",
        timestamp: capabilitySuccess,
      });
      models = await publicModels();
      expect(byId(models, textModelProfileId).generationAvailable).toBe(true);

      const retryTimestamp = new Date().toISOString();
      const insertRetryFixture = database.prepare(`
        INSERT INTO generation_tasks (
          id, canvas_id, node_id, kind, prompt, model, parameters,
          idempotency_key, request_fingerprint, state, attempt,
          error_code, error_message, created_at, updated_at, owner_id,
          estimated_cost_microunits, provider_profile_id,
          provider_model_id, provider_task_id, cost_currency,
          model_configuration
        ) VALUES (
          ?, 'default', ?, ?, 'retry safety prompt', ?, ?, ?, ?,
          'failed', 1, ?, 'safe retry fixture', ?, ?, '__test__',
          5000000, ?, ?, ?, ?, '{}'
        )
      `);
      const addRetryFixture = (input: {
        code: string;
        id: string;
        kind: "audio" | "image" | "text" | "video";
        modelId: string;
        parameters: Record<string, unknown>;
        providerModelId: string;
        providerProfileId: string;
        providerTaskId?: string;
      }) => insertRetryFixture.run(
        input.id,
        `node-${input.id}`,
        input.kind,
        input.modelId,
        JSON.stringify(input.parameters),
        `key-${input.id}`,
        `fingerprint-${input.id}`,
        input.code,
        retryTimestamp,
        retryTimestamp,
        input.providerProfileId,
        input.providerModelId,
        input.providerTaskId ?? null,
        input.kind === "text" || input.kind === "video" ? "CNY" : "USD",
      );

      addRetryFixture({
        code: "SERVICE_RESTARTED",
        id: "retry-old-service-restarted",
        kind: "text",
        modelId: textModelProfileId,
        parameters: {
          inputMode: "text",
          inputSchemaVersion: 1,
          inputs: [],
          outputCount: 1,
          responseFormat: "text",
          thinkingLevel: "medium",
        },
        providerModelId: textModelId,
        providerProfileId: arkProfileId,
      });
      database.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, provider_profile_id, provider_model_id,
          kind, evidence, created_at
        ) VALUES (?, 1, ?, ?, 'text', 'historical-execution-attempt', ?)
      `).run(
        "retry-old-service-restarted",
        arkProfileId,
        textModelId,
        retryTimestamp,
      );
      addRetryFixture({
        code: "NETWORK",
        id: "retry-network-unknown",
        kind: "text",
        modelId: textModelProfileId,
        parameters: {
          inputMode: "text",
          inputSchemaVersion: 1,
          inputs: [],
          outputCount: 1,
          responseFormat: "text",
          thinkingLevel: "medium",
        },
        providerModelId: textModelId,
        providerProfileId: arkProfileId,
      });
      database.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, provider_profile_id, provider_model_id,
          kind, evidence, created_at
        ) VALUES (?, 1, ?, ?, 'text', 'provider-boundary', ?)
      `).run(
        "retry-network-unknown",
        arkProfileId,
        textModelId,
        retryTimestamp,
      );
      addRetryFixture({
        code: "RATE_LIMIT",
        id: "retry-parameter-incompatible",
        kind: "text",
        modelId: textModelProfileId,
        parameters: {
          inputMode: "text",
          inputSchemaVersion: 1,
          inputs: [],
          outputCount: 1,
          responseFormat: "text",
          thinkingLevel: "high",
        },
        providerModelId: textModelId,
        providerProfileId: arkProfileId,
      });
      addRetryFixture({
        code: "RATE_LIMIT",
        id: "retry-safe-rate-limit",
        kind: "text",
        modelId: textModelProfileId,
        parameters: {
          inputMode: "text",
          inputSchemaVersion: 1,
          inputs: [],
          outputCount: 1,
          responseFormat: "text",
          thinkingLevel: "medium",
        },
        providerModelId: textModelId,
        providerProfileId: arkProfileId,
      });
      addRetryFixture({
        code: "RATE_LIMIT",
        id: "retry-input-rule-incompatible",
        kind: "image",
        modelId: imageModelProfileId,
        parameters: {
          aspectRatio: "auto",
          inputMode: "text",
          inputSchemaVersion: 1,
          inputs: [{
            assetId: "saved-image-asset",
            kind: "image",
            order: 1,
            role: "reference-image",
            sourceNodeId: "saved-image-source",
          }],
          outputCount: 1,
          quality: "auto",
          references: [{
            assetId: "saved-image-asset",
            kind: "image",
            sourceNodeId: "saved-image-source",
          }],
        },
        providerModelId: "openai/gpt-image-2",
        providerProfileId: openRouterProfileId,
      });

      addRetryFixture({
        code: "NETWORK",
        id: "retry-video-network-no-id",
        kind: "video",
        modelId: videoModelProfileId,
        parameters: {
          aspectRatio: "16:9",
          duration: 5,
          generateAudio: true,
          inputMode: "text",
          inputSchemaVersion: 1,
          inputs: [],
          outputCount: 1,
          resolution: "480p",
        },
        providerModelId: "doubao-seedance-2-0-mini-260615",
        providerProfileId: arkProfileId,
      });
      database.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, provider_profile_id, provider_model_id,
          kind, evidence, created_at
        ) VALUES (?, 1, ?, ?, 'video', 'provider-boundary', ?)
      `).run(
        "retry-video-network-no-id",
        arkProfileId,
        "doubao-seedance-2-0-mini-260615",
        retryTimestamp,
      );
      addRetryFixture({
        code: "SERVICE_RESTARTED",
        id: "retry-audio-restart-no-id",
        kind: "audio",
        modelId: "missing-audio-model",
        parameters: {
          inputSchemaVersion: 1,
          inputs: [],
          musicGenerationMode: "instrumental",
          outputCount: 1,
          streamPlayback: false,
        },
        providerModelId: "mureka-8",
        providerProfileId: "missing-audio-provider",
      });
      addRetryFixture({
        code: "NETWORK",
        id: "retry-video-network-with-id",
        kind: "video",
        modelId: "missing-video-model",
        parameters: {
          inputSchemaVersion: 1,
          inputs: [],
        },
        providerModelId: "doubao-seedance-2-0-mini-260615",
        providerProfileId: "missing-video-provider",
        providerTaskId: "video-provider-task-resume",
      });
      addRetryFixture({
        code: "REMOTE",
        id: "retry-audio-download-with-id",
        kind: "audio",
        modelId: "missing-audio-model",
        parameters: {
          inputSchemaVersion: 1,
          inputs: [],
        },
        providerModelId: "mureka-8",
        providerProfileId: "missing-audio-provider",
        providerTaskId: "audio-provider-task-resume",
      });

      const recordedBeforeRetries = generationProviderAttemptCounts(database);
      for (const id of [
        "retry-old-service-restarted",
        "retry-network-unknown",
        "retry-video-network-no-id",
        "retry-audio-restart-no-id",
      ]) {
        const summary = await incidentRequest(`/api/generation-tasks/${id}`);
        expect(summary.status).toBe(200);
        expect(await summary.json()).toMatchObject({
          retryAllowed: false,
          retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
        });
        const response = await incidentRequest(
          `/api/generation-tasks/${id}/retry`,
          { method: "POST" },
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          code: "RETRY_OUTCOME_UNKNOWN",
        });
      }
      for (const id of [
        "retry-parameter-incompatible",
        "retry-input-rule-incompatible",
      ]) {
        const summary = await incidentRequest(`/api/generation-tasks/${id}`);
        expect(summary.status).toBe(200);
        expect(await summary.json()).toMatchObject({
          retryAllowed: false,
          retryBlockCode: "RETRY_SNAPSHOT_INCOMPATIBLE",
        });
        const response = await incidentRequest(
          `/api/generation-tasks/${id}/retry`,
          { method: "POST" },
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          code: "RETRY_SNAPSHOT_INCOMPATIBLE",
        });
      }
      const safelyRetryable = await incidentRequest(
        "/api/generation-tasks/retry-safe-rate-limit",
      );
      expect(safelyRetryable.status).toBe(200);
      expect(await safelyRetryable.json()).toMatchObject({
        retryAllowed: true,
      });
      for (const id of [
        "retry-video-network-with-id",
        "retry-audio-download-with-id",
      ]) {
        const summary = await incidentRequest(`/api/generation-tasks/${id}`);
        expect(summary.status).toBe(200);
        expect(await summary.json()).toMatchObject({ retryAllowed: true });
        const response = await incidentRequest(
          `/api/generation-tasks/${id}/retry`,
          { method: "POST" },
        );
        expect(response.status).toBe(202);
      }
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const outcomes = database.prepare(`
          SELECT id, attempt, provider_task_id, state
          FROM generation_tasks
          WHERE id IN (?, ?)
          ORDER BY id
        `).all(
          "retry-video-network-with-id",
          "retry-audio-download-with-id",
        ) as Array<{
          attempt: number;
          id: string;
          provider_task_id: string | null;
          state: string;
        }>;
        if (
          outcomes.length === 2 &&
          outcomes.every(({ attempt, provider_task_id, state }) =>
            attempt === 2 && Boolean(provider_task_id) && state === "failed"
          )
        ) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(database.prepare(`
        SELECT id, attempt, provider_task_id, state
        FROM generation_tasks
        WHERE id IN (?, ?)
        ORDER BY id
      `).all(
        "retry-video-network-with-id",
        "retry-audio-download-with-id",
      )).toEqual([
        {
          attempt: 2,
          id: "retry-audio-download-with-id",
          provider_task_id: "audio-provider-task-resume",
          state: "failed",
        },
        {
          attempt: 2,
          id: "retry-video-network-with-id",
          provider_task_id: "video-provider-task-resume",
          state: "failed",
        },
      ]);
      expect(generationProviderAttemptCounts(database))
        .toEqual(recordedBeforeRetries);

      const insertRunningCancellationFixture = database.prepare(`
        INSERT INTO generation_tasks (
          id, canvas_id, node_id, kind, prompt, model, parameters,
          idempotency_key, request_fingerprint, state, attempt,
          created_at, updated_at, owner_id, estimated_cost_microunits,
          provider_profile_id, provider_model_id, cost_currency,
          model_configuration
        ) VALUES (
          ?, 'default', ?, 'text', 'cancel safety prompt', ?, '{}', ?, ?,
          'running', 1, ?, ?, '__test__', 5000000, ?, ?, 'CNY', '{}'
        )
      `);
      for (const id of [
        "cancel-text-before-boundary",
        "cancel-text-after-boundary",
      ]) {
        insertRunningCancellationFixture.run(
          id,
          `node-${id}`,
          textModelProfileId,
          `key-${id}`,
          `fingerprint-${id}`,
          retryTimestamp,
          retryTimestamp,
          arkProfileId,
          textModelId,
        );
      }
      database.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, provider_profile_id, provider_model_id,
          kind, evidence, created_at
        ) VALUES (?, 1, ?, ?, 'text', 'provider-boundary', ?)
      `).run(
        "cancel-text-after-boundary",
        arkProfileId,
        textModelId,
        retryTimestamp,
      );

      const blockedCancellation = await incidentRequest(
        "/api/generation-tasks/cancel-text-after-boundary",
        { method: "DELETE" },
      );
      expect(blockedCancellation.status).toBe(409);
      expect(await blockedCancellation.json()).toMatchObject({
        code: "CANCEL_OUTCOME_UNKNOWN",
      });
      expect(database.prepare(`
        SELECT state FROM generation_tasks WHERE id = ?
      `).get("cancel-text-after-boundary")).toEqual({ state: "running" });

      const localCancellation = await incidentRequest(
        "/api/generation-tasks/cancel-text-before-boundary",
        { method: "DELETE" },
      );
      expect(localCancellation.status).toBe(200);
      expect(await localCancellation.json()).toMatchObject({
        errorCode: "USER_CANCELLED",
        state: "cancelled",
      });

      const expectedCounts = generationProviderAttemptCounts(database);
      expect(expectedCounts).toEqual({
        historicalEstimatedProviderAttempts: 1,
        paidProviderRequests: 3,
      });
      for (const endpoint of [
        "/api/generation-tasks/status",
        "/api/admin/generation-safety",
        "/api/admin/providers",
      ]) {
        const countStatus = await incidentRequest(endpoint);
        expect(countStatus.status).toBe(200);
        expect(await countStatus.json()).toMatchObject(expectedCounts);
      }
    } finally {
      database.close();
    }
  } finally {
    safety.close();
    if (server) await stopIncidentServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
