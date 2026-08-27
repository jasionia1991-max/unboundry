import type { ProviderDriver } from "../types/providerVocabulary";
import type { ProviderProtocol } from "../types/relayProtocols";
import type { ProviderReferenceLease } from "./providerReferenceStore";

export type MediaGenerationKind = "audio" | "image" | "video";

export type MediaGenerationProviderRegistration = Readonly<{
  driver: ProviderDriver;
  kind: MediaGenerationKind;
  protocol: ProviderProtocol;
}>;

export type MediaGenerationRequest = Readonly<{
  inputs: readonly ProviderReferenceLease[];
  kind: MediaGenerationKind;
  model: string;
  parameters: Readonly<Record<string, unknown>>;
  prompt: string;
}>;

export type MediaGenerationExecution = Readonly<{
  absoluteDeadline: string;
  attempt: number;
  beforeProviderRequest: () => void;
  fetcher: typeof fetch;
  metadata?: Readonly<Record<string, unknown>>;
  onProviderResponseEvidence?: (evidence: Readonly<{
    contentType?: string;
    failureStage?: string;
    fieldPaths: readonly string[];
    httpStatus?: number;
    providerRequestId?: string;
    responseBytes?: number;
    structureHash?: string;
  }>) => void;
  profile: Readonly<{
    apiKey?: string;
    baseUrl: string;
    driver: ProviderDriver;
    id: string;
  }>;
  signal?: AbortSignal;
}>;

export type MediaGenerationSubmission =
  | Readonly<{
      providerTaskMayStillRun: false;
      rawResult: unknown;
      state: "completed";
    }>
  | Readonly<{
      providerTaskId: string;
      providerTaskMayStillRun: true;
      state: "accepted";
    }>;

export type MediaProviderTaskSnapshot = Readonly<{
  failureMessage?: string;
  progress?: number;
  providerTaskId: string;
  rawResult?: unknown;
  refunded?: true;
  state: "cancelled" | "failed" | "queued" | "running" | "succeeded";
}>;

export type MediaProviderRecovery =
  | Readonly<{ state: "ambiguous" | "not-found" }>
  | Readonly<{ providerTaskId: string; state: "matched" }>;

export type MediaProviderCancellation = Readonly<{
  providerTaskId: string;
  state: "cancelled" | "unsupported";
}>;

export type NormalizedMediaProviderOutput = Readonly<{
  bytes?: Uint8Array;
  contentType?: string;
  durationSeconds?: number;
  kind: MediaGenerationKind;
  providerUsageTokens?: number;
  transientUrl?: string;
}>;

export type NormalizedMediaProviderResult = Readonly<{
  actualCostMicrounits?: number;
  outputs: readonly NormalizedMediaProviderOutput[];
}>;

export class MediaGenerationProviderError extends Error {
  constructor(
    readonly code:
      | "AUTH"
      | "CANCELLED"
      | "FORMAT"
      | "NETWORK"
      | "RATE_LIMIT"
      | "REMOTE"
      | "TIMEOUT",
    message: string,
    readonly providerTaskMayStillRun = false,
    readonly refunded = false,
  ) {
    super(message);
    this.name = "MediaGenerationProviderError";
  }
}

/** Provider transport lifecycle; durable task/attempt transitions stay outside. */
export interface MediaGenerationProvider {
  readonly id: string;
  readonly registrations: readonly MediaGenerationProviderRegistration[];

  cancel(
    providerTaskId: string,
    execution: MediaGenerationExecution,
  ): Promise<MediaProviderCancellation>;
  inspect(
    providerTaskId: string,
    execution: MediaGenerationExecution,
  ): Promise<MediaProviderTaskSnapshot>;
  normalize(rawResult: unknown): NormalizedMediaProviderResult;
  recover(
    request: MediaGenerationRequest,
    execution: MediaGenerationExecution,
  ): Promise<MediaProviderRecovery>;
  submit(
    request: MediaGenerationRequest,
    execution: MediaGenerationExecution,
  ): Promise<MediaGenerationSubmission>;
}

function registrationKey(
  registration: MediaGenerationProviderRegistration,
) {
  return `${registration.driver}:${registration.protocol}:${registration.kind}`;
}

export class MediaGenerationProviderRegistry {
  readonly #providers = new Map<string, MediaGenerationProvider>();

  constructor(providers: readonly MediaGenerationProvider[]) {
    for (const provider of providers) {
      for (const registration of provider.registrations) {
        const key = registrationKey(registration);
        if (this.#providers.has(key)) {
          throw new Error(`Duplicate Media Provider registration: ${key}`);
        }
        this.#providers.set(key, provider);
      }
    }
  }

  resolve(
    profile: Readonly<{ driver: ProviderDriver }>,
    protocol: ProviderProtocol,
    kind: MediaGenerationKind,
  ) {
    const provider = this.#providers.get(registrationKey({
      driver: profile.driver,
      kind,
      protocol,
    }));
    if (!provider) {
      throw new MediaGenerationProviderError(
        "FORMAT",
        "媒体模型配置已失效",
      );
    }
    return provider;
  }
}
