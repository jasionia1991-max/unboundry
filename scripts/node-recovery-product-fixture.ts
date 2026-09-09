import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveAccountCredential } from "../server/accountCredentials";
import { openAppDatabase } from "../server/database";
import { resolvePersistedNodeInputs } from "../server/inputPreflight";
import { registerMediaForOwner } from "../server/mediaRegistry";
import { bootstrapPublishedModelContracts } from "../server/modelReleaseBootstrap";
import { modelContractState } from "../server/modelReleaseRevisionStore";
import { registeredModelExecution } from "../server/modelExecutionRegistry";
import { authoritativeModelConfigurationRevision } from "../server/modelConfigurationIdentity";
import { buildAuthoritativeGenerationModelConfiguration } from
  "../server/authoritativeGenerationModelConfiguration";
import { createGenerationRecoveryCaseStore } from "../server/generationRecoveryCaseStore";
import { createGenerationRecoveryOriginalCommands } from
  "../server/generationRecoveryOriginalCommands";
import { readOriginalGenerationRecoveryLedgers } from
  "../server/generationRecoveryLedgerQueries";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import type {
  GenerationProviderAttemptEvidence,
  GenerationTask,
} from "../server/generationTaskStore";
import { saveProviderProfile } from "../server/providerProfiles";
import { providerParameterSchema } from "../types/modelParameters";
import {
  generationInputKey,
  generationOwnershipEvidence,
  generationOwnershipKey,
} from "../types/generationIdentity";

type FixtureInput = Readonly<{
  canvasId: string;
  ownerId: string;
  sourceRoot: string;
}>;

type ProductTaskRole = "originalResult" | "maintenance" | "maintenanceResult" | "failedVideo";

const providerModelId = "grok-imagine-video-1.5-preview";
const modelId = "node-recovery-v4-grok-model";
// Match the ordinary Canvas client scope; all data already lives in a fresh temporary database.
const fixtureScopeId = "";
const sourceAssetId = "node-recovery-product-source";
const maintenanceResultNodeId = "node-recovery-maintenance-result";
const providerTaskIds: Record<ProductTaskRole, string> = {
  originalResult: "node-recovery-original-provider",
  maintenance: "node-recovery-maintenance-provider",
  maintenanceResult: "node-recovery-maintenance-result-provider",
  failedVideo: "node-recovery-failed-provider",
};

const now = () => new Date().toISOString();

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function taskRoleForNode(nodeId: string, staticFixture: any): ProductTaskRole {
  if (nodeId === staticFixture.v4.cases.originalResult.nodeId) return "originalResult";
  if (nodeId === staticFixture.v4.cases.maintenance.nodeId) return "maintenance";
  if (nodeId === maintenanceResultNodeId) return "maintenanceResult";
  return "failedVideo";
}

function videoParameters() {
  return {
    aspectRatio: "16:9",
    duration: 5,
    generateAudio: true,
    inputMode: "reference",
    outputCount: 1,
    resolution: "480p",
  } as const;
}

function taskError(role: ProductTaskRole) {
  if (role === "maintenance") {
    return {
      code: "OUTCOME_UNKNOWN_BILLING_RISK",
      message: "本地验收保留一个无法确认的平台请求；不会重复提交。",
    };
  }
  if (role === "maintenanceResult") {
    return {
      code: "OPERATOR_INCIDENT",
      message: "本地验收保留一个可由维护检查找回的平台结果。",
    };
  }
  return {
    code: "OPERATOR_INCIDENT",
    message: role === "originalResult"
      ? "本地验收保留一个待找回原结果的请求。"
      : "本地验收保留一个待核实收费结果的请求。",
  };
}

function readStaticFixture(sourceRoot: string) {
  return JSON.parse(readFileSync(
    join(sourceRoot, "tests/fixtures/node-recovery-acceptance.json"),
    "utf8",
  )) as any;
}

function modelConfigurationFor(input: Readonly<{
  database: ReturnType<typeof openAppDatabase>;
  credentialVersion: number;
  canvasId: string;
  nodeId: string;
  parameters: Record<string, unknown>;
  prompt: string;
  profileId: string;
}>) {
  const model = input.database.prepare(`
    SELECT models.updated_at AS modelConfigurationUpdatedAt,
      providers.provider_configuration_version AS providerConfigurationVersion
    FROM model_profiles AS models
    JOIN provider_profiles AS providers ON providers.id = models.provider_profile_id
    WHERE models.id = ?
  `).get(modelId) as {
    modelConfigurationUpdatedAt: string;
    providerConfigurationVersion: number;
  } | undefined;
  const release = modelContractState(input.database, modelId).active;
  const execution = registeredModelExecution({
    capability: "video",
    providerDriver: "multi-protocol-relay",
    providerModelId,
    providerProtocol: "media-generate",
  });
  if (!model || !release || !execution) {
    throw new Error("Node recovery product model contract is incomplete");
  }
  const schema = release.document.capabilitySchema;
  const configurationRevision = authoritativeModelConfigurationRevision({
    capability: "video",
    id: modelId,
    modelConfigurationUpdatedAt: model.modelConfigurationUpdatedAt,
    parameterSchema: schema,
    providerDriver: "multi-protocol-relay",
    providerModelId,
  });
  return {
    model,
    release,
    execution,
    schema,
    configurationRevision,
    credentialVersion: input.credentialVersion,
  };
}

function nodeData(nodeId: string, title: string, prompt: string, modelConfigurationRevision: string) {
  return {
    title,
    videoModelConfigurationRevision: modelConfigurationRevision,
    videoModelId: modelId,
    videoParameters: videoParameters(),
    videoPrompt: prompt,
    videoPromptReady: true,
  };
}

function insertCanvas(
  database: ReturnType<typeof openAppDatabase>,
  input: FixtureInput,
  fixture: any,
  modelConfigurationRevision: string,
) {
  const sourceNodeId = "node-recovery-product-source-node";
  const successNodes = fixture.successNodes.map((node: any) => ({
    id: node.id,
    type: "text",
    position: node.position,
    data: {
      content: node.resultText,
      label: node.label,
      textPrompt: node.resultText,
      title: node.label,
    },
    style: { width: 260, height: 220 },
  }));
  const source = {
    id: sourceNodeId,
    type: "image",
    position: { x: 1100, y: 1080 },
    data: {
      assetId: sourceAssetId,
      imageSrc: `/api/assets/${sourceAssetId}`,
      label: "Image",
      title: "本地恢复输入素材",
    },
    style: { width: 260, height: 190 },
  };
  const targetDefinitions = [
    [fixture.v4.cases.originalResult.nodeId, "原结果找回（视频）", "原请求结果回填"],
    [fixture.v4.cases.maintenance.nodeId, "平台未确认（视频）", "等待平台回复"],
    [maintenanceResultNodeId, "维护后找回结果（视频）", "维护检查得到原结果"],
    [fixture.v4.cases.failedVideo.nodeId, "失败视频 · 仅此节点补跑", "已核实失败后新一轮"],
  ] as const;
  const targets = targetDefinitions.map(([id, title, prompt], index) => ({
    id,
    type: "video",
    position: { x: 1420, y: 700 + index * 320 },
    data: nodeData(id, title, prompt, modelConfigurationRevision),
    style: { width: 300, height: 240 },
  }));
  const edges = [
    ...fixture.preservedEdges,
    ...targets.map((target, index) => ({
      id: `node-recovery-product-input-edge-${index + 1}`,
      source: sourceNodeId,
      sourceHandle: "source",
      target: target.id,
      targetHandle: "target",
      data: { inputOrder: 1, inputRole: "first-frame" },
    })),
  ];
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_session_id, save_sequence
    ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, NULL, 0)
    ON CONFLICT(owner_id, id) DO UPDATE SET
      revision = excluded.revision, graph_revision = excluded.graph_revision,
      nodes = excluded.nodes, edges = excluded.edges, viewport = excluded.viewport,
      updated_at = excluded.updated_at, save_session_id = NULL, save_sequence = 0
  `).run(
    input.ownerId,
    input.canvasId,
    JSON.stringify([...successNodes, source, ...targets]),
    JSON.stringify(edges),
    JSON.stringify({ x: 0, y: 0, zoom: 0.45 }),
    now(),
  );
  return { sourceNodeId, targets };
}

function updateTaskBindingOnCanvas(
  database: ReturnType<typeof openAppDatabase>,
  input: FixtureInput,
  nodeId: string,
  task: any,
  binding: any,
) {
  const row = database.prepare("SELECT nodes FROM canvas_documents WHERE owner_id = ? AND id = ?")
    .get(input.ownerId, input.canvasId) as { nodes: string } | undefined;
  if (!row) throw new Error("Node recovery product canvas fixture is missing");
  const nodes = JSON.parse(row.nodes) as any[];
  const updated = nodes.map((node) => node.id !== nodeId ? node : ({
    ...node,
    data: {
      ...node.data,
      videoGenerationInputKey: binding.generationInputKey,
      videoGenerationModelConfigurationRevision: binding.modelConfigurationRevision,
      videoGenerationModelInputContractFingerprint: binding.modelInputContractFingerprint,
      videoGenerationModelReleaseRevision: binding.modelReleaseRevision,
      videoGenerationOwnershipKey: binding.generationOwnershipKey,
      videoGenerationTaskId: task.id,
    },
  }));
  database.prepare(`
    UPDATE canvas_documents SET nodes = ?, updated_at = ?
    WHERE owner_id = ? AND id = ?
  `).run(JSON.stringify(updated), now(), input.ownerId, input.canvasId);
}

function settleChargedFailure(
  database: ReturnType<typeof openAppDatabase>,
  task: any,
  caseItem: any,
  profileId: string,
) {
  const commands = createGenerationRecoveryOriginalCommands(database, {
    enabled: true,
    readRelatedLedgers: readOriginalGenerationRecoveryLedgers,
  });
  const captured = commands.captureOriginalRecovery({
    taskId: task.id,
    caseId: caseItem.caseId,
    ownerId: task.ownerId,
    executionAttempt: task.attempt,
  });
  const facts = {
    taskId: task.id,
    ownerId: task.ownerId,
    canvasId: task.canvasId,
    nodeId: task.nodeId,
    kind: "video" as const,
    executionAttempt: task.attempt,
    providerProfileId: profileId,
    providerModelId,
    requestFingerprint: task.requestFingerprint,
    providerTaskId: task.providerTaskId,
    providerState: "failed" as const,
    feeDisposition: "charged" as const,
    observedAt: now(),
  };
  const evidence = commands.issueAdapterVerifiedOriginalRecoveryEvidence(
    facts,
    (candidate) => ({
      adapterId: "node-recovery-loopback-adapter",
      protocolContractId: "media-generate",
      evidenceSha256: hash({
        adapter: "node-recovery-loopback-adapter",
        providerTaskId: candidate.providerTaskId,
        state: candidate.providerState,
        feeDisposition: candidate.feeDisposition,
      }),
    }),
  );
  const command = {
    taskId: task.id,
    caseId: caseItem.caseId,
    ownerId: task.ownerId,
    executionAttempt: task.attempt,
    expectedTaskUpdatedAt: task.updatedAt,
    expectedTaskEventWatermark: captured.taskEventWatermark,
    expectedCaseEventId: captured.caseEventId,
    expected: captured,
    evidence,
    actorId: task.ownerId,
    operationId: `node-recovery-settle-${task.id}`,
  };
  const dryRun = commands.dryRunOriginalRecovery(command);
  if (!dryRun.allowed || dryRun.action !== "settle_charged_failure") {
    throw new Error(`Node recovery product settlement was not admitted: ${dryRun.reasonCode}`);
  }
  return commands.applyOriginalRecovery(command);
}

export type NodeRecoveryProductRetryVerificationInput = Readonly<{
  canvasId: string;
  childTaskId: string;
  dataDirectory: string;
  expectedChildProviderTaskId: string;
  expectedModelId: string;
  expectedParentProviderTaskId: string;
  expectedProviderModelId: string;
  expectedProviderProfileId: string;
  expectedFixtureScopeId: string;
  nodeId: string;
  ownerId: string;
  parentTaskId: string;
}>;

export type NodeRecoveryProductRetryVerification = Readonly<{
  bindingVerified: true;
  childAttempt: number;
  childProviderExecutionAttempt: number;
  childState: "success";
  childTaskId: string;
  parentAttempt: number;
  parentProviderExecutionAttempt: number;
  parentState: "failed";
  parentTaskId: string;
  replacementEventVerified: true;
}>;

function stableVerificationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableVerificationValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableVerificationValue(item)]),
    );
  }
  return value;
}

function sameVerificationValue(left: unknown, right: unknown) {
  return JSON.stringify(stableVerificationValue(left)) ===
    JSON.stringify(stableVerificationValue(right));
}

function eventTargetTaskId(
  event: Readonly<{ errorCode?: string; errorMessage?: string; state: string }>,
  expectedCode: string,
  expectedState: string,
) {
  if (event.errorCode !== expectedCode || event.state !== expectedState ||
      typeof event.errorMessage !== "string") return undefined;
  try {
    const parsed = JSON.parse(event.errorMessage) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.taskId !== "string") {
      return undefined;
    }
    return record.taskId;
  } catch {
    return undefined;
  }
}

function exactReplacementTarget(
  events: ReturnType<ReturnType<typeof createGenerationTaskStore>["listEvents"]>,
  expectedCode: string,
  expectedState: string,
  expectedTaskId: string,
) {
  const matching = events
    .filter((event) => event.errorCode === expectedCode && event.state === expectedState)
    .map((event) => eventTargetTaskId(event, expectedCode, expectedState));
  return matching.length === 1 && matching[0] === expectedTaskId;
}

function requiredBindingIdentity(task: GenerationTask) {
  const configuration = task.modelConfiguration;
  const requiredStringKeys = [
    "generationInputKey",
    "generationOwnershipKey",
    "modelConfigurationRevision",
    "modelExecutionAdapterId",
    "modelId",
    "modelInputContractFingerprint",
    "providerDriver",
    "providerModelId",
    "providerProfileId",
    "providerProtocol",
  ];
  if (
    !task.ownerId || !task.model || !task.providerModelId || !task.providerProfileId ||
    typeof task.credentialRevision !== "number" ||
    !Number.isSafeInteger(task.credentialRevision) || task.credentialRevision < 1 ||
    configuration.generationIdentityVersion !== 2 ||
    configuration.modelResultCount !== 1 ||
    !requiredStringKeys.every((key) =>
      typeof configuration[key] === "string" &&
      (configuration[key] as string).trim().length > 0)
  ) {
    throw new Error("temporary task binding is incomplete");
  }
  const release = configuration.modelReleaseRevision;
  if (!release || typeof release !== "object" || Array.isArray(release) ||
      typeof (release as Record<string, unknown>).revisionId !== "string" ||
      !(release as Record<string, unknown>).revisionId) {
    throw new Error("temporary task release binding is incomplete");
  }
  return {
    canvasId: task.canvasId,
    credentialRevision: task.credentialRevision,
    fixtureScopeId: typeof configuration.fixtureScopeId === "string"
      ? configuration.fixtureScopeId : "",
    generationIdentityVersion: configuration.generationIdentityVersion,
    generationInputKey: configuration.generationInputKey,
    generationOwnershipKey: configuration.generationOwnershipKey,
    kind: task.kind,
    model: task.model,
    modelCapability: configuration.modelCapability,
    modelConfigurationRevision: configuration.modelConfigurationRevision,
    modelExecutionAdapterId: configuration.modelExecutionAdapterId,
    modelId: configuration.modelId,
    modelInputContractFingerprint: configuration.modelInputContractFingerprint,
    modelReleaseRevision: configuration.modelReleaseRevision,
    modelResultCount: configuration.modelResultCount,
    nodeId: task.nodeId,
    ownerId: task.ownerId,
    parameters: task.parameters,
    prompt: task.prompt,
    providerDriver: configuration.providerDriver,
    providerModelId: task.providerModelId,
    providerProfileId: task.providerProfileId,
    providerProtocol: configuration.providerProtocol,
  };
}

function exactProviderAttempt(
  store: ReturnType<typeof createGenerationTaskStore>,
  task: GenerationTask,
  expectedProviderTaskId: string,
): GenerationProviderAttemptEvidence {
  const attempt = store.getProviderAttemptForTask(task.id);
  if (!attempt || attempt.executionAttempt !== task.attempt ||
      attempt.executionAttempt !== 1 || attempt.providerTaskId !== expectedProviderTaskId ||
      attempt.providerModelId !== task.providerModelId ||
      attempt.providerProfileId !== task.providerProfileId ||
      attempt.credentialRevision !== task.credentialRevision) {
    throw new Error("temporary provider attempt binding is incomplete");
  }
  return attempt;
}

/**
 * Read-only product acceptance fence for the real single-node retry. The
 * public task summary intentionally omits the predecessor relation, so this
 * uses the durable replacement events together with the task/attempt ledger.
 */
export function verifyNodeRecoveryProductRetry(
  input: NodeRecoveryProductRetryVerificationInput,
): NodeRecoveryProductRetryVerification {
  const store = createGenerationTaskStore(input.dataDirectory, { recoverRunning: false });
  try {
    const parent = store.get(input.parentTaskId);
    const child = store.get(input.childTaskId);
    if (!parent || !child || parent.id === child.id ||
        parent.state !== "failed" || child.state !== "success" ||
        parent.attempt !== 1 || child.attempt !== 1 ||
        parent.ownerId !== input.ownerId || child.ownerId !== input.ownerId ||
        parent.canvasId !== input.canvasId || child.canvasId !== input.canvasId ||
        parent.nodeId !== input.nodeId || child.nodeId !== input.nodeId ||
        parent.kind !== "video" || child.kind !== "video" ||
        parent.providerTaskId !== input.expectedParentProviderTaskId ||
        child.providerTaskId !== input.expectedChildProviderTaskId) {
      throw new Error("temporary parent or replacement task identity is invalid");
    }

    const parentBinding = requiredBindingIdentity(parent);
    const childBinding = requiredBindingIdentity(child);
    if (
      parentBinding.ownerId !== input.ownerId || childBinding.ownerId !== input.ownerId ||
      parentBinding.canvasId !== input.canvasId || childBinding.canvasId !== input.canvasId ||
      parentBinding.nodeId !== input.nodeId || childBinding.nodeId !== input.nodeId ||
      parentBinding.fixtureScopeId !== input.expectedFixtureScopeId ||
      childBinding.fixtureScopeId !== input.expectedFixtureScopeId ||
      parentBinding.modelId !== input.expectedModelId ||
      childBinding.modelId !== input.expectedModelId ||
      parentBinding.providerModelId !== input.expectedProviderModelId ||
      childBinding.providerModelId !== input.expectedProviderModelId ||
      parentBinding.providerProfileId !== input.expectedProviderProfileId ||
      childBinding.providerProfileId !== input.expectedProviderProfileId ||
      !sameVerificationValue(parentBinding, childBinding)
    ) {
      throw new Error("temporary replacement task binding does not match the failed task");
    }

    const parentEvents = store.listEvents(parent.id);
    const childEvents = store.listEvents(child.id);
    if (
      !exactReplacementTarget(
        childEvents,
        "NEW_GENERATION_REPLACES_FAILED_TASK",
        "queued",
        parent.id,
      ) ||
      !exactReplacementTarget(
        parentEvents,
        "NEW_GENERATION_REQUESTED",
        "failed",
        child.id,
      )
    ) {
      throw new Error("temporary replacement relation is not exact");
    }

    const sameNodeTasks = store.list(input.canvasId).filter((task) =>
      task.ownerId === input.ownerId && task.nodeId === input.nodeId && task.kind === "video");
    const linkedChildren = sameNodeTasks.filter((task) => {
      const events = store.listEvents(task.id);
      return exactReplacementTarget(
        events,
        "NEW_GENERATION_REPLACES_FAILED_TASK",
        "queued",
        parent.id,
      );
    });
    if (linkedChildren.length !== 1 || linkedChildren[0]?.id !== child.id) {
      throw new Error("temporary node has an ambiguous replacement task");
    }

    const parentAttempt = exactProviderAttempt(
      store,
      parent,
      input.expectedParentProviderTaskId,
    );
    const childAttempt = exactProviderAttempt(
      store,
      child,
      input.expectedChildProviderTaskId,
    );
    return {
      bindingVerified: true,
      childAttempt: child.attempt,
      childProviderExecutionAttempt: childAttempt.executionAttempt,
      childState: "success",
      childTaskId: child.id,
      parentAttempt: parent.attempt,
      parentProviderExecutionAttempt: parentAttempt.executionAttempt,
      parentState: "failed",
      parentTaskId: parent.id,
      replacementEventVerified: true,
    };
  } finally {
    store.close();
  }
}

export async function initializeNodeRecoveryProductFixture(input: FixtureInput) {
  const fixture = readStaticFixture(input.sourceRoot);
  const dataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  if (!dataDirectory) throw new Error("Node recovery product fixture requires UNBOUNDRY_DATA_DIR");

  // Provider profiles and credentials are local encrypted fixtures. Establish
  // the current empty DB before the profile document lock is acquired.
  openAppDatabase(dataDirectory).close();
  const profile = await saveProviderProfile({
    apiKey: "node-recovery-product-local-key",
    baseUrl: "https://node-recovery-relay.example.test/v1",
    driver: "multi-protocol-relay",
    label: "Node recovery local relay fixture",
  });
  const database = openAppDatabase(dataDirectory);
  try {
    const timestamp = now();
    database.prepare(`
      UPDATE provider_profiles
      SET status = 'enabled', key_status = 'valid', key_checked_at = ?, updated_at = ?
      WHERE id = ? AND driver = 'multi-protocol-relay'
    `).run(timestamp, timestamp, profile.id);
    const schema = providerParameterSchema({
      capability: "video",
      providerDriver: "multi-protocol-relay",
      providerModelId,
    });
    if (!schema) throw new Error("Node recovery product video schema is missing");
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id, capability,
        status, default_parameters, created_at, updated_at, max_cost_microunits,
        cost_currency, provider_protocol
      ) VALUES (?, ?, ?, ?, 'video', 'published', ?, ?, ?, 5000000, 'USD', 'media-generate')
    `).run(modelId, "Node recovery local video model", profile.id, providerModelId,
      JSON.stringify(schema), timestamp, timestamp);
    database.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order, created_at, updated_at
      ) VALUES ('video', ?, 1, 1, 1, ?, ?)
    `).run(modelId, timestamp, timestamp);
    database.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 1, emergency_stop = 0, per_user_concurrency = 10,
        requests_per_minute = 120, image_concurrency = 5, video_concurrency = 5,
        audio_concurrency = 5, text_concurrency = 5, updated_at = ?
      WHERE id = 1
    `).run(timestamp);
    bootstrapPublishedModelContracts(database, input.ownerId);
    const credential = await saveAccountCredential(
      database, input.ownerId, profile.id, "node-recovery-product-local-account-key",
    );
    database.prepare(`
      UPDATE account_provider_credentials
      SET key_status = 'valid', key_checked_at = ?, updated_at = ?
      WHERE account_id = ? AND provider_profile_id = ?
    `).run(timestamp, timestamp, input.ownerId, profile.id);

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DAAAAEAQEARwbK3gAAAABJRU5ErkJggg==",
      "base64",
    );
    mkdirSync(join(dataDirectory, "media"), { recursive: true });
    const storageName = `${sourceAssetId}.png`;
    writeFileSync(join(dataDirectory, "media", storageName), png, { mode: 0o600 });
    registerMediaForOwner(input.ownerId, {
      byteSize: png.byteLength,
      checksumSha256: createHash("sha256").update(png).digest("hex"),
      contentType: "image/png",
      id: sourceAssetId,
      kind: "image",
      mediaHeight: 1,
      mediaWidth: 1,
      storageName,
      storageStatus: "ready",
    });

    const requestedParameters = { ...videoParameters() };
    const targetModel = modelConfigurationFor({
      database,
      credentialVersion: credential.credentialVersion,
      canvasId: input.canvasId,
      nodeId: fixture.v4.cases.originalResult.nodeId,
      parameters: requestedParameters,
      prompt: "原请求结果回填",
      profileId: profile.id,
    });
    const canvas = insertCanvas(database, input, fixture, targetModel.configurationRevision);
    const store = createGenerationTaskStore(dataDirectory, { recoverRunning: false });
    const cases = createGenerationRecoveryCaseStore(database, { enabled: true });
    const roles: Partial<Record<ProductTaskRole, any>> = {};
    try {
      const targetDefinitions: Array<[string, string, string]> = [
        [fixture.v4.cases.originalResult.nodeId, "原结果找回（视频）", "原请求结果回填"],
        [fixture.v4.cases.maintenance.nodeId, "平台未确认（视频）", "等待平台回复"],
        [maintenanceResultNodeId, "维护后找回结果（视频）", "维护检查得到原结果"],
        [fixture.v4.cases.failedVideo.nodeId, "失败视频 · 仅此节点补跑", "已核实失败后新一轮"],
      ];
      for (const [nodeId, title, prompt] of targetDefinitions) {
        const role = taskRoleForNode(nodeId, fixture);
        const modelConfig = modelConfigurationFor({
          database,
          credentialVersion: credential.credentialVersion,
          canvasId: input.canvasId,
          nodeId,
          parameters: requestedParameters,
          prompt,
          profileId: profile.id,
        });
        const resolved = resolvePersistedNodeInputs({
          bypass: false,
          canvasId: input.canvasId,
          database,
          modelReleaseRevision: modelConfig.release.revisionId,
          modelSchema: modelConfig.schema,
          ownerId: input.ownerId,
          parameters: requestedParameters,
          targetId: nodeId,
          targetKind: "video",
        });
        if (!resolved.canSubmit || !resolved.contractFingerprint) {
          throw new Error(`Node recovery product input binding failed: ${nodeId}`);
        }
        const normalizedParameters = { ...(resolved.normalizedParameters ?? requestedParameters) };
        const inputKey = generationInputKey({
          inputs: resolved.inputs,
          modelConfigurationRevision: modelConfig.configurationRevision,
          modelId,
          modelReleaseRevision: modelConfig.release.revisionId,
          ownPrompt: resolved.persistedOwnPrompt,
          parameters: normalizedParameters,
          prompt: resolved.finalPrompt,
        });
        const ownershipKey = generationOwnershipKey(generationOwnershipEvidence({
          contractFingerprint: resolved.contractFingerprint,
          inputs: resolved.inputs,
          kind: "video",
          modelConfigurationRevision: modelConfig.configurationRevision,
          modelId,
          modelReleaseRevision: modelConfig.release.revisionId,
          parameters: normalizedParameters,
          prompt: resolved.persistedOwnPrompt,
        }));
        const modelConfiguration = buildAuthoritativeGenerationModelConfiguration({
          credentialVersion: credential.credentialVersion,
          fixtureScopeId,
          generationInputKey: inputKey,
          generationOwnershipKey: ownershipKey,
          modelCapability: "video",
          modelConfigurationRevision: modelConfig.configurationRevision,
          modelExecutionAdapterId: modelConfig.execution.adapterId,
          modelId,
          modelInputContractFingerprint: resolved.contractFingerprint,
          modelReleaseRevision: modelConfig.release,
          modelResultCount: modelConfig.execution.resultCount,
          parameterSchema: modelConfig.schema,
          providerConfigurationVersion: modelConfig.model.providerConfigurationVersion,
          providerDriver: "multi-protocol-relay",
          providerModelId,
          providerProfileId: profile.id,
          providerProtocol: "media-generate",
        });
        const parameters = {
          ...normalizedParameters,
          inputSchemaVersion: 1,
          inputs: resolved.snapshot,
        };
        const requestIntent = {
          canvasId: input.canvasId,
          fixtureScopeId,
          generationIdentityVersion: 2,
          generationInputKey: inputKey,
          generationOwnershipKey: ownershipKey,
          inputSchemaVersion: 1,
          inputs: resolved.snapshot,
          kind: "video" as const,
          model: modelId,
          modelConfigurationRevision: modelConfig.configurationRevision,
          modelInputContractFingerprint: resolved.contractFingerprint,
          modelReleaseRevision: modelConfig.release.revisionId,
          nodeId,
          parameters: normalizedParameters,
          prompt: resolved.finalPrompt,
        };
        const admitted = store.admitAuthoritativeOrGet({
          canvasId: input.canvasId,
          expectedCanvasRevision: 1,
          costCurrency: "USD",
          credentialRevision: credential.credentialVersion,
          estimatedCostMicrounits: 5_000_000,
          idempotencyKey: `node-recovery-product-${role}`,
          kind: "video",
          model: modelId,
          modelConfiguration,
          nodeId,
          ownerId: input.ownerId,
          parameters,
          prompt: resolved.finalPrompt,
          providerModelId,
          providerProfileId: profile.id,
          requestIntent,
        });
        const task = admitted.task;
        updateTaskBindingOnCanvas(database, input, nodeId, task, {
          generationInputKey: inputKey,
          generationOwnershipKey: ownershipKey,
          modelConfigurationRevision: modelConfig.configurationRevision,
          modelInputContractFingerprint: resolved.contractFingerprint,
          modelReleaseRevision: modelConfig.release.revisionId,
        });
        store.transition(task.id, "running");
        store.recordProviderAttempt(task.id);
        store.setProviderTaskId(task.id, providerTaskIds[role]);
        const running = store.get(task.id);
        if (!running) throw new Error("Node recovery product task disappeared");
        database.prepare(`
          UPDATE generation_provider_attempts
          SET outcome = 'outcome-unknown', failure_code = 'OUTCOME_UNKNOWN_BILLING_RISK'
          WHERE task_id = ? AND execution_attempt = ? AND provider_task_id = ?
        `).run(task.id, running.attempt, providerTaskIds[role]);
        const error = taskError(role);
        store.transition(task.id, "failed", error);
        const failed = store.get(task.id);
        if (!failed) throw new Error("Node recovery product failed task disappeared");
        const caseItem = cases.ensureCase({
          taskId: failed.id,
          ownerId: input.ownerId,
          executionAttempt: failed.attempt,
          reason: role === "maintenance" ? "outcome_unknown" : role === "originalResult" || role === "maintenanceResult"
            ? "result_recovery_pending" : "operator_incident",
          operationId: `node-recovery-open-${role}`,
          actorId: input.ownerId,
        });
        roles[role] = {
          caseId: caseItem.caseId,
          taskId: failed.id,
          nodeId,
          providerTaskId: providerTaskIds[role],
          kind: "video",
          executionAttempt: failed.attempt,
          reasonCode: caseItem.reason,
          title,
          prompt,
        };
        if (role === "failedVideo") {
          settleChargedFailure(database, failed, caseItem, profile.id);
        }
      }
    } finally {
      store.close();
    }
    return {
      syntheticOnly: true,
      fixtureScopeId,
      canvasId: input.canvasId,
      ownerId: input.ownerId,
      profileId: profile.id,
      providerModelId,
      modelId,
      sourceAssetId,
      sourceNodeId: canvas.sourceNodeId,
      roles,
      targetNodeIds: canvas.targets.map((node: any) => node.id),
      providerBaseUrl: "https://node-recovery-relay.example.test/v1",
      preservedSuccessNodeIds: fixture.successNodes.map((node: any) => node.id),
      preservedSuccessNodeCount: fixture.preservedSuccessNodeCount,
    };
  } finally {
    database.close();
  }
}
