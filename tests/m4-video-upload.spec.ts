import { expect, test, type APIRequestContext, type Locator, type Page } from "./safe-test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const canvasId = "interaction.upload-media-sandbox-current";
const projectIds = new Set<string>();
const mediaDirectory = mkdtempSync(join(tmpdir(), "unboundry-video-upload-"));
const videoFile = join(mediaDirectory, "一秒测试视频.mp4");
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=green:s=320x180:d=1",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=550:duration=1",
  "-shortest",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  videoFile,
]);

async function clearFixture(request: APIRequestContext) {
  const response = await request.get(`/api/canvas/${canvasId}`);
  if (response.ok()) {
    const document = await response.json() as {
      nodes: Array<{
        data: { assetId?: string; audioSrc?: string; videoSrc?: string };
      }>;
    };
    await Promise.all(
      document.nodes
        .filter((node) => node.data.assetId)
        .map((node) =>
          request.delete(
            `${node.data.videoSrc ? "/api/video-assets/" : "/api/audio-assets/"}${node.data.assetId}`,
          ),
        ),
    );
  }
  await request.delete(`/api/canvas/${canvasId}`);
}

test.beforeEach(async ({ request }) => clearFixture(request));
test.afterEach(async ({ request }) => {
  for (const projectId of projectIds) {
    await request.delete(`/api/projects/${projectId}`);
  }
  projectIds.clear();
  await clearFixture(request);
});
test.afterAll(() => rmSync(mediaDirectory, { force: true, recursive: true }));

test("MP4 playback, range delivery, download and metadata survive a reload", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "2");

  await page.getByTestId("video-upload-input").setInputFiles(videoFile);
  const preview = page.getByTestId("video-node-preview");
  await expect.poll(async () => {
    if (await preview.count() !== 1) {
      return { hasLayout: false, mediaError: null, visible: false };
    }
    const layout = await preview.evaluate((video: HTMLVideoElement) => {
      const bounds = video.getBoundingClientRect();
      return {
        hasLayout: bounds.height > 0 && bounds.width > 0,
        mediaError: video.error?.code ?? null,
      };
    });
    return {
      ...layout,
      visible: await preview.isVisible(),
    };
  }, { timeout: 15_000 }).toEqual({
    hasLayout: true,
    mediaError: null,
    visible: true,
  });
  await expect(preview).toHaveJSProperty("muted", true);
  await expect
    .poll(() =>
      preview.evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByText("1.0s", { exact: true })).toBeVisible();

  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/${canvasId}`);
      if (!response.ok()) return "";
      const document = await response.json() as {
        nodes: Array<{
          data: { assetId?: string; sourceKind?: string };
        }>;
      };
      return document.nodes.find(
        (node) => node.data.sourceKind === "video",
      )?.data.assetId ?? "";
    })
    .not.toBe("");
  const document = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as {
    nodes: Array<{
      data: {
        assetId: string;
        sourceKind: string;
        inputState: string;
        mediaByteSize: number;
        mediaContentType: string;
        mediaDurationSeconds: number;
        mediaHeight: number;
        mediaMetadataSource: string;
        mediaMetadataStatus: string;
        mediaStorageBackend: string;
        mediaWidth: number;
        videoSrc: string;
      };
    }>;
  };
  const videoNode = document.nodes.find(
    (node) => node.data.sourceKind === "video",
  )!;
  expect(videoNode.data).toMatchObject({
    inputState: "ready",
    mediaContentType: "video/mp4",
    mediaHeight: 180,
    mediaMetadataSource: "server",
    mediaMetadataStatus: "ready",
    mediaStorageBackend: "local",
    mediaWidth: 320,
  });
  expect(videoNode.data.mediaByteSize).toBeGreaterThan(0);
  expect(videoNode.data.mediaDurationSeconds).toBeCloseTo(1, 1);

  const metadata = await request.get(
    `/api/media-metadata/video/${videoNode.data.assetId}`,
  );
  expect(metadata.ok()).toBeTruthy();
  await expect(metadata.json()).resolves.toMatchObject({
    byteSize: videoNode.data.mediaByteSize,
    contentType: "video/mp4",
    durationStatus: "ready",
    mediaHeight: 180,
    mediaWidth: 320,
    storageBackend: "local",
  });

  const range = await request.get(videoNode.data.videoSrc, {
    headers: { Range: "bytes=0-99" },
  });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-range"]).toMatch(/^bytes 0-99\//);

  const progress = page.getByRole("slider", { name: "视频进度" });
  await progress.fill("0.5");
  await expect
    .poll(async () => Number(await progress.inputValue()))
    .toBeCloseTo(0.5, 1);
  await page.getByRole("button", { name: "播放视频" }).click();
  await expect
    .poll(() =>
      preview.evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0.5);
  await page.getByRole("button", { name: "暂停视频" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByTestId("video-node-toolbar")
    .getByRole("button", { name: "下载" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Video.mp4");
  const downloaded = await download.createReadStream();
  const sourceHash = createHash("sha256");
  for await (const chunk of createReadStream(videoFile)) sourceHash.update(chunk);
  const downloadHash = createHash("sha256");
  for await (const chunk of downloaded) downloadHash.update(chunk);
  expect(downloadHash.digest("hex")).toBe(sourceHash.digest("hex"));

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(preview).toHaveAttribute("src", videoNode.data.videoSrc);
  await expect(page.getByText("1.0s", { exact: true })).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  const noopBaseline = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as { revision: number };
  const noopCanvasPuts: string[] = [];
  const observeCanvasPut = (outgoing: { method(): string; url(): string }) => {
    if (
      outgoing.method() === "PUT" &&
      outgoing.url().includes(`/api/canvas/${canvasId}`)
    ) noopCanvasPuts.push(outgoing.url());
  };
  page.on("request", observeCanvasPut);
  const metadataEvents = await preview.evaluate((video) => {
    let observed = 0;
    const count = () => {
      observed += 1;
    };
    video.addEventListener("loadedmetadata", count);
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("loadedmetadata"));
    video.removeEventListener("loadedmetadata", count);
    return observed;
  });
  expect(metadataEvents).toBe(2);
  // Four debounce windows prove the value-equivalent event stayed quiet;
  // observing request start avoids confusing a slow response with no write.
  await page.waitForTimeout(2_000);
  page.off("request", observeCanvasPut);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  expect(noopCanvasPuts).toHaveLength(0);
  const noopSettled = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as { revision: number };
  expect(noopSettled.revision).toBe(noopBaseline.revision);

  const current = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as {
    edges: unknown[];
    loadToken: string;
    nodes: Array<{ data: Record<string, unknown>; id: string }>;
    revision: number;
    viewport: Record<string, unknown>;
  };
  const legacyNodes = current.nodes.map((node) => {
    if (node.data.assetId !== videoNode.data.assetId) return node;
    const data = { ...node.data };
    delete data.mediaHeight;
    delete data.mediaWidth;
    return {
      ...node,
      data: {
        ...data,
        inputState: "invalid",
        inputStateReason: "视频参考视频分辨率尚未经过服务端校验，请重新上传",
        mediaMetadataSource: "server",
        videoHeight: 180,
        videoWidth: 320,
      },
    };
  });
  const createdProject = await request.post("/api/projects", { data: {} });
  expect(createdProject.status()).toBe(201);
  const projectId = ((await createdProject.json()) as { id: string }).id;
  projectIds.add(projectId);
  const projectBaseline = await (
    await request.get(`/api/canvas/${projectId}`)
  ).json() as { loadToken: string; revision: number };
  const savedLegacy = await request.put(`/api/canvas/${projectId}`, {
    data: {
      edges: current.edges,
      nodes: legacyNodes,
      observedLoadToken: projectBaseline.loadToken,
      observedRevision: projectBaseline.revision,
      revision: projectBaseline.revision,
      viewport: current.viewport,
    },
  });
  expect(savedLegacy.ok(), await savedLegacy.text()).toBeTruthy();
  const savedLegacyDocument = await (
    await request.get(`/api/canvas/${projectId}`)
  ).json() as { revision: number };

  let canvasWrites = 0;
  let metadataRequests = 0;
  page.on("request", (entry) => {
    const pathname = new URL(entry.url()).pathname;
    if (
      (entry.method() === "PUT" && pathname === `/api/canvas/${projectId}`) ||
      (entry.method() === "POST" &&
        pathname === `/api/canvases/${projectId}/commands`)
    ) canvasWrites += 1;
    if (
      entry.method() === "GET" &&
      pathname === `/api/media-metadata/video/${videoNode.data.assetId}`
    ) metadataRequests += 1;
  });
  await page.goto(`/canvas/${projectId}`);
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.waitForTimeout(750);
  expect(metadataRequests).toBe(0);
  const afterHydration = await (
    await request.get(`/api/canvas/${projectId}`)
  ).json() as {
    nodes: Array<{ data: Record<string, unknown> }>;
    revision: number;
  };
  expect(afterHydration.revision).toBe(savedLegacyDocument.revision);
  expect(afterHydration.nodes.find((node) =>
    node.data.assetId === videoNode.data.assetId
  )?.data).toMatchObject({
    inputState: "ready",
    mediaHeight: videoNode.data.mediaHeight,
    mediaMetadataSource: "server",
    mediaWidth: videoNode.data.mediaWidth,
  });
  expect(canvasWrites).toBe(0);
  await expect(preview).toHaveAttribute("src", videoNode.data.videoSrc);
  await verifyLayoutCases(page, request, info);
});

const fixture = "interaction.upload-media-sandbox-current";
const directory = mkdtempSync(join(tmpdir(), "unboundry-video-layout-"));
const cases = [
  { name: "reported portrait", media: [816, 1104], node: [620, 420], zoom: 1 },
  { name: "9:16 at 32 percent", media: [360, 640], node: [620, 420], zoom: 0.32 },
  { name: "landscape in tall node", media: [640, 360], node: [360, 560], zoom: 1 },
  { name: "square at minimum size", media: [400, 400], node: [240, 135], zoom: 1 },
] as const;
const files = cases.map(({ media: [w, h] }, index) => {
  const file = join(directory, `${index}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i",
    `color=c=gray:s=${w}x${h}:d=2`, "-vf", [
      "drawbox=x=0:y=0:w=iw/4:h=ih/4:color=red:t=fill",
      "drawbox=x=iw*3/4:y=0:w=iw/4:h=ih/4:color=lime:t=fill",
      "drawbox=x=0:y=ih*3/4:w=iw/4:h=ih/4:color=blue:t=fill",
      "drawbox=x=iw*3/4:y=ih*3/4:w=iw/4:h=ih/4:color=yellow:t=fill",
    ].join(","), "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
  return file;
});
test.afterAll(() => rmSync(directory, { recursive: true, force: true }));

// Assert real rendered pixels, as well as element containment. A visible video
// or a contain declaration alone does not detect the original overflowing grid.
async function checkFrame(card: Locator, preview: Locator) {
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  const geometry = await preview.evaluate((v: HTMLVideoElement) => {
    const c = v.parentElement!;
    const box = v.getBoundingClientRect(), outer = c.getBoundingClientRect();
    const scale = outer.width / (c as HTMLElement).offsetWidth;
    return {
      media: [v.videoWidth, v.videoHeight],
      video: [v.clientWidth, v.clientHeight],
      card: [c.clientWidth, c.clientHeight],
      relative: [box.x - outer.x, box.y - outer.y, box.width, box.height],
      scale,
    };
  });
  expect(geometry.video[0]).toBeLessThanOrEqual(geometry.card[0] + 1);
  expect(geometry.video[1]).toBeLessThanOrEqual(geometry.card[1] + 1);
  const png = await card.screenshot({ scale: "css" });
  // PNG IHDR has the actual screenshot dimensions (including rounding at zoom).
  const width = png.readUInt32BE(16);
  const pixels = execFileSync("ffmpeg", ["-loglevel", "error", "-i", "pipe:0",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
  { input: png, maxBuffer: 16 * 1024 * 1024 });
  const [mw, mh] = geometry.media;
  const [vx, vy, vw, vh] = geometry.relative;
  const fit = Math.min(vw / mw, vh / mh);
  const left = vx + (vw - mw * fit) / 2, top = vy + (vh - mh * fit) / 2;
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  for (const [index, [fx, fy]] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]].entries()) {
    const x = Math.round(left + mw * fit * fx), y = Math.round(top + mh * fit * fy);
    const offset = (y * width + x) * 3;
    const rgb = [...pixels.subarray(offset, offset + 3)];
    expect(rgb, `corner ${index}: ${JSON.stringify(geometry)}`).toHaveLength(3);
    for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs(rgb[channel] - colors[index][channel]), `corner ${index}: ${rgb}`)
        .toBeLessThan(55);
    }
  }
  return { geometry, png };
}

async function verifyLayoutCases(page: Page, request: APIRequestContext, info: ReturnType<typeof test.info>) {
 page.setDefaultTimeout(10_000);
 for (const [index, scenario] of cases.entries()) {
  await test.step(`${scenario.name}: complete frame, stable saved geometry and no hydration writes`, async () => {
    await request.delete(`/api/canvas/${fixture}`);
    let projectId: string | undefined;
    let assetId: string | undefined;
    let primaryFailure: unknown;
    try {
      await page.goto(`/__fixture/${fixture}`);
      await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
      await page.getByTestId("video-upload-input").setInputFiles(files[index]);
      await expect.poll(async () => {
        const doc = await (await request.get(`/api/canvas/${fixture}`)).json();
        return doc.nodes.find((n: { type: string }) => n.type === "video")?.data.assetId;
      }).toBeTruthy();
      const uploaded = await (await request.get(`/api/canvas/${fixture}`)).json();
      const video = uploaded.nodes.find((n: { type: string }) => n.type === "video");
      assetId = video.data.assetId;
      const project = await request.post("/api/projects", { data: {} });
      expect(project.status()).toBe(201);
      projectId = (await project.json()).id;
      const initial = await (await request.get(`/api/canvas/${projectId}`)).json();
      const { width: _width, height: _height, measured: _measured, ...rest } = video;
      const saved = await request.put(`/api/canvas/${projectId}`, { data: {
        nodes: [{ ...rest, selected: false, position: { x: 260, y: 140 },
          style: { width: scenario.node[0], height: scenario.node[1] } }],
        edges: [], viewport: { x: 0, y: 0, zoom: scenario.zoom },
        observedLoadToken: initial.loadToken, observedRevision: initial.revision,
        revision: initial.revision,
      } });
      expect(saved.ok(), await saved.text()).toBeTruthy();
      const baseline = await (await request.get(`/api/canvas/${projectId}`)).json();
      const writes: string[] = [];
      page.on("request", r => {
        const path = new URL(r.url()).pathname;
        if ((r.method() === "PUT" && path === `/api/canvas/${projectId}`) ||
          (r.method() === "POST" && path === `/api/canvases/${projectId}/commands`)) writes.push(path);
      });
      await page.goto(`/canvas/${projectId}`);
      await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
      const card = page.locator(".video-node-card"), preview = page.getByTestId("video-node-preview");
      await page.mouse.move(1250, 50);
      const frame = await checkFrame(card, preview);
      console.log("VIDEO_LAYOUT_EVIDENCE " + JSON.stringify({ name: scenario.name, geometry: frame.geometry, pngBase64: frame.png.toString("base64") }));
      await info.attach("complete-frame", { body: frame.png, contentType: "image/png" });
      await info.attach("layout-measurement", { body: JSON.stringify(frame.geometry), contentType: "application/json" });
      await page.reload();
      await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
      await checkFrame(card, preview);
      await page.waitForTimeout(1100);
      expect(writes).toEqual([]);
      const after = await (await request.get(`/api/canvas/${projectId}`)).json();
      expect(after.revision).toBe(baseline.revision);
      expect(after.nodes).toEqual(baseline.nodes);
      expect(after.edges).toEqual(baseline.edges);

      if (index === 0) {
        const node = page.locator(".react-flow__node-video");
        await node.click({ position: { x: 4, y: 4 } });
        const handle = node.locator(".react-flow__resize-control.bottom.right.handle");
        const corner = (await handle.boundingBox())!;
        await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
        await page.mouse.down();
        await page.mouse.move(corner.x + corner.width / 2 - 240, corner.y + corner.height / 2 + 120, { steps: 12 });
        await page.mouse.up();
        await expect.poll(async () => {
          const doc = await (await request.get(`/api/canvas/${projectId}`)).json();
          return doc.nodes[0].style;
        }).toEqual({ width: 380, height: 540 });
        // Deselect so the controls do not deliberately overlay the corner pixels.
        await page.locator(".react-flow__pane").click({ position: { x: 1000, y: 800 } });
        await page.mouse.move(1250, 50);
        await checkFrame(card, preview);
        const resized = await (await request.get(`/api/canvas/${projectId}`)).json();
        writes.length = 0;
        await page.reload();
        await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
        await checkFrame(card, preview);
        await page.waitForTimeout(1100);
        expect(writes).toEqual([]);
        const reopened = await (await request.get(`/api/canvas/${projectId}`)).json();
        expect(reopened.nodes).toEqual(resized.nodes);
        expect(reopened.revision).toBe(resized.revision);
      }
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      try {
        if (!page.isClosed()) await page.goto("about:blank");
        if (projectId) await request.delete(`/api/projects/${projectId}`);
        await request.delete(`/api/canvas/${fixture}`);
        if (assetId) await request.delete(`/api/video-assets/${assetId}`);
      } catch (cleanupError) {
        if (!primaryFailure) throw cleanupError;
        console.warn("Layout test cleanup could not complete after primary failure; isolated runner owns final removal.");
      }
    }
  });
}
}


test("AR real canvas portrait adoption preserves manual geometry and passive reload", async ({ page, request }) => {
  test.setTimeout(120_000);
  const project = await request.post("/api/projects", { data: {} });
  const id = (await project.json()).id; projectIds.add(id);
  const read = async () => (await request.get(`/api/canvas/${id}`)).json();
  const base = await read();
  const saved = await request.put(`/api/canvas/${id}`, { data: { edges: [],
    nodes: [{ id: "aspect-video", type: "video", position: { x: 150, y: 180 }, style: { width: 444, height: 250 },
      data: { label: "Video", title: "原比例验收", mediaSizingMode: "auto" } }],
    viewport: { x: 0, y: 0, zoom: 1 }, observedLoadToken: base.loadToken, observedRevision: base.revision, revision: base.revision } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/canvas/${id}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("video-upload-input").setInputFiles(files[0]);
  await expect.poll(async () => (await read()).nodes[0].style).toEqual({ width: 250, height: 338 });
  await expect(page.locator('.react-flow__node[data-id="aspect-video"]')).toHaveCSS("width", "250px");
  const after = await read();
  await page.reload(); await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.waitForTimeout(600);
  expect((await read()).revision).toBe(after.revision);
  const card = page.locator('.react-flow__node[data-id="aspect-video"]');
  await card.click({ position: { x: 100, y: 100 } });
  await expect(page.getByRole("button", { name: "按素材比例适配", exact: true })).toBeDisabled();
  const handle = card.locator('.react-flow__resize-control.bottom.right');
  const box = await handle.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width/2, box!.y + box!.height/2); await page.mouse.down();
  await page.mouse.move(box!.x + 95, box!.y + 45, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await read()).nodes[0].data.mediaSizingMode).toBe("manual");
  const manual = (await read()).nodes[0].style;
  await page.getByTestId("video-upload-input").setInputFiles(files[2]);
  await expect.poll(async () => (await read()).nodes[0].data.mediaWidth).toBe(640);
  expect((await read()).nodes[0].style).toEqual(manual);
  await card.click({ position: { x: 100, y: 100 } });
  await page.getByRole("button", { name: "按素材比例适配", exact: true }).click();
  await expect.poll(async () => (await read()).nodes[0].style).toEqual({ width: 444, height: 250 });
  expect((await read()).nodes[0].data.mediaSizingMode).toBe("auto");
  await page.mouse.click(50, 500);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(async () => (await read()).nodes[0].data.mediaSizingMode).toBe("manual");
  expect((await read()).nodes[0].style).toEqual(manual);
  const png = join(directory, "portrait.png");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x640", "-frames:v", "1", png]);
  const current = await read();
  expect((await request.put(`/api/canvas/${id}`, { data: { ...current,
    nodes: [...current.nodes, { id: "aspect-image", type: "image", position: { x: 700, y: 180 }, style: { width: 250, height: 250 }, data: { label: "Image", mediaSizingMode: "auto" } }],
    observedRevision: current.revision, observedLoadToken: current.loadToken } })).ok()).toBeTruthy();
  await page.reload(); await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("image-upload-input").setInputFiles(png);
  await expect.poll(async () => (await read()).nodes.find((n: { id: string }) => n.id === "aspect-image")?.style).toEqual({ width: 250, height: 500 });
  const imageSaved = await read();
  await page.reload(); await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.waitForTimeout(600); expect((await read()).revision).toBe(imageSaved.revision);
});

test("AR selected template family wins hit testing over an unselected overlapping template", async ({ page, request }) => {
  const project = await request.post("/api/projects", { data: {} });
  const id = (await project.json()).id; projectIds.add(id);
  const read = async () => (await request.get(`/api/canvas/${id}`)).json();
  const base = await read();
  const nodes = [
    { id: "group-a", type: "group", data: { label: "Group", title: "模板A" }, position: { x: 100, y: 170 }, style: { width: 450, height: 350 }, zIndex: 0 },
    { id: "group-b", type: "group", data: { label: "Group", title: "模板B" }, position: { x: 300, y: 190 }, style: { width: 450, height: 350 }, zIndex: 2000 },
    { id: "child-a", type: "text", parentId: "group-a", data: { label: "Text", content: "A" }, position: { x: 30, y: 50 }, style: { width: 300, height: 150 }, zIndex: 1 },
    { id: "child-b", type: "text", parentId: "group-b", data: { label: "Text", content: "B" }, position: { x: 30, y: 50 }, style: { width: 300, height: 150 }, zIndex: 1 },
  ];
  expect((await request.put(`/api/canvas/${id}`, { data: { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 }, observedRevision: base.revision, observedLoadToken: base.loadToken, revision: base.revision } })).ok()).toBeTruthy();
  await page.goto(`/canvas/${id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
  const baseline = await read();
  await page.mouse.click(110, 190);
  await expect(page.locator('.react-flow__node[data-id="group-a"]')).toHaveClass(/selected/);
  const top = () => page.evaluate(() => document.elementFromPoint(350, 300)?.closest('.react-flow__node, .react-flow__node-toolbar')?.getAttribute('data-id'));
  await expect.poll(top).toBe("child-a");
  await page.mouse.click(700, 210);
  await expect.poll(top).toBe("child-b");
  await page.mouse.click(180, 290);
  await expect.poll(top).toBe("child-a");
  await page.keyboard.down("Shift");
  await page.mouse.click(700, 210);
  await page.keyboard.up("Shift");
  await expect(page.locator('.react-flow__node[data-id="child-a"]')).toHaveClass(/selected/);
  await expect(page.locator('.react-flow__node[data-id="group-b"]')).toHaveClass(/selected/);
  await expect.poll(top).toBe("child-b");
  expect((await read()).revision).toBe(baseline.revision);
  expect((await read()).nodes.map((n: { position: unknown; zIndex: unknown }) => [n.position,n.zIndex])).toEqual(baseline.nodes.map((n: { position: unknown; zIndex: unknown }) => [n.position,n.zIndex]));
  // Existing graph contract rejects nested groups; preserve that boundary.
  // Then reverse root DOM order without changing the supported topology.
  const nested = { id: "nested-a", type: "group", parentId: "group-a", data: { label: "Group", title: "嵌套" }, position: {x: 20,y: 40}, style: {width: 320,height: 220}, zIndex: 2 };
  const reordered = [nodes[1], nodes[0], nested, nodes[3], {...nodes[2], parentId: "nested-a", position: {x:10,y:10}}];
  const now = await read();
  const rejected = await request.put(`/api/canvas/${id}`, {data:{...now,nodes:reordered,observedRevision:now.revision,observedLoadToken:now.loadToken}});
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({code:"CANVAS_TOPOLOGY_CONFLICT"});
  expect((await read()).revision).toBe(now.revision);
  expect((await request.put(`/api/canvas/${id}`, {data:{...now,nodes:[nodes[1],nodes[0],nodes[3],nodes[2]],observedRevision:now.revision,observedLoadToken:now.loadToken}})).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
  const nestedBaseline = await read();
  await page.mouse.click(110,190); await expect.poll(top).toBe("child-a");
  await page.mouse.click(700,210); await expect.poll(top).toBe("child-b");
  await page.mouse.click(180,290); await expect.poll(top).toBe("child-a");
  await page.waitForTimeout(400);
  expect((await read()).revision).toBe(nestedBaseline.revision);
  expect((await read()).nodes).toEqual(nestedBaseline.nodes);

});
