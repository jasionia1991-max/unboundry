import type { DatabaseSync } from "node:sqlite";
import { appDataDirectory, openAppDatabase } from "./database";
import { createSeedanceTrustedAssetApplication } from "./seedanceTrustedAssetApplication";
import { createSeedanceTrustedAssetStore } from "./seedanceTrustedAssetStore";
import {
  seedanceProviderAccountFingerprint,
} from "./seedanceTrustedAssetStore";
import { mediaApplicationApi } from "./mediaApplicationApi";
import { publishedSeedanceTrustedAssetProvider } from "./modelCatalog";
import { providerApplicationApi } from "./providerApplicationApi";
import { createVolcengineArkSeedanceTrustedAssetPort } from "./volcengineArkSeedanceTrustedAssetPort";
import { createSeedanceTrustedVideoReferenceResolver } from "./seedanceTrustedVideoReferences";

let database: DatabaseSync | undefined;
let databaseDirectory = "";

function store() {
  const directory = appDataDirectory();
  if (!database || databaseDirectory !== directory) {
    database?.close();
    database = openAppDatabase(directory);
    databaseDirectory = directory;
  }
  return createSeedanceTrustedAssetStore(database);
}

const ports = new Map<string, ReturnType<
  typeof createVolcengineArkSeedanceTrustedAssetPort
>>();

async function context(ownerId: string, expectedProfileId?: string) {
  const published = publishedSeedanceTrustedAssetProvider(ownerId);
  if (!published || expectedProfileId && published.profileId !== expectedProfileId) {
    return undefined;
  }
  const accountId = process.env.UNBOUNDRY_SEEDANCE_ARK_ACCOUNT_ID?.trim();
  const callbackUrl = process.env.UNBOUNDRY_SEEDANCE_ARK_CALLBACK_URL?.trim();
  if (
    !accountId || accountId.length > 512 ||
    !callbackUrl || callbackUrl.length > 16_384
  ) return undefined;
  const credentials = await providerApplicationApi.getArkControlPlaneCredentials(
    published.profileId,
  );
  if (!credentials) return undefined;
  const identity = Object.freeze({
    accountFingerprint: seedanceProviderAccountFingerprint({
      accountId,
      project: credentials.projectName,
      region: credentials.region,
    }),
    profileId: published.profileId,
    project: credentials.projectName,
    region: credentials.region,
  });
  const key = [
    published.profileId,
    identity.accountFingerprint,
    credentials.revision,
    callbackUrl,
  ].join("\u0000");
  let port = ports.get(key);
  if (!port) {
    port = createVolcengineArkSeedanceTrustedAssetPort({
      callbackUrl,
      credentials,
      identity,
      providerDisplayName: published.displayName,
    });
    ports.clear();
    ports.set(key, port);
  }
  return Object.freeze({ identity, port });
}

const application = createSeedanceTrustedAssetApplication({
  context: (ownerId) => context(ownerId),
  media: (ownerId, assetId) =>
    mediaApplicationApi.validationMetadata.readableMediaForOwner(
      ownerId,
      "image",
      assetId,
    ),
  providerReferences: mediaApplicationApi.providerReferenceStore,
  store: new Proxy({} as ReturnType<typeof store>, {
    get(_target, property) {
      const current = store() as unknown as Record<PropertyKey, unknown>;
      const value = current[property];
      return typeof value === "function" ? value.bind(current) : value;
    },
  }),
});

const videoReferences = createSeedanceTrustedVideoReferenceResolver({
  context: (ownerId, profileId) => context(ownerId, profileId),
  media: (ownerId, assetId) =>
    mediaApplicationApi.validationMetadata.readableMediaForOwner(
      ownerId,
      "image",
      assetId,
    ),
  store: new Proxy({} as ReturnType<typeof store>, {
    get(_target, property) {
      const current = store() as unknown as Record<PropertyKey, unknown>;
      const value = current[property];
      return typeof value === "function" ? value.bind(current) : value;
    },
  }),
});

export const seedanceTrustedAssetRuntimeApi = Object.freeze({
  application,
  videoReferences,
});
