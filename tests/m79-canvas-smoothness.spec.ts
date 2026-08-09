import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "./safe-test";

function denseDocument(nodeCount: number) {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    data: {
      label: index % 2 === 0 ? "Image" : "Text",
      title: `节点 ${index + 1}`,
      ...(index % 2 === 0
        ? { imagePrompt: "商品图", imagePromptReady: true }
        : { textPrompt: "文案内容", textPromptReady: true }),
    },
    id: `smooth-node-${index + 1}`,
    position: {
      x: (index % 20) * 300 + 60,
      y: Math.floor(index / 20) * 300 + 60,
    },
    style: { height: 250, width: 250 },
    type: index % 2 === 0 ? "image" : "text",
    zIndex: 1,
  }));
  const edges = Array.from({ length: nodeCount - 1 }, (_, index) => ({
    id: `smooth-edge-${index + 1}`,
    source: nodes[index].id,
    sourceHandle: "source",
    target: nodes[index + 1].id,
    targetHandle: "target",
    type: "cuttable",
  }));
  return { edges, nodes, revision: 0, viewport: { x: 0, y: 0, zoom: 1 } };
}

async function saveDenseProjectCanvas(
  request: APIRequestContext,
  canvasId: string,
  nodeCount: number,
) {
  const baselineResponse = await request.get(`/api/canvas/${canvasId}`);
  expect(baselineResponse.ok()).toBeTruthy();
  const baseline = (await baselineResponse.json()) as {
    loadToken: string;
    revision: number;
  };
  const saved = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      ...denseDocument(nodeCount),
      observedLoadToken: baseline.loadToken,
      observedRevision: baseline.revision,
      revision: baseline.revision,
      saveAttemptId: randomUUID(),
      saveSequence: 1,
      saveSessionId: randomUUID(),
    },
  });
  expect(saved.ok()).toBeTruthy();
}

function startMeters(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const state = window as typeof window & {
      smoothFrames?: number[];
      smoothFrameTimer?: number;
      smoothLongTasks?: number[];
      smoothObserver?: PerformanceObserver;
    };
    state.smoothLongTasks = [];
    state.smoothObserver = new PerformanceObserver((list) => {
      state.smoothLongTasks!.push(
        ...list.getEntries().map((entry) => entry.duration),
      );
    });
    state.smoothObserver.observe({ entryTypes: ["longtask"] });
    state.smoothFrames = [];
    const record = (now: number) => {
      state.smoothFrames!.push(now);
      state.smoothFrameTimer = requestAnimationFrame(record);
    };
    state.smoothFrameTimer = requestAnimationFrame(record);
  });
}

async function readMeters(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const state = window as typeof window & {
      smoothFrames?: number[];
      smoothFrameTimer?: number;
      smoothLongTasks?: number[];
      smoothObserver?: PerformanceObserver;
    };
    state.smoothObserver?.disconnect();
    window.cancelAnimationFrame(state.smoothFrameTimer!);
    return {
      frames: state.smoothFrames ?? [],
      longTasks: state.smoothLongTasks ?? [],
    };
  });
}

function summarize(meters: { frames: number[]; longTasks: number[] }) {
  const deltas = meters.frames
    .slice(1)
    .map((now, index) => now - meters.frames[index]);
  const sorted = [...deltas].sort((left, right) => left - right);
  return {
    frames: deltas.length,
    fps: Math.round((deltas.length / 1400) * 1000),
    droppedFrames: deltas.filter((delta) => delta > 24).length,
    p95ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    maxMs: Math.round(Math.max(0, ...deltas)),
    longTasks: meters.longTasks.map((duration) => Math.round(duration)),
  };
}

test("60-node canvas drag stays smooth in production preview", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  await saveDenseProjectCanvas(request, project.id, 60);
  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.waitForTimeout(600);

  await startMeters(page);
  const node = page.locator(".react-flow__node:visible").first();
  const box = (await node.boundingBox())!;
  const nx = box.x + box.width / 2;
  const ny = box.y + box.height / 2;
  await page.mouse.move(nx, ny);
  await page.mouse.down();
  for (let step = 0; step < 90; step += 1) {
    await page.mouse.move(nx + step * 2, ny + step * 1, { steps: 1 });
    await page.waitForTimeout(14);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  const result = summarize(await readMeters(page));
  expect(result.longTasks.filter((duration) => duration >= 100)).toEqual([]);
  expect(result.p95ms).toBeLessThanOrEqual(25);
  expect(result.droppedFrames).toBeLessThanOrEqual(5);

  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});

test("fast pan keeps visible nodes mounted and zoom-out mounts all", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  await saveDenseProjectCanvas(request, project.id, 200);
  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.waitForTimeout(600);

  const pane = page.locator(".react-flow__pane").first();
  const paneBox = (await pane.boundingBox())!;
  await page.mouse.move(
    paneBox.x + paneBox.width / 2,
    paneBox.y + paneBox.height / 2,
  );
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(8);
  }
  await page.waitForTimeout(300);
  const afterPan = await page.locator(".react-flow__node").count();
  expect(afterPan).toBeGreaterThan(0);

  await page.getByTestId("zoom-slider").fill("0.15");
  await page.waitForTimeout(500);
  expect(await page.locator(".react-flow__node").count()).toBe(200);

  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});
