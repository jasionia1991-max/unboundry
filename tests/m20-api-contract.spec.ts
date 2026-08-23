import { expect, test } from "./safe-test";
import { currentSchemaVersion } from "../server/database";

test("the private API documents and reads canvas, project and model configuration", async ({
  page,
  request,
}) => {
  const canvasId = "api-contract-fixture";
  const projectId = "api-contract-project";
  const initialCanvasDelete = await request.delete(`/api/canvas/${canvasId}`);
  expect(initialCanvasDelete.status()).toBe(204);
  await request.delete(`/api/project-title/${projectId}`);

  const specificationResponse = await request.get("/api/openapi.json");
  expect(specificationResponse.ok()).toBeTruthy();
  expect(specificationResponse.headers()["cache-control"]).toBe("no-store");
  const specification = await specificationResponse.json() as {
    components: { schemas: Record<string, Record<string, unknown>> };
    info: { title: string };
    openapi: string;
    paths: Record<string, unknown>;
  };
  expect(specification.openapi).toBe("3.1.0");
  expect(specification.info.title).toBe("Unboundry Private Replica API");
  expect((specification.paths["/api/health/ready"] as {
    get: {
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                properties: { schemaVersion: unknown };
              };
            };
          };
        };
      };
    };
  }).get.responses["200"].content["application/json"].schema.properties
    .schemaVersion).toEqual({
      const: currentSchemaVersion,
      type: "integer",
    });
  expect(Object.keys(specification.paths).sort()).toEqual([
    "/api/account-context",
    "/api/account-credentials",
    "/api/account-credentials/{profileId}",
    "/api/account-credentials/{profileId}/verify",
    "/api/admin/templates",
    "/api/admin/templates/{templateId}",
    "/api/admin/users/{userId}/password",
    "/api/admin/users/{userId}/permissions",
    "/api/agent-config",
    "/api/auth/password",
    "/api/canvas/{canvasId}",
    "/api/canvas/{canvasId}/group-download",
    "/api/characters",
    "/api/health/live",
    "/api/health/ready",
    "/api/library",
    "/api/library/{kind}/{assetId}",
    "/api/models",
    "/api/project-title/{projectId}",
    "/api/projects",
    "/api/projects/{projectId}",
    "/api/templates",
    "/api/templates/{templateId}",
    "/api/version",
  ]);
  expect((specification.paths["/api/library"] as {
    get: { operationId: string };
    post: { operationId: string };
  })).toMatchObject({
    get: { operationId: "listLibraryAssets" },
    post: { operationId: "saveLibraryAsset" },
  });
  expect((specification.paths["/api/library/{kind}/{assetId}"] as {
    delete: { operationId: string };
  }).delete.operationId).toBe("deleteLibraryEntry");
  const specificationText = JSON.stringify(specification);
  expect(specificationText).not.toContain("app.unboundry.ai");
  expect(specificationText).not.toMatch(/accessKey|secret/i);
  // password 只允许作为请求体字段名（currentPassword/newPassword），文档不得包含密码值。
  expect(specificationText).not.toMatch(/"password"\s*:\s*"[^"]+"/i);
  // apiKey 只允许作为请求体字段名出现，任何响应 schema 或说明文本不得含密钥值。
  expect(specificationText).not.toMatch(
    /responses[\s\S]{0,200}?apiKey/i,
  );
  type JsonSchemaReference = { $ref: string };
  type JsonResponse = {
    content: { "application/json": { schema: JsonSchemaReference } };
  };
  const canvasPath = specification.paths["/api/canvas/{canvasId}"] as {
    delete: {
      operationId: string;
      parameters: Array<Record<string, unknown>>;
      responses: {
        "204": { description: string };
        "400": JsonResponse;
        "401": JsonResponse;
        "403": JsonResponse;
      };
      summary: string;
    };
    get: {
      parameters: Array<Record<string, unknown>>;
      responses: {
        "200": JsonResponse;
        "400": JsonResponse;
        "401": JsonResponse;
        "404": JsonResponse;
      };
    };
    put: {
      requestBody: JsonResponse;
      responses: {
        "200": JsonResponse;
        "401": JsonResponse;
        "403": JsonResponse;
        "409": JsonResponse;
        "503": JsonResponse;
      };
    };
  };
  expect(canvasPath.get.responses["200"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasReadDocument");
  expect(canvasPath.get.responses["400"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasSaveSessionHeaderError");
  expect(canvasPath.get.responses["401"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasAccessError");
  expect(canvasPath.get.responses["404"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasReadNotFound");
  expect(canvasPath.get.parameters).toContainEqual(expect.objectContaining({
    in: "header",
    name: "X-Unboundry-Canvas-Save-Session",
    required: false,
    schema: {
      pattern: "^[a-zA-Z0-9-]{8,80}$",
      type: "string",
    },
  }));
  expect(canvasPath.delete).toEqual({
    operationId: "deleteCanvas",
    summary: "Delete one owner-scoped canvas and its save fences",
    parameters: [
      {
        in: "path",
        name: "canvasId",
        required: true,
        schema: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
      },
    ],
    responses: {
      "204": {
        description: "Canvas and owner-scoped save fences deleted",
      },
      "400": {
        description: "Invalid canvas ID",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CanvasIdError" },
          },
        },
      },
      "401": {
        description: "Sign-in required",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CanvasAccessError" },
          },
        },
      },
      "403": {
        description: "Mutation origin is not allowed",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CanvasAccessError" },
          },
        },
      },
    },
  });
  expect(canvasPath.put.requestBody.content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasSaveRequest");
  expect(canvasPath.put.responses["200"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasSaveResult");
  expect(canvasPath.put.responses["401"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasAccessError");
  expect(canvasPath.put.responses["403"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasAccessError");
  expect(canvasPath.put.responses["409"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasSaveConflict");
  expect(canvasPath.put.responses["503"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasSaveUnavailable");
  expect(Object.keys(
    specification.components.schemas.CanvasSaveRequest.properties as object,
  ).sort()).toEqual([
    "edges",
    "nodes",
    "observedLoadToken",
    "observedRevision",
    "revision",
    "saveAttemptId",
    "saveSequence",
    "saveSessionId",
    "viewport",
  ]);
  expect(specification.components.schemas.CanvasSaveRequest.dependentRequired)
    .toEqual({
      observedLoadToken: ["observedRevision"],
      observedRevision: ["observedLoadToken"],
      saveAttemptId: ["saveSessionId", "saveSequence"],
      saveSequence: ["saveSessionId"],
      saveSessionId: ["saveSequence"],
    });
  expect(specification.components.schemas.CanvasIdError).toEqual({
    type: "object",
    required: ["code", "error"],
    properties: {
      code: { type: "string", const: "CANVAS_ID_INVALID" },
      error: { type: "string" },
    },
    additionalProperties: false,
  });
  expect(specification.components.schemas.CanvasAccessError).toEqual({
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string" },
    },
    additionalProperties: false,
  });
  expect(specification.components.schemas.CanvasReadDocument.required)
    .toContain("loadToken");
  expect(specification.components.schemas.CanvasReadDocument.required)
    .toEqual(expect.arrayContaining([
      "currentWriterSequence",
      "currentWriterSessionId",
      "saveEpoch",
      "sessionHighWaterAttemptId",
      "sessionHighWaterSequence",
    ]));
  expect(specification.components.schemas.CanvasReadNotFound.required)
    .toEqual(expect.arrayContaining([
      "code",
      "error",
      "currentWriterSequence",
      "currentWriterSessionId",
      "saveEpoch",
      "sessionHighWaterAttemptId",
      "sessionHighWaterSequence",
    ]));
  expect(specification.components.schemas.CanvasSaveResult.required)
    .toContain("loadToken");
  expect(specification.components.schemas.CanvasSaveConflict.oneOf).toEqual([
    { $ref: "#/components/schemas/CanvasSaveSupersededConflict" },
    { $ref: "#/components/schemas/CanvasSaveTerminalConflict" },
  ]);
  expect(Object.keys(
    specification.components.schemas.CanvasSaveSupersededConflict.properties as object,
  ).sort()).toEqual([
    "code",
    "currentGraphRevision",
    "currentRevision",
    "currentWriterSequence",
    "currentWriterSessionId",
    "error",
    "rejectedAttemptId",
    "rejectedSequence",
    "rejectedSessionId",
    "sessionHighWaterAttemptId",
    "sessionHighWaterSequence",
  ]);
  expect(specification.components.schemas.CanvasSaveSupersededConflict.required)
    .toEqual(expect.arrayContaining([
      "rejectedAttemptId",
      "sessionHighWaterAttemptId",
    ]));
  expect(
    (specification.components.schemas.CanvasSaveTerminalConflict.properties as {
      code: { enum: string[] };
    }).code.enum,
  ).toEqual([
    "CANVAS_LOAD_REQUIRED",
    "CANVAS_PROJECT_DELETED",
    "CANVAS_PROJECT_NOT_OWNED",
  ]);

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
  const saveSessionId = "api-contract-save-session";
  const saveAttemptId = "api-contract-save-attempt";
  const saveCanvas = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      ...canvasDocument,
      saveAttemptId,
      saveSequence: 1,
      saveSessionId,
    },
  });
  expect(saveCanvas.ok()).toBeTruthy();
  const savedCanvas = await saveCanvas.json() as {
    graphRevision: number;
    loadToken: string;
    revision: number;
  };
  expect(savedCanvas).toEqual({
    graphRevision: 1,
    loadToken: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{43}$/),
    revision: 1,
  });

  const readCanvas = await request.get(`/api/canvas/${canvasId}`, {
    headers: { "X-Unboundry-Canvas-Save-Session": saveSessionId },
  });
  expect(readCanvas.ok()).toBeTruthy();
  expect(await readCanvas.json()).toEqual({
    ...canvasDocument,
    currentWriterSequence: 1,
    currentWriterSessionId: saveSessionId,
    graphRevision: 1,
    loadToken: savedCanvas.loadToken,
    revision: 1,
    saveEpoch: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{22}$/),
    sessionHighWaterAttemptId: saveAttemptId,
    sessionHighWaterSequence: 1,
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
  await expect(page.locator(".api-contract-grid article")).toHaveCount(34);
  await expect(page.getByText("当前共 24 条接口路径", { exact: true }))
    .toBeVisible();

  const finalCanvasDelete = await request.delete(`/api/canvas/${canvasId}`);
  expect(finalCanvasDelete.status()).toBe(204);
  await request.delete(`/api/project-title/${projectId}`);
});
