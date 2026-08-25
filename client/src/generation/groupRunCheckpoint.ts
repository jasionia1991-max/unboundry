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
const activeMemoryRuns = new Map<
  string,
  Map<string, { groupId: string; runId: string }>
>();
const heldGroupRunWebLocks = new Map<string, () => void>();

type BrowserLockManager = {
  request<T>(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<T> | T,
  ): Promise<T>;
};

function browserLocks(): BrowserLockManager | undefined {
  if (typeof window === "undefined") return undefined;
  return (window.navigator as (Navigator & { locks?: BrowserLockManager }) | undefined)
    ?.locks;
}

/**
 * Cross-tab admission boundary shared by manual task mutations and group-run
 * lease claims. Browsers without Web Locks can still submit manually because
 * group execution itself is disabled there.
 */
export function runWithGroupRunCanvasAdmission<T>(
  canvasId: string,
  work: () => Promise<T> | T,
): Promise<T> {
  const locks = browserLocks();
  if (!locks) return Promise.resolve().then(work);
  return locks.request(
    `unboundry-group-run-canvas-admission:${JSON.stringify(canvasId)}`,
    { ifAvailable: false },
    (lock) => {
      if (!lock) throw new Error("无法取得画布生成互斥锁");
      return work();
    },
  );
}

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
  lockedNodeIds: string[];
  ownerId: string;
  runId: string;
};

export type GroupRunSuccessProof = {
  ownershipKey: string;
  resultKey: string;
  taskId: string;
};

export type AcceptedTaskBinding = {
  kind: "audio" | "image" | "text" | "video";
  nodeId: string;
  ownershipKey: string;
  taskId: string;
};

export function taskMatchesAcceptedBinding(
  binding: AcceptedTaskBinding | undefined,
  task: { id: string; kind: AcceptedTaskBinding["kind"]; nodeId: string },
) {
  return Boolean(
    binding &&
    binding.kind === task.kind &&
    binding.nodeId === task.nodeId &&
    binding.taskId === task.id,
  );
}

export type GroupRunCheckpoint = GroupRunSummaryScope & {
  acceptedTasks?: Record<string, AcceptedTaskBinding>;
  executableNodeIds: string[];
  groupId: string;
  nodeStates: Record<string, WorkflowGraphNodeState>;
  projectionPendingNodeIds?: string[];
  runId: string;
  snapshotFingerprint: string;
  startedAt: number;
  status: "preparing" | "running" | "stopping" | "interrupted";
  successProofs: Record<string, GroupRunSuccessProof>;
  lease?: GroupRunLease;
  updatedAt: number;
  version: 1;
};

function checkpointStorageKey(scope: GroupRunSummaryScope, runId?: string) {
  if (runId) {
    return `${storagePrefix}${JSON.stringify([
      scope.accountId,
      scope.canvasId,
      scope.fixtureScopeId,
      runId,
    ])}`;
  }
  return `${storagePrefix}${groupRunSummaryScopeKey(scope)}`;
}

function leaseStorageKey(scope: GroupRunSummaryScope, runId?: string) {
  if (runId) {
    return `${leaseStoragePrefix}${JSON.stringify([
      scope.accountId,
      scope.canvasId,
      scope.fixtureScopeId,
      runId,
    ])}`;
  }
  return `${leaseStoragePrefix}${groupRunSummaryScopeKey(scope)}`;
}

function storageKeyMatchesScope(
  key: string,
  prefix: string,
  scope: GroupRunSummaryScope,
) {
  if (!key.startsWith(prefix)) return false;
  try {
    const value = JSON.parse(key.slice(prefix.length)) as unknown;
    return Array.isArray(value) && value[0] === scope.accountId &&
      value[1] === scope.canvasId && value[2] === scope.fixtureScopeId;
  } catch {
    return false;
  }
}

function heldWebLockKey(
  scope: GroupRunSummaryScope,
  runId: string,
  ownerId: string,
) {
  return JSON.stringify([groupRunSummaryScopeKey(scope), runId, ownerId]);
}

function groupRunWebLockName(scope: GroupRunSummaryScope, runId: string) {
  return `unboundry-group-run:${groupRunSummaryScopeKey(scope)}:${runId}`;
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
    (lease.lockedNodeIds === undefined ||
      (Array.isArray(lease.lockedNodeIds) &&
        lease.lockedNodeIds.every((id) => typeof id === "string"))) &&
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
  const key = groupRunSummaryScopeKey(scope);
  const runs = activeMemoryRuns.get(key) ?? new Map();
  runs.set(runId, { groupId, runId });
  activeMemoryRuns.set(key, runs);
}

export function clearGroupRunStarting(
  scope: GroupRunSummaryScope,
  runId: string,
) {
  const key = groupRunSummaryScopeKey(scope);
  const runs = activeMemoryRuns.get(key);
  runs?.delete(runId);
  if (runs?.size === 0) activeMemoryRuns.delete(key);
}

export function readGroupRunStarting(scope: GroupRunSummaryScope) {
  return readGroupRunStartings(scope).at(-1);
}

export function readGroupRunStartings(scope: GroupRunSummaryScope) {
  return [...(activeMemoryRuns.get(groupRunSummaryScopeKey(scope))?.values() ?? [])];
}

export function isGroupRunLeaseActive(
  lease: GroupRunLease | undefined,
  now = Date.now(),
) {
  return Boolean(lease && lease.expiresAt > now);
}

export function readGroupRunLease(
  scope: GroupRunSummaryScope,
  runId?: string,
): GroupRunLease | undefined {
  try {
    const leases = readGroupRunLeases(scope);
    return runId
      ? leases.find((lease) => lease.runId === runId)
      : leases.sort((left, right) => right.heartbeatAt - left.heartbeatAt)[0];
  } catch {
    return undefined;
  }
}

function readGroupRunLeases(scope: GroupRunSummaryScope): GroupRunLease[] {
  try {
    const leases = new Map<string, GroupRunLease>();
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !storageKeyMatchesScope(key, leaseStoragePrefix, scope)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      const values = isLease(parsed)
        ? [parsed]
        : parsed && typeof parsed === "object"
          ? Object.values(parsed as Record<string, unknown>).filter(isLease)
          : [];
      for (const lease of values) {
        leases.set(lease.runId, {
          ...lease,
          lockedNodeIds: lease.lockedNodeIds ?? [],
        });
      }
    }
    return [...leases.values()];
  } catch {
    return [];
  }
}

async function hasActiveGroupRunLeaseForCanvas(
  canvasId: string,
  nodeId?: string,
  allowedRunId?: string,
  foreignOnly = false,
) {
  if (typeof window === "undefined") return false;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(leaseStoragePrefix)) continue;
      const scopeValue = JSON.parse(key.slice(leaseStoragePrefix.length)) as unknown;
      if (!Array.isArray(scopeValue) || scopeValue[1] !== canvasId) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      const leases = isLease(parsed)
        ? [parsed]
        : parsed && typeof parsed === "object"
          ? Object.values(parsed as Record<string, unknown>).filter(isLease)
          : [];
      const candidates = leases.filter((lease) =>
        lease.runId !== allowedRunId &&
        (!foreignOnly || lease.ownerId !== executionOwnerId) &&
        (!nodeId || lease.lockedNodeIds === undefined ||
          lease.lockedNodeIds.length === 0 || lease.lockedNodeIds.includes(nodeId))
      );
      if (candidates.some((lease) => isGroupRunLeaseActive(lease))) return true;
      if (candidates.length === 0) continue;
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
      for (const candidate of candidates) {
        const lockAvailable = await locks.request(
          groupRunWebLockName({
            accountId: String(scopeValue[0]),
            canvasId: String(scopeValue[1]),
            fixtureScopeId: String(scopeValue[2]),
          }, candidate.runId),
          { ifAvailable: true },
          (lock) => Boolean(lock),
        );
        if (!lockAvailable) return true;
        // The old run no longer holds its Web Lock. Remove only the exact stale
        // lease inspected so a newer or sibling run cannot be deleted.
        if (window.localStorage.getItem(key) === raw) {
          if (Array.isArray(scopeValue) && scopeValue.length >= 4) {
            window.localStorage.removeItem(key);
            continue;
          }
          const retained = leases.filter((lease) => lease.runId !== candidate.runId);
          if (retained.length === 0) window.localStorage.removeItem(key);
          else {
            window.localStorage.setItem(
              key,
              JSON.stringify(Object.fromEntries(
                retained.map((lease) => [lease.runId, lease]),
              )),
            );
          }
        }
      }
    }
  } catch {
    // Unreadable coordination state is treated as unsafe by submit callers.
    return true;
  }
  return false;
}

function removeExactStaleGroupRunLease(
  scope: GroupRunSummaryScope,
  expected: GroupRunLease,
) {
  const exactKey = leaseStorageKey(scope, expected.runId);
  const exactRaw = window.localStorage.getItem(exactKey);
  if (exactRaw) {
    const exact = JSON.parse(exactRaw) as unknown;
    if (
      isLease(exact) &&
      exact.runId === expected.runId &&
      exact.ownerId === expected.ownerId &&
      exact.heartbeatAt === expected.heartbeatAt &&
      exact.expiresAt === expected.expiresAt
    ) {
      window.localStorage.removeItem(exactKey);
    }
  }

  const legacyKey = leaseStorageKey(scope);
  const legacyRaw = window.localStorage.getItem(legacyKey);
  if (!legacyRaw) return;
  const legacy = JSON.parse(legacyRaw) as unknown;
  if (isLease(legacy)) {
    if (
      legacy.runId === expected.runId &&
      legacy.ownerId === expected.ownerId &&
      legacy.heartbeatAt === expected.heartbeatAt &&
      legacy.expiresAt === expected.expiresAt
    ) window.localStorage.removeItem(legacyKey);
    return;
  }
  if (!legacy || typeof legacy !== "object") return;
  const retained = Object.values(legacy as Record<string, unknown>)
    .filter(isLease)
    .filter((lease) => !(
      lease.runId === expected.runId &&
      lease.ownerId === expected.ownerId &&
      lease.heartbeatAt === expected.heartbeatAt &&
      lease.expiresAt === expected.expiresAt
    ));
  if (retained.length === 0) window.localStorage.removeItem(legacyKey);
  else {
    window.localStorage.setItem(
      legacyKey,
      JSON.stringify(Object.fromEntries(
        retained.map((lease) => [lease.runId, lease]),
      )),
    );
  }
}

async function clearRecoverableSameRunLease(
  locks: BrowserLockManager,
  scope: GroupRunSummaryScope,
  runId: string,
) {
  const stale = readGroupRunLease(scope, runId);
  if (!stale) return true;
  if (
    isGroupRunLeaseActive(stale) &&
    hasHeldWebLock(stale.runId, stale.ownerId)
  ) return false;
  const lockAvailable = await locks.request(
    groupRunWebLockName(scope, runId),
    { ifAvailable: true },
    (lock) => Boolean(lock),
  ).catch(() => false);
  if (!lockAvailable) return false;
  const verified = readGroupRunLease(scope, runId);
  if (
    !verified ||
    verified.ownerId !== stale.ownerId ||
    verified.runId !== stale.runId ||
    verified.heartbeatAt !== stale.heartbeatAt ||
    verified.expiresAt !== stale.expiresAt ||
    verified.lockedNodeIds.join("\u0000") !== stale.lockedNodeIds.join("\u0000")
  ) return !verified;
  try {
    removeExactStaleGroupRunLease(scope, verified);
    dispatchLeaseEvent(scope);
    return !readGroupRunLease(scope, runId);
  } catch {
    return false;
  }
}

export async function hasForeignActiveGroupRunLeaseForCanvas(
  canvasId: string,
  nodeId?: string,
) {
  return hasActiveGroupRunLeaseForCanvas(canvasId, nodeId, undefined, true);
}

export async function hasConflictingActiveGroupRunLeaseForCanvas(
  canvasId: string,
  nodeId?: string,
  allowedRunId?: string,
) {
  return hasActiveGroupRunLeaseForCanvas(canvasId, nodeId, allowedRunId);
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
  lockedNodeIds: readonly string[],
) {
  try {
    const requestedLocks = new Set(lockedNodeIds);
    const current = readGroupRunLeases(scope);
    for (const lease of current) {
      if (lease.runId === runId) {
        if (lease.ownerId !== ownerId) return false;
        if (
          isGroupRunLeaseActive(lease, now) &&
          !heldGroupRunWebLocks.has(heldWebLockKey(scope, runId, ownerId))
        ) return false;
        continue;
      }
      if (!isGroupRunLeaseActive(lease, now)) continue;
      if (lease.lockedNodeIds.some((nodeId) => requestedLocks.has(nodeId))) {
        return false;
      }
    }
    const next: GroupRunLease = {
      expiresAt: now + groupRunLeaseTtlMs,
      heartbeatAt: now,
      lockedNodeIds: [...new Set(lockedNodeIds)].sort(),
      ownerId,
      runId,
    };
    window.localStorage.setItem(
      leaseStorageKey(scope, runId),
      JSON.stringify(next),
    );
    const verified = readGroupRunLease(scope, runId);
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
  lockedNodeIds: readonly string[] = [],
  admissionCheck?: () => Promise<boolean>,
) {
  const locks = browserLocks();
  if (!locks) return false;
  return runWithGroupRunCanvasAdmission(scope.canvasId, async () => {
    const admittedAt = Math.max(now, Date.now());
    if (!await clearRecoverableSameRunLease(locks, scope, runId)) {
      return false;
    }
    const conflictNodeIds = lockedNodeIds.length > 0
      ? [...new Set(lockedNodeIds)]
      : [undefined];
    for (const nodeId of conflictNodeIds) {
      if (await hasConflictingActiveGroupRunLeaseForCanvas(
        scope.canvasId,
        nodeId,
        runId,
      )) return false;
    }
    if (admissionCheck && !await admissionCheck()) return false;
    const holdKey = heldWebLockKey(scope, runId, ownerId);
    const claimed = await locks.request(
      `unboundry-group-run-claim:${groupRunSummaryScopeKey(scope)}`,
      { ifAvailable: false },
      (lock) => Boolean(lock) && claimGroupRunLease(
        scope,
        runId,
        ownerId,
        Math.max(admittedAt, Date.now()),
        lockedNodeIds,
      ),
    ).catch(() => false);
    if (!claimed) return false;
    return new Promise<boolean>((resolve) => {
      let acquisitionSettled = false;
      const settle = (acquired: boolean) => {
        if (acquisitionSettled) return;
        acquisitionSettled = true;
        resolve(acquired);
      };
      void locks.request(
        groupRunWebLockName(scope, runId),
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            releaseGroupRunLease(scope, runId, ownerId);
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
  });
}

export async function renewGroupRunLease(
  scope: GroupRunSummaryScope,
  runId: string,
  ownerId = executionOwnerId,
  now = Date.now(),
) {
  const locks = browserLocks();
  const holdKey = heldWebLockKey(scope, runId, ownerId);
  if (!locks || !heldGroupRunWebLocks.has(holdKey)) return false;
  return runWithGroupRunCanvasAdmission(scope.canvasId, () => locks.request(
    `unboundry-group-run-claim:${groupRunSummaryScopeKey(scope)}`,
    { ifAvailable: false },
    (lock) => {
      if (!lock || !heldGroupRunWebLocks.has(holdKey)) return false;
      const current = readGroupRunLease(scope, runId);
      if (
        !current ||
        current.ownerId !== ownerId ||
        current.runId !== runId
      ) return false;
      return claimGroupRunLease(
        scope,
        runId,
        ownerId,
        Math.max(now, Date.now()),
        current.lockedNodeIds,
      );
    },
  )).catch(() => false);
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
    const current = readGroupRunLease(scope, runId);
    if (!current || current.ownerId !== ownerId || current.runId !== runId) {
      return false;
    }
    window.localStorage.removeItem(leaseStorageKey(scope, runId));
    // A v1 beta stored all runs under the scope-only key. Remove only the
    // released entry while preserving compatibility with interrupted runs.
    const legacyKey = leaseStorageKey(scope);
    const legacyRaw = window.localStorage.getItem(legacyKey);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as unknown;
      if (isLease(parsed)) {
        if (parsed.runId === runId) window.localStorage.removeItem(legacyKey);
      } else if (parsed && typeof parsed === "object") {
        const retained = Object.values(parsed as Record<string, unknown>)
          .filter(isLease)
          .filter((lease) => lease.runId !== runId);
        if (retained.length === 0) window.localStorage.removeItem(legacyKey);
        else window.localStorage.setItem(legacyKey, JSON.stringify(
          Object.fromEntries(retained.map((lease) => [lease.runId, lease])),
        ));
      }
    }
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
  const acceptedTasks = item.acceptedTasks;
  const acceptedTasksValid = acceptedTasks === undefined || (
    acceptedTasks !== null && typeof acceptedTasks === "object" &&
    Object.entries(acceptedTasks).every(([nodeId, candidate]) => {
      if (!candidate || typeof candidate !== "object") return false;
      const binding = candidate as Partial<AcceptedTaskBinding>;
      return binding.nodeId === nodeId &&
        ["audio", "image", "text", "video"].includes(binding.kind ?? "") &&
        typeof binding.taskId === "string" && binding.taskId.length > 0 &&
        typeof binding.ownershipKey === "string" &&
        binding.ownershipKey.length > 0 &&
        item.executableNodeIds?.includes(nodeId) === true;
    })
  );
  const projectionPendingNodeIdsValid =
    item.projectionPendingNodeIds === undefined ||
    (Array.isArray(item.projectionPendingNodeIds) &&
      new Set(item.projectionPendingNodeIds).size ===
        item.projectionPendingNodeIds.length &&
      item.projectionPendingNodeIds.every((nodeId) =>
        typeof nodeId === "string" &&
        item.executableNodeIds?.includes(nodeId) === true
      ));
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
    acceptedTasksValid &&
    projectionPendingNodeIdsValid &&
    typeof item.startedAt === "number" &&
    typeof item.updatedAt === "number" &&
    (item.lease === undefined || isLease(item.lease)) &&
    ["preparing", "running", "stopping", "interrupted"].includes(
      item.status ?? "",
    );
}

export function readGroupRunCheckpoint(
  scope: GroupRunSummaryScope,
  runId?: string,
): GroupRunCheckpoint | undefined {
  try {
    const checkpoints = readGroupRunCheckpoints(scope);
    const matching = checkpoints.filter((checkpoint) =>
      groupRunSummaryScopeKey(checkpoint) === groupRunSummaryScopeKey(scope)
    );
    return runId
      ? matching.find((checkpoint) => checkpoint.runId === runId)
      : matching.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  } catch {
    // A corrupt or unavailable browser store cannot be trusted for paid resume.
  }
  return undefined;
}

export function readGroupRunCheckpoints(scope: GroupRunSummaryScope) {
  try {
    const checkpoints = new Map<string, GroupRunCheckpoint>();
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !storageKeyMatchesScope(key, storagePrefix, scope)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      const values = isCheckpoint(parsed)
        ? [parsed]
        : parsed && typeof parsed === "object"
          ? Object.values(parsed as Record<string, unknown>).filter(isCheckpoint)
          : [];
      for (const checkpoint of values) checkpoints.set(checkpoint.runId, checkpoint);
    }
    return [...checkpoints.values()]
      .filter((checkpoint) =>
        groupRunSummaryScopeKey(checkpoint) === groupRunSummaryScopeKey(scope)
      )
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

export function writeGroupRunCheckpoint(
  checkpoint: GroupRunCheckpoint,
  expectedLease?: { ownerId: string; runId: string },
) {
  try {
    if (expectedLease && checkpoint.runId !== expectedLease.runId) return false;
    const lease = expectedLease
      ? readGroupRunLease(checkpoint, expectedLease.runId)
      : readGroupRunLease(checkpoint, checkpoint.runId);
    if (!leaseMatches(lease, expectedLease)) return false;
    const persisted = expectedLease
      ? {
          ...checkpoint,
          lease,
        }
      : checkpoint;
    const key = checkpointStorageKey(checkpoint, checkpoint.runId);
    window.localStorage.setItem(key, JSON.stringify(persisted));
    const verified = readGroupRunCheckpoint(checkpoint, checkpoint.runId);
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
  targetRunId = expectedLease?.runId,
) {
  try {
    if (expectedLease && targetRunId !== expectedLease.runId) return false;
    const lease = expectedLease
      ? readGroupRunLease(scope, expectedLease.runId)
      : targetRunId
        ? readGroupRunLease(scope, targetRunId)
        : readGroupRunLease(scope);
    if (!leaseMatches(lease, expectedLease)) return false;
    const current = targetRunId
      ? readGroupRunCheckpoint(scope, targetRunId)
      : readGroupRunCheckpoint(scope);
    if (expectedLease && current && current.runId !== expectedLease.runId) {
      return false;
    }
    const key = checkpointStorageKey(scope);
    if (!targetRunId) {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const candidate = window.localStorage.key(index);
        if (candidate && storageKeyMatchesScope(candidate, storagePrefix, scope)) {
          window.localStorage.removeItem(candidate);
        }
      }
    } else {
      window.localStorage.removeItem(checkpointStorageKey(scope, targetRunId));
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isCheckpoint(parsed)) {
          if (parsed.runId === targetRunId) window.localStorage.removeItem(key);
        } else if (parsed && typeof parsed === "object") {
          const retained = Object.values(parsed as Record<string, unknown>)
            .filter(isCheckpoint)
            .filter((checkpoint) => checkpoint.runId !== targetRunId);
          if (retained.length === 0) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, JSON.stringify(
            Object.fromEntries(retained.map((checkpoint) => [checkpoint.runId, checkpoint])),
          ));
        }
      }
    }
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
  const activeCheckpoints = readGroupRunCheckpoints(scope).filter((checkpoint) =>
    ["preparing", "running", "stopping"].includes(checkpoint.status)
  );
  const activeRunIds = new Set(activeCheckpoints.map((checkpoint) => checkpoint.runId));
  const startings = readGroupRunStartings(scope).filter((starting) =>
    !activeRunIds.has(starting.runId)
  );
  if (activeCheckpoints.length === 0 && startings.length === 0) return true;
  const confirmed = window.confirm(
    "整组仍在执行。离开后不会再启动尚未提交的后续节点；已经提交的任务仍会继续并保存结果。确定离开吗？",
  );
  if (!confirmed) return false;
  const ownedLeases = new Map<string, GroupRunLease>();
  for (const checkpoint of activeCheckpoints) {
    const lease = readGroupRunLease(scope, checkpoint.runId);
    if (isGroupRunLeaseActive(lease) && lease?.ownerId !== executionOwnerId) {
      // Another tab owns this exact run. Do not partially interrupt sibling
      // runs before the whole navigation decision is known to be safe.
      return false;
    }
    if (lease?.ownerId === executionOwnerId) ownedLeases.set(checkpoint.runId, lease);
  }
  for (const checkpoint of activeCheckpoints) {
    const lease = ownedLeases.get(checkpoint.runId);
    const expectedLease = lease
      ? { ownerId: lease.ownerId, runId: lease.runId }
      : undefined;
    const written = writeGroupRunCheckpoint({
      ...checkpoint,
      status: "interrupted",
      updatedAt: Date.now(),
    }, expectedLease);
    if (!written) return false;
    requestGroupRunStop({
      groupId: checkpoint.groupId,
      runId: checkpoint.runId,
      scope,
    });
  }
  for (const starting of startings) {
    requestGroupRunStop({ groupId: starting.groupId, runId: starting.runId, scope });
  }
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
