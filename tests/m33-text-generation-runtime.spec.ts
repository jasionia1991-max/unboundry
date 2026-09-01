import { expect, test } from "./safe-test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "../server/database";
import {
  createGenerationTaskStore,
  failRecoveredGenerationTasks,
} from "../server/generationTaskStore";
import { executeTextTaskWithDependencies } from "../server/generationTasks";
import type { TextGenerationProvider } from "../server/generationProvider";
import { TextProviderRegistry } from "../server/providerRegistry";
import type { ProviderProfile } from "../server/providerProfiles";
import {
  createVolcengineArkTextResponse,
  type ArkTextInput,
} from "../server/volcengineArkTextProvider";
import {
  defaultParameterValues,
  knownModelParameterSchema,
  submissionParameterValues,
} from "../types/modelParameters";
import { generationInputKey } from "../client/src/generation/generationRetry";

const profile: ProviderProfile = {
  apiKey: "test-secret-never-returned",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  createdAt: "2026-08-03T00:00:00.000Z",
  driver: "volcengine-ark",
  id: "ark-text-test",
  label: "Ark Text Test",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

type SubmittedGenerationIdentity = {
  fixtureScopeId?: string;
  generationInputKey: string;
  generationOwnershipKey: string;
  modelConfigurationRevision: string;
  modelInputContractFingerprint: string;
  modelReleaseRevision: string;
};

function generationIdentityFromSubmission(value: unknown) {
  const body = value as SubmittedGenerationIdentity;
  return {
    fixtureScopeId: body.fixtureScopeId ?? "",
    generationIdentityVersion: 2 as const,
    generationInputKey: body.generationInputKey,
    generationOwnershipKey: body.generationOwnershipKey,
    modelConfigurationRevision: body.modelConfigurationRevision,
    modelInputContractFingerprint: body.modelInputContractFingerprint,
    modelReleaseRevision: body.modelReleaseRevision,
  };
}

function completedResponse(
  text = "识别结果：红色连衣裙",
  id = "resp_m33-completed",
) {
  return new Response(JSON.stringify({
    id,
    output: [{
      content: [{ text, type: "output_text" }],
      status: "completed",
      type: "message",
    }],
    status: "completed",
    usage: { input_tokens: 120, output_tokens: 18, total_tokens: 138 },
  }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

test("Ark Responses serializes ordered Text/Image/Video/Audio content with fake fetch", async () => {
  const image = `data:image/png;base64,${Buffer.from("fake-png").toString("base64")}`;
  const audio = `data:audio/mp3;base64,${Buffer.from("ID3-fake-audio").toString("base64")}`;
  const inputs: ArkTextInput[] = [
    {
      kind: "audio",
      order: 4,
      role: "context-audio",
      url: audio,
    },
    {
      kind: "video",
      order: 3,
      role: "context-video",
      url: "https://signed.example.test/context.mp4?expires=300",
    },
    {
      kind: "image",
      order: 2,
      role: "context-image",
      url: image,
    },
    {
      kind: "text",
      order: 1,
      role: "context-text",
      text: "上游商品背景说明",
    },
  ];
  let calls = 0;
  let requestUrl = "";
  let request: RequestInit | undefined;
  const result = await createVolcengineArkTextResponse(
    profile,
    {
      inputs,
      model: "doubao-seed-2-0-lite-260428",
      prompt: "根据所有上下文生成商品描述",
      thinkingLevel: "medium",
    },
    async (input, init) => {
      calls += 1;
      requestUrl = String(input);
      request = init;
      return completedResponse();
    },
  );

  expect(calls).toBe(1);
  expect(requestUrl).toBe("https://ark.cn-beijing.volces.com/api/v3/responses");
  expect(new Headers(request?.headers).get("Authorization"))
    .toBe(`Bearer ${profile.apiKey}`);
  expect(JSON.parse(String(request?.body))).toEqual({
    input: [{
      content: [
        { text: "根据所有上下文生成商品描述", type: "input_text" },
        { text: "上游商品背景说明", type: "input_text" },
        { image_url: image, type: "input_image" },
        {
          type: "input_video",
          video_url: "https://signed.example.test/context.mp4?expires=300",
        },
        { audio_url: audio, type: "input_audio" },
      ],
      role: "user",
    }],
    model: "doubao-seed-2-0-lite-260428",
    store: true,
    thinking: { type: "enabled" },
  });
  expect(result).toEqual({
    providerResponseId: "resp_m33-completed",
    providerUsageTokens: 138,
    text: "识别结果：红色连衣裙",
  });
});

test("Ark text rejects unsafe context before fake fetch and maps safe Provider errors", async () => {
  let calls = 0;
  await expect(createVolcengineArkTextResponse(
    profile,
    {
      inputs: [{
        kind: "video",
        order: 1,
        role: "context-video",
        url: "http://127.0.0.1/private.mp4",
      }],
      model: "doubao-seed-2-0-lite-260428",
      prompt: "分析视频",
    },
    async () => {
      calls += 1;
      return completedResponse();
    },
  )).rejects.toMatchObject({ code: "FORMAT" });
  expect(calls).toBe(0);

  await expect(createVolcengineArkTextResponse(
    profile,
    {
      model: "doubao-seed-2-0-lite-260428",
      prompt: "测试限流",
      thinkingLevel: "minimal",
    },
    async () => {
      calls += 1;
      return new Response("{}", { status: 429 });
    },
  )).rejects.toMatchObject({
    code: "RATE_LIMIT",
    message: "火山方舟正在限流，请稍后再试",
  });
  expect(calls).toBe(1);
});

test("Text Provider registry injects a fake port with zero network and rejects missing implementations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-text-registry-"));
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 321_000,
      idempotencyKey: "text-registry-fake-001",
      kind: "text",
      model: "model-text-registry-fake",
      nodeId: "text-registry-target",
      ownerId: "__test__",
      parameters: { outputCount: 1, responseFormat: "text" },
      prompt: "通过端口生成",
      providerModelId: "fake-text-model",
      providerProfileId: profile.id,
    });
    let fakeProviderCalls = 0;
    let networkCalls = 0;
    const fakeProvider: TextGenerationProvider = {
      id: "fake-text-provider",
      registrations: [{ driver: "volcengine-ark", protocol: "native" }],
      async generate(request, execution) {
        fakeProviderCalls += 1;
        expect(execution.profile.id).toBe(profile.id);
        expect(request).toMatchObject({
          inputs: [],
          model: "fake-text-model",
          prompt: "通过端口生成",
          protocol: "native",
        });
        execution.beforeProviderRequest();
        return { providerUsageTokens: 17, text: "端口返回结果" };
      },
    };
    await executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: async () => ({ profile, release() {} }),
      fetcher: async () => {
        networkCalls += 1;
        throw new Error("fake port must not use network");
      },
      mediaUrlForOwner: async () => "https://unused.example.test",
      store,
      textProviderRegistry: new TextProviderRegistry([fakeProvider]),
    });

    expect(fakeProviderCalls).toBe(1);
    expect(networkCalls).toBe(0);
    expect(store.get(created.task.id)).toMatchObject({
      providerUsageTokens: 17,
      resultText: "端口返回结果",
      state: "success",
    });
    const attemptsDatabase = openAppDatabase(directory);
    try {
      const attempts = attemptsDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts
        WHERE task_id = ? AND evidence = 'provider-boundary'
      `).get(created.task.id) as { count: number };
      expect(Number(attempts.count)).toBe(1);
    } finally {
      attemptsDatabase.close();
    }

    const unsupportedProfile: ProviderProfile = {
      ...profile,
      driver: "openrouter",
      id: "unsupported-text-profile",
    };
    expect(() =>
      new TextProviderRegistry([fakeProvider]).generate(
        unsupportedProfile,
        {
          inputs: [],
          model: "fake-text-model",
          prompt: "不得发请求",
          protocol: "native",
        },
        {
          beforeProviderRequest() {},
          fetcher: async () => {
            networkCalls += 1;
            throw new Error("missing implementation must not use network");
          },
          releaseProviderLease() {},
        },
      )
    ).toThrow(/文字模型配置已失效/);
    expect(() =>
      new TextProviderRegistry([fakeProvider]).generate(
        unsupportedProfile,
        {
          inputs: [],
          model: "fake-text-model",
          prompt: "不得发请求",
          protocol: "openai-chat",
        },
        {
          beforeProviderRequest() {},
          fetcher: async () => {
            networkCalls += 1;
            throw new Error("missing relay implementation must not use network");
          },
          releaseProviderLease() {},
        },
      )
    ).toThrow(/中转站请求或响应格式无法安全识别/);
    expect(networkCalls).toBe(0);
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("Ark Text recovers the stored original response by GET without a second paid submit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-text-stored-recovery-"));
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 500_000,
      idempotencyKey: "text-stored-response-recovery-001",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-stored-response-target",
      ownerId: "__test__",
      parameters: { outputCount: 1, responseFormat: "text" },
      prompt: "只恢复原始响应",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: profile.id,
    });
    let submitCalls = 0;
    const interruptedProvider: TextGenerationProvider = {
      id: "fake-interrupted-ark-text",
      registrations: [{ driver: "volcengine-ark", protocol: "native" }],
      async generate(_request, execution) {
        submitCalls += 1;
        execution.beforeProviderRequest();
        execution.acceptProviderTaskId?.("resp_m33-recovery");
        throw new Error("simulated crash after durable response id");
      },
    };
    await executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: async () => ({ profile, release() {} }),
      fetcher: async () => {
        throw new Error("initial fake Provider must not use network");
      },
      mediaUrlForOwner: async () => "https://unused.example.test",
      store,
      textProviderRegistry: new TextProviderRegistry([interruptedProvider]),
    });
    expect(store.get(created.task.id)).toMatchObject({
      attempt: 1,
      errorCode: "AUTOMATIC_RESULT_RECOVERY",
      providerTaskId: "resp_m33-recovery",
      state: "recovering",
    });

    store.resume(created.task.id);
    const requests: Array<{ method: string; url: string }> = [];
    await executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: async () => ({ profile, release() {} }),
      fetcher: async (input, init) => {
        requests.push({ method: init?.method ?? "GET", url: String(input) });
        return completedResponse("原响应恢复成功", "resp_m33-recovery");
      },
      mediaUrlForOwner: async () => "https://unused.example.test",
      store,
    });
    expect(submitCalls).toBe(1);
    expect(requests).toEqual([{
      method: "GET",
      url: "https://ark.cn-beijing.volces.com/api/v3/responses/resp_m33-recovery",
    }]);
    expect(store.get(created.task.id)).toMatchObject({
      attempt: 1,
      providerTaskId: "resp_m33-recovery",
      resultText: "原响应恢复成功",
      state: "success",
    });
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("schema 14 Text tasks persist resultText, usage, events and conservative cost", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-text-task-"));
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 500_000,
      idempotencyKey: "text-result-idempotency-001",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-target-001",
      ownerId: "__test__",
      parameters: { outputCount: 1, responseFormat: "text" },
      prompt: "生成商品描述",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: "ark-text-test",
    });
    store.transition(created.task.id, "running");
    const completed = store.complete(created.task.id, {
      actualCostMicrounits: 500_000,
      providerUsageTokens: 138,
      resultText: "一件适合春季通勤的红色连衣裙",
    });
    expect(completed).toMatchObject({
      actualCostMicrounits: 500_000,
      attempt: 1,
      kind: "text",
      providerUsageTokens: 138,
      resultText: "一件适合春季通勤的红色连衣裙",
      state: "success",
    });
    expect(store.listEvents(created.task.id).map(({ state }) => state))
      .toEqual(["queued", "running", "success"]);
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("Image to Text execution materializes four durable inputs only at fake Provider time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-text-execution-"));
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 750_000,
      idempotencyKey: "text-four-inputs-001",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-target-002",
      ownerId: "__test__",
      parameters: {
        inputs: [
          {
            kind: "text",
            order: 1,
            role: "context-text",
            sourceNodeId: "upstream-text",
            text: "白底商品图",
          },
          {
            assetId: "dress.png",
            kind: "image",
            order: 2,
            role: "context-image",
            sourceNodeId: "upstream-image",
          },
          {
            assetId: "walk.mp4",
            kind: "video",
            order: 3,
            role: "context-video",
            sourceNodeId: "upstream-video",
          },
          {
            assetId: "voice.mp3",
            kind: "audio",
            order: 4,
            role: "context-audio",
            sourceNodeId: "upstream-audio",
          },
        ],
        outputCount: 1,
        responseFormat: "text",
        thinkingLevel: "minimal",
      },
      prompt: "识别素材并给出商品卖点",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: profile.id,
    });
    const mediaCalls: string[] = [];
    let providerCalls = 0;
    let providerBody = "";
    await executeTextTaskWithDependencies(created.task.id, {
      fetcher: async (_input, init) => {
        providerCalls += 1;
        providerBody = String(init?.body ?? "");
        return completedResponse("红色圆领连衣裙，适合通勤场景");
      },
      acquireProfile: async () => ({ profile, release() {} }),
      mediaUrlForOwner: async (input) => {
        expect(input.ownerId).toBe("__test__");
        mediaCalls.push(`${input.kind}:${input.assetId}`);
        if (input.kind === "image") {
          return `data:image/png;base64,${Buffer.from("image").toString("base64")}`;
        }
        if (input.kind === "audio") {
          return `data:audio/mp3;base64,${Buffer.from("audio").toString("base64")}`;
        }
        return "https://signed.example.test/walk.mp4?expires=300";
      },
      store,
    });

    expect(providerCalls).toBe(1);
    expect(mediaCalls).toEqual([
      "image:dress.png",
      "video:walk.mp4",
      "audio:voice.mp3",
    ]);
    const parsedProviderBody = JSON.parse(providerBody) as {
      input: Array<{ content: Array<{ type: string }> }>;
      thinking: { type: string };
    };
    expect(parsedProviderBody.input[0].content.map(
      (item: { type: string }) => item.type,
    )).toEqual([
      "input_text",
      "input_text",
      "input_image",
      "input_video",
      "input_audio",
    ]);
    expect(parsedProviderBody.thinking).toEqual({ type: "disabled" });
    expect(JSON.stringify(store.get(created.task.id)?.parameters))
      .not.toContain("signed.example.test");
    expect(store.get(created.task.id)).toMatchObject({
      actualCostMicrounits: 750_000,
      attempt: 1,
      providerUsageTokens: 138,
      resultText: "红色圆领连衣裙，适合通勤场景",
      state: "success",
    });
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("Text failure retries once with the same task and restart fails without resubmission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-text-retry-"));
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 900_000,
      idempotencyKey: "text-retry-idempotency-001",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-target-retry",
      ownerId: "__test__",
      parameters: { outputCount: 1, responseFormat: "text" },
      prompt: "第一次失败后重试",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: profile.id,
    });
    let providerCalls = 0;
    const dependencies = {
      fetcher: async () => {
        providerCalls += 1;
        return providerCalls === 1
          ? new Response("{}", { status: 429 })
          : completedResponse("重试成功");
      },
      acquireProfile: async () => ({ profile, release() {} }),
      mediaUrlForOwner: async () => "https://signed.example.test/unused",
      store,
    };
    await executeTextTaskWithDependencies(created.task.id, dependencies);
    expect(store.get(created.task.id)).toMatchObject({
      attempt: 1,
      errorCode: "RATE_LIMIT",
      state: "failed",
    });
    store.transition(created.task.id, "retrying");
    store.transition(created.task.id, "queued");
    await executeTextTaskWithDependencies(created.task.id, dependencies);
    expect(providerCalls).toBe(2);
    expect(store.get(created.task.id)).toMatchObject({
      actualCostMicrounits: 900_000,
      attempt: 2,
      resultText: "重试成功",
      state: "success",
    });
    const attemptDatabase = openAppDatabase(directory);
    try {
      const providerAttempts = attemptDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts
        WHERE task_id = ? AND evidence = 'provider-boundary'
      `).get(created.task.id) as { count: number };
      expect(Number(providerAttempts.count)).toBe(2);
    } finally {
      attemptDatabase.close();
    }

    const localFailure = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 900_000,
      idempotencyKey: "text-local-preflight-failure-001",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-local-preflight-failure",
      ownerId: "__test__",
      parameters: {
        inputs: [{
          kind: "image",
          order: 1,
          role: "wrong-role",
          sourceNodeId: "image-source",
        }],
        outputCount: 1,
        responseFormat: "text",
      },
      prompt: "本地快照校验失败不应计费",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: profile.id,
    });
    await executeTextTaskWithDependencies(localFailure.task.id, dependencies);
    expect(providerCalls).toBe(2);
    expect(store.get(localFailure.task.id)).toMatchObject({
      attempt: 1,
      errorCode: "FORMAT",
      state: "failed",
    });
    const localFailureDatabase = openAppDatabase(directory);
    try {
      const providerAttempts = localFailureDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts
        WHERE task_id = ?
      `).get(localFailure.task.id) as { count: number };
      expect(Number(providerAttempts.count)).toBe(0);
    } finally {
      localFailureDatabase.close();
    }

    const interrupted = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 900_000,
      idempotencyKey: "text-restart-idempotency-001",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-target-restart",
      ownerId: "__test__",
      parameters: { outputCount: 1, responseFormat: "text" },
      prompt: "服务重启不应自动重提",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: profile.id,
    });
    store.transition(interrupted.task.id, "running");
    store.close();

    const reopened = createGenerationTaskStore(directory);
    expect(reopened.get(interrupted.task.id)?.state).toBe("recovering");
    expect(failRecoveredGenerationTasks(reopened)).toMatchObject([{
      errorCode: "SERVICE_RESTARTED",
      id: interrupted.task.id,
      state: "failed",
    }]);
    expect(providerCalls).toBe(2);
    reopened.transition(interrupted.task.id, "retrying");
    expect(reopened.transition(interrupted.task.id, "queued"))
      .toMatchObject({ state: "queued" });
    reopened.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a persisted pending Text task replaces old content after refresh without a Provider request", async ({
  page,
  request,
}) => {
  const existingResponse = await request.get("/api/canvas/default");
  const existingCanvas = existingResponse.ok()
    ? await existingResponse.json() as {
        edges: unknown[];
        nodes: unknown[];
        viewport: { x: number; y: number; zoom: number };
      }
    : undefined;
  const modelId = "model-text-ui-refresh-test";
  const configurationRevision = "a03300000000000000000001";
  const releaseRevisionId = "a0330000-0000-4000-8000-000000000001";
  const parameterSchema = knownModelParameterSchema({
    capability: "text",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
  });
  expect(parameterSchema).toBeTruthy();
  let afterReload = false;
  let providerRequests = 0;
  let taskSubmissions = 0;
  let taskIdentity: ReturnType<typeof generationIdentityFromSubmission> | undefined;

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        models: [{
          capability: "text",
          configurationRevision,
          displayName: "Doubao Seed 2.0 Lite 刷新测试",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelId,
          isDefault: true,
          parameterSchema,
          releaseRevisionId,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const method = route.request().method();
    const baseTask = {
      ...taskIdentity,
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-03T00:00:00.000Z",
      id: "text-ui-refresh-001",
      kind: "text",
      model: modelId,
      nodeId: "text-refresh-target",
      prompt: "请生成新的商品描述",
      updatedAt: "2026-08-03T00:00:01.000Z",
    };
    if (requestUrl.pathname.endsWith("/status")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
          textProviderConfigured: true,
          textSubmissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (requestUrl.pathname.endsWith("/preflight") && method === "POST") {
      await route.fulfill({
        contentType: "application/json",
        json: { canEnqueue: true, canSubmit: true, canvasRevision: route.request().postDataJSON().canvasRevision, problems: [] },
        status: 200,
      });
      return;
    }
    if (requestUrl.pathname === "/api/generation-tasks" && method === "POST") {
      taskSubmissions += 1;
      taskIdentity = generationIdentityFromSubmission(route.request().postDataJSON());
      await route.fulfill({
        contentType: "application/json",
        json: { ...baseTask, ...taskIdentity, state: "queued" },
        status: 202,
      });
      return;
    }
    if (
      requestUrl.pathname === "/api/generation-tasks/text-ui-refresh-001" &&
      method === "GET"
    ) {
      await route.fulfill({
        contentType: "application/json",
        json: afterReload
          ? {
              ...baseTask,
              resultText: "刷新恢复的新商品描述",
              state: "success",
            }
          : { ...baseTask, state: "running" },
        status: 200,
      });
      return;
    }
    if (requestUrl.pathname === "/api/generation-tasks" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [] },
        status: 200,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { error: "Unexpected fake task route" },
      status: 404,
    });
  });

  try {
    await request.delete("/api/canvas/default");
    const saved = await request.put("/api/canvas/default", {
      data: {
        edges: [{
          data: { inputOrder: 1, inputRole: "instruction" },
          id: "edge-text-refresh-to-image",
          source: "text-refresh-target",
          sourceHandle: "source",
          target: "image-refresh-downstream",
          targetHandle: "target",
          type: "cuttable",
        }],
        nodes: [
          {
            data: {
              content: "生成前的旧内容",
              contentHtml: "<p>生成前的旧内容</p>",
              label: "Text",
              textModelId: modelId,
              textParameters: defaultParameterValues(parameterSchema!),
              textPrompt: "请生成新的商品描述",
              title: "刷新恢复目标",
            },
            id: "text-refresh-target",
            position: { x: 180, y: 260 },
            selected: true,
            style: { height: 250, width: 250 },
            type: "text",
          },
          {
            data: {
              imagePrompt: "",
              imagePromptReady: true,
              label: "Image",
              title: "下游图片",
            },
            id: "image-refresh-downstream",
            position: { x: 690, y: 260 },
            selected: false,
            style: { height: 250, width: 250 },
            type: "image",
          },
        ],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.getByTestId("text-node-editor"))
      .toContainText("生成前的旧内容");
    await page.getByTestId("rf__node-image-refresh-downstream").click();
    const downstreamCard = page.getByTestId("image-creator-references")
      .getByTestId("upstream-input-text-refresh-target");
    await expect(downstreamCard).toHaveAttribute("data-input-state", "ready");
    await page.getByTestId("rf__node-text-refresh-target").click();
    await page.getByTestId("text-creator")
      .getByRole("button", { name: "Generate" })
      .click();
    await page.getByTestId("rf__node-image-refresh-downstream").click();
    // Pending replacement preserves the last durable Text content downstream.
    await expect(downstreamCard)
      .toHaveAttribute("data-input-state", "ready");
    await expect.poll(async () => {
      const response = await request.get("/api/canvas/default");
      if (!response.ok()) return undefined;
      const canvas = await response.json() as {
        nodes: Array<{ data?: Record<string, unknown>; id: string }>;
      };
      return canvas.nodes.find(({ id }) => id === "text-refresh-target")?.data;
    }).toMatchObject({
      content: "生成前的旧内容",
      textGenerating: true,
      textGenerationTaskId: "text-ui-refresh-001",
    });

    afterReload = true;
    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.getByTestId("text-node-editor"))
      .toContainText("刷新恢复的新商品描述");
    await expect(page.getByTestId("text-node-editor"))
      .not.toContainText("生成前的旧内容");
    const restoredDownstreamCards = page.getByTestId("image-creator-references")
      .locator('[data-testid="upstream-input-text-refresh-target"]');
    await expect(restoredDownstreamCards).toHaveCount(1);
    await expect(restoredDownstreamCards)
      .toHaveAttribute("data-input-state", "ready");
    await restoredDownstreamCards
      .getByRole("button", { name: "查看引用 刷新恢复目标" })
      .click();
    await expect(page.getByRole("dialog", { name: "刷新恢复目标引用详情" }))
      .toContainText("刷新恢复的新商品描述");
    await expect.poll(async () => {
      const response = await request.get("/api/canvas/default");
      if (!response.ok()) return undefined;
      const canvas = await response.json() as {
        nodes: Array<{ data?: Record<string, unknown>; id: string }>;
      };
      return canvas.nodes.find(({ id }) => id === "text-refresh-target")?.data;
    }).toMatchObject({
      content: "刷新恢复的新商品描述",
      contentHtml: "<p>刷新恢复的新商品描述</p>",
      textGenerating: false,
      textGenerationTaskId: "text-ui-refresh-001",
    });
    expect(taskSubmissions).toBe(1);
    expect(providerRequests).toBe(0);
  } finally {
    await request.delete("/api/canvas/default");
    if (existingCanvas) {
      await request.put("/api/canvas/default", {
        data: { ...existingCanvas, revision: 0 },
      });
    }
  }
});

test("Text failure stays visible, refreshes, and retries the same task until input changes", async ({
  page,
  request,
}) => {
  const existingResponse = await request.get("/api/canvas/default");
  const existingCanvas = existingResponse.ok()
    ? await existingResponse.json() as {
        edges: unknown[];
        nodes: unknown[];
        viewport: { x: number; y: number; zoom: number };
      }
    : undefined;
  const modelId = "model-text-ui-failure-test";
  const configurationRevision = "a03300000000000000000002";
  const releaseRevisionId = "a0330000-0000-4000-8000-000000000002";
  const nodeId = "text-ui-failure-target";
  const parameterSchema = knownModelParameterSchema({
    capability: "text",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
  });
  expect(parameterSchema).toBeTruthy();
  const defaultParameters = defaultParameterValues(parameterSchema!);
  let currentTaskId = "text-ui-failure-001";
  let providerRequests = 0;
  let taskRetries = 0;
  let taskSubmissions = 0;
  let taskIdentity: ReturnType<typeof generationIdentityFromSubmission> | undefined;

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        models: [{
          capability: "text",
          configurationRevision,
          displayName: "Doubao Seed 失败恢复测试",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelId,
          isDefault: true,
          parameterSchema,
          releaseRevisionId,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const task = (id: string, state: "failed" | "queued") => ({
      ...taskIdentity,
      attempt: state === "failed" ? 1 : 0,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-03T04:00:00.000Z",
      ...(state === "failed"
        ? { errorCode: "AUTH", errorMessage: "零Provider模拟授权失败" }
        : {}),
      id,
      kind: "text",
      model: modelId,
      nodeId,
      prompt: "请生成商品描述",
      retryAllowed: state === "failed",
      state,
      updatedAt: "2026-08-03T04:00:01.000Z",
    });
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
          textProviderConfigured: true,
          textSubmissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/preflight") && method === "POST") {
      await route.fulfill({
        contentType: "application/json",
        json: { canEnqueue: true, canSubmit: true, canvasRevision: route.request().postDataJSON().canvasRevision, problems: [] },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/retry") && method === "POST") {
      taskRetries += 1;
      await route.fulfill({
        contentType: "application/json",
        json: task(currentTaskId, "queued"),
        status: 202,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "POST") {
      taskSubmissions += 1;
      currentTaskId = `text-ui-failure-00${taskSubmissions}`;
      taskIdentity = generationIdentityFromSubmission(route.request().postDataJSON());
      await route.fulfill({
        contentType: "application/json",
        json: task(currentTaskId, "queued"),
        status: 202,
      });
      return;
    }
    if (
      url.pathname.startsWith("/api/generation-tasks/text-ui-failure-") &&
      method === "GET"
    ) {
      await route.fulfill({
        contentType: "application/json",
        json: task(url.pathname.split("/").at(-1)!, "failed"),
        status: 200,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [] },
        status: 200,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { error: "Unexpected fake task route" },
      status: 404,
    });
  });

  try {
    await request.delete("/api/canvas/default");
    const saved = await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          data: {
            content: "",
            label: "Text",
            textModelId: modelId,
            textParameters: defaultParameters,
            textPrompt: "请生成商品描述",
            title: "失败恢复目标",
          },
          id: nodeId,
          position: { x: 360, y: 260 },
          selected: true,
          style: { height: 250, width: 250 },
          type: "text",
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await page.getByTestId(`rf__node-${nodeId}`).click();
    const creator = page.getByTestId("text-creator");
    await creator.getByRole("button", { name: "Generate" }).click();
    await expect(creator.getByTestId("upstream-input-problem"))
      .toContainText("生成失败：当前平台连接没有该模型的使用权限");
    await expect(creator.getByRole("button", { name: "Retry generation" }))
      .toBeEnabled();
    await expect.poll(async () => {
      const canvas = await (await request.get("/api/canvas/default")).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      return canvas.nodes.find((node) => node.id === nodeId)?.data;
    }).toMatchObject({
      textGenerating: false,
      textGenerationError: "当前平台连接没有该模型的使用权限",
      textGenerationErrorCode: "AUTH",
      textGenerationTaskId: "text-ui-failure-001",
    });
    expect(taskSubmissions).toBe(1);

    await creator.getByRole("button", { name: "Retry generation" }).click();
    await expect.poll(() => taskRetries).toBe(1);
    await expect(creator.getByTestId("upstream-input-problem"))
      .toContainText("点击右侧按钮重试原任务");
    expect(taskSubmissions).toBe(1);

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await page.getByTestId(`rf__node-${nodeId}`).click();
    const restoredCreator = page.getByTestId("text-creator");
    await expect(restoredCreator.getByTestId("upstream-input-problem"))
      .toContainText("当前平台连接没有该模型的使用权限");
    await expect(restoredCreator.getByRole("button", { name: "Retry generation" }))
      .toBeEnabled();
    expect(taskSubmissions).toBe(1);

    await restoredCreator.getByTestId("text-creator-prompt")
      .fill("请生成修改后的商品描述");
    await expect(restoredCreator.getByRole("button", { name: "Generate" }))
      .toBeEnabled();
    await expect.poll(async () => {
      const canvas = await (await request.get("/api/canvas/default")).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
      return Boolean(
        node?.data.textGenerationTaskId || node?.data.textGenerationError,
      );
    }).toBe(false);
    await restoredCreator.getByRole("button", { name: "Generate" }).click();
    await expect.poll(() => taskSubmissions).toBe(2);
    expect(taskRetries).toBe(1);
    expect(providerRequests).toBe(0);
  } finally {
    await request.delete("/api/canvas/default");
    if (existingCanvas) {
      await request.put("/api/canvas/default", {
        data: { ...existingCanvas, revision: 0 },
      });
    }
  }
});
