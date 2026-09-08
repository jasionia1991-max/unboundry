import type { TransactionScopedCommand } from "./transactionCommand";

export const recordCanvasOperationReuseAuditCommand:
  TransactionScopedCommand<Readonly<{
    details: string;
    ownerId: string;
    timestamp: string;
  }>, void> = {
    execute(scope, input) {
      scope.prepare(`
        INSERT INTO admin_audit_events (actor_user_id, action, details, created_at)
        VALUES (?, 'canvas.operation-reused', ?, ?)
      `).run(input.ownerId, input.details, input.timestamp);
    },
  };

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

/** Same-transaction guard for the admin-only generation maintenance commands. */
export const isActiveGenerationRecoveryAdminCommand:
  TransactionScopedCommand<string, boolean> = {
    execute(scope, actorId) {
      return Boolean(scope.prepare(`
        SELECT 1 FROM users
        WHERE id = ? AND role = 'admin' AND status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM account_delete_intents WHERE owner_id = users.id
          )
      `).get(actorId));
    },
  };

/** Fixed recovery namespace only; the general audit reader remains unchanged. */
export const readGenerationRecoveryAuditCommand: TransactionScopedCommand<string,
  readonly Readonly<{ id: number; action: string; actor: string; createdAt: string }>[]> = {
  execute(scope, taskId) {
    const rows = scope.prepare(`SELECT audit.id, audit.action, audit.created_at,
        COALESCE(users.display_name, '原管理员') AS actor
      FROM admin_audit_events AS audit LEFT JOIN users ON users.id = audit.actor_user_id
      WHERE audit.action IN ('generation_recovery.case_acknowledged','generation_recovery.case_checked',
        'generation_recovery.case_claimed','generation_recovery.case_closed','generation_recovery.case_opened',
        'generation_recovery.case_progressed','generation_recovery.original_attach_provider_task',
        'generation_recovery.original_resume','generation_recovery.original_result_admit','generation_recovery.original_settlement')
        AND CASE WHEN json_valid(audit.details) THEN json_extract(audit.details, '$.taskId') END = ?
      ORDER BY audit.id DESC LIMIT 50`).all(taskId) as Array<{
        id: number; action: string; actor: string; created_at: string;
      }>;
    return rows.map((row) => ({ id: Number(row.id), action: row.action,
      actor: row.actor.slice(0, 80), createdAt: row.created_at }));
  },
};
