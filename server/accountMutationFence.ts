import type { DatabaseSync } from "node:sqlite";

export type AccountMutationBlockedCode =
  | "ACCOUNT_DELETE_ACTIVE"
  | "ACCOUNT_DISABLED";

export class AccountMutationBlockedError extends Error {
  constructor(readonly code: AccountMutationBlockedCode) {
    super(
      code === "ACCOUNT_DELETE_ACTIVE"
        ? "账号删除正在进行，不能再修改账号资料"
        : "账号不可用，不能再修改账号资料",
    );
    this.name = "AccountMutationBlockedError";
  }
}

/**
 * Final-commit fence for mutations owned or authorized by one account.
 * The authoritative final-commit call must hold BEGIN IMMEDIATE so account
 * deletion and the mutation have one unambiguous SQLite commit order. A caller
 * may also use it before expensive work as a best-effort early rejection.
 */
export function assertAccountMutationAllowed(
  database: DatabaseSync,
  accountId: string,
  options: Readonly<{ allowDisabled?: boolean }> = {},
) {
  const row = database.prepare(`
    SELECT
      users.status,
      EXISTS (
        SELECT 1
        FROM account_delete_intents
        WHERE owner_id = users.id
      ) AS delete_active
    FROM users
    WHERE users.id = ?
  `).get(accountId) as
    | { delete_active: number; status: "active" | "disabled" }
    | undefined;
  if (Number(row?.delete_active) === 1) {
    throw new AccountMutationBlockedError("ACCOUNT_DELETE_ACTIVE");
  }
  if (
    !row ||
    (row.status !== "active" &&
      !(options.allowDisabled && row.status === "disabled"))
  ) {
    throw new AccountMutationBlockedError("ACCOUNT_DISABLED");
  }
}
