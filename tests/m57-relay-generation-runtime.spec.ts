import { expect, test } from "./safe-test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { saveAccountCredential } from "../server/accountCredentials";
import {
  createGenerationTaskStore,
  generationProviderAttemptCounts,
  type GenerationTask,
} from "../server/generationTaskStore";
import { openAppDatabase } from "../server/database";
import { removeUnpublishedGeneratedMedia } from "../server/generatedMediaCleanup";
import { resolvePersistedNodeInputs } from "../server/inputPreflight";
import { bootstrapPublishedModelContracts } from "../server/modelReleaseBootstrap";
import { modelContractState } from "../server/modelReleaseRevisionStore";
import { buildAuthoritativeGenerationModelConfiguration } from
  "../server/authoritativeGenerationModelConfiguration";
import { authoritativeModelConfigurationRevision } from
  "../server/modelConfigurationIdentity";
import { registeredModelExecution } from "../server/modelExecutionRegistry";
import { registerMediaForOwner } from "../server/mediaRegistry";
import {
  attemptProviderResultSave,
  executeTextTaskWithDependencies,
  gptImageSizeForAspectRatio,
  generationTaskCancellationMode,
  isTransientProviderResultSaveError,
  relayMediaParametersForTask,
  resetGenerationTaskStoreForRuntimeTest,
  retrySafetyDecision,
  runGenerationRecoverySweep,
  validateImageToolResultPng,
} from "../server/generationTasks";
// Exercise the production composition root so the recovery write/frozen gate
// and its real inspection ports are installed before the sweep runs.
import "../server/applicationComposition";
import { inspectGenerationRecoveryCase } from
  "../server/generationRecoveryCaseWorker";
import { createGenerationRecoveryCaseStore, generationRecoverySystemActorId } from
  "../server/generationRecoveryCaseStore";
import { createGenerationRecoveryOriginalCommands, issueAdapterVerifiedOriginalRecoveryEvidence } from
  "../server/generationRecoveryOriginalCommands";
import { readOriginalGenerationRecoveryLedgers } from
  "../server/generationRecoveryLedgerQueries";
import { settleSynchronousResultSaveExhaustion } from
  "../server/generationResultCommit";
import {
  MediaPublicationDeferredError,
  MediaPublicationConflictError,
  MediaPublicationStateError,
} from "../server/mediaLifecycle";
import { ResourceBudgetError } from "../server/resourceBudget";
import { ProviderResultMediaError } from "../server/providerResultMedia";
import { MediaMetadataError } from "../server/mediaMetadata";
import { saveProviderProfile, type ProviderProfile } from "../server/providerProfiles";
import { RelayProviderError } from "../server/relayProviderAdapters";
import { listRelayUsageRecords } from "../server/relayUsageReconcile";
import {
  relayMediaModelContract,
  relayMediaPollingDecision,
  relayMediaSubmissionAction,
} from "../server/relayMediaModelContracts";
import { providerParameterSchema } from "../types/modelParameters";
import {
  generationInputKey,
  generationOwnershipEvidence,
  generationOwnershipKey,
} from "../types/generationIdentity";

const relayProfile: ProviderProfile = {
  apiKey: "relay-runtime-fixture-secret",
  baseUrl: "https://relay.example.test/v1",
  configurationVersion: 1,
  createdAt: "2026-08-03T00:00:00.000Z",
  driver: "multi-protocol-relay",
  id: "relay-runtime-profile",
  label: "Relay runtime fixture",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

test("relay usage reconciliation crosses the Provider boundary only after its lease hook", async () => {
  const order: string[] = [];
  const records = await listRelayUsageRecords(
    relayProfile,
    async () => {
      order.push("fetch");
      return new Response(JSON.stringify({ data: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
    { beforeRequest: () => order.push("lease") },
  );
  expect(records).toEqual([]);
  expect(order).toEqual(["lease", "fetch"]);
});

function paidProviderAttempts(directory: string) {
  const database = openAppDatabase(directory);
  try {
    return Number((database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_provider_attempts
      WHERE evidence = 'provider-boundary'
    `).get() as { count: number }).count);
  } finally {
    database.close();
  }
}

function relayTask(
  kind: GenerationTask["kind"],
  providerProtocol: string,
  overrides: Partial<GenerationTask> = {},
): GenerationTask {
  return {
    attempt: 1,
    canvasId: "relay-runtime-canvas",
    costCurrency: "USD",
    createdAt: "2026-08-03T00:00:00.000Z",
    id: `relay-${kind}-task`,
    idempotencyKey: `relay-${kind}-idempotency-001`,
    kind,
    model: `relay-${kind}-model`,
    modelConfiguration: {
      providerConfigurationVersion: 1,
      providerDriver: "multi-protocol-relay",
      providerProtocol,
    },
    nodeId: `relay-${kind}-node`,
    ownerId: "__test__",
    parameters: { inputSchemaVersion: 1, inputs: [] },
    prompt: "fixture prompt",
    providerModelId: `vendor/${kind}-model`,
    providerProfileId: relayProfile.id,
    requestFingerprint: "relay-fixture-request-fingerprint",
    state: "failed",
    updatedAt: "2026-08-03T00:00:01.000Z",
    ...overrides,
  };
}

function authoritativeRuntimeFixture(input: Readonly<{
  canvasId: string;
  credentialVersion: number;
  database: DatabaseSync;
  modelId: string;
  nodeId: string;
  parameters: Record<string, unknown>;
  prompt: string;
  providerModelId: string;
  providerProfileId: string;
}>) {
  const model = input.database.prepare(`
    SELECT
      models.updated_at AS modelConfigurationUpdatedAt,
      providers.provider_configuration_version AS providerConfigurationVersion
    FROM model_profiles AS models
    JOIN provider_profiles AS providers
      ON providers.id = models.provider_profile_id
    WHERE models.id = ?
  `).get(input.modelId) as {
    modelConfigurationUpdatedAt: string;
    providerConfigurationVersion: number;
  } | undefined;
  const modelReleaseRevision = modelContractState(
    input.database,
    input.modelId,
  ).active;
  const execution = registeredModelExecution({
    capability: "video",
    providerDriver: "multi-protocol-relay",
    providerModelId: input.providerModelId,
    providerProtocol: "media-generate",
  });
  if (!model || !modelReleaseRevision || !execution) {
    throw new Error("m57 runtime model fixture is incomplete");
  }
  const parameterSchema = modelReleaseRevision.document.capabilitySchema;
  const modelConfigurationRevision = authoritativeModelConfigurationRevision({
    capability: "video",
    id: input.modelId,
    modelConfigurationUpdatedAt: model.modelConfigurationUpdatedAt,
    parameterSchema,
    providerDriver: "multi-protocol-relay",
    providerModelId: input.providerModelId,
  });
  const generationInputKey = `m57:${input.canvasId}:${input.nodeId}:input`;
  const generationOwnershipKey =
    `m57:${input.modelId}:${input.nodeId}:ownership`;
  const modelInputContractFingerprint = `m57:${input.modelId}:contract`;
  const fixtureScopeId = "m57-runtime-auto-refund";
  const modelConfiguration = buildAuthoritativeGenerationModelConfiguration({
    credentialVersion: input.credentialVersion,
    fixtureScopeId,
    generationInputKey,
    generationOwnershipKey,
    modelCapability: "video",
    modelConfigurationRevision,
    modelExecutionAdapterId: execution.adapterId,
    modelId: input.modelId,
    modelInputContractFingerprint,
    modelReleaseRevision,
    modelResultCount: execution.resultCount,
    parameterSchema,
    providerConfigurationVersion: model.providerConfigurationVersion,
    providerDriver: "multi-protocol-relay",
    providerModelId: input.providerModelId,
    providerProfileId: input.providerProfileId,
    providerProtocol: "media-generate",
  });
  return {
    modelConfiguration,
    requestIntent: {
      canvasId: input.canvasId,
      fixtureScopeId,
      generationIdentityVersion: 2,
      generationInputKey,
      generationOwnershipKey,
      kind: "video" as const,
      model: input.modelId,
      modelConfigurationRevision,
      modelInputContractFingerprint,
      modelReleaseRevision: modelReleaseRevision.revisionId,
      nodeId: input.nodeId,
      parameters: input.parameters,
      prompt: input.prompt,
    },
  };
}

test("relay save blips are transient while result and local format errors are not", () => {
  expect(isTransientProviderResultSaveError(
    new ProviderResultMediaError("NETWORK", "模型结果暂时无法下载"),
  )).toBe(true);
  expect(isTransientProviderResultSaveError(
    new ProviderResultMediaError("TIMEOUT", "模型结果下载超时"),
  )).toBe(true);
  expect(isTransientProviderResultSaveError(
    new ProviderResultMediaError("REMOTE", "模型结果暂时无法下载"),
  )).toBe(true);
  expect(isTransientProviderResultSaveError(
    new ResourceBudgetError("RESOURCE_BUSY", 429, "Media processing capacity is busy"),
  )).toBe(true);
  expect(isTransientProviderResultSaveError(
    new MediaPublicationConflictError(),
  )).toBe(true);
  expect(isTransientProviderResultSaveError(
    new MediaPublicationStateError("publication changed"),
  )).toBe(true);
  expect(isTransientProviderResultSaveError(
    new ProviderResultMediaError("FORMAT", "模型结果格式不受支持"),
  )).toBe(false);
  expect(isTransientProviderResultSaveError(
    new MediaMetadataError("TEMPORARY", "服务器暂时无法读取素材时长"),
  )).toBe(true);
  expect(isTransientProviderResultSaveError(
    new MediaMetadataError("DEPENDENCY_UNAVAILABLE", "服务器素材读取组件不可用"),
  )).toBe(false);
  expect(isTransientProviderResultSaveError(new Error("unknown"))).toBe(false);

  const transparentPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DAAAAEAQEARwbK3gAAAABJRU5ErkJggg==",
    "base64",
  );
  const opaqueAlphaPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  expect(() => validateImageToolResultPng(transparentPng, {
    operation: "remove-background",
    operationId: "cutout-result",
    outputBackground: "transparent",
    sourceAssetId: "source-asset",
    sourceNodeId: "source-node",
  })).not.toThrow();
  expect(() => validateImageToolResultPng(opaqueAlphaPng, {
    operation: "remove-background",
    operationId: "cutout-result",
    outputBackground: "transparent",
    sourceAssetId: "source-asset",
    sourceNodeId: "source-node",
  })).toThrow(/transparent pixels/);
});

test("the shared save gate retries transient errors with a bounded budget and throws real ones", async () => {
  let attempts = 0;
  const transient = () => attemptProviderResultSave({
    backoffMs: [0, 0, 0, 0, 0],
    taskId: "save-gate-transient",
    save: async () => {
      attempts += 1;
      if (attempts <= 5) {
        throw new ProviderResultMediaError("NETWORK", "模型结果暂时无法下载");
      }
    },
  });
  expect(await transient()).toBe(true);
  expect(attempts).toBe(6);

  let formatAttempts = 0;
  await expect(attemptProviderResultSave({
    backoffMs: [0, 0, 0, 0, 0],
    taskId: "save-gate-format",
    save: () => {
      formatAttempts += 1;
      throw new ProviderResultMediaError("FORMAT", "模型结果格式不受支持");
    },
  })).rejects.toMatchObject({ code: "FORMAT" });
  expect(formatAttempts).toBe(1);

  let metadataAttempts = 0;
  await expect(attemptProviderResultSave({
    backoffMs: [0, 0, 0, 0, 0],
    taskId: "save-gate-media-metadata",
    save: () => {
      metadataAttempts += 1;
      throw new MediaMetadataError(
        "DEPENDENCY_UNAVAILABLE",
        "服务器素材读取组件不可用",
      );
    },
  })).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  expect(metadataAttempts).toBe(1);
});

test("the shared save gate retries unknown errors with a bounded budget and records the real message", async () => {
  const originalError = console.error;
  const diagnostics: unknown[][] = [];
  console.error = (...args) => {
    diagnostics.push(args);
  };
  try {
    let attempts = 0;
    const unknown = () => attemptProviderResultSave({
      backoffMs: [0, 0, 0, 0, 0],
      taskId: "save-gate-unknown",
      save: async () => {
        attempts += 1;
        if (attempts <= 6) {
          throw new Error("unknown local publication failure");
        }
      },
    });
    expect(await unknown()).toBe(false);
    expect(await unknown()).toBe(true);
    expect(attempts).toBe(7);
    expect(diagnostics).toHaveLength(6);
    const parsed = JSON.parse(String(diagnostics.at(-1)![0])) as {
      errorCode: unknown;
      event: string;
      message: string;
      stage: string;
      taskId: string;
    };
    expect(parsed).toMatchObject({
      event: "generation-diagnostic",
      message: "Generation operation failed",
      stage: "save",
      taskId: "save-gate-unknown",
    });
    expect(parsed.errorCode).toBeNull();
  } finally {
    console.error = originalError;
  }
});

test("OpenRouter and relay GPT image pre-stage save exhaustion settle the exact response without another paid attempt", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    for (const fixture of [{
      adapterId: "openrouter-image",
      driver: "openrouter",
      protocol: "native",
    }, {
      adapterId: "relay-gpt-image",
      driver: "multi-protocol-relay",
      protocol: "gpt-image",
    }] as const) {
      const directory = await mkdtemp(join(
        tmpdir(),
        `unboundry-${fixture.adapterId}-save-exhaustion-`,
      ));
      const store = createGenerationTaskStore(directory);
      try {
        const created = store.create({
          canvasId: `${fixture.adapterId}-canvas`,
          idempotencyKey: `${fixture.adapterId}-save-exhaustion-001`,
          kind: "image",
          modelConfiguration: {
            modelExecutionAdapterId: fixture.adapterId,
            providerDriver: fixture.driver,
            providerProtocol: fixture.protocol,
          },
          nodeId: `${fixture.adapterId}-node`,
          ownerId: "__test__",
          prompt: "preserve the exact synchronous Provider response",
          providerModelId: `${fixture.adapterId}-model`,
          providerProfileId: `${fixture.adapterId}-profile`,
        });
        const running = store.transition(created.task.id, "running")!;
        store.recordProviderAttempt(running.id);
        store.markProviderResponseReceived({
          executionAttempt: running.attempt,
          taskId: running.id,
        });
        const beforeDatabase = openAppDatabase(directory);
        const before = generationProviderAttemptCounts(beforeDatabase);
        beforeDatabase.close();

        expect(await attemptProviderResultSave({
          backoffMs: [],
          save: async () => {
            throw new ProviderResultMediaError(
              "NETWORK",
              "the synchronous bytes could not be staged",
            );
          },
          settleSynchronousResultSave: (input) =>
            settleSynchronousResultSaveExhaustion({
              ...input,
              dataDirectory: directory,
            }),
          store,
          synchronousResponseExecutionAttempt: running.attempt,
          taskId: running.id,
        })).toBe(false);

        expect(store.get(running.id)).toMatchObject({
          attempt: 1,
          errorCode: "RESULT_SAVE_FAILED_NO_RETRY",
          providerTaskId: undefined,
          state: "failed",
        });
        expect(store.getProviderAttemptForTask(running.id)).toMatchObject({
          executionAttempt: 1,
          failureCode: "RESULT_SAVE_FAILED_NO_RETRY",
          outcome: "response-received",
          providerTaskId: undefined,
        });
        const afterDatabase = openAppDatabase(directory);
        expect(generationProviderAttemptCounts(afterDatabase)).toEqual(before);
        afterDatabase.close();
      } finally {
        store.close();
        await rm(directory, { force: true, recursive: true });
      }
    }

    const deferredDirectory = await mkdtemp(join(
      tmpdir(),
      "unboundry-sync-publication-deferred-",
    ));
    const deferredStore = createGenerationTaskStore(deferredDirectory);
    try {
      const created = deferredStore.create({
        canvasId: "sync-publication-deferred-canvas",
        idempotencyKey: "sync-publication-deferred-001",
        kind: "image",
        modelConfiguration: {
          modelExecutionAdapterId: "openrouter-image",
          providerDriver: "openrouter",
          providerProtocol: "native",
        },
        nodeId: "sync-publication-deferred-node",
        ownerId: "__test__",
        prompt: "the durable publication owns these bytes",
        providerModelId: "sync-publication-deferred-model",
        providerProfileId: "sync-publication-deferred-profile",
      });
      const running = deferredStore.transition(created.task.id, "running")!;
      deferredStore.recordProviderAttempt(running.id);
      deferredStore.markProviderResponseReceived({
        executionAttempt: running.attempt,
        taskId: running.id,
      });
      const timestamp = new Date().toISOString();
      const publicationDatabase = openAppDatabase(deferredDirectory);
      publicationDatabase.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES ('__test__', 'sync-publication-test', 'Sync Publication Test',
          'test', 'user', 'active', ?, ?)
      `).run(timestamp, timestamp);
      publicationDatabase.prepare(`
        INSERT INTO media_publication_attempts (
          attempt_id, owner_id, kind, asset_id, source, state,
          storage_backend, final_storage_name, object_key,
          storage_profile_id, staging_name, task_id,
          task_execution_attempt, content_type, created_at, updated_at
        ) VALUES (?, '__test__', 'image', ?, 'generation', 'staged',
          'local', ?, ?, NULL, ?, ?, ?, 'image/png', ?, ?)
      `).run(
        "sync-publication-deferred-attempt",
        "sync-publication-deferred-asset",
        "sync-publication-deferred.png",
        "sync-publication-deferred.png",
        "sync-publication-deferred.staging",
        running.id,
        running.attempt,
        timestamp,
        timestamp,
      );
      publicationDatabase.close();
      let terminalSettlementCalls = 0;
      expect(await attemptProviderResultSave({
        backoffMs: [],
        save: async () => {
          throw new MediaPublicationDeferredError();
        },
        settleSynchronousResultSave: () => {
          terminalSettlementCalls += 1;
          return undefined;
        },
        store: deferredStore,
        synchronousResponseExecutionAttempt: running.attempt,
        taskId: running.id,
      })).toBe(false);
      expect(terminalSettlementCalls).toBe(0);
      expect(deferredStore.get(running.id)).toMatchObject({
        errorCode: "AUTOMATIC_RESULT_RECOVERY",
        state: "recovering",
      });
      expect(settleSynchronousResultSaveExhaustion({
        dataDirectory: deferredDirectory,
        executionAttempt: running.attempt,
        taskId: running.id,
      })).toBeUndefined();
      expect(deferredStore.getProviderAttemptForTask(running.id)?.failureCode)
        .toBeUndefined();
      const verify = openAppDatabase(deferredDirectory);
      expect(verify.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?
      `).get(running.id)).toEqual({ count: 3 });
      verify.close();
    } finally {
      deferredStore.close();
      await rm(deferredDirectory, { force: true, recursive: true });
    }
  } finally {
    console.error = originalError;
  }
});

test("Gemini relay Text materializes ordered four-kind context once and persists no transient URL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-text-"));
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "relay-runtime-canvas",
      costCurrency: "USD",
      estimatedCostMicrounits: 2_000_000,
      idempotencyKey: "relay-gemini-text-idempotency-001",
      kind: "text",
      model: "relay-gemini-text-model",
      modelConfiguration: {
        providerConfigurationVersion: 1,
        providerDriver: "multi-protocol-relay",
        providerProtocol: "gemini-generate-content",
      },
      nodeId: "relay-gemini-text-node",
      ownerId: "__test__",
      parameters: {
        inputSchemaVersion: 1,
        inputs: [
          { kind: "text", order: 1, role: "context-text", sourceNodeId: "text-up", text: "上游文字" },
          { assetId: "image.png", kind: "image", order: 2, role: "context-image", sourceNodeId: "image-up" },
          { assetId: "video.mp4", kind: "video", order: 3, role: "context-video", sourceNodeId: "video-up" },
          { assetId: "audio.mp3", kind: "audio", order: 4, role: "context-audio", sourceNodeId: "audio-up" },
        ],
        maxOutputTokens: 64,
        outputCount: 1,
        temperature: 0,
      },
      prompt: "根据四类上下文生成说明",
      providerModelId: "gemini-fixture-model",
      providerProfileId: relayProfile.id,
    });
    const requestBodies: unknown[] = [];
    let providerCalls = 0;
    await executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: async () => ({ profile: relayProfile, release() {} }),
      fetcher: async (_input, init) => {
        providerCalls += 1;
        requestBodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          candidates: [{ content: { parts: [{ text: "生成成功" }] } }],
          usageMetadata: {
            candidatesTokenCount: 8,
            promptTokenCount: 32,
            totalTokenCount: 40,
          },
        });
      },
      mediaContentTypeForOwner: ({ kind }) =>
        kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
      mediaUrlForOwner: async ({ kind }) =>
        kind === "image"
          ? "data:image/png;base64,ZmFrZQ=="
          : kind === "audio"
            ? "data:audio/mp3;base64,ZmFrZQ=="
            : "https://signed.example.test/video.mp4?expires=300",
      store,
    });
    expect(providerCalls).toBe(1);
    expect(requestBodies[0]).toMatchObject({
      contents: [{
        parts: [
          { text: "上游文字" },
          { inlineData: { mimeType: "image/png" } },
          { fileData: { mimeType: "video/mp4" } },
          { inlineData: { mimeType: "audio/mpeg" } },
          { text: "根据四类上下文生成说明" },
        ],
        role: "user",
      }],
      generationConfig: { maxOutputTokens: 64, temperature: 0 },
    });
    expect(store.get(created.task.id)).toMatchObject({
      actualCostMicrounits: 2_000_000,
      providerUsageTokens: 40,
      resultText: "生成成功",
      state: "success",
    });
    expect(JSON.stringify(store.get(created.task.id))).not.toContain("signed.example.test");
    expect(paidProviderAttempts(directory)).toBe(1);
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("unsupported relay Text context fails before Provider boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-text-reject-"));
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "relay-runtime-canvas",
      idempotencyKey: "relay-chat-video-reject-001",
      kind: "text",
      modelConfiguration: { providerProtocol: "openai-chat" },
      nodeId: "relay-chat-video-node",
      ownerId: "__test__",
      parameters: {
        inputs: [{
          assetId: "video.mp4",
          kind: "video",
          order: 1,
          role: "context-video",
          sourceNodeId: "video-up",
        }],
      },
      prompt: "分析视频",
      providerModelId: "chat-fixture-model",
      providerProfileId: relayProfile.id,
    });
    let providerCalls = 0;
    await executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: async () => ({ profile: relayProfile, release() {} }),
      fetcher: async () => {
        providerCalls += 1;
        return Response.json({});
      },
      mediaContentTypeForOwner: () => "video/mp4",
      mediaUrlForOwner: async () => "https://signed.example.test/video.mp4",
      store,
    });
    expect(providerCalls).toBe(0);
    expect(paidProviderAttempts(directory)).toBe(0);
    expect(store.get(created.task.id)).toMatchObject({ errorCode: "FORMAT", state: "failed" });
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("relay media parameters use explicit role mapping and keep transient URLs out of snapshots", async () => {
  const task = relayTask("video", "media-generate", {
    parameters: {
      aspectRatio: "16:9",
      inputSchemaVersion: 1,
      inputs: [
        { assetId: "first.png", kind: "image", order: 1, role: "first-frame", sourceNodeId: "first" },
        { assetId: "voice.mp3", kind: "audio", order: 2, role: "reference-audio", sourceNodeId: "voice" },
        { assetId: "style.png", kind: "image", order: 3, role: "reference-image", sourceNodeId: "style" },
      ],
      references: [{ secretLegacyField: "not-forwarded" }],
    },
  });
  const before = JSON.stringify(task.parameters);
  const materialized = await relayMediaParametersForTask(task, async ({ assetId }) =>
    `https://signed.example.test/${assetId}?expires=300`
  );
  expect(materialized).toEqual({
    aspect_ratio: "16:9",
    first_frame_url: "https://signed.example.test/first.png?expires=300",
    reference_audio_url: "https://signed.example.test/voice.mp3?expires=300",
    reference_image_url: "https://signed.example.test/style.png?expires=300",
  });
  expect(JSON.stringify(task.parameters)).toBe(before);
  expect(before).not.toContain("signed.example.test");

  await expect(relayMediaParametersForTask(
    relayTask("video", "media-generate", {
      parameters: { custom_unmapped_12345678: "must-not-leave" },
    }),
    async () => "https://signed.example.test/unused",
  )).rejects.toMatchObject({ code: "FORMAT" });

  const grokTask = relayTask("video", "media-generate", {
    parameters: {
      aspectRatio: "16:9",
      duration: "1",
      inputSchemaVersion: 1,
      inputs: [
        { assetId: "first.png", kind: "image", order: 1, role: "first-frame", sourceNodeId: "first" },
      ],
      resolution: "480p",
    },
    providerModelId: "grok-imagine-video-1.5-preview",
  });

  await expect(relayMediaParametersForTask(grokTask, async ({ assetId }) =>
    `https://signed.example.test/${assetId}?expires=300`
  )).resolves.toEqual({
    aspect_ratio: "16:9",
    duration: "1",
    images: ["https://signed.example.test/first.png?expires=300"],
    resolution: "480p",
  });

  const suno = relayMediaModelContract("suno-v4.5")!;
  expect(suno.mapParameters({
    bitrate: 128_000,
    musicGenerationMode: "prompt-song",
    sampleRate: 44_100,
    vocalGender: "male",
  }, "song prompt")).toMatchObject({
    make_instrumental: "song",
    vocal_gender: "m",
  });
  expect(suno.mapParameters({
    bitrate: 192_000,
    lyrics: "fixture lyrics",
    musicGenerationMode: "lyrics-song",
    sampleRate: 48_000,
    vocalGender: "female",
  }, "song style")).toMatchObject({
    lyrics: "fixture lyrics",
    make_instrumental: "song",
    vocal_gender: "f",
  });

  await expect(relayMediaParametersForTask(
    relayTask("video", "media-generate", {
      parameters: { inputSchemaVersion: 1, inputs: [] },
      providerModelId: "grok-imagine-video-1.5-preview",
    }),
    async () => "https://signed.example.test/unused",
  )).rejects.toMatchObject({ code: "FORMAT" });

  await expect(relayMediaParametersForTask(
    relayTask("video", "media-generate", {
      parameters: {
        inputSchemaVersion: 1,
        inputs: [
          { assetId: "first.png", kind: "image", order: 1, role: "first-frame", sourceNodeId: "first" },
          { assetId: "second.png", kind: "image", order: 2, role: "first-frame", sourceNodeId: "second" },
        ],
      },
      providerModelId: "grok-imagine-video-1.5-preview",
    }),
    async ({ assetId }) => `https://signed.example.test/${assetId}?expires=300`,
  )).rejects.toMatchObject({ code: "FORMAT" });
});

test("the three registered relay media models enforce exact parameters and ordered references", async () => {
  let referenceFetches = 0;
  const mediaUrl = async ({ assetId }: { assetId: string }) => {
    referenceFetches += 1;
    return `https://signed.example.test/${assetId}?expires=300`;
  };

  await expect(relayMediaParametersForTask(
    relayTask("image", "media-generate", {
      providerModelId: "gemini-3-pro-image-preview",
      parameters: {
        aspectRatio: "21:9",
        inputSchemaVersion: 1,
        inputs: [
          { assetId: "later.png", kind: "image", order: 2, role: "reference-image", sourceNodeId: "later" },
          { assetId: "first.png", kind: "image", order: 1, role: "reference-image", sourceNodeId: "first" },
        ],
        outputCount: 1,
        quality: "4k",
      },
    }),
    mediaUrl,
  )).resolves.toEqual({
    aspectRatio: "21:9",
    imageSize: "4K",
    images: [
      "https://signed.example.test/first.png?expires=300",
      "https://signed.example.test/later.png?expires=300",
    ],
  });

  await expect(relayMediaParametersForTask(
    relayTask("video", "media-generate", {
      providerModelId: "kling-v3-omni-cankao",
      parameters: {
        aspectRatio: "9:16",
        duration: 15,
        inputSchemaVersion: 1,
        inputs: [{
          assetId: "reference.png",
          kind: "image",
          order: 1,
          role: "reference-image",
          sourceNodeId: "reference",
        }],
        outputCount: 1,
        videoMode: "quality",
      },
    }),
    mediaUrl,
  )).resolves.toEqual({
    aspect_ratio: "9:16",
    duration: "15",
    images: ["https://signed.example.test/reference.png?expires=300"],
    mode: "pro",
  });

  await expect(relayMediaParametersForTask(
    relayTask("audio", "media-generate", {
      prompt: "cinematic instrumental",
      providerModelId: "suno-v4.5",
      parameters: {
        bitrate: 256_000,
        inputSchemaVersion: 1,
        inputs: [],
        lyrics: "",
        musicGenerationMode: "instrumental",
        outputCount: 1,
        sampleRate: 48_000,
        vocalGender: "auto",
      },
    }),
    mediaUrl,
  )).resolves.toEqual({
    bitrate: 256_000,
    make_instrumental: "instrumental",
    mv: "chirp-v4-5",
    sample_rate: 48_000,
    vocal_gender: "auto",
  });

  const fetchesBeforeRejectedInputs = referenceFetches;
  await expect(relayMediaParametersForTask(
    relayTask("video", "media-generate", {
      providerModelId: "kling-v3-omni-cankao",
      parameters: {
        aspectRatio: "16:9",
        duration: 5,
        inputs: [{
          assetId: "blocked.mp3",
          kind: "audio",
          order: 1,
          role: "reference-image",
          sourceNodeId: "blocked",
        }],
        outputCount: 1,
        videoMode: "standard",
      },
    }),
    mediaUrl,
  )).rejects.toMatchObject({ code: "FORMAT" });
  await expect(relayMediaParametersForTask(
    relayTask("audio", "media-generate", {
      prompt: "",
      providerModelId: "suno-v4.5",
      parameters: {
        bitrate: 192_000,
        inputs: [],
        lyrics: "",
        musicGenerationMode: "lyrics-song",
        outputCount: 1,
        sampleRate: 44_100,
        vocalGender: "female",
      },
    }),
    mediaUrl,
  )).rejects.toMatchObject({ code: "FORMAT" });
  await expect(relayMediaParametersForTask(
    relayTask("audio", "media-generate", {
      providerModelId: "suno-v4.5",
      parameters: {
        bitrate: 192_000,
        inputs: [{
          assetId: "blocked.png",
          kind: "image",
          order: 1,
          role: "reference-image",
          sourceNodeId: "blocked",
        }],
        lyrics: "",
        musicGenerationMode: "instrumental",
        outputCount: 1,
        sampleRate: 44_100,
        vocalGender: "auto",
      },
    }),
    mediaUrl,
  )).rejects.toMatchObject({ code: "FORMAT" });
  expect(referenceFetches).toBe(fetchesBeforeRejectedInputs);
});

test("registered relay model schemas and paid-attempt polling windows are frozen", () => {
  const fixtures = [
    ["image", "gemini-3-pro-image-preview", 14, 10],
    ["video", "kling-v3-omni-cankao", 7, 75],
    ["audio", "suno-v4.5", 0, 15],
  ] as const;
  for (const [capability, providerModelId, imageLimit, deadlineMinutes] of fixtures) {
    const contract = relayMediaModelContract(providerModelId)!;
    expect(contract.capability).toBe(capability);
    expect(contract.pollPolicy).toEqual({
      deadlineMs: deadlineMinutes * 60_000,
      initialMs: 5_000,
      maximumMs: 10_000,
    });
    const constraints = providerParameterSchema({
      capability,
      providerDriver: "multi-protocol-relay",
      providerModelId,
    });
    expect(constraints?.referenceInputs.image ?? 0).toBe(imageLimit);
  }

  const kling = relayMediaModelContract("kling-v3-omni-cankao")!;
  const createdAt = "2026-08-21T00:00:00.000Z";
  expect(relayMediaPollingDecision({
    attemptCreatedAt: createdAt,
    nowMs: Date.parse(createdAt) + 74 * 60_000,
    pollCount: 20,
    policy: kling.pollPolicy,
  })).toMatchObject({ delayMs: 10_000, expired: false });
  expect(relayMediaPollingDecision({
    attemptCreatedAt: createdAt,
    nowMs: Date.parse(createdAt) + 75 * 60_000,
    pollCount: 21,
    policy: kling.pollPolicy,
  })).toMatchObject({ expired: true });
  expect(relayMediaModelContract("unregistered-relay-model")).toBeUndefined();
  expect(relayMediaSubmissionAction("durable-provider-task-id")).toBe("poll-existing");
  expect(relayMediaSubmissionAction(undefined)).toBe("submit-once");
});

test("Doubao TTS relay audio maps documented UI fields without forwarding snapshots", async () => {
  const task = relayTask("audio", "media-generate", {
    providerModelId: "doubao-tts-2.0",
    parameters: {
      emotion: "happy",
      emotionScale: 4,
      format: "mp3",
      inputSchemaVersion: 1,
      inputs: [],
      outputCount: 1,
      speaker: "zh_female_vv_uranus_bigtts",
      speechRate: "0",
    },
  });
  const before = JSON.stringify(task.parameters);
  const materialized = await relayMediaParametersForTask(
    task,
    async () => "https://signed.example.test/unused",
  );

  expect(materialized).toEqual({
    emotion: "happy",
    emotion_scale: 4,
    format: "mp3",
    speaker: "zh_female_vv_uranus_bigtts",
    speech_rate: "0",
  });
  expect(JSON.stringify(task.parameters)).toBe(before);
  expect(before).not.toContain("signed.example.test");
});

test("Doubao TTS execution drops stale emotion scale while automatic emotion is active", async () => {
  const task = relayTask("audio", "media-generate", {
    providerModelId: "doubao-tts-2.0",
    parameters: {
      emotion: "auto",
      emotionScale: 5,
      format: "ogg_opus",
      inputSchemaVersion: 1,
      inputs: [],
      outputCount: 1,
      speaker: "zh_female_vv_uranus_bigtts",
      speechRate: "0",
    },
  });

  await expect(relayMediaParametersForTask(
    task,
    async () => "https://signed.example.test/unused",
  )).resolves.toEqual({
    emotion: "auto",
    format: "ogg_opus",
    speaker: "zh_female_vv_uranus_bigtts",
    speech_rate: "0",
  });
});

test("GPT Image maps documented Youchuang size tiers and blocks missing combos", () => {
  const youchuangSizes = {
    "1k": {
      "1:1": "1024x1024",
      "2:3": "1024x1536",
      "3:2": "1536x1024",
      "3:4": "960x1280",
      "4:3": "1280x960",
      "9:16": "1088x1920",
      "16:9": "1920x1088",
      "4:5": "1024x1280",
      "5:4": "1280x1024",
      "1:2": "960x1920",
      "2:1": "1920x960",
    },
    "2k": {
      "1:1": "2048x2048",
      "2:3": "2048x3072",
      "3:2": "3072x2048",
      "3:4": "1920x2560",
      "4:3": "2560x1920",
      "9:16": "1440x2560",
      "16:9": "2560x1440",
      "4:5": "2048x2560",
      "5:4": "2560x2048",
      "1:2": "1280x2560",
      "2:1": "2560x1280",
    },
    "4k": {
      "1:1": "2880x2880",
      "2:3": "2304x3456",
      "3:2": "3456x2304",
      "3:4": "2400x3200",
      "4:3": "3200x2400",
      "9:16": "2160x3840",
      "16:9": "3840x2160",
      "4:5": "2560x3200",
      "5:4": "3200x2560",
      "1:2": "1920x3840",
      "2:1": "3840x1920",
    },
  } as const;
  expect(gptImageSizeForAspectRatio("auto")).toBe("auto");
  expect(gptImageSizeForAspectRatio("auto", "4k")).toBe("auto");
  for (const tier of ["1k", "2k", "4k"] as const) {
    for (const [ratio, size] of Object.entries(youchuangSizes[tier])) {
      expect(gptImageSizeForAspectRatio(ratio, tier)).toBe(size);
    }
  }
  // 文档没有的组合必须拦截：21:9 各档都没有，未知比例也一样。
  expect(() => gptImageSizeForAspectRatio("21:9", "1k"))
    .toThrow(RelayProviderError);
  expect(() => gptImageSizeForAspectRatio("21:9", "4k")).toThrow();
  expect(() => gptImageSizeForAspectRatio("7:5", "1k")).toThrow();
});

test("tt-image-2 compiles the durable media request without leaking UI fields", async () => {
  const schema = providerParameterSchema({
    capability: "image",
    providerDriver: "multi-protocol-relay",
    providerModelId: "tt-image-2",
  });
  expect(schema?.fields.map(({ key }) => key)).toEqual([
    "inputMode",
    "aspectRatio",
    "quality",
    "outputCount",
  ]);
  const task = relayTask("image", "media-generate", {
    providerModelId: "tt-image-2",
    parameters: {
      aspectRatio: "9:16",
      inputMode: "image",
      inputSchemaVersion: 1,
      inputs: [{
        assetId: "tt-image-reference",
        kind: "image",
        order: 1,
        role: "reference-image",
        sourceNodeId: "tt-image-source",
      }],
      outputCount: 1,
      quality: "2k",
    },
  });
  const before = JSON.stringify(task.parameters);
  await expect(relayMediaParametersForTask(
    task,
    async () => "https://signed.example.test/reference.png",
  )).resolves.toEqual({
    images: ["https://signed.example.test/reference.png"],
    n: 1,
    quality: "auto",
    size: "1440x2560",
  });
  expect(JSON.stringify(task.parameters)).toBe(before);
  expect(relayMediaModelContract("tt-image-2")).toMatchObject({
    capability: "image",
    modelId: "tt-image-2",
    referencePolicy: { maximumCount: 1 },
    resultKind: "image",
  });
});

test("gpt-image size lookup honors the admin map, then the built-in table", () => {
  const adminMap = { "4k": { "9:16": "1792x1024" } };
  expect(gptImageSizeForAspectRatio("9:16", "4k", adminMap))
    .toBe("1792x1024");
  expect(gptImageSizeForAspectRatio("16:9", "4k", adminMap))
    .toBe("3840x2160");
  expect(gptImageSizeForAspectRatio(
    "auto",
    "4k",
    { "4k": { auto: "1024x1024" } },
  )).toBe("1024x1024");
  // 管理员没填的组合仍然按文档内置表/拦截，不乱发。
  expect(() => gptImageSizeForAspectRatio("21:9", "4k", adminMap)).toThrow();
  expect(() => gptImageSizeForAspectRatio(
    "7:5",
    "1k",
    { "1k": { "9:16": "1088x1920" } },
  )).toThrow();
});

test("gpt-image tasks snapshot the admin size map for later retries", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "unboundry-gpt-size-map-snapshot-"),
  );
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "gpt-size-map-snapshot",
      costCurrency: "USD",
      estimatedCostMicrounits: 1_000_000,
      idempotencyKey: "gpt-size-map-snapshot-request",
      kind: "image",
      model: "gpt-image-2",
      modelConfiguration: {
        modelId: "gpt-image-2",
        parameterSchema: {
          sizeMap: { "4k": { "9:16": "1792x1024" } },
        },
        providerModelId: "gpt-image-2",
        providerProfileId: relayProfile.id,
        providerProtocol: "gpt-image",
      },
      nodeId: "image-node",
      ownerId: "__test__",
      parameters: {
        aspectRatio: "9:16",
        inputSchemaVersion: 1,
        inputs: [],
        quality: "4k",
      },
      prompt: "尺寸映射快照测试",
      providerModelId: "gpt-image-2",
      providerProfileId: relayProfile.id,
    });
    store.close();

    const reopened = createGenerationTaskStore(directory);
    expect(reopened.get(created.task.id)).toMatchObject({
      modelConfiguration: {
        modelId: "gpt-image-2",
        parameterSchema: {
          sizeMap: { "4k": { "9:16": "1792x1024" } },
        },
        providerProtocol: "gpt-image",
      },
      parameters: {
        aspectRatio: "9:16",
        quality: "4k",
      },
    });
    reopened.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a cancelled relay publication removes its local media and history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-cleanup-"));
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  const assetId = "fixture-unpublished.png";
  const storageName = assetId;
  try {
    const store = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    store.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
    `).run(
      "__test__",
      "relay-cleanup-test",
      "Relay cleanup test",
      "fixture-password-hash",
      timestamp,
      timestamp,
    );
    store.close();
    await mkdir(join(directory, "media"), { recursive: true });
    await writeFile(join(directory, "media", storageName), "fixture");
    registerMediaForOwner("__test__", {
      byteSize: 7,
      checksumSha256: "0".repeat(64),
      contentType: "image/png",
      id: assetId,
      kind: "image",
      storageName,
    });
    const history = openAppDatabase(directory);
    history.prepare(`
      INSERT INTO asset_history (
        account_id, id, kind, label, preview, created_at, owner_id
      ) VALUES (?, ?, 'image', ?, ?, ?, ?)
    `).run(
      "__test__",
      assetId,
      "fixture",
      `/api/assets/${assetId}`,
      new Date().toISOString(),
      "__test__",
    );
    history.close();

    await expect(removeUnpublishedGeneratedMedia({
      assetId,
      kind: "image",
      ownerId: "__test__",
    })).resolves.toBe(true);
    await expect(readFile(join(directory, "media", storageName))).rejects.toThrow();
    const checked = openAppDatabase(directory);
    expect((checked.prepare(`
      SELECT COUNT(*) AS count FROM media_assets WHERE id = ?
    `).get(assetId) as { count: number }).count).toBe(0);
    expect((checked.prepare(`
      SELECT COUNT(*) AS count FROM asset_history WHERE id = ?
    `).get(assetId) as { count: number }).count).toBe(0);
    checked.close();
  } finally {
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    await rm(directory, { force: true, recursive: true });
  }
});

test("relay media image video and audio share local-only cancel and resumable task-id rules", async () => {
  for (const kind of ["image", "video", "audio"] as const) {
    const task = relayTask(kind, "media-generate", {
      errorCode: "TIMEOUT",
      providerTaskId: `remote:${kind}:001`,
      state: "failed",
    });
    expect(generationTaskCancellationMode({ ...task, state: "running" }))
      .toBe("cancel-relay-media-local");
  }
  expect(generationTaskCancellationMode(relayTask("image", "gpt-image", {
    providerTaskId: "historical-gpt-image-task",
    state: "running",
  }))).toBe("cancel-relay-media-local");
  expect(generationTaskCancellationMode(relayTask("image", "gpt-image", {
    providerTaskId: undefined,
    state: "running",
  }))).toBe("cancel-before-provider");

  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-image-retry-"));
  let store: ReturnType<typeof createGenerationTaskStore> | undefined;
  try {
    store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "relay-runtime-canvas",
      idempotencyKey: "relay-image-preserve-id-001",
      kind: "image",
      modelConfiguration: { providerProtocol: "media-generate" },
      nodeId: "relay-image-node",
      ownerId: "__test__",
      prompt: "image",
      providerModelId: "relay-image-model",
      providerProfileId: relayProfile.id,
    });
    store.transition(created.task.id, "running");
    store.recordProviderAttempt(created.task.id);
    store.setProviderTaskId(created.task.id, "remote:image:001");
    store.transition(created.task.id, "failed", { code: "TIMEOUT", message: "timeout" });
    store.transition(
      created.task.id,
      "retrying",
      undefined,
      { preserveProviderTaskId: true },
    );
    expect(store.get(created.task.id)).toMatchObject({
      providerProfileId: relayProfile.id,
      providerTaskId: "remote:image:001",
    });
    expect(store.getProviderAttemptForTask(created.task.id)).toMatchObject({
      providerProfileId: relayProfile.id,
      providerTaskId: "remote:image:001",
    });
    const createTask = (
      suffix: string,
      providerProfileId: string,
      fixtureScopeId = "scope-a",
    ) => store!.create({
      canvasId: `relay-profile-canvas-${suffix}`,
      idempotencyKey: `relay-profile-isolation-${suffix}`,
      kind: "image" as const,
      modelConfiguration: { fixtureScopeId, providerProtocol: "media-generate" },
      nodeId: `relay-profile-node-${suffix}`,
      ownerId: "__test__",
      prompt: suffix,
      providerModelId: "shared-provider-model",
      providerProfileId,
    }).task;
    const sameProfile = createTask("same", "provider-alpha");
    store.transition(sameProfile.id, "running");
    store.recordProviderAttempt(sameProfile.id);
    store.setProviderTaskId(sameProfile.id, "remote-same-profile");
    const otherProfile = createTask("other", "provider-beta");
    store.transition(otherProfile.id, "running");
    store.recordProviderAttempt(otherProfile.id);
    store.setProviderTaskId(otherProfile.id, "remote-other-profile");
    const otherFixture = createTask("other-fixture", "provider-alpha", "scope-b");
    store.transition(otherFixture.id, "running");
    store.recordProviderAttempt(otherFixture.id);
    store.setProviderTaskId(otherFixture.id, "remote-other-fixture");
    const target = createTask("target", "provider-alpha");

    expect(store.listOwnerRelayMatchContext({
      excludeTaskId: target.id,
      fixtureScopeId: "scope-a",
      kind: "image",
      ownerId: "__test__",
      providerModelId: "shared-provider-model",
      providerProfileId: "provider-alpha",
    })).toMatchObject({
      competitors: [{ id: sameProfile.id }],
      occupiedTaskIds: ["remote-same-profile"],
    });
    expect(store.listOwnerRelayMatchContext({
      excludeTaskId: target.id,
      fixtureScopeId: "scope-a",
      kind: "image",
      ownerId: "__test__",
      providerModelId: "shared-provider-model",
      providerProfileId: "provider-alpha",
    }).competitors.map(({ id }) => id)).not.toContain(otherFixture.id);
    expect(store.listOwnerRelayMatchContext({
      excludeTaskId: target.id,
      fixtureScopeId: "scope-a",
      kind: "image",
      ownerId: "__test__",
      providerModelId: "shared-provider-model",
      providerProfileId: "provider-alpha",
    }).occupiedTaskIds).not.toContain("remote-other-fixture");

    const database = openAppDatabase(directory);
    database.prepare(`
      UPDATE generation_provider_attempts
      SET provider_profile_id = 'provider-beta'
      WHERE task_id = ?
    `).run(sameProfile.id);
    database.close();
    expect(store.getProviderAttemptForTask(sameProfile.id)).toBeUndefined();
    store.close();
    store = createGenerationTaskStore(directory);
    expect(() => store!.resume(sameProfile.id)).toThrow(
      "Provider task recovery requires exact accepted Provider evidence",
    );
  } finally {
    store?.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("a lost relay response remains outcome-unknown across reopen and blocks paid retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-unknown-outcome-"));
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  let store: ReturnType<typeof createGenerationTaskStore> | undefined;
  try {
    store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "relay-unknown-outcome-canvas",
      idempotencyKey: "relay-unknown-outcome-0001",
      kind: "text",
      modelConfiguration: {
        providerConfigurationVersion: 1,
        providerDriver: "multi-protocol-relay",
        providerProtocol: "openai-chat",
      },
      nodeId: "relay-unknown-outcome-node",
      ownerId: "__test__",
      parameters: { inputSchemaVersion: 1, inputs: [] },
      prompt: "the remote may have received this exact request",
      providerModelId: "relay-text-model",
      providerProfileId: relayProfile.id,
    });
    let providerSubmits = 0;
    await executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: async () => ({
        profile: relayProfile,
        release() {},
      }),
      fetcher: async () => {
        providerSubmits += 1;
        throw new TypeError("synthetic response lost after request acceptance");
      },
      mediaUrlForOwner: async () => "unused",
      store,
    });

    expect(providerSubmits).toBe(1);
    expect(store.get(created.task.id)).toMatchObject({
      errorCode: "AUTOMATIC_RESULT_RECOVERY",
      providerTaskId: undefined,
      state: "recovering",
    });
    expect(store.getProviderAttemptForTask(created.task.id)).toMatchObject({
      executionAttempt: 1,
      failureCode: "OUTCOME_UNKNOWN_BILLING_RISK",
      outcome: "outcome-unknown",
    });

    store.close();
    store = undefined;
    const reopened = createGenerationTaskStore(directory);
    const failed = reopened.get(created.task.id);
    expect(failed).toMatchObject({
      errorCode: "AUTOMATIC_RESULT_RECOVERY",
      providerTaskId: undefined,
      state: "recovering",
    });
    const reopenedAttempt = reopened.getProviderAttemptForTask(created.task.id);
    expect(reopenedAttempt).toMatchObject({
      executionAttempt: 1,
      failureCode: "OUTCOME_UNKNOWN_BILLING_RISK",
      outcome: "outcome-unknown",
    });
    const unsafePaidRetry = reopened.hasUnsafeProviderAttemptForNewPaidRetry(
      created.task.id,
    );
    reopened.close();
    expect(failed).toBeTruthy();

    const countsBeforeDecision = openAppDatabase(directory);
    const before = {
      events: Number((countsBeforeDecision.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events
      `).get() as { count: number }).count),
      history: Number((countsBeforeDecision.prepare(`
        SELECT COUNT(*) AS count FROM asset_history
      `).get() as { count: number }).count),
      media: Number((countsBeforeDecision.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
      `).get() as { count: number }).count),
      tasks: Number((countsBeforeDecision.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
      `).get() as { count: number }).count),
    };
    countsBeforeDecision.close();

    expect(retrySafetyDecision(failed!, reopenedAttempt, unsafePaidRetry))
      .toMatchObject({
        allowed: false,
        code: "TASK_NOT_FAILED",
      });

    const countsAfterDecision = openAppDatabase(directory);
    try {
      expect({
        events: Number((countsAfterDecision.prepare(`
          SELECT COUNT(*) AS count FROM generation_task_events
        `).get() as { count: number }).count),
        history: Number((countsAfterDecision.prepare(`
          SELECT COUNT(*) AS count FROM asset_history
        `).get() as { count: number }).count),
        media: Number((countsAfterDecision.prepare(`
          SELECT COUNT(*) AS count FROM media_assets
        `).get() as { count: number }).count),
        tasks: Number((countsAfterDecision.prepare(`
          SELECT COUNT(*) AS count FROM generation_tasks
        `).get() as { count: number }).count),
      }).toEqual(before);
      expect(generationProviderAttemptCounts(countsAfterDecision)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 1,
      });
    } finally {
      countsAfterDecision.close();
    }
    expect(providerSubmits).toBe(1);
  } finally {
    store?.close();
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    await rm(directory, { force: true, recursive: true });
  }
});

test("charged relay terminal evidence stays outside legacy retry safety without another Provider attempt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-charged-terminal-"));
  const store = createGenerationTaskStore(directory);
  try {
    const created = store.create({
      canvasId: "relay-charged-terminal-canvas",
      idempotencyKey: "relay-charged-terminal-0001",
      kind: "text",
      modelConfiguration: {
        providerConfigurationVersion: 1,
        providerDriver: "multi-protocol-relay",
        providerProtocol: "openai-chat",
      },
      nodeId: "relay-charged-terminal-node",
      ownerId: "__test__",
      parameters: { inputSchemaVersion: 1, inputs: [] },
      prompt: "the Provider confirmed a charged failure",
      providerModelId: "relay-text-model",
      providerProfileId: relayProfile.id,
    }).task;
    store.transition(created.id, "running");
    store.recordProviderAttempt(created.id);
    store.setProviderTaskId(created.id, "relay-charged-terminal-provider-0001");
    const beforeSettlement = store.get(created.id)!;
    const receipt = {
      canvasId: beforeSettlement.canvasId,
      evidenceSha256: "d".repeat(64),
      executionAttempt: beforeSettlement.attempt,
      expectedUpdatedAt: beforeSettlement.updatedAt,
      feeDisposition: "charged" as const,
      kind: beforeSettlement.kind,
      nodeId: beforeSettlement.nodeId,
      ownerId: beforeSettlement.ownerId!,
      protocolContractId: "fixture-relay-contract-v3",
      providerModelId: beforeSettlement.providerModelId!,
      providerProfileId: beforeSettlement.providerProfileId!,
      providerTaskId: "relay-charged-terminal-provider-0001",
      taskId: beforeSettlement.id,
      terminalState: "failed" as const,
    };
    expect(store.settleConfirmedChargedProviderFailure(receipt)).toMatchObject({
      changed: true,
      task: {
        errorCode: "PROVIDER_FAILED_CHARGE_SETTLED",
        state: "failed",
      },
    });
    const settled = store.get(created.id)!;
    const attempt = store.getProviderAttemptForTask(created.id)!;
    expect(retrySafetyDecision(
      settled,
      attempt,
      store.hasUnsafeProviderAttemptForNewPaidRetry(created.id),
    )).toMatchObject({
      allowed: false,
      code: "PROVIDER_TERMINAL",
    });
    const database = openAppDatabase(directory);
    try {
      expect(generationProviderAttemptCounts(database)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 1,
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events
        WHERE task_id = ? AND error_code = 'PROVIDER_FAILURE_CHARGE_SETTLED'
      `).get(created.id)).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  } finally {
    store.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("runtime refund compensation creates one child and never loops on the child", async () => {
  const testRoot = process.env.UNBOUNDRY_TEST_ROOT;
  expect(testRoot).toBeTruthy();
  const dataDirectory = await mkdtemp(join(testRoot!, "m57-auto-refund-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const previousFetcherFlag = process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER;
  const previousSweepFlag = process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP;
  const nativeFetch = globalThis.fetch;
  const ownerId = "__test__";
  const canvasId = "m57-auto-refund-canvas";
  const nodeId = "m57-auto-refund-video-node";
  const modelId = "m57-auto-refund-grok-model";
  const providerModelId = "grok-imagine-video-1.5-preview";
  const sourceAssetId = "m57-auto-refund-source";
  let database: DatabaseSync | undefined;
  let store: ReturnType<typeof createGenerationTaskStore> | undefined;
  let fakeServer: ReturnType<typeof createServer> | undefined;
  let postCount = 0;
  let pollCount = 0;
  const requests: string[] = [];

  try {
    process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
    process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = "1";
    process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP = "1";
    resetGenerationTaskStoreForRuntimeTest();

    // Establish the empty safe database before saving the encrypted Provider
    // profile. The profile is a local fixture only; no real Provider is used.
    openAppDatabase(dataDirectory).close();
    const profile = await saveProviderProfile({
      apiKey: "m57-runtime-profile-key-001",
      baseUrl: "https://m57-relay.test/v1",
      driver: "multi-protocol-relay",
      label: "m57 local relay fixture",
    });
    const timestamp = new Date().toISOString();
    database = openAppDatabase(dataDirectory);
    database.prepare(`
      INSERT OR IGNORE INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'safe-fixture', 'admin', 'active', ?, ?)
    `).run(ownerId, ownerId, "m57 local fixture", timestamp, timestamp);
    database.prepare(`
      UPDATE provider_profiles
      SET status = 'enabled', key_status = 'valid', key_checked_at = ?,
        updated_at = ?
      WHERE id = ? AND driver = 'multi-protocol-relay'
    `).run(timestamp, timestamp, profile.id);

    const parameterSchema = providerParameterSchema({
      capability: "video",
      providerDriver: "multi-protocol-relay",
      providerModelId,
    });
    if (!parameterSchema) throw new Error("m57 relay parameter schema is missing");
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency, provider_protocol
      ) VALUES (?, ?, ?, ?, 'video', 'published', ?, ?, ?, 5000000, 'USD', 'media-generate')
    `).run(
      modelId,
      "m57 Grok Imagine refund fixture",
      profile.id,
      providerModelId,
      JSON.stringify(parameterSchema),
      timestamp,
      timestamp,
    );
    database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      ) VALUES ('video', ?, 1, 0, 999, ?, ?)
    `).run(modelId, timestamp, timestamp);
    database.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 1, emergency_stop = 0,
        per_user_concurrency = 10, requests_per_minute = 120,
        image_concurrency = 5, video_concurrency = 5, audio_concurrency = 5,
        text_concurrency = 5, updated_at = ?
      WHERE id = 1
    `).run(timestamp);
    bootstrapPublishedModelContracts(database, ownerId);
    const credential = await saveAccountCredential(
      database,
      ownerId,
      profile.id,
      "m57-runtime-account-key-001",
    );
    database.prepare(`
      UPDATE account_provider_credentials
      SET key_status = 'valid', key_checked_at = ?, updated_at = ?
      WHERE account_id = ? AND provider_profile_id = ?
    `).run(timestamp, timestamp, ownerId, profile.id);

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DAAAAEAQEARwbK3gAAAABJRU5ErkJggg==",
      "base64",
    );
    await mkdir(join(dataDirectory, "media"), { recursive: true });
    const storageName = `${sourceAssetId}.png`;
    await writeFile(join(dataDirectory, "media", storageName), png);
    registerMediaForOwner(ownerId, {
      byteSize: png.byteLength,
      checksumSha256: createHash("sha256").update(png).digest("hex"),
      contentType: "image/png",
      id: sourceAssetId,
      kind: "image",
      mediaHeight: 1,
      mediaWidth: 1,
      storageName,
      storageStatus: "ready",
    });

    const requestedParameters = {
      aspectRatio: "16:9",
      duration: 1,
      generateAudio: true,
      inputMode: "reference",
      outputCount: 1,
      resolution: "480p",
    };
    const prompt = "m57 local automatic refund compensation";
    const fixture = authoritativeRuntimeFixture({
      canvasId,
      credentialVersion: credential.credentialVersion,
      database,
      modelId,
      nodeId,
      parameters: requestedParameters,
      prompt,
      providerModelId,
      providerProfileId: profile.id,
    });
    const sourceNodeId = "m57-auto-refund-source-node";
    const initialNodes = [{
      data: {
        assetId: sourceAssetId,
        imageSrc: `/api/assets/${sourceAssetId}`,
        title: "M57 automatic refund source image",
      },
      id: sourceNodeId,
      position: { x: 0, y: 0 },
      type: "image",
    }, {
      data: {
        title: "M57 auto refund video target",
        videoModelConfigurationRevision:
          fixture.modelConfiguration.modelConfigurationRevision,
        videoModelId: modelId,
        videoParameters: requestedParameters,
        videoPrompt: prompt,
        videoPromptReady: true,
      },
      id: nodeId,
      position: { x: 400, y: 0 },
      type: "video",
    }];
    const initialEdges = [{
      data: { inputOrder: 1, inputRole: "first-frame" },
      id: "m57-auto-refund-first-frame-edge",
      source: sourceNodeId,
      sourceHandle: "source",
      target: nodeId,
      targetHandle: "target",
    }];
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, NULL, 0)
    `).run(
      ownerId,
      canvasId,
      JSON.stringify(initialNodes),
      JSON.stringify(initialEdges),
      JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      timestamp,
    );
    const resolved = resolvePersistedNodeInputs({
      bypass: false,
      canvasId,
      database,
      modelReleaseRevision:
        fixture.modelConfiguration.modelReleaseRevision.revisionId,
      modelSchema: fixture.modelConfiguration.parameterSchema,
      ownerId,
      parameters: requestedParameters,
      targetId: nodeId,
      targetKind: "video",
    });
    expect(resolved.canSubmit).toBe(true);
    const contractFingerprint = resolved.contractFingerprint;
    if (!contractFingerprint) {
      throw new Error("m57 runtime fixture contract fingerprint is missing");
    }
    const normalizedParameters = {
      ...(resolved.normalizedParameters ?? requestedParameters),
    };
    const inputFingerprint = generationInputKey({
      inputs: resolved.inputs,
      modelConfigurationRevision:
        fixture.modelConfiguration.modelConfigurationRevision,
      modelId,
      modelReleaseRevision:
        fixture.modelConfiguration.modelReleaseRevision.revisionId,
      ownPrompt: resolved.persistedOwnPrompt,
      parameters: normalizedParameters,
      prompt: resolved.finalPrompt,
    });
    const ownershipKey = generationOwnershipKey(generationOwnershipEvidence({
      contractFingerprint,
      inputs: resolved.inputs,
      kind: "video",
      modelConfigurationRevision:
        fixture.modelConfiguration.modelConfigurationRevision,
      modelId,
      modelReleaseRevision:
        fixture.modelConfiguration.modelReleaseRevision.revisionId,
      parameters: normalizedParameters,
      prompt: resolved.persistedOwnPrompt,
    }));
    const modelConfiguration = buildAuthoritativeGenerationModelConfiguration({
      ...fixture.modelConfiguration,
      generationInputKey: inputFingerprint,
      generationOwnershipKey: ownershipKey,
      modelInputContractFingerprint: contractFingerprint,
    });
    const parameters = {
      ...normalizedParameters,
      inputSchemaVersion: 1,
      inputs: resolved.snapshot,
    };
    const requestIntent = {
      ...fixture.requestIntent,
      generationInputKey: inputFingerprint,
      generationOwnershipKey: ownershipKey,
      inputSchemaVersion: 1,
      inputs: resolved.snapshot,
      modelInputContractFingerprint: contractFingerprint,
      parameters: normalizedParameters,
      prompt: resolved.finalPrompt,
    };

    store = createGenerationTaskStore(dataDirectory, { recoverRunning: false });
    const admitted = store.admitAuthoritativeOrGet({
      canvasId,
      expectedCanvasRevision: 1,
      costCurrency: "USD",
      credentialRevision: credential.credentialVersion,
      estimatedCostMicrounits: 5_000_000,
      idempotencyKey: "m57-auto-refund-parent-001",
      kind: "video",
      model: modelId,
      modelConfiguration,
      nodeId,
      ownerId,
      parameters,
      prompt: resolved.finalPrompt,
      providerModelId,
      providerProfileId: profile.id,
      requestIntent,
    });
    expect(admitted.created).toBe(true);
    const parent = admitted.task;
    database.prepare(`
      UPDATE canvas_documents
      SET nodes = ?, updated_at = ?
      WHERE owner_id = ? AND id = ?
    `).run(
      JSON.stringify(initialNodes.map((node) => node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              videoGenerationContractFingerprint: undefined,
              videoGenerationInputKey: inputFingerprint,
              videoGenerationModelConfigurationRevision:
                modelConfiguration.modelConfigurationRevision,
              videoGenerationModelInputContractFingerprint:
                contractFingerprint,
              videoGenerationModelReleaseRevision:
                modelConfiguration.modelReleaseRevision.revisionId,
              videoGenerationOwnershipKey: ownershipKey,
              videoGenerationTaskId: parent.id,
            },
          }
        : node)),
      new Date().toISOString(),
      ownerId,
      canvasId,
    );
    expect(store.retryBindingsForCanvas(canvasId, ownerId).get(parent.id))
      .toMatchObject({
        canvasRevision: 1,
        generationInputKey: inputFingerprint,
        generationOwnershipKey: ownershipKey,
        kind: "video",
        nodeId,
        taskId: parent.id,
      });
    store.transition(parent.id, "running");
    store.recordProviderAttempt(parent.id);
    store.setProviderTaskId(parent.id, "m57-parent-provider-0001");
    store.transition(parent.id, "failed", {
      code: "PROVIDER_REFUNDED",
      message: "safe fixture Provider response confirmed a refund",
    });
    expect(store.listRefundCompensationCandidates().map((task) => task.id))
      .toEqual([parent.id]);

    fakeServer = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://m57-relay.test");
      requests.push(`${request.method ?? ""} ${url.pathname}`);
      void (async () => {
        for await (const _chunk of request) { /* consume request body */ }
        response.setHeader("Content-Type", "application/json");
        if (request.method === "POST" && url.pathname === "/v1/media/generate") {
          postCount += 1;
          response.statusCode = 200;
          response.end(JSON.stringify({ task_id: "m57-child-provider-0001" }));
          return;
        }
        if (request.method === "GET" && url.pathname === "/v1/skills/task-status") {
          pollCount += 1;
          response.statusCode = 200;
          response.end(JSON.stringify({
            refunded: true,
            state: "failed",
            task_id: "m57-child-provider-0001",
          }));
          return;
        }
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "unexpected fixture route" }));
      })().catch(() => {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: "fixture handler failed" }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      fakeServer!.once("error", reject);
      fakeServer!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = fakeServer.address();
    if (!address || typeof address === "string") throw new Error("m57 fixture server address is missing");
    const port = address.port;
    globalThis.fetch = (async (input, init) => {
      const requested = new URL(String(input));
      if (requested.hostname !== "m57-relay.test") {
        throw new Error(`unexpected fixture destination: ${requested.hostname}`);
      }
      return nativeFetch(
        `http://127.0.0.1:${port}${requested.pathname}${requested.search}`,
        init,
      );
    }) as typeof fetch;

    await runGenerationRecoverySweep();
    let child: GenerationTask | undefined;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      child = store.list(canvasId).find((task) => task.id !== parent.id);
      if (child?.state === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(child).toBeDefined();
    expect(child).toMatchObject({
      attempt: 1,
      canvasId,
      errorCode: "PROVIDER_REFUNDED",
      kind: "video",
      model: modelId,
      nodeId,
      ownerId,
      parameters,
      prompt: resolved.finalPrompt,
      providerModelId,
      providerProfileId: profile.id,
      state: "failed",
    });
    expect(store.get(parent.id)).toMatchObject({
      attempt: 1,
      errorCode: "PROVIDER_REFUNDED",
      providerTaskId: "m57-parent-provider-0001",
      state: "failed",
    });
    const parentEventCodes = store.listEvents(parent.id).map((event) => event.errorCode);
    const childEventCodes = store.listEvents(child!.id).map((event) => event.errorCode);
    expect(parentEventCodes).toContain("USER_GENERATION_INTENT_OPENED_V3");
    expect(parentEventCodes).toContain("AUTO_REFUND_COMPENSATION_ADMITTED");
    expect(childEventCodes).toContain("AUTO_REFUND_COMPENSATION_CHILD");
    expect(childEventCodes).not.toContain("USER_GENERATION_INTENT_OPENED_V3");
    expect(store.listRefundCompensationCandidates()).toEqual([]);
    expect(postCount).toBe(1);
    expect(pollCount).toBeGreaterThanOrEqual(1);
    expect(requests).toContain("POST /v1/media/generate");
    expect(requests).toContain("GET /v1/skills/task-status");

    const taskCountAfterChild = store.list(canvasId).length;
    await runGenerationRecoverySweep();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.list(canvasId)).toHaveLength(taskCountAfterChild);
    expect(postCount).toBe(1);
    expect(store.get(child!.id)).toMatchObject({
      errorCode: "PROVIDER_REFUNDED",
      state: "failed",
    });
    expect(generationProviderAttemptCounts(database)).toEqual({
      historicalEstimatedProviderAttempts: 0,
      paidProviderRequests: 2,
    });
  } finally {
    globalThis.fetch = nativeFetch;
    if (fakeServer) {
      await new Promise<void>((resolve) => fakeServer!.close(() => resolve()));
    }
    resetGenerationTaskStoreForRuntimeTest();
    store?.close();
    database?.close();
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    if (previousFetcherFlag === undefined) delete process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER;
    else process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = previousFetcherFlag;
    if (previousSweepFlag === undefined) delete process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP;
    else process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP = previousSweepFlag;
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

for (const recoveryMode of ["result", "late-fee-conflict", "late-success-conflict"] as const) {
test(recoveryMode === "result"
  ? "runtime original-result recovery saves a known outcome-unknown video without a new Provider POST"
  : recoveryMode === "late-fee-conflict"
    ? "a late contradictory Provider response stays isolated without a second GET or settlement"
    : "a late successful Provider response preserves the failure settlement without downloading or resuming",
async () => {
  test.setTimeout(120_000);
  const testRoot = process.env.UNBOUNDRY_TEST_ROOT;
  expect(testRoot).toBeTruthy();
  const dataDirectory = await mkdtemp(join(testRoot!, "m57-original-result-recovery-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const previousFetcherFlag = process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER;
  const previousSweepFlag = process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP;
  const previousCasesFlag = process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED;
  const nativeFetch = globalThis.fetch;
  const ownerId = "__test__";
  const canvasId = "m57-original-result-recovery-canvas";
  const nodeId = "m57-original-result-recovery-video-node";
  const modelId = "m57-original-result-recovery-grok-model";
  const providerModelId = "grok-imagine-video-1.5-preview";
  const sourceAssetId = "m57-original-result-recovery-source";
  const providerTaskId = "m57-original-provider-0001";
  let database: DatabaseSync | undefined;
  let store: ReturnType<typeof createGenerationTaskStore> | undefined;
  let fakeServer: ReturnType<typeof createServer> | undefined;
  let statusReads = 0;
  let resultReads = 0;
  let postCount = 0;
  const requests: string[] = [];

  try {
    process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
    process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = "1";
    process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP = "1";
    process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED = "1";
    resetGenerationTaskStoreForRuntimeTest();

    // This is a local safe fixture. The recovery path below performs only a
    // status GET and a result GET against the loopback server.
    const resultVideo = await readFile(new URL(
      "../client/public/fixtures/video-success.mp4",
      import.meta.url,
    ));
    openAppDatabase(dataDirectory).close();
    const profile = await saveProviderProfile({
      apiKey: "m57-original-result-profile-key-001",
      baseUrl: "https://m57-original-result.test/v1",
      driver: "multi-protocol-relay",
      label: "m57 original result fixture",
    });
    const timestamp = new Date().toISOString();
    database = openAppDatabase(dataDirectory);
    database.prepare(`
      INSERT OR IGNORE INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'safe-fixture', 'admin', 'active', ?, ?)
    `).run(ownerId, ownerId, "m57 original result fixture", timestamp, timestamp);
    database.prepare(`
      UPDATE provider_profiles
      SET status = 'enabled', key_status = 'valid', key_checked_at = ?,
        updated_at = ?
      WHERE id = ? AND driver = 'multi-protocol-relay'
    `).run(timestamp, timestamp, profile.id);

    const parameterSchema = providerParameterSchema({
      capability: "video",
      providerDriver: "multi-protocol-relay",
      providerModelId,
    });
    if (!parameterSchema) throw new Error("m57 original result parameter schema is missing");
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency, provider_protocol
      ) VALUES (?, ?, ?, ?, 'video', 'published', ?, ?, ?, 5000000, 'USD', 'media-generate')
    `).run(
      modelId,
      "m57 Grok original result fixture",
      profile.id,
      providerModelId,
      JSON.stringify(parameterSchema),
      timestamp,
      timestamp,
    );
    database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      ) VALUES ('video', ?, 1, 0, 999, ?, ?)
    `).run(modelId, timestamp, timestamp);
    database.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 1, emergency_stop = 0,
        per_user_concurrency = 10, requests_per_minute = 120,
        image_concurrency = 5, video_concurrency = 5, audio_concurrency = 5,
        text_concurrency = 5, updated_at = ?
      WHERE id = 1
    `).run(timestamp);
    bootstrapPublishedModelContracts(database, ownerId);
    const credential = await saveAccountCredential(
      database,
      ownerId,
      profile.id,
      "m57-original-result-account-key-001",
    );
    database.prepare(`
      UPDATE account_provider_credentials
      SET key_status = 'valid', key_checked_at = ?, updated_at = ?
      WHERE account_id = ? AND provider_profile_id = ?
    `).run(timestamp, timestamp, ownerId, profile.id);

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DAAAAEAQEARwbK3gAAAABJRU5ErkJggg==",
      "base64",
    );
    await mkdir(join(dataDirectory, "media"), { recursive: true });
    const storageName = `${sourceAssetId}.png`;
    await writeFile(join(dataDirectory, "media", storageName), png);
    registerMediaForOwner(ownerId, {
      byteSize: png.byteLength,
      checksumSha256: createHash("sha256").update(png).digest("hex"),
      contentType: "image/png",
      id: sourceAssetId,
      kind: "image",
      mediaHeight: 1,
      mediaWidth: 1,
      storageName,
      storageStatus: "ready",
    });

    const requestedParameters = {
      aspectRatio: "16:9",
      duration: 1,
      generateAudio: true,
      inputMode: "reference",
      outputCount: 1,
      resolution: "480p",
    };
    const prompt = "m57 local original result recovery";
    const fixture = authoritativeRuntimeFixture({
      canvasId,
      credentialVersion: credential.credentialVersion,
      database,
      modelId,
      nodeId,
      parameters: requestedParameters,
      prompt,
      providerModelId,
      providerProfileId: profile.id,
    });
    const sourceNodeId = "m57-original-result-source-node";
    const initialNodes = [{
      data: {
        assetId: sourceAssetId,
        imageSrc: `/api/assets/${sourceAssetId}`,
        title: "M57 original result source image",
      },
      id: sourceNodeId,
      position: { x: 0, y: 0 },
      type: "image",
    }, {
      data: {
        title: "M57 original result video target",
        videoModelConfigurationRevision:
          fixture.modelConfiguration.modelConfigurationRevision,
        videoModelId: modelId,
        videoParameters: requestedParameters,
        videoPrompt: prompt,
        videoPromptReady: true,
      },
      id: nodeId,
      position: { x: 400, y: 0 },
      type: "video",
    }];
    const initialEdges = [{
      data: { inputOrder: 1, inputRole: "first-frame" },
      id: "m57-original-result-first-frame-edge",
      source: sourceNodeId,
      sourceHandle: "source",
      target: nodeId,
      targetHandle: "target",
    }];
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, NULL, 0)
    `).run(
      ownerId,
      canvasId,
      JSON.stringify(initialNodes),
      JSON.stringify(initialEdges),
      JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      timestamp,
    );
    const resolved = resolvePersistedNodeInputs({
      bypass: false,
      canvasId,
      database,
      modelReleaseRevision:
        fixture.modelConfiguration.modelReleaseRevision.revisionId,
      modelSchema: fixture.modelConfiguration.parameterSchema,
      ownerId,
      parameters: requestedParameters,
      targetId: nodeId,
      targetKind: "video",
    });
    expect(resolved.canSubmit).toBe(true);
    const contractFingerprint = resolved.contractFingerprint;
    if (!contractFingerprint) {
      throw new Error("m57 original result contract fingerprint is missing");
    }
    const normalizedParameters = {
      ...(resolved.normalizedParameters ?? requestedParameters),
    };
    const inputFingerprint = generationInputKey({
      inputs: resolved.inputs,
      modelConfigurationRevision:
        fixture.modelConfiguration.modelConfigurationRevision,
      modelId,
      modelReleaseRevision:
        fixture.modelConfiguration.modelReleaseRevision.revisionId,
      ownPrompt: resolved.persistedOwnPrompt,
      parameters: normalizedParameters,
      prompt: resolved.finalPrompt,
    });
    const ownershipKey = generationOwnershipKey(generationOwnershipEvidence({
      contractFingerprint,
      inputs: resolved.inputs,
      kind: "video",
      modelConfigurationRevision:
        fixture.modelConfiguration.modelConfigurationRevision,
      modelId,
      modelReleaseRevision:
        fixture.modelConfiguration.modelReleaseRevision.revisionId,
      parameters: normalizedParameters,
      prompt: resolved.persistedOwnPrompt,
    }));
    const modelConfiguration = buildAuthoritativeGenerationModelConfiguration({
      ...fixture.modelConfiguration,
      generationInputKey: inputFingerprint,
      generationOwnershipKey: ownershipKey,
      modelInputContractFingerprint: contractFingerprint,
    });
    const parameters = {
      ...normalizedParameters,
      inputSchemaVersion: 1,
      inputs: resolved.snapshot,
    };
    const requestIntent = {
      ...fixture.requestIntent,
      generationInputKey: inputFingerprint,
      generationOwnershipKey: ownershipKey,
      inputSchemaVersion: 1,
      inputs: resolved.snapshot,
      modelInputContractFingerprint: contractFingerprint,
      parameters: normalizedParameters,
      prompt: resolved.finalPrompt,
    };

    store = createGenerationTaskStore(dataDirectory, { recoverRunning: false });
    const admitted = store.admitAuthoritativeOrGet({
      canvasId,
      expectedCanvasRevision: 1,
      costCurrency: "USD",
      credentialRevision: credential.credentialVersion,
      estimatedCostMicrounits: 5_000_000,
      idempotencyKey: "m57-original-result-parent-001",
      kind: "video",
      model: modelId,
      modelConfiguration,
      nodeId,
      ownerId,
      parameters,
      prompt: resolved.finalPrompt,
      providerModelId,
      providerProfileId: profile.id,
      requestIntent,
    });
    expect(admitted.created).toBe(true);
    const parent = admitted.task;
    database.prepare(`
      UPDATE canvas_documents
      SET nodes = ?, updated_at = ?
      WHERE owner_id = ? AND id = ?
    `).run(
      JSON.stringify(initialNodes.map((node) => node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              videoGenerationContractFingerprint: undefined,
              videoGenerationInputKey: inputFingerprint,
              videoGenerationModelConfigurationRevision:
                modelConfiguration.modelConfigurationRevision,
              videoGenerationModelInputContractFingerprint:
                contractFingerprint,
              videoGenerationModelReleaseRevision:
                modelConfiguration.modelReleaseRevision.revisionId,
              videoGenerationOwnershipKey: ownershipKey,
              videoGenerationTaskId: parent.id,
            },
          }
        : node)),
      new Date().toISOString(),
      ownerId,
      canvasId,
    );
    expect(store.retryBindingsForCanvas(canvasId, ownerId).get(parent.id))
      .toMatchObject({
        canvasRevision: 1,
        generationInputKey: inputFingerprint,
        generationOwnershipKey: ownershipKey,
        kind: "video",
        nodeId,
        taskId: parent.id,
      });
    store.transition(parent.id, "running");
    store.recordProviderAttempt(parent.id);
    store.setProviderTaskId(parent.id, providerTaskId);
    // Model the real lost-response boundary explicitly: the accepted Provider
    // task is known, but the paid attempt remains outcome-unknown.
    database.prepare(`
      UPDATE generation_provider_attempts
      SET outcome = 'outcome-unknown', failure_code = 'OUTCOME_UNKNOWN_BILLING_RISK'
      WHERE task_id = ? AND execution_attempt = ? AND provider_task_id = ?
    `).run(parent.id, store.get(parent.id)!.attempt, providerTaskId);
    store.transition(parent.id, "failed", {
      code: "OPERATOR_INCIDENT",
      message: "safe fixture keeps the original Provider result unresolved",
    });
    expect(store.get(parent.id)).toMatchObject({
      errorCode: "OPERATOR_INCIDENT",
      providerTaskId,
      state: "failed",
    });
    expect(store.getProviderAttemptForTask(parent.id)).toMatchObject({
      executionAttempt: 1,
      outcome: "outcome-unknown",
      providerTaskId,
    });
    const attemptsBefore = generationProviderAttemptCounts(database);
    expect(attemptsBefore).toEqual({
      historicalEstimatedProviderAttempts: 0,
      paidProviderRequests: 1,
    });

    fakeServer = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://m57-original-result.test");
      requests.push(`${request.method ?? ""} ${url.pathname}`);
      void (async () => {
        for await (const _chunk of request) { /* consume request body */ }
        if (request.method === "GET" && url.pathname === "/v1/skills/task-status") {
          statusReads += 1;
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json");
          if (recoveryMode !== "result") {
            // A separate trusted terminal receipt wins while the original
            // GET is in flight. The GET then returns contradictory fee proof.
            const cases = createGenerationRecoveryCaseStore(database!);
            const item = cases.getByTaskAttempt(parent.id, 1, ownerId);
            const commands = createGenerationRecoveryOriginalCommands(database!, {
              enabled: true, readRelatedLedgers: readOriginalGenerationRecoveryLedgers,
            });
            const expected = commands.captureOriginalRecovery({
              taskId: parent.id, caseId: item.caseId, ownerId, executionAttempt: 1,
            });
            const evidence = issueAdapterVerifiedOriginalRecoveryEvidence({
              taskId: parent.id, ownerId, canvasId, nodeId, kind: "video",
              executionAttempt: 1, providerProfileId: profile.id, providerModelId,
              requestFingerprint: parent.requestFingerprint, providerTaskId,
              providerState: "failed", feeDisposition: "charged", observedAt: new Date().toISOString(),
            }, () => ({ adapterId: "m57-local-terminal-receipt",
              protocolContractId: "m57-local-terminal-v1", evidenceSha256: "a".repeat(64) }));
            const command = { taskId: parent.id, caseId: item.caseId, ownerId, executionAttempt: 1,
              expected, evidence, expectedTaskUpdatedAt: expected.task.updated_at,
              expectedTaskEventWatermark: expected.taskEventWatermark,
              expectedCaseEventId: expected.caseEventId, actorId: generationRecoverySystemActorId,
              operationId: "m57-concurrent-terminal-0001" };
            expect(commands.dryRunOriginalRecovery(command).allowed).toBe(true);
            expect(commands.applyOriginalRecovery(command).action).toBe("settle_charged_failure");
            if (recoveryMode === "late-fee-conflict") {
              response.end(JSON.stringify({ refunded: true, state: "failed", task_id: providerTaskId }));
              return;
            }
          }
          response.end(JSON.stringify({
            is_final: true,
            result_type: "video",
            result_url: "https://m57-original-result.test/result.mp4",
            state: "success",
            task_id: providerTaskId,
          }));
          return;
        }
        if (request.method === "GET" && url.pathname === "/result.mp4") {
          resultReads += 1;
          response.statusCode = 200;
          response.setHeader("Content-Length", String(resultVideo.byteLength));
          response.setHeader("Content-Type", "video/mp4");
          response.end(resultVideo);
          return;
        }
        if (request.method === "POST" && url.pathname === "/v1/media/generate") {
          postCount += 1;
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: "new Provider POST is forbidden in this fixture" }));
          return;
        }
        response.statusCode = 404;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "unexpected fixture route" }));
      })().catch(() => {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: "fixture handler failed" }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      fakeServer!.once("error", reject);
      fakeServer!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = fakeServer.address();
    if (!address || typeof address === "string") throw new Error("m57 original result fixture server address is missing");
    const port = address.port;
    globalThis.fetch = (async (input, init) => {
      const requested = new URL(String(input));
      if (requested.hostname !== "m57-original-result.test") {
        throw new Error(`unexpected fixture destination: ${requested.hostname}`);
      }
      return nativeFetch(
        `http://127.0.0.1:${port}${requested.pathname}${requested.search}`,
        init,
      );
    }) as typeof fetch;

    createGenerationRecoveryCaseStore(database).ensureCase({
      taskId: parent.id, ownerId, executionAttempt: 1,
      reason: "operator_incident", operationId: "m57-original-case-0001",
    });
    await inspectGenerationRecoveryCase(parent.id, generationRecoverySystemActorId,
      "m57-original-check-0001");

    const recovered = store.get(parent.id);
    if (recoveryMode !== "result") {
      expect(recovered).toMatchObject({ state: "failed", attempt: 1,
        errorCode: "PROVIDER_FAILED_CHARGE_SETTLED", providerTaskId });
      expect(store.getProviderAttemptForTask(parent.id)).toMatchObject({ outcome: "provider-failed", executionAttempt: 1 });
      expect(store.newGenerationDecision(parent.id).allowed).toBe(false);
      const eventCodes = store.listEvents(parent.id).map((event) => event.errorCode);
      expect(eventCodes.filter((code) => code === "RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1")).toHaveLength(1);
      expect(eventCodes.filter((code) => code === "PROVIDER_FAILURE_CHARGE_SETTLED")).toHaveLength(1);
      expect(eventCodes).not.toContain("PROVIDER_FAILURE_NO_CHARGE_SETTLED");
      expect(eventCodes).not.toContain("RECOVERY_ORIGINAL_ONLY_V1");
      const item = createGenerationRecoveryCaseStore(database).getByTaskAttempt(parent.id, 1, ownerId);
      expect(item).toMatchObject({ phase: "queued", reason: "provider_evidence_conflict" });
      const eventCount = store.listEvents(parent.id).length;
      await inspectGenerationRecoveryCase(parent.id, generationRecoverySystemActorId,
        "m57-conflict-follow-up-0001");
      expect(store.listEvents(parent.id)).toHaveLength(eventCount);
      expect(generationProviderAttemptCounts(database)).toEqual(attemptsBefore);
      expect({ statusReads, resultReads, postCount }).toEqual({ statusReads: 1, resultReads: 0, postCount: 0 });
      return;
    }
    expect(recovered, JSON.stringify({
      statusReads, resultReads, postCount,
      events: store.listEvents(parent.id).map((event) => event.errorCode),
    })).toMatchObject({
      attempt: 1,
      canvasId,
      kind: "video",
      nodeId,
      ownerId,
      providerModelId,
      providerProfileId: profile.id,
      providerTaskId,
      state: "success",
    });
    expect(recovered?.resultAssetId).toBeTruthy();
    expect(store.list(canvasId)).toHaveLength(1);
    expect(store.getProviderAttemptForTask(parent.id)).toMatchObject({
      executionAttempt: 1,
      outcome: "completed",
      providerTaskId,
    });
    expect(generationProviderAttemptCounts(database)).toEqual(attemptsBefore);
    expect(statusReads).toBe(1);
    expect(resultReads).toBe(1);
    expect(postCount).toBe(0);
    expect(requests).toContain("GET /v1/skills/task-status");
    expect(requests).toContain("GET /result.mp4");
    expect(requests.some((request) => request.startsWith("POST "))).toBe(false);

    const eventCodes = store.listEvents(parent.id).map((event) => event.errorCode);
    expect(eventCodes).toContain("OPERATOR_INCIDENT");
    expect(eventCodes).toContain("RECOVERY_ORIGINAL_ONLY_V1");
    expect(eventCodes).toContain("RECOVERY_ORIGINAL_EVIDENCE_V1");
    expect(eventCodes).toContain(undefined);

    const finalDatabase = openAppDatabase(dataDirectory);
    try {
      const projection = finalDatabase.prepare(`
        SELECT state FROM generation_canvas_projection_states
        WHERE task_id = ? AND owner_id = ? AND canvas_id = ?
      `).get(parent.id, ownerId, canvasId) as { state: string } | undefined;
      expect(projection).toEqual({ state: "applied" });
      const row = finalDatabase.prepare(`
        SELECT result_asset_id, state, provider_task_id, attempt
        FROM generation_tasks WHERE id = ?
      `).get(parent.id) as {
        attempt: number;
        provider_task_id: string;
        result_asset_id: string;
        state: string;
      };
      expect(row).toMatchObject({ attempt: 1, provider_task_id: providerTaskId, state: "success" });
      const canvas = finalDatabase.prepare(`
        SELECT nodes FROM canvas_documents WHERE owner_id = ? AND id = ?
      `).get(ownerId, canvasId) as { nodes: string };
      const target = (JSON.parse(canvas.nodes) as Array<{
        data: Record<string, unknown>;
        id: string;
      }>).find((node) => node.id === nodeId);
      expect(target?.data).toMatchObject({
        assetId: row.result_asset_id,
        groupRunSuccessTaskId: parent.id,
        videoSrc: `/api/video-assets/${row.result_asset_id}`,
      });
      expect(target?.data.videoGenerationTaskId).toBeUndefined();
      expect(finalDatabase.prepare(`
        SELECT COUNT(*) AS count FROM media_publication_attempts
        WHERE task_id = ? AND task_execution_attempt = ? AND state = 'published'
      `).get(parent.id, 1)).toEqual({ count: 1 });
    } finally {
      finalDatabase.close();
    }
  } finally {
    globalThis.fetch = nativeFetch;
    if (fakeServer) {
      await new Promise<void>((resolve) => fakeServer!.close(() => resolve()));
    }
    resetGenerationTaskStoreForRuntimeTest();
    store?.close();
    database?.close();
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    if (previousFetcherFlag === undefined) delete process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER;
    else process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = previousFetcherFlag;
    if (previousSweepFlag === undefined) delete process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP;
    else process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP = previousSweepFlag;
    if (previousCasesFlag === undefined) delete process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED;
    else process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED = previousCasesFlag;
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
}
