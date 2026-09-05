import {
  canvasLoadTokenEpochForApplication,
  canvasLoadTokenForApplication,
} from "./canvasPersistence";

/** Public server port for revision-bound Canvas load-token material. */
export const canvasLoadTokens = Object.freeze({
  epoch: canvasLoadTokenEpochForApplication,
  forRevision: canvasLoadTokenForApplication,
});
