import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
        UNBOUNDRY_TRUST_PROXY: "1",
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
  throw new Error("M81 deployment hardening server did not start");
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
  options: RequestInit & {
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const { cookie: session, headers, ...init } = options;
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Cookie: session } : {}),
      ...headers,
    },
  });
}

async function bootstrapAdmin() {
  const bootstrap = await request("/api/auth/bootstrap", {
    body: JSON.stringify({
      displayName: "Owner",
      loginName: "owner",
      password: "owner-password-123",
    }),
    headers: { "X-Forwarded-For": "127.0.0.1" },
    method: "POST",
  });
  expect(bootstrap.ok).toBe(true);
  return cookie(bootstrap);
}

test("trusted proxy mode blocks remote bootstrap through forwarded IP", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-bootstrap-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);

    const remote = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Remote",
        loginName: "remote",
        password: "remote-pass-123",
      }),
      headers: { "X-Forwarded-For": "203.0.113.9" },
      method: "POST",
    });
    expect(remote.status).toBe(403);
    expect(await remote.text()).toContain("首次管理员只能在服务器本机创建");

    const local = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      }),
      headers: { "X-Forwarded-For": "127.0.0.1" },
      method: "POST",
    });
    expect(local.status).toBe(201);
    expect(cookie(local)).not.toBe("");
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("trusted proxy mode requires https forwarding for storage writes", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-storage-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const adminCookie = await bootstrapAdmin();
    const profile = {
      accessKeyId: "m81-test-access-key-id",
      accessKeySecret: "m81-test-secret-key",
      bucket: "m81-private-bucket",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      label: "M81 Test OSS",
      region: "oss-cn-hangzhou",
    };

    const plain = await request("/api/admin/storage/profiles", {
      body: JSON.stringify(profile),
      cookie: adminCookie,
      headers: { "X-Forwarded-For": "127.0.0.1" },
      method: "POST",
    });
    expect(plain.status).toBe(400);
    expect(await plain.text()).toContain("HTTPS");

    const secure = await request("/api/admin/storage/profiles", {
      body: JSON.stringify(profile),
      cookie: adminCookie,
      headers: {
        "X-Forwarded-For": "127.0.0.1",
        "X-Forwarded-Proto": "https",
      },
      method: "POST",
    });
    expect(secure.status).toBe(201);

    const readThroughProxy = await request("/api/admin/storage", {
      cookie: adminCookie,
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    expect(readThroughProxy.status).toBe(200);

    const direct = await request("/api/admin/storage/profiles", {
      body: JSON.stringify({ ...profile, label: "M81 Direct OSS" }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(direct.status).toBe(201);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
