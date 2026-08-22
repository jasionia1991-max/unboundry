import {
  generationCapabilityKinds,
  type GenerationCapabilityKind,
} from "../types/nodeVocabulary";

export type GenerationCapability<Kind extends string = string> = Readonly<{
  kind: Kind;
}>;

export class GenerationCapabilityRegistry<
  Kind extends string = GenerationCapabilityKind,
> {
  readonly #capabilities = new Map<Kind, GenerationCapability<Kind>>();

  constructor(capabilities: readonly GenerationCapability<Kind>[] = []) {
    for (const capability of capabilities) this.register(capability);
  }

  register(capability: GenerationCapability<Kind>) {
    if (this.#capabilities.has(capability.kind)) {
      throw new Error(`Generation capability is already registered: ${capability.kind}`);
    }
    this.#capabilities.set(capability.kind, capability);
    return this;
  }

  get(kind: unknown): GenerationCapability<Kind> | undefined {
    return typeof kind === "string"
      ? this.#capabilities.get(kind as Kind)
      : undefined;
  }

  has(kind: unknown): kind is Kind {
    return this.get(kind) !== undefined;
  }

  kinds(): Kind[] {
    return [...this.#capabilities.keys()];
  }
}

export const generationCapabilityRegistry = new GenerationCapabilityRegistry(
  generationCapabilityKinds.map((kind) => ({ kind })),
);
