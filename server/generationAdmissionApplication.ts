import { randomUUID } from "node:crypto";
import type { AuthoritativeGenerationTaskInput } from "./generationTaskStore";
import { assertAuthoritativeGenerationModelConfiguration } from
  "./authoritativeGenerationModelConfiguration";
import { generationTaskApplication } from "./generationTasks";
import { canvasLoadTokens } from "./canvasLoadTokenPort";
import { bindSingleNodeGenerationInTransaction } from
  "./canvasMutationGateway";
import type { ImageGenerationToolInput } from "../types/imageTools";
import { stableSha256 } from "../types/canvasFingerprint";

export type PreparedGenerationAdmission = {
  input: AuthoritativeGenerationTaskInput;
  afterCommit?: () => void;
  imageTool?: ImageGenerationToolInput;
  requestId?: string;
};

/** Admission committed, but the transport-side post-commit handoff failed. */
export class GenerationAdmissionPostCommitError extends Error {
  constructor(readonly cause: unknown) {
    super("Generation admission committed before the response handoff failed");
    this.name = "GenerationAdmissionPostCommitError";
  }
}

/**
 * The single transport-neutral admission boundary used by both HTTP requests
 * and the durable workflow runner. The task row is committed before launch;
 * if the process stops in that gap, the persistent generation worker resumes
 * the same queued task and its original idempotency key on startup.
 */
export function admitPreparedGenerationTask(
  prepared: PreparedGenerationAdmission,
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
  const admitted = generationTaskApplication.taskStore()
    .admitAuthoritativeOrGet(
      prepared.input,
      singleNode
        ? {
            beforeCommit: ({ database, task }) => {
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
        : {},
    );
  try {
    prepared.afterCommit?.();
  } catch (error) {
    throw new GenerationAdmissionPostCommitError(error);
  }
  if (admitted.created) {
    generationTaskApplication.launchGenerationTask(
      admitted.task.id,
      prepared.input.kind,
    );
  }
  return admitted;
}
