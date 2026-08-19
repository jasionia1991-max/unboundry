# Unboundry 版本发布 Runbook

给人和接手的 AI 看。作用：从「版本号 + 上线授权」到「线上验证 + 文档收口」的每一步照做，避免每次现场拼命令、用错脚本。
基线：v0.6.21（2026-08-19）按本流程发布并核验通过；本文不替代 `上线规矩.md` 的授权纪律。

## 0. 前置（必须先满足）

- 用户分别说了「版本号」和「可以上线」，缺一句都不动。一次授权只用一次。
- 删任何东西（含备份目录、临时文件）必须先问用户。
- 测试不碰 `4173`、本地 `app/data`、`/var/lib/unboundry`、真实媒体/备份；不准未授权真实付费生成。
- 不能提交的文件：`spec/public-templates-director-split-revision.json`（保持 untracked，不 add、不删）。

## 1. 只读核对

```bash
cd /Users/mymy/Documents/unboundry/app
pwd
git branch --show-current
git rev-parse --short HEAD
git status --porcelain=v1 -b
grep '"version"' package.json
```

读 `上线规矩.md`、`spec/UNBOUNDRY_CURRENT_STATE.md`、`TASKS.md` 顶部，确认当前线上版本和上一发布事实。

## 2. 版本号与发布 commit（本地）

1. `package.json`、`package-lock.json` 版本号 +1（如 `0.6.18` → `0.6.19`）。
2. `server/bridgeRuntimeMode.ts` 的 final 角色放行清单加入新版本号。
3. `tests/m81-deployment-hardening.spec.ts` 加对应断言。
4. 按需同步 `上线规矩.md`、`TASKS.md`、`spec/UNBOUNDRY_CURRENT_STATE.md` 等记录。
5. commit（如 `feat: ... bump to v0.6.19`），打**注释标签**：

```bash
git add <明确文件列表>   # 不要 git add -A，避开不可提交 json
git commit -m "..."
git tag -a v0.6.19 -m "v0.6.19"
git push origin <branch>
git push origin v0.6.19
```

6. 用 `gh` 开 PR 并合并到 `main`（squash），记录 merge commit。

## 3. 发布前全量安全测试（本地 Mac）

```bash
node scripts/run-safe-tests.mjs preflight
node scripts/run-safe-tests.mjs full
```

- 需要 Node 22.23.1（`/Users/mymy/.hermes/node/bin/node`）、npm 10.9.8、Playwright 浏览器缓存、npm 离线缓存，缺了 preflight 会明说。
- 沙箱内跑会因端口 EPERM 失败，**必须在非沙箱环境**跑。
- 通过标准：`118/118 specs、986/986 tests PASS`，failed/skipped/retries/blocked/reportErrors 全 0，`listener4173` unchanged。

## 4. 服务器准备发布目录（staging）

1. 把精确源码（对应已合并的 commit）同步到 `/opt/unboundry/staging/unboundry-v<版本>`（如 `git archive` 解包或 scp 源码树）。
2. 在 staging 内 `npm ci`（完整依赖），然后用 **staging 自身源码**重建产物：

```bash
cd /opt/unboundry/staging/unboundry-v0.6.19
/opt/node22/bin/node /opt/unboundry/node_modules/typescript/bin/tsc --noEmit
/opt/node22/bin/node node_modules/vite/bin/vite.js build
```

- 坑：**不能沿用旧 dist**。v0.6.18/19 的服务器 release `node_modules` 只有 dependencies（无 typescript），构建工具用 `/opt/unboundry/node_modules`（vite 8.1.5 / typescript 7.0.2 需与 staging lock 版本一致）。
3. 重算发布清单（**排除清单自身**，用 NUL 分隔处理特殊文件名）：

```bash
find . -type f -not -name RELEASE-INVENTORY.sha256 -print0 \
  | LC_ALL=C sort -z | xargs -0 sha256sum > RELEASE-INVENTORY.sha256
sha256sum -c RELEASE-INVENTORY.sha256 --quiet && echo INVENTORY_OK
```

## 5. 正式备份（v0.6.18/19 同款：明文快照 + 恢复副本 + 双清单）

注意：正式发布备份用的是服务器 `/opt/unboundry/scripts/backup-data.mjs`（旧明文格式），**不是** release 里那套加密版 backup-data.mjs。二者不要混。

```bash
ROOT=/var/lib/unboundry-rollbacks/v0.6.19-frozen-<随机6字符>
sudo mkdir -p "$ROOT"
sudo /opt/node22/bin/node /opt/unboundry/scripts/backup-data.mjs \
  --data-dir /var/lib/unboundry --backup-root "$ROOT"
SRC=$(sudo ls -d "$ROOT"/*/ | head -1)      # 时间戳子目录
sudo mv "$SRC" "$ROOT/frozen-source"
cd "$ROOT/frozen-source"
find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sudo tee "$ROOT/frozen.sha256" >/dev/null
sudo cp -a "$ROOT/frozen-source" "$ROOT/restore-copy"
cd "$ROOT/restore-copy"
find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sudo tee "$ROOT/restore.sha256" >/dev/null
sudo diff -q "$ROOT/frozen.sha256" "$ROOT/restore.sha256" && echo MANIFEST_MATCH
```

校验恢复副本数据库（只读）：`PRAGMA user_version` = 39、`integrity_check` = ok、`foreign_key_check` = 0；记下 tasks / attempts / public_templates(published) / active 计数，作为切换前后数据门基准。

## 6. 切换上线

```bash
sudo mv /opt/unboundry/staging/unboundry-v0.6.19 \
  /opt/unboundry/releases/v0.6.19-<描述>-20260819
sudo ln -s /opt/unboundry/releases/v0.6.19-<描述>-20260819 /opt/unboundry/current.next
sudo mv -T /opt/unboundry/current.next /opt/unboundry/current
sudo systemctl restart unboundry
curl -fsS http://127.0.0.1:4173/api/version   # 期望 {"version":"0.6.19"}
```

## 7. 发布核验

1. 服务：`systemctl is-active unboundry` = active，`NRestarts` = 0。
2. 数据门（只读）：schema39、integrity ok、FK0、tasks/attempts/templates/active 与备份基准**完全一致**。
3. 公网：`https://canvas.mymy.ltd/api/version` = 0.6.19；首页引用的 `assets/*.js/css` 逐个 `sha256sum`，与 release `dist/client/assets/*` **逐字节一致**。
4. 外部影响：真实 Provider / 付费生成 / OSS 写入 = 0。

## 8. 文档收口

1. 写生产回执：`spec/V<版本>_PRODUCTION_RECEIPT_<日期>.json`（照 `spec/V0_6_19_PRODUCTION_RECEIPT_2026-08-19.json` 结构：source/tests/backup/production/publicAssets/github，`userAcceptance: USER_RECHECK`）。
2. 更新 `上线规矩.md`、`spec/UNBOUNDRY_CURRENT_STATE.md`、`TASKS.md` 顶部、`spec/UNBOUNDRY_HANDOFF_2026-08-09.md`、`spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`：线上版本、指针、commit/tag/PR、备份路径与双清单 SHA、数据门数字、状态写「待用户复验」。
3. commit + push + PR 合并（记录类 PR），提交前再次确认不可提交 json 不在 add 列表。
4. 用户打开线上页面回复「通过」后，另一次文档收口为 `USER PASS`（不要提前写）。

## 9. 已知坑（本次踩过，先看这里）

- 服务器 `/opt/unboundry/scripts/backup-data.mjs` 是旧明文脚本；release 里的 `backup-data.mjs` 是加密版，两者目录结构不同，别用错。
- 发布清单 `RELEASE-INVENTORY.sha256` 不含自身行；生成必须排除自身，否则 `sha256sum -c` 永远失败（v0.6.18 也是自包含旧行、发布时以排除自身为准）。
- `find | xargs sha256sum` 遇 node_modules 里带空格/换行的文件名会断；统一用 `-print0 | sort -z | xargs -0`。
- staging 的 dist 若与源码来源不明，**重建**后再发布；重算清单在重建之后。
- 明文备份流程不需要密钥；加密版才需要 `--signing-private-key` / `--recovery-public-key`。
- 备份目录父级 `/var/lib/unboundry-rollbacks` 是 root 0700，ubuntu 直接 ls 会 Permission denied；用 `sudo` 查看/操作。
