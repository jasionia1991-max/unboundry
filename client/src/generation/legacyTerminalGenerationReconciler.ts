import type { ProbeNodeType } from "../canvas/ProbeNode";
import { trustedMediaPatch } from "../canvas/mediaInputMetadata";
import {
  groupResultProjectionApplicationId,
  groupResultSemanticRevision,
  type GroupResultProjection,
} from "./groupResultProjection";
import { groupRunResultKey } from "./groupRunCheckpoint";
import type {
  GenerationTaskKind,
  GenerationTaskSummary,
} from "./generationTasks";
import type { AuthoritativeGenerationCanvasMutation } from
  "./GenerationCanvasContext";
import { stableValueFingerprint } from "../../../types/canvasFingerprint";

export type LegacyTerminalGenerationState =
  | "PASSTHROUGH"
  | "DETECTING"
  | "ACTIVE_CONFIRMED"
  | "RESTORED"
  | "CONFLICT_PRESERVED"
  | "UNKNOWN_BLOCKED";

export type LegacyTerminalGenerationCandidate = Readonly<{
  accountId: string;
  canvasId: string;
  inputFingerprint: string;
  kind: GenerationTaskKind;
  nodeDataFingerprint: string;
  nodeId: string;
  ownershipKey: string;
  runId: string;
  taskId: string;
}>;

export type LegacyTerminalGenerationPolicy = Readonly<{
  mode: "off" | "detect" | "allowlist" | "on";
  writeEnabled: boolean;
}>;

export function parseLegacyTerminalGenerationPolicy(
  value: unknown,
): LegacyTerminalGenerationPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("孤立生成状态策略响应格式异常");
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    keys.length !== 2 || keys[0] !== "mode" || keys[1] !== "writeEnabled"
  ) throw new Error("孤立生成状态策略响应格式异常");
  const mode = candidate.mode;
  const writeEnabled = candidate.writeEnabled;
  if (
    (mode !== "off" && mode !== "detect" && mode !== "allowlist" &&
      mode !== "on") || typeof writeEnabled !== "boolean" ||
    ((mode === "off" || mode === "detect") && writeEnabled) ||
    (mode === "on" && !writeEnabled)
  ) throw new Error("孤立生成状态策略响应格式异常");
  return { mode, writeEnabled };
}

export function legacyTerminalCanvasWriteAllowed(input: {
  webLocksAvailable: boolean;
  writeEnabled: boolean;
}) {
  return input.writeEnabled && input.webLocksAvailable;
}

export type LegacyTerminalGenerationDecision =
  | Readonly<{ state: "ACTIVE_CONFIRMED"; task: GenerationTaskSummary }>
  | Readonly<{
      projection: GroupResultProjection;
      state: "RESTORED";
      task: GenerationTaskSummary;
    }>
  | Readonly<{
      state: "CONFLICT_PRESERVED";
      task: GenerationTaskSummary;
    }>
  | Readonly<{ state: "UNKNOWN_BLOCKED" }>;

const activeStates = new Set([
  "queued",
  "running",
  "retrying",
  "recovering",
]);
const terminalStates = new Set(["success", "failed", "cancelled"]);
const checksumPattern = /^[a-f0-9]{64}$/i;

export function legacyTerminalNodeDataFingerprint(value: unknown) {
  return stableValueFingerprint(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function legacyGenerationNodeKind(
  node: Pick<ProbeNodeType, "type">,
): GenerationTaskKind | undefined {
  return node.type === "audio" || node.type === "image" ||
      node.type === "text" || node.type === "video"
    ? node.type
    : undefined;
}

export function legacyTerminalGenerationCandidate(input: {
  accountId: string;
  canvasId: string;
  node: ProbeNodeType;
}): LegacyTerminalGenerationCandidate | undefined {
  const kind = legacyGenerationNodeKind(input.node);
  if (!kind) return undefined;
  const data = input.node.data as Record<string, unknown>;
  if (data[`${kind}Generating`] !== true) return undefined;
  const runId = data.workflowExecutionRunId;
  const taskId = data[`${kind}GenerationTaskId`];
  const ownershipKey = data[`${kind}GenerationOwnershipKey`];
  const inputFingerprint = data[`${kind}GenerationInputKey`];
  if (
    !nonEmpty(runId) || !nonEmpty(taskId) || !nonEmpty(ownershipKey) ||
    !nonEmpty(inputFingerprint)
  ) return undefined;
  return {
    accountId: input.accountId,
    canvasId: input.canvasId,
    inputFingerprint,
    kind,
    nodeDataFingerprint: legacyTerminalNodeDataFingerprint(data),
    nodeId: input.node.id,
    ownershipKey,
    runId,
    taskId,
  };
}

export function isIncompleteLegacyTerminalGenerationBinding(
  node: ProbeNodeType,
) {
  const kind = legacyGenerationNodeKind(node);
  if (!kind) return false;
  const data = node.data as Record<string, unknown>;
  return data[`${kind}Generating`] === true &&
    nonEmpty(data.workflowExecutionRunId) &&
    !legacyTerminalGenerationCandidate({ accountId: "_", canvasId: "_", node });
}

export function legacyTerminalGenerationCandidateStillMatches(
  node: ProbeNodeType | undefined,
  candidate: LegacyTerminalGenerationCandidate,
) {
  if (!node) return false;
  const current = legacyTerminalGenerationCandidate({
    accountId: candidate.accountId,
    canvasId: candidate.canvasId,
    node,
  });
  return Boolean(current &&
    current.runId === candidate.runId && current.taskId === candidate.taskId &&
    current.ownershipKey === candidate.ownershipKey &&
    current.inputFingerprint === candidate.inputFingerprint &&
    current.nodeDataFingerprint === candidate.nodeDataFingerprint &&
    current.kind === candidate.kind && current.nodeId === candidate.nodeId);
}

function htmlForPlainText(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br>");
  return `<p>${escaped}</p>`;
}

function terminalSuccessPatch(
  candidate: LegacyTerminalGenerationCandidate,
  task: GenerationTaskSummary,
) {
  const text = task.resultText?.trim() ?? "";
  const cleared = {
    [`${candidate.kind}GenerationError`]: undefined,
    [`${candidate.kind}GenerationErrorCode`]: undefined,
    [`${candidate.kind}GenerationInputKey`]: undefined,
    [`${candidate.kind}GenerationOwnershipKey`]: undefined,
    [`${candidate.kind}GenerationRetryAllowed`]: undefined,
    [`${candidate.kind}GenerationRetryBlockCode`]: undefined,
    [`${candidate.kind}GenerationRetryBlockReason`]: undefined,
    [`${candidate.kind}GenerationTaskId`]: undefined,
    [`${candidate.kind}Generating`]: false,
  };
  if (candidate.kind === "text") {
    if (!text) return undefined;
    const resultKey = groupRunResultKey({
      content: text,
      contentHtml: htmlForPlainText(text),
    });
    const proof = {
      groupRunSuccessOwnershipKey: candidate.ownershipKey,
      groupRunSuccessResultKey: resultKey,
      groupRunSuccessTaskId: candidate.taskId,
      workflowExecutionRunId: undefined,
    };
    return {
      patch: { ...proof, ...cleared, content: text, contentHtml: htmlForPlainText(text) },
      resultKey,
    };
  }
  if (
    !nonEmpty(task.resultAssetId) || !nonEmpty(task.resultUrl) ||
    !task.resultMedia || !checksumPattern.test(task.resultMedia.checksumSha256)
  ) return undefined;
  const resultKey = groupRunResultKey(task.resultUrl);
  const proof = {
    groupRunSuccessOwnershipKey: candidate.ownershipKey,
    groupRunSuccessResultKey: resultKey,
    groupRunSuccessTaskId: candidate.taskId,
    workflowExecutionRunId: undefined,
  };
  const metadata = trustedMediaPatch({
    assetId: task.resultAssetId,
    kind: candidate.kind,
    ...task.resultMedia,
  });
  if (candidate.kind === "image") {
    return {
      patch: {
        ...metadata,
        ...proof,
        ...cleared,
        assetId: task.resultAssetId,
        imageGeneratedSuccess: true,
        imageSrc: task.resultUrl,
      },
      resultKey,
    };
  }
  if (candidate.kind === "audio") {
    return {
      patch: {
        ...metadata,
        ...proof,
        ...cleared,
        assetId: task.resultAssetId,
        audioDuration: task.resultMedia.durationSeconds ?? undefined,
        audioFileSize: task.resultMedia.byteSize,
        audioGeneratedResult: true,
        audioResultChoices: task.resultOutputs?.map((output) => ({
          assetId: output.assetId,
          ...output.media,
          role: output.role,
          url: output.url,
        })),
        audioSrc: task.resultUrl,
        audioWaveform: undefined,
      },
      resultKey,
    };
  }
  return {
    patch: {
      ...metadata,
      ...proof,
      ...cleared,
      assetId: task.resultAssetId,
      videoCreatedAt: new Intl.DateTimeFormat("zh-CN").format(new Date()),
      videoSrc: task.resultUrl,
    },
    resultKey,
  };
}

export function classifyLegacyTerminalGenerationTask(input: {
  candidate: LegacyTerminalGenerationCandidate;
  task: GenerationTaskSummary;
}): LegacyTerminalGenerationDecision {
  const { candidate, task } = input;
  if (
    task.id !== candidate.taskId || task.canvasId !== candidate.canvasId ||
    task.nodeId !== candidate.nodeId || task.kind !== candidate.kind ||
    task.generationInputKey !== candidate.inputFingerprint ||
    task.generationOwnershipKey !== candidate.ownershipKey ||
    task.workflowExecutionRunId !== candidate.runId
  ) return { state: "UNKNOWN_BLOCKED" };
  if (activeStates.has(task.state)) {
    return { state: "ACTIVE_CONFIRMED", task };
  }
  if (!terminalStates.has(task.state)) return { state: "UNKNOWN_BLOCKED" };
  if (task.state !== "success") {
    return { state: "CONFLICT_PRESERVED", task };
  }
  const success = terminalSuccessPatch(candidate, task);
  if (!success) return { state: "CONFLICT_PRESERVED", task };
  const projectionBase = {
    accountId: candidate.accountId,
    canvasId: candidate.canvasId,
    dataPatch: success.patch,
    inputFingerprint: candidate.inputFingerprint,
    kind: candidate.kind,
    nodeId: candidate.nodeId,
    ownershipKey: candidate.ownershipKey,
    resultKey: success.resultKey,
    runId: candidate.runId,
    taskId: candidate.taskId,
  } satisfies Omit<GroupResultProjection, "applicationId" | "semanticRevision">;
  return {
    projection: {
      ...projectionBase,
      applicationId: groupResultProjectionApplicationId(projectionBase),
      semanticRevision: groupResultSemanticRevision(projectionBase),
      targetDataFingerprint: candidate.nodeDataFingerprint,
    },
    state: "RESTORED",
    task,
  };
}

export function legacyTerminalDetachApplicationId(
  candidate: LegacyTerminalGenerationCandidate,
  resultKey?: string,
) {
  return `legacy-terminal-detach:${stableValueFingerprint({
    ...candidate,
    resultKey,
  })}`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) {
    throw Object.assign(new Error(body.error ?? "状态核对失败"), {
      status: response.status,
    });
  }
  return body;
}

export async function getLegacyTerminalGenerationPolicy(
  canvasId: string,
  signal?: AbortSignal,
  timeoutMs = 10_000,
) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const callerAbort = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    onAbort = () => {
      controller.abort(signal.reason);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = globalThis.setTimeout(() => {
      controller.abort("legacy-terminal-policy-timeout");
      reject(new Error("孤立生成状态策略查询超时"));
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([
      (async () => responseJson<unknown>(await fetch(
        `/api/canvases/${encodeURIComponent(canvasId)}/generation-reconciliation-policy`,
        { cache: "no-store", signal: controller.signal },
      )))(),
      callerAbort,
      deadline,
    ]);
    return parseLegacyTerminalGenerationPolicy(value);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export async function detachLegacyTerminalGeneration(input: {
  candidate: LegacyTerminalGenerationCandidate;
  observedTerminalState: "cancelled" | "failed" | "success";
  resultKey?: string;
  signal?: AbortSignal;
}): Promise<{
  mutation: Omit<AuthoritativeGenerationCanvasMutation, "expected">;
  status: "already-detached" | "detached";
}> {
  const response = await fetch(
    `/api/canvases/${encodeURIComponent(input.candidate.canvasId)}/generation-terminal-detach`,
    {
      body: JSON.stringify({
        ...input.candidate,
        applicationId: legacyTerminalDetachApplicationId(
          input.candidate,
          input.resultKey,
        ),
        observedTerminalState: input.observedTerminalState,
        resultKey: input.resultKey,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: input.signal,
    },
  );
  const body = await responseJson<{
    clearedFields?: string[];
    dataPatch: Record<string, unknown>;
    document: AuthoritativeGenerationCanvasMutation["document"];
    status: "already-detached" | "detached";
  }>(response);
  return {
    mutation: {
      clearedFields: body.clearedFields,
      dataPatch: body.dataPatch,
      document: body.document,
    },
    status: body.status,
  };
}
