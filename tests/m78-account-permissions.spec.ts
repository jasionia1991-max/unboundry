import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import {
  ADMIN_ONLY_PERMISSIONS,
  ALL_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  isAccountPermission,
  permissionLabel,
} from "../types/accountPermissions";
import { currentSchemaVersion, openAppDatabase } from "../server/database";
import {
  AccountPermissionMutationBlockedError,
  accountExtraPermissionsFromWriteInput,
  accountPermissionSet,
  accountPermissionSnapshot,
  hasPermission,
  setAccountExtraPermissions,
  setAccountPermissions,
} from "../server/permissions";
import type { RequestIdentity } from "../server/auth";

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
    join(tmpdir(), "unboundry-perm-migration-"),
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
    ).toBe(currentSchemaVersion);
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
    ).toBe(currentSchemaVersion);
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
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-perm-svc-"));
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
    expect(accountPermissionSnapshot(store, "perm-user-a")).toEqual({
      defaultPermissions: [...DEFAULT_USER_PERMISSIONS],
      effectivePermissions: [...DEFAULT_USER_PERMISSIONS],
      extraPermissions: [],
      permissions: [...DEFAULT_USER_PERMISSIONS],
    });
    expect(accountPermissionSnapshot(store, "perm-admin")).toEqual({
      defaultPermissions: [...ALL_PERMISSIONS],
      effectivePermissions: [...ALL_PERMISSIONS],
      extraPermissions: [],
      permissions: [...ALL_PERMISSIONS],
    });
    expect(accountExtraPermissionsFromWriteInput({
      extraPermissions: ["manage_storage", "manage_models"],
    })).toEqual(["manage_models", "manage_storage"]);
    expect(accountExtraPermissionsFromWriteInput({
      permissions: ["manage_models", "generate"],
    })).toEqual(["manage_models"]);
    expect(() => accountExtraPermissionsFromWriteInput({
      extraPermissions: ["generate"],
    })).toThrow("默认权限");
    expect(() => accountExtraPermissionsFromWriteInput({
      extraPermissions: [],
      permissions: [],
    })).toThrow("不能同时提交");

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
    setAccountExtraPermissions(store, "perm-admin", "perm-user-a", [
      "manage_models",
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
    expect(accountPermissionSnapshot(store, "perm-user-a")).toEqual({
      defaultPermissions: [...DEFAULT_USER_PERMISSIONS],
      effectivePermissions: [
        "manage_models",
        ...DEFAULT_USER_PERMISSIONS,
      ],
      extraPermissions: ["manage_models"],
      permissions: ["manage_models", ...DEFAULT_USER_PERMISSIONS],
    });

    // Disabled targets remain administratively editable; deletion intent wins.
    store.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .run("perm-user-a");
    expect(
      setAccountExtraPermissions(store, "perm-admin", "perm-user-a", [
        "manage_models",
        "manage_storage",
      ]),
    ).toEqual({ added: ["manage_storage"], removed: [] });
    expect(
      setAccountExtraPermissions(store, "perm-admin", "perm-user-a", [
        "manage_models",
      ]),
    ).toEqual({ added: [], removed: ["manage_storage"] });

    const auditCountBeforeDeleteIntent = Number((store.prepare(`
      SELECT COUNT(*) AS count
      FROM admin_audit_events
      WHERE action = 'account_permissions.update'
    `).get() as { count: number }).count);
    store.prepare(`
      INSERT INTO account_delete_intents (
        owner_id, state, error_code, retry_count, created_at, updated_at
      ) VALUES (?, 'running', NULL, 0, ?, ?)
    `).run("perm-user-a", now, now);
    let targetDeleteError: unknown;
    try {
      setAccountExtraPermissions(store, "perm-admin", "perm-user-a", [
        "manage_storage",
      ]);
    } catch (error) {
      targetDeleteError = error;
    }
    expect(targetDeleteError).toBeInstanceOf(
      AccountPermissionMutationBlockedError,
    );
    expect(targetDeleteError).toMatchObject({ code: "ACCOUNT_DELETE_ACTIVE" });
    expect(accountPermissionSnapshot(store, "perm-user-a").extraPermissions)
      .toEqual(["manage_models"]);
    store.prepare("DELETE FROM account_delete_intents WHERE owner_id = ?")
      .run("perm-user-a");
    store.prepare(`
      INSERT INTO account_delete_intents (
        owner_id, state, error_code, retry_count, created_at, updated_at
      ) VALUES (?, 'failed', 'TEST', 1, ?, ?)
    `).run("perm-admin", now, now);
    let actorDeleteError: unknown;
    try {
      setAccountExtraPermissions(store, "perm-admin", "perm-user-a", []);
    } catch (error) {
      actorDeleteError = error;
    }
    expect(actorDeleteError).toMatchObject({ code: "ACCOUNT_DELETE_ACTIVE" });
    store.prepare("DELETE FROM account_delete_intents WHERE owner_id = ?")
      .run("perm-admin");
    expect(Number((store.prepare(`
      SELECT COUNT(*) AS count
      FROM admin_audit_events
      WHERE action = 'account_permissions.update'
    `).get() as { count: number }).count)).toBe(auditCountBeforeDeleteIntent);

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
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-perm-api-"));
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
      defaultPermissions: [...DEFAULT_USER_PERMISSIONS],
      effectivePermissions: [...DEFAULT_USER_PERMISSIONS],
      extraPermissions: [],
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
    expect(await readAdmin.json()).toMatchObject({
      defaultPermissions: [...ALL_PERMISSIONS],
      effectivePermissions: [...ALL_PERMISSIONS],
      extraPermissions: [],
      permissions: [...ALL_PERMISSIONS],
    });

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
        body: JSON.stringify({ extraPermissions: ["manage_unknown"] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(invalid.status).toBe(400);
    const selfWrite = await request(
      `/api/admin/users/${adminId}/permissions`,
      {
        body: JSON.stringify({ extraPermissions: [] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(selfWrite.status).toBe(400);
    const superGrant = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({ extraPermissions: ["manage_accounts"] }),
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
          extraPermissions: ["manage_models"],
        }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(grant.status).toBe(200);
    expect(await grant.json()).toMatchObject({
      added: ["manage_models"],
      defaultPermissions: [...DEFAULT_USER_PERMISSIONS],
      effectivePermissions: [
        "manage_models",
        ...DEFAULT_USER_PERMISSIONS,
      ],
      extraPermissions: ["manage_models"],
      permissions: [
        "manage_models",
        "manage_projects",
        "generate",
        "group_download",
        "manage_own_templates",
        "manage_own_credentials",
      ],
    });
    const legacyNoop = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({
          permissions: ["manage_models", ...DEFAULT_USER_PERMISSIONS],
        }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(legacyNoop.status).toBe(200);
    expect(await legacyNoop.json()).toMatchObject({
      added: [],
      extraPermissions: ["manage_models"],
      removed: [],
    });
    const ambiguous = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({ extraPermissions: [], permissions: [] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(ambiguous.status).toBe(400);
    const intentStore = openAppDatabase(dataDirectory);
    try {
      const now = timestamp();
      intentStore.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
        .run(ordinaryId);
    } finally {
      intentStore.close();
    }
    const disabledGrant = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({
          extraPermissions: ["manage_models", "manage_storage"],
        }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(disabledGrant.status).toBe(200);
    expect(await disabledGrant.json()).toMatchObject({
      added: ["manage_storage"],
      extraPermissions: ["manage_models", "manage_storage"],
      removed: [],
    });
    const disabledRevoke = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({ extraPermissions: ["manage_models"] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(disabledRevoke.status).toBe(200);
    expect(await disabledRevoke.json()).toMatchObject({
      added: [],
      extraPermissions: ["manage_models"],
      removed: ["manage_storage"],
    });
    const deleteIntentStore = openAppDatabase(dataDirectory);
    try {
      const now = timestamp();
      deleteIntentStore.prepare(`
        INSERT INTO account_delete_intents (
          owner_id, state, error_code, retry_count, created_at, updated_at
        ) VALUES (?, 'running', NULL, 0, ?, ?)
      `).run(ordinaryId, now, now);
    } finally {
      deleteIntentStore.close();
    }
    const blockedByDeleteIntent = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({ extraPermissions: ["manage_storage"] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(blockedByDeleteIntent.status).toBe(409);
    expect(await blockedByDeleteIntent.json()).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    const intentCleanup = openAppDatabase(dataDirectory);
    try {
      intentCleanup.prepare(
        "DELETE FROM account_delete_intents WHERE owner_id = ?",
      ).run(ordinaryId);
      intentCleanup.prepare("UPDATE users SET status = 'active' WHERE id = ?")
        .run(ordinaryId);
      expect(accountPermissionSnapshot(intentCleanup, ordinaryId).extraPermissions)
        .toEqual(["manage_models"]);
    } finally {
      intentCleanup.close();
    }
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
        body: JSON.stringify({ extraPermissions: [] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({
      effectivePermissions: [...DEFAULT_USER_PERMISSIONS],
      extraPermissions: [],
      removed: ["manage_models"],
    });
    expect(
      (await request("/api/admin/models", { cookie: userCookie })).status,
    ).toBe(403);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("admin account page edits permissions with compact checkboxes and persistence", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-perm-ui-"));
  let server: ChildProcess | undefined;
  let releasePermissionSave = () => {};
  try {
    server = await startServer(dataDirectory);
    const bootstrap = await page.request.post("/api/auth/bootstrap", {
      data: {
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      },
    });
    expect(bootstrap.status()).toBe(201);
    const created = await page.request.post("/api/admin/users", {
      data: {
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    expect(created.status()).toBe(201);
    const ordinaryId = (
      (await created.json()).user as { id: string }
    ).id;
    const seeded = await page.request.put(
      `/api/admin/users/${ordinaryId}/permissions`,
      { data: { extraPermissions: ["manage_models"] } },
    );
    expect(seeded.status()).toBe(200);
    const permissionWrites: unknown[] = [];
    let signalPermissionSaveStarted = () => {};
    const permissionSaveStarted = new Promise<void>((resolve) => {
      signalPermissionSaveStarted = resolve;
    });
    const permissionSaveReleased = new Promise<void>((resolve) => {
      releasePermissionSave = resolve;
    });
    await page.route(
      `**/api/admin/users/${ordinaryId}/permissions`,
      async (route) => {
        if (route.request().method() === "PUT") {
          signalPermissionSaveStarted();
          await permissionSaveReleased;
        }
        await route.continue();
      },
    );
    page.on("request", (browserRequest) => {
      if (
        browserRequest.method() === "PUT" &&
        browserRequest.url().endsWith(`/api/admin/users/${ordinaryId}/permissions`)
      ) {
        permissionWrites.push(browserRequest.postDataJSON());
      }
    });

    await page.goto("/admin/accounts");
    const section = page.getByTestId(`permissions-${ordinaryId}`);
    await expect(section).toBeVisible();
    const checkboxes = section.getByRole("checkbox");
    await expect(checkboxes).toHaveCount(12);
    for (const checkbox of await checkboxes.all()) {
      expect(await checkbox.getAttribute("class")).toContain(
        "admin-compact-checkbox",
      );
    }
    await expect(
      section.getByRole("checkbox", { name: /账号管理/ }),
    ).toBeDisabled();
    await expect(
      section.getByRole("checkbox", { name: /权限管理/ }),
    ).toBeDisabled();
    await expect(
      section.getByRole("checkbox", { name: /发起生成/ }),
    ).toBeDisabled();
    await expect(
      section.getByRole("checkbox", { name: /发起生成/ }),
    ).toBeChecked();
    await expect(
      section.getByRole("checkbox", { name: /模型中心/ }),
    ).toBeChecked();
    await expect(
      section.getByRole("button", { name: "保存权限" }),
    ).toBeDisabled();
    expect(permissionWrites).toEqual([]);

    await section.getByRole("checkbox", { name: /生成安全/ }).check();
    await expect(section.getByText("有未保存的修改")).toBeVisible();
    await section.getByRole("checkbox", { name: /生成安全/ }).uncheck();
    await expect(section.getByText("有未保存的修改")).toHaveCount(0);
    await expect(
      section.getByRole("button", { name: "保存权限" }),
    ).toBeDisabled();
    expect(permissionWrites).toEqual([]);
    await section.getByRole("checkbox", { name: /生成安全/ }).check();
    const generationSafety = section.getByRole("checkbox", { name: /生成安全/ });
    await section.getByRole("button", { name: "保存权限" }).click();
    await permissionSaveStarted;
    await expect(generationSafety).toBeDisabled();
    await expect(
      section.getByRole("button", { name: "保存中…" }),
    ).toBeDisabled();
    await generationSafety.evaluate((checkbox: HTMLInputElement) => {
      checkbox.click();
    });
    await expect(generationSafety).toBeChecked();
    releasePermissionSave();
    await expect(section.getByText("有未保存的修改")).toHaveCount(0);
    expect(permissionWrites).toEqual([{
      extraPermissions: ["manage_models", "manage_generation_safety"],
    }]);

    await page.reload();
    const reloaded = page.getByTestId(`permissions-${ordinaryId}`);
    await expect(
      reloaded.getByRole("checkbox", { name: /模型中心/ }),
    ).toBeChecked();
    await expect(
      reloaded.getByRole("checkbox", { name: /生成安全/ }),
    ).toBeChecked();
    await expect(
      reloaded.getByRole("checkbox", { name: /发起生成/ }),
    ).toBeChecked();

    const read = await page.request.get(
      `/api/admin/users/${ordinaryId}/permissions`,
    );
    expect(
      ((await read.json()) as { extraPermissions: string[] }).extraPermissions,
    ).toEqual(["manage_models", "manage_generation_safety"]);
  } finally {
    releasePermissionSave();
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("permission load failure is fail-closed and never submits an empty grant set", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-perm-ui-load-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    expect((await page.request.post("/api/auth/bootstrap", {
      data: {
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      },
    })).status()).toBe(201);
    const created = await page.request.post("/api/admin/users", {
      data: {
        displayName: "Load failure user",
        loginName: "load-failure-user",
        password: "load-failure-password-123",
      },
    });
    expect(created.status()).toBe(201);
    const ordinaryId = (
      (await created.json()).user as { id: string }
    ).id;
    expect((await page.request.put(
      `/api/admin/users/${ordinaryId}/permissions`,
      { data: { extraPermissions: ["manage_models"] } },
    )).status()).toBe(200);

    let permissionWrites = 0;
    const permissionRoute =
      `**/api/admin/users/${ordinaryId}/permissions`;
    await page.route(permissionRoute, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          body: JSON.stringify({ error: "deterministic permission read failure" }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
      if (route.request().method() === "PUT") permissionWrites += 1;
      await route.continue();
    });

    await page.goto("/admin/accounts");
    const section = page.getByTestId(`permissions-${ordinaryId}`);
    await expect(section.getByTestId(`permissions-load-${ordinaryId}`))
      .toContainText("权限读取失败");
    const save = section.getByRole("button", { name: "保存权限" });
    await expect(save).toBeDisabled();
    await save.evaluate((button: HTMLButtonElement) => button.click());
    expect(permissionWrites).toBe(0);

    const store = openAppDatabase(dataDirectory);
    try {
      expect(store.prepare(`
        SELECT permission
        FROM account_permissions
        WHERE account_id = ?
        ORDER BY permission
      `).all(ordinaryId)).toEqual([{ permission: "manage_models" }]);
    } finally {
      store.close();
    }

    await page.unroute(permissionRoute);
    await section.getByRole("button", { name: "重试读取" }).click();
    await expect(
      section.getByRole("checkbox", { name: /模型中心/ }),
    ).toBeChecked();
    await expect(save).toBeDisabled();
    expect(permissionWrites).toBe(0);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("ordinary accounts see only granted entries and direct admin routes redirect without permission", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-perm-route-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const bootstrap = await page.request.post("/api/auth/bootstrap", {
      data: {
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      },
    });
    expect(bootstrap.status()).toBe(201);
    const created = await page.request.post("/api/admin/users", {
      data: {
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    expect(created.status()).toBe(201);
    const ordinaryId = (
      (await created.json()).user as { id: string }
    ).id;

    await page.request.post("/api/auth/logout");
    await page.request.post("/api/auth/login", {
      data: {
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    await page.addInitScript(() => {
      const key = "m78-unauthorized-admin-rendered";
      if (sessionStorage.getItem(key) === null) {
        sessionStorage.setItem(key, "false");
      }
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="admin-models-page"]')) {
          sessionStorage.setItem(key, "true");
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto("/admin/models");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("admin-models-page")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("m78-unauthorized-admin-rendered")
      ),
    ).toBe("false");
    const redirectedUrl = page.url();
    expect(
      await page.evaluate(() =>
        new Promise<string>((resolve) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(window.location.href))
          );
        })
      ),
    ).toBe(redirectedUrl);
    await page.goto("/canvas");
    await page.getByTestId("user-avatar").click();
    const popover = page.getByTestId("account-popover");
    await expect(popover.getByRole("button", { name: "我的连接" })).toBeVisible();
    await expect(
      popover.getByRole("button", { name: "模型中心" }),
    ).toHaveCount(0);
    await expect(
      popover.getByRole("button", { name: "账号管理" }),
    ).toHaveCount(0);

    await page.request.post("/api/auth/logout");
    await page.request.post("/api/auth/login", {
      data: {
        loginName: "owner",
        password: "owner-password-123",
      },
    });
    const grant = await page.request.put(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        data: { permissions: ["manage_models"] },
      },
    );
    expect(grant.status()).toBe(200);
    await page.request.post("/api/auth/logout");
    await page.request.post("/api/auth/login", {
      data: {
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    await page.goto("/admin/models");
    await expect(page).toHaveURL(/\/admin\/models$/);
    await expect(page.getByTestId("admin-models-page")).toBeVisible();
    await page.goto("/canvas");
    await page.getByTestId("user-avatar").click();
    await expect(
      popover.getByRole("button", { name: "模型中心" }),
    ).toBeVisible();
    await expect(
      popover.getByRole("button", { name: "账号管理" }),
    ).toHaveCount(0);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("deleting an account removes its permission rows and keeps audit history", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-perm-delete-"));
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

    const grant = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({ permissions: ["manage_models"] }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(grant.status).toBe(200);

    const beforeDelete = openAppDatabase(dataDirectory);
    try {
      const audits = beforeDelete
        .prepare(`
          SELECT action
          FROM admin_audit_events
          WHERE target_user_id = ?
          ORDER BY rowid
        `)
        .all(ordinaryId) as Array<{ action: string }>;
      expect(audits.map((row) => row.action)).toEqual([
        "create_user",
        "account_permissions.update",
      ]);
    } finally {
      beforeDelete.close();
    }

    const deleted = await request(`/api/admin/users/${ordinaryId}`, {
      cookie: adminCookie,
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(
      (await request(`/api/admin/users/${ordinaryId}/permissions`, {
        cookie: adminCookie,
      })).status,
    ).toBe(404);

    const store = openAppDatabase(dataDirectory);
    try {
      expect(
        Number(
          (
            store
              .prepare(
                "SELECT COUNT(*) AS count FROM account_permissions WHERE account_id = ?",
              )
              .get(ordinaryId) as { count: number }
          ).count,
        ),
      ).toBe(0);
      // 同一最终事务清空历史审计并写入唯一 delete_user，任一步失败都回滚。
      const auditAfter = store
        .prepare(`
          SELECT action
          FROM admin_audit_events
          WHERE target_user_id = ?
          ORDER BY rowid
        `)
        .all(ordinaryId) as Array<{ action: string }>;
      expect(auditAfter.map((row) => row.action)).toEqual(["delete_user"]);
    } finally {
      store.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
