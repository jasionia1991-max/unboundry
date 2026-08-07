import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const secretShapes = [
  /(?:^|[^a-z])sk-(?:(?:proj|ant|svcacct)-)?[a-z0-9_]{20,}/i,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[a-z0-9]{30,}/i,
  /(api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"']{8,}["']/i,
];

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
      }),
    )
  ).flat();
}

function expectNoSecret(value: string, location: string) {
  for (const shape of secretShapes) {
    expect(value, `${location} contains a secret-shaped value`).not.toMatch(
      shape,
    );
  }
}

test("Provider secrets stay out of source, browser bundles, network and errors", async ({
  page,
  request,
}) => {
  const sourceFiles = (
    await Promise.all(
      ["client/src", "server"].map((directory) => filesUnder(directory)),
    )
  ).flat();

  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    expectNoSecret(source, file);
    if (file.startsWith("client/")) {
      expect(source, `${file} reads a sensitive browser environment value`).not
        .toMatch(
          /(?:import\.meta|process)\.env[^;\n]*(?:key|token|secret)/i,
        );
      expect(source, `${file} sends an authorization credential`).not.toMatch(
        /(?:authorization|bearer\s+)/i,
      );
    }
  }

  for (const file of await filesUnder("dist/client")) {
    if (!/\.(?:html|js|css)$/.test(file)) continue;
    expectNoSecret(await readFile(file, "utf8"), file);
  }

  const externalRequests: string[] = [];
  page.on("request", (outgoing) => {
    const url = new URL(outgoing.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalRequests.push(outgoing.url());
    }
    const authorization = outgoing.headers().authorization;
    expect(authorization, `${outgoing.url()} includes Authorization`).toBeFalsy();
  });

  await page.goto("/__fixture/shell.empty.primary");
  await expect(page.getByTestId("canvas-shell")).toHaveAttribute(
    "data-fixture-ready",
    "true",
  );
  await page.waitForTimeout(250);
  expect(externalRequests).toEqual([]);

  for (const url of [
    "/api/canvas/%20",
    "/api/assets/%20",
    "/api/audio-assets/%20",
    "/api/video-assets/%20",
  ]) {
    const response = await request.get(url);
    expect(response.status()).toBe(400);
    const body = await response.text();
    expectNoSecret(body, url);
    expect(body).not.toMatch(
      /(?:\/Users\/|node_modules|UNBOUNDRY_DATA_DIR|process\.env)/,
    );
  }
});
