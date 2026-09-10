import type { DatabaseSync } from "node:sqlite";
import {
  applyGenerationResultAdoption,
  type GenerationResultAdoptionApplicationInput,
  type GenerationResultAdoptionApplicationResult,
  type GenerationResultAdoptionWorkflowPort,
} from "./generationResultAdoptionApplication";
import {
  projectAdoptedWorkflowResultInTransaction,
  readAdoptedWorkflowBindingInTransaction,
} from "./workflowRunService";

/**
 * Production composition for the narrow historical-result adoption command.
 *
 * The application owns the save lease, Media ledger and task settlement.  The
 * adapter supplies only Workflow's same-connection binding read and its
 * existing Canvas projection.  It has no Provider/OSS client and cannot
 * manufacture an external input or a new generation request.
 */
export function createGenerationResultAdoptionWorkflowPort():
  GenerationResultAdoptionWorkflowPort {
  return Object.freeze({
    readInTransaction(database: DatabaseSync, input) {
      return readAdoptedWorkflowBindingInTransaction(database, input);
    },
    projectInTransaction(database: DatabaseSync, input) {
      const result = projectAdoptedWorkflowResultInTransaction(database, input);
      return result === "applied" ? "projected" : result === "conflict" ? "preserved" : "failed";
    },
  });
}

/**
 * Composition-root convenience entrypoint.  HTTP/recovery callers should use
 * this function instead of constructing a fake Workflow port.  Tests may
 * still inject the port into applyGenerationResultAdoption to exercise the
 * application in isolation.
 */
export function applyRealGenerationResultAdoption(
  input: GenerationResultAdoptionApplicationInput,
): Promise<GenerationResultAdoptionApplicationResult | undefined> {
  return applyGenerationResultAdoption(
    input,
    createGenerationResultAdoptionWorkflowPort(),
  );
}
