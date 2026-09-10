import { assertGenerationPublicationAliasesInTransaction } from "./generationResultAdoptionQueries";
import { permitsOriginalGenerationSaveInTransaction } from "./generationResultCommit";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openAppDatabase } from "./database";
import {
  reserveMediaPublicationInTransaction, reservationFromAttempt,
  type MediaPublicationReservation, type MediaPublicationReservationInput,
} from "./mediaPublicationService";
import { readGenerationPublicationSlotsCommand } from "./mediaTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";
import {
  assertGenerationSaveTokenInTransaction, assertNoConcurrentGenerationSaveInTransaction,
  type GenerationSaveIdentity, type GenerationSaveToken,
} from "./generationResultSaveOwnership";

export class GenerationOutputSlotBlockedError extends Error {
  constructor() {
    super("The original output evidence requires protected recovery");
    this.name = "GenerationOutputSlotBlockedError";
  }
}

const retainedStates = new Set(["reserved", "staged", "external-ready", "compensating", "published"]);
const outputSetEvent = "GENERATION_OUTPUT_SET_V1";
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function transaction<T>(database: DatabaseSync, operation: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try { const result = operation(); database.exec("COMMIT"); return result; }
  catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
}

function assertTaskAndProvider(database: DatabaseSync, identity: GenerationSaveIdentity) {
  const task = database.prepare(`SELECT * FROM generation_tasks WHERE id = ?`)
    .get(identity.taskId) as Record<string, unknown> | undefined;
  const provider = database.prepare(`SELECT * FROM generation_provider_attempts
    WHERE task_id = ? AND execution_attempt = ?`)
    .get(identity.taskId, identity.executionAttempt) as Record<string, unknown> | undefined;
  const originalRecovery = permitsOriginalGenerationSaveInTransaction(database, identity);
  if (!task || task.owner_id !== identity.ownerId || task.kind !== identity.kind ||
      task.attempt !== identity.executionAttempt ||
      !["running", "recovering", "success"].includes(String(task.state)) && !originalRecovery ||
      !provider || provider.owner_id !== identity.ownerId || provider.kind !== identity.kind ||
      provider.provider_model_id !== task.provider_model_id ||
      provider.provider_profile_id !== task.provider_profile_id ||
      provider.credential_revision !== task.credential_revision ||
      provider.provider_task_id !== task.provider_task_id ||
      !["boundary-claimed", "accepted", "response-received", "completed"].includes(String(provider.outcome)) && !originalRecovery ||
      provider.failure_code === "PROVIDER_FAILED_CHARGE_SETTLED") throw new GenerationOutputSlotBlockedError();
  const configuration = JSON.parse(String(task.model_configuration)) as Record<string, unknown>;
  return { task, provider, configuration };
}

export function reserveGenerationMediaPublication(input: MediaPublicationReservationInput): MediaPublicationReservation {
  if (!input.task) throw new GenerationOutputSlotBlockedError();
  const identity = { taskId: input.task.taskId, executionAttempt: input.task.executionAttempt,
    ownerId: input.ownerId, kind: input.kind };
  const database = openAppDatabase();
  try {
    return transaction(database, () => {
      if (input.task!.saveToken) assertGenerationSaveTokenInTransaction(database, input.task!.saveToken);
      else assertNoConcurrentGenerationSaveInTransaction(database, identity);
      const { task, configuration } = assertTaskAndProvider(database, identity);
      const slot = input.task!.outputSlot ?? 0;
      const count = input.task!.outputSetCount ?? Number(configuration.modelResultCount ?? 1);
      if (!Number.isSafeInteger(slot) || !Number.isSafeInteger(count) || slot < 0 ||
          count < 1 || count > 4 || slot >= count ||
          configuration.modelResultCount !== undefined && configuration.modelResultCount !== count) {
        throw new GenerationOutputSlotBlockedError();
      }
      assertGenerationPublicationAliasesInTransaction(database, identity);
      const rows = executeTransactionScopedCommand(database, readGenerationPublicationSlotsCommand, identity);
      for (const row of rows) {
        if (row.owner_id !== identity.ownerId || row.kind !== identity.kind ||
            row.output_set_count !== null && row.output_set_count !== count ||
            row.error_code === "OSS_IDENTITY_QUARANTINED") {
          throw new GenerationOutputSlotBlockedError();
        }
      }
      const retained = rows.filter((row) => row.output_slot === slot && retainedStates.has(String(row.state)));
      if (retained.length > 1) throw new GenerationOutputSlotBlockedError();
      if (retained[0]) {
        const row = retained[0];
        if (row.state === "compensating" || row.deletion_state !== null ||
            row.state === "published" && row.media_storage_status !== "ready") {
          throw new GenerationOutputSlotBlockedError();
        }
        const reservation = reservationFromAttempt(row as unknown as Parameters<typeof reservationFromAttempt>[0]);
        return { ...reservation, saveToken: input.task!.saveToken,
          disposition: row.state === "published" ? "reused-published" : "reused-active" };
      }
      if (task.state === "success") throw new GenerationOutputSlotBlockedError();
      // A failed attempt may be replaced only after its exact cleanup removed
      // both the media row and deletion intent. Historical evidence stays put.
      if (rows.some((row) => row.output_slot === slot && row.state === "failed" &&
          (row.media_storage_status !== null || row.deletion_state !== null))) {
        throw new GenerationOutputSlotBlockedError();
      }
      if (rows.some((row) => retainedStates.has(String(row.state)) && row.state !== "published")) {
        throw new GenerationOutputSlotBlockedError();
      }
      return reserveMediaPublicationInTransaction(database, {
        ...input, task: { ...input.task!, outputSlot: slot, outputSetCount: count },
      });
    });
  } finally { database.close(); }
}

/** Bind a first trusted output order without storing signed URLs or bodies. */
export function bindGenerationOutputSet(input: GenerationSaveIdentity & {
  outputs: readonly (
    | { transport: "bytes"; kind: "image"; bytes: Uint8Array }
    | { transport: "transient-url"; kind: GenerationSaveIdentity["kind"]; transientUrl: string }
  )[];
  token: GenerationSaveToken;
}) {
  const database = openAppDatabase();
  try {
    return transaction(database, () => {
      assertGenerationSaveTokenInTransaction(database, input.token);
      const { task, provider, configuration } = assertTaskAndProvider(database, input);
      const count = input.outputs.length;
      if (count < 1 || count > 4 || configuration.modelResultCount !== undefined &&
          configuration.modelResultCount !== count) throw new GenerationOutputSlotBlockedError();
      const identitySha256 = digest([input.taskId, input.executionAttempt, input.ownerId, input.kind,
        provider.provider_task_id, provider.provider_profile_id, provider.provider_model_id,
        provider.credential_revision, count]);
      const slots = input.outputs.map((output, slot) => {
        if (output.kind !== input.kind || !["bytes", "transient-url"].includes(output.transport)) {
          throw new GenerationOutputSlotBlockedError();
        }
        let identity: string;
        if (output.transport === "bytes") {
          if (!(output.bytes instanceof Uint8Array) || output.bytes.byteLength === 0) throw new GenerationOutputSlotBlockedError();
          identity = createHash("sha256").update(output.bytes).digest("hex");
        } else {
          const url = new URL(String(output.transientUrl));
          // Preserve query output IDs; strip authentication/expiry fields only.
          for (const name of [...url.searchParams.keys()]) {
            if (/^(?:x-amz-|x-oss-|x-goog-|signature$|sig$|token$|expires$|ossaccesskeyid$|security-token$)/i.test(name)) {
              url.searchParams.delete(name);
            }
          }
          url.searchParams.sort();
          identity = digest(url.toString());
        }
        return { slot, identitySha256: identity };
      });
      const payload = { version: 1, executionAttempt: input.executionAttempt, count, identitySha256, slots };
      const prior = database.prepare(`SELECT error_message FROM generation_task_events
        WHERE task_id = ? AND error_code = ? ORDER BY id DESC LIMIT 64`)
        .all(input.taskId, outputSetEvent) as { error_message: string }[];
      const matching = prior.map((row) => JSON.parse(row.error_message) as typeof payload)
        .filter((value) => value.executionAttempt === input.executionAttempt);
      if (matching.length) {
        if (matching.some((value) => JSON.stringify(value) !== JSON.stringify(payload))) {
          throw new GenerationOutputSlotBlockedError();
        }
        return;
      }
      // Once any output was reserved, a missing order receipt is ambiguous.
      // A later Provider response must not silently assign fresh identities
      // to stored slots merely because its output count happens to match.
      const existing = executeTransactionScopedCommand(
        database, readGenerationPublicationSlotsCommand, input,
      );
      if (existing.length) throw new GenerationOutputSlotBlockedError();
      database.prepare(`INSERT INTO generation_task_events
        (task_id, state, error_code, error_message, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(input.taskId, String(task.state), outputSetEvent, JSON.stringify(payload), new Date().toISOString());
    });
  } finally { database.close(); }
}
