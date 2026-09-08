import { configureGenerationRecoveryCasePorts, generationRecoveryCasesHandlers } from "./generationRecoveryCaseApplication";
import { generationRecoveryInspectionActive, inspectGenerationRecoveryCase } from "./generationRecoveryCaseWorker";
import { assertGenerationMediaDeletionAllowedInTransaction } from "./generationAttemptQueries";
import {
  adminGenerationSafetyApi,
  configureEmergencyStopRunningTaskPolicy,
} from "./generationSafety";
import {
  applyEmergencyStopRunningTaskPolicy,
  configureGenerationRuntimeAdapters,
  initializePersistentGenerationTaskWorker,
  registerGenerationTaskSettlementObserver,
  prepareGenerationRuntimeRoleTeardown,
  registerGenerationRuntimeRoleCoordinator,
  generationTaskApplication,
  unregisterGenerationRuntimeRoleCoordinatorBeforeStartup,
} from "./generationTasks";
import { generationTasks } from "./generationTasksApi";
import { generationReadinessQuery } from "./generationReadinessQuery";
import { workflowRunsApi } from "./workflowRunsApi";
import { workflowRunApplication } from "./workflowRunService";

configureEmergencyStopRunningTaskPolicy(applyEmergencyStopRunningTaskPolicy);
configureGenerationRecoveryCasePorts({
  frozen: () => {
    const safety = generationTaskApplication.generationSafetyStatus();
    return !safety.globalEnabled || safety.emergencyStop;
  },
  inspecting: (taskId) => generationRecoveryInspectionActive(taskId) || generationTaskApplication.recoveryActive(taskId),
  inspect: inspectGenerationRecoveryCase,
});

async function imageToolGenerationCapabilityQuery(ownerId: string) {
  const { availability, model } = await generationTaskApplication.imageToolAvailability(ownerId);
  const safety = generationTaskApplication.generationSafetyStatus();
  return {
    configured: availability.imageProviderConfigured,
    emergencyStop: safety.emergencyStop,
    globalEnabled: safety.globalEnabled,
    ...(model
      ? {
          maxCostMicrounits: model.max_cost_microunits,
          modelId: model.id,
          providerDriver: model.provider_driver,
          providerModelId: model.provider_model_id,
          providerProtocol: model.provider_protocol ?? "native",
        }
      : {}),
  };
}

export const generationApplicationApi = Object.freeze({
  adminGenerationSafetyApi,
  adminGenerationRecoveryApi: generationRecoveryCasesHandlers.admin,
  ownerGenerationRecoveryApi: generationRecoveryCasesHandlers.owner,
  assertMediaDeletionAllowedInTransaction:
    assertGenerationMediaDeletionAllowedInTransaction,
  configureRuntimeAdapters: configureGenerationRuntimeAdapters,
  httpHandler: generationTasks,
  workflowHttpHandler: workflowRunsApi,
  workflowRuns: workflowRunApplication,
  imageToolGenerationCapabilityQuery,
  initializePersistentWorker: async () => {
    registerGenerationTaskSettlementObserver(() => workflowRunApplication.kick());
    workflowRunApplication.initialize();
    const generation = await initializePersistentGenerationTaskWorker();
    return generation;
  },
  prepareRuntimeRoleTeardown: (coordinator: Parameters<
    typeof prepareGenerationRuntimeRoleTeardown
  >[0]) => {
    registerGenerationTaskSettlementObserver(undefined);
    workflowRunApplication.stopRunner();
    return prepareGenerationRuntimeRoleTeardown(coordinator);
  },
  readinessQuery: generationReadinessQuery,
  registerRuntimeRoleCoordinator: registerGenerationRuntimeRoleCoordinator,
  unregisterRuntimeRoleCoordinatorBeforeStartup:
    unregisterGenerationRuntimeRoleCoordinatorBeforeStartup,
});
