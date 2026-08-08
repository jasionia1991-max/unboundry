import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import { createGenerationSafetyStore } from "../server/generationSafety";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");
const imageProviderId = "provider-image-test";

const baseSettings = {
  audioConcurrency: 1,
  cooldownMinutes: 30,
  emergencyStop: false,
  failureThreshold: 3,
  globalEnabled: true,
  imageConcurrency: 1,
  perUserConcurrency: 1,
  requestsPerMinute: 10,
  runningTaskPolicy: "wait" as const,
  textConcurrency: 1,
  videoConcurrency: 1,
};

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
      if ((await fetch(`${origin}/api/auth/status`)).ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("Generation safety test server did not start");
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

function cookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function request(
  path: string,
  options: RequestInit & { cookie?: string } = {},
) {
  const { cookie: session, ...init } = options;
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Cookie: session } : {}),
      ...init.headers,
    },
  });
}

test("generation safety settings contain no cost fields and admission blocks by switch, rate, concurrency and cooldown", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-safety-store-"));
  const safety = createGenerationSafetyStore(dataDirectory);
  const database = openAppDatabase(dataDirectory);
  try {
    const defaults = safety.settings();
    expect(defaults).toMatchObject({
      emergencyStop: false,
      globalEnabled: false,
      perUserConcurrency: 1,
      requestsPerMinute: 3,
      runningTaskPolicy: "wait",
    });
    expect(defaults).not.toHaveProperty("dailyCostLimitCnyMicrounits");
    expect(defaults).not.toHaveProperty("dailyCostLimitMicrounits");
    expect(defaults).not.toHaveProperty("monthlyCostLimitCnyMicrounits");
    expect(defaults).not.toHaveProperty("monthlyCostLimitMicrounits");
    expect(defaults).not.toHaveProperty("singleTaskDefaultCostCnyMicrounits");
    expect(defaults).not.toHaveProperty("usdToCnyRateMicrounits");

    expect(
      safety.admission({
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "GLOBAL_DISABLED" });

    safety.update(baseSettings);
    const now = new Date().toISOString();
    database
      .prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES (?, ?, ?, 'test-only', 'user', 'active', ?, ?)
      `)
      .run("owner-test", "owner-test", "Owner Test", now, now);
    const insertTask = database.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt,
        error_code, error_message, created_at, updated_at, owner_id,
        provider_profile_id
      )
      VALUES (?, ?, ?, ?, 'test', NULL, '{}', ?, ?, ?, 0, NULL, NULL, ?, ?, ?,
        ?)
    `);
    insertTask.run(
      "task-active",
      "canvas-safety",
      "node-active",
      "image",
      "key-active",
      "fingerprint-active",
      "queued",
      now,
      now,
      "owner-test",
      "provider-active-test",
    );
    expect(
      safety.admission({
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "USER_CONCURRENCY" });

    safety.update({ ...baseSettings, perUserConcurrency: 5 });
    expect(
      safety.admission({
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "KIND_CONCURRENCY" });

    database
      .prepare(`
        UPDATE generation_tasks
        SET state = 'success'
        WHERE id = 'task-active'
      `)
      .run();
    safety.update({
      ...baseSettings,
      perUserConcurrency: 5,
      requestsPerMinute: 1,
    });
    expect(
      safety.admission({
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "RATE_LIMIT" });

    safety.update({
      ...baseSettings,
      perUserConcurrency: 5,
      requestsPerMinute: 10,
    });
    for (let index = 1; index <= 3; index += 1) {
      const timestamp = new Date(Date.now() - index * 10).toISOString();
      insertTask.run(
        `task-failed-${index}`,
        `canvas-failed-${index}`,
        `node-failed-${index}`,
        "image",
        `key-failed-${index}`,
        `fingerprint-failed-${index}`,
        "failed",
        timestamp,
        timestamp,
        "owner-test",
        imageProviderId,
      );
    }
    expect(
      safety.admission({
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "PROVIDER_COOLDOWN" });

    expect(
      safety.admission({
        kind: "video",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toEqual({ allowed: true, code: "ALLOWED" });
    expect(
      safety.admission({
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: "provider-image-other",
      }),
    ).toEqual({ allowed: true, code: "ALLOWED" });

    safety.update({
      ...baseSettings,
      emergencyStop: true,
      globalEnabled: false,
    });
    expect(
      safety.admission({
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "EMERGENCY_STOP" });
  } finally {
    database.close();
    safety.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("only administrators can read and change generation safety settings and legacy cost fields are ignored", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-safety-api-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const bootstrap = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      }),
      method: "POST",
    });
    const adminCookie = cookie(bootstrap);
    const status = await request("/api/admin/generation-safety", {
      cookie: adminCookie,
    });
    expect(status.status).toBe(200);
    const body = await status.json() as {
      paidProviderRequests: number;
      providerConfigured: boolean;
      settings: Record<string, unknown>;
    };
    expect(body.paidProviderRequests).toBe(0);
    expect(body.providerConfigured).toBe(false);
    expect(body.settings).not.toHaveProperty("dailyCostLimitCnyMicrounits");
    expect(body.settings).not.toHaveProperty("singleTaskDefaultCostCnyMicrounits");

    const created = await request("/api/admin/users", {
      body: JSON.stringify({
        displayName: "普通用户",
        loginName: "ordinary",
        password: "ordinary-password-123",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(created.status).toBe(201);
    const login = await request("/api/auth/login", {
      body: JSON.stringify({
        loginName: "ordinary",
        password: "ordinary-password-123",
      }),
      method: "POST",
    });
    expect(login.status).toBe(200);
    const ordinaryCookie = cookie(login);
    expect(
      (await request("/api/admin/generation-safety", {
        cookie: ordinaryCookie,
      })).status,
    ).toBe(403);

    const updated = await request("/api/admin/generation-safety", {
      body: JSON.stringify({
        ...baseSettings,
        // 旧客户端可能仍提交已废弃的成本字段，必须被忽略而不是报错或写库。
        dailyCostLimitCnyMicrounits: 999_000_000,
        singleTaskDefaultCostCnyMicrounits: 999_000_000,
        requestsPerMinute: 99,
      }),
      cookie: adminCookie,
      method: "PUT",
    });
    expect(updated.status).toBe(200);
    const after = await (await request("/api/admin/generation-safety", {
      cookie: adminCookie,
    })).json() as { settings: Record<string, unknown> };
    expect(after.settings.requestsPerMinute).toBe(99);
    expect(after.settings).not.toHaveProperty("dailyCostLimitCnyMicrounits");
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("administrator safety center is visible without Provider requests and has no budget fields", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-safety-ui-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const bootstrap = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      }),
      method: "POST",
    });
    const session = cookie(bootstrap).split(";")[0];
    const providerRequests: string[] = [];
    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) {
        providerRequests.push(entry.url());
      }
    });
    await page.context().addCookies([{
      domain: "127.0.0.1",
      name: "unboundry_session",
      path: "/",
      value: session.split("=")[1],
    }]);
    await page.goto(`${origin}/admin/generation-safety`);
    await expect(page.getByTestId("admin-generation-safety-page")).toBeVisible();
    await expect(page.getByLabel("并发与频率")).toHaveCount(0);
    await expect(page.getByLabel("每日全局预算（¥）")).toHaveCount(0);
    await expect(page.getByLabel("每月全局预算（¥）")).toHaveCount(0);
    await expect(page.getByText("全局额度（人民币）")).toHaveCount(0);
    expect(providerRequests).toEqual([]);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
