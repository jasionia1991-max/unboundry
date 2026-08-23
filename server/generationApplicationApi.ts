import { assertGenerationMediaDeletionAllowedInTransaction } from "./generationAttemptQueries";
import {
  adminGenerationSafetyApi,
  configureEmergencyStopRunningTaskPolicy,
} from "./generationSafety";
import {
  applyEmergencyStopRunningTaskPolicy,
  configureGenerationRuntimeAdapters,
  initializePersistentGenerationTaskWorker,
  prepareGenerationRuntimeRoleTeardown,
  registerGenerationRuntimeRoleCoordinator,
  generationTaskApplication,
  unregisterGenerationRuntimeRoleCoordinatorBeforeStartup,
} from "./generationTasks";
import { generationTasks } from "./generationTasksApi";
import { generationReadinessQuery } from "./generationReadinessQuery";

configureEmergencyStopRunningTaskPolicy(applyEmergencyStopRunningTaskPolicy);

async function imageToolGenerationCapabilityQuery(ownerId: string) {
  const [availability, model] = await Promise.all([
    generationTaskApplication.generationAvailability(ownerId),
    Promise.resolve(generationTaskApplication.resolveModel("image", undefined, ownerId)),
  ]);
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
  assertMediaDeletionAllowedInTransaction:
    assertGenerationMediaDeletionAllowedInTransaction,
  configureRuntimeAdapters: configureGenerationRuntimeAdapters,
  httpHandler: generationTasks,
  imageToolGenerationCapabilityQuery,
  initializePersistentWorker: initializePersistentGenerationTaskWorker,
  prepareRuntimeRoleTeardown: prepareGenerationRuntimeRoleTeardown,
  readinessQuery: generationReadinessQuery,
  registerRuntimeRoleCoordinator: registerGenerationRuntimeRoleCoordinator,
  unregisterRuntimeRoleCoordinatorBeforeStartup:
    unregisterGenerationRuntimeRoleCoordinatorBeforeStartup,
});
