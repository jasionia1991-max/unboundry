import type { TransactionScopedCommand } from "./transactionCommand";

export const transferAndDeleteAccountTemplatesCommand: TransactionScopedCommand<Readonly<{
  ownerId: string;
  rootOwnerId: string;
}>, number> = {
  execute(scope, input) {
    const transferred = scope.prepare(`
      UPDATE public_templates
      SET created_by = CASE WHEN created_by = ? THEN ? ELSE created_by END,
          updated_by = CASE WHEN updated_by = ? THEN ? ELSE updated_by END
      WHERE created_by = ? OR updated_by = ?
    `).run(
      input.ownerId,
      input.rootOwnerId,
      input.ownerId,
      input.rootOwnerId,
      input.ownerId,
      input.ownerId,
    );
    scope.prepare("DELETE FROM user_templates WHERE owner_id = ?").run(input.ownerId);
    return Number(transferred.changes);
  },
};

export const migratePublishedTemplateGraphsCommand: TransactionScopedCommand<Readonly<{
  migrations: readonly Readonly<{
    afterGraph: string;
    beforeGraph: string;
    templateId: string;
  }>[];
}>, number> = {
  execute(scope, input) {
    let migrated = 0;
    for (const migration of input.migrations) {
      const updated = scope.prepare(`
        UPDATE public_templates SET graph = ?
        WHERE id = ? AND graph = ? AND status = 'published'
      `).run(
        migration.afterGraph,
        migration.templateId,
        migration.beforeGraph,
      );
      if (updated.changes !== 1) {
        throw new Error("发布模板迁移CAS失败，升级已阻断");
      }
      migrated += 1;
    }
    return migrated;
  },
};
