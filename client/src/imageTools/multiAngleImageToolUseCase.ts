import type {
  ImageGenerationToolInput,
  ImageMultiAngleParameters,
  ImageToolCapability,
} from "../../../types/imageTools";
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
import { createGenerationImageToolUseCase } from
  "./generationImageToolUseCase";
import { findVacantImageToolPlacement } from "./imageToolPlacement";

export type MultiAngleGenerationPlan = Readonly<{
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

export type MultiAngleOwnershipEvidenceInput = Readonly<{
  accountId: string;
  aspectRatio?: string;
  canvasId: string;
  modelId?: string;
  modelParameters?: ProbeNodeType["data"]["imageParameters"];
  operationId: string;
  parameters: ImageMultiAngleParameters;
  prompt: string;
  quality?: string;
  sourceAssetId: string;
  sourceNodeId: string;
}>;

export function multiAngleOwnershipEvidence(
  input: MultiAngleOwnershipEvidenceInput,
) {
  return {
    accountId: input.accountId,
    aspectRatio: input.aspectRatio,
    canvasId: input.canvasId,
    modelId: input.modelId,
    modelParameters: input.modelParameters,
    operation: "multi-angle",
    operationId: input.operationId,
    parameters: input.parameters,
    prompt: input.prompt,
    quality: input.quality,
    sourceAssetId: input.sourceAssetId,
    sourceNodeId: input.sourceNodeId,
  } as const;
}

function assertParameters(parameters: ImageMultiAngleParameters) {
  if (
    !Number.isFinite(parameters.horizontalDegrees) ||
    parameters.horizontalDegrees < -180 ||
    parameters.horizontalDegrees > 180 ||
    !Number.isFinite(parameters.verticalDegrees) ||
    parameters.verticalDegrees < -90 ||
    parameters.verticalDegrees > 90 ||
    !Number.isFinite(parameters.distance) ||
    parameters.distance < -100 ||
    parameters.distance > 100 ||
    typeof parameters.wideAngle !== "boolean"
  ) throw new Error("多角度参数超出安全范围");
}

export function multiAnglePrompt(parameters: ImageMultiAngleParameters) {
  assertParameters(parameters);
  const distance = parameters.distance === 0
    ? "保持原拍摄距离"
    : parameters.distance > 0
      ? `镜头靠近主体 ${parameters.distance}%`
      : `镜头远离主体 ${Math.abs(parameters.distance)}%`;
  return [
    "以唯一参考图中的同一主体为身份锚点，保持主体身份、形体、服装、材质、颜色和关键细节。",
    `水平视角旋转 ${parameters.horizontalDegrees} 度，垂直视角旋转 ${parameters.verticalDegrees} 度，${distance}。`,
    parameters.wideAngle
      ? "使用广角透视，但不要扭曲主体身份或添加不存在的物体。"
      : "保持自然透视，不使用广角畸变。",
    "生成一张新的完整图片；不要拼贴、不要在图中输出参数文字。",
  ].join(" ");
}

export function createMultiAngleImageToolUseCase(input: Readonly<{
  afterPlaceholderCreated(): Promise<void>;
  capability: ImageToolCapability;
  commit?: CanvasGraphCommandCommit;
  createLifecycle(plan: MultiAngleGenerationPlan): SingleNodeGenerationLifecycle;
  graph: CanvasGraphCommandPort;
}>) {
  return {
    operation: "multi-angle" as const,
    async execute(command: Readonly<{
      aspectRatio?: string;
      canvasId: string;
      expectedRevision: number;
      modelId: string;
      modelName: string;
      modelParameters: ProbeNodeType["data"]["imageParameters"];
      operationId: string;
      ownershipKey: string;
      parameters: ImageMultiAngleParameters;
      quality?: string;
      runId: string;
      sourceAssetId: string;
      sourceNodeId: string;
      title: string;
    }>) {
      assertParameters(command.parameters);
      if (
        input.capability.operation !== "multi-angle" ||
        input.capability.status !== "available" ||
        Date.parse(input.capability.expiresAt) <= Date.now() ||
        !input.capability.supportsReferenceImage ||
        input.capability.modelId !== command.modelId
      ) throw new Error(input.capability.reason || "多角度能力当前不可用");
      if (!Number.isSafeInteger(command.expectedRevision)) {
        throw new Error("画布版本不可用，请重新打开多角度工具");
      }
      const source = input.graph.snapshot().nodes.find((node) =>
        node.id === command.sourceNodeId
      );
      if (!source || source.type !== "image" ||
          source.data.assetId !== command.sourceAssetId) {
        throw new Error("原图片已发生变化，请重新打开多角度工具");
      }
      const prompt = multiAnglePrompt(command.parameters);
      const targetNodeId = `image-multi-angle-${command.operationId}`;
      const targetNode: ProbeNodeType = {
        data: {
          imageAspectRatio: command.aspectRatio,
          imageModelId: command.modelId,
          imageModelName: command.modelName,
          imageMultiAngleParameters: command.parameters,
          imageParameters: command.modelParameters,
          imagePrompt: prompt,
          imagePromptReady: true,
          imageQuality: command.quality,
          imageToolOperation: "multi-angle",
          imageToolOperationId: command.operationId,
          imageToolSourceAssetId: command.sourceAssetId,
          label: "Image",
          sourceKind: "image",
          title: `${command.title || "Image"}-多角度`,
        },
        id: targetNodeId,
        position: { x: 0, y: 0 },
        selected: true,
        style: { ...NODE_DEFAULT_SIZES.image },
        type: "image",
      };
      const edge: CuttableEdge = {
        data: { inputOrder: 1, inputRole: "reference-image" },
        id: `edge-${command.sourceNodeId}-${targetNodeId}`,
        interactionWidth: 20,
        source: command.sourceNodeId,
        sourceHandle: "source",
        target: targetNodeId,
        targetHandle: "target",
        type: "cuttable",
      };
      const graphCommand: CanvasGraphCommand = {
        fence: {
          expectedRevision: command.expectedRevision,
          kind: "image",
          nodeId: command.sourceNodeId,
          operationId: command.operationId,
          ownershipKey: command.ownershipKey,
          runId: command.runId,
          sourceAssetId: command.sourceAssetId,
        },
        scope: "image-tool",
        update: (snapshot) => ({
          ...snapshot,
          edges: [...snapshot.edges, edge],
          nodes: [
            ...snapshot.nodes.map((node) => ({ ...node, selected: false })),
            { ...targetNode, position: findVacantImageToolPlacement({
              height: NODE_DEFAULT_SIZES.image.height,
              nodes: snapshot.nodes,
              sourceNodeId: command.sourceNodeId,
              width: NODE_DEFAULT_SIZES.image.width,
            }) },
          ],
        }),
      };
      const graphResult = input.commit
        ? await input.commit(graphCommand)
        : input.graph.apply(graphCommand);
      if (graphResult.status !== "applied") {
        throw new Error("原图片或画布版本已发生变化，请重新打开多角度工具");
      }
      // The ownership placeholder must be committed by the Canvas adapter
      // before any paid-task admission. React-backed graphs publish their
      // snapshot asynchronously, while in-memory adapters can resolve at once.
      await input.afterPlaceholderCreated();
      const imageTool: ImageGenerationToolInput = {
        operation: "multi-angle",
        operationId: command.operationId,
        sourceAssetId: command.sourceAssetId,
        sourceNodeId: command.sourceNodeId,
      };
      const plan: MultiAngleGenerationPlan = {
        aspectRatio: command.aspectRatio,
        inputKey: command.ownershipKey,
        modelId: command.modelId,
        modelName: command.modelName,
        modelParameters: command.modelParameters,
        nodeId: targetNodeId,
        ownershipKey: command.ownershipKey,
        payload: {
          canvasId: command.canvasId,
          imageTool,
          inputSchemaVersion: 1,
          inputs: [{
            assetId: command.sourceAssetId,
            kind: "image",
            order: 1,
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
      return createGenerationImageToolUseCase({
        lifecycle: input.createLifecycle(plan),
        operation: "multi-angle",
      }).execute({ action: "submit" });
    },
  } as const;
}
