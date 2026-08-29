import type {
  ImageGenerationToolInput,
  ImageOutpaintParameters,
  ImageToolCapability,
} from "../../../types/imageTools";
import { imageToolMaximums } from "../../../types/imageTools";
import { NODE_DEFAULT_SIZES } from "../canvas/mediaGeometry";
import type { ProbeNodeType } from "../canvas/ProbeNode";
import type {
  CanvasGraphCommand,
  CanvasGraphCommandCommit,
  CanvasGraphCommandPort,
} from "../canvas/canvasPorts";
import type { CuttableEdge } from "../canvas/canvasTypes";
import type { SingleNodeGenerationLifecycle } from
  "../generation/singleNodeGenerationLifecycle";
import type { DerivedImageMediaPort } from "./derivedImageToolUseCase";
import { createGenerationImageToolUseCase } from
  "./generationImageToolUseCase";
import { findVacantImageToolPlacement } from "./imageToolPlacement";

export type OutpaintEraseOperation = "erase" | "outpaint";

export function outpaintEraseOwnershipEvidence(input: Readonly<{
  accountId: string;
  aspectRatio?: string;
  canvasId: string;
  maskAssetId: string;
  maskFeatherPixels: number;
  maskHeight: number;
  maskWidth: number;
  modelId?: string;
  modelParameters?: ProbeNodeType["data"]["imageParameters"];
  operation: OutpaintEraseOperation;
  operationId: string;
  outpaint?: ImageOutpaintParameters;
  preparedAssetId?: string;
  prompt: string;
  quality?: string;
  sourceAssetId: string;
  sourceNodeId: string;
}>) {
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
    operation: input.operation,
    operationId: input.operationId,
    outpaint: input.outpaint,
    preparedAssetId: input.preparedAssetId,
    prompt: input.prompt,
    quality: input.quality,
    sourceAssetId: input.sourceAssetId,
    sourceNodeId: input.sourceNodeId,
  } as const;
}

export type OutpaintEraseGenerationPlan = Readonly<{
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
      order: 1;
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

export function createOutpaintEraseImageToolUseCase(input: Readonly<{
  afterPlaceholderCreated(): Promise<void>;
  capability: ImageToolCapability;
  commit?: CanvasGraphCommandCommit;
  createLifecycle(plan: OutpaintEraseGenerationPlan): SingleNodeGenerationLifecycle;
  graph: CanvasGraphCommandPort;
  media: DerivedImageMediaPort;
  operation: OutpaintEraseOperation;
  ownershipKey(evidence: ReturnType<typeof outpaintEraseOwnershipEvidence>): string;
}>) {
  return {
    operation: input.operation,
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
      outpaint?: ImageOutpaintParameters;
      preOwnershipKey: string;
      preparedFile?: File;
      prompt: string;
      quality?: string;
      runId: string;
      sourceAssetId: string;
      sourceNodeId: string;
      title: string;
    }>) {
      const prompt = command.prompt.trim();
      const noun = input.operation === "outpaint" ? "扩图" : "擦除";
      if (!prompt || prompt.length > 100_000) throw new Error(`请输入有效的${noun}提示词`);
      if (command.maskFile.type !== "image/png" || command.maskFile.size < 1 ||
          command.maskFile.size > imageToolMaximums.maskBytes ||
          !Number.isSafeInteger(command.featherPixels) ||
          command.featherPixels < 0 || command.featherPixels > 64) {
        throw new Error(`${noun}遮罩格式、大小或羽化参数无效`);
      }
      const isOutpaint = input.operation === "outpaint";
      if (isOutpaint !== Boolean(command.preparedFile && command.outpaint)) {
        throw new Error("扩图输入与边界参数不完整");
      }
      if (command.preparedFile && (
        command.preparedFile.type !== "image/png" || command.preparedFile.size < 1 ||
        command.preparedFile.size > imageToolMaximums.inputBytes
      )) throw new Error("扩图准备图片格式或大小无效");
      if (input.capability.operation !== input.operation ||
          input.capability.status !== "available" ||
          Date.parse(input.capability.expiresAt) <= Date.now() ||
          !input.capability.supportsReferenceImage || !input.capability.supportsMask ||
          input.capability.modelId !== command.modelId) {
        throw new Error(input.capability.reason || `${noun}能力当前不可用`);
      }
      if (!Number.isSafeInteger(command.expectedRevision)) {
        throw new Error(`画布版本不可用，请重新打开${noun}工具`);
      }
      const source = input.graph.snapshot().nodes.find((node) =>
        node.id === command.sourceNodeId
      );
      if (!source || source.type !== "image" || source.data.assetId !== command.sourceAssetId) {
        throw new Error(`原图片已发生变化，请重新打开${noun}工具`);
      }
      const uploaded: string[] = [];
      let graphCommitted = false;
      try {
        const prepared = command.preparedFile
          ? await input.media.upload(command.preparedFile)
          : undefined;
        if (prepared) uploaded.push(prepared.assetId);
        const mask = await input.media.upload(command.maskFile);
        uploaded.push(mask.assetId);
        if (mask.width < 1 || mask.height < 1 ||
            (prepared && (prepared.width !== mask.width || prepared.height !== mask.height)) ||
            (!prepared && ((source.data.mediaWidth !== undefined && source.data.mediaWidth !== mask.width) ||
              (source.data.mediaHeight !== undefined && source.data.mediaHeight !== mask.height)))) {
          throw new Error(`${noun}遮罩尺寸与输入图片不一致`);
        }
        const imageTool: ImageGenerationToolInput = {
          mask: { assetId: mask.assetId, featherPixels: command.featherPixels,
            height: mask.height, version: 1, width: mask.width },
          operation: input.operation,
          operationId: command.operationId,
          ...(command.outpaint ? { outpaint: command.outpaint } : {}),
          ...(prepared ? { preparedInput: { assetId: prepared.assetId,
            height: prepared.height, version: 1, width: prepared.width } } : {}),
          sourceAssetId: command.sourceAssetId,
          sourceNodeId: command.sourceNodeId,
        };
        const ownershipKey = input.ownershipKey(outpaintEraseOwnershipEvidence({
          accountId: command.accountId, aspectRatio: command.aspectRatio,
          canvasId: command.canvasId, maskAssetId: mask.assetId,
          maskFeatherPixels: command.featherPixels, maskHeight: mask.height,
          maskWidth: mask.width, modelId: command.modelId,
          modelParameters: command.modelParameters, operation: input.operation,
          operationId: command.operationId, outpaint: command.outpaint,
          preparedAssetId: prepared?.assetId, prompt, quality: command.quality,
          sourceAssetId: command.sourceAssetId, sourceNodeId: command.sourceNodeId,
        }));
        const targetNodeId = `image-${input.operation}-${command.operationId}`;
        const targetNode: ProbeNodeType = {
          data: {
            imageAspectRatio: command.aspectRatio, imageModelId: command.modelId,
            imageModelName: command.modelName, imageParameters: command.modelParameters,
            imagePrompt: prompt, imagePromptReady: true, imageQuality: command.quality,
            imageToolMaskAssetId: mask.assetId,
            imageToolMaskFeatherPixels: command.featherPixels,
            imageToolMaskHeight: mask.height, imageToolMaskVersion: 1,
            imageToolMaskWidth: mask.width, imageToolOperation: input.operation,
            imageToolOperationId: command.operationId,
            imageToolOutpaintParameters: command.outpaint,
            imageToolPreparedAssetId: prepared?.assetId,
            imageToolPreparedHeight: prepared?.height,
            imageToolPreparedVersion: prepared ? 1 : undefined,
            imageToolPreparedWidth: prepared?.width,
            imageToolSourceAssetId: command.sourceAssetId,
            label: "Image", sourceKind: "image", title: `${command.title || "Image"}-${noun}`,
          },
          id: targetNodeId,
          position: { x: 0, y: 0 },
          selected: true, style: { ...NODE_DEFAULT_SIZES.image }, type: "image",
        };
        const edge: CuttableEdge = { data: { inputOrder: 1, inputRole: "reference-image" },
          id: `edge-${command.sourceNodeId}-${targetNodeId}`, interactionWidth: 20,
          source: command.sourceNodeId, sourceHandle: "source", target: targetNodeId,
          targetHandle: "target", type: "cuttable" };
        const graphCommand: CanvasGraphCommand = {
          fence: { expectedRevision: command.expectedRevision, kind: "image",
            nodeId: command.sourceNodeId, operationId: command.operationId,
            ownershipKey: command.preOwnershipKey, runId: command.runId,
            sourceAssetId: command.sourceAssetId },
          scope: "image-tool",
          update: (snapshot) => ({ ...snapshot, edges: [...snapshot.edges, edge],
            nodes: [...snapshot.nodes.map((node) => ({ ...node, selected: false })), {
              ...targetNode,
              position: findVacantImageToolPlacement({
                height: NODE_DEFAULT_SIZES.image.height,
                nodes: snapshot.nodes,
                sourceNodeId: command.sourceNodeId,
                width: NODE_DEFAULT_SIZES.image.width,
              }),
            }] }),
        };
        const graphResult = input.commit
          ? await input.commit(graphCommand)
          : input.graph.apply(graphCommand);
        if (graphResult.status !== "applied") {
          throw new Error(`原图片或画布版本已发生变化，请重新打开${noun}工具`);
        }
        graphCommitted = true;
        await input.afterPlaceholderCreated();
        return await createGenerationImageToolUseCase({
          lifecycle: input.createLifecycle({ aspectRatio: command.aspectRatio,
            inputKey: ownershipKey, modelId: command.modelId, modelName: command.modelName,
            modelParameters: command.modelParameters, nodeId: targetNodeId, ownershipKey,
            payload: { canvasId: command.canvasId, imageTool, inputSchemaVersion: 1,
              inputs: [{ assetId: command.sourceAssetId, kind: "image", order: 1,
                role: "reference-image", sourceNodeId: command.sourceNodeId }],
              model: command.modelId, nodeId: targetNodeId, ownPrompt: prompt,
              parameters: command.modelParameters, prompt }, quality: command.quality }),
          operation: input.operation,
        }).execute({ action: "submit" });
      } finally {
        if (!graphCommitted) {
          for (const assetId of uploaded.reverse()) await input.media.discard(assetId);
        }
      }
    },
  } as const;
}
