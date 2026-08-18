import { expect, test } from "./safe-test";
import {
  pollRelayMediaTask,
  relayGptImageRequestTimeoutMs,
  relayMediaCancellationBoundary,
  relayProviderSafeSnapshot,
  requestRelayGptImage,
  requestRelayText,
  routeRelayProviderRequest,
  submitRelayMedia,
  type RelayGptImageRequest,
  type RelayMediaGenerateRequest,
  type RelayProviderRequest,
  type RelayTextProviderProtocol,
} from "../server/relayProviderAdapters";

const connection = {
  apiKey: "fixture-secret-key-never-persist",
  baseUrl: "https://api.example.test/v1",
};
const pngFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

type TextFixture = {
  body: Record<string, unknown>;
  expectedBody: Record<string, unknown>;
  expectedPath: string;
  expectedText: string;
  protocol: RelayTextProviderProtocol;
};

const textFixtures: TextFixture[] = [
  {
    body: {
      choices: [{ message: { content: "OpenAI chat result" } }],
      usage: { completion_tokens: 7, prompt_tokens: 5, total_tokens: 12 },
    },
    expectedBody: {
      max_tokens: 64,
      messages: [
        { content: "System fixture", role: "system" },
        { content: "Hello", role: "user" },
        { content: "Earlier answer", role: "assistant" },
      ],
      model: "fixture/model-v1",
      temperature: 0,
    },
    expectedPath: "/v1/chat/completions",
    expectedText: "OpenAI chat result",
    protocol: "openai-chat",
  },
  {
    body: {
      output: [{ content: [{ text: "Responses result", type: "output_text" }] }],
      usage: { input_tokens: 6, output_tokens: 8, total_tokens: 14 },
    },
    expectedBody: {
      input: [
        { content: "Hello", role: "user" },
        { content: "Earlier answer", role: "assistant" },
      ],
      instructions: "System fixture",
      max_output_tokens: 64,
      model: "fixture/model-v1",
      temperature: 0,
    },
    expectedPath: "/v1/responses",
    expectedText: "Responses result",
    protocol: "openai-responses",
  },
  {
    body: {
      content: [{ text: "Claude result", type: "text" }],
      usage: { input_tokens: 9, output_tokens: 11 },
    },
    expectedBody: {
      max_tokens: 64,
      messages: [
        { content: "Hello", role: "user" },
        { content: "Earlier answer", role: "assistant" },
      ],
      model: "fixture/model-v1",
      system: "System fixture",
      temperature: 0,
    },
    expectedPath: "/v1/messages",
    expectedText: "Claude result",
    protocol: "claude-messages",
  },
  {
    body: {
      candidates: [{ content: { parts: [{ text: "Gemini result" }] } }],
      usageMetadata: {
        candidatesTokenCount: 13,
        promptTokenCount: 12,
        totalTokenCount: 25,
      },
    },
    expectedBody: {
      contents: [
        { parts: [{ text: "Hello" }], role: "user" },
        { parts: [{ text: "Earlier answer" }], role: "model" },
      ],
      generationConfig: { maxOutputTokens: 64, temperature: 0 },
      systemInstruction: { parts: [{ text: "System fixture" }] },
    },
    expectedPath: "/v1beta/models/fixture%2Fmodel-v1:generateContent",
    expectedText: "Gemini result",
    protocol: "gemini-generate-content",
  },
];

for (const fixture of textFixtures) {
  test(`${fixture.protocol} maps one neutral text request without real network`, async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const result = await requestRelayText(connection, {
      capability: "text",
      instructions: " System fixture ",
      maxOutputTokens: 64,
      messages: [
        { role: "user", text: " Hello " },
        { role: "assistant", text: " Earlier answer " },
      ],
      model: "fixture/model-v1",
      providerProtocol: fixture.protocol,
      temperature: 0,
    }, {
      fetcher: async (input, init) => {
        calls.push({ init, url: String(input) });
        return jsonResponse(fixture.body);
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.example.test${fixture.expectedPath}`);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.redirect).toBe("error");
    expect(new Headers(calls[0].init?.headers).get("Authorization"))
      .toBe(`Bearer ${connection.apiKey}`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(fixture.expectedBody);
    expect(result).toMatchObject({
      capability: "text",
      providerProtocol: fixture.protocol,
      state: "success",
      text: fixture.expectedText,
    });
    expect(result.usage?.totalTokens).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(connection.apiKey);
  });
}

test("OpenAI Responses preserves ordered text, image and inline-audio context", async () => {
  let captured: Record<string, unknown> | undefined;
  const imageUrl = "https://signed.example.test/context.png?signature=short";
  const audioData = Buffer.from("fixture-audio", "utf8").toString("base64");
  const request = {
    capability: "text" as const,
    contextInputs: [
      { kind: "text" as const, text: "Context text first" },
      { kind: "image" as const, mimeType: "image/png", transientUrl: imageUrl },
      {
        kind: "audio" as const,
        mimeType: "audio/mpeg",
        transientUrl: `data:audio/mpeg;base64,${audioData}`,
      },
    ],
    messages: [{ role: "user" as const, text: "Final instruction" }],
    model: "fixture-model",
    providerProtocol: "openai-responses" as const,
  };
  const result = await requestRelayText(connection, request, {
    fetcher: async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ output_text: "done" });
    },
  });

  expect(captured).toEqual({
    input: [{
      content: [
        { text: "Context text first", type: "input_text" },
        { image_url: imageUrl, type: "input_image" },
        {
          input_audio: { data: audioData, format: "mp3" },
          type: "input_audio",
        },
        { text: "Final instruction", type: "input_text" },
      ],
      role: "user",
    }],
    model: "fixture-model",
  });
  expect(result.text).toBe("done");
  const safe = relayProviderSafeSnapshot(request);
  expect(safe).toMatchObject({
    contextInputCount: 3,
    contextInputKinds: ["text", "image", "audio"],
  });
  expect(JSON.stringify(safe)).not.toMatch(/signed|signature|base64|fixture-audio/i);
});

test("text adapters reject plain, URL-encoded and Unicode-escaped API Key reflection", async () => {
  const percentEncoded = [...Buffer.from(connection.apiKey)]
    .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
    .join("");
  const unicodeEscaped = [...connection.apiKey]
    .map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .join("");
  const fixtures = [
    {
      body: { choices: [{ message: { content: `plain:${connection.apiKey}` } }] },
      protocol: "openai-chat" as const,
    },
    {
      body: { output_text: `encoded:${percentEncoded}` },
      protocol: "openai-responses" as const,
    },
    {
      body: { content: [{ text: `escaped:${unicodeEscaped}`, type: "text" }] },
      protocol: "claude-messages" as const,
    },
    {
      body: {
        candidates: [{ content: { parts: [{ text: `double:${encodeURIComponent(percentEncoded)}` }] } }],
      },
      protocol: "gemini-generate-content" as const,
    },
  ];
  for (const fixture of fixtures) {
    const error = await requestRelayText(connection, {
      capability: "text",
      messages: [{ role: "user", text: "safe fixture" }],
      model: "fixture-model",
      providerProtocol: fixture.protocol,
    }, {
      fetcher: async () => jsonResponse(fixture.body),
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "FORMAT" });
    expect(String(error)).not.toContain(connection.apiKey);
    expect(String(error)).not.toMatch(/plain:|encoded:|escaped:|double:/);
  }
});

test("OpenAI Chat and Claude map image context without widening media support", async () => {
  const imageUrl = "https://signed.example.test/context.png?signature=short";
  const calls: Array<Record<string, unknown>> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return calls.length === 1
      ? jsonResponse({ choices: [{ message: { content: "chat" } }] })
      : jsonResponse({ content: [{ text: "claude", type: "text" }] });
  };

  await requestRelayText(connection, {
    capability: "text",
    contextInputs: [{ kind: "image", mimeType: "image/png", transientUrl: imageUrl }],
    messages: [{ role: "user", text: "Describe it" }],
    model: "chat-model",
    providerProtocol: "openai-chat",
  }, { fetcher });
  await requestRelayText(connection, {
    capability: "text",
    contextInputs: [{
      kind: "image",
      mimeType: "image/png",
      transientUrl: "data:image/png;base64,ZmFrZQ==",
    }],
    messages: [{ role: "user", text: "Describe it" }],
    model: "claude-model",
    providerProtocol: "claude-messages",
  }, { fetcher });

  expect(calls[0]).toMatchObject({
    messages: [{
      content: [
        { image_url: { url: imageUrl }, type: "image_url" },
        { text: "Describe it", type: "text" },
      ],
      role: "user",
    }],
  });
  expect(calls[1]).toMatchObject({
    messages: [{
      content: [
        {
          source: {
            data: "ZmFrZQ==",
            media_type: "image/png",
            type: "base64",
          },
          type: "image",
        },
        { text: "Describe it", type: "text" },
      ],
      role: "user",
    }],
  });
});

test("Gemini maps all four ordered upstream kinds to text, inlineData and fileData", async () => {
  let captured: Record<string, unknown> | undefined;
  await requestRelayText(connection, {
    capability: "text",
    contextInputs: [
      { kind: "text", text: "Text context" },
      {
        kind: "image",
        mimeType: "image/png",
        transientUrl: "data:image/png;base64,ZmFrZQ==",
      },
      {
        kind: "video",
        mimeType: "video/mp4",
        transientUrl: "https://signed.example.test/context.mp4?signature=short",
      },
      {
        kind: "audio",
        mimeType: "audio/wav",
        transientUrl: "https://signed.example.test/context.wav?signature=short",
      },
    ],
    messages: [{ role: "user", text: "Final instruction" }],
    model: "gemini-model",
    providerProtocol: "gemini-generate-content",
  }, {
    fetcher: async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: "gemini" }] } }],
      });
    },
  });

  expect(captured).toEqual({
    contents: [{
      parts: [
        { text: "Text context" },
        { inlineData: { data: "ZmFrZQ==", mimeType: "image/png" } },
        {
          fileData: {
            fileUri: "https://signed.example.test/context.mp4?signature=short",
            mimeType: "video/mp4",
          },
        },
        {
          fileData: {
            fileUri: "https://signed.example.test/context.wav?signature=short",
            mimeType: "audio/wav",
          },
        },
        { text: "Final instruction" },
      ],
      role: "user",
    }],
  });
});

test("protocol media-input gaps reject explicitly before any Provider request", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    throw new Error("must not run");
  };
  const unsupported = [
    {
      input: { kind: "audio", mimeType: "audio/wav", transientUrl: "data:audio/wav;base64,ZmFrZQ==" },
      protocol: "openai-chat",
    },
    {
      input: { kind: "video", mimeType: "video/mp4", transientUrl: "https://example.test/a.mp4" },
      protocol: "openai-chat",
    },
    {
      input: { kind: "audio", mimeType: "audio/wav", transientUrl: "data:audio/wav;base64,ZmFrZQ==" },
      protocol: "claude-messages",
    },
    {
      input: { kind: "video", mimeType: "video/mp4", transientUrl: "https://example.test/a.mp4" },
      protocol: "claude-messages",
    },
    {
      input: { kind: "video", mimeType: "video/mp4", transientUrl: "https://example.test/a.mp4" },
      protocol: "openai-responses",
    },
    {
      input: { kind: "audio", mimeType: "audio/wav", transientUrl: "https://example.test/a.wav" },
      protocol: "openai-responses",
    },
  ] as const;
  for (const fixture of unsupported) {
    await expect(requestRelayText(connection, {
      capability: "text",
      contextInputs: [fixture.input],
      messages: [{ role: "user", text: "fixture" }],
      model: "fixture-model",
      providerProtocol: fixture.protocol,
    }, { fetcher })).rejects.toMatchObject({ code: "FORMAT" });
  }
  expect(calls).toBe(0);
});

test("GPT Image generation and edits use their dedicated endpoints", async () => {
  expect(relayGptImageRequestTimeoutMs).toBe(180_000);
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const fixtures = [
    jsonResponse({
      data: [{
        b64_json: pngFixture.toString("base64"),
        media_type: "image/png",
      }],
    }),
    jsonResponse({
      data: [{ url: "https://signed.example.test/output.png?signature=short" }],
    }),
  ];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ init, url: String(input) });
    return fixtures.shift()!;
  };

  const generated = await requestRelayGptImage(connection, {
    capability: "image",
    count: 1,
    model: "gpt-image-2",
    operation: "generation",
    prompt: "A clean product photo",
    providerProtocol: "gpt-image",
    quality: "high",
    responseFormat: "b64_json",
    size: "1024x1024",
  }, { fetcher });
  const editedRequest: RelayGptImageRequest = {
    capability: "image",
    inputImages: ["https://signed.example.test/input.png?signature=short"],
    model: "gpt-image-2",
    operation: "edit",
    prompt: "Keep the garment and replace the background",
    providerProtocol: "gpt-image",
    responseFormat: "url",
  };
  const edited = await routeRelayProviderRequest(
    connection,
    editedRequest,
    { fetcher },
  );

  expect(calls.map((call) => call.url)).toEqual([
    "https://api.example.test/v1/images/generations",
    "https://api.example.test/v1/images/edits",
  ]);
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({
    model: "gpt-image-2",
    n: 1,
    output_format: "png",
    prompt: "A clean product photo",
    quality: "high",
    response_format: "b64_json",
    size: "1024x1024",
  });
  expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({
    image: "https://signed.example.test/input.png?signature=short",
    model: "gpt-image-2",
    prompt: "Keep the garment and replace the background",
  });
  expect(generated.outputs[0]).toMatchObject({
    kind: "image",
    mimeType: "image/png",
    transport: "bytes",
  });
  expect(Buffer.from(
    "bytes" in generated.outputs[0] ? generated.outputs[0].bytes : [],
  )).toEqual(pngFixture);
  expect(edited).toMatchObject({
    outputs: [{ kind: "image", transport: "transient-url" }],
    state: "success",
  });
  const safe = relayProviderSafeSnapshot(edited);
  expect(safe).toEqual({
    capability: "image",
    outputCount: 1,
    providerProtocol: "gpt-image",
    state: "success",
  });
  expect(JSON.stringify(safe)).not.toContain("signed.example.test");
});

test("GPT Image requests PNG and rejects JPEG or WebP output bytes", async () => {
  const request: RelayGptImageRequest = {
    capability: "image",
    model: "gpt-image-2",
    operation: "generation",
    prompt: "PNG only",
    providerProtocol: "gpt-image",
    responseFormat: "b64_json",
  };
  let calls = 0;
  for (const fixture of [
    {
      b64_json: Buffer.from([0xff, 0xd8, 0xff, 0xdb]).toString("base64"),
      media_type: "image/jpeg",
    },
    {
      b64_json: Buffer.from("RIFF0000WEBP", "ascii").toString("base64"),
      media_type: "image/webp",
    },
    {
      b64_json: Buffer.from([0xff, 0xd8, 0xff, 0xdb]).toString("base64"),
    },
  ]) {
    await expect(requestRelayGptImage(connection, request, {
      fetcher: async (_input, init) => {
        calls += 1;
        expect(JSON.parse(String(init?.body))).toMatchObject({ output_format: "png" });
        return jsonResponse({ data: [fixture] });
      },
    })).rejects.toMatchObject({ code: "PROVIDER_RESULT_FORMAT" });
  }
  expect(calls).toBe(3);
});

test("GPT Image distinguishes preflight, Provider request and result failures", async () => {
  const validRequest: RelayGptImageRequest = {
    capability: "image",
    model: "gpt-image-2",
    operation: "generation",
    prompt: "stage classification",
    providerProtocol: "gpt-image",
    responseFormat: "b64_json",
  };
  let boundaries = 0;
  await expect(requestRelayGptImage(connection, {
    ...validRequest,
    count: 11,
  }, {
    beforeProviderRequest: () => {
      boundaries += 1;
    },
    fetcher: async () => {
      throw new Error("must not reach Provider");
    },
  })).rejects.toMatchObject({ code: "FORMAT" });
  expect(boundaries).toBe(0);

  await expect(requestRelayGptImage(connection, validRequest, {
    beforeProviderRequest: () => {
      boundaries += 1;
    },
    fetcher: async () => {
      throw new Error("deterministic Provider request failure");
    },
  })).rejects.toMatchObject({
    code: "NETWORK",
    providerTaskMayStillRun: false,
  });
  expect(boundaries).toBe(1);

  await expect(requestRelayGptImage(connection, validRequest, {
    beforeProviderRequest: () => {
      boundaries += 1;
    },
    fetcher: async () => jsonResponse({ error: { message: "invalid key" } }, 401),
  })).rejects.toMatchObject({
    code: "AUTH",
    providerTaskMayStillRun: false,
  });
  expect(boundaries).toBe(2);

  await expect(requestRelayGptImage(connection, validRequest, {
    beforeProviderRequest: () => {
      boundaries += 1;
    },
    fetcher: async () => jsonResponse({ error: { message: "bad image" } }, 400),
  })).rejects.toMatchObject({
    code: "REMOTE",
    providerTaskMayStillRun: false,
  });
  expect(boundaries).toBe(3);

  await expect(requestRelayGptImage(connection, validRequest, {
    beforeProviderRequest: () => {
      boundaries += 1;
    },
    fetcher: async () => jsonResponse({ error: { message: "upstream 502" } }, 502),
  })).rejects.toMatchObject({
    code: "REMOTE",
    providerTaskMayStillRun: false,
  });
  expect(boundaries).toBe(4);

  await expect(requestRelayGptImage(connection, validRequest, {
    beforeProviderRequest: () => {
      boundaries += 1;
    },
    fetcher: async () => jsonResponse({ data: [{ unexpected: true }] }),
  })).rejects.toMatchObject({
    code: "PROVIDER_RESULT_FORMAT",
    providerTaskMayStillRun: true,
  });
  expect(boundaries).toBe(5);
});

test("generic media submission accepts image, video and audio fixtures only", async () => {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const responses = [
    jsonResponse({ task_id: 101 }),
    jsonResponse({ data: { task_id: "video_task_202" } }),
    jsonResponse({
      code: 200,
      data: [{ task_id: "audio_a" }],
    }),
  ];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ init, url: String(input) });
    return responses.shift()!;
  };
  const requests: RelayMediaGenerateRequest[] = [
    {
      capability: "image",
      model: "relay-image",
      params: { images: ["https://signed.example.test/reference.png"] },
      prompt: "Image fixture",
      providerProtocol: "media-generate",
    },
    {
      capability: "video",
      model: "relay-video",
      params: { duration: "6", images: ["https://signed.example.test/frame.png"] },
      prompt: "Video fixture",
      providerProtocol: "media-generate",
    },
    {
      capability: "audio",
      model: "relay-audio",
      params: { instrumental: true, sample_rate: 44_100 },
      prompt: "Audio fixture",
      providerProtocol: "media-generate",
    },
  ];
  const results = [];
  for (const request of requests) {
    results.push(await submitRelayMedia(connection, request, { fetcher }));
  }

  expect(calls).toHaveLength(3);
  expect(calls.every((call) =>
    call.url === "https://api.example.test/v1/media/generate"
  )).toBe(true);
  expect(calls.map((call) => JSON.parse(String(call.init?.body))))
    .toEqual(requests.map(({ model, params, prompt }) => ({ model, params, prompt })));
  expect(calls.map((call) => String(call.init?.body)).join("\n"))
    .not.toMatch(/notify_url|api.?key|authorization/i);
  expect(results.map((result) => result.externalTaskIds)).toEqual([
    ["101"],
    ["video_task_202"],
    ["audio_a"],
  ]);
});

test("Doubao TTS accepts documented params and rejects unsafe or unknown fields before fetch", async () => {
  const bodies: Record<string, unknown>[] = [];
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return jsonResponse({ task_id: "doubao_tts_fixture_001" });
  };
  const validParams = {
    emotion: "happy",
    emotion_scale: 4,
    format: "mp3",
    speaker: "zh_female_vv_uranus_bigtts",
    speech_rate: "0",
  };

  await expect(submitRelayMedia(connection, {
    capability: "audio",
    model: "doubao-tts-2.0",
    params: validParams,
    prompt: "Read the fixture sentence",
    providerProtocol: "media-generate",
  }, { fetcher })).resolves.toMatchObject({
    externalTaskId: "doubao_tts_fixture_001",
    state: "queued",
  });
  expect(bodies).toEqual([{
    model: "doubao-tts-2.0",
    params: validParams,
    prompt: "Read the fixture sentence",
  }]);

  const rejectedParams: RelayMediaGenerateRequest["params"][] = [
    { undocumented_parameter: "must-not-pass" },
    { notify_url: "https://callback.example.test/result" },
  ];
  for (const params of rejectedParams) {
    await expect(submitRelayMedia(connection, {
      capability: "audio",
      model: "doubao-tts-2.0",
      params,
      prompt: "fixture",
      providerProtocol: "media-generate",
    }, { fetcher })).rejects.toMatchObject({ code: "FORMAT" });
  }
  expect(calls).toBe(1);
});

test("generic media rejects multiple remote task IDs after one POST", async () => {
  let calls = 0;
  const error = await submitRelayMedia(connection, {
    capability: "audio",
    model: "relay-audio",
    params: { instrumental: true },
    prompt: "one local task must map to one remote task",
    providerProtocol: "media-generate",
  }, {
    fetcher: async () => {
      calls += 1;
      return jsonResponse({
        data: [{ task_id: "audio_a" }, { task_id: "audio_b" }],
      });
    },
  }).catch((caught: unknown) => caught);
  expect(error).toMatchObject({
    code: "FORMAT",
    providerTaskMayStillRun: true,
  });
  expect(String(error)).not.toMatch(/audio_a|audio_b/);
  expect(calls).toBe(1);
});

test("media polling maps stable states and treats every result URL as transient", async () => {
  const calls: string[] = [];
  const responses = [
    jsonResponse({ is_final: false, progress: "0%", state: "pending" }),
    jsonResponse({ is_final: false, progress: "45%", state: "running" }),
    jsonResponse({
      cost: 1.25,
      is_final: true,
      result_type: "video",
      result_url: "https://signed.example.test/result.mp4?signature=short",
      state: "success",
    }),
    jsonResponse({
      error: `unsafe upstream detail ${connection.apiKey}`,
      is_final: true,
      state: "failed",
    }),
  ];
  const fetcher: typeof fetch = async (input) => {
    calls.push(String(input));
    return responses.shift()!;
  };
  const poll = () => pollRelayMediaTask(connection, {
    capability: "video",
    externalTaskId: "task_123",
    providerProtocol: "media-generate",
  }, { fetcher });

  await expect(poll()).resolves.toEqual({
    capability: "video",
    progress: 0,
    providerProtocol: "media-generate",
    state: "queued",
  });
  await expect(poll()).resolves.toEqual({
    capability: "video",
    progress: 45,
    providerProtocol: "media-generate",
    state: "running",
  });
  const success = await poll();
  expect(success).toMatchObject({
    capability: "video",
    outputs: [{ kind: "video", transport: "transient-url" }],
    providerCostUnits: 1.25,
    state: "success",
  });
  const failed = await poll();
  expect(failed).toMatchObject({ code: "REMOTE", state: "failed" });
  expect(JSON.stringify(failed)).not.toContain(connection.apiKey);
  expect(calls).toEqual(Array.from({ length: 4 }, () =>
    "https://api.example.test/v1/skills/task-status?task_id=task_123"
  ));
  expect(JSON.stringify(relayProviderSafeSnapshot(success)))
    .not.toContain("signed.example.test");
});

test("media polling deduplicates one provider result repeated across response aliases", async () => {
  const signedUrl = "https://signed.example.test/result.png?signature=short";
  const result = await pollRelayMediaTask(connection, {
    capability: "image",
    externalTaskId: "task_duplicate_aliases",
    providerProtocol: "media-generate",
  }, {
    fetcher: async () => jsonResponse({
      cost: 0.1485,
      is_final: true,
      outputs: [{ result_url: signedUrl }, { url: signedUrl }],
      result_url: signedUrl,
      result_urls: [signedUrl],
      state: "success",
    }),
  });

  expect(result).toMatchObject({
    capability: "image",
    outputs: [{ kind: "image", transport: "transient-url" }],
    providerCostUnits: 0.1485,
    state: "success",
  });
  if (result.state !== "success") throw new Error("expected success result");
  expect(result.outputs).toHaveLength(1);
});

test("unknown task states and mismatched media results fail closed", async () => {
  let calls = 0;
  const inspect = (body: unknown) => pollRelayMediaTask(connection, {
    capability: "audio",
    externalTaskId: "task-safe",
    providerProtocol: "media-generate",
  }, {
    fetcher: async () => {
      calls += 1;
      return jsonResponse(body);
    },
  });
  await expect(inspect({ is_final: false, state: "mystery" }))
    .rejects.toMatchObject({ code: "FORMAT" });
  await expect(inspect({
    is_final: true,
    result_type: "video",
    result_url: "https://example.test/result.mp4",
    state: "success",
  })).rejects.toMatchObject({ code: "FORMAT" });
  expect(calls).toBe(2);
});

test("HTTP failures are classified without exposing keys or upstream bodies", async () => {
  const cases = [
    { code: "AUTH", status: 401 },
    { code: "PERMISSION", status: 403 },
    { code: "RATE_LIMIT", status: 429 },
    { code: "REMOTE", status: 500 },
  ] as const;
  for (const fixture of cases) {
    let calls = 0;
    const promise = requestRelayText(connection, {
      capability: "text",
      messages: [{ role: "user", text: "hello" }],
      model: "fixture-model",
      providerProtocol: "openai-chat",
    }, {
      fetcher: async () => {
        calls += 1;
        return jsonResponse({
          error: `unsafe remote body ${connection.apiKey}`,
        }, fixture.status);
      },
    });
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: fixture.code });
    expect(String(error)).not.toContain(connection.apiKey);
    expect(String(error)).not.toContain("unsafe remote body");
    expect(calls).toBe(1);
  }
});

test("local abort stops polling but does not claim to cancel the Provider task", async () => {
  const controller = new AbortController();
  let calls = 0;
  const promise = pollRelayMediaTask(connection, {
    capability: "image",
    externalTaskId: "still_running_123",
    providerProtocol: "media-generate",
  }, {
    fetcher: async (_input, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    },
    signal: controller.signal,
  });
  controller.abort();

  await expect(promise).rejects.toMatchObject({
    code: "CANCELLED",
    providerTaskMayStillRun: true,
  });
  expect(calls).toBe(0);
  expect(relayMediaCancellationBoundary).toEqual({
    localAbortBehavior: "stop-local-request-and-polling-only",
    providerTaskMayStillRun: true,
    supportsProviderCancel: false,
  });
});

test("safe snapshots omit prompts, media values, signed URLs, bytes and keys", async () => {
  const request: RelayMediaGenerateRequest = {
    capability: "image",
    model: "fixture-image",
    params: {
      images: ["https://signed.example.test/input.png?signature=short"],
      quality: "high",
    },
    prompt: `Do not persist ${connection.apiKey}`,
    providerProtocol: "media-generate",
  };
  const snapshot = relayProviderSafeSnapshot(request);
  expect(snapshot).toEqual({
    capability: "image",
    model: "fixture-image",
    parameterNames: ["images", "quality"],
    promptLength: request.prompt.length,
    providerProtocol: "media-generate",
  });
  expect(JSON.stringify(snapshot)).not.toMatch(/signed|signature|secret-key|https?:/i);
});

test("capability mismatch and unknown, nested or secret-shaped params are rejected before fetch", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    throw new Error("must not run");
  };
  const mismatched = {
    capability: "image",
    messages: [{ role: "user", text: "hello" }],
    model: "fixture-model",
    providerProtocol: "openai-chat",
  } as unknown as RelayProviderRequest;
  await expect(routeRelayProviderRequest(connection, mismatched, { fetcher }))
    .rejects.toMatchObject({ code: "FORMAT" });
  await expect(submitRelayMedia(connection, {
    capability: "audio",
    model: "fixture-audio",
    params: { api_key: "must-not-pass" },
    prompt: "fixture",
    providerProtocol: "media-generate",
  }, { fetcher })).rejects.toMatchObject({ code: "FORMAT" });
  await expect(submitRelayMedia(connection, {
    capability: "video",
    model: "fixture-video",
    params: { undocumented_parameter: "must-not-pass" },
    prompt: "fixture",
    providerProtocol: "media-generate",
  }, { fetcher })).rejects.toMatchObject({ code: "FORMAT" });
  await expect(submitRelayMedia(connection, {
    capability: "image",
    model: "fixture-image",
    params: { custom_12345678: "pending-provider-mapping" },
    prompt: "fixture",
    providerProtocol: "media-generate",
  }, { fetcher })).rejects.toMatchObject({ code: "FORMAT" });
  await expect(submitRelayMedia(connection, {
    capability: "video",
    model: "fixture-video",
    params: { duration: { seconds: 6 } } as unknown as RelayMediaGenerateRequest["params"],
    prompt: "fixture",
    providerProtocol: "media-generate",
  }, { fetcher })).rejects.toMatchObject({ code: "FORMAT" });
  expect(calls).toBe(0);
});

test("relay generation blocks DNS resolution to private networks before Provider boundary", async () => {
  let fetchCalls = 0;
  let providerBoundaries = 0;
  await expect(requestRelayText(
    { ...connection, baseUrl: "https://relay-public.invalid/v1" },
    {
      capability: "text",
      messages: [{ role: "user", text: "hello" }],
      model: "fixture-model",
      providerProtocol: "openai-chat",
    },
    {
      beforeProviderRequest: () => { providerBoundaries += 1; },
      fetcher: async () => {
        fetchCalls += 1;
        return jsonResponse({});
      },
      resolver: async () => [{ address: "127.0.0.1", family: 4 }],
    },
  )).rejects.toMatchObject({ code: "FORMAT" });
  expect(providerBoundaries).toBe(0);
  expect(fetchCalls).toBe(0);
});
