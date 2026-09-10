import { projectSingleNodeGenerationResultInTransaction } from "./generationCanvasProjectionService";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  discardDeferredCanvasObservability,
  flushDeferredCanvasObservability,
} from "./canvasObservability";
import { readGenerationRecoveryCanvasCommand } from "./canvasTransactionCommands";
import {
  promoteGenerationPublicationCanonicalSlotCommand,
  readGenerationPublicationSlotsCommand,
} from "./mediaTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";
import {
  assertGenerationSaveToken,
  withGenerationResultSave,
  type GenerationSaveToken,
} from "./generationResultSaveOwnership";
import {
  adoptGenerationResultInTransaction,
  type GenerationResultAdoptionCommandInput,
} from "./generationResultAdoption";
import {
  assertGenerationAdoptionReplayInTransaction,
  GenerationResultAdoptionError,
  generationResultAdoptionMediaLedgerFromRows,
  type GenerationResultAdoptionKind,
  type GenerationResultAdoptionMediaLedger,
  type GenerationResultAdoptionPublicationEvidence,
  type GenerationResultAdoptionPublicationRole,
  type GenerationResultAdoptionTaskRow,
} from "./generationResultAdoptionQueries";
import { commitGenerationMediaOutputSetInTransaction } from "./generationResultCommit";
import { defaultMediaBlobStore } from "./mediaBlobStores";

/**
 * The workflow port is deliberately transaction scoped.  The production
 * implementation must read and project through the Workflow owner using the
 * same DatabaseSync connection; it must never open a second connection while
 * the adoption transaction is uncommitted.
 */
export type GenerationResultAdoptionWorkflowPort = Readonly<{
  readInTransaction: (
    database: DatabaseSync,
    input: Readonly<{
      ownerId: string;
      taskId: string;
      executionAttempt: number;
      canvasId: string;
      nodeId: string;
      runId: string | null;
      currentGraphRevision: number;
      canvasNode?: Readonly<Record<string, unknown>>;
    }>,
  ) => Readonly<{
    runId: string | null;
    bindingUnchanged: boolean;
  }>;
  projectInTransaction: (
    database: DatabaseSync,
    input: Readonly<{
      ownerId: string;
      taskId: string;
      executionAttempt: number;
      runId: string;
      nodeId: string;
    }>,
  ) => "projected" | "preserved" | "failed";
}>;

/**
 * Public application input.  Canvas/media ledgers, asset ids, run ids and
 * Provider evidence are intentionally absent.  They are reconstructed from
 * the task and the two owner commands below, so a caller cannot manufacture
 * a ledger or turn an arbitrary receipt id into a settlement capability.
 */
export type GenerationResultAdoptionApplicationInput = Readonly<{
  ownerId: string;
  taskId: string;
  executionAttempt: number;
  kind: GenerationResultAdoptionKind;
  incidentDigest: string;
  canonicalAttemptId: string;
  aliasAttemptId: string;
  mode: "dry-run" | "apply";
  now?: string | Date;
}>;

export type GenerationResultAdoptionApplicationResult = Readonly<{
  mode: "dry-run" | "apply";
  changed: boolean;
  idempotent: boolean;
  adoptionReceiptId: string;
  receiptDigest: string;
  canonicalAssetId: string;
  projection:
    | "dry-run"
    | "preserve-original"
    | "project-canonical"
    | "projection-failed";
  state: "dry-run" | "success";
  providerPostCount: 0;
}>;

const identifierPattern = /^[A-Za-z0-9._:@/-]{1,256}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const supportedKinds = new Set<GenerationResultAdoptionKind>([
  "audio", "image", "video",
]);

type StoredTask = Pick<GenerationResultAdoptionTaskRow,
  | "id"
  | "owner_id"
  | "canvas_id"
  | "node_id"
  | "kind"
  | "state"
  | "attempt"
  | "error_code"
  | "request_fingerprint"
  | "result_asset_id"
  | "result_text"
  | "model_configuration"
>;

type PhysicalBlobExpectation = Readonly<{
  role: "canonical" | "alias";
  attemptId: string;
  assetId: string;
  storageBackend: "local" | "oss";
  storageProfileId: string | null;
  objectKey: string;
  byteSize: number;
  checksumSha256: string;
}>;

type PhysicalBlobVerification = Readonly<{
  canonical: PhysicalBlobExpectation;
  alias: PhysicalBlobExpectation;
}>;

const maximumAdoptionBlobBytes = 512 * 1024 * 1024;

function invalid(message: string): never {
  throw new GenerationResultAdoptionError("ADOPTION_INVALID_COMMAND", message);
}

function evidenceMismatch(message: string): never {
  throw new GenerationResultAdoptionError("ADOPTION_EVIDENCE_MISMATCH", message);
}

function assertIdentifier(value: unknown, label: string) {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    invalid(`${label} is invalid`);
  }
  return value;
}

function assertHash(value: unknown, label: string) {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    invalid(`${label} is invalid`);
  }
  return value;
}

function assertAttempt(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    invalid("execution attempt is invalid");
  }
  return Number(value);
}

function taskInTransaction(
  database: DatabaseSync,
  input: GenerationResultAdoptionApplicationInput,
): StoredTask {
  const task = database.prepare(`
    SELECT id, owner_id, canvas_id, node_id, kind, state, attempt,
      error_code, request_fingerprint, result_asset_id, result_text,
      model_configuration
    FROM generation_tasks WHERE id = ?
  `).get(input.taskId) as StoredTask | undefined;
  if (!task || task.owner_id !== input.ownerId || task.kind !== input.kind ||
      task.attempt !== input.executionAttempt ||
      !supportedKinds.has(task.kind as GenerationResultAdoptionKind)) {
    evidenceMismatch("task identity is not the requested adoption scope");
  }
  if (task.state !== "failed" || task.error_code !== "PROVIDER_RESULT_FORMAT" ||
      task.result_asset_id !== null || task.result_text !== null) {
    evidenceMismatch("task is not an unsettled Provider result-format incident");
  }
  return task;
}

function taskForReplayInTransaction(
  database: DatabaseSync,
  input: GenerationResultAdoptionApplicationInput,
): StoredTask {
  const task = database.prepare(`
    SELECT id, owner_id, canvas_id, node_id, kind, state, attempt,
      error_code, request_fingerprint, result_asset_id, result_text,
      model_configuration
    FROM generation_tasks WHERE id = ?
  `).get(input.taskId) as StoredTask | undefined;
  if (!task || task.owner_id !== input.ownerId || task.kind !== input.kind ||
      task.attempt !== input.executionAttempt ||
      !supportedKinds.has(task.kind as GenerationResultAdoptionKind)) {
    evidenceMismatch("task identity is not the requested adoption scope");
  }
  return task;
}

function runIdFromTask(task: Pick<StoredTask, "model_configuration">) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(task.model_configuration);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const binding = (parsed as Record<string, unknown>).workflowBinding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return null;
  const runId = (binding as Record<string, unknown>).runId;
  if (typeof runId !== "string" || !identifierPattern.test(runId)) {
    evidenceMismatch("workflow binding run id is invalid");
  }
  return runId;
}

function currentAssetId(canvasNode: Readonly<Record<string, unknown>>) {
  const data = canvasNode.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const assetId = (data as Record<string, unknown>).assetId;
  return typeof assetId === "string" && identifierPattern.test(assetId)
    ? assetId
    : null;
}

function publicationRoles(
  rows: readonly Record<string, unknown>[],
  input: GenerationResultAdoptionApplicationInput,
) {
  if (rows.length !== 3) evidenceMismatch("adoption requires exactly three publication rows");
  if (input.canonicalAttemptId === input.aliasAttemptId) {
    evidenceMismatch("canonical and alias attempts must be distinct");
  }
  const roles: Record<string, GenerationResultAdoptionPublicationRole> = {};
  const canonical = rows.find((row) => row.attempt_id === input.canonicalAttemptId);
  const alias = rows.find((row) => row.attempt_id === input.aliasAttemptId);
  if (!canonical || !alias) evidenceMismatch("selected canonical/alias rows are missing");
  roles[input.canonicalAttemptId] = "canonical";
  roles[input.aliasAttemptId] = "alias";
  const failed = rows.filter((row) => row.state === "failed");
  if (failed.length !== 1 || typeof failed[0]?.attempt_id !== "string") {
    evidenceMismatch("adoption requires one failed publication row");
  }
  const failedAttemptId = String(failed[0]!.attempt_id);
  if (roles[failedAttemptId] !== undefined) {
    evidenceMismatch("a failed publication cannot be canonical or alias");
  }
  roles[failedAttemptId] = "failed";
  for (const row of rows) {
    if (typeof row.attempt_id !== "string" || roles[row.attempt_id] === undefined) {
      evidenceMismatch("publication row is outside the selected A/B/C evidence");
    }
  }
  if (typeof canonical.asset_id !== "string" || typeof alias.asset_id !== "string") {
    evidenceMismatch("selected publication assets are missing");
  }
  return Object.freeze({
    roles: Object.freeze(roles),
    canonicalAssetId: canonical.asset_id,
    aliasAssetId: alias.asset_id,
  });
}

function physicalExpectation(
  publication: GenerationResultAdoptionPublicationEvidence,
): PhysicalBlobExpectation {
  if (publication.state !== "published" || publication.byteSize < 1 ||
      !publication.checksumSha256 || publication.mediaStorageStatus !== "ready" ||
      publication.deletionState !== null) {
    evidenceMismatch(
      `${publication.role} publication does not have a readable ready object`,
    );
  }
  if (publication.byteSize > maximumAdoptionBlobBytes) {
    evidenceMismatch(`${publication.role} publication exceeds the bounded read limit`);
  }
  return Object.freeze({
    role: publication.role === "canonical" || publication.role === "alias"
      ? publication.role
      : evidenceMismatch("failed publication cannot be read as a result"),
    attemptId: publication.attemptId,
    assetId: publication.assetId,
    storageBackend: publication.storageBackend,
    storageProfileId: publication.storageProfileId,
    objectKey: publication.objectKey,
    byteSize: publication.byteSize,
    checksumSha256: publication.checksumSha256,
  });
}

function physicalVerificationFromRows(
  rows: readonly Record<string, unknown>[],
  input: GenerationResultAdoptionApplicationInput,
): PhysicalBlobVerification {
  const selected = publicationRoles(rows, input);
  const ledger = generationResultAdoptionMediaLedgerFromRows(rows, selected.roles);
  const canonical = ledger.publications.find((publication) =>
    publication.role === "canonical",
  );
  const alias = ledger.publications.find((publication) => publication.role === "alias");
  if (!canonical || !alias) evidenceMismatch("published adoption candidates are missing");
  if (canonical.assetId !== selected.canonicalAssetId ||
      alias.assetId !== selected.aliasAssetId) {
    evidenceMismatch("published adoption candidate identity changed");
  }
  if (canonical.byteSize !== alias.byteSize ||
      canonical.checksumSha256 !== alias.checksumSha256 ||
      canonical.contentType !== alias.contentType ||
      canonical.storageBackend !== alias.storageBackend ||
      canonical.storageProfileId !== alias.storageProfileId) {
    evidenceMismatch("published adoption candidates are not same-origin bytes");
  }
  return Object.freeze({
    canonical: physicalExpectation(canonical),
    alias: physicalExpectation(alias),
  });
}

function assertPhysicalExpectationMatches(
  expected: PhysicalBlobExpectation,
  actual: GenerationResultAdoptionPublicationEvidence,
) {
  if (actual.role !== expected.role || actual.attemptId !== expected.attemptId ||
      actual.assetId !== expected.assetId || actual.storageBackend !== expected.storageBackend ||
      actual.storageProfileId !== expected.storageProfileId ||
      actual.objectKey !== expected.objectKey || actual.byteSize !== expected.byteSize ||
      actual.checksumSha256 !== expected.checksumSha256 ||
      actual.state !== "published" || actual.mediaStorageStatus !== "ready" ||
      actual.deletionState !== null) {
    evidenceMismatch(`${expected.role} publication changed during object verification`);
  }
}

function assertPhysicalVerificationMatchesLedger(
  verification: PhysicalBlobVerification,
  ledger: GenerationResultAdoptionMediaLedger,
) {
  const canonical = ledger.publications.find((publication) =>
    publication.role === "canonical",
  );
  const alias = ledger.publications.find((publication) => publication.role === "alias");
  if (!canonical || !alias) evidenceMismatch("published adoption candidates are missing");
  assertPhysicalExpectationMatches(verification.canonical, canonical);
  assertPhysicalExpectationMatches(verification.alias, alias);
}

function physicalReference(expectation: PhysicalBlobExpectation) {
  return {
    backend: expectation.storageBackend,
    objectKey: expectation.objectKey,
    ...(expectation.storageProfileId
      ? { storageProfileId: expectation.storageProfileId }
      : {}),
  } as const;
}

async function verifyPhysicalBlob(
  store: ReturnType<typeof defaultMediaBlobStore>,
  expectation: PhysicalBlobExpectation,
  saveToken: GenerationSaveToken,
) {
  // The save owner is the fence around every await. A lease expiry or holder
  // change must stop before this read can be mistaken for adoption evidence.
  assertGenerationSaveToken(saveToken);
  let bytes: Uint8Array;
  try {
    bytes = await store.read(physicalReference(expectation), {
      maximumBytes: expectation.byteSize,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new GenerationResultAdoptionError(
      "ADOPTION_EVIDENCE_MISMATCH",
      `${expectation.role} publication object is unavailable`,
    );
  }
  assertGenerationSaveToken(saveToken);
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== expectation.byteSize ||
      checksumSha256 !== expectation.checksumSha256) {
    evidenceMismatch(`${expectation.role} publication object bytes do not match its ledger`);
  }
  return Object.freeze({
    ...expectation,
    actualByteSize: bytes.byteLength,
    actualChecksumSha256: checksumSha256,
  });
}

async function readAndVerifyPhysicalAdoptionEvidence(
  input: GenerationResultAdoptionApplicationInput,
  saveToken: GenerationSaveToken,
): Promise<PhysicalBlobVerification> {
  assertGenerationSaveToken(saveToken);
  const database = openAppDatabase();
  let verification: PhysicalBlobVerification | undefined;
  try {
    database.exec("BEGIN");
    const task = taskForReplayInTransaction(database, input);
    if (task.state !== "failed" && task.state !== "success") {
      evidenceMismatch("task is not in a recoverable or already-adopted state");
    }
    const canvasSnapshot = executeTransactionScopedCommand(
      database,
      readGenerationRecoveryCanvasCommand,
      { ownerId: input.ownerId, canvasId: task.canvas_id, nodeId: task.node_id },
    );
    if (!canvasSnapshot.canvas) {
      evidenceMismatch("Canvas document or owner is unavailable");
    }
    const rows = executeTransactionScopedCommand(
      database,
      readGenerationPublicationSlotsCommand,
      { taskId: input.taskId, executionAttempt: input.executionAttempt },
    );
    verification = physicalVerificationFromRows(rows, input);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
  assertGenerationSaveToken(saveToken);
  const store = defaultMediaBlobStore(appDataDirectory());
  if (!verification) evidenceMismatch("physical adoption evidence was not captured");
  await verifyPhysicalBlob(store, verification.canonical, saveToken);
  await verifyPhysicalBlob(store, verification.alias, saveToken);
  assertGenerationSaveToken(saveToken);
  return verification;
}

function begin(database: DatabaseSync) {
  database.exec("BEGIN IMMEDIATE");
}

function rollback(database: DatabaseSync) {
  if (database.isTransaction) database.exec("ROLLBACK");
  discardDeferredCanvasObservability(database);
}

function executeAdoptionTransaction(
  database: DatabaseSync,
  input: GenerationResultAdoptionApplicationInput,
  saveToken: GenerationSaveToken,
  workflow: GenerationResultAdoptionWorkflowPort,
  physicalVerification: PhysicalBlobVerification,
): GenerationResultAdoptionApplicationResult {
  begin(database);
  try {
    const task = taskForReplayInTransaction(database, input);
    const canvasSnapshot = executeTransactionScopedCommand(
      database,
      readGenerationRecoveryCanvasCommand,
      { ownerId: input.ownerId, canvasId: task.canvas_id, nodeId: task.node_id },
    );
    if (!canvasSnapshot.canvas) {
      evidenceMismatch("Canvas document or owner is unavailable");
    }
    const canvas = canvasSnapshot.canvas;
    const canvasNode = canvasSnapshot.canvasNode;
    const runId = runIdFromTask(task);
    const workflowEvidence = workflow.readInTransaction(database, {
      ownerId: input.ownerId,
      taskId: input.taskId,
      executionAttempt: input.executionAttempt,
      canvasId: task.canvas_id,
      nodeId: task.node_id,
      runId,
      currentGraphRevision: Number(canvas.graph_revision),
      canvasNode,
    });
    if (!workflowEvidence || workflowEvidence.runId !== runId) {
      evidenceMismatch("workflow binding evidence is unavailable or changed");
    }
    const bindingUnchanged = Boolean(canvasNode) && workflowEvidence.bindingUnchanged;
    if (input.mode === "apply" && task.state === "success") {
      // Replay never settles the task again. Verify the actual Canvas outcome
      // through its idempotent command, including an interrupted old projection.
      const existing = database.prepare(`
        SELECT id FROM generation_result_adoptions
        WHERE owner_id = ? AND task_id = ? AND execution_attempt = ?
          AND incident_digest = ?
        LIMIT 1
      `).get(input.ownerId, input.taskId, input.executionAttempt,
        input.incidentDigest) as { id: string } | undefined;
      if (!existing) evidenceMismatch("successful task has no matching adoption receipt");
      const replayRows = executeTransactionScopedCommand(
        database,
        readGenerationPublicationSlotsCommand,
        { taskId: input.taskId, executionAttempt: input.executionAttempt },
      );
      const replaySelected = publicationRoles(replayRows, input);
      const replayLedger = generationResultAdoptionMediaLedgerFromRows(
        replayRows,
        replaySelected.roles,
      );
      assertPhysicalVerificationMatchesLedger(physicalVerification, replayLedger);
      const replay = assertGenerationAdoptionReplayInTransaction(database, {
        executionAttempt: input.executionAttempt,
        kind: input.kind,
        ownerId: input.ownerId,
        taskId: input.taskId,
        adoptionReceiptId: existing.id,
      });
      const replayCanonical = replay.receipt.media.publications.find((item) =>
        item.role === "canonical",
      );
      const replayAlias = replay.receipt.media.publications.find((item) =>
        item.role === "alias",
      );
      if (!replayCanonical || !replayAlias ||
          replayCanonical.attemptId !== input.canonicalAttemptId ||
          replayAlias.attemptId !== input.aliasAttemptId ||
          replayCanonical.assetId !== replay.receipt.media.canonicalAssetId) {
        evidenceMismatch("successful task adoption receipt does not match requested publications");
      }
      let projection: GenerationResultAdoptionApplicationResult["projection"] = "preserve-original";
      if (bindingUnchanged && replay.projection === "project-canonical") {
        const projected = runId
          ? workflow.projectInTransaction(database, {
              ownerId: input.ownerId, taskId: input.taskId,
              executionAttempt: input.executionAttempt, runId, nodeId: task.node_id,
            })
          : projectSingleNodeGenerationResultInTransaction(database, input.taskId);
        if (projected === "failed" || projected === "settlement-unavailable" || projected === "workflow-owned") {
          throw new Error("原结果回填暂未完成，采用事务已撤销；原素材仍保留");
        }
        projection = projected === "projected" || projected === "applied"
          ? "project-canonical" : "preserve-original";
      }
      database.exec("COMMIT");
      flushDeferredCanvasObservability(database);
      return Object.freeze({
        mode: "apply",
        changed: false,
        idempotent: true,
        adoptionReceiptId: existing.id,
        receiptDigest: replay.receipt.receiptDigest,
        canonicalAssetId: replay.receipt.media.canonicalAssetId,
        projection,
        state: "success",
        providerPostCount: 0,
      });
    }

    const unsettledTask = taskInTransaction(database, input);
    const rows = executeTransactionScopedCommand(
      database,
      readGenerationPublicationSlotsCommand,
      { taskId: input.taskId, executionAttempt: input.executionAttempt },
    );
    const selected = publicationRoles(rows, input);
    const media = generationResultAdoptionMediaLedgerFromRows(rows, selected.roles);
    assertPhysicalVerificationMatchesLedger(physicalVerification, media);
    const canvasBinding = {
      canvasId: unsettledTask.canvas_id,
      nodeId: unsettledTask.node_id,
      graphRevision: Number(canvas.graph_revision),
      inputFingerprint: unsettledTask.request_fingerprint,
      currentAssetId: currentAssetId(canvasNode ?? {}),
      bindingUnchanged,
    } as const;
    const adoptionInput: GenerationResultAdoptionCommandInput = {
      ownerId: input.ownerId,
      taskId: input.taskId,
      executionAttempt: input.executionAttempt,
      kind: input.kind,
      incidentDigest: input.incidentDigest,
      canvas: canvasBinding,
      media,
      canonicalAttemptId: input.canonicalAttemptId,
      canonicalAssetId: selected.canonicalAssetId,
      aliasAttemptId: input.aliasAttemptId,
      aliasAssetId: selected.aliasAssetId,
      // This is a fixed application invariant, not caller-supplied evidence.
      providerPostCount: 0,
      runId,
      receiptId: `adoption-${input.incidentDigest}`,
      now: input.now,
    };

    database.exec("SAVEPOINT adoption_application");
    const adopted = adoptGenerationResultInTransaction(database, adoptionInput);
    if (input.mode === "dry-run") {
      database.exec("ROLLBACK TO SAVEPOINT adoption_application");
      database.exec("RELEASE SAVEPOINT adoption_application");
      discardDeferredCanvasObservability(database);
      database.exec("COMMIT");
      flushDeferredCanvasObservability(database);
      return Object.freeze({
        mode: "dry-run",
        changed: adopted.changed,
        idempotent: !adopted.changed,
        adoptionReceiptId: adopted.id,
        receiptDigest: adopted.receiptDigest,
        canonicalAssetId: selected.canonicalAssetId,
        projection: "dry-run",
        state: "dry-run",
        providerPostCount: 0,
      });
    }
    database.exec("RELEASE SAVEPOINT adoption_application");

    executeTransactionScopedCommand(
      database,
      promoteGenerationPublicationCanonicalSlotCommand,
      adopted.mediaSlotPromotion,
    );
    const committed = commitGenerationMediaOutputSetInTransaction(database, {
      assetIds: [selected.canonicalAssetId],
      executionAttempt: input.executionAttempt,
      kind: input.kind,
      ownerId: input.ownerId,
      taskId: input.taskId,
      adoptionReceiptId: adopted.id,
      saveToken,
    });

    let projection: GenerationResultAdoptionApplicationResult["projection"] =
      "preserve-original";
    if (!bindingUnchanged) {
      projection = "preserve-original";
    } else if (runId) {
      const projected = workflow.projectInTransaction(database, {
        ownerId: input.ownerId,
        taskId: input.taskId,
        executionAttempt: input.executionAttempt,
        runId,
        nodeId: unsettledTask.node_id,
      });
      projection = projected === "projected" ? "project-canonical"
        : projected === "preserved" ? "preserve-original" : "projection-failed";
    } else {
      // A single-node caller has no Workflow projection port. Its existing
      // GenerationResultCommit projection remains the owner of that path.
      projection = committed.projectionState === "applied"
        ? "project-canonical"
        : committed.projectionState === "conflict"
          ? "preserve-original"
          : "projection-failed";
    }
    if (projection === "projection-failed") {
      throw new Error("原结果回填暂未完成，采用事务已撤销；原素材仍保留");
    }
    database.exec("COMMIT");
    flushDeferredCanvasObservability(database);
    return Object.freeze({
      mode: "apply",
      changed: adopted.changed,
      idempotent: !adopted.changed,
      adoptionReceiptId: adopted.id,
      receiptDigest: adopted.receiptDigest,
      canonicalAssetId: selected.canonicalAssetId,
      projection,
      state: "success",
      providerPostCount: 0,
    });
  } catch (error) {
    rollback(database);
    throw error;
  }
}

/**
 * Run the complete local adoption application under the existing save owner.
 * The callback has no Provider client and the transaction contains the receipt,
 * Media canonical-slot CAS, task settlement, and Workflow projection.
 */
export async function applyGenerationResultAdoption(
  input: GenerationResultAdoptionApplicationInput,
  workflow: GenerationResultAdoptionWorkflowPort,
): Promise<GenerationResultAdoptionApplicationResult | undefined> {
  assertIdentifier(input.ownerId, "owner id");
  assertIdentifier(input.taskId, "task id");
  assertAttempt(input.executionAttempt);
  assertHash(input.incidentDigest, "incident digest");
  assertIdentifier(input.canonicalAttemptId, "canonical attempt id");
  assertIdentifier(input.aliasAttemptId, "alias attempt id");
  if (!supportedKinds.has(input.kind) || !["dry-run", "apply"].includes(input.mode)) {
    invalid("adoption application command is invalid");
  }
  const result = await withGenerationResultSave(
    {
      ownerId: input.ownerId,
      taskId: input.taskId,
      executionAttempt: input.executionAttempt,
      kind: input.kind,
    },
    async (saveToken) => {
      const physicalVerification = await readAndVerifyPhysicalAdoptionEvidence(
        input,
        saveToken,
      );
      const database = openAppDatabase();
      try {
        assertGenerationSaveToken(saveToken);
        return executeAdoptionTransaction(
          database,
          input,
          saveToken,
          workflow,
          physicalVerification,
        );
      } finally {
        database.close();
      }
    },
    { nonBlocking: false, phase: "adoption" },
  );
  return result;
}
