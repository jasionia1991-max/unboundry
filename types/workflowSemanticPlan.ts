import type { ModelParameterValue } from "./modelParameters";
import type { NodeInputKind } from "./nodeInputs";

export type WorkflowSemanticNode = Readonly<{
  id: string;
  parentId?: string;
  type?: string;
  data?: Readonly<Record<string, unknown>>;
}>;

export type WorkflowSemanticEdge = Readonly<{
  id: string;
  source: string;
  target: string;
  data?: Readonly<Record<string, unknown>>;
}>;

export type FrozenWorkflowNodePlan = Readonly<{
  dependencies: readonly string[];
  id: string;
  kind: NodeInputKind;
  modelId: string;
  ownPrompt: string;
  parameters: Readonly<Record<string, ModelParameterValue>>;
  planIndex: number;
  semanticIdentity: string;
}>;

export type FrozenWorkflowSemanticPlan = Readonly<{
  edges: readonly Readonly<{
    id: string;
    inputOrder: number;
    inputRole?: string;
    source: string;
    target: string;
  }>[];
  executableNodeIds: readonly string[];
  externalNodes: readonly Readonly<{
    assetId?: string;
    content?: string;
    id: string;
    inputState?: string;
    kind: NodeInputKind;
  }>[];
  groupId: string;
  nodes: readonly FrozenWorkflowNodePlan[];
  semanticFingerprint: string;
  version: 1;
}>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

/** Browser-safe deterministic digest; it is an identity fence, not a secret. */
export function workflowSemanticDigest(value: unknown) {
  const source = JSON.stringify(stableValue(value));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `wf1-${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nodeKind(value: unknown): NodeInputKind | undefined {
  return value === "text" || value === "image" || value === "video" || value === "audio"
    ? value
    : undefined;
}

function promptFor(node: WorkflowSemanticNode, kind: NodeInputKind) {
  return text(node.data?.[`${kind}Prompt`]);
}

function modelFor(node: WorkflowSemanticNode, kind: NodeInputKind) {
  if (kind === "video") {
    return text(node.data?.videoModelId) || text(node.data?.videoModel);
  }
  return text(node.data?.[`${kind}ModelId`]);
}

function parametersFor(node: WorkflowSemanticNode, kind: NodeInputKind) {
  const value = node.data?.[`${kind}Parameters`];
  return value && typeof value === "object" && !Array.isArray(value)
    ? stableValue(value) as Record<string, ModelParameterValue>
    : {};
}

export function isFrozenWorkflowExecutable(
  node: WorkflowSemanticNode,
  hasIncomingText: boolean,
) {
  const kind = nodeKind(node.type);
  if (!kind) return false;
  return node.data?.[`${kind}PromptReady`] === true &&
    (promptFor(node, kind).length > 0 || (kind !== "text" && hasIncomingText));
}

export function compileFrozenWorkflowSemanticPlan(input: {
  edges: readonly WorkflowSemanticEdge[];
  groupId: string;
  nodes: readonly WorkflowSemanticNode[];
}) {
  const children = input.nodes.filter((node) => node.parentId === input.groupId);
  const childIds = new Set(children.map(({ id }) => id));
  const incomingText = new Set(
    input.edges.flatMap((edge) => {
      const source = input.nodes.find((node) => node.id === edge.source);
      return childIds.has(edge.target) && source?.type === "text" ? [edge.target] : [];
    }),
  );
  const executable = children.filter((node) =>
    isFrozenWorkflowExecutable(node, incomingText.has(node.id))
  );
  const executableIds = new Set(executable.map(({ id }) => id));
  if (executable.length === 0) throw new Error("整组没有可执行生成节点");

  const relevantEdges = input.edges.filter((edge) =>
    executableIds.has(edge.target) &&
    (executableIds.has(edge.source) || input.nodes.some((node) => node.id === edge.source))
  ).map((edge, index) => ({
    id: edge.id,
    inputOrder: Number.isSafeInteger(edge.data?.inputOrder) &&
        Number(edge.data?.inputOrder) >= 1
      ? Number(edge.data?.inputOrder)
      : index + 1,
    ...(typeof edge.data?.inputRole === "string"
      ? { inputRole: edge.data.inputRole }
      : {}),
    source: edge.source,
    target: edge.target,
  })).sort((left, right) => left.id.localeCompare(right.id));

  const parents = new Map(executable.map(({ id }) => [id, new Set<string>()]));
  for (const edge of relevantEdges) {
    if (executableIds.has(edge.source) && executableIds.has(edge.target)) {
      parents.get(edge.target)?.add(edge.source);
    }
  }
  const remaining = new Set(executableIds);
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) =>
      [...(parents.get(id) ?? [])].every((parent) => !remaining.has(parent))
    ).sort();
    if (ready.length === 0) throw new Error("工作流存在循环依赖");
    for (const id of ready) {
      remaining.delete(id);
      ordered.push(id);
    }
  }

  const nodePlans = ordered.map((id, planIndex) => {
    const node = executable.find((candidate) => candidate.id === id)!;
    const kind = nodeKind(node.type)!;
    const semantic = {
      dependencies: [...(parents.get(id) ?? [])].sort(),
      id,
      kind,
      modelId: modelFor(node, kind),
      ownPrompt: promptFor(node, kind),
      parameters: parametersFor(node, kind),
      planIndex,
    };
    if (!semantic.modelId) throw new Error(`节点 ${id} 没有已选择的模型`);
    return Object.freeze({
      ...semantic,
      semanticIdentity: workflowSemanticDigest(semantic),
    });
  });

  const externalIds = new Set(relevantEdges
    .filter((edge) => !executableIds.has(edge.source))
    .map((edge) => edge.source));
  const externalNodes = input.nodes.filter((node) => externalIds.has(node.id))
    .map((node) => {
      const kind = nodeKind(node.type);
      if (!kind) throw new Error(`上游节点 ${node.id} 类型不受支持`);
      return {
        ...(kind === "text" && text(node.data?.content)
          ? { content: text(node.data?.content) }
          : {}),
        ...(kind !== "text" && text(node.data?.assetId)
          ? { assetId: text(node.data?.assetId) }
          : {}),
        id: node.id,
        ...(typeof node.data?.inputState === "string"
          ? { inputState: node.data.inputState }
          : {}),
        kind,
      };
    }).sort((left, right) => left.id.localeCompare(right.id));

  const identity = {
    edges: relevantEdges,
    executableNodeIds: ordered,
    externalNodes,
    groupId: input.groupId,
    nodes: nodePlans,
    version: 1 as const,
  };
  return Object.freeze({
    ...identity,
    semanticFingerprint: workflowSemanticDigest(identity),
  }) satisfies FrozenWorkflowSemanticPlan;
}
