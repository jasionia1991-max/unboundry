import type { IncomingMessage, ServerResponse } from "node:http";
import { currentSchemaVersion } from "./database";

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
    "/api/health/live": {
      get: {
        operationId: "readProcessLiveness",
        summary: "Check that the application process is alive",
        responses: {
          "200": {
            description: "The process can serve HTTP requests",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["requestId", "status"],
                  properties: {
                    requestId: { type: "string", format: "uuid" },
                    status: { type: "string", const: "live" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
        },
      },
    },
    "/api/health/ready": {
      get: {
        operationId: "readServiceReadiness",
        summary: `Verify the existing schema-${currentSchemaVersion} database without changing it`,
        responses: {
          "200": {
            description: "The existing database is readable and compatible",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: [
                    "databaseProbe",
                    "mode",
                    "mutationsAccepted",
                    "requestId",
                    "schemaVersion",
                    "status",
                  ],
                  properties: {
                    databaseProbe: { type: "string", const: "read-only" },
                    mode: {
                      type: "string",
                      enum: ["active", "maintenance-api-blocked"],
                    },
                    mutationsAccepted: { type: "boolean" },
                    requestId: { type: "string", format: "uuid" },
                    schemaVersion: {
                      type: "integer",
                      const: currentSchemaVersion,
                    },
                    status: { type: "string", const: "ready" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          "503": {
            description:
              "The service is shutting down or the existing database is not ready",
          },
        },
      },
    },
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
          {
            in: "header",
            name: "X-Unboundry-Canvas-Save-Session",
            required: false,
            description:
              "Optional candidate-client save session used only to read owner-scoped pagehide reconciliation metadata. The read never creates a high-water entry.",
            schema: {
              type: "string",
              pattern: "^[a-zA-Z0-9-]{8,80}$",
            },
          },
        ],
        responses: {
          "200": {
            description: "Canvas nodes, edges, viewport and revision",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CanvasReadDocument" },
              },
            },
          },
          "400": {
            description: "Invalid canvas save-session header",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CanvasSaveSessionHeaderError" },
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
          "404": {
            description: "Canvas not found with process-epoch fence metadata",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CanvasReadNotFound" },
              },
            },
          },
        },
      },
      delete: {
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
      },
      put: {
        operationId: "saveCanvas",
        summary: "Save one owner-scoped canvas with same-session ordering",
        description:
          "Older saves from the same browser session are rejected; different sessions keep the DATA-005 last-successful-save-wins contract.",
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
              schema: { $ref: "#/components/schemas/CanvasSaveRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Saved document and graph revisions",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CanvasSaveResult" },
              },
            },
          },
          "400": { description: "Invalid canvas document" },
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
          "409": {
            description: "Superseded save, missing load baseline, or unavailable project",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CanvasSaveConflict" },
              },
            },
          },
          "503": {
            description: "Per-session ordering capacity is unavailable",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CanvasSaveUnavailable" },
              },
            },
          },
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
    "/api/canvases/{canvasId}/generation-reconciliation-policy": {
      get: {
        operationId: "readLegacyTerminalGenerationReconciliationPolicy",
        summary: "Read the server-controlled legacy terminal reconciliation rollout mode",
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
            description: "Owner-scoped rollout mode without allowlist disclosure",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LegacyTerminalReconciliationPolicy",
                },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped canvas not found" },
        },
      },
    },
    "/api/canvases/{canvasId}/generation-terminal-detach": {
      post: {
        operationId: "detachLegacyTerminalGenerationBinding",
        summary: "Atomically detach one exact terminal generation binding from its canvas node",
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
                $ref: "#/components/schemas/LegacyTerminalDetachRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Binding detached or already detached idempotently",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LegacyTerminalDetachResult",
                },
              },
            },
          },
          "400": { description: "Invalid exact binding request" },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped canvas not found" },
          "409": {
            description:
              "Rollout write disabled, task non-terminal, binding changed, or success proof conflicts",
          },
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
    "/api/image-tools/capabilities": {
      get: {
        operationId: "readImageToolCapabilities",
        summary: "Read the signed-in account's safe image-tool capability snapshot",
        responses: {
          "200": {
            description: "Current operation-level capability and availability snapshot",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ImageToolCapabilitySnapshot",
                },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "503": { description: "Capability service temporarily unavailable" },
        },
      },
    },
    "/api/image-tools/seedance-validation": {
      post: {
        operationId: "validateSeedanceImageAsset",
        summary: "Run owner-scoped local technical preflight for a Seedance image",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SeedanceAssetValidationRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Local technical eligibility result; not remote qualification",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SeedanceAssetValidation" },
              },
            },
          },
          "400": { description: "Invalid asset, model or role" },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped asset or published Seedance model not found" },
          "503": { description: "Validation service temporarily unavailable" },
        },
      },
    },
    "/api/seedance/character-compliance/capability": {
      get: {
        operationId: "readSeedanceCharacterComplianceCapability",
        summary: "Read the owner-scoped character risk precheck capability",
        responses: {
          "200": {
            description: "Current A/B/C branch without credentials or legal claims",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedanceCharacterComplianceCapability",
                },
              },
            },
          },
          "401": { description: "Sign-in required" },
        },
      },
    },
    "/api/media/image/{assetId}/seedance/character-compliance-checks": {
      post: {
        operationId: "createSeedanceCharacterComplianceCheck",
        summary: "Create one disclosed and owner-scoped character risk precheck",
        parameters: [{ $ref: "#/components/parameters/SeedanceImageAssetId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SeedanceCharacterComplianceCreateRequest",
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Persisted check state; not a legal or Seedance eligibility result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SeedanceCharacterComplianceCheck" },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped image not found" },
          "409": { description: "Disclosure missing or source conflict" },
          "503": { description: "No compliant Provider is available; no media was sent" },
        },
      },
    },
    "/api/media/image/{assetId}/seedance/character-compliance-current": {
      get: {
        operationId: "readCurrentSeedanceCharacterComplianceCheck",
        summary: "Read the newest identity-bound risk precheck for an image",
        parameters: [{ $ref: "#/components/parameters/SeedanceImageAssetId" }],
        responses: {
          "200": {
            description: "Current check with stale and expiry reconciliation",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SeedanceCharacterComplianceCheck" },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "404": { description: "No owner-scoped check exists" },
        },
      },
    },
    "/api/seedance/character-compliance/checks/{checkId}": {
      get: {
        operationId: "readSeedanceCharacterComplianceCheck",
        summary: "Read and reconcile one owner-scoped character risk precheck",
        parameters: [{ $ref: "#/components/parameters/SeedanceComplianceCheckId" }],
        responses: {
          "200": {
            description: "Current durable check state",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SeedanceCharacterComplianceCheck" },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped check not found" },
        },
      },
    },
    "/api/seedance/character-compliance/checks/{checkId}/cancel": {
      post: {
        operationId: "cancelSeedanceCharacterComplianceCheck",
        summary: "Cancel one pending owner-scoped character risk precheck",
        parameters: [{ $ref: "#/components/parameters/SeedanceComplianceCheckId" }],
        responses: {
          "200": {
            description: "Cancelled check state",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SeedanceCharacterComplianceCheck" },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped check not found" },
          "409": { description: "Terminal check cannot be cancelled" },
        },
      },
    },
    "/api/seedance/character-compliance/checks/{checkId}/retry": {
      post: {
        operationId: "retrySeedanceCharacterComplianceCheck",
        summary: "Retry a check only after definitive Provider non-admission",
        parameters: [{ $ref: "#/components/parameters/SeedanceComplianceCheckId" }],
        responses: {
          "200": {
            description: "Retried check state",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SeedanceCharacterComplianceCheck" },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped check not found" },
          "409": { description: "Check is not safe or eligible to retry" },
        },
      },
    },
    "/api/seedance/trusted-assets/capability": {
      get: {
        operationId: "readSeedanceTrustedAssetCapability",
        summary: "Read the safe owner-scoped Seedance trusted-asset capability",
        responses: {
          "200": {
            description: "A/B/C capability without credentials or account identifiers",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SeedanceTrustedAssetCapability" },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "503": { description: "Capability service temporarily unavailable" },
        },
      },
    },
    "/api/media/image/{assetId}/seedance/authorization-sessions": {
      post: {
        operationId: "createSeedanceAuthorizationSession",
        summary: "Start or resume an idempotent owner-scoped authorization session",
        parameters: [{ $ref: "#/components/parameters/SeedanceImageAssetId" }],
        responses: {
          "202": {
            description: "The bounded asynchronous flow was accepted",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedanceAuthorizationSessionCreated",
                },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped image not found" },
          "409": { description: "The source or provider identity changed" },
          "503": { description: "Entitlement or control-plane capability unavailable" },
        },
      },
    },
    "/api/seedance/authorization-sessions/{sessionId}": {
      get: {
        operationId: "readSeedanceAuthorizationSession",
        summary: "Read one opaque owner-scoped authorization session",
        parameters: [{ $ref: "#/components/parameters/SeedanceSessionId" }],
        responses: {
          "200": {
            description: "Persisted status without the H5 URL or biometric data",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SeedanceAuthorizationSession" },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped session not found" },
        },
      },
    },
    "/api/media/image/{assetId}/seedance/trusted-binding": {
      get: {
        operationId: "readSeedanceTrustedBinding",
        summary: "Read the current owner-scoped trusted binding for an image",
        parameters: [{ $ref: "#/components/parameters/SeedanceImageAssetId" }],
        responses: {
          "200": {
            description: "Safe binding status without Provider internal IDs",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SeedanceTrustedBinding" },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped binding not found" },
        },
      },
    },
    "/api/media/image/{assetId}/seedance/trusted-bindings": {
      post: {
        operationId: "createSeedanceTrustedBinding",
        summary: "Link a Provider asset for subsequent owner-scoped read verification",
        parameters: [{ $ref: "#/components/parameters/SeedanceImageAssetId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SeedanceTrustedBindingRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "Saved as unverified until Provider inspection succeeds",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SeedanceTrustedBinding" },
              },
            },
          },
          "400": { description: "Provider asset identifier invalid" },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped image not found" },
          "503": { description: "Trusted-asset service unavailable" },
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
        summary: "List one account's default, extra and effective permissions",
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
            description: "Explicit permission sets for the account",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: [
                    "defaultPermissions",
                    "effectivePermissions",
                    "extraPermissions",
                    "permissions",
                  ],
                  properties: {
                    defaultPermissions: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AccountPermission" },
                    },
                    effectivePermissions: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AccountPermission" },
                    },
                    extraPermissions: {
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
                properties: {
                  extraPermissions: {
                    description: "Authoritative extra-grant set",
                    type: "array",
                    items: { $ref: "#/components/schemas/AccountPermission" },
                  },
                  permissions: {
                    deprecated: true,
                    description:
                      "Legacy effective set; default permissions are converted out",
                    type: "array",
                    items: { $ref: "#/components/schemas/AccountPermission" },
                  },
                },
                oneOf: [
                  { required: ["extraPermissions"] },
                  { required: ["permissions"] },
                ],
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
                  required: [
                    "added",
                    "defaultPermissions",
                    "effectivePermissions",
                    "extraPermissions",
                    "permissions",
                    "removed",
                  ],
                  properties: {
                    added: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AccountPermission" },
                    },
                    removed: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AccountPermission" },
                    },
                    defaultPermissions: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AccountPermission" },
                    },
                    effectivePermissions: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AccountPermission" },
                    },
                    extraPermissions: {
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
          "409": {
            description:
              "Actor account inactive, or actor/target account deletion active",
          },
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
          "409": { description: "Actor account deletion is active or the account is disabled" },
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
          "409": { description: "Actor account deletion is active or the account is disabled" },
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
          "409": { description: "Actor account deletion is active or the account is disabled" },
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
          "409": { description: "Account deletion active or account inactive" },
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
          "400": { description: "Credential cannot be deleted safely" },
          "401": { description: "Sign-in required" },
          "404": { description: "Credential not found" },
          "409": { description: "Account deletion active or account inactive" },
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
          "400": {
            description:
              "Verification failed. Only explicit AUTH reports invalid; transient failures report unknown with a stable code.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code", "error", "keyStatus"],
                  properties: {
                    code: { type: "string" },
                    error: { type: "string" },
                    keyStatus: {
                      type: "string",
                      enum: ["invalid", "unknown"],
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Sign-in required" },
          "409": {
            description:
              "Credential/profile changed during verification, account deletion active, or account inactive",
          },
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
      post: {
        operationId: "saveLibraryAsset",
        summary: "Save an owner-scoped ready media asset to the personal library",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LibrarySaveRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "The idempotently saved personal library entry",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["item"],
                  properties: {
                    item: { $ref: "#/components/schemas/LibraryEntry" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          "400": { description: "Invalid bounded library entry" },
          "401": { description: "Sign-in required" },
          "409": { description: "Media is missing, unready, deleting or not owned" },
        },
      },
    },
    "/api/library/{kind}/{assetId}": {
      delete: {
        operationId: "deleteLibraryEntry",
        summary: "Remove only the owner-scoped library reference",
        parameters: [
          {
            in: "path",
            name: "kind",
            required: true,
            schema: { type: "string", enum: ["image", "video", "audio"] },
          },
          {
            in: "path",
            name: "assetId",
            required: true,
            schema: { type: "string", pattern: "^[A-Za-z0-9._-]{1,160}$" },
          },
        ],
        responses: {
          "204": { description: "Library reference removed; media is retained" },
          "401": { description: "Sign-in required" },
          "404": { description: "Owner-scoped library entry not found" },
        },
      },
    },
  },
  components: {
    parameters: {
      SeedanceImageAssetId: {
        in: "path",
        name: "assetId",
        required: true,
        schema: { type: "string", pattern: "^[A-Za-z0-9._-]{1,160}$" },
      },
      SeedanceComplianceCheckId: {
        in: "path",
        name: "checkId",
        required: true,
        schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,160}$" },
      },
      SeedanceSessionId: {
        in: "path",
        name: "sessionId",
        required: true,
        schema: { type: "string", pattern: "^[A-Za-z0-9._-]{1,160}$" },
      },
    },
    schemas: {
      SeedanceCharacterComplianceState: {
        type: "string",
        enum: [
          "NOT_REQUIRED", "NOT_SUBMITTED", "DISCLOSURE_REQUIRED", "QUEUED",
          "CHECKING", "APPROVED", "REJECTED_REAL_PERSON",
          "REJECTED_PUBLIC_FIGURE", "REJECTED_COPYRIGHT_IP",
          "REJECTED_MINOR_OR_SENSITIVE", "REJECTED_UNCERTAIN",
          "FAILED_RETRYABLE", "FAILED_TERMINAL", "STALE_SOURCE", "EXPIRED",
          "REVOKED",
        ],
      },
      SeedanceCharacterComplianceCapability: {
        type: "object",
        required: [
          "available", "branch", "canCreateChecks",
          "formalSeedanceTicketAccepted", "productName", "providerDisplayName",
          "reason", "reasonCode",
        ],
        properties: {
          available: { type: "boolean" },
          branch: { type: "string", enum: ["A", "B", "C"] },
          canCreateChecks: { type: "boolean" },
          formalSeedanceTicketAccepted: { type: "boolean" },
          productName: { type: "string", const: "角色风险预检" },
          providerDisplayName: {
            oneOf: [{ type: "string", minLength: 1 }, { type: "null" }],
          },
          reason: { type: "string", minLength: 1 },
          reasonCode: {
            type: "string",
            enum: [
              "AVAILABLE", "NO_COMPLIANT_PROVIDER",
              "PROVIDER_CONFIGURATION_UNAVAILABLE",
            ],
          },
        },
        additionalProperties: false,
      },
      SeedanceCharacterComplianceCreateRequest: {
        type: "object",
        required: [
          "disclosureAccepted", "disclosureVersion",
          "modelConfigurationRevision", "modelId",
        ],
        properties: {
          disclosureAccepted: { type: "boolean", const: true },
          disclosureVersion: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,160}$" },
          modelConfigurationRevision: {
            type: "string", pattern: "^[A-Za-z0-9._:-]{1,160}$",
          },
          modelId: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,160}$" },
        },
        additionalProperties: false,
      },
      SeedanceCharacterComplianceCheck: {
        type: "object",
        required: [
          "branch", "checkedAt", "createdAt", "disclosureVersion",
          "expiresAt", "id", "providerDisplayName", "riskCodes", "source",
          "state", "updatedAt",
        ],
        properties: {
          branch: { type: "string", enum: ["A", "B", "C"] },
          checkedAt: {
            oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
          },
          createdAt: { type: "string", format: "date-time" },
          disclosureVersion: { type: "string" },
          expiresAt: {
            oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
          },
          id: { type: "string" },
          providerDisplayName: {
            oneOf: [{ type: "string" }, { type: "null" }],
          },
          riskCodes: {
            type: "array",
            uniqueItems: true,
            items: {
              type: "string",
              enum: [
                "REAL_PERSON", "PUBLIC_FIGURE", "COPYRIGHT_IP",
                "MINOR_OR_SENSITIVE", "UNCERTAIN",
              ],
            },
          },
          source: {
            type: "object",
            required: [
              "assetId", "checksumSha256", "kind",
              "modelConfigurationRevision", "modelId",
            ],
            properties: {
              assetId: { type: "string" },
              checksumSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
              kind: { type: "string", const: "image" },
              modelConfigurationRevision: { type: "string" },
              modelId: { type: "string" },
            },
            additionalProperties: false,
          },
          state: { $ref: "#/components/schemas/SeedanceCharacterComplianceState" },
          updatedAt: { type: "string", format: "date-time" },
        },
        additionalProperties: false,
      },
      SeedanceTrustedAssetStatus: {
        type: "string",
        enum: [
          "NOT_STARTED",
          "SESSION_PENDING",
          "WAITING_AUTHORIZATION",
          "AUTHORIZATION_COMPLETED",
          "PENDING_ACCEPTANCE",
          "ASSET_PROCESSING",
          "LINKED_UNVERIFIED",
          "ACTIVE",
          "REJECTED",
          "CONSISTENCY_FAILED",
          "REVOKED",
          "DELETED",
          "ENTITLEMENT_EXPIRED",
          "STALE_SOURCE",
          "FAILED",
        ],
      },
      SeedanceTrustedAssetCapability: {
        type: "object",
        required: [
          "branch",
          "canCreateAuthorizationSession",
          "canInspectAsset",
          "providerDisplayName",
        ],
        properties: {
          branch: { type: "string", enum: ["A", "B", "C"] },
          canCreateAuthorizationSession: { type: "boolean" },
          canInspectAsset: { type: "boolean" },
          providerDisplayName: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      SeedanceAuthorizationSession: {
        type: "object",
        required: ["createdAt", "expiresAt", "id", "status", "updatedAt"],
        properties: {
          createdAt: { type: "string", format: "date-time" },
          expiresAt: {
            oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
          },
          id: { type: "string", pattern: "^[A-Za-z0-9._-]{1,160}$" },
          status: { $ref: "#/components/schemas/SeedanceTrustedAssetStatus" },
          updatedAt: { type: "string", format: "date-time" },
        },
        additionalProperties: false,
      },
      SeedanceAuthorizationSessionCreated: {
        type: "object",
        required: [
          "createdAt", "expiresAt", "id", "status", "updatedAt",
        ],
        properties: {
          authorizationUrl: { type: "string", format: "uri" },
          createdAt: { type: "string", format: "date-time" },
          expiresAt: {
            oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
          },
          id: { type: "string", pattern: "^[A-Za-z0-9._-]{1,160}$" },
          status: { $ref: "#/components/schemas/SeedanceTrustedAssetStatus" },
          updatedAt: { type: "string", format: "date-time" },
        },
        additionalProperties: false,
      },
      SeedanceTrustedBindingRequest: {
        type: "object",
        required: ["providerAssetId"],
        properties: {
          providerAssetId: {
            type: "string",
            pattern: "^[A-Za-z0-9._-]{1,160}$",
          },
        },
        additionalProperties: false,
      },
      SeedanceTrustedBinding: {
        type: "object",
        required: [
          "checkedAt", "createdAt", "failure", "id", "source", "status",
          "updatedAt",
        ],
        properties: {
          checkedAt: {
            oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
          },
          createdAt: { type: "string", format: "date-time" },
          failure: {
            oneOf: [
              {
                type: "object",
                required: ["code", "message"],
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                },
                additionalProperties: false,
              },
              { type: "null" },
            ],
          },
          id: { type: "string", pattern: "^[A-Za-z0-9._-]{1,160}$" },
          source: {
            type: "object",
            required: ["assetId", "checksumSha256", "kind"],
            properties: {
              assetId: { type: "string" },
              checksumSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
              kind: { type: "string", const: "image" },
            },
            additionalProperties: false,
          },
          status: { $ref: "#/components/schemas/SeedanceTrustedAssetStatus" },
          updatedAt: { type: "string", format: "date-time" },
        },
        additionalProperties: false,
      },
      SeedanceAssetValidationRequest: {
        type: "object",
        required: ["assetId", "modelId", "role"],
        properties: {
          assetId: { type: "string", pattern: "^[A-Za-z0-9._-]{1,160}$" },
          modelId: { type: "string", pattern: "^[A-Za-z0-9._-]{1,160}$" },
          role: {
            type: "string",
            enum: ["first-frame", "last-frame", "subject", "reference-image"],
          },
        },
        additionalProperties: false,
      },
      SeedanceAssetValidation: {
        type: "object",
        required: [
          "assetId",
          "checkedAt",
          "expiresAt",
          "kind",
          "modelConfigurationRevision",
          "modelDisplayName",
          "modelId",
          "operation",
          "problems",
          "remoteValidationAvailable",
          "role",
          "scope",
          "status",
        ],
        properties: {
          assetId: { type: "string" },
          checkedAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" },
          kind: { const: "validation", type: "string" },
          modelConfigurationRevision: { type: "string", minLength: 1 },
          modelDisplayName: { type: "string", minLength: 1 },
          modelId: { type: "string", minLength: 1 },
          operation: { const: "seedance-validate", type: "string" },
          problems: { type: "array", maxItems: 16, items: { type: "string" } },
          remoteValidationAvailable: { const: false, type: "boolean" },
          role: {
            type: "string",
            enum: ["first-frame", "last-frame", "subject", "reference-image"],
          },
          scope: { const: "local-technical-preflight", type: "string" },
          status: { type: "string", enum: ["eligible", "ineligible"] },
        },
        additionalProperties: false,
      },
      ImageToolCapabilitySnapshot: {
        type: "object",
        required: ["generatedAt", "operations", "revision"],
        properties: {
          generatedAt: { type: "string", format: "date-time" },
          operations: {
            type: "array",
            minItems: 17,
            maxItems: 17,
            items: { $ref: "#/components/schemas/ImageToolCapability" },
          },
          revision: { type: "string", pattern: "^[a-f0-9]{24}$" },
        },
        additionalProperties: false,
      },
      ImageToolCapability: {
        type: "object",
        required: [
          "expiresAt",
          "maximumInputBytes",
          "maximumInputPixels",
          "operation",
          "outputContentTypes",
          "reason",
          "reasonCode",
          "status",
          "supportsAlpha",
          "supportsMask",
          "supportsReferenceImage",
        ],
        properties: {
          estimatedCost: {
            type: "object",
            required: ["amount", "currency", "source"],
            properties: {
              amount: { type: "number", minimum: 0 },
              currency: { type: "string", enum: ["CNY", "USD", "credits"] },
              source: { type: "string", enum: ["operator", "provider"] },
            },
            additionalProperties: false,
          },
          expiresAt: { type: "string", format: "date-time" },
          maximumInputBytes: { type: "integer", minimum: 1 },
          maximumInputPixels: { type: "integer", minimum: 1 },
          modelId: { type: "string", minLength: 1 },
          operation: {
            type: "string",
            enum: [
              "crop",
              "color-mark",
              "resize-pixels",
              "quick-split",
              "annotate",
              "save-to-library",
              "multi-angle",
              "redraw",
              "outpaint",
              "erase",
              "enhance-conservative",
              "enhance-creative",
              "remove-background",
              "seedance-validate",
              "download",
              "fullscreen",
              "lighting",
            ],
          },
          outputContentTypes: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", enum: ["image/jpeg", "image/png"] },
          },
          reason: { type: "string", minLength: 1 },
          reasonCode: {
            type: "string",
            enum: [
              "AVAILABLE",
              "CAPABILITY_STALE",
              "LOCAL_RUNTIME_UNAVAILABLE",
              "MODEL_UNAVAILABLE",
              "OPERATOR_DISABLED",
              "PAUSED_BY_SCOPE",
              "PROVIDER_UNAVAILABLE",
              "REMOTE_VALIDATION_UNAVAILABLE",
              "UNSUPPORTED",
            ],
          },
          status: {
            type: "string",
            enum: [
              "available",
              "unavailable",
              "paused",
              "disabled_by_operator",
              "stale",
            ],
          },
          supportsAlpha: { type: "boolean" },
          supportsMask: { type: "boolean" },
          supportsReferenceImage: { type: "boolean" },
        },
        additionalProperties: false,
      },
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
            items: { $ref: "#/components/schemas/LibraryEntry" },
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
      LibraryEntry: {
        type: "object",
        required: ["id", "label", "kind", "revision", "src"],
        properties: {
          id: { type: "string" },
          label: { type: "string", minLength: 1, maxLength: 120 },
          kind: { type: "string", enum: ["image", "video", "audio"] },
          revision: { type: "integer", minimum: 1 },
          src: { type: "string", pattern: "^/api/" },
        },
        additionalProperties: false,
      },
      LibrarySaveRequest: {
        type: "object",
        required: ["assetId", "kind", "label"],
        properties: {
          assetId: {
            type: "string",
            pattern: "^[A-Za-z0-9._-]{1,160}$",
          },
          folderId: { type: "string", default: "others" },
          kind: { type: "string", enum: ["image", "video", "audio"] },
          label: { type: "string", minLength: 1, maxLength: 120 },
        },
        additionalProperties: false,
      },
      CanvasReadDocument: {
        type: "object",
        required: [
          "revision",
          "graphRevision",
          "loadToken",
          "saveEpoch",
          "sessionHighWaterSequence",
          "sessionHighWaterAttemptId",
          "currentWriterSessionId",
          "currentWriterSequence",
          "nodes",
          "edges",
          "viewport",
        ],
        properties: {
          revision: { type: "integer", minimum: 0 },
          generationProjection: {
            $ref: "#/components/schemas/GenerationProjectionCommit",
          },
          graphRevision: { type: "integer", minimum: 0 },
          loadToken: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            description:
              "Opaque HMAC credential bound to this account, canvas, revision and server-process epoch.",
          },
          saveEpoch: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            description:
              "Opaque public identifier for the current process-local save-fence epoch; rotates together with the load-token key.",
          },
          sessionHighWaterSequence: { type: "integer", minimum: 0 },
          sessionHighWaterAttemptId: { type: ["string", "null"] },
          currentWriterSessionId: { type: ["string", "null"] },
          currentWriterSequence: { type: "integer", minimum: 0 },
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
      GenerationProjectionCommit: {
        type: "object",
        description:
          "Narrow workflow-result projection CAS. The server checks this binding against the current target node inside the canvas write transaction; it is never used for ordinary canvas saves.",
        required: [
          "accountId",
          "applicationId",
          "inputFingerprint",
          "kind",
          "nodeId",
          "ownershipKey",
          "resultKey",
          "runId",
          "semanticRevision",
          "taskId",
        ],
        properties: {
          accountId: { type: "string", minLength: 1, maxLength: 512 },
          applicationId: { type: "string", minLength: 1, maxLength: 512 },
          inputFingerprint: { type: "string", minLength: 1, maxLength: 512 },
          kind: { type: "string", enum: ["audio", "image", "text", "video"] },
          nodeId: { type: "string", minLength: 1, maxLength: 512 },
          ownershipKey: { type: "string", minLength: 1, maxLength: 512 },
          resultKey: { type: "string", minLength: 1, maxLength: 512 },
          runId: { type: "string", minLength: 1, maxLength: 512 },
          semanticRevision: { type: "string", minLength: 1, maxLength: 512 },
          taskId: { type: "string", minLength: 1, maxLength: 512 },
        },
        additionalProperties: false,
      },
      LegacyTerminalReconciliationPolicy: {
        type: "object",
        required: ["mode", "writeEnabled"],
        properties: {
          mode: {
            type: "string",
            enum: ["off", "detect", "allowlist", "on"],
          },
          writeEnabled: { type: "boolean" },
        },
        additionalProperties: false,
      },
      LegacyTerminalDetachRequest: {
        type: "object",
        required: [
          "accountId",
          "applicationId",
          "canvasId",
          "inputFingerprint",
          "kind",
          "nodeDataFingerprint",
          "nodeId",
          "observedTerminalState",
          "ownershipKey",
          "runId",
          "taskId",
        ],
        properties: {
          accountId: { type: "string", minLength: 1, maxLength: 200 },
          applicationId: { type: "string", minLength: 1, maxLength: 2048 },
          canvasId: { type: "string", minLength: 1, maxLength: 200 },
          inputFingerprint: { type: "string", minLength: 1, maxLength: 2048 },
          kind: { type: "string", enum: ["audio", "image", "text", "video"] },
          nodeDataFingerprint: { type: "string", minLength: 1, maxLength: 2048 },
          nodeId: { type: "string", minLength: 1, maxLength: 200 },
          observedTerminalState: {
            type: "string",
            enum: ["cancelled", "failed", "success"],
          },
          ownershipKey: { type: "string", minLength: 1, maxLength: 2048 },
          resultKey: {
            type: "string",
            minLength: 1,
            maxLength: 2048,
            description:
              "Optional exact success-result proof. When present it must match both the durable node proof and the authoritative terminal task result.",
          },
          runId: { type: "string", minLength: 1, maxLength: 2048 },
          taskId: { type: "string", minLength: 1, maxLength: 200 },
        },
        additionalProperties: false,
      },
      LegacyTerminalCanvasDocument: {
        type: "object",
        required: [
          "canvasId",
          "edges",
          "graphRevision",
          "loadToken",
          "nodes",
          "ownerId",
          "revision",
          "viewport",
        ],
        properties: {
          canvasId: { type: "string" },
          edges: { type: "array", items: { type: "object" } },
          graphRevision: { type: "integer", minimum: 0 },
          loadToken: { type: "string", minLength: 1, maxLength: 256 },
          nodes: { type: "array", items: { type: "object" } },
          ownerId: { type: "string" },
          revision: { type: "integer", minimum: 0 },
          viewport: { $ref: "#/components/schemas/Viewport" },
        },
        additionalProperties: false,
      },
      LegacyTerminalDetachResult: {
        type: "object",
        required: ["clearedFields", "dataPatch", "document", "status"],
        properties: {
          clearedFields: { type: "array", items: { type: "string" } },
          dataPatch: { type: "object", additionalProperties: true },
          document: {
            $ref: "#/components/schemas/LegacyTerminalCanvasDocument",
          },
          status: {
            type: "string",
            enum: ["already-detached", "detached"],
          },
        },
        additionalProperties: false,
      },
      CanvasReadNotFound: {
        type: "object",
        required: [
          "code",
          "error",
          "saveEpoch",
          "sessionHighWaterSequence",
          "sessionHighWaterAttemptId",
          "currentWriterSessionId",
          "currentWriterSequence",
        ],
        properties: {
          code: { type: "string", const: "CANVAS_NOT_FOUND" },
          error: { type: "string" },
          saveEpoch: { type: "string", minLength: 1, maxLength: 128 },
          sessionHighWaterSequence: { type: "integer", minimum: 0 },
          sessionHighWaterAttemptId: { type: ["string", "null"] },
          currentWriterSessionId: { type: ["string", "null"] },
          currentWriterSequence: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
      CanvasSaveSessionHeaderError: {
        type: "object",
        required: ["code", "error"],
        properties: {
          code: { type: "string", const: "CANVAS_SAVE_SESSION_INVALID" },
          error: { type: "string" },
        },
        additionalProperties: false,
      },
      CanvasIdError: {
        type: "object",
        required: ["code", "error"],
        properties: {
          code: { type: "string", const: "CANVAS_ID_INVALID" },
          error: { type: "string" },
        },
        additionalProperties: false,
      },
      CanvasAccessError: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
        },
        additionalProperties: false,
      },
      CanvasSaveRequest: {
        type: "object",
        description:
          "saveSessionId/saveSequence/saveAttemptId remain optional on the wire. observedRevision and observedLoadToken are an inseparable pair proving that exact account/canvas/revision baseline was issued by the current server process, and every save to an existing canvas requires the pair, including v0.5.1-shaped requests. A request may omit the pair only while creating a canvas that is still missing when the save transaction begins.",
        required: ["revision", "nodes", "edges", "viewport"],
        dependentRequired: {
          observedLoadToken: ["observedRevision"],
          observedRevision: ["observedLoadToken"],
          saveAttemptId: ["saveSessionId", "saveSequence"],
          saveSequence: ["saveSessionId"],
          saveSessionId: ["saveSequence"],
        },
        properties: {
          revision: { type: "integer", minimum: 0 },
          observedLoadToken: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            description:
              "Wire-only HMAC returned by a successful GET or preceding successful PUT; bound to account, canvas, observedRevision and process epoch, and never persisted.",
          },
          observedRevision: {
            type: "integer",
            minimum: 0,
            description:
              "Wire-only revision covered by observedLoadToken; it may be older than the current row so DATA-005 last-successful-save-wins remains intact.",
          },
          saveSessionId: {
            type: "string",
            pattern: "^[a-zA-Z0-9-]{8,80}$",
          },
          saveAttemptId: {
            type: "string",
            pattern: "^[a-zA-Z0-9-]{8,80}$",
            description:
              "Candidate-client logical attempt identity. Exact retries reuse it; legacy session saves may omit it.",
          },
          saveSequence: { type: "integer", minimum: 1 },
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
      CanvasSaveResult: {
        type: "object",
        required: ["revision", "graphRevision", "loadToken"],
        properties: {
          revision: { type: "integer", minimum: 1 },
          graphRevision: { type: "integer", minimum: 0 },
          loadToken: {
            type: "string",
            minLength: 1,
            maxLength: 256,
          },
        },
        additionalProperties: false,
      },
      CanvasSaveConflict: {
        oneOf: [
          { $ref: "#/components/schemas/CanvasSaveSupersededConflict" },
          { $ref: "#/components/schemas/CanvasSaveTerminalConflict" },
        ],
      },
      CanvasSaveSupersededConflict: {
        type: "object",
        required: [
          "code",
          "error",
          "rejectedSessionId",
          "rejectedAttemptId",
          "rejectedSequence",
          "sessionHighWaterSequence",
          "sessionHighWaterAttemptId",
          "currentWriterSessionId",
          "currentWriterSequence",
          "currentRevision",
          "currentGraphRevision",
        ],
        properties: {
          code: { type: "string", const: "CANVAS_SAVE_SUPERSEDED" },
          error: { type: "string" },
          rejectedSessionId: { type: "string" },
          rejectedAttemptId: { type: ["string", "null"] },
          rejectedSequence: { type: "integer", minimum: 1 },
          sessionHighWaterSequence: { type: "integer", minimum: 1 },
          sessionHighWaterAttemptId: { type: ["string", "null"] },
          currentWriterSessionId: { type: ["string", "null"] },
          currentWriterSequence: { type: "integer", minimum: 0 },
          currentRevision: { type: "integer", minimum: 0 },
          currentGraphRevision: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
      CanvasSaveTerminalConflict: {
        type: "object",
        required: ["code", "error"],
        properties: {
          code: {
            type: "string",
            enum: [
              "CANVAS_GENERATION_PROJECTION_CONFLICT",
              "CANVAS_LOAD_REQUIRED",
              "CANVAS_PROJECT_DELETED",
              "CANVAS_PROJECT_NOT_OWNED",
            ],
          },
          error: { type: "string" },
        },
        additionalProperties: false,
      },
      CanvasSaveUnavailable: {
        type: "object",
        required: ["code", "error"],
        properties: {
          code: { type: "string", enum: ["CANVAS_SAVE_SESSION_CAPACITY"] },
          error: { type: "string" },
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
                "configurationRevision",
                "displayName",
                "capability",
                "providerName",
                "providerProtocol",
                "isDefault",
                "generationAvailable",
                "generationUnavailableReason",
                "generationUnavailableReasonCode",
                "parameterSchema",
              ],
              properties: {
                id: { type: "string" },
                configurationRevision: {
                  type: "string",
                  pattern: "^[a-f0-9]{24}$",
                },
                displayName: { type: "string" },
                providerName: { type: "string" },
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
                mediaInputPolicy: { type: "string", enum: ["seedance-2"] },
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
