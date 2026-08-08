# Unboundry（无央）项目交接文档

> 写给下一个接手的人/AI agent。目标：看完本文后不需要向用户问“项目在哪、怎么跑、怎么发布、有什么红线”。

## 0. 2026-08-09 全量修复施工模式

用户已于 2026-08-09 确认施工文档并启动一次性离线 Goal，`REM-000 = PASS / REM-001 = IN_PROGRESS`。允许连续完成 REM-001～010 与 REM-011 离线工程部分；生产、真实数据、4173、真实 Provider/OSS、push、tag、PR、正式版本号和发布仍禁止。当前必须先读：

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
- Git：分支 `main`，远程 `https://github.com/jasionia1991-max/unboundry.git`；最近标签 `v0.4.7`～`v0.5.1`。
- Node：施工目标为 Node 22 LTS，精确 Node/npm 版本由 REM-001 决策并固定。2026-08-09 文档施工时当前 shell 实测为 `v25.9.0`；历史部署计划记录服务器曾为 `v22.23.2`，本轮未获 SSH 授权，不能声称当前生产精确版本已复核（package.json 当前 engines >=22）。
- 历史依赖/检查方式曾为 `npm install`、`npx tsc --noEmit`、`npm run build`。它们不是当前授权：`npm install` 可改本地依赖并访问外网，当前禁止直接执行；REM-001 必须先决定精确 npm 版本和锁定缓存，门禁优先使用 `npm ci --offline`。
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
- `npm run data:backup`：现入口可能先迁移/回填源库，REM-009A 前冻结；
- `node scripts/deploy.mjs --version X.Y.Z`：现流程存在原地构建、健康检查和回滚缺口，REM-010 前冻结；
- `node scripts/reset-account-password.mjs <loginName>`：仅限用户明确授权的真实应急操作；目录选择和密码回显问题在 REM-008 修复前不得用于施工。

## 4. 测试纪律（非常重要）

- **绝不**用真实数据/真实 4173 跑测试：所有测试用临时数据目录 + 独立端口。
- 2026-08-09 全量审计确认：现有推荐回归组合去重后只覆盖约 80/105 个 spec、391/519 项既有测试，且多处仍使用固定端口、共享临时库或仓库 tmp。它们只能作为历史基线，不能作为新候选的“真正全量”绿灯。
- REM-001 完成前不运行默认 `npm run verify`，也不启动新的施工测试；REM-001 将建立动态端口、逐 spec 新临时目录、非 loopback 断网和测试发现清单。
- 以下固定配置与端口地图是历史基线清单，不是 REM 施工授权；REM-001 将用动态端口替代。
- 历史通用测试配置：`--config=playwright.4174.config.ts`（端口 4174、临时数据目录、auth bypass）。
- **不要直接跑 `npm run verify`**：它用默认配置绑 4173，会撞正在运行的真实服务。
- 端口地图（每套件独立 config）：
  - 4174：通用（playwright.4174）
  - 4175：m58；4176：m14（config webServer）/m60；4177：m61；4178：m62；4179：m63；4182：m64；4183：m65；
  - 4191：m77；4192：m71 回归；4193：m72/m79；4194：m11/m73；4197：m74 回归；4198：m75 全量、m78（m14 的 spec 内部也自拉起 4198）。
  - 说明：m11/m77/m78 等“无 bypass”套件在 spec 内部自己拉起端口和临时目录；单元类 config（m38/40/47/49/53/54/55/57/59/model-runtime）多为纯 Node，不需要 webServer。
- 历史回归组合：`tests/m75-full.config.ts`、`m71-regression`、`m74-regression`、`m79`、`npm run test:restart`、fixture-production；它只覆盖约 80/105 spec、391/519 项，禁止称为最终全量。
- 日常与候选迁移测试只允许程序化合成的旧 schema 数据；未获真实数据专项授权，不得复制、打开或迁移 `app/data`。

## 5. 服务器运维事实

- SSH：`ssh live-cockpit`（`~/.ssh/config` 已配置，腾讯云轻量）。
- 服务：历史交接记录为 systemd `unboundry.service`、代码 `/opt/unboundry`；旧部署计划另记录 `unboundry-replica.service`、代码 `/opt/unboundry-app`。数据目录均记录为 `/var/lib/unboundry`。本轮未获 SSH 授权，当前准确 unit/程序目录属于待核实事实，不能任选一个当现状。
- **历史风险事实**：现有 v0.5.1 preview 会在首次数据库请求（如 `/api/auth/status`）时懒迁移/回填。新施工禁止用健康接口“激活迁移”；REM-009/010 必须将就绪检查与显式迁移完全分开。
- **历史运行事实**：本地 4173 有守护进程可能自动拉起。当前 REM 施工禁止 kill、重启、探测或复用 4173；旧的黑屏重启处理不是当前施工指令。
- 版本更新推送：`/api/version` + `/api/updates`（SSE），发布后用户端会弹“版本已更新”提示，属于正常机制。
- 真实账号现状（服务器库）：`mymy`（麦哥，admin，`protected=1` 最高权限）、`zzx`（user，`protected=0`）。密码不写在任何文档里。

## 6. 历史发布流程（FROZEN）

旧 `deploy.mjs` 会自动执行改版本、本地构建、commit/tag、rsync、服务器构建重启、版本接口检查和 push。全量审计已确认该流程不能作为本轮安全发布入口；REM-010 完成、用户确认版本号并另行确认发布前，禁止执行。

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

- 已 PASS（2026-08-09 用户确认）：GEN-010、SAFETY-004、CANVAS-019、AUTH-004/005/006/007、STORAGE-004、PERF-002～005、DEP-004，以及更早的画布/节点/生成/模板/账号/权限等大批项目（见验收矩阵）。
- 原有产品验收项已无 `USER_RECHECK`；2026-08-09 新增施工治理项 `REM-000` 已获用户确认并为 `PASS`。`PARTIAL / BLOCK / PAUSED` 仍按各自证据边界保留，不得混同为已完成。
- 暂停/延后：Mureka 真实生成（AUDIO-REAL-001，需用户在 Mureka 官网确认额度）、IMGEDIT-007 打光、AUTH-002/OPEN-009 团队多人、OPEN-019/021、正式部署流程收尾（域名/备案等）。

## 10. 已知测试失败/偶发（不是新回归，先对照再动手）

- 已知基线：m0 `P1 creators...Dock`、m17×2、m24、m25、m30×5（Node 25 环境）、m33:690、m46:540、m62:92、m63:219、m7-agent-voice；m14 在 m75 全量（bypass 服务器）里失败属环境组合，单独跑 `m14-generation-safety.config.ts` 是 3/3。
- 机器偶发（单独复跑通过或基线复现）：m2-audio:70、m4-audio:98（headless 音频播放不推进，基线复现）、m2-group:131（基线复现）、m70:176（保存闸门时序，基线复现）、m0:1661、m27:1146、m33:445、m4-image:328、m66:319、m37:215、m41:395、m69:126、m79:128。
- 处理方式：先单独复跑；仍失败再对照基线 commit（如 `2146df8`）复现；确认与本批无关就记录，不要顺手“修”。

## 11. 数据库迁移

- 机制：`server/database.ts` 的 `migrations` 数组，顺序执行，`currentSchemaVersion` 当前 = 37。
- 真实库：本地 `app/data/unboundry.sqlite`；服务器 `/var/lib/unboundry/unboundry.sqlite`。
- REM 日常/候选演练：只使用程序化合成的旧 schema 数据，禁止复制或打开本地真实 `app/data`。生产备份副本只可在用户另行授权的发布窗口按 REM-009 规则验证，并必须断开外网、禁用 worker/Provider/OSS、禁止写测试行。
- 历史迁移 v36（移除金额限制列）、v37（users.protected）已上线并验证；m44 有“当前库回退到 v18 重放迁移”的夹具，改动迁移时必须同步更新该夹具与 m44 期望清单。
- 已上线 v1～v37 迁移不可改名、改版本号或修改既有 SQL，只能追加新迁移；文件/secret/OSS 迁移必须另有 journal、幂等重试和补偿。

## 12. 记忆参考（同一台 Mac 的 Codex）

`~/.codex/memories/MEMORY.md` 与 `rollout_summaries/` 记录了本项目的历史脉络，可作背景参考；**以仓库文档为准**，记忆可能滞后。

## 13. 与用户协作偏好

- 中文沟通；用户是代码小白，解释要“人话 + 结论先行”。
- 先分析给证据/方案，确认后再动手；诚实标注“未验证/未确认”，禁止编造测试结果。
- 每个功能验收后同步 TASKS.md/验收矩阵；发布版本号递增（当前 0.5.x）。
- 本轮全量修复还必须同步 `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`；同一时间只允许一个 REM 项施工。

## 14. 接手自检（按顺序跑一遍）

先执行 `AGENTS.md` 和施工断点中的恢复协议。以下命令是历史接手自检，不是安全施工入口；REM-001 完成前不运行其构建或 Playwright，SSH 在整个离线 Goal 中始终禁止。

```bash
cd /Users/mymy/Documents/unboundry/app
git status && git log --oneline -3
npm run check:greenfield
npm run build
npx playwright test --config=tests/m11-auth.config.ts
npx playwright test --config=tests/m14-generation-safety.config.ts
ssh live-cockpit "curl -fsS http://127.0.0.1:4173/api/version"
```

即使历史命令全部通过，也只能证明这些定向检查当时的结果；不能代表 REM 全量测试、数据库、生产安全或用户验收通过。一次性离线 Goal 只授权 REM-001 安全入口完成后的隔离构建和 Playwright，SSH 始终禁止。

## 15. 下一步候选（未做）

- 当前第一顺位：REM-001 建立绝对隔离的全量测试入口；完成前不得直接运行历史默认测试命令；
- 正式部署流程收尾（域名/备案/HTTPS 加固确认）；
- Mureka 真实生成恢复验收（需用户确认官网额度）；
- 密码找回的网页入口（当前 root 忘密码走应急脚本）；
- 团队/多人协作（AUTH-002 范围）；
- 部署矩阵中仍为 `PARTIAL / NOT_STARTED` 的独立收尾项（Cookie Secure、多设备/大视频、公网生成、备份清理等），需按用户后续任务逐项推进。

## 16. 上下文压缩或换 Agent 的恢复协议

1. 完整阅读 `AGENTS.md`、施工总方案和施工断点；
2. 只读核对仓库路径、分支、HEAD、工作树、package 和 Node；
3. 对照断点确认当前唯一 REM、最后完成项、下一步和用户授权；
4. 再读取 TASKS 与验收矩阵对应 REM 区块；
5. 向用户先报告恢复出的项目、版本、当前项和授权；
6. 任一不一致都必须停止，不得依据内部记忆、历史 PASS 或压缩摘要猜测继续。

当前执行点：`REM-000 PASS / REM-001 IN_PROGRESS`；按施工断点连续完成离线 Goal。只有仓库身份被外部改变，或无法继续保证真实数据隔离和零外部请求时，才安全停止整个 Goal。
