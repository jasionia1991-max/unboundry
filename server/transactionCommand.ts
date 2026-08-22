import type { DatabaseSync } from "node:sqlite";

const transactionScopeBrand: unique symbol = Symbol("transaction-scope");

export type SqliteTransactionScope = Readonly<{
  prepare: DatabaseSync["prepare"];
  [transactionScopeBrand]: true;
}>;

export interface TransactionScopedCommand<Input, Output> {
  execute(scope: SqliteTransactionScope, input: Input): Output;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function",
  );
}

/**
 * Joins a transaction owned by the caller. The command is synchronous and may
 * neither create nor settle the transaction; the caller retains rollback.
 */
export function executeTransactionScopedCommand<Input, Output>(
  database: DatabaseSync,
  command: TransactionScopedCommand<Input, Output>,
  input: Input,
): Output {
  if (!database.isTransaction) {
    throw new Error("Transaction-scoped command requires an active transaction");
  }
  const scope = Object.freeze({
    prepare: ((sql: string) => {
      if (/^\s*(?:begin|commit|end|rollback|savepoint|release)\b/i.test(sql)) {
        throw new Error("Transaction-scoped command cannot control transactions");
      }
      return database.prepare(sql);
    }) as DatabaseSync["prepare"],
    [transactionScopeBrand]: true as const,
  });
  const result = command.execute(scope, input);
  if (isPromiseLike(result)) {
    throw new Error("Transaction-scoped command must be synchronous");
  }
  if (!database.isTransaction) {
    throw new Error("Transaction-scoped command settled its caller transaction");
  }
  return result;
}
