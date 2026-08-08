import type { IncomingMessage, ServerResponse } from "node:http";

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Unboundry Private Replica API",
    version: "0.1.0",
    description:
      "Private, owner-scoped contracts implemented by this project. These are not Unboundry upstream private APIs.",
  },
  servers: [{ url: "/", description: "Current private service" }],
  paths: {
    "/api/version": {
      get: {
        operationId: "readVersion",
        summary: "Read the current deployed version",
        responses: {
          "200": {
            description: "Current semantic version",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["version"],
                  properties: {
                    version: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/canvas/{canvasId}": {
      get: {
        operationId: "readCanvas",
        summary: "Read one owner-scoped canvas",
        parameters: [
          {
            in: "path",
            name: "canvasId",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
          },
        ],
        responses: {
          "200": {
            description: "Canvas nodes, edges, viewport and revision",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CanvasDocument" },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "404": { description: "Canvas not found" },
        },
      },
      put: {
        operationId: "saveCanvas",
        summary: "Save one owner-scoped canvas with revision checking",
        parameters: [
          {
            in: "path",
            name: "canvasId",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CanvasDocument" },
            },
          },
        },
        responses: {
          "200": { description: "Saved revision" },
          "400": { description: "Invalid canvas document" },
          "409": { description: "Revision conflict" },
        },
      },
    },
    "/api/canvas/{canvasId}/group-download": {
      post: {
        operationId: "downloadGroupResults",
        summary: "Pack successful generation results of a group into a ZIP",
        parameters: [
          {
            in: "path",
            name: "canvasId",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                oneOf: [
                  {
                    type: "object",
                    required: ["groupId"],
                    properties: {
                      groupId: { type: "string", maxLength: 200 },
                    },
                  },
                  {
                    type: "object",
                    required: ["nodeIds"],
                    properties: {
                      nodeIds: {
                        type: "array",
                        items: { type: "string", maxLength: 200 },
                        maxItems: 500,
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "ZIP archive of successful results",
            content: {
              "application/zip": { schema: { type: "string", format: "binary" } },
            },
          },
          "400": { description: "No results, invalid payload or over limits" },
          "401": { description: "Sign-in required" },
          "404": { description: "Canvas or group not found" },
        },
      },
    },
    "/api/project-title/{projectId}": {
      get: {
        operationId: "readProjectTitle",
        summary: "Read one owner-scoped project title",
        parameters: [
          {
            in: "path",
            name: "projectId",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
          },
        ],
        responses: {
          "200": {
            description: "Project title and update timestamp",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProjectTitle" },
              },
            },
          },
          "404": { description: "Project title not found" },
        },
      },
      put: {
        operationId: "saveProjectTitle",
        summary: "Save one owner-scoped project title",
        parameters: [
          {
            in: "path",
            name: "projectId",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProjectTitle" },
            },
          },
        },
        responses: {
          "200": { description: "Saved project title" },
          "400": { description: "Invalid project title" },
        },
      },
    },
    "/api/projects": {
      get: {
        operationId: "listProjects",
        summary: "List owner-scoped projects with cover hints",
        responses: {
          "200": {
            description: "Project summaries",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProjectList" },
              },
            },
          },
          "401": { description: "Sign-in required" },
        },
      },
      post: {
        operationId: "createProject",
        summary: "Create an owner-scoped project with an empty canvas",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProjectCreate" },
            },
          },
        },
        responses: {
          "201": {
            description: "Created project",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProjectSummary" },
              },
            },
          },
          "400": { description: "Invalid project title" },
        },
      },
    },
    "/api/projects/{projectId}": {
      delete: {
        operationId: "deleteProject",
        summary: "Tombstone an owner-scoped project and remove its canvas and task records",
        parameters: [
          {
            in: "path",
            name: "projectId",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
          },
        ],
        responses: {
          "204": { description: "Project deleted" },
          "404": { description: "Project not found" },
          "409": { description: "Default project or active generation tasks" },
        },
      },
    },
    "/api/models": {
      get: {
        operationId: "listPublishedModels",
        summary: "Read safe published model configuration",
        parameters: [
          {
            in: "query",
            name: "capability",
            required: false,
            schema: {
              type: "string",
              enum: ["text", "image", "video", "audio"],
            },
          },
        ],
        responses: {
          "200": {
            description: "Published models and user-adjustable parameter schemas",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ModelCatalog" },
              },
            },
          },
          "400": { description: "Invalid capability" },
        },
      },
    },
    "/api/account-context": {
      get: {
        operationId: "readAccountContext",
        summary: "Read the signed-in user, personal workspace and permissions",
        responses: {
          "200": {
            description: "Safe current-user context without billing or credentials",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AccountContext" },
              },
            },
          },
          "401": { description: "Sign-in required" },
        },
      },
    },
    "/api/auth/password": {
      post: {
        operationId: "changeOwnPassword",
        summary: "Change the signed-in account's own password with the current one",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["currentPassword", "newPassword"],
                properties: {
                  currentPassword: { type: "string" },
                  newPassword: { type: "string", minLength: 12 },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Password changed; other sessions revoked",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user"],
                  properties: {
                    user: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          "400": { description: "Current password wrong or new password invalid" },
          "401": { description: "Sign-in required" },
        },
      },
    },
    "/api/admin/users/{userId}/permissions": {
      get: {
        operationId: "readAccountPermissions",
        summary: "List one account's effective permissions (manage_permissions)",
        parameters: [
          {
            in: "path",
            name: "userId",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9._-]{1,80}$" },
          },
        ],
        responses: {
          "200": {
            description: "Effective permission list for the account",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["permissions"],
                  properties: {
                    permissions: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AccountPermission" },
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          "403": { description: "Requires manage_permissions" },
          "404": { description: "Account not found" },
        },
      },
      put: {
        operationId: "writeAccountPermissions",
        summary: "Replace the extra-grant permission set of a non-admin account",
        parameters: [
          {
            in: "path",
            name: "userId",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9._-]{1,80}$" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["permissions"],
                properties: {
                  permissions: {
                    type: "array",
                    items: { $ref: "#/components/schemas/AccountPermission" },
                  },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated effective permission list with audit diff",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["added", "removed", "permissions"],
                  properties: {
                    added: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AccountPermission" },
                    },
                    removed: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AccountPermission" },
                    },
                    permissions: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AccountPermission" },
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          "400": {
            description:
              "Unknown permission, self modification, admin target or admin-only grant",
          },
          "403": { description: "Requires manage_permissions" },
          "404": { description: "Account not found" },
        },
      },
    },
    "/api/admin/users/{userId}/password": {
      post: {
        operationId: "resetAccountPassword",
        summary: "Reset another account's password (protected root excluded)",
        parameters: [
          {
            in: "path",
            name: "userId",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9._-]{1,80}$" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["newPassword"],
                properties: {
                  newPassword: { type: "string", minLength: 12 },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Password reset; all target sessions revoked",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user"],
                  properties: {
                    user: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid password" },
          "403": { description: "Protected root cannot be reset" },
          "404": { description: "Account not found" },
        },
      },
    },
    "/api/admin/templates": {
      get: {
        operationId: "listAdminPublicTemplates",
        summary: "List public templates in every status for administrators",
        parameters: [
          { in: "query", name: "q", schema: { type: "string", maxLength: 120 } },
          { in: "query", name: "category", schema: { type: "string" } },
          {
            in: "query",
            name: "status",
            schema: { type: "string", enum: ["draft", "published", "archived"] },
          },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
          { in: "query", name: "includeGraph", schema: { type: "boolean" } },
        ],
        responses: {
          "200": {
            description: "Paged public template management list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "pagination"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/TemplateCatalogCard" },
                    },
                    pagination: {
                      type: "object",
                      required: ["hasMore", "limit", "offset", "total"],
                      properties: {
                        hasMore: { type: "boolean" },
                        limit: { type: "integer" },
                        offset: { type: "integer" },
                        total: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          "403": { description: "Requires manage_public_templates" },
        },
      },
      post: {
        operationId: "createPublicTemplate",
        summary: "Create a public template (default draft)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "graph"],
                properties: {
                  title: { type: "string", minLength: 1, maxLength: 40 },
                  description: { type: "string", maxLength: 200 },
                  category: {
                    type: "array",
                    items: { type: "string", maxLength: 40 },
                    maxItems: 8,
                  },
                  previewImage: { type: "string", maxLength: 500 },
                  status: { type: "string", enum: ["draft", "published"] },
                  graph: {
                    type: "object",
                    required: ["nodes", "edges", "version"],
                    properties: {
                      nodes: { type: "array", maxItems: 500, items: { type: "object" } },
                      edges: { type: "array", maxItems: 1000, items: { type: "object" } },
                      version: { type: "integer", const: 1 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created public template card",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["template"],
                  properties: {
                    template: { $ref: "#/components/schemas/TemplateCatalogCard" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid title, category, status or graph" },
          "403": { description: "Requires manage_public_templates" },
        },
      },
    },
    "/api/admin/templates/{templateId}": {
      patch: {
        operationId: "updatePublicTemplate",
        summary: "Update title, description, category, graph, cover status or preview image",
        parameters: [
          {
            in: "path",
            name: "templateId",
            required: true,
            schema: { type: "string", pattern: "^[a-f0-9-]{36}$" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string", minLength: 1, maxLength: 40 },
                  description: { type: "string", maxLength: 200 },
                  category: {
                    type: "array",
                    items: { type: "string", maxLength: 40 },
                    maxItems: 8,
                  },
                  previewImage: { type: "string", maxLength: 500 },
                  status: {
                    type: "string",
                    enum: ["draft", "published", "archived"],
                  },
                  graph: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated public template card",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["template"],
                  properties: {
                    template: { $ref: "#/components/schemas/TemplateCatalogCard" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid fields" },
          "403": { description: "Requires manage_public_templates" },
          "404": { description: "Template not found" },
        },
      },
      delete: {
        operationId: "archivePublicTemplate",
        summary: "Archive a public template (soft delete, restorable)",
        parameters: [
          {
            in: "path",
            name: "templateId",
            required: true,
            schema: { type: "string", pattern: "^[a-f0-9-]{36}$" },
          },
        ],
        responses: {
          "200": {
            description: "Template archived; seeds and imported canvases remain intact",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["archived", "id", "status"],
                  properties: {
                    archived: { type: "boolean", const: true },
                    id: { type: "string" },
                    status: { type: "string", const: "archived" },
                  },
                },
              },
            },
          },
          "403": { description: "Requires manage_public_templates" },
          "404": { description: "Template not found" },
        },
      },
    },
    "/api/account-credentials": {
      get: {
        operationId: "listAccountCredentials",
        summary: "List connections with published models and this account's key state",
        responses: {
          "200": {
            description: "Safe connection summaries with key masks only",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items"],
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: [
                          "profileId",
                          "label",
                          "driver",
                          "baseUrl",
                          "keyStatus",
                          "credentialVersion",
                        ],
                        properties: {
                          profileId: { type: "string" },
                          label: { type: "string" },
                          driver: { type: "string" },
                          baseUrl: { type: "string" },
                          apiKeyMask: { type: "string" },
                          keyStatus: {
                            type: "string",
                            enum: ["unchecked", "valid", "invalid", "unknown"],
                          },
                          keyCheckedAt: { type: "string" },
                          credentialVersion: { type: "integer", minimum: 0 },
                          updatedAt: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Sign-in required" },
        },
      },
    },
    "/api/account-credentials/{profileId}": {
      put: {
        operationId: "saveAccountCredential",
        summary: "Save or replace the current account's key for one connection",
        parameters: [
          {
            in: "path",
            name: "profileId",
            required: true,
            schema: { type: "string", pattern: "^[a-f0-9-]{36}$" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["apiKey"],
                properties: {
                  apiKey: { type: "string", minLength: 8, maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Saved key mask and version" },
          "400": { description: "Invalid key or connection" },
          "401": { description: "Sign-in required" },
        },
      },
      delete: {
        operationId: "deleteAccountCredential",
        summary: "Delete the current account's key for one connection",
        parameters: [
          {
            in: "path",
            name: "profileId",
            required: true,
            schema: { type: "string", pattern: "^[a-f0-9-]{36}$" },
          },
        ],
        responses: {
          "200": { description: "Deleted" },
          "401": { description: "Sign-in required" },
          "404": { description: "Credential not found" },
        },
      },
    },
    "/api/account-credentials/{profileId}/verify": {
      post: {
        operationId: "verifyAccountCredential",
        summary: "Read-only verification of the current account's key",
        parameters: [
          {
            in: "path",
            name: "profileId",
            required: true,
            schema: { type: "string", pattern: "^[a-f0-9-]{36}$" },
          },
        ],
        responses: {
          "200": {
            description: "Verification result and key status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["keyStatus"],
                  properties: {
                    keyStatus: {
                      type: "string",
                      enum: ["invalid", "unknown", "valid"],
                    },
                    verification: {
                      type: "object",
                      properties: {
                        latencyMs: { type: "integer" },
                        message: { type: "string" },
                        modelCount: { type: "integer" },
                        status: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Missing or invalid key" },
          "401": { description: "Sign-in required" },
        },
      },
    },
    "/api/templates": {
      get: {
        operationId: "listTemplates",
        summary: "Search and page through the safe public or personal template catalog",
        parameters: [
          { in: "query", name: "space", schema: { type: "string", enum: ["public", "mine"] } },
          { in: "query", name: "category", schema: { type: "string" } },
          { in: "query", name: "q", schema: { type: "string", maxLength: 120 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
          { in: "query", name: "includeGraph", schema: { type: "boolean" } },
        ],
        responses: {
          "200": {
            description: "Template categories, paged cards and optional graph data",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TemplateCatalog" },
              },
            },
          },
          "400": { description: "Invalid template filter or pagination" },
          "401": { description: "Sign-in required" },
        },
      },
      post: {
        operationId: "createUserTemplate",
        summary: "Save the current account's private workflow template",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "graph"],
                properties: {
                  title: { type: "string", minLength: 1, maxLength: 40 },
                  category: { type: "string", maxLength: 40 },
                  sourceCanvasId: { type: "string", maxLength: 120 },
                  nodeIds: {
                    type: "array",
                    items: { type: "string", maxLength: 200 },
                    maxItems: 500,
                  },
                  graph: {
                    type: "object",
                    required: ["nodes", "edges", "version"],
                    properties: {
                      nodes: {
                        type: "array",
                        maxItems: 500,
                        items: { type: "object" },
                      },
                      edges: {
                        type: "array",
                        maxItems: 1000,
                        items: { type: "object" },
                      },
                      version: { type: "integer", const: 1 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Saved private template card",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TemplateCatalogCard" },
              },
            },
          },
          "400": { description: "Invalid template title, category or graph" },
          "401": { description: "Sign-in required" },
        },
      },
    },
    "/api/templates/{templateId}": {
      delete: {
        operationId: "deleteUserTemplate",
        summary: "Delete one of the current account's private templates",
        parameters: [
          {
            in: "path",
            name: "templateId",
            required: true,
            schema: {
              type: "string",
              pattern: "^[a-f0-9-]{36}$",
            },
          },
        ],
        responses: {
          "200": { description: "Template deleted" },
          "401": { description: "Sign-in required" },
          "404": { description: "Template not found or not owned by this account" },
        },
      },
    },
    "/api/agent-config": {
      get: {
        operationId: "readAgentConfiguration",
        summary: "Read display-only Agent models, skills and suggestions",
        responses: {
          "200": {
            description: "Safe Agent UI configuration with execution disabled",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AgentConfiguration" },
              },
            },
          },
          "401": { description: "Sign-in required" },
        },
      },
    },
    "/api/characters": {
      get: {
        operationId: "listCharacters",
        summary: "Filter and page through the local AI character catalog",
        parameters: [
          { in: "query", name: "category", schema: { type: "string" } },
          {
            in: "query",
            name: "filter",
            description: "Repeat key:value to select one or more values per filter group",
            schema: { type: "array", items: { type: "string" } },
          },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
        ],
        responses: {
          "200": {
            description: "Character categories, filter choices and paged local cards",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CharacterCatalog" },
              },
            },
          },
          "400": { description: "Invalid character filter or pagination" },
          "401": { description: "Sign-in required" },
        },
      },
    },
    "/api/library": {
      get: {
        operationId: "listLibraryAssets",
        summary: "Read spaces, folders and paged assets from the local library",
        parameters: [
          { in: "query", name: "space", schema: { type: "string", enum: ["personal", "team"] } },
          { in: "query", name: "folder", schema: { type: "string" } },
          { in: "query", name: "q", schema: { type: "string", maxLength: 120 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
        ],
        responses: {
          "200": {
            description: "Available spaces, folders and owner-scoped local assets",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LibraryCatalog" },
              },
            },
          },
          "400": { description: "Invalid library filter or pagination" },
          "401": { description: "Sign-in required" },
        },
      },
    },
  },
  components: {
    schemas: {
      AccountContext: {
        type: "object",
        required: ["user", "workspace", "permissions", "legacyPermissions"],
        properties: {
          user: {
            type: "object",
            required: [
              "id",
              "loginName",
              "displayName",
              "protected",
              "role",
              "status",
            ],
            properties: {
              id: { type: "string" },
              loginName: { type: "string" },
              displayName: { type: "string" },
              protected: { type: "boolean" },
              role: { type: "string", enum: ["admin", "user"] },
              status: { type: "string", enum: ["active", "disabled"] },
            },
            additionalProperties: false,
          },
          workspace: {
            type: "object",
            required: ["id", "type", "teamEnabled"],
            properties: {
              id: { type: "string" },
              type: { type: "string", const: "personal" },
              teamEnabled: { type: "boolean", const: false },
            },
            additionalProperties: false,
          },
          permissions: {
            type: "array",
            items: { $ref: "#/components/schemas/AccountPermission" },
          },
          legacyPermissions: {
            type: "object",
            additionalProperties: { type: "boolean" },
          },
        },
        additionalProperties: false,
      },
      AccountPermission: {
        type: "string",
        enum: [
          "manage_accounts",
          "manage_models",
          "manage_providers",
          "manage_storage",
          "manage_generation_safety",
          "manage_public_templates",
          "manage_permissions",
          "manage_projects",
          "generate",
          "group_download",
          "manage_own_templates",
          "manage_own_credentials",
        ],
      },
      AgentConfiguration: {
        type: "object",
        required: ["defaultModelId", "executionEnabled", "models", "skills", "suggestions"],
        properties: {
          defaultModelId: { type: "string" },
          executionEnabled: { type: "boolean", const: false },
          models: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "label", "status"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                status: { type: "string", enum: ["ready", "locked", "coming-soon"] },
              },
              additionalProperties: false,
            },
          },
          skills: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "label", "description", "enabled"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                description: { type: "string" },
                enabled: { type: "boolean" },
              },
              additionalProperties: false,
            },
          },
          suggestions: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "category", "title", "description", "icon"],
              properties: {
                id: { type: "string" },
                category: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                icon: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      CharacterCatalog: {
        type: "object",
        required: ["categories", "filters", "items", "pagination"],
        properties: {
          categories: { type: "array", items: { type: "string" } },
          filters: {
            type: "object",
            additionalProperties: {
              type: "array",
              items: { type: "string" },
            },
          },
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "name", "category", "meta", "tags", "colors"],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                category: { type: "string" },
                meta: { type: "array", items: { type: "string" } },
                tags: { type: "array", items: { type: "string" } },
                colors: {
                  type: "array",
                  minItems: 3,
                  maxItems: 3,
                  items: { type: "string" },
                },
              },
              additionalProperties: false,
            },
          },
          pagination: {
            type: "object",
            required: ["total", "limit", "offset", "hasMore"],
            properties: {
              total: { type: "integer", minimum: 0 },
              limit: { type: "integer", minimum: 1, maximum: 100 },
              offset: { type: "integer", minimum: 0 },
              hasMore: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      LibraryCatalog: {
        type: "object",
        required: ["spaces", "folders", "items", "pagination"],
        properties: {
          spaces: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "label", "readOnly"],
              properties: {
                id: { type: "string", enum: ["personal", "team"] },
                label: { type: "string", enum: ["个人", "团队"] },
                readOnly: { type: "boolean" },
              },
              additionalProperties: false,
            },
          },
          folders: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "label", "kind"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                kind: { type: "string", enum: ["system", "folder"] },
              },
              additionalProperties: false,
            },
          },
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "label", "kind", "src"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                kind: { type: "string", enum: ["image", "video", "audio"] },
                src: { type: "string" },
              },
              additionalProperties: false,
            },
          },
          pagination: {
            type: "object",
            required: ["total", "limit", "offset", "hasMore"],
            properties: {
              total: { type: "integer", minimum: 0 },
              limit: { type: "integer", minimum: 1, maximum: 100 },
              offset: { type: "integer", minimum: 0 },
              hasMore: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      CanvasDocument: {
        type: "object",
        required: ["revision", "nodes", "edges", "viewport"],
        properties: {
          revision: { type: "integer", minimum: 0 },
          nodes: {
            type: "array",
            maxItems: 5_000,
            items: { type: "object", additionalProperties: true },
          },
          edges: {
            type: "array",
            maxItems: 10_000,
            items: { type: "object", additionalProperties: true },
          },
          viewport: { $ref: "#/components/schemas/Viewport" },
        },
        additionalProperties: false,
      },
      Viewport: {
        type: "object",
        required: ["x", "y", "zoom"],
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          zoom: { type: "number", exclusiveMinimum: 0 },
        },
        additionalProperties: false,
      },
      ProjectTitle: {
        type: "object",
        required: ["title", "updatedAt"],
        properties: {
          title: { type: "string", maxLength: 120 },
          updatedAt: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
      ProjectCover: {
        type: "object",
        required: ["kind", "assetId"],
        properties: {
          kind: { type: "string", enum: ["image", "video", null] },
          assetId: { type: ["string", "null"] },
        },
        additionalProperties: false,
      },
      ProjectSummary: {
        type: "object",
        required: ["cover", "createdAt", "id", "title", "updatedAt"],
        properties: {
          cover: { $ref: "#/components/schemas/ProjectCover" },
          createdAt: { type: ["integer", "null"] },
          id: { type: "string" },
          title: { type: "string", maxLength: 120 },
          updatedAt: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
      ProjectList: {
        type: "object",
        required: ["projects"],
        properties: {
          projects: {
            type: "array",
            items: { $ref: "#/components/schemas/ProjectSummary" },
          },
        },
        additionalProperties: false,
      },
      ProjectCreate: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 120 },
        },
        additionalProperties: false,
      },
      TemplateCatalog: {
        type: "object",
        required: ["categories", "items", "pagination"],
        properties: {
          categories: { type: "array", items: { type: "string" } },
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "title", "description", "previewImage", "categories"],
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                previewImage: { type: "string" },
                categories: { type: "array", items: { type: "string" } },
                graph: {
                  type: "object",
                  required: ["version", "nodes", "edges"],
                  properties: {
                    version: { type: "integer", const: 1 },
                    nodes: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "type", "position", "data", "style", "zIndex"],
                        properties: {
                          id: { type: "string" },
                          type: {
                            type: "string",
                            enum: [
                              "audio",
                              "group",
                              "image",
                              "playlist",
                              "storyboard",
                              "text",
                              "video",
                            ],
                          },
                          parentId: { type: "string" },
                          position: {
                            type: "object",
                            required: ["x", "y"],
                            properties: {
                              x: { type: "number" },
                              y: { type: "number" },
                            },
                          },
                          data: { type: "object" },
                          style: { type: "object" },
                          zIndex: { type: "integer" },
                        },
                        additionalProperties: false,
                      },
                    },
                    edges: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "source", "target", "sourceHandle", "targetHandle", "type"],
                        properties: {
                          id: { type: "string" },
                          source: { type: "string" },
                          target: { type: "string" },
                          sourceHandle: { type: "string", const: "source" },
                          targetHandle: { type: "string", const: "target" },
                          type: { type: "string", const: "cuttable" },
                        },
                        additionalProperties: false,
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
          },
          pagination: {
            type: "object",
            required: ["total", "limit", "offset", "hasMore"],
            properties: {
              total: { type: "integer", minimum: 0 },
              limit: { type: "integer", minimum: 1, maximum: 100 },
              offset: { type: "integer", minimum: 0 },
              hasMore: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      ModelCatalog: {
        type: "object",
        required: ["generationEnabled", "models"],
        properties: {
          generationEnabled: { type: "boolean" },
          models: {
            type: "array",
            items: {
              type: "object",
              required: [
                "id",
                "displayName",
                "capability",
                "providerProtocol",
                "isDefault",
                "generationAvailable",
                "generationUnavailableReason",
                "generationUnavailableReasonCode",
                "parameterSchema",
              ],
              properties: {
                id: { type: "string" },
                displayName: { type: "string" },
                capability: {
                  type: "string",
                  enum: ["text", "image", "video", "audio"],
                },
                providerProtocol: {
                  type: "string",
                  enum: [
                    "native",
                    "openai-chat",
                    "openai-responses",
                    "claude-messages",
                    "gemini-generate-content",
                    "gpt-image",
                    "media-generate",
                  ],
                },
                isDefault: { type: "boolean" },
                generationAvailable: { type: "boolean" },
                generationUnavailableReason: { type: "string" },
                generationUnavailableReasonCode: {
                  type: ["string", "null"],
                  enum: [
                    "ADAPTER_UNSUPPORTED",
                    "PROVIDER_AUTH_FAILED",
                    "PROVIDER_CONFIGURATION_MISMATCH",
                    "PROVIDER_RECOVERY_ATTEMPT_USED",
                    "PROVIDER_PROFILE_MISSING",
                    "PROVIDER_DRIVER_MISMATCH",
                    "PROVIDER_REVERIFY_REQUIRED",
                    "EMERGENCY_STOP",
                    "GLOBAL_GENERATION_DISABLED",
                    null,
                  ],
                },
                parameterSchema: {
                  $ref: "#/components/schemas/ModelParameterSchema",
                },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: false,
      },
      ModelParameterSchema: {
        type: "object",
        required: ["version", "fields", "groups", "referenceInputs"],
        properties: {
          version: { type: "integer", const: 2 },
          groups: {
            type: "array",
            items: {
              type: "object",
              required: ["key", "label", "order"],
              properties: {
                key: { type: "string", enum: ["input", "main", "advanced", "output"] },
                label: { type: "string" },
                order: { type: "integer" },
              },
              additionalProperties: false,
            },
          },
          fields: {
            type: "array",
            items: {
              type: "object",
              required: ["key", "label", "type", "defaultValue", "options"],
              properties: {
                key: { type: "string" },
                label: { type: "string" },
                type: { type: "string", enum: ["boolean", "number", "select", "text", "textarea"] },
                group: { type: "string", enum: ["input", "main", "advanced", "output"] },
                summary: { type: "boolean" },
                defaultValue: { type: ["boolean", "number", "string"] },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["label", "value"],
                    properties: {
                      label: { type: "string" },
                      value: { type: ["boolean", "number", "string"] },
                      availability: { type: "string", enum: ["available", "disabled", "locked"] },
                      disabledReason: { type: "string" },
                      enabledWhen: { type: "array", items: { type: "object" } },
                    },
                    additionalProperties: true,
                  },
                },
                visibleWhen: { type: "array", items: { type: "object" } },
                enabledWhen: { type: "array", items: { type: "object" } },
                requiredWhen: { type: "array", items: { type: "object" } },
                placeholder: { type: "string" },
                min: { type: "number" },
                max: { type: "number" },
                step: { type: "number" },
                maxLength: { type: "integer" },
              },
              additionalProperties: true,
            },
          },
          referenceInputs: {
            type: "object",
            required: ["image", "video", "audio"],
            properties: {
              image: { type: "integer", minimum: 0 },
              video: { type: "integer", minimum: 0 },
              audio: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
          },
          referencePolicy: {
            type: "object",
            required: ["modeKey", "modes"],
            properties: {
              modeKey: { type: "string" },
              modes: { type: "object", additionalProperties: true },
            },
            additionalProperties: false,
          },
          upstreamInputs: {
            type: "object",
            required: ["text", "image", "video", "audio"],
            properties: Object.fromEntries(
              ["text", "image", "video", "audio"].map((kind) => [kind, {
                type: "object",
                required: ["supported", "limitMode"],
                properties: {
                  supported: { type: "boolean" },
                  limitMode: { type: "string", enum: ["context", "fixed"] },
                  maxCount: { type: "integer", minimum: 0, maximum: 16 },
                  note: { type: "string" },
                },
                additionalProperties: false,
              }]),
            ),
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
  },
} as const;

export function openApi(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "GET") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(openApiDocument));
}
