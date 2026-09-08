import type { GenerationCapabilityKind } from "./nodeVocabulary";

/**
 * Versioned maintenance records live in generation_task_events.  The
 * generation task state remains the source of truth for execution; these
 * values describe the separate operator-maintenance case only.
 */
export const recoveryCaseEventCode = "RECOVERY_CASE_V1" as const;
export const recoveryOriginalOnlyEventCode = "RECOVERY_ORIGINAL_ONLY_V1" as const;
export const recoveryCaseVersion = 1 as const;

export const recoveryCasePhases = [
  "queued",
  "claimed",
  "waiting_provider",
  "result_recovered",
  "ready_for_user",
] as const;
export type RecoveryCasePhase = (typeof recoveryCasePhases)[number];

export const recoveryCaseEventKinds = [
  "opened",
  "claimed",
  "checked",
  "progressed",
  "acknowledged",
  "closed",
] as const;
export type RecoveryCaseEventKind = (typeof recoveryCaseEventKinds)[number];

export const recoveryCaseReasons = [
  "outcome_unknown",
  "operator_incident",
  "recovery_window_exhausted",
  "provider_evidence_conflict",
  "unsupported_recovery",
  "missing_attempt_evidence",
  "result_recovery_pending",
  "operator_follow_up",
] as const;
export type RecoveryCaseReason = (typeof recoveryCaseReasons)[number];

export const recoveryCaseCheckOutcomes = [
  "not_checked",
  "no_match",
  "multiple_matches",
  "query_failed",
  "still_running",
  "result_found",
  "terminal_verified",
  "window_expired",
] as const;
export type RecoveryCaseCheckOutcome = (typeof recoveryCaseCheckOutcomes)[number];

export const recoveryTaskStates = [
  "queued",
  "running",
  "success",
  "failed",
  "cancelled",
  "retrying",
  "recovering",
] as const;
export type RecoveryTaskState = (typeof recoveryTaskStates)[number];

export type RecoveryCaseEvidenceReference = Readonly<{
  kind: "none" | "task_event" | "provider_usage" | "provider_task";
  eventId?: number;
  sha256?: string;
}>;

/** The only JSON document permitted in a RECOVERY_CASE_V1 event. */
export type RecoveryCaseEventPayload = Readonly<{
  version: typeof recoveryCaseVersion;
  event: RecoveryCaseEventKind;
  caseId: string;
  taskId: string;
  executionAttempt: number;
  ownerId: string;
  phase: RecoveryCasePhase;
  reason: RecoveryCaseReason;
  caseRevision: number;
  operationId: string;
  actorId: string;
  attemptStartedAt?: string;
  providerWindowMs?: number;
  automaticDeadlineAt?: string;
  checkCount: number;
  checkOutcome?: RecoveryCaseCheckOutcome;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  inspectionStartedAt?: string;
  inspectionDeadlineAt?: string;
  inspectionUsed: number;
  inspectionLeaseId?: string;
  inspectionLeaseUntil?: string;
  progressVersion: number;
  readVersion: number;
  lastReadProgressVersion: number;
  claimedAt?: string;
  claimedBy?: string;
  claimLeaseId?: string;
  claimLeaseUntil?: string;
  progressAt?: string;
  closedAt?: string;
  evidenceRef?: RecoveryCaseEvidenceReference;
}>;

/**
 * A permanent guard attached to the original attempt. It is intentionally
 * separate from the case phase so an old generic launcher cannot revive the
 * original task after this record has been written.
 */
export type RecoveryOriginalOnlyMarker = Readonly<{
  version: typeof recoveryCaseVersion;
  marker: "original-only";
  caseId: string;
  taskId: string;
  executionAttempt: number;
  ownerId: string;
  operationId: string;
}>;

export type RecoveryCaseTaskSummary = Readonly<{
  id: string;
  ownerId: string;
  canvasId: string;
  nodeId: string;
  kind: GenerationCapabilityKind;
  state: RecoveryTaskState;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  providerTaskId?: string;
}>;

export type GenerationRecoveryCaseSnapshot = Readonly<{
  caseId: string;
  taskId: string;
  ownerId: string;
  executionAttempt: number;
  /** Timestamp of the first opened event, used for queue-age ordering. */
  openedAt: string;
  phase: RecoveryCasePhase;
  reason: RecoveryCaseReason;
  caseRevision: number;
  eventId: number;
  taskEventWatermark: number;
  task: RecoveryCaseTaskSummary;
  attemptStartedAt?: string;
  providerWindowMs?: number;
  automaticDeadlineAt?: string;
  checkCount: number;
  checkOutcome?: RecoveryCaseCheckOutcome;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  inspectionStartedAt?: string;
  inspectionDeadlineAt?: string;
  inspectionUsed: number;
  inspectionLeaseId?: string;
  inspectionLeaseUntil?: string;
  progressVersion: number;
  readVersion: number;
  lastReadProgressVersion: number;
  claimedAt?: string;
  claimedBy?: string;
  claimLeaseId?: string;
  claimLeaseUntil?: string;
  progressAt?: string;
  closedAt?: string;
  evidenceRef?: RecoveryCaseEvidenceReference;
}>;

export type RecoveryCaseCorruptSummary = Readonly<{
  taskId: string;
  eventId: number;
  reason: "invalid_event" | "unsupported_event" | "task_missing";
}>;

export type RecoveryCasePage = Readonly<{
  items: readonly GenerationRecoveryCaseSnapshot[];
  corrupt?: readonly RecoveryCaseCorruptSummary[];
  nextCursor?: string;
  snapshotEventId: number;
}>;

/** Owner HTTP summary. It intentionally omits owner, provider and raw evidence fields. */
export const recoveryPublicStatuses = [
  "recovering",
  "scheduled",
  "queued",
  "claimed",
  "waiting_provider",
  "unresolved",
  "result_recovered",
  "result_pending",
  "ready_for_user",
  "unavailable",
] as const;
export type RecoveryPublicStatus = (typeof recoveryPublicStatuses)[number];

export const recoveryPublicActions = [
  "view_progress",
  "view_result",
  "regenerate",
  "none",
] as const;
export type RecoveryPublicAction = (typeof recoveryPublicActions)[number];

export type RecoveryCaseSummary = Readonly<{
  taskId: string;
  caseId: string;
  canvasId: string;
  nodeId: string;
  kind: GenerationCapabilityKind;
  executionAttempt: number;
  phase: RecoveryCasePhase;
  caseEventId: number;
  progressVersion: number;
  updatedAt: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  unread: boolean;
  reasonCode: RecoveryCaseReason;
  summary: string;
  status: RecoveryPublicStatus;
  action: RecoveryPublicAction;
}>;

/**
 * Administrator-only queue information.  These identifiers are sufficient
 * to route a case to the right owner/model without exposing provider
 * evidence, request bodies, credentials or signed media URLs.
 */
export type RecoveryCaseAdminSummary = RecoveryCaseSummary & Readonly<{
  ownerId: string;
  modelId?: string;
  providerModelId?: string;
  /** Original task creation time; distinct from the queue opened time. */
  originalCreatedAt: string;
  /** Trusted provider-attempt start time, when the attempt row supplied it. */
  attemptStartedAt?: string;
  /** First durable case event; used for queue age. */
  openedAt: string;
  /** Unclaimed queued work older than 24 hours. */
  overdue: boolean;
  /** Claimed work without progress for 24 hours. */
  followUpDue: boolean;
  /** Active administrator claim owner, when present. */
  claimedBy?: string;
  /** Existing claim lease expiry; lets the same administrator renew safely. */
  claimLeaseUntil?: string;
}>;

export const recoveryCaseAuditActions = [
  "generation_recovery.case_acknowledged",
  "generation_recovery.case_checked",
  "generation_recovery.case_claimed",
  "generation_recovery.case_closed",
  "generation_recovery.case_opened",
  "generation_recovery.case_progressed",
  "generation_recovery.original_attach_provider_task",
  "generation_recovery.original_resume",
  "generation_recovery.original_result_admit",
  "generation_recovery.original_settlement",
] as const;
export type RecoveryCaseAuditAction = (typeof recoveryCaseAuditActions)[number];

/** Safe administrator audit projection; raw audit details never cross this boundary. */
export type RecoveryCaseAdminAuditEntry = Readonly<{
  id: number;
  action: RecoveryCaseAuditAction;
  actor: string;
  createdAt: string;
}>;

export type RecoveryCaseAdminDetail = Readonly<{
  enabled: boolean;
  case: RecoveryCaseAdminSummary | RecoveryCaseSummary | null;
  audit: readonly RecoveryCaseAdminAuditEntry[];
}>;

export type RecoveryCaseAdminList = Readonly<{
  enabled: boolean;
  cases: readonly RecoveryCaseAdminSummary[];
  corrupt: readonly RecoveryCaseCorruptSummary[];
  unavailableCount: number;
  nextCursor?: string;
}>;
