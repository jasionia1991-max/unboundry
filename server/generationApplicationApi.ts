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
  unregisterGenerationRuntimeRoleCoordinatorBeforeStartup,
} from "./generationTasks";
import { generationTasks } from "./generationTasksApi";
import { generationReadinessQuery } from "./generationReadinessQuery";

configureEmergencyStopRunningTaskPolicy(applyEmergencyStopRunningTaskPolicy);

export const generationApplicationApi = Object.freeze({
  adminGenerationSafetyApi,
  assertMediaDeletionAllowedInTransaction:
    assertGenerationMediaDeletionAllowedInTransaction,
  configureRuntimeAdapters: configureGenerationRuntimeAdapters,
  httpHandler: generationTasks,
  initializePersistentWorker: initializePersistentGenerationTaskWorker,
  prepareRuntimeRoleTeardown: prepareGenerationRuntimeRoleTeardown,
  readinessQuery: generationReadinessQuery,
  registerRuntimeRoleCoordinator: registerGenerationRuntimeRoleCoordinator,
  unregisterRuntimeRoleCoordinatorBeforeStartup:
    unregisterGenerationRuntimeRoleCoordinatorBeforeStartup,
});
