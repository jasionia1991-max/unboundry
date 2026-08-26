import type { DatabaseSync } from "node:sqlite";

export type AuditEvent = Readonly<{
  action: string;
  actorUserId: string;
  createdAt: string;
  details: Record<string, unknown>;
  id: number;
  targetUserId?: string;
}>;

function parseDetails(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function recordAudit(
  store: DatabaseSync,
  actorUserId: string,
  action: string,
  targetUserId: string | null,
  details: Record<string, unknown>,
) {
  return Number(store
    .prepare(`
      INSERT INTO admin_audit_events (
        actor_user_id, action, target_user_id, details, created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      actorUserId,
      action,
      targetUserId,
      JSON.stringify(details),
      new Date().toISOString(),
    ).lastInsertRowid);
}

/**
 * Audit-backed immutable records used by governance features that must remain
 * deployable on schema 41. Callers own the action namespace and validate every
 * details document before using it as executable configuration.
 */
export function auditEvents(
  store: DatabaseSync,
  actions: readonly string[],
): AuditEvent[] {
  if (!actions.length || actions.some((action) =>
    !/^model_contract\.[a-z_]{2,40}$/.test(action)
  )) throw new Error("审计事件action不受支持");
  const placeholders = actions.map(() => "?").join(", ");
  const rows = store.prepare(`
    SELECT id, actor_user_id, action, target_user_id, details, created_at
    FROM admin_audit_events
    WHERE action IN (${placeholders})
    ORDER BY id
  `).all(...actions) as Array<{
    action: string;
    actor_user_id: string;
    created_at: string;
    details: string;
    id: number;
    target_user_id: string | null;
  }>;
  return rows.map((row) => ({
    action: row.action,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    details: parseDetails(row.details),
    id: Number(row.id),
    ...(row.target_user_id ? { targetUserId: row.target_user_id } : {}),
  }));
}

export function inImmediateTransaction<T>(
  store: DatabaseSync,
  operation: () => T,
) {
  store.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    store.exec("COMMIT");
    return result;
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
}
