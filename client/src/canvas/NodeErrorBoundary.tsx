import { memo, type ComponentType } from "react";
import type { NodeProps, NodeTypes } from "@xyflow/react";
import { ErrorBoundary, NodeErrorFallback } from "../ui/ErrorBoundary";

/**
 * Wraps a canvas node renderer once, at registration time, so the wrapper
 * identity is stable and React Flow never remounts nodes because of it.
 */
export function withNodeErrorBoundary(Renderer: NodeTypes[string]): NodeTypes[string] {
  const Inner = Renderer as ComponentType<NodeProps>;
  function NodeWithErrorBoundary(props: NodeProps) {
    return (
      <ErrorBoundary
        fallback={(reset) => <NodeErrorFallback nodeId={props.id} reset={reset} />}
        label={`node:${props.type ?? "unknown"}`}
      >
        <Inner {...props} />
      </ErrorBoundary>
    );
  }
  const name = (Inner as { displayName?: string; name?: string }).displayName ??
    (Inner as { name?: string }).name ?? "Node";
  NodeWithErrorBoundary.displayName = `NodeErrorBoundary(${name})`;
  return memo(NodeWithErrorBoundary) as unknown as NodeTypes[string];
}
