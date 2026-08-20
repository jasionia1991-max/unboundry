# 2026-08-20 事一/事二交接记录（给明天接手 agent）

更新日期：2026-08-20（凌晨）
用途：新 agent 接手前先读本文件，再按 AGENTS.md 必读顺序核对。
状态：本文件保留事故交接时点；后续全局审计已完成事一查证并复核事二修复缺口。当前结论、修复设计与验收门以 `spec/UNBOUNDRY_GLOBAL_AUDIT_REMEDIATION_PLAN_2026-08-20.md` 为准。

> 后续结论（2026-08-20）：事一是 v0.6.23 的 10MB 文字输入预检拦下 11,596,744 字节上游 PNG，不是客户端 DAG 漏发；“2:33 三张主图未提交”已被任务表与 nginx 202 记录否定。事二现有脏树修复方向正确但测试不足，且 stale queued 应按 `updatedAt`、不是 `createdAt` 判断。本文以下“未查清”内容作为历史交接原文保留，不再作为当前施工结论。

## 背景（用户原话摘要）

- 用户在同一画布同时测试两个模板（都走「整组执行」），失败的模板是「一键上新+自检」，画布上出现过一条长红字。
- 另一个问题：左侧 dock 的「生成任务」里有一个节点长期显示「排队中」。
- 用户先说「先修事二，然后事一必须查清楚」；随后改为：先记文档，明天由新 agent 接手继续查。

## 事二：节点一直「排队中」（已定位 + 已修复，未提交）

### 现象

左侧 dock「生成任务」里节点长期显示「排队中」，用户等待很久没有启动。

### 生产证据（2026-08-20 03:45 CST 只读查询）

- 画布 `b31fdb89-a061-40e6-80c6-b40c8ffb813b`；
- 任务 `c479826f-a426-4a11-854c-79ecc802bcbc`，节点 `image-72bc261b-da52-4bc5-80a7-0c348b7476d7`；
- `kind=image`，`state=queued`，`attempt=1`，`provider_task_id` 为空；
- `created_at=2026-08-19T18:52:45.699Z`，`updated_at=2026-08-19T18:53:00.692Z`（之后不再变化）；
- 同一画布其余 6 条图片 + 1 条文字任务均 `success`。

### 根因（代码审计结论）

- 自动重试/补发请求到达时，旧执行还没有从 `launchedGenerationTasks` 退场，`launchGenerationTask` 直接 `return`，重试任务永远留在 `queued`，没有后续机制把它捞起来；
- 另外，任何「任务已落库、但后台调度失败」的分支也没有巡逻恢复，任务会同样卡在排队。

### 本地修复内容（工作区未提交）

- `server/generationTasks.ts`：
  - 新增 `pendingGenerationRelauches`：启动请求被旧执行挡下时先登记，旧执行结束后立即补启动；
  - `runGenerationRecoverySweep` 增加安全网：超过宽限期的 `queued` 任务自动重新 launch（幂等：已在跑则 defer，已启动则不在 queued 列表）；
  - 三个启动失败分支补充 `generation-diagnostic`（`launch-deferred` / `launch-schedule-failed`）。
- `tests/m38-generation-runtime-incidents.spec.ts`：新增 1 条「server recovery sweep relaunches stale queued tasks and leaves fresh ones alone」。
- `scripts/run-safe-tests.mjs` 与 `scripts/source-coverage-manifest.json`：冻结测试清单 1006 → 1007。

### 测试现状

- m38 定向 13/13 PASS（2026-08-20 交接前已复跑确认）；
- 全量清单现为 1007 条；上一轮报告全量全绿，本轮未重跑全量。

### 状态

- 未 commit、未 push、未发布；等用户给版本号 +「可以上线」后再按 RELEASE_RUNBOOK.md 走完整流程。

## 事一：模板整组失败 + 红字（未查清，需接手）

### 已经发生的事实

- 用户第一次同一画布两个模板一起「整组执行」：一个模板全成功；「一键上新+自检」只出几个文字节点和一张图片节点，其余图片节点失败，画布出现长红字（用户没来得及看清就消失了）。
- 用户后来贴出的红字文案：「整组执行部分失败:服装主体标准化的格式或大小不受当前文字模型支持;另有5个后续节点因上游失败未运行」。

### 上一轮结论 A（需复核）

- 红字发生在 2026-08-19 23:26 CST（15:26Z），早于 v0.6.24 发布（18:24Z）。
- 当时线上文字模型入口限制参考图 ≤10MB，「服装主体标准化」输出的图约 11MB，被服务端拦截；导演稿 + 3 条撰写指令被挡，后续 5 个节点（三张主图 + 一致性检查 + 逐图纠错）全部未运行，红字数量吻合。
- 复核要点：把 15:00–16:00Z 窗口的生产任务按 canvas/node/state 全列出来，核对是否真的存在这条拦截链。

### 上一轮结论 B（与本次只读数据冲突，必须重点核）

- 上一轮说法：牛仔裤组 2:33 那轮「文字节点全部成功，但三张主图从始至终没有发起提交请求，是客户端 DAG 漏发」。
- 本次只读查询 18:15–19:00Z（即本地 02:15–03:00）看到：
  - 画布 `9dd7c462-cc1e-40e9-90c7-8e0131df490e`：18:33:47Z–18:36:40Z 共有 7 条图片 + 4 条文字任务，全部 `success`（含 6 条 18:33:47–56Z 提交的图片和 1 条 18:35:37Z 提交的图片）。
  - 也就是说，2:33–2:37 这轮在生产数据里是「全部成功」，和「三张主图从未提交」对不上。
- 因此结论 B 不能写进正式结论，明天必须重新核对：每个模板/画布/组的 id 映射、正确的时间窗、nginx/应用请求日志里该时段到底有没有对应图片的 POST。

### 用户记忆中的「失败组只出文字 + 一张图」尚未定位

- 18:15–19:00Z 窗口内没有 `failed` 图片任务；该失败轮可能对应 15:00–16:00Z 或更早/其他画布，需要明天继续按时间窗和 canvas_id 排查。

### v0.6.24 大图能力现状（2026-08-20 交接时已确认）

- 线上已发布 v0.6.24 / schema39，指针 `/opt/unboundry/releases/v0.6.24-ark-files-20260820`；
- 生产开关已打开：`UNBOUNDRY_ARK_FILES_API=1`（位于 `/etc/systemd/system/unboundry.service.d/90-ark-files-api.conf`）；
- 但 journal 中至今没有 `ark-files-*` 日志 → 10–20MB 大图走 Files API 的真实端到端路径还没有线上实跑记录；
- 所以「23:26 那种 11MB 被 10MB 限制拦下」理论上已被 v0.6.24 + 开关解决，但必须拿真实 11MB 图在线上跑一次模板才算验证。

## 接手 agent 必做（只读优先）

1. 按 AGENTS.md 必读顺序读文档，再读本交接，然后只读核对 git 分支/HEAD/工作树/版本。
2. 查生产 `generation_tasks`：15:00–16:00Z（08-19 23:00–24:00 CST）与 18:15–19:00Z（08-20 02:15–03:00 CST），按 `canvas_id` / `node_id` / `kind` / `state` / `attempt` / `error_code` / `provider_task_id` 全列，定位「一键上新+自检」失败组和用户记忆中的失败轮。
3. 查 nginx/应用请求日志：对应时段 `/api/generation` 的提交记录，用「服务端任务表 + 请求日志」双对照确认三张主图到底有没有发起过提交。
4. 若确认是客户端 DAG 漏发：读 `client/src/generation/workflowExecution.ts`（`runWorkflowGraph`）、`client/src/generation/WorkflowExecutionProvider.tsx`、`client/src/generation/groupRunPersist.ts`，先给修复设计，不急于改码。
5. 11MB 验证：拿一张真实 11MB PNG 在线上跑「一键上新+自检」，观察 `ark-files-upload` / `ark-files-poll` / `ark-files-delete` 日志；真实出图必须用户单独点头。
6. 事二修复是否发布：等用户分别给版本号和「可以上线」，再按 RELEASE_RUNBOOK.md 走完整流程。

## 红线（沿用项目规矩）

- 只读核对；不擅自改生产、不删数据；删任何文件先问用户。
- 不得提交、不得删除 `spec/public-templates-director-split-revision.json`。
- 测试不碰 4173、`app/data`、`/var/lib/unboundry`、真实媒体/备份。
- 未分别听到版本号和「可以上线」前，不 push、不 tag、不 PR、不切生产。
- 不确定就停，把证据摆出来给用户看，不猜、不编。

## 仓库现状快照（2026-08-20 交接时）

- 仓库：`/Users/mymy/Documents/unboundry/app`
- 分支：`codex/unboundry-offline-remediation-2026-08-09`（跟踪同名远端分支）
- HEAD：`ca73afe`（Merge remote-tracking branch 'origin/main' into codex/…）
- package.json 版本：`0.6.24`
- 工作树改动（都是事二修复）：`server/generationTasks.ts`、`tests/m38-generation-runtime-incidents.spec.ts`、`scripts/run-safe-tests.mjs`、`scripts/source-coverage-manifest.json`
- 未跟踪且勿动：`spec/public-templates-director-split-revision.json`
- 生产：v0.6.24 / schema39 / `UNBOUNDRY_ARK_FILES_API=1` / 并发推荐值 20/10/2/2/10/120
