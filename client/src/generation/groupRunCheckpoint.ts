import type { ProbeNodeType } from "../canvas/ProbeNode";
import type { CuttableEdge } from "../canvas/canvasTypes";
import {
  groupRunSummaryScopeKey,
  type GroupRunSummaryScope,
} from "./groupRunSummary";
import type { WorkflowGraphNodeState } from "./workflowExecution";

export const GROUP_RUN_CHECKPOINT_EVENT = "unboundry:group-run-checkpoint";
export const GROUP_RUN_CONTINUE_EVENT = "unboundry:group-run-continue";
export const GROUP_RUN_STOP_EVENT = "unboundry:group-run-stop";
export const GROUP_RUN_LEASE_EVENT = "unboundry:group-run-lease";

const storagePrefix = "unboundry-group-run-checkpoint:v1:";
const leaseStoragePrefix = "unboundry-group-run-lease:v1:";
// Background tabs may throttle timers; a minute lease bounds stale ownership
// while leaving enough room for a delayed 5-second heartbeat.
export const groupRunLeaseTtlMs = 60_000;
export const groupRunLeaseHeartbeatMs = 5_000;
const activeMemoryRuns = new Map<string, { groupId: string; runId: string }>();
const heldGroupRunWebLocks = new Map<string, () => void>();

const executionOwnerId = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return `owner-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
})();

function stableCheckpointValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCheckpointValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableCheckpointValue(item)]),
    );
  }
  return value;
}

function checkpointFingerprint(value: unknown) {
  const source = JSON.stringify(stableCheckpointValue(value));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}

/** Stable result identity used by both the durable node proof and the checkpoint. */
export const groupRunResultKey = checkpointFingerprint;

export type GroupRunLease = {
  expiresAt: number;
  heartbeatAt: number;
  ownerId: string;
  runId: string;
};

export type GroupRunSuccessProof = {
  ownershipKey: string;
  resultKey: string;
  taskId: string;
};

export type GroupRunCheckpoint = GroupRunSummaryScope & {
  executableNodeIds: string[];
  groupId: string;
  nodeStates: Record<string, WorkflowGraphNodeState>;
  runId: string;
  snapshotFingerprint: string;
  startedAt: number;
  status: "preparing" | "running" | "stopping" | "interrupted";
  successProofs: Record<string, GroupRunSuccessProof>;
  lease?: GroupRunLease;
  updatedAt: number;
  version: 1;
};

function checkpointStorageKey(scope: GroupRunSummaryScope) {
  return `${storagePrefix}${groupRunSummaryScopeKey(scope)}`;
}

function leaseStorageKey(scope: GroupRunSummaryScope) {
  return `${leaseStoragePrefix}${groupRunSummaryScopeKey(scope)}`;
}

function heldWebLockKey(
  scope: GroupRunSummaryScope,
  runId: string,
  ownerId: string,
) {
  return JSON.stringify([groupRunSummaryScopeKey(scope), runId, ownerId]);
}

function hasHeldWebLock(runId: string, ownerId: string) {
  for (const key of heldGroupRunWebLocks.keys()) {
    try {
      const value = JSON.parse(key) as unknown;
      if (Array.isArray(value) && value[1] === runId && value[2] === ownerId) {
        return true;
      }
    } catch {
      // Internal keys are generated locally; ignore an impossible bad entry.
    }
  }
  return false;
}

function isLease(value: unknown): value is GroupRunLease {
  if (!value || typeof value !== "object") return false;
  const lease = value as Partial<GroupRunLease>;
  return typeof lease.ownerId === "string" && lease.ownerId.length > 0 &&
    typeof lease.runId === "string" && lease.runId.length > 0 &&
    typeof lease.heartbeatAt === "number" &&
    typeof lease.expiresAt === "number";
}

export function getGroupRunExecutionOwnerId() {
  return executionOwnerId;
}

export function markGroupRunStarting(
  scope: GroupRunSummaryScope,
  groupId: string,
  runId: string,
) {
  activeMemoryRuns.set(groupRunSummaryScopeKey(scope), { groupId, runId });
}

export function clearGroupRunStarting(
  scope: GroupRunSummaryScope,
  runId: string,
) {
  const key = groupRunSummaryScopeKey(scope);
  if (activeMemoryRuns.get(key)?.runId === runId) activeMemoryRuns.delete(key);
}

export function readGroupRunStarting(scope: GroupRunSummaryScope) {
  return activeMemoryRuns.get(groupRunSummaryScopeKey(scope));
}

export function isGroupRunLeaseActive(
  lease: GroupRunLease | undefined,
  now = Date.now(),
) {
  return Boolean(lease && lease.expiresAt > now);
}

export function readGroupRunLease(
  scope: GroupRunSummaryScope,
): GroupRunLease | undefined {
  try {
    const raw = window.localStorage.getItem(leaseStorageKey(scope));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return isLease(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function hasForeignActiveGroupRunLeaseForCanvas(canvasId: string) {
  if (typeof window === "undefined") return false;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(leaseStoragePrefix)) continue;
      const scopeValue = JSON.parse(key.slice(leaseStoragePrefix.length)) as unknown;
      if (!Array.isArray(scopeValue) || scopeValue[1] !== canvasId) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const lease = JSON.parse(raw) as unknown;
      if (!isLease(lease) || lease.ownerId === executionOwnerId) continue;
      if (isGroupRunLeaseActive(lease)) return true;
      const locks = (window.navigator as Navigator & {
        locks?: {
          request<T>(
            name: string,
            options: { ifAvailable: boolean },
            callback: (lock: unknown) => Promise<T> | T,
          ): Promise<T>;
        };
      }).locks;
      if (!locks) return true;
      const lockAvailable = await locks.request(
        `unboundry-group-run:${JSON.stringify(scopeValue)}`,
        { ifAvailable: true },
        (lock) => Boolean(lock),
      );
      if (!lockAvailable) return true;
      // The old tab no longer holds its Web Lock. Remove only the exact stale
      // lease we inspected so a newer owner cannot be deleted by this cleanup.
      if (window.localStorage.getItem(key) === raw) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Unreadable coordination state is treated as unsafe by submit callers.
    return true;
  }
  return false;
}

function dispatchLeaseEvent(scope: GroupRunSummaryScope) {
  try {
    window.dispatchEvent(new CustomEvent<GroupRunLease | undefined>(
      GROUP_RUN_LEASE_EVENT,
      { detail: readGroupRunLease(scope) },
    ));
  } catch {
    // The storage write remains the source of truth when event dispatch fails.
  }
}

function claimGroupRunLease(
  scope: GroupRunSummaryScope,
  runId: string,
  ownerId: string,
  now: number,
) {
  try {
    const current = readGroupRunLease(scope);
    if (isGroupRunLeaseActive(current, now) &&
      (current?.ownerId !== ownerId || current.runId !== runId)) {
      return false;
    }
    const next: GroupRunLease = {
      expiresAt: now + groupRunLeaseTtlMs,
      heartbeatAt: now,
      ownerId,
      runId,
    };
    window.localStorage.setItem(leaseStorageKey(scope), JSON.stringify(next));
    const verified = readGroupRunLease(scope);
    if (!verified || verified.ownerId !== ownerId || verified.runId !== runId) {
      return false;
    }
    dispatchLeaseEvent(scope);
    return true;
  } catch {
    return false;
  }
}

/**
 * The Web Lock is held for the whole run, not only for acquisition. Browsers
 * without that primitive are rejected for paid group execution because
 * localStorage alone cannot provide an atomic cross-tab fence.
 */
export async function acquireGroupRunLease(
  scope: GroupRunSummaryScope,
  runId: string,
  ownerId = executionOwnerId,
  now = Date.now(),
) {
  const locks = (window.navigator as Navigator & {
    locks?: {
      request<T>(
        name: string,
        options: { ifAvailable: boolean },
        callback: (lock: unknown) => Promise<T> | T,
      ): Promise<T>;
    };
  }).locks;
  if (!locks) return false;
  const holdKey = heldWebLockKey(scope, runId, ownerId);
  return new Promise<boolean>((resolve) => {
    let acquisitionSettled = false;
    const settle = (acquired: boolean) => {
      if (acquisitionSettled) return;
      acquisitionSettled = true;
      resolve(acquired);
    };
    void locks.request(
      `unboundry-group-run:${groupRunSummaryScopeKey(scope)}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock || !claimGroupRunLease(scope, runId, ownerId, now)) {
          settle(false);
          return false;
        }
        const held = new Promise<void>((release) => {
          heldGroupRunWebLocks.set(holdKey, release);
        });
        settle(true);
        await held;
        return true;
      },
    ).catch(() => settle(false));
  });
}

export function renewGroupRunLease(
  scope: GroupRunSummaryScope,
  runId: string,
  ownerId = executionOwnerId,
  now = Date.now(),
) {
  const current = readGroupRunLease(scope);
  if (!current || current.ownerId !== ownerId || current.runId !== runId ||
    !heldGroupRunWebLocks.has(heldWebLockKey(scope, runId, ownerId))) return false;
  return claimGroupRunLease(scope, runId, ownerId, now);
}

export function releaseGroupRunLease(
  scope: GroupRunSummaryScope,
  runId: string,
  ownerId = executionOwnerId,
) {
  const holdKey = heldWebLockKey(scope, runId, ownerId);
  const releaseWebLock = heldGroupRunWebLocks.get(holdKey);
  heldGroupRunWebLocks.delete(holdKey);
  try {
    const current = readGroupRunLease(scope);
    if (!current || current.ownerId !== ownerId || current.runId !== runId) {
      return false;
    }
    window.localStorage.removeItem(leaseStorageKey(scope));
    dispatchLeaseEvent(scope);
    return true;
  } catch {
    return false;
  } finally {
    releaseWebLock?.();
  }
}

function leaseMatches(
  lease: GroupRunLease | undefined,
  expected: { ownerId: string; runId: string } | undefined,
  now = Date.now(),
) {
  if (expected) {
    return Boolean(lease && lease.ownerId === expected.ownerId &&
      lease.runId === expected.runId &&
      (isGroupRunLeaseActive(lease, now) ||
        hasHeldWebLock(expected.runId, expected.ownerId)));
  }
  return !isGroupRunLeaseActive(lease, now);
}

function isCheckpoint(value: unknown): value is GroupRunCheckpoint {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<GroupRunCheckpoint>;
  return item.version === 1 &&
    typeof item.accountId === "string" &&
    typeof item.canvasId === "string" &&
    typeof item.fixtureScopeId === "string" &&
    typeof item.groupId === "string" && item.groupId.length > 0 &&
    typeof item.runId === "string" && item.runId.length > 0 &&
    typeof item.snapshotFingerprint === "string" &&
    Array.isArray(item.executableNodeIds) &&
    item.executableNodeIds.every((id) => typeof id === "string") &&
    Boolean(item.nodeStates && typeof item.nodeStates === "object") &&
    Boolean(item.successProofs && typeof item.successProofs === "object") &&
    typeof item.startedAt === "number" &&
    typeof item.updatedAt === "number" &&
    (item.lease === undefined || isLease(item.lease)) &&
    ["preparing", "running", "stopping", "interrupted"].includes(
      item.status ?? "",
    );
}

export function readGroupRunCheckpoint(
  scope: GroupRunSummaryScope,
): GroupRunCheckpoint | undefined {
  try {
    const raw = window.localStorage.getItem(checkpointStorageKey(scope));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (isCheckpoint(parsed) &&
      groupRunSummaryScopeKey(parsed) === groupRunSummaryScopeKey(scope)) {
      return parsed;
    }
  } catch {
    // A corrupt or unavailable browser store cannot be trusted for paid resume.
  }
  return undefined;
}

export function writeGroupRunCheckpoint(
  checkpoint: GroupRunCheckpoint,
  expectedLease?: { ownerId: string; runId: string },
) {
  try {
    const lease = readGroupRunLease(checkpoint);
    if (!leaseMatches(lease, expectedLease)) return false;
    const persisted = expectedLease
      ? {
          ...checkpoint,
          lease,
        }
      : checkpoint;
    window.localStorage.setItem(
      checkpointStorageKey(checkpoint),
      JSON.stringify(persisted),
    );
    const verified = readGroupRunCheckpoint(checkpoint);
    if (!verified || verified.runId !== checkpoint.runId) return false;
    window.dispatchEvent(new CustomEvent<GroupRunCheckpoint>(
      GROUP_RUN_CHECKPOINT_EVENT,
      { detail: verified },
    ));
    return true;
  } catch {
    return false;
  }
}

export function clearGroupRunCheckpoint(
  scope: GroupRunSummaryScope,
  expectedLease?: { ownerId: string; runId: string },
) {
  try {
    if (!leaseMatches(readGroupRunLease(scope), expectedLease)) return false;
    const current = readGroupRunCheckpoint(scope);
    if (expectedLease && current && current.runId !== expectedLease.runId) {
      return false;
    }
    window.localStorage.removeItem(checkpointStorageKey(scope));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent<GroupRunCheckpoint | undefined>(
    GROUP_RUN_CHECKPOINT_EVENT,
    { detail: undefined },
  ));
  return true;
}

export function requestGroupRunContinue(checkpoint: GroupRunCheckpoint) {
  window.dispatchEvent(new CustomEvent<GroupRunCheckpoint>(
    GROUP_RUN_CONTINUE_EVENT,
    { detail: checkpoint },
  ));
}

export function requestGroupRunStop(input: {
  groupId: string;
  runId: string;
  scope: GroupRunSummaryScope;
}) {
  window.dispatchEvent(new CustomEvent(
    GROUP_RUN_STOP_EVENT,
    { detail: input },
  ));
}

export function confirmGroupRunNavigation(scope: GroupRunSummaryScope) {
  const checkpoint = readGroupRunCheckpoint(scope);
  const starting = readGroupRunStarting(scope);
  const activeCheckpoint = checkpoint &&
    ["preparing", "running", "stopping"].includes(checkpoint.status)
    ? checkpoint
    : undefined;
  if (!activeCheckpoint && !starting) {
    return true;
  }
  const confirmed = window.confirm(
    "整组仍在执行。离开后不会再启动尚未提交的后续节点；已经提交的任务仍会继续并保存结果。确定离开吗？",
  );
  if (!confirmed) return false;
  if (!activeCheckpoint) {
    requestGroupRunStop({
      groupId: starting!.groupId,
      runId: starting!.runId,
      scope,
    });
    return true;
  }
  const lease = readGroupRunLease(scope);
  if (isGroupRunLeaseActive(lease) && lease?.ownerId !== executionOwnerId) {
    // Another tab owns the active run; navigation must not overwrite its
    // interrupted marker or make its provider stop unexpectedly.
    return false;
  }
  const expectedLease = lease && lease.ownerId === executionOwnerId
    ? { ownerId: lease.ownerId, runId: lease.runId }
    : undefined;
  const written = writeGroupRunCheckpoint({
    ...activeCheckpoint,
    status: "interrupted",
    updatedAt: Date.now(),
  }, expectedLease);
  if (!written) return false;
  requestGroupRunStop({
    groupId: activeCheckpoint.groupId,
    runId: activeCheckpoint.runId,
    scope,
  });
  return true;
}

function executableConfiguration(
  node: ProbeNodeType,
  executable: boolean,
) {
  const common = {
    assetId: executable ? undefined : node.data.assetId,
    audioSrc: executable ? undefined : node.data.audioSrc,
    content: executable ? undefined : node.data.content,
    contentHtml: executable ? undefined : node.data.contentHtml,
    id: node.id,
    imageSrc: executable ? undefined : node.data.imageSrc,
    inputState: node.data.inputState,
    parentId: node.parentId,
    sourceKind: node.data.sourceKind,
    type: node.type,
    videoSrc: executable ? undefined : node.data.videoSrc,
  };
  if (node.type === "text") {
    return {
      ...common,
      modelId: node.data.textModelId,
      parameters: node.data.textParameters,
      prompt: node.data.textPrompt,
      promptReady: node.data.textPromptReady,
    };
  }
  if (node.type === "image") {
    return {
      ...common,
      aspectRatio: node.data.imageAspectRatio,
      modelId: node.data.imageModelId,
      parameters: node.data.imageParameters,
      prompt: node.data.imagePrompt,
      promptReady: node.data.imagePromptReady,
      quality: node.data.imageQuality,
    };
  }
  if (node.type === "video") {
    return {
      ...common,
      audioEnabled: node.data.videoAudioEnabled,
      duration: node.data.videoDuration,
      modelId: node.data.videoModelId ?? node.data.videoModel,
      parameters: node.data.videoParameters,
      prompt: node.data.videoPrompt,
      promptReady: node.data.videoPromptReady,
    };
  }
  if (node.type === "audio") {
    return {
      ...common,
      modelId: node.data.audioModelId,
      parameters: node.data.audioParameters,
      prompt: node.data.audioPrompt,
      promptReady: node.data.audioPromptReady,
    };
  }
  return common;
}

export function groupRunSnapshotFingerprint(input: {
  edges: readonly CuttableEdge[];
  executableNodeIds: ReadonlySet<string>;
  groupId: string;
  nodes: readonly ProbeNodeType[];
}) {
  const childIds = new Set(
    input.nodes
      .filter((node) => node.parentId === input.groupId)
      .map((node) => node.id),
  );
  const snapshotNodeIds = new Set(childIds);
  for (const edge of input.edges) {
    if (childIds.has(edge.target)) snapshotNodeIds.add(edge.source);
  }
  const nodes = input.nodes
    .filter((node) => snapshotNodeIds.has(node.id))
    .map((node) => executableConfiguration(
      node,
      input.executableNodeIds.has(node.id),
    ))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = input.edges
    .filter((edge) => childIds.has(edge.target))
    .map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? null,
      target: edge.target,
      targetHandle: edge.targetHandle ?? null,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return checkpointFingerprint({ edges, groupId: input.groupId, nodes });
}

export function groupRunSuccessProof(
  node: ProbeNodeType | undefined,
): GroupRunSuccessProof | undefined {
  if (!node) return undefined;
  const kind = node.type;
  if (!kind || !["audio", "image", "text", "video"].includes(kind)) {
    return undefined;
  }
  const data = node.data as Record<string, unknown>;
  const taskId = data.groupRunSuccessTaskId;
  const ownershipKey = data.groupRunSuccessOwnershipKey;
  const result = kind === "text"
    ? { content: node.data.content, contentHtml: node.data.contentHtml }
    : kind === "image"
      ? node.data.imageSrc
      : kind === "video"
        ? node.data.videoSrc
        : node.data.audioSrc;
  const resultPresent = kind === "text"
    ? Boolean(node.data.content || node.data.contentHtml)
    : typeof result === "string" && result.length > 0;
  return typeof taskId === "string" && taskId &&
      typeof ownershipKey === "string" && ownershipKey && resultPresent
    ? { ownershipKey, resultKey: checkpointFingerprint(result), taskId }
    : undefined;
}

export function verifiedCheckpointSuccessIds(
  checkpoint: GroupRunCheckpoint,
  nodes: readonly ProbeNodeType[],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const verified = new Set<string>();
  const successfulNodeIds = Object.entries(checkpoint.nodeStates)
    .filter(([, state]) => state === "success")
    .map(([nodeId]) => nodeId);
  for (const nodeId of successfulNodeIds) {
    const expected = checkpoint.successProofs[nodeId];
    if (!expected) {
      return { mismatchNodeId: nodeId, verified };
    }
    const actual = groupRunSuccessProof(nodeById.get(nodeId));
    if (!actual ||
      actual.taskId !== expected.taskId ||
      actual.ownershipKey !== expected.ownershipKey ||
      actual.resultKey !== expected.resultKey) {
      return {
        mismatchNodeId: nodeId,
        verified,
      };
    }
    verified.add(nodeId);
  }
  return { verified };
}
