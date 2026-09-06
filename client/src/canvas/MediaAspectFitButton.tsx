import { useState } from "react";
import { useCanvasGraphMutation } from "./CanvasGraphMutationContext";
import { useWorkflowExecution } from "../generation/WorkflowExecutionProvider";
import { fitVisualMediaSize, validMediaDimensions } from "../../../types/mediaGeometry";

export function MediaAspectFitButton({ nodeId }: { nodeId: string }) {
  const { mutateGraph, readCanvasNode, canvasMutationPendingNodeIds } = useCanvasGraphMutation();
  const { lockedNodeIds } = useWorkflowExecution();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const node = readCanvasNode(nodeId);
  const fitted = node && validMediaDimensions(node.data.mediaWidth, node.data.mediaHeight)
    ? fitVisualMediaSize(Number(node.data.mediaWidth), Number(node.data.mediaHeight)) : undefined;
  const alreadyFits = node?.data.mediaSizingMode === "auto" && fitted &&
    node.style?.width === fitted.width && node.style?.height === fitted.height;
  const disabled = alreadyFits || busy || lockedNodeIds.has(nodeId) || canvasMutationPendingNodeIds.has(nodeId) ||
    !node || !validMediaDimensions(node.data.mediaWidth, node.data.mediaHeight);
  return <span className="media-aspect-fit-action">
    <button aria-label="按素材比例适配" data-tooltip="按素材比例适配" disabled={disabled}
      type="button" onClick={async () => {
        setBusy(true); setError("");
        try {
          const applied = await mutateGraph(({ nodes, edges }) => ({ edges, nodes: nodes.map((current) => {
            if (current.id !== nodeId || !validMediaDimensions(current.data.mediaWidth, current.data.mediaHeight)) return current;
            return { ...current, width: undefined, height: undefined, measured: undefined,
              data: { ...current.data, mediaSizingMode: "auto" as const },
              style: { ...current.style, ...fitVisualMediaSize(Number(current.data.mediaWidth), Number(current.data.mediaHeight)) } };
          }) }));
          if (!applied) setError("未完成适配，请待画布保存完成后重试");
        } catch { setError("适配未保存，请重试"); }
        finally { setBusy(false); }
      }}><svg aria-hidden="true" viewBox="0 0 20 20"><rect x="5" y="2" width="10" height="16" rx="1"/><path d="M2 6V2h4M14 2h4v4M2 14v4h4M14 18h4v-4"/></svg></button>
    {error && <span role="status" className="media-aspect-fit-error">{error}</span>}
  </span>;
}
