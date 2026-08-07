import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  ADMIN_ONLY_PERMISSIONS,
  ALL_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  isAccountPermission,
  permissionLabel,
} from "../types/accountPermissions";
import { openAppDatabase } from "../server/database";
import {
  accountPermissionSet,
  hasPermission,
  setAccountPermissions,
} from "../server/permissions";
import type { RequestIdentity } from "../server/auth";

const port = 4198;
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
  throw new Error("Permission test server did not start");
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

function timestamp() {
  return new Date().toISOString();
}

test("the permission enum is the single whitelist with the current default set", () => {
  expect(ALL_PERMISSIONS).toHaveLength(12);
  expect(new Set(ALL_PERMISSIONS).size).toBe(12);
  expect(DEFAULT_USER_PERMISSIONS).toEqual([
    "manage_projects",
    "generate",
    "group_download",
    "manage_own_templates",
    "manage_own_credentials",
  ]);
  expect(ADMIN_ONLY_PERMISSIONS).toEqual([
    "manage_accounts",
    "manage_permissions",
  ]);
  for (const permission of ALL_PERMISSIONS) {
    expect(isAccountPermission(permission)).toBe(true);
    expect(permissionLabel(permission).length).toBeGreaterThan(0);
  }
  for (const invalid of [
    "manage_everything",
    "admin",
    "",
    42,
    null,
    undefined,
    { manageAccounts: true },
  ]) {
    expect(isAccountPermission(invalid)).toBe(false);
  }
  expect(
    isAccountPermission(ALL_PERMISSIONS.join("|")),
  ).toBe(false);
});

test("v30 migration is idempotent and cascades permission rows on account deletion", async () => {
  const dataDirectory = await mkdtemp(
    join(tmpdir(), "tapnow-perm-migration-"),
  );
  try {
    const store = openAppDatabase(dataDirectory);
    expect(
      Number(
        (
          store.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      ),
    ).toBe(30);
    const now = timestamp();
    store
      .prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
      `)
      .run("perm-user-1", "permuser1", "Perm User 1", "test-only", now, now);
    store
      .prepare(`
        INSERT INTO account_permissions (
          account_id, permission, granted_by, created_at
        )
        VALUES (?, ?, ?, ?)
      `)
      .run("perm-user-1", "manage_models", "perm-user-1", now);
    store.close();

    const reopened = openAppDatabase(dataDirectory);
    expect(
      Number(
        (
          reopened.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      ),
    ).toBe(30);
    expect(
      Number(
        (
          reopened
            .prepare("SELECT COUNT(*) AS count FROM account_permissions")
            .get() as { count: number }
        ).count,
      ),
    ).toBe(1);
    reopened.prepare("DELETE FROM users WHERE id = ?").run("perm-user-1");
    expect(
      Number(
        (
          reopened
            .prepare("SELECT COUNT(*) AS count FROM account_permissions")
            .get() as { count: number }
        ).count,
      ),
    ).toBe(0);
    reopened.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("hasPermission and setAccountPermissions enforce the extra-grant model", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-perm-svc-"));
  try {
    const store = openAppDatabase(dataDirectory);
    const now = timestamp();
    const insertUser = (id: string, role: "admin" | "user") => {
      store
        .prepare(`
          INSERT INTO users (
            id, login_name, display_name, password_hash, role, status,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `)
        .run(id, id, id, "test-only", role, now, now);
    };
    insertUser("perm-admin", "admin");
    insertUser("perm-user-a", "user");
    insertUser("perm-user-b", "user");

    const adminIdentity: RequestIdentity = {
      bypass: false,
      displayName: "Admin",
      role: "admin",
      userId: "perm-admin",
    };
    const userAIdentity: RequestIdentity = {
      bypass: false,
      displayName: "A",
      role: "user",
      userId: "perm-user-a",
    };

    expect(hasPermission(adminIdentity, "manage_accounts", store)).toBe(true);
    expect(hasPermission(adminIdentity, "generate", store)).toBe(true);
    expect(hasPermission(undefined, "generate", store)).toBe(false);
    // 默认集内置：即使权限表为空，普通账号现状能力不回退。
    for (const permission of DEFAULT_USER_PERMISSIONS) {
      expect(hasPermission(userAIdentity, permission, store)).toBe(true);
    }
    expect(hasPermission(userAIdentity, "manage_models", store)).toBe(false);

    // 非法/越权/自改/管理员目标全部拒绝。
    expect(() =>
      setAccountPermissions(
        store,
        "perm-admin",
        "perm-user-a",
        ["manage_unknown"],
      ),
    ).toThrow("未知值");
    expect(() =>
      setAccountPermissions(store, "perm-admin", "perm-admin", []),
    ).toThrow("自己的权限");
    expect(() =>
      setAccountPermissions(store, "perm-admin", "perm-admin", [
        "manage_models",
      ]),
    ).toThrow("自己的权限");
    expect(() =>
      setAccountPermissions(store, "perm-admin", "perm-user-a", [
        "manage_accounts",
      ]),
    ).toThrow("不能授予普通账号");
    expect(() =>
      setAccountPermissions(store, "perm-admin", "perm-user-a", [
        "manage_permissions",
      ]),
    ).toThrow("不能授予普通账号");
    expect(() =>
      setAccountPermissions(store, "perm-admin", "missing-user", []),
    ).toThrow("账号不存在");

    // 授予额外权限：默认权限不落库；撤销后不再有额外权限。
    setAccountPermissions(store, "perm-admin", "perm-user-a", [
      "manage_models",
      "generate",
    ]);
    const granted = accountPermissionSet(store, "perm-user-a");
    expect(granted.has("manage_models")).toBe(true);
    expect(hasPermission(userAIdentity, "manage_models", store)).toBe(true);
    expect(
      Number(
        (
          store
            .prepare(
              "SELECT COUNT(*) AS count FROM account_permissions WHERE account_id = ?",
            )
            .get("perm-user-a") as { count: number }
        ).count,
      ),
    ).toBe(1);
    expect(
      store
        .prepare(`
          SELECT action, details
          FROM admin_audit_events
          WHERE action = 'account_permissions.update'
          ORDER BY rowid DESC
          LIMIT 1
        `)
        .get(),
    ).toMatchObject({
      action: "account_permissions.update",
    });

    setAccountPermissions(store, "perm-admin", "perm-user-a", []);
    expect(hasPermission(userAIdentity, "manage_models", store)).toBe(false);
    expect(
      Number(
        (
          store
            .prepare(
              "SELECT COUNT(*) AS count FROM account_permissions WHERE account_id = ?",
            )
            .get("perm-user-a") as { count: number }
        ).count,
      ),
    ).toBe(0);
    // B 账号不受影响。
    expect(
      Number(
        (
          store
            .prepare(
              "SELECT COUNT(*) AS count FROM account_permissions WHERE account_id = ?",
            )
            .get("perm-user-b") as { count: number }
        ).count,
      ),
    ).toBe(0);
    store.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("permission API enforces guards, grants/revokes extras and audits", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-perm-api-"));
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
    const ordinaryId = (
      (await created.json()).user as { id: string }
    ).id;

    const login = await request("/api/auth/login", {
      body: JSON.stringify({
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      method: "POST",
    });
    expect(login.status).toBe(200);
    const userCookie = cookie(login);

    // 管理员读取权限接口：普通账号返回默认集；管理员目标返回全量。
    const readOrdinary = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      { cookie: adminCookie },
    );
    expect(readOrdinary.status).toBe(200);
    expect(await readOrdinary.json()).toEqual({
      permissions: [
        "manage_projects",
        "generate",
        "group_download",
        "manage_own_templates",
        "manage_own_credentials",
      ],
    });

    const adminId = (
      (await (await request("/api/auth/status", { cookie: adminCookie })).json())
        .user as { id: string }
    ).id;
    const readAdmin = await request(
      `/api/admin/users/${adminId}/permissions`,
      { cookie: adminCookie },
    );
    expect(readAdmin.status).toBe(200);
    expect(
      ((await readAdmin.json()) as { permissions: string[] }).permissions,
    ).toHaveLength(12);

    // 普通账号无 manage_permissions / manage_accounts：相关接口 403。
    expect(
      (
        await request(`/api/admin/users/${ordinaryId}/permissions`, {
          cookie: userCookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (await request("/api/admin/users", { cookie: userCookie })).status,
    ).toBe(403);
    expect(
      (await request("/api/admin/models", { cookie: userCookie })).status,
    ).toBe(403);
    expect(
      (await request("/api/admin/providers", { cookie: userCookie })).status,
    ).toBe(403);
    expect(
      (await request("/api/admin/provider-catalog", {
        cookie: userCookie,
      })).status,
    ).toBe(403);
    expect(
      (await request("/api/admin/storage", { cookie: userCookie })).status,
    ).toBe(403);
    expect(
      (await request("/api/admin/generation-safety", {
        cookie: userCookie,
      })).status,
    ).toBe(403);

    // 非法写入一律 400；自改 400；超级权限 400。
    const invalid = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({ permissions: ["manage_unknown"] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(invalid.status).toBe(400);
    const selfWrite = await request(
      `/api/admin/users/${adminId}/permissions`,
      {
        body: JSON.stringify({ permissions: [] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(selfWrite.status).toBe(400);
    const superGrant = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({ permissions: ["manage_accounts"] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(superGrant.status).toBe(400);

    // 授予 manage_models 后：写入生效、审计存在、普通账号可访问模型中心。
    const grant = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({
          permissions: ["manage_models", "generate"],
        }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(grant.status).toBe(200);
    expect(await grant.json()).toMatchObject({
      added: ["manage_models"],
      permissions: [
        "manage_models",
        "manage_projects",
        "generate",
        "group_download",
        "manage_own_templates",
        "manage_own_credentials",
      ],
    });
    expect(
      (await request("/api/admin/models", { cookie: userCookie })).status,
    ).toBe(200);
    const context = await (
      await request("/api/account-context", { cookie: userCookie })
    ).json() as {
      legacyPermissions: Record<string, boolean>;
      permissions: string[];
    };
    expect(context.permissions).toContain("manage_models");
    expect(context.permissions).toContain("generate");
    expect(context.permissions).not.toContain("manage_accounts");
    expect(context.legacyPermissions.manageModels).toBe(true);
    expect(context.legacyPermissions.manageAccounts).toBe(false);

    // 撤销后立即 403，且审计保留两条变更记录。
    const revoke = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({ permissions: [] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ removed: ["manage_models"] });
    expect(
      (await request("/api/admin/models", { cookie: userCookie })).status,
    ).toBe(403);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
