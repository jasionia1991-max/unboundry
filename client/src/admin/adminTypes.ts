import { type ModelCapability, type ModelParameterSchema } from "../../../types/modelParameters";
import { type ProviderProtocol } from "../../../types/relayProtocols";

export type AdminModel = {
  archived?: boolean;
  archivedAt?: string;
  canDelete?: boolean;
  capability: ModelCapability;
  contract?: {
    activeRevision?: number;
    evidence?: "EXACT" | "GENERIC_GUESS" | "SPECIALIZED" | "UNKNOWN";
    revoked: boolean;
    status: "draft" | "missing" | "published" | "revoked";
  };
  deleteBlockedReason?: string;
  displayName: string;
  enabled: boolean;
  everPublished?: boolean;
  id: string;
  isDefault: boolean;
  parameterConstraints?: ModelParameterSchema;
  parameterSchema?: ModelParameterSchema;
  providerConnected: boolean;
  providerDriver: ProviderDriver;
  providerProfileId: string;
  providerModelId: string;
  providerName: string;
  providerProtocol?: ProviderProtocol;
  references?: {
    activeTasks: number;
    canvasDocuments: number;
    tasks: number;
  };
  sortOrder: number;
  status: "disabled" | "draft" | "published";
};

export type ProviderDriver =
  | "mureka"
  | "multi-protocol-relay"
  | "openai-compatible"
  | "openrouter"
  | "volcengine-ark";

export type AdminProviderProfile = {
  apiKeyMask?: string;
  baseUrl: string;
  driver: ProviderDriver;
  hasApiKey: boolean;
  id: string;
  keyStatus: "unchecked" | "valid" | "invalid" | "unknown";
  lastCheckedAt?: string;
  lastVerifiedAt?: string;
  label: string;
  modelCatalog?: AdminProviderModelCatalog;
  readOnlySummary?: AdminProviderReadOnlySummary;
  status: "saved" | "verified";
  updatedAt: string;
};

export type AdminProviderModelCatalog = {
  accessKeyIdMask?: string;
  capabilityCounts?: {
    audio: number;
    image: number;
    text: number;
    unknown: number;
    video: number;
  };
  catalogSource?: "enhanced" | "enhanced+basic" | "basic-fallback";
  checkedAt?: string;
  configuredModelCount: number;
  controlRequestCount: number;
  credentialMode?: "none" | "profile-api-key" | "separate";
  description?: string;
  endpointCount: number;
  endpointLabel?: string;
  errorCode?: string;
  fallbackReason?: "EMPTY" | "NOT_SUPPORTED";
  hasCredentials: boolean;
  keyStatus: "invalid" | "permission" | "unchecked" | "unknown" | "valid";
  modelLabel?: string;
  modelCount: number;
  projectName?: string;
  rejectedModelCount?: number;
  reportedModelCount?: number;
  scope?: "account" | "manual" | "public";
  snapshotStale: boolean;
  support?: "full" | "manual" | "models" | "unsupported";
  supported?: boolean;
  supportsEndpoints?: boolean;
  supportsImport?: boolean;
  supportsReadOnlyManagement?: boolean;
  supportsSync?: boolean;
  syncedAt?: string;
};

export type AdminProviderDiscoveredModel = {
  capability: ModelCapability | "unknown";
  discoveryId: string;
  displayName: string;
  metadata?: {
    contextLength?: number;
    inputModalities?: string[];
    modelType?: string;
    outputModalities?: string[];
    pricingHint?: string;
    pricingSummary?: string;
    protocols?: ProviderProtocol[];
    supportedParameters?: string[];
  };
  providerModelId: string;
  source: string;
  status: string;
};

export type AdminProviderReadOnlyMetric = {
  available?: boolean;
  checkedAt?: string;
  parsed?: boolean;
  summary?: Record<string, boolean | number | string | null>;
};

export type AdminProviderReadOnlySummary = {
  balance?: AdminProviderReadOnlyMetric;
  checkedAt?: string;
  usage?: AdminProviderReadOnlyMetric;
};

export type AdminProviderReadOnlyDescriptor = {
  available: boolean;
  resources?: {
    balance?: { supported?: boolean };
    usage?: { supported?: boolean };
  };
};

export type AdminProviderCatalogDetails = {
  endpoints: Array<{
    id: string;
    name: string;
    providerModelId?: string;
    source: string;
    status: string;
  }>;
  models: AdminProviderDiscoveredModel[];
  syncedAt?: string;
};

export type AdminProviderStatus = {
  paidProviderRequests: 0;
  profiles: AdminProviderProfile[];
  providerSecretsStoredInBrowser: false;
  realGenerationEnabled: false;
  supportedDrivers: ProviderDriver[];
};

export type AdminStorageStatus = {
  activeBackend: "local" | "oss";
  browserStoresSecrets: false;
  cloudRequestsEnabled: boolean;
  warning?: string;
  local: {
    bytes: number;
    checksummed: number;
    enabled: true;
    objects: number;
  };
  oss: {
    activeProfileId: string;
    effectiveMediaRoutingEnabled: boolean;
    mediaRoutingEnabled: boolean;
    objectCounts: Record<string, number>;
    profiles: AdminStorageProfile[];
    provider: "aliyun-oss";
    rawMediaRoutingEnabled: boolean;
    readableProfileAvailable: boolean;
    sdkInstalled: true;
  };
};

export type AdminStorageProfile = {
  accessKeyIdMask: string;
  bucket: string;
  endpoint: string;
  hasAccessKeySecret: boolean;
  id: string;
  label: string;
  lastVerifiedAt?: string;
  provider: "aliyun-oss";
  region: string;
  status: "active" | "draft" | "verified";
  updatedAt: string;
};

export type StorageTestFeedback = {
  message: string;
  status: "error" | "success";
};

export type GenerationSafetySettings = {
  audioConcurrency: number;
  cooldownMinutes: number;
  emergencyStop: boolean;
  failureThreshold: number;
  globalEnabled: boolean;
  imageConcurrency: number;
  perUserConcurrency: number;
  requestsPerMinute: number;
  runningTaskPolicy: "cancel" | "wait";
  textConcurrency: number;
  updatedAt: string;
  videoConcurrency: number;
};

export type AdminGenerationSafetyStatus = {
  historicalEstimatedProviderAttempts?: number;
  paidProviderRequests: number;
  providerConfigured: boolean;
  settings: GenerationSafetySettings;
};

type ApiContractOperation = {
  operationId: string;
  summary: string;
};

export type ApiContractDocument = {
  info: {
    description: string;
    title: string;
    version: string;
  };
  openapi: string;
  paths: Record<string, Record<string, ApiContractOperation>>;
};
