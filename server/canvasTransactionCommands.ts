import type { TransactionScopedCommand } from "./transactionCommand";

export type MediaHistoryIdentity = Readonly<{
  assetId: string;
  kind: string;
  ownerId: string;
}>;

export const deleteMediaHistoryCommand: TransactionScopedCommand<
  MediaHistoryIdentity,
  number
> = {
  execute(scope, input) {
    return Number(scope.prepare(`
      DELETE FROM asset_history
      WHERE account_id = ? AND owner_id = ? AND id = ? AND kind = ?
    `).run(input.ownerId, input.ownerId, input.assetId, input.kind).changes);
  },
};

export const upsertMediaHistoryCommand: TransactionScopedCommand<Readonly<{
  assetId: string;
  createdAt: string;
  kind: "audio" | "image" | "video";
  label: string;
  ownerId: string;
  preview: string;
}>, void> = {
  execute(scope, input) {
    scope.prepare(`
      INSERT INTO asset_history (
        account_id, id, kind, label, preview, created_at, owner_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET
        kind = excluded.kind, label = excluded.label,
        preview = excluded.preview, owner_id = excluded.owner_id
    `).run(
      input.ownerId,
      input.assetId,
      input.kind,
      input.label,
      input.preview,
      input.createdAt,
      input.ownerId,
    );
  },
};

export const deleteProjectCanvasDocumentsCommand: TransactionScopedCommand<Readonly<{
  bypass: boolean;
  canvasId: string;
  ownerId: string;
}>, number> = {
  execute(scope, input) {
    return Number((input.bypass
      ? scope.prepare("DELETE FROM canvas_documents WHERE id = ?")
        .run(input.canvasId)
      : scope.prepare("DELETE FROM canvas_documents WHERE owner_id = ? AND id = ?")
        .run(input.ownerId, input.canvasId)).changes);
  },
};

export const deleteAccountCanvasDataCommand: TransactionScopedCommand<string, void> = {
  execute(scope, ownerId) {
    scope.prepare("DELETE FROM canvas_documents WHERE owner_id = ?").run(ownerId);
    scope.prepare(`
      DELETE FROM asset_history WHERE owner_id = ? OR account_id = ?
    `).run(ownerId, ownerId);
  },
};

export const deleteAccountHistoryCommand: TransactionScopedCommand<string, void> = {
  execute(scope, ownerId) {
    scope.prepare(`
      DELETE FROM asset_history WHERE owner_id = ? OR account_id = ?
    `).run(ownerId, ownerId);
  },
};

export const claimLegacyCanvasDataCommand: TransactionScopedCommand<string, void> = {
  execute(scope, ownerId) {
    scope.prepare("UPDATE canvas_documents SET owner_id = ? WHERE owner_id IS NULL")
      .run(ownerId);
    scope.prepare("UPDATE asset_history SET owner_id = ? WHERE owner_id IS NULL")
      .run(ownerId);
  },
};

export const createProjectCanvasDocumentCommand: TransactionScopedCommand<Readonly<{
  canvasId: string;
  edges: string;
  nodes: string;
  ownerId: string;
  updatedAt: string;
  viewport: string;
}>, void> = {
  execute(scope, input) {
    scope.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_sequence
      ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, 0)
    `).run(
      input.ownerId,
      input.canvasId,
      input.nodes,
      input.edges,
      input.viewport,
      input.updatedAt,
    );
  },
};
