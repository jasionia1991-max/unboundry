import type { GenerationCapabilityKind } from "./nodeVocabulary";
import type { ModelParameterSchema } from "./modelParameters";
import type { ProviderProtocol } from "./relayProtocols";
import type {
  ModelContractConnectorFamily,
  ModelExecutionContract,
} from "./modelExecutionContracts";

export type ModelContractEvidence =
  | "EXACT"
  | "GENERIC_GUESS"
  | "SPECIALIZED"
  | "UNKNOWN";

export type ModelReleaseDocument = Readonly<{
  capability: GenerationCapabilityKind;
  capabilitySchema: ModelParameterSchema;
  connectorFamily: ModelContractConnectorFamily;
  connectorVersion: number;
  documentation: readonly Readonly<{ checkedAt: string; url: string }>[];
  evidence: ModelContractEvidence;
  executionContract: ModelExecutionContract;
  modelId: string;
  providerModelId: string;
  providerProfileId: string;
  providerProtocol: ProviderProtocol;
  runtime: "blocked" | "declarative" | "specialized-code";
}>;

export type ModelContractValidation = Readonly<{
  compilerHash: string;
  impact: Readonly<{
    incompatibleTemplateIds: readonly string[];
    preexistingIncompatibleTemplateIds?: readonly string[];
    templateIds: readonly string[];
  }>;
  paidProviderRequests: 0;
  preview: Readonly<{
    modes: readonly Readonly<{
      blockedReason?: string;
      body: unknown;
      evidence?: ModelContractEvidence;
      method: string;
      modeId: string;
      path: string;
      query: unknown;
      runtime?: "blocked" | "declarative";
    }>[];
  }>;
  validatedAt: string;
}>;

export type ModelContractDraft = Readonly<{
  document: ModelReleaseDocument;
  draftVersion: number;
  modelId: string;
  savedAt: string;
  validation?: ModelContractValidation;
}>;

export type ModelReleaseRevision = Readonly<{
  createdAt: string;
  document: ModelReleaseDocument;
  hash: string;
  modelId: string;
  predecessorRevisionId?: string;
  revisionId: string;
  revisionNumber: number;
  validation: ModelContractValidation;
}>;

export type ModelContractState = Readonly<{
  active?: ModelReleaseRevision;
  draft?: ModelContractDraft;
  draftVersion: number;
  history: readonly ModelReleaseRevision[];
  revoked: boolean;
}>;
