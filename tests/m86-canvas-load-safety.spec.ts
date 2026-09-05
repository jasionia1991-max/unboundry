import { expect, test, type Locator, type Page } from "./safe-test";

const LOAD_TOKEN_A = "11111111-1111-4111-8111-111111111111";
const LOAD_TOKEN_B = "22222222-2222-4222-8222-222222222222";
const LOAD_TOKEN_C = "33333333-3333-4333-8333-333333333333";
const LOAD_TOKEN_D = "44444444-4444-4444-8444-444444444444";
const SAVE_EPOCH_A = "v1.aaaaaaaaaaaaaaaaaaaaaa";
const SAVE_EPOCH_B = "v1.bbbbbbbbbbbbbbbbbbbbbb";
const SAVE_SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SAVE_SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SAVE_ATTEMPT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    (window as Window & {
      __UNBOUNDRY_M86_LEGACY_CANVAS_PUTS__?: boolean;
    }).__UNBOUNDRY_M86_LEGACY_CANVAS_PUTS__ = true;
  });
});

const emptyFence: {
  currentWriterSequence: number;
  currentWriterSessionId: string | null;
  saveEpoch: string;
  sessionHighWaterAttemptId: string | null;
  sessionHighWaterSequence: number;
} = {
  currentWriterSequence: 0,
  currentWriterSessionId: null,
  saveEpoch: SAVE_EPOCH_A,
  sessionHighWaterAttemptId: null,
  sessionHighWaterSequence: 0,
};
const emptyDocument = {
  ...emptyFence,
  edges: [],
  graphRevision: 0,
  loadToken: LOAD_TOKEN_A,
  nodes: [],
  revision: 0,
  viewport: { x: 0, y: 0, zoom: 1 },
};

function textDocument(
  title: string,
  revision: number,
  loadToken = LOAD_TOKEN_A,
) {
  return {
    ...emptyFence,
    edges: [],
    graphRevision: revision,
    loadToken,
    nodes: [
      {
        data: { content: "", label: "Text", title },
        id: "text-primary",
        position: { x: 442, y: 300 },
        style: { height: 250, width: 250 },
        type: "text",
        zIndex: 0,
      },
    ],
    revision,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function canvasSaveScope(canvasId: string) {
  return JSON.stringify(["__test__", canvasId]);
}

function canvasSavePayload({
  attemptId = SAVE_ATTEMPT_A,
  canvasTitle,
  loadToken = LOAD_TOKEN_A,
  revision = 1,
  saveSequence = 1,
  saveSessionId = SAVE_SESSION_A,
}: {
  attemptId?: string;
  canvasTitle: string;
  loadToken?: string;
  revision?: number;
  saveSequence?: number;
  saveSessionId?: string;
}) {
  return JSON.stringify({
    edges: [],
    nodes: textDocument(canvasTitle, revision, loadToken).nodes,
    observedLoadToken: loadToken,
    observedRevision: revision,
    revision,
    saveAttemptId: attemptId,
    saveSequence,
    saveSessionId,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

type SeededCanvasSaveSession = {
  confirmedSequence: number;
  pendingPagehide?: {
    attemptId: string;
    payload: string;
    saveSequence: number;
    serverEpoch: string;
  };
  saveSequence: number;
  saveSessionId: string;
  serverEpoch?: string;
  storageRevision: number;
};

type InvalidSaveResultKind =
  | "bad-token"
  | "graph-ahead"
  | "malformed"
  | "negative-graph"
  | "negative-revision"
  | "stale-positive"
  | "unchanged-token"
  | "zero-revision";

function invalidCanvasSaveResult(
  kind: InvalidSaveResultKind,
  requestRevision: number,
  requestLoadToken = LOAD_TOKEN_A,
) {
  const valid = {
    graphRevision: requestRevision + 1,
    loadToken: LOAD_TOKEN_B,
    revision: requestRevision + 1,
  };
  if (kind === "bad-token") return { ...valid, loadToken: " " };
  if (kind === "graph-ahead") {
    return { ...valid, graphRevision: valid.revision + 1 };
  }
  if (kind === "malformed") return { ...valid, revision: "invalid" };
  if (kind === "negative-graph") return { ...valid, graphRevision: -1 };
  if (kind === "negative-revision") return { ...valid, revision: -1 };
  if (kind === "stale-positive") {
    return { ...valid, revision: Math.max(1, requestRevision) };
  }
  if (kind === "unchanged-token") {
    return { ...valid, loadToken: requestLoadToken };
  }
  return { ...valid, revision: 0 };
}

function loadTokenForRevision(revision: number) {
  if (revision <= 1) return LOAD_TOKEN_A;
  if (revision === 2) return LOAD_TOKEN_B;
  if (revision === 3) return LOAD_TOKEN_C;
  if (revision === 4) return LOAD_TOKEN_D;
  return `55555555-5555-4555-8555-${revision.toString(16).padStart(12, "0")}`;
}

async function seedCanvasSaveSession(
  page: Page,
  canvasId: string,
  session: SeededCanvasSaveSession,
  launchPendingRequest = false,
) {
  const scope = canvasSaveScope(canvasId);
  await page.addInitScript(({ launch, pendingPayload, scopeId, value }) => {
    if (window.top !== window || location.pathname !== `/__fixture/${value.canvasId}`) {
      return;
    }
    const prefix = "unboundry:canvas-save-session:v2:";
    const seedMarker = `__m86:canvas-save-session-seeded:${scopeId}`;
    if (window.sessionStorage.getItem(seedMarker) === "1") return;
    window.sessionStorage.setItem(seedMarker, "1");
    window.sessionStorage.setItem(`${prefix}${scopeId}`, JSON.stringify(value.session));
    window.sessionStorage.setItem(`${prefix}scopes`, JSON.stringify([scopeId]));
    if (launch && pendingPayload) {
      void window.fetch(`/api/canvas/${value.canvasId}`, {
        body: pendingPayload,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "PUT",
      });
    }
  }, {
    launch: launchPendingRequest,
    pendingPayload: session.pendingPagehide?.payload,
    scopeId: scope,
    value: { canvasId, session },
  });
}

async function readCanvasSaveSession(page: Page, canvasId: string) {
  const scope = canvasSaveScope(canvasId);
  return page.evaluate((scopeId) => {
    const raw = window.sessionStorage.getItem(
      `unboundry:canvas-save-session:v2:${scopeId}`,
    );
    return raw ? JSON.parse(raw) as SeededCanvasSaveSession : null;
  }, scope);
}

async function flushBrowserTasks(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  }));
}

async function pauseBrowserClock(page: Page) {
  const browserNow = await page.evaluate(() => Date.now());
  // `pauseAt` only moves forward. Use the browser's own clock plus a bounded
  // margin so a slow control round-trip cannot accidentally target the past.
  await page.clock.pauseAt(browserNow + 1_000);
}

function generationPostCount(page: Page) {
  let count = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      url.pathname.startsWith("/api/generation-tasks")
    ) {
      count += 1;
    }
  });
  return () => count;
}

const PANEL_RETRY_TASK_ID = "m86-panel-retry-task";
const PANEL_RETRY_INPUT_KEY = "m86-panel-retry-input-key";
const PANEL_RETRY_OWNERSHIP_KEY = "m86-panel-retry-ownership-key";
const PANEL_RETRY_CONFIGURATION_REVISION =
  "m86-panel-retry-configuration-revision";

function panelRetryTask(canvasId: string) {
  return {
    attempt: 1,
    canvasRevision: 1,
    canvasId,
    costCurrency: "CNY",
    createdAt: "2026-08-09T00:00:00.000Z",
    errorCode: "TEST_FAILURE",
    errorMessage: "离线门禁测试失败",
    fixtureScopeId: "",
    id: PANEL_RETRY_TASK_ID,
    generationInputKey: PANEL_RETRY_INPUT_KEY,
    generationOwnershipKey: PANEL_RETRY_OWNERSHIP_KEY,
    kind: "text",
    nodeId: "m86-panel-retry-node",
    prompt: "Panel retry gate",
    retryAllowed: true,
    modelInputContractFingerprint: "mic2:m86-panel-retry",
    modelConfigurationRevision: PANEL_RETRY_CONFIGURATION_REVISION,
    modelReleaseRevision: "00000000-0000-4000-8000-000000000086",
    state: "failed",
    updatedAt: "2026-08-09T00:00:01.000Z",
  } as const;
}

async function installPanelRetryRoutes(page: Page) {
  let retryPosts = 0;
  let listedCanvasId = "default";
  await page.route("**/api/generation-tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/generation-tasks"
    ) {
      const canvasId = url.searchParams.get("canvasId") ?? "default";
      listedCanvasId = canvasId;
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [panelRetryTask(canvasId)] },
        status: 200,
      });
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === `/api/generation-tasks/${PANEL_RETRY_TASK_ID}`
    ) {
      await route.fulfill({
        contentType: "application/json",
        json: panelRetryTask(listedCanvasId),
        status: 200,
      });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname ===
        `/api/generation-tasks/${PANEL_RETRY_TASK_ID}/retry`
    ) {
      retryPosts += 1;
      await route.fulfill({
        contentType: "application/json",
        json: {
          ...panelRetryTask(listedCanvasId),
          retryAllowed: false,
          state: "retrying",
          updatedAt: "2026-08-09T00:00:02.000Z",
        },
        status: 202,
      });
      return;
    }
    await route.fallback();
  });
  return () => retryPosts;
}

async function installControllableBroadcastChannel(page: Page) {
  await page.addInitScript(() => {
    type MessageListener = (event: MessageEvent) => void;
    const instances = new Set<{
      listeners: Set<MessageListener>;
      name: string;
    }>();
    class ControlledBroadcastChannel {
      listeners = new Set<MessageListener>();
      name: string;

      constructor(name: string) {
        this.name = name;
        instances.add(this);
      }

      addEventListener(_type: string, listener: MessageListener) {
        this.listeners.add(listener);
      }

      close() {
        instances.delete(this);
      }

      postMessage(data: unknown) {
        for (const instance of instances) {
          if (instance !== this && instance.name === this.name) {
            const event = new MessageEvent("message", { data });
            instance.listeners.forEach((listener) => listener(event));
          }
        }
      }

      removeEventListener(_type: string, listener: MessageListener) {
        this.listeners.delete(listener);
      }
    }
    (window as typeof window & {
      __m86EmitCanvasSave?: (revision: number) => number;
    }).__m86EmitCanvasSave = (revision) => {
      let delivered = 0;
      for (const instance of instances) {
        const event = new MessageEvent("message", {
          data: {
            canvasId: "node.text.empty",
            instanceId: "m86-other-tab",
            revision,
            type: "saved",
          },
        });
        instance.listeners.forEach((listener) => {
          delivered += 1;
          listener(event);
        });
      }
      return delivered;
    };
    window.BroadcastChannel = ControlledBroadcastChannel as unknown as
      typeof BroadcastChannel;
  });
}

async function emitExternalCanvasSave(page: Page, revision: number) {
  return page.evaluate((nextRevision) =>
    (window as typeof window & {
      __m86EmitCanvasSave: (revision: number) => number;
    }).__m86EmitCanvasSave(nextRevision), revision);
}

function textDocumentWithData(
  title: string,
  revision: number,
  data: Record<string, unknown>,
  loadToken = LOAD_TOKEN_A,
) {
  const document = textDocument(title, revision, loadToken);
  return {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      data: { ...node.data, ...data },
      selected: true,
    })),
  };
}

async function dispatchEditorInputAndRelease(
  locator: Locator,
  value: string,
  releasePath: string,
) {
  await locator.evaluate((element, payload) => {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    input.addEventListener("input", () => {
      void fetch(payload.releasePath);
    }, { capture: true, once: true });
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    valueSetter?.call(input, payload.value);
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: payload.value,
      inputType: "insertText",
    }));
  }, { releasePath, value });
}

async function runNormalHighWaterFieldRace({
  assertSaved,
  baselineDocument,
  canvasId,
  initialDocument,
  openEditor,
  page,
  readField,
  releasePath,
}: {
  assertSaved?: (body: Record<string, unknown>) => void;
  baselineDocument: ReturnType<typeof textDocumentWithData>;
  canvasId: string;
  initialDocument: ReturnType<typeof textDocumentWithData>;
  openEditor: (page: Page) => Promise<Locator>;
  page: Page;
  readField: (body: Record<string, unknown>) => unknown;
  releasePath: string;
}) {
  let releaseOldSave!: () => void;
  const heldOldSave = new Promise<void>((resolve) => {
    releaseOldSave = resolve;
  });
  let serverDocument = initialDocument;
  let baselineGets = 0;
  const puts: Array<Record<string, unknown>> = [];
  await page.route(`**${releasePath}`, async (route) => {
    releaseOldSave();
    await route.fulfill({ status: 204 });
  });
  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() === "GET") {
      if (serverDocument.revision === 2) baselineGets += 1;
      await route.fulfill({
        body: JSON.stringify(serverDocument),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    if (body.saveSequence === 1) {
      await heldOldSave;
      await route.fulfill({
        body: JSON.stringify({
          code: "CANVAS_SAVE_SUPERSEDED",
          currentGraphRevision: 2,
          currentRevision: 2,
          currentWriterSequence: 1,
          currentWriterSessionId: "other-tab",
          error: "B committed while the first normal save was pending",
          rejectedAttemptId: body.saveAttemptId,
          rejectedSequence: 1,
          rejectedSessionId: body.saveSessionId,
          sessionHighWaterAttemptId: body.saveAttemptId,
          sessionHighWaterSequence: 1,
        }),
        contentType: "application/json",
        status: 409,
      });
      return;
    }
    serverDocument = {
      ...serverDocument,
      edges: body.edges as typeof serverDocument.edges,
      graphRevision: 3,
      loadToken: LOAD_TOKEN_C,
      nodes: body.nodes as typeof serverDocument.nodes,
      revision: 3,
      viewport: body.viewport as typeof serverDocument.viewport,
    };
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 3,
        loadToken: LOAD_TOKEN_C,
        revision: 3,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/__fixture/${canvasId}?custom-parameter=1`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  const editor = await openEditor(page);
  await editor.fill("A2");
  await expect.poll(() => puts.some((body) => body.saveSequence === 1)).toBe(true);
  serverDocument = baselineDocument;
  await dispatchEditorInputAndRelease(editor, "A3", releasePath);

  await expect.poll(() => puts.some((body) =>
    body.observedRevision === 2 &&
    body.observedLoadToken === LOAD_TOKEN_B &&
    readField(body) === "A3",
  )).toBe(true);
  const a3 = puts.find((body) =>
    body.observedRevision === 2 &&
    body.observedLoadToken === LOAD_TOKEN_B &&
    readField(body) === "A3",
  )!;
  expect(Number(a3.saveSequence)).toBeGreaterThan(
    Number(puts[0].saveSequence),
  );
  expect(a3.saveAttemptId).not.toBe(puts[0].saveAttemptId);
  expect(a3.observedRevision).toBe(2);
  expect(a3.observedLoadToken).toBe(LOAD_TOKEN_B);
  expect(readField(a3)).toBe("A3");
  assertSaved?.(a3);
  expect(baselineGets).toBeGreaterThan(0);
  expect(readField({ nodes: serverDocument.nodes })).toBe("A3");
  await expect(editor).toHaveValue("A3");
}

for (const phase of ["initial", "external"] as const) {
  for (const delayedPart of ["headers", "body"] as const) {
    test(`six-second ${phase} Canvas ${delayedPart} read succeeds without extra writes or retries`, async ({ page }) => {
      const canvasId = "node.text.empty";
      await page.clock.install();
      await installControllableBroadcastChannel(page);
      await page.addInitScript(({ canvasId, initial, later, phase, delayedPart }) => {
        const state = { delayed: phase === "initial", gets: 0, waits: 0, writes: 0, saved: [] as Array<Record<string, unknown>> };
        (window as typeof window & { __m86SlowRead: typeof state }).__m86SlowRead = state;
        const originalFetch = window.fetch.bind(window);
        window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(input instanceof Request ? input.url : String(input), location.href);
          const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
          if (method !== "GET" && /^\/api\/(canvas|canvases|workflow-runs|generation-tasks)(\/|$)/.test(url.pathname)) {
            state.writes += 1;
          }
          if (url.pathname === `/api/canvas/${canvasId}` && method === "PUT" && phase === "external") {
            state.saved.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return new Response(JSON.stringify({ graphRevision: 3, loadToken: "33333333-3333-4333-8333-333333333333", revision: 3 }), {
              headers: { "Content-Type": "application/json" }, status: 200,
            });
          }
          if (url.pathname !== `/api/canvas/${canvasId}` || method !== "GET") return originalFetch(input, init);
          state.gets += 1;
          const delayed = state.delayed;
          const body = phase === "external" && delayed ? later : initial;
          const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 6_000));
          if (delayed) state.waits += 1;
          if (delayed && delayedPart === "headers") await wait();
          const response = new Response(JSON.stringify(body), {
            headers: { "Content-Type": "application/json" }, status: 200,
          });
          if (delayed && delayedPart === "body") {
            Object.defineProperty(response, "json", { value: async () => { await wait(); return body; } });
          }
          return response;
        }) as typeof window.fetch;
      }, { canvasId, initial: textDocument("A1", 1), later: textDocument("B1", 2, LOAD_TOKEN_B), phase, delayedPart });
      await page.goto(`/__fixture/${canvasId}`);
      const world = page.getByTestId("canvas-world");
      if (phase === "external") {
        await expect(world).toHaveAttribute("data-persistence-state", "ready");
        await page.locator('.react-flow__node[data-id="text-primary"]').click();
        await pauseBrowserClock(page);
        await page.getByTestId("canvas-node-title").fill("A2");
        await page.getByTestId("canvas-node-title").press("Enter");
        await flushBrowserTasks(page);
        await page.evaluate(() => { (window as typeof window & { __m86SlowRead: { delayed: boolean } }).__m86SlowRead.delayed = true; });
        expect(await emitExternalCanvasSave(page, 2)).toBeGreaterThan(0);
      }
      await expect.poll(() => page.evaluate(() =>
        (window as typeof window & { __m86SlowRead: { waits: number } }).__m86SlowRead.waits)).toBeGreaterThan(0);
      await flushBrowserTasks(page);
      await page.clock.fastForward(3_100);
      await expect(world).toHaveAttribute("data-persistence-state", "loading");
      expect(await page.evaluate(() =>
        (window as typeof window & { __m86SlowRead: { writes: number } }).__m86SlowRead.writes)).toBe(0);
      const getsBeforeReady = await page.evaluate(() =>
        (window as typeof window & { __m86SlowRead: { gets: number } }).__m86SlowRead.gets);
      await page.clock.fastForward(3_100);
      await expect(world).toHaveAttribute("data-persistence-state", "ready");
      await page.clock.fastForward(30_100);
      await expect(world).toHaveAttribute("data-persistence-state", "ready");
      const counts = await page.evaluate(() =>
        (window as typeof window & { __m86SlowRead: { gets: number; writes: number; saved: Array<Record<string, unknown>> } }).__m86SlowRead);
      expect(counts.gets).toBe(getsBeforeReady);
      expect(counts.writes).toBe(phase === "initial" ? 0 : 1);
      if (phase === "external") {
        expect(counts.saved).toHaveLength(1);
        expect(counts.saved[0].observedRevision).toBe(2);
        expect(counts.saved[0].nodes).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: "text-primary", data: expect.objectContaining({ title: "A2" }) }),
        ]));
      }
    });
  }
}

test("GET 500 stays fail-closed with zero canvas PUT and zero generation", async ({
  page,
}) => {
  let canvasGetCount = 0;
  let canvasPutCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route(
    "**/api/canvas/persistence.final-clean-canvas",
    async (route) => {
      if (route.request().method() === "GET") {
        canvasGetCount += 1;
        await route.fulfill({
          body: JSON.stringify({ code: "TEST_FAILURE", error: "offline" }),
          contentType: "application/json",
          status: 500,
        });
        return;
      }
      canvasPutCount += 1;
      await route.fulfill({ status: 500 });
    },
  );

  await page.goto("/__fixture/persistence.final-clean-canvas");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  await expect(world).toHaveAttribute("data-persistence-ready", "false");
  await expect(page.getByTestId("canvas-load-state")).toContainText(
    "没有打开空白画布，也没有保存或生成",
  );
  await expect(page.getByTestId("save-status")).toHaveText("画布加载失败");
  await expect(page.getByTestId("title-input")).toBeDisabled();
  await expect(page.getByTestId("add-node")).toBeDisabled();
  await expect(page.getByTestId("empty-quick-actions")).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  expect(canvasPutCount).toBe(0);
  expect(generationPosts()).toBe(0);

  const getsBeforeRetry = canvasGetCount;
  await page.getByTestId("canvas-load-retry").click();
  await expect.poll(() => canvasGetCount).toBeGreaterThan(getsBeforeRetry);
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  expect(canvasPutCount).toBe(0);
  expect(generationPosts()).toBe(0);
});

test("GET graphRevision ahead of revision fails closed without clearing its journal", async ({
  page,
}) => {
  const canvasId = "node.text.empty";
  const pendingPayload = canvasSavePayload({ canvasTitle: "A2" });
  await seedCanvasSaveSession(page, canvasId, {
    confirmedSequence: 0,
    pendingPagehide: {
      attemptId: SAVE_ATTEMPT_A,
      payload: pendingPayload,
      saveSequence: 1,
      serverEpoch: SAVE_EPOCH_A,
    },
    saveSequence: 1,
    saveSessionId: SAVE_SESSION_A,
    serverEpoch: SAVE_EPOCH_A,
    storageRevision: 0,
  });
  let putCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({
          ...textDocument("A1", 1),
          graphRevision: 2,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    putCount += 1;
    await route.fulfill({ status: 500 });
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "failed",
  );
  expect(putCount).toBe(0);
  const stored = await readCanvasSaveSession(page, canvasId);
  expect(stored?.confirmedSequence).toBe(0);
  expect(stored?.saveSequence).toBe(1);
  expect(stored?.pendingPagehide).toEqual({
    attemptId: SAVE_ATTEMPT_A,
    payload: pendingPayload,
    saveSequence: 1,
    serverEpoch: SAVE_EPOCH_A,
  });
  expect(generationPosts()).toBe(0);
});

for (const unavailableLoad of ["GET 500", "hung GET"] as const) {
  test(`real /canvas GenerationTasksPanel retry stays closed during ${unavailableLoad}`, async ({
    page,
  }) => {
    if (unavailableLoad === "hung GET") {
      await page.addInitScript(() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
          const raw = typeof input === "string" || input instanceof URL
            ? String(input)
            : input.url;
          const url = new URL(raw, window.location.href);
          const method = (init?.method ??
            (input instanceof Request ? input.method : "GET")).toUpperCase();
          if (method === "GET" && url.pathname === "/api/canvas/default") {
            return new Promise<Response>((_resolve, reject) => {
              const abort = () =>
                reject(new DOMException("Aborted", "AbortError"));
              if (init?.signal?.aborted) abort();
              else init?.signal?.addEventListener("abort", abort, { once: true });
            });
          }
          return originalFetch(input, init);
        }) as typeof window.fetch;
      });
    } else {
      await page.route("**/api/canvas/default", async (route) => {
        await route.fulfill({
          body: JSON.stringify({ code: "TEST_500", error: "offline" }),
          contentType: "application/json",
          status: 500,
        });
      });
    }
    const retryPosts = await installPanelRetryRoutes(page);
    const generationPosts = generationPostCount(page);

    await page.goto("/canvas");
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute(
      "data-persistence-state",
      unavailableLoad === "GET 500" ? "failed" : "loading",
    );
    await page.getByTestId("tasks").click();
    const retry = page.getByTestId(`tasks-retry-${PANEL_RETRY_TASK_ID}`);
    await expect(retry).toBeVisible();
    await expect(retry).toBeDisabled();
    await retry.evaluate((button) => (button as HTMLButtonElement).click());
    await flushBrowserTasks(page);
    expect(retryPosts()).toBe(0);
    expect(generationPosts()).toBe(0);
  });
}

test("real /canvas GenerationTasksPanel retry waits for a dirty save and LOAD_REQUIRED sends zero POST", async ({
  page,
}) => {
  let releaseSave!: () => void;
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(textDocument("A1", 1)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    await heldSave;
    await route.fulfill({
      body: JSON.stringify({
        code: "CANVAS_LOAD_REQUIRED",
        error: "Reload the canvas baseline",
      }),
      contentType: "application/json",
      status: 409,
    });
  });
  const retryPosts = await installPanelRetryRoutes(page);
  const generationPosts = generationPostCount(page);

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.getByTestId("canvas-node-title").fill("A2-dirty-gate");
  await expect.poll(() => puts.length).toBe(1);
  await page.getByTestId("tasks").click();
  const retry = page.getByTestId(`tasks-retry-${PANEL_RETRY_TASK_ID}`);
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(retry).toBeDisabled();
  expect(retryPosts()).toBe(0);

  releaseSave();
  await expect(page.getByTestId("save-status")).toHaveText("保存失败");
  await expect(retry).toBeDisabled();
  await flushBrowserTasks(page);
  expect(retryPosts()).toBe(0);
  expect(generationPosts()).toBe(0);
});

test("real /canvas GenerationTasksPanel clean retry sends exactly one POST after the gate", async ({
  page,
}) => {
  await page.route("**/api/canvas/default", async (route) => {
    await route.fulfill({
      body: JSON.stringify(textDocument("A1", 1)),
      contentType: "application/json",
      status: 200,
    });
  });
  const retryPosts = await installPanelRetryRoutes(page);
  const generationPosts = generationPostCount(page);

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.getByTestId("tasks").click();
  const retry = page.getByTestId(`tasks-retry-${PANEL_RETRY_TASK_ID}`);
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => retryPosts()).toBe(1);
  await flushBrowserTasks(page);
  expect(retryPosts()).toBe(1);
  expect(generationPosts()).toBe(1);
});

test("GenerationTasksPanel surfaces a detached retry and emits no accepted wakeup", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const target = window as typeof window & { __m86RetryWakeups?: unknown[] };
    target.__m86RetryWakeups = [];
    window.addEventListener(
      "unboundry:generation-task-retry-accepted",
      (event) => target.__m86RetryWakeups?.push(
        (event as CustomEvent<unknown>).detail,
      ),
    );
  });
  await page.route("**/api/canvas/default", async (route) => {
    await route.fulfill({
      body: JSON.stringify(textDocument("A1", 1)),
      contentType: "application/json",
      status: 200,
    });
  });
  let retryPosts = 0;
  let retryBody: Record<string, unknown> | undefined;
  let providerRequests = 0;
  page.on("request", (request) => {
    if (/openrouter|volcengine|mureka/i.test(request.url())) providerRequests += 1;
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/generation-tasks"
    ) {
      await route.fulfill({
        json: { tasks: [panelRetryTask("default")] },
        status: 200,
      });
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === `/api/generation-tasks/${PANEL_RETRY_TASK_ID}`
    ) {
      await route.fulfill({ json: panelRetryTask("default"), status: 200 });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname === `/api/generation-tasks/${PANEL_RETRY_TASK_ID}/retry`
    ) {
      retryPosts += 1;
      retryBody = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          code: "RETRY_BINDING_STALE",
          error: "任务已不再绑定当前节点输入，请从节点重新提交",
        },
        status: 409,
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.getByTestId("tasks").click();
  const retry = page.getByTestId(`tasks-retry-${PANEL_RETRY_TASK_ID}`);
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => retryPosts).toBe(1);
  await expect(page.getByTestId("tasks-panel").getByRole("alert")).toContainText(
    "任务已不再绑定当前节点输入",
  );
  await expect(retry).toBeEnabled();
  expect(retryBody).toEqual({
    canvasId: "default",
    expectedAttempt: 1,
    expectedCanvasRevision: 1,
    expectedFixtureScopeId: "",
    expectedGenerationInputKey: PANEL_RETRY_INPUT_KEY,
    expectedGenerationOwnershipKey: PANEL_RETRY_OWNERSHIP_KEY,
    expectedModelConfigurationRevision: PANEL_RETRY_CONFIGURATION_REVISION,
    expectedModelInputContractFingerprint: "mic2:m86-panel-retry",
    expectedModelReleaseRevision: "00000000-0000-4000-8000-000000000086",
    expectedUpdatedAt: "2026-08-09T00:00:01.000Z",
    kind: "text",
    nodeId: "m86-panel-retry-node",
  });
  expect(await page.evaluate(() =>
    (window as typeof window & { __m86RetryWakeups?: unknown[] })
      .__m86RetryWakeups
  )).toEqual([]);
  expect(providerRequests).toBe(0);
});

test("real /canvas scope navigation while GenerationTasksPanel waits sends zero retry POST", async ({
  page,
}) => {
  page.on("dialog", (dialog) => {
    void dialog.accept();
  });
  let releaseOldSave!: () => void;
  const heldOldSave = new Promise<void>((resolve) => {
    releaseOldSave = resolve;
  });
  let oldPutCount = 0;
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(textDocument("A1", 1)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    oldPutCount += 1;
    await heldOldSave;
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 2,
        loadToken: LOAD_TOKEN_B,
        revision: 2,
      }),
      contentType: "application/json",
      status: 200,
    }).catch(() => undefined);
  });
  await page.route("**/api/canvas/m86-next-scope", async (route) => {
    await route.fulfill({
      body: JSON.stringify(textDocument("B1", 1)),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/project-title/m86-next-scope", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        title: "M86 next scope",
        updatedAt: Date.parse("2026-08-09T00:00:00.000Z"),
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  const retryPosts = await installPanelRetryRoutes(page);
  const generationPosts = generationPostCount(page);

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.getByTestId("canvas-node-title").fill("A2-scope-gate");
  await expect.poll(() => oldPutCount).toBe(1);
  await page.getByTestId("tasks").click();
  const retry = page.getByTestId(`tasks-retry-${PANEL_RETRY_TASK_ID}`);
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(retry).toBeDisabled();
  expect(retryPosts()).toBe(0);

  await page.goto("/canvas/m86-next-scope");
  releaseOldSave();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await flushBrowserTasks(page);
  expect(retryPosts()).toBe(0);
  expect(generationPosts()).toBe(0);
});

test("GenerationTasksPanel discards a late old-canvas list after scope navigation", async ({
  page,
}) => {
  const nextCanvasId = "m86-panel-next-scope";
  const oldActiveTaskId = "m86-panel-old-active-task";
  let cancelDeletes = 0;
  let holdOldPanelList = false;
  let markOldListStarted!: () => void;
  const oldListStarted = new Promise<void>((resolve) => {
    markOldListStarted = resolve;
  });
  let nextListReads = 0;
  let releaseOldList!: () => void;
  const oldListGate = new Promise<void>((resolve) => {
    releaseOldList = resolve;
  });
  let retryPosts = 0;

  await page.route("**/api/canvas/default", async (route) => {
    await route.fulfill({
      body: JSON.stringify(textDocument("A1", 1)),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/canvas/${nextCanvasId}`, async (route) => {
    await route.fulfill({
      body: JSON.stringify(textDocument("B1", 1)),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/project-title/${nextCanvasId}`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        title: "M86 panel next scope",
        updatedAt: Date.parse("2026-08-09T00:00:00.000Z"),
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/generation-tasks"
    ) {
      const canvasId = url.searchParams.get("canvasId") ?? "default";
      if (canvasId === nextCanvasId) {
        nextListReads += 1;
        await route.fulfill({
          json: {
            tasks: [
              panelRetryTask("default"),
              {
                ...panelRetryTask("default"),
                errorCode: undefined,
                errorMessage: undefined,
                id: oldActiveTaskId,
                retryAllowed: false,
                state: "running",
              },
            ],
          },
          status: 200,
        });
        return;
      }
      if (!holdOldPanelList) {
        await route.fulfill({ json: { tasks: [] }, status: 200 });
        return;
      }
      markOldListStarted();
      await oldListGate;
      await route.fulfill({
        json: {
          tasks: [
            panelRetryTask("default"),
            {
              ...panelRetryTask("default"),
              errorCode: undefined,
              errorMessage: undefined,
              id: oldActiveTaskId,
              retryAllowed: false,
              state: "running",
            },
          ],
        },
        status: 200,
      }).catch(() => undefined);
      return;
    }
    if (request.method() === "DELETE") {
      cancelDeletes += 1;
      await route.fulfill({ json: { state: "cancelled" }, status: 200 });
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/retry")) {
      retryPosts += 1;
      await route.fulfill({ json: { state: "retrying" }, status: 202 });
      return;
    }
    await route.fallback();
  });

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  holdOldPanelList = true;
  await page.getByTestId("tasks").click();
  await oldListStarted;
  await expect(page.getByTestId("tasks-panel")).toContainText(
    "正在读取生成任务",
  );

  const scopeChanged = page.waitForURL(`**/canvas/${nextCanvasId}`, {
    waitUntil: "commit",
  });
  const navigation = page.goto(`/canvas/${nextCanvasId}`);
  await scopeChanged;
  releaseOldList();
  await navigation;
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.getByTestId("tasks").click();
  await expect.poll(() => nextListReads).toBeGreaterThanOrEqual(1);
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  await expect(page.getByTestId(`tasks-row-${PANEL_RETRY_TASK_ID}`))
    .toHaveCount(0);
  await expect(page.getByTestId(`tasks-row-${oldActiveTaskId}`)).toHaveCount(0);
  await expect(page.getByTestId("tasks-empty")).toBeVisible();
  expect(cancelDeletes).toBe(0);
  expect(retryPosts).toBe(0);
});

test("session storage denial keeps the canvas read-only with zero PUT and generation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key.startsWith("unboundry:canvas-save-session:v2:")) {
        throw new DOMException("Storage denied", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
  });
  let getCount = 0;
  let putCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      getCount += 1;
      await route.fulfill({
        body: JSON.stringify(textDocument("A1", 1)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    putCount += 1;
    await route.fulfill({ status: 500 });
  });

  await page.goto("/__fixture/node.text.empty");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  await expect(world).toHaveAttribute("data-persistence-ready", "false");
  await expect(page.getByTestId("save-status")).toHaveText("画布加载失败");
  expect(getCount).toBe(0);
  expect(putCount).toBe(0);
  expect(generationPosts()).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  expect(putCount).toBe(0);
  expect(generationPosts()).toBe(0);
});

for (const corruption of ["empty-index", "empty-scope"] as const) {
  test(`empty canvas session storage (${corruption}) fails closed before loading`, async ({
    page,
  }) => {
    await page.addInitScript((kind) => {
      const prefix = "unboundry:canvas-save-session:v2:";
      const scope = JSON.stringify(["__test__", "node.text.empty"]);
      if (kind === "empty-index") {
        window.sessionStorage.setItem(`${prefix}scopes`, "");
      } else {
        window.sessionStorage.setItem(`${prefix}scopes`, JSON.stringify([scope]));
        window.sessionStorage.setItem(`${prefix}${scope}`, "");
      }
    }, corruption);
    let getCount = 0;
    let putCount = 0;
    await page.route("**/api/canvas/node.text.empty", async (route) => {
      if (route.request().method() === "GET") getCount += 1;
      else putCount += 1;
      await route.fulfill({ status: 500 });
    });

    await page.goto("/__fixture/node.text.empty");
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-state",
      "failed",
    );
    await expect(page.getByTestId("save-status")).toHaveText(
      "画布加载失败",
    );
    expect(getCount).toBe(0);
    expect(putCount).toBe(0);
  });
}

test("hung GET times out, retry starts with GET, and revision zero is observed", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(({ document, loadToken }) => {
    const state = {
      allowSuccess: false,
      bodies: [] as Array<Record<string, unknown>>,
      generationPosts: 0,
      methods: [] as string[],
    };
    (window as typeof window & { __m86Load?: typeof state }).__m86Load = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "POST" &&
        url.pathname.startsWith("/api/generation-tasks")
      ) {
        state.generationPosts += 1;
      }
      if (url.pathname === "/api/canvas/persistence.final-clean-canvas") {
        state.methods.push(method);
        if (method === "GET" && !state.allowSuccess) {
          return new Promise<Response>((_resolve, reject) => {
            const rejectAbort = () =>
              reject(new DOMException("Timed out", "AbortError"));
            if (init?.signal?.aborted) rejectAbort();
            else init?.signal?.addEventListener("abort", rejectAbort, { once: true });
          });
        }
        if (method === "GET") {
          return Promise.resolve(new Response(JSON.stringify(document), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }));
        }
        if (method === "PUT") {
          state.bodies.push(JSON.parse(String(init?.body ?? "{}")));
          return Promise.resolve(new Response(JSON.stringify({
            graphRevision: 1,
            loadToken,
            revision: 1,
          }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }));
        }
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, { document: emptyDocument, loadToken: LOAD_TOKEN_B });

  await page.goto("/__fixture/persistence.final-clean-canvas");
  const world = page.getByTestId("canvas-world");
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __m86Load: { methods: string[] } }).__m86Load.methods.length)).toBeGreaterThan(0);
  await page.clock.fastForward(30_100);
  await expect(world).toHaveAttribute("data-persistence-state", "failed", {
    timeout: 5_000,
  });
  const initialMethods = await page.evaluate(() =>
    (window as typeof window & { __m86Load: { methods: string[] } })
      .__m86Load.methods,
  );
  expect(initialMethods.length).toBeGreaterThan(0);
  expect(initialMethods.every((method) => method === "GET")).toBe(true);

  const getsBeforeRetry = initialMethods.length;
  await page.evaluate(() => {
    (window as typeof window & { __m86Load: { allowSuccess: boolean } })
      .__m86Load.allowSuccess = true;
  });
  await page.getByTestId("canvas-load-retry").click();
  await expect(world).toHaveAttribute("data-persistence-state", "ready");
  const retryMethods = await page.evaluate(() =>
    (window as typeof window & { __m86Load: { methods: string[] } })
      .__m86Load.methods,
  );
  expect(retryMethods.filter((method) => method === "GET").length)
    .toBeGreaterThan(getsBeforeRetry);
  expect(retryMethods.includes("PUT")).toBe(false);

  await page.getByTestId("quick-text-video").click();
  await expect.poll(async () => page.evaluate(() =>
    (window as typeof window & { __m86Load: { bodies: unknown[] } })
      .__m86Load.bodies.length,
  )).toBe(1);
  const result = await page.evaluate(() =>
    (window as typeof window & {
      __m86Load: {
        bodies: Array<Record<string, unknown>>;
        allowSuccess: boolean;
        generationPosts: number;
        methods: string[];
      };
    }).__m86Load,
  );
  expect(result.methods.at(-1)).toBe("PUT");
  expect(result.bodies[0].observedRevision).toBe(0);
  expect(result.bodies[0].observedLoadToken).toBe(LOAD_TOKEN_A);
  expect(result.generationPosts).toBe(0);
});

test("navigating to a new canvas starts closed and ignores the old GET", async ({
  page,
}) => {
  let releaseOldGet!: () => void;
  const oldGet = new Promise<void>((resolve) => {
    releaseOldGet = resolve;
  });
  let settleOldResponse!: () => void;
  const oldResponseSettled = new Promise<void>((resolve) => {
    settleOldResponse = resolve;
  });
  let releaseNewGet!: () => void;
  const newGet = new Promise<void>((resolve) => {
    releaseNewGet = resolve;
  });
  let oldGetActive = 0;
  let newGetActive = 0;
  let putCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() !== "GET") {
      putCount += 1;
      await route.fulfill({ status: 500 });
      return;
    }
    oldGetActive += 1;
    await oldGet;
    try {
      await route.fulfill({
        body: JSON.stringify(textDocument("old-scope", 9)),
        contentType: "application/json",
        status: 200,
      });
    } catch {
      // The old document may already have been canceled by navigation.
    } finally {
      oldGetActive -= 1;
      if (oldGetActive === 0) settleOldResponse();
    }
  });
  await page.route(
    "**/api/canvas/persistence.final-clean-canvas",
    async (route) => {
      if (route.request().method() !== "GET") {
        putCount += 1;
        await route.fulfill({ status: 500 });
        return;
      }
      newGetActive += 1;
      await newGet;
      try {
        await route.fulfill({
          body: JSON.stringify(emptyDocument),
          contentType: "application/json",
          status: 200,
        });
      } finally {
        newGetActive -= 1;
      }
    },
  );

  await page.goto("/__fixture/node.text.empty");
  await expect.poll(() => oldGetActive).toBeGreaterThan(0);
  await page.goto("/__fixture/persistence.final-clean-canvas");
  await expect.poll(() => newGetActive).toBeGreaterThan(0);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-state", "loading");
  await expect(world).toHaveAttribute("data-persistence-ready", "false");
  await expect(page.getByTestId("title-input")).toBeDisabled();
  await expect(page.getByTestId("empty-quick-actions")).toHaveCount(0);
  expect(putCount).toBe(0);

  releaseOldGet();
  await oldResponseSettled;
  await expect(page.locator('.react-flow__node[data-id="text-primary"]')).toHaveCount(0);
  expect(putCount).toBe(0);
  releaseNewGet();
  await expect(world).toHaveAttribute("data-persistence-state", "ready");
  await expect(page.locator('.react-flow__node[data-id="text-primary"]')).toHaveCount(0);
  expect(putCount).toBe(0);
  expect(generationPosts()).toBe(0);
});

test("a real project route treats project 404 as missing without creating or generating", async ({
  page,
}) => {
  let canvasGetCount = 0;
  let canvasPutCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/m86-project-missing", async (route) => {
    if (route.request().method() === "GET") {
      canvasGetCount += 1;
      await route.fulfill({
        body: JSON.stringify({
          ...emptyFence,
          code: "CANVAS_NOT_FOUND",
          error: "Project not found",
        }),
        contentType: "application/json",
        status: 404,
      });
      return;
    }
    canvasPutCount += 1;
    await route.fulfill({ status: 500 });
  });

  await page.goto("/canvas/m86-project-missing");
  await expect.poll(() => canvasGetCount).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/canvas\/projects$/);
  await expect(page.getByTestId("workspace-page")).toBeVisible();
  await expect(page.getByTestId("canvas-world")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(canvasPutCount).toBe(0);
  expect(generationPosts()).toBe(0);
});

test("LOAD_REQUIRED never retries PUT and keeps the newer visible draft", async ({
  page,
}) => {
  await page.clock.install();
  let releaseSave!: () => void;
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let putCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(textDocument("A1", 7)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    putCount += 1;
    await heldSave;
    await route.fulfill({
      body: JSON.stringify({
        code: "CANVAS_LOAD_REQUIRED",
        error: "Reload required",
      }),
      contentType: "application/json",
      status: 409,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("A2");
  await expect.poll(() => putCount).toBe(1);
  await title.fill("A4-newer-draft");
  releaseSave();

  await expect(page.getByTestId("save-status")).toHaveText("保存失败");
  await expect(title).toHaveValue("A4-newer-draft");
  await page.clock.fastForward(31_000);
  expect(putCount).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  expect(putCount).toBe(1);
  expect(generationPosts()).toBe(0);
});

test("save-session capacity is terminal and keeps the latest draft", async ({
  page,
}) => {
  await page.clock.install();
  let releaseSave!: () => void;
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let putCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(textDocument("A1", 7)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    putCount += 1;
    await heldSave;
    await route.fulfill({
      body: JSON.stringify({
        code: "CANVAS_SAVE_SESSION_CAPACITY",
        error: "Too many canvas save sessions",
      }),
      contentType: "application/json",
      status: 503,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("A2");
  await expect.poll(() => putCount).toBe(1);
  await title.fill("A4-kept-at-capacity");
  releaseSave();

  await expect(page.getByTestId("save-status")).toHaveText("保存失败");
  await expect(title).toHaveValue("A4-kept-at-capacity");
  await page.clock.fastForward(31_000);
  expect(putCount).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  expect(putCount).toBe(1);
  expect(generationPosts()).toBe(0);
});

async function runBroadcastDuringTransientSave(page: Page, withA4: boolean) {
  await installControllableBroadcastChannel(page);
  let releaseSave!: () => void;
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let serverTitle = "A1";
  let serverRevision = 1;
  let serverLoadToken = LOAD_TOKEN_A;
  let bBaselineGets = 0;
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      if (serverTitle === "B1") bBaselineGets += 1;
      await route.fulfill({
        body: JSON.stringify(
          textDocument(serverTitle, serverRevision, serverLoadToken),
        ),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    if (puts.length === 1) {
      await heldSave;
      await route.fulfill({ status: 500 });
      return;
    }
    const title = (body.nodes as Array<{
      data?: { title?: string };
      id?: string;
    }>).find((node) => node.id === "text-primary")?.data?.title;
    serverTitle = title ?? "missing-title";
    serverRevision = 4;
    serverLoadToken = LOAD_TOKEN_D;
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 4,
        loadToken: LOAD_TOKEN_D,
        revision: 4,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("A2");
  await expect.poll(() => puts.length).toBe(1);

  serverTitle = "B1";
  serverRevision = 3;
  serverLoadToken = LOAD_TOKEN_B;
  expect(await emitExternalCanvasSave(page, 3)).toBeGreaterThan(0);
  if (withA4) await title.fill("A4");
  releaseSave();

  await expect.poll(() => bBaselineGets).toBeGreaterThan(0);
  if (withA4) {
    await expect.poll(() => puts.length).toBe(2);
    const a4 = puts[1];
    expect(Number(a4.saveSequence)).toBeGreaterThan(
      Number(puts[0].saveSequence),
    );
    expect(a4.saveAttemptId).not.toBe(puts[0].saveAttemptId);
    expect(a4.observedRevision).toBe(3);
    expect(a4.observedLoadToken).toBe(LOAD_TOKEN_B);
    expect((a4.nodes as Array<{ data?: { title?: string }; id?: string }>))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ title: "A4" }),
          id: "text-primary",
        }),
      ]));
    expect(serverTitle).toBe("A4");
    await expect(title).toHaveValue("A4");
  } else {
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-state",
      "ready",
    );
    await page.locator('.react-flow__node[data-id="text-primary"]').click();
    await expect(page.getByTestId("canvas-node-title")).toHaveValue("B1");
    expect(puts).toHaveLength(1);
  }
}

test("B broadcast during a transient A2 save reloads B when there is no A4", async ({
  page,
}) => {
  await runBroadcastDuringTransientSave(page, false);
});

test("B broadcast during a transient A2 save rebases and saves only A4", async ({
  page,
}) => {
  await runBroadcastDuringTransientSave(page, true);
});

test("a lost response retries the identical save before converging to B", async ({
  page,
}) => {
  let serverTitle = "A1";
  let serverRevision = 1;
  let serverLoadToken = LOAD_TOKEN_A;
  let bBaselineGets = 0;
  let committedPayload = "";
  const payloads: string[] = [];
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      if (serverTitle === "B1") bBaselineGets += 1;
      await route.fulfill({
        body: JSON.stringify(
          textDocument(serverTitle, serverRevision, serverLoadToken),
        ),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const payload = route.request().postData() ?? "";
    const body = JSON.parse(payload) as Record<string, unknown>;
    payloads.push(payload);
    if (payloads.length === 1) {
      committedPayload = payload;
      serverTitle = "A2";
      serverRevision = 2;
      serverLoadToken = LOAD_TOKEN_C;
      // The first write committed, its response was lost, then B became the
      // current writer before the client retried the exact same attempt.
      serverTitle = "B1";
      serverRevision = 3;
      serverLoadToken = LOAD_TOKEN_B;
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        code: "CANVAS_SAVE_SUPERSEDED",
        currentGraphRevision: 3,
        currentRevision: 3,
        currentWriterSequence: 1,
        currentWriterSessionId: "other-tab",
        error: "The committed response was lost before B wrote",
        rejectedAttemptId: body.saveAttemptId,
        rejectedSequence: body.saveSequence,
        rejectedSessionId: body.saveSessionId,
        sessionHighWaterAttemptId: body.saveAttemptId,
        sessionHighWaterSequence: 1,
      }),
      contentType: "application/json",
      status: 409,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.getByTestId("canvas-node-title").fill("A2");

  await expect.poll(() => payloads.length, { timeout: 5_000 }).toBe(2);
  expect(payloads[1]).toBe(payloads[0]);
  expect(committedPayload).toBe(payloads[0]);
  expect(JSON.parse(payloads[1]).saveSequence).toBe(1);
  expect(JSON.parse(payloads[1]).observedLoadToken).toBe(LOAD_TOKEN_A);
  await expect.poll(() => bBaselineGets).toBeGreaterThan(0);
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await expect(page.getByTestId("canvas-node-title")).toHaveValue("B1");
});

test("same-session SUPERSEDED binds only the known high-water fingerprint", async ({
  page,
}) => {
  let releaseOldSave!: () => void;
  const heldOldSave = new Promise<void>((resolve) => {
    releaseOldSave = resolve;
  });
  let canvasGetCount = 0;
  let serverDocument = textDocument("A1", 1);
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      canvasGetCount += 1;
      await route.fulfill({
        body: JSON.stringify(serverDocument),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    if (body.saveSequence === 1) {
      await heldOldSave;
      await route.fulfill({
        body: JSON.stringify({
          code: "CANVAS_SAVE_SUPERSEDED",
          currentGraphRevision: 2,
          currentRevision: 2,
          currentWriterSequence: 2,
          currentWriterSessionId: body.saveSessionId,
          error: "Older same-session response",
          rejectedAttemptId: body.saveAttemptId,
          rejectedSequence: 1,
          rejectedSessionId: body.saveSessionId,
          sessionHighWaterAttemptId: puts.find(
            (candidate) => candidate.saveSequence === 2,
          )?.saveAttemptId ?? null,
          sessionHighWaterSequence: 2,
        }),
        contentType: "application/json",
        status: 409,
      });
      return;
    }
    const revision = Number(body.saveSequence);
    const loadToken = loadTokenForRevision(revision);
    serverDocument = {
      ...serverDocument,
      currentWriterSequence: revision,
      currentWriterSessionId: body.saveSessionId as string,
      edges: body.edges as typeof serverDocument.edges,
      graphRevision: revision,
      loadToken,
      nodes: body.nodes as typeof serverDocument.nodes,
      revision,
      sessionHighWaterAttemptId: body.saveAttemptId as string,
      sessionHighWaterSequence: revision,
      viewport: body.viewport as typeof serverDocument.viewport,
    };
    if (body.saveSequence === 2) {
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: revision,
        loadToken,
        revision,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  const initialGetCount = canvasGetCount;
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("A2");
  await expect.poll(() => puts.some((body) => body.saveSequence === 1)).toBe(true);
  await title.fill("A3");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => puts.some((body) => body.saveSequence === 2)).toBe(true);
  const sameSessionHighWater = puts.find((body) => body.saveSequence === 2)!;
  expect(sameSessionHighWater.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A3" }),
      id: "text-primary",
    }),
  ]));
  // Release sequence 1 so its SUPERSEDED response can trigger the
  // same-session high-water GET that proves sequence 2.
  releaseOldSave();
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  expect(canvasGetCount).toBeGreaterThan(initialGetCount);

  const sequenceBeforeA4 = Math.max(
    2,
    ...puts.map((body) => Number(body.saveSequence)),
  );
  for (const body of puts.filter(
    (candidate) => Number(candidate.saveSequence) > 2,
  )) {
    expect(body.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({ title: "A3" }),
        id: "text-primary",
      }),
    ]));
  }
  await title.fill("A4");
  await expect.poll(() => puts.some((body) =>
    Array.isArray(body.nodes) && body.nodes.some((node) => {
      if (!node || typeof node !== "object") return false;
      const record = node as { data?: { title?: string }; id?: string };
      return record.id === "text-primary" && record.data?.title === "A4";
    }),
  )).toBe(true);
  const a4 = puts.find((body) =>
    Array.isArray(body.nodes) && body.nodes.some((node) => {
      if (!node || typeof node !== "object") return false;
      const record = node as { data?: { title?: string }; id?: string };
      return record.id === "text-primary" && record.data?.title === "A4";
    }),
  )!;
  expect(a4.saveSequence).toBe(sequenceBeforeA4 + 1);
  expect(a4.observedRevision).toBe(sequenceBeforeA4);
  expect(a4.observedLoadToken).toBe(
    loadTokenForRevision(sequenceBeforeA4),
  );
  expect(a4.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A4" }),
      id: "text-primary",
    }),
  ]));
});

test("a delayed normal 2xx cannot roll back a newer pagehide 2xx", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const state = {
      afterOldRelease: false,
      broadcastRevisions: [] as number[],
      resolvedResults: [] as Array<{
        graphRevision: unknown;
        loadToken: unknown;
        requestSequence: number;
        revision: unknown;
      }>,
      writesAfterOldRelease: 0,
    };
    (window as typeof window & { __m86OutOfOrder2xx?: typeof state })
      .__m86OutOfOrder2xx = state;

    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      const response = await originalFetch(input, init);
      if (
        method === "PUT" &&
        new URL(raw, window.location.href).pathname ===
          "/api/canvas/node.text.empty" &&
        typeof init?.body === "string"
      ) {
        const request = JSON.parse(init.body) as { saveSequence?: number };
        const recordResult = (result: {
          graphRevision?: unknown;
          loadToken?: unknown;
          revision?: unknown;
        }) => {
          state.resolvedResults.push({
            graphRevision: result.graphRevision,
            loadToken: result.loadToken,
            requestSequence: Number(request.saveSequence),
            revision: result.revision,
          });
        };
        const originalText = response.text.bind(response);
        response.text = async () => {
          const serialized = await originalText();
          const result = JSON.parse(serialized) as {
            graphRevision?: unknown;
            loadToken?: unknown;
            revision?: unknown;
          };
          recordResult(result);
          return serialized;
        };
        const originalJson = response.json.bind(response);
        response.json = async () => {
          const result = await originalJson() as {
            graphRevision?: unknown;
            loadToken?: unknown;
            revision?: unknown;
          };
          recordResult(result);
          return result;
        };
      }
      return response;
    }) as typeof window.fetch;

    const originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (
        state.afterOldRelease &&
        key.startsWith("unboundry:canvas-save-session:v2:") &&
        key !== "unboundry:canvas-save-session:v2:scopes"
      ) {
        state.writesAfterOldRelease += 1;
      }
      return originalStorageSet.call(this, key, value);
    };

    const originalBroadcast = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function postMessage(message) {
      if (
        message &&
        typeof message === "object" &&
        (message as { type?: unknown }).type === "saved" &&
        Number.isSafeInteger((message as { revision?: unknown }).revision)
      ) {
        state.broadcastRevisions.push(Number(
          (message as { revision: number }).revision,
        ));
      }
      return originalBroadcast.call(this, message);
    };
  });

  let releaseOldResponse!: () => void;
  const heldOldResponse = new Promise<void>((resolve) => {
    releaseOldResponse = resolve;
  });
  let serverDocument = textDocument("A1", 1);
  const puts: Array<Record<string, unknown>> = [];
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(serverDocument),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    const saveSequence = Number(body.saveSequence);
    const revision = saveSequence + 1;
    const loadToken = saveSequence === 1
      ? LOAD_TOKEN_C
      : saveSequence === 2
        ? LOAD_TOKEN_B
        : LOAD_TOKEN_D;
    serverDocument = {
      ...serverDocument,
      currentWriterSequence: saveSequence,
      currentWriterSessionId: String(body.saveSessionId),
      edges: body.edges as typeof serverDocument.edges,
      graphRevision: revision,
      loadToken,
      nodes: body.nodes as typeof serverDocument.nodes,
      revision,
      sessionHighWaterAttemptId: String(body.saveAttemptId),
      sessionHighWaterSequence: saveSequence,
      viewport: body.viewport as typeof serverDocument.viewport,
    };
    if (saveSequence === 1) {
      await heldOldResponse;
    } else {
      expect([2, 3]).toContain(saveSequence);
    }
    await route.fulfill({
      body: JSON.stringify({ graphRevision: revision, loadToken, revision }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await pauseBrowserClock(page);
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("A2-normal");
  await flushBrowserTasks(page);
  await page.clock.fastForward(600);
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].saveSequence).toBe(1);

  await title.fill("A3-pagehide");
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", {
      persisted: true,
    })));
  await expect.poll(() => puts.length).toBe(2);
  expect(puts.map((body) => body.saveSequence)).toEqual([1, 2]);
  expect(puts[1].saveAttemptId).not.toBe(puts[0].saveAttemptId);
  expect(puts[1].nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A3-pagehide" }),
      id: "text-primary",
    }),
  ]));
  const pagehideTextNode = (puts[1].nodes as Array<{
    data?: Record<string, unknown>;
    id?: string;
  }>).find((node) => node.id === "text-primary");
  expect(pagehideTextNode?.data).not.toHaveProperty("contentHtml");
  await expect.poll(async () => {
    const stored = await readCanvasSaveSession(page, "node.text.empty");
    return {
      confirmedSequence: stored?.confirmedSequence,
      pending: stored?.pendingPagehide,
      saveSequence: stored?.saveSequence,
    };
  }).toEqual({ confirmedSequence: 2, pending: undefined, saveSequence: 2 });
  const pagehideSession = await readCanvasSaveSession(
    page,
    "node.text.empty",
  );
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86OutOfOrder2xx: {
        resolvedResults: Array<{ requestSequence: number }>;
      };
    }).__m86OutOfOrder2xx.resolvedResults.map(
      (result) => result.requestSequence,
    ))).toEqual([2]);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  await page.evaluate(() => {
    (window as typeof window & {
      __m86OutOfOrder2xx: { afterOldRelease: boolean };
    }).__m86OutOfOrder2xx.afterOldRelease = true;
  });
  releaseOldResponse();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86OutOfOrder2xx: {
        resolvedResults: Array<{ requestSequence: number }>;
      };
    }).__m86OutOfOrder2xx.resolvedResults.map(
      (result) => result.requestSequence,
    ))).toEqual([2, 1]);
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);

  const clientEvidence = await page.evaluate(() =>
    (window as typeof window & {
      __m86OutOfOrder2xx: {
        broadcastRevisions: number[];
        resolvedResults: Array<{
          graphRevision: unknown;
          loadToken: unknown;
          requestSequence: number;
          revision: unknown;
        }>;
        writesAfterOldRelease: number;
      };
    }).__m86OutOfOrder2xx);
  expect(clientEvidence.resolvedResults).toEqual([
    {
      graphRevision: 3,
      loadToken: LOAD_TOKEN_B,
      requestSequence: 2,
      revision: 3,
    },
    {
      graphRevision: 2,
      loadToken: LOAD_TOKEN_C,
      requestSequence: 1,
      revision: 2,
    },
  ]);
  expect(clientEvidence.broadcastRevisions).toEqual([3]);
  expect(clientEvidence.writesAfterOldRelease).toBe(0);
  expect(await readCanvasSaveSession(page, "node.text.empty"))
    .toEqual(pagehideSession);
  await expect(title).toHaveValue("A3-pagehide");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await expect(page.getByTestId("save-conflict")).toHaveCount(0);

  // An unchanged pagehide must remain a no-op. This proves that the delayed
  // A2 response did not replace the accepted A3 document fingerprint.
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", {
      persisted: true,
    })));
  await flushBrowserTasks(page);
  expect(puts).toHaveLength(2);
  expect(serverDocument.revision).toBe(3);
  expect(serverDocument.graphRevision).toBe(3);
  expect(serverDocument.loadToken).toBe(LOAD_TOKEN_B);
  expect(serverDocument.sessionHighWaterAttemptId).toBe(
    puts[1].saveAttemptId,
  );
  expect(serverDocument.sessionHighWaterSequence).toBe(2);
  expect(generationPosts()).toBe(0);

  await title.fill("A4-after-delayed-2xx");
  await flushBrowserTasks(page);
  await page.clock.fastForward(600);
  await expect.poll(() => puts.length).toBe(3);
  const a4 = puts[2];
  expect(a4.saveSequence).toBe(3);
  expect(a4.observedRevision).toBe(3);
  expect(a4.observedLoadToken).toBe(LOAD_TOKEN_B);
  expect(a4.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A4-after-delayed-2xx" }),
      id: "text-primary",
    }),
  ]));
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  expect(serverDocument.revision).toBe(4);
  expect(serverDocument.graphRevision).toBe(4);
  expect(serverDocument.loadToken).toBe(LOAD_TOKEN_D);
  expect(serverDocument.sessionHighWaterAttemptId).toBe(a4.saveAttemptId);
  expect(serverDocument.sessionHighWaterSequence).toBe(3);
  expect(generationPosts()).toBe(0);
});

test("pagehide keeps a format-only Text body change while ignoring derived plain HTML", async ({
  page,
}) => {
  await page.clock.install();
  const loaded = textDocument("A1", 1);
  const loadedText = loaded.nodes[0];
  loadedText.data = { ...loadedText.data, content: "格式保留" };
  const puts: Array<Record<string, unknown>> = [];
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(loaded),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 2,
        loadToken: LOAD_TOKEN_B,
        revision: 2,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await pauseBrowserClock(page);
  const node = page.locator('.react-flow__node[data-id="text-primary"]');
  await node.click();
  await page.getByTestId("canvas-node-text-content").dblclick();
  const editor = page.getByTestId("text-node-editor");
  await editor.press("Meta+A");
  await page.getByTestId("text-node-toolbar")
    .getByRole("button", { name: "粗体" })
    .click();
  await expect(editor.locator("b, strong")).toHaveText("格式保留");

  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", {
      persisted: true,
    })));
  await expect.poll(() => puts.length).toBe(1);
  const savedText = (puts[0].nodes as Array<{
    data?: { content?: string; contentHtml?: string };
    id?: string;
  }>).find((candidate) => candidate.id === "text-primary");
  expect(savedText?.data?.content).toBe("格式保留");
  expect(savedText?.data?.contentHtml).toMatch(/<(?:b|strong)>格式保留<\/(?:b|strong)>/);
  expect(generationPosts()).toBe(0);
});

test("a cloned same-session sequence is verified by GET before rebasing the local draft", async ({
  page,
}) => {
  const clonedAttemptId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  let releaseOldSave!: () => void;
  const heldOldSave = new Promise<void>((resolve) => {
    releaseOldSave = resolve;
  });
  let serverDocument = textDocument("A1", 1);
  let baselineGets = 0;
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      if (serverDocument.revision === 2) baselineGets += 1;
      await route.fulfill({
        body: JSON.stringify(serverDocument),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    if (body.saveSequence === 1) {
      await heldOldSave;
      await route.fulfill({
        body: JSON.stringify({
          code: "CANVAS_SAVE_SUPERSEDED",
          currentGraphRevision: 2,
          currentRevision: 2,
          currentWriterSequence: 2,
          currentWriterSessionId: body.saveSessionId,
          error: "A cloned tab used the same session and sequence",
          rejectedAttemptId: body.saveAttemptId,
          rejectedSequence: 1,
          rejectedSessionId: body.saveSessionId,
          sessionHighWaterAttemptId: clonedAttemptId,
          sessionHighWaterSequence: 2,
        }),
        contentType: "application/json",
        status: 409,
      });
      return;
    }
    if (body.saveSequence === 2) {
      serverDocument = {
        ...textDocument("B1-clone", 2, LOAD_TOKEN_B),
        currentWriterSequence: 2,
        currentWriterSessionId: body.saveSessionId as string,
        sessionHighWaterAttemptId: clonedAttemptId,
        sessionHighWaterSequence: 2,
      };
      await route.fulfill({
        body: JSON.stringify({
          code: "CANVAS_SAVE_SUPERSEDED",
          currentGraphRevision: 2,
          currentRevision: 2,
          currentWriterSequence: 2,
          currentWriterSessionId: body.saveSessionId,
          error: "A cloned tab committed the same session sequence first",
          rejectedAttemptId: body.saveAttemptId,
          rejectedSequence: 2,
          rejectedSessionId: body.saveSessionId,
          sessionHighWaterAttemptId: clonedAttemptId,
          sessionHighWaterSequence: 2,
        }),
        contentType: "application/json",
        status: 409,
      });
      return;
    }
    serverDocument = {
      ...serverDocument,
      edges: body.edges as typeof serverDocument.edges,
      graphRevision: 3,
      loadToken: LOAD_TOKEN_C,
      nodes: body.nodes as typeof serverDocument.nodes,
      revision: 3,
      viewport: body.viewport as typeof serverDocument.viewport,
    };
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 3,
        loadToken: LOAD_TOKEN_C,
        revision: 3,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("A2");
  await expect.poll(() => puts.some((body) => body.saveSequence === 1)).toBe(true);
  await title.fill("A3-local");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => puts.some((body) => body.saveSequence === 2)).toBe(true);
  releaseOldSave();

  await expect.poll(() => puts.some((body) =>
    body.observedRevision === 2 &&
    body.observedLoadToken === LOAD_TOKEN_B &&
    (body.nodes as Array<{ data?: { title?: string }; id?: string }>).some(
      (node) => node.id === "text-primary" && node.data?.title === "A3-local",
    ),
  )).toBe(true);
  const rebased = puts.find((body) =>
    body.observedRevision === 2 &&
    body.observedLoadToken === LOAD_TOKEN_B &&
    (body.nodes as Array<{ data?: { title?: string }; id?: string }>).some(
      (node) => node.id === "text-primary" && node.data?.title === "A3-local",
    ),
  )!;
  expect(Number(rebased.saveSequence)).toBeGreaterThan(2);
  expect(rebased.saveAttemptId).not.toBe(clonedAttemptId);
  expect(rebased.observedRevision).toBe(2);
  expect(rebased.observedLoadToken).toBe(LOAD_TOKEN_B);
  expect(rebased.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A3-local" }),
      id: "text-primary",
    }),
  ]));
  expect(baselineGets).toBeGreaterThan(0);
  await expect(title).toHaveValue("A3-local");
  expect(serverDocument.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A3-local" }),
      id: "text-primary",
    }),
  ]));
});

test("a normal-save high-water preserves a DOM-newer draft before React state settles", async ({
  page,
}) => {
  let releaseOldSave!: () => void;
  const heldOldSave = new Promise<void>((resolve) => {
    releaseOldSave = resolve;
  });
  let serverTitle = "A1";
  let serverRevision = 1;
  let serverLoadToken = LOAD_TOKEN_A;
  let bBaselineGets = 0;
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/__m86-release-normal-highwater", async (route) => {
    releaseOldSave();
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      if (serverTitle === "B1") bBaselineGets += 1;
      await route.fulfill({
        body: JSON.stringify(
          textDocument(serverTitle, serverRevision, serverLoadToken),
        ),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    if (body.saveSequence === 1) {
      await heldOldSave;
      await route.fulfill({
        body: JSON.stringify({
          code: "CANVAS_SAVE_SUPERSEDED",
          currentGraphRevision: 2,
          currentRevision: 2,
          currentWriterSequence: 1,
          currentWriterSessionId: "other-tab",
          error: "B committed while the normal A2 save was pending",
          rejectedAttemptId: body.saveAttemptId,
          rejectedSequence: 1,
          rejectedSessionId: body.saveSessionId,
          sessionHighWaterAttemptId: body.saveAttemptId,
          sessionHighWaterSequence: 1,
        }),
        contentType: "application/json",
        status: 409,
      });
      return;
    }
    const nextTitle = (body.nodes as Array<{
      data?: { title?: string };
      id?: string;
    }>).find((node) => node.id === "text-primary")?.data?.title;
    serverTitle = nextTitle ?? "missing-title";
    serverRevision = 3;
    serverLoadToken = LOAD_TOKEN_C;
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 3,
        loadToken: LOAD_TOKEN_C,
        revision: 3,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("A2");
  await expect.poll(() => puts.some((body) => body.saveSequence === 1)).toBe(true);
  serverTitle = "B1";
  serverRevision = 2;
  serverLoadToken = LOAD_TOKEN_B;

  await title.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.addEventListener("input", () => {
      void fetch("/__m86-release-normal-highwater");
    }, { capture: true, once: true });
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(input, "A3");
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "A3",
      inputType: "insertText",
    }));
  });

  await expect.poll(() => puts.some((body) =>
    body.observedRevision === 2 &&
    body.observedLoadToken === LOAD_TOKEN_B &&
    (body.nodes as Array<{ data?: { title?: string }; id?: string }>).some(
      (node) => node.id === "text-primary" && node.data?.title === "A3",
    ),
  )).toBe(true);
  const a3 = puts.find((body) =>
    body.observedRevision === 2 &&
    body.observedLoadToken === LOAD_TOKEN_B &&
    (body.nodes as Array<{ data?: { title?: string }; id?: string }>).some(
      (node) => node.id === "text-primary" && node.data?.title === "A3",
    ),
  )!;
  expect(Number(a3.saveSequence)).toBeGreaterThan(
    Number(puts[0].saveSequence),
  );
  expect(a3.saveAttemptId).not.toBe(puts[0].saveAttemptId);
  expect(a3.observedRevision).toBe(2);
  expect(a3.observedLoadToken).toBe(LOAD_TOKEN_B);
  expect(a3.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A3" }),
      id: "text-primary",
    }),
  ]));
  expect(bBaselineGets).toBeGreaterThan(0);
  expect(serverTitle).toBe("A3");
  expect(serverRevision).toBe(3);
  await expect(title).toHaveValue("A3");
});

test("a direct ReactFlow drag survives a foreign high-water without a duplicate save", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let resolveHeld: ((response: Response) => void) | undefined;
    const harness: {
      armed: boolean;
      firstPayload?: Record<string, unknown>;
      release: () => void;
      released: boolean;
    } = {
      armed: false,
      release: () => {
        const body = harness.firstPayload;
        if (!body || !resolveHeld || harness.released) return;
        harness.released = true;
        resolveHeld(new Response(JSON.stringify({
          code: "CANVAS_SAVE_SUPERSEDED",
          currentGraphRevision: 2,
          currentRevision: 2,
          currentWriterSequence: 1,
          currentWriterSessionId: "other-tab",
          error: "B committed while the old save was pending",
          rejectedAttemptId: body.saveAttemptId,
          rejectedSequence: body.saveSequence,
          rejectedSessionId: body.saveSessionId,
          sessionHighWaterAttemptId: body.saveAttemptId,
          sessionHighWaterSequence: body.saveSequence,
        }), {
          headers: { "Content-Type": "application/json" },
          status: 409,
        }));
      },
      released: false,
    };
    (window as typeof window & { __m86DragHarness?: typeof harness })
      .__m86DragHarness = harness;
    window.addEventListener("mousemove", () => {
      if (harness.armed) harness.release();
    }, { capture: true });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL
        ? input.href
        : input.url;
      if (
        !harness.firstPayload &&
        url.endsWith("/api/canvas/node.text.empty") &&
        init?.method === "PUT"
      ) {
        harness.firstPayload = JSON.parse(String(init.body)) as Record<
          string,
          unknown
        >;
        return new Promise<Response>((resolve) => {
          resolveHeld = resolve;
        });
      }
      return originalFetch(input, init);
    };
  });
  let serverDocument = textDocument("A1", 1);
  let baselineGets = 0;
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      if (serverDocument.revision === 2) baselineGets += 1;
      await route.fulfill({
        body: JSON.stringify(serverDocument),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    serverDocument = {
      ...serverDocument,
      edges: body.edges as typeof serverDocument.edges,
      graphRevision: 3,
      loadToken: LOAD_TOKEN_C,
      nodes: body.nodes as typeof serverDocument.nodes,
      revision: 3,
      viewport: body.viewport as typeof serverDocument.viewport,
    };
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 3,
        loadToken: LOAD_TOKEN_C,
        revision: 3,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await pauseBrowserClock(page);
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("A2");
  await page.clock.runFor(600);
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as typeof window & {
      __m86DragHarness?: { firstPayload?: Record<string, unknown> };
    }).__m86DragHarness?.firstPayload,
  ))).toBe(true);
  serverDocument = textDocument("B1", 2, LOAD_TOKEN_B);

  const dragSurface = page.locator(
    '.react-flow__node[data-id="text-primary"]',
  );
  const box = await dragSurface.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, startY + 8);
  await expect(page.getByTestId("text-creator")).toHaveCount(0);
  await page.evaluate(() => {
    const harness = (window as typeof window & {
      __m86DragHarness?: { armed: boolean };
    }).__m86DragHarness;
    if (harness) harness.armed = true;
  });
  await page.mouse.move(startX + 84, startY + 56);
  await page.mouse.up();

  await expect.poll(() => puts.length).toBe(1);
  const dragged = puts[0];
  expect(dragged.observedRevision).toBe(2);
  expect(dragged.observedLoadToken).toBe(LOAD_TOKEN_B);
  const draggedNode = (dragged.nodes as Array<{
    id?: string;
    position?: { x?: number; y?: number };
  }>).find((node) => node.id === "text-primary");
  expect(Number(draggedNode?.position?.x)).toBeGreaterThan(442);
  expect(Number(draggedNode?.position?.y)).toBeGreaterThan(300);
  expect(baselineGets).toBeGreaterThan(0);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.clock.fastForward(31_000);
  expect(puts).toHaveLength(1);
  const serverNode = serverDocument.nodes.find(
    (node) => node.id === "text-primary",
  );
  expect(serverNode?.position).toEqual(draggedNode?.position);
});

test("a normal-save high-water preserves a newer text prompt and its canonical side effects", async ({
  page,
}) => {
  const failedGeneration = {
    textGenerationError: "stale provider failure",
    textGenerationErrorCode: "AUTH",
    textGenerationTaskId: "task-stale",
    textPromptReady: true,
  };
  const readPrompt = (body: Record<string, unknown>) => {
    const nodes = body.nodes as Array<{
      data?: { textPrompt?: string };
      id?: string;
    }>;
    return nodes.find((node) => node.id === "text-primary")?.data?.textPrompt;
  };
  await runNormalHighWaterFieldRace({
    assertSaved: (body) => {
      const node = (body.nodes as Array<{
        data?: Record<string, unknown>;
        id?: string;
      }>).find((candidate) => candidate.id === "text-primary");
      expect(node?.data).not.toHaveProperty("textGenerationError");
      expect(node?.data).not.toHaveProperty("textGenerationErrorCode");
      expect(node?.data).not.toHaveProperty("textGenerationTaskId");
    },
    baselineDocument: textDocumentWithData("Text", 2, {
      ...failedGeneration,
      textPrompt: "B1",
    }, LOAD_TOKEN_B),
    canvasId: "node.text.empty",
    initialDocument: textDocumentWithData("Text", 1, {
      ...failedGeneration,
      textPrompt: "P1",
    }),
    openEditor: async (currentPage) => {
      await currentPage.locator(
        '.react-flow__node[data-id="text-primary"]',
      ).click();
      const prompt = currentPage.getByTestId("text-creator-prompt");
      await expect(prompt).toBeVisible();
      return prompt;
    },
    page,
    readField: readPrompt,
    releasePath: "/__m86-release-prompt-highwater",
  });
});

test("a normal-save high-water preserves a newer administrator text parameter", async ({
  page,
}) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
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
      contentType: "application/json",
      status: 200,
    });
  });
  const failedGeneration = {
    textGenerationError: "stale provider failure",
    textGenerationErrorCode: "AUTH",
    textGenerationTaskId: "task-stale",
    textModelId: "custom-text",
    textModelName: "Custom Text",
    textPromptReady: true,
  };
  const readParameter = (body: Record<string, unknown>) => {
    const nodes = body.nodes as Array<{
      data?: { textParameters?: Record<string, unknown> };
      id?: string;
    }>;
    return nodes.find((node) => node.id === "text-primary")?.data
      ?.textParameters?.custom_12345678;
  };
  await runNormalHighWaterFieldRace({
    assertSaved: (body) => {
      const node = (body.nodes as Array<{
        data?: Record<string, unknown>;
        id?: string;
      }>).find((candidate) => candidate.id === "text-primary");
      expect(node?.data).not.toHaveProperty("textGenerationError");
      expect(node?.data).not.toHaveProperty("textGenerationErrorCode");
      expect(node?.data).not.toHaveProperty("textGenerationTaskId");
    },
    baselineDocument: textDocumentWithData("Text", 2, {
      ...failedGeneration,
      textParameters: { custom_12345678: "B1" },
    }, LOAD_TOKEN_B),
    canvasId: "node.text.creator-open",
    initialDocument: textDocumentWithData("Text", 1, {
      ...failedGeneration,
      textParameters: { custom_12345678: "P1" },
    }),
    openEditor: async (currentPage) => {
      const creator = currentPage.getByTestId("text-creator");
      await expect(creator).toBeVisible();
      const trigger = creator.locator(".node-parameter-trigger");
      await expect(trigger).toBeVisible();
      await trigger.click();
      const parameter = currentPage.getByRole("dialog", {
        name: "模型参数",
      }).getByRole("textbox", { name: "写作语气" });
      await expect(parameter).toBeVisible();
      return parameter;
    },
    page,
    readField: readParameter,
    releasePath: "/__m86-release-parameter-highwater",
  });
});

for (const invalidNormalResult of [
  "graph-ahead",
  "unchanged-token",
] as const satisfies readonly InvalidSaveResultKind[]) {
  test(`normal save ${invalidNormalResult} 2xx keeps its durable journal`, async ({
    page,
  }) => {
    await page.clock.install();
    const puts: Array<Record<string, unknown>> = [];
    const generationPosts = generationPostCount(page);
    await page.route("**/api/canvas/node.text.empty", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          body: JSON.stringify(textDocument("A1", 1)),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      puts.push(body);
      await route.fulfill({
        body: JSON.stringify(invalidCanvasSaveResult(
          invalidNormalResult,
          Number(body.revision),
          String(body.observedLoadToken),
        )),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/__fixture/node.text.empty");
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-state",
      "ready",
    );
    await pauseBrowserClock(page);
    await page.locator('.react-flow__node[data-id="text-primary"]').click();
    await page.getByTestId("canvas-node-title").fill("A2-invalid-fence");
    await flushBrowserTasks(page);
    await page.clock.fastForward(600);
    await expect.poll(() => puts.length).toBe(1);
    await flushBrowserTasks(page);
    await expect(page.getByTestId("save-status")).toHaveText("保存失败");
    const stored = await readCanvasSaveSession(page, "node.text.empty");
    expect(stored?.confirmedSequence).toBe(0);
    expect(stored?.saveSequence).toBe(1);
    expect(stored?.pendingPagehide?.attemptId).toBe(puts[0].saveAttemptId);
    expect(stored?.pendingPagehide?.saveSequence).toBe(1);
    expect(JSON.parse(stored?.pendingPagehide?.payload ?? "{}"))
      .toEqual(puts[0]);
    expect(generationPosts()).toBe(0);
  });
}

test("a transient 500 retries exactly the same save once without a duplicate", async ({
  page,
}) => {
  await page.clock.install();
  const payloads: string[] = [];
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(textDocument("A1", 1)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    payloads.push(route.request().postData() ?? "");
    if (payloads.length === 1) {
      await route.fulfill({ status: 500 });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 2,
        loadToken: LOAD_TOKEN_B,
        revision: 2,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await pauseBrowserClock(page);
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.getByTestId("canvas-node-title").fill("A2");
  await page.clock.runFor(600);
  await expect.poll(() => payloads.length, { timeout: 5_000 }).toBe(1);
  await flushBrowserTasks(page);
  await expect(page.getByTestId("save-status")).toHaveText("保存失败");
  await page.clock.runFor(1_100);
  await expect.poll(() => payloads.length, { timeout: 5_000 }).toBe(2);
  expect(payloads[1]).toBe(payloads[0]);
  expect(JSON.parse(payloads[1]).saveSequence).toBe(1);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.clock.fastForward(31_000);
  expect(payloads).toHaveLength(2);
});

test("a hard reload reuses the tab save session and advances its sequence", async ({
  page,
}) => {
  let serverDocument = textDocument("A1", 1);
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(serverDocument),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    const revision = serverDocument.revision + 1;
    const loadToken = loadTokenForRevision(revision);
    serverDocument = {
      ...serverDocument,
      edges: body.edges as typeof serverDocument.edges,
      graphRevision: revision,
      loadToken,
      nodes: body.nodes as typeof serverDocument.nodes,
      revision,
      viewport: body.viewport as typeof serverDocument.viewport,
    };
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: revision,
        loadToken,
        revision,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.getByTestId("canvas-node-title").fill("A2");
  await expect.poll(() => puts.length).toBe(1);
  const firstSessionId = puts[0].saveSessionId;
  const firstSequence = Number(puts[0].saveSequence);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.getByTestId("canvas-node-title").fill("A3");
  await expect.poll(() => puts.some((body) =>
    Array.isArray(body.nodes) && body.nodes.some((node) => {
      if (!node || typeof node !== "object") return false;
      const record = node as { data?: { title?: string }; id?: string };
      return record.id === "text-primary" && record.data?.title === "A3";
    }),
  )).toBe(true);
  const secondSave = puts.find((body) =>
    Array.isArray(body.nodes) && body.nodes.some((node) => {
      if (!node || typeof node !== "object") return false;
      const record = node as { data?: { title?: string }; id?: string };
      return record.id === "text-primary" && record.data?.title === "A3";
    }),
  )!;
  expect(secondSave.saveSessionId).toBe(firstSessionId);
  expect(Number(secondSave.saveSequence)).toBeGreaterThan(firstSequence);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
});

test("forty sequential saves keep the sent-fingerprint state bounded", async ({
  page,
}) => {
  await page.clock.install();
  let serverRevision = 1;
  let serverLoadToken = LOAD_TOKEN_A;
  const puts: Array<Record<string, unknown>> = [];
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(textDocument(
          "A1",
          serverRevision,
          serverLoadToken,
        )),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    expect(body.observedRevision).toBe(serverRevision);
    expect(body.observedLoadToken).toBe(serverLoadToken);
    serverRevision += 1;
    serverLoadToken = loadTokenForRevision(serverRevision);
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: serverRevision,
        loadToken: serverLoadToken,
        revision: serverRevision,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-state", "ready");
  await pauseBrowserClock(page);
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  for (let index = 1; index <= 40; index += 1) {
    await title.fill(`bounded-fingerprint-${index}`);
    await flushBrowserTasks(page);
    await page.clock.fastForward(600);
    await expect.poll(() => puts.length).toBe(index);
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    await expect(world).toHaveAttribute("data-save-fingerprint-count", "1");
  }
  expect(puts.map((body) => body.saveSequence)).toEqual(
    Array.from({ length: 40 }, (_, index) => index + 1),
  );
  expect(serverRevision).toBe(41);
  expect(generationPosts()).toBe(0);
});

test("a cloned tab keeps the server save session but receives another instance's broadcast", async ({
  context,
  page,
}) => {
  let serverDocument = textDocument("A1", 1);
  let cloneGets = 0;
  let clonePuts = 0;
  const installCanvasRoute = async (target: Page, clone: boolean) => {
    await target.route("**/api/canvas/node.text.empty", async (route) => {
      if (route.request().method() === "GET") {
        if (clone) cloneGets += 1;
        await route.fulfill({
          body: JSON.stringify(serverDocument),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      if (clone) clonePuts += 1;
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const revision = serverDocument.revision + 1;
      const loadToken = loadTokenForRevision(revision);
      serverDocument = {
        ...serverDocument,
        edges: body.edges as typeof serverDocument.edges,
        graphRevision: revision,
        loadToken,
        nodes: body.nodes as typeof serverDocument.nodes,
        revision,
        viewport: body.viewport as typeof serverDocument.viewport,
      };
      await route.fulfill({
        body: JSON.stringify({
          graphRevision: revision,
          loadToken,
          revision,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
  };

  await installCanvasRoute(page, false);
  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  const clonedStorage = await page.evaluate(() => {
    const entries: Record<string, string> = {};
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key) entries[key] = window.sessionStorage.getItem(key) ?? "";
    }
    return entries;
  });

  const clone = await context.newPage();
  await clone.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) {
      window.sessionStorage.setItem(key, value);
    }
  }, clonedStorage);
  await installCanvasRoute(clone, true);
  await clone.goto("/__fixture/node.text.empty");
  await expect(clone.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  const initialCloneGets = cloneGets;
  expect(initialCloneGets).toBeGreaterThan(0);

  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.getByTestId("canvas-node-title").fill("A2");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  await expect.poll(() => cloneGets).toBeGreaterThan(initialCloneGets);
  await expect(clone.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await clone.locator('.react-flow__node[data-id="text-primary"]').click();
  await expect(clone.getByTestId("canvas-node-title")).toHaveValue("A2");
  expect(clonePuts).toBe(0);
  await clone.close();
});

test("a hung PUT is aborted and retried with the identical bounded attempt", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(({ document, loadToken }) => {
    const state = { payloads: [] as string[] };
    (window as typeof window & { __m86HungPut?: typeof state })
      .__m86HungPut = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.pathname !== "/api/canvas/node.text.empty") {
        return originalFetch(input, init);
      }
      if (method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(document), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      const payload = String(init?.body ?? "");
      state.payloads.push(payload);
      if (state.payloads.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          const rejectAbort = () =>
            reject(new DOMException("Timed out", "AbortError"));
          if (init?.signal?.aborted) rejectAbort();
          else init?.signal?.addEventListener("abort", rejectAbort, { once: true });
        });
      }
      return Promise.resolve(new Response(JSON.stringify({
        graphRevision: 2,
        loadToken,
        revision: 2,
      }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }));
    }) as typeof window.fetch;
  }, {
    document: textDocument("A1", 1),
    loadToken: LOAD_TOKEN_B,
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.getByTestId("canvas-node-title").fill("A2");
  await page.clock.runFor(600);
  await expect.poll(async () => page.evaluate(() =>
    (window as typeof window & { __m86HungPut: { payloads: string[] } })
      .__m86HungPut.payloads.length)).toBe(1);

  await page.clock.fastForward(6_100);
  await expect(page.getByTestId("save-status")).toHaveText("保存失败");
  await page.clock.runFor(1_100);
  await expect.poll(async () => page.evaluate(() =>
    (window as typeof window & { __m86HungPut: { payloads: string[] } })
      .__m86HungPut.payloads.length)).toBe(2);
  const payloads = await page.evaluate(() =>
    (window as typeof window & { __m86HungPut: { payloads: string[] } })
      .__m86HungPut.payloads);
  expect(payloads[1]).toBe(payloads[0]);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.clock.fastForward(31_000);
  expect(await page.evaluate(() =>
    (window as typeof window & { __m86HungPut: { payloads: string[] } })
      .__m86HungPut.payloads.length)).toBe(2);
});

test("PUT headers with a permanently hung body share the 6s deadline and retry the identical attempt", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(({ document, nextLoadToken }) => {
    const state = { aborts: 0, payloads: [] as string[] };
    (window as typeof window & { __m86HungPutBody?: typeof state })
      .__m86HungPutBody = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.pathname !== "/api/canvas/node.text.empty") {
        return originalFetch(input, init);
      }
      if (method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(document), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      const payload = String(init?.body ?? "");
      state.payloads.push(payload);
      if (state.payloads.length === 1) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const abort = () => {
              state.aborts += 1;
              controller.error(new DOMException("Timed out", "AbortError"));
            };
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener("abort", abort, { once: true });
          },
        });
        return Promise.resolve(new Response(body, {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        graphRevision: 2,
        loadToken: nextLoadToken,
        revision: 2,
      }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }));
    }) as typeof window.fetch;
  }, {
    document: textDocument("A1", 1),
    nextLoadToken: LOAD_TOKEN_B,
  });
  const generationPosts = generationPostCount(page);

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.getByTestId("canvas-node-title").fill("A2-hung-body");
  await page.clock.runFor(600);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86HungPutBody: { payloads: string[] };
    }).__m86HungPutBody.payloads.length)).toBe(1);

  await page.clock.fastForward(6_100);
  await expect(page.getByTestId("save-status")).toHaveText("保存失败");
  await page.clock.runFor(1_100);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86HungPutBody: { payloads: string[] };
    }).__m86HungPutBody.payloads.length)).toBe(2);
  const state = await page.evaluate(() =>
    (window as typeof window & {
      __m86HungPutBody: { aborts: number; payloads: string[] };
    }).__m86HungPutBody);
  expect(state.aborts).toBe(1);
  expect(state.payloads[1]).toBe(state.payloads[0]);
  const retried = JSON.parse(state.payloads[1]) as Record<string, unknown>;
  expect(retried.saveSequence).toBe(1);
  expect(retried.observedRevision).toBe(1);
  expect(retried.observedLoadToken).toBe(LOAD_TOKEN_A);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  const stored = await readCanvasSaveSession(page, "node.text.empty");
  expect(stored?.confirmedSequence).toBe(1);
  expect(stored?.saveSequence).toBe(1);
  expect(stored?.pendingPagehide).toBeUndefined();
  expect(generationPosts()).toBe(0);
});

test("terminal save 4xx keeps the draft and never retries", async ({ page }) => {
  await page.clock.install();
  let putCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(textDocument("A1", 1)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    putCount += 1;
    await route.fulfill({
      body: JSON.stringify({ error: "Payload rejected" }),
      contentType: "application/json",
      status: 413,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("kept-after-413");
  await expect.poll(() => putCount).toBe(1);
  await expect(page.getByTestId("save-status")).toHaveText("保存失败");
  await page.clock.fastForward(31_000);
  expect(putCount).toBe(1);
  await expect(title).toHaveValue("kept-after-413");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  expect(putCount).toBe(1);
  expect(generationPosts()).toBe(0);
});

async function runDelayedSupersededScenario(page: Page, withA4: boolean) {
  let releaseOldSave!: () => void;
  const oldSave = new Promise<void>((resolve) => {
    releaseOldSave = resolve;
  });
  let serverTitle = "A1";
  let serverRevision = 1;
  let serverLoadToken = LOAD_TOKEN_A;
  let bCommitted = false;
  let bBaselineGets = 0;
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      if (serverTitle === "B1") bBaselineGets += 1;
      await route.fulfill({
        body: JSON.stringify(
          textDocument(serverTitle, serverRevision, serverLoadToken),
        ),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    if (body.saveSequence === 1) {
      await oldSave;
      await route.fulfill({
        body: JSON.stringify({
          code: "CANVAS_SAVE_SUPERSEDED",
          currentGraphRevision: 3,
          currentRevision: 3,
          currentWriterSequence: 1,
          currentWriterSessionId: "other-tab",
          error: "Superseded same-session save",
          rejectedAttemptId: body.saveAttemptId,
          rejectedSequence: 1,
          rejectedSessionId: body.saveSessionId,
          sessionHighWaterAttemptId: puts.find(
            (candidate) => candidate.saveSequence === 2,
          )?.saveAttemptId ?? null,
          sessionHighWaterSequence: 2,
        }),
        contentType: "application/json",
        status: 409,
      });
      return;
    }
    if (
      bCommitted &&
      (body.observedRevision !== 3 || body.observedLoadToken !== LOAD_TOKEN_B)
    ) {
      await route.fulfill({
        body: JSON.stringify({
          code: "CANVAS_SAVE_SUPERSEDED",
          currentGraphRevision: 3,
          currentRevision: 3,
          currentWriterSequence: 1,
          currentWriterSessionId: "other-tab",
          error: "B already owns the durable baseline",
          rejectedAttemptId: body.saveAttemptId,
          rejectedSequence: body.saveSequence,
          rejectedSessionId: body.saveSessionId,
          sessionHighWaterAttemptId: puts.find(
            (candidate) => candidate.saveSequence === 2,
          )?.saveAttemptId ?? null,
          sessionHighWaterSequence: 2,
        }),
        contentType: "application/json",
        status: 409,
      });
      return;
    }
    const revision = body.saveSequence === 2 ? 2 : 4;
    const nextTitle = (body.nodes as Array<{
      data?: { title?: string };
      id?: string;
    }>).find((node) => node.id === "text-primary")?.data?.title;
    serverTitle = nextTitle ?? "missing-title";
    serverRevision = revision;
    serverLoadToken = body.saveSequence === 2 ? LOAD_TOKEN_C : LOAD_TOKEN_D;
    if (body.saveSequence === 2) {
      // The A3 pagehide save committed, but its response was lost. Its
      // durable journal must therefore be settled by the old A2 409 fence.
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: revision,
        loadToken: body.saveSequence === 2 ? LOAD_TOKEN_C : LOAD_TOKEN_D,
        revision,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("A2");
  await expect.poll(() => puts.length).toBe(1);
  await title.fill("A3");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => puts.some((body) => body.saveSequence === 2)).toBe(true);
  const a3HighWater = puts.find((body) => body.saveSequence === 2)!;
  expect(a3HighWater.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A3" }),
      id: "text-primary",
    }),
  ]));
  bCommitted = true;
  serverTitle = "B1";
  serverRevision = 3;
  serverLoadToken = LOAD_TOKEN_B;
  if (withA4) await title.fill("A4");
  const reloadNavigation = withA4
    ? undefined
    : page.waitForEvent("framenavigated", {
        predicate: (frame) => frame === page.mainFrame(),
        timeout: 5_000,
      });
  releaseOldSave();

  if (withA4) {
    await expect.poll(() => puts.some((body) =>
      body.observedRevision === 3 &&
      body.observedLoadToken === LOAD_TOKEN_B &&
      (body.nodes as Array<{ data?: { title?: string }; id?: string }>).some(
        (node) => node.id === "text-primary" && node.data?.title === "A4",
      ),
    )).toBe(true);
    const a4 = puts.find((body) =>
      body.observedRevision === 3 &&
      body.observedLoadToken === LOAD_TOKEN_B &&
      (body.nodes as Array<{ data?: { title?: string }; id?: string }>).some(
        (node) => node.id === "text-primary" && node.data?.title === "A4",
      ),
    )!;
    expect(Number(a4.saveSequence)).toBeGreaterThan(
      Number(a3HighWater.saveSequence),
    );
    expect(a4.saveAttemptId).not.toBe(a3HighWater.saveAttemptId);
    expect(a4.observedRevision).toBe(3);
    expect(a4.observedLoadToken).toBe(LOAD_TOKEN_B);
    expect(a4.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({ title: "A4" }),
        id: "text-primary",
      }),
    ]));
    await expect(title).toHaveValue("A4");
    expect(bBaselineGets).toBeGreaterThan(0);
    expect(serverTitle).toBe("A4");
    expect(serverRevision).toBe(4);
  } else {
    await reloadNavigation;
    await expect.poll(() => bBaselineGets).toBeGreaterThan(0);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-state",
      "ready",
    );
    await page.locator('.react-flow__node[data-id="text-primary"]').click();
    await expect(page.getByTestId("canvas-node-title")).toHaveValue("B1");
    expect(puts.map((body) => body.saveSequence)).toEqual([1, 2]);
  }
}

test("A3 then B1 then delayed A2 reloads B1 without rebinding A3", async ({
  page,
}) => {
  await runDelayedSupersededScenario(page, false);
});

test("A3 then B1 then delayed A2 preserves and saves a newer A4", async ({
  page,
}) => {
  await runDelayedSupersededScenario(page, true);
});

async function runJournalReplayOrdering(
  page: Page,
  releaseOrder: "old-before-replay" | "old-after-replay",
) {
  const canvasId = "node.text.empty";
  const pendingPayload = canvasSavePayload({ canvasTitle: "A2" });
  await seedCanvasSaveSession(page, canvasId, {
    confirmedSequence: 0,
    pendingPagehide: {
      attemptId: SAVE_ATTEMPT_A,
      payload: pendingPayload,
      saveSequence: 1,
      serverEpoch: SAVE_EPOCH_A,
    },
    saveSequence: 1,
    saveSessionId: SAVE_SESSION_A,
    serverEpoch: SAVE_EPOCH_A,
    storageRevision: 0,
  }, true);

  let releaseOld!: () => void;
  const oldRelease = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  let markOldStarted!: () => void;
  const oldStarted = new Promise<void>((resolve) => {
    markOldStarted = resolve;
  });
  let markOldSettled!: () => void;
  const oldSettled = new Promise<void>((resolve) => {
    markOldSettled = resolve;
  });
  let serverDocument = textDocument("A1", 1);
  let highWaterSequence = 0;
  let highWaterAttemptId: string | null = null;
  const puts: Array<Record<string, unknown>> = [];
  const generationPosts = generationPostCount(page);

  const commit = (body: Record<string, unknown>) => {
    const revision = serverDocument.revision + 1;
    const loadToken = loadTokenForRevision(revision);
    highWaterSequence = Number(body.saveSequence);
    highWaterAttemptId = String(body.saveAttemptId);
    serverDocument = {
      ...serverDocument,
      currentWriterSequence: highWaterSequence,
      currentWriterSessionId: SAVE_SESSION_A,
      edges: body.edges as typeof serverDocument.edges,
      graphRevision: revision,
      loadToken,
      nodes: body.nodes as typeof serverDocument.nodes,
      revision,
      sessionHighWaterAttemptId: highWaterAttemptId,
      sessionHighWaterSequence: highWaterSequence,
      viewport: body.viewport as typeof serverDocument.viewport,
    };
    return { loadToken, revision };
  };

  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() === "GET") {
      await oldStarted;
      await route.fulfill({
        body: JSON.stringify({
          ...textDocument("A1", 1),
          currentWriterSequence: 0,
          currentWriterSessionId: null,
          saveEpoch: SAVE_EPOCH_A,
          sessionHighWaterAttemptId: null,
          sessionHighWaterSequence: 0,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    const sequence = Number(body.saveSequence);
    if (sequence === 1) {
      markOldStarted();
      await oldRelease;
      if (highWaterSequence >= sequence) {
        await route.fulfill({
          body: JSON.stringify({
            code: "CANVAS_SAVE_SUPERSEDED",
            currentGraphRevision: serverDocument.graphRevision,
            currentRevision: serverDocument.revision,
            currentWriterSequence: highWaterSequence,
            currentWriterSessionId: SAVE_SESSION_A,
            error: "Delayed pagehide save was superseded",
            rejectedAttemptId: body.saveAttemptId,
            rejectedSequence: sequence,
            rejectedSessionId: body.saveSessionId,
            sessionHighWaterAttemptId: highWaterAttemptId,
            sessionHighWaterSequence: highWaterSequence,
          }),
          contentType: "application/json",
          status: 409,
        });
      } else {
        const { loadToken, revision } = commit(body);
        await route.fulfill({
          body: JSON.stringify({
            graphRevision: revision,
            loadToken,
            revision,
          }),
          contentType: "application/json",
          status: 200,
        });
      }
      markOldSettled();
      return;
    }

    expect(sequence).toBe(2);
    if (releaseOrder === "old-before-replay") {
      releaseOld();
      await oldSettled;
    }
    const { loadToken, revision } = commit(body);
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: revision,
        loadToken,
        revision,
      }),
      contentType: "application/json",
      status: 200,
    });
    if (releaseOrder === "old-after-replay") {
      releaseOld();
      await oldSettled;
    }
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await oldSettled;
  expect(puts.map((body) => body.saveSequence)).toEqual([1, 2]);
  expect(puts[1].saveSessionId).toBe(SAVE_SESSION_A);
  expect(puts[1].saveAttemptId).not.toBe(SAVE_ATTEMPT_A);
  expect(puts[1].observedRevision).toBe(1);
  expect(puts[1].observedLoadToken).toBe(LOAD_TOKEN_A);
  expect(serverDocument.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A2" }),
      id: "text-primary",
    }),
  ]));
  expect(serverDocument.currentWriterSessionId).toBe(SAVE_SESSION_A);
  expect(serverDocument.currentWriterSequence).toBe(2);
  expect(serverDocument.sessionHighWaterSequence).toBe(2);
  expect(serverDocument.sessionHighWaterAttemptId).toBe(
    puts[1].saveAttemptId,
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await expect(page.getByTestId("canvas-node-title")).toHaveValue("A2");
  const stored = await readCanvasSaveSession(page, canvasId);
  expect(stored?.confirmedSequence).toBe(2);
  expect(stored?.saveSequence).toBe(2);
  expect(stored?.pendingPagehide).toBeUndefined();
  expect(generationPosts()).toBe(0);
}

for (const releaseOrder of [
  "old-before-replay",
  "old-after-replay",
] as const) {
  test(`a journaled pagehide replays before ready and ${releaseOrder} cannot overwrite A2`, async ({
    page,
  }) => {
    await runJournalReplayOrdering(page, releaseOrder);
  });
}

test("replay replacement storage rejection atomically preserves the P1 journal", async ({
  page,
}) => {
  const canvasId = "node.text.empty";
  const controlKey = "__m86:reject-replay-replacement";
  await page.addInitScript(({ disableKey, scopeId }) => {
    const state = {
      beforeRejectedWrite: null as string | null,
      rejectedValue: null as string | null,
      rejections: 0,
    };
    (window as typeof window & { __m86ReplayReserveGuard?: typeof state })
      .__m86ReplayReserveGuard = state;
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (
        key === `unboundry:canvas-save-session:v2:${scopeId}` &&
        originalGet.call(window.sessionStorage, disableKey) !== "off"
      ) {
        const parsed = JSON.parse(value) as {
          confirmedSequence?: unknown;
          pendingPagehide?: { saveSequence?: unknown };
          saveSequence?: unknown;
        };
        if (
          parsed.saveSequence === 2 &&
          parsed.confirmedSequence === 0 &&
          parsed.pendingPagehide?.saveSequence === 2
        ) {
          state.beforeRejectedWrite = originalGet.call(this, key);
          state.rejectedValue = value;
          state.rejections += 1;
          throw new DOMException(
            "Replay replacement denied",
            "QuotaExceededError",
          );
        }
      }
      return originalSet.call(this, key, value);
    };
  }, { disableKey: controlKey, scopeId: canvasSaveScope(canvasId) });

  const pendingPayload = canvasSavePayload({ canvasTitle: "A2" });
  await seedCanvasSaveSession(page, canvasId, {
    confirmedSequence: 0,
    pendingPagehide: {
      attemptId: SAVE_ATTEMPT_A,
      payload: pendingPayload,
      saveSequence: 1,
      serverEpoch: SAVE_EPOCH_A,
    },
    saveSequence: 1,
    saveSessionId: SAVE_SESSION_A,
    serverEpoch: SAVE_EPOCH_A,
    storageRevision: 0,
  });

  const puts: Array<Record<string, unknown>> = [];
  const generationPosts = generationPostCount(page);
  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({
          ...textDocument("A1", 1),
          currentWriterSequence: 0,
          currentWriterSessionId: null,
          saveEpoch: SAVE_EPOCH_A,
          sessionHighWaterAttemptId: null,
          sessionHighWaterSequence: 0,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 2,
        loadToken: LOAD_TOKEN_B,
        revision: 2,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "failed",
  );
  const failureEvidence = await page.evaluate(({ scopeId }) => {
    const state = (window as typeof window & {
      __m86ReplayReserveGuard: {
        beforeRejectedWrite: string | null;
        rejectedValue: string | null;
        rejections: number;
      };
    }).__m86ReplayReserveGuard;
    return {
      ...state,
      stored: window.sessionStorage.getItem(
        `unboundry:canvas-save-session:v2:${scopeId}`,
      ),
    };
  }, { scopeId: canvasSaveScope(canvasId) });
  expect(failureEvidence.rejections).toBe(1);
  expect(failureEvidence.stored).toBe(failureEvidence.beforeRejectedWrite);
  const durableP1 = JSON.parse(failureEvidence.stored ?? "null") as
    SeededCanvasSaveSession | null;
  const rejectedP2 = JSON.parse(failureEvidence.rejectedValue ?? "null") as
    SeededCanvasSaveSession | null;
  expect(durableP1).toEqual(expect.objectContaining({
    confirmedSequence: 0,
    saveSequence: 1,
    saveSessionId: SAVE_SESSION_A,
    serverEpoch: SAVE_EPOCH_A,
  }));
  expect(durableP1?.pendingPagehide).toEqual({
    attemptId: SAVE_ATTEMPT_A,
    payload: pendingPayload,
    saveSequence: 1,
    serverEpoch: SAVE_EPOCH_A,
  });
  expect(rejectedP2?.saveSequence).toBe(2);
  expect(rejectedP2?.confirmedSequence).toBe(0);
  expect(rejectedP2?.pendingPagehide?.saveSequence).toBe(2);
  expect(puts).toHaveLength(0);
  expect(generationPosts()).toBe(0);

  await page.evaluate(({ disableKey }) => {
    window.sessionStorage.setItem(disableKey, "off");
  }, { disableKey: controlKey });
  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  expect(puts).toHaveLength(1);
  expect(puts[0].saveSequence).toBe(2);
  expect(puts[0].saveAttemptId).not.toBe(SAVE_ATTEMPT_A);
  expect(puts[0].nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A2" }),
      id: "text-primary",
    }),
  ]));
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await expect(page.getByTestId("canvas-node-title")).toHaveValue("A2");
  const recovered = await readCanvasSaveSession(page, canvasId);
  expect(recovered?.saveSequence).toBe(2);
  expect(recovered?.confirmedSequence).toBe(2);
  expect(recovered?.pendingPagehide).toBeUndefined();
  expect(generationPosts()).toBe(0);
});

test("an accepted pagehide attempt is proven by high-water while a newer foreign writer remains visible", async ({
  page,
}) => {
  const canvasId = "node.text.empty";
  const pendingPayload = canvasSavePayload({ canvasTitle: "A2" });
  await seedCanvasSaveSession(page, canvasId, {
    confirmedSequence: 0,
    pendingPagehide: {
      attemptId: SAVE_ATTEMPT_A,
      payload: pendingPayload,
      saveSequence: 1,
      serverEpoch: SAVE_EPOCH_A,
    },
    saveSequence: 1,
    saveSessionId: SAVE_SESSION_A,
    serverEpoch: SAVE_EPOCH_A,
    storageRevision: 0,
  });
  let putCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() !== "GET") {
      putCount += 1;
      await route.fulfill({ status: 500 });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        ...textDocument("B1", 3, LOAD_TOKEN_B),
        currentWriterSequence: 1,
        currentWriterSessionId: SAVE_SESSION_B,
        saveEpoch: SAVE_EPOCH_A,
        sessionHighWaterAttemptId: SAVE_ATTEMPT_A,
        sessionHighWaterSequence: 1,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await expect(page.getByTestId("canvas-node-title")).toHaveValue("B1");
  expect(putCount).toBe(0);
  const stored = await readCanvasSaveSession(page, canvasId);
  expect(stored?.confirmedSequence).toBe(1);
  expect(stored?.saveSequence).toBe(1);
  expect(stored?.pendingPagehide).toBeUndefined();
  expect(generationPosts()).toBe(0);
});

test("an old-epoch pagehide journal fails closed when a foreign writer cannot prove it", async ({
  page,
}) => {
  const canvasId = "node.text.empty";
  const pendingPayload = canvasSavePayload({ canvasTitle: "A2" });
  await seedCanvasSaveSession(page, canvasId, {
    confirmedSequence: 0,
    pendingPagehide: {
      attemptId: SAVE_ATTEMPT_A,
      payload: pendingPayload,
      saveSequence: 1,
      serverEpoch: SAVE_EPOCH_A,
    },
    saveSequence: 1,
    saveSessionId: SAVE_SESSION_A,
    serverEpoch: SAVE_EPOCH_A,
    storageRevision: 0,
  });
  let getCount = 0;
  let putCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() !== "GET") {
      putCount += 1;
      await route.fulfill({ status: 500 });
      return;
    }
    getCount += 1;
    await route.fulfill({
      body: JSON.stringify({
        ...textDocument("B1", 3, LOAD_TOKEN_B),
        currentWriterSequence: 1,
        currentWriterSessionId: SAVE_SESSION_B,
        saveEpoch: SAVE_EPOCH_B,
        sessionHighWaterAttemptId: null,
        sessionHighWaterSequence: 0,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "failed",
  );
  await expect(page.getByTestId("canvas-load-state")).toHaveAttribute(
    "data-error-kind",
    "stale-save-session",
  );
  await expect(page.getByTestId("canvas-load-state")).toContainText(
    "服务器重启前仍有一份未确认的本地保存",
  );
  await expect(page.getByTestId("canvas-load-server-version")).toHaveText(
    "打开服务器版本",
  );
  await page.evaluate(() => {
    const testWindow = window as typeof window & { __m86OpenedUrl?: string };
    window.open = ((url?: string | URL) => {
      testWindow.__m86OpenedUrl = String(url ?? "");
      return null;
    }) as typeof window.open;
  });
  await page.getByTestId("canvas-load-server-version").click();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __m86OpenedUrl?: string }).__m86OpenedUrl,
  )).toContain(`/__fixture/${canvasId}`);
  expect(getCount).toBeGreaterThanOrEqual(1);
  expect(putCount).toBe(0);
  const stored = await readCanvasSaveSession(page, canvasId);
  expect(stored?.pendingPagehide?.attemptId).toBe(SAVE_ATTEMPT_A);
  expect(stored?.confirmedSequence).toBe(0);
  expect(generationPosts()).toBe(0);
});

test("an old-epoch pagehide journal is safely settled when the server document is identical", async ({
  page,
}) => {
  const canvasId = "node.text.empty";
  const pendingPayload = canvasSavePayload({ canvasTitle: "A2" });
  await seedCanvasSaveSession(page, canvasId, {
    confirmedSequence: 0,
    pendingPagehide: {
      attemptId: SAVE_ATTEMPT_A,
      payload: pendingPayload,
      saveSequence: 1,
      serverEpoch: SAVE_EPOCH_A,
    },
    saveSequence: 1,
    saveSessionId: SAVE_SESSION_A,
    serverEpoch: SAVE_EPOCH_A,
    storageRevision: 0,
  });
  let putCount = 0;
  const generationPosts = generationPostCount(page);
  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() !== "GET") {
      putCount += 1;
      await route.fulfill({ status: 500 });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        ...textDocument("A2", 3, LOAD_TOKEN_B),
        currentWriterSequence: 1,
        currentWriterSessionId: SAVE_SESSION_B,
        saveEpoch: SAVE_EPOCH_B,
        sessionHighWaterAttemptId: null,
        sessionHighWaterSequence: 0,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await expect(page.getByTestId("canvas-node-title")).toHaveValue("A2");
  expect(putCount).toBe(0);
  const stored = await readCanvasSaveSession(page, canvasId);
  expect(stored?.confirmedSequence).toBe(1);
  expect(stored?.saveSequence).toBe(1);
  expect(stored?.pendingPagehide).toBeUndefined();
  expect(stored?.serverEpoch).toBe(SAVE_EPOCH_B);
  expect(generationPosts()).toBe(0);
});

for (const journalState of ["malformed", "missing"] as const) {
  test(`${journalState} pending pagehide with an unconfirmed sequence fails closed`, async ({
    page,
  }) => {
    const canvasId = "node.text.empty";
    const pendingPagehide = journalState === "malformed"
      ? {
          attemptId: SAVE_ATTEMPT_A,
          payload: "{",
          saveSequence: 1,
          serverEpoch: SAVE_EPOCH_A,
        }
      : undefined;
    await seedCanvasSaveSession(page, canvasId, {
      confirmedSequence: 0,
      ...(pendingPagehide ? { pendingPagehide } : {}),
      saveSequence: 1,
      saveSessionId: SAVE_SESSION_A,
      serverEpoch: SAVE_EPOCH_A,
      storageRevision: 0,
    });
    let getCount = 0;
    let putCount = 0;
    const generationPosts = generationPostCount(page);
    await page.route(`**/api/canvas/${canvasId}`, async (route) => {
      if (route.request().method() === "GET") {
        getCount += 1;
        await route.fulfill({
          body: JSON.stringify(textDocument("A1", 1)),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      putCount += 1;
      await route.fulfill({ status: 500 });
    });

    await page.goto(`/__fixture/${canvasId}`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-state",
      "failed",
    );
    if (journalState === "malformed") {
      expect(getCount).toBeGreaterThanOrEqual(1);
    } else {
      expect(getCount).toBe(0);
    }
    expect(putCount).toBe(0);
    const stored = await readCanvasSaveSession(page, canvasId);
    expect(stored?.saveSessionId).toBe(SAVE_SESSION_A);
    expect(stored?.saveSequence).toBe(1);
    expect(stored?.confirmedSequence).toBe(0);
    expect(stored?.serverEpoch).toBe(SAVE_EPOCH_A);
    if (pendingPagehide) {
      expect(stored?.pendingPagehide).toEqual(pendingPagehide);
    } else {
      expect(stored?.pendingPagehide).toBeUndefined();
    }
    expect(generationPosts()).toBe(0);
  });
}

test("pagehide atomic journal rejection sends no keepalive and leaves the durable record unchanged", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const state = { rejectPending: false, rejections: 0 };
    (window as typeof window & { __m86JournalGuard?: typeof state })
      .__m86JournalGuard = state;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (
        state.rejectPending &&
        key.startsWith("unboundry:canvas-save-session:v2:") &&
        key !== "unboundry:canvas-save-session:v2:scopes"
      ) {
        const parsed = JSON.parse(value) as { pendingPagehide?: unknown };
        if (parsed.pendingPagehide) {
          state.rejections += 1;
          throw new DOMException("Journal denied", "QuotaExceededError");
        }
      }
      return original.call(this, key, value);
    };
  });
  let putCount = 0;
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(textDocument("A1", 1)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    putCount += 1;
    await route.fulfill({ status: 500 });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await pauseBrowserClock(page);
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const beforeRejection = await readCanvasSaveSession(
    page,
    "node.text.empty",
  );
  expect(beforeRejection?.saveSequence).toBe(0);
  expect(beforeRejection?.confirmedSequence).toBe(0);
  expect(beforeRejection?.pendingPagehide).toBeUndefined();
  await page.evaluate(() => {
    (window as typeof window & {
      __m86JournalGuard: { rejectPending: boolean };
    }).__m86JournalGuard.rejectPending = true;
  });
  await page.getByTestId("canvas-node-title").fill("A2");
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", {
      persisted: true,
    })));
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86JournalGuard: { rejections: number };
    }).__m86JournalGuard.rejections)).toBe(1);
  expect(putCount).toBe(0);
  const stored = await readCanvasSaveSession(page, "node.text.empty");
  expect(stored).toEqual(beforeRejection);
  const navigationsBeforeUnsafeRestore = mainFrameNavigations;
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", {
      persisted: true,
    })));
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  expect(mainFrameNavigations).toBe(navigationsBeforeUnsafeRestore);
  await expect(page.getByTestId("canvas-node-title"))
    .toHaveValue("A2");
  await expect(page.getByTestId("save-conflict")).toContainText(
    "浏览器会话存储不可用",
  );
  expect(putCount).toBe(0);
  expect(generationPosts()).toBe(0);
  await page.evaluate(() => {
    (window as typeof window & {
      __m86JournalGuard: { rejectPending: boolean };
    }).__m86JournalGuard.rejectPending = false;
  });
  await page.clock.resume();
  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  expect(putCount).toBe(0);
  const reloaded = await readCanvasSaveSession(page, "node.text.empty");
  expect(reloaded?.saveSessionId).toBe(stored?.saveSessionId);
  expect(reloaded?.saveSequence).toBe(0);
  expect(reloaded?.confirmedSequence).toBe(0);
  expect(reloaded?.pendingPagehide).toBeUndefined();
  expect(generationPosts()).toBe(0);
});

for (const casTrigger of ["normal-reserve", "pagehide"] as const) {
  test(`strict CAS ${casTrigger} stops before PUT when a legal higher record wins`, async ({
    page,
  }) => {
    await page.clock.install();
    let putCount = 0;
    const generationPosts = generationPostCount(page);
    await page.route("**/api/canvas/node.text.empty", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          body: JSON.stringify(textDocument("A1", 1)),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      putCount += 1;
      await route.fulfill({ status: 500 });
    });

    await page.goto("/__fixture/node.text.empty");
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-state",
      "ready",
    );
    await pauseBrowserClock(page);
    const injected = await page.evaluate((scopeId) => {
      const key = `unboundry:canvas-save-session:v2:${scopeId}`;
      const raw = window.sessionStorage.getItem(key);
      if (!raw) throw new Error("Expected an active canvas save session");
      const current = JSON.parse(raw) as SeededCanvasSaveSession;
      const higher: SeededCanvasSaveSession = {
        confirmedSequence: 7,
        saveSequence: 7,
        saveSessionId: current.saveSessionId,
        serverEpoch: current.serverEpoch,
        storageRevision: current.storageRevision + 1,
      };
      window.sessionStorage.setItem(key, JSON.stringify(higher));
      return higher;
    }, canvasSaveScope("node.text.empty"));
    await page.locator('.react-flow__node[data-id="text-primary"]').click();
    await page.getByTestId("canvas-node-title").fill("A2-local");
    if (casTrigger === "normal-reserve") {
      await page.clock.fastForward(600);
    } else {
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent("pagehide", {
          persisted: true,
        })));
    }
    await expect(page.getByTestId("save-conflict")).toContainText(
      "浏览器会话存储不可用",
    );
    expect(putCount).toBe(0);
    expect(await readCanvasSaveSession(page, "node.text.empty"))
      .toEqual(injected);
    await expect(page.getByTestId("canvas-node-title"))
      .toHaveValue("A2-local");
    expect(generationPosts()).toBe(0);
  });
}

test("synthetic pageshow state-machine keeps a pagehide journal above 60KB for reload replay without keepalive", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const originalAdd = window.addEventListener.bind(window) as (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => void;
    const originalRemove = window.removeEventListener.bind(window) as (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => void;
    const state = {
      canvasPuts: 0,
      disablePagehide: () => {
        for (const listener of listeners) {
          originalRemove("pagehide", listener);
        }
        listeners.clear();
      },
    };
    (window as typeof window & { __m86LargePagehide?: typeof state })
      .__m86LargePagehide = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "PUT" &&
        new URL(raw, window.location.href).pathname ===
          "/api/canvas/node.text.empty"
      ) {
        state.canvasPuts += 1;
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
    window.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "pagehide" && listener) listeners.add(listener);
      originalAdd(type, listener, options);
    }) as typeof window.addEventListener;
  });
  const puts: Array<Record<string, unknown>> = [];
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(textDocument("A1", 1)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 2,
        loadToken: LOAD_TOKEN_B,
        revision: 2,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await pauseBrowserClock(page);
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const largeTitle = `A2-${"x".repeat(70_000)}`;
  await page.getByTestId("canvas-node-title").fill(largeTitle);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", {
      persisted: true,
    })));
  expect(await page.evaluate(() =>
    (window as typeof window & {
      __m86LargePagehide: { canvasPuts: number };
    }).__m86LargePagehide.canvasPuts)).toBe(0);
  expect(puts).toHaveLength(0);
  const journaled = await readCanvasSaveSession(page, "node.text.empty");
  expect(journaled?.saveSequence).toBe(1);
  expect(journaled?.confirmedSequence).toBe(0);
  expect(journaled?.pendingPagehide?.saveSequence).toBe(1);
  const journalBytes = new TextEncoder().encode(
    journaled?.pendingPagehide?.payload ?? "",
  ).byteLength;
  expect(journalBytes).toBeGreaterThan(60 * 1024);
  expect(journalBytes).toBeLessThan(5_000_000);

  await page.evaluate(() => {
    (window as typeof window & {
      __m86LargePagehide: { disablePagehide: () => void };
    }).__m86LargePagehide.disablePagehide();
  });
  await page.clock.resume();
  const restoredReload = page.waitForEvent("framenavigated", {
    predicate: (frame) => frame === page.mainFrame(),
    timeout: 5_000,
  });
  await page.evaluate(() => {
    window.setTimeout(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", {
        persisted: true,
      }));
    }, 0);
  });
  await restoredReload;
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  expect(puts).toHaveLength(1);
  expect(puts[0].saveSequence).toBe(2);
  expect(puts[0].saveAttemptId).not.toBe(
    journaled?.pendingPagehide?.attemptId,
  );
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  expect(await page.getByTestId("canvas-node-title").inputValue())
    .toBe(largeTitle);
  const recovered = await readCanvasSaveSession(page, "node.text.empty");
  expect(recovered?.saveSequence).toBe(2);
  expect(recovered?.confirmedSequence).toBe(2);
  expect(recovered?.pendingPagehide).toBeUndefined();
  expect(generationPosts()).toBe(0);
});

test("an accepted pagehide survives settlement storage failure and reload clears it from the GET fence", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const pagehideListeners = new Set<EventListenerOrEventListenerObject>();
    const originalAddEventListener = window.addEventListener.bind(window) as (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => void;
    const originalRemoveEventListener = window.removeEventListener.bind(
      window,
    ) as (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => void;
    const state = {
      disablePagehide: () => {
        for (const listener of pagehideListeners) {
          originalRemoveEventListener("pagehide", listener);
        }
        pagehideListeners.clear();
      },
      rejectSettlement: false,
      rejections: 0,
    };
    (window as typeof window & { __m86SettlementFailure?: typeof state })
      .__m86SettlementFailure = state;
    window.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "pagehide" && listener) pagehideListeners.add(listener);
      originalAddEventListener(type, listener, options);
    }) as typeof window.addEventListener;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (
        state.rejectSettlement &&
        key.startsWith("unboundry:canvas-save-session:v2:") &&
        key !== "unboundry:canvas-save-session:v2:scopes"
      ) {
        const parsed = JSON.parse(value) as {
          confirmedSequence?: number;
          pendingPagehide?: unknown;
        };
        if (
          !parsed.pendingPagehide &&
          Number(parsed.confirmedSequence) >= 1
        ) {
          state.rejections += 1;
          throw new DOMException("Settlement denied", "QuotaExceededError");
        }
      }
      return originalSetItem.call(this, key, value);
    };
  });
  let accepted: Record<string, unknown> | undefined;
  const puts: Array<Record<string, unknown>> = [];
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      const document = accepted
        ? {
            ...textDocument("A2", 2, LOAD_TOKEN_B),
            currentWriterSequence: 1,
            currentWriterSessionId: accepted.saveSessionId,
            nodes: accepted.nodes,
            saveEpoch: SAVE_EPOCH_A,
            sessionHighWaterAttemptId: accepted.saveAttemptId,
            sessionHighWaterSequence: 1,
            viewport: accepted.viewport,
          }
        : textDocument("A1", 1);
      await route.fulfill({
        body: JSON.stringify(document),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    accepted = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(accepted);
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 2,
        loadToken: LOAD_TOKEN_B,
        revision: 2,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await pauseBrowserClock(page);
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.evaluate(() => {
    (window as typeof window & {
      __m86SettlementFailure: { rejectSettlement: boolean };
    }).__m86SettlementFailure.rejectSettlement = true;
  });
  await page.getByTestId("canvas-node-title").fill("A2");
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", {
      persisted: true,
    })));
  await expect.poll(() => puts.length).toBe(1);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86SettlementFailure: { rejections: number };
    }).__m86SettlementFailure.rejections)).toBe(1);
  const journaled = await readCanvasSaveSession(page, "node.text.empty");
  expect(journaled?.confirmedSequence).toBe(0);
  expect(journaled?.pendingPagehide?.attemptId).toBe(
    puts[0].saveAttemptId,
  );
  expect(journaled?.pendingPagehide?.saveSequence).toBe(1);

  await page.evaluate(() => {
    const state = (window as typeof window & {
      __m86SettlementFailure: {
        disablePagehide: () => void;
        rejectSettlement: boolean;
      };
    }).__m86SettlementFailure;
    state.rejectSettlement = false;
    state.disablePagehide();
  });
  await page.clock.resume();
  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  expect(puts).toHaveLength(1);
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await expect(page.getByTestId("canvas-node-title")).toHaveValue("A2");
  const recovered = await readCanvasSaveSession(page, "node.text.empty");
  expect(recovered?.saveSessionId).toBe(puts[0].saveSessionId);
  expect(recovered?.saveSequence).toBe(1);
  expect(recovered?.confirmedSequence).toBe(1);
  expect(recovered?.pendingPagehide).toBeUndefined();
  expect(Number(recovered?.storageRevision)).toBeGreaterThan(
    Number(journaled?.storageRevision),
  );
  expect(generationPosts()).toBe(0);
});

for (const invalidPagehideResult of [
  "bad-token",
  "graph-ahead",
  "malformed",
  "negative-graph",
  "negative-revision",
  "stale-positive",
  "unchanged-token",
  "zero-revision",
] as const satisfies readonly InvalidSaveResultKind[]) {
  test(`pagehide ${invalidPagehideResult} 2xx keeps its durable journal`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      const state = { putJsonResolved: 0, settlementWrites: 0 };
      (window as typeof window & { __m86InvalidPagehide?: typeof state })
        .__m86InvalidPagehide = state;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
        const url = new URL(raw, window.location.href);
        const method = (init?.method ??
          (input instanceof Request ? input.method : "GET")).toUpperCase();
        const response = await originalFetch(input, init);
        if (
          method === "PUT" &&
          url.pathname === "/api/canvas/node.text.empty"
        ) {
          const originalJson = response.json.bind(response);
          response.json = async () => {
            const value = await originalJson();
            state.putJsonResolved += 1;
            return value;
          };
        }
        return response;
      }) as typeof window.fetch;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        if (
          key.startsWith("unboundry:canvas-save-session:v2:") &&
          key !== "unboundry:canvas-save-session:v2:scopes"
        ) {
          const parsed = JSON.parse(value) as {
            confirmedSequence?: number;
            pendingPagehide?: unknown;
          };
          if (
            !parsed.pendingPagehide &&
            Number(parsed.confirmedSequence) >= 1
          ) {
            state.settlementWrites += 1;
          }
        }
        return originalSetItem.call(this, key, value);
      };
    });
    const puts: Array<Record<string, unknown>> = [];
    const generationPosts = generationPostCount(page);
    await page.route("**/api/canvas/node.text.empty", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          body: JSON.stringify(textDocument("A1", 1)),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      puts.push(body);
      const result = invalidCanvasSaveResult(
        invalidPagehideResult,
        Number(body.revision),
        String(body.observedLoadToken),
      );
      await route.fulfill({
        body: JSON.stringify(result),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/__fixture/node.text.empty");
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-state",
      "ready",
    );
    await pauseBrowserClock(page);
    await page.locator('.react-flow__node[data-id="text-primary"]').click();
    await page.getByTestId("canvas-node-title").fill("A2");
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide", {
        persisted: true,
      })));
    await expect.poll(() => puts.length).toBe(1);
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m86InvalidPagehide: { putJsonResolved: number };
      }).__m86InvalidPagehide.putJsonResolved)).toBe(1);
    await flushBrowserTasks(page);
    await flushBrowserTasks(page);
    const stored = await readCanvasSaveSession(page, "node.text.empty");
    expect(stored?.confirmedSequence).toBe(0);
    expect(stored?.saveSequence).toBe(1);
    expect(stored?.pendingPagehide?.attemptId).toBe(
      puts[0].saveAttemptId,
    );
    expect(stored?.pendingPagehide?.saveSequence).toBe(1);
    expect(JSON.parse(stored?.pendingPagehide?.payload ?? "{}"))
      .toEqual(puts[0]);
    expect(await page.evaluate(() =>
      (window as typeof window & {
        __m86InvalidPagehide: { settlementWrites: number };
      }).__m86InvalidPagehide.settlementWrites)).toBe(0);
    expect(generationPosts()).toBe(0);
  });
}

for (const invalidReplayResult of [
  "bad-token",
  "graph-ahead",
  "malformed",
  "negative-graph",
  "negative-revision",
  "stale-positive",
  "unchanged-token",
  "zero-revision",
] as const satisfies readonly InvalidSaveResultKind[]) {
  test(`pending replay ${invalidReplayResult} 2xx fails load and preserves the replay journal`, async ({
    page,
  }) => {
    const canvasId = "node.text.empty";
    const pendingPayload = canvasSavePayload({ canvasTitle: "A2" });
    await seedCanvasSaveSession(page, canvasId, {
      confirmedSequence: 0,
      pendingPagehide: {
        attemptId: SAVE_ATTEMPT_A,
        payload: pendingPayload,
        saveSequence: 1,
        serverEpoch: SAVE_EPOCH_A,
      },
      saveSequence: 1,
      saveSessionId: SAVE_SESSION_A,
      serverEpoch: SAVE_EPOCH_A,
      storageRevision: 0,
    });
    const puts: Array<Record<string, unknown>> = [];
    const generationPosts = generationPostCount(page);
    await page.route(`**/api/canvas/${canvasId}`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          body: JSON.stringify(textDocument("A1", 1)),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      puts.push(body);
      const result = invalidCanvasSaveResult(
        invalidReplayResult,
        Number(body.revision),
        String(body.observedLoadToken),
      );
      await route.fulfill({
        body: JSON.stringify(result),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto(`/__fixture/${canvasId}`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-state",
      "failed",
    );
    expect(puts).toHaveLength(1);
    expect(puts[0].saveSequence).toBe(2);
    expect(puts[0].saveAttemptId).not.toBe(SAVE_ATTEMPT_A);
    const stored = await readCanvasSaveSession(page, canvasId);
    expect(stored?.confirmedSequence).toBe(0);
    expect(stored?.saveSequence).toBe(2);
    expect(stored?.saveSessionId).toBe(SAVE_SESSION_A);
    expect(stored?.pendingPagehide?.saveSequence).toBe(2);
    expect(stored?.pendingPagehide?.attemptId).toBe(
      puts[0].saveAttemptId,
    );
    expect(JSON.parse(stored?.pendingPagehide?.payload ?? "{}"))
      .toEqual(puts[0]);
    expect(generationPosts()).toBe(0);
  });
}

for (const invalidCreateResult of [
  "bad-token",
  "graph-ahead",
  "malformed",
  "negative-graph",
  "negative-revision",
  "zero-revision",
] as const satisfies readonly InvalidSaveResultKind[]) {
  test(`initial create ${invalidCreateResult} 2xx fails load and preserves its journal`, async ({
    page,
  }) => {
    const canvasId = "persistence.final-clean-canvas";
    const puts: Array<Record<string, unknown>> = [];
    const generationPosts = generationPostCount(page);
    await page.route(`**/api/canvas/${canvasId}`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          body: JSON.stringify({
            ...emptyFence,
            code: "CANVAS_NOT_FOUND",
            error: "Canvas not found",
          }),
          contentType: "application/json",
          status: 404,
        });
        return;
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      puts.push(body);
      await route.fulfill({
        body: JSON.stringify(invalidCanvasSaveResult(
          invalidCreateResult,
          Number(body.revision),
        )),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto(`/__fixture/${canvasId}`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-state",
      "failed",
    );
    expect(puts).toHaveLength(1);
    expect(puts[0].revision).toBe(0);
    expect(puts[0].saveSequence).toBe(1);
    const stored = await readCanvasSaveSession(page, canvasId);
    expect(stored?.confirmedSequence).toBe(0);
    expect(stored?.saveSequence).toBe(1);
    expect(stored?.pendingPagehide?.attemptId).toBe(
      puts[0].saveAttemptId,
    );
    expect(stored?.pendingPagehide?.saveSequence).toBe(1);
    expect(JSON.parse(stored?.pendingPagehide?.payload ?? "{}"))
      .toEqual(puts[0]);
    expect(generationPosts()).toBe(0);
  });
}

async function runInitialCreateRecovery(
  page: Page,
  firstOutcome: "committed-lost-response" | "uncommitted-500",
) {
  const canvasId = "persistence.final-clean-canvas";
  let serverDocument: Record<string, unknown> | undefined;
  const puts: Array<Record<string, unknown>> = [];
  const generationPosts = generationPostCount(page);
  const commit = (body: Record<string, unknown>) => {
    serverDocument = {
      currentWriterSequence: body.saveSequence,
      currentWriterSessionId: body.saveSessionId,
      edges: body.edges,
      graphRevision: 1,
      loadToken: LOAD_TOKEN_A,
      nodes: body.nodes,
      revision: 1,
      saveEpoch: SAVE_EPOCH_A,
      sessionHighWaterAttemptId: body.saveAttemptId,
      sessionHighWaterSequence: body.saveSequence,
      viewport: body.viewport,
    };
  };
  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() === "GET") {
      if (serverDocument) {
        await route.fulfill({
          body: JSON.stringify(serverDocument),
          contentType: "application/json",
          status: 200,
        });
      } else {
        await route.fulfill({
          body: JSON.stringify({
            ...emptyFence,
            code: "CANVAS_NOT_FOUND",
            error: "Canvas not found",
          }),
          contentType: "application/json",
          status: 404,
        });
      }
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    if (puts.length === 1) {
      if (firstOutcome === "committed-lost-response") {
        commit(body);
        await route.abort("failed");
      } else {
        await route.fulfill({
          body: JSON.stringify({ code: "TEST_500", error: "not committed" }),
          contentType: "application/json",
          status: 500,
        });
      }
      return;
    }
    commit(body);
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 1,
        loadToken: LOAD_TOKEN_A,
        revision: 1,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "failed",
  );
  expect(puts).toHaveLength(1);
  expect(puts[0].saveSequence).toBe(1);
  const firstJournal = await readCanvasSaveSession(page, canvasId);
  expect(firstJournal?.confirmedSequence).toBe(0);
  expect(firstJournal?.saveSequence).toBe(1);
  expect(firstJournal?.pendingPagehide?.attemptId).toBe(
    puts[0].saveAttemptId,
  );
  expect(firstJournal?.pendingPagehide?.saveSequence).toBe(1);

  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  const expectedFinalSequence = firstOutcome === "committed-lost-response"
    ? 1
    : 2;
  expect(puts).toHaveLength(expectedFinalSequence);
  if (firstOutcome === "uncommitted-500") {
    expect(puts.map((body) => body.saveSequence)).toEqual([1, 2]);
    expect(puts[1].saveAttemptId).not.toBe(puts[0].saveAttemptId);
  }
  const finalAttempt = puts.at(-1)!;
  expect(serverDocument?.currentWriterSequence).toBe(expectedFinalSequence);
  expect(serverDocument?.currentWriterSessionId).toBe(
    finalAttempt.saveSessionId,
  );
  expect(serverDocument?.sessionHighWaterAttemptId).toBe(
    finalAttempt.saveAttemptId,
  );
  expect(serverDocument?.sessionHighWaterSequence).toBe(
    expectedFinalSequence,
  );
  const recovered = await readCanvasSaveSession(page, canvasId);
  expect(recovered?.saveSessionId).toBe(finalAttempt.saveSessionId);
  expect(recovered?.saveSequence).toBe(expectedFinalSequence);
  expect(recovered?.confirmedSequence).toBe(expectedFinalSequence);
  expect(recovered?.pendingPagehide).toBeUndefined();
  expect(generationPosts()).toBe(0);
}

for (const createRecovery of [
  "committed-lost-response",
  "uncommitted-500",
] as const) {
  test(`initial create ${createRecovery} recovers from its durable journal`, async ({
    page,
  }) => {
    await runInitialCreateRecovery(page, createRecovery);
  });
}

test("a late synthetic persisted-pagehide success cannot lower sequence or erase a different pending attempt", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const state = {
      afterOldRelease: false,
      putJsonResolved: 0,
      writesAfterOldRelease: 0,
    };
    (window as typeof window & { __m86LatePagehide?: typeof state })
      .__m86LatePagehide = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      const response = await originalFetch(input, init);
      if (
        method === "PUT" &&
        url.pathname === "/api/canvas/node.text.empty" &&
        response.ok
      ) {
        const originalJson = response.json.bind(response);
        response.json = async () => {
          const value = await originalJson();
          state.putJsonResolved += 1;
          return value;
        };
      }
      return response;
    }) as typeof window.fetch;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (
        state.afterOldRelease &&
        key.startsWith("unboundry:canvas-save-session:v2:") &&
        key !== "unboundry:canvas-save-session:v2:scopes"
      ) {
        state.writesAfterOldRelease += 1;
      }
      return original.call(this, key, value);
    };
  });
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const puts: Array<Record<string, unknown>> = [];
  const generationPosts = generationPostCount(page);
  await page.route("**/api/canvas/node.text.empty", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(textDocument("A1", 1)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    if (body.saveSequence === 1) {
      await oldGate;
      await route.fulfill({
        body: JSON.stringify({
          graphRevision: 2,
          loadToken: LOAD_TOKEN_B,
          revision: 2,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    expect(body.saveSequence).toBe(1);
    await oldGate;
    await route.fulfill({ status: 500 });
  });

  await page.goto("/__fixture/node.text.empty");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-state",
    "ready",
  );
  await pauseBrowserClock(page);
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await title.fill("A2");
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", {
      persisted: true,
    })));
  await expect.poll(() => puts.length).toBe(1);
  const newerAttemptId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const newerPayload = canvasSavePayload({
    attemptId: newerAttemptId,
    canvasTitle: "A3",
    saveSequence: 2,
    saveSessionId: String(puts[0].saveSessionId),
  });
  await page.evaluate(({ attemptId, payload, scopeId, serverEpoch }) => {
    const key = `unboundry:canvas-save-session:v2:${scopeId}`;
    const raw = window.sessionStorage.getItem(key);
    if (!raw) throw new Error("Expected the first pagehide journal");
    const current = JSON.parse(raw) as SeededCanvasSaveSession;
    const injected: SeededCanvasSaveSession = {
      ...current,
      pendingPagehide: {
        attemptId,
        payload,
        saveSequence: 2,
        serverEpoch,
      },
      saveSequence: 2,
      storageRevision: current.storageRevision + 1,
    };
    window.sessionStorage.setItem(key, JSON.stringify(injected));
  }, {
    attemptId: newerAttemptId,
    payload: newerPayload,
    scopeId: canvasSaveScope("node.text.empty"),
    serverEpoch: SAVE_EPOCH_A,
  });
  const beforeOld = await readCanvasSaveSession(page, "node.text.empty");
  expect(beforeOld?.saveSequence).toBe(2);
  expect(beforeOld?.pendingPagehide?.attemptId).toBe(newerAttemptId);

  const oldResponse = page.waitForResponse((response) => {
    if (
      response.request().method() !== "PUT" ||
      new URL(response.url()).pathname !== "/api/canvas/node.text.empty"
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as Record<string, unknown>;
    return body.saveSequence === 1;
  });
  await page.evaluate(() => {
    (window as typeof window & {
      __m86LatePagehide: { afterOldRelease: boolean };
    }).__m86LatePagehide.afterOldRelease = true;
  });
  releaseOld();
  await oldResponse;
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86LatePagehide: { putJsonResolved: number };
    }).__m86LatePagehide.putJsonResolved)).toBe(1);
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  expect(await page.evaluate(() =>
    (window as typeof window & {
      __m86LatePagehide: { writesAfterOldRelease: number };
    }).__m86LatePagehide.writesAfterOldRelease)).toBe(0);

  const stored = await readCanvasSaveSession(page, "node.text.empty");
  expect(stored).toEqual(beforeOld);
  expect(Number(stored?.storageRevision)).toBeGreaterThanOrEqual(
    Number(beforeOld?.storageRevision),
  );
  expect(stored?.pendingPagehide?.saveSequence).toBe(2);
  expect(stored?.pendingPagehide?.attemptId).toBe(newerAttemptId);
  const pendingBody = JSON.parse(stored?.pendingPagehide?.payload ?? "{}") as {
    nodes?: Array<{ data?: { title?: string }; id?: string }>;
  };
  expect(pendingBody.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      data: expect.objectContaining({ title: "A3" }),
      id: "text-primary",
    }),
  ]));
  expect(generationPosts()).toBe(0);
  expect(puts).toHaveLength(1);
});

for (const externalBaselineFailure of ["GET 500", "hung timeout"] as const) {
  test(`a pre-debounce A2 journals before a B broadcast whose external baseline ${externalBaselineFailure}`, async ({
    page,
  }) => {
    const canvasId = "node.text.empty";
    await page.clock.install();
    await installControllableBroadcastChannel(page);
    await page.addInitScript(({ canvasId, failure }) => {
      const state = {
        externalGets: 0,
        failNextExternal: false,
      };
      (window as typeof window & {
        __m86PreDebounceExternal?: typeof state;
      }).__m86PreDebounceExternal = state;
      const originalFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
        const url = new URL(raw, window.location.href);
        const method = (init?.method ??
          (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (
          method === "GET" &&
          url.pathname === `/api/canvas/${canvasId}` &&
          state.failNextExternal
        ) {
          state.failNextExternal = false;
          state.externalGets += 1;
          if (failure === "GET 500") {
            return Promise.resolve(new Response(JSON.stringify({
              code: "M86_EXTERNAL_BASELINE_500",
              error: "offline",
            }), {
              headers: { "Content-Type": "application/json" },
              status: 500,
            }));
          }
          return new Promise<Response>((_resolve, reject) => {
            const abort = () =>
              reject(new DOMException("external baseline timed out", "AbortError"));
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        return originalFetch(input, init);
      }) as typeof window.fetch;
    }, { canvasId, failure: externalBaselineFailure });

    let serverDocument = textDocument("A1", 1, LOAD_TOKEN_A);
    const puts: Array<Record<string, unknown>> = [];
    const generationPosts = generationPostCount(page);
    await page.route(`**/api/canvas/${canvasId}`, async (route) => {
      const inbound = route.request();
      if (inbound.method() === "GET") {
        await route.fulfill({
          body: JSON.stringify(serverDocument),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      const body = inbound.postDataJSON() as Record<string, unknown>;
      puts.push(body);
      serverDocument = {
        ...serverDocument,
        currentWriterSequence: Number(body.saveSequence),
        currentWriterSessionId: String(body.saveSessionId),
        edges: body.edges as typeof serverDocument.edges,
        graphRevision: 3,
        loadToken: LOAD_TOKEN_C,
        nodes: body.nodes as typeof serverDocument.nodes,
        revision: 3,
        sessionHighWaterAttemptId: String(body.saveAttemptId),
        sessionHighWaterSequence: Number(body.saveSequence),
        viewport: body.viewport as typeof serverDocument.viewport,
      };
      await route.fulfill({
        body: JSON.stringify({
          graphRevision: 3,
          loadToken: LOAD_TOKEN_C,
          revision: 3,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto(`/__fixture/${canvasId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-state", "ready");
    await page.locator('.react-flow__node[data-id="text-primary"]').click();
    const title = page.getByTestId("canvas-node-title");
    await pauseBrowserClock(page);
    await title.fill("A2");
    await title.press("Enter");
    await flushBrowserTasks(page);
    expect(puts).toHaveLength(0);

    serverDocument = textDocument("B1", 2, LOAD_TOKEN_B);
    await page.evaluate(() => {
      const state = (window as typeof window & {
        __m86PreDebounceExternal?: { failNextExternal: boolean };
      }).__m86PreDebounceExternal;
      if (state) state.failNextExternal = true;
    });
    expect(await emitExternalCanvasSave(page, 2)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m86PreDebounceExternal?: { externalGets: number };
      }).__m86PreDebounceExternal?.externalGets ?? 0)).toBe(1);
    if (externalBaselineFailure === "hung timeout") {
      await page.clock.fastForward(30_100);
    }
    await expect(world).toHaveAttribute("data-persistence-ready", "false");
    await expect(page.getByTestId("canvas-load-state")).toBeVisible();
    await expect(title).toHaveValue("A2");

    await expect.poll(async () => Boolean(
      (await readCanvasSaveSession(page, canvasId))?.pendingPagehide,
    )).toBe(true);
    const journaled = await readCanvasSaveSession(page, canvasId);
    expect(journaled?.confirmedSequence).toBe(0);
    expect(journaled?.saveSequence).toBe(1);
    expect(journaled?.pendingPagehide?.saveSequence).toBe(1);
    const journalBody = JSON.parse(
      journaled?.pendingPagehide?.payload ?? "{}",
    ) as {
      nodes?: Array<{ data?: { title?: string }; id?: string }>;
    };
    expect(journalBody.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({ title: "A2" }),
        id: "text-primary",
      }),
    ]));

    const titleBox = await title.boundingBox();
    expect(titleBox).not.toBeNull();
    await page.mouse.click(
      titleBox!.x + titleBox!.width / 2,
      titleBox!.y + titleBox!.height / 2,
    );
    await page.keyboard.type("A3");
    await expect(title).toHaveValue("A2");
    expect(puts).toHaveLength(0);

    await page.clock.resume();
    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-state", "ready");
    await expect.poll(() => puts.length).toBe(1);
    const replay = puts[0];
    expect(replay.observedRevision).toBe(2);
    expect(replay.observedLoadToken).toBe(LOAD_TOKEN_B);
    expect(replay.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({ title: "A2" }),
        id: "text-primary",
      }),
    ]));
    await page.locator('.react-flow__node[data-id="text-primary"]').click();
    await expect(page.getByTestId("canvas-node-title")).toHaveValue("A2");
    const reconciled = await readCanvasSaveSession(page, canvasId);
    expect(reconciled?.confirmedSequence).toBe(2);
    expect(reconciled?.saveSequence).toBe(2);
    expect(reconciled?.pendingPagehide).toBeUndefined();
    expect(generationPosts()).toBe(0);
  });
}

test("initial GET headers with an abort-ignoring body hit the hard load deadline and cannot replay their journal late", async ({
  page,
}) => {
  const canvasId = "node.text.empty";
  const pendingPayload = canvasSavePayload({ canvasTitle: "A2" });
  await page.clock.install();
  await seedCanvasSaveSession(page, canvasId, {
    confirmedSequence: 0,
    pendingPagehide: {
      attemptId: SAVE_ATTEMPT_A,
      payload: pendingPayload,
      saveSequence: 1,
      serverEpoch: SAVE_EPOCH_A,
    },
    saveSequence: 1,
    saveSessionId: SAVE_SESSION_A,
    serverEpoch: SAVE_EPOCH_A,
    storageRevision: 0,
  });
  await page.addInitScript(({ canvasId, document }) => {
    const state: {
      aborts: number;
      bodyReads: number;
      generationPosts: number;
      puts: number;
      releaseBodies: Array<() => void>;
    } = {
      aborts: 0,
      bodyReads: 0,
      generationPosts: 0,
      puts: 0,
      releaseBodies: [],
    };
    (window as typeof window & {
      __m86InitialHungBody?: typeof state;
    }).__m86InitialHungBody = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "POST" &&
        url.pathname.startsWith("/api/generation-tasks")
      ) {
        state.generationPosts += 1;
      }
      if (url.pathname !== `/api/canvas/${canvasId}`) {
        return originalFetch(input, init);
      }
      if (method === "PUT") {
        state.puts += 1;
        return Promise.resolve(new Response(JSON.stringify({
          graphRevision: 2,
          loadToken: "22222222-2222-4222-8222-222222222222",
          revision: 2,
        }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      const response = new Response(null, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
      Object.defineProperty(response, "json", {
        configurable: true,
        value: () => {
          state.bodyReads += 1;
          return new Promise((resolve) => {
            state.releaseBodies.push(() => resolve(document));
          });
        },
      });
      init?.signal?.addEventListener("abort", () => {
        // Deliberately observe but ignore the abort. The load deadline must
        // invalidate this continuation independently of transport behavior.
        state.aborts += 1;
      }, { once: true });
      return Promise.resolve(response);
    }) as typeof window.fetch;
  }, { canvasId, document: textDocument("A1", 1) });

  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86InitialHungBody?: { bodyReads: number };
    }).__m86InitialHungBody?.bodyReads ?? 0)).toBeGreaterThanOrEqual(1);
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  const startedBodyReads = await page.evaluate(() =>
    (window as typeof window & {
      __m86InitialHungBody: { bodyReads: number };
    }).__m86InitialHungBody.bodyReads);
  await page.clock.fastForward(30_100);
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  const beforeRelease = await readCanvasSaveSession(page, canvasId);
  expect(beforeRelease?.confirmedSequence).toBe(0);
  expect(beforeRelease?.saveSequence).toBe(1);
  expect(beforeRelease?.pendingPagehide).toEqual({
    attemptId: SAVE_ATTEMPT_A,
    payload: pendingPayload,
    saveSequence: 1,
    serverEpoch: SAVE_EPOCH_A,
  });

  await page.evaluate(() => {
    (window as typeof window & {
      __m86InitialHungBody?: { releaseBodies: Array<() => void> };
    }).__m86InitialHungBody?.releaseBodies.splice(0).forEach((release) => {
      release();
    });
  });
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  await expect(page.locator('.react-flow__node[data-id="text-primary"]'))
    .toHaveCount(0);
  const afterRelease = await readCanvasSaveSession(page, canvasId);
  expect(afterRelease?.confirmedSequence).toBe(0);
  expect(afterRelease?.saveSequence).toBe(1);
  expect(afterRelease?.pendingPagehide).toEqual(beforeRelease?.pendingPagehide);
  const state = await page.evaluate(() =>
    (window as typeof window & {
      __m86InitialHungBody: {
        aborts: number;
        bodyReads: number;
        generationPosts: number;
        puts: number;
      };
    }).__m86InitialHungBody);
  expect(state.bodyReads).toBe(startedBodyReads);
  expect(state.aborts).toBe(startedBodyReads);
  expect(state.puts).toBe(0);
  expect(state.generationPosts).toBe(0);
});

test("external baseline headers with an abort-ignoring body keep the pre-debounce journal and cannot write back late", async ({
  page,
}) => {
  const canvasId = "node.text.empty";
  await page.clock.install();
  await installControllableBroadcastChannel(page);
  await page.addInitScript(({ canvasId, nextDocument }) => {
    const state: {
      aborts: number;
      bodyReads: number;
      failNextExternal: boolean;
      releaseBody?: () => void;
    } = { aborts: 0, bodyReads: 0, failNextExternal: false };
    (window as typeof window & {
      __m86ExternalHungBody?: typeof state;
    }).__m86ExternalHungBody = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method !== "GET" ||
        url.pathname !== `/api/canvas/${canvasId}` ||
        !state.failNextExternal
      ) {
        return originalFetch(input, init);
      }
      state.failNextExternal = false;
      const response = new Response(null, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
      Object.defineProperty(response, "json", {
        configurable: true,
        value: () => {
          state.bodyReads += 1;
          return new Promise((resolve) => {
            state.releaseBody = () => resolve(nextDocument);
          });
        },
      });
      init?.signal?.addEventListener("abort", () => {
        state.aborts += 1;
      }, { once: true });
      return Promise.resolve(response);
    }) as typeof window.fetch;
  }, {
    canvasId,
    nextDocument: textDocument("B1", 2, LOAD_TOKEN_B),
  });

  let serverDocument = textDocument("A1", 1, LOAD_TOKEN_A);
  const puts: Array<Record<string, unknown>> = [];
  const generationPosts = generationPostCount(page);
  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(serverDocument),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    puts.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      body: JSON.stringify({
        graphRevision: 3,
        loadToken: LOAD_TOKEN_C,
        revision: 3,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-state", "ready");
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  const title = page.getByTestId("canvas-node-title");
  await pauseBrowserClock(page);
  await title.fill("A2");
  await title.press("Enter");
  await flushBrowserTasks(page);
  expect(puts).toHaveLength(0);

  serverDocument = textDocument("B1", 2, LOAD_TOKEN_B);
  await page.evaluate(() => {
    const state = (window as typeof window & {
      __m86ExternalHungBody?: { failNextExternal: boolean };
    }).__m86ExternalHungBody;
    if (state) state.failNextExternal = true;
  });
  expect(await emitExternalCanvasSave(page, 2)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86ExternalHungBody?: { bodyReads: number };
    }).__m86ExternalHungBody?.bodyReads ?? 0)).toBe(1);
  await page.clock.fastForward(30_100);
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  await expect(world).toHaveAttribute("data-persistence-ready", "false");
  await expect(title).toHaveValue("A2");
  const beforeRelease = await readCanvasSaveSession(page, canvasId);
  expect(beforeRelease?.confirmedSequence).toBe(0);
  expect(beforeRelease?.saveSequence).toBe(1);
  expect(beforeRelease?.pendingPagehide?.saveSequence).toBe(1);
  expect(JSON.parse(beforeRelease?.pendingPagehide?.payload ?? "{}"))
    .toEqual(expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ title: "A2" }),
          id: "text-primary",
        }),
      ]),
    }));

  await page.evaluate(() => {
    (window as typeof window & {
      __m86ExternalHungBody?: { releaseBody?: () => void };
    }).__m86ExternalHungBody?.releaseBody?.();
  });
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  await expect(title).toHaveValue("A2");
  const afterRelease = await readCanvasSaveSession(page, canvasId);
  expect(afterRelease?.confirmedSequence).toBe(0);
  expect(afterRelease?.saveSequence).toBe(1);
  expect(afterRelease?.pendingPagehide).toEqual(beforeRelease?.pendingPagehide);
  expect(puts).toHaveLength(0);
  expect(generationPosts()).toBe(0);
  const aborts = await page.evaluate(() =>
    (window as typeof window & {
      __m86ExternalHungBody?: { aborts: number };
    }).__m86ExternalHungBody?.aborts ?? 0);
  expect(aborts).toBe(1);
});

test("initial 404 create PUT headers with an abort-ignoring body fail once and keep the create journal", async ({
  page,
}) => {
  const canvasId = "persistence.final-clean-canvas";
  await page.clock.install();
  await page.addInitScript(({ canvasId, loadToken, missingFence }) => {
    const state: {
      aborts: number;
      generationPosts: number;
      payloads: string[];
      releaseBody?: () => void;
    } = { aborts: 0, generationPosts: 0, payloads: [] };
    (window as typeof window & {
      __m86CreateHungBody?: typeof state;
    }).__m86CreateHungBody = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "POST" &&
        url.pathname.startsWith("/api/generation-tasks")
      ) {
        state.generationPosts += 1;
      }
      if (url.pathname !== `/api/canvas/${canvasId}`) {
        return originalFetch(input, init);
      }
      if (method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(missingFence), {
          headers: { "Content-Type": "application/json" },
          status: 404,
        }));
      }
      state.payloads.push(String(init?.body ?? ""));
      const response = new Response(null, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
      Object.defineProperty(response, "json", {
        configurable: true,
        value: () => new Promise((resolve) => {
          state.releaseBody = () => resolve({
            graphRevision: 1,
            loadToken,
            revision: 1,
          });
        }),
      });
      init?.signal?.addEventListener("abort", () => {
        state.aborts += 1;
      }, { once: true });
      return Promise.resolve(response);
    }) as typeof window.fetch;
  }, {
    canvasId,
    loadToken: LOAD_TOKEN_A,
    missingFence: {
      ...emptyFence,
      code: "CANVAS_NOT_FOUND",
      error: "Canvas not found",
    },
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86CreateHungBody?: { payloads: string[] };
    }).__m86CreateHungBody?.payloads.length ?? 0)).toBe(1);
  await page.clock.fastForward(6_100);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  await expect(world).toHaveAttribute("data-persistence-ready", "false");
  const beforeRelease = await readCanvasSaveSession(page, canvasId);
  const payloads = await page.evaluate(() =>
    (window as typeof window & {
      __m86CreateHungBody: { payloads: string[] };
    }).__m86CreateHungBody.payloads);
  expect(beforeRelease?.confirmedSequence).toBe(0);
  expect(beforeRelease?.saveSequence).toBe(1);
  expect(beforeRelease?.pendingPagehide?.saveSequence).toBe(1);
  expect(beforeRelease?.pendingPagehide?.payload).toBe(payloads[0]);

  await page.evaluate(() => {
    (window as typeof window & {
      __m86CreateHungBody?: { releaseBody?: () => void };
    }).__m86CreateHungBody?.releaseBody?.();
  });
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  const afterRelease = await readCanvasSaveSession(page, canvasId);
  expect(afterRelease?.confirmedSequence).toBe(0);
  expect(afterRelease?.saveSequence).toBe(1);
  expect(afterRelease?.pendingPagehide).toEqual(beforeRelease?.pendingPagehide);
  const state = await page.evaluate(() =>
    (window as typeof window & {
      __m86CreateHungBody: {
        aborts: number;
        generationPosts: number;
        payloads: string[];
      };
    }).__m86CreateHungBody);
  expect(state.aborts).toBe(1);
  expect(state.payloads).toHaveLength(1);
  expect(state.generationPosts).toBe(0);
});

test("pending replay PUT headers with an abort-ignoring body fail once and cannot settle their journal late", async ({
  page,
}) => {
  const canvasId = "node.text.empty";
  const pendingPayload = canvasSavePayload({ canvasTitle: "A2" });
  await page.clock.install();
  await seedCanvasSaveSession(page, canvasId, {
    confirmedSequence: 0,
    pendingPagehide: {
      attemptId: SAVE_ATTEMPT_A,
      payload: pendingPayload,
      saveSequence: 1,
      serverEpoch: SAVE_EPOCH_A,
    },
    saveSequence: 1,
    saveSessionId: SAVE_SESSION_A,
    serverEpoch: SAVE_EPOCH_A,
    storageRevision: 0,
  });
  await page.addInitScript(({ canvasId, document, loadToken }) => {
    const state: {
      aborts: number;
      generationPosts: number;
      payloads: string[];
      releaseBody?: () => void;
    } = { aborts: 0, generationPosts: 0, payloads: [] };
    (window as typeof window & {
      __m86ReplayHungBody?: typeof state;
    }).__m86ReplayHungBody = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "POST" &&
        url.pathname.startsWith("/api/generation-tasks")
      ) {
        state.generationPosts += 1;
      }
      if (url.pathname !== `/api/canvas/${canvasId}`) {
        return originalFetch(input, init);
      }
      if (method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(document), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      state.payloads.push(String(init?.body ?? ""));
      const response = new Response(null, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
      Object.defineProperty(response, "json", {
        configurable: true,
        value: () => new Promise((resolve) => {
          state.releaseBody = () => resolve({
            graphRevision: 2,
            loadToken,
            revision: 2,
          });
        }),
      });
      init?.signal?.addEventListener("abort", () => {
        state.aborts += 1;
      }, { once: true });
      return Promise.resolve(response);
    }) as typeof window.fetch;
  }, {
    canvasId,
    document: textDocument("A1", 1, LOAD_TOKEN_A),
    loadToken: LOAD_TOKEN_B,
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __m86ReplayHungBody?: { payloads: string[] };
    }).__m86ReplayHungBody?.payloads.length ?? 0)).toBe(1);
  const duringReplay = await readCanvasSaveSession(page, canvasId);
  expect(duringReplay?.confirmedSequence).toBe(0);
  expect(duringReplay?.saveSequence).toBeGreaterThan(1);
  expect(duringReplay?.pendingPagehide?.saveSequence)
    .toBe(duringReplay?.saveSequence);
  const replayPayload = await page.evaluate(() =>
    (window as typeof window & {
      __m86ReplayHungBody: { payloads: string[] };
    }).__m86ReplayHungBody.payloads[0]);
  expect(duringReplay?.pendingPagehide?.payload).toBe(replayPayload);
  expect(JSON.parse(replayPayload)).toEqual(expect.objectContaining({
    nodes: expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({ title: "A2" }),
        id: "text-primary",
      }),
    ]),
    observedLoadToken: LOAD_TOKEN_A,
    observedRevision: 1,
  }));

  await page.clock.fastForward(6_100);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  await expect(world).toHaveAttribute("data-persistence-ready", "false");
  const beforeRelease = await readCanvasSaveSession(page, canvasId);
  expect(beforeRelease?.pendingPagehide).toEqual(duringReplay?.pendingPagehide);
  await page.evaluate(() => {
    (window as typeof window & {
      __m86ReplayHungBody?: { releaseBody?: () => void };
    }).__m86ReplayHungBody?.releaseBody?.();
  });
  await flushBrowserTasks(page);
  await flushBrowserTasks(page);
  await expect(world).toHaveAttribute("data-persistence-state", "failed");
  const afterRelease = await readCanvasSaveSession(page, canvasId);
  expect(afterRelease?.confirmedSequence).toBe(0);
  expect(afterRelease?.saveSequence).toBe(beforeRelease?.saveSequence);
  expect(afterRelease?.pendingPagehide).toEqual(beforeRelease?.pendingPagehide);
  const state = await page.evaluate(() =>
    (window as typeof window & {
      __m86ReplayHungBody: {
        aborts: number;
        generationPosts: number;
        payloads: string[];
      };
    }).__m86ReplayHungBody);
  expect(state.aborts).toBe(1);
  expect(state.payloads).toHaveLength(1);
  expect(state.generationPosts).toBe(0);
});
