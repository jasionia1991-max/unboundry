import {
  accountHistory,
  canvasPersistence,
  projectTitle,
} from "./canvasPersistence";
import { canvasLegacyGenerationReconciliation } from
  "./canvasLegacyGenerationReconciliation";

export const canvasApplicationApi = Object.freeze({
  accountHistory,
  canvasLegacyGenerationReconciliation,
  canvasPersistence,
  projectTitle,
});
