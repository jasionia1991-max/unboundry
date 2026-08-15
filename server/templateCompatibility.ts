import type { DatabaseSync } from "node:sqlite";
import {
  publishedTemplateModelContracts,
} from "./modelCatalog";
import {
  parseTemplateGraph,
  type TemplateGraph,
  type TemplateNodeType,
} from "./templateCatalog";
import {
  submissionParameterValues,
  validateParameterValues,
  type ModelParameterValue,
} from "../types/modelParameters";
import {
  isNodeInputConnectionAllowed,
  resolveNodeInputs,
} from "../types/nodeInputs";

type GenerationKind = "audio" | "image" | "text" | "video";

export type PublicTemplateCompatibilityIssue = {
  code:
    | "CYCLE"
    | "DUPLICATE_EDGE"
    | "DUPLICATE_EDGE_ID"
    | "DUPLICATE_NODE_ID"
    | "EDGE_ENDPOINT_INVALID"
    | "INPUT_INCOMPATIBLE"
    | "INPUT_ORDER_INVALID"
    | "MODEL_SELECTION_REQUIRED"
    | "MODEL_UNAVAILABLE"
    | "PARAMETER_UNSUPPORTED"
    | "PARENT_INVALID";
  message: string;
  nodeId?: string;
  nodeTitle?: string;
};

export type PublicTemplateCompatibilityStatus =
  | "INVALID"
  | "NEEDS_MODEL"
  | "PASS";

export type PublicTemplateCompatibilityAudit = {
  issues: PublicTemplateCompatibilityIssue[];
  status: PublicTemplateCompatibilityStatus;
};

const generationKinds = new Set<GenerationKind>([
  "audio",
  "image",
  "text",
  "video",
]);

const capabilityProblemCodes = new Set([
  "COMBINATION_UNSUPPORTED",
  "GRAPH_INVALID",
  "MODEL_UNSUPPORTED",
  "ORDER_INVALID",
  "QUANTITY_EXCEEDED",
  "REQUIRED_MISSING",
  "ROLE_CONFLICT",
  "ROLE_UNSUPPORTED",
]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nodeTitle(node: TemplateGraph["nodes"][number]) {
  return text(node.data.title) || text(node.data.label) || node.id;
}

function issueForNode(
  node: TemplateGraph["nodes"][number],
  code: PublicTemplateCompatibilityIssue["code"],
  message: string,
): PublicTemplateCompatibilityIssue {
  return { code, message, nodeId: node.id, nodeTitle: nodeTitle(node) };
}

function generationKind(type: TemplateNodeType): GenerationKind | undefined {
  return generationKinds.has(type as GenerationKind)
    ? type as GenerationKind
    : undefined;
}

function executableGenerationNode(
  graph: TemplateGraph,
  node: TemplateGraph["nodes"][number],
) {
  const kind = generationKind(node.type);
  if (!kind) return false;
  const prompt = text(node.data[`${kind}Prompt`]);
  if (node.data[`${kind}PromptReady`] !== true) return false;
  if (kind === "text") return Boolean(prompt);
  return Boolean(prompt) || graph.edges.some((edge) => {
    if (edge.target !== node.id) return false;
    return graph.nodes.find((candidate) => candidate.id === edge.source)
      ?.type === "text";
  });
}

function structureIssues(graph: TemplateGraph) {
  const issues: PublicTemplateCompatibilityIssue[] = [];
  const nodesById = new Map<string, TemplateGraph["nodes"][number]>();
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push(issueForNode(
        node,
        "DUPLICATE_NODE_ID",
        `节点编号重复：${node.id}`,
      ));
      continue;
    }
    nodeIds.add(node.id);
    nodesById.set(node.id, node);
  }
  for (const node of graph.nodes) {
    if (!node.parentId) continue;
    const parent = nodesById.get(node.parentId);
    if (!parent || parent.type !== "group" || parent.id === node.id) {
      issues.push(issueForNode(
        node,
        "PARENT_INVALID",
        "父级不存在、不是 Group，或节点把自己设为父级",
      ));
    }
  }

  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();
  const explicitOrders = new Map<string, Set<number>>();
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({
        code: "DUPLICATE_EDGE_ID",
        message: `连线编号重复：${edge.id}`,
      });
    }
    edgeIds.add(edge.id);
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target || source.id === target.id) {
      issues.push({
        code: "EDGE_ENDPOINT_INVALID",
        message: `连线 ${edge.id} 的起点、终点不存在或指向自身`,
        nodeId: target?.id,
        nodeTitle: target ? nodeTitle(target) : undefined,
      });
      continue;
    }
    if (!isNodeInputConnectionAllowed(source.type, target.type)) {
      issues.push(issueForNode(
        target,
        "EDGE_ENDPOINT_INVALID",
        `不允许 ${source.type} 连接到 ${target.type}`,
      ));
      continue;
    }
    const pair = `${edge.source}\u0000${edge.target}`;
    if (edgePairs.has(pair)) {
      issues.push(issueForNode(
        target,
        "DUPLICATE_EDGE",
        "同一来源不能重复连接到同一节点",
      ));
    }
    edgePairs.add(pair);
    const rawOrder = edge.data?.inputOrder;
    if (rawOrder !== undefined) {
      if (!Number.isSafeInteger(rawOrder) || Number(rawOrder) < 1) {
        issues.push(issueForNode(
          target,
          "INPUT_ORDER_INVALID",
          "输入顺序必须是大于等于 1 的整数",
        ));
      } else {
        const orders = explicitOrders.get(target.id) ?? new Set<number>();
        if (orders.has(Number(rawOrder))) {
          issues.push(issueForNode(
            target,
            "INPUT_ORDER_INVALID",
            "同一节点的输入顺序不能重复",
          ));
        }
        orders.add(Number(rawOrder));
        explicitOrders.set(target.id, orders);
      }
    }
    adjacency.get(source.id)!.push(target.id);
    inDegree.set(target.id, (inDegree.get(target.id) ?? 0) + 1);
  }

  const remaining = new Map(inDegree);
  while (remaining.size > 0) {
    const ready = Array.from(remaining.entries())
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id);
    if (ready.length === 0) {
      issues.push({ code: "CYCLE", message: "模板工作流存在循环依赖" });
      break;
    }
    for (const id of ready) {
      remaining.delete(id);
      for (const target of adjacency.get(id) ?? []) {
        const degree = remaining.get(target);
        if (degree !== undefined) remaining.set(target, degree - 1);
      }
    }
  }
  return issues;
}

function hypotheticalReadyNodes(graph: TemplateGraph) {
  return graph.nodes.map((node) => {
    const kind = generationKind(node.type);
    if (!kind) return node;
    const data = { ...node.data };
    if (kind === "text") {
      data.content = text(data.content) || "模板上游运行时文字";
    } else {
      data.assetId = text(data.assetId) || `template-audit-${node.id}`;
      data[`${kind}Src`] = text(data[`${kind}Src`]) ||
        `/api/${kind === "image" ? "assets" : kind}/${data.assetId}`;
      data.inputState = "ready";
      data.inputStateReason = undefined;
      data[`${kind}GenerationError`] = undefined;
      data.mediaByteSize = 1_048_576;
      data.mediaContentType = kind === "image"
        ? "image/png"
        : kind === "video"
          ? "video/mp4"
          : "audio/mpeg";
      data.mediaDurationSeconds = kind === "image" ? undefined : 5;
      data.mediaHeight = kind === "audio" ? undefined : 1024;
      data.mediaMetadataSource = "server";
      data.mediaMetadataStatus = "ready";
      data.mediaStorageBackend = "oss";
      data.mediaWidth = kind === "audio" ? undefined : 1024;
    }
    return { ...node, data };
  });
}

function nodeParameterInput(
  node: TemplateGraph["nodes"][number],
  kind: GenerationKind,
) {
  const raw = node.data[`${kind}Parameters`];
  const parameters = raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...raw as Record<string, unknown> }
    : {};
  if (kind === "image") {
    if (node.data.imageAspectRatio !== undefined) {
      parameters.aspectRatio = node.data.imageAspectRatio;
    }
    if (node.data.imageQuality !== undefined) {
      parameters.quality = node.data.imageQuality;
    }
  }
  return parameters;
}

export function auditPublicTemplateCompatibility(
  store: DatabaseSync,
  graph: TemplateGraph,
): PublicTemplateCompatibilityAudit {
  const structural = structureIssues(graph);
  if (structural.length > 0) return { issues: structural, status: "INVALID" };

  const issues: PublicTemplateCompatibilityIssue[] = [];
  const models = publishedTemplateModelContracts(store);
  const hypotheticalNodes = hypotheticalReadyNodes(graph);
  for (const node of graph.nodes) {
    const kind = generationKind(node.type);
    if (!kind || !executableGenerationNode(graph, node)) continue;
    const savedModelId = text(node.data[`${kind}ModelId`]);
    if (!savedModelId) {
      issues.push(issueForNode(
        node,
        "MODEL_SELECTION_REQUIRED",
        "发布前必须明确选择并保存推荐模型，不能在导入时静默使用默认模型",
      ));
      continue;
    }
    const model = models.find((candidate) =>
      candidate.id === savedModelId && candidate.capability === kind);
    if (!model) {
      issues.push(issueForNode(
        node,
        "MODEL_UNAVAILABLE",
        `推荐模型 ${savedModelId} 未发布、已停用或节点类型不匹配`,
      ));
      continue;
    }
    let parameters: Record<string, ModelParameterValue>;
    try {
      parameters = submissionParameterValues(
        model.parameterSchema,
        validateParameterValues(
          model.parameterSchema,
          nodeParameterInput(node, kind),
        ),
      );
    } catch {
      issues.push(issueForNode(
        node,
        "PARAMETER_UNSUPPORTED",
        `节点参数与推荐模型“${model.displayName}”不兼容`,
      ));
      continue;
    }
    const preflight = resolveNodeInputs({
      edges: graph.edges,
      mediaInputPolicy: model.mediaInputPolicy,
      modelSchema: model.parameterSchema,
      nodes: hypotheticalNodes,
      ownPrompt: text(node.data[`${kind}Prompt`]),
      parameters,
      targetId: node.id,
      targetKind: kind,
    });
    const seen = new Set<string>();
    for (const problem of preflight.problems) {
      if (!capabilityProblemCodes.has(problem.code)) continue;
      const key = `${problem.code}\u0000${problem.edgeId ?? ""}\u0000${problem.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(issueForNode(
        node,
        "INPUT_INCOMPATIBLE",
        `${model.displayName}：${problem.message}`,
      ));
    }
  }
  const needsModel = issues.length > 0 && issues.every((issue) =>
    issue.code === "MODEL_SELECTION_REQUIRED" ||
    issue.code === "MODEL_UNAVAILABLE");
  return {
    issues,
    status: issues.length === 0 ? "PASS" : needsModel ? "NEEDS_MODEL" : "INVALID",
  };
}

export class PublicTemplateCompatibilityError extends Error {
  readonly code = "TEMPLATE_COMPATIBILITY_FAILED";

  constructor(readonly audit: PublicTemplateCompatibilityAudit) {
    const first = audit.issues[0];
    super(
      `模板发布兼容检查失败（${audit.issues.length}项）：${
        first?.nodeTitle ? `节点“${first.nodeTitle}”：` : ""
      }${first?.message ?? "请检查模板图"}`,
    );
    this.name = "PublicTemplateCompatibilityError";
  }
}

export function assertPublicTemplatePublishable(
  store: DatabaseSync,
  graph: TemplateGraph,
) {
  const audit = auditPublicTemplateCompatibility(store, graph);
  if (audit.status !== "PASS") throw new PublicTemplateCompatibilityError(audit);
  return audit;
}

export function auditStoredPublicTemplates(store: DatabaseSync) {
  const rows = store.prepare(`
    SELECT id, title, status, graph
    FROM public_templates
    ORDER BY created_at, id
  `).all() as Array<{
    graph: string;
    id: string;
    status: string;
    title: string;
  }>;
  return rows.map((row) => {
    const graph = parseTemplateGraph(row.graph);
    const audit = graph
      ? auditPublicTemplateCompatibility(store, graph)
      : {
          issues: [{
            code: "EDGE_ENDPOINT_INVALID" as const,
            message: "模板图 JSON 无法安全解析",
          }],
          status: "INVALID" as const,
        };
    return { id: row.id, sourceStatus: row.status, title: row.title, ...audit };
  });
}
