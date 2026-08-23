import type {
  ImageGenerationToolInput,
  ImageToolCapability,
} from "../../../types/imageTools";
import { imageToolMaximums } from "../../../types/imageTools";
import { NODE_DEFAULT_SIZES } from "../canvas/mediaGeometry";
import type { ProbeNodeType } from "../canvas/ProbeNode";
import type { CanvasGraphCommandPort } from "../canvas/canvasPorts";
import type { CuttableEdge } from "../canvas/canvasTypes";
import type { SingleNodeGenerationLifecycle } from
  "../generation/singleNodeGenerationLifecycle";
import type { DerivedImageMediaPort } from "./derivedImageToolUseCase";
import { createGenerationImageToolUseCase } from
  "./generationImageToolUseCase";

export type RedrawGenerationPlan = Readonly<{
  aspectRatio?: string;
  inputKey: string;
  modelId: string;
  modelName: string;
  modelParameters: ProbeNodeType["data"]["imageParameters"];
  nodeId: string;
  ownershipKey: string;
  payload: Readonly<{
    canvasId: string;
    imageTool: ImageGenerationToolInput;
    inputSchemaVersion: 1;
    inputs: readonly [Readonly<{
      assetId: string;
      kind: "image";
      order: 0;
      role: "reference-image";
      sourceNodeId: string;
    }>];
    model: string;
    nodeId: string;
    ownPrompt: string;
    parameters: ProbeNodeType["data"]["imageParameters"];
    prompt: string;
  }>;
  quality?: string;
}>;

export type RedrawOwnershipEvidenceInput = Readonly<{
  accountId: string;
  aspectRatio?: string;
  canvasId: string;
  maskAssetId: string;
  maskFeatherPixels: number;
  maskHeight: number;
  maskWidth: number;
  modelId?: string;
  modelParameters?: ProbeNodeType["data"]["imageParameters"];
  operationId: string;
  prompt: string;
  quality?: string;
  sourceAssetId: string;
  sourceNodeId: string;
}>;

export function redrawOwnershipEvidence(input: RedrawOwnershipEvidenceInput) {
  return {
    accountId: input.accountId,
    aspectRatio: input.aspectRatio,
    canvasId: input.canvasId,
    mask: {
      assetId: input.maskAssetId,
      featherPixels: input.maskFeatherPixels,
      height: input.maskHeight,
      version: 1,
      width: input.maskWidth,
    },
    modelId: input.modelId,
    modelParameters: input.modelParameters,
    operation: "redraw",
    operationId: input.operationId,
    prompt: input.prompt,
    quality: input.quality,
    sourceAssetId: input.sourceAssetId,
    sourceNodeId: input.sourceNodeId,
  } as const;
}

export function createRedrawImageToolUseCase(input: Readonly<{
  afterPlaceholderCreated(): Promise<void>;
  capability: ImageToolCapability;
  createLifecycle(plan: RedrawGenerationPlan): SingleNodeGenerationLifecycle;
  graph: CanvasGraphCommandPort;
  media: DerivedImageMediaPort;
  ownershipKey(evidence: ReturnType<typeof redrawOwnershipEvidence>): string;
}>) {
  return {
    operation: "redraw" as const,
    async execute(command: Readonly<{
      accountId: string;
      aspectRatio?: string;
      canvasId: string;
      expectedRevision: number;
      featherPixels: number;
      maskFile: File;
      modelId: string;
      modelName: string;
      modelParameters: ProbeNodeType["data"]["imageParameters"];
      operationId: string;
      preOwnershipKey: string;
      prompt: string;
      quality?: string;
      runId: string;
      sourceAssetId: string;
      sourceNodeId: string;
      title: string;
    }>) {
      const prompt = command.prompt.trim();
      if (!prompt || prompt.length > 100_000) {
        throw new Error("请输入有效的重绘提示词");
      }
      if (
        command.maskFile.type !== "image/png" ||
        command.maskFile.size < 1 ||
        command.maskFile.size > imageToolMaximums.maskBytes ||
        !Number.isSafeInteger(command.featherPixels) ||
        command.featherPixels < 0 || command.featherPixels > 64
      ) throw new Error("重绘遮罩格式、大小或羽化参数无效");
      if (
        input.capability.operation !== "redraw" ||
        input.capability.status !== "available" ||
        Date.parse(input.capability.expiresAt) <= Date.now() ||
        !input.capability.supportsReferenceImage ||
        !input.capability.supportsMask ||
        input.capability.modelId !== command.modelId
      ) throw new Error(input.capability.reason || "重绘能力当前不可用");
      if (!Number.isSafeInteger(command.expectedRevision)) {
        throw new Error("画布版本不可用，请重新打开重绘工具");
      }
      const source = input.graph.snapshot().nodes.find((node) =>
        node.id === command.sourceNodeId
      );
      if (!source || source.type !== "image" ||
          source.data.assetId !== command.sourceAssetId) {
        throw new Error("原图片已发生变化，请重新打开重绘工具");
      }
      const mask = await input.media.upload(command.maskFile);
      let graphCommitted = false;
      try {
        if (
          mask.width < 1 || mask.height < 1 ||
          (source.data.mediaWidth !== undefined &&
            source.data.mediaWidth !== mask.width) ||
          (source.data.mediaHeight !== undefined &&
            source.data.mediaHeight !== mask.height)
        ) throw new Error("重绘遮罩尺寸必须与原图完全一致");
        const imageTool: ImageGenerationToolInput = {
          mask: {
            assetId: mask.assetId,
            featherPixels: command.featherPixels,
            height: mask.height,
            version: 1,
            width: mask.width,
          },
          operation: "redraw",
          operationId: command.operationId,
          sourceAssetId: command.sourceAssetId,
          sourceNodeId: command.sourceNodeId,
        };
        const ownershipKey = input.ownershipKey(redrawOwnershipEvidence({
          accountId: command.accountId,
          aspectRatio: command.aspectRatio,
          canvasId: command.canvasId,
          maskAssetId: mask.assetId,
          maskFeatherPixels: command.featherPixels,
          maskHeight: mask.height,
          maskWidth: mask.width,
          modelId: command.modelId,
          modelParameters: command.modelParameters,
          operationId: command.operationId,
          prompt,
          quality: command.quality,
          sourceAssetId: command.sourceAssetId,
          sourceNodeId: command.sourceNodeId,
        }));
        const targetNodeId = `image-redraw-${command.operationId}`;
        const targetNode: ProbeNodeType = {
          data: {
            imageAspectRatio: command.aspectRatio,
            imageModelId: command.modelId,
            imageModelName: command.modelName,
            imageParameters: command.modelParameters,
            imagePrompt: prompt,
            imagePromptReady: true,
            imageQuality: command.quality,
            imageToolMaskAssetId: mask.assetId,
            imageToolMaskFeatherPixels: command.featherPixels,
            imageToolMaskHeight: mask.height,
            imageToolMaskVersion: 1,
            imageToolMaskWidth: mask.width,
            imageToolOperation: "redraw",
            imageToolOperationId: command.operationId,
            imageToolSourceAssetId: command.sourceAssetId,
            label: "Image",
            sourceKind: "image",
            title: `${command.title || "Image"}-重绘`,
          },
          id: targetNodeId,
          position: {
            x: source.position.x +
              (typeof source.style?.width === "number" ? source.style.width : 250) +
              140,
            y: source.position.y,
          },
          selected: true,
          style: { ...NODE_DEFAULT_SIZES.image },
          type: "image",
        };
        const edge: CuttableEdge = {
          data: { inputOrder: 0, inputRole: "reference-image" },
          id: `edge-${command.sourceNodeId}-${targetNodeId}`,
          interactionWidth: 20,
          source: command.sourceNodeId,
          sourceHandle: "source",
          target: targetNodeId,
          targetHandle: "target",
          type: "cuttable",
        };
        const graphResult = input.graph.apply({
          fence: {
            expectedRevision: command.expectedRevision,
            kind: "image",
            nodeId: command.sourceNodeId,
            operationId: command.operationId,
            ownershipKey: command.preOwnershipKey,
            runId: command.runId,
            sourceAssetId: command.sourceAssetId,
          },
          scope: "image-tool",
          update: (snapshot) => ({
            ...snapshot,
            edges: [...snapshot.edges, edge],
            nodes: [
              ...snapshot.nodes.map((node) => ({ ...node, selected: false })),
              targetNode,
            ],
          }),
        });
        if (graphResult.status !== "applied") {
          throw new Error("原图片或画布版本已发生变化，请重新打开重绘工具");
        }
        graphCommitted = true;
        await input.afterPlaceholderCreated();
        const plan: RedrawGenerationPlan = {
          aspectRatio: command.aspectRatio,
          inputKey: ownershipKey,
          modelId: command.modelId,
          modelName: command.modelName,
          modelParameters: command.modelParameters,
          nodeId: targetNodeId,
          ownershipKey,
          payload: {
            canvasId: command.canvasId,
            imageTool,
            inputSchemaVersion: 1,
            inputs: [{
              assetId: command.sourceAssetId,
              kind: "image",
              order: 0,
              role: "reference-image",
              sourceNodeId: command.sourceNodeId,
            }],
            model: command.modelId,
            nodeId: targetNodeId,
            ownPrompt: prompt,
            parameters: command.modelParameters,
            prompt,
          },
          quality: command.quality,
        };
        return await createGenerationImageToolUseCase({
          lifecycle: input.createLifecycle(plan),
          operation: "redraw",
        }).execute({ action: "submit" });
      } finally {
        if (!graphCommitted) await input.media.discard(mask.assetId);
      }
    },
  } as const;
}
