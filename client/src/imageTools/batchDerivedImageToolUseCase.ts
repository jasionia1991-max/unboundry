import type { ProbeNodeType } from "../canvas/ProbeNode";
import type {
  CanvasGraphCommand,
  CanvasGraphCommandCommit,
  CanvasGraphCommandPort,
} from "../canvas/canvasPorts";
import type { CuttableEdge } from "../canvas/canvasTypes";
import type {
  DerivedImageAsset,
  DerivedImageMediaPort,
} from "./derivedImageToolUseCase";
import { findVacantImageToolPlacement } from "./imageToolPlacement";

export function createBatchDerivedImageToolUseCase(input: Readonly<{
  commit?: CanvasGraphCommandCommit;
  graph: CanvasGraphCommandPort;
  media: DerivedImageMediaPort;
  operation: "quick-split";
  size: (width: number, height: number) => Readonly<{
    height: number;
    width: number;
  }>;
}>) {
  return {
    operation: input.operation,
    async execute(command: Readonly<{
      expectedRevision: number;
      files: readonly File[];
      grid: 2 | 3 | 4;
      operationId: string;
      ownershipKey: string;
      runId: string;
      sourceAssetId: string;
      sourceNodeId: string;
      title: string;
    }>) {
      if (command.files.length !== command.grid ** 2 ||
          !Number.isSafeInteger(command.expectedRevision)) {
        throw new Error("快速分割批次不完整");
      }
      const source = input.graph.snapshot().nodes.find((node) =>
        node.id === command.sourceNodeId
      );
      if (!source || source.type !== "image" ||
          source.data.assetId !== command.sourceAssetId) {
        throw new Error("原图片已发生变化，请重新打开快速分割");
      }
      const assets: DerivedImageAsset[] = [];
      let committed = false;
      try {
        for (const file of command.files) assets.push(await input.media.upload(file));
        const metadata = await Promise.all(
          assets.map((asset) => input.media.metadata(asset.assetId)),
        );
        const sizes = assets.map((asset) => input.size(asset.width, asset.height));
        const columnWidths = Array.from({ length: command.grid }, (_, column) =>
          Math.max(...sizes.filter((_, index) => index % command.grid === column)
            .map((size) => size.width)));
        const rowHeights = Array.from({ length: command.grid }, (_, row) =>
          Math.max(...sizes.slice(row * command.grid, (row + 1) * command.grid)
            .map((size) => size.height)));
        const columnOffsets = columnWidths.map((_, column) =>
          columnWidths.slice(0, column).reduce((total, width) => total + width + 40, 0));
        const rowOffsets = rowHeights.map((_, row) =>
          rowHeights.slice(0, row).reduce((total, height) => total + height + 40, 0));
        const nodes: ProbeNodeType[] = assets.map((asset, index) => {
          const row = Math.floor(index / command.grid);
          const column = index % command.grid;
          const size = sizes[index];
          return {
            data: {
              assetId: asset.assetId,
              ...metadata[index],
              imageAssetOrigin: "image-tool",
              imageHasTransparency: asset.hasTransparency === true,
              imageSrc: asset.url,
              imageToolOperation: "quick-split",
              imageToolOperationId: command.operationId,
              imageToolSourceAssetId: command.sourceAssetId,
              label: "Image",
              sourceKind: "image",
              title: `${command.title}-${row + 1}-${column + 1}`,
            },
            id: `image-quick-split-${command.operationId}-${index}`,
            position: { x: columnOffsets[column], y: rowOffsets[row] },
            selected: true,
            style: { ...size },
            type: "image",
          };
        });
        const edges: CuttableEdge[] = nodes.map((node) => ({
          id: `edge-${command.sourceNodeId}-${node.id}`,
          interactionWidth: 20,
          source: command.sourceNodeId,
          sourceHandle: "source",
          target: node.id,
          targetHandle: "target",
          type: "cuttable",
        }));
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
            const origin = findVacantImageToolPlacement({
              height: rowHeights.reduce((total, height) => total + height, 0) +
                40 * (command.grid - 1),
              nodes: snapshot.nodes,
              sourceNodeId: command.sourceNodeId,
              width: columnWidths.reduce((total, width) => total + width, 0) +
                40 * (command.grid - 1),
            });
            return {
              ...snapshot,
              edges: [...snapshot.edges, ...edges],
              nodes: [
                ...snapshot.nodes.map((node) => ({ ...node, selected: false })),
                ...nodes.map((node) => ({
                  ...node,
                  position: {
                    x: origin.x + node.position.x,
                    y: origin.y + node.position.y,
                  },
                })),
              ],
            };
          },
        };
        const result = input.commit
          ? await input.commit(graphCommand)
          : input.graph.apply(graphCommand);
        if (result.status !== "applied") {
          throw new Error("原图片或画布版本已发生变化，请重新打开快速分割");
        }
        committed = true;
        return {
          assetIds: assets.map((asset) => asset.assetId),
          kind: "derived-assets",
          operation: "quick-split",
          sourceAssetId: command.sourceAssetId,
        } as const;
      } finally {
        if (!committed) {
          await Promise.allSettled(
            assets.map((asset) => input.media.discard(asset.assetId)),
          );
        }
      }
    },
  } as const;
}
