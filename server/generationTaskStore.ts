import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openAppDatabase } from "./database";

export const generationTaskKinds = ["text", "image", "video", "audio"] as const;
export const generationTaskStates = [
  "queued",
  "running",
  "success",
  "failed",
  "cancelled",
  "retrying",
  "recovering",
] as const;

export type GenerationTaskKind = (typeof generationTaskKinds)[number];
export type GenerationTaskState = (typeof generationTaskStates)[number];

export type GenerationTaskInput = {
  canvasId: string;
  /**
   * Freshness proof for graph-backed submissions. When present, it is checked
   * in the same write transaction that inserts the task.
   */
  expectedCanvasRevision?: number;
  costCurrency?: "CNY" | "USD";
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
};

export type GenerationTask = {
  attempt: number;
  canvasId: string;
  costCurrency: "CNY" | "USD";
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

const allowedTransitions: Record<
  GenerationTaskState,
  readonly GenerationTaskState[]
> = {
  cancelled: [],
  failed: ["retrying"],
  queued: ["running", "cancelled"],
  recovering: ["queued", "failed", "cancelled"],
  retrying: ["queued", "cancelled"],
  running: ["success", "failed", "cancelled"],
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

export class GenerationTaskTransitionError extends Error {
  constructor(from: GenerationTaskState, to: GenerationTaskState) {
    super(`Generation task cannot move from ${from} to ${to}`);
    this.name = "GenerationTaskTransitionError";
  }
}

export class GenerationProviderAttemptBlockedError extends Error {
  constructor(
    readonly code:
      | "PROVIDER_ATTEMPT_ALREADY_RECORDED"
      | "PROVIDER_AUTH_FAILED"
      | "PROVIDER_RECOVERY_ATTEMPT_USED",
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

export function generationProviderAttemptCounts(database: DatabaseSync) {
  const row = database.prepare(`
    SELECT
      COALESCE(SUM(
        CASE WHEN evidence = 'provider-boundary' THEN 1 ELSE 0 END
      ), 0) AS paid_provider_requests,
      COALESCE(SUM(
        CASE WHEN evidence = 'historical-execution-attempt' THEN 1 ELSE 0 END
      ), 0) AS historical_estimated_provider_attempts
    FROM generation_provider_attempts
  `).get() as {
    historical_estimated_provider_attempts: number;
    paid_provider_requests: number;
  };
  return {
    historicalEstimatedProviderAttempts: Number(
      row.historical_estimated_provider_attempts,
    ),
    paidProviderRequests: Number(row.paid_provider_requests),
  };
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

function normalizeInput(input: GenerationTaskInput): GenerationTaskInput {
  const prompt = input.prompt.trim();
  const model = input.model?.trim();
  const parameters = input.parameters ?? {};
  const parameterJson = JSON.stringify(stableValue(parameters));
  const modelConfiguration = input.modelConfiguration ?? {};
  const modelConfigurationJson = JSON.stringify(stableValue(modelConfiguration));
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
    modelConfigurationJson.length > 20_000
    || (ownerId !== undefined && (!identifierPattern.test(ownerId) || ownerId.length > 120))
    || (providerProfileId !== undefined && (!identifierPattern.test(providerProfileId) || providerProfileId.length > 120))
    || (providerModelId !== undefined && (providerModelId.length < 1 || providerModelId.length > 160))
    || (input.estimatedCostMicrounits !== undefined &&
      (!Number.isSafeInteger(input.estimatedCostMicrounits) || input.estimatedCostMicrounits < 0))
    || (input.expectedCanvasRevision !== undefined &&
      (!Number.isSafeInteger(input.expectedCanvasRevision) || input.expectedCanvasRevision < 0))
    || !["CNY", "USD"].includes(costCurrency)
  ) {
    throw new Error("Invalid generation task");
  }

  return {
    canvasId: input.canvasId,
    costCurrency,
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
  };
}

function requestFingerprint(input: GenerationTaskInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        canvasId: input.canvasId,
        kind: input.kind,
        model: input.model ?? null,
        modelConfiguration: input.modelConfiguration,
        nodeId: input.nodeId,
        parameters: input.parameters,
        prompt: input.prompt,
      }),
    )
    .digest("hex");
}

function toTask(row: GenerationTaskRow): GenerationTask {
  return {
    attempt: row.attempt,
    canvasId: row.canvas_id,
    costCurrency: row.cost_currency,
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
  const recoveringTaskIds = (
    database
      .prepare("SELECT id FROM generation_tasks WHERE state = 'running'")
      .all() as Array<{ id: string }>
  ).map(({ id }) => id);
  if (recoveringTaskIds.length) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(`
          UPDATE generation_tasks
          SET state = 'recovering', updated_at = ?
          WHERE state = 'running'
        `)
        .run(recoveredAt);
      const recordRecovery = database.prepare(`
        INSERT INTO generation_task_events (
          task_id,
          state,
          created_at
        )
        VALUES (?, 'recovering', ?)
      `);
      for (const id of recoveringTaskIds) {
        recordRecovery.run(id, recoveredAt);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
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
    WHERE canvas_id = ? AND idempotency_key = ?
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

  return {
    close() {
      database.close();
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
        if (normalized.expectedCanvasRevision !== undefined) {
          const canvas = database.prepare(`
            SELECT revision
            FROM canvas_documents
            WHERE owner_id = ? AND id = ?
          `).get(
            normalized.ownerId ?? "__test__",
            normalized.canvasId,
          ) as { revision: number } | undefined;
          if (!canvas || canvas.revision !== normalized.expectedCanvasRevision) {
            throw new GenerationTaskCanvasRevisionConflictError(
              canvas?.revision ?? -1,
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
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?, ?, ?)
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
        if (row.request_fingerprint !== fingerprint) {
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
      return (
        database
          .prepare(`
            SELECT *
            FROM generation_tasks
            WHERE canvas_id = ?
            ORDER BY created_at ASC, rowid ASC
            LIMIT 500
          `)
          .all(canvasId) as GenerationTaskRow[]
      ).map(toTask);
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
      return (
        database
          .prepare(`
            SELECT *
            FROM generation_tasks
            WHERE canvas_id = ? AND owner_id = ?
            ORDER BY created_at ASC, rowid ASC
            LIMIT 500
          `)
          .all(canvasId, ownerId) as GenerationTaskRow[]
      ).map(toTask);
    },

    listRecovering() {
      return (
        database
          .prepare(`
            SELECT *
            FROM generation_tasks
            WHERE state = 'recovering'
            ORDER BY created_at ASC, rowid ASC
            LIMIT 500
          `)
          .all() as GenerationTaskRow[]
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

    /**
     * Records the exact boundary at which a generation request is about to be
     * sent to a Provider. Local validation, media preparation, polling, and
     * result downloads must never call this method.
     *
     * BEGIN IMMEDIATE makes the capability recovery slot atomic across server
     * workers: after an AUTH/PERMISSION incident, one explicit Provider/model
     * configuration update permits only one provider+kind probe attempt.
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
          !current.provider_model_id
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

        const latestAuthFailure = database.prepare(`
          SELECT id, updated_at
          FROM generation_tasks
          WHERE
            provider_profile_id = ?
            AND kind = ?
            AND state = 'failed'
            AND error_code IN ('AUTH', 'PERMISSION')
          ORDER BY updated_at DESC, rowid DESC
          LIMIT 1
        `).get(current.provider_profile_id, current.kind) as
          | { id: string; updated_at: string }
          | undefined;
        const latestSuccess = database.prepare(`
          SELECT updated_at
          FROM generation_tasks
          WHERE
            provider_profile_id = ?
            AND kind = ?
            AND state = 'success'
          ORDER BY updated_at DESC, rowid DESC
          LIMIT 1
        `).get(current.provider_profile_id, current.kind) as
          | { updated_at: string }
          | undefined;
        const authFailureAt = latestAuthFailure
          ? Date.parse(latestAuthFailure.updated_at)
          : Number.NEGATIVE_INFINITY;
        const successAt = latestSuccess
          ? Date.parse(latestSuccess.updated_at)
          : Number.NEGATIVE_INFINITY;

        let recoveryAt = Number.NEGATIVE_INFINITY;
        if (Number.isFinite(authFailureAt) && authFailureAt > successAt) {
          const providerUpdate = database.prepare(`
            SELECT created_at
            FROM admin_audit_events
            WHERE
              action IN ('provider_profile.create', 'provider_profile.update')
              AND json_extract(details, '$.profileId') = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          `).get(current.provider_profile_id) as
            | { created_at: string }
            | undefined;
          const modelUpdate = current.model
            ? database.prepare(`
                SELECT updated_at
                FROM model_profiles
                WHERE
                  id = ?
                  AND provider_profile_id = ?
                  AND capability = ?
                LIMIT 1
              `).get(
                current.model,
                current.provider_profile_id,
                current.kind,
              ) as { updated_at: string } | undefined
            : undefined;
          recoveryAt = Math.max(
            providerUpdate ? Date.parse(providerUpdate.created_at) : Number.NEGATIVE_INFINITY,
            modelUpdate ? Date.parse(modelUpdate.updated_at) : Number.NEGATIVE_INFINITY,
          );
          if (!Number.isFinite(recoveryAt) || recoveryAt <= authFailureAt) {
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
              AND created_at >= ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          `).get(
            current.provider_profile_id,
            current.kind,
            new Date(recoveryAt).toISOString(),
          );
          if (recoveryAttempt) {
            throw new GenerationProviderAttemptBlockedError(
              "PROVIDER_RECOVERY_ATTEMPT_USED",
              "配置更新后的恢复尝试已经使用，请等待结果或由管理员再次更新配置",
            );
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
            provider_profile_id,
            provider_model_id,
            kind,
            evidence,
            created_at
          ) VALUES (?, ?, ?, ?, ?, 'provider-boundary', ?)
        `).run(
          current.id,
          current.attempt,
          current.provider_profile_id,
          current.provider_model_id,
          current.kind,
          createdAt,
        );
        database.exec("COMMIT");
        return { createdAt, executionAttempt: current.attempt };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

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

    resume(id: string) {
      const current = readById.get(id) as GenerationTaskRow | undefined;
      if (!current) return undefined;
      if (current.state !== "recovering") {
        throw new GenerationTaskTransitionError(current.state, "running");
      }
      const timestamp = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
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
      if (!providerTaskIdPattern.test(providerTaskId) || providerTaskId.length > 160) {
        throw new Error("Invalid Provider task ID");
      }
      const result = database.prepare(`
        UPDATE generation_tasks
        SET provider_task_id = ?, updated_at = ?
        WHERE id = ? AND state = 'running' AND provider_task_id IS NULL
      `).run(providerTaskId, new Date().toISOString(), id);
      if (result.changes !== 1) throw new Error("Generation task changed concurrently");
      return toTask(readById.get(id) as GenerationTaskRow);
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
) {
  return store.listRecovering().filter((task) => !task.providerTaskId).map((task) =>
    store.transition(task.id, "failed", {
      code: "SERVICE_RESTARTED",
      message: "服务重启中断了本次生成，结果无法确认，为避免重复扣费不能直接重试",
    }),
  );
}
