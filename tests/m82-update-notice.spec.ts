import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "./safe-test";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");
const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as { version: string };

type UpdateSequenceStep =
  | { kind: "http"; status: 401 | 403 | 502 | 503 }
  | {
      durationMs: number;
      kind: "http-window";
      recoveryVersion: string;
      statuses: Array<502 | 503>;
    }
  | {
      event: "maintenance" | "shutdown";
      kind: "event";
      retryAfterSeconds: number;
    }
  | {
      keepOpen?: boolean;
      kind: "sse";
      retryMs?: number;
      version: string;
    };

type StartServerOptions = {
  authBypass?: boolean;
  port?: number;
  updateSequence?: UpdateSequenceStep[];
};

async function startServer(
  dataDirectory: string,
  options: StartServerOptions = {},
) {
  const serverPort = options.port ?? port;
  let configPath: string | undefined;
  if (options.updateSequence) {
    // First-install startup requires an entry-free data directory. Test
    // controls stay beside it inside the runner-owned temporary test root.
    configPath = join(dirname(dataDirectory), `${basename(dataDirectory)}-update-sequence.vite.config.mjs`);
    const baseConfigUrl = pathToFileURL(join(process.cwd(), "vite.config.ts"))
      .href;
    await writeFile(
      configPath,
      `import baseConfig from ${JSON.stringify(baseConfigUrl)};

const updateSequence = ${JSON.stringify(options.updateSequence)};
let sequenceIndex = 0;
let windowStartedAt;
let windowRequestIndex = 0;

const updatePlugin = {
    name: "m82-update-sequence",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== "/api/updates") {
          next();
          return;
        }
        let step = updateSequence[Math.min(sequenceIndex, updateSequence.length - 1)];
        if (step?.kind === "http-window") {
          if (windowStartedAt === undefined) windowStartedAt = Date.now();
          if (Date.now() - windowStartedAt < step.durationMs) {
            const status = step.statuses[windowRequestIndex++ % step.statuses.length];
            response.statusCode = status;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({
              code: status === 502 ? "BAD_GATEWAY" : "SERVICE_UNAVAILABLE",
              error: "controlled update stream failure",
            }));
            return;
          }
          sequenceIndex += 1;
          windowStartedAt = undefined;
          windowRequestIndex = 0;
          step = updateSequence[Math.min(sequenceIndex, updateSequence.length - 1)];
        }
        sequenceIndex += 1;
        if (!step || step.kind === "http") {
          const status = step?.status ?? 503;
          response.statusCode = status;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({
            code: status === 502 ? "BAD_GATEWAY" : "SERVICE_UNAVAILABLE",
            error: "controlled update stream failure",
          }));
          return;
        }
        response.statusCode = 200;
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");
        response.setHeader("Content-Type", "text/event-stream");
        if (step.kind === "event") {
          response.write("event: " + step.event + "\\n");
          response.write("data: " + JSON.stringify({
            retryAfterSeconds: step.retryAfterSeconds,
            version: "${packageJson.version}",
          }) + "\\n\\n");
          response.end();
          return;
        }
        response.write(
          (step.retryMs === undefined ? "" : "retry: " + step.retryMs + "\\n") +
          "data: " + JSON.stringify({ version: step.version }) + "\\n\\n",
        );
        if (!step.keepOpen) response.end();
      });
    },
};

export default (configEnv) => {
  const resolved = baseConfig(configEnv);
  return {
    ...resolved,
    plugins: [...(resolved.plugins ?? []), updatePlugin],
  };
};
`,
      "utf8",
    );
  }
  const child = spawn(
    process.execPath,
    [
      vite,
      "--host",
      "127.0.0.1",
      "--port",
      String(serverPort),
      "--strictPort",
      ...(configPath ? ["--config", configPath] : []),
    ],
    {
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_VITE_CACHE_DIR: join(dirname(dataDirectory), `${basename(dataDirectory)}-vite-cache`),
        UNBOUNDRY_TEST_AUTH_BYPASS: options.authBypass ? "1" : undefined,
      },
      stdio: "ignore",
    },
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`http://127.0.0.1:${serverPort}/api/version`)).ok) {
        return child;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("M82 update server did not start");
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

function sseVersion(version: string, retryMs?: number) {
  const retry = retryMs === undefined ? "" : `retry: ${retryMs}\n`;
  return `${retry}data: ${JSON.stringify({ version })}\n\n`;
}

function sseLifecycle(
  event: "maintenance" | "shutdown",
  retryAfterSeconds: number,
) {
  return [
    `event: ${event}`,
    `data: ${JSON.stringify({ retryAfterSeconds, version: packageJson.version })}`,
    "",
    "",
  ].join("\n");
}

async function runRepeatedSseDisconnects(context: any) {
  const page: Page = await context.newPage();
  await page.bringToFront();
  let attempts = 0;
  let activeConnections = 0;
  let maximumActiveConnections = 0;
  await page.route("**/api/updates", async (route) => {
    attempts += 1;
    activeConnections += 1;
    maximumActiveConnections = Math.max(
      maximumActiveConnections,
      activeConnections,
    );
    try {
      await route.fulfill({
        body: attempts < 3
          ? sseVersion(packageJson.version, 1_000)
          : sseVersion("0.7.14-sse-recovered", 60_000),
        contentType: "text/event-stream",
        status: 200,
      });
    } finally {
      activeConnections -= 1;
    }
  });
  try {
    await page.goto("/canvas");
    await expect.poll(() => attempts).toBe(1);
    await expect(page.getByTestId("update-notice")).toHaveCount(0);
    await expect.poll(() => attempts, { timeout: 2_500 }).toBe(2);
    await expect.poll(() => attempts, { timeout: 2_500 }).toBe(3);
    await expect(page.getByTestId("update-notice")).toContainText(
      "已更新到 v0.7.14-sse-recovered",
    );
    expect(maximumActiveConnections).toBe(1);
  } finally {
    await page.close();
  }
}

async function runRealHttpFailureRecovery(context: any) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m82-http-"));
  let server: ChildProcess | undefined;
  let page: Page | undefined;
  try {
    server = await startServer(dataDirectory, {
      authBypass: true,
      updateSequence: [
        {
          durationMs: 35_000,
          kind: "http-window",
          recoveryVersion: "0.7.14-http-recovered",
          statuses: [503, 502],
        },
        { keepOpen: true, kind: "sse", retryMs: 60_000, version: "0.7.14-http-recovered" },
      ],
    });
    const httpPage: Page = await context.newPage();
    page = httpPage;
    await httpPage.bringToFront();
    const pageErrors: string[] = [];
    httpPage.on("pageerror", (error) => pageErrors.push(error.message));
    const failedResponses: Array<{ status: number; url: string }> = [];
    const updates: Array<{ at: number; status: number }> = [];
    const pendingRequests = new Set<any>();
    let maximumPendingRequests = 0;
    let mainFrameNavigations = 0;
    httpPage.on("response", (response) => {
      const url = new URL(response.url());
      if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
      if (url.pathname === "/api/updates") {
        updates.push({ at: Date.now(), status: response.status() });
      }
    });
    httpPage.on("framenavigated", (frame) => {
      if (frame === httpPage.mainFrame()) mainFrameNavigations += 1;
    });
    const recordRequest = (request: any) => {
      const url = new URL(request.url());
      if (url.pathname !== "/api/updates") return;
      pendingRequests.add(request);
      maximumPendingRequests = Math.max(
        maximumPendingRequests,
        pendingRequests.size,
      );
    };
    const clearRequest = (request: any) => {
      if (pendingRequests.has(request)) pendingRequests.delete(request);
    };
    httpPage.on("request", recordRequest);
    httpPage.on("requestfinished", clearRequest);
    httpPage.on("requestfailed", clearRequest);
    await httpPage.goto(`${origin}/canvas`);
    try {
      await expect(httpPage.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true", { timeout: 20_000 });
    } catch (error) {
      console.info(`[m82-http-page-diagnostic] ${JSON.stringify({
        body: (await httpPage.locator("body").innerText()).slice(0, 3000),
        failedResponses,
        pageErrors,
        url: httpPage.url(),
        visibility: await httpPage.evaluate(() => document.visibilityState),
      })}`);
      throw error;
    }
    await expect.poll(() => httpPage.evaluate(() => document.visibilityState)).toBe("visible");
    expect(pageErrors).toEqual([]);
    await expect.poll(() => updates.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const navigationsAfterLoad = mainFrameNavigations;
    await expect.poll(() => updates.at(-1)?.status, {
      timeout: 90_000,
    }).toBe(200);
    expect(updates.length).toBeGreaterThan(2);
    expect(updates.some(({ status }) => status === 503)).toBe(true);
    expect(updates.some(({ status }) => status === 502)).toBe(true);
    expect(updates.slice(0, -1).every(({ status }) => status === 502 || status === 503))
      .toBe(true);
    expect(updates.at(-1)!.at - updates[0].at).toBeGreaterThanOrEqual(35_000);
    await expect(httpPage.getByTestId("update-notice")).toContainText(
      "已更新到 v0.7.14-http-recovered",
    );
    expect(maximumPendingRequests).toBe(1);
    expect(mainFrameNavigations).toBe(navigationsAfterLoad);
  } finally {
    if (page) await page.close();
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
}

async function runMaintenanceAndShutdownRecovery(context: any) {
  const page: Page = await context.newPage();
  await page.bringToFront();
  let attempts = 0;
  let activeConnections = 0;
  let maximumActiveConnections = 0;
  const clockStart = new Date("2026-09-07T00:00:00Z");
  await page.clock.install({ time: clockStart });
  // Let the app load naturally, then freeze time before delivering lifecycle
  // events. Navigation and polling must not consume part of the retry delay.
  let deliverFirstEvent!: () => void;
  const firstEventGate = new Promise<void>((resolve) => { deliverFirstEvent = resolve; });
  await page.addInitScript(() => {
    const target = window as typeof window & { __updateLifecycleEvents: string[] };
    target.__updateLifecycleEvents = [];
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        for (const name of ["maintenance", "shutdown"]) {
          this.addEventListener(name, () => target.__updateLifecycleEvents.push(name));
        }
      }
    };
  });
  await page.route("**/api/updates", async (route) => {
    attempts += 1;
    activeConnections += 1;
    maximumActiveConnections = Math.max(
      maximumActiveConnections,
      activeConnections,
    );
    try {
      if (attempts === 1) await firstEventGate;
      const body = attempts === 1
        ? sseLifecycle("maintenance", 45)
        : attempts === 2
          ? sseLifecycle("shutdown", 2)
          : sseVersion("0.7.14-maintenance-recovered", 60_000);
      await route.fulfill({
        body,
        contentType: "text/event-stream",
        status: 200,
      });
    } finally {
      activeConnections -= 1;
    }
  });
  try {
    await page.goto("/canvas");
    await expect.poll(() => attempts).toBe(1);
    await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000));
    deliverFirstEvent();
    const receivedEvents = () => page.evaluate(() =>
      (window as typeof window & { __updateLifecycleEvents: string[] }).__updateLifecycleEvents);
    await expect.poll(receivedEvents).toEqual(["maintenance"]);
    await page.clock.fastForward(29_999);
    expect(attempts).toBe(1);
    await page.clock.fastForward(1);
    await expect.poll(() => attempts).toBe(2);
    await expect.poll(receivedEvents).toEqual(["maintenance", "shutdown"]);
    await page.clock.fastForward(1_999);
    expect(attempts).toBe(2);
    await page.clock.fastForward(1);
    await expect.poll(() => attempts).toBe(3);
    await expect(page.getByTestId("update-notice")).toContainText(
      "已更新到 v0.7.14-maintenance-recovered",
    );
    expect(maximumActiveConnections).toBe(1);
  } finally {
    // Playwright's clock belongs to the context, including later new pages.
    await page.clock.resume();
    await page.close();
  }
}

async function runAuthFailureRecovery(context: any) {
  const page: Page = await context.newPage();
  await page.bringToFront();
  let attempts = 0;
  let activeConnections = 0;
  let maximumActiveConnections = 0;
  await page.route("**/api/updates", async (route) => {
    attempts += 1;
    activeConnections += 1;
    maximumActiveConnections = Math.max(
      maximumActiveConnections,
      activeConnections,
    );
    try {
      if (attempts === 1 || attempts === 2) {
        await route.fulfill({
          body: JSON.stringify({
            error: attempts === 1 ? "unauthorized" : "forbidden",
          }),
          contentType: "application/json",
          status: attempts === 1 ? 401 : 403,
        });
        return;
      }
      await route.fulfill({
        body: sseVersion("0.7.14-auth-recovered", 60_000),
        contentType: "text/event-stream",
        status: 200,
      });
    } finally {
      activeConnections -= 1;
    }
  });
  try {
    await page.goto("/canvas");
    await expect.poll(() => attempts).toBe(1);
    await expect(page.getByTestId("update-notice")).toHaveCount(0);
    await expect.poll(() => attempts, { timeout: 15_000 }).toBe(3);
    await expect(page.getByTestId("update-notice")).toContainText(
      "已更新到 v0.7.14-auth-recovered",
    );
    expect(maximumActiveConnections).toBe(1);
  } finally {
    await page.close();
  }
}

async function runLeaveCanvasCleanup(context: any) {
  const page: Page = await context.newPage();
  await page.bringToFront();
  let attempts = 0;
  await page.clock.install();
  await page.route("**/api/updates", async (route) => {
    attempts += 1;
    await route.fulfill({
      body: sseLifecycle("maintenance", 30),
      contentType: "text/event-stream",
      status: 200,
    });
  });
  try {
    await page.goto("/canvas");
    await expect.poll(() => attempts).toBe(1);
    await page.evaluate(() => Promise.resolve());
    await page.goto("/canvas/projects");
    await page.clock.fastForward(60_000);
    expect(attempts).toBe(1);
    await expect(page.getByTestId("update-notice")).toHaveCount(0);
  } finally {
    await page.close();
  }
}

test("version endpoint reports the packaged version", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m82-version-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const response = await fetch(`${origin}/api/version`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { version: string };
    expect(body.version).toBe(packageJson.version);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("updates stream sends the current version immediately", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m82-stream-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const response = await fetch(`${origin}/api/updates`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain(
      `data: ${JSON.stringify({ version: packageJson.version })}`,
    );
    await reader.cancel();
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("updates stream enforces its per-client connection budget", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m82-limit-"));
  let server: ChildProcess | undefined;
  const streams: Response[] = [];
  try {
    server = await startServer(dataDirectory);
    for (let index = 0; index < 8; index += 1) {
      const stream = await fetch(`${origin}/api/updates`);
      expect(stream.status).toBe(200);
      streams.push(stream);
    }
    const limited = await fetch(`${origin}/api/updates`);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toMatchObject({
      code: "STREAM_LIMIT_REACHED",
    });
  } finally {
    await Promise.all(streams.map((stream) => stream.body?.cancel()));
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("canvas shows the update notice only when versions differ", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await page.route("**/api/updates", (route) =>
    route.fulfill({
      body: `data: ${JSON.stringify({ version: "0.7.14-compat.1" })}\n\n`,
      contentType: "text/event-stream",
      status: 200,
    }),
  );
  await page.goto("/canvas");
  await expect(page.getByTestId("update-notice")).toBeVisible();
  await expect(page.getByTestId("update-notice")).toContainText(
    "已更新到 v0.7.14-compat.1",
  );
  await page.getByTestId("update-reload").click();
  await page.waitForLoadState("load");
  await expect(page.getByTestId("update-notice")).toBeVisible();

  await test.step("真实本机 HTTP 503/502 后恢复为更新提示", async () => {
    await runRealHttpFailureRecovery(context);
  });
  await test.step("连续 SSE 中断保持单连接并恢复", async () => {
    await runRepeatedSseDisconnects(context);
  });
  await test.step("maintenance/shutdown 使用30秒封顶退避", async () => {
    await runMaintenanceAndShutdownRecovery(context);
  });
  await test.step("401/403 有界重连并恢复", async () => {
    await runAuthFailureRecovery(context);
  });
  await test.step("离开画布后停止更新重连", async () => {
    await runLeaveCanvasCleanup(context);
  });
});

test("failed canvas flush keeps the page and exposes a retryable error", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  await page.route("**/api/updates", (route) =>
    route.fulfill({
      body: `data: ${JSON.stringify({ version: "99.0.1" })}\n\n`,
      contentType: "text/event-stream",
      status: 200,
    }),
  );
  await page.route(`**/api/canvas/${project.id}`, (route) =>
    route.fulfill({ json: { error: "load unavailable" }, status: 503 }),
  );
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documentRequests += 1;
    }
  });

  await page.goto(`/canvas/${project.id}`);
  const initialDocumentRequests = documentRequests;
  const reload = page.getByTestId("update-reload");
  await expect(reload).toBeVisible();
  await reload.click();
  await expect(page.getByTestId("update-reload-error")).toContainText(
    "保存失败，未刷新页面",
  );
  await expect(reload).toBeEnabled();
  expect(documentRequests).toBe(initialDocumentRequests);
  await expect(page).toHaveURL(new RegExp(`/canvas/${project.id}$`));

  await reload.click();
  await expect(page.getByTestId("update-reload-error")).toBeVisible();
  await expect(reload).toBeEnabled();
  expect(documentRequests).toBe(initialDocumentRequests);
  await request.delete(`/api/projects/${project.id}`);
});

test("held update reload is single-flight and reloads once after save", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  await page.route("**/api/updates", (route) =>
    route.fulfill({
      body: `data: ${JSON.stringify({ version: "99.0.2" })}\n\n`,
      contentType: "text/event-stream",
      status: 200,
    }),
  );
  let canvasSaveCalls = 0;
  let releaseSave!: () => void;
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(`**/api/canvases/${project.id}/commands`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    canvasSaveCalls += 1;
    await heldSave;
    await route.continue();
  });
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documentRequests += 1;
    }
  });

  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  const initialDocumentRequests = documentRequests;
  const reload = page.getByTestId("update-reload");
  await test.step("未保存草稿在更新刷新前只提交一次", async () => {
    await page.getByTestId("add-node").click();
    await page
      .getByTestId("add-node-menu")
      .getByRole("menuitem", { name: "文本", exact: true })
      .click();
    await expect.poll(() => canvasSaveCalls).toBe(1);
    await reload.evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect(reload).toBeDisabled();
    expect(canvasSaveCalls).toBe(1);
    releaseSave();
  });

  await expect.poll(() => documentRequests).toBe(initialDocumentRequests + 1);
  await page.waitForLoadState("load");
  await expect(page.getByTestId("update-notice")).toBeVisible();
  expect(documentRequests).toBe(initialDocumentRequests + 1);
  expect(canvasSaveCalls).toBe(1);
  await request.delete(`/api/projects/${project.id}`);
});

test("canvas stays quiet when the bundled version matches the server", async ({
  page,
}) => {
  await page.goto("/canvas");
  await expect(page.getByTestId("update-notice")).toHaveCount(0);
});
