import type { ProbeNodeType } from "../canvas/ProbeNode";

/**
 * React Flow's viewport renderer keeps an explicitly dragging node mounted.
 * Use that renderer-only signal for the active workflow lease. The returned
 * clones are never committed to canvas state or persistence.
 */
export function retainWorkflowNodesForRender(
  nodes: readonly ProbeNodeType[],
  retainedNodeIds: ReadonlySet<string>,
): ProbeNodeType[] {
  if (retainedNodeIds.size === 0) return nodes as ProbeNodeType[];
  return nodes.map((node) => {
    if (!retainedNodeIds.has(node.id) || node.type === "group") return node;
    const className = [node.className, "workflow-run-locked"]
      .filter(Boolean)
      .join(" ");
    return {
      ...node,
      className,
      dragging: true,
      // These fields are renderer-only. Keeping the original node untouched
      // lets React Flow mount an off-screen participant without exposing it
      // to pointer, keyboard, selection, resize, or delete interactions.
      connectable: false,
      deletable: false,
      draggable: false,
      selectable: false,
      selected: false,
      style: {
        ...node.style,
        pointerEvents: "none",
      },
    };
  });
}
