import type { ProviderProfile } from "./providerProfiles";
import { relayGetJson, RelayRemoteError } from "./multiProtocolRelay";

export type RelayUsageRecord = {
  completedAt?: string;
  createdAt: string;
  model: string;
  modelType?: string;
  state: string;
  taskId: string;
};

export type RelayUsageMatch =
  | { status: "none" }
  | { status: "one"; record: RelayUsageRecord }
  | { status: "many" };

const createdSlackMs = 20_000;
const siblingCompleteSlackMs = 20_000;
const durationCloseMs = 25_000;
const durationGapMs = 40_000;

function parseTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asTaskId(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[a-z0-9._:-]{1,160}$/i.test(trimmed)) return trimmed;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function parseRelayUsageRecords(body: unknown): RelayUsageRecord[] {
  const root = asRecord(body);
  const raw = root && Array.isArray(root.records) ? root.records : [];
  const records: RelayUsageRecord[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const taskId = asTaskId(row.task_id ?? row.taskId ?? row.id);
    const createdAt = typeof row.created_at === "string"
      ? row.created_at
      : typeof row.createdAt === "string" ? row.createdAt : "";
    const completedAt = typeof row.completed_at === "string"
      ? row.completed_at
      : typeof row.completedAt === "string" ? row.completedAt : undefined;
    const model = typeof row.model === "string" ? row.model.trim() : "";
    const modelType = typeof row.model_type === "string"
      ? row.model_type
      : typeof row.modelType === "string" ? row.modelType : undefined;
    const state = typeof row.state === "string" ? row.state.trim().toLowerCase() : "";
    if (!taskId || !createdAt || !model || !parseTime(createdAt)) continue;
    records.push({
      ...(completedAt && parseTime(completedAt) ? { completedAt } : {}),
      createdAt,
      model,
      ...(modelType ? { modelType } : {}),
      state,
      taskId,
    });
  }
  return records;
}

export async function listRelayUsageRecords(
  profile: ProviderProfile,
  fetcher?: typeof fetch,
) {
  if (!profile.apiKey) throw new RelayRemoteError("AUTH");
  const body = await relayGetJson(
    profile,
    "/skills/usage?detail=1&limit=50",
    fetcher,
  );
  return parseRelayUsageRecords(body);
}

function recordDurationDelta(
  record: RelayUsageRecord,
  localCreated: number,
  localUpdated: number,
) {
  const created = parseTime(record.createdAt);
  const completed = record.completedAt ? parseTime(record.completedAt) : undefined;
  if (created === undefined || completed === undefined) return Number.POSITIVE_INFINITY;
  return Math.abs((completed - created) - (localUpdated - localCreated));
}

export function matchRelayUsageRecord(input: {
  competingLocals?: ReadonlyArray<{ createdAt: string; updatedAt: string }>;
  localCreatedAt: string;
  localUpdatedAt: string;
  occupiedTaskIds: readonly string[];
  providerModelId: string;
  records: readonly RelayUsageRecord[];
  siblingSuccesses?: ReadonlyArray<{ createdAt: string; updatedAt: string }>;
}): RelayUsageMatch {
  const localCreated = parseTime(input.localCreatedAt);
  const localUpdated = parseTime(input.localUpdatedAt);
  if (localCreated === undefined || localUpdated === undefined) return { status: "none" };
  const occupied = new Set(input.occupiedTaskIds);
  const siblings = (input.siblingSuccesses ?? [])
    .map((item) => ({
      created: parseTime(item.createdAt),
      updated: parseTime(item.updatedAt),
    }))
    .filter((item): item is { created: number; updated: number } =>
      item.created !== undefined && item.updated !== undefined
    );
  const competitors = (input.competingLocals ?? [])
    .map((item) => ({
      created: parseTime(item.createdAt),
      updated: parseTime(item.updatedAt),
    }))
    .filter((item): item is { created: number; updated: number } =>
      item.created !== undefined && item.updated !== undefined
    );
  const candidates = input.records.filter((record) => {
    if (occupied.has(record.taskId)) return false;
    if (record.model !== input.providerModelId) return false;
    if (record.state !== "success") return false;
    const created = parseTime(record.createdAt);
    if (created === undefined) return false;
    if (created < localCreated - createdSlackMs || created > localUpdated + 5_000) {
      return false;
    }
    const completed = record.completedAt ? parseTime(record.completedAt) : undefined;
    if (completed !== undefined) {
      const belongsToSibling = siblings.some((sibling) =>
        Math.abs(created - sibling.created) <= createdSlackMs &&
        Math.abs(completed - sibling.updated) <= siblingCompleteSlackMs
      );
      if (belongsToSibling) return false;
    }
    return true;
  });
  if (candidates.length === 0) return { status: "none" };
  const claimable = candidates.filter((record) => {
    const localDelta = recordDurationDelta(record, localCreated, localUpdated);
    if (localDelta > durationCloseMs) return false;
    return competitors.every((competitor) => {
      const other = recordDurationDelta(record, competitor.created, competitor.updated);
      return localDelta + durationGapMs <= other;
    });
  });
  if (claimable.length === 1) return { status: "one", record: claimable[0] };
  if (claimable.length > 1) return { status: "many" };
  if (competitors.length > 0) return { status: "many" };
  if (candidates.length === 1) return { status: "one", record: candidates[0] };
  const scored = candidates
    .map((record) => ({
      delta: recordDurationDelta(record, localCreated, localUpdated),
      record,
    }))
    .sort((left, right) => left.delta - right.delta);
  if (
    scored[0].delta <= durationCloseMs &&
    scored[1].delta >= scored[0].delta + durationGapMs
  ) {
    return { status: "one", record: scored[0].record };
  }
  return { status: "many" };
}
