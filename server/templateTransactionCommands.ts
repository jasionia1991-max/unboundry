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
