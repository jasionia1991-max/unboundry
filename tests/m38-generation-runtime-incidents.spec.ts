import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { saveAccountCredential } from "../server/accountCredentials";
import { openAppDatabase } from "../server/database";
import { bootstrapPublishedModelContracts } from
  "../server/modelReleaseBootstrap";
import { modelContractState } from "../server/modelReleaseRevisionStore";
import { createGenerationSafetyStore } from "../server/generationSafety";
import {
  createGenerationTaskStore,
  generationProviderAttemptCounts,
  GenerationProviderAttemptBlockedError,
  type GenerationTask,
} from "../server/generationTaskStore";
import {
  attemptProviderResultSave,
  executeTextTaskWithDependencies,
  generationTaskCancellationMode,
  launchGenerationTaskForRuntimeTest,
  retrySafetyDecision,
  retrySnapshotCompatibilityProblem,
  runGenerationRecoverySweep,
  settleDetachedGenerationExecution,
} from "../server/generationTasks";
import { evaluateModelRuntimeAvailability } from "../server/modelAvailability";
import {
  ProviderProfileLockBusyError,
  type ProviderProfile,
} from "../server/providerProfiles";
import { ProviderResultMediaError } from "../server/providerResultMedia";
import { StorageConfigurationBusyError } from "../server/secureStorageProfiles";
import {
  createVolcengineArkTextResponse,
} from "../server/volcengineArkTextProvider";
import {
  cleanParameterSchema,
  knownModelParameterSchema,
  providerParameterSchema,
  validateParameterSchemaConstraints,
} from "../types/modelParameters";

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
const incidentPort = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
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
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_TEST_AUTH_BYPASS: "1",
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

test("detached generation execution contains execution and failure-write rejections", async () => {
  const executionFailure = new Error("controlled execution failure");
  let persistedFailure: unknown;
  await settleDetachedGenerationExecution(
    async () => {
      throw executionFailure;
    },
    async (error) => {
      persistedFailure = error;
    },
  );
  expect(persistedFailure).toBe(executionFailure);

  let persistenceAttempts = 0;
  await settleDetachedGenerationExecution(
    () => {
      throw new Error("controlled synchronous failure");
    },
    async () => {
      persistenceAttempts += 1;
      throw new Error("controlled persistence failure");
    },
  );
  expect(persistenceAttempts).toBe(1);
});

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
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-text-auth-incident-"));
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
        providerProfileId: arkProfile.id,
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

test("an auth incident grants one atomic recovery attempt per credential revision", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-provider-recovery-slot-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  const store = createGenerationTaskStore(dataDirectory);
  const database = openAppDatabase(dataDirectory);
  try {
    const ownerId = "provider-recovery-owner";
    const providerProfileId = "provider-recovery-slot";
    const imageProviderProfileId = "provider-recovery-openrouter";
    const modelProfileId = "model-recovery-text";
    const imageModelProfileId = "model-unrelated-image";
    const videoModelProfileId = "model-unrelated-video";
    const baseline = new Date(Date.now() - 60_000).toISOString();
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, 'Recovery Owner', 'fixture-only', 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, baseline, baseline);
    const insertProvider = database.prepare(`
      INSERT INTO provider_profiles (
        id, display_name, driver, status, created_at, updated_at,
        provider_configuration_version
      ) VALUES (?, ?, ?, 'enabled', ?, ?, 1)
    `);
    insertProvider.run(
      providerProfileId,
      "Recovery Ark",
      "volcengine-ark",
      baseline,
      baseline,
    );
    insertProvider.run(
      imageProviderProfileId,
      "Recovery OpenRouter",
      "openrouter",
      baseline,
      baseline,
    );
    const insertModel = database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency, provider_protocol
      ) VALUES (
        ?, ?, ?, ?, ?, 'published', ?, ?, ?, 5000000, ?, 'native'
      )
    `);
    const models = ([
      {
        capability: "text",
        currency: "CNY",
        displayName: "Recovery Text",
        id: modelProfileId,
        providerDriver: "volcengine-ark",
        providerModelId: textModelId,
        providerProfileId,
      },
      {
        capability: "image",
        currency: "USD",
        displayName: "Unrelated Image",
        id: imageModelProfileId,
        providerDriver: "openrouter",
        providerModelId: "openai/gpt-image-2",
        providerProfileId: imageProviderProfileId,
      },
      {
        capability: "video",
        currency: "CNY",
        displayName: "Unrelated Video",
        id: videoModelProfileId,
        providerDriver: "volcengine-ark",
        providerModelId: "doubao-seedance-2-0-mini-260615",
        providerProfileId,
      },
    ] as const).map((model) => {
      const knownSchema = knownModelParameterSchema({
        capability: model.capability,
        providerDriver: model.providerDriver,
        providerModelId: model.providerModelId,
      });
      const constraints = providerParameterSchema({
        capability: model.capability,
        providerDriver: model.providerDriver,
        providerModelId: model.providerModelId,
      });
      return {
        ...model,
        parameterSchema: constraints
          ? validateParameterSchemaConstraints(
              cleanParameterSchema(model.capability, knownSchema, knownSchema),
              constraints,
            )
          : knownSchema,
      };
    });
    const insertBinding = database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      ) VALUES (?, ?, 1, 1, 1, ?, ?)
    `);
    for (const model of models) {
      insertModel.run(
        model.id,
        model.displayName,
        model.providerProfileId,
        model.providerModelId,
        model.capability,
        JSON.stringify(model.parameterSchema),
        baseline,
        baseline,
        model.currency,
      );
      insertBinding.run(
        model.capability,
        model.id,
        baseline,
        baseline,
      );
    }
    bootstrapPublishedModelContracts(database, ownerId);
    database.prepare(`
      UPDATE generation_safety_settings
      SET
        global_enabled = 1,
        emergency_stop = 0,
        per_user_concurrency = 10,
        requests_per_minute = 120,
        image_concurrency = 5,
        video_concurrency = 5,
        audio_concurrency = 5,
        text_concurrency = 5,
        failure_threshold = 3,
        cooldown_minutes = 30,
        running_task_policy = 'wait',
        updated_at = ?
      WHERE id = 1
    `).run(baseline);
    const credential = await saveAccountCredential(
      database,
      ownerId,
      providerProfileId,
      "test-only-recovery-key",
    );
    const imageCredential = await saveAccountCredential(
      database,
      ownerId,
      imageProviderProfileId,
      "test-only-image-recovery-key",
    );
    let credentialRevision = credential.credentialVersion;

    let sequence = 0;
    const runningTask = (kind: "image" | "text" | "video", model: string) => {
      sequence += 1;
      const modelFixture = models.find(({ id }) => id === model)!;
      const taskCredentialRevision = modelFixture.providerProfileId ===
          providerProfileId
        ? credentialRevision
        : imageCredential.credentialVersion;
      const modelReleaseRevision = modelContractState(database, model).active!;
      const created = store.admitOrGet({
        canvasId: "default",
        costCurrency: kind === "image" ? "USD" : "CNY",
        credentialRevision: taskCredentialRevision,
        estimatedCostMicrounits: 5_000_000,
        idempotencyKey: `provider-recovery-${sequence}`,
        kind,
        model,
        modelConfiguration: {
          credentialVersion: taskCredentialRevision,
          modelId: model,
          modelReleaseRevision,
          parameterSchema: modelReleaseRevision.document.capabilitySchema,
          providerConfigurationVersion: 1,
          providerDriver: modelFixture.providerDriver,
          providerModelId: modelFixture.providerModelId,
          providerProfileId: modelFixture.providerProfileId,
          providerProtocol: "native",
        },
        nodeId: `recovery-node-${sequence}`,
        ownerId,
        parameters: {},
        prompt: "recovery boundary test",
        providerModelId: modelFixture.providerModelId,
        providerProfileId: modelFixture.providerProfileId,
      });
      expect(created.created).toBe(true);
      return store.transition(created.task.id, "running")!;
    };

    const incident = runningTask("text", modelProfileId);
    store.recordProviderAttempt(incident.id);
    store.transition(incident.id, "failed", {
      code: "AUTH",
      message: "safe auth incident",
    });
    const placeOutcomeBeforeNextCredentialMutation = (taskId: string) => {
      const timestamp = new Date(Date.now() - 1).toISOString();
      database.prepare(`
        UPDATE generation_provider_attempts
        SET created_at = ?, finished_at = ?
        WHERE task_id = ?
      `).run(timestamp, timestamp, taskId);
    };
    placeOutcomeBeforeNextCredentialMutation(incident.id);

    const staleRevision = runningTask("text", modelProfileId);
    credentialRevision = (await saveAccountCredential(
      database,
      ownerId,
      providerProfileId,
      "test-only-recovery-key-revision-2",
    )).credentialVersion;
    expect(credentialRevision).toBe(2);
    expect(() => store.recordProviderAttempt(staleRevision.id)).toThrow(
      GenerationProviderAttemptBlockedError,
    );
    try {
      store.recordProviderAttempt(staleRevision.id);
    } catch (error) {
      expect(error).toMatchObject({ code: "ACCOUNT_CREDENTIAL_CHANGED" });
    }
    store.transition(staleRevision.id, "failed", {
      code: "ACCOUNT_CREDENTIAL_CHANGED",
      message: "old credential revision remains blocked",
    });

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
    const image = runningTask("image", imageModelProfileId);
    expect(store.recordProviderAttempt(image.id)).toMatchObject({
      executionAttempt: 1,
    });
    store.transition(image.id, "failed", {
      code: "RATE_LIMIT",
      message: "unrelated image result",
    });
    const video = runningTask("video", videoModelProfileId);
    expect(store.recordProviderAttempt(video.id)).toMatchObject({
      executionAttempt: 1,
    });
    store.transition(video.id, "failed", {
      code: "RATE_LIMIT",
      message: "unrelated video result",
    });

    placeOutcomeBeforeNextCredentialMutation(firstRecovery.id);
    credentialRevision = (await saveAccountCredential(
      database,
      ownerId,
      providerProfileId,
      "test-only-recovery-key-revision-3",
    )).credentialVersion;
    expect(credentialRevision).toBe(3);
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
      SELECT credential_revision, evidence, kind, outcome, owner_id
      FROM generation_provider_attempts
      ORDER BY id
    `).all() as Array<{
      credential_revision: number;
      evidence: string;
      kind: string;
      outcome: string;
      owner_id: string;
    }>;
    expect(attempts).toHaveLength(6);
    expect(attempts.every(({ evidence }) => evidence === "provider-boundary"))
      .toBe(true);
    expect(attempts.every(({ owner_id }) => owner_id === ownerId)).toBe(true);
    expect(attempts.map(({ credential_revision }) => credential_revision))
      .toEqual([1, 2, 1, 2, 3, 3]);
    expect(attempts.map(({ outcome }) => outcome)).toEqual([
      "outcome-unknown",
      "outcome-unknown",
      "outcome-unknown",
      "outcome-unknown",
      "completed",
      "boundary-claimed",
    ]);
    expect(attempts.filter(({ kind }) => kind === "image")).toHaveLength(1);
    expect(attempts.filter(({ kind }) => kind === "video")).toHaveLength(1);
    expect(database.prepare(`
      SELECT credential_revision
      FROM account_provider_credential_epochs
      WHERE account_id = ? AND provider_profile_id = ?
    `).get(ownerId, providerProfileId)).toEqual({
      credential_revision: 3,
    });
    expect(database.prepare(`
      SELECT credential_revision
      FROM account_provider_credential_epochs
      WHERE account_id = ? AND provider_profile_id = ?
    `).get(ownerId, imageProviderProfileId)).toEqual({
      credential_revision: 1,
    });
    const admissions = database.prepare(`
      SELECT admission_type, execution_attempt, owner_id
      FROM generation_admission_events
      WHERE owner_id = ?
      ORDER BY id
    `).all(ownerId) as Array<{
      admission_type: string;
      execution_attempt: number;
      owner_id: string;
    }>;
    expect(admissions).toHaveLength(9);
    expect(admissions.every((admission) =>
      admission.admission_type === "initial" &&
      admission.execution_attempt === 1 &&
      admission.owner_id === ownerId)).toBe(true);
  } finally {
    database.close();
    store.close();
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("the incident cooldown ignores stale and unrelated Provider failures", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-cooldown-incident-"));
  const safety = createGenerationSafetyStore(dataDirectory);
  const database = openAppDatabase(dataDirectory);
  const now = new Date("2026-08-03T03:40:00.000Z");
  try {
    safety.update({
      audioConcurrency: 5,
      cooldownMinutes: 30,
      emergencyStop: false,
      failureThreshold: 3,
      globalEnabled: true,
      imageConcurrency: 5,
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
    const insertProviderFailure = database.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, created_at, owner_id, credential_revision, outcome,
        failure_code, finished_at
      ) VALUES (
        ?, 1, ?, ?, ?, 'historical-execution-attempt', ?, ?, 0,
        'provider-failed', 'PROVIDER_FAILED', ?
      )
    `);
    const insertFailure = (input: {
      id: string;
      kind: "audio" | "image" | "text" | "video";
      profileId: string;
      timestamp: string;
    }) => {
      const providerModelId = input.kind === "text"
        ? textModelId
        : `model-${input.kind}`;
      insertTask.run(
        input.id,
        `node-${input.id}`,
        input.kind,
        `key-${input.id}`,
        `fingerprint-${input.id}`,
        "PROVIDER_FAILED",
        input.timestamp,
        input.timestamp,
        ownerId,
        input.profileId,
        providerModelId,
        input.kind === "image" || input.kind === "audio" ? "USD" : "CNY",
      );
      insertProviderFailure.run(
        input.id,
        input.profileId,
        providerModelId,
        input.kind,
        input.timestamp,
        ownerId,
        input.timestamp,
      );
    };

    insertFailure({
      id: "old-audio-provider-failure",
      kind: "audio",
      profileId: "provider-mureka",
      timestamp: "2026-08-01T18:10:23.134Z",
    });
    insertFailure({
      id: "text-provider-failure-one",
      kind: "text",
      profileId: arkProfile.id,
      timestamp: "2026-08-03T03:37:28.128Z",
    });
    insertFailure({
      id: "text-provider-failure-two",
      kind: "text",
      profileId: arkProfile.id,
      timestamp: "2026-08-03T03:37:46.455Z",
    });

    expect(safety.admission({
      kind: "text",
      now,
      ownerId,
      providerProfileId: arkProfile.id,
    })).toEqual({ allowed: true, code: "ALLOWED" });

    insertFailure({
      id: "text-provider-failure-three",
      kind: "text",
      profileId: arkProfile.id,
      timestamp: "2026-08-03T03:38:00.000Z",
    });
    // 平台没出片/结果不明不算明确失败，不应触发熔断。
    expect(safety.admission({
      kind: "text",
      now,
      ownerId,
      providerProfileId: arkProfile.id,
    })).toEqual({ allowed: true, code: "ALLOWED" });
    database.prepare(`
      UPDATE generation_provider_attempts
      SET failure_code = 'PERMISSION'
      WHERE owner_id = ? AND kind = 'text' AND provider_profile_id = ?
    `).run(ownerId, arkProfile.id);
    expect(safety.admission({
      kind: "text",
      now,
      ownerId,
      providerProfileId: arkProfile.id,
    })).toMatchObject({ allowed: false, code: "PROVIDER_COOLDOWN" });
    expect(safety.admission({
      kind: "image",
      now,
      ownerId,
      providerProfileId: "provider-openrouter",
    })).toEqual({ allowed: true, code: "ALLOWED" });
    expect(safety.admission({
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

test("retry snapshot compatibility uses durable media while preserving structural checks", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-retry-media-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  const database = openAppDatabase(dataDirectory);
  try {
    const timestamp = "2026-08-03T04:00:00.000Z";
    database.prepare(`
      INSERT OR IGNORE INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('__test__', '__test__', 'Test User', 'test-only', 'admin', 'active', ?, ?)
    `).run(timestamp, timestamp);
    const insertReadyImage = database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height
      ) VALUES (
        'image', ?, '__test__', ?, 1024, ?, ?, 'local', ?, 'image/png', ?,
        'ready', NULL, NULL, 'not-applicable', 1280, 720
      )
    `);
    for (const assetId of [
      "text-context-image",
      "image-reference",
      "video-reference-image",
    ]) {
      insertReadyImage.run(
        assetId,
        `${assetId}.png`,
        timestamp,
        timestamp,
        `${assetId}.png`,
        "a".repeat(64),
      );
    }
  type RetryModel = NonNullable<
    Parameters<typeof retrySnapshotCompatibilityProblem>[1]
  >;
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
    requestFingerprint: `retry-compatibility-${kind}-fingerprint`,
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
  } finally {
    database.close();
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("a new retry attempt fail-closes on exact ready media metadata without entering Provider", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-retry-rules-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  const database = openAppDatabase(dataDirectory);
  try {
    const timestamp = "2026-08-03T04:05:00.000Z";
    const ownerId = "retry-media-owner";
    const profileId = "retry-media-provider";
    const modelId = "retry-media-video-model";
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, 'Retry Media Owner', 'test-only', 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO provider_profiles (
        id, display_name, driver, status, created_at, updated_at
      ) VALUES (?, 'Retry Media Provider', 'volcengine-ark', 'enabled', ?, ?)
    `).run(profileId, timestamp, timestamp);

    const tightenedSchema = knownModelParameterSchema({
      capability: "video",
      providerDriver: "volcengine-ark",
      providerModelId: "doubao-seedance-2-0-mini-260615",
    });
    const tightenedImageRules = tightenedSchema.referenceMediaRules?.image;
    if (!tightenedImageRules) throw new Error("Seedance image rules missing");
    tightenedImageRules.maxBytes = 1024;
    tightenedImageRules.minWidth = 1000;
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency
      ) VALUES (
        ?, 'Retry Media Video', ?, 'doubao-seedance-2-0-mini-260615',
        'video', 'published', ?, ?, ?, 5000000, 'CNY'
      )
    `).run(
      modelId,
      profileId,
      JSON.stringify(tightenedSchema),
      timestamp,
      timestamp,
    );
    database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      ) VALUES ('video', ?, 1, 0, 50, ?, ?)
    `).run(modelId, timestamp, timestamp);

    const insertImage = database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height
      ) VALUES (
        'image', ?, ?, ?, ?, ?, ?, 'local', ?, 'image/png', ?, ?,
        NULL, NULL, 'not-applicable', ?, ?
      )
    `);
    const mediaFixtures = [
      {
        assetId: "retry-small-real-image",
        byteSize: 512,
        height: 720,
        status: "ready",
        width: 640,
      },
      {
        assetId: "retry-overlimit-real-image",
        byteSize: 2048,
        height: 720,
        status: "ready",
        width: 1280,
      },
      {
        assetId: "retry-missing-dimensions-image",
        byteSize: 512,
        height: null,
        status: "ready",
        width: null,
      },
      {
        assetId: "retry-not-ready-image",
        byteSize: 512,
        height: 720,
        status: "pending",
        width: 1280,
      },
      {
        assetId: "retry-compliant-real-image",
        byteSize: 512,
        height: 720,
        status: "ready",
        width: 1280,
      },
    ] as const;
    for (const fixture of mediaFixtures) {
      const storageName = `${fixture.assetId}.png`;
      insertImage.run(
        fixture.assetId,
        ownerId,
        storageName,
        fixture.byteSize,
        timestamp,
        timestamp,
        storageName,
        "b".repeat(64),
        fixture.status,
        fixture.width,
        fixture.height,
      );
    }

    const retryTask = (assetId: string): GenerationTask => ({
      attempt: 1,
      canvasId: "retry-media-canvas",
      costCurrency: "CNY",
      createdAt: timestamp,
      errorCode: "RATE_LIMIT",
      errorMessage: "safe retry fixture",
      id: `task-${assetId}`,
      idempotencyKey: `key-${assetId}`,
      kind: "video",
      model: modelId,
      modelConfiguration: {},
      nodeId: `target-${assetId}`,
      ownerId,
      parameters: {
        aspectRatio: "16:9",
        duration: 5,
        generateAudio: true,
        inputMode: "multimodal",
        inputSchemaVersion: 1,
        inputs: [{
          assetId,
          kind: "image",
          order: 1,
          role: "reference-image",
          sourceNodeId: `source-${assetId}`,
        }],
        outputCount: 1,
        resolution: "480p",
      },
      prompt: "retry with exact durable media",
      providerModelId: "doubao-seedance-2-0-mini-260615",
      providerProfileId: profileId,
      requestFingerprint: `retry-media-${assetId}-fingerprint`,
      state: "failed",
      updatedAt: timestamp,
    });

    const attemptsBefore = generationProviderAttemptCounts(database);
    for (const assetId of [
      "retry-small-real-image",
      "retry-overlimit-real-image",
      "retry-missing-dimensions-image",
      "retry-not-ready-image",
      "retry-missing-media",
    ]) {
      expect(retrySafetyDecision(retryTask(assetId))).toMatchObject({
        allowed: false,
        code: "RETRY_SNAPSHOT_INCOMPATIBLE",
      });
    }
    expect(retrySafetyDecision(retryTask("retry-compliant-real-image")))
      .toMatchObject({
        allowed: true,
        mode: "new-provider-attempt",
      });
    expect(generationProviderAttemptCounts(database)).toEqual(attemptsBefore);

    const paidTaskWithDeletedMedia = retryTask("already-deleted-image");
    paidTaskWithDeletedMedia.providerTaskId = "already-paid-provider-task";
    expect(retrySnapshotCompatibilityProblem(
      paidTaskWithDeletedMedia,
      {
        cost_currency: "CNY",
        default_parameters: JSON.stringify(tightenedSchema),
        id: modelId,
        latest_auth_failure_at: null,
        latest_capability_success_at: null,
        latest_provider_attempt_at: null,
        max_cost_microunits: 5_000_000,
        model_configuration_updated_at: timestamp,
        provider_configuration_updated_at: timestamp,
        provider_driver: "volcengine-ark",
        provider_model_id: "doubao-seedance-2-0-mini-260615",
        provider_profile_id: profileId,
        provider_status: "enabled",
      },
      "resume-provider-task",
    )).toBeUndefined();
  } finally {
    database.close();
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
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
    requestFingerprint: `async-provider-intent-${kind}-${state}-fingerprint`,
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

  const incident = task("video", "failed");
  incident.errorCode = "OPERATOR_INCIDENT";
  expect(retrySafetyDecision(incident, {
    credentialRevision: 1,
    executionAttempt: 1,
    outcome: "accepted",
    providerModelId: incident.providerModelId!,
    providerProfileId: incident.providerProfileId!,
    providerTaskId: incident.providerTaskId,
  }, false)).toEqual({
    allowed: false,
    code: "OPERATOR_INCIDENT",
    reason: "该任务已进入管理员事故队列，不能人工重试或重新提交",
  });
});

test("only capability success or an explicit Provider/model update clears an auth incident", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-auth-reset-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  const safety = createGenerationSafetyStore(dataDirectory);
  let server: ChildProcess | undefined;
  try {
    safety.update({
      audioConcurrency: 5,
      cooldownMinutes: 30,
      emergencyStop: false,
      failureThreshold: 3,
      globalEnabled: true,
      imageConcurrency: 5,
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

    const credentialStore = openAppDatabase(dataDirectory);
    const timestamp = new Date().toISOString();
    credentialStore
      .prepare(`
        INSERT OR IGNORE INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES ('__test__', '__test__', 'Test User', 'test-only', 'admin', 'active', ?, ?)
      `)
      .run(timestamp, timestamp);
    bootstrapPublishedModelContracts(credentialStore, "__test__");
    await saveAccountCredential(
      credentialStore,
      "__test__",
      arkProfileId,
      "test-only-ark-reset-key",
    );
    await saveAccountCredential(
      credentialStore,
      "__test__",
      openRouterProfileId,
      "test-only-openrouter-reset-key",
    );
    credentialStore.close();

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
          5000000, ?, ?, ?, ?, ?
        )
      `);
      const retryFixtureKinds = new Map<
        string,
        "audio" | "image" | "text" | "video"
      >();
      const retryGenerationInputKey = (id: string) =>
        `generation-input-${id}`;
      const retryGenerationOwnershipKey = (id: string) =>
        `ownership-${id}`;
      const retryModelConfigurationRevision = (id: string) =>
        `configuration-${id}`;
      const retryModelInputContractFingerprint = (id: string) =>
        id === "retry-network-unknown"
          ? "mic2-workflow-fixture"
          : `mic2-${id}`;
      const retryModelReleaseRevision = (id: string) =>
        id === "retry-network-unknown"
          ? "model-revision-fixture"
          : `release-${id}`;
      const addRetryFixture = (input: {
        code: string;
        id: string;
        kind: "audio" | "image" | "text" | "video";
        modelId: string;
        parameters: Record<string, unknown>;
        providerModelId: string;
        providerProfileId: string;
        providerTaskId?: string;
      }) => {
        retryFixtureKinds.set(input.id, input.kind);
        return insertRetryFixture.run(
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
          JSON.stringify({
            fixtureScopeId: "",
            generationIdentityVersion: 2,
            modelConfigurationRevision:
              retryModelConfigurationRevision(input.id),
            modelInputContractFingerprint:
              retryModelInputContractFingerprint(input.id),
            modelReleaseRevision: retryModelReleaseRevision(input.id),
          }),
        );
      };
      const retryFence = (id: string) => {
        const kind = retryFixtureKinds.get(id);
        if (!kind) throw new Error(`Retry fixture not found: ${id}`);
        return {
          canvasId: "default",
          expectedAttempt: 1,
          expectedCanvasRevision: 1,
          expectedGenerationInputKey: retryGenerationInputKey(id),
          expectedGenerationOwnershipKey:
            retryGenerationOwnershipKey(id),
          expectedFixtureScopeId: "",
          expectedModelConfigurationRevision:
            retryModelConfigurationRevision(id),
          expectedModelInputContractFingerprint:
            retryModelInputContractFingerprint(id),
          expectedModelReleaseRevision: retryModelReleaseRevision(id),
          expectedUpdatedAt: retryTimestamp,
          kind,
          nodeId: `node-${id}`,
        };
      };

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
          kind, evidence, owner_id, credential_revision, outcome,
          failure_code, finished_at, created_at
        ) VALUES (
          ?, 1, ?, ?, 'text', 'historical-execution-attempt', '__test__', 0,
          'outcome-unknown', 'SERVICE_RESTARTED', ?, ?
        )
      `).run(
        "retry-old-service-restarted",
        arkProfileId,
        textModelId,
        retryTimestamp,
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
        UPDATE generation_tasks SET model_configuration = ? WHERE id = ?
      `).run(JSON.stringify({
        fixtureScopeId: "",
        generationIdentityVersion: 2,
        modelConfigurationRevision:
          retryModelConfigurationRevision("retry-network-unknown"),
        modelInputContractFingerprint: "mic2-workflow-fixture",
        modelReleaseRevision: "model-revision-fixture",
        workflowBinding: {
          generationInputKey: retryGenerationInputKey("retry-network-unknown"),
          generationOwnershipKey: "ownership-retry-network-unknown",
          groupId: "workflow-group-fixture",
          modelConfigurationRevision:
            retryModelConfigurationRevision("retry-network-unknown"),
          modelReleaseRevision: "model-revision-fixture",
          runId: "workflow-run-fixture",
        },
      }), "retry-network-unknown");
      database.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, provider_profile_id, provider_model_id,
          kind, evidence, owner_id, credential_revision, outcome,
          failure_code, finished_at, created_at
        ) VALUES (
          ?, 1, ?, ?, 'text', 'provider-boundary', '__test__', 0,
          'outcome-unknown', 'NETWORK', ?, ?
        )
      `).run(
        "retry-network-unknown",
        arkProfileId,
        textModelId,
        retryTimestamp,
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
          kind, evidence, owner_id, credential_revision, outcome,
          failure_code, finished_at, created_at
        ) VALUES (
          ?, 1, ?, ?, 'video', 'provider-boundary', '__test__', 0,
          'outcome-unknown', 'NETWORK', ?, ?
        )
      `).run(
        "retry-video-network-no-id",
        arkProfileId,
        "doubao-seedance-2-0-mini-260615",
        retryTimestamp,
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
      addRetryFixture({
        code: "NETWORK",
        id: "retry-video-existing-job-deleted-media",
        kind: "video",
        modelId: videoModelProfileId,
        parameters: {
          aspectRatio: "16:9",
          duration: 5,
          generateAudio: true,
          inputMode: "multimodal",
          inputSchemaVersion: 1,
          inputs: [{
            assetId: "deleted-after-provider-submit",
            kind: "image",
            order: 1,
            role: "reference-image",
            sourceNodeId: "deleted-after-provider-submit-source",
          }],
          outputCount: 1,
          resolution: "480p",
        },
        providerModelId: "doubao-seedance-2-0-mini-260615",
        providerProfileId: arkProfileId,
        providerTaskId: "already-paid-video-provider-task",
      });
      database.prepare(`
        INSERT INTO canvas_documents (
          owner_id, id, revision, graph_revision, nodes, edges, viewport,
          updated_at, save_session_id, save_sequence
        ) VALUES ('__test__', 'default', 1, 1, ?, '[]', '{}', ?, NULL, 0)
        ON CONFLICT(owner_id, id) DO UPDATE SET
          revision = excluded.revision,
          graph_revision = excluded.graph_revision,
          nodes = excluded.nodes,
          edges = excluded.edges,
          viewport = excluded.viewport,
          updated_at = excluded.updated_at,
          save_session_id = NULL,
          save_sequence = 0
      `).run(
        JSON.stringify(Array.from(retryFixtureKinds, ([id, kind]) => ({
          data: {
            [`${kind}GenerationInputKey`]: retryGenerationInputKey(id),
            [`${kind}GenerationOwnershipKey`]:
              retryGenerationOwnershipKey(id),
            [`${kind}GenerationTaskId`]: id,
            [`${kind}InputContractFingerprint`]:
              retryModelInputContractFingerprint(id),
            [`${kind}ModelConfigurationRevision`]:
              retryModelConfigurationRevision(id),
            [`${kind}ModelReleaseRevision`]:
              retryModelReleaseRevision(id),
          },
          id: `node-${id}`,
          type: kind,
        }))),
        retryTimestamp,
      );
      const insertAcceptedProviderTask = database.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, provider_profile_id, provider_model_id,
          kind, evidence, owner_id, credential_revision, outcome,
          provider_task_id, created_at
        ) VALUES (
          ?, 1, ?, ?, ?, 'provider-boundary', '__test__', 0,
          'accepted', ?, ?
        )
      `);
      insertAcceptedProviderTask.run(
        "retry-video-network-with-id",
        "missing-video-provider",
        "doubao-seedance-2-0-mini-260615",
        "video",
        "video-provider-task-resume",
        retryTimestamp,
      );
      insertAcceptedProviderTask.run(
        "retry-audio-download-with-id",
        "missing-audio-provider",
        "mureka-8",
        "audio",
        "audio-provider-task-resume",
        retryTimestamp,
      );
      insertAcceptedProviderTask.run(
        "retry-video-existing-job-deleted-media",
        arkProfileId,
        "doubao-seedance-2-0-mini-260615",
        "video",
        "already-paid-video-provider-task",
        retryTimestamp,
      );

      const recordedBeforeRetries = generationProviderAttemptCounts(database);
      for (const id of [
        "retry-old-service-restarted",
        "retry-network-unknown",
        "retry-video-network-no-id",
      ]) {
        const summary = await incidentRequest(`/api/generation-tasks/${id}`);
        expect(summary.status).toBe(200);
        expect(await summary.json()).toMatchObject({
          retryAllowed: false,
          retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
          ...(id === "retry-network-unknown"
            ? {
                generationInputKey: retryGenerationInputKey(id),
                generationOwnershipKey: "ownership-retry-network-unknown",
                modelInputContractFingerprint: "mic2-workflow-fixture",
                modelReleaseRevision: "model-revision-fixture",
                workflowExecutionRunId: "workflow-run-fixture",
                workflowGroupId: "workflow-group-fixture",
              }
            : {}),
        });
        const response = await incidentRequest(
          `/api/generation-tasks/${id}/retry`,
          {
            body: JSON.stringify(retryFence(id)),
            method: "POST",
          },
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          code: "RETRY_OUTCOME_UNKNOWN",
        });
      }
      const attemptsBeforeReconcile = generationProviderAttemptCounts(database);
      const tasksBeforeReconcile = Number((database.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
      `).get() as { count: number }).count);
      const crossFixtureReconcile = await incidentRequest(
        "/api/generation-tasks/retry-network-unknown/reconcile",
        {
          body: JSON.stringify({
            ...retryFence("retry-network-unknown"),
            expectedFixtureScopeId: "other-fixture",
          }),
          method: "POST",
        },
      );
      expect(crossFixtureReconcile.status).toBe(409);
      expect(await crossFixtureReconcile.json()).toMatchObject({
        code: "RETRY_BINDING_STALE",
      });
      expect(generationProviderAttemptCounts(database))
        .toEqual(attemptsBeforeReconcile);
      const unverifiedManualTaskId = await incidentRequest(
        "/api/generation-tasks/retry-network-unknown/reconcile",
        {
          body: JSON.stringify({
            ...retryFence("retry-network-unknown"),
            providerTaskId: "unverified-provider-task",
          }),
          method: "POST",
        },
      );
      expect(unverifiedManualTaskId.status).toBe(400);
      expect(await unverifiedManualTaskId.json()).toMatchObject({
        code: "PROVIDER_TASK_ID_UNVERIFIED",
      });
      expect(generationProviderAttemptCounts(database))
        .toEqual(attemptsBeforeReconcile);
      expect(database.prepare(`
        SELECT provider_task_id FROM generation_tasks WHERE id = ?
      `).get("retry-network-unknown")).toEqual({ provider_task_id: null });
      expect(database.prepare(`
        SELECT outcome, provider_task_id
        FROM generation_provider_attempts
        WHERE task_id = ? AND execution_attempt = 1
      `).get("retry-network-unknown")).toEqual({
        outcome: "outcome-unknown",
        provider_task_id: null,
      });
      const reconcile = await incidentRequest(
        "/api/generation-tasks/retry-network-unknown/reconcile",
        {
          body: JSON.stringify(retryFence("retry-network-unknown")),
          method: "POST",
        },
      );
      expect(reconcile.status).toBe(200);
      const reconciled = await reconcile.json() as {
        outcome: string;
        task: { errorCode?: string; updatedAt: string };
      };
      expect(reconciled).toMatchObject({
        outcome: "outcome-unknown",
        task: {
          errorCode: "OUTCOME_UNKNOWN_BILLING_RISK",
        },
      });
      expect(generationProviderAttemptCounts(database))
        .toEqual(attemptsBeforeReconcile);
      expect(Number((database.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
      `).get() as { count: number }).count)).toBe(tasksBeforeReconcile);
      const retryAfterReconcile = await incidentRequest(
        "/api/generation-tasks/retry-network-unknown/retry",
        {
          body: JSON.stringify({
            ...retryFence("retry-network-unknown"),
            expectedUpdatedAt: reconciled.task.updatedAt,
          }),
          method: "POST",
        },
      );
      expect(retryAfterReconcile.status).toBe(409);
      expect(await retryAfterReconcile.json()).toMatchObject({
        code: "RETRY_OUTCOME_UNKNOWN",
      });
      expect(generationProviderAttemptCounts(database))
        .toEqual(attemptsBeforeReconcile);
      const preBoundaryAudioRestart = await incidentRequest(
        "/api/generation-tasks/retry-audio-restart-no-id",
      );
      expect(preBoundaryAudioRestart.status).toBe(200);
      expect(await preBoundaryAudioRestart.json()).toMatchObject({
        retryAllowed: false,
        retryBlockCode: "MODEL_UNAVAILABLE",
      });
      const preBoundaryAudioRetry = await incidentRequest(
        "/api/generation-tasks/retry-audio-restart-no-id/retry",
        {
          body: JSON.stringify(retryFence("retry-audio-restart-no-id")),
          method: "POST",
        },
      );
      expect(preBoundaryAudioRetry.status).toBe(409);
      expect(await preBoundaryAudioRetry.json()).toMatchObject({
        code: "MODEL_UNAVAILABLE",
      });
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
          {
            body: JSON.stringify(retryFence(id)),
            method: "POST",
          },
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
      const paidJobWithDeletedMedia = await incidentRequest(
        "/api/generation-tasks/retry-video-existing-job-deleted-media",
      );
      expect(paidJobWithDeletedMedia.status).toBe(200);
      expect(await paidJobWithDeletedMedia.json()).toMatchObject({
        retryAllowed: true,
      });
      for (const id of [
        "retry-video-network-with-id",
        "retry-audio-download-with-id",
      ]) {
        const summary = await incidentRequest(`/api/generation-tasks/${id}`);
        expect(summary.status).toBe(200);
        expect(await summary.json()).toMatchObject({
          retryAllowed: true,
        });
        const response = await incidentRequest(
          `/api/generation-tasks/${id}/retry`,
          {
            body: JSON.stringify(retryFence(id)),
            method: "POST",
          },
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          code: "PROVIDER_CONFIGURATION_MISMATCH",
        });
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
          attempt: 1,
          id: "retry-audio-download-with-id",
          provider_task_id: "audio-provider-task-resume",
          state: "failed",
        },
        {
          attempt: 1,
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
          kind, evidence, owner_id, credential_revision, outcome, created_at
        ) VALUES (
          ?, 1, ?, ?, 'text', 'provider-boundary', '__test__', 0,
          'boundary-claimed', ?
        )
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
        paidProviderRequests: 6,
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
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("provider result save treats SQLite lock contention as bounded transient failure", async () => {
  let busyAttempts = 0;
  const busyBackoffs: number[] = [];
  const saved = await attemptProviderResultSave({
    backoffMs: [1_000, 2_000, 4_000, 8_000, 15_000],
    save: async () => {
      busyAttempts += 1;
      throw new StorageConfigurationBusyError();
    },
    sleep: async (milliseconds) => {
      busyBackoffs.push(milliseconds);
    },
    taskId: "save-busy-task",
  });
  expect(saved).toBe(false);
  expect(busyAttempts).toBe(6);
  expect(busyBackoffs).toEqual([1_000, 2_000, 4_000, 8_000, 15_000]);

  let lockAttempts = 0;
  const lockSaved = await attemptProviderResultSave({
    backoffMs: [0, 0, 0, 0, 0],
    save: async () => {
      lockAttempts += 1;
      throw new ProviderProfileLockBusyError();
    },
    taskId: "save-lock-task",
  });
  expect(lockSaved).toBe(false);
  expect(lockAttempts).toBe(6);

  let definitiveAttempts = 0;
  await expect(attemptProviderResultSave({
    backoffMs: [0, 0, 0, 0, 0],
    save: async () => {
      definitiveAttempts += 1;
      throw new ProviderResultMediaError("FORMAT", "result cannot be read");
    },
    taskId: "save-definitive-task",
  })).rejects.toMatchObject({ code: "FORMAT" });
  expect(definitiveAttempts).toBe(1);
});

test("server recovery sweep auto-resumes a failed task that still holds a Provider task id", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-recovery-sweep-"));
  const store = createGenerationTaskStore(dataDirectory);
  const database = openAppDatabase(dataDirectory);
  try {
    const ownerId = "sweep-owner";
    const providerProfileId = "sweep-relay-provider";
    const modelProfileId = "sweep-image-model";
    const baseline = new Date(Date.now() - 60_000).toISOString();
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, 'Sweep Owner', 'fixture-only', 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, baseline, baseline);
    database.prepare(`
      INSERT INTO provider_profiles (
        id, display_name, driver, status, created_at, updated_at,
        provider_configuration_version
      ) VALUES (?, ?, 'multi-protocol-relay', 'enabled', ?, ?, 1)
    `).run(providerProfileId, "Sweep Relay", baseline, baseline);
    const parameterSchema = knownModelParameterSchema({
      capability: "image",
      providerDriver: "multi-protocol-relay",
      providerModelId: "gemini-3-pro-image-preview",
    });
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency, provider_protocol
      ) VALUES (
        ?, ?, ?, ?, 'image', 'published', ?, ?, ?, 5000000, 'USD', 'media-generate'
      )
    `).run(
      modelProfileId,
      "Sweep Image",
      providerProfileId,
      "gemini-3-pro-image-preview",
      JSON.stringify(parameterSchema),
      baseline,
      baseline,
    );
    database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      ) VALUES ('image', ?, 1, 1, 1, ?, ?)
    `).run(modelProfileId, baseline, baseline);
    bootstrapPublishedModelContracts(database, ownerId);
    database.prepare(`
      UPDATE generation_safety_settings
      SET
        global_enabled = 1,
        emergency_stop = 0,
        per_user_concurrency = 10,
        requests_per_minute = 120,
        image_concurrency = 5,
        video_concurrency = 5,
        audio_concurrency = 5,
        text_concurrency = 5,
        updated_at = ?
      WHERE id = 1
    `).run(baseline);
    const credential = await saveAccountCredential(
      database,
      ownerId,
      providerProfileId,
      "test-only-sweep-key",
    );
    const created = store.admitOrGet({
      canvasId: "sweep-canvas",
      costCurrency: "USD",
      credentialRevision: credential.credentialVersion,
      estimatedCostMicrounits: 5_000_000,
      idempotencyKey: "sweep-recovery-1",
      kind: "image",
      model: modelProfileId,
      modelConfiguration: {
        credentialVersion: credential.credentialVersion,
        modelId: modelProfileId,
        modelReleaseRevision: modelContractState(database, modelProfileId).active,
        parameterSchema: modelContractState(database, modelProfileId).active!
          .document.capabilitySchema,
        providerConfigurationVersion: 1,
        providerDriver: "multi-protocol-relay",
        providerModelId: "gemini-3-pro-image-preview",
        providerProfileId,
        providerProtocol: "media-generate",
      },
      nodeId: "sweep-node",
      ownerId,
      parameters: {
        inputSchemaVersion: 1,
        inputs: [],
      },
      prompt: "sweep recovery",
      providerModelId: "gemini-3-pro-image-preview",
      providerProfileId,
    });
    expect(created.created).toBe(true);
    const taskId = created.task.id;
    const running = store.transition(taskId, "running");
    expect(running).toMatchObject({ attempt: 1, state: "running" });
    // A historical task may already be on attempt 2. Recovery of its accepted
    // Provider task is not a third paid attempt and must preserve this number.
    database.prepare(`
      UPDATE generation_tasks SET attempt = 2 WHERE id = ?
    `).run(taskId);
    database.prepare(`
      INSERT INTO generation_admission_events (
        task_id, execution_attempt, owner_id, kind, admission_type, created_at
      ) VALUES (?, 2, ?, 'image', 'new-paid-retry', ?)
    `).run(taskId, ownerId, baseline);
    store.recordProviderAttempt(taskId);
    store.setProviderTaskId(taskId, "sweep-provider-task-123");
    store.transition(taskId, "failed", {
      code: "RESULT_DELAYED",
      message: "平台还在处理，结果出来后系统会自动核对",
    });
    const aged = new Date(Date.now() - 3 * 60_000).toISOString();
    database.prepare(`
      UPDATE generation_tasks SET updated_at = ? WHERE id = ?
    `).run(aged, taskId);
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, nodes, edges, viewport, updated_at, graph_revision
      ) VALUES (?, ?, 1, ?, '[]', '{}', ?, 1)
    `).run(
      ownerId,
      "sweep-canvas",
      JSON.stringify([{
        data: {
          imageGenerationInputKey: "sweep-input-key",
          imageGenerationTaskId: taskId,
        },
        id: "sweep-node",
        type: "image",
      }]),
      baseline,
    );

    const launched: string[] = [];
    await runGenerationRecoverySweep({
      launch: (id) => {
        launched.push(id);
        expect(store.get(id)).toMatchObject({ attempt: 2, state: "running" });
        store.complete(id, {
          actualCostMicrounits: 5_000_000,
          resultAssetId: "sweep-recovered-asset-001",
        });
      },
      store,
    });
    const recovered = store.get(taskId);
    expect(recovered?.state).toBe("success");
    expect(recovered?.attempt).toBe(2);
    expect(launched).toEqual([taskId]);
    expect(store.getProviderAttemptForTask(taskId)).toMatchObject({
      executionAttempt: 2,
      outcome: "completed",
      providerTaskId: "sweep-provider-task-123",
    });
  } finally {
    database.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("server recovery sweep binds one ledger match and launches without a second paid attempt", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-no-id-sweep-"));
  const store = createGenerationTaskStore(dataDirectory);
  try {
    const created = store.create({
      canvasId: "no-id-sweep-canvas",
      idempotencyKey: "no-id-sweep-0001",
      kind: "video",
      modelConfiguration: { providerProtocol: "media-generate" },
      nodeId: "no-id-sweep-node",
      ownerId: "__test__",
      prompt: "recover one ledger result",
      providerModelId: "grok-video-3",
      providerProfileId: "relay-profile",
    });
    const running = store.transition(created.task.id, "running")!;
    store.recordProviderAttempt(running.id);
    store.transition(running.id, "recovering", {
      code: "AUTOMATIC_RESULT_RECOVERY",
      message: "automatic recovery",
    });
    const launched: string[] = [];
    let matches = 0;
    const previousWorkflowFlag =
      process.env.UNBOUNDRY_WORKFLOW_SELF_HEALING_V2;
    process.env.UNBOUNDRY_WORKFLOW_SELF_HEALING_V2 = "0";
    try {
      await runGenerationRecoverySweep({
        launch: (id) => launched.push(id),
        match: async () => {
          matches += 1;
          return { status: "none" as const };
        },
        store,
      });
      expect(matches).toBe(0);
      expect(launched).toEqual([]);
      expect(store.get(running.id)).toMatchObject({
        providerTaskId: undefined,
        state: "recovering",
      });
    } finally {
      if (previousWorkflowFlag === undefined) {
        delete process.env.UNBOUNDRY_WORKFLOW_SELF_HEALING_V2;
      } else {
        process.env.UNBOUNDRY_WORKFLOW_SELF_HEALING_V2 = previousWorkflowFlag;
      }
    }
    await runGenerationRecoverySweep({
      launch: (id) => launched.push(id),
      match: async () => {
        matches += 1;
        return {
          status: "one" as const,
          record: {
            createdAt: running.createdAt,
            model: "grok-video-3",
            state: "success" as const,
            taskId: "provider-ledger-match-001",
          },
        };
      },
      store,
    });
    expect(matches).toBe(1);
    expect(launched).toEqual([running.id]);
    expect(store.get(running.id)).toMatchObject({
      attempt: 1,
      providerTaskId: "provider-ledger-match-001",
      state: "running",
    });
    expect(store.getProviderAttemptForTask(running.id)).toMatchObject({
      executionAttempt: 1,
      outcome: "accepted",
      providerTaskId: "provider-ledger-match-001",
    });
  } finally {
    store.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("server recovery sweep relaunches stale queued tasks and leaves fresh ones alone", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-queued-sweep-"));
  const store = createGenerationTaskStore(dataDirectory);
  const database = openAppDatabase(dataDirectory);
  try {
    const ownerId = "queued-sweep-owner";
    const providerProfileId = "queued-sweep-relay-provider";
    const modelProfileId = "queued-sweep-image-model";
    const baseline = new Date(Date.now() - 60_000).toISOString();
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, 'Queued Sweep Owner', 'fixture-only', 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, baseline, baseline);
    database.prepare(`
      INSERT INTO provider_profiles (
        id, display_name, driver, status, created_at, updated_at,
        provider_configuration_version
      ) VALUES (?, ?, 'multi-protocol-relay', 'enabled', ?, ?, 1)
    `).run(providerProfileId, "Queued Sweep Relay", baseline, baseline);
    const parameterSchema = knownModelParameterSchema({
      capability: "image",
      providerDriver: "multi-protocol-relay",
      providerModelId: "gemini-3-pro-image-preview",
    });
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency, provider_protocol
      ) VALUES (
        ?, ?, ?, ?, 'image', 'published', ?, ?, ?, 5000000, 'USD', 'media-generate'
      )
    `).run(
      modelProfileId,
      "Queued Sweep Image",
      providerProfileId,
      "gemini-3-pro-image-preview",
      JSON.stringify(parameterSchema),
      baseline,
      baseline,
    );
    database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      ) VALUES ('image', ?, 1, 1, 1, ?, ?)
    `).run(modelProfileId, baseline, baseline);
    bootstrapPublishedModelContracts(database, ownerId);
    database.prepare(`
      UPDATE generation_safety_settings
      SET
        global_enabled = 1,
        emergency_stop = 0,
        per_user_concurrency = 10,
        requests_per_minute = 120,
        image_concurrency = 5,
        video_concurrency = 5,
        audio_concurrency = 5,
        text_concurrency = 5,
        updated_at = ?
      WHERE id = 1
    `).run(baseline);
    const credential = await saveAccountCredential(
      database,
      ownerId,
      providerProfileId,
      "test-only-queued-sweep-key",
    );
    const modelConfiguration = {
      credentialVersion: credential.credentialVersion,
      modelId: modelProfileId,
      modelReleaseRevision: modelContractState(database, modelProfileId).active,
      parameterSchema: modelContractState(database, modelProfileId).active!
        .document.capabilitySchema,
      providerConfigurationVersion: 1,
      providerDriver: "multi-protocol-relay",
      providerModelId: "gemini-3-pro-image-preview",
      providerProfileId,
      providerProtocol: "media-generate",
    };
    const aged = store.admitOrGet({
      canvasId: "queued-sweep-canvas",
      costCurrency: "USD",
      credentialRevision: credential.credentialVersion,
      estimatedCostMicrounits: 5_000_000,
      idempotencyKey: "queued-sweep-aged-1",
      kind: "image",
      model: modelProfileId,
      modelConfiguration,
      nodeId: "queued-sweep-aged-node",
      ownerId,
      parameters: { inputSchemaVersion: 1, inputs: [] },
      prompt: "aged queued task",
      providerModelId: "gemini-3-pro-image-preview",
      providerProfileId,
    });
    const fresh = store.admitOrGet({
      canvasId: "queued-sweep-canvas",
      costCurrency: "USD",
      credentialRevision: credential.credentialVersion,
      estimatedCostMicrounits: 5_000_000,
      idempotencyKey: "queued-sweep-fresh-1",
      kind: "image",
      model: modelProfileId,
      modelConfiguration,
      nodeId: "queued-sweep-fresh-node",
      ownerId,
      parameters: { inputSchemaVersion: 1, inputs: [] },
      prompt: "fresh queued task",
      providerModelId: "gemini-3-pro-image-preview",
      providerProfileId,
    });
    expect(aged.created).toBe(true);
    expect(fresh.created).toBe(true);
    const agedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    const freshAt = new Date().toISOString();
    database.prepare(`
      UPDATE generation_tasks
      SET created_at = ?, updated_at = ?
      WHERE id = ?
    `).run(agedAt, agedAt, aged.task.id);
    database.prepare(`
      UPDATE generation_tasks
      SET created_at = ?, updated_at = ?
      WHERE id = ?
    `).run(agedAt, freshAt, fresh.task.id);

    const launched: string[] = [];
    await runGenerationRecoverySweep({
      launch: (id) => {
        launched.push(id);
        expect(store.transition(id, "running")).toMatchObject({
          attempt: 1,
          state: "running",
        });
        store.transition(id, "failed", {
          code: "TEST_EXECUTION_SETTLED",
          message: "offline recovery launch reached the durable worker state",
        });
      },
      store,
    });
    expect(launched).toEqual([aged.task.id]);
    expect(store.get(aged.task.id)).toMatchObject({
      attempt: 1,
      errorCode: "TEST_EXECUTION_SETTLED",
      state: "failed",
    });
    expect(store.listEvents(aged.task.id).map((event) => event.state)).toEqual([
      "queued",
      "running",
      "failed",
    ]);
    expect(store.get(fresh.task.id)?.state).toBe("queued");
    expect(store.listEvents(fresh.task.id).map((event) => event.state)).toEqual([
      "queued",
    ]);
  } finally {
    database.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("deferred relaunch starts exactly once after the old execution exits", async () => {
  const taskId = "queued-relaunch-race-task";
  const settledExecutions: Promise<void>[] = [];
  let executionCount = 0;
  let releaseFirst!: () => void;
  let reportSecondStarted!: () => void;
  const firstBarrier = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondStarted = new Promise<void>((resolve) => {
    reportSecondStarted = resolve;
  });
  const execute = async () => {
    executionCount += 1;
    if (executionCount === 1) {
      await firstBarrier;
      return;
    }
    reportSecondStarted();
  };

  launchGenerationTaskForRuntimeTest({
    execute,
    kind: "image",
    settledExecutions,
    taskId,
  });
  for (let attempt = 0; attempt < 20 && executionCount === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(executionCount).toBe(1);

  // Repeated retry/recovery signals while the old execution is still present
  // coalesce into one pending relaunch.
  launchGenerationTaskForRuntimeTest({
    execute,
    kind: "image",
    settledExecutions,
    taskId,
  });
  launchGenerationTaskForRuntimeTest({
    execute,
    kind: "image",
    settledExecutions,
    taskId,
  });
  expect(executionCount).toBe(1);

  releaseFirst();
  await secondStarted;
  await Promise.all(settledExecutions);
  expect(executionCount).toBe(2);
});

test("current-state documentation has one recovery authority and matches package version", async () => {
  const [
    agents,
    checkpoint,
    currentState,
    incident,
    matrix,
    packageSource,
    progressiveAudit,
    progressiveCheckpoint,
    progressivePlan,
    readme,
    remediation,
  ] = await Promise.all([
    readFile("AGENTS.md", "utf8"),
    readFile("spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md", "utf8"),
    readFile("spec/UNBOUNDRY_CURRENT_STATE.md", "utf8"),
    readFile(
      "spec/INCIDENT_2026-08-20_TEMPLATE_GROUP_FAILURE_AND_QUEUED_TASK_HANDOFF.md",
      "utf8",
    ),
    readFile("spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md", "utf8"),
    readFile("package.json", "utf8"),
    readFile("spec/UNBOUNDRY_MODULAR_MONOLITH_AUDIT_2026-08-21.md", "utf8"),
    readFile("spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_CHECKPOINT.md", "utf8"),
    readFile("spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md", "utf8"),
    readFile("README.md", "utf8"),
    readFile(
      "spec/UNBOUNDRY_GLOBAL_AUDIT_REMEDIATION_PLAN_2026-08-20.md",
      "utf8",
    ),
  ]);
  const packageDocument = JSON.parse(packageSource) as { version: string };
  const productionMarker = currentState.match(
    /\*\*生产是 v(\d+\.\d+\.\d+) \/ schema(\d+)/,
  );
  const productionVersion = productionMarker?.[1];
  const productionSchemaVersion = productionMarker?.[2];
  expect(productionVersion).toBeTruthy();
  expect(productionSchemaVersion).toBeTruthy();
  const currentVersionMarker = currentState.match(
    /当前治理标记：`(CURRENT_V\d+_\d+_\d+_(?:USER_PASS|USER_RECHECK|USER_REJECTED(?:_[A-Z0-9_]+)?))`/,
  )?.[1];
  expect(currentVersionMarker).toBeTruthy();
  expect(currentState).toContain(`当前代码包版本：**v${packageDocument.version}**`);
  expect(agents).toContain(
    `生产运行\`v${productionVersion}/schema${productionSchemaVersion}\``,
  );
  expect(currentState).toMatch(
    new RegExp(
      `本地候选代码版本：\\*\\*(?:v${packageDocument.version.replaceAll(".", "\\.")}|未指定（package仍为${packageDocument.version.replaceAll(".", "\\.")}，仅本地未发布纠正）)\\*\\*`,
    ),
  );
  const currentVersionPrefix = currentVersionMarker!.match(
    /^CURRENT_V\d+_\d+_\d+/,
  )?.[0];
  expect(currentVersionPrefix).toBeTruthy();
  for (const document of [progressiveAudit, progressiveCheckpoint, progressivePlan]) {
    expect(document).toContain(currentVersionPrefix!);
    expect(document).toContain("只在真实新功能触发");
  }
  expect(readme).toContain(
    "当前版本、未发布工作区、待验收项和下一步只以",
  );
  expect(readme).not.toContain("当前线上 `v");
  expect(checkpoint).toContain("HISTORICAL_CHECKPOINT / APPEND_ONLY");
  expect(matrix).toContain("AUTHORITATIVE_ACCEPTANCE_LEDGER");
  expect(matrix).not.toContain("当前权威状态：生产已运行");
  expect(agents.indexOf("spec/UNBOUNDRY_CURRENT_STATE.md"))
    .toBeLessThan(agents.indexOf("README.md"));
  expect(incident).toContain(
    "spec/UNBOUNDRY_GLOBAL_AUDIT_REMEDIATION_PLAN_2026-08-20.md",
  );
  expect(remediation).toMatch(/状态：`IMPLEMENTED_(?:TARGETED_PASS|AUTO_PASS)/);
  expect([
    agents,
    checkpoint,
    currentState,
    incident,
    matrix,
    readme,
    remediation,
  ].join("\n")).not.toContain("READY_FOR_IMPLEMENTATION / DOCUMENTED_ONLY");
});
