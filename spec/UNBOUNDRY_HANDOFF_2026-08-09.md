# Unboundry（无央）项目交接文档

> 写给下一个接手的人/AI agent。目标：看完本文后不需要向用户问“项目在哪、怎么跑、怎么发布、有什么红线”。

## 1. 项目一句话

一个 TapNow 风格的 AI 画布应用（React + Vite + Node 原生 SQLite），支持文本/图片/视频/音频生成节点、连线工作流、模板、多项目工作空间、账号与管理员权限。当前**已发布到生产服务器** `canvas.mymy.ltd`，线上版本 v0.5.1。

## 2. 仓库与环境

- 仓库根：`/Users/mymy/Documents/unboundry/app`（注意：系统工作区根目录写的是 `tapnow1_1复刻`，那个路径在本机不存在，**一律用 unboundry/app**）。
- Git：分支 `main`，远程 `https://github.com/jasionia1991-max/unboundry.git`；最近标签 `v0.4.7`～`v0.5.1`。
- Node：本机 `v22.23.1`，服务器 `/opt/node22/bin/node`（package.json engines >=22）。
- 依赖：`npm install`；类型检查 `npx tsc --noEmit`；生产构建 `npm run build`（会先跑 tsc）。
- 代码结构速览：
  - `client/src/canvas/`：画布（`CanvasSurface.tsx` 是核心，`CanvasShell.tsx` 是外壳）、各类节点（Image/Text/Video/Audio/Group…）；
  - `client/src/generation/`：生成提交、轮询、错误文案；
  - `client/src/projects/`：工作空间；
  - `server/`：所有 API 与业务（`auth.ts` 账号/会话/权限、`generationSafety.ts` 并发/频率/熔断、`generationTasks.ts` 生成任务、`modelCatalog.ts` 模型、`projects.ts` 项目、`canvasPersistence.ts` 画布存取、`database.ts` 迁移）；
  - `vite.config.ts`：把所有 `server/*` API 挂到 `/api/*`（dev 与 preview 都注册）；
  - `types/`：跨端共享类型。

## 3. 常用命令

```bash
cd /Users/mymy/Documents/unboundry/app
npm run dev            # 本地 4173 开发服务（真实本地数据在 app/data）
npm run build          # tsc + 生产构建
npm run check:greenfield
npm run data:backup    # 备份本地真实库（backups/时间戳/）
node scripts/deploy.mjs --version X.Y.Z   # 发布（见第 6 节）
node scripts/reset-account-password.mjs <loginName>  # 应急重置任意账号密码（SSH 到服务器执行）
```

## 4. 测试纪律（非常重要）

- **绝不**用真实数据/真实 4173 跑测试：所有测试用临时数据目录 + 独立端口。
- 通用测试配置：`--config=playwright.4174.config.ts`（端口 4174、临时数据目录、auth bypass）。
- **不要直接跑 `npm run verify`**：它用默认配置绑 4173，会撞正在运行的真实服务。
- 端口地图（每套件独立 config）：
  - 4174：通用（playwright.4174）
  - 4175：m58；4176：m14（config webServer）/m60；4177：m61；4178：m62；4179：m63；4182：m64；4183：m65；
  - 4191：m77；4192：m71 回归；4193：m72/m79；4194：m11/m73；4197：m74 回归；4198：m75 全量、m78（m14 的 spec 内部也自拉起 4198）。
  - 说明：m11/m77/m78 等“无 bypass”套件在 spec 内部自己拉起端口和临时目录；单元类 config（m38/40/47/49/53/54/55/57/59/model-runtime）多为纯 Node，不需要 webServer。
- 全量回归建议按套件跑：`tests/m75-full.config.ts`、`m71-regression`、`m74-regression`、`m79`、`npm run test:restart`、`UNBOUNDRY_TEST_PREVIEW=1 ... fixture-production`。
- 数据库迁移演练：把真实库复制到临时目录，用新代码 `openAppDatabase(临时目录)` 跑迁移，确认成功再动真实库（见第 11 节）。

## 5. 服务器运维事实

- SSH：`ssh live-cockpit`（`~/.ssh/config` 已配置，腾讯云轻量）。
- 服务：systemd `unboundry.service`，`ExecStart` 是 `vite preview --host 127.0.0.1 --port 4173`；代码在 `/opt/unboundry`，数据目录 `/var/lib/unboundry`（`UNBOUNDRY_DATA_DIR`）。
- **preview 模式的数据库迁移是懒执行的**：服务重启后，第一次真正访问数据库的请求（如 `/api/auth/status`）才跑迁移；验证迁移要用这个接口先“激活”一下。
- 本地 4173 有守护进程自动拉起：kill 后会自动出现新进程（别惊讶）。若页面黑屏且控制台报 `504 Outdated Optimize Dep`，重启本地 vite 服务即可。
- 版本更新推送：`/api/version` + `/api/updates`（SSE），发布后用户端会弹“版本已更新”提示，属于正常机制。
- 真实账号现状（服务器库）：`mymy`（麦哥，admin，`protected=1` 最高权限）、`zzx`（user，`protected=0`）。密码不写在任何文档里。

## 6. 发布流程（deploy.mjs）

`node scripts/deploy.mjs --version X.Y.Z` 会自动：改 package.json 版本 → 本地构建 → git commit+tag → rsync 到 `/opt/unboundry`（排除 .git/node_modules/data/backups/tmp/test-results/dist）→ 服务器 npm run build → systemd 重启 → curl 校验版本 → `git push origin main --tags`。

纪律：
- 发布前：工作树干净、用户确认版本号、相关回归通过（对照第 10 节已知失败，禁止把已知项当新回归）。
- 发布后：用 `ssh live-cockpit "curl -fsS http://127.0.0.1:4173/api/version"` 和公网 `curl -I https://canvas.mymy.ltd` 验证。
- **不 push、不部署未经用户确认的内容**。

## 7. 红线（延续项目一贯纪律）

- 不修改/不删真实数据（本地 `app/data`、服务器 `/var/lib/unboundry`）；测试一律临时目录。
- 不发起任何付费 Provider 请求；需要真实生成/验真时先向用户申请授权与预算。
- 不 `git reset --hard`、不 `clean`、不覆盖他人改动。
- 迁移前必须备份 + 副本演练。

## 8. 账号与权限设计（v0.5.1）

- 受保护最高权限账号（root）：第一个创建的管理员（mymy/麦哥）自动 `protected=1`；其他管理员永远不能停用/删除/降级/重置密码/改权限它；root 自己也不能在网页上改自己角色/删除自己。
- 多管理员：账号管理页创建账号时可选“普通用户/管理员”；管理员之间可互相管理（停用/删除/改角色/重置密码），但动不了 root。
- 密码重置三层：自己改密码（头像菜单，需旧密码，吊销其他会话）；管理员重置他人密码（root 除外，吊销全部会话）；应急脚本 `reset-account-password.mjs`（SSH 执行，可重置任意账号含 root）。
- 权限：管理员恒有全部权限；普通账号默认能力不可撤销，只维护“额外授予集”；`manage_accounts/manage_permissions` 等管理权限不授予普通账号。
- 生成安全：金额限制/上限功能已整体移除（v0.5.0），保留总开关/紧急停止/并发/频率/熔断/失败阈值；任务成本仍记账（审计参考，不展示不拦截）。

## 9. 验收状态速览

- 已 PASS（2026-08-09 用户确认）：GEN-010、SAFETY-004、CANVAS-019、AUTH-004/005/006/007，以及更早的画布/节点/生成/模板/账号/权限等大批项目（见验收矩阵）。
- 仍待用户实页确认：`STORAGE-004`、`PERF-002～005`、`DEP-004`。
- 暂停/延后：Mureka 真实生成（AUDIO-REAL-001，需用户在 Mureka 官网确认额度）、IMGEDIT-007 打光、AUTH-002/OPEN-009 团队多人、OPEN-019/021、正式部署流程收尾（域名/备案等）。

## 10. 已知测试失败/偶发（不是新回归，先对照再动手）

- 已知基线：m0 `P1 creators...Dock`、m17×2、m24、m25、m30×5（Node 25 环境）、m33:690、m46:540、m62:92、m63:219、m7-agent-voice；m14 在 m75 全量（bypass 服务器）里失败属环境组合，单独跑 `m14-generation-safety.config.ts` 是 3/3。
- 机器偶发（单独复跑通过或基线复现）：m2-audio:70、m4-audio:98（headless 音频播放不推进，基线复现）、m2-group:131（基线复现）、m70:176（保存闸门时序，基线复现）、m0:1661、m27:1146、m33:445、m4-image:328、m66:319、m37:215、m41:395、m69:126、m79:128。
- 处理方式：先单独复跑；仍失败再对照基线 commit（如 `2146df8`）复现；确认与本批无关就记录，不要顺手“修”。

## 11. 数据库迁移

- 机制：`server/database.ts` 的 `migrations` 数组，顺序执行，`currentSchemaVersion` 当前 = 37。
- 真实库：本地 `app/data/unboundry.sqlite`；服务器 `/var/lib/unboundry/unboundry.sqlite`。
- 演练：`cp -R app/data <临时目录>` → `node --input-type=module -e "import {openAppDatabase,currentSchemaVersion} from './server/database.ts'; const db=openAppDatabase('<临时目录>'); ..."` 验证列/值 → 再部署。
- 历史迁移 v36（移除金额限制列）、v37（users.protected）已上线并验证；m44 有“当前库回退到 v18 重放迁移”的夹具，改动迁移时必须同步更新该夹具与 m44 期望清单。

## 12. 记忆参考（同一台 Mac 的 Codex）

`~/.codex/memories/MEMORY.md` 与 `rollout_summaries/` 记录了本项目的历史脉络，可作背景参考；**以仓库文档为准**，记忆可能滞后。

## 13. 与用户协作偏好

- 中文沟通；用户是代码小白，解释要“人话 + 结论先行”。
- 先分析给证据/方案，确认后再动手；诚实标注“未验证/未确认”，禁止编造测试结果。
- 每个功能验收后同步 TASKS.md/验收矩阵；发布版本号递增（当前 0.5.x）。

## 14. 接手自检（按顺序跑一遍）

```bash
cd /Users/mymy/Documents/unboundry/app
git status && git log --oneline -3
npm run check:greenfield
npm run build
npx playwright test --config=tests/m11-auth.config.ts
npx playwright test --config=tests/m14-generation-safety.config.ts
ssh live-cockpit "curl -fsS http://127.0.0.1:4173/api/version"
```

全绿即环境、鉴权、安全、服务器链路都正常。

## 15. 下一步候选（未做）

- 正式部署流程收尾（域名/备案/HTTPS 加固确认）；
- Mureka 真实生成恢复验收（需用户确认官网额度）；
- 密码找回的网页入口（当前 root 忘密码走应急脚本）；
- 团队/多人协作（AUTH-002 范围）；
- 性能专项 USER_RECHECK 的实页确认。
