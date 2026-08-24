import type { DatabaseSync } from "node:sqlite";
import { appDataDirectory, openAppDatabase } from "./database";
import { mediaApplicationApi } from "./mediaApplicationApi";
import { publishedSeedanceValidationModel } from "./modelCatalog";
import { createSeedanceCharacterComplianceApplication } from
  "./seedanceCharacterComplianceApplication";
import { createSeedanceCharacterComplianceStore } from
  "./seedanceCharacterComplianceStore";
import {
  configureSeedanceCharacterReferenceResolver,
  createSeedanceCharacterReferenceResolver,
} from "./seedanceCharacterReferences";

let database: DatabaseSync | undefined;
let databaseDirectory = "";

function store() {
  const directory = appDataDirectory();
  if (!database || databaseDirectory !== directory) {
    database?.close();
    database = openAppDatabase(directory);
    databaseDirectory = directory;
  }
  return createSeedanceCharacterComplianceStore(database);
}

const application = createSeedanceCharacterComplianceApplication({
  // Branch C is intentional: no configured Provider currently proves all
  // required risk categories and data-processing obligations.
  context: async () => undefined,
  media: (ownerId, assetId) =>
    mediaApplicationApi.validationMetadata.readableMediaForOwner(
      ownerId,
      "image",
      assetId,
    ),
  model: publishedSeedanceValidationModel,
  store: new Proxy({} as ReturnType<typeof store>, {
    get(_target, property) {
      const current = store() as unknown as Record<PropertyKey, unknown>;
      const value = current[property];
      return typeof value === "function" ? value.bind(current) : value;
    },
  }),
});

configureSeedanceCharacterReferenceResolver(createSeedanceCharacterReferenceResolver({
  context: async () => undefined,
  media: (ownerId, assetId) =>
    mediaApplicationApi.validationMetadata.readableMediaForOwner(
      ownerId,
      "image",
      assetId,
    ),
  model: publishedSeedanceValidationModel,
  store: new Proxy({} as ReturnType<typeof store>, {
    get(_target, property) {
      const current = store() as unknown as Record<PropertyKey, unknown>;
      const value = current[property];
      return typeof value === "function" ? value.bind(current) : value;
    },
  }),
}));

export const seedanceCharacterComplianceRuntimeApi = Object.freeze({ application });
