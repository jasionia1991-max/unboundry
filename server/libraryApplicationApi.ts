import {
  assertLibraryDeletionAllowed,
  deleteAccountLibraryEntries,
  libraryCatalogApi,
} from "./libraryCatalog";

export const libraryApplicationApi = Object.freeze({
  assertMediaDeletionAllowedInTransaction: assertLibraryDeletionAllowed,
  deleteAccountEntries: deleteAccountLibraryEntries,
  httpHandler: libraryCatalogApi,
});
