import {
  adoptUploadedMediaReferences as adoptUploadedMediaReferencesImpl,
  cleanupPublicationStaging as cleanupPublicationStagingImpl,
  compensateMediaPublication as compensateMediaPublicationImpl,
  finalizeMediaPublication as finalizeMediaPublicationImpl,
  hasPendingGeneratedMediaPublications as hasPendingGeneratedMediaPublicationsImpl,
  hasPendingMediaDeletions as hasPendingMediaDeletionsImpl,
  hasPendingUploadMediaPublications as hasPendingUploadMediaPublicationsImpl,
  markExternalMediaPublicationReady as markExternalMediaPublicationReadyImpl,
  mediaLifecycleStartupRecoveryAllowsReadiness as mediaLifecycleStartupRecoveryAllowsReadinessImpl,
  mediaPublicationFinalPath as mediaPublicationFinalPathImpl,
  mediaPublicationStagingPath as mediaPublicationStagingPathImpl,
  pendingGeneratedPublicationTaskIds as pendingGeneratedPublicationTaskIdsImpl,
  publishLocalMediaPublication as publishLocalMediaPublicationImpl,
  recoverMediaLifecycleAtProcessStartup as recoverMediaLifecycleAtProcessStartupImpl,
  recoverPendingMediaDeletions as recoverPendingMediaDeletionsImpl,
  recoverPendingUploadMediaPublications as recoverPendingUploadMediaPublicationsImpl,
  reserveMediaPublication as reserveMediaPublicationImpl,
  stageMediaPublication as stageMediaPublicationImpl,
} from "./mediaLifecycle";
import {
  beginMediaDeletion as beginMediaDeletionImpl,
  finishMediaDeletion as finishMediaDeletionImpl,
  markMediaDeletionFailed as markMediaDeletionFailedImpl,
} from "./mediaRegistry";

export {
  MediaPublicationConflictError,
  MediaPublicationDeferredError,
  MediaPublicationStateError,
  type DurableMediaReference,
  type GeneratedPublicationTask,
  type MediaPublicationEvidence,
  type MediaPublicationExecution,
  type MediaPublicationMetadata,
  type MediaPublicationReservation,
} from "./mediaLifecycle";

/**
 * Public Media-owned publication boundary. Physical blobs remain behind
 * MediaBlobStore; Generation's transaction-scoped result commit remains in
 * generationResultCommit and is deliberately not exposed here.
 */
export interface MediaPublicationService {
  adoptUploadedReferences: typeof adoptUploadedMediaReferencesImpl;
  beginDeletion: typeof beginMediaDeletionImpl;
  cleanupStaging: typeof cleanupPublicationStagingImpl;
  compensate: typeof compensateMediaPublicationImpl;
  failDeletion: typeof markMediaDeletionFailedImpl;
  finalPath: typeof mediaPublicationFinalPathImpl;
  finalize: typeof finalizeMediaPublicationImpl;
  finishDeletion: typeof finishMediaDeletionImpl;
  hasPendingDeletions: typeof hasPendingMediaDeletionsImpl;
  hasPendingGenerated: typeof hasPendingGeneratedMediaPublicationsImpl;
  hasPendingUploads: typeof hasPendingUploadMediaPublicationsImpl;
  markExternalReady: typeof markExternalMediaPublicationReadyImpl;
  pendingGeneratedTaskIds: typeof pendingGeneratedPublicationTaskIdsImpl;
  publishLocal: typeof publishLocalMediaPublicationImpl;
  readinessAllowsStartup: typeof mediaLifecycleStartupRecoveryAllowsReadinessImpl;
  recoverDeletions: typeof recoverPendingMediaDeletionsImpl;
  recoverStartup: typeof recoverMediaLifecycleAtProcessStartupImpl;
  recoverUploads: typeof recoverPendingUploadMediaPublicationsImpl;
  reserve: typeof reserveMediaPublicationImpl;
  stage: typeof stageMediaPublicationImpl;
  stagingPath: typeof mediaPublicationStagingPathImpl;
}

export function createMediaPublicationService(
  implementation: MediaPublicationService,
): MediaPublicationService {
  return Object.freeze(implementation);
}

export const mediaPublicationService = createMediaPublicationService({
  adoptUploadedReferences: adoptUploadedMediaReferencesImpl,
  beginDeletion: beginMediaDeletionImpl,
  cleanupStaging: cleanupPublicationStagingImpl,
  compensate: compensateMediaPublicationImpl,
  failDeletion: markMediaDeletionFailedImpl,
  finalPath: mediaPublicationFinalPathImpl,
  finalize: finalizeMediaPublicationImpl,
  finishDeletion: finishMediaDeletionImpl,
  hasPendingDeletions: hasPendingMediaDeletionsImpl,
  hasPendingGenerated: hasPendingGeneratedMediaPublicationsImpl,
  hasPendingUploads: hasPendingUploadMediaPublicationsImpl,
  markExternalReady: markExternalMediaPublicationReadyImpl,
  pendingGeneratedTaskIds: pendingGeneratedPublicationTaskIdsImpl,
  publishLocal: publishLocalMediaPublicationImpl,
  readinessAllowsStartup: mediaLifecycleStartupRecoveryAllowsReadinessImpl,
  recoverDeletions: recoverPendingMediaDeletionsImpl,
  recoverStartup: recoverMediaLifecycleAtProcessStartupImpl,
  recoverUploads: recoverPendingUploadMediaPublicationsImpl,
  reserve: reserveMediaPublicationImpl,
  stage: stageMediaPublicationImpl,
  stagingPath: mediaPublicationStagingPathImpl,
});

// Stable named facade for incremental callers; all operations resolve through
// the single service object above rather than importing Media internals.
export const adoptUploadedMediaReferences =
  mediaPublicationService.adoptUploadedReferences;
export const beginMediaDeletion = mediaPublicationService.beginDeletion;
export const cleanupPublicationStaging = mediaPublicationService.cleanupStaging;
export const compensateMediaPublication = mediaPublicationService.compensate;
export const finalizeMediaPublication = mediaPublicationService.finalize;
export const finishMediaDeletion = mediaPublicationService.finishDeletion;
export const hasPendingGeneratedMediaPublications =
  mediaPublicationService.hasPendingGenerated;
export const hasPendingMediaDeletions = mediaPublicationService.hasPendingDeletions;
export const hasPendingUploadMediaPublications =
  mediaPublicationService.hasPendingUploads;
export const markExternalMediaPublicationReady =
  mediaPublicationService.markExternalReady;
export const markMediaDeletionFailed = mediaPublicationService.failDeletion;
export const mediaLifecycleStartupRecoveryAllowsReadiness =
  mediaPublicationService.readinessAllowsStartup;
export const mediaPublicationFinalPath = mediaPublicationService.finalPath;
export const mediaPublicationStagingPath = mediaPublicationService.stagingPath;
export const pendingGeneratedPublicationTaskIds =
  mediaPublicationService.pendingGeneratedTaskIds;
export const publishLocalMediaPublication = mediaPublicationService.publishLocal;
export const recoverMediaLifecycleAtProcessStartup =
  mediaPublicationService.recoverStartup;
export const recoverPendingMediaDeletions = mediaPublicationService.recoverDeletions;
export const recoverPendingUploadMediaPublications =
  mediaPublicationService.recoverUploads;
export const reserveMediaPublication = mediaPublicationService.reserve;
export const stageMediaPublication = mediaPublicationService.stage;
