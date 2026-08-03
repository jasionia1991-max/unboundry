import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const port = 4194;
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
  throw new Error("Authentication test server did not start");
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

test("admin bootstrap, account control and per-user data isolation are enforced", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-auth-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);

    expect((await request("/api/canvas/shared")).status).toBe(401);
    expect(await (await request("/api/auth/status")).json()).toMatchObject({
      authenticated: false,
      bootstrapRequired: true,
    });

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
    expect(adminCookie).toContain("tapnow_session=");

    const adminCanvas = await request("/api/canvas/shared", {
      body: JSON.stringify({
        edges: [],
        nodes: [{ id: "admin-node" }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      cookie: adminCookie,
      method: "PUT",
    });
    expect(adminCanvas.status).toBe(200);

    const created = await request("/api/admin/users", {
      body: JSON.stringify({
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(created.status).toBe(201);
    const ordinaryUser = (await created.json()).user as { id: string };

    const login = await request("/api/auth/login", {
      body: JSON.stringify({
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      method: "POST",
    });
    expect(login.status).toBe(200);
    const userCookie = cookie(login);

    expect(
      (await request("/api/canvas/shared", { cookie: userCookie })).status,
    ).toBe(404);
    expect(
      (
        await request("/api/canvas/shared", {
          body: JSON.stringify({
            edges: [],
            nodes: [{ id: "ordinary-node" }],
            revision: 0,
            viewport: { x: 4, y: 5, zoom: 0.8 },
          }),
          cookie: userCookie,
          method: "PUT",
        })
      ).status,
    ).toBe(200);

    const adminSaved = await (
      await request("/api/canvas/shared", { cookie: adminCookie })
    ).json();
    const userSaved = await (
      await request("/api/canvas/shared", { cookie: userCookie })
    ).json();
    expect(adminSaved.nodes).toEqual([{ id: "admin-node" }]);
    expect(userSaved.nodes).toEqual([{ id: "ordinary-node" }]);

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = await request("/api/assets/private-image", {
      body: png,
      cookie: adminCookie,
      headers: { "Content-Type": "image/png" },
      method: "POST",
    });
    expect(upload.status).toBe(201);
    expect(
      (await request("/api/assets/private-image", { cookie: userCookie })).status,
    ).toBe(404);
    expect(
      (await request("/api/assets/private-image", { cookie: adminCookie })).status,
    ).toBe(200);

    expect(
      (
        await request(`/api/admin/users/${ordinaryUser.id}`, {
          body: JSON.stringify({ status: "disabled" }),
          cookie: adminCookie,
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect(
      (await request("/api/canvas/shared", { cookie: userCookie })).status,
    ).toBe(401);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
