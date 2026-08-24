import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SeedanceTrustedAssetStatus } from "../types/seedanceTrustedAssets";
import type { SeedanceProviderIdentity } from "./seedanceTrustedAssetPort";

export type SeedanceIdentityGroupRecord = SeedanceProviderIdentity & Readonly<{
  acceptedAt: string | null;
  authorizationStatus: SeedanceTrustedAssetStatus;
  createdAt: string;
  expiresAt: string | null;
  id: string;
  idempotencyKey: string;
  ownerId: string;
  providerGroupId: string | null;
  providerStatus: string | null;
  revokedAt: string | null;
  updatedAt: string;
}>;

export type SeedanceAuthorizationSessionRecord =
  SeedanceProviderIdentity & Readonly<{
    createdAt: string;
    expiresAt: string | null;
    groupId: string | null;
    id: string;
    idempotencyKey: string;
    ownerId: string;
    providerSessionId: string | null;
    providerStatus: string | null;
    status: SeedanceTrustedAssetStatus;
    updatedAt: string;
  }>;

export type SeedanceAssetBindingRecord = SeedanceProviderIdentity & Readonly<{
  checkedAt: string | null;
  createdAt: string;
  failureCode: string | null;
  failureMessage: string | null;
  groupId: string;
  id: string;
  idempotencyKey: string;
  ownerId: string;
  providerAssetId: string | null;
  providerAssetType: string | null;
  providerStatus: string | null;
  sourceAssetId: string;
  sourceChecksumSha256: string;
  sourceKind: "image";
  status: SeedanceTrustedAssetStatus;
  updatedAt: string;
}>;

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalPart(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) {
    throw new Error(`Invalid Seedance ${label}`);
  }
  return normalized;
}

/** Stable account identity; callers must pass a tenant/account ID, never a key. */
export function seedanceProviderAccountFingerprint(input: Readonly<{
  accountId: string;
  project: string;
  region: string;
}>) {
  return sha256(JSON.stringify({
    accountId: canonicalPart(input.accountId, "account identity"),
    project: canonicalPart(input.project, "project"),
    region: canonicalPart(input.region, "region"),
    scope: "unboundry-seedance-provider-account-v1",
  }));
}

export function seedanceControlIdempotencyKey(input: Readonly<{
  identity: SeedanceProviderIdentity;
  operation: "asset" | "group" | "session";
  ownerId: string;
  source?: Readonly<{
    assetId: string;
    checksumSha256: string;
    kind: "image";
  }>;
}>) {
  return sha256(JSON.stringify({
    accountFingerprint: input.identity.accountFingerprint,
    operation: input.operation,
    ownerId: canonicalPart(input.ownerId, "owner"),
    profileId: canonicalPart(input.identity.profileId, "profile"),
    project: canonicalPart(input.identity.project, "project"),
    region: canonicalPart(input.identity.region, "region"),
    scope: "unboundry-seedance-control-idempotency-v1",
    source: input.source ?? null,
  }));
}

function identityColumns(identity: SeedanceProviderIdentity) {
  return [
    identity.profileId,
    identity.accountFingerprint,
    identity.region,
    identity.project,
  ] as const;
}

function mapGroup(row: Record<string, unknown> | undefined) {
  if (!row) return undefined;
  return Object.freeze({
    acceptedAt: row.accepted_at as string | null,
    accountFingerprint: String(row.provider_account_fingerprint),
    authorizationStatus: row.authorization_status as SeedanceTrustedAssetStatus,
    createdAt: String(row.created_at),
    expiresAt: row.expires_at as string | null,
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    ownerId: String(row.owner_id),
    profileId: String(row.provider_profile_id),
    project: String(row.provider_project),
    providerGroupId: row.provider_group_id as string | null,
    providerStatus: row.provider_status as string | null,
    region: String(row.provider_region),
    revokedAt: row.revoked_at as string | null,
    updatedAt: String(row.updated_at),
  } satisfies SeedanceIdentityGroupRecord);
}

function mapSession(row: Record<string, unknown> | undefined) {
  if (!row) return undefined;
  return Object.freeze({
    accountFingerprint: String(row.provider_account_fingerprint),
    createdAt: String(row.created_at),
    expiresAt: row.expires_at as string | null,
    groupId: row.group_id as string | null,
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    ownerId: String(row.owner_id),
    profileId: String(row.provider_profile_id),
    project: String(row.provider_project),
    providerSessionId: row.provider_session_id as string | null,
    providerStatus: row.provider_status as string | null,
    region: String(row.provider_region),
    status: row.status as SeedanceTrustedAssetStatus,
    updatedAt: String(row.updated_at),
  } satisfies SeedanceAuthorizationSessionRecord);
}

function mapBinding(row: Record<string, unknown> | undefined) {
  if (!row) return undefined;
  return Object.freeze({
    accountFingerprint: String(row.provider_account_fingerprint),
    checkedAt: row.checked_at as string | null,
    createdAt: String(row.created_at),
    failureCode: row.failure_code as string | null,
    failureMessage: row.failure_message as string | null,
    groupId: String(row.group_id),
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    ownerId: String(row.owner_id),
    profileId: String(row.provider_profile_id),
    project: String(row.provider_project),
    providerAssetId: row.provider_asset_id as string | null,
    providerAssetType: row.provider_asset_type as string | null,
    providerStatus: row.provider_status as string | null,
    region: String(row.provider_region),
    sourceAssetId: String(row.source_asset_id),
    sourceChecksumSha256: String(row.source_checksum_sha256),
    sourceKind: "image" as const,
    status: row.status as SeedanceTrustedAssetStatus,
    updatedAt: String(row.updated_at),
  } satisfies SeedanceAssetBindingRecord);
}

export function createSeedanceTrustedAssetStore(database: DatabaseSync) {
  const bindingForSource = (input: Readonly<{
    identity: SeedanceProviderIdentity;
    ownerId: string;
    sourceAssetId: string;
  }>) => mapBinding(database.prepare(`
    SELECT * FROM seedance_asset_bindings
    WHERE owner_id = ? AND source_kind = 'image' AND source_asset_id = ?
      AND provider_profile_id = ? AND provider_account_fingerprint = ?
      AND provider_region = ? AND provider_project = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(
    input.ownerId,
    input.sourceAssetId,
    ...identityColumns(input.identity),
  ) as Record<string, unknown> | undefined);
  const groupById = (ownerId: string, id: string) => mapGroup(
    database.prepare(`
      SELECT * FROM seedance_identity_groups WHERE owner_id = ? AND id = ?
    `).get(ownerId, id) as Record<string, unknown> | undefined,
  );
  const sessionById = (ownerId: string, id: string) => mapSession(
    database.prepare(`
      SELECT * FROM seedance_authorization_sessions
      WHERE owner_id = ? AND id = ?
    `).get(ownerId, id) as Record<string, unknown> | undefined,
  );
  const groupByIdempotency = (record: SeedanceIdentityGroupRecord) => mapGroup(
    database.prepare(`
      SELECT * FROM seedance_identity_groups
      WHERE owner_id = ? AND provider_profile_id = ?
        AND provider_account_fingerprint = ? AND provider_region = ?
        AND provider_project = ? AND idempotency_key = ?
    `).get(
      record.ownerId,
      ...identityColumns(record),
      record.idempotencyKey,
    ) as Record<string, unknown> | undefined,
  );
  const sessionByIdempotency = (
    record: SeedanceAuthorizationSessionRecord,
  ) => mapSession(database.prepare(`
    SELECT * FROM seedance_authorization_sessions
    WHERE owner_id = ? AND provider_profile_id = ?
      AND provider_account_fingerprint = ? AND provider_region = ?
      AND provider_project = ? AND idempotency_key = ?
  `).get(
    record.ownerId,
    ...identityColumns(record),
    record.idempotencyKey,
  ) as Record<string, unknown> | undefined);
  return Object.freeze({
    bindingForSource,
    groupById,
    sessionById,
    upsertBinding(record: SeedanceAssetBindingRecord) {
      database.prepare(`
        INSERT INTO seedance_asset_bindings (
          id, group_id, owner_id, source_kind, source_asset_id,
          source_checksum_sha256, provider_profile_id,
          provider_account_fingerprint, provider_region, provider_project,
          provider_asset_id, provider_asset_type, idempotency_key, status,
          provider_status, checked_at, failure_code, failure_message,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        ) ON CONFLICT (
          owner_id, source_kind, source_asset_id, source_checksum_sha256,
          provider_profile_id, provider_account_fingerprint, provider_region,
          provider_project, idempotency_key
        ) DO UPDATE SET
          provider_asset_id = excluded.provider_asset_id,
          provider_asset_type = excluded.provider_asset_type,
          status = excluded.status,
          provider_status = excluded.provider_status,
          checked_at = excluded.checked_at,
          failure_code = excluded.failure_code,
          failure_message = excluded.failure_message,
          updated_at = excluded.updated_at
      `).run(
        record.id,
        record.groupId,
        record.ownerId,
        record.sourceAssetId,
        record.sourceChecksumSha256,
        ...identityColumns(record),
        record.providerAssetId,
        record.providerAssetType,
        record.idempotencyKey,
        record.status,
        record.providerStatus,
        record.checkedAt,
        record.failureCode,
        record.failureMessage,
        record.createdAt,
        record.updatedAt,
      );
      return bindingForSource({
        identity: record,
        ownerId: record.ownerId,
        sourceAssetId: record.sourceAssetId,
      })!;
    },
    upsertGroup(record: SeedanceIdentityGroupRecord) {
      database.prepare(`
        INSERT INTO seedance_identity_groups (
          id, owner_id, provider_profile_id, provider_account_fingerprint,
          provider_region, provider_project, provider_group_id, idempotency_key,
          authorization_status, provider_status, accepted_at, revoked_at,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (
          owner_id, provider_profile_id, provider_account_fingerprint,
          provider_region, provider_project, idempotency_key
        ) DO UPDATE SET
          provider_group_id = excluded.provider_group_id,
          authorization_status = excluded.authorization_status,
          provider_status = excluded.provider_status,
          accepted_at = excluded.accepted_at,
          revoked_at = excluded.revoked_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `).run(
        record.id,
        record.ownerId,
        ...identityColumns(record),
        record.providerGroupId,
        record.idempotencyKey,
        record.authorizationStatus,
        record.providerStatus,
        record.acceptedAt,
        record.revokedAt,
        record.expiresAt,
        record.createdAt,
        record.updatedAt,
      );
      return groupByIdempotency(record)!;
    },
    upsertSession(record: SeedanceAuthorizationSessionRecord) {
      database.prepare(`
        INSERT INTO seedance_authorization_sessions (
          id, group_id, owner_id, provider_profile_id,
          provider_account_fingerprint, provider_region, provider_project,
          provider_session_id, idempotency_key, status, provider_status,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (
          owner_id, provider_profile_id, provider_account_fingerprint,
          provider_region, provider_project, idempotency_key
        ) DO UPDATE SET
          group_id = excluded.group_id,
          provider_session_id = excluded.provider_session_id,
          status = excluded.status,
          provider_status = excluded.provider_status,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `).run(
        record.id,
        record.groupId,
        record.ownerId,
        ...identityColumns(record),
        record.providerSessionId,
        record.idempotencyKey,
        record.status,
        record.providerStatus,
        record.expiresAt,
        record.createdAt,
        record.updatedAt,
      );
      return sessionByIdempotency(record)!;
    },
  });
}
