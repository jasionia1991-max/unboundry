import {
  expect,
  test,
  type Page,
} from "./safe-test";
import type {
  GenerationTaskSummary,
} from "../client/src/generation/generationTasks";
import {
  defaultParameterValues,
  knownModelParameterSchema,
} from "../types/modelParameters";
import { currentWorkflowGenerationBinding } from
  "../client/src/generation/workflowNodeExecutors";
import type {
  RecoveryCaseAdminSummary,
  RecoveryCaseSummary,
  RecoveryCasePhase,
  RecoveryPublicAction,
  RecoveryPublicStatus,
} from "../types/generationRecovery";

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
type RecoveryCaseWithReplacement = RecoveryCaseSummary & Readonly<{
  replacementTaskId?: string;
}>;

const canvasId = "m41-recovery-canvas";
const ownerId = "m41-recovery-owner";
const adminId = "m41-recovery-admin";
const loadToken = "11111111-1111-4111-8111-111111111111";
const saveEpoch = "m41-save-epoch";
const kinds = ["text", "image", "video", "audio"] as const;
type RecoveryKind = (typeof kinds)[number];

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

const schemas = Object.fromEntries(
  Object.entries(modelInputs).map(([capability, model]) => [
    capability,
    knownModelParameterSchema({
      capability: capability as RecoveryKind,
      providerDriver: model.providerDriver,
      providerModelId: model.providerModelId,
    }),
  ]),
) as Record<RecoveryKind, ReturnType<typeof knownModelParameterSchema>>;

const publishedModels = kinds.map((kind) => ({
  ...modelInputs[kind],
  capability: kind,
  displayName: `M41 ${kind} model`,
  generationAvailable: true,
  generationUnavailableReason: "",
  generationUnavailableReasonCode: null,
  isDefault: true,
  parameterSchema: schemas[kind],
}));

type RecoveryIdentity = Readonly<{
  generationInputKey: string;
  generationOwnershipKey: string;
  modelConfigurationRevision: string;
  modelInputContractFingerprint: string;
  modelReleaseRevision: string;
}>;

const nodeFields: Record<RecoveryKind, Readonly<{
  config: string;
  contract: string;
  error: string;
  errorCode: string;
  input: string;
  model: string;
  parameters: string;
  prompt: string;
  promptReady: string;
  release: string;
  task: string;
  generating: string;
  ownership: string;
}>> = {
  audio: {
    config: "audioGenerationModelConfigurationRevision",
    contract: "audioGenerationContractFingerprint",
    error: "audioGenerationError",
    errorCode: "audioGenerationErrorCode",
    generating: "audioGenerating",
    input: "audioGenerationInputKey",
    model: "audioModelId",
    parameters: "audioParameters",
    ownership: "audioGenerationOwnershipKey",
    prompt: "audioPrompt",
    promptReady: "audioPromptReady",
    release: "audioGenerationModelReleaseRevision",
    task: "audioGenerationTaskId",
  },
  image: {
    config: "imageGenerationModelConfigurationRevision",
    contract: "imageGenerationContractFingerprint",
    error: "imageGenerationError",
    errorCode: "imageGenerationErrorCode",
    generating: "imageGenerating",
    input: "imageGenerationInputKey",
    model: "imageModelId",
    parameters: "imageParameters",
    ownership: "imageGenerationOwnershipKey",
    prompt: "imagePrompt",
    promptReady: "imagePromptReady",
    release: "imageGenerationModelReleaseRevision",
    task: "imageGenerationTaskId",
  },
  text: {
    config: "textGenerationModelConfigurationRevision",
    contract: "textGenerationContractFingerprint",
    error: "textGenerationError",
    errorCode: "textGenerationErrorCode",
    generating: "textGenerating",
    input: "textGenerationInputKey",
    model: "textModelId",
    parameters: "textParameters",
    ownership: "textGenerationOwnershipKey",
    prompt: "textPrompt",
    promptReady: "textPromptReady",
    release: "textGenerationModelReleaseRevision",
    task: "textGenerationTaskId",
  },
  video: {
    config: "videoGenerationModelConfigurationRevision",
    contract: "videoGenerationModelInputContractFingerprint",
    error: "videoGenerationError",
    errorCode: "videoGenerationErrorCode",
    generating: "videoGenerating",
    input: "videoGenerationInputKey",
    model: "videoModelId",
    parameters: "videoParameters",
    ownership: "videoGenerationOwnershipKey",
    prompt: "videoPrompt",
    promptReady: "videoPromptReady",
    release: "videoGenerationModelReleaseRevision",
    task: "videoGenerationTaskId",
  },
};

const timestamp = "2026-09-08T00:00:00.000Z";

function taskIdFor(kind: RecoveryKind, index: number) {
  return `m41-task-${index}-${kind}`;
}

function nodeIdFor(kind: RecoveryKind) {
  return `m41-node-${kind}`;
}

const recoveryIdentityCache = new Map<RecoveryKind, RecoveryIdentity>();

function recoveryIdentityFor(kind: RecoveryKind): RecoveryIdentity {
  const cached = recoveryIdentityCache.get(kind);
  if (cached) return cached;
  const model = modelInputs[kind];
  const prompt = `${kind} 原始提示词`;
  const node = {
    data: {
      label: kind,
      [`${kind}ModelId`]: model.id,
      [`${kind}Parameters`]: defaultParameterValues(schemas[kind]),
      [`${kind}Prompt`]: prompt,
      ...(kind === "text" ? { content: "" } : {}),
    },
    id: nodeIdFor(kind),
    position: { x: 0, y: 0 },
    style: { height: 250, width: 250 },
    type: kind,
  };
  const published = publishedModels.find((item) => item.capability === kind);
  if (!published) throw new Error(`Missing published model for ${kind}`);
  const binding = currentWorkflowGenerationBinding({
    context: {
      canvasId,
      graph: {
        apply: () => ({ status: "rejected" }),
        snapshot: () => ({ edges: [], nodes: [node] }),
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
    nodeId: nodeIdFor(kind),
  });
  if (
    !binding ||
    !binding.inputFingerprint ||
    !binding.ownershipKey ||
    !binding.inputContractFingerprint
  ) {
    throw new Error(`Missing generation identity for ${kind}`);
  }
  const identity: RecoveryIdentity = {
    generationInputKey: binding.inputFingerprint,
    generationOwnershipKey: binding.ownershipKey,
    modelConfigurationRevision: binding.modelConfigurationRevision,
    modelInputContractFingerprint: binding.inputContractFingerprint,
    modelReleaseRevision: binding.modelReleaseRevision,
  };
  recoveryIdentityCache.set(kind, identity);
  return identity;
}

function taskFor(
  kind: RecoveryKind,
  index: number,
  overrides: Partial<GenerationTaskSummary> = {},
): GenerationTaskSummary {
  const id = overrides.id ?? taskIdFor(kind, index);
  const identity = recoveryIdentityFor(kind);
  const task: GenerationTaskSummary = {
    attempt: 1,
    canvasId,
    costCurrency: "CNY",
    createdAt: timestamp,
    errorCode: "OUTCOME_UNKNOWN_BILLING_RISK",
    errorMessage: "平台请求结果暂未确认，系统会继续核对。",
    fixtureScopeId: "",
    generationIdentityVersion: 2,
    generationInputKey: identity.generationInputKey,
    generationOwnershipKey: identity.generationOwnershipKey,
    id,
    kind,
    model: modelInputs[kind].id,
    modelInputContractFingerprint: identity.modelInputContractFingerprint,
    modelConfigurationRevision: identity.modelConfigurationRevision,
    modelReleaseRevision: identity.modelReleaseRevision,
    nodeId: overrides.nodeId ?? nodeIdFor(kind),
    prompt: `${kind} 原始提示词`,
    retryAllowed: false,
    state: "failed",
    updatedAt: timestamp,
  };
  return { ...task, ...overrides };
}

function recoveryCaseFor(
  kind: RecoveryKind,
  index: number,
  overrides: Partial<RecoveryCaseWithReplacement> = {},
): RecoveryCaseWithReplacement {
  const taskId = overrides.taskId ?? taskIdFor(kind, index);
  const phase: RecoveryCasePhase = overrides.phase ?? "queued";
  const status: RecoveryPublicStatus = overrides.status ?? "queued";
  const action: RecoveryPublicAction = overrides.action ?? "view_progress";
  return {
    action,
    caseEventId: overrides.caseEventId ?? 100 + index,
    caseId: overrides.caseId ?? `m41-case-${index}-${kind}`,
    canvasId,
    executionAttempt: 1,
    kind,
    nodeId: nodeIdFor(kind),
    phase,
    progressVersion: overrides.progressVersion ?? 1,
    reasonCode: "outcome_unknown",
    status,
    summary: overrides.summary ?? "系统已登记该节点的异常，正在安全核对原请求。",
    taskId,
    unread: overrides.unread ?? true,
    updatedAt: overrides.updatedAt ?? timestamp,
    ...(overrides.lastCheckedAt ? { lastCheckedAt: overrides.lastCheckedAt } : {}),
    ...(overrides.nextCheckAt ? { nextCheckAt: overrides.nextCheckAt } : {}),
    ...(overrides.replacementTaskId
      ? { replacementTaskId: overrides.replacementTaskId }
      : {}),
  };
}

type RecoveryUiState = {
  adminDetailGate?: Readonly<{
    promise: Promise<void>;
    release: () => void;
    taskId: string;
  }>;
  adminAllowed: boolean;
  cases: Map<string, RecoveryCaseWithReplacement>;
  enabled: boolean;
  ownerId: string;
  requests: Array<{
    body?: unknown;
    headers: Record<string, string>;
    method: string;
    pathname: string;
    query: string;
  }>;
  resultApplied: boolean;
  tasks: Map<string, GenerationTaskSummary>;
  unavailable: boolean;
  recoveryStatus?: number;
  canvasKinds: readonly RecoveryKind[];
};

function createRecoveryUiState(options: Readonly<{
  adminAllowed?: boolean;
  canvasKinds?: readonly RecoveryKind[];
  cases?: readonly RecoveryCaseWithReplacement[];
  enabled?: boolean;
  resultApplied?: boolean;
  tasks?: readonly GenerationTaskSummary[];
  unavailable?: boolean;
}> = {}): RecoveryUiState {
  const canvasKinds = options.canvasKinds ?? kinds;
  const cases = options.cases ?? canvasKinds.map((kind, index) =>
    recoveryCaseFor(kind, index));
  const tasks = options.tasks ?? cases.map((item, index) =>
    taskFor(item.kind, index));
  return {
    adminAllowed: options.adminAllowed ?? true,
    cases: new Map(cases.map((item) => [item.taskId, item])),
    canvasKinds,
    enabled: options.enabled ?? true,
    ownerId,
    requests: [],
    resultApplied: options.resultApplied ?? false,
    tasks: new Map(tasks.map((item) => [item.id, item])),
    unavailable: options.unavailable ?? false,
  };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function requestBody(route: Route): unknown {
  const raw = route.request().postData();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function recordRequest(route: Route, state: RecoveryUiState) {
  const request = route.request();
  const url = new URL(request.url());
  state.requests.push({
    body: requestBody(route),
    headers: request.headers(),
    method: request.method(),
    pathname: url.pathname,
    query: url.search,
  });
}

async function respond(route: Route, status: number, body: unknown) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}

function adminSummary(item: RecoveryCaseWithReplacement): RecoveryCaseAdminSummary {
  return {
    ...item,
    attemptStartedAt: timestamp,
    followUpDue: item.phase === "claimed" || item.phase === "waiting_provider",
    openedAt: "2026-09-07T00:00:00.000Z",
    originalCreatedAt: timestamp,
    ownerId,
    overdue: item.phase === "queued",
    modelId: modelInputs[item.kind].id,
    providerModelId: modelInputs[item.kind].providerModelId,
    ...(item.phase === "claimed" || item.phase === "waiting_provider"
      ? {
          claimedBy: adminId,
          claimLeaseUntil: "2026-09-07T00:00:00.000Z",
        }
      : {}),
  };
}

function canvasDocument(state: RecoveryUiState) {
  const nodes = state.canvasKinds.map((kind, index) => {
    const fields = nodeFields[kind];
    const taskId = taskIdFor(kind, index);
    const task = state.tasks.get(taskId) ?? taskFor(kind, index);
    const resultApplied = state.resultApplied && kind === "text";
    const identity = recoveryIdentityFor(kind);
    const projectedTask = resultApplied && task.replacementTaskId
      ? state.tasks.get(task.replacementTaskId) ?? task
      : task;
    const resultText = projectedTask.resultText ?? "恢复后的文字结果";
    const data: Record<string, unknown> = {
      [fields.config]: projectedTask.modelConfigurationRevision ??
        identity.modelConfigurationRevision,
      [fields.error]: resultApplied ? undefined : task.errorMessage,
      [fields.errorCode]: resultApplied ? undefined : task.errorCode,
      [fields.generating]: false,
      [fields.input]: resultApplied ? undefined : task.generationInputKey,
      [fields.model]: task.model ?? modelInputs[kind].id,
      [fields.ownership]: resultApplied ? undefined : task.generationOwnershipKey,
      [fields.parameters]: defaultParameterValues(schemas[kind]),
      [fields.prompt]: task.prompt,
      [fields.promptReady]: true,
      [fields.release]: projectedTask.modelReleaseRevision ??
        identity.modelReleaseRevision,
      [fields.task]: resultApplied ? projectedTask.id : task.id,
      [fields.contract]: projectedTask.modelInputContractFingerprint ??
        identity.modelInputContractFingerprint,
      groupRunSuccessInputFingerprint: resultApplied
        ? projectedTask.generationInputKey
        : undefined,
      groupRunSuccessModelConfigurationRevision: resultApplied
        ? projectedTask.modelConfigurationRevision
        : undefined,
      groupRunSuccessModelReleaseRevision: resultApplied
        ? projectedTask.modelReleaseRevision
        : undefined,
      groupRunSuccessOwnershipKey: resultApplied
        ? projectedTask.generationOwnershipKey
        : undefined,
      groupRunSuccessResultKey: resultApplied
        ? JSON.stringify({
            content: resultText,
            contentHtml: `<p>${resultText}</p>`,
          })
        : undefined,
      groupRunSuccessTaskId: resultApplied ? projectedTask.id : undefined,
      label: kind,
      title: `m41 ${kind} 节点`,
    };
    if (resultApplied) {
      data.content = resultText;
      data.contentHtml = `<p>${resultText}</p>`;
    }
    if (kind === "video") {
      data.videoModel = task.model;
    }
    return {
      data,
      id: nodeIdFor(kind),
      position: { x: 40 + index * 310, y: 120 },
      selected: kind === "text",
      style: {
        height: 250,
        width: kind === "text" || kind === "image" ? 250 : 444,
      },
      type: kind,
      zIndex: 0,
    };
  });
  return {
    currentWriterSequence: 0,
    currentWriterSessionId: null,
    edges: [],
    graphRevision: state.resultApplied ? 2 : 1,
    loadToken,
    nodes,
    revision: state.resultApplied ? 2 : 1,
    saveEpoch,
    sessionHighWaterAttemptId: null,
    sessionHighWaterSequence: 0,
    viewport: { x: 0, y: 0, zoom: 0.8 },
  };
}

async function installProductRoutes(
  page: Page,
  state: RecoveryUiState,
  options: Readonly<{ role?: "admin" | "user" }> = {},
) {
  const role = options.role ?? "user";
  const currentId = role === "admin" ? adminId : state.ownerId;
  const permissions = role === "admin" && state.adminAllowed
    ? ["manage_generation_recovery"]
    : [];

  await page.route("**/api/auth/status", async (route) => {
    await respond(route, 200, {
      authenticated: true,
      bootstrapRequired: false,
      user: {
        displayName: role === "admin" ? "恢复管理员" : "恢复用户",
        id: currentId,
        loginName: currentId,
        role,
        status: "active",
      },
    });
  });
  await page.route("**/api/account-context", async (route) => {
    await respond(route, 200, { permissions });
  });
  await page.route("**/api/models", async (route) => {
    await respond(route, 200, {
      generationEnabled: true,
      models: publishedModels,
    });
  });
  await page.route("**/api/agent-config", async (route) => {
    await respond(route, 200, {
      defaultModelId: "m41-agent-model",
      executionEnabled: false,
      models: [],
      skills: [],
      suggestions: [],
    });
  });
  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() === "GET") {
      await respond(route, 200, canvasDocument(state));
      return;
    }
    await respond(route, 200, canvasDocument(state));
  });
  await page.route("**/api/project-title/**", async (route) => {
    await respond(route, 200, { title: "m41 recovery canvas", updatedAt: 1 });
  });
  await page.route("**/api/workflow-runs**", async (route) => {
    await respond(route, 200, { runs: [] });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const url = new URL(route.request().url());
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length === 2) {
      await respond(route, 200, {
        tasks: [...state.tasks.values()],
      });
      return;
    }
    const taskId = decodeURIComponent(pathParts.at(-1) ?? "");
    const task = state.tasks.get(taskId);
    if (!task) {
      await respond(route, 404, { code: "GENERATION_TASK_NOT_FOUND", error: "任务不存在" });
      return;
    }
    if (task.replacementTaskId && state.tasks.has(task.replacementTaskId)) {
      const replacement = state.tasks.get(task.replacementTaskId)!;
      if (replacement.state === "success") state.resultApplied = true;
    }
    await respond(route, 200, task);
  });
  await page.route("**/api/generation-recovery**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/").filter(Boolean);
    recordRequest(route, state);
    if (state.unavailable || state.recoveryStatus !== undefined) {
      const status = state.recoveryStatus ?? 503;
      await respond(route, status, {
        code: status === 404 ? "RECOVERY_ROUTE_NOT_FOUND" : "RECOVERY_UNAVAILABLE",
        error: "恢复状态暂时无法读取",
      });
      return;
    }
    if (parts.length === 2 && request.method() === "GET") {
      const taskIds = (url.searchParams.get("taskIds") ?? "")
        .split(",")
        .filter(Boolean);
      const cases = state.enabled
        ? taskIds.flatMap((taskId) => {
            const item = state.cases.get(taskId);
            return item ? [item] : [];
          })
        : [];
      await respond(route, 200, { enabled: state.enabled, cases });
      return;
    }
    if (parts.length === 4 && parts[3] === "read" && request.method() === "POST") {
      const taskId = decodeURIComponent(parts[2]);
      const item = state.cases.get(taskId);
      if (!item) {
        await respond(route, 404, { code: "RECOVERY_NOT_FOUND", error: "事项不存在" });
        return;
      }
      const updated = { ...item, unread: false };
      state.cases.set(taskId, updated);
      await respond(route, 200, { enabled: state.enabled, case: updated });
      return;
    }
    if (parts.length === 3 && request.method() === "GET") {
      const item = state.cases.get(decodeURIComponent(parts[2]));
      await respond(route, 200, { enabled: state.enabled, case: item ?? null });
      return;
    }
    await respond(route, 405, { code: "RECOVERY_INVALID_COMMAND", error: "操作不受支持" });
  });
  await page.route("**/api/admin/generation-recovery**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/").filter(Boolean);
    recordRequest(route, state);
    if (role !== "admin" || !state.adminAllowed) {
      await respond(route, 403, {
        code: "RECOVERY_ADMIN_REQUIRED",
        error: "只有管理员可以处理此事项",
      });
      return;
    }
    if (parts.length === 3 && request.method() === "GET") {
      await respond(route, 200, {
        cases: state.enabled ? [...state.cases.values()].map(adminSummary) : [],
        corrupt: [],
        enabled: state.enabled,
        unavailableCount: 0,
      });
      return;
    }
    const taskId = decodeURIComponent(parts[3] ?? "");
    const item = state.cases.get(taskId);
    if (!item) {
      await respond(route, 404, { code: "RECOVERY_NOT_FOUND", error: "事项不存在" });
      return;
    }
    if (parts.length === 4 && request.method() === "GET") {
      if (state.adminDetailGate && state.adminDetailGate.taskId === taskId) {
        await state.adminDetailGate.promise;
      }
      await respond(route, 200, {
        audit: [
          {
            action: "generation_recovery.case_opened",
            actor: "system",
            createdAt: item.updatedAt,
            id: item.caseEventId,
          },
        ],
        case: adminSummary(item),
        enabled: state.enabled,
      });
      return;
    }
    const action = parts[4];
    if (parts.length === 5 && request.method() === "POST") {
      const next: RecoveryCaseWithReplacement = action === "claim"
        ? {
            ...item,
            action: "view_progress",
            caseEventId: item.caseEventId + 1,
            phase: "claimed",
            status: "claimed",
            summary: "维护人员已接手，正在继续核对原请求。",
          }
        : action === "progress"
          ? {
              ...item,
              action: "view_progress",
              caseEventId: item.caseEventId + 1,
              phase: "waiting_provider",
              status: "waiting_provider",
              summary: "正在等待平台回复，原任务记录已保留。",
            }
          : {
              ...item,
              action: "view_progress",
              caseEventId: item.caseEventId + 1,
              summary: "已核对原请求，继续等待可验证结果。",
            };
      state.cases.set(taskId, next);
      await respond(route, 200, {
        audit: [
          {
            action: action === "claim"
              ? "generation_recovery.case_claimed"
              : action === "progress"
                ? "generation_recovery.case_progressed"
                : "generation_recovery.case_checked",
            actor: adminId,
            createdAt: timestamp,
            id: next.caseEventId,
          },
        ],
        case: adminSummary(next),
        enabled: state.enabled,
      });
      return;
    }
    await respond(route, 405, { code: "RECOVERY_INVALID_COMMAND", error: "操作不受支持" });
  });
}

async function openCanvas(page: Page, state: RecoveryUiState) {
  await installProductRoutes(page, state);
  await page.goto(`/canvas/${canvasId}`);
  await expect(page.getByTestId("canvas-shell")).toHaveAttribute(
    "data-canvas-load-state",
    "ready",
  );
}

test.describe("generation recovery cases product UI", () => {
  test("four node kinds show one server summary and a Chinese progress detail", async ({ page }) => {
    const state = createRecoveryUiState();
    await openCanvas(page, state);

    await expect(page.locator('[data-testid^="provider-error-notice-"]')).toHaveCount(4);
    for (const [index, kind] of kinds.entries()) {
      const taskId = taskIdFor(kind, index);
      const notice = page.getByTestId(`provider-error-notice-${taskId}`);
      await expect(notice).toHaveAttribute("data-recovery-status", "queued");
      await expect(notice.locator(".provider-recovery-summary")).toHaveText(
        "系统已登记该节点的异常，正在安全核对原请求。",
      );
      await expect(notice.locator(".provider-error-summary")).toHaveCount(0);
    }
    await expect(page.getByTestId("generation-recovery-progress-trigger")).toHaveCount(4);
    await page.getByTestId("generation-recovery-progress-trigger").first().click();
    await expect(page.getByTestId("generation-recovery-progress-detail").first()).toContainText(
      "阶段：已登记待处理",
    );
    await expect(page.getByTestId("generation-recovery-progress-detail").first()).toContainText(
      "最近更新",
    );
  });

  test("replacement follow-up updates the node and history opens the original result", async ({ page }) => {
    const original = taskFor("text", 0, {
      replacementTaskId: "m41-task-replacement-text",
    });
    const replacement = taskFor("text", 1, {
      id: "m41-task-replacement-text",
      generationInputKey: original.generationInputKey,
      generationOwnershipKey: original.generationOwnershipKey,
      modelInputContractFingerprint: original.modelInputContractFingerprint,
      modelConfigurationRevision: original.modelConfigurationRevision,
      modelReleaseRevision: original.modelReleaseRevision,
      nodeId: nodeIdFor("text"),
      canvasProjectionState: "applied",
      resultText: "恢复后的文字结果",
      state: "success",
      updatedAt: "2026-09-08T00:01:00.000Z",
    });
    const state = createRecoveryUiState({
      canvasKinds: ["text"],
      cases: [recoveryCaseFor("text", 0, {
        action: "view_result",
        phase: "result_recovered",
        status: "result_recovered",
        summary: "原结果已找回，可在任务记录中查看。",
      })],
      tasks: [original, replacement],
    });
    await openCanvas(page, state);

    await expect(page.getByTestId("canvas-node-text-content")).toContainText(
      "恢复后的文字结果",
    );
    await expect(page.getByTestId(`provider-error-notice-${original.id}`)).toHaveCount(0);

    await page.getByTestId("tasks").click();
    await expect(page.getByTestId("tasks-recovery-history")).toBeVisible();
    await page.getByTestId("tasks-recovery-view-result").click();
    await expect(page.getByTestId("tasks-recovery-result-detail")).toContainText(
      "恢复后的文字结果",
    );
    await page.getByTestId("tasks-recovery-read").click();
    await expect.poll(() => state.requests.filter((request) =>
      request.pathname.endsWith("/read") && request.method === "POST",
    ).length).toBe(1);
    const readRequest = state.requests.find((request) =>
      request.pathname.endsWith("/read") && request.method === "POST",
    );
    expect(readRequest?.headers["x-unboundry-recovery-command"]).toBe("v1");
    expect(readRequest?.body).toEqual(expect.objectContaining({
      expectedCaseEventId: 100,
      progressVersion: 1,
    }));
  });

  test("feature off and server unavailable preserve the old task history", async ({ page }) => {
    const state = createRecoveryUiState({ enabled: false, canvasKinds: ["text"] });
    await openCanvas(page, state);

    const oldNotice = page.getByTestId("provider-error-notice-m41-task-0-text");
    await expect(oldNotice).toHaveCount(1);
    await expect(oldNotice).not.toHaveAttribute("data-recovery-status");
    await page.getByTestId("tasks").click();
    await expect(page.getByTestId("tasks-row-m41-task-0-text")).toBeVisible();
    await expect(page.getByTestId("tasks-recovery-history")).toHaveCount(0);

    state.enabled = true;
    state.unavailable = true;
    await page.reload();
    await expect(page.getByTestId("canvas-shell")).toHaveAttribute(
      "data-canvas-load-state",
      "ready",
    );
    await page.getByTestId("tasks").click();
    await expect(page.getByTestId("tasks-recovery-unavailable")).toContainText(
      "原任务记录已保留",
    );
    await expect(page.getByTestId("tasks-row-m41-task-0-text")).toBeVisible();

    state.unavailable = false;
    state.recoveryStatus = 404;
    await page.reload();
    await expect(page.getByTestId("canvas-shell")).toHaveAttribute(
      "data-canvas-load-state",
      "ready",
    );
    await page.getByTestId("tasks").click();
    await expect(page.getByTestId("tasks-recovery-unavailable")).toContainText(
      "原任务记录已保留",
    );
    await expect(page.getByTestId("tasks-row-m41-task-0-text")).toBeVisible();

    state.recoveryStatus = undefined;
    await page.context().setOffline(true);
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(page.getByTestId("tasks-row-m41-task-0-text")).toBeVisible();
    } finally {
      await page.context().setOffline(false);
    }
  });

  test("owner observation rotates a 51 task registration in bounded batches", async ({ page }) => {
    const tasks = Array.from({ length: 51 }, (_, index) =>
      taskFor("text", index, {
        id: `m41-batch-task-${index}`,
        nodeId: nodeIdFor("text"),
      }));
    const cases = tasks.map((task, index) => recoveryCaseFor("text", index, {
      action: "view_progress",
      caseEventId: 1_000 + index,
      phase: "waiting_provider",
      status: "waiting_provider",
      summary: "正在等待平台回复，原任务记录已保留。",
      taskId: task.id,
    }));
    const state = createRecoveryUiState({
      cases,
      canvasKinds: ["text"],
      tasks,
    });
    await openCanvas(page, state);
    await page.getByTestId("tasks").click();
    await expect(page.getByTestId("tasks-list")).toBeVisible();
    await expect.poll(() => state.requests
      .filter((request) =>
        request.pathname === "/api/generation-recovery" && request.method === "GET",
      )
      .some((request) =>
        (new URLSearchParams(request.query).get("taskIds")?.split(",") ?? [])
          .includes("m41-batch-task-50"),
      ), {
        timeout: 15_000,
        intervals: [100, 250, 500, 1_000],
      }).toBe(true);
    const recoveryQueries = state.requests
      .filter((request) => request.pathname === "/api/generation-recovery" && request.method === "GET")
      .map((request) => new URLSearchParams(request.query).get("taskIds")?.split(",") ?? []);
    expect(recoveryQueries.every((query) => query.length > 0 && query.length <= 50)).toBe(true);
    expect(recoveryQueries.some((query) => query.includes("m41-batch-task-50"))).toBe(true);
  });

  test("admin route requires the permission and exposes CAS maintenance actions", async ({ page }) => {
    const deniedPage = await page.context().newPage();
    const deniedState = createRecoveryUiState({
      adminAllowed: false,
      canvasKinds: [],
    });
    await installProductRoutes(deniedPage, deniedState, { role: "user" });
    await deniedPage.goto("/admin/generation-recovery");
    await expect(deniedPage).toHaveURL(/\/$/);
    await deniedPage.close();

    const first = recoveryCaseFor("video", 2, {
      summary: "第一项维护事项，响应较慢。",
    });
    const second = recoveryCaseFor("text", 3, {
      phase: "claimed",
      status: "claimed",
      summary: "第二项维护事项，应保持当前选中。",
    });
    const firstDetailGate = deferred();
    const state = createRecoveryUiState({
      cases: [first, second],
      canvasKinds: [],
    });
    state.adminDetailGate = {
      ...firstDetailGate,
      taskId: first.taskId,
    };
    await installProductRoutes(page, state, { role: "admin" });
    await page.goto("/admin/generation-recovery");
    await expect(page.getByTestId("admin-generation-recovery-page")).toBeVisible();
    await expect(page.getByTestId("admin-recovery-case").first()).toContainText(
      "待接手超过 24 小时",
    );
    const rows = page.getByTestId("admin-recovery-case");
    await rows.nth(0).locator("button").click();
    await expect.poll(() => state.requests.filter((request) =>
      request.pathname === `/api/admin/generation-recovery/${first.taskId}` &&
      request.method === "GET",
    ).length).toBe(1);
    await rows.nth(1).locator("button").click();
    await expect(page.getByTestId("admin-recovery-detail")).toContainText(
      second.summary,
    );
    firstDetailGate.release();
    await expect(page.getByTestId("admin-recovery-detail")).toContainText(
      second.summary,
    );
    await page.getByRole("button", { name: "重新接手维护" }).click();
    await expect(page.getByTestId("admin-recovery-detail")).toContainText(
      "维护人员已接手",
    );
    const claimRequest = state.requests.find((request) =>
      request.pathname.endsWith("/claim") && request.method === "POST",
    );
    expect(claimRequest?.headers["x-unboundry-recovery-command"]).toBe("v1");
    expect(claimRequest?.body).toEqual(expect.objectContaining({
      expectedCaseEventId: 103,
    }));
  });
});
