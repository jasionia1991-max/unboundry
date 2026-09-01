import { randomUUID } from "node:crypto";
import { statfs } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { appDataDirectory, openAppDatabase } from "./database";
import { genericReferenceMediaRules } from "./providerMedia";
import type { NodeInputKind } from "../types/nodeInputs";
import { ResourceBudgetError } from "./resourceBudget";

const minimumFreeBytes = 1_024 * 1_024 * 1_024;
const reservationLifetimeMs = 24 * 60 * 60 * 1_000;

/** Media-domain estimate: durable result plus recoverable staging/pending copy. */
export function estimateWorkflowMediaCapacityBytes(kinds: readonly NodeInputKind[]) {
  const bytes = kinds.reduce((total, kind) => {
    if (kind === "text") return total;
    return total + genericReferenceMediaRules[kind]!.maxBytes * 2;
  }, 0);
  return Math.max(bytes, 1);
}

export async function inspectWorkflowMediaCapacity(
  bytes: number,
  otherReservedBytes = 0,
) {
  const fileSystem = await statfs(appDataDirectory());
  const availableBytes = Number(BigInt(fileSystem.bavail) * BigInt(fileSystem.bsize));
  if (
    !Number.isSafeInteger(bytes) || bytes < 1 ||
    !Number.isSafeInteger(otherReservedBytes) || otherReservedBytes < 0 ||
    availableBytes < bytes + otherReservedBytes + minimumFreeBytes
  ) {
    throw new ResourceBudgetError(
      "INSUFFICIENT_STORAGE",
      507,
      "整组所需的结果与恢复暂存空间不足，未提交付费请求",
    );
  }
  return {
    availableBytes,
    minimumFreeBytes,
    otherReservedBytes,
    requiredBytes: bytes,
  } as const;
}

export function reserveWorkflowMediaCapacityInTransaction(input: {
  bytes: number;
  inspectedAvailableBytes?: number;
  database: DatabaseSync;
  now?: Date;
  ownerId: string;
  runId: string;
}) {
  if (!input.database.isTransaction) {
    throw new Error("Workflow media reservation requires an existing transaction");
  }
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  input.database.prepare(`
    UPDATE media_capacity_reservations
    SET state = 'expired', updated_at = ?, released_at = ?
    WHERE state = 'active' AND expires_at <= ?
  `).run(timestamp, timestamp, timestamp);
  const active = input.database.prepare(`
    SELECT COALESCE(SUM(reserved_bytes), 0) AS bytes
    FROM media_capacity_reservations WHERE state = 'active'
  `).get() as { bytes?: unknown } | undefined;
  const processLimit = 2 * 1_024 * 1_024 * 1_024;
  const activeBytes = Number(active?.bytes ?? 0);
  if (
    activeBytes + input.bytes > processLimit ||
    input.inspectedAvailableBytes !== undefined && (
      !Number.isSafeInteger(input.inspectedAvailableBytes) ||
      input.inspectedAvailableBytes < activeBytes + input.bytes + minimumFreeBytes
    )
  ) {
    throw new ResourceBudgetError(
      "RESOURCE_BUSY",
      429,
      "整组媒体容量正在被其他任务占用，未提交付费请求",
    );
  }
  const id = randomUUID();
  input.database.prepare(`
    INSERT INTO media_capacity_reservations (
      id, owner_id, workflow_run_id, reserved_bytes, state, expires_at,
      created_at, updated_at, released_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL)
  `).run(
    id,
    input.ownerId,
    input.runId,
    input.bytes,
    new Date(now.getTime() + reservationLifetimeMs).toISOString(),
    timestamp,
    timestamp,
  );
  return id;
}

export async function recheckWorkflowMediaCapacity(reservationId: string) {
  const database = openAppDatabase();
  try {
    const row = database.prepare(`
      SELECT reserved_bytes, state, expires_at
      FROM media_capacity_reservations WHERE id = ?
    `).get(reservationId) as
      | { expires_at?: unknown; reserved_bytes?: unknown; state?: unknown }
      | undefined;
    if (
      !row || row.state !== "active" ||
      String(row.expires_at) <= new Date().toISOString()
    ) {
      throw new ResourceBudgetError(
        "INSUFFICIENT_STORAGE",
        507,
        "整组容量预留已失效，未提交付费请求",
      );
    }
    const other = database.prepare(`
      SELECT COALESCE(SUM(reserved_bytes), 0) AS bytes
      FROM media_capacity_reservations
      WHERE state = 'active' AND id <> ? AND expires_at > ?
    `).get(reservationId, new Date().toISOString()) as
      | { bytes?: unknown }
      | undefined;
    return inspectWorkflowMediaCapacity(
      Number(row.reserved_bytes),
      Number(other?.bytes ?? 0),
    );
  } finally {
    database.close();
  }
}

export function releaseWorkflowMediaCapacity(reservationId: string, now = new Date()) {
  const database = openAppDatabase();
  try {
    const timestamp = now.toISOString();
    database.prepare(`
      UPDATE media_capacity_reservations
      SET state = 'released', updated_at = ?, released_at = ?
      WHERE id = ? AND state = 'active'
    `).run(timestamp, timestamp, reservationId);
  } finally {
    database.close();
  }
}

export function releaseWorkflowMediaCapacityInTransaction(input: {
  database: DatabaseSync;
  now?: Date;
  runId: string;
}) {
  if (!input.database.isTransaction) {
    throw new Error("Workflow media release requires an existing transaction");
  }
  const timestamp = (input.now ?? new Date()).toISOString();
  input.database.prepare(`
    UPDATE media_capacity_reservations
    SET state = 'released', updated_at = ?, released_at = ?
    WHERE workflow_run_id = ? AND state = 'active'
  `).run(timestamp, timestamp, input.runId);
}
