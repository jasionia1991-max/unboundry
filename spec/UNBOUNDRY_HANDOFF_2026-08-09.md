# Unboundry（无央）项目交接文档

> 写给下一个接手的人/AI agent。目标：看完本文后不需要向用户问“项目在哪、怎么跑、怎么发布、有什么红线”。

## 0. 2026-08-09 全量修复施工模式

用户已于 2026-08-09 确认施工文档并启动一次性离线 Goal，当前为 `REM-000 = PASS / REM-001～REM-011 = USER_REVIEW`；REM-010/011 的 `USER_REVIEW` 仅指离线工程完成，不是用户 PASS、原生产核验或发布许可。最终 fixed clean offline candidate 为 commit `8b639ffe6c5f091c51e1914f2e2c18edf9333d90` / tree `219c4df072426cfe92f33dc4045f021064972e9c`，429-file source/snapshot SHA-256 `652b946441ee46e43bcbfbfc635dfc5aaacf5e640529ebec5bc7bd34c798dbb0`。三个独立全新环境 full 各 `117/117 specs、931/931 PASS`，合计 `2793/2793`；两包竞态压力各 `570/570 PASS`，合计 `1140/1140`，覆盖5个spec各20次；异常计数全0，4173 listener `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae` 不变。离线G0～G6全绿，G7 pending，package仍为`0.5.1`，production HOLD。

历史 REM-009B 证据保持为：父 HEAD `bbcd5e0f6ca2096ed433d5ac45019c19aab50c53` 的同内容脏树、source SHA-256 `7cf46804f952e580e9574a08a93f42ad53c051d4fcd5f2705691f82c8330326b`，核心三轮 `399/399`、安全全量 `114/114 spec、912/912 PASS`，源码 `303 = 283 TS/TSX + 20 JS/MJS`、运维脚本 `15 = 12 行为 + 3 冻结`；它不是当前 REM-010 结果、用户 PASS、真实数据/Provider/OSS、生产迁移或发布证明。

`1e96e26f…` 属于 m92 fixture 窄修复后、上一轮六文档同步前的脏功能树。此后用户实页发现 default 卡片错误路由和 Video 重复 Prompt 两个自动检查缺口；当前候选已修正并由 m11+m30 安全定向 `17/17 PASS`（源码快照 `f714feb259dae032d61ad751feb5e67bb0bde07ea6cb0e6d026ecf07b903f9be`、零任务/零付费 Provider、4173 listener不变）。用户随后在端口 58352 的隔离实页明确确认两项修改均通过，`CANVAS-019 / INPUT-005` 恢复为 `PASS`。页面修复后的首轮 full `930/931` 唯一暴露 m44 协作 current-open reservation 创建/释放竞态，属于真实产品并发缺口；产品协议修复后 m44+m91 targeted `15/15 PASS`，fresh full 为 `117/117 specs、931/931 PASS`，异常计数全0、denied534、builder 1/3/1/0。证据绑定 HEAD `9a76edc3…` 下 429-file tested source snapshot `db91d80b2605d638f5cb2df296a81292b52dcf4b98fa874e934e83737495532f`，4173 listener不变，suite cleaned、exit0。

上述脏树先冻结为 candidate `b9b4691a1d06d8321578b7552ea5e14b23fb85e2`，但两个 OS 进程 Provider save 压力运行被最后旧 SQLite writer 关闭时的真实 WAL/SHM 交接竞态击穿，故该候选失效。最终 `8b639ffe…` 采用 held-reader 窄修复：完整 WAL/SHM 对（含 zero-byte WAL）用普通只读 inspection，并把读事务保持到新 writer 取得 `BEGIN IMMEDIATE`、完成 identity/sidecar/schema/digest 复核后再释放；不安全替换仍 fail-close，m91 对 hot-WAL 与 zero-WAL 均有确定性回归。

Docker Ubuntu 子门的 rootless-userns 阻塞已按设计 fail-close。随后用户只授权第二台、非原生产 Ubuntu 24.04 x86_64 验证机：首次 production builder 发现空 `@playwright` scope 误判并 fail-close，窄修复后 r2 对一次性 clean ephemeral commit 真实 PASS。tar SHA-256 `a322ec21affe7c2e73c510fceb74d5c953bee213b25084954b735f18d7be494b`，commit `ef206cd3dcc94ea6657a12ab7963580fe4e9bb5c` / tree `ab68ce7d3725869e674a7b7a7c3fdb0b74e5d29e`，`formalReleaseCommit=false`；manifest SHA-256 `79e5d45dfbb9e51ec7fc60e1f5527a11f30f1d3d9638b682741c4306a25db02a`，5270 条 inventory 一致，release 0500、无 `.incomplete`，bwrap 网络 namespace 探针通过，构建步骤未观察到外网尝试。active/maintenance `nginx -t` 与 `systemd-analyze verify` PASS，现有 nginx/Docker 未修改/reload/restart，4173 为 0。最终fixed candidate的离线G0～G6与REM-011三轮后来均已全绿，但不构成原生产核验。production HOLD：G7、正式版本号和独立发布授权仍待完成；仅第二验证机 SSH 获本次授权，原生产、push/tag/PR/release/production仍禁止。一次独立审计曾越权对 `app/data` 执行 immutable 只读聚合查询，结果未纳入证据、写入和外部请求为 0，之后未再访问。当前必须先读：

1. 仓库根 `AGENTS.md`；
2. `README.md`；
3. `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md`；
4. `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`；
5. 本交接文档；
6. `TASKS.md` 与验收矩阵当前 REM 区块。

`REM-000` 已为 `PASS`。本轮 Goal 的允许动作、决策默认和停止边界已写入施工断点；恢复者不得把这份离线授权扩张到任何生产动作。

## 1. 项目一句话

一个 TapNow 风格的 AI 画布应用（React + Vite + Node 原生 SQLite），支持文本/图片/视频/音频生成节点、连线工作流、模板、多项目工作空间、账号与管理员权限。当前**已发布到生产服务器** `canvas.mymy.ltd`，线上版本 v0.5.1。

## 2. 仓库与环境

- 仓库根：`/Users/mymy/Documents/unboundry/app`（注意：系统工作区根目录写的是 `tapnow1_1复刻`，那个路径在本机不存在，**一律用 unboundry/app**）。
- Git：当前专用分支 `codex/unboundry-offline-remediation-2026-08-09`，远程 `https://github.com/jasionia1991-max/unboundry.git`；最近标签 `v0.4.7`～`v0.5.1`，本 Goal 禁止 push/tag/PR。
- Node：离线施工已固定 `/Users/mymy/.local/bin/node`（指向 `/Users/mymy/.hermes/node/bin/node`）`v22.23.1` 与 npm `10.9.8`；`.node-version`、packageManager/engines 和安全 runner 会共同校验。历史部署计划记录原生产曾为 `v22.23.2`，原生产未获 SSH 授权，不能用第二验证机声称当前生产精确版本已复核。
- 历史依赖/检查方式曾为 `npm install`、`npx tsc --noEmit`、`npm run build`，仍不得直接作为施工入口。当前唯一安全总入口是 `node scripts/run-safe-tests.mjs <preflight|list|run|full>`；它在跟踪文件隔离快照内用 `npm ci --offline --ignore-scripts` 准备依赖，并统一执行源码、构建、重启和测试门禁。
- 代码结构速览：
  - `client/src/canvas/`：画布（`CanvasSurface.tsx` 是核心，`CanvasShell.tsx` 是外壳）、各类节点（Image/Text/Video/Audio/Group…）；
  - `client/src/generation/`：生成提交、轮询、错误文案；
  - `client/src/projects/`：工作空间；
  - `server/`：所有 API 与业务（`auth.ts` 账号/会话/权限、`generationSafety.ts` 并发/频率/熔断、`generationTasks.ts` 生成任务、`modelCatalog.ts` 模型、`projects.ts` 项目、`canvasPersistence.ts` 画布存取、`database.ts` 迁移）；
  - `vite.config.ts`：把所有 `server/*` API 挂到 `/api/*`（dev 与 preview 都注册）；
  - `types/`：跨端共享类型。

## 3. 历史命令清单（FROZEN，不是当前授权）

以下命令只用于解释旧项目历史，REM-001/009/010 对应安全替代完成且用户另行授权前，**禁止直接执行**：

- `npm run dev`：会使用真实本地 4173 和 `app/data`；施工测试禁止；
- `npm run build` / `npm run check:greenfield`：只在对应 REM 获授权并进入隔离工作区后执行；
- `npm run data:backup`：REM-009A 已改为显式 `--source-frozen`、绝对路径和包外密钥的加密入口；本离线 Goal 仍禁止把它指向 `app/data`、生产或任何真实数据，真实备份必须等用户另行授权；
- `node scripts/deploy.mjs --version X.Y.Z`：旧一体化入口现已立即 fail-close；REM-010 完成且用户另行授权正式版本号与发布前，禁止执行任何替代发布入口；
- `node scripts/reset-account-password.mjs ...`：离线候选已改为默认 dry-run，apply 需要显式可信数据目录、目标账号、有效管理员 actor 与隐藏 TTY 或私密绝对密码文件；真实账号应急操作仍必须另获用户明确授权。

## 4. 测试纪律（非常重要）

- **绝不**用真实数据/真实 4173 跑测试：所有测试用临时数据目录 + 独立端口。
- 2026-08-09 全量审计确认：旧推荐回归组合去重后只覆盖约 80/105 个 spec、391/519 项既有测试，且多处使用固定端口、共享临时库或仓库 tmp。它们只能作为历史基线，不能作为新候选的“真正全量”绿灯。
- REM-009B 历史安全清单精确覆盖114个spec、912项测试；最终fixed clean offline candidate的当前发现清单为117 specs/931 tests，已完成三个独立全新环境full（各931/931、合计2793/2793）与两包5-spec竞态压力（各570/570、合计1140/1140）。每个spec使用独立新临时目录与两个动态loopback端口；Node/浏览器禁止非loopback与未登记本机端口；safe runner/tests真实路径成功访问为0。该证据仅使REM-010/011离线工程进入USER_REVIEW，不是生产或发布证明。REM-008的历史891/891与旧指纹不冒充当前inventory。
- 默认 `npm run verify` 与下面固定端口配置仍是冻结历史，不得绕过安全总入口；`package.json` 中旧测试脚本已改为 fail-closed 或转入安全入口。
- 历史通用测试配置：`--config=playwright.4174.config.ts`（端口 4174、临时数据目录、auth bypass）。
- `npm run verify` 现已委托给安全总入口；仍禁止直接调用 Vite、默认 Playwright 配置或下列历史固定端口脚本绕过 runner。
- 端口地图（每套件独立 config）：
  - 4174：通用（playwright.4174）
  - 4175：m58；4176：m14（config webServer）/m60；4177：m61；4178：m62；4179：m63；4182：m64；4183：m65；
  - 4191：m77；4192：m71 回归；4193：m72/m79；4194：m11/m73；4197：m74 回归；4198：m75 全量、m78（m14 的 spec 内部也自拉起 4198）。
  - 说明：m11/m77/m78 等“无 bypass”套件在 spec 内部自己拉起端口和临时目录；单元类 config（m38/40/47/49/53/54/55/57/59/model-runtime）多为纯 Node，不需要 webServer。
- 历史回归组合：`tests/m75-full.config.ts`、`m71-regression`、`m74-regression`、`m79`、`npm run test:restart`、fixture-production；它只覆盖约 80/105 spec、391/519 项，禁止称为最终全量。
- 日常与候选迁移测试只允许程序化合成的旧 schema 数据；未获真实数据专项授权，不得复制、打开或迁移 `app/data`。

## 5. 服务器运维事实

- SSH：`ssh live-cockpit`（`~/.ssh/config` 已配置，腾讯云轻量）。
- 服务：历史交接记录为 systemd `unboundry.service`、代码 `/opt/unboundry`；旧部署计划另记录 `unboundry-replica.service`、代码 `/opt/unboundry-app`。数据目录均记录为 `/var/lib/unboundry`。原生产未获 SSH 授权，当前准确 unit/程序目录属于待核实事实，第二验证机不能代替该核实。
- **历史风险事实**：现有 v0.5.1 preview 会在首次数据库请求（如 `/api/auth/status`）时懒迁移/回填。新施工禁止用健康接口“激活迁移”；REM-009/010 必须将就绪检查与显式迁移完全分开。
- **历史运行事实**：本地 4173 有守护进程可能自动拉起。当前 REM 施工禁止 kill、重启、探测或复用 4173；旧的黑屏重启处理不是当前施工指令。
- 版本更新推送：`/api/version` + `/api/updates`（SSE），发布后用户端会弹“版本已更新”提示，属于正常机制。
- 真实账号现状（服务器库）：`mymy`（麦哥，admin，`protected=1` 最高权限）、`zzx`（user，`protected=0`）。密码不写在任何文档里。

## 6. 历史发布流程（FROZEN）

旧 `deploy.mjs` 曾会自动执行改版本、本地构建、commit/tag、rsync、服务器构建重启、版本接口检查和 push；现已改为立即 fail-close。REM-010 完成、用户确认版本号并另行确认发布前，禁止执行任何替代发布入口。

历史版本接口检查不打开数据库，不能证明登录、画布、媒体或迁移正常。新流程必须以施工总方案 REM-009/010 和 G0～G7 为准；不 push、不部署未经用户确认的内容。

## 7. 红线（延续项目一贯纪律）

- 不修改/不删真实数据（本地 `app/data`、服务器 `/var/lib/unboundry`）；测试一律临时目录。
- 不发起任何真实或付费 Provider 请求；本轮只用本地假 Provider，不得因“可能免费”而调用真实平台。
- 不 `git reset --hard`、不 `clean`、不覆盖他人改动。
- 迁移前必须备份 + 副本演练。

## 8. 账号与权限设计（v0.5.1）

- 受保护最高权限账号（root）：第一个创建的管理员（mymy/麦哥）自动 `protected=1`；其他管理员永远不能停用/删除/降级/重置密码/改权限它；root 自己也不能在网页上改自己角色/删除自己。
- 多管理员：账号管理页创建账号时可选“普通用户/管理员”；管理员之间可互相管理（停用/删除/改角色/重置密码），但动不了 root。
- 密码重置三层：自己改密码（头像菜单，需旧密码，吊销其他会话）；管理员重置他人密码（root 除外，吊销全部会话）；应急脚本 `reset-account-password.mjs`（SSH 执行，可重置任意账号含 root）。
- 权限：管理员恒有全部权限；普通账号默认能力不可撤销，只维护“额外授予集”；`manage_accounts/manage_permissions` 等管理权限不授予普通账号。
- 生成安全：金额限制/上限功能已整体移除（v0.5.0），保留总开关/紧急停止/并发/频率/熔断/失败阈值；任务成本仍记账（审计参考，不展示不拦截）。

## 9. 验收状态速览

- 已 PASS：GEN-010、SAFETY-004、AUTH-004/005/006/007、STORAGE-004、PERF-002～005、DEP-004，以及更早的大批项目；2026-08-13 新发现缺口修复后，用户又在端口 58352 的隔离实页确认默认画布路由与 Text→Video Prompt 两项均通过，CANVAS-019 与 INPUT-005 也已恢复为 `PASS`。
- 当前没有因本轮两项修复遗留的产品 `USER_RECHECK`；`CANVAS-019 / INPUT-005` 保持用户 `PASS`。REM-000为`PASS`，REM-001～REM-011均为离线工程`USER_REVIEW`；fixed candidate与G0～G6自动证据已完成，G7仍待用户审阅，且不包含真实数据/Provider/OSS、原生产或发布验收。
- 暂停/延后：Mureka 真实生成（AUDIO-REAL-001，需用户在 Mureka 官网确认额度）、IMGEDIT-007 打光、AUTH-002/OPEN-009 团队多人、OPEN-019/021、正式部署流程收尾（域名/备案等）。

## 10. 历史测试失败/偶发记录（当前冻结全量已全绿）

- 已知基线：m0 `P1 creators...Dock`、m17×2、m24、m25、m30×5（Node 25 环境）、m33:690、m46:540、m62:92、m63:219、m7-agent-voice；m14 在 m75 全量（bypass 服务器）里失败属环境组合，单独跑 `m14-generation-safety.config.ts` 是 3/3。
- 机器偶发（单独复跑通过或基线复现）：m2-audio:70、m4-audio:98（headless 音频播放不推进，基线复现）、m2-group:131（基线复现）、m70:176（保存闸门时序，基线复现）、m0:1661、m27:1146、m33:445、m4-image:328、m66:319、m37:215、m41:395、m69:126、m79:128。
- 上述仅是旧运行记录，不是当前允许忽略的失败清单。REM-008 冻结功能树已由安全入口完成 111 spec / 891 tests 全量且零失败、跳过、重试、report error 或 blocked；任何后续新失败都必须重新归因，不能沿用旧豁免。

## 11. 数据库迁移

- 机制：`server/database.ts` 的 `migrations` 数组顺序执行；线上/历史 v0.5.1 为 schema 37，当前离线分支候选为 schema 39；schema 38 是 REM-004 的历史中间候选。
- 真实库：本地 `app/data/unboundry.sqlite`；服务器 `/var/lib/unboundry/unboundry.sqlite`。
- REM 日常/候选演练：只使用程序化合成的旧 schema 数据，禁止复制或打开本地真实 `app/data`。生产备份副本只可在用户另行授权的发布窗口按 REM-009 规则验证，并必须断开外网、禁用 worker/Provider/OSS、禁止写测试行。
- 历史迁移 v36（移除金额限制列）、v37（users.protected）已上线并验证；m44 有“当前库回退到 v18 重放迁移”的夹具，改动迁移时必须同步更新该夹具与 m44 期望清单。
- 已上线 v1～v37 迁移不可改名、改版本号或修改既有 SQL，只能追加新迁移；文件/secret/OSS 迁移必须另有 journal、幂等重试和补偿。
- schema 39 只存在于离线候选；exact v0.5.1 会安全拒绝该库，迁移后不能直接回滚到 v0.5.1。REM-009B 已在合成数据上完成可退出的 one-shot exact-v37→schema39 migrator、写锁内来源复核、中间故障恢复及 exact-v0.5.1→current bridge→schema39 数据格式与安全拒绝边界矩阵；这不是生产迁移。REM-010 已完成 runtime/唯一 active lease/drain 接线、合成 immutable/switch/rollback与隔离 Linux builder/ops 子门，最终fixed candidate的离线G0～G6和REM-011三轮已全绿。migration39 admission 不从历史任务推断回填；生产迁移前必须冻结新生成、排空活动任务并自最后一次可能 Provider admission 起至少60秒。原生产未核验，G7/正式版本号/发布授权待完成，production HOLD。
- REM-007 本身没有新增 schema 迁移；四类 ownership 为可选 canvas JSON/localStorage 字段，legacy 数据继续按 exact signature/ownership fail-closed。其格式与拒绝边界已由 REM-009B 矩阵覆盖，不能用“schema 未变”代替。current-database-open reservation 只序列化协作打开；同 UID 非协作进程仍可替换该极窄路径，这是已声明残余边界，不承诺 REM-010 自动消除。

## 12. 记忆参考（同一台 Mac 的 Codex）

`~/.codex/memories/MEMORY.md` 与 `rollout_summaries/` 记录了本项目的历史脉络，可作背景参考；**以仓库文档为准**，记忆可能滞后。

## 13. 与用户协作偏好

- 中文沟通；用户是代码小白，解释要“人话 + 结论先行”。
- 先分析给证据/方案，确认后再动手；诚实标注“未验证/未确认”，禁止编造测试结果。
- 每个功能验收后同步 TASKS.md/验收矩阵；发布版本号递增（当前 0.5.x）。
- 本轮全量修复还必须同步 `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`；同一时间只允许一个 REM 项施工。

## 14. 接手自检（按顺序跑一遍）

先执行 `AGENTS.md` 和施工断点中的恢复协议。以下命令是历史接手自检，不是安全施工入口；REM-001 完成前不运行其构建或 Playwright。原生产 SSH 始终禁止；仅第二验证机隔离测试曾获单独授权并已完成。

```bash
cd /Users/mymy/Documents/unboundry/app
git status && git log --oneline -3
npm run check:greenfield
npm run build
npx playwright test --config=tests/m11-auth.config.ts
npx playwright test --config=tests/m14-generation-safety.config.ts
ssh live-cockpit "curl -fsS http://127.0.0.1:4173/api/version"
```

即使历史命令全部通过，也只能证明这些定向检查当时的结果；不能代表 REM 全量测试、数据库、生产安全或用户验收通过。一次性离线 Goal 只授权 REM-001 安全入口完成后的隔离构建和 Playwright；第二验证机授权不得扩张为原生产 SSH 或发布。

## 15. 下一步候选（未做）

- 当前第一顺位：fixed clean offline candidate及G0～G6/REM-011三轮已完成；下一步仅为G7用户审阅、正式版本号确认及之后独立发布授权，production继续HOLD；
- 正式部署流程收尾（域名/备案/HTTPS 加固确认）；
- Mureka 真实生成恢复验收（需用户确认官网额度）；
- 密码找回的网页入口（当前 root 忘密码走应急脚本）；
- 团队/多人协作（AUTH-002 范围）；
- 部署矩阵中仍为 `PARTIAL / NOT_STARTED` 的独立收尾项（Cookie Secure、多设备/大视频、公网生成、备份清理等），需按用户后续任务逐项推进。

## 16. 上下文压缩或换 Agent 的恢复协议

1. 完整阅读 `AGENTS.md`、施工总方案和施工断点；
2. 只读核对仓库路径、分支、HEAD、工作树、package 和 Node；
3. 对照断点确认当前 REM 状态（可能没有施工中的项）、最后完成项、下一步和用户授权；
4. 再读取 TASKS 与验收矩阵对应 REM 区块；
5. 向用户先报告恢复出的项目、版本、当前项和授权；
6. 任一不一致都必须停止，不得依据内部记忆、历史 PASS 或压缩摘要猜测继续。

当前执行点：`REM-000 PASS / REM-001～REM-011 USER_REVIEW / G7 PENDING / PRODUCTION HOLD`。最终fixed clean offline candidate为commit `8b639ffe6c5f091c51e1914f2e2c18edf9333d90` / tree `219c4df072426cfe92f33dc4045f021064972e9c`，source/snapshot `652b946441ee46e43bcbfbfc635dfc5aaacf5e640529ebec5bc7bd34c798dbb0`；三轮full合计2793/2793、两包race合计1140/1140，listener `dfd25f…`不变，离线G0～G6全绿。REM-010/011只进入离线工程USER_REVIEW；package仍0.5.1，正式版本号、独立发布授权与原生产核验均未完成，未push/tag/release/production。
