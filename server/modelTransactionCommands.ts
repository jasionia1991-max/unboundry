import type { TransactionScopedCommand } from "./transactionCommand";

export const restoreImportedModelCommand: TransactionScopedCommand<Readonly<{
  modelId: string;
  status: string;
  timestamp: string;
}>, void> = {
  execute(scope, input) {
    scope.prepare(`
      UPDATE model_profiles
      SET archived_at = NULL, status = ?, updated_at = ?
      WHERE id = ?
    `).run(input.status, input.timestamp, input.modelId);
    scope.prepare(`
      UPDATE node_model_bindings
      SET enabled = 0, is_default = 0, updated_at = ?
      WHERE model_id = ?
    `).run(input.timestamp, input.modelId);
  },
};

export const importModelDraftCommand: TransactionScopedCommand<Readonly<{
  capability: string;
  costCurrency: string;
  defaultParameters: string;
  displayName: string;
  modelId: string;
  providerModelId: string;
  providerProfileId: string;
  providerProtocol: string;
  sortOrder: number;
  timestamp: string;
}>, void> = {
  execute(scope, input) {
    scope.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        provider_protocol, capability, status, default_parameters,
        cost_currency, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `).run(
      input.modelId,
      input.displayName,
      input.providerProfileId,
      input.providerModelId,
      input.providerProtocol,
      input.capability,
      input.defaultParameters,
      input.costCurrency,
      input.timestamp,
      input.timestamp,
    );
    scope.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      ) VALUES (?, ?, 0, 0, ?, ?, ?)
    `).run(
      input.capability,
      input.modelId,
      input.sortOrder,
      input.timestamp,
      input.timestamp,
    );
  },
};
