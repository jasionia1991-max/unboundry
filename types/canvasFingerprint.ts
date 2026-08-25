type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike | undefined };

function canonical(value: unknown): JsonLike | undefined {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined;
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((item) => canonical(item) ?? null);
  }
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, item]) => {
        const cleaned = canonical(item);
        return cleaned === undefined ? [] : [[key, cleaned] as const];
      }),
  );
}

function durableNode(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const node = value as Record<string, unknown>;
  const {
    dragging: _dragging,
    measured: _measured,
    resizing: _resizing,
    selected: _selected,
    ...durable
  } = node;
  return durable;
}

function durableEdge(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const edge = value as Record<string, unknown>;
  const { selected: _selected, ...durable } = edge;
  const data: Record<string, unknown> | unknown =
    durable.data && typeof durable.data === "object" && !Array.isArray(durable.data)
      ? { ...(durable.data as Record<string, unknown>) }
      : durable.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    delete (data as Record<string, unknown>).cutIndicator;
  }
  return { ...durable, data };
}

export function durableCanvasNodes(nodes: ReadonlyArray<unknown>) {
  return nodes.map(durableNode);
}

export function durableCanvasEdges(edges: ReadonlyArray<unknown>) {
  return edges.map(durableEdge);
}

export function canvasGraphFingerprint(input: {
  edges: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<unknown>;
}) {
  return JSON.stringify(
    canonical({
      edges: durableCanvasEdges(input.edges),
      nodes: durableCanvasNodes(input.nodes),
    }),
  );
}

/**
 * Represents the complete durable canvas document. Viewport changes still save
 * and restore normally, but generation uses canvasGraphFingerprint so a pure
 * pan or zoom never masquerades as an unsaved node/edge change.
 */
export function canvasDocumentFingerprint(input: {
  edges: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<unknown>;
  viewport: { x: number; y: number; zoom: number };
}) {
  return JSON.stringify(
    canonical({
      edges: durableCanvasEdges(input.edges),
      nodes: durableCanvasNodes(input.nodes),
      viewport: input.viewport,
    }),
  );
}

function stableFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableFingerprintValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, stableFingerprintValue(item)]),
    );
  }
  return value;
}

/** Cross-runtime deterministic identity for bounded JSON-compatible values. */
export function stableValueFingerprint(value: unknown) {
  const source = JSON.stringify(stableFingerprintValue(value));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}
