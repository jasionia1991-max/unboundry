import type { ModelParameterValue } from "../../../types/modelParameters";
import {
  defaultParameterSchema,
  normalizeParameterValues,
  submissionParameterValues,
} from "../../../types/modelParameters";
import {
  defaultNodeInputRole,
  resolveNodeInputs,
  type NodeInputProblem,
} from "../../../types/nodeInputs";
import { NODE_DEFAULT_SIZES } from "../canvas/mediaGeometry";
import { trustedMediaPatch } from "../canvas/mediaInputMetadata";
import type { CanvasGraphSnapshot } from "../canvas/canvasPorts";
import {
  generationOwnershipKey,
  type ProbeNodeType,
} from "../canvas/ProbeNode";
import {
  resolvePublishedModelSelection,
  type PublishedModel,
} from "../models/ModelCatalog";
import {
  clearGenerationSubmissionIntent,
  ensureGenerationTask,
  GenerationRequestError,
  getGenerationTask,
  waitForGenerationTask,
  type GenerationTaskKind,
  type GenerationTaskSummary,
  type RecoverableGenerationInput,
} from "./generationTasks";
import {
  friendlyGenerationMessage,
  generationMessageFallback,
} from "./friendlyGenerationMessage";
import { groupRunResultKey } from "./groupRunCheckpoint";
import {
  groupResultProjectionApplicationId,
  groupResultSemanticRevision,
  type GroupResultProjection,
} from "./groupResultProjection";
import { shouldIgnoreStaleCanvasSaveProblem } from "./groupRunPersist";
import {
  generationFailureMessage,
  generationInputKey,
} from "./generationRetry";
import {
  NodeExecutorRegistry,
  type NodeExecutor,
  type NodeExecutorContext,
  type WorkflowExecutorKind,
} from "./nodeExecutorRegistry";
import { runExclusiveCanvasSubmit } from "./saveGate";
import {
  workflowModelSelectionProblem,
  workflowRuntimePreflightDisposition,
  workflowSubmissionPreflightProblem,
  type NodeRunResult,
  type WorkflowPreflightPhase,
} from "./workflowExecution";

type ExecutionPlan = {
  currentOwnershipKey: string;
  effectiveOwnershipKey: string;
  inputKey: string;
  inputs: ReturnType<typeof resolveNodeInputs>["inputs"];
  kind: WorkflowExecutorKind;
  model: PublishedModel;
  modelDisplayName: string;
  modelId: string;
  modelPatch: Record<string, unknown>;
  node: ProbeNodeType;
  normalizedParameters: Record<string, ModelParameterValue>;
  ownPrompt: string;
  problems: NodeInputProblem[];
  request: RecoverableGenerationInput;
};

const kindLabels: Record<WorkflowExecutorKind, string> = {
  audio: "音频",
  image: "图片",
  text: "文字",
  video: "视频",
};

function ownPrompt(node: ProbeNodeType, kind: WorkflowExecutorKind) {
  const value = kind === "text"
    ? node.data.textPrompt
    : kind === "image"
      ? node.data.imagePrompt
      : kind === "audio"
        ? node.data.audioPrompt
        : node.data.videoPrompt;
  return typeof value === "string" ? value : "";
}

function savedModel(node: ProbeNodeType, kind: WorkflowExecutorKind) {
  if (kind === "text") {
    return { id: node.data.textModelId, name: node.data.textModelName };
  }
  if (kind === "image") {
    return { id: node.data.imageModelId, name: node.data.imageModelName };
  }
  if (kind === "audio") {
    return { id: node.data.audioModelId, name: node.data.audioModelName };
  }
  return { id: node.data.videoModelId, name: node.data.videoModel };
}

function savedParameters(node: ProbeNodeType, kind: WorkflowExecutorKind) {
  return kind === "text"
    ? node.data.textParameters
    : kind === "image"
      ? node.data.imageParameters
      : kind === "audio"
        ? node.data.audioParameters
        : node.data.videoParameters;
}

function supportedImageValue(values: string[], preferred?: string) {
  if (preferred && values.includes(preferred)) return preferred;
  if (values.includes("auto")) return "auto";
  return values[0] ?? "auto";
}

function generationOwnershipUpstream(
  kind: WorkflowExecutorKind,
  inputs: ReturnType<typeof resolveNodeInputs>["inputs"],
  edges: CanvasGraphSnapshot["edges"],
) {
  return inputs.map((input) => {
    const edge = edges.find((candidate) => candidate.id === input.edgeId);
    return {
      assetId: input.kind === "text" ? undefined : input.assetId,
      edgeId: input.edgeId,
      metadataStatus: input.metadataStatus,
      order: input.order,
      ready: input.state === "ready",
      role: typeof edge?.data?.inputRole === "string"
        ? edge.data.inputRole
        : defaultNodeInputRole(input.kind, kind),
      source: input.sourceNodeId,
      sourceKind: input.kind,
      src: input.kind === "text" ? undefined : input.preview,
      status: input.state,
      text: input.kind === "text" ? input.text : undefined,
    };
  });
}

function createExecutionPlan(
  kind: WorkflowExecutorKind,
  nodeId: string,
  context: NodeExecutorContext,
): ExecutionPlan | NodeRunResult {
  const snapshot = context.graph.snapshot();
  const nodes = snapshot.nodes;
  const edges = snapshot.edges;
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.type !== kind) {
    return { message: "节点已不存在或类型已变化", status: "failed" };
  }
  const saved = savedModel(node, kind);
  const selection = resolvePublishedModelSelection({
    models: context.modelCatalog.models[kind],
    savedId: saved.id,
    savedName: saved.name,
    status: context.modelCatalog.status,
  });
  const modelProblem = workflowModelSelectionProblem({
    isFixture: context.isFixture,
    kind,
    model: selection.model,
    status: context.modelCatalog.status,
    unavailableReason: selection.unavailableReason,
  });
  if (!selection.model || !selection.selectedId) {
    return {
      errorCode: modelProblem?.code ?? "MODEL_UNAVAILABLE",
      message: modelProblem?.message ?? `${kindLabels[kind]}模型不可用`,
      status: "failed",
    };
  }
  const model = selection.model;
  const schema = model.parameterSchema ?? defaultParameterSchema(kind);
  const prompt = ownPrompt(node, kind);
  let normalized = normalizeParameterValues(
    schema,
    savedParameters(node, kind),
  );
  let inputSchema = schema;
  let modelPatch: Record<string, unknown>;
  if (kind === "image") {
    const imageOptions = model.imageParameters ?? {
      aspectRatios: ["auto"],
      maxReferenceImages: 0,
      qualities: ["auto"],
    };
    normalized = normalizeParameterValues(schema, {
      ...node.data.imageParameters,
      ...(node.data.imageAspectRatio
        ? { aspectRatio: node.data.imageAspectRatio }
        : {}),
      ...(node.data.imageQuality ? { quality: node.data.imageQuality } : {}),
    });
    const aspectRatio = supportedImageValue(
      imageOptions.aspectRatios,
      String(normalized.aspectRatio ?? node.data.imageAspectRatio ?? ""),
    );
    const quality = supportedImageValue(
      imageOptions.qualities,
      String(normalized.quality ?? node.data.imageQuality ?? ""),
    );
    normalized = { ...normalized, aspectRatio, quality };
    inputSchema = {
      ...schema,
      referenceInputs: {
        ...schema.referenceInputs,
        image: imageOptions.maxReferenceImages ?? 0,
      },
    };
    modelPatch = {
      imageAspectRatio: aspectRatio,
      imageModelId: selection.selectedId,
      imageModelName: selection.displayName,
      imageParameters: normalized,
      imageQuality: quality,
    };
  } else if (kind === "text") {
    modelPatch = {
      textModelId: selection.selectedId,
      textModelName: selection.displayName,
      textParameters: normalized,
    };
  } else if (kind === "audio") {
    modelPatch = {
      audioModelId: selection.selectedId,
      audioModelName: selection.displayName,
      audioParameters: normalized,
    };
  } else {
    modelPatch = {
      videoModel: selection.displayName,
      videoModelId: selection.selectedId,
      videoParameters: normalized,
    };
  }
  const submission = submissionParameterValues(schema, normalized);
  const inputPreflight = resolveNodeInputs({
    edges,
    mediaInputPolicy: kind === "video" ? model.mediaInputPolicy : undefined,
    modelSchema: inputSchema,
    nodes,
    ownPrompt: prompt,
    parameters: submission,
    targetId: nodeId,
    targetKind: kind,
  });
  const problems = [
    ...(modelProblem ? [modelProblem] : []),
    ...inputPreflight.problems,
  ];
  const inputKey = generationInputKey({
    inputs: inputPreflight.inputs,
    modelId: selection.selectedId,
    ownPrompt: prompt,
    parameters: submission,
    prompt: inputPreflight.finalPrompt,
  });
  const upstream = generationOwnershipUpstream(kind, inputPreflight.inputs, edges);
  const effectiveOwnershipValue = kind === "image"
    ? {
        aspectRatio: normalized.aspectRatio,
        modelId: selection.selectedId,
        parameters: normalized,
        prompt,
        quality: normalized.quality,
        upstream,
      }
    : { modelId: selection.selectedId, parameters: normalized, prompt, upstream };
  const boundOwnershipKey = node.data[`${kind}GenerationOwnershipKey`];
  const rawOwnershipValue = kind === "image"
    ? {
        aspectRatio: boundOwnershipKey
          ? node.data.imageAspectRatio
          : normalized.aspectRatio,
        modelId: boundOwnershipKey ? node.data.imageModelId : selection.selectedId,
        parameters: boundOwnershipKey ? node.data.imageParameters : normalized,
        prompt,
        quality: boundOwnershipKey ? node.data.imageQuality : normalized.quality,
        upstream,
      }
    : {
        modelId: boundOwnershipKey ? saved.id : selection.selectedId,
        parameters: boundOwnershipKey ? savedParameters(node, kind) : normalized,
        prompt,
        upstream,
      };
  const requestParameters = kind === "image"
    ? {
        ...submission,
        references: inputPreflight.inputs
          .filter((input) => input.kind === "image" && input.preview)
          .map((input) => ({
            assetId: input.assetId ?? "",
            kind: "image" as const,
            sourceNodeId: input.sourceNodeId,
          })),
      }
    : submission;
  return {
    currentOwnershipKey: generationOwnershipKey(rawOwnershipValue),
    effectiveOwnershipKey: generationOwnershipKey(effectiveOwnershipValue),
    inputKey,
    inputs: inputPreflight.inputs,
    kind,
    model,
    modelDisplayName: selection.displayName ?? model.displayName,
    modelId: selection.selectedId,
    modelPatch,
    node,
    normalizedParameters: normalized,
    ownPrompt: prompt,
    problems,
    request: {
      canvasId: context.canvasId,
      inputSchemaVersion: 1,
      inputs: inputPreflight.snapshot,
      model: selection.selectedId,
      nodeId,
      ownPrompt: prompt,
      parameters: requestParameters,
      prompt: inputPreflight.finalPrompt,
    },
  };
}

function isPlan(value: ExecutionPlan | NodeRunResult): value is ExecutionPlan {
  return "request" in value;
}

function createBoundRecoveryPlan(
  kind: WorkflowExecutorKind,
  nodeId: string,
  context: NodeExecutorContext,
): ExecutionPlan | NodeRunResult {
  const node = context.graph.snapshot().nodes.find((candidate) =>
    candidate.id === nodeId
  );
  if (!node || node.type !== kind) {
    return { message: "节点已不存在或类型已变化", status: "failed" };
  }
  const ownershipKey = node.data[`${kind}GenerationOwnershipKey`];
  const persistedInputKey = node.data[`${kind}GenerationInputKey`];
  if (
    node.data.workflowExecutionRunId !== context.runId ||
    typeof ownershipKey !== "string" ||
    !ownershipKey
  ) {
    return {
      message: "已有任务不再归属当前执行轮次，未自动重新提交",
      status: "failed",
    };
  }
  const saved = savedModel(node, kind);
  const prompt = ownPrompt(node, kind);
  return {
    currentOwnershipKey: ownershipKey,
    effectiveOwnershipKey: ownershipKey,
    inputKey: typeof persistedInputKey === "string" ? persistedInputKey : "",
    inputs: [],
    kind,
    model: {} as PublishedModel,
    modelDisplayName: saved.name ?? saved.id ?? "",
    modelId: saved.id ?? "",
    modelPatch: {},
    node,
    normalizedParameters: savedParameters(node, kind) ?? {},
    ownPrompt: prompt,
    problems: [],
    request: {
      canvasId: context.canvasId,
      inputSchemaVersion: 1,
      inputs: [],
      model: saved.id,
      nodeId,
      ownPrompt: prompt,
      parameters: savedParameters(node, kind) ?? {},
      prompt,
    },
  };
}

function taskMatches(
  task: GenerationTaskSummary,
  kind: WorkflowExecutorKind,
  canvasId: string,
  nodeId: string,
) {
  return task.kind === kind && task.canvasId === canvasId && task.nodeId === nodeId;
}

function taskIdFor(node: ProbeNodeType, kind: WorkflowExecutorKind) {
  const value = node.data[`${kind}GenerationTaskId`];
  return typeof value === "string" && value ? value : undefined;
}

export function workflowResultOwnerMatches(
  node: ProbeNodeType | undefined,
  input: {
    kind: WorkflowExecutorKind;
    ownershipKey: string;
    runId: string;
    taskId: string;
  },
) {
  return Boolean(
    node &&
    node.type === input.kind &&
    node.data.workflowExecutionRunId === input.runId &&
    taskIdFor(node, input.kind) === input.taskId &&
    node.data[`${input.kind}GenerationOwnershipKey`] === input.ownershipKey,
  );
}

function isGenerating(node: ProbeNodeType, kind: WorkflowExecutorKind) {
  return node.data[`${kind}Generating`] === true ||
    node.data.inputState === "uploading";
}

async function applyFencedNodeUpdate(input: {
  context: NodeExecutorContext;
  kind: WorkflowExecutorKind;
  nodeId: string;
  ownershipKey: string;
  taskId?: string;
  update: (node: ProbeNodeType) => ProbeNodeType;
}) {
  let snapshot = input.context.graph.snapshot();
  if (snapshot.revision === undefined) {
    const receipt = await input.context.save.waitForRevision();
    snapshot = input.context.graph.snapshot();
    if (snapshot.revision !== receipt.revision) {
      return { reason: "fence-rejected", status: "rejected" } as const;
    }
  }
  return input.context.graph.apply({
    fence: {
      expectedRevision: snapshot.revision,
      kind: input.kind,
      nodeId: input.nodeId,
      ownershipKey: input.ownershipKey,
      runId: input.context.runId,
      taskId: input.taskId,
    },
    scope: "generation",
    update: (current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === input.nodeId
        ? input.update(node)
        : node),
    }),
  });
}

function nodeOwnershipKey(
  node: ProbeNodeType,
  kind: WorkflowExecutorKind,
  fallback: string,
) {
  const value = node.data[`${kind}GenerationOwnershipKey`];
  return typeof value === "string" && value ? value : fallback;
}

function inputFailurePatch(kind: WorkflowExecutorKind, problem: NodeInputProblem) {
  return {
    [`${kind}GenerationError`]: problem.message,
    [`${kind}GenerationErrorCode`]: problem.code,
    [`${kind}GenerationInputKey`]: undefined,
    [`${kind}GenerationOwnershipKey`]: undefined,
    [`${kind}GenerationRetryAllowed`]: undefined,
    [`${kind}GenerationRetryBlockCode`]: undefined,
    [`${kind}GenerationRetryBlockReason`]: undefined,
    [`${kind}GenerationTaskId`]: undefined,
    [`${kind}Generating`]: false,
    workflowExecutionRunId: undefined,
  };
}

async function persistInputFailure(
  context: NodeExecutorContext,
  plan: ExecutionPlan,
  problem: NodeInputProblem,
) {
  if (shouldIgnoreStaleCanvasSaveProblem(problem)) {
    return { status: "success" as const };
  }
  const applied = await applyFencedNodeUpdate({
    context,
    kind: plan.kind,
    nodeId: plan.node.id,
    ownershipKey: nodeOwnershipKey(
      plan.node,
      plan.kind,
      plan.effectiveOwnershipKey,
    ),
    taskId: taskIdFor(plan.node, plan.kind),
    update: (node) => ({
      ...node,
      data: { ...node.data, ...inputFailurePatch(plan.kind, problem) },
    }),
  });
  if (applied.status !== "applied") {
    return {
      errorCode: "RESULT_OWNERSHIP_CONFLICT",
      message: "节点或画布已变化，未覆盖当前内容",
      status: "failed" as const,
    };
  }
  await context.save.flush();
  return {
    errorCode: problem.code,
    message: problem.message,
    status: "failed" as const,
  };
}

function bindingPatch(
  plan: ExecutionPlan,
  task: GenerationTaskSummary,
  ownershipKey: string,
  runId: string,
) {
  return {
    ...plan.modelPatch,
    [`${plan.kind}GenerationError`]: undefined,
    [`${plan.kind}GenerationErrorCode`]: undefined,
    [`${plan.kind}GenerationInputKey`]: plan.inputKey,
    [`${plan.kind}GenerationOwnershipKey`]: ownershipKey,
    [`${plan.kind}GenerationRetryAllowed`]: undefined,
    [`${plan.kind}GenerationRetryBlockCode`]: undefined,
    [`${plan.kind}GenerationRetryBlockReason`]: undefined,
    [`${plan.kind}GenerationTaskId`]: task.id,
    [`${plan.kind}Generating`]: true,
    groupRunSuccessOwnershipKey: undefined,
    groupRunSuccessResultKey: undefined,
    groupRunSuccessTaskId: undefined,
    workflowExecutionRunId: runId,
    ...(plan.kind === "image" ? { imageGeneratedSuccess: false } : {}),
  };
}

function failurePatch(
  kind: WorkflowExecutorKind,
  task: GenerationTaskSummary,
  message: string,
) {
  const visible = generationFailureMessage(
    message,
    task.retryAllowed ? undefined : task.retryBlockReason,
    task.errorCode,
    kind,
  );
  return {
    [`${kind}GenerationError`]: visible,
    [`${kind}GenerationErrorCode`]: task.errorCode,
    [`${kind}GenerationRetryAllowed`]: task.retryAllowed === true,
    [`${kind}GenerationRetryBlockCode`]: task.retryBlockCode,
    [`${kind}GenerationRetryBlockReason`]: task.retryBlockReason,
    [`${kind}GenerationTaskId`]: task.id,
    [`${kind}Generating`]: false,
    workflowExecutionRunId: undefined,
  };
}

function htmlForPlainText(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br>");
  return `<p>${escaped}</p>`;
}

function generatedAudioExtension(task: GenerationTaskSummary) {
  const storedExtension = task.resultAssetId?.split(".").at(-1)?.toLowerCase();
  if (["aac", "m4a", "mp3", "ogg", "wav"].includes(storedExtension ?? "")) {
    return storedExtension!;
  }
  return task.resultMedia?.contentType === "audio/ogg"
    ? "ogg"
    : task.resultMedia?.contentType === "audio/wav"
      ? "wav"
      : task.resultMedia?.contentType === "audio/mp4"
        ? "m4a"
        : task.resultMedia?.contentType === "audio/aac"
          ? "aac"
          : "mp3";
}

function successNodePatch(
  plan: ExecutionPlan,
  task: GenerationTaskSummary,
  ownershipKey: string,
) {
  const proof = {
    groupRunSuccessOwnershipKey: ownershipKey,
    groupRunSuccessResultKey: groupRunResultKey(
      plan.kind === "text"
        ? {
            content: task.resultText?.trim() ?? "",
            contentHtml: htmlForPlainText(task.resultText?.trim() ?? ""),
          }
        : task.resultUrl,
    ),
    groupRunSuccessTaskId: task.id,
    workflowExecutionRunId: undefined,
  };
  if (plan.kind === "text") {
    const content = task.resultText?.trim() ?? "";
    if (!content) throw new Error("文字结果不完整");
    return {
      data: {
        ...plan.modelPatch,
        ...proof,
        content,
        contentHtml: htmlForPlainText(content),
        textGenerationError: undefined,
        textGenerationErrorCode: undefined,
        textGenerationInputKey: undefined,
        textGenerationOwnershipKey: undefined,
        textGenerationRetryAllowed: undefined,
        textGenerationRetryBlockCode: undefined,
        textGenerationRetryBlockReason: undefined,
        textGenerationTaskId: task.id,
        textGenerating: false,
      },
    };
  }
  if (task.state !== "success" || !task.resultAssetId || !task.resultUrl) {
    throw new Error(`${kindLabels[plan.kind]}结果不完整`);
  }
  const metadata = task.resultMedia
    ? trustedMediaPatch({
        assetId: task.resultAssetId,
        kind: plan.kind,
        ...task.resultMedia,
      })
    : {};
  if (plan.kind === "image") {
    return {
      data: {
        ...plan.modelPatch,
        ...metadata,
        ...proof,
        assetId: task.resultAssetId,
        imageGeneratedSuccess: true,
        imageGenerationError: undefined,
        imageGenerationErrorCode: undefined,
        imageGenerationInputKey: undefined,
        imageGenerationOwnershipKey: undefined,
        imageGenerationRetryAllowed: undefined,
        imageGenerationRetryBlockCode: undefined,
        imageGenerationRetryBlockReason: undefined,
        imageGenerationTaskId: undefined,
        imageGenerating: false,
        imageSrc: task.resultUrl,
      },
      style: NODE_DEFAULT_SIZES.image,
    };
  }
  if (plan.kind === "audio") {
    return {
      data: {
        ...plan.modelPatch,
        ...metadata,
        ...proof,
        assetId: task.resultAssetId,
        audioDuration: task.resultMedia?.durationSeconds,
        audioFileSize: task.resultMedia?.byteSize,
        audioFileName: `${(plan.request.prompt || "生成音频").slice(0, 60)}.${generatedAudioExtension(task)}`,
        audioGeneratedResult: true,
        audioGenerationError: undefined,
        audioGenerationErrorCode: undefined,
        audioGenerationInputKey: undefined,
        audioGenerationOwnershipKey: undefined,
        audioGenerationRetryAllowed: undefined,
        audioGenerationRetryBlockCode: undefined,
        audioGenerationRetryBlockReason: undefined,
        audioGenerationTaskId: undefined,
        audioGenerating: false,
        audioPrompt: plan.request.prompt,
        audioResultChoices: task.resultOutputs?.map((output) => ({
          assetId: output.assetId,
          ...output.media,
          role: output.role,
          url: output.url,
        })),
        audioSrc: task.resultUrl,
        audioWaveform: undefined,
      },
      style: NODE_DEFAULT_SIZES.audio,
    };
  }
  return {
    data: {
      ...plan.modelPatch,
      ...metadata,
      ...proof,
      assetId: task.resultAssetId,
      videoAudioEnabled: plan.normalizedParameters.generateAudio !== false,
      videoCreatedAt: new Intl.DateTimeFormat("zh-CN").format(new Date()),
      videoGenerationError: undefined,
      videoGenerationErrorCode: undefined,
      videoGenerationInputKey: undefined,
      videoGenerationOwnershipKey: undefined,
      videoGenerationRetryAllowed: undefined,
      videoGenerationRetryBlockCode: undefined,
      videoGenerationRetryBlockReason: undefined,
      videoGenerationTaskId: undefined,
      videoGenerating: false,
      videoPrompt: plan.request.prompt,
      videoSrc: task.resultUrl,
    },
  };
}

async function applyTerminalTask(
  context: NodeExecutorContext,
  plan: ExecutionPlan,
  task: GenerationTaskSummary,
  ownershipKey: string,
): Promise<NodeRunResult> {
  if (!taskMatches(task, plan.kind, context.canvasId, plan.node.id)) {
    return { message: "生成任务关联不一致，已停止结果回写", status: "failed" };
  }
  const boundNode = context.graph.snapshot().nodes.find(
    (node) => node.id === plan.node.id,
  );
  if (!workflowResultOwnerMatches(boundNode, {
    kind: plan.kind,
    ownershipKey,
    runId: context.runId,
    taskId: task.id,
  })) {
    return {
      errorCode: "RESULT_OWNERSHIP_CONFLICT",
      message: "旧任务结果已保留在生成任务中，未覆盖当前节点或另一轮执行",
      status: "failed",
    };
  }
  if (task.state !== "success") {
    const message = task.errorMessage ?? `${kindLabels[plan.kind]}生成失败`;
    const applied = await applyFencedNodeUpdate({
      context,
      kind: plan.kind,
      nodeId: plan.node.id,
      ownershipKey,
      taskId: task.id,
      update: (node) => ({
        ...node,
        data: { ...node.data, ...failurePatch(plan.kind, task, message) },
      }),
    });
    if (applied.status !== "applied") {
      return {
        errorCode: "RESULT_OWNERSHIP_CONFLICT",
        message: "节点或画布已变化，未覆盖当前内容",
        status: "failed",
      };
    }
    clearGenerationSubmissionIntent(
      plan.kind,
      context.canvasId,
      plan.node.id,
      task.id,
      context.accountId,
    );
    return {
      errorCode: task.errorCode,
      message: friendlyGenerationMessage(message, plan.kind, task.errorCode),
      status: "failed",
    };
  }
  const current = createExecutionPlan(plan.kind, plan.node.id, context);
  if (
    !isPlan(current) ||
    current.currentOwnershipKey !== ownershipKey ||
    current.inputKey !== plan.inputKey
  ) {
    return {
      errorCode: "RESULT_OWNERSHIP_CONFLICT",
      message: "节点已变化，旧结果已保留在生成任务中，未覆盖当前内容",
      status: "failed",
    };
  }
  const effectivePlan = current;
  const patch = successNodePatch(effectivePlan, task, ownershipKey);
  const resultKey = groupRunResultKey(plan.kind === "text"
    ? {
        content: task.resultText?.trim() ?? "",
        contentHtml: htmlForPlainText(task.resultText?.trim() ?? ""),
      }
    : task.resultUrl);
  const projectionBase = {
    accountId: context.accountId,
    canvasId: context.canvasId,
    dataPatch: patch.data,
    inputFingerprint: effectivePlan.inputKey,
    kind: plan.kind,
    nodeId: plan.node.id,
    ownershipKey,
    resultKey,
    runId: context.runId,
    taskId: task.id,
  } satisfies Omit<
    GroupResultProjection,
    "applicationId" | "semanticRevision"
  >;
  const projection: GroupResultProjection = {
    ...projectionBase,
    applicationId: groupResultProjectionApplicationId(projectionBase),
    semanticRevision: groupResultSemanticRevision(projectionBase),
  };
  const applied = await applyFencedNodeUpdate({
    context,
    kind: plan.kind,
    nodeId: plan.node.id,
    ownershipKey,
    taskId: task.id,
    update: (node) => ({
      ...node,
      data: { ...node.data, ...patch.data } as ProbeNodeType["data"],
      ...(patch.style
        ? {
            height: undefined,
            measured: undefined,
            style: { ...node.style, ...patch.style },
            width: undefined,
          }
        : {}),
    } as ProbeNodeType),
  });
  if (applied.status !== "applied") {
    return {
      errorCode: "RESULT_OWNERSHIP_CONFLICT",
      message: "节点或画布已变化，未覆盖当前内容",
      status: "failed",
    };
  }
  clearGenerationSubmissionIntent(
    plan.kind,
    context.canvasId,
    plan.node.id,
    task.id,
    context.accountId,
  );
  return {
    projection,
    status: "success",
    successProof: {
      ownershipKey,
      resultKey,
      taskId: task.id,
    },
  };
}

async function waitForTerminalTask(
  context: NodeExecutorContext,
  plan: ExecutionPlan,
  task: GenerationTaskSummary,
) {
  if (["cancelled", "failed", "success"].includes(task.state)) return task;
  return waitForGenerationTask(task.id, context.signal);
}

function createExecutor(kind: WorkflowExecutorKind): NodeExecutor {
  return {
    kind,
    preflight: async (nodeId, context, executableIds, phase) => {
      const plan = createExecutionPlan(kind, nodeId, context);
      if (!isPlan(plan)) return plan;
      const common = {
        executableIds,
        inputs: plan.inputs,
        problems: plan.problems,
      };
      if (phase !== "static") {
        const disposition = workflowRuntimePreflightDisposition(common);
        if (disposition.status === "ready") return { status: "success" };
        if (disposition.status === "waiting" && phase === "runtime") {
          return { message: disposition.problem.message, status: "busy" };
        }
        return persistInputFailure(context, plan, disposition.problem);
      }
      const problem = workflowSubmissionPreflightProblem(common);
      return problem
        ? persistInputFailure(context, plan, problem)
        : { status: "success" };
    },
    recover: async (nodeId, context) => {
      let plan = createBoundRecoveryPlan(kind, nodeId, context);
      const accepted = context.acceptedTask;
      if (!isPlan(plan) && accepted) {
        const currentNode = context.graph.snapshot().nodes.find((node) =>
          node.id === nodeId
        );
        if (
          !currentNode ||
          currentNode.type !== kind ||
          accepted.kind !== kind ||
          accepted.nodeId !== nodeId
        ) {
          return {
            errorCode: "RESULT_OWNERSHIP_CONFLICT",
            message: "当前节点输入与已接收任务凭证不一致，未读取或覆盖结果",
            status: "failed",
          };
        }
        const acceptedTask = await getGenerationTask(
          accepted.taskId,
          context.signal,
        );
        if (!taskMatches(acceptedTask, kind, context.canvasId, nodeId)) {
          return { message: "已接收任务与当前节点不一致", status: "failed" };
        }
        const applied = await applyFencedNodeUpdate({
          context,
          kind,
          nodeId,
          ownershipKey: accepted.ownershipKey,
          taskId: taskIdFor(currentNode, kind),
          update: (node) => ({
            ...node,
            data: {
              ...node.data,
              [`${kind}GenerationOwnershipKey`]: accepted.ownershipKey,
              [`${kind}GenerationTaskId`]: accepted.taskId,
              [`${kind}Generating`]: true,
              workflowExecutionRunId: context.runId,
            },
          }),
        });
        if (applied.status !== "applied") {
          return {
            errorCode: "RESULT_OWNERSHIP_CONFLICT",
            message: "当前节点已变化，未绑定已接收任务",
            status: "failed",
          };
        }
        await context.save.flush();
        await context.save.waitForRevision();
        plan = createBoundRecoveryPlan(kind, nodeId, context);
      }
      if (!isPlan(plan)) return plan;
      const taskId = taskIdFor(plan.node, kind);
      const ownershipKey = plan.node.data[`${kind}GenerationOwnershipKey`];
      if (!taskId || typeof ownershipKey !== "string" || !ownershipKey) {
        return {
          message: "已有任务缺少可核对的任务号或输入所有权，未自动重新提交",
          status: "failed",
        };
      }
      if (accepted && (
        accepted.kind !== kind ||
        accepted.nodeId !== nodeId ||
        accepted.taskId !== taskId ||
        accepted.ownershipKey !== ownershipKey
      )) {
        return {
          errorCode: "RESULT_OWNERSHIP_CONFLICT",
          message: "恢复任务与已接收任务凭证不一致，未读取或覆盖结果",
          status: "failed",
        };
      }
      const task = await getGenerationTask(taskId, context.signal);
      if (!taskMatches(task, kind, context.canvasId, nodeId)) {
        return { message: "已有任务与当前节点不一致", status: "failed" };
      }
      const terminal = await waitForTerminalTask(context, plan, task);
      return applyTerminalTask(context, plan, terminal, ownershipKey);
    },
    run: async (nodeId, context, executableIds) => {
      if (context.isCancelled()) {
        return { message: "已停止后续节点", status: "skipped" };
      }
      const plan = createExecutionPlan(kind, nodeId, context);
      if (!isPlan(plan)) return plan;
      if (isGenerating(plan.node, kind)) {
        const existingTaskId = taskIdFor(plan.node, kind);
        if (existingTaskId && plan.node.data.workflowExecutionRunId === context.runId) {
          return createExecutor(kind).recover(nodeId, context);
        }
        return { message: "节点正在生成中", status: "busy" };
      }
      if (!plan.request.prompt.trim() || plan.problems.length > 0) {
        const problem = plan.problems[0];
        return problem
          ? persistInputFailure(context, plan, problem)
          : { message: "生成指令为空", status: "skipped" };
      }
      let admittedTask: GenerationTaskSummary;
      let ownershipKey = plan.effectiveOwnershipKey;
      try {
        const admitted = await runExclusiveCanvasSubmit(context.canvasId, async () => {
          const { revision: canvasRevision } =
            await context.save.waitForRevision();
          const current = createExecutionPlan(kind, nodeId, context);
          if (!isPlan(current) ||
            current.effectiveOwnershipKey !== plan.effectiveOwnershipKey) {
            throw new Error("生成输入已修改，已停止本次生成");
          }
          if (context.isCancelled()) {
            return { cancelled: true as const };
          }
          const ensured = await ensureGenerationTask(
            kind as GenerationTaskKind,
            { ...plan.request, canvasRevision },
            context.accountId,
            () => {
              const latest = createExecutionPlan(kind, nodeId, context);
              if (!isPlan(latest) ||
                latest.effectiveOwnershipKey !== plan.effectiveOwnershipKey ||
                context.isCancelled()) {
                throw new Error("生成输入已修改或本轮已停止，未提交新任务");
              }
            },
            {
              generationOwnershipKey: plan.effectiveOwnershipKey,
              workflowRunId: context.runId,
            },
          );
          return { cancelled: false as const, ensured };
        });
        if (admitted.cancelled) {
          return { message: "已停止后续节点", status: "skipped" };
        }
        admittedTask = admitted.ensured.task;
        ownershipKey = admitted.ensured.generationOwnershipKey ??
          plan.effectiveOwnershipKey;
        await context.onTaskAccepted?.({
          kind,
          nodeId,
          ownershipKey,
          taskId: admittedTask.id,
        });
        const applied = await applyFencedNodeUpdate({
          context,
          kind,
          nodeId,
          ownershipKey: nodeOwnershipKey(
            plan.node,
            kind,
            plan.currentOwnershipKey,
          ),
          taskId: taskIdFor(plan.node, kind),
          update: (node) => ({
            ...node,
            data: {
              ...node.data,
              ...bindingPatch(plan, admittedTask, ownershipKey, context.runId),
            },
          }),
        });
        if (applied.status !== "applied") {
          throw new Error("节点或画布已变化，未绑定已提交任务");
        }
        await context.save.flush();
        await context.save.waitForRevision();
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : generationMessageFallback(kind);
        const code = error instanceof GenerationRequestError
          ? error.code
          : "TASK_STATUS_UNKNOWN";
        return {
          errorCode: code,
          message: friendlyGenerationMessage(message, kind, code),
          status: "failed",
        };
      }
      try {
        const terminal = await waitForTerminalTask(context, plan, admittedTask);
        return await applyTerminalTask(context, plan, terminal, ownershipKey);
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "任务状态暂时无法确认，不能重新提交";
        const applied = await applyFencedNodeUpdate({
          context,
          kind,
          nodeId,
          ownershipKey,
          taskId: admittedTask.id,
          update: (node) => ({
            ...node,
            data: {
              ...node.data,
              [`${kind}GenerationError`]: friendlyGenerationMessage(message, kind),
              [`${kind}GenerationErrorCode`]: "TASK_STATUS_UNKNOWN",
              [`${kind}Generating`]: true,
            },
          }),
        }).catch(() => undefined);
        if (applied?.status === "applied") {
          await context.save.flush().catch(() => undefined);
        }
        return {
          errorCode: "TASK_STATUS_UNKNOWN",
          message: friendlyGenerationMessage(message, kind),
          status: "failed",
        };
      }
    },
  };
}

export function createNodeExecutorRegistry() {
  return new NodeExecutorRegistry([
    createExecutor("text"),
    createExecutor("image"),
    createExecutor("audio"),
    createExecutor("video"),
  ]);
}
