import { DatabaseSync } from "node:sqlite";
import { databaseMatchesLibrarySchema } from
  "./library/internal/libraryStore";

export function validateLibraryBackupDatabase(path: string) {
  const database = new DatabaseSync(path, { readOnly: true, timeout: 5_000 });
  try {
    if (!databaseMatchesLibrarySchema(database)) {
      throw new Error("Library backup database schema is invalid");
    }
  } finally {
    database.close();
  }
}
