import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { currentSchemaVersion, openAppDatabase } from "../server/database";
import {
  archivePublicTemplate,
  deletePublicTemplate,
  restorePublicTemplate,
  savePublicTemplate,
  updatePublicTemplate,
} from "../server/adminTemplates";
import {
  listPublicTemplates,
} from "../server/templateCatalog";

const port = 4191;
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
  throw new Error("Public template test server did not start");
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

function uploadPlaceholderGraph() {
  return {
    edges: [
      {
        id: "pub-edge-1",
        source: "pub-text",
        sourceHandle: "source",
        target: "pub-image",
        targetHandle: "target",
        type: "cuttable",
      },
    ],
    nodes: [
      {
        data: { label: "Group", title: "公共模板组" },
        id: "pub-group",
        position: { x: 0, y: 0 },
        style: { height: 348, width: 548 },
        type: "group",
        zIndex: 0,
      },
      {
        data: { label: "Text", title: "说明", textPrompt: "上传位说明" },
        id: "pub-text",
        parentId: "pub-group",
        position: { x: 20, y: 20 },
        style: { height: 250, width: 250 },
        type: "text",
        zIndex: 1,
      },
      {
        data: { label: "Image", title: "上传位图片" },
        id: "pub-image",
        parentId: "pub-group",
        position: { x: 300, y: 20 },
        style: { height: 250, width: 250 },
        type: "image",
        zIndex: 1,
      },
    ],
    version: 1,
  };
}

test("v31 migration creates public_templates with the two real seeds idempotently", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-public-mig-"));
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
    const rows = store
      .prepare(`
        SELECT
          id, title, description, category, graph, preview_image, status
        FROM public_templates
        ORDER BY rowid
      `)
      .all() as Array<{
      category: string;
      description: string;
      graph: string;
      id: string;
      preview_image: string;
      status: string;
      title: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual([
      "published",
      "published",
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "0786e042-095e-4551-b91b-365492e91241",
      "aaf7cc53-a595-45da-a6bb-7c93309e0962",
    ]);
    for (const row of rows) {
      expect(JSON.parse(row.category)).toEqual(["电商"]);
      expect(row.preview_image).toMatch(/^\/templates\/.+\.png$/);
      expect(row.description.length).toBeGreaterThan(0);
      const graph = JSON.parse(row.graph) as {
        nodes: Array<{ type: string }>;
      };
      expect(
        graph.nodes.filter((node) => node.type === "group"),
      ).toHaveLength(1);
    }
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
            .prepare("SELECT COUNT(*) AS count FROM public_templates")
            .get() as { count: number }
        ).count,
      ),
    ).toBe(2);
    reopened.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("public template storage enforces validation, status transitions and seed protection", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-public-store-"));
  try {
    const store = openAppDatabase(dataDirectory);
    const now = timestamp();
    store
      .prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)
      `)
      .run("pub-admin", "pubadmin", "Pub Admin", "test-only", now, now);

    expect(() =>
      savePublicTemplate(store, "pub-admin", {
        graph: uploadPlaceholderGraph(),
        title: "",
      }),
    ).toThrow("标题");
    expect(() =>
      savePublicTemplate(store, "pub-admin", {
        category: ["最近使用"],
        graph: uploadPlaceholderGraph(),
        title: "非法分类",
      }),
    ).toThrow("分类");
    expect(() =>
      savePublicTemplate(store, "pub-admin", {
        graph: { nodes: [{ id: "x" }], edges: [], version: 1 },
        title: "非法图",
      }),
    ).toThrow("图结构");

    const created = savePublicTemplate(store, "pub-admin", {
      category: ["电商", "广告"],
      description: "上传位模板说明",
      graph: uploadPlaceholderGraph(),
      previewImage: "/templates/custom.png",
      title: "上传位公共模板",
    });
    expect(created.status).toBe("draft");
    expect(created.created_by).toBe("pub-admin");
    expect(created.preview_image).toBe("/templates/custom.png");

    const drafts = listPublicTemplates(store, {
      category: "全部",
      includeGraph: false,
      limit: 20,
      offset: 0,
      query: "",
      status: "draft",
    });
    expect(drafts.total).toBe(1);
    const published = listPublicTemplates(store, {
      category: "全部",
      includeGraph: false,
      limit: 20,
      offset: 0,
      query: "",
      status: "published",
    });
    expect(published.total).toBe(2);
    const ecommerceOnly = listPublicTemplates(store, {
      category: "电商",
      includeGraph: false,
      limit: 20,
      offset: 0,
      query: "",
      status: "",
    });
    expect(ecommerceOnly.total).toBe(3);

    const updated = updatePublicTemplate(store, "pub-admin", created.id, {
      status: "published",
      title: "已发布的上传位模板",
    });
    expect(updated.status).toBe("published");
    expect(updated.title).toBe("已发布的上传位模板");

    const archived = archivePublicTemplate(store, "pub-admin", created.id);
    expect(archived.status).toBe("archived");
    expect(archived.archived_at).not.toBeNull();
    const restored = restorePublicTemplate(store, "pub-admin", created.id);
    expect(restored.status).toBe("published");
    expect(restored.archived_at).toBeNull();

    expect(deletePublicTemplate(store, "pub-admin", created.id)).toBe(true);
    expect(
      store
        .prepare("SELECT COUNT(*) AS count FROM public_templates WHERE id = ?")
        .get(created.id) as { count: number },
    ).toMatchObject({ count: 0 });

    const seed = store
      .prepare("SELECT id FROM public_templates LIMIT 1")
      .get() as { id: string };
    expect(() =>
      deletePublicTemplate(store, "pub-admin", seed.id),
    ).toThrow("种子模板不可物理删除");

    const audits = store
      .prepare(`
        SELECT action
        FROM admin_audit_events
        WHERE actor_user_id = ?
        ORDER BY rowid
      `)
      .all("pub-admin") as Array<{ action: string }>;
    expect(audits.map((row) => row.action)).toEqual([
      "public_template.create",
      "public_template.update",
      "public_template.archive",
      "public_template.restore",
      "public_template.delete",
    ]);
    store.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("admin CRUD API, ordinary 403 and the public GET keep the seed contract", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-public-api-"));
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

    const createdUser = await request("/api/admin/users", {
      body: JSON.stringify({
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(createdUser.status).toBe(201);
    const ordinaryId = (
      (await createdUser.json()).user as { id: string }
    ).id;
    const login = await request("/api/auth/login", {
      body: JSON.stringify({
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      method: "POST",
    });
    const userCookie = cookie(login);

    // 公共 GET 结构不变：两条种子，分类/封面/描述/图结构与改造前一致。
    const publicList = await request(
      "/api/templates?space=public&limit=20&offset=0&includeGraph=true",
      { cookie: adminCookie },
    );
    expect(publicList.status).toBe(200);
    const catalog = (await publicList.json()) as {
      categories: string[];
      items: Array<{
        categories: string[];
        description: string;
        graph?: {
          edges: unknown[];
          nodes: Array<{ type: string }>;
          version: 1;
        };
        id: string;
        previewImage: string;
        title: string;
      }>;
      pagination: { hasMore: boolean; total: number };
    };
    expect(catalog.categories).toContain("电商");
    expect(catalog.pagination).toMatchObject({ total: 2, hasMore: false });
    const detail = catalog.items.find(
      (item) => item.id === "0786e042-095e-4551-b91b-365492e91241",
    )!;
    expect(detail.graph?.nodes).toHaveLength(12);
    expect(detail.graph?.edges).toHaveLength(29);
    expect(
      detail.graph?.nodes.filter((node) => node.type === "group"),
    ).toHaveLength(1);
    const expert = catalog.items.find(
      (item) => item.id === "aaf7cc53-a595-45da-a6bb-7c93309e0962",
    )!;
    expect(expert.graph?.nodes).toHaveLength(14);
    expect(expert.graph?.edges).toHaveLength(12);
    for (const item of catalog.items) {
      expect(item.categories).toEqual(["电商"]);
      expect(item.previewImage).toMatch(/^\/templates\/.+\.png$/);
      expect(typeof item.description).toBe("string");
    }

    // 普通账号无 manage_public_templates：管理接口全部 403。
    for (const [method, path, body] of [
      ["GET", "/api/admin/templates", undefined],
      [
        "POST",
        "/api/admin/templates",
        { graph: uploadPlaceholderGraph(), title: "越权模板" },
      ],
      [
        "PATCH",
        "/api/admin/templates/0786e042-095e-4551-b91b-365492e91241",
        { title: "越权改名" },
      ],
      [
        "DELETE",
        "/api/admin/templates/0786e042-095e-4551-b91b-365492e91241",
        undefined,
      ],
    ] as const) {
      const response = await request(path, {
        body: body ? JSON.stringify(body) : undefined,
        cookie: userCookie,
        method,
      });
      expect(response.status).toBe(403);
    }

    // 管理员 CRUD：draft → published → archived → 恢复。
    const created = await request("/api/admin/templates", {
      body: JSON.stringify({
        category: ["工具"],
        description: "管理员新建模板",
        graph: uploadPlaceholderGraph(),
        previewImage: "/templates/custom.png",
        title: "管理员新建模板",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(created.status).toBe(201);
    const templateId = (
      (await created.json()) as {
        template: { id: string };
      }
    ).template.id;

    const adminDrafts = await request(
      "/api/admin/templates?status=draft",
      { cookie: adminCookie },
    );
    expect(
      (
        (await adminDrafts.json()) as {
          items: Array<{ id: string }>;
        }
      ).items.map((item) => item.id),
    ).toContain(templateId);

    const publish = await request(
      `/api/admin/templates/${templateId}`,
      {
        body: JSON.stringify({ status: "published" }),
        cookie: adminCookie,
        method: "PATCH",
      },
    );
    expect(publish.status).toBe(200);
    const visible = await request(
      "/api/templates?space=public&q=管理员新建模板",
      { cookie: adminCookie },
    );
    expect(
      ((await visible.json()) as { items: Array<{ id: string }> }).items,
    ).toHaveLength(1);

    const archived = await request(
      `/api/admin/templates/${templateId}`,
      { cookie: adminCookie, method: "DELETE" },
    );
    expect(archived.status).toBe(200);
    const hidden = await request(
      "/api/templates?space=public&q=管理员新建模板",
      { cookie: adminCookie },
    );
    expect(
      ((await hidden.json()) as { items: Array<{ id: string }> }).items,
    ).toHaveLength(0);

    const restored = await request(
      `/api/admin/templates/${templateId}`,
      {
        body: JSON.stringify({ status: "published" }),
        cookie: adminCookie,
        method: "PATCH",
      },
    );
    expect(restored.status).toBe(200);
    const visibleAgain = await request(
      "/api/templates?space=public&q=管理员新建模板",
      { cookie: adminCookie },
    );
    expect(
      ((await visibleAgain.json()) as { items: Array<{ id: string }> }).items,
    ).toHaveLength(1);

    expect(
      (
        await request(`/api/admin/templates/not-a-uuid`, {
          cookie: adminCookie,
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/admin/templates/${templateId}`,
          { cookie: adminCookie, method: "PATCH" },
        )
      ).status,
    ).toBe(400);

    // 授予 manage_public_templates 后普通账号可访问管理接口（权限矩阵正例）。
    const grant = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({
          permissions: ["manage_public_templates"],
        }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(grant.status).toBe(200);
    expect(
      (await request("/api/admin/templates", { cookie: userCookie })).status,
    ).toBe(200);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("a published upload-placeholder template imports for an ordinary account with preview cover", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-public-ui-"));
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
    const createdUser = await page.request.post("/api/admin/users", {
      data: {
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    expect(createdUser.status()).toBe(201);

    const template = await page.request.post("/api/admin/templates", {
      data: {
        category: ["工具"],
        description: "上传位公共模板",
        graph: uploadPlaceholderGraph(),
        previewImage: "/templates/ecommerce-detail-workflow.png",
        status: "published",
        title: "上传位公共模板",
      },
    });
    expect(template.status()).toBe(201);

    await page.request.post("/api/auth/logout");
    const login = await page.request.post("/api/auth/login", {
      data: {
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    expect(login.status()).toBe(200);
    const project = (
      (await (await page.request.post("/api/projects", { data: {} })).json()) as {
        id: string;
      }
    );
    await page.goto(`/canvas/${project.id}`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );

    await page.getByTestId("templates").click();
    const panel = page.getByTestId("templates-panel");
    await expect(panel).toBeVisible();
    const card = panel
      .locator(".template-card")
      .filter({ hasText: "上传位公共模板" });
    await expect(card).toBeVisible();
    await expect(card.locator(".template-card-art img")).toHaveAttribute(
      "src",
      "/templates/ecommerce-detail-workflow.png",
    );
    await card.click();

    await expect(page.locator(".react-flow__node-group")).toHaveCount(1);
    await expect(page.locator(".react-flow__node-text")).toHaveCount(1);
    await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await expect(page.locator(".react-flow__node-group")).toHaveCount(1);
    await expect(page.locator(".react-flow__node-text")).toHaveCount(1);
    await expect(page.locator(".react-flow__node-image")).toHaveCount(1);

    await page.request.delete(`/api/canvas/${project.id}`);
    await page.request.delete(`/api/projects/${project.id}`);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("admin templates page creates, edits, archives and restores public templates", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-public-adminui-"));
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

    await page.goto("/admin/templates");
    await expect(page.getByTestId("admin-templates-page")).toBeVisible();
    await expect(
      page.getByTestId("admin-templates-list"),
    ).toContainText("电商详情页工作流");
    await expect(
      page.getByTestId("admin-templates-list"),
    ).toContainText("213.电商图片生成专家");

    await page.getByRole("button", { name: "新建公共模板" }).click();
    const modal = page.getByTestId("admin-template-modal");
    await expect(modal).toBeVisible();
    await modal.getByLabel(/模板标题/).fill("UI 新建模板");
    await modal.getByLabel(/说明/).fill("通过管理页创建");
    await modal.getByRole("checkbox", { name: "工具" }).check();
    await modal.getByLabel(/状态/).selectOption("published");
    await modal
      .getByLabel(/模板图 JSON/)
      .fill(JSON.stringify(uploadPlaceholderGraph()));
    await modal.getByRole("button", { name: "保存" }).click();
    await expect(modal).toHaveCount(0);
    const createdCard = page
      .locator(".admin-template-card")
      .filter({ hasText: "UI 新建模板" });
    await expect(createdCard).toBeVisible();
    await expect(createdCard.locator("[data-status='published']")).toBeVisible();
    const publicList = await page.request.get(
      "/api/templates?space=public&q=UI 新建模板",
    );
    expect(
      ((await publicList.json()) as { items: Array<{ id: string }> }).items,
    ).toHaveLength(1);

    await createdCard.getByRole("button", { name: "编辑" }).click();
    await expect(modal).toBeVisible();
    await modal.getByLabel(/模板标题/).fill("UI 编辑后");
    await modal.getByRole("button", { name: "保存" }).click();
    await expect(
      page
        .locator(".admin-template-card")
        .filter({ hasText: "UI 编辑后" }),
    ).toBeVisible();

    await page
      .locator(".admin-template-card")
      .filter({ hasText: "UI 编辑后" })
      .getByRole("button", { name: "归档" })
      .click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await page.getByTestId("confirm-dialog").getByRole("button", {
      name: "归档",
    }).click();
    await expect(
      page
        .locator(".admin-template-card")
        .filter({ hasText: "UI 编辑后" })
        .locator("[data-status='archived']"),
    ).toBeVisible();
    const hiddenAfterArchive = await page.request.get(
      "/api/templates?space=public&q=UI 编辑后",
    );
    expect(
      (
        (await hiddenAfterArchive.json()) as {
          items: Array<{ id: string }>;
        }
      ).items,
    ).toHaveLength(0);

    await page
      .locator(".admin-template-card")
      .filter({ hasText: "UI 编辑后" })
      .getByRole("button", { name: "恢复" })
      .click();
    await expect(
      page
        .locator(".admin-template-card")
        .filter({ hasText: "UI 编辑后" })
        .locator("[data-status='published']"),
    ).toBeVisible();
    const visibleAfterRestore = await page.request.get(
      "/api/templates?space=public&q=UI 编辑后",
    );
    expect(
      (
        (await visibleAfterRestore.json()) as {
          items: Array<{ id: string }>;
        }
      ).items,
    ).toHaveLength(1);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("browse-all admin entry follows permissions and recent-used filters by account with silent skips", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tapnow-public-recent-"));
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
    await page.request.post("/api/admin/users", {
      data: {
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });

    for (const title of ["最近使用A", "最近使用B"]) {
      const created = await page.request.post("/api/admin/templates", {
        data: {
          category: ["工具"],
          graph: uploadPlaceholderGraph(),
          status: "published",
          title,
        },
      });
      expect(created.status()).toBe(201);
    }

    // 管理员：浏览全部侧栏显示管理入口。
    await page.goto("/");
    await page.getByTestId("templates").click();
    await page.getByRole("button", { name: "浏览全部" }).click();
    await expect(page.getByTestId("admin-templates-entry")).toBeVisible();
    await page.getByRole("button", { name: "关闭全部模板" }).click();

    // 普通账号：无管理入口。
    await page.request.post("/api/auth/logout");
    await page.request.post("/api/auth/login", {
      data: {
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    await page.goto("/");
    await page.getByTestId("templates").click();
    await page.getByRole("button", { name: "浏览全部" }).click();
    await expect(page.getByTestId("admin-templates-entry")).toHaveCount(0);

    // 先导入 A，再导入 B；「最近使用」应倒序显示 B、A。
    const browser = page.getByTestId("template-browser");
    await browser
      .locator(".template-browser-card")
      .filter({ hasText: "最近使用A" })
      .click();
    await expect(browser).toHaveCount(0);
    await page.getByTestId("templates").click();
    await page.getByRole("button", { name: "浏览全部" }).click();
    await browser
      .locator(".template-browser-card")
      .filter({ hasText: "最近使用B" })
      .click();
    await expect(browser).toHaveCount(0);

    await page.getByTestId("templates").click();
    await page.getByRole("button", { name: "浏览全部" }).click();
    await browser
      .getByRole("button", { name: "最近使用", exact: true })
      .click();
    // 等待过滤请求生效：种子模板不再出现在「最近使用」里。
    await expect(
      browser
        .locator(".template-browser-card")
        .filter({ hasText: "电商详情页工作流" }),
    ).toHaveCount(0);
    const recentTitles = await browser
      .locator(".template-browser-card p")
      .allTextContents();
    expect(recentTitles.map((title) => title.trim())).toEqual([
      "最近使用B",
      "最近使用A",
    ]);

    // 管理员归档 A 后，普通账号「最近使用」静默跳过失效模板。
    await page.request.post("/api/auth/logout");
    await page.request.post("/api/auth/login", {
      data: {
        loginName: "owner",
        password: "owner-password-123",
      },
    });
    const adminList = await (
      await page.request.get("/api/admin/templates?q=最近使用A")
    ).json() as { items: Array<{ id: string }> };
    const archive = await page.request.delete(
      `/api/admin/templates/${adminList.items[0].id}`,
    );
    expect(archive.status()).toBe(200);
    await page.request.post("/api/auth/logout");
    await page.request.post("/api/auth/login", {
      data: {
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    await page.reload();
    await page.getByTestId("templates").click();
    await page.getByRole("button", { name: "浏览全部" }).click();
    await browser
      .getByRole("button", { name: "最近使用", exact: true })
      .click();
    await expect(
      browser
        .locator(".template-browser-card")
        .filter({ hasText: "电商详情页工作流" }),
    ).toHaveCount(0);
    await expect(
      browser.locator(".template-browser-card").filter({ hasText: "最近使用A" }),
    ).toHaveCount(0);
    await expect(
      browser.locator(".template-browser-card").filter({ hasText: "最近使用B" }),
    ).toBeVisible();
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
