import {
  isPersistedNodeKind,
  isTemplateNodeKind,
  persistedNodeKinds,
  type PersistedNodeKind,
  type TemplateNodeKind,
} from "./nodeVocabulary";

export type PersistedNodeSchema<Kind extends string = string> = Readonly<{
  kind: Kind;
  validate: (node: Readonly<Record<string, unknown>>) => boolean;
}>;

function defaultNodeShape(node: Readonly<Record<string, unknown>>) {
  return typeof node.id === "string" && node.id.length > 0 &&
    node.id.length <= 200 && node.data !== null &&
    typeof node.data === "object" && !Array.isArray(node.data);
}

export class PersistedNodeSchemaRegistry<Kind extends string = PersistedNodeKind> {
  readonly #schemas = new Map<Kind, PersistedNodeSchema<Kind>>();

  constructor(schemas: readonly PersistedNodeSchema<Kind>[] = []) {
    for (const schema of schemas) this.register(schema);
  }

  register(schema: PersistedNodeSchema<Kind>) {
    if (this.#schemas.has(schema.kind)) {
      throw new Error(`Persisted node schema is already registered: ${schema.kind}`);
    }
    this.#schemas.set(schema.kind, schema);
    return this;
  }

  accepts(node: unknown): boolean {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const record = node as Record<string, unknown>;
    if (typeof record.type !== "string") return false;
    return this.#schemas.get(record.type as Kind)?.validate(record) === true;
  }

  has(kind: unknown): kind is Kind {
    return typeof kind === "string" && this.#schemas.has(kind as Kind);
  }

  kinds(): Kind[] {
    return [...this.#schemas.keys()];
  }
}

export const persistedNodeSchemaRegistry = new PersistedNodeSchemaRegistry(
  persistedNodeKinds.map((kind) => ({ kind, validate: defaultNodeShape })),
);

export function isRegisteredPersistedNodeKind(
  value: unknown,
): value is PersistedNodeKind {
  return isPersistedNodeKind(value) && persistedNodeSchemaRegistry.has(value);
}

export function isRegisteredTemplateNodeKind(
  value: unknown,
): value is TemplateNodeKind {
  return isTemplateNodeKind(value) && persistedNodeSchemaRegistry.has(value);
}
