import { gptImageSizeForAspectRatio } from "../types/modelParameters";

export type RelayMediaContractCapability = "audio" | "image" | "video";
export type RelayMediaContractParamValue = boolean | number | string |
  readonly (boolean | number | string)[];

export type RelayMediaPollPolicy = Readonly<{
  deadlineMs: number;
  initialMs: number;
  maximumMs: number;
}>;

export type RelayMediaModelContract = Readonly<{
  capability: RelayMediaContractCapability;
  mapParameters(
    parameters: Readonly<Record<string, unknown>>,
    prompt: string,
  ): Record<string, RelayMediaContractParamValue>;
  modelId: string;
  pollPolicy: RelayMediaPollPolicy;
  referencePolicy: Readonly<{
    allowedKinds: readonly RelayMediaContractCapability[];
    allowedRoles: readonly string[];
    maximumCount: number;
    roleParameters?: Readonly<Record<string, "first_frame_url" | "images" | "last_frame_url">>;
  }>;
  resultKind: RelayMediaContractCapability;
}>;

const metadataFields = new Set([
  "inputMode",
  "inputSchemaVersion",
  "inputs",
  "outputCount",
  "references",
]);

function assertOnlyFields(
  parameters: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
) {
  const accepted = new Set([...allowed, ...metadataFields]);
  if (Object.keys(parameters).some((key) => !accepted.has(key))) {
    throw new Error("Unsupported relay media model parameter");
  }
  if (parameters.outputCount !== undefined && parameters.outputCount !== 1) {
    throw new Error("Relay media model output count must be one");
  }
}

function requiredChoice<T extends string | number>(
  value: unknown,
  choices: readonly T[],
  label: string,
) {
  if (!choices.includes(value as T)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as T;
}

const nanoAspectRatios = [
  "1:1", "2:3", "3:2", "3:4", "4:3",
  "4:5", "5:4", "9:16", "16:9", "21:9",
] as const;

const nanoBananaPro: RelayMediaModelContract = Object.freeze({
  capability: "image",
  mapParameters(parameters) {
    assertOnlyFields(parameters, ["aspectRatio", "quality"]);
    const aspectRatio = requiredChoice(
      parameters.aspectRatio,
      nanoAspectRatios,
      "Nano Banana aspect ratio",
    );
    const quality = requiredChoice(
      parameters.quality,
      ["1k", "2k", "4k"] as const,
      "Nano Banana image size",
    );
    return {
      aspectRatio,
      imageSize: ({ "1k": "1K", "2k": "2K", "4k": "4K" } as const)[quality],
    };
  },
  modelId: "gemini-3-pro-image-preview",
  pollPolicy: { deadlineMs: 10 * 60_000, initialMs: 5_000, maximumMs: 10_000 },
  referencePolicy: {
    allowedKinds: ["image"] as const,
    allowedRoles: ["reference-image"] as const,
    maximumCount: 14,
    roleParameters: { "reference-image": "images" as const },
  },
  resultKind: "image",
});

const ttImage2: RelayMediaModelContract = Object.freeze({
  capability: "image",
  mapParameters(parameters) {
    assertOnlyFields(parameters, ["aspectRatio", "quality"]);
    const aspectRatio = requiredChoice(
      parameters.aspectRatio,
      ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5"] as const,
      "GPT Image 2 aspect ratio",
    );
    const quality = requiredChoice(
      parameters.quality,
      ["1k", "2k", "4k"] as const,
      "GPT Image 2 size tier",
    );
    return {
      n: 1,
      quality: "auto",
      size: gptImageSizeForAspectRatio(aspectRatio, quality),
    };
  },
  modelId: "tt-image-2",
  pollPolicy: { deadlineMs: 15 * 60_000, initialMs: 5_000, maximumMs: 10_000 },
  referencePolicy: {
    allowedKinds: ["image"] as const,
    allowedRoles: ["reference-image"] as const,
    maximumCount: 1,
    roleParameters: { "reference-image": "images" as const },
  },
  resultKind: "image",
});

const klingV3Omni: RelayMediaModelContract = Object.freeze({
  capability: "video",
  mapParameters(parameters) {
    assertOnlyFields(parameters, ["aspectRatio", "duration", "videoMode"]);
    const aspectRatio = requiredChoice(
      parameters.aspectRatio,
      ["16:9", "9:16", "1:1"] as const,
      "Kling aspect ratio",
    );
    const duration = requiredChoice(
      parameters.duration,
      [5, 10, 15] as const,
      "Kling duration",
    );
    const videoMode = requiredChoice(
      parameters.videoMode,
      ["standard", "quality"] as const,
      "Kling video mode",
    );
    return {
      aspect_ratio: aspectRatio,
      duration: String(duration),
      mode: videoMode === "quality" ? "pro" : "std",
    };
  },
  modelId: "kling-v3-omni-cankao",
  pollPolicy: { deadlineMs: 75 * 60_000, initialMs: 5_000, maximumMs: 10_000 },
  referencePolicy: {
    allowedKinds: ["image"] as const,
    allowedRoles: ["reference-image"] as const,
    maximumCount: 7,
    roleParameters: { "reference-image": "images" as const },
  },
  resultKind: "video",
});

const sunoV45: RelayMediaModelContract = Object.freeze({
  capability: "audio",
  mapParameters(parameters, prompt) {
    assertOnlyFields(parameters, [
      "bitrate",
      "lyrics",
      "musicGenerationMode",
      "sampleRate",
      "vocalGender",
    ]);
    const mode = requiredChoice(
      parameters.musicGenerationMode,
      ["instrumental", "prompt-song", "lyrics-song"] as const,
      "Suno generation mode",
    );
    const vocalGender = requiredChoice(
      parameters.vocalGender,
      ["auto", "male", "female"] as const,
      "Suno vocal gender",
    );
    const sampleRate = requiredChoice(
      parameters.sampleRate,
      [44_100, 48_000] as const,
      "Suno sample rate",
    );
    const bitrate = requiredChoice(
      parameters.bitrate,
      [128_000, 192_000, 256_000] as const,
      "Suno bitrate",
    );
    const lyrics = typeof parameters.lyrics === "string"
      ? parameters.lyrics.trim()
      : "";
    if (mode === "lyrics-song" && !lyrics) {
      throw new Error("Suno lyrics-song requires lyrics");
    }
    if (!prompt.trim() && !lyrics) {
      throw new Error("Suno requires prompt or lyrics");
    }
    return {
      bitrate,
      ...(lyrics ? { lyrics } : {}),
      make_instrumental: mode === "instrumental" ? "instrumental" : "song",
      mv: "chirp-v4-5",
      sample_rate: sampleRate,
      vocal_gender: ({ auto: "auto", female: "f", male: "m" } as const)[vocalGender],
    };
  },
  modelId: "suno-v4.5",
  pollPolicy: { deadlineMs: 15 * 60_000, initialMs: 5_000, maximumMs: 10_000 },
  referencePolicy: {
    allowedKinds: [],
    allowedRoles: [],
    maximumCount: 0,
  },
  resultKind: "audio",
});

const doubaoTts20: RelayMediaModelContract = Object.freeze({
  capability: "audio",
  mapParameters(parameters) {
    assertOnlyFields(parameters, ["emotion", "emotionScale", "format", "speaker", "speechRate"]);
    const emotion = requiredChoice(
      parameters.emotion,
      ["auto", "happy", "sad", "angry", "fearful", "surprised", "calm"] as const,
      "Doubao TTS emotion",
    );
    const format = requiredChoice(parameters.format, ["mp3", "wav", "ogg_opus"] as const, "Doubao TTS format");
    const speaker = requiredChoice(parameters.speaker, ["zh_female_vv_uranus_bigtts"] as const, "Doubao TTS speaker");
    const speechRate = requiredChoice(parameters.speechRate, ["-50", "-25", "0", "25", "50", "100"] as const, "Doubao TTS speech rate");
    const emotionScale = parameters.emotionScale;
    if (emotion !== "auto" && ![1, 2, 3, 4, 5].includes(Number(emotionScale))) {
      throw new Error("Invalid Doubao TTS emotion scale");
    }
    return {
      emotion,
      ...(emotion === "auto" ? {} : { emotion_scale: Number(emotionScale) }),
      format,
      speaker,
      speech_rate: speechRate,
    };
  },
  modelId: "doubao-tts-2.0",
  pollPolicy: { deadlineMs: 15 * 60_000, initialMs: 5_000, maximumMs: 10_000 },
  referencePolicy: { allowedKinds: [], allowedRoles: [], maximumCount: 0 },
  resultKind: "audio",
});

function explicitLegacyVideoContract(input: Readonly<{
  allowedRoles: readonly string[];
  maximumCount: number;
  modelId: string;
  roleParameters: Readonly<Record<string, "first_frame_url" | "images" | "last_frame_url">>;
}>): RelayMediaModelContract {
  return Object.freeze({
    capability: "video",
    mapParameters(parameters) {
      assertOnlyFields(parameters, ["aspectRatio", "duration", "generateAudio", "multiShot", "resolution"]);
      for (const required of ["aspectRatio", "duration", "resolution"] as const) {
        if (parameters[required] === undefined) {
          throw new Error(`Missing explicit video parameter: ${required}`);
        }
      }
      const result: Record<string, RelayMediaContractParamValue> = {};
      const names = {
        aspectRatio: "aspect_ratio",
        duration: "duration",
        generateAudio: "generate_audio",
        multiShot: "multi_shot",
        resolution: "resolution",
      } as const;
      for (const [key, name] of Object.entries(names)) {
        const value = parameters[key];
        if (value === undefined) continue;
        if (typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") {
          throw new Error("Invalid explicit video parameter");
        }
        result[name] = value;
      }
      return result;
    },
    modelId: input.modelId,
    pollPolicy: { deadlineMs: 75 * 60_000, initialMs: 5_000, maximumMs: 10_000 },
    referencePolicy: {
      allowedKinds: ["image"] as const,
      allowedRoles: input.allowedRoles,
      maximumCount: input.maximumCount,
      roleParameters: input.roleParameters,
    },
    resultKind: "video",
  });
}

const grokImagineVideo15 = explicitLegacyVideoContract({
  allowedRoles: ["first-frame"],
  maximumCount: 1,
  modelId: "grok-imagine-video-1.5-preview",
  roleParameters: { "first-frame": "images" },
});

const kwVideoV2 = explicitLegacyVideoContract({
  allowedRoles: ["first-frame", "last-frame"],
  maximumCount: 2,
  modelId: "kwvideo-v2",
  roleParameters: {
    "first-frame": "first_frame_url",
    "last-frame": "last_frame_url",
  },
});

const contracts = new Map<string, RelayMediaModelContract>([
  [nanoBananaPro.modelId, nanoBananaPro],
  [ttImage2.modelId, ttImage2],
  [klingV3Omni.modelId, klingV3Omni],
  [sunoV45.modelId, sunoV45],
  [doubaoTts20.modelId, doubaoTts20],
  [grokImagineVideo15.modelId, grokImagineVideo15],
  [kwVideoV2.modelId, kwVideoV2],
]);

export function relayMediaModelContract(modelId: string | undefined) {
  return modelId ? contracts.get(modelId) : undefined;
}

export function relayMediaSubmissionAction(providerTaskId: string | undefined) {
  return providerTaskId ? "poll-existing" as const : "submit-once" as const;
}

export function relayMediaPollingDecision(input: Readonly<{
  attemptCreatedAt: string;
  nowMs: number;
  pollCount: number;
  policy: RelayMediaPollPolicy;
}>) {
  const attemptCreatedAtMs = Date.parse(input.attemptCreatedAt);
  if (!Number.isFinite(attemptCreatedAtMs)) {
    throw new Error("Invalid Provider attempt creation time");
  }
  const deadlineAtMs = attemptCreatedAtMs + input.policy.deadlineMs;
  const delayMs = Math.min(
    input.policy.maximumMs,
    input.policy.initialMs + Math.max(0, input.pollCount) * 1_000,
  );
  return {
    deadlineAtMs,
    delayMs,
    expired: input.nowMs >= deadlineAtMs,
  };
}
