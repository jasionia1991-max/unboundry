import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { createCanvasCommandsApi } from "../server/canvasCommandsApi";
import { authGate } from "../server/auth";
import {
  applyCanvasUserCommandInTransaction,
  CanvasGenerationBindingConflictError,
  CanvasMutationGatewayUnavailableError,
  setGenerationProjectionReceiptFaultForTests,
} from "../server/canvasMutationGateway";
import {
  applyCanvasUserCommand,
  canvasTopologyAffectedDigest,
} from "../server/canvasTransactionCommands";
import { closeRuntimeDatabaseTransactions, openAppDatabase } from "../server/database";
import { admitPreparedGenerationTask, GenerationAdmissionPostCommitError } from
  "../server/generationAdmissionApplication";
import {
  resetCanvasObservabilityForTests,
  snapshotCanvasObservabilityForTests,
} from "../server/canvasObservability";
import {
  GenerationTaskCanvasRevisionConflictError,
  GenerationTaskConflictError,
  type AuthoritativeGenerationTaskInput,
} from "../server/generationTaskStore";
import {
  generationTaskApplication,
  launchGenerationTaskForRuntimeTest,
  resetGenerationTaskStoreForRuntimeTest,
} from "../server/generationTasks";
import { buildAuthoritativeGenerationModelConfiguration } from
  "../server/authoritativeGenerationModelConfiguration";
import { defaultModelReleaseDocument } from "../server/modelReleaseDefaults";
import { inspectModelReleaseDocument } from "../server/modelReleaseRevisionStore";
import { registeredModelExecution } from "../server/modelExecutionRegistry";
import { resolvePersistedNodeInputs } from "../server/inputPreflight";
import type {
  ApplyUserFieldChangesCommand,
  CanvasUserCommand,
  CommitUserLayoutCommand,
  CreateCanvasDocumentCommand,
} from "../types/canvasCommands";
import {
  parseCanvasUserCommand,
} from "../types/canvasCommands";
import { stableSha256 } from "../types/canvasFingerprint";
import {
  generationInputKey,
  imageGenerationToolOwnershipEvidence,
  generationOwnershipEvidence,
  generationOwnershipKey,
} from "../types/generationIdentity";
import { knownModelParameterSchema } from "../types/modelParameters";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";
import type { ImageGenerationToolInput } from "../types/imageTools";
import { commitGenerationTextResult } from "../server/generationResultCommit";
import {
  retrySingleNodeCanvasProjections,
  setSingleNodeProjectionSettlementFaultForTests,
  singleNodeCanvasProjectionCandidateCount,
} from "../server/generationCanvasProjectionService";
import { inspectSingleNodeGenerationCanvasState } from
  "../server/generationCanvasProjection";

const ownerId = "m104-owner";
const generationOwnerId = "__test__";
const viewport = { x: 0, y: 0, zoom: 1 } as const;

function textNode(id = "text-node") {
  return {
    data: {
      label: id,
      textModelId: "text-model",
      textPrompt: "initial prompt",
      title: "Initial title",
    },
    id,
    position: { x: 10, y: 20 },
    type: "text",
  };
}

function atomicGenerationContract() {
  const modelId = "m104-atomic-text-model";
  const providerModelId = "doubao-seed-2-0-lite-260428";
  const providerProfileId = "m104-atomic-provider";
  const providerDriver = "volcengine-ark";
  const providerProtocol = "native" as const;
  const parameterSchema = knownModelParameterSchema({
    capability: "text",
    providerDriver,
    providerModelId,
  });
  const modelReleaseDocument = defaultModelReleaseDocument({
    capability: "text",
    capabilitySchema: parameterSchema,
    modelId,
    providerDriver,
    providerModelId,
    providerProfileId,
    providerProtocol,
  });
  const proof = inspectModelReleaseDocument(modelReleaseDocument);
  const modelReleaseRevision: ModelReleaseRevision = {
    createdAt: "2026-09-04T00:00:00.000Z",
    document: modelReleaseDocument,
    hash: proof.documentHash,
    modelId,
    revisionId: "00000000-0000-4000-8000-000000000104",
    revisionNumber: 1,
    validation: {
      compilerHash: proof.compilerHash,
      impact: {
        incompatibleTemplateIds: [],
        templateIds: [],
      },
      paidProviderRequests: 0,
      preview: { modes: [] },
      validatedAt: "2026-09-04T00:00:00.000Z",
    },
  };
  const execution = registeredModelExecution({
    capability: "text",
    providerDriver,
    providerModelId,
    providerProtocol,
  });
  if (!execution) throw new Error("M104 atomic text adapter is missing");
  return {
    credentialVersion: 1,
    fixtureScopeId: "m104-atomic-safe-fixture",
    modelCapability: "text",
    modelConfigurationRevision: "m104-atomic-text-configuration",
    modelExecutionAdapterId: execution.adapterId,
    modelId,
    modelReleaseRevision,
    modelResultCount: execution.resultCount,
    parameterSchema,
    providerConfigurationVersion: 1,
    providerDriver,
    providerModelId,
    providerProfileId,
    providerProtocol,
  } as const;
}

function atomicImageGenerationContract() {
  const modelId = "m104-atomic-image-model";
  const providerModelId = "gpt-image-2";
  const providerProfileId = "m104-atomic-image-provider";
  const providerDriver = "multi-protocol-relay";
  const providerProtocol = "gpt-image" as const;
  const parameterSchema = knownModelParameterSchema({
    capability: "image",
    providerDriver,
    providerModelId,
  });
  const modelReleaseDocument = defaultModelReleaseDocument({
    capability: "image",
    capabilitySchema: parameterSchema,
    modelId,
    providerDriver,
    providerModelId,
    providerProfileId,
    providerProtocol,
  });
  const proof = inspectModelReleaseDocument(modelReleaseDocument);
  const modelReleaseRevision: ModelReleaseRevision = {
    createdAt: "2026-09-04T00:00:00.000Z",
    document: modelReleaseDocument,
    hash: proof.documentHash,
    modelId,
    revisionId: "00000000-0000-4000-8000-000000000204",
    revisionNumber: 1,
    validation: {
      compilerHash: proof.compilerHash,
      impact: { incompatibleTemplateIds: [], templateIds: [] },
      paidProviderRequests: 0,
      preview: { modes: [] },
      validatedAt: "2026-09-04T00:00:00.000Z",
    },
  };
  const execution = registeredModelExecution({
    capability: "image",
    providerDriver,
    providerModelId,
    providerProtocol,
  });
  if (!execution) throw new Error("M104 atomic image adapter is missing");
  return {
    credentialVersion: 1,
    fixtureScopeId: "m104-atomic-image-safe-fixture",
    modelCapability: "image",
    modelConfigurationRevision: "m104-atomic-image-configuration",
    modelExecutionAdapterId: execution.adapterId,
    modelId,
    modelReleaseRevision,
    modelResultCount: execution.resultCount,
    parameterSchema,
    providerConfigurationVersion: 1,
    providerDriver,
    providerModelId,
    providerProfileId,
    providerProtocol,
  } as const;
}

function atomicVideoGenerationContract() {
  const modelId = "m104-atomic-video-model";
  const providerModelId = "grok-video-3";
  const providerProfileId = "m104-atomic-video-provider";
  const providerDriver = "multi-protocol-relay";
  const providerProtocol = "media-generate" as const;
  const parameterSchema = knownModelParameterSchema({
    capability: "video",
    providerDriver,
    providerModelId,
  });
  const modelReleaseDocument = defaultModelReleaseDocument({
    capability: "video",
    capabilitySchema: parameterSchema,
    modelId,
    providerDriver,
    providerModelId,
    providerProfileId,
    providerProtocol,
  });
  const proof = inspectModelReleaseDocument(modelReleaseDocument);
  const modelReleaseRevision: ModelReleaseRevision = {
    createdAt: "2026-09-04T00:00:00.000Z",
    document: modelReleaseDocument,
    hash: proof.documentHash,
    modelId,
    revisionId: "00000000-0000-4000-8000-000000000304",
    revisionNumber: 1,
    validation: {
      compilerHash: proof.compilerHash,
      impact: { incompatibleTemplateIds: [], templateIds: [] },
      paidProviderRequests: 0,
      preview: { modes: [] },
      validatedAt: "2026-09-04T00:00:00.000Z",
    },
  };
  const execution = registeredModelExecution({
    capability: "video",
    providerDriver,
    providerModelId,
    providerProtocol,
  });
  if (!execution) throw new Error("M104 atomic video adapter is missing");
  return {
    credentialVersion: 1,
    fixtureScopeId: "m104-atomic-video-safe-fixture",
    modelCapability: "video",
    modelConfigurationRevision: "m104-atomic-video-configuration",
    modelExecutionAdapterId: execution.adapterId,
    modelId,
    modelReleaseRevision,
    modelResultCount: execution.resultCount,
    parameterSchema,
    providerConfigurationVersion: 1,
    providerDriver,
    providerModelId,
    providerProfileId,
    providerProtocol,
  } as const;
}

function insertGenerationCanvas(
  database: DatabaseSync,
  canvasId: string,
  nodeId: string,
  modelId: string,
  modelConfigurationRevision: string,
  prompt: string,
) {
  const node = {
    data: {
      label: nodeId,
      textModelConfigurationRevision: modelConfigurationRevision,
      textModelId: modelId,
      textParameters: {},
      textPrompt: prompt,
      title: "Atomic generation node",
    },
    id: nodeId,
    position: { x: 10, y: 20 },
    type: "text",
  };
  const timestamp = "2026-09-04T00:00:00.000Z";
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_session_id, save_sequence
    ) VALUES (?, ?, 1, 1, ?, '[]', ?, ?, 'm104-generation-session', 1)
  `).run(
    generationOwnerId,
    canvasId,
    JSON.stringify([node]),
    JSON.stringify(viewport),
    timestamp,
  );
}

function generationCanvasRow(database: DatabaseSync, canvasId: string) {
  return database.prepare(`
    SELECT revision, graph_revision, nodes, edges, viewport
    FROM canvas_documents
    WHERE owner_id = ? AND id = ?
  `).get(generationOwnerId, canvasId) as {
    edges: string;
    graph_revision: number;
    nodes: string;
    revision: number;
    viewport: string;
  };
}

function generationFixture(
  database: DatabaseSync,
  canvasId: string,
  idempotencyKey: string,
  prompt: string,
  contract: ReturnType<typeof atomicGenerationContract>,
) {
  const nodeId = "m104-atomic-generation-node";
  insertGenerationCanvas(
    database,
    canvasId,
    nodeId,
    contract.modelId,
    contract.modelConfigurationRevision,
    prompt,
  );
  const resolved = resolvePersistedNodeInputs({
    bypass: false,
    canvasId,
    database,
    modelReleaseRevision: contract.modelReleaseRevision.revisionId,
    modelSchema: contract.parameterSchema,
    ownerId: generationOwnerId,
    parameters: {},
    targetId: nodeId,
    targetKind: "text",
  });
  const normalizedParameters = resolved.normalizedParameters ?? {};
  const contractFingerprint = resolved.contractFingerprint;
  if (!contractFingerprint) {
    throw new Error("M104 atomic fixture contract fingerprint is missing");
  }
  const inputFingerprint = generationInputKey({
    inputs: resolved.inputs,
    modelConfigurationRevision: contract.modelConfigurationRevision,
    modelId: contract.modelId,
    modelReleaseRevision: contract.modelReleaseRevision.revisionId,
    ownPrompt: resolved.persistedOwnPrompt,
    parameters: normalizedParameters,
    prompt: resolved.finalPrompt,
  });
  const ownershipKey = generationOwnershipKey(generationOwnershipEvidence({
    contractFingerprint,
    inputs: resolved.inputs,
    kind: "text",
    modelConfigurationRevision: contract.modelConfigurationRevision,
    modelId: contract.modelId,
    modelReleaseRevision: contract.modelReleaseRevision.revisionId,
    parameters: normalizedParameters,
    prompt: resolved.persistedOwnPrompt,
  }));
  const modelConfiguration = buildAuthoritativeGenerationModelConfiguration({
    ...contract,
    generationInputKey: inputFingerprint,
    generationOwnershipKey: ownershipKey,
    modelInputContractFingerprint: contractFingerprint,
  });
  const parameters = {
    ...normalizedParameters,
    inputSchemaVersion: 1,
    inputs: [],
  };
  const requestIntent = {
    canvasId,
    fixtureScopeId: contract.fixtureScopeId,
    generationIdentityVersion: 2,
    generationInputKey: inputFingerprint,
    generationOwnershipKey: ownershipKey,
    kind: "text",
    model: contract.modelId,
    modelConfigurationRevision: contract.modelConfigurationRevision,
    modelInputContractFingerprint: contractFingerprint,
    modelReleaseRevision: contract.modelReleaseRevision.revisionId,
    nodeId,
    parameters,
    prompt,
  };
  const input: AuthoritativeGenerationTaskInput = {
    canvasId,
    credentialRevision: contract.credentialVersion,
    expectedCanvasRevision: 1,
    idempotencyKey,
    kind: "text",
    model: contract.modelId,
    modelConfiguration,
    nodeId,
    ownerId: generationOwnerId,
    parameters,
    prompt,
    providerModelId: contract.providerModelId,
    providerProfileId: contract.providerProfileId,
    requestIntent,
  };
  return { input, modelConfiguration, nodeId };
}

function imageGenerationFixture(
  database: DatabaseSync,
  canvasId: string,
  idempotencyKey: string,
  contract: ReturnType<typeof atomicImageGenerationContract>,
) {
  const sourceNodeId = "m104-atomic-image-source";
  const nodeId = "m104-atomic-image-target";
  const sourceAssetId = `m104-source-${randomUUID()}`;
  const maskAssetId = `m104-mask-${randomUUID()}`;
  const timestamp = "2026-09-04T00:00:00.000Z";
  database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, object_key, content_type, checksum_sha256,
      storage_status, duration_status, media_width, media_height
    ) VALUES ('image', ?, ?, ?, 16, ?, ?, 'local', ?, 'image/png', ?,
      'ready', 'not-applicable', 1280, 720)
  `).run(
    sourceAssetId,
    generationOwnerId,
    `${sourceAssetId}.png`,
    timestamp,
    timestamp,
    `${sourceAssetId}.png`,
    "a".repeat(64),
  );
  const prompt = "m104 atomic image tool prompt";
  const nodes = [{
    data: {
      assetId: sourceAssetId,
      imageSrc: `/api/assets/${sourceAssetId}`,
      mediaByteSize: 16,
      mediaContentType: "image/png",
      mediaHeight: 720,
      mediaMetadataSource: "server",
      mediaMetadataStatus: "ready",
      mediaStorageBackend: "local",
      mediaWidth: 1280,
      title: "Image tool source",
    },
    id: sourceNodeId,
    position: { x: 10, y: 20 },
    type: "image",
  }, {
    data: {
      imageModelConfigurationRevision: contract.modelConfigurationRevision,
      imageModelId: contract.modelId,
      imageParameters: { inputMode: "image" },
      imagePrompt: prompt,
      imagePromptReady: true,
      imageToolMaskFeatherPixels: 8,
      title: "Image tool target",
    },
    id: nodeId,
    position: { x: 400, y: 20 },
    type: "image",
  }];
  const edges = [{
    data: { inputOrder: 1, inputRole: "reference-image" },
    id: "m104-atomic-image-edge",
    source: sourceNodeId,
    sourceHandle: "source",
    target: nodeId,
    targetHandle: "target",
  }];
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_session_id, save_sequence
    ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, 'm104-image-session', 1)
  `).run(
    generationOwnerId,
    canvasId,
    JSON.stringify(nodes),
    JSON.stringify(edges),
    JSON.stringify(viewport),
    timestamp,
  );
  const resolved = resolvePersistedNodeInputs({
    bypass: false,
    canvasId,
    database,
    modelReleaseRevision: contract.modelReleaseRevision.revisionId,
    modelSchema: contract.parameterSchema,
    ownerId: generationOwnerId,
    parameters: { inputMode: "image" },
    targetId: nodeId,
    targetKind: "image",
  });
  const normalizedParameters = resolved.normalizedParameters ?? {};
  const contractFingerprint = resolved.contractFingerprint;
  if (!contractFingerprint) {
    throw new Error("M104 atomic image fixture contract fingerprint is missing");
  }
  const inputFingerprint = generationInputKey({
    inputs: resolved.inputs,
    modelConfigurationRevision: contract.modelConfigurationRevision,
    modelId: contract.modelId,
    modelReleaseRevision: contract.modelReleaseRevision.revisionId,
    ownPrompt: resolved.persistedOwnPrompt,
    parameters: normalizedParameters,
    prompt: resolved.finalPrompt,
  });
  const imageTool: ImageGenerationToolInput = {
    mask: {
      assetId: maskAssetId,
      featherPixels: 8,
      height: 720,
      version: 1,
      width: 1280,
    },
    operation: "redraw",
    operationId: `m104-image-tool-${randomUUID()}`,
    sourceAssetId,
    sourceNodeId,
  };
  database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, object_key, content_type, checksum_sha256,
      storage_status, duration_status, media_width, media_height
    ) VALUES ('image', ?, ?, ?, 16, ?, ?, 'local', ?, 'image/png', ?,
      'ready', 'not-applicable', 1280, 720)
  `).run(
    maskAssetId,
    generationOwnerId,
    `${maskAssetId}.png`,
    timestamp,
    timestamp,
    `${maskAssetId}.png`,
    "b".repeat(64),
  );
  const ownershipKey = generationOwnershipKey(
    imageGenerationToolOwnershipEvidence({
      accountId: generationOwnerId,
      aspectRatio: typeof normalizedParameters.aspectRatio === "string"
        ? normalizedParameters.aspectRatio
        : undefined,
      canvasId,
      imageTool,
      modelId: contract.modelId,
      modelParameters: normalizedParameters,
      prompt: resolved.persistedOwnPrompt,
      quality: typeof normalizedParameters.quality === "string"
        ? normalizedParameters.quality
        : undefined,
    }),
  );
  const modelConfiguration = buildAuthoritativeGenerationModelConfiguration({
    ...contract,
    generationInputKey: inputFingerprint,
    generationOwnershipKey: ownershipKey,
    modelInputContractFingerprint: contractFingerprint,
  });
  const parameters = {
    ...normalizedParameters,
    imageTool,
    inputSchemaVersion: 1,
    inputs: resolved.snapshot,
    references: [{ assetId: sourceAssetId, kind: "image", sourceNodeId }],
  };
  const requestIntent = {
    canvasId,
    fixtureScopeId: contract.fixtureScopeId,
    generationIdentityVersion: 2,
    generationInputKey: inputFingerprint,
    generationOwnershipKey: ownershipKey,
    imageTool,
    inputSchemaVersion: 1,
    inputs: resolved.snapshot,
    kind: "image",
    model: contract.modelId,
    modelConfigurationRevision: contract.modelConfigurationRevision,
    modelInputContractFingerprint: contractFingerprint,
    modelReleaseRevision: contract.modelReleaseRevision.revisionId,
    nodeId,
    parameters: normalizedParameters,
    prompt,
  };
  const input: AuthoritativeGenerationTaskInput = {
    canvasId,
    credentialRevision: contract.credentialVersion,
    expectedCanvasRevision: 1,
    idempotencyKey,
    kind: "image",
    model: contract.modelId,
    modelConfiguration,
    nodeId,
    ownerId: generationOwnerId,
    parameters,
    prompt,
    providerModelId: contract.providerModelId,
    providerProfileId: contract.providerProfileId,
    requestIntent,
  };
  return { imageTool, input, nodeId };
}

async function withDatabase(
  name: string,
  run: (database: DatabaseSync, directory: string, canvasId: string) =>
    Promise<void> | void,
) {
  const directory = await mkdtemp(join(tmpdir(), `unboundry-${name}-`));
  const database = openAppDatabase(directory);
  const canvasId = `${name}-${randomUUID()}`;
  const timestamp = "2026-09-04T00:00:00.000Z";
  try {
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, 'M104', 'test-only', 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at, deleted_at
      ) VALUES (?, ?, 'M104 project', 1, 1, 1, NULL)
    `).run(ownerId, canvasId);
    await run(database, directory, canvasId);
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
}

function commit(
  database: DatabaseSync,
  canvasId: string,
  command: CanvasUserCommand,
  requestId: string = randomUUID(),
) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = applyCanvasUserCommandInTransaction({
      canvasId,
      command,
      database,
      loadTokenEpoch: "m104-epoch",
      ownerId,
      requestId,
      validLoadToken: () => true,
    });
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function createCommand(
  operationId = `create-operation-${randomUUID()}`,
): CreateCanvasDocumentCommand {
  return {
    baseDocumentRevision: null,
    baseInputGraphRevision: null,
    initialDocument: { edges: [], nodes: [textNode()], viewport },
    kind: "create-canvas-document",
    observedLoadToken: null,
    operationId,
    saveSequence: 1,
    saveSessionId: `session-${randomUUID()}`,
  };
}

function fieldCommand(input: {
  baseDocumentRevision: number;
  baseInputGraphRevision: number;
    field: "data.textModelName" | "data.textPrompt" | "data.title";
  operationId?: string;
  saveSequence?: number;
  saveSessionId?: string;
  value: string;
}): ApplyUserFieldChangesCommand {
  return {
    baseDocumentRevision: input.baseDocumentRevision,
    baseInputGraphRevision: input.baseInputGraphRevision,
    changes: [{
      action: "set",
      baseValueDigest: stableSha256(undefined),
      field: input.field,
      nodeId: "text-node",
      value: input.value,
    }],
    kind: "apply-user-field-changes",
    observedLoadToken: "m104-valid-load-token",
    operationId: input.operationId ?? `field-operation-${randomUUID()}`,
    saveSequence: input.saveSequence ?? 1,
    saveSessionId: input.saveSessionId ?? `session-${randomUUID()}`,
  };
}

function row(database: DatabaseSync, canvasId: string) {
  return database.prepare(`
    SELECT revision, graph_revision, nodes, viewport, updated_at,
           save_session_id, save_sequence
    FROM canvas_documents WHERE owner_id = ? AND id = ?
  `).get(ownerId, canvasId) as {
    graph_revision: number;
    nodes: string;
    revision: number;
    save_sequence: number;
    save_session_id: string | null;
    updated_at: string;
    viewport: string;
  };
}

test("typed Canvas commands use durable replay receipts and exact revision transitions", async () => {
  await withDatabase("m104-revisions", (database, _directory, canvasId) => {
    const create = createCommand();
    const created = commit(database, canvasId, create);
    expect("outcome" in created && created.outcome).toBe("APPLIED");
    expect("outcome" in created && created.operationDocumentRevision).toBe(1);
    expect("outcome" in created && created.operationInputGraphRevision).toBe(1);

    const replay = commit(database, canvasId, create, randomUUID());
    expect("outcome" in replay && replay.replayed).toBe(true);
    expect("outcome" in replay && replay.originalRequestId).toBe(
      "outcome" in created ? created.originalRequestId : "",
    );
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM canvas_operation_receipts
      WHERE owner_id = ? AND canvas_id = ?
    `).get(ownerId, canvasId)).toEqual({ count: 1 });

    const beforeNoOp = row(database, canvasId);
    const noOp = commit(database, canvasId, fieldCommand({
      baseDocumentRevision: 1,
      baseInputGraphRevision: 1,
      field: "data.title",
      value: "Initial title",
    }));
    expect("outcome" in noOp && noOp.outcome).toBe("NO_OP");
    expect(row(database, canvasId)).toEqual(beforeNoOp);

    const layout: CommitUserLayoutCommand = {
      baseDocumentRevision: 1,
      baseInputGraphRevision: 1,
      kind: "commit-user-layout",
      nodes: [{ nodeId: "text-node", position: { x: 30, y: 40 } }],
      observedLoadToken: "m104-valid-load-token",
      operationId: `layout-operation-${randomUUID()}`,
      saveSequence: 1,
      saveSessionId: `session-${randomUUID()}`,
    };
    const layoutResult = commit(database, canvasId, layout);
    expect("outcome" in layoutResult && layoutResult.operationDocumentRevision).toBe(2);
    expect("outcome" in layoutResult && layoutResult.operationInputGraphRevision).toBe(1);

    const inputResult = commit(database, canvasId, fieldCommand({
      baseDocumentRevision: 2,
      baseInputGraphRevision: 1,
      field: "data.textPrompt",
      value: "changed prompt",
    }));
    expect("outcome" in inputResult && inputResult.operationDocumentRevision).toBe(3);
    expect("outcome" in inputResult && inputResult.operationInputGraphRevision).toBe(2);
  });
});

test("typed field commands preserve DATA-005 across sessions and enforce durable same-session high-water", async () => {
  await withDatabase("m104-data005", (database, _directory, canvasId) => {
    commit(database, canvasId, createCommand());
    const tabOne = `session-${randomUUID()}`;
    const tabTwo = `session-${randomUUID()}`;
    expect("outcome" in commit(database, canvasId, fieldCommand({
      baseDocumentRevision: 1,
      baseInputGraphRevision: 1,
      field: "data.title",
      saveSequence: 1,
      saveSessionId: tabOne,
      value: "Tab one title",
    }))).toBe(true);
    commit(database, canvasId, fieldCommand({
      baseDocumentRevision: 1,
      baseInputGraphRevision: 1,
      field: "data.textModelName",
      saveSequence: 1,
      saveSessionId: tabTwo,
      value: "orange",
    }));
    commit(database, canvasId, fieldCommand({
      baseDocumentRevision: 1,
      baseInputGraphRevision: 1,
      field: "data.title",
      saveSequence: 2,
      saveSessionId: tabTwo,
      value: "Last successful title",
    }));
    const persisted = JSON.parse(row(database, canvasId).nodes)[0].data;
    expect(persisted.title).toBe("Last successful title");
    expect(persisted.textModelName).toBe("orange");

    const stale = commit(database, canvasId, fieldCommand({
      baseDocumentRevision: 1,
      baseInputGraphRevision: 1,
      field: "data.textModelName",
      saveSequence: 1,
      saveSessionId: tabTwo,
      value: "must-not-apply",
    }));
    expect("outcome" in stale && stale.outcome).toBe("REJECTED_CONFLICT");
    expect("outcome" in stale && stale.conflictCode).toBe("CANVAS_SAVE_SUPERSEDED");
    expect(JSON.parse(row(database, canvasId).nodes)[0].data.textModelName).toBe("orange");
  });
});

test("topology preconditions are atomic and a rejected conflict replays its original 409 outcome", async () => {
  await withDatabase("m104-topology", (database, _directory, canvasId) => {
    commit(database, canvasId, createCommand());
    const before = {
      edges: [],
      nodes: [textNode()],
      viewport,
    };
    const operation = { intent: "create-node" as const, node: textNode("text-two") };
    const command: CanvasUserCommand = {
      affectedTopologyDigest: canvasTopologyAffectedDigest(before, operation),
      baseDocumentRevision: 1,
      baseInputGraphRevision: 1,
      kind: "apply-topology",
      observedLoadToken: "m104-valid-load-token",
      operationId: `topology-operation-${randomUUID()}`,
      saveSequence: 1,
      saveSessionId: `session-${randomUUID()}`,
      topologyOperation: operation,
    };
    const applied = commit(database, canvasId, command);
    expect("outcome" in applied && applied.operationInputGraphRevision).toBe(2);

    const currentDocument = "outcome" in applied
      ? {
          edges: [...applied.authoritativeDocument.edges],
          nodes: [...applied.authoritativeDocument.nodes],
          viewport: { ...applied.authoritativeDocument.viewport },
        }
      : before;
    const invalidGroupOperation = {
      groupNode: textNode("not-a-group"),
      intent: "group-members" as const,
      memberNodeIds: ["text-node"],
    };
    const invalidGroup = commit(database, canvasId, {
      affectedTopologyDigest: canvasTopologyAffectedDigest(
        currentDocument,
        invalidGroupOperation,
      ),
      baseDocumentRevision: 2,
      baseInputGraphRevision: 2,
      kind: "apply-topology",
      observedLoadToken: "m104-valid-load-token",
      operationId: `invalid-group-${randomUUID()}`,
      saveSequence: 1,
      saveSessionId: `session-${randomUUID()}`,
      topologyOperation: invalidGroupOperation,
    });
    expect("outcome" in invalidGroup && invalidGroup.conflictCode).toBe(
      "CANVAS_TOPOLOGY_CONFLICT",
    );
    const missingHandleOperation = {
      edge: { id: "missing-handles", source: "text-node", target: "text-two" },
      intent: "connect-edge" as const,
    };
    const invalidEdge = commit(database, canvasId, {
      affectedTopologyDigest: canvasTopologyAffectedDigest(
        currentDocument,
        missingHandleOperation,
      ),
      baseDocumentRevision: 2,
      baseInputGraphRevision: 2,
      kind: "apply-topology",
      observedLoadToken: "m104-valid-load-token",
      operationId: `invalid-edge-${randomUUID()}`,
      saveSequence: 1,
      saveSessionId: `session-${randomUUID()}`,
      topologyOperation: missingHandleOperation,
    });
    expect("outcome" in invalidEdge && invalidEdge.conflictCode).toBe(
      "CANVAS_TOPOLOGY_CONFLICT",
    );

    const proofDocument = {
      ...currentDocument,
      nodes: currentDocument.nodes.map((value) => {
        const node = value as { data: Record<string, unknown>; id: string };
        return {
          ...node,
          data: {
            ...node.data,
            groupRunSuccessInputFingerprint: `proof-${node.id}`,
            groupRunSuccessOwnershipKey: `ownership-${node.id}`,
            groupRunSuccessTaskId: `task-${node.id}`,
            textGenerationInputKey: `input-${node.id}`,
            textGenerationOwnershipKey: `ownership-${node.id}`,
            textGenerationTaskId: `task-${node.id}`,
          },
        };
      }),
    };
    database.prepare(`
      UPDATE canvas_documents SET nodes = ?
      WHERE owner_id = ? AND id = ?
    `).run(JSON.stringify(proofDocument.nodes), ownerId, canvasId);
    const validEdgeOperation = {
      edge: {
        data: { inputOrder: 1, inputRole: "text" },
        id: "proof-invalidating-edge",
        source: "text-node",
        sourceHandle: "source",
        target: "text-two",
        targetHandle: "target",
      },
      intent: "connect-edge" as const,
    };
    const connected = commit(database, canvasId, {
      affectedTopologyDigest: canvasTopologyAffectedDigest(
        proofDocument,
        validEdgeOperation,
      ),
      baseDocumentRevision: 2,
      baseInputGraphRevision: 2,
      kind: "apply-topology",
      observedLoadToken: "m104-valid-load-token",
      operationId: `valid-edge-${randomUUID()}`,
      saveSequence: 1,
      saveSessionId: `session-${randomUUID()}`,
      topologyOperation: validEdgeOperation,
    });
    expect("outcome" in connected && connected.operationInputGraphRevision).toBe(3);
    if (!("outcome" in connected)) throw new Error("Topology connection failed");
    const connectedNodes = connected.authoritativeDocument.nodes as Array<{
      data: Record<string, unknown>;
      id: string;
    }>;
    expect(connectedNodes.find((node) => node.id === "text-node")!.data)
      .toMatchObject({ textGenerationTaskId: "task-text-node" });
    const targetData = connectedNodes.find((node) => node.id === "text-two")!.data;
    for (const field of [
      "groupRunSuccessInputFingerprint",
      "groupRunSuccessOwnershipKey",
      "groupRunSuccessTaskId",
      "textGenerationInputKey",
      "textGenerationOwnershipKey",
      "textGenerationTaskId",
    ]) expect(targetData[field]).toBeUndefined();

    const conflictCommand: CanvasUserCommand = {
      ...command,
      affectedTopologyDigest: "0".repeat(64),
      operationId: `topology-conflict-${randomUUID()}`,
      saveSequence: 2,
    };
    const beforeConflict = row(database, canvasId);
    const conflict = commit(database, canvasId, conflictCommand);
    expect("outcome" in conflict && conflict.conflictCode).toBe(
      "CANVAS_TOPOLOGY_CONFLICT",
    );
    expect(row(database, canvasId)).toEqual(beforeConflict);
    const replay = commit(database, canvasId, conflictCommand);
    expect("outcome" in replay && replay.replayed).toBe(true);
    expect("outcome" in replay && replay.httpStatus).toBe(409);
  });
});

test("pasted media topology adopts every asset and edge in one Canvas revision or none", async () => {
  await withDatabase("m104-media-topology", (database, _directory, canvasId) => {
    const timestamp = "2026-09-04T00:00:00.000Z";
    const sourceAssetId = `m104-source-${randomUUID()}`;
    const outputAssetIds = [
      `m104-output-${randomUUID()}`,
      `m104-output-${randomUUID()}`,
    ];
    const insertAsset = (assetId: string, width: number, height: number) => {
      database.prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
          storage_backend, object_key, content_type, checksum_sha256,
          storage_status, duration_status, media_width, media_height
        ) VALUES ('image', ?, ?, ?, 16, ?, ?, 'local', ?, 'image/png', ?,
          'ready', 'not-applicable', ?, ?)
      `).run(
        assetId,
        ownerId,
        `${assetId}.png`,
        timestamp,
        timestamp,
        `${assetId}.png`,
        stableSha256(assetId),
        width,
        height,
      );
    };
    insertAsset(sourceAssetId, 200, 100);
    insertAsset(outputAssetIds[0]!, 67, 50);
    insertAsset(outputAssetIds[1]!, 66, 50);
    const sourceNode = {
      data: { label: "Image", sourceKind: "image", title: "Split source" },
      id: "m104-split-source",
      position: { x: 0, y: 0 },
      type: "image",
    };
    const create: CreateCanvasDocumentCommand = {
      ...createCommand(),
      initialDocument: { edges: [], nodes: [sourceNode], viewport },
    };
    commit(database, canvasId, create);
    const sourceAsset = {
      assetId: sourceAssetId,
      byteSize: 1,
      contentType: "image/png",
      height: 1,
      src: `/api/assets/${sourceAssetId}`,
      storageBackend: "local" as const,
      width: 1,
    };
    const sourceAdopted = commit(database, canvasId, {
      asset: sourceAsset,
      baseDocumentRevision: 1,
      baseInputGraphRevision: 1,
      kind: "adopt-uploaded-asset",
      mediaKind: "image",
      nodeId: sourceNode.id,
      observedLoadToken: "m104-valid-load-token",
      operationId: `source-adoption-${randomUUID()}`,
      saveSequence: 1,
      saveSessionId: `session-${randomUUID()}`,
    });
    if (!("outcome" in sourceAdopted)) throw new Error("Source adoption failed");
    const outputNodes = outputAssetIds.map((_, index) => ({
      data: {
        label: "Image",
        sourceKind: "image",
        title: `Split output ${index + 1}`,
      },
      id: `m104-split-output-${index + 1}`,
      position: { x: 300 + index * 100, y: 0 },
      type: "image",
    }));
    const edges = outputNodes.map((node, index) => ({
      data: { inputOrder: index + 1, inputRole: "reference-image" },
      id: `m104-split-edge-${index + 1}`,
      source: sourceNode.id,
      sourceHandle: "source",
      target: node.id,
      targetHandle: "target",
    }));
    const operation = {
      edges,
      intent: "paste-subgraph" as const,
      nodes: outputNodes,
    };
    const command: CanvasUserCommand = {
      affectedTopologyDigest: canvasTopologyAffectedDigest(
        {
          edges: [...sourceAdopted.authoritativeDocument.edges],
          nodes: [...sourceAdopted.authoritativeDocument.nodes],
          viewport: { ...sourceAdopted.authoritativeDocument.viewport },
        },
        operation,
      ),
      baseDocumentRevision: 2,
      baseInputGraphRevision: 2,
      kind: "apply-topology",
      mediaAdoptions: outputNodes.map((node, index) => ({
        asset: {
          assetId: outputAssetIds[index]!,
          byteSize: 1,
          contentType: "image/png",
          height: 1,
          src: `/api/assets/${outputAssetIds[index]!}`,
          storageBackend: "local" as const,
          width: 1,
        },
        kind: "edit-result-and-invalidate-proof" as const,
        nodeId: node.id,
        sourceAssetId,
        toolOperation: "quick-split",
        toolOperationId: `quick-split-${randomUUID()}`,
      })),
      observedLoadToken: "m104-valid-load-token",
      operationId: `media-topology-${randomUUID()}`,
      saveSequence: 1,
      saveSessionId: `session-${randomUUID()}`,
      topologyOperation: operation,
    };
    expect(parseCanvasUserCommand(command).ok).toBe(true);
    const applied = commit(database, canvasId, command);
    expect("outcome" in applied && applied.outcome).toBe("APPLIED");
    if (!("outcome" in applied)) throw new Error("Media topology failed");
    expect(applied.operationDocumentRevision).toBe(3);
    expect(applied.operationInputGraphRevision).toBe(3);
    expect(applied.authoritativeDocument.edges).toHaveLength(2);
    expect(applied.authoritativeDocument.nodes.slice(1).map((value) => {
      const data = (value as { data: Record<string, unknown> }).data;
      return {
        assetId: data.assetId,
        height: data.mediaHeight,
        operation: data.imageToolOperation,
        origin: data.imageAssetOrigin,
        width: data.mediaWidth,
      };
    })).toEqual([
      {
        assetId: outputAssetIds[0],
        height: 50,
        operation: "quick-split",
        origin: "image-tool",
        width: 67,
      },
      {
        assetId: outputAssetIds[1],
        height: 50,
        operation: "quick-split",
        origin: "image-tool",
        width: 66,
      },
    ]);

    const unavailableOperation = {
      edges: [{
        id: "m104-missing-edge",
        source: sourceNode.id,
        sourceHandle: "source",
        target: "m104-missing-output",
        targetHandle: "target",
      }],
      intent: "paste-subgraph" as const,
      nodes: [{
        data: { label: "Image", title: "Must not persist" },
        id: "m104-missing-output",
        position: { x: 600, y: 0 },
        type: "image",
      }],
    };
    const unavailable: CanvasUserCommand = {
      ...command,
      affectedTopologyDigest: canvasTopologyAffectedDigest(
        {
          edges: [...applied.authoritativeDocument.edges],
          nodes: [...applied.authoritativeDocument.nodes],
          viewport: { ...applied.authoritativeDocument.viewport },
        },
        unavailableOperation,
      ),
      baseDocumentRevision: 3,
      baseInputGraphRevision: 3,
      mediaAdoptions: [{
        asset: {
          assetId: "m104-missing-asset",
          byteSize: 1,
          contentType: "image/png",
          height: 1,
          src: "/api/assets/m104-missing-asset",
          storageBackend: "local",
          width: 1,
        },
        kind: "edit-result-and-invalidate-proof",
        nodeId: "m104-missing-output",
        sourceAssetId,
        toolOperation: "quick-split",
        toolOperationId: `quick-split-${randomUUID()}`,
      }],
      operationId: `media-topology-missing-${randomUUID()}`,
      saveSessionId: `media-topology-missing-session-${randomUUID()}`,
      topologyOperation: unavailableOperation,
    };
    const beforeUnavailable = row(database, canvasId);
    const rejected = commit(database, canvasId, unavailable);
    expect("outcome" in rejected && rejected.conflictCode).toBe(
      "CANVAS_MEDIA_UNAVAILABLE",
    );
    expect(row(database, canvasId)).toEqual(beforeUnavailable);

    const conflictAssetIds = [
      `m104-adoption-${randomUUID()}`,
      `m104-adoption-${randomUUID()}`,
    ];
    conflictAssetIds.forEach((assetId, index) =>
      insertAsset(assetId, 80 + index, 60 + index)
    );
    const conflictAttemptIds = conflictAssetIds.map(() => randomUUID());
    conflictAssetIds.forEach((assetId, index) => {
      database.prepare(`
        INSERT INTO media_publication_attempts (
          attempt_id, owner_id, kind, asset_id, source, state,
          storage_backend, final_storage_name, object_key, staging_name,
          byte_size, checksum_sha256, content_type, created_at, updated_at
        ) VALUES (?, ?, 'image', ?, 'upload', ?, 'local', ?, ?, ?,
          16, ?, 'image/png', ?, ?)
      `).run(
        conflictAttemptIds[index],
        ownerId,
        assetId,
        index === 0 ? "published" : "staged",
        `${assetId}.png`,
        `${assetId}.png`,
        `${assetId}.staging`,
        stableSha256(assetId),
        timestamp,
        timestamp,
      );
    });
    const conflictNodes = conflictAssetIds.map((_, index) => ({
      data: { label: "Image", title: `Rejected adoption ${index + 1}` },
      id: `m104-rejected-adoption-${index + 1}`,
      position: { x: 700 + index * 100, y: 0 },
      type: "image",
    }));
    const conflictEdges = conflictNodes.map((node, index) => ({
      id: `m104-rejected-adoption-edge-${index + 1}`,
      source: sourceNode.id,
      sourceHandle: "source",
      target: node.id,
      targetHandle: "target",
    }));
    const conflictOperation = {
      edges: conflictEdges,
      intent: "paste-subgraph" as const,
      nodes: conflictNodes,
    };
    const partialAdoption = commit(database, canvasId, {
      affectedTopologyDigest: canvasTopologyAffectedDigest(
        {
          edges: [...applied.authoritativeDocument.edges],
          nodes: [...applied.authoritativeDocument.nodes],
          viewport: { ...applied.authoritativeDocument.viewport },
        },
        conflictOperation,
      ),
      baseDocumentRevision: 3,
      baseInputGraphRevision: 3,
      kind: "apply-topology",
      mediaAdoptions: conflictNodes.map((node, index) => ({
        asset: {
          assetId: conflictAssetIds[index]!,
          byteSize: 16,
          contentType: "image/png",
          height: 60 + index,
          src: `/api/assets/${conflictAssetIds[index]!}`,
          storageBackend: "local" as const,
          width: 80 + index,
        },
        kind: "adopt-uploaded-asset" as const,
        mediaKind: "image" as const,
        nodeId: node.id,
      })),
      observedLoadToken: "m104-valid-load-token",
      operationId: `partial-adoption-${randomUUID()}`,
      saveSequence: 1,
      saveSessionId: `partial-adoption-session-${randomUUID()}`,
      topologyOperation: conflictOperation,
    });
    expect("outcome" in partialAdoption && partialAdoption.conflictCode).toBe(
      "CANVAS_MEDIA_UNAVAILABLE",
    );
    expect(row(database, canvasId)).toEqual(beforeUnavailable);
    for (const attemptId of conflictAttemptIds) {
      expect(database.prepare(`
        SELECT adopted_at, adopted_canvas_id
        FROM media_publication_attempts WHERE attempt_id = ?
      `).get(attemptId)).toEqual({ adopted_at: null, adopted_canvas_id: null });
    }
  });
});

test("Canvas and receipt writes roll back together and replay survives a new connection", async () => {
  await withDatabase("m104-atomic", (database, directory, canvasId) => {
    commit(database, canvasId, createCommand());
    const command = fieldCommand({
      baseDocumentRevision: 1,
      baseInputGraphRevision: 1,
      field: "data.title",
      operationId: `fault-operation-${randomUUID()}`,
      value: "must roll back",
    });
    database.exec(`
      CREATE TEMP TRIGGER m104_abort_receipt
      BEFORE INSERT ON canvas_operation_receipts
      WHEN NEW.operation_id = '${command.operationId}'
      BEGIN SELECT RAISE(ABORT, 'm104 receipt fault'); END
    `);
    const before = row(database, canvasId);
    expect(() => commit(database, canvasId, command)).toThrow(
      CanvasMutationGatewayUnavailableError,
    );
    expect(row(database, canvasId)).toEqual(before);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM canvas_operation_receipts
      WHERE operation_id = ?
    `).get(command.operationId)).toEqual({ count: 0 });
    database.exec("DROP TRIGGER m104_abort_receipt");
    const applied = commit(database, canvasId, command, "m104-original-request");
    expect("outcome" in applied && applied.outcome).toBe("APPLIED");

    const reopened = openAppDatabase(directory);
    try {
      const replay = commit(reopened, canvasId, command, "m104-replay-request");
      expect("outcome" in replay && replay.replayed).toBe(true);
      expect("outcome" in replay && replay.originalRequestId).toBe(
        "m104-original-request",
      );
      expect(row(reopened, canvasId).revision).toBe(2);
    } finally {
      reopened.close();
    }
  });
});

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("production command HTTP lane saves and replays with restored DELETE journal mode", async () => {
  await withDatabase("m104-delete-http", async (database, directory, canvasId) => {
    const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
    process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
    process.env.UNBOUNDRY_DATA_DIR = directory;
    database.prepare(`INSERT INTO users
      (id,login_name,display_name,password_hash,role,status,created_at,updated_at)
      VALUES ('__test__','__test__','Synthetic HTTP','test-only','admin','active','2026-09-06','2026-09-06')`).run();
    database.prepare("UPDATE project_metadata SET owner_id='__test__' WHERE id=?").run(canvasId);
    database.exec("PRAGMA journal_mode=DELETE");
    const handler = createCanvasCommandsApi(); // Exercise the real cached lane, no injected DB.
    const server = createServer((request, response) => {
      request.url = (request.url ?? "/").slice("/api/canvases".length) || "/";
      authGate(request, response, () => {
        void handler(request, response).catch((error) => {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: String(error) }));
        });
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      const send = async (command: CanvasUserCommand) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/canvases/${canvasId}/commands`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Unboundry-Canvas-Write-Contract": "command-v1" },
          body: JSON.stringify(command),
        });
        return { status: response.status, body: await response.json() };
      };
      const command = createCommand();
      const first = await send(command);
      expect(first.status).toBe(200); expect(first.body.status).toBe("applied");
      const replay = await send(command);
      expect(replay.status).toBe(200); expect(replay.body.status).toBe("already-applied");
      expect(database.prepare("SELECT revision FROM canvas_documents WHERE owner_id='__test__' AND id=?").get(canvasId)).toEqual({ revision: 1 });
      expect(database.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
    } finally {
      await stopServer(server); closeRuntimeDatabaseTransactions();
      if (previousBypass === undefined) delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
      else process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
      if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
      else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    }
  });
});

test("command HTTP route is path-bound, fail-closed and returns replay metadata", async () => {
  await withDatabase("m104-http", async (database, _directory, canvasId) => {
    const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
    process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
    process.env.UNBOUNDRY_DATA_DIR = _directory;
    const timestamp = "2026-09-04T00:00:00.000Z";
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('__test__', '__test__', 'M104 HTTP', 'test-only',
        'admin', 'active', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare("UPDATE project_metadata SET owner_id = '__test__' WHERE id = ?")
      .run(canvasId);
    const handler = createCanvasCommandsApi({
      closeDatabaseAfterRequest: false,
      database: () => database,
    });
    const server = createServer((request, response) => {
      const route = request.url ?? "/";
      if (!route.startsWith("/api/canvases")) {
        response.statusCode = 404;
        response.end();
        return;
      }
      request.url = route.slice("/api/canvases".length) || "/";
      authGate(request, response, () => {
        void handler(request, response).catch((error) => {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: String(error) }));
        });
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      const origin = `http://127.0.0.1:${address.port}`;
      const send = async (
        path: string,
        body: unknown,
        contract = "command-v1",
        method = "POST",
      ) => {
        const response = await fetch(`${origin}${path}`, {
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            "X-Unboundry-Canvas-Write-Contract": contract,
          },
          method,
        });
        return {
          body: await response.json() as Record<string, unknown>,
          contract: response.headers.get("x-unboundry-canvas-write-contract"),
          requestId: response.headers.get("x-request-id"),
          status: response.status,
        };
      };

      expect((await send(
        `/api/canvases/${canvasId}/commands`,
        createCommand(),
        "wrong-contract",
      )).status).toBe(400);
      expect((await send(
        `/api/canvases/${canvasId}/commands`,
        { ...createCommand(), ownerId: "forged" },
      )).body.code).toBe("CANVAS_COMMAND_INVALID");
      expect((await send(
        `/api/canvases/${canvasId}/commands`,
        createCommand(),
        "command-v1",
        "PUT",
      )).status).toBe(405);

      const command = createCommand();
      const first = await send(`/api/canvases/${canvasId}/commands`, command);
      expect(first.status).toBe(200);
      expect(first.body.status).toBe("applied");
      expect(first.body.replayed).toBe(false);
      expect(first.contract).toBe("command-v1");
      expect(first.requestId).toEqual(expect.stringMatching(/^[a-f0-9-]{8,}$/i));
      const replay = await send(`/api/canvases/${canvasId}/commands`, command);
      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe("already-applied");
      expect(replay.body.originalStatus).toBe("applied");
      expect(replay.body.originalRequestId).toBe(first.body.originalRequestId);
      expect(replay.body.requestId).not.toBe(first.body.requestId);

      const beforeUnavailable = row(database, canvasId);
      database.exec("DROP TABLE canvas_operation_receipts");
      const unavailable = await send(
        `/api/canvases/${canvasId}/commands`,
        fieldCommand({
          baseDocumentRevision: 1,
          baseInputGraphRevision: 1,
          field: "data.title",
          value: "must not apply without receipt storage",
        }),
      );
      expect(unavailable.status).toBe(503);
      expect(unavailable.body.code).toBe("CANVAS_COMMAND_RECEIPT_UNAVAILABLE");
      expect(row(database, canvasId)).toEqual(beforeUnavailable);
    } finally {
      await stopServer(server);
      if (previousBypass === undefined) delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
      else process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
      if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
      else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
  });
});

test("public Canvas command parser rejects unknown node kinds and oversized sessions before SQL", () => {
  const unknown = createCommand();
  const invalidNode = {
    ...unknown,
    initialDocument: {
      ...unknown.initialDocument,
      nodes: [{ data: {}, id: "unknown-node", type: "unknown-kind" }],
    },
  };
  expect(parseCanvasUserCommand(invalidNode)).toEqual({
    code: "CANVAS_COMMAND_INVALID",
    ok: false,
  });
  expect(parseCanvasUserCommand({
    ...unknown,
    saveSessionId: `session-${"x".repeat(80)}`,
  })).toEqual({ code: "CANVAS_COMMAND_INVALID", ok: false });

  expect(parseCanvasUserCommand({
    ...unknown,
    initialDocument: {
      edges: [],
      nodes: [textNode("duplicate"), textNode("duplicate")],
      viewport,
    },
  })).toEqual({ code: "CANVAS_COMMAND_INVALID", ok: false });
  expect(parseCanvasUserCommand({
    ...unknown,
    initialDocument: {
      edges: [{
        id: "dangling",
        source: "missing",
        sourceHandle: "source",
        target: "text-node",
        targetHandle: "target",
      }],
      nodes: [textNode()],
      viewport,
    },
  })).toEqual({ code: "CANVAS_COMMAND_INVALID", ok: false });
  expect(parseCanvasUserCommand({
    ...unknown,
    initialDocument: {
      edges: [
        {
          id: "a-to-b",
          source: "a",
          sourceHandle: "source",
          target: "b",
          targetHandle: "target",
        },
        {
          id: "b-to-a",
          source: "b",
          sourceHandle: "source",
          target: "a",
          targetHandle: "target",
        },
      ],
      nodes: [textNode("a"), textNode("b")],
      viewport,
    },
  })).toEqual({ code: "CANVAS_COMMAND_INVALID", ok: false });

  const edgeDocument = {
    edges: [{
      id: "missing-handles",
      source: "a",
      target: "b",
    }],
    nodes: [textNode("a"), textNode("b")],
    viewport,
  };
  expect(parseCanvasUserCommand({
    ...unknown,
    initialDocument: edgeDocument,
  })).toEqual({ code: "CANVAS_COMMAND_INVALID", ok: false });
  expect(parseCanvasUserCommand({
    ...unknown,
    initialDocument: {
      ...edgeDocument,
      edges: [{
        ...edgeDocument.edges[0],
        sourceHandle: "unknown",
        targetHandle: "target",
      }],
    },
  })).toEqual({ code: "CANVAS_COMMAND_INVALID", ok: false });

  const parent = textNode("not-a-group");
  expect(parseCanvasUserCommand({
    ...unknown,
    initialDocument: {
      edges: [],
      nodes: [parent, { ...textNode("child"), parentId: parent.id }],
      viewport,
    },
  })).toEqual({ code: "CANVAS_COMMAND_INVALID", ok: false });
  const group = {
    data: { label: "Group", variant: "group" },
    id: "group-parent",
    position: { x: 0, y: 0 },
    type: "group",
  };
  expect(parseCanvasUserCommand({
    ...unknown,
    initialDocument: {
      edges: [],
      nodes: [group, { ...group, id: "nested-group", parentId: group.id }],
      viewport,
    },
  })).toEqual({ code: "CANVAS_COMMAND_INVALID", ok: false });
});

test("disconnect-edge locks both authoritative endpoints and malformed stored topology fails closed", () => {
  const document = {
    edges: [{
      id: "a-to-b",
      source: "a",
      sourceHandle: "source",
      target: "b",
      targetHandle: "target",
    }],
    nodes: [textNode("a"), textNode("b")],
    viewport,
  };
  const operation = { edgeId: "a-to-b", intent: "disconnect-edge" as const };
  const command: Exclude<CanvasUserCommand, { kind: "create-canvas-document" }> = {
    affectedTopologyDigest: canvasTopologyAffectedDigest(document, operation),
    baseDocumentRevision: 1,
    baseInputGraphRevision: 1,
    kind: "apply-topology",
    observedLoadToken: "m104-valid-load-token",
    operationId: `disconnect-operation-${randomUUID()}`,
    saveSequence: 1,
    saveSessionId: `session-${randomUUID()}`,
    topologyOperation: operation,
  };
  expect(() => applyCanvasUserCommand({
    command,
    currentDocument: document,
    lockedNodeIds: ["b"],
  })).toThrow(/locked/i);

  expect(() => applyCanvasUserCommand({
    command: fieldCommand({
      baseDocumentRevision: 1,
      baseInputGraphRevision: 1,
      field: "data.title",
      value: "must not repair malformed storage",
    }),
    currentDocument: {
      edges: [],
      nodes: [textNode("text-node"), textNode("text-node")],
      viewport,
    },
  })).toThrow(/Duplicate node identity/);
});

test("replace-edge atomically updates legacy metadata and locks old plus new endpoints", () => {
  const document = {
    edges: [{
      data: { inputOrder: 0, inputRole: "text" },
      id: "legacy-edge",
      source: "a",
      target: "b",
    }],
    nodes: [textNode("a"), textNode("b"), textNode("c")],
    viewport,
  };
  const commandFor = (
    operation: Extract<
      CanvasUserCommand,
      { kind: "apply-topology" }
    >["topologyOperation"],
  ): Exclude<CanvasUserCommand, { kind: "create-canvas-document" }> => ({
    affectedTopologyDigest: canvasTopologyAffectedDigest(document, operation),
    baseDocumentRevision: 1,
    baseInputGraphRevision: 1,
    kind: "apply-topology",
    observedLoadToken: "m104-valid-load-token",
    operationId: `replace-edge-${randomUUID()}`,
    saveSequence: 1,
    saveSessionId: `session-${randomUUID()}`,
    topologyOperation: operation,
  });

  const legacyReplacement = {
    edge: {
      data: { inputOrder: 2, inputRole: "prompt" },
      id: "legacy-edge",
      source: "a",
      target: "b",
    },
    intent: "replace-edge" as const,
  };
  const legacyCommand = commandFor(legacyReplacement);
  expect(parseCanvasUserCommand(legacyCommand)).toEqual({
    ok: true,
    value: legacyCommand,
  });
  const replaced = applyCanvasUserCommand({
    command: legacyCommand,
    currentDocument: document,
  });
  expect(replaced.changedPaths).toEqual(["topology.replace-edge"]);
  expect(replaced.document.edges).toEqual([legacyReplacement.edge]);
  expect(document.edges).toEqual([{
    data: { inputOrder: 0, inputRole: "text" },
    id: "legacy-edge",
    source: "a",
    target: "b",
  }]);

  const endpointReplacement = {
    edge: {
      data: { inputOrder: 1, inputRole: "text" },
      id: "legacy-edge",
      source: "c",
      sourceHandle: "source",
      target: "b",
      targetHandle: "target",
    },
    intent: "replace-edge" as const,
  };
  const endpointCommand = commandFor(endpointReplacement);
  for (const lockedNodeId of ["a", "c"]) {
    expect(() => applyCanvasUserCommand({
      command: endpointCommand,
      currentDocument: document,
      lockedNodeIds: [lockedNodeId],
    })).toThrow(/locked/i);
  }
  expect(() => applyCanvasUserCommand({
    command: commandFor({
      edge: {
        id: "legacy-edge",
        source: "c",
        target: "b",
      },
      intent: "replace-edge",
    }),
    currentDocument: document,
  })).toThrow(/handle/i);
});

test("modern single-node admission atomically binds Canvas before launch and rolls back safely", async () => {
  await withDatabase("m104-generation-atomic", async (database, directory, canvasId) => {
    const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
    const previousSafeTest = process.env.UNBOUNDRY_SAFE_TEST;
    process.env.UNBOUNDRY_DATA_DIR = directory;
    process.env.UNBOUNDRY_SAFE_TEST = "1";
    let applicationStoreStarted = false;
    resetCanvasObservabilityForTests();
    try {
      const timestamp = "2026-09-04T00:00:00.000Z";
      database.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (?, ?, 'M104 generation', 'test-only', 'user', 'active', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(generationOwnerId, generationOwnerId, timestamp, timestamp);
      database.prepare(`
        UPDATE project_metadata SET owner_id = ? WHERE id = ?
      `).run(generationOwnerId, canvasId);
      database.prepare(`
        UPDATE generation_safety_settings
        SET global_enabled = 1, emergency_stop = 0,
            per_user_concurrency = 10, text_concurrency = 10,
            requests_per_minute = 100
        WHERE id = 1
      `).run();

      const contract = atomicGenerationContract();
      const success = generationFixture(
        database,
        canvasId,
        "m104-atomic-success-key",
        "m104 atomic success prompt",
        contract,
      );
      const rollback = generationFixture(
        database,
        `m104-atomic-rollback-${randomUUID()}`,
        "m104-atomic-rollback-key",
        "m104 atomic rollback prompt",
        contract,
      );
      const staleRevision = generationFixture(
        database,
        `m104-atomic-stale-${randomUUID()}`,
        "m104-atomic-stale-key",
        "m104 atomic stale revision prompt",
        contract,
      );
      const staleFingerprint = generationFixture(
        database,
        `m104-atomic-fingerprint-${randomUUID()}`,
        "m104-atomic-fingerprint-key",
        "m104 atomic stale fingerprint prompt",
        contract,
      );
      const image = imageGenerationFixture(
        database,
        `m104-atomic-image-${randomUUID()}`,
        "m104-atomic-image-key",
        atomicImageGenerationContract(),
      );
      const imageRollback = imageGenerationFixture(
        database,
        `m104-atomic-image-rollback-${randomUUID()}`,
        "m104-atomic-image-rollback-key",
        atomicImageGenerationContract(),
      );

      const events: string[] = [];
      let committedTaskId = "";
      applicationStoreStarted = true;
      expect(() => admitPreparedGenerationTask({
        input: success.input,
        requestId: "m104-atomic-admission-request",
        afterCommit: () => {
          events.push("after-commit");
          const committed = openAppDatabase(directory);
          try {
            const task = committed.prepare(`
              SELECT id, state FROM generation_tasks
              WHERE owner_id = ? AND canvas_id = ? AND idempotency_key = ?
            `).get(
              generationOwnerId,
              success.input.canvasId,
              success.input.idempotencyKey,
            ) as { id: string; state: string } | undefined;
            if (!task) throw new Error("Committed generation task is missing");
            committedTaskId = task.id;
            expect(task.state).toBe("queued");
            expect(committed.prepare(`
              SELECT COUNT(*) AS count FROM generation_task_events
              WHERE task_id = ? AND state = 'queued'
            `).get(task.id)).toEqual({ count: 1 });
            expect(committed.prepare(`
              SELECT COUNT(*) AS count FROM generation_admission_events
              WHERE task_id = ?
            `).get(task.id)).toEqual({ count: 1 });

            const canvas = generationCanvasRow(committed, success.input.canvasId);
            expect(canvas.revision).toBe(2);
            expect(canvas.graph_revision).toBe(1);
            const data = JSON.parse(canvas.nodes)[0].data as Record<string, unknown>;
            expect(data).toMatchObject({
              textGenerationContractFingerprint:
                success.modelConfiguration.modelInputContractFingerprint,
              textGenerationInputKey:
                success.modelConfiguration.generationInputKey,
              textGenerationModelConfigurationRevision:
                success.modelConfiguration.modelConfigurationRevision,
              textGenerationModelReleaseRevision:
                success.modelConfiguration.modelReleaseRevision.revisionId,
              textGenerationOwnershipKey:
                success.modelConfiguration.generationOwnershipKey,
              textGenerationTaskId: task.id,
            });

            const receipt = committed.prepare(`
              SELECT command_type, actor_type, outcome, baseline_kind,
                     base_document_revision, base_input_revision,
                     result_document_revision, result_input_revision,
                     changed_paths, settled_at
              FROM canvas_operation_receipts
              WHERE owner_id = ? AND canvas_id = ? AND operation_id = ?
            `).get(
              generationOwnerId,
              success.input.canvasId,
              `server-generation-bind:${task.id}`,
            ) as {
              actor_type: string;
              base_document_revision: number;
              base_input_revision: number;
              baseline_kind: string;
              changed_paths: string;
              command_type: string;
              outcome: string;
              result_document_revision: number;
              result_input_revision: number;
              settled_at: string | null;
            } | undefined;
            if (!receipt) throw new Error("Generation binding receipt is missing");
            expect(receipt).toMatchObject({
              actor_type: "server",
              base_document_revision: 1,
              base_input_revision: 1,
              baseline_kind: "existing",
              command_type: "server.projection",
              outcome: "APPLIED",
              result_document_revision: 2,
              result_input_revision: 1,
            });
            expect(JSON.parse(receipt.changed_paths)).toEqual([
              `nodes.${success.nodeId}.server-generation-binding`,
            ]);
            expect(receipt.settled_at).toEqual(expect.any(String));

            const bindingEvents = snapshotCanvasObservabilityForTests().events
              .filter((event) => event.event === "command"
                ? event.operationId === `server-generation-bind:${task.id}`
                : event.taskId === task.id);
            expect(bindingEvents).toHaveLength(3);
            expect(bindingEvents).toEqual(expect.arrayContaining([
              expect.objectContaining({
                commandKind: "server.generation-binding",
                event: "command",
                operationId: `server-generation-bind:${task.id}`,
              }),
              expect.objectContaining({
                callerSymbol: "server.generationAdmissionApplication",
                event: "route",
                operation: "single-node-generation-binding",
                route: "canvas.server-generation-binding",
                serverClass: "T",
              }),
              expect.objectContaining({
                event: "generation-lifecycle",
                operation: "single-node-generation-binding",
                outcome: "generation-task.queued",
                projectionState: "pending",
                taskState: "queued",
              }),
            ]));
            expect(bindingEvents.every((event) =>
              event.requestId === "m104-atomic-admission-request"
            )).toBe(true);
          } finally {
            committed.close();
          }
          // Stop the production launch path at the post-commit handoff so the
          // test can invoke the safe launch seam below without a Provider.
          throw new Error("m104 post-commit launch seam");
        },
      })).toThrow(GenerationAdmissionPostCommitError);

      expect(committedTaskId).toEqual(expect.stringMatching(/^[a-f0-9-]{8,}$/i));
      const settledExecutions: Promise<void>[] = [];
      launchGenerationTaskForRuntimeTest({
        execute: async (taskId) => {
          events.push("launch");
          const observed = openAppDatabase(directory);
          try {
            const canvas = generationCanvasRow(observed, success.input.canvasId);
            const data = JSON.parse(canvas.nodes)[0].data as Record<string, unknown>;
            expect(data.textGenerationTaskId).toBe(taskId);
            expect(observed.prepare(`
              SELECT COUNT(*) AS count FROM canvas_operation_receipts
              WHERE operation_id = ? AND actor_type = 'server'
            `).get(`server-generation-bind:${taskId}`)).toEqual({ count: 1 });
          } finally {
            observed.close();
          }
        },
        kind: "text",
        settledExecutions,
        taskId: committedTaskId,
      });
      await Promise.all(settledExecutions);
      expect(events).toEqual(["after-commit", "launch"]);

      const beforeReplay = generationCanvasRow(database, success.input.canvasId);
      const beforeReceiptCount = database.prepare(`
        SELECT COUNT(*) AS count FROM canvas_operation_receipts
        WHERE owner_id = ? AND canvas_id = ?
      `).get(generationOwnerId, success.input.canvasId);
      const replay = admitPreparedGenerationTask({
        input: success.input,
        requestId: "m104-atomic-replay-request",
      });
      expect(replay.created).toBe(false);
      expect(replay.task.id).toBe(committedTaskId);
      expect(generationCanvasRow(database, success.input.canvasId)).toEqual(beforeReplay);
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM canvas_operation_receipts
        WHERE owner_id = ? AND canvas_id = ?
      `).get(generationOwnerId, success.input.canvasId)).toEqual(beforeReceiptCount);

      expect(() => admitPreparedGenerationTask({
        afterCommit: () => {
          const canvas = generationCanvasRow(database, image.input.canvasId);
          expect(canvas.revision).toBe(2);
          expect(canvas.graph_revision).toBe(1);
          const data = (JSON.parse(canvas.nodes) as Array<{
            data: Record<string, unknown>;
          }>).find((node) => node.data.imagePrompt)?.data;
          expect(data).toMatchObject({
            imageAssetOrigin: "image-tool",
            imageGenerationTaskId: expect.any(String),
            imageToolMaskAssetId: image.imageTool.mask?.assetId,
            imageToolMaskFeatherPixels: 8,
            imageToolMaskHeight: 720,
            imageToolMaskVersion: 1,
            imageToolMaskWidth: 1280,
            imageToolOperation: "redraw",
            imageToolOperationId: image.imageTool.operationId,
            imageToolSourceAssetId: image.imageTool.sourceAssetId,
          });
          throw new Error("m104 image-tool post-commit launch seam");
        },
        imageTool: image.imageTool,
        input: image.input,
        requestId: "m104-atomic-image-admission-request",
      })).toThrow(GenerationAdmissionPostCommitError);
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
        WHERE owner_id = ? AND canvas_id = ? AND idempotency_key = ?
      `).get(
        generationOwnerId,
        image.input.canvasId,
        image.input.idempotencyKey,
      )).toEqual({ count: 1 });
      const committedImageTask = database.prepare(`
        SELECT id, parameters FROM generation_tasks
        WHERE owner_id = ? AND canvas_id = ? AND idempotency_key = ?
      `).get(
        generationOwnerId,
        image.input.canvasId,
        image.input.idempotencyKey,
      ) as { id: string; parameters: string };
      expect(JSON.parse(committedImageTask.parameters).imageTool).toEqual(
        image.imageTool,
      );
      const imageReplayBefore = generationCanvasRow(
        database,
        image.input.canvasId,
      );
      expect(admitPreparedGenerationTask({
        imageTool: image.imageTool,
        input: image.input,
        requestId: "m104-atomic-image-replay-request",
      })).toMatchObject({ created: false, task: { id: committedImageTask.id } });
      expect(generationCanvasRow(database, image.input.canvasId)).toEqual(
        imageReplayBefore,
      );
      const changedImageTool = {
        ...image.imageTool,
        operationId: `${image.imageTool.operationId}-changed`,
      } satisfies ImageGenerationToolInput;
      expect(() => admitPreparedGenerationTask({
        imageTool: changedImageTool,
        input: {
          ...image.input,
          parameters: { ...image.input.parameters, imageTool: changedImageTool },
          requestIntent: {
            ...image.input.requestIntent,
            imageTool: changedImageTool,
          },
        },
        requestId: "m104-atomic-image-conflict-request",
      })).toThrow(GenerationTaskConflictError);

      const conflictInput: AuthoritativeGenerationTaskInput = {
        ...success.input,
        prompt: "m104 atomic conflicting prompt",
        requestIntent: {
          ...success.input.requestIntent,
          prompt: "m104 atomic conflicting prompt",
        },
      };
      expect(() => admitPreparedGenerationTask({
        input: conflictInput,
        requestId: "m104-atomic-conflict-request",
      })).toThrow(GenerationTaskConflictError);
      expect(generationCanvasRow(database, success.input.canvasId)).toEqual(beforeReplay);

      const rollbackBefore = generationCanvasRow(database, rollback.input.canvasId);
      const imageRollbackBefore = generationCanvasRow(
        database,
        imageRollback.input.canvasId,
      );
      const observabilityBeforeRollback = snapshotCanvasObservabilityForTests();
      database.exec(`
        CREATE TRIGGER m104_generation_bind_receipt_fault
        BEFORE INSERT ON canvas_operation_receipts
        WHEN NEW.operation_id LIKE 'server-generation-bind:%'
        BEGIN SELECT RAISE(ABORT, 'm104 generation binding receipt fault'); END
      `);
      try {
        expect(() => admitPreparedGenerationTask({
          input: rollback.input,
          requestId: "m104-atomic-rollback-request",
        })).toThrow();
        expect(() => admitPreparedGenerationTask({
          imageTool: imageRollback.imageTool,
          input: imageRollback.input,
          requestId: "m104-atomic-image-rollback-request",
        })).toThrow();
      } finally {
        database.exec("DROP TRIGGER m104_generation_bind_receipt_fault");
      }
      expect(generationCanvasRow(database, rollback.input.canvasId)).toEqual(rollbackBefore);
      expect(generationCanvasRow(database, imageRollback.input.canvasId)).toEqual(
        imageRollbackBefore,
      );
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
        WHERE owner_id = ? AND canvas_id = ? AND idempotency_key = ?
      `).get(
        generationOwnerId,
        rollback.input.canvasId,
        rollback.input.idempotencyKey,
      )).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
        WHERE owner_id = ? AND canvas_id = ? AND idempotency_key = ?
      `).get(
        generationOwnerId,
        imageRollback.input.canvasId,
        imageRollback.input.idempotencyKey,
      )).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM canvas_operation_receipts
        WHERE owner_id = ? AND canvas_id = ?
      `).get(generationOwnerId, imageRollback.input.canvasId)).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM canvas_operation_receipts
        WHERE owner_id = ? AND canvas_id = ?
      `).get(generationOwnerId, rollback.input.canvasId)).toEqual({ count: 0 });
      const observabilityAfterRollback = snapshotCanvasObservabilityForTests();
      expect(observabilityAfterRollback.events.length).toBe(
        observabilityBeforeRollback.events.length,
      );
      expect(observabilityAfterRollback.events.some((event) =>
        event.event === "command"
          ? event.operationId.startsWith("server-generation-bind:") &&
            event.requestId === "m104-atomic-rollback-request"
          : event.taskId === rollback.input.idempotencyKey ||
            event.requestId === "m104-atomic-rollback-request"
      )).toBe(false);
      expect(observabilityAfterRollback.events.some((event) =>
        event.requestId === "m104-atomic-image-rollback-request"
      )).toBe(false);

      database.prepare(`
        UPDATE canvas_documents SET graph_revision = 2
        WHERE owner_id = ? AND id = ?
      `).run(generationOwnerId, staleRevision.input.canvasId);
      expect(() => admitPreparedGenerationTask({
        input: staleRevision.input,
        requestId: "m104-atomic-stale-revision-request",
      })).toThrow(GenerationTaskCanvasRevisionConflictError);
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
        WHERE owner_id = ? AND canvas_id = ?
      `).get(generationOwnerId, staleRevision.input.canvasId)).toEqual({ count: 0 });

      const changedNodes = JSON.parse(
        generationCanvasRow(database, staleFingerprint.input.canvasId).nodes,
      ) as Array<{ data: Record<string, unknown> }>;
      changedNodes[0]!.data.textPrompt = "m104 changed after preflight";
      database.prepare(`
        UPDATE canvas_documents SET revision = 2, nodes = ?
        WHERE owner_id = ? AND id = ?
      `).run(
        JSON.stringify(changedNodes),
        generationOwnerId,
        staleFingerprint.input.canvasId,
      );
      expect(() => admitPreparedGenerationTask({
        input: staleFingerprint.input,
        requestId: "m104-atomic-stale-fingerprint-request",
      })).toThrow(CanvasGenerationBindingConflictError);
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
        WHERE owner_id = ? AND canvas_id = ?
      `).get(generationOwnerId, staleFingerprint.input.canvasId)).toEqual({ count: 0 });
    } finally {
      if (applicationStoreStarted) {
        await expect.poll(() => {
          try { resetGenerationTaskStoreForRuntimeTest(); return "released"; }
          catch (error) { return error instanceof Error ? error.message : String(error); }
        }, { timeout: 5_000 }).toBe("released");
      }
      if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
      else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
      if (previousSafeTest === undefined) delete process.env.UNBOUNDRY_SAFE_TEST;
      else process.env.UNBOUNDRY_SAFE_TEST = previousSafeTest;
      resetCanvasObservabilityForTests();
    }
  });
});

test("single-node result success survives projection rollback and retries once after restart", async () => {
  await withDatabase("m104-single-node-projection-fault", async (
    database,
    directory,
    canvasId,
  ) => {
    const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
    const previousSafeTest = process.env.UNBOUNDRY_SAFE_TEST;
    process.env.UNBOUNDRY_DATA_DIR = directory;
    process.env.UNBOUNDRY_SAFE_TEST = "1";
    let applicationStoreStarted = false;
    resetCanvasObservabilityForTests();
    try {
      const timestamp = "2026-09-04T00:00:00.000Z";
      database.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (?, ?, 'M104 projection', 'test-only', 'user', 'active', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(generationOwnerId, generationOwnerId, timestamp, timestamp);
      database.prepare(`
        UPDATE project_metadata SET owner_id = ? WHERE id = ?
      `).run(generationOwnerId, canvasId);
      database.prepare(`
        UPDATE generation_safety_settings
        SET global_enabled = 1, emergency_stop = 0,
            per_user_concurrency = 10, text_concurrency = 10,
            requests_per_minute = 100
        WHERE id = 1
      `).run();

      const contract = atomicGenerationContract();
      const fixture = generationFixture(
        database,
        canvasId,
        "m104-single-node-projection-fault-key",
        "m104 single-node projection prompt",
        contract,
      );
      applicationStoreStarted = true;
      expect(() => admitPreparedGenerationTask({
        input: fixture.input,
        requestId: "m104-single-node-projection-admission",
        afterCommit: () => {
          throw new Error("m104 stop before Provider launch");
        },
      })).toThrow(GenerationAdmissionPostCommitError);
      const task = database.prepare(`
        SELECT id FROM generation_tasks
        WHERE owner_id = ? AND canvas_id = ? AND idempotency_key = ?
      `).get(
        generationOwnerId,
        canvasId,
        fixture.input.idempotencyKey,
      ) as { id: string } | undefined;
      if (!task) throw new Error("M104 projection task was not committed");
      const taskStore = generationTaskApplication.taskStore();
      expect(taskStore.transition(task.id, "running")).toMatchObject({
        attempt: 1,
        state: "running",
      });
      const canvasBeforeProjection = generationCanvasRow(database, canvasId);
      resetCanvasObservabilityForTests();
      setGenerationProjectionReceiptFaultForTests((projection) => {
        if (projection.scope === "single-node" && projection.taskId === task.id) {
          throw new Error("m104 projection fault");
        }
      });
      try {
        expect(commitGenerationTextResult({
          actualCostMicrounits: 0,
          dataDirectory: directory,
          executionAttempt: 1,
          resultText: "m104 durable text result",
          taskId: task.id,
        })).toEqual({
          projectionState: "failed",
          state: "success",
          taskId: task.id,
        });
      } finally {
        setGenerationProjectionReceiptFaultForTests(undefined);
      }
      expect(database.prepare(`
        SELECT state, attempt, result_text, error_code, error_message
        FROM generation_tasks WHERE id = ?
      `).get(task.id)).toEqual({
        attempt: 1,
        error_code: null,
        error_message: null,
        result_text: "m104 durable text result",
        state: "success",
      });
      expect(generationCanvasRow(database, canvasId)).toEqual(
        canvasBeforeProjection,
      );
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM canvas_operation_receipts
        WHERE owner_id = ? AND canvas_id = ?
          AND operation_id LIKE 'server-projection:%'
      `).get(generationOwnerId, canvasId)).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT state, failure_count, last_error_class
        FROM generation_canvas_projection_states WHERE task_id = ?
      `).get(task.id)).toEqual({
        failure_count: 1,
        last_error_class: "B",
        state: "failed",
      });
      const failedEvents = snapshotCanvasObservabilityForTests().events
        .filter((event) => event.outcome === "projection.failed" && (
          ("taskId" in event && event.taskId === task.id) ||
          ("operationId" in event &&
            event.operationId === `server-projection-unresolved:${task.id}`)
        ));
      expect(failedEvents.map((event) => event.event).sort()).toEqual([
        "command",
        "generation-lifecycle",
        "route",
      ]);
      expect(snapshotCanvasObservabilityForTests().events.some((event) =>
        event.outcome === "projection.applied" &&
        "taskId" in event && event.taskId === task.id
      )).toBe(false);

      const restarted = openAppDatabase(directory);
      restarted.exec("BEGIN");
      try {
        expect(inspectSingleNodeGenerationCanvasState({
          database: restarted,
          ownerId: generationOwnerId,
          taskId: task.id,
        })).toMatchObject({
          bindingMatches: true,
          projectionState: "failed",
        });
      } finally {
        restarted.exec("COMMIT");
        restarted.close();
      }
      expect(singleNodeCanvasProjectionCandidateCount(directory)).toBe(1);

      expect(retrySingleNodeCanvasProjections({ dataDirectory: directory }))
        .toEqual({ applied: 1, conflict: 0, failed: 0, visited: 1 });
      expect(singleNodeCanvasProjectionCandidateCount(directory)).toBe(0);
      const projectedCanvas = generationCanvasRow(database, canvasId);
      const projectedData = JSON.parse(projectedCanvas.nodes)[0].data as
        Record<string, unknown>;
      expect(projectedData).toMatchObject({
        content: "m104 durable text result",
        groupRunSuccessTaskId: task.id,
        textGenerating: false,
        textGenerationTaskId: task.id,
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM canvas_operation_receipts
        WHERE owner_id = ? AND canvas_id = ?
          AND operation_id LIKE 'server-projection:%'
      `).get(generationOwnerId, canvasId)).toEqual({ count: 1 });
      expect(database.prepare(`
        SELECT state, failure_count, last_error_class
        FROM generation_canvas_projection_states WHERE task_id = ?
      `).get(task.id)).toEqual({
        failure_count: 0,
        last_error_class: null,
        state: "applied",
      });
      expect(retrySingleNodeCanvasProjections({ dataDirectory: directory }))
        .toEqual({ applied: 0, conflict: 0, failed: 0, visited: 0 });
    } finally {
      try {
        setGenerationProjectionReceiptFaultForTests(undefined);
      } catch {}
      if (applicationStoreStarted) {
        await expect.poll(() => {
          try { resetGenerationTaskStoreForRuntimeTest(); return "released"; }
          catch (error) { return error instanceof Error ? error.message : String(error); }
        }, { timeout: 5_000 }).toBe("released");
      }
      if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
      else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
      if (previousSafeTest === undefined) delete process.env.UNBOUNDRY_SAFE_TEST;
      else process.env.UNBOUNDRY_SAFE_TEST = previousSafeTest;
      resetCanvasObservabilityForTests();
    }
  });
});

test("single-node success reports settlement unavailable and remains retryable when failure bookkeeping also faults", async () => {
  await withDatabase("m104-single-node-projection-settlement-fault", async (
    database,
    directory,
    canvasId,
  ) => {
    const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
    const previousSafeTest = process.env.UNBOUNDRY_SAFE_TEST;
    process.env.UNBOUNDRY_DATA_DIR = directory;
    process.env.UNBOUNDRY_SAFE_TEST = "1";
    let applicationStoreStarted = false;
    resetCanvasObservabilityForTests();
    try {
      const timestamp = "2026-09-04T00:00:00.000Z";
      database.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (?, ?, 'M104 settlement', 'test-only', 'user', 'active', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(generationOwnerId, generationOwnerId, timestamp, timestamp);
      database.prepare(`
        UPDATE project_metadata SET owner_id = ? WHERE id = ?
      `).run(generationOwnerId, canvasId);
      database.prepare(`
        UPDATE generation_safety_settings
        SET global_enabled = 1, emergency_stop = 0,
            per_user_concurrency = 10, text_concurrency = 10,
            requests_per_minute = 100
        WHERE id = 1
      `).run();

      const fixture = generationFixture(
        database,
        canvasId,
        "m104-single-node-settlement-fault-key",
        "m104 settlement unavailable prompt",
        atomicGenerationContract(),
      );
      applicationStoreStarted = true;
      expect(() => admitPreparedGenerationTask({
        input: fixture.input,
        requestId: "m104-single-node-settlement-admission",
        afterCommit: () => {
          throw new Error("m104 stop before Provider launch");
        },
      })).toThrow(GenerationAdmissionPostCommitError);
      const task = database.prepare(`
        SELECT id FROM generation_tasks
        WHERE owner_id = ? AND canvas_id = ? AND idempotency_key = ?
      `).get(
        generationOwnerId,
        canvasId,
        fixture.input.idempotencyKey,
      ) as { id: string } | undefined;
      if (!task) throw new Error("M104 settlement task was not committed");
      expect(generationTaskApplication.taskStore().transition(task.id, "running"))
        .toMatchObject({ attempt: 1, state: "running" });
      const canvasBeforeProjection = generationCanvasRow(database, canvasId);

      resetCanvasObservabilityForTests();
      setGenerationProjectionReceiptFaultForTests((projection) => {
        if (projection.scope === "single-node" && projection.taskId === task.id) {
          throw new Error("m104 projection write fault");
        }
      });
      setSingleNodeProjectionSettlementFaultForTests((state) => {
        if (state === "failed") throw new Error("m104 settlement write fault");
      });
      try {
        expect(commitGenerationTextResult({
          actualCostMicrounits: 0,
          dataDirectory: directory,
          executionAttempt: 1,
          resultText: "m104 durable settlement text",
          taskId: task.id,
        })).toEqual({
          projectionState: "settlement-unavailable",
          state: "success",
          taskId: task.id,
        });
      } finally {
        setGenerationProjectionReceiptFaultForTests(undefined);
        setSingleNodeProjectionSettlementFaultForTests(undefined);
      }

      expect(database.prepare(`
        SELECT state, result_text FROM generation_tasks WHERE id = ?
      `).get(task.id)).toEqual({
        result_text: "m104 durable settlement text",
        state: "success",
      });
      expect(generationCanvasRow(database, canvasId)).toEqual(canvasBeforeProjection);
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM canvas_operation_receipts
        WHERE owner_id = ? AND canvas_id = ?
          AND operation_id LIKE 'server-projection:%'
      `).get(generationOwnerId, canvasId)).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM generation_canvas_projection_states
        WHERE task_id = ?
      `).get(task.id)).toEqual({ count: 0 });
      const unavailableEvents = snapshotCanvasObservabilityForTests().events
        .filter((event) => event.outcome === "projection.settlement-unavailable" && (
          ("taskId" in event && event.taskId === task.id) ||
          ("operationId" in event &&
            event.operationId === `server-projection-unresolved:${task.id}`)
        ));
      expect(unavailableEvents.map((event) => event.event).sort()).toEqual([
        "command",
        "generation-lifecycle",
        "route",
      ]);
      expect(singleNodeCanvasProjectionCandidateCount(directory)).toBe(1);

      expect(retrySingleNodeCanvasProjections({ dataDirectory: directory }))
        .toEqual({ applied: 1, conflict: 0, failed: 0, visited: 1 });
      expect(singleNodeCanvasProjectionCandidateCount(directory)).toBe(0);
      const projectedData = JSON.parse(generationCanvasRow(database, canvasId).nodes)[0]
        .data as Record<string, unknown>;
      expect(projectedData).toMatchObject({
        content: "m104 durable settlement text",
        groupRunSuccessTaskId: task.id,
        textGenerating: false,
        textGenerationTaskId: task.id,
      });
      expect(database.prepare(`
        SELECT state, failure_count, last_error_class
        FROM generation_canvas_projection_states WHERE task_id = ?
      `).get(task.id)).toEqual({
        failure_count: 0,
        last_error_class: null,
        state: "applied",
      });
    } finally {
      try {
        setGenerationProjectionReceiptFaultForTests(undefined);
        setSingleNodeProjectionSettlementFaultForTests(undefined);
      } catch {}
      if (applicationStoreStarted) {
        await expect.poll(() => {
          try { resetGenerationTaskStoreForRuntimeTest(); return "released"; }
          catch (error) { return error instanceof Error ? error.message : String(error); }
        }, { timeout: 5_000 }).toBe("released");
      }
      if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
      else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
      if (previousSafeTest === undefined) delete process.env.UNBOUNDRY_SAFE_TEST;
      else process.env.UNBOUNDRY_SAFE_TEST = previousSafeTest;
      resetCanvasObservabilityForTests();
    }
  });
});


test("AR sizing mode, adoption and layout have one durable authority", async () => {
  const { adoptedMediaStyle, fitVisualMediaSize } = await import("../types/mediaGeometry");
  const { canvasDocumentFingerprint, canvasInputGraphFingerprint } = await import("../types/canvasFingerprint");
  expect(fitVisualMediaSize(816, 1104)).toEqual({ width: 250, height: 338 });
  expect(fitVisualMediaSize(9, 16)).toEqual({ width: 250, height: 444 });
  for (const kind of ["image", "video"] as const) for (const mode of [undefined, "manual", "auto"]) {
    const node = { id: "visual", type: kind, position: { x: 4, y: 8 },
      style: { width: 620, height: 420 }, data: { label: "Video", ...(mode ? { mediaSizingMode: mode } : {}) } };
    const document = { nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const asset = { assetId: "asset-video", byteSize: 100, contentType: kind === "video" ? "video/mp4" : "image/png", src: `/api/${kind}-assets/asset-video.${kind === "video" ? "mp4" : "png"}`,
      storageBackend: "local" as const, width: 816, height: 1104, durationSeconds: 2 };
    const command = { kind: "adopt-uploaded-asset" as const, nodeId: "visual", mediaKind: kind, asset,
      baseDocumentRevision: 1, baseInputGraphRevision: 1, observedLoadToken: "token",
      operationId: "adopt-aspect", saveSessionId: "session-aspect", saveSequence: 1 };
    const result = applyCanvasUserCommand({ command, currentDocument: document, authoritativeAsset: asset });
    const adopted = result.document.nodes[0] as typeof node;
    expect(adopted.style).toEqual(mode === "auto" ? { width: 250, height: 338 } : node.style);
    expect(adopted.position).toEqual(node.position);
    const layout = { ...command, kind: "commit-user-layout" as const,
      nodes: [{ nodeId: "visual", style: { width: 300, height: 350 }, mediaSizingMode: "manual" as const }] };
    const changed = applyCanvasUserCommand({ command: layout, currentDocument: result.document });
    expect(canvasInputGraphFingerprint(changed.document)).toBe(canvasInputGraphFingerprint(result.document));
    expect(canvasDocumentFingerprint(changed.document)).not.toBe(canvasDocumentFingerprint(result.document));
    expect((changed.document.nodes[0] as typeof node).data.mediaSizingMode).toBe("manual");
    // Both serializations of an upload finishing against a manual resize retain
    // the resize. The media identity still moves to the newly adopted asset.
    const manualFirst = applyCanvasUserCommand({ command: layout, currentDocument: document });
    const uploadAfterManual = applyCanvasUserCommand({ command, currentDocument: manualFirst.document, authoritativeAsset: asset });
    expect(uploadAfterManual.document.nodes[0]).toMatchObject({style:{width:300,height:350}, data:{mediaSizingMode:"manual",assetId:asset.assetId}});
    expect(changed.document.nodes[0]).toMatchObject({style:{width:300,height:350}, data:{mediaSizingMode:"manual",assetId:asset.assetId}});
    const oldClient = applyCanvasUserCommand({ command: { ...layout, nodes: [{ nodeId: "visual", style: { width: 444 } }] }, currentDocument: result.document });
    expect((oldClient.document.nodes[0] as typeof node).data.mediaSizingMode).toBe("manual");
    expect(adoptedMediaStyle({ type: "video" }, { mediaSizingMode: "auto", mediaWidth: NaN, mediaHeight: 10 })).toBeUndefined();
  }
  const { mergeWorkflowResultNodes, planCanvasCommandIntents } = await import("../client/src/canvas/canvasCommandJournal");
  const before = { id: "result", type: "video", position: { x: 3, y: 4 }, style: { width: 444, height: 250 },
    data: { label: "Video", mediaSizingMode: "auto" } };
  const incoming = { ...before, style: { width: 250, height: 338 }, data: { ...before.data,
    mediaWidth: 816, mediaHeight: 1104, groupRunSuccessTaskId: "task", groupRunSuccessOwnershipKey: "owner", groupRunSuccessResultKey: "result-key" } };
  const run: Parameters<typeof mergeWorkflowResultNodes>[0]["run"] = {
    canvasId: "canvas", clientSemanticFingerprint: "client", createdAt: "2026-09-06T00:00:00Z", groupId: "group", id: "run", lockedNodeIds: [], semanticFingerprint: "semantic", state: "success", updatedAt: "2026-09-06T00:00:01Z",
    nodes: [{ id: "result", kind: "video", taskId: "task", state: "success", projectionState: "applied" }] };
  const merged = mergeWorkflowResultNodes({ baseline: [before], current: [before], incoming: [incoming], run });
  expect((merged.nodes[0] as typeof before).style).toEqual(incoming.style);
  expect((merged.baseline[0] as typeof before).style).toEqual(incoming.style);
  const unmatchedRemote = { ...incoming, style: before.style };
  const noInventedSize = mergeWorkflowResultNodes({ baseline: [before], current: [before], incoming: [unmatchedRemote], run });
  expect((noInventedSize.nodes[0] as typeof before).style).toEqual(before.style);
  const manual = { ...before, data: { ...before.data, mediaSizingMode: "manual" }, style: { width: 333, height: 441 } };
  const concurrent = mergeWorkflowResultNodes({ baseline: [before], current: [manual], incoming: [incoming], run });
  expect((concurrent.nodes[0] as typeof before).style).toEqual(manual.style);
  expect((concurrent.nodes[0] as typeof incoming).data.groupRunSuccessTaskId).toBe("task");
  const baseline = { nodes: [before], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, revision: 1, graphRevision: 1 };
  const intents = planCanvasCommandIntents(baseline, { ...baseline, nodes: [{ ...before, data: { ...before.data, mediaSizingMode: "manual" } }] });
  expect(intents.map((i) => i.entry.kind)).toEqual(["commit-user-layout"]);
  expect(intents[0].entry).toMatchObject({ nodes: [{ nodeId: "result", mediaSizingMode: "manual" }] });
  const invalidMode = { baseDocumentRevision: 1, baseInputGraphRevision: 1, observedLoadToken: "token", operationId: "sizing", saveSessionId: "session", saveSequence: 1,
    kind: "commit-user-layout", nodes: [{ nodeId: "result", mediaSizingMode: "guess" }] };
  expect(parseCanvasUserCommand(invalidMode).ok).toBe(false);

  // Exercise the branded server result boundary with an already-published local
  // ledger. No worker is launched and no Provider request is made.
  const { buildCanvasProjectionIdentity } = await import("../server/generationCanvasProjection");
  const { submissionParameterValues } = await import("../types/modelParameters");
  const { applyGenerationProjectionInTransaction } = await import("../server/canvasMutationGateway");
  for (const kind of ["image", "video"] as const) for (const scope of ["single-node", "workflow"] as const) for (const mode of ["auto", "manual", undefined] as const) {
    await withDatabase(`ar-result-${scope}`, async (database, _directory, canvasId) => {
      const stamp = "2026-09-06T00:00:00Z";
      database.prepare("INSERT OR IGNORE INTO users (id,login_name,display_name,password_hash,role,status,created_at,updated_at) VALUES (?,?,'AR','test-only','user','active',?,?)").run(generationOwnerId,generationOwnerId,stamp,stamp);
      database.prepare("UPDATE project_metadata SET owner_id=? WHERE id=?").run(generationOwnerId,canvasId);
      const contract = kind === "image" ? atomicImageGenerationContract() : atomicVideoGenerationContract();
      const nodeId = "ar-target";
      insertGenerationCanvas(database, canvasId, nodeId, contract.modelId, contract.modelConfigurationRevision, "AR local fixture");
      const target = { id: nodeId, type: kind, position: { x: 10, y: 20 }, style: { width: 620, height: 420 },
        data: { label: "AR", ...(mode ? { mediaSizingMode: mode } : {}),
          [`${kind}ModelId`]: contract.modelId, [`${kind}ModelConfigurationRevision`]: contract.modelConfigurationRevision,
          [`${kind}Prompt`]: "AR local fixture", [`${kind}PromptReady`]: true, [`${kind}Parameters`]: { inputMode: "text" } } };
      database.prepare("UPDATE canvas_documents SET nodes=? WHERE owner_id=? AND id=?").run(JSON.stringify([target]),generationOwnerId,canvasId);
      const modelConfiguration = buildAuthoritativeGenerationModelConfiguration({ ...contract,
        generationInputKey: "ar-pending", generationOwnershipKey: "ar-pending", modelInputContractFingerprint: "ar-pending" });
      const projectionSchema = modelConfiguration.parameterSchema;
      database.exec("BEGIN IMMEDIATE");
      const resolved = resolvePersistedNodeInputs({ database, canvasId, bypass: false,
        ownerId: generationOwnerId, targetId: nodeId, targetKind: kind,
        modelSchema: projectionSchema, modelReleaseRevision: contract.modelReleaseRevision.revisionId,
        parameters: submissionParameterValues(projectionSchema, { inputMode: "text" }) });
      const semantic = submissionParameterValues(projectionSchema, resolved.normalizedParameters ?? {});
      const configuration = { ...modelConfiguration,
        modelInputContractFingerprint: resolved.contractFingerprint!,
        generationInputKey: generationInputKey({ inputs: resolved.inputs,
          modelConfigurationRevision: contract.modelConfigurationRevision, modelId: contract.modelId,
          modelReleaseRevision: contract.modelReleaseRevision.revisionId, ownPrompt: resolved.persistedOwnPrompt,
          parameters: semantic, prompt: resolved.finalPrompt }),
        generationOwnershipKey: generationOwnershipKey(generationOwnershipEvidence({
          contractFingerprint: resolved.contractFingerprint!, inputs: resolved.inputs, kind,
          modelConfigurationRevision: contract.modelConfigurationRevision, modelId: contract.modelId,
          modelReleaseRevision: contract.modelReleaseRevision.revisionId, parameters: semantic,
          prompt: resolved.persistedOwnPrompt })),
      };
      if (scope === "workflow") Object.assign(configuration, { workflowBinding: {
        runId: "ar-run", groupId: "ar-group", generationInputKey: configuration.generationInputKey,
        generationOwnershipKey: configuration.generationOwnershipKey,
        modelConfigurationRevision: configuration.modelConfigurationRevision,
        modelReleaseRevision: configuration.modelReleaseRevision.revisionId,
      } });
      database.prepare(`INSERT INTO generation_tasks (id,owner_id,canvas_id,node_id,kind,prompt,model,parameters,idempotency_key,request_fingerprint,state,attempt,result_asset_id,model_configuration,created_at,updated_at)
        VALUES ('ar-task',?,?,?,?,?,?,?,'ar-key','ar-fingerprint','success',1,'ar-output',?,?,?)`).run(generationOwnerId,canvasId,nodeId,kind,resolved.finalPrompt,contract.modelId,JSON.stringify(semantic),JSON.stringify(configuration),stamp,stamp);
      const storageName = kind === "image" ? "ar-output.png" : "ar-output.mp4";
      const contentType = kind === "image" ? "image/png" : "video/mp4";
      database.prepare(`INSERT INTO media_assets (kind,id,owner_id,storage_name,byte_size,created_at,updated_at,storage_backend,object_key,content_type,checksum_sha256,storage_status,duration_status,media_width,media_height,duration_seconds)
        VALUES (?,'ar-output',?,?,16,?,?,'local',?,?,?,'ready',?,816,1104,2)`).run(kind,generationOwnerId,storageName,stamp,stamp,storageName,contentType,'a'.repeat(64),kind === 'image' ? 'not-applicable' : 'ready');
      database.prepare(`INSERT INTO media_publication_attempts (attempt_id,owner_id,kind,asset_id,source,state,storage_backend,final_storage_name,object_key,staging_name,task_id,task_execution_attempt,content_type,created_at,updated_at,output_slot,output_set_count)
        VALUES ('ar-pub',?,?,'ar-output','generation','published','local',?,?,'ar-stage','ar-task',1,?,?,?,0,1)`).run(generationOwnerId,kind,storageName,storageName,contentType,stamp,stamp);
      try {
        const built = buildCanvasProjectionIdentity({ database,canvasId,kind,nodeId,ownerId:generationOwnerId,taskId:"ar-task",...(scope === "workflow" ? {runId:"ar-run"} : {}) });
        expect(built).toMatchObject({status:"ready",projection:{bindingMatches:true}});
        if (built.status!=="ready") throw new Error("AR projection identity missing");
        const args={database,projection:built.projection,loadTokenEpoch:"ar-epoch",loadTokenForRevision:(revision:number)=>`ar-token-${revision}`};
        expect(applyGenerationProjectionInTransaction(args)).toBe("applied");
        const saved=generationCanvasRow(database,canvasId);
        expect(JSON.parse(saved.nodes).find((n:{id:string})=>n.id===nodeId).style).toEqual(mode === "auto" ? {width:250,height:338} : {width:620,height:420});
        expect(applyGenerationProjectionInTransaction(args)).toBe("applied");
        expect(generationCanvasRow(database,canvasId)).toEqual(saved);
        expect(database.prepare("SELECT COUNT(*) AS n FROM generation_provider_attempts").get()).toMatchObject({n:0});
      } finally { database.exec("ROLLBACK"); }
    });
  }

});

async function withAspectCompatibility(run: (old: typeof import("../server/canvasMutationGateway") & typeof import("../types/canvasCommands") & typeof import("../server/canvasTransactionCommands") & typeof import("../types/canvasFingerprint"), bridge: typeof import("../server/canvasMutationGateway") & typeof import("../types/canvasCommands") & typeof import("../server/canvasTransactionCommands") & typeof import("../types/canvasFingerprint")) => Promise<void>) {
  const { readFile, writeFile, mkdir, symlink } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { createHash } = await import("node:crypto");
  const fixtures = JSON.parse(await readFile(resolve("tests/fixtures/media-aspect-compat-runtime.json"), "utf8"));
  const directory = await mkdtemp(join(tmpdir(), "unboundry-aspect-compat-runtime-"));
  try {
    await mkdir(join(directory, "server"));
    await writeFile(join(directory, "package.json"), JSON.stringify({type:"module",version:"0.7.13"}));
    await symlink(resolve("node_modules"), join(directory,"node_modules"), "dir");
    for (const name of ["old", "bridge"]) {
      expect(createHash("sha256").update(fixtures[name].code).digest("hex")).toBe(fixtures[name].sha256);
      await writeFile(join(directory,"server",`${name}.mjs`),fixtures[name].code);
    }
    const old = await import(pathToFileURL(join(directory,"server/old.mjs")).href);
    const bridge = await import(pathToFileURL(join(directory,"server/bridge.mjs")).href);
    await run(old, bridge);
  } finally { await rm(directory, { recursive:true, force:true }); }
}

function aspectCompatLayout(revision: number, mode?: "auto"|"manual") : CommitUserLayoutCommand {
  return { kind:"commit-user-layout",baseDocumentRevision:revision,baseInputGraphRevision:1,
    observedLoadToken:"compat-token",operationId:randomUUID(),saveSessionId:randomUUID(),saveSequence:1,
    nodes:[{nodeId:"compat-image",style:{width:333,height:441},...(mode?{mediaSizingMode:mode}:{})}] };
}

function insertAspectCompatCanvas(database: DatabaseSync, canvasId: string) {
  const node={id:"compat-image",type:"image",position:{x:12,y:34},style:{width:250,height:338},data:{
    label:"Image",mediaSizingMode:"auto",assetId:"compat-asset",imageSrc:"/api/assets/compat-asset",
    mediaWidth:816,mediaHeight:1104,mediaMetadataSource:"server",mediaMetadataStatus:"ready",
    groupRunSuccessTaskId:"completed-before-downgrade",groupRunSuccessResultKey:"preserved-proof",
    futureServerField:{keep:true}}};
  database.prepare(`INSERT INTO canvas_documents (owner_id,id,revision,graph_revision,nodes,edges,viewport,updated_at,save_session_id,save_sequence)
    VALUES (?,?,1,1,?,'[]',?,'2026-09-06T00:00:00Z','compat-initial',1)`).run(ownerId,canvasId,JSON.stringify([node]),JSON.stringify(viewport));
  database.prepare(`INSERT INTO media_assets (kind,id,owner_id,storage_name,byte_size,created_at,updated_at,storage_backend,object_key,content_type,storage_status,duration_status,media_width,media_height,checksum_sha256)
    VALUES ('image','compat-asset',?,'compat.png',16,'2026-09-06','2026-09-06','local','compat.png','image/png','ready','not-applicable',816,1104,?)`).run(ownerId,'a'.repeat(64));
  return node;
}

test("AR exact v0.7.13 code retains new data but cannot preserve sizing intent on downgrade", async () => {
  await withAspectCompatibility(async (old) => {
    expect(old.parseCanvasUserCommand(aspectCompatLayout(1,"manual")).ok).toBe(false);
    expect(old.parseCanvasUserCommand(aspectCompatLayout(1)).ok).toBe(true);
    await withDatabase("compat-old",async(database,_directory,canvasId)=>{
      const initial=insertAspectCompatCanvas(database,canvasId);
      database.exec("BEGIN IMMEDIATE");
      const result=old.applyCanvasUserCommandInTransaction({database,canvasId,ownerId,command:aspectCompatLayout(1),
        loadTokenEpoch:"compat-old",validLoadToken:()=>true,requestId:randomUUID()});
      database.exec("COMMIT");
      expect(result).toMatchObject({outcome:"APPLIED"});
      const saved=JSON.parse(row(database,canvasId).nodes)[0];
      expect(saved.style).toEqual({width:333,height:441});
      expect(saved.data).toEqual(initial.data);
      // This is a negative control: an actual old resize left auto behind.
      // Forwarding again would overwrite that manual size on the next asset.
      const { adoptedMediaStyle }=await import("../types/mediaGeometry");
      expect(adoptedMediaStyle(saved,saved.data)).toEqual({width:250,height:338});
      expect(old.durableCanvasNodes([saved])).toEqual([saved]);
    });
  });
});

test("AR compatibility bridge keeps saved media and sizing intent across forward rollback forward", async () => {
  await withAspectCompatibility(async (old,bridge)=>{
    expect(bridge.parseCanvasUserCommand(aspectCompatLayout(1,"manual")).ok).toBe(true);
    await withDatabase("compat-bridge",async(database,directory,canvasId)=>{
      const initial=insertAspectCompatCanvas(database,canvasId);
      const ledger=database.prepare("SELECT * FROM media_assets WHERE id='compat-asset'").get();
      const currentBefore=row(database,canvasId);
      const oldFormat=aspectCompatLayout(1);
      expect(old.parseCanvasUserCommand(oldFormat).ok).toBe(true);
      database.exec("BEGIN IMMEDIATE");
      const result=bridge.applyCanvasUserCommandInTransaction({database,canvasId,ownerId,command:oldFormat,
        loadTokenEpoch:"compat-bridge",validLoadToken:()=>true,requestId:randomUUID()});
      database.exec("COMMIT");
      expect(result).toMatchObject({outcome:"APPLIED"});
      expect(row(database,canvasId).graph_revision).toBe(currentBefore.graph_revision);
      const afterBridge=JSON.parse(row(database,canvasId).nodes)[0];
      expect(afterBridge.data).toEqual({...initial.data,mediaSizingMode:"manual"});
      expect(afterBridge.style).toEqual({width:333,height:441});
      const reloaded=openAppDatabase(directory);
      expect(row(reloaded,canvasId)).toEqual(row(database,canvasId));
      reloaded.close();
      const forward=aspectCompatLayout(2,"manual");
      const applied=commit(database,canvasId,{...forward,nodes:[{nodeId:"compat-image",position:{x:56,y:78}}]});
      expect(applied).toMatchObject({outcome:"APPLIED"});
      const final=JSON.parse(row(database,canvasId).nodes)[0];
      expect(final.data).toEqual(afterBridge.data);
      expect(final.style).toEqual(afterBridge.style);
      expect(final.position).toEqual({x:56,y:78});
      expect(database.prepare("SELECT * FROM media_assets WHERE id='compat-asset'").get()).toEqual(ledger);
      expect(database.prepare("SELECT COUNT(*) AS n FROM generation_tasks").get()).toMatchObject({n:0});
      expect(database.prepare("SELECT COUNT(*) AS n FROM generation_provider_attempts").get()).toMatchObject({n:0});
      const autoDocument={nodes:[initial],edges:[],viewport};
      const asset={assetId:"compat-next",byteSize:16,contentType:"image/png",src:"/api/assets/compat-next",storageBackend:"local" as const,width:640,height:360};
      const adoption={...aspectCompatLayout(1),kind:"adopt-uploaded-asset" as const,nodeId:initial.id,mediaKind:"image" as const,asset};
      const frozen=bridge.applyCanvasUserCommand({command:adoption,currentDocument:autoDocument,authoritativeAsset:asset});
      expect((frozen.document.nodes[0] as typeof initial).style).toEqual(initial.style);
      expect((frozen.document.nodes[0] as typeof initial).data.assetId).toBe(asset.assetId);
      expect((applyCanvasUserCommand({command:adoption,currentDocument:autoDocument,authoritativeAsset:asset}).document.nodes[0] as typeof initial).style).toEqual({width:444,height:250});
    });
  });
});
