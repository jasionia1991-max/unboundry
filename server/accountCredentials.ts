import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  getProviderProfile,
  probeProviderKey,
  providerVerificationErrorMessage,
  type ProviderProfile,
  type ProviderVerification,
} from "./providerProfiles";
import { secretStoreEncryptionKey } from "./secretStore";

const associatedData = Buffer.from("tapnow:account-credentials:v1", "utf8");

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

export function accountCredentialMaskFromKey(apiKey: string) {
  return apiKey.length >= 4 ? `••••${apiKey.slice(-4)}` : "••••";
}

export async function saveAccountCredential(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
  apiKey: string,
) {
  const profile = await getProviderProfile(providerProfileId);
  const metadataRow = database
    .prepare("SELECT 1 FROM provider_profiles WHERE id = ?")
    .get(providerProfileId);
  if (!profile && !metadataRow) throw new Error("平台连接不存在");
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (key.length < 8 || /\s/.test(key)) {
    throw new Error("API Key 无效");
  }
  const current = accountCredentialRow(database, accountId, providerProfileId);
  const credentialVersion = Math.max(
    1,
    Number(current?.credential_version ?? 0) + 1,
  );
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
  return {
    credentialVersion,
    keyStatus: "unchecked" as const,
    mask: accountCredentialMaskFromKey(key),
    updatedAt: timestamp,
  };
}

export function deleteAccountCredential(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
) {
  const result = database
    .prepare(`
      DELETE FROM account_provider_credentials
      WHERE account_id = ? AND provider_profile_id = ?
    `)
    .run(accountId, providerProfileId);
  return result.changes === 1;
}

export async function verifyAccountCredential(
  database: DatabaseSync,
  accountId: string,
  providerProfileId: string,
  fetcher?: typeof fetch,
): Promise<ProviderVerification & { keyStatus: AccountCredentialKeyStatus }> {
  let profile = await getProviderProfile(providerProfileId);
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
  const key = await accountCredentialKey(database, accountId, providerProfileId);
  if (!key) {
    throw new Error("未配置你的平台密钥");
  }
  const record = (keyStatus: AccountCredentialKeyStatus) => {
    const timestamp = new Date().toISOString();
    database
      .prepare(`
        UPDATE account_provider_credentials
        SET key_status = ?, key_checked_at = ?, updated_at = ?
        WHERE account_id = ? AND provider_profile_id = ?
      `)
      .run(keyStatus, timestamp, timestamp, accountId, providerProfileId);
    return timestamp;
  };
  try {
    const result = await probeProviderKey({ ...profile, apiKey: key }, fetcher);
    record("valid");
    return { ...result, keyStatus: "valid" };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const keyStatus: AccountCredentialKeyStatus =
      code === "AUTH" || code === "PERMISSION" ? "invalid" : "unknown";
    record(keyStatus);
    throw new Error(providerVerificationErrorMessage(error));
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
