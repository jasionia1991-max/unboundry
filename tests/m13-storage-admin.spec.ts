import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { expect, test } from "./safe-test";
import {
  createAliyunOssObjectKey,
  createPrivateAliyunOssReadUrl,
  deletePrivateAliyunOssObject,
  safeAliyunOssConnectionError,
  testAliyunOssConnection,
  type AliyunOssUrllib,
  uploadPrivateAliyunOssObject,
} from "../server/aliyunOss";
import { publishCloudObject } from "../server/cloudMediaStorage";
import type { PublicHttpsFetchDependencies } from "../server/outboundNetwork";
import {
  activateStorageProfile,
  markStorageProfileVerified,
  saveStorageProfile,
  setStorageMediaRouting,
  storageMediaRoutingState,
} from "../server/secureStorageProfiles";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
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

test("storage profiles only save the exact canonical endpoint for their region", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-oss-endpoint-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  const base = {
    accessKeyId: "canonical-endpoint-access-key",
    accessKeySecret: "canonical-endpoint-secret-key",
    bucket: "canonical-private-bucket",
    label: "Canonical endpoint",
    region: "oss-cn-hangzhou",
  };
  try {
    for (const endpoint of [
      "https://custom-storage.example.test",
      "https://oss-cn-shanghai.aliyuncs.com",
      "https://oss-cn-hangzhou.aliyuncs.com:443",
      "https://oss-cn-hangzhou.aliyuncs.com:8443",
      "https://user@oss-cn-hangzhou.aliyuncs.com",
      "https://oss-cn-hangzhou.aliyuncs.com/path",
    ]) {
      await expect(saveStorageProfile({ ...base, endpoint }))
        .rejects.toThrow("OSS configuration is invalid");
    }
    const saved = await saveStorageProfile({
      ...base,
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    });
    expect(saved).toMatchObject({
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      region: "oss-cn-hangzhou",
      status: "draft",
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

test("Aliyun OSS SDK operations pin public DNS and the signed read never follows redirects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-oss-guard-"));
  const fixture = join(directory, "fixture.bin");
  await writeFile(fixture, Buffer.from("data"));
  const credentials = {
    accessKeyId: "guarded-oss-access-key",
    accessKeySecret: "guarded-oss-secret-key",
    bucket: "guarded-private-bucket",
    endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    region: "oss-cn-hangzhou",
  };
  const events: string[] = [];
  let storedSize = 0;
  let failNextHead = false;
  const transport: AliyunOssUrllib = {
    async request(value, options = {}) {
      const url = new URL(value);
      expect(url.protocol).toBe("https:");
      expect(url.port).toBe("");
      expect(url.hostname).toBe(
        "guarded-private-bucket.oss-cn-hangzhou.aliyuncs.com",
      );
      expect(options.followRedirect).toBe(false);
      expect(options.enableProxy).toBe(false);
      expect(options.agent).toBe(false);
      expect(options.httpsAgent).toBe(false);
      const resolved = await new Promise<{ address: string; family: number }>(
        (resolve, reject) => {
          (options.lookup as any)(
            url.hostname,
            { all: false, family: 0 },
            (error: Error | null, address: string, family: number) =>
              error ? reject(error) : resolve({ address, family }),
          );
        },
      );
      expect(resolved).toEqual({ address: "93.184.216.34", family: 4 });
      expect(options.checkAddress?.(
        resolved.address,
        resolved.family,
        url.hostname,
      )).toBe(true);
      const resolvedAll = await new Promise<
        Array<{ address: string; family: number }>
      >((resolve, reject) => {
        (options.lookup as any)(
          url.hostname,
          { all: true, family: 0 },
          (error: Error | null, addresses: Array<{
            address: string;
            family: number;
          }>) => error ? reject(error) : resolve(addresses),
        );
      });
      expect(resolvedAll).toEqual([
        { address: "93.184.216.34", family: 4 },
      ]);
      expect(options.checkAddress?.(
        resolvedAll as unknown as string,
        "",
        url.hostname,
      )).toBe(true);
      expect(options.checkAddress?.("10.0.0.8", 4, url.hostname)).toBe(false);

      const method = String(options.method ?? "GET").toUpperCase();
      events.push(method);
      if (method === "PUT") {
        if (Buffer.isBuffer(options.content)) {
          storedSize = options.content.byteLength;
        } else if (options.stream) {
          storedSize = 0;
          for await (const chunk of options.stream) {
            storedSize += Buffer.byteLength(chunk);
          }
        }
      }
      if (method === "HEAD" && failNextHead) {
        failNextHead = false;
        const error = new Error("injected head failure");
        error.name = "ResponseError";
        throw error;
      }
      const headers: Record<string, string> = method === "HEAD"
        ? { "content-length": String(storedSize) }
        : {
            etag: "fixture-etag",
            "x-oss-request-id": "fixture-request-id",
          };
      return {
        data: Buffer.alloc(0),
        headers,
        res: { headers } as any,
        status: method === "DELETE" ? 204 : 200,
      };
    },
  };
  const resolver = (async () => [{
    address: "93.184.216.34",
    family: 4 as const,
  }]) as any;
  const network = { resolver, urllib: transport };
  const uploadInput = {
    byteSize: 4,
    checksumSha256: "a".repeat(64),
    contentType: "application/octet-stream",
    credentials,
    filePath: fixture,
    network,
    objectKey: "objects/2026/08/image/guarded.bin",
  };
  try {
    const uploaded = await uploadPrivateAliyunOssObject(uploadInput);
    expect(uploaded).toMatchObject({
      etag: "fixture-etag",
      requestId: "fixture-request-id",
    });
    expect(events.splice(0)).toEqual(["PUT", "HEAD"]);

    await deletePrivateAliyunOssObject(
      uploadInput.objectKey,
      credentials,
      network,
    );
    expect(events.splice(0)).toEqual(["DELETE"]);

    failNextHead = true;
    await expect(uploadPrivateAliyunOssObject(uploadInput)).rejects.toThrow();
    expect(events.splice(0)).toEqual(["PUT", "HEAD", "DELETE"]);

    const signedReadRequests: Array<{
      address: string;
      family: number;
      range: string | null;
      url: string;
    }> = [];
    let signedReadStatus = 206;
    const requester = ((
      url: URL,
      options: Record<string, unknown>,
      respond: (response: IncomingMessage) => void,
    ) => {
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => {
        const lookup = options.lookup as (
          hostname: string,
          lookupOptions: { family?: number },
          callback: (
            error: Error | null,
            address: string,
            family: number,
          ) => void,
        ) => void;
        lookup(url.hostname, { family: 0 }, (error, address, family) => {
          if (error) {
            request.emit("error", error);
            return;
          }
          const headers = new Headers(options.headers as HeadersInit | undefined);
          signedReadRequests.push({
            address,
            family,
            range: headers.get("range"),
            url: url.toString(),
          });
          const incoming = Readable.from([Buffer.from("x")]) as IncomingMessage;
          Object.assign(incoming, {
            rawHeaders: signedReadStatus === 302
              ? ["location", "https://127.0.0.1/private"]
              : ["content-type", "application/octet-stream"],
            statusCode: signedReadStatus,
            statusMessage: signedReadStatus === 302
              ? "Found"
              : "Partial Content",
          });
          respond(incoming);
        });
        return request;
      }) as ClientRequest["end"];
      return request;
    }) as NonNullable<PublicHttpsFetchDependencies["requester"]>;
    const tested = await testAliyunOssConnection(credentials, {
      ...network,
      requester,
    });
    expect(tested).toMatchObject({
      cleanupVerified: true,
      signedReadVerified: true,
    });
    expect(signedReadRequests).toHaveLength(1);
    expect(signedReadRequests[0]).toMatchObject({
      address: "93.184.216.34",
      family: 4,
      range: "bytes=0-0",
    });
    expect(new URL(signedReadRequests[0].url).hostname).toBe(
      "guarded-private-bucket.oss-cn-hangzhou.aliyuncs.com",
    );
    expect(events.splice(0)).toEqual(["PUT", "HEAD", "DELETE"]);

    signedReadStatus = 302;
    await expect(testAliyunOssConnection(credentials, {
      ...network,
      requester,
    })).rejects.toThrow("Signed OSS read failed");
    expect(signedReadRequests).toHaveLength(2);
    expect(events.splice(0)).toEqual(["PUT", "HEAD", "DELETE"]);

    let blockedTransportCalls = 0;
    await expect(deletePrivateAliyunOssObject(
      uploadInput.objectKey,
      credentials,
      {
        resolver: (async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.8", family: 4 },
        ]) as any,
        urllib: {
          async request() {
            blockedTransportCalls += 1;
            throw new Error("must not reach transport");
          },
        },
      },
    )).rejects.toThrow();
    expect(blockedTransportCalls).toBe(0);
  } finally {
    await rm(directory, { force: true, recursive: true });
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

test("private OSS read signatures clamp lifetime and never expose the secret", async () => {
  const credentials = {
    accessKeyId: "test-signed-read-access-key",
    accessKeySecret: "test-signed-read-secret-never-exposed",
    bucket: "private-signed-read-bucket",
    endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    region: "oss-cn-hangzhou",
  };
  const lowTtl = await createPrivateAliyunOssReadUrl(
    "objects/2026/08/image/offline-low.png",
    credentials,
    1,
  );
  const highTtl = await createPrivateAliyunOssReadUrl(
    "objects/2026/08/image/offline-high.png",
    credentials,
    86_400,
  );
  for (const signed of [lowTtl, highTtl]) {
    const url = new URL(signed);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toContain("private-signed-read-bucket");
    expect(signed).toContain("x-oss-signature-version=OSS4-HMAC-SHA256");
    expect(signed).not.toContain(credentials.accessKeySecret);
  }
  await expect(
    createPrivateAliyunOssReadUrl("../private.png", credentials, 60),
  ).rejects.toThrow("Invalid OSS object key");
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
