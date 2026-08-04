import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { imageReferenceForProvider, saveGeneratedPng } from "./assetStorage";
import { requestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";
import { createGenerationSafetyStore, generationSafetyStatus } from "./generationSafety";
import {
  createGenerationTaskStore,
  failRecoveredGenerationTasks,
  generationProviderAttemptCounts,
  GenerationProviderAttemptBlockedError,
  GenerationTaskCanvasRevisionConflictError,
  GenerationTaskConflictError,
  GenerationTaskProviderBoundaryError,
  type GenerationTask,
  type GenerationTaskInput,
} from "./generationTaskStore";
import {
  generateOpenRouterImage,
  OpenRouterImageError,
} from "./openRouterImageProvider";
import { readableMediaForOwner } from "./mediaRegistry";
import {
  arkVideoBase64BudgetBytes,
  arkVideoBase64Bytes,
  arkVideoBase64EnvelopeBytes,
  arkVideoMediaProblem,
  arkVideoMediaRecordForOwner,
  assertArkVideoMediaCombination,
  assertArkVideoBase64Budget,
  ProviderMediaError,
  providerMediaUrlForOwner,
  type ArkVideoMediaRecord,
} from "./providerMedia";
import {
  acquireProviderGenerationRequestLease,
  getProviderGenerationProfileState,
  getProviderProfileForGeneration,
  providerConfigurationVersion,
  ProviderGenerationConfigurationError,
  type ProviderGenerationRequestLease,
  type ProviderProfile,
} from "./providerProfiles";
import {
  evaluateModelRuntimeAvailability,
  modelGenerationAdapterSupported,
} from "./modelAvailability";
import { saveGeneratedMp4 } from "./videoStorage";
import { saveGeneratedAudio, saveGeneratedMp3 } from "./audioStorage";
import {
  createMurekaAudioTask,
  downloadMurekaAudioResult,
  getMurekaAudioTask,
  MurekaAudioError,
  type MurekaAudioQueryKind,
} from "./murekaAudioProvider";
import {
  cancelVolcengineArkVideoTask,
  createVolcengineArkVideoTask,
  getVolcengineArkVideoTask,
  seedanceMiniAudioPriceMicrounitsPerThousandTokens,
  type ArkVideoMediaInput,
  VolcengineArkVideoError,
} from "./volcengineArkVideoProvider";
import {
  createVolcengineArkTextResponse,
  type ArkTextInput,
  VolcengineArkTextError,
} from "./volcengineArkTextProvider";
import {
  pollRelayMediaTask,
  RelayProviderError,
  requestRelayGptImage,
  requestRelayText,
  submitRelayMedia,
  type RelayMediaParamValue,
  type RelayTextContextInput,
  type RelayTextProviderProtocol,
  type RelayTransientMediaOutput,
} from "./relayProviderAdapters";
import {
  downloadProviderResultMedia,
  ProviderResultMediaError,
} from "./providerResultMedia";
import { removeUnpublishedGeneratedMedia } from "./generatedMediaCleanup";
import {
  cleanParameterSchema,
  knownModelParameterSchema,
  providerParameterSchema,
  validateParameterSchemaConstraints,
  validateParameterValues,
  type ModelParameterSchema,
  type ModelParameterValue,
} from "../types/modelParameters";
import {
  assertPersistedCanvasRevision,
  CanvasRevisionConflictError,
  resolvePersistedNodeInputs,
} from "./inputPreflight";
import {
  isNodeInputKind,
  resolveNodeInputs,
  type NodeInputKind,
  type NodeInputPreflight,
  type NodeInputProblem,
  type NodeInputSnapshot,
} from "../types/nodeInputs";
import {
  isProviderProtocol,
  type ProviderProtocol,
} from "../types/relayProtocols";

let store: ReturnType<typeof createGenerationTaskStore> | undefined;
const runningImageRequests = new Map<string, AbortController>();
const runningVideoRequests = new Map<string, AbortController>();
const runningAudioRequests = new Map<string, AbortController>();
const runningTextRequests = new Map<string, AbortController>();

type RelayProtocol = Exclude<ProviderProtocol, "native">;

function taskProviderProtocol(
  task: Pick<GenerationTask, "modelConfiguration">,
): ProviderProtocol {
  const value = task.modelConfiguration.providerProtocol;
  return isProviderProtocol(value) ? value : "native";
}

function relayTextProtocol(
  protocol: ProviderProtocol,
): protocol is RelayTextProviderProtocol {
  return protocol === "openai-chat" ||
    protocol === "openai-responses" ||
    protocol === "claude-messages" ||
    protocol === "gemini-generate-content";
}

function assertRelayProfile(
  profile: ProviderProfile,
  protocol: RelayProtocol,
) {
  if (
    profile.driver !== "multi-protocol-relay"
  ) {
    throw new RelayProviderError("FORMAT");
  }
  return {
    apiKey: profile.apiKey,
    baseUrl: profile.baseUrl,
    protocol,
  };
}

function requireTaskProviderSnapshot(
  task: Pick<GenerationTask, "modelConfiguration">,
  profile: ProviderProfile,
) {
  const expectedDriver = task.modelConfiguration.providerDriver;
  const expectedVersion = task.modelConfiguration.providerConfigurationVersion;
  if (
    (typeof expectedDriver === "string" && expectedDriver !== profile.driver) ||
    (
      typeof expectedVersion === "number" &&
      expectedVersion !== providerConfigurationVersion(profile)
    )
  ) {
    throw new ProviderGenerationConfigurationError(
      "PROVIDER_CONFIGURATION_MISMATCH",
      "平台连接配置已变化，已阻止旧任务继续请求",
    );
  }
  return profile;
}

function taskStore() {
  if (store) return store;
  store = createGenerationTaskStore(appDataDirectory());
  failRecoveredGenerationTasks(store);
  for (const task of store.listRecovering()) {
    const protocol = taskProviderProtocol(task);
    if (
      task.providerTaskId &&
      (
        task.kind === "video" ||
        task.kind === "audio" ||
        (task.kind === "image" && protocol === "media-generate")
      )
    ) {
      store.resume(task.id);
      setTimeout(
        () => void (task.kind === "image"
          ? executeImageTask(task.id)
          : task.kind === "video"
            ? executeVideoTask(task.id)
            : executeAudioTask(task.id)),
        0,
      );
    } else {
      store.transition(task.id, "failed", {
        code: "SERVICE_RESTARTED",
        message: "服务重启后无法安全继续本次生成，系统未重新提交",
      });
    }
  }
  return store;
}

function requireSameProviderConfiguration(
  expected: ProviderProfile,
  current: ProviderProfile | undefined,
) {
  if (
    !current ||
    current.id !== expected.id ||
    current.driver !== expected.driver ||
    providerConfigurationVersion(current) !==
      providerConfigurationVersion(expected)
  ) {
    throw new ProviderGenerationConfigurationError(
      "PROVIDER_CONFIGURATION_MISMATCH",
      "平台连接配置已变化，已阻止旧任务继续请求",
    );
  }
  return current;
}

function fetchWithProviderLease(
  lease: ProviderGenerationRequestLease,
  fetcher: typeof fetch,
): typeof fetch {
  return (input, init) => {
    try {
      return fetcher(input, init);
    } finally {
      // Native fetch has accepted the request and returned its Promise. The
      // profile writer may proceed while the remote response is in flight.
      lease.release();
    }
  };
}

async function withProviderRequestLease<T>(input: {
  expected?: ProviderProfile;
  fetcher: typeof fetch;
  profileId: string;
  request: (profile: ProviderProfile, fetcher: typeof fetch) => Promise<T>;
}) {
  const lease = await acquireProviderGenerationRequestLease(input.profileId);
  try {
    const profile = input.expected
      ? requireSameProviderConfiguration(input.expected, lease.profile)
      : lease.profile;
    return await input.request(
      profile,
      fetchWithProviderLease(lease, input.fetcher),
    );
  } finally {
    // Local validation, a rejected Provider-attempt boundary, or a synchronous
    // fetch error can all exit before the wrapper above releases the lease.
    lease.release();
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function canvasRevisionConflict(response: ServerResponse, error: unknown) {
  if (
    !(error instanceof CanvasRevisionConflictError) &&
    !(error instanceof GenerationTaskCanvasRevisionConflictError)
  ) return false;
  json(response, 409, {
    code: "CANVAS_NOT_SAVED",
    error: error.message,
    revision: error.revision,
  });
  return true;
}

async function readBody<T>(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1_024) throw new Error("请求内容过大");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function taskSummary(task: GenerationTask) {
  const resultMedia = task.kind !== "text" && task.resultAssetId && task.ownerId
    ? readableMediaForOwner(task.ownerId, task.kind, task.resultAssetId)
    : undefined;
  const retryDecision = retrySafetyDecision(task);
  const resumeSnapshotProblem =
    retryDecision.allowed && retryDecision.mode === "resume-provider-task"
      ? resumeProviderTaskSnapshotProblem(task)
      : undefined;
  const retry = resumeSnapshotProblem
    ? {
        allowed: false as const,
        code: "RETRY_SNAPSHOT_CHANGED",
        reason: resumeSnapshotProblem,
      }
    : retryDecision;
  return {
    actualCostMicrounits: task.actualCostMicrounits,
    attempt: task.attempt,
    canvasId: task.canvasId,
    createdAt: task.createdAt,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    estimatedCostMicrounits: task.estimatedCostMicrounits,
    costCurrency: task.costCurrency,
    id: task.id,
    kind: task.kind,
    model: task.model,
    nodeId: task.nodeId,
    prompt: task.prompt,
    retryAllowed: retry.allowed,
    retryBlockCode: retry.allowed ? undefined : retry.code,
    retryBlockReason: retry.allowed ? undefined : retry.reason,
    resultAssetId: task.resultAssetId,
    resultText: task.resultText,
    resultMedia: resultMedia
      ? {
          byteSize: resultMedia.byteSize,
          contentType: resultMedia.contentType,
          durationSeconds: resultMedia.durationSeconds,
          durationStatus: resultMedia.durationStatus,
          storageBackend: resultMedia.storageBackend,
        }
      : undefined,
    resultUrl: task.resultAssetId
      ? task.kind === "video"
        ? `/api/video-assets/${task.resultAssetId}`
        : task.kind === "audio"
          ? `/api/audio-assets/${task.resultAssetId}`
          : `/api/assets/${task.resultAssetId}`
      : undefined,
    state: task.state,
    updatedAt: task.updatedAt,
  };
}

type GenerationModelRow = {
  cost_currency: "CNY" | "USD";
  default_parameters: string;
  id: string;
  latest_capability_success_at: string | null;
  latest_auth_failure_at: string | null;
  latest_provider_attempt_at: string | null;
  max_cost_microunits: number;
  model_configuration_updated_at: string;
  provider_driver: string;
  provider_configuration_updated_at: string | null;
  provider_model_id: string;
  provider_protocol?: ProviderProtocol;
  provider_profile_id: string;
  provider_status: "disabled" | "enabled";
};

type ImageReference = {
  assetId: string;
  kind: "image";
  sourceNodeId: string;
};

type NodeInputGenerationRequest = Omit<Partial<GenerationTaskInput>, "kind"> & {
  canvasRevision?: number;
  inputSchemaVersion?: number;
  inputs?: NodeInputSnapshot[];
  kind?: NodeInputKind;
  ownPrompt?: string;
};

function generationModelSchema(
  kind: NodeInputKind,
  model: GenerationModelRow,
): ModelParameterSchema {
  const fallback = knownModelParameterSchema({
    capability: kind,
    providerDriver: model.provider_driver,
    providerModelId: model.provider_model_id,
  });
  const constraints = providerParameterSchema({
    capability: kind,
    providerDriver: model.provider_driver,
    providerModelId: model.provider_model_id,
  });
  try {
    const stored = JSON.parse(model.default_parameters) as unknown;
    if (
      stored &&
      typeof stored === "object" &&
      !Array.isArray(stored) &&
      Object.keys(stored).length === 0
    ) {
      // Historical, already accepted model rows used `{}` before schemas were
      // versioned. Keep only that exact legacy shape on the known fallback.
      return fallback;
    }
    return validateParameterSchemaConstraints(
      cleanParameterSchema(
        kind,
        stored,
        fallback,
      ),
      constraints,
    );
  } catch {
    if (constraints) return fallback;
    throw new Error("模型输入规则无效");
  }
}

function imageReferences(value: unknown): ImageReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error("Invalid image references");
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid image reference");
    }
    const candidate = item as Record<string, unknown>;
    const assetId = typeof candidate.assetId === "string"
      ? candidate.assetId.trim()
      : "";
    const sourceNodeId = typeof candidate.sourceNodeId === "string"
      ? candidate.sourceNodeId.trim()
      : "";
    if (
      candidate.kind !== "image" ||
      !/^[a-z0-9._-]{1,160}$/i.test(assetId) ||
      !/^[a-z0-9._-]{1,160}$/i.test(sourceNodeId) ||
      seen.has(sourceNodeId)
    ) {
      throw new Error("Invalid image reference");
    }
    seen.add(sourceNodeId);
    return { assetId, kind: "image", sourceNodeId };
  });
}

function resolveModel(kind: NodeInputKind, modelId?: string) {
  const database = openAppDatabase();
  try {
    return database.prepare(`
      SELECT
        model_profiles.id,
        model_profiles.provider_profile_id,
        model_profiles.provider_model_id,
        model_profiles.provider_protocol,
        model_profiles.default_parameters,
        model_profiles.max_cost_microunits,
        model_profiles.cost_currency,
        provider_profiles.driver AS provider_driver,
        provider_profiles.status AS provider_status,
        model_profiles.updated_at AS model_configuration_updated_at,
        (
          SELECT MAX(config_event.created_at)
          FROM admin_audit_events AS config_event
          WHERE
            config_event.action IN (
              'provider_profile.create',
              'provider_profile.update'
            )
            AND json_extract(config_event.details, '$.profileId') =
              model_profiles.provider_profile_id
        ) AS provider_configuration_updated_at,
        (
          SELECT MAX(auth_task.updated_at)
          FROM generation_tasks AS auth_task
          WHERE
            auth_task.provider_profile_id = model_profiles.provider_profile_id
            AND auth_task.kind = model_profiles.capability
            AND auth_task.state = 'failed'
            AND auth_task.error_code IN ('AUTH', 'PERMISSION')
        ) AS latest_auth_failure_at,
        (
          SELECT MAX(success_task.updated_at)
          FROM generation_tasks AS success_task
          WHERE
            success_task.provider_profile_id = model_profiles.provider_profile_id
            AND success_task.kind = model_profiles.capability
            AND success_task.state = 'success'
        ) AS latest_capability_success_at,
        (
          SELECT MAX(provider_attempt.created_at)
          FROM generation_provider_attempts AS provider_attempt
          WHERE
            provider_attempt.provider_profile_id = model_profiles.provider_profile_id
            AND provider_attempt.kind = model_profiles.capability
        ) AS latest_provider_attempt_at
      FROM model_profiles
      JOIN provider_profiles
        ON provider_profiles.id = model_profiles.provider_profile_id
      JOIN node_model_bindings
        ON node_model_bindings.model_id = model_profiles.id
        AND node_model_bindings.node_type = model_profiles.capability
        AND node_model_bindings.node_type = ?
      WHERE
        model_profiles.capability = ?
        AND model_profiles.status = 'published'
        AND node_model_bindings.enabled = 1
        AND (? IS NULL OR model_profiles.id = ?)
      ORDER BY
        CASE WHEN model_profiles.id = ? THEN 0 ELSE 1 END,
        node_model_bindings.is_default DESC,
        node_model_bindings.sort_order,
        model_profiles.created_at
      LIMIT 1
    `).get(kind, kind, modelId ?? null, modelId ?? null, modelId ?? null) as
      | GenerationModelRow
      | undefined;
  } finally {
    database.close();
  }
}

function persistedSubmissionInputs(input: {
  body: NodeInputGenerationRequest;
  bypass: boolean;
  modelSchema: ModelParameterSchema;
  ownerId: string;
  parameters: Record<string, ModelParameterValue>;
  targetKind: NodeInputKind;
}) {
  const resolved = resolvePersistedNodeInputs({
    bypass: input.bypass,
    canvasId: String(input.body.canvasId ?? ""),
    expectedRevision: input.body.canvasRevision,
    modelSchema: input.modelSchema,
    ownerId: input.ownerId,
    parameters: input.parameters,
    targetId: String(input.body.nodeId ?? ""),
    targetKind: input.targetKind,
  });
  const { persistedOwnPrompt, ...persisted } = resolved;
  if (input.body.inputSchemaVersion === 1) {
    if (typeof input.body.ownPrompt !== "string") {
      throw new Error("节点输入版本1缺少本节点Prompt");
    }
    if (input.body.ownPrompt.trim() !== persistedOwnPrompt) {
      throw new CanvasRevisionConflictError(
        persisted.canvasRevision,
        "本节点Prompt与已保存画布不一致，请等待保存完成后重试",
      );
    }
  }
  return persisted;
}

const mediaLimits = {
  audio: 50 * 1024 * 1024,
  image: 20 * 1024 * 1024,
  video: 500 * 1024 * 1024,
} as const;

const mediaContentTypes = {
  audio: new Set(["audio/aac", "audio/mp4", "audio/mpeg", "audio/wav"]),
  image: new Set(["image/png"]),
  video: new Set(["video/mp4"]),
} as const;

type StrictGenerationPreflight = NodeInputPreflight & {
  canvasRevision: number;
  parameters: Record<string, ModelParameterValue>;
  references: ImageReference[];
};

function appendProblem(
  preflight: NodeInputPreflight & { canvasRevision: number },
  problem: NodeInputProblem,
) {
  preflight.problems.push(problem);
  preflight.canSubmit = false;
}

async function generationRuntimeDecision(input: {
  canSubmit: boolean;
  kind: NodeInputKind;
  model: GenerationModelRow;
  ownerId: string;
}) {
  const adapterSupported = modelGenerationAdapterSupported({
    capability: input.kind,
    costCurrency: input.model.cost_currency,
    providerDriver: input.model.provider_driver,
    providerModelId: input.model.provider_model_id,
    providerProtocol: input.model.provider_protocol,
  });
  const providerState = await getProviderGenerationProfileState(
    input.model.provider_profile_id,
  ).catch(() => ({
    configurationAligned: false as const,
    profile: undefined,
    reason: "configuration-mismatch" as const,
  }));
  const storedProfile = providerState.profile;
  const configured = Boolean(
    storedProfile && storedProfile.driver === input.model.provider_driver,
  );
  const safetyStatus = generationSafetyStatus();
  const availability = evaluateModelRuntimeAvailability({
    capability: input.kind,
    costCurrency: input.model.cost_currency,
    emergencyStop: safetyStatus.emergencyStop,
    globalEnabled: safetyStatus.globalEnabled,
    latestCapabilitySuccessAt:
      input.model.latest_capability_success_at ?? undefined,
    latestProviderAttemptAt:
      input.model.latest_provider_attempt_at ?? undefined,
    maxCostMicrounits: input.model.max_cost_microunits,
    latestAuthFailureAt: input.model.latest_auth_failure_at ?? undefined,
    modelConfigurationUpdatedAt: input.model.model_configuration_updated_at,
    providerDriver: input.model.provider_driver,
    providerModelId: input.model.provider_model_id,
    providerProtocol: input.model.provider_protocol,
    providerConfigurationUpdatedAt:
      input.model.provider_configuration_updated_at ?? undefined,
    providerConfigurationVersionAligned:
      providerState.configurationAligned,
    providerStatus:
      providerState.reason === "ready" ? "enabled" : "disabled",
    storedProviderDriver: storedProfile?.driver,
  });
  const safety = createGenerationSafetyStore();
  const safetyAdmission = (() => {
    try {
      return safety.admission({
        estimatedCostMicrounits: input.model.max_cost_microunits,
        costCurrency: input.model.cost_currency,
        kind: input.kind,
        ownerId: input.ownerId,
        providerProfileId: input.model.provider_profile_id,
      });
    } finally {
      safety.close();
    }
  })();
  const enqueueProblem = !availability.generationAvailable
    ? {
        code: availability.generationUnavailableReasonCode ?? "MODEL_UNAVAILABLE",
        message: availability.generationUnavailableReason || "当前模型暂不可生成",
      }
    : !safetyAdmission.allowed
      ? { code: safetyAdmission.code, message: safetyAdmission.message }
      : undefined;
  return {
    canEnqueue:
      input.canSubmit &&
      availability.generationAvailable &&
      safetyAdmission.allowed,
    costCurrency: input.model.cost_currency,
    enqueueProblem,
    estimatedCostMicrounits: input.model.max_cost_microunits,
    ...availability,
    provider: {
      adapterSupported,
      configured,
    },
    providerBalance: {
      checked: false,
      reason: "零Provider预检不读取Provider账户余额",
      status: "not-checked" as const,
    },
    providerProfile: providerState.reason === "ready" ? storedProfile : undefined,
    safetyAdmission,
  };
}

function generationRuntimeProblems(problem: { code: string; message: string }) {
  const modelProblem = problem.code.startsWith("PROVIDER_") ||
    problem.code === "ADAPTER_UNSUPPORTED" ||
    problem.code === "COST_LIMIT_NOT_CONFIGURED" ||
    problem.code === "MODEL_UNAVAILABLE";
  return [{
    code: modelProblem ? "MODEL_UNSUPPORTED" as const : "INVALID" as const,
    message: problem.message,
  }];
}

function missingModelMessage(kind: NodeInputKind) {
  return kind === "text"
    ? "管理员尚未发布可用的文字模型"
    : kind === "image"
      ? "管理员尚未发布可用的图片模型"
      : kind === "video"
        ? "管理员尚未发布可用的视频模型"
        : "管理员尚未发布可用的音频模型";
}

function strictGenerationPreflight(input: {
  body: NodeInputGenerationRequest;
  bypass: boolean;
  model: GenerationModelRow;
  ownerId: string;
  requireFreshRevision: boolean;
  targetKind: NodeInputKind;
}): StrictGenerationPreflight {
  const schema = generationModelSchema(input.targetKind, input.model);
  const submittedParameters = { ...(input.body.parameters ?? {}) };
  delete submittedParameters.references;
  const parameters = validateParameterValues(schema, submittedParameters);
  const persisted = persistedSubmissionInputs({
    body: input.body,
    bypass: input.bypass,
    modelSchema: schema,
    ownerId: input.ownerId,
    parameters,
    targetKind: input.targetKind,
  });
  if (
    input.requireFreshRevision &&
    input.body.canvasRevision === undefined &&
    (input.body.inputSchemaVersion === 1 || persisted.snapshot.length > 0)
  ) {
    throw new CanvasRevisionConflictError(persisted.canvasRevision);
  }
  if (input.targetKind === "video" && persisted.finalPrompt.length > 10_000) {
    appendProblem(persisted, {
      code: "INVALID",
      message: "最终Prompt超过当前视频模型可接收的长度",
    });
  }

  const paidArkVideo = input.targetKind === "video" &&
    input.model.provider_driver === "volcengine-ark" &&
    input.model.max_cost_microunits > 0 &&
    modelGenerationAdapterSupported({
      capability: "video",
      costCurrency: input.model.cost_currency,
      providerDriver: input.model.provider_driver,
      providerModelId: input.model.provider_model_id,
      providerProtocol: input.model.provider_protocol,
    });
  const paidArkText = input.targetKind === "text" &&
    input.model.provider_driver === "volcengine-ark" &&
    input.model.max_cost_microunits > 0 &&
    modelGenerationAdapterSupported({
      capability: "text",
      costCurrency: input.model.cost_currency,
      providerDriver: input.model.provider_driver,
      providerModelId: input.model.provider_model_id,
      providerProtocol: input.model.provider_protocol,
    });
  const paidMurekaAudio = input.targetKind === "audio" &&
    input.model.provider_driver === "mureka" &&
    input.model.max_cost_microunits > 0 &&
    modelGenerationAdapterSupported({
      capability: "audio",
      costCurrency: input.model.cost_currency,
      providerDriver: input.model.provider_driver,
      providerModelId: input.model.provider_model_id,
      providerProtocol: input.model.provider_protocol,
    });
  const relayProtocol = input.model.provider_protocol ?? "native";
  const relayTextInputKinds = relayProtocol === "gemini-generate-content"
    ? new Set<NodeInputKind>(["text", "image", "video", "audio"])
    : relayProtocol === "openai-responses"
      ? new Set<NodeInputKind>(["text", "image", "audio"])
      : relayProtocol === "openai-chat" || relayProtocol === "claude-messages"
        ? new Set<NodeInputKind>(["text", "image"])
        : undefined;
  if (
    relayProtocol !== "native" &&
    input.targetKind !== "text" &&
    parameters.outputCount !== undefined &&
    parameters.outputCount !== 1
  ) {
    appendProblem(persisted, {
      code: "MODEL_UNSUPPORTED",
      message: "当前中转模型每次只支持生成1份结果",
    });
  }
  if (paidArkText && parameters.outputCount !== 1) {
    appendProblem(persisted, {
      code: "MODEL_UNSUPPORTED",
      message: "当前文字任务每次只支持生成1份结果",
    });
  }
  if (
    input.targetKind === "text" &&
    relayTextInputKinds &&
    parameters.outputCount !== 1
  ) {
    appendProblem(persisted, {
      code: "MODEL_UNSUPPORTED",
      message: "当前中转文字任务每次只支持生成1份结果",
    });
  }
  if (paidArkText && parameters.responseFormat !== "text") {
    appendProblem(persisted, {
      code: "MODEL_UNSUPPORTED",
      message: "当前文字任务暂只支持文本结果格式",
    });
  }
  if (paidMurekaAudio && parameters.outputCount !== 1) {
    appendProblem(persisted, {
      code: "MODEL_UNSUPPORTED",
      message: "当前音频任务每次只支持生成1条结果",
    });
  }
  let paidAudioDuration = 0;
  let paidVideoDuration = 0;
  let paidAudioReferences = 0;
  let paidFirstAudioEdgeId: string | undefined;
  let paidVisualReferences = 0;
  let paidBase64Bytes = paidArkVideo
    ? arkVideoBase64EnvelopeBytes(persisted.finalPrompt)
    : 0;
  let paidTextBase64Bytes = paidArkText
    ? 32 * 1_024 + Buffer.byteLength(persisted.finalPrompt, "utf8")
    : 0;
  for (const resolved of persisted.inputs) {
    if (resolved.state !== "ready") continue;
    if (
      input.targetKind === "text" &&
      relayTextInputKinds &&
      !relayTextInputKinds.has(resolved.kind)
    ) {
      appendProblem(persisted, {
        code: "MODEL_UNSUPPORTED",
        edgeId: resolved.edgeId,
        message: `${resolved.title}不受当前文字模型的调用协议支持，引用已保留`,
      });
      continue;
    }
    if (resolved.kind === "text") continue;
    const media = resolved.assetId
      ? readableMediaForOwner(input.ownerId, resolved.kind, resolved.assetId)
      : undefined;
    if (!media || media.storageStatus !== "ready") {
      appendProblem(persisted, {
        code: "INVALID",
        edgeId: resolved.edgeId,
        message: `${resolved.title}不存在、尚未保存或不属于当前账号`,
      });
      continue;
    }
    if (
      media.byteSize < 1 ||
      media.byteSize > mediaLimits[resolved.kind] ||
      !mediaContentTypes[resolved.kind].has(media.contentType)
    ) {
      appendProblem(persisted, {
        code: "INVALID",
        edgeId: resolved.edgeId,
        message: `${resolved.title}的素材类型或大小不可用`,
      });
      continue;
    }
    if (input.targetKind === "text" && relayTextInputKinds) {
      if (
        relayProtocol === "openai-responses" &&
        resolved.kind === "audio" &&
        (
          media.storageBackend !== "local" ||
          (media.contentType !== "audio/mpeg" && media.contentType !== "audio/wav")
        )
      ) {
        appendProblem(persisted, {
          code: "MODEL_UNSUPPORTED",
          edgeId: resolved.edgeId,
          message: `${resolved.title}需要本地MP3或WAV格式才能使用当前Responses协议，引用已保留`,
        });
        continue;
      }
      if (
        resolved.kind === "audio" &&
        media.storageBackend === "local" &&
        media.contentType !== "audio/mpeg" &&
        media.contentType !== "audio/wav"
      ) {
        appendProblem(persisted, {
          code: "MODEL_UNSUPPORTED",
          edgeId: resolved.edgeId,
          message: `${resolved.title}的本地音频格式不受当前中转协议支持，引用已保留`,
        });
        continue;
      }
      if (
        relayProtocol === "gemini-generate-content" &&
        resolved.kind === "video" &&
        media.storageBackend !== "oss"
      ) {
        appendProblem(persisted, {
          code: "MODEL_UNSUPPORTED",
          edgeId: resolved.edgeId,
          message: `${resolved.title}还未存入可供Gemini安全读取的私有云端存储，引用已保留`,
        });
        continue;
      }
    }
    if (paidArkText) {
      const supported = resolved.kind === "image"
        ? media.contentType === "image/png"
        : resolved.kind === "video"
          ? media.contentType === "video/mp4"
          : media.contentType === "audio/mpeg" || media.contentType === "audio/wav";
      const maximumBytes = resolved.kind === "image"
        ? 10 * 1024 * 1024
        : resolved.kind === "video"
          ? 50 * 1024 * 1024
          : 15 * 1024 * 1024;
      if (!supported || media.byteSize > maximumBytes) {
        appendProblem(persisted, {
          code: "INVALID",
          edgeId: resolved.edgeId,
          message: `${resolved.title}的格式或大小不受当前文字模型支持`,
        });
        continue;
      }
      if (resolved.kind === "video" && media.storageBackend !== "oss") {
        appendProblem(persisted, {
          code: "INVALID",
          edgeId: resolved.edgeId,
          message: `${resolved.title}还未存入可供文字模型安全读取的私有云端存储`,
        });
        continue;
      }
      if (media.storageBackend === "local") {
        paidTextBase64Bytes += Math.ceil(media.byteSize / 3) * 4 + 64;
        if (paidTextBase64Bytes > 64 * 1_024 * 1_024) {
          appendProblem(persisted, {
            code: "INVALID",
            edgeId: resolved.edgeId,
            message: `${resolved.title}使文字模型的Base64提交内容超过64MB`,
          });
          continue;
        }
      }
    }
    if (paidArkVideo) {
      const officialProblem = arkVideoMediaProblem(resolved.kind, media);
      if (officialProblem) {
        appendProblem(persisted, {
          code: "INVALID",
          edgeId: resolved.edgeId,
          message: `${resolved.title}：${officialProblem}`,
        });
        continue;
      }
      if (resolved.kind === "image") paidVisualReferences += 1;
      if (resolved.kind === "video") {
        paidVisualReferences += 1;
        const nextDuration = paidVideoDuration + media.durationSeconds!;
        if (nextDuration > 15) {
          appendProblem(persisted, {
            code: "INVALID",
            edgeId: resolved.edgeId,
            message: `${resolved.title}使参考视频总时长超过15秒`,
          });
          continue;
        }
        paidVideoDuration = nextDuration;
      }
      if (resolved.kind === "audio") {
        paidAudioReferences += 1;
        paidFirstAudioEdgeId ??= resolved.edgeId;
        const nextDuration = paidAudioDuration + media.durationSeconds!;
        if (nextDuration > 15) {
          appendProblem(persisted, {
            code: "INVALID",
            edgeId: resolved.edgeId,
            message: `${resolved.title}使参考音频总时长超过15秒`,
          });
          continue;
        }
        paidAudioDuration = nextDuration;
      }
      const nextBase64Bytes = paidBase64Bytes +
        arkVideoBase64Bytes(resolved.kind, media);
      if (nextBase64Bytes > arkVideoBase64BudgetBytes) {
        appendProblem(persisted, {
          code: "INVALID",
          edgeId: resolved.edgeId,
          message: `${resolved.title}使Base64提交内容超过64MB`,
        });
        continue;
      }
      paidBase64Bytes = nextBase64Bytes;
    }
    if (
      paidArkVideo &&
      resolved.kind === "video" &&
      media.storageBackend !== "oss"
    ) {
      appendProblem(persisted, {
        code: "INVALID",
        edgeId: resolved.edgeId,
        message: `${resolved.title}还未存入可供视频模型安全读取的私有云端存储`,
      });
    }
  }
  if (paidArkVideo && paidAudioReferences > 0 && paidVisualReferences === 0) {
    appendProblem(persisted, {
      code: "INVALID",
      edgeId: paidFirstAudioEdgeId,
      message: "参考音频不能单独用于当前视频模型，请至少再连接一个图片或视频",
    });
  }
  const references = input.targetKind === "image"
    ? persisted.snapshot
        .filter((item) => item.kind === "image")
        .map((item) => ({
          assetId: item.assetId ?? "",
          kind: "image" as const,
          sourceNodeId: item.sourceNodeId,
        }))
    : [];
  return { ...persisted, parameters, references };
}

async function generationAvailability() {
  const database = openAppDatabase();
  try {
    const rows = database.prepare(`
      SELECT
        model_profiles.id,
        model_profiles.provider_profile_id,
        model_profiles.provider_model_id,
        model_profiles.provider_protocol,
        model_profiles.default_parameters,
        model_profiles.max_cost_microunits,
        model_profiles.cost_currency,
        model_profiles.capability,
        provider_profiles.driver AS provider_driver,
        provider_profiles.status AS provider_status,
        model_profiles.updated_at AS model_configuration_updated_at,
        (
          SELECT MAX(config_event.created_at)
          FROM admin_audit_events AS config_event
          WHERE
            config_event.action IN (
              'provider_profile.create',
              'provider_profile.update'
            )
            AND json_extract(config_event.details, '$.profileId') =
              model_profiles.provider_profile_id
        ) AS provider_configuration_updated_at,
        (
          SELECT MAX(auth_task.updated_at)
          FROM generation_tasks AS auth_task
          WHERE
            auth_task.provider_profile_id = model_profiles.provider_profile_id
            AND auth_task.kind = model_profiles.capability
            AND auth_task.state = 'failed'
            AND auth_task.error_code IN ('AUTH', 'PERMISSION')
        ) AS latest_auth_failure_at,
        (
          SELECT MAX(success_task.updated_at)
          FROM generation_tasks AS success_task
          WHERE
            success_task.provider_profile_id = model_profiles.provider_profile_id
            AND success_task.kind = model_profiles.capability
            AND success_task.state = 'success'
        ) AS latest_capability_success_at,
        (
          SELECT MAX(provider_attempt.created_at)
          FROM generation_provider_attempts AS provider_attempt
          WHERE
            provider_attempt.provider_profile_id = model_profiles.provider_profile_id
            AND provider_attempt.kind = model_profiles.capability
        ) AS latest_provider_attempt_at
      FROM model_profiles
      JOIN provider_profiles
        ON provider_profiles.id = model_profiles.provider_profile_id
      JOIN node_model_bindings
        ON node_model_bindings.model_id = model_profiles.id
        AND node_model_bindings.node_type = model_profiles.capability
      WHERE
        model_profiles.status = 'published'
        AND model_profiles.capability IN ('text', 'audio', 'image', 'video')
        AND node_model_bindings.enabled = 1
    `).all() as Array<GenerationModelRow & { capability: NodeInputKind }>;
    const configuredKinds = new Set<NodeInputKind>();
    const configuredCurrencies: Record<NodeInputKind, Set<"CNY" | "USD">> = {
      audio: new Set(),
      image: new Set(),
      text: new Set(),
      video: new Set(),
    };
    await Promise.all(rows.map(async (row) => {
      const providerState = await getProviderGenerationProfileState(
        row.provider_profile_id,
      ).catch(() => ({
        configurationAligned: false as const,
        profile: undefined,
        reason: "configuration-mismatch" as const,
      }));
      const profile = providerState.profile;
      const availability = evaluateModelRuntimeAvailability({
        capability: row.capability,
        costCurrency: row.cost_currency,
        emergencyStop: false,
        globalEnabled: true,
        latestCapabilitySuccessAt:
          row.latest_capability_success_at ?? undefined,
        latestProviderAttemptAt:
          row.latest_provider_attempt_at ?? undefined,
        maxCostMicrounits: row.max_cost_microunits,
        latestAuthFailureAt: row.latest_auth_failure_at ?? undefined,
        modelConfigurationUpdatedAt: row.model_configuration_updated_at,
        providerDriver: row.provider_driver,
        providerModelId: row.provider_model_id,
        providerProtocol: row.provider_protocol,
        providerConfigurationUpdatedAt:
          row.provider_configuration_updated_at ?? undefined,
        providerConfigurationVersionAligned:
          providerState.configurationAligned,
        providerStatus:
          providerState.reason === "ready" ? "enabled" : "disabled",
        storedProviderDriver: profile?.driver,
      });
      if (availability.generationAvailable) {
        configuredKinds.add(row.capability);
        configuredCurrencies[row.capability].add(row.cost_currency);
      }
    }));
    return {
      ...generationProviderAttemptCounts(database),
      audioProviderConfigured: configuredKinds.has("audio"),
      imageProviderConfigured: configuredKinds.has("image"),
      providerConfigured: configuredKinds.size > 0,
      providerCurrencies: {
        audio: [...configuredCurrencies.audio],
        image: [...configuredCurrencies.image],
        text: [...configuredCurrencies.text],
        video: [...configuredCurrencies.video],
      },
      textProviderConfigured: configuredKinds.has("text"),
      videoProviderConfigured: configuredKinds.has("video"),
    };
  } finally {
    database.close();
  }
}

function safeFailure(error: unknown, kind: "text" | "audio" | "image" | "video") {
  if (error instanceof ProviderGenerationConfigurationError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof GenerationProviderAttemptBlockedError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ProviderMediaError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof OpenRouterImageError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof VolcengineArkVideoError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof MurekaAudioError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof VolcengineArkTextError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof RelayProviderError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ProviderResultMediaError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "GENERATION_FAILED",
    message: kind === "text"
      ? "文字生成失败，请稍后再试"
      : kind === "video"
      ? "视频生成失败，请稍后再试"
      : kind === "audio"
        ? "音频生成失败，请稍后再试"
        : "图片生成失败，请稍后再试",
  };
}

type TextTaskStore = Pick<
  ReturnType<typeof createGenerationTaskStore>,
  "complete" | "get" | "recordProviderAttempt" | "transition"
>;

type PersistedTextTaskInput = NodeInputSnapshot & { text?: string };

function textTaskInputSnapshots(value: unknown): PersistedTextTaskInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new VolcengineArkTextError("FORMAT", "文字任务保存的上下文快照无效");
  }
  const seenOrders = new Set<number>();
  return value.map((raw): PersistedTextTaskInput => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new VolcengineArkTextError("FORMAT", "文字任务保存的上下文快照无效");
    }
    const item = raw as Partial<PersistedTextTaskInput>;
    if (
      (item.kind !== "text" && item.kind !== "image" &&
        item.kind !== "video" && item.kind !== "audio") ||
      !Number.isSafeInteger(item.order) ||
      Number(item.order) < 1 ||
      seenOrders.has(Number(item.order)) ||
      typeof item.sourceNodeId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(item.sourceNodeId) ||
      item.role !== `context-${item.kind}`
    ) {
      throw new VolcengineArkTextError("FORMAT", "文字任务保存的上下文顺序或角色无效");
    }
    seenOrders.add(Number(item.order));
    if (item.kind === "text") {
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (!text || text.length > 100_000 || item.assetId !== undefined) {
        throw new VolcengineArkTextError("FORMAT", "文字任务保存的文字上下文无效");
      }
      return {
        kind: "text",
        order: Number(item.order),
        role: "context-text",
        sourceNodeId: item.sourceNodeId,
        text,
      };
    }
    if (
      typeof item.assetId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(item.assetId) ||
      item.text !== undefined
    ) {
      throw new VolcengineArkTextError("FORMAT", "文字任务保存的媒体上下文无效");
    }
    return {
      assetId: item.assetId,
      kind: item.kind,
      order: Number(item.order),
      role: `context-${item.kind}`,
      sourceNodeId: item.sourceNodeId,
    };
  }).sort((left, right) => left.order - right.order);
}

function relayContextMimeType(input: {
  assetId: string;
  contentType?: string;
  kind: "audio" | "image" | "video";
  ownerId: string;
}) {
  const stored = input.contentType ?? readableMediaForOwner(
    input.ownerId,
    input.kind,
    input.assetId,
  )?.contentType;
  const contentType = stored === "audio/mp3" ? "audio/mpeg" : stored;
  const accepted = input.kind === "image"
    ? new Set(["image/gif", "image/jpeg", "image/png", "image/webp"])
    : input.kind === "video"
      ? new Set(["video/mp4", "video/quicktime", "video/webm"])
      : new Set(["audio/mpeg", "audio/wav"]);
  if (!contentType || !accepted.has(contentType)) {
    throw new RelayProviderError("FORMAT");
  }
  return contentType;
}

export async function executeTextTaskWithDependencies(
  taskId: string,
  dependencies: {
    acquireProfile: typeof acquireProviderGenerationRequestLease;
    fetcher: typeof fetch;
    mediaContentTypeForOwner?: (input: {
      assetId: string;
      kind: "audio" | "image" | "video";
      ownerId: string;
    }) => string | undefined;
    mediaUrlForOwner: typeof providerMediaUrlForOwner;
    signal?: AbortSignal;
    store: TextTaskStore;
    usePinnedRelayTransport?: boolean;
  },
) {
  const current = dependencies.store.get(taskId);
  if (!current || current.kind !== "text" || current.state !== "queued" || !current.ownerId) {
    return;
  }
  const running = dependencies.store.transition(taskId, "running");
  if (!running?.providerProfileId || !running.providerModelId) {
    dependencies.store.transition(taskId, "failed", {
      code: "MODEL_UNAVAILABLE",
      message: "文字模型配置已失效",
    });
    return;
  }
  try {
    const protocol = taskProviderProtocol(running);
    if (protocol !== "native" && !relayTextProtocol(protocol)) {
      throw new RelayProviderError("FORMAT");
    }
    const snapshots = textTaskInputSnapshots(running.parameters.inputs);
    const inputs: ArkTextInput[] = [];
    const relayInputs: RelayTextContextInput[] = [];
    for (const snapshot of snapshots) {
      if (snapshot.kind === "text") {
        inputs.push({
          kind: "text",
          order: snapshot.order,
          role: "context-text",
          text: snapshot.text,
        });
        relayInputs.push({ kind: "text", text: snapshot.text! });
        continue;
      }
      const mediaInput = {
        assetId: snapshot.assetId!,
        kind: snapshot.kind,
        ownerId: running.ownerId!,
      };
      const url = await dependencies.mediaUrlForOwner(mediaInput);
      inputs.push({
        kind: snapshot.kind,
        order: snapshot.order,
        role: `context-${snapshot.kind}`,
        url,
      });
      if (protocol !== "native") {
        relayInputs.push({
          kind: snapshot.kind,
          mimeType: relayContextMimeType({
            ...mediaInput,
            contentType: dependencies.mediaContentTypeForOwner?.(mediaInput),
          }),
          transientUrl: url.startsWith("data:audio/mp3;base64,")
            ? url.replace("data:audio/mp3;base64,", "data:audio/mpeg;base64,")
            : url,
        });
      }
    }
    const lease = await dependencies.acquireProfile(running.providerProfileId);
    let result: { providerUsageTokens?: number; text: string };
    try {
      requireTaskProviderSnapshot(running, lease.profile);
      const leasedFetch = fetchWithProviderLease(lease, dependencies.fetcher);
      if (protocol === "native") {
        if (lease.profile.driver !== "volcengine-ark") {
          throw new VolcengineArkTextError("FORMAT", "文字模型配置已失效");
        }
        result = await createVolcengineArkTextResponse(
          lease.profile,
          {
            inputs,
            model: running.providerModelId,
            prompt: running.prompt,
            thinkingLevel: ["minimal", "medium"].includes(
              String(running.parameters.thinkingLevel),
            )
              ? running.parameters.thinkingLevel as "minimal" | "medium"
              : "medium",
          },
          leasedFetch,
          dependencies.signal,
          () => dependencies.store.recordProviderAttempt(taskId),
        );
      } else {
        const connection = assertRelayProfile(lease.profile, protocol);
        const relayResult = await requestRelayText(
          connection,
          {
            capability: "text",
            contextInputs: relayInputs,
            maxOutputTokens: typeof running.parameters.maxOutputTokens === "number"
              ? running.parameters.maxOutputTokens
              : undefined,
            messages: [{ role: "user", text: running.prompt }],
            model: running.providerModelId,
            providerProtocol: protocol,
            temperature: typeof running.parameters.temperature === "number"
              ? running.parameters.temperature
              : undefined,
          },
          {
            beforeProviderRequest: () =>
              dependencies.store.recordProviderAttempt(taskId),
            fetcher: leasedFetch,
            signal: dependencies.signal,
            usePinnedTransport: dependencies.usePinnedRelayTransport,
          },
        );
        result = {
          providerUsageTokens: relayResult.usage?.totalTokens,
          text: relayResult.text,
        };
      }
    } finally {
      lease.release();
    }
    if (dependencies.store.get(taskId)?.state !== "running") return;
    dependencies.store.complete(taskId, {
      // Ark does not return a reliable per-response bill. Keep budget
      // accounting conservative by recording the administrator-protected cap.
      actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
      providerUsageTokens: result.providerUsageTokens,
      resultText: result.text,
    });
  } catch (error) {
    if (dependencies.store.get(taskId)?.state === "cancelled") return;
    const failure = safeFailure(error, "text");
    try {
      dependencies.store.transition(taskId, "failed", failure);
    } catch {
      // A concurrent terminal transition wins; no second Provider call is made.
    }
  }
}

async function executeTextTask(taskId: string) {
  const controller = new AbortController();
  runningTextRequests.set(taskId, controller);
  try {
    await executeTextTaskWithDependencies(taskId, {
      acquireProfile: acquireProviderGenerationRequestLease,
      fetcher: fetch,
      mediaUrlForOwner: providerMediaUrlForOwner,
      signal: controller.signal,
      store: taskStore(),
      usePinnedRelayTransport: true,
    });
  } finally {
    if (runningTextRequests.get(taskId) === controller) {
      runningTextRequests.delete(taskId);
    }
  }
}

const relayMediaRoleParameters: Record<
  string,
  Partial<Record<"audio" | "image" | "video", string>>
> = {
  "context-audio": { audio: "context_audio_url" },
  "context-image": { image: "context_image_url" },
  "context-video": { video: "context_video_url" },
  "first-frame": { image: "first_frame_url" },
  "last-frame": { image: "last_frame_url" },
  "reference-audio": { audio: "reference_audio_url" },
  "reference-image": { image: "reference_image_url" },
  "reference-video": { video: "reference_video_url" },
  subject: {
    audio: "subject_audio_url",
    image: "subject_image_url",
    video: "subject_video_url",
  },
};

const relayMediaParameterNames: Record<
  "audio" | "image" | "video",
  Readonly<Record<string, string>>
> = {
  audio: {
    audioMode: "audio_mode",
    duration: "duration",
    emotion: "emotion",
    emotionScale: "emotion_scale",
    format: "format",
    lyrics: "lyrics",
    lyricsMode: "lyrics_mode",
    musicGenerationMode: "generation_mode",
    speaker: "speaker",
    speechRate: "speech_rate",
    vocalGender: "vocal_gender",
  },
  image: {
    aspectRatio: "aspect_ratio",
    cameraMovement: "camera_movement",
    groupMode: "group_mode",
    lens: "lens",
    quality: "quality",
    style: "style",
  },
  video: {
    aspectRatio: "aspect_ratio",
    duration: "duration",
    generateAudio: "generate_audio",
    multiShot: "multi_shot",
    resolution: "resolution",
  },
};

const relayUiOnlyParameterNames = new Set(["inputMode", "outputCount"]);

function appendRelayMediaParam(
  parameters: Record<string, RelayMediaParamValue>,
  name: string,
  value: string,
) {
  const current = parameters[name];
  if (current === undefined) {
    parameters[name] = value;
  } else if (
    typeof current === "boolean" ||
    typeof current === "number" ||
    typeof current === "string"
  ) {
    parameters[name] = [current, value];
  } else {
    parameters[name] = [...current, value];
  }
}

export async function relayMediaParametersForTask(
  task: Pick<GenerationTask, "kind" | "ownerId" | "parameters">,
  mediaUrlForOwner: typeof providerMediaUrlForOwner,
) {
  if (
    !task.ownerId ||
    (task.kind !== "audio" && task.kind !== "image" && task.kind !== "video")
  ) throw new RelayProviderError("FORMAT");
  const parameters: Record<string, RelayMediaParamValue> = {};
  for (const [name, value] of Object.entries(task.parameters)) {
    if (
      name === "inputSchemaVersion" ||
      name === "inputs" ||
      name === "references"
    ) continue;
    if (relayUiOnlyParameterNames.has(name)) continue;
    // Older queued snapshots may predate condition-aware submission filtering.
    // Keep the execution boundary safe as well: the TTS contract forbids an
    // emotion scale while automatic emotion selection is active.
    if (
      task.kind === "audio" &&
      name === "emotionScale" &&
      task.parameters.emotion === "auto"
    ) continue;
    if (
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    ) {
      const providerName = relayMediaParameterNames[task.kind][name];
      if (!providerName) throw new RelayProviderError("FORMAT");
      parameters[providerName] = value;
    }
  }
  const rawInputs = task.parameters.inputs;
  if (rawInputs === undefined) return parameters;
  if (!Array.isArray(rawInputs) || rawInputs.length > 64) {
    throw new RelayProviderError("FORMAT");
  }
  const seenOrders = new Set<number>();
  const inputs = rawInputs.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new RelayProviderError("FORMAT");
    }
    const input = raw as Partial<NodeInputSnapshot>;
    if (
      !Number.isSafeInteger(input.order) ||
      Number(input.order) < 1 ||
      seenOrders.has(Number(input.order)) ||
      typeof input.role !== "string" ||
      typeof input.sourceNodeId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(input.sourceNodeId)
    ) {
      throw new RelayProviderError("FORMAT");
    }
    seenOrders.add(Number(input.order));
    if (input.kind === "text") {
      if (input.assetId !== undefined) throw new RelayProviderError("FORMAT");
      return { kind: "text" as const, order: Number(input.order) };
    }
    if (
      (input.kind !== "audio" && input.kind !== "image" &&
        input.kind !== "video") ||
      typeof input.assetId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(input.assetId)
    ) {
      throw new RelayProviderError("FORMAT");
    }
    const parameterName = relayMediaRoleParameters[input.role]?.[input.kind];
    if (!parameterName) throw new RelayProviderError("FORMAT");
    return {
      assetId: input.assetId,
      kind: input.kind,
      order: Number(input.order),
      parameterName,
    };
  }).sort((left, right) => left.order - right.order);
  for (const input of inputs) {
    if (input.kind === "text") continue;
    appendRelayMediaParam(
      parameters,
      input.parameterName,
      await mediaUrlForOwner({
        assetId: input.assetId,
        kind: input.kind,
        ownerId: task.ownerId,
      }),
    );
  }
  return parameters;
}

export function gptImageSizeForAspectRatio(value: unknown) {
  if (value === undefined || value === "auto") return "auto" as const;
  if (value === "1:1") return "1024x1024" as const;
  if (["16:9", "4:3", "3:2", "5:4", "21:9"].includes(String(value))) {
    return "1536x1024" as const;
  }
  if (["9:16", "3:4", "2:3", "4:5"].includes(String(value))) {
    return "1024x1536" as const;
  }
  throw new RelayProviderError("FORMAT");
}

async function readGeneratedPngBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > mediaLimits.image) {
      await reader.cancel();
      throw new ProviderResultMediaError("FORMAT", "模型返回的图片过大");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function saveRelayMediaOutput(input: {
  expectedAudioContentType?: string;
  output: RelayTransientMediaOutput;
  ownerId: string;
  profile: ProviderProfile;
  prompt: string;
  signal: AbortSignal;
}) {
  if (input.output.transport === "bytes") {
    if (input.output.kind !== "image" || input.output.mimeType !== "image/png") {
      throw new ProviderResultMediaError("FORMAT", "模型结果格式不受支持");
    }
    const saved = await saveGeneratedPng({
      bytes: Buffer.from(input.output.bytes),
      label: input.prompt.slice(0, 120),
      ownerId: input.ownerId,
    });
    return saved.assetId;
  }
  const downloaded = await downloadProviderResultMedia({
    apiKey: input.profile.apiKey,
    expectedContentType:
      input.output.mimeType ?? input.expectedAudioContentType,
    kind: input.output.kind,
    signal: input.signal,
    url: input.output.transientUrl,
  });
  if (input.output.kind === "image") {
    const saved = await saveGeneratedPng({
      bytes: await readGeneratedPngBody(downloaded.body),
      label: input.prompt.slice(0, 120),
      ownerId: input.ownerId,
    });
    return saved.assetId;
  }
  if (input.output.kind === "video") {
    const saved = await saveGeneratedMp4({
      body: downloaded.body,
      label: input.prompt.slice(0, 120),
      ownerId: input.ownerId,
    });
    return saved.assetId;
  }
  const saved = await saveGeneratedAudio({
    body: downloaded.body,
    contentType: downloaded.contentType as
      | "audio/aac"
      | "audio/mp4"
      | "audio/mpeg"
      | "audio/ogg"
      | "audio/wav",
    label: input.prompt.slice(0, 120),
    ownerId: input.ownerId,
  });
  return saved.assetId;
}

function relayAudioResultContentType(format: unknown) {
  if (format === "ogg_opus") return "audio/ogg";
  if (format === "wav") return "audio/wav";
  if (format === "m4a") return "audio/mp4";
  if (format === "aac") return "audio/aac";
  return format === "mp3" ? "audio/mpeg" : undefined;
}

async function completeRelayMediaTask(input: {
  actualCostMicrounits: number;
  kind: "audio" | "image" | "video";
  ownerId: string;
  resultAssetId: string;
  taskId: string;
}) {
  const discard = () => removeUnpublishedGeneratedMedia({
    assetId: input.resultAssetId,
    kind: input.kind,
    ownerId: input.ownerId,
  });
  if (taskStore().get(input.taskId)?.state !== "running") {
    await discard();
    return false;
  }
  try {
    taskStore().complete(input.taskId, {
      actualCostMicrounits: input.actualCostMicrounits,
      resultAssetId: input.resultAssetId,
    });
    return true;
  } catch (error) {
    await discard();
    if (taskStore().get(input.taskId)?.state === "cancelled") return false;
    throw error;
  }
}

function waitForRelayMedia(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new RelayProviderError("CANCELLED", true));
    }, { once: true });
  });
}

async function executeRelayMediaTask(
  taskId: string,
  kind: "audio" | "image" | "video",
  controller: AbortController,
) {
  const current = taskStore().get(taskId);
  if (
    !current ||
    current.kind !== kind ||
    !["queued", "running"].includes(current.state) ||
    !current.ownerId
  ) return;
  const running = current.state === "queued"
    ? taskStore().transition(taskId, "running")
    : current;
  if (!running?.providerProfileId || !running.providerModelId) {
    taskStore().transition(taskId, "failed", {
      code: "MODEL_UNAVAILABLE",
      message: `${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}模型配置已失效`,
    });
    return;
  }
  const ownerId = running.ownerId!;
  const protocol = taskProviderProtocol(running);
  if (protocol !== "media-generate") throw new RelayProviderError("FORMAT");
  const profile = requireTaskProviderSnapshot(
    running,
    await getProviderProfileForGeneration(running.providerProfileId),
  );
  const connection = assertRelayProfile(profile, protocol);
  let providerTaskId = running.providerTaskId;
  if (!providerTaskId) {
    const params = await relayMediaParametersForTask(
      running,
      providerMediaUrlForOwner,
    );
    const submission = await withProviderRequestLease({
      expected: profile,
      fetcher: fetch,
      profileId: running.providerProfileId,
      request: (currentProfile, leasedFetch) =>
        submitRelayMedia(
          assertRelayProfile(currentProfile, protocol),
          {
            capability: kind,
            model: running.providerModelId!,
            params,
            prompt: running.prompt,
            providerProtocol: protocol,
          },
          {
            beforeProviderRequest: () =>
              taskStore().recordProviderAttempt(taskId),
            fetcher: leasedFetch,
            signal: controller.signal,
            usePinnedTransport: true,
          },
        ),
    });
    providerTaskId = submission.externalTaskId;
    taskStore().setProviderTaskId(taskId, providerTaskId);
  }
  for (let poll = 0; poll < 450; poll += 1) {
    if (taskStore().get(taskId)?.state !== "running") return;
    const status = await withProviderRequestLease({
      expected: profile,
      fetcher: fetch,
      profileId: running.providerProfileId,
      request: (currentProfile, leasedFetch) =>
        pollRelayMediaTask(
          assertRelayProfile(currentProfile, protocol),
          {
            capability: kind,
            externalTaskId: providerTaskId!,
            providerProtocol: protocol,
          },
          {
            fetcher: leasedFetch,
            signal: controller.signal,
            usePinnedTransport: true,
          },
        ),
    });
    if (status.state === "failed") {
      taskStore().transition(taskId, "failed", {
        code: "PROVIDER_FAILED",
        message: "中转站未完成本次生成",
      });
      return;
    }
    if (status.state === "success") {
      if (status.outputs.length !== 1) throw new RelayProviderError("FORMAT");
      const resultAssetId = await saveRelayMediaOutput({
        expectedAudioContentType: kind === "audio"
          ? relayAudioResultContentType(running.parameters.format)
          : undefined,
        output: status.outputs[0],
        ownerId,
        profile,
        prompt: running.prompt,
        signal: controller.signal,
      });
      await completeRelayMediaTask({
        actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
        kind,
        ownerId,
        resultAssetId,
        taskId,
      });
      return;
    }
    await waitForRelayMedia(2_000, controller.signal);
  }
  throw new RelayProviderError("TIMEOUT", true);
}

async function executeImageTask(taskId: string) {
  const current = taskStore().get(taskId);
  if (!current || !["queued", "running"].includes(current.state) || !current.ownerId) return;
  const controller = new AbortController();
  runningImageRequests.set(taskId, controller);
  try {
    const currentProtocol = taskProviderProtocol(current);
    if (currentProtocol === "media-generate") {
      await executeRelayMediaTask(taskId, "image", controller);
      return;
    }
    if (current.state !== "queued") return;
    const running = taskStore().transition(taskId, "running");
    if (!running?.providerProfileId || !running.providerModelId) {
      taskStore().transition(taskId, "failed", {
        code: "MODEL_UNAVAILABLE",
        message: "图片模型配置已失效",
      });
      return;
    }
    const protocol = taskProviderProtocol(running);
    const references = imageReferences(running.parameters.references);
    const inputReferences = await Promise.all(
      references.map((reference) =>
        imageReferenceForProvider(current.ownerId!, reference.assetId),
      ),
    );
    if (protocol === "native") {
      const result = await withProviderRequestLease({
        fetcher: fetch,
        profileId: running.providerProfileId,
        request: (profile, leasedFetch) =>
          generateOpenRouterImage(
            requireTaskProviderSnapshot(running, profile),
            {
              aspectRatio:
                typeof running.parameters.aspectRatio === "string"
                  ? running.parameters.aspectRatio
                  : "auto",
              model: running.providerModelId!,
              inputReferences,
              prompt: running.prompt,
              quality:
                ["auto", "low", "medium", "high"].includes(
                  String(running.parameters.quality),
                )
                  ? (running.parameters.quality as "auto" | "low" | "medium" | "high")
                  : "auto",
            },
            leasedFetch,
            controller.signal,
            180_000,
            () => taskStore().recordProviderAttempt(taskId),
          ),
      });
      const saved = await saveGeneratedPng({
        bytes: result.bytes,
        label: running.prompt.slice(0, 120),
        ownerId: current.ownerId,
      });
      taskStore().complete(taskId, {
        actualCostMicrounits: result.actualCostMicrounits,
        resultAssetId: saved.assetId,
      });
      return;
    }
    if (protocol !== "gpt-image") throw new RelayProviderError("FORMAT");
    const profile = requireTaskProviderSnapshot(
      running,
      await getProviderProfileForGeneration(running.providerProfileId),
    );
    assertRelayProfile(profile, protocol);
    const relayResult = await withProviderRequestLease({
      expected: profile,
      fetcher: fetch,
      profileId: running.providerProfileId,
      request: (currentProfile, leasedFetch) =>
        requestRelayGptImage(
          assertRelayProfile(currentProfile, protocol),
          {
            capability: "image",
            count: 1,
            inputImages: inputReferences,
            model: running.providerModelId!,
            operation: inputReferences.length ? "edit" : "generation",
            prompt: running.prompt,
            providerProtocol: protocol,
            quality: ["auto", "low", "medium", "high"].includes(
              String(running.parameters.quality),
            )
              ? running.parameters.quality as "auto" | "low" | "medium" | "high"
              : "auto",
            responseFormat: "b64_json",
            size: gptImageSizeForAspectRatio(running.parameters.aspectRatio),
          },
          {
            beforeProviderRequest: () => taskStore().recordProviderAttempt(taskId),
            fetcher: leasedFetch,
            signal: controller.signal,
            usePinnedTransport: true,
          },
        ),
    });
    if (relayResult.outputs.length !== 1) throw new RelayProviderError("FORMAT");
    const resultAssetId = await saveRelayMediaOutput({
      output: relayResult.outputs[0],
      ownerId: current.ownerId,
      profile,
      prompt: running.prompt,
      signal: controller.signal,
    });
    await completeRelayMediaTask({
      actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
      kind: "image",
      ownerId: current.ownerId,
      resultAssetId,
      taskId,
    });
  } catch (error) {
    if (taskStore().get(taskId)?.state === "cancelled") return;
    const failure = safeFailure(error, "image");
    try {
      taskStore().transition(taskId, "failed", failure);
    } catch {
      // A concurrent terminal transition wins; no second Provider call is made.
    }
  } finally {
    if (runningImageRequests.get(taskId) === controller) {
      runningImageRequests.delete(taskId);
    }
  }
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new VolcengineArkVideoError("CANCELLED", "视频任务已取消"));
    }, { once: true });
  });
}

const arkVideoMediaRoles = new Set<ArkVideoMediaInput["role"]>([
  "first-frame",
  "last-frame",
  "reference-audio",
  "reference-image",
  "reference-video",
  "subject",
]);

function videoTaskMediaSnapshots(value: unknown): Array<
  NodeInputSnapshot & {
    assetId: string;
    kind: ArkVideoMediaInput["kind"];
    role: ArkVideoMediaInput["role"];
  }
> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ProviderMediaError("MEDIA_INVALID", "视频任务保存的参考素材快照无效");
  }
  const seenOrders = new Set<number>();
  const media: Array<
    NodeInputSnapshot & {
      assetId: string;
      kind: ArkVideoMediaInput["kind"];
      role: ArkVideoMediaInput["role"];
    }
  > = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ProviderMediaError("MEDIA_INVALID", "视频任务保存的参考素材快照无效");
    }
    const item = raw as Partial<NodeInputSnapshot>;
    if (
      !Number.isSafeInteger(item.order) ||
      Number(item.order) < 1 ||
      seenOrders.has(Number(item.order)) ||
      typeof item.sourceNodeId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(item.sourceNodeId)
    ) {
      throw new ProviderMediaError("MEDIA_INVALID", "视频任务保存的参考素材快照无效");
    }
    seenOrders.add(Number(item.order));
    if (item.kind === "text") {
      if (item.role !== "instruction" || item.assetId !== undefined) {
        throw new ProviderMediaError("MEDIA_INVALID", "视频任务保存的文字指令快照无效");
      }
      continue;
    }
    if (
      (item.kind !== "image" && item.kind !== "video" && item.kind !== "audio") ||
      typeof item.assetId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(item.assetId) ||
      typeof item.role !== "string" ||
      !arkVideoMediaRoles.has(item.role as ArkVideoMediaInput["role"])
    ) {
      throw new ProviderMediaError("MEDIA_INVALID", "视频任务保存的参考素材快照无效");
    }
    const role = item.role as ArkVideoMediaInput["role"];
    const compatible = item.kind === "image"
      ? ["first-frame", "last-frame", "reference-image", "subject"].includes(role)
      : item.kind === "video"
        ? ["reference-video", "subject"].includes(role)
        : role === "reference-audio";
    if (!compatible) {
      throw new ProviderMediaError("MEDIA_INVALID", "视频任务保存的参考素材角色无效");
    }
    media.push({
      assetId: item.assetId,
      kind: item.kind,
      order: Number(item.order),
      role,
      sourceNodeId: item.sourceNodeId,
    });
  }
  return media.sort((left, right) => left.order - right.order);
}

async function arkVideoMediaInputs(task: GenerationTask): Promise<ArkVideoMediaInput[]> {
  const snapshots = videoTaskMediaSnapshots(task.parameters.inputs);
  const validated = snapshots.map((snapshot): ArkVideoMediaRecord => ({
    kind: snapshot.kind,
    media: arkVideoMediaRecordForOwner({
      assetId: snapshot.assetId,
      kind: snapshot.kind,
      ownerId: task.ownerId!,
    }),
  }));
  assertArkVideoMediaCombination(validated);
  assertArkVideoBase64Budget(
    validated,
    arkVideoBase64EnvelopeBytes(task.prompt),
  );
  const inputs: ArkVideoMediaInput[] = [];
  for (const snapshot of snapshots) {
    inputs.push({
      kind: snapshot.kind,
      order: snapshot.order,
      role: snapshot.role,
      url: await providerMediaUrlForOwner({
        assetId: snapshot.assetId,
        kind: snapshot.kind,
        ownerId: task.ownerId!,
      }),
    });
  }
  return inputs;
}

async function executeVideoTask(taskId: string) {
  const current = taskStore().get(taskId);
  if (!current || !["queued", "running"].includes(current.state) || !current.ownerId) return;
  if (taskProviderProtocol(current) === "media-generate") {
    const controller = new AbortController();
    runningVideoRequests.set(taskId, controller);
    try {
      await executeRelayMediaTask(taskId, "video", controller);
    } catch (error) {
      if (taskStore().get(taskId)?.state === "cancelled") return;
      const failure = safeFailure(error, "video");
      try {
        taskStore().transition(taskId, "failed", failure);
      } catch {
        // A concurrent terminal transition wins.
      }
    } finally {
      if (runningVideoRequests.get(taskId) === controller) {
        runningVideoRequests.delete(taskId);
      }
    }
    return;
  }
  const running = current.state === "queued"
    ? taskStore().transition(taskId, "running")
    : current;
  if (
    !running?.providerProfileId ||
    !running.providerModelId ||
    running.costCurrency !== "CNY"
  ) {
    taskStore().transition(taskId, "failed", {
      code: "MODEL_UNAVAILABLE",
      message: "视频模型配置已失效",
    });
    return;
  }
  const controller = new AbortController();
  runningVideoRequests.set(taskId, controller);
  try {
    const profile = requireTaskProviderSnapshot(
      running,
      await getProviderProfileForGeneration(running.providerProfileId),
    );
    if (profile.driver !== "volcengine-ark") {
      throw new VolcengineArkVideoError("FORMAT", "视频模型配置已失效");
    }
    let providerTaskId = running.providerTaskId;
    if (!providerTaskId) {
      const inputs = await arkVideoMediaInputs(running);
      const created = await withProviderRequestLease({
        expected: profile,
        fetcher: fetch,
        profileId: running.providerProfileId,
        request: (currentProfile, leasedFetch) =>
          createVolcengineArkVideoTask(
            currentProfile,
            {
              duration: typeof running.parameters.duration === "number"
                ? running.parameters.duration
                : 5,
              generateAudio: running.parameters.generateAudio !== false,
              inputs,
              model: running.providerModelId!,
              prompt: running.prompt,
              ratio: typeof running.parameters.aspectRatio === "string"
                ? running.parameters.aspectRatio
                : "16:9",
              resolution: typeof running.parameters.resolution === "string"
                ? running.parameters.resolution
                : "480p",
            },
            leasedFetch,
            controller.signal,
            () => taskStore().recordProviderAttempt(taskId),
          ),
      });
      providerTaskId = created.id;
      taskStore().setProviderTaskId(taskId, providerTaskId);
    }

    for (let poll = 0; poll < 450; poll += 1) {
      if (taskStore().get(taskId)?.state !== "running") return;
      const status = await withProviderRequestLease({
        expected: profile,
        fetcher: fetch,
        profileId: running.providerProfileId,
        request: (currentProfile, leasedFetch) =>
          getVolcengineArkVideoTask(
            currentProfile,
            providerTaskId,
            leasedFetch,
            controller.signal,
          ),
      });
      if (status.state === "cancelled") {
        taskStore().transition(taskId, "cancelled", {
          code: "PROVIDER_CANCELLED",
          message: "视频任务已取消",
        });
        return;
      }
      if (status.state === "failed") {
        taskStore().transition(taskId, "failed", {
          // A Provider-reported failed task is the only asynchronous outcome
          // that may start a new paid task on retry. Remote error identifiers
          // are not stable enough to drive that safety decision.
          code: "PROVIDER_FAILED",
          message: status.errorMessage || "火山方舟未完成本次视频生成",
        });
        return;
      }
      if (status.state === "succeeded") {
        if (!status.videoUrl || status.providerUsageTokens === undefined) {
          throw new VolcengineArkVideoError("FORMAT", "方舟未返回完整的视频结果");
        }
        const videoResponse = await fetch(status.videoUrl, {
          headers: { Accept: "video/mp4" },
          redirect: "error",
          signal: controller.signal,
        });
        if (
          !videoResponse.ok ||
          !videoResponse.body ||
          !String(videoResponse.headers.get("content-type") ?? "").toLowerCase().includes("video")
        ) {
          throw new VolcengineArkVideoError("REMOTE", "方舟视频结果暂时无法下载");
        }
        const saved = await saveGeneratedMp4({
          body: videoResponse.body,
          label: running.prompt.slice(0, 120),
          ownerId: running.ownerId!,
        });
        const actualCostMicrounits = Math.ceil(
          status.providerUsageTokens *
          seedanceMiniAudioPriceMicrounitsPerThousandTokens /
          1_000,
        );
        taskStore().complete(taskId, {
          actualCostMicrounits,
          providerUsageTokens: status.providerUsageTokens,
          resultAssetId: saved.assetId,
        });
        return;
      }
      await wait(2_000, controller.signal);
    }
    throw new VolcengineArkVideoError("TIMEOUT", "视频生成等待超时，可稍后重试");
  } catch (error) {
    if (taskStore().get(taskId)?.state === "cancelled") return;
    const failure = safeFailure(error, "video");
    try {
      taskStore().transition(taskId, "failed", failure);
    } catch {
      // A concurrent terminal transition wins; no second Provider call is made.
    }
  } finally {
    if (runningVideoRequests.get(taskId) === controller) {
      runningVideoRequests.delete(taskId);
    }
  }
}

function waitForAudio(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new MurekaAudioError("CANCELLED"));
    }, { once: true });
  });
}

function audioQueryKind(parameters: Record<string, unknown>): MurekaAudioQueryKind {
  return parameters.musicGenerationMode === "instrumental"
    ? "instrumental"
    : "song";
}

async function executeAudioTask(taskId: string) {
  const current = taskStore().get(taskId);
  if (!current || !["queued", "running"].includes(current.state) || !current.ownerId) return;
  if (taskProviderProtocol(current) === "media-generate") {
    const controller = new AbortController();
    runningAudioRequests.set(taskId, controller);
    try {
      await executeRelayMediaTask(taskId, "audio", controller);
    } catch (error) {
      if (taskStore().get(taskId)?.state === "cancelled") return;
      const failure = safeFailure(error, "audio");
      try {
        taskStore().transition(taskId, "failed", failure);
      } catch {
        // A concurrent terminal transition wins.
      }
    } finally {
      if (runningAudioRequests.get(taskId) === controller) {
        runningAudioRequests.delete(taskId);
      }
    }
    return;
  }
  const running = current.state === "queued"
    ? taskStore().transition(taskId, "running")
    : current;
  if (
    !running?.providerProfileId ||
    !running.providerModelId ||
    running.costCurrency !== "USD"
  ) {
    taskStore().transition(taskId, "failed", {
      code: "MODEL_UNAVAILABLE",
      message: "音频模型配置已失效",
    });
    return;
  }
  const controller = new AbortController();
  runningAudioRequests.set(taskId, controller);
  try {
    const profile = requireTaskProviderSnapshot(
      running,
      await getProviderProfileForGeneration(running.providerProfileId),
    );
    if (profile.driver !== "mureka") {
      throw new MurekaAudioError("FORMAT");
    }
    let providerTaskId = running.providerTaskId;
    const queryKind = audioQueryKind(running.parameters);
    if (!providerTaskId) {
      const created = await withProviderRequestLease({
        expected: profile,
        fetcher: fetch,
        profileId: running.providerProfileId,
        request: (currentProfile, leasedFetch) =>
          createMurekaAudioTask(
            currentProfile,
            {
              lyrics: running.parameters.lyrics,
              model: running.providerModelId!,
              musicGenerationMode: running.parameters.musicGenerationMode,
              outputCount: running.parameters.outputCount,
              prompt: running.prompt,
              streamPlayback: running.parameters.streamPlayback,
              vocalGender: running.parameters.vocalGender,
            },
            leasedFetch,
            controller.signal,
            () => taskStore().recordProviderAttempt(taskId),
          ),
      });
      providerTaskId = created.id;
      taskStore().setProviderTaskId(taskId, providerTaskId);
    }

    for (let poll = 0; poll < 450; poll += 1) {
      if (taskStore().get(taskId)?.state !== "running") return;
      const status = await withProviderRequestLease({
        expected: profile,
        fetcher: fetch,
        profileId: running.providerProfileId,
        request: (currentProfile, leasedFetch) =>
          getMurekaAudioTask(
            currentProfile,
            providerTaskId,
            queryKind,
            leasedFetch,
            controller.signal,
          ),
      });
      if (status.state === "cancelled") {
        taskStore().transition(taskId, "cancelled", {
          code: "PROVIDER_CANCELLED",
          message: "Mureka 已取消本次音频任务",
        });
        return;
      }
      if (status.state === "failed") {
        taskStore().transition(taskId, "failed", {
          code: "PROVIDER_FAILED",
          message: status.errorMessage ?? "Mureka 未完成本次音频生成",
        });
        return;
      }
      if (status.state === "succeeded") {
        if (!status.audioUrl) {
          throw new MurekaAudioError("FORMAT");
        }
        const audioBody = await downloadMurekaAudioResult(
          profile,
          status.audioUrl,
          fetch,
          controller.signal,
        );
        const saved = await saveGeneratedMp3({
          body: audioBody,
          label: running.prompt.slice(0, 120),
          ownerId: running.ownerId!,
        });
        taskStore().complete(taskId, {
          // Mureka does not return a per-task bill. Record the configured
          // protected maximum so budget accounting remains conservative.
          actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
          resultAssetId: saved.assetId,
        });
        return;
      }
      await waitForAudio(2_000, controller.signal);
    }
    throw new MurekaAudioError("TIMEOUT");
  } catch (error) {
    if (taskStore().get(taskId)?.state === "cancelled") return;
    const failure = safeFailure(error, "audio");
    try {
      taskStore().transition(taskId, "failed", failure);
    } catch {
      // A concurrent terminal transition wins; no second Provider call is made.
    }
  } finally {
    if (runningAudioRequests.get(taskId) === controller) {
      runningAudioRequests.delete(taskId);
    }
  }
}

export function retrySnapshotCompatibilityProblem(
  task: GenerationTask,
  model: GenerationModelRow,
) {
  if (task.parameters.inputSchemaVersion !== 1) {
    return "原任务没有可核对的节点输入快照，请回到节点重新提交";
  }
  const rawInputs = task.parameters.inputs;
  if (!Array.isArray(rawInputs) || rawInputs.length > 64) {
    return "原任务保存的节点输入快照无效，请回到节点重新提交";
  }
  const parameterValues = { ...task.parameters };
  delete parameterValues.inputSchemaVersion;
  delete parameterValues.inputs;
  delete parameterValues.references;
  let parameters: Record<string, ModelParameterValue>;
  try {
    parameters = validateParameterValues(
      generationModelSchema(task.kind, model),
      parameterValues,
    );
  } catch {
    return "当前模型参数规则已更新，原任务参数不再兼容，请回到节点重新提交";
  }

  const nodes: Array<{
    data?: Record<string, unknown>;
    id: string;
    type?: string;
  }> = [{ id: task.nodeId, type: task.kind }];
  const edges: Array<{
    data?: Record<string, unknown>;
    id: string;
    source: string;
    target: string;
  }> = [];
  const snapshotImageReferences: ImageReference[] = [];
  for (const [index, raw] of rawInputs.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return "原任务保存的节点输入快照无效，请回到节点重新提交";
    }
    const item = raw as Record<string, unknown>;
    const sourceNodeId = typeof item.sourceNodeId === "string"
      ? item.sourceNodeId
      : "";
    const role = typeof item.role === "string" ? item.role : "";
    const order = Number(item.order);
    if (
      !isNodeInputKind(item.kind) ||
      !/^[a-z0-9._-]{1,160}$/i.test(sourceNodeId) ||
      !/^[a-z][a-z-]{0,39}$/.test(role) ||
      !Number.isSafeInteger(order) ||
      order < 1
    ) {
      return "原任务保存的节点输入顺序、类型或角色无效，请回到节点重新提交";
    }
    const assetId = typeof item.assetId === "string" ? item.assetId : "";
    if (
      item.kind !== "text" &&
      !/^[a-z0-9._-]{1,160}$/i.test(assetId)
    ) {
      return "原任务保存的素材引用无效，请回到节点重新提交";
    }
    const data: Record<string, unknown> = { title: `已保存的${item.kind}输入` };
    if (item.kind === "text") {
      data.content = typeof item.text === "string" && item.text.trim()
        ? item.text
        : "已保存的文字输入";
    } else {
      data.assetId = assetId;
      data[`${item.kind}Src`] = `snapshot:${assetId}`;
      if (item.kind === "image") {
        snapshotImageReferences.push({
          assetId,
          kind: "image",
          sourceNodeId,
        });
      }
    }
    nodes.push({ data, id: sourceNodeId, type: item.kind });
    edges.push({
      data: { inputOrder: order, inputRole: role },
      id: `retry-snapshot-${index + 1}`,
      source: sourceNodeId,
      target: task.nodeId,
    });
  }
  if (task.kind === "image") {
    let persistedReferences: ImageReference[];
    try {
      persistedReferences = imageReferences(task.parameters.references);
    } catch {
      return "原任务保存的图片参考快照无效，请回到节点重新提交";
    }
    const referenceKey = (reference: ImageReference) =>
      `${reference.sourceNodeId}\u0000${reference.assetId}`;
    if (
      persistedReferences.map(referenceKey).sort().join("\n") !==
      snapshotImageReferences.map(referenceKey).sort().join("\n")
    ) {
      return "原任务保存的图片参考与节点输入快照不一致，请回到节点重新提交";
    }
  }

  const hasUpstreamText = rawInputs.some((raw) =>
    raw && typeof raw === "object" && !Array.isArray(raw) &&
    (raw as Record<string, unknown>).kind === "text"
  );
  const compatibilityOwnPrompt =
    task.kind === "text" || task.kind === "video" || !hasUpstreamText
      ? "已保存的本节点Prompt"
      : "";
  const preflight = resolveNodeInputs({
    edges,
    modelSchema: generationModelSchema(task.kind, model),
    nodes,
    ownPrompt: compatibilityOwnPrompt,
    parameters,
    targetId: task.nodeId,
    targetKind: task.kind,
  });
  return preflight.problems[0]?.message;
}

const unknownProviderRetryOutcomes = new Set([
  "FORMAT",
  "GENERATION_FAILED",
  "NETWORK",
  "REMOTE",
  "SERVICE_RESTARTED",
  "TIMEOUT",
]);

function taskEnteredProviderOnLatestExecution(task: GenerationTask) {
  const database = openAppDatabase();
  try {
    return Boolean(database.prepare(`
      SELECT 1
      FROM generation_provider_attempts
      WHERE task_id = ? AND execution_attempt = ?
      LIMIT 1
    `).get(task.id, task.attempt));
  } finally {
    database.close();
  }
}

type RetrySafetyDecision =
  | {
      allowed: true;
      mode: "new-provider-attempt";
      model: GenerationModelRow;
    }
  | { allowed: true; mode: "resume-provider-task" }
  | { allowed: false; code: string; reason: string };

export function retrySafetyDecision(task: GenerationTask): RetrySafetyDecision {
  if (task.state !== "failed") {
    return {
      allowed: false,
      code: "TASK_NOT_FAILED",
      reason: "只有失败任务可以重试",
    };
  }
  const protocol = taskProviderProtocol(task);
  if (
    task.providerTaskId &&
    task.errorCode !== "PROVIDER_FAILED" &&
    (
      (protocol === "media-generate" && task.kind !== "text") ||
      (protocol === "native" && (task.kind === "video" || task.kind === "audio"))
    )
  ) {
    return { allowed: true, mode: "resume-provider-task" };
  }
  if (
    task.errorCode &&
    unknownProviderRetryOutcomes.has(task.errorCode) &&
    (
      task.errorCode === "SERVICE_RESTARTED" ||
      taskEnteredProviderOnLatestExecution(task)
    )
  ) {
    return {
      allowed: false,
      code: "RETRY_OUTCOME_UNKNOWN",
      reason: task.kind === "text" || task.kind === "image"
        ? "上次文字或图片请求的结果无法确认，为避免重复扣费，不能直接重试；请先到模型平台核对任务记录，再从节点重新提交"
        : "上次视频或音频请求可能已经创建，但没有保存平台任务编号；为避免重复扣费，不能创建新任务",
    };
  }
  const model = resolveModel(task.kind, task.model);
  if (
    !model ||
    model.provider_profile_id !== task.providerProfileId ||
    model.provider_model_id !== task.providerModelId ||
    (model.provider_protocol ?? "native") !== protocol
  ) {
    return {
      allowed: false,
      code: "MODEL_UNAVAILABLE",
      reason: task.kind === "text"
        ? "文字模型配置已失效"
        : task.kind === "video"
        ? "视频模型配置已失效"
        : task.kind === "audio"
          ? "音频模型配置已失效"
          : "图片模型配置已失效",
    };
  }
  const snapshotProblem = retrySnapshotCompatibilityProblem(task, model);
  if (snapshotProblem) {
    return {
      allowed: false,
      code: "RETRY_SNAPSHOT_INCOMPATIBLE",
      reason: snapshotProblem,
    };
  }
  return { allowed: true, mode: "new-provider-attempt", model };
}

function resumeProviderTaskSnapshotProblem(task: GenerationTask) {
  const model = resolveModel(task.kind, task.model);
  if (!model) return "原模型已停用、归档或不可用";
  if (
    model.provider_profile_id !== task.providerProfileId ||
    model.provider_model_id !== task.providerModelId ||
    (model.provider_protocol ?? "native") !== taskProviderProtocol(task)
  ) {
    return "原任务的模型、平台连接或协议配置已变化";
  }
  return retrySnapshotCompatibilityProblem(task, model);
}

export function generationTaskCancellationMode(task: GenerationTask) {
  const protocol = taskProviderProtocol(task);
  if (
    protocol === "media-generate" &&
    task.kind !== "text" &&
    task.providerTaskId
  ) {
    return "cancel-relay-media-local" as const;
  }
  if (
    protocol === "native" &&
    task.kind === "audio" &&
    (task.state === "running" || Boolean(task.providerTaskId))
  ) {
    return "provider-cancel-unavailable" as const;
  }
  if (protocol === "native" && task.kind === "video" && task.providerTaskId) {
    return "cancel-provider-video" as const;
  }
  return "cancel-before-provider" as const;
}

export async function generationTasks(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const path = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
    /^\/+/,
    "",
  );
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "Please sign in" });
    return;
  }

  if (request.method === "GET" && path === "status") {
    taskStore();
    const safety = generationSafetyStatus();
    const availability = await generationAvailability();
    const { providerCurrencies, ...publicAvailability } = availability;
    const currencyBudgetReady = (kind: NodeInputKind) =>
      providerCurrencies[kind].some((currency) =>
        currency === "CNY"
          ? safety.dailyCostLimitCnyMicrounits > 0 &&
            safety.monthlyCostLimitCnyMicrounits > 0
          : safety.dailyCostLimitMicrounits > 0 &&
            safety.monthlyCostLimitMicrounits > 0
      );
    json(response, 200, {
      emergencyStop: safety.emergencyStop,
      globalGenerationEnabled: safety.globalEnabled,
      ...publicAvailability,
      persistentQueueReady: true,
      protectionReady: true,
      submissionEnabled:
        availability.providerConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop &&
        ((availability.textProviderConfigured && currencyBudgetReady("text")) ||
          (availability.imageProviderConfigured && currencyBudgetReady("image")) ||
          (availability.videoProviderConfigured && currencyBudgetReady("video")) ||
          (availability.audioProviderConfigured && currencyBudgetReady("audio"))),
      audioSubmissionEnabled:
        availability.audioProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop &&
        currencyBudgetReady("audio"),
      imageSubmissionEnabled:
        availability.imageProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop &&
        currencyBudgetReady("image"),
      textSubmissionEnabled:
        availability.textProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop &&
        currencyBudgetReady("text"),
      videoSubmissionEnabled:
        availability.videoProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop &&
        currencyBudgetReady("video"),
    });
    return;
  }

  if (request.method === "GET" && path === "") {
    const requestUrl = new URL(request.url ?? "", "http://127.0.0.1");
    const canvasId = requestUrl.searchParams.get("canvasId") ?? "";
    try {
      json(response, 200, {
        tasks: (
          identity.bypass
            ? taskStore().list(canvasId)
            : taskStore().listForOwner(canvasId, identity.userId)
        ).map(taskSummary),
      });
    } catch {
      json(response, 400, { error: "Invalid canvas ID" });
    }
    return;
  }

  if (request.method === "GET" && path === "by-idempotency") {
    const requestUrl = new URL(request.url ?? "", "http://127.0.0.1");
    const canvasId = requestUrl.searchParams.get("canvasId") ?? "";
    const idempotencyKey = requestUrl.searchParams.get("idempotencyKey") ?? "";
    try {
      const task = identity.bypass
        ? taskStore().getByIdempotency(canvasId, idempotencyKey)
        : taskStore().getByIdempotencyForOwner(
            canvasId,
            idempotencyKey,
            identity.userId,
          );
      if (!task) {
        json(response, 404, {
          code: "GENERATION_TASK_NOT_FOUND",
          error: "Generation task not found",
        });
        return;
      }
      json(response, 200, taskSummary(task));
    } catch {
      json(response, 400, { error: "Invalid idempotency lookup" });
    }
    return;
  }

  if (request.method === "DELETE" && /^[a-z0-9._-]+$/i.test(path)) {
    const task = identity.bypass
      ? taskStore().get(path)
      : taskStore().getForOwner(path, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    if (!["queued", "running", "recovering", "retrying"].includes(task.state)) {
      json(response, 409, { error: "Generation task cannot be cancelled" });
      return;
    }
    const cancellationMode = generationTaskCancellationMode(task);
    if (cancellationMode === "provider-cancel-unavailable") {
      json(response, 409, {
        code: "PROVIDER_CANCEL_UNAVAILABLE",
        error: "Mureka 暂不支持安全取消，任务会继续保存结果",
      });
      return;
    }
    try {
      if (cancellationMode === "cancel-provider-video" && task.providerTaskId) {
        if (!task.providerProfileId) throw new Error("Provider profile not found");
        await withProviderRequestLease({
          fetcher: fetch,
          profileId: task.providerProfileId,
          request: (profile, leasedFetch) =>
            cancelVolcengineArkVideoTask(
              profile,
              task.providerTaskId!,
              leasedFetch,
            ),
        });
      }
      const cancellation = {
        code: "USER_CANCELLED",
        message: cancellationMode === "cancel-relay-media-local"
          ? "已停止本地等待和结果发布；中转站任务可能仍在运行"
          : task.kind === "text"
          ? "文字生成已取消"
          : task.kind === "video"
          ? "视频生成已取消"
          : task.kind === "audio"
            ? "音频生成已取消"
            : "图片生成已取消",
      };
      const cancelled =
        cancellationMode === "cancel-provider-video" ||
          cancellationMode === "cancel-relay-media-local"
          ? taskStore().transition(path, "cancelled", cancellation)
          : taskStore().cancelBeforeProviderAttempt(path, cancellation);
      if (!cancelled) throw new Error("Generation task not found");
      runningImageRequests.get(path)?.abort();
      runningVideoRequests.get(path)?.abort();
      runningAudioRequests.get(path)?.abort();
      runningTextRequests.get(path)?.abort();
      json(response, 200, taskSummary(cancelled));
    } catch (error) {
      if (error instanceof GenerationTaskProviderBoundaryError) {
        json(response, 409, {
          code: error.code,
          error: error.message,
        });
        return;
      }
      json(response, 409, { error: "Generation task cannot be cancelled" });
    }
    return;
  }

  const retryMatch = path.match(/^([a-z0-9._-]+)\/retry$/i);
  if (request.method === "POST" && retryMatch) {
    const taskId = retryMatch[1];
    const task = identity.bypass
      ? taskStore().get(taskId)
      : taskStore().getForOwner(taskId, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    const retry = retrySafetyDecision(task);
    if (!retry.allowed) {
      json(response, 409, {
        code: retry.code,
        error: retry.reason,
      });
      return;
    }
    if (retry.mode === "resume-provider-task") {
      const compatibilityProblem = resumeProviderTaskSnapshotProblem(task);
      if (compatibilityProblem) {
        json(response, 409, {
          code: "RETRY_SNAPSHOT_CHANGED",
          error: compatibilityProblem,
        });
        return;
      }
      try {
        if (!task.providerProfileId) throw new Error("Provider profile missing");
        requireTaskProviderSnapshot(
          task,
          await getProviderProfileForGeneration(task.providerProfileId),
        );
      } catch {
        json(response, 409, {
          code: "PROVIDER_CONFIGURATION_MISMATCH",
          error: "平台连接已变化，请在节点重新提交，不能继续旧任务",
        });
        return;
      }
    }
    if (retry.mode === "new-provider-attempt") {
      const runtime = await generationRuntimeDecision({
        canSubmit: true,
        kind: task.kind,
        model: retry.model,
        ownerId: identity.bypass ? "__test__" : identity.userId,
      });
      if (!runtime.canEnqueue) {
        json(response, 409, {
          code: runtime.enqueueProblem?.code ?? "MODEL_UNAVAILABLE",
          error: runtime.enqueueProblem?.message ?? "当前模型暂不可生成",
        });
        return;
      }
    }
    try {
      taskStore().transition(
        taskId,
        "retrying",
        undefined,
        retry.mode === "resume-provider-task"
          ? { preserveProviderTaskId: true }
          : undefined,
      );
      const queued = taskStore().transition(taskId, "queued");
      if (!queued) throw new Error("Generation task not found");
      setTimeout(
        () => void (task.kind === "text"
          ? executeTextTask(taskId)
          : task.kind === "video"
          ? executeVideoTask(taskId)
          : task.kind === "audio"
            ? executeAudioTask(taskId)
            : executeImageTask(taskId)),
        0,
      );
      json(response, 202, taskSummary(queued));
    } catch {
      json(response, 409, { error: "Generation task cannot be retried" });
    }
    return;
  }

  if (request.method === "GET" && /^[a-z0-9._-]+$/i.test(path)) {
    const task = identity.bypass
      ? taskStore().get(path)
      : taskStore().getForOwner(path, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    json(response, 200, taskSummary(task));
    return;
  }

  if (request.method === "POST" && path === "preflight") {
    try {
      const body = await readBody<NodeInputGenerationRequest>(request);
      if (
        body.kind !== "text" &&
        body.kind !== "image" &&
        body.kind !== "video" &&
        body.kind !== "audio"
      ) {
        json(response, 400, { error: "输入类型无效" });
        return;
      }
      const model = resolveModel(body.kind, body.model);
      if (!model) {
        const message = missingModelMessage(body.kind);
        json(response, 409, {
          code: "MODEL_UNAVAILABLE",
          error: message,
          problems: generationRuntimeProblems({
            code: "MODEL_UNAVAILABLE",
            message,
          }),
        });
        return;
      }
      if (
        body.inputSchemaVersion !== undefined &&
        body.inputSchemaVersion !== 1
      ) {
        json(response, 409, {
          code: "INPUT_SCHEMA_UNSUPPORTED",
          error: "节点输入版本不受支持",
        });
        return;
      }
      const preflight = strictGenerationPreflight({
        body,
        bypass: identity.bypass,
        model,
        ownerId: identity.bypass ? "__test__" : identity.userId,
        requireFreshRevision: false,
        targetKind: body.kind,
      });
      const runtime = await generationRuntimeDecision({
        canSubmit: preflight.canSubmit,
        kind: body.kind,
        model,
        ownerId: identity.bypass ? "__test__" : identity.userId,
      });
      const { providerProfile: _providerProfile, ...availability } = runtime;
      json(response, 200, {
        ...preflight,
        ...availability,
        modelId: model.id,
        providerRequests: 0,
      });
    } catch (error) {
      if (canvasRevisionConflict(response, error)) return;
      json(response, 400, {
        error: error instanceof Error ? error.message : "提交前检查失败",
      });
    }
    return;
  }

  if (request.method === "POST" && (path === "" || path === "/")) {
    try {
      const body = await readBody<NodeInputGenerationRequest>(request);
      if (
        body.kind !== "text" && body.kind !== "image" &&
        body.kind !== "video" && body.kind !== "audio"
      ) {
        json(response, 503, {
          code: "GENERATION_DISABLED",
          error: "当前节点尚未接通生成",
        });
        return;
      }
      const model = resolveModel(body.kind, body.model);
      if (!model) {
        const message = missingModelMessage(body.kind);
        json(response, 503, {
          code: "MODEL_UNAVAILABLE",
          error: message,
          problems: generationRuntimeProblems({
            code: "MODEL_UNAVAILABLE",
            message,
          }),
        });
        return;
      }
      const ownerId = identity.bypass ? "__test__" : identity.userId;
      if (
        body.inputSchemaVersion !== undefined &&
        body.inputSchemaVersion !== 1
      ) {
        json(response, 409, {
          code: "INPUT_SCHEMA_UNSUPPORTED",
          error: "节点输入版本不受支持",
        });
        return;
      }
      let strictInput: StrictGenerationPreflight;
      try {
        strictInput = strictGenerationPreflight({
          body,
          bypass: identity.bypass,
          model,
          ownerId,
          requireFreshRevision: true,
          targetKind: body.kind,
        });
      } catch (error) {
        if (canvasRevisionConflict(response, error)) return;
        json(response, 409, {
          code: "INPUT_INVALID",
          error: error instanceof Error ? error.message : "节点输入不完整",
        });
        return;
      }
      if (!strictInput.canSubmit) {
        json(response, 409, {
          code: "INPUT_INVALID",
          error: strictInput.problems[0]?.message ?? "节点输入不完整",
          problems: strictInput.problems,
        });
        return;
      }
      const runtime = await generationRuntimeDecision({
        canSubmit: strictInput.canSubmit,
        kind: body.kind,
        model,
        ownerId,
      });
      if (!runtime.canEnqueue || !runtime.providerProfile) {
        const problem = runtime.enqueueProblem ?? {
          code: "MODEL_UNAVAILABLE",
          message: "当前模型暂不可生成",
        };
        json(response, runtime.generationAvailable ? 409 : 503, {
          code: problem.code,
          error: problem.message,
          problems: generationRuntimeProblems(problem),
        });
        return;
      }
      const schema = generationModelSchema(body.kind, model);
      const { parameters, references } = strictInput;
      if (body.kind === "audio" && parameters.outputCount !== 1) {
        json(response, 409, {
          code: "OUTPUT_COUNT_UNSUPPORTED",
          error: "本次真实验收仅允许生成 1 条音频",
        });
        return;
      }
      if (body.kind === "text" && parameters.outputCount !== 1) {
        json(response, 409, {
          code: "OUTPUT_COUNT_UNSUPPORTED",
          error: "当前文字任务每次只生成 1 份结果",
        });
        return;
      }
      if (body.canvasRevision !== undefined) {
        assertPersistedCanvasRevision({
          bypass: identity.bypass,
          canvasId: String(body.canvasId ?? ""),
          expectedRevision: body.canvasRevision,
          ownerId,
        });
      }
      const created = taskStore().create({
        canvasId: String(body.canvasId ?? ""),
        expectedCanvasRevision: body.canvasRevision,
        estimatedCostMicrounits: model.max_cost_microunits,
        costCurrency: model.cost_currency,
        idempotencyKey: String(body.idempotencyKey || randomUUID()),
        kind: body.kind,
        model: model.id,
        modelConfiguration: {
          modelId: model.id,
          parameterSchema: schema,
          providerConfigurationVersion: providerConfigurationVersion(
            runtime.providerProfile,
          ),
          providerDriver: model.provider_driver,
          providerModelId: model.provider_model_id,
          providerProtocol: model.provider_protocol ?? "native",
          providerProfileId: model.provider_profile_id,
        },
        nodeId: String(body.nodeId ?? ""),
        ownerId,
        parameters: body.kind === "text"
          ? {
              ...parameters,
              inputSchemaVersion: 1,
              inputs: strictInput.inputs.map((item) => ({
                assetId: item.assetId,
                kind: item.kind,
                order: item.order,
                role: item.role,
                sourceNodeId: item.sourceNodeId,
                ...(item.kind === "text" ? { text: item.text } : {}),
              })),
            }
          : body.kind === "image"
          ? {
              ...parameters,
              references,
              inputSchemaVersion: 1,
              inputs: strictInput.snapshot,
            }
          : {
              ...parameters,
              inputSchemaVersion: 1,
              inputs: strictInput.snapshot,
            },
        prompt: strictInput.finalPrompt,
        providerModelId: model.provider_model_id,
        providerProfileId: model.provider_profile_id,
      });
      if (created.created) {
        setTimeout(
          () => void (body.kind === "text"
            ? executeTextTask(created.task.id)
            : body.kind === "video"
            ? executeVideoTask(created.task.id)
            : body.kind === "audio"
              ? executeAudioTask(created.task.id)
            : executeImageTask(created.task.id)),
          0,
        );
      }
      json(response, created.created ? 202 : 200, taskSummary(created.task));
    } catch (error) {
      if (canvasRevisionConflict(response, error)) {
        return;
      } else if (error instanceof GenerationTaskConflictError) {
        json(response, 409, {
          code: "IDEMPOTENCY_CONFLICT",
          error: error.message,
        });
      } else {
        json(response, 400, { error: "生成请求无效" });
      }
    }
    return;
  }

  response.setHeader("Allow", "GET, POST, DELETE");
  json(response, 404, { error: "Generation task endpoint not found" });
}
