import {
  adminProviderProfilesApi,
  getArkControlPlaneCredentials,
  migrateLegacyProviderKeysIfNeeded,
} from "./providerProfiles";

export const providerApplicationApi = Object.freeze({
  adminProviderProfilesApi,
  getArkControlPlaneCredentials,
  migrateLegacyProviderKeysIfNeeded,
});
