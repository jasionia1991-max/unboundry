import type { DatabaseSync } from "node:sqlite";
import type { NodeInputKind } from "../types/nodeInputs";
import {
  readHistoricalGenerationProviderAttemptCommand,
  type HistoricalGenerationProviderAttemptRow,
} from "./generationAttemptQueries";
import { executeTransactionScopedCommand } from "./transactionCommand";

export type WorkflowGenerationTaskNotice = Readonly<{
  errorCode:
    | "AUTOMATIC_RECOVERY_PENDING"
    | "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED"
    | "AUTOMATIC_RESULT_RECOVERY";
  errorMessage: string;
  updatedAt: string;
}>;

type WorkflowGenerationTaskNoticeRow = Readonly<{
  canvas_id: string;
  error_code: string | null;
  error_message: string | null;
  id: string;
  kind: NodeInputKind;
  node_id: string;
  owner_id: string | null;
  provider_task_id: string | null;
  state: string;
  updated_at: string;
}>;

const workflowGenerationTaskNoticeSql = `
  SELECT id, owner_id, canvas_id, node_id, kind, state,
         provider_task_id, error_code, error_message, updated_at
  FROM generation_tasks
  WHERE id = ?
`;

function toWorkflowGenerationTaskNotice(
  row: WorkflowGenerationTaskNoticeRow | undefined,
  input: Readonly<{
    canvasId: string;
    kind: NodeInputKind;
    nodeId: string;
    ownerId: string;
  }>,
): WorkflowGenerationTaskNotice | undefined {
  if (!row || row.owner_id !== input.ownerId || row.canvas_id !== input.canvasId ||
      row.node_id !== input.nodeId || row.kind !== input.kind ||
      row.state !== "recovering" || typeof row.provider_task_id !== "string" ||
      row.provider_task_id.length < 1 || typeof row.updated_at !== "string" ||
      !Number.isFinite(Date.parse(row.updated_at))) return undefined;
  const pending = row.error_code === "AUTOMATIC_RECOVERY_PENDING";
  const exhausted = row.error_code === "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED";
  return Object.freeze({
    errorCode: pending
      ? "AUTOMATIC_RECOVERY_PENDING"
      : exhausted
        ? "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED"
        : "AUTOMATIC_RESULT_RECOVERY",
    errorMessage: pending
      ? "恢复所需的原始期限证据不完整，系统会保留原请求，等待后续处理；不会重复提交付费请求"
      : row.error_message?.trim() || (exhausted
        ? "原请求记录已保留，等待后续处理；不会重复付费提交"
        : "系统正在自动找回平台结果；不会重复付费提交"),
    updatedAt: row.updated_at,
  });
}

const readWorkflowGenerationTaskNoticeCommand = {
  execute(scope: { prepare: DatabaseSync["prepare"] }, input: Readonly<{
    canvasId: string;
    kind: NodeInputKind;
    nodeId: string;
    ownerId: string;
    taskId: string;
  }>) {
    const row = scope.prepare(workflowGenerationTaskNoticeSql).get(input.taskId) as
      | WorkflowGenerationTaskNoticeRow
      | undefined;
    return toWorkflowGenerationTaskNotice(row, input);
  },
};

/**
 * Generation-owned read port for the workflow summary.  It exposes only a
 * qualified recovering marker; workflow code cannot turn an unrelated task,
 * a terminal failure, or a mismatched owner/node into a UI notice.
 */
export function readWorkflowGenerationTaskNoticeInTransaction(
  database: DatabaseSync,
  input: Readonly<{
    canvasId: string;
    kind: NodeInputKind;
    nodeId: string;
    ownerId: string;
    taskId: string;
  }>,
): WorkflowGenerationTaskNotice | undefined {
  return executeTransactionScopedCommand(
    database,
    readWorkflowGenerationTaskNoticeCommand,
    input,
  );
}

/** Read the same notice for immediate responses produced after COMMIT. */
export function readWorkflowGenerationTaskNotice(
  database: DatabaseSync,
  input: Readonly<{
    canvasId: string;
    kind: NodeInputKind;
    nodeId: string;
    ownerId: string;
    taskId: string;
  }>,
): WorkflowGenerationTaskNotice | undefined {
  if (database.isTransaction) {
    return readWorkflowGenerationTaskNoticeInTransaction(database, input);
  }
  const row = database.prepare(workflowGenerationTaskNoticeSql).get(input.taskId) as
    | WorkflowGenerationTaskNoticeRow
    | undefined;
  return toWorkflowGenerationTaskNotice(row, input);
}

/**
 * Public generation-domain port for workflow evidence.  The SQL remains in
 * generationAttemptQueries; workflow code receives only this exact row from
 * the caller-owned transaction and cannot select another attempt implicitly.
 */
export function readHistoricalGenerationProviderAttemptInTransaction(
  database: DatabaseSync,
  input: Readonly<{ executionAttempt: number; taskId: string }>,
): HistoricalGenerationProviderAttemptRow | undefined {
  return executeTransactionScopedCommand(
    database,
    readHistoricalGenerationProviderAttemptCommand,
    input,
  );
}
