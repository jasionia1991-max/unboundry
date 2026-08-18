import { statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { imageReferenceForProvider, saveGeneratedPng } from "./assetStorage";
import { requestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import {
  createGenerationSafetyStore,
  generationSafetyStatus,
} from "./generationSafety";
import {
  createGenerationTaskStore,
  failRecoveredGenerationTasks,
  generationProviderAttemptCounts,
  GenerationProviderAttemptBlockedError,
  GenerationTaskAdmissionError,
  GenerationTaskAbandonError,
  GenerationTaskCanvasRevisionConflictError,
  GenerationTaskConflictError,
  GenerationTaskOwnerDeletingError,
  GenerationTaskProviderBoundaryError,
  GenerationTaskRetryFenceError,
  GenerationTaskTransitionError,
  type GenerationPaidRetrySnapshot,
  type GenerationProviderAttemptEvidence,
  type GenerationTask,
  type GenerationTaskCanvasRetryBinding,
  type GenerationTaskInput,
} from "./generationTaskStore";
import { waitForProviderDelay } from "./providerRequestDeadline";
import {
  generateOpenRouterImage,
  OpenRouterImageError,
} from "./openRouterImageProvider";
import { readableMediaForOwner, readyMediaForOwner } from "./mediaRegistry";
import {
  arkVideoBase64BudgetBytes,
  arkVideoBase64Bytes,
  arkVideoBase64EnvelopeBytes,
  arkVideoMediaProblem,
  arkVideoMediaRecordForOwner,
  arkVideoMediaRules,
  assertArkVideoMediaCombination,
  assertArkVideoBase64Budget,
  genericReferenceMediaRules,
  ProviderMediaError,
  providerMediaUrlForOwner,
  type ArkVideoMediaRecord,
} from "./providerMedia";
import {
  acquireProviderGenerationRequestLease,
  getProviderGenerationProfileState,
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
  defaultArkVideoLimits,
  getVolcengineArkVideoTask,
  seedanceMiniAudioPriceMicrounitsPerThousandTokens,
  type ArkVideoLimits,
  type ArkVideoMediaInput,
  VolcengineArkVideoError,
} from "./volcengineArkVideoProvider";
import {
  createVolcengineArkTextResponse,
  type ArkTextInput,
  VolcengineArkTextError,
} from "./volcengineArkTextProvider";
import {
  prepareRelayGptImageRequest,
  pollRelayMediaTask,
  RelayProviderError,
  requestRelayText,
  sendPreparedRelayGptImageRequest,
  submitRelayMedia,
  type RelayImageResult,
  type RelayMediaParamValue,
  type RelayTextContextInput,
  type RelayTextProviderProtocol,
  type RelayTransientMediaOutput,
} from "./relayProviderAdapters";
import {
  downloadProviderResultMedia,
  ProviderResultMediaError,
} from "./providerResultMedia";
import {
  listRelayUsageRecords,
  matchRelayUsageRecord,
} from "./relayUsageReconcile";
import {
  hasPendingGeneratedMediaPublications,
  hasPendingMediaDeletions,
  hasPendingUploadMediaPublications,
  pendingGeneratedPublicationTaskIds,
  recoverPendingGeneratedMediaPublications,
  recoverPendingMediaDeletions,
  recoverPendingUploadMediaPublications,
} from "./mediaLifecycle";
import {
  cleanParameterSchema,
  knownModelParameterSchema,
  providerParameterSchema,
  validateParameterSchemaConstraints,
  validateParameterValues,
  type ModelReferenceMediaRules,
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
import type { RuntimeRoleCoordinator } from "./runtimeRole";

let store: ReturnType<typeof createGenerationTaskStore> | undefined;
let storeDataDirectory: string | undefined;
let persistentGenerationWorkerStartup:
  | Promise<PersistentGenerationWorkerStartupResult>
  | undefined;
let persistentGenerationWorkerCoordinator: RuntimeRoleCoordinator | undefined;
let persistentGenerationWorkerDataDirectory: string | undefined;
const launchedGenerationTasks = new Set<string>();
const runningImageRequests = new Map<string, AbortController>();
const runningVideoRequests = new Map<string, AbortController>();
const runningAudioRequests = new Map<string, AbortController>();
const runningTextRequests = new Map<string, AbortController>();
let runtimeRoleCoordinator: RuntimeRoleCoordinator | undefined;
let preparedRuntimeRoleCoordinator: RuntimeRoleCoordinator | undefined;
let runtimeRoleRegistrationRequired = false;

export function registerGenerationRuntimeRoleCoordinator(
  coordinator: RuntimeRoleCoordinator,
) {
  if (runtimeRoleCoordinator && runtimeRoleCoordinator !== coordinator) {
    throw new Error("Generation runtime role coordinator is already registered");
  }
  if (coordinator.dataDirectory() !== appDataDirectory()) {
    throw new Error("Generation runtime role coordinator data directory changed");
  }
  runtimeRoleRegistrationRequired = true;
  runtimeRoleCoordinator = coordinator;
  preparedRuntimeRoleCoordinator = undefined;
  return () => {
    if (runtimeRoleCoordinator !== coordinator) return;
    if (preparedRuntimeRoleCoordinator !== coordinator) {
      throw new Error(
        "Generation runtime role coordinator cannot unregister before teardown",
      );
    }
    runtimeRoleCoordinator = undefined;
    preparedRuntimeRoleCoordinator = undefined;
  };
}

export function prepareGenerationRuntimeRoleTeardown(
  coordinator: RuntimeRoleCoordinator,
) {
  if (runtimeRoleCoordinator !== coordinator) {
    throw new Error("Generation runtime role coordinator identity changed");
  }
  const snapshot = coordinator.snapshot();
  if (
    snapshot.role !== "active" || !snapshot.activeLeaseHeld ||
    !snapshot.draining
  ) {
    throw new Error("Generation runtime teardown requires a draining active lease");
  }
  if (
    launchedGenerationTasks.size !== 0 || runningImageRequests.size !== 0 ||
    runningVideoRequests.size !== 0 || runningAudioRequests.size !== 0 ||
    runningTextRequests.size !== 0
  ) {
    throw new Error("Generation runtime teardown still has active executions");
  }
  // The shared runtime drain has already waited through Provider transport and
  // durable failure/result persistence. Close the cached writer while the
  // exclusive active lease is still held, then make a later runtime initialize
  // a fresh store/worker promise bound to its own coordinator and data path.
  store?.close();
  store = undefined;
  storeDataDirectory = undefined;
  persistentGenerationWorkerStartup = undefined;
  persistentGenerationWorkerCoordinator = undefined;
  persistentGenerationWorkerDataDirectory = undefined;
  launchedGenerationTasks.clear();
  runningImageRequests.clear();
  runningVideoRequests.clear();
  runningAudioRequests.clear();
  runningTextRequests.clear();
  preparedRuntimeRoleCoordinator = coordinator;
}

export function unregisterGenerationRuntimeRoleCoordinatorBeforeStartup(
  coordinator: RuntimeRoleCoordinator,
) {
  if (runtimeRoleCoordinator !== coordinator) {
    throw new Error("Generation runtime role coordinator identity changed");
  }
  if (
    store || persistentGenerationWorkerStartup ||
    launchedGenerationTasks.size !== 0 || runningImageRequests.size !== 0 ||
    runningVideoRequests.size !== 0 || runningAudioRequests.size !== 0 ||
    runningTextRequests.size !== 0
  ) {
    throw new Error(
      "Generation runtime role coordinator already started durable work",
    );
  }
  preparedRuntimeRoleCoordinator = coordinator;
  runtimeRoleCoordinator = undefined;
  preparedRuntimeRoleCoordinator = undefined;
}

function runRegisteredGenerationExecution<T>(
  execute: () => Promise<T> | T,
  abort?: () => void,
) {
  if (runtimeRoleCoordinator) {
    return runtimeRoleCoordinator.runDetached(
      "generation-worker",
      execute,
      abort,
    );
  }
  if (runtimeRoleRegistrationRequired) {
    throw new Error("Generation runtime role coordinator is unavailable");
  }
  return Promise.resolve().then(execute);
}

export function runGenerationExecutionForRuntimeTest<T>(
  execute: () => Promise<T> | T,
  abort?: () => void,
) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    throw new Error("Generation runtime test seam is unavailable");
  }
  return runRegisteredGenerationExecution(execute, abort);
}

// 金额限额功能已移除（v36）。任务仍保留成本记账：估算值只作为审计参考
// 写入任务记录，不再参与任何预检、拦截或界面展示。
const taskAuditEstimatedCostMicrounits: Record<"CNY" | "USD", number> = {
  CNY: 10_000_000,
  USD: 10_000_000,
};

type RelayProtocol = Exclude<ProviderProtocol, "native">;

function referenceMediaRulesForTask(task: {
  modelConfiguration: Record<string, unknown>;
}): ModelReferenceMediaRules | undefined {
  const raw = task.modelConfiguration.parameterSchema;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rules = (raw as ModelParameterSchema).referenceMediaRules;
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
    return undefined;
  }
  return rules;
}

function adapterVideoLimitsForTask(task: GenerationTask): ArkVideoLimits {
  const snapshot = task.modelConfiguration.parameterSchema as
    | ModelParameterSchema
    | undefined;
  const rules = referenceMediaRulesForTask(task) ?? arkVideoMediaRules;
  const field = (key: string) =>
    snapshot?.fields.find((item) => item.key === key);
  const durationOptions = (field("duration")?.options ?? [])
    .map((option) => Number(option.value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 300)
    .sort((left, right) => left - right);
  const ratios = (field("aspectRatio")?.options ?? [])
    .map((option) => String(option.value));
  const resolutions = (field("resolution")?.options ?? [])
    .map((option) => String(option.value));
  return {
    counts: {
      audio: snapshot?.referenceInputs.audio ?? 3,
      image: snapshot?.referenceInputs.image ?? 9,
      video: snapshot?.referenceInputs.video ?? 3,
    },
    durationMax: durationOptions.at(-1) ?? defaultArkVideoLimits.durationMax,
    durationMin: durationOptions[0] ?? defaultArkVideoLimits.durationMin,
    maxBytes: {
      audio: rules.audio?.maxBytes ?? defaultArkVideoLimits.maxBytes.audio,
      image: rules.image?.maxBytes ?? defaultArkVideoLimits.maxBytes.image,
      video: rules.video?.maxBytes ?? defaultArkVideoLimits.maxBytes.video,
    },
    ratios: ratios.length ? ratios : defaultArkVideoLimits.ratios,
    resolutions: resolutions.length
      ? resolutions
      : defaultArkVideoLimits.resolutions,
  };
}

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
  if (!profile.apiKey) {
    throw new RelayProviderError("AUTH");
  }
  return {
    apiKey: profile.apiKey,
    baseUrl: profile.baseUrl,
    protocol,
  };
}

function requireTaskProviderSnapshot(
  task: Pick<
    GenerationTask,
    "credentialRevision" | "modelConfiguration" | "providerProfileId"
  >,
  profile: ProviderProfile,
  observedCredentialRevision?: number,
) {
  const expectedDriver = task.modelConfiguration.providerDriver;
  const expectedVersion = task.modelConfiguration.providerConfigurationVersion;
  const expectedProfileId = task.providerProfileId ??
    task.modelConfiguration.providerProfileId;
  if (
    (typeof expectedProfileId === "string" && expectedProfileId !== profile.id) ||
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
  const expectedCredentialVersion = task.credentialRevision ??
    task.modelConfiguration.credentialVersion;
  if (
    typeof expectedCredentialVersion === "number" &&
    expectedCredentialVersion > 0 &&
    observedCredentialRevision !== expectedCredentialVersion
  ) {
    throw new ProviderGenerationConfigurationError(
      "ACCOUNT_CREDENTIAL_CHANGED",
      "你的平台密钥已变更，请重新提交",
    );
  }
  return profile;
}

type GenerationLaunchOptions = {
  providerFetcher?: typeof fetch;
  settledExecutions?: Promise<void>[];
};

function taskStore(launchOptions?: GenerationLaunchOptions) {
  if (!runtimeRoleCoordinator && runtimeRoleRegistrationRequired) {
    throw new Error("Generation runtime role coordinator is unavailable");
  }
  runtimeRoleCoordinator?.assertActive("writer");
  const dataDirectory = appDataDirectory();
  if (store && storeDataDirectory !== dataDirectory) {
    throw new Error("Generation task store data directory changed");
  }
  if (store) return store;
  store = createGenerationTaskStore(dataDirectory);
  storeDataDirectory = dataDirectory;
  const pendingPublicationTasks = pendingGeneratedPublicationTaskIds();
  failRecoveredGenerationTasks(store, pendingPublicationTasks);
  for (const task of store.listRecovering()) {
    if (pendingPublicationTasks.has(task.id)) continue;
    const protocol = taskProviderProtocol(task);
    if (
      task.providerTaskId &&
      (
        task.kind === "video" ||
        task.kind === "audio" ||
        (
          task.kind === "image" &&
          (protocol === "media-generate" || protocol === "gpt-image")
        )
      )
    ) {
      store.resume(task.id);
      launchGenerationTask(task.id, task.kind, launchOptions);
    } else {
      store.transition(task.id, "failed", {
        code: "SERVICE_RESTARTED",
        message: "服务重启后无法安全继续本次生成，系统未重新提交",
      });
    }
  }
  for (const task of store.listQueued()) {
    launchGenerationTask(task.id, task.kind, launchOptions);
  }
  const recoverGenerated =
    pendingPublicationTasks.size > 0 || hasPendingGeneratedMediaPublications();
  const recoverUploads = hasPendingUploadMediaPublications();
  const recoverDeletions = hasPendingMediaDeletions();
  if (recoverGenerated || recoverUploads || recoverDeletions) {
    void runRegisteredGenerationExecution(() =>
      settleDetachedGenerationExecution(
        async () => {
          if (recoverDeletions) await recoverPendingMediaDeletions();
          if (recoverUploads) await recoverPendingUploadMediaPublications();
          if (recoverGenerated) await recoverPendingGeneratedMediaPublications();
        },
        () => undefined,
      )
    ).catch(() => undefined);
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
  ownerId: string;
  profileId: string;
  request: (
    profile: ProviderProfile,
    fetcher: typeof fetch,
    providerBoundary: (beforeRequest?: () => void) => () => void,
  ) => Promise<T>;
  task?: Pick<
    GenerationTask,
    "credentialRevision" | "modelConfiguration" | "providerProfileId"
  >;
}) {
  const lease = await acquireProviderGenerationRequestLease(
    input.profileId,
    input.ownerId,
  );
  try {
    const profile = input.expected
      ? requireSameProviderConfiguration(input.expected, lease.profile)
      : lease.profile;
    if (input.task) {
      requireTaskProviderSnapshot(
        input.task,
        profile,
        lease.credentialRevision,
      );
    }
    const providerBoundary = (beforeRequest?: () => void) => {
      let crossed = false;
      return () => {
        if (crossed) return;
        beforeRequest?.();
        crossed = true;
        // Pinned relay transport does not invoke the injected fetch wrapper.
        // Release explicitly at its final beforeRequest boundary so unrelated
        // Storage reservations are not serialized behind the remote response.
        lease.release();
      };
    };
    return await input.request(
      profile,
      fetchWithProviderLease(lease, input.fetcher),
      providerBoundary,
    );
  } finally {
    // Local validation, a rejected Provider-attempt boundary, or a synchronous
    // fetch error can all exit before the wrapper above releases the lease.
    lease.release();
  }
}

async function taskProviderSnapshotProfile(
  task: Pick<
    GenerationTask,
    "credentialRevision" | "modelConfiguration" | "providerProfileId"
  >,
  ownerId: string,
) {
  if (!task.providerProfileId) {
    throw new ProviderGenerationConfigurationError(
      "PROVIDER_CONFIGURATION_MISMATCH",
      "平台连接配置与任务快照不一致，已阻止旧任务继续请求",
    );
  }
  const lease = await acquireProviderGenerationRequestLease(
    task.providerProfileId,
    ownerId,
  );
  try {
    return requireTaskProviderSnapshot(
      task,
      lease.profile,
      lease.credentialRevision,
    );
  } finally {
    lease.release();
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function injectInitialGenerationPostCommitFailure(request: IncomingMessage) {
  if (
    process.env.UNBOUNDRY_SAFE_TEST === "1" &&
    request.headers["x-unboundry-test-generation-post-commit-failure"] ===
      "before-launch"
  ) {
    throw new Error("Controlled initial generation post-commit failure");
  }
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

function taskAbandonAllowed(
  task: GenerationTask,
  providerAttempt: GenerationProviderAttemptEvidence | undefined,
) {
  if (task.state !== "failed" || !providerAttempt) return false;
  if (task.providerTaskId) {
    return providerAttempt.providerTaskId === task.providerTaskId &&
      ["accepted", "response-received"].includes(providerAttempt.outcome);
  }
  return !providerAttempt.providerTaskId &&
    providerAttempt.executionAttempt === task.attempt &&
    providerAttempt.outcome === "response-received";
}

function taskSummary(
  task: GenerationTask,
  retryBinding?: GenerationTaskCanvasRetryBinding,
) {
  const publishedResultAssetId = task.state === "success"
    ? task.resultAssetId
    : undefined;
  const resultMedia = task.kind !== "text" && publishedResultAssetId && task.ownerId
    ? readyMediaForOwner(task.ownerId, task.kind, publishedResultAssetId)
    : undefined;
  const providerAttempt = taskStore().getProviderAttemptForTask(task.id);
  const unsafeProviderAttempt = taskStore()
    .hasUnsafeProviderAttemptForNewPaidRetry(task.id);
  const retryDecision = retrySafetyDecision(
    task,
    providerAttempt,
    unsafeProviderAttempt,
  );
  const resumeSnapshotProblem =
    retryDecision.allowed && retryDecision.mode === "resume-provider-task"
      ? resumeProviderTaskSnapshotProblem(task)
      : undefined;
  const snapshotRetry = resumeSnapshotProblem
    ? {
        allowed: false as const,
        code: "RETRY_SNAPSHOT_CHANGED",
        reason: resumeSnapshotProblem,
      }
    : retryDecision;
  const bindingMatches = Boolean(
    task.state === "failed" &&
    retryBinding &&
    retryBinding.taskId === task.id &&
    retryBinding.kind === task.kind &&
    retryBinding.nodeId === task.nodeId,
  );
  const retry = snapshotRetry.allowed && !bindingMatches
    ? {
        allowed: false as const,
        code: "RETRY_BINDING_STALE",
        reason: "任务已不再绑定当前节点输入，请从节点重新提交",
      }
    : snapshotRetry;
  return {
    abandonAllowed: taskAbandonAllowed(task, providerAttempt),
    actualCostMicrounits: task.actualCostMicrounits,
    attempt: task.attempt,
    canvasRevision: bindingMatches ? retryBinding?.canvasRevision : undefined,
    canvasId: task.canvasId,
    createdAt: task.createdAt,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    estimatedCostMicrounits: task.estimatedCostMicrounits,
    costCurrency: task.costCurrency,
    id: task.id,
    generationInputKey: bindingMatches
      ? retryBinding?.generationInputKey
      : undefined,
    kind: task.kind,
    model: task.model,
    nodeId: task.nodeId,
    prompt: task.prompt,
    providerTaskBound: Boolean(task.providerTaskId),
    reconcileAllowed: task.state === "failed",
    retryAllowed: retry.allowed,
    retryBlockCode: retry.allowed ? undefined : retry.code,
    retryBlockReason: retry.allowed ? undefined : retry.reason,
    resultAssetId: resultMedia ? publishedResultAssetId : undefined,
    resultText: task.resultText,
    resultMedia: resultMedia
      ? {
          byteSize: resultMedia.byteSize,
          contentType: resultMedia.contentType,
          durationSeconds: resultMedia.durationSeconds,
          durationStatus: resultMedia.durationStatus,
          mediaHeight: resultMedia.mediaHeight,
          mediaWidth: resultMedia.mediaWidth,
          storageBackend: resultMedia.storageBackend,
        }
      : undefined,
    resultUrl: resultMedia && publishedResultAssetId
      ? task.kind === "video"
        ? `/api/video-assets/${publishedResultAssetId}`
        : task.kind === "audio"
          ? `/api/audio-assets/${publishedResultAssetId}`
          : `/api/assets/${publishedResultAssetId}`
      : undefined,
    state: task.state,
    updatedAt: task.updatedAt,
  };
}

function taskSummaryForOwner(task: GenerationTask, ownerId?: string) {
  if (task.state !== "failed") return taskSummary(task);
  const binding = taskStore()
    .retryBindingsForCanvas(task.canvasId, ownerId)
    .get(task.id);
  return taskSummary(task, binding);
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

function generationRequestIntent(
  body: NodeInputGenerationRequest,
  kind: NodeInputKind,
) {
  return {
    canvasId: String(body.canvasId ?? ""),
    inputSchemaVersion: body.inputSchemaVersion,
    inputs: body.inputs,
    kind,
    model: body.model ?? null,
    nodeId: String(body.nodeId ?? ""),
    ownPrompt: body.ownPrompt,
    parameters: body.parameters ?? {},
    prompt: String(body.prompt ?? ""),
  };
}

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

function resolveModel(kind: NodeInputKind, modelId: string | undefined, ownerId: string) {
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
            AND auth_task.owner_id = ?
            AND auth_task.state = 'failed'
            AND auth_task.error_code IN ('AUTH', 'PERMISSION')
        ) AS latest_auth_failure_at,
        (
          SELECT MAX(success_task.updated_at)
          FROM generation_tasks AS success_task
          WHERE
            success_task.provider_profile_id = model_profiles.provider_profile_id
            AND success_task.kind = model_profiles.capability
            AND success_task.owner_id = ?
            AND success_task.state = 'success'
        ) AS latest_capability_success_at,
        (
          SELECT MAX(provider_attempt.created_at)
          FROM generation_provider_attempts AS provider_attempt
          WHERE
            provider_attempt.provider_profile_id = model_profiles.provider_profile_id
            AND provider_attempt.kind = model_profiles.capability
            AND provider_attempt.owner_id = ?
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
    `).get(
      ownerId,
      ownerId,
      ownerId,
      kind,
      kind,
      modelId ?? null,
      modelId ?? null,
      modelId ?? null,
    ) as
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
    input.ownerId,
  ).catch(() => ({
    configurationAligned: false as const,
    credentialRevision: undefined,
    profile: undefined,
    reason: "configuration-mismatch" as const,
  }));
  const storedProfile = providerState.profile;
  const accountCredentialState =
    providerState.reason === "account-credential-missing"
      ? ("missing" as const)
      : providerState.reason === "account-credential-invalid"
        ? ("invalid" as const)
        : providerState.reason === "ready"
          ? ("valid" as const)
          : undefined;
  const configured = Boolean(
    storedProfile && storedProfile.driver === input.model.provider_driver,
  );
  const safetyStatus = generationSafetyStatus();
  const availability = evaluateModelRuntimeAvailability({
    accountCredentialState,
    capability: input.kind,
    costCurrency: input.model.cost_currency,
    emergencyStop: safetyStatus.emergencyStop,
    globalEnabled: safetyStatus.globalEnabled,
    latestCapabilitySuccessAt:
      input.model.latest_capability_success_at ?? undefined,
    latestProviderAttemptAt:
      input.model.latest_provider_attempt_at ?? undefined,
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
      providerState.reason === "ready" ||
      providerState.reason === "account-credential-missing" ||
      providerState.reason === "account-credential-invalid"
        ? "enabled"
        : "disabled",
    storedProviderDriver: storedProfile?.driver,
  });
  const safety = createGenerationSafetyStore();
  const safetyAdmission = (() => {
    try {
      return safety.admission({
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
    enqueueProblem,
    ...availability,
    provider: {
      adapterSupported,
      configured,
    },
    credentialVersion: providerState.credentialRevision,
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
    problem.code === "MODEL_UNAVAILABLE";
  return [{
    code: modelProblem ? "MODEL_UNSUPPORTED" as const : "INVALID" as const,
    message: problem.message,
  }];
}

const atomicAdmissionProblemCodes = new Set([
  "EMERGENCY_STOP",
  "GLOBAL_DISABLED",
  "GLOBAL_GENERATION_DISABLED",
  "KIND_CONCURRENCY",
  "PROVIDER_COOLDOWN",
  "RATE_LIMIT",
  "USER_CONCURRENCY",
]);

const missingProviderSnapshotPriorityCodes = new Set([
  "EMERGENCY_STOP",
  "GLOBAL_DISABLED",
  "GLOBAL_GENERATION_DISABLED",
]);

function staticRuntimeProblem(
  runtime: Awaited<ReturnType<typeof generationRuntimeDecision>>,
) {
  const problem = runtime.enqueueProblem;
  return problem && !atomicAdmissionProblemCodes.has(problem.code)
    ? problem
    : undefined;
}

function preAdmissionRuntimeProblem(
  runtime: Awaited<ReturnType<typeof generationRuntimeDecision>>,
) {
  if (
    !runtime.providerProfile &&
    runtime.enqueueProblem &&
    missingProviderSnapshotPriorityCodes.has(runtime.enqueueProblem.code)
  ) {
    return runtime.enqueueProblem;
  }
  return staticRuntimeProblem(runtime);
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
  const referenceMediaRules = schema.referenceMediaRules ?? arkVideoMediaRules;
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
    modelGenerationAdapterSupported({
      capability: "video",
      costCurrency: input.model.cost_currency,
      providerDriver: input.model.provider_driver,
      providerModelId: input.model.provider_model_id,
      providerProtocol: input.model.provider_protocol,
    });
  const paidArkText = input.targetKind === "text" &&
    input.model.provider_driver === "volcengine-ark" &&
    modelGenerationAdapterSupported({
      capability: "text",
      costCurrency: input.model.cost_currency,
      providerDriver: input.model.provider_driver,
      providerModelId: input.model.provider_model_id,
      providerProtocol: input.model.provider_protocol,
    });
  const paidMurekaAudio = input.targetKind === "audio" &&
    input.model.provider_driver === "mureka" &&
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
      const officialProblem = arkVideoMediaProblem(
        resolved.kind,
        media,
        referenceMediaRules,
      );
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
        const maximum =
          referenceMediaRules.video?.maxTotalDurationSeconds;
        if (maximum !== undefined && nextDuration > maximum) {
          appendProblem(persisted, {
            code: "INVALID",
            edgeId: resolved.edgeId,
            message: `${resolved.title}使参考视频总时长超过${maximum}秒`,
          });
          continue;
        }
        paidVideoDuration = nextDuration;
      }
      if (resolved.kind === "audio") {
        paidAudioReferences += 1;
        paidFirstAudioEdgeId ??= resolved.edgeId;
        const nextDuration = paidAudioDuration + media.durationSeconds!;
        const maximum =
          referenceMediaRules.audio?.maxTotalDurationSeconds;
        if (maximum !== undefined && nextDuration > maximum) {
          appendProblem(persisted, {
            code: "INVALID",
            edgeId: resolved.edgeId,
            message: `${resolved.title}使参考音频总时长超过${maximum}秒`,
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

async function generationAvailability(ownerId: string) {
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
            AND auth_task.owner_id = ?
            AND auth_task.state = 'failed'
            AND auth_task.error_code IN ('AUTH', 'PERMISSION')
        ) AS latest_auth_failure_at,
        (
          SELECT MAX(success_task.updated_at)
          FROM generation_tasks AS success_task
          WHERE
            success_task.provider_profile_id = model_profiles.provider_profile_id
            AND success_task.kind = model_profiles.capability
            AND success_task.owner_id = ?
            AND success_task.state = 'success'
        ) AS latest_capability_success_at,
        (
          SELECT MAX(provider_attempt.created_at)
          FROM generation_provider_attempts AS provider_attempt
          WHERE
            provider_attempt.provider_profile_id = model_profiles.provider_profile_id
            AND provider_attempt.kind = model_profiles.capability
            AND provider_attempt.owner_id = ?
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
    `).all(ownerId, ownerId, ownerId) as Array<
      GenerationModelRow & { capability: NodeInputKind }
    >;
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
        ownerId,
      ).catch(() => ({
        configurationAligned: false as const,
        profile: undefined,
        reason: "configuration-mismatch" as const,
      }));
      const profile = providerState.profile;
      const availability = evaluateModelRuntimeAvailability({
        accountCredentialState:
          providerState.reason === "account-credential-missing"
            ? "missing"
            : providerState.reason === "account-credential-invalid"
              ? "invalid"
              : providerState.reason === "ready"
                ? "valid"
                : undefined,
        capability: row.capability,
        costCurrency: row.cost_currency,
        emergencyStop: false,
        globalEnabled: true,
        latestCapabilitySuccessAt:
          row.latest_capability_success_at ?? undefined,
        latestProviderAttemptAt:
          row.latest_provider_attempt_at ?? undefined,
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
          providerState.reason === "ready" ||
          providerState.reason === "account-credential-missing" ||
          providerState.reason === "account-credential-invalid"
            ? "enabled"
            : "disabled",
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

export async function settleDetachedGenerationExecution(
  execute: () => void | Promise<void>,
  persistFailure: (error: unknown) => void | Promise<void>,
) {
  try {
    await execute();
  } catch (error) {
    try {
      await persistFailure(error);
    } catch {
      // Detached work has no caller to receive a second persistence failure.
      // The original rejection is deliberately contained as well.
    }
  }
}

function persistDetachedGenerationFailure(
  taskId: string,
  kind: GenerationTask["kind"],
  error: unknown,
) {
  try {
    const generationStore = taskStore();
    let current = generationStore.get(taskId);
    if (!current || ["cancelled", "failed", "success"].includes(current.state)) {
      return;
    }
    if (current.state === "queued") {
      current = generationStore.transition(taskId, "running");
    }
    if (current?.state !== "running" && current?.state !== "recovering") return;
    generationStore.transition(taskId, "failed", safeFailure(error, kind));
  } catch {
    // Database/state races cannot be reported to a detached caller. Swallowing
    // here prevents the failure-reporting path from becoming an unhandled
    // rejection; later recovery still sees the last committed task state.
  }
}

function launchGenerationTask(
  taskId: string,
  kind: GenerationTask["kind"],
  options?: GenerationLaunchOptions,
) {
  if (launchedGenerationTasks.has(taskId)) return;
  launchedGenerationTasks.add(taskId);
  const execute = () => settleDetachedGenerationExecution(
    () => kind === "text"
      ? executeTextTask(taskId, options?.providerFetcher)
      : kind === "video"
      ? executeVideoTask(taskId, options?.providerFetcher)
      : kind === "audio"
        ? executeAudioTask(taskId)
        : executeImageTask(taskId),
    (error) => persistDetachedGenerationFailure(taskId, kind, error),
  ).finally(() => {
    launchedGenerationTasks.delete(taskId);
  });
  const abort = () => {
    runningImageRequests.get(taskId)?.abort();
    runningVideoRequests.get(taskId)?.abort();
    runningAudioRequests.get(taskId)?.abort();
    runningTextRequests.get(taskId)?.abort();
  };
  if (options?.settledExecutions) {
    try {
      options.settledExecutions.push(
        runRegisteredGenerationExecution(execute, abort),
      );
    } catch {
      launchedGenerationTasks.delete(taskId);
    }
    return;
  }
  if (!runtimeRoleCoordinator) {
    setTimeout(() => {
      void execute();
    }, 0);
    return;
  }
  let cancelledBeforeStart = false;
  try {
    void runRegisteredGenerationExecution(
      () => new Promise<void>((resolve) => {
        setTimeout(() => {
          if (cancelledBeforeStart) {
            launchedGenerationTasks.delete(taskId);
            resolve();
            return;
          }
          void execute().then(resolve);
        }, 0);
      }),
      () => {
        cancelledBeforeStart = true;
        abort();
      },
    ).catch(() => {
      launchedGenerationTasks.delete(taskId);
    });
  } catch {
    // Shutdown can freeze detached admission after the durable task commit but
    // before scheduling. Leave the task queued for the next active owner; no
    // Provider request has started in this branch.
    launchedGenerationTasks.delete(taskId);
  }
}

export type PersistentGenerationWorkerStartupResult = {
  activeTaskCount: number;
  writerOpened: boolean;
};

function optionalFileStat(path: string) {
  try {
    return statSync(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) return undefined;
    throw error;
  }
}

function committedActiveGenerationTaskCount() {
  const databasePath = join(appDataDirectory(), "unboundry.sqlite");
  const walBytes = optionalFileStat(`${databasePath}-wal`)?.size ?? 0;
  const sharedMemoryPresent = Boolean(
    optionalFileStat(`${databasePath}-shm`)?.isFile(),
  );
  if (walBytes > 0 && !sharedMemoryPresent) {
    throw new Error("Generation startup cannot inspect an uncoordinated WAL");
  }
  const databaseLocation = walBytes > 0
    ? databasePath
    : `${pathToFileURL(databasePath).href}?immutable=1`;
  const database = new DatabaseSync(databaseLocation, {
    readOnly: true,
    timeout: 1_000,
  });
  try {
    const row = database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_tasks
      WHERE state IN ('queued', 'running', 'recovering', 'retrying')
    `).get() as { count?: unknown } | undefined;
    return Number(row?.count ?? 0);
  } finally {
    database.close();
  }
}

function failInterruptedRetryingGenerationTasks() {
  const database = openAppDatabase(appDataDirectory());
  const timestamp = new Date().toISOString();
  try {
    database.exec("BEGIN IMMEDIATE");
    const rows = database.prepare(`
      SELECT id
      FROM generation_tasks
      WHERE state = 'retrying'
      ORDER BY created_at ASC, rowid ASC
    `).all() as Array<{ id: string }>;
    const fail = database.prepare(`
      UPDATE generation_tasks
      SET
        state = 'failed',
        error_code = 'RETRY_INTERRUPTED',
        error_message = '服务重启中断了重试准备，未创建新的模型平台请求',
        updated_at = ?
      WHERE id = ? AND state = 'retrying'
    `);
    const record = database.prepare(`
      INSERT INTO generation_task_events (
        task_id, state, error_code, error_message, created_at
      ) VALUES (
        ?, 'failed', 'RETRY_INTERRUPTED',
        '服务重启中断了重试准备，未创建新的模型平台请求', ?
      )
    `);
    for (const row of rows) {
      if (fail.run(timestamp, row.id).changes === 1) {
        record.run(row.id, timestamp);
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    database.close();
  }
}

function startupWorkerTestProviderFetcher(): typeof fetch | undefined {
  if (
    process.env.UNBOUNDRY_SAFE_TEST !== "1" ||
    process.env.UNBOUNDRY_TEST_GENERATION_STARTUP_FAKE_PROVIDER !== "1"
  ) return undefined;
  const evidencePath = join(
    appDataDirectory(),
    ".unboundry-startup-provider-fixture.log",
  );
  return async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    await appendFile(
      evidencePath,
      `${JSON.stringify({ method, url })}\n`,
      { encoding: "utf8", flag: "a" },
    );
    if (
      process.env.UNBOUNDRY_TEST_GENERATION_STARTUP_HANG === "1"
    ) {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const rejectAbort = () => reject(
          new DOMException("M81 controlled Provider abort", "AbortError"),
        );
        if (signal?.aborted) {
          rejectAbort();
          return;
        }
        signal?.addEventListener("abort", rejectAbort, { once: true });
      });
    }
    if (method === "GET" && url.includes("/contents/generations/tasks/")) {
      return new Response(JSON.stringify({
        error: { code: "M81_FAKE_PROVIDER_FAILED" },
        status: "failed",
      }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }
    return new Response(JSON.stringify({
      output: [{
        content: [{
          text: "M81 startup worker fake Provider result",
          type: "output_text",
        }],
        status: "completed",
        type: "message",
      }],
      status: "completed",
      usage: { total_tokens: 1 },
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };
}

/**
 * Starts or recovers durable active work once per process. The first pass is
 * read-only so an idle database never opens the writer or creates SQLite sidecars.
 */
export function initializePersistentGenerationTaskWorker() {
  if (!runtimeRoleCoordinator && runtimeRoleRegistrationRequired) {
    throw new Error("Generation runtime role coordinator is unavailable");
  }
  runtimeRoleCoordinator?.assertActive("generation-worker");
  const dataDirectory = appDataDirectory();
  if (persistentGenerationWorkerStartup) {
    if (
      persistentGenerationWorkerCoordinator !== runtimeRoleCoordinator ||
      persistentGenerationWorkerDataDirectory !== dataDirectory
    ) {
      throw new Error("Generation startup worker runtime identity changed");
    }
    return persistentGenerationWorkerStartup;
  }
  const initialize = async () => {
    if (
      process.env.UNBOUNDRY_SAFE_TEST === "1" &&
      process.env.UNBOUNDRY_TEST_GENERATION_STARTUP_OBSERVE === "1"
    ) {
      await appendFile(
        join(dataDirectory, ".unboundry-startup-worker-observer.log"),
        `${JSON.stringify({ event: "persistent-worker-start" })}\n`,
        { encoding: "utf8", flag: "a" },
      );
    }
    const activeTaskCount = committedActiveGenerationTaskCount();
    if (activeTaskCount === 0) {
      return { activeTaskCount, writerOpened: false };
    }
    if (
      process.env.UNBOUNDRY_SAFE_TEST === "1" &&
      process.env.UNBOUNDRY_TEST_GENERATION_STARTUP_FAILURE === "1"
    ) {
      throw new Error("M81 controlled generation startup failure");
    }
    failInterruptedRetryingGenerationTasks();
    const providerFetcher = startupWorkerTestProviderFetcher();
    const settledExecutions =
      providerFetcher &&
        process.env.UNBOUNDRY_TEST_GENERATION_STARTUP_HANG !== "1"
        ? [] as Promise<void>[]
        : undefined;
    const launchOptions = { providerFetcher, settledExecutions };
    const generationStore = taskStore(launchOptions);
    // If another in-process caller initialized the store first, cover any
    // still-queued task here. launchGenerationTask is itself idempotent.
    for (const task of generationStore.listQueued()) {
      launchGenerationTask(task.id, task.kind, launchOptions);
    }
    if (settledExecutions) await Promise.all(settledExecutions);
    return { activeTaskCount, writerOpened: true };
  };
  persistentGenerationWorkerCoordinator = runtimeRoleCoordinator;
  persistentGenerationWorkerDataDirectory = dataDirectory;
  persistentGenerationWorkerStartup = runtimeRoleCoordinator
    ? runtimeRoleCoordinator.runDetached("generation-worker", initialize)
    : initialize();
  return persistentGenerationWorkerStartup;
}

type TextTaskStore = Pick<
  ReturnType<typeof createGenerationTaskStore>,
  | "complete"
  | "get"
  | "markProviderResponseReceived"
  | "recordProviderAttempt"
  | "transition"
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
  const stored = input.contentType ?? readyMediaForOwner(
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
    acquireProfile: (
      profileId: string,
      ownerId: string,
    ) => Promise<ProviderGenerationRequestLease>;
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
      const url = await dependencies.mediaUrlForOwner(mediaInput, {
        rules: referenceMediaRulesForTask(running) ?? genericReferenceMediaRules,
      });
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
    const lease = await dependencies.acquireProfile(
      running.providerProfileId,
      running.ownerId!,
    );
    let result: { providerUsageTokens?: number; text: string };
    try {
      requireTaskProviderSnapshot(
        running,
        lease.profile,
        lease.credentialRevision,
      );
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
    dependencies.store.markProviderResponseReceived({
      executionAttempt: running.attempt,
      taskId,
    });
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

async function executeTextTask(taskId: string, fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  runningTextRequests.set(taskId, controller);
  try {
    await executeTextTaskWithDependencies(taskId, {
      acquireProfile: acquireProviderGenerationRequestLease,
      fetcher,
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
  task: Pick<
    GenerationTask,
    "kind" | "modelConfiguration" | "ownerId" | "parameters" | "providerModelId"
  >,
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
  const grokImagineVideo15 = task.kind === "video" &&
    task.providerModelId === "grok-imagine-video-1.5-preview";
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
    const parameterName = grokImagineVideo15 && input.kind === "image" &&
        input.role === "first-frame"
      ? "images"
      : relayMediaRoleParameters[input.role]?.[input.kind];
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
    const mediaUrl = await mediaUrlForOwner({
      assetId: input.assetId,
      kind: input.kind,
      ownerId: task.ownerId,
    }, {
      rules: referenceMediaRulesForTask(task) ?? genericReferenceMediaRules,
    });
    if (grokImagineVideo15 && input.parameterName === "images") {
      const existing = parameters.images;
      parameters.images = existing === undefined
        ? [mediaUrl]
        : Array.isArray(existing)
          ? [...existing, mediaUrl]
          : [existing, mediaUrl];
    } else {
      appendRelayMediaParam(parameters, input.parameterName, mediaUrl);
    }
  }
  if (
    grokImagineVideo15 &&
    (!Array.isArray(parameters.images) || parameters.images.length !== 1)
  ) {
    throw new RelayProviderError("FORMAT");
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
  actualCostMicrounits: number;
  expectedAudioContentType?: string;
  output: RelayTransientMediaOutput;
  ownerId: string;
  profile: ProviderProfile;
  prompt: string;
  signal: AbortSignal;
  taskId: string;
}) {
  if (input.output.transport === "bytes") {
    if (input.output.kind !== "image" || input.output.mimeType !== "image/png") {
      throw new ProviderResultMediaError("FORMAT", "模型结果格式不受支持");
    }
    const saved = await saveGeneratedPng({
      bytes: Buffer.from(input.output.bytes),
      label: input.prompt.slice(0, 120),
      ownerId: input.ownerId,
      task: {
        actualCostMicrounits: input.actualCostMicrounits,
        taskId: input.taskId,
      },
    });
    return saved.assetId;
  }
  const downloaded = await downloadProviderResultMedia({
    apiKey: input.profile.apiKey!,
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
      task: {
        actualCostMicrounits: input.actualCostMicrounits,
        taskId: input.taskId,
      },
    });
    return saved.assetId;
  }
  if (input.output.kind === "video") {
    const saved = await saveGeneratedMp4({
      body: downloaded.body,
      label: input.prompt.slice(0, 120),
      ownerId: input.ownerId,
      task: {
        actualCostMicrounits: input.actualCostMicrounits,
        taskId: input.taskId,
      },
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
    task: {
      actualCostMicrounits: input.actualCostMicrounits,
      taskId: input.taskId,
    },
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

async function waitForRelayMedia(milliseconds: number, signal: AbortSignal) {
  try {
    await waitForProviderDelay(milliseconds, signal);
  } catch {
    throw new RelayProviderError("CANCELLED", true);
  }
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
  const profile = await taskProviderSnapshotProfile(running, running.ownerId!);
  assertRelayProfile(profile, protocol);
  let providerTaskId = running.providerTaskId;
  if (!providerTaskId) {
    const params = await relayMediaParametersForTask(
      running,
      providerMediaUrlForOwner,
    );
    const submission = await withProviderRequestLease({
      expected: profile,
      fetcher: fetch,
      ownerId: ownerId,
      profileId: running.providerProfileId,
      task: running,
      request: async (currentProfile, leasedFetch) => {
        const created = await submitRelayMedia(
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
        );
        taskStore().setProviderTaskId(taskId, created.externalTaskId);
        return created;
      },
    });
    providerTaskId = submission.externalTaskId;
  }
  for (let poll = 0; poll < 450; poll += 1) {
    if (taskStore().get(taskId)?.state !== "running") return;
    const status = await withProviderRequestLease({
      expected: profile,
      fetcher: fetch,
      ownerId: ownerId,
      profileId: running.providerProfileId,
      task: running,
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
      taskStore().markProviderResponseReceivedForTask(taskId);
      if (status.outputs.length !== 1) throw new RelayProviderError("FORMAT");
      await saveRelayMediaOutput({
        actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
        expectedAudioContentType: kind === "audio"
          ? relayAudioResultContentType(running.parameters.format)
          : undefined,
        output: status.outputs[0],
        ownerId,
        profile,
        prompt: running.prompt,
        signal: controller.signal,
        taskId,
      });
      return;
    }
    await waitForRelayMedia(2_000, controller.signal);
  }
  throw new RelayProviderError("TIMEOUT", true);
}

async function recoverGptImageFromProviderTask(
  taskId: string,
  running: GenerationTask,
  controller: AbortController,
) {
  if (!running.ownerId || !running.providerProfileId || !running.providerTaskId) {
    throw new RelayProviderError("FORMAT");
  }
  const profile = await taskProviderSnapshotProfile(running, running.ownerId);
  const status = await withProviderRequestLease({
    expected: profile,
    fetcher: fetch,
    ownerId: running.ownerId,
    profileId: running.providerProfileId,
    task: running,
    request: (currentProfile, leasedFetch) =>
      pollRelayMediaTask(
        assertRelayProfile(currentProfile, "media-generate"),
        {
          capability: "image",
          externalTaskId: running.providerTaskId!,
          providerProtocol: "media-generate",
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
      message: "平台没有这张图",
    });
    return;
  }
  if (status.state !== "success") {
    throw new RelayProviderError("TIMEOUT", true);
  }
  if (status.outputs.length !== 1) throw new RelayProviderError("PROVIDER_RESULT_FORMAT", true);
  taskStore().markProviderResponseReceivedForTask(taskId);
  await saveRelayMediaOutput({
    actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
    output: status.outputs[0],
    ownerId: running.ownerId,
    profile,
    prompt: running.prompt,
    signal: controller.signal,
    taskId,
  });
}

async function autoMatchRelayProviderTask(task: GenerationTask) {
  if (!task.ownerId || !task.providerProfileId || !task.providerModelId) {
    return { status: "none" as const };
  }
  if (task.kind === "text") return { status: "none" as const };
  const profile = await taskProviderSnapshotProfile(task, task.ownerId);
  if (profile.driver !== "multi-protocol-relay") return { status: "none" as const };
  const context = taskStore().listOwnerRelayMatchContext({
    excludeTaskId: task.id,
    kind: task.kind,
    ownerId: task.ownerId,
    providerModelId: task.providerModelId,
  });
  const siblingSuccesses = context.competitors
    .filter((item) => item.state === "success")
    .map((item) => ({ createdAt: item.createdAt, updatedAt: item.updatedAt }));
  const records = await listRelayUsageRecords(profile);
  return matchRelayUsageRecord({
    competingLocals: context.competitors,
    localCreatedAt: task.createdAt,
    localUpdatedAt: task.updatedAt,
    occupiedTaskIds: context.occupiedTaskIds,
    providerModelId: task.providerModelId,
    records,
    siblingSuccesses,
  });
}

async function executeImageTask(taskId: string) {
  const current = taskStore().get(taskId);
  if (!current || !["queued", "running"].includes(current.state) || !current.ownerId) return;
  const ownerId = current.ownerId;
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
    const providerProfileId = running.providerProfileId;
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
        ownerId: current.ownerId,
        profileId: running.providerProfileId,
        task: running,
        request: (profile, leasedFetch) =>
          generateOpenRouterImage(
            profile,
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
      taskStore().markProviderResponseReceived({
        executionAttempt: running.attempt,
        taskId,
      });
      const saved = await saveGeneratedPng({
        bytes: result.bytes,
        label: running.prompt.slice(0, 120),
        ownerId: current.ownerId,
        task: {
          actualCostMicrounits: result.actualCostMicrounits,
          taskId,
        },
      });
      void saved;
      return;
    }
    if (protocol !== "gpt-image") throw new RelayProviderError("FORMAT");
    if (running.providerTaskId) {
      await recoverGptImageFromProviderTask(taskId, running, controller);
      return;
    }
    const profile = await taskProviderSnapshotProfile(running, current.ownerId);
    assertRelayProfile(profile, protocol);
    const prepared = await prepareRelayGptImageRequest({
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
    }, {
      mediaLifecycle: { ownerId },
      signal: controller.signal,
    });
    const relayResult = await (async (): Promise<RelayImageResult> => {
      try {
        return await withProviderRequestLease<RelayImageResult>({
          expected: profile,
          fetcher: fetch,
          ownerId,
          profileId: providerProfileId,
          task: running,
          request: (currentProfile, leasedFetch, providerBoundary) =>
            sendPreparedRelayGptImageRequest(
              assertRelayProfile(currentProfile, protocol),
              prepared.request,
              {
                beforeProviderRequest: providerBoundary(
                  () => taskStore().recordProviderAttempt(taskId),
                ),
                fetcher: leasedFetch,
                signal: controller.signal,
                usePinnedTransport: true,
              },
            ),
        });
      } finally {
        await prepared.cleanup();
      }
    })();
    if (relayResult.externalTaskId) {
      try {
        taskStore().setProviderTaskId(taskId, relayResult.externalTaskId);
      } catch {
        // Keep the already-received pixels even if the remote id cannot bind.
      }
    }
    taskStore().markProviderResponseReceived({
      executionAttempt: running.attempt,
      taskId,
    });
    if (relayResult.outputs.length !== 1) {
      throw new RelayProviderError("PROVIDER_RESULT_FORMAT", true);
    }
    await saveRelayMediaOutput({
      actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
      output: relayResult.outputs[0],
      ownerId: current.ownerId,
      profile,
      prompt: running.prompt,
      signal: controller.signal,
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

async function wait(milliseconds: number, signal: AbortSignal) {
  try {
    await waitForProviderDelay(milliseconds, signal);
  } catch {
    throw new VolcengineArkVideoError("CANCELLED", "视频任务已取消");
  }
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
  const rules = referenceMediaRulesForTask(task) ?? arkVideoMediaRules;
  const validated = snapshots.map((snapshot): ArkVideoMediaRecord => ({
    kind: snapshot.kind,
    media: arkVideoMediaRecordForOwner({
      assetId: snapshot.assetId,
      kind: snapshot.kind,
      ownerId: task.ownerId!,
    }, rules),
  }));
  assertArkVideoMediaCombination(validated, rules);
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
      }, { rules }),
    });
  }
  return inputs;
}

async function executeVideoTask(
  taskId: string,
  fetcher: typeof fetch = fetch,
) {
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
    const profile = await taskProviderSnapshotProfile(running, running.ownerId!);
    if (profile.driver !== "volcengine-ark") {
      throw new VolcengineArkVideoError("FORMAT", "视频模型配置已失效");
    }
    let providerTaskId = running.providerTaskId;
    if (!providerTaskId) {
      const inputs = await arkVideoMediaInputs(running);
      const created = await withProviderRequestLease({
        expected: profile,
        fetcher,
        ownerId: running.ownerId!,
        profileId: running.providerProfileId,
        task: running,
        request: async (currentProfile, leasedFetch) => {
          const created = await createVolcengineArkVideoTask(
            currentProfile,
            {
              duration: typeof running.parameters.duration === "number"
                ? running.parameters.duration
                : 5,
              generateAudio: running.parameters.generateAudio !== false,
              inputs,
              limits: adapterVideoLimitsForTask(running),
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
          );
          taskStore().setProviderTaskId(taskId, created.id);
          return created;
        },
      });
      providerTaskId = created.id;
    }

    for (let poll = 0; poll < 450; poll += 1) {
      if (taskStore().get(taskId)?.state !== "running") return;
      const status = await withProviderRequestLease({
        expected: profile,
        fetcher,
        ownerId: running.ownerId!,
        profileId: running.providerProfileId,
        task: running,
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
        taskStore().markProviderResponseReceivedForTask(taskId);
        if (!status.videoUrl || status.providerUsageTokens === undefined) {
          throw new VolcengineArkVideoError("FORMAT", "方舟未返回完整的视频结果");
        }
        const downloaded = await downloadProviderResultMedia({
          apiKey: profile.apiKey ?? "",
          kind: "video",
          signal: controller.signal,
          url: status.videoUrl,
        });
        const actualCostMicrounits = Math.ceil(
          status.providerUsageTokens *
          seedanceMiniAudioPriceMicrounitsPerThousandTokens /
          1_000,
        );
        await saveGeneratedMp4({
          body: downloaded.body,
          label: running.prompt.slice(0, 120),
          ownerId: running.ownerId!,
          task: {
            actualCostMicrounits,
            providerUsageTokens: status.providerUsageTokens,
            taskId,
          },
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

async function waitForAudio(milliseconds: number, signal: AbortSignal) {
  try {
    await waitForProviderDelay(milliseconds, signal);
  } catch {
    throw new MurekaAudioError("CANCELLED");
  }
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
    const profile = await taskProviderSnapshotProfile(running, running.ownerId!);
    if (profile.driver !== "mureka") {
      throw new MurekaAudioError("FORMAT");
    }
    let providerTaskId = running.providerTaskId;
    const queryKind = audioQueryKind(running.parameters);
    if (!providerTaskId) {
      const created = await withProviderRequestLease({
        expected: profile,
        fetcher: fetch,
        ownerId: running.ownerId!,
        profileId: running.providerProfileId,
        task: running,
        request: async (currentProfile, leasedFetch) => {
          const created = await createMurekaAudioTask(
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
          );
          taskStore().setProviderTaskId(taskId, created.id);
          return created;
        },
      });
      providerTaskId = created.id;
    }

    for (let poll = 0; poll < 450; poll += 1) {
      if (taskStore().get(taskId)?.state !== "running") return;
      const status = await withProviderRequestLease({
        expected: profile,
        fetcher: fetch,
        ownerId: running.ownerId!,
        profileId: running.providerProfileId,
        task: running,
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
        taskStore().markProviderResponseReceivedForTask(taskId);
        if (!status.audioUrl) {
          throw new MurekaAudioError("FORMAT");
        }
        const audioBody = await downloadMurekaAudioResult(
          profile,
          status.audioUrl,
          { signal: controller.signal },
        );
        await saveGeneratedMp3({
          body: audioBody,
          label: running.prompt.slice(0, 120),
          ownerId: running.ownerId!,
          task: {
            // Mureka does not return a per-task bill. Record the configured
            // protected maximum so budget accounting remains conservative.
            actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
            taskId,
          },
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
  model: GenerationModelRow | undefined,
  mode: "new-provider-attempt" | "resume-provider-task" =
    "new-provider-attempt",
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
  const modelSchema = mode === "new-provider-attempt"
    ? model
      ? generationModelSchema(task.kind, model)
      : undefined
    : undefined;
  if (mode === "new-provider-attempt" && !modelSchema) {
    return "原模型已停用、归档或不可用";
  }
  let parameters: Record<string, ModelParameterValue> = {};
  if (modelSchema) {
    try {
      parameters = validateParameterValues(modelSchema, parameterValues);
    } catch {
      return "当前模型参数规则已更新，原任务参数不再兼容，请回到节点重新提交";
    }
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
  const snapshotOrders = new Set<number>();
  const snapshotSources = new Set<string>();
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
      order < 1 ||
      sourceNodeId === task.nodeId ||
      snapshotOrders.has(order) ||
      snapshotSources.has(sourceNodeId)
    ) {
      return "原任务保存的节点输入顺序、类型或角色无效，请回到节点重新提交";
    }
    snapshotOrders.add(order);
    snapshotSources.add(sourceNodeId);
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
      if (mode === "new-provider-attempt") {
        const media = task.ownerId
          ? readyMediaForOwner(task.ownerId, item.kind, assetId)
          : undefined;
        if (!media) {
          return "原任务保存的素材不存在、未就绪或不属于当前账号，请回到节点重新提交";
        }
        // A new paid attempt must be checked against the current model using
        // the exact durable metadata. Never manufacture values from the old
        // snapshot merely to make a tightened rule pass.
        data.mediaMetadataSource = "server";
        data.mediaMetadataStatus = item.kind === "image"
          ? "ready"
          : media.durationStatus === "not-applicable"
            ? "failed"
            : media.durationStatus;
        data.mediaByteSize = media.byteSize;
        data.mediaStorageBackend = media.storageBackend;
        data.mediaContentType = media.contentType;
        data.mediaDurationSeconds = media.durationSeconds ?? undefined;
        data.mediaWidth = media.mediaWidth ?? undefined;
        data.mediaHeight = media.mediaHeight ?? undefined;
      }
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

  // An existing Provider task has already consumed its inputs. Resuming its
  // status/result retrieval must survive later media deletion or model-rule
  // tightening, while still rejecting a malformed or rewritten snapshot.
  if (mode === "resume-provider-task") return undefined;

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
    modelSchema,
    nodes,
    ownPrompt: compatibilityOwnPrompt,
    parameters,
    targetId: task.nodeId,
    targetKind: task.kind,
  });
  return preflight.problems[0]?.message;
}

type RetrySafetyDecision =
  | {
      allowed: true;
      mode: "new-provider-attempt";
      model: GenerationModelRow;
    }
  | { allowed: true; mode: "resume-provider-task" }
  | { allowed: false; code: string; reason: string };

export function retrySafetyDecision(
  task: GenerationTask,
  providerAttempt = taskStore().getProviderAttemptForTask(task.id),
  unsafeProviderAttempt = taskStore()
    .hasUnsafeProviderAttemptForNewPaidRetry(task.id),
): RetrySafetyDecision {
  const exactAbandonedEvidence = Boolean(
    providerAttempt &&
    (
      task.providerTaskId
        ? providerAttempt.providerTaskId === task.providerTaskId &&
          ["accepted", "response-received"].includes(providerAttempt.outcome)
        : !providerAttempt.providerTaskId &&
          providerAttempt.executionAttempt === task.attempt &&
          providerAttempt.outcome === "response-received"
    )
  );
  if (
    task.state === "cancelled" &&
    task.errorCode === "USER_ABANDONED" &&
    exactAbandonedEvidence
  ) {
    return {
      allowed: false,
      code: "RETRY_OUTCOME_UNKNOWN",
      reason:
        "该平台结果已显式放弃本地继续恢复；已保留付费证据，不能自动重试或再次付费提交",
    };
  }
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
    providerAttempt &&
    ["accepted", "response-received"].includes(providerAttempt.outcome) &&
    (
      (protocol === "media-generate" && task.kind !== "text") ||
      (protocol === "gpt-image" && task.kind === "image") ||
      (protocol === "native" && (task.kind === "video" || task.kind === "audio"))
    )
  ) {
    return { allowed: true, mode: "resume-provider-task" };
  }
  if (
    (task.providerTaskId && !providerAttempt) ||
    unsafeProviderAttempt
  ) {
    return {
      allowed: false,
      code: "RETRY_OUTCOME_UNKNOWN",
      reason: task.kind === "text" || task.kind === "image"
        ? "上次结果还没对上，为避免重复扣费，请先点「核对结果」，不要重新生成"
        : "上次视频或音频请求可能已经创建，但没有保存平台任务编号；请先点「核对结果」，不要重新生成",
    };
  }
  const model = resolveModel(task.kind, task.model, task.ownerId ?? "");
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
  return retrySnapshotCompatibilityProblem(
    task,
    undefined,
    "resume-provider-task",
  );
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

async function cancelGenerationTask(task: GenerationTask) {
  const cancellationMode = generationTaskCancellationMode(task);
  if (cancellationMode === "provider-cancel-unavailable") {
    const error = new Error(
      "Mureka 暂不支持安全取消，任务会继续保存结果",
    );
    Object.assign(error, { code: "PROVIDER_CANCEL_UNAVAILABLE" });
    throw error;
  }
  if (cancellationMode === "cancel-provider-video" && task.providerTaskId) {
    if (!task.providerProfileId) throw new Error("Provider profile not found");
    await withProviderRequestLease({
      fetcher: fetch,
      ownerId: task.ownerId ?? "",
      profileId: task.providerProfileId,
      task,
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
      ? taskStore().transition(task.id, "cancelled", cancellation)
      : taskStore().cancelBeforeProviderAttempt(task.id, cancellation);
  if (!cancelled) throw new Error("Generation task not found");
  runningImageRequests.get(task.id)?.abort();
  runningVideoRequests.get(task.id)?.abort();
  runningAudioRequests.get(task.id)?.abort();
  runningTextRequests.get(task.id)?.abort();
}

/**
 * Applies the administrator's emergency-stop cancellation policy without
 * claiming that an unsupported or already-unknown Provider request stopped.
 */
export async function applyEmergencyStopRunningTaskPolicy() {
  const generationStore = taskStore();
  const summary = { cancelled: 0, failed: 0, waiting: 0 };
  for (const task of generationStore.listActive()) {
    const mode = generationTaskCancellationMode(task);
    if (
      mode === "provider-cancel-unavailable" ||
      mode === "cancel-relay-media-local"
    ) {
      summary.waiting += 1;
      continue;
    }
    try {
      await cancelGenerationTask(task);
      summary.cancelled += 1;
    } catch (error) {
      if (
        error instanceof GenerationTaskProviderBoundaryError ||
        (error instanceof Error &&
          (error as { code?: string }).code === "PROVIDER_CANCEL_UNAVAILABLE")
      ) {
        summary.waiting += 1;
      } else {
        summary.failed += 1;
      }
    }
  }
  return summary;
}

/**
 * Cancel every active generation task of a canvas. Used by project deletion so
 * a removed project cannot leave a live task writing results back afterwards.
 */
export async function cancelCanvasGenerationTasks(
  canvasId: string,
  ownerId?: string,
) {
  const tasks = taskStore().listActiveForCanvas(canvasId, ownerId);
  for (const task of tasks) {
    await cancelGenerationTask(task);
  }
}

const reconcileCooldownMs = 8_000;
const lastReconcileAt = new Map<string, number>();

type ReconcilePollState = "cannot-query" | "failed" | "running" | "success";

async function pollReconcileProviderTask(
  task: GenerationTask,
  providerTaskId: string,
  signal: AbortSignal,
): Promise<ReconcilePollState> {
  if (!task.ownerId || !task.providerProfileId) return "cannot-query";
  const protocol = taskProviderProtocol(task);
  if (protocol === "media-generate" && task.kind !== "text") {
    const profile = await taskProviderSnapshotProfile(task, task.ownerId);
    const status = await pollRelayMediaTask(
      assertRelayProfile(profile, protocol),
      {
        capability: task.kind,
        externalTaskId: providerTaskId,
        providerProtocol: "media-generate",
      },
      { signal, usePinnedTransport: true },
    );
    if (status.state === "success") return "success";
    if (status.state === "failed") return "failed";
    return "running";
  }
  if (protocol === "native" && task.kind === "video") {
    const profile = await taskProviderSnapshotProfile(task, task.ownerId);
    const status = await getVolcengineArkVideoTask(
      profile,
      providerTaskId,
      fetch,
      signal,
    );
    if (status.state === "succeeded") return "success";
    if (status.state === "failed" || status.state === "cancelled") return "failed";
    return "running";
  }
  if (protocol === "native" && task.kind === "audio") {
    const profile = await taskProviderSnapshotProfile(task, task.ownerId);
    const status = await getMurekaAudioTask(
      profile,
      providerTaskId,
      "song",
      fetch,
      signal,
    );
    if (status.state === "succeeded") return "success";
    if (status.state === "failed" || status.state === "cancelled") return "failed";
    return "running";
  }
  if (task.kind !== "text") {
    try {
      const profile = await taskProviderSnapshotProfile(task, task.ownerId);
      const status = await pollRelayMediaTask(
        assertRelayProfile(profile, "media-generate"),
        {
          capability: task.kind === "audio" || task.kind === "video"
            ? task.kind
            : "image",
          externalTaskId: providerTaskId,
          providerProtocol: "media-generate",
        },
        { signal, usePinnedTransport: true },
      );
      if (status.state === "success") return "success";
      if (status.state === "failed") return "failed";
      return "running";
    } catch {
      return "cannot-query";
    }
  }
  return "cannot-query";
}

export async function generationTasks(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const path = decodedRequestPath(request).replace(
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
    const availability = await generationAvailability(
      identity.bypass ? "__test__" : identity.userId,
    );
    const { providerCurrencies, ...publicAvailability } = availability;
    json(response, 200, {
      emergencyStop: safety.emergencyStop,
      globalGenerationEnabled: safety.globalEnabled,
      ...publicAvailability,
      persistentQueueReady: true,
      protectionReady: true,
      submissionEnabled:
        availability.providerConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop,
      audioSubmissionEnabled:
        availability.audioProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop,
      imageSubmissionEnabled:
        availability.imageProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop,
      textSubmissionEnabled:
        availability.textProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop,
      videoSubmissionEnabled:
        availability.videoProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop,
    });
    return;
  }

  if (request.method === "GET" && path === "") {
    const requestUrl = new URL(request.url ?? "", "http://127.0.0.1");
    const canvasId = requestUrl.searchParams.get("canvasId") ?? "";
    try {
      const generationStore = taskStore();
      const ownerId = identity.bypass ? undefined : identity.userId;
      const tasks = identity.bypass
        ? generationStore.list(canvasId)
        : generationStore.listForOwner(canvasId, identity.userId);
      const bindings = tasks.some(({ state }) => state === "failed")
        ? generationStore.retryBindingsForCanvas(canvasId, ownerId)
        : new Map<string, GenerationTaskCanvasRetryBinding>();
      json(response, 200, {
        tasks: tasks.map((task) => taskSummary(task, bindings.get(task.id))),
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
      json(response, 200, taskSummaryForOwner(
        task,
        identity.bypass ? undefined : identity.userId,
      ));
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
    try {
      await cancelGenerationTask(task);
      const cancelled = taskStore().get(path);
      if (!cancelled) throw new Error("Generation task not found");
      json(response, 200, taskSummaryForOwner(
        cancelled,
        identity.bypass ? undefined : identity.userId,
      ));
    } catch (error) {
      if (
        error instanceof Error &&
        (error as { code?: string }).code === "PROVIDER_CANCEL_UNAVAILABLE"
      ) {
        json(response, 409, {
          code: "PROVIDER_CANCEL_UNAVAILABLE",
          error: error.message,
        });
        return;
      }
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

  const abandonMatch = path.match(/^([a-z0-9._-]+)\/abandon$/i);
  if (request.method === "POST" && abandonMatch) {
    const taskId = abandonMatch[1];
    const task = identity.bypass
      ? taskStore().get(taskId)
      : taskStore().getForOwner(taskId, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    try {
      const body = await readJsonBody<{
        acknowledgeRemoteResultMayBeLost?: unknown;
        expectedAttempt?: unknown;
        expectedUpdatedAt?: unknown;
      }>(request, 2 * 1_024);
      if (
        body.acknowledgeRemoteResultMayBeLost !== true ||
        !Number.isSafeInteger(body.expectedAttempt) ||
        Number(body.expectedAttempt) < 1 ||
        typeof body.expectedUpdatedAt !== "string"
      ) {
        json(response, 400, {
          code: "ABANDON_ACK_REQUIRED",
          error: "必须确认将不再尝试恢复该平台结果",
        });
        return;
      }
      const abandoned = taskStore().abandonAcceptedProviderTask({
        expectedAttempt: Number(body.expectedAttempt),
        expectedUpdatedAt: body.expectedUpdatedAt,
        taskId,
      });
      if (!abandoned) throw new Error("Generation task not found");
      json(response, 200, taskSummaryForOwner(
        abandoned,
        identity.bypass ? undefined : identity.userId,
      ));
    } catch (error) {
      if (error instanceof GenerationTaskAbandonError) {
        json(response, 409, {
          code: error.code,
          error: error.message,
        });
        return;
      }
      json(response, 409, {
        code: "PROVIDER_RESULT_NOT_ABANDONABLE",
        error: "Generation task cannot be abandoned",
      });
    }
    return;
  }

  const retryMatch = path.match(/^([a-z0-9._-]+)\/retry$/i);
  if (request.method === "POST" && retryMatch) {
    const taskId = retryMatch[1];
    const body = await readJsonBody<{
      canvasId?: unknown;
      expectedAttempt?: unknown;
      expectedCanvasRevision?: unknown;
      expectedGenerationInputKey?: unknown;
      expectedUpdatedAt?: unknown;
      kind?: unknown;
      nodeId?: unknown;
    }>(request, 256 * 1_024);
    if (
      typeof body.canvasId !== "string" ||
      !/^[a-z0-9._-]{1,120}$/i.test(body.canvasId) ||
      !Number.isSafeInteger(body.expectedAttempt) ||
      Number(body.expectedAttempt) < 0 ||
      !Number.isSafeInteger(body.expectedCanvasRevision) ||
      Number(body.expectedCanvasRevision) < 0 ||
      typeof body.expectedGenerationInputKey !== "string" ||
      body.expectedGenerationInputKey.length < 1 ||
      body.expectedGenerationInputKey.length > 100_000 ||
      typeof body.expectedUpdatedAt !== "string" ||
      body.expectedUpdatedAt.length < 1 ||
      body.expectedUpdatedAt.length > 80 ||
      (body.kind !== "text" &&
        body.kind !== "image" &&
        body.kind !== "video" &&
        body.kind !== "audio") ||
      typeof body.nodeId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(body.nodeId)
    ) {
      json(response, 400, {
        code: "RETRY_FENCE_REQUIRED",
        error: "重试请求缺少当前画布与任务绑定证据",
      });
      return;
    }
    const task = identity.bypass
      ? taskStore().get(taskId)
      : taskStore().getForOwner(taskId, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    if (
      task.canvasId !== body.canvasId ||
      task.nodeId !== body.nodeId ||
      task.kind !== body.kind
    ) {
      json(response, 409, {
        code: "RETRY_BINDING_STALE",
        error: "任务已不再绑定当前画布节点",
      });
      return;
    }
    if (
      task.attempt !== Number(body.expectedAttempt) ||
      task.updatedAt !== body.expectedUpdatedAt
    ) {
      json(response, 409, {
        code: "RETRY_TASK_CHANGED",
        error: "任务状态已变化，请刷新后再试",
      });
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
        const lease = await acquireProviderGenerationRequestLease(
          task.providerProfileId,
          task.ownerId ?? "",
        );
        try {
          requireTaskProviderSnapshot(
            task,
            lease.profile,
            lease.credentialRevision,
          );
        } finally {
          lease.release();
        }
      } catch {
        json(response, 409, {
          code: "PROVIDER_CONFIGURATION_MISMATCH",
          error: "平台连接已变化，请在节点重新提交，不能继续旧任务",
        });
        return;
      }
    }
    let paidRetrySnapshot: GenerationPaidRetrySnapshot | undefined;
    if (retry.mode === "new-provider-attempt") {
      const runtime = await generationRuntimeDecision({
        canSubmit: true,
        kind: task.kind,
        model: retry.model,
        ownerId: identity.bypass ? "__test__" : identity.userId,
      });
      const runtimeProblem = preAdmissionRuntimeProblem(runtime);
      if (runtimeProblem) {
        json(response, 409, {
          code: runtimeProblem.code,
          error: runtimeProblem.message,
        });
        return;
      }
      if (
        !runtime.providerProfile ||
        !Number.isSafeInteger(runtime.credentialVersion) ||
        Number(runtime.credentialVersion) < 1
      ) {
        json(response, 409, {
          code: "ACCOUNT_CREDENTIAL_CHANGED",
          error: "平台密钥版本已变化，请按当前配置重试",
        });
        return;
      }
      paidRetrySnapshot = {
        credentialRevision: Number(runtime.credentialVersion),
        modelConfiguration: {
          credentialVersion: Number(runtime.credentialVersion),
          modelId: retry.model.id,
          parameterSchema: generationModelSchema(task.kind, retry.model),
          providerConfigurationVersion: providerConfigurationVersion(
            runtime.providerProfile,
          ),
          providerDriver: retry.model.provider_driver,
          providerModelId: retry.model.provider_model_id,
          providerProtocol: retry.model.provider_protocol ?? "native",
          providerProfileId: retry.model.provider_profile_id,
        },
        providerModelId: retry.model.provider_model_id,
        providerProfileId: retry.model.provider_profile_id,
      };
    }
    let queued: GenerationTask | undefined;
    try {
      queued = retry.mode === "resume-provider-task"
        ? taskStore().admitRetry({
            canvasId: body.canvasId,
            expectedAttempt: Number(body.expectedAttempt),
            expectedCanvasRevision: Number(body.expectedCanvasRevision),
            expectedGenerationInputKey: body.expectedGenerationInputKey,
            expectedUpdatedAt: body.expectedUpdatedAt,
            kind: body.kind,
            mode: "resume-provider-task",
            nodeId: body.nodeId,
            taskId,
          })
        : taskStore().admitRetry({
            canvasId: body.canvasId,
            expectedAttempt: Number(body.expectedAttempt),
            expectedCanvasRevision: Number(body.expectedCanvasRevision),
            expectedGenerationInputKey: body.expectedGenerationInputKey,
            expectedUpdatedAt: body.expectedUpdatedAt,
            kind: body.kind,
            mode: "new-paid-attempt",
            nodeId: body.nodeId,
            snapshot: paidRetrySnapshot!,
            taskId,
          });
      if (!queued) {
        json(response, 409, {
          code: "RETRY_TASK_CHANGED",
          error: "任务状态已变化，请刷新后再试",
        });
        return;
      }
    } catch (error) {
      if (canvasRevisionConflict(response, error)) {
        // The final BEGIN IMMEDIATE fence observed a newer durable graph.
      } else if (error instanceof GenerationTaskRetryFenceError) {
        json(response, 409, { code: error.code, error: error.message });
      } else if (error instanceof GenerationTaskAdmissionError) {
        json(response, 409, { code: error.code, error: error.message });
      } else if (error instanceof GenerationProviderAttemptBlockedError) {
        json(response, 409, { code: error.code, error: error.message });
      } else if (error instanceof GenerationTaskOwnerDeletingError) {
        json(response, 409, { code: error.code, error: error.message });
      } else if (error instanceof GenerationTaskTransitionError) {
        json(response, 409, {
          code: "RETRY_TASK_CHANGED",
          error: "任务状态已变化，请刷新后再试",
        });
      } else {
        json(response, 500, {
          code: "GENERATION_RETRY_FAILED",
          error: "生成任务重试暂时无法处理，请核对任务状态后再试",
        });
      }
      return;
    }
    let summary: ReturnType<typeof taskSummaryForOwner>;
    try {
      launchGenerationTask(taskId, task.kind);
      summary = taskSummaryForOwner(
        queued,
        identity.bypass ? undefined : identity.userId,
      );
    } catch {
      // admitRetry already committed. A 5xx lets the client reconcile the exact
      // task without issuing a second retry mutation.
      json(response, 500, {
        code: "GENERATION_RETRY_ACCEPTED_RESPONSE_FAILED",
        error: "重试已提交，任务响应暂不可用，请等待状态核对",
      });
      return;
    }
    json(response, 202, summary);
    return;
  }

  const reconcileMatch = path.match(/^([a-z0-9._-]+)\/reconcile$/i);
  if (request.method === "POST" && reconcileMatch) {
    const taskId = reconcileMatch[1];
    const body = await readJsonBody<{
      canvasId?: unknown;
      expectedAttempt?: unknown;
      expectedCanvasRevision?: unknown;
      expectedGenerationInputKey?: unknown;
      expectedUpdatedAt?: unknown;
      kind?: unknown;
      nodeId?: unknown;
      providerTaskId?: unknown;
    }>(request, 16 * 1_024);
    if (
      typeof body.canvasId !== "string" ||
      !/^[a-z0-9._-]{1,120}$/i.test(body.canvasId) ||
      !Number.isSafeInteger(body.expectedAttempt) ||
      Number(body.expectedAttempt) < 0 ||
      !Number.isSafeInteger(body.expectedCanvasRevision) ||
      Number(body.expectedCanvasRevision) < 0 ||
      typeof body.expectedGenerationInputKey !== "string" ||
      body.expectedGenerationInputKey.length < 1 ||
      body.expectedGenerationInputKey.length > 100_000 ||
      typeof body.expectedUpdatedAt !== "string" ||
      body.expectedUpdatedAt.length < 1 ||
      body.expectedUpdatedAt.length > 80 ||
      (body.kind !== "text" &&
        body.kind !== "image" &&
        body.kind !== "video" &&
        body.kind !== "audio") ||
      typeof body.nodeId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(body.nodeId)
    ) {
      json(response, 400, {
        code: "RECONCILE_FENCE_REQUIRED",
        error: "核对请求缺少当前画布与任务绑定证据",
      });
      return;
    }
    const providedTaskId = typeof body.providerTaskId === "string"
      ? body.providerTaskId.trim()
      : "";
    if (
      providedTaskId &&
      (!/^[a-z0-9._:-]{1,160}$/i.test(providedTaskId))
    ) {
      json(response, 400, {
        code: "PROVIDER_TASK_ID_INVALID",
        error: "平台任务号格式不正确",
      });
      return;
    }
    const task = identity.bypass
      ? taskStore().get(taskId)
      : taskStore().getForOwner(taskId, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    if (
      task.canvasId !== body.canvasId ||
      task.nodeId !== body.nodeId ||
      task.kind !== body.kind
    ) {
      json(response, 409, {
        code: "RETRY_BINDING_STALE",
        error: "任务已不再绑定当前画布节点",
      });
      return;
    }
    if (
      task.attempt !== Number(body.expectedAttempt) ||
      task.updatedAt !== body.expectedUpdatedAt
    ) {
      json(response, 409, {
        code: "RETRY_TASK_CHANGED",
        error: "任务状态已变化，请刷新后再试",
      });
      return;
    }
    if (task.state !== "failed") {
      json(response, 409, {
        code: "TASK_NOT_FAILED",
        error: "只有失败任务可以核对结果",
      });
      return;
    }
    const now = Date.now();
    const previous = lastReconcileAt.get(task.id) ?? 0;
    if (now - previous < reconcileCooldownMs) {
      json(response, 429, {
        code: "RECONCILE_RATE_LIMIT",
        error: "核对太频繁，请稍后再试",
      });
      return;
    }
    lastReconcileAt.set(task.id, now);
    let current = task;
    if (providedTaskId && !current.providerTaskId) {
      try {
        current = taskStore().bindProviderTaskIdOnFailedTask({
          providerTaskId: providedTaskId,
          taskId: current.id,
        });
      } catch {
        json(response, 409, {
          code: "PROVIDER_TASK_ID_CONFLICT",
          error: "无法绑定这个平台任务号",
        });
        return;
      }
    }
    if (!current.providerTaskId) {
      let match: Awaited<ReturnType<typeof autoMatchRelayProviderTask>>;
      try {
        match = await autoMatchRelayProviderTask(current);
      } catch {
        json(response, 200, {
          outcome: "check-failed",
          task: taskSummaryForOwner(
            current,
            identity.bypass ? undefined : identity.userId,
          ),
        });
        return;
      }
      if (match.status === "many") {
        json(response, 200, {
          outcome: "ambiguous",
          task: taskSummaryForOwner(
            current,
            identity.bypass ? undefined : identity.userId,
          ),
        });
        return;
      }
      if (match.status === "one") {
        try {
          current = taskStore().bindProviderTaskIdOnFailedTask({
            providerTaskId: match.record.taskId,
            taskId: current.id,
          });
        } catch {
          json(response, 200, {
            outcome: "check-failed",
            task: taskSummaryForOwner(
              current,
              identity.bypass ? undefined : identity.userId,
            ),
          });
          return;
        }
      }
    }
    if (!current.providerTaskId) {
      try {
        current = taskStore().confirmRemoteResultMissing({
          expectedUpdatedAt: current.updatedAt,
          taskId: current.id,
        });
      } catch {
        json(response, 409, {
          code: "RETRY_TASK_CHANGED",
          error: "任务状态已变化，请刷新后再试",
        });
        return;
      }
      json(response, 200, {
        outcome: "missing",
        task: taskSummaryForOwner(
          current,
          identity.bypass ? undefined : identity.userId,
        ),
      });
      return;
    }
    let pollState: ReconcilePollState;
    const pollController = new AbortController();
    const pollTimer = setTimeout(() => pollController.abort(), 20_000);
    try {
      pollState = await pollReconcileProviderTask(
        current,
        current.providerTaskId,
        pollController.signal,
      );
    } catch {
      json(response, 200, {
        outcome: "check-failed",
        task: taskSummaryForOwner(
          current,
          identity.bypass ? undefined : identity.userId,
        ),
      });
      return;
    } finally {
      clearTimeout(pollTimer);
    }
    if (pollState === "cannot-query") {
      json(response, 200, {
        outcome: "check-failed",
        task: taskSummaryForOwner(
          current,
          identity.bypass ? undefined : identity.userId,
        ),
      });
      return;
    }
    if (pollState === "running") {
      json(response, 200, {
        outcome: "still-running",
        task: taskSummaryForOwner(
          current,
          identity.bypass ? undefined : identity.userId,
        ),
      });
      return;
    }
    if (pollState === "failed") {
      try {
        current = taskStore().confirmRemoteResultMissing({
          expectedUpdatedAt: current.updatedAt,
          taskId: current.id,
        });
      } catch {
        json(response, 409, {
          code: "RETRY_TASK_CHANGED",
          error: "任务状态已变化，请刷新后再试",
        });
        return;
      }
      json(response, 200, {
        outcome: "missing",
        task: taskSummaryForOwner(
          current,
          identity.bypass ? undefined : identity.userId,
        ),
      });
      return;
    }
    let queued: GenerationTask | undefined;
    try {
      queued = taskStore().admitRetry({
        canvasId: body.canvasId,
        expectedAttempt: current.attempt,
        expectedCanvasRevision: Number(body.expectedCanvasRevision),
        expectedGenerationInputKey: body.expectedGenerationInputKey,
        expectedUpdatedAt: current.updatedAt,
        kind: body.kind,
        mode: "resume-provider-task",
        nodeId: body.nodeId,
        taskId: current.id,
      });
    } catch (error) {
      if (canvasRevisionConflict(response, error)) return;
      json(response, 409, {
        code: "RECONCILE_RESUME_FAILED",
        error: error instanceof Error ? error.message : "无法收回平台结果",
      });
      return;
    }
    if (!queued) {
      json(response, 409, {
        code: "RETRY_TASK_CHANGED",
        error: "任务状态已变化，请刷新后再试",
      });
      return;
    }
    try {
      launchGenerationTask(queued.id, queued.kind);
    } catch {
      json(response, 500, {
        code: "GENERATION_RETRY_ACCEPTED_RESPONSE_FAILED",
        error: "结果收回已开始，请等待状态核对",
      });
      return;
    }
    json(response, 200, {
      outcome: "recovered",
      task: taskSummaryForOwner(
        queued,
        identity.bypass ? undefined : identity.userId,
      ),
    });
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
    json(response, 200, taskSummaryForOwner(
      task,
      identity.bypass ? undefined : identity.userId,
    ));
    return;
  }

  if (request.method === "POST" && path === "preflight") {
    try {
      const body = await readJsonBody<NodeInputGenerationRequest>(
        request,
        64 * 1_024,
      );
      if (
        body.kind !== "text" &&
        body.kind !== "image" &&
        body.kind !== "video" &&
        body.kind !== "audio"
      ) {
        json(response, 400, { error: "输入类型无效" });
        return;
      }
      const model = resolveModel(
        body.kind,
        body.model,
        identity.bypass ? "__test__" : identity.userId,
      );
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
      if (error instanceof HttpRequestError) throw error;
      if (canvasRevisionConflict(response, error)) return;
      json(response, 400, {
        error: error instanceof Error ? error.message : "提交前检查失败",
      });
    }
    return;
  }

  if (request.method === "POST" && (path === "" || path === "/")) {
    try {
      const body = await readJsonBody<NodeInputGenerationRequest>(
        request,
        64 * 1_024,
      );
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
      const ownerId = identity.bypass ? "__test__" : identity.userId;
      const idempotencyKey = String(body.idempotencyKey ?? "");
      const requestIntent = generationRequestIntent(body, body.kind);
      const existing = taskStore().getIdempotentIntent({
        canvasId: String(body.canvasId ?? ""),
        idempotencyKey,
        ownerId,
        requestIntent,
      });
      if (existing) {
        json(response, 200, taskSummaryForOwner(
          existing,
          identity.bypass ? undefined : identity.userId,
        ));
        return;
      }
      const model = resolveModel(
        body.kind,
        body.model,
        ownerId,
      );
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
      const runtimeProblem = preAdmissionRuntimeProblem(runtime);
      if (runtimeProblem || !runtime.providerProfile) {
        const problem = runtimeProblem ?? {
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
      const created = taskStore().admitOrGet({
        canvasId: String(body.canvasId ?? ""),
        credentialRevision: runtime.credentialVersion,
        expectedCanvasRevision: body.canvasRevision,
        estimatedCostMicrounits: taskAuditEstimatedCostMicrounits[
          model.cost_currency
        ],
        costCurrency: model.cost_currency,
        idempotencyKey,
        kind: body.kind,
        model: model.id,
        modelConfiguration: {
          credentialVersion: runtime.credentialVersion,
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
        requestIntent,
      });
      try {
        injectInitialGenerationPostCommitFailure(request);
        if (created.created) {
          launchGenerationTask(created.task.id, body.kind);
        }
        json(
          response,
          created.created ? 202 : 200,
          taskSummaryForOwner(
            created.task,
            identity.bypass ? undefined : identity.userId,
          ),
        );
      } catch {
        // admitOrGet already committed. A 5xx makes the browser reconcile this
        // exact owner-scoped idempotency key instead of minting a second paid
        // task. If the socket itself is gone, the network failure has the same
        // reconcilable meaning and must not escape into the outer 4xx mapper.
        try {
          json(response, 500, {
            code: "GENERATION_TASK_ACCEPTED_RESPONSE_FAILED",
            error: "生成任务已提交，响应暂不可用，请等待状态核对",
          });
        } catch {}
      }
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (canvasRevisionConflict(response, error)) {
        return;
      } else if (error instanceof GenerationTaskConflictError) {
        json(response, 409, {
          code: "IDEMPOTENCY_CONFLICT",
          error: error.message,
        });
      } else if (error instanceof GenerationTaskOwnerDeletingError) {
        json(response, 409, {
          code: error.code,
          error: "账号删除正在进行，不能再创建或重试生成任务",
        });
      } else if (error instanceof GenerationTaskAdmissionError) {
        json(response, 409, {
          code: error.code,
          error: error.message,
        });
      } else if (error instanceof GenerationProviderAttemptBlockedError) {
        json(response, 409, {
          code: error.code,
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
