import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { AccountMutationBlockedError } from "../server/accountMutationFence";
import { openAppDatabase } from "../server/database";
import { createGenerationSafetyStore } from "../server/generationSafety";
import { createGenerationTaskStore } from "../server/generationTaskStore";

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
    database.prepare(`
      INSERT INTO generation_admission_events (
        task_id, execution_attempt, owner_id, kind, admission_type, created_at
      ) VALUES (
        'task-active', 1, 'owner-test', 'image', 'initial', ?
      )
    `).run(now);
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
      database.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, owner_id, provider_profile_id,
          provider_model_id, kind, evidence, credential_revision, outcome,
          failure_code, finished_at, created_at
        ) VALUES (
          ?, 1, 'owner-test', ?, 'test-image-model', 'image',
          'provider-boundary', 1, 'provider-failed', 'PROVIDER_FAILED', ?, ?
        )
      `).run(`task-failed-${index}`, imageProviderId, timestamp, timestamp);
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

test("admin safety mutations have a deterministic account-delete order and atomic audit", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-safety-fence-"));
  const safety = createGenerationSafetyStore(dataDirectory);
  const database = openAppDatabase(dataDirectory);
  try {
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      )
      VALUES ('safety-admin', 'safety-admin', 'Safety Admin', 'test-only',
        'admin', 'active', ?, ?)
    `).run(now, now);

    const committed = safety.updateForAdmin("safety-admin", {
      ...baseSettings,
      requestsPerMinute: 31,
    });
    expect(committed.settings.requestsPerMinute).toBe(31);
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM admin_audit_events
      WHERE actor_user_id = 'safety-admin'
        AND action = 'generation_safety.update'
    `).get()).toEqual({ count: 1 });

    // Commit-first: the completed settings + audit remain authoritative even
    // if account deletion wins the following write transaction.
    database.prepare(`
      INSERT INTO account_delete_intents (
        owner_id, state, error_code, retry_count, created_at, updated_at
      ) VALUES ('safety-admin', 'running', NULL, 0, ?, ?)
    `).run(now, now);
    expect(safety.settings().requestsPerMinute).toBe(31);

    // Delete-first: the next mutation sees the committed intent under its own
    // BEGIN IMMEDIATE and changes neither settings nor audit.
    expect(() => safety.updateForAdmin("safety-admin", {
      requestsPerMinute: 32,
    })).toThrow(AccountMutationBlockedError);
    expect(safety.settings().requestsPerMinute).toBe(31);
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM admin_audit_events
      WHERE actor_user_id = 'safety-admin'
        AND action = 'generation_safety.update'
    `).get()).toEqual({ count: 1 });
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

    const fenceStore = openAppDatabase(dataDirectory);
    try {
      const admin = fenceStore.prepare(`
        SELECT id FROM users WHERE login_name = 'owner'
      `).get() as { id: string };
      const now = new Date().toISOString();
      fenceStore.prepare(`
        INSERT INTO account_delete_intents (
          owner_id, state, error_code, retry_count, created_at, updated_at
        ) VALUES (?, 'running', NULL, 0, ?, ?)
      `).run(admin.id, now, now);
      const blocked = await request("/api/admin/generation-safety", {
        body: JSON.stringify({ requestsPerMinute: 77 }),
        cookie: adminCookie,
        method: "PUT",
      });
      expect(blocked.status).toBe(409);
      await expect(blocked.json()).resolves.toMatchObject({
        code: "ACCOUNT_DELETE_ACTIVE",
      });
      expect(fenceStore.prepare(`
        SELECT requests_per_minute
        FROM generation_safety_settings WHERE id = 1
      `).get()).toEqual({ requests_per_minute: 99 });
      fenceStore.prepare(`
        DELETE FROM account_delete_intents WHERE owner_id = ?
      `).run(admin.id);
    } finally {
      fenceStore.close();
    }

    const waitingStop = await request("/api/admin/generation-safety", {
      body: JSON.stringify({
        ...baseSettings,
        emergencyStop: true,
        runningTaskPolicy: "wait",
      }),
      cookie: adminCookie,
      method: "PUT",
    });
    expect(waitingStop.status).toBe(200);
    expect(await waitingStop.json()).not.toHaveProperty(
      "runningTaskPolicySummary",
    );
    const taskStore = createGenerationTaskStore(dataDirectory);
    const queued = taskStore.create({
      canvasId: "emergency-stop-policy",
      idempotencyKey: "emergency-stop-policy-0001",
      kind: "image",
      nodeId: "emergency-stop-policy-node",
      ownerId: "__test__",
      prompt: "cancel this committed local task",
    }).task;
    taskStore.close();

    const auditFaultStore = openAppDatabase(dataDirectory);
    try {
      auditFaultStore.exec(`
        CREATE TRIGGER test_generation_safety_audit_fault
        BEFORE INSERT ON admin_audit_events
        WHEN NEW.action = 'generation_safety.update'
        BEGIN
          SELECT RAISE(ABORT, 'test generation safety audit fault');
        END;
      `);
      const failedStop = await request("/api/admin/generation-safety", {
        body: JSON.stringify({
          ...baseSettings,
          emergencyStop: true,
          runningTaskPolicy: "cancel",
        }),
        cookie: adminCookie,
        method: "PUT",
      });
      expect(failedStop.status).toBe(400);
      auditFaultStore.exec("DROP TRIGGER test_generation_safety_audit_fault");
    } finally {
      auditFaultStore.exec("DROP TRIGGER IF EXISTS test_generation_safety_audit_fault");
      auditFaultStore.close();
    }
    const afterAuditFault = await (await request(
      "/api/admin/generation-safety",
      { cookie: adminCookie },
    )).json() as { settings: typeof baseSettings };
    expect(afterAuditFault.settings).toMatchObject({
      emergencyStop: true,
      runningTaskPolicy: "wait",
    });
    const notCancelledStore = createGenerationTaskStore(dataDirectory);
    expect(notCancelledStore.get(queued.id)).toMatchObject({ state: "queued" });
    notCancelledStore.close();

    const stopped = await request("/api/admin/generation-safety", {
      body: JSON.stringify({
        ...baseSettings,
        emergencyStop: true,
        runningTaskPolicy: "cancel",
      }),
      cookie: adminCookie,
      method: "PUT",
    });
    expect(stopped.status).toBe(200);
    await expect(stopped.json()).resolves.toMatchObject({
      runningTaskPolicySummary: {
        cancelled: 1,
        failed: 0,
        waiting: 0,
      },
      settings: { emergencyStop: true, runningTaskPolicy: "cancel" },
    });
    const cancelledStore = createGenerationTaskStore(dataDirectory);
    expect(cancelledStore.get(queued.id)).toMatchObject({ state: "cancelled" });
    cancelledStore.close();
    const auditStore = openAppDatabase(dataDirectory);
    try {
      const latest = auditStore.prepare(`
        SELECT details
        FROM admin_audit_events
        WHERE action = 'generation_safety.update'
        ORDER BY id DESC
        LIMIT 1
      `).get() as { details: string };
      expect(JSON.parse(latest.details)).toMatchObject({
        runningTaskPolicyEffect: {
          phase: "after-commit",
          policy: "cancel",
        },
      });
      expect(JSON.parse(latest.details)).not.toHaveProperty(
        "runningTaskPolicySummary",
      );
    } finally {
      auditStore.close();
    }
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
