import type { DatabaseSync } from "node:sqlite";
import type {
  SeedanceCharacterComplianceBranch,
  SeedanceCharacterComplianceRiskCode,
  SeedanceCharacterComplianceState,
} from "../types/seedanceCharacterCompliance";

export type SeedanceCharacterComplianceDisclosureRecord = Readonly<{
  acceptedAt: string;
  assetId: string;
  createdAt: string;
  expiresAt: string | null;
  id: string;
  ownerId: string;
  revokedAt: string | null;
  version: string;
}>;

export type SeedanceCharacterComplianceCheckRecord = Readonly<{
  branch: SeedanceCharacterComplianceBranch;
  checkedAt: string | null;
  createdAt: string;
  disclosureId: string;
  expiresAt: string | null;
  failureCode: string | null;
  id: string;
  idempotencyKey: string;
  modelConfigurationRevision: string;
  modelId: string;
  ownerId: string;
  policyRevision: string;
  providerAccountFingerprint: string | null;
  providerCheckId: string | null;
  providerConfigurationVersion: number | null;
  providerCredentialVersion: number | null;
  providerDisplayName: string | null;
  providerProfileId: string | null;
  providerRegion: string | null;
  providerStatus: string | null;
  riskCodes: readonly SeedanceCharacterComplianceRiskCode[];
  sourceAssetId: string;
  sourceChecksumSha256: string;
  state: SeedanceCharacterComplianceState;
  updatedAt: string;
}>;

export type SeedanceCharacterComplianceAttemptRecord = Readonly<{
  attemptNumber: number;
  checkId: string;
  createdAt: string;
  diagnostic: Readonly<{
    httpStatus: number | null;
    providerCode: string | null;
    requestId: string | null;
  }>;
  failureCode: string | null;
  id: string;
  operation: "create" | "inspect" | "cancel";
  outcome: "admission-pending" | "accepted" | "response-received" |
    "outcome-unknown" | "definitive-rejected" | "provider-failed" |
    "cancelled";
  ownerId: string;
  providerStatus: string | null;
  state: SeedanceCharacterComplianceState;
  updatedAt: string;
}>;

function riskCodes(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Object.freeze(Array.isArray(parsed)
      ? parsed.filter((item): item is SeedanceCharacterComplianceRiskCode =>
        typeof item === "string")
      : []);
  } catch {
    return Object.freeze([] as SeedanceCharacterComplianceRiskCode[]);
  }
}

function diagnostic(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as Record<string, unknown>;
    return Object.freeze({
      httpStatus: typeof parsed.httpStatus === "number" ? parsed.httpStatus : null,
      providerCode: typeof parsed.providerCode === "string" ? parsed.providerCode : null,
      requestId: typeof parsed.requestId === "string" ? parsed.requestId : null,
    });
  } catch {
    return Object.freeze({ httpStatus: null, providerCode: null, requestId: null });
  }
}

function mapCheck(row: Record<string, unknown> | undefined) {
  if (!row) return undefined;
  return Object.freeze({
    branch: row.branch as SeedanceCharacterComplianceBranch,
    checkedAt: row.checked_at as string | null,
    createdAt: String(row.created_at),
    disclosureId: String(row.disclosure_id),
    expiresAt: row.expires_at as string | null,
    failureCode: row.failure_code as string | null,
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    modelConfigurationRevision: String(row.model_configuration_revision),
    modelId: String(row.model_id),
    ownerId: String(row.owner_id),
    policyRevision: String(row.policy_revision),
    providerAccountFingerprint: row.provider_account_fingerprint as string | null,
    providerCheckId: row.provider_check_id as string | null,
    providerConfigurationVersion: row.provider_configuration_version === null
      ? null : Number(row.provider_configuration_version),
    providerCredentialVersion: row.provider_credential_version === null
      ? null : Number(row.provider_credential_version),
    providerDisplayName: row.provider_display_name as string | null,
    providerProfileId: row.provider_profile_id as string | null,
    providerRegion: row.provider_region as string | null,
    providerStatus: row.provider_status as string | null,
    riskCodes: riskCodes(row.risk_codes),
    sourceAssetId: String(row.source_asset_id),
    sourceChecksumSha256: String(row.source_checksum_sha256),
    state: row.state as SeedanceCharacterComplianceState,
    updatedAt: String(row.updated_at),
  } satisfies SeedanceCharacterComplianceCheckRecord);
}

function mapAttempt(row: Record<string, unknown>) {
  return Object.freeze({
    attemptNumber: Number(row.attempt_number),
    checkId: String(row.check_id),
    createdAt: String(row.created_at),
    diagnostic: diagnostic(row.diagnostic),
    failureCode: row.failure_code as string | null,
    id: String(row.id),
    operation: row.operation as SeedanceCharacterComplianceAttemptRecord["operation"],
    outcome: row.outcome as SeedanceCharacterComplianceAttemptRecord["outcome"],
    ownerId: String(row.owner_id),
    providerStatus: row.provider_status as string | null,
    state: row.state as SeedanceCharacterComplianceState,
    updatedAt: String(row.updated_at),
  } satisfies SeedanceCharacterComplianceAttemptRecord);
}

export function createSeedanceCharacterComplianceStore(database: DatabaseSync) {
  const checkById = (ownerId: string, id: string) => mapCheck(
    database.prepare(`
      SELECT * FROM seedance_character_compliance_checks
      WHERE owner_id = ? AND id = ?
    `).get(ownerId, id) as Record<string, unknown> | undefined,
  );
  return Object.freeze({
    attemptsForCheck(ownerId: string, checkId: string) {
      return (database.prepare(`
        SELECT * FROM seedance_character_compliance_attempts
        WHERE owner_id = ? AND check_id = ?
        ORDER BY attempt_number, id
      `).all(ownerId, checkId) as Record<string, unknown>[]).map(mapAttempt);
    },
    checkById,
    checkByIdempotency(ownerId: string, idempotencyKey: string) {
      return mapCheck(database.prepare(`
        SELECT * FROM seedance_character_compliance_checks
        WHERE owner_id = ? AND idempotency_key = ?
      `).get(ownerId, idempotencyKey) as Record<string, unknown> | undefined);
    },
    claimRetryAttempt(ownerId: string, checkId: string, timestamp: string) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const check = database.prepare(`
          SELECT state FROM seedance_character_compliance_checks
          WHERE owner_id = ? AND id = ?
        `).get(ownerId, checkId) as { state?: unknown } | undefined;
        const summary = database.prepare(`
          SELECT
            COUNT(*) AS attempt_count,
            COALESCE(MAX(attempt_number), 0) AS max_attempt_number
          FROM seedance_character_compliance_attempts
          WHERE owner_id = ? AND check_id = ? AND operation = 'create'
        `).get(ownerId, checkId) as {
          attempt_count: number;
          max_attempt_number: number;
        };
        const latest = database.prepare(`
          SELECT outcome FROM seedance_character_compliance_attempts
          WHERE owner_id = ? AND check_id = ? AND operation = 'create'
          ORDER BY attempt_number DESC, id DESC LIMIT 1
        `).get(ownerId, checkId) as { outcome?: unknown } | undefined;
        if (
          check?.state !== "FAILED_RETRYABLE" ||
          Number(summary.attempt_count) >= 3 ||
          latest?.outcome !== "provider-failed"
        ) {
          database.exec("COMMIT");
          return undefined;
        }
        const attemptNumber = Number(summary.max_attempt_number) + 1;
        const id = `${checkId}:create:${attemptNumber}`;
        database.prepare(`
          INSERT INTO seedance_character_compliance_attempts (
            id, check_id, owner_id, attempt_number, operation, outcome, state,
            provider_status, failure_code, diagnostic, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'create', 'admission-pending', 'QUEUED',
            NULL, NULL, '{}', ?, ?)
        `).run(id, checkId, ownerId, attemptNumber, timestamp, timestamp);
        database.prepare(`
          UPDATE seedance_character_compliance_checks
          SET state = 'QUEUED', failure_code = NULL, updated_at = ?
          WHERE owner_id = ? AND id = ? AND state = 'FAILED_RETRYABLE'
        `).run(timestamp, ownerId, checkId);
        database.exec("COMMIT");
        return mapAttempt(database.prepare(`
          SELECT * FROM seedance_character_compliance_attempts WHERE id = ?
        `).get(id) as Record<string, unknown>);
      } catch (error) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // Preserve the original error.
        }
        throw error;
      }
    },
    currentForSource(ownerId: string, assetId: string) {
      return mapCheck(database.prepare(`
        SELECT * FROM seedance_character_compliance_checks
        WHERE owner_id = ? AND source_asset_id = ?
        ORDER BY updated_at DESC, id DESC LIMIT 1
      `).get(ownerId, assetId) as Record<string, unknown> | undefined);
    },
    latestAttempt(
      ownerId: string,
      checkId: string,
      operation?: SeedanceCharacterComplianceAttemptRecord["operation"],
    ) {
      const row = operation
        ? database.prepare(`
            SELECT * FROM seedance_character_compliance_attempts
            WHERE owner_id = ? AND check_id = ? AND operation = ?
            ORDER BY attempt_number DESC, id DESC LIMIT 1
          `).get(ownerId, checkId, operation)
        : database.prepare(`
            SELECT * FROM seedance_character_compliance_attempts
            WHERE owner_id = ? AND check_id = ?
            ORDER BY attempt_number DESC, id DESC LIMIT 1
          `).get(ownerId, checkId);
      return row ? mapAttempt(row as Record<string, unknown>) : undefined;
    },
    nextAttemptNumber(ownerId: string, checkId: string) {
      const row = database.prepare(`
        SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_number
        FROM seedance_character_compliance_attempts
        WHERE owner_id = ? AND check_id = ?
      `).get(ownerId, checkId) as { next_number: number };
      return Number(row.next_number);
    },
    saveAttempt(record: SeedanceCharacterComplianceAttemptRecord) {
      database.prepare(`
        INSERT INTO seedance_character_compliance_attempts (
          id, check_id, owner_id, attempt_number, operation, outcome, state,
          provider_status, failure_code, diagnostic, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          outcome = excluded.outcome,
          state = excluded.state,
          provider_status = excluded.provider_status,
          failure_code = excluded.failure_code,
          diagnostic = excluded.diagnostic,
          updated_at = excluded.updated_at
      `).run(
        record.id, record.checkId, record.ownerId, record.attemptNumber,
        record.operation, record.outcome, record.state, record.providerStatus,
        record.failureCode, JSON.stringify(record.diagnostic), record.createdAt,
        record.updatedAt,
      );
      return record;
    },
    saveCheck(record: SeedanceCharacterComplianceCheckRecord) {
      database.prepare(`
        INSERT INTO seedance_character_compliance_checks (
          id, owner_id, source_kind, source_asset_id, source_checksum_sha256, model_id,
          model_configuration_revision, disclosure_id, branch, state,
          idempotency_key, provider_profile_id, provider_region,
          provider_account_fingerprint, provider_configuration_version,
          provider_credential_version, policy_revision,
          provider_check_id, provider_display_name, provider_status, risk_codes,
          checked_at, expires_at, failure_code, created_at, updated_at
        ) VALUES (
          ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          state = excluded.state,
          provider_check_id = excluded.provider_check_id,
          provider_display_name = excluded.provider_display_name,
          provider_status = excluded.provider_status,
          risk_codes = excluded.risk_codes,
          checked_at = excluded.checked_at,
          expires_at = excluded.expires_at,
          failure_code = excluded.failure_code,
          updated_at = excluded.updated_at
      `).run(
        record.id, record.ownerId, record.sourceAssetId,
        record.sourceChecksumSha256, record.modelId,
        record.modelConfigurationRevision, record.disclosureId, record.branch,
        record.state, record.idempotencyKey, record.providerProfileId,
        record.providerRegion, record.providerAccountFingerprint,
        record.providerConfigurationVersion, record.providerCredentialVersion,
        record.policyRevision, record.providerCheckId, record.providerDisplayName,
        record.providerStatus, JSON.stringify(record.riskCodes), record.checkedAt,
        record.expiresAt, record.failureCode, record.createdAt, record.updatedAt,
      );
      return checkById(record.ownerId, record.id)!;
    },
    saveDisclosure(record: SeedanceCharacterComplianceDisclosureRecord) {
      database.prepare(`
        INSERT INTO seedance_character_compliance_disclosures (
          id, owner_id, source_kind, source_asset_id, version, accepted_at, expires_at,
          revoked_at, created_at
        ) VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, source_kind, source_asset_id, version) DO NOTHING
      `).run(
        record.id, record.ownerId, record.assetId, record.version,
        record.acceptedAt, record.expiresAt, record.revokedAt, record.createdAt,
      );
      const row = database.prepare(`
        SELECT * FROM seedance_character_compliance_disclosures
        WHERE owner_id = ? AND source_asset_id = ? AND version = ?
      `).get(record.ownerId, record.assetId, record.version) as Record<string, unknown>;
      return Object.freeze({
        acceptedAt: String(row.accepted_at),
        assetId: String(row.source_asset_id),
        createdAt: String(row.created_at),
        expiresAt: row.expires_at as string | null,
        id: String(row.id),
        ownerId: String(row.owner_id),
        revokedAt: row.revoked_at as string | null,
        version: String(row.version),
      } satisfies SeedanceCharacterComplianceDisclosureRecord);
    },
  });
}
