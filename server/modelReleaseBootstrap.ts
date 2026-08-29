import type { DatabaseSync } from "node:sqlite";
import { selectActiveAdminAuditActorCommand } from "./accountTransactionCommands";
import { inImmediateTransaction } from "./audit";
import { openAppDatabase } from "./database";
import {
  cleanParameterSchema,
  knownModelParameterSchema,
  providerParameterSchema,
  validateParameterSchemaConstraints,
} from "../types/modelParameters";
import type { ProviderProtocol } from "../types/relayProtocols";
import type { GenerationCapabilityKind } from "../types/nodeVocabulary";
import { auditPublicTemplateCompatibility } from "./templateCompatibility";
import { publishedTemplateGraphs } from "./templateContractQueries";
import { parseTemplateGraph } from "./templateCatalog";
import { publishedModelReleaseSeeds } from "./modelCatalog";
import { publishedTemplateModelContracts } from "./modelCatalog";
import { modelReleaseDocumentForId } from "./modelReleaseDefaults";
import { assertRegisteredModelExecutionTotality } from
  "./modelExecutionRegistry";
import {
  markModelContractsRequired,
  modelContractState,
  publishModelContract,
  saveModelContractDraft,
  validateModelContractDraft,
} from "./modelReleaseRevisionStore";
import { executeTransactionScopedCommand } from "./transactionCommand";

type Row = {
  capability: GenerationCapabilityKind;
  default_parameters: string;
  id: string;
  provider_driver: string;
  provider_model_id: string;
  provider_profile_id: string;
  provider_protocol: ProviderProtocol;
};

function schema(row: Row) {
  const fallback = knownModelParameterSchema({
    capability: row.capability,
    providerDriver: row.provider_driver,
    providerModelId: row.provider_model_id,
  });
  const constraints = providerParameterSchema({
    capability: row.capability,
    providerDriver: row.provider_driver,
    providerModelId: row.provider_model_id,
  });
  return validateParameterSchemaConstraints(
    cleanParameterSchema(
      row.capability,
      JSON.parse(row.default_parameters),
      fallback,
    ),
    constraints,
  );
}

function templateImpact(
  store: DatabaseSync,
  modelId: string,
  proposedSchema: ReturnType<typeof schema>,
) {
  const rows = publishedTemplateGraphs(store);
  const templateIds: string[] = [];
  const incompatibleTemplateIds: string[] = [];
  const preexistingIncompatibleTemplateIds: string[] = [];
  const currentModels = publishedTemplateModelContracts(store);
  const proposedModels = currentModels.map((model) => model.id === modelId
    ? { ...model, parameterSchema: proposedSchema }
    : model);
  for (const row of rows) {
    if (!row.graph.includes(modelId)) continue;
    templateIds.push(row.id);
    try {
      const graph = parseTemplateGraph(row.graph);
      if (!graph) throw new Error("模板graph无效");
      const before = auditPublicTemplateCompatibility(store, graph, currentModels);
      const after = auditPublicTemplateCompatibility(store, graph, proposedModels);
      if (after.status !== "PASS" && before.status === "PASS") {
        incompatibleTemplateIds.push(row.id);
      } else if (after.status !== "PASS") {
        preexistingIncompatibleTemplateIds.push(row.id);
      }
    } catch {
      incompatibleTemplateIds.push(row.id);
    }
  }
  return {
    incompatibleTemplateIds,
    preexistingIncompatibleTemplateIds,
    templateIds,
  };
}

export function bootstrapPublishedModelContracts(
  store: DatabaseSync,
  actorUserId: string,
) {
  const rows = publishedModelReleaseSeeds(store) as Row[];
  const published = [];
  const skipped = [];
  for (const row of rows) {
    const document = modelReleaseDocumentForId({
      capability: row.capability,
      capabilitySchema: schema(row),
      modelId: row.id,
      providerDriver: row.provider_driver,
      providerModelId: row.provider_model_id,
      providerProfileId: row.provider_profile_id,
      providerProtocol: row.provider_protocol,
    });
    assertRegisteredModelExecutionTotality({
      capability: row.capability,
      capabilitySchema: document.capabilitySchema,
      providerDriver: row.provider_driver,
      providerModelId: row.provider_model_id,
      providerProtocol: row.provider_protocol,
    });
    const state = modelContractState(store, row.id);
    if (state.history.length) {
      // Existing immutable history does not exempt the currently published
      // catalog row from the same executable-totality gate as a first
      // bootstrap. This is validation-only: historical revisions stay intact.
      skipped.push(row.id);
      continue;
    }
    const draft = saveModelContractDraft(
      store,
      actorUserId,
      document,
      state.draftVersion,
    );
    const impact = templateImpact(store, row.id, document.capabilitySchema);
    validateModelContractDraft(
      store,
      actorUserId,
      row.id,
      draft.draftVersion,
      { impact },
    );
    const revision = publishModelContract(
      store,
      actorUserId,
      row.id,
      draft.draftVersion,
    );
    published.push({
      evidence: revision.document.evidence,
      modelId: row.id,
      revisionId: revision.revisionId,
      revisionNumber: revision.revisionNumber,
      runtime: revision.document.runtime,
    });
  }
  const modelIds = rows.map((row) => row.id);
  for (const row of rows) {
    const active = modelContractState(store, row.id).active;
    if (
      !active ||
      active.document.providerModelId !== row.provider_model_id ||
      active.document.providerProfileId !== row.provider_profile_id ||
      active.document.providerProtocol !== row.provider_protocol ||
      active.document.capability !== row.capability
    ) {
      throw new Error(`模型 ${row.id} 没有可激活的精确发布快照`);
    }
    assertRegisteredModelExecutionTotality({
      capability: row.capability,
      capabilitySchema: active.document.capabilitySchema,
      providerDriver: row.provider_driver,
      providerModelId: row.provider_model_id,
      providerProtocol: row.provider_protocol,
    });
  }
  const markedRequired = markModelContractsRequired(store, actorUserId, {
    modelIds,
    total: rows.length,
  });
  return {
    markedRequired,
    paidProviderRequests: 0 as const,
    published,
    skipped,
    total: rows.length,
  };
}

export function modelReleaseBootstrapActorUserId(store: DatabaseSync) {
  const actorUserId = inImmediateTransaction(store, () =>
    executeTransactionScopedCommand(
      store,
      selectActiveAdminAuditActorCommand,
      undefined,
    )
  );
  if (!actorUserId) {
    throw new Error("模型合同引导需要一个有效的活跃管理员审计身份");
  }
  return actorUserId;
}

export function runModelReleaseBootstrapCli() {
  const database = openAppDatabase();
  try {
    const result = bootstrapPublishedModelContracts(
      database,
      modelReleaseBootstrapActorUserId(database),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    database.close();
  }
}
