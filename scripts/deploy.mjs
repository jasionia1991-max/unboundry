import { execFileSync } from "node:child_process";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const version = argument("--version");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("用法：node scripts/deploy.mjs --version 0.2.0 [--ssh live-cockpit]");
}
const sshHost = argument("--ssh") ?? "live-cockpit";

function step(label) {
  console.log(`[deploy] ${label}`);
}

step(`版本号 -> v${version}`);
execFileSync("npm", ["version", version, "--no-git-tag-version"], {
  stdio: "inherit",
});

step("本地构建");
execFileSync("npm", ["run", "build"], { stdio: "inherit" });

step("提交与打标签");
execFileSync("git", ["add", "package.json", "package-lock.json"]);
execFileSync("git", ["commit", "-m", `release: v${version}`]);
execFileSync("git", [
  "tag",
  "-a",
  `v${version}`,
  "-m",
  `Unboundry v${version}`,
]);

step("同步服务器代码");
execFileSync(
  "rsync",
  [
    "-az",
    "--delete",
    "--exclude",
    ".git",
    "--exclude",
    "node_modules",
    "--exclude",
    "data",
    "--exclude",
    "backups",
    "--exclude",
    "tmp",
    "--exclude",
    "test-results",
    "--exclude",
    "dist",
    "--exclude",
    "playwright-report",
    "./",
    `${sshHost}:/opt/unboundry/`,
  ],
  { stdio: "inherit" },
);

step("服务器构建与重启");
const remote = [
  "cd /opt/unboundry",
  "export PATH=/opt/node22/bin:$PATH",
  "npm run build",
  "sudo systemctl restart unboundry.service",
  "sleep 3",
  "curl -fsS http://127.0.0.1:4173/api/version",
].join(" && ");
const output = execFileSync(
  "ssh",
  ["-o", "BatchMode=yes", sshHost, remote],
  { encoding: "utf8" },
);
console.log(output.trim());
if (!output.includes(`"version":"${version}"`)) {
  throw new Error("服务器版本校验失败，发布中止（未推送）");
}

step("推送 GitHub");
execFileSync("git", ["push", "origin", "main", "--tags"], { stdio: "inherit" });
console.log(`[deploy] v${version} 发布完成`);
