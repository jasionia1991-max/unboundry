import { authApplicationApi } from "./authApplicationApi";
import { canvasApplicationApi } from "./canvasApplicationApi";
import { generationApplicationApi } from "./generationApplicationApi";
import { imageToolApplicationApi } from "./imageToolApplicationApi";
import { libraryApplicationApi } from "./libraryApplicationApi";
import { mediaApplicationApi } from "./mediaApplicationApi";
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

export const applicationComposition = Object.freeze({
  auth: authApplicationApi,
  canvas: canvasApplicationApi,
  generation: generationApplicationApi,
  imageTools: imageToolApplicationApi,
  library: libraryApplicationApi,
  media: mediaApplicationApi,
  provider: providerApplicationApi,
});
