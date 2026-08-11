import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import {
  AccountMutationBlockedError,
  assertAccountMutationAllowed,
} from "./accountMutationFence";
import { requestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import { hasPermission } from "./permissions";
import {
  generationSafetyStatus,
} from "./generationSafety";
import {
  evaluateModelRuntimeAvailability,
  type ModelRuntimeAvailability,
} from "./modelAvailability";
import {
  getProviderGenerationProfileState,
  listProviderProfiles,
  providerConfigurationVersion,
  type ProviderProfile,
} from "./providerProfiles";
import {
  cleanParameterSchema,
  isCustomParameterField,
  knownModelParameterSchema,
  providerParameterSchema,
  validateParameterSchemaConstraints,
  type ModelParameterSchema,
} from "../types/modelParameters";
import {
  isProviderProtocol,
  providerProtocolSupportsCapability,
  type ProviderProtocol,
} from "../types/relayProtocols";

type Capability = "audio" | "image" | "text" | "video";
type ModelStatus = "disabled" | "draft" | "published";

type ModelRow = {
  archived_at: string | null;
  capability: Capability;
  cost_currency: "CNY" | "USD";
  default_parameters: string;
  display_name: string;
  enabled: number;
  id: string;
  is_default: number;
  latest_capability_success_at: string | null;
  latest_auth_failure_at: string | null;
  latest_provider_attempt_at: string | null;
  model_configuration_updated_at: string;
  provider_display_name: string;
  provider_driver: string;
  provider_configuration_version: number;
  provider_configuration_updated_at: string | null;
  provider_profile_id: string;
  provider_model_id: string;
  provider_protocol: ProviderProtocol;
  provider_status: "disabled" | "enabled";
  published_at: string | null;
  sort_order: number;
  status: ModelStatus;
};

function parameterSchema(row: ModelRow): ModelParameterSchema {
  const fallback = knownModelParameterSchema({
    capability: row.capability,
    providerDriver: row.provider_driver,
    providerModelId: row.provider_model_id,
  });
  const constraints = providerParameterSchema({
    capability: row.capability,
    providerDriver: row.provider_driver,
    providerModelId: row.provider_model_id,
  });
  try {
    return validateParameterSchemaConstraints(
      cleanParameterSchema(
        row.capability,
        JSON.parse(row.default_parameters),
        fallback,
      ),
      constraints,
    );
  } catch {
    return fallback;
  }
}

function imageParameters(row: ModelRow) {
  if (row.capability !== "image") return undefined;
  const schema = parameterSchema(row);
  const values = (key: string) => schema.fields
    .find((item) => item.key === key)
    ?.options.map((item) => String(item.value)) ?? [];
  return {
    aspectRatios: values("aspectRatio"),
    maxReferenceImages: schema.referenceInputs.image,
    qualities: values("quality"),
  };
}

function mediaInputPolicy(row: ModelRow) {
  return row.capability === "video" &&
      row.provider_driver === "volcengine-ark" &&
      /^doubao-seedance-[a-z0-9-]+$/i.test(row.provider_model_id)
    ? "seedance-2" as const
    : undefined;
}

const capabilities: readonly Capability[] = ["text", "image", "video", "audio"];
const statuses: readonly ModelStatus[] = ["draft", "published", "disabled"];
let database: DatabaseSync | undefined;
let databaseDirectory = "";

function assertProviderModelCompatibility(
  providerDriver: string,
  providerModelId: string,
  providerProtocol: ProviderProtocol,
  capability: Capability,
) {
  if (
    /^doubao-(?:seed|seedance)-/i.test(providerModelId) &&
    providerDriver !== "volcengine-ark"
  ) {
    throw new Error("Doubao models must use a Volcengine Ark provider");
  }
  const relayDriver = providerDriver === "multi-protocol-relay";
  if (relayDriver && providerProtocol === "native") {
    throw new Error("Relay models require an explicit protocol");
  }
  if (!relayDriver && providerProtocol !== "native") {
    throw new Error("This provider does not use a relay protocol");
  }
  if (!providerProtocolSupportsCapability(providerProtocol, capability)) {
    throw new Error("Provider protocol does not support this node type");
  }
}

const relayTextProtocolInputs: Partial<
  Record<ProviderProtocol, ReadonlySet<Capability>>
> = {
  "claude-messages": new Set(["text", "image"]),
  "gemini-generate-content": new Set(["text", "image", "video", "audio"]),
  "openai-chat": new Set(["text", "image"]),
  "openai-responses": new Set(["text", "image", "audio"]),
};

const relayMediaRoles: Record<"audio" | "image" | "video", ReadonlySet<string>> = {
  audio: new Set(["context-audio", "reference-audio", "subject"]),
  image: new Set([
    "context-image",
    "first-frame",
    "last-frame",
    "reference-image",
    "subject",
  ]),
  video: new Set(["context-video", "reference-video", "subject"]),
};

function configuredRoles(
  schema: ModelParameterSchema,
  kind: "audio" | "image" | "video",
) {
  const roles = [
    ...(schema.inputPolicy?.roles?.[kind] ?? []),
    ...(schema.inputPolicy?.rolePolicies ?? []).flatMap((policy) => [
      ...(policy.roles[kind] ?? []),
      ...(policy.assignment?.[kind] ?? []),
      ...(policy.limits ?? [])
        .filter((limit) => limit.kind === kind)
        .map((limit) => limit.role),
    ]),
  ];
  return new Set(roles);
}

function assertRelaySchemaCompatibility(input: {
  capability: Capability;
  driver: string;
  protocol: ProviderProtocol;
  schema: ModelParameterSchema;
  status: ModelStatus;
}) {
  if (input.driver !== "multi-protocol-relay") return;
  if (
    input.status === "published" &&
    input.schema.fields.some(isCustomParameterField)
  ) {
    throw new Error("待映射参数完成服务端适配前不能发布");
  }
  const outputCount = input.schema.fields.find((field) =>
    field.key === "outputCount"
  );
  if (
    input.status === "published" &&
    outputCount &&
    (outputCount.defaultValue !== 1 ||
      outputCount.options.some((option) => option.value !== 1))
  ) {
    throw new Error("当前中转任务只支持单结果配置");
  }
  const allowedTextInputs = relayTextProtocolInputs[input.protocol];
  if (allowedTextInputs) {
    for (const kind of capabilities) {
      if (allowedTextInputs.has(kind)) continue;
      if (
        input.schema.upstreamInputs?.[kind].supported ||
        (input.schema.inputPolicy?.required?.[kind] ?? 0) > 0 ||
        (input.schema.inputPolicy?.roles?.[kind]?.length ?? 0) > 0 ||
        (input.schema.inputPolicy?.rolePolicies ?? []).some((policy) =>
          (policy.roles[kind]?.length ?? 0) > 0 ||
          (policy.assignment?.[kind]?.length ?? 0) > 0 ||
          (policy.limits ?? []).some((limit) => limit.kind === kind)
        )
      ) {
        throw new Error("当前调用协议不支持已配置的上游类型");
      }
    }
  }
  if (input.protocol === "media-generate") {
    for (const kind of ["audio", "image", "video"] as const) {
      for (const role of configuredRoles(input.schema, kind)) {
        if (!relayMediaRoles[kind].has(role)) {
          throw new Error("当前通用媒体适配器尚未映射该输入角色");
        }
      }
    }
  }
}

function db() {
  const directory = appDataDirectory();
  if (database && databaseDirectory === directory) return database;
  database?.close();
  database = openAppDatabase();
  databaseDirectory = directory;
  return database;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function respondAccountMutationConflict(
  response: ServerResponse,
  error: unknown,
) {
  if (!(error instanceof AccountMutationBlockedError)) return false;
  json(response, 409, {
    code: error.code,
    error: error.message,
  });
  return true;
}

function adminModel(
  row: ModelRow,
  availability: ModelRuntimeAvailability,
  lifecycle?: {
    canDelete: boolean;
    deleteBlockedCode?: string;
    deleteBlockedReason?: string;
    references: ModelReferenceCounts;
  },
) {
  return {
    archived: Boolean(row.archived_at),
    archivedAt: row.archived_at ?? undefined,
    capability: row.capability,
    costCurrency: row.cost_currency,
    displayName: row.display_name,
    enabled: Boolean(row.enabled),
    ...availability,
    id: row.id,
    isDefault: Boolean(row.is_default),
    parameterConstraints: providerParameterSchema({
      capability: row.capability,
      providerDriver: row.provider_driver,
      providerModelId: row.provider_model_id,
    }),
    parameterSchema: parameterSchema(row),
    providerConnected:
      row.provider_status === "enabled" &&
      availability.generationUnavailableReasonCode !==
        "PROVIDER_CONFIGURATION_MISMATCH",
    providerDriver: row.provider_driver,
    providerProfileId: row.provider_profile_id,
    providerModelId: row.provider_model_id,
    providerProtocol: row.provider_protocol,
    providerName: row.provider_display_name,
    everPublished: Boolean(row.published_at),
    sortOrder: row.sort_order,
    status: row.status,
    ...lifecycle,
  };
}

function modelRows(store: DatabaseSync, ownerId: string) {
  return store
    .prepare(`
      SELECT
        model_profiles.id,
        model_profiles.display_name,
        model_profiles.provider_profile_id,
        model_profiles.provider_model_id,
        model_profiles.provider_protocol,
        model_profiles.capability,
        model_profiles.archived_at,
        model_profiles.cost_currency,
        model_profiles.default_parameters,
        model_profiles.status,
        model_profiles.published_at,
        provider_profiles.display_name AS provider_display_name,
        provider_profiles.driver AS provider_driver,
        provider_profiles.provider_configuration_version,
        provider_profiles.status AS provider_status,
        model_profiles.updated_at AS model_configuration_updated_at,
        (
          SELECT MAX(config_event.created_at)
          FROM admin_audit_events AS config_event
          WHERE
            config_event.action IN (
              'provider_profile.create',
              'provider_profile.update'
            )
            AND json_extract(config_event.details, '$.profileId') =
              model_profiles.provider_profile_id
        ) AS provider_configuration_updated_at,
        (
          SELECT MAX(auth_task.updated_at)
          FROM generation_tasks AS auth_task
          WHERE
            auth_task.provider_profile_id = model_profiles.provider_profile_id
            AND auth_task.kind = model_profiles.capability
            AND auth_task.owner_id = ?
            AND auth_task.state = 'failed'
            AND auth_task.error_code IN ('AUTH', 'PERMISSION')
        ) AS latest_auth_failure_at,
        (
          SELECT MAX(success_task.updated_at)
          FROM generation_tasks AS success_task
          WHERE
            success_task.provider_profile_id = model_profiles.provider_profile_id
            AND success_task.kind = model_profiles.capability
            AND success_task.owner_id = ?
            AND success_task.state = 'success'
        ) AS latest_capability_success_at,
        (
          SELECT MAX(provider_attempt.created_at)
          FROM generation_provider_attempts AS provider_attempt
          WHERE
            provider_attempt.provider_profile_id = model_profiles.provider_profile_id
            AND provider_attempt.kind = model_profiles.capability
            AND provider_attempt.owner_id = ?
        ) AS latest_provider_attempt_at,
        node_model_bindings.enabled,
        node_model_bindings.is_default,
        node_model_bindings.sort_order
      FROM model_profiles
      JOIN provider_profiles
        ON provider_profiles.id = model_profiles.provider_profile_id
      JOIN node_model_bindings
        ON node_model_bindings.model_id = model_profiles.id
        AND node_model_bindings.node_type = model_profiles.capability
      ORDER BY
        CASE model_profiles.capability
          WHEN 'text' THEN 1
          WHEN 'image' THEN 2
          WHEN 'video' THEN 3
          ELSE 4
        END,
        node_model_bindings.sort_order,
        model_profiles.created_at
    `)
    .all(ownerId, ownerId, ownerId) as ModelRow[];
}

async function modelRuntimeAvailability(rows: ModelRow[], ownerId: string) {
  const storedProviders = new Map<string, ProviderProfile>();
  try {
    const document = await listProviderProfiles();
    for (const profile of document.profiles) {
      storedProviders.set(profile.id, profile);
    }
  } catch {
    // A missing or unreadable encrypted profile is reported per model below.
  }
  const safety = generationSafetyStatus();
  return new Map(
    await Promise.all(
      rows.map(
        async (row): Promise<[string, ModelRuntimeAvailability]> => {
      const storedProvider = storedProviders.get(row.provider_profile_id);
      const configurationAligned = Boolean(
        storedProvider &&
        row.provider_configuration_version > 0 &&
        row.provider_configuration_version ===
          providerConfigurationVersion(storedProvider) &&
        row.provider_driver === storedProvider.driver,
      );
      const providerState = await getProviderGenerationProfileState(
        row.provider_profile_id,
        ownerId,
      ).catch(() => undefined);
      const credentialReady = Boolean(
        providerState &&
        (
          providerState.reason === "ready" ||
          providerState.reason === "account-credential-missing" ||
          providerState.reason === "account-credential-invalid"
        ),
      );
      return [
        row.id,
        evaluateModelRuntimeAvailability({
        accountCredentialState:
          providerState?.reason === "account-credential-missing"
            ? "missing"
            : providerState?.reason === "account-credential-invalid"
              ? "invalid"
              : providerState?.reason === "ready"
                ? "valid"
                : undefined,
        capability: row.capability,
        costCurrency: row.cost_currency,
        emergencyStop: safety.emergencyStop,
        globalEnabled: safety.globalEnabled,
        latestCapabilitySuccessAt:
          row.latest_capability_success_at ?? undefined,
        latestProviderAttemptAt:
          row.latest_provider_attempt_at ?? undefined,
        latestAuthFailureAt: row.latest_auth_failure_at ?? undefined,
        modelConfigurationUpdatedAt: row.model_configuration_updated_at,
        providerDriver: row.provider_driver,
        providerModelId: row.provider_model_id,
        providerProtocol: row.provider_protocol,
        providerConfigurationUpdatedAt:
          row.provider_configuration_updated_at ?? undefined,
        providerConfigurationVersionAligned: configurationAligned,
        providerStatus: configurationAligned
          ? credentialReady
            ? "enabled"
            : row.provider_status
          : "disabled",
        storedProviderDriver: storedProvider?.driver,
        }),
      ];
        },
      ),
    ),
  );
}

function audit(
  store: DatabaseSync,
  actorUserId: string,
  action: string,
  modelId: string,
  details: Record<string, unknown>,
) {
  store
    .prepare(`
      INSERT INTO admin_audit_events (
        actor_user_id, action, target_user_id, details, created_at
      )
      VALUES (?, ?, NULL, ?, ?)
    `)
    .run(
      actorUserId,
      action,
      JSON.stringify({ modelId, ...details }),
      new Date().toISOString(),
    );
}

type ModelReferenceCounts = {
  activeTasks: number;
  canvasDocuments: number;
  tasks: number;
};

function modelReferenceCounts(
  store: DatabaseSync,
  modelId: string,
): ModelReferenceCounts {
  const canvasDocuments = Number((store.prepare(`
    SELECT COUNT(DISTINCT canvas_documents.rowid) AS count
    FROM canvas_documents
    JOIN json_tree(
      CASE
        WHEN json_valid(canvas_documents.nodes) THEN canvas_documents.nodes
        ELSE '[]'
      END
    ) AS node_value
    WHERE
      node_value.key IN (
        'textModelId', 'imageModelId', 'videoModelId', 'audioModelId'
      )
      AND node_value.type = 'text'
      AND node_value.value = ?
  `).get(modelId) as { count: number }).count);
  const tasks = Number((store.prepare(`
    SELECT COUNT(*) AS count
    FROM generation_tasks
    WHERE model = ?
  `).get(modelId) as { count: number }).count);
  const activeTasks = Number((store.prepare(`
    SELECT COUNT(*) AS count
    FROM generation_tasks
    WHERE
      model = ?
      AND state IN ('queued', 'running', 'retrying', 'recovering')
  `).get(modelId) as { count: number }).count);
  return { activeTasks, canvasDocuments, tasks };
}

function modelReferenceCountsById(
  store: DatabaseSync,
  modelIds: readonly string[],
) {
  const counts = new Map<string, ModelReferenceCounts>(
    modelIds.map((id) => [
      id,
      { activeTasks: 0, canvasDocuments: 0, tasks: 0 },
    ]),
  );
  const taskRows = store.prepare(`
    SELECT
      model,
      COUNT(*) AS tasks,
      SUM(
        CASE
          WHEN state IN ('queued', 'running', 'retrying', 'recovering')
          THEN 1
          ELSE 0
        END
      ) AS active_tasks
    FROM generation_tasks
    WHERE model IS NOT NULL
    GROUP BY model
  `).all() as Array<{ active_tasks: number; model: string; tasks: number }>;
  for (const row of taskRows) {
    const current = counts.get(row.model);
    if (!current) continue;
    current.tasks = Number(row.tasks);
    current.activeTasks = Number(row.active_tasks);
  }
  const canvasRows = store.prepare(`
    SELECT
      node_value.value AS model_id,
      COUNT(DISTINCT canvas_documents.rowid) AS canvas_documents
    FROM canvas_documents
    JOIN json_tree(
      CASE
        WHEN json_valid(canvas_documents.nodes) THEN canvas_documents.nodes
        ELSE '[]'
      END
    ) AS node_value
    WHERE
      node_value.key IN (
        'textModelId', 'imageModelId', 'videoModelId', 'audioModelId'
      )
      AND node_value.type = 'text'
    GROUP BY node_value.value
  `).all() as Array<{ canvas_documents: number; model_id: string }>;
  for (const row of canvasRows) {
    const current = counts.get(row.model_id);
    if (current) current.canvasDocuments = Number(row.canvas_documents);
  }
  return counts;
}

type LifecycleRejection = {
  code:
    | "ACTIVE_TASKS"
    | "CANVAS_REFERENCED"
    | "DEFAULT_MODEL"
    | "EVER_PUBLISHED"
    | "HISTORICAL_TASKS"
    | "MODEL_NOT_DISABLED"
    | "NOT_FOUND"
    | "NOT_ARCHIVED";
  message: string;
};

function deletionRejection(
  model: ModelRow,
  references: ModelReferenceCounts,
): LifecycleRejection | undefined {
  if (model.is_default) {
    return {
      code: "DEFAULT_MODEL",
      message: "该模型仍是默认模型，请先明确设置另一个默认模型",
    };
  }
  if (model.status !== "draft" && model.status !== "disabled") {
    return {
      code: "MODEL_NOT_DISABLED",
      message: "永久删除前必须先停用模型",
    };
  }
  if (model.published_at) {
    return {
      code: "EVER_PUBLISHED",
      message: "该模型曾经发布过，只能归档，不能永久删除",
    };
  }
  if (references.canvasDocuments > 0) {
    return {
      code: "CANVAS_REFERENCED",
      message: `仍有 ${references.canvasDocuments} 个画布引用该模型，只能归档`,
    };
  }
  if (references.activeTasks > 0) {
    return {
      code: "ACTIVE_TASKS",
      message: `仍有 ${references.activeTasks} 个任务正在处理，不能永久删除`,
    };
  }
  if (references.tasks > 0) {
    return {
      code: "HISTORICAL_TASKS",
      message: `仍有 ${references.tasks} 条历史任务引用该模型，只能归档`,
    };
  }
  if (!model.archived_at) {
    return {
      code: "NOT_ARCHIVED",
      message: "永久删除前必须先归档模型，确认无引用后再删除",
    };
  }
  return undefined;
}

function lifecycleError(
  response: ServerResponse,
  rejection: LifecycleRejection,
  references?: ModelReferenceCounts,
) {
  json(response, rejection.code === "NOT_FOUND" ? 404 : 409, {
    code: rejection.code,
    error: rejection.message,
    ...(references ? { references } : {}),
  });
}

function modelLifecycleSummary(
  model: ModelRow,
  references: ModelReferenceCounts,
) {
  const rejection = deletionRejection(model, references);
  return {
    canDelete: !rejection,
    ...(rejection
      ? {
          deleteBlockedCode: rejection.code,
          deleteBlockedReason: rejection.message,
        }
      : {}),
    references,
  };
}

function cleanModelInput(input: {
  capability?: unknown;
  displayName?: unknown;
  isDefault?: unknown;
  providerModelId?: unknown;
  providerProfileId?: unknown;
  providerProtocol?: unknown;
  sortOrder?: unknown;
  status?: unknown;
  parameterSchema?: unknown;
}) {
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  const providerModelId =
    typeof input.providerModelId === "string"
      ? input.providerModelId.trim()
      : "";
  const providerProfileId =
    typeof input.providerProfileId === "string"
      ? input.providerProfileId.trim()
      : "provider-unconfigured";
  const providerProtocol = input.providerProtocol === undefined
    ? "native"
    : input.providerProtocol;
  const capability = input.capability as Capability;
  const status = input.status as ModelStatus;
  const sortOrder = Number(input.sortOrder ?? 100);
  if (
    displayName.length < 1 ||
    displayName.length > 80 ||
    providerModelId.length < 1 ||
    providerModelId.length > 160 ||
    !isProviderProtocol(providerProtocol) ||
    !/^[a-z0-9-]{3,80}$/i.test(providerProfileId) ||
    !capabilities.includes(capability) ||
    !statuses.includes(status) ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > 10_000 ||
    typeof input.isDefault !== "boolean"
  ) {
    throw new Error("Invalid model profile");
  }
  if (input.isDefault && status !== "published") {
    throw new Error("Only published models can be the default");
  }
  return {
    capability,
    displayName,
    isDefault: input.isDefault,
    providerModelId,
    providerProfileId,
    providerProtocol,
    sortOrder,
    status,
    parameterSchema: input.parameterSchema,
  };
}

export async function publicModelsApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, { error: "Method not allowed" });
    return;
  }
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "请先登录" });
    return;
  }
  const requestUrl = new URL(request.url ?? "", "http://127.0.0.1");
  const capability = requestUrl.searchParams.get("capability");
  if (capability && !capabilities.includes(capability as Capability)) {
    json(response, 400, { error: "Invalid model capability" });
    return;
  }
  const rows = modelRows(db(), identity.userId).filter(
    (row) =>
      row.archived_at === null &&
      row.status === "published" &&
      row.enabled === 1 &&
      (!capability || row.capability === capability),
  );
  const availability = await modelRuntimeAvailability(rows, identity.userId);
  json(response, 200, {
    generationEnabled: rows.some(
      (row) => availability.get(row.id)?.generationAvailable,
    ),
    models: rows.map((row) => ({
      capability: row.capability,
      costCurrency: row.cost_currency,
      displayName: row.display_name,
      id: row.id,
      imageParameters: imageParameters(row),
      mediaInputPolicy: mediaInputPolicy(row),
      parameterSchema: parameterSchema(row),
      providerProtocol: row.provider_protocol,
      isDefault: Boolean(row.is_default),
      ...availability.get(row.id)!,
    })),
  });
}

export async function adminModelsApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const identity = requestIdentity(request);
  if (!identity || !hasPermission(identity, "manage_models")) {
    json(response, 403, { error: "Only administrators can manage models" });
    return;
  }
  const store = db();
  const path = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );

  if (request.method === "GET" && !path) {
    const rows = modelRows(store, identity.userId);
    const availability = await modelRuntimeAvailability(
      rows,
      identity.userId,
    );
    const references = modelReferenceCountsById(
      store,
      rows.map((row) => row.id),
    );
    const providers = store
      .prepare(`
        SELECT id, display_name AS displayName, driver, status
        FROM provider_profiles
        ORDER BY created_at
      `)
      .all();
    json(response, 200, {
      models: rows.map((row) => adminModel(
        row,
        availability.get(row.id)!,
        modelLifecycleSummary(
          row,
          references.get(row.id) ?? {
            activeTasks: 0,
            canvasDocuments: 0,
            tasks: 0,
          },
        ),
      )),
      providers,
      providerSecretsStoredInBrowser: false,
      submissionEnabled: rows.some(
        (row) =>
          row.archived_at === null &&
          row.status === "published" &&
          row.enabled === 1 &&
          availability.get(row.id)?.generationAvailable,
      ),
    });
    return;
  }

  const lifecyclePath = path.match(
    /^([a-z0-9-]{3,80})\/(archive|restore)$/i,
  );
  if (request.method === "POST" && lifecyclePath) {
    const [, modelId, rawAction] = lifecyclePath;
    const action = rawAction.toLowerCase() as "archive" | "restore";
    let next: ModelRow | undefined;
    store.exec("BEGIN IMMEDIATE");
    try {
      assertAccountMutationAllowed(store, identity.userId);
      const current = modelRows(store, identity.userId).find(
        (row) => row.id === modelId,
      );
      if (!current) {
        const rejection: LifecycleRejection = {
          code: "NOT_FOUND",
          message: "模型不存在",
        };
        audit(store, identity.userId, `model.${action}_rejected`, modelId, {
          reason: rejection.code,
        });
        store.exec("COMMIT");
        lifecycleError(response, rejection);
        return;
      }
      const references = modelReferenceCounts(store, modelId);
      const timestamp = new Date().toISOString();
      if (action === "archive") {
        if (!current.archived_at && current.is_default) {
          const rejection: LifecycleRejection = {
            code: "DEFAULT_MODEL",
            message: "该模型仍是默认模型，请先明确设置另一个默认模型再归档",
          };
          audit(store, identity.userId, "model.archive_rejected", modelId, {
            displayName: current.display_name,
            reason: rejection.code,
            references,
          });
          store.exec("COMMIT");
          lifecycleError(response, rejection, references);
          return;
        }
        if (!current.archived_at && current.status === "published") {
          const rejection: LifecycleRejection = {
            code: "MODEL_NOT_DISABLED",
            message: "已发布模型不能直接归档，请先停用，确认不再进入新任务后再归档",
          };
          audit(store, identity.userId, "model.archive_rejected", modelId, {
            displayName: current.display_name,
            reason: rejection.code,
            references,
          });
          store.exec("COMMIT");
          lifecycleError(response, rejection, references);
          return;
        }
        if (!current.archived_at) {
          store.prepare(`
            UPDATE node_model_bindings
            SET enabled = 0, is_default = 0, updated_at = ?
            WHERE model_id = ?
          `).run(timestamp, modelId);
          store.prepare(`
            UPDATE model_profiles
            SET archived_at = ?, updated_at = ?
            WHERE id = ?
          `).run(timestamp, timestamp, modelId);
        }
        audit(store, identity.userId, "model.archive", modelId, {
          alreadyArchived: Boolean(current.archived_at),
          capability: current.capability,
          displayName: current.display_name,
          references,
          status: current.status,
        });
      } else {
        if (current.archived_at) {
          store.prepare(`
            UPDATE model_profiles
            SET archived_at = NULL, updated_at = ?
            WHERE id = ?
          `).run(timestamp, modelId);
          store.prepare(`
            UPDATE node_model_bindings
            SET
              enabled = ?,
              is_default = 0,
              updated_at = ?
            WHERE model_id = ?
          `).run(current.status === "published" ? 1 : 0, timestamp, modelId);
        }
        audit(store, identity.userId, "model.restore", modelId, {
          alreadyRestored: !current.archived_at,
          capability: current.capability,
          displayName: current.display_name,
          references,
          status: current.status,
        });
      }
      next = modelRows(store, identity.userId).find(
        (row) => row.id === modelId,
      );
      store.exec("COMMIT");
    } catch (error) {
      if (store.isTransaction) store.exec("ROLLBACK");
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 409, {
        code: "LIFECYCLE_UPDATE_FAILED",
        error: action === "archive" ? "模型归档失败" : "模型恢复失败",
      });
      return;
    }
    if (!next) {
      json(response, 409, {
        code: "LIFECYCLE_UPDATE_FAILED",
        error: "模型生命周期更新失败",
      });
      return;
    }
    const availability = await modelRuntimeAvailability(
      [next],
      identity.userId,
    );
    json(response, 200, {
      model: adminModel(
        next,
        availability.get(next.id)!,
        modelLifecycleSummary(next, modelReferenceCounts(store, next.id)),
      ),
      paidProviderRequests: 0,
    });
    return;
  }

  if (request.method === "DELETE" && /^[a-z0-9-]{3,80}$/i.test(path)) {
    store.exec("BEGIN IMMEDIATE");
    try {
      assertAccountMutationAllowed(store, identity.userId);
      const current = modelRows(store, identity.userId).find(
        (row) => row.id === path,
      );
      if (!current) {
        const rejection: LifecycleRejection = {
          code: "NOT_FOUND",
          message: "模型不存在",
        };
        audit(store, identity.userId, "model.delete_rejected", path, {
          reason: rejection.code,
        });
        store.exec("COMMIT");
        lifecycleError(response, rejection);
        return;
      }
      const references = modelReferenceCounts(store, path);
      const rejection = deletionRejection(current, references);
      if (rejection) {
        audit(store, identity.userId, "model.delete_rejected", path, {
          archived: Boolean(current.archived_at),
          capability: current.capability,
          displayName: current.display_name,
          everPublished: Boolean(current.published_at),
          reason: rejection.code,
          references,
          status: current.status,
        });
        store.exec("COMMIT");
        lifecycleError(response, rejection, references);
        return;
      }
      audit(store, identity.userId, "model.delete", path, {
        archived: Boolean(current.archived_at),
        capability: current.capability,
        displayName: current.display_name,
        providerModelId: current.provider_model_id,
        providerProfileId: current.provider_profile_id,
        references,
        status: current.status,
      });
      store.prepare("DELETE FROM model_profiles WHERE id = ?").run(path);
      store.exec("COMMIT");
      json(response, 200, {
        deleted: true,
        id: path,
        paidProviderRequests: 0,
      });
    } catch (error) {
      if (store.isTransaction) store.exec("ROLLBACK");
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 409, {
        code: "MODEL_DELETE_FAILED",
        error: "模型删除失败",
      });
    }
    return;
  }

  if (request.method === "POST" && !path) {
    try {
      const input = cleanModelInput(
        await readJsonBody<Parameters<typeof cleanModelInput>[0]>(
          request,
          64 * 1_024,
        ),
      );
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      const provider = store
        .prepare(`
          SELECT id, driver
          FROM provider_profiles
          WHERE id = ?
        `)
        .get(input.providerProfileId) as
          | { driver: string; id: string }
          | undefined;
      if (!provider) throw new Error("Provider profile not found");
      assertProviderModelCompatibility(
        provider.driver,
        input.providerModelId,
        input.providerProtocol,
        input.capability,
      );
      const costCurrency = provider.driver === "volcengine-ark" ? "CNY" : "USD";
      const constraints = providerParameterSchema({
        capability: input.capability,
        providerDriver: provider.driver,
        providerModelId: input.providerModelId,
      });
      const schema = validateParameterSchemaConstraints(cleanParameterSchema(
        input.capability,
        input.parameterSchema,
        knownModelParameterSchema({
          capability: input.capability,
          providerDriver: provider.driver,
          providerModelId: input.providerModelId,
        }),
      ), constraints);
      assertRelaySchemaCompatibility({
        capability: input.capability,
        driver: provider.driver,
        protocol: input.providerProtocol,
        schema,
        status: input.status,
      });
      store.exec("BEGIN IMMEDIATE");
      try {
        assertAccountMutationAllowed(store, identity.userId);
        store
          .prepare(`
            INSERT INTO model_profiles (
              id, display_name, provider_profile_id, provider_model_id,
              provider_protocol, capability, status, default_parameters,
              cost_currency,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            id,
            input.displayName,
            input.providerProfileId,
            input.providerModelId,
            input.providerProtocol,
            input.capability,
            input.status,
            JSON.stringify(schema),
            costCurrency,
            timestamp,
            timestamp,
          );
        if (input.isDefault) {
          store
            .prepare(`
              UPDATE node_model_bindings
              SET is_default = 0, updated_at = ?
              WHERE node_type = ?
            `)
            .run(timestamp, input.capability);
        }
        store
          .prepare(`
            INSERT INTO node_model_bindings (
              node_type, model_id, enabled, is_default, sort_order,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            input.capability,
            id,
            input.status === "published" ? 1 : 0,
            input.isDefault ? 1 : 0,
            input.sortOrder,
            timestamp,
            timestamp,
          );
        audit(store, identity.userId, "create_model", id, {
          capability: input.capability,
          providerProfileId: input.providerProfileId,
          providerProtocol: input.providerProtocol,
          status: input.status,
        });
        store.exec("COMMIT");
      } catch (error) {
        store.exec("ROLLBACK");
        throw error;
      }
      const row = modelRows(store, identity.userId).find(
        (candidate) => candidate.id === id,
      )!;
      const availability = await modelRuntimeAvailability(
        [row],
        identity.userId,
      );
      json(response, 201, {
        model: adminModel(
          row,
          availability.get(row.id)!,
          modelLifecycleSummary(row, modelReferenceCounts(store, row.id)),
        ),
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, { error: "Model profile is invalid" });
    }
    return;
  }

  if (request.method === "PATCH" && /^[a-z0-9-]{3,80}$/i.test(path)) {
    const current = modelRows(store, identity.userId).find(
      (candidate) => candidate.id === path,
    );
    if (!current) {
      json(response, 404, { error: "Model profile not found" });
      return;
    }
    try {
      const body = await readJsonBody<{
        displayName?: unknown;
        isDefault?: unknown;
        providerModelId?: unknown;
        providerProfileId?: unknown;
        providerProtocol?: unknown;
        parameterSchema?: unknown;
        sortOrder?: unknown;
        status?: unknown;
      }>(request, 64 * 1_024);
      const nextStatus = (body.status ?? current.status) as ModelStatus;
      const input = cleanModelInput({
        capability: current.capability,
        displayName: body.displayName ?? current.display_name,
        isDefault:
          body.isDefault ??
          (nextStatus === "published" ? Boolean(current.is_default) : false),
        providerModelId: body.providerModelId ?? current.provider_model_id,
        providerProfileId: body.providerProfileId ?? current.provider_profile_id,
        providerProtocol: body.providerProtocol ?? current.provider_protocol,
        sortOrder: body.sortOrder ?? current.sort_order,
        status: nextStatus,
        parameterSchema: body.parameterSchema ?? parameterSchema(current),
      });
      const provider = store
        .prepare(`
          SELECT id, driver
          FROM provider_profiles
          WHERE id = ?
        `)
        .get(input.providerProfileId) as
          | { driver: string; id: string }
          | undefined;
      if (!provider) throw new Error("Provider profile not found");
      assertProviderModelCompatibility(
        provider.driver,
        input.providerModelId,
        input.providerProtocol,
        current.capability,
      );
      const providerChanged = input.providerProfileId !== current.provider_profile_id;
      const nextParameterSchema = body.parameterSchema ?? (providerChanged
        ? knownModelParameterSchema({
            capability: current.capability,
            providerDriver: provider.driver,
            providerModelId: input.providerModelId,
          })
        : parameterSchema(current));
      const costCurrency = provider.driver === "volcengine-ark" ? "CNY" : "USD";
      const timestamp = new Date().toISOString();
      const validatedSchema = validateParameterSchemaConstraints(
        cleanParameterSchema(
          current.capability,
          nextParameterSchema,
          knownModelParameterSchema({
            capability: current.capability,
            providerDriver: provider.driver,
            providerModelId: input.providerModelId,
          }),
        ),
        providerParameterSchema({
          capability: current.capability,
          providerDriver: provider.driver,
          providerModelId: input.providerModelId,
        }),
      );
      assertRelaySchemaCompatibility({
        capability: current.capability,
        driver: provider.driver,
        protocol: input.providerProtocol,
        schema: validatedSchema,
        status: input.status,
      });
      store.exec("BEGIN IMMEDIATE");
      try {
        assertAccountMutationAllowed(store, identity.userId);
        if (current.archived_at && input.isDefault) {
          audit(store, identity.userId, "model.update_rejected", path, {
            reason: "ARCHIVED_MODEL_CANNOT_BE_DEFAULT",
          });
          store.exec("COMMIT");
          json(response, 409, {
            code: "ARCHIVED_MODEL_CANNOT_BE_DEFAULT",
            error: "已归档模型不能设为默认，请先恢复模型",
          });
          return;
        }
        if (input.isDefault) {
          store
            .prepare(`
              UPDATE node_model_bindings
              SET is_default = 0, updated_at = ?
              WHERE node_type = ?
            `)
            .run(timestamp, current.capability);
        }
        store
          .prepare(`
            UPDATE model_profiles
            SET
              display_name = ?,
              provider_profile_id = ?,
              provider_model_id = ?,
              provider_protocol = ?,
              status = ?,
              cost_currency = ?,
              default_parameters = ?,
              updated_at = ?
            WHERE id = ?
          `)
          .run(
            input.displayName,
            input.providerProfileId,
            input.providerModelId,
            input.providerProtocol,
            input.status,
            costCurrency,
            JSON.stringify(validatedSchema),
            timestamp,
            path,
          );
        store
          .prepare(`
            UPDATE node_model_bindings
            SET
              enabled = ?,
              is_default = ?,
              sort_order = ?,
              updated_at = ?
            WHERE node_type = ? AND model_id = ?
          `)
          .run(
            input.status === "published" && !current.archived_at ? 1 : 0,
            input.status === "published" &&
                !current.archived_at && input.isDefault
              ? 1
              : 0,
            input.sortOrder,
            timestamp,
            current.capability,
            path,
          );
        audit(store, identity.userId, "update_model", path, {
          isDefault: input.isDefault,
          providerProfileId: input.providerProfileId,
          providerProtocol: input.providerProtocol,
          status: input.status,
        });
        store.exec("COMMIT");
      } catch (error) {
        store.exec("ROLLBACK");
        throw error;
      }
      const row = modelRows(store, identity.userId).find(
        (candidate) => candidate.id === path,
      )!;
      const availability = await modelRuntimeAvailability(
        [row],
        identity.userId,
      );
      json(response, 200, {
        model: adminModel(
          row,
          availability.get(row.id)!,
          modelLifecycleSummary(row, modelReferenceCounts(store, row.id)),
        ),
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, { error: "Model update is invalid" });
    }
    return;
  }

  response.setHeader("Allow", "GET, POST, PATCH, DELETE");
  json(response, 404, { error: "Model endpoint not found" });
}
