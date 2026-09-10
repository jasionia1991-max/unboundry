import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { readGenerationPublicationSlotsCommand } from "./mediaTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";

/**
 * Narrow, local-only adoption contract for the one known A/B/C incident.
 *
 * This module deliberately does not read or write media or Canvas tables
 * directly.  Media evidence comes from `readGenerationPublicationSlotsCommand`
 * and a caller supplies the Canvas binding snapshot from the Canvas command.
 * The only table this module owns is `generation_result_adoptions`.
 */

export type GenerationResultAdoptionKind = "audio" | "image" | "video";
export type GenerationResultAdoptionProjection =
  | "preserve-original"
  | "project-canonical";

export type GenerationResultAdoptionErrorCode =
  | "ADOPTION_INVALID_COMMAND"
  | "ADOPTION_NOT_FOUND"
  | "ADOPTION_RECEIPT_CORRUPT"
  | "ADOPTION_EVIDENCE_MISMATCH"
  | "ADOPTION_UNSAFE_STATE"
  | "ADOPTION_CAS_CONFLICT"
  | "ADOPTION_ALREADY_APPLIED";

export class GenerationResultAdoptionError extends Error {
  readonly code: GenerationResultAdoptionErrorCode;

  constructor(code: GenerationResultAdoptionErrorCode, message: string) {
    super(message);
    this.name = "GenerationResultAdoptionError";
    this.code = code;
  }
}

function fail(
  code: GenerationResultAdoptionErrorCode,
  message: string,
): never {
  throw new GenerationResultAdoptionError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const identifierPattern = /^[A-Za-z0-9._:@/-]{1,256}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const requestFingerprintPattern = /^(?:intent-v3:)?[a-f0-9]{64}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T/;
const mediaKinds: readonly GenerationResultAdoptionKind[] = [
  "audio", "image", "video",
];
const retainedPublicationStates = new Set([
  "reserved", "staged", "external-ready", "compensating", "published",
]);
const adoptionFailureCodes = new Set([
  "MEDIA_RECOVERY_EVIDENCE_MISSING",
  "MEDIA_PUBLICATION_FAILED",
]);

export type GenerationResultAdoptionAssetEvidence = Readonly<{
  id: string;
  ownerId: string;
  kind: GenerationResultAdoptionKind;
  storageStatus: string;
  byteSize: number;
  checksumSha256: string | null;
  contentType: string;
  storageBackend: "local" | "oss";
  storageProfileId: string | null;
  objectKey: string;
}>;

export type GenerationResultAdoptionPublicationRole =
  | "alias"
  | "canonical"
  | "failed";

export type GenerationResultAdoptionPublicationEvidence = Readonly<{
  attemptId: string;
  ownerId: string;
  kind: GenerationResultAdoptionKind;
  taskId: string;
  executionAttempt: number;
  assetId: string;
  role: GenerationResultAdoptionPublicationRole;
  source: "generation";
  state: "failed" | "published";
  outputSlot: number | null;
  outputSetCount: number | null;
  byteSize: number;
  checksumSha256: string | null;
  contentType: string;
  storageBackend: "local" | "oss";
  storageProfileId: string | null;
  objectKey: string;
  mediaStorageStatus: string | null;
  deletionState: string | null;
  errorCode: string | null;
}>;

export type GenerationResultAdoptionMediaLedger = Readonly<{
  publications: readonly GenerationResultAdoptionPublicationEvidence[];
  assets?: readonly GenerationResultAdoptionAssetEvidence[];
}>;

/**
 * The result-set mutation is owned by Media.  The generation adoption command
 * returns this exact input to the Media transaction command; it never updates
 * `media_publication_attempts` itself.
 */
export type GenerationResultAdoptionMediaSlotPromotionInput = Readonly<{
  ownerId: string;
  taskId: string;
  executionAttempt: number;
  kind: GenerationResultAdoptionKind;
  adoptionReceiptId: string;
  canonicalAttemptId: string;
  canonicalAssetId: string;
  aliasAttemptId: string;
  aliasAssetId: string;
  outputSetCount: 1;
}>;

export type GenerationResultAdoptionCanvasBinding = Readonly<{
  canvasId: string;
  nodeId: string;
  graphRevision: number;
  inputFingerprint: string;
  /** The node's current server-owned asset, if one is present. */
  currentAssetId?: string | null;
  /** A Canvas command may know this without reconstructing the node here. */
  bindingUnchanged?: boolean;
}>;

export type GenerationResultAdoptionProviderEvidence = Readonly<{
  providerPostCount: 0;
}>;

export type GenerationResultAdoptionReceiptPublication = Readonly<{
  attemptId: string;
  assetId: string;
  role: GenerationResultAdoptionPublicationRole;
  state: "failed" | "published";
  outputSlot: number | null;
  outputSetCount: number | null;
  byteSize: number;
  checksumSha256: string | null;
  contentType: string;
  storageBackend: "local" | "oss";
  storageProfileId: string | null;
  objectKey: string;
  errorCode: string | null;
}>;

export type GenerationResultAdoptionReceipt = Readonly<{
  version: 1;
  receiptDigest: string;
  incidentDigest: string;
  taskId: string;
  ownerId: string;
  executionAttempt: number;
  canvasId: string;
  nodeId: string;
  runId: string | null;
  inputFingerprint: string;
  provider: Readonly<{
    attemptId: number;
    taskId: string;
    providerTaskId: string;
    profileId: string;
    modelId: string;
    credentialRevision: number;
    evidence: "provider-boundary";
    outcome: "response-received";
    failureCode: null;
    providerPostCount: 0;
    noNewProviderPost: true;
    billingState: "original-attempt-only";
  }>;
  originalError: Readonly<{
    eventId: number;
    code: "PROVIDER_RESULT_FORMAT";
    eventDigest: string;
  }>;
  expectedOutputCount: 1;
  media: Readonly<{
    kind: GenerationResultAdoptionKind;
    canonicalAssetId: string;
    aliasAssetId: string;
    ledgerDigest: string;
    publications: readonly GenerationResultAdoptionReceiptPublication[];
  }>;
  canvas: Readonly<{
    graphRevision: number;
    inputFingerprint: string;
    bindingDigest: string;
    projection: GenerationResultAdoptionProjection;
  }>;
  createdAt: string;
}>;

export type GenerationResultAdoptionRead = Readonly<{
  id: string;
  taskId: string;
  ownerId: string;
  executionAttempt: number;
  canvasId: string;
  nodeId: string;
  runId: string | null;
  canonicalAssetId: string;
  receiptDigest: string;
}>;

export type GenerationResultAdoptionSettlementVerification = Readonly<{
  allowed: true;
  receipt: GenerationResultAdoptionReceipt;
  projection: GenerationResultAdoptionProjection;
  mediaSlotPromotion: GenerationResultAdoptionMediaSlotPromotionInput;
}>;

/**
 * The generation settlement command intentionally has a much smaller input
 * surface than the adoption command.  It is called after the durable receipt
 * was created, so it must rebuild all of the evidence from that receipt and
 * the current Media projection rather than treating the receipt id as a
 * capability token.
 */
export type GenerationResultAdoptionSettlementInput = Readonly<{
  assetIds: readonly string[];
  executionAttempt: number;
  kind: GenerationResultAdoptionKind;
  ownerId: string;
  taskId: string;
  adoptionReceiptId: string;
}>;

export type GenerationResultAdoptionReplayInput = Readonly<{
  executionAttempt: number;
  kind: GenerationResultAdoptionKind;
  ownerId: string;
  taskId: string;
  adoptionReceiptId: string;
}>;

export type GenerationResultAdoptionTaskRow = Readonly<{
  id: string;
  owner_id: string | null;
  canvas_id: string;
  node_id: string;
  kind: string;
  state: string;
  attempt: number;
  error_code: string | null;
  request_fingerprint: string;
  provider_profile_id: string | null;
  provider_model_id: string | null;
  provider_task_id: string | null;
  credential_revision: number;
  result_asset_id: string | null;
  result_text: string | null;
  model_configuration: string;
}>;

type GenerationResultAdoptionProviderRow = Readonly<{
  id: number;
  task_id: string;
  execution_attempt: number;
  provider_profile_id: string;
  provider_model_id: string;
  kind: string;
  evidence: string;
  owner_id: string | null;
  credential_revision: number;
  outcome: string;
  provider_task_id: string | null;
  failure_code: string | null;
  finished_at: string | null;
}>;

type GenerationResultAdoptionErrorEvent = Readonly<{
  id: number;
  task_id: string;
  state: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}>;

export type GenerationResultAdoptionValidationContext = Readonly<{
  ownerId: string;
  taskId: string;
  executionAttempt: number;
  kind: GenerationResultAdoptionKind;
  incidentDigest: string;
  canvas: GenerationResultAdoptionCanvasBinding;
  media: GenerationResultAdoptionMediaLedger;
  canonicalAttemptId: string;
  canonicalAssetId: string;
  aliasAttemptId: string;
  aliasAssetId: string;
  runId?: string | null;
  providerPostCount: 0;
  now?: string | Date;
  receiptId?: string;
}>;

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

function assertRequestFingerprint(value: unknown) {
  if (typeof value !== "string" || !requestFingerprintPattern.test(value)) {
    fail("ADOPTION_INVALID_COMMAND", "request fingerprint is invalid");
  }
  return value;
}

function assertAttempt(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail("ADOPTION_INVALID_COMMAND", "execution attempt is invalid");
  }
  return Number(value);
}

function assertTimestamp(value: unknown, label: string) {
  if (typeof value !== "string" || value.length < 20 || value.length > 40 ||
      !timestampPattern.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("ADOPTION_INVALID_COMMAND", `${label} is invalid`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function nowIso(value: string | Date | undefined) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      fail("ADOPTION_INVALID_COMMAND", "time is invalid");
    }
    return value.toISOString();
  }
  if (value !== undefined) return assertTimestamp(value, "time");
  return new Date().toISOString();
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

export function generationResultAdoptionSha256(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function parseJson(value: unknown, label: string): unknown {
  if (typeof value !== "string" || value.length < 2 || value.length > 262_144) {
    fail("ADOPTION_RECEIPT_CORRUPT", `${label} is invalid`);
  }
  try {
    return JSON.parse(value);
  } catch {
    fail("ADOPTION_RECEIPT_CORRUPT", `${label} is not valid JSON`);
  }
}

function assertExactObjectKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])) {
    fail("ADOPTION_RECEIPT_CORRUPT", `${label} fields do not match contract`);
  }
}

function publicationFromRawRow(
  raw: Record<string, unknown>,
): GenerationResultAdoptionPublicationEvidence {
  const kind = raw.kind;
  const state = raw.state;
  const source = raw.source;
  const outputSlot = raw.output_slot === null || raw.output_slot === undefined
    ? null : Number(raw.output_slot);
  const outputSetCount = raw.output_set_count === null || raw.output_set_count === undefined
    ? null : Number(raw.output_set_count);
  return {
    attemptId: assertIdentifier(raw.attempt_id, "publication attempt id"),
    ownerId: assertIdentifier(raw.owner_id, "publication owner id"),
    kind: mediaKinds.includes(kind as GenerationResultAdoptionKind)
      ? kind as GenerationResultAdoptionKind
      : fail("ADOPTION_EVIDENCE_MISMATCH", "publication kind mismatch"),
    taskId: assertIdentifier(raw.task_id, "publication task id"),
    executionAttempt: assertAttempt(raw.task_execution_attempt),
    assetId: assertIdentifier(raw.asset_id, "publication asset id"),
    role: "failed",
    source: source === "generation"
      ? "generation"
      : fail("ADOPTION_EVIDENCE_MISMATCH", "publication source mismatch"),
    state: state === "failed" || state === "published"
      ? state
      : fail("ADOPTION_EVIDENCE_MISMATCH", "publication state is outside adoption scope"),
    outputSlot: outputSlot === null ? null :
      Number.isSafeInteger(outputSlot) && outputSlot >= 0 && outputSlot < 4
        ? outputSlot
        : fail("ADOPTION_EVIDENCE_MISMATCH", "publication output slot is invalid"),
    outputSetCount: outputSetCount === null ? null :
      Number.isSafeInteger(outputSetCount) && outputSetCount >= 1 && outputSetCount <= 4
        ? outputSetCount
        : fail("ADOPTION_EVIDENCE_MISMATCH", "publication output count is invalid"),
    byteSize: Number.isSafeInteger(Number(raw.byte_size)) && Number(raw.byte_size) >= 0
      ? Number(raw.byte_size)
      : fail("ADOPTION_EVIDENCE_MISMATCH", "publication size is invalid"),
    checksumSha256: raw.checksum_sha256 === null || raw.checksum_sha256 === undefined
      ? null : assertHash(raw.checksum_sha256, "publication checksum"),
    contentType: typeof raw.content_type === "string" &&
      /^[A-Za-z0-9.+/_-]{1,160}$/.test(raw.content_type)
      ? raw.content_type
      : fail("ADOPTION_EVIDENCE_MISMATCH", "publication content type is invalid"),
    storageBackend: raw.storage_backend === "local" || raw.storage_backend === "oss"
      ? raw.storage_backend
      : fail("ADOPTION_EVIDENCE_MISMATCH", "publication storage backend is invalid"),
    storageProfileId: raw.storage_profile_id === null || raw.storage_profile_id === undefined
      ? null : assertIdentifier(raw.storage_profile_id, "publication storage profile"),
    objectKey: typeof raw.object_key === "string" &&
      /^[A-Za-z0-9._/@:-]{1,512}$/.test(raw.object_key)
      ? raw.object_key
      : fail("ADOPTION_EVIDENCE_MISMATCH", "publication object key is invalid"),
    mediaStorageStatus: raw.media_storage_status === null || raw.media_storage_status === undefined
      ? null : String(raw.media_storage_status),
    deletionState: raw.deletion_state === null || raw.deletion_state === undefined
      ? null : String(raw.deletion_state),
    errorCode: raw.error_code === null || raw.error_code === undefined
      ? null : String(raw.error_code),
  };
}

/**
 * Convert the Media transaction command's bounded raw rows into the typed
 * adoption input.  Role assignment is supplied by the caller after an
 * operator/incident evidence check; this helper never chooses a canonical
 * result from ordering or hash equality.
 */
export function generationResultAdoptionMediaLedgerFromRows(
  rows: readonly Record<string, unknown>[],
  roles: Readonly<Record<string, GenerationResultAdoptionPublicationRole>>,
): GenerationResultAdoptionMediaLedger {
  const publications = rows.map((row) => {
    const publication = publicationFromRawRow(row);
    const role = roles[publication.attemptId];
    if (!role) fail("ADOPTION_INVALID_COMMAND", "publication role is missing");
    return Object.freeze({ ...publication, role });
  });
  const assets = rows.flatMap((row) => {
    const id = row.asset_id;
    if (typeof id !== "string") return [];
    const storageStatus = row.media_storage_status;
    if (typeof storageStatus !== "string") return [];
    const asset = {
      id: assertIdentifier(id, "asset id"),
      ownerId: assertIdentifier(row.owner_id, "asset owner id"),
      kind: mediaKinds.includes(row.kind as GenerationResultAdoptionKind)
        ? row.kind as GenerationResultAdoptionKind
        : fail("ADOPTION_EVIDENCE_MISMATCH", "asset kind mismatch"),
      storageStatus,
      byteSize: Number(row.asset_byte_size),
      checksumSha256: row.asset_checksum_sha256 === null || row.asset_checksum_sha256 === undefined
        ? null : assertHash(row.asset_checksum_sha256, "asset checksum"),
      contentType: typeof row.asset_content_type === "string" ? row.asset_content_type :
        fail("ADOPTION_EVIDENCE_MISMATCH", "asset content type is invalid"),
      storageBackend: row.asset_storage_backend === "local" || row.asset_storage_backend === "oss"
        ? row.asset_storage_backend : fail("ADOPTION_EVIDENCE_MISMATCH", "asset backend is invalid"),
      storageProfileId: row.asset_storage_profile_id === null
        ? null : assertIdentifier(row.asset_storage_profile_id, "asset storage profile"),
      objectKey: typeof row.asset_object_key === "string" ? row.asset_object_key :
        fail("ADOPTION_EVIDENCE_MISMATCH", "asset object key is invalid"),
    } satisfies GenerationResultAdoptionAssetEvidence;
    return [asset];
  });
  const dedupedAssets = [...new Map(assets.map((asset) => [
    `${asset.kind}:${asset.id}`, asset,
  ])).values()];
  return Object.freeze({
    publications: Object.freeze(publications),
    assets: Object.freeze(dedupedAssets),
  });
}

function publicationEvidenceFromTypedRow(
  value: GenerationResultAdoptionPublicationEvidence,
): GenerationResultAdoptionPublicationEvidence {
  const row = publicationFromRawRow({
    attempt_id: value.attemptId,
    owner_id: value.ownerId,
    kind: value.kind,
    task_id: value.taskId,
    task_execution_attempt: value.executionAttempt,
    asset_id: value.assetId,
    source: value.source,
    state: value.state,
    output_slot: value.outputSlot,
    output_set_count: value.outputSetCount,
    byte_size: value.byteSize,
    checksum_sha256: value.checksumSha256,
    content_type: value.contentType,
    storage_backend: value.storageBackend,
    storage_profile_id: value.storageProfileId,
    object_key: value.objectKey,
    media_storage_status: value.mediaStorageStatus,
    deletion_state: value.deletionState,
    error_code: value.errorCode,
  });
  return { ...row, role: value.role };
}

function publicationComparable(
  publication: GenerationResultAdoptionPublicationEvidence,
) {
  return {
    attemptId: publication.attemptId,
    ownerId: publication.ownerId,
    kind: publication.kind,
    taskId: publication.taskId,
    executionAttempt: publication.executionAttempt,
    assetId: publication.assetId,
    role: publication.role,
    source: publication.source,
    state: publication.state,
    outputSlot: publication.outputSlot,
    outputSetCount: publication.outputSetCount,
    byteSize: publication.byteSize,
    checksumSha256: publication.checksumSha256,
    contentType: publication.contentType,
    storageBackend: publication.storageBackend,
    storageProfileId: publication.storageProfileId,
    objectKey: publication.objectKey,
    mediaStorageStatus: publication.mediaStorageStatus,
    deletionState: publication.deletionState,
    errorCode: publication.errorCode,
  };
}

function receiptPublicationComparable(
  publication: GenerationResultAdoptionReceiptPublication,
  actual?: GenerationResultAdoptionPublicationEvidence,
) {
  return {
    attemptId: publication.attemptId,
    assetId: publication.assetId,
    role: publication.role,
    state: publication.state,
    outputSlot: publication.outputSlot,
    outputSetCount: publication.outputSetCount,
    byteSize: publication.byteSize,
    checksumSha256: publication.checksumSha256,
    contentType: publication.contentType,
    storageBackend: publication.storageBackend,
    storageProfileId: publication.storageProfileId,
    objectKey: publication.objectKey,
    ...(actual ? {
      ownerId: actual.ownerId,
      kind: actual.kind,
      taskId: actual.taskId,
      executionAttempt: actual.executionAttempt,
      source: actual.source,
      mediaStorageStatus: actual.mediaStorageStatus,
      deletionState: actual.deletionState,
      errorCode: actual.errorCode,
    } : {}),
  };
}

function publicationForAdoptionReceipt(
  publication: GenerationResultAdoptionPublicationEvidence,
) {
  // The canonical row is recorded as slot 0 in the receipt even while the
  // legacy row is still null.  That makes the receipt digest stable across the
  // receipt -> Media CAS promotion boundary.  The alias remains explicitly
  // unassigned and is never silently promoted.
  if (publication.role === "canonical") {
    return { ...publication, outputSlot: 0, outputSetCount: 1 };
  }
  return publication;
}

function assertMediaLedger(
  input: GenerationResultAdoptionValidationContext,
) {
  // Slot promotion changes SQL ordering, not the historical ledger identity.
  // Hash the same A/B/C rows in a stable identity order before and after CAS.
  const publications = input.media.publications.map(publicationEvidenceFromTypedRow)
    .sort((left, right) => left.attemptId.localeCompare(right.attemptId));
  if (publications.length !== 3) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "the adoption scope requires exactly A/B/C publications");
  }
  const identities = new Set(publications.map((row) => row.attemptId));
  if (identities.size !== publications.length) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "publication attempt ids are duplicated");
  }
  if (publications.some((row) => row.ownerId !== input.ownerId ||
      row.taskId !== input.taskId || row.executionAttempt !== input.executionAttempt ||
      row.kind !== input.kind || row.source !== "generation")) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "publication identity does not match task");
  }
  const failed = publications.filter((row) => row.state === "failed");
  const published = publications.filter((row) => row.state === "published");
  if (failed.length !== 1 || published.length !== 2) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "publication set is not one failed plus two published");
  }
  const failedRow = failed[0];
  if (failedRow.role !== "failed" || !failedRow.errorCode ||
      !adoptionFailureCodes.has(failedRow.errorCode)) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "failed publication is outside the known incident scope");
  }
  if (failedRow.outputSlot !== null || failedRow.outputSetCount !== null ||
      failedRow.deletionState !== null || failedRow.byteSize !== 0 ||
      failedRow.checksumSha256 !== null ||
      failedRow.mediaStorageStatus !== null && failedRow.mediaStorageStatus !== "failed") {
    fail("ADOPTION_EVIDENCE_MISMATCH", "failed publication has a slot or deletion intent");
  }
  const canonical = publications.find((row) => row.attemptId === input.canonicalAttemptId);
  const alias = publications.find((row) => row.attemptId === input.aliasAttemptId);
  if (!canonical || !alias || canonical === alias ||
      canonical.role !== "canonical" || alias.role !== "alias" ||
      canonical.assetId !== input.canonicalAssetId || alias.assetId !== input.aliasAssetId ||
      canonical.state !== "published" || alias.state !== "published") {
    fail("ADOPTION_EVIDENCE_MISMATCH", "canonical/alias publication identity is invalid");
  }
  if (canonical.assetId === alias.assetId || canonical.attemptId === alias.attemptId) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "canonical and alias must be distinct ledger rows");
  }
  for (const row of [canonical, alias]) {
    const conflictingSlot = row === canonical
      ? row.outputSetCount !== null && row.outputSetCount !== 1 ||
        row.outputSlot !== null && row.outputSlot !== 0
      : row.outputSetCount !== null || row.outputSlot !== null;
    if (row.deletionState !== null || row.mediaStorageStatus !== "ready" ||
        !row.checksumSha256 || conflictingSlot) {
      fail("ADOPTION_UNSAFE_STATE", "published adoption candidate is not ready or has a conflicting slot");
    }
  }
  if (canonical.byteSize !== alias.byteSize ||
      canonical.checksumSha256 !== alias.checksumSha256 ||
      canonical.contentType !== alias.contentType ||
      canonical.storageBackend !== alias.storageBackend ||
      canonical.storageProfileId !== alias.storageProfileId) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "published candidates are not same-origin bytes");
  }
  const assets = input.media.assets ?? [];
  if (assets.length > 0) {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    for (const publication of publications) {
      const asset = byId.get(publication.assetId);
      // The abandoned zero-byte reservation may already have been compensated.
      // Its failed journal must remain, while B/C must still have real ready assets.
      if (!asset && publication.state === "failed" && publication.byteSize === 0 &&
          publication.mediaStorageStatus === null) continue;
      if (!asset || asset.ownerId !== input.ownerId || asset.kind !== input.kind ||
          asset.byteSize !== publication.byteSize ||
          asset.checksumSha256 !== publication.checksumSha256 ||
          asset.contentType !== publication.contentType ||
          asset.storageBackend !== publication.storageBackend ||
          asset.storageProfileId !== publication.storageProfileId ||
          asset.objectKey !== publication.objectKey) {
        fail("ADOPTION_EVIDENCE_MISMATCH", "publication and asset ledgers differ");
      }
      if (publication.state === "published" && asset.storageStatus !== "ready") {
        fail("ADOPTION_UNSAFE_STATE", "published asset is not ready");
      }
    }
  }
  return Object.freeze({
    publications: Object.freeze(publications),
    canonical,
    alias,
    failed: failedRow,
    ledgerDigest: generationResultAdoptionSha256(
      publications.map((publication) => publicationComparable(
        publicationForAdoptionReceipt(publication),
      )),
    ),
  });
}

function assertCanvasBinding(
  input: GenerationResultAdoptionValidationContext,
  task: GenerationResultAdoptionTaskRow,
) {
  const canvas = input.canvas;
  if (canvas.canvasId !== task.canvas_id || canvas.nodeId !== task.node_id ||
      canvas.inputFingerprint !== task.request_fingerprint ||
      !Number.isSafeInteger(canvas.graphRevision) || canvas.graphRevision < 0) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "Canvas binding does not match the original task");
  }
  assertIdentifier(canvas.canvasId, "canvas id");
  assertIdentifier(canvas.nodeId, "node id");
  assertRequestFingerprint(canvas.inputFingerprint);
  return canvas;
}

function taskRowInTransaction(
  database: DatabaseSync,
  input: Pick<GenerationResultAdoptionValidationContext, "ownerId" | "taskId" | "executionAttempt">,
) {
  return database.prepare(`
    SELECT id, owner_id, canvas_id, node_id, kind, state, attempt,
      error_code, request_fingerprint, provider_profile_id, provider_model_id,
      provider_task_id, credential_revision, result_asset_id, result_text,
      model_configuration
    FROM generation_tasks WHERE id = ?
  `).get(input.taskId) as GenerationResultAdoptionTaskRow | undefined;
}

function providerRowsInTransaction(database: DatabaseSync, taskId: string) {
  return database.prepare(`
    SELECT id, task_id, execution_attempt, provider_profile_id,
      provider_model_id, kind, evidence, owner_id, credential_revision,
      outcome, provider_task_id, failure_code, finished_at
    FROM generation_provider_attempts
    WHERE task_id = ? ORDER BY execution_attempt, id
  `).all(taskId) as GenerationResultAdoptionProviderRow[];
}

function errorEventInTransaction(
  database: DatabaseSync,
  taskId: string,
): GenerationResultAdoptionErrorEvent | undefined {
  return database.prepare(`
    SELECT id, task_id, state, error_code, error_message, created_at
    FROM generation_task_events
    WHERE task_id = ? AND error_code = 'PROVIDER_RESULT_FORMAT'
    ORDER BY id DESC LIMIT 1
  `).get(taskId) as GenerationResultAdoptionErrorEvent | undefined;
}

function taskAndProviderEvidence(
  database: DatabaseSync,
  input: GenerationResultAdoptionValidationContext,
) {
  const task = taskRowInTransaction(database, input);
  if (!task || task.owner_id !== input.ownerId || task.kind !== input.kind ||
      task.attempt !== input.executionAttempt || task.state !== "failed" ||
      task.error_code !== "PROVIDER_RESULT_FORMAT" ||
      task.result_asset_id !== null || task.result_text !== null ||
      !task.provider_profile_id || !task.provider_model_id || !task.provider_task_id ||
      task.credential_revision < 0) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "task is not the exact failed format incident");
  }
  assertRequestFingerprint(task.request_fingerprint);
  const providers = providerRowsInTransaction(database, input.taskId);
  if (providers.length !== 1) {
    fail("ADOPTION_UNSAFE_STATE", "the task has more than one Provider attempt");
  }
  const provider = providers[0];
  if (provider.task_id !== task.id || provider.execution_attempt !== input.executionAttempt ||
      provider.owner_id !== input.ownerId || provider.kind !== input.kind ||
      provider.provider_profile_id !== task.provider_profile_id ||
      provider.provider_model_id !== task.provider_model_id ||
      provider.provider_task_id !== task.provider_task_id ||
      provider.credential_revision !== task.credential_revision ||
      provider.evidence !== "provider-boundary" ||
      provider.outcome !== "response-received" ||
      provider.failure_code !== null) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "Provider evidence is not the exact format failure");
  }
  const event = errorEventInTransaction(database, input.taskId);
  if (!event || event.task_id !== task.id || event.state !== "failed" ||
      event.error_code !== "PROVIDER_RESULT_FORMAT" || !event.error_message) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "the original format failure event is missing");
  }
  const eventDigest = generationResultAdoptionSha256({
    id: event.id,
    taskId: event.task_id,
    state: event.state,
    code: event.error_code,
    message: event.error_message,
    createdAt: event.created_at,
  });
  return Object.freeze({ task, provider, event, eventDigest });
}

function receiptPayloadWithoutDigest(receipt: GenerationResultAdoptionReceipt) {
  const { receiptDigest: _receiptDigest, ...payload } = receipt;
  return payload;
}

function assertReceiptDigest(receipt: GenerationResultAdoptionReceipt) {
  const expected = generationResultAdoptionSha256(
    receiptPayloadWithoutDigest(receipt),
  );
  if (receipt.receiptDigest !== expected) {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption receipt digest mismatch");
  }
  return receipt;
}

function parseStoredReceipt(value: unknown): GenerationResultAdoptionReceipt {
  const parsed = parseJson(value, "adoption receipt");
  if (!isRecord(parsed)) fail("ADOPTION_RECEIPT_CORRUPT", "adoption receipt is not an object");
  assertExactObjectKeys(parsed, [
    "canvas", "canvasId", "createdAt", "executionAttempt", "expectedOutputCount",
    "incidentDigest", "inputFingerprint", "media", "nodeId", "originalError",
    "ownerId", "provider", "receiptDigest", "runId", "taskId", "version",
  ], "adoption receipt");
  const receipt = parsed as unknown as GenerationResultAdoptionReceipt;
  if (receipt.version !== 1 || receipt.expectedOutputCount !== 1 ||
      typeof receipt.receiptDigest !== "string" || !hashPattern.test(receipt.receiptDigest) ||
      typeof receipt.incidentDigest !== "string" || !hashPattern.test(receipt.incidentDigest) ||
      typeof receipt.taskId !== "string" || typeof receipt.ownerId !== "string" ||
      !Number.isSafeInteger(receipt.executionAttempt) ||
      typeof receipt.canvasId !== "string" || typeof receipt.nodeId !== "string" ||
      (receipt.runId !== null && typeof receipt.runId !== "string") ||
      typeof receipt.inputFingerprint !== "string" ||
      typeof receipt.createdAt !== "string") {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption receipt identity is invalid");
  }
  assertIdentifier(receipt.taskId, "receipt task id");
  assertIdentifier(receipt.ownerId, "receipt owner id");
  assertAttempt(receipt.executionAttempt);
  assertIdentifier(receipt.canvasId, "receipt canvas id");
  assertIdentifier(receipt.nodeId, "receipt node id");
  if (receipt.runId !== null) assertIdentifier(receipt.runId, "receipt run id");
  assertRequestFingerprint(receipt.inputFingerprint);
  assertTimestamp(receipt.createdAt, "receipt created time");
  if (!isRecord(receipt.provider) || !isRecord(receipt.originalError) ||
      !isRecord(receipt.media) || !isRecord(receipt.canvas)) {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption receipt nested records are invalid");
  }
  assertExactObjectKeys(receipt.provider, [
    "attemptId", "billingState", "credentialRevision", "evidence", "failureCode",
    "modelId", "noNewProviderPost", "outcome", "profileId", "providerPostCount",
    "providerTaskId", "taskId",
  ], "adoption provider receipt");
  assertExactObjectKeys(receipt.originalError, [
    "code", "eventDigest", "eventId",
  ], "adoption original-error receipt");
  assertExactObjectKeys(receipt.media, [
    "aliasAssetId", "canonicalAssetId", "kind", "ledgerDigest", "publications",
  ], "adoption media receipt");
  assertExactObjectKeys(receipt.canvas, [
    "bindingDigest", "graphRevision", "inputFingerprint", "projection",
  ], "adoption Canvas receipt");
  const provider = receipt.provider;
  if (!Number.isSafeInteger(provider.attemptId) || provider.attemptId < 1 ||
      typeof provider.taskId !== "string" || typeof provider.providerTaskId !== "string" ||
      typeof provider.profileId !== "string" || typeof provider.modelId !== "string" ||
      !Number.isSafeInteger(provider.credentialRevision) || provider.credentialRevision < 0 ||
      provider.evidence !== "provider-boundary" || provider.outcome !== "response-received" ||
      provider.failureCode !== null || provider.providerPostCount !== 0 ||
      provider.noNewProviderPost !== true || provider.billingState !== "original-attempt-only") {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption Provider receipt is invalid");
  }
  assertIdentifier(provider.taskId, "provider receipt task id");
  assertIdentifier(provider.providerTaskId, "provider receipt task id");
  assertIdentifier(provider.profileId, "provider receipt profile id");
  assertIdentifier(provider.modelId, "provider receipt model id");
  const originalError = receipt.originalError;
  if (!Number.isSafeInteger(originalError.eventId) || originalError.eventId < 1 ||
      originalError.code !== "PROVIDER_RESULT_FORMAT" ||
      typeof originalError.eventDigest !== "string" || !hashPattern.test(originalError.eventDigest)) {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption original-error receipt is invalid");
  }
  const media = receipt.media;
  if (!mediaKinds.includes(media.kind) || typeof media.canonicalAssetId !== "string" ||
      typeof media.aliasAssetId !== "string" || media.canonicalAssetId === media.aliasAssetId ||
      typeof media.ledgerDigest !== "string" || !hashPattern.test(media.ledgerDigest) ||
      !Array.isArray(media.publications) || media.publications.length !== 3) {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption media receipt is invalid");
  }
  assertIdentifier(media.canonicalAssetId, "receipt canonical asset id");
  assertIdentifier(media.aliasAssetId, "receipt alias asset id");
  const roles = new Set<string>();
  for (const candidate of media.publications) {
    if (!isRecord(candidate)) fail("ADOPTION_RECEIPT_CORRUPT", "adoption publication proof is invalid");
    assertExactObjectKeys(candidate, [
      "assetId", "attemptId", "byteSize", "checksumSha256", "contentType",
      "errorCode", "objectKey", "outputSetCount", "outputSlot", "role",
      "state", "storageBackend", "storageProfileId",
    ], "adoption publication receipt");
    const publication = candidate as unknown as GenerationResultAdoptionReceiptPublication;
    if (!mediaKinds.includes(media.kind) || typeof publication.attemptId !== "string" ||
        typeof publication.assetId !== "string" ||
        !["failed", "canonical", "alias"].includes(publication.role) ||
        !["failed", "published"].includes(publication.state) ||
        !Number.isSafeInteger(publication.byteSize) || publication.byteSize < 0 ||
        (publication.checksumSha256 !== null &&
          (typeof publication.checksumSha256 !== "string" || !hashPattern.test(publication.checksumSha256))) ||
        typeof publication.contentType !== "string" ||
        !["local", "oss"].includes(publication.storageBackend) ||
        (publication.storageProfileId !== null && typeof publication.storageProfileId !== "string") ||
        typeof publication.objectKey !== "string" ||
        (publication.outputSlot !== null && !Number.isSafeInteger(publication.outputSlot)) ||
        (publication.outputSetCount !== null && !Number.isSafeInteger(publication.outputSetCount)) ||
        (publication.errorCode !== null && typeof publication.errorCode !== "string")) {
      fail("ADOPTION_RECEIPT_CORRUPT", "adoption publication receipt fields are invalid");
    }
    assertIdentifier(publication.attemptId, "receipt publication attempt id");
    assertIdentifier(publication.assetId, "receipt publication asset id");
    if (publication.outputSlot !== null && (publication.outputSlot < 0 || publication.outputSlot > 3) ||
        publication.outputSetCount !== null && (publication.outputSetCount < 1 || publication.outputSetCount > 4) ||
        publication.outputSlot !== null && publication.outputSetCount !== null &&
          publication.outputSlot >= publication.outputSetCount) {
      fail("ADOPTION_RECEIPT_CORRUPT", "adoption publication receipt slot is invalid");
    }
    roles.add(publication.role);
  }
  if (roles.size !== 3 || !roles.has("failed") || !roles.has("canonical") || !roles.has("alias")) {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption publication receipt roles are incomplete");
  }
  const canvas = receipt.canvas;
  if (!Number.isSafeInteger(canvas.graphRevision) || canvas.graphRevision < 0 ||
      typeof canvas.inputFingerprint !== "string" ||
      typeof canvas.bindingDigest !== "string" || !hashPattern.test(canvas.bindingDigest) ||
      !["preserve-original", "project-canonical"].includes(canvas.projection)) {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption Canvas receipt is invalid");
  }
  assertRequestFingerprint(canvas.inputFingerprint);
  return assertReceiptDigest(receipt);
}

function rowMatchesReceiptPublication(
  row: Record<string, unknown>,
  expected: GenerationResultAdoptionReceiptPublication,
) {
  const actual = publicationFromRawRow(row);
  const normalizedActual = publicationForAdoptionReceipt({ ...actual, role: expected.role });
  return generationResultAdoptionSha256(publicationComparable(normalizedActual)) ===
    generationResultAdoptionSha256(receiptPublicationComparable(expected, actual));
}

function storedReceiptsInTransaction(
  database: DatabaseSync,
  input: Pick<GenerationResultAdoptionValidationContext, "ownerId" | "taskId" | "executionAttempt">,
) {
  const rows = database.prepare(`
    SELECT id, owner_id, task_id, execution_attempt, incident_digest,
      receipt_version, receipt_json, created_at
    FROM generation_result_adoptions
    WHERE owner_id = ? AND task_id = ? AND execution_attempt = ?
    ORDER BY created_at, id
  `).all(input.ownerId, input.taskId, input.executionAttempt) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: assertIdentifier(row.id, "adoption receipt id"),
    ownerId: row.owner_id,
    taskId: row.task_id,
    executionAttempt: row.execution_attempt,
    incidentDigest: row.incident_digest,
    receiptVersion: row.receipt_version,
    createdAt: row.created_at,
    receipt: parseStoredReceipt(row.receipt_json),
  }));
}

/**
 * Verify the complete A/B/C evidence before any result-set or task settlement
 * command.  The returned promotion input is intentionally Media-owned and
 * contains no SQL or raw storage body.
 */
export function verifyPublicationAdoptionForSettlementInTransaction(
  database: DatabaseSync,
  input: GenerationResultAdoptionValidationContext & Readonly<{
    adoptionReceiptId: string;
  }>,
): GenerationResultAdoptionSettlementVerification {
  const context = {
    ...input,
    receiptId: input.adoptionReceiptId,
  } as GenerationResultAdoptionValidationContext;
  assertIdentifier(context.ownerId, "owner id");
  assertIdentifier(context.taskId, "task id");
  assertAttempt(context.executionAttempt);
  assertHash(context.incidentDigest, "incident digest");
  assertIdentifier(context.canonicalAttemptId, "canonical attempt id");
  assertIdentifier(context.aliasAttemptId, "alias attempt id");
  assertIdentifier(context.canonicalAssetId, "canonical asset id");
  assertIdentifier(context.aliasAssetId, "alias asset id");
  if (!mediaKinds.includes(context.kind) || context.providerPostCount !== 0) {
    fail("ADOPTION_INVALID_COMMAND", "adoption kind or Provider post proof is invalid");
  }
  const { task, provider, event, eventDigest } = taskAndProviderEvidence(database, context);
  const canvas = assertCanvasBinding(context, task);
  const media = assertMediaLedger(context);
  const rows = storedReceiptsInTransaction(database, context);
  const stored = rows.find((row) => row.id === input.adoptionReceiptId);
  if (!stored) fail("ADOPTION_NOT_FOUND", "adoption receipt not found");
  const receipt = stored.receipt;
  if (stored.ownerId !== context.ownerId || stored.taskId !== context.taskId ||
      Number(stored.executionAttempt) !== context.executionAttempt ||
      stored.incidentDigest !== context.incidentDigest ||
      receipt.ownerId !== context.ownerId || receipt.taskId !== context.taskId ||
      receipt.executionAttempt !== context.executionAttempt ||
      receipt.incidentDigest !== context.incidentDigest) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "adoption receipt identity mismatch");
  }
  if (receipt.canvasId !== canvas.canvasId || receipt.nodeId !== canvas.nodeId ||
      receipt.inputFingerprint !== task.request_fingerprint ||
      receipt.provider.taskId !== task.id ||
      receipt.provider.providerTaskId !== task.provider_task_id ||
      receipt.provider.profileId !== task.provider_profile_id ||
      receipt.provider.modelId !== task.provider_model_id ||
      receipt.provider.credentialRevision !== task.credential_revision ||
      receipt.provider.attemptId !== provider.id ||
      receipt.originalError.eventId !== event.id ||
      receipt.originalError.eventDigest !== eventDigest ||
      receipt.originalError.code !== "PROVIDER_RESULT_FORMAT" ||
      receipt.media.ledgerDigest !== media.ledgerDigest ||
      receipt.media.canonicalAssetId !== context.canonicalAssetId ||
      receipt.media.aliasAssetId !== context.aliasAssetId ||
      receipt.provider.providerPostCount !== 0 ||
      receipt.provider.noNewProviderPost !== true) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "adoption receipt does not match current ledgers");
  }
  const receiptPublications = receipt.media.publications;
  if (!Array.isArray(receiptPublications) || receiptPublications.length !== 3) {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption receipt publication list is invalid");
  }
  for (const publication of media.publications) {
    const proof = receiptPublications.find((candidate) => candidate.attemptId === publication.attemptId);
    const actual = publicationForAdoptionReceipt(publicationEvidenceFromTypedRow(publication));
    if (!proof || generationResultAdoptionSha256(publicationComparable(actual)) !==
        generationResultAdoptionSha256(receiptPublicationComparable(proof, actual))) {
      fail("ADOPTION_CAS_CONFLICT", "publication changed while adoption was settling");
    }
  }
  const projection = canvas.bindingUnchanged === false
    ? "preserve-original"
    : receipt.canvas.projection === "preserve-original"
      ? "preserve-original"
      : "project-canonical";
  return Object.freeze({
    allowed: true,
    receipt,
    projection,
    mediaSlotPromotion: Object.freeze({
      ownerId: context.ownerId,
      taskId: context.taskId,
      executionAttempt: context.executionAttempt,
      kind: context.kind,
      adoptionReceiptId: input.adoptionReceiptId,
      canonicalAttemptId: context.canonicalAttemptId,
      canonicalAssetId: context.canonicalAssetId,
      aliasAttemptId: context.aliasAttemptId,
      aliasAssetId: context.aliasAssetId,
      outputSetCount: 1,
    }),
  });
}

/**
 * Narrow validator for `commitGenerationMediaOutputSetInTransaction`.
 *
 * The commit path only receives the output ids and the immutable receipt id.
 * Rebuild the complete context here: load and digest-check the stored
 * receipt, read the bounded Media publication projection, assign roles only
 * from the receipt, then run the same task/Provider/Canvas/Media checks as the
 * explicit adoption path.  Consequently an id that merely exists in the
 * adoption table cannot open the failed-task settlement branch.
 *
 * This function deliberately accepts exactly one canonical output.  The
 * receipt's alias remains evidence only (`output_slot = NULL`); it is not a
 * second output and cannot be settled accidentally.
 */
export function assertGenerationAdoptionSettlementInTransaction(
  database: DatabaseSync,
  input: GenerationResultAdoptionSettlementInput,
): GenerationResultAdoptionSettlementVerification {
  assertIdentifier(input.ownerId, "owner id");
  assertIdentifier(input.taskId, "task id");
  assertAttempt(input.executionAttempt);
  assertIdentifier(input.adoptionReceiptId, "adoption receipt id");
  if (!mediaKinds.includes(input.kind)) {
    fail("ADOPTION_INVALID_COMMAND", "kind is invalid");
  }
  if (input.assetIds.length !== 1 ||
      !input.assetIds.every((assetId) => typeof assetId === "string" &&
        identifierPattern.test(assetId))) {
    fail("ADOPTION_INVALID_COMMAND", "adoption settlement requires one valid output asset");
  }

  const storedRows = storedReceiptsInTransaction(database, {
    ownerId: input.ownerId,
    taskId: input.taskId,
    executionAttempt: input.executionAttempt,
  });
  const stored = storedRows.find((row) => row.id === input.adoptionReceiptId);
  if (!stored) fail("ADOPTION_NOT_FOUND", "adoption receipt not found");
  const receipt = stored.receipt;
  if (receipt.ownerId !== input.ownerId || receipt.taskId !== input.taskId ||
      receipt.executionAttempt !== input.executionAttempt ||
      receipt.media.kind !== input.kind ||
      receipt.media.canonicalAssetId !== input.assetIds[0]) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "adoption receipt does not match settlement input");
  }

  const canonical = receipt.media.publications.find((publication) =>
    publication.role === "canonical",
  );
  const alias = receipt.media.publications.find((publication) =>
    publication.role === "alias",
  );
  if (!canonical || !alias || canonical.assetId !== receipt.media.canonicalAssetId ||
      alias.assetId !== receipt.media.aliasAssetId || canonical.state !== "published" ||
      alias.state !== "published" || canonical.outputSlot !== 0 ||
      canonical.outputSetCount !== 1 || alias.outputSlot !== null ||
      alias.outputSetCount !== null) {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption receipt output proof is invalid");
  }

  const rows = executeTransactionScopedCommand(
    database,
    readGenerationPublicationSlotsCommand,
    { taskId: input.taskId, executionAttempt: input.executionAttempt },
  );
  const roles: Record<string, GenerationResultAdoptionPublicationRole> = {};
  for (const publication of receipt.media.publications) {
    if (roles[publication.attemptId] !== undefined) {
      fail("ADOPTION_RECEIPT_CORRUPT", "adoption receipt has duplicate publication ids");
    }
    roles[publication.attemptId] = publication.role;
  }
  // This conversion is intentionally strict about unknown rows: a publication
  // for the task that is absent from the immutable three-row receipt must stop
  // settlement rather than be ignored.
  if (rows.length !== receipt.media.publications.length) {
    fail("ADOPTION_CAS_CONFLICT", "publication set changed while adoption was settling");
  }
  const media = generationResultAdoptionMediaLedgerFromRows(rows, roles);
  const canvas: GenerationResultAdoptionCanvasBinding = {
    canvasId: receipt.canvasId,
    nodeId: receipt.nodeId,
    graphRevision: receipt.canvas.graphRevision,
    inputFingerprint: receipt.canvas.inputFingerprint,
    bindingUnchanged: true,
  };
  const context: GenerationResultAdoptionValidationContext = {
    ownerId: input.ownerId,
    taskId: input.taskId,
    executionAttempt: input.executionAttempt,
    kind: input.kind,
    incidentDigest: receipt.incidentDigest,
    canvas,
    media,
    canonicalAttemptId: canonical.attemptId,
    canonicalAssetId: canonical.assetId,
    aliasAttemptId: alias.attemptId,
    aliasAssetId: alias.assetId,
    runId: receipt.runId,
    providerPostCount: 0,
    receiptId: input.adoptionReceiptId,
  };
  return verifyPublicationAdoptionForSettlementInTransaction(database, {
    ...context,
    adoptionReceiptId: input.adoptionReceiptId,
  });
}

/**
 * Verify an idempotent replay after the original adoption was settled.
 *
 * The normal failed-task settlement validator intentionally rejects a success
 * task. A second operator click must therefore use this separate proof: the
 * stored receipt is digest-checked, the one original Provider attempt is now
 * completed, the task points at the same canonical asset, and the current
 * Media rows still equal the receipt. No task, Provider, Media slot, or Canvas
 * mutation is performed by this read-only validator.
 */
export function assertGenerationAdoptionReplayInTransaction(
  database: DatabaseSync,
  input: GenerationResultAdoptionReplayInput,
): GenerationResultAdoptionSettlementVerification {
  assertIdentifier(input.ownerId, "owner id");
  assertIdentifier(input.taskId, "task id");
  assertAttempt(input.executionAttempt);
  assertIdentifier(input.adoptionReceiptId, "adoption receipt id");
  if (!mediaKinds.includes(input.kind)) {
    fail("ADOPTION_INVALID_COMMAND", "kind is invalid");
  }

  const storedRows = storedReceiptsInTransaction(database, {
    ownerId: input.ownerId,
    taskId: input.taskId,
    executionAttempt: input.executionAttempt,
  });
  const stored = storedRows.find((row) => row.id === input.adoptionReceiptId);
  if (!stored) fail("ADOPTION_NOT_FOUND", "adoption receipt not found");
  const receipt = stored.receipt;
  if (receipt.ownerId !== input.ownerId || receipt.taskId !== input.taskId ||
      receipt.executionAttempt !== input.executionAttempt ||
      receipt.media.kind !== input.kind) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "adoption replay identity mismatch");
  }

  const task = taskRowInTransaction(database, input);
  if (!task || task.owner_id !== input.ownerId || task.kind !== input.kind ||
      task.attempt !== input.executionAttempt || task.state !== "success" ||
      task.error_code !== null || task.result_text !== null ||
      task.result_asset_id !== receipt.media.canonicalAssetId) {
    fail("ADOPTION_ALREADY_APPLIED", "adoption replay task state does not match receipt");
  }
  const providers = providerRowsInTransaction(database, input.taskId);
  if (providers.length !== 1) {
    fail("ADOPTION_UNSAFE_STATE", "adoption replay has more than one Provider attempt");
  }
  const provider = providers[0];
  if (provider.id !== receipt.provider.attemptId ||
      provider.task_id !== task.id ||
      provider.execution_attempt !== input.executionAttempt ||
      provider.owner_id !== input.ownerId || provider.kind !== input.kind ||
      provider.provider_profile_id !== task.provider_profile_id ||
      provider.provider_model_id !== task.provider_model_id ||
      provider.provider_task_id !== task.provider_task_id ||
      provider.credential_revision !== task.credential_revision ||
      provider.evidence !== "provider-boundary" ||
      provider.outcome !== "completed" || provider.failure_code !== null) {
    fail("ADOPTION_ALREADY_APPLIED", "adoption replay Provider state does not match receipt");
  }
  const event = errorEventInTransaction(database, input.taskId);
  if (!event || event.id !== receipt.originalError.eventId ||
      event.task_id !== task.id || event.state !== "failed" ||
      event.error_code !== "PROVIDER_RESULT_FORMAT" || !event.error_message) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "adoption replay original error is missing");
  }
  const eventDigest = generationResultAdoptionSha256({
    id: event.id,
    taskId: event.task_id,
    state: event.state,
    code: event.error_code,
    message: event.error_message,
    createdAt: event.created_at,
  });
  if (eventDigest !== receipt.originalError.eventDigest) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "adoption replay original error changed");
  }

  const roles: Record<string, GenerationResultAdoptionPublicationRole> = {};
  for (const publication of receipt.media.publications) {
    if (roles[publication.attemptId] !== undefined) {
      fail("ADOPTION_RECEIPT_CORRUPT", "adoption replay has duplicate publication ids");
    }
    roles[publication.attemptId] = publication.role;
  }
  const rows = executeTransactionScopedCommand(
    database,
    readGenerationPublicationSlotsCommand,
    { taskId: input.taskId, executionAttempt: input.executionAttempt },
  );
  if (rows.length !== receipt.media.publications.length) {
    fail("ADOPTION_CAS_CONFLICT", "publication set changed during adoption replay");
  }
  const media = generationResultAdoptionMediaLedgerFromRows(rows, roles);
  const canonical = receipt.media.publications.find((item) => item.role === "canonical");
  const alias = receipt.media.publications.find((item) => item.role === "alias");
  if (!canonical || !alias) {
    fail("ADOPTION_RECEIPT_CORRUPT", "adoption replay receipt roles are incomplete");
  }
  const context: GenerationResultAdoptionValidationContext = {
    ownerId: input.ownerId,
    taskId: input.taskId,
    executionAttempt: input.executionAttempt,
    kind: input.kind,
    incidentDigest: receipt.incidentDigest,
    canvas: {
      canvasId: receipt.canvasId,
      nodeId: receipt.nodeId,
      graphRevision: receipt.canvas.graphRevision,
      inputFingerprint: receipt.canvas.inputFingerprint,
      bindingUnchanged: true,
    },
    media,
    canonicalAttemptId: canonical.attemptId,
    canonicalAssetId: canonical.assetId,
    aliasAttemptId: alias.attemptId,
    aliasAssetId: alias.assetId,
    runId: receipt.runId,
    providerPostCount: 0,
    receiptId: input.adoptionReceiptId,
  };
  const ledger = assertMediaLedger(context);
  if (ledger.ledgerDigest !== receipt.media.ledgerDigest) {
    fail("ADOPTION_CAS_CONFLICT", "Media ledger changed during adoption replay");
  }
  for (const publication of ledger.publications) {
    const expected = receipt.media.publications.find((item) =>
      item.attemptId === publication.attemptId,
    );
    const actual = publicationForAdoptionReceipt(publication);
    if (!expected || generationResultAdoptionSha256(publicationComparable(actual)) !==
        generationResultAdoptionSha256(receiptPublicationComparable(expected, publication))) {
      fail("ADOPTION_CAS_CONFLICT", "Media publication changed during adoption replay");
    }
  }
  return Object.freeze({
    allowed: true,
    receipt,
    projection: receipt.canvas.projection,
    mediaSlotPromotion: Object.freeze({
      ownerId: input.ownerId,
      taskId: input.taskId,
      executionAttempt: input.executionAttempt,
      kind: input.kind,
      adoptionReceiptId: input.adoptionReceiptId,
      canonicalAttemptId: canonical.attemptId,
      canonicalAssetId: canonical.assetId,
      aliasAttemptId: alias.attemptId,
      aliasAssetId: alias.assetId,
      outputSetCount: 1,
    }),
  });
}

/**
 * A legacy generation publication with no output slot is safe to read only
 * when a complete, digest-checked adoption receipt binds that exact row.
 * This is deliberately a transaction-scoped assertion: reserve, collection
 * and commit callers must invoke it before treating a legacy row as a result.
 */
export function assertGenerationPublicationAliasesInTransaction(
  database: DatabaseSync,
  input: Readonly<{
    ownerId: string;
    taskId: string;
    executionAttempt: number;
    kind: GenerationResultAdoptionKind;
  }>,
): void {
  assertIdentifier(input.ownerId, "owner id");
  assertIdentifier(input.taskId, "task id");
  assertAttempt(input.executionAttempt);
  if (!mediaKinds.includes(input.kind)) fail("ADOPTION_INVALID_COMMAND", "kind is invalid");
  const rows = executeTransactionScopedCommand(
    database,
    readGenerationPublicationSlotsCommand,
    { taskId: input.taskId, executionAttempt: input.executionAttempt },
  );
  const relevant = rows.filter((row) => row.source === "generation" &&
    row.task_id === input.taskId && row.owner_id === input.ownerId &&
    row.kind === input.kind && retainedPublicationStates.has(String(row.state)));
  const legacy = relevant.filter((row) => row.output_slot === null || row.output_set_count === null);
  if (legacy.length === 0) return;
  const receipts = storedReceiptsInTransaction(database, input);
  for (const row of legacy) {
    const bound = receipts.some(({ receipt }) => {
      if (receipt.expectedOutputCount !== 1 || receipt.taskId !== input.taskId ||
          receipt.ownerId !== input.ownerId || receipt.executionAttempt !== input.executionAttempt ||
          receipt.media.kind !== input.kind || receipt.media.publications.length !== 3) return false;
      const publication = receipt.media.publications.find((candidate) =>
        candidate.attemptId === row.attempt_id,
      );
      if (!publication) return false;
      try {
        return rowMatchesReceiptPublication(row, publication);
      } catch {
        return false;
      }
    });
    if (!bound) {
      fail("ADOPTION_UNSAFE_STATE", "legacy publication is not bound by a complete adoption receipt");
    }
  }
}

/** Parse and return the compact workflow-facing adoption identity. */
export function readGenerationResultAdoptionInTransaction(
  database: DatabaseSync,
  input: Readonly<{
    ownerId: string;
    taskId: string;
    executionAttempt: number;
    adoptionReceiptId?: string;
  }>,
): GenerationResultAdoptionRead | undefined {
  assertIdentifier(input.ownerId, "owner id");
  assertIdentifier(input.taskId, "task id");
  assertAttempt(input.executionAttempt);
  if (input.adoptionReceiptId !== undefined) {
    assertIdentifier(input.adoptionReceiptId, "adoption receipt id");
  }
  const row = input.adoptionReceiptId === undefined
    ? database.prepare(`
        SELECT id, owner_id, task_id, execution_attempt, receipt_json
        FROM generation_result_adoptions
        WHERE owner_id = ? AND task_id = ? AND execution_attempt = ?
        ORDER BY created_at DESC, id DESC LIMIT 1
      `).get(input.ownerId, input.taskId, input.executionAttempt) as Record<string, unknown> | undefined
    : database.prepare(`
        SELECT id, owner_id, task_id, execution_attempt, receipt_json
        FROM generation_result_adoptions
        WHERE id = ?
      `).get(input.adoptionReceiptId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const receipt = parseStoredReceipt(row.receipt_json);
  if (row.owner_id !== input.ownerId || row.task_id !== input.taskId ||
      Number(row.execution_attempt) !== input.executionAttempt ||
      receipt.ownerId !== input.ownerId || receipt.taskId !== input.taskId ||
      receipt.executionAttempt !== input.executionAttempt) {
    fail("ADOPTION_EVIDENCE_MISMATCH", "adoption receipt owner/task identity mismatch");
  }
  return Object.freeze({
    id: assertIdentifier(row.id, "adoption receipt id"),
    taskId: input.taskId,
    ownerId: input.ownerId,
    executionAttempt: input.executionAttempt,
    canvasId: receipt.canvasId,
    nodeId: receipt.nodeId,
    runId: receipt.runId,
    canonicalAssetId: receipt.media.canonicalAssetId,
    receiptDigest: receipt.receiptDigest,
  });
}

export {
  assertMediaLedger,
  assertCanvasBinding,
  taskAndProviderEvidence,
  parseStoredReceipt,
};
