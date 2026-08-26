import type { TransactionScopedCommand } from "./transactionCommand";

export const selectActiveAdminAuditActorCommand:
  TransactionScopedCommand<void, string | undefined> = {
    execute(scope) {
      const row = scope.prepare(`
        SELECT id
        FROM users
        WHERE role = 'admin' AND status = 'active'
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `).get() as { id?: unknown } | undefined;
      return typeof row?.id === "string" && row.id ? row.id : undefined;
    },
  };

export const accountAllowsDurableMediaReferenceCommand:
  TransactionScopedCommand<string, boolean> = {
    execute(scope, ownerId) {
      return Boolean(scope.prepare(`
        SELECT 1 FROM users
        WHERE id = ? AND status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM account_delete_intents
            WHERE owner_id = users.id
          )
      `).get(ownerId));
    },
  };

export const migrateLegacyAccountCredentialsCommand: TransactionScopedCommand<Readonly<{
  admins: readonly Readonly<{ id: string }>[];
  payloads: readonly Readonly<{ encrypted: string; profileId: string }>[];
  timestamp: string;
}>, void> = {
  execute(scope, input) {
    const insert = scope.prepare(`
      INSERT OR IGNORE INTO account_provider_credentials (
        account_id, provider_profile_id, encrypted_key, key_status,
        key_checked_at, credential_version, updated_at
      )
      SELECT id, ?, ?, 'unchecked', NULL, 1, ?
      FROM users
      WHERE id = ? AND role = 'admin' AND status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM account_delete_intents WHERE owner_id = users.id
        )
    `);
    const insertEpoch = scope.prepare(`
      INSERT OR IGNORE INTO account_provider_credential_epochs (
        account_id, provider_profile_id, credential_revision, updated_at
      )
      SELECT account_id, provider_profile_id, credential_version, updated_at
      FROM account_provider_credentials
      WHERE account_id = ? AND provider_profile_id = ?
    `);
    for (const payload of input.payloads) {
      for (const admin of input.admins) {
        insert.run(payload.profileId, payload.encrypted, input.timestamp, admin.id);
        insertEpoch.run(admin.id, payload.profileId);
      }
    }
  },
};
