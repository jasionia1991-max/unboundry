import type { GenerationCapabilityKind } from "./nodeVocabulary";

export type ModelContractConnectorFamily =
  | "openai-chat"
  | "openai-responses"
  | "claude-messages"
  | "gemini-generate-content"
  | "gpt-image"
  | "generic-async-media"
  | "ark-native"
  | "mureka-native"
  | "specialized-code";

export type ModelContractSource =
  | Readonly<{ kind: "model-id" }>
  | Readonly<{ kind: "prompt" }>
  | Readonly<{ kind: "parameter"; key: string }>
  | Readonly<{ kind: "role"; roleId: string }>
  | Readonly<{ kind: "constant"; value: boolean | number | string }>
  | Readonly<{ kind: "task-id" }>;

export type ModelContractTarget = Readonly<{
  location: "form" | "json" | "query";
  path: string;
}>;

export type ModelContractBinding = Readonly<{
  source: ModelContractSource;
  target: ModelContractTarget;
  transform?: "array" | "boolean" | "number" | "omit-empty" | "string";
}>;

export type ModelContractRole = Readonly<{
  id: string;
  kind: GenerationCapabilityKind;
  maxItems: number;
  minItems: number;
  ordered: boolean;
  shape: "file-id" | "url";
}>;

export type ModelExecutionMode = Readonly<{
  bindings: readonly ModelContractBinding[];
  /** Mode-level evidence wins over a model-level summary for admission. */
  evidence?: "EXACT" | "GENERIC_GUESS" | "SPECIALIZED" | "UNKNOWN";
  id: string;
  prompt: "optional" | "required";
  roles: readonly ModelContractRole[];
  runtime?: "blocked" | "declarative";
}>;

export type ModelExecutionContract = Readonly<{
  connectorFamily: ModelContractConnectorFamily;
  connectorVersion: number;
  create: Readonly<{
    method: "POST";
    path: string;
    taskIdPath?: string;
  }>;
  modes: readonly ModelExecutionMode[];
  poll?: Readonly<{
    method: "GET" | "POST";
    path: string;
    taskIdTarget: ModelContractTarget;
  }>;
  result: Readonly<{
    resultPath: string;
    states?: Readonly<{
      failed: readonly string[];
      running: readonly string[];
      succeeded: readonly string[];
    }>;
  }>;
  version: 1;
}>;

export type ModelContractRuntimeInput = Readonly<{
  kind: GenerationCapabilityKind;
  order: number;
  roleId: string;
  value: string;
}>;
