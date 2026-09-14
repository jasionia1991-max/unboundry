import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MEDIA_PUBLICATION_FIXTURE = Object.freeze({
  ownerId: "__test__",
  canvasId: "media-publication-canvas",
  groupId: "media-publication-group",
  parentRunId: "11111111-1111-4111-8111-111111111111",
  reservationId: "media-publication-parent-reservation",
  adoptionTaskId: "media-publication-adoption-task",
  adoptionNodeId: "media-publication-adoption-image",
  saveRaceNodeId: "media-publication-save-race-video",
  pngNodeId: "media-publication-normal-png",
  pngAssetId: "media-publication-normal-png-asset",
  canonicalAttemptId: "media-publication-canonical-attempt",
  canonicalAssetId: "media-publication-canonical-png-asset",
  aliasAttemptId: "media-publication-alias-attempt",
  aliasAssetId: "media-publication-alias-png-asset",
  failedAttemptId: "media-publication-failed-attempt",
  failedAssetId: "media-publication-failed-png-asset",
  pendingNodeId: "media-publication-pending-video",
  pendingTailNodeId: "media-publication-pending-tail-video",
  preservedNodeIds: Object.freeze([
    "media-publication-preserved-01",
    "media-publication-preserved-02",
    "media-publication-preserved-03",
    "media-publication-preserved-04",
    "media-publication-preserved-05",
    "media-publication-preserved-06",
    "media-publication-preserved-07",
    "media-publication-preserved-08",
    "media-publication-preserved-09",
  ]),
});

const now = "2026-09-10T00:00:00.000Z";
const textModel = Object.freeze({
  id: "media-publication-text-model",
  configurationRevision: "media-publication-text-config-v1",
  providerDriver: "volcengine-ark",
  providerModelId: "doubao-seed-2-0-lite-260428",
  providerProfileId: "media-publication-text-profile",
  providerProtocol: "native",
  revisionId: "22222222-2222-4222-8222-222222222222",
});
const imageModel = Object.freeze({
  id: "media-publication-image-model",
  configurationRevision: "media-publication-image-config-v1",
  providerDriver: "multi-protocol-relay",
  providerModelId: "tt-image-2",
  providerProfileId: "media-publication-image-profile",
  providerProtocol: "media-generate",
  revisionId: "33333333-3333-4333-8333-333333333334",
});
const videoModel = Object.freeze({
  id: "media-publication-video-model",
  configurationRevision: "media-publication-video-config-v1",
  providerDriver: "multi-protocol-relay",
  providerModelId: "grok-imagine-video-1.5-preview",
  providerProfileId: "media-publication-video-profile",
  providerProtocol: "media-generate",
  revisionId: "33333333-3333-4333-8333-333333333333",
});

const providerProfileAad = Buffer.from("unboundry:provider-profiles:v1", "utf8");

function encryptedProviderProfileDocument(key, document) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(providerProfileAad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(document), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: 1,
  });
}

/**
 * The legacy fixture must stay at schema 43 until its publication journal is
 * migrated to schema 44. saveProviderProfile() opens the app database through
 * its process-global current-schema handle, so it cannot be called while this
 * deliberately pre-migration database is open. Seed the same two stores with
 * the exact product document/metadata contract, then let the real credential,
 * model-contract, generation, and migration code operate on them.
 */
function seedMediaPublicationProviderProfile(database, dataDirectory) {
  const profile = {
    apiKey: "media-publication-local-key",
    baseUrl: "https://media-publication-relay.example.test/v1",
    configurationVersion: 1,
    createdAt: now,
    driver: "multi-protocol-relay",
    id: "44444444-4444-4444-8444-444444444444",
    label: "Media publication local relay fixture",
    updatedAt: now,
  };
  const textProfile = {
    apiKey: "media-publication-local-text-key",
    baseUrl: "https://media-publication-relay.example.test/v1",
    configurationVersion: 1,
    createdAt: now,
    driver: "volcengine-ark",
    id: "55555555-5555-4555-8555-555555555555",
    label: "Media publication local text relay fixture",
    updatedAt: now,
  };
  const secretsDirectory = join(dataDirectory, "secrets");
  mkdirSync(secretsDirectory, { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  try {
    writeFileSync(join(secretsDirectory, "config-master.key"), key, {
      flag: "wx",
      mode: 0o600,
    });
    writeFileSync(
      join(secretsDirectory, "provider-profiles.enc.json"),
      encryptedProviderProfileDocument(key, { profiles: [profile, textProfile], version: 1 }),
      { flag: "wx", mode: 0o600 },
    );
  } finally {
    key.fill(0);
  }
  database.prepare(`
    INSERT INTO provider_profiles (
      id, display_name, driver, status, created_at, updated_at,
      key_status, key_checked_at, provider_configuration_version
    ) VALUES (?, ?, ?, 'enabled', ?, ?, 'valid', ?, 1)
  `).run(
    profile.id,
    profile.label,
    profile.driver,
    profile.createdAt,
    profile.updatedAt,
    profile.updatedAt,
  );
  database.prepare(`
    INSERT INTO provider_profiles (
      id, display_name, driver, status, created_at, updated_at,
      key_status, key_checked_at, provider_configuration_version
    ) VALUES (?, ?, ?, 'enabled', ?, ?, 'valid', ?, 1)
  `).run(
    textProfile.id,
    textProfile.label,
    textProfile.driver,
    textProfile.createdAt,
    textProfile.updatedAt,
    textProfile.updatedAt,
  );
  return Object.freeze({ profile: Object.freeze(profile), textProfile: Object.freeze(textProfile) });
}

function releaseFor(model, capability, modelParameters, releaseDefaults, releaseStore) {
  const capabilitySchema = modelParameters.knownModelParameterSchema({
    capability,
    providerDriver: model.providerDriver,
    providerModelId: model.providerModelId,
  });
  const document = releaseDefaults.defaultModelReleaseDocument({
    capability,
    capabilitySchema,
    modelId: model.id,
    providerDriver: model.providerDriver,
    providerModelId: model.providerModelId,
    providerProfileId: model.providerProfileId,
    providerProtocol: model.providerProtocol,
  });
  const proof = releaseStore.inspectModelReleaseDocument(document);
  return Object.freeze({
    createdAt: now,
    document,
    hash: proof.documentHash,
    modelId: model.id,
    revisionId: model.revisionId,
    revisionNumber: 1,
    validation: Object.freeze({
      compilerHash: proof.compilerHash,
      impact: Object.freeze({ incompatibleTemplateIds: Object.freeze([]), templateIds: Object.freeze([]) }),
      paidProviderRequests: 0,
      preview: Object.freeze({ modes: Object.freeze([]) }),
      validatedAt: now,
    }),
  });
}

function nodeData(kind, id, model) {
  const prompt = `${kind} 本地验收提示词 ${id}`;
  if (kind === "text") {
    return { label: "Text", title: `已保存文字 ${id.slice(-2)}`, textModelId: model.id, textPrompt: prompt, textPromptReady: true };
  }
  const parameters = kind === "video"
    ? {
        aspectRatio: "16:9",
        duration: 5,
        generateAudio: true,
        inputMode: "reference",
        outputCount: 1,
        resolution: "480p",
      }
    : kind === "image"
      ? {
          aspectRatio: "9:16",
          inputMode: "text",
          outputCount: 1,
          quality: "2k",
        }
      : {};
  return {
    label: kind === "video" ? "Video" : kind,
    title: `${kind} 本地验收节点`,
    [`${kind}ModelId`]: model.id,
    [`${kind}Parameters`]: parameters,
    [`${kind}Prompt`]: prompt,
    [`${kind}PromptReady`]: true,
  };
}

function graphFor(fixture, models = { text: textModel, image: imageModel, video: videoModel }) {
  const nodes = [
    { id: fixture.groupId, type: "group", position: { x: 0, y: 0 }, data: { label: "Group", title: "媒体发布恢复验收" }, style: { width: 1180, height: 800 } },
    ...fixture.preservedNodeIds.map((id, index) => ({
      id,
      parentId: fixture.groupId,
      extent: "parent",
      type: "text",
      position: { x: 60 + (index % 3) * 360, y: 50 + Math.floor(index / 3) * 170 },
      data: { ...nodeData("text", id, models.text), content: `已保存的本地文字结果 ${index + 1}` },
      style: { width: 300, height: 140 },
    })),
    {
      id: fixture.adoptionNodeId,
      parentId: fixture.groupId,
      extent: "parent",
      type: "image",
      position: { x: 60, y: 600 },
      data: { ...nodeData("image", fixture.adoptionNodeId, models.image), title: "找回已有图片" },
      style: { width: 250, height: 180 },
    },
    {
      id: fixture.pngNodeId,
      parentId: fixture.groupId,
      extent: "parent",
      type: "image",
      position: { x: 900, y: 600 },
      data: {
        label: "Image",
        title: "本地 PNG 正常显示",
        assetId: fixture.pngAssetId,
        inputState: "ready",
        imageSrc: `/api/assets/${fixture.pngAssetId}`,
        sourceKind: "image",
        imagePromptReady: true,
        mediaSizingMode: "manual",
      },
      style: { width: 180, height: 120 },
    },
    {
      id: fixture.saveRaceNodeId,
      type: "video",
      position: { x: 60, y: 720 },
      data: { ...nodeData("video", fixture.saveRaceNodeId, models.video), title: "保存恢复演示" },
      style: { width: 300, height: 180 },
    },
    {
      id: fixture.pendingNodeId,
      parentId: fixture.groupId,
      extent: "parent",
      type: "video",
      position: { x: 420, y: 600 },
      data: { ...nodeData("video", fixture.pendingNodeId, models.video), title: "未完成视频 1" },
      style: { width: 250, height: 180 },
    },
    {
      id: fixture.pendingTailNodeId,
      parentId: fixture.groupId,
      extent: "parent",
      type: "video",
      position: { x: 780, y: 600 },
      data: { ...nodeData("video", fixture.pendingTailNodeId, models.video), title: "未完成视频 2" },
      style: { width: 250, height: 180 },
    },
  ];
  const edges = [
    { id: "media-publication-edge-save-race", source: fixture.pngNodeId, target: fixture.saveRaceNodeId, data: { inputOrder: 1, inputRole: "first-frame" } },
    { id: "media-publication-edge-preserved", source: fixture.preservedNodeIds[0], target: fixture.adoptionNodeId, data: { inputOrder: 1 } },
    { id: "media-publication-edge-adoption-pending", source: fixture.adoptionNodeId, target: fixture.pendingNodeId, data: { inputOrder: 1 } },
    { id: "media-publication-edge-adoption-tail", source: fixture.adoptionNodeId, target: fixture.pendingTailNodeId, data: { inputOrder: 1 } },
  ];
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
}

function identityFor({ database, node, release, model, modelParameters, inputPreflight, identity }) {
  const requestedParameters = node.data?.[`${node.type}Parameters`];
  // Keep pre-migration reads on this exact fixture handle. The product
  // preflight uses its transaction-scoped media reader when a transaction is
  // present; its process-global reader correctly requires current schema 44.
  let persisted;
  database.exec("BEGIN DEFERRED");
  try {
    persisted = inputPreflight.resolvePersistedNodeInputs({
    bypass: false,
    canvasId: MEDIA_PUBLICATION_FIXTURE.canvasId,
    database,
    modelReleaseRevision: release.revisionId,
    modelSchema: release.document.capabilitySchema,
    ownerId: MEDIA_PUBLICATION_FIXTURE.ownerId,
    parameters: requestedParameters && typeof requestedParameters === "object"
      ? requestedParameters
      : {},
    targetId: node.id,
    targetKind: node.type,
  });
  } finally {
    database.exec("ROLLBACK");
  }
  const parameters = modelParameters.submissionParameterValues(
    release.document.capabilitySchema,
    persisted.normalizedParameters ?? {},
  );
  const contractFingerprint = persisted.contractFingerprint;
  if (typeof contractFingerprint !== "string" || !contractFingerprint) {
    throw new Error(`media acceptance fixture missing contract for ${node.id}`);
  }
  const inputKey = identity.generationInputKey({
    inputs: persisted.inputs,
    modelConfigurationRevision: model.configurationRevision,
    modelId: model.id,
    modelReleaseRevision: release.revisionId,
    ownPrompt: persisted.persistedOwnPrompt,
    parameters,
    prompt: persisted.finalPrompt,
  });
  const ownershipKey = identity.generationOwnershipKey(identity.generationOwnershipEvidence({
    contractFingerprint,
    inputs: persisted.inputs,
    kind: node.type,
    modelConfigurationRevision: model.configurationRevision,
    modelId: model.id,
    modelReleaseRevision: release.revisionId,
    parameters,
    prompt: persisted.persistedOwnPrompt,
  }));
  return Object.freeze({ parameters, contractFingerprint, inputKey, ownershipKey, persisted });
}

function taskConfig(nodePlan, model, release, identity, reservationId, runId) {
  return {
    generationIdentityVersion: 2,
    generationInputKey: identity.inputKey,
    generationOwnershipKey: identity.ownershipKey,
    modelCapability: nodePlan.kind,
    modelConfigurationRevision: model.configurationRevision,
    modelId: model.id,
    modelInputContractFingerprint: identity.contractFingerprint,
    modelReleaseRevision: release,
    modelResultCount: 1,
    parameterSchema: release.document.capabilitySchema,
    providerDriver: model.providerDriver,
    providerModelId: model.providerModelId,
    providerProfileId: model.providerProfileId,
    providerProtocol: model.providerProtocol,
    workflowBinding: {
      generationInputKey: identity.inputKey,
      generationOwnershipKey: identity.ownershipKey,
      groupId: MEDIA_PUBLICATION_FIXTURE.groupId,
      modelConfigurationRevision: model.configurationRevision,
      modelReleaseRevision: release.revisionId,
      reservationId,
      runId,
    },
  };
}

function insertTask(database, { id, node, nodePlan, model, release, identity, state, resultText, providerTaskId, reservationId, runId }) {
  const idempotencyKey = `media-parent-${node.id}`;
  database.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, node_id, kind, prompt, model, parameters,
      idempotency_key, request_fingerprint, state, attempt, error_code,
      error_message, created_at, updated_at, owner_id, provider_profile_id,
      provider_model_id, cost_currency, provider_task_id, model_configuration,
      result_text, credential_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    MEDIA_PUBLICATION_FIXTURE.canvasId,
    node.id,
    nodePlan.kind,
    identity.persisted.finalPrompt,
    model.id,
    JSON.stringify(identity.parameters),
    idempotencyKey,
    createHash("sha256").update(`media-request-${node.id}`).digest("hex"),
    state,
    state === "failed" ? "PROVIDER_RESULT_FORMAT" : null,
    state === "failed" ? "本地合成的 Provider 结果格式错误" : null,
    now,
    now,
    MEDIA_PUBLICATION_FIXTURE.ownerId,
    model.providerProfileId,
    model.providerModelId,
    "CNY",
    providerTaskId ?? null,
    JSON.stringify(taskConfig(nodePlan, model, release, identity, reservationId, runId)),
    resultText ?? null,
  );
  database.prepare(`
    INSERT INTO generation_task_events (task_id, state, error_code, error_message, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    state,
    state === "failed" ? "PROVIDER_RESULT_FORMAT" : null,
    state === "failed" ? "本地合成的 Provider 结果格式错误" : null,
    now,
  );
  if (state === "failed") {
    database.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, created_at, owner_id, credential_revision, outcome,
        provider_task_id, failure_code, finished_at
      ) VALUES (?, 1, ?, ?, ?, 'provider-boundary', ?, ?, 1, 'response-received', ?, NULL, ?)
    `).run(
      id,
      model.providerProfileId,
      model.providerModelId,
      nodePlan.kind,
      now,
      MEDIA_PUBLICATION_FIXTURE.ownerId,
      providerTaskId,
      now,
    );
  }
}

function insertPublication(database, input) {
  database.prepare(`
    INSERT INTO media_publication_attempts (
      attempt_id, owner_id, kind, asset_id, source, state,
      storage_backend, final_storage_name, object_key, staging_name,
      task_id, task_execution_attempt, history_label, byte_size,
      checksum_sha256, content_type, duration_seconds, duration_source,
      media_width, media_height, error_code, retry_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'generation', ?, 'local', ?, ?, ?, ?, 1,
      'media publication acceptance A/B/C', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    input.attemptId,
    MEDIA_PUBLICATION_FIXTURE.ownerId,
    input.kind,
    input.assetId,
    input.state,
    input.storageName,
    input.storageName,
    input.stagingName,
    MEDIA_PUBLICATION_FIXTURE.adoptionTaskId,
    input.byteSize,
    input.checksum,
    input.contentType,
    input.durationSeconds ?? null,
    input.durationSource ?? null,
    input.mediaWidth ?? null,
    input.mediaHeight ?? null,
    input.errorCode ?? null,
    now,
    now,
  );
}

export async function seedMediaPublicationLegacyDatabase({
  databaseModule,
  semanticModule,
  releaseDefaultsModule,
  releaseRevisionModule,
  modelParametersModule,
  providerProfilesModule,
  accountCredentialsModule,
  modelReleaseBootstrapModule,
  modelCatalogModule,
  inputPreflightModule,
  identityModule,
  dataDirectory,
}) {
  const fixture = MEDIA_PUBLICATION_FIXTURE;
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  let database = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("CREATE TABLE schema_migrations (\n      version INTEGER PRIMARY KEY,\n      name TEXT NOT NULL,\n      applied_at TEXT NOT NULL\n    );");
  database.exec("BEGIN IMMEDIATE");
  try {
    databaseModule.applyPendingSchemaMigrationsInTransaction(database, { sourceVersion: 0, targetVersion: 43, appliedAt: () => now });
    database.exec("COMMIT");
    database.prepare(`
      INSERT INTO users (id, login_name, display_name, password_hash, role, status, created_at, updated_at, protected)
      VALUES ('__test__', '__test__', 'Local Acceptance', 'test-only', 'admin', 'active', ?, ?, 1)
    `).run(now, now);
    database.prepare(`
      INSERT INTO project_metadata (owner_id, id, title, updated_at, is_project, created_at)
      VALUES (?, ?, '媒体发布恢复 · 四项同页验收', ?, 1, ?)
    `).run(fixture.ownerId, fixture.canvasId, Date.parse(now), Date.parse(now));

    // The successor must pass the same model/profile/credential admission
    // checks as a normal product run. Keep the database at schema 43 until
    // legacy publication rows have been inserted and migrated; the product
    // saveProviderProfile() API only targets the current schema. The fixture
    // therefore writes the exact encrypted profile/metadata pair locally, then
    // uses the real credential and model-contract commands below. The relay is
    // rewritten to loopback by the acceptance page; setup makes no external
    // request.
    const seededProfiles = seedMediaPublicationProviderProfile(database, dataDirectory);
    const profile = seededProfiles.profile;
    const textProfile = seededProfiles.textProfile;
    const runtimeVideoProfileId = profile.id;
    const runtimeTextProfileId = textProfile.id;
    const runtimeTextBase = Object.freeze({
      ...textModel,
      providerProfileId: runtimeTextProfileId,
    });
    const runtimeVideoBase = Object.freeze({
      ...videoModel,
      providerProfileId: runtimeVideoProfileId,
    });
    const runtimeImageBase = Object.freeze({
      ...imageModel,
      providerProfileId: runtimeVideoProfileId,
    });
    const imageSchema = modelParametersModule.providerParameterSchema({
      capability: "image",
      providerDriver: runtimeImageBase.providerDriver,
      providerModelId: runtimeImageBase.providerModelId,
    });
    if (!imageSchema) throw new Error("media acceptance relay image schema is missing");
    const videoSchema = modelParametersModule.providerParameterSchema({
      capability: "video",
      providerDriver: runtimeVideoBase.providerDriver,
      providerModelId: runtimeVideoBase.providerModelId,
    });
    if (!videoSchema) throw new Error("media acceptance relay video schema is missing");
    const textSchema = modelParametersModule.providerParameterSchema({
      capability: "text",
      providerDriver: runtimeTextBase.providerDriver,
      providerModelId: runtimeTextBase.providerModelId,
    });
    if (!textSchema) throw new Error("media acceptance Ark text schema is missing");
    database.prepare(`
      UPDATE provider_profiles
      SET status = 'enabled', key_status = 'valid', key_checked_at = ?, updated_at = ?
      WHERE id = ? AND driver = 'multi-protocol-relay'
    `).run(now, now, runtimeVideoProfileId);
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id, capability,
        status, default_parameters, created_at, updated_at, max_cost_microunits,
        cost_currency, provider_protocol
      ) VALUES (?, ?, ?, ?, 'video', 'published', ?, ?, ?, 5000000, 'USD', 'media-generate')
    `).run(
      videoModel.id,
      "Media publication local video model",
      runtimeVideoProfileId,
      runtimeVideoBase.providerModelId,
      JSON.stringify(videoSchema),
      now,
      now,
    );
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id, capability,
        status, default_parameters, created_at, updated_at, max_cost_microunits,
        cost_currency, provider_protocol
      ) VALUES (?, ?, ?, ?, 'image', 'published', ?, ?, ?, 5000000, 'USD', 'media-generate')
    `).run(
      imageModel.id,
      "Media publication local image model",
      runtimeVideoProfileId,
      runtimeImageBase.providerModelId,
      JSON.stringify(imageSchema),
      now,
      now,
    );
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id, capability,
        status, default_parameters, created_at, updated_at, max_cost_microunits,
        cost_currency, provider_protocol
      ) VALUES (?, ?, ?, ?, 'text', 'published', ?, ?, ?, 5000000, 'CNY', 'native')
    `).run(
      textModel.id,
      "Media publication local text model",
      runtimeTextProfileId,
      runtimeTextBase.providerModelId,
      JSON.stringify(textSchema),
      now,
      now,
    );
    database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order, created_at, updated_at
      ) VALUES ('video', ?, 1, 1, 1, ?, ?)
    `).run(videoModel.id, now, now);
    database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order, created_at, updated_at
      ) VALUES ('image', ?, 1, 1, 1, ?, ?)
    `).run(imageModel.id, now, now);
    database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order, created_at, updated_at
      ) VALUES ('text', ?, 1, 1, 1, ?, ?)
    `).run(textModel.id, now, now);
    database.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 1, emergency_stop = 0, per_user_concurrency = 10,
        requests_per_minute = 120, image_concurrency = 5, video_concurrency = 5,
        audio_concurrency = 5, text_concurrency = 5, updated_at = ?
      WHERE id = 1
    `).run(now);
    modelReleaseBootstrapModule.bootstrapPublishedModelContracts(database, fixture.ownerId);
    const credential = await accountCredentialsModule.saveAccountCredential(
      database,
      fixture.ownerId,
      runtimeVideoProfileId,
      "media-publication-local-account-key",
    );
    database.prepare(`
      UPDATE account_provider_credentials
      SET key_status = 'valid', key_checked_at = ?, updated_at = ?
      WHERE account_id = ? AND provider_profile_id = ?
    `).run(now, now, fixture.ownerId, runtimeVideoProfileId);
    await accountCredentialsModule.saveAccountCredential(
      database,
      fixture.ownerId,
      runtimeTextProfileId,
      "media-publication-local-text-account-key",
    );
    database.prepare(`
      UPDATE account_provider_credentials
      SET key_status = 'valid', key_checked_at = ?, updated_at = ?
      WHERE account_id = ? AND provider_profile_id = ?
    `).run(now, now, fixture.ownerId, runtimeTextProfileId);
    const activeVideoRelease = releaseRevisionModule.modelContractState(database, videoModel.id).active;
    if (!activeVideoRelease) throw new Error("media acceptance relay video contract is missing");
    const activeImageRelease = releaseRevisionModule.modelContractState(database, imageModel.id).active;
    if (!activeImageRelease) throw new Error("media acceptance relay image contract is missing");
    const modelRow = database.prepare(`
      SELECT
        model_profiles.capability,
        model_profiles.default_parameters,
        model_profiles.id,
        model_profiles.updated_at AS model_configuration_updated_at,
        provider_profiles.driver AS provider_driver,
        model_profiles.provider_model_id
      FROM model_profiles
      JOIN provider_profiles
        ON provider_profiles.id = model_profiles.provider_profile_id
      WHERE model_profiles.id = ?
    `).get(videoModel.id);
    if (!modelRow) throw new Error("media acceptance relay model row is missing");
    const runtimeVideoModel = Object.freeze({
      ...runtimeVideoBase,
      configurationRevision: modelCatalogModule.modelConfigurationRevision(modelRow),
    });
    const imageModelRow = database.prepare(`
      SELECT
        model_profiles.capability,
        model_profiles.default_parameters,
        model_profiles.id,
        model_profiles.updated_at AS model_configuration_updated_at,
        provider_profiles.driver AS provider_driver,
        model_profiles.provider_model_id
      FROM model_profiles
      JOIN provider_profiles
        ON provider_profiles.id = model_profiles.provider_profile_id
      WHERE model_profiles.id = ?
    `).get(imageModel.id);
    if (!imageModelRow) throw new Error("media acceptance relay image model row is missing");
    const runtimeImageModel = Object.freeze({
      ...runtimeImageBase,
      configurationRevision: modelCatalogModule.modelConfigurationRevision(imageModelRow),
    });
    const textModelRow = database.prepare(`
      SELECT
        model_profiles.capability,
        model_profiles.default_parameters,
        model_profiles.id,
        model_profiles.updated_at AS model_configuration_updated_at,
        provider_profiles.driver AS provider_driver,
        model_profiles.provider_model_id
      FROM model_profiles
      JOIN provider_profiles
        ON provider_profiles.id = model_profiles.provider_profile_id
      WHERE model_profiles.id = ?
    `).get(textModel.id);
    if (!textModelRow) throw new Error("media acceptance Ark text model row is missing");
    const runtimeTextModel = Object.freeze({
      ...runtimeTextBase,
      configurationRevision: modelCatalogModule.modelConfigurationRevision(textModelRow),
    });
    const releases = {
      text: releaseRevisionModule.modelContractState(database, textModel.id).active,
      image: activeImageRelease,
      video: activeVideoRelease,
    };
    if (!releases.text) throw new Error("media acceptance Ark text contract is missing");
    const graph = graphFor(fixture, { text: runtimeTextModel, image: runtimeImageModel, video: runtimeVideoModel });
    const workflowGraph = {
      nodes: graph.nodes.filter((node) => node.id !== fixture.pngNodeId && node.id !== fixture.saveRaceNodeId),
      edges: graph.edges.filter((edge) => edge.target !== fixture.saveRaceNodeId),
    };
    const semantic = semanticModule.compileFrozenWorkflowSemanticPlan({
      edges: workflowGraph.edges,
      groupId: fixture.groupId,
      nodes: workflowGraph.nodes,
    });
    const canvasRevision = 7;
    const graphRevision = 7;
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'media-publication-seed', 1)
    `).run(
      fixture.ownerId,
      fixture.canvasId,
      canvasRevision,
      graphRevision,
      JSON.stringify(graph.nodes),
      JSON.stringify(graph.edges),
      JSON.stringify({ x: 0, y: 0, zoom: 0.7 }),
      now,
    );

    // A/B/C are three publication journal entries for the same original PNG.
    // Canonical and alias intentionally point at separate local files with
    // identical bytes so the adoption command must use the ledger evidence,
    // not a Provider call or a URL guess.
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAAEBElEQVR4nO3TwUkEABAEwcvFjxH6MRdDMSsRfBnEMcztUFAhdD/eP78Z9vb1wbBHvTCi6oURZeBx9cKIMvC4emFEGXhcvTCiDDyuXhhRBh5XL4woA4+rF0aUgcfVCyPKwOPqhRFl4HH1wogy8Lh6YUQZeFy9MKIMPK5eGFEGHlcvjCgDj6sXRpSBx9ULI8rA4+qFEWXgcfXCiDLwuHphRBl4XL0wogw8rl4YUQYeVy+MKAOPqxdGlIHH1QsjysDj6oURZeBx9cKIMvC4emFEGXhcvTCiDDyuXhhRBh5XL4woA4+rF0aUgcfVCyPKwOPqhRFl4HH1wogy8Lh6YUQZeFy9MKIMPK5eGFEGHlcvjCgDj6sXRpSBx9ULI8rA4+qFEWXgcfXCiDLwuHphRBl4XL0wogw8rl4YUQYeVy+MKAOPqxdGlIHH1QsjysDj6oURZeBx9cKIMvC4emFEGXhcvTCiDDyuXhhRBh5XL4woA4+rF0aUgcfVCyPKwOPqhRFl4HH1wogy8Lh6YUQZeFy9MKIMPK5eGFEGHlcvjCgDj6sXRpSBx9ULI8rA4+qFEWXgcfXCiDLwuHphRBl4XL0wogw8rl4YUQYeVy+MKAOPqxdGlIHH1QsjysDj6oURZeBx9cKIMvC4emFEPTvwz+8f8AwDw2EGhsMMDIcZGA4zMBxmYDjMwHCYgeEwA8NhBobDDAyHGRgOMzAcZmA4zMBwmIHhMAPDYQaGwwwMhxkYDjMwHGZgOMzAcJiB4TADw2EGhsMMDIcZGA5rDsyLeyYOXp+Bx9ULI8rA4+qFEWXgcfXCiDLwuHphRBl4XL0wogw8rl4YUQYeVy+MKAOPqxdGlIHH1QsjysDj6oURZeBx9cKIMvC4emFEGXhcvTCiDDyuXhhRBh5XL4woA4+rF0aUgcfVCyPKwOPqhRFl4HH1wogy8Lh6YUQZeFy9MKIMPK5eGFEGHlcvjCgDj6sXRpSBx9ULI8rA4+qFEWXgcfXCiDLwuHphRBl4XL0wogw8rl4YUQYeVy+MKAOPqxdGlIHH1QsjysDj6oURZeBx9cKIMvC4emFEGXhcvTCiDDyuXhhRBh5XL4woA4+rF0aUgcfVCyPKwOPqhRFl4HH1wogy8Lh6YUQZeFy9MKIMPK5eGFEGHlcvjCgDj6sXRpSBx9ULI8rA4+qFEWXgcfXCiDLwuHphRBl4XL0wogw8rl4YUQYeVy+MKAOPqxdGlIHH1QsjysDj6oURZeBx9cKIMvC4emFEGXhcvTCiDDyuXhhRBh5XL4woA4+rF0aUgcfVCyPKwOPqhRFl4HH1wogy8Lh6YUQZeFy9MKIMPK5eGFEGHlcvjCgDj6sXRpSBx9ULI8rA4+qFEfUPCJOAqqRYDC4AAAAASUVORK5CYII=",
      "base64",
    );
    const checksum = createHash("sha256").update(bytes).digest("hex");
    mkdirSync(join(dataDirectory, "media"), { recursive: true, mode: 0o700 });
    const canonicalName = `${fixture.canonicalAssetId}.png`;
    const aliasName = `${fixture.aliasAssetId}.png`;
    writeFileSync(join(dataDirectory, "media", canonicalName), bytes, { flag: "wx", mode: 0o600 });
    writeFileSync(join(dataDirectory, "media", aliasName), bytes, { flag: "wx", mode: 0o600 });
    for (const [assetId, storageName] of [[fixture.canonicalAssetId, canonicalName], [fixture.aliasAssetId, aliasName]]) {
      database.prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
          storage_backend, object_key, content_type, checksum_sha256,
          storage_status, duration_seconds, duration_source, duration_status,
          media_width, media_height
        ) VALUES ('image', ?, ?, ?, ?, ?, ?, 'local', ?, 'image/png', ?,
          'ready', NULL, NULL, 'not-applicable', 320, 180)
      `).run(assetId, fixture.ownerId, storageName, bytes.length, now, now, storageName, checksum);
    }
    const pngBytes = Buffer.from(bytes);
    const pngChecksum = createHash("sha256").update(pngBytes).digest("hex");
    const pngStorageName = `${fixture.pngAssetId}.png`;
    writeFileSync(join(dataDirectory, "media", pngStorageName), pngBytes, { flag: "wx", mode: 0o600 });
    database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height
      ) VALUES ('image', ?, ?, ?, ?, ?, ?, 'local', ?, 'image/png', ?,
        'ready', NULL, NULL, 'not-applicable', 320, 180)
    `).run(fixture.pngAssetId, fixture.ownerId, pngStorageName, pngBytes.length, now, now, pngStorageName, pngChecksum);

    const planNodes = semantic.nodes.map((nodePlan) => {
      const node = graph.nodes.find((candidate) => candidate.id === nodePlan.id);
      const model = { text: runtimeTextModel, image: runtimeImageModel, video: runtimeVideoModel }[nodePlan.kind];
      const release = releases[nodePlan.kind];
      if (!model || !release) throw new Error(`media acceptance model contract is missing for ${nodePlan.kind}`);
      return Object.freeze({
        ...nodePlan,
        costCurrency: "CNY",
        modelConfigurationRevision: model.configurationRevision,
        modelReleaseRevision: release,
        providerDriver: model.providerDriver,
        providerModelId: model.providerModelId,
        providerProfileId: model.providerProfileId,
        providerProtocol: model.providerProtocol,
        recoveryEvidence: "stored local media publication acceptance result",
        recoveryGrade: "STORED_RESPONSE_OR_FENCED_UNKNOWN",
        _fixtureNode: node,
        _fixtureModel: model,
        _fixtureRelease: release,
      });
    });
    const parentPlan = {
      clientSemanticFingerprint: semantic.semanticFingerprint,
      edges: semantic.edges,
      executableNodeIds: semantic.executableNodeIds,
      externalNodes: [],
      groupId: fixture.groupId,
      nodes: planNodes.map(({ _fixtureNode, _fixtureModel, _fixtureRelease, ...node }) => node),
      semanticFingerprint: "wf1-media-publication-parent-plan",
      version: 1,
    };
    const saveRaceNode = graph.nodes.find((node) => node.id === fixture.saveRaceNodeId);
    if (!saveRaceNode) throw new Error("media acceptance save-race node is missing");
    const saveRaceIdentity = identityFor({
      database,
      node: saveRaceNode,
      release: activeVideoRelease,
      model: runtimeVideoModel,
      modelParameters: modelParametersModule,
      inputPreflight: inputPreflightModule,
      identity: identityModule,
    });
    const { workflowBinding: _saveRaceWorkflowBinding, ...saveRaceModelConfiguration } =
      taskConfig(
        { kind: "video" },
        runtimeVideoModel,
        activeVideoRelease,
        saveRaceIdentity,
        "media-publication-save-race-reservation",
        "media-publication-save-race-run",
      );
    database.prepare(`
      INSERT INTO workflow_runs (
        id, owner_id, canvas_id, group_id, graph_revision, semantic_fingerprint,
        plan_json, state, stop_requested, reservation_id, error_code,
        error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', 0, ?, 'GENERATION_FAILED',
        '本地合成的历史整组失败记录', ?, ?)
    `).run(
      fixture.parentRunId,
      fixture.ownerId,
      fixture.canvasId,
      fixture.groupId,
      graphRevision,
      parentPlan.semanticFingerprint,
      JSON.stringify(parentPlan),
      fixture.reservationId,
      now,
      now,
    );
    database.prepare(`
      INSERT INTO media_capacity_reservations (
        id, owner_id, workflow_run_id, reserved_bytes, state, expires_at,
        created_at, updated_at, released_at
      ) VALUES (?, ?, ?, 1048576, 'released', ?, ?, ?, ?)
    `).run(fixture.reservationId, fixture.ownerId, fixture.parentRunId, now, now, now, now);

    const preservedTaskIds = new Map();
    for (const [index, nodeId] of fixture.preservedNodeIds.entries()) {
      const nodePlan = planNodes.find((candidate) => candidate.id === nodeId);
      const identity = identityFor({
        database,
        node: nodePlan._fixtureNode,
        release: nodePlan._fixtureRelease,
        model: nodePlan._fixtureModel,
        modelParameters: modelParametersModule,
        inputPreflight: inputPreflightModule,
        identity: identityModule,
      });
      const id = `media-publication-preserved-task-${index + 1}`;
      preservedTaskIds.set(nodeId, id);
      insertTask(database, {
        id,
        node: nodePlan._fixtureNode,
        nodePlan,
        model: nodePlan._fixtureModel,
        release: nodePlan._fixtureRelease,
        identity,
        state: "success",
        resultText: `已保存的本地文字结果 ${index + 1}`,
        reservationId: fixture.reservationId,
        runId: fixture.parentRunId,
      });
    }
    const adoptionPlan = planNodes.find((candidate) => candidate.id === fixture.adoptionNodeId);
    const adoptionIdentity = identityFor({
      database,
      node: adoptionPlan._fixtureNode,
      release: adoptionPlan._fixtureRelease,
      model: adoptionPlan._fixtureModel,
      modelParameters: modelParametersModule,
      inputPreflight: inputPreflightModule,
      identity: identityModule,
    });
    insertTask(database, {
      id: fixture.adoptionTaskId,
      node: adoptionPlan._fixtureNode,
      nodePlan: adoptionPlan,
      model: adoptionPlan._fixtureModel,
      release: adoptionPlan._fixtureRelease,
      identity: adoptionIdentity,
      state: "failed",
      providerTaskId: "media-publication-original-provider-task",
      reservationId: fixture.reservationId,
      runId: fixture.parentRunId,
    });

    for (const nodePlan of parentPlan.nodes) {
      const taskId = preservedTaskIds.get(nodePlan.id) ?? (nodePlan.id === fixture.adoptionNodeId ? fixture.adoptionTaskId : null);
      const state = taskId
        ? nodePlan.id === fixture.adoptionNodeId ? "failed" : "success"
        : "pending";
      const errorCode = state === "failed" ? "GENERATION_FAILED" : null;
      const errorMessage = state === "failed" ? "历史 PNG 结果格式无法直接发布" : null;
      database.prepare(`
        INSERT INTO workflow_run_nodes (
          run_id, owner_id, node_id, kind, plan_index, dependencies_json,
          semantic_identity, idempotency_key, state, task_id, projection_state,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        fixture.parentRunId,
        fixture.ownerId,
        nodePlan.id,
        nodePlan.kind,
        nodePlan.planIndex,
        JSON.stringify(nodePlan.dependencies),
        nodePlan.semanticIdentity,
        `media-parent-${nodePlan.id}`,
        state,
        taskId,
        state === "success" ? "applied" : "pending",
        errorCode,
        errorMessage,
        now,
        now,
      );
    }

    insertPublication(database, {
      attemptId: fixture.failedAttemptId,
      assetId: fixture.failedAssetId,
      state: "failed",
      kind: "image",
      storageName: `${fixture.failedAssetId}.png`,
      stagingName: ".media-publication-failed.staging",
      byteSize: 0,
      checksum: null,
      contentType: "image/png",
      mediaWidth: 320,
      mediaHeight: 180,
      errorCode: "MEDIA_RECOVERY_EVIDENCE_MISSING",
    });
    insertPublication(database, {
      attemptId: fixture.canonicalAttemptId,
      assetId: fixture.canonicalAssetId,
      state: "published",
      storageName: canonicalName,
      stagingName: ".media-publication-canonical.staging",
      byteSize: bytes.length,
      checksum,
      kind: "image",
      contentType: "image/png",
      mediaWidth: 320,
      mediaHeight: 180,
    });
    insertPublication(database, {
      attemptId: fixture.aliasAttemptId,
      assetId: fixture.aliasAssetId,
      state: "published",
      storageName: aliasName,
      stagingName: ".media-publication-alias.staging",
      byteSize: bytes.length,
      checksum,
      kind: "image",
      contentType: "image/png",
      mediaWidth: 320,
      mediaHeight: 180,
    });

    database.exec("BEGIN IMMEDIATE");
    databaseModule.applyPendingSchemaMigrationsInTransaction(database, { sourceVersion: 43, targetVersion: 44, appliedAt: () => now });
    database.exec("COMMIT");
    if (!databaseModule.databaseMatchesSchemaContract(database)) throw new Error("Acceptance fixture physical schema does not match the product contract");
    databaseModule.openAppDatabase(dataDirectory).close();
    database.close();
    return Object.freeze({
      fixture,
      graph,
      releases,
      models: Object.freeze({ text: runtimeTextModel, image: runtimeImageModel, video: runtimeVideoModel }),
      videoCredentialVersion: credential.credentialVersion,
      parentPlan,
      baselineGraphDigest: createHash("sha256").update(JSON.stringify({ nodes: graph.nodes, edges: graph.edges })).digest("hex"),
      initialSuccessNodeIds: Object.freeze([...fixture.preservedNodeIds]),
      saveRaceParameters: Object.freeze(saveRaceIdentity.parameters),
      saveRacePrompt: saveRaceIdentity.persisted.persistedOwnPrompt,
      saveRaceModelConfiguration: Object.freeze(saveRaceModelConfiguration),
    });
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
    throw error;
  }
}
