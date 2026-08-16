import { expect, test } from "./safe-test";
import {
  generateOpenRouterImage,
  OpenRouterImageError,
} from "../server/openRouterImageProvider";
import type { ProviderProfile } from "../server/providerProfiles";

const profile: ProviderProfile = {
  apiKey: "test-secret-key",
  baseUrl: "https://openrouter.ai/api/v1",
  createdAt: "2026-07-31T00:00:00.000Z",
  driver: "openrouter",
  id: "provider-test",
  label: "OpenRouter Test",
  updatedAt: "2026-07-31T00:00:00.000Z",
};

test("OpenRouter image adapter makes exactly one bounded request and reads cost", async () => {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ init, url: String(input) });
    return new Response(
      JSON.stringify({
        data: [
          {
            b64_json: Buffer.from("not-real-image", "utf8").toString("base64"),
            media_type: "image/png",
          },
        ],
        usage: { cost: 0.03125 },
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  };

  const result = await generateOpenRouterImage(
    profile,
    {
      aspectRatio: "16:9",
      model: "openai/gpt-image-2",
      prompt: "A quiet gray studio",
      quality: "medium",
    },
    fetcher,
  );

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://openrouter.ai/api/v1/images");
  expect(calls[0].init?.method).toBe("POST");
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({
    aspect_ratio: "16:9",
    model: "openai/gpt-image-2",
    n: 1,
    output_format: "png",
    prompt: "A quiet gray studio",
    quality: "medium",
  });
  expect(result.actualCostMicrounits).toBe(31_250);
  expect(result.bytes.toString("utf8")).toBe("not-real-image");
});

test("OpenRouter image adapter rejects a response without auditable cost", async () => {
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            b64_json: Buffer.from("image", "utf8").toString("base64"),
            media_type: "image/png",
          },
        ],
      }),
      { status: 200 },
    );

  await expect(
    generateOpenRouterImage(
      profile,
      { model: "openai/gpt-image-2", prompt: "test" },
      fetcher,
    ),
  ).rejects.toMatchObject({ code: "FORMAT" } satisfies Partial<OpenRouterImageError>);
});

test("OpenRouter image adapter serializes reference images without a real request", async () => {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ init, url: String(input) });
    return new Response(
      JSON.stringify({
        data: [
          {
            b64_json: Buffer.from("fake-image", "utf8").toString("base64"),
            media_type: "image/png",
          },
        ],
        usage: { cost: 0.01 },
      }),
      { status: 200 },
    );
  };

  await generateOpenRouterImage(
    profile,
    {
      inputReferences: [
        "https://example.com/reference.png",
        "data:image/png;base64,ZmFrZQ==",
      ],
      model: "openai/gpt-image-2",
      prompt: "Keep the character and change the background",
    },
    fetcher,
  );

  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
    input_references: [
      {
        image_url: { url: "https://example.com/reference.png" },
        type: "image_url",
      },
      {
        image_url: { url: "data:image/png;base64,ZmFrZQ==" },
        type: "image_url",
      },
    ],
  });
});

test("OpenRouter image adapter rejects invalid references before fetch", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    throw new Error("fetch must not run");
  };

  await expect(
    generateOpenRouterImage(
      profile,
      {
        inputReferences: ["file:///private/reference.png"],
        model: "openai/gpt-image-2",
        prompt: "test",
      },
      fetcher,
    ),
  ).rejects.toMatchObject({ code: "FORMAT" } satisfies Partial<OpenRouterImageError>);
  expect(calls).toBe(0);

  await expect(
    generateOpenRouterImage(
      profile,
      {
        inputReferences: Array.from(
          { length: 17 },
          (_, index) => `https://example.com/${index}.png`,
        ),
        model: "openai/gpt-image-2",
        prompt: "test",
      },
      fetcher,
    ),
  ).rejects.toMatchObject({ code: "FORMAT" } satisfies Partial<OpenRouterImageError>);
  expect(calls).toBe(0);
});

test("OpenRouter image adapter aborts one in-flight request when cancelled", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const pending = generateOpenRouterImage(
    profile,
    { model: "openai/gpt-image-2", prompt: "cancel test" },
    fetcher,
    controller.signal,
  );
  controller.abort();

  await expect(pending).rejects.toMatchObject({
    code: "CANCELLED",
  } satisfies Partial<OpenRouterImageError>);
  expect(calls).toBe(1);
});

test("OpenRouter image adapter reports a bounded timeout", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };

  await expect(
    generateOpenRouterImage(
      profile,
      { model: "openai/gpt-image-2", prompt: "timeout test" },
      fetcher,
      undefined,
      10,
    ),
  ).rejects.toMatchObject({
    code: "TIMEOUT",
  } satisfies Partial<OpenRouterImageError>);
  expect(calls).toBe(1);
});
