import {
  cleanParameterSchema,
  type ModelParameterSchema,
  type ModelParameterValue,
} from "./modelParameters";
import type { ModelReleaseRevision } from "./modelReleaseRevisions";
import type { NodeInputKind } from "./nodeInputs";
import { isProviderProtocol } from "./relayProtocols";
import type { FrozenWorkflowSemanticPlan } from "./workflowSemanticPlan";

export const workflowRunStates = [
  "running",
  "stopping",
  "success",
  "failed",
  "cancelled",
] as const;
export const workflowRunNodeStates = [
  "pending",
  "admitting",
  "admitted",
  "success",
  "failed",
  "blocked",
  "cancelled",
] as const;
export const workflowProjectionStates = [
  "pending",
  "applied",
  "conflict",
  "failed",
] as const;

export type WorkflowRunState = (typeof workflowRunStates)[number];
export type WorkflowRunNodeState = (typeof workflowRunNodeStates)[number];
export type WorkflowProjectionState = (typeof workflowProjectionStates)[number];
export type WorkflowRecoveryGrade =
  | "DURABLE_PROVIDER_TASK"
  | "DURABLE_USAGE_MATCH"
  | "STORED_RESPONSE_OR_FENCED_UNKNOWN"
  | "SYNC_RESPONSE_OR_FENCED_UNKNOWN";

export type StoredWorkflowNodePlan =
  FrozenWorkflowSemanticPlan["nodes"][number] & Readonly<{
    costCurrency: "CNY" | "USD";
    modelConfigurationRevision: string;
    modelReleaseRevision: ModelReleaseRevision;
    providerDriver: string;
    providerModelId: string;
    providerProtocol: string;
    providerProfileId: string;
    recoveryEvidence: string;
    recoveryGrade: WorkflowRecoveryGrade;
  }>;

export type StoredWorkflowPlan = Readonly<{
  clientSemanticFingerprint: string;
  edges: FrozenWorkflowSemanticPlan["edges"];
  executableNodeIds: readonly string[];
  externalNodes: readonly Readonly<{
    data: Readonly<Record<string, unknown>>;
    id: string;
    type: NodeInputKind;
  }>[];
  groupId: string;
  nodes: readonly StoredWorkflowNodePlan[];
  semanticFingerprint: string;
  version: 1;
}>;

export type WorkflowRunSummary = Readonly<{
  canvasId: string;
  clientSemanticFingerprint: string;
  createdAt: string;
  errorCode?: string;
  errorMessage?: string;
  groupId: string;
  id: string;
  lockedNodeIds: readonly string[];
  nodes: readonly Readonly<{
    errorCode?: string;
    errorMessage?: string;
    id: string;
    kind: NodeInputKind;
    projectionState: WorkflowProjectionState;
    state: WorkflowRunNodeState;
    taskId?: string;
  }>[];
  semanticFingerprint: string;
  state: WorkflowRunState;
  updatedAt: string;
}>;

export class WorkflowPlanValidationError extends Error {
  readonly code = "WORKFLOW_PLAN_MALFORMED";

  constructor(message = "Workflow run plan is malformed") {
    super(message);
    this.name = "WorkflowPlanValidationError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, label: string, maximum = 32_000) {
  if (
    typeof value !== "string" || value.length < 1 || value.length > maximum ||
    /[\u0000\r\n]/.test(value)
  ) throw new WorkflowPlanValidationError(`${label} is invalid`);
  return value;
}

function optionalText(value: unknown, label: string, maximum = 32_000) {
  if (value === undefined) return undefined;
  return boundedText(value, label, maximum);
}

function nodeKind(value: unknown): NodeInputKind {
  if (value === "text" || value === "image" || value === "video" || value === "audio") {
    return value;
  }
  throw new WorkflowPlanValidationError("workflow node kind is invalid");
}

function deepSerializable(value: unknown, label: string): unknown {
  if (
    value === null || typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => deepSerializable(item, label));
  if (record(value)) {
    return Object.fromEntries(Object.entries(value)
      // JSON.stringify omits undefined object members. Normalize the in-memory
      // admission value to that same persisted representation before freezing.
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [
        boundedText(key, `${label} key`, 200),
        deepSerializable(item, label),
      ]));
  }
  throw new WorkflowPlanValidationError(`${label} is not serializable`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function unique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new WorkflowPlanValidationError(`${label} contains duplicates`);
  }
}

function exactObject(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new WorkflowPlanValidationError(`${label} has unknown fields`);
  }
}

function timestamp(value: unknown, label: string) {
  const text = boundedText(value, label, 100);
  if (!Number.isFinite(Date.parse(text))) {
    throw new WorkflowPlanValidationError(`${label} is invalid`);
  }
  return text;
}

function textArray(value: unknown, label: string, maximum = 500) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new WorkflowPlanValidationError(`${label} is invalid`);
  }
  return value.map((item) => boundedText(item, label, 500));
}

const workflowConnectorFamilies = [
  "openai-chat",
  "openai-responses",
  "claude-messages",
  "gemini-generate-content",
  "gpt-image",
  "generic-async-media",
  "ark-native",
  "mureka-native",
  "specialized-code",
] as const;

function contractTarget(value: unknown, label: string) {
  if (!record(value)) throw new WorkflowPlanValidationError(`${label} is invalid`);
  exactObject(value, ["location", "path"], label);
  if (!["form", "json", "query"].includes(String(value.location))) {
    throw new WorkflowPlanValidationError(`${label} location is invalid`);
  }
  boundedText(value.path, `${label} path`, 500);
}

function contractSource(value: unknown, label: string) {
  if (!record(value)) throw new WorkflowPlanValidationError(`${label} is invalid`);
  const kind = String(value.kind);
  if (kind === "model-id" || kind === "prompt" || kind === "task-id") {
    exactObject(value, ["kind"], label);
    return;
  }
  if (kind === "parameter") {
    exactObject(value, ["key", "kind"], label);
    boundedText(value.key, `${label} key`, 200);
    return;
  }
  if (kind === "role") {
    exactObject(value, ["kind", "roleId"], label);
    boundedText(value.roleId, `${label} role`, 200);
    return;
  }
  if (kind === "constant") {
    exactObject(value, ["kind", "value"], label);
    if (!["boolean", "number", "string"].includes(typeof value.value) ||
        typeof value.value === "number" && !Number.isFinite(value.value)) {
      throw new WorkflowPlanValidationError(`${label} constant is invalid`);
    }
    return;
  }
  throw new WorkflowPlanValidationError(`${label} source is invalid`);
}

function executionContract(
  value: unknown,
  connectorFamily: string,
  connectorVersion: number,
) {
  if (!record(value)) {
    throw new WorkflowPlanValidationError("Workflow execution contract is invalid");
  }
  exactObject(value, ["connectorFamily", "connectorVersion", "create", "modes", "poll", "result", "version"], "workflow execution contract");
  if (
    value.connectorFamily !== connectorFamily ||
    value.connectorVersion !== connectorVersion ||
    (value.version !== 1 && value.version !== 2) ||
    !record(value.create) || !record(value.result) ||
    !Array.isArray(value.modes) || value.modes.length < 1 || value.modes.length > 50
  ) throw new WorkflowPlanValidationError("Workflow execution contract is invalid");
  exactObject(value.create, ["method", "path", "taskIdPath"], "workflow create contract");
  if (value.create.method !== "POST") {
    throw new WorkflowPlanValidationError("Workflow create method is invalid");
  }
  boundedText(value.create.path, "workflow create path", 500);
  optionalText(value.create.taskIdPath, "workflow create task path", 500);
  for (const [modeIndex, rawMode] of value.modes.entries()) {
    if (!record(rawMode) || !Array.isArray(rawMode.bindings) ||
        !Array.isArray(rawMode.roles) || rawMode.bindings.length > 100 ||
        rawMode.roles.length > 50) {
      throw new WorkflowPlanValidationError("Workflow execution mode is invalid");
    }
    exactObject(rawMode, ["bindings", "evidence", "id", "prompt", "roles", "runtime"], "workflow execution mode");
    boundedText(rawMode.id, `workflow execution mode ${modeIndex}`, 200);
    if (!["optional", "required"].includes(String(rawMode.prompt)) ||
        rawMode.runtime !== undefined &&
          !["blocked", "declarative"].includes(String(rawMode.runtime)) ||
        rawMode.evidence !== undefined &&
          !["EXACT", "GENERIC_GUESS", "SPECIALIZED", "UNKNOWN"].includes(String(rawMode.evidence))) {
      throw new WorkflowPlanValidationError("Workflow execution mode is invalid");
    }
    for (const rawBinding of rawMode.bindings) {
      if (!record(rawBinding)) {
        throw new WorkflowPlanValidationError("Workflow execution binding is invalid");
      }
      exactObject(rawBinding, ["source", "target", "transform"], "workflow execution binding");
      contractSource(rawBinding.source, "workflow execution binding source");
      contractTarget(rawBinding.target, "workflow execution binding target");
      if (rawBinding.transform !== undefined &&
          !["array", "boolean", "number", "omit-empty", "string"].includes(String(rawBinding.transform))) {
        throw new WorkflowPlanValidationError("Workflow execution transform is invalid");
      }
    }
    for (const rawRole of rawMode.roles) {
      if (!record(rawRole)) {
        throw new WorkflowPlanValidationError("Workflow execution role is invalid");
      }
      exactObject(rawRole, ["id", "kind", "maxItems", "minItems", "ordered", "shape"], "workflow execution role");
      const maximum = Number(rawRole.maxItems);
      const minimum = Number(rawRole.minItems);
      if (!Number.isSafeInteger(maximum) || !Number.isSafeInteger(minimum) ||
          minimum < 0 || maximum < minimum || maximum > 100 ||
          typeof rawRole.ordered !== "boolean" ||
          !["file-id", "url"].includes(String(rawRole.shape))) {
        throw new WorkflowPlanValidationError("Workflow execution role is invalid");
      }
      boundedText(rawRole.id, "workflow execution role id", 200);
      nodeKind(rawRole.kind);
    }
  }
  exactObject(value.result, ["resultPath", "states"], "workflow result contract");
  boundedText(value.result.resultPath, "workflow result path", 500);
  if (value.result.states !== undefined) {
    if (!record(value.result.states)) {
      throw new WorkflowPlanValidationError("Workflow result states are invalid");
    }
    exactObject(value.result.states, ["failed", "running", "succeeded"], "workflow result states");
    textArray(value.result.states.failed, "workflow failed state", 100);
    textArray(value.result.states.running, "workflow running state", 100);
    textArray(value.result.states.succeeded, "workflow succeeded state", 100);
  }
  if (value.poll !== undefined) {
    if (!record(value.poll)) {
      throw new WorkflowPlanValidationError("Workflow poll contract is invalid");
    }
    exactObject(value.poll, ["method", "path", "taskIdTarget"], "workflow poll contract");
    if (!["GET", "POST"].includes(String(value.poll.method))) {
      throw new WorkflowPlanValidationError("Workflow poll method is invalid");
    }
    boundedText(value.poll.path, "workflow poll path", 500);
    contractTarget(value.poll.taskIdTarget, "workflow poll task target");
  }
}

function parseModelReleaseRevision(value: unknown): ModelReleaseRevision {
  if (!record(value) || !record(value.document) || !record(value.validation)) {
    throw new WorkflowPlanValidationError("Workflow model release is invalid");
  }
  exactObject(value, ["createdAt", "document", "hash", "modelId", "predecessorRevisionId", "revisionId", "revisionNumber", "validation"], "workflow model release");
  const modelId = boundedText(value.modelId, "workflow release model id", 200);
  timestamp(value.createdAt, "workflow release created timestamp");
  if (!/^[0-9a-f]{64}$/.test(String(value.hash)) ||
      !/^[0-9a-f-]{36}$/i.test(String(value.revisionId)) ||
      !Number.isSafeInteger(value.revisionNumber) || Number(value.revisionNumber) < 1) {
    throw new WorkflowPlanValidationError("Workflow release identity is invalid");
  }
  if (value.predecessorRevisionId !== undefined &&
      !/^[0-9a-f-]{36}$/i.test(String(value.predecessorRevisionId))) {
    throw new WorkflowPlanValidationError("Workflow release predecessor is invalid");
  }
  const document = value.document;
  exactObject(document, ["capability", "capabilitySchema", "connectorFamily", "connectorVersion", "documentation", "evidence", "executionContract", "modelId", "providerModelId", "providerProfileId", "providerProtocol", "runtime"], "workflow release document");
  const capability = nodeKind(document.capability);
  const connectorFamily = boundedText(document.connectorFamily, "workflow connector family", 100);
  const connectorVersion = Number(document.connectorVersion);
  if (!workflowConnectorFamilies.includes(connectorFamily as never) ||
      !Number.isSafeInteger(connectorVersion) || connectorVersion < 1 ||
      document.modelId !== modelId ||
      !isProviderProtocol(document.providerProtocol) ||
      !["EXACT", "GENERIC_GUESS", "SPECIALIZED", "UNKNOWN"].includes(String(document.evidence)) ||
      !["blocked", "declarative", "specialized-code"].includes(String(document.runtime)) ||
      !record(document.capabilitySchema) || document.capabilitySchema.version !== 2) {
    throw new WorkflowPlanValidationError("Workflow release document is invalid");
  }
  boundedText(document.providerModelId, "workflow release provider model", 300);
  boundedText(document.providerProfileId, "workflow release provider profile", 200);
  try {
    cleanParameterSchema(
      capability,
      document.capabilitySchema,
      document.capabilitySchema as ModelParameterSchema,
    );
  } catch {
    throw new WorkflowPlanValidationError("Workflow release parameter schema is invalid");
  }
  if (!Array.isArray(document.documentation) || document.documentation.length > 20) {
    throw new WorkflowPlanValidationError("Workflow release documentation is invalid");
  }
  for (const source of document.documentation) {
    if (!record(source)) {
      throw new WorkflowPlanValidationError("Workflow release documentation is invalid");
    }
    exactObject(source, ["checkedAt", "url"], "workflow release documentation");
    timestamp(source.checkedAt, "workflow documentation timestamp");
    try {
      const url = new URL(boundedText(source.url, "workflow documentation URL", 2_000));
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new Error("unsafe URL");
      }
    } catch {
      throw new WorkflowPlanValidationError("Workflow release documentation is invalid");
    }
  }
  executionContract(document.executionContract, connectorFamily, connectorVersion);
  const validation = value.validation;
  exactObject(validation, ["compilerHash", "impact", "paidProviderRequests", "preview", "validatedAt"], "workflow release validation");
  if (!/^[0-9a-f]{64}$/.test(String(validation.compilerHash)) ||
      validation.paidProviderRequests !== 0 ||
      !record(validation.impact) || !record(validation.preview) ||
      !Array.isArray(validation.preview.modes)) {
    throw new WorkflowPlanValidationError("Workflow release validation is invalid");
  }
  timestamp(validation.validatedAt, "workflow release validation timestamp");
  exactObject(validation.impact, ["incompatibleTemplateIds", "nodeMatrix", "preexistingIncompatibleTemplateIds", "templateIds"], "workflow release impact");
  textArray(validation.impact.incompatibleTemplateIds, "workflow incompatible template id");
  textArray(validation.impact.templateIds, "workflow template id");
  if (validation.impact.preexistingIncompatibleTemplateIds !== undefined) {
    textArray(validation.impact.preexistingIncompatibleTemplateIds, "workflow preexisting template id");
  }
  if (validation.impact.nodeMatrix !== undefined &&
      !Array.isArray(validation.impact.nodeMatrix)) {
    throw new WorkflowPlanValidationError("Workflow release impact matrix is invalid");
  }
  deepSerializable(validation.impact.nodeMatrix ?? [], "workflow release impact matrix");
  exactObject(validation.preview, ["modes"], "workflow release preview");
  deepSerializable(validation.preview.modes, "workflow release preview modes");
  return deepSerializable(value, "workflow model release") as ModelReleaseRevision;
}

export function parseImmutableWorkflowPlan(value: unknown): StoredWorkflowPlan {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value) as unknown;
    } catch {
      throw new WorkflowPlanValidationError("Workflow run plan JSON is invalid");
    }
  }
  if (!record(raw) || raw.version !== 1) {
    throw new WorkflowPlanValidationError();
  }
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > 500) {
    throw new WorkflowPlanValidationError("Workflow plan nodes are invalid");
  }
  const nodes = raw.nodes.map((item, index) => {
    if (!record(item)) throw new WorkflowPlanValidationError("Workflow node is invalid");
    if (!Array.isArray(item.dependencies)) {
      throw new WorkflowPlanValidationError("Workflow dependencies are invalid");
    }
    const dependencies = item.dependencies.map((dependency) =>
      boundedText(dependency, "workflow dependency", 200)
    );
    unique(dependencies, "workflow dependencies");
    if (!record(item.parameters)) {
      throw new WorkflowPlanValidationError("Workflow parameters are invalid");
    }
    const planIndex = Number(item.planIndex);
    if (!Number.isSafeInteger(planIndex) || planIndex !== index) {
      throw new WorkflowPlanValidationError("Workflow plan index is invalid");
    }
    const id = boundedText(item.id, "workflow node id", 200);
    const kind = nodeKind(item.kind);
    const modelId = boundedText(item.modelId, "workflow model id", 200);
    const providerModelId = boundedText(
      item.providerModelId,
      "workflow provider model",
      300,
    );
    const providerProfileId = boundedText(
      item.providerProfileId,
      "workflow provider profile",
      200,
    );
    const providerProtocol = boundedText(
      item.providerProtocol,
      "workflow provider protocol",
      120,
    );
    const release = parseModelReleaseRevision(item.modelReleaseRevision);
    if (
      release.modelId !== modelId ||
      release.document.modelId !== modelId ||
      release.document.capability !== kind ||
      release.document.providerModelId !== providerModelId ||
      release.document.providerProfileId !== providerProfileId ||
      release.document.providerProtocol !== providerProtocol
    ) throw new WorkflowPlanValidationError("Workflow release does not match node");
    if (dependencies.includes(id)) {
      throw new WorkflowPlanValidationError("Workflow node depends on itself");
    }
    return {
      costCurrency: item.costCurrency === "CNY" || item.costCurrency === "USD"
        ? item.costCurrency
        : (() => {
            throw new WorkflowPlanValidationError("Workflow cost currency is invalid");
          })(),
      dependencies,
      id,
      kind,
      modelConfigurationRevision: boundedText(
        item.modelConfigurationRevision,
        "workflow model configuration revision",
        500,
      ),
      modelId,
      modelReleaseRevision: release,
      ownPrompt: typeof item.ownPrompt === "string" && item.ownPrompt.length <= 32_000
        ? item.ownPrompt
        : (() => {
            throw new WorkflowPlanValidationError("Workflow prompt is invalid");
          })(),
      parameters: deepSerializable(
        item.parameters,
        "workflow parameters",
      ) as Readonly<Record<string, ModelParameterValue>>,
      planIndex,
      providerDriver: boundedText(item.providerDriver, "workflow provider driver", 120),
      providerModelId,
      providerProfileId,
      providerProtocol,
      recoveryEvidence: boundedText(item.recoveryEvidence, "workflow recovery evidence", 2_000),
      recoveryGrade: ([
        "DURABLE_PROVIDER_TASK",
        "DURABLE_USAGE_MATCH",
        "STORED_RESPONSE_OR_FENCED_UNKNOWN",
        "SYNC_RESPONSE_OR_FENCED_UNKNOWN",
      ] as const).includes(item.recoveryGrade as WorkflowRecoveryGrade)
        ? item.recoveryGrade as WorkflowRecoveryGrade
        : (() => {
            throw new WorkflowPlanValidationError("Workflow recovery grade is invalid");
          })(),
      semanticIdentity: boundedText(item.semanticIdentity, "workflow semantic identity", 500),
    } satisfies StoredWorkflowNodePlan;
  });
  const nodeIds = nodes.map(({ id }) => id);
  unique(nodeIds, "workflow node ids");
  const nodeIndex = new Map(nodes.map(({ id, planIndex }) => [id, planIndex]));
  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      const dependencyIndex = nodeIndex.get(dependency);
      if (dependencyIndex === undefined || dependencyIndex >= node.planIndex) {
        throw new WorkflowPlanValidationError("Workflow dependency order is invalid");
      }
    }
  }
  if (!Array.isArray(raw.executableNodeIds)) {
    throw new WorkflowPlanValidationError("Workflow executable node ids are invalid");
  }
  const executableNodeIds = raw.executableNodeIds.map((id) =>
    boundedText(id, "workflow executable node id", 200)
  );
  unique(executableNodeIds, "workflow executable node ids");
  if (JSON.stringify(executableNodeIds) !== JSON.stringify(nodeIds)) {
    throw new WorkflowPlanValidationError("Workflow executable nodes do not match plan nodes");
  }
  if (!Array.isArray(raw.externalNodes) || raw.externalNodes.length > 500) {
    throw new WorkflowPlanValidationError("Workflow external nodes are invalid");
  }
  const externalNodes = raw.externalNodes.map((item) => {
    if (!record(item) || !record(item.data)) {
      throw new WorkflowPlanValidationError("Workflow external node is invalid");
    }
    const kind = nodeKind(item.type);
    const data = deepSerializable(item.data, "workflow external node data") as Record<string, unknown>;
    if (
      kind === "text"
        ? typeof data.content !== "string" || data.content.trim().length < 1
        : typeof data.assetId !== "string" || data.assetId.length < 1
    ) throw new WorkflowPlanValidationError("Workflow external node evidence is missing");
    return {
      data,
      id: boundedText(item.id, "workflow external node id", 200),
      type: kind,
    };
  });
  const externalIds = externalNodes.map(({ id }) => id);
  unique(externalIds, "workflow external node ids");
  if (externalIds.some((id) => nodeIndex.has(id))) {
    throw new WorkflowPlanValidationError("Workflow node identities overlap");
  }
  if (!Array.isArray(raw.edges) || raw.edges.length > 2_000) {
    throw new WorkflowPlanValidationError("Workflow edges are invalid");
  }
  const allSources = new Set([...nodeIds, ...externalIds]);
  const edges = raw.edges.map((item) => {
    if (!record(item)) throw new WorkflowPlanValidationError("Workflow edge is invalid");
    const inputOrder = Number(item.inputOrder);
    const source = boundedText(item.source, "workflow edge source", 200);
    const target = boundedText(item.target, "workflow edge target", 200);
    if (
      !Number.isSafeInteger(inputOrder) || inputOrder < 1 ||
      !allSources.has(source) || !nodeIndex.has(target)
    ) throw new WorkflowPlanValidationError("Workflow edge endpoint or order is invalid");
    return {
      id: boundedText(item.id, "workflow edge id", 200),
      inputOrder,
      ...(optionalText(item.inputRole, "workflow edge role", 200)
        ? { inputRole: String(item.inputRole) }
        : {}),
      source,
      target,
    };
  });
  unique(edges.map(({ id }) => id), "workflow edge ids");
  const result: StoredWorkflowPlan = {
    clientSemanticFingerprint: boundedText(
      raw.clientSemanticFingerprint,
      "workflow client semantic fingerprint",
      500,
    ),
    edges,
    executableNodeIds,
    externalNodes,
    groupId: boundedText(raw.groupId, "workflow group id", 200),
    nodes,
    semanticFingerprint: boundedText(
      raw.semanticFingerprint,
      "workflow semantic fingerprint",
      500,
    ),
    version: 1,
  };
  return deepFreeze(result);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function optionalSummaryText(
  value: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
) {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  return boundedText(value[key], label, maxLength);
}

function summaryTimestamp(value: unknown, label: string) {
  const timestamp = boundedText(value, label, 100);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} is invalid`);
  }
  return timestamp;
}

export function parseWorkflowRunSummary(value: unknown): WorkflowRunSummary {
  if (!record(value) || !Array.isArray(value.nodes) || !Array.isArray(value.lockedNodeIds)) {
    throw new Error("Workflow run response is invalid");
  }
  if (!exactKeys(value, [
    "canvasId", "clientSemanticFingerprint", "createdAt", "errorCode", "errorMessage",
    "groupId", "id", "lockedNodeIds", "nodes", "semanticFingerprint", "state",
    "updatedAt",
  ])) throw new Error("Workflow run response has unknown fields");
  const state = workflowRunStates.includes(value.state as WorkflowRunState)
    ? value.state as WorkflowRunState
    : (() => { throw new Error("Workflow run state is invalid"); })();
  const nodes = value.nodes.map((item) => {
    if (!record(item)) throw new Error("Workflow run node is invalid");
    if (!exactKeys(item, [
      "errorCode", "errorMessage", "id", "kind", "projectionState", "state",
      "taskId",
    ])) throw new Error("Workflow run node has unknown fields");
    const nodeState = workflowRunNodeStates.includes(item.state as WorkflowRunNodeState)
      ? item.state as WorkflowRunNodeState
      : (() => { throw new Error("Workflow run node state is invalid"); })();
    const projectionState = workflowProjectionStates.includes(
      item.projectionState as WorkflowProjectionState,
    )
      ? item.projectionState as WorkflowProjectionState
      : (() => { throw new Error("Workflow projection state is invalid"); })();
    return Object.freeze({
      ...(optionalSummaryText(item, "errorCode", "workflow node error code", 200)
        ? { errorCode: String(item.errorCode) }
        : {}),
      ...(optionalSummaryText(item, "errorMessage", "workflow node error message", 2_000)
        ? { errorMessage: String(item.errorMessage) }
        : {}),
      id: boundedText(item.id, "workflow run node id", 200),
      kind: nodeKind(item.kind),
      projectionState,
      state: nodeState,
      ...(optionalSummaryText(item, "taskId", "workflow node task id", 200)
        ? { taskId: String(item.taskId) }
        : {}),
    });
  });
  unique(nodes.map(({ id }) => id), "workflow run node ids");
  const lockedNodeIds = value.lockedNodeIds.map((id) =>
    boundedText(id, "workflow locked node id", 200)
  );
  unique(lockedNodeIds, "workflow locked node ids");
  return deepFreeze({
    canvasId: boundedText(value.canvasId, "workflow canvas id", 200),
    clientSemanticFingerprint: boundedText(
      value.clientSemanticFingerprint,
      "workflow client fingerprint",
      500,
    ),
    createdAt: summaryTimestamp(value.createdAt, "workflow created timestamp"),
    ...(optionalSummaryText(value, "errorCode", "workflow run error code", 200)
      ? { errorCode: String(value.errorCode) }
      : {}),
    ...(optionalSummaryText(value, "errorMessage", "workflow run error message", 2_000)
      ? { errorMessage: String(value.errorMessage) }
      : {}),
    groupId: boundedText(value.groupId, "workflow group id", 200),
    id: boundedText(value.id, "workflow run id", 200),
    lockedNodeIds,
    nodes,
    semanticFingerprint: boundedText(value.semanticFingerprint, "workflow fingerprint", 500),
    state,
    updatedAt: summaryTimestamp(value.updatedAt, "workflow updated timestamp"),
  });
}

export function parseWorkflowRunsEnvelope(value: unknown) {
  if (!record(value) || !Array.isArray(value.runs) || !exactKeys(value, ["runs"])) {
    throw new Error("Workflow runs response is invalid");
  }
  return Object.freeze({ runs: Object.freeze(value.runs.map(parseWorkflowRunSummary)) });
}
