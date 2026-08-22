import type { DatabaseSync } from "node:sqlite";

export interface GenerationReadinessQuery {
  hasCommittedActiveTasks(database: DatabaseSync): boolean;
}

export const generationReadinessQuery: GenerationReadinessQuery = Object.freeze({
  hasCommittedActiveTasks(database: DatabaseSync) {
    return Boolean(database.prepare(`
      SELECT 1
      FROM generation_tasks
      WHERE state IN ('queued', 'running', 'recovering', 'retrying')
      LIMIT 1
    `).get());
  },
});
