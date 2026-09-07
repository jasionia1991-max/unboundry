import {
  expect,
  test as safeTest,
  type APIRequestContext,
  type Page,
} from "./safe-test";
import {
  defaultParameterValues,
  knownModelParameterSchema,
  submissionParameterValues,
  type ModelCapability,
  type ModelParameterValue,
} from "../types/modelParameters";
import { generationInputKey } from
  "../client/src/generation/generationRetry";
import {
  GenerationRequestError,
  getGenerationTaskByIdempotency,
  listGenerationTasks,
  waitForGenerationTask,
  type GenerationTaskSummary,
} from "../client/src/generation/generationTasks";
import {
  POLLING_PAUSED_MESSAGE,
  waitForGenerationTaskWithPause,
  workflowBlocksSingleNodeRecovery,
} from "../client/src/generation/taskPolling";
import { resolveNodeInputs } from "../types/nodeInputs";
import { currentWorkflowGenerationBinding } from
  "../client/src/generation/workflowNodeExecutors";

const modelInputs = {
  audio: {
    configurationRevision: "a04100000000000000000001",
    id: "retry-ui-audio-model",
    providerDriver: "mureka",
    providerModelId: "mureka-9",
    releaseRevisionId: "a0410000-0000-4000-8000-000000000001",
  },
  image: {
    configurationRevision: "a04100000000000000000002",
    id: "retry-ui-image-model",
    providerDriver: "openrouter",
    providerModelId: "openai/gpt-image-2",
    releaseRevisionId: "a0410000-0000-4000-8000-000000000002",
  },
  text: {
    configurationRevision: "a04100000000000000000003",
    id: "retry-ui-text-model",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
    releaseRevisionId: "a0410000-0000-4000-8000-000000000003",
  },
  video: {
    configurationRevision: "a04100000000000000000004",
    id: "retry-ui-video-model",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
    releaseRevisionId: "a0410000-0000-4000-8000-000000000004",
  },
} as const;

const kinds = ["text", "image", "video", "audio"] as const;
type Kind = (typeof kinds)[number];

function safeCanvasFixtureRequest(request: APIRequestContext) {
  return new Proxy(request, {
    get(target, property) {
      if (property === "put") {
        return (
          url: Parameters<APIRequestContext["put"]>[0],
          options: Parameters<APIRequestContext["put"]>[1] = {},
        ) => {
          const pathname = new URL(String(url), "http://safe.invalid").pathname;
          const match = /^\/api\/canvas\/([^/]+)$/.exec(pathname);
          if (!match) return target.put(url, options);
          const canvasId = decodeURIComponent(match[1]);
          return target.put(url, {
            ...options,
            headers: {
              ...options.headers,
              "X-Unboundry-Safe-Fixture-Seed": canvasId,
            },
          });
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// Direct Canvas PUTs in this spec create synthetic server-owned recovery state.
// Keep that capability local to the safe runner instead of weakening the
// production legacy PUT boundary.
const test = safeTest.extend({
  request: async ({ request }, use) => {
    await use(safeCanvasFixtureRequest(request));
  },
});

test("an active server workflow blocks stale single-node recovery before its run id is projected", () => {
  expect(workflowBlocksSingleNodeRecovery({
    locked: true,
  })).toBe(true);
  expect(workflowBlocksSingleNodeRecovery({
    locked: false,
    workflowExecutionRunId: "server-run",
  })).toBe(true);
  expect(workflowBlocksSingleNodeRecovery({
    locked: false,
  })).toBe(false);
});

type SubmittedGenerationIdentity = {
  fixtureScopeId?: string;
  generationIdentityVersion: 2;
  generationInputKey: string;
  generationOwnershipKey: string;
  modelConfigurationRevision: string;
  modelInputContractFingerprint: string;
  modelReleaseRevision: string;
};

function submittedGenerationIdentity(body: SubmittedGenerationIdentity) {
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

const schemas = Object.fromEntries(
  Object.entries(modelInputs).map(([capability, model]) => [
    capability,
    knownModelParameterSchema({
      capability: capability as ModelCapability,
      providerDriver: model.providerDriver,
      providerModelId: model.providerModelId,
    }),
  ]),
) as Record<ModelCapability, ReturnType<typeof knownModelParameterSchema>>;

function nodeId(kind: Kind) {
  return `retry-ui-${kind}`;
}

function mediaAssetUrl(
  kind: Exclude<Kind, "text">,
  assetId: string,
) {
  return kind === "image"
    ? `/api/assets/${assetId}`
    : kind === "video"
      ? `/api/video-assets/${assetId}`
      : `/api/audio-assets/${assetId}`;
}

function stableSubmissionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSubmissionValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "canvasRevision" && key !== "idempotencyKey")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableSubmissionValue(item)]),
    );
  }
  return value;
}

function recoveryRequestSignature(kind: Kind) {
  const prompt = `${kind} 原始提示词`;
  const submittedParameters = submissionParameterValues(
    schemas[kind],
    defaultParameterValues(schemas[kind]),
  );
  const source = JSON.stringify(stableSubmissionValue({
    canvasId: "default",
    inputSchemaVersion: 1,
    inputs: [],
    kind,
    model: modelInputs[kind].id,
    nodeId: nodeId(kind),
    ownPrompt: prompt,
    parameters: kind === "image"
      ? { ...submittedParameters, references: [] }
      : submittedParameters,
    prompt,
  }));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const value = source.charCodeAt(index);
    left = Math.imul(left ^ value, 0x01000193) >>> 0;
    right = Math.imul(right ^ value, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}

function compactGenerationOwnershipKey(value: unknown) {
  const source = JSON.stringify(stableSubmissionValue(value));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}

function recoveryOwnershipKey(
  kind: Kind,
  prompt = `${kind} 原始提示词`,
) {
  const binding = currentLegacyBinding(kind);
  return compactGenerationOwnershipKey({
    ...(kind === "image"
      ? { aspectRatio: undefined, quality: undefined }
      : {}),
    contractFingerprint: binding.inputContractFingerprint,
    modelConfigurationRevision: binding.modelConfigurationRevision,
    modelId: modelInputs[kind].id,
    modelReleaseRevision: binding.modelReleaseRevision,
    parameters: defaultParameterValues(schemas[kind]),
    prompt,
    upstream: [],
  });
}

function recoveryInputKey(
  kind: Kind,
  prompt = `${kind} 原始提示词`,
) {
  return generationInputKey({
    inputs: [],
    modelConfigurationRevision: modelInputs[kind].configurationRevision,
    modelId: modelInputs[kind].id,
    modelReleaseRevision: modelInputs[kind].releaseRevisionId,
    ownPrompt: prompt,
    parameters: submissionParameterValues(
      schemas[kind],
      defaultParameterValues(schemas[kind]),
    ),
    prompt,
  });
}

function generationNodeIdentityData(
  kind: Kind,
  identity: SubmittedGenerationIdentity,
) {
  return {
    ...(kind === "video"
      ? {
          videoGenerationModelInputContractFingerprint:
            identity.modelInputContractFingerprint,
        }
      : {
          [`${kind}GenerationContractFingerprint`]:
            identity.modelInputContractFingerprint,
        }),
    [`${kind}GenerationInputKey`]: identity.generationInputKey,
    [`${kind}GenerationModelConfigurationRevision`]:
      identity.modelConfigurationRevision,
    [`${kind}GenerationModelReleaseRevision`]: identity.modelReleaseRevision,
    [`${kind}GenerationOwnershipKey`]: identity.generationOwnershipKey,
  };
}

function authoritativeGenerationBindingData(
  kind: Kind,
  task: GenerationTaskSummary,
) {
  return {
    ...generationNodeIdentityData(
      kind,
      task as SubmittedGenerationIdentity,
    ),
    [`${kind}GenerationTaskId`]: task.id,
  };
}

function authoritativeGenerationSuccessData(
  kind: Kind,
  task: GenerationTaskSummary,
) {
  const common = {
    [`${kind}Generating`]: false,
    [`${kind}GenerationError`]: undefined,
    [`${kind}GenerationErrorCode`]: undefined,
    [`${kind}GenerationInputKey`]: undefined,
    [`${kind}GenerationModelConfigurationRevision`]:
      task.modelConfigurationRevision,
    [`${kind}GenerationModelReleaseRevision`]: task.modelReleaseRevision,
    [`${kind}GenerationOwnershipKey`]: undefined,
    [`${kind}GenerationRetryAllowed`]: undefined,
    [`${kind}GenerationRetryBlockCode`]: undefined,
    [`${kind}GenerationRetryBlockReason`]: undefined,
    [`${kind}GenerationTaskId`]: kind === "text" ? task.id : undefined,
    groupRunSuccessInputFingerprint: task.generationInputKey,
    groupRunSuccessModelConfigurationRevision:
      task.modelConfigurationRevision,
    groupRunSuccessModelReleaseRevision: task.modelReleaseRevision,
    groupRunSuccessOwnershipKey: task.generationOwnershipKey,
    groupRunSuccessResultKey: kind === "text"
      ? JSON.stringify({
          content: task.resultText ?? "",
          contentHtml: `<p>${task.resultText ?? ""}</p>`,
        })
      : task.resultUrl,
    groupRunSuccessTaskId: task.id,
    workflowExecutionRunId: undefined,
    ...(kind === "video"
      ? {
          videoGenerationModelInputContractFingerprint:
            task.modelInputContractFingerprint,
        }
      : {
          [`${kind}GenerationContractFingerprint`]:
            task.modelInputContractFingerprint,
        }),
  } as Record<string, unknown>;
  if (kind === "text") {
    return {
      ...common,
      content: task.resultText ?? "",
      contentHtml: `<p>${task.resultText ?? ""}</p>`,
    };
  }
  const media = task.resultMedia;
  const assetId = task.resultAssetId ?? `${task.id}-asset`;
  const resultUrl = task.resultUrl ?? mediaAssetUrl(kind, assetId);
  return {
    ...common,
    assetId,
    inputState: "ready",
    inputStateReason: undefined,
    mediaByteSize: media?.byteSize ?? 1_024,
    mediaContentType: media?.contentType ??
      (kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg"),
    mediaDurationSeconds: media?.durationSeconds,
    mediaHeight: media?.mediaHeight,
    mediaMetadataSource: "server",
    mediaMetadataStatus: "ready",
    mediaStorageBackend: media?.storageBackend ?? "local",
    mediaWidth: media?.mediaWidth,
    [`${kind}Src`]: resultUrl,
    ...(kind === "image" ? { imageGeneratedSuccess: true } : {}),
    ...(kind === "audio"
      ? {
          audioGeneratedResult: true,
          audioResultChoices: [{
            assetId,
            byteSize: media?.byteSize ?? 1_024,
            checksumSha256: media?.checksumSha256 ?? "a".repeat(64),
            contentType: media?.contentType ?? "audio/mpeg",
            durationSeconds: media?.durationSeconds,
            durationStatus: media?.durationStatus ?? "ready",
            mediaHeight: media?.mediaHeight,
            mediaWidth: media?.mediaWidth,
            role: "primary",
            storageBackend: media?.storageBackend ?? "local",
            url: resultUrl,
          }],
        }
      : {}),
  };
}

function submissionIntentSlot(kind: Kind) {
  return `unboundry:generation-submission:v2:__test__:default:${kind}:` +
    encodeURIComponent(nodeId(kind));
}

async function flushBrowserTasks(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  }));
}

async function readPageCanvas(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/canvas/default");
    if (!response.ok) throw new Error(`Canvas GET failed: ${response.status}`);
    return response.json();
  }) as Promise<{
    nodes: Array<{ data: Record<string, unknown>; id: string }>;
  }>;
}

type CanvasReadDocument = {
  edges: unknown[];
  graphRevision: number;
  loadToken: string;
  nodes: unknown[];
  revision: number;
  viewport: { x: number; y: number; zoom: number };
};

function canvasCommandConflictEnvelope(
  command: { operationId?: unknown },
  document: CanvasReadDocument,
  code: string,
  error: string,
  requestId: string,
) {
  return {
    authoritativeDocument: {
      edges: document.edges,
      graphRevision: document.graphRevision,
      nodes: document.nodes,
      revision: document.revision,
      viewport: document.viewport,
    },
    code,
    currentDocumentRevision: document.revision,
    currentInputGraphRevision: document.graphRevision,
    currentLoadToken: document.loadToken,
    error,
    operationDocumentRevision: document.revision,
    operationId: typeof command.operationId === "string"
      ? command.operationId
      : "m41-missing-operation",
    operationInputGraphRevision: document.graphRevision,
    originalRequestId: requestId,
    replayed: false,
    requestId,
  };
}

async function withWindowTimerGlobal<T>(run: () => Promise<T>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const windowTarget = new EventTarget() as typeof globalThis;
  Object.defineProperties(windowTarget, {
    clearTimeout: {
      configurable: true,
      value: globalThis.clearTimeout,
      writable: true,
    },
    setTimeout: {
      configurable: true,
      value: globalThis.setTimeout,
      writable: true,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowTarget,
    writable: true,
  });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function canvasNodes(onlyKind?: Kind) {
  return kinds.filter((kind) => !onlyKind || kind === onlyKind)
    .map((kind, index) => ({
    data: {
      label: kind[0].toUpperCase() + kind.slice(1),
      title: `Retry ${kind}`,
      [`${kind}ModelId`]: modelInputs[kind].id,
      [`${kind}Parameters`]: defaultParameterValues(schemas[kind]),
      [`${kind}Prompt`]: `${kind} 原始提示词`,
      ...(kind === "text" ? {} : { [`${kind}PromptReady`]: true }),
      ...(kind === "text" ? { content: "" } : {}),
    },
    id: nodeId(kind),
    position: {
      x: index % 2 === 0 ? 80 : 620,
      y: index < 2 ? 80 : 520,
    },
    selected: Boolean(onlyKind) || kind === "text",
    style: {
      height: kind === "image" ? 300 : 250,
      width: kind === "image" ? 300 : kind === "text" ? 250 : 444,
    },
    type: kind,
    }));
}

function currentLegacyBinding(kind: Kind) {
  const nodes = canvasNodes(kind);
  const model = modelInputs[kind];
  const published = {
    ...model,
    capability: kind,
    displayName: `Legacy ${kind}`,
    generationAvailable: true,
    generationUnavailableReason: "",
    generationUnavailableReasonCode: null,
    isDefault: true,
    parameterSchema: schemas[kind],
  };
  const binding = currentWorkflowGenerationBinding({
    context: {
      canvasId: "default",
      graph: {
        apply: () => ({ status: "rejected" }),
        snapshot: () => ({ edges: [], nodes }),
      },
      isFixture: true,
      modelCatalog: {
        models: {
          audio: kind === "audio" ? [published] : [],
          image: kind === "image" ? [published] : [],
          text: kind === "text" ? [published] : [],
          video: kind === "video" ? [published] : [],
        },
        status: "ready",
      },
    },
    kind,
    nodeId: nodeId(kind),
  });
  if (!binding) throw new Error(`Missing current legacy binding for ${kind}`);
  return binding;
}

function currentStandaloneIdentity(kind: Kind): SubmittedGenerationIdentity {
  const binding = currentLegacyBinding(kind);
  const imageOwnershipKey = kind === "image"
    ? compactGenerationOwnershipKey({
        contractFingerprint: binding.inputContractFingerprint,
        modelConfigurationRevision: binding.modelConfigurationRevision,
        modelId: modelInputs[kind].id,
        modelReleaseRevision: binding.modelReleaseRevision,
        parameters: defaultParameterValues(schemas[kind]),
        prompt: `${kind} 原始提示词`,
        upstream: [],
      })
    : undefined;
  const audioOwnershipKey = kind === "audio"
    ? compactGenerationOwnershipKey({
        contractFingerprint: binding.inputContractFingerprint,
        modelConfigurationRevision: binding.modelConfigurationRevision,
        modelId: modelInputs[kind].id,
        modelReleaseRevision: binding.modelReleaseRevision,
        parameters: defaultParameterValues(schemas[kind]),
        prompt: `${kind} 原始提示词`,
        upstream: [],
      })
    : undefined;
  return {
    fixtureScopeId: "",
    generationIdentityVersion: 2,
    generationInputKey: binding.inputFingerprint,
    generationOwnershipKey:
      imageOwnershipKey ?? audioOwnershipKey ?? binding.ownershipKey,
    modelConfigurationRevision: binding.modelConfigurationRevision,
    modelInputContractFingerprint: binding.inputContractFingerprint,
    modelReleaseRevision: binding.modelReleaseRevision,
  };
}

function currentIntentOnlyIdentity(kind: Kind): SubmittedGenerationIdentity {
  const identity = currentStandaloneIdentity(kind);
  if (kind !== "image") return identity;
  const parameters = defaultParameterValues(schemas.image);
  return {
    ...identity,
    generationOwnershipKey: compactGenerationOwnershipKey({
      aspectRatio: parameters.aspectRatio,
      contractFingerprint: identity.modelInputContractFingerprint,
      modelConfigurationRevision: identity.modelConfigurationRevision,
      modelId: modelInputs.image.id,
      modelReleaseRevision: identity.modelReleaseRevision,
      parameters,
      prompt: "image 原始提示词",
      quality: parameters.quality,
      upstream: [],
    }),
  };
}

function directPollingTask(taskId: string): GenerationTaskSummary {
  return {
    ...currentStandaloneIdentity("text"),
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-09-07T00:00:00.000Z",
    id: taskId,
    kind: "text",
    model: modelInputs.text.id,
    nodeId: nodeId("text"),
    prompt: "text 状态读取测试",
    state: "success",
    updatedAt: "2026-09-07T00:00:01.000Z",
  };
}

async function installRoutes(page: Page, retryAllowed: boolean) {
  let providerRequests = 0;
  let taskSubmissions = 0;
  const bindingAcks = new Set<Kind>();
  const statusBeforeBindingAck = new Map<Kind, number>();
  const taskRetries = new Map<Kind, number>();
  const tasks = new Map<string, Record<string, unknown>>();
  const idsByKey = new Map<string, string>();
  const boundTaskIds = new Map<Kind, string>();

  const withAuthoritativeBindings = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const document = value as Record<string, unknown>;
    if (!Array.isArray(document.nodes)) return value;
    return {
      ...document,
      nodes: document.nodes.map((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
          return candidate;
        }
        const node = candidate as {
          data?: Record<string, unknown>;
          id?: string;
        };
        const kind = kinds.find((item) => node.id === nodeId(item));
        const taskId = kind ? boundTaskIds.get(kind) : undefined;
        const task = taskId ? tasks.get(taskId) : undefined;
        if (!kind || !taskId || !task) return candidate;
        bindingAcks.add(kind);
        return {
          ...node,
          data: {
            ...node.data,
            ...generationNodeIdentityData(
              kind,
              task as unknown as SubmittedGenerationIdentity,
            ),
            [`${kind}GenerationTaskId`]: taskId,
          },
        };
      }),
    };
  };

  page.on("request", (request) => {
    if (/volces|openrouter|mureka/i.test(request.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: kinds.map((kind) => ({
          capability: kind,
          displayName: `Retry UI ${kind}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs[kind],
          isDefault: true,
          parameterSchema: schemas[kind],
        })),
      },
      status: 200,
    });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    // This fixture forwards a read through a pooled connection. Retry only a
    // transport reset; HTTP errors and all application writes remain visible.
    const response = await route.fetch({ maxRetries: 1 });
    const document = await response.json();
    await route.fulfill({
      response,
      json: withAuthoritativeBindings(document),
    });
  });
  await page.route("**/api/canvases/default/commands", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const command = route.request().postDataJSON() as {
      changes?: Array<{ field?: string; nodeId?: string }>;
      kind?: string;
    };
    const semanticKinds = new Set<Kind>();
    if (command.kind === "apply-user-field-changes") {
      for (const change of command.changes ?? []) {
        const kind = kinds.find((item) => change.nodeId === nodeId(item));
        if (kind && change.field === `data.${kind}Prompt`) semanticKinds.add(kind);
      }
    }
    const response = await route.fetch();
    const body = await response.json();
    if (response.ok()) {
      for (const kind of semanticKinds) boundTaskIds.delete(kind);
    }
    const envelope = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    await route.fulfill({
      response,
      json: {
        ...envelope,
        ...(envelope.authoritativeDocument
          ? {
              authoritativeDocument: withAuthoritativeBindings(
                envelope.authoritativeDocument,
              ),
            }
          : {}),
      },
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
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
    if (url.pathname.endsWith("/by-idempotency") && method === "GET") {
      const id = idsByKey.get(url.searchParams.get("idempotencyKey") ?? "");
      await route.fulfill({
        contentType: "application/json",
        json: id ? tasks.get(id) : { error: "not found" },
        status: id ? 200 : 404,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "POST") {
      const body = request.postDataJSON() as {
        idempotencyKey: string;
        kind: Kind;
        model?: string;
        nodeId: string;
        ownPrompt?: string;
        parameters?: Record<string, ModelParameterValue> & {
          references?: unknown;
        };
        prompt: string;
        canvasRevision?: number;
      } & SubmittedGenerationIdentity;
      taskSubmissions += 1;
      const id = `retry-ui-task-${body.kind}`;
      idsByKey.set(body.idempotencyKey, id);
      const failed = {
        ...submittedGenerationIdentity(body),
        attempt: 1,
        canvasRevision: body.canvasRevision,
        canvasId: "default",
        costCurrency: "CNY",
        createdAt: "2026-08-03T08:00:00.000Z",
        errorCode: retryAllowed ? "AUTH" : "SERVICE_RESTARTED",
        errorMessage: retryAllowed
          ? `${body.kind} 零Provider模拟失败`
          : `${body.kind} 上次生成结果无法确认`,
        id,
        kind: body.kind,
        model: body.model,
        nodeId: body.nodeId,
        prompt: body.prompt,
        retryAllowed,
        ...(!retryAllowed
          ? {
              retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
              retryBlockReason:
                "上次生成结果无法确认，为避免重复扣费，不能直接重试",
            }
          : {}),
        state: "failed",
        updatedAt: "2026-08-03T08:00:01.000Z",
      };
      tasks.set(id, failed);
      boundTaskIds.set(body.kind, id);
      await route.fulfill({
        contentType: "application/json",
        json: { ...failed, retryAllowed: false, state: "queued" },
        status: 202,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [...tasks.values()] },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/retry") && method === "POST") {
      const id = url.pathname.split("/").at(-2) ?? "";
      const task = tasks.get(id);
      const kind = task?.kind;
      if (!task || typeof kind !== "string" || !kinds.includes(kind as Kind)) {
        await route.fulfill({
          contentType: "application/json",
          json: { error: "Unknown fake retry task" },
          status: 404,
        });
        return;
      }
      const retryKind = kind as Kind;
      taskRetries.set(retryKind, (taskRetries.get(retryKind) ?? 0) + 1);
      const nextAttempt = Number(task.attempt ?? 0) + 1;
      tasks.set(id, {
        ...task,
        attempt: nextAttempt,
        retryAllowed,
        state: "failed",
        updatedAt: "2026-08-03T08:00:03.000Z",
      });
      await route.fulfill({
        contentType: "application/json",
        json: {
          ...task,
          attempt: nextAttempt,
          retryAllowed: false,
          state: "queued",
          updatedAt: "2026-08-03T08:00:02.000Z",
        },
        status: 202,
      });
      return;
    }
    const id = url.pathname.split("/").at(-1) ?? "";
    if (method === "GET" && tasks.has(id)) {
      const kind = tasks.get(id)?.kind;
      if (typeof kind === "string" && kinds.includes(kind as Kind) &&
        !bindingAcks.has(kind as Kind)) {
        const typedKind = kind as Kind;
        statusBeforeBindingAck.set(
          typedKind,
          (statusBeforeBindingAck.get(typedKind) ?? 0) + 1,
        );
      }
      await route.fulfill({
        contentType: "application/json",
        json: tasks.get(id),
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

  return {
    bindingAcked: (kind: Kind) => bindingAcks.has(kind),
    providerRequests: () => providerRequests,
    taskRetries: (kind: Kind) => taskRetries.get(kind) ?? 0,
    taskSubmissions: () => taskSubmissions,
    statusBeforeBindingAck: (kind: Kind) =>
      statusBeforeBindingAck.get(kind) ?? 0,
  };
}

type SaveFenceOutcome = "load-required" | "pass";

async function installCanvasSaveFence(page: Page) {
  let armed:
    | { kind: Kind; outcome: SaveFenceOutcome; title: string }
    | undefined;
  const matched = new Map<string, number>();

  await page.route("**/api/canvases/default/commands", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !armed) {
      await route.fallback();
      return;
    }
    let body: {
      changes?: Array<{
        field?: unknown;
        nodeId?: unknown;
        value?: unknown;
      }>;
      kind?: unknown;
      operationId?: unknown;
    };
    try {
      body = request.postDataJSON() as typeof body;
    } catch {
      await route.fallback();
      return;
    }
    const expected = armed;
    const titleChange = body.kind === "apply-user-field-changes"
      ? body.changes?.find((change) =>
          change.nodeId === nodeId(expected.kind) &&
          change.field === "data.title" &&
          change.value === expected.title
        )
      : undefined;
    if (!titleChange) {
      await route.fallback();
      return;
    }
    armed = undefined;
    const key = `${expected.kind}:${expected.outcome}`;
    matched.set(key, (matched.get(key) ?? 0) + 1);
    if (expected.outcome === "pass") {
      await route.fallback();
      return;
    }
    const snapshot = await page.request.get("/api/canvas/default");
    const document = await snapshot.json() as CanvasReadDocument;
    await route.fulfill({
      contentType: "application/json",
      json: canvasCommandConflictEnvelope(
        body,
        document,
        "CANVAS_LOAD_REQUIRED",
        "Reload required before retrying generation",
        `m41-save-fence-${key}`,
      ),
      status: 409,
    });
  });

  return {
    arm(kind: Kind, title: string, outcome: SaveFenceOutcome) {
      if (armed) throw new Error("A canvas save fence is already armed");
      armed = { kind, outcome, title };
    },
    matched: (kind: Kind, outcome: SaveFenceOutcome) =>
      matched.get(`${kind}:${outcome}`) ?? 0,
  };
}

type CancellableKind = Extract<Kind, "image" | "video">;

async function installCancelOutcomeUnknownRoutes(page: Page) {
  let providerRequests = 0;
  const cancelRequests = new Map<CancellableKind, number>();
  const statusReads = new Map<CancellableKind, number>();
  const submissions = new Map<CancellableKind, number>();
  const tasks = new Map<string, Record<string, unknown>>();
  const idsByKey = new Map<string, string>();
  const boundTaskIds = new Map<CancellableKind, string>();

  page.on("request", (request) => {
    if (/volces|openrouter|mureka/i.test(request.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: kinds.map((kind) => ({
          capability: kind,
          displayName: `Cancel safety ${kind}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs[kind],
          isDefault: true,
          parameterSchema: schemas[kind],
        })),
      },
      status: 200,
    });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      response,
      json: {
        ...document,
        nodes: document.nodes?.map((node) => {
          const kind = (["image", "video"] as const).find((candidate) =>
            node.id === nodeId(candidate)
          );
          const taskId = kind ? boundTaskIds.get(kind) : undefined;
          const task = taskId ? tasks.get(taskId) : undefined;
          if (!kind || !taskId || !task) return node;
          return {
            ...node,
            data: {
              ...node.data,
              ...generationNodeIdentityData(
                kind,
                task as unknown as SubmittedGenerationIdentity,
              ),
              [`${kind}GenerationTaskId`]: taskId,
            },
          };
        }),
      },
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
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
    if (url.pathname.endsWith("/by-idempotency") && method === "GET") {
      const id = idsByKey.get(url.searchParams.get("idempotencyKey") ?? "");
      await route.fulfill({
        contentType: "application/json",
        json: id ? tasks.get(id) : { error: "not found" },
        status: id ? 200 : 404,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "POST") {
      const body = request.postDataJSON() as {
        idempotencyKey: string;
        kind: CancellableKind;
        model?: string;
        nodeId: string;
        prompt: string;
      } & SubmittedGenerationIdentity;
      submissions.set(body.kind, (submissions.get(body.kind) ?? 0) + 1);
      const id = `cancel-unknown-task-${body.kind}`;
      idsByKey.set(body.idempotencyKey, id);
      const running = {
        ...submittedGenerationIdentity(body),
        attempt: 1,
        canvasId: "default",
        costCurrency: "CNY",
        createdAt: "2026-08-03T08:00:00.000Z",
        id,
        kind: body.kind,
        model: body.model,
        nodeId: body.nodeId,
        prompt: body.prompt,
        retryAllowed: false,
        state: "running",
        updatedAt: "2026-08-03T08:00:01.000Z",
      };
      tasks.set(id, running);
      boundTaskIds.set(body.kind, id);
      await route.fulfill({
        contentType: "application/json",
        json: { ...running, state: "queued" },
        status: 202,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [...tasks.values()] },
        status: 200,
      });
      return;
    }
    const id = url.pathname.split("/").at(-1) ?? "";
    const task = tasks.get(id);
    if (task && method === "DELETE") {
      const kind = task.kind as CancellableKind;
      cancelRequests.set(kind, (cancelRequests.get(kind) ?? 0) + 1);
      await route.fulfill({
        contentType: "application/json",
        json: {
          code: "CANCEL_OUTCOME_UNKNOWN",
          error: "取消结果无法确认，任务仍在查询中",
        },
        status: 409,
      });
      return;
    }
    if (task && method === "GET") {
      const kind = task.kind as CancellableKind;
      statusReads.set(kind, (statusReads.get(kind) ?? 0) + 1);
      await route.fulfill({
        contentType: "application/json",
        json: task,
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

  return {
    cancelRequests: (kind: CancellableKind) => cancelRequests.get(kind) ?? 0,
    providerRequests: () => providerRequests,
    statusReads: (kind: CancellableKind) => statusReads.get(kind) ?? 0,
    submissions: (kind: CancellableKind) => submissions.get(kind) ?? 0,
  };
}

async function selectNode(page: Page, kind: Kind) {
  if (await page.getByTestId(`${kind}-creator`).isVisible().catch(() => false)) {
    return;
  }
  await page.locator(`.react-flow__node[data-id="${nodeId(kind)}"]`)
    .click({ force: true, position: { x: 8, y: 8 } });
  await expect(page.getByTestId(`${kind}-creator`)).toBeVisible();
}

function retryButton(page: Page, kind: Kind) {
  return kind === "text"
    ? page.getByTestId("text-creator")
        .getByRole("button", { name: "Retry generation" })
    : page.getByTestId(`${kind}-node-${nodeId(kind)}`)
        .getByRole("button", { name: "重试生成" });
}

async function changeNodeTitle(
  page: Page,
  kind: Kind,
  title: string,
) {
  await selectNode(page, kind);
  const input = page.locator(
    `.react-flow__node[data-id="${nodeId(kind)}"] ` +
      'input[placeholder="请输入标题"]',
  );
  await expect(input).toHaveCount(1);
  await input.fill(title, { force: true });
  await input.blur();
}

async function generateAndWaitForFailure(page: Page, kind: Kind) {
  await selectNode(page, kind);
  await page.getByTestId(`${kind}-creator`)
    .getByRole("button", { name: "Generate" })
    .click();
  const failure = kind === "text"
    ? page.getByTestId("upstream-input-problem")
    : page.getByTestId(`${kind}-node-${nodeId(kind)}`).getByRole("alert");
  await expect(failure).toContainText(kind);
}

async function changePrompt(page: Page, kind: Kind) {
  await selectNode(page, kind);
  const prompt = kind === "audio"
    ? page.getByLabel("音频提示词")
    : page.getByTestId(`${kind}-creator-prompt`);
  await prompt.fill(`${kind} 已修改提示词`);
  await prompt.blur();
}

for (const kind of kinds) {
  test(`${kind} aborts stale recovery when a server workflow lock arrives`, async ({
    page,
    request,
  }) => {
    const taskId = `m41-workflow-lock-old-task-${kind}`;
    const runId = `m41-workflow-lock-run-${kind}`;
    const identity = currentStandaloneIdentity(kind);
    const resultAssetId = `m41-workflow-lock-result-${kind}`;
    const successTask = {
      ...identity,
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-09-03T00:00:00.000Z",
      generationInputKey: identity.generationInputKey,
      generationOwnershipKey: identity.generationOwnershipKey,
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      canvasProjectionState: "applied",
      ...(kind === "text"
        ? { resultText: "late stale text result" }
        : {
            resultAssetId,
            resultMedia: {
              byteSize: 768,
              contentType: kind === "image"
                ? "image/png"
                : kind === "video"
                  ? "video/mp4"
                  : "audio/mpeg",
              durationSeconds: kind === "image" ? null : 5,
              durationStatus: kind === "image" ? "not-applicable" : "ready",
              storageBackend: "local",
            },
            resultUrl: mediaAssetUrl(kind, resultAssetId),
          }),
      state: "success",
      updatedAt: "2026-09-03T00:00:01.000Z",
    };
    await page.addInitScript(({ successTask, taskId }) => {
      const state: {
        activeRunEvents: number;
        releaseTask?: () => void;
        taskGets: number;
      } = { activeRunEvents: 0, taskGets: 0 };
      const controlledWindow = window as typeof window & {
        __m41WorkflowLock?: typeof state;
      };
      controlledWindow.__m41WorkflowLock = state;
      window.addEventListener("unboundry:server-workflow-run-updated", () => {
        state.activeRunEvents += 1;
      });
      const originalFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
        const url = new URL(raw, window.location.href);
        const method = (init?.method ??
          (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (
          method === "GET" &&
          url.pathname === `/api/generation-tasks/${taskId}`
        ) {
          state.taskGets += 1;
          return new Promise<Response>((resolve) => {
            // Deliberately ignore AbortSignal. The node's workflow lock and
            // lifecycle fence must reject this late old-task result.
            state.releaseTask = () => resolve(new Response(
              JSON.stringify(successTask),
              {
                headers: { "Content-Type": "application/json" },
                status: 200,
              },
            ));
          });
        }
        return originalFetch(input, init);
      }) as typeof window.fetch;
    }, { successTask, taskId });

    let canvasPuts = 0;
    let listReads = 0;
    let providerRequests = 0;
    let releaseWorkflowList!: () => void;
    let statusReads = 0;
    let taskSubmissions = 0;
    const workflowListGate = new Promise<void>((resolve) => {
      releaseWorkflowList = resolve;
    });
    const activeRun = {
      canvasId: "default",
      clientSemanticFingerprint: `m41-workflow-lock-client-${kind}`,
      createdAt: "2026-09-03T00:00:02.000Z",
      groupId: `m41-workflow-lock-group-${kind}`,
      id: runId,
      lockedNodeIds: [nodeId(kind)],
      nodes: [{
        id: nodeId(kind),
        kind,
        projectionState: "pending",
        state: "admitted",
      }],
      semanticFingerprint: `m41-workflow-lock-server-${kind}`,
      state: "running",
      updatedAt: "2026-09-03T00:00:03.000Z",
    };
    page.on("request", (entry) => {
      const url = new URL(entry.url());
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
      if (
        entry.method() === "PUT" &&
        url.pathname === "/api/canvas/default"
      ) canvasPuts += 1;
    });
    await page.route("**/api/models", async (route) => route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: `Workflow lock ${kind}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs[kind],
          isDefault: true,
          parameterSchema: schemas[kind],
        }],
      },
      status: 200,
    }));
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
          json: {
            paidProviderRequests: 0,
            persistentQueueReady: true,
            providerConfigured: true,
            submissionEnabled: true,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname === "/api/generation-tasks" && inbound.method() === "GET") {
        await route.fulfill({ json: { tasks: [] }, status: 200 });
        return;
      }
      if (url.pathname === "/api/generation-tasks" && inbound.method() === "POST") {
        taskSubmissions += 1;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });
    await page.route("**/api/workflow-runs**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (inbound.method() === "GET" && url.pathname === "/api/workflow-runs") {
        listReads += 1;
        await workflowListGate;
        await route.fulfill({ json: { runs: [activeRun] }, status: 200 });
        return;
      }
      if (
        inbound.method() === "GET" &&
        url.pathname === `/api/workflow-runs/${runId}`
      ) {
        statusReads += 1;
        await route.fulfill({ json: activeRun, status: 200 });
        return;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes(kind);
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: {
            ...baseNode.data,
            ...generationNodeIdentityData(kind, identity),
            [`${kind}Generating`]: true,
            [`${kind}GenerationTaskId`]: taskId,
            ...(kind === "text"
              ? {
                  content: "old text result",
                  contentHtml: "<p>old text result</p>",
                }
              : {}),
          },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await expect.poll(() => page.evaluate(() =>
        (window as typeof window & {
          __m41WorkflowLock?: { taskGets: number };
        }).__m41WorkflowLock?.taskGets ?? 0
      )).toBe(1);
      await expect.poll(() => listReads).toBeGreaterThanOrEqual(1);
      releaseWorkflowList();
      await expect.poll(() => page.evaluate(() =>
        (window as typeof window & {
          __m41WorkflowLock?: { activeRunEvents: number };
        }).__m41WorkflowLock?.activeRunEvents ?? 0
      )).toBeGreaterThanOrEqual(1);
      await expect.poll(() => statusReads).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(600);
      const putsAfterLock = canvasPuts;
      const lockedCanvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      expect(lockedCanvas.nodes[0]?.data.workflowExecutionRunId).toBeUndefined();
      await page.evaluate(() => {
        const state = (window as typeof window & {
          __m41WorkflowLock?: { releaseTask?: () => void };
        }).__m41WorkflowLock;
        if (!state?.releaseTask) throw new Error("Missing held task request");
        state.releaseTask();
      });
      await flushBrowserTasks(page);
      await flushBrowserTasks(page);
      await page.waitForTimeout(1_600);
      expect(canvasPuts).toBe(putsAfterLock);
      expect(taskSubmissions).toBe(0);
      expect(providerRequests).toBe(0);
      await expect(page.getByText(POLLING_PAUSED_MESSAGE, { exact: false }))
        .toHaveCount(0);
    } finally {
      releaseWorkflowList();
      await page.evaluate(() => {
        (window as typeof window & {
          __m41WorkflowLock?: { releaseTask?: () => void };
        }).__m41WorkflowLock?.releaseTask?.();
      }).catch(() => undefined);
      await request.delete("/api/canvas/default");
    }
  });
}

test("an aborted task poll exits without showing a transient polling pause", async () => {
  const originalFetch = globalThis.fetch;
  let pauses = 0;
  globalThis.fetch = async () => {
    throw new DOMException("scope changed", "AbortError");
  };
  try {
    await withWindowTimerGlobal(async () => {
      await expect(
        waitForGenerationTaskWithPause("aborted-task", () => {
          pauses += 1;
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
    });
    expect(pauses).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WithPause retries transient status reads with bounded backoff and resets after success", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const task = directPollingTask("m41-direct-transient-status");
  const statuses = [500, 503, 200, 502, 200];
  const backoffDelays: number[] = [];
  let reads = 0;
  let pauses = 0;
  globalThis.setTimeout = ((...args: Parameters<typeof globalThis.setTimeout>) => {
    const timeout = args[1];
    if (timeout === 1_000 || timeout === 2_000) backoffDelays.push(timeout);
    return originalSetTimeout(...args);
  }) as typeof globalThis.setTimeout;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://safe.invalid");
    expect(url.pathname).toBe(`/api/generation-tasks/${task.id}`);
    reads += 1;
    const status = statuses.shift();
    if (status === undefined) throw new Error("Unexpected status read");
    if (status === 200) {
      return new Response(JSON.stringify({
        ...task,
        state: reads === 3 ? "running" : "success",
      }), {
        headers: { "Content-Type": "application/json" },
        status,
      });
    }
    return new Response("<html>temporary status failure</html>", {
      headers: { "Content-Type": "text/html" },
      status,
    });
  }) as typeof globalThis.fetch;
  try {
    await withWindowTimerGlobal(async () => {
      await expect(
        waitForGenerationTaskWithPause(task.id, () => {
          pauses += 1;
        }),
      ).resolves.toMatchObject({ id: task.id, state: "success" });
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
  expect(reads).toBe(5);
  // The third 1s entry is the normal running-task interval; the fourth is
  // the fresh 1s retry after that successful status read.
  expect(backoffDelays).toEqual([1_000, 2_000, 1_000, 1_000]);
  expect(pauses).toBe(0);
});

test("status polling keeps transient failure counters isolated per task", async () => {
  const originalFetch = globalThis.fetch;
  const taskIds = [
    "m41-direct-isolated-success",
    "m41-direct-isolated-paused",
  ] as const;
  const statuses = new Map<string, number[]>([
    [taskIds[0], [500, 200]],
    [taskIds[1], [500, 500, 500]],
  ]);
  const reads = new Map<string, number>();
  const pauses = new Map<string, number>();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://safe.invalid");
    const taskId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const sequence = statuses.get(taskId);
    if (!sequence) throw new Error(`Unexpected status task ${taskId}`);
    reads.set(taskId, (reads.get(taskId) ?? 0) + 1);
    const status = sequence.shift();
    if (status === undefined) throw new Error(`Unexpected read for ${taskId}`);
    if (status === 200) {
      return new Response(JSON.stringify(directPollingTask(taskId)), {
        headers: { "Content-Type": "application/json" },
        status,
      });
    }
    return new Response(JSON.stringify({
      code: "TEMPORARY",
      error: "temporary status failure",
    }), { status });
  }) as typeof globalThis.fetch;
  try {
    await withWindowTimerGlobal(async () => {
      const results = await Promise.allSettled([
        waitForGenerationTaskWithPause(taskIds[0], () => {
          pauses.set(taskIds[0], (pauses.get(taskIds[0]) ?? 0) + 1);
        }),
        waitForGenerationTaskWithPause(taskIds[1], () => {
          pauses.set(taskIds[1], (pauses.get(taskIds[1]) ?? 0) + 1);
        }),
      ]);
      expect(results[0]?.status).toBe("fulfilled");
      expect(results[1]?.status).toBe("rejected");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(reads).toEqual(new Map([
    [taskIds[0], 2],
    [taskIds[1], 3],
  ]));
  expect(pauses).toEqual(new Map([[taskIds[1], 1]]));
});

test("AbortSignal cancels a transient retry during backoff without another GET or pause", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const controller = new AbortController();
  let releaseBackoff!: () => void;
  const backoffScheduled = new Promise<void>((resolve) => {
    releaseBackoff = resolve;
  });
  let reads = 0;
  let pauses = 0;
  globalThis.setTimeout = ((...args: Parameters<typeof globalThis.setTimeout>) => {
    if (args[1] === 1_000) releaseBackoff();
    return originalSetTimeout(...args);
  }) as typeof globalThis.setTimeout;
  globalThis.fetch = (async () => {
    reads += 1;
    return new Response(JSON.stringify({
      code: "TEMPORARY",
      error: "transient status failure",
    }), { status: 503 });
  }) as typeof globalThis.fetch;
  try {
    await withWindowTimerGlobal(async () => {
      const polling = waitForGenerationTaskWithPause(
        "m41-direct-abort-backoff",
        () => {
          pauses += 1;
        },
        controller.signal,
      );
      await backoffScheduled;
      controller.abort("scope changed");
      await expect(polling).rejects.toMatchObject({ name: "AbortError" });
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
  expect(reads).toBe(1);
  expect(pauses).toBe(0);
});

test("status polling retries network and 5xx HTML failures but not definitive read errors", async () => {
  const originalFetch = globalThis.fetch;
  const transientCases: Array<{
    label: string;
    reply: () => Response | Error;
  }> = [
    {
      label: "network TypeError",
      reply: () => new TypeError("temporary network failure"),
    },
    {
      label: "502 HTML",
      reply: () => new Response("<html>bad gateway</html>", {
        headers: { "Content-Type": "text/html" },
        status: 502,
      }),
    },
    {
      label: "503 HTML",
      reply: () => new Response("<html>service unavailable</html>", {
        headers: { "Content-Type": "text/html" },
        status: 503,
      }),
    },
  ];
  const task = directPollingTask("m41-direct-classifier-success");
  try {
    for (const fixture of transientCases) {
      let reads = 0;
      let pauses = 0;
      globalThis.fetch = (async () => {
        reads += 1;
        if (reads === 1) {
          const reply = fixture.reply();
          if (reply instanceof Error) throw reply;
          return reply;
        }
        return new Response(JSON.stringify(directPollingTask(
          `${task.id}-${fixture.label}`,
        )), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }) as typeof globalThis.fetch;
      await withWindowTimerGlobal(async () => {
        await expect(
          waitForGenerationTaskWithPause(
            `${task.id}-${fixture.label}`,
            () => {
              pauses += 1;
            },
          ),
        ).resolves.toMatchObject({ state: "success" });
      });
      expect(reads, fixture.label).toBe(2);
      expect(pauses, fixture.label).toBe(0);
    }

    const definitiveCases: Array<{
      label: string;
      reply: () => Response | Error;
    }> = [
      ...[401, 403, 404, 409, 429].map((status) => ({
        label: `${status} HTML`,
        reply: () => new Response("<html>definitive status</html>", {
          headers: { "Content-Type": "text/html" },
          status,
        }),
      })),
      {
        label: "200 malformed JSON",
        reply: () => new Response("{", {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      },
      {
        label: "200 invalid shape",
        reply: () => new Response(JSON.stringify({ state: "running" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      },
      {
        label: "200 same id missing required fields",
        reply: () => new Response(JSON.stringify({
          id: `${task.id}-200 same id missing required fields`,
          state: "running",
        }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      },
      {
        label: "processing exception",
        reply: () => {
          const response = new Response("{}", {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
          Object.defineProperty(response, "json", {
            configurable: true,
            value: () => Promise.reject(new Error("status processing failed")),
          });
          return response;
        },
      },
      {
        label: "external GenerationRequestError 500",
        reply: () => new GenerationRequestError(
          "external status error",
          500,
          "EXTERNAL_STATUS_ERROR",
        ),
      },
    ];
    for (const fixture of definitiveCases) {
      let reads = 0;
      let pauses = 0;
      const taskId = `${task.id}-${fixture.label}`;
      globalThis.fetch = (async () => {
        reads += 1;
        const reply = fixture.reply();
        if (reply instanceof Error) throw reply;
        return reply;
      }) as typeof globalThis.fetch;
      await withWindowTimerGlobal(async () => {
        await expect(
          waitForGenerationTaskWithPause(taskId, () => {
            pauses += 1;
          }),
        ).rejects.toBeTruthy();
      });
      expect(reads, fixture.label).toBe(1);
      // The external error is outside the status-read classifier. It may
      // still use the existing pause presentation, but it must not re-read.
      if (fixture.label !== "external GenerationRequestError 500") {
        expect(pauses, fixture.label).toBe(0);
      }
    }

    const sharedParserTask = directPollingTask(
      "m41-direct-shared-parser-task",
    );
    const byIdempotencyCases: Array<{
      body: string;
      contentType: string;
      expected: "task" | "undefined" | "status";
      label: string;
      status: number;
    }> = [
      {
        body: "<html>not found</html>",
        contentType: "text/html",
        expected: "undefined",
        label: "by-idempotency 404 HTML",
        status: 404,
      },
      {
        body: JSON.stringify(sharedParserTask),
        contentType: "application/json",
        expected: "task",
        label: "by-idempotency valid task",
        status: 200,
      },
      {
        body: "<html>bad gateway</html>",
        contentType: "text/html",
        expected: "status",
        label: "by-idempotency 503 HTML",
        status: 503,
      },
    ];
    for (const fixture of byIdempotencyCases) {
      let reads = 0;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        reads += 1;
        const url = new URL(String(input), "http://safe.invalid");
        expect(url.pathname).toBe(
          "/api/generation-tasks/by-idempotency",
        );
        return new Response(fixture.body, {
          headers: { "Content-Type": fixture.contentType },
          status: fixture.status,
        });
      }) as typeof globalThis.fetch;
      await withWindowTimerGlobal(async () => {
        const result = getGenerationTaskByIdempotency(
          "default",
          `m41-${fixture.label}`,
        );
        if (fixture.expected === "status") {
          await expect(result).rejects.toMatchObject({
            status: fixture.status,
          });
        } else if (fixture.expected === "task") {
          await expect(result).resolves.toEqual(sharedParserTask);
        } else {
          await expect(result).resolves.toBeUndefined();
        }
      });
      expect(reads, fixture.label).toBe(1);
    }

    const listCases: Array<{
      body: string;
      contentType: string;
      expected: "tasks" | "status";
      label: string;
      status: number;
    }> = [
      {
        body: JSON.stringify({ tasks: [sharedParserTask] }),
        contentType: "application/json",
        expected: "tasks",
        label: "list valid array",
        status: 200,
      },
      {
        body: "{",
        contentType: "application/json",
        expected: "status",
        label: "list bad JSON",
        status: 200,
      },
      {
        body: "<html>bad gateway</html>",
        contentType: "text/html",
        expected: "status",
        label: "list 503 HTML",
        status: 503,
      },
    ];
    for (const fixture of listCases) {
      let reads = 0;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        reads += 1;
        const url = new URL(String(input), "http://safe.invalid");
        expect(url.pathname).toBe("/api/generation-tasks");
        return new Response(fixture.body, {
          headers: { "Content-Type": fixture.contentType },
          status: fixture.status,
        });
      }) as typeof globalThis.fetch;
      await withWindowTimerGlobal(async () => {
        const result = listGenerationTasks("default");
        if (fixture.expected === "tasks") {
          await expect(result).resolves.toEqual([sharedParserTask]);
        } else {
          await expect(result).rejects.toMatchObject({
            status: fixture.status,
          });
        }
      });
      expect(reads, fixture.label).toBe(1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("known 401 status stays non-retryable when its response body hangs", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let reads = 0;
  let pauses = 0;
  globalThis.setTimeout = ((...args: Parameters<typeof globalThis.setTimeout>) => {
    if (args[1] === 10_000) {
      const [handler, , ...rest] = args;
      return originalSetTimeout(handler, 1, ...rest);
    }
    return originalSetTimeout(...args);
  }) as typeof globalThis.setTimeout;
  globalThis.fetch = (async () => {
    reads += 1;
    const response = new Response(null, {
      headers: { "Content-Type": "text/html" },
      status: 401,
    });
    Object.defineProperty(response, "json", {
      configurable: true,
      value: () => new Promise<never>(() => undefined),
    });
    return response;
  }) as typeof globalThis.fetch;
  try {
    await withWindowTimerGlobal(async () => {
      await expect(
        waitForGenerationTaskWithPause(
          "m41-direct-401-stalled-body",
          () => {
            pauses += 1;
          },
        ),
      ).rejects.toMatchObject({
        code: "TASK_STATUS_TIMEOUT",
        status: 401,
      });
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
  expect(reads).toBe(1);
  expect(pauses).toBe(0);
});

test("direct wait keeps the default status-read behavior without transient retries", async () => {
  const originalFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = (async () => {
    reads += 1;
    return new Response(JSON.stringify({
      code: "TEMPORARY",
      error: "direct wait outage",
    }), { status: 503 });
  }) as typeof globalThis.fetch;
  try {
    await withWindowTimerGlobal(async () => {
      await expect(
        waitForGenerationTask("m41-direct-default-wait"),
      ).rejects.toMatchObject({ status: 503 });
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(reads).toBe(1);
});

test("WithPause keeps the original 1800-round wait budget with bounded retries", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const taskId = "m41-direct-wait-budget";
  let reads = 0;
  let oneSecondTimers = 0;
  let pauses = 0;
  globalThis.setTimeout = ((...args: Parameters<typeof globalThis.setTimeout>) => {
    if (args[1] === 1_000) {
      oneSecondTimers += 1;
      const [handler, , ...rest] = args;
      return originalSetTimeout(handler, 0, ...rest);
    }
    return originalSetTimeout(...args);
  }) as typeof globalThis.setTimeout;
  globalThis.fetch = (async () => {
    reads += 1;
    const status = reads === 900 || reads === 1_802 ? 503 : 200;
    const state = reads < 1_803 ? "running" : "success";
    if (status === 503) {
      return new Response(JSON.stringify({
        code: "TEMPORARY",
        error: "bounded status outage",
      }), { status });
    }
    return new Response(JSON.stringify({
      ...directPollingTask(taskId),
      state,
    }), {
      headers: { "Content-Type": "application/json" },
      status,
    });
  }) as typeof globalThis.fetch;
  try {
    await withWindowTimerGlobal(async () => {
      await expect(
        waitForGenerationTaskWithPause(taskId, () => {
          pauses += 1;
        }),
      ).resolves.toMatchObject({ id: taskId, state: "success" });
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
  expect(reads).toBe(1_803);
  // There are 1,800 normal running-task waits plus one 1s retry after each
  // injected 503, including the final read after the wait budget. The outer
  // 1,800-round loop must not restart.
  expect(oneSecondTimers).toBe(1_802);
  expect(pauses).toBe(0);
});

test("legacy nodes boundedly recheck unknown and active tasks without submission", async ({
  page,
  request,
}) => {
  let releasePolicy!: () => void;
  const policyGate = new Promise<void>((resolve) => {
    releasePolicy = resolve;
  });
  let policyReads = 0;
  let taskReads = 0;
  const taskReadCounts = new Map<string, number>();
  let generationPosts = 0;
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      new URL(entry.url()).pathname === "/api/generation-tasks"
    ) generationPosts += 1;
  });
  await page.route(
    "**/api/canvases/default/generation-reconciliation-policy",
    async (route) => {
      policyReads += 1;
      await policyGate;
      await route.fulfill({
        contentType: "application/json",
        json: { mode: "detect", writeEnabled: false },
        status: 200,
      });
    },
  );
  await page.route("**/api/generation-tasks/*", async (route) => {
    taskReads += 1;
    const taskId = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const kind = kinds.find((candidate) => taskId.endsWith(candidate)) ?? "text";
    const readCount = (taskReadCounts.get(taskId) ?? 0) + 1;
    taskReadCounts.set(taskId, readCount);
    if (kind === "text" && readCount === 1) {
      await route.fulfill({
        contentType: "application/json",
        json: { code: "TEMPORARY_READ_FAILURE", error: "temporary read failure" },
        status: 500,
      });
      return;
    }
    const state = kind === "text"
      ? (readCount === 2 ? "running" : "success")
      : (readCount === 1 ? "running" : "success");
    const binding = currentLegacyBinding(kind);
    await route.fulfill({
      contentType: "application/json",
      json: {
        attempt: 1,
        canvasId: "default",
        costCurrency: "CNY",
        createdAt: "2026-08-26T00:00:00.000Z",
        generationInputKey: binding.inputFingerprint,
        generationOwnershipKey: binding.ownershipKey,
        id: taskId,
        kind,
        nodeId: nodeId(kind),
        prompt: "legacy active fixture",
        state,
        updatedAt: "2026-08-26T00:01:00.000Z",
        workflowExecutionRunId: `legacy-run-${kind}`,
      },
      status: 200,
    });
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: kinds.map((kind) => ({
          capability: kind,
          displayName: `Legacy active ${kind}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs[kind],
          isDefault: true,
          parameterSchema: schemas[kind],
        })),
      },
      status: 200,
    });
  });
  await request.delete("/api/canvas/default");
  const legacyNodes = canvasNodes().map((node) => {
    const kind = node.type as Kind;
    const binding = currentLegacyBinding(kind);
    return {
      ...node,
      data: {
        ...node.data,
        workflowExecutionRunId: `legacy-run-${kind}`,
        [`${kind}Generating`]: true,
        [`${kind}GenerationInputKey`]: binding.inputFingerprint,
        [`${kind}GenerationOwnershipKey`]: binding.ownershipKey,
        [`${kind}GenerationTaskId`]: `legacy-active-${kind}`,
      },
    };
  });
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: legacyNodes,
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();
  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world"))
    .toHaveAttribute("data-persistence-ready", "true");
  await expect.poll(() => policyReads).toBe(1);
  await expect(page.getByTestId("legacy-terminal-generation-notice"))
    .toHaveCount(4);
  await expect(page.getByTestId("text-node-generating")).toHaveCount(0);
  await expect(page.getByTestId("image-node-generating")).toHaveCount(0);
  await expect(page.getByTestId("video-node-generating")).toHaveCount(0);
  await expect(page.getByTestId("audio-node-generating")).toHaveCount(0);

  expect(generationPosts).toBe(0);
  releasePolicy();
  await expect.poll(() => taskReads).toBe(4);
  await expect(page.getByTestId("text-node-generating")).toHaveCount(0);
  await expect(page.getByTestId("image-node-generating")).toHaveCount(1);
  await expect(page.getByTestId("video-node-generating")).toHaveCount(1);
  await expect(page.getByTestId("audio-node-generating")).toHaveCount(1);
  await expect.poll(() => taskReads).toBe(8);
  await expect(page.getByTestId("text-node-generating")).toHaveCount(1);
  await expect(page.getByTestId("image-node-generating")).toHaveCount(0);
  await expect(page.getByTestId("video-node-generating")).toHaveCount(0);
  await expect(page.getByTestId("audio-node-generating")).toHaveCount(0);
  await expect.poll(() => taskReads).toBe(12);
  await expect(page.getByTestId("legacy-terminal-generation-notice"))
    .toHaveCount(4);
  await expect(page.getByTestId("text-node-generating")).toHaveCount(0);
  await expect(page.getByTestId("image-node-generating")).toHaveCount(0);
  await expect(page.getByTestId("video-node-generating")).toHaveCount(0);
  await expect(page.getByTestId("audio-node-generating")).toHaveCount(0);
  expect(Object.fromEntries(taskReadCounts)).toEqual({
    "legacy-active-audio": 3,
    "legacy-active-image": 3,
    "legacy-active-text": 3,
    "legacy-active-video": 3,
  });
  expect(generationPosts).toBe(0);
  await request.delete("/api/canvas/default");
});

test("legacy classifier unknown and missing Web Locks stop after bounded original-task reads", async ({
  page,
  request,
}) => {
  const binding = currentLegacyBinding("text");
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "locks", {
      configurable: true,
      get: () => undefined,
    });
  });
  let policyReads = 0;
  let taskReads = 0;
  let generationPosts = 0;
  let reconciliationWrites = 0;
  page.on("request", (entry) => {
    const path = new URL(entry.url()).pathname;
    if (entry.method() === "POST" && path === "/api/generation-tasks") {
      generationPosts += 1;
    }
    if (
      entry.method() === "POST" &&
      (path.endsWith("/generation-terminal-detach") ||
        path === "/api/generation-result-projections")
    ) reconciliationWrites += 1;
  });
  await page.route(
    "**/api/canvases/default/generation-reconciliation-policy",
    async (route) => {
      policyReads += 1;
      await route.fulfill({
        contentType: "application/json",
        json: { mode: "on", writeEnabled: true },
        status: 200,
      });
    },
  );
  await page.route("**/api/generation-tasks/legacy-bounded-text**", async (route) => {
    taskReads += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        attempt: 1,
        canvasId: "default",
        costCurrency: "CNY",
        createdAt: "2026-08-26T00:00:00.000Z",
        generationInputKey: binding.inputFingerprint,
        generationOwnershipKey: taskReads === 1
          ? "foreign-owner"
          : binding.ownershipKey,
        id: "legacy-bounded-text",
        kind: "text",
        nodeId: nodeId("text"),
        prompt: "legacy bounded fixture",
        state: "failed",
        updatedAt: "2026-08-26T00:01:00.000Z",
        workflowExecutionRunId: "legacy-bounded-run",
      },
      status: 200,
    });
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: kinds.map((kind) => ({
          capability: kind,
          displayName: `Legacy bounded ${kind}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs[kind],
          isDefault: true,
          parameterSchema: schemas[kind],
        })),
      },
      status: 200,
    });
  });
  await request.delete("/api/canvas/default");
  const textNode = canvasNodes().find((node) => node.type === "text");
  if (!textNode) throw new Error("Text fixture missing");
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...textNode,
        data: {
          ...textNode.data,
          workflowExecutionRunId: "legacy-bounded-run",
          textGenerating: true,
          textGenerationInputKey: binding.inputFingerprint,
          textGenerationOwnershipKey: binding.ownershipKey,
          textGenerationTaskId: "legacy-bounded-text",
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world"))
    .toHaveAttribute("data-persistence-ready", "true");
  await expect.poll(() => taskReads, { timeout: 12_000 }).toBe(5);
  await expect(page.getByTestId("legacy-terminal-generation-notice"))
    .toHaveAttribute("data-state", "UNKNOWN_BLOCKED");
  await expect(page.getByTestId("text-node-generating")).toHaveCount(0);
  await page.waitForTimeout(4_500);
  expect(taskReads).toBe(5);
  expect(policyReads).toBe(5);
  expect(generationPosts).toBe(0);
  expect(reconciliationWrites).toBe(0);
  await request.delete("/api/canvas/default");
});

test("legacy reconciliation retries after a conflicting run lease appears inside canvas admission", async ({
  page,
  request,
}) => {
  const binding = currentLegacyBinding("text");
  let taskReads = 0;
  let detachRequests = 0;
  let generationPosts = 0;
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      new URL(entry.url()).pathname === "/api/generation-tasks"
    ) generationPosts += 1;
  });
  await page.route(
    "**/api/canvases/default/generation-reconciliation-policy",
    async (route) => route.fulfill({
      contentType: "application/json",
      json: { mode: "on", writeEnabled: true },
      status: 200,
    }),
  );
  await page.route("**/api/generation-tasks/legacy-deferred-text**", async (route) => {
    taskReads += 1;
    if (taskReads === 1) {
      await page.evaluate(() => {
        const runId = "new-active-run";
        const key = `unboundry-group-run-lease:v1:${JSON.stringify([
          "__test__",
          "default",
          "",
          runId,
        ])}`;
        window.localStorage.setItem(key, JSON.stringify({
          expiresAt: Date.now() + 3_000,
          heartbeatAt: Date.now(),
          lockedNodeIds: ["retry-ui-text"],
          ownerId: "racing-tab-owner",
          runId,
        }));
      });
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        attempt: 1,
        canvasId: "default",
        costCurrency: "CNY",
        createdAt: "2026-08-26T00:00:00.000Z",
        generationInputKey: binding.inputFingerprint,
        generationOwnershipKey: binding.ownershipKey,
        id: "legacy-deferred-text",
        kind: "text",
        nodeId: nodeId("text"),
        prompt: "legacy deferred fixture",
        state: "failed",
        updatedAt: "2026-08-26T00:01:00.000Z",
        workflowExecutionRunId: "legacy-deferred-run",
      },
      status: 200,
    });
  });
  await page.route(
    "**/api/canvases/default/generation-terminal-detach",
    async (route) => {
      detachRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        json: { code: "TEST_DEFERRED_WRITE_STOP", error: "test stop" },
        status: 409,
      });
    },
  );
  await page.route("**/api/models", async (route) => route.fulfill({
    contentType: "application/json",
    json: {
      generationEnabled: true,
      models: kinds.map((kind) => ({
        capability: kind,
        displayName: `Legacy deferred ${kind}`,
        generationAvailable: true,
        generationUnavailableReason: "",
        generationUnavailableReasonCode: null,
          ...modelInputs[kind],
        isDefault: true,
        parameterSchema: schemas[kind],
      })),
    },
    status: 200,
  }));
  await request.delete("/api/canvas/default");
  const textNode = canvasNodes().find((node) => node.type === "text");
  if (!textNode) throw new Error("Text fixture missing");
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...textNode,
        data: {
          ...textNode.data,
          workflowExecutionRunId: "legacy-deferred-run",
          textGenerating: true,
          textGenerationInputKey: binding.inputFingerprint,
          textGenerationOwnershipKey: binding.ownershipKey,
          textGenerationTaskId: "legacy-deferred-text",
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world"))
    .toHaveAttribute("data-persistence-ready", "true");
  await expect.poll(() => taskReads).toBe(1);
  await page.waitForTimeout(300);
  expect(detachRequests).toBe(0);
  await expect.poll(() => detachRequests, { timeout: 8_000 }).toBe(1);
  expect(taskReads).toBe(3);
  expect(generationPosts).toBe(0);
  await request.delete("/api/canvas/default");
});

test("four retry handlers save first and fail closed on LOAD_REQUIRED", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const routes = await installRoutes(page, true);
  const saveFence = await installCanvasSaveFence(page);

  for (const kind of kinds) {
    if (page.url().startsWith("http")) {
      await page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
    }
    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await generateAndWaitForFailure(page, kind);
    await expect.poll(() => routes.bindingAcked(kind)).toBe(true);
    expect(routes.statusBeforeBindingAck(kind)).toBe(0);
    await expect(retryButton(page, kind)).toBeEnabled({ timeout: 15_000 });
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      const node = canvas.nodes.find((candidate) => candidate.id === nodeId(kind));
      return {
        inputKey: typeof node?.data[`${kind}GenerationInputKey`],
        ownershipKey: typeof node?.data[`${kind}GenerationOwnershipKey`],
        taskId: node?.data[`${kind}GenerationTaskId`],
      };
    }).toEqual({
      inputKey: "string",
      ownershipKey: "string",
      taskId: `retry-ui-task-${kind}`,
    });
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    const savedTitle = `${kind} retry after saved title`;
    saveFence.arm(kind, savedTitle, "pass");
    await changeNodeTitle(page, kind, savedTitle);
    await expect.poll(() => saveFence.matched(kind, "pass")).toBe(1);
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    await retryButton(page, kind).click();
    await expect.poll(() => routes.taskRetries(kind)).toBe(1);
    await expect(page.locator(
      `.react-flow__node[data-id="${nodeId(kind)}"]`,
    )).toBeVisible({ timeout: 15_000 });
    await expect(retryButton(page, kind)).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    const blockedTitle = `${kind} retry blocked title`;
    saveFence.arm(kind, blockedTitle, "load-required");
    await changeNodeTitle(page, kind, blockedTitle);
    await expect.poll(() => saveFence.matched(kind, "load-required")).toBe(1);
    await expect(page.getByTestId("save-conflict")).toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveText("保存失败");
    await expect(retryButton(page, kind)).toBeDisabled();
    await flushBrowserTasks(page);
    await flushBrowserTasks(page);
    expect(routes.taskRetries(kind)).toBe(1);
  }

  expect(routes.taskSubmissions()).toBe(4);
  expect(routes.providerRequests()).toBe(0);
});

test("four nodes keep safe retry across autosave, then detach it after semantic input changes and refresh", async ({
  page,
  request,
}) => {
  const routes = await installRoutes(page, true);
  for (const kind of kinds) {
    if (page.url().startsWith("http")) {
      await page.evaluate(() => window.localStorage.clear());
    }
    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await generateAndWaitForFailure(page, kind);
    await expect(retryButton(page, kind)).toBeVisible();
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      return canvas.nodes.find((node) => node.id === nodeId(kind))
        ?.data[`${kind}GenerationTaskId`];
    }).toBe(`retry-ui-task-${kind}`);

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(retryButton(page, kind)).toBeVisible();
    await changePrompt(page, kind);
    await expect(retryButton(page, kind)).toHaveCount(0);
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return data?.[`${kind}GenerationTaskId`] === undefined &&
        data?.[`${kind}GenerationInputKey`] === undefined;
    }).toBe(true);

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(retryButton(page, kind)).toHaveCount(0);
  }
  expect(routes.taskSubmissions()).toBe(4);
  expect(routes.providerRequests()).toBe(0);
});

test("four nodes obey server retryAllowed=false before and after refresh", async ({
  page,
  request,
}) => {
  const routes = await installRoutes(page, false);
  for (const kind of kinds) {
    if (page.url().startsWith("http")) {
      await page.evaluate(() => window.localStorage.clear());
    }
    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await generateAndWaitForFailure(page, kind);
    await expect(retryButton(page, kind)).toHaveCount(0);
    const failure = kind === "text"
      ? page.getByTestId("upstream-input-problem")
      : page.getByTestId(`${kind}-node-${nodeId(kind)}`).getByRole("alert");
    await expect(failure).toContainText("不能直接重试");
    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(retryButton(page, kind)).toHaveCount(0);
  }
  expect(routes.taskSubmissions()).toBe(4);
  expect(routes.providerRequests()).toBe(0);
});

for (const kind of ["image", "video"] as const) {
  test(`${kind} keeps the same paid task active when cancellation outcome is unknown`, async ({
    page,
    request,
  }) => {
    const routes = await installCancelOutcomeUnknownRoutes(page);
    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await selectNode(page, kind);
    const creator = page.getByTestId(`${kind}-creator`);
    await creator.getByRole("button", { name: "Generate" }).click();

    const cancel = creator.getByRole("button", { name: "取消生成" });
    await expect(cancel).toBeVisible();
    await expect(cancel).toBeEnabled();
    await expect.poll(() => routes.statusReads(kind)).toBeGreaterThanOrEqual(1);
    const taskId = `cancel-unknown-task-${kind}`;
    const intentSlot =
      `unboundry:generation-submission:v2:__test__:default:${kind}:` +
      encodeURIComponent(nodeId(kind));
    await expect.poll(async () => page.evaluate(({ intentSlot, taskId }) => {
      const serialized = window.localStorage.getItem(intentSlot);
      if (!serialized) return false;
      return (JSON.parse(serialized) as { taskId?: string }).taskId === taskId;
    }, { intentSlot, taskId })).toBe(true);

    await cancel.click();
    await expect(
      page.getByTestId(`${kind}-node-${nodeId(kind)}`).getByRole("alert"),
    ).toContainText("取消结果无法确认，任务仍在查询中");

    await expect(cancel).toBeVisible();
    await expect(cancel).toBeEnabled();
    await expect(creator.getByRole("button", { name: "Generate" }))
      .toHaveCount(0);
    expect(routes.cancelRequests(kind)).toBe(1);
    expect(routes.submissions(kind)).toBe(1);
    const readsAfterCancel = routes.statusReads(kind);
    await expect.poll(() => routes.statusReads(kind), { timeout: 3_000 })
      .toBeGreaterThan(readsAfterCancel);
    await expect.poll(async () => page.evaluate(({ intentSlot, taskId }) => {
      const serialized = window.localStorage.getItem(intentSlot);
      if (!serialized) return false;
      return (JSON.parse(serialized) as { taskId?: string }).taskId === taskId;
    }, { intentSlot, taskId })).toBe(true);
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        taskId: data?.[`${kind}GenerationTaskId`],
      };
    }).toEqual({ taskId });

    expect(routes.providerRequests()).toBe(0);
  });
}

test("four nodes pin the effective default before a lost paid response and recover the same task after catalog drift", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  type CanvasAck = {
    data: Record<string, unknown>;
    graphRevision?: number;
  };
  type PostEvidence = {
    ackedSnapshot: boolean;
    canvasRevision?: number;
    model?: string;
  };

  let currentKind: Kind = "text";
  let defaultVersion: "A" | "B" = "A";
  let providerRequests = 0;
  const builtTasks = new Set<Kind>();
  const lostLookups = new Set<Kind>();
  const canvasAcks = new Map<Kind, CanvasAck>();
  const createPosts = new Map<Kind, number>();
  const postEvidence = new Map<Kind, PostEvidence>();
  const submittedIdentities = new Map<
    Kind,
    SubmittedGenerationIdentity & { idempotencyKey: string; model?: string }
  >();

  const providerRequestListener = (inbound: { url(): string }) => {
    if (/volces|openrouter|mureka/i.test(inbound.url())) providerRequests += 1;
  };
  page.on("request", providerRequestListener);

  await page.route("**/api/canvases/default/commands", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as {
      authoritativeDocument?: {
        graphRevision?: number;
        nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
      };
    };
    if (response.ok() && body.authoritativeDocument) {
      for (const kind of kinds) {
        const data = body.authoritativeDocument.nodes?.find((node) =>
          node.id === nodeId(kind)
        )?.data;
        if (!data) continue;
        canvasAcks.set(kind, {
          data,
          graphRevision: body.authoritativeDocument.graphRevision,
        });
      }
    }
    await route.fulfill({ response, json: body });
  });

  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    const identity = submittedIdentities.get(currentKind);
    await route.fulfill({
      response,
      json: !identity || !builtTasks.has(currentKind)
        ? document
        : {
            ...document,
            nodes: document.nodes?.map((node) =>
              node.id === nodeId(currentKind)
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      ...generationNodeIdentityData(currentKind, identity),
                      [`${currentKind}GenerationTaskId`]:
                        `default-drift-lost-task-${currentKind}`,
                    },
                  }
                : node
            ),
          },
    });
  });

  await page.route("**/api/models", async (route) => {
    const kind = currentKind;
    const published = (["A", "B"] as const).map((version) => ({
      capability: kind,
      configurationRevision: version === "A"
        ? modelInputs[kind].configurationRevision
        : "a04100000000000000000005",
      displayName: `Default ${version} ${kind}`,
      generationAvailable: true,
      generationUnavailableReason: "",
      generationUnavailableReasonCode: null,
      id: version === "A"
        ? modelInputs[kind].id
        : `${modelInputs[kind].id}-v2`,
      isDefault: version === defaultVersion,
      parameterSchema: schemas[kind],
      providerDriver: modelInputs[kind].providerDriver,
      providerModelId: modelInputs[kind].providerModelId,
      releaseRevisionId: version === "A"
        ? modelInputs[kind].releaseRevisionId
        : "a0410000-0000-4000-8000-000000000005",
    }));
    await route.fulfill({
      json: { generationEnabled: true, models: published },
      status: 200,
    });
  });

  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    const kind = currentKind;
    const taskId = `default-drift-lost-task-${kind}`;
    const prompt = `${kind} 原始提示词`;
    const inputKey = generationInputKey({
      inputs: [],
      modelId: modelInputs[kind].id,
      ownPrompt: prompt,
      parameters: submissionParameterValues(
        schemas[kind],
        defaultParameterValues(schemas[kind]),
      ),
      prompt,
    });
    const failedTask = {
      ...(submittedIdentities.has(kind)
        ? submittedGenerationIdentity(submittedIdentities.get(kind)!)
        : {}),
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-12T08:00:00.000Z",
      errorCode: "DEFAULT_DRIFT_FIXTURE",
      errorMessage: `${kind} default drift fixture failure`,
      generationInputKey: submittedIdentities.get(kind)?.generationInputKey ??
        inputKey,
      idempotencyKey: submittedIdentities.get(kind)?.idempotencyKey,
      id: taskId,
      kind,
      model: submittedIdentities.get(kind)?.model,
      nodeId: nodeId(kind),
      prompt,
      retryAllowed: false,
      retryBlockCode: "DEFAULT_DRIFT_FIXTURE",
      retryBlockReason: "fixture blocks retry",
      state: "failed",
      updatedAt: "2026-08-12T08:00:01.000Z",
    };

    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
      await route.fulfill({
        json: { canEnqueue: true, canSubmit: true, canvasRevision: route.request().postDataJSON().canvasRevision, problems: [] },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      if (!builtTasks.has(kind)) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (!lostLookups.has(kind)) {
        lostLookups.add(kind);
        await route.abort("failed");
        return;
      }
      await route.fulfill({ json: failedTask, status: 200 });
      return;
    }
    if (
      url.pathname === `/api/generation-tasks/${taskId}` &&
      inbound.method() === "GET"
    ) {
      await route.fulfill({ json: failedTask, status: 200 });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "GET") {
      await route.fulfill({ json: { tasks: builtTasks.has(kind) ? [failedTask] : [] }, status: 200 });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "POST") {
      const body = inbound.postDataJSON() as {
        canvasRevision?: number;
        idempotencyKey: string;
        model?: string;
      } & SubmittedGenerationIdentity;
      createPosts.set(kind, (createPosts.get(kind) ?? 0) + 1);
      submittedIdentities.set(kind, body);
      const ack = canvasAcks.get(kind);
      const modelNameKey = kind === "video" ? "videoModel" : `${kind}ModelName`;
      const expectedParameters = defaultParameterValues(schemas[kind]);
      const ackedParameters = ack?.data[`${kind}Parameters`];
      postEvidence.set(kind, {
        ackedSnapshot: Boolean(
          ack &&
          ack.data[`${kind}ModelId`] === modelInputs[kind].id &&
          ack.data[modelNameKey] === `Default A ${kind}` &&
          JSON.stringify(ackedParameters) ===
            JSON.stringify(expectedParameters) &&
          (kind !== "image" || (
            ack.data.imageAspectRatio === expectedParameters.aspectRatio &&
            ack.data.imageQuality === expectedParameters.quality
          ))
        ),
        canvasRevision: body.canvasRevision,
        model: body.model,
      });
      builtTasks.add(kind);
      // The server-side task exists, but neither the POST response nor the
      // immediate idempotency reconciliation reaches this page.
      await route.abort("failed");
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  try {
    for (const kind of kinds) {
      currentKind = kind;
      defaultVersion = "A";
      builtTasks.delete(kind);
      lostLookups.delete(kind);
      canvasAcks.delete(kind);
      createPosts.delete(kind);
      postEvidence.delete(kind);
      submittedIdentities.delete(kind);
      if (page.url().startsWith("http")) {
        await page.evaluate(() => {
          window.localStorage.clear();
          window.sessionStorage.clear();
        });
      }

      await request.delete("/api/canvas/default");
      const [baseNode] = canvasNodes(kind);
      const data = { ...baseNode.data } as Record<string, unknown>;
      delete data[`${kind}ModelId`];
      delete data[`${kind}Parameters`];
      delete data[kind === "video" ? "videoModel" : `${kind}ModelName`];
      if (kind === "image") {
        delete data.imageAspectRatio;
        delete data.imageQuality;
      }
      expect((await request.put("/api/canvas/default", {
        data: {
          edges: [],
          nodes: [{ ...baseNode, data }],
          revision: 0,
          viewport: { x: 0, y: 0, zoom: 0.75 },
        },
      })).ok()).toBeTruthy();

      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await selectNode(page, kind);
      const generate = page.getByTestId(`${kind}-creator`)
        .getByRole("button", { name: "Generate" });
      await expect(generate).toBeEnabled();
      await generate.click();
      await expect.poll(() => createPosts.get(kind) ?? 0).toBe(1);
      await expect.poll(() => lostLookups.has(kind)).toBe(true);
      await expect(generate).toBeEnabled();

      const evidence = postEvidence.get(kind);
      expect(evidence).toMatchObject({
        ackedSnapshot: true,
        model: modelInputs[kind].id,
      });
      await expect.poll(() => canvasAcks.get(kind)?.graphRevision)
        .toBe(evidence?.canvasRevision);

      const expectedParameters = defaultParameterValues(schemas[kind]);
      const beforeReload = await readPageCanvas(page);
      const pinnedBeforeReload = beforeReload.nodes.find(
        (node) => node.id === nodeId(kind),
      )?.data;
      expect(pinnedBeforeReload?.[`${kind}ModelId`])
        .toBe(modelInputs[kind].id);
      expect(pinnedBeforeReload?.[`${kind}Parameters`])
        .toEqual(expectedParameters);
      expect(pinnedBeforeReload?.[`${kind}GenerationTaskId`])
        .toBe(`default-drift-lost-task-${kind}`);
      if (kind === "image") {
        expect(pinnedBeforeReload?.imageAspectRatio)
          .toBe(expectedParameters.aspectRatio);
        expect(pinnedBeforeReload?.imageQuality)
          .toBe(expectedParameters.quality);
      }
      await expect.poll(() => page.evaluate((slot) =>
        window.localStorage.getItem(slot), submissionIntentSlot(kind)))
        .not.toBeNull();

      defaultVersion = "B";
      await page.reload();
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await expect.poll(async () => {
        const canvas = await readPageCanvas(page);
        return canvas.nodes.find((node) => node.id === nodeId(kind))
          ?.data[`${kind}GenerationTaskId`];
      }).toBe(`default-drift-lost-task-${kind}`);

      const recovered = await readPageCanvas(page);
      const recoveredData = recovered.nodes.find(
        (node) => node.id === nodeId(kind),
      )?.data;
      expect(recoveredData?.[`${kind}ModelId`]).toBe(modelInputs[kind].id);
      expect(recoveredData?.[`${kind}Parameters`]).toEqual(expectedParameters);
      if (kind === "image") {
        expect(recoveredData?.imageAspectRatio)
          .toBe(expectedParameters.aspectRatio);
        expect(recoveredData?.imageQuality).toBe(expectedParameters.quality);
      }
      expect(createPosts.get(kind)).toBe(1);
      expect(providerRequests).toBe(0);
    }
  } finally {
    page.off("request", providerRequestListener);
    await page.unroute("**/api/models");
    await page.unroute("**/api/canvas/default");
    await page.unroute("**/api/canvases/default/commands");
    await page.unroute("**/api/generation-tasks**");
    await request.delete("/api/canvas/default");
  }
});

for (const lateCancelCase of (["video", "audio"] as const).flatMap(
  (kind) => (["success", "error"] as const).map((outcome) => ({ kind, outcome })),
)) {
  const { kind, outcome } = lateCancelCase;
  test(`${kind} ignores a late old-cancel ${outcome} after changed input starts a new owned run`, async ({
    page,
    request,
  }) => {
    const oldTaskId = `m41-${kind}-late-cancel-old`;
    const newTaskId = `m41-${kind}-late-cancel-new`;
    const newPrompt = `${kind} new owner prompt`;
    const oldCancelMessage = `${kind} old cancel ${outcome} must stay hidden`;
    const oldIdentity = currentStandaloneIdentity(kind);
    const oldRunning = {
      ...oldIdentity,
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T14:00:00.000Z",
      id: oldTaskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      state: "running",
      updatedAt: "2026-08-09T14:00:00.500Z",
    };
    const newQueued = {
      ...oldRunning,
      createdAt: "2026-08-09T14:00:01.000Z",
      id: newTaskId,
      prompt: newPrompt,
      state: "queued",
      updatedAt: "2026-08-09T14:00:01.500Z",
    };
    const resultAssetId = `m41-${kind}-late-cancel-result`;
    const newSuccess = {
      ...newQueued,
      canvasProjectionState: "applied",
      resultAssetId,
      resultMedia: {
        byteSize: 1_024,
        checksumSha256: "a".repeat(64),
        contentType: kind === "video" ? "video/mp4" : "audio/mpeg",
        durationSeconds: 8,
        durationStatus: "ready",
        mediaHeight: kind === "video" ? 720 : null,
        mediaWidth: kind === "video" ? 1_280 : null,
        storageBackend: "local",
      },
      resultUrl: mediaAssetUrl(kind, resultAssetId),
      state: "success",
      updatedAt: "2026-08-09T14:00:02.000Z",
    };
    let acceptedNewQueued: Record<string, unknown> = newQueued;
    let acceptedNewSuccess: Record<string, unknown> = newSuccess;
    let newBindingTask: GenerationTaskSummary | undefined;
    let newProjectionApplied = false;
    let cancelRequests = 0;
    let createPosts = 0;
    let listOldTask = true;
    let oldTaskReads = 0;
    let markCancelStarted!: () => void;
    const cancelStarted = new Promise<void>((resolve) => {
      markCancelStarted = resolve;
    });
    let markNewPollStarted!: () => void;
    const newPollStarted = new Promise<void>((resolve) => {
      markNewPollStarted = resolve;
    });
    let markOldPollStarted!: () => void;
    const oldPollStarted = new Promise<void>((resolve) => {
      markOldPollStarted = resolve;
    });
    let providerRequests = 0;
    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    let releaseNewPoll!: () => void;
    const newPollGate = new Promise<void>((resolve) => {
      releaseNewPoll = resolve;
    });
    let releaseOldPoll!: () => void;
    const oldPollGate = new Promise<void>((resolve) => {
      releaseOldPoll = resolve;
    });

    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    if (kind === "audio") {
      await page.route("**/api/audio-assets/**", async (route) => {
        await route.fulfill({ body: "", status: 404 });
      });
    }
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `${kind} late cancel owner`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
          ...modelInputs[kind],
            isDefault: true,
            parameterSchema: schemas[kind],
            ...(kind === "audio"
              ? { providerProtocol: "media-generate" }
              : {}),
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/canvas/default", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const document = await response.json() as {
        nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
      };
      await route.fulfill({
        response,
        json: !newBindingTask
          ? document
          : {
              ...document,
              nodes: document.nodes?.map((node) =>
                node.id === nodeId(kind)
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        ...(newProjectionApplied
                          ? authoritativeGenerationSuccessData(
                              kind,
                              acceptedNewSuccess as unknown as GenerationTaskSummary,
                            )
                          : authoritativeGenerationBindingData(
                              kind,
                              newBindingTask!,
                            )),
                      },
                    }
                  : node
              ),
            },
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
          json: {
            paidProviderRequests: 0,
            persistentQueueReady: true,
            providerConfigured: true,
            submissionEnabled: true,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
        await route.fulfill({
          json: { canEnqueue: true, canSubmit: true, canvasRevision: route.request().postDataJSON().canvasRevision, problems: [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({
          json: { tasks: listOldTask ? [oldRunning] : [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${oldTaskId}` &&
        inbound.method() === "GET"
      ) {
        oldTaskReads += 1;
        if (oldTaskReads === 1) {
          await route.fulfill({ json: oldRunning, status: 200 });
          return;
        }
        markOldPollStarted();
        await oldPollGate;
        await route.fulfill({ json: oldRunning, status: 200 }).catch(() => undefined);
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${oldTaskId}` &&
        inbound.method() === "DELETE"
      ) {
        cancelRequests += 1;
        listOldTask = false;
        markCancelStarted();
        await cancelGate;
        if (outcome === "success") {
          await route.fulfill({
            json: {
              ...oldRunning,
              errorMessage: oldCancelMessage,
              state: "cancelled",
            },
            status: 200,
          }).catch(() => undefined);
        } else {
          await route.fulfill({
            json: { code: "OLD_CANCEL_FAILED", error: oldCancelMessage },
            status: 500,
          }).catch(() => undefined);
        }
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "POST"
      ) {
        const body = inbound.postDataJSON() as SubmittedGenerationIdentity & {
          idempotencyKey: string;
          model?: string;
        };
        createPosts += 1;
        const acceptedIdentity = submittedGenerationIdentity(body);
        acceptedNewQueued = {
          ...newQueued,
          ...acceptedIdentity,
          idempotencyKey: body.idempotencyKey,
          model: body.model ?? modelInputs[kind].id,
        };
        acceptedNewSuccess = {
          ...newSuccess,
          ...acceptedIdentity,
          idempotencyKey: body.idempotencyKey,
          model: body.model ?? modelInputs[kind].id,
        };
        newBindingTask = acceptedNewQueued as unknown as GenerationTaskSummary;
        await route.fulfill({ json: acceptedNewQueued, status: 202 });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${newTaskId}` &&
        inbound.method() === "GET"
      ) {
        markNewPollStarted();
        await newPollGate;
        newProjectionApplied = true;
        await route.fulfill({ json: acceptedNewSuccess, status: 200 }).catch(() => undefined);
        return;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes(kind);
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: {
            ...baseNode.data,
            [`${kind}Generating`]: true,
            [`${kind}GenerationContractFingerprint`]:
              oldIdentity.modelInputContractFingerprint,
            [`${kind}GenerationInputKey`]: oldIdentity.generationInputKey,
            [`${kind}GenerationModelConfigurationRevision`]:
              oldIdentity.modelConfigurationRevision,
            [`${kind}GenerationModelInputContractFingerprint`]:
              oldIdentity.modelInputContractFingerprint,
            [`${kind}GenerationModelReleaseRevision`]:
              oldIdentity.modelReleaseRevision,
            [`${kind}GenerationOwnershipKey`]:
              oldIdentity.generationOwnershipKey,
            [`${kind}GenerationTaskId`]: oldTaskId,
          },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await oldPollStarted;
      await selectNode(page, kind);
      const creator = page.getByTestId(`${kind}-creator`);
      const cancel = creator.getByRole("button", { name: "取消生成" });
      await expect(cancel).toBeEnabled();
      await cancel.click();
      releaseOldPoll();
      await cancelStarted;
      expect(cancelRequests).toBe(1);

      const prompt = kind === "audio"
        ? page.getByLabel("音频提示词")
        : page.getByTestId("video-creator-prompt");
      await prompt.evaluate((element) => {
        element.removeAttribute("disabled");
      });
      await prompt.fill(newPrompt);
      await prompt.blur();
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          prompt: data?.[`${kind}Prompt`],
          taskId: data?.[`${kind}GenerationTaskId`] ?? null,
        };
      }).toEqual({ prompt: newPrompt, taskId: null });

      await creator.getByRole("button", { name: "Generate" }).click();
      await newPollStarted;
      await expect.poll(async () => {
        const canvas = await readPageCanvas(page);
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          prompt: data?.[`${kind}Prompt`],
          taskId: data?.[`${kind}GenerationTaskId`],
        };
      }).toEqual({ prompt: newPrompt, taskId: newTaskId });
      expect(createPosts).toBe(1);

      const oldCancelResponse = page.waitForResponse((response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname ===
          `/api/generation-tasks/${oldTaskId}`);
      releaseCancel();
      await oldCancelResponse;
      await flushBrowserTasks(page);
      await flushBrowserTasks(page);
      const node = page.getByTestId(`${kind}-node-${nodeId(kind)}`);
      await expect(node).not.toContainText(oldCancelMessage);
      await expect(node.getByRole("alert")).toHaveCount(0);
      await expect(prompt).toHaveValue(newPrompt);
      const afterOldCancel = await readPageCanvas(page);
      expect(afterOldCancel.nodes.find(
        (node) => node.id === nodeId(kind),
      )?.data).toEqual(expect.objectContaining({
        [`${kind}GenerationTaskId`]: newTaskId,
        [`${kind}Prompt`]: newPrompt,
      }));

      releaseNewPoll();
      await expect.poll(async () => {
        const canvas = await readPageCanvas(page);
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          prompt: data?.[`${kind}Prompt`],
          src: data?.[`${kind}Src`],
          taskId: data?.[`${kind}GenerationTaskId`] ?? null,
        };
      }).toEqual({
        prompt: newPrompt,
        src: mediaAssetUrl(kind, resultAssetId),
        taskId: null,
      });
      expect(cancelRequests).toBe(1);
      expect(createPosts).toBe(1);
      expect(providerRequests).toBe(0);
    } finally {
      releaseCancel();
      releaseNewPoll();
      releaseOldPoll();
      await request.delete("/api/canvas/default");
    }
  });
}

test("a caller-owned AbortSignal stops task polling without reporting a pause", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });
  let pauses = 0;
  globalThis.fetch = async (_input, init) => {
    markFetchStarted();
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("caller stopped", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  };
  try {
    await withWindowTimerGlobal(async () => {
      const polling = waitForGenerationTaskWithPause(
        "caller-aborted-task",
        () => {
          pauses += 1;
        },
        controller.signal,
      );
      await fetchStarted;
      controller.abort("scope changed");
      await expect(polling).rejects.toMatchObject({ name: "AbortError" });
    });
    expect(pauses).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an old Image poll cannot overwrite the newer task after cancellation and input revocation", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const oldTaskId = "m41-image-old-owner-task";
  const newTaskId = "m41-image-new-owner-task";
  const newPrompt = "image 新提示词";
  const oldIdentity = currentStandaloneIdentity("image");
  const oldRunning = {
    ...oldIdentity,
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T12:00:00.000Z",
    id: oldTaskId,
    kind: "image",
    model: modelInputs.image.id,
    nodeId: nodeId("image"),
    prompt: "image 原始提示词",
    state: "running",
    updatedAt: "2026-08-09T12:00:00.500Z",
  };
  const oldSuccess = {
    ...oldRunning,
    resultAssetId: "m41-image-old-owner-result",
    resultMedia: {
      byteSize: 701,
      contentType: "image/png",
      durationSeconds: null,
      durationStatus: "not-applicable",
      storageBackend: "local",
    },
    resultUrl: "/api/assets/m41-image-old-owner-result",
    state: "success",
    updatedAt: "2026-08-09T12:00:03.000Z",
  };
  const newQueued = {
    ...oldRunning,
    createdAt: "2026-08-09T12:00:01.000Z",
    id: newTaskId,
    prompt: newPrompt,
    state: "queued",
    updatedAt: "2026-08-09T12:00:01.500Z",
  };
  const newSuccess = {
    ...newQueued,
    canvasProjectionState: "applied",
    resultAssetId: "m41-image-new-owner-result",
    resultMedia: {
      byteSize: 702,
      checksumSha256: "a".repeat(64),
      contentType: "image/png",
      durationSeconds: null,
      durationStatus: "not-applicable",
      mediaHeight: 1_024,
      mediaWidth: 1_024,
      storageBackend: "local",
    },
    resultUrl: "/api/assets/m41-image-new-owner-result",
    state: "success",
    updatedAt: "2026-08-09T12:00:02.000Z",
  };
  let acceptedNewQueued: Record<string, unknown> = newQueued;
  let acceptedNewSuccess: Record<string, unknown> = newSuccess;
  let newBindingTask: GenerationTaskSummary | undefined;
  let newProjectionApplied = false;
  await page.addInitScript(({ oldRunning, oldSuccess, oldTaskId }) => {
    const state: {
      cancelled: boolean;
      delayedPollIssued: boolean;
      oldGets: number;
      releaseOld?: () => void;
    } = { cancelled: false, delayedPollIssued: false, oldGets: 0 };
    (window as typeof window & {
      __m41ImageOldOwner?: typeof state;
    }).__m41ImageOldOwner = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "DELETE" && url.pathname === `/api/generation-tasks/${oldTaskId}`) {
        return originalFetch(input, init).then((response) => {
          if (response.ok) state.cancelled = true;
          return response;
        });
      }
      if (
        method === "GET" &&
        url.pathname === `/api/generation-tasks/${oldTaskId}`
      ) {
        state.oldGets += 1;
        if (state.cancelled || state.delayedPollIssued || state.oldGets === 1) {
          return Promise.resolve(new Response(JSON.stringify(state.cancelled
            ? { ...oldRunning, state: "cancelled", errorMessage: "用户取消旧图片任务" }
            : oldRunning), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }));
        }
        state.delayedPollIssued = true;
        return new Promise<Response>((resolve) => {
          // Intentionally ignore the recovery effect's abort. Ownership, not
          // transport cooperation, must reject this late success.
          state.releaseOld = () => resolve(new Response(
            JSON.stringify(oldSuccess),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ));
        });
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, { oldRunning, oldSuccess, oldTaskId });

  let newGets = 0;
  let oldCancelled = false;
  let providerRequests = 0;
  let submittedPrompt = "";
  let taskSubmissions = 0;
  let releaseNew!: () => void;
  const newGate = new Promise<void>((resolve) => {
    releaseNew = resolve;
  });
  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: "image",
          displayName: "Image owner replacement",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.image,
          isDefault: true,
          parameterSchema: schemas.image,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      response,
      json: !newBindingTask
        ? document
        : {
            ...document,
            nodes: document.nodes?.map((node) =>
              node.id === nodeId("image")
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      ...(newProjectionApplied
                        ? authoritativeGenerationSuccessData(
                            "image",
                            acceptedNewSuccess as unknown as GenerationTaskSummary,
                          )
                        : authoritativeGenerationBindingData(
                            "image",
                            newBindingTask!,
                          )),
                    },
                  }
                : node
            ),
          },
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
      await route.fulfill({
        json: { canEnqueue: true, canSubmit: true, canvasRevision: route.request().postDataJSON().canvasRevision, problems: [] },
        status: 200,
      });
      return;
    }
    if (
      url.pathname === `/api/generation-tasks/${oldTaskId}` &&
      inbound.method() === "DELETE"
    ) {
      oldCancelled = true;
      await route.fulfill({
        json: {
          ...oldRunning,
          errorMessage: "用户取消旧图片任务",
          state: "cancelled",
        },
        status: 200,
      });
      return;
    }
    if (
      url.pathname === "/api/generation-tasks" &&
      inbound.method() === "GET"
    ) {
      await route.fulfill({
        json: { tasks: oldCancelled ? [] : [oldRunning] },
        status: 200,
      });
      return;
    }
    if (
      url.pathname === "/api/generation-tasks" &&
      inbound.method() === "POST"
    ) {
      taskSubmissions += 1;
      const body = inbound.postDataJSON() as SubmittedGenerationIdentity & {
        idempotencyKey: string;
        model?: string;
        prompt?: string;
      };
      submittedPrompt = body.prompt ?? "";
      const acceptedIdentity = submittedGenerationIdentity(body);
      acceptedNewQueued = {
        ...newQueued,
        ...acceptedIdentity,
        idempotencyKey: body.idempotencyKey,
        model: body.model ?? modelInputs.image.id,
      };
      acceptedNewSuccess = {
        ...newSuccess,
        ...acceptedIdentity,
        idempotencyKey: body.idempotencyKey,
        model: body.model ?? modelInputs.image.id,
      };
      newBindingTask = acceptedNewQueued as unknown as GenerationTaskSummary;
      await route.fulfill({ json: acceptedNewQueued, status: 202 });
      return;
    }
    if (
      url.pathname === `/api/generation-tasks/${newTaskId}` &&
      inbound.method() === "GET"
    ) {
      newGets += 1;
      await newGate;
      newProjectionApplied = true;
      await route.fulfill({ json: acceptedNewSuccess, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes("image");
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          assetId: "m41-image-old-preview",
          imageGeneratedSuccess: true,
          imageGenerating: true,
          imageGenerationContractFingerprint:
            oldIdentity.modelInputContractFingerprint,
          imageGenerationInputKey: oldIdentity.generationInputKey,
          imageGenerationModelConfigurationRevision:
            oldIdentity.modelConfigurationRevision,
          imageGenerationModelReleaseRevision:
            oldIdentity.modelReleaseRevision,
          imageGenerationOwnershipKey: oldIdentity.generationOwnershipKey,
          imageGenerationTaskId: oldTaskId,
          imageSrc: "/api/assets/m41-image-old-preview",
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41ImageOldOwner?: { oldGets: number };
      }).__m41ImageOldOwner?.oldGets ?? 0)).toBeGreaterThanOrEqual(2);
    await selectNode(page, "image");
    const creator = page.getByTestId("image-creator");
    const cancel = creator.getByRole("button", { name: "取消生成" });
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect(cancel).toHaveCount(0);

    const prompt = page.getByTestId("image-creator-prompt");
    await prompt.fill(newPrompt);
    await prompt.blur();
    await creator.getByRole("button", { name: "Generate" }).click();
    await expect.poll(() => newGets).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      const data = canvas.nodes.find((node) => node.id === nodeId("image"))?.data;
      return data?.imageGenerationTaskId;
    }).toBe(newTaskId);

    releaseNew();
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      const data = canvas.nodes.find((node) => node.id === nodeId("image"))?.data;
      return {
        assetId: data?.assetId,
        src: data?.imageSrc,
        taskId: data?.imageGenerationTaskId ?? null,
      };
    }).toEqual({
      assetId: "m41-image-new-owner-result",
      src: "/api/assets/m41-image-new-owner-result",
      taskId: null,
    });

    await page.evaluate(() => {
      (window as typeof window & {
        __m41ImageOldOwner?: { releaseOld?: () => void };
      }).__m41ImageOldOwner?.releaseOld?.();
    });
    await flushBrowserTasks(page);
    await flushBrowserTasks(page);
    await expect(page.getByTestId("image-node-preview")).toHaveAttribute(
      "src",
      "/api/assets/m41-image-new-owner-result",
    );
    const finalCanvas = await readPageCanvas(page);
    expect(finalCanvas.nodes.find((node) => node.id === nodeId("image"))?.data)
      .toEqual(expect.objectContaining({
        assetId: "m41-image-new-owner-result",
        imageSrc: "/api/assets/m41-image-new-owner-result",
      }));
    expect(finalCanvas.nodes.find((node) => node.id === nodeId("image"))?.data
      .imageGenerationTaskId).toBeUndefined();
    expect(submittedPrompt).toBe(newPrompt);
    expect(taskSubmissions).toBe(1);
    expect(providerRequests).toBe(0);
  } finally {
    releaseNew();
    await page.evaluate(() => {
      (window as typeof window & {
        __m41ImageOldOwner?: { releaseOld?: () => void };
      }).__m41ImageOldOwner?.releaseOld?.();
    }).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

for (const retryPollingCase of [
  { failure: "GET 500", kind: "image" },
  { failure: "GET 500", kind: "video" },
  { failure: "GET 500", kind: "audio" },
  { failure: "fetch hung", kind: "image" },
  { failure: "body hung", kind: "image" },
] as const) {
  const { failure, kind } = retryPollingCase;
  test(`${kind} retry acceptance pauses on ${failure}, then rechecks the same task without another POST`, async ({
    page,
    request,
  }) => {
    const taskId = `m41-${kind}-retry-poll-${failure.replaceAll(" ", "-")}`;
    const resultAssetId = `m41-${kind}-retry-poll-result-${failure.replaceAll(" ", "-")}`;
    const transientFailureCount = 3;
    const identity = currentStandaloneIdentity(kind);
    const inputKey = identity.generationInputKey;
    const ownershipKey = identity.generationOwnershipKey;
    const failedTask = {
      ...identity,
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T12:30:00.000Z",
      errorCode: "AUTH",
      errorMessage: `${kind} retry fixture failure`,
      generationInputKey: inputKey,
      generationOwnershipKey: ownershipKey,
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      retryAllowed: true,
      state: "failed",
      updatedAt: "2026-08-09T12:30:00.500Z",
    };
    const queuedTask = {
      ...failedTask,
      attempt: 2,
      errorCode: undefined,
      errorMessage: undefined,
      retryAllowed: false,
      state: "queued",
      updatedAt: "2026-08-09T12:30:01.000Z",
    };
    const successTask = {
      ...queuedTask,
      canvasProjectionState: "applied",
      resultAssetId,
      resultMedia: {
        byteSize: 800,
        checksumSha256: "b".repeat(64),
        contentType: kind === "image"
          ? "image/png"
          : kind === "video"
            ? "video/mp4"
            : "audio/mpeg",
        durationSeconds: kind === "image" ? null : 6,
        durationStatus: kind === "image" ? "not-applicable" : "ready",
        mediaHeight: kind === "audio" ? null : 720,
        mediaWidth: kind === "audio" ? null : 1_280,
        storageBackend: "local",
      },
      resultUrl: mediaAssetUrl(kind, resultAssetId),
      state: "success",
      updatedAt: "2026-08-09T12:30:02.000Z",
    };
    if (failure !== "GET 500") {
      await page.clock.install();
      await page.addInitScript(({ failure, taskId, transientFailureCount }) => {
        const state = { hungStarts: 0, retryAccepted: false };
        (window as typeof window & {
          __m41RetryHungDetail?: typeof state;
        }).__m41RetryHungDetail = state;
        const originalFetch = window.fetch.bind(window);
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
          const raw = typeof input === "string" || input instanceof URL
            ? String(input)
            : input.url;
          const url = new URL(raw, window.location.href);
          const method = (init?.method ??
            (input instanceof Request ? input.method : "GET")).toUpperCase();
          if (
            method === "GET" &&
            url.pathname === `/api/generation-tasks/${taskId}` &&
            state.retryAccepted &&
            state.hungStarts < transientFailureCount
          ) {
            state.hungStarts += 1;
            if (failure === "fetch hung") {
              return new Promise<Response>(() => {
                // The status deadline must not depend on fetch honoring abort.
              });
            }
            const response = new Response(null, {
              headers: { "Content-Type": "application/json" },
              status: 200,
            });
            Object.defineProperty(response, "json", {
              configurable: true,
              value: () => new Promise(() => {
                // Headers arrived, but the body permanently ignores abort.
              }),
            });
            return Promise.resolve(response);
          }
          return originalFetch(input, init);
        }) as typeof window.fetch;
      }, { failure, taskId, transientFailureCount });
    }

    let createPosts = 0;
    let postAcceptanceDetailReads = 0;
    let providerRequests = 0;
    let projectionApplied = false;
    let retryAccepted = false;
    let retryPosts = 0;
    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    if (kind === "audio") {
      await page.route("**/api/audio-assets/**", async (route) => {
        await route.fulfill({ body: "", status: 404 });
      });
    }
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `${kind} retry polling`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
          ...modelInputs[kind],
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/canvas/default", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const document = await response.json() as {
        nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
      };
      await route.fulfill({
        response,
        json: !projectionApplied
          ? document
          : {
              ...document,
              nodes: document.nodes?.map((node) =>
                node.id === nodeId(kind)
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        ...authoritativeGenerationSuccessData(
                          kind,
                          successTask as unknown as GenerationTaskSummary,
                        ),
                      },
                    }
                  : node
              ),
            },
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
          json: {
            paidProviderRequests: 0,
            persistentQueueReady: true,
            providerConfigured: true,
            submissionEnabled: true,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({
          json: { tasks: retryAccepted ? [] : [failedTask] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}/retry` &&
        inbound.method() === "POST"
      ) {
        retryPosts += 1;
        retryAccepted = true;
        if (failure !== "GET 500") {
          await page.evaluate(() => {
            const state = (window as typeof window & {
              __m41RetryHungDetail?: {
                retryAccepted: boolean;
              };
            }).__m41RetryHungDetail;
            if (state) state.retryAccepted = true;
          });
        }
        await route.fulfill({ json: queuedTask, status: 202 });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}` &&
        inbound.method() === "GET"
      ) {
        if (!retryAccepted) {
          await route.fulfill({ json: failedTask, status: 200 });
          return;
        }
        postAcceptanceDetailReads += 1;
        if (
          failure === "GET 500" &&
          postAcceptanceDetailReads <= transientFailureCount
        ) {
          await route.fulfill({
            json: { code: "TEMPORARY", error: "temporary status outage" },
            status: 500,
          });
        } else {
          projectionApplied = true;
          await route.fulfill({ json: successTask, status: 200 });
        }
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "POST"
      ) {
        createPosts += 1;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes(kind);
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: {
            ...baseNode.data,
            [`${kind}GenerationError`]: `${kind} retry fixture failure`,
            [`${kind}GenerationErrorCode`]: "AUTH",
            [`${kind}GenerationContractFingerprint`]:
              identity.modelInputContractFingerprint,
            [`${kind}GenerationInputKey`]: inputKey,
            [`${kind}GenerationModelConfigurationRevision`]:
              identity.modelConfigurationRevision,
            [`${kind}GenerationModelInputContractFingerprint`]:
              identity.modelInputContractFingerprint,
            [`${kind}GenerationModelReleaseRevision`]:
              identity.modelReleaseRevision,
            [`${kind}GenerationOwnershipKey`]: ownershipKey,
            [`${kind}Generating`]: false,
            [`${kind}GenerationRetryAllowed`]: true,
            [`${kind}GenerationTaskId`]: taskId,
            ...(kind === "audio"
              ? {}
              : {
                  [`${kind}Src`]: mediaAssetUrl(
                    kind,
                    `m41-${kind}-retry-old`,
                  ),
                }),
          },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas", { waitUntil: "domcontentloaded" });
      if (failure !== "GET 500") {
        await flushBrowserTasks(page);
        await page.clock.runFor(200);
      }
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await selectNode(page, kind);
      const retry = retryButton(page, kind);
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect.poll(() => retryPosts).toBe(1);
      if (failure !== "GET 500") {
        await expect.poll(() => page.evaluate(() =>
          (window as typeof window & {
            __m41RetryHungDetail?: { hungStarts: number };
          }).__m41RetryHungDetail?.hungStarts ?? 0)).toBe(1);
        await page.clock.fastForward(10_100);
        await page.clock.fastForward(1_100);
        await expect.poll(() => page.evaluate(() =>
          (window as typeof window & {
            __m41RetryHungDetail?: { hungStarts: number };
          }).__m41RetryHungDetail?.hungStarts ?? 0)).toBe(2);
        await page.clock.fastForward(10_100);
        await page.clock.fastForward(2_100);
        await expect.poll(() => page.evaluate(() =>
          (window as typeof window & {
            __m41RetryHungDetail?: { hungStarts: number };
          }).__m41RetryHungDetail?.hungStarts ?? 0)).toBe(3);
        await page.clock.fastForward(10_100);
      } else {
        await expect.poll(() => postAcceptanceDetailReads)
          .toBe(transientFailureCount);
      }

      const node = page.getByTestId(`${kind}-node-${nodeId(kind)}`);
      await expect(node.getByRole("alert")).toContainText("点击重试重新检查");
      const recheck = node.getByRole("button", { name: "重新检查任务状态" });
      await expect(recheck).toBeVisible();
      await expect.poll(async () => {
        const canvas = await readPageCanvas(page);
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return data?.[`${kind}GenerationTaskId`];
      }).toBe(taskId);
      if (failure === "GET 500") {
        expect(postAcceptanceDetailReads).toBe(transientFailureCount);
      } else {
        expect(await page.evaluate(() =>
          (window as typeof window & {
            __m41RetryHungDetail?: { hungStarts: number };
          }).__m41RetryHungDetail?.hungStarts ?? 0)).toBe(transientFailureCount);
      }
      expect(retryPosts).toBe(1);
      expect(createPosts).toBe(0);

      // Dispatch two user clicks in the same turn. The first click owns the
      // new observation session; the second must not start another watcher.
      await recheck.evaluate((button) => {
        const click = () => button.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
        click();
        click();
      });
      await expect.poll(async () => {
        const canvas = await readPageCanvas(page);
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          errorCode: data?.[`${kind}GenerationErrorCode`] ?? null,
          generating: data?.[`${kind}Generating`],
          src: data?.[`${kind}Src`],
          taskId: data?.[`${kind}GenerationTaskId`] ?? null,
        };
      }, { timeout: 15_000 }).toEqual({
        errorCode: null,
        generating: false,
        src: mediaAssetUrl(kind, resultAssetId),
        taskId: null,
      });
      expect(retryPosts).toBe(1);
      expect(createPosts).toBe(0);
      if (failure === "GET 500") {
        expect(postAcceptanceDetailReads).toBe(transientFailureCount + 1);
      } else {
        expect(await page.evaluate(() =>
          (window as typeof window & {
            __m41RetryHungDetail?: { hungStarts: number };
          }).__m41RetryHungDetail?.hungStarts ?? 0)).toBe(transientFailureCount);
      }
      expect(providerRequests).toBe(0);
    } finally {
      await request.delete("/api/canvas/default");
    }
  });
}

// Generate is intentionally disabled as soon as the canvas becomes dirty.
// Retry stays clickable and owns the wait-for-save gate covered below; the
// paid create path's final input fence is covered by the held ensure tests.
for (const saveGateCase of (["image", "video", "audio"] as const).flatMap(
  (kind) => [
    { inputChanged: true, kind },
    { inputChanged: false, kind },
  ],
)) {
  const { inputChanged, kind } = saveGateCase;
  test(`${kind} Retry save gate ${
    inputChanged ? "cancels after an input change" : "submits exactly once for unchanged input"
  }`, async ({ page, request }) => {
    const taskId = `m41-${kind}-retry-save-gate-task`;
    const resultAssetId = `m41-${kind}-retry-save-gate-result`;
    const originalPrompt = `${kind} 原始提示词`;
    const changedPrompt = `${kind} save gate changed prompt`;
    const identity = currentStandaloneIdentity(kind);
    const inputKey = identity.generationInputKey;
    const ownershipKey = identity.generationOwnershipKey;
    const baseTask = {
      ...identity,
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T13:00:00.000Z",
      generationInputKey: inputKey,
      generationOwnershipKey: ownershipKey,
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: originalPrompt,
      updatedAt: "2026-08-09T13:00:00.500Z",
    };
    const failedTask = {
      ...baseTask,
      errorCode: "AUTH",
      errorMessage: `${kind} retryable fixture failure`,
      retryAllowed: true,
      state: "failed",
    };
    const queuedTask = {
      ...baseTask,
      attempt: 2,
      state: "queued",
      updatedAt: "2026-08-09T13:00:01.000Z",
    };
    const successTask = {
      ...queuedTask,
      canvasProjectionState: "applied",
      resultAssetId,
      resultMedia: {
        byteSize: 900,
        checksumSha256: "c".repeat(64),
        contentType: kind === "image"
          ? "image/png"
          : kind === "video"
            ? "video/mp4"
            : "audio/mpeg",
        durationSeconds: kind === "image" ? null : 7,
        durationStatus: kind === "image" ? "not-applicable" : "ready",
        mediaHeight: kind === "audio" ? null : 720,
        mediaWidth: kind === "audio" ? null : 1_280,
        storageBackend: "local",
      },
      resultUrl: mediaAssetUrl(kind, resultAssetId),
      state: "success",
      updatedAt: "2026-08-09T13:00:02.000Z",
    };
    let createPosts = 0;
    let generationAccepted = false;
    let providerRequests = 0;
    let projectionApplied = false;
    let retryPosts = 0;
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let markSaveStarted!: () => void;
    const saveStarted = new Promise<void>((resolve) => {
      markSaveStarted = resolve;
    });
    let heldSave = false;

    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `${kind} save gate`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
          ...modelInputs[kind],
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/canvas/default", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const document = await response.json() as {
        nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
      };
      await route.fulfill({
        response,
        json: !projectionApplied
          ? document
          : {
              ...document,
              nodes: document.nodes?.map((node) =>
                node.id === nodeId(kind)
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        ...authoritativeGenerationSuccessData(
                          kind,
                          successTask as unknown as GenerationTaskSummary,
                        ),
                      },
                    }
                  : node
              ),
            },
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
          json: {
            paidProviderRequests: 0,
            persistentQueueReady: true,
            providerConfigured: true,
            submissionEnabled: true,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
        await route.fulfill({
          json: { canEnqueue: true, canSubmit: true, canvasRevision: route.request().postDataJSON().canvasRevision, problems: [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({
          json: {
            tasks: generationAccepted ? [] : [failedTask],
          },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}/retry` &&
        inbound.method() === "POST"
      ) {
        retryPosts += 1;
        generationAccepted = true;
        await route.fulfill({ json: queuedTask, status: 202 });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "POST"
      ) {
        createPosts += 1;
        generationAccepted = true;
        await route.fulfill({ json: queuedTask, status: 202 });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}` &&
        inbound.method() === "GET"
      ) {
        if (generationAccepted) projectionApplied = true;
        await route.fulfill({
          json: generationAccepted ? successTask : failedTask,
          status: 200,
        });
        return;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes(kind);
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: {
            ...baseNode.data,
            ...generationNodeIdentityData(kind, identity),
            [`${kind}GenerationError`]: `${kind} retryable fixture failure`,
            [`${kind}GenerationErrorCode`]: "AUTH",
            [`${kind}Generating`]: false,
            [`${kind}GenerationRetryAllowed`]: true,
            [`${kind}GenerationTaskId`]: taskId,
          },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();
    await page.route("**/api/canvases/default/commands", async (route) => {
      if (route.request().method() !== "POST" || heldSave) {
        await route.fallback();
        return;
      }
      const body = route.request().postDataJSON() as {
        changes?: Array<{ field?: string; nodeId?: string; value?: unknown }>;
        kind?: string;
      };
      const titleChanged = body.kind === "apply-user-field-changes" &&
        body.changes?.some((change) =>
          change.nodeId === nodeId(kind) &&
          change.field === "data.title" &&
          change.value === `${kind} save gate dirty title`
        );
      if (!titleChanged) {
        await route.fallback();
        return;
      }
      heldSave = true;
      markSaveStarted();
      await saveGate;
      await route.fallback();
    });

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await selectNode(page, kind);
      const title = page.locator(
        `.react-flow__node[data-id="${nodeId(kind)}"] ` +
          'input[placeholder="请输入标题"]',
      );
      await title.fill(`${kind} save gate dirty title`);
      await saveStarted;

      const actionButton = retryButton(page, kind);
      await expect(actionButton).toBeEnabled();
      await actionButton.click();
      await expect(actionButton).toBeDisabled();
      expect(createPosts).toBe(0);
      expect(retryPosts).toBe(0);

      if (inputChanged) {
        const prompt = kind === "audio"
          ? page.getByLabel("音频提示词")
          : page.getByTestId(`${kind}-creator-prompt`);
        await prompt.fill(changedPrompt);
        await prompt.blur();
      }
      releaseSave();
      await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
      await flushBrowserTasks(page);
      await flushBrowserTasks(page);

      const expectedPosts = inputChanged ? 0 : 1;
      await expect.poll(() => retryPosts).toBe(expectedPosts);
      expect(createPosts).toBe(0);
      if (inputChanged) {
        await expect.poll(async () => {
          const canvas = await (
            await request.get("/api/canvas/default")
          ).json() as {
            nodes: Array<{ data: Record<string, unknown>; id: string }>;
          };
          const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
          return {
            prompt: data?.[`${kind}Prompt`],
            taskId: data?.[`${kind}GenerationTaskId`] ?? null,
          };
        }).toEqual({
          prompt: changedPrompt,
          taskId: null,
        });
      } else {
        await expect.poll(async () => {
          const canvas = await readPageCanvas(page);
          const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
          return {
            generating: data?.[`${kind}Generating`],
            src: data?.[`${kind}Src`],
            taskId: data?.[`${kind}GenerationTaskId`] ?? null,
          };
        }).toEqual({
          generating: false,
          src: mediaAssetUrl(kind, resultAssetId),
          taskId: null,
        });
      }
      expect(providerRequests).toBe(0);
    } finally {
      releaseSave();
      await request.delete("/api/canvas/default");
    }
  });
}

for (const ensureFenceCase of [
  { hold: "by-idempotency", kind: "image" },
  { hold: "preflight", kind: "video" },
  { hold: "preflight", kind: "audio" },
] as const) {
  const { hold, kind } = ensureFenceCase;
  test(`${kind} Generate rechecks live input after held ${hold} and before the paid POST`, async ({
    page,
    request,
  }) => {
    const changedPrompt = `${kind} changed inside ensure`;
    let createPosts = 0;
    let markHeldRequest!: () => void;
    const heldRequestStarted = new Promise<void>((resolve) => {
      markHeldRequest = resolve;
    });
    let providerRequests = 0;
    let releaseHeldRequest!: () => void;
    const heldRequest = new Promise<void>((resolve) => {
      releaseHeldRequest = resolve;
    });
    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `${kind} ensure fence`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
          ...modelInputs[kind],
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
          json: {
            paidProviderRequests: 0,
            persistentQueueReady: true,
            providerConfigured: true,
            submissionEnabled: true,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/by-idempotency")) {
        if (hold === "by-idempotency") {
          markHeldRequest();
          await heldRequest;
        }
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
        if (hold === "preflight") {
          markHeldRequest();
          await heldRequest;
        }
        await route.fulfill({
          json: { canEnqueue: true, canSubmit: true, canvasRevision: route.request().postDataJSON().canvasRevision, problems: [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({ json: { tasks: [] }, status: 200 });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "POST"
      ) {
        createPosts += 1;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await selectNode(page, kind);
      const creator = page.getByTestId(`${kind}-creator`);
      await creator.getByRole("button", { name: "Generate" }).click();
      await heldRequestStarted;
      await expect(creator.getByRole("button", {
        name: /正在保存画布|Submitting\.\.\./,
      })).toBeDisabled();
      expect(createPosts).toBe(0);

      const prompt = kind === "audio"
        ? page.getByLabel("音频提示词")
        : page.getByTestId(`${kind}-creator-prompt`);
      if (hold === "preflight") {
        await expect(prompt).toBeDisabled();
      } else {
        await prompt.fill(changedPrompt);
        await prompt.blur();
      }
      releaseHeldRequest();
      await expect(creator.getByRole("button", { name: "Generate" }))
        .toBeEnabled();
      if (hold === "by-idempotency") {
        await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
      }
      await flushBrowserTasks(page);
      await flushBrowserTasks(page);
      expect(createPosts).toBe(hold === "preflight" ? 1 : 0);
      expect(providerRequests).toBe(0);
      await expect.poll(() => page.evaluate((slot) =>
        window.localStorage.getItem(slot), submissionIntentSlot(kind)))
        .toBeNull();
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      expect(data?.[`${kind}Prompt`]).toBe(
        hold === "preflight" ? `${kind} 原始提示词` : changedPrompt,
      );
      expect(data?.[`${kind}GenerationTaskId`]).toBeUndefined();
      expect(data?.[`${kind}Generating`]).not.toBe(true);
    } finally {
      releaseHeldRequest();
      await request.delete("/api/canvas/default");
    }
  });
}

for (const recoveredPollingPath of [
  "initial-read-failure",
  "watch-read-failure",
  "watch-pause",
] as const) {
  for (const kind of kinds) {
    const pathLabel = recoveredPollingPath === "initial-read-failure"
      ? "initial read failure pauses for manual recovery"
      : recoveredPollingPath === "watch-read-failure"
        ? "watch read failure retries automatically"
        : "watch read failures pause for manual recovery";
    test(`${kind} recovered polling ${pathLabel} without POST`, async ({
      page,
      request,
    }) => {
    const taskId = `m41-recovered-polling-${recoveredPollingPath}-${kind}`;
    const resultAssetId = `m41-recovered-polling-result-${recoveredPollingPath}-${kind}`;
    const resultText = "m41 recovered Text result";
    const identity = currentStandaloneIdentity(kind);
    const activeInputKey = identity.generationInputKey;
    const ownershipKey = identity.generationOwnershipKey;
    const runningTask = {
      ...identity,
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T11:30:00.000Z",
      generationInputKey: activeInputKey,
      generationOwnershipKey: ownershipKey,
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      state: "running",
      updatedAt: "2026-08-09T11:30:00.500Z",
    };
    const successTask = {
      ...runningTask,
      canvasProjectionState: "applied",
      ...(kind === "text"
        ? { resultText }
        : {
            resultAssetId,
            resultMedia: {
              byteSize: 768,
              checksumSha256: "d".repeat(64),
              contentType: kind === "image"
                ? "image/png"
                : kind === "video"
                  ? "video/mp4"
                  : "audio/mpeg",
              durationSeconds: kind === "image" ? null : 5,
              durationStatus: kind === "image" ? "not-applicable" : "ready",
              mediaHeight: kind === "audio" ? null : 720,
              mediaWidth: kind === "audio" ? null : 1_280,
              storageBackend: "local",
            },
            resultUrl: mediaAssetUrl(kind, resultAssetId),
          }),
      state: "success",
      updatedAt: "2026-08-09T11:30:01.000Z",
    };
    let listReads = 0;
    let providerRequests = 0;
    let projectionApplied = false;
    let taskReads = 0;
    let taskSubmissions = 0;
    let canvasWrites = 0;

    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
      const url = new URL(entry.url());
      if (
        entry.method() !== "GET" &&
        (url.pathname === "/api/canvas/default" ||
          url.pathname === "/api/canvases/default/commands")
      ) {
        canvasWrites += 1;
      }
    });
    if (kind === "audio") {
      await page.route("**/api/audio-assets/**", async (route) => {
        await route.fulfill({ body: "", status: 404 });
      });
    }
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `Recovered pause ${kind}`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
          ...modelInputs[kind],
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/canvas/default", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const document = await response.json() as {
        nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
      };
      await route.fulfill({
        response,
        json: !projectionApplied
          ? document
          : {
              ...document,
              nodes: document.nodes?.map((node) =>
                node.id === nodeId(kind)
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        ...authoritativeGenerationSuccessData(
                          kind,
                          successTask as unknown as GenerationTaskSummary,
                        ),
                      },
                    }
                  : node
              ),
            },
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
          json: {
            paidProviderRequests: 0,
            persistentQueueReady: true,
            providerConfigured: true,
            submissionEnabled: true,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname === "/api/generation-tasks" && inbound.method() === "GET") {
        listReads += 1;
        await route.fulfill({ json: { tasks: [runningTask] }, status: 200 });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}` &&
        inbound.method() === "GET"
      ) {
        taskReads += 1;
        if (recoveredPollingPath === "initial-read-failure" && taskReads === 1) {
          await route.fulfill({
            json: { code: "TEMPORARY", error: "temporary polling outage" },
            status: 500,
          });
        } else if (
          recoveredPollingPath === "watch-read-failure" && taskReads === 2
        ) {
          await route.fulfill({
            json: { code: "TEMPORARY", error: "temporary polling outage" },
            status: 500,
          });
        } else if (
          recoveredPollingPath === "watch-pause" &&
          taskReads >= 2 &&
          taskReads <= 4
        ) {
          await route.fulfill({
            json: { code: "TEMPORARY", error: "temporary polling outage" },
            status: 503,
          });
        } else {
          const stillRunning = (
            recoveredPollingPath === "watch-read-failure" ||
            recoveredPollingPath === "watch-pause"
          ) && taskReads === 1;
          if (!stillRunning) projectionApplied = true;
          await route.fulfill({
            json: stillRunning ? runningTask : successTask,
            status: 200,
          });
        }
        return;
      }
      if (url.pathname === "/api/generation-tasks" && inbound.method() === "POST") {
        taskSubmissions += 1;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes(kind);
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: {
            ...baseNode.data,
            ...generationNodeIdentityData(kind, identity),
            [`${kind}Generating`]: true,
            [`${kind}GenerationTaskId`]: taskId,
            ...(kind === "text"
              ? {
                  content: "m41 recovered Text old result",
                  contentHtml: "<p>m41 recovered Text old result</p>",
                }
              : {
                  [`${kind}Src`]: mediaAssetUrl(
                    kind,
                    `m41-recovered-polling-old-${kind}`,
                  ),
                }),
          },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      if (kind === "audio") {
        await page.goto("/canvas", { waitUntil: "domcontentloaded" });
      } else {
        await page.goto("/canvas");
      }
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await expect.poll(() => taskReads).toBeGreaterThanOrEqual(1);
      expect(listReads).toBe(1);
      const node = page.getByTestId(`${kind}-node-${nodeId(kind)}`);
      const controls = kind === "text"
        ? page.getByTestId("text-creator")
        : node;
      if (kind === "text") await selectNode(page, kind);
      if (
        recoveredPollingPath === "initial-read-failure" ||
        recoveredPollingPath === "watch-pause"
      ) {
        if (kind === "text") {
          const status = controls.getByTestId("upstream-input-problem");
          await expect(status).toHaveAttribute("role", "status");
          await expect(status).toContainText("点击重试重新检查");
        } else {
          await expect(node.getByRole("alert"))
            .toContainText("点击重试重新检查");
        }
        const recheck = controls.getByRole("button", {
          name: "重新检查任务状态",
        });
        await expect(recheck).toBeVisible();
        if (recoveredPollingPath === "watch-pause") {
          await recheck.evaluate((button) => {
            const click = () => button.dispatchEvent(new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window,
            }));
            click();
            click();
          });
        } else {
          await recheck.click();
        }
      }
      const expectedTaskReads = recoveredPollingPath === "initial-read-failure"
        ? 2
        : recoveredPollingPath === "watch-read-failure"
          ? 3
          : 5;
      await expect.poll(() => taskReads)
        .toBeGreaterThanOrEqual(expectedTaskReads);
      await expect.poll(async () => {
        const canvas = await readPageCanvas(page);
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          generating: data?.[`${kind}Generating`],
          result: kind === "text"
            ? data?.content
            : data?.[`${kind}Src`],
          taskId: data?.[`${kind}GenerationTaskId`] ?? null,
        };
      }, { timeout: 15_000 }).toEqual({
        generating: false,
        result: kind === "text"
          ? resultText
          : mediaAssetUrl(kind, resultAssetId),
        taskId: kind === "text" ? taskId : null,
      });
      expect(taskReads).toBe(expectedTaskReads);
      await expect(controls.getByText(POLLING_PAUSED_MESSAGE, { exact: false }))
        .toHaveCount(0);
      expect(taskSubmissions).toBe(0);
      expect(providerRequests).toBe(0);
      if (recoveredPollingPath === "watch-pause") {
        expect(canvasWrites).toBe(0);
      }
    } finally {
      await request.delete("/api/canvas/default");
    }
  });
  }
}

for (const lifecycleBoundary of [
  "workspace-navigation",
  "logout-login",
] as const) {
  test(`watching task stops after ${lifecycleBoundary} without stale canvas writes`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const otherProjectResponse = await request.post("/api/projects", {
      data: { title: `m41 Q05 ${lifecycleBoundary}` },
    });
    expect(otherProjectResponse.status()).toBe(201);
    const otherProject = (await otherProjectResponse.json()) as { id: string };
    const taskId = `m41-q05-${lifecycleBoundary}-text-task`;
    const identity = currentStandaloneIdentity("text");
    const runningTask = {
      ...identity,
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-09-07T03:00:00.000Z",
      id: taskId,
      kind: "text" as const,
      model: modelInputs.text.id,
      nodeId: nodeId("text"),
      prompt: "text 原始提示词",
      state: "running" as const,
      updatedAt: "2026-09-07T03:00:00.500Z",
    };
    const lateSuccessTask = {
      ...runningTask,
      canvasProjectionState: "applied",
      resultText: `m41 Q05 late result ${lifecycleBoundary}`,
      state: "success" as const,
      updatedAt: "2026-09-07T03:00:01.000Z",
    };
    let taskReads = 0;
    let canvasWrites = 0;
    let lateResponseAttempts = 0;
    let logoutRequests = 0;
    let loginRequests = 0;
    let providerRequests = 0;
    let markWatchReadStarted!: () => void;
    const watchReadStarted = new Promise<void>((resolve) => {
      markWatchReadStarted = resolve;
    });
    let markWatchReadDelivered!: () => void;
    const watchReadDelivered = new Promise<void>((resolve) => {
      markWatchReadDelivered = resolve;
    });
    let releaseInFlightRead!: () => void;
    const inFlightReadRelease = new Promise<void>((resolve) => {
      releaseInFlightRead = resolve;
    });

    page.on("request", (entry) => {
      const url = new URL(entry.url());
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
      if (url.pathname === "/api/auth/logout" && entry.method() === "POST") {
        logoutRequests += 1;
      }
      if (url.pathname === "/api/auth/login" && entry.method() === "POST") {
        loginRequests += 1;
      }
      if (
        entry.method() !== "GET" &&
        (url.pathname.startsWith("/api/canvas/") ||
          url.pathname.startsWith("/api/canvases/"))
      ) {
        canvasWrites += 1;
      }
    });

    // Keep the app's real logout and login UI path. The login response is a
    // safe fixture because the normal safe server runs with auth bypass.
    await page.route("**/api/auth/login", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        json: {
          user: {
            displayName: "Test User",
            id: "__test__",
            loginName: "test-user",
            protected: true,
            role: "admin",
            status: "active",
          },
        },
        status: 200,
      });
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: "text",
            displayName: "Q05 text lifecycle",
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
            ...modelInputs.text,
            isDefault: true,
            parameterSchema: schemas.text,
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/canvas/default", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const document = await response.json();
      await route.fulfill({ response, json: document });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
          json: {
            paidProviderRequests: 0,
            persistentQueueReady: true,
            providerConfigured: true,
            submissionEnabled: true,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({
          body: "<html>not found</html>",
          contentType: "text/html",
          status: 404,
        });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        const canvasId = url.searchParams.get("canvasId");
        await route.fulfill({
          json: { tasks: canvasId === "default" ? [runningTask] : [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}` &&
        inbound.method() === "GET"
      ) {
        taskReads += 1;
        if (taskReads === 1) {
          await route.fulfill({ json: runningTask, status: 200 });
          return;
        }
        if (taskReads === 2) {
          markWatchReadStarted();
          if (lifecycleBoundary === "logout-login") {
            await inFlightReadRelease;
            lateResponseAttempts += 1;
            try {
              await route.fulfill({ json: lateSuccessTask, status: 200 });
            } catch {
              // Unmounting the Canvas is allowed to abort this deliberately
              // late response; the counter and persisted-canvas checks remain.
            }
          } else {
            await route.fulfill({
              json: { code: "TEMPORARY", error: "watch backoff fixture" },
              status: 503,
            });
            markWatchReadDelivered();
          }
          return;
        }
        lateResponseAttempts += 1;
        await route.fulfill({ json: lateSuccessTask, status: 200 });
        return;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes("text");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: {
            ...baseNode.data,
            ...generationNodeIdentityData("text", identity),
            content: `m41 Q05 old canvas ${lifecycleBoundary}`,
            contentHtml: `<p>m41 Q05 old canvas ${lifecycleBoundary}</p>`,
            textGenerating: true,
            textGenerationTaskId: taskId,
          },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await expect.poll(() => taskReads).toBeGreaterThanOrEqual(2);
      await watchReadStarted;
      if (lifecycleBoundary === "workspace-navigation") {
        await watchReadDelivered;
        await expect(page.getByText(POLLING_PAUSED_MESSAGE, { exact: false }))
          .toHaveCount(0);
        await page.getByTestId("logo-button").click();
        await page.getByTestId("project-menu")
          .getByText("工作空间", { exact: true })
          .click();
        await expect(page).toHaveURL(/\/canvas\/projects(?:\?.*)?$/);
      } else {
        await page.getByTestId("user-avatar").click();
        const account = page.getByTestId("account-popover");
        await expect(account).toBeVisible();
        await account.getByRole("button", { name: "退出登录" }).click();
        await expect(page.getByTestId("login-page")).toBeVisible();
        releaseInFlightRead();
        await expect.poll(() => lateResponseAttempts).toBe(1);
        await page
          .getByPlaceholder("3–40 位字母、数字或 . _ -")
          .fill("test-user");
        await page.getByPlaceholder("至少 12 位").fill("test-password-123");
        await page.getByRole("button", { name: "登录" }).click();
        await expect(page).toHaveURL(/\/canvas\/projects$/);
      }

      await expect(page.getByTestId("workspace-page")).toBeVisible();
      await page.getByTestId(`project-card-${otherProject.id}`).click();
      await expect(page).toHaveURL(
        new RegExp(`/canvas/${otherProject.id}$`),
      );
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await page.waitForTimeout(1_200);

      expect(taskReads).toBe(2);
      expect(lateResponseAttempts).toBe(
        lifecycleBoundary === "logout-login" ? 1 : 0,
      );
      expect(canvasWrites).toBe(0);
      expect(logoutRequests).toBe(
        lifecycleBoundary === "logout-login" ? 1 : 0,
      );
      expect(loginRequests).toBe(
        lifecycleBoundary === "logout-login" ? 1 : 0,
      );
      expect(providerRequests).toBe(0);
      await expect(page.getByText(POLLING_PAUSED_MESSAGE, { exact: false }))
        .toHaveCount(0);

      const oldCanvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const oldData = oldCanvas.nodes.find(
        (node) => node.id === nodeId("text"),
      )?.data;
      expect(oldData).toEqual(expect.objectContaining({
        content: `m41 Q05 old canvas ${lifecycleBoundary}`,
        textGenerating: true,
        textGenerationTaskId: taskId,
      }));
      const otherCanvasResponse = await request.get(
        `/api/canvas/${otherProject.id}`,
      );
      expect(otherCanvasResponse.ok()).toBeTruthy();
      const otherCanvas = await otherCanvasResponse.json();
      expect(JSON.stringify(otherCanvas)).not.toContain(lateSuccessTask.resultText);
    } finally {
      releaseInFlightRead();
      await request.delete("/api/canvas/default");
      await request.delete(`/api/projects/${otherProject.id}`);
    }
  });
}

test("relay audio exposes local-only cancellation while Mureka remains unchanged", async ({
  baseURL,
  page,
  request,
}) => {
  let cancelled = false;
  let cancelRequests = 0;
  let acceptedIdentity = currentStandaloneIdentity("audio");
  let boundTask: GenerationTaskSummary | undefined;
  const externalRequests: string[] = [];
  const localOrigin = new URL(baseURL!).origin;
  page.on("request", (outbound) => {
    const url = new URL(outbound.url());
    if (url.origin !== localOrigin) {
      externalRequests.push(outbound.url());
    }
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: [{
          capability: "audio",
          displayName: "Relay Audio fixture",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.audio,
          isDefault: true,
          parameterSchema: schemas.audio,
          providerProtocol: "media-generate",
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await request.get("/api/canvas/default");
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      json: !boundTask
        ? document
        : {
            ...document,
            nodes: document.nodes?.map((node) =>
              node.id === nodeId("audio")
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      ...authoritativeGenerationBindingData("audio", boundTask!),
                    },
                  }
                : node
            ),
          },
      status: response.status(),
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({ json: { submissionEnabled: true }, status: 200 });
      return;
    }
    if (url.pathname.endsWith("/preflight")) {
      await route.fulfill({
        json: { canEnqueue: true, canSubmit: true, canvasRevision: route.request().postDataJSON().canvasRevision, problems: [] },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    const task = {
      ...acceptedIdentity,
      attempt: 1,
      canvasId: "default",
      costCurrency: "USD",
      createdAt: "2026-08-03T12:00:00.000Z",
      ...(cancelled
        ? {
            errorMessage: "已停止本地等待和结果发布；中转站任务可能仍在运行",
          }
        : {}),
      id: "relay-audio-cancel-task",
      kind: "audio",
      model: modelInputs.audio.id,
      nodeId: nodeId("audio"),
      prompt: "audio 原始提示词",
      state: cancelled ? "cancelled" : "running",
      updatedAt: "2026-08-03T12:00:01.000Z",
    };
    if (
      url.pathname === "/api/generation-tasks" &&
      inbound.method() === "POST"
    ) {
      acceptedIdentity = submittedGenerationIdentity(
        inbound.postDataJSON() as SubmittedGenerationIdentity,
      );
      boundTask = {
        ...task,
        ...acceptedIdentity,
        state: "queued",
      } as unknown as GenerationTaskSummary;
      await route.fulfill({ json: boundTask, status: 202 });
      return;
    }
    if (
      url.pathname.endsWith("/relay-audio-cancel-task") &&
      inbound.method() === "DELETE"
    ) {
      cancelRequests += 1;
      cancelled = true;
      await route.fulfill({
        json: {
          ...task,
          errorMessage: "已停止本地等待和结果发布；中转站任务可能仍在运行",
          state: "cancelled",
        },
        status: 200,
      });
      return;
    }
    if (
      url.pathname.endsWith("/relay-audio-cancel-task") &&
      inbound.method() === "GET"
    ) {
      await route.fulfill({ json: task, status: 200 });
      return;
    }
    if (url.pathname === "/api/generation-tasks") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: canvasNodes("audio"),
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();
  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world"))
    .toHaveAttribute("data-persistence-ready", "true");
  await selectNode(page, "audio");
  const creator = page.getByTestId("audio-creator");
  await creator.getByRole("button", { name: "Generate" }).click();
  const cancel = creator.getByRole("button", { name: "取消生成" });
  await expect(cancel).toBeVisible();
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(page.getByTestId(`audio-node-${nodeId("audio")}`))
    .toContainText("中转站任务可能仍在运行");
  expect(cancelRequests).toBe(1);
  expect(externalRequests).toEqual([]);
});

test("image node resumes polling after a reload while the task is running and shows the result without another refresh", async ({
  page,
  request,
}) => {
  const taskId = "recovery-running-image";
  const identity = currentStandaloneIdentity("image");
  let pollCount = 0;
  let providerRequests = 0;
  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });

  const runningTask = {
    ...identity,
    attempt: 1,
    canvasId: "default",
    costCurrency: "USD",
    createdAt: "2026-08-03T08:00:00.000Z",
    id: taskId,
    kind: "image" as const,
    model: modelInputs.image.id,
    nodeId: nodeId("image"),
    prompt: "image 原始提示词",
    retryAllowed: true,
    state: "running" as const,
    updatedAt: "2026-08-03T08:00:01.000Z",
  };
  const successTask = {
    ...runningTask,
    canvasProjectionState: "applied" as const,
    resultAssetId: "recovery-result-image",
    resultMedia: {
      byteSize: 123,
      checksumSha256: "e".repeat(64),
      contentType: "image/png",
      durationSeconds: null,
      durationStatus: "not-applicable" as const,
      mediaHeight: 1_024,
      mediaWidth: 1_024,
      storageBackend: "local" as const,
    },
    resultUrl: "/api/assets/recovery-result-image",
    state: "success" as const,
    updatedAt: "2026-08-03T08:00:30.000Z",
  };
  let latestTask: Record<string, unknown> = runningTask;

  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: [{
          capability: "image",
          displayName: "Retry UI image",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.image,
          isDefault: true,
          parameterSchema: schemas.image,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      response,
      json: latestTask.state !== "success"
        ? document
        : {
            ...document,
            nodes: document.nodes?.map((node) =>
              node.id === nodeId("image")
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      ...authoritativeGenerationSuccessData(
                        "image",
                        successTask as unknown as GenerationTaskSummary,
                      ),
                    },
                  }
                : node
            ),
          },
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
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
    if (url.pathname.endsWith("/by-idempotency") && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { error: "not found" },
        status: 404,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [latestTask] },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith(`/${taskId}`) && method === "GET") {
      pollCount += 1;
      if (pollCount >= 2) latestTask = successTask;
      await route.fulfill({
        contentType: "application/json",
        json: latestTask,
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

  await request.delete("/api/canvas/default");
  const [imageNode] = canvasNodes("image");
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...imageNode,
        data: {
          ...imageNode.data,
          ...generationNodeIdentityData("image", identity),
          imageGenerating: true,
          imageGenerationTaskId: taskId,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world"))
    .toHaveAttribute("data-persistence-ready", "true");

  // 恢复逻辑必须在“任务仍在运行”的挂载后自动继续轮询并应用结果，
  // 不需要用户再刷新一次。
  await expect.poll(async () => {
    const canvas = await readPageCanvas(page);
    const data = canvas.nodes.find((node) => node.id === nodeId("image"))
      ?.data ?? {};
    return data.imageSrc === "/api/assets/recovery-result-image" &&
      data.imageGenerating === false
      ? "done"
      : "pending";
  }).toBe("done");
  expect(pollCount).toBeGreaterThanOrEqual(2);
  expect(providerRequests).toBe(0);
});

test("persisted active media tasks replace an old image, video, or audio result", async ({
  page,
  request,
}) => {
  const mediaKinds = ["image", "video", "audio"] as const;
  const resultUrl = (kind: (typeof mediaKinds)[number]) =>
    mediaAssetUrl(kind, `new-result-${kind}`);
  const bindings = new Map(mediaKinds.map((kind) =>
    [kind, currentStandaloneIdentity(kind)] as const
  ));
  const exactReads = new Set<string>();
  let listReads = 0;
  let providerRequests = 0;
  let taskSubmissions = 0;
  const tasks = mediaKinds.map((kind, index) => ({
    ...bindings.get(kind)!,
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T08:00:00.000Z",
    id: `old-result-recovery-${kind}`,
    kind,
    model: modelInputs[kind].id,
    nodeId: nodeId(kind),
    prompt: `${kind} 原始提示词`,
    canvasProjectionState: "applied",
    resultAssetId: `new-result-${kind}`,
    resultMedia: {
      byteSize: 100 + index,
      checksumSha256: String(index + 1).repeat(64),
      contentType: kind === "image"
        ? "image/png"
        : kind === "video"
          ? "video/mp4"
          : "audio/mpeg",
      durationSeconds: kind === "image" ? null : 2 + index,
      durationStatus: kind === "image" ? "not-applicable" : "ready",
      mediaHeight: kind === "audio" ? null : 720,
      mediaWidth: kind === "audio" ? null : 1_280,
      storageBackend: "local",
    },
    resultUrl: resultUrl(kind),
    state: "success",
    updatedAt: "2026-08-09T08:00:01.000Z",
  }));

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: mediaKinds.map((kind) => ({
          capability: kind,
          displayName: `Old result recovery ${kind}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs[kind],
          isDefault: true,
          parameterSchema: schemas[kind],
        })),
      },
      status: 200,
    });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      response,
      json: {
        ...document,
        nodes: document.nodes?.map((node) => {
          const task = tasks.find((candidate) =>
            node.id === nodeId(candidate.kind) && exactReads.has(candidate.id)
          );
          return task
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...authoritativeGenerationSuccessData(
                    task.kind,
                    task as unknown as GenerationTaskSummary,
                  ),
                },
              }
            : node;
        }),
      },
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "GET") {
      listReads += 1;
      await route.fulfill({ json: { tasks }, status: 200 });
      return;
    }
    if (inbound.method() === "GET") {
      const task = tasks.find((candidate) =>
        url.pathname === `/api/generation-tasks/${candidate.id}`
      );
      if (task) {
        exactReads.add(task.id);
        await route.fulfill({ json: task, status: 200 });
        return;
      }
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "POST") {
      taskSubmissions += 1;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const nodes = mediaKinds.map((kind, index) => ({
    data: {
      label: kind[0].toUpperCase() + kind.slice(1),
      title: `Old ${kind}`,
      ...generationNodeIdentityData(kind, bindings.get(kind)!),
      [`${kind}Generating`]: true,
      [`${kind}GenerationTaskId`]: `old-result-recovery-${kind}`,
      [`${kind}ModelId`]: modelInputs[kind].id,
      [`${kind}Parameters`]: defaultParameterValues(schemas[kind]),
      [`${kind}Prompt`]: `${kind} 原始提示词`,
      [`${kind}PromptReady`]: true,
      [`${kind}Src`]: `/api/assets/old-result-${kind}`,
    },
    id: nodeId(kind),
    position: { x: 100 + index * 520, y: 120 },
    selected: index === 0,
    style: {
      height: kind === "image" ? 300 : 250,
      width: kind === "image" ? 300 : 444,
    },
    type: kind,
  }));
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes,
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      return mediaKinds.map((kind) => {
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return [data?.[`${kind}Src`], data?.[`${kind}Generating`]];
      });
    }).toEqual(mediaKinds.map((kind) => [resultUrl(kind), false]));
    expect(exactReads).toEqual(new Set(tasks.map((task) => task.id)));
    expect(listReads).toBeGreaterThanOrEqual(1);
    expect(taskSubmissions).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await request.delete("/api/canvas/default");
  }
});

test("a Text fixture never resumes its persisted task", async ({
  page,
  request,
}) => {
  const canvasId = "node.text.empty";
  let taskReads = 0;
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: "text",
          displayName: "Fixture-safe text",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.text,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (
      inbound.method() === "GET" &&
      url.pathname === "/api/generation-tasks/fixture-persisted-text-task"
    ) {
      taskReads += 1;
      await route.fulfill({
        json: { error: "fixture must not read its persisted task" },
        status: 500,
      });
      return;
    }
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          persistentQueueReady: true,
          submissionEnabled: true,
          textSubmissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete(`/api/canvas/${canvasId}`);
  expect((await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: [],
      nodes: [{
        data: {
          content: "旧内容",
          contentHtml: "<p>旧内容</p>",
          label: "Text",
          textGenerating: true,
          textGenerationTaskId: "fixture-persisted-text-task",
          textModelId: modelInputs.text.id,
          textParameters: defaultParameterValues(schemas.text),
          textPrompt: "fixture 不得恢复",
          title: "Fixture text",
        },
        id: "text-primary",
        position: { x: 240, y: 180 },
        selected: true,
        style: { height: 250, width: 250 },
        type: "text",
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto(`/__fixture/${canvasId}`);
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.getByTestId("text-model-control"))
      .toContainText("Fixture-safe text");
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    expect(taskReads).toBe(0);
  } finally {
    await request.delete(`/api/canvas/${canvasId}`);
  }
});

test("image reload hands an active poll to the new ready run before the old run settles", async ({
  page,
  request,
}) => {
  const taskId = "image-recovery-owner-task";
  const identity = currentStandaloneIdentity("image");
  const activeInputKey = identity.generationInputKey;
  const ownershipKey = identity.generationOwnershipKey;
  const runningTask = {
    ...identity,
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T09:00:00.000Z",
    generationInputKey: activeInputKey,
    generationOwnershipKey: ownershipKey,
    id: taskId,
    kind: "image",
    model: modelInputs.image.id,
    nodeId: nodeId("image"),
    prompt: "image 原始提示词",
    state: "running",
    updatedAt: "2026-08-09T09:00:01.000Z",
  };
  const successTask = {
    ...runningTask,
    canvasProjectionState: "applied",
    resultAssetId: "image-recovery-owner-result",
    resultMedia: {
      byteSize: 321,
      checksumSha256: "f".repeat(64),
      contentType: "image/png",
      durationSeconds: null,
      durationStatus: "not-applicable",
      mediaHeight: 1_024,
      mediaWidth: 1_024,
      storageBackend: "local",
    },
    resultUrl: "/api/assets/image-recovery-owner-result",
    state: "success",
    updatedAt: "2026-08-09T09:00:02.000Z",
  };
  await page.addInitScript(({ running, success, taskId: interceptedTaskId }) => {
    const countKey = "__m41:image-recovery-owner-count";
    const state: {
      releaseFirst?: () => void;
      taskGets: number;
    } = {
      taskGets: Number(window.sessionStorage.getItem(countKey) ?? "0"),
    };
    (window as typeof window & {
      __m41ImageRecoveryOwner?: typeof state;
    }).__m41ImageRecoveryOwner = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "GET" &&
        url.pathname === `/api/generation-tasks/${interceptedTaskId}`
      ) {
        state.taskGets += 1;
        window.sessionStorage.setItem(countKey, String(state.taskGets));
        if (state.taskGets === 1) {
          return new Promise<Response>((_resolve, reject) => {
            state.releaseFirst = () => reject(
              new DOMException("old recovery scope closed", "AbortError"),
            );
          });
        }
        return originalFetch("/__m41-image-recovery-projection", {
          method: "POST",
        }).then(() => new Response(JSON.stringify(success), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, { running: runningTask, success: successTask, taskId });

  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: "image",
          displayName: "Image recovery owner",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.image,
          isDefault: true,
          parameterSchema: schemas.image,
        }],
      },
      status: 200,
    });
  });
  let taskLists = 0;
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: { persistentQueueReady: true, submissionEnabled: true },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "GET") {
      taskLists += 1;
      await route.fulfill({ json: { tasks: [runningTask] }, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const activeNodes = canvasNodes("image").map((node) => ({
    ...node,
    data: {
      ...node.data,
      ...generationNodeIdentityData("image", identity),
      imageGenerating: true,
      imageGenerationTaskId: taskId,
    },
  }));
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: activeNodes,
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();
  const initialDocument = await (
    await request.get("/api/canvas/default")
  ).json() as CanvasReadDocument;
  let projectionApplied = false;
  let supersededSent = false;
  let commandCount = 0;
  await page.route("**/__m41-image-recovery-projection", async (route) => {
    projectionApplied = true;
    await route.fulfill({ body: "", status: 204 });
  });
  await page.route("**/api/canvas/default", async (route) => {
    const inbound = route.request();
    if (inbound.method() === "GET" && !supersededSent) {
      await route.fulfill({ json: initialDocument, status: 200 });
      return;
    }
    if (inbound.method() === "GET") {
      const response = await route.fetch();
      const document = await response.json() as CanvasReadDocument;
      await route.fulfill({
        response,
        json: !projectionApplied
          ? document
          : {
              ...document,
              nodes: document.nodes.map((node) => {
                const candidate = node as {
                  data?: Record<string, unknown>;
                  id?: string;
                };
                return candidate.id === nodeId("image")
                  ? {
                      ...candidate,
                      data: {
                        ...candidate.data,
                        ...authoritativeGenerationSuccessData(
                          "image",
                          successTask as unknown as GenerationTaskSummary,
                        ),
                      },
                    }
                  : node;
              }),
            },
      });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/canvases/default/commands", async (route) => {
    if (route.request().method() === "POST") commandCount += 1;
    await route.fallback();
  });

  const raceState = () => page.evaluate(() => {
    const state = (window as typeof window & {
      __m41ImageRecoveryOwner?: { taskGets: number };
    }).__m41ImageRecoveryOwner;
    return state?.taskGets ?? 0;
  });
  try {
    await page.goto("/canvas");
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(raceState).toBeGreaterThanOrEqual(1);

    supersededSent = true;
    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(raceState).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("image-node-preview")).toHaveAttribute(
      "src",
      "/api/assets/image-recovery-owner-result",
    );
    expect(commandCount).toBe(0);
  } finally {
    await page.evaluate(() => {
      const state = (window as typeof window & {
        __m41ImageRecoveryOwner?: { releaseFirst?: () => void };
      }).__m41ImageRecoveryOwner;
      state?.releaseFirst?.();
    }).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

for (const kind of kinds) {
  test(`${kind} does not recover a v2 local intent without authoritative Canvas binding`, async ({
    page,
    request,
  }) => {
    const idempotencyKey = `m41-intent-only-${kind}`;
    const taskId = `m41-intent-only-task-${kind}`;
    const identity = currentIntentOnlyIdentity(kind);
    const intentSlot = submissionIntentSlot(kind);
    const resultAssetId = `intent-only-asset-${kind}`;
    const nextResult = kind === "text"
      ? "intent-only 新文字结果"
      : mediaAssetUrl(kind, resultAssetId);
    const task = {
      ...identity,
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T10:00:00.000Z",
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      canvasProjectionState: "applied",
      ...(kind === "text"
        ? { resultText: nextResult }
        : {
            resultAssetId,
            resultMedia: {
              byteSize: 512,
              contentType: kind === "image"
                ? "image/png"
                : kind === "video"
                  ? "video/mp4"
                  : "audio/mpeg",
              durationSeconds: kind === "image" ? null : 3,
              durationStatus: kind === "image" ? "not-applicable" : "ready",
              storageBackend: "local",
            },
            resultUrl: nextResult,
          }),
      state: "success",
      updatedAt: "2026-08-09T10:00:01.000Z",
    };
    let byIdempotencyReads = 0;
    let modelReads = 0;
    let providerRequests = 0;
    let taskLists = 0;
    let taskSubmissions = 0;
    let releaseModels!: () => void;
    const modelsGate = new Promise<void>((resolve) => {
      releaseModels = resolve;
    });

    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    await page.addInitScript(({ intent, slot }) => {
      window.localStorage.setItem(slot, JSON.stringify(intent));
    }, {
      intent: {
        canvasId: "default",
        fixtureScopeId: "",
        generationInputKey: identity.generationInputKey,
        generationOwnershipKey: identity.generationOwnershipKey,
        idempotencyKey,
        kind,
        modelConfigurationRevision: identity.modelConfigurationRevision,
        modelInputContractFingerprint:
          identity.modelInputContractFingerprint,
        modelReleaseRevision: identity.modelReleaseRevision,
        nodeId: nodeId(kind),
        requestSignature: recoveryRequestSignature(kind),
        taskId,
        updatedAt: "2026-08-09T10:00:00.500Z",
        version: 2,
      },
      slot: intentSlot,
    });
    await page.route("**/api/models", async (route) => {
      modelReads += 1;
      await modelsGate;
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `Intent-only recovery ${kind}`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
          ...modelInputs[kind],
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
          json: {
            paidProviderRequests: 0,
            persistentQueueReady: true,
            providerConfigured: true,
            submissionEnabled: true,
          },
          status: 200,
        });
        return;
      }
      if (
        inbound.method() === "GET" &&
        url.pathname.endsWith("/by-idempotency") &&
        url.searchParams.get("canvasId") === "default" &&
        url.searchParams.get("idempotencyKey") === idempotencyKey
      ) {
        byIdempotencyReads += 1;
        await route.fulfill({ json: task, status: 200 });
        return;
      }
      if (
        inbound.method() === "GET" &&
        url.pathname === "/api/generation-tasks"
      ) {
        taskLists += 1;
        await route.fulfill({ json: { tasks: [] }, status: 200 });
        return;
      }
      if (
        inbound.method() === "POST" &&
        url.pathname === "/api/generation-tasks"
      ) {
        taskSubmissions += 1;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes(kind);
    const oldResult = kind === "text"
      ? "intent-only 旧文字结果"
      : mediaAssetUrl(kind, `intent-only-old-${kind}`);
    const oldResultData = kind === "text"
      ? {
          content: oldResult,
          contentHtml: `<p>${oldResult}</p>`,
        }
      : {
          [`${kind}Src`]: oldResult,
          ...(kind === "audio" ? { audioGeneratedResult: true } : {}),
        };
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: { ...baseNode.data, ...oldResultData },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await expect.poll(() => modelReads).toBeGreaterThanOrEqual(1);
      expect(byIdempotencyReads).toBe(0);
      releaseModels();
      await flushBrowserTasks(page);
      await flushBrowserTasks(page);
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return kind === "text" ? data?.content : data?.[`${kind}Src`];
      }).toBe(oldResult);
      await expect.poll(() => page.evaluate((slot) =>
        window.localStorage.getItem(slot), intentSlot)).not.toBeNull();
      expect(byIdempotencyReads).toBe(0);
      expect(taskSubmissions).toBe(0);
      expect(providerRequests).toBe(0);
    } finally {
      releaseModels();
      await page.evaluate((slot) => {
        window.localStorage.removeItem(slot);
      }, intentSlot).catch(() => undefined);
      await request.delete("/api/canvas/default");
    }
  });
}

test("Text legacy intent mismatch remains fail-closed without reading or applying the old result", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const taskId = "m41-text-legacy-mismatch-task";
  const intentSlot = submissionIntentSlot(kind);
  const protectedBody = "legacy mismatch 必须保留的正文";
  const currentPrompt = "text 当前已变化的提示词";
  let byIdempotencyReads = 0;
  let generationPosts = 0;
  let providerRequests = 0;

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript(({ intent, slot }) => {
    window.localStorage.setItem(slot, JSON.stringify(intent));
  }, {
    intent: {
      canvasId: "default",
      idempotencyKey: "m41-text-legacy-mismatch-key",
      kind,
      nodeId: nodeId(kind),
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-09T10:15:00.000Z",
      version: 1,
    },
    slot: intentSlot,
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Legacy mismatch Text",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.text,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      byIdempotencyReads += 1;
      await route.fulfill({
        json: {
          attempt: 1,
          canvasId: "default",
          costCurrency: "CNY",
          createdAt: "2026-08-09T10:14:00.000Z",
          id: taskId,
          kind,
          nodeId: nodeId(kind),
          prompt: "text 原始提示词",
          resultText: "不应应用的旧结果",
          state: "success",
          updatedAt: "2026-08-09T10:14:01.000Z",
        },
        status: 200,
      });
      return;
    }
    if (inbound.method() === "POST") generationPosts += 1;
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          content: protectedBody,
          contentHtml: `<p>${protectedBody}</p>`,
          textPrompt: currentPrompt,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).not.toBeNull();
    await expect(page.getByTestId("text-node-editor")).toHaveText(protectedBody);
    const canvas = await (
      await request.get("/api/canvas/default")
    ).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    expect(canvas.nodes.find((node) => node.id === nodeId(kind))?.data.content)
      .toBe(protectedBody);
    expect(byIdempotencyReads).toBe(0);
    expect(generationPosts).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await page.evaluate((slot) => {
      window.localStorage.removeItem(slot);
    }, intentSlot).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

test("four active old-result tasks recover before a delayed model catalog and retain overlays", async ({
  page,
  request,
}) => {
  const intents = kinds.map((kind) => ({
    idempotencyKey: `m41-delayed-model-active-${kind}`,
    identity: currentStandaloneIdentity(kind),
    kind,
    slot: submissionIntentSlot(kind),
    taskId: `m41-delayed-model-active-task-${kind}`,
  }));
  const tasks = new Map(intents.map(({ identity, kind, taskId }) => {
    const resultAssetId = `delayed-model-active-result-${kind}`;
    return [kind, {
      ...identity,
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T10:30:00.000Z",
      canvasProjectionState: "applied",
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      ...(kind === "text"
        ? { resultText: "delayed-model active 新文字结果" }
        : {
            resultAssetId,
            resultMedia: {
              byteSize: 640,
              checksumSha256: "1".repeat(64),
              contentType: kind === "image"
                ? "image/png"
                : kind === "video"
                  ? "video/mp4"
                  : "audio/mpeg",
              durationSeconds: kind === "image" ? null : 4,
              durationStatus: kind === "image" ? "not-applicable" : "ready",
              mediaHeight: kind === "audio" ? null : 720,
              mediaWidth: kind === "audio" ? null : 1_280,
              storageBackend: "local",
            },
            resultUrl: mediaAssetUrl(kind, resultAssetId),
          }),
      state: "success",
      updatedAt: "2026-08-09T10:30:01.000Z",
    }];
  }));
  let modelReads = 0;
  let providerRequests = 0;
  let taskLists = 0;
  let taskReads = 0;
  let taskSubmissions = 0;
  let releaseModels!: () => void;
  const modelsGate = new Promise<void>((resolve) => {
    releaseModels = resolve;
  });
  let releaseTasks!: () => void;
  const tasksGate = new Promise<void>((resolve) => {
    releaseTasks = resolve;
  });
  const initialTaskReads = new Set<string>();
  const projectedKinds = new Set<Kind>();

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript((seededIntents) => {
    for (const entry of seededIntents) {
      window.localStorage.setItem(entry.slot, JSON.stringify(entry.intent));
    }
  }, intents.map(({ idempotencyKey, identity, kind, slot, taskId }) => ({
    intent: {
      canvasId: "default",
      fixtureScopeId: "",
      generationInputKey: identity.generationInputKey,
      generationOwnershipKey: identity.generationOwnershipKey,
      idempotencyKey,
      kind,
      modelConfigurationRevision: identity.modelConfigurationRevision,
      modelInputContractFingerprint: identity.modelInputContractFingerprint,
      modelReleaseRevision: identity.modelReleaseRevision,
      nodeId: nodeId(kind),
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-09T10:30:00.500Z",
      version: 2,
    },
    slot,
  })));
  await page.route("**/api/models", async (route) => {
    modelReads += 1;
    await modelsGate;
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: kinds.map((kind) => ({
          capability: kind,
          displayName: `Delayed active ${kind}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs[kind],
          isDefault: true,
          parameterSchema: schemas[kind],
        })),
      },
      status: 200,
    });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      response,
      json: {
        ...document,
        nodes: document.nodes?.map((node) => {
          const kind = kinds.find((candidate) =>
            node.id === nodeId(candidate) && projectedKinds.has(candidate)
          );
          const task = kind ? tasks.get(kind) : undefined;
          return kind && task
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...authoritativeGenerationSuccessData(
                    kind,
                    task as unknown as GenerationTaskSummary,
                  ),
                },
              }
            : node;
        }),
      },
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      const intent = intents.find((candidate) =>
        candidate.idempotencyKey === url.searchParams.get("idempotencyKey"));
      const task = intent ? tasks.get(intent.kind) : undefined;
      if (task) taskReads += 1;
      await route.fulfill({
        json: task ?? { error: "not found" },
        status: task ? 200 : 404,
      });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      taskLists += 1;
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    if (inbound.method() === "GET") {
      const taskId = url.pathname.split("/").at(-1);
      const task = [...tasks.values()].find((candidate) => candidate.id === taskId);
      if (task) {
        taskReads += 1;
        if (!initialTaskReads.has(task.id)) {
          initialTaskReads.add(task.id);
          await route.fulfill({
            json: {
              ...task,
              resultAssetId: undefined,
              resultMedia: undefined,
              resultText: undefined,
              resultUrl: undefined,
              state: "running",
            },
            status: 200,
          });
        } else {
          await tasksGate;
          projectedKinds.add(task.kind);
          await route.fulfill({ json: task, status: 200 });
        }
        return;
      }
    }
    if (inbound.method() === "POST" && url.pathname === "/api/generation-tasks") {
      taskSubmissions += 1;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const activeNodes = canvasNodes().map((node) => {
    const kind = node.type as Kind;
    const intent = intents.find((candidate) => candidate.kind === kind)!;
    const taskId = intent.taskId;
    return {
      ...node,
      data: {
        ...node.data,
        ...generationNodeIdentityData(kind, intent.identity),
        [`${kind}Generating`]: true,
        [`${kind}GenerationTaskId`]: taskId,
        ...(kind === "text"
          ? {
              content: "delayed-model active 旧文字结果",
              contentHtml: "<p>delayed-model active 旧文字结果</p>",
            }
          : {
              [`${kind}Src`]: mediaAssetUrl(kind, `delayed-model-active-old-${kind}`),
            }),
      },
    };
  });
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: activeNodes,
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => modelReads).toBeGreaterThanOrEqual(1);
    await expect.poll(() => initialTaskReads.size).toBe(4);
    expect(taskReads).toBeGreaterThanOrEqual(4);
    expect(taskLists).toBe(0);
    for (const { slot } of intents) {
      expect(await page.evaluate((key) =>
        window.localStorage.getItem(key), slot)).not.toBeNull();
    }
    await expect(page.getByTestId("text-node-editor"))
      .toContainText("delayed-model active 旧文字结果");
    await expect(page.getByTestId("image-node-preview")).toHaveAttribute(
      "src",
      mediaAssetUrl("image", "delayed-model-active-old-image"),
    );
    await expect(page.getByTestId("video-node-preview")).toHaveAttribute(
      "src",
      mediaAssetUrl("video", "delayed-model-active-old-video"),
    );
    await expect(page.getByTestId("audio-node-media")).toHaveAttribute(
      "src",
      mediaAssetUrl("audio", "delayed-model-active-old-audio"),
    );
    const activeCanvas = await (
      await request.get("/api/canvas/default")
    ).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    for (const kind of kinds) {
      const data = activeCanvas.nodes.find(
        (node) => node.id === nodeId(kind),
      )?.data;
      expect(kind === "text" ? data?.content : data?.[`${kind}Src`]).toBe(
        kind === "text"
          ? "delayed-model active 旧文字结果"
          : mediaAssetUrl(kind, `delayed-model-active-old-${kind}`),
      );
    }

    releaseTasks();
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      return kinds.map((kind) => {
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return kind === "text" ? data?.content : data?.[`${kind}Src`];
      });
    }).toEqual(kinds.map((kind) => kind === "text"
      ? "delayed-model active 新文字结果"
      : mediaAssetUrl(kind, `delayed-model-active-result-${kind}`)));
    for (const { slot } of intents) {
      await expect.poll(() => page.evaluate((key) =>
        window.localStorage.getItem(key), slot), { timeout: 15_000 }).toBeNull();
    }
    expect(taskSubmissions).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    releaseTasks();
    releaseModels();
    await page.evaluate((slots) => {
      slots.forEach((slot) => window.localStorage.removeItem(slot));
    }, intents.map((entry) => entry.slot)).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

test("scoped retry-accepted events wake exact GET only for their four bound nodes", async ({
  page,
  request,
}) => {
  const identities = Object.fromEntries(kinds.map((kind) => [
    kind,
    currentStandaloneIdentity(kind),
  ])) as Record<Kind, SubmittedGenerationIdentity>;
  const accepted = new Set<Kind>();
  const projected = new Set<Kind>();
  const exactReads = new Map<Kind, number>();
  let listReads = 0;
  let mutationPosts = 0;
  let providerRequests = 0;
  const taskIdFor = (kind: Kind) => `m41-event-wakeup-${kind}`;
  const resultFor = (kind: Kind) => kind === "text"
    ? "event wakeup 新文字结果"
    : mediaAssetUrl(kind, `event-wakeup-result-${kind}`);
  const taskFor = (kind: Kind) => ({
    ...identities[kind],
    attempt: accepted.has(kind) ? 2 : 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-10T07:00:00.000Z",
    id: taskIdFor(kind),
    kind,
    model: modelInputs[kind].id,
    nodeId: nodeId(kind),
    prompt: `${kind} 原始提示词`,
    ...(accepted.has(kind) ? { canvasProjectionState: "applied" } : {}),
    ...(accepted.has(kind)
      ? kind === "text"
        ? { resultText: resultFor(kind) }
        : {
            resultAssetId: `event-wakeup-result-${kind}`,
            resultMedia: {
              byteSize: 720,
              checksumSha256: "2".repeat(64),
              contentType: kind === "image"
                ? "image/png"
                : kind === "video"
                  ? "video/mp4"
                  : "audio/mpeg",
              durationSeconds: kind === "image" ? null : 5,
              durationStatus: kind === "image" ? "not-applicable" : "ready",
              mediaHeight: kind === "audio" ? null : 720,
              mediaWidth: kind === "audio" ? null : 1_280,
              storageBackend: "local",
            },
            resultUrl: resultFor(kind),
          }
      : {
          errorCode: "AUTH",
          errorMessage: `${kind} retryable failure`,
          retryAllowed: true,
        }),
    state: accepted.has(kind) ? "success" : "failed",
    updatedAt: accepted.has(kind)
      ? "2026-08-10T07:00:02.000Z"
      : "2026-08-10T07:00:01.000Z",
  });

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: kinds.map((kind) => ({
          capability: kind,
          displayName: `Event wakeup ${kind}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs[kind],
          isDefault: true,
          parameterSchema: schemas[kind],
        })),
      },
      status: 200,
    });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      response,
      json: {
        ...document,
        nodes: document.nodes?.map((node) => {
          const kind = kinds.find((candidate) =>
            node.id === nodeId(candidate) && projected.has(candidate)
          );
          return kind
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...authoritativeGenerationSuccessData(
                    kind,
                    taskFor(kind) as unknown as GenerationTaskSummary,
                  ),
                },
              }
            : node;
        }),
      },
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      listReads += 1;
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    if (inbound.method() === "GET") {
      const kind = kinds.find((candidate) =>
        url.pathname === `/api/generation-tasks/${taskIdFor(candidate)}`);
      if (kind) {
        exactReads.set(kind, (exactReads.get(kind) ?? 0) + 1);
        if (accepted.has(kind)) projected.add(kind);
        await route.fulfill({ json: taskFor(kind), status: 200 });
        return;
      }
    }
    if (inbound.method() === "POST") mutationPosts += 1;
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const seededNodes = canvasNodes().map((node) => {
    const kind = node.type as Kind;
    return {
      ...node,
      data: {
        ...node.data,
        ...generationNodeIdentityData(kind, identities[kind]),
        [`${kind}GenerationError`]: `${kind} seeded failure`,
        [`${kind}GenerationErrorCode`]: "AUTH",
        [`${kind}Generating`]: false,
        [`${kind}GenerationRetryAllowed`]: true,
        [`${kind}GenerationTaskId`]: taskIdFor(kind),
        ...(kind === "text"
          ? {
              content: "event wakeup 旧文字结果",
              contentHtml: "<p>event wakeup 旧文字结果</p>",
            }
          : {
              [`${kind}Src`]: mediaAssetUrl(kind, `event-wakeup-old-${kind}`),
              ...(kind === "image" ? { imageGeneratedSuccess: true } : {}),
              ...(kind === "audio" ? { audioGeneratedResult: true } : {}),
            }),
      },
    };
  });
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: seededNodes,
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => kinds.every((kind) =>
      (exactReads.get(kind) ?? 0) >= 1)).toBe(true);
    const failedCanvas = await readPageCanvas(page);
    expect(kinds.every((kind) => failedCanvas.nodes.find((node) =>
      node.id === nodeId(kind)
    )?.data[`${kind}GenerationTaskId`] === taskIdFor(kind))).toBe(true);
    await flushBrowserTasks(page);

    for (const kind of kinds) {
      const beforeWrongScope = exactReads.get(kind) ?? 0;
      await page.evaluate(({ eventName, kind, taskId }) => {
        const base = {
          attempt: 2,
          canvasId: "default",
          kind,
          nodeId: `retry-ui-${kind}`,
          taskId,
          updatedAt: "2026-08-10T07:00:02.000Z",
        };
        const wrongKind = kind === "text" ? "image" : "text";
        for (const detail of [
          { ...base, canvasId: "other-canvas" },
          { ...base, nodeId: "other-node" },
          { ...base, kind: wrongKind },
          { ...base, taskId: `${taskId}-other` },
        ]) {
          window.dispatchEvent(new CustomEvent(eventName, { detail }));
        }
      }, {
        eventName: "unboundry:generation-task-retry-accepted",
        kind,
        taskId: taskIdFor(kind),
      });
      await flushBrowserTasks(page);
      expect(exactReads.get(kind) ?? 0).toBeGreaterThanOrEqual(beforeWrongScope);
      const wrongScopeCanvas = await readPageCanvas(page);
      const wrongScopeData = wrongScopeCanvas.nodes.find((node) =>
        node.id === nodeId(kind)
      )?.data;
      expect(kind === "text"
        ? wrongScopeData?.content
        : wrongScopeData?.[`${kind}Src`]).toBe(kind === "text"
          ? "event wakeup 旧文字结果"
          : mediaAssetUrl(kind, `event-wakeup-old-${kind}`));

      accepted.add(kind);
      const beforeAcceptedScope = exactReads.get(kind) ?? 0;
      await page.evaluate(({ eventName, kind, taskId }) => {
        window.dispatchEvent(new CustomEvent(eventName, {
          detail: {
            attempt: 2,
            canvasId: "default",
            kind,
            nodeId: `retry-ui-${kind}`,
            taskId,
            updatedAt: "2026-08-10T07:00:02.000Z",
          },
        }));
      }, {
        eventName: "unboundry:generation-task-retry-accepted",
        kind,
        taskId: taskIdFor(kind),
      });
      await expect.poll(() => exactReads.get(kind) ?? 0)
        .toBeGreaterThan(beforeAcceptedScope);
      await expect.poll(async () => {
        const canvas = await readPageCanvas(page);
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return kind === "text" ? data?.content : data?.[`${kind}Src`];
      }).toBe(resultFor(kind));
    }
    expect(listReads).toBeGreaterThanOrEqual(1);
    expect(mutationPosts).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await request.delete("/api/canvas/default");
  }
});

test("Text rejects an exact task id whose server scope belongs to another node", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const taskId = "m41-text-wrong-scope";
  const identity = currentStandaloneIdentity(kind);
  const inputKey = identity.generationInputKey;
  let exactReads = 0;
  let listReads = 0;
  let mutationPosts = 0;
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Wrong scope text",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.text,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          ...identity,
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (inbound.method() === "GET" &&
      url.pathname === `/api/generation-tasks/${taskId}`) {
      exactReads += 1;
      await route.fulfill({
        json: {
          ...identity,
          attempt: 1,
          canvasId: "default",
          costCurrency: "CNY",
          createdAt: "2026-08-10T08:00:00.000Z",
          generationInputKey: inputKey,
          id: taskId,
          kind,
          model: modelInputs.text.id,
          nodeId: "another-text-node",
          prompt: "text 原始提示词",
          resultText: "wrong-scope result must not apply",
          state: "success",
          updatedAt: "2026-08-10T08:00:01.000Z",
        },
        status: 200,
      });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      listReads += 1;
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    if (inbound.method() === "POST") mutationPosts += 1;
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          ...generationNodeIdentityData(kind, identity),
          content: "Text keeps this old body",
          contentHtml: "<p>Text keeps this old body</p>",
          textGenerationInputKey: inputKey,
          textGenerating: true,
          textGenerationTaskId: taskId,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => exactReads).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        body: data?.content,
        generating: data?.textGenerating,
        taskId: data?.textGenerationTaskId ?? null,
      };
    }).toEqual({
      body: "Text keeps this old body",
      generating: true,
      taskId,
    });
    expect(listReads).toBeGreaterThanOrEqual(1);
    expect(mutationPosts).toBe(0);
  } finally {
    await request.delete("/api/canvas/default");
  }
});

test("Video keeps unchanged-input Generate disabled but submits once after a real prompt change", async ({
  page,
  request,
}) => {
  const kind = "video" as const;
  const taskId = "m41-video-changed-input-task";
  const originalPrompt = "video 原始提示词";
  const changedPrompt = "video changed input prompt";
  const originalIdentity = currentStandaloneIdentity(kind);
  const originalInputKey = originalIdentity.generationInputKey;
  let taskSubmissions = 0;
  let taskReads = 0;
  let releaseTask!: () => void;
  const taskGate = new Promise<void>((resolve) => {
    releaseTask = resolve;
  });
  let queuedTask = {
    ...originalIdentity,
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-10T09:00:00.000Z",
    id: taskId,
    kind,
    model: modelInputs.video.id,
    nodeId: nodeId(kind),
    prompt: changedPrompt,
    state: "queued",
    updatedAt: "2026-08-10T09:00:01.000Z",
  };
  let boundTask: GenerationTaskSummary | undefined;
  let projectionApplied = false;
  const successfulTask = () => ({
    ...queuedTask,
    canvasProjectionState: "applied",
    resultAssetId: "m41-video-changed-input-result",
    resultMedia: {
      byteSize: 800,
      checksumSha256: "3".repeat(64),
      contentType: "video/mp4",
      durationSeconds: 5,
      durationStatus: "ready",
      mediaHeight: 720,
      mediaWidth: 1_280,
      storageBackend: "local",
    },
    resultUrl: mediaAssetUrl("video", "m41-video-changed-input-result"),
    state: "success",
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Changed input video",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.video,
          isDefault: true,
          parameterSchema: schemas.video,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await request.get("/api/canvas/default");
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      json: !boundTask
        ? document
        : {
            ...document,
            nodes: document.nodes?.map((node) =>
              node.id === nodeId(kind)
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      ...(projectionApplied
                        ? authoritativeGenerationSuccessData(
                            kind,
                            successfulTask() as unknown as GenerationTaskSummary,
                          )
                        : authoritativeGenerationBindingData(kind, boundTask!)),
                    },
                  }
                : node
            ),
          },
      status: response.status(),
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
      await route.fulfill({
        json: { canEnqueue: true, canSubmit: true, canvasRevision: route.request().postDataJSON().canvasRevision, problems: [] },
        status: 200,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "GET") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "POST") {
      taskSubmissions += 1;
      queuedTask = {
        ...queuedTask,
        ...submittedGenerationIdentity(
          inbound.postDataJSON() as SubmittedGenerationIdentity,
        ),
      };
      boundTask = queuedTask as unknown as GenerationTaskSummary;
      await route.fulfill({ json: queuedTask, status: 202 });
      return;
    }
    if (url.pathname === `/api/generation-tasks/${taskId}` &&
      inbound.method() === "GET") {
      taskReads += 1;
      await taskGate;
      projectionApplied = true;
      await route.fulfill({ json: successfulTask(), status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          ...generationNodeIdentityData(kind, originalIdentity),
          assetId: "m41-video-old-result",
          videoGenerationInputKey: originalInputKey,
          videoPrompt: originalPrompt,
          videoPromptReady: true,
          videoSrc: mediaAssetUrl("video", "m41-video-old-result"),
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await selectNode(page, kind);
    const generate = page.getByTestId("video-creator")
      .getByRole("button", { name: "Generate" });
    await expect(generate).toBeDisabled();
    await page.getByTestId("video-creator-prompt").fill(changedPrompt);
    await page.getByTestId("video-creator-prompt").blur();
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        inputKey: data?.videoGenerationInputKey ?? null,
        ownershipKey: data?.videoGenerationOwnershipKey ?? null,
        prompt: data?.videoPrompt,
        taskId: data?.videoGenerationTaskId ?? null,
      };
    }).toEqual({
      inputKey: null,
      ownershipKey: null,
      prompt: changedPrompt,
      taskId: null,
    });
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect.poll(async () => taskSubmissions === 1
      ? "submitted"
      : JSON.stringify({
          alerts: await page.locator('[role="alert"]').allTextContents(),
          status: await page.locator('[role="status"]').allTextContents(),
        })).toBe("submitted");
    await expect.poll(() => taskReads).toBeGreaterThanOrEqual(1);
    expect(taskSubmissions).toBe(1);
    await expect(page.getByRole("button", { name: "取消生成" })).toBeVisible();
  } finally {
    releaseTask();
    await page.unrouteAll({ behavior: "wait" });
    await request.delete("/api/canvas/default");
  }
});

test("an active Text poll locks manual body editing and durably applies its success", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const taskId = "m41-text-manual-owner-task";
  const intentSlot = submissionIntentSlot(kind);
  const identity = currentStandaloneIdentity(kind);
  const runningTask = {
    ...identity,
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T10:45:00.000Z",
    id: taskId,
    kind,
    model: modelInputs.text.id,
    nodeId: nodeId(kind),
    prompt: "text 原始提示词",
    state: "running",
    updatedAt: "2026-08-09T10:45:00.500Z",
  };
  const successTask = {
    ...runningTask,
    canvasProjectionState: "applied",
    resultText: "迟到的生成结果不得覆盖手稿",
    state: "success",
    updatedAt: "2026-08-09T10:45:01.000Z",
  };
  let providerRequests = 0;
  let taskSubmissions = 0;

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript(({ intent, running, slot, success, taskId }) => {
    const marker = "__m41:text-manual-owner-seeded";
    if (window.sessionStorage.getItem(marker) !== "1") {
      window.sessionStorage.setItem(marker, "1");
      window.localStorage.setItem(slot, JSON.stringify(intent));
    }
    const state: {
      releaseSuccess?: () => void;
      taskGets: number;
    } = { taskGets: 0 };
    (window as typeof window & {
      __m41TextManualOwner?: typeof state;
    }).__m41TextManualOwner = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "GET" &&
        url.pathname === `/api/generation-tasks/${taskId}`
      ) {
        state.taskGets += 1;
        if (state.taskGets >= 2) {
          return new Promise<Response>((resolve) => {
            state.releaseSuccess = () => {
              void originalFetch("/__m41-text-manual-projection", {
                method: "POST",
              }).then(() => resolve(new Response(
                JSON.stringify(success),
                {
                  headers: { "Content-Type": "application/json" },
                  status: 200,
                },
              )));
            };
          });
        }
        return Promise.resolve(new Response(JSON.stringify(running), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, {
    intent: {
      canvasId: "default",
      fixtureScopeId: "",
      generationInputKey: identity.generationInputKey,
      generationOwnershipKey: identity.generationOwnershipKey,
      idempotencyKey: "m41-text-manual-owner-key",
      kind,
      modelConfigurationRevision: identity.modelConfigurationRevision,
      modelInputContractFingerprint: identity.modelInputContractFingerprint,
      modelReleaseRevision: identity.modelReleaseRevision,
      nodeId: nodeId(kind),
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-09T10:45:00.250Z",
      version: 2,
    },
    running: runningTask,
    slot: intentSlot,
    success: successTask,
    taskId,
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Text manual owner",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.text,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  let projectionApplied = false;
  await page.route("**/__m41-text-manual-projection", async (route) => {
    projectionApplied = true;
    await route.fulfill({ body: "", status: 204 });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      response,
      json: !projectionApplied
        ? document
        : {
            ...document,
            nodes: document.nodes?.map((node) =>
              node.id === nodeId(kind)
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      ...authoritativeGenerationSuccessData(
                        kind,
                        successTask as unknown as GenerationTaskSummary,
                      ),
                    },
                  }
                : node
            ),
          },
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    if (inbound.method() === "POST" && url.pathname === "/api/generation-tasks") {
      taskSubmissions += 1;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          ...generationNodeIdentityData(kind, identity),
          content: "轮询开始前的旧正文",
          contentHtml: "<p>轮询开始前的旧正文</p>",
          textGenerating: true,
          textGenerationTaskId: taskId,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41TextManualOwner?: { taskGets: number };
      }).__m41TextManualOwner?.taskGets ?? 0)).toBeGreaterThanOrEqual(2);

    await page.getByTestId("canvas-node-text-content").dispatchEvent("dblclick");
    const editor = page.getByTestId("text-node-editor");
    await expect(editor).toHaveAttribute("contenteditable", "false");

    await page.evaluate(() => {
      (window as typeof window & {
        __m41TextManualOwner?: { releaseSuccess?: () => void };
      }).__m41TextManualOwner?.releaseSuccess?.();
    });
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        content: data?.content,
        generating: data?.textGenerating,
        taskId: data?.textGenerationTaskId ?? null,
      };
    }).toEqual({
      content: successTask.resultText,
      generating: false,
      taskId,
    });
    await expect.poll(() => page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();
    await expect(editor).toHaveText(successTask.resultText);

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.getByTestId("text-node-editor"))
      .toHaveText(successTask.resultText);
    expect(taskSubmissions).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await page.evaluate((slot) => {
      window.localStorage.removeItem(slot);
    }, intentSlot).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

test("an active Text poll locks prompt editing and durably applies its success", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const taskId = "m41-text-prompt-owner-task";
  const intentSlot = submissionIntentSlot(kind);
  const originalPrompt = "text 原始提示词";
  const protectedBody = "提示词变化后必须保留的正文";
  const identity = currentStandaloneIdentity(kind);
  const runningTask = {
    ...identity,
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T10:50:00.000Z",
    id: taskId,
    kind,
    model: modelInputs.text.id,
    nodeId: nodeId(kind),
    prompt: originalPrompt,
    state: "running",
    updatedAt: "2026-08-09T10:50:00.500Z",
  };
  const successTask = {
    ...runningTask,
    canvasProjectionState: "applied",
    resultText: "迟到成功不得覆盖提示词变化后的正文",
    state: "success",
    updatedAt: "2026-08-09T10:50:01.000Z",
  };
  let generationPosts = 0;
  let providerRequests = 0;

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript(({ intent, running, slot, success, taskId }) => {
    const marker = "__m41:text-prompt-owner-seeded";
    if (window.sessionStorage.getItem(marker) !== "1") {
      window.sessionStorage.setItem(marker, "1");
      window.localStorage.setItem(slot, JSON.stringify(intent));
    }
    const state: {
      lateResponses: number;
      releaseSuccess?: () => void;
      taskGets: number;
    } = { lateResponses: 0, taskGets: 0 };
    (window as typeof window & {
      __m41TextPromptOwner?: typeof state;
    }).__m41TextPromptOwner = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "GET" &&
        url.pathname === `/api/generation-tasks/${taskId}`
      ) {
        state.taskGets += 1;
        if (state.taskGets >= 2) {
          return new Promise<Response>((resolve) => {
            state.releaseSuccess = () => {
              state.lateResponses += 1;
              void originalFetch("/__m41-text-prompt-projection", {
                method: "POST",
              }).then(() => resolve(new Response(JSON.stringify(success), {
                headers: { "Content-Type": "application/json" },
                status: 200,
              })));
            };
          });
        }
        return Promise.resolve(new Response(JSON.stringify(running), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, {
    intent: {
      canvasId: "default",
      fixtureScopeId: "",
      generationInputKey: identity.generationInputKey,
      generationOwnershipKey: identity.generationOwnershipKey,
      idempotencyKey: "m41-text-prompt-owner-key",
      kind,
      modelConfigurationRevision: identity.modelConfigurationRevision,
      modelInputContractFingerprint: identity.modelInputContractFingerprint,
      modelReleaseRevision: identity.modelReleaseRevision,
      nodeId: nodeId(kind),
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-09T10:50:00.250Z",
      version: 2,
    },
    running: runningTask,
    slot: intentSlot,
    success: successTask,
    taskId,
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Text prompt owner",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.text,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  let projectionApplied = false;
  await page.route("**/__m41-text-prompt-projection", async (route) => {
    projectionApplied = true;
    await route.fulfill({ body: "", status: 204 });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      response,
      json: !projectionApplied
        ? document
        : {
            ...document,
            nodes: document.nodes?.map((node) =>
              node.id === nodeId(kind)
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      ...authoritativeGenerationSuccessData(
                        kind,
                        successTask as unknown as GenerationTaskSummary,
                      ),
                    },
                  }
                : node
            ),
          },
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (inbound.method() === "POST") generationPosts += 1;
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          ...generationNodeIdentityData(kind, identity),
          content: protectedBody,
          contentHtml: `<p>${protectedBody}</p>`,
          textGenerating: true,
          textGenerationTaskId: taskId,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41TextPromptOwner?: { taskGets: number };
      }).__m41TextPromptOwner?.taskGets ?? 0)).toBeGreaterThanOrEqual(2);

    await selectNode(page, kind);
    const prompt = page.getByTestId("text-creator-prompt");
    await expect(prompt).toBeDisabled();
    await expect(prompt).toHaveValue(originalPrompt);

    await page.evaluate(() => {
      (window as typeof window & {
        __m41TextPromptOwner?: { releaseSuccess?: () => void };
      }).__m41TextPromptOwner?.releaseSuccess?.();
    });
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41TextPromptOwner?: { lateResponses: number };
      }).__m41TextPromptOwner?.lateResponses ?? 0)).toBe(1);
    await flushBrowserTasks(page);
    await flushBrowserTasks(page);
    await expect(page.getByTestId("text-node-editor"))
      .toHaveText(successTask.resultText);
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        content: data?.content,
        generating: data?.textGenerating ?? false,
        prompt: data?.textPrompt,
        taskId: data?.textGenerationTaskId ?? null,
      };
    }).toEqual({
      content: successTask.resultText,
      generating: false,
      prompt: originalPrompt,
      taskId,
    });
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.getByTestId("text-node-editor"))
      .toHaveText(successTask.resultText);
    await selectNode(page, kind);
    await expect(page.getByTestId("text-creator-prompt"))
      .toHaveValue(originalPrompt);
    const reloadedCanvas = await readPageCanvas(page);
    const reloadedData = reloadedCanvas.nodes.find(
      (node) => node.id === nodeId(kind),
    )?.data;
    expect(reloadedData?.textGenerationTaskId).toBe(taskId);
    expect(reloadedData?.textGenerating).not.toBe(true);
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();
    expect(generationPosts).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await page.evaluate((slot) => {
      window.localStorage.removeItem(slot);
    }, intentSlot).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

test("an upstream Text body change stops its active poll without browser-clearing the server binding", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const targetId = nodeId(kind);
  const sourceId = "m41-text-upstream-owner-source";
  const taskId = "m41-text-upstream-owner-task";
  const intentSlot = submissionIntentSlot(kind);
  const originalPrompt = "text 原始提示词";
  const originalUpstream = "上游初始语义正文";
  const changedUpstream = "上游已提交的新语义正文";
  const protectedBody = "上游变化不得被迟到结果覆盖的目标正文";
  const submittedParameters = submissionParameterValues(
    schemas.text,
    defaultParameterValues(schemas.text),
  );
  const [targetNode] = canvasNodes(kind);
  const sourceNode = {
    data: {
      content: originalUpstream,
      contentHtml: `<p>${originalUpstream}</p>`,
      label: "Text",
      title: "上游语义来源",
    },
    id: sourceId,
    position: { x: 80, y: 80 },
    style: { height: 250, width: 250 },
    type: "text",
  };
  const upstreamEdge = {
    data: { inputOrder: 1, inputRole: "context-text" },
    id: "m41-text-upstream-owner-edge",
    source: sourceId,
    sourceHandle: "source",
    target: targetId,
    targetHandle: "target",
    type: "cuttable",
  };
  const initialPreflight = resolveNodeInputs({
    edges: [upstreamEdge],
    modelReleaseRevision: modelInputs.text.releaseRevisionId,
    modelSchema: schemas.text,
    nodes: [sourceNode, targetNode],
    ownPrompt: originalPrompt,
    parameters: submittedParameters,
    targetId,
    targetKind: kind,
  });
  expect(initialPreflight.canSubmit).toBe(true);
  expect(initialPreflight.inputs).toEqual([
    expect.objectContaining({
      sourceNodeId: sourceId,
      state: "ready",
      text: originalUpstream,
    }),
  ]);
  const activeInputKey = generationInputKey({
    inputs: initialPreflight.inputs,
    modelConfigurationRevision: modelInputs.text.configurationRevision,
    modelId: modelInputs.text.id,
    modelReleaseRevision: modelInputs.text.releaseRevisionId,
    ownPrompt: originalPrompt,
    parameters: submittedParameters,
    prompt: initialPreflight.finalPrompt,
  });
  const activeOwnershipKey = compactGenerationOwnershipKey({
    contractFingerprint: initialPreflight.contractFingerprint,
    modelConfigurationRevision: modelInputs.text.configurationRevision,
    modelId: modelInputs.text.id,
    modelReleaseRevision: modelInputs.text.releaseRevisionId,
    parameters: defaultParameterValues(schemas.text),
    prompt: originalPrompt,
    upstream: [{
      edgeId: upstreamEdge.id,
      order: 1,
      ready: true,
      role: "context-text",
      source: sourceId,
      sourceKind: "text",
      status: "ready",
      text: originalUpstream,
    }],
  });
  const identity: SubmittedGenerationIdentity = {
    fixtureScopeId: "",
    generationIdentityVersion: 2,
    generationInputKey: activeInputKey,
    generationOwnershipKey: activeOwnershipKey,
    modelConfigurationRevision: modelInputs.text.configurationRevision,
    modelInputContractFingerprint: initialPreflight.contractFingerprint ?? "",
    modelReleaseRevision: modelInputs.text.releaseRevisionId,
  };
  const runningTask = {
    ...identity,
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T10:55:00.000Z",
    id: taskId,
    generationInputKey: activeInputKey,
    kind,
    model: modelInputs.text.id,
    nodeId: targetId,
    prompt: initialPreflight.finalPrompt,
    state: "running",
    updatedAt: "2026-08-09T10:55:00.500Z",
  };
  const successTask = {
    ...runningTask,
    canvasProjectionState: "conflict",
    resultText: "迟到的旧上游生成结果",
    state: "success",
    updatedAt: "2026-08-09T10:55:01.000Z",
  };
  let generationPosts = 0;
  let modelReads = 0;
  let providerRequests = 0;
  let releaseModels!: () => void;
  const modelsGate = new Promise<void>((resolve) => {
    releaseModels = resolve;
  });

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript(({ intent, running, slot, success, taskId }) => {
    const marker = "__m41:text-upstream-owner-seeded";
    if (window.sessionStorage.getItem(marker) !== "1") {
      window.sessionStorage.setItem(marker, "1");
      window.localStorage.setItem(slot, JSON.stringify(intent));
    }
    const state: {
      lateResponses: number;
      releaseSuccess?: () => void;
      taskGets: number;
    } = { lateResponses: 0, taskGets: 0 };
    (window as typeof window & {
      __m41TextUpstreamOwner?: typeof state;
    }).__m41TextUpstreamOwner = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "GET" &&
        url.pathname === `/api/generation-tasks/${taskId}`
      ) {
        state.taskGets += 1;
        if (state.taskGets >= 2) {
          return new Promise<Response>((resolve) => {
            state.releaseSuccess = () => {
              state.lateResponses += 1;
              resolve(new Response(JSON.stringify(success), {
                headers: { "Content-Type": "application/json" },
                status: 200,
              }));
            };
          });
        }
        return Promise.resolve(new Response(JSON.stringify(running), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, {
    intent: {
      canvasId: "default",
      fixtureScopeId: "",
      generationInputKey: activeInputKey,
      generationOwnershipKey: activeOwnershipKey,
      idempotencyKey: "m41-text-upstream-owner-key",
      kind,
      modelConfigurationRevision: identity.modelConfigurationRevision,
      modelInputContractFingerprint: identity.modelInputContractFingerprint,
      modelReleaseRevision: identity.modelReleaseRevision,
      nodeId: targetId,
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-09T10:55:00.250Z",
      version: 2,
    },
    running: runningTask,
    slot: intentSlot,
    success: successTask,
    taskId,
  });
  await page.route("**/api/models", async (route) => {
    modelReads += 1;
    await modelsGate;
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Text upstream owner",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.text,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (inbound.method() === "POST") generationPosts += 1;
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [upstreamEdge],
      nodes: [
        sourceNode,
        {
          ...targetNode,
          data: {
            ...targetNode.data,
            ...generationNodeIdentityData(kind, identity),
            content: protectedBody,
            contentHtml: `<p>${protectedBody}</p>`,
            textGenerating: true,
            textGenerationTaskId: taskId,
          },
          position: { x: 620, y: 80 },
        },
      ],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();
  let heldSavePayload: {
    changes?: Array<{
      action?: string;
      field?: string;
      nodeId?: string;
      value?: unknown;
    }>;
    kind?: string;
  } | undefined;
  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => {
    markSaveStarted = resolve;
  });
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saveHeld = false;
  await page.route("**/api/canvases/default/commands", async (route) => {
    if (route.request().method() !== "POST" || saveHeld) {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as typeof heldSavePayload;
    const changesSourceBody = body?.kind === "apply-user-field-changes" &&
      body.changes?.some((change) =>
        change.nodeId === sourceId && change.field === "data.content" &&
        change.value === changedUpstream
      );
    if (!changesSourceBody) {
      await route.fallback();
      return;
    }
    saveHeld = true;
    heldSavePayload = body;
    markSaveStarted();
    await saveGate;
    await route.fallback();
  });

  try {
    await page.goto("/canvas");
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => modelReads).toBeGreaterThanOrEqual(1);
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41TextUpstreamOwner?: { taskGets: number };
      }).__m41TextUpstreamOwner?.taskGets ?? 0)).toBeGreaterThanOrEqual(2);

    const source = page.locator(`.react-flow__node[data-id="${sourceId}"]`);
    const target = page.locator(`.react-flow__node[data-id="${targetId}"]`);
    const retainedTargetIntent = await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot);
    expect(JSON.parse(retainedTargetIntent ?? "null")).toMatchObject({
      nodeId: targetId, taskId, generationInputKey: activeInputKey,
    });
    await source.click({ force: true });
    await source.getByTestId("canvas-node-text-content")
      .dispatchEvent("dblclick");
    const sourceEditor = source.getByTestId("text-node-editor");
    await expect(sourceEditor).toHaveAttribute("contenteditable", "true");
    await sourceEditor.fill(changedUpstream);
    await sourceEditor.press("Escape");
    await saveStarted;

    expect(heldSavePayload?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "set",
        field: "data.content",
        nodeId: sourceId,
        value: changedUpstream,
      }),
    ]));
    expect(heldSavePayload?.changes?.some((change) =>
      change.nodeId === targetId || /Generation|Generating/.test(change.field ?? "")
    )).toBe(false);
    // Editing the source does not discard the target's accepted-task evidence.
    // Its frozen input/result fence, not intent deletion, blocks stale results.
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBe(retainedTargetIntent);

    await target.click({ force: true, position: { x: 8, y: 8 } });
    await expect(page.getByTestId("text-creator")).toBeVisible();
    const generate = page.getByTestId("text-creator")
      .getByRole("button", { name: "Generate" });
    await expect(generate).toBeDisabled();
    await expect(target.getByTestId("text-node-editor")).toHaveText(
      protectedBody,
    );

    releaseSave();
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const sourceData = canvas.nodes.find((node) => node.id === sourceId)?.data;
      const targetData = canvas.nodes.find((node) => node.id === targetId)?.data;
      return {
        sourceContent: sourceData?.content,
        targetContent: targetData?.content,
        targetGenerating: targetData?.textGenerating,
        targetInputKey: targetData?.textGenerationInputKey ?? null,
        targetTaskId: targetData?.textGenerationTaskId ?? null,
      };
    }).toEqual({
      sourceContent: changedUpstream,
      targetContent: protectedBody,
      targetGenerating: true,
      targetInputKey: activeInputKey,
      targetTaskId: taskId,
    });

    await page.evaluate(() => {
      (window as typeof window & {
        __m41TextUpstreamOwner?: { releaseSuccess?: () => void };
      }).__m41TextUpstreamOwner?.releaseSuccess?.();
    });
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41TextUpstreamOwner?: { lateResponses: number };
      }).__m41TextUpstreamOwner?.lateResponses ?? 0)).toBe(1);
    await flushBrowserTasks(page);
    await flushBrowserTasks(page);
    await expect(target.getByTestId("text-node-editor")).toHaveText(
      protectedBody,
    );
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === targetId)?.data;
      return {
        content: data?.content,
        generating: data?.textGenerating,
        inputKey: data?.textGenerationInputKey ?? null,
        taskId: data?.textGenerationTaskId ?? null,
      };
    }).toEqual({
      content: protectedBody,
      generating: true,
      inputKey: activeInputKey,
      taskId,
    });
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBe(retainedTargetIntent);

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.locator(`.react-flow__node[data-id="${sourceId}"]`)
      .getByTestId("text-node-editor")).toHaveText(changedUpstream);
    await target.click({ force: true, position: { x: 8, y: 8 } });
    await expect(page.getByTestId("text-creator")).toBeVisible();
    await expect(target.getByTestId("text-node-editor")).toHaveText(
      protectedBody,
    );
    const reloadedCanvas = await (
      await request.get("/api/canvas/default")
    ).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    const reloadedTarget = reloadedCanvas.nodes.find(
      (node) => node.id === targetId,
    )?.data;
    expect(reloadedTarget?.textGenerationTaskId).toBe(taskId);
    expect(reloadedTarget?.textGenerating).toBe(true);
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBe(retainedTargetIntent);
    expect(generationPosts).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    releaseModels();
    releaseSave();
    await page.evaluate((slot) => {
      (window as typeof window & {
        __m41TextUpstreamOwner?: { releaseSuccess?: () => void };
      }).__m41TextUpstreamOwner?.releaseSuccess?.();
      window.localStorage.removeItem(slot);
    }, intentSlot).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

test("terminal Text success is adopted from authoritative Canvas without a browser terminal write", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const taskId = "m41-text-terminal-save-lost";
  const originalPrompt = "text 原始提示词";
  const oldBody = "terminal save 前保留的旧正文";
  const resultText = "reload exact GET 恢复的正文";
  const identity = currentStandaloneIdentity(kind);
  const inputKey = identity.generationInputKey;
  const ownershipKey = identity.generationOwnershipKey;
  const successTask = {
    ...identity,
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-10T11:00:00.000Z",
    generationInputKey: inputKey,
    generationOwnershipKey: ownershipKey,
    id: taskId,
    kind,
    model: modelInputs.text.id,
    nodeId: nodeId(kind),
    prompt: originalPrompt,
    canvasProjectionState: "applied",
    resultText,
    state: "success",
    updatedAt: "2026-08-10T11:00:01.000Z",
  };
  const intentSlot = submissionIntentSlot(kind);
  let exactReads = 0;
  let canvasCommands = 0;
  let generationPosts = 0;
  let projectionApplied = false;
  let providerRequests = 0;

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript(({ intent, marker, slot }) => {
    if (window.sessionStorage.getItem(marker) === "1") return;
    window.sessionStorage.setItem(marker, "1");
    window.localStorage.setItem(slot, JSON.stringify(intent));
  }, {
    intent: {
      canvasId: "default",
      fixtureScopeId: "",
      generationInputKey: inputKey,
      generationOwnershipKey: ownershipKey,
      idempotencyKey: "m41-text-terminal-save-lost-key",
      kind,
      modelConfigurationRevision: identity.modelConfigurationRevision,
      modelInputContractFingerprint: identity.modelInputContractFingerprint,
      modelReleaseRevision: identity.modelReleaseRevision,
      nodeId: nodeId(kind),
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-10T11:00:00.500Z",
      version: 2,
    },
    marker: "__m41:text-terminal-save-lost",
    slot: intentSlot,
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Terminal save Text",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          ...modelInputs.text,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (
      inbound.method() === "GET" &&
      url.pathname === `/api/generation-tasks/${taskId}`
    ) {
      exactReads += 1;
      projectionApplied = true;
      await route.fulfill({ json: successTask, status: 200 });
      return;
    }
    if (inbound.method() === "POST") generationPosts += 1;
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch({ maxRetries: 2 });
    const document = await response.json() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    await route.fulfill({
      response,
      json: !projectionApplied
        ? document
        : {
            ...document,
            nodes: document.nodes?.map((node) =>
              node.id === nodeId(kind)
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      ...authoritativeGenerationSuccessData(
                        kind,
                        successTask as unknown as GenerationTaskSummary,
                      ),
                    },
                  }
                : node
            ),
          },
    });
  });
  await page.route("**/api/canvases/default/commands", async (route) => {
    if (route.request().method() === "POST") canvasCommands += 1;
    await route.fallback();
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          ...generationNodeIdentityData(kind, identity),
          content: oldBody,
          contentHtml: `<p>${oldBody}</p>`,
          textGenerating: true,
          textGenerationTaskId: taskId,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => exactReads).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => {
      const canvas = await readPageCanvas(page);
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        content: data?.content,
        generating: data?.textGenerating ?? false,
        inputKey: data?.textGenerationInputKey ?? null,
        ownershipKey: data?.textGenerationOwnershipKey ?? null,
        taskId: data?.textGenerationTaskId,
      };
    }).toEqual({
      content: resultText,
      generating: false,
      inputKey: null,
      ownershipKey: null,
      taskId,
    });
    expect(canvasCommands).toBe(0);
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.getByTestId("text-node-editor")).toHaveText(resultText);
    expect(canvasCommands).toBe(0);
    expect(generationPosts).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await page.evaluate((slot) => {
      window.localStorage.removeItem(slot);
    }, intentSlot).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

for (const kind of ["image", "video"] as const) {
  test(`${kind} shows terminal cancellation without browser-clearing the server binding`, async ({
    page,
    request,
  }) => {
    const taskId = `m41-generate-cancelled-${kind}`;
    const intentSlot = submissionIntentSlot(kind);
    let providerRequests = 0;
    let taskReads = 0;
    let taskSubmissions = 0;
    let boundTask: GenerationTaskSummary | undefined;
    let releaseCancelled!: () => void;
    const cancelledGate = new Promise<void>((resolve) => {
      releaseCancelled = resolve;
    });
    let queuedTask = {
      ...currentStandaloneIdentity(kind),
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T11:00:00.000Z",
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      state: "queued",
      updatedAt: "2026-08-09T11:00:00.500Z",
    };

    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `Cancelled Generate ${kind}`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
          ...modelInputs[kind],
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/canvas/default", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const document = await response.json() as {
        nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
      };
      await route.fulfill({
        response,
        json: !boundTask
          ? document
          : {
              ...document,
              nodes: document.nodes?.map((node) =>
                node.id === nodeId(kind)
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        ...authoritativeGenerationBindingData(kind, boundTask!),
                      },
                    }
                  : node
              ),
            },
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
          json: {
            paidProviderRequests: 0,
            persistentQueueReady: true,
            providerConfigured: true,
            submissionEnabled: true,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
        await route.fulfill({
          json: { canEnqueue: true, canSubmit: true, canvasRevision: route.request().postDataJSON().canvasRevision, problems: [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}` &&
        inbound.method() === "GET"
      ) {
        taskReads += 1;
        await cancelledGate;
        await route.fulfill({
          json: {
            ...queuedTask,
            errorCode: "USER_CANCELLED",
            errorMessage: `${kind} 生成已取消`,
            state: "cancelled",
            updatedAt: "2026-08-09T11:00:01.000Z",
          },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "POST"
      ) {
        taskSubmissions += 1;
        queuedTask = {
          ...queuedTask,
          ...submittedGenerationIdentity(
            inbound.postDataJSON() as SubmittedGenerationIdentity,
          ),
        };
        boundTask = queuedTask as unknown as GenerationTaskSummary;
        await route.fulfill({ json: queuedTask, status: 202 });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({ json: { tasks: [] }, status: 200 });
        return;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await selectNode(page, kind);
      await page.getByTestId(`${kind}-creator`)
        .getByRole("button", { name: "Generate" })
        .click();
      await expect.poll(() => taskReads).toBeGreaterThanOrEqual(1);
      await expect.poll(() => page.evaluate(({ slot, taskId }) => {
        const serialized = window.localStorage.getItem(slot);
        return serialized
          ? (JSON.parse(serialized) as { taskId?: string }).taskId === taskId
          : false;
      }, { slot: intentSlot, taskId })).toBe(true);
      await expect.poll(async () => {
        const canvas = await readPageCanvas(page);
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return data?.[`${kind}GenerationTaskId`] ?? null;
      }).toBe(taskId);

      releaseCancelled();
      await expect(page.getByTestId(`${kind}-node-${nodeId(kind)}`)
        .getByRole("alert")).toContainText(`${kind} 生成已取消`);
      const cancelledCanvas = await readPageCanvas(page);
      expect(cancelledCanvas.nodes.find((node) =>
        node.id === nodeId(kind)
      )?.data[`${kind}GenerationTaskId`]).toBe(taskId);
      await expect.poll(() => page.evaluate((slot) =>
        window.localStorage.getItem(slot), intentSlot)).toBeNull();
      expect(taskSubmissions).toBe(1);
      expect(providerRequests).toBe(0);
    } finally {
      releaseCancelled();
      await page.evaluate((slot) => {
        window.localStorage.removeItem(slot);
      }, intentSlot).catch(() => undefined);
      await request.delete("/api/canvas/default");
    }
  });
}
