import type { TransactionScopedCommand } from "./transactionCommand";

export type TerminalGenerationTaskBinding = Readonly<{
  canvasId: string;
  generationIdentityVersion?: 2;
  kind: "audio" | "image" | "text" | "video";
  nodeId: string;
  ownerId: string;
  resultAssetId: string | null;
  resultText: string | null;
  state: "cancelled" | "failed" | "success";
  taskId: string;
}>;

export type FailedCancelledGenerationTaskBinding = Readonly<{
  kind: TerminalGenerationTaskBinding["kind"];
  nodeId: string;
  state: "cancelled" | "failed";
  taskId: string;
}>;

export type CanvasRouteGenerationEvidence = Readonly<{
  dangerousAttempt: boolean;
  generationIdentityVersion: 2 | null;
  state: string;
}>;

/**
 * Supplies server-owned generation evidence to Canvas compatibility routes
 * without letting the Canvas domain query generation tables directly.
 */
export const readCanvasRouteGenerationEvidenceCommand:
TransactionScopedCommand<Readonly<{
  canvasId: string;
  kind: TerminalGenerationTaskBinding["kind"];
  nodeId: string;
  ownerId: string;
  taskId: string;
}>, CanvasRouteGenerationEvidence | undefined> = {
  execute(scope, input) {
    const row = scope.prepare(`
      SELECT
        state,
        CASE
          WHEN json_valid(model_configuration)
            AND json_extract(model_configuration, '$.generationIdentityVersion') = 2
          THEN 2 ELSE NULL
        END AS generationIdentityVersion
      FROM generation_tasks
      WHERE id = ? AND owner_id = ? AND canvas_id = ? AND node_id = ?
        AND kind = ?
      LIMIT 1
    `).get(
      input.taskId,
      input.ownerId,
      input.canvasId,
      input.nodeId,
      input.kind,
    ) as {
      generationIdentityVersion: 2 | null;
      state: string;
    } | undefined;
    if (!row) return undefined;
    const dangerousAttempt = Boolean(scope.prepare(`
      SELECT 1 FROM generation_provider_attempts
      WHERE task_id = ? AND outcome IN (
        'boundary-claimed', 'accepted', 'response-received', 'outcome-unknown'
      )
      LIMIT 1
    `).get(input.taskId));
    return { ...row, dangerousAttempt };
  },
};

export const listFailedCancelledGenerationTaskBindingsCommand:
TransactionScopedCommand<Readonly<{
  canvasId: string;
  ownerId: string;
}>, FailedCancelledGenerationTaskBinding[]> = {
  execute(scope, input) {
    return scope.prepare(`
      SELECT tasks.id AS taskId, tasks.node_id AS nodeId,
             tasks.kind, tasks.state
      FROM generation_tasks AS tasks
      WHERE tasks.owner_id = ? AND tasks.canvas_id = ?
        AND COALESCE(
          json_extract(tasks.model_configuration, '$.generationIdentityVersion'),
          0
        ) <> 2
        AND tasks.state IN ('failed', 'cancelled')
        AND tasks.provider_task_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM generation_provider_attempts AS attempt
          WHERE attempt.task_id = tasks.id
            AND attempt.outcome IN (
              'boundary-claimed', 'accepted', 'response-received',
              'outcome-unknown'
            )
        )
      ORDER BY tasks.created_at ASC, tasks.id ASC
    `).all(input.ownerId, input.canvasId) as FailedCancelledGenerationTaskBinding[];
  },
};

export const readTerminalGenerationTaskBindingCommand: TransactionScopedCommand<Readonly<{
  canvasId: string;
  kind: TerminalGenerationTaskBinding["kind"];
  nodeId: string;
  ownerId: string;
  taskId: string;
}>, TerminalGenerationTaskBinding | undefined> = {
  execute(scope, input) {
    const row = scope.prepare(`
      SELECT
        canvas_id AS canvasId,
        CASE
          WHEN json_extract(model_configuration, '$.generationIdentityVersion') = 2
          THEN 2 ELSE NULL
        END AS generationIdentityVersion,
        kind,
        node_id AS nodeId,
        owner_id AS ownerId,
        result_asset_id AS resultAssetId,
        result_text AS resultText,
        state,
        id AS taskId
      FROM generation_tasks
      WHERE id = ? AND owner_id = ? AND canvas_id = ? AND node_id = ?
        AND kind = ? AND state IN ('success', 'failed', 'cancelled')
      LIMIT 1
    `).get(
      input.taskId,
      input.ownerId,
      input.canvasId,
      input.nodeId,
      input.kind,
    ) as TerminalGenerationTaskBinding | undefined;
    return row;
  },
};

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
