import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openAppDatabase } from "./database";
import {
  modelContractsRequired,
  modelContractState,
} from "./modelReleaseRevisionStore";
import {
  generationAdmissionInTransaction,
  generationProviderBoundaryDecisionInTransaction,
  type GenerationAdmission,
} from "./generationSafety";
import {
  generationProviderAttemptCreatedAt,
} from "./generationAttemptQueries";
export { generationProviderAttemptCounts } from "./generationAttemptQueries";
import {
  cleanParameterSchema,
  knownModelParameterSchema,
  providerParameterSchema,
  validateParameterSchemaConstraints,
} from "../types/modelParameters";
import { generationCapabilityRegistry } from "./generationCapabilityRegistry";
import type { GenerationCapabilityKind } from "../types/nodeVocabulary";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";

export const generationTaskKinds: readonly GenerationCapabilityKind[] =
  generationCapabilityRegistry.kinds();
export const generationTaskStates = [
  "queued",
  "running",
  "success",
  "failed",
  "cancelled",
  "retrying",
  "recovering",
] as const;

export type GenerationTaskKind = GenerationCapabilityKind;
export type GenerationTaskState = (typeof generationTaskStates)[number];

export type GenerationTaskInput = {
  canvasId: string;
  /**
   * Freshness proof for graph-backed submissions. When present, it is checked
   * in the same write transaction that inserts the task.
   */
  expectedCanvasRevision?: number;
  costCurrency?: "CNY" | "USD";
  credentialRevision?: number;
  estimatedCostMicrounits?: number;
  idempotencyKey: string;
  kind: GenerationTaskKind;
  model?: string;
  modelConfiguration?: Record<string, unknown>;
  nodeId: string;
  ownerId?: string;
  parameters?: Record<string, unknown>;
  providerModelId?: string;
  providerProfileId?: string;
  prompt: string;
  /**
   * Stable client-owned logical intent. Only its documented whitelist is
   * hashed; Provider/credential/configuration metadata is never persisted.
   */
  requestIntent?: Record<string, unknown>;
};

export type GenerationIdempotentIntentInput = {
  canvasId: string;
  idempotencyKey: string;
  ownerId: string;
  requestIntent: Record<string, unknown>;
};

export type GenerationPaidRetrySnapshot = {
  credentialRevision: number;
  modelConfiguration: Record<string, unknown>;
  providerModelId: string;
  providerProfileId: string;
};

export type GenerationTaskRetryFence = {
  canvasId: string;
  expectedAttempt: number;
  expectedCanvasRevision: number;
  expectedGenerationInputKey: string;
  expectedUpdatedAt: string;
  kind: GenerationTaskKind;
  nodeId: string;
};

export type GenerationTaskCanvasRetryBinding = {
  canvasRevision: number;
  generationInputKey: string;
  generationOwnershipKey?: string;
  kind: GenerationTaskKind;
  nodeId: string;
  taskId: string;
  workflowExecutionRunId?: string;
};

export type GenerationTaskAbandonInput = {
  expectedAttempt: number;
  expectedUpdatedAt: string;
  taskId: string;
};

export type GenerationTask = {
  attempt: number;
  canvasId: string;
  costCurrency: "CNY" | "USD";
  credentialRevision?: number;
  createdAt: string;
  errorCode?: string;
  errorMessage?: string;
  estimatedCostMicrounits?: number;
  id: string;
  idempotencyKey: string;
  kind: GenerationTaskKind;
  model?: string;
  modelConfiguration: Record<string, unknown>;
  nodeId: string;
  ownerId?: string;
  parameters: Record<string, unknown>;
  prompt: string;
  providerModelId?: string;
  providerProfileId?: string;
  providerTaskId?: string;
  providerUsageTokens?: number;
  requestFingerprint: string;
  resultAssetId?: string;
  resultText?: string;
  actualCostMicrounits?: number;
  state: GenerationTaskState;
  updatedAt: string;
};

export type GenerationTaskEvent = {
  createdAt: string;
  errorCode?: string;
  errorMessage?: string;
  id: number;
  state: GenerationTaskState;
  taskId: string;
};

type GenerationTaskRow = {
  actual_cost_microunits: number | null;
  attempt: number;
  canvas_id: string;
  cost_currency: "CNY" | "USD";
  credential_revision: number;
  created_at: string;
  error_code: string | null;
  error_message: string | null;
  estimated_cost_microunits: number | null;
  id: string;
  idempotency_key: string;
  kind: GenerationTaskKind;
  model: string | null;
  model_configuration: string;
  node_id: string;
  owner_id: string | null;
  parameters: string;
  prompt: string;
  provider_model_id: string | null;
  provider_profile_id: string | null;
  provider_task_id: string | null;
  provider_usage_tokens: number | null;
  request_fingerprint: string;
  result_asset_id: string | null;
  result_text: string | null;
  state: GenerationTaskState;
  updated_at: string;
};

type GenerationTaskEventRow = {
  created_at: string;
  error_code: string | null;
  error_message: string | null;
  id: number;
  state: GenerationTaskState;
  task_id: string;
};

const identifierPattern = /^[a-z0-9._-]+$/i;
const idempotencyPattern = /^[a-z0-9._:-]+$/i;
const providerTaskIdPattern = /^[a-z0-9._:-]+$/i;

export const generationProviderAttemptOutcomes = [
  "boundary-claimed",
  "definitive-rejected",
  "accepted",
  "response-received",
  "provider-failed",
  "completed",
  "outcome-unknown",
] as const;
export type GenerationProviderAttemptOutcome =
  (typeof generationProviderAttemptOutcomes)[number];

export type GenerationProviderAttemptEvidence = {
  credentialRevision: number;
  executionAttempt: number;
  failureCode?: string;
  finishedAt?: string;
  outcome: GenerationProviderAttemptOutcome;
  providerModelId: string;
  providerProfileId: string;
  providerTaskId?: string;
};

const allowedTransitions: Record<
  GenerationTaskState,
  readonly GenerationTaskState[]
> = {
  cancelled: [],
  failed: ["retrying", "recovering"],
  queued: ["running", "cancelled"],
  recovering: ["queued", "running", "failed", "cancelled"],
  retrying: ["queued", "cancelled"],
  running: ["success", "failed", "cancelled", "recovering"],
  success: [],
};

export class GenerationTaskConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for a different request");
    this.name = "GenerationTaskConflictError";
  }
}

export class GenerationTaskCanvasRevisionConflictError extends Error {
  constructor(readonly revision: number) {
    super("画布内容还在保存，请等待保存完成后重试");
    this.name = "GenerationTaskCanvasRevisionConflictError";
  }
}

export class GenerationTaskOwnerDeletingError extends Error {
  readonly code = "ACCOUNT_DELETE_ACTIVE";

  constructor() {
    super("Account deletion blocks generation task mutation");
    this.name = "GenerationTaskOwnerDeletingError";
  }
}

export class GenerationTaskTransitionError extends Error {
  constructor(from: GenerationTaskState, to: GenerationTaskState) {
    super(`Generation task cannot move from ${from} to ${to}`);
    this.name = "GenerationTaskTransitionError";
  }
}

export class GenerationTaskRetryFenceError extends Error {
  constructor(
    readonly code: "RETRY_BINDING_STALE" | "RETRY_TASK_CHANGED",
    message: string,
  ) {
    super(message);
    this.name = "GenerationTaskRetryFenceError";
  }
}

export class GenerationTaskAdmissionError extends Error {
  constructor(
    readonly code: Exclude<GenerationAdmission, { allowed: true }>["code"],
    message: string,
  ) {
    super(message);
    this.name = "GenerationTaskAdmissionError";
  }
}

export class GenerationProviderAttemptBlockedError extends Error {
  constructor(
    readonly code:
      | "ACCOUNT_CREDENTIAL_CHANGED"
      | "ACCOUNT_CREDENTIAL_INVALID"
      | "ACCOUNT_CREDENTIAL_MISSING"
      | "ACCOUNT_DISABLED"
      | "ATOMIC_ADMISSION_REQUIRED"
      | "EMERGENCY_STOP"
      | "GLOBAL_DISABLED"
      | "MODEL_UNAVAILABLE"
      | "PROVIDER_ATTEMPT_ALREADY_RECORDED"
      | "PROVIDER_AUTH_FAILED"
      | "PROVIDER_CONFIGURATION_MISMATCH"
      | "PROVIDER_COOLDOWN"
      | "PROVIDER_RECOVERY_ATTEMPT_USED"
      | "RETRY_OUTCOME_UNKNOWN",
    message: string,
  ) {
    super(message);
    this.name = "GenerationProviderAttemptBlockedError";
  }
}

export class GenerationTaskProviderBoundaryError extends Error {
  readonly code = "CANCEL_OUTCOME_UNKNOWN";

  constructor() {
    super(
      "本次生成已经提交到模型平台，结果仍在处理，为避免丢失已付费结果不能在这里取消",
    );
    this.name = "GenerationTaskProviderBoundaryError";
  }
}

export class GenerationTaskAbandonError extends Error {
  readonly code = "PROVIDER_RESULT_NOT_ABANDONABLE";

  constructor() {
    super(
      "只有已失败且保留精确平台结果证据的任务可以显式放弃",
    );
    this.name = "GenerationTaskAbandonError";
  }
}

function assertTaskError(error?: { code: string; message: string }) {
  if (
    error &&
    (error.code.length < 1 ||
      error.code.length > 80 ||
      error.message.length < 1 ||
      error.message.length > 500)
  ) {
    throw new Error("Invalid generation task error");
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function canvasRetryBindings(
  nodesJson: string,
  canvasRevision: number,
): Map<string, GenerationTaskCanvasRetryBinding> {
  let nodes: unknown;
  try {
    nodes = JSON.parse(nodesJson);
  } catch {
    return new Map();
  }
  if (!Array.isArray(nodes)) return new Map();
  const bindings = new Map<string, GenerationTaskCanvasRetryBinding>();
  const ambiguous = new Set<string>();
  for (const rawNode of nodes) {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) continue;
    const node = rawNode as {
      data?: unknown;
      id?: unknown;
      type?: unknown;
    };
    if (
      typeof node.id !== "string" ||
      typeof node.type !== "string" ||
      !generationTaskKinds.includes(node.type as GenerationTaskKind) ||
      !node.data ||
      typeof node.data !== "object" ||
      Array.isArray(node.data)
    ) continue;
    const kind = node.type as GenerationTaskKind;
    const data = node.data as Record<string, unknown>;
    const taskId = data[`${kind}GenerationTaskId`];
    const generationInputKey = data[`${kind}GenerationInputKey`];
    const generationOwnershipKey = data[`${kind}GenerationOwnershipKey`];
    const workflowExecutionRunId = data.workflowExecutionRunId;
    if (
      typeof taskId !== "string" ||
      !identifierPattern.test(taskId) ||
      taskId.length > 120 ||
      typeof generationInputKey !== "string" ||
      generationInputKey.length < 1 ||
      generationInputKey.length > 100_000
    ) continue;
    if (bindings.has(taskId) || ambiguous.has(taskId)) {
      bindings.delete(taskId);
      ambiguous.add(taskId);
      continue;
    }
    bindings.set(taskId, {
      canvasRevision,
      generationInputKey,
      ...(typeof generationOwnershipKey === "string" &&
          generationOwnershipKey.length > 0 && generationOwnershipKey.length <= 2_000
        ? { generationOwnershipKey }
        : {}),
      kind,
      nodeId: node.id,
      taskId,
      ...(typeof workflowExecutionRunId === "string" &&
          workflowExecutionRunId.length > 0 && workflowExecutionRunId.length <= 2_000
        ? { workflowExecutionRunId }
        : {}),
    });
  }
  return bindings;
}

const requestIntentKeys = [
  "canvasId",
  "inputSchemaVersion",
  "inputs",
  "kind",
  "model",
  "nodeId",
  "ownPrompt",
  "parameters",
  "prompt",
] as const;
const requestIntentFingerprintVersion = "intent-v2:";

function whitelistedRequestIntent(value: Record<string, unknown>) {
  return Object.fromEntries(
    requestIntentKeys
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, stableValue(value[key])]),
  );
}

function hashRequestIntent(value: Record<string, unknown>) {
  return requestIntentFingerprintVersion + createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function stableClientIntent(
  canvasId: string,
  supplied: Record<string, unknown>,
) {
  if (
    (Object.hasOwn(supplied, "canvasId") && supplied.canvasId !== canvasId) ||
    typeof supplied.kind !== "string" ||
    !generationTaskKinds.includes(supplied.kind as GenerationTaskKind) ||
    typeof supplied.nodeId !== "string" ||
    !identifierPattern.test(supplied.nodeId) ||
    supplied.nodeId.length > 120 ||
    typeof supplied.prompt !== "string" ||
    supplied.prompt.trim().length < 1 ||
    supplied.prompt.length > 10_000 ||
    (Object.hasOwn(supplied, "model") &&
      supplied.model !== null &&
      (typeof supplied.model !== "string" || supplied.model.length > 120)) ||
    (Object.hasOwn(supplied, "parameters") &&
      (!supplied.parameters ||
        Array.isArray(supplied.parameters) ||
        typeof supplied.parameters !== "object"))
  ) {
    throw new Error("Invalid generation request intent");
  }
  return {
    canvasId,
    kind: supplied.kind,
    model: Object.hasOwn(supplied, "model") ? supplied.model : null,
    nodeId: supplied.nodeId,
    prompt: supplied.prompt,
    ...(Object.hasOwn(supplied, "ownPrompt")
      ? { ownPrompt: supplied.ownPrompt }
      : {}),
    ...(Object.hasOwn(supplied, "inputSchemaVersion")
      ? { inputSchemaVersion: supplied.inputSchemaVersion }
      : {}),
    ...(Object.hasOwn(supplied, "inputs")
      ? { inputs: supplied.inputs }
      : {}),
    parameters: Object.hasOwn(supplied, "parameters")
      ? supplied.parameters
      : {},
  };
}

function stableIntentForTask(input: GenerationTaskInput) {
  const supplied = whitelistedRequestIntent(input.requestIntent ?? {});
  if (Object.keys(supplied).length > 0) {
    return stableClientIntent(input.canvasId, supplied);
  }
  const parameters = input.parameters ?? {};
  return {
    canvasId: input.canvasId,
    kind: input.kind,
    model: input.model ?? null,
    nodeId: input.nodeId,
    prompt: input.prompt,
    ...(Object.hasOwn(parameters, "ownPrompt")
      ? { ownPrompt: stableValue(parameters.ownPrompt) }
      : {}),
    ...(Object.hasOwn(parameters, "inputSchemaVersion")
      ? { inputSchemaVersion: stableValue(parameters.inputSchemaVersion) }
      : {}),
    ...(Object.hasOwn(parameters, "inputs")
      ? { inputs: stableValue(parameters.inputs) }
      : {}),
    parameters: stableValue(parameters),
  };
}

function stableIntentForLookup(input: GenerationIdempotentIntentInput) {
  const supplied = whitelistedRequestIntent(input.requestIntent);
  if (Object.keys(supplied).length === 0) {
    throw new Error("Invalid generation request intent");
  }
  return stableClientIntent(input.canvasId, supplied);
}

function normalizeInput(input: GenerationTaskInput): GenerationTaskInput {
  const prompt = input.prompt.trim();
  const model = input.model?.trim();
  const parameters = input.parameters ?? {};
  const parameterJson = JSON.stringify(stableValue(parameters));
  const modelConfiguration = input.modelConfiguration ?? {};
  const modelConfigurationJson = JSON.stringify(stableValue(modelConfiguration));
  const requestIntent = input.requestIntent ?? {};
  const requestIntentJson = JSON.stringify(stableValue(requestIntent));
  const ownerId = input.ownerId?.trim();
  const providerProfileId = input.providerProfileId?.trim();
  const providerModelId = input.providerModelId?.trim();
  const costCurrency = input.costCurrency ?? "USD";

  if (
    !identifierPattern.test(input.canvasId) ||
    input.canvasId.length > 120 ||
    !identifierPattern.test(input.nodeId) ||
    input.nodeId.length > 120 ||
    !idempotencyPattern.test(input.idempotencyKey) ||
    input.idempotencyKey.length < 8 ||
    input.idempotencyKey.length > 200 ||
    !generationTaskKinds.includes(input.kind) ||
    prompt.length < 1 ||
    prompt.length > 10_000 ||
    (model !== undefined && (model.length < 1 || model.length > 120)) ||
    !parameters ||
    Array.isArray(parameters) ||
    typeof parameters !== "object" ||
    parameterJson.length > (input.kind === "text" ? 1_000_000 : 20_000) ||
    !modelConfiguration ||
    Array.isArray(modelConfiguration) ||
    typeof modelConfiguration !== "object" ||
    modelConfigurationJson.length > 128_000 ||
    !requestIntent ||
    Array.isArray(requestIntent) ||
    typeof requestIntent !== "object" ||
    requestIntentJson.length > (input.kind === "text" ? 1_000_000 : 100_000)
    || (ownerId !== undefined && (!identifierPattern.test(ownerId) || ownerId.length > 120))
    || (providerProfileId !== undefined && (!identifierPattern.test(providerProfileId) || providerProfileId.length > 120))
    || (providerModelId !== undefined && (providerModelId.length < 1 || providerModelId.length > 160))
    || (input.estimatedCostMicrounits !== undefined &&
      (!Number.isSafeInteger(input.estimatedCostMicrounits) || input.estimatedCostMicrounits < 0))
    || (input.credentialRevision !== undefined &&
      (!Number.isSafeInteger(input.credentialRevision) || input.credentialRevision < 0))
    || (input.expectedCanvasRevision !== undefined &&
      (!Number.isSafeInteger(input.expectedCanvasRevision) || input.expectedCanvasRevision < 0))
    || !["CNY", "USD"].includes(costCurrency)
  ) {
    throw new Error("Invalid generation task");
  }

  return {
    canvasId: input.canvasId,
    costCurrency,
    credentialRevision: input.credentialRevision ?? (
      Number.isSafeInteger(modelConfiguration.credentialVersion) &&
        Number(modelConfiguration.credentialVersion) >= 1
        ? Number(modelConfiguration.credentialVersion)
        : 0
    ),
    expectedCanvasRevision: input.expectedCanvasRevision,
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    model,
    modelConfiguration: stableValue(modelConfiguration) as Record<string, unknown>,
    ownerId,
    nodeId: input.nodeId,
    parameters: stableValue(parameters) as Record<string, unknown>,
    providerModelId,
    providerProfileId,
    estimatedCostMicrounits: input.estimatedCostMicrounits,
    prompt,
    requestIntent: stableValue(requestIntent) as Record<string, unknown>,
  };
}

function requestFingerprint(input: GenerationTaskInput) {
  return hashRequestIntent(stableIntentForTask(input));
}

function matchingRequestFingerprint(row: GenerationTaskRow, fingerprint: string) {
  // Pre-v39 rows never persisted the raw client intent and included dynamic
  // Provider configuration in their digest. It cannot be reconstructed
  // safely, so only an exact versioned intent may replay automatically.
  return row.request_fingerprint === fingerprint;
}

function toTask(row: GenerationTaskRow): GenerationTask {
  return {
    attempt: row.attempt,
    canvasId: row.canvas_id,
    costCurrency: row.cost_currency,
    credentialRevision: Number(row.credential_revision),
    createdAt: row.created_at,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    estimatedCostMicrounits: row.estimated_cost_microunits ?? undefined,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    model: row.model ?? undefined,
    modelConfiguration: JSON.parse(row.model_configuration) as Record<string, unknown>,
    nodeId: row.node_id,
    ownerId: row.owner_id ?? undefined,
    parameters: JSON.parse(row.parameters) as Record<string, unknown>,
    prompt: row.prompt,
    providerModelId: row.provider_model_id ?? undefined,
    providerProfileId: row.provider_profile_id ?? undefined,
    providerTaskId: row.provider_task_id ?? undefined,
    providerUsageTokens: row.provider_usage_tokens ?? undefined,
    requestFingerprint: row.request_fingerprint,
    resultAssetId: row.result_asset_id ?? undefined,
    resultText: row.result_text ?? undefined,
    actualCostMicrounits: row.actual_cost_microunits ?? undefined,
    state: row.state,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: GenerationTaskEventRow): GenerationTaskEvent {
  return {
    createdAt: row.created_at,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    id: row.id,
    state: row.state,
    taskId: row.task_id,
  };
}

export function createGenerationTaskStore(dataDirectory: string) {
  const database = openAppDatabase(dataDirectory);

  const recoveredAt = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    const recoveringTaskIds = (
      database
        .prepare("SELECT id FROM generation_tasks WHERE state = 'running'")
        .all() as Array<{ id: string }>
    ).map(({ id }) => id);
    const recover = database.prepare(`
      UPDATE generation_tasks
      SET state = 'recovering', updated_at = ?
      WHERE id = ? AND state = 'running'
    `);
    const recordRecovery = database.prepare(`
      INSERT INTO generation_task_events (task_id, state, created_at)
      VALUES (?, 'recovering', ?)
    `);
    for (const id of recoveringTaskIds) {
      if (recover.run(recoveredAt, id).changes === 1) {
        recordRecovery.run(id, recoveredAt);
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  const readById = database.prepare(`
    SELECT *
    FROM generation_tasks
    WHERE id = ?
  `);
  const readByIdAndOwner = database.prepare(`
    SELECT *
    FROM generation_tasks
    WHERE id = ? AND owner_id = ?
  `);
  const readByIdempotency = database.prepare(`
    SELECT *
    FROM generation_tasks
    WHERE
      canvas_id = ?
      AND idempotency_key = ?
      AND owner_id = '__test__'
  `);
  const readByIdempotencyAndOwner = database.prepare(`
    SELECT *
    FROM generation_tasks
    WHERE canvas_id = ? AND idempotency_key = ? AND owner_id = ?
  `);
  const recordEvent = database.prepare(`
    INSERT INTO generation_task_events (
      task_id,
      state,
      error_code,
      error_message,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `);
  const recordAdmission = database.prepare(`
    INSERT INTO generation_admission_events (
      task_id, execution_attempt, owner_id, kind, admission_type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  function providerAttemptForTask(task: GenerationTaskRow) {
    const byProviderTaskId = task.provider_task_id !== null;
    return database.prepare(`
      SELECT
        credential_revision, execution_attempt, failure_code, finished_at,
        outcome, provider_model_id, provider_profile_id, provider_task_id
      FROM generation_provider_attempts
      WHERE
        task_id = ?
        AND owner_id IS ?
        AND kind = ?
        AND provider_profile_id IS ?
        AND provider_model_id IS ?
        AND ${byProviderTaskId
          ? "provider_task_id = ?"
          : "execution_attempt = ?"}
      ORDER BY execution_attempt DESC
      LIMIT 1
    `).get(
      task.id,
      task.owner_id,
      task.kind,
      task.provider_profile_id,
      task.provider_model_id,
      byProviderTaskId ? task.provider_task_id : task.attempt,
    ) as
      | {
          credential_revision: number;
          execution_attempt: number;
          failure_code: string | null;
          finished_at: string | null;
          outcome: GenerationProviderAttemptOutcome;
          provider_model_id: string;
          provider_profile_id: string;
          provider_task_id: string | null;
        }
      | undefined;
  }

  function hasUnsafeProviderAttemptForNewPaidRetry(taskId: string) {
    return Boolean(database.prepare(`
      SELECT 1
      FROM generation_provider_attempts
      WHERE
        task_id = ?
        AND NOT (
          (outcome = 'provider-failed' AND failure_code = 'PROVIDER_REFUNDED')
          OR
          (outcome = 'definitive-rejected'
            AND failure_code = 'PROVIDER_NOT_ACCEPTED_NO_CHARGE')
        )
      LIMIT 1
    `).get(taskId));
  }

  function toProviderAttemptEvidence(
    row: ReturnType<typeof providerAttemptForTask>,
  ): GenerationProviderAttemptEvidence | undefined {
    return row
      ? {
          credentialRevision: Number(row.credential_revision),
          executionAttempt: row.execution_attempt,
          failureCode: row.failure_code ?? undefined,
          finishedAt: row.finished_at ?? undefined,
          outcome: row.outcome,
          providerModelId: row.provider_model_id,
          providerProfileId: row.provider_profile_id,
          providerTaskId: row.provider_task_id ?? undefined,
        }
      : undefined;
  }

  type AuthoritativeModelBinding = {
    archived_at: string | null;
    binding_enabled: number;
    capability: GenerationTaskKind;
    default_parameters: string;
    model_status: "archived" | "draft" | "published";
    provider_configuration_version: number;
    provider_driver: string;
    provider_model_id: string;
    provider_profile_id: string;
    provider_protocol: string;
    provider_status: "disabled" | "enabled";
  };

  function authoritativeModelBinding(modelId: string | null) {
    if (!modelId) return undefined;
    return database.prepare(`
      SELECT
        models.archived_at,
        models.capability,
        models.default_parameters,
        models.provider_model_id,
        models.provider_profile_id,
        models.provider_protocol,
        models.status AS model_status,
        providers.driver AS provider_driver,
        providers.provider_configuration_version,
        providers.status AS provider_status,
        COALESCE(bindings.enabled, 0) AS binding_enabled
      FROM model_profiles AS models
      JOIN provider_profiles AS providers
        ON providers.id = models.provider_profile_id
      LEFT JOIN node_model_bindings AS bindings
        ON bindings.model_id = models.id
        AND bindings.node_type = models.capability
      WHERE models.id = ?
      LIMIT 1
    `).get(modelId) as AuthoritativeModelBinding | undefined;
  }

  function assertAuthoritativeProviderSnapshot(input: {
    binding: AuthoritativeModelBinding | undefined;
    kind: GenerationTaskKind;
    modelConfiguration: Record<string, unknown>;
    modelId: string | null;
    providerModelId: string | null;
    providerProfileId: string | null;
  }) {
    const binding = input.binding;
    const releaseState = input.modelId
      ? modelContractState(database, input.modelId)
      : undefined;
    const suppliedRelease = input.modelConfiguration.modelReleaseRevision as
      | ModelReleaseRevision
      | undefined;
    if (releaseState?.history.length || modelContractsRequired(database)) {
      const active = releaseState?.active;
      if (!active) {
        throw new GenerationProviderAttemptBlockedError(
          "MODEL_UNAVAILABLE",
          "该模型已停止接受新任务",
        );
      }
      if (
        active.document.runtime === "blocked" ||
        active.document.evidence === "UNKNOWN"
      ) {
        throw new GenerationProviderAttemptBlockedError(
          "MODEL_UNAVAILABLE",
          "该模型缺少可验证的执行合同，已停止接受新任务",
        );
      }
      if (
        !suppliedRelease ||
        suppliedRelease.revisionId !== active.revisionId ||
        suppliedRelease.hash !== active.hash ||
        suppliedRelease.document.providerProfileId !== active.document.providerProfileId ||
        suppliedRelease.document.providerModelId !== active.document.providerModelId ||
        suppliedRelease.document.connectorVersion !== active.document.connectorVersion
      ) {
        throw new GenerationProviderAttemptBlockedError(
          "PROVIDER_CONFIGURATION_MISMATCH",
          "模型合同已变化，未创建新的付费请求",
        );
      }
    }
    const suppliedVersion = input.modelConfiguration
      .providerConfigurationVersion;
    if (
      !binding ||
      binding.archived_at ||
      binding.binding_enabled !== 1 ||
      binding.capability !== input.kind ||
      binding.model_status !== "published" ||
      binding.provider_status !== "enabled" ||
      binding.provider_profile_id !== input.providerProfileId ||
      binding.provider_model_id !== input.providerModelId
    ) {
      throw new GenerationProviderAttemptBlockedError(
        "MODEL_UNAVAILABLE",
        "当前模型绑定不可用于真实生成",
      );
    }
    const fallbackSchema = knownModelParameterSchema({
      capability: binding.capability,
      providerDriver: binding.provider_driver,
      providerModelId: binding.provider_model_id,
    });
    const constraints = providerParameterSchema({
      capability: binding.capability,
      providerDriver: binding.provider_driver,
      providerModelId: binding.provider_model_id,
    });
    let authoritativeParameterSchema: unknown;
    try {
      const stored = JSON.parse(binding.default_parameters) as unknown;
      authoritativeParameterSchema =
        stored &&
          typeof stored === "object" &&
          !Array.isArray(stored) &&
          Object.keys(stored).length === 0
          ? fallbackSchema
          : validateParameterSchemaConstraints(
              cleanParameterSchema(
                binding.capability,
                stored,
                fallbackSchema,
              ),
              constraints,
            );
    } catch {
      if (!constraints) {
        throw new GenerationProviderAttemptBlockedError(
          "PROVIDER_CONFIGURATION_MISMATCH",
          "模型参数规则无效，未创建新的付费请求",
        );
      }
      authoritativeParameterSchema = fallbackSchema;
    }
    if (
      !Number.isSafeInteger(suppliedVersion) ||
      Number(suppliedVersion) < 1 ||
      Number(suppliedVersion) !== binding.provider_configuration_version ||
      input.modelConfiguration.modelId !== input.modelId ||
      input.modelConfiguration.providerDriver !== binding.provider_driver ||
      input.modelConfiguration.providerModelId !== binding.provider_model_id ||
      input.modelConfiguration.providerProfileId !== binding.provider_profile_id ||
      input.modelConfiguration.providerProtocol !== binding.provider_protocol ||
      JSON.stringify(stableValue(input.modelConfiguration.parameterSchema)) !==
        JSON.stringify(stableValue(authoritativeParameterSchema))
    ) {
      throw new GenerationProviderAttemptBlockedError(
        "PROVIDER_CONFIGURATION_MISMATCH",
        "平台连接或模型配置已变化，未创建新的付费请求",
      );
    }
    return binding;
  }

  function markProviderAttemptProgress(input: {
    executionAttempt: number;
    outcome: "accepted" | "response-received";
    taskId: string;
  }) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const allowed = input.outcome === "accepted"
        ? ["boundary-claimed", "accepted"]
        : ["boundary-claimed", "accepted", "response-received"];
      const row = database.prepare(`
        SELECT outcome
        FROM generation_provider_attempts
        WHERE task_id = ? AND execution_attempt = ?
      `).get(input.taskId, input.executionAttempt) as
        | { outcome: GenerationProviderAttemptOutcome }
        | undefined;
      if (!row || !allowed.includes(row.outcome)) {
        throw new Error("Provider attempt cannot advance from its current outcome");
      }
      if (row.outcome !== input.outcome) {
        const result = database.prepare(`
          UPDATE generation_provider_attempts
          SET outcome = ?
          WHERE task_id = ? AND execution_attempt = ? AND outcome = ?
        `).run(
          input.outcome,
          input.taskId,
          input.executionAttempt,
          row.outcome,
        );
        if (result.changes !== 1) {
          throw new Error("Provider attempt changed concurrently");
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function attachProviderTaskId(input: {
    credentialRevision?: number;
    executionAttempt: number;
    providerTaskId: string;
    taskId: string;
  }) {
    if (
      !providerTaskIdPattern.test(input.providerTaskId) ||
      input.providerTaskId.length > 160
    ) {
      throw new Error("Invalid Provider task ID");
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      const task = readById.get(input.taskId) as GenerationTaskRow | undefined;
      if (
        !task ||
        !["running", "recovering"].includes(task.state) ||
        task.attempt !== input.executionAttempt ||
        (input.credentialRevision !== undefined &&
          task.credential_revision !== input.credentialRevision)
      ) {
        throw new Error("Generation task changed concurrently");
      }
      const attempt = database.prepare(`
        SELECT outcome, credential_revision, provider_task_id
        FROM generation_provider_attempts
        WHERE task_id = ? AND execution_attempt = ?
      `).get(input.taskId, input.executionAttempt) as
        | {
            credential_revision: number;
            outcome: GenerationProviderAttemptOutcome;
            provider_task_id: string | null;
          }
        | undefined;
      if (
        !attempt ||
        attempt.credential_revision !== task.credential_revision ||
        !["boundary-claimed", "accepted", "outcome-unknown"].includes(
          attempt.outcome,
        ) ||
        (attempt.provider_task_id &&
          attempt.provider_task_id !== input.providerTaskId) ||
        (task.provider_task_id && task.provider_task_id !== input.providerTaskId)
      ) {
        throw new Error("Provider task ID does not match the current attempt");
      }
      const updatedTask = database.prepare(`
        UPDATE generation_tasks
        SET provider_task_id = ?, updated_at = ?
        WHERE
          id = ?
          AND state IN ('running', 'recovering')
          AND attempt = ?
          AND (provider_task_id IS NULL OR provider_task_id = ?)
      `).run(
        input.providerTaskId,
        new Date().toISOString(),
        input.taskId,
        input.executionAttempt,
        input.providerTaskId,
      );
      if (updatedTask.changes !== 1) {
        throw new Error("Generation task changed concurrently");
      }
      const updatedAttempt = database.prepare(`
        UPDATE generation_provider_attempts
        SET provider_task_id = ?, outcome = 'accepted'
        WHERE
          task_id = ?
          AND execution_attempt = ?
          AND credential_revision = ?
          AND outcome IN ('boundary-claimed', 'accepted', 'outcome-unknown')
      `).run(
        input.providerTaskId,
        input.taskId,
        input.executionAttempt,
        task.credential_revision,
      );
      if (updatedAttempt.changes !== 1) {
        throw new Error("Provider attempt changed concurrently");
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return toTask(readById.get(input.taskId) as GenerationTaskRow);
  }

  function settleProviderAttempt(input: {
    executionAttempt: number;
    failureCode?: string;
    finishedAt?: Date;
    outcome:
      | "completed"
      | "definitive-rejected"
      | "outcome-unknown"
      | "provider-failed";
    taskId: string;
  }) {
    if (
      (input.outcome === "provider-failed" && !input.failureCode) ||
      (input.failureCode !== undefined &&
        (input.failureCode.length < 1 || input.failureCode.length > 80))
    ) {
      throw new Error("Invalid Provider attempt outcome");
    }
    const finishedAt = (input.finishedAt ?? new Date()).toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      const current = database.prepare(`
        SELECT outcome
        FROM generation_provider_attempts
        WHERE task_id = ? AND execution_attempt = ?
      `).get(input.taskId, input.executionAttempt) as
        | {
            outcome: GenerationProviderAttemptOutcome;
        }
        | undefined;
      if (!current) throw new Error("Provider attempt does not exist");
      const allowedSources: Record<
        typeof input.outcome,
        readonly GenerationProviderAttemptOutcome[]
      > = {
        completed: [
          "boundary-claimed", "accepted", "response-received", "completed",
        ],
        "definitive-rejected": [
          "boundary-claimed", "definitive-rejected",
        ],
        "outcome-unknown": [
          "boundary-claimed", "accepted", "response-received", "outcome-unknown",
        ],
        "provider-failed": [
          "boundary-claimed", "accepted", "response-received",
          "provider-failed",
        ],
      };
      if (!allowedSources[input.outcome].includes(current.outcome)) {
        throw new Error("Provider attempt cannot move to that outcome");
      }
      const result = database.prepare(`
        UPDATE generation_provider_attempts
        SET
          outcome = ?,
          failure_code = ?,
          finished_at = ?
        WHERE task_id = ? AND execution_attempt = ?
      `).run(
        input.outcome,
        input.failureCode ?? null,
        finishedAt,
        input.taskId,
        input.executionAttempt,
      );
      if (result.changes !== 1) {
        throw new Error("Provider attempt changed concurrently");
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    dataDirectory,
    activeModelContractRevision(modelId: string) {
      return modelContractState(database, modelId).active;
    },
    close() {
      database.close();
    },

    /**
     * Read-only early replay check for the HTTP layer. This intentionally needs
     * no current model, credential, canvas revision, or safety state.
     */
    getIdempotentIntent(input: GenerationIdempotentIntentInput) {
      if (
        !identifierPattern.test(input.canvasId) ||
        input.canvasId.length > 120 ||
        !idempotencyPattern.test(input.idempotencyKey) ||
        input.idempotencyKey.length < 8 ||
        input.idempotencyKey.length > 200 ||
        !identifierPattern.test(input.ownerId) ||
        input.ownerId.length > 120 ||
        !input.requestIntent ||
        Array.isArray(input.requestIntent) ||
        typeof input.requestIntent !== "object"
      ) {
        throw new Error("Invalid generation idempotency lookup");
      }
      const row = readByIdempotencyAndOwner.get(
        input.canvasId,
        input.idempotencyKey,
        input.ownerId,
      ) as GenerationTaskRow | undefined;
      if (!row) return undefined;
      const fingerprint = hashRequestIntent(stableIntentForLookup(input));
      if (!matchingRequestFingerprint(row, fingerprint)) {
        throw new GenerationTaskConflictError();
      }
      return toTask(row);
    },

    /**
     * Authoritative create path. Idempotency lookup, all dynamic safety reads,
     * task/event insertion and admission consumption share one write lock.
     */
    admitOrGet(
      input: GenerationTaskInput,
      options: { now?: Date } = {},
    ) {
      const normalized = normalizeInput(input);
      if (!normalized.ownerId || !normalized.providerProfileId) {
        throw new Error("Atomic generation admission requires owner and Provider");
      }
      const fingerprint = requestFingerprint(normalized);
      const id = randomUUID();
      const timestamp = (options.now ?? new Date()).toISOString();
      let admittedCredentialRevision = normalized.credentialRevision ?? 0;
      let admittedModelConfiguration = JSON.stringify(
        normalized.modelConfiguration,
      );
      let created = false;
      let row: GenerationTaskRow | undefined;
      database.exec("BEGIN IMMEDIATE");
      try {
        row = readByIdempotencyAndOwner.get(
          normalized.canvasId,
          normalized.idempotencyKey,
          normalized.ownerId,
        ) as GenerationTaskRow | undefined;
        if (row) {
          if (!matchingRequestFingerprint(row, fingerprint)) {
            throw new GenerationTaskConflictError();
          }
          // Convert the durable row while the transaction can still roll back.
          // Once COMMIT returns, the HTTP layer must treat every later failure
          // as an unknown accepted outcome rather than a deterministic 4xx.
          const task = toTask(row);
          database.exec("COMMIT");
          return { created, task };
        }

        if (database.prepare(`
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = ?
          LIMIT 1
        `).get(normalized.ownerId)) {
          throw new GenerationTaskOwnerDeletingError();
        }
        if (normalized.expectedCanvasRevision !== undefined) {
          const canvas = database.prepare(`
            SELECT graph_revision
            FROM canvas_documents
            WHERE owner_id = ? AND id = ?
          `).get(normalized.ownerId, normalized.canvasId) as
            | { graph_revision: number }
            | undefined;
          if (
            !canvas ||
            canvas.graph_revision !== normalized.expectedCanvasRevision
          ) {
            throw new GenerationTaskCanvasRevisionConflictError(
              canvas?.graph_revision ?? -1,
            );
          }
        }

        if (normalized.ownerId !== "__test__") {
          const owner = database.prepare(`
            SELECT status FROM users WHERE id = ?
          `).get(normalized.ownerId) as
            | { status: "active" | "disabled" }
            | undefined;
          if (!owner || owner.status !== "active") {
            throw new GenerationProviderAttemptBlockedError(
              "ACCOUNT_DISABLED",
              "账号当前不可执行真实生成",
            );
          }
          assertAuthoritativeProviderSnapshot({
            binding: authoritativeModelBinding(normalized.model ?? null),
            kind: normalized.kind,
            modelConfiguration: normalized.modelConfiguration ?? {},
            modelId: normalized.model ?? null,
            providerModelId: normalized.providerModelId ?? null,
            providerProfileId: normalized.providerProfileId ?? null,
          });
          const credential = database.prepare(`
            SELECT
              credentials.credential_version,
              credentials.key_status,
              epochs.credential_revision
            FROM account_provider_credentials AS credentials
            JOIN account_provider_credential_epochs AS epochs
              ON epochs.account_id = credentials.account_id
              AND epochs.provider_profile_id = credentials.provider_profile_id
            WHERE
              credentials.account_id = ?
              AND credentials.provider_profile_id = ?
          `).get(normalized.ownerId, normalized.providerProfileId) as
            | {
                credential_revision: number;
                credential_version: number;
                key_status: "invalid" | "unchecked" | "unknown" | "valid";
              }
            | undefined;
          if (!credential) {
            throw new GenerationProviderAttemptBlockedError(
              "ACCOUNT_CREDENTIAL_MISSING",
              "未配置你的平台密钥",
            );
          }
          if (credential.key_status === "invalid") {
            throw new GenerationProviderAttemptBlockedError(
              "ACCOUNT_CREDENTIAL_INVALID",
              "你的平台密钥无效",
            );
          }
          admittedCredentialRevision = Number(
            credential.credential_revision,
          );
          if (
            admittedCredentialRevision < 1 ||
            Number(credential.credential_version) !==
              admittedCredentialRevision ||
            normalized.modelConfiguration?.credentialVersion !==
              admittedCredentialRevision ||
            ((normalized.credentialRevision ?? 0) > 0 &&
              normalized.credentialRevision !== admittedCredentialRevision)
          ) {
            throw new GenerationProviderAttemptBlockedError(
              "ACCOUNT_CREDENTIAL_CHANGED",
              "平台密钥版本已变化，请按当前配置重试",
            );
          }
          admittedModelConfiguration = JSON.stringify(stableValue({
            ...normalized.modelConfiguration,
            credentialVersion: admittedCredentialRevision,
          }));
        }

        const unresolvedSameInput = database.prepare(`
          SELECT t.id
          FROM generation_tasks AS t
          JOIN generation_provider_attempts AS attempt
            ON attempt.task_id = t.id
            AND attempt.execution_attempt = t.attempt
          WHERE
            t.owner_id = ?
            AND t.canvas_id = ?
            AND t.node_id = ?
            AND t.kind = ?
            AND t.request_fingerprint = ?
            AND t.state = 'failed'
            AND attempt.outcome = 'outcome-unknown'
          LIMIT 1
        `).get(
          normalized.ownerId,
          normalized.canvasId,
          normalized.nodeId,
          normalized.kind,
          fingerprint,
        );
        if (unresolvedSameInput) {
          throw new GenerationProviderAttemptBlockedError(
            "RETRY_OUTCOME_UNKNOWN",
            "上次结果仍在系统自动找回中；为避免重复扣费，当前不能重新生成",
          );
        }

        const confirmedSameInput = database.prepare(`
          SELECT t.id
          FROM generation_tasks AS t
          JOIN generation_provider_attempts AS attempt
            ON attempt.task_id = t.id
          WHERE
            t.owner_id = ?
            AND t.canvas_id = ?
            AND t.node_id = ?
            AND t.kind = ?
            AND t.request_fingerprint = ?
            AND t.state != 'cancelled'
            AND attempt.outcome IN ('accepted', 'response-received')
          LIMIT 1
        `).get(
          normalized.ownerId,
          normalized.canvasId,
          normalized.nodeId,
          normalized.kind,
          fingerprint,
        );
        if (confirmedSameInput) {
          throw new GenerationProviderAttemptBlockedError(
            "RETRY_OUTCOME_UNKNOWN",
            "同一输入已有平台任务已受理或已出片；系统会自动处理，当前不能重复提交",
          );
        }

        const admission = generationAdmissionInTransaction(database, {
          kind: normalized.kind,
          now: options.now,
          ownerId: normalized.ownerId,
          providerProfileId: normalized.providerProfileId,
        });
        if (!admission.allowed) {
          throw new GenerationTaskAdmissionError(
            admission.code,
            admission.message,
          );
        }

        database.prepare(`
          INSERT INTO generation_tasks (
            id, canvas_id, node_id, kind, prompt, model, parameters,
            idempotency_key, request_fingerprint, state, attempt,
            created_at, updated_at, owner_id, estimated_cost_microunits,
            provider_profile_id, provider_model_id, cost_currency,
            model_configuration, credential_revision
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0,
            ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `).run(
          id,
          normalized.canvasId,
          normalized.nodeId,
          normalized.kind,
          normalized.prompt,
          normalized.model ?? null,
          JSON.stringify(normalized.parameters),
          normalized.idempotencyKey,
          fingerprint,
          timestamp,
          timestamp,
          normalized.ownerId,
          normalized.estimatedCostMicrounits ?? null,
          normalized.providerProfileId,
          normalized.providerModelId ?? null,
          normalized.costCurrency ?? "USD",
          admittedModelConfiguration,
          admittedCredentialRevision,
        );
        recordEvent.run(id, "queued", null, null, timestamp);
        recordAdmission.run(
          id,
          1,
          normalized.ownerId,
          normalized.kind,
          "initial",
          timestamp,
        );
        row = readById.get(id) as GenerationTaskRow;
        // Keep row decoding on the pre-COMMIT side of the paid admission
        // boundary. The caller can then reliably classify all failures after
        // admitOrGet returns as a committed outcome.
        const task = toTask(row);
        created = true;
        database.exec("COMMIT");
        return { created, task };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    create(input: GenerationTaskInput) {
      const normalized = normalizeInput(input);
      const fingerprint = requestFingerprint(normalized);
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      let created = false;
      let row: GenerationTaskRow | undefined;
      database.exec("BEGIN IMMEDIATE");
      try {
        if (database.prepare(`
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = ?
          LIMIT 1
        `).get(normalized.ownerId ?? "__test__")) {
          throw new GenerationTaskOwnerDeletingError();
        }
        if (normalized.expectedCanvasRevision !== undefined) {
          const canvas = database.prepare(`
            SELECT graph_revision
            FROM canvas_documents
            WHERE owner_id = ? AND id = ?
          `).get(
            normalized.ownerId ?? "__test__",
            normalized.canvasId,
          ) as { graph_revision: number } | undefined;
          if (
            !canvas ||
            canvas.graph_revision !== normalized.expectedCanvasRevision
          ) {
            throw new GenerationTaskCanvasRevisionConflictError(
              canvas?.graph_revision ?? -1,
            );
          }
        }
        const result = database
          .prepare(`
            INSERT OR IGNORE INTO generation_tasks (
              id,
              canvas_id,
              node_id,
              kind,
              prompt,
              model,
              parameters,
              idempotency_key,
              request_fingerprint,
              state,
              attempt,
              created_at,
              updated_at
              , owner_id
              , estimated_cost_microunits
              , provider_profile_id
              , provider_model_id
              , cost_currency
              , model_configuration
              , credential_revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            id,
            normalized.canvasId,
            normalized.nodeId,
            normalized.kind,
            normalized.prompt,
            normalized.model ?? null,
            JSON.stringify(normalized.parameters),
            normalized.idempotencyKey,
            fingerprint,
            timestamp,
            timestamp,
            normalized.ownerId ?? "__test__",
            normalized.estimatedCostMicrounits ?? null,
            normalized.providerProfileId ?? null,
            normalized.providerModelId ?? null,
            normalized.costCurrency ?? "USD",
            JSON.stringify(normalized.modelConfiguration),
            normalized.credentialRevision ?? 0,
          );
        row = readByIdempotencyAndOwner.get(
          normalized.canvasId,
          normalized.idempotencyKey,
          normalized.ownerId ?? "__test__",
        ) as GenerationTaskRow | undefined;
        // The historical database constraint is canvas + key. Never return a
        // task owned by somebody else if a stale browser intent happens to
        // reuse that pair.
        if (!row) throw new GenerationTaskConflictError();
        if (!matchingRequestFingerprint(row, fingerprint)) {
          throw new GenerationTaskConflictError();
        }
        created = result.changes === 1;
        if (created) {
          recordEvent.run(id, "queued", null, null, timestamp);
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      if (!row) throw new GenerationTaskConflictError();

      return {
        created,
        task: toTask(row),
      };
    },

    get(id: string) {
      const row = readById.get(id) as GenerationTaskRow | undefined;
      return row ? toTask(row) : undefined;
    },

    getForOwner(id: string, ownerId: string) {
      const row = readByIdAndOwner.get(id, ownerId) as
        | GenerationTaskRow
        | undefined;
      return row ? toTask(row) : undefined;
    },

    /**
     * Durable paid-boundary evidence for retry/recovery decisions. A persisted
     * Provider task ID is authoritative: if its exact attempt row is missing,
     * this returns undefined and never falls back to the current execution.
     */
    getProviderAttemptForTask(id: string) {
      if (!identifierPattern.test(id) || id.length > 120) {
        throw new Error("Invalid generation task ID");
      }
      const task = readById.get(id) as GenerationTaskRow | undefined;
      return task
        ? toProviderAttemptEvidence(providerAttemptForTask(task))
        : undefined;
    },

    /**
     * A new paid retry is safe only when every earlier paid boundary has a
     * definitive no-result outcome. This intentionally scans the full task
     * ledger: schema-38 tasks can have unresolved rows older than the current
     * local execution.
     */
    hasUnsafeProviderAttemptForNewPaidRetry(id: string) {
      if (!identifierPattern.test(id) || id.length > 120) {
        throw new Error("Invalid generation task ID");
      }
      return hasUnsafeProviderAttemptForNewPaidRetry(id);
    },

    /**
     * 同一画布/节点/输入指纹下，是否已有其它任务持有平台已受理或已出片的
     * 付费证据。存在时绝不允许再开新的付费提交，只能收回旧结果。
     */
    hasConfirmedProviderOutcomeForSibling(taskId: string) {
      if (!identifierPattern.test(taskId) || taskId.length > 120) {
        throw new Error("Invalid generation task ID");
      }
      const row = readById.get(taskId) as GenerationTaskRow | undefined;
      if (!row) return false;
      return Boolean(database.prepare(`
        SELECT 1
        FROM generation_tasks AS t
        JOIN generation_provider_attempts AS attempt
          ON attempt.task_id = t.id
        WHERE
          t.owner_id = ?
          AND t.canvas_id = ?
          AND t.node_id = ?
          AND t.kind = ?
          AND t.request_fingerprint = ?
          AND t.id != ?
          AND t.state != 'cancelled'
          AND attempt.outcome IN ('accepted', 'response-received')
        LIMIT 1
      `).get(
        row.owner_id,
        row.canvas_id,
        row.node_id,
        row.kind,
        row.request_fingerprint,
        row.id,
      ));
    },

    listOwnerRelayMatchContext(input: {
      excludeTaskId: string;
      kind: GenerationTask["kind"];
      ownerId: string;
      providerModelId: string;
      providerProfileId: string;
    }) {
      if (
        !identifierPattern.test(input.ownerId) ||
        input.ownerId.length > 120 ||
        !identifierPattern.test(input.excludeTaskId) ||
        input.excludeTaskId.length > 120 ||
        !identifierPattern.test(input.providerModelId) ||
        input.providerModelId.length > 160 ||
        !identifierPattern.test(input.providerProfileId) ||
        input.providerProfileId.length > 120
      ) {
        throw new Error("Invalid relay match context");
      }
      const occupied = database.prepare(`
        SELECT provider_task_id
        FROM generation_tasks
        WHERE
          owner_id = ?
          AND provider_profile_id = ?
          AND provider_task_id IS NOT NULL
      `).all(input.ownerId, input.providerProfileId) as Array<{
        provider_task_id: string;
      }>;
      const competitors = database.prepare(`
        SELECT id, created_at, updated_at, state
        FROM generation_tasks
        WHERE
          owner_id = ?
          AND id != ?
          AND kind = ?
          AND provider_profile_id = ?
          AND provider_model_id = ?
          AND state IN ('failed', 'success', 'running', 'queued', 'retrying', 'recovering')
      `).all(
        input.ownerId,
        input.excludeTaskId,
        input.kind,
        input.providerProfileId,
        input.providerModelId,
      ) as Array<{
        created_at: string;
        id: string;
        state: string;
        updated_at: string;
      }>;
      return {
        competitors: competitors.map((row) => ({
          createdAt: row.created_at,
          id: row.id,
          state: row.state,
          updatedAt: row.updated_at,
        })),
        occupiedTaskIds: occupied
          .map((row) => row.provider_task_id)
          .filter(Boolean),
      };
    },

    getByIdempotency(canvasId: string, idempotencyKey: string) {
      if (
        !identifierPattern.test(canvasId) ||
        canvasId.length > 120 ||
        !idempotencyPattern.test(idempotencyKey) ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 200
      ) {
        throw new Error("Invalid generation idempotency lookup");
      }
      const row = readByIdempotency.get(
        canvasId,
        idempotencyKey,
      ) as GenerationTaskRow | undefined;
      return row ? toTask(row) : undefined;
    },

    getByIdempotencyForOwner(
      canvasId: string,
      idempotencyKey: string,
      ownerId: string,
    ) {
      if (
        !identifierPattern.test(canvasId) ||
        canvasId.length > 120 ||
        !idempotencyPattern.test(idempotencyKey) ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 200 ||
        !identifierPattern.test(ownerId) ||
        ownerId.length > 120
      ) {
        throw new Error("Invalid generation idempotency lookup");
      }
      const row = readByIdempotencyAndOwner.get(
        canvasId,
        idempotencyKey,
        ownerId,
      ) as GenerationTaskRow | undefined;
      return row ? toTask(row) : undefined;
    },

    list(canvasId: string) {
      if (!identifierPattern.test(canvasId) || canvasId.length > 120) {
        throw new Error("Invalid canvas ID");
      }
      return (database.prepare(`
        WITH latest_terminal AS (
          SELECT rowid
          FROM generation_tasks
          WHERE
            canvas_id = ?
            AND state NOT IN ('queued', 'running', 'retrying', 'recovering')
          ORDER BY updated_at DESC, rowid DESC
          LIMIT 500
        )
        SELECT tasks.*
        FROM generation_tasks AS tasks
        WHERE
          tasks.canvas_id = ?
          AND (
            tasks.state IN ('queued', 'running', 'retrying', 'recovering')
            OR tasks.rowid IN (SELECT rowid FROM latest_terminal)
          )
        ORDER BY
          CASE WHEN tasks.state IN ('queued', 'running', 'retrying', 'recovering')
            THEN 0 ELSE 1 END ASC,
          CASE WHEN tasks.state IN ('queued', 'running', 'retrying', 'recovering')
            THEN tasks.created_at END ASC,
          CASE WHEN tasks.state NOT IN ('queued', 'running', 'retrying', 'recovering')
            THEN tasks.updated_at END DESC,
          tasks.rowid DESC
      `).all(canvasId, canvasId) as GenerationTaskRow[]).map(toTask);
    },

    listForOwner(canvasId: string, ownerId: string) {
      if (
        !identifierPattern.test(canvasId) ||
        canvasId.length > 120 ||
        !identifierPattern.test(ownerId) ||
        ownerId.length > 120
      ) {
        throw new Error("Invalid canvas or owner ID");
      }
      return (database.prepare(`
        WITH latest_terminal AS (
          SELECT rowid
          FROM generation_tasks
          WHERE
            canvas_id = ?
            AND owner_id = ?
            AND state NOT IN ('queued', 'running', 'retrying', 'recovering')
          ORDER BY updated_at DESC, rowid DESC
          LIMIT 500
        )
        SELECT tasks.*
        FROM generation_tasks AS tasks
        WHERE
          tasks.canvas_id = ?
          AND tasks.owner_id = ?
          AND (
            tasks.state IN ('queued', 'running', 'retrying', 'recovering')
            OR tasks.rowid IN (SELECT rowid FROM latest_terminal)
          )
        ORDER BY
          CASE WHEN tasks.state IN ('queued', 'running', 'retrying', 'recovering')
            THEN 0 ELSE 1 END ASC,
          CASE WHEN tasks.state IN ('queued', 'running', 'retrying', 'recovering')
            THEN tasks.created_at END ASC,
          CASE WHEN tasks.state NOT IN ('queued', 'running', 'retrying', 'recovering')
            THEN tasks.updated_at END DESC,
          tasks.rowid DESC
      `).all(
        canvasId,
        ownerId,
        canvasId,
        ownerId,
      ) as GenerationTaskRow[]).map(toTask);
    },

    listActiveForCanvas(canvasId: string, ownerId?: string) {
      if (
        !identifierPattern.test(canvasId) ||
        canvasId.length > 120 ||
        (ownerId !== undefined &&
          (!identifierPattern.test(ownerId) || ownerId.length > 120))
      ) {
        throw new Error("Invalid canvas or owner ID");
      }
      const rows = ownerId === undefined
        ? database.prepare(`
            SELECT *
            FROM generation_tasks
            WHERE
              canvas_id = ?
              AND state IN ('queued', 'running', 'retrying', 'recovering')
            ORDER BY created_at ASC, rowid ASC
          `).all(canvasId)
        : database.prepare(`
            SELECT *
            FROM generation_tasks
            WHERE
              canvas_id = ?
              AND owner_id = ?
              AND state IN ('queued', 'running', 'retrying', 'recovering')
            ORDER BY created_at ASC, rowid ASC
          `).all(canvasId, ownerId);
      return (rows as GenerationTaskRow[]).map(toTask);
    },

    retryBindingsForCanvas(canvasId: string, ownerId?: string) {
      if (
        !identifierPattern.test(canvasId) ||
        canvasId.length > 120 ||
        (ownerId !== undefined &&
          (!identifierPattern.test(ownerId) || ownerId.length > 120))
      ) {
        throw new Error("Invalid canvas or owner ID");
      }
      const row = (ownerId === undefined
        ? database.prepare(`
            SELECT graph_revision, nodes
            FROM canvas_documents
            WHERE id = ?
            ORDER BY owner_id = '__test__' DESC, owner_id IS NULL DESC
            LIMIT 1
          `).get(canvasId)
        : database.prepare(`
            SELECT graph_revision, nodes
            FROM canvas_documents
            WHERE owner_id = ? AND id = ?
          `).get(ownerId, canvasId)) as
        | { graph_revision: number; nodes: string }
        | undefined;
      return row
        ? canvasRetryBindings(row.nodes, Number(row.graph_revision))
        : new Map<string, GenerationTaskCanvasRetryBinding>();
    },

    listRecovering() {
      return (
        database
          .prepare(`
            SELECT *
            FROM generation_tasks
            WHERE state = 'recovering'
            ORDER BY created_at ASC, rowid ASC
          `)
          .all() as GenerationTaskRow[]
      ).map(toTask);
    },

    listFailedOutcomeUnknown() {
      return (
        database
          .prepare(`
            SELECT *
            FROM generation_tasks
            WHERE
              state = 'failed'
              AND error_code = 'OUTCOME_UNKNOWN_BILLING_RISK'
              AND provider_task_id IS NULL
            ORDER BY updated_at ASC, rowid ASC
            LIMIT 200
          `)
          .all() as GenerationTaskRow[]
      ).map(toTask).filter((task) =>
        task.modelConfiguration.providerProtocol === "media-generate"
      );
    },

    /**
     * Claims one durable recovery checkpoint with a compare-and-swap on the
     * last persisted timestamp. This is the database lease used by the
     * periodic worker; another process cannot claim the same checkpoint.
     */
    claimRecovering(taskId: string, expectedUpdatedAt: string, now = new Date()) {
      if (!identifierPattern.test(taskId) || taskId.length > 120) {
        throw new Error("Invalid generation task ID");
      }
      const expectedTimestamp = Date.parse(expectedUpdatedAt);
      const nowMs = now.getTime();
      const timestamp = new Date(Math.max(
        nowMs,
        Number.isFinite(expectedTimestamp) ? expectedTimestamp + 1 : nowMs,
      )).toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = readById.get(taskId) as GenerationTaskRow | undefined;
        if (!current || current.state !== "recovering" || current.updated_at !== expectedUpdatedAt) {
          database.exec("COMMIT");
          return undefined;
        }
        const checkpoint = database.prepare(`
          SELECT COUNT(*) AS count
          FROM generation_task_events
          WHERE task_id = ? AND error_code = 'AUTOMATIC_RESULT_RECOVERY_CHECKPOINT'
        `).get(taskId) as { count: number };
        const checkpointCount = Number(checkpoint.count);
        const delayMs = checkpointCount === 0
          ? 0
          : Math.min(30_000 * 2 ** Math.min(checkpointCount - 1, 10), 15 * 60_000);
        if (!Number.isFinite(nowMs) || nowMs - expectedTimestamp < delayMs) {
          database.exec("COMMIT");
          return undefined;
        }
        const contract = JSON.parse(current.model_configuration) as Record<string, unknown>;
        const revision = contract.modelReleaseRevision as Record<string, unknown> | undefined;
        const document = revision?.document as Record<string, unknown> | undefined;
        const execution = document?.executionContract as Record<string, unknown> | undefined;
        const pollPolicy = execution?.pollPolicy as Record<string, unknown> | undefined;
        const declaredDeadline = Number(pollPolicy?.deadlineMs);
        const providerWindowMs = Number.isFinite(declaredDeadline) && declaredDeadline > 0
          ? Math.min(declaredDeadline, 24 * 60 * 60_000)
          : current.kind === "video" ? 75 * 60_000 : 15 * 60_000;
        const createdMs = Date.parse(current.created_at);
        if (Number.isFinite(createdMs) && nowMs > createdMs + providerWindowMs + 24 * 60 * 60_000) {
          const incident = database.prepare(`
            UPDATE generation_tasks
            SET state = 'failed', error_code = 'OPERATOR_INCIDENT',
              error_message = '系统未能在安全窗口内自动找回结果，已进入管理员处理队列',
              updated_at = ?
            WHERE id = ? AND state = 'recovering' AND updated_at = ?
          `).run(timestamp, taskId, expectedUpdatedAt);
          if (incident.changes === 1) {
            recordEvent.run(
              taskId, "failed", "OPERATOR_INCIDENT",
              "系统未能在安全窗口内自动找回结果，已进入管理员处理队列",
              timestamp,
            );
          }
          database.exec("COMMIT");
          return undefined;
        }
        const claimed = database.prepare(`
          UPDATE generation_tasks
          SET
            error_code = 'AUTOMATIC_RESULT_RECOVERY',
            error_message = '系统正在自动找回平台结果；不会重新提交付费请求',
            updated_at = ?
          WHERE id = ? AND state = 'recovering' AND updated_at = ?
        `).run(timestamp, taskId, expectedUpdatedAt);
        if (claimed.changes === 1) {
          recordEvent.run(
            taskId, "recovering", "AUTOMATIC_RESULT_RECOVERY_CHECKPOINT",
            `checkpoint=${checkpointCount + 1};next_delay_ms=${Math.min(30_000 * 2 ** Math.min(checkpointCount, 10), 15 * 60_000)}`,
            timestamp,
          );
        }
        database.exec("COMMIT");
        return claimed.changes === 1
          ? toTask(readById.get(taskId) as GenerationTaskRow)
          : undefined;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    listOperatorIncidents() {
      return (database.prepare(`
        SELECT * FROM generation_tasks
        WHERE state = 'failed' AND error_code = 'OPERATOR_INCIDENT'
        ORDER BY updated_at ASC, rowid ASC LIMIT 200
      `).all() as GenerationTaskRow[]).map(toTask);
    },

    recordProviderResponseEvidence(
      taskId: string,
      evidence: Readonly<{
        contentType?: string;
        failureStage?: string;
        fieldPaths: readonly string[];
        httpStatus?: number;
        providerRequestId?: string;
        responseBytes?: number;
        structureHash?: string;
      }>,
    ) {
      if (!identifierPattern.test(taskId) || taskId.length > 120) {
        throw new Error("Invalid generation task ID");
      }
      const task = readById.get(taskId) as GenerationTaskRow | undefined;
      if (!task) throw new Error("Generation task not found");
      const safe = {
        contentType: evidence.contentType?.slice(0, 160),
        failureStage: evidence.failureStage?.slice(0, 80),
        fieldPaths: evidence.fieldPaths.slice(0, 128).map((path) => path.slice(0, 160)),
        httpStatus: evidence.httpStatus,
        providerRequestId: evidence.providerRequestId?.slice(0, 160),
        responseBytes: evidence.responseBytes,
        structureHash: evidence.structureHash?.slice(0, 64),
      };
      recordEvent.run(
        taskId, task.state, "PROVIDER_RESPONSE_EVIDENCE",
        JSON.stringify(safe), new Date().toISOString(),
      );
    },

    listActive() {
      return (
        database
          .prepare(`
            SELECT *
            FROM generation_tasks
            WHERE state IN ('queued', 'running', 'retrying', 'recovering')
            ORDER BY created_at ASC, rowid ASC
          `)
          .all() as GenerationTaskRow[]
      ).map(toTask);
    },

    listQueued() {
      return (
        database
          .prepare(`
            SELECT *
            FROM generation_tasks
            WHERE state = 'queued'
            ORDER BY created_at ASC, rowid ASC
          `)
          .all() as GenerationTaskRow[]
      ).map(toTask);
    },

    /**
     * Failed tasks that still hold an accepted Provider task id and have not
     * used their single automatic resume slot. The server-side recovery sweep
     * uses this list so a result can be re-collected without any user action.
     */
    listFailedAutoRecoverable(olderThan: Date) {
      return (
        database
          .prepare(`
            SELECT *
            FROM generation_tasks
            WHERE
              state = 'failed'
              AND attempt < 2
              AND provider_task_id IS NOT NULL
              AND updated_at <= ?
            ORDER BY updated_at ASC, rowid ASC
            LIMIT 200
          `)
          .all(olderThan.toISOString()) as GenerationTaskRow[]
      ).map(toTask);
    },

    listEvents(id: string) {
      if (!identifierPattern.test(id) || id.length > 120) {
        throw new Error("Invalid generation task ID");
      }
      return (
        database
          .prepare(`
            SELECT *
            FROM generation_task_events
            WHERE task_id = ?
            ORDER BY created_at ASC, id ASC
            LIMIT 1_000
          `)
          .all(id) as GenerationTaskEventRow[]
      ).map(toEvent);
    },

    admitRetry(input: GenerationTaskRetryFence & (
      | {
          mode: "new-paid-attempt";
          now?: Date;
          snapshot: GenerationPaidRetrySnapshot;
          taskId: string;
        }
      | {
          mode: "resume-provider-task";
          now?: Date;
          taskId: string;
        }
    )) {
      if (
        !identifierPattern.test(input.taskId) ||
        input.taskId.length > 120 ||
        !identifierPattern.test(input.canvasId) ||
        input.canvasId.length > 120 ||
        !identifierPattern.test(input.nodeId) ||
        input.nodeId.length > 160 ||
        !generationTaskKinds.includes(input.kind) ||
        !Number.isSafeInteger(input.expectedAttempt) ||
        input.expectedAttempt < 0 ||
        !Number.isSafeInteger(input.expectedCanvasRevision) ||
        input.expectedCanvasRevision < 0 ||
        typeof input.expectedUpdatedAt !== "string" ||
        input.expectedUpdatedAt.length < 1 ||
        input.expectedUpdatedAt.length > 80 ||
        typeof input.expectedGenerationInputKey !== "string" ||
        input.expectedGenerationInputKey.length < 1 ||
        input.expectedGenerationInputKey.length > 100_000
      ) {
        throw new Error("Invalid generation retry fence");
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = readById.get(input.taskId) as GenerationTaskRow | undefined;
        if (!current) {
          database.exec("COMMIT");
          return undefined;
        }
        if (current.state !== "failed") {
          throw new GenerationTaskTransitionError(current.state, "retrying");
        }
        if (
          current.canvas_id !== input.canvasId ||
          current.node_id !== input.nodeId ||
          current.kind !== input.kind
        ) {
          throw new GenerationTaskRetryFenceError(
            "RETRY_BINDING_STALE",
            "任务已不再绑定当前画布节点",
          );
        }
        if (
          current.attempt !== input.expectedAttempt ||
          current.updated_at !== input.expectedUpdatedAt
        ) {
          throw new GenerationTaskRetryFenceError(
            "RETRY_TASK_CHANGED",
            "任务状态已变化，请刷新后再试",
          );
        }
        const ownerId = current.owner_id ?? "__test__";
        if (database.prepare(`
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = ?
          LIMIT 1
        `).get(ownerId)) {
          throw new GenerationTaskOwnerDeletingError();
        }

        const canvas = database.prepare(`
          SELECT graph_revision, nodes
          FROM canvas_documents
          WHERE owner_id IS ? AND id = ?
        `).get(current.owner_id, current.canvas_id) as
          | { graph_revision: number; nodes: string }
          | undefined;
        if (!canvas) {
          throw new GenerationTaskRetryFenceError(
            "RETRY_BINDING_STALE",
            "画布或任务节点已不存在，不能重试旧任务",
          );
        }
        if (Number(canvas.graph_revision) !== input.expectedCanvasRevision) {
          throw new GenerationTaskCanvasRevisionConflictError(
            Number(canvas.graph_revision),
          );
        }
        const binding = canvasRetryBindings(
          canvas.nodes,
          Number(canvas.graph_revision),
        ).get(current.id);
        if (
          !binding ||
          binding.kind !== current.kind ||
          binding.nodeId !== current.node_id ||
          binding.generationInputKey !== input.expectedGenerationInputKey
        ) {
          throw new GenerationTaskRetryFenceError(
            "RETRY_BINDING_STALE",
            "任务已不再绑定当前节点输入，请从节点重新提交",
          );
        }

        const executionAttempt = Math.max(1, current.attempt + 1);
        let credentialRevision = Number(current.credential_revision);
        let modelConfiguration = current.model_configuration;
        let providerModelId = current.provider_model_id;
        let providerProfileId = current.provider_profile_id;
        if (input.mode === "new-paid-attempt") {
          if (ownerId !== "__test__") {
            const owner = database.prepare(`
              SELECT status FROM users WHERE id = ?
            `).get(ownerId) as
              | { status: "active" | "disabled" }
              | undefined;
            if (!owner || owner.status !== "active") {
              throw new GenerationProviderAttemptBlockedError(
                "ACCOUNT_DISABLED",
                "账号当前不可创建新的付费重试",
              );
            }
          }
          const priorAttempt = providerAttemptForTask(current);
          if (
            (current.provider_task_id && !priorAttempt) ||
            hasUnsafeProviderAttemptForNewPaidRetry(current.id)
          ) {
            throw new GenerationProviderAttemptBlockedError(
              "RETRY_OUTCOME_UNKNOWN",
              "上一次模型平台请求可能仍有结果，已阻止新的付费重试",
            );
          }
          const snapshotJson = JSON.stringify(stableValue(
            input.snapshot.modelConfiguration,
          ));
          if (
            !identifierPattern.test(input.snapshot.providerProfileId) ||
            input.snapshot.providerProfileId.length > 120 ||
            input.snapshot.providerModelId.length < 1 ||
            input.snapshot.providerModelId.length > 160 ||
            !Number.isSafeInteger(input.snapshot.credentialRevision) ||
            input.snapshot.credentialRevision < 1 ||
            !input.snapshot.modelConfiguration ||
            Array.isArray(input.snapshot.modelConfiguration) ||
            typeof input.snapshot.modelConfiguration !== "object" ||
            snapshotJson.length > 128_000
          ) {
            throw new Error("Invalid paid retry snapshot");
          }
          assertAuthoritativeProviderSnapshot({
            binding: authoritativeModelBinding(current.model),
            kind: current.kind,
            modelConfiguration: input.snapshot.modelConfiguration,
            modelId: current.model,
            providerModelId: input.snapshot.providerModelId,
            providerProfileId: input.snapshot.providerProfileId,
          });
          const credential = database.prepare(`
            SELECT
              credentials.credential_version,
              credentials.key_status,
              epochs.credential_revision
            FROM account_provider_credentials AS credentials
            JOIN account_provider_credential_epochs AS epochs
              ON epochs.account_id = credentials.account_id
              AND epochs.provider_profile_id = credentials.provider_profile_id
            WHERE
              credentials.account_id = ?
              AND credentials.provider_profile_id = ?
          `).get(ownerId, input.snapshot.providerProfileId) as
            | {
                credential_revision: number;
                credential_version: number;
                key_status: "invalid" | "unchecked" | "unknown" | "valid";
              }
            | undefined;
          if (ownerId !== "__test__") {
            if (!credential) {
              throw new GenerationProviderAttemptBlockedError(
                "ACCOUNT_CREDENTIAL_MISSING",
                "未配置你的平台密钥",
              );
            }
            if (credential.key_status === "invalid") {
              throw new GenerationProviderAttemptBlockedError(
                "ACCOUNT_CREDENTIAL_INVALID",
                "你的平台密钥无效",
              );
            }
            if (
              Number(credential.credential_revision) !==
                input.snapshot.credentialRevision ||
              Number(credential.credential_version) !==
                input.snapshot.credentialRevision ||
              input.snapshot.modelConfiguration.credentialVersion !==
                input.snapshot.credentialRevision
            ) {
              throw new GenerationProviderAttemptBlockedError(
                "ACCOUNT_CREDENTIAL_CHANGED",
                "平台密钥版本已变化，未创建新的付费重试",
              );
            }
          }
          const admission = generationAdmissionInTransaction(database, {
            kind: current.kind,
            now: input.now,
            ownerId,
            providerProfileId: input.snapshot.providerProfileId,
          });
          if (!admission.allowed) {
            throw new GenerationTaskAdmissionError(
              admission.code,
              admission.message,
            );
          }
          credentialRevision = input.snapshot.credentialRevision;
          modelConfiguration = JSON.stringify(stableValue({
            ...input.snapshot.modelConfiguration,
            credentialVersion: input.snapshot.credentialRevision,
          }));
          providerModelId = input.snapshot.providerModelId;
          providerProfileId = input.snapshot.providerProfileId;
        } else {
          const paidAttempt = providerAttemptForTask(current);
          if (
            !current.provider_task_id ||
            !paidAttempt ||
            !["accepted", "response-received"].includes(paidAttempt.outcome)
          ) {
            throw new Error(
              "Provider task resume requires exact accepted Provider evidence",
            );
          }
        }

        const updated = database.prepare(`
          UPDATE generation_tasks
          SET
            state = 'queued',
            provider_task_id = CASE WHEN ? = 'new-paid-attempt'
              THEN NULL ELSE provider_task_id END,
            provider_usage_tokens = CASE WHEN ? = 'new-paid-attempt'
              THEN NULL ELSE provider_usage_tokens END,
            actual_cost_microunits = CASE WHEN ? = 'new-paid-attempt'
              THEN NULL ELSE actual_cost_microunits END,
            result_asset_id = CASE WHEN ? = 'new-paid-attempt'
              THEN NULL ELSE result_asset_id END,
            result_text = CASE WHEN ? = 'new-paid-attempt'
              THEN NULL ELSE result_text END,
            credential_revision = ?,
            model_configuration = ?,
            provider_profile_id = ?,
            provider_model_id = ?,
            error_code = NULL,
            error_message = NULL,
            updated_at = ?
          WHERE
            id = ?
            AND state = 'failed'
            AND attempt = ?
            AND updated_at = ?
        `).run(
          input.mode,
          input.mode,
          input.mode,
          input.mode,
          input.mode,
          credentialRevision,
          modelConfiguration,
          providerProfileId,
          providerModelId,
          timestamp,
          current.id,
          input.expectedAttempt,
          input.expectedUpdatedAt,
        );
        if (updated.changes !== 1) {
          throw new Error("Generation task changed concurrently");
        }
        recordEvent.run(current.id, "retrying", null, null, timestamp);
        recordEvent.run(current.id, "queued", null, null, timestamp);
        if (input.mode === "new-paid-attempt") {
          recordAdmission.run(
            current.id,
            executionAttempt,
            ownerId,
            current.kind,
            "new-paid-retry",
            timestamp,
          );
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return toTask(readById.get(input.taskId) as GenerationTaskRow);
    },

    /**
     * Records the exact boundary at which a generation request is about to be
     * sent to a Provider. Local validation, media preparation, polling, and
     * result downloads must never call this method.
     *
     * BEGIN IMMEDIATE makes the capability recovery slot atomic across server
     * workers: after an AUTH/PERMISSION incident, one real credential revision
     * permits only one provider+kind probe attempt.
     */
    recordProviderAttempt(id: string) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = readById.get(id) as GenerationTaskRow | undefined;
        if (
          !current ||
          current.state !== "running" ||
          current.attempt < 1 ||
          !current.provider_profile_id ||
          !current.provider_model_id ||
          current.provider_task_id !== null
        ) {
          throw new GenerationProviderAttemptBlockedError(
            "PROVIDER_ATTEMPT_ALREADY_RECORDED",
            "生成任务状态已变化，本次没有向模型平台提交",
          );
        }

        const alreadyRecorded = database.prepare(`
          SELECT 1
          FROM generation_provider_attempts
          WHERE task_id = ? AND execution_attempt = ?
          LIMIT 1
        `).get(id, current.attempt);
        if (alreadyRecorded) {
          throw new GenerationProviderAttemptBlockedError(
            "PROVIDER_ATTEMPT_ALREADY_RECORDED",
            "本次执行已经进入过模型平台，为避免重复扣费没有再次提交",
          );
        }
        let recoveryAt = Number.NEGATIVE_INFINITY;
        const fixtureOwner = !current.owner_id || current.owner_id === "__test__";
        if (!fixtureOwner) {
          const admissionEvidence = database.prepare(`
            SELECT 1
            FROM generation_admission_events
            WHERE
              task_id = ?
              AND execution_attempt = ?
              AND admission_type IN ('initial', 'new-paid-retry')
            LIMIT 1
          `).get(current.id, current.attempt);
          if (!admissionEvidence) {
            throw new GenerationProviderAttemptBlockedError(
              "ATOMIC_ADMISSION_REQUIRED",
              "任务没有原子准入记录，本次没有向模型平台提交",
            );
          }
          const boundary = generationProviderBoundaryDecisionInTransaction(
            database,
            {
              kind: current.kind,
              ownerId: current.owner_id ?? "__test__",
              providerProfileId: current.provider_profile_id,
            },
          );
          if (!boundary.allowed) {
            const code = boundary.code === "EMERGENCY_STOP" ||
                boundary.code === "GLOBAL_DISABLED" ||
                boundary.code === "PROVIDER_COOLDOWN"
              ? boundary.code
              : "PROVIDER_COOLDOWN";
            throw new GenerationProviderAttemptBlockedError(
              code,
              boundary.message,
            );
          }

          const owner = database.prepare(`
            SELECT status
            FROM users
            WHERE id = ?
          `).get(current.owner_id) as { status: "active" | "disabled" } | undefined;
          if (!owner || owner.status !== "active" || database.prepare(`
            SELECT 1 FROM account_delete_intents WHERE owner_id = ? LIMIT 1
          `).get(current.owner_id)) {
            throw new GenerationProviderAttemptBlockedError(
              "ACCOUNT_DISABLED",
              "账号当前不可执行真实生成",
            );
          }

          const taskModelConfiguration = JSON.parse(
            current.model_configuration,
          ) as Record<string, unknown>;
          assertAuthoritativeProviderSnapshot({
            binding: authoritativeModelBinding(current.model),
            kind: current.kind,
            modelConfiguration: taskModelConfiguration,
            modelId: current.model,
            providerModelId: current.provider_model_id,
            providerProfileId: current.provider_profile_id,
          });

          const credential = database.prepare(`
            SELECT
              credentials.credential_version,
              credentials.key_status,
              epochs.credential_revision,
              epochs.updated_at AS epoch_updated_at
            FROM account_provider_credentials AS credentials
            JOIN account_provider_credential_epochs AS epochs
              ON epochs.account_id = credentials.account_id
              AND epochs.provider_profile_id = credentials.provider_profile_id
            WHERE
              credentials.account_id = ?
              AND credentials.provider_profile_id = ?
          `).get(current.owner_id, current.provider_profile_id) as
            | {
                credential_revision: number;
                credential_version: number;
                epoch_updated_at: string;
                key_status: "invalid" | "unchecked" | "unknown" | "valid";
              }
            | undefined;
          if (!credential) {
            throw new GenerationProviderAttemptBlockedError(
              "ACCOUNT_CREDENTIAL_MISSING",
              "未配置你的平台密钥",
            );
          }
          if (credential.key_status === "invalid") {
            throw new GenerationProviderAttemptBlockedError(
              "ACCOUNT_CREDENTIAL_INVALID",
              "你的平台密钥无效",
            );
          }
          if (
            current.credential_revision < 1 ||
            Number(credential.credential_version) !== current.credential_revision ||
            Number(credential.credential_revision) !== current.credential_revision ||
            taskModelConfiguration.credentialVersion !==
              current.credential_revision
          ) {
            throw new GenerationProviderAttemptBlockedError(
              "ACCOUNT_CREDENTIAL_CHANGED",
              "平台密钥版本已变化，旧任务本次没有向模型平台提交",
            );
          }

          const latestAuthOutcome = database.prepare(`
            SELECT credential_revision, failure_code,
              COALESCE(finished_at, created_at) AS outcome_at,
              outcome
            FROM generation_provider_attempts
            WHERE
              provider_profile_id = ?
              AND kind = ?
              AND owner_id = ?
              AND (
                (
                  credential_revision = ?
                  AND outcome = 'completed'
                )
                OR (
                  outcome IN (
                    'accepted', 'response-received',
                    'provider-failed', 'definitive-rejected',
                    'outcome-unknown'
                  )
                  AND failure_code IN ('AUTH', 'PERMISSION')
                )
              )
            ORDER BY
              (credential_revision = ?) DESC,
              COALESCE(finished_at, created_at) DESC,
              id DESC
            LIMIT 1
          `).get(
            current.provider_profile_id,
            current.kind,
            current.owner_id,
            current.credential_revision,
            current.credential_revision,
          ) as
            | {
                credential_revision: number;
                failure_code: string | null;
                outcome:
                  | "completed"
                  | "definitive-rejected"
                  | "provider-failed"
                  | "outcome-unknown"
                  | "accepted"
                  | "response-received";
                outcome_at: string;
              }
            | undefined;
          if (
            latestAuthOutcome &&
            latestAuthOutcome.outcome !== "completed"
          ) {
            const authFailureAt = Date.parse(latestAuthOutcome.outcome_at);
            // Credential epoch timestamps only move when key material changes.
            // Generic Provider/model `updated_at` fields also move for labels
            // and ordering and must never grant a paid auth-recovery slot.
            recoveryAt = Date.parse(credential.epoch_updated_at);
            if (
              latestAuthOutcome.credential_revision >= current.credential_revision ||
              (!Number.isFinite(recoveryAt) || recoveryAt <= authFailureAt)
            ) {
              throw new GenerationProviderAttemptBlockedError(
                "PROVIDER_AUTH_FAILED",
                "当前模型授权或权限校验仍未恢复，本次没有向模型平台提交",
              );
            }
            const recoveryAttempt = database.prepare(`
              SELECT 1
              FROM generation_provider_attempts
              WHERE
                provider_profile_id = ?
                AND kind = ?
                AND owner_id = ?
                AND credential_revision = ?
                AND created_at >= ?
              ORDER BY created_at DESC, id DESC
              LIMIT 1
            `).get(
              current.provider_profile_id,
              current.kind,
              current.owner_id,
              current.credential_revision,
              new Date(recoveryAt).toISOString(),
            );
            if (recoveryAttempt) {
              throw new GenerationProviderAttemptBlockedError(
                "PROVIDER_RECOVERY_ATTEMPT_USED",
                "配置更新后的恢复尝试已经使用，请等待结果或再次更新凭据",
              );
            }
          }
        }

        const createdAt = new Date(Math.max(
          Date.now(),
          Number.isFinite(recoveryAt) ? recoveryAt : Number.NEGATIVE_INFINITY,
        )).toISOString();
        database.prepare(`
          INSERT INTO generation_provider_attempts (
            task_id,
            execution_attempt,
            owner_id,
            provider_profile_id,
            provider_model_id,
            kind,
            evidence,
            credential_revision,
            outcome,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'provider-boundary', ?, 'boundary-claimed', ?)
        `).run(
          current.id,
          current.attempt,
          current.owner_id ?? null,
          current.provider_profile_id,
          current.provider_model_id,
          current.kind,
          current.credential_revision,
          createdAt,
        );
        database.exec("COMMIT");
        return { createdAt, executionAttempt: current.attempt };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    markProviderAttemptAccepted(input: {
      executionAttempt: number;
      taskId: string;
    }) {
      markProviderAttemptProgress({ ...input, outcome: "accepted" });
    },

    markProviderResponseReceived(input: {
      executionAttempt: number;
      taskId: string;
    }) {
      markProviderAttemptProgress({ ...input, outcome: "response-received" });
    },

    markProviderResponseReceivedForTask(taskId: string) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const task = readById.get(taskId) as GenerationTaskRow | undefined;
        if (!task) throw new Error("Generation task does not exist");
        const attempt = providerAttemptForTask(task);
        if (
          !attempt ||
          !["accepted", "response-received"].includes(attempt.outcome)
        ) {
          throw new Error("Provider attempt has no accepted remote task");
        }
        if (attempt.outcome !== "response-received") {
          const updated = database.prepare(`
            UPDATE generation_provider_attempts
            SET outcome = 'response-received'
            WHERE
              task_id = ?
              AND execution_attempt = ?
              AND outcome = 'accepted'
          `).run(task.id, attempt.execution_attempt);
          if (updated.changes !== 1) {
            throw new Error("Provider attempt changed concurrently");
          }
        }
        database.exec("COMMIT");
        return { executionAttempt: attempt.execution_attempt };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    providerAttemptCreatedAt(taskId: string) {
      const task = readById.get(taskId) as GenerationTaskRow | undefined;
      if (!task) return undefined;
      return generationProviderAttemptCreatedAt(database, {
        executionAttempt: task.attempt,
        providerTaskId: task.provider_task_id ?? undefined,
        taskId,
      });
    },

    attachProviderTaskId,

    settleProviderAttempt,

    transition(
      id: string,
      nextState: GenerationTaskState,
      error?: { code: string; message: string },
      options?: { preserveProviderTaskId?: boolean },
    ) {
      assertTaskError(error);
      const preserveProviderTaskId = options?.preserveProviderTaskId === true;
      const timestamp = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = readById.get(id) as GenerationTaskRow | undefined;
        if (!current) {
          database.exec("COMMIT");
          return undefined;
        }
        if (!allowedTransitions[current.state].includes(nextState)) {
          throw new GenerationTaskTransitionError(current.state, nextState);
        }
        if (
          ["queued", "running", "retrying", "recovering"].includes(nextState) &&
          current.owner_id &&
          database.prepare(`
            SELECT 1 FROM account_delete_intents
            WHERE owner_id = ?
            LIMIT 1
          `).get(current.owner_id)
        ) {
          throw new GenerationTaskOwnerDeletingError();
        }
        if (
          preserveProviderTaskId &&
          (
            nextState !== "retrying" ||
            (
              current.kind !== "video" &&
              current.kind !== "audio" &&
              !(
                current.kind === "image" &&
                (JSON.parse(current.model_configuration) as Record<string, unknown>)
                  .providerProtocol === "media-generate"
              )
            ) ||
            !current.provider_task_id
          )
        ) {
          throw new Error("Provider task ID can only be preserved for an asynchronous retry");
        }
        if (preserveProviderTaskId) {
          const paidAttempt = providerAttemptForTask(current);
          if (
            !paidAttempt ||
            !["accepted", "response-received"].includes(paidAttempt.outcome)
          ) {
            throw new Error(
              "Provider task retry requires exact accepted Provider evidence",
            );
          }
        }
        const result = database
          .prepare(`
            UPDATE generation_tasks
            SET
              state = ?,
              attempt = attempt + CASE WHEN ? = 'running' THEN 1 ELSE 0 END,
              provider_task_id = CASE
                WHEN ? = 'retrying' AND ? = 0 THEN NULL
                ELSE provider_task_id
              END,
              provider_usage_tokens = CASE WHEN ? = 'retrying' THEN NULL ELSE provider_usage_tokens END,
              actual_cost_microunits = CASE WHEN ? = 'retrying' THEN NULL ELSE actual_cost_microunits END,
              result_asset_id = CASE WHEN ? = 'retrying' THEN NULL ELSE result_asset_id END,
              result_text = CASE WHEN ? = 'retrying' THEN NULL ELSE result_text END,
              error_code = ?,
              error_message = ?,
              updated_at = ?
            WHERE id = ? AND state = ?
          `)
          .run(
            nextState,
            nextState,
            nextState,
            preserveProviderTaskId ? 1 : 0,
            nextState,
            nextState,
            nextState,
            nextState,
            error?.code ?? null,
            error?.message ?? null,
            timestamp,
            id,
            current.state,
          );
        if (result.changes !== 1) {
          throw new Error("Generation task changed concurrently");
        }
        if (nextState === "failed" && current.attempt >= 1) {
          const attempt = providerAttemptForTask(current);
          if (current.provider_task_id && !attempt) {
            throw new Error("Persisted Provider task evidence is missing");
          }
          if (
            attempt &&
            [
              "boundary-claimed",
              "accepted",
              "response-received",
            ].includes(attempt.outcome)
          ) {
            const providerRefunded = error?.code === "PROVIDER_REFUNDED";
            const nextOutcome: GenerationProviderAttemptOutcome =
              providerRefunded
                ? "provider-failed"
                : attempt.outcome === "boundary-claimed"
                  ? "outcome-unknown"
                  : attempt.outcome;
            const terminal = [
              "definitive-rejected",
              "outcome-unknown",
              "provider-failed",
            ].includes(nextOutcome);
            const recordsAuthIncident = ["AUTH", "PERMISSION"].includes(
              error?.code ?? "",
            );
            const attemptUpdate = database.prepare(`
              UPDATE generation_provider_attempts
              SET outcome = ?, failure_code = ?, finished_at = CASE
                WHEN ? = 1 THEN ? ELSE finished_at END
              WHERE
                task_id = ?
                AND execution_attempt = ?
                AND outcome = ?
            `).run(
              nextOutcome,
              error?.code ?? null,
              terminal || recordsAuthIncident ? 1 : 0,
              timestamp,
              current.id,
              attempt.execution_attempt,
              attempt.outcome,
            );
            if (attemptUpdate.changes !== 1) {
              throw new Error("Provider attempt changed concurrently");
            }
          }
        }
        recordEvent.run(
          id,
          nextState,
          error?.code ?? null,
          error?.message ?? null,
          timestamp,
        );
        database.exec("COMMIT");
      } catch (transitionError) {
        database.exec("ROLLBACK");
        throw transitionError;
      }
      return toTask(readById.get(id) as GenerationTaskRow);
    },

    /**
     * Cancels a local task only while no request for its current execution has
     * crossed the Provider boundary. This transaction races atomically with
     * recordProviderAttempt: whichever commits first determines whether the
     * local cancellation or the paid Provider request is allowed to proceed.
     */
    cancelBeforeProviderAttempt(
      id: string,
      error: { code: string; message: string },
    ) {
      assertTaskError(error);
      const timestamp = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = readById.get(id) as GenerationTaskRow | undefined;
        if (!current) {
          database.exec("COMMIT");
          return undefined;
        }
        if (!allowedTransitions[current.state].includes("cancelled")) {
          throw new GenerationTaskTransitionError(current.state, "cancelled");
        }
        if (current.provider_task_id) {
          throw new GenerationTaskProviderBoundaryError();
        }
        if (current.state === "running") {
          const providerBoundary = database.prepare(`
            SELECT 1
            FROM generation_provider_attempts
            WHERE task_id = ? AND execution_attempt = ?
            LIMIT 1
          `).get(current.id, current.attempt);
          if (providerBoundary) throw new GenerationTaskProviderBoundaryError();
        }
        const result = database.prepare(`
          UPDATE generation_tasks
          SET
            state = 'cancelled',
            error_code = ?,
            error_message = ?,
            updated_at = ?
          WHERE id = ? AND state = ?
        `).run(
          error.code,
          error.message,
          timestamp,
          current.id,
          current.state,
        );
        if (result.changes !== 1) {
          throw new Error("Generation task changed concurrently");
        }
        recordEvent.run(
          current.id,
          "cancelled",
          error.code,
          error.message,
          timestamp,
        );
        database.exec("COMMIT");
      } catch (cancelError) {
        database.exec("ROLLBACK");
        throw cancelError;
      }
      return toTask(readById.get(id) as GenerationTaskRow);
    },

    /**
     * Stops local continuation of a failed task with exact accepted/result
     * evidence. Asynchronous work is associated by its durable Provider task
     * ID; synchronous response evidence is associated by the current execution.
     * The paid ledger remains unchanged, but the cancelled task no longer pins
     * its credential/profile. This never calls a Provider and never turns the
     * attempt into retryable evidence.
     */
    abandonAcceptedProviderTask(input: GenerationTaskAbandonInput) {
      if (
        !identifierPattern.test(input.taskId) ||
        input.taskId.length > 120 ||
        !Number.isSafeInteger(input.expectedAttempt) ||
        input.expectedAttempt < 1 ||
        typeof input.expectedUpdatedAt !== "string" ||
        input.expectedUpdatedAt.length < 1 ||
        input.expectedUpdatedAt.length > 64 ||
        !Number.isFinite(Date.parse(input.expectedUpdatedAt))
      ) {
        throw new Error("Invalid generation task ID");
      }
      const timestamp = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = readById.get(input.taskId) as
          | GenerationTaskRow
          | undefined;
        if (!current) {
          database.exec("COMMIT");
          return undefined;
        }
        const attempt = providerAttemptForTask(current);
        const exactPaidEvidence = Boolean(
          attempt &&
          (
            current.provider_task_id
              ? attempt.provider_task_id === current.provider_task_id &&
                ["accepted", "response-received"].includes(attempt.outcome)
              : attempt.provider_task_id === null &&
                attempt.execution_attempt === current.attempt &&
                attempt.outcome === "response-received"
          )
        );
        if (
          current.state !== "failed" ||
          current.attempt !== input.expectedAttempt ||
          current.updated_at !== input.expectedUpdatedAt ||
          !exactPaidEvidence
        ) {
          throw new GenerationTaskAbandonError();
        }
        const result = database.prepare(`
          UPDATE generation_tasks
          SET
            state = 'cancelled',
            error_code = 'USER_ABANDONED',
            error_message = ?,
            updated_at = ?
          WHERE
            id = ?
            AND state = 'failed'
            AND attempt = ?
            AND updated_at = ?
            AND provider_task_id IS ?
        `).run(
          "已放弃本地继续恢复该平台结果；不会自动重试或再次付费提交",
          timestamp,
          current.id,
          input.expectedAttempt,
          input.expectedUpdatedAt,
          current.provider_task_id,
        );
        if (result.changes !== 1) {
          throw new Error("Generation task changed concurrently");
        }
        recordEvent.run(
          current.id,
          "cancelled",
          "USER_ABANDONED",
          "已放弃本地继续恢复该平台结果；不会自动重试或再次付费提交",
          timestamp,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return toTask(readById.get(input.taskId) as GenerationTaskRow);
    },

    resume(id: string) {
      const timestamp = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = readById.get(id) as GenerationTaskRow | undefined;
        if (!current) {
          database.exec("COMMIT");
          return undefined;
        }
        if (current.state !== "recovering") {
          throw new GenerationTaskTransitionError(current.state, "running");
        }
        if (current.provider_task_id) {
          const paidAttempt = providerAttemptForTask(current);
          if (
            !paidAttempt ||
            !["accepted", "response-received"].includes(paidAttempt.outcome)
          ) {
            throw new Error(
              "Provider task recovery requires exact accepted Provider evidence",
            );
          }
        }
        const result = database.prepare(`
          UPDATE generation_tasks
          SET state = 'running', updated_at = ?
          WHERE id = ? AND state = 'recovering'
        `).run(timestamp, id);
        if (result.changes !== 1) throw new Error("Generation task changed concurrently");
        recordEvent.run(id, "running", null, null, timestamp);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return toTask(readById.get(id) as GenerationTaskRow);
    },

    setProviderTaskId(id: string, providerTaskId: string) {
      const current = readById.get(id) as GenerationTaskRow | undefined;
      if (!current) throw new Error("Generation task changed concurrently");
      return attachProviderTaskId({
        credentialRevision: current.credential_revision,
        executionAttempt: current.attempt,
        providerTaskId,
        taskId: id,
      });
    },

    bindVerifiedProviderTaskIdOnFailedTask(input: {
      providerTaskId: string;
      taskId: string;
    }) {
      if (
        !providerTaskIdPattern.test(input.providerTaskId) ||
        input.providerTaskId.length > 160
      ) {
        throw new Error("Invalid Provider task ID");
      }
      const timestamp = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const task = readById.get(input.taskId) as GenerationTaskRow | undefined;
        if (!task || task.state !== "failed") {
          throw new Error("Only a failed generation task can bind a Provider task ID");
        }
        if (
          task.provider_task_id &&
          task.provider_task_id !== input.providerTaskId
        ) {
          throw new Error("Provider task ID does not match the current task");
        }
        const updatedTask = database.prepare(`
          UPDATE generation_tasks
          SET provider_task_id = ?, updated_at = ?
          WHERE
            id = ?
            AND state = 'failed'
            AND (provider_task_id IS NULL OR provider_task_id = ?)
        `).run(
          input.providerTaskId,
          timestamp,
          input.taskId,
          input.providerTaskId,
        );
        if (updatedTask.changes !== 1) {
          throw new Error("Generation task changed concurrently");
        }
        const attempt = providerAttemptForTask(task);
        if (attempt) {
          if (
            attempt.provider_task_id &&
            attempt.provider_task_id !== input.providerTaskId
          ) {
            throw new Error("Provider task ID does not match the current attempt");
          }
          const updatedAttempt = database.prepare(`
            UPDATE generation_provider_attempts
            SET
              provider_task_id = ?,
              outcome = CASE
                WHEN outcome IN ('boundary-claimed', 'outcome-unknown')
                  THEN 'accepted'
                ELSE outcome
              END
            WHERE
              task_id = ?
              AND execution_attempt = ?
              AND (provider_task_id IS NULL OR provider_task_id = ?)
          `).run(
            input.providerTaskId,
            input.taskId,
            attempt.execution_attempt,
            input.providerTaskId,
          );
          if (updatedAttempt.changes !== 1) {
            throw new Error("Provider attempt changed concurrently");
          }
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return toTask(readById.get(input.taskId) as GenerationTaskRow);
    },

    markOutcomeUnknownBillingRisk(input: {
      expectedUpdatedAt: string;
      taskId: string;
    }) {
      const timestamp = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const task = readById.get(input.taskId) as GenerationTaskRow | undefined;
        if (
          !task ||
          task.state !== "failed" ||
          task.updated_at !== input.expectedUpdatedAt
        ) {
          throw new Error("Generation task changed concurrently");
        }
        const updatedTask = database.prepare(`
          UPDATE generation_tasks
          SET
            error_code = 'OUTCOME_UNKNOWN_BILLING_RISK',
            error_message = '模型平台可能已经受理或扣费；系统会自动找回结果并禁止重复提交',
            updated_at = ?
          WHERE id = ? AND state = 'failed' AND updated_at = ?
        `).run(timestamp, input.taskId, input.expectedUpdatedAt);
        if (updatedTask.changes !== 1) {
          throw new Error("Generation task changed concurrently");
        }
        const attempt = providerAttemptForTask(task);
        if (
          attempt &&
          [
            "boundary-claimed",
            "accepted",
            "response-received",
            "outcome-unknown",
          ].includes(attempt.outcome)
        ) {
          const updatedAttempt = database.prepare(`
            UPDATE generation_provider_attempts
            SET
              outcome = 'outcome-unknown',
              failure_code = 'OUTCOME_UNKNOWN_BILLING_RISK',
              finished_at = ?
            WHERE
              task_id = ?
              AND execution_attempt = ?
              AND outcome = ?
          `).run(
            timestamp,
            input.taskId,
            attempt.execution_attempt,
            attempt.outcome,
          );
          if (updatedAttempt.changes !== 1) {
            throw new Error("Provider attempt changed concurrently");
          }
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return toTask(readById.get(input.taskId) as GenerationTaskRow);
    },

    complete(id: string, input: {
      actualCostMicrounits: number;
      providerUsageTokens?: number;
      resultAssetId?: string;
      resultText?: string;
    }) {
      const current = readById.get(id) as GenerationTaskRow | undefined;
      if (!current) return undefined;
      if (current.state !== "running") {
        throw new GenerationTaskTransitionError(current.state, "success");
      }
      if (
        !Number.isSafeInteger(input.actualCostMicrounits) ||
        input.actualCostMicrounits < 0 ||
        (input.providerUsageTokens !== undefined &&
          (!Number.isSafeInteger(input.providerUsageTokens) ||
            input.providerUsageTokens < 0)) ||
        (current.kind === "text"
          ? typeof input.resultText !== "string" ||
            input.resultText.trim().length < 1 ||
            input.resultText.length > 200_000 ||
            input.resultAssetId !== undefined
          : typeof input.resultAssetId !== "string" ||
            !identifierPattern.test(input.resultAssetId) ||
            input.resultAssetId.length > 120 ||
            input.resultText !== undefined)
      ) {
        throw new Error("Invalid generation result");
      }
      const timestamp = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = database.prepare(`
          UPDATE generation_tasks
          SET state = 'success', actual_cost_microunits = ?,
              provider_usage_tokens = ?, result_asset_id = ?, result_text = ?,
              error_code = NULL, error_message = NULL,
              updated_at = ?
          WHERE id = ? AND state = 'running'
        `).run(
          input.actualCostMicrounits,
          input.providerUsageTokens ?? null,
          input.resultAssetId ?? null,
          input.resultText?.trim() ?? null,
          timestamp,
          id,
        );
        if (result.changes !== 1) throw new Error("Generation task changed concurrently");
        const providerAttempt = providerAttemptForTask(current);
        if (
          !providerAttempt &&
          (current.owner_id !== "__test__" || current.provider_task_id)
        ) {
          throw new Error("Generation task has no Provider attempt");
        }
        if (providerAttempt) {
          const attemptCompletion = database.prepare(`
            UPDATE generation_provider_attempts
            SET
              outcome = 'completed',
              failure_code = NULL,
              finished_at = ?
            WHERE
              task_id = ?
              AND execution_attempt = ?
              AND outcome IN (
                'boundary-claimed', 'accepted', 'response-received', 'completed'
              )
          `).run(timestamp, current.id, providerAttempt.execution_attempt);
          if (attemptCompletion.changes !== 1) {
            throw new Error("Provider attempt cannot be completed");
          }
        }
        recordEvent.run(id, "success", null, null, timestamp);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return toTask(readById.get(id) as GenerationTaskRow);
    },
  };
}

export function failRecoveredGenerationTasks(
  store: ReturnType<typeof createGenerationTaskStore>,
  preservedTaskIds: ReadonlySet<string> = new Set(),
) {
  return store.listRecovering().filter((task) => {
    if (task.providerTaskId || preservedTaskIds.has(task.id)) return false;
    const attempt = store.getProviderAttemptForTask(task.id);
    const providerProtocol = task.modelConfiguration.providerProtocol;
    // A lost response after the paid boundary is durable recovery work, not a
    // restart failure. Keeping it in recovering is what preserves the strict
    // zero-new-POST contract across process restarts.
    if (
      providerProtocol === "media-generate" &&
      attempt &&
      attempt.executionAttempt === task.attempt &&
      ["boundary-claimed", "outcome-unknown", "response-received"].includes(
        attempt.outcome,
      )
    ) return false;
    return true;
  }).map((task) =>
    store.transition(task.id, "failed", {
      code: "SERVICE_RESTARTED",
      message: "服务重启中断了本次生成，结果无法确认，为避免重复扣费不能直接重试",
    }),
  );
}
