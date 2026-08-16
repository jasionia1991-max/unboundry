import { expect, test, type Page } from "./safe-test";
import { createHash } from "node:crypto";
import { request as createHttpRequest } from "node:http";
import path from "node:path";
import { safeTestEnvironment } from "./test-environment";

const canvasId = "interaction.upload-image";
const firstImage = path.resolve(
  "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
);
const secondImage = path.resolve(
  "spec/reference/upstream-v2.12.2-dense/01-neutral-1280x720.png",
);
const replacementImage = path.resolve(
  "spec/reference/upstream-v2.12.2-dense/03-search-1280x720.png",
);

function postDeclaredOversizedImage(pathname: string) {
  const { port } = safeTestEnvironment();
  return new Promise<{
    body: string;
    closed: boolean;
    connection: string | undefined;
    status: number;
  }>((resolve, reject) => {
    let body = "";
    let responseEnded = false;
    let requestClosed = false;
    let status = 0;
    let connection: string | undefined;
    const complete = () => {
      if (!responseEnded || !requestClosed) return;
      resolve({ body, closed: requestClosed, connection, status });
    };
    const client = createHttpRequest({
      agent: false,
      headers: {
        "Content-Length": String(20 * 1024 * 1024 + 1),
        "Content-Type": "image/png",
      },
      host: "127.0.0.1",
      method: "POST",
      path: pathname,
      port,
    }, (response) => {
      status = response.statusCode ?? 0;
      connection = response.headers.connection;
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        responseEnded = true;
        complete();
      });
    });
    client.on("close", () => {
      requestClosed = true;
      complete();
    });
    client.on("error", (error) => {
      if (!responseEnded) reject(error);
    });
    client.setTimeout(5_000, () => {
      client.destroy(new Error("declared oversized image request timed out"));
    });
    client.flushHeaders();
  });
}

async function setGeneratedImageFile(
  page: Page,
  testId: string,
  input: { mimeType: "image/gif" | "image/jpeg" | "image/webp"; name: string },
) {
  await page.evaluate(async ({ mimeType, name, testId: inputTestId }) => {
    let blob: Blob;
    if (mimeType === "image/gif") {
      const binary = atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==");
      blob = new Blob([
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      ], { type: mimeType });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 40;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#f5f5f2";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#b04438";
      context.fillRect(18, 8, 28, 24);
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result
          ? resolve(result)
          : reject(new Error(`Cannot encode ${mimeType}`)), mimeType, 0.9);
      });
    }
    const inputElement = document.querySelector<HTMLInputElement>(
      `[data-testid="${inputTestId}"]`,
    );
    if (!inputElement) throw new Error(`Missing upload input: ${inputTestId}`);
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], name, { type: mimeType }));
    inputElement.files = transfer.files;
    inputElement.dispatchEvent(new Event("change", { bubbles: true }));
  }, { ...input, testId });
}

test.beforeEach(async ({ request }) => {
  await request.delete(`/api/canvas/${canvasId}`);
  await request.delete("/api/canvas/default");
  await request.delete("/api/history/local-user");
});

test.afterEach(async ({ request }) => {
  for (const id of [canvasId, "default"]) {
    const response = await request.get(`/api/canvas/${id}`);
    if (response.ok()) {
      const document = await response.json() as {
        nodes: Array<{ data: { assetId?: string } }>;
      };
      await Promise.all(
        document.nodes
          .map((node) => node.data.assetId)
          .filter((assetId): assetId is string => Boolean(assetId))
          .map((assetId) => request.delete(`/api/assets/${assetId}`)),
      );
    }
    await request.delete(`/api/canvas/${id}`);
  }
});

test("canvas upload creates a durable Image node without generation history or menu collisions", async ({
  page,
  request,
}) => {
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "0");

  await world.dblclick({ position: { x: 580, y: 360 } });
  const menu = page.getByTestId("add-node-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(7);
  await expect(world).toHaveCSS("z-index", "11");

  await page.getByTestId("canvas-image-upload-input").setInputFiles(firstImage);

  await expect(world).toHaveAttribute("data-node-count", "1");
  const node = page.locator(".react-flow__node-image");
  await expect(node).toBeVisible();
  await expect(page.getByTestId("image-node-title-input")).toHaveValue(
    "15-ai-image-creator-result-1280x720",
  );
  expect(await node.boundingBox()).toMatchObject({ height: 250, width: 444 });
  await expect(page.getByRole("button", { name: "替换" })).toHaveCount(1);

  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/${canvasId}`);
      if (!response.ok()) return 0;
      const document = await response.json() as { nodes: unknown[] };
      return document.nodes.length;
    })
    .toBe(1);
  const document = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as {
    nodes: Array<{ data: {
      assetId: string;
      inputState: string;
      mediaByteSize: number;
      mediaContentType: string;
      mediaHeight: number;
      mediaMetadataSource: string;
      mediaMetadataStatus: string;
      mediaStorageBackend: string;
      mediaWidth: number;
    } }>;
  };
  expect(document.nodes[0].data).toMatchObject({
    inputState: "ready",
    mediaContentType: "image/png",
    mediaHeight: 720,
    mediaMetadataSource: "server",
    mediaMetadataStatus: "ready",
    mediaStorageBackend: "local",
    mediaWidth: 1280,
  });
  expect(document.nodes[0].data.mediaByteSize).toBeGreaterThan(0);
  const asset = await request.get(
    `/api/assets/${document.nodes[0].data.assetId}`,
  );
  expect(asset.ok()).toBeTruthy();
  expect(asset.headers()["content-type"]).toBe("image/png");
  const metadata = await request.get(
    `/api/media-metadata/image/${document.nodes[0].data.assetId}`,
  );
  expect(metadata.ok()).toBeTruthy();
  await expect(metadata.json()).resolves.toMatchObject({
    byteSize: document.nodes[0].data.mediaByteSize,
    contentType: "image/png",
    durationStatus: "not-applicable",
    mediaHeight: 720,
    mediaWidth: 1280,
    storageBackend: "local",
  });
  const history = await (
    await request.get("/api/history/local-user")
  ).json() as { items: unknown[] };
  expect(history.items).toHaveLength(0);

  await page.waitForTimeout(700);
  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "1");
  await expect(page.getByTestId("image-node-preview")).toBeVisible();

  await page.getByTestId("image-node-title-input").dblclick();
  await expect(menu).toHaveCount(0);
});

test("JPEG, WebP and GIF uploads all become durable static PNG assets in global and node upload flows", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const taskPosts: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST" && /\/api\/generation-tasks(?:$|\?)/.test(entry.url())) {
      taskPosts.push(entry.url());
    }
  });

  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await world.dblclick({ position: { x: 580, y: 300 } });
  await setGeneratedImageFile(page, "canvas-image-upload-input", {
    mimeType: "image/jpeg",
    name: "catalog-photo.jpg",
  });
  await expect(world).toHaveAttribute("data-node-count", "1");

  const durableNode = async () => {
    const response = await request.get(`/api/canvas/${canvasId}`);
    if (!response.ok()) return undefined;
    const document = await response.json() as {
      nodes: Array<{ data: {
        assetId?: string;
        imageSrc?: string;
        inputState?: string;
        mediaContentType?: string;
      }; id: string }>;
    };
    return document.nodes[0];
  };
  await expect.poll(async () => (await durableNode())?.data.inputState).toBe("ready");
  const jpegNode = (await durableNode())!;
  expect(jpegNode.data).toMatchObject({
    imageSrc: expect.stringMatching(/^\/api\/assets\//),
    inputState: "ready",
    mediaContentType: "image/png",
  });
  expect(JSON.stringify(jpegNode.data)).not.toContain("blob:");
  expect((await request.get(jpegNode.data.imageSrc!)).headers()["content-type"])
    .toBe("image/png");

  const node = page.locator(`.react-flow__node[data-id="${jpegNode.id}"]`);
  await node.click();
  await setGeneratedImageFile(page, "image-upload-input", {
    mimeType: "image/webp",
    name: "catalog-photo.webp",
  });
  await expect.poll(async () => (await durableNode())?.data.assetId)
    .not.toBe(jpegNode.data.assetId);
  const webpNode = (await durableNode())!;
  expect(webpNode.data).toMatchObject({
    imageSrc: expect.stringMatching(/^\/api\/assets\//),
    inputState: "ready",
    mediaContentType: "image/png",
  });
  expect(JSON.stringify(webpNode.data)).not.toContain("blob:");
  expect((await request.get(webpNode.data.imageSrc!)).headers()["content-type"])
    .toBe("image/png");

  await setGeneratedImageFile(page, "image-upload-input", {
    mimeType: "image/gif",
    name: "catalog-photo.gif",
  });
  await expect.poll(async () => (await durableNode())?.data.assetId)
    .not.toBe(webpNode.data.assetId);
  const gifNode = (await durableNode())!;
  expect(gifNode.data).toMatchObject({
    imageSrc: expect.stringMatching(/^\/api\/assets\//),
    inputState: "ready",
    mediaContentType: "image/png",
  });
  expect(JSON.stringify(gifNode.data)).not.toContain("blob:");
  expect((await request.get(gifNode.data.imageSrc!)).headers()["content-type"])
    .toBe("image/png");

  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(page.getByTestId("image-node-preview")).toBeVisible();
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(taskPosts).toEqual([]);
});

test("the real root canvas saves a newly uploaded image across reload", async ({
  page,
  request,
}) => {
  await page.goto("/canvas");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "0");

  await world.dblclick({ position: { x: 580, y: 360 } });
  await expect(page.getByTestId("add-node-menu")).toBeVisible();
  await page.getByTestId("canvas-image-upload-input").setInputFiles(secondImage);
  await expect(world).toHaveAttribute("data-node-count", "1");
  await expect
    .poll(async () => {
      const response = await request.get("/api/canvas/default");
      if (!response.ok()) return 0;
      const document = await response.json() as { nodes: unknown[] };
      return document.nodes.length;
    })
    .toBe(1);

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "1");
  await expect(page.getByTestId("image-node-preview")).toBeVisible();
});

test("a non-image file is rejected without leaving a node or asset", async ({
  page,
  request,
}) => {
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await world.dblclick({ position: { x: 580, y: 360 } });

  await page.getByTestId("canvas-image-upload-input").setInputFiles({
    buffer: Buffer.from("not an image"),
    mimeType: "text/plain",
    name: "fake.png",
  });

  await expect(page.getByRole("alert")).toHaveText(
    "仅支持PNG、JPEG、WebP或GIF图片",
  );
  await expect(world).toHaveAttribute("data-node-count", "0");
});

test("malformed and oversized PNG payloads are rejected without residue", async ({
  request,
}) => {
  const malformed = await request.post("/api/assets/reject-malformed", {
    data: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(16),
    ]),
    headers: { "Content-Type": "image/png" },
  });
  expect(malformed.status()).toBe(400);
  expect((await request.get("/api/assets/reject-malformed")).status()).toBe(404);

  const oversized = await postDeclaredOversizedImage(
    "/api/assets/reject-oversized",
  );
  expect(oversized).toMatchObject({
    closed: true,
    connection: "close",
    status: 413,
  });
  expect(JSON.parse(oversized.body)).toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
  });
  expect((await request.get("/api/assets/reject-oversized")).status()).toBe(404);
});

test("two uploads and one replacement keep independent image identities after reload", async ({
  page,
  request,
}) => {
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");

  let expectedNodeCount = 0;
  for (const [position, image] of [
    [{ x: 300, y: 280 }, firstImage],
    [{ x: 850, y: 280 }, secondImage],
  ] as const) {
    await world.dblclick({ position });
    await page.getByTestId("canvas-image-upload-input").setInputFiles(image);
    expectedNodeCount += 1;
    await expect(world).toHaveAttribute(
      "data-node-count",
      String(expectedNodeCount),
    );
  }
  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/${canvasId}`);
      if (!response.ok()) return [];
      const document = await response.json() as {
        nodes: Array<{ data: { assetId?: string } }>;
      };
      return document.nodes.map((node) => node.data.assetId);
    })
    .toHaveLength(2);

  const before = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as {
    nodes: Array<{
      data: { assetId: string; imageSrc: string; title: string };
      id: string;
    }>;
  };
  expect(new Set(before.nodes.map((node) => node.data.assetId)).size).toBe(2);
  const first = before.nodes.find((node) =>
    node.data.title.startsWith("15-ai-image"),
  )!;
  const second = before.nodes.find((node) =>
    node.data.title.startsWith("01-neutral"),
  )!;
  const firstHash = createHash("sha256")
    .update(await (await request.get(first.data.imageSrc)).body())
    .digest("hex");

  const secondNode = page.locator(
    `.react-flow__node[data-id="${second.id}"]`,
  );
  await secondNode.click();
  await secondNode
    .getByTestId("image-upload-input")
    .setInputFiles(replacementImage);

  await expect
    .poll(async () => {
      const document = await (
        await request.get(`/api/canvas/${canvasId}`)
      ).json() as {
        nodes: Array<{ data: { assetId: string }; id: string }>;
      };
      return document.nodes.find((node) => node.id === second.id)?.data.assetId;
    })
    .not.toBe(second.data.assetId);

  const after = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as {
    nodes: Array<{
      data: { assetId: string; imageSrc: string };
      id: string;
    }>;
  };
  const firstAfter = after.nodes.find((node) => node.id === first.id)!;
  const secondAfter = after.nodes.find((node) => node.id === second.id)!;
  expect(firstAfter.data.assetId).toBe(first.data.assetId);
  expect(secondAfter.data.assetId).not.toBe(second.data.assetId);
  expect(secondAfter.data.assetId).not.toBe(first.data.assetId);
  expect(
    createHash("sha256")
      .update(await (await request.get(firstAfter.data.imageSrc)).body())
      .digest("hex"),
  ).toBe(firstHash);

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(
    page.locator(`.react-flow__node[data-id="${first.id}"] img`),
  ).toHaveAttribute("src", firstAfter.data.imageSrc);
  await expect(
    page.locator(`.react-flow__node[data-id="${second.id}"] img`),
  ).toHaveAttribute("src", secondAfter.data.imageSrc);
});
