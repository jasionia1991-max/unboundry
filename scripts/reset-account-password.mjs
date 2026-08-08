// 应急重置任意账号密码（含受保护的最高权限账号）。
// 用法：node scripts/reset-account-password.mjs <loginName>
// 密码从标准输入读取（不回显），不会出现在命令行历史或日志中。
import { createInterface } from "node:readline";
import { openAppDatabase } from "../server/database.ts";
import { hashPassword } from "../server/auth.ts";
import { recordAudit } from "../server/audit.ts";

const loginName = process.argv[2]?.trim().toLocaleLowerCase();
if (!loginName) {
  console.error("用法：node scripts/reset-account-password.mjs <loginName>");
  process.exit(1);
}

function readPassword() {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question("新密码（至少 12 位，输入不会回显）: ", (value) => {
      rl.close();
      resolve(value);
    });
  });
}

const password = await readPassword();
if (typeof password !== "string" || password.length < 12 || password.length > 200) {
  console.error("密码必须为 12–200 位");
  process.exit(1);
}

const database = openAppDatabase();
const row = database
  .prepare("SELECT id, login_name, role, protected FROM users WHERE login_name = ? COLLATE NOCASE")
  .get(loginName);
if (!row) {
  console.error(`账号不存在：${loginName}`);
  process.exit(1);
}

const passwordHash = await hashPassword(password);
database
  .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
  .run(passwordHash, new Date().toISOString(), row.id);
database.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
recordAudit(database, row.id, "reset_password_emergency", row.id, {
  loginName: row.login_name,
});

console.log(
  `已重置账号 ${row.login_name}（${row.role}${row.protected ? "，受保护最高权限" : ""}）的密码，该账号的所有会话已吊销。`,
);
