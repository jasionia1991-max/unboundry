import type { TransactionScopedCommand } from "./transactionCommand";

export const touchProjectUpdatedAtCommand: TransactionScopedCommand<Readonly<{
  bypass: boolean;
  canvasId: string;
  ownerId: string;
  updatedAt: number;
}>, void> = {
  execute(scope, input) {
    if (input.bypass) {
      scope.prepare(`
        UPDATE project_metadata
        SET updated_at = MAX(updated_at, ?)
        WHERE id = ? AND is_project = 1 AND deleted_at IS NULL
      `).run(input.updatedAt, input.canvasId);
      return;
    }
    scope.prepare(`
      UPDATE project_metadata
      SET updated_at = MAX(updated_at, ?)
      WHERE owner_id = ? AND id = ? AND is_project = 1 AND deleted_at IS NULL
    `).run(input.updatedAt, input.ownerId, input.canvasId);
  },
};

export const deleteAccountProjectDataCommand: TransactionScopedCommand<string, void> = {
  execute(scope, ownerId) {
    scope.prepare("DELETE FROM project_metadata WHERE owner_id = ?").run(ownerId);
  },
};

export const claimLegacyProjectDataCommand: TransactionScopedCommand<string, void> = {
  execute(scope, ownerId) {
    scope.prepare("UPDATE project_metadata SET owner_id = ? WHERE owner_id IS NULL")
      .run(ownerId);
  },
};

export const deleteProjectMetadataCommand: TransactionScopedCommand<Readonly<{
  bypass: boolean;
  canvasId: string;
  ownerId: string;
}>, number> = {
  execute(scope, input) {
    return Number((input.bypass
      ? scope.prepare("DELETE FROM project_metadata WHERE id = ?").run(input.canvasId)
      : scope.prepare("DELETE FROM project_metadata WHERE owner_id = ? AND id = ?")
        .run(input.ownerId, input.canvasId)).changes);
  },
};

export const upsertProjectTitleCommand: TransactionScopedCommand<Readonly<{
  canvasId: string;
  ownerId: string;
  title: string;
  updatedAt: number;
}>, number> = {
  execute(scope, input) {
    return Number(scope.prepare(`
      INSERT INTO project_metadata (owner_id, id, title, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_id, id) DO UPDATE SET
        title = excluded.title,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at > project_metadata.updated_at
        OR (
          excluded.updated_at = project_metadata.updated_at
          AND excluded.title = project_metadata.title
        )
    `).run(input.ownerId, input.canvasId, input.title, input.updatedAt).changes);
  },
};
