import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { expect, test } from "./safe-test";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");

async function startServer(dataDirectory: string) {
  const child = spawn(
    process.execPath,
    [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_TEST_AUTH_BYPASS: undefined,
      },
      stdio: "ignore",
    },
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${origin}/api/version`)).ok) return child;
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

const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as { version: string };

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

test("canvas shows the update notice only when versions differ", async ({
  page,
}) => {
  await page.route("**/api/updates", (route) =>
    route.fulfill({
      body: `data: ${JSON.stringify({ version: "99.0.0" })}\n\n`,
      contentType: "text/event-stream",
      status: 200,
    }),
  );
  await page.goto("/canvas");
  await expect(page.getByTestId("update-notice")).toBeVisible();
  await expect(page.getByTestId("update-notice")).toContainText(
    "已更新到 v99.0.0",
  );
  await page.getByTestId("update-reload").click();
  await page.waitForLoadState("load");
  await expect(page.getByTestId("update-notice")).toBeVisible();
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
  await page.route(`**/api/canvas/${project.id}`, async (route) => {
    if (route.request().method() !== "PUT") {
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
  await page.getByTestId("add-node").click();
  await page
    .getByTestId("add-node-menu")
    .getByRole("menuitem", { name: "文本", exact: true })
    .click();
  await expect.poll(() => canvasSaveCalls).toBe(1);

  const reload = page.getByTestId("update-reload");
  await reload.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(reload).toBeDisabled();
  expect(canvasSaveCalls).toBe(1);
  releaseSave();

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
