type JsonLike = null | boolean | number | string | JsonLike[] | {
  [key: string]: JsonLike | undefined;
};

function canonical(value: unknown): JsonLike | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
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

function durableNode(value: object) {
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

function durableEdge(value: object) {
  const edge = value as Record<string, unknown>;
  const { selected: _selected, ...durable } = edge;
  const data: Record<string, unknown> | unknown = durable.data && typeof durable.data === "object"
    ? { ...(durable.data as Record<string, unknown>) }
    : durable.data;
  if (data && typeof data === "object") {
    delete (data as Record<string, unknown>).cutIndicator;
  }
  return { ...durable, data };
}

/**
 * Represents only durable canvas state. Selection, measurements and edge hover
 * chrome do not trigger saves, while every meaningful node/edge/viewport change
 * does, regardless of which UI command produced it.
 */
export function canvasDocumentFingerprint(input: {
  edges: ReadonlyArray<object>;
  nodes: ReadonlyArray<object>;
  viewport: { x: number; y: number; zoom: number };
}) {
  return JSON.stringify(canonical({
    edges: input.edges.map(durableEdge),
    nodes: input.nodes.map(durableNode),
    viewport: input.viewport,
  }));
}
