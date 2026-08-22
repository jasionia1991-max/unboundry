import { ownerMediaProviderReferenceStore } from "./mediaProviderReferenceStore";
import { mediaPublicationService } from "./mediaPublicationService";

export const mediaApplicationApi = Object.freeze({
  providerReferenceStore: ownerMediaProviderReferenceStore,
  publication: mediaPublicationService,
});
