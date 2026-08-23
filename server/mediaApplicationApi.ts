import { ownerMediaProviderReferenceStore } from "./mediaProviderReferenceStore";
import { mediaPublicationService } from "./mediaPublicationService";
import {
  beginMediaLibraryReference,
  composeMediaDeletionGuards,
} from "./mediaLibraryReferencePort";
import { readableMediaForOwner } from "./mediaRegistry";

export const mediaApplicationApi = Object.freeze({
  libraryReferences: Object.freeze({
    begin: beginMediaLibraryReference,
    composeDeletionGuards: composeMediaDeletionGuards,
  }),
  providerReferenceStore: ownerMediaProviderReferenceStore,
  publication: mediaPublicationService,
  validationMetadata: Object.freeze({ readableMediaForOwner }),
});
