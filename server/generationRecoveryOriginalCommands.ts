import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  accountAllowsDurableMediaReferenceCommand,
  isActiveGenerationRecoveryAdminCommand,
} from "./accountTransactionCommands";
import { recordAudit } from "./audit";
import {
  appendProviderEvidenceConflictCaseInTransaction,
} from "./generationRecoveryCaseStore";
import { executeTransactionScopedCommand } from "./transactionCommand";
import {
  recoveryCaseEventCode,
  recoveryOriginalOnlyEventCode,
  type RecoveryOriginalOnlyMarker,
} from "../types/generationRecovery";
import { providerEvidenceConflictEventCode } from "./generationRecoveryTaskQueries";
import type { GenerationTaskKind, GenerationTaskState } from "./generationTaskStore";

/**
 * Internal V4 maintenance commands.  These commands only inspect or mutate
 * the durable local ledger.  They never submit a Provider request and are not
 * an HTTP boundary.  A Provider adapter must first issue a branded evidence
 * value through issueAdapterVerifiedOriginalRecoveryEvidence.
 */

const identifierPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const providerModelPattern = /^[A-Za-z0-9._:@/-]{1,240}$/;
const protocolContractPattern = /^[A-Za-z0-9._:@/-]{1,200}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const requestFingerprintPattern = /^(?:intent-v3:)?[a-f0-9]{64}$/;
const attemptOutcomes = [
  "boundary-claimed", "definitive-rejected", "accepted", "response-received",
  "provider-failed", "completed", "outcome-unknown",
] as const;
const kinds = ["text", "image", "video", "audio"] as const;
const recoveryErrorCodes = new Set([
  "OPERATOR_INCIDENT",
  "OUTCOME_UNKNOWN_BILLING_RISK",
  "AUTOMATIC_RESULT_RECOVERY",
]);
const originalOnlyMessage = "原请求正在受保护地找回结果；不会重复提交平台请求";
const chargedMessage = "平台已确认本次生成失败且已扣费；重新生成是新一轮，可能再次收费";
const noChargeMessage = "平台已确认本次请求未受理且未扣费；重新生成是新一轮请求";
const systemActorId = "system:generation-recovery";
const providerTaskAttachedEventCode = "RECOVERY_PROVIDER_TASK_ATTACHED_V1";
const originalEvidenceEventCode = "RECOVERY_ORIGINAL_EVIDENCE_V1";
const maxCaptureEvents = 100_000;
const maxCaptureRows = 100_000;

export type OriginalRecoveryCommandErrorCode =
  | "RECOVERY_DISABLED"
  | "RECOVERY_INVALID_COMMAND"
  | "RECOVERY_NOT_FOUND"
  | "RECOVERY_ADMIN_REQUIRED"
  | "RECOVERY_CAPTURE_CORRUPT"
  | "RECOVERY_EVIDENCE_UNTRUSTED"
  | "RECOVERY_EVIDENCE_MISMATCH"
  | "RECOVERY_UNSAFE_STATE"
  | "RECOVERY_CAS_CONFLICT"
  | "RECOVERY_ALREADY_SETTLED"
  | "RECOVERY_IDENTITY_CONFLICT"
  | "RECOVERY_PUBLICATION_CONFLICT"
  | "RECOVERY_UNSUPPORTED";

export class GenerationRecoveryOriginalCommandError extends Error {
  readonly code: OriginalRecoveryCommandErrorCode;

  constructor(code: OriginalRecoveryCommandErrorCode, message: string) {
    super(message);
    this.name = "GenerationRecoveryOriginalCommandError";
    this.code = code;
  }
}

function fail(code: OriginalRecoveryCommandErrorCode, message: string): never {
  throw new GenerationRecoveryOriginalCommandError(code, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertIdentifier(value: unknown, label: string) {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    fail("RECOVERY_INVALID_COMMAND", `${label}无效`);
  }
  return value;
}

function assertHash(value: unknown, label: string) {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    fail("RECOVERY_INVALID_COMMAND", `${label}无效`);
  }
  return value;
}

function assertRequestFingerprint(value: unknown) {
  if (typeof value !== "string" || !requestFingerprintPattern.test(value)) {
    fail("RECOVERY_INVALID_COMMAND", "请求指纹无效");
  }
  return value;
}

function assertAttempt(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail("RECOVERY_INVALID_COMMAND", "执行尝试无效");
  }
  return Number(value);
}

function assertTimestamp(value: unknown, label: string) {
  if (typeof value !== "string" || value.length < 20 || value.length > 40 ||
      !Number.isFinite(Date.parse(value))) {
    fail("RECOVERY_INVALID_COMMAND", `${label}无效`);
  }
  return value;
}

function isoNow(value: string | Date | undefined) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) fail("RECOVERY_INVALID_COMMAND", "时间无效");
    return value.toISOString();
  }
  if (value !== undefined) return new Date(Date.parse(assertTimestamp(value, "时间"))).toISOString();
  return new Date().toISOString();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function parseJson(value: unknown, label: string): unknown {
  if (typeof value !== "string" || value.length > 8 * 1024 * 1024) {
    fail("RECOVERY_CAPTURE_CORRUPT", `${label}损坏`);
  }
  try {
    return JSON.parse(value);
  } catch {
    fail("RECOVERY_CAPTURE_CORRUPT", `${label}不是合法JSON`);
  }
}

function parseObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = parseJson(value, label);
  if (!isObject(parsed)) fail("RECOVERY_CAPTURE_CORRUPT", `${label}不是对象`);
  return parsed;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    fail("RECOVERY_CAPTURE_CORRUPT", `${label}字段不符合固定合同`);
  }
}

type TaskRow = Readonly<{
  id: string;
  canvas_id: string;
  node_id: string;
  kind: GenerationTaskKind;
  prompt: string;
  model: string | null;
  parameters: string;
  idempotency_key: string;
  request_fingerprint: string;
  state: GenerationTaskState;
  attempt: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  owner_id: string | null;
  estimated_cost_microunits: number | null;
  actual_cost_microunits: number | null;
  provider_profile_id: string | null;
  provider_model_id: string | null;
  result_asset_id: string | null;
  cost_currency: "CNY" | "USD";
  provider_task_id: string | null;
  provider_usage_tokens: number | null;
  model_configuration: string;
  result_text: string | null;
  credential_revision: number;
}>;

type AttemptRow = Readonly<{
  id: number;
  task_id: string;
  execution_attempt: number;
  provider_profile_id: string;
  provider_model_id: string;
  kind: GenerationTaskKind;
  evidence: "historical-execution-attempt" | "provider-boundary";
  created_at: string;
  owner_id: string | null;
  credential_revision: number;
  outcome: typeof attemptOutcomes[number];
  provider_task_id: string | null;
  failure_code: string | null;
  finished_at: string | null;
}>;

type TaskEventRow = Readonly<{
  id: number;
  task_id: string;
  state: GenerationTaskState;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}>;

type CaseEventRow = Readonly<{
  id: number;
  task_id: string;
  state: GenerationTaskState;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}>;

type CanvasRow = Readonly<{
  owner_id: string | null;
  id: string;
  revision: number;
  nodes: string;
  edges: string;
  viewport: string;
  updated_at: string;
  save_session_id: string | null;
  save_sequence: number;
  graph_revision: number;
}>;

type PublicationRow = Readonly<Record<string, unknown>>;
type AssetRow = Readonly<Record<string, unknown>>;

export type OriginalRecoveryCanvasRow = CanvasRow;
export type OriginalRecoveryPublicationRow = PublicationRow;
export type OriginalRecoveryAssetRow = AssetRow;

type SnapshotPayload = Readonly<{
  task: TaskRow;
  taskEvents: readonly TaskEventRow[];
  attempts: readonly AttemptRow[];
  admissionEvents: readonly Readonly<Record<string, unknown>>[];
  publications: readonly PublicationRow[];
  assets: readonly AssetRow[];
  projectionStates: readonly Readonly<Record<string, unknown>>[];
  canvas?: CanvasRow;
  canvasNode?: Readonly<Record<string, unknown>>;
  caseEvent: CaseEventRow;
  casePayload: Readonly<Record<string, unknown>>;
  taskEventWatermark: number;
  caseEventId: number;
}>;

/**
 * Canvas and media are read through this narrow transaction port. Keeping the
 * port here prevents this generation command from becoming a second owner of
 * Canvas/media SQL. Production callers must provide it; capture fails closed
 * when it is missing.
 */
export type OriginalRecoveryRelatedLedgerSnapshot = Readonly<{
  canvas?: CanvasRow;
  canvasNode?: Readonly<Record<string, unknown>>;
  publications: readonly PublicationRow[];
  assets: readonly AssetRow[];
  projectionStates: readonly Readonly<Record<string, unknown>>[];
}>;

export type OriginalRecoveryRelatedLedgerReader = (
  database: DatabaseSync,
  input: Readonly<{ taskId: string; ownerId: string; canvasId: string; nodeId: string }>,
) => OriginalRecoveryRelatedLedgerSnapshot;

export type OriginalRecoveryCapture = Readonly<SnapshotPayload & {
  version: 1;
  taskId: string;
  caseId: string;
  ownerId: string;
  executionAttempt: number;
  capturedAt: string;
  logicalSha256: string;
}>;

type EvidenceFacts = Readonly<{
  taskId: string;
  ownerId: string;
  canvasId: string;
  nodeId: string;
  kind: GenerationTaskKind;
  executionAttempt: number;
  providerProfileId: string;
  providerModelId: string;
  requestFingerprint: string;
  providerTaskId?: string;
  providerState: "matched" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  feeDisposition: "unknown" | "charged" | "not_charged";
  observedAt: string;
}>;

type AdapterVerificationReceipt = Readonly<{
  adapterId: string;
  protocolContractId: string;
  evidenceSha256: string;
}>;

const trustedEvidence = new WeakSet<object>();

export type OriginalProviderEvidence = Readonly<EvidenceFacts & AdapterVerificationReceipt>;

/**
 * Adapter-only issuer.  The verifier is deliberately required to derive the
 * contract ID and digest from the adapter's validated raw response; callers
 * cannot pass a summary or a user-supplied digest as proof.
 */
export function issueAdapterVerifiedOriginalRecoveryEvidence(
  facts: EvidenceFacts,
  verify: (facts: EvidenceFacts) => AdapterVerificationReceipt | undefined,
): OriginalProviderEvidence {
  if (!isObject(facts)) fail("RECOVERY_EVIDENCE_UNTRUSTED", "原请求证据格式无效");
  assertIdentifier(facts.taskId, "任务ID");
  assertIdentifier(facts.ownerId, "账号ID");
  assertIdentifier(facts.canvasId, "画布ID");
  assertIdentifier(facts.nodeId, "节点ID");
  if (!kinds.includes(facts.kind)) fail("RECOVERY_EVIDENCE_UNTRUSTED", "生成类型无效");
  assertAttempt(facts.executionAttempt);
  assertIdentifier(facts.providerProfileId, "Provider配置");
  if (typeof facts.providerModelId !== "string" || !providerModelPattern.test(facts.providerModelId)) {
    fail("RECOVERY_EVIDENCE_UNTRUSTED", "Provider模型无效");
  }
  // V4 tasks use the versioned intent fingerprint; legacy local tasks may
  // still carry the bare SHA-256 form. Evidence digests remain bare hashes.
  assertRequestFingerprint(facts.requestFingerprint);
  if (facts.providerTaskId !== undefined) assertIdentifier(facts.providerTaskId, "Provider任务ID");
  if (!["matched", "queued", "running", "succeeded", "failed", "cancelled"].includes(facts.providerState)) {
    fail("RECOVERY_EVIDENCE_UNTRUSTED", "Provider状态无效");
  }
  if (!["unknown", "charged", "not_charged"].includes(facts.feeDisposition)) {
    fail("RECOVERY_EVIDENCE_UNTRUSTED", "费用结论无效");
  }
  assertTimestamp(facts.observedAt, "Provider观察时间");
  let receipt: AdapterVerificationReceipt | undefined;
  try { receipt = verify(facts); } catch { receipt = undefined; }
  if (!receipt || !isObject(receipt) ||
      !identifierPattern.test(receipt.adapterId) ||
      !protocolContractPattern.test(receipt.protocolContractId) ||
      !hashPattern.test(receipt.evidenceSha256)) {
    fail("RECOVERY_EVIDENCE_UNTRUSTED", "Provider适配器没有提供可核验的原请求证据");
  }
  const evidence = Object.freeze({ ...facts, ...receipt });
  trustedEvidence.add(evidence);
  return evidence;
}

function assertTrustedEvidence(value: unknown): asserts value is OriginalProviderEvidence {
  if (!isObject(value) || !trustedEvidence.has(value)) {
    fail("RECOVERY_EVIDENCE_UNTRUSTED", "只接受适配器已核验的原请求证据");
  }
}

type CommandOptions = Readonly<{
  enabled?: boolean;
  ownerGuard?: typeof accountAllowsDurableMediaReferenceCommand;
  adminGuard?: typeof isActiveGenerationRecoveryAdminCommand;
  readRelatedLedgers?: OriginalRecoveryRelatedLedgerReader;
}>;

export type OriginalRecoveryCommandInput = Readonly<{
  taskId: string;
  caseId: string;
  ownerId: string;
  executionAttempt: number;
  expectedTaskUpdatedAt: string;
  expectedTaskEventWatermark: number;
  expectedCaseEventId: number;
  expected: OriginalRecoveryCapture;
  evidence: OriginalProviderEvidence;
  actorId: string;
  operationId: string;
  now?: string | Date;
}>;

export type OriginalRecoveryApplyResult = Readonly<{
  changed: boolean;
  action: OriginalRecoveryAction;
  taskId: string;
  caseId: string;
  executionAttempt: number;
  task?: Readonly<Record<string, unknown>>;
  markerEventId?: number;
  auditEventId?: number;
  conflictEventId?: number;
  caseEventId?: number;
  maintenance?: "provider_evidence_conflict";
}>;

export type OriginalRecoveryAction =
  | "attach_provider_task"
  | "resume_original_only"
  | "resume_existing_result"
  | "settle_charged_failure"
  | "settle_no_charge_failure"
  | "record_provider_evidence_conflict"
  | "none";

export type OriginalRecoveryDryRun = Readonly<{
  allowed: boolean;
  action: OriginalRecoveryAction;
  reasonCode: string;
  taskId: string;
  caseId: string;
  executionAttempt: number;
  expectedLogicalSha256: string;
  evidenceSha256?: string;
  noProviderPost: true;
}>;

function assertCommandFence(input: OriginalRecoveryCommandInput) {
  assertIdentifier(input.taskId, "任务ID");
  assertIdentifier(input.caseId, "维护案例ID");
  assertIdentifier(input.ownerId, "账号ID");
  assertAttempt(input.executionAttempt);
  assertTimestamp(input.expectedTaskUpdatedAt, "任务更新时间");
  if (!Number.isSafeInteger(input.expectedTaskEventWatermark) || input.expectedTaskEventWatermark < 0) {
    fail("RECOVERY_INVALID_COMMAND", "任务事件水位无效");
  }
  if (!Number.isSafeInteger(input.expectedCaseEventId) || input.expectedCaseEventId < 1) {
    fail("RECOVERY_INVALID_COMMAND", "案例事件水位无效");
  }
  assertIdentifier(input.operationId, "命令ID");
  assertIdentifier(input.actorId, "操作者");
  if (!input.expected || input.expected.version !== 1 ||
      input.expected.taskId !== input.taskId || input.expected.caseId !== input.caseId ||
      input.expected.ownerId !== input.ownerId || input.expected.executionAttempt !== input.executionAttempt ||
      input.expected.taskEventWatermark !== input.expectedTaskEventWatermark ||
      input.expected.caseEventId !== input.expectedCaseEventId) {
    fail("RECOVERY_CAS_CONFLICT", "维护快照与命令水位不一致");
  }
  assertHash(input.expected.logicalSha256, "维护快照摘要");
  assertTrustedEvidence(input.evidence);
}

function rowCountGuard<T>(rows: readonly T[], label: string) {
  if (rows.length > maxCaptureRows) fail("RECOVERY_CAPTURE_CORRUPT", `${label}过大`);
  return rows;
}

function readCaseEvent(
  rows: readonly CaseEventRow[],
  taskId: string,
  caseId: string,
  ownerId: string,
  executionAttempt: number,
): { row: CaseEventRow; payload: Record<string, unknown> } {
  const candidates: Array<{ row: CaseEventRow; payload: Record<string, unknown> }> = [];
  for (const row of rows) {
    if (row.error_code !== recoveryCaseEventCode || typeof row.error_message !== "string") continue;
    const payload = parseObject(row.error_message, "维护案例事件");
    if (payload.version !== 1 || payload.taskId !== taskId || payload.caseId !== caseId ||
        payload.ownerId !== ownerId || payload.executionAttempt !== executionAttempt ||
        typeof payload.caseRevision !== "number" || !Number.isSafeInteger(payload.caseRevision)) {
      continue;
    }
    candidates.push({ row, payload });
  }
  const latest = candidates.at(-1);
  if (!latest) fail("RECOVERY_NOT_FOUND", "维护案例不存在或案例身份不匹配");
  return latest;
}

function capturePayload(
  database: DatabaseSync,
  input: Readonly<{ taskId: string; caseId: string; ownerId: string; executionAttempt: number }>,
  readRelatedLedgers: OriginalRecoveryRelatedLedgerReader,
): SnapshotPayload {
  const task = database.prepare("SELECT * FROM generation_tasks WHERE id = ?").get(input.taskId) as TaskRow | undefined;
  if (!task || task.owner_id !== input.ownerId || task.attempt !== input.executionAttempt) {
    fail("RECOVERY_NOT_FOUND", "原任务不存在或身份已变化");
  }
  const rawEvents = rowCountGuard(database.prepare(`
    SELECT id, task_id, state, error_code, error_message, created_at
    FROM generation_task_events WHERE task_id = ? ORDER BY id ASC
  `).all(input.taskId) as TaskEventRow[], "任务事件");
  if (rawEvents.length > maxCaptureEvents) fail("RECOVERY_CAPTURE_CORRUPT", "任务事件过多，拒绝截断快照");
  const caseEvent = readCaseEvent(rawEvents, input.taskId, input.caseId, input.ownerId, input.executionAttempt);
  const attempts = rowCountGuard(database.prepare(`
    SELECT * FROM generation_provider_attempts WHERE task_id = ? ORDER BY id ASC
  `).all(input.taskId) as AttemptRow[], "Provider尝试");
  const admissionEvents = rowCountGuard(database.prepare(`
    SELECT * FROM generation_admission_events WHERE task_id = ? ORDER BY id ASC
  `).all(input.taskId) as Array<Record<string, unknown>>, "准入事件");
  const readRelated = readRelatedLedgers(database, {
    taskId: input.taskId,
    ownerId: input.ownerId,
    canvasId: task.canvas_id,
    nodeId: task.node_id,
  });
  if (!readRelated || !Array.isArray(readRelated.publications) ||
      !Array.isArray(readRelated.assets) || !Array.isArray(readRelated.projectionStates)) {
    fail("RECOVERY_CAPTURE_CORRUPT", "画布/媒体账本读取端口返回无效结果");
  }
  const publications = rowCountGuard(readRelated.publications, "发布账本");
  const assets = rowCountGuard(readRelated.assets, "素材账本");
  const projectionStates = rowCountGuard(readRelated.projectionStates, "画布投影账本");
  const canvas = readRelated.canvas;
  const canvasNode = readRelated.canvasNode;
  return {
    task,
    taskEvents: rawEvents,
    attempts,
    admissionEvents,
    publications,
    assets,
    projectionStates,
    canvas,
    canvasNode,
    caseEvent: caseEvent.row,
    casePayload: caseEvent.payload,
    taskEventWatermark: rawEvents.at(-1)?.id ?? 0,
    caseEventId: caseEvent.row.id,
  };
}

function logicalPayload(payload: SnapshotPayload) {
  return {
    ...payload,
    task: payload.task,
    taskEvents: payload.taskEvents,
    attempts: payload.attempts,
    admissionEvents: payload.admissionEvents,
    publications: payload.publications,
    assets: payload.assets,
    projectionStates: payload.projectionStates,
    canvas: payload.canvas,
    canvasNode: payload.canvasNode,
    caseEvent: payload.caseEvent,
    casePayload: payload.casePayload,
  };
}

function toCapture(
  payload: SnapshotPayload,
  input: Readonly<{ taskId: string; caseId: string; ownerId: string; executionAttempt: number }>,
  capturedAt = new Date().toISOString(),
): OriginalRecoveryCapture {
  const logicalSha256 = sha256(logicalPayload(payload));
  return Object.freeze({
    ...payload,
    version: 1,
    taskId: input.taskId,
    caseId: input.caseId,
    ownerId: input.ownerId,
    executionAttempt: input.executionAttempt,
    capturedAt,
    logicalSha256,
  });
}

function beginImmediate<T>(database: DatabaseSync, operation: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function exactCaptureMatches(
  expected: OriginalRecoveryCapture,
  current: OriginalRecoveryCapture,
) {
  return expected.logicalSha256 === current.logicalSha256 &&
    expected.task.updated_at === current.task.updated_at &&
    expected.taskEventWatermark === current.taskEventWatermark &&
    expected.caseEventId === current.caseEventId;
}

function assertEvidenceMatchesCapture(
  capture: OriginalRecoveryCapture,
  evidence: OriginalProviderEvidence,
) {
  const task = capture.task;
  const attempt = capture.attempts.find((row) => row.execution_attempt === capture.executionAttempt);
  if (!attempt || task.id !== evidence.taskId || task.owner_id !== evidence.ownerId ||
      task.canvas_id !== evidence.canvasId || task.node_id !== evidence.nodeId ||
      task.kind !== evidence.kind || task.attempt !== evidence.executionAttempt ||
      task.provider_profile_id !== evidence.providerProfileId ||
      task.provider_model_id !== evidence.providerModelId ||
      task.request_fingerprint !== evidence.requestFingerprint ||
      attempt.owner_id !== evidence.ownerId || attempt.kind !== evidence.kind ||
      attempt.provider_profile_id !== evidence.providerProfileId ||
      attempt.provider_model_id !== evidence.providerModelId ||
      attempt.credential_revision !== Number(task.credential_revision) ||
      ((task.provider_task_id === null) !== (attempt.provider_task_id === null)) ||
      (task.provider_task_id !== null && task.provider_task_id !== evidence.providerTaskId) ||
      (attempt.provider_task_id !== null && attempt.provider_task_id !== evidence.providerTaskId)) {
    fail("RECOVERY_EVIDENCE_MISMATCH", "原请求证据与任务/尝试身份不一致");
  }
  if ((capture.canvas &&
        (capture.canvas.id !== task.canvas_id || capture.canvas.owner_id !== task.owner_id)) ||
      (capture.canvasNode && capture.canvasNode.id !== task.node_id)) {
    fail("RECOVERY_EVIDENCE_MISMATCH", "原请求画布绑定不一致");
  }
}

function parseOriginalOnlyMarkerRow(
  capture: OriginalRecoveryCapture,
  row: TaskEventRow,
): { row: TaskEventRow; marker: RecoveryOriginalOnlyMarker } | undefined {
  if (row.error_code !== recoveryOriginalOnlyEventCode || typeof row.error_message !== "string") {
    return undefined;
  }
  const parsed = parseObject(row.error_message, "原任务保护标记");
  assertExactKeys(parsed,
    ["version", "marker", "caseId", "taskId", "executionAttempt", "ownerId", "operationId"],
    "原任务保护标记");
  if (parsed.version !== 1 || parsed.marker !== "original-only" ||
      parsed.taskId !== capture.taskId || parsed.ownerId !== capture.ownerId ||
      parsed.executionAttempt !== capture.executionAttempt ||
      typeof parsed.caseId !== "string" || typeof parsed.operationId !== "string") {
    fail("RECOVERY_CAPTURE_CORRUPT", "原任务保护标记损坏");
  }
  return { row, marker: parsed as unknown as RecoveryOriginalOnlyMarker };
}

function latestOriginalOnlyMarker(
  capture: OriginalRecoveryCapture,
): { row: TaskEventRow; marker: RecoveryOriginalOnlyMarker } | undefined {
  for (const row of [...capture.taskEvents].reverse()) {
    const marker = parseOriginalOnlyMarkerRow(capture, row);
    if (marker) return marker;
  }
  return undefined;
}

function existingMarker(
  capture: OriginalRecoveryCapture,
  operationId: string,
): { row: TaskEventRow; marker: RecoveryOriginalOnlyMarker } | undefined {
  const marker = latestOriginalOnlyMarker(capture);
  return marker?.marker.operationId === operationId ? marker : undefined;
}

function requireOwnerAndMaybeAdmin(
  database: DatabaseSync,
  ownerId: string,
  actorId: string,
  requireAdmin: boolean,
  options: CommandOptions,
) {
  if (!executeTransactionScopedCommand(
    database,
    options.ownerGuard ?? accountAllowsDurableMediaReferenceCommand,
    ownerId,
  )) fail("RECOVERY_ADMIN_REQUIRED", "任务账号已停用或正在删除");
  if (requireAdmin && actorId !== systemActorId && !executeTransactionScopedCommand(
    database,
    options.adminGuard ?? isActiveGenerationRecoveryAdminCommand,
    actorId,
  )) fail("RECOVERY_ADMIN_REQUIRED", "只有有效管理员可以执行受保护维护命令");
}

function classifyAction(
  capture: OriginalRecoveryCapture,
  evidence: OriginalProviderEvidence,
): { action: OriginalRecoveryAction; reasonCode: string } {
  const task = capture.task;
  const attempt = capture.attempts.find((row) => row.execution_attempt === capture.executionAttempt);
  if (!attempt) return { action: "none", reasonCode: "MISSING_ATTEMPT" };
  if (evidence.providerState === "matched" && evidence.providerTaskId &&
      !task.provider_task_id && !attempt.provider_task_id &&
      ["running", "recovering"].includes(task.state) &&
      ["boundary-claimed", "accepted", "outcome-unknown"].includes(attempt.outcome)) {
    return { action: "attach_provider_task", reasonCode: "UNIQUE_PROVIDER_TASK_MATCH" };
  }
  if (["matched", "queued", "running"].includes(evidence.providerState) &&
      evidence.providerTaskId && task.state === "failed" &&
      recoveryErrorCodes.has(task.error_code ?? "") &&
      ["boundary-claimed", "accepted", "response-received", "outcome-unknown"].includes(attempt.outcome)) {
    return { action: "resume_original_only", reasonCode: "ORIGINAL_PROVIDER_STILL_UNRESOLVED" };
  }
  // A verified succeeded observation is still an original-only admission for
  // a failed task.  The actual normalized outputs are then handed to the
  // existing publication/projection path; this command never accepts URLs.
  if (evidence.providerState === "succeeded" && evidence.providerTaskId &&
      task.state === "failed" && !task.result_asset_id && !task.result_text &&
      recoveryErrorCodes.has(task.error_code ?? "") &&
      ["boundary-claimed", "accepted", "response-received", "outcome-unknown"].includes(attempt.outcome)) {
    return { action: "resume_original_only", reasonCode: "ORIGINAL_RESULT_VERIFIED" };
  }
  // A previous automatic/original-only recovery may already have moved the
  // task to recovering.  In that state the worker must reuse the existing
  // result publication path after this same identity/ledger/CAS check; it
  // must not try to apply the failed -> recovering transition a second time.
  if (evidence.providerState === "succeeded" && evidence.providerTaskId &&
      task.state === "recovering" && task.error_code === "AUTOMATIC_RESULT_RECOVERY" &&
      !task.result_asset_id && !task.result_text &&
      ["boundary-claimed", "accepted", "response-received", "outcome-unknown"].includes(attempt.outcome)) {
    return { action: "resume_existing_result", reasonCode: "RESULT_USES_EXISTING_PUBLICATION_PATH" };
  }
  if (evidence.providerState === "failed" && evidence.providerTaskId &&
      task.state === "failed" && !task.result_asset_id && !task.result_text &&
      evidence.feeDisposition === "charged" &&
      ["boundary-claimed", "accepted", "response-received", "outcome-unknown", "provider-failed",
        "definitive-rejected"].includes(attempt.outcome)) {
    return { action: "settle_charged_failure", reasonCode: "CONFIRMED_CHARGED_FAILURE" };
  }
  if (evidence.providerState === "failed" && evidence.providerTaskId &&
      task.state === "failed" && !task.result_asset_id && !task.result_text &&
      evidence.feeDisposition === "not_charged" &&
      ["boundary-claimed", "accepted", "response-received", "outcome-unknown",
        "provider-failed", "definitive-rejected"].includes(attempt.outcome)) {
    return { action: "settle_no_charge_failure", reasonCode: "CONFIRMED_NOT_CHARGED_FAILURE" };
  }
  return { action: "none", reasonCode: "EVIDENCE_OR_STATE_NOT_SAFE" };
}

type IncompletePublishedRelayCandidates = Readonly<{
  publishedCandidateCount: number;
  expectedResultCount: number;
}>;

/**
 * A relay response may have published one or more outputs before the process
 * stopped.  That is safe to continue only when the durable rows describe the
 * exact current task/attempt and every already-published asset is ready.  The
 * caller must still present a trusted succeeded observation; this helper only
 * opens the ledger gate for the bounded partial-output case.
 */
function incompletePublishedRelayCandidates(
  capture: OriginalRecoveryCapture,
): IncompletePublishedRelayCandidates | undefined {
  if (capture.task.result_asset_id || capture.task.result_text || capture.task.kind === "text") {
    return undefined;
  }
  let configuration: Record<string, unknown>;
  try {
    const parsed = JSON.parse(capture.task.model_configuration);
    if (!isObject(parsed)) return undefined;
    configuration = parsed;
  } catch {
    return undefined;
  }
  if (configuration.providerProtocol !== "media-generate") return undefined;
  const expectedResultCount = configuration.modelResultCount;
  if (!Number.isSafeInteger(expectedResultCount) ||
      Number(expectedResultCount) < 1 || Number(expectedResultCount) > 4) {
    return undefined;
  }

  // A pending or quarantined publication belongs to a different recovery
  // owner and must be settled before the original result path can proceed.
  if (capture.publications.some((row) =>
    ["reserved", "staged", "external-ready", "compensating"].includes(String(row.state)) ||
    String(row.error_code) === "OSS_IDENTITY_QUARANTINED")) {
    return undefined;
  }
  // A projection ledger that has any outstanding or conflicting state can
  // race the output-set commit.  The normal projection sweep owns those rows.
  if (capture.projectionStates.some((row) =>
    ["pending", "failed", "conflict", "applied"].includes(String(row.state)))) {
    return undefined;
  }

  const assets = new Map<string, Readonly<Record<string, unknown>>>();
  for (const asset of capture.assets) {
    if (typeof asset.id !== "string" || typeof asset.kind !== "string") continue;
    const key = `${asset.kind}\0${asset.id}`;
    if (assets.has(key)) continue;
    assets.set(key, asset);
  }
  const publishedIds: string[] = [];
  for (const row of capture.publications) {
    if (String(row.state) !== "published") continue;
    if (row.source !== "generation" || row.task_id !== capture.task.id ||
        Number(row.task_execution_attempt) !== capture.executionAttempt ||
        row.owner_id !== capture.ownerId || row.kind !== capture.task.kind ||
        typeof row.asset_id !== "string") {
      return undefined;
    }
    const asset = assets.get(`${capture.task.kind}\0${row.asset_id}`);
    if (!asset || asset.owner_id !== capture.ownerId || asset.kind !== capture.task.kind ||
        asset.storage_status !== "ready" || publishedIds.includes(row.asset_id)) {
      return undefined;
    }
    publishedIds.push(row.asset_id);
  }
  if (publishedIds.length < 1 || publishedIds.length >= Number(expectedResultCount)) {
    return undefined;
  }
  return {
    publishedCandidateCount: publishedIds.length,
    expectedResultCount: Number(expectedResultCount),
  };
}

function checkNoResultOrPublication(
  capture: OriginalRecoveryCapture,
  options: Readonly<{ allowIncompletePublishedRelayCandidates?: boolean }> = {},
) {
  if (options.allowIncompletePublishedRelayCandidates &&
      incompletePublishedRelayCandidates(capture)) {
    return;
  }
  if (capture.task.result_asset_id || capture.task.result_text ||
      capture.publications.some((row) =>
        ["reserved", "staged", "external-ready", "compensating", "published"].includes(
          String(row.state),
        )) ||
      capture.projectionStates.some((row) =>
        ["applied", "conflict"].includes(String(row.state)))) {
    fail("RECOVERY_PUBLICATION_CONFLICT", "任务已有结果或发布账本，不能由原任务维护命令覆盖");
  }
}

function checkTaskIdentity(input: OriginalRecoveryCommandInput, capture: OriginalRecoveryCapture) {
  if (capture.task.id !== input.taskId || capture.task.owner_id !== input.ownerId ||
      capture.task.canvas_id !== input.evidence.canvasId ||
      capture.task.node_id !== input.evidence.nodeId ||
      capture.task.attempt !== input.executionAttempt ||
      capture.task.updated_at !== input.expectedTaskUpdatedAt) {
    fail("RECOVERY_CAS_CONFLICT", "任务身份、尝试或更新时间已变化");
  }
}

/**
 * A verified remote result proves that an existing Provider task was accepted.
 * Keep this transition inside the protected recovery transaction so the
 * existing result-save path can mark the response received without relaxing
 * the ordinary task-store gate for outcome-unknown attempts.
 */
function acceptExistingProviderAttempt(
  database: DatabaseSync,
  capture: OriginalRecoveryCapture,
  providerTaskId: string,
) {
  const attempt = capture.attempts.find((row) => row.execution_attempt === capture.executionAttempt);
  if (!attempt || attempt.provider_task_id !== providerTaskId) {
    fail("RECOVERY_EVIDENCE_MISMATCH", "原请求Provider任务绑定不一致");
  }
  if (attempt.outcome !== "outcome-unknown") return;
  const updated = database.prepare(`
    UPDATE generation_provider_attempts
    SET outcome = 'accepted'
    WHERE task_id = ? AND execution_attempt = ? AND owner_id IS ?
      AND provider_task_id = ? AND outcome = 'outcome-unknown'
  `).run(capture.task.id, capture.executionAttempt, capture.ownerId, providerTaskId);
  if (updated.changes !== 1) {
    fail("RECOVERY_CAS_CONFLICT", "原请求Provider尝试在确认受理时已变化");
  }
}

function auditIfUser(
  database: DatabaseSync,
  actorId: string,
  action: string,
  ownerId: string,
  details: Record<string, unknown>,
) {
  if (actorId === systemActorId) return undefined;
  return recordAudit(database, actorId, action, ownerId, details);
}

function markerFromRow(row: TaskEventRow, capture: OriginalRecoveryCapture) {
  if (row.error_code !== recoveryOriginalOnlyEventCode || typeof row.error_message !== "string") {
    fail("RECOVERY_CAPTURE_CORRUPT", "原任务保护事件编码错误");
  }
  const parsed = parseObject(row.error_message, "原任务保护事件");
  assertExactKeys(parsed,
    ["version", "marker", "caseId", "taskId", "executionAttempt", "ownerId", "operationId"],
    "原任务保护事件");
  if (parsed.version !== 1 || parsed.marker !== "original-only" ||
      parsed.taskId !== capture.taskId || parsed.ownerId !== capture.ownerId ||
      parsed.executionAttempt !== capture.executionAttempt) {
    fail("RECOVERY_CAPTURE_CORRUPT", "原任务保护事件身份错误");
  }
  return parsed;
}

function eventEvidenceMatches(
  row: TaskEventRow,
  eventCode: string,
  evidence: OriginalProviderEvidence,
  operationId: string,
) {
  if (row.error_code !== eventCode || typeof row.error_message !== "string") return false;
  const parsed = parseObject(row.error_message, "原任务维护回执");
  return parsed.version === 1 && parsed.operationId === operationId &&
    parsed.taskId === evidence.taskId &&
    parsed.executionAttempt === evidence.executionAttempt &&
    parsed.evidenceSha256 === evidence.evidenceSha256 &&
    parsed.protocolContractId === evidence.protocolContractId &&
    parsed.providerState === evidence.providerState &&
    parsed.providerTaskId === (evidence.providerTaskId ?? null);
}

/**
 * The receipt digest is the adapter's evidence identity.  A later observation
 * may have a different observation timestamp while describing the same
 * terminal fact; that case is idempotent, while a changed digest is retained
 * as a durable conflict below.
 */
function settlementReceiptMatchesExceptObservedAt(
  row: TaskEventRow,
  eventCode: string,
  evidence: OriginalProviderEvidence,
) {
  if (row.error_code !== eventCode || typeof row.error_message !== "string") return false;
  const parsed = parseObject(row.error_message, "原任务维护回执");
  return parsed.version === 1 &&
    parsed.taskId === evidence.taskId &&
    parsed.ownerId === evidence.ownerId &&
    parsed.canvasId === evidence.canvasId &&
    parsed.nodeId === evidence.nodeId &&
    parsed.kind === evidence.kind &&
    parsed.executionAttempt === evidence.executionAttempt &&
    parsed.providerProfileId === evidence.providerProfileId &&
    parsed.providerModelId === evidence.providerModelId &&
    parsed.requestFingerprint === evidence.requestFingerprint &&
    parsed.providerTaskId === (evidence.providerTaskId ?? null) &&
    parsed.providerState === evidence.providerState &&
    parsed.feeDisposition === evidence.feeDisposition &&
    parsed.adapterId === evidence.adapterId &&
    parsed.protocolContractId === evidence.protocolContractId &&
    parsed.evidenceSha256 === evidence.evidenceSha256;
}

function receiptEvidenceHash(row: TaskEventRow | undefined) {
  if (!row || typeof row.error_message !== "string") return undefined;
  const parsed = parseObject(row.error_message, "原任务维护回执");
  return typeof parsed.evidenceSha256 === "string" ? parsed.evidenceSha256 : undefined;
}

function conflictEventMatches(
  row: TaskEventRow,
  taskId: string,
  caseId: string,
  executionAttempt: number,
  operationId: string,
  evidence: OriginalProviderEvidence,
) {
  if (row.error_code !== providerEvidenceConflictEventCode || typeof row.error_message !== "string") return false;
  const parsed = parseObject(row.error_message, "平台证据冲突记录");
  return parsed.version === 1 && parsed.conflict === "provider_evidence_conflict" &&
    parsed.taskId === taskId && parsed.ownerId === evidence.ownerId &&
    parsed.caseId === caseId && parsed.executionAttempt === executionAttempt &&
    parsed.operationId === operationId &&
    parsed.incomingEvidenceSha256 === evidence.evidenceSha256 &&
    parsed.incomingObservedAt === evidence.observedAt &&
    parsed.incomingFeeDisposition === evidence.feeDisposition &&
    parsed.incomingProviderState === evidence.providerState &&
    parsed.incomingProviderTaskId === (evidence.providerTaskId ?? null) &&
    parsed.incomingAdapterId === evidence.adapterId &&
    parsed.incomingProtocolContractId === evidence.protocolContractId;
}

type SettledFailureReceipt = Readonly<{
  row: TaskEventRow;
  feeDisposition: "charged" | "not_charged";
  evidenceSha256: string;
}>;

/**
 * Find the exact durable failure settlement that a late succeeded observation
 * contradicts. This is deliberately stricter than looking at task.error_code:
 * the receipt must carry the same original task, attempt, Provider identity,
 * request fingerprint and protocol evidence. A task state alone is never
 * enough to turn a late response into a maintenance conflict.
 */
function settledFailureReceiptForLateSucceeded(
  capture: OriginalRecoveryCapture,
  evidence: OriginalProviderEvidence,
): SettledFailureReceipt | undefined {
  if (capture.task.state !== "failed" || !evidence.providerTaskId) return undefined;
  for (const row of [...capture.taskEvents].reverse()) {
    const feeDisposition = row.error_code === "PROVIDER_FAILURE_CHARGE_SETTLED"
      ? "charged"
      : row.error_code === "PROVIDER_FAILURE_NO_CHARGE_SETTLED"
        ? "not_charged"
        : undefined;
    if (!feeDisposition || typeof row.error_message !== "string") continue;
    const parsed = parseObject(row.error_message, "原任务失败结算回执");
    if (parsed.version !== 1 || parsed.terminalState !== "failed" ||
        parsed.taskId !== evidence.taskId || parsed.ownerId !== evidence.ownerId ||
        parsed.canvasId !== evidence.canvasId || parsed.nodeId !== evidence.nodeId ||
        parsed.kind !== evidence.kind || parsed.executionAttempt !== evidence.executionAttempt ||
        parsed.providerProfileId !== evidence.providerProfileId ||
        parsed.providerModelId !== evidence.providerModelId ||
        parsed.requestFingerprint !== evidence.requestFingerprint ||
        parsed.providerTaskId !== evidence.providerTaskId || parsed.providerState !== "failed" ||
        parsed.feeDisposition !== feeDisposition ||
        typeof parsed.evidenceSha256 !== "string" || !hashPattern.test(parsed.evidenceSha256)) {
      continue;
    }
    const expectedTaskErrorCode = feeDisposition === "charged"
      ? "PROVIDER_FAILED_CHARGE_SETTLED"
      : "PROVIDER_NOT_ACCEPTED_NO_CHARGE";
    if (capture.task.error_code !== expectedTaskErrorCode) continue;
    return { row, feeDisposition, evidenceSha256: parsed.evidenceSha256 };
  }
  return undefined;
}

/**
 * Persist a verified succeeded observation that arrived after this original
 * request was already settled as failed. The caller supplies a fresh capture;
 * this transaction rechecks the complete fence and only appends the conflict
 * event/case progress. It never changes the task, attempt, result or Provider
 * ledger and never invokes a Provider adapter.
 */
function recordLateSucceededConflictWithinTransaction(
  database: DatabaseSync,
  input: OriginalRecoveryCommandInput,
  options: CommandOptions,
): OriginalRecoveryApplyResult {
  assertCommandFence(input);
  const readRelatedLedgers = options.readRelatedLedgers ?? (() => {
    fail("RECOVERY_CAPTURE_CORRUPT", "画布/媒体账本读取端口未配置");
  });
  const currentPayload = capturePayload(database, input, readRelatedLedgers);
  const current = toCapture(currentPayload, input, input.expected.capturedAt);
  assertEvidenceMatchesCapture(current, input.evidence);
  checkTaskIdentity(input, current);
  if (current.task.state !== "failed" ||
      !["PROVIDER_FAILED_CHARGE_SETTLED", "PROVIDER_NOT_ACCEPTED_NO_CHARGE"].includes(
        current.task.error_code ?? "",
      )) {
    fail("RECOVERY_UNSAFE_STATE", "原请求没有处于已结算失败的安全冲突状态");
  }
  const currentAttempt = current.attempts.find((attempt) =>
    attempt.execution_attempt === current.executionAttempt);
  if (!currentAttempt || !["provider-failed", "definitive-rejected"].includes(currentAttempt.outcome)) {
    fail("RECOVERY_UNSAFE_STATE", "原请求的Provider尝试没有处于已结算失败状态");
  }
  if (input.evidence.providerState !== "succeeded" || !input.evidence.providerTaskId) {
    fail("RECOVERY_EVIDENCE_MISMATCH", "迟到冲突登记只接受带精确Provider任务ID的成功证据");
  }
  const priorReceipt = settledFailureReceiptForLateSucceeded(current, input.evidence);
  if (!priorReceipt) {
    fail("RECOVERY_UNSAFE_STATE", "原请求缺少可核验的失败结算回执");
  }
  const replayConflict = current.taskEvents.find((event) =>
    conflictEventMatches(event, current.task.id, input.caseId, input.executionAttempt, input.operationId, input.evidence));
  if (replayConflict) {
    if (current.casePayload.phase !== "queued" || current.casePayload.reason !== "provider_evidence_conflict") {
      fail("RECOVERY_IDENTITY_CONFLICT", "已记录的迟到冲突与维护事项状态不一致");
    }
    return {
      changed: false,
      action: "record_provider_evidence_conflict",
      taskId: current.task.id,
      caseId: input.caseId,
      executionAttempt: input.executionAttempt,
      conflictEventId: replayConflict.id,
      caseEventId: current.caseEventId,
      maintenance: "provider_evidence_conflict",
    };
  }
  if (!exactCaptureMatches(input.expected, current) ||
      current.task.updated_at !== input.expectedTaskUpdatedAt) {
    fail("RECOVERY_CAS_CONFLICT", "迟到原请求冲突登记时任务、尝试或账本已变化");
  }
  const feeConflict = input.evidence.feeDisposition !== "unknown" &&
    input.evidence.feeDisposition !== priorReceipt.feeDisposition;
  const conflict = appendProviderEvidenceConflictCaseInTransaction(database, {
    taskId: current.task.id,
    ownerId: current.ownerId!,
    caseId: input.caseId,
    executionAttempt: input.executionAttempt,
    operationId: input.operationId,
    actorId: input.actorId,
    now: isoNow(input.now),
    conflictKind: feeConflict ? "fee_disposition" : "provider_state",
    priorReceiptEventId: priorReceipt.row.id,
    priorReceiptEventCode: priorReceipt.row.error_code as
      "PROVIDER_FAILURE_CHARGE_SETTLED" | "PROVIDER_FAILURE_NO_CHARGE_SETTLED",
    priorEvidenceSha256: priorReceipt.evidenceSha256,
    incomingEvidenceSha256: input.evidence.evidenceSha256,
    incomingObservedAt: input.evidence.observedAt,
    incomingFeeDisposition: input.evidence.feeDisposition,
    incomingProviderState: "succeeded",
    incomingProviderTaskId: input.evidence.providerTaskId,
    incomingAdapterId: input.evidence.adapterId,
    incomingProtocolContractId: input.evidence.protocolContractId,
  });
  return {
    changed: conflict.changed,
    action: "record_provider_evidence_conflict",
    taskId: current.task.id,
    caseId: input.caseId,
    executionAttempt: input.executionAttempt,
    conflictEventId: conflict.conflictEventId,
    caseEventId: conflict.caseEventId,
    maintenance: "provider_evidence_conflict",
  };
}

function applyWithinTransaction(
  database: DatabaseSync,
  input: OriginalRecoveryCommandInput,
  options: CommandOptions,
) {
  assertCommandFence(input);
  const readRelatedLedgers = options.readRelatedLedgers ?? (() => {
    fail("RECOVERY_CAPTURE_CORRUPT", "画布/媒体账本读取端口未配置");
  });
  const currentPayload = capturePayload(database, input, readRelatedLedgers);
  const current = toCapture(currentPayload, input, input.expected.capturedAt);
  assertEvidenceMatchesCapture(current, input.evidence);
  const anyMarker = latestOriginalOnlyMarker(current);
  if (anyMarker && anyMarker.marker.caseId !== input.caseId) {
    fail("RECOVERY_IDENTITY_CONFLICT", "原任务已有其他维护事项的保护标记");
  }
  // A replay of a completed command must remain idempotent even though the
  // first apply legitimately changed task.updated_at and appended a receipt.
  // The replay still checks the exact task/evidence identity above and only
  // accepts the same operation/evidence pair.
  const replayMarker = existingMarker(current, input.operationId);
  const replayAttach = current.taskEvents.some((event) =>
    eventEvidenceMatches(event, providerTaskAttachedEventCode, input.evidence, input.operationId));
  const replayEvidence = current.taskEvents.find((event) =>
    eventEvidenceMatches(event, originalEvidenceEventCode, input.evidence, input.operationId));
  const replaySettlement = current.taskEvents.find((event) =>
    eventEvidenceMatches(
      event,
      input.evidence.feeDisposition === "charged"
        ? "PROVIDER_FAILURE_CHARGE_SETTLED"
        : "PROVIDER_FAILURE_NO_CHARGE_SETTLED",
      input.evidence,
      input.operationId,
    ));
  const replayConflict = current.taskEvents.find((event) =>
    conflictEventMatches(event, current.task.id, input.caseId, input.executionAttempt, input.operationId, input.evidence));
  if (replayMarker || replayAttach || replaySettlement || replayEvidence || replayConflict) {
    if (replayMarker) {
      const marker = markerFromRow(replayMarker.row, current);
      if (marker.caseId !== input.caseId || marker.operationId !== input.operationId ||
          current.task.state !== "recovering" || current.task.error_code !== "AUTOMATIC_RESULT_RECOVERY") {
        fail("RECOVERY_IDENTITY_CONFLICT", "原任务已有冲突的保护状态");
      }
      if (!replayEvidence) {
        fail("RECOVERY_IDENTITY_CONFLICT", "原任务已有冲突的原请求证据");
      }
    }
    return {
      changed: false,
      action: replayMarker
        ? input.evidence.providerState === "succeeded"
          ? "resume_existing_result"
          : "resume_original_only"
        : replaySettlement
          ? input.evidence.feeDisposition === "charged"
            ? "settle_charged_failure"
            : "settle_no_charge_failure"
          : replayAttach
            ? "attach_provider_task"
            : replayConflict
              ? input.evidence.feeDisposition === "charged"
                ? "settle_charged_failure"
                : "settle_no_charge_failure"
              : input.evidence.providerState === "succeeded"
              ? "resume_existing_result"
              : "resume_original_only",
      taskId: current.task.id,
      caseId: input.caseId,
      executionAttempt: input.executionAttempt,
      ...(replayConflict ? {
        conflictEventId: replayConflict.id,
        caseEventId: current.caseEventId,
        maintenance: "provider_evidence_conflict" as const,
      } : {}),
    } as OriginalRecoveryApplyResult;
  }
  checkTaskIdentity(input, current);
  if (!exactCaptureMatches(input.expected, current)) {
    fail("RECOVERY_CAS_CONFLICT", "任务、尝试、事件或绑定账本已变化");
  }
  const { action, reasonCode } = classifyAction(current, input.evidence);
  if (action === "none") fail("RECOVERY_UNSUPPORTED", `当前不能安全执行原任务维护:${reasonCode}`);
  const existing = existingMarker(current, input.operationId);
  if (anyMarker && !["resume_original_only", "resume_existing_result"].includes(action)) {
    fail("RECOVERY_IDENTITY_CONFLICT", "原任务已有不匹配的保护状态");
  }
  if (action === "attach_provider_task") {
    if (!input.evidence.providerTaskId) fail("RECOVERY_EVIDENCE_MISMATCH", "唯一匹配缺少Provider任务ID");
    const occupied = database.prepare(`
      SELECT id FROM generation_tasks
      WHERE owner_id IS ? AND provider_profile_id = ? AND credential_revision = ?
        AND provider_task_id = ? AND id <> ?
      LIMIT 1
    `).get(current.task.owner_id, current.task.provider_profile_id, current.task.credential_revision,
      input.evidence.providerTaskId, current.task.id) as { id?: string } | undefined;
    if (occupied) fail("RECOVERY_IDENTITY_CONFLICT", "Provider任务ID已经绑定到其他任务");
    const timestamp = isoNow(input.now);
    const taskUpdate = database.prepare(`
      UPDATE generation_tasks
      SET provider_task_id = ?, updated_at = ?
      WHERE id = ? AND owner_id IS ? AND attempt = ? AND state IN ('running','recovering')
        AND provider_task_id IS NULL AND updated_at = ?
    `).run(input.evidence.providerTaskId, timestamp, current.task.id, current.ownerId,
      current.executionAttempt, input.expectedTaskUpdatedAt);
    if (taskUpdate.changes !== 1) fail("RECOVERY_CAS_CONFLICT", "Provider任务绑定时任务已变化");
    const attemptUpdate = database.prepare(`
      UPDATE generation_provider_attempts
      SET provider_task_id = ?, outcome = 'accepted'
      WHERE task_id = ? AND execution_attempt = ? AND owner_id IS ?
        AND credential_revision = ? AND provider_task_id IS NULL
        AND outcome IN ('boundary-claimed','accepted','outcome-unknown')
    `).run(input.evidence.providerTaskId, current.task.id, current.executionAttempt,
      current.ownerId, current.task.credential_revision);
    if (attemptUpdate.changes !== 1) fail("RECOVERY_CAS_CONFLICT", "Provider尝试绑定时已变化");
    database.prepare(`
      INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(current.task.id, current.task.state, providerTaskAttachedEventCode, JSON.stringify({
      version: 1, operationId: input.operationId, taskId: current.task.id,
      caseId: input.caseId, executionAttempt: input.executionAttempt,
      providerTaskId: input.evidence.providerTaskId,
      evidenceSha256: input.evidence.evidenceSha256,
      protocolContractId: input.evidence.protocolContractId,
      providerState: input.evidence.providerState,
    }), timestamp);
    const auditEventId = auditIfUser(database, input.actorId,
      "generation_recovery.original_attach_provider_task", current.ownerId!, {
        version: 1, operationId: input.operationId, taskId: current.task.id,
        caseId: input.caseId, executionAttempt: input.executionAttempt,
        providerTaskId: input.evidence.providerTaskId,
        adapterId: input.evidence.adapterId,
        protocolContractId: input.evidence.protocolContractId,
        evidenceSha256: input.evidence.evidenceSha256,
      });
    return { changed: true, action, taskId: current.task.id, caseId: input.caseId,
      executionAttempt: input.executionAttempt, auditEventId } as OriginalRecoveryApplyResult;
  }
  if (action === "resume_original_only") {
    if (existing) {
      const marker = markerFromRow(existing.row, current);
      if (marker.operationId !== input.operationId || marker.caseId !== input.caseId) {
        fail("RECOVERY_IDENTITY_CONFLICT", "原任务已有其他维护命令的保护标记");
      }
      return { changed: false, action, taskId: current.task.id, caseId: input.caseId,
        executionAttempt: input.executionAttempt } as OriginalRecoveryApplyResult;
    }
    checkNoResultOrPublication(current, {
      allowIncompletePublishedRelayCandidates: input.evidence.providerState === "succeeded",
    });
    if (current.task.state !== "failed" ||
        !["OPERATOR_INCIDENT", "OUTCOME_UNKNOWN_BILLING_RISK", "AUTOMATIC_RESULT_RECOVERY"].includes(current.task.error_code ?? "")) {
      fail("RECOVERY_UNSAFE_STATE", "只有未决的失败原任务可以进入原请求保护恢复");
    }
    const timestamp = isoNow(input.now);
    if (!input.evidence.providerTaskId) {
      fail("RECOVERY_EVIDENCE_MISMATCH", "原请求恢复缺少精确Provider任务ID");
    }
    if (!current.task.provider_task_id) {
      const occupied = database.prepare(`
        SELECT id FROM generation_tasks
        WHERE owner_id IS ? AND provider_profile_id = ? AND credential_revision = ?
          AND provider_task_id = ? AND id <> ?
        LIMIT 1
      `).get(current.ownerId, current.task.provider_profile_id, current.task.credential_revision,
        input.evidence.providerTaskId, current.task.id) as { id?: string } | undefined;
      if (occupied) fail("RECOVERY_IDENTITY_CONFLICT", "Provider任务ID已经绑定到其他任务");
      const bound = database.prepare(`
        UPDATE generation_tasks SET provider_task_id = ?
        WHERE id = ? AND owner_id IS ? AND attempt = ? AND provider_task_id IS NULL
      `).run(input.evidence.providerTaskId, current.task.id, current.ownerId, current.executionAttempt);
      if (bound.changes !== 1) fail("RECOVERY_CAS_CONFLICT", "原请求恢复绑定Provider任务时已变化");
      const attemptBound = database.prepare(`
        UPDATE generation_provider_attempts
        SET provider_task_id = ?, outcome = 'accepted'
        WHERE task_id = ? AND execution_attempt = ? AND owner_id IS ?
          AND provider_task_id IS NULL
          AND outcome IN ('boundary-claimed','accepted','response-received','outcome-unknown')
      `).run(input.evidence.providerTaskId, current.task.id, current.executionAttempt, current.ownerId);
      if (attemptBound.changes !== 1) fail("RECOVERY_CAS_CONFLICT", "原请求恢复绑定Provider尝试时已变化");
    } else if (["succeeded", "queued", "running"].includes(input.evidence.providerState)) {
      acceptExistingProviderAttempt(database, current, input.evidence.providerTaskId);
    }
    const marker: RecoveryOriginalOnlyMarker = {
      version: 1, marker: "original-only", caseId: input.caseId, taskId: current.task.id,
      executionAttempt: input.executionAttempt, ownerId: current.ownerId!, operationId: input.operationId,
    };
    const updatedTask = database.prepare(`
      UPDATE generation_tasks
      SET state = 'recovering', error_code = 'AUTOMATIC_RESULT_RECOVERY',
        error_message = ?, updated_at = ?
      WHERE id = ? AND owner_id IS ? AND state = 'failed' AND attempt = ?
        AND updated_at = ? AND result_asset_id IS NULL AND result_text IS NULL
    `).run(originalOnlyMessage, timestamp, current.task.id, current.ownerId,
      current.executionAttempt, input.expectedTaskUpdatedAt);
    if (updatedTask.changes !== 1) fail("RECOVERY_CAS_CONFLICT", "原任务进入保护恢复时已变化");
    const eventMessage = JSON.stringify(marker);
    const event = database.prepare(`
      INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at)
      VALUES (?, 'recovering', ?, ?, ?)
    `).run(current.task.id, recoveryOriginalOnlyEventCode, eventMessage, timestamp);
    const evidenceEventMessage = JSON.stringify({
      version: 1,
      taskId: current.task.id,
      caseId: input.caseId,
      executionAttempt: input.executionAttempt,
      operationId: input.operationId,
      evidenceSha256: input.evidence.evidenceSha256,
      protocolContractId: input.evidence.protocolContractId,
      providerTaskId: input.evidence.providerTaskId,
      providerState: input.evidence.providerState,
    });
    database.prepare(`
      INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at)
      VALUES (?, 'recovering', ?, ?, ?)
    `).run(current.task.id, originalEvidenceEventCode, evidenceEventMessage, timestamp);
    const auditEventId = auditIfUser(database, input.actorId,
      "generation_recovery.original_resume", current.ownerId!, {
        version: 1, operationId: input.operationId, taskId: current.task.id,
        caseId: input.caseId, executionAttempt: input.executionAttempt,
        providerTaskId: input.evidence.providerTaskId,
        adapterId: input.evidence.adapterId,
        protocolContractId: input.evidence.protocolContractId,
        evidenceSha256: input.evidence.evidenceSha256,
        markerEventId: Number(event.lastInsertRowid),
      });
    return { changed: true, action, taskId: current.task.id, caseId: input.caseId,
      executionAttempt: input.executionAttempt, markerEventId: Number(event.lastInsertRowid), auditEventId } as OriginalRecoveryApplyResult;
  }
  if (action === "resume_existing_result") {
    checkNoResultOrPublication(current, {
      allowIncompletePublishedRelayCandidates: input.evidence.providerState === "succeeded",
    });
    if (current.task.state !== "recovering" || current.task.error_code !== "AUTOMATIC_RESULT_RECOVERY" ||
        !input.evidence.providerTaskId ||
        !["boundary-claimed", "accepted", "response-received", "outcome-unknown"].includes(
          current.attempts.find((attempt) => attempt.execution_attempt === current.executionAttempt)?.outcome ?? "",
        )) {
      fail("RECOVERY_UNSAFE_STATE", "原结果恢复不再处于受保护的未决状态");
    }
    acceptExistingProviderAttempt(database, current, input.evidence.providerTaskId);
    const priorResultEvidence = current.taskEvents.find((event) =>
      eventEvidenceMatches(event, originalEvidenceEventCode, input.evidence, input.operationId));
    if (priorResultEvidence) {
      return { changed: false, action, taskId: current.task.id, caseId: input.caseId,
        executionAttempt: input.executionAttempt } as OriginalRecoveryApplyResult;
    }
    const timestamp = isoNow(input.now);
    const evidenceEventMessage = JSON.stringify({
      version: 1,
      taskId: current.task.id,
      caseId: input.caseId,
      executionAttempt: input.executionAttempt,
      operationId: input.operationId,
      evidenceSha256: input.evidence.evidenceSha256,
      protocolContractId: input.evidence.protocolContractId,
      providerTaskId: input.evidence.providerTaskId,
      providerState: input.evidence.providerState,
      admissionAction: "resume_existing_result",
    });
    const event = database.prepare(`
      INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at)
      VALUES (?, 'recovering', ?, ?, ?)
    `).run(current.task.id, originalEvidenceEventCode, evidenceEventMessage, timestamp);
    const auditEventId = auditIfUser(database, input.actorId,
      "generation_recovery.original_result_admit", current.ownerId!, {
        version: 1, operationId: input.operationId, taskId: current.task.id,
        caseId: input.caseId, executionAttempt: input.executionAttempt,
        providerTaskId: input.evidence.providerTaskId,
        adapterId: input.evidence.adapterId,
        protocolContractId: input.evidence.protocolContractId,
        evidenceSha256: input.evidence.evidenceSha256,
        evidenceEventId: Number(event.lastInsertRowid),
      });
    return { changed: true, action, taskId: current.task.id, caseId: input.caseId,
      executionAttempt: input.executionAttempt, auditEventId } as OriginalRecoveryApplyResult;
  }
  if (action === "settle_charged_failure" || action === "settle_no_charge_failure") {
    requireOwnerAndMaybeAdmin(database, current.ownerId!, input.actorId, true, options);
    checkNoResultOrPublication(current);
    const providerTaskId = input.evidence.providerTaskId;
    if (!providerTaskId) fail("RECOVERY_EVIDENCE_MISMATCH", "失败结算缺少精确Provider任务ID");
    const charged = action === "settle_charged_failure";
    const terminalCode = charged ? "PROVIDER_FAILED_CHARGE_SETTLED" : "PROVIDER_NOT_ACCEPTED_NO_CHARGE";
    const eventCode = charged ? "PROVIDER_FAILURE_CHARGE_SETTLED" : "PROVIDER_FAILURE_NO_CHARGE_SETTLED";
    const message = charged ? chargedMessage : noChargeMessage;
    const conflictingReceipt = current.taskEvents.find((event) =>
      ["PROVIDER_FAILURE_CHARGE_SETTLED", "PROVIDER_FAILURE_NO_CHARGE_SETTLED"].includes(
        event.error_code ?? "",
      ) && event.error_code !== eventCode);
    const prior = current.taskEvents.find((event) => event.error_code === eventCode);
    const taskHasOppositeSettlement = (charged && current.task.error_code === "PROVIDER_NOT_ACCEPTED_NO_CHARGE") ||
      (!charged && current.task.error_code === "PROVIDER_FAILED_CHARGE_SETTLED");
    const sameTerminalReceipt = prior && settlementReceiptMatchesExceptObservedAt(prior, eventCode, input.evidence);
    if (conflictingReceipt || taskHasOppositeSettlement || (prior && !sameTerminalReceipt)) {
      const priorReceipt = conflictingReceipt ?? prior;
      const conflict = appendProviderEvidenceConflictCaseInTransaction(database, {
        taskId: current.task.id,
        ownerId: current.ownerId!,
        caseId: input.caseId,
        executionAttempt: input.executionAttempt,
        operationId: input.operationId,
        actorId: input.actorId,
        now: isoNow(input.now),
        conflictKind: conflictingReceipt || taskHasOppositeSettlement ? "fee_disposition" : "evidence_hash",
        ...(priorReceipt ? {
          priorReceiptEventId: priorReceipt.id,
          priorReceiptEventCode: priorReceipt.error_code as
            "PROVIDER_FAILURE_CHARGE_SETTLED" | "PROVIDER_FAILURE_NO_CHARGE_SETTLED",
          priorEvidenceSha256: receiptEvidenceHash(priorReceipt),
        } : {}),
        incomingEvidenceSha256: input.evidence.evidenceSha256,
        incomingObservedAt: input.evidence.observedAt,
        incomingFeeDisposition: input.evidence.feeDisposition as "charged" | "not_charged",
        incomingProviderState: "failed",
        incomingProviderTaskId: providerTaskId,
        incomingAdapterId: input.evidence.adapterId,
        incomingProtocolContractId: input.evidence.protocolContractId,
      });
      return {
        changed: conflict.changed,
        action,
        taskId: current.task.id,
        caseId: input.caseId,
        executionAttempt: input.executionAttempt,
        conflictEventId: conflict.conflictEventId,
        caseEventId: conflict.caseEventId,
        maintenance: "provider_evidence_conflict",
      } as OriginalRecoveryApplyResult;
    }
    if (prior) {
      return { changed: false, action, taskId: current.task.id, caseId: input.caseId,
        executionAttempt: input.executionAttempt } as OriginalRecoveryApplyResult;
    }
    const timestamp = isoNow(input.now);
    const attemptUpdate = database.prepare(`
      UPDATE generation_provider_attempts
      SET outcome = ?, failure_code = ?, finished_at = ?
      WHERE task_id = ? AND execution_attempt = ? AND owner_id IS ?
        AND provider_task_id = ? AND outcome IN ('boundary-claimed','accepted',
          'response-received','outcome-unknown','provider-failed')
    `).run(charged ? "provider-failed" : "definitive-rejected", terminalCode, timestamp,
      current.task.id, input.executionAttempt, current.ownerId, providerTaskId);
    if (attemptUpdate.changes !== 1) fail("RECOVERY_CAS_CONFLICT", "Provider失败结算时尝试已变化");
    const taskUpdate = database.prepare(`
      UPDATE generation_tasks
      SET state = 'failed', error_code = ?, error_message = ?, updated_at = ?
      WHERE id = ? AND owner_id IS ? AND attempt = ? AND updated_at = ?
    `).run(terminalCode, message, timestamp, current.task.id, current.ownerId,
      current.executionAttempt, input.expectedTaskUpdatedAt);
    if (taskUpdate.changes !== 1) fail("RECOVERY_CAS_CONFLICT", "失败结算时任务已变化");
    const receipt = {
      ...input.evidence,
      version: 1,
      taskId: current.task.id,
      ownerId: current.ownerId,
      canvasId: current.task.canvas_id,
      nodeId: current.task.node_id,
      kind: current.task.kind,
      executionAttempt: current.executionAttempt,
      terminalState: "failed",
      feeDisposition: input.evidence.feeDisposition,
      operationId: input.operationId,
    };
    const event = database.prepare(`
      INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at)
      VALUES (?, 'failed', ?, ?, ?)
    `).run(current.task.id, eventCode, JSON.stringify(receipt), timestamp);
    const auditEventId = auditIfUser(database, input.actorId,
      "generation_recovery.original_settlement", current.ownerId!, {
        version: 1, operationId: input.operationId, taskId: current.task.id,
        caseId: input.caseId, executionAttempt: input.executionAttempt,
        terminalCode, eventCode, adapterId: input.evidence.adapterId,
        protocolContractId: input.evidence.protocolContractId,
        evidenceSha256: input.evidence.evidenceSha256,
        receiptEventId: Number(event.lastInsertRowid),
      });
    return { changed: true, action, taskId: current.task.id, caseId: input.caseId,
      executionAttempt: input.executionAttempt, auditEventId } as OriginalRecoveryApplyResult;
  }
  fail("RECOVERY_UNSUPPORTED", "原任务维护命令没有可执行动作");
}

export function createGenerationRecoveryOriginalCommands(
  database: DatabaseSync,
  options: CommandOptions = {},
) {
  const enabled = options.enabled === true;
  const ensureEnabled = () => {
    if (!enabled) fail("RECOVERY_DISABLED", "原任务维护命令未启用");
  };

  function captureOriginalRecovery(input: Readonly<{
    taskId: string;
    caseId: string;
    ownerId: string;
    executionAttempt: number;
  }>): OriginalRecoveryCapture {
    ensureEnabled();
    assertIdentifier(input.taskId, "任务ID");
    assertIdentifier(input.caseId, "维护案例ID");
    assertIdentifier(input.ownerId, "账号ID");
    assertAttempt(input.executionAttempt);
    const readRelatedLedgers = options.readRelatedLedgers ?? (() => {
      fail("RECOVERY_CAPTURE_CORRUPT", "画布/媒体账本读取端口未配置");
    });
    return beginRead(database, () => toCapture(
      capturePayload(database, input, readRelatedLedgers), input,
    ));
  }

  function dryRunOriginalRecovery(input: OriginalRecoveryCommandInput): OriginalRecoveryDryRun {
    ensureEnabled();
    assertCommandFence(input);
    const current = captureOriginalRecovery(input);
    assertEvidenceMatchesCapture(current, input.evidence);
    if (!exactCaptureMatches(input.expected, current) ||
        current.task.updated_at !== input.expectedTaskUpdatedAt) {
      return Object.freeze({
        allowed: false,
        action: "none",
        reasonCode: "CAS_CONFLICT",
        taskId: input.taskId,
        caseId: input.caseId,
        executionAttempt: input.executionAttempt,
        expectedLogicalSha256: current.logicalSha256,
        evidenceSha256: input.evidence.evidenceSha256,
        noProviderPost: true as const,
      });
    }
    const action = classifyAction(current, input.evidence);
    if ((action.action === "resume_original_only" || action.action === "resume_existing_result") &&
        input.evidence.providerState === "succeeded") {
      // This path is intentionally non-mutating here, but it still has to
      // reject an already applied/conflicting projection or publication
      // before the caller invokes the existing result-save command. A bounded
      // set of ready published relay candidates is the one continuation case.
      checkNoResultOrPublication(current, {
        allowIncompletePublishedRelayCandidates: true,
      });
    }
    return Object.freeze({
      allowed: action.action !== "none",
      action: action.action,
      reasonCode: action.reasonCode,
      taskId: input.taskId,
      caseId: input.caseId,
      executionAttempt: input.executionAttempt,
      expectedLogicalSha256: current.logicalSha256,
      evidenceSha256: input.evidence.evidenceSha256,
      noProviderPost: true as const,
    });
  }

  function applyOriginalRecovery(input: OriginalRecoveryCommandInput): OriginalRecoveryApplyResult {
    ensureEnabled();
    return beginImmediate(database, () => {
      requireOwnerAndMaybeAdmin(database, input.ownerId, input.actorId, true, options);
      return applyWithinTransaction(database, input, options);
    });
  }

  function recordLateSucceededOriginalRecoveryConflict(
    input: OriginalRecoveryCommandInput,
  ): OriginalRecoveryApplyResult {
    ensureEnabled();
    return beginImmediate(database, () => {
      requireOwnerAndMaybeAdmin(database, input.ownerId, input.actorId, true, options);
      return recordLateSucceededConflictWithinTransaction(database, input, options);
    });
  }

  return Object.freeze({
    captureOriginalRecovery,
    dryRunOriginalRecovery,
    applyOriginalRecovery,
    recordLateSucceededOriginalRecoveryConflict,
    issueAdapterVerifiedOriginalRecoveryEvidence,
  });
}

function beginRead<T>(database: DatabaseSync, operation: () => T) {
  if (database.isTransaction) return operation();
  database.exec("BEGIN");
  try {
    const value = operation();
    database.exec("COMMIT");
    return value;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

export type { EvidenceFacts as OriginalProviderEvidenceFacts, AdapterVerificationReceipt as OriginalProviderEvidenceReceipt };
