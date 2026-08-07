import type { DatabaseSync } from "node:sqlite";

export function recordAudit(
  store: DatabaseSync,
  actorUserId: string,
  action: string,
  targetUserId: string | null,
  details: Record<string, unknown>,
) {
  store
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
    );
}
