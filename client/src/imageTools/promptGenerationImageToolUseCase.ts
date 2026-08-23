import type { ImageGenerationToolInput, ImageToolCapability } from
  "../../../types/imageTools";
import { NODE_DEFAULT_SIZES } from "../canvas/mediaGeometry";
import type { ProbeNodeType } from "../canvas/ProbeNode";
import type { CanvasGraphCommandPort } from "../canvas/canvasPorts";
import type { CuttableEdge } from "../canvas/canvasTypes";
import type { SingleNodeGenerationLifecycle } from
  "../generation/singleNodeGenerationLifecycle";
import { createGenerationImageToolUseCase } from "./generationImageToolUseCase";

export type PromptGenerationOperation = "enhance-creative" | "remove-background";

export function promptGenerationOwnershipEvidence(input: Readonly<{
  accountId: string; aspectRatio?: string; canvasId: string; modelId?: string;
  modelParameters?: ProbeNodeType["data"]["imageParameters"];
  operation: PromptGenerationOperation; operationId: string; prompt: string;
  quality?: string; sourceAssetId: string; sourceNodeId: string;
}>) { return { ...input } as const; }

export type PromptGenerationPlan = Readonly<{
  aspectRatio?: string; inputKey: string; modelId: string; modelName: string;
  modelParameters: ProbeNodeType["data"]["imageParameters"]; nodeId: string;
  ownershipKey: string; quality?: string;
  payload: Readonly<{ canvasId: string; imageTool: ImageGenerationToolInput;
    inputSchemaVersion: 1; inputs: readonly [Readonly<{ assetId: string;
      kind: "image"; order: 1; role: "reference-image"; sourceNodeId: string }>] ;
    model: string; nodeId: string; ownPrompt: string;
    parameters: ProbeNodeType["data"]["imageParameters"]; prompt: string }>;
}>;

export function createPromptGenerationImageToolUseCase(input: Readonly<{
  afterPlaceholderCreated(): Promise<void>; capability: ImageToolCapability;
  createLifecycle(plan: PromptGenerationPlan): SingleNodeGenerationLifecycle;
  graph: CanvasGraphCommandPort; operation: PromptGenerationOperation;
  ownershipKey(evidence: ReturnType<typeof promptGenerationOwnershipEvidence>): string;
}>) {
  return { operation: input.operation, async execute(command: Readonly<{
    accountId: string; aspectRatio?: string; canvasId: string;
    expectedRevision: number; modelId: string; modelName: string;
    modelParameters: ProbeNodeType["data"]["imageParameters"]; operationId: string;
    preOwnershipKey: string; prompt: string; quality?: string; runId: string;
    sourceAssetId: string; sourceNodeId: string; title: string;
  }>) {
    const prompt = command.prompt.trim();
    if (!prompt || prompt.length > 100_000) throw new Error("图片处理提示词无效");
    if (input.capability.operation !== input.operation ||
        input.capability.status !== "available" ||
        Date.parse(input.capability.expiresAt) <= Date.now() ||
        !input.capability.supportsReferenceImage ||
        (input.operation === "remove-background" && !input.capability.supportsAlpha) ||
        input.capability.modelId !== command.modelId) {
      throw new Error(input.capability.reason || "图片处理能力当前不可用");
    }
    const source = input.graph.snapshot().nodes.find((node) => node.id === command.sourceNodeId);
    if (!source || source.type !== "image" || source.data.assetId !== command.sourceAssetId) {
      throw new Error("原图片已发生变化，请重新打开图片处理工具");
    }
    const outputBackground = input.operation === "remove-background"
      ? "transparent" as const
      : undefined;
    const imageTool: ImageGenerationToolInput = { operation: input.operation,
      operationId: command.operationId, sourceAssetId: command.sourceAssetId,
      sourceNodeId: command.sourceNodeId, ...(outputBackground
        ? { outputBackground }
        : {}) };
    const ownershipKey = input.ownershipKey(promptGenerationOwnershipEvidence({
      accountId: command.accountId, aspectRatio: command.aspectRatio,
      canvasId: command.canvasId, modelId: command.modelId,
      modelParameters: command.modelParameters, operation: input.operation,
      operationId: command.operationId, prompt, quality: command.quality,
      sourceAssetId: command.sourceAssetId, sourceNodeId: command.sourceNodeId }));
    const noun = input.operation === "remove-background" ? "抠图" : "创意增强";
    const targetNodeId = `image-${input.operation}-${command.operationId}`;
    const targetNode: ProbeNodeType = { data: { imageAspectRatio: command.aspectRatio,
      imageModelId: command.modelId, imageModelName: command.modelName,
      imageParameters: command.modelParameters, imagePrompt: prompt,
      imagePromptReady: true, imageQuality: command.quality,
      imageToolOperation: input.operation, imageToolOperationId: command.operationId,
      ...(outputBackground ? { imageToolOutputBackground: outputBackground } : {}),
      imageToolSourceAssetId: command.sourceAssetId, label: "Image",
      sourceKind: "image", title: `${command.title || "Image"}-${noun}` },
      id: targetNodeId, position: { x: source.position.x +
        (typeof source.style?.width === "number" ? source.style.width : 250) + 140,
        y: source.position.y }, selected: true, style: { ...NODE_DEFAULT_SIZES.image },
      type: "image" };
    const edge: CuttableEdge = { data: { inputOrder: 1, inputRole: "reference-image" },
      id: `edge-${command.sourceNodeId}-${targetNodeId}`, interactionWidth: 20,
      source: command.sourceNodeId, sourceHandle: "source", target: targetNodeId,
      targetHandle: "target", type: "cuttable" };
    const applied = input.graph.apply({ fence: { expectedRevision: command.expectedRevision,
      kind: "image", nodeId: command.sourceNodeId, operationId: command.operationId,
      ownershipKey: command.preOwnershipKey, runId: command.runId,
      sourceAssetId: command.sourceAssetId }, scope: "image-tool",
      update: (snapshot) => ({ ...snapshot, edges: [...snapshot.edges, edge],
        nodes: [...snapshot.nodes.map((node) => ({ ...node, selected: false })), targetNode] }) });
    if (applied.status !== "applied") throw new Error("原图片或画布版本已变化");
    await input.afterPlaceholderCreated();
    return createGenerationImageToolUseCase({ lifecycle: input.createLifecycle({
      aspectRatio: command.aspectRatio, inputKey: ownershipKey, modelId: command.modelId,
      modelName: command.modelName, modelParameters: command.modelParameters,
      nodeId: targetNodeId, ownershipKey, payload: { canvasId: command.canvasId,
        imageTool, inputSchemaVersion: 1, inputs: [{ assetId: command.sourceAssetId,
          kind: "image", order: 1, role: "reference-image",
          sourceNodeId: command.sourceNodeId }], model: command.modelId,
        nodeId: targetNodeId, ownPrompt: prompt, parameters: command.modelParameters,
        prompt }, quality: command.quality }), operation: input.operation })
      .execute({ action: "submit" });
  } } as const;
}
