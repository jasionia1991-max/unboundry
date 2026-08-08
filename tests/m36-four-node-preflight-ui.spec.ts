import { expect, test } from "./safe-test";
import {
  defaultParameterValues,
  knownModelParameterSchema,
  type ModelCapability,
} from "../types/modelParameters";

const blockedMessage = "零费用检查：管理员已关闭真实生成";

const modelInputs = {
  audio: {
    id: "preflight-audio-model",
    providerDriver: "mureka",
    providerModelId: "mureka-9",
  },
  image: {
    id: "preflight-image-model",
    providerDriver: "openrouter",
    providerModelId: "openai/gpt-image-2",
  },
  text: {
    id: "preflight-text-model",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
  },
  video: {
    id: "preflight-video-model",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
  },
} as const;

test("Text, Image, Video and Audio stop after the same non-enqueueable preflight", async ({
  page,
  request,
}) => {
  const existing = await request.get("/api/canvas/default");
  const original = existing.ok()
    ? await existing.json() as {
        edges: unknown[];
        nodes: unknown[];
        revision: number;
        viewport: { x: number; y: number; zoom: number };
      }
    : undefined;
  const schemas = Object.fromEntries(
    Object.entries(modelInputs).map(([capability, model]) => [
      capability,
      knownModelParameterSchema({
        capability: capability as ModelCapability,
        providerDriver: model.providerDriver,
        providerModelId: model.providerModelId,
      }),
    ]),
  ) as Record<ModelCapability, ReturnType<typeof knownModelParameterSchema>>;
  const preflightKinds: string[] = [];
  const taskKinds: string[] = [];
  let providerRequests = 0;

  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: (Object.entries(modelInputs) as Array<[
          ModelCapability,
          (typeof modelInputs)[ModelCapability],
        ]>).map(([capability, model]) => ({
          capability,
          displayName: `预检 ${capability}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: model.id,
          isDefault: true,
          parameterSchema: schemas[capability],
        })),
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks/preflight", async (route) => {
    const body = route.request().postDataJSON() as { kind?: string };
    preflightKinds.push(String(body.kind));
    await route.fulfill({
      contentType: "application/json",
      json: {
        canEnqueue: false,
        canSubmit: true,
        enqueueProblem: {
          code: "GLOBAL_DISABLED",
          message: blockedMessage,
        },
        problems: [],
        provider: { adapterSupported: true, configured: true },
        providerRequests: 0,
        safetyAdmission: {
          allowed: false,
          code: "GLOBAL_DISABLED",
          message: blockedMessage,
        },
      },
      status: 200,
    });
  });
  page.on("request", (entry) => {
    const url = new URL(entry.url());
    if (/(?:openrouter\.ai|volces\.com|mureka\.ai)$/i.test(url.hostname)) {
      providerRequests += 1;
    }
    if (entry.method() !== "POST" || url.pathname !== "/api/generation-tasks") return;
    taskKinds.push(String((entry.postDataJSON() as { kind?: string }).kind));
  });

  try {
    const currentRevision = original?.revision ?? 0;
    const saved = await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [
          {
            data: {
              content: "",
              label: "Text",
              textModelId: modelInputs.text.id,
              textParameters: defaultParameterValues(schemas.text),
              textPrompt: "生成一句商品描述",
              title: "文字预检",
            },
            id: "preflight-text",
            position: { x: 60, y: 80 },
            selected: true,
            style: { height: 250, width: 250 },
            type: "text",
          },
          {
            data: {
              imageModelId: modelInputs.image.id,
              imageParameters: defaultParameterValues(schemas.image),
              imagePrompt: "生成一张商品图",
              imagePromptReady: true,
              label: "Image",
              title: "图片预检",
            },
            id: "preflight-image",
            position: { x: 60, y: 500 },
            style: { height: 300, width: 300 },
            type: "image",
          },
          {
            data: {
              label: "Video",
              title: "视频预检",
              videoModelId: modelInputs.video.id,
              videoParameters: defaultParameterValues(schemas.video),
              videoPrompt: "生成一段商品视频",
              videoPromptReady: true,
            },
            id: "preflight-video",
            position: { x: 560, y: 80 },
            style: { height: 250, width: 444 },
            type: "video",
          },
          {
            data: {
              audioModelId: modelInputs.audio.id,
              audioParameters: defaultParameterValues(schemas.audio),
              audioPrompt: "生成一段商品配乐",
              audioPromptReady: true,
              label: "Audio",
              title: "音频预检",
            },
            id: "preflight-audio",
            position: { x: 560, y: 500 },
            style: { height: 250, width: 444 },
            type: "audio",
          },
        ],
        revision: currentRevision,
        viewport: { x: 20, y: 10, zoom: 0.72 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");

    const checks = [
      { creator: "text-creator", id: "preflight-text", kind: "text" },
      { creator: "image-creator", id: "preflight-image", kind: "image" },
      { creator: "video-creator", id: "preflight-video", kind: "video" },
      { creator: "audio-creator", id: "preflight-audio", kind: "audio" },
    ] as const;
    for (const [index, check] of checks.entries()) {
      await page.locator(`.react-flow__node[data-id="${check.id}"]`)
        .dispatchEvent("click");
      const creator = page.getByTestId(check.creator);
      await expect(creator).toBeVisible();
      await creator.getByRole("button", { name: "Generate" }).click();
      await expect.poll(() => preflightKinds.length).toBe(index + 1);
      expect(preflightKinds[index]).toBe(check.kind);
      if (check.kind === "text") {
        await expect(page.getByTestId("upstream-input-problem"))
          .toContainText(blockedMessage);
      } else {
        await expect(page.locator(`.react-flow__node[data-id="${check.id}"]`)
          .getByRole("alert")).toContainText(blockedMessage);
      }
    }

    expect(taskKinds).toEqual([]);
    expect(providerRequests).toBe(0);
    const persisted = await (await request.get("/api/canvas/default")).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    for (const node of persisted.nodes) {
      expect(node.data.textGenerationError).toBeUndefined();
      expect(node.data.imageGenerationError).toBeUndefined();
      expect(node.data.videoGenerationError).toBeUndefined();
      expect(node.data.audioGenerationError).toBeUndefined();
    }
    const tasks = await (await request.get(
      "/api/generation-tasks?canvasId=default",
    )).json() as { tasks: unknown[] };
    expect(tasks.tasks).toEqual([]);
  } finally {
    const latest = await request.get("/api/canvas/default");
    if (original && latest.ok()) {
      const revision = (await latest.json() as { revision: number }).revision;
      await request.put("/api/canvas/default", {
        data: { ...original, revision },
      });
    } else if (!original) {
      await request.delete("/api/canvas/default");
    }
  }
});

test("all four real-canvas creators show the same visible platform stop reason", async ({
  page,
  request,
}) => {
  const existing = await request.get("/api/canvas/default");
  const original = existing.ok()
    ? await existing.json() as {
        edges: unknown[];
        nodes: unknown[];
        revision: number;
        viewport: { x: number; y: number; zoom: number };
      }
    : undefined;
  const schemas = Object.fromEntries(
    Object.entries(modelInputs).map(([capability, model]) => [
      capability,
      knownModelParameterSchema({
        capability: capability as ModelCapability,
        providerDriver: model.providerDriver,
        providerModelId: model.providerModelId,
      }),
    ]),
  ) as Record<ModelCapability, ReturnType<typeof knownModelParameterSchema>>;
  const formalPosts: string[] = [];
  page.on("request", (entry) => {
    const url = new URL(entry.url());
    if (entry.method() === "POST" && url.pathname.startsWith("/api/generation-tasks")) {
      formalPosts.push(url.pathname);
    }
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: false,
        models: (Object.entries(modelInputs) as Array<[
          ModelCapability,
          (typeof modelInputs)[ModelCapability],
        ]>).map(([capability, model]) => ({
          capability,
          displayName: `停止 ${capability}`,
          generationAvailable: false,
          generationUnavailableReason: "管理员已关闭真实生成",
          generationUnavailableReasonCode: "GLOBAL_GENERATION_DISABLED",
          id: model.id,
          isDefault: true,
          parameterSchema: schemas[capability],
        })),
      },
      status: 200,
    });
  });

  try {
    const saved = await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [
          {
            data: {
              textModelId: modelInputs.text.id,
              textParameters: defaultParameterValues(schemas.text),
              textPrompt: "文字指令",
              title: "Text",
            },
            id: "stopped-text",
            position: { x: 40, y: 40 },
            style: { height: 250, width: 250 },
            type: "text",
          },
          {
            data: {
              imageModelId: modelInputs.image.id,
              imageParameters: defaultParameterValues(schemas.image),
              imagePrompt: "图片指令",
              imagePromptReady: true,
              title: "Image",
            },
            id: "stopped-image",
            position: { x: 380, y: 40 },
            style: { height: 300, width: 300 },
            type: "image",
          },
          {
            data: {
              title: "Video",
              videoModelId: modelInputs.video.id,
              videoParameters: defaultParameterValues(schemas.video),
              videoPrompt: "视频指令",
              videoPromptReady: true,
            },
            id: "stopped-video",
            position: { x: 40, y: 460 },
            style: { height: 250, width: 444 },
            type: "video",
          },
          {
            data: {
              audioModelId: modelInputs.audio.id,
              audioParameters: defaultParameterValues(schemas.audio),
              audioPrompt: "音频指令",
              audioPromptReady: true,
              title: "Audio",
            },
            id: "stopped-audio",
            position: { x: 580, y: 460 },
            style: { height: 250, width: 444 },
            type: "audio",
          },
        ],
        revision: original?.revision ?? 0,
        viewport: { x: 20, y: 10, zoom: 0.72 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");

    for (const kind of ["text", "image", "video", "audio"] as const) {
      await page.locator(`.react-flow__node[data-id="stopped-${kind}"]`)
        .dispatchEvent("click");
      await expect(page.getByTestId(`${kind}-generation-unavailable`))
        .toHaveText("当前无法生成：管理员已关闭真实生成");
      await expect(page.getByTestId(`${kind}-creator`)
        .getByRole("button", { name: "Generate" })).toBeDisabled();
    }
    expect(formalPosts).toEqual([]);
  } finally {
    const latest = await request.get("/api/canvas/default");
    if (original && latest.ok()) {
      const revision = (await latest.json() as { revision: number }).revision;
      await request.put("/api/canvas/default", {
        data: { ...original, revision },
      });
    } else if (!original) {
      await request.delete("/api/canvas/default");
    }
  }
});
