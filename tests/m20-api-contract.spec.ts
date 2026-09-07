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
  await test.step("UI04 exact admin GET and revision pagination are documented", async () => {
    const list = specification.paths["/api/admin/templates"] as any;
    const item = specification.paths["/api/admin/templates/{templateId}"] as any;
    expect(list.get.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "revision" })]));
    expect(list.get.responses["409"].description).toContain("LIST_REVISION_STALE");
    expect(item.get.operationId).toBe("getAdminPublicTemplate");
    expect(item.get.responses["403"]).toBeTruthy();
    expect(item.get.responses["404"]).toBeTruthy();
    expect(item.get.responses["200"].content["application/json"].schema.properties.template.allOf)
      .toContainEqual({ type: "object", required: ["graph"] });
  });
  expect(specification.openapi).toBe("3.1.0");
  expect(specification.info.title).toBe("Unboundry Private Replica API");
  const unresolvedReferences: string[] = [];
  const visitReferences = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visitReferences);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") {
        if (!child.startsWith("#/")) {
          unresolvedReferences.push(child);
          continue;
        }
        const resolved = child.slice(2).split("/").reduce<unknown>(
          (current, segment) => current && typeof current === "object"
            ? (current as Record<string, unknown>)[
                segment.replaceAll("~1", "/").replaceAll("~0", "~")
              ]
            : undefined,
          specification,
        );
        if (resolved === undefined) unresolvedReferences.push(child);
      }
      visitReferences(child);
    }
  };
  visitReferences(specification);
  expect(unresolvedReferences).toEqual([]);
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
    "/api/admin/models/{modelId}/contract",
    "/api/admin/models/{modelId}/contract/draft",
    "/api/admin/models/{modelId}/contract/publish",
    "/api/admin/models/{modelId}/contract/restore",
    "/api/admin/models/{modelId}/contract/revoke",
    "/api/admin/models/{modelId}/contract/rollback",
    "/api/admin/models/{modelId}/contract/validate",
    "/api/admin/templates",
    "/api/admin/templates/{templateId}",
    "/api/admin/users/{userId}/password",
    "/api/admin/users/{userId}/permissions",
    "/api/agent-config",
    "/api/auth/password",
    "/api/canvas/{canvasId}",
    "/api/canvas/{canvasId}/group-download",
    "/api/canvases/{canvasId}/commands",
    "/api/canvases/{canvasId}/generation-reconciliation-policy",
    "/api/canvases/{canvasId}/generation-terminal-detach",
    "/api/characters",
    "/api/health/live",
    "/api/health/ready",
    "/api/image-tools/capabilities",
    "/api/image-tools/seedance-validation",
    "/api/library",
    "/api/library/{kind}/{assetId}",
    "/api/media/image/{assetId}/seedance/authorization-sessions",
    "/api/media/image/{assetId}/seedance/character-compliance-checks",
    "/api/media/image/{assetId}/seedance/character-compliance-current",
    "/api/media/image/{assetId}/seedance/trusted-binding",
    "/api/media/image/{assetId}/seedance/trusted-bindings",
    "/api/models",
    "/api/project-title/{projectId}",
    "/api/projects",
    "/api/projects/{projectId}",
    "/api/seedance/authorization-sessions/{sessionId}",
    "/api/seedance/character-compliance/capability",
    "/api/seedance/character-compliance/checks/{checkId}",
    "/api/seedance/character-compliance/checks/{checkId}/cancel",
    "/api/seedance/character-compliance/checks/{checkId}/retry",
    "/api/seedance/trusted-assets/capability",
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
  expect((specification.paths["/api/image-tools/capabilities"] as {
    get: { operationId: string };
  }).get.operationId).toBe("readImageToolCapabilities");
  expect((specification.paths["/api/admin/models/{modelId}/contract"] as {
    get: { operationId: string };
  }).get.operationId).toBe("readAdminModelContract");
  expect((specification.paths[
    "/api/admin/models/{modelId}/contract/publish"
  ] as { post: { operationId: string } }).post.operationId)
    .toBe("publishAdminModelContract");
  expect((specification.paths["/api/image-tools/seedance-validation"] as {
    post: { operationId: string };
  }).post.operationId).toBe("validateSeedanceImageAsset");
  expect((specification.paths["/api/seedance/trusted-assets/capability"] as {
    get: { operationId: string };
  }).get.operationId).toBe("readSeedanceTrustedAssetCapability");
  expect((specification.paths[
    "/api/seedance/character-compliance/capability"
  ] as { get: { operationId: string } }).get.operationId)
    .toBe("readSeedanceCharacterComplianceCapability");
  expect((specification.paths[
    "/api/media/image/{assetId}/seedance/character-compliance-checks"
  ] as { post: { operationId: string } }).post.operationId)
    .toBe("createSeedanceCharacterComplianceCheck");
  expect((specification.paths[
    "/api/media/image/{assetId}/seedance/authorization-sessions"
  ] as { post: { operationId: string; responses: Record<string, unknown> } }))
    .toMatchObject({
      post: {
        operationId: "createSeedanceAuthorizationSession",
        responses: { "202": expect.any(Object) },
      },
    });
  expect((specification.paths[
    "/api/media/image/{assetId}/seedance/trusted-bindings"
  ] as { post: { operationId: string } }).post.operationId)
    .toBe("createSeedanceTrustedBinding");
  const specificationText = JSON.stringify(specification);
  expect(specificationText).not.toContain("app.unboundry.ai");
  expect(specificationText).not.toMatch(/accessKey|secret/i);
  // password 只允许作为请求体字段名（currentPassword/newPassword），文档不得包含密码值。
  expect(specificationText).not.toMatch(/"password"\s*:\s*"[^"]+"/i);
  // apiKey 只允许作为请求体字段名出现，任何响应 schema 或说明文本不得含密钥值。
  expect(specificationText).not.toMatch(
    /responses[\s\S]{0,200}?apiKey/i,
  );
  expect(specificationText).not.toMatch(
    /providerAccountFingerprint|providerGroupId|providerSessionId|secretAccessKey/i,
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
      deprecated: boolean;
      parameters: Array<Record<string, unknown>>;
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
  expect(canvasPath.put.deprecated).toBe(true);
  expect(canvasPath.put.parameters).toContainEqual(expect.objectContaining({
    in: "header",
    name: "X-Unboundry-Canvas-Write-Contract",
    required: false,
    schema: { const: "legacy-put-v1", type: "string" },
  }));
  expect(canvasPath.put.responses["200"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasLegacyPutSuccess");
  expect(canvasPath.put.responses["401"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasAccessError");
  expect(canvasPath.put.responses["403"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasAccessError");
  expect(canvasPath.put.responses["409"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasLegacyPutConflict");
  expect(canvasPath.put.responses["503"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasSaveUnavailable");
  const commandPath = specification.paths[
    "/api/canvases/{canvasId}/commands"
  ] as {
    post: {
      operationId: string;
      parameters: Array<Record<string, unknown>>;
      requestBody: JsonResponse;
      responses: Record<string, JsonResponse & {
        headers?: Record<string, { schema: Record<string, unknown> }>;
      }>;
    };
  };
  expect(commandPath.post.operationId).toBe("applyCanvasCommand");
  expect(commandPath.post.parameters).toContainEqual(expect.objectContaining({
    in: "header",
    name: "X-Unboundry-Canvas-Write-Contract",
    required: true,
    schema: { const: "command-v1", type: "string" },
  }));
  expect(commandPath.post.requestBody.content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasUserCommand");
  expect(Object.keys(commandPath.post.responses).sort()).toEqual([
    "200", "400", "401", "404", "405", "409", "503",
  ]);
  expect(commandPath.post.responses["200"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasCommandSuccess");
  expect(commandPath.post.responses["409"].content["application/json"].schema.$ref)
    .toBe("#/components/schemas/CanvasCommandConflict");
  expect(commandPath.post.responses["200"].headers?.[
    "X-Unboundry-Canvas-Write-Contract"
  ]?.schema).toEqual({ const: "command-v1", type: "string" });
  expect(commandPath.post.responses["409"].headers?.["X-Request-ID"]?.schema)
    .toEqual({ format: "uuid", type: "string" });
  for (const response of Object.values(commandPath.post.responses)) {
    expect(response.headers?.["X-Request-ID"]?.schema)
      .toEqual({ format: "uuid", type: "string" });
    expect(response.headers?.["X-Unboundry-Canvas-Write-Contract"]?.schema)
      .toEqual({ const: "command-v1", type: "string" });
  }
  expect(specification.components.schemas.CanvasUserCommand).toMatchObject({
    discriminator: {
      propertyName: "kind",
      mapping: {
        "adopt-uploaded-asset":
          "#/components/schemas/AdoptUploadedAssetCommand",
        "apply-topology": "#/components/schemas/ApplyTopologyCommand",
        "apply-user-field-changes":
          "#/components/schemas/ApplyUserFieldChangesCommand",
        "commit-user-layout": "#/components/schemas/CommitUserLayoutCommand",
        "create-canvas-document":
          "#/components/schemas/CreateCanvasDocumentCommand",
        "edit-result-and-invalidate-proof":
          "#/components/schemas/EditResultAndInvalidateProofCommand",
      },
    },
    oneOf: [
      { $ref: "#/components/schemas/CreateCanvasDocumentCommand" },
      { $ref: "#/components/schemas/ApplyUserFieldChangesCommand" },
      { $ref: "#/components/schemas/ApplyTopologyCommand" },
      { $ref: "#/components/schemas/CommitUserLayoutCommand" },
      { $ref: "#/components/schemas/AdoptUploadedAssetCommand" },
      { $ref: "#/components/schemas/EditResultAndInvalidateProofCommand" },
    ],
  });
  expect((specification.paths[
    "/api/canvases/{canvasId}/generation-reconciliation-policy"
  ] as { get: { operationId: string; responses: { "200": JsonResponse } } }))
    .toMatchObject({
      get: {
        operationId: "readLegacyTerminalGenerationReconciliationPolicy",
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LegacyTerminalReconciliationPolicy",
                },
              },
            },
          },
        },
      },
    });
  expect((specification.paths[
    "/api/canvases/{canvasId}/generation-terminal-detach"
  ] as {
    post: {
      operationId: string;
      requestBody: JsonResponse;
      responses: Record<string, JsonResponse & {
        headers?: Record<string, { schema: Record<string, unknown> }>;
      }>;
    };
  })).toMatchObject({
    post: {
      operationId: "detachLegacyTerminalGenerationBinding",
      requestBody: {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LegacyTerminalDetachRequest" },
          },
        },
      },
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LegacyTerminalDetachResult" },
            },
          },
        },
        "409": expect.any(Object),
      },
    },
  });
  const detachResponses = (specification.paths[
    "/api/canvases/{canvasId}/generation-terminal-detach"
  ] as {
    post: { responses: Record<string, JsonResponse & {
      headers?: Record<string, { schema: Record<string, unknown> }>;
    }> };
  }).post.responses;
  const detachConflictSchema = detachResponses["409"].content[
    "application/json"
  ].schema as unknown as { oneOf: Array<{ $ref: string }> };
  expect(detachConflictSchema.oneOf).toEqual([
      { $ref: "#/components/schemas/LegacyTerminalDetachConflict" },
      { $ref: "#/components/schemas/LegacyTerminalDetachWriteDisabled" },
    ]);
  expect(specification.components.schemas.LegacyTerminalDetachWriteDisabled)
    .toMatchObject({
      additionalProperties: false,
      properties: {
        code: { const: "LEGACY_RECONCILIATION_WRITE_DISABLED" },
      },
      required: ["code", "error", "requestId"],
    });
  for (const response of Object.values(detachResponses)) {
    expect(response.headers?.["X-Request-ID"]?.schema)
      .toEqual({ format: "uuid", type: "string" });
  }
  for (const schemaName of [
    "GenerationProjectionCommit",
    "LegacyTerminalDetachRequest",
  ] as const) {
    const schema = specification.components.schemas[schemaName] as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required.every((field: string) =>
      Object.hasOwn(schema.properties, field)
    )).toBe(true);
  }
  expect(specification.components.schemas.GenerationProjectionCommit.required)
    .not.toContain("nodeDataFingerprint");
  expect(
    (specification.components.schemas.GenerationProjectionCommit as {
      properties: { inputFingerprint: unknown };
    }).properties.inputFingerprint,
  ).toMatchObject({ minLength: 1, maxLength: 100_000 });
  expect(specification.components.schemas.LegacyTerminalDetachRequest.required)
    .toContain("nodeDataFingerprint");
  expect(
    (specification.components.schemas.LegacyTerminalDetachRequest as {
      properties: { inputFingerprint: unknown };
    }).properties.inputFingerprint,
  ).toMatchObject({ minLength: 1, maxLength: 100_000 });
  expect(Object.keys(
    specification.components.schemas.CanvasSaveRequest.properties as object,
  ).sort()).toEqual([
    "edges",
    "generationProjection",
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
      requestId: { type: "string", format: "uuid" },
    },
    additionalProperties: false,
  });
  expect(specification.components.schemas.CanvasAccessError).toEqual({
    type: "object",
    required: ["error"],
    properties: {
      code: { type: "string" },
      error: { type: "string" },
      operationId: { type: ["string", "null"] },
      requestId: { type: "string", format: "uuid" },
    },
    additionalProperties: false,
  });
  expect(specification.components.schemas.CanvasReadDocument.required)
    .toContain("loadToken");
  expect(specification.components.schemas.CanvasReadDocument.properties)
    .not.toHaveProperty("generationProjection");
  expect((specification.components.schemas.CanvasSaveRequest.properties as {
    generationProjection: { deprecated: boolean };
  }).generationProjection.deprecated).toBe(true);
  expect(specification.components.schemas.CanvasReadDocument.required)
    .toEqual(expect.arrayContaining([
      "currentWriterSequence",
      "currentWriterSessionId",
      "saveEpoch",
      "sessionHighWaterAttemptId",
      "sessionHighWaterOperationId",
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
      "sessionHighWaterOperationId",
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
    "CANVAS_GENERATION_PROJECTION_CONFLICT",
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
    sessionHighWaterOperationId: null,
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
      configurationRevision: string;
      displayName: string;
      id: string;
      parameterSchema: { fields: unknown[]; version: number };
    }>;
  };
  expect(typeof catalog.generationEnabled).toBe("boolean");
  expect(Array.isArray(catalog.models)).toBeTruthy();
  expect(catalog.models.every((model) => model.capability === "video")).toBeTruthy();
  expect(catalog.models.every((model) => model.id && model.displayName)).toBeTruthy();
  expect(catalog.models.every((model) =>
    /^[a-f0-9]{24}$/.test(model.configurationRevision))).toBeTruthy();
  expect(
    catalog.models.every(
      (model) =>
        model.parameterSchema.version === 2 &&
        Array.isArray(model.parameterSchema.fields),
    ),
  ).toBeTruthy();

  const imageToolCapabilities = await request.get(
    "/api/image-tools/capabilities",
  );
  expect(imageToolCapabilities.ok()).toBeTruthy();
  expect(imageToolCapabilities.headers()["cache-control"]).toBe("no-store");
  const imageToolSnapshot = await imageToolCapabilities.json() as {
    generatedAt: string;
    operations: Array<{ operation: string; reason: string; status: string }>;
    revision: string;
  };
  expect(imageToolSnapshot.generatedAt).toBeTruthy();
  expect(imageToolSnapshot.revision).toMatch(/^[a-f0-9]{24}$/);
  expect(imageToolSnapshot.operations).toHaveLength(17);
  expect(new Set(imageToolSnapshot.operations.map(({ operation }) => operation)).size)
    .toBe(17);
  expect(imageToolSnapshot.operations.every(({ reason }) => reason.length > 0))
    .toBeTruthy();
  const invalidSeedanceValidation = await request.post(
    "/api/image-tools/seedance-validation",
    { data: {} },
  );
  expect(invalidSeedanceValidation.status()).toBe(400);
  expect(invalidSeedanceValidation.headers()["cache-control"]).toBe("no-store");
  const characterComplianceCapability = await request.get(
    "/api/seedance/character-compliance/capability",
  );
  expect(characterComplianceCapability.ok()).toBeTruthy();
  expect(characterComplianceCapability.headers()["cache-control"]).toBe("no-store");
  await expect(characterComplianceCapability.json()).resolves.toMatchObject({
    available: false,
    branch: "C",
    canCreateChecks: false,
    formalSeedanceTicketAccepted: false,
    productName: "角色风险预检",
    reasonCode: "NO_COMPLIANT_PROVIDER",
  });

  await page.goto("/admin/api-contract");
  await expect(page.getByTestId("admin-api-contract-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目自己的数据接口" }))
    .toBeVisible();
  await expect(page.locator(".api-contract-grid article")).toHaveCount(58);
  await expect(page.getByText("当前共 47 条接口路径", { exact: true }))
    .toBeVisible();

  const finalCanvasDelete = await request.delete(`/api/canvas/${canvasId}`);
  expect(finalCanvasDelete.status()).toBe(204);
  await request.delete(`/api/project-title/${projectId}`);
});
