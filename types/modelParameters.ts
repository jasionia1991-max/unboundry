export type ModelCapability = "audio" | "image" | "text" | "video";

export type ModelParameterValue = boolean | number | string;
export type ModelParameterAvailability = "available" | "disabled" | "locked";
export type ModelParameterGroupKey = "advanced" | "input" | "main" | "output";

export type ModelParameterCondition = {
  key: string;
  operator: "equals" | "falsy" | "in" | "notEquals" | "notIn" | "truthy";
  value?: ModelParameterValue;
  values?: ModelParameterValue[];
};

export type ModelParameterOption = {
  availability?: ModelParameterAvailability;
  disabledReason?: string;
  enabledWhen?: ModelParameterCondition[];
  label: string;
  value: ModelParameterValue;
};

export type ModelParameterField = {
  defaultValue: ModelParameterValue;
  enabledWhen?: ModelParameterCondition[];
  group?: ModelParameterGroupKey;
  key: string;
  label: string;
  max?: number;
  maxLength?: number;
  min?: number;
  options: ModelParameterOption[];
  placeholder?: string;
  providerStatus?: "pending";
  requiredWhen?: ModelParameterCondition[];
  step?: number;
  summary?: boolean;
  type: "boolean" | "number" | "select" | "text" | "textarea";
  visibleWhen?: ModelParameterCondition[];
};

export function isCustomParameterField(field: Pick<ModelParameterField, "key">) {
  return /^custom_[a-z0-9_]{8,64}$/i.test(field.key);
}

export type ModelParameterGroup = {
  key: ModelParameterGroupKey;
  label: string;
  order: number;
};

export type ModelReferenceInputs = {
  audio: number;
  image: number;
  video: number;
};

export type ModelUpstreamInputKind = "audio" | "image" | "text" | "video";

export type ModelUpstreamInputRule = {
  /** Provider limits may be a fixed count or calculated from the context window. */
  limitMode: "context" | "fixed";
  maxCount?: number;
  note?: string;
  supported: boolean;
};

export type ModelUpstreamInputs = Record<
  ModelUpstreamInputKind,
  ModelUpstreamInputRule
>;

export type ModelInputRoleLimit = {
  kind: ModelUpstreamInputKind;
  maxCount: number;
  minCount: number;
  role: string;
};

/**
 * A parameter-dependent role policy. It stays Provider-neutral: adapters map
 * these durable role keys to their own request fields only at execution time.
 */
export type ModelInputRolePolicy = {
  /** Ordered automatic roles for baseline/default edges of the same kind. */
  assignment?: Partial<Record<ModelUpstreamInputKind, string[]>>;
  enabledWhen?: ModelParameterCondition[];
  limits?: ModelInputRoleLimit[];
  /** An empty list explicitly forbids that kind for the active policy. */
  roles: Partial<Record<ModelUpstreamInputKind, string[]>>;
};

export type ModelNodeInputPolicy = {
  /**
   * Text targets normally require their own instruction. A compatible model may
   * explicitly allow ready upstream Text to replace an empty target Prompt.
   */
  promptPolicy?: "own-required" | "own-or-upstream-text";
  required?: Partial<Record<ModelUpstreamInputKind, number>>;
  rolePolicies?: ModelInputRolePolicy[];
  roles?: Partial<Record<ModelUpstreamInputKind, string[]>>;
  switchPolicy: "block-switch" | "keep-edge";
};

export type ModelReferenceMode = {
  /** One entry is one allowed reference-material combination. */
  sets: ModelReferenceInputs[];
};

export type ModelReferencePolicy = {
  modeKey: string;
  modes: Record<string, ModelReferenceMode>;
};

export type ModelReferenceMediaRule = {
  contentTypes: string[];
  maxBytes: number;
  maxDurationSeconds?: number;
  maxAspectRatio?: number;
  maxHeight?: number;
  maxPixelCount?: number;
  maxTotalDurationSeconds?: number;
  maxWidth?: number;
  minAspectRatio?: number;
  minDurationSeconds?: number;
  minHeight?: number;
  minPixelCount?: number;
  minWidth?: number;
};

export type ModelReferenceMediaRules = {
  audio?: ModelReferenceMediaRule;
  audioRequiresVisual?: boolean;
  image?: ModelReferenceMediaRule;
  video?: ModelReferenceMediaRule;
};

/**
 * Version 2 is deliberately provider-neutral. The browser only stores keys from
 * this registry; a server-side Provider adapter remains responsible for mapping
 * them to billable Provider payloads.
 */
export type ModelParameterSchema = {
  fields: ModelParameterField[];
  groups: ModelParameterGroup[];
  referenceInputs: ModelReferenceInputs;
  inputPolicy?: ModelNodeInputPolicy;
  referenceMediaRules?: ModelReferenceMediaRules;
  referencePolicy?: ModelReferencePolicy;
  upstreamInputs?: ModelUpstreamInputs;
  version: 2;
};

type ModelParameterCatalogEntry = {
  capability: ModelCapability[];
  group: ModelParameterGroupKey;
  label: string;
  maxLength?: number;
  options: ModelParameterOption[];
  placeholder?: string;
  summary?: boolean;
  type: ModelParameterField["type"];
};

export const emptyReferenceInputs: ModelReferenceInputs = {
  audio: 0,
  image: 0,
  video: 0,
};

export const textOnlyUpstreamInputs: ModelUpstreamInputs = {
  audio: { limitMode: "fixed", maxCount: 0, supported: false },
  image: { limitMode: "fixed", maxCount: 0, supported: false },
  text: { limitMode: "context", supported: true },
  video: { limitMode: "fixed", maxCount: 0, supported: false },
};

export const defaultParameterGroups: ModelParameterGroup[] = [
  { key: "input", label: "输入", order: 10 },
  { key: "main", label: "参数", order: 20 },
  { key: "advanced", label: "高级设置", order: 30 },
  { key: "output", label: "输出", order: 40 },
];

const options = (values: Array<ModelParameterValue | [string, ModelParameterValue]>) =>
  values.map((entry) => Array.isArray(entry)
    ? { label: entry[0], value: entry[1] }
    : { label: String(entry), value: entry });

export const parameterOptionCatalog: Record<string, ModelParameterCatalogEntry> = {
  aspectRatio: {
    capability: ["image", "video"],
    group: "main",
    label: "比例",
    options: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"].map((value) => ({
      label: value === "auto" ? "自适应" : value,
      value,
    })),
    summary: true,
    type: "select",
  },
  audioMode: {
    capability: ["audio"],
    group: "main",
    label: "类型",
    options: options([["音乐", "music"], ["语音", "speech"], ["音效", "sound-effect"]]),
    summary: true,
    type: "select",
  },
  cameraMovement: {
    capability: ["image"],
    group: "advanced",
    label: "摄影机控制",
    options: options([["无", "none"]]),
    type: "select",
  },
  creativity: {
    capability: ["text"],
    group: "main",
    label: "创造性",
    options: options([["精确", "precise"], ["平衡", "balanced"], ["创意", "creative"]]),
    summary: true,
    type: "select",
  },
  emotion: {
    capability: ["audio"],
    group: "main",
    label: "情绪",
    options: options([
      ["自动", "auto"],
      ["愉快", "happy"],
      ["伤感", "sad"],
      ["愤怒", "angry"],
      ["恐惧", "fearful"],
      ["惊讶", "surprised"],
      ["平静", "calm"],
    ]),
    summary: true,
    type: "select",
  },
  emotionScale: {
    capability: ["audio"],
    group: "advanced",
    label: "情绪强度",
    options: options([1, 2, 3, 4, 5]),
    type: "select",
  },
  duration: {
    capability: ["video", "audio"],
    group: "main",
    label: "时长",
    options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 30, 60].map((value) => ({
      label: `${value}s`,
      value,
    })),
    summary: true,
    type: "select",
  },
  format: {
    capability: ["audio"],
    group: "output",
    label: "格式",
    options: ["mp3", "wav", "m4a", "ogg_opus"].map((value) => ({
      label: value === "ogg_opus" ? "OGG Opus" : value.toUpperCase(),
      value,
    })),
    summary: true,
    type: "select",
  },
  generateAudio: {
    capability: ["video"],
    group: "main",
    label: "生成音频",
    options: options([["开启", true], ["关闭", false]]),
    summary: true,
    type: "boolean",
  },
  groupMode: {
    capability: ["image"],
    group: "advanced",
    label: "组图模式",
    options: options([["开启", true], ["关闭", false]]),
    type: "boolean",
  },
  inputMode: {
    capability: ["text", "image", "video", "audio"],
    group: "input",
    label: "生成方式",
    options: options([
      ["文本", "text"],
      ["图片参考", "image"],
      ["首尾帧", "first-last-frame"],
      ["参考", "reference"],
      ["全能参考", "multimodal"],
    ]),
    summary: true,
    type: "select",
  },
  lens: {
    capability: ["image"],
    group: "advanced",
    label: "Lens",
    options: options([["默认", "default"]]),
    type: "select",
  },
  lyrics: {
    capability: ["audio"],
    group: "input",
    label: "歌词",
    maxLength: 8_000,
    options: [],
    placeholder: "输入歌词",
    type: "textarea",
  },
  lyricsMode: {
    capability: ["audio"],
    group: "main",
    label: "歌词",
    options: options([["自适应", "auto"], ["自定义", "custom"]]),
    summary: true,
    type: "select",
  },
  maxOutputTokens: {
    capability: ["text"],
    group: "output",
    label: "最大输出Token",
    options: [16, 32, 64, 128, 256, 512, 1024, 2048, 4096].map((value) => ({
      label: `${value} Token`,
      value,
    })),
    summary: true,
    type: "select",
  },
  musicGenerationMode: {
    capability: ["audio"],
    group: "main",
    label: "生成方式",
    options: options([
      ["纯音乐", "instrumental"],
      ["提示词歌曲", "prompt-song"],
      ["自定义歌词歌曲", "lyrics-song"],
    ]),
    summary: true,
    type: "select",
  },
  multiShot: {
    capability: ["video"],
    group: "advanced",
    label: "多镜头",
    options: options([["开启", true], ["关闭", false]]),
    type: "boolean",
  },
  outputCount: {
    capability: ["text", "image", "video", "audio"],
    group: "output",
    label: "数量",
    options: [1, 2, 3, 4].map((value) => ({ label: `${value}×`, value })),
    summary: true,
    type: "select",
  },
  quality: {
    capability: ["image"],
    group: "main",
    label: "画质",
    options: options([
      ["自动", "auto"], ["低", "low"], ["中", "medium"], ["高", "high"],
      ["1K", "1k"], ["2K", "2k"], ["3K", "3k"], ["4K", "4k"],
    ]),
    summary: true,
    type: "select",
  },
  resolution: {
    capability: ["video"],
    group: "main",
    label: "清晰度",
    options: options(["360p", "480p", "540p", "720p", "768p", "1080p"]),
    summary: true,
    type: "select",
  },
  speaker: {
    capability: ["audio"],
    group: "main",
    label: "音色",
    options: options([["Vivi 2.0", "zh_female_vv_uranus_bigtts"]]),
    summary: true,
    type: "select",
  },
  speechRate: {
    capability: ["audio"],
    group: "main",
    label: "语速",
    options: options([
      ["-50", "-50"],
      ["-25", "-25"],
      ["0", "0"],
      ["25", "25"],
      ["50", "50"],
      ["100", "100"],
    ]),
    summary: true,
    type: "select",
  },
  responseFormat: {
    capability: ["text"],
    group: "output",
    label: "输出格式",
    options: options([
      ["普通文本", "plain"],
      ["Markdown", "markdown"],
      ["文本", "text"],
      ["JSON", "json_object"],
      ["JSON Schema", "json_schema"],
    ]),
    summary: true,
    type: "select",
  },
  style: {
    capability: ["image"],
    group: "advanced",
    label: "风格",
    options: options([["默认", "default"]]),
    type: "select",
  },
  streamPlayback: {
    capability: ["audio"],
    group: "advanced",
    label: "边生成边试听",
    options: options([["开启", true], ["关闭", false]]),
    type: "boolean",
  },
  thinkingLevel: {
    capability: ["text"],
    group: "main",
    label: "推理档位",
    options: options([
      ["关闭", "off"],
      ["快速", "fast"],
      ["专家", "expert"],
      ["不思考", "minimal"],
      ["低", "low"],
      ["中", "medium"],
      ["高", "high"],
    ]),
    summary: true,
    type: "select",
  },
  temperature: {
    capability: ["text"],
    group: "main",
    label: "Temperature",
    options: [0, 0.2, 0.5, 0.7, 1].map((value) => ({
      label: `T ${value}`,
      value,
    })),
    summary: true,
    type: "select",
  },
  vocalGender: {
    capability: ["audio"],
    group: "main",
    label: "人声",
    options: options([["女声", "female"], ["男声", "male"]]),
    summary: true,
    type: "select",
  },
};

function catalogField(
  key: keyof typeof parameterOptionCatalog,
  values: ModelParameterValue[],
  defaultValue: ModelParameterValue,
  overrides: Partial<ModelParameterField> = {},
): ModelParameterField {
  const catalog = parameterOptionCatalog[key];
  const selectedOptions = catalog.type === "select" || catalog.type === "boolean"
    ? catalog.options.filter((option) => values.includes(option.value))
    : [];
  return {
    defaultValue,
    group: catalog.group,
    key,
    label: catalog.label,
    maxLength: catalog.maxLength,
    options: selectedOptions,
    placeholder: catalog.placeholder,
    summary: catalog.summary,
    type: catalog.type,
    ...overrides,
  };
}

function markOptionsDisabled(
  input: ModelParameterField,
  values: ModelParameterValue[],
  disabledReason: string,
): ModelParameterField {
  return {
    ...input,
    options: input.options.map((option) => values.includes(option.value)
      ? { ...option, availability: "disabled", disabledReason }
      : option),
  };
}

function schema(
  fields: ModelParameterField[],
  referenceInputs: ModelReferenceInputs = emptyReferenceInputs,
  referencePolicy?: ModelReferencePolicy,
  upstreamInputs?: ModelUpstreamInputs,
  inputPolicy?: ModelNodeInputPolicy,
  referenceMediaRules?: ModelReferenceMediaRules,
): ModelParameterSchema {
  return {
    fields,
    groups: defaultParameterGroups.map((group) => ({ ...group })),
    inputPolicy,
    referenceInputs: { ...referenceInputs },
    ...(referenceMediaRules
      ? { referenceMediaRules: cleanReferenceMediaRules(referenceMediaRules) }
      : {}),
    referencePolicy,
    upstreamInputs,
    version: 2,
  };
}

export function defaultParameterSchema(capability: ModelCapability): ModelParameterSchema {
  const fields: ModelParameterField[] = capability === "image"
    ? [
        catalogField("inputMode", ["text"], "text"),
        catalogField("aspectRatio", ["auto"], "auto"),
        catalogField("quality", ["auto"], "auto"),
        catalogField("outputCount", [1], 1),
      ]
    : capability === "video"
      ? [
          catalogField("inputMode", ["text"], "text"),
          catalogField("aspectRatio", ["16:9"], "16:9"),
          catalogField("resolution", ["480p"], "480p"),
          catalogField("duration", [5], 5),
          catalogField("generateAudio", [true, false], true),
          catalogField("outputCount", [1], 1),
        ]
      : capability === "audio"
        ? [
            catalogField("inputMode", ["text"], "text"),
            catalogField("audioMode", ["music"], "music"),
            catalogField("duration", [30], 30),
            catalogField("format", ["mp3"], "mp3"),
            catalogField("outputCount", [1], 1),
          ]
        : [
            catalogField("inputMode", ["text"], "text"),
            catalogField("responseFormat", ["plain", "markdown"], "plain"),
            catalogField("creativity", ["balanced"], "balanced"),
            catalogField("outputCount", [1], 1),
          ];
  return schema(
    fields,
    emptyReferenceInputs,
    undefined,
    capability === "text" ? textOnlyUpstreamInputs : undefined,
  );
}

function relayTextParameterFields() {
  return [
    catalogField("inputMode", ["text"], "text"),
    catalogField("maxOutputTokens", [16, 32, 64, 128, 256, 512, 1024, 2048, 4096], 64),
    catalogField("temperature", [0, 0.2, 0.5, 0.7, 1], 0),
    catalogField("outputCount", [1], 1),
  ];
}

function relayTextParameterSchema() {
  return schema(
    relayTextParameterFields(),
    emptyReferenceInputs,
    undefined,
    textOnlyUpstreamInputs,
  );
}

function relayDoubaoTtsParameterFields() {
  const nonAutomaticEmotion: ModelParameterCondition[] = [{
    key: "emotion",
    operator: "notEquals",
    value: "auto",
  }];
  return [
    catalogField("inputMode", ["text"], "text"),
    catalogField(
      "speaker",
      ["zh_female_vv_uranus_bigtts"],
      "zh_female_vv_uranus_bigtts",
    ),
    catalogField("speechRate", ["-50", "-25", "0", "25", "50", "100"], "0"),
    catalogField(
      "emotion",
      ["auto", "happy", "sad", "angry", "fearful", "surprised", "calm"],
      "auto",
    ),
    catalogField("emotionScale", [1, 2, 3, 4, 5], 4, {
      enabledWhen: nonAutomaticEmotion,
      visibleWhen: nonAutomaticEmotion,
    }),
    catalogField("format", ["mp3", "wav", "ogg_opus"], "mp3"),
    catalogField("outputCount", [1], 1),
  ];
}

function relayDoubaoTtsParameterSchema() {
  return schema(relayDoubaoTtsParameterFields());
}

/**
 * Official Seedance 2.0 reference-material contract used as both the default
 * and the Provider-side ceiling for Volcengine ARK Seedance video models.
 */
export const seedance2ReferenceMediaRules: ModelReferenceMediaRules = {
  audio: {
    contentTypes: ["audio/mpeg", "audio/wav"],
    maxBytes: 15 * 1024 * 1024,
    maxDurationSeconds: 15,
    maxTotalDurationSeconds: 15,
    minDurationSeconds: 2,
  },
  audioRequiresVisual: true,
  image: {
    contentTypes: ["image/png"],
    maxBytes: 30 * 1024 * 1024,
    maxAspectRatio: 2.5,
    maxHeight: 6000,
    maxWidth: 6000,
    minAspectRatio: 0.4,
    minHeight: 300,
    minWidth: 300,
  },
  video: {
    contentTypes: ["video/mp4"],
    maxBytes: 200 * 1024 * 1024,
    maxDurationSeconds: 15,
    maxPixelCount: 8_295_044,
    maxTotalDurationSeconds: 15,
    minPixelCount: 409_600,
    minDurationSeconds: 2,
  },
};

/**
 * Provider-family ceiling for Volcengine ARK Seedance video models. Individual
 * model schemas may tighten these values; the ceiling only blocks values that
 * no current Seedance model is expected to accept.
 */
export const seedanceFamilyReferenceMediaRules: ModelReferenceMediaRules = {
  audio: {
    contentTypes: ["audio/mpeg", "audio/wav"],
    maxBytes: 30 * 1024 * 1024,
    maxDurationSeconds: 30,
    maxTotalDurationSeconds: 30,
    minDurationSeconds: 2,
  },
  audioRequiresVisual: true,
  image: {
    contentTypes: ["image/png"],
    maxBytes: 30 * 1024 * 1024,
    maxAspectRatio: 2.5,
    maxHeight: 6000,
    maxWidth: 6000,
    minAspectRatio: 0.4,
    minHeight: 300,
    minWidth: 300,
  },
  video: {
    contentTypes: ["video/mp4"],
    maxBytes: 200 * 1024 * 1024,
    maxDurationSeconds: 30,
    maxPixelCount: 8_295_044,
    maxTotalDurationSeconds: 30,
    minDurationSeconds: 2,
  },
};

function seedanceParameterSchema(mini: boolean): ModelParameterSchema {
  const pendingPaidVerificationReason = "尚未完成本项目真实付费验证";
  const durations = mini
    ? [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    : [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
  const resolutionOptions = mini ? ["480p", "720p"] : ["480p", "720p", "1080p"];
  return schema([
    catalogField("inputMode", ["text", "first-last-frame", "multimodal"], "text"),
    catalogField("aspectRatio", ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"], "16:9"),
    markOptionsDisabled(
      catalogField("resolution", resolutionOptions, "480p"),
      mini ? ["720p"] : [],
      pendingPaidVerificationReason,
    ),
    markOptionsDisabled(
      catalogField("duration", durations, 5),
      mini ? durations.filter((value) => value > 5) : [],
      pendingPaidVerificationReason,
    ),
    catalogField("generateAudio", [true, false], true),
    catalogField("outputCount", [1], 1),
  ], { audio: 3, image: 9, video: 3 }, {
    modeKey: "inputMode",
    modes: {
      "first-last-frame": { sets: [{ audio: 0, image: 2, video: 0 }] },
      multimodal: { sets: [{ audio: 3, image: 9, video: 3 }] },
      text: { sets: [{ ...emptyReferenceInputs }] },
    },
  }, {
    audio: { limitMode: "fixed", maxCount: 3, supported: true },
    image: { limitMode: "fixed", maxCount: 9, supported: true },
    text: { limitMode: "context", supported: true },
    video: { limitMode: "fixed", maxCount: 3, supported: true },
  }, {
    promptPolicy: "own-required",
    required: {},
    rolePolicies: [
      {
        enabledWhen: [{ key: "inputMode", operator: "equals", value: "text" }],
        roles: { audio: [], image: [], text: ["instruction"], video: [] },
      },
      {
        assignment: { image: ["first-frame", "last-frame"] },
        enabledWhen: [{ key: "inputMode", operator: "equals", value: "first-last-frame" }],
        limits: [
          { kind: "image", maxCount: 1, minCount: 1, role: "first-frame" },
          { kind: "image", maxCount: 1, minCount: 1, role: "last-frame" },
        ],
        roles: {
          audio: [],
          image: ["first-frame", "last-frame"],
          text: ["instruction"],
          video: [],
        },
      },
      {
        enabledWhen: [{ key: "inputMode", operator: "equals", value: "multimodal" }],
        limits: [
          { kind: "image", maxCount: 1, minCount: 0, role: "subject" },
          { kind: "video", maxCount: 1, minCount: 0, role: "subject" },
        ],
        roles: {
          audio: ["reference-audio"],
          image: ["subject", "reference-image"],
          text: ["instruction"],
          video: ["subject", "reference-video"],
        },
      },
    ],
    roles: {
      audio: ["reference-audio"],
      image: ["first-frame", "last-frame", "subject", "reference-image"],
      text: ["instruction"],
      video: ["subject", "reference-video"],
    },
    switchPolicy: "keep-edge",
  }, mini ? seedance2ReferenceMediaRules : seedanceFamilyReferenceMediaRules);
}

export function providerParameterSchema(input: {
  capability: ModelCapability;
  providerDriver?: string;
  providerModelId?: string;
}): ModelParameterSchema | undefined {
  if (
    input.capability === "text" &&
    input.providerDriver === "multi-protocol-relay"
  ) {
    // Keep Provider request controls bounded without constraining the separate
    // protocol-aware upstream input policy. Chat, Responses, Claude and Gemini
    // each validate their supported input kinds before publication.
    return schema(relayTextParameterFields());
  }
  if (
    input.capability === "audio" &&
    input.providerDriver === "multi-protocol-relay" &&
    input.providerModelId === "doubao-tts-2.0"
  ) {
    return relayDoubaoTtsParameterSchema();
  }
  if (
    input.capability === "audio" &&
    input.providerDriver === "mureka"
  ) {
    const lyricsSongOnly: ModelParameterCondition[] = [{
      key: "musicGenerationMode",
      operator: "equals",
      value: "lyrics-song",
    }];
    return schema([
      catalogField(
        "musicGenerationMode",
        ["instrumental", "prompt-song", "lyrics-song"],
        "instrumental",
      ),
      catalogField("lyrics", [], "", {
        maxLength: 5_000,
        requiredWhen: lyricsSongOnly,
        visibleWhen: lyricsSongOnly,
      }),
      catalogField("vocalGender", ["female", "male"], "female", {
        visibleWhen: lyricsSongOnly,
      }),
      catalogField("streamPlayback", [true, false], false),
      catalogField("outputCount", [1, 2, 3], 1),
    ]);
  }
  if (
    input.capability === "text" &&
    input.providerDriver === "volcengine-ark" &&
    /^doubao-seed-2-0-lite-/i.test(input.providerModelId ?? "")
  ) {
    const thinking = catalogField(
      "thinkingLevel",
      ["minimal", "medium"],
      "medium",
    );
    thinking.options = thinking.options.map((option) => ({
      ...option,
      label: option.value === "minimal" ? "关闭" : "开启",
    }));
    return schema([
      catalogField("inputMode", ["text"], "text"),
      thinking,
      catalogField("responseFormat", ["text"], "text"),
      catalogField("outputCount", [1], 1),
    ], emptyReferenceInputs, undefined, {
      audio: {
        limitMode: "context",
        note: "URL/Base64单文件不超过25MB且不超过120分钟；Files API单文件不超过512MB",
        supported: true,
      },
      image: {
        limitMode: "context",
        note: "URL/Base64单图小于10MB；Files API单文件不超过512MB",
        supported: true,
      },
      text: {
        limitMode: "context",
        note: "文字与其他素材共同计入229376输入Token上限",
        supported: true,
      },
      video: {
        limitMode: "context",
        note: "URL/Base64单视频不超过50MB；Files API单文件不超过512MB，单视频最多使用80000 Token",
        supported: true,
      },
    });
  }
  if (
    input.capability === "image" &&
    input.providerDriver === "openrouter" &&
    input.providerModelId === "openai/gpt-image-2"
  ) {
    return schema([
      catalogField("inputMode", ["text", "image"], "text"),
      catalogField("aspectRatio", ["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"], "auto"),
      catalogField("quality", ["auto", "low", "medium", "high"], "auto"),
      catalogField("outputCount", [1], 1),
    ], { ...emptyReferenceInputs, image: 16 }, {
      modeKey: "inputMode",
      modes: {
        image: { sets: [{ ...emptyReferenceInputs, image: 16 }] },
        text: { sets: [{ ...emptyReferenceInputs }] },
      },
    });
  }
  if (
    input.capability === "video" &&
    input.providerDriver === "volcengine-ark" &&
    /^doubao-seedance-/i.test(input.providerModelId ?? "")
  ) {
    return seedanceParameterSchema(
      /^doubao-seedance-2-0-mini-/i.test(input.providerModelId ?? ""),
    );
  }
  return undefined;
}

export function knownModelParameterSchema(input: {
  capability: ModelCapability;
  providerDriver?: string;
  providerModelId?: string;
}): ModelParameterSchema {
  if (
    input.capability === "text" &&
    input.providerDriver === "multi-protocol-relay"
  ) {
    return relayTextParameterSchema();
  }
  if (
    input.capability === "audio" &&
    input.providerDriver === "multi-protocol-relay" &&
    input.providerModelId === "doubao-tts-2.0"
  ) {
    return relayDoubaoTtsParameterSchema();
  }
  if (
    input.capability === "video" &&
    input.providerDriver === "volcengine-ark" &&
    /^doubao-seedance-2-0-mini-/i.test(input.providerModelId ?? "")
  ) {
    return seedanceParameterSchema(true);
  }
  return providerParameterSchema(input) ?? defaultParameterSchema(input.capability);
}

function conditionMatches(
  condition: ModelParameterCondition,
  values: Record<string, ModelParameterValue>,
) {
  const current = values[condition.key];
  switch (condition.operator) {
    case "equals": return current === condition.value;
    case "notEquals": return current !== condition.value;
    case "in": return condition.values?.includes(current) ?? false;
    case "notIn": return !(condition.values?.includes(current) ?? false);
    case "truthy": return Boolean(current);
    case "falsy": return !current;
  }
}

export function parameterConditionsMatch(
  conditions: ModelParameterCondition[] | undefined,
  values: Record<string, ModelParameterValue>,
) {
  return !conditions?.length || conditions.every((condition) => conditionMatches(condition, values));
}

export function parameterFieldVisible(
  field: ModelParameterField,
  values: Record<string, ModelParameterValue>,
) {
  return parameterConditionsMatch(field.visibleWhen, values);
}

export function parameterFieldEnabled(
  field: ModelParameterField,
  values: Record<string, ModelParameterValue>,
) {
  return parameterFieldVisible(field, values) && parameterConditionsMatch(field.enabledWhen, values);
}

export function parameterOptionEnabled(
  option: ModelParameterOption,
  values: Record<string, ModelParameterValue>,
) {
  return (option.availability ?? "available") === "available" &&
    parameterConditionsMatch(option.enabledWhen, values);
}

export function parameterFieldRequired(
  field: ModelParameterField,
  values: Record<string, ModelParameterValue>,
) {
  return parameterFieldVisible(field, values) &&
    Boolean(field.requiredWhen?.length) &&
    parameterConditionsMatch(field.requiredWhen, values);
}

export function activeParameterFields(
  schemaInput: ModelParameterSchema,
  values: Record<string, ModelParameterValue>,
) {
  return schemaInput.fields.filter((field) => parameterFieldVisible(field, values));
}

/**
 * Fields that may cross the generation boundary. A field can remain visible in
 * the editor while disabled, so submission must apply both condition sets
 * instead of treating visibility as permission to forward a value.
 */
export function submittableParameterFields(
  schemaInput: ModelParameterSchema,
  values: Record<string, ModelParameterValue>,
) {
  return schemaInput.fields.filter((field) =>
    parameterFieldEnabled(field, values)
  );
}

/**
 * Build the browser-side request snapshot from the same condition semantics
 * enforced by validateParameterValues on the server. Inactive values remain in
 * the node editor state so switching a mode back does not erase user input,
 * but they never enter an idempotency key or Provider-bound task snapshot.
 */
export function submissionParameterValues(
  schemaInput: ModelParameterSchema,
  input: unknown,
): Record<string, ModelParameterValue> {
  const normalized = normalizeParameterValues(schemaInput, input);
  return Object.fromEntries(
    submittableParameterFields(schemaInput, normalized).map((field) => [
      field.key,
      normalized[field.key],
    ]),
  );
}

export function referenceSetsForValues(
  schemaInput: ModelParameterSchema,
  values: Record<string, ModelParameterValue>,
): ModelReferenceInputs[] {
  const policy = schemaInput.referencePolicy;
  if (!policy) return [{ ...schemaInput.referenceInputs }];
  const mode = String(values[policy.modeKey] ?? "");
  return policy.modes[mode]?.sets.map((set) => ({ ...set })) ?? [{ ...emptyReferenceInputs }];
}

export function referenceLimitsForValues(
  schemaInput: ModelParameterSchema,
  values: Record<string, ModelParameterValue>,
): ModelReferenceInputs {
  return referenceSetsForValues(schemaInput, values).reduce<ModelReferenceInputs>(
    (maximum, set) => ({
      audio: Math.max(maximum.audio, set.audio),
      image: Math.max(maximum.image, set.image),
      video: Math.max(maximum.video, set.video),
    }),
    { ...emptyReferenceInputs },
  );
}

function sameRolePolicyConditions(
  left: ModelParameterCondition[] | undefined,
  right: ModelParameterCondition[] | undefined,
) {
  const key = (condition: ModelParameterCondition) => JSON.stringify({
    key: condition.key,
    operator: condition.operator,
    ...(condition.value !== undefined ? { value: condition.value } : {}),
    ...(condition.values !== undefined
      ? { values: condition.values.map((value) => JSON.stringify(value)).sort() }
      : {}),
  });
  return (left ?? []).map(key).sort().join("|") ===
    (right ?? []).map(key).sort().join("|");
}

function rolePolicyCanBeActive(
  policy: ModelInputRolePolicy,
  schemaInput: ModelParameterSchema,
) {
  return (policy.enabledWhen ?? []).every((condition) => {
    const field = schemaInput.fields.find((candidate) => candidate.key === condition.key);
    if (!field) return false;
    const values = field.type === "select" || field.type === "boolean"
      ? field.options.map((option) => option.value)
      : [field.defaultValue];
    switch (condition.operator) {
      case "equals": return values.includes(condition.value as ModelParameterValue);
      case "notEquals": return values.some((value) => value !== condition.value);
      case "in": return values.some((value) => condition.values?.includes(value));
      case "notIn": return values.some((value) => !condition.values?.includes(value));
      case "truthy": return values.some(Boolean);
      case "falsy": return values.some((value) => !value);
    }
  });
}

export function validateParameterSchemaConstraints(
  schemaInput: ModelParameterSchema,
  constraints?: ModelParameterSchema,
) {
  if (!constraints) return schemaInput;
  for (const field of schemaInput.fields) {
    if (isCustomParameterField(field) && field.providerStatus === "pending") {
      continue;
    }
    const allowed = constraints.fields.find((item) => item.key === field.key);
    if (
      !allowed ||
      field.type !== allowed.type ||
      field.options.some((option) => {
        const candidate = allowed.options.find((entry) => entry.value === option.value);
        return !candidate || (
          (candidate.availability ?? "available") !== "available" &&
          (option.availability ?? "available") === "available"
        );
      })
    ) {
      throw new Error("Model parameter is not supported by this Provider model");
    }
  }
  for (const kind of ["audio", "image", "video"] as const) {
    if (schemaInput.referenceInputs[kind] > constraints.referenceInputs[kind]) {
      throw new Error("Model reference input is not supported by this Provider model");
    }
  }
  if (constraints.referencePolicy && !schemaInput.referencePolicy) {
    throw new Error("Model reference policy is required by this Provider model");
  }
  if (schemaInput.referencePolicy && constraints.referencePolicy) {
    if (schemaInput.referencePolicy.modeKey !== constraints.referencePolicy.modeKey) {
      throw new Error("Model reference input is not supported by this Provider model");
    }
    for (const [mode, configured] of Object.entries(schemaInput.referencePolicy.modes)) {
      const allowed = constraints.referencePolicy.modes[mode];
      if (!allowed || configured.sets.some((set) => !allowed.sets.some((candidate) =>
        set.audio <= candidate.audio &&
        set.image <= candidate.image &&
        set.video <= candidate.video))) {
        throw new Error("Model reference input is not supported by this Provider model");
      }
    }
    const modeField = schemaInput.fields.find((field) =>
      field.key === constraints.referencePolicy!.modeKey);
    if (!modeField) {
      throw new Error("Model reference policy is required by this Provider model");
    }
    for (const option of modeField.options) {
      const mode = String(option.value);
      if (
        constraints.referencePolicy.modes[mode] &&
        !schemaInput.referencePolicy.modes[mode]
      ) {
        throw new Error("Model reference policy is required by this Provider model");
      }
    }
  }
  if (constraints.referenceMediaRules) {
    const rules = schemaInput.referenceMediaRules;
    if (!rules) {
      throw new Error("Model reference media rules are required by this Provider model");
    }
    for (const kind of ["audio", "image", "video"] as const) {
      const allowed = constraints.referenceMediaRules[kind];
      const configured = rules[kind];
      if (allowed && !configured) {
        throw new Error("Model reference media rules are required by this Provider model");
      }
      if (!allowed || !configured) continue;
      if (configured.maxBytes > allowed.maxBytes) {
        throw new Error("Model reference media rule is not supported by this Provider model");
      }
      if (
        (configured.minDurationSeconds ?? 0) < (allowed.minDurationSeconds ?? 0) ||
        (configured.maxDurationSeconds ?? Number.POSITIVE_INFINITY) >
          (allowed.maxDurationSeconds ?? Number.POSITIVE_INFINITY)
      ) {
        throw new Error("Model reference media rule is not supported by this Provider model");
      }
      if (
        (configured.maxTotalDurationSeconds ?? Number.POSITIVE_INFINITY) >
        (allowed.maxTotalDurationSeconds ?? Number.POSITIVE_INFINITY)
      ) {
        throw new Error("Model reference media rule is not supported by this Provider model");
      }
      if (
        configured.contentTypes.some(
          (contentType) => !allowed.contentTypes.includes(contentType),
        )
      ) {
        throw new Error("Model reference media rule is not supported by this Provider model");
      }
      const enforceBound = (
        configuredValue: number | undefined,
        allowedValue: number | undefined,
        minimum: boolean,
      ) => {
        if (allowedValue === undefined || configuredValue === undefined) return;
        if (minimum && configuredValue < allowedValue) {
          throw new Error("Model reference media rule is not supported by this Provider model");
        }
        if (!minimum && configuredValue > allowedValue) {
          throw new Error("Model reference media rule is not supported by this Provider model");
        }
      };
      enforceBound(configured.minWidth, allowed.minWidth, true);
      enforceBound(configured.maxWidth, allowed.maxWidth, false);
      enforceBound(configured.minHeight, allowed.minHeight, true);
      enforceBound(configured.maxHeight, allowed.maxHeight, false);
      enforceBound(configured.minPixelCount, allowed.minPixelCount, true);
      enforceBound(configured.maxPixelCount, allowed.maxPixelCount, false);
      enforceBound(configured.minAspectRatio, allowed.minAspectRatio, true);
      enforceBound(configured.maxAspectRatio, allowed.maxAspectRatio, false);
    }
    if (
      constraints.referenceMediaRules.audioRequiresVisual &&
      rules.audioRequiresVisual !== true
    ) {
      throw new Error("Model reference media rules are required by this Provider model");
    }
  }
  if (constraints.upstreamInputs && !schemaInput.upstreamInputs) {
    throw new Error("Model upstream input policy is required by this Provider model");
  }
  if (schemaInput.upstreamInputs && constraints.upstreamInputs) {
    for (const kind of ["audio", "image", "text", "video"] as const) {
      const configured = schemaInput.upstreamInputs[kind];
      const allowed = constraints.upstreamInputs[kind];
      if (configured.supported && !allowed.supported) {
        throw new Error("Model upstream input is not supported by this Provider model");
      }
      if (
        configured.supported &&
        configured.limitMode === "context" &&
        allowed.limitMode !== "context"
      ) {
        throw new Error("Model upstream input is not supported by this Provider model");
      }
      if (
        configured.supported &&
        configured.limitMode === "fixed" &&
        allowed.limitMode === "fixed" &&
        (configured.maxCount ?? 0) > (allowed.maxCount ?? 0)
      ) {
        throw new Error("Model upstream input is not supported by this Provider model");
      }
    }
  }
  if (constraints.inputPolicy && !schemaInput.inputPolicy) {
    throw new Error("Model input policy is required by this Provider model");
  }
  if (schemaInput.inputPolicy && constraints.inputPolicy) {
    if (
      constraints.inputPolicy.promptPolicy === "own-required" &&
      schemaInput.inputPolicy.promptPolicy !== "own-required"
    ) {
      throw new Error("Model input prompt policy cannot weaken this Provider model");
    }
    if (
      constraints.inputPolicy.promptPolicy === "own-or-upstream-text" &&
      schemaInput.inputPolicy.promptPolicy !== "own-required" &&
      schemaInput.inputPolicy.promptPolicy !== "own-or-upstream-text"
    ) {
      throw new Error("Model input prompt policy cannot weaken this Provider model");
    }
    for (const kind of ["audio", "image", "text", "video"] as const) {
      const configuredRoles = schemaInput.inputPolicy.roles?.[kind] ?? [];
      const allowedRoles = constraints.inputPolicy.roles?.[kind] ?? [];
      if (configuredRoles.some((role) => !allowedRoles.includes(role))) {
        throw new Error("Model input role is not supported by this Provider model");
      }
      if (
        (schemaInput.inputPolicy.required?.[kind] ?? 0) <
        (constraints.inputPolicy.required?.[kind] ?? 0)
      ) {
        throw new Error("Model required input cannot weaken this Provider model");
      }
    }
    for (const configured of schemaInput.inputPolicy.rolePolicies ?? []) {
      const allowed = constraints.inputPolicy.rolePolicies?.find((candidate) =>
        sameRolePolicyConditions(candidate.enabledWhen, configured.enabledWhen));
      if (!allowed) {
        throw new Error("Model input role policy is not supported by this Provider model");
      }
      for (const kind of ["audio", "image", "text", "video"] as const) {
        const configuredRoles = configured.roles[kind] ?? [];
        const allowedRoles = allowed.roles[kind] ?? [];
        if (configuredRoles.some((role) => !allowedRoles.includes(role))) {
          throw new Error("Model input role policy is not supported by this Provider model");
        }
        const expectedAssignment = (allowed.assignment?.[kind] ?? []).filter((role) =>
          configuredRoles.includes(role));
        const configuredAssignment = configured.assignment?.[kind] ?? [];
        if (
          configuredAssignment.length !== expectedAssignment.length ||
          configuredAssignment.some((role, index) => role !== expectedAssignment[index])
        ) {
          throw new Error("Model input role assignment cannot weaken this Provider model");
        }
      }
      for (const configuredLimit of configured.limits ?? []) {
        const allowedLimit = allowed.limits?.find((candidate) =>
          candidate.kind === configuredLimit.kind && candidate.role === configuredLimit.role);
        if (
          !allowedLimit ||
          configuredLimit.minCount < allowedLimit.minCount ||
          configuredLimit.maxCount > allowedLimit.maxCount
        ) {
          throw new Error("Model input role policy is not supported by this Provider model");
        }
      }
      for (const allowedLimit of allowed.limits ?? []) {
        const roleRetained = configured.roles[allowedLimit.kind]?.includes(allowedLimit.role) ?? false;
        if (allowedLimit.minCount > 0 && !roleRetained) {
          throw new Error("Model input role policy cannot remove a required Provider role");
        }
        if (!roleRetained) continue;
        const configuredLimit = configured.limits?.find((candidate) =>
          candidate.kind === allowedLimit.kind && candidate.role === allowedLimit.role);
        if (
          !configuredLimit ||
          configuredLimit.minCount < allowedLimit.minCount ||
          configuredLimit.maxCount > allowedLimit.maxCount
        ) {
          throw new Error("Model input role limit cannot weaken this Provider model");
        }
      }
    }
    for (const allowed of constraints.inputPolicy.rolePolicies ?? []) {
      if (!rolePolicyCanBeActive(allowed, schemaInput)) continue;
      const configured = schemaInput.inputPolicy.rolePolicies?.find((candidate) =>
        sameRolePolicyConditions(candidate.enabledWhen, allowed.enabledWhen));
      if (!configured) {
        throw new Error("Model input role policy is required by this Provider model");
      }
    }
  }
  return schemaInput;
}

export function defaultParameterValues(schemaInput: ModelParameterSchema) {
  return Object.fromEntries(schemaInput.fields.map((item) => [item.key, item.defaultValue])) as Record<string, ModelParameterValue>;
}

export function parameterKeysForGroups(
  schemaInput: ModelParameterSchema,
  groups: ModelParameterGroupKey[],
  excludedKeys: string[] = [],
) {
  const excluded = new Set(excludedKeys);
  return schemaInput.fields
    .filter((field) => groups.includes(field.group ?? "main") && !excluded.has(field.key))
    .map((field) => field.key);
}

function normalizedFieldValue(
  field: ModelParameterField,
  candidate: unknown,
  currentValues: Record<string, ModelParameterValue>,
) {
  if (field.type === "text" || field.type === "textarea") {
    return typeof candidate === "string"
      ? field.maxLength ? candidate.slice(0, field.maxLength) : candidate
      : field.defaultValue;
  }
  if (field.type === "number") {
    const numeric = typeof candidate === "number" && Number.isFinite(candidate)
      ? candidate
      : field.defaultValue;
    return Math.min(field.max ?? Number.POSITIVE_INFINITY, Math.max(field.min ?? Number.NEGATIVE_INFINITY, Number(numeric)));
  }
  const selected = field.options.find((option) =>
    option.value === candidate && parameterOptionEnabled(option, currentValues));
  if (selected) return selected.value;
  const fallback = field.options.find((option) =>
    option.value === field.defaultValue && parameterOptionEnabled(option, currentValues)) ??
    field.options.find((option) => parameterOptionEnabled(option, currentValues));
  return fallback?.value ?? field.defaultValue;
}

export function normalizeParameterValues(
  schemaInput: ModelParameterSchema,
  input: unknown,
): Record<string, ModelParameterValue> {
  const values = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  let normalized = defaultParameterValues(schemaInput);
  // Two passes make conditions independent from the order chosen in the admin UI.
  for (let pass = 0; pass < 2; pass += 1) {
    const previous = normalized;
    normalized = { ...previous };
    for (const item of schemaInput.fields) {
      normalized[item.key] = normalizedFieldValue(item, values[item.key], previous);
    }
  }
  return normalized;
}

export function validateParameterValues(
  schemaInput: ModelParameterSchema,
  input: unknown,
): Record<string, ModelParameterValue> {
  const values = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const knownKeys = new Set(schemaInput.fields.map((item) => item.key));
  if (Object.keys(values).some((key) => !knownKeys.has(key))) {
    throw new Error("Unsupported model parameter");
  }
  const resolved = defaultParameterValues(schemaInput);
  for (const item of schemaInput.fields) {
    const candidate = values[item.key] ?? item.defaultValue;
    if (item.type === "text" || item.type === "textarea") {
      resolved[item.key] = typeof candidate === "string" ? candidate : item.defaultValue;
    } else if (item.type === "number") {
      resolved[item.key] = typeof candidate === "number" && Number.isFinite(candidate)
        ? candidate
        : item.defaultValue;
    } else {
      resolved[item.key] = item.options.some((option) => option.value === candidate)
        ? candidate as ModelParameterValue
        : item.defaultValue;
    }
  }
  for (const item of schemaInput.fields) {
    const candidate = values[item.key] ?? item.defaultValue;
    if (!parameterFieldEnabled(item, resolved)) continue;
    if (item.type === "text" || item.type === "textarea") {
      if (typeof candidate !== "string" || candidate.length > (item.maxLength ?? 20_000)) {
        throw new Error("Unsupported model parameter value");
      }
      if (parameterFieldRequired(item, resolved) && !candidate.trim()) {
        throw new Error("Required model parameter is missing");
      }
      resolved[item.key] = candidate;
      continue;
    }
    if (item.type === "number") {
      if (
        typeof candidate !== "number" || !Number.isFinite(candidate) ||
        candidate < (item.min ?? Number.NEGATIVE_INFINITY) ||
        candidate > (item.max ?? Number.POSITIVE_INFINITY)
      ) {
        throw new Error("Unsupported model parameter value");
      }
      resolved[item.key] = candidate;
      continue;
    }
    const selected = item.options.find((option) => option.value === candidate);
    if (!selected || !parameterOptionEnabled(selected, resolved)) {
      throw new Error("Unsupported model parameter value");
    }
    resolved[item.key] = selected.value;
  }
  return Object.fromEntries(
    submittableParameterFields(schemaInput, resolved).map((item) => [
      item.key,
      resolved[item.key],
    ]),
  );
}

function cleanAvailability(value: unknown): ModelParameterAvailability | undefined {
  return value === undefined || value === "available"
    ? undefined
    : value === "disabled" || value === "locked"
      ? value
      : (() => { throw new Error("Invalid model parameter availability"); })();
}

function isParameterValue(value: unknown): value is ModelParameterValue {
  return typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= 80);
}

function cleanConditionList(value: unknown, knownKeys: Set<string>) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw new Error("Invalid model parameter condition");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Invalid model parameter condition");
    }
    const item = raw as Partial<ModelParameterCondition>;
    if (
      typeof item.key !== "string" || !knownKeys.has(item.key) ||
      !["equals", "falsy", "in", "notEquals", "notIn", "truthy"].includes(String(item.operator))
    ) {
      throw new Error("Invalid model parameter condition");
    }
    if ((item.operator === "in" || item.operator === "notIn") && (!Array.isArray(item.values) || item.values.length < 1 || item.values.length > 16)) {
      throw new Error("Invalid model parameter condition");
    }
    if (
      ((item.operator === "equals" || item.operator === "notEquals") && !isParameterValue(item.value)) ||
      (item.values?.some((entry) => !isParameterValue(entry)) ?? false)
    ) {
      throw new Error("Invalid model parameter condition");
    }
    return {
      key: item.key,
      operator: item.operator!,
      ...(item.value !== undefined ? { value: item.value } : {}),
      ...(item.values !== undefined ? { values: item.values } : {}),
    } satisfies ModelParameterCondition;
  });
}

function cleanReferenceInputs(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid model reference inputs");
  }
  return Object.fromEntries(([
    "audio", "image", "video",
  ] as const).map((key) => {
    const count = Number((value as Record<string, unknown>)[key]);
    if (!Number.isSafeInteger(count) || count < 0 || count > 16) {
      throw new Error("Invalid model reference limit");
    }
    return [key, count];
  })) as ModelReferenceInputs;
}

function cleanUpstreamInputs(
  value: unknown,
  fallback?: ModelUpstreamInputs,
): ModelUpstreamInputs | undefined {
  if (value === undefined) {
    return fallback
      ? Object.fromEntries(Object.entries(fallback).map(([kind, rule]) => [
          kind,
          { ...rule },
        ])) as ModelUpstreamInputs
      : undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid model upstream inputs");
  }
  return Object.fromEntries(([
    "audio", "image", "text", "video",
  ] as const).map((kind) => {
    const raw = (value as Record<string, unknown>)[kind];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Invalid model upstream input");
    }
    const item = raw as Partial<ModelUpstreamInputRule>;
    if (
      typeof item.supported !== "boolean" ||
      (item.limitMode !== "context" && item.limitMode !== "fixed")
    ) {
      throw new Error("Invalid model upstream input");
    }
    const maxCount = item.limitMode === "fixed"
      ? Number(item.maxCount ?? 0)
      : undefined;
    if (
      maxCount !== undefined &&
      (!Number.isSafeInteger(maxCount) || maxCount < 0 || maxCount > 16)
    ) {
      throw new Error("Invalid model upstream input limit");
    }
    return [kind, {
      limitMode: item.limitMode,
      ...(maxCount !== undefined ? { maxCount } : {}),
      ...(typeof item.note === "string" && item.note.trim()
        ? { note: item.note.trim().slice(0, 240) }
        : {}),
      supported: item.supported,
    } satisfies ModelUpstreamInputRule];
  })) as ModelUpstreamInputs;
}

function cleanInputRoleMap(
  value: unknown,
  maximumPerKind = 8,
): Partial<Record<ModelUpstreamInputKind, string[]>> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid model node input role");
  }
  return Object.fromEntries(Object.entries(value).map(([kind, rawRoles]) => {
    if (
      !(["audio", "image", "text", "video"] as string[]).includes(kind) ||
      !Array.isArray(rawRoles) ||
      rawRoles.length > maximumPerKind
    ) {
      throw new Error("Invalid model node input role");
    }
    const cleaned = [...new Set(rawRoles.map((role) =>
      String(role).trim()).filter((role) => /^[a-z][a-z-]{0,39}$/.test(role)))];
    if (cleaned.length !== rawRoles.length) {
      throw new Error("Invalid model node input role");
    }
    return [kind, cleaned];
  })) as Partial<Record<ModelUpstreamInputKind, string[]>>;
}

function cleanReferenceMediaRules(value: unknown): ModelReferenceMediaRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid model reference media rules");
  }
  const raw = value as Record<string, unknown>;
  const duration = (candidate: unknown): number | undefined => {
    if (candidate === undefined || candidate === null || candidate === "") {
      return undefined;
    }
    const parsed = Number(candidate);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 86_400) {
      throw new Error("Invalid model reference media rule");
    }
    return parsed;
  };
  const dimension = (
    candidate: unknown,
    maximum: number,
  ): number | undefined => {
    if (candidate === undefined || candidate === null || candidate === "") {
      return undefined;
    }
    const parsed = Number(candidate);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new Error("Invalid model reference media rule");
    }
    return parsed;
  };
  const ratio = (candidate: unknown): number | undefined => {
    if (candidate === undefined || candidate === null || candidate === "") {
      return undefined;
    }
    const parsed = Number(candidate);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
      throw new Error("Invalid model reference media rule");
    }
    return Math.round(parsed * 100) / 100;
  };
  const rule = (
    key: "audio" | "image" | "video",
  ): ModelReferenceMediaRule | undefined => {
    const candidate = raw[key];
    if (candidate === undefined || candidate === null) return undefined;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Invalid model reference media rule");
    }
    const item = candidate as Partial<ModelReferenceMediaRule>;
    const contentTypes = Array.isArray(item.contentTypes)
      ? [...new Set(item.contentTypes.map((entry) =>
          String(entry).trim()).filter(Boolean))]
      : [];
    if (contentTypes.length < 1 || contentTypes.length > 8) {
      throw new Error("Invalid model reference media rule");
    }
    const maxBytes = Number(item.maxBytes);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_147_483_647) {
      throw new Error("Invalid model reference media rule");
    }
    const minWidth = dimension(item.minWidth, 100_000);
    const maxWidth = dimension(item.maxWidth, 100_000);
    const minHeight = dimension(item.minHeight, 100_000);
    const maxHeight = dimension(item.maxHeight, 100_000);
    const minPixelCount = dimension(item.minPixelCount, 1_000_000_000);
    const maxPixelCount = dimension(item.maxPixelCount, 1_000_000_000);
    const minAspectRatio = ratio(item.minAspectRatio);
    const maxAspectRatio = ratio(item.maxAspectRatio);
    const minDurationSeconds = duration(item.minDurationSeconds);
    const maxDurationSeconds = duration(item.maxDurationSeconds);
    const maxTotalDurationSeconds = duration(item.maxTotalDurationSeconds);
    if (
      minDurationSeconds !== undefined &&
      maxDurationSeconds !== undefined &&
      minDurationSeconds > maxDurationSeconds
    ) {
      throw new Error("Invalid model reference media rule");
    }
    if (
      (minWidth !== undefined && maxWidth !== undefined && minWidth > maxWidth) ||
      (minHeight !== undefined && maxHeight !== undefined && minHeight > maxHeight) ||
      (minPixelCount !== undefined && maxPixelCount !== undefined && minPixelCount > maxPixelCount) ||
      (minAspectRatio !== undefined && maxAspectRatio !== undefined && minAspectRatio > maxAspectRatio)
    ) {
      throw new Error("Invalid model reference media rule");
    }
    return {
      contentTypes,
      maxBytes,
      ...(minWidth !== undefined ? { minWidth } : {}),
      ...(maxWidth !== undefined ? { maxWidth } : {}),
      ...(minHeight !== undefined ? { minHeight } : {}),
      ...(maxHeight !== undefined ? { maxHeight } : {}),
      ...(minPixelCount !== undefined ? { minPixelCount } : {}),
      ...(maxPixelCount !== undefined ? { maxPixelCount } : {}),
      ...(minAspectRatio !== undefined ? { minAspectRatio } : {}),
      ...(maxAspectRatio !== undefined ? { maxAspectRatio } : {}),
      ...(minDurationSeconds !== undefined ? { minDurationSeconds } : {}),
      ...(maxDurationSeconds !== undefined ? { maxDurationSeconds } : {}),
      ...(maxTotalDurationSeconds !== undefined ? { maxTotalDurationSeconds } : {}),
    };
  };
  return {
    ...(rule("audio") ? { audio: rule("audio") } : {}),
    ...(typeof raw.audioRequiresVisual === "boolean"
      ? { audioRequiresVisual: raw.audioRequiresVisual }
      : {}),
    ...(rule("image") ? { image: rule("image") } : {}),
    ...(rule("video") ? { video: rule("video") } : {}),
  };
}

export function cleanParameterSchema(
  capability: ModelCapability,
  input: unknown,
  fallback = defaultParameterSchema(capability),
): ModelParameterSchema {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const candidate = input as Record<string, unknown>;
  if ((candidate.version !== 1 && candidate.version !== 2) || !Array.isArray(candidate.fields)) {
    throw new Error("Invalid model parameter schema");
  }
  if (candidate.fields.length > 24) throw new Error("Too many model parameters");
  const rawKeys = candidate.fields.map((raw) =>
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? String((raw as Record<string, unknown>).key ?? "")
      : "");
  const knownKeys = new Set(rawKeys);
  if (knownKeys.size !== rawKeys.length || rawKeys.some((key) => !key)) {
    throw new Error("Invalid model parameter field");
  }
  const fields = candidate.fields.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Invalid model parameter field");
    }
    const item = raw as Partial<ModelParameterField>;
    const custom = typeof item.key === "string" && isCustomParameterField({ key: item.key });
    const catalog = typeof item.key === "string" ? parameterOptionCatalog[item.key] : undefined;
    const allowedType = ["boolean", "number", "select", "text", "textarea"].includes(String(item.type));
    if (
      (!custom && (!catalog || !catalog.capability.includes(capability) || item.type !== catalog.type)) ||
      (custom && (!allowedType || typeof item.label !== "string" || !item.label.trim() || item.label.trim().length > 40))
    ) {
      throw new Error("Invalid model parameter field");
    }
    const group = item.group ?? catalog?.group ?? "main";
    if (!["advanced", "input", "main", "output"].includes(group)) {
      throw new Error("Invalid model parameter group");
    }
    const optionValues = new Set<ModelParameterValue>();
    const cleanedOptions = (item.options ?? []).map((rawOption) => {
      if (!rawOption || typeof rawOption !== "object") throw new Error("Invalid model parameter option");
      const option = rawOption as ModelParameterOption;
      if (
        typeof option.label !== "string" || !option.label.trim() || option.label.length > 40 ||
        !["boolean", "number", "string"].includes(typeof option.value) ||
        (typeof option.value === "string" && option.value.length > 80) ||
        optionValues.has(option.value)
      ) {
        throw new Error("Invalid model parameter option");
      }
      optionValues.add(option.value);
      return {
        availability: cleanAvailability(option.availability),
        disabledReason: typeof option.disabledReason === "string" ? option.disabledReason.slice(0, 120) : undefined,
        enabledWhen: cleanConditionList(option.enabledWhen, knownKeys),
        label: option.label.trim(),
        value: option.value,
      } satisfies ModelParameterOption;
    });
    const fieldType = (catalog?.type ?? item.type) as ModelParameterField["type"];
    const selectionType = fieldType === "select" || fieldType === "boolean";
    const defaultOption = cleanedOptions.find((option) => option.value === item.defaultValue);
    if (
      selectionType &&
      (!cleanedOptions.length || !defaultOption || (defaultOption.availability ?? "available") !== "available")
    ) {
      throw new Error("Invalid model parameter default");
    }
    if (!selectionType && typeof item.defaultValue !== (fieldType === "number" ? "number" : "string")) {
      throw new Error("Invalid model parameter default");
    }
    if (!selectionType && cleanedOptions.length > 0) {
      throw new Error("Invalid model parameter option");
    }
    const minimum = typeof item.min === "number" && Number.isFinite(item.min) ? item.min : undefined;
    const maximum = typeof item.max === "number" && Number.isFinite(item.max) ? item.max : undefined;
    if (
      fieldType === "number" &&
      (minimum !== undefined && maximum !== undefined && minimum > maximum ||
        typeof item.defaultValue === "number" &&
        (item.defaultValue < (minimum ?? Number.NEGATIVE_INFINITY) || item.defaultValue > (maximum ?? Number.POSITIVE_INFINITY)))
    ) {
      throw new Error("Invalid model parameter default");
    }
    return {
      defaultValue: item.defaultValue!,
      enabledWhen: cleanConditionList(item.enabledWhen, knownKeys),
      group,
      key: item.key!,
      label: catalog?.label ?? item.label!.trim(),
      max: maximum,
      maxLength: catalog?.maxLength ?? (typeof item.maxLength === "number" ? Math.min(20_000, Math.max(1, Math.round(item.maxLength))) : undefined),
      min: minimum,
      options: cleanedOptions,
      placeholder: catalog?.placeholder ?? (typeof item.placeholder === "string" ? item.placeholder.slice(0, 80) : undefined),
      providerStatus: custom ? "pending" : undefined,
      requiredWhen: cleanConditionList(item.requiredWhen, knownKeys),
      step: typeof item.step === "number" && item.step > 0 ? item.step : undefined,
      summary: item.summary ?? catalog?.summary,
      type: fieldType,
      visibleWhen: cleanConditionList(item.visibleWhen, knownKeys),
    } satisfies ModelParameterField;
  });
  const referenceInputs = cleanReferenceInputs(candidate.referenceInputs);
  const referenceMediaRules = candidate.version === 2 &&
      candidate.referenceMediaRules !== undefined
    ? cleanReferenceMediaRules(candidate.referenceMediaRules)
    : undefined;
  const upstreamInputs = cleanUpstreamInputs(
    candidate.upstreamInputs,
    fallback.upstreamInputs,
  );
  let inputPolicy: ModelNodeInputPolicy | undefined;
  if (candidate.inputPolicy !== undefined) {
    if (!candidate.inputPolicy || typeof candidate.inputPolicy !== "object" || Array.isArray(candidate.inputPolicy)) {
      throw new Error("Invalid model node input policy");
    }
    const rawPolicy = candidate.inputPolicy as Partial<ModelNodeInputPolicy>;
    if (rawPolicy.switchPolicy !== "keep-edge" && rawPolicy.switchPolicy !== "block-switch") {
      throw new Error("Invalid model node input switch policy");
    }
    if (
      rawPolicy.promptPolicy !== undefined &&
      rawPolicy.promptPolicy !== "own-required" &&
      rawPolicy.promptPolicy !== "own-or-upstream-text"
    ) {
      throw new Error("Invalid model node input prompt policy");
    }
    const required = Object.fromEntries(Object.entries(rawPolicy.required ?? {}).map(([kind, count]) => {
      if (!(["audio", "image", "text", "video"] as string[]).includes(kind) ||
        !Number.isSafeInteger(count) || Number(count) < 0 || Number(count) > 16) {
        throw new Error("Invalid model required node input");
      }
      return [kind, Number(count)];
    })) as ModelNodeInputPolicy["required"];
    const roles = cleanInputRoleMap(rawPolicy.roles) as ModelNodeInputPolicy["roles"];
    const rolePolicies = rawPolicy.rolePolicies === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(rawPolicy.rolePolicies) || rawPolicy.rolePolicies.length > 8) {
            throw new Error("Invalid model node input role policy");
          }
          return rawPolicy.rolePolicies.map((raw) => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
              throw new Error("Invalid model node input role policy");
            }
            const policy = raw as Partial<ModelInputRolePolicy>;
            const policyRoles = cleanInputRoleMap(policy.roles, 8);
            for (const [kind, configured] of Object.entries(policyRoles)) {
              const globallyAllowed = roles?.[kind as ModelUpstreamInputKind] ?? [];
              if (configured.some((role) => !globallyAllowed.includes(role))) {
                throw new Error("Invalid model node input role policy");
              }
            }
            const assignment = policy.assignment === undefined
              ? undefined
              : (() => {
                  const cleaned = cleanInputRoleMap(policy.assignment, 16);
                  for (const [kind, assigned] of Object.entries(cleaned)) {
                    const allowed = policyRoles[kind as ModelUpstreamInputKind] ?? [];
                    if (assigned.some((role) => !allowed.includes(role))) {
                      throw new Error("Invalid model node input role assignment");
                    }
                  }
                  return cleaned;
                })();
            const limits = policy.limits === undefined
              ? undefined
              : (() => {
                  if (!Array.isArray(policy.limits) || policy.limits.length > 32) {
                    throw new Error("Invalid model node input role limit");
                  }
                  const seen = new Set<string>();
                  return policy.limits.map((rawLimit) => {
                    if (!rawLimit || typeof rawLimit !== "object" || Array.isArray(rawLimit)) {
                      throw new Error("Invalid model node input role limit");
                    }
                    const limit = rawLimit as Partial<ModelInputRoleLimit>;
                    const kind = String(limit.kind) as ModelUpstreamInputKind;
                    const role = String(limit.role ?? "").trim();
                    const minCount = Number(limit.minCount);
                    const maxCount = Number(limit.maxCount);
                    if (
                      !(["audio", "image", "text", "video"] as string[]).includes(kind) ||
                      !/^[a-z][a-z-]{0,39}$/.test(role) ||
                      !policyRoles[kind]?.includes(role) ||
                      !Number.isSafeInteger(minCount) ||
                      !Number.isSafeInteger(maxCount) ||
                      minCount < 0 ||
                      maxCount < minCount ||
                      maxCount > 16 ||
                      seen.has(`${kind}:${role}`)
                    ) {
                      throw new Error("Invalid model node input role limit");
                    }
                    seen.add(`${kind}:${role}`);
                    return { kind, maxCount, minCount, role };
                  });
                })();
            return {
              assignment,
              enabledWhen: cleanConditionList(policy.enabledWhen, knownKeys),
              limits,
              roles: policyRoles,
            } satisfies ModelInputRolePolicy;
          });
        })();
    inputPolicy = {
      ...(rawPolicy.promptPolicy
        ? { promptPolicy: rawPolicy.promptPolicy }
        : {}),
      required,
      ...(rolePolicies ? { rolePolicies } : {}),
      roles,
      switchPolicy: rawPolicy.switchPolicy,
    };
  }
  let referencePolicy: ModelReferencePolicy | undefined;
  if (candidate.version === 2 && candidate.referencePolicy !== undefined) {
    const policy = candidate.referencePolicy as Partial<ModelReferencePolicy>;
    if (!policy || typeof policy !== "object" || typeof policy.modeKey !== "string" || !knownKeys.has(policy.modeKey) || !policy.modes || typeof policy.modes !== "object") {
      throw new Error("Invalid model reference policy");
    }
    const modes = Object.fromEntries(Object.entries(policy.modes).map(([mode, rawMode]) => {
      if (!rawMode || typeof rawMode !== "object" || !Array.isArray((rawMode as ModelReferenceMode).sets)) {
        throw new Error("Invalid model reference policy");
      }
      const sets = (rawMode as ModelReferenceMode).sets;
      if (sets.length < 1 || sets.length > 4) throw new Error("Invalid model reference policy");
      const cleanedSets = sets.map(cleanReferenceInputs);
      if (cleanedSets.some((set) =>
        set.audio > referenceInputs.audio ||
        set.image > referenceInputs.image ||
        set.video > referenceInputs.video)) {
        throw new Error("Invalid model reference policy");
      }
      return [mode, { sets: cleanedSets }];
    }));
    const modeField = fields.find((field) => field.key === policy.modeKey);
    if (
      !modeField ||
      Object.keys(modes).some((mode) => !modeField.options.some((option) => String(option.value) === mode))
    ) {
      throw new Error("Invalid model reference policy");
    }
    referencePolicy = { modeKey: policy.modeKey, modes };
  }
  return {
    fields,
    groups: defaultParameterGroups.map((group) => ({ ...group })),
    inputPolicy,
    referenceInputs,
    ...(referenceMediaRules
      ? { referenceMediaRules }
      : {}),
    referencePolicy,
    upstreamInputs,
    version: 2,
  };
}
