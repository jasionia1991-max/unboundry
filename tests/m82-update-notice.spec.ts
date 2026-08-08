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

test("canvas stays quiet when the bundled version matches the server", async ({
  page,
}) => {
  await page.goto("/canvas");
  await expect(page.getByTestId("update-notice")).toHaveCount(0);
});
