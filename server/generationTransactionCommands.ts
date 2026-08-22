import type { TransactionScopedCommand } from "./transactionCommand";

export const detachUnpublishedGenerationAssetCommand: TransactionScopedCommand<Readonly<{
  assetId: string;
  kind: "audio" | "image" | "video";
  ownerId: string;
  updatedAt: string;
}>, number> = {
  execute(scope, input) {
    return Number(scope.prepare(`
      UPDATE generation_tasks
      SET result_asset_id = NULL, updated_at = ?
      WHERE owner_id = ? AND kind = ? AND result_asset_id = ?
        AND state <> 'success'
    `).run(input.updatedAt, input.ownerId, input.kind, input.assetId).changes);
  },
};

export const deleteProjectGenerationDataCommand: TransactionScopedCommand<Readonly<{
  bypass: boolean;
  canvasId: string;
  ownerId: string;
}>, void> = {
  execute(scope, input) {
    if (input.bypass) {
      scope.prepare(`
        DELETE FROM generation_provider_attempts
        WHERE task_id IN (SELECT id FROM generation_tasks WHERE canvas_id = ?)
      `).run(input.canvasId);
      scope.prepare(`
        DELETE FROM generation_task_events
        WHERE task_id IN (SELECT id FROM generation_tasks WHERE canvas_id = ?)
      `).run(input.canvasId);
      scope.prepare("DELETE FROM generation_tasks WHERE canvas_id = ?")
        .run(input.canvasId);
      return;
    }
    scope.prepare(`
      DELETE FROM generation_provider_attempts
      WHERE task_id IN (
        SELECT id FROM generation_tasks WHERE owner_id = ? AND canvas_id = ?
      )
    `).run(input.ownerId, input.canvasId);
    scope.prepare(`
      DELETE FROM generation_task_events
      WHERE task_id IN (
        SELECT id FROM generation_tasks WHERE owner_id = ? AND canvas_id = ?
      )
    `).run(input.ownerId, input.canvasId);
    scope.prepare(`
      DELETE FROM generation_tasks WHERE owner_id = ? AND canvas_id = ?
    `).run(input.ownerId, input.canvasId);
  },
};

export const deleteAccountGenerationDataCommand: TransactionScopedCommand<string, void> = {
  execute(scope, ownerId) {
    scope.prepare(`
      DELETE FROM generation_provider_attempts
      WHERE task_id IN (SELECT id FROM generation_tasks WHERE owner_id = ?)
    `).run(ownerId);
    scope.prepare(`
      DELETE FROM generation_task_events
      WHERE task_id IN (SELECT id FROM generation_tasks WHERE owner_id = ?)
    `).run(ownerId);
    scope.prepare(`
      DELETE FROM generation_admission_events
      WHERE task_id IN (SELECT id FROM generation_tasks WHERE owner_id = ?)
    `).run(ownerId);
    scope.prepare("DELETE FROM generation_tasks WHERE owner_id = ?").run(ownerId);
  },
};

export const claimLegacyGenerationDataCommand: TransactionScopedCommand<string, void> = {
  execute(scope, ownerId) {
    scope.prepare("UPDATE generation_tasks SET owner_id = ? WHERE owner_id IS NULL")
      .run(ownerId);
  },
};
