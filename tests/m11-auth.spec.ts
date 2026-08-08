import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openAppDatabase } from "../server/database";

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

test("login lands on the workspace instead of the previous canvas URL", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-auth-login-"));
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

    await page.goto(`${origin}/canvas/default`);
    await expect(page.getByTestId("login-page")).toBeVisible();
    await page.getByPlaceholder("3–40 位字母、数字或 . _ -").fill("owner");
    await page.getByPlaceholder("至少 12 位").fill("owner-password-123");
    await page.getByRole("button", { name: "登录" }).click();

    await expect(page).toHaveURL(`${origin}/canvas/projects`);
    await expect(page.getByTestId("workspace-page")).toBeVisible();
    await expect(page.getByTestId("project-card-default")).toBeVisible();
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("admin bootstrap, account control and per-user data isolation are enforced", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-auth-"));
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
    expect(adminCookie).toContain("unboundry_session=");

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

test("admin can delete accounts with owned data and cannot delete the current admin", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-auth-delete-"));
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
    const adminId = (
      (await (await request("/api/auth/status", { cookie: adminCookie })).json())
        .user as { id: string }
    ).id;

    expect(
      (
        await request("/api/canvas/shared", {
          body: JSON.stringify({
            edges: [],
            nodes: [{ id: "admin-keep-node" }],
            revision: 0,
            viewport: { x: 0, y: 0, zoom: 1 },
          }),
          cookie: adminCookie,
          method: "PUT",
        })
      ).status,
    ).toBe(200);

    const created = await request("/api/admin/users", {
      body: JSON.stringify({
        displayName: "To Delete",
        loginName: "todelete",
        password: "todelete-pass-123",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(created.status).toBe(201);
    const ordinaryId = ((await created.json()).user as { id: string }).id;

    const login = await request("/api/auth/login", {
      body: JSON.stringify({
        loginName: "todelete",
        password: "todelete-pass-123",
      }),
      method: "POST",
    });
    expect(login.status).toBe(200);
    const userCookie = cookie(login);

    expect(
      (
        await request("/api/canvas/shared", {
          body: JSON.stringify({
            edges: [],
            nodes: [{ id: "delete-me-node" }],
            revision: 0,
            viewport: { x: 0, y: 0, zoom: 1 },
          }),
          cookie: userCookie,
          method: "PUT",
        })
      ).status,
    ).toBe(200);

    const listBefore = await (
      await request("/api/admin/users", { cookie: adminCookie })
    ).json();
    expect(
      (listBefore.users as Array<{ id: string }>).some(
        (user) => user.id === ordinaryId,
      ),
    ).toBe(true);

    expect(
      (
        await request(`/api/admin/users/${adminId}`, {
          cookie: adminCookie,
          method: "DELETE",
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await request(`/api/admin/users/${ordinaryId}`, {
          cookie: adminCookie,
          method: "DELETE",
        })
      ).status,
    ).toBe(200);

    const listAfter = await (
      await request("/api/admin/users", { cookie: adminCookie })
    ).json();
    expect(
      (listAfter.users as Array<{ id: string }>).some(
        (user) => user.id === ordinaryId,
      ),
    ).toBe(false);

    expect(
      (
        await request("/api/auth/login", {
          body: JSON.stringify({
            loginName: "todelete",
            password: "todelete-pass-123",
          }),
          method: "POST",
        })
      ).status,
    ).toBe(401);

    const db = openAppDatabase(dataDirectory);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM canvas_documents WHERE owner_id = ?")
          .get(ordinaryId) as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM users WHERE id = ?")
          .get(ordinaryId) as { count: number }
      ).count,
    ).toBe(0);

    const secondAdminId = "22222222-2222-4222-8222-222222222222";
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      )
      VALUES (?, ?, ?, 'second-admin-hash', 'admin', 'active', ?, ?)
    `).run(secondAdminId, "secondadmin", "Second Admin", now, now);
    db.close();

    expect(
      (
        await request(`/api/admin/users/${secondAdminId}`, {
          cookie: adminCookie,
          method: "DELETE",
        })
      ).status,
    ).toBe(200);

    const adminCanvas = await (
      await request("/api/canvas/shared", { cookie: adminCookie })
    ).json();
    expect(adminCanvas.nodes).toEqual([{ id: "admin-keep-node" }]);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("ordinary accounts can save their own default canvas while cross-account project ids stay isolated", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-auth-default-"));
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
    const adminId = (
      (await (await request("/api/auth/status", { cookie: adminCookie })).json())
        .user as { id: string }
    ).id;

    // 真实库迁移后的形态：首管理员拥有 is_project=1 的 default 项目行。
    const store = openAppDatabase(dataDirectory);
    const now = Date.now();
    store
      .prepare(`
        INSERT INTO project_metadata (
          owner_id, id, title, updated_at, is_project, created_at
        )
        VALUES (?, 'default', 'Codex Sandbox', ?, 1, ?)
      `)
      .run(adminId, now, now);
    store.close();

    const created = await request("/api/admin/users", {
      body: JSON.stringify({
        displayName: "Plain",
        loginName: "plain",
        password: "plain-pass-12345",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(created.status).toBe(201);

    const login = await request("/api/auth/login", {
      body: JSON.stringify({
        loginName: "plain",
        password: "plain-pass-12345",
      }),
      method: "POST",
    });
    expect(login.status).toBe(200);
    const userCookie = cookie(login);

    const createDefault = await request("/api/canvas/default", {
      body: JSON.stringify({
        edges: [],
        nodes: [{ id: "mine-node" }],
        revision: 0,
        saveSequence: 1,
        saveSessionId: "plain-session-0001",
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      cookie: userCookie,
      method: "PUT",
    });
    expect(createDefault.status).toBe(200);

    const savedDefault = await (
      await request("/api/canvas/default", { cookie: userCookie })
    ).json();
    expect(savedDefault.nodes).toEqual([{ id: "mine-node" }]);

    const titlePut = await request("/api/project-title/default", {
      body: JSON.stringify({ title: "我的画布", updatedAt: Date.now() }),
      cookie: userCookie,
      method: "PUT",
    });
    expect(titlePut.status).toBe(200);
    const titleGet = await (
      await request("/api/project-title/default", { cookie: userCookie })
    ).json();
    expect(titleGet.title).toBe("我的画布");

    const adminProject = await request("/api/projects", {
      body: "{}",
      cookie: adminCookie,
      method: "POST",
    });
    expect(adminProject.status).toBe(201);
    const adminProjectId = ((await adminProject.json()) as { id: string }).id;

    expect(
      (
        await request(`/api/canvas/${adminProjectId}`, {
          cookie: userCookie,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/api/canvas/${adminProjectId}`, {
          body: JSON.stringify({
            edges: [],
            nodes: [],
            revision: 0,
            saveSequence: 1,
            saveSessionId: "plain-session-0001",
            viewport: { x: 0, y: 0, zoom: 1 },
          }),
          cookie: userCookie,
          method: "PUT",
        })
      ).status,
    ).toBe(409);

    const storeAfter = openAppDatabase(dataDirectory);
    expect(
      (
        storeAfter
          .prepare(
            "SELECT COUNT(*) AS count FROM canvas_documents WHERE owner_id = ? AND id = 'default'",
          )
          .get(adminId) as { count: number }
      ).count,
    ).toBe(0);
    storeAfter.close();
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("admin can disable and delete accounts whose ids are not uuid-shaped", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-auth-nonuuid-"));
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

    const store = openAppDatabase(dataDirectory);
    const now = new Date().toISOString();
    for (const [id, login] of [
      ["cua-tester", "cuatester"],
      ["legacy.admin", "legacyadmin"],
    ] as const) {
      store
        .prepare(`
          INSERT INTO users (
            id, login_name, display_name, password_hash, role, status,
            created_at, updated_at
          )
          VALUES (?, ?, ?, 'legacy-hash', 'admin', 'active', ?, ?)
        `)
        .run(id, login, id, now, now);
    }
    store.close();

    const patch = await request("/api/admin/users/cua-tester", {
      body: JSON.stringify({ status: "disabled" }),
      cookie: adminCookie,
      method: "PATCH",
    });
    expect(patch.status).toBe(200);
    const reenable = await request("/api/admin/users/cua-tester", {
      body: JSON.stringify({ status: "active" }),
      cookie: adminCookie,
      method: "PATCH",
    });
    expect(reenable.status).toBe(200);

    for (const id of ["cua-tester", "legacy.admin"]) {
      const removed = await request(
        `/api/admin/users/${encodeURIComponent(id)}`,
        { cookie: adminCookie, method: "DELETE" },
      );
      expect(removed.status).toBe(200);
    }

    const list = await (
      await request("/api/admin/users", { cookie: adminCookie })
    ).json();
    expect(
      (list.users as Array<{ id: string }>).some(
        (user) => user.id === "cua-tester" || user.id === "legacy.admin",
      ),
    ).toBe(false);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
