import type { DatabaseSync } from "node:sqlite";
import {
  generationInputKey,
  generationOwnershipEvidence,
  generationOwnershipKey,
  imageGenerationToolOwnershipEvidence,
} from "../types/generationIdentity";
import {
  storedImageGenerationTool,
  type ImageMultiAngleParameters,
} from "../types/imageTools";
import type {
  ModelParameterSchema,
  ModelParameterValue,
} from "../types/modelParameters";
import { submissionParameterValues } from "../types/modelParameters";
import type { NodeInputKind } from "../types/nodeInputs";
import { sha256Hex, stableSha256 } from "../types/canvasFingerprint";
import {
  readCanvasDocumentRevisionCommand,
  readCanvasOperationReceiptProjectionStateCommand,
} from "./canvasTransactionCommands";
import { resolvePersistedNodeInputs } from "./inputPreflight";
import { readPublishedGenerationMediaProjectionCommand } from
  "./mediaTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";

const authoritativeCanvasGenerationProjectionBrand = Symbol(
  "AuthoritativeCanvasGenerationProjection",
);

type GenerationTaskProjectionRow = Readonly<{
  attempt: number;
  canvas_id: string;
  id: string;
  kind: NodeInputKind;
  model: string | null;
  model_configuration: string;
  node_id: string;
  owner_id: string | null;
  parameters: string;
  prompt: string;
  result_asset_id: string | null;
  result_text: string | null;
  state: string;
  updated_at: string;
}>;

type ReadyMediaProjectionRow = Readonly<{
  asset_id: string;
  attempt_id: string;
  byte_size: number;
  checksum_sha256: string | null;
  content_type: string;
  created_at: string;
  duration_seconds: number | null;
  duration_status: "failed" | "not-applicable" | "pending" | "ready";
  has_transparency: boolean | null;
  media_height: number | null;
  media_width: number | null;
  storage_backend: "local" | "oss";
}>;

export type AuthoritativeCanvasGenerationProjection = Readonly<{
  readonly [authoritativeCanvasGenerationProjectionBrand]: true;
  bindingMatches: boolean;
  canvasId: string;
  inputFingerprint: string;
  kind: NodeInputKind;
  modelConfigurationRevision: string;
  modelContractRevision: string;
  modelId: string;
  nodeId: string;
  operationId: string;
  ownerId: string;
  ownershipKey: string;
  patch: Readonly<Record<string, unknown>>;
  payloadSha256: string;
  projectionIdentity: string;
  resultKey: string;
  runId: string;
  scope: "single-node" | "workflow";
  taskId: string;
}>;

export type CanvasGenerationProjectionBuildResult =
  | Readonly<{
      projection: AuthoritativeCanvasGenerationProjection;
      status: "ready";
    }>
  | Readonly<{
      reason: string;
      status: "failed";
    }>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseRecord(value: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maximum;
}

function htmlForPlainText(value: string) {
  const escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br>");
  return `<p>${escaped}</p>`;
}

function targetModelId(kind: NodeInputKind, data: Record<string, unknown>) {
  if (kind === "video") {
    return String(data.videoModelId ?? data.videoModel ?? "").trim();
  }
  return String(data[`${kind}ModelId`] ?? "").trim();
}

function targetModelConfigurationRevision(
  kind: NodeInputKind,
  data: Record<string, unknown>,
) {
  const value = data[`${kind}ModelConfigurationRevision`];
  return typeof value === "string" && value ? value : undefined;
}

function targetParameterValues(
  kind: NodeInputKind,
  data: Record<string, unknown>,
  schema: ModelParameterSchema,
) {
  const raw = record(data[`${kind}Parameters`]) ?? {};
  const candidate = kind === "image"
    ? {
        ...raw,
        ...(data.imageAspectRatio !== undefined
          ? { aspectRatio: data.imageAspectRatio }
          : {}),
        ...(data.imageQuality !== undefined ? { quality: data.imageQuality } : {}),
      }
    : raw;
  return submissionParameterValues(schema, candidate);
}

function persistedMultiAngleParameters(
  value: unknown,
): ImageMultiAngleParameters | undefined {
  const item = record(value);
  if (!item || Object.keys(item).sort().join("\0") !== [
    "distance",
    "horizontalDegrees",
    "verticalDegrees",
    "wideAngle",
  ].join("\0") || !Number.isFinite(item.distance) ||
      Number(item.distance) < -100 || Number(item.distance) > 100 ||
      !Number.isFinite(item.horizontalDegrees) ||
      Number(item.horizontalDegrees) < -180 ||
      Number(item.horizontalDegrees) > 180 ||
      !Number.isFinite(item.verticalDegrees) ||
      Number(item.verticalDegrees) < -90 ||
      Number(item.verticalDegrees) > 90 || typeof item.wideAngle !== "boolean") {
    return undefined;
  }
  return {
    distance: Number(item.distance),
    horizontalDegrees: Number(item.horizontalDegrees),
    verticalDegrees: Number(item.verticalDegrees),
    wideAngle: item.wideAngle,
  };
}

function modelReleaseRevision(configuration: Record<string, unknown>) {
  const value = record(configuration.modelReleaseRevision);
  return boundedString(value?.revisionId, 500)
    ? String(value!.revisionId)
    : undefined;
}

function workflowBinding(configuration: Record<string, unknown>) {
  const value = record(configuration.workflowBinding);
  if (!value) return undefined;
  return boundedString(value.runId, 200) &&
      boundedString(value.groupId, 200) &&
      boundedString(value.generationInputKey, 32_000) &&
      boundedString(value.generationOwnershipKey, 2_000) &&
      boundedString(value.modelConfigurationRevision, 500) &&
      boundedString(value.modelReleaseRevision, 500)
    ? {
        generationInputKey: String(value.generationInputKey),
        generationOwnershipKey: String(value.generationOwnershipKey),
        groupId: String(value.groupId),
        modelConfigurationRevision: String(value.modelConfigurationRevision),
        modelReleaseRevision: String(value.modelReleaseRevision),
        runId: String(value.runId),
      }
    : undefined;
}

function readyGenerationMedia(
  database: DatabaseSync,
  task: GenerationTaskProjectionRow,
) {
  if (task.kind === "text" || !task.owner_id || !task.result_asset_id) return [];
  return executeTransactionScopedCommand(
    database,
    readPublishedGenerationMediaProjectionCommand,
    {
      executionAttempt: task.attempt,
      kind: task.kind,
      ownerId: task.owner_id,
      primaryAssetId: task.result_asset_id,
      taskId: task.id,
    },
  ).map((row) => ({
    asset_id: row.assetId,
    attempt_id: row.attemptId,
    byte_size: row.byteSize,
    checksum_sha256: row.checksumSha256,
    content_type: row.contentType,
    created_at: row.createdAt,
    duration_seconds: row.durationSeconds,
    duration_status: row.durationStatus,
    has_transparency: row.hasTransparency,
    media_height: row.height,
    media_width: row.width,
    storage_backend: row.storageBackend,
  }));
}

function mediaUrl(kind: Exclude<NodeInputKind, "text">, assetId: string) {
  return kind === "image"
    ? `/api/assets/${assetId}`
    : `/api/${kind}-assets/${assetId}`;
}

function mediaPatch(
  kind: Exclude<NodeInputKind, "text">,
  primary: ReadyMediaProjectionRow,
) {
  return {
    assetId: primary.asset_id,
    [`${kind}Src`]: mediaUrl(kind, primary.asset_id),
    inputState: "ready",
    inputStateReason: undefined,
    mediaByteSize: Number(primary.byte_size),
    mediaContentType: primary.content_type,
    mediaDurationSeconds: primary.duration_seconds ?? undefined,
    mediaHeight: primary.media_height ?? undefined,
    mediaMetadataSource: "server",
    mediaMetadataStatus: kind === "image"
      ? "ready"
      : primary.duration_status === "not-applicable"
        ? "failed"
        : primary.duration_status,
    mediaStorageBackend: primary.storage_backend,
    mediaWidth: primary.media_width ?? undefined,
    ...(kind === "image" && primary.has_transparency !== null
      ? { imageHasTransparency: primary.has_transparency }
      : {}),
  };
}

function resultProjection(input: {
  configuration: Record<string, unknown>;
  media: ReadyMediaProjectionRow[];
  resultKey: string;
  task: GenerationTaskProjectionRow;
}) {
  const task = input.task;
  const kind = task.kind;
  const common = {
    [`${kind}Generating`]: false,
    [`${kind}GenerationError`]: undefined,
    [`${kind}GenerationErrorCode`]: undefined,
    [`${kind}GenerationInputKey`]: undefined,
    [`${kind}GenerationModelConfigurationRevision`]:
      input.configuration.modelConfigurationRevision,
    [`${kind}GenerationModelReleaseRevision`]:
      modelReleaseRevision(input.configuration),
    [`${kind}GenerationOwnershipKey`]: undefined,
    [`${kind}GenerationRetryAllowed`]: undefined,
    [`${kind}GenerationRetryBlockCode`]: undefined,
    [`${kind}GenerationRetryBlockReason`]: undefined,
    [`${kind}GenerationTaskId`]: kind === "text" ? task.id : undefined,
    groupRunSuccessInputFingerprint:
      input.configuration.generationInputKey,
    groupRunSuccessModelConfigurationRevision:
      input.configuration.modelConfigurationRevision,
    groupRunSuccessModelReleaseRevision:
      modelReleaseRevision(input.configuration),
    groupRunSuccessOwnershipKey:
      input.configuration.generationOwnershipKey,
    groupRunSuccessResultKey: input.resultKey,
    groupRunSuccessTaskId: task.id,
    workflowExecutionRunId: undefined,
  } as Record<string, unknown>;
  if (kind === "text") {
    const content = task.result_text?.trim() ?? "";
    return {
      ...common,
      content,
      contentHtml: htmlForPlainText(content),
      textGenerationContractFingerprint:
        input.configuration.modelInputContractFingerprint,
    };
  }
  const primary = input.media[0]!;
  const patch = {
    ...common,
    ...mediaPatch(kind, primary),
    ...(kind === "video"
      ? {
          videoCreatedAt: new Date(task.updated_at).toISOString().slice(0, 10),
          videoGenerationModelInputContractFingerprint:
            input.configuration.modelInputContractFingerprint,
        }
      : {
          [`${kind}GenerationContractFingerprint`]:
            input.configuration.modelInputContractFingerprint,
        }),
  } as Record<string, unknown>;
  if (kind === "image") patch.imageGeneratedSuccess = true;
  if (kind === "audio") {
    patch.audioGeneratedResult = true;
    patch.audioResultChoices = input.media.map((item, index) => ({
      assetId: item.asset_id,
      byteSize: Number(item.byte_size),
      checksumSha256: item.checksum_sha256,
      contentType: item.content_type,
      durationSeconds: item.duration_seconds,
      durationStatus: item.duration_status,
      mediaHeight: item.media_height,
      mediaWidth: item.media_width,
      role: index === 0 ? "primary" : "alternate",
      storageBackend: item.storage_backend,
      url: mediaUrl("audio", item.asset_id),
    }));
  }
  return patch;
}

function currentBindingMatches(input: {
  configuration: Record<string, unknown>;
  database: DatabaseSync;
  runId?: string;
  scope: "single-node" | "workflow";
  task: GenerationTaskProjectionRow;
}) {
  const { configuration, database, task } = input;
  const schema = record(configuration.parameterSchema) as
    | ModelParameterSchema
    | undefined;
  const releaseRevision = modelReleaseRevision(configuration);
  const modelId = boundedString(configuration.modelId, 120)
    ? String(configuration.modelId)
    : undefined;
  const modelConfigurationRevision =
    boundedString(configuration.modelConfigurationRevision, 500)
      ? String(configuration.modelConfigurationRevision)
      : undefined;
  const contractFingerprint =
    boundedString(configuration.modelInputContractFingerprint, 500)
      ? String(configuration.modelInputContractFingerprint)
      : undefined;
  const expectedInputKey = boundedString(configuration.generationInputKey, 32_000)
    ? String(configuration.generationInputKey)
    : undefined;
  const expectedOwnershipKey =
    boundedString(configuration.generationOwnershipKey, 2_000)
      ? String(configuration.generationOwnershipKey)
      : undefined;
  if (
    configuration.generationIdentityVersion !== 2 || !schema ||
    !releaseRevision || !modelId || !modelConfigurationRevision ||
    !contractFingerprint || !expectedInputKey || !expectedOwnershipKey ||
    task.model !== modelId
  ) return false;
  try {
    const preliminary = resolvePersistedNodeInputs({
      bypass: false,
      canvasId: task.canvas_id,
      database,
      modelSchema: schema,
      modelReleaseRevision: releaseRevision,
      ownerId: task.owner_id!,
      parameters: {},
      targetId: task.node_id,
      targetKind: task.kind,
    });
    const data = preliminary.persistedTargetData;
    const currentTaskId = data[`${task.kind}GenerationTaskId`];
    const currentGenerating = data[`${task.kind}Generating`] === true;
    const currentWorkflowRunId = data.workflowExecutionRunId;
    if (
      input.scope === "single-node" &&
      typeof currentWorkflowRunId === "string" && currentWorkflowRunId
    ) return false;
    if (
      input.scope === "workflow" &&
      typeof currentWorkflowRunId === "string" && currentWorkflowRunId &&
      currentWorkflowRunId !== input.runId
    ) return false;
    if (
      currentGenerating &&
      (typeof currentTaskId !== "string" || currentTaskId !== task.id)
    ) return false;
    if (
      typeof currentTaskId === "string" && currentTaskId &&
      currentTaskId !== task.id
    ) {
      const previous = database.prepare(`
        SELECT state FROM generation_tasks
        WHERE id = ? AND owner_id = ? AND canvas_id = ? AND node_id = ? AND kind = ?
      `).get(
        currentTaskId,
        task.owner_id,
        task.canvas_id,
        task.node_id,
        task.kind,
      ) as { state?: unknown } | undefined;
      if (
        data.groupRunSuccessTaskId !== currentTaskId ||
        !previous || !["success", "failed", "cancelled"].includes(
          String(previous.state ?? ""),
        )
      ) return false;
    }
    const currentModel = targetModelId(task.kind, data);
    const currentConfigurationRevision =
      targetModelConfigurationRevision(task.kind, data);
    const parameters = targetParameterValues(task.kind, data, schema);
    const resolved = resolvePersistedNodeInputs({
      bypass: false,
      canvasId: task.canvas_id,
      database,
      modelSchema: schema,
      modelReleaseRevision: releaseRevision,
      ownerId: task.owner_id!,
      parameters,
      targetId: task.node_id,
      targetKind: task.kind,
    });
    const semanticParameters = submissionParameterValues(
      schema,
      resolved.normalizedParameters ?? parameters,
    ) as Record<string, ModelParameterValue>;
    const currentInputKey = generationInputKey({
      inputs: resolved.inputs,
      modelConfigurationRevision,
      modelId,
      modelReleaseRevision: releaseRevision,
      ownPrompt: resolved.persistedOwnPrompt,
      parameters: semanticParameters,
      prompt: resolved.finalPrompt,
    });
    const taskParameters = parseRecord(task.parameters);
    if (!taskParameters) return false;
    const imageTool = storedImageGenerationTool(taskParameters.imageTool);
    if (task.kind !== "image" && imageTool) return false;
    const multiAngleParameters = imageTool?.operation === "multi-angle"
      ? persistedMultiAngleParameters(data.imageMultiAngleParameters)
      : undefined;
    if (imageTool?.operation === "multi-angle" && !multiAngleParameters) return false;
    const currentOwnershipKey = generationOwnershipKey(imageTool
      ? imageGenerationToolOwnershipEvidence({
          accountId: task.owner_id!,
          aspectRatio: typeof semanticParameters.aspectRatio === "string"
            ? semanticParameters.aspectRatio
            : undefined,
          canvasId: task.canvas_id,
          imageTool,
          modelId,
          modelParameters: semanticParameters,
          ...(multiAngleParameters ? { multiAngleParameters } : {}),
          prompt: resolved.persistedOwnPrompt,
          quality: typeof semanticParameters.quality === "string"
            ? semanticParameters.quality
            : undefined,
        })
      : generationOwnershipEvidence({
          contractFingerprint: resolved.contractFingerprint ?? "",
          inputs: resolved.inputs,
          kind: task.kind,
          modelConfigurationRevision,
          modelId,
          modelReleaseRevision: releaseRevision,
          parameters: semanticParameters,
          prompt: resolved.persistedOwnPrompt,
        }));
    return currentModel === modelId &&
      (currentConfigurationRevision === undefined ||
        currentConfigurationRevision === modelConfigurationRevision) &&
      resolved.contractFingerprint === contractFingerprint &&
      resolved.finalPrompt === task.prompt &&
      currentInputKey === expectedInputKey &&
      currentOwnershipKey === expectedOwnershipKey;
  } catch {
    return false;
  }
}

/**
 * Build the only modern Canvas result identity from committed server ledgers.
 * The branded result cannot be manufactured by a public request parser.
 */
export function buildCanvasProjectionIdentity(input: Readonly<{
  canvasId: string;
  database: DatabaseSync;
  kind: NodeInputKind;
  nodeId: string;
  ownerId: string;
  runId?: string;
  taskId: string;
}>): CanvasGenerationProjectionBuildResult {
  if (!input.database.isTransaction) {
    return { reason: "projection requires an active transaction", status: "failed" };
  }
  const task = input.database.prepare(`
    SELECT id, attempt, canvas_id, node_id, kind, prompt, model, parameters,
           model_configuration, state, result_asset_id, result_text,
           owner_id, updated_at
    FROM generation_tasks
    WHERE id = ? AND owner_id = ? AND canvas_id = ? AND node_id = ? AND kind = ?
  `).get(
    input.taskId,
    input.ownerId,
    input.canvasId,
    input.nodeId,
    input.kind,
  ) as GenerationTaskProjectionRow | undefined;
  if (!task || task.state !== "success" || !task.owner_id) {
    return { reason: "committed terminal task is unavailable", status: "failed" };
  }
  const configuration = parseRecord(task.model_configuration);
  if (!configuration || configuration.generationIdentityVersion !== 2) {
    return { reason: "task has no authoritative generation identity", status: "failed" };
  }
  const binding = workflowBinding(configuration);
  const scope = input.runId ? "workflow" as const : "single-node" as const;
  if (
    (scope === "workflow" && (!binding || binding.runId !== input.runId)) ||
    (scope === "single-node" && binding)
  ) {
    return { reason: "task projection scope does not match", status: "failed" };
  }
  const inputFingerprint = boundedString(configuration.generationInputKey, 32_000)
    ? String(configuration.generationInputKey)
    : "";
  const ownershipKey = boundedString(configuration.generationOwnershipKey, 2_000)
    ? String(configuration.generationOwnershipKey)
    : "";
  const modelId = boundedString(configuration.modelId, 120)
    ? String(configuration.modelId)
    : "";
  const modelConfigurationRevision =
    boundedString(configuration.modelConfigurationRevision, 500)
      ? String(configuration.modelConfigurationRevision)
      : "";
  const modelContractRevision = modelReleaseRevision(configuration) ?? "";
  if (
    !inputFingerprint || !ownershipKey || !modelId ||
    !modelConfigurationRevision || !modelContractRevision ||
    (binding && (
      binding.generationInputKey !== inputFingerprint ||
      binding.generationOwnershipKey !== ownershipKey ||
      binding.modelConfigurationRevision !== modelConfigurationRevision ||
      binding.modelReleaseRevision !== modelContractRevision
    ))
  ) {
    return { reason: "task projection identity is incomplete", status: "failed" };
  }
  let media: ReadyMediaProjectionRow[] = [];
  let resultEvidence: Record<string, unknown>;
  if (task.kind === "text") {
    const text = task.result_text?.trim() ?? "";
    if (!text) return { reason: "committed text result is unavailable", status: "failed" };
    resultEvidence = { textSha256: sha256Hex(text) };
  } else {
    media = readyGenerationMedia(input.database, task);
    if (
      !task.result_asset_id || media.length < 1 ||
      media[0]?.asset_id !== task.result_asset_id ||
      media.some((item) => !item.checksum_sha256 ||
        !/^[0-9a-f]{64}$/.test(item.checksum_sha256))
    ) {
      return { reason: "published media result is unavailable", status: "failed" };
    }
    resultEvidence = {
      outputs: media.map((item) => ({
        assetId: item.asset_id,
        byteSize: Number(item.byte_size),
        checksumSha256: item.checksum_sha256,
        contentType: item.content_type,
        durationSeconds: item.duration_seconds,
        height: item.media_height,
        storageBackend: item.storage_backend,
        width: item.media_width,
      })),
    };
  }
  const runId = input.runId ?? `single-node:${task.id}`;
  const resultKey = stableSha256(resultEvidence);
  const projectionIdentity = stableSha256({
    canvasId: task.canvas_id,
    inputFingerprint,
    kind: task.kind,
    modelConfigurationRevision,
    modelContractRevision,
    nodeId: task.node_id,
    ownerId: task.owner_id,
    ownershipKey,
    result: resultEvidence,
    runId,
    taskId: task.id,
    workflowNodeId: task.node_id,
  });
  const patch = resultProjection({
    configuration,
    media,
    resultKey,
    task,
  });
  const payloadSha256 = stableSha256({
    patch,
    projectionIdentity,
  });
  const brand: true = true;
  return {
    projection: Object.freeze({
      [authoritativeCanvasGenerationProjectionBrand]: brand,
      bindingMatches: currentBindingMatches({
        configuration,
        database: input.database,
        runId: input.runId,
        scope,
        task,
      }),
      canvasId: task.canvas_id,
      inputFingerprint,
      kind: task.kind,
      modelConfigurationRevision,
      modelContractRevision,
      modelId,
      nodeId: task.node_id,
      operationId: `server-projection:${projectionIdentity}`,
      ownerId: task.owner_id,
      ownershipKey,
      patch: Object.freeze({ ...patch }),
      payloadSha256,
      projectionIdentity,
      resultKey,
      runId,
      scope,
      taskId: task.id,
    }),
    status: "ready",
  };
}

export type SingleNodeGenerationCanvasState = Readonly<{
  bindingMatches: boolean;
  canvasRevision?: number;
  operationId?: string;
  originalRequestId?: string;
  projectionDocumentRevision?: number;
  projectionState: "applied" | "conflict" | "failed" | "not-applicable" |
    "pending";
}>;

/**
 * Read-only projection/binding evidence for task polling and retry gates. The
 * caller owns the transaction so task, Canvas and receipt are one snapshot.
 */
export function inspectSingleNodeGenerationCanvasState(input: Readonly<{
  database: DatabaseSync;
  ownerId: string;
  taskId: string;
}>): SingleNodeGenerationCanvasState {
  if (!input.database.isTransaction) {
    throw new Error("Generation Canvas state inspection requires a transaction");
  }
  const task = input.database.prepare(`
    SELECT id, attempt, canvas_id, node_id, kind, prompt, model, parameters,
           model_configuration, state, result_asset_id, result_text,
           owner_id, updated_at
    FROM generation_tasks
    WHERE id = ? AND owner_id = ?
  `).get(input.taskId, input.ownerId) as GenerationTaskProjectionRow | undefined;
  if (!task || !task.owner_id) {
    return { bindingMatches: false, projectionState: "not-applicable" };
  }
  const configuration = parseRecord(task.model_configuration);
  const binding = configuration ? workflowBinding(configuration) : undefined;
  if (!configuration || configuration.generationIdentityVersion !== 2 || binding) {
    return { bindingMatches: false, projectionState: "not-applicable" };
  }
  const canvasRevision = executeTransactionScopedCommand(
    input.database,
    readCanvasDocumentRevisionCommand,
    { canvasId: task.canvas_id, ownerId: task.owner_id },
  );
  const bindingMatches = currentBindingMatches({
    configuration,
    database: input.database,
    scope: "single-node",
    task,
  });
  if (task.state !== "success") {
    return {
      bindingMatches,
      ...(canvasRevision === undefined ? {} : { canvasRevision }),
      projectionState: "not-applicable",
    };
  }
  const built = buildCanvasProjectionIdentity({
    canvasId: task.canvas_id,
    database: input.database,
    kind: task.kind,
    nodeId: task.node_id,
    ownerId: task.owner_id,
    taskId: task.id,
  });
  if (built.status !== "ready") {
    return {
      bindingMatches,
      ...(canvasRevision === undefined ? {} : { canvasRevision }),
      projectionState: "failed",
    };
  }
  if (canvasRevision === undefined) {
    return {
      bindingMatches,
      operationId: built.projection.operationId,
      projectionState: "failed",
    };
  }
  const receipt = executeTransactionScopedCommand(
    input.database,
    readCanvasOperationReceiptProjectionStateCommand,
    {
      canvasId: task.canvas_id,
      operationId: built.projection.operationId,
      ownerId: task.owner_id,
    },
  );
  const retained = input.database.prepare(`
    SELECT operation_id, state
    FROM generation_canvas_projection_states
    WHERE task_id = ? AND owner_id = ? AND canvas_id = ?
  `).get(task.id, task.owner_id, task.canvas_id) as
    | { operation_id: string | null; state: string }
    | undefined;
  const retainedForCurrentResult = retained && (
    retained.operation_id === null ||
    retained.operation_id === built.projection.operationId
  )
    ? retained
    : undefined;
  return {
    bindingMatches,
    ...(canvasRevision === undefined ? {} : { canvasRevision }),
    operationId: built.projection.operationId,
    ...(receipt
      ? {
          originalRequestId: receipt.originalRequestId,
          projectionDocumentRevision: receipt.resultDocumentRevision,
          projectionState: receipt.outcome === "REJECTED_CONFLICT"
            ? "conflict" as const
            : "applied" as const,
        }
      : {
          projectionState: retainedForCurrentResult?.state === "failed" ||
              retainedForCurrentResult?.state === "applied" ||
              retainedForCurrentResult?.state === "conflict"
            ? "failed" as const
            : "pending" as const,
        }),
  };
}

export function assertAuthoritativeCanvasGenerationProjection(
  value: unknown,
): asserts value is AuthoritativeCanvasGenerationProjection {
  const candidate = record(value);
  if (
    !candidate ||
    Reflect.get(candidate, authoritativeCanvasGenerationProjectionBrand) !== true ||
    !boundedString(candidate.operationId, 200) ||
    !boundedString(candidate.payloadSha256, 64) ||
    !record(candidate.patch)
  ) {
    throw new Error("Authoritative Canvas generation projection is required");
  }
}
