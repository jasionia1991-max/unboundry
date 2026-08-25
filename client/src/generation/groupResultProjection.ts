import type { ProbeNodeType } from "../canvas/ProbeNode";
import {
  createFetchCanvasPersistenceTransport,
  isCanvasSaveSuccess,
  isLoadedCanvasDocument,
  type CanvasPersistenceTransport,
  type LoadedCanvasDocument,
} from "../canvas/canvasPersistenceFacade";
import { groupRunResultKey } from "./groupRunCheckpoint";
import type { WorkflowExecutorKind } from "./nodeExecutorRegistry";

export type GroupResultProjection = {
  accountId: string;
  applicationId: string;
  canvasId: string;
  dataPatch: Record<string, unknown>;
  inputFingerprint: string;
  kind: WorkflowExecutorKind;
  nodeId: string;
  ownershipKey: string;
  resultKey: string;
  runId: string;
  semanticRevision: string;
  taskId: string;
};

export type GroupResultProjectionStatus =
  | "aborted"
  | "already-applied"
  | "applied"
  | "conflict"
  | "exhausted";

export type GroupResultProjectionResult = {
  applicationId: string;
  attempts: number;
  status: GroupResultProjectionStatus;
};

type BrowserLockManager = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T> | T,
  ): Promise<T>;
};

const commonResultKeys = new Set([
  "groupRunSuccessOwnershipKey",
  "groupRunSuccessResultKey",
  "groupRunSuccessTaskId",
  "workflowExecutionRunId",
]);
const mediaResultKeys = new Set([
  "assetId",
  "inputState",
  "inputStateReason",
  "mediaByteSize",
  "mediaContentType",
  "mediaDurationSeconds",
  "mediaHeight",
  "mediaMetadataSource",
  "mediaMetadataStatus",
  "mediaStorageBackend",
  "mediaWidth",
]);
const kindResultKeys: Record<WorkflowExecutorKind, ReadonlySet<string>> = {
  audio: new Set([
    "audioDuration",
    "audioFileName",
    "audioFileSize",
    "audioGeneratedResult",
    "audioGenerationError",
    "audioGenerationErrorCode",
    "audioGenerationInputKey",
    "audioGenerationOwnershipKey",
    "audioGenerationRetryAllowed",
    "audioGenerationRetryBlockCode",
    "audioGenerationRetryBlockReason",
    "audioGenerationTaskId",
    "audioGenerating",
    "audioModelId",
    "audioModelName",
    "audioParameters",
    "audioPrompt",
    "audioResultChoices",
    "audioSrc",
    "audioWaveform",
  ]),
  image: new Set([
    "imageAspectRatio",
    "imageGeneratedSuccess",
    "imageGenerationError",
    "imageGenerationErrorCode",
    "imageGenerationInputKey",
    "imageGenerationOwnershipKey",
    "imageGenerationRetryAllowed",
    "imageGenerationRetryBlockCode",
    "imageGenerationRetryBlockReason",
    "imageGenerationTaskId",
    "imageGenerating",
    "imageModelId",
    "imageModelName",
    "imageParameters",
    "imageQuality",
    "imageSrc",
  ]),
  text: new Set([
    "content",
    "contentHtml",
    "textGenerationError",
    "textGenerationErrorCode",
    "textGenerationInputKey",
    "textGenerationOwnershipKey",
    "textGenerationRetryAllowed",
    "textGenerationRetryBlockCode",
    "textGenerationRetryBlockReason",
    "textGenerationTaskId",
    "textGenerating",
    "textModelId",
    "textModelName",
    "textParameters",
  ]),
  video: new Set([
    "videoAudioEnabled",
    "videoCreatedAt",
    "videoGenerationError",
    "videoGenerationErrorCode",
    "videoGenerationInputKey",
    "videoGenerationOwnershipKey",
    "videoGenerationRetryAllowed",
    "videoGenerationRetryBlockCode",
    "videoGenerationRetryBlockReason",
    "videoGenerationTaskId",
    "videoGenerating",
    "videoModel",
    "videoModelId",
    "videoParameters",
    "videoPrompt",
    "videoSrc",
  ]),
};

function randomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `projection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

export function groupResultProjectionApplicationId(input: Pick<
  GroupResultProjection,
  "nodeId" | "resultKey" | "runId" | "taskId"
>) {
  return `${input.runId}:${input.nodeId}:${input.taskId}:${input.resultKey}`;
}

export function groupResultSemanticRevision(input: Pick<
  GroupResultProjection,
  "inputFingerprint" | "kind" | "nodeId" | "ownershipKey" | "runId" | "taskId"
>) {
  return groupRunResultKey({
    inputFingerprint: input.inputFingerprint,
    kind: input.kind,
    nodeId: input.nodeId,
    ownershipKey: input.ownershipKey,
    runId: input.runId,
    taskId: input.taskId,
  });
}

function projectionAlreadyApplied(
  node: ProbeNodeType,
  projection: GroupResultProjection,
) {
  return node.data.groupRunSuccessOwnershipKey === projection.ownershipKey &&
    node.data.groupRunSuccessResultKey === projection.resultKey &&
    node.data.groupRunSuccessTaskId === projection.taskId &&
    projectionResultIsComplete(
      node.data as Record<string, unknown>,
      projection.kind,
    );
}

function projectionTargetStillMatches(
  node: ProbeNodeType,
  projection: GroupResultProjection,
) {
  const data = node.data as Record<string, unknown>;
  if (
    node.type !== projection.kind ||
    data.workflowExecutionRunId !== projection.runId ||
    data[`${projection.kind}GenerationTaskId`] !== projection.taskId ||
    data[`${projection.kind}GenerationOwnershipKey`] !== projection.ownershipKey ||
    data[`${projection.kind}GenerationInputKey`] !== projection.inputFingerprint
  ) return false;
  return projection.semanticRevision === groupResultSemanticRevision(projection);
}

function generationOwnedPatch(projection: GroupResultProjection) {
  const allowed = kindResultKeys[projection.kind];
  return Object.fromEntries(
    Object.entries(projection.dataPatch).filter(([key]) =>
      commonResultKeys.has(key) ||
      allowed.has(key) ||
      (projection.kind !== "text" && mediaResultKeys.has(key))
    ),
  );
}

function projectionResultIsComplete(
  patch: Record<string, unknown>,
  kind: WorkflowExecutorKind,
) {
  if (kind === "text") {
    return typeof patch.content === "string" && patch.content.trim().length > 0 &&
      typeof patch.contentHtml === "string" && patch.contentHtml.length > 0;
  }
  if (
    typeof patch.assetId !== "string" || !patch.assetId ||
    typeof patch[`${kind}Src`] !== "string" || !patch[`${kind}Src`]
  ) return false;
  if (kind === "image") return patch.imageGeneratedSuccess === true;
  if (kind === "audio") return patch.audioGeneratedResult === true;
  return true;
}

export function mergeGroupResultProjection(
  document: LoadedCanvasDocument,
  projection: GroupResultProjection,
):
  | { document: LoadedCanvasDocument; status: "apply" }
  | { status: "already-applied" | "conflict" } {
  const target = document.nodes.find((node) => node.id === projection.nodeId);
  if (!target) return { status: "conflict" };
  if (projectionAlreadyApplied(target, projection)) {
    return { status: "already-applied" };
  }
  if (!projectionTargetStillMatches(target, projection)) {
    return { status: "conflict" };
  }
  const patch = generationOwnedPatch(projection);
  if (
    patch.groupRunSuccessOwnershipKey !== projection.ownershipKey ||
    patch.groupRunSuccessResultKey !== projection.resultKey ||
    patch.groupRunSuccessTaskId !== projection.taskId ||
    !projectionResultIsComplete(patch, projection.kind)
  ) return { status: "conflict" };
  return {
    document: {
      ...document,
      nodes: document.nodes.map((node) => node.id === projection.nodeId
        ? { ...node, data: { ...node.data, ...patch } }
        : node),
    },
    status: "apply",
  };
}

function retryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 ||
    status >= 500;
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve(true);
    }, ms);
    const aborted = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

function boundedAttemptSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  parent?.addEventListener("abort", relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", relayAbort);
    },
    signal: controller.signal,
  };
}

async function reconcileWithoutLock(input: {
  maxAttempts?: number;
  projection: GroupResultProjection;
  signal?: AbortSignal;
  transport?: CanvasPersistenceTransport;
}): Promise<GroupResultProjectionResult> {
  const maxAttempts = input.maxAttempts ?? 4;
  const transport = input.transport ?? createFetchCanvasPersistenceTransport();
  const saveSessionId = randomId();
  let saveSequence = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (input.signal?.aborted) {
      return { applicationId: input.projection.applicationId, attempts: attempt - 1, status: "aborted" };
    }
    const loadAttempt = boundedAttemptSignal(input.signal, 4_000);
    let loaded;
    try {
      loaded = await transport.load({
        canvasId: input.projection.canvasId,
        saveSessionId,
        signal: loadAttempt.signal,
      });
    } catch {
      loaded = { body: undefined, ok: false, status: 503 };
    } finally {
      loadAttempt.cleanup();
    }
    if (loaded.ok && isLoadedCanvasDocument(loaded.body)) {
      const merged = mergeGroupResultProjection(loaded.body, input.projection);
      if (merged.status !== "apply") {
        return {
          applicationId: input.projection.applicationId,
          attempts: attempt,
          status: merged.status,
        };
      }
      const saveAttemptId = randomId();
      saveSequence += 1;
      const payload = JSON.stringify({
        edges: merged.document.edges,
        generationProjection: input.projection,
        nodes: merged.document.nodes,
        observedLoadToken: loaded.body.loadToken,
        observedRevision: loaded.body.revision,
        revision: loaded.body.revision,
        saveAttemptId,
        saveSequence,
        saveSessionId,
        viewport: merged.document.viewport,
      });
      let saved;
      const saveAttempt = boundedAttemptSignal(input.signal, 6_000);
      try {
        saved = await transport.put({
          canvasId: input.projection.canvasId,
          payload,
          responseMode: "strict-json",
          signal: saveAttempt.signal,
        });
      } catch {
        saved = { body: undefined, ok: false, status: 503 };
      } finally {
        saveAttempt.cleanup();
      }
      if (saved.ok && isCanvasSaveSuccess(saved.body, {
        observedLoadToken: loaded.body.loadToken,
        revision: loaded.body.revision,
      })) {
        return { applicationId: input.projection.applicationId, attempts: attempt, status: "applied" };
      }
      if (!retryableStatus(saved.status)) {
        return { applicationId: input.projection.applicationId, attempts: attempt, status: "exhausted" };
      }
    } else if (!retryableStatus(loaded.status)) {
      return { applicationId: input.projection.applicationId, attempts: attempt, status: "exhausted" };
    }
    if (attempt < maxAttempts && !(await abortableDelay(80 * 2 ** (attempt - 1), input.signal))) {
      return { applicationId: input.projection.applicationId, attempts: attempt, status: "aborted" };
    }
  }
  return { applicationId: input.projection.applicationId, attempts: maxAttempts, status: "exhausted" };
}

export function reconcileGroupResultProjection(input: {
  maxAttempts?: number;
  projection: GroupResultProjection;
  signal?: AbortSignal;
  transport?: CanvasPersistenceTransport;
}) {
  const locks = typeof window === "undefined"
    ? undefined
    : (window.navigator as Navigator & { locks?: BrowserLockManager }).locks;
  if (typeof window !== "undefined" && !locks) {
    return Promise.resolve({
      applicationId: input.projection.applicationId,
      attempts: 0,
      status: "exhausted" as const,
    });
  }
  if (!locks) return reconcileWithoutLock(input);
  return locks.request(
    `unboundry-group-result-projection:${JSON.stringify([
      input.projection.accountId,
      input.projection.canvasId,
      input.projection.applicationId,
    ])}`,
    { mode: "exclusive" },
    () => reconcileWithoutLock(input),
  );
}

const applications = new Map<string, Promise<GroupResultProjectionResult>>();
const runApplications = new Map<string, Set<string>>();

function projectionQueueKey(projection: GroupResultProjection) {
  return JSON.stringify([
    projection.accountId,
    projection.canvasId,
    projection.applicationId,
  ]);
}

export function enqueueGroupResultProjection(
  projection: GroupResultProjection,
  options: { signal?: AbortSignal; transport?: CanvasPersistenceTransport } = {},
) {
  const applicationKey = projectionQueueKey(projection);
  const existing = applications.get(applicationKey);
  if (existing) return existing;
  const pending = Promise.resolve()
    .then(() => reconcileGroupResultProjection({
      projection,
      signal: options.signal,
      transport: options.transport,
    }))
    .catch(() => ({
      applicationId: projection.applicationId,
      attempts: 0,
      status: options.signal?.aborted
        ? ("aborted" as const)
        : ("exhausted" as const),
    }));
  applications.set(applicationKey, pending);
  const runIds = runApplications.get(projection.runId) ?? new Set<string>();
  runIds.add(applicationKey);
  runApplications.set(projection.runId, runIds);
  return pending;
}

export async function waitForGroupResultProjections(runId: string) {
  const applicationKeys = [...(runApplications.get(runId) ?? [])];
  const results = await Promise.all(
    applicationKeys.flatMap((key) => {
      const pending = applications.get(key);
      return pending ? [pending] : [];
    }),
  );
  for (const key of applicationKeys) applications.delete(key);
  runApplications.delete(runId);
  return results;
}
