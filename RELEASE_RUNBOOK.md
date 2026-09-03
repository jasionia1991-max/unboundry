# Unboundry 版本发布 Runbook

给人和接手的 AI 看。作用：从「版本号 + 上线授权」到「线上验证 + 文档收口」的每一步照做，避免每次现场拼命令、用错脚本。
历史基线：v0.6.29（2026-08-21）曾按旧流程发布；其版本号、路径和先打 tag 的命令不再是可执行模板。当前生产身份与发布边界只看 `spec/UNBOUNDRY_CURRENT_STATE.md`、`spec/INC_GEN_026_CHECKPOINT.md` 顶部当前覆盖层和 `上线规矩.md`。

> **2026-09-03 INC-GEN-028 边界**：生产当前为 `v0.7.4/schema42`；用户已选择普通 patch `v0.7.5` 并明确授权本次发布。v0.7.4技术发布成功，但其唯一真实点击在客户端准备阶段耗尽90秒，服务器没有收到Canvas PUT、workflow create或任何run/task/admission/attempt/Provider POST。v0.7.5用独立server-workflow提交锁隔离旧Canvas/单节点工作，先完成权威保存，移除冗余render revision等待，并在list后与POST前检查abort。依次执行定向门、候选冻结和独立Review、PR/双CI、merge后annotated tag/Release、exact-tag fresh build、全新schema42 locked-exact backup、原子切换与rollback-forward。技术健康后，允许在精确Canvas/group真实执行一次；只点一次，结果不明只读核对原run/task，禁止第二次POST。版本不得使用`hotfix`后缀。

**适用范围**：本 Runbook 只用于「代码 / 构建产物」变更（bump 版本、改逻辑、重发静态资源）。纯公共模板数据变更（新增/修改模板、预览图、种子）走 `上线规矩.md` 的「加模板轻量路径」，**不需要版本号、不打标签、不跑全量**，直接提交 + 服务器灌库。

## 0. 前置（必须先满足）

- 用户分别说了「版本号」和「可以上线」，缺一句都不动。一次授权只用一次。
- 删任何东西（含备份目录、临时文件）必须先问用户。
- 测试不碰 `4173`、本地 `app/data`、`/var/lib/unboundry`、真实媒体/备份；不准未授权真实付费生成。
- 两份永久受保护文件都不得读取、hash、复制、移动、修改、删除或暂存：
  `spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json` 与
  `spec/public-templates-director-split-revision.json`。

## 1. 只读核对

```bash
cd <本次 Goal 明确选择且已核对 origin/HEAD/tree 的仓库>
pwd
git branch --show-current
git rev-parse --short HEAD
git status --porcelain=v1 -b
grep '"version"' package.json
```

读 `上线规矩.md`、`spec/UNBOUNDRY_CURRENT_STATE.md`、`TASKS.md` 顶部，确认当前线上版本和上一发布事实。

## 2. 版本号与发布 commit（本地）

1. `package.json`、`package-lock.json` 精确设为用户本次批准的新版本号；普通发布只递增 patch 号，不加 `hotfix` 后缀，也不得复用任何历史版本号。
2. `server/bridgeRuntimeMode.ts` 的 final 角色放行清单加入新版本号。
3. `tests/m81-deployment-hardening.spec.ts` 加对应断言。
4. 按需同步 `上线规矩.md`、`TASKS.md`、`spec/UNBOUNDRY_CURRENT_STATE.md` 等记录。
5. 冻结增量 Review 后，用显式文件清单暂存并 commit；两份受保护 JSON 永远不得进入暂存。先不要打标签，tag 只能落在 PR 合并后的精确 main commit。

## 3. 发布前定向门与 GitHub（本地 Mac）

历史 INC-GEN-026/v0.7.0 已经消费唯一 formal full，永久保留原始 `1162/1167` 与最小关闭 `112/112`；不得把它当作 INC-GEN-028 可重跑或已通过的发布门。下一版本只运行本次变更直接相关 safe specs、增量 Review 和项目规定的 PR/main CI build+m104 门，除非新的明确发布规则另有要求。

本次保留m22、m104、直接依赖节点/上传/工作流spec、m81版本门、共同preflight/build/source coverage、治理m38和冻结后独立Review；备份能力复用v0.7.3已验证且schema未改变的当前合同。不要运行 `node scripts/run-safe-tests.mjs full`。

- 需要Node 22.23.x、npm 10.9.8、Playwright浏览器缓存、npm离线缓存，缺了preflight会明说。
- 测试必须只使用runner新建的临时数据和回环端口；本地4173、`app/data`、`/var/lib/unboundry`、真实媒体和密钥不得触碰。
- v0.6.29 的 `119 specs / 1034 tests` 与 v0.7.0 的 formal 结果只作历史账本，不是 INC-GEN-028 当前命令或分母。当前证据以 `spec/V0_7_3_PRODUCTION_RECEIPT_2026-09-02.json`、`spec/V0_7_4_RELEASE_CANDIDATE_RECEIPT_2026-09-03.json`、Checkpoint 顶部覆盖层和本次新发布回执为准。
- 两份受保护 JSON 不得进入测试快照、archive、commit、tag 或 PR；除此之外，发布候选必须没有范围外脏改动。

候选冻结后按这个顺序执行，不能把 tag 打在 PR 分支头：

```bash
git push origin <branch>
gh pr create --base main --head <branch>
# 等待 PR Quality gates 成功后合并，再等待 main Quality gates 成功。
git fetch origin main --tags
git tag -a <new-version> <merged-main-commit> -m "<new-version>"
git push origin <new-version>
gh release create <new-version> --verify-tag --title "<new-version>"
```

记录 PR 号、final-head run、merge commit、main run、annotated tag object、peeled commit/tree 和 GitHub Release URL。tag、merge 与 release archive 的 tree 必须一致。

## 4. 服务器准备发布目录（staging）

1. 从不可移动 `<new-version>` tag 导出 archive，校验其 peeled commit/tree 与已通过 main CI 的合并身份一致，再解包到全新 `/opt/unboundry/staging/unboundry-<new-version>-<唯一后缀>`；不得同步当前脏工作树或复用旧 dist。
2. 在 staging 内 `npm ci`（完整依赖），然后用 **staging 自身源码**重建产物：

```bash
cd /opt/unboundry/staging/unboundry-<new-version>-<唯一后缀>
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

## 5. 正式备份（当前 schema42：签名、加密、locked-exact）

当前候选只允许 release 内的 `scripts/backup-data.mjs`、
`scripts/verify-backup.mjs`、`scripts/restore-backup.mjs` 合同。调用时必须显式提供
schema42、数据库 logical SHA、生成冻结时间、最后 Provider admission、独立 scratch、
签名私钥路径和恢复公钥路径；任何证据缺失、活动 task、当前 unknown-billing、当前关联的未完成 Provider boundary、活动
publication、SHA 漂移或 schema 漂移都 fail-closed。备份包必须先 verify，再只恢复到
全新 0700 私有目录；禁止覆盖活动数据目录。

schema42 包必须原样保留终态历史 evidence；不得为通过 quiet gate 删除、改写或“收口”历史 task/attempt。只有当前运行边界不静默才阻断 current backup。schema37/38 historical-recovery 继续走其严格旧合同。

生产 wrapper 的候选源为 `ops/production/backup-to-oss-retention.mjs`。默认不上传；
真实 `--apply-upload`、timer 安装/启用、OSS 删除/恢复都需要单独授权和不可变版本回执。
wrapper 必须保留在完整不可变 release tree 的 `ops/production/` 原位置，不得单独复制到
`/opt/unboundry/scripts` 等脱离 `scripts/` 与 `server/` 的路径；内部 child/import 均从
wrapper 的 module URL 解析，不能依赖 systemd 当前目录。
安装前必须记录 wrapper SHA、安装路径/权限、service/timer unit SHA、next-run、
backup/verify/fresh-restore receipt。`ops/production/backup-data-schema39.mjs` 仅是历史标识，
已 fail-closed，不能再作为 current timer 源。

恢复副本只读校验：`PRAGMA user_version = 42`、`integrity_check = ok`、
`foreign_key_check = 0`、logical SHA、关键表计数、媒体和 secrets manifest 与源证据一致。

## 6. 切换上线

```bash
sudo mv /opt/unboundry/staging/unboundry-<new-version>-<唯一后缀> \
  /opt/unboundry/releases/<new-version>-<release-id>
sudo ln -s /opt/unboundry/releases/<new-version>-<release-id> /opt/unboundry/current.next
sudo mv -T /opt/unboundry/current.next /opt/unboundry/current
sudo systemctl restart unboundry
curl -fsS http://127.0.0.1:4173/api/version   # 期望与本次发布版本一致
```

切换前记录旧 `current` 精确目标。新版本首次门通过后，按同一 schema42 数据副本把 `current` 原子切回切换前的精确 release、启动并验证；再原子 forward 到同一 `<new-version>` release 并验证。每次切换都记录 service、version/live/ready、schema/integrity/FK、关键计数、静态清单和 restart 计数。不得运行历史数据 apply，也不得在 rollback/forward 间调用 Provider 或 OSS。

## 7. 发布核验

1. 服务：`systemctl is-active unboundry` = active，`NRestarts` = 0。
2. 数据门（只读）：当前 schema42、integrity ok、FK0、tasks/attempts/templates/active 与本次 schema42 locked-exact 备份基准**完全一致**。旧 schema39 仅属于历史灾难恢复流程，不得用于当前发布核验。
3. 公网：`https://canvas.mymy.ltd/api/version` 与本次发布版本一致；首页引用的 `assets/*.js/css` 逐个 `sha256sum`，与 release `dist/client/assets/*` **逐字节一致**。
4. 外部影响：发布基础设施与rollback-forward期间真实Provider/付费生成/OSS写入必须为0；v0.7.5生产健康后，最新用户授权另允许精确Canvas/group真实执行一次，必须单独记录run/task/attempt/Provider次数，结果不明禁止重试。

## 8. 文档收口

1. 写生产回执：`spec/V<版本>_PRODUCTION_RECEIPT_<日期>.json`（照 `spec/V0_6_19_PRODUCTION_RECEIPT_2026-08-19.json` 结构：source/tests/backup/production/publicAssets/github，`userAcceptance: USER_RECHECK`）。
2. 更新 `上线规矩.md`、`spec/UNBOUNDRY_CURRENT_STATE.md`、`TASKS.md` 顶部、`spec/UNBOUNDRY_HANDOFF_2026-08-09.md`、`spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`：线上版本、指针、commit/tag/PR、备份路径与双清单 SHA、数据门数字、状态写「待用户复验」。
3. commit + push + PR 合并（记录类 PR），提交前再次确认不可提交 json 不在 add 列表。
4. 用户打开线上页面回复「通过」后，另一次文档收口为 `USER PASS`（不要提前写）。

## 9. 已知坑（本次踩过，先看这里）

- schema39 明文脚本只属于历史证据；current timer 必须绑定不可变 schema42 加密 wrapper 的精确 SHA，不能靠同名路径猜版本。
- `scripts/build-release.mjs` 及其 bridge/final 双版本工具固定服务旧 v0.5.2/v0.6.0 不可变演练，不是下一版本发布入口；新版本按精确合并 commit/tag archive fresh build，不得为凑当前版本改写旧工具。
- 发布清单 `RELEASE-INVENTORY.sha256` 不含自身行；生成必须排除自身，否则 `sha256sum -c` 永远失败（v0.6.18 也是自包含旧行、发布时以排除自身为准）。
- `find | xargs sha256sum` 遇 node_modules 里带空格/换行的文件名会断；统一用 `-print0 | sort -z | xargs -0`。
- staging 的 dist 若与源码来源不明，**重建**后再发布；重算清单在重建之后。
- current schema42 备份必须使用外部私有 key 文件；密钥内容不得写进仓库、命令回执或备份 manifest。
- 备份目录父级 `/var/lib/unboundry-rollbacks` 是 root 0700，ubuntu 直接 ls 会 Permission denied；用 `sudo` 查看/操作。
