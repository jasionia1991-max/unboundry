import type { ProviderProfile } from "./providerProfiles";
import type { ProviderProtocol } from "../types/relayProtocols";

export const textGenerationProtocols = [
  "native",
  "openai-chat",
  "openai-responses",
  "claude-messages",
  "gemini-generate-content",
] as const satisfies readonly ProviderProtocol[];

export type TextGenerationProtocol =
  (typeof textGenerationProtocols)[number];

export function isTextGenerationProtocol(
  value: ProviderProtocol,
): value is TextGenerationProtocol {
  return textGenerationProtocols.includes(value as TextGenerationProtocol);
}

export type TextGenerationInput = Readonly<{
  fileId?: string;
  kind: "audio" | "image" | "text" | "video";
  mimeType?: string;
  order: number;
  role: "context-audio" | "context-image" | "context-text" | "context-video";
  text?: string;
  transientUrl?: string;
}>;

export type TextGenerationRequest = Readonly<{
  inputs: readonly TextGenerationInput[];
  maxOutputTokens?: number;
  model: string;
  prompt: string;
  protocol: TextGenerationProtocol;
  temperature?: number;
  thinkingLevel?: "minimal" | "medium";
}>;

export type TextGenerationResult = Readonly<{
  providerUsageTokens?: number;
  text: string;
}>;

export type TextGenerationErrorCode =
  | "AUTH"
  | "CANCELLED"
  | "FORMAT"
  | "NETWORK"
  | "PERMISSION"
  | "PROVIDER_REQUEST_FAILED"
  | "PROVIDER_RESULT_FORMAT"
  | "PROXY_CONFIGURATION"
  | "RATE_LIMIT"
  | "REFERENCE_SIGN_FAILED"
  | "REFERENCE_STORAGE_BUSY"
  | "REFERENCE_UPLOAD_FAILED"
  | "REMOTE"
  | "TIMEOUT";

export class TextGenerationProviderError extends Error {
  constructor(
    readonly code: TextGenerationErrorCode,
    message: string,
    readonly providerTaskMayStillRun = false,
  ) {
    super(message);
    this.name = "TextGenerationProviderError";
  }
}

export type TextGenerationProviderRegistration = Readonly<{
  driver: ProviderProfile["driver"];
  protocol: TextGenerationProtocol;
}>;

export type TextGenerationProviderExecution = Readonly<{
  beforeProviderRequest: () => void;
  fetcher: typeof fetch;
  profile: ProviderProfile;
  releaseProviderLease: () => void;
  signal?: AbortSignal;
  usePinnedTransport?: boolean;
}>;

/**
 * The synchronous Text Provider port. Task orchestration owns durable state,
 * leases and attempt evidence; concrete adapters own request serialization,
 * transport selection and response normalization.
 */
export interface TextGenerationProvider {
  readonly id: string;
  readonly registrations: readonly TextGenerationProviderRegistration[];

  generate(
    request: TextGenerationRequest,
    execution: TextGenerationProviderExecution,
  ): Promise<TextGenerationResult>;
}
