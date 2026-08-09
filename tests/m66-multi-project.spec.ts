import { expect, test, type APIRequestContext } from "./safe-test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "../server/database";
import { hasOtherOwnerProject } from "../server/canvasPersistence";
import { deleteProjectRows, projectCover } from "../server/projects";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type CanvasBaseline = {
  loadToken: string;
  revision: number;
};

async function clearProjects(request: APIRequestContext) {
  const response = await request.get("/api/projects");
  if (!response.ok()) return;
  const body = (await response.json()) as {
    projects: Array<{ id: string }>;
  };
  for (const project of body.projects) {
    if (project.id !== "default") {
      await request.delete(`/api/projects/${project.id}`);
    }
  }
}

test.describe("multi-project API", () => {
  test("create with default title, list filters non-projects, rename and canvas saves bump recency", async ({
    request,
  }) => {
    const legacy = await request.put("/api/project-title/legacy.workspace-row", {
      data: { title: "legacy", updatedAt: 1 },
    });
    expect(legacy.ok()).toBeTruthy();

    const created = await request.post("/api/projects", { data: {} });
    expect(created.status()).toBe(201);
    const project = (await created.json()) as {
      createdAt: number;
      id: string;
      title: string;
      updatedAt: number;
    };
    expect(project.title).toBe("未命名项目");
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(project.createdAt).toBeGreaterThan(0);
    expect(project.updatedAt).toBeGreaterThan(0);

    const listed = await request.get("/api/projects");
    expect(listed.ok()).toBeTruthy();
    const list = (await listed.json()) as {
      projects: Array<{ id: string; title: string }>;
    };
    expect(list.projects.some((item) => item.id === project.id)).toBeTruthy();
    expect(
      list.projects.some((item) => item.id === "legacy.workspace-row"),
    ).toBeFalsy();

    const renamed = await request.put(
      `/api/project-title/${project.id}`,
      { data: { title: "项目甲", updatedAt: Date.now() } },
    );
    expect(renamed.ok()).toBeTruthy();
    const renamedList = (await (await request.get("/api/projects")).json()) as {
      projects: Array<{ id: string; title: string; updatedAt: number }>;
    };
    const renamedProject = renamedList.projects.find(
      (item) => item.id === project.id,
    )!;
    expect(renamedProject.title).toBe("项目甲");
    const beforeSave = renamedProject.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const baselineResponse = await request.get(`/api/canvas/${project.id}`);
    expect(baselineResponse.ok()).toBeTruthy();
    const baseline = await baselineResponse.json() as CanvasBaseline;
    const saved = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: [],
        nodes: [],
        observedLoadToken: baseline.loadToken,
        observedRevision: baseline.revision,
        revision: baseline.revision,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    const afterSaveList = (await (await request.get("/api/projects")).json()) as {
      projects: Array<{ id: string; updatedAt: number }>;
    };
    const afterSave = afterSaveList.projects.find(
      (item) => item.id === project.id,
    )!;
    expect(afterSave.updatedAt).toBeGreaterThan(beforeSave);
  });

  test("delete tombstones, removes canvas and blocks resurrection", async ({
    request,
  }) => {
    const created = await request.post("/api/projects", { data: {} });
    expect(created.status()).toBe(201);
    const project = (await created.json()) as { id: string };

    const removed = await request.delete(`/api/projects/${project.id}`);
    expect(removed.status()).toBe(204);

    const list = (await (await request.get("/api/projects")).json()) as {
      projects: Array<{ id: string }>;
    };
    expect(list.projects.some((item) => item.id === project.id)).toBeFalsy();

    const canvasRead = await request.get(`/api/canvas/${project.id}`);
    expect(canvasRead.status()).toBe(404);

    const canvasWrite = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: [],
        nodes: [],
        revision: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(canvasWrite.status()).toBe(409);

    const titleWrite = await request.put(`/api/project-title/${project.id}`, {
      data: { title: "复活", updatedAt: Date.now() },
    });
    expect(titleWrite.status()).toBe(409);

    const defaultDelete = await request.delete("/api/projects/default");
    expect(defaultDelete.status()).toBe(409);
  });

  test("project deletion keeps account media readable", async ({ request }) => {
    const assetId = "project-media-retained";
    const uploaded = await request.post(`/api/assets/${assetId}`, {
      data: onePixelPng,
      headers: { "Content-Type": "image/png" },
    });
    expect(uploaded.status()).toBe(201);

    const created = await request.post("/api/projects", { data: {} });
    expect(created.status()).toBe(201);
    const project = (await created.json()) as { id: string };

    const baselineResponse = await request.get(`/api/canvas/${project.id}`);
    expect(baselineResponse.ok()).toBeTruthy();
    const baseline = await baselineResponse.json() as CanvasBaseline;
    const saved = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: [],
        nodes: [
          {
            data: { assetId, title: "封面图" },
            id: "cover-node",
            position: { x: 0, y: 0 },
            type: "image",
          },
        ],
        observedLoadToken: baseline.loadToken,
        observedRevision: baseline.revision,
        revision: baseline.revision,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    const list = (await (await request.get("/api/projects")).json()) as {
      projects: Array<{
        cover: { assetId: string | null; kind: "image" | "video" | null };
        id: string;
      }>;
    };
    const cover = list.projects.find((item) => item.id === project.id)?.cover;
    expect(cover).toEqual({ assetId, kind: "image" });

    expect((await request.delete(`/api/projects/${project.id}`)).status())
      .toBe(204);

    const assetRead = await request.get(`/api/assets/${assetId}`);
    expect([200, 307]).toContain(assetRead.status());
  });

  test("clone copies the canvas into a new titled project", async ({
    page,
    request,
  }) => {
    const created = await request.post("/api/projects", {
      data: { title: "源项目" },
    });
    expect(created.status()).toBe(201);
    const source = (await created.json()) as { id: string; title: string };
    expect(source.title).toBe("源项目");

    const baselineResponse = await request.get(`/api/canvas/${source.id}`);
    expect(baselineResponse.ok()).toBeTruthy();
    const baseline = await baselineResponse.json() as CanvasBaseline;
    const saved = await request.put(`/api/canvas/${source.id}`, {
      data: {
        edges: [],
        nodes: [
          {
            data: { label: "Text", title: "文字" },
            id: "clone-text",
            position: { x: 80, y: 100 },
            type: "text",
          },
        ],
        observedLoadToken: baseline.loadToken,
        observedRevision: baseline.revision,
        revision: baseline.revision,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    const cloned = await request.post(`/api/projects/${source.id}/clone`);
    expect(cloned.status()).toBe(201);
    const copy = (await cloned.json()) as { id: string; title: string };
    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe("源项目 副本");

    const canvas = await request.get(`/api/canvas/${copy.id}`);
    expect(canvas.ok()).toBeTruthy();
    const document = (await canvas.json()) as {
      nodes: Array<{ id: string; type: string }>;
    };
    expect(document.nodes).toEqual([
      expect.objectContaining({ id: "clone-text", type: "text" }),
    ]);

    await page.goto("/canvas/projects");
    await page.getByTestId(`project-card-${source.id}`).hover();
    await page.getByTestId(`project-menu-${source.id}`).click();
    await page
      .getByTestId(`project-menu-pop-${source.id}`)
      .getByRole("button", { name: "克隆" })
      .click();
    await expect(page.getByTestId(`project-card-${copy.id}`)).toBeVisible();
  });
});

test.describe("multi-project routing", () => {
  test("project canvas loads under /canvas/<id> and workspace route renders", async ({
    page,
    request,
  }) => {
    const created = await request.post("/api/projects", { data: {} });
    expect(created.status()).toBe(201);
    const project = (await created.json()) as { id: string };

    await page.goto(`/canvas/${project.id}`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await expect(page.getByLabel("项目名称")).toHaveValue("未命名项目");

    await page.goto("/canvas/projects");
    await expect(page.getByTestId("workspace-page")).toBeVisible();
  });
});

test.describe("workspace page", () => {
  test("workspace pins the default canvas card and it cannot be deleted", async ({
    page,
  }) => {
    await page.goto("/canvas/projects");
    await expect(page.getByTestId("workspace-page")).toBeVisible();
    const defaultCard = page.getByTestId("project-card-default");
    await expect(defaultCard).toBeVisible();
    await page.getByTestId("project-menu-default").click({ force: true });
    await expect(page.getByTestId("project-menu-pop-default")).toBeVisible();
    await expect(
      page.getByTestId("project-menu-pop-default").getByRole("button", {
        name: "删除",
      }),
    ).toHaveCount(0);
  });

  test("creates, searches, renames and deletes projects", async ({
    page,
    request,
  }) => {
    await clearProjects(request);
    const first = (await (await request.post("/api/projects", { data: {} }))
      .json()) as { id: string };
    const second = (await (await request.post("/api/projects", { data: {} }))
      .json()) as { id: string };
    await request.put(`/api/project-title/${second.id}`, {
      data: { title: "项目B", updatedAt: Date.now() },
    });

    await page.goto("/canvas/projects");
    await expect(page.getByTestId("workspace-page")).toBeVisible();
    await expect(page.getByTestId(`project-card-${first.id}`)).toBeVisible();
    await expect(page.getByTestId(`project-card-${second.id}`)).toBeVisible();

    await page.getByTestId("workspace-search").fill("项目B");
    await expect(page.getByTestId(`project-card-${second.id}`)).toBeVisible();
    await expect(page.getByTestId(`project-card-${first.id}`)).toHaveCount(0);
    await page.getByTestId("workspace-search").fill("");

    await expect(page.getByTestId(`project-menu-${second.id}`))
      .toHaveCSS("opacity", "0");
    await page.getByTestId(`project-card-${second.id}`).hover();
    await expect(page.getByTestId(`project-menu-${second.id}`))
      .toHaveCSS("opacity", "1");
    await page.getByTestId(`project-menu-${second.id}`).click();
    await page
      .getByTestId(`project-menu-pop-${second.id}`)
      .getByText("重命名")
      .click();
    await page.getByTestId("workspace-rename-input").fill("项目B2");
    await page.getByTestId("workspace-rename-input").press("Enter");
    await expect(page.getByText("项目B2", { exact: true })).toBeVisible();

    await page.getByTestId(`project-card-${second.id}`).hover();
    await page.getByTestId(`project-menu-${second.id}`).click();
    await page
      .getByTestId(`project-menu-pop-${second.id}`)
      .getByText("删除")
      .click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await page
      .getByTestId("confirm-dialog")
      .getByRole("button", { name: "删除" })
      .click();
    await expect(page.getByTestId(`project-card-${second.id}`)).toHaveCount(0);

    await request.delete(`/api/projects/${first.id}`);
  });

  test("grid/list toggle and sorting follow selection", async ({
    page,
    request,
  }) => {
    await clearProjects(request);
    const older = (await (await request.post("/api/projects", { data: {} }))
      .json()) as { id: string };
    const newer = (await (await request.post("/api/projects", { data: {} }))
      .json()) as { id: string };
    await request.put(`/api/project-title/${older.id}`, {
      data: { title: "旧", updatedAt: Date.now() },
    });
    await request.put(`/api/project-title/${newer.id}`, {
      data: { title: "新", updatedAt: Date.now() + 5_000 },
    });

    await page.goto("/canvas/projects");
    await expect(page.getByTestId("workspace-grid")).toBeVisible();
    await page
      .getByTestId("workspace-view")
      .getByRole("radio", { name: "列表" })
      .click();
    await expect(page.getByTestId("workspace-list")).toBeVisible();
    const rows = page.locator(".workspace-list-row");
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId("workspace-list")).toContainText("默认画布");
    let order = await rows.evaluateAll((elements) =>
      elements.map((element) => element.textContent ?? ""),
    );
    expect(order.findIndex((text) => text.includes("新"))).toBeLessThan(
      order.findIndex((text) => text.includes("旧")),
    );

    await page.getByTestId("workspace-sort").click();
    await page
      .getByTestId("workspace-sort")
      .getByRole("option", { name: "按创建时间 · 最早优先" })
      .click();
    order = await rows.evaluateAll((elements) =>
      elements.map((element) => element.textContent ?? ""),
    );
    expect(order.findIndex((text) => text.includes("旧"))).toBeLessThan(
      order.findIndex((text) => text.includes("新")),
    );

    await request.delete(`/api/projects/${older.id}`);
    await request.delete(`/api/projects/${newer.id}`);
  });
});

test("canvas project menu creates, returns to workspace and deletes", async ({
  page,
  request,
}) => {
  await clearProjects(request);
  const created = (await (await request.post("/api/projects", { data: {} }))
    .json()) as { id: string };
  await page.goto(`/canvas/${created.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );

  await page.getByTestId("logo-button").click();
  await page.getByTestId("project-menu").getByText("新建项目").click();
  await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]{36}$/);
  const newId = page.url().split("/").pop()!;
  await expect(page.getByLabel("项目名称")).toHaveValue("未命名项目");

  await page.getByTestId("logo-button").click();
  await page.getByTestId("project-menu").getByText("返回工作空间").click();
  await expect(page).toHaveURL(/\/canvas\/projects\?from=/);

  await page.goto(`/canvas/${newId}`);
  await page.getByTestId("logo-button").click();
  await page.getByTestId("project-menu").getByText("删除").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page
    .getByTestId("confirm-dialog")
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page).toHaveURL(/\/canvas\/projects$/);

  const list = (await (await request.get("/api/projects")).json()) as {
    projects: Array<{ id: string }>;
  };
  expect(list.projects.some((project) => project.id === newId)).toBeFalsy();
  await request.delete(`/api/projects/${created.id}`);
});

test("workspace back returns to the originating project, not the default canvas", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };

  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.getByTestId("logo-button").click();
  await page.getByTestId("project-menu").getByText("返回工作空间").click();
  await expect(page).toHaveURL(/\/canvas\/projects\?from=/);

  await page.getByTestId("workspace-back").click();
  await expect(page).toHaveURL(new RegExp(`/canvas/${project.id}$`));
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );

  await request.delete(`/api/projects/${project.id}`);
});

test("workspace entry points are visible from the default canvas and workspace returns to canvas", async ({
  page,
}) => {
  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );

  await page.getByTestId("logo-button").click();
  await page.getByTestId("project-menu").getByText("工作空间").click();
  await expect(page).toHaveURL(/\/canvas\/projects$/);
  await expect(page.getByTestId("workspace-page")).toBeVisible();

  await page.getByTestId("workspace-back").click();
  await expect(page).toHaveURL(/\/canvas$/);
  await expect(page.getByTestId("canvas-shell")).toBeVisible();

  await page.getByTestId("user-avatar").click();
  await expect(page.getByTestId("account-popover")).toBeVisible();
  await page.getByTestId("account-popover").getByText("工作空间").click();
  await expect(page).toHaveURL(/\/canvas\/projects$/);
  await expect(page.getByTestId("workspace-page")).toBeVisible();
});

test("selection mode selects cards, shows bottom bar and deletes selected", async ({
  page,
  request,
}) => {
  await clearProjects(request);
  const first = (await (await request.post("/api/projects", { data: {} }))
    .json()) as { id: string };
  const second = (await (await request.post("/api/projects", { data: {} }))
    .json()) as { id: string };
  await request.put(`/api/project-title/${first.id}`, {
    data: { title: "甲", updatedAt: Date.now() },
  });
  await request.put(`/api/project-title/${second.id}`, {
    data: { title: "乙", updatedAt: Date.now() + 5_000 },
  });

  await page.goto("/canvas/projects");
  await page.getByTestId(`project-card-${first.id}`).hover();
  await page.getByTestId(`project-menu-${first.id}`).click();
  await page
    .getByTestId(`project-menu-pop-${first.id}`)
    .getByText("选择")
    .click();
  await expect(page.getByTestId("workspace-selection-bar")).toBeVisible();
  await expect(page.getByTestId("workspace-selection-count")).toHaveText(
    "已选择 1 个画布",
  );
  await expect(page.getByTestId(`workspace-select-${first.id}`))
    .toHaveAttribute("data-checked", "true");

  await page.getByTestId(`workspace-select-${second.id}`).click();
  await expect(page.getByTestId("workspace-selection-count")).toHaveText(
    "已选择 2 个画布",
  );

  await page.getByTestId("workspace-selection-close").click();
  await expect(page.getByTestId("workspace-selection-bar")).toHaveCount(0);

  await page.getByTestId(`project-card-${first.id}`).hover();
  await page.getByTestId(`project-menu-${first.id}`).click();
  await page
    .getByTestId(`project-menu-pop-${first.id}`)
    .getByText("选择")
    .click();
  await page.getByTestId(`workspace-select-${second.id}`).click();
  await expect(page.getByTestId("workspace-selection-count")).toHaveText(
    "已选择 2 个画布",
  );

  await page.getByTestId(`project-card-${first.id}`).click();
  await expect(page.getByTestId("workspace-selection-count")).toHaveText(
    "已选择 1 个画布",
  );

  await page.getByTestId("workspace-selection-delete").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page
    .getByTestId("confirm-dialog")
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page.getByTestId(`project-card-${second.id}`)).toHaveCount(0);
  await expect(page.getByTestId("workspace-selection-bar")).toHaveCount(0);

  await request.delete(`/api/projects/${first.id}`);
});

test("cover priority and delete rows are enforced at the store level", () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-projects-unit-"));
  try {
    const db = openAppDatabase(directory);
    const ownerId = "u1";
    const projectId = "p1";
    db.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      )
      VALUES (?, 'u1', 'U1', 'x', 'user', 'active', ?, ?)
    `).run(ownerId, new Date().toISOString(), new Date().toISOString());
    const now = Date.now();
    db.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at
      )
      VALUES (?, ?, '项目', ?, 1, ?)
    `).run(ownerId, projectId, now, now);
    const row = db.prepare(`
      SELECT id, title, created_at, updated_at
      FROM project_metadata WHERE owner_id = ? AND id = ?
    `).get(ownerId, projectId) as {
      created_at: number;
      id: string;
      title: string;
      updated_at: number;
    };

    db.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_sequence
      )
      VALUES (?, ?, 1, 1, '[]', '[]', ?, ?, 0)
    `).run(
      ownerId,
      projectId,
      JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      new Date(now).toISOString(),
    );
    expect(projectCover(db, row, ownerId)).toEqual({
      assetId: null,
      kind: null,
    });

    db.prepare(`
      UPDATE canvas_documents
      SET nodes = ?
      WHERE owner_id = ? AND id = ?
    `).run(
      JSON.stringify([
        {
          data: { assetId: "node-asset", title: "素材" },
          id: "n1",
          position: { x: 0, y: 0 },
          type: "image",
        },
      ]),
      ownerId,
      projectId,
    );
    expect(projectCover(db, row, ownerId)).toEqual({
      assetId: "node-asset",
      kind: "image",
    });

    db.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
        request_fingerprint, state, attempt, created_at, updated_at, owner_id,
        result_asset_id
      )
      VALUES (?, ?, 'n1', 'video', 'p', '{}', 'ik1', 'fp1', 'success', 1, ?, ?, ?, 'result-video')
    `).run(
      "task-1",
      projectId,
      new Date(now).toISOString(),
      new Date(now + 10_000).toISOString(),
      ownerId,
    );
    expect(projectCover(db, row, ownerId)).toEqual({
      assetId: "result-video",
      kind: "video",
    });

    db.prepare(`
      INSERT INTO generation_task_events (task_id, state, created_at)
      VALUES ('task-1', 'success', ?)
    `).run(new Date(now + 10_000).toISOString());
    db.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, created_at
      )
      VALUES ('task-1', 1, 'profile', 'model', 'video', 'provider-boundary', ?)
    `).run(new Date(now + 10_000).toISOString());

    deleteProjectRows(db, ownerId, projectId, now + 20_000, false);
    const tombstone = db.prepare(`
      SELECT is_project, deleted_at FROM project_metadata
      WHERE owner_id = ? AND id = ?
    `).get(ownerId, projectId) as {
      deleted_at: number;
      is_project: number;
    };
    expect(tombstone.is_project).toBe(0);
    expect(tombstone.deleted_at).toBe(now + 20_000);
    expect(
      db.prepare(
        "SELECT 1 FROM canvas_documents WHERE owner_id = ? AND id = ?",
      ).get(ownerId, projectId),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT 1 FROM generation_tasks WHERE id = 'task-1'").get(),
    ).toBeUndefined();
    expect(
      db.prepare(
        "SELECT 1 FROM generation_task_events WHERE task_id = 'task-1'",
      ).get(),
    ).toBeUndefined();
    expect(
      db.prepare(
        "SELECT 1 FROM generation_provider_attempts WHERE task_id = 'task-1'",
      ).get(),
    ).toBeUndefined();
    db.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("project ids are owner-isolated for canvas and title writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-owner-isolation-"));
  try {
    const db = openAppDatabase(directory);
    const now = new Date().toISOString();
    for (const [id, login] of [
      ["u1", "u1"],
      ["u2", "u2"],
    ] as const) {
      db.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES (?, ?, ?, 'x', 'user', 'active', ?, ?)
      `).run(id, login, login, now, now);
    }
    db.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at
      )
      VALUES ('u1', 'p1', 'P1', 1, 1, 1)
    `).run();
    expect(hasOtherOwnerProject(db, false, "u2", "p1")).toBe(true);
    expect(hasOtherOwnerProject(db, false, "u1", "p1")).toBe(false);
    expect(hasOtherOwnerProject(db, true, "u2", "p1")).toBe(false);
    expect(hasOtherOwnerProject(db, false, "u2", "not-a-project")).toBe(false);
    db.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
