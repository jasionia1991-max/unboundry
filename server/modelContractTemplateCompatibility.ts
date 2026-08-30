import {
  compileModelExecutionContract,
  selectExecutionMode,
} from "./modelExecutionContractCompiler";
import type { NodeInputKind } from "../types/nodeInputs";
import type { ModelReleaseDocument } from "../types/modelReleaseRevisions";
import {
  submissionParameterValues,
  validateParameterValues,
} from "../types/modelParameters";
import {
  parseTemplateGraph,
  type TemplateGraph,
} from "./templateCatalog";
import { defaultNodeInputRole } from "../types/nodeInputs";

export type ModelContractTemplateNodeCompatibility = Readonly<{
  afterModeId?: string;
  beforeModeId?: string;
  compatible: boolean;
  inputRoles: readonly string[];
  nodeId: string;
  reason?: string;
  templateId: string;
}>;

type TemplateRow = Readonly<{ graph: string; id: string }>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nodeUsesModel(
  node: TemplateGraph["nodes"][number],
  document: ModelReleaseDocument,
) {
  return node.type === document.capability &&
    text(node.data[`${document.capability}ModelId`]) === document.modelId;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        stable((value as Record<string, unknown>)[key]),
      ]),
    );
  }
  return value;
}

function equal(left: unknown, right: unknown) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function preservesExistingExecution(
  active: ModelReleaseDocument,
  proposed: ModelReleaseDocument,
) {
  if (
    active.capability !== proposed.capability ||
    active.connectorFamily !== proposed.connectorFamily ||
    active.connectorVersion !== proposed.connectorVersion ||
    active.providerModelId !== proposed.providerModelId ||
    active.providerProfileId !== proposed.providerProfileId ||
    active.providerProtocol !== proposed.providerProtocol ||
    !equal(active.executionContract.create, proposed.executionContract.create) ||
    !equal(active.executionContract.poll, proposed.executionContract.poll) ||
    !equal(active.executionContract.result, proposed.executionContract.result)
  ) return false;
  const proposedFields = new Map(
    proposed.capabilitySchema.fields.map((field) => [field.key, field]),
  );
  if (active.capabilitySchema.fields.some((field) =>
    !equal(field, proposedFields.get(field.key))
  )) return false;
  const proposedModes = new Map(
    proposed.executionContract.modes.map((mode) => [mode.id, mode]),
  );
  return active.executionContract.modes.every((mode) => {
    const next = proposedModes.get(mode.id);
    return Boolean(next) && equal({
      bindings: mode.bindings,
      id: mode.id,
      prompt: mode.prompt,
      roles: mode.roles,
    }, {
      bindings: next?.bindings,
      id: next?.id,
      prompt: next?.prompt,
      roles: next?.roles,
    });
  });
}

function modeForNode(
  graph: TemplateGraph,
  node: TemplateGraph["nodes"][number],
  document: ModelReleaseDocument,
) {
  const nodes = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const seenOrders = new Set<number>();
  const inputs = graph.edges
    .filter((edge) => edge.target === node.id)
    .map((edge, index) => {
      const source = nodes.get(edge.source);
      const kind = source?.type as NodeInputKind;
      if (!source || !["audio", "image", "text", "video"].includes(kind)) {
        throw new Error("模板输入来源无效");
      }
      const rawRole = edge.data?.inputRole;
      const role = typeof rawRole === "string"
        ? rawRole
        : defaultNodeInputRole(kind, document.capability as NodeInputKind);
      if (!/^[a-z][a-z-]{0,39}$/.test(role)) {
        throw new Error("模板输入角色无效");
      }
      const rawOrder = edge.data?.inputOrder;
      const order = rawOrder === undefined ? index + 1 : Number(rawOrder);
      if (!Number.isSafeInteger(order) || order < 1 || seenOrders.has(order)) {
        throw new Error("模板输入顺序缺失、重复或无效");
      }
      seenOrders.add(order);
      // Public templates intentionally persist unmaterialized source cards.
      // Their ordinary publish/import preflight validates how those cards
      // become ready; revision compatibility must compare the saved kinds,
      // roles, order and parameters against both contracts without requiring
      // a generated asset to exist at release time.
      return { kind, order, role };
    })
    .sort((left, right) => left.order - right.order);
  const declaredRoles = new Map(
    document.executionContract.modes.flatMap((mode) => mode.roles)
      .map((role) => [role.id, role]),
  );
  const runtimeInputs = inputs.flatMap((item) => {
    const declared = declaredRoles.get(item.role);
    if (
      item.kind === "text" &&
      !declared &&
      (item.role === "instruction" || item.role === "context-text")
    ) return [];
    return [{
      kind: item.kind,
      order: item.order,
      roleId: item.role,
      value: declared?.shape === "file-id"
        ? `file-template-${item.order}`
        : `https://example.invalid/template-${item.order}`,
    }];
  });
  const compiled = compileModelExecutionContract(document.executionContract);
  const kind = document.capability;
  const raw = node.data[`${kind}Parameters`];
  const parameterInput = raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...raw as Record<string, unknown> }
    : {};
  if (kind === "image") {
    if (node.data.imageAspectRatio !== undefined) {
      parameterInput.aspectRatio = node.data.imageAspectRatio;
    }
    if (node.data.imageQuality !== undefined) {
      parameterInput.quality = node.data.imageQuality;
    }
  }
  submissionParameterValues(
    document.capabilitySchema,
    validateParameterValues(document.capabilitySchema, parameterInput),
  );
  const mode = selectExecutionMode(compiled.contract, {
    inputs: runtimeInputs,
    prompt: "模板运行时提示词",
  });
  return { inputRoles: inputs.map((item) => item.role), modeId: mode.id };
}

export function analyzeModelContractTemplateCompatibility(input: Readonly<{
  active: ModelReleaseDocument;
  proposed: ModelReleaseDocument;
  proposedRows?: readonly TemplateRow[];
  rows: readonly TemplateRow[];
  runtimeEquivalentSchemaTransition?: boolean;
}>) {
  const templateIds: string[] = [];
  const incompatibleTemplateIds = new Set<string>();
  const preexistingIncompatibleTemplateIds = new Set<string>();
  const nodes: ModelContractTemplateNodeCompatibility[] = [];
  const preservesExecution = input.runtimeEquivalentSchemaTransition === true ||
    preservesExistingExecution(input.active, input.proposed);
  const proposedRows = new Map(
    (input.proposedRows ?? input.rows).map((row) => [row.id, row]),
  );
  for (const row of input.rows) {
    if (!row.graph.includes(input.proposed.modelId)) continue;
    templateIds.push(row.id);
    const graph = parseTemplateGraph(row.graph);
    const proposedGraph = parseTemplateGraph(
      proposedRows.get(row.id)?.graph ?? row.graph,
    );
    if (!graph || !proposedGraph) {
      incompatibleTemplateIds.add(row.id);
      nodes.push(Object.freeze({
        compatible: false,
        inputRoles: Object.freeze([]),
        nodeId: "unparseable",
        reason: "模板graph无法解析",
        templateId: row.id,
      }));
      continue;
    }
    let hasIncompatibleNode = false;
    let hasNonPreexistingIncompatibleNode = false;
    for (const node of graph.nodes) {
      if (!nodeUsesModel(node, input.proposed)) continue;
      const proposedNode = proposedGraph.nodes.find((candidate) =>
        candidate.id === node.id && nodeUsesModel(candidate, input.proposed)
      );
      let before: ReturnType<typeof modeForNode> | undefined;
      let after: ReturnType<typeof modeForNode> | undefined;
      let beforeError: unknown;
      let afterError: unknown;
      try {
        before = modeForNode(graph, node, input.active);
      } catch (error) {
        beforeError = error;
      }
      try {
        if (!proposedNode) throw new Error("迁移后的模板节点不存在或模型身份已变化");
        after = modeForNode(proposedGraph, proposedNode, input.proposed);
      } catch (error) {
        afterError = error;
      }
      const incompatible = !preservesExecution || !before || !after;
      if (incompatible) {
        hasIncompatibleNode = true;
        if (before || after) hasNonPreexistingIncompatibleNode = true;
        incompatibleTemplateIds.add(row.id);
      }
      nodes.push(Object.freeze({
        ...(after ? { afterModeId: after.modeId } : {}),
        ...(before ? { beforeModeId: before.modeId } : {}),
        compatible: preservesExecution && Boolean(before && after),
        inputRoles: Object.freeze(
          after?.inputRoles ?? before?.inputRoles ?? [],
        ),
        nodeId: node.id,
        ...(!preservesExecution
          ? { reason: "现有参数、Provider绑定或请求/结果语义发生变化" }
          : !after
          ? {
              reason: afterError instanceof Error
                ? afterError.message
                : beforeError instanceof Error
                  ? beforeError.message
                  : "模板节点无法唯一匹配合同模式",
            }
          : {}),
        templateId: row.id,
      }));
    }
    // Preexisting debt is a template-level exemption, so every incompatible
    // targeted node in that template must already fail under both contracts.
    // A single double-failing node must never hide a sibling that is valid
    // before the migration but invalid afterwards.
    if (hasIncompatibleNode && !hasNonPreexistingIncompatibleNode) {
      preexistingIncompatibleTemplateIds.add(row.id);
    }
  }
  return Object.freeze({
    incompatibleTemplateIds: Object.freeze([...incompatibleTemplateIds].sort()),
    nodes: Object.freeze(nodes),
    preexistingIncompatibleTemplateIds: Object.freeze([
      ...preexistingIncompatibleTemplateIds,
    ].sort()),
    templateIds: Object.freeze([...new Set(templateIds)].sort()),
  });
}
