import { expect, test, type APIRequestContext } from "./safe-test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "../server/database";
import { hasOtherOwnerProject } from "../server/canvasPersistence";
import { deleteProjectRows, projectCover } from "../server/projects";
import {
  parseSourceProjectId,
  safeProjectId,
  withCanvasSource,
} from "../client/src/navigation/canvasReturn";

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

  test("project title rejects stale and same-revision divergent writes", async ({
    request,
  }) => {
    const created = await request.post("/api/projects", { data: {} });
    expect(created.status()).toBe(201);
    const project = (await created.json()) as {
      id: string;
      updatedAt: number;
    };
    const updatedAt = Math.max(Date.now(), project.updatedAt + 1);

    const saved = await request.put(`/api/project-title/${project.id}`, {
      data: { title: "权威标题", updatedAt },
    });
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toEqual({ title: "权威标题", updatedAt });

    const stale = await request.put(`/api/project-title/${project.id}`, {
      data: { title: "旧标题", updatedAt: updatedAt - 1 },
    });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toEqual({
      current: { title: "权威标题", updatedAt },
      error: "项目名称已在其他页面更新，请确认后重试",
    });

    const divergent = await request.put(`/api/project-title/${project.id}`, {
      data: { title: "同 revision 的其他标题", updatedAt },
    });
    expect(divergent.status()).toBe(409);
    const idempotent = await request.put(`/api/project-title/${project.id}`, {
      data: { title: "权威标题", updatedAt },
    });
    expect(idempotent.status()).toBe(200);
    expect(await idempotent.json()).toEqual({ title: "权威标题", updatedAt });

    expect((await request.delete(`/api/projects/${project.id}`)).status())
      .toBe(204);
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
      .json()) as { id: string; updatedAt: number };
    const renamed = await request.put(`/api/project-title/${second.id}`, {
      data: { title: "项目B", updatedAt: second.updatedAt + 1 },
    });
    expect(renamed.status()).toBe(200);

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

  test("create is single-flight and remains retryable after a failed response", async ({
    page,
  }) => {
    await page.goto("/canvas/projects");
    let calls = 0;
    let releaseHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      calls += 1;
      if (calls === 1) {
        await held;
        await route.fulfill({
          json: { error: "held failure" },
          status: 503,
        });
        return;
      }
      await route.abort("failed");
    });

    const create = page.getByTestId("workspace-new");
    await create.evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect.poll(() => calls).toBe(1);
    await expect(create).toBeDisabled();
    releaseHeld();
    await expect(create).toBeEnabled();
    await expect(page.getByRole("alert")).toContainText("新建项目失败");
    await expect(page).toHaveURL(/\/canvas\/projects$/);

    await create.click();
    await expect.poll(() => calls).toBe(2);
    await expect(create).toBeEnabled();
    await expect(page.getByRole("alert")).toContainText("新建项目失败");
    await expect(page).toHaveURL(/\/canvas\/projects$/);
  });

  test("rename retains its draft across network, HTTP and stale failures", async ({
    page,
    request,
  }) => {
    const created = await request.post("/api/projects", {
      data: { title: "待重命名" },
    });
    expect(created.status()).toBe(201);
    const project = (await created.json()) as { id: string };
    await page.goto("/canvas/projects");

    let calls = 0;
    let releaseHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    await page.route(`**/api/project-title/${project.id}`, async (route) => {
      calls += 1;
      const payload = route.request().postDataJSON() as {
        title: string;
        updatedAt: number;
      };
      if (calls === 1) {
        await held;
        await route.fulfill({ json: { error: "held" }, status: 503 });
        return;
      }
      if (calls === 2) {
        await route.abort("failed");
        return;
      }
      if (calls === 3) {
        await route.fulfill({ json: { error: "invalid" }, status: 422 });
        return;
      }
      if (calls === 4) {
        await route.fulfill({
          json: {
            title: "其他页面标题",
            updatedAt: payload.updatedAt + 1,
          },
          status: 200,
        });
        return;
      }
      await route.fulfill({ json: payload, status: 200 });
    });

    await page.getByTestId(`project-card-${project.id}`).hover();
    await page.getByTestId(`project-menu-${project.id}`).click();
    await page
      .getByTestId(`project-menu-pop-${project.id}`)
      .getByText("重命名")
      .click();
    const input = page.getByTestId("workspace-rename-input");
    await input.fill("必须保留的草稿");
    await input.press("Enter");
    await input.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      (element as HTMLInputElement).blur();
    });
    await expect.poll(() => calls).toBe(1);
    await expect(input).toBeDisabled();
    releaseHeld();
    await expect(input).toBeEnabled();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("必须保留的草稿");
    await expect(page.getByRole("alert")).toContainText("503");

    await input.press("Enter");
    await expect.poll(() => calls).toBe(2);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue("必须保留的草稿");
    await expect(page.getByRole("alert")).toContainText("重命名项目失败");

    await input.press("Enter");
    await expect.poll(() => calls).toBe(3);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue("必须保留的草稿");
    await expect(page.getByRole("alert")).toContainText("422");

    await input.press("Enter");
    await expect.poll(() => calls).toBe(4);
    await expect(input).toBeEnabled();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("必须保留的草稿");
    await expect(page.getByRole("alert")).toContainText("其他页面更新");

    await input.press("Enter");
    await expect.poll(() => calls).toBe(5);
    await expect(input).toHaveCount(0);
    await expect(page.getByText("必须保留的草稿", { exact: true }))
      .toBeVisible();

    await request.delete(`/api/projects/${project.id}`);
  });

  test("single delete is single-flight and retains confirmation across held and failed outcomes", async ({
    page,
    request,
  }) => {
    const created = await request.post("/api/projects", {
      data: { title: "删除失败时保留" },
    });
    expect(created.status()).toBe(201);
    const project = (await created.json()) as { id: string };
    let deleteCalls = 0;
    let releaseHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    await page.route(`**/api/projects/${project.id}`, async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.continue();
        return;
      }
      deleteCalls += 1;
      if (deleteCalls === 1) {
        await held;
        await route.fulfill({ json: { error: "held conflict" }, status: 409 });
        return;
      }
      if (deleteCalls === 2) {
        await route.fulfill({ json: { deleted: true }, status: 200 });
        return;
      }
      if (deleteCalls === 3) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/canvas/projects");
    await page.getByTestId(`project-card-${project.id}`).hover();
    await page.getByTestId(`project-menu-${project.id}`).click();
    const menuDelete = page
      .getByTestId(`project-menu-pop-${project.id}`)
      .getByText("删除", { exact: true });
    await menuDelete.click();
    const dialog = page.getByTestId("confirm-dialog");
    const confirm = dialog.getByRole("button", { name: "删除", exact: true });
    await confirm.evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect.poll(() => deleteCalls).toBe(1);
    await expect(dialog.getByRole("button", { name: "正在删除…" }))
      .toBeVisible();
    releaseHeld();
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("服务器返回 409");
    await expect(page.getByTestId(`project-card-${project.id}`)).toBeVisible();

    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(menuDelete).toBeFocused();
    await menuDelete.click();

    await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => deleteCalls).toBe(2);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("无效删除响应");

    await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => deleteCalls).toBe(3);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("删除项目失败");
    await expect(page.getByTestId(`project-card-${project.id}`)).toBeVisible();

    await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => deleteCalls).toBe(4);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId(`project-card-${project.id}`)).toHaveCount(0);
  });

  test("batch delete is serial and preserves failed and unprocessed selection after a partial network failure", async ({
    page,
    request,
  }) => {
    await clearProjects(request);
    const ids: string[] = [];
    for (const title of ["批量甲", "批量乙", "批量丙"]) {
      const created = await request.post("/api/projects", { data: { title } });
      expect(created.status()).toBe(201);
      ids.push(((await created.json()) as { id: string }).id);
    }
    const deleteOrder: string[] = [];
    await page.route("**/api/projects/*", async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.continue();
        return;
      }
      deleteOrder.push(new URL(route.request().url()).pathname.split("/").at(-1)!);
      if (deleteOrder.length === 2) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/canvas/projects");
    await page.getByTestId(`project-card-${ids[0]}`).hover();
    await page.getByTestId(`project-menu-${ids[0]}`).click();
    await page
      .getByTestId(`project-menu-pop-${ids[0]}`)
      .getByText("选择", { exact: true })
      .click();
    await page.getByTestId(`workspace-select-${ids[1]}`).click();
    await page.getByTestId(`workspace-select-${ids[2]}`).click();
    await expect(page.getByTestId("workspace-selection-count"))
      .toHaveText("已选择 3 个画布");

    await page.getByTestId("workspace-selection-delete").click();
    const dialog = page.getByTestId("confirm-dialog");
    const confirm = dialog.getByRole("button", { name: "删除", exact: true });
    await confirm.evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect.poll(() => deleteOrder.length).toBe(2);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("部分项目删除失败");
    await expect(page.getByTestId("workspace-selection-count"))
      .toHaveText("已选择 2 个画布");
    await expect(page.getByTestId(`project-card-${deleteOrder[0]}`))
      .toHaveCount(0);
    for (const id of ids.filter((candidate) => candidate !== deleteOrder[0])) {
      await expect(page.getByTestId(`project-card-${id}`)).toBeVisible();
      await expect(page.getByTestId(`workspace-select-${id}`))
        .toHaveAttribute("data-checked", "true");
    }

    await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => deleteOrder.length).toBe(4);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("workspace-selection-bar")).toHaveCount(0);
    for (const id of ids) {
      await expect(page.getByTestId(`project-card-${id}`)).toHaveCount(0);
    }
  });

  test("single delete reconciles a lost response and rejects a 204 that conflicts with the authoritative list", async ({
    page,
    request,
  }) => {
    const lost = (await (await request.post("/api/projects", {
      data: { title: "响应丢失但已删除" },
    })).json()) as { id: string };
    const conflicted = (await (await request.post("/api/projects", {
      data: { title: "204 但仍存在" },
    })).json()) as { id: string };
    const refreshFailed = (await (await request.post("/api/projects", {
      data: { title: "204 后列表失败" },
    })).json()) as { id: string };
    let lostDeleteCalls = 0;
    let conflictedDeleteCalls = 0;
    let refreshFailedDeleteCalls = 0;
    let failNextList = false;
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() === "GET" && failNextList) {
        failNextList = false;
        await route.fulfill({ json: { error: "unavailable" }, status: 503 });
        return;
      }
      await route.continue();
    });
    await page.route("**/api/projects/*", async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.continue();
        return;
      }
      const id = decodeURIComponent(
        new URL(route.request().url()).pathname.split("/").at(-1)!,
      );
      if (id === lost.id) {
        lostDeleteCalls += 1;
        const committed = await request.delete(`/api/projects/${lost.id}`);
        expect(committed.status()).toBe(204);
        await route.abort("failed");
        return;
      }
      if (id === conflicted.id) {
        conflictedDeleteCalls += 1;
        await route.fulfill({ body: "", status: 204 });
        return;
      }
      if (id === refreshFailed.id) {
        refreshFailedDeleteCalls += 1;
      }
      await route.continue();
    });

    await page.goto("/canvas/projects");
    const openDelete = async (id: string) => {
      await page.getByTestId(`project-card-${id}`).hover();
      await page.getByTestId(`project-menu-${id}`).click();
      await page
        .getByTestId(`project-menu-pop-${id}`)
        .getByText("删除", { exact: true })
        .click();
    };

    await openDelete(lost.id);
    let dialog = page.getByRole("dialog", { name: "确认删除" });
    await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => lostDeleteCalls).toBe(1);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId(`project-card-${lost.id}`)).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("已确认项目已删除");
    expect(lostDeleteCalls).toBe(1);

    await openDelete(conflicted.id);
    dialog = page.getByRole("dialog", { name: "确认删除" });
    await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => conflictedDeleteCalls).toBe(1);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "删除响应与项目列表不一致",
    );
    await expect(page.getByTestId(`project-card-${conflicted.id}`)).toBeVisible();
    expect(conflictedDeleteCalls).toBe(1);
    await dialog.getByRole("button", { name: "取消" }).click();
    await request.delete(`/api/projects/${conflicted.id}`);

    await openDelete(refreshFailed.id);
    failNextList = true;
    dialog = page.getByRole("dialog", { name: "确认删除" });
    await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => refreshFailedDeleteCalls).toBe(1);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId(`project-card-${refreshFailed.id}`))
      .toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("列表刷新失败");
    expect(refreshFailedDeleteCalls).toBe(1);
  });

  test("single delete fails closed when the authoritative project list is malformed", async ({
    page,
    request,
  }) => {
    const created = await request.post("/api/projects", {
      data: { title: "畸形列表不得确认删除" },
    });
    expect(created.status()).toBe(201);
    const project = (await created.json()) as { id: string };
    let deleteCalls = 0;
    let malformedListCalls = 0;
    let returnMalformedList = false;
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() === "GET" && returnMalformedList) {
        malformedListCalls += 1;
        await route.fulfill({
          json: {
            projects: [{
              cover: { assetId: null, kind: null },
              createdAt: 1,
              id: "invalid project id",
              title: "无效条目",
              updatedAt: 1,
            }],
          },
          status: 200,
        });
        return;
      }
      await route.continue();
    });
    await page.route(`**/api/projects/${project.id}`, async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.continue();
        return;
      }
      deleteCalls += 1;
      returnMalformedList = true;
      await route.abort("failed");
    });

    await page.goto("/canvas/projects");
    await page.evaluate((projectId) => {
      localStorage.setItem(`unboundry-project-title:${projectId}`, "keep");
    }, project.id);
    await page.getByTestId(`project-card-${project.id}`).hover();
    await page.getByTestId(`project-menu-${project.id}`).click();
    await page
      .getByTestId(`project-menu-pop-${project.id}`)
      .getByText("删除", { exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "确认删除" });
    await dialog.getByRole("button", { name: "删除", exact: true }).click();

    await expect.poll(() => deleteCalls).toBe(1);
    await expect.poll(() => malformedListCalls).toBe(1);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("项目列表确认失败");
    await expect(page.getByTestId(`project-card-${project.id}`)).toBeVisible();
    await expect.poll(() => page.evaluate((projectId) =>
      localStorage.getItem(`unboundry-project-title:${projectId}`), project.id))
      .toBe("keep");
    expect(deleteCalls).toBe(1);
    await dialog.getByRole("button", { name: "取消" }).click();
    await request.delete(`/api/projects/${project.id}`);
  });

  test("batch delete preserves every selected project when reconciliation is malformed", async ({
    page,
    request,
  }) => {
    await clearProjects(request);
    const ids: string[] = [];
    for (const title of ["批量畸形甲", "批量畸形乙"]) {
      const created = await request.post("/api/projects", { data: { title } });
      expect(created.status()).toBe(201);
      ids.push(((await created.json()) as { id: string }).id);
    }
    let deleteCalls = 0;
    let malformedListCalls = 0;
    let returnMalformedList = false;
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() === "GET" && returnMalformedList) {
        malformedListCalls += 1;
        await route.fulfill({
          json: {
            projects: [{
              cover: { assetId: null, kind: "image" },
              createdAt: 1,
              id: "malformed",
              title: "无效封面",
              updatedAt: 1,
            }],
          },
          status: 200,
        });
        return;
      }
      await route.continue();
    });
    await page.route("**/api/projects/*", async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.continue();
        return;
      }
      deleteCalls += 1;
      returnMalformedList = true;
      await route.abort("failed");
    });

    await page.goto("/canvas/projects");
    await page.evaluate((projectIds) => {
      for (const id of projectIds) {
        localStorage.setItem(`unboundry-project-title:${id}`, `keep-${id}`);
      }
    }, ids);
    await page.getByTestId(`project-card-${ids[0]}`).hover();
    await page.getByTestId(`project-menu-${ids[0]}`).click();
    await page
      .getByTestId(`project-menu-pop-${ids[0]}`)
      .getByText("选择", { exact: true })
      .click();
    await page.getByTestId(`workspace-select-${ids[1]}`).click();
    await page.getByTestId("workspace-selection-delete").click();
    const dialog = page.getByRole("dialog", { name: "确认删除" });
    await dialog.getByRole("button", { name: "删除", exact: true }).click();

    await expect.poll(() => deleteCalls).toBe(1);
    await expect.poll(() => malformedListCalls).toBe(1);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("项目列表确认失败");
    await expect(page.getByTestId("workspace-selection-count"))
      .toHaveText("已选择 2 个画布");
    for (const id of ids) {
      await expect(page.getByTestId(`project-card-${id}`)).toBeVisible();
      await expect(page.getByTestId(`workspace-select-${id}`))
        .toHaveAttribute("data-checked", "true");
      await expect.poll(() => page.evaluate((projectId) =>
        localStorage.getItem(`unboundry-project-title:${projectId}`), id))
        .toBe(`keep-${id}`);
    }
    expect(deleteCalls).toBe(1);
    await dialog.getByRole("button", { name: "取消" }).click();
    for (const id of ids) await request.delete(`/api/projects/${id}`);
  });

  test("single delete deadlines cover a hung request and a hung authoritative response body", async ({
    page,
    request,
  }) => {
    const created = await request.post("/api/projects", {
      data: { title: "删除超时保留" },
    });
    expect(created.status()).toBe(201);
    const project = (await created.json()) as { id: string };
    await page.clock.install();
    await page.addInitScript((projectId) => {
      type DeadlinePhase = "delete-fetch" | "get-body" | "pass";
      const state: {
        deleteHangs: number;
        listBodyHangs: number;
        phase: DeadlinePhase;
      } = { deleteHangs: 0, listBodyHangs: 0, phase: "delete-fetch" };
      (window as typeof window & {
        __m66DeleteDeadline?: typeof state;
      }).__m66DeleteDeadline = state;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const raw = typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
        const url = new URL(raw, window.location.href);
        const method = (init?.method ??
          (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (
          method === "DELETE" &&
          url.pathname === `/api/projects/${projectId}`
        ) {
          if (state.phase === "delete-fetch") {
            state.deleteHangs += 1;
            return new Promise<Response>(() => {
              // The deadline must not depend on fetch honoring abort.
            });
          }
          if (state.phase === "get-body") {
            throw new TypeError("lost delete response");
          }
        }
        const response = await originalFetch(input, init);
        if (
          state.phase === "get-body" &&
          method === "GET" &&
          url.pathname === "/api/projects"
        ) {
          state.listBodyHangs += 1;
          Object.defineProperty(response, "json", {
            configurable: true,
            value: () => new Promise(() => {
              // Headers arrived, but the body permanently ignores abort.
            }),
          });
        }
        return response;
      }) as typeof window.fetch;
    }, project.id);

    await page.goto("/canvas/projects");
    await page.getByTestId(`project-card-${project.id}`).hover();
    await page.getByTestId(`project-menu-${project.id}`).click();
    await page
      .getByTestId(`project-menu-pop-${project.id}`)
      .getByText("删除", { exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "确认删除" });
    await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m66DeleteDeadline?: { deleteHangs: number };
      }).__m66DeleteDeadline?.deleteHangs ?? 0)).toBe(1);
    await page.clock.fastForward(10_100);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(dialog.getByRole("button", { name: "删除", exact: true }))
      .toBeEnabled();
    await expect(page.getByRole("alert")).toContainText("删除请求超时");
    await expect(page.getByTestId(`project-card-${project.id}`)).toBeVisible();

    await page.evaluate(() => {
      const state = (window as typeof window & {
        __m66DeleteDeadline?: { phase: "get-body" | "pass" };
      }).__m66DeleteDeadline;
      if (state) state.phase = "get-body";
    });
    await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m66DeleteDeadline?: { listBodyHangs: number };
      }).__m66DeleteDeadline?.listBodyHangs ?? 0)).toBe(1);
    await page.clock.fastForward(10_100);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("alert")).toContainText(
      "项目列表确认失败",
    );
    await expect(page.getByTestId(`project-card-${project.id}`)).toBeVisible();
    await page.evaluate(() => {
      const state = (window as typeof window & {
        __m66DeleteDeadline?: { phase: "get-body" | "pass" };
      }).__m66DeleteDeadline;
      if (state) state.phase = "pass";
    });
    await dialog.getByRole("button", { name: "取消" }).click();
    await request.delete(`/api/projects/${project.id}`);
  });

  test("batch delete freezes selection and contains focus while a failed reconciliation is pending", async ({
    page,
    request,
  }) => {
    await clearProjects(request);
    const ids: string[] = [];
    for (const title of ["冻结选择甲", "冻结选择乙", "未选项目丙"]) {
      const created = await request.post("/api/projects", { data: { title } });
      expect(created.status()).toBe(201);
      ids.push(((await created.json()) as { id: string }).id);
    }
    await page.goto("/canvas/projects");
    await page.getByTestId(`project-card-${ids[0]}`).hover();
    await page.getByTestId(`project-menu-${ids[0]}`).click();
    await page
      .getByTestId(`project-menu-pop-${ids[0]}`)
      .getByText("选择", { exact: true })
      .click();
    await page.getByTestId(`workspace-select-${ids[1]}`).click();

    let deleteCalls = 0;
    let releaseDelete!: () => void;
    const heldDelete = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    await page.route("**/api/projects/*", async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.continue();
        return;
      }
      deleteCalls += 1;
      await heldDelete;
      await route.fulfill({ json: { error: "held conflict" }, status: 409 });
    });
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { error: "unavailable" }, status: 503 });
        return;
      }
      await route.continue();
    });

    await page.getByTestId("workspace-selection-delete").click();
    const dialog = page.getByRole("dialog", { name: "确认删除" });
    await expect(dialog).toHaveAccessibleDescription(
      /确定要删除选中的 2 个项目/,
    );
    await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
    const confirm = dialog.getByRole("button", { name: "删除", exact: true });
    await confirm.evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect.poll(() => deleteCalls).toBe(1);
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    await expect(dialog).toContainText("选中的 2 个项目");
    await expect(dialog.getByRole("button", { name: "正在删除…" }))
      .toBeDisabled();
    await expect(dialog.getByRole("button", { name: "取消" })).toBeDisabled();
    await expect(page.getByTestId("workspace-selection-close")).toBeDisabled();
    await expect(page.getByTestId(`workspace-select-${ids[2]}`)).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.getByTestId(`project-menu-${ids[0]}`).evaluate((element) => {
      element.focus();
    });
    await expect.poll(() => page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await page.getByTestId(`project-card-${ids[2]}`).evaluate((element) => {
      if (element instanceof HTMLElement) element.click();
    });
    await expect(page.getByTestId("workspace-selection-count"))
      .toHaveText("已选择 2 个画布");
    await expect(dialog).toContainText("选中的 2 个项目");
    expect(deleteCalls).toBe(1);

    releaseDelete();
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("alert")).toContainText(
      "项目列表确认失败",
    );
    await expect(page.getByTestId("workspace-selection-count"))
      .toHaveText("已选择 2 个画布");
    for (const id of ids) {
      await expect(page.getByTestId(`project-card-${id}`)).toBeVisible();
    }
    for (const id of ids.slice(0, 2)) {
      await expect(page.getByTestId(`workspace-select-${id}`))
        .toHaveAttribute("data-checked", "true");
    }
    await expect(page.getByTestId(`workspace-select-${ids[2]}`))
      .toHaveAttribute("data-checked", "false");
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(page.getByTestId("workspace-selection-delete")).toBeFocused();
    for (const id of ids) await request.delete(`/api/projects/${id}`);
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

test("canvas project mutations fail closed and keep the current project", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", {
    data: { title: "保留项目" },
  });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  const originalUrl = page.url();

  await page.route(`**/api/project-title/${project.id}`, async (route) => {
    const payload = route.request().postDataJSON() as {
      title: string;
      updatedAt: number;
    };
    await route.fulfill({
      json: { title: "过期响应", updatedAt: payload.updatedAt + 1 },
      status: 200,
    });
  });
  await page.getByTestId("title-input").fill("本地标题草稿");
  await expect(page.getByTestId("title-input")).toHaveValue("本地标题草稿");
  await expect(page.getByTestId("save-status")).toHaveText(
    "项目名称保存失败，请重试",
  );
  await page.unroute(`**/api/project-title/${project.id}`);

  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ json: { error: "unavailable" }, status: 503 });
      return;
    }
    await route.continue();
  });
  await page.route(`**/api/projects/${project.id}/clone`, (route) =>
    route.abort("failed"),
  );
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({ json: { error: "conflict" }, status: 409 });
      return;
    }
    await route.continue();
  });

  await page.getByTestId("logo-button").click();
  const menu = page.getByTestId("project-menu");
  await menu.getByText("新建项目", { exact: true }).click();
  await expect(page.getByTestId("project-action-error")).toContainText(
    "新建项目失败",
  );
  await expect(page).toHaveURL(originalUrl);
  await expect(menu).toBeVisible();

  await menu.getByText("克隆项目", { exact: true }).click();
  await expect(page.getByTestId("project-action-error")).toContainText(
    "克隆项目失败",
  );
  await expect(page).toHaveURL(originalUrl);
  await expect(menu).toBeVisible();

  await menu.getByText("删除", { exact: true }).click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect(page.getByTestId("project-action-error")).toContainText(
    "删除项目失败",
  );
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(originalUrl);

  const list = (await (await request.get("/api/projects")).json()) as {
    projects: Array<{ id: string }>;
  };
  expect(list.projects.some((item) => item.id === project.id)).toBeTruthy();
  await request.delete(`/api/projects/${project.id}`);
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

test("workspace entry points are visible from the default canvas and workspace does not invent a return canvas", async ({
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
  await expect(page).toHaveURL(/\/canvas\/projects$/);
  await expect(page.locator("#workspace-error")).toContainText(
    "没有可返回的真实项目画布",
  );

  await page.goto("/canvas");
  await page.getByTestId("user-avatar").click();
  await expect(page.getByTestId("account-popover")).toBeVisible();
  await page.getByTestId("account-popover").getByText("工作空间").click();
  await expect(page).toHaveURL(/\/canvas\/projects$/);
  await expect(page.getByTestId("workspace-page")).toBeVisible();
});

test("settings pages keep their source project and expose both return actions", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  const source = `from=${encodeURIComponent(project.id)}`;
  const pages = [
    ["/connections", "我的连接｜无央"],
    ["/admin/models", "模型中心｜无央"],
    ["/admin/providers", "平台连接｜无央"],
    ["/admin/accounts", "账号管理｜无央"],
    ["/admin/storage", "存储中心｜无央"],
    ["/admin/generation-safety", "生成安全｜无央"],
    ["/admin/templates", "公共模板管理｜无央"],
    ["/admin/api-contract", "接口说明｜无央"],
  ] as const;

  for (const [path, title] of pages) {
    await page.goto(`${path}?${source}`);
    const actions = page.getByTestId("settings-header-actions");
    await expect(actions).toBeVisible();
    await expect(actions.getByRole("button", { name: "返回画布" }))
      .toBeVisible();
    await expect(actions.getByRole("button", { name: "返回工作空间" }))
      .toBeVisible();
    await expect(page).toHaveTitle(title);
  }

  await page.goto(`/admin/models?${source}`);
  await page.getByRole("button", { name: "管理平台连接" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/providers\\?from=${project.id}$`),
  );

  await page.getByTestId("settings-header-actions")
    .getByRole("button", { name: "返回画布" }).click();
  await expect(page).toHaveURL(new RegExp(`/canvas/${project.id}$`));
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );

  await page.getByTestId("user-avatar").click();
  await page.getByTestId("account-popover").getByText("我的连接").click();
  await expect(page).toHaveURL(
    new RegExp(`/connections\\?from=${project.id}$`),
  );
  await page.getByTestId("settings-header-actions")
    .getByRole("button", { name: "返回工作空间" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/canvas/projects\\?from=${project.id}$`),
  );
  await page.getByTestId("workspace-back").click();
  await expect(page).toHaveURL(new RegExp(`/canvas/${project.id}$`));

  await request.delete(`/api/projects/${project.id}`);
});

test("return lookup falls back to the per-user tab project and fails closed on API errors", async ({
  page,
  request,
}) => {
  expect(parseSourceProjectId("?from=default")).toBeUndefined();
  expect(parseSourceProjectId("?from=%2F%2Fevil.example"))
    .toBeUndefined();
  expect(safeProjectId(`p${"x".repeat(200)}`)).toBeUndefined();
  expect(withCanvasSource("/connections?tab=keys", "safe-project"))
    .toBe("/connections?tab=keys&from=safe-project");
  expect(() => withCanvasSource("https://evil.example", "safe-project"))
    .toThrow("internal path");

  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };

  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.goto("/connections?from=deleted-project");
  await page.getByTestId("settings-header-actions")
    .getByRole("button", { name: "返回画布" }).click();
  await expect(page).toHaveURL(new RegExp(`/canvas/${project.id}$`));

  await page.goto(`/connections?from=${project.id}`);
  let projectListReads = 0;
  await page.route("**/api/projects", async (route) => {
    projectListReads += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ error: "synthetic failure" }),
      status: 503,
    });
  });
  await page.getByTestId("settings-header-actions")
    .getByRole("button", { name: "返回画布" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(page).toHaveURL(
    new RegExp(`/connections\\?from=${project.id}$`),
  );
  await expect(page.getByTestId("settings-return-error")).toContainText(
    "暂时无法确认原画布",
  );
  expect(projectListReads).toBe(1);
  await page.unroute("**/api/projects");

  await request.delete(`/api/projects/${project.id}`);
});

test("favicon and browser title identify the workspace and update with the project title", async ({
  page,
  request,
}) => {
  const icon = await request.get("/favicon.svg");
  expect(icon.ok()).toBeTruthy();
  expect(await icon.text()).toContain("<svg");

  await page.goto("/canvas/projects");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/favicon.svg",
  );
  await expect(page).toHaveTitle("工作空间｜无央");

  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  await page.goto(`/canvas/${project.id}`);
  await expect(page).toHaveTitle("未命名项目｜无央");
  await page.getByTestId("title-input").fill("   ");
  await expect(page).toHaveTitle("未命名项目｜无央");
  await page.getByTestId("title-input").fill("春季女装项目");
  await expect(page).toHaveTitle("春季女装项目｜无央");

  await request.delete(`/api/projects/${project.id}`);
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
    db.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      )
      VALUES ('u2', 'u2', 'U2', 'x', 'user', 'active', ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString());
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
    db.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_status
      )
      VALUES ('image', 'node-asset', 'u2', 'node-asset.png', 1, ?, ?, 'ready')
    `).run(new Date(now).toISOString(), new Date(now).toISOString());
    expect(projectCover(db, row, ownerId)).toEqual({
      assetId: null,
      kind: null,
    });
    db.prepare(`
      UPDATE media_assets
      SET owner_id = ?, storage_status = 'pending'
      WHERE kind = 'image' AND id = 'node-asset'
    `).run(ownerId);
    expect(projectCover(db, row, ownerId)).toEqual({
      assetId: null,
      kind: null,
    });
    db.prepare(`
      UPDATE media_assets
      SET storage_status = 'ready'
      WHERE kind = 'image' AND id = 'node-asset'
    `).run();
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
    db.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_status
      )
      VALUES ('video', 'result-video', 'u2', 'result-video.mp4', 1, ?, ?, 'ready')
    `).run(new Date(now).toISOString(), new Date(now).toISOString());
    expect(projectCover(db, row, ownerId)).toEqual({
      assetId: "node-asset",
      kind: "image",
    });
    db.prepare(`
      UPDATE media_assets
      SET owner_id = ?, storage_status = 'pending'
      WHERE kind = 'video' AND id = 'result-video'
    `).run(ownerId);
    expect(projectCover(db, row, ownerId)).toEqual({
      assetId: "node-asset",
      kind: "image",
    });
    db.prepare(`
      UPDATE media_assets
      SET storage_status = 'ready'
      WHERE kind = 'video' AND id = 'result-video'
    `).run();
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
        kind, evidence, outcome, created_at
      )
      VALUES (
        'task-1', 1, 'profile', 'model', 'video', 'provider-boundary',
        'completed', ?
      )
    `).run(new Date(now + 10_000).toISOString());

    db.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
        request_fingerprint, state, attempt, created_at, updated_at, owner_id
      )
      VALUES ('task-u2', ?, 'u2-node', 'image', 'u2', '{}', 'u2-key',
        'u2-fingerprint', 'failed', 1, ?, ?, 'u2')
    `).run(
      projectId,
      new Date(now).toISOString(),
      new Date(now + 11_000).toISOString(),
    );
    db.prepare(`
      INSERT INTO generation_task_events (
        task_id, state, error_code, error_message, created_at
      ) VALUES ('task-u2', 'failed', 'FIXTURE', 'u2 survives', ?)
    `).run(new Date(now + 11_000).toISOString());
    db.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, outcome, created_at
      ) VALUES ('task-u2', 1, 'profile', 'model', 'image',
        'provider-boundary', 'outcome-unknown', ?)
    `).run(new Date(now + 11_000).toISOString());

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
    expect(
      db.prepare("SELECT owner_id FROM generation_tasks WHERE id = 'task-u2'")
        .get(),
    ).toEqual({ owner_id: "u2" });
    expect(
      db.prepare("SELECT state FROM generation_task_events WHERE task_id = 'task-u2'")
        .get(),
    ).toEqual({ state: "failed" });
    expect(
      db.prepare(`
        SELECT evidence FROM generation_provider_attempts
        WHERE task_id = 'task-u2'
      `).get(),
    ).toEqual({ evidence: "provider-boundary" });
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
