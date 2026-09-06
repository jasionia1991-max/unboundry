import type { ProbeNodeType } from "../canvas/ProbeNode";
import type {
  CanvasGraphCommand,
  CanvasGraphCommandCommit,
  CanvasGraphCommandPort,
} from "../canvas/canvasPorts";
import type { CuttableEdge } from "../canvas/canvasTypes";
import type { ImageToolOperation } from "../../../types/imageTools";
import { findVacantImageToolPlacement } from "./imageToolPlacement";

export type DerivedImageAsset = Readonly<{
  assetId: string;
  fileName: string;
  hasTransparency?: boolean;
  height: number;
  url: string;
  width: number;
}>;

export type DerivedImageMediaPort = Readonly<{
  discard(assetId: string): Promise<void>;
  metadata(assetId: string): Promise<Partial<ProbeNodeType["data"]>>;
  upload(file: File): Promise<DerivedImageAsset>;
}>;

export type DerivedImageToolInput = Readonly<{
  expectedRevision: number;
  file: File;
  operationId: string;
  ownershipKey: string;
  runId: string;
  sourceAssetId: string;
  sourceNodeId: string;
  title: string;
}>;

const derivedOperations = new Set<ImageToolOperation>([
  "annotate",
  "crop",
  "enhance-conservative",
  "quick-split",
  "resize-pixels",
]);

export function createDerivedImageToolUseCase(input: Readonly<{
  commit?: CanvasGraphCommandCommit;
  graph: CanvasGraphCommandPort;
  media: DerivedImageMediaPort;
  operation: "annotate" | "crop" | "enhance-conservative" | "quick-split" |
    "resize-pixels";
  size: (width: number, height: number) => Readonly<{
    height: number;
    width: number;
  }>;
}>) {
  if (!derivedOperations.has(input.operation)) {
    throw new Error(`Unsupported derived image operation: ${input.operation}`);
  }
  return {
    operation: input.operation,
    async execute(command: DerivedImageToolInput) {
      if (!Number.isSafeInteger(command.expectedRevision)) {
        throw new Error("画布版本不可用，请重新打开图片工具");
      }
      const source = input.graph.snapshot().nodes.find((node) =>
        node.id === command.sourceNodeId
      );
      if (!source || source.type !== "image" ||
          source.data.assetId !== command.sourceAssetId) {
        throw new Error("原图片已发生变化，请重新打开图片工具");
      }
      const asset = await input.media.upload(command.file);
      let committed = false;
      try {
        const metadata = await input.media.metadata(asset.assetId);
        const derivedId = `image-${input.operation}-${command.operationId}`;
        const derivedNode: ProbeNodeType = {
          data: {
            mediaSizingMode: "auto",
            assetId: asset.assetId,
            ...metadata,
            imageAssetOrigin: "image-tool",
            imageHasTransparency: asset.hasTransparency === true,
            imageSrc: asset.url,
            imageToolOperation: input.operation,
            imageToolOperationId: command.operationId,
            imageToolSourceAssetId: command.sourceAssetId,
            label: "Image",
            sourceKind: "image",
            title: command.title ||
              asset.fileName.replace(/\.[^.]+$/, "") || "Image",
          },
          id: derivedId,
          position: { x: 0, y: 0 },
          selected: true,
          style: { ...input.size(asset.width, asset.height) },
          type: "image",
        };
        const edge: CuttableEdge = {
          id: `edge-${command.sourceNodeId}-${derivedId}`,
          interactionWidth: 20,
          source: command.sourceNodeId,
          sourceHandle: "source",
          target: derivedId,
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
          update: (snapshot) => {
            const position = findVacantImageToolPlacement({
              height: input.size(asset.width, asset.height).height,
              nodes: snapshot.nodes,
              sourceNodeId: command.sourceNodeId,
              width: input.size(asset.width, asset.height).width,
            });
            return {
              ...snapshot,
              edges: [...snapshot.edges, edge],
              nodes: [
                ...snapshot.nodes.map((node) => ({ ...node, selected: false })),
                { ...derivedNode, position },
              ],
            };
          },
        };
        const result = input.commit
          ? await input.commit(graphCommand)
          : input.graph.apply(graphCommand);
        if (result.status !== "applied") {
          throw new Error(
            result.reason === "persistence-unavailable"
              ? "画布尚未完成安全加载"
              : "原图片或画布版本已发生变化，请重新打开图片工具",
          );
        }
        committed = true;
        return {
          assetIds: [asset.assetId],
          kind: "derived-assets",
          operation: input.operation,
          sourceAssetId: command.sourceAssetId,
        } as const;
      } finally {
        if (!committed) await input.media.discard(asset.assetId);
      }
    },
  } as const;
}
