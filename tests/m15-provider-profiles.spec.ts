import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import {
  saveProviderProfile,
  verifyProviderProfile,
} from "../server/providerProfiles";

const port = 4199;
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");

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
  throw new Error("Provider administration test server did not start");
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

test("only administrators save encrypted Provider profiles and no secret reaches SQLite", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-providers-"));
  const secret = ["sk", "provider", randomUUID()].join("-");
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
    expect(bootstrap.status).toBe(201);
    const adminCookie = cookie(bootstrap);

    const initial = await request("/api/admin/providers", {
      cookie: adminCookie,
    });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      historicalEstimatedProviderAttempts: 0,
      paidProviderRequests: 0,
      profiles: [],
      providerSecretsStoredInBrowser: false,
      realGenerationEnabled: false,
    });

    const saved = await request("/api/admin/providers", {
      body: JSON.stringify({
        baseUrl: "https://openrouter.ai/api/v1",
        driver: "openrouter",
        label: "Production OpenRouter",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(saved.status).toBe(201);
    const savedText = await saved.text();
    expect(savedText).not.toContain(secret);
    const savedBody = JSON.parse(savedText) as {
      profile: { id: string };
    };
    expect(savedBody).toMatchObject({
      profile: {
        driver: "openrouter",
        hasApiKey: false,
        keyStatus: "unchecked",
        label: "Production OpenRouter",
        status: "saved",
      },
    });
    expect(
      (savedBody.profile as { apiKeyMask?: string }).apiKeyMask,
    ).toBeUndefined();
    const updated = await request(
      `/api/admin/providers/${savedBody.profile.id}`,
      {
        body: JSON.stringify({
          baseUrl: "https://openrouter.ai/api/v1",
          driver: "openrouter",
          label: "Primary OpenRouter",
        }),
        cookie: adminCookie,
        method: "PATCH",
      },
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      profile: {
        hasApiKey: false,
        keyStatus: "unchecked",
        label: "Primary OpenRouter",
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
      (await request("/api/admin/providers", { cookie: userCookie })).status,
    ).toBe(403);
    expect(
      (
        await request("/api/admin/providers", {
          body: JSON.stringify({
            apiKey: ["sk", "denied", randomUUID()].join("-"),
            baseUrl: "https://openrouter.ai/api/v1",
            driver: "openrouter",
            label: "Denied",
          }),
          cookie: userCookie,
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/admin/providers/${savedBody.profile.id}/test`,
          {
            cookie: userCookie,
            method: "POST",
          },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/admin/provider-catalog/${savedBody.profile.id}`,
          { cookie: userCookie },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/admin/provider-catalog/${savedBody.profile.id}/credentials`,
          {
            body: JSON.stringify({
              accessKeyId: "AKLT-denied-control",
              projectName: "default",
              secretAccessKey: "denied-control-secret",
            }),
            cookie: userCookie,
            method: "PATCH",
          },
        )
      ).status,
    ).toBe(403);

    await stopServer(server);
    server = undefined;

    const encrypted = await readFile(
      join(dataDirectory, "secrets", "provider-profiles.enc.json"),
      "utf8",
    );
    expect(encrypted).not.toContain(secret);
    expect(encrypted).not.toContain("Production OpenRouter");
    expect(encrypted).not.toContain("openrouter.ai");

    const databasePath = join(dataDirectory, "tapnow.sqlite");
    const databaseBytes = await readFile(databasePath);
    expect(databaseBytes.includes(Buffer.from(secret))).toBe(false);
    const database = new DatabaseSync(databasePath);
    try {
      const row = database
        .prepare(`
          SELECT display_name, driver, key_checked_at, key_status, status
          FROM provider_profiles
          WHERE display_name = 'Primary OpenRouter'
        `)
        .get();
      expect(row).toMatchObject({
        display_name: "Primary OpenRouter",
        driver: "openrouter",
        key_checked_at: null,
        key_status: "unchecked",
        status: "disabled",
      });
      const audit = database
        .prepare(`
          SELECT details
          FROM admin_audit_events
          WHERE action = 'provider_profile.create'
          ORDER BY id DESC
          LIMIT 1
        `)
        .get() as { details: string };
      expect(audit.details).not.toContain(secret);
      expect(audit.details).not.toContain("openrouter.ai");
      expect(
        database
          .prepare(`
            SELECT COUNT(*) AS count
            FROM admin_audit_events
            WHERE action = 'provider_profile.update'
          `)
          .get(),
      ).toMatchObject({ count: 1 });
    } finally {
      database.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("read-only Provider verification checks model lists without generating", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-provider-test-"));
  const previousDataDirectory = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = dataDirectory;
  try {
    const secret = ["sk", "readonly", randomUUID()].join("-");
    const profile = await saveProviderProfile({
      apiKey: secret,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Read Only OpenRouter",
    });
    let requestedUrl = "";
    let requestedAuthorization = "";
    let requestedMethod = "";
    const verification = await verifyProviderProfile(
      profile.id,
      "__test__",
      async (input, init) => {
        requestedUrl = String(input);
        requestedAuthorization = new Headers(init?.headers).get(
          "Authorization",
        ) ?? "";
        requestedMethod = init?.method ?? "";
        return new Response(
          JSON.stringify({
            data: [
              { id: "vendor/text-model", name: "Text Model" },
              { id: "vendor/image-model", name: "Image Model" },
            ],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      },
    );
    expect(requestedUrl).toBe(
      "https://openrouter.ai/api/v1/models/user",
    );
    expect(requestedAuthorization).toBe(`Bearer ${secret}`);
    expect(requestedMethod).toBe("GET");
    expect(verification).toMatchObject({
      message: "API Key有效。可读取模型：2 个。",
      modelCount: 2,
      status: "verified",
    });

    const database = new DatabaseSync(join(dataDirectory, "tapnow.sqlite"));
    try {
      expect(
        database
          .prepare(`
            SELECT key_checked_at, key_status, status
            FROM provider_profiles
            WHERE id = ?
          `)
          .get(profile.id),
      ).toMatchObject({
        key_status: "valid",
        status: "enabled",
      });
      expect(
        database
          .prepare(`
            SELECT key_checked_at
            FROM provider_profiles
            WHERE id = ?
          `)
          .get(profile.id),
      ).toMatchObject({ key_checked_at: expect.any(String) });
    } finally {
      database.close();
    }

    const ark = await saveProviderProfile({
      apiKey: ["ark", "readonly", randomUUID()].join("-"),
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Read Only Ark",
    });
    let arkFetchCalled = false;
    let arkRequestedUrl = "";
    const arkVerification = await verifyProviderProfile(
      ark.id,
      "__test__",
      async (input, init) => {
        arkFetchCalled = true;
        arkRequestedUrl = String(input);
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify({ items: [{ id: "cgt-safe-read" }] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      },
    );
    expect(arkFetchCalled).toBe(true);
    expect(arkRequestedUrl).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_num=1&page_size=1",
    );
    expect(arkVerification).toMatchObject({
      message: "API Key有效。视频任务接口可读。",
      modelCount: 1,
      status: "verified",
    });

    const murekaSecret = ["mureka", "readonly", randomUUID()].join("-");
    const mureka = await saveProviderProfile({
      apiKey: murekaSecret,
      baseUrl: "https://api.mureka.ai",
      driver: "mureka",
      label: "Read Only Mureka",
    });
    let murekaRequestedUrl = "";
    const murekaVerification = await verifyProviderProfile(
      mureka.id,
      "__test__",
      async (input, init) => {
        murekaRequestedUrl = String(input);
        expect(init?.method).toBe("GET");
        expect(new Headers(init?.headers).get("Authorization"))
          .toBe(`Bearer ${murekaSecret}`);
        return new Response(JSON.stringify({
          account_id: 1001,
          concurrent_request_limit: 1,
          trace_id: "safe-read-only-trace",
        }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      },
    );
    expect(murekaRequestedUrl).toBe("https://api.mureka.ai/v1/account/billing");
    expect(murekaVerification).toMatchObject({
      message: "API Key有效。账户接口可读。",
      modelCount: 0,
      status: "verified",
    });
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.TAPNOW_DATA_DIR;
    } else {
      process.env.TAPNOW_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("Provider Key status persists invalid and uncertain rechecks without stale green", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-provider-status-"));
  const previousDataDirectory = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = dataDirectory;
  try {
    const profile = await saveProviderProfile({
      apiKey: ["sk", "status", randomUUID()].join("-"),
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Status OpenRouter",
    });
    const validResponse = () => new Response(JSON.stringify({ data: [] }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
    const readStatus = () => {
      const database = new DatabaseSync(join(dataDirectory, "tapnow.sqlite"));
      try {
        return database.prepare(`
          SELECT key_checked_at, key_status, status
          FROM provider_profiles
          WHERE id = ?
        `).get(profile.id);
      } finally {
        database.close();
      }
    };

    const uncertainChecks: Array<{
      code: string;
      fetcher: typeof fetch;
    }> = [
      {
        code: "PERMISSION",
        fetcher: async () => new Response(
          JSON.stringify({ error: "forbidden" }),
          { status: 403 },
        ),
      },
      {
        code: "RATE_LIMIT",
        fetcher: async () => new Response(
          JSON.stringify({ error: "rate limited" }),
          { status: 429 },
        ),
      },
      {
        code: "REMOTE",
        fetcher: async () => new Response(
          JSON.stringify({ error: "unavailable" }),
          { status: 503 },
        ),
      },
      {
        code: "FORMAT",
        fetcher: async () => new Response(JSON.stringify({ unexpected: [] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      },
      {
        code: "NETWORK",
        fetcher: async () => {
          throw new Error("offline");
        },
      },
    ];

    for (const check of uncertainChecks) {
      await verifyProviderProfile(profile.id, "__test__", async () => validResponse());
      await expect(
        verifyProviderProfile(profile.id, "__test__", check.fetcher),
      ).rejects.toThrow(check.code);
      expect(readStatus()).toMatchObject({
        key_checked_at: expect.any(String),
        key_status: "unknown",
        status: "enabled",
      });
    }

    await verifyProviderProfile(profile.id, "__test__", async () => validResponse());
    await expect(
      verifyProviderProfile(
        profile.id,
        "__test__",
        async () => new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
        }),
      ),
    ).rejects.toThrow("AUTH");
    expect(readStatus()).toMatchObject({
      key_checked_at: expect.any(String),
      key_status: "invalid",
      status: "disabled",
    });

    let releaseResponse = () => {};
    let signalRequestStarted = () => {};
    const requestStarted = new Promise<void>((resolve) => {
      signalRequestStarted = resolve;
    });
    const responseReleased = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const staleCheck = verifyProviderProfile(profile.id, "__test__", async () => {
      signalRequestStarted();
      await responseReleased;
      return validResponse();
    });
    await requestStarted;
    await saveProviderProfile({
      apiKey: ["sk", "replacement", randomUUID()].join("-"),
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: profile.label,
    }, profile.id);
    releaseResponse();
    await expect(staleCheck).rejects.toThrow("CONFIG_CHANGED");
    expect(readStatus()).toMatchObject({
      key_checked_at: null,
      key_status: "unchecked",
      status: "disabled",
    });
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.TAPNOW_DATA_DIR;
    } else {
      process.env.TAPNOW_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("administrator Provider page stays simple and makes zero external requests", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
  const externalRequests: string[] = [];
  page.on("request", (browserRequest) => {
    const url = new URL(browserRequest.url());
    if (url.origin !== localOrigin) {
      externalRequests.push(browserRequest.url());
    }
  });

  await page.goto("/admin/providers");
  await expect(page.getByTestId("admin-providers-page")).toBeVisible();
  await expect(page.getByText("当前付费请求为0")).toBeVisible();
  await expect(page.getByRole("button", { name: "OpenRouter" }))
    .toHaveAttribute("data-selected", "true");
  await page.getByRole("button", { name: "Mureka" }).click();
  await expect(page.getByLabel("接口地址")).toHaveValue("https://api.mureka.ai");
  await expect(page.getByLabel("接口地址")).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "OpenRouter" }).click();

  const secret = ["sk", "browser", randomUUID()].join("-");
  await page.getByLabel("连接名称").fill("Browser OpenRouter");
  await expect(page.getByLabel("API Key")).toHaveCount(0);
  await page.getByRole("button", { name: "加密保存连接" }).click();

  await expect(page.getByText("连接资料已加密保存")).toBeVisible();
  const browserProfile = page.getByRole("article").filter({
    hasText: "Browser OpenRouter",
  });
  await expect(browserProfile).toBeVisible();
  await expect(browserProfile.locator('[data-key-status="unchecked"]'))
    .toHaveText("Key未检查");
  await expect(browserProfile.getByRole("button", { name: "检查连接" }))
    .toBeVisible();
  await expect(page.locator("body")).not.toContainText(secret);

  const mockedProfileId = "11111111-1111-4111-8111-111111111111";
  let mockedKeyStatus: "valid" | "invalid" = "valid";
  let mockedCheckCount = 0;
  await page.route("**/api/admin/providers", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 0,
        profiles: [{
          apiKeyMask: "••••safe",
          baseUrl: "https://openrouter.ai/api/v1",
          driver: "openrouter",
          hasApiKey: true,
          id: mockedProfileId,
          keyStatus: mockedKeyStatus,
          label: "Recheck OpenRouter",
          lastCheckedAt: "2026-08-03T08:00:00.000Z",
          status: mockedKeyStatus === "valid" ? "verified" : "saved",
          updatedAt: "2026-08-03T08:00:00.000Z",
        }],
        providerSecretsStoredInBrowser: false,
        realGenerationEnabled: false,
        supportedDrivers: ["openrouter"],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(
    `**/api/admin/providers/${mockedProfileId}/test`,
    async (route) => {
      if (mockedCheckCount === 0) {
        mockedCheckCount += 1;
        await route.fulfill({
          body: JSON.stringify({
            paidGenerationRequests: 0,
            verification: {
              message: "API Key有效。可读取模型：37 个。",
              modelCount: 37,
              status: "verified",
            },
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      mockedKeyStatus = "invalid";
      await route.fulfill({
        body: JSON.stringify({
          error: "API Key已失效",
          paidGenerationRequests: 0,
        }),
        contentType: "application/json",
        status: 400,
      });
    },
  );
  await page.reload();
  await expect(page.locator('[data-key-status="valid"]')).toHaveText("Key有效");
  await page.getByRole("button", { name: "检查连接" }).click();
  await expect(page.getByRole("status"))
    .toHaveText("API Key有效。可读取模型：37 个。");
  await page.getByRole("button", { name: "检查连接" }).click();
  await expect(page.locator('[data-key-status="invalid"]')).toHaveText("Key已失效");
  await expect(page.getByRole("status")).toHaveText("API Key已失效");
  expect(externalRequests).toEqual([]);
});
