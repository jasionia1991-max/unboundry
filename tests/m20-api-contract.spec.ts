import { expect, test } from "@playwright/test";

test("the private API documents and reads canvas, project and model configuration", async ({
  page,
  request,
}) => {
  const canvasId = "api-contract-fixture";
  const projectId = "api-contract-project";
  await request.delete(`/api/canvas/${canvasId}`);
  await request.delete(`/api/project-title/${projectId}`);

  const specificationResponse = await request.get("/api/openapi.json");
  expect(specificationResponse.ok()).toBeTruthy();
  expect(specificationResponse.headers()["cache-control"]).toBe("no-store");
  const specification = await specificationResponse.json() as {
    info: { title: string };
    openapi: string;
    paths: Record<string, unknown>;
  };
  expect(specification.openapi).toBe("3.1.0");
  expect(specification.info.title).toBe("TapNow Private Replica API");
  expect(Object.keys(specification.paths).sort()).toEqual([
    "/api/account-context",
    "/api/agent-config",
    "/api/canvas/{canvasId}",
    "/api/canvas/{canvasId}/group-download",
    "/api/characters",
    "/api/library",
    "/api/models",
    "/api/project-title/{projectId}",
    "/api/projects",
    "/api/projects/{projectId}",
    "/api/templates",
    "/api/templates/{templateId}",
  ]);
  const specificationText = JSON.stringify(specification);
  expect(specificationText).not.toContain("app.tapnow.ai");
  expect(specificationText).not.toMatch(/accessKey|apiKey|secret|password/i);

  const canvasDocument = {
    revision: 0,
    nodes: [
      {
        id: "api-node-image",
        type: "image",
        position: { x: 120, y: 80 },
        data: { title: "API contract image" },
      },
      {
        id: "api-node-video",
        type: "video",
        position: { x: 520, y: 80 },
        data: { title: "API contract video" },
      },
    ],
    edges: [
      {
        id: "api-edge-image-video",
        source: "api-node-image",
        target: "api-node-video",
        sourceHandle: "source",
        targetHandle: "target",
        type: "cuttable",
      },
    ],
    viewport: { x: -40, y: 25, zoom: 0.8 },
  };
  const saveCanvas = await request.put(`/api/canvas/${canvasId}`, {
    data: canvasDocument,
  });
  expect(saveCanvas.ok()).toBeTruthy();
  expect(await saveCanvas.json()).toEqual({ graphRevision: 1, revision: 1 });

  const readCanvas = await request.get(`/api/canvas/${canvasId}`);
  expect(readCanvas.ok()).toBeTruthy();
  expect(await readCanvas.json()).toEqual({
    ...canvasDocument,
    graphRevision: 1,
    revision: 1,
  });

  const updatedAt = Date.now();
  const saveTitle = await request.put(`/api/project-title/${projectId}`, {
    data: { title: "API contract project", updatedAt },
  });
  expect(saveTitle.ok()).toBeTruthy();
  const readTitle = await request.get(`/api/project-title/${projectId}`);
  expect(readTitle.ok()).toBeTruthy();
  expect(await readTitle.json()).toEqual({
    title: "API contract project",
    updatedAt,
  });

  const modelCatalog = await request.get("/api/models?capability=video");
  expect(modelCatalog.ok()).toBeTruthy();
  const catalog = await modelCatalog.json() as {
    generationEnabled: boolean;
    models: Array<{
      capability: string;
      displayName: string;
      id: string;
      parameterSchema: { fields: unknown[]; version: number };
    }>;
  };
  expect(typeof catalog.generationEnabled).toBe("boolean");
  expect(Array.isArray(catalog.models)).toBeTruthy();
  expect(catalog.models.every((model) => model.capability === "video")).toBeTruthy();
  expect(catalog.models.every((model) => model.id && model.displayName)).toBeTruthy();
  expect(
    catalog.models.every(
      (model) =>
        model.parameterSchema.version === 2 &&
        Array.isArray(model.parameterSchema.fields),
    ),
  ).toBeTruthy();

  await page.goto("/admin/api-contract");
  await expect(page.getByTestId("admin-api-contract-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目自己的数据接口" }))
    .toBeVisible();
  await expect(page.locator(".api-contract-grid article")).toHaveCount(16);
  await expect(page.getByText("当前共 12 条接口路径", { exact: true }))
    .toBeVisible();

  await request.delete(`/api/canvas/${canvasId}`);
  await request.delete(`/api/project-title/${projectId}`);
});
