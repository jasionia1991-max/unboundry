import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openAppDatabase } from "../server/database";
import { createGenerationSafetyStore } from "../server/generationSafety";

const port = 4198;
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");
const imageProviderId = "provider-image-test";

const baseSettings = {
  audioConcurrency: 1,
  cooldownMinutes: 30,
  dailyCostLimitMicrounits: 10_000_000,
  emergencyStop: false,
  failureThreshold: 3,
  globalEnabled: true,
  imageConcurrency: 1,
  monthlyCostLimitMicrounits: 10_000_000,
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
        TAPNOW_DATA_DIR: dataDirectory,
        TAPNOW_TEST_AUTH_BYPASS: undefined,
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

test("generation safety blocks globally, by cost, frequency, concurrency and failure cooldown", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-safety-store-"));
  const safety = createGenerationSafetyStore(dataDirectory);
  const database = openAppDatabase(dataDirectory);
  try {
    expect(safety.settings()).toMatchObject({
      dailyCostLimitMicrounits: 0,
      emergencyStop: false,
      globalEnabled: false,
      monthlyCostLimitMicrounits: 0,
      unknownCostPolicy: "block",
    });
    expect(
      safety.admission({
        estimatedCostMicrounits: 1,
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "GLOBAL_DISABLED" });

    safety.update(baseSettings);
    expect(
      safety.admission({
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "COST_UNKNOWN" });
    expect(
      safety.admission({
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toEqual({ allowed: true, code: "ALLOWED" });

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
        estimated_cost_microunits, actual_cost_microunits,
        provider_profile_id
      )
      VALUES (?, ?, ?, ?, 'test', NULL, '{}', ?, ?, ?, 0, NULL, NULL, ?, ?, ?,
        NULL, ?, ?)
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
      null,
      "provider-active-test",
    );
    expect(
      safety.admission({
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "USER_CONCURRENCY" });

    safety.update({ ...baseSettings, perUserConcurrency: 5 });
    expect(
      safety.admission({
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "KIND_CONCURRENCY" });

    database
      .prepare(`
        UPDATE generation_tasks
        SET state = 'success', actual_cost_microunits = 9500000
        WHERE id = 'task-active'
      `)
      .run();
    expect(
      safety.admission({
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "COST_LIMIT" });

    safety.update({
      ...baseSettings,
      dailyCostLimitMicrounits: 100_000_000,
      monthlyCostLimitMicrounits: 100_000_000,
      perUserConcurrency: 5,
      requestsPerMinute: 1,
    });
    expect(
      safety.admission({
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "RATE_LIMIT" });

    safety.update({
      ...baseSettings,
      dailyCostLimitMicrounits: 100_000_000,
      monthlyCostLimitMicrounits: 100_000_000,
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
        0,
        imageProviderId,
      );
    }
    expect(
      safety.admission({
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toMatchObject({ allowed: false, code: "PROVIDER_COOLDOWN" });

    expect(
      safety.admission({
        estimatedCostMicrounits: 1_000_000,
        kind: "video",
        ownerId: "owner-test",
        providerProfileId: imageProviderId,
      }),
    ).toEqual({ allowed: true, code: "ALLOWED" });
    expect(
      safety.admission({
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: "provider-image-other",
      }),
    ).toEqual({ allowed: true, code: "ALLOWED" });

    for (let index = 1; index <= 3; index += 1) {
      const timestamp = new Date(
        Date.now() - 31 * 60_000 - index * 10,
      ).toISOString();
      insertTask.run(
        `task-expired-${index}`,
        `canvas-expired-${index}`,
        `node-expired-${index}`,
        "image",
        `key-expired-${index}`,
        `fingerprint-expired-${index}`,
        "failed",
        timestamp,
        timestamp,
        "owner-test",
        0,
        "provider-expired-test",
      );
    }
    expect(
      safety.admission({
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: "provider-expired-test",
      }),
    ).toEqual({ allowed: true, code: "ALLOWED" });

    for (let index = 1; index <= 3; index += 1) {
      const timestamp = new Date(
        Date.now() - 31 * 60_000 - index * 10,
      ).toISOString();
      insertTask.run(
        `task-audio-old-${index}`,
        `canvas-audio-old-${index}`,
        `node-audio-old-${index}`,
        "audio",
        `key-audio-old-${index}`,
        `fingerprint-audio-old-${index}`,
        "failed",
        timestamp,
        timestamp,
        "owner-test",
        0,
        "provider-audio-old",
      );
    }
    database.prepare(`
      UPDATE generation_tasks
      SET error_code = 'RATE_LIMIT', error_message = 'test only'
      WHERE id LIKE 'task-audio-old-%'
    `).run();
    expect(
      safety.admission({
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-test",
        providerProfileId: "provider-audio-old",
      }),
    ).toEqual({ allowed: true, code: "ALLOWED" });

    safety.update({
      ...baseSettings,
      emergencyStop: true,
      globalEnabled: false,
    });
    expect(
      safety.admission({
        estimatedCostMicrounits: 1,
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

test("only administrators can read and change generation safety settings", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-safety-api-"));
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
    expect(await status.json()).toMatchObject({
      historicalEstimatedProviderAttempts: 0,
      paidProviderRequests: 0,
      providerConfigured: false,
      settings: {
        globalEnabled: false,
        unknownCostPolicy: "block",
      },
    });

    const account = await request("/api/admin/users", {
      body: JSON.stringify({
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(account.status).toBe(201);
    const login = await request("/api/auth/login", {
      body: JSON.stringify({
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      method: "POST",
    });
    const userCookie = cookie(login);
    expect(
      (
        await request("/api/admin/generation-safety", {
          cookie: userCookie,
        })
      ).status,
    ).toBe(403);

    const saved = await request("/api/admin/generation-safety", {
      body: JSON.stringify({
        ...baseSettings,
        dailyCostLimitMicrounits: 5_000_000,
        emergencyStop: true,
        monthlyCostLimitMicrounits: 20_000_000,
      }),
      cookie: adminCookie,
      method: "PUT",
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      historicalEstimatedProviderAttempts: 0,
      paidProviderRequests: 0,
      providerConfigured: false,
      settings: {
        dailyCostLimitMicrounits: 5_000_000,
        emergencyStop: true,
        globalEnabled: true,
        monthlyCostLimitMicrounits: 20_000_000,
      },
    });

    const database = openAppDatabase(dataDirectory);
    try {
      expect(
        database
          .prepare(`
            SELECT COUNT(*) AS count
            FROM admin_audit_events
            WHERE action = 'generation_safety.update'
          `)
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("administrator safety center is visible without Provider requests", async ({
  page,
}) => {
  const providerRequests: string[] = [];
  page.on("request", (requestEvent) => {
    if (/provider/i.test(requestEvent.url())) {
      providerRequests.push(requestEvent.url());
    }
  });
  await page.goto("/admin/generation-safety");
  await expect(page.getByTestId("admin-generation-safety-page")).toBeVisible();
  await expect(page.getByText("真实生成总开关关闭")).toBeVisible();
  await expect(page.getByText("Provider未连接")).toBeVisible();
  await expect(page.getByTestId("generation-global-toggle")).toHaveText(
    "开启总开关",
  );
  await expect(page.getByLabel("每日上限（美元）")).toHaveValue("0");
  await expect(page.getByLabel("每月上限（美元）")).toHaveValue("0");
  await expect(page.getByTestId("running-task-policy")).toContainText(
    "等待完成",
  );

  await page.getByTestId("generation-global-toggle").click();
  await expect(page.getByText("后台保护已启用")).toBeVisible();
  await expect(page.getByText("真实生成继续禁用")).toBeVisible();
  await page.getByTestId("generation-emergency-toggle").click();
  await expect(page.getByText("紧急停止已生效", { exact: true })).toBeVisible();
  expect(providerRequests).toEqual([]);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("generation-emergency-toggle").click();
  await expect(page.getByText("紧急停止已解除")).toBeVisible();
  await page.getByTestId("generation-global-toggle").click();
  await expect(page.getByText("真实生成总开关关闭")).toBeVisible();
});
