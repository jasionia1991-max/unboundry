import {
  accountContextApi,
  adminUsersApi,
  authApi,
  authGate,
  configureLegacyProviderKeyMigration,
} from "./auth";

export const authApplicationApi = Object.freeze({
  accountContextApi,
  adminUsersApi,
  authApi,
  authGate,
  configureLegacyProviderKeyMigration,
});
