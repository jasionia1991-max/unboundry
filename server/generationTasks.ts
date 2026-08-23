import { statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  imageReferenceForProvider,
  saveGeneratedPng,
  validatePng,
} from "./assetStorage";
import {
  arkFilesEnabled,
  arkFilesImageMaximumBytes,
  arkFilesImageThresholdBytes,
  ArkFilesError,
  prepareArkImageFile,
  type ArkImageBytesInput,
} from "./arkFileUploader";
import { createPrivateAliyunOssReadUrl } from "./aliyunOss";
import { appDataDirectory, openAppDatabase } from "./database";
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
  commitGenerationMediaOutputSet,
  commitGenerationAlternateMediaResult,
  commitGenerationMediaResult,
  commitGenerationTextResult,
  publishGenerationMediaCandidate,
  recoverPendingGenerationMediaResults,
} from "./generationResultCommit";
import {
  generateOpenRouterImage,
  OpenRouterImageError,
} from "./openRouterImageProvider";
import {
  publishedGenerationMediaCandidateIds,
  readableMediaForOwner,
  readyGenerationMediaOutputs,
  readyMediaForOwner,
  type MediaRecord,
} from "./mediaRegistry";
import { ResourceBudgetError } from "./resourceBudget";
import {
  arkVideoBase64BudgetBytes,
  arkVideoBase64Bytes,
  arkVideoBase64EnvelopeBytes,
  arkVideoMediaProblem,
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
  acquireProviderGenerationSnapshot,
  getProviderGenerationProfileState,
  providerConfigurationVersion,
  ProviderGenerationConfigurationError,
  ProviderProfileLockBusyError,
  type ProviderGenerationRequestLease,
  type ProviderProfile,
  type ProviderGenerationSnapshot,
} from "./providerProfiles";
import {
  evaluateModelRuntimeAvailability,
  modelGenerationAdapterSupported,
} from "./modelAvailability";
import { saveGeneratedMp4 } from "./videoStorage";
import { saveGeneratedAudio, saveGeneratedMp3 } from "./audioStorage";
import {
  downloadMurekaAudioResult,
  MurekaAudioError,
  type MurekaAudioQueryKind,
} from "./murekaAudioProvider";
import {
  defaultArkVideoLimits,
  seedanceMiniAudioPriceMicrounitsPerThousandTokens,
  type ArkVideoLimits,
  type ArkVideoMediaInput,
  VolcengineArkVideoError,
} from "./volcengineArkVideoProvider";
import {
  prepareRelayGptImageRequest,
  RelayProviderError,
  type RelayMediaParamValue,
  type RelayTransientMediaOutput,
} from "./relayProviderAdapters";
import {
  relayMediaModelContract,
  relayMediaPollingDecision,
  relayMediaSubmissionAction,
} from "./relayMediaModelContracts";
import {
  isTextGenerationProtocol,
  TextGenerationProviderError,
  type TextGenerationProviderExecution,
  type TextGenerationInput,
  type TextGenerationRequest,
} from "./generationProvider";
import type { TextProviderRegistry } from "./providerGenerationTextRuntime";
import {
  downloadProviderResultMedia,
  ProviderResultMediaError,
} from "./providerResultMedia";
import type {
  MediaGenerationExecution,
  MediaGenerationRequest,
  MediaGenerationSubmission,
  MediaProviderCancellation,
  MediaProviderTaskSnapshot,
  NormalizedMediaProviderOutput,
  NormalizedMediaProviderResult,
} from "./mediaGenerationProvider";
import { normalizeProviderImageToPng } from "./providerImageNormalization";
import {
  listRelayUsageRecords,
  matchRelayUsageRecord,
} from "./relayUsageReconcile";
import {
  hasPendingGeneratedMediaPublications,
  hasPendingMediaDeletions,
  hasPendingUploadMediaPublications,
  MediaPublicationConflictError,
  MediaPublicationStateError,
  pendingGeneratedPublicationTaskIds,
  recoverPendingMediaDeletions,
  recoverPendingUploadMediaPublications,
  cleanupPublicationStaging,
  type MediaPublicationReservation,
} from "./mediaPublicationService";
import {
  StorageConfigurationBusyError,
  storageProfileForMedia,
} from "./secureStorageProfiles";
import {
  cleanParameterSchema,
  knownModelParameterSchema,
  providerParameterSchema,
  validateParameterSchemaConstraints,
  validateParameterValues,
  youchuangGptImageSizes,
  type GptImageSizeMap,
  type GptImageSizeTier,
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
import {
  imageToolMaximums,
  type ImageGenerationToolInput,
} from "../types/imageTools";
import type { RuntimeRoleCoordinator } from "./runtimeRole";

export type GenerationRuntimeAdapters = Readonly<{
  arkVideo: Readonly<{
    cancel: (
      profile: ProviderProfile,
      providerTaskId: string,
      execution: MediaGenerationExecution,
    ) => Promise<MediaProviderCancellation>;
    inspect: (
      profile: ProviderProfile,
      providerTaskId: string,
      execution: MediaGenerationExecution,
    ) => Promise<MediaProviderTaskSnapshot>;
    normalize: (
      profile: ProviderProfile,
      rawResult: unknown,
    ) => NormalizedMediaProviderResult;
    submit: (
      profile: ProviderProfile,
      request: MediaGenerationRequest,
      execution: MediaGenerationExecution,
    ) => Promise<MediaGenerationSubmission>;
  }>;
  murekaAudio: Readonly<{
    inspect: (
      profile: ProviderProfile,
      providerTaskId: string,
      execution: MediaGenerationExecution,
    ) => Promise<MediaProviderTaskSnapshot>;
    normalize: (
      profile: ProviderProfile,
      rawResult: unknown,
    ) => NormalizedMediaProviderResult;
    submit: (
      profile: ProviderProfile,
      request: MediaGenerationRequest,
      execution: MediaGenerationExecution,
    ) => Promise<MediaGenerationSubmission>;
  }>;
  relayMedia: Readonly<{
    inspect: (
      profile: ProviderProfile,
      kind: "audio" | "image" | "video",
      providerTaskId: string,
      execution: MediaGenerationExecution,
    ) => Promise<MediaProviderTaskSnapshot>;
    normalize: (
      profile: ProviderProfile,
      kind: "audio" | "image" | "video",
      rawResult: unknown,
    ) => NormalizedMediaProviderResult;
    submit: (
      profile: ProviderProfile,
      request: MediaGenerationRequest,
      execution: MediaGenerationExecution,
    ) => Promise<MediaGenerationSubmission>;
  }>;
  text: (
    profile: ProviderProfile,
    request: TextGenerationRequest,
    execution: Omit<TextGenerationProviderExecution, "profile">,
    registry?: TextProviderRegistry,
  ) => ReturnType<TextProviderRegistry["generate"]>;
}>;

let configuredRuntimeAdapters: GenerationRuntimeAdapters | undefined;

export function configureGenerationRuntimeAdapters(
  adapters: GenerationRuntimeAdapters,
) {
  if (configuredRuntimeAdapters && configuredRuntimeAdapters !== adapters) {
    throw new Error("Generation runtime adapters are already configured");
  }
  configuredRuntimeAdapters = adapters;
}

function generationRuntimeAdapters() {
  if (!configuredRuntimeAdapters) {
    throw new Error("Generation runtime adapters are not configured");
  }
  return configuredRuntimeAdapters;
}

let store: ReturnType<typeof createGenerationTaskStore> | undefined;
let storeDataDirectory: string | undefined;
let persistentGenerationWorkerStartup:
  | Promise<PersistentGenerationWorkerStartupResult>
  | undefined;
let persistentGenerationWorkerCoordinator: RuntimeRoleCoordinator | undefined;
let persistentGenerationWorkerDataDirectory: string | undefined;
const launchedGenerationTasks = new Set<string>();
const pendingGenerationRelaunches = new Map<string, GenerationTask["kind"]>();
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
    runningTextRequests.size !== 0 || pendingGenerationRelaunches.size !== 0
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
  pendingGenerationRelaunches.clear();
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
    runningTextRequests.size !== 0 || pendingGenerationRelaunches.size !== 0
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

function snapshotGptImageSizeMap(
  task: Pick<GenerationTask, "modelConfiguration">,
): GptImageSizeMap | undefined {
  const raw = task.modelConfiguration.parameterSchema;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return (raw as ModelParameterSchema).sizeMap;
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
  executeForTest?: (
    taskId: string,
    kind: GenerationTask["kind"],
  ) => Promise<void>;
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
          if (recoverGenerated) {
            const outcomes = await recoverPendingGenerationMediaResults();
            for (const taskId of new Set(
              outcomes
                .filter((outcome) => outcome.action === "finalized")
                .map((outcome) => outcome.taskId),
            )) {
              const recovered = store?.get(taskId);
              if (
                recovered?.state === "recovering" &&
                recovered.providerTaskId &&
                taskProviderProtocol(recovered) === "media-generate"
              ) {
                store!.resume(taskId);
                launchGenerationTask(taskId, recovered.kind, launchOptions);
              }
            }
          }
        },
        () => undefined,
      )
    ).catch(() => undefined);
  }
  ensureGenerationRecoverySweep();
  void runGenerationRecoverySweep().catch(() => undefined);
  return store;
}

let generationRecoverySweepTimer: NodeJS.Timeout | undefined;

function ensureGenerationRecoverySweep() {
  if (
    generationRecoverySweepTimer ||
    process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP === "1"
  ) {
    return;
  }
  generationRecoverySweepTimer = setInterval(() => {
    void runGenerationRecoverySweep().catch(() => undefined);
  }, 30_000);
  generationRecoverySweepTimer.unref?.();
}

/**
 * Server-side safety net: any failed task that still holds an accepted
 * Provider task id gets one automatic resume (never a new paid request).
 * This guarantees re-collection does not depend on the browser being open
 * or on the user tapping a button.
 */
export async function runGenerationRecoverySweep(options?: {
  launch?: (taskId: string, kind: GenerationTask["kind"]) => void;
  store?: ReturnType<typeof createGenerationTaskStore>;
}) {
  const launch = options?.launch ?? launchGenerationTask;
  const store = options?.store ?? taskStore();
  // 失败不足两分钟的任务先交给正在运行的轮询/自动重试通道，
  // 避免前后端在同一窗口内重复抢同一个任务。
  const olderThan = new Date(Date.now() - 2 * 60_000);
  for (const task of store.listFailedAutoRecoverable(olderThan)) {
    if (task.attempt >= 2 || task.state !== "failed") continue;
    const retry = retrySafetyDecision(
      task,
      store.getProviderAttemptForTask(task.id),
      store.hasUnsafeProviderAttemptForNewPaidRetry(task.id),
    );
    if (!retry.allowed || retry.mode !== "resume-provider-task") continue;
    if (resumeProviderTaskSnapshotProblem(task)) continue;
    const binding = store
      .retryBindingsForCanvas(task.canvasId, task.ownerId ?? undefined)
      .get(task.id);
    if (!binding) continue;
    try {
      const queued = store.admitRetry({
        canvasId: task.canvasId,
        expectedAttempt: task.attempt,
        expectedCanvasRevision: binding.canvasRevision,
        expectedGenerationInputKey: binding.generationInputKey,
        expectedUpdatedAt: task.updatedAt,
        kind: task.kind,
        mode: "resume-provider-task",
        nodeId: task.nodeId,
        taskId: task.id,
      });
      if (queued) launch(task.id, task.kind);
    } catch {
      // A concurrent terminal/fence transition wins; never force a paid retry.
    }
  }
  // Safety net: a committed task that is still queued after a grace period
  // means its launch was skipped (for example an automatic retry requested
  // while the previous execution was still registered). Relaunching is
  // idempotent: an in-flight execution makes launchGenerationTask defer, and
  // a task that already moved to running is no longer listed as queued.
  for (const task of store.listQueued()) {
    if (task.updatedAt > olderThan.toISOString()) continue;
    launch(task.id, task.kind);
  }
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
  const resultOutputs = task.kind !== "text" && publishedResultAssetId &&
      task.ownerId && resultMedia
    ? readyGenerationMediaOutputs({
        executionAttempt: task.attempt,
        kind: task.kind,
        ownerId: task.ownerId,
        primaryAssetId: publishedResultAssetId,
        taskId: task.id,
      })
    : [];
  const resultUrlFor = (assetId: string) => task.kind === "video"
    ? `/api/video-assets/${assetId}`
    : task.kind === "audio"
      ? `/api/audio-assets/${assetId}`
      : `/api/assets/${assetId}`;
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
    resultOutputs: resultOutputs.map((output) => ({
      assetId: output.assetId,
      media: {
        byteSize: output.byteSize,
        contentType: output.contentType,
        durationSeconds: output.durationSeconds,
        durationStatus: output.durationStatus,
        mediaHeight: output.mediaHeight,
        mediaWidth: output.mediaWidth,
        storageBackend: output.storageBackend,
      },
      role: output.role,
      url: resultUrlFor(output.assetId),
    })),
    resultUrl: resultMedia && publishedResultAssetId
      ? resultUrlFor(publishedResultAssetId)
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
  imageTool?: ImageGenerationToolInput;
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
    imageTool: body.imageTool,
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

const generationImageToolOperations = new Set<ImageGenerationToolInput["operation"]>([
  "enhance-creative",
  "erase",
  "multi-angle",
  "outpaint",
  "redraw",
  "remove-background",
]);

function storedImageGenerationTool(value: unknown): ImageGenerationToolInput | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid image tool snapshot");
  }
  const item = value as Partial<ImageGenerationToolInput>;
  if (
    !item.operation ||
    !generationImageToolOperations.has(item.operation) ||
    typeof item.operationId !== "string" ||
    !/^[a-z0-9._-]{1,160}$/i.test(item.operationId) ||
    typeof item.sourceAssetId !== "string" ||
    !/^[a-z0-9._-]{1,160}$/i.test(item.sourceAssetId) ||
    typeof item.sourceNodeId !== "string" ||
    !/^[a-z0-9._-]{1,160}$/i.test(item.sourceNodeId)
  ) throw new Error("Invalid image tool snapshot");
  const requiresMask = item.operation === "redraw" || item.operation === "erase" ||
    item.operation === "outpaint";
  if (!item.mask) {
    if (requiresMask) throw new Error("Invalid image tool mask snapshot");
    if (item.preparedInput !== undefined || item.outpaint !== undefined) {
      throw new Error("Invalid image tool outpaint snapshot");
    }
    return {
      operation: item.operation,
      operationId: item.operationId,
      sourceAssetId: item.sourceAssetId,
      sourceNodeId: item.sourceNodeId,
    };
  }
  const mask = item.mask;
  if (
    !requiresMask ||
    typeof mask.assetId !== "string" ||
    !/^[a-z0-9._-]{1,160}$/i.test(mask.assetId) ||
    mask.version !== 1 ||
    !Number.isSafeInteger(mask.width) || mask.width < 1 || mask.width > 8_192 ||
    !Number.isSafeInteger(mask.height) || mask.height < 1 || mask.height > 8_192 ||
    !Number.isSafeInteger(mask.featherPixels) ||
    mask.featherPixels < 0 || mask.featherPixels > 64
  ) throw new Error("Invalid image tool mask snapshot");
  const outpaint = item.outpaint;
  const preparedInput = item.preparedInput;
  if (item.operation === "outpaint") {
    if (!outpaint || !preparedInput || outpaint.version !== 1 ||
        preparedInput.version !== 1 ||
        !/^[a-z0-9._-]{1,160}$/i.test(preparedInput.assetId) ||
        !Number.isSafeInteger(preparedInput.width) ||
        !Number.isSafeInteger(preparedInput.height) ||
        preparedInput.width !== mask.width || preparedInput.height !== mask.height ||
        outpaint.outputWidth !== mask.width || outpaint.outputHeight !== mask.height ||
        !Number.isSafeInteger(outpaint.sourceX) || outpaint.sourceX < 0 ||
        !Number.isSafeInteger(outpaint.sourceY) || outpaint.sourceY < 0 ||
        !Number.isSafeInteger(outpaint.sourceWidth) || outpaint.sourceWidth < 1 ||
        !Number.isSafeInteger(outpaint.sourceHeight) || outpaint.sourceHeight < 1 ||
        outpaint.sourceX + outpaint.sourceWidth > outpaint.outputWidth ||
        outpaint.sourceY + outpaint.sourceHeight > outpaint.outputHeight ||
        (outpaint.sourceWidth === outpaint.outputWidth &&
          outpaint.sourceHeight === outpaint.outputHeight)) {
      throw new Error("Invalid image tool outpaint snapshot");
    }
  } else if (outpaint !== undefined || preparedInput !== undefined) {
    throw new Error("Invalid image tool outpaint snapshot");
  }
  return {
    mask: {
      assetId: mask.assetId,
      featherPixels: mask.featherPixels,
      height: mask.height,
      version: 1,
      width: mask.width,
    },
    ...(outpaint ? { outpaint } : {}),
    ...(preparedInput ? { preparedInput } : {}),
    operation: item.operation,
    operationId: item.operationId,
    sourceAssetId: item.sourceAssetId,
    sourceNodeId: item.sourceNodeId,
  };
}

function strictImageGenerationTool(input: {
  ownerId: string;
  persistedTargetData: Record<string, unknown>;
  snapshot: readonly NodeInputSnapshot[];
  submitted?: ImageGenerationToolInput;
}): ImageGenerationToolInput | undefined {
  const persistedOperation = input.persistedTargetData.imageToolOperation;
  if (input.submitted === undefined && persistedOperation === undefined) {
    return undefined;
  }
  const submitted = input.submitted;
  if (
    !submitted ||
    !generationImageToolOperations.has(submitted.operation) ||
    !/^[a-z0-9._-]{1,160}$/i.test(submitted.operationId) ||
    !/^[a-z0-9._-]{1,160}$/i.test(submitted.sourceAssetId) ||
    !/^[a-z0-9._-]{1,160}$/i.test(submitted.sourceNodeId) ||
    persistedOperation !== submitted.operation ||
    input.persistedTargetData.imageToolOperationId !== submitted.operationId ||
    input.persistedTargetData.imageToolSourceAssetId !== submitted.sourceAssetId
  ) {
    throw new Error("图片工具任务身份与已保存画布不一致");
  }
  const source = input.snapshot.find((item) =>
    item.kind === "image" &&
    item.sourceNodeId === submitted.sourceNodeId &&
    item.assetId === submitted.sourceAssetId
  );
  if (!source) throw new Error("图片工具来源与已保存画布不一致");
  const sourceMedia = readyMediaForOwner(
    input.ownerId,
    "image",
    submitted.sourceAssetId,
  );
  if (!sourceMedia) throw new Error("图片工具原图不存在或不属于当前账号");
  const requiresMask = submitted.operation === "redraw" ||
    submitted.operation === "erase" || submitted.operation === "outpaint";
  if (!submitted.mask) {
    if (requiresMask) throw new Error("图片工具缺少已保存遮罩");
    if (input.persistedTargetData.imageToolMaskAssetId !== undefined ||
        input.persistedTargetData.imageToolPreparedAssetId !== undefined ||
        input.persistedTargetData.imageToolOutpaintParameters !== undefined) {
      throw new Error("图片工具遮罩身份与已保存画布不一致");
    }
    return {
      operation: submitted.operation,
      operationId: submitted.operationId,
      sourceAssetId: submitted.sourceAssetId,
      sourceNodeId: submitted.sourceNodeId,
    };
  }
  const mask = submitted.mask;
  if (
    !requiresMask ||
    !/^[a-z0-9._-]{1,160}$/i.test(mask.assetId) ||
    mask.version !== 1 ||
    !Number.isSafeInteger(mask.width) || mask.width < 1 || mask.width > 8_192 ||
    !Number.isSafeInteger(mask.height) || mask.height < 1 || mask.height > 8_192 ||
    !Number.isSafeInteger(mask.featherPixels) ||
    mask.featherPixels < 0 || mask.featherPixels > 64 ||
    input.persistedTargetData.imageToolMaskAssetId !== mask.assetId ||
    input.persistedTargetData.imageToolMaskVersion !== 1 ||
    input.persistedTargetData.imageToolMaskWidth !== mask.width ||
    input.persistedTargetData.imageToolMaskHeight !== mask.height ||
    input.persistedTargetData.imageToolMaskFeatherPixels !== mask.featherPixels
  ) {
    throw new Error("图片工具遮罩身份或尺寸与已保存画布不一致");
  }
  const maskMedia = readyMediaForOwner(input.ownerId, "image", mask.assetId);
  const isOutpaint = submitted.operation === "outpaint";
  const outpaint = submitted.outpaint;
  const preparedInput = submitted.preparedInput;
  const persistedOutpaint = input.persistedTargetData.imageToolOutpaintParameters;
  if (isOutpaint) {
    if (!outpaint || !preparedInput || outpaint.version !== 1 ||
        preparedInput.version !== 1 ||
        input.persistedTargetData.imageToolPreparedAssetId !== preparedInput.assetId ||
        input.persistedTargetData.imageToolPreparedVersion !== 1 ||
        input.persistedTargetData.imageToolPreparedWidth !== preparedInput.width ||
        input.persistedTargetData.imageToolPreparedHeight !== preparedInput.height ||
        JSON.stringify(persistedOutpaint) !== JSON.stringify(outpaint) ||
        preparedInput.width !== mask.width || preparedInput.height !== mask.height ||
        outpaint.outputWidth !== mask.width || outpaint.outputHeight !== mask.height ||
        outpaint.sourceX + outpaint.sourceWidth > outpaint.outputWidth ||
        outpaint.sourceY + outpaint.sourceHeight > outpaint.outputHeight) {
      throw new Error("扩图边界或准备图片与已保存画布不一致");
    }
  } else if (outpaint !== undefined || preparedInput !== undefined ||
      persistedOutpaint !== undefined ||
      input.persistedTargetData.imageToolPreparedAssetId !== undefined) {
    throw new Error("图片工具包含不允许的扩图输入");
  }
  const preparedMedia = preparedInput
    ? readyMediaForOwner(input.ownerId, "image", preparedInput.assetId)
    : undefined;
  if (
    !maskMedia ||
    maskMedia.contentType !== "image/png" ||
    maskMedia.byteSize < 1 ||
    maskMedia.byteSize > imageToolMaximums.maskBytes ||
    maskMedia.mediaWidth !== mask.width ||
    maskMedia.mediaHeight !== mask.height ||
    (!isOutpaint && sourceMedia.mediaWidth !== null && sourceMedia.mediaWidth !== mask.width) ||
    (!isOutpaint && sourceMedia.mediaHeight !== null && sourceMedia.mediaHeight !== mask.height) ||
    (isOutpaint && (!preparedMedia || preparedMedia.contentType !== "image/png" ||
      preparedMedia.byteSize < 1 || preparedMedia.byteSize > imageToolMaximums.inputBytes ||
      preparedMedia.mediaWidth !== mask.width || preparedMedia.mediaHeight !== mask.height ||
      (sourceMedia.mediaWidth !== null && sourceMedia.mediaWidth !== outpaint!.sourceWidth) ||
      (sourceMedia.mediaHeight !== null && sourceMedia.mediaHeight !== outpaint!.sourceHeight)))
  ) {
    throw new Error("图片工具遮罩不存在、越界、尺寸不匹配或不属于当前账号");
  }
  return {
    mask: {
      assetId: mask.assetId,
      featherPixels: mask.featherPixels,
      height: mask.height,
      version: 1,
      width: mask.width,
    },
    ...(outpaint ? { outpaint } : {}),
    ...(preparedInput ? { preparedInput } : {}),
    operation: submitted.operation,
    operationId: submitted.operationId,
    sourceAssetId: submitted.sourceAssetId,
    sourceNodeId: submitted.sourceNodeId,
  };
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
  const { persistedOwnPrompt, persistedTargetData, ...persisted } = resolved;
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
  return { ...persisted, persistedTargetData };
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
  imageTool?: ImageGenerationToolInput;
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
  const imageTool = input.targetKind === "image"
    ? strictImageGenerationTool({
        ownerId: input.ownerId,
        persistedTargetData: persisted.persistedTargetData,
        snapshot: persisted.snapshot,
        submitted: input.body.imageTool,
      })
    : undefined;
  const { persistedTargetData: _persistedTargetData, ...publicPersisted } =
    persisted;
  const referenceMediaRules = schema.referenceMediaRules ?? arkVideoMediaRules;
  if (
    input.requireFreshRevision &&
    input.body.canvasRevision === undefined &&
    (input.body.inputSchemaVersion === 1 || publicPersisted.snapshot.length > 0)
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
      const arkFilesImage = arkFilesEnabled() &&
        resolved.kind === "image" &&
        media.contentType === "image/png" &&
        media.byteSize > arkFilesImageThresholdBytes;
      const supported = resolved.kind === "image"
        ? media.contentType === "image/png"
        : resolved.kind === "video"
          ? media.contentType === "video/mp4"
          : media.contentType === "audio/mpeg" || media.contentType === "audio/wav";
      const maximumBytes = resolved.kind === "image"
        ? arkFilesImage
          ? arkFilesImageMaximumBytes
          : 10 * 1024 * 1024
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
      if (media.storageBackend === "local" && !arkFilesImage) {
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
  return { ...publicPersisted, imageTool, parameters, references };
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
  if (isPersistenceBusyError(error)) {
    return {
      code: "RESULT_DELAYED",
      message: "系统正在处理，稍后会自动继续保存结果",
    };
  }
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
  if (error instanceof TextGenerationProviderError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ArkFilesError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof RelayProviderError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ProviderResultMediaError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ResourceBudgetError) {
    return {
      code: "RESULT_DELAYED",
      message: "系统正在处理，稍后会自动继续保存结果",
    };
  }
  if (
    error instanceof MediaPublicationConflictError ||
    error instanceof MediaPublicationStateError
  ) {
    return {
      code: "RESULT_DELAYED",
      message: "系统正在处理，稍后会自动继续保存结果",
    };
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

function isPersistenceBusyError(error: unknown) {
  if (
    error instanceof StorageConfigurationBusyError ||
    error instanceof ProviderProfileLockBusyError
  ) {
    return true;
  }
  return error instanceof Error &&
    /database is locked|SQLITE_BUSY|busy/i.test(error.message);
}

export function isTransientProviderResultSaveError(error: unknown) {
  if (error instanceof ResourceBudgetError) return true;
  if (
    error instanceof MediaPublicationConflictError ||
    error instanceof MediaPublicationStateError
  ) {
    return true;
  }
  if (isPersistenceBusyError(error)) return true;
  if (!(error instanceof ProviderResultMediaError)) return false;
  return error.code === "NETWORK" ||
    error.code === "TIMEOUT" ||
    error.code === "REMOTE";
}

function isDefinitiveProviderResultSaveError(error: unknown) {
  return error instanceof ProviderResultMediaError ||
    error instanceof RelayProviderError ||
    error instanceof OpenRouterImageError ||
    error instanceof VolcengineArkVideoError ||
    error instanceof MurekaAudioError ||
    error instanceof ProviderMediaError ||
    error instanceof TextGenerationProviderError ||
    error instanceof ProviderGenerationConfigurationError ||
    error instanceof GenerationProviderAttemptBlockedError;
}

/**
 * 所有平台/模型的成片保存共用同一道保险丝：瞬时错误返回 false，
 * 调用方继续轮询并保持任务的呼吸灯；非瞬时错误原样抛出，
 * 绝不把平台已成功、只是本地暂时保存不了的任务提前判红。
 */
export async function attemptProviderResultSave(input: {
  backoffMs?: readonly number[];
  taskId: string;
  save: () => Promise<unknown>;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<boolean> {
  const backoffMs = input.backoffMs ??
    [1_000, 2_000, 4_000, 8_000, 15_000];
  const sleep = input.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      await input.save();
      return true;
    } catch (error) {
      const transient = isTransientProviderResultSaveError(error) ||
        !isDefinitiveProviderResultSaveError(error);
      if (!transient) throw error;
      if (attempt >= backoffMs.length) {
        logGenerationDiagnostic(input.taskId, "save", error);
        return false;
      }
      logGenerationDiagnostic(input.taskId, "save-retry", error);
      await sleep(backoffMs[attempt]);
    }
  }
}

function logGenerationDiagnostic(
  taskId: string,
  stage: string,
  error: unknown,
  failureCode?: string,
) {
  try {
    const errorName = error instanceof Error ? error.name : typeof error;
    const detectedCode =
      error instanceof ProviderResultMediaError
        ? error.code
        : error instanceof RelayProviderError
          ? error.code
          : error instanceof ResourceBudgetError
            ? error.code
            : undefined;
    const rawCode =
      error instanceof Error && "code" in error
        ? (error as Error & { code?: unknown }).code
        : undefined;
    console.error(JSON.stringify({
      event: "generation-diagnostic",
      timestamp: new Date().toISOString(),
      taskId,
      stage,
      errorName,
      errorCode: failureCode ?? detectedCode ??
        (typeof rawCode === "string" ? rawCode : undefined) ?? null,
      message: error instanceof Error ? error.message : String(error),
    }));
  } catch {
    // Diagnostics must never affect generation.
  }
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
  if (launchedGenerationTasks.has(taskId)) {
    pendingGenerationRelaunches.set(taskId, kind);
    logGenerationDiagnostic(
      taskId,
      "launch-deferred",
      new Error(
        "生成启动请求到达时旧执行尚未退场，已登记为旧执行结束后立即重新启动",
      ),
    );
    return;
  }
  launchedGenerationTasks.add(taskId);
  const execute = () => settleDetachedGenerationExecution(
    () => options?.executeForTest
      ? options.executeForTest(taskId, kind)
      : kind === "text"
      ? executeTextTask(taskId, options?.providerFetcher)
      : kind === "video"
      ? executeVideoTask(taskId, options?.providerFetcher)
      : kind === "audio"
        ? executeAudioTask(taskId)
        : executeImageTask(taskId),
    (error) => persistDetachedGenerationFailure(taskId, kind, error),
  ).finally(() => {
    launchedGenerationTasks.delete(taskId);
    const pendingKind = pendingGenerationRelaunches.get(taskId);
    if (pendingKind !== undefined) {
      pendingGenerationRelaunches.delete(taskId);
      // Register the replacement execution before runtime teardown can pass its
      // active-work fence. If the runtime is already draining, registration
      // fails closed and the durable queued task is left for the next owner.
      launchGenerationTask(taskId, pendingKind, options);
    }
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
      logGenerationDiagnostic(
        taskId,
        "launch-schedule-failed",
        new Error("生成任务启动登记失败，任务保持排队等待巡逻恢复"),
      );
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
      logGenerationDiagnostic(
        taskId,
        "launch-schedule-failed",
        new Error("生成任务后台启动失败，任务保持排队等待巡逻恢复"),
      );
    });
  } catch {
    // Shutdown can freeze detached admission after the durable task commit but
    // before scheduling. Leave the task queued for the next active owner; no
    // Provider request has started in this branch.
    launchedGenerationTasks.delete(taskId);
    logGenerationDiagnostic(
      taskId,
      "launch-schedule-failed",
      new Error("生成任务启动被运行时退场冻结，任务保持排队等待巡逻恢复"),
    );
  }
}

export function launchGenerationTaskForRuntimeTest(input: {
  execute: (taskId: string, kind: GenerationTask["kind"]) => Promise<void>;
  kind: GenerationTask["kind"];
  settledExecutions: Promise<void>[];
  taskId: string;
}) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    throw new Error("Generation launch test seam is unavailable");
  }
  launchGenerationTask(input.taskId, input.kind, {
    executeForTest: input.execute,
    settledExecutions: input.settledExecutions,
  });
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
  | "dataDirectory"
  | "get"
  | "markProviderResponseReceived"
  | "recordProviderAttempt"
  | "transition"
>;

type PersistedTextTaskInput = NodeInputSnapshot & { text?: string };

function textTaskInputSnapshots(value: unknown): PersistedTextTaskInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new TextGenerationProviderError("FORMAT", "文字任务保存的上下文快照无效");
  }
  const seenOrders = new Set<number>();
  return value.map((raw): PersistedTextTaskInput => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TextGenerationProviderError("FORMAT", "文字任务保存的上下文快照无效");
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
      throw new TextGenerationProviderError("FORMAT", "文字任务保存的上下文顺序或角色无效");
    }
    seenOrders.add(Number(item.order));
    if (item.kind === "text") {
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (!text || text.length > 100_000 || item.assetId !== undefined) {
        throw new TextGenerationProviderError("FORMAT", "文字任务保存的文字上下文无效");
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
      throw new TextGenerationProviderError("FORMAT", "文字任务保存的媒体上下文无效");
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
    throw new TextGenerationProviderError(
      "FORMAT",
      "中转站请求或响应格式无法安全识别",
    );
  }
  return contentType;
}

export async function executeTextTaskWithDependencies(
  taskId: string,
  dependencies: {
    acquireGenerationSnapshot?: (
      profileId: string,
      ownerId: string,
    ) => Promise<ProviderGenerationSnapshot>;
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
    ossReadUrlForMedia?: (
      media: MediaRecord,
    ) => Promise<string>;
    signal?: AbortSignal;
    store: TextTaskStore;
    textRuntime?: GenerationRuntimeAdapters["text"];
    textProviderRegistry?: TextProviderRegistry;
    prepareArkImage?: (input: {
      image: ArkImageBytesInput;
      mimeType: string;
      ownerId: string;
      profileId: string;
      signal?: AbortSignal;
      snapshot: ProviderGenerationSnapshot;
      taskId: string;
    }) => Promise<{
      cleanup: (cleanupSignal?: AbortSignal) => Promise<void>;
      fileId: string;
    }>;
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
  const cleanups: Array<
    (cleanupSignal?: AbortSignal) => Promise<void>
  > = [];
  try {
    const protocol = taskProviderProtocol(running);
    if (!isTextGenerationProtocol(protocol)) {
      throw new TextGenerationProviderError(
        "FORMAT",
        "文字模型配置已失效",
      );
    }
    const snapshots = textTaskInputSnapshots(running.parameters.inputs);
    const inputs: TextGenerationInput[] = [];
    for (const snapshot of snapshots) {
      if (snapshot.kind === "text") {
        inputs.push({
          kind: "text",
          order: snapshot.order,
          role: "context-text",
          text: snapshot.text,
        });
        continue;
      }
      const mediaInput = {
        assetId: snapshot.assetId!,
        kind: snapshot.kind,
        ownerId: running.ownerId!,
      };
      const acquireGenerationSnapshot =
        dependencies.acquireGenerationSnapshot;
      const ossReadUrlForMedia = dependencies.ossReadUrlForMedia;
      const prepareArkImage = dependencies.prepareArkImage;
      const arkFilesAvailable = protocol === "native" &&
        arkFilesEnabled() &&
        acquireGenerationSnapshot !== undefined &&
        prepareArkImage !== undefined;
      if (arkFilesAvailable && snapshot.kind === "image") {
        const media = readableMediaForOwner(
          running.ownerId!,
          snapshot.kind,
          snapshot.assetId!,
        );
        if (
          media &&
          media.storageStatus === "ready" &&
          media.contentType === "image/png" &&
          media.byteSize > arkFilesImageThresholdBytes &&
          media.byteSize <= arkFilesImageMaximumBytes &&
          (
            ossReadUrlForMedia !== undefined ||
            media.storageBackend !== "oss"
          )
        ) {
          const generationSnapshot =
            await acquireGenerationSnapshot(
              running.providerProfileId,
              running.ownerId!,
            );
          const ossReadUrl = media.storageBackend === "oss"
            ? await ossReadUrlForMedia!(media)
            : undefined;
          const uploaded = await prepareArkImage({
            image: {
              assetId: mediaInput.assetId,
              byteSize: media.byteSize,
              checksumSha256: media.checksumSha256,
              contentType: media.contentType,
              objectKey: media.objectKey,
              ossReadUrl,
              ownerId: mediaInput.ownerId,
              signal: dependencies.signal,
              storageBackend: media.storageBackend,
              storageName: media.storageName,
            },
            mimeType: media.contentType,
            ownerId: running.ownerId!,
            profileId: running.providerProfileId,
            signal: dependencies.signal,
            snapshot: generationSnapshot,
            taskId,
          });
          inputs.push({
            fileId: uploaded.fileId,
            kind: "image",
            order: snapshot.order,
            role: "context-image",
          });
          cleanups.push(uploaded.cleanup);
          continue;
        }
      }
      const url = await dependencies.mediaUrlForOwner(mediaInput, {
        rules: referenceMediaRulesForTask(running) ?? genericReferenceMediaRules,
      });
      inputs.push({
        kind: snapshot.kind,
        mimeType: protocol === "native"
          ? undefined
          : relayContextMimeType({
              ...mediaInput,
              contentType: dependencies.mediaContentTypeForOwner?.(mediaInput),
            }),
        order: snapshot.order,
        role: `context-${snapshot.kind}`,
        transientUrl: protocol !== "native" &&
            url.startsWith("data:audio/mp3;base64,")
          ? url.replace("data:audio/mp3;base64,", "data:audio/mpeg;base64,")
          : url,
      });
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
      result = await (dependencies.textRuntime ?? generationRuntimeAdapters().text)(
        lease.profile,
          {
            inputs,
            maxOutputTokens:
              typeof running.parameters.maxOutputTokens === "number"
                ? running.parameters.maxOutputTokens
                : undefined,
            model: running.providerModelId,
            prompt: running.prompt,
            protocol,
            temperature: typeof running.parameters.temperature === "number"
              ? running.parameters.temperature
              : undefined,
            thinkingLevel: ["minimal", "medium"].includes(
              String(running.parameters.thinkingLevel),
            )
              ? running.parameters.thinkingLevel as "minimal" | "medium"
              : "medium",
          },
          {
            beforeProviderRequest: () =>
              dependencies.store.recordProviderAttempt(taskId),
            fetcher: leasedFetch,
            releaseProviderLease: lease.release,
            signal: dependencies.signal,
            usePinnedTransport: dependencies.usePinnedRelayTransport,
          },
        dependencies.textProviderRegistry,
      );
    } finally {
      lease.release();
    }
    if (dependencies.store.get(taskId)?.state !== "running") return;
    dependencies.store.markProviderResponseReceived({
      executionAttempt: running.attempt,
      taskId,
    });
    commitGenerationTextResult({
      // Ark does not return a reliable per-response bill. Keep budget
      // accounting conservative by recording the administrator-protected cap.
      actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
      dataDirectory: dependencies.store.dataDirectory,
      executionAttempt: running.attempt,
      providerUsageTokens: result.providerUsageTokens,
      resultText: result.text,
      taskId,
    });
  } catch (error) {
    if (dependencies.store.get(taskId)?.state === "cancelled") return;
    const failure = safeFailure(error, "text");
    logGenerationDiagnostic(taskId, "text-execution", error, failure.code);
    try {
      dependencies.store.transition(taskId, "failed", failure);
    } catch {
      // A concurrent terminal transition wins; no second Provider call is made.
    }
  } finally {
    // Deletion uses its own signal: the task cancellation signal may already
    // be aborted and would cancel the DELETE before it starts.
    const cleanupSignal = new AbortController().signal;
    await Promise.all(cleanups.map((cleanup) =>
      cleanup(cleanupSignal).catch(() => undefined),
    ));
  }
}

async function executeTextTask(taskId: string, fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  runningTextRequests.set(taskId, controller);
  try {
    await executeTextTaskWithDependencies(taskId, {
      acquireGenerationSnapshot: acquireProviderGenerationSnapshot,
      acquireProfile: acquireProviderGenerationRequestLease,
      fetcher,
      mediaUrlForOwner: providerMediaUrlForOwner,
      ossReadUrlForMedia: async (media) => {
        const storageProfile = await storageProfileForMedia(media);
        if (!storageProfile) {
          throw new ProviderMediaError(
            "MEDIA_UNAVAILABLE",
            "参考素材的云端存储暂不可用",
          );
        }
        return createPrivateAliyunOssReadUrl(
          media.objectKey,
          storageProfile,
          600,
        );
      },
      signal: controller.signal,
      store: taskStore(),
      prepareArkImage: (input) => prepareArkImageFile({
        ...input,
        fetcher,
      }),
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
    "kind" | "modelConfiguration" | "ownerId" | "parameters" | "prompt" |
      "providerModelId"
  >,
  mediaUrlForOwner: typeof providerMediaUrlForOwner,
) {
  if (
    !task.ownerId ||
    (task.kind !== "audio" && task.kind !== "image" && task.kind !== "video")
  ) throw new RelayProviderError("FORMAT");
  const modelContract = relayMediaModelContract(task.providerModelId);
  if (modelContract) {
    if (modelContract.capability !== task.kind) {
      throw new RelayProviderError("FORMAT");
    }
    let parameters: Record<string, RelayMediaParamValue>;
    try {
      parameters = modelContract.mapParameters(task.parameters, task.prompt) as
        Record<string, RelayMediaParamValue>;
    } catch {
      throw new RelayProviderError("FORMAT");
    }
    const rawInputs = task.parameters.inputs;
    if (rawInputs === undefined) return parameters;
    if (!Array.isArray(rawInputs) || rawInputs.length > 64) {
      throw new RelayProviderError("FORMAT");
    }
    const seenOrders = new Set<number>();
    const mediaInputs = rawInputs.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new RelayProviderError("FORMAT");
      }
      const input = raw as Partial<NodeInputSnapshot>;
      if (
        !Number.isSafeInteger(input.order) || Number(input.order) < 1 ||
        seenOrders.has(Number(input.order)) ||
        typeof input.role !== "string" ||
        typeof input.sourceNodeId !== "string" ||
        !/^[a-z0-9._-]{1,160}$/i.test(input.sourceNodeId)
      ) throw new RelayProviderError("FORMAT");
      seenOrders.add(Number(input.order));
      if (input.kind === "text") {
        if (input.assetId !== undefined) throw new RelayProviderError("FORMAT");
        return undefined;
      }
      if (
        (input.kind !== "audio" && input.kind !== "image" &&
          input.kind !== "video") ||
        typeof input.assetId !== "string" ||
        !/^[a-z0-9._-]{1,160}$/i.test(input.assetId) ||
        !modelContract.referencePolicy.allowedKinds.includes(input.kind) ||
        !modelContract.referencePolicy.allowedRoles.includes(input.role)
      ) throw new RelayProviderError("FORMAT");
      return {
        assetId: input.assetId,
        kind: input.kind,
        order: Number(input.order),
      };
    }).filter((input): input is NonNullable<typeof input> => Boolean(input))
      .sort((left, right) => left.order - right.order);
    if (mediaInputs.length > modelContract.referencePolicy.maximumCount) {
      throw new RelayProviderError("FORMAT");
    }
    if (mediaInputs.length) {
      const urls: string[] = [];
      for (const input of mediaInputs) {
        urls.push(await mediaUrlForOwner({
          assetId: input.assetId,
          kind: input.kind,
          ownerId: task.ownerId,
        }, {
          rules: referenceMediaRulesForTask(task) ?? genericReferenceMediaRules,
        }));
      }
      if (modelContract.referencePolicy.parameterName !== "images") {
        throw new RelayProviderError("FORMAT");
      }
      parameters.images = urls;
    }
    return parameters;
  }
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

const youchuangQualityLabels: Record<string, string> = {
  "1k": "1K",
  "2k": "2K",
  "4k": "4K",
};

export function gptImageSizeForAspectRatio(
  value: unknown,
  quality: unknown = "1k",
  sizeMap?: GptImageSizeMap,
) {
  const ratio = value === undefined || value === null ? "auto" : String(value);
  const tier = String(quality ?? "1k").toLowerCase();
  const configured =
    sizeMap?.[tier as GptImageSizeTier]?.[ratio];
  if (configured !== undefined) return configured;
  if (value === undefined || value === "auto") return "auto" as const;
  const tierTable =
    youchuangGptImageSizes[tier as keyof typeof youchuangGptImageSizes] ??
    youchuangGptImageSizes["1k"];
  const size = tierTable[ratio];
  if (size === undefined) {
    const label = youchuangQualityLabels[tier] ?? "当前";
    throw new RelayProviderError(
      "FORMAT",
      false,
      `优创这个画质档（${label}）不支持 ${ratio} 比例，请改回自动比例或换 1K 画质`,
    );
  }
  return size;
}

async function commitSavedGenerationMedia(saved: {
  assetId: string;
  publicationToken?: MediaPublicationReservation;
}, mode: "alternate" | "candidate" | "primary" = "primary") {
  if (!saved.publicationToken) {
    throw new MediaPublicationStateError(
      "Generated media publication token is missing",
    );
  }
  if (mode === "candidate") {
    publishGenerationMediaCandidate(saved.publicationToken);
  } else if (mode === "alternate") {
    commitGenerationAlternateMediaResult(saved.publicationToken);
  } else {
    commitGenerationMediaResult(saved.publicationToken);
  }
  await cleanupPublicationStaging(saved.publicationToken).catch(() => undefined);
  return saved.assetId;
}

async function saveRelayMediaOutput(input: {
  actualCostMicrounits: number;
  executionAttempt: number;
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
    const bytes = Buffer.from(input.output.bytes);
    validateRelayPng(bytes);
    const saved = await saveGeneratedPng({
      bytes,
      label: input.prompt.slice(0, 120),
      ownerId: input.ownerId,
      task: {
        actualCostMicrounits: input.actualCostMicrounits,
        executionAttempt: input.executionAttempt,
        taskId: input.taskId,
      },
    });
    return commitSavedGenerationMedia(saved, "candidate");
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
    const bytes = await normalizeProviderImageToPng({
      body: downloaded.body,
      contentType: downloaded.contentType,
      ownerId: input.ownerId,
      signal: input.signal,
    });
    const saved = await saveGeneratedPng({
      bytes,
      label: input.prompt.slice(0, 120),
      ownerId: input.ownerId,
      task: {
        actualCostMicrounits: input.actualCostMicrounits,
        executionAttempt: input.executionAttempt,
        taskId: input.taskId,
      },
    });
    return commitSavedGenerationMedia(saved, "candidate");
  }
  if (input.output.kind === "video") {
    const saved = await saveGeneratedMp4({
      body: downloaded.body,
      label: input.prompt.slice(0, 120),
      ownerId: input.ownerId,
      task: {
        actualCostMicrounits: input.actualCostMicrounits,
        executionAttempt: input.executionAttempt,
        taskId: input.taskId,
      },
    });
    return commitSavedGenerationMedia(saved, "candidate");
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
      executionAttempt: input.executionAttempt,
      taskId: input.taskId,
    },
  });
  return commitSavedGenerationMedia(saved, "candidate");
}

async function saveRelayMediaOutputs(input: {
  actualCostMicrounits: number;
  executionAttempt: number;
  expectedAudioContentType?: string;
  outputs: readonly RelayTransientMediaOutput[];
  ownerId: string;
  profile: ProviderProfile;
  prompt: string;
  signal: AbortSignal;
  taskId: string;
}) {
  if (
    input.outputs.length < 1 || input.outputs.length > 4 ||
    input.outputs.some((output) => output.kind !== input.outputs[0].kind)
  ) {
    throw new RelayProviderError("PROVIDER_RESULT_FORMAT", true);
  }
  const kind = input.outputs[0].kind;
  const published = publishedGenerationMediaCandidateIds({
    executionAttempt: input.executionAttempt,
    kind,
    ownerId: input.ownerId,
    taskId: input.taskId,
  });
  if (published.length > input.outputs.length) {
    throw new RelayProviderError("PROVIDER_RESULT_FORMAT", true);
  }
  for (const output of input.outputs.slice(published.length)) {
    const saved = await attemptProviderResultSave({
      taskId: input.taskId,
      save: () => saveRelayMediaOutput({
        actualCostMicrounits: input.actualCostMicrounits,
        executionAttempt: input.executionAttempt,
        expectedAudioContentType: input.expectedAudioContentType,
        output,
        ownerId: input.ownerId,
        profile: input.profile,
        prompt: input.prompt,
        signal: input.signal,
        taskId: input.taskId,
      }),
    });
    if (!saved) return false;
    const current = publishedGenerationMediaCandidateIds({
      executionAttempt: input.executionAttempt,
      kind,
      ownerId: input.ownerId,
      taskId: input.taskId,
    });
    published.splice(0, published.length, ...current);
  }
  if (published.length !== input.outputs.length) return false;
  return attemptProviderResultSave({
    taskId: input.taskId,
    save: async () => commitGenerationMediaOutputSet({
      assetIds: published,
      executionAttempt: input.executionAttempt,
      kind,
      ownerId: input.ownerId,
      taskId: input.taskId,
    }),
  });
}

function validateRelayPng(bytes: Buffer) {
  try {
    validatePng(bytes);
  } catch {
    throw new RelayProviderError("PROVIDER_RESULT_FORMAT", true);
  }
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

const relayMediaPollLimit: Record<"audio" | "image" | "video", number> = {
  audio: 450,
  image: 150,
  video: 240,
};

const relayMediaRecoveryLimit: Record<"audio" | "image" | "video", number> = {
  audio: 0,
  image: 30,
  video: 24,
};

function mediaProviderAbsoluteDeadline(task: GenerationTask) {
  const contract = relayMediaModelContract(task.providerModelId);
  const durationMs = contract?.pollPolicy.deadlineMs ??
    (task.kind === "video" ? 75 : task.kind === "audio" ? 15 : 10) * 60_000;
  const attemptedAt = taskStore().providerAttemptCreatedAt(task.id);
  const origin = attemptedAt ? Date.parse(attemptedAt) : Date.now();
  if (!Number.isFinite(origin)) {
    throw new Error("Invalid Provider attempt creation time");
  }
  return new Date(origin + durationMs).toISOString();
}

function mediaProviderExecution(input: {
  absoluteDeadline?: string;
  beforeProviderRequest?: () => void;
  fetcher: typeof fetch;
  metadata?: Readonly<Record<string, unknown>>;
  profile: ProviderProfile;
  signal: AbortSignal;
  task: GenerationTask;
}): MediaGenerationExecution {
  return {
    absoluteDeadline: input.absoluteDeadline ??
      mediaProviderAbsoluteDeadline(input.task),
    attempt: input.task.attempt,
    beforeProviderRequest: input.beforeProviderRequest ?? (() => undefined),
    fetcher: input.fetcher,
    metadata: input.metadata,
    profile: input.profile,
    signal: input.signal,
  };
}

function relayOutputsFromNormalized(
  outputs: readonly NormalizedMediaProviderOutput[],
): RelayTransientMediaOutput[] {
  return outputs.map((output) => {
    if (output.bytes) {
      if (output.kind !== "image" || !output.contentType) {
        throw new RelayProviderError("PROVIDER_RESULT_FORMAT", true);
      }
      return {
        bytes: output.bytes,
        kind: "image",
        mimeType: output.contentType,
        transport: "bytes",
      };
    }
    if (!output.transientUrl) {
      throw new RelayProviderError("PROVIDER_RESULT_FORMAT", true);
    }
    return {
      kind: output.kind,
      ...(output.contentType ? { mimeType: output.contentType } : {}),
      transientUrl: output.transientUrl,
      transport: "transient-url",
    };
  });
}

function isTransientRelayPollError(error: unknown) {
  if (!(error instanceof RelayProviderError)) return false;
  return error.code === "NETWORK" ||
    error.code === "TIMEOUT" ||
    error.code === "REMOTE" ||
    error.code === "PROVIDER_REQUEST_FAILED" ||
    error.code === "PROXY_CONFIGURATION";
}

async function settleRelayMediaFailed(
  taskId: string,
  refunded: boolean,
) {
  const current = taskStore().get(taskId);
  if (!current || current.state !== "running") return;
  taskStore().transition(taskId, "failed", {
    code: "PROVIDER_FAILED",
    message: refunded
      ? "平台未完成本次生成（已退款），系统正在自动重试"
      : "平台未完成本次生成，未确认是否退款；请核对后再试",
  });
  if (!refunded) return;
  try {
    const failed = taskStore().get(taskId);
    if (!failed || failed.state !== "failed") return;
    taskStore().confirmRemoteResultMissing({
      expectedUpdatedAt: failed.updatedAt,
      taskId,
    });
    await autoRetryRelayTaskOnce(taskId);
  } catch {
    // The task is already failed with a neutral message; a racing transition
    // or a stale retry fence simply disables the automatic retry.
  }
}

/**
 * Bounded background continuation after the primary image/video polling
 * window. The durable task stays running so the canvas keeps its breathing
 * light; only definitive rejection, a confirmed refund retry, or the final
 * neutral settlement turns the task terminal.
 */
async function recoverRelayMediaAfterPoll(
  taskId: string,
  kind: "image" | "video",
  profile: ProviderProfile,
  controller: AbortController,
  providerTaskId: string | undefined,
  releaseReferences?: () => Promise<void>,
) {
  try {
    const attempts = relayMediaRecoveryLimit[kind];
    let currentTaskId = providerTaskId;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (taskStore().get(taskId)?.state !== "running") return;
      if (!currentTaskId) {
        const current = taskStore().get(taskId);
        if (!current || current.state !== "running") return;
        let match: Awaited<ReturnType<typeof autoMatchRelayProviderTask>>;
        try {
          match = await autoMatchRelayProviderTask(current);
        } catch {
          match = { status: "none" };
        }
        if (match.status === "one") {
          try {
            taskStore().setProviderTaskId(taskId, match.record.taskId);
            currentTaskId = match.record.taskId;
          } catch {
            // Another execution bound the same task first; keep searching.
          }
        }
        if (!currentTaskId) {
          await waitForRelayMedia(10_000, controller.signal);
          continue;
        }
      }
      let status: MediaProviderTaskSnapshot;
      try {
        const current = taskStore().get(taskId);
        if (!current || current.state !== "running") return;
        status = await withProviderRequestLease({
          expected: profile,
          fetcher: fetch,
          ownerId: current.ownerId ?? "",
          profileId: current.providerProfileId ?? profile.id,
          task: current,
          request: (currentProfile, leasedFetch, providerBoundary) =>
            generationRuntimeAdapters().relayMedia.inspect(
              currentProfile,
              kind,
              currentTaskId!,
              mediaProviderExecution({
                beforeProviderRequest: providerBoundary(),
                fetcher: leasedFetch,
                metadata: { kind },
                profile: currentProfile,
                signal: controller.signal,
                task: current,
              }),
            ),
        });
      } catch (error) {
        if (!isTransientRelayPollError(error)) throw error;
        await waitForRelayMedia(10_000, controller.signal);
        continue;
      }
      if (status.state === "failed") {
        await settleRelayMediaFailed(taskId, status.refunded === true);
        return;
      }
      if (status.state === "succeeded") {
        const running = taskStore().get(taskId);
        if (!running || running.state !== "running") return;
        taskStore().markProviderResponseReceivedForTask(taskId);
        const normalized = generationRuntimeAdapters().relayMedia.normalize(
          profile,
          kind,
          status.rawResult,
        );
        const saved = await saveRelayMediaOutputs({
          actualCostMicrounits: normalized.actualCostMicrounits ??
            running.estimatedCostMicrounits ?? 0,
          executionAttempt: running.attempt,
          outputs: relayOutputsFromNormalized(normalized.outputs),
          ownerId: running.ownerId!,
          profile,
          prompt: running.prompt,
          signal: controller.signal,
          taskId,
        });
        if (saved) return;
        await waitForRelayMedia(10_000, controller.signal);
        continue;
      }
      await waitForRelayMedia(10_000, controller.signal);
    }
    const final = taskStore().get(taskId);
    if (!final || final.state !== "running") return;
    if (!currentTaskId) {
      // The full search window found no platform record: treat the lost
      // submission as not-submitted and let the automatic retry open one new
      // paid attempt (only once in the task lifetime).
      taskStore().transition(taskId, "failed", {
        code: "PROVIDER_RESULT_MISSING",
        message: "平台没有成片，系统正在自动重试",
      });
      try {
        const failed = taskStore().get(taskId);
        if (failed?.state === "failed") {
          taskStore().confirmRemoteResultMissing({
            expectedUpdatedAt: failed.updatedAt,
            taskId,
          });
        }
        await autoRetryRelayTaskOnce(taskId);
      } catch {
        // Leave the neutral failed task behind; the user can tap 核对/重试 once.
      }
      return;
    }
    taskStore().transition(taskId, "failed", {
      code: "RESULT_DELAYED",
      message: "平台还在处理，结果出来后系统会自动核对",
    });
  } finally {
    if (releaseReferences) await releaseReferences().catch(() => undefined);
  }
}

/**
 * One automatic new-paid retry per task lifetime, using the exact same safe
 * retry fences as the manual retry endpoint. It never fires twice because the
 * retry itself advances the attempt number.
 */
async function autoRetryRelayTaskOnce(taskId: string) {
  const task = taskStore().get(taskId);
  if (!task || task.state !== "failed" || task.attempt >= 2) return false;
  const retry = retrySafetyDecision(task);
  if (!retry.allowed || retry.mode !== "new-provider-attempt") return false;
  const binding = taskStore()
    .retryBindingsForCanvas(task.canvasId, task.ownerId)
    .get(task.id);
  if (!binding) return false;
  try {
    const runtime = await generationRuntimeDecision({
      canSubmit: true,
      kind: task.kind,
      model: retry.model,
      ownerId: task.ownerId ?? "__test__",
    });
    const runtimeProblem = preAdmissionRuntimeProblem(runtime);
    if (runtimeProblem) return false;
    if (
      !runtime.providerProfile ||
      !Number.isSafeInteger(runtime.credentialVersion) ||
      Number(runtime.credentialVersion) < 1
    ) {
      return false;
    }
    const snapshot: GenerationPaidRetrySnapshot = {
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
    const queued = taskStore().admitRetry({
      canvasId: task.canvasId,
      expectedAttempt: task.attempt,
      expectedCanvasRevision: binding.canvasRevision,
      expectedGenerationInputKey: binding.generationInputKey,
      expectedUpdatedAt: task.updatedAt,
      kind: task.kind,
      mode: "new-paid-attempt",
      nodeId: task.nodeId,
      snapshot,
      taskId: task.id,
    });
    if (!queued) return false;
    launchGenerationTask(task.id, task.kind);
    return true;
  } catch {
    return false;
  }
}

async function executeRelayMediaTask(
  taskId: string,
  kind: "audio" | "image" | "video",
  controller: AbortController,
  options?: {
    paramsBuilder?: (
      running: GenerationTask,
      profile: ProviderProfile,
    ) => Promise<{
      cleanup?: () => Promise<void>;
      params: Record<string, RelayMediaParamValue>;
    }>;
  },
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
  const modelContract = relayMediaModelContract(running.providerModelId);
  if (modelContract && modelContract.capability !== kind) {
    throw new RelayProviderError("FORMAT");
  }
  const protocol = taskProviderProtocol(running);
  if (protocol !== "media-generate" && !(kind === "image" && protocol === "gpt-image")) {
    throw new RelayProviderError("FORMAT");
  }
  const profile = await taskProviderSnapshotProfile(running, running.ownerId!);
  assertRelayProfile(profile, "media-generate");
  let providerTaskId = running.providerTaskId;
  let cleanup: (() => Promise<void>) | undefined;
  let cleanupDeferred = false;
  try {
    if (relayMediaSubmissionAction(providerTaskId) === "submit-once") {
      const built = options?.paramsBuilder
        ? await options.paramsBuilder(running, profile)
        : undefined;
      const params = built?.params ?? await relayMediaParametersForTask(
        running,
        providerMediaUrlForOwner,
      );
      cleanup = built?.cleanup;
      try {
        const submission = await withProviderRequestLease({
          expected: profile,
          fetcher: fetch,
          ownerId: ownerId,
          profileId: running.providerProfileId,
          task: running,
          request: async (currentProfile, leasedFetch, providerBoundary) => {
            const created = await generationRuntimeAdapters().relayMedia.submit(
              currentProfile,
              {
                inputs: [],
                kind,
                model: running.providerModelId!,
                parameters: params,
                prompt: running.prompt,
              },
              mediaProviderExecution({
                beforeProviderRequest: providerBoundary(() =>
                  taskStore().recordProviderAttempt(taskId),
                ),
                fetcher: leasedFetch,
                profile: currentProfile,
                signal: controller.signal,
                task: running,
              }),
            );
            if (created.state !== "accepted") {
              throw new RelayProviderError("FORMAT", true);
            }
            taskStore().setProviderTaskId(taskId, created.providerTaskId);
            return created;
          },
        });
        if (submission.state !== "accepted") {
          throw new RelayProviderError("FORMAT", true);
        }
        providerTaskId = submission.providerTaskId;
      } catch (error) {
        // The submission crossed the Provider boundary but its response was
        // lost (no durable task id). Image/video enter usage-record recovery
        // instead of failing red; references stay alive during that search.
        if (
          error instanceof RelayProviderError &&
          error.providerTaskMayStillRun &&
          modelContract
        ) {
          taskStore().transition(taskId, "failed", {
            code: "PROVIDER_REQUEST_FAILED",
            message: "已向模型提交但未收到任务号；为避免重复扣费，请人工核对",
          });
          return;
        }
        if (
          error instanceof RelayProviderError &&
          error.providerTaskMayStillRun &&
          (kind === "image" || kind === "video")
        ) {
          cleanupDeferred = true;
          await recoverRelayMediaAfterPoll(
            taskId,
            kind,
            profile,
            controller,
            undefined,
            cleanup,
          );
          return;
        }
        throw error;
      }
    }
    const attemptCreatedAt = modelContract
      ? taskStore().providerAttemptCreatedAt(taskId)
      : undefined;
    if (modelContract && !attemptCreatedAt) {
      throw new RelayProviderError("FORMAT", true);
    }
    let poll = 0;
    while (true) {
      const polling = modelContract
        ? relayMediaPollingDecision({
            attemptCreatedAt: attemptCreatedAt!,
            nowMs: Date.now(),
            pollCount: poll,
            policy: modelContract.pollPolicy,
          })
        : {
            delayMs: 2_000,
            expired: poll >= relayMediaPollLimit[kind],
          };
      if (polling.expired) break;
      poll += 1;
      if (taskStore().get(taskId)?.state !== "running") return;
      let status: MediaProviderTaskSnapshot;
      try {
        status = await withProviderRequestLease({
          expected: profile,
          fetcher: fetch,
          ownerId: ownerId,
          profileId: running.providerProfileId,
          task: running,
          request: (currentProfile, leasedFetch, providerBoundary) =>
            generationRuntimeAdapters().relayMedia.inspect(
              currentProfile,
              kind,
              providerTaskId!,
              mediaProviderExecution({
                beforeProviderRequest: providerBoundary(),
                fetcher: leasedFetch,
                metadata: {
                  kind,
                  requireResultType: Boolean(modelContract),
                },
                profile: currentProfile,
                signal: controller.signal,
                task: running,
              }),
            ),
        });
      } catch (error) {
        if (!isTransientRelayPollError(error)) throw error;
        await waitForRelayMedia(polling.delayMs, controller.signal);
        continue;
      }
      if (status.state === "failed") {
        await settleRelayMediaFailed(taskId, status.refunded === true);
        return;
      }
      if (status.state === "succeeded") {
        taskStore().markProviderResponseReceivedForTask(taskId);
        const normalized = generationRuntimeAdapters().relayMedia.normalize(
          profile,
          kind,
          status.rawResult,
        );
        const saved = await saveRelayMediaOutputs({
          actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
          executionAttempt: running.attempt,
          expectedAudioContentType: kind === "audio"
            ? relayAudioResultContentType(running.parameters.format)
            : undefined,
          outputs: relayOutputsFromNormalized(normalized.outputs),
          ownerId,
          profile,
          prompt: running.prompt,
          signal: controller.signal,
          taskId,
        });
        if (saved) return;
        await waitForRelayMedia(polling.delayMs, controller.signal);
        continue;
      }
      await waitForRelayMedia(polling.delayMs, controller.signal);
    }
    if (modelContract) {
      const currentTask = taskStore().get(taskId);
      if (currentTask?.state === "running") {
        taskStore().transition(taskId, "failed", {
          code: "RESULT_DELAYED",
          message: "平台仍在处理，任务号已保留；系统不会重新提交付费请求",
        });
      }
      return;
    }
    if (kind === "image" || kind === "video") {
      await recoverRelayMediaAfterPoll(
        taskId,
        kind,
        profile,
        controller,
        providerTaskId,
      );
      return;
    }
    throw new RelayProviderError("TIMEOUT", true);
  } finally {
    if (cleanup && !cleanupDeferred) await cleanup().catch(() => undefined);
  }
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
  for (let attempt = 0; attempt < relayMediaRecoveryLimit.image; attempt += 1) {
    if (taskStore().get(taskId)?.state !== "running") return;
    let status: MediaProviderTaskSnapshot;
    try {
      status = await withProviderRequestLease({
        expected: profile,
        fetcher: fetch,
        ownerId: running.ownerId,
        profileId: running.providerProfileId,
        task: running,
        request: (currentProfile, leasedFetch, providerBoundary) =>
          generationRuntimeAdapters().relayMedia.inspect(
            currentProfile,
            "image",
            running.providerTaskId!,
            mediaProviderExecution({
              beforeProviderRequest: providerBoundary(),
              fetcher: leasedFetch,
              metadata: { kind: "image" },
              profile: currentProfile,
              signal: controller.signal,
              task: running,
            }),
          ),
      });
    } catch (error) {
      if (!isTransientRelayPollError(error)) throw error;
      await waitForRelayMedia(10_000, controller.signal);
      continue;
    }
    if (status.state === "failed") {
      taskStore().transition(taskId, "failed", {
        code: "PROVIDER_FAILED",
        message: "平台没有这张图",
      });
      return;
    }
    if (status.state !== "succeeded") {
      await waitForRelayMedia(10_000, controller.signal);
      continue;
    }
    taskStore().markProviderResponseReceivedForTask(taskId);
    const normalized = generationRuntimeAdapters().relayMedia.normalize(
      profile,
      "image",
      status.rawResult,
    );
    const saved = await saveRelayMediaOutputs({
      actualCostMicrounits: normalized.actualCostMicrounits ??
        running.estimatedCostMicrounits ?? 0,
      executionAttempt: running.attempt,
      outputs: relayOutputsFromNormalized(normalized.outputs),
      ownerId: running.ownerId!,
      profile,
      prompt: running.prompt,
      signal: controller.signal,
      taskId,
    });
    if (saved) return;
    await waitForRelayMedia(10_000, controller.signal);
  }
  const final = taskStore().get(taskId);
  if (!final || final.state !== "running") return;
  taskStore().transition(taskId, "failed", {
    code: "RESULT_DELAYED",
    message: "平台还在处理，结果出来后系统会自动核对",
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
    providerProfileId: task.providerProfileId,
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

/**
 * 优创「GPT Image 2 · 专用协议」异步执行：先提交拿平台任务号，再轮询；
 * 参考图临时链接保留 600 秒，任务终态后才清理。
 */
async function executeRelayGptImageTask(
  taskId: string,
  controller: AbortController,
) {
  const current = taskStore().get(taskId);
  if (
    !current ||
    current.kind !== "image" ||
    !["queued", "running"].includes(current.state) ||
    !current.ownerId
  ) return;
  const running = current.state === "queued"
    ? taskStore().transition(taskId, "running")
    : current;
  if (!running?.providerProfileId || !running.providerModelId) {
    taskStore().transition(taskId, "failed", {
      code: "MODEL_UNAVAILABLE",
      message: "图片模型配置已失效",
    });
    return;
  }
  if (taskProviderProtocol(running) !== "gpt-image") {
    throw new RelayProviderError("FORMAT");
  }
  if (running.providerTaskId) {
    await recoverGptImageFromProviderTask(taskId, running, controller);
    return;
  }
  const ownerId = running.ownerId!;
  const profile = await taskProviderSnapshotProfile(running, ownerId);
  assertRelayProfile(profile, "media-generate");
  const references = imageReferences(running.parameters.references);
  const imageTool = storedImageGenerationTool(running.parameters.imageTool);
  const providerReferences = imageTool?.preparedInput
    ? [{ assetId: imageTool.preparedInput.assetId }]
    : references;
  const inputReferences = await Promise.all(
    providerReferences.map((reference) =>
      imageReferenceForProvider(ownerId, reference.assetId, 600),
    ),
  );
  const maskReference = imageTool?.mask
    ? await imageReferenceForProvider(ownerId, imageTool.mask.assetId, 600)
    : undefined;
  const prepared = await prepareRelayGptImageRequest({
    capability: "image",
    count: 1,
    inputImages: inputReferences,
    ...(maskReference ? { maskImage: maskReference } : {}),
    model: running.providerModelId!,
    operation: inputReferences.length ? "edit" : "generation",
    prompt: running.prompt,
    providerProtocol: "gpt-image",
    quality: ["auto", "low", "medium", "high"].includes(
      String(running.parameters.quality),
    )
      ? running.parameters.quality as "auto" | "low" | "medium" | "high"
      : "auto",
    responseFormat: "url",
    size: gptImageSizeForAspectRatio(
      running.parameters.aspectRatio,
      running.parameters.quality,
      snapshotGptImageSizeMap(running),
    ),
  }, {
    mediaLifecycle: { ownerId },
    referenceUrlTtlSeconds: 600,
    signal: controller.signal,
  });
  const size = prepared.request.size ?? "auto";
  const tier = String(running.parameters.quality).toLowerCase();
  const resolutionLabel = youchuangQualityLabels[tier];
  await executeRelayMediaTask(taskId, "image", controller, {
    paramsBuilder: async () => {
      const params: Record<string, RelayMediaParamValue> = {
        n: 1,
        quality: prepared.request.quality ?? "auto",
        response_format: "url",
        size,
      };
      if (prepared.request.inputImages?.length) {
        params.images = [...prepared.request.inputImages];
      }
      if (prepared.request.maskImage) {
        params.mask = prepared.request.maskImage;
      }
      if (size !== "auto" && resolutionLabel) {
        params.resolution = resolutionLabel;
      }
      return { cleanup: prepared.cleanup, params };
    },
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
    if (currentProtocol === "gpt-image") {
      await executeRelayGptImageTask(taskId, controller);
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
          executionAttempt: running.attempt,
          taskId,
        },
      });
      await commitSavedGenerationMedia(saved);
      return;
    }
    throw new RelayProviderError("FORMAT");
  } catch (error) {
    if (taskStore().get(taskId)?.state === "cancelled") return;
    const failure = safeFailure(error, "image");
    logGenerationDiagnostic(taskId, "image-execution", error, failure.code);
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

function transientArkVideoPollError(error: unknown) {
  return error instanceof VolcengineArkVideoError &&
    ["NETWORK", "TIMEOUT", "REMOTE"].includes(error.code);
}

async function saveVolcengineVideoResult(
  taskId: string,
  running: GenerationTask,
  profile: ProviderProfile,
  output: NormalizedMediaProviderOutput,
  signal: AbortSignal,
) {
  taskStore().markProviderResponseReceivedForTask(taskId);
  if (
    output.kind !== "video" || !output.transientUrl ||
    output.providerUsageTokens === undefined
  ) {
    throw new VolcengineArkVideoError("FORMAT", "方舟未返回完整的视频结果");
  }
  const downloaded = await downloadProviderResultMedia({
    apiKey: profile.apiKey ?? "",
    kind: "video",
    signal,
    url: output.transientUrl,
  });
  const actualCostMicrounits = Math.ceil(
    output.providerUsageTokens *
    seedanceMiniAudioPriceMicrounitsPerThousandTokens /
    1_000,
  );
  const saved = await saveGeneratedMp4({
    body: downloaded.body,
    label: running.prompt.slice(0, 120),
    ownerId: running.ownerId!,
    task: {
      actualCostMicrounits,
      executionAttempt: running.attempt,
      providerUsageTokens: output.providerUsageTokens,
      taskId,
    },
  });
  await commitSavedGenerationMedia(saved);
}

/**
 * Bounded background continuation for native Ark video after the primary
 * 8-minute window. The durable task stays running (canvas keeps the breathing
 * light) while the platform result is re-checked at a slower cadence.
 */
async function recoverNativeVideoAfterPoll(
  taskId: string,
  running: GenerationTask,
  profile: ProviderProfile,
  providerTaskId: string,
  controller: AbortController,
) {
  for (let attempt = 0; attempt < relayMediaRecoveryLimit.video; attempt += 1) {
    if (taskStore().get(taskId)?.state !== "running") return;
    let status: MediaProviderTaskSnapshot;
    try {
      status = await withProviderRequestLease({
        expected: profile,
        fetcher: fetch,
        ownerId: running.ownerId!,
        profileId: running.providerProfileId!,
        task: running,
        request: (currentProfile, leasedFetch, providerBoundary) =>
          generationRuntimeAdapters().arkVideo.inspect(
            currentProfile,
            providerTaskId,
            mediaProviderExecution({
              beforeProviderRequest: providerBoundary(),
              fetcher: leasedFetch,
              metadata: { kind: "video" },
              profile: currentProfile,
              signal: controller.signal,
              task: running,
            }),
          ),
      });
    } catch (error) {
      if (transientArkVideoPollError(error)) {
        await wait(10_000, controller.signal);
        continue;
      }
      throw error;
    }
    if (status.state === "cancelled") {
      taskStore().transition(taskId, "cancelled", {
        code: "PROVIDER_CANCELLED",
        message: "视频任务已取消",
      });
      return;
    }
    if (status.state === "failed") {
      taskStore().transition(taskId, "failed", {
        code: "PROVIDER_FAILED",
        message: "火山方舟未完成本次视频生成，未确认是否退款；请核对后再试",
      });
      return;
    }
    if (status.state === "succeeded") {
      const output = generationRuntimeAdapters().arkVideo.normalize(
        profile,
        status.rawResult,
      ).outputs[0];
      const saved = await attemptProviderResultSave({
        taskId,
        save: () => saveVolcengineVideoResult(
          taskId,
          running,
          profile,
          output,
          controller.signal,
        ),
      });
      if (saved) return;
    }
    await wait(10_000, controller.signal);
  }
  taskStore().transition(taskId, "failed", {
    code: "RESULT_DELAYED",
    message: "平台还在处理，结果出来后系统会自动核对",
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
  const rules = referenceMediaRulesForTask(task) ?? arkVideoMediaRules;
  const validated = snapshots.map((snapshot): ArkVideoMediaRecord => {
    const media = readableMediaForOwner(
      task.ownerId!,
      snapshot.kind,
      snapshot.assetId,
    );
    if (!media || media.storageStatus !== "ready") {
      throw new ProviderMediaError(
        "MEDIA_UNAVAILABLE",
        "参考素材不存在、尚未保存或不属于当前账号",
      );
    }
    const problem = arkVideoMediaProblem(snapshot.kind, media, rules);
    if (problem) throw new ProviderMediaError("MEDIA_INVALID", problem);
    return { kind: snapshot.kind, media };
  });
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
      logGenerationDiagnostic(taskId, "video-execution", error, failure.code);
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
        request: async (currentProfile, leasedFetch, providerBoundary) => {
          const created = await generationRuntimeAdapters().arkVideo.submit(
            currentProfile,
            {
              inputs: [],
              kind: "video",
              model: running.providerModelId!,
              parameters: {
                aspectRatio: typeof running.parameters.aspectRatio === "string"
                  ? running.parameters.aspectRatio
                  : "16:9",
                duration: typeof running.parameters.duration === "number"
                  ? running.parameters.duration
                  : 5,
                generateAudio: running.parameters.generateAudio !== false,
                inputs,
                limits: adapterVideoLimitsForTask(running),
                resolution: typeof running.parameters.resolution === "string"
                  ? running.parameters.resolution
                  : "480p",
              },
              prompt: running.prompt,
            },
            mediaProviderExecution({
              beforeProviderRequest: providerBoundary(() =>
                taskStore().recordProviderAttempt(taskId)
              ),
              fetcher: leasedFetch,
              profile: currentProfile,
              signal: controller.signal,
              task: running,
            }),
          );
          if (created.state !== "accepted") {
            throw new VolcengineArkVideoError("FORMAT", "方舟没有返回视频任务编号");
          }
          taskStore().setProviderTaskId(taskId, created.providerTaskId);
          return created;
        },
      });
      if (created.state !== "accepted") {
        throw new VolcengineArkVideoError("FORMAT", "方舟没有返回视频任务编号");
      }
      providerTaskId = created.providerTaskId;
    }

    for (let poll = 0; poll < relayMediaPollLimit.video; poll += 1) {
      if (taskStore().get(taskId)?.state !== "running") return;
      let status: MediaProviderTaskSnapshot;
      try {
        status = await withProviderRequestLease({
          expected: profile,
          fetcher,
          ownerId: running.ownerId!,
          profileId: running.providerProfileId,
          task: running,
          request: (currentProfile, leasedFetch, providerBoundary) =>
            generationRuntimeAdapters().arkVideo.inspect(
              currentProfile,
              providerTaskId,
              mediaProviderExecution({
                beforeProviderRequest: providerBoundary(),
                fetcher: leasedFetch,
                metadata: { kind: "video" },
                profile: currentProfile,
                signal: controller.signal,
                task: running,
              }),
            ),
        });
      } catch (error) {
        if (transientArkVideoPollError(error)) {
          await wait(2_000, controller.signal);
          continue;
        }
        throw error;
      }
      if (status.state === "cancelled") {
        taskStore().transition(taskId, "cancelled", {
          code: "PROVIDER_CANCELLED",
          message: "视频任务已取消",
        });
        return;
      }
      if (status.state === "failed") {
        taskStore().transition(taskId, "failed", {
          // Native Ark has no refund marker. Conservative: neutral failed,
          // one-tap confirm before any new paid attempt.
          code: "PROVIDER_FAILED",
          message: "火山方舟未完成本次视频生成，未确认是否退款；请核对后再试",
        });
        return;
      }
      if (status.state === "succeeded") {
        const output = generationRuntimeAdapters().arkVideo.normalize(
          profile,
          status.rawResult,
        ).outputs[0];
        const saved = await attemptProviderResultSave({
          taskId,
          save: () => saveVolcengineVideoResult(
            taskId,
            running,
            profile,
            output,
            controller.signal,
          ),
        });
        if (saved) return;
        await wait(2_000, controller.signal);
        continue;
      }
      await wait(2_000, controller.signal);
    }
    await recoverNativeVideoAfterPoll(
      taskId,
      running,
      profile,
      providerTaskId,
      controller,
    );
    return;
  } catch (error) {
    if (taskStore().get(taskId)?.state === "cancelled") return;
    const failure = safeFailure(error, "video");
    logGenerationDiagnostic(taskId, "video-execution", error, failure.code);
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
      logGenerationDiagnostic(taskId, "audio-execution", error, failure.code);
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
        request: async (currentProfile, leasedFetch, providerBoundary) => {
          const created = await generationRuntimeAdapters().murekaAudio.submit(
            currentProfile,
            {
              inputs: [],
              kind: "audio",
              model: running.providerModelId!,
              parameters: running.parameters,
              prompt: running.prompt,
            },
            mediaProviderExecution({
              beforeProviderRequest: providerBoundary(() =>
                taskStore().recordProviderAttempt(taskId)
              ),
              fetcher: leasedFetch,
              profile: currentProfile,
              signal: controller.signal,
              task: running,
            }),
          );
          if (created.state !== "accepted") {
            throw new MurekaAudioError("FORMAT");
          }
          taskStore().setProviderTaskId(taskId, created.providerTaskId);
          return created;
        },
      });
      if (created.state !== "accepted") throw new MurekaAudioError("FORMAT");
      providerTaskId = created.providerTaskId;
    }

    for (let poll = 0; poll < 450; poll += 1) {
      if (taskStore().get(taskId)?.state !== "running") return;
      const status = await withProviderRequestLease({
        expected: profile,
        fetcher: fetch,
        ownerId: running.ownerId!,
        profileId: running.providerProfileId,
        task: running,
        request: (currentProfile, leasedFetch, providerBoundary) =>
          generationRuntimeAdapters().murekaAudio.inspect(
            currentProfile,
            providerTaskId,
            mediaProviderExecution({
              beforeProviderRequest: providerBoundary(),
              fetcher: leasedFetch,
              metadata: { kind: "audio", queryKind },
              profile: currentProfile,
              signal: controller.signal,
              task: running,
            }),
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
          message: status.failureMessage ?? "Mureka 未完成本次音频生成",
        });
        return;
      }
      if (status.state === "succeeded") {
        taskStore().markProviderResponseReceivedForTask(taskId);
        const output = generationRuntimeAdapters().murekaAudio.normalize(
          profile,
          status.rawResult,
        ).outputs[0];
        if (!output?.transientUrl) {
          throw new MurekaAudioError("FORMAT");
        }
        const audioUrl = output.transientUrl;
        const saved = await attemptProviderResultSave({
          taskId,
          save: async () => {
            const audioBody = await downloadMurekaAudioResult(
              profile,
              audioUrl,
              { signal: controller.signal },
            );
            const stored = await saveGeneratedMp3({
              body: audioBody,
              label: running.prompt.slice(0, 120),
              ownerId: running.ownerId!,
              task: {
                // Mureka does not return a per-task bill. Record the configured
                // protected maximum so budget accounting remains conservative.
                actualCostMicrounits: running.estimatedCostMicrounits ?? 0,
                executionAttempt: running.attempt,
                taskId,
              },
            });
            await commitSavedGenerationMedia(stored);
          },
        });
        if (saved) return;
        await waitForAudio(2_000, controller.signal);
        continue;
      }
      await waitForAudio(2_000, controller.signal);
    }
    throw new MurekaAudioError("TIMEOUT");
  } catch (error) {
    if (taskStore().get(taskId)?.state === "cancelled") return;
    const failure = safeFailure(error, "audio");
    logGenerationDiagnostic(taskId, "audio-execution", error, failure.code);
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
  let imageTool: ImageGenerationToolInput | undefined;
  try {
    imageTool = storedImageGenerationTool(parameterValues.imageTool);
  } catch {
    return "原任务保存的图片工具身份或遮罩快照无效，请回到节点重新提交";
  }
  delete parameterValues.imageTool;
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
    if (imageTool) {
      const sourceMatches = snapshotImageReferences.some((reference) =>
        reference.assetId === imageTool!.sourceAssetId &&
        reference.sourceNodeId === imageTool!.sourceNodeId
      );
      if (!sourceMatches) {
        return "原任务保存的图片工具来源与节点输入快照不一致，请回到节点重新提交";
      }
      if (mode === "new-provider-attempt" && imageTool.mask) {
        const sourceMedia = task.ownerId
          ? readyMediaForOwner(task.ownerId, "image", imageTool.sourceAssetId)
          : undefined;
        const maskMedia = task.ownerId
          ? readyMediaForOwner(task.ownerId, "image", imageTool.mask.assetId)
          : undefined;
        const preparedMedia = imageTool.preparedInput && task.ownerId
          ? readyMediaForOwner(task.ownerId, "image", imageTool.preparedInput.assetId)
          : undefined;
        const isOutpaint = imageTool.operation === "outpaint";
        if (
          !sourceMedia || !maskMedia ||
          maskMedia.contentType !== "image/png" ||
          maskMedia.byteSize < 1 ||
          maskMedia.byteSize > imageToolMaximums.maskBytes ||
          maskMedia.mediaWidth !== imageTool.mask.width ||
          maskMedia.mediaHeight !== imageTool.mask.height ||
          (!isOutpaint && sourceMedia.mediaWidth !== null &&
            sourceMedia.mediaWidth !== imageTool.mask.width) ||
          (!isOutpaint && sourceMedia.mediaHeight !== null &&
            sourceMedia.mediaHeight !== imageTool.mask.height) ||
          (isOutpaint && (!imageTool.outpaint || !imageTool.preparedInput ||
            !preparedMedia || preparedMedia.contentType !== "image/png" ||
            preparedMedia.mediaWidth !== imageTool.mask.width ||
            preparedMedia.mediaHeight !== imageTool.mask.height ||
            (sourceMedia.mediaWidth !== null &&
              sourceMedia.mediaWidth !== imageTool.outpaint.sourceWidth) ||
            (sourceMedia.mediaHeight !== null &&
              sourceMedia.mediaHeight !== imageTool.outpaint.sourceHeight)))
        ) {
          return "原任务保存的遮罩不存在、尺寸不匹配或不属于当前账号，请回到节点重新提交";
        }
      }
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
  const exactProviderIdentity = Boolean(
    providerAttempt &&
    providerAttempt.providerProfileId === task.providerProfileId &&
    providerAttempt.providerModelId === task.providerModelId
  );
  const exactAbandonedEvidence = Boolean(
    exactProviderIdentity && providerAttempt &&
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
    exactProviderIdentity && providerAttempt &&
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
  if (taskStore().hasConfirmedProviderOutcomeForSibling(task.id)) {
    return {
      allowed: false,
      code: "RETRY_OUTCOME_UNKNOWN",
      reason:
        "同一输入已有平台任务已受理或已出片，为避免重复扣费，请先「核对结果」，不要重新提交",
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
      request: (profile, leasedFetch, providerBoundary) =>
        generationRuntimeAdapters().arkVideo.cancel(
          profile,
          task.providerTaskId!,
          mediaProviderExecution({
            beforeProviderRequest: providerBoundary(),
            fetcher: leasedFetch,
            metadata: { kind: "video" },
            profile,
            signal: AbortSignal.timeout(30_000),
            task,
          }),
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

async function inspectReconcileMediaProvider(
  task: GenerationTask,
  providerTaskId: string,
  protocol: ProviderProtocol,
  kind: "audio" | "image" | "video",
  signal: AbortSignal,
) {
  const profile = await taskProviderSnapshotProfile(task, task.ownerId!);
  const execution = mediaProviderExecution({
    // Reconciliation is a new bounded read operation after the original
    // polling window, so it owns a fresh request deadline without changing
    // the persisted paid-attempt deadline.
    absoluteDeadline: new Date(Date.now() + 30_000).toISOString(),
    fetcher: fetch,
    metadata: {
      kind,
      ...(kind === "audio"
        ? { queryKind: audioQueryKind(task.parameters) }
        : {}),
    },
    profile,
    signal,
    task,
  });
  if (protocol === "media-generate") {
    return generationRuntimeAdapters().relayMedia.inspect(
      profile,
      kind,
      providerTaskId,
      execution,
    );
  }
  if (protocol === "native" && kind === "video") {
    return generationRuntimeAdapters().arkVideo.inspect(
      profile,
      providerTaskId,
      execution,
    );
  }
  if (protocol === "native" && kind === "audio") {
    return generationRuntimeAdapters().murekaAudio.inspect(
      profile,
      providerTaskId,
      execution,
    );
  }
  throw new RelayProviderError("FORMAT");
}

async function pollReconcileProviderTask(
  task: GenerationTask,
  providerTaskId: string,
  signal: AbortSignal,
): Promise<ReconcilePollState> {
  if (!task.ownerId || !task.providerProfileId) return "cannot-query";
  const protocol = taskProviderProtocol(task);
  if (protocol === "media-generate" && task.kind !== "text") {
    const status = await inspectReconcileMediaProvider(
      task,
      providerTaskId,
      protocol,
      task.kind,
      signal,
    );
    if (status.state === "succeeded") return "success";
    if (status.state === "failed") return "failed";
    return "running";
  }
  if (protocol === "native" && task.kind === "video") {
    const status = await inspectReconcileMediaProvider(
      task,
      providerTaskId,
      protocol,
      "video",
      signal,
    );
    if (status.state === "succeeded") return "success";
    if (status.state === "failed" || status.state === "cancelled") return "failed";
    return "running";
  }
  if (protocol === "native" && task.kind === "audio") {
    const status = await inspectReconcileMediaProvider(
      task,
      providerTaskId,
      protocol,
      "audio",
      signal,
    );
    if (status.state === "succeeded") return "success";
    if (status.state === "failed" || status.state === "cancelled") return "failed";
    return "running";
  }
  if (task.kind !== "text") {
    try {
      const kind = task.kind === "audio" || task.kind === "video"
        ? task.kind
        : "image";
      const status = await inspectReconcileMediaProvider(
        task,
        providerTaskId,
        "media-generate",
        kind,
        signal,
      );
      if (status.state === "succeeded") return "success";
      if (status.state === "failed") return "failed";
      return "running";
    } catch {
      return "cannot-query";
    }
  }
  return "cannot-query";
}

/**
 * Transport-neutral Generation application surface consumed by the Node HTTP
 * adapter. Keeping this object narrow makes request parsing and response
 * mapping replaceable without exposing Provider/runtime internals to Vite.
 */
export const generationTaskApplication = Object.freeze({
  GenerationProviderAttemptBlockedError,
  GenerationTaskAbandonError,
  GenerationTaskAdmissionError,
  GenerationTaskCanvasRevisionConflictError,
  GenerationTaskConflictError,
  GenerationTaskOwnerDeletingError,
  GenerationTaskProviderBoundaryError,
  GenerationTaskRetryFenceError,
  GenerationTaskTransitionError,
  ProviderProfileLockBusyError,
  acquireProviderGenerationRequestLease,
  assertPersistedCanvasRevision,
  autoMatchRelayProviderTask,
  cancelGenerationTask,
  generationAvailability,
  generationModelSchema,
  generationRequestIntent,
  generationRuntimeDecision,
  generationRuntimeProblems,
  generationSafetyStatus,
  lastReconcileAt,
  launchGenerationTask,
  missingModelMessage,
  pollReconcileProviderTask,
  preAdmissionRuntimeProblem,
  providerConfigurationVersion,
  reconcileCooldownMs,
  requireTaskProviderSnapshot,
  resolveModel,
  resumeProviderTaskSnapshotProblem,
  retrySafetyDecision,
  strictGenerationPreflight,
  taskAuditEstimatedCostMicrounits,
  taskStore,
  taskSummary,
  taskSummaryForOwner,
});
