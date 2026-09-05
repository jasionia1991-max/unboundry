import {
  accountHistory,
  canvasPersistence,
  projectTitle,
} from "./canvasPersistence";
import { canvasLegacyGenerationReconciliation } from
  "./canvasLegacyGenerationReconciliation";
import { canvasCommandsApi } from "./canvasCommandsApi";

export const canvasApplicationApi = Object.freeze({
  accountHistory,
  canvasCommandsApi,
  canvasLegacyGenerationReconciliation,
  canvasPersistence,
  projectTitle,
});
