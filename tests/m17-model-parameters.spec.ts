import { expect, test } from "@playwright/test";
import { composeTextControl } from "./helpers/ime";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import { buildMurekaAudioRequest } from "../server/murekaAudioProvider";
import { availableNodeInputRoles } from "../types/nodeInputs";
import {
  cleanParameterSchema,
  defaultParameterSchema,
  defaultParameterValues,
  knownModelParameterSchema,
  parameterKeysForGroups,
  parameterFieldVisible,
  providerParameterSchema,
  referenceLimitsForValues,
  submissionParameterValues,
  validateParameterSchemaConstraints,
  validateParameterValues,
} from "../types/modelParameters";

test("future models use the safe shared parameter registry", () => {
  const schema = knownModelParameterSchema({
    capability: "video",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
  });
  expect(defaultParameterValues(schema)).toMatchObject({
    aspectRatio: "16:9",
    duration: 5,
    generateAudio: true,
    outputCount: 1,
    resolution: "480p",
  });
  expect(validateParameterValues(schema, {
    aspectRatio: "9:16",
    duration: 5,
    generateAudio: false,
    inputMode: "text",
    outputCount: 1,
    resolution: "480p",
  })).toMatchObject({
    aspectRatio: "9:16",
    duration: 5,
    generateAudio: false,
    resolution: "480p",
  });
  expect(schema.fields.find((field) => field.key === "aspectRatio")?.options.map((option) => option.value))
    .toEqual(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]);
  expect(referenceLimitsForValues(schema, { inputMode: "first-last-frame" }))
    .toEqual({ audio: 0, image: 2, video: 0 });
  expect(referenceLimitsForValues(schema, { inputMode: "multimodal" }))
    .toEqual({ audio: 3, image: 9, video: 3 });
  const inputMode = schema.fields.find((field) => field.key === "inputMode")!;
  expect(inputMode.options.map(({ availability, value }) => ({
    availability: availability ?? "available",
    value,
  }))).toEqual([
    { availability: "available", value: "text" },
    { availability: "available", value: "first-last-frame" },
    { availability: "available", value: "multimodal" },
  ]);
  expect(availableNodeInputRoles({
    kind: "image",
    modelSchema: schema,
    parameters: { inputMode: "first-last-frame" },
    targetKind: "video",
  })).toEqual(["first-frame", "last-frame"]);
  expect(availableNodeInputRoles({
    kind: "image",
    modelSchema: schema,
    parameters: { inputMode: "multimodal" },
    targetKind: "video",
  })).toEqual(["subject", "reference-image"]);
  expect(availableNodeInputRoles({
    kind: "video",
    modelSchema: schema,
    parameters: { inputMode: "multimodal" },
    targetKind: "video",
  })).toEqual(["subject", "reference-video"]);
  expect(availableNodeInputRoles({
    kind: "audio",
    modelSchema: schema,
    parameters: { inputMode: "multimodal" },
    targetKind: "video",
  })).toEqual(["reference-audio"]);
  expect(schema.inputPolicy).toMatchObject({
    promptPolicy: "own-required",
    rolePolicies: expect.arrayContaining([
      expect.objectContaining({
        assignment: { image: ["first-frame", "last-frame"] },
        limits: [
          { kind: "image", maxCount: 1, minCount: 1, role: "first-frame" },
          { kind: "image", maxCount: 1, minCount: 1, role: "last-frame" },
        ],
      }),
      expect.objectContaining({
        limits: expect.arrayContaining([
          { kind: "image", maxCount: 1, minCount: 0, role: "subject" },
          { kind: "video", maxCount: 1, minCount: 0, role: "subject" },
        ]),
      }),
    ]),
    switchPolicy: "keep-edge",
  });
  expect(() => validateParameterValues(schema, {
    aspectRatio: "16:9",
    duration: 10,
    generateAudio: false,
    inputMode: "text",
    outputCount: 1,
    resolution: "720p",
  })).toThrow("Unsupported model parameter value");
  expect(() => validateParameterValues(schema, { resolution: "1080p" }))
    .toThrow("Unsupported model parameter value");
  expect(() => validateParameterValues(schema, { providerRawOption: "unsafe" }))
    .toThrow("Unsupported model parameter");
  expect(() => cleanParameterSchema("video", {
    fields: [{
      defaultValue: "unsafe",
      key: "providerRawOption",
      label: "不安全字段",
      options: [{ label: "不安全", value: "unsafe" }],
      type: "select",
    }],
    referenceInputs: { audio: 0, image: 0, video: 0 },
    version: 1,
  })).toThrow("Invalid model parameter field");
  const constraints = providerParameterSchema({
    capability: "video",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
  });
  expect(() => validateParameterSchemaConstraints(cleanParameterSchema("video", {
    fields: [{
      defaultValue: "1080p",
      key: "resolution",
      label: "分辨率",
      options: [{ label: "1080p", value: "1080p" }],
      type: "select",
    }],
    referenceInputs: { audio: 0, image: 0, video: 0 },
    version: 1,
  }), constraints)).toThrow("not supported");
});

test("Seedance reference media rules are model-driven and future models inherit a wider family ceiling", () => {
  const mini = knownModelParameterSchema({
    capability: "video",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
  });
  expect(mini.referenceMediaRules?.audio).toMatchObject({
    maxBytes: 15 * 1024 * 1024,
    maxDurationSeconds: 15,
    maxTotalDurationSeconds: 15,
    minDurationSeconds: 2,
  });
  expect(mini.referenceMediaRules?.audioRequiresVisual).toBe(true);
  const miniDurations = mini.fields.find((field) => field.key === "duration")!
    .options.map((option) => option.value);
  expect(miniDurations).toContain(15);
  expect(miniDurations).not.toContain(16);

  const future = knownModelParameterSchema({
    capability: "video",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-5-260628",
  });
  const futureDurations = future.fields.find((field) => field.key === "duration")!
    .options.map((option) => option.value);
  expect(futureDurations).toContain(30);
  expect(future.referenceMediaRules?.audio).toMatchObject({
    maxDurationSeconds: 30,
    maxTotalDurationSeconds: 30,
    minDurationSeconds: 2,
  });

  const familyConstraints = providerParameterSchema({
    capability: "video",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-5-260628",
  })!;
  const tightened = cleanParameterSchema("video", {
    ...structuredClone(future),
    referenceMediaRules: {
      audio: {
        contentTypes: ["audio/mpeg", "audio/wav"],
        maxBytes: 20 * 1024 * 1024,
        maxDurationSeconds: 25,
        maxTotalDurationSeconds: 25,
        minDurationSeconds: 2,
      },
      audioRequiresVisual: true,
      image: { contentTypes: ["image/png"], maxBytes: 20 * 1024 * 1024 },
      video: {
        contentTypes: ["video/mp4"],
        maxBytes: 200 * 1024 * 1024,
        maxDurationSeconds: 30,
        maxTotalDurationSeconds: 30,
        minDurationSeconds: 2,
      },
    },
  }, future);
  expect(() => validateParameterSchemaConstraints(tightened, familyConstraints))
    .not.toThrow();

  const over = cleanParameterSchema("video", {
    ...structuredClone(future),
    referenceMediaRules: {
      ...future.referenceMediaRules,
      audio: {
        ...future.referenceMediaRules!.audio!,
        maxBytes: 31 * 1024 * 1024,
      },
    },
  }, future);
  expect(() => validateParameterSchemaConstraints(over, familyConstraints))
    .toThrow("not supported");
});

test("relay Text models use bounded output and temperature controls without changing generic Text defaults", () => {
  const relay = knownModelParameterSchema({
    capability: "text",
    providerDriver: "multi-protocol-relay",
    providerModelId: "gpt-5.4-nano",
  });
  expect(relay.fields.map((field) => field.key)).toEqual([
    "inputMode",
    "maxOutputTokens",
    "temperature",
    "outputCount",
  ]);
  expect(defaultParameterValues(relay)).toEqual({
    inputMode: "text",
    maxOutputTokens: 64,
    outputCount: 1,
    temperature: 0,
  });
  expect(relay.fields.find((field) => field.key === "maxOutputTokens")?.options
    .map((option) => option.value)).toEqual([
      16, 32, 64, 128, 256, 512, 1024, 2048, 4096,
    ]);
  expect(relay.fields.find((field) => field.key === "temperature")?.options
    .map((option) => option.value)).toEqual([0, 0.2, 0.5, 0.7, 1]);
  expect(validateParameterValues(relay, {
    inputMode: "text",
    maxOutputTokens: 16,
    outputCount: 1,
    temperature: 0.2,
  })).toEqual({
    inputMode: "text",
    maxOutputTokens: 16,
    outputCount: 1,
    temperature: 0.2,
  });
  expect(() => validateParameterValues(relay, {
    maxOutputTokens: 8192,
  })).toThrow("Unsupported model parameter value");
  expect(() => validateParameterValues(relay, {
    temperature: 2,
  })).toThrow("Unsupported model parameter value");

  const constraints = providerParameterSchema({
    capability: "text",
    providerDriver: "multi-protocol-relay",
    providerModelId: "gpt-5.4-nano",
  });
  const unsupported = structuredClone(relay);
  unsupported.fields.push(defaultParameterSchema("text").fields.find(
    (field) => field.key === "creativity",
  )!);
  expect(() => validateParameterSchemaConstraints(unsupported, constraints))
    .toThrow("not supported");

  expect(defaultParameterValues(defaultParameterSchema("text"))).toEqual({
    creativity: "balanced",
    inputMode: "text",
    outputCount: 1,
    responseFormat: "plain",
  });
});

test("relay doubao TTS uses only its documented bounded controls", () => {
  const relay = knownModelParameterSchema({
    capability: "audio",
    providerDriver: "multi-protocol-relay",
    providerModelId: "doubao-tts-2.0",
  });
  expect(relay.fields.map((field) => field.key)).toEqual([
    "inputMode",
    "speaker",
    "speechRate",
    "emotion",
    "emotionScale",
    "format",
    "outputCount",
  ]);
  expect(defaultParameterValues(relay)).toEqual({
    emotion: "auto",
    emotionScale: 4,
    format: "mp3",
    inputMode: "text",
    outputCount: 1,
    speaker: "zh_female_vv_uranus_bigtts",
    speechRate: "0",
  });
  expect(relay.fields.some((field) => field.key === "duration")).toBe(false);
  expect(relay.fields.some((field) => field.key === "audioMode")).toBe(false);
  expect(parameterFieldVisible(
    relay.fields.find((field) => field.key === "emotionScale")!,
    defaultParameterValues(relay),
  )).toBe(false);
  expect(parameterFieldVisible(
    relay.fields.find((field) => field.key === "emotionScale")!,
    { ...defaultParameterValues(relay), emotion: "happy" },
  )).toBe(true);
  const automaticValues = defaultParameterValues(relay);
  expect(submissionParameterValues(relay, automaticValues)).toEqual({
    emotion: "auto",
    format: "mp3",
    inputMode: "text",
    outputCount: 1,
    speaker: "zh_female_vv_uranus_bigtts",
    speechRate: "0",
  });
  expect(validateParameterValues(relay, automaticValues)).toEqual(
    submissionParameterValues(relay, automaticValues),
  );

  const enabledOnly = structuredClone(relay);
  const enabledOnlyScale = enabledOnly.fields.find(
    (field) => field.key === "emotionScale",
  )!;
  enabledOnlyScale.visibleWhen = undefined;
  expect(parameterFieldVisible(enabledOnlyScale, automaticValues)).toBe(true);
  expect(submissionParameterValues(enabledOnly, automaticValues))
    .not.toHaveProperty("emotionScale");
  expect(validateParameterValues(enabledOnly, automaticValues))
    .not.toHaveProperty("emotionScale");
  expect(validateParameterValues(relay, {
    emotion: "happy",
    emotionScale: 2,
    format: "wav",
    inputMode: "text",
    outputCount: 1,
    speaker: "zh_female_vv_uranus_bigtts",
    speechRate: "-25",
  })).toMatchObject({
    emotion: "happy",
    emotionScale: 2,
    format: "wav",
    outputCount: 1,
    speaker: "zh_female_vv_uranus_bigtts",
    speechRate: "-25",
  });
});

test("Seedance Provider input floors cannot be omitted while narrower active modes remain valid", () => {
  const constraints = providerParameterSchema({
    capability: "video",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
  })!;
  const baseline = structuredClone(constraints);
  const validate = (candidate: typeof baseline) => validateParameterSchemaConstraints(
    cleanParameterSchema("video", candidate, baseline),
    constraints,
  );

  const noReferencePolicy = structuredClone(baseline);
  noReferencePolicy.referencePolicy = undefined;
  expect(() => validate(noReferencePolicy)).toThrow("reference policy is required");

  const missingReferenceMode = structuredClone(baseline);
  delete missingReferenceMode.referencePolicy!.modes.multimodal;
  expect(() => validate(missingReferenceMode)).toThrow("reference policy is required");

  const noInputPolicy = structuredClone(baseline);
  noInputPolicy.inputPolicy = undefined;
  expect(() => validate(noInputPolicy)).toThrow("input policy is required");

  const noRolePolicies = structuredClone(baseline);
  noRolePolicies.inputPolicy!.rolePolicies = undefined;
  expect(() => validate(noRolePolicies)).toThrow("role policy is required");

  const relaxedPrompt = structuredClone(baseline);
  relaxedPrompt.inputPolicy!.promptPolicy = "own-or-upstream-text";
  expect(() => validate(relaxedPrompt)).toThrow("prompt policy cannot weaken");

  const missingSubjectLimit = structuredClone(baseline);
  const multimodalWithoutSubjectLimit = missingSubjectLimit.inputPolicy!.rolePolicies!
    .find((policy) => policy.enabledWhen?.[0]?.value === "multimodal")!;
  multimodalWithoutSubjectLimit.limits = multimodalWithoutSubjectLimit.limits
    ?.filter((limit) => !(limit.kind === "image" && limit.role === "subject"));
  expect(() => validate(missingSubjectLimit)).toThrow("role limit cannot weaken");

  const missingRequiredFrame = structuredClone(baseline);
  missingRequiredFrame.inputPolicy!.roles!.image = missingRequiredFrame.inputPolicy!.roles!.image
    ?.filter((role) => role !== "first-frame");
  const firstLast = missingRequiredFrame.inputPolicy!.rolePolicies!
    .find((policy) => policy.enabledWhen?.[0]?.value === "first-last-frame")!;
  firstLast.roles.image = firstLast.roles.image?.filter((role) => role !== "first-frame");
  firstLast.assignment!.image = firstLast.assignment!.image?.filter((role) => role !== "first-frame");
  firstLast.limits = firstLast.limits?.filter((limit) => limit.role !== "first-frame");
  expect(() => validate(missingRequiredFrame)).toThrow("cannot remove a required Provider role");

  const narrowedOptionalRole = structuredClone(baseline);
  narrowedOptionalRole.inputPolicy!.roles!.image = narrowedOptionalRole.inputPolicy!.roles!.image
    ?.filter((role) => role !== "subject");
  const narrowedMultimodal = narrowedOptionalRole.inputPolicy!.rolePolicies!
    .find((policy) => policy.enabledWhen?.[0]?.value === "multimodal")!;
  narrowedMultimodal.roles.image = narrowedMultimodal.roles.image
    ?.filter((role) => role !== "subject");
  narrowedMultimodal.limits = narrowedMultimodal.limits
    ?.filter((limit) => !(limit.kind === "image" && limit.role === "subject"));
  expect(validate(narrowedOptionalRole)).toEqual(narrowedOptionalRole);

  const narrowedModes = structuredClone(baseline);
  const inputMode = narrowedModes.fields.find((field) => field.key === "inputMode")!;
  inputMode.options = inputMode.options.filter((option) => option.value !== "multimodal");
  delete narrowedModes.referencePolicy!.modes.multimodal;
  narrowedModes.inputPolicy!.rolePolicies = narrowedModes.inputPolicy!.rolePolicies
    ?.filter((policy) => policy.enabledWhen?.[0]?.value !== "multimodal");
  expect(validate(narrowedModes)).toEqual(narrowedModes);

  const omittedUpstream = structuredClone(baseline);
  omittedUpstream.upstreamInputs = undefined;
  expect(validate(omittedUpstream).upstreamInputs).toEqual(baseline.upstreamInputs);
});

test("Doubao Seed 2.0 Lite exposes only the supported Ark text parameters", () => {
  const schema = knownModelParameterSchema({
    capability: "text",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
  });
  expect(defaultParameterValues(schema)).toEqual({
    inputMode: "text",
    outputCount: 1,
    responseFormat: "text",
    thinkingLevel: "medium",
  });
  expect(schema.fields.find((field) => field.key === "thinkingLevel")?.options)
    .toEqual([
      { label: "关闭", value: "minimal" },
      { label: "开启", value: "medium" },
    ]);
  expect(schema.fields.find((field) => field.key === "responseFormat")?.options)
    .toEqual([
      { label: "文本", value: "text" },
    ]);
  expect(schema.fields.find((field) => field.key === "outputCount")?.options)
    .toEqual([{ label: "1×", value: 1 }]);
  expect(schema.referenceInputs).toEqual({ audio: 0, image: 0, video: 0 });
  expect(schema.upstreamInputs).toMatchObject({
    audio: { limitMode: "context", supported: true },
    image: { limitMode: "context", supported: true },
    text: { limitMode: "context", supported: true },
    video: { limitMode: "context", supported: true },
  });
  expect(cleanParameterSchema("text", {
    ...schema,
    upstreamInputs: undefined,
  }, schema).upstreamInputs).toEqual(schema.upstreamInputs);
  expect(() => validateParameterValues(schema, {
    inputMode: "text",
    outputCount: 2,
    responseFormat: "json_object",
    thinkingLevel: "high",
  })).toThrow("Unsupported model parameter value");
  expect(validateParameterValues(schema, {
    inputMode: "text",
    outputCount: 1,
    responseFormat: "text",
    thinkingLevel: "medium",
  })).toEqual({
    inputMode: "text",
    outputCount: 1,
    responseFormat: "text",
    thinkingLevel: "medium",
  });
});

test("Mureka audio rules expose only official safe parameters", () => {
  const schema = knownModelParameterSchema({
    capability: "audio",
    providerDriver: "mureka",
    providerModelId: "mureka-9",
  });
  expect(defaultParameterValues(schema)).toEqual({
    lyrics: "",
    musicGenerationMode: "instrumental",
    outputCount: 1,
    streamPlayback: false,
    vocalGender: "female",
  });
  expect(schema.referenceInputs).toEqual({ audio: 0, image: 0, video: 0 });
  expect(parameterFieldVisible(
    schema.fields.find((field) => field.key === "lyrics")!,
    { musicGenerationMode: "instrumental" },
  )).toBe(false);
  expect(parameterFieldVisible(
    schema.fields.find((field) => field.key === "lyrics")!,
    { musicGenerationMode: "lyrics-song" },
  )).toBe(true);
  expect(validateParameterValues(schema, {
    lyrics: "[Verse]\n你好",
    musicGenerationMode: "lyrics-song",
    outputCount: 2,
    streamPlayback: false,
    vocalGender: "female",
  })).toMatchObject({
    lyrics: "[Verse]\n你好",
    musicGenerationMode: "lyrics-song",
    outputCount: 2,
  });

  expect(buildMurekaAudioRequest({
    model: "mureka-9",
    musicGenerationMode: "instrumental",
    outputCount: 1,
    prompt: "温暖、安静的钢琴配乐",
    streamPlayback: false,
  })).toEqual({
    endpoint: "/v1/instrumental/generate",
    payload: {
      model: "mureka-9",
      n: 1,
      prompt: "温暖、安静的钢琴配乐",
      stream: false,
    },
  });
  expect(() => buildMurekaAudioRequest({
    model: "mureka-9",
    musicGenerationMode: "instrumental",
    outputCount: 4,
    prompt: "不会发送",
    streamPlayback: false,
  })).toThrow("output count");
});

test("text node shows connected multimodal inputs, removes only the selected edge and never submits", async ({
  page,
}) => {
  const paidPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (/\/api\/generation-tasks/.test(request.url()) || /openrouter|volces/i.test(request.url()))
    ) {
      paidPosts.push(request.url());
    }
  });
  const createdResponse = await page.request.post("/api/admin/models", {
    data: {
      capability: "text",
      displayName: "Multimodal Text",
      isDefault: true,
      parameterSchema: {
        ...defaultParameterSchema("text"),
        upstreamInputs: {
          audio: { limitMode: "context", supported: true },
          image: { limitMode: "context", supported: true },
          text: { limitMode: "context", supported: true },
          video: { limitMode: "context", supported: true },
        },
      },
      providerModelId: "test/multimodal-text",
      sortOrder: 1,
      status: "published",
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json() as { model: { id: string } };
  await page.request.delete("/api/canvas/default");
  const nodes = [
    {
      id: "upstream-text",
      type: "text",
      position: { x: 80, y: 80 },
      data: { content: "上游文字内容", label: "Text", title: "文字资料" },
      style: { height: 250, width: 250 },
    },
    {
      id: "upstream-image",
      type: "image",
      position: { x: 80, y: 380 },
      data: {
        imageSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%233a7894'/%3E%3C/svg%3E",
        label: "Image",
        title: "图片资料",
      },
      style: { height: 250, width: 250 },
    },
    {
      id: "upstream-video",
      type: "video",
      position: { x: 80, y: 680 },
      data: { label: "Video", title: "视频资料", videoSrc: "/api/media/video/demo" },
      style: { height: 250, width: 444 },
    },
    {
      id: "upstream-audio",
      type: "audio",
      position: { x: 80, y: 980 },
      data: { audioSrc: "/api/media/audio/demo", label: "Audio", title: "音频资料" },
      style: { height: 250, width: 444 },
    },
    {
      id: "multimodal-target",
      type: "text",
      position: { x: 720, y: 420 },
      selected: true,
      data: {
        content: "",
        label: "Text",
        textModelId: created.model.id,
        textPromptReady: true,
        title: "豆包多模态理解",
      },
      style: { height: 250, width: 250 },
    },
  ];
  const edges = ["text", "image", "video", "audio"].map((kind) => ({
    id: `edge-${kind}-target`,
    source: `upstream-${kind}`,
    sourceHandle: "source",
    target: "multimodal-target",
    targetHandle: "target",
    type: "cuttable",
  }));
  const saved = await page.request.put("/api/canvas/default", {
    data: { edges, nodes, revision: 0, viewport: { x: 0, y: 0, zoom: 0.7 } },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/?v=text-upstream-inputs1");
  await expect(
    page.getByTestId("text-creator").getByRole("button", { exact: true, name: "文本" }),
  ).toHaveCount(0);
  const inputs = page.getByTestId("text-upstream-inputs");
  await expect(inputs.locator(":scope > div")).toHaveCount(4);
  for (const title of ["文字资料", "图片资料", "视频资料", "音频资料"]) {
    await expect(inputs.getByRole("button", { name: `查看引用 ${title}` }))
      .toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Generate" })).toBeDisabled();
  await inputs.getByRole("button", { name: "删除引用 视频资料" }).click();
  await expect(inputs.locator(":scope > div")).toHaveCount(3);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-edge-count", "3");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.reload();
  await expect(page.getByTestId("text-upstream-inputs").locator(":scope > div")).toHaveCount(3);
  expect(paidPosts).toEqual([]);
});

test("version 2 expresses conditional inputs, unavailable choices and reference combinations", () => {
  const audioSchema = cleanParameterSchema("audio", {
    fields: [
      {
        defaultValue: "auto",
        key: "lyricsMode",
        label: "歌词",
        options: [
          { label: "自适应", value: "auto" },
          { label: "自定义", value: "custom" },
        ],
        type: "select",
      },
      {
        defaultValue: "",
        key: "lyrics",
        label: "歌词",
        options: [],
        requiredWhen: [{ key: "lyricsMode", operator: "equals", value: "custom" }],
        type: "textarea",
        visibleWhen: [{ key: "lyricsMode", operator: "equals", value: "custom" }],
      },
    ],
    groups: [],
    referenceInputs: { audio: 0, image: 0, video: 0 },
    version: 2,
  });
  expect(audioSchema.version).toBe(2);
  expect(audioSchema.groups.map((group) => group.key)).toEqual([
    "input", "main", "advanced", "output",
  ]);
  const lyrics = audioSchema.fields.find((field) => field.key === "lyrics")!;
  expect(parameterFieldVisible(lyrics, { lyricsMode: "auto" })).toBe(false);
  expect(parameterFieldVisible(lyrics, { lyricsMode: "custom" })).toBe(true);
  expect(() => validateParameterValues(audioSchema, {
    lyrics: "",
    lyricsMode: "custom",
  })).toThrow("Required model parameter is missing");
  expect(validateParameterValues(audioSchema, {
    lyrics: "夜色落在窗边",
    lyricsMode: "custom",
  })).toMatchObject({ lyrics: "夜色落在窗边", lyricsMode: "custom" });

  const videoSchema = cleanParameterSchema("video", {
    fields: [
      {
        defaultValue: "first-last-frame",
        key: "inputMode",
        label: "生成方式",
        options: [
          { label: "首尾帧", value: "first-last-frame" },
          { label: "参考", value: "reference" },
        ],
        type: "select",
      },
      {
        defaultValue: "540p",
        key: "resolution",
        label: "清晰度",
        options: [
          { label: "540p", value: "540p" },
          { availability: "disabled", disabledReason: "当前账号未开放", label: "720p", value: "720p" },
        ],
        type: "select",
      },
    ],
    groups: [],
    referenceInputs: { audio: 0, image: 7, video: 2 },
    referencePolicy: {
      modeKey: "inputMode",
      modes: {
        "first-last-frame": { sets: [{ audio: 0, image: 2, video: 0 }] },
        reference: {
          sets: [
            { audio: 0, image: 3, video: 2 },
            { audio: 0, image: 5, video: 0 },
          ],
        },
      },
    },
    version: 2,
  });
  expect(referenceLimitsForValues(videoSchema, { inputMode: "first-last-frame" }))
    .toEqual({ audio: 0, image: 2, video: 0 });
  expect(referenceLimitsForValues(videoSchema, { inputMode: "reference" }))
    .toEqual({ audio: 0, image: 5, video: 2 });
  expect(() => validateParameterValues(videoSchema, {
    inputMode: "reference",
    resolution: "720p",
  })).toThrow("Unsupported model parameter value");
});

test("stored version 1 schemas migrate without losing accepted settings", () => {
  const migrated = cleanParameterSchema("image", {
    fields: [
      {
        defaultValue: "1:1",
        key: "aspectRatio",
        label: "比例",
        options: [{ label: "1:1", value: "1:1" }],
        type: "select",
      },
    ],
    referenceInputs: { audio: 0, image: 4, video: 0 },
    version: 1,
  });
  expect(migrated).toMatchObject({
    fields: [{ defaultValue: "1:1", group: "main", key: "aspectRatio" }],
    referenceInputs: { audio: 0, image: 4, video: 0 },
    version: 2,
  });
});

test("future custom parameters remain safe and automatically join node controls", () => {
  const custom = cleanParameterSchema("text", {
    fields: [
      {
        defaultValue: "medium",
        group: "main",
        key: "custom_12345678",
        label: "安全等级",
        options: [
          { label: "低", value: "low" },
          { label: "中", value: "medium" },
          { label: "高", value: "high" },
        ],
        providerStatus: "pending",
        summary: true,
        type: "select",
      },
    ],
    groups: [],
    referenceInputs: { audio: 0, image: 0, video: 0 },
    version: 2,
  });
  expect(custom.fields[0]).toMatchObject({
    key: "custom_12345678",
    label: "安全等级",
    providerStatus: "pending",
  });
  expect(parameterKeysForGroups(custom, ["main"])).toEqual(["custom_12345678"]);
  expect(validateParameterSchemaConstraints(
    custom,
    providerParameterSchema({
      capability: "text",
      providerDriver: "volcengine-ark",
      providerModelId: "doubao-seed-2-0-lite-260428",
    }),
  )).toEqual(custom);
  expect(validateParameterValues(custom, { custom_12345678: "high" }))
    .toEqual({ custom_12345678: "high" });
  expect(() => cleanParameterSchema("text", {
    fields: [{
      defaultValue: "unsafe",
      key: "provider_raw_key",
      label: "不安全字段",
      options: [{ label: "不安全", value: "unsafe" }],
      type: "select",
    }],
    referenceInputs: { audio: 0, image: 0, video: 0 },
    version: 2,
  })).toThrow("Invalid model parameter field");
});

test("generation tasks retain the submitted model configuration snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-parameter-snapshot-"));
  try {
    const schema = knownModelParameterSchema({
      capability: "video",
      providerDriver: "volcengine-ark",
      providerModelId: "doubao-seedance-2-0-mini-260615",
    });
    const first = createGenerationTaskStore(directory);
    const created = first.create({
      canvasId: "parameter-snapshot",
      idempotencyKey: "parameter-snapshot-request",
      kind: "video",
      model: "seedance-mini",
      modelConfiguration: {
        modelId: "seedance-mini",
        parameterSchema: schema,
        providerModelId: "doubao-seedance-2-0-mini-260615",
        providerProfileId: "ark-profile",
      },
      nodeId: "video-node",
      parameters: {
        aspectRatio: "16:9",
        duration: 10,
        generateAudio: false,
        inputMode: "text",
        outputCount: 1,
        resolution: "720p",
      },
      prompt: "参数快照测试",
      providerModelId: "doubao-seedance-2-0-mini-260615",
      providerProfileId: "ark-profile",
    });
    first.close();

    const reopened = createGenerationTaskStore(directory);
    expect(reopened.get(created.task.id)).toMatchObject({
      modelConfiguration: {
        modelId: "seedance-mini",
        parameterSchema: { version: 2 },
        providerModelId: "doubao-seedance-2-0-mini-260615",
        providerProfileId: "ark-profile",
      },
      parameters: {
        duration: 10,
        generateAudio: false,
        resolution: "720p",
      },
    });
    reopened.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("creators omit empty parameter groups for every node kind", async ({
  page,
}) => {
  const providerPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (/\/api\/generation-tasks/.test(request.url()) || /openrouter|volces/i.test(request.url()))
    ) {
      providerPosts.push(request.url());
    }
  });
  const emptySchema = {
    fields: [],
    groups: [],
    referenceInputs: { audio: 0, image: 0, video: 0 },
    version: 2 as const,
  };
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generationEnabled: false,
        models: (["text", "image", "video", "audio"] as const).map((capability) => ({
          capability,
          displayName: `Empty ${capability}`,
          id: `empty-${capability}`,
          ...(capability === "image"
            ? {
                imageParameters: {
                  aspectRatios: ["auto"],
                  maxReferenceImages: 0,
                  qualities: ["auto"],
                },
              }
            : {}),
          isDefault: true,
          parameterSchema: emptySchema,
        })),
      }),
      status: 200,
    });
  });

  const cases = [
    ["node.text.creator-open", "text-creator"],
    ["node.image.prompt-ready", "image-creator"],
    ["node.video.success", "video-creator"],
  ] as const;
  for (const [canvasId, creatorId] of cases) {
    await page.request.delete(`/api/canvas/${canvasId}`);
    await page.goto(`/__fixture/${canvasId}?parameter-groups=empty`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    const creator = page.getByTestId(creatorId);
    await expect(creator).toBeVisible();
    await expect(creator).not.toContainText("暂无参数");
    await expect(creator.locator(".node-parameter-control")).toHaveCount(0);
  }

  await page.request.delete("/api/canvas/default");
  await page.goto("/?parameter-groups=empty-audio");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.getByTestId("add-node").click();
  await page.getByTestId("add-node-menu")
    .getByRole("menuitem", { exact: true, name: "音频" })
    .click();
  const audioCreator = page.getByTestId("audio-creator");
  await expect(audioCreator).toBeVisible();
  await expect(audioCreator).not.toContainText("暂无参数");
  await expect(audioCreator.locator(".node-parameter-control")).toHaveCount(0);
  expect(providerPosts).toEqual([]);
});

test("an empty admin text field keeps a real parameter trigger and IME-safe persistence", async ({
  page,
}) => {
  const providerPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (/\/api\/generation-tasks/.test(request.url()) || /openrouter|volces/i.test(request.url()))
    ) {
      providerPosts.push(request.url());
    }
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generationEnabled: false,
        models: [{
          capability: "text",
          displayName: "Custom Text",
          id: "custom-text",
          isDefault: true,
          parameterSchema: {
            fields: [{
              defaultValue: "",
              group: "main",
              key: "custom_12345678",
              label: "写作语气",
              options: [],
              placeholder: "输入写作语气",
              type: "text",
            }],
            groups: [],
            referenceInputs: { audio: 0, image: 0, video: 0 },
            version: 2,
          },
        }],
      }),
      status: 200,
    });
  });

  const canvasId = "node.text.creator-open";
  await page.request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}?custom-parameter=1`);
  const creator = page.getByTestId("text-creator");
  await expect(creator).not.toContainText("暂无参数");
  await creator.getByRole("button", { exact: true, name: "写作语气" }).click();
  const customField = page.getByRole("dialog", { name: "模型参数" })
    .getByRole("textbox", { name: "写作语气" });
  await composeTextControl(customField, ["wen", "wen he", "温和"]);
  await expect(customField).toHaveValue("温和");
  await customField.press("Meta+z");
  await expect(customField).toHaveValue("");
  await expect(customField).not.toHaveValue(/wen he/i);
  await customField.press("Meta+Shift+z");
  await expect(customField).toHaveValue("温和");
  await customField.blur();
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  const restoredCreator = page.getByTestId("text-creator");
  await expect(restoredCreator).not.toContainText("暂无参数");
  await restoredCreator.getByRole("button", { exact: true, name: "温和" }).click();
  await expect(page.getByRole("dialog", { name: "模型参数" })
    .getByRole("textbox", { name: "写作语气" }))
    .toHaveValue("温和");
  expect(providerPosts).toEqual([]);
});

test("text, image, video and audio nodes render admin-defined parameters and persist changes", async ({
  page,
}) => {
  const providerPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (/\/api\/generation-tasks/.test(request.url()) || /openrouter|volces/i.test(request.url()))
    ) {
      providerPosts.push(request.url());
    }
  });
  const schemas = {
    audio: {
      fields: [
        { defaultValue: "text", key: "inputMode", label: "输入", options: [{ label: "文本", value: "text" }], type: "select" },
        { defaultValue: "speech", key: "audioMode", label: "类型", options: [{ label: "语音", value: "speech" }], type: "select" },
        { defaultValue: "", key: "lyrics", label: "歌词", options: [], placeholder: "输入歌词", type: "textarea" },
        { defaultValue: 60, key: "duration", label: "时长", options: [{ label: "60s", value: 60 }], type: "select" },
        { defaultValue: "wav", key: "format", label: "格式", options: [{ label: "WAV", value: "wav" }], type: "select" },
        { defaultValue: 3, key: "outputCount", label: "数量", options: [{ label: "3×", value: 3 }], type: "select" },
      ],
      referenceInputs: { audio: 0, image: 0, video: 0 },
      version: 1,
    },
    image: {
      fields: [
        { defaultValue: "text", key: "inputMode", label: "输入", options: [{ label: "文本", value: "text" }], type: "select" },
        { defaultValue: "9:16", key: "aspectRatio", label: "比例", options: [{ label: "9:16", value: "9:16" }], type: "select" },
        { defaultValue: "high", key: "quality", label: "画质", options: [{ label: "高", value: "high" }], type: "select" },
        { defaultValue: 2, key: "outputCount", label: "数量", options: [{ label: "2×", value: 2 }], type: "select" },
      ],
      referenceInputs: { audio: 0, image: 4, video: 0 },
      version: 1,
    },
    text: {
      fields: [
        { defaultValue: "text", key: "inputMode", label: "输入", options: [{ label: "文本", value: "text" }], type: "select" },
        { defaultValue: "markdown", key: "responseFormat", label: "输出格式", options: [{ label: "Markdown", value: "markdown" }], type: "select" },
        { defaultValue: "creative", key: "creativity", label: "创造性", options: [{ label: "创意", value: "creative" }], type: "select" },
        { defaultValue: 2, key: "outputCount", label: "数量", options: [{ label: "2×", value: 2 }], type: "select" },
      ],
      referenceInputs: { audio: 0, image: 0, video: 0 },
      version: 1,
    },
    video: {
      fields: [
        { defaultValue: "text", key: "inputMode", label: "输入", options: [{ label: "文本", value: "text" }], type: "select" },
        { defaultValue: "16:9", key: "aspectRatio", label: "比例", options: [{ label: "16:9", value: "16:9" }], type: "select" },
        { defaultValue: "720p", key: "resolution", label: "分辨率", options: [{ label: "480p", value: "480p" }, { label: "720p", value: "720p" }], type: "select" },
        { defaultValue: 10, key: "duration", label: "时长", options: [{ label: "10s", value: 10 }], type: "select" },
        { defaultValue: false, key: "generateAudio", label: "生成音频", options: [{ label: "开启", value: true }, { label: "关闭", value: false }], type: "boolean" },
        { defaultValue: 1, key: "outputCount", label: "数量", options: [{ label: "1×", value: 1 }], type: "select" },
      ],
      referenceInputs: { audio: 0, image: 0, video: 0 },
      version: 1,
    },
  } as const;

  for (const capability of ["text", "image", "video", "audio"] as const) {
    const response = await page.request.post("/api/admin/models", {
      data: {
        capability,
        displayName: `Parameter ${capability}`,
        isDefault: true,
        parameterSchema: schemas[capability],
        providerModelId: `test/${capability}-parameters-v1`,
        sortOrder: 1,
        status: "published",
      },
    });
    expect(response.status()).toBe(201);
  }

  await page.request.delete("/api/canvas/default");
  await page.goto("/canvas");
  const addNode = async (name: "文本" | "图片" | "视频" | "音频") => {
    await page.getByTestId("add-node").click();
    await page.getByTestId("add-node-menu").getByRole("menuitem", {
      exact: true,
      name,
    }).click();
  };
  const expectLogicalPromptUndo = async (
    prompt: import("@playwright/test").Locator,
    finalValue: string,
  ) => {
    await composeTextControl(prompt, ["pin", "pin yin", finalValue]);
    await expect(prompt).toHaveValue(finalValue);
    await prompt.press("Meta+z");
    await expect(prompt).toHaveValue("");
    await expect(prompt).not.toHaveValue(/pin yin/i);
    await prompt.press("Meta+Shift+z");
    await expect(prompt).toHaveValue(finalValue);
  };

  await addNode("文本");
  await expect(page.getByTestId("text-creator")).toContainText("Markdown · 创意");
  await expect(page.getByTestId("text-creator")).toContainText("2×");
  await expectLogicalPromptUndo(
    page.getByTestId("text-creator-prompt"),
    "文字指令",
  );

  await addNode("图片");
  await expect(page.getByTestId("image-creator")).toContainText("9:16 · 高");
  await expect(page.getByTestId("image-creator")).toContainText("2×");
  await expectLogicalPromptUndo(
    page.getByTestId("image-creator-prompt"),
    "图片指令",
  );

  await addNode("视频");
  const videoCreator = page.getByTestId("video-creator");
  await expect(videoCreator).toContainText("16:9 · 720p · 10s · 关闭");
  await expectLogicalPromptUndo(
    page.getByTestId("video-creator-prompt"),
    "视频指令",
  );
  const videoParameters = videoCreator.getByRole("button", {
    name: "16:9 · 720p · 10s · 关闭",
  });
  await videoParameters.click();
  const save = page.waitForResponse((response) =>
    response.request().method() === "PUT" && /\/api\/canvas\/default$/.test(response.url()),
  );
  await page.getByRole("dialog", { name: "模型参数" })
    .getByRole("button", { name: "480p" }).click();
  await save;
  await expect(videoCreator).toContainText("16:9 · 480p · 10s · 关闭");

  await addNode("音频");
  const audioCreator = page.getByTestId("audio-creator");
  await expect(audioCreator).toContainText("语音 · 60s · WAV");
  await expect(audioCreator).toContainText("3×");
  await expectLogicalPromptUndo(
    audioCreator.getByRole("textbox", { name: "音频提示词" }),
    "音频指令",
  );
  await expect(
    audioCreator.getByRole("button", { name: "语音 · 60s · WAV" }),
  ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(
    audioCreator.getByRole("button", { name: "3×" }),
  ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(audioCreator.getByRole("button", { name: "Generate" }))
    .toHaveCSS("background-color", "rgb(245, 245, 245)");
  await audioCreator.getByRole("button", { name: "语音 · 60s · WAV" }).click();
  const lyrics = page.getByRole("dialog", { name: "模型参数" })
    .getByRole("textbox", { name: "歌词" });
  await composeTextControl(lyrics, ["ye", "ye se", "夜色"]);
  await expect(lyrics).toHaveValue("夜色");
  await lyrics.press("Meta+z");
  await expect(lyrics).toHaveValue("");
  await expect(lyrics).not.toHaveValue(/ye se/i);
  await lyrics.press("Meta+Shift+z");
  await expect(lyrics).toHaveValue("夜色");
  await lyrics.blur();
  const audioUploadToolbar = page.getByTestId("audio-empty-upload-toolbar");
  const audioCard = page.locator(".react-flow__node-audio .audio-node-card");
  const uploadBox = (await audioUploadToolbar.boundingBox())!;
  const audioCardBox = (await audioCard.boundingBox())!;
  const creatorBox = (await audioCreator.boundingBox())!;
  const uploadButton = audioUploadToolbar.getByRole("button", {
    name: "上传音频",
  });
  await expect(uploadButton).toHaveCSS("font-size", "12px");
  await expect(uploadButton).toHaveCSS("height", "32px");
  await expect(audioUploadToolbar).toHaveCSS("height", "32px");
  expect(Math.abs(
    (audioCardBox.y - (uploadBox.y + uploadBox.height)) -
    (creatorBox.y - (audioCardBox.y + audioCardBox.height)),
  )).toBeLessThan(1);

  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.locator(".react-flow__node-video").evaluate((element) =>
    element.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await expect(page.getByTestId("video-creator")).toContainText(
    "16:9 · 480p · 10s · 关闭",
  );
  expect(providerPosts).toEqual([]);
});
