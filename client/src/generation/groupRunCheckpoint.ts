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
export const GROUP_RUN_AUTHORITY_EVENT = "unboundry:group-run-authority";

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
const quarantinedCorruptStorageEntries = new Map<
  string,
  { canvasId: string; values: Map<string, string> }
>();
const authoritySettledEmptyScopes = new Set<string>();

type BrowserLockManager = {
  query?(): Promise<{
    held?: Array<{ name?: string | null }>;
    pending?: Array<{ name?: string | null }>;
  }>;
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

export function groupRunAuthorityRecoverySupported() {
  return typeof browserLocks()?.query === "function";
}

export function isGroupRunAuthoritySettledEmpty(scope: GroupRunSummaryScope) {
  return authoritySettledEmptyScopes.has(groupRunSummaryScopeKey(scope));
}

export function setGroupRunAuthoritySettledEmpty(
  scope: GroupRunSummaryScope,
  settled: boolean,
) {
  const key = groupRunSummaryScopeKey(scope);
  const changed = settled
    ? !authoritySettledEmptyScopes.has(key)
    : authoritySettledEmptyScopes.has(key);
  if (settled) authoritySettledEmptyScopes.add(key);
  else authoritySettledEmptyScopes.delete(key);
  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<GroupRunSummaryScope>(
      GROUP_RUN_AUTHORITY_EVENT,
      { detail: scope },
    ));
  }
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
  inputFingerprint?: string;
  modelConfigurationRevision?: string;
  modelReleaseRevision?: string;
  ownershipKey: string;
  resultKey: string;
  taskId: string;
};

export type AcceptedTaskBinding = {
  inputFingerprint?: string;
  kind: "audio" | "image" | "text" | "video";
  modelInputContractFingerprint: string;
  modelConfigurationRevision?: string;
  modelReleaseRevision?: string;
  nodeId: string;
  ownershipKey: string;
  taskId: string;
};

export function taskMatchesAcceptedBinding(
  binding: AcceptedTaskBinding | undefined,
  task: {
    generationIdentityVersion?: 2;
    generationInputKey?: string;
    generationOwnershipKey?: string;
    id: string;
    kind: AcceptedTaskBinding["kind"];
    modelInputContractFingerprint?: string;
    modelConfigurationRevision?: string;
    modelReleaseRevision?: string;
    nodeId: string;
  },
) {
  return Boolean(
    binding &&
    binding.kind === task.kind &&
    binding.nodeId === task.nodeId &&
    binding.taskId === task.id &&
    task.generationIdentityVersion === 2 &&
    Boolean(binding.inputFingerprint) &&
    binding.inputFingerprint === task.generationInputKey &&
    binding.ownershipKey === task.generationOwnershipKey &&
    binding.modelInputContractFingerprint ===
      task.modelInputContractFingerprint &&
    Boolean(binding.modelConfigurationRevision) &&
    binding.modelConfigurationRevision === task.modelConfigurationRevision &&
    Boolean(binding.modelReleaseRevision) &&
    binding.modelReleaseRevision === task.modelReleaseRevision,
  );
}

export type GroupRunCheckpoint = GroupRunSummaryScope & {
  acceptedTasks?: Record<string, AcceptedTaskBinding>;
  executableNodeIds: string[];
  groupId: string;
  nodeStates: Record<string, WorkflowGraphNodeState>;
  projectionPendingNodeIds?: string[];
  resumeMode?: "accepted-only" | "current-graph";
  runId: string;
  snapshotFingerprint: string;
  startedAt: number;
  status: "preparing" | "running" | "stopping" | "interrupted";
  successProofs: Record<string, GroupRunSuccessProof>;
  lease?: GroupRunLease;
  updatedAt: number;
  version: 1 | 2;
};

export type GroupRunCheckpointCacheRead = {
  checkpoints: GroupRunCheckpoint[];
  corrupted: boolean;
  quarantined: boolean;
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

type ScopedStorageKey = Readonly<{
  exactRunId?: string;
  kind: "exact" | "legacy";
}>;

type StorageScopeTuple =
  | readonly [string, string, string]
  | readonly [string, string, string, string];

function parseStorageScopeTuple(
  key: string,
  prefix: string,
): { corrupted: boolean; value?: StorageScopeTuple } {
  if (!key.startsWith(prefix)) return { corrupted: false };
  try {
    const value = JSON.parse(key.slice(prefix.length)) as unknown;
    const structurallyValid = Array.isArray(value) &&
      (value.length === 3 || value.length === 4) &&
      typeof value[0] === "string" && value[0].length > 0 &&
      typeof value[1] === "string" && value[1].length > 0 &&
      typeof value[2] === "string" &&
      (value.length === 3 ||
        (typeof value[3] === "string" && value[3].length > 0));
    return structurallyValid
      ? { corrupted: false, value: value as unknown as StorageScopeTuple }
      : { corrupted: true };
  } catch {
    return { corrupted: true };
  }
}

function parseScopedStorageKey(
  key: string,
  prefix: string,
  scope: GroupRunSummaryScope,
): { corrupted: boolean; match?: ScopedStorageKey } {
  const parsed = parseStorageScopeTuple(key, prefix);
  if (parsed.corrupted) {
    // A key carrying our storage prefix but no parseable scope cannot be
    // proven unrelated to the current paid run. Keep every caller fail-closed.
    return { corrupted: true };
  }
  const value = parsed.value;
  if (!value) return { corrupted: false };
  if (value[0] !== scope.accountId || value[1] !== scope.canvasId ||
    value[2] !== scope.fixtureScopeId) {
    return { corrupted: false };
  }
  return value.length === 3
    ? { corrupted: false, match: { kind: "legacy" } }
    : {
        corrupted: false,
        match: { exactRunId: value[3], kind: "exact" },
      };
}

function corruptStorageEntryIsQuarantined(
  scope: GroupRunSummaryScope,
  key: string,
  raw: string | null,
) {
  const matches = [
    quarantinedCorruptStorageEntries.get(groupRunSummaryScopeKey(scope)),
  ];
  let quarantined = false;
  for (const entry of matches) {
    if (!entry?.values.has(key)) continue;
    if (raw !== null && entry.values.get(key) === raw) quarantined = true;
    else entry.values.delete(key);
  }
  return quarantined;
}

function invalidateCorruptStorageQuarantine(key: string) {
  for (const entry of quarantinedCorruptStorageEntries.values()) {
    entry.values.delete(key);
  }
}

function groupRunScopeHasQuarantine(scope: GroupRunSummaryScope) {
  return (quarantinedCorruptStorageEntries
    .get(groupRunSummaryScopeKey(scope))?.values.size ?? 0) > 0;
}

function setGroupRunStorageItem(key: string, value: string) {
  invalidateCorruptStorageQuarantine(key);
  window.localStorage.setItem(key, value);
}

function removeGroupRunStorageItem(key: string) {
  invalidateCorruptStorageQuarantine(key);
  window.localStorage.removeItem(key);
}

function storageKeyMatchesScope(
  key: string,
  prefix: string,
  scope: GroupRunSummaryScope,
) {
  return Boolean(parseScopedStorageKey(key, prefix, scope).match);
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
    Array.isArray(lease.lockedNodeIds) &&
    new Set(lease.lockedNodeIds).size === lease.lockedNodeIds.length &&
    lease.lockedNodeIds.every((id) =>
      typeof id === "string" && id.length > 0
    ) &&
    Number.isSafeInteger(lease.heartbeatAt) &&
    Number.isSafeInteger(lease.expiresAt) &&
    (lease.heartbeatAt as number) >= 0 &&
    (lease.expiresAt as number) >= (lease.heartbeatAt as number);
}

function recordsForStorageValue<T extends { runId: string }>(input: {
  isRecord: (value: unknown) => value is T;
  key: ScopedStorageKey;
  parsed: unknown;
  recordMatchesScope?: (record: T) => boolean;
}) {
  if (input.key.kind === "exact") {
    if (
      !input.isRecord(input.parsed) ||
      input.parsed.runId !== input.key.exactRunId ||
      (input.recordMatchesScope && !input.recordMatchesScope(input.parsed))
    ) return { corrupted: true, records: [] as T[] };
    return { corrupted: false, records: [input.parsed] };
  }
  if (input.isRecord(input.parsed)) {
    return input.recordMatchesScope && !input.recordMatchesScope(input.parsed)
      ? { corrupted: true, records: [] as T[] }
      : { corrupted: false, records: [input.parsed] };
  }
  if (!input.parsed || typeof input.parsed !== "object" ||
    Array.isArray(input.parsed)) {
    return { corrupted: true, records: [] as T[] };
  }
  const entries = Object.entries(input.parsed as Record<string, unknown>);
  const records: T[] = [];
  let corrupted = entries.length === 0;
  for (const [runId, candidate] of entries) {
    if (!input.isRecord(candidate) || candidate.runId !== runId || !runId ||
      (input.recordMatchesScope && !input.recordMatchesScope(candidate))) {
      corrupted = true;
      continue;
    }
    records.push(candidate);
  }
  return { corrupted, records };
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
    const cache = readGroupRunLeaseCache(scope);
    if (cache.corrupted) return undefined;
    const leases = cache.leases;
    return runId
      ? leases.find((lease) => lease.runId === runId)
      : leases.sort((left, right) => right.heartbeatAt - left.heartbeatAt)[0];
  } catch {
    return undefined;
  }
}

export function readGroupRunLeaseCache(scope: GroupRunSummaryScope) {
  const leases = new Map<string, GroupRunLease>();
  let corrupted = false;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      const raw = window.localStorage.getItem(key);
      const parsedKey = parseScopedStorageKey(key, leaseStoragePrefix, scope);
      if (parsedKey.corrupted) {
        if (!corruptStorageEntryIsQuarantined(scope, key, raw)) corrupted = true;
        continue;
      }
      if (!parsedKey.match) continue;
      if (raw === null) continue;
      if (corruptStorageEntryIsQuarantined(scope, key, raw)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        corrupted = true;
        continue;
      }
      const decoded = recordsForStorageValue({
        isRecord: isLease,
        key: parsedKey.match,
        parsed,
      });
      if (decoded.corrupted) corrupted = true;
      for (const lease of decoded.records) {
        const existing = leases.get(lease.runId);
        if (existing) {
          const sameOwnerAndLocks = existing.ownerId === lease.ownerId &&
            [...existing.lockedNodeIds].sort().join("\u0000") ===
              [...lease.lockedNodeIds].sort().join("\u0000");
          if (!sameOwnerAndLocks) corrupted = true;
          if (existing.heartbeatAt >= lease.heartbeatAt) continue;
        }
        leases.set(lease.runId, lease);
      }
    }
    return {
      corrupted,
      leases: [...leases.values()],
      quarantined: groupRunScopeHasQuarantine(scope),
    };
  } catch {
    return {
      corrupted: true,
      leases: [...leases.values()],
      quarantined: groupRunScopeHasQuarantine(scope),
    };
  }
}

async function hasActiveGroupRunLeaseForCanvas(
  scope: GroupRunSummaryScope,
  nodeId?: string,
  allowedRunId?: string,
  foreignOnly = false,
) {
  if (typeof window === "undefined") return false;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(leaseStoragePrefix)) continue;
      const raw = window.localStorage.getItem(key);
      const decodedKey = parseStorageScopeTuple(key, leaseStoragePrefix);
      if (decodedKey.corrupted) {
        if (corruptStorageEntryIsQuarantined(scope, key, raw)) continue;
        return true;
      }
      const scopeValue = decodedKey.value;
      if (!scopeValue) continue;
      const scopeMatches = scopeValue[0] === scope.accountId &&
        scopeValue[1] === scope.canvasId &&
        scopeValue[2] === scope.fixtureScopeId;
      if (!scopeMatches) continue;
      const parsedKey = parseScopedStorageKey(key, leaseStoragePrefix, {
        accountId: String(scopeValue[0]),
        canvasId: String(scopeValue[1]),
        fixtureScopeId: String(scopeValue[2]),
      });
      if (parsedKey.corrupted || !parsedKey.match) return true;
      if (raw === null) continue;
      if (corruptStorageEntryIsQuarantined(scope, key, raw)) continue;
      const parsed = JSON.parse(raw) as unknown;
      const decoded = recordsForStorageValue({
        isRecord: isLease,
        key: parsedKey.match,
        parsed,
      });
      if (decoded.corrupted) return true;
      const leases = decoded.records;
      const candidates = leases.filter((lease) =>
        lease.runId !== allowedRunId &&
        (!foreignOnly || lease.ownerId !== executionOwnerId) &&
        (!nodeId || lease.lockedNodeIds.length === 0 ||
          lease.lockedNodeIds.includes(nodeId))
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
            removeGroupRunStorageItem(key);
            continue;
          }
          const retained = leases.filter((lease) => lease.runId !== candidate.runId);
          if (retained.length === 0) removeGroupRunStorageItem(key);
          else {
            setGroupRunStorageItem(
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
      removeGroupRunStorageItem(exactKey);
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
    ) removeGroupRunStorageItem(legacyKey);
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
  if (retained.length === 0) removeGroupRunStorageItem(legacyKey);
  else {
    setGroupRunStorageItem(
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
  if (readGroupRunLeaseCache(scope).corrupted) return false;
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
  scope: GroupRunSummaryScope,
  nodeId?: string,
) {
  return hasActiveGroupRunLeaseForCanvas(scope, nodeId, undefined, true);
}

export async function hasConflictingActiveGroupRunLeaseForCanvas(
  scope: GroupRunSummaryScope,
  nodeId?: string,
  allowedRunId?: string,
) {
  return hasActiveGroupRunLeaseForCanvas(scope, nodeId, allowedRunId);
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
    const cache = readGroupRunLeaseCache(scope);
    if (cache.corrupted) return false;
    const current = cache.leases;
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
    setGroupRunStorageItem(
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
        scope,
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
  let released = false;
  try {
    const current = readGroupRunLease(scope, runId);
    if (!current || current.ownerId !== ownerId || current.runId !== runId) {
      return false;
    }
    removeGroupRunStorageItem(leaseStorageKey(scope, runId));
    // A v1 beta stored all runs under the scope-only key. Remove only the
    // released entry while preserving compatibility with interrupted runs.
    const legacyKey = leaseStorageKey(scope);
    const legacyRaw = window.localStorage.getItem(legacyKey);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as unknown;
      if (isLease(parsed)) {
        if (parsed.runId === runId) removeGroupRunStorageItem(legacyKey);
      } else if (parsed && typeof parsed === "object") {
        const retained = Object.values(parsed as Record<string, unknown>)
          .filter(isLease)
          .filter((lease) => lease.runId !== runId);
        if (retained.length === 0) removeGroupRunStorageItem(legacyKey);
        else setGroupRunStorageItem(legacyKey, JSON.stringify(
          Object.fromEntries(retained.map((lease) => [lease.runId, lease])),
        ));
      }
    }
    released = true;
    return true;
  } catch {
    return false;
  } finally {
    releaseWebLock?.();
    if (released) {
      // The native Web Lock is relinquished only after its callback promise
      // settles. Notify waiters on the next task, after that hand-off point.
      globalThis.setTimeout(() => dispatchLeaseEvent(scope), 0);
    }
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<GroupRunCheckpoint>;
  const executableNodeIdsValid = Array.isArray(item.executableNodeIds) &&
    new Set(item.executableNodeIds).size === item.executableNodeIds.length &&
    item.executableNodeIds.every((id) => typeof id === "string" && id.length > 0);
  const acceptedTasks = item.acceptedTasks;
  const acceptedTasksValid = acceptedTasks === undefined || (
    acceptedTasks !== null && typeof acceptedTasks === "object" &&
    !Array.isArray(acceptedTasks) &&
    Object.entries(acceptedTasks).every(([nodeId, candidate]) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return false;
      }
      const binding = candidate as Partial<AcceptedTaskBinding>;
      return binding.nodeId === nodeId &&
        ["audio", "image", "text", "video"].includes(binding.kind ?? "") &&
        (binding.inputFingerprint === undefined ||
          (typeof binding.inputFingerprint === "string" &&
            binding.inputFingerprint.length > 0)) &&
        typeof binding.modelInputContractFingerprint === "string" &&
        binding.modelInputContractFingerprint.length > 0 &&
        (binding.modelConfigurationRevision === undefined ||
          (typeof binding.modelConfigurationRevision === "string" &&
            binding.modelConfigurationRevision.length > 0)) &&
        (binding.modelReleaseRevision === undefined ||
          (typeof binding.modelReleaseRevision === "string" &&
            binding.modelReleaseRevision.length > 0)) &&
        typeof binding.taskId === "string" && binding.taskId.length > 0 &&
        typeof binding.ownershipKey === "string" &&
        binding.ownershipKey.length > 0 &&
        item.executableNodeIds?.includes(nodeId) === true;
    })
  );
  const nodeStatesValid = Boolean(
    item.nodeStates && typeof item.nodeStates === "object" &&
    !Array.isArray(item.nodeStates) &&
    Object.entries(item.nodeStates).every(([nodeId, state]) =>
      item.executableNodeIds?.includes(nodeId) === true &&
      ["blocked", "failed", "pending", "running", "skipped", "success"]
        .includes(String(state))
    ),
  );
  const successProofsValid = Boolean(
    item.successProofs && typeof item.successProofs === "object" &&
    !Array.isArray(item.successProofs) &&
    Object.entries(item.successProofs).every(([nodeId, candidate]) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return false;
      }
      const proof = candidate as Partial<GroupRunSuccessProof>;
      return item.executableNodeIds?.includes(nodeId) === true &&
        typeof proof.taskId === "string" && proof.taskId.length > 0 &&
        typeof proof.ownershipKey === "string" && proof.ownershipKey.length > 0 &&
        typeof proof.resultKey === "string" && proof.resultKey.length > 0 &&
        (proof.inputFingerprint === undefined ||
          (typeof proof.inputFingerprint === "string" &&
            proof.inputFingerprint.length > 0)) &&
        (proof.modelConfigurationRevision === undefined ||
          (typeof proof.modelConfigurationRevision === "string" &&
            proof.modelConfigurationRevision.length > 0)) &&
        (proof.modelReleaseRevision === undefined ||
          (typeof proof.modelReleaseRevision === "string" &&
            proof.modelReleaseRevision.length > 0));
    }),
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
  const resumeModeValid = item.resumeMode === undefined ||
    item.resumeMode === "accepted-only" || item.resumeMode === "current-graph";
  return (item.version === 1 || item.version === 2) &&
    typeof item.accountId === "string" &&
    typeof item.canvasId === "string" &&
    typeof item.fixtureScopeId === "string" &&
    typeof item.groupId === "string" && item.groupId.length > 0 &&
    typeof item.runId === "string" && item.runId.length > 0 &&
    typeof item.snapshotFingerprint === "string" &&
    executableNodeIdsValid &&
    nodeStatesValid &&
    successProofsValid &&
    acceptedTasksValid &&
    projectionPendingNodeIdsValid &&
    resumeModeValid &&
    Number.isSafeInteger(item.startedAt) && (item.startedAt as number) >= 0 &&
    Number.isSafeInteger(item.updatedAt) && (item.updatedAt as number) >= 0 &&
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
    if (runId) return matching.find((checkpoint) => checkpoint.runId === runId);
    // A scope may contain multiple independently runnable groups (or multiple
    // conflicting runs for one group). Callers must name the group/run instead
    // of treating the newest browser-cache entry as execution authority.
    return matching.length === 1 ? matching[0] : undefined;
  } catch {
    // A corrupt or unavailable browser store cannot be trusted for paid resume.
  }
  return undefined;
}

export function readGroupRunCheckpoints(scope: GroupRunSummaryScope) {
  return readGroupRunCheckpointCache(scope).checkpoints;
}

export function readGroupRunCheckpointCache(
  scope: GroupRunSummaryScope,
): GroupRunCheckpointCacheRead {
  let corrupted = false;
  try {
    const checkpoints = new Map<string, GroupRunCheckpoint>();
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      const raw = window.localStorage.getItem(key);
      const parsedKey = parseScopedStorageKey(key, storagePrefix, scope);
      if (parsedKey.corrupted) {
        if (!corruptStorageEntryIsQuarantined(scope, key, raw)) corrupted = true;
        continue;
      }
      if (!parsedKey.match) continue;
      if (raw === null) continue;
      if (corruptStorageEntryIsQuarantined(scope, key, raw)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        corrupted = true;
        continue;
      }
      const decoded = recordsForStorageValue({
        isRecord: isCheckpoint,
        key: parsedKey.match,
        parsed,
        recordMatchesScope: (checkpoint) =>
          groupRunSummaryScopeKey(checkpoint) === groupRunSummaryScopeKey(scope),
      });
      if (decoded.corrupted) corrupted = true;
      for (const checkpoint of decoded.records) {
        const existing = checkpoints.get(checkpoint.runId);
        if (existing &&
          checkpointFingerprint(existing) !== checkpointFingerprint(checkpoint)) {
          corrupted = true;
          if (existing.updatedAt >= checkpoint.updatedAt) continue;
        }
        checkpoints.set(checkpoint.runId, checkpoint);
      }
    }
    return {
      checkpoints: [...checkpoints.values()]
      .filter((checkpoint) =>
        groupRunSummaryScopeKey(checkpoint) === groupRunSummaryScopeKey(scope)
      )
      .sort((left, right) => right.updatedAt - left.updatedAt),
      corrupted,
      quarantined: groupRunScopeHasQuarantine(scope),
    };
  } catch {
    return {
      checkpoints: [],
      corrupted: true,
      quarantined: groupRunScopeHasQuarantine(scope),
    };
  }
}

function corruptStorageEntriesForScope<T extends { runId: string }>(
  scope: GroupRunSummaryScope,
  prefix: string,
  isRecord: (value: unknown) => value is T,
  recordFingerprint: (record: T) => string,
  recordMatchesScope?: (record: T) => boolean,
) {
  const corruptEntries: Array<{ key: string; raw: string }> = [];
  const validEntries: Array<{
    key: string;
    raw: string;
    records: T[];
  }> = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const raw = window.localStorage.getItem(key);
    if (raw === null || corruptStorageEntryIsQuarantined(scope, key, raw)) continue;
    const parsedKey = parseScopedStorageKey(key, prefix, scope);
    if (parsedKey.corrupted) {
      corruptEntries.push({ key, raw });
      continue;
    }
    if (!parsedKey.match) continue;
    try {
      const decoded = recordsForStorageValue({
        isRecord,
        key: parsedKey.match,
        parsed: JSON.parse(raw) as unknown,
        recordMatchesScope,
      });
      if (decoded.corrupted) corruptEntries.push({ key, raw });
      else validEntries.push({ key, raw, records: decoded.records });
    } catch {
      corruptEntries.push({ key, raw });
    }
  }
  const byRun = new Map<string, Array<{
    entry: { key: string; raw: string };
    fingerprint: string;
  }>>();
  for (const entry of validEntries) {
    for (const record of entry.records) {
      const candidates = byRun.get(record.runId) ?? [];
      candidates.push({ entry, fingerprint: recordFingerprint(record) });
      byRun.set(record.runId, candidates);
    }
  }
  for (const candidates of byRun.values()) {
    if (new Set(candidates.map(({ fingerprint }) => fingerprint)).size <= 1) {
      continue;
    }
    for (const { entry } of candidates) corruptEntries.push(entry);
  }
  return [...new Map(corruptEntries.map((entry) => [entry.key, entry])).values()];
}

/**
 * Reads server-task + Canvas-binding authority while holding the same Canvas
 * admission lock used by paid submissions, then quarantines only the exact
 * corrupt bytes observed in that critical section. Corrupt entries remain
 * byte-for-byte in localStorage; a changed value invalidates the proof.
 */
export async function quarantineCorruptGroupRunCacheAfterAuthority<T>(
  scope: GroupRunSummaryScope,
  readVerifiedAuthority: () => Promise<T> | T,
): Promise<T | undefined> {
  const locks = browserLocks();
  if (!locks?.query) return undefined;
  return runWithGroupRunCanvasAdmission(scope.canvasId, async () => {
    const lockSnapshot = await locks.query?.().catch(() => undefined);
    if (!lockSnapshot) return undefined;
    const scopeKey = groupRunSummaryScopeKey(scope);
    const runLockPrefix = `unboundry-group-run:${scopeKey}:`;
    const claimLockName = `unboundry-group-run-claim:${scopeKey}`;
    const lockNames = [
      ...(lockSnapshot.held ?? []),
      ...(lockSnapshot.pending ?? []),
    ].map((entry) => entry.name).filter((name): name is string =>
      typeof name === "string"
    );
    if (lockNames.some((name) =>
      name === claimLockName || name.startsWith(runLockPrefix)
    )) return undefined;
    const entries = [
      ...corruptStorageEntriesForScope(
        scope,
        leaseStoragePrefix,
        isLease,
        (lease) => JSON.stringify([
          lease.ownerId,
          [...lease.lockedNodeIds].sort(),
        ]),
      ),
      ...corruptStorageEntriesForScope(
        scope,
        storagePrefix,
        isCheckpoint,
        checkpointFingerprint,
        (checkpoint) =>
          groupRunSummaryScopeKey(checkpoint) === groupRunSummaryScopeKey(scope),
      ),
    ];
    const authority = await readVerifiedAuthority();
    if (entries.some(({ key, raw }) =>
      window.localStorage.getItem(key) !== raw
    )) return undefined;
    const quarantine = quarantinedCorruptStorageEntries.get(scopeKey) ?? {
      canvasId: scope.canvasId,
      values: new Map<string, string>(),
    };
    for (const { key, raw } of entries) quarantine.values.set(key, raw);
    quarantinedCorruptStorageEntries.set(scopeKey, quarantine);
    if (readGroupRunLeaseCache(scope).corrupted ||
      readGroupRunCheckpointCache(scope).corrupted) {
      for (const { key, raw } of entries) {
        if (quarantine.values.get(key) === raw) quarantine.values.delete(key);
      }
      if (quarantine.values.size === 0) {
        quarantinedCorruptStorageEntries.delete(scopeKey);
      }
      return undefined;
    }
    return authority;
  }).catch(() => undefined);
}

export function readGroupCheckpoints(
  scope: GroupRunSummaryScope,
  groupId: string,
) {
  return readGroupRunCheckpoints(scope).filter((checkpoint) =>
    checkpoint.groupId === groupId
  );
}

export function readRunCheckpoint(
  scope: GroupRunSummaryScope,
  runId: string,
) {
  return readGroupRunCheckpoint(scope, runId);
}

export function clearRunCheckpoint(
  scope: GroupRunSummaryScope,
  runId: string,
) {
  return clearGroupRunCheckpoint(scope, undefined, runId);
}

export function writeGroupRunCheckpoint(
  checkpoint: GroupRunCheckpoint,
  expectedLease?: { ownerId: string; runId: string },
) {
  try {
    if (readGroupRunCheckpointCache(checkpoint).corrupted ||
      readGroupRunLeaseCache(checkpoint).corrupted) return false;
    if (expectedLease && checkpoint.runId !== expectedLease.runId) return false;
    const lease = expectedLease
      ? readGroupRunLease(checkpoint, expectedLease.runId)
      : readGroupRunLease(checkpoint, checkpoint.runId);
    if (!leaseMatches(lease, expectedLease)) return false;
    const persisted: GroupRunCheckpoint = expectedLease
      ? {
          ...checkpoint,
          lease,
          version: 2,
        }
      : { ...checkpoint, version: 2 };
    const key = checkpointStorageKey(checkpoint, checkpoint.runId);
    setGroupRunStorageItem(key, JSON.stringify(persisted));
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
    if (readGroupRunCheckpointCache(scope).corrupted ||
      readGroupRunLeaseCache(scope).corrupted) return false;
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
          removeGroupRunStorageItem(candidate);
        }
      }
    } else {
      removeGroupRunStorageItem(checkpointStorageKey(scope, targetRunId));
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isCheckpoint(parsed)) {
          if (parsed.runId === targetRunId) removeGroupRunStorageItem(key);
        } else if (parsed && typeof parsed === "object") {
          const retained = Object.values(parsed as Record<string, unknown>)
            .filter(isCheckpoint)
            .filter((checkpoint) => checkpoint.runId !== targetRunId);
          if (retained.length === 0) removeGroupRunStorageItem(key);
          else setGroupRunStorageItem(key, JSON.stringify(
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
  if (readGroupRunLeaseCache(scope).corrupted) return false;
  const checkpointCache = readGroupRunCheckpointCache(scope);
  if (checkpointCache.corrupted) return false;
  const activeCheckpoints = checkpointCache.checkpoints.filter((checkpoint) =>
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
  modelConfigurationRevision?: string,
  modelReleaseRevision?: string,
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
      modelConfigurationRevision:
        modelConfigurationRevision ?? node.data.textModelConfigurationRevision,
      modelReleaseRevision,
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
      modelConfigurationRevision:
        modelConfigurationRevision ?? node.data.imageModelConfigurationRevision,
      modelReleaseRevision,
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
      inputContractFingerprint: node.data.videoInputContractFingerprint,
      modelConfigurationRevision:
        modelConfigurationRevision ?? node.data.videoModelConfigurationRevision,
      modelReleaseRevision,
      parameters: node.data.videoParameters,
      prompt: node.data.videoPrompt,
      promptReady: node.data.videoPromptReady,
    };
  }
  if (node.type === "audio") {
    return {
      ...common,
      modelId: node.data.audioModelId,
      modelConfigurationRevision:
        modelConfigurationRevision ?? node.data.audioModelConfigurationRevision,
      modelReleaseRevision,
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
  modelConfigurationRevisions?: Readonly<Record<string, string>>;
  modelReleaseRevisions?: Readonly<Record<string, string>>;
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
      input.modelConfigurationRevisions?.[
        `${node.type}:${
          node.type === "text"
            ? node.data.textModelId ?? ""
            : node.type === "image"
              ? node.data.imageModelId ?? ""
              : node.type === "audio"
                ? node.data.audioModelId ?? ""
                : node.type === "video"
                  ? node.data.videoModelId ?? node.data.videoModel ?? ""
                  : ""
        }`
      ],
      input.modelReleaseRevisions?.[
        `${node.type}:${
          node.type === "text"
            ? node.data.textModelId ?? ""
            : node.type === "image"
              ? node.data.imageModelId ?? ""
              : node.type === "audio"
                ? node.data.audioModelId ?? ""
                : node.type === "video"
                  ? node.data.videoModelId ?? node.data.videoModel ?? ""
                  : ""
        }`
      ],
    ))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = input.edges
    .filter((edge) => childIds.has(edge.target))
    .map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? null,
      target: edge.target,
      targetHandle: edge.targetHandle ?? null,
      inputOrder: edge.data?.inputOrder ?? null,
      inputRole: edge.data?.inputRole ?? null,
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
  const inputFingerprint = data.groupRunSuccessInputFingerprint;
  const modelConfigurationRevision =
    data.groupRunSuccessModelConfigurationRevision;
  const modelReleaseRevision = data.groupRunSuccessModelReleaseRevision;
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
    ? {
        inputFingerprint: typeof inputFingerprint === "string"
          ? inputFingerprint
          : undefined,
        modelConfigurationRevision:
          typeof modelConfigurationRevision === "string"
            ? modelConfigurationRevision
            : undefined,
        modelReleaseRevision: typeof modelReleaseRevision === "string"
          ? modelReleaseRevision
          : undefined,
        ownershipKey,
        resultKey: checkpointFingerprint(result),
        taskId,
      }
    : undefined;
}

export function verifiedCheckpointSuccessIds(
  checkpoint: GroupRunCheckpoint,
  nodes: readonly ProbeNodeType[],
  currentModelConfigurationRevisions?: Readonly<Record<string, string>>,
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
    const node = nodeById.get(nodeId);
    const modelId = node?.type === "text"
      ? node.data.textModelId
      : node?.type === "image"
        ? node.data.imageModelId
        : node?.type === "audio"
          ? node.data.audioModelId
          : node?.type === "video"
            ? node.data.videoModelId ?? node.data.videoModel
            : undefined;
    const currentConfigurationRevision = node?.type && modelId
      ? currentModelConfigurationRevisions?.[`${node.type}:${modelId}`]
      : undefined;
    if (!actual ||
      actual.taskId !== expected.taskId ||
      actual.ownershipKey !== expected.ownershipKey ||
      actual.resultKey !== expected.resultKey ||
      (expected.inputFingerprint !== undefined &&
        actual.inputFingerprint !== expected.inputFingerprint) ||
      (currentConfigurationRevision !== undefined &&
        (expected.modelConfigurationRevision !== currentConfigurationRevision ||
          actual.modelConfigurationRevision !== currentConfigurationRevision)) ||
      (expected.modelReleaseRevision !== undefined &&
        actual.modelReleaseRevision !== expected.modelReleaseRevision)) {
      return {
        mismatchNodeId: nodeId,
        verified,
      };
    }
    verified.add(nodeId);
  }
  return { verified };
}
