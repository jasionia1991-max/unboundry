import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { accountAllowsDurableMediaReferenceCommand } from "./accountTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";

export type OriginalRecoveryReadFence = Readonly<{ taskId: string; fingerprint: string }>;
/** Internal concurrency receipt only. A fingerprint is never Provider proof. */
export function captureOriginalRecoveryReadFence(database: DatabaseSync, taskId: string): OriginalRecoveryReadFence {
  const ownsSnapshot = !database.isTransaction;
  if (ownsSnapshot) database.exec("BEGIN");
  try {
    const task = database.prepare("SELECT * FROM generation_tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error("Original recovery task unavailable");
    const attempts = database.prepare("SELECT * FROM generation_provider_attempts WHERE task_id = ? ORDER BY id").all(taskId);
    const event = database.prepare("SELECT COALESCE(MAX(id),0) AS id FROM generation_task_events WHERE task_id = ?").get(taskId);
    const value = { taskId, fingerprint: createHash("sha256").update(JSON.stringify({ task, attempts, event })).digest("hex") };
    if (ownsSnapshot) database.exec("COMMIT");
    return value;
  } catch (error) { if (ownsSnapshot && database.isTransaction) database.exec("ROLLBACK"); throw error; }
}
export function assertOriginalRecoveryReadFence(database: DatabaseSync, expected: OriginalRecoveryReadFence) {
  if (!database.isTransaction) throw new Error("Recovery fence requires a transaction");
  const task = database.prepare("SELECT owner_id FROM generation_tasks WHERE id = ?").get(expected.taskId) as { owner_id: string } | undefined;
  if (!task?.owner_id || !executeTransactionScopedCommand(database,
    accountAllowsDurableMediaReferenceCommand, task.owner_id) ||
    captureOriginalRecoveryReadFence(database, expected.taskId).fingerprint !== expected.fingerprint) {
    throw new Error("Original recovery evidence changed concurrently");
  }
}
