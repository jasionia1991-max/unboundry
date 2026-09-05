import { createDecipheriv, createHash, type Hash } from "node:crypto";
import {
  chmodSync,
  constants as fileConstants,
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  currentSchemaManifest,
  databaseMatchesSchema39Contract,
  databaseMatchesSchema41Contract,
  databaseMatchesSchema42Contract,
} from "./database.ts";
import { safeCanonicalAliyunOssEndpoint } from "./outboundNetwork.ts";
import {
  databaseMatchesSchema40Contract,
  databaseMatchesSchemaContract,
} from "./runtimeLifecycle.ts";

const providerDocumentAad = Buffer.from(
  "unboundry:provider-profiles:v1",
  "utf8",
);
const storageDocumentAad = Buffer.from(
  "unboundry:storage-profiles:v1",
  "utf8",
);
const accountCredentialAad = Buffer.from(
  "unboundry:account-credentials:v1",
  "utf8",
);
const maximumEncryptedDocumentBytes = 16 * 1024 * 1024;
const maximumEncryptedCredentialBytes = 256 * 1024;
const providerDrivers = new Set([
  "mureka",
  "multi-protocol-relay",
  "openai-compatible",
  "openrouter",
  "volcengine-ark",
]);
const knownMigrationNames = Object.freeze(
  currentSchemaManifest.map(({ name }) => name),
);
const supportedBackupSchemaVersions = new Set([37, 38, 39, 40, 41, 42, 43]);
const builtInProviderBaseUrls = Object.freeze({
  mureka: "https://api.mureka.ai",
  openrouter: "https://openrouter.ai/api/v1",
  "volcengine-ark": "https://ark.cn-beijing.volces.com/api/v3",
} as const);

// Frozen from the schema-37 contract at REM-003 commit 73c65db. These hashes
// cover exact sqlite_schema SQL text, including the narrowly admitted historic
// repair shapes. Schema 37 must never be checked against the additive v38
// contract because that would either reject every old package or invite an
// unsafe "missing v38 objects are okay" relaxation.
const schema37Contract = Object.freeze({
  columns: Object.freeze({
    account_permissions: Object.freeze([
      "account_id", "permission", "granted_by", "created_at",
    ]),
    account_provider_credentials: Object.freeze([
      "account_id", "provider_profile_id", "encrypted_key", "key_status",
      "key_checked_at", "credential_version", "updated_at",
    ]),
    admin_audit_events: Object.freeze([
      "id", "actor_user_id", "action", "target_user_id", "details",
      "created_at",
    ]),
    asset_history: Object.freeze([
      "account_id", "id", "kind", "label", "preview", "created_at",
      "owner_id",
    ]),
    canvas_documents: Object.freeze([
      "owner_id", "id", "revision", "nodes", "edges", "viewport",
      "updated_at", "save_session_id", "save_sequence", "graph_revision",
    ]),
    generation_provider_attempts: Object.freeze([
      "id", "task_id", "execution_attempt", "provider_profile_id",
      "provider_model_id", "kind", "evidence", "created_at", "owner_id",
    ]),
    generation_safety_settings: Object.freeze([
      "id", "global_enabled", "emergency_stop", "per_user_concurrency",
      "requests_per_minute", "image_concurrency", "video_concurrency",
      "audio_concurrency", "failure_threshold", "cooldown_minutes",
      "running_task_policy", "updated_at", "text_concurrency",
    ]),
    generation_task_events: Object.freeze([
      "id", "task_id", "state", "error_code", "error_message", "created_at",
    ]),
    generation_tasks: Object.freeze([
      "id", "canvas_id", "node_id", "kind", "prompt", "model",
      "parameters", "idempotency_key", "request_fingerprint", "state",
      "attempt", "error_code", "error_message", "created_at", "updated_at",
      "owner_id", "estimated_cost_microunits", "actual_cost_microunits",
      "provider_profile_id", "provider_model_id", "result_asset_id",
      "cost_currency", "provider_task_id", "provider_usage_tokens",
      "model_configuration", "result_text",
    ]),
    media_assets: Object.freeze([
      "kind", "id", "owner_id", "storage_name", "byte_size", "created_at",
      "updated_at", "storage_backend", "object_key", "content_type",
      "checksum_sha256", "storage_status", "duration_seconds",
      "duration_source", "duration_status", "media_width", "media_height",
      "storage_profile_id",
    ]),
    model_profiles: Object.freeze([
      "id", "display_name", "provider_profile_id", "provider_model_id",
      "capability", "status", "default_parameters", "created_at",
      "updated_at", "max_cost_microunits", "cost_currency", "archived_at",
      "published_at", "provider_protocol",
    ]),
    node_model_bindings: Object.freeze([
      "node_type", "model_id", "enabled", "is_default", "sort_order",
      "created_at", "updated_at",
    ]),
    project_metadata: Object.freeze([
      "owner_id", "id", "title", "updated_at", "is_project", "created_at",
      "deleted_at",
    ]),
    provider_profiles: Object.freeze([
      "id", "display_name", "driver", "status", "created_at", "updated_at",
      "key_status", "key_checked_at", "catalog_key_status",
      "catalog_checked_at", "catalog_synced_at", "catalog_last_error_code",
      "catalog_models", "catalog_endpoints", "catalog_model_count",
      "catalog_endpoint_count", "catalog_control_request_count",
      "catalog_credential_revision", "provider_configuration_version",
      "catalog_sync_token", "catalog_diagnostics",
    ]),
    public_templates: Object.freeze([
      "id", "title", "description", "category", "graph", "cover_asset_id",
      "preview_image", "status", "created_by", "created_at", "updated_by",
      "updated_at", "archived_at",
    ]),
    schema_migrations: Object.freeze(["version", "name", "applied_at"]),
    sessions: Object.freeze([
      "id", "token_hash", "user_id", "expires_at", "created_at",
      "last_seen_at",
    ]),
    user_templates: Object.freeze([
      "id", "owner_id", "title", "category", "graph", "cover_asset_id",
      "created_at", "updated_at",
    ]),
    users: Object.freeze([
      "id", "login_name", "display_name", "password_hash", "role", "status",
      "created_at", "updated_at", "protected",
    ]),
  }),
  tables: Object.freeze({
    account_permissions: Object.freeze(["b56c6c726385ab6f9020a6d6133c5ca90fa69c0b04cd73d03cd6aee3c6eff155"]),
    account_provider_credentials: Object.freeze(["4542efd2209893278fd8bcb73760848fa61e252ca15d0d5f526e5672dbda32cb"]),
    admin_audit_events: Object.freeze([
      "82e604628c4a2ce90c37ad6cba7f5d82fb71e6a21703d361bb03bf980730c0ce",
      "9b5cd05337e0787660d20beabbd57e55ae0384618304e74ec60410adccfe98ab",
    ]),
    asset_history: Object.freeze([
      "700ecc72764b59b1bcd84eb921cab728e5f66e8c4f2affd70a41e6a51aade6c6",
      // Exact migration-v1 indentation retained by the admitted production
      // schema-37 lineage. Semantic or whitespace normalization is forbidden.
      "0053af18d88bd9872c210fa69fba542dd7254ba0f7e6d6c736e3635e5ca65300",
    ]),
    canvas_documents: Object.freeze(["c1513fd4d7a98acd1826e952f442877b40f8395a8052b15e85479559da0cefdf"]),
    generation_provider_attempts: Object.freeze(["2e1effabd1d125941ff89256881802c56189d640eeb3c9ebc8f86c61ba7a14e2"]),
    generation_safety_settings: Object.freeze(["f40be7744655d146b2ecd0f8897b024d98a1db94a39284e53cc27d40ba9bc38c"]),
    generation_task_events: Object.freeze(["b002bdbf4f1d0d086eb7ce0f133c6fd06088c56a2f31122162f8a60cee8d3f4f"]),
    generation_tasks: Object.freeze(["c812ecc9484218c8f64ae4043848fc2b9b4b7a39a679076624960eb5b258c5a5"]),
    media_assets: Object.freeze(["cedbe47b7f996d78b4a03b8e9ec75bf08853aa2539932ad1dad657b1c47c115c"]),
    model_profiles: Object.freeze([
      "b649651de07c626a927f2184dca573844256ee3208f3b660ba36887200e11a66",
      "2ee6b6c2ee53a4106b66c19fe179292d6d55ec7feeed227eda8a1498c07ea090",
      "aabb891e26289960f0e414649d2e6f80393ffd773693cb96e3eb44d0ad716632",
      "c8d3c009843c0d1f41f12750eb52240a1ca268fb1e3ec4f3aeee8d78d49ca93e",
      "d616105a3a22b6c20bf6fdd57486dbd479e111a6e5cd940b13d1282ea48729be",
    ]),
    node_model_bindings: Object.freeze([
      "300aa2ced2205b3cd0ed723a00a604917f68603feb31ecbd12529fdd39784553",
      "7c3c7e2f42885cd3ce92c2284761bbcb99715d8f9eafe8cd575002a5a894f35a",
    ]),
    project_metadata: Object.freeze(["343804fcd2f4d99f4acab95c0e604bab64efd1f09c0a5ebb0e9df0347d14511e"]),
    provider_profiles: Object.freeze([
      "5a123ee9694b90e7bfb5cd43bcb4df3b00a367ac25974f48052068b178085809",
      // Exact historic catalog_diagnostics declaration without identifier
      // quotes. Only this observed SQL fingerprint is additionally admitted.
      "47a50d882fbf7e6c5045800b3fa66b4ddb7ccba9f1a2a0646c81ec3b816d87e2",
    ]),
    public_templates: Object.freeze([
      "dbe59ae26271823809c64e9acc2cbac41c2873de127723d746b5c3335f0423b9",
      "181a61ea6c1dd6ecadb314598b354bad1cab669bddd2057963d0d80e6eab1809",
    ]),
    schema_migrations: Object.freeze(["c1b7313cc662808476c3815653e069743817c9d0a29a423d0c7810d995d94ec7"]),
    sessions: Object.freeze(["01b47e65e5743d9b335e194619fc4b12520644e7146b935502de8f273a73cbd1"]),
    user_templates: Object.freeze(["31dbd72b7c75acde5872a24a49944e587d01546b583f5c6c12d723ca69f7f91f"]),
    users: Object.freeze([
      "3f6ff917f5c58dcceafbc36da7286b3c5b3b4ebf17959434d39e75e226a7219d",
      "80159c4cbfb80a7ef8071d04ed65acd127b62d6c434289a1b713a91cc81d7205",
    ]),
  }),
  explicitIndexes: Object.freeze({
    account_permissions_account: Object.freeze({ table: "account_permissions", hashes: Object.freeze(["667457c5faa9dfb027030e9ca7a60318d696b44775a6b7b687511734c290e864"]) }),
    admin_audit_actor_created: Object.freeze({ table: "admin_audit_events", hashes: Object.freeze(["96af96d20bc9bd30cd0edee0c9d6f065b4de5241893891c5b31dfe5723d60669", "8804ecb45ddfbc8cf9e670190989bd3a64b7dce1a579753cb26f454e5f0fc0be"]) }),
    asset_history_owner_created: Object.freeze({ table: "asset_history", hashes: Object.freeze(["8530ea7ce975418d08fb4ad4c8ef50bae408641ca5748b84bd5df7502d56e5d2"]) }),
    canvas_documents_owner_updated: Object.freeze({ table: "canvas_documents", hashes: Object.freeze(["c49d60c37be7eb32471b6a5256226ee2010cf180bd4b547f36e60a503fc7df80"]) }),
    generation_provider_attempts_owner_profile_created: Object.freeze({ table: "generation_provider_attempts", hashes: Object.freeze(["cc0a3834baee5d68a8a92b5cf00f6b0dbc6886b0355b73acfa10846ca1f9c99a"]) }),
    generation_provider_attempts_profile_kind_created: Object.freeze({ table: "generation_provider_attempts", hashes: Object.freeze(["16b559cf338f977ca119dddb8a97c090e67e68f5eb494cc7f1ec86176e27d65a"]) }),
    generation_provider_attempts_task_created: Object.freeze({ table: "generation_provider_attempts", hashes: Object.freeze(["2b48b857158465de8155dac5d69aeff3ac50daf44a3cef06dbaa0c4c799d8c7f"]) }),
    generation_task_events_task_created: Object.freeze({ table: "generation_task_events", hashes: Object.freeze(["20ee2bfe83616ee3f69c391c65a4d1831b713084000303417695df4c09ae7529"]) }),
    generation_tasks_canvas_updated: Object.freeze({ table: "generation_tasks", hashes: Object.freeze(["0f449e39429ad05e27054e89b480dfec111b1ffb213baf409e5d3e2e9b35dad8"]) }),
    generation_tasks_currency_created: Object.freeze({ table: "generation_tasks", hashes: Object.freeze(["a5cd31190264ecac91713ef770c9fce1b850fdc7577537fd5135d732f1d8ca39"]) }),
    generation_tasks_owner_canvas_updated: Object.freeze({ table: "generation_tasks", hashes: Object.freeze(["1a733ae3056e8235e4ee492f83c448aefcdaf1caa92c7a9170f1afd4b6d36842"]) }),
    generation_tasks_owner_state_created: Object.freeze({ table: "generation_tasks", hashes: Object.freeze(["4ccaf8c1a22e10bb6f03ff9c03782f2050ac1048569b774858ed3ead42363fd0"]) }),
    generation_tasks_provider_task: Object.freeze({ table: "generation_tasks", hashes: Object.freeze(["b4bc3802117bb5d5b661245fd30cc7ccdb4e7fa85d41ffa08df8421deb042485"]) }),
    generation_tasks_result_asset: Object.freeze({ table: "generation_tasks", hashes: Object.freeze(["7ad17024f45755bc24df2eeb3bf4a9c47225e8d96f83c4ab7dd90f1555c36f45"]) }),
    media_assets_backend_object_key: Object.freeze({ table: "media_assets", hashes: Object.freeze(["ada21d8be6bd9e005155da7cd938901f2da5991b6defa42b5e718b1986f9a789"]) }),
    media_assets_owner_created: Object.freeze({ table: "media_assets", hashes: Object.freeze(["566cfd24a9bdf80384f08b4544a0d7d2cb86a00e73f94b5d214188776f34460f"]) }),
    media_assets_owner_storage: Object.freeze({ table: "media_assets", hashes: Object.freeze(["795bdfac70e907fe1ff5201fcdb84a5dc9cd75ad80b4b946b4b651312f039549"]) }),
    model_profiles_archived_capability: Object.freeze({ table: "model_profiles", hashes: Object.freeze(["04aa10e58830c898de1f6c8e20951dd33efda140ab73b457da9c8ff3c87ac47e"]) }),
    model_profiles_capability_status: Object.freeze({ table: "model_profiles", hashes: Object.freeze(["0c604faba324c65236374c4d557a600beabc53551f45a286b24897af19544c22", "3416b5cb3fb2e1aeef9c518a96326675ce08d9387f7f48242c6f04b598209b62"]) }),
    model_profiles_provider_protocol: Object.freeze({ table: "model_profiles", hashes: Object.freeze(["0da6e04e559ca0cefc0c09d023a5eb022b025d251464af78ab2c42fd27a1ee4a"]) }),
    node_model_bindings_one_default: Object.freeze({ table: "node_model_bindings", hashes: Object.freeze(["82c0cf67eb17beea7e63586c25c836f403362c3059d4b8957a502f44370631f9", "21849a735c41aae7fdec38122d29146846d9030a1f170e7a699cd01f81348665"]) }),
    node_model_bindings_order: Object.freeze({ table: "node_model_bindings", hashes: Object.freeze(["c6bf5c70659e14f4d413aa98c610116751c4a80972070c78b535088432907e81", "4fbb934ed2d70e76a115ae56b06457028b92b7bb44ec4855a0395940ca35ce26"]) }),
    project_metadata_owner_updated: Object.freeze({ table: "project_metadata", hashes: Object.freeze(["1b5d9c2ac1f179e9728351fedaf1519a8b8d1509afccf71b7357dd7c148e6612"]) }),
    public_templates_status_updated: Object.freeze({ table: "public_templates", hashes: Object.freeze(["95ad36824c8d49f4b53c97a66fc36fe34c1b194d2c189722a8399968ab101f5a"]) }),
    sessions_user_expires: Object.freeze({ table: "sessions", hashes: Object.freeze(["e52358562e4cccce65828dbe358431c188e35ba2204cc4c0e53d9649cb68beb4"]) }),
    user_templates_owner_updated: Object.freeze({ table: "user_templates", hashes: Object.freeze(["451f2da493e6b738635ed059b645d2899e9b873e2802e893201de3a53e66bd68"]) }),
    users_status_role: Object.freeze({ table: "users", hashes: Object.freeze(["57a909e3331fd64620bb5264305aafa1b16b0b9f91df06889d32bafe0e65b52c"]) }),
  }),
  requiredIndexSemantics: Object.freeze({
    generation_tasks_provider_task: Object.freeze({
      columns: Object.freeze(["provider_profile_id", "provider_task_id"]),
      partial: true,
      table: "generation_tasks",
      unique: true,
    }),
    media_assets_backend_object_key: Object.freeze({
      columns: Object.freeze(["storage_backend", "object_key"]),
      partial: true,
      table: "media_assets",
      unique: true,
    }),
    node_model_bindings_one_default: Object.freeze({
      columns: Object.freeze(["node_type"]),
      partial: true,
      table: "node_model_bindings",
      unique: true,
    }),
  }),
  triggers: Object.freeze({
    archived_models_cannot_enable_binding_insert: Object.freeze({ table: "node_model_bindings", hash: "df41b6cb986c87a6cec9123e2368358127f80693ba0f56c44ac31f113097245d" }),
    archived_models_cannot_enable_binding_update: Object.freeze({ table: "node_model_bindings", hash: "acadc33d6989310e541cdfab4382725536b2a43e8874279f5bfb2de50e83634b" }),
    generation_tasks_capture_model_display_name: Object.freeze({ table: "generation_tasks", hash: "53134517eabb56121add52886258a41e864acad5ede012650e88d68440d26379" }),
    model_profiles_capture_first_publish_insert: Object.freeze({ table: "model_profiles", hash: "387ea10071a57d572ba4fbc8842eaeadc1b9451d949c91a0f8fa25cdb11743cd" }),
    model_profiles_capture_first_publish_update: Object.freeze({ table: "model_profiles", hash: "644e840c516f0d3fc56a4a7a1c936aedc02f8ba19a7c7573afc0174089c9ead9" }),
  }),
  optionalUsersIndexTableHash:
    "80159c4cbfb80a7ef8071d04ed65acd127b62d6c434289a1b713a91cc81d7205",
});

// Frozen from the exact schema-38 currentSchemaContract at commit 2beaec5.
// Migration 38 was additive, so the unchanged schema-37 objects retain their
// independently frozen fingerprints while the three durable-media tables,
// indexes and guards below close the schema-38 object set exactly. Never point
// this at currentSchemaContract: schema-38 backup packages must remain
// inspectable after the running candidate advances beyond schema 38.
const schema38Contract = Object.freeze({
  columns: Object.freeze({
    ...schema37Contract.columns,
    account_delete_intents: Object.freeze([
      "owner_id", "state", "error_code", "retry_count", "created_at",
      "updated_at",
    ]),
    media_delete_intents: Object.freeze([
      "owner_id", "kind", "asset_id", "state", "created_at", "updated_at",
    ]),
    media_publication_attempts: Object.freeze([
      "attempt_id", "owner_id", "kind", "asset_id", "source", "state",
      "storage_backend", "final_storage_name", "object_key",
      "storage_profile_id", "staging_name", "task_id",
      "task_execution_attempt", "history_label", "byte_size",
      "checksum_sha256", "content_type", "duration_seconds",
      "duration_source", "media_width", "media_height",
      "actual_cost_microunits", "provider_usage_tokens", "error_code",
      "retry_count", "adopted_at", "adopted_canvas_id", "created_at",
      "updated_at",
    ]),
  }),
  tables: Object.freeze({
    ...schema37Contract.tables,
    account_delete_intents: Object.freeze([
      "b24c9a531de8f5b8e19cf0042844cdde333fc3bbcb6be9fd5834569495603506",
    ]),
    media_delete_intents: Object.freeze([
      "11ec2869f50bb802e8ee1cfe0cc728a4650b197195c3345a48c638f838ad1cea",
    ]),
    media_publication_attempts: Object.freeze([
      "b6ec4ac1cb1db8bce63ff1cf839103d070ea77119698f4df67907a850ab09ca3",
    ]),
  }),
  explicitIndexes: Object.freeze({
    ...schema37Contract.explicitIndexes,
    media_publication_attempts_active_asset: Object.freeze({
      table: "media_publication_attempts",
      hashes: Object.freeze([
        "9a973fcbbcee9321f4b993114de33ea6b1eb7a642056bfa38bee8ba62a462448",
      ]),
    }),
    media_publication_attempts_active_task: Object.freeze({
      table: "media_publication_attempts",
      hashes: Object.freeze([
        "a93727e31eda4fe8aae75d20f877bd45a745cfba606936870fa7b06bc9f693fe",
      ]),
    }),
    media_publication_attempts_owner_state_updated: Object.freeze({
      table: "media_publication_attempts",
      hashes: Object.freeze([
        "46179b75c9f60cc6a26c99490586904ef5b3b2b168b1d89c0712adca868afeb9",
      ]),
    }),
  }),
  requiredIndexSemantics: Object.freeze({
    ...schema37Contract.requiredIndexSemantics,
    media_publication_attempts_active_asset: Object.freeze({
      columns: Object.freeze(["kind", "asset_id"]),
      partial: true,
      table: "media_publication_attempts",
      unique: true,
    }),
    media_publication_attempts_active_task: Object.freeze({
      columns: Object.freeze(["task_id", "task_execution_attempt"]),
      partial: true,
      table: "media_publication_attempts",
      unique: true,
    }),
  }),
  triggers: Object.freeze({
    ...schema37Contract.triggers,
    account_delete_guard_generation_task_activation: Object.freeze({
      table: "generation_tasks",
      hash: "10f141d8a48d7ed9dd6a16e49f3c6e956a2e70d0ab4787ee3a6181e2d0d753d3",
    }),
    account_delete_guard_generation_task_insert: Object.freeze({
      table: "generation_tasks",
      hash: "d00738c36501ba252313207a4b0643a9c5d7e25944798b1e627dee96f7654d12",
    }),
    account_delete_guard_public_template_actor_update: Object.freeze({
      table: "public_templates",
      hash: "fa2f8a2d1359e413eafc5422eac6f54c6d8cc98e217bceea3a1d99a087155dc7",
    }),
    account_delete_guard_public_template_insert: Object.freeze({
      table: "public_templates",
      hash: "80e3c565d213ff336163b47d3e74c78bac15751c7c8948edfa8a7bebf2c3bc9e",
    }),
    account_delete_guard_session_insert: Object.freeze({
      table: "sessions",
      hash: "37822025467ab8097811df9d19bad9f595975f82d4790c93ee8d9d9b85d380d6",
    }),
    account_delete_guard_user_template_insert: Object.freeze({
      table: "user_templates",
      hash: "eb9bee1e651e043eee8f345f85f3fa422125e7bfef46e89c35fa0e28efe25d0f",
    }),
    account_delete_guard_user_template_owner_update: Object.freeze({
      table: "user_templates",
      hash: "9f6c16c058d889462ea76f1d8816b55e7d4e02f004d12a92b5d0305df07f6e19",
    }),
    account_delete_guard_user_reactivation: Object.freeze({
      table: "users",
      hash: "f67ad13e59c5050e802319f9c3c9a36869715a96bb8540f03287debf948e3522",
    }),
    media_publication_guard_owner_delete: Object.freeze({
      table: "users",
      hash: "fe8f8819e746f2a7c91c5759cbe7999eb9cc4cf29cd9d57d9cf2b62d62d9781e",
    }),
    media_publication_guard_task_delete: Object.freeze({
      table: "generation_tasks",
      hash: "5e5a3d715ecfd7de6dae4f3b8a40ea0756f8d0db12da4d7916ae8867a26f15e4",
    }),
  }),
  optionalUsersIndexTableHash: schema37Contract.optionalUsersIndexTableHash,
});

type SqliteValue = bigint | Buffer | null | number | string | Uint8Array;

type SchemaObjectType = "index" | "table" | "trigger" | "view";

type FrozenSchemaContract = Readonly<{
  columns: Readonly<Record<string, readonly string[]>>;
  explicitIndexes: Readonly<Record<string, Readonly<{
    hashes: readonly string[];
    table: string;
  }>>>;
  optionalUsersIndexTableHash: string;
  requiredIndexSemantics: Readonly<Record<string, Readonly<{
    columns: readonly string[];
    partial: boolean;
    table: string;
    unique: boolean;
  }>>>;
  tables: Readonly<Record<string, readonly string[]>>;
  triggers: Readonly<Record<string, Readonly<{
    hash: string;
    table: string;
  }>>>;
}>;

export type BackupMigrationLedgerEntry = Readonly<{
  name: string;
  version: number;
}>;

export type BackupTableFingerprint = Readonly<{
  name: string;
  rowCount: string;
  sha256: string;
}>;

export type BackupDatabaseInspection = Readonly<{
  foreignKeyViolations: 0;
  integrityCheck: "ok";
  journalMode: string;
  logicalSha256: string;
  migrationLedger: readonly BackupMigrationLedgerEntry[];
  schema: Readonly<{
    objectCounts: Readonly<Record<SchemaObjectType, number>>;
    sha256: string;
  }>;
  tables: readonly BackupTableFingerprint[];
  userVersion: number;
}>;

export type BackupSecretValidation = Readonly<{
  accountCredentials: number;
  masterKeyPresent: boolean;
  providerDocumentProfiles: number;
  storageDocumentProfiles: number;
}>;

export type BackupSecretValidationContext = Readonly<{
  providerProfiles: readonly Readonly<{
    configurationVersion: number;
    driver: string;
    id: string;
    label: string;
  }>[];
  storageDocument: Readonly<{
    activeProfileId: string | null;
    mediaRoutingEnabled: boolean;
    profiles: readonly Readonly<{
      id: string;
      status: "active" | "draft" | "verified";
    }>[];
  }>;
  storageProfileIds: readonly string[];
  validation: BackupSecretValidation;
}>;

export class BackupInspectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BackupInspectionError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new BackupInspectionError(code, message);
}

function assertAbsolutePath(path: string, label: string) {
  if (!path || resolve(path) !== path) {
    fail("BACKUP_PATH_INVALID", `${label} must be an absolute normalized path`);
  }
}

function containsPath(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!isAbsolute(difference) &&
      difference !== ".." && !difference.startsWith(`..${sep}`));
}

function assertPrivateInspectionRoot(inspectionRoot: string) {
  assertAbsolutePath(inspectionRoot, "Inspection root");
  let details: ReturnType<typeof lstatSync>;
  try {
    details = lstatSync(inspectionRoot);
  } catch {
    fail("BACKUP_INSPECTION_ROOT_INVALID", "Inspection root is unavailable");
  }
  if (
    details.isSymbolicLink() ||
    !details.isDirectory() ||
    (details.mode & 0o077) !== 0
  ) {
    fail(
      "BACKUP_INSPECTION_ROOT_INVALID",
      "Inspection root must be a private regular directory",
    );
  }
  return realpathSync(inspectionRoot);
}

function assertContainedRegularPath(
  path: string,
  inspectionRoot: string,
  kind: "directory" | "file",
  label: string,
) {
  assertAbsolutePath(path, label);
  const realRoot = assertPrivateInspectionRoot(inspectionRoot);
  let realPath: string;
  try {
    realPath = realpathSync(path);
  } catch {
    fail("BACKUP_INSPECTION_PATH_INVALID", `${label} is unavailable`);
  }
  if (!containsPath(realRoot, realPath)) {
    fail(
      "BACKUP_INSPECTION_PATH_OUTSIDE_ROOT",
      `${label} must stay inside the private inspection root`,
    );
  }
  const rootInput = resolve(inspectionRoot);
  let current = resolve(path);
  while (current !== rootInput) {
    const details = lstatSync(current);
    if (details.isSymbolicLink()) {
      fail("BACKUP_INSPECTION_LINK_REJECTED", `${label} may not use links`);
    }
    current = dirname(current);
    if (!containsPath(rootInput, current)) {
      fail("BACKUP_INSPECTION_PATH_OUTSIDE_ROOT", `${label} escaped its root`);
    }
  }
  const details = lstatSync(path);
  const valid = kind === "file" ? details.isFile() : details.isDirectory();
  if (details.isSymbolicLink() || !valid) {
    fail("BACKUP_INSPECTION_PATH_INVALID", `${label} has the wrong type`);
  }
}

function assertRegularDatabasePath(
  databasePath: string,
  inspectionRoot: string,
) {
  assertAbsolutePath(databasePath, "Database path");
  assertContainedRegularPath(
    databasePath,
    inspectionRoot,
    "file",
    "Database path",
  );
  let details: ReturnType<typeof lstatSync>;
  try {
    details = lstatSync(databasePath);
  } catch {
    fail("BACKUP_DATABASE_UNAVAILABLE", "Backup database is unavailable");
  }
  if (details.isSymbolicLink() || !details.isFile()) {
    fail(
      "BACKUP_DATABASE_FILE_INVALID",
      "Backup database must be a regular non-symbolic file",
    );
  }
  for (const suffix of ["-journal", "-shm", "-wal"]) {
    try {
      lstatSync(`${databasePath}${suffix}`);
      fail(
        "BACKUP_DATABASE_SIDECAR_REJECTED",
        "Inspection requires a standalone SQLite snapshot",
      );
    } catch (error) {
      if (
        error instanceof BackupInspectionError ||
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) throw error;
    }
  }
}

function quoteIdentifier(identifier: string) {
  if (!identifier || identifier.includes("\0")) {
    fail("BACKUP_DATABASE_IDENTIFIER_INVALID", "Invalid SQLite identifier");
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function lengthPrefix(length: number) {
  if (!Number.isSafeInteger(length) || length < 0) {
    fail("BACKUP_DATABASE_VALUE_INVALID", "Invalid SQLite value length");
  }
  const result = Buffer.allocUnsafe(8);
  result.writeBigUInt64BE(BigInt(length));
  return result;
}

function typedValue(value: unknown) {
  let tag: number;
  let bytes: Buffer;
  if (value === null) {
    tag = 0;
    bytes = Buffer.alloc(0);
  } else if (typeof value === "bigint") {
    tag = 1;
    bytes = Buffer.from(value.toString(10), "ascii");
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("BACKUP_DATABASE_VALUE_INVALID", "Non-finite SQLite number");
    }
    tag = 2;
    bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
  } else if (typeof value === "string") {
    tag = 3;
    bytes = Buffer.from(value, "utf8");
  } else if (Buffer.isBuffer(value)) {
    tag = 4;
    bytes = value;
  } else if (value instanceof Uint8Array) {
    tag = 4;
    bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } else {
    fail("BACKUP_DATABASE_VALUE_INVALID", "Unsupported SQLite value type");
  }
  return Buffer.concat([Buffer.from([tag]), lengthPrefix(bytes.length), bytes]);
}

function updateTypedValue(hash: Hash, value: unknown) {
  let tag: number;
  let bytes: Buffer;
  if (value === null) {
    tag = 0;
    bytes = Buffer.alloc(0);
  } else if (typeof value === "bigint") {
    tag = 1;
    bytes = Buffer.from(value.toString(10), "ascii");
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("BACKUP_DATABASE_VALUE_INVALID", "Non-finite SQLite number");
    }
    tag = 2;
    bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
  } else if (typeof value === "string") {
    tag = 3;
    bytes = Buffer.from(value, "utf8");
  } else if (Buffer.isBuffer(value)) {
    tag = 4;
    bytes = value;
  } else if (value instanceof Uint8Array) {
    tag = 4;
    bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } else {
    fail("BACKUP_DATABASE_VALUE_INVALID", "Unsupported SQLite value type");
  }
  hash.update(Buffer.from([tag]));
  hash.update(lengthPrefix(bytes.length));
  hash.update(bytes);
}

function rowSha256(values: readonly unknown[]) {
  const hash = createHash("sha256");
  hash.update(lengthPrefix(values.length));
  for (const value of values) updateTypedValue(hash, value);
  return hash.digest("hex");
}

function hashSortedRows(rows: readonly (readonly unknown[])[]) {
  const rowHashes = rows.map(rowSha256).sort();
  return hashSortedRowDigests(rowHashes);
}

function hashSortedRowDigests(rowHashes: string[]) {
  rowHashes.sort();
  const hash = createHash("sha256");
  hash.update(lengthPrefix(rowHashes.length));
  for (const rowHash of rowHashes) hash.update(Buffer.from(rowHash, "hex"));
  return hash.digest("hex");
}

function statementRows(database: DatabaseSync, sql: string) {
  const statement = database.prepare(sql);
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  return statement.all() as unknown as SqliteValue[][];
}

function safeInteger(value: unknown, label: string) {
  if (typeof value !== "bigint" && typeof value !== "number") {
    fail("BACKUP_DATABASE_METADATA_INVALID", `${label} is invalid`);
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    fail("BACKUP_DATABASE_METADATA_INVALID", `${label} is invalid`);
  }
  return numeric;
}

function scalar(database: DatabaseSync, sql: string, label: string) {
  const rows = statementRows(database, sql);
  if (rows.length !== 1 || rows[0]?.length !== 1) {
    fail("BACKUP_DATABASE_METADATA_INVALID", `${label} is unavailable`);
  }
  return rows[0][0];
}

function schemaSqlSha256(sql: unknown) {
  if (typeof sql !== "string" || !sql) return "";
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function sameSortedNames(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length &&
    actual.every((name, index) => name === expected[index]);
}

function schemaObjectNames(
  database: DatabaseSync,
  type: SchemaObjectType,
  explicitOnly = false,
) {
  const statement = database.prepare(
    `
      SELECT name
      FROM sqlite_schema
      WHERE
        type = ?
        AND name NOT LIKE 'sqlite_%'
        ${explicitOnly ? "AND sql IS NOT NULL" : ""}
      ORDER BY name
    `,
  );
  statement.setReturnArrays(true);
  return (statement.all(type) as unknown as unknown[][]).map((row) =>
    typeof row[0] === "string" ? row[0] : ""
  );
}

function schemaObject(
  database: DatabaseSync,
  type: SchemaObjectType,
  name: string,
) {
  const statement = database.prepare(`
    SELECT tbl_name, sql
    FROM sqlite_schema
    WHERE type = ? AND name = ?
  `);
  statement.setReturnArrays(true);
  const rows = statement.all(type, name) as unknown as unknown[][];
  if (rows.length !== 1) return undefined;
  return {
    sql: rows[0]?.[1],
    table: rows[0]?.[0],
  };
}

function databaseMatchesFrozenSchemaContract(
  database: DatabaseSync,
  contract: FrozenSchemaContract,
) {
  const expectedTableNames = Object.keys(contract.tables).sort();
  if (!sameSortedNames(
    schemaObjectNames(database, "table"),
    expectedTableNames,
  )) return false;
  for (const name of expectedTableNames) {
    const object = schemaObject(database, "table", name);
    const acceptedHashes = contract.tables[name] ?? [];
    const expectedColumns = [...(contract.columns[name] ?? [])].sort();
    const actualColumns = (database.prepare(
      `PRAGMA table_xinfo(${quoteIdentifier(name)})`,
    ).all() as Array<{ name?: unknown }>).map((column) =>
      String(column.name)
    ).sort();
    if (
      object?.table !== name ||
      !sameSortedNames(actualColumns, expectedColumns) ||
      !acceptedHashes.includes(schemaSqlSha256(object.sql))
    ) return false;
  }

  const users = schemaObject(database, "table", "users");
  const omitHistoricUsersIndex = schemaSqlSha256(users?.sql) ===
    contract.optionalUsersIndexTableHash;
  const expectedIndexNames = Object.keys(contract.explicitIndexes)
    .sort();
  const requiredIndexNames = expectedIndexNames
    .filter((name) => name !== "users_status_role" || !omitHistoricUsersIndex)
    .sort();
  const actualIndexNames = schemaObjectNames(database, "index", true);
  if (
    actualIndexNames.some((name) => !expectedIndexNames.includes(name)) ||
    requiredIndexNames.some((name) => !actualIndexNames.includes(name))
  ) return false;
  for (const name of actualIndexNames) {
    const object = schemaObject(database, "index", name);
    const indexContract = contract.explicitIndexes[name];
    if (
      !indexContract ||
      object?.table !== indexContract.table ||
      !indexContract.hashes.includes(
        schemaSqlSha256(object.sql),
      )
    ) return false;
  }

  for (const [name, indexContract] of Object.entries(
    contract.requiredIndexSemantics,
  )) {
    const index = (database.prepare(
      `PRAGMA index_list(${quoteIdentifier(indexContract.table)})`,
    ).all() as Array<{
      name?: unknown;
      partial?: unknown;
      unique?: unknown;
    }>).find((candidate) => String(candidate.name) === name);
    if (
      !index ||
      Boolean(Number(index.unique)) !== indexContract.unique ||
      Boolean(Number(index.partial)) !== indexContract.partial
    ) return false;
    const columns = (database.prepare(
      `PRAGMA index_xinfo(${quoteIdentifier(name)})`,
    ).all() as Array<{ key?: unknown; name?: unknown }>).filter(
      (column) => Number(column.key) === 1,
    ).map((column) => String(column.name));
    if (!sameSortedNames(columns, indexContract.columns)) return false;
  }

  const expectedTriggerNames = Object.keys(contract.triggers).sort();
  if (!sameSortedNames(
    schemaObjectNames(database, "trigger"),
    expectedTriggerNames,
  )) return false;
  for (const name of expectedTriggerNames) {
    const object = schemaObject(database, "trigger", name);
    const triggerContract = contract.triggers[name];
    if (
      !triggerContract ||
      object?.table !== triggerContract.table ||
      schemaSqlSha256(object.sql) !== triggerContract.hash
    ) return false;
  }

  return schemaObjectNames(database, "view").length === 0;
}

export function databaseMatchesFrozenSchema37Contract(database: DatabaseSync) {
  return databaseMatchesFrozenSchemaContract(database, schema37Contract);
}

export function databaseMatchesFrozenSchema38Contract(database: DatabaseSync) {
  return databaseMatchesFrozenSchemaContract(database, schema38Contract);
}

function inspectMigrationLedger(
  database: DatabaseSync,
  userVersion: number,
): BackupMigrationLedgerEntry[] {
  const ledgerTable = statementRows(
    database,
    `
      SELECT COUNT(*)
      FROM sqlite_schema
      WHERE type = 'table' AND name = 'schema_migrations'
    `,
  );
  if (ledgerTable[0]?.[0] !== 1n) {
    fail(
      "BACKUP_MIGRATION_LEDGER_MISSING",
      "Database migration ledger is missing",
    );
  }
  const rows = statementRows(
    database,
    "SELECT version, name FROM schema_migrations ORDER BY version",
  );
  if (rows.length !== userVersion) {
    fail(
      "BACKUP_MIGRATION_LEDGER_INCOMPLETE",
      "Database migration ledger does not match user_version",
    );
  }
  if (userVersion > knownMigrationNames.length) {
    fail(
      "BACKUP_MIGRATION_LEDGER_UNKNOWN",
      "Database migration ledger contains an unknown future version",
    );
  }
  return rows.map((row, index) => {
    const version = safeInteger(row[0], "Migration version");
    const name = typeof row[1] === "string" ? row[1] : "";
    if (
      version !== index + 1 ||
      !name.trim() ||
      name !== knownMigrationNames[index]
    ) {
      fail(
        "BACKUP_MIGRATION_LEDGER_INVALID",
        "Database migration ledger is not contiguous",
      );
    }
    return Object.freeze({ name, version });
  });
}

function inspectSchema(database: DatabaseSync) {
  const rows = statementRows(
    database,
    `
      SELECT type, name, tbl_name, sql
      FROM sqlite_schema
      WHERE type IN ('table', 'index', 'trigger', 'view')
      ORDER BY type, name
    `,
  );
  const objectCounts: Record<SchemaObjectType, number> = {
    index: 0,
    table: 0,
    trigger: 0,
    view: 0,
  };
  for (const row of rows) {
    const type = row[0];
    if (
      type !== "index" &&
      type !== "table" &&
      type !== "trigger" &&
      type !== "view"
    ) {
      fail("BACKUP_DATABASE_SCHEMA_INVALID", "Unknown SQLite schema object");
    }
    objectCounts[type] += 1;
  }
  return Object.freeze({
    objectCounts: Object.freeze(objectCounts),
    sha256: hashSortedRows(rows),
  });
}

function inspectTables(
  database: DatabaseSync,
  inspectionRoot: string,
): BackupTableFingerprint[] {
  const tableNames = statementRows(
    database,
    `
      SELECT name
      FROM sqlite_schema
      WHERE
        type = 'table'
        AND (name NOT LIKE 'sqlite_%' OR name = 'sqlite_sequence')
      ORDER BY name
    `,
  ).map((row) => {
    if (typeof row[0] !== "string") {
      fail("BACKUP_DATABASE_SCHEMA_INVALID", "Invalid SQLite table name");
    }
    return row[0];
  });

  const sortRoot = mkdtempSync(join(inspectionRoot, ".backup-row-sort-"));
  chmodSync(sortRoot, 0o700);
  let sorter: DatabaseSync | undefined;
  try {
    sorter = new DatabaseSync(join(sortRoot, "rows.sqlite"));
    sorter.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA temp_store = FILE;
      CREATE TABLE row_digests (digest BLOB NOT NULL);
    `);
    const insert = sorter.prepare(
      "INSERT INTO row_digests (digest) VALUES (?)",
    );
    return tableNames.map((name) => {
      sorter!.exec("DELETE FROM row_digests; BEGIN IMMEDIATE");
      let committed = false;
      let rowCount = 0n;
      try {
        const statement = database.prepare(
          `SELECT * FROM ${quoteIdentifier(name)}`,
        );
        statement.setReadBigInts(true);
        statement.setReturnArrays(true);
        for (const row of statement.iterate() as Iterable<unknown[]>) {
          insert.run(Buffer.from(rowSha256(row), "hex"));
          rowCount += 1n;
        }
        sorter!.exec("COMMIT");
        committed = true;
      } finally {
        if (!committed && sorter!.isTransaction) sorter!.exec("ROLLBACK");
      }
      const hash = createHash("sha256");
      hash.update(lengthPrefix(Number(rowCount)));
      const sorted = sorter!.prepare(
        "SELECT digest FROM row_digests ORDER BY digest",
      );
      sorted.setReturnArrays(true);
      for (const row of sorted.iterate() as Iterable<unknown[]>) {
        const digest = row[0];
        if (
          (!(Buffer.isBuffer(digest) || digest instanceof Uint8Array)) ||
          digest.byteLength !== 32
        ) {
          fail("BACKUP_DATABASE_VALUE_INVALID", "Invalid row digest");
        }
        hash.update(digest);
      }
      return Object.freeze({
        name,
        rowCount: rowCount.toString(10),
        sha256: hash.digest("hex"),
      });
    });
  } finally {
    sorter?.close();
    rmSync(sortRoot, { force: true, recursive: true });
  }
}

function logicalSha256(input: {
  migrationLedger: readonly BackupMigrationLedgerEntry[];
  schema: BackupDatabaseInspection["schema"];
  tables: readonly BackupTableFingerprint[];
  userVersion: number;
}) {
  const hash = createHash("sha256");
  hash.update(typedValue(BigInt(input.userVersion)));
  for (const migration of input.migrationLedger) {
    hash.update(typedValue(BigInt(migration.version)));
    hash.update(typedValue(migration.name));
  }
  hash.update(Buffer.from(input.schema.sha256, "hex"));
  for (const table of input.tables) {
    hash.update(typedValue(table.name));
    hash.update(typedValue(BigInt(table.rowCount)));
    hash.update(Buffer.from(table.sha256, "hex"));
  }
  return hash.digest("hex");
}

/** Inspect an open database without migrating, checkpointing, or repairing it. */
function inspectOpenBackupDatabase(
  database: DatabaseSync,
  inspectionRoot: string,
): BackupDatabaseInspection {
  assertPrivateInspectionRoot(inspectionRoot);
  try {
    const integrityRows = statementRows(database, "PRAGMA integrity_check");
    if (
      integrityRows.length !== 1 ||
      integrityRows[0]?.length !== 1 ||
      integrityRows[0][0] !== "ok"
    ) {
      fail(
        "BACKUP_DATABASE_INTEGRITY_FAILED",
        "Backup database integrity check failed",
      );
    }
    const foreignKeyRows = statementRows(database, "PRAGMA foreign_key_check");
    if (foreignKeyRows.length !== 0) {
      fail(
        "BACKUP_DATABASE_FOREIGN_KEY_FAILED",
        "Backup database contains foreign-key violations",
      );
    }
    const userVersion = safeInteger(
      scalar(database, "PRAGMA user_version", "user_version"),
      "user_version",
    );
    if (userVersion < 1) {
      fail(
        "BACKUP_DATABASE_VERSION_INVALID",
        "Backup database user_version is invalid",
      );
    }
    if (!supportedBackupSchemaVersions.has(userVersion)) {
      fail(
        "BACKUP_DATABASE_VERSION_UNSUPPORTED",
        "Backup database version is not supported by this candidate",
      );
    }
    const journalModeValue = scalar(
      database,
      "PRAGMA journal_mode",
      "journal_mode",
    );
    if (typeof journalModeValue !== "string" || !journalModeValue) {
      fail(
        "BACKUP_DATABASE_METADATA_INVALID",
        "Backup database journal_mode is invalid",
      );
    }
    const migrationLedger = inspectMigrationLedger(database, userVersion);
    const schemaMatches = userVersion === 37
      ? databaseMatchesFrozenSchema37Contract(database)
      : userVersion === 38
      ? databaseMatchesFrozenSchema38Contract(database)
      : userVersion === 39
      ? databaseMatchesSchema39Contract(database)
      : userVersion === 40
      ? databaseMatchesSchema40Contract(database)
      : userVersion === 41
      ? databaseMatchesSchema41Contract(database)
      : userVersion === 42
      ? databaseMatchesSchema42Contract(database)
      : databaseMatchesSchemaContract(database);
    if (!schemaMatches) {
      fail(
        "BACKUP_DATABASE_SCHEMA_UNSUPPORTED",
        "Backup database physical schema is not admitted by this candidate",
      );
    }
    const schema = inspectSchema(database);
    const tables = inspectTables(database, inspectionRoot);
    return Object.freeze({
      foreignKeyViolations: 0 as const,
      integrityCheck: "ok" as const,
      journalMode: journalModeValue,
      logicalSha256: logicalSha256({
        migrationLedger,
        schema,
        tables,
        userVersion,
      }),
      migrationLedger: Object.freeze(migrationLedger),
      schema,
      tables: Object.freeze(tables),
      userVersion,
    });
  } catch (error) {
    if (error instanceof BackupInspectionError) throw error;
    fail("BACKUP_DATABASE_INSPECTION_FAILED", "Backup database inspection failed");
  }
  fail("BACKUP_DATABASE_INSPECTION_FAILED", "Backup database inspection failed");
}

/**
 * Inspect an already-open database while its caller owns the source write lock.
 * The caller owns the transaction and connection lifetime. This is deliberately
 * separate from inspectBackupDatabase so a final-candidate backup can prove the
 * exact source contract after BEGIN IMMEDIATE, without opening a second live
 * source connection or releasing the lock before the private snapshot exists.
 */
export function inspectLockedBackupDatabase(
  database: DatabaseSync,
  inspectionRoot: string,
): BackupDatabaseInspection {
  if (!database.isTransaction) {
    fail(
      "BACKUP_DATABASE_WRITE_LOCK_REQUIRED",
      "Locked backup inspection requires an active SQLite transaction",
    );
  }
  return inspectOpenBackupDatabase(database, inspectionRoot);
}

export function inspectBackupDatabase(
  databasePath: string,
  inspectionRoot: string,
): BackupDatabaseInspection {
  assertRegularDatabasePath(databasePath, inspectionRoot);
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
  } catch {
    fail("BACKUP_DATABASE_UNAVAILABLE", "Backup database could not be opened");
  }
  try {
    database.exec("BEGIN");
    return inspectOpenBackupDatabase(database, inspectionRoot);
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
  }
}

async function assertRegularTree(directory: string) {
  let root;
  try {
    root = await lstat(directory);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) return false;
    throw error;
  }
  if (root.isSymbolicLink() || !root.isDirectory()) {
    fail(
      "BACKUP_SECRETS_DIRECTORY_INVALID",
      "Secrets path must be a regular directory",
    );
  }
  let directories = 1;
  let files = 0;
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const details = await lstat(path);
      if (details.isSymbolicLink()) {
        fail("BACKUP_SECRET_LINK_REJECTED", "Secrets may not contain links");
      }
      if (details.isDirectory()) {
        directories += 1;
        if (directories > 32) {
          fail(
            "BACKUP_SECRETS_TREE_TOO_LARGE",
            "Secrets directory contains too many directories",
          );
        }
        await visit(path);
      } else if (!details.isFile()) {
        fail(
          "BACKUP_SECRET_SPECIAL_FILE_REJECTED",
          "Secrets may contain only regular files and directories",
        );
      } else {
        files += 1;
        if (files > 64) {
          fail(
            "BACKUP_SECRETS_TREE_TOO_LARGE",
            "Secrets directory contains too many files",
          );
        }
      }
    }
  }
  await visit(directory);
  return true;
}

async function readOptionalRegularFile(path: string, maximumBytes: number) {
  let before;
  try {
    before = await lstat(path, { bigint: true });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) return undefined;
    throw error;
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    fail("BACKUP_SECRET_FILE_INVALID", "Secret must be a regular file");
  }
  if (before.size > BigInt(maximumBytes)) {
    fail("BACKUP_SECRET_FILE_TOO_LARGE", "Secret file exceeds its safe limit");
  }
  const noFollow = "O_NOFOLLOW" in fileConstants
    ? fileConstants.O_NOFOLLOW
    : 0;
  const handle = await open(path, fileConstants.O_RDONLY | noFollow);
  let value: Buffer | undefined;
  let overflowProbe: Buffer | undefined;
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      fail("BACKUP_SECRET_FILE_CHANGED", "Secret file changed while opening");
    }
    if (opened.size > BigInt(maximumBytes)) {
      fail("BACKUP_SECRET_FILE_TOO_LARGE", "Secret file exceeds its safe limit");
    }
    value = Buffer.alloc(Number(opened.size));
    let position = 0;
    while (position < value.length) {
      const { bytesRead } = await handle.read(
        value,
        position,
        value.length - position,
        position,
      );
      if (!bytesRead) {
        fail("BACKUP_SECRET_FILE_CHANGED", "Secret file ended while reading");
      }
      position += bytesRead;
    }
    overflowProbe = Buffer.allocUnsafe(1);
    if ((await handle.read(overflowProbe, 0, 1, value.length)).bytesRead !== 0) {
      fail("BACKUP_SECRET_FILE_TOO_LARGE", "Secret file expanded past its limit");
    }
    const after = await handle.stat({ bigint: true });
    if (
      BigInt(value.length) !== opened.size ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino
    ) {
      fail("BACKUP_SECRET_FILE_CHANGED", "Secret file changed while reading");
    }
    return value;
  } catch (error) {
    value?.fill(0);
    throw error;
  } finally {
    overflowProbe?.fill(0);
    await handle.close();
  }
}

function canonicalBase64(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    fail("BACKUP_SECRET_ENCODING_INVALID", `${label} is not canonical base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    decoded.fill(0);
    fail("BACKUP_SECRET_ENCODING_INVALID", `${label} is not canonical base64`);
  }
  return decoded;
}

function decryptGcm(
  key: Buffer,
  aad: Buffer,
  iv: Buffer,
  tag: Buffer,
  ciphertext: Buffer,
) {
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    fail("BACKUP_SECRET_CIPHERTEXT_INVALID", "Encrypted secret is malformed");
  }
  let updated: Buffer | undefined;
  let finalized: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, {
      authTagLength: 16,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    updated = decipher.update(ciphertext);
    finalized = decipher.final();
    const plaintext = Buffer.concat([updated, finalized]);
    updated.fill(0);
    finalized.fill(0);
    return plaintext;
  } catch {
    updated?.fill(0);
    finalized?.fill(0);
    fail(
      "BACKUP_SECRET_AUTHENTICATION_FAILED",
      "Encrypted secret authentication failed",
    );
  }
}

function canonicalIsoTimestamp(value: unknown) {
  return typeof value === "string" && value.length <= 40 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validProviderBaseUrl(driver: string, value: unknown) {
  if (typeof value !== "string" || value.length < 1 || value.length > 300) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const canonical = value.replace(/\/+$/, "");
  if (
    value !== value.trim() || value !== canonical || url.protocol !== "https:" ||
    Boolean(url.username) || Boolean(url.password) || Boolean(url.search) ||
    Boolean(url.hash) || !/^[a-z0-9.-]+$/i.test(url.hostname)
  ) return false;
  const builtIn = builtInProviderBaseUrls[
    driver as keyof typeof builtInProviderBaseUrls
  ];
  return builtIn === undefined || canonical === builtIn;
}

function validProviderSecretProfile(value: Record<string, unknown>) {
  return typeof value.label === "string" && value.label === value.label.trim() &&
    value.label.length >= 1 && value.label.length <= 40 &&
    validProviderBaseUrl(String(value.driver), value.baseUrl) &&
    canonicalIsoTimestamp(value.createdAt) &&
    canonicalIsoTimestamp(value.updatedAt);
}

function validStorageSecretProfile(value: Record<string, unknown>) {
  if (
    value.provider !== "aliyun-oss" || typeof value.label !== "string" ||
    value.label !== value.label.trim() || value.label.length < 1 ||
    value.label.length > 40 || typeof value.endpoint !== "string" ||
    typeof value.region !== "string" || typeof value.bucket !== "string" ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value.bucket) ||
    typeof value.accessKeyId !== "string" || value.accessKeyId.length < 8 ||
    /\s/.test(value.accessKeyId) || typeof value.accessKeySecret !== "string" ||
    value.accessKeySecret.length < 8 || /\s/.test(value.accessKeySecret) ||
    !canonicalIsoTimestamp(value.createdAt) ||
    !canonicalIsoTimestamp(value.updatedAt) ||
    value.lastVerifiedAt !== undefined &&
      !canonicalIsoTimestamp(value.lastVerifiedAt)
  ) return false;
  try {
    safeCanonicalAliyunOssEndpoint(value.endpoint, value.region);
    return true;
  } catch {
    return false;
  }
}

async function validateEncryptedDocument(
  path: string,
  key: Buffer | undefined,
  aad: Buffer,
  kind: "provider" | "storage",
) {
  const encoded = await readOptionalRegularFile(
    path,
    maximumEncryptedDocumentBytes,
  );
  if (!encoded) {
    return Object.freeze({
      activeProfileId: null,
      documentPresent: false,
      mediaRoutingEnabled: false,
      profileIds: Object.freeze([] as string[]),
      providerProfiles: Object.freeze([] as Array<{
        configurationVersion: number;
        driver: string;
        id: string;
        label: string;
      }>),
      profiles: 0,
      storageProfiles: Object.freeze([] as Array<{
        id: string;
        status: "active" | "draft" | "verified";
      }>),
    });
  }
  let iv: Buffer | undefined;
  let tag: Buffer | undefined;
  let ciphertext: Buffer | undefined;
  let plaintext: Buffer | undefined;
  try {
    if (!key) {
      fail(
        "BACKUP_SECRET_MASTER_KEY_MISSING",
        "Encrypted secret document has no master key",
      );
    }
    let document: unknown;
    try {
      document = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(encoded),
      );
    } catch {
      fail("BACKUP_SECRET_DOCUMENT_INVALID", "Encrypted secret document is invalid");
    }
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      fail("BACKUP_SECRET_DOCUMENT_INVALID", "Encrypted secret document is invalid");
    }
    const encrypted = document as Record<string, unknown>;
    if (encrypted.version !== 1) {
      fail("BACKUP_SECRET_DOCUMENT_INVALID", "Encrypted secret version is invalid");
    }
    iv = canonicalBase64(encrypted.iv, "Secret IV");
    tag = canonicalBase64(encrypted.tag, "Secret tag");
    ciphertext = canonicalBase64(encrypted.ciphertext, "Secret ciphertext");
    plaintext = decryptGcm(key, aad, iv, tag, ciphertext);
    let decrypted: unknown;
    try {
      decrypted = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
      );
    } catch {
      fail("BACKUP_SECRET_PLAINTEXT_INVALID", "Decrypted secret document is invalid");
    }
    if (!decrypted || typeof decrypted !== "object" || Array.isArray(decrypted)) {
      fail("BACKUP_SECRET_PLAINTEXT_INVALID", "Decrypted secret document is invalid");
    }
    const content = decrypted as Record<string, unknown>;
    if (
      content.version !== 1 ||
      !Array.isArray(content.profiles) ||
      content.profiles.some(
        (profile) => !profile || typeof profile !== "object" || Array.isArray(profile),
      )
    ) {
      fail("BACKUP_SECRET_PLAINTEXT_INVALID", "Decrypted secret document is invalid");
    }
    const profileIds = content.profiles.map((profile) => {
      const id = (profile as Record<string, unknown>).id;
      if (typeof id !== "string" || !id || id.length > 120) {
        return fail(
          "BACKUP_SECRET_PLAINTEXT_INVALID",
          "Decrypted secret document is invalid",
        );
      }
      return id;
    }).sort((left, right) => left.localeCompare(right));
    if (new Set(profileIds).size !== profileIds.length) {
      fail(
        "BACKUP_SECRET_PLAINTEXT_INVALID",
        "Decrypted secret document is invalid",
      );
    }
    const providerProfiles = kind === "provider"
      ? content.profiles.map((profile) => {
          const value = profile as Record<string, unknown>;
          const configurationVersion = value.configurationVersion === undefined
            ? 1
            : value.configurationVersion;
          if (
            typeof value.driver !== "string" ||
            !providerDrivers.has(value.driver) ||
            !Number.isSafeInteger(configurationVersion) ||
            Number(configurationVersion) < 1 ||
            !validProviderSecretProfile(value)
          ) {
            fail(
              "BACKUP_SECRET_PLAINTEXT_INVALID",
              "Provider secret metadata is invalid",
            );
          }
          return Object.freeze({
            configurationVersion: Number(configurationVersion),
            driver: value.driver,
            id: value.id as string,
            label: value.label as string,
          });
        }).sort((left, right) => left.id.localeCompare(right.id))
      : [];
    const storageProfiles = kind === "storage"
      ? content.profiles.map((profile) => {
          const value = profile as Record<string, unknown>;
          if (
            !new Set(["active", "draft", "verified"]).has(String(value.status)) ||
            !validStorageSecretProfile(value)
          ) {
            fail(
              "BACKUP_SECRET_PLAINTEXT_INVALID",
              "Storage secret metadata is invalid",
            );
          }
          return Object.freeze({
            id: value.id as string,
            status: value.status as "active" | "draft" | "verified",
          });
        }).sort((left, right) => left.id.localeCompare(right.id))
      : [];
    const activeProfileId = kind === "storage" &&
        content.activeProfileId !== undefined
      ? content.activeProfileId
      : null;
    if (
      activeProfileId !== null &&
      (typeof activeProfileId !== "string" || !profileIds.includes(activeProfileId))
    ) {
      fail(
        "BACKUP_SECRET_PLAINTEXT_INVALID",
        "Active storage profile metadata is invalid",
      );
    }
    if (
      kind === "storage" &&
      content.mediaRoutingEnabled !== undefined &&
      typeof content.mediaRoutingEnabled !== "boolean"
    ) {
      fail(
        "BACKUP_SECRET_PLAINTEXT_INVALID",
        "Storage routing metadata is invalid",
      );
    }
    return Object.freeze({
      activeProfileId: activeProfileId as string | null,
      documentPresent: true,
      mediaRoutingEnabled: kind === "storage" &&
        content.mediaRoutingEnabled === true,
      profileIds: Object.freeze(profileIds),
      providerProfiles: Object.freeze(providerProfiles),
      profiles: content.profiles.length,
      storageProfiles: Object.freeze(storageProfiles),
    });
  } finally {
    encoded.fill(0);
    iv?.fill(0);
    tag?.fill(0);
    ciphertext?.fill(0);
    plaintext?.fill(0);
  }
}

function validateSecretDatabaseAlignment(
  database: DatabaseSync,
  providerDocument: Awaited<ReturnType<typeof validateEncryptedDocument>>,
  storageDocument: Awaited<ReturnType<typeof validateEncryptedDocument>>,
  masterKeyPresent: boolean,
) {
  if (
    !masterKeyPresent ||
    !providerDocument.documentPresent ||
    !storageDocument.documentPresent
  ) {
    fail(
      "BACKUP_SECRET_ALIGNMENT_INCOMPLETE",
      "Final-candidate source requires the existing master key and both secret documents",
    );
  }
  const providerRows = statementRows(database, `
    SELECT id, display_name, driver, provider_configuration_version, status
    FROM provider_profiles
    ORDER BY id
  `);
  const schemaSentinelRows = providerRows.filter((row) =>
    row[0] === "provider-unconfigured"
  );
  if (
    schemaSentinelRows.length !== 1 ||
    schemaSentinelRows[0]?.[1] !== "尚未接入 Provider" ||
    schemaSentinelRows[0]?.[2] !== "unconfigured" ||
    schemaSentinelRows[0]?.[3] !== 0n ||
    schemaSentinelRows[0]?.[4] !== "disabled"
  ) {
    fail(
      "BACKUP_PROVIDER_DOCUMENT_MISMATCH",
      "Schema-owned unconfigured Provider metadata is missing or changed",
    );
  }
  const configuredProviderRows = providerRows.filter((row) =>
    row[0] !== "provider-unconfigured"
  );
  if (
    configuredProviderRows.length !== providerDocument.providerProfiles.length
  ) {
    fail(
      "BACKUP_PROVIDER_DOCUMENT_MISMATCH",
      "Provider secret profiles do not exactly match SQLite metadata",
    );
  }
  configuredProviderRows.forEach((row, index) => {
    const profile = providerDocument.providerProfiles[index];
    if (
      !profile ||
      row[0] !== profile.id ||
      row[1] !== profile.label ||
      row[2] !== profile.driver ||
      row[3] !== BigInt(profile.configurationVersion) ||
      (row[4] !== "disabled" && row[4] !== "enabled")
    ) {
      fail(
        "BACKUP_PROVIDER_DOCUMENT_MISMATCH",
        "Provider secret profiles do not exactly match SQLite metadata",
      );
    }
  });

  const storageById = new Map(
    storageDocument.storageProfiles.map((profile) => [profile.id, profile]),
  );
  const activeProfiles = storageDocument.storageProfiles.filter(
    (profile) => profile.status === "active",
  );
  const selected = storageDocument.activeProfileId === null
    ? undefined
    : storageById.get(storageDocument.activeProfileId);
  if (
    activeProfiles.length > 1 ||
    (selected && selected.status !== "active" && selected.status !== "verified") ||
    (!selected && storageDocument.activeProfileId !== null) ||
    (activeProfiles.length === 1 &&
      activeProfiles[0]?.id !== storageDocument.activeProfileId) ||
    (storageDocument.mediaRoutingEnabled && selected?.status !== "active")
  ) {
    fail(
      "BACKUP_STORAGE_DOCUMENT_MISMATCH",
      "Storage secret routing metadata is not in a durable terminal state",
    );
  }
  const referencedStorageIds = new Set<string>();
  for (const row of statementRows(database, `
    SELECT DISTINCT storage_profile_id
    FROM media_assets
    WHERE storage_profile_id IS NOT NULL
    ORDER BY storage_profile_id
  `)) {
    if (typeof row[0] !== "string" || !row[0]) {
      fail(
        "BACKUP_STORAGE_DOCUMENT_MISMATCH",
        "SQLite contains an invalid storage profile reference",
      );
    }
    referencedStorageIds.add(row[0]);
  }
  const publicationTable = statementRows(database, `
    SELECT COUNT(*)
    FROM sqlite_schema
    WHERE type = 'table' AND name = 'media_publication_attempts'
  `);
  if (publicationTable[0]?.[0] === 1n) {
    for (const row of statementRows(database, `
      SELECT DISTINCT storage_profile_id
      FROM media_publication_attempts
      WHERE storage_profile_id IS NOT NULL
      ORDER BY storage_profile_id
    `)) {
      if (typeof row[0] !== "string" || !row[0]) {
        fail(
          "BACKUP_STORAGE_DOCUMENT_MISMATCH",
          "SQLite contains an invalid publication storage profile reference",
        );
      }
      referencedStorageIds.add(row[0]);
    }
  }
  if ([...referencedStorageIds].some((id) => {
    const profile = storageById.get(id);
    return !profile || (profile.status !== "active" && profile.status !== "verified");
  })) {
    fail(
      "BACKUP_STORAGE_DOCUMENT_MISMATCH",
      "SQLite storage references are not backed by a usable terminal profile",
    );
  }
}

function validateAccountCredential(value: unknown, key: Buffer | undefined) {
  if (!key) {
    fail(
      "BACKUP_SECRET_MASTER_KEY_MISSING",
      "Encrypted account credential has no master key",
    );
  }
  if (typeof value !== "string" || value.length > maximumEncryptedCredentialBytes) {
    fail("BACKUP_ACCOUNT_CREDENTIAL_INVALID", "Account credential is invalid");
  }
  const parts = value.split("$");
  if (parts.length !== 3) {
    fail("BACKUP_ACCOUNT_CREDENTIAL_INVALID", "Account credential is invalid");
  }
  const iv = canonicalBase64(parts[0], "Credential IV");
  const tag = canonicalBase64(parts[1], "Credential tag");
  const ciphertext = canonicalBase64(parts[2], "Credential ciphertext");
  let plaintext: Buffer | undefined;
  try {
    plaintext = decryptGcm(
      key,
      accountCredentialAad,
      iv,
      tag,
      ciphertext,
    );
    let decoded = "";
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } catch {
      fail(
        "BACKUP_ACCOUNT_CREDENTIAL_INVALID",
        "Decrypted account credential is invalid",
      );
    }
    if (
      decoded.length < 8 ||
      /\s/.test(decoded)
    ) {
      fail(
        "BACKUP_ACCOUNT_CREDENTIAL_INVALID",
        "Decrypted account credential is invalid",
      );
    }
  } finally {
    iv.fill(0);
    tag.fill(0);
    ciphertext.fill(0);
    plaintext?.fill(0);
  }
}

/**
 * Prove that the copied secret material can decrypt without ever creating a
 * missing master key or returning credentials. Only aggregate counts and the
 * storage-profile identifiers needed for referential validation leave this
 * function; reports and manifests never receive those identifiers.
 */
export async function validateBackupSecretsWithContext(
  databasePath: string,
  secretsDirectory: string,
  inspectionRoot: string,
  options: Readonly<{ requireDatabaseAlignment?: boolean }> = {},
): Promise<BackupSecretValidationContext> {
  assertRegularDatabasePath(databasePath, inspectionRoot);
  assertAbsolutePath(secretsDirectory, "Secrets directory");
  let absentSecrets = false;
  try {
    assertContainedRegularPath(
      secretsDirectory,
      inspectionRoot,
      "directory",
      "Secrets directory",
    );
  } catch (error) {
    try {
      lstatSync(secretsDirectory);
    } catch (missing) {
      if (missing instanceof Error && "code" in missing && missing.code === "ENOENT") {
        assertContainedRegularPath(
          dirname(secretsDirectory),
          inspectionRoot,
          "directory",
          "Secrets parent directory",
        );
        absentSecrets = true;
      } else {
        throw error;
      }
    }
    if (!absentSecrets) throw error;
  }
  const secretsPresent = await assertRegularTree(secretsDirectory);
  const key = secretsPresent
    ? await readOptionalRegularFile(join(secretsDirectory, "config-master.key"), 32)
    : undefined;
  if (key && key.length !== 32) {
    key.fill(0);
    fail("BACKUP_SECRET_MASTER_KEY_INVALID", "Secret master key is invalid");
  }

  let database: DatabaseSync | undefined;
  let validationFailed = false;
  try {
    const providerDocument = secretsPresent
      ? await validateEncryptedDocument(
          join(secretsDirectory, "provider-profiles.enc.json"),
          key,
          providerDocumentAad,
          "provider",
        )
      : Object.freeze({
          activeProfileId: null,
          documentPresent: false,
          mediaRoutingEnabled: false,
          profileIds: Object.freeze([] as string[]),
          providerProfiles: Object.freeze([] as Array<{
            configurationVersion: number;
            driver: string;
            id: string;
            label: string;
          }>),
          profiles: 0,
          storageProfiles: Object.freeze([] as Array<{
            id: string;
            status: "active" | "draft" | "verified";
          }>),
        });
    const storageDocument = secretsPresent
      ? await validateEncryptedDocument(
          join(secretsDirectory, "storage-profiles.enc.json"),
          key,
          storageDocumentAad,
          "storage",
        )
      : Object.freeze({
          activeProfileId: null,
          documentPresent: false,
          mediaRoutingEnabled: false,
          profileIds: Object.freeze([] as string[]),
          providerProfiles: Object.freeze([] as Array<{
            configurationVersion: number;
            driver: string;
            id: string;
            label: string;
          }>),
          profiles: 0,
          storageProfiles: Object.freeze([] as Array<{
            id: string;
            status: "active" | "draft" | "verified";
          }>),
        });

    database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
    database.exec("BEGIN");
    const credentialTable = statementRows(
      database,
      `
        SELECT COUNT(*)
        FROM sqlite_schema
        WHERE type = 'table' AND name = 'account_provider_credentials'
      `,
    );
    let accountCredentials = 0;
    if (credentialTable[0]?.[0] === 1n) {
      const statement = database.prepare(`
        SELECT
          account_id, provider_profile_id, encrypted_key, key_status,
          key_checked_at, credential_version, updated_at
        FROM account_provider_credentials
        ORDER BY account_id, provider_profile_id
      `);
      statement.setReadBigInts(true);
      statement.setReturnArrays(true);
      const configuredProviderIds = new Set(
        providerDocument.providerProfiles.map((profile) => profile.id),
      );
      for (const row of statement.iterate() as Iterable<unknown[]>) {
        if (
          typeof row[0] !== "string" || !row[0] ||
          typeof row[1] !== "string" ||
          !configuredProviderIds.has(row[1]) || row[1] === "provider-unconfigured" ||
          !new Set(["invalid", "unchecked", "unknown", "valid"]).has(
            String(row[3]),
          ) ||
          (row[3] === "unchecked"
            ? row[4] !== null
            : !canonicalIsoTimestamp(row[4])) ||
          typeof row[5] !== "bigint" || row[5] < 1n ||
          !canonicalIsoTimestamp(row[6])
        ) {
          fail(
            "BACKUP_ACCOUNT_CREDENTIAL_INVALID",
            "Account credential metadata is not bound to a configured Provider profile",
          );
        }
        validateAccountCredential(row[2], key);
        accountCredentials += 1;
      }
    }
    if (options.requireDatabaseAlignment) {
      validateSecretDatabaseAlignment(
        database,
        providerDocument,
        storageDocument,
        Boolean(key),
      );
    }
    return Object.freeze({
      providerProfiles: providerDocument.providerProfiles,
      storageDocument: Object.freeze({
        activeProfileId: storageDocument.activeProfileId,
        mediaRoutingEnabled: storageDocument.mediaRoutingEnabled,
        profiles: storageDocument.storageProfiles,
      }),
      storageProfileIds: storageDocument.profileIds,
      validation: Object.freeze({
        accountCredentials,
        masterKeyPresent: Boolean(key),
        providerDocumentProfiles: providerDocument.profiles,
        storageDocumentProfiles: storageDocument.profiles,
      }),
    });
  } catch (error) {
    validationFailed = true;
    if (error instanceof BackupInspectionError) throw error;
    throw new BackupInspectionError(
      "BACKUP_SECRET_VALIDATION_FAILED",
      "Backup secret validation failed",
    );
  } finally {
    key?.fill(0);
    let cleanupFailed = false;
    if (database?.isTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      database?.close();
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed && !validationFailed) {
      throw new BackupInspectionError(
        "BACKUP_SECRET_CLEANUP_FAILED",
        "Backup secret validation cleanup failed",
      );
    }
  }
}

export async function validateBackupSecrets(
  databasePath: string,
  secretsDirectory: string,
  inspectionRoot: string,
): Promise<BackupSecretValidation> {
  return (await validateBackupSecretsWithContext(
    databasePath,
    secretsDirectory,
    inspectionRoot,
  )).validation;
}

export async function validateBackupStorageProfileIds(
  secretsDirectory: string,
  inspectionRoot: string,
): Promise<readonly string[]> {
  assertAbsolutePath(secretsDirectory, "Secrets directory");
  let absentSecrets = false;
  try {
    assertContainedRegularPath(
      secretsDirectory,
      inspectionRoot,
      "directory",
      "Secrets directory",
    );
  } catch (error) {
    try {
      lstatSync(secretsDirectory);
    } catch (missing) {
      if (missing instanceof Error && "code" in missing && missing.code === "ENOENT") {
        assertContainedRegularPath(
          dirname(secretsDirectory),
          inspectionRoot,
          "directory",
          "Secrets parent directory",
        );
        absentSecrets = true;
      } else {
        throw error;
      }
    }
    if (!absentSecrets) throw error;
  }
  const secretsPresent = await assertRegularTree(secretsDirectory);
  const key = secretsPresent
    ? await readOptionalRegularFile(join(secretsDirectory, "config-master.key"), 32)
    : undefined;
  if (key && key.length !== 32) {
    key.fill(0);
    fail("BACKUP_SECRET_MASTER_KEY_INVALID", "Secret master key is invalid");
  }
  try {
    if (!secretsPresent) return Object.freeze([] as string[]);
    const storageDocument = await validateEncryptedDocument(
      join(secretsDirectory, "storage-profiles.enc.json"),
      key,
      storageDocumentAad,
      "storage",
    );
    return storageDocument.profileIds;
  } finally {
    key?.fill(0);
  }
}

// Keep the algorithm contract explicit for reviews and future format bridges.
export const backupSecretCryptoContract = Object.freeze({
  accountCredentialAad: accountCredentialAad.toString("utf8"),
  authenticationTagBytes: 16,
  cipher: "aes-256-gcm",
  ivBytes: 12,
  masterKeyBytes: 32,
  providerDocumentAad: providerDocumentAad.toString("utf8"),
  storageDocumentAad: storageDocumentAad.toString("utf8"),
});
