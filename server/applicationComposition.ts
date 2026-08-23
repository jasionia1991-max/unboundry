import { authApplicationApi } from "./authApplicationApi";
import { canvasApplicationApi } from "./canvasApplicationApi";
import { generationApplicationApi } from "./generationApplicationApi";
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

export const applicationComposition = Object.freeze({
  auth: authApplicationApi,
  canvas: canvasApplicationApi,
  generation: generationApplicationApi,
  library: libraryApplicationApi,
  media: mediaApplicationApi,
  provider: providerApplicationApi,
});
