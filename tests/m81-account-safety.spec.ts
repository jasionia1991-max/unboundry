import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "../server/database";
import { createGenerationSafetyStore } from "../server/generationSafety";

const origin = "http://127.0.0.1:4196";

function cookie(response: APIResponse) {
  return response.headers()["set-cookie"]?.split(";")[0] ?? "";
}

async function session(
  request: APIRequestContext,
  loginName: string,
  password: string,
) {
  const response = await request.post("/api/auth/login", {
    data: { loginName, password },
  });
  expect(response.status()).toBe(200);
  const headers = response.headers();
  const setCookie = headers["set-cookie"];
  return (setCookie ?? "").split(";")[0];
}

async function bootstrapAdmin(request: APIRequestContext) {
  const response = await request.post("/api/auth/bootstrap", {
    data: {
      displayName: "Admin",
      loginName: "admin",
      password: "admin-password-123",
    },
  });
  if (response.status() === 409) {
    // 同一测试文件共享一个临时数据目录：后续测试直接登录首位管理员。
    return session(request, "admin", "admin-password-123");
  }
  expect(response.status()).toBe(201);
  return cookie(response);
}

async function createOrdinary(request: APIRequestContext, adminCookie: string) {
  const response = await request.post("/api/admin/users", {
    data: {
      displayName: "普通用户",
      loginName: "ordinary",
      password: "ordinary-password-123",
    },
    headers: { Cookie: adminCookie },
  });
  expect([201, 409]).toContain(response.status());
}

test("account safety API is self-service, scoped and validated", async ({
  request,
}) => {
  expect((await request.get("/api/account-safety")).status()).toBe(401);

  const adminCookie = await bootstrapAdmin(request);
  await createOrdinary(request, adminCookie);
  const userCookie = await session(request, "ordinary", "ordinary-password-123");

  const empty = await (
    await request.get("/api/account-safety", {
      headers: { Cookie: userCookie },
    })
  ).json();
  expect(empty.limits).toMatchObject({
    dailyCostLimitCnyMicrounits: 0,
    dailyCostLimitUsdMicrounits: 0,
    monthlyCostLimitCnyMicrounits: 0,
    monthlyCostLimitUsdMicrounits: 0,
  });
  expect(empty.usage).toMatchObject({
    dailyCnyMicrounits: 0,
    dailyUsdMicrounits: 0,
    monthlyCnyMicrounits: 0,
    monthlyUsdMicrounits: 0,
  });

  const saved = await request.put("/api/account-safety", {
    data: {
      dailyCostLimitCnyMicrounits: 5_000_000,
      dailyCostLimitUsdMicrounits: 2_000_000,
      monthlyCostLimitCnyMicrounits: 50_000_000,
      monthlyCostLimitUsdMicrounits: 20_000_000,
    },
    headers: { Cookie: userCookie },
  });
  expect(saved.status()).toBe(200);
  const after = await (
    await request.get("/api/account-safety", {
      headers: { Cookie: userCookie },
    })
  ).json();
  expect(after.limits).toMatchObject({
    dailyCostLimitCnyMicrounits: 5_000_000,
    dailyCostLimitUsdMicrounits: 2_000_000,
    monthlyCostLimitCnyMicrounits: 50_000_000,
    monthlyCostLimitUsdMicrounits: 20_000_000,
  });

  const invalid = await request.put("/api/account-safety", {
    data: { dailyCostLimitCnyMicrounits: -1 },
    headers: { Cookie: userCookie },
  });
  expect(invalid.status()).toBe(400);

  const adminView = await (
    await request.get("/api/account-safety", {
      headers: { Cookie: adminCookie },
    })
  ).json();
  expect(adminView.limits.dailyCostLimitCnyMicrounits).toBe(0);
});

function insertCostTask(
  database: ReturnType<typeof openAppDatabase>,
  id: string,
  ownerId: string,
  costCurrency: "CNY" | "USD",
  cost: number,
  timestamp: string,
) {
  database
    .prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, parameters,
        idempotency_key, request_fingerprint, state, owner_id,
        cost_currency, actual_cost_microunits, created_at, updated_at
      )
      VALUES (?, 'canvas', 'node', 'image', 'p', '{}', ?, 'f', 'success',
              ?, ?, ?, ?, ?)
    `)
    .run(id, `${id}-key`, ownerId, costCurrency, cost, timestamp, timestamp);
}

function insertUser(
  database: ReturnType<typeof openAppDatabase>,
  id: string,
  loginName: string,
) {
  database
    .prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      )
      VALUES (?, ?, 'Test', 'x', 'user', 'active', ?, ?)
    `)
    .run(id, loginName, new Date().toISOString(), new Date().toISOString());
}

function looseGlobal(
  store: ReturnType<typeof createGenerationSafetyStore>,
  cnyDailyLimit = 100_000_000,
) {
  store.update({
    globalEnabled: true,
    dailyCostLimitCnyMicrounits: cnyDailyLimit,
    monthlyCostLimitCnyMicrounits: 100_000_000,
    dailyCostLimitMicrounits: 100_000_000,
    monthlyCostLimitMicrounits: 100_000_000,
    requestsPerMinute: 100,
    perUserConcurrency: 100,
    imageConcurrency: 100,
    videoConcurrency: 100,
    audioConcurrency: 100,
    textConcurrency: 100,
  });
}

test("admission scopes spend by owner", () => {
  const dataDirectory = mkdtempSync(
    join(tmpdir(), "unboundry-safety-m81-owner-"),
  );
  try {
    const database = openAppDatabase(dataDirectory);
    const store = createGenerationSafetyStore(dataDirectory);
    const now = new Date();
    const timestamp = now.toISOString();
    looseGlobal(store, 4_000_000);
    insertUser(database, "owner-a", "owner-a");
    insertUser(database, "owner-b", "owner-b");

    insertCostTask(database, "task-a-1", "owner-a", "CNY", 3_000_000, timestamp);
    insertCostTask(database, "task-b-1", "owner-b", "CNY", 500_000, timestamp);
    insertCostTask(database, "task-b-2", "owner-b", "CNY", 500_000, timestamp);

    // A 已用 3 元、本次 1.5 元：4.5 > 4 应被全局上限拦截。
    expect(
      store.admission({
        costCurrency: "CNY",
        estimatedCostMicrounits: 1_500_000,
        kind: "image",
        ownerId: "owner-a",
        providerProfileId: "provider-test",
        now,
      }),
    ).toMatchObject({ allowed: false, code: "COST_LIMIT" });

    // B 已用 1 元、本次 1.5 元：2.5 < 4 应放行（旧实现对全体求和会误拦截）。
    expect(
      store.admission({
        costCurrency: "CNY",
        estimatedCostMicrounits: 1_500_000,
        kind: "image",
        ownerId: "owner-b",
        providerProfileId: "provider-test",
        now,
      }),
    ).toMatchObject({ allowed: true, code: "ALLOWED" });

    store.close();
  } finally {
    rmSync(dataDirectory, { force: true, recursive: true });
  }
});

test("per-account caps apply on top of a loose global budget", () => {
  const dataDirectory = mkdtempSync(
    join(tmpdir(), "unboundry-safety-m81-account-"),
  );
  try {
    const database = openAppDatabase(dataDirectory);
    const store = createGenerationSafetyStore(dataDirectory);
    const now = new Date();
    const timestamp = now.toISOString();
    looseGlobal(store);
    insertUser(database, "owner-a", "owner-a");
    insertUser(database, "owner-b", "owner-b");

    // A 单独设每日美元 $2，已用 $1.5，本次 $1 → 2.5 > 2 拦截；
    // 全局美元预算很宽松，旧实现会放行。
    store.updateAccountLimits("owner-a", {
      dailyCostLimitUsdMicrounits: 2_000_000,
    });
    insertCostTask(database, "task-a-1", "owner-a", "USD", 1_500_000, timestamp);
    insertCostTask(database, "task-a-2", "owner-a", "USD", 1_500_000, timestamp);
    expect(
      store.admission({
        costCurrency: "USD",
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-a",
        providerProfileId: "provider-test",
        now,
      }),
    ).toMatchObject({ allowed: false, code: "COST_LIMIT" });

    // B 没有设置独立上限，美元仍放行。
    expect(
      store.admission({
        costCurrency: "USD",
        estimatedCostMicrounits: 1_000_000,
        kind: "image",
        ownerId: "owner-b",
        providerProfileId: "provider-test",
        now,
      }),
    ).toMatchObject({ allowed: true, code: "ALLOWED" });

    store.close();
  } finally {
    rmSync(dataDirectory, { force: true, recursive: true });
  }
});

test("login lands on the workspace", async ({ page, request }) => {
  const adminCookie = await bootstrapAdmin(request);
  await createOrdinary(request, adminCookie);

  await page.goto(`${origin}/canvas/default`);
  await expect(page.getByTestId("login-page")).toBeVisible();
  await page.getByPlaceholder("3–40 位字母、数字或 . _ -").fill("ordinary");
  await page.getByPlaceholder("至少 12 位").fill("ordinary-password-123");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page).toHaveURL(`${origin}/canvas/projects`);
  await expect(page.getByTestId("workspace-page")).toBeVisible();
  await expect(page.getByTestId("project-card-default")).toBeVisible();
});

test("account safety page reads and saves the account's own limits", async ({
  page,
  request,
}) => {
  const adminCookie = await bootstrapAdmin(request);
  await createOrdinary(request, adminCookie);
  const userCookie = await session(request, "ordinary", "ordinary-password-123");
  await page.context().addCookies([
    {
      domain: "127.0.0.1",
      name: "unboundry_session",
      path: "/",
      value: userCookie.split("=")[1],
    },
  ]);

  await page.goto(`${origin}/account-safety`);
  await expect(page.getByTestId("account-safety-page")).toBeVisible();
  await page.getByTestId("account-safety-limit-daily-cny").fill("8");
  await page.getByTestId("account-safety-save").click();
  await expect(
    page.getByText("你的消耗上限已保存，下次生成立即生效"),
  ).toBeVisible();
});
