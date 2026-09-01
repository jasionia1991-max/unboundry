import type { AuthoritativeGenerationTaskInput } from "./generationTaskStore";
import { assertAuthoritativeGenerationModelConfiguration } from
  "./authoritativeGenerationModelConfiguration";
import { generationTaskApplication } from "./generationTasks";

export type PreparedGenerationAdmission = {
  input: AuthoritativeGenerationTaskInput;
  afterCommit?: () => void;
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
  const admitted = generationTaskApplication.taskStore()
    .admitAuthoritativeOrGet(
    prepared.input,
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
