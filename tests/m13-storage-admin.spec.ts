import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import {
  createAliyunOssObjectKey,
  createPrivateAliyunOssReadUrl,
  safeAliyunOssConnectionError,
} from "../server/aliyunOss";
import { publishCloudObject } from "../server/cloudMediaStorage";
import {
  activateStorageProfile,
  activeStorageProfile,
  markStorageProfileVerified,
  saveStorageProfile,
  setStorageMediaRouting,
  storageMediaRoutingState,
} from "../server/secureStorageProfiles";

const port = 4196;
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");
const secretSentinel = "storage-secret-must-not-leave-server";

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
  throw new Error("Storage administration test server did not start");
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

test("storage status is administrator-only and never returns OSS secrets", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-storage-"));
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

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = await request("/api/assets/storage-test-image", {
      body: png,
      cookie: adminCookie,
      headers: { "Content-Type": "image/png" },
      method: "POST",
    });
    expect(upload.status).toBe(201);

    const saved = await request("/api/admin/storage/profiles", {
      body: JSON.stringify({
        accessKeyId: "LTAI-test-server-only-id",
        accessKeySecret: secretSentinel,
        bucket: "private-test-bucket",
        endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
        label: "Production OSS",
        region: "oss-cn-hangzhou",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(saved.status).toBe(201);

    const storageResponse = await request("/api/admin/storage", {
      cookie: adminCookie,
    });
    expect(storageResponse.status).toBe(200);
    const responseText = await storageResponse.text();
    expect(responseText).not.toContain(secretSentinel);
    expect(responseText).not.toContain("LTAI-test-server-only-id");
    const storage = JSON.parse(responseText);
    expect(storage).toMatchObject({
      activeBackend: "local",
      browserStoresSecrets: false,
      cloudRequestsEnabled: false,
      local: {
        bytes: png.length,
        checksummed: 1,
        enabled: true,
        objects: 1,
      },
      oss: {
        activeProfileId: "",
        mediaRoutingEnabled: false,
        profiles: [
          {
            accessKeyIdMask: "••••y-id",
            bucket: "private-test-bucket",
            hasAccessKeySecret: true,
            label: "Production OSS",
            status: "draft",
          },
        ],
        provider: "aliyun-oss",
        sdkInstalled: true,
      },
    });
    const encrypted = await readFile(
      join(dataDirectory, "secrets", "storage-profiles.enc.json"),
      "utf8",
    );
    expect(encrypted).not.toContain(secretSentinel);
    expect(encrypted).not.toContain("LTAI-test-server-only-id");
    const database = await readFile(join(dataDirectory, "unboundry.sqlite"));
    expect(database.includes(Buffer.from(secretSentinel))).toBe(false);

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
    expect(
      (
        await request("/api/admin/storage", {
          cookie: cookie(login),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/admin/storage/profiles", {
          body: JSON.stringify({
            accessKeyId: "ordinary-must-not-save",
            accessKeySecret: "ordinary-must-not-save-secret",
            bucket: "ordinary-bucket",
            endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
            label: "Denied",
            region: "oss-cn-hangzhou",
          }),
          cookie: cookie(login),
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/admin/storage/media-routing", {
          body: JSON.stringify({ enabled: true }),
          cookie: adminCookie,
          method: "POST",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/admin/storage/media-routing", {
          body: JSON.stringify({ enabled: true }),
          cookie: cookie(login),
          method: "POST",
        })
      ).status,
    ).toBe(403);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("new-media OSS routing stays off until an admin explicitly enables it", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-routing-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  try {
    const draft = await saveStorageProfile({
      accessKeyId: "test-routing-access-key",
      accessKeySecret: "test-routing-secret-key",
      bucket: "private-routing-bucket",
      endpoint: "https://oss-cn-shanghai.aliyuncs.com",
      label: "Routing Test",
      region: "oss-cn-shanghai",
    });
    await markStorageProfileVerified(draft.id);
    await activateStorageProfile(draft.id);
    expect(await storageMediaRoutingState()).toMatchObject({
      enabled: false,
      profile: { id: draft.id, status: "active" },
    });
    await setStorageMediaRouting(true);
    expect(await storageMediaRoutingState()).toMatchObject({
      enabled: true,
      profile: { id: draft.id, status: "active" },
    });
    await setStorageMediaRouting(false);
    expect(await storageMediaRoutingState()).toMatchObject({
      enabled: false,
    });
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("cloud publication removes an uploaded object when database publication fails", async () => {
  const events: string[] = [];
  await expect(
    publishCloudObject({
      commit: () => {
        events.push("commit");
        throw new Error("database publication failed");
      },
      remove: async () => {
        events.push("remove");
      },
      upload: async () => {
        events.push("upload");
      },
    }),
  ).rejects.toThrow("database publication failed");
  expect(events).toEqual(["upload", "commit", "remove"]);
});

test("Aliyun OSS adapter keeps private random keys and signs offline", async () => {
  const key = createAliyunOssObjectKey(
    "image",
    "png",
    new Date("2026-07-31T00:00:00.000Z"),
  );
  expect(key).toMatch(
    /^objects\/2026\/07\/image\/[0-9a-f-]{36}\.png$/,
  );
  expect(key).not.toContain("@");
  const signed = await createPrivateAliyunOssReadUrl(
    key,
    {
      accessKeyId: "test-access-key-id",
      accessKeySecret: "test-access-key-secret",
      bucket: "private-test-bucket",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      region: "oss-cn-hangzhou",
    },
    60,
  );
  expect(signed).toContain("x-oss-signature-version=OSS4-HMAC-SHA256");
  expect(
    safeAliyunOssConnectionError({
      code: "InvalidAccessKeyId",
      message: secretSentinel,
    }),
  ).toEqual({
    code: "INVALID_ACCESS_KEY",
    message: "AK不存在或已失效，请检查AccessKey ID。",
  });
  expect(
    JSON.stringify(
      safeAliyunOssConnectionError(
        new Error(`unknown provider failure ${secretSentinel}`),
      ),
    ),
  ).not.toContain(secretSentinel);
});

test("activated private OSS image supports signed Range and complete download", async () => {
  test.skip(
    process.env.UNBOUNDRY_REAL_OSS_VERIFY !== "1",
    "Only run after the administrator explicitly enables real OSS image routing",
  );
  const database = new DatabaseSync(
    join(process.cwd(), "data", "unboundry.sqlite"),
    { readOnly: true },
  );
  const media = database
    .prepare(`
      SELECT object_key, byte_size, checksum_sha256
      FROM media_assets
      WHERE kind = 'image'
        AND storage_backend = 'oss'
        AND storage_status = 'ready'
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    .get() as
    | {
        byte_size: number;
        checksum_sha256: string;
        object_key: string;
      }
    | undefined;
  expect(media).toBeTruthy();
  const profile = await activeStorageProfile();
  expect(profile).toBeTruthy();
  const signedUrl = await createPrivateAliyunOssReadUrl(
    media!.object_key,
    profile!,
    60,
  );
  const range = await fetch(signedUrl, {
    headers: { Range: "bytes=0-0" },
  });
  expect(range.status).toBe(206);
  expect((await range.arrayBuffer()).byteLength).toBe(1);

  const complete = await fetch(signedUrl);
  expect(complete.status).toBe(200);
  const bytes = Buffer.from(await complete.arrayBuffer());
  expect(bytes).toHaveLength(Number(media!.byte_size));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    media!.checksum_sha256,
  );
});

test("administrator storage center encrypts profiles without cloud requests", async ({
  page,
}) => {
  await page.goto("/admin/storage");
  await expect(page.getByTestId("admin-storage-page")).toBeVisible();
  await expect(page.getByText("当前仍使用本机存储")).toBeVisible();
  await expect(page.getByText("云请求关闭")).toBeVisible();
  await expect(page.getByText("添加阿里云 OSS")).toBeVisible();
  await expect(page.getByTestId("storage-media-routing-toggle")).toBeDisabled();
  await expect(page.getByText("暂无配置。上方填写后只会加密保存，不会自动发起云请求。"))
    .toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(2);
  await page.getByPlaceholder("配置名称，例如：生产OSS").fill("Browser OSS");
  await page
    .getByPlaceholder("https://oss-cn-hangzhou.aliyuncs.com")
    .fill("https://oss-cn-hangzhou.aliyuncs.com");
  await page
    .getByPlaceholder("区域，例如 oss-cn-hangzhou")
    .fill("oss-cn-hangzhou");
  await page.getByPlaceholder("Bucket名称").fill("browser-private-bucket");
  await page.getByPlaceholder("AccessKey ID").fill("browser-access-key-id");
  await page
    .getByPlaceholder("AccessKey Secret")
    .fill("browser-access-key-secret");
  await page.getByRole("button", { name: "加密保存" }).click();
  await expect(page.getByText("配置已加密保存，尚未连接或上传。"))
    .toBeVisible();
  await expect(page.getByText("Browser OSS")).toBeVisible();
  await expect(page.getByText("AK ••••y-id · SK 已保存")).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(
    "browser-access-key-secret",
  );
  const scrollState = await page
    .getByTestId("admin-storage-page")
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
    });
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
  expect(scrollState.scrollTop).toBeGreaterThan(0);
  await expect(page.getByText("现有素材永远不会因为这个开关自动迁移"))
    .toBeVisible();

  await page.route("**/api/admin/storage/profiles/*/test", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        code: "INVALID_ACCESS_KEY",
        error: "AK不存在或已失效，请检查AccessKey ID。",
      }),
      contentType: "application/json",
      status: 400,
    });
  });
  page.once("dialog", (dialog) => void dialog.accept());
  const profileCard = page
    .locator(".storage-profile-cards article")
    .filter({ hasText: "Browser OSS" });
  await profileCard.getByRole("button", { name: "测试连接" }).click();
  await expect(
    profileCard.getByText("AK不存在或已失效，请检查AccessKey ID。"),
  ).toBeVisible();
});
