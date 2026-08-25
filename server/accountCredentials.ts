import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  AccountMutationBlockedError,
  assertAccountMutationAllowed,
} from "./accountMutationFence";
import {
  acquireProviderCredentialMutationLease,
  getProviderProfile,
  probeProviderKey,
  providerVerificationErrorMessage,
  type ProviderProfile,
  type ProviderVerification,
} from "./providerProfiles";
import { secretStoreEncryptionKey } from "./secretStore";

const associatedData = Buffer.from("unboundry:account-credentials:v1", "utf8");

export type AccountCredentialKeyStatus =
  | "invalid"
  | "unchecked"
  | "unknown"
  | "valid";

export type AccountCredentialRow = {
  account_id: string;
  credential_version: number;
  encrypted_key: string;
  key_checked_at: string | null;
  key_status: AccountCredentialKeyStatus;
  provider_profile_id: string;
  updated_at: string;
};

export type AccountCredentialStatus = {
  credentialVersion: number;
  keyStatus: AccountCredentialKeyStatus;
  updatedAt: string;
};

function encryptedParts(value: string) {
  const parts = value.split("$");
  if (parts.length !== 3) throw new Error("Invalid account credential");
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("Invalid account credential");
  }
  return { ciphertext, iv, tag };
}

export function accountCredentialRow(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
): AccountCredentialRow | undefined {
  return database
    .prepare(`
      SELECT
        account_id, provider_profile_id, encrypted_key, key_status,
        key_checked_at, credential_version, updated_at
      FROM account_provider_credentials
      WHERE account_id = ? AND provider_profile_id = ?
    `)
    .get(accountId, providerProfileId) as AccountCredentialRow | undefined;
}

export function accountCredentialRevision(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
) {
  const row = database
    .prepare(`
      SELECT credential_revision
      FROM account_provider_credential_epochs
      WHERE account_id = ? AND provider_profile_id = ?
    `)
    .get(accountId, providerProfileId) as
      | { credential_revision: number }
      | undefined;
  return Number(row?.credential_revision ?? 0);
}

export function accountCredentialStatusMap(
  database: DatabaseSync,
  accountId: string,
) {
  const rows = database
    .prepare(`
      SELECT provider_profile_id, key_status, credential_version, updated_at
      FROM account_provider_credentials
      WHERE account_id = ?
    `)
    .all(accountId) as Array<{
    credential_version: number;
    key_status: AccountCredentialKeyStatus;
    provider_profile_id: string;
    updated_at: string;
  }>;
  return new Map<string, AccountCredentialStatus>(
    rows.map((row) => [
      row.provider_profile_id,
      {
        credentialVersion: Number(row.credential_version),
        keyStatus: row.key_status,
        updatedAt: row.updated_at,
      },
    ]),
  );
}

function assertCredentialMutationHasNoPaidWork(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
  credentialRevision: number,
) {
  const paidWork = database.prepare(`
    SELECT tasks.id
    FROM generation_tasks AS tasks
    JOIN generation_provider_attempts AS attempts
      ON attempts.task_id = tasks.id
    WHERE
      tasks.owner_id = ?
      AND tasks.provider_profile_id = ?
      AND tasks.credential_revision = ?
      AND (
        (
          attempts.outcome = 'boundary-claimed'
          AND tasks.state IN ('queued', 'running', 'retrying', 'recovering')
        )
        OR (
          attempts.outcome IN ('accepted', 'response-received')
          AND tasks.state IN (
            'queued', 'running', 'retrying', 'recovering', 'failed'
          )
        )
      )
    LIMIT 1
  `).get(accountId, providerProfileId, credentialRevision);
  if (paidWork) {
    const error = new Error(
      "仍有已提交到模型平台的任务依赖当前密钥，请等待结果保存后再更换或删除",
    ) as Error & { code: string };
    error.code = "ACCOUNT_CREDENTIAL_IN_USE";
    throw error;
  }
}

async function decryptKey(row: AccountCredentialRow) {
  const { ciphertext, iv, tag } = encryptedParts(row.encrypted_key);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await secretStoreEncryptionKey(),
    iv,
  );
  decipher.setAAD(associatedData);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/** Server-only key lookup for a specific account + connection. */
export async function accountCredentialKey(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
) {
  const row = accountCredentialRow(database, accountId, providerProfileId);
  if (!row) return undefined;
  try {
    return await decryptKey(row);
  } catch {
    return undefined;
  }
}

/** Atomic key material + revision snapshot for server-only task preparation. */
export async function accountCredentialKeySnapshot(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
) {
  const row = accountCredentialRow(database, accountId, providerProfileId);
  if (!row) return undefined;
  try {
    return {
      apiKey: await decryptKey(row),
      credentialRevision: Number(row.credential_version),
    };
  } catch {
    return undefined;
  }
}

export function accountCredentialMaskFromKey(apiKey: string) {
  return apiKey.length >= 4 ? `••••${apiKey.slice(-4)}` : "••••";
}

export async function saveAccountCredential(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
  apiKey: string,
) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (key.length < 8 || /\s/.test(key)) {
    throw new Error("API Key 无效");
  }
  // Metadata-only profiles are supported by low-level fixtures. Real profiles
  // acquire the same document lock held while a paid request is started.
  const documentProfile = await getProviderProfile(providerProfileId);
  const lease = documentProfile
    ? await acquireProviderCredentialMutationLease(providerProfileId)
    : undefined;
  try {
    const metadataRow = database
      .prepare("SELECT 1 FROM provider_profiles WHERE id = ?")
      .get(providerProfileId);
    if (
      (lease && !lease.profile) ||
      (!lease && !documentProfile && !metadataRow)
    ) {
      throw new Error("平台连接不存在");
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      await secretStoreEncryptionKey(),
      iv,
    );
    cipher.setAAD(associatedData);
    const ciphertext = Buffer.concat([
      cipher.update(key, "utf8"),
      cipher.final(),
    ]);
    const encrypted = [
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join("$");
    const timestamp = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      assertAccountMutationAllowed(database, accountId);
      const current = accountCredentialRow(
        database,
        accountId,
        providerProfileId,
      );
      if (current) {
        assertCredentialMutationHasNoPaidWork(
          database,
          accountId,
          providerProfileId,
          Number(current.credential_version),
        );
      }
      const epoch = database
        .prepare(`
          INSERT INTO account_provider_credential_epochs (
            account_id, provider_profile_id, credential_revision, updated_at
          ) VALUES (?, ?, 1, ?)
          ON CONFLICT(account_id, provider_profile_id) DO UPDATE SET
            credential_revision = credential_revision + 1,
            updated_at = excluded.updated_at
          RETURNING credential_revision
        `)
        .get(accountId, providerProfileId, timestamp) as {
          credential_revision: number;
        };
      const credentialVersion = Number(epoch.credential_revision);
      database
        .prepare(`
          INSERT INTO account_provider_credentials (
            account_id, provider_profile_id, encrypted_key, key_status,
            key_checked_at, credential_version, updated_at
          )
          VALUES (?, ?, ?, 'unchecked', NULL, ?, ?)
          ON CONFLICT(account_id, provider_profile_id) DO UPDATE SET
            encrypted_key = excluded.encrypted_key,
            key_status = 'unchecked',
            key_checked_at = NULL,
            credential_version = excluded.credential_version,
            updated_at = excluded.updated_at
        `)
        .run(
          accountId,
          providerProfileId,
          encrypted,
          credentialVersion,
          timestamp,
        );
      database.exec("COMMIT");
      return {
        credentialVersion,
        keyStatus: "unchecked" as const,
        mask: accountCredentialMaskFromKey(key),
        updatedAt: timestamp,
      };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    lease?.release();
  }
}

export async function deleteAccountCredential(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
) {
  const documentProfile = await getProviderProfile(providerProfileId);
  const lease = documentProfile
    ? await acquireProviderCredentialMutationLease(providerProfileId)
    : undefined;
  try {
    const timestamp = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      assertAccountMutationAllowed(database, accountId);
      const current = accountCredentialRow(
        database,
        accountId,
        providerProfileId,
      );
      if (!current) {
        database.exec("COMMIT");
        return false;
      }
      assertCredentialMutationHasNoPaidWork(
        database,
        accountId,
        providerProfileId,
        Number(current.credential_version),
      );
      database
        .prepare(`
          INSERT INTO account_provider_credential_epochs (
            account_id, provider_profile_id, credential_revision, updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(account_id, provider_profile_id) DO UPDATE SET
            credential_revision = credential_revision + 1,
            updated_at = excluded.updated_at
        `)
        .run(
          accountId,
          providerProfileId,
          Number(current.credential_version) + 1,
          timestamp,
        );
      const deleted = database
        .prepare(`
          DELETE FROM account_provider_credentials
          WHERE
            account_id = ?
            AND provider_profile_id = ?
            AND credential_version = ?
        `)
        .run(
          accountId,
          providerProfileId,
          current.credential_version,
        );
      if (deleted.changes !== 1) {
        throw new Error("平台密钥已变化，请重试");
      }
      database.exec("COMMIT");
      return true;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    lease?.release();
  }
}

export async function verifyAccountCredential(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
  fetcher?: typeof fetch,
): Promise<ProviderVerification & { keyStatus: AccountCredentialKeyStatus }> {
  // Avoid a needless remote probe when deletion already owns the account. The
  // authoritative check is repeated in the final write transaction below.
  assertAccountMutationAllowed(database, accountId);
  let profile = await getProviderProfile(providerProfileId);
  const hadDocumentProfile = Boolean(profile);
  if (!profile) {
    const metadataRow = database
      .prepare(`
        SELECT display_name, driver
        FROM provider_profiles
        WHERE id = ?
      `)
      .get(providerProfileId) as
      | { display_name: string; driver: string }
      | undefined;
    if (!metadataRow) throw new Error("平台连接不存在");
    const timestamp = new Date().toISOString();
    profile = {
      apiKey: "",
      baseUrl:
        metadataRow.driver === "openrouter"
          ? "https://openrouter.ai/api/v1"
          : metadataRow.driver === "mureka"
            ? "https://api.mureka.ai"
            : metadataRow.driver === "volcengine-ark"
              ? "https://ark.cn-beijing.volces.com/api/v3"
              : "https://example.invalid",
      createdAt: timestamp,
      driver: metadataRow.driver as ProviderProfile["driver"],
      id: providerProfileId,
      label: metadataRow.display_name,
      updatedAt: timestamp,
    };
  }
  const credential = accountCredentialRow(
    database,
    accountId,
    providerProfileId,
  );
  if (!credential) {
    throw new Error("未配置你的平台密钥");
  }
  const key = await decryptKey(credential).catch(() => undefined);
  if (!key) throw new Error("未配置你的平台密钥");
  const credentialVersion = Number(credential.credential_version);
  const record = async (keyStatus: AccountCredentialKeyStatus) => {
    const lease = hadDocumentProfile
      ? await acquireProviderCredentialMutationLease(providerProfileId)
      : undefined;
    try {
      if (
        lease &&
        (
          !lease.profile ||
          lease.profile.updatedAt !== profile.updatedAt ||
          lease.profile.driver !== profile.driver ||
          lease.profile.baseUrl !== profile.baseUrl ||
          lease.profile.configurationVersion !== profile.configurationVersion
        )
      ) {
        const error = new Error(
          "平台连接在验证期间已变化，请重新验证当前密钥",
        ) as Error & { code: string };
        error.code = "ACCOUNT_CREDENTIAL_CHANGED";
        throw error;
      }
      const timestamp = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        assertAccountMutationAllowed(database, accountId);
        const current = accountCredentialRow(
          database,
          accountId,
          providerProfileId,
        );
        if (
          !current ||
          Number(current.credential_version) !== credentialVersion
        ) {
          const error = new Error(
            "平台密钥在验证期间已变化，请重新验证当前密钥",
          ) as Error & { code: string };
          error.code = "ACCOUNT_CREDENTIAL_CHANGED";
          throw error;
        }
        const updated = database
          .prepare(`
            UPDATE account_provider_credentials
            SET key_status = ?, key_checked_at = ?, updated_at = ?
            WHERE
              account_id = ?
              AND provider_profile_id = ?
              AND credential_version = ?
          `)
          .run(
            keyStatus,
            timestamp,
            timestamp,
            accountId,
            providerProfileId,
            credentialVersion,
          );
        if (updated.changes !== 1) {
          const error = new Error(
            "平台密钥在验证期间已变化，请重新验证当前密钥",
          ) as Error & { code: string };
          error.code = "ACCOUNT_CREDENTIAL_CHANGED";
          throw error;
        }
        database.exec("COMMIT");
        return timestamp;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    } finally {
      lease?.release();
    }
  };
  try {
    const result = await probeProviderKey({ ...profile, apiKey: key }, fetcher);
    await record("valid");
    return { ...result, keyStatus: "valid" };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      error instanceof AccountMutationBlockedError ||
      code === "ACCOUNT_CREDENTIAL_CHANGED" ||
      code === "ACCOUNT_CREDENTIAL_IN_USE"
    ) {
      throw error;
    }
    const keyStatus: AccountCredentialKeyStatus =
      code === "AUTH" ? "invalid" : "unknown";
    await record(keyStatus);
    const verificationError = new Error(
      providerVerificationErrorMessage(error),
      { cause: error },
    ) as Error & { code?: string; keyStatus: AccountCredentialKeyStatus };
    if (typeof code === "string" && code) verificationError.code = code;
    verificationError.keyStatus = keyStatus;
    throw verificationError;
  }
}

/** 合成执行 profile：连接定义（全局）+ 当前账号自己的 key。 */
export async function composeExecutionProfile(
  database: DatabaseSync,
  accountId: string,
  profile: ProviderProfile,
): Promise<ProviderProfile> {
  const key = await accountCredentialKey(database, accountId, profile.id);
  if (!key) {
    const error = new Error("未配置你的平台密钥") as Error & {
      code: string;
    };
    error.code = "ACCOUNT_CREDENTIAL_MISSING";
    throw error;
  }
  return { ...profile, apiKey: key };
}
