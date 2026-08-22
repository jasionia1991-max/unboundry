import {
  defaultParameterValues,
  referenceSetsForValues,
  seedance2ReferenceMediaRules,
  type ModelParameterCondition,
  type ModelReferenceMediaRule,
  type ModelReferenceMediaRules,
  type ModelParameterSchema,
  type ModelParameterValue,
} from "./modelParameters";
import {
  generationCapabilityKinds,
  type GenerationCapabilityKind,
} from "./nodeVocabulary";

export const nodeInputKinds = generationCapabilityKinds;
export type NodeInputKind = GenerationCapabilityKind;
export type NodeInputState =
  | "empty"
  | "uploading"
  | "ready"
  | "invalid"
  | "missing";
export type NodeInputCompatibility = "blocked" | "compatible";

export type NodeInputRole =
  | "instruction"
  | "first-frame"
  | "last-frame"
  | "subject"
  | "reference-image"
  | "reference-video"
  | "reference-audio"
  | "context-text"
  | "context-image"
  | "context-video"
  | "context-audio";

export type ResolvedNodeInput = {
  assetId?: string;
  byteSize?: number;
  compatibility: NodeInputCompatibility;
  contentType?: string;
  durationSeconds?: number;
  edgeId: string;
  /** Whether an empty Text source has an instruction waiting to be run. */
  hasGenerationPrompt?: boolean;
  kind: NodeInputKind;
  mediaHeight?: number;
  mediaWidth?: number;
  metadataStatus?: "failed" | "pending" | "ready";
  order: number;
  preview?: string;
  reason?: string;
  role: NodeInputRole;
  sourceNodeId: string;
  state: NodeInputState;
  storageBackend?: "local" | "oss";
  summary: string;
  /** Full upstream text used for prompt composition. Never persisted in task snapshots. */
  text?: string;
  title: string;
  waveform?: number[];
};

export type NodeInputSnapshot = {
  assetId?: string;
  kind: NodeInputKind;
  order: number;
  role: NodeInputRole;
  sourceNodeId: string;
};

export type NodeInputProblem = {
  code:
    | "EMPTY"
    | "UPLOADING"
    | "INVALID"
    | "MISSING"
    | "GRAPH_INVALID"
    | "MODEL_UNAVAILABLE"
    | "MODEL_UNSUPPORTED"
    | "COMBINATION_UNSUPPORTED"
    | "ORDER_INVALID"
    | "PROMPT_MISSING"
    | "QUANTITY_EXCEEDED"
    | "REQUIRED_MISSING"
    | "ROLE_CONFLICT"
    | "ROLE_UNSUPPORTED";
  edgeId?: string;
  message: string;
};

export type NodeInputPreflight = {
  canSubmit: boolean;
  finalPrompt: string;
  inputs: ResolvedNodeInput[];
  problems: NodeInputProblem[];
  snapshot: NodeInputSnapshot[];
};

const modelSwitchBlockingCodes = new Set<NodeInputProblem["code"]>([
  "COMBINATION_UNSUPPORTED",
  "MODEL_UNSUPPORTED",
  "QUANTITY_EXCEEDED",
  "ROLE_CONFLICT",
  "ROLE_UNSUPPORTED",
]);

export function blockedModelSwitchProblem(
  preflight: NodeInputPreflight,
  schema: ModelParameterSchema,
) {
  return schema.inputPolicy?.switchPolicy === "block-switch"
    ? preflight.problems.find((problem) =>
        modelSwitchBlockingCodes.has(problem.code),
      )
    : undefined;
}

function referenceFileRuleProblem(
  item: ResolvedNodeInput,
  rule: ModelReferenceMediaRule,
): string | undefined {
  const mediaFormatLabel = (contentType: string) => {
    if (contentType === "audio/mpeg") return "MP3";
    if (contentType === "audio/wav") return "WAV";
    if (contentType === "video/mp4") return "MP4";
    if (contentType === "image/png") return "PNG";
    return contentType;
  };
  if (!rule.contentTypes.includes(item.contentType!)) {
    return item.kind === "audio"
      ? `不是当前模型支持的${rule.contentTypes.map(mediaFormatLabel).join("或")}格式`
      : "格式不受当前模型支持";
  }
  if (item.byteSize! > rule.maxBytes) {
    return item.kind === "video"
      ? `超过单个参考视频${Math.round(rule.maxBytes / (1024 * 1024))}MB上限`
      : item.kind === "audio"
        ? `超过单个参考音频${Math.round(rule.maxBytes / (1024 * 1024))}MB上限`
        : "超过本项目图片安全上限";
  }
  const width = item.mediaWidth;
  const height = item.mediaHeight;
  const dimensionFields = [
    rule.maxAspectRatio,
    rule.maxHeight,
    rule.maxPixelCount,
    rule.maxWidth,
    rule.minAspectRatio,
    rule.minHeight,
    rule.minPixelCount,
    rule.minWidth,
  ];
  if (dimensionFields.some((value) => value !== undefined)) {
    const label = item.kind === "video" ? "参考视频" : "参考图片";
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width! < 1 ||
      height! < 1
    ) {
      return `${label}分辨率尚未经过服务端校验，请重新上传`;
    }
    const trustedWidth = width!;
    const trustedHeight = height!;
    if (rule.minWidth !== undefined && trustedWidth < rule.minWidth) {
      return `${label}宽度需至少${rule.minWidth}px`;
    }
    if (rule.maxWidth !== undefined && trustedWidth > rule.maxWidth) {
      return `${label}宽度需不超过${rule.maxWidth}px`;
    }
    if (rule.minHeight !== undefined && trustedHeight < rule.minHeight) {
      return `${label}高度需至少${rule.minHeight}px`;
    }
    if (rule.maxHeight !== undefined && trustedHeight > rule.maxHeight) {
      return `${label}高度需不超过${rule.maxHeight}px`;
    }
    const pixels = trustedWidth * trustedHeight;
    if (rule.minPixelCount !== undefined && pixels < rule.minPixelCount) {
      return item.kind === "video"
        ? `分辨率过低，总像素需至少${rule.minPixelCount}（例如640×640或1280×720）`
        : `${label}总像素需至少${rule.minPixelCount}`;
    }
    if (rule.maxPixelCount !== undefined && pixels > rule.maxPixelCount) {
      return `${label}总像素需不超过${rule.maxPixelCount}`;
    }
    const aspectRatio = trustedWidth / trustedHeight;
    if (rule.minAspectRatio !== undefined && aspectRatio < rule.minAspectRatio) {
      return `${label}宽高比需至少${rule.minAspectRatio}`;
    }
    if (rule.maxAspectRatio !== undefined && aspectRatio > rule.maxAspectRatio) {
      return `${label}宽高比需不超过${rule.maxAspectRatio}`;
    }
  }
  if (item.kind === "video" || item.kind === "audio") {
    const minimum = rule.minDurationSeconds ?? 0;
    const maximum =
      rule.maxDurationSeconds ?? Number.POSITIVE_INFINITY;
    if (
      (rule.minDurationSeconds !== undefined ||
        rule.maxDurationSeconds !== undefined) &&
      (!Number.isFinite(item.durationSeconds) ||
        item.durationSeconds! < minimum ||
        item.durationSeconds! > maximum)
    ) {
      const label = rule.minDurationSeconds !== undefined &&
          rule.maxDurationSeconds !== undefined
        ? `${rule.minDurationSeconds}至${rule.maxDurationSeconds}秒之间`
        : rule.minDurationSeconds !== undefined
          ? `至少${rule.minDurationSeconds}秒`
          : `不超过${rule.maxDurationSeconds}秒`;
      return `时长必须在${label}`;
    }
  }
  return undefined;
}

type GraphNode = {
  data?: Record<string, unknown>;
  id: string;
  type?: string;
};

type GraphEdge = {
  data?: Record<string, unknown>;
  id: string;
  source: string;
  target: string;
};

/** Product decision: 11 allowed pairs and 5 forbidden pairs. */
export const NODE_INPUT_MATRIX: Record<NodeInputKind, readonly NodeInputKind[]> = {
  text: ["text", "image", "video", "audio"],
  image: ["text", "image"],
  video: ["text", "image", "video", "audio"],
  audio: ["text"],
};

export function isNodeInputKind(value: unknown): value is NodeInputKind {
  return nodeInputKinds.includes(value as NodeInputKind);
}

export function isNodeInputConnectionAllowed(
  source: unknown,
  target: unknown,
): boolean {
  return isNodeInputKind(source) && isNodeInputKind(target)
    ? NODE_INPUT_MATRIX[target].includes(source)
    : true;
}

export function defaultNodeInputRole(
  source: NodeInputKind,
  target: NodeInputKind,
): NodeInputRole {
  if (source === "text") return target === "text" ? "context-text" : "instruction";
  return `${target === "text" ? "context" : "reference"}-${source}` as NodeInputRole;
}

function conditionMatches(
  condition: ModelParameterCondition,
  parameters: Record<string, ModelParameterValue>,
) {
  const current = parameters[condition.key];
  switch (condition.operator) {
    case "equals": return current === condition.value;
    case "notEquals": return current !== condition.value;
    case "in": return condition.values?.includes(current) ?? false;
    case "notIn": return !(condition.values?.includes(current) ?? false);
    case "truthy": return Boolean(current);
    case "falsy": return !current;
  }
}

function activeRolePolicy(
  schema: ModelParameterSchema | undefined,
  parameters: Record<string, ModelParameterValue>,
) {
  return schema?.inputPolicy?.rolePolicies?.find((policy) =>
    (policy.enabledWhen ?? []).every((condition) =>
      conditionMatches(condition, parameters)),
  );
}

export function availableNodeInputRoles(input: {
  kind: NodeInputKind;
  modelSchema?: ModelParameterSchema;
  parameters?: Record<string, ModelParameterValue>;
  targetKind: NodeInputKind;
}): NodeInputRole[] {
  const parameters = input.parameters ?? (input.modelSchema
    ? defaultParameterValues(input.modelSchema)
    : {});
  const active = activeRolePolicy(input.modelSchema, parameters);
  const configured = active && Object.prototype.hasOwnProperty.call(active.roles, input.kind)
    ? active.roles[input.kind]
    : input.modelSchema?.inputPolicy?.roles?.[input.kind];
  return (configured?.length
    ? configured
    : active && Object.prototype.hasOwnProperty.call(active.roles, input.kind)
      ? []
      : [defaultNodeInputRole(input.kind, input.targetKind)]) as NodeInputRole[];
}

export function nodeInputRoleName(role: string) {
  const labels = {
    "context-audio": "音频上下文",
    "context-image": "图片上下文",
    "context-text": "文字上下文",
    "context-video": "视频上下文",
    "first-frame": "首帧",
    instruction: "生成指令",
    "last-frame": "尾帧",
    "reference-audio": "参考音频",
    "reference-image": "普通参考图",
    "reference-video": "普通参考视频",
    subject: "主体",
  } satisfies Record<NodeInputRole, string>;
  return labels[role as NodeInputRole] ?? role;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stateFor(node: GraphNode, kind: NodeInputKind): NodeInputState {
  const data = node.data ?? {};
  const explicit = data.inputState ?? data.uploadState;
  // `ready` is derived from durable content. A canvas document is browser-owned,
  // so an explicit flag must never turn empty content into a server-ready input.
  if (["empty", "uploading", "invalid", "missing"].includes(String(explicit))) {
    return explicit as NodeInputState;
  }
  if (data[`${kind}Generating`] === true) {
    return "uploading";
  }
  if (kind === "text") return text(data.content) ? "ready" : "empty";
  if (text(data.inputStateReason) || text(data[`${kind}GenerationError`])) {
    return "invalid";
  }
  const preview = text(
    kind === "image" ? data.imageSrc : kind === "video" ? data.videoSrc : data.audioSrc,
  );
  if (data.assetId && preview) return "ready";
  if (text(data[`${kind}GenerationError`])) return "invalid";
  if (data.assetId || preview) return "invalid";
  return "empty";
}

function generationErrorFor(node: GraphNode, kind: NodeInputKind) {
  const data = node.data ?? {};
  return kind === "text"
    ? text(data.inputStateReason)
    : text(data.inputStateReason) || text(data[`${kind}GenerationError`]);
}

/**
 * New references append after the greatest durable order instead of using the
 * current edge count. This keeps order unique after a lower card is removed.
 */
export function nextNodeInputOrder(
  edges: readonly GraphEdge[],
  targetId: string,
) {
  const incoming = edges.filter((edge) => edge.target === targetId);
  const maximum = incoming.reduce((current, edge, index) => {
    const raw = edge.data?.inputOrder;
    const order = Number.isSafeInteger(raw) && Number(raw) >= 1
      ? Number(raw)
      : index + 1;
    return Math.max(current, order);
  }, 0);
  return maximum + 1;
}

/**
 * Moves one durable input reference without changing the graph topology.
 * Orders are compacted after every move so a later delete/undo/reload cannot
 * leave duplicate or ambiguous positions behind.
 */
export function moveNodeInputEdge<T extends GraphEdge>(
  edges: readonly T[],
  targetId: string,
  edgeId: string,
  direction: "backward" | "forward",
): T[] {
  const incoming = edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.target === targetId)
    .sort((left, right) => {
      const leftOrder = Number(left.edge.data?.inputOrder);
      const rightOrder = Number(right.edge.data?.inputOrder);
      const safeLeft = Number.isSafeInteger(leftOrder) && leftOrder >= 1
        ? leftOrder
        : left.index + 1;
      const safeRight = Number.isSafeInteger(rightOrder) && rightOrder >= 1
        ? rightOrder
        : right.index + 1;
      return safeLeft - safeRight || left.index - right.index;
    });
  const currentIndex = incoming.findIndex(({ edge }) => edge.id === edgeId);
  const nextIndex = direction === "backward" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= incoming.length) {
    return [...edges];
  }
  [incoming[currentIndex], incoming[nextIndex]] = [
    incoming[nextIndex],
    incoming[currentIndex],
  ];
  const orders = new Map(
    incoming.map(({ edge }, index) => [edge.id, index + 1]),
  );
  return edges.map((edge) => edge.target === targetId && orders.has(edge.id)
    ? {
        ...edge,
        data: {
          ...edge.data,
          inputOrder: orders.get(edge.id),
        },
      }
    : edge);
}

function summaryFor(node: GraphNode, kind: NodeInputKind) {
  const data = node.data ?? {};
  if (kind === "text") return text(data.content).slice(0, 120);
  if (kind === "audio") {
    const duration = Number(
      data.mediaMetadataSource === "server"
        ? data.mediaDurationSeconds
        : data.audioDuration,
    );
    return Number.isFinite(duration) && duration > 0
      ? `音频 · ${Math.round(duration)} 秒`
      : "音频素材";
  }
  if (kind === "video") {
    const duration = Number(
      data.mediaMetadataSource === "server"
        ? data.mediaDurationSeconds
        : data.videoDuration,
    );
    return Number.isFinite(duration) && duration > 0
      ? `视频 · ${Math.round(duration)} 秒`
      : "视频素材";
  }
  return "图片素材";
}

function modelLimit(
  schema: ModelParameterSchema | undefined,
  kind: NodeInputKind,
  parameters: Record<string, ModelParameterValue>,
) {
  const upstream = schema?.upstreamInputs?.[kind];
  if (upstream) {
    if (!upstream.supported) return 0;
    return upstream.limitMode === "fixed" ? upstream.maxCount ?? 0 : Number.POSITIVE_INFINITY;
  }
  if (kind === "text") return Number.POSITIVE_INFINITY;
  if (schema?.referencePolicy) {
    return Math.max(
      0,
      ...referenceSetsForValues(schema, parameters).map(
        (set) => set[kind as "audio" | "image" | "video"],
      ),
    );
  }
  return schema?.referenceInputs[kind as "audio" | "image" | "video"] ?? Number.POSITIVE_INFINITY;
}

export function resolveNodeInputs(input: {
  edges: readonly GraphEdge[];
  mediaInputPolicy?: "seedance-2";
  modelSchema?: ModelParameterSchema;
  nodes: readonly GraphNode[];
  ownPrompt?: string;
  parameters?: Record<string, ModelParameterValue>;
  targetId: string;
  targetKind: NodeInputKind;
}): NodeInputPreflight {
  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  const problems: NodeInputProblem[] = [];
  const parameters = input.parameters ?? (input.modelSchema
    ? defaultParameterValues(input.modelSchema)
    : {});
  const incomingEdges = input.edges.filter((edge) => edge.target === input.targetId);
  const inputs = incomingEdges
    .map((edge, index): ResolvedNodeInput => {
      const source = byId.get(edge.source);
      if (!source) {
        const configuredRole = edge.data?.inputRole;
        const configuredOrder = Number(edge.data?.inputOrder);
        return {
          compatibility: "blocked",
          edgeId: edge.id,
          kind: "text",
          order: Number.isSafeInteger(configuredOrder) && configuredOrder >= 1
            ? configuredOrder
            : index + 1,
          reason: "来源节点已不存在",
          role: typeof configuredRole === "string"
            ? configuredRole as NodeInputRole
            : "instruction",
          sourceNodeId: edge.source,
          state: "missing",
          summary: "无法找到来源节点",
          title: "缺失的来源",
        };
      }
      const kind = isNodeInputKind(source.type) ? source.type : "text";
      const allowed = isNodeInputKind(source.type) &&
        isNodeInputConnectionAllowed(source.type, input.targetKind);
      const state = !isNodeInputKind(source.type)
        ? "invalid"
        : stateFor(source, kind);
      const sourceData = source.data ?? {};
      const trustedMetadata = sourceData.mediaMetadataSource === "server";
      const configuredRole = edge.data?.inputRole;
      const generationError = generationErrorFor(source, kind);
      return {
        assetId: kind === "text" ? undefined : text(sourceData.assetId) || undefined,
        byteSize: trustedMetadata && Number.isSafeInteger(sourceData.mediaByteSize)
          ? Number(sourceData.mediaByteSize)
          : undefined,
        compatibility: allowed ? "compatible" : "blocked",
        contentType: trustedMetadata
          ? text(sourceData.mediaContentType) || undefined
          : undefined,
        durationSeconds: trustedMetadata && Number.isFinite(Number(sourceData.mediaDurationSeconds))
          ? Number(sourceData.mediaDurationSeconds)
          : undefined,
        edgeId: edge.id,
        hasGenerationPrompt: kind === "text"
          ? Boolean(text(sourceData.textPrompt))
          : undefined,
        kind,
        mediaHeight: trustedMetadata &&
            (kind === "image" || kind === "video") &&
            Number.isSafeInteger(sourceData.mediaHeight) &&
            Number(sourceData.mediaHeight) > 0
          ? Number(sourceData.mediaHeight)
          : undefined,
        mediaWidth: trustedMetadata &&
            (kind === "image" || kind === "video") &&
            Number.isSafeInteger(sourceData.mediaWidth) &&
            Number(sourceData.mediaWidth) > 0
          ? Number(sourceData.mediaWidth)
          : undefined,
        metadataStatus: trustedMetadata &&
            (sourceData.mediaMetadataStatus === "ready" ||
              sourceData.mediaMetadataStatus === "pending" ||
              sourceData.mediaMetadataStatus === "failed")
          ? sourceData.mediaMetadataStatus
          : undefined,
        order: Number.isFinite(Number(edge.data?.inputOrder))
          ? Number(edge.data?.inputOrder)
          : index + 1,
        preview: text(
          kind === "image"
            ? sourceData.imageSrc
            : kind === "video"
              ? sourceData.videoSrc
              : kind === "audio"
                ? sourceData.audioSrc
                : undefined,
        ) || undefined,
        reason: allowed
          ? generationError || undefined
          : `不允许 ${kind} 连接到 ${input.targetKind}`,
        role: typeof configuredRole === "string"
          ? configuredRole as NodeInputRole
          : defaultNodeInputRole(kind, input.targetKind),
        sourceNodeId: source.id,
        state: allowed ? state : "invalid",
        storageBackend: trustedMetadata &&
            (sourceData.mediaStorageBackend === "local" || sourceData.mediaStorageBackend === "oss")
          ? sourceData.mediaStorageBackend
          : undefined,
        summary: summaryFor(source, kind),
        text: kind === "text" ? text(sourceData.content) || undefined : undefined,
        title: text(sourceData.title) || text(sourceData.label) || kind,
        waveform: Array.isArray(sourceData.audioWaveform)
          ? sourceData.audioWaveform.filter((value): value is number => Number.isFinite(value)).slice(0, 32)
          : undefined,
      };
    })
    .sort((a, b) => a.order - b.order);

  const rolePolicy = activeRolePolicy(input.modelSchema, parameters);
  for (const kind of nodeInputKinds) {
    const assignment = rolePolicy?.assignment?.[kind];
    if (!assignment?.length) continue;
    inputs
      .filter((item) => item.kind === kind && item.state !== "missing")
      .forEach((item, index) => {
        const edge = incomingEdges.find((candidate) => candidate.id === item.edgeId);
        const baseline = defaultNodeInputRole(kind, input.targetKind);
        if (
          assignment[index] &&
          (edge?.data?.inputRole === undefined || edge.data.inputRole === baseline)
        ) {
          item.role = assignment[index] as NodeInputRole;
        }
      });
  }

  const blockInputs = (
    affected: readonly ResolvedNodeInput[],
    message: string,
  ) => {
    for (const item of affected) {
      item.compatibility = "blocked";
      item.reason ??= message;
    }
  };

  const seenEdgeIds = new Set<string>();
  const seenSources = new Set<string>();
  for (const edge of incomingEdges) {
    const duplicatedId = seenEdgeIds.has(edge.id);
    const duplicatedSource = seenSources.has(edge.source);
    seenEdgeIds.add(edge.id);
    seenSources.add(edge.source);
    if (edge.source !== input.targetId && !duplicatedId && !duplicatedSource) {
      continue;
    }
    const message = edge.source === input.targetId
      ? "节点不能把自己作为上游，引用已保留"
      : duplicatedId
        ? "输入连线编号重复，引用已保留"
        : "同一来源不能重复引用，引用已保留";
    const affected = inputs.filter((item) =>
      item.edgeId === edge.id || (duplicatedSource && item.sourceNodeId === edge.source));
    blockInputs(affected, message);
    problems.push({ code: "GRAPH_INVALID", edgeId: edge.id, message });
  }

  for (const item of inputs) {
    if (item.state === "empty") {
      const message = item.kind === "text"
        ? item.hasGenerationPrompt
          ? `${item.title}还没有生成正文，请先运行该文字节点`
          : `${item.title}还没有正文：可双击填写母版，或输入文字生成指令后运行`
        : `${item.title}还没有可用内容`;
      blockInputs([item], message);
      problems.push({ code: "EMPTY", edgeId: item.edgeId, message });
    }
    if (item.state === "uploading") {
      const message = item.kind === "text"
        ? `${item.title}正在生成正文，完成后才能运行本节点`
        : `${item.title}仍在上传或生成中`;
      blockInputs([item], message);
      problems.push({ code: "UPLOADING", edgeId: item.edgeId, message });
    }
    if (item.state === "invalid") {
      const message = item.reason ?? `${item.title}不可用`;
      blockInputs([item], message);
      problems.push({ code: "INVALID", edgeId: item.edgeId, message });
    }
    if (item.state === "missing") {
      const message = `${item.title}已缺失`;
      blockInputs([item], message);
      problems.push({ code: "MISSING", edgeId: item.edgeId, message });
    }
  }

  const usedOrders = new Set<number>();
  for (const item of inputs) {
    const edge = incomingEdges.find((candidate) => candidate.id === item.edgeId);
    const rawOrder = edge?.data?.inputOrder;
    if (
      rawOrder !== undefined &&
      (!Number.isSafeInteger(rawOrder) || Number(rawOrder) < 1)
    ) {
      const message = `${item.title}的输入顺序无效，引用已保留`;
      blockInputs([item], message);
      problems.push({
        code: "ORDER_INVALID",
        edgeId: item.edgeId,
        message,
      });
    } else if (usedOrders.has(item.order)) {
      const message = `${item.title}的输入顺序重复，引用已保留`;
      blockInputs([item], message);
      problems.push({
        code: "ORDER_INVALID",
        edgeId: item.edgeId,
        message,
      });
    } else {
      usedOrders.add(item.order);
    }

    const rawRole = edge?.data?.inputRole;
    const allowedRoles = availableNodeInputRoles({
      kind: item.kind,
      modelSchema: input.modelSchema,
      parameters,
      targetKind: input.targetKind,
    });
    const structurallyValid = rawRole === undefined || (
      typeof rawRole === "string" && /^[a-z][a-z-]{0,39}$/.test(rawRole)
    );
    const roleAllowed = allowedRoles.includes(item.role);
    if (!structurallyValid || !roleAllowed) {
      const message = `当前模型不支持${item.kind}输入角色${item.role}，引用已保留`;
      blockInputs([item], message);
      problems.push({
        code: "ROLE_UNSUPPORTED",
        edgeId: item.edgeId,
        message,
      });
    }
  }

  for (const limit of rolePolicy?.limits ?? []) {
    const matching = inputs.filter((item) =>
      item.kind === limit.kind &&
      item.role === limit.role &&
      item.state !== "missing" &&
      isNodeInputConnectionAllowed(item.kind, input.targetKind));
    if (matching.length > limit.maxCount) {
      const roleName = nodeInputRoleName(limit.role);
      const message = `${roleName}角色最多允许${limit.maxCount}个，引用已保留`;
      blockInputs(matching.slice(limit.maxCount), message);
      problems.push({
        code: "ROLE_CONFLICT",
        edgeId: matching[limit.maxCount]?.edgeId,
        message,
      });
    }
    const readyCount = matching.filter((item) => item.state === "ready").length;
    if (readyCount < limit.minCount) {
      problems.push({
        code: "ROLE_CONFLICT",
        message: `当前模式至少需要${limit.minCount}个${nodeInputRoleName(limit.role)}输入`,
      });
    }
  }

  for (const kind of nodeInputKinds) {
    // Baseline-forbidden and missing-source edges already have an exact problem;
    // they must not produce a second, misleading model-limit problem or satisfy
    // a model's required-count rule.
    const items = inputs.filter((item) =>
      item.kind === kind &&
      item.state !== "missing" &&
      isNodeInputConnectionAllowed(item.kind, input.targetKind) &&
      !problems.some((problem) =>
        problem.edgeId === item.edgeId &&
        ["GRAPH_INVALID", "ROLE_CONFLICT", "ROLE_UNSUPPORTED"].includes(problem.code))
    );
    const limit = modelLimit(input.modelSchema, kind, parameters);
    if (items.length && limit === 0) {
      const message = `当前模型不支持${kind}类型上游，引用已保留`;
      blockInputs(items, message);
      for (const item of items) {
        problems.push({ code: "MODEL_UNSUPPORTED", edgeId: item.edgeId, message });
      }
    } else if (Number.isFinite(limit) && items.length > limit) {
      const message = `当前模型最多支持${limit}个${kind}输入，引用已保留`;
      const exceeded = items.slice(limit);
      blockInputs(exceeded, message);
      for (const item of exceeded) {
        problems.push({ code: "QUANTITY_EXCEEDED", edgeId: item.edgeId, message });
      }
    }
    const required = input.modelSchema?.inputPolicy?.required?.[kind] ?? 0;
    if (items.filter((item) => item.state === "ready").length < required) {
      problems.push({ code: "REQUIRED_MISSING", message: `当前模型至少需要${required}个${kind}输入` });
    }
  }

  if (input.modelSchema?.referencePolicy) {
    const counts = {
      audio: inputs.filter((item) => item.kind === "audio" && !item.reason && item.state !== "missing").length,
      image: inputs.filter((item) => item.kind === "image" && !item.reason && item.state !== "missing").length,
      video: inputs.filter((item) => item.kind === "video" && !item.reason && item.state !== "missing").length,
    };
    const sets = referenceSetsForValues(input.modelSchema, parameters);
    const withinIndividualMaximums = (["audio", "image", "video"] as const)
      .every((kind) => counts[kind] <= Math.max(0, ...sets.map((set) => set[kind])));
    const matchesSet = sets.some((set) =>
      counts.audio <= set.audio &&
      counts.image <= set.image &&
      counts.video <= set.video
    );
    if (withinIndividualMaximums && !matchesSet) {
      const message = "当前模型和输入模式不支持这组素材组合，引用已保留";
      blockInputs(
        inputs.filter((item) => item.kind !== "text" && !item.reason),
        message,
      );
      problems.push({
        code: "COMBINATION_UNSUPPORTED",
        message,
      });
    }
  }

  const referenceMediaRules = input.modelSchema?.referenceMediaRules;
  if (referenceMediaRules && input.mediaInputPolicy !== "seedance-2") {
    const genericPolicyProblem = (item: ResolvedNodeInput, message: string) => {
      blockInputs([item], message);
      problems.push({ code: "INVALID", edgeId: item.edgeId, message });
    };
    const genericPolicyInputs = inputs.filter((item) =>
      item.kind !== "text" &&
      item.state === "ready" &&
      item.compatibility === "compatible");
    for (const item of genericPolicyInputs) {
      const rule = referenceMediaRules[item.kind as "audio" | "image" | "video"];
      if (!rule) continue;
      if (
        item.metadataStatus !== "ready" ||
        !Number.isSafeInteger(item.byteSize) ||
        !item.byteSize ||
        !item.contentType ||
        !item.storageBackend
      ) {
        genericPolicyProblem(item, `${item.title}正在等待服务端确认素材格式、大小和时长`);
        continue;
      }
      const fileProblem = referenceFileRuleProblem(item, rule);
      if (fileProblem) {
        genericPolicyProblem(item, `${item.title}${fileProblem}`);
      }
    }
  }
  if (input.mediaInputPolicy === "seedance-2") {
    const rules: ModelReferenceMediaRules =
      referenceMediaRules ?? seedance2ReferenceMediaRules;
    const policyProblem = (item: ResolvedNodeInput, message: string) => {
      blockInputs([item], message);
      problems.push({ code: "INVALID", edgeId: item.edgeId, message });
    };
    const policyInputs = inputs.filter((item) =>
      item.kind !== "text" &&
      item.state === "ready" &&
      item.compatibility === "compatible");
    const hasVisualReference = policyInputs.some((item) =>
      item.kind === "image" || item.kind === "video");
    let audioDuration = 0;
    let videoDuration = 0;
    const policyPrompt = [
      ...inputs
        .filter((item) => item.kind === "text" && item.state === "ready")
        .map((item) => item.text)
        .filter(Boolean),
      text(input.ownPrompt),
    ].filter(Boolean).join("\n\n");
    let base64Bytes = 32 * 1_024 +
      new TextEncoder().encode(policyPrompt).byteLength;
    for (const item of policyInputs) {
      const rule = rules[item.kind as "audio" | "image" | "video"];
      if (!rule) continue;
      if (
        item.metadataStatus !== "ready" ||
        !Number.isSafeInteger(item.byteSize) ||
        !item.byteSize ||
        !item.contentType ||
        !item.storageBackend
      ) {
        policyProblem(item, `${item.title}正在等待服务端确认素材格式、大小和时长`);
        continue;
      }
      const fileProblem = referenceFileRuleProblem(item, rule);
      if (fileProblem) {
        policyProblem(item, `${item.title}${fileProblem}`);
        continue;
      }
      if (item.kind === "video" || item.kind === "audio") {
        const durationRule = rule as {
          maxDurationSeconds?: number;
          maxTotalDurationSeconds?: number;
          minDurationSeconds?: number;
        };
        if (item.kind === "video") {
          videoDuration += item.durationSeconds!;
          if (
            durationRule.maxTotalDurationSeconds !== undefined &&
            videoDuration > durationRule.maxTotalDurationSeconds
          ) {
            policyProblem(
              item,
              `${item.title}使参考视频总时长超过${durationRule.maxTotalDurationSeconds}秒`,
            );
            continue;
          }
        } else {
          audioDuration += item.durationSeconds!;
          if (
            durationRule.maxTotalDurationSeconds !== undefined &&
            audioDuration > durationRule.maxTotalDurationSeconds
          ) {
            policyProblem(
              item,
              `${item.title}使参考音频总时长超过${durationRule.maxTotalDurationSeconds}秒`,
            );
            continue;
          }
        }
      }
      if (item.kind === "video" && item.storageBackend !== "oss") {
        policyProblem(item, `${item.title}还未存入可供视频模型读取的私有云端存储`);
        continue;
      }
      if (item.storageBackend === "local" && item.kind !== "video") {
        const prefix = item.kind === "image"
          ? "data:image/png;base64,"
          : item.contentType === "audio/wav"
            ? "data:audio/wav;base64,"
            : "data:audio/mp3;base64,";
        base64Bytes += prefix.length + Math.ceil(item.byteSize / 3) * 4;
        if (base64Bytes > 64 * 1_024 * 1_024) {
          policyProblem(item, `${item.title}使Base64提交内容超过64MB`);
        }
      }
    }
    if (
      rules.audioRequiresVisual === true &&
      audioDuration > 0 &&
      !hasVisualReference
    ) {
      const firstAudio = policyInputs.find((item) => item.kind === "audio");
      const message = "参考音频不能单独用于当前视频模型，请至少再连接一个图片或视频";
      if (firstAudio) policyProblem(firstAudio, message);
      else problems.push({ code: "INVALID", message });
    }
  }

  const upstreamText = inputs
    .filter((item) =>
      item.kind === "text" &&
      item.state === "ready" &&
      item.compatibility === "compatible" &&
      !item.reason)
    .map((item) => item.text)
    .filter(Boolean)
    .join("\n\n");
  const ownPrompt = text(input.ownPrompt);
  const upstreamTextMayReplaceOwn =
    input.targetKind === "video" || (
      input.targetKind === "text" &&
      input.modelSchema?.inputPolicy?.promptPolicy === "own-or-upstream-text"
    );
  // For Text targets, upstream Text is a separate context input. It must not be
  // silently folded into the user's instruction unless the model explicitly
  // allows that context to replace an empty target Prompt.
  const finalPrompt = input.targetKind === "text"
    ? ownPrompt || (upstreamTextMayReplaceOwn ? upstreamText : "")
    : [upstreamText, ownPrompt].filter(Boolean).join("\n\n");
  // A video Provider only receives the resolved final Prompt; it cannot tell
  // whether that text came from the Video textarea or a ready Text input edge.
  // Requiring both would make the Text edge redundant. Text targets retain
  // their model-specific policy because their upstream Text is context rather
  // than necessarily the instruction being executed.
  const ownPromptRequired =
    input.targetKind === "text" && !upstreamTextMayReplaceOwn;
  if ((ownPromptRequired && !ownPrompt) || (!ownPromptRequired && !finalPrompt)) {
    problems.push({
      code: "PROMPT_MISSING",
      message: ownPromptRequired
        ? "当前目标节点必须填写本节点Prompt"
        : "请填写本节点Prompt或连接有内容的Text节点",
    });
  }

  return {
    canSubmit: Boolean(finalPrompt) && problems.length === 0,
    finalPrompt,
    inputs,
    problems,
    snapshot: inputs.map(({ assetId, kind, order, role, sourceNodeId }) => ({
      assetId,
      kind,
      order,
      role,
      sourceNodeId,
    })),
  };
}
