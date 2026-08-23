import type { ProbeNodeType } from "../canvas/ProbeNode";
import type { CanvasGraphCommandPort } from "../canvas/canvasPorts";
import type { CuttableEdge } from "../canvas/canvasTypes";
import type {
  DerivedImageAsset,
  DerivedImageMediaPort,
} from "./derivedImageToolUseCase";

export function createBatchDerivedImageToolUseCase(input: Readonly<{
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
        const sourceWidth = typeof source.style?.width === "number"
          ? source.style.width
          : 250;
        const nodes: ProbeNodeType[] = assets.map((asset, index) => {
          const row = Math.floor(index / command.grid);
          const column = index % command.grid;
          const size = input.size(asset.width, asset.height);
          return {
            data: {
              assetId: asset.assetId,
              ...metadata[index],
              imageSrc: asset.url,
              label: "Image",
              sourceKind: "image",
              title: `${command.title}-${row + 1}-${column + 1}`,
            },
            id: `image-quick-split-${command.operationId}-${index}`,
            position: {
              x: source.position.x + sourceWidth + 140 + column * (size.width + 40),
              y: source.position.y + row * (size.height + 40),
            },
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
        const result = input.graph.apply({
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
            edges: [...snapshot.edges, ...edges],
            nodes: [
              ...snapshot.nodes.map((node) => ({ ...node, selected: false })),
              ...nodes,
            ],
          }),
        });
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
