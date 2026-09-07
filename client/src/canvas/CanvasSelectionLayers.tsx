import type { ProbeNodeType } from "./ProbeNode";

/** CSS-only display priority: never feed these ranks back into the document. */
export function CanvasSelectionLayers({ nodes, primaryId }: {
  nodes: readonly ProbeNodeType[]; primaryId?: string;
}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rootOf = (node: ProbeNodeType) => {
    const seen = new Set<string>();
    while (node.parentId && byId.has(node.parentId) && !seen.has(node.id)) {
      seen.add(node.id); node = byId.get(node.parentId)!;
    }
    return node.id;
  };
  const active = [...new Set(nodes.filter((n) => n.selected).map(rootOf))];
  const primary = primaryId ? byId.get(primaryId) : undefined;
  if (primary?.selected) {
    const id = rootOf(primary); const index = active.indexOf(id);
    if (index >= 0) active.splice(index, 1);
    active.push(id);
  }
  if (!active.length) return null;
  const depth = (node: ProbeNodeType) => {
    let count = 0; const seen = new Set<string>();
    while (node.parentId && byId.has(node.parentId) && !seen.has(node.id)) {
      seen.add(node.id); node = byId.get(node.parentId)!; count++;
    }
    return count;
  };
  const baseZ = (node: ProbeNodeType) => {
    let z = Number(node.zIndex ?? 0); let offset = 0; const seen = new Set<string>();
    while (node.parentId && byId.has(node.parentId) && !seen.has(node.id)) {
      seen.add(node.id); node = byId.get(node.parentId)!; offset++;
      z = Math.max(z, Number(node.zIndex ?? 0) + offset);
    }
    return z;
  };
  const ordered = nodes.map((node, index) => ({ node, index, priority: active.indexOf(rootOf(node)) + 1, depth: depth(node) }))
    .sort((a, b) => a.priority - b.priority ||
      (a.priority ? a.depth - b.depth : 0) ||
      baseZ(a.node) - baseZ(b.node) || a.index - b.index);
  const rules = ordered.map(({ node }, index) => {
    const id = CSS.escape(node.id);
    return `.react-flow__node[data-id="${id}"]{z-index:${index + 1}!important}` +
      `.react-flow__node-toolbar[data-id="${id}"]{z-index:${nodes.length + index + 1}!important}` +
      // An expanded image menu must sit above the same node's Creator.
      `.react-flow__node-toolbar[data-id="${id}"][data-image-more-open="true"]{z-index:${nodes.length * 2 + index + 1}!important}`;
  }).join("\n");
  return <style data-testid="canvas-selection-layers">{rules}</style>;
}
