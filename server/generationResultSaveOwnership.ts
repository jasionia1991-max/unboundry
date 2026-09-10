import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { appDataDirectory, openAppDatabase } from "./database";
import type { RuntimeRoleCoordinator } from "./runtimeRole";

export type GenerationSaveIdentity = Readonly<{
  taskId: string;
  executionAttempt: number;
  ownerId: string;
  kind: "image" | "video" | "audio";
}>;

/** Internal capability. A JSON copy is not a save owner. */
export type GenerationSaveToken = GenerationSaveIdentity & Readonly<{
  runtimeInstanceId: string;
  fenceEpoch: number;
  holderToken: string;
}>;

type TokenState = { directory: string; lost: boolean; released: boolean };
const tokens = new WeakMap<GenerationSaveToken, TokenState>();
const held = new Map<string, GenerationSaveToken>();
const settledWithoutRelease = new Set<string>();
const drainedRuntimeInstances = new Set<string>();
let coordinator: RuntimeRoleCoordinator | undefined;
let registrationRequired = false;
let runtimeInstanceId = `${process.pid}:${randomUUID()}`;

export class GenerationSaveBusyError extends Error {
  constructor() {
    super("The original result is already being saved");
    this.name = "GenerationSaveBusyError";
  }
}

export class GenerationSaveOwnershipError extends Error {
  constructor() {
    super("Generation result save ownership changed");
    this.name = "GenerationSaveOwnershipError";
  }
}

export function registerGenerationSaveRuntime(value: RuntimeRoleCoordinator) {
  if (coordinator && coordinator !== value || held.size) {
    throw new GenerationSaveOwnershipError();
  }
  coordinator = value;
  registrationRequired = true;
  runtimeInstanceId = `${process.pid}:${randomUUID()}`;
  return () => {
    if (held.size || coordinator !== value) throw new GenerationSaveOwnershipError();
    // A completed local teardown proves that this runtime has no pending I/O,
    // even if its last SQLite lease-release write failed before re-registration.
    drainedRuntimeInstances.add(runtimeInstanceId);
    coordinator = undefined;
  };
}

function assertRuntime(allowDrain: boolean) {
  if (!coordinator) {
    if (registrationRequired || process.env.UNBOUNDRY_SAFE_TEST !== "1") {
      throw new GenerationSaveOwnershipError();
    }
    return;
  }
  const snapshot = coordinator.snapshot();
  if (coordinator.dataDirectory() !== appDataDirectory() ||
      snapshot.role !== "active" || !snapshot.activeLeaseHeld ||
      !allowDrain && snapshot.draining) throw new GenerationSaveOwnershipError();
}

function key(input: GenerationSaveIdentity) {
  return JSON.stringify([appDataDirectory(), input.ownerId, input.taskId,
    input.executionAttempt, input.kind]);
}

function priorRuntimeExited(instance: string) {
  const match = /^(\d+):[a-f0-9-]{36}$/.exec(instance);
  if (!match || Number(match[1]) === process.pid) return false;
  try { process.kill(Number(match[1]), 0); return false; }
  catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}

function taskMatches(database: DatabaseSync, input: GenerationSaveIdentity) {
  const row = database.prepare(`SELECT owner_id, kind, attempt, state FROM generation_tasks
    WHERE id = ?`).get(input.taskId) as
    { owner_id: string; kind: string; attempt: number; state: string } | undefined;
  if (!row || row.owner_id !== input.ownerId || row.kind !== input.kind ||
      row.attempt !== input.executionAttempt) throw new GenerationSaveOwnershipError();
  return row;
}

function claim(input: GenerationSaveIdentity, phase: string) {
  assertRuntime(false);
  if (held.has(key(input))) return undefined;
  const database = openAppDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    taskMatches(database, input);
    const prior = database.prepare(`SELECT owner_id, kind, runtime_instance_id, fence_epoch, holder_token, released_at
      FROM generation_result_save_leases WHERE task_id = ? AND execution_attempt = ?`)
      .get(input.taskId, input.executionAttempt) as
      { owner_id: string; kind: string; runtime_instance_id: string; fence_epoch: number;
        holder_token: string; released_at: string | null } | undefined;
    if (prior && (prior.owner_id !== input.ownerId || prior.kind !== input.kind)) {
      throw new GenerationSaveOwnershipError();
    }
    // Time expiry is deliberately insufficient: live I/O must never be stolen.
    const locallySettled = prior?.runtime_instance_id === runtimeInstanceId &&
      settledWithoutRelease.has(prior.holder_token);
    if (prior && !prior.released_at && !locallySettled &&
        !drainedRuntimeInstances.has(prior.runtime_instance_id) &&
        !priorRuntimeExited(prior.runtime_instance_id)) {
      database.exec("ROLLBACK");
      return undefined;
    }
    const token = Object.freeze({ ...input, runtimeInstanceId,
      fenceEpoch: (prior?.fence_epoch ?? 0) + 1, holderToken: randomUUID() });
    const now = new Date();
    database.prepare(`INSERT INTO generation_result_save_leases (
      task_id, execution_attempt, owner_id, kind, runtime_instance_id, fence_epoch,
      holder_token, phase, heartbeat_at, lease_until, released_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(task_id, execution_attempt) DO UPDATE SET
      owner_id = excluded.owner_id, kind = excluded.kind,
      runtime_instance_id = excluded.runtime_instance_id, fence_epoch = excluded.fence_epoch,
      holder_token = excluded.holder_token, phase = excluded.phase,
      heartbeat_at = excluded.heartbeat_at, lease_until = excluded.lease_until, released_at = NULL`)
      .run(input.taskId, input.executionAttempt, input.ownerId, input.kind,
        runtimeInstanceId, token.fenceEpoch, token.holderToken, phase,
        now.toISOString(), new Date(now.getTime() + 30_000).toISOString());
    database.exec("COMMIT");
    if (prior) settledWithoutRelease.delete(prior.holder_token);
    tokens.set(token, { directory: appDataDirectory(), lost: false, released: false });
    held.set(key(input), token);
    return token;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally { database.close(); }
}

export function assertGenerationSaveTokenInTransaction(
  database: DatabaseSync, token: GenerationSaveToken,
  options?: { newIo?: boolean; allowCancelled?: boolean },
) {
  assertRuntime(!options?.newIo);
  const state = tokens.get(token);
  if (!state || state.lost || state.released || state.directory !== appDataDirectory() ||
      held.get(key(token)) !== token) throw new GenerationSaveOwnershipError();
  const task = taskMatches(database, token);
  if (options?.newIo && !options.allowCancelled && task.state === "cancelled") {
    throw new GenerationSaveOwnershipError();
  }
  const row = database.prepare(`SELECT 1 FROM generation_result_save_leases
    WHERE task_id = ? AND execution_attempt = ? AND owner_id = ? AND kind = ?
      AND runtime_instance_id = ? AND fence_epoch = ? AND holder_token = ?
      AND released_at IS NULL`).get(token.taskId, token.executionAttempt,
    token.ownerId, token.kind, token.runtimeInstanceId, token.fenceEpoch, token.holderToken);
  if (!row) { state.lost = true; throw new GenerationSaveOwnershipError(); }
}

export function assertGenerationSaveToken(token: GenerationSaveToken, newIo = false) {
  const database = openAppDatabase();
  try { assertGenerationSaveTokenInTransaction(database, token, { newIo }); }
  finally { database.close(); }
}

/** A completed synchronous settlement may reuse only the exact released epoch. */
export function assertGenerationSaveSettlementInTransaction(
  database: DatabaseSync, token: GenerationSaveToken,
) {
  const state = tokens.get(token);
  if (!state || state.lost || state.directory !== appDataDirectory()) {
    throw new GenerationSaveOwnershipError();
  }
  if (!state.released) return assertGenerationSaveTokenInTransaction(database, token);
  assertRuntime(false);
  taskMatches(database, token);
  const row = database.prepare(`SELECT 1 FROM generation_result_save_leases
    WHERE task_id = ? AND execution_attempt = ? AND owner_id = ? AND kind = ?
      AND runtime_instance_id = ? AND fence_epoch = ? AND holder_token = ?
      AND released_at IS NOT NULL`).get(token.taskId, token.executionAttempt,
      token.ownerId, token.kind, token.runtimeInstanceId, token.fenceEpoch, token.holderToken);
  if (!row) throw new GenerationSaveOwnershipError();
}

/** Synchronous legacy/internal commands may not cross an active async owner. */
export function assertNoConcurrentGenerationSaveInTransaction(
  database: DatabaseSync, identity: GenerationSaveIdentity,
) {
  assertRuntime(false);
  taskMatches(database, identity);
  if (database.prepare(`SELECT 1 FROM generation_result_save_leases
    WHERE task_id = ? AND execution_attempt = ? AND released_at IS NULL`)
    .get(identity.taskId, identity.executionAttempt)) throw new GenerationSaveBusyError();
}

function renew(token: GenerationSaveToken, phase: string) {
  const database = openAppDatabase();
  try {
    assertGenerationSaveTokenInTransaction(database, token);
    const now = new Date();
    const changed = database.prepare(`UPDATE generation_result_save_leases
      SET phase = ?, heartbeat_at = ?, lease_until = ?
      WHERE task_id = ? AND execution_attempt = ? AND runtime_instance_id = ?
        AND fence_epoch = ? AND holder_token = ? AND released_at IS NULL`)
      .run(phase, now.toISOString(), new Date(now.getTime() + 30_000).toISOString(),
        token.taskId, token.executionAttempt, token.runtimeInstanceId,
        token.fenceEpoch, token.holderToken);
    if (changed.changes !== 1) throw new GenerationSaveOwnershipError();
  } finally { database.close(); }
}

function release(token: GenerationSaveToken) {
  const state = tokens.get(token)!;
  let database: DatabaseSync | undefined;
  let released = false;
  try {
    database = openAppDatabase();
    assertRuntime(true);
    const changed = database.prepare(`UPDATE generation_result_save_leases SET released_at = ?
      WHERE task_id = ? AND execution_attempt = ? AND runtime_instance_id = ?
        AND fence_epoch = ? AND holder_token = ? AND released_at IS NULL`)
      .run(new Date().toISOString(), token.taskId, token.executionAttempt,
        token.runtimeInstanceId, token.fenceEpoch, token.holderToken);
    if (changed.changes !== 1) state.lost = true;
    released = changed.changes === 1;
  } finally {
    database?.close();
    // The awaited operation and every owned cleanup have ended. If only the
    // release write failed, this exact process can later prove local quiescence
    // without treating a clock timeout as permission to steal active I/O.
    if (!released) settledWithoutRelease.add(token.holderToken);
    state.released = true;
    if (held.get(key(token)) === token) held.delete(key(token));
  }
}

export async function withGenerationResultSave<T>(
  identity: GenerationSaveIdentity,
  work: (token: GenerationSaveToken) => Promise<T>,
  options?: { token?: GenerationSaveToken; nonBlocking?: boolean; phase?: string },
): Promise<T | undefined> {
  const phase = options?.phase ?? "saving";
  if (!/^[a-z-]{1,64}$/.test(phase)) throw new GenerationSaveOwnershipError();
  if (options?.token) {
    if (key(identity) !== key(options.token)) throw new GenerationSaveOwnershipError();
    assertGenerationSaveToken(options.token);
    return work(options.token);
  }
  const execute = async () => {
    const token = claim(identity, phase);
    if (!token) {
      if (options?.nonBlocking) return undefined;
      throw new GenerationSaveBusyError();
    }
    const heartbeat = setInterval(() => {
      try { renew(token, phase); } catch { tokens.get(token)!.lost = true; }
    }, 10_000);
    heartbeat.unref();
    try { return await work(token); }
    finally {
      clearInterval(heartbeat);
      // release() retains exact local quiescence proof if only its database
      // write fails. Do not turn an already committed result into a fake save
      // failure, or mask the original operation error with a cleanup error.
      try { release(token); } catch (error) {
        // Keep the durable fence and surface the operational failure without
        // exposing prompts, credentials or Provider response payloads.
        console.error("Generation save lease release failed", {
          name: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : "Lease release failed",
        });
      }
    }
  };
  // The registration survives every awaited stream, object write and cleanup.
  return coordinator ? coordinator.runDetached("generation-worker", execute) : execute();
}

export function generationSaveTokenIsActive(token: GenerationSaveToken) {
  const state = tokens.get(token);
  return Boolean(state && !state.lost && !state.released && held.get(key(token)) === token);
}
