import type { OriginalRecoveryRelatedLedgerReader } from "./generationRecoveryOriginalCommands";
import { readGenerationRecoveryCanvasCommand } from "./canvasTransactionCommands";
import { readGenerationRecoveryMediaCommand } from "./mediaTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";

export const readOriginalGenerationRecoveryLedgers: OriginalRecoveryRelatedLedgerReader = (database, input) => {
  if (!database.isTransaction) throw new Error("Original recovery requires a consistent ledger snapshot");
  const task = database.prepare("SELECT result_asset_id FROM generation_tasks WHERE id = ? AND owner_id = ?")
    .get(input.taskId, input.ownerId) as { result_asset_id: string | null } | undefined;
  const canvas = executeTransactionScopedCommand(database, readGenerationRecoveryCanvasCommand, input);
  const media = executeTransactionScopedCommand(database, readGenerationRecoveryMediaCommand,
    { taskId: input.taskId, ownerId: input.ownerId, resultAssetId: task?.result_asset_id ?? undefined });
  const projectionStates = database.prepare(`SELECT * FROM generation_canvas_projection_states
    WHERE task_id = ? ORDER BY task_id LIMIT 257`).all(input.taskId) as Record<string, unknown>[];
  if (projectionStates.length > 256) throw new Error("Original recovery projection ledger exceeds its safe bound");
  return { ...canvas, ...media, projectionStates };
};
