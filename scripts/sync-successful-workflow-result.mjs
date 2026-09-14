#!/usr/bin/env node

/*
 * Narrow historical-result control point.
 *
 * This command is intentionally scoped to one owner/canvas/run/node/task and
 * one execution attempt.  Dry-run is read-only.  Apply requires the exact
 * proof returned by dry-run and rechecks it in a write transaction;
 * it has no Provider or object-storage capability.
 */

import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, isAbsolute, normalize, relative, resolve, sep, join } from "node:path";
import "./node-typescript-runtime.mjs";

const expectedSchemaVersion = 44;

class HistoricalResultSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HistoricalResultSyncError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new HistoricalResultSyncError(code, message);
}

function parseArguments(argv) {
  const values = new Map();
  let mode;
  const valueOptions = new Set([
    "--data-dir",
    "--owner-id",
    "--canvas-id",
    "--run-id",
    "--node-id",
    "--task-id",
    "--execution-attempt",
    "--expected-proof-sha256",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--dry-run" || option === "--apply") {
      if (mode) fail("HISTORICAL_SYNC_ARGUMENT_INVALID", "只允许一个操作模式");
      mode = option === "--apply" ? "apply" : "dry-run";
      continue;
    }
    if (!valueOptions.has(option) || values.has(option)) {
      fail("HISTORICAL_SYNC_ARGUMENT_INVALID", "范围参数未知或重复");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("HISTORICAL_SYNC_ARGUMENT_INVALID", "范围参数缺少值");
    }
    values.set(option, value);
    index += 1;
  }
  if (!mode || [...valueOptions].filter(option => option !== "--expected-proof-sha256").some((option) => !values.has(option))) {
    fail(
      "HISTORICAL_SYNC_ARGUMENT_INVALID",
      "必须明确选择dry-run或apply，并提供完整单节点范围",
    );
  }
  const dataDirectory = values.get("--data-dir");
  if (!isAbsolute(dataDirectory) || normalize(dataDirectory) !== dataDirectory ||
      resolve(dataDirectory) !== dataDirectory || dataDirectory.includes("\0")) {
    fail("HISTORICAL_SYNC_ARGUMENT_INVALID", "数据目录必须是规范化绝对路径");
  }
  const executionAttempt = Number(values.get("--execution-attempt"));
  if (!Number.isSafeInteger(executionAttempt) || executionAttempt < 1) {
    fail("HISTORICAL_SYNC_ARGUMENT_INVALID", "execution-attempt必须是正整数");
  }
  const scope = Object.fromEntries([
    ["canvasId", values.get("--canvas-id")],
    ["nodeId", values.get("--node-id")],
    ["ownerId", values.get("--owner-id")],
    ["runId", values.get("--run-id")],
    ["taskId", values.get("--task-id")],
  ]);
  if (Object.values(scope).some((value) => typeof value !== "string" ||
      value.length < 1 || value.length > 256 || value.includes("\0"))) {
    fail("HISTORICAL_SYNC_ARGUMENT_INVALID", "单节点范围标识无效");
  }
  const expectedProof = values.get("--expected-proof-sha256");
  if ((mode === "apply" && !/^[a-f0-9]{64}$/.test(expectedProof ?? "")) ||
      (mode === "dry-run" && expectedProof !== undefined)) {
    fail("HISTORICAL_SYNC_PROOF_REQUIRED", "apply必须提供dry-run返回的完整proofSha256");
  }
  return Object.freeze({ dataDirectory, executionAttempt, expectedProof, mode, ...scope });
}

function isInside(parent, child) {
  const difference = relative(parent, child);
  return difference === "" || (!isAbsolute(difference) && difference !== ".." &&
    !difference.startsWith(`..${sep}`));
}

function privateDirectory(path) {
  const requested = realpathSync(path);
  const details = lstatSync(requested, { bigint: true });
  const uid = typeof process.getuid === "function" ? BigInt(process.getuid()) : undefined;
  if (uid === undefined || !details.isDirectory() || details.isSymbolicLink() ||
      details.uid !== uid || (details.mode & 0o022n) !== 0n || requested !== path) {
    fail("HISTORICAL_SYNC_DATA_INVALID", "数据目录必须是当前账号拥有的私有目录");
  }
  return requested;
}

function privateDatabase(dataDirectory) {
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const details = lstatSync(databasePath, { bigint: true });
  const uid = typeof process.getuid === "function" ? BigInt(process.getuid()) : undefined;
  const canonical = realpathSync(databasePath);
  if (uid === undefined || !details.isFile() || details.isSymbolicLink() ||
      details.uid !== uid || details.nlink !== 1n || (details.mode & 0o022n) !== 0n ||
      canonical !== databasePath || dirname(canonical) !== dataDirectory ||
      !isInside(dataDirectory, canonical)) {
    fail("HISTORICAL_SYNC_DATABASE_INVALID", "数据库必须是目录内私有普通文件");
  }
  return databasePath;
}

function proofSha256(input, result) {
  if (!result.operationId || !result.payloadSha256 ||
      !["ready", "already-synced"].includes(result.status)) return undefined;
  return createHash("sha256").update(JSON.stringify({
    version: 1, dataDirectory: input.dataDirectory, ownerId: input.ownerId,
    canvasId: input.canvasId, runId: input.runId, nodeId: input.nodeId,
    taskId: input.taskId, executionAttempt: input.executionAttempt,
    operationId: result.operationId, payloadSha256: result.payloadSha256,
  })).digest("hex");
}

let database;
let transactionOpen = false;
try {
  const input = parseArguments(process.argv.slice(2));
  const dataDirectory = privateDirectory(input.dataDirectory);
  const databasePath = privateDatabase(dataDirectory);
  const {
    currentSchemaVersion,
    databaseMatchesSchemaContract,
  } = await import("../server/database.ts");
  const {
    inspectHistoricalWorkflowResultSyncInTransaction,
    syncHistoricalWorkflowResultInTransaction,
  } = await import("../server/workflowRunService.ts");
  database = new DatabaseSync(databasePath, {
    readOnly: input.mode === "dry-run",
    timeout: 5_000,
  });
  database.exec("PRAGMA foreign_keys = ON");
  const version = Number(database.prepare("PRAGMA user_version").get()?.user_version);
  if (version !== expectedSchemaVersion || version !== currentSchemaVersion ||
      !databaseMatchesSchemaContract(database)) {
    fail("HISTORICAL_SYNC_SCHEMA_INVALID", "只接受当前schema44数据库");
  }
  if (input.mode === "dry-run") {
    database.exec("PRAGMA query_only = ON; BEGIN");
    transactionOpen = true;
    const result = inspectHistoricalWorkflowResultSyncInTransaction(database, input);
    database.exec("ROLLBACK");
    transactionOpen = false;
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: input.mode,
      mutation: "none",
      ...result,
      proofSha256: proofSha256(input, result),
    })}\n`);
  } else {
    database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const inspection = inspectHistoricalWorkflowResultSyncInTransaction(database, input);
    if (proofSha256(input, inspection) !== input.expectedProof) {
      fail("HISTORICAL_SYNC_PROOF_CHANGED", "原结果或画布证据已变化，未写入；请重新dry-run核对");
    }
    const result = syncHistoricalWorkflowResultInTransaction(database, input);
    database.exec("COMMIT");
    transactionOpen = false;
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: input.mode,
      mutation: result.status === "applied" ? "canvas-and-receipt" : "none",
      ...result,
    })}\n`);
  }
} catch (error) {
  if (transactionOpen && database.isTransaction) database.exec("ROLLBACK");
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error instanceof HistoricalResultSyncError ? error.code : "HISTORICAL_SYNC_FAILED",
    error: error instanceof Error ? error.message : "历史结果同步失败",
  })}\n`);
  process.exitCode = 1;
} finally {
  database?.close();
}
