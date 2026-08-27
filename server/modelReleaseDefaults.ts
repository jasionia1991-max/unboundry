import type { ModelParameterSchema } from "../types/modelParameters";
import type { ProviderProtocol } from "../types/relayProtocols";
import type { GenerationCapabilityKind } from "../types/nodeVocabulary";
import type { ModelExecutionContract } from "../types/modelExecutionContracts";
import type {
  ModelContractEvidence,
  ModelReleaseDocument,
} from "../types/modelReleaseRevisions";

export type ModelReleaseSeed = Readonly<{
  capability: GenerationCapabilityKind;
  capabilitySchema: ModelParameterSchema;
  providerDriver: string;
  providerModelId: string;
  providerProfileId: string;
  providerProtocol: ProviderProtocol;
}>;

const uiOnlyParameters = new Set(["inputMode", "outputCount"]);
const gkVideoParameterTargets: Readonly<Record<string, string>> = Object.freeze({
  aspectRatio: "aspect_ratio",
  duration: "duration",
  generateAudio: "generate_audio",
  multiShot: "multi_shot",
  resolution: "resolution",
});

const verifiedModelDocumentation: Readonly<Record<string, string>> = Object.freeze({
  "doubao-seed-2-0-lite-260428": "https://www.volcengine.com/docs/82379/1330310",
  "doubao-seedance-2-0-mini-260615": "https://www.volcengine.com/docs/82379/2222480",
  "gemini-3-pro-image-preview": "https://ai.google.dev/gemini-api/docs/image-generation",
  "gpt-image-2": "https://platform.openai.com/docs/guides/image-generation",
  "grok-imagine-video-1.5-preview": "https://docs.x.ai/developers/models/grok-imagine-video",
  "kling-v3-omni-cankao": "https://app.klingai.com/cn/quickstart/klingai-video-3-model-user-guide",
  "mureka-9": "https://platform.mureka.ai/docs/en/changelog.html",
});

function documentation(providerModelId: string) {
  const url = verifiedModelDocumentation[providerModelId];
  return url ? [{ checkedAt: "2026-08-27", url }] : [];
}

export function gkVideoExecutionContract(
  capabilitySchema: ModelParameterSchema,
): ModelExecutionContract {
  const parameterBindings = capabilitySchema.fields
    .filter((field) => !uiOnlyParameters.has(field.key))
    .flatMap((field) => {
      const target = gkVideoParameterTargets[field.key];
      return target
        ? [{
            source: { key: field.key, kind: "parameter" as const },
            target: { location: "json" as const, path: `params.${target}` },
          }]
        : [];
    });
  return Object.freeze({
  connectorFamily: "generic-async-media",
  connectorVersion: 1,
  create: { method: "POST", path: "/v1/media/generate", taskIdPath: "task_id" },
  modes: [
    {
      bindings: [
        { source: { kind: "model-id" }, target: { location: "json", path: "model" } },
        { source: { kind: "prompt" }, target: { location: "json", path: "prompt" } },
        ...parameterBindings,
      ],
      evidence: "UNKNOWN",
      id: "text-to-video",
      prompt: "required",
      roles: [],
      runtime: "blocked",
    },
    {
      bindings: [
        { source: { kind: "model-id" }, target: { location: "json", path: "model" } },
        { source: { kind: "prompt" }, target: { location: "json", path: "prompt" } },
        ...parameterBindings,
        {
          source: { kind: "role", roleId: "first-frame" },
          target: { location: "json", path: "params.images" },
          transform: "array",
        },
      ],
      evidence: "EXACT",
      id: "first-frame-to-video",
      prompt: "required",
      roles: [{
        id: "first-frame",
        kind: "image",
        maxItems: 1,
        minItems: 1,
        ordered: true,
        shape: "url",
      }],
      runtime: "declarative",
    },
  ],
  poll: {
    method: "GET",
    path: "/v1/media/status",
    taskIdTarget: { location: "query", path: "task_id" },
  },
  result: {
    resultPath: "result_url",
    states: {
      failed: ["failed"],
      running: ["pending", "running"],
      succeeded: ["success"],
    },
  },
  version: 1,
  } satisfies ModelExecutionContract);
}

function connector(seed: ModelReleaseSeed) {
  if (seed.providerProtocol === "gpt-image") return "gpt-image" as const;
  if (["openai-chat", "openai-responses", "claude-messages", "gemini-generate-content"]
    .includes(seed.providerProtocol)) return seed.providerProtocol as
      | "openai-chat" | "openai-responses" | "claude-messages" |
        "gemini-generate-content";
  if (seed.providerDriver === "volcengine-ark") return "ark-native" as const;
  if (seed.providerDriver === "mureka") return "mureka-native" as const;
  return "specialized-code" as const;
}

function evidence(modelId: string): ModelContractEvidence {
  if (modelId === "gpt-image-2" || modelId === "grok-video-3") return "EXACT";
  if (modelId === "doubao-tts-2.0") return "SPECIALIZED";
  if (modelId === "kwvideo-v2") return "UNKNOWN";
  return "SPECIALIZED";
}

function endpoint(family: ReturnType<typeof connector>) {
  if (family === "gpt-image") return "/v1/images/generations";
  if (family === "claude-messages") return "/v1/messages";
  if (family === "gemini-generate-content") return "/v1beta/models/generate-content";
  if (family === "ark-native") return "/api/v3/chat/completions";
  if (family === "mureka-native") return "/v1/song/generate";
  if (family === "openai-responses") return "/v1/responses";
  if (family === "openai-chat") return "/v1/chat/completions";
  return "/v1/media/generate";
}

function resultPath(family: ReturnType<typeof connector>) {
  if (family === "gpt-image") return "data.0.b64_json" as const;
  if (family === "claude-messages") return "content.0.text" as const;
  if (family === "gemini-generate-content") {
    return "candidates.0.content.parts.0.text" as const;
  }
  if (family === "openai-chat" || family === "openai-responses" ||
      family === "ark-native") return "output.0.content.0.text" as const;
  return "result_url" as const;
}

function specializedContract(seed: ModelReleaseSeed): ModelExecutionContract {
  const family = connector(seed);
  return {
    connectorFamily: family,
    connectorVersion: 1,
    create: { method: "POST", path: endpoint(family) },
    modes: [{
      bindings: [
        { source: { kind: "model-id" }, target: { location: "json", path: "model" } },
        { source: { kind: "prompt" }, target: { location: "json", path: "prompt" } },
      ],
      id: "specialized-code",
      prompt: "required",
      roles: [],
    }],
    result: { resultPath: resultPath(family) },
    version: 1,
  };
}

export function defaultModelReleaseDocument(
  seed: ModelReleaseSeed & { modelId: string },
): ModelReleaseDocument {
  const exactGk = seed.providerModelId === "grok-video-3";
  const blocked = evidence(seed.providerModelId) === "UNKNOWN";
  const family = exactGk ? "generic-async-media" as const : connector(seed);
  return Object.freeze({
    capability: seed.capability,
    capabilitySchema: structuredClone(seed.capabilitySchema),
    connectorFamily: family,
    connectorVersion: 1,
    documentation: documentation(seed.providerModelId),
    evidence: evidence(seed.providerModelId),
    executionContract: exactGk
      ? gkVideoExecutionContract(seed.capabilitySchema)
      : specializedContract(seed),
    modelId: seed.modelId,
    providerModelId: seed.providerModelId,
    providerProfileId: seed.providerProfileId,
    providerProtocol: seed.providerProtocol,
    runtime: exactGk ? "declarative" : blocked ? "blocked" : "specialized-code",
  });
}

export function modelReleaseDocumentForId(
  seed: ModelReleaseSeed & { modelId: string },
) {
  return defaultModelReleaseDocument(seed);
}
