import { authApplicationApi } from "./authApplicationApi";
import { canvasApplicationApi } from "./canvasApplicationApi";
import { generationApplicationApi } from "./generationApplicationApi";
import { imageToolApplicationApi } from "./imageToolApplicationApi";
import { libraryApplicationApi } from "./libraryApplicationApi";
import { mediaApplicationApi } from "./mediaApplicationApi";
import { publishedSeedanceValidationModel } from "./modelCatalog";
import { providerApplicationApi } from "./providerApplicationApi";
import { providerRuntimeApi } from "./providerRuntimeApi";

providerRuntimeApi.configureReferenceStore(
  mediaApplicationApi.providerReferenceStore,
);
generationApplicationApi.configureRuntimeAdapters(
  providerRuntimeApi.generation,
);
authApplicationApi.configureLegacyProviderKeyMigration(
  providerApplicationApi.migrateLegacyProviderKeysIfNeeded,
);
imageToolApplicationApi.configureGenerationCapabilityQuery(
  generationApplicationApi.imageToolGenerationCapabilityQuery,
);
imageToolApplicationApi.configureSeedanceValidationQueries(Object.freeze({
  media: (ownerId: string, assetId: string) =>
    mediaApplicationApi.validationMetadata.readableMediaForOwner(
      ownerId,
      "image",
      assetId,
    ),
  model: publishedSeedanceValidationModel,
}));

export const applicationComposition = Object.freeze({
  auth: authApplicationApi,
  canvas: canvasApplicationApi,
  generation: generationApplicationApi,
  imageTools: imageToolApplicationApi,
  library: libraryApplicationApi,
  media: mediaApplicationApi,
  provider: providerApplicationApi,
});
