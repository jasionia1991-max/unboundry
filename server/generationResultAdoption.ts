import type { DatabaseSync } from "node:sqlite";
import {
  assertCanvasBinding,
  assertGenerationPublicationAliasesInTransaction,
  assertMediaLedger,
  GenerationResultAdoptionError,
  generationResultAdoptionSha256,
  parseStoredReceipt,
  taskAndProviderEvidence,
  type GenerationResultAdoptionCanvasBinding,
  type GenerationResultAdoptionErrorCode,
  type GenerationResultAdoptionMediaLedger,
  type GenerationResultAdoptionMediaSlotPromotionInput,
  type GenerationResultAdoptionReceipt,
  type GenerationResultAdoptionValidationContext,
} from "./generationResultAdoptionQueries";

/**
 * Applies the narrow A/B/C original-result adoption fact.  This command owns
 * only the generation adoption table.  Media slot promotion and Canvas
 * projection are returned as typed transaction commands for their owners;
 * this function never submits a Provider request and never writes media or
 * Canvas rows.
 */

export type GenerationResultAdoptionCommandInput = Readonly<{
  ownerId: string;
  taskId: string;
  executionAttempt: number;
  kind: "audio" | "image" | "video";
  incidentDigest: string;
  canvas: GenerationResultAdoptionCanvasBinding;
  media: GenerationResultAdoptionMediaLedger;
  canonicalAttemptId: string;
  canonicalAssetId: string;
  aliasAttemptId: string;
  aliasAssetId: string;
  /** This must be an explicit zero proof; omission is not accepted. */
  providerPostCount: 0;
  runId?: string | null;
  receiptId?: string;
  now?: string | Date;
}>;

export type GenerationResultAdoptionResult = Readonly<{
  changed: boolean;
  id: string;
  receipt: GenerationResultAdoptionReceipt;
  receiptDigest: string;
  projection: "preserve-original" | "project-canonical";
  mediaSlotPromotion: GenerationResultAdoptionMediaSlotPromotionInput;
}>;

export type { GenerationResultAdoptionErrorCode } from "./generationResultAdoptionQueries";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const identifierPattern = /^[A-Za-z0-9._:@/-]{1,256}$/;
const hashPattern = /^[a-f0-9]{64}$/;

function fail(code: GenerationResultAdoptionErrorCode, message: string): never {
  throw new GenerationResultAdoptionError(code, message);
}

function assertIdentifier(value: unknown, label: string) {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    fail("ADOPTION_INVALID_COMMAND", `${label} is invalid`);
  }
  return value;
}

function assertHash(value: unknown, label: string) {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    fail("ADOPTION_INVALID_COMMAND", `${label} is invalid`);
  }
  return value;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

function timestamp(value: string | Date | undefined) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) fail("ADOPTION_INVALID_COMMAND", "time is invalid");
    return value.toISOString();
  }
  if (value !== undefined) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || value.length < 20 || value.length > 40) {
      fail("ADOPTION_INVALID_COMMAND", "time is invalid");
    }
    return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function runIdFromTask(task: Readonly<{ model_configuration: string }>) {
  try {
    const configuration = JSON.parse(task.model_configuration) as unknown;
    if (!isRecord(configuration) || !isRecord(configuration.workflowBinding) ||
        typeof configuration.workflowBinding.runId !== "string") return null;
    return identifierPattern.test(configuration.workflowBinding.runId)
      ? configuration.workflowBinding.runId
      : null;
  } catch {
    return null;
  }
}

function bindingDigest(canvas: GenerationResultAdoptionCanvasBinding) {
  return generationResultAdoptionSha256({
    canvasId: canvas.canvasId,
    nodeId: canvas.nodeId,
    graphRevision: canvas.graphRevision,
    inputFingerprint: canvas.inputFingerprint,
    currentAssetId: canvas.currentAssetId ?? null,
  });
}

function receiptPublications(
  media: ReturnType<typeof assertMediaLedger>,
): GenerationResultAdoptionReceipt["media"]["publications"] {
  return Object.freeze(media.publications.map((publication) => Object.freeze({
    attemptId: publication.attemptId,
    assetId: publication.assetId,
    role: publication.role,
    state: publication.state,
    outputSlot: publication.role === "canonical" ? 0 : publication.outputSlot,
    outputSetCount: publication.role === "canonical" ? 1 : publication.outputSetCount,
    byteSize: publication.byteSize,
    checksumSha256: publication.checksumSha256,
    contentType: publication.contentType,
    storageBackend: publication.storageBackend,
    storageProfileId: publication.storageProfileId,
    objectKey: publication.objectKey,
    errorCode: publication.errorCode,
  })));
}

function buildReceipt(
  database: DatabaseSync,
  input: GenerationResultAdoptionCommandInput,
  createdAt: string,
): GenerationResultAdoptionReceipt {
  assertIdentifier(input.ownerId, "owner id");
  assertIdentifier(input.taskId, "task id");
  if (!Number.isSafeInteger(input.executionAttempt) || input.executionAttempt < 1) {
    fail("ADOPTION_INVALID_COMMAND", "execution attempt is invalid");
  }
  assertHash(input.incidentDigest, "incident digest");
  assertIdentifier(input.canonicalAttemptId, "canonical attempt id");
  assertIdentifier(input.aliasAttemptId, "alias attempt id");
  assertIdentifier(input.canonicalAssetId, "canonical asset id");
  assertIdentifier(input.aliasAssetId, "alias asset id");
  if (input.providerPostCount !== 0) {
    fail("ADOPTION_INVALID_COMMAND", "a new Provider post is not allowed");
  }
  if (input.receiptId !== undefined) assertIdentifier(input.receiptId, "adoption receipt id");
  const evidence = taskAndProviderEvidence(database, input);
  const canvas = assertCanvasBinding(input, evidence.task);
  const media = assertMediaLedger(input);
  const projection = canvas.bindingUnchanged === false
    ? "preserve-original"
    : "project-canonical";
  const runId = input.runId === undefined ? runIdFromTask(evidence.task) : input.runId;
  if (runId !== null && runId !== undefined) assertIdentifier(runId, "run id");
  const payload = {
    version: 1 as const,
    incidentDigest: input.incidentDigest,
    taskId: input.taskId,
    ownerId: input.ownerId,
    executionAttempt: input.executionAttempt,
    canvasId: canvas.canvasId,
    nodeId: canvas.nodeId,
    runId: runId ?? null,
    inputFingerprint: evidence.task.request_fingerprint,
    provider: {
      attemptId: evidence.provider.id,
      taskId: evidence.task.id,
      providerTaskId: evidence.task.provider_task_id!,
      profileId: evidence.task.provider_profile_id!,
      modelId: evidence.task.provider_model_id!,
      credentialRevision: evidence.task.credential_revision,
      evidence: "provider-boundary" as const,
      outcome: "response-received" as const,
      failureCode: null,
      providerPostCount: 0 as const,
      noNewProviderPost: true as const,
      billingState: "original-attempt-only" as const,
    },
    originalError: {
      eventId: evidence.event.id,
      code: "PROVIDER_RESULT_FORMAT" as const,
      eventDigest: evidence.eventDigest,
    },
    expectedOutputCount: 1 as const,
    media: {
      kind: input.kind,
      canonicalAssetId: media.canonical.assetId,
      aliasAssetId: media.alias.assetId,
      ledgerDigest: media.ledgerDigest,
      publications: receiptPublications(media),
    },
    canvas: {
      graphRevision: canvas.graphRevision,
      inputFingerprint: canvas.inputFingerprint,
      bindingDigest: bindingDigest(canvas),
      projection,
    },
    createdAt,
  };
  const receiptDigest = generationResultAdoptionSha256(payload);
  return Object.freeze({ ...payload, receiptDigest }) as GenerationResultAdoptionReceipt;
}

function sameEvidenceIgnoringCanvasAndTime(
  left: GenerationResultAdoptionReceipt,
  right: GenerationResultAdoptionReceipt,
) {
  const comparable = (receipt: GenerationResultAdoptionReceipt) => {
    const { receiptDigest: _digest, createdAt: _createdAt, canvas: _canvas, ...rest } = receipt;
    return rest;
  };
  return generationResultAdoptionSha256(comparable(left)) ===
    generationResultAdoptionSha256(comparable(right));
}

function existingReceipt(
  database: DatabaseSync,
  input: GenerationResultAdoptionCommandInput,
) {
  const row = database.prepare(`
    SELECT id, owner_id, task_id, execution_attempt, incident_digest,
      receipt_version, receipt_json, created_at
    FROM generation_result_adoptions
    WHERE owner_id = ? AND task_id = ? AND execution_attempt = ?
      AND incident_digest = ?
    LIMIT 1
  `).get(input.ownerId, input.taskId, input.executionAttempt, input.incidentDigest) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  const receipt = parseStoredReceipt(row.receipt_json);
  if (row.owner_id !== input.ownerId || row.task_id !== input.taskId ||
      Number(row.execution_attempt) !== input.executionAttempt ||
      row.incident_digest !== input.incidentDigest) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "stored adoption identity mismatch");
  }
  return {
    id: assertIdentifier(row.id, "adoption receipt id"),
    receipt,
  } as const;
}

function insertReceipt(
  database: DatabaseSync,
  input: GenerationResultAdoptionCommandInput,
  receipt: GenerationResultAdoptionReceipt,
) {
  const id = input.receiptId ?? `adoption-${input.incidentDigest}`;
  assertIdentifier(id, "adoption receipt id");
  try {
    database.prepare(`
      INSERT INTO generation_result_adoptions (
        id, owner_id, task_id, execution_attempt, incident_digest,
        receipt_version, receipt_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      input.ownerId,
      input.taskId,
      input.executionAttempt,
      input.incidentDigest,
      stableJson(receipt),
      receipt.createdAt,
    );
    return { changed: true, id } as const;
  } catch (error) {
    // A concurrent retry may win the unique incident key.  Only an exact
    // same-evidence row is idempotent; a different receipt is a CAS conflict.
    const prior = existingReceipt(database, input);
    if (!prior || !sameEvidenceIgnoringCanvasAndTime(prior.receipt, receipt)) {
      fail("ADOPTION_CAS_CONFLICT", "adoption receipt already exists with different evidence");
    }
    return { changed: false, id: prior.id, receipt: prior.receipt } as const;
  }
}

/**
 * Insert or reuse the durable receipt.  Callers must keep the surrounding
 * transaction open and then execute the Media slot promotion command using
 * the returned `mediaSlotPromotion` input before committing the output set.
 */
export function adoptGenerationResultInTransaction(
  database: DatabaseSync,
  input: GenerationResultAdoptionCommandInput,
): GenerationResultAdoptionResult {
  const createdAt = timestamp(input.now);
  const receipt = buildReceipt(database, input, createdAt);
  const prior = existingReceipt(database, input);
  if (prior) {
    if (!sameEvidenceIgnoringCanvasAndTime(prior.receipt, receipt)) {
      fail("ADOPTION_CAS_CONFLICT", "adoption receipt evidence changed");
    }
    // A changed graph/current node is deliberately represented by the
    // caller's Canvas binding port.  The stored receipt remains an immutable
    // fact about the original result, while settlement returns preserve.
    assertGenerationPublicationAliasesInTransaction(database, input);
    const projection = input.canvas.bindingUnchanged === false
      ? "preserve-original"
      : prior.receipt.canvas.projection;
    return Object.freeze({
      changed: false,
      id: prior.id,
      receipt: prior.receipt,
      receiptDigest: prior.receipt.receiptDigest,
      projection,
      mediaSlotPromotion: Object.freeze({
        ownerId: input.ownerId,
        taskId: input.taskId,
        executionAttempt: input.executionAttempt,
        kind: input.kind,
        adoptionReceiptId: prior.id,
        canonicalAttemptId: input.canonicalAttemptId,
        canonicalAssetId: input.canonicalAssetId,
        aliasAttemptId: input.aliasAttemptId,
        aliasAssetId: input.aliasAssetId,
        outputSetCount: 1,
      }),
    });
  }
  const inserted = insertReceipt(database, input, receipt);
  const stored = inserted.changed ? receipt : inserted.receipt;
  // This assertion is intentionally after the receipt insert: a legacy null
  // publication becomes readable only within the same protected transaction
  // that records its complete adoption evidence.
  assertGenerationPublicationAliasesInTransaction(database, input);
  const projection = input.canvas.bindingUnchanged === false
    ? "preserve-original"
    : stored.canvas.projection;
  return Object.freeze({
    changed: inserted.changed,
    id: inserted.id,
    receipt: stored,
    receiptDigest: stored.receiptDigest,
    projection,
    mediaSlotPromotion: Object.freeze({
      ownerId: input.ownerId,
      taskId: input.taskId,
      executionAttempt: input.executionAttempt,
      kind: input.kind,
      adoptionReceiptId: inserted.id,
      canonicalAttemptId: input.canonicalAttemptId,
      canonicalAssetId: input.canonicalAssetId,
      aliasAttemptId: input.aliasAttemptId,
      aliasAssetId: input.aliasAssetId,
      outputSetCount: 1,
    }),
  });
}

export default adoptGenerationResultInTransaction;
