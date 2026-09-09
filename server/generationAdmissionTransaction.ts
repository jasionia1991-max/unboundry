import { randomUUID } from "node:crypto";
import type { createGenerationTaskStore, GenerationTaskAdmissionOptions } from "./generationTaskStore";
import type { PreparedGenerationAdmission } from "./generationAdmissionApplication";
import { assertAuthoritativeGenerationModelConfiguration } from "./authoritativeGenerationModelConfiguration";
import { canvasLoadTokens } from "./canvasLoadTokenPort";
import { bindSingleNodeGenerationInTransaction } from "./canvasMutationGateway";
import { stableSha256 } from "../types/canvasFingerprint";

/** Shared atomic admission and Canvas binding; launch happens after commit. */
export function admitPreparedGenerationTransaction(
  store: ReturnType<typeof createGenerationTaskStore>,
  prepared: PreparedGenerationAdmission,
  options: GenerationTaskAdmissionOptions = {},
) {
  assertAuthoritativeGenerationModelConfiguration(
    prepared.input.modelConfiguration,
  );
  const configuration = prepared.input.modelConfiguration;
  const parameterImageTool = prepared.input.parameters?.imageTool;
  const requestIntentImageTool = prepared.input.requestIntent.imageTool;
  const hasImageTool = prepared.imageTool !== undefined ||
    parameterImageTool !== undefined || requestIntentImageTool !== undefined;
  if (
    hasImageTool &&
    (prepared.input.kind !== "image" ||
      configuration.workflowBinding !== undefined ||
      prepared.imageTool === undefined ||
      parameterImageTool === undefined ||
      requestIntentImageTool === undefined ||
      stableSha256(prepared.imageTool) !== stableSha256(parameterImageTool) ||
      stableSha256(prepared.imageTool) !== stableSha256(requestIntentImageTool))
  ) {
    throw new Error("Image tool admission identity is inconsistent");
  }
  const singleNode = configuration.generationIdentityVersion === 2 &&
    configuration.workflowBinding === undefined;
  if (singleNode &&
      (!Number.isSafeInteger(prepared.input.expectedCanvasRevision) ||
        Number(prepared.input.expectedCanvasRevision) < 0)) {
    throw new Error(
      "Modern single-node generation requires an input graph revision",
    );
  }
  const admitted = store.admitAuthoritativeOrGet(
      prepared.input,
      singleNode
        ? {
            ...options,
            beforeCommit: ({ database, task }) => {
              options.beforeCommit?.({ database, task });
              bindSingleNodeGenerationInTransaction({
                canvasId: prepared.input.canvasId,
                contractFingerprint:
                  configuration.modelInputContractFingerprint,
                database,
                inputFingerprint: configuration.generationInputKey,
                imageTool: prepared.imageTool,
                kind: prepared.input.kind,
                loadTokenEpoch: canvasLoadTokens.epoch(),
                loadTokenForRevision: (revision) =>
                  canvasLoadTokens.forRevision(
                    prepared.input.ownerId!,
                    prepared.input.canvasId,
                    revision,
                  ),
                modelConfigurationRevision:
                  configuration.modelConfigurationRevision,
                modelReleaseRevision:
                  configuration.modelReleaseRevision.revisionId,
                nodeId: prepared.input.nodeId,
                ownerId: prepared.input.ownerId!,
                ownershipKey: configuration.generationOwnershipKey,
                requestId: prepared.requestId ?? randomUUID(),
                taskId: task.id,
                taskState: task.state,
              });
            },
          }
        : options,
    );
  return admitted;
}
