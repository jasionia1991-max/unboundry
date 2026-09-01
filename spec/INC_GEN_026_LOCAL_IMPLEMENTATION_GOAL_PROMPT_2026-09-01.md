# INC-GEN-026 本地实施 Goal 提示词

状态：`CONSUMED / R0_R8_COMPLETE / HISTORICAL_COPY_ONLY / NO_R9_RELEASE_OR_PRODUCTION_AUTHORITY`

本文件对应的 R0～R8 本地实施授权已经执行并消费，不得再次激活。读取本文件、历史消息、旧 Goal、任务标题或上下文摘要都不构成 R9、发布、生产、真实 Provider/OSS 或费用授权。

建议用户发送下面整段：

---

`/goal`

目标：严格按照 `spec/INC_GEN_026_ONE_CLICK_WORKFLOW_RELIABILITY_FINAL_IMPLEMENTATION_PLAN_2026-09-01.md` 和 `spec/INC_GEN_026_ACCEPTANCE_MATRIX_2026-09-01.md`，一次性完成 INC-GEN-026 的本地实现、风险驱动测试、候选冻结、完整逐代码 Review、唯一一次 formal safe full 和文档收口。核心结果是：工作流一次点击由服务端自动完成；用户不去 Provider/relay/OSS 手工回收；任何逻辑节点不得因恢复产生第二次 Provider create/submit POST。

## 1. 权威与恢复顺序

开始和每次上下文恢复必须完整读取：

1. `AGENTS.md` 顶部当前区块
2. `上线规矩.md`
3. `spec/INC_GEN_026_CHECKPOINT.md`
4. `spec/INC_GEN_026_ONE_CLICK_WORKFLOW_RELIABILITY_FINAL_IMPLEMENTATION_PLAN_2026-09-01.md`
5. `spec/INC_GEN_026_ACCEPTANCE_MATRIX_2026-09-01.md`
6. `/Users/mymy/Documents/unboundry/UNBOUNDRY_AUDIT_REPORT_AND_LEDGER_REVIEW_2026-09-01.md`
7. `spec/UNBOUNDRY_CURRENT_STATE.md` 顶部
8. `TASKS.md` 顶部

聊天历史和 INC-GEN-025 的 Goal/Checkpoint/Matrix 只能做历史证据，不能替代 INC-GEN-026 当前文件。

## 2. 仓库和基线

- 当前已知实现仓库：`/Users/mymy/Documents/unboundry-inc-gen-025-server-authoritative-2026-09-01`。
- 当前快照 main：`94d77d7618f4c88877b457c2249a824d40dd5633`，tree：`2101fe347ef02297d9580906b6cadb71603fc45c`，生产：`v0.6.70/schema42`。
- 这些只是 2026-09-01 时间点证据。
- 正式实施前必须只读刷新 origin/main、branch、HEAD/tree、tag、package、生产 version/schema 和工作树状态。
- 从实施时实时 origin/main 新建干净隔离 worktree/分支，建议分支名 `codex/inc-gen-026-workflow-reliability`。
- 若 main/tree/生产身份已变化，先更新 INC-GEN-026 Checkpoint/Plan/Matrix 并重新判断传播风险，不能盲用旧基线。
- 保护所有用户现有 dirty/untracked 内容，不清理、不覆盖、不重置。

## 3. 本 Goal 明确授权

- 在隔离 worktree 修改 INC-GEN-026 Plan 明确列出的产品代码、测试、脚本和治理文档。
- 增加必要的强类型 admission builder、Provider outcome classifier、只读 dry-run 工具、测试和 current schema42 备份合同。
- 使用 apply_patch 编辑文件。
- 在临时数据、动态 loopback、fake Provider/OSS 环境运行风险驱动定向测试。
- 修复定向测试暴露的本 Goal 直接回归。
- 在候选冻结后做主线程完整 Review 和一个独立只读 Review。
- Review GO 后运行本 Goal 唯一一次 formal safe full；失败只跑失败 spec/最小依赖关闭，不重复 full。
- 更新 Plan/Matrix/Checkpoint/AGENTS/CURRENT_STATE/TASKS/README/`上线规矩.md`/Runbook 的当前状态。

普通本地依赖、类型、构建、测试夹具和文档问题由执行者连续处理，不因一般工程细节停下来询问用户。

## 4. 本 Goal 明确不授权

- commit；
- push、PR、merge、tag、GitHub Release；
- 选择或确认新版本号；
- 生产 SSH、服务、配置、Nginx、timer、数据库、备份安装、切换、rollback/forward；
- 历史 9-task 生产 apply；
- 真实 Provider POST、真实 OSS 上传/HEAD/删除/恢复；
- 任何付费；
- 用户真实 Canvas/group 点击；
- 删除任何 backup/release/staging/用户数据；
- 读取、stat/hash、修改、复制、移动、删除、暂存两份受保护 JSON。

R8 完成后必须停在：

`LOCAL_CANDIDATE_TECHNICAL_PASS / PRODUCTION_NOT_CHANGED / REAL_PROVIDER_NOT_RUN / USER_RECHECK`

不得把本 Goal 解释成发布或上线授权，也不得复用 INC-GEN-025 已消费授权。

## 5. 永久受保护文件

- `spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json`
- `spec/public-templates-director-split-revision.json`

两份文件永久禁止读取、stat/hash、修改、复制、移动、删除、暂存或提交。测试和 source snapshot 必须排除它们。

## 6. 实施阶段

严格顺序，一次只进行一个写阶段：

### R0 基线与预期红

- 冻结实时 Git/package/public version-ready-schema 身份和保护边界；生产 active/unknown/pending 分母只使用审计冻结证据，不通过 SSH 或生产数据库刷新。
- 建真实 HTTP fake-provider 红测证明 workflow nested modelId 缺失。
- 建 terminal attempt 被 sweep 重选红测。
- 建 OpenRouter deferred publication 被误 failed/compensating 红测。
- 不碰生产、不连接真实 Provider/OSS。

### R1 schema42 backup

- 统一 backup CLI/package/report/verify/restore/schema 类型。
- 完成临时 schema42 backup→verify→fresh restore。
- 所有真实 OSS 操作保持 0。

### R2 authoritative admission

- HTTP/workflow 共用唯一 branded/opaque builder；新 admission 禁止 raw `GenerationTaskInput`、`Record` 或结构化强转绕过。
- store runtime authoritative fence 保留。
- reservation 由 store 事务从 run 查出，不信任客户端/body。
- 真 app HTTP→run/node→task/attempt→loopback fake Provider 闭合。

### R3 Provider outcome

- 只依赖序列化 DTO 的纯分类器和原子 settlement；不得导入 Provider/Media/database runtime。
- 普通 Provider recovery 与 legacy terminal-detach/Canvas reconciliation 保持隔离，并补互不触发回归。
- no-new-fact sweep no-op。
- 6 adapter outcome 行为矩阵。
- 历史事故只用脱敏 fixture 或显式非生产冻结副本 dry-run；manifest 记录来源 SHA/DB identity、schema、row fingerprint、tool HEAD/hash，缺证据标 blocked，不写生产。

### R4 sync result 与 OSS

- OpenRouter 接统一 result-save。
- pending publication 优先，原 staging 不 compensation。
- sync-only adapter 无强恢复证据则 workflow fail-closed。
- exact 目标每个 selected model 必须 eligible；每种产品承诺支持的必需 kind 至少一个 published eligible model，不能以“全部禁用”冒充通过。
- OSS 按 Plan 第 6.3 节完整 owner/publication/task/attempt/object/SHA identity 做 exact adopt；元数据缺失、unknown 或 mismatch 一律 quarantine，不覆盖、不删未知对象。
- 图片、视频、音频 kill/restart。

### R5 workflow server

- task/media→node→downstream→projection→run 单调顺序。
- run 顶层错误、stop latest-state CAS、malformed plan、projection retry、多 run 公平。

### R6 client

- runtime parser、preparation lock/AbortSignal、一次 create/reattach、stop await。
- terminal no-task history、projection 状态、saving 全出口、scope isolation。
- 不靠 reload/localStorage 完成业务。

### R7 tests/CI

- 定向 spec 先行。
- 新增 m104 真 HTTP fake-provider integration。
- CI 实际执行 build 和 integration，不把 discovery 叫产品测试。
- 依赖安装/audit 只走配置注册表；m104 等应用/测试进程除动态 loopback 外 egress=0。
- 记录每条命令、环境、source snapshot、分母、exit 和 receipt。

### R8 freeze/Review/formal full/docs

- 冻结 HEAD/tree/diff hash/changed files+hunks/new files/tests。
- 主线程和独立只读 Reviewer 覆盖 100% changed files/hunks、完整调用链、6 adapter、4 media kind、backup/CI。
- `P0>0` 或 `P1>0` 必须修复并做增量 Review。
- Review GO 后只运行一次 formal safe full。
- 原始 full 失败如实保留，只最小关闭，不重复 full。
- formal full 后若修了产品源码，重新冻结并让同一独立 Reviewer 做增量 Review；不得用“full 已跑过”跳过最终源码复审。
- 更新 Matrix/Checkpoint；没有生产证据的项保持 NOT_RUN/NO_GO。

## 7. 测试红线

- 只使用仓库 `scripts/run-safe-tests.mjs`。
- 只使用新临时 data、动态 loopback、fake Provider/OSS。
- 禁止固定 4173、`app/data`、`/var/lib/unboundry`、生产数据库、真实媒体、真实 credential、生产 backup。
- 外部 egress、真实 Provider POST、真实 OSS 写、新费用都必须为 0。
- 文档-only 变化不重复业务测试。
- 测试失败先诊断并只重跑失败项/最小依赖；唯一 final full 前不为安心跑 full。

## 8. 完整 Review 分母

候选冻结后必须覆盖：

- 所有 changed files、tracked diff hunks、新文件全文；
- click→preparation→HTTP create→run/plan/locks/reservation→node claim→task admission→Provider boundary→task id/response→publication→result commit→node/downstream→projection→terminal history/stop；
- HTTP、single-node、workflow、retry、startup sweep、task panel、stop、projection、backup；
- ark-text、ark-video、mureka-audio、openrouter-image、relay-gpt-image、relay-media；
- text/image/video/audio；
- success、definitive failure、temporary inspect、publication pending、billing unknown、operator incident、no-new-fact；
- schema42 backup/verify/restore、CI、current/historical runbook 路由；
- DATA/ownership/idempotency/billing/secret/protected-file 边界。

报告必须列 numerator/denominator、未覆盖项、证据和 P0/P1/P2。不得用 file inventory 或测试数量冒充语义 Review。

## 9. 硬停止

发生以下任一条件立即停止并报告：

- 仓库/生产身份冲突且不能解释；
- 需要受保护文件；
- 需要真实 Provider/OSS/生产/数据 apply；
- 发现必须 schema43 才能满足不变量；
- unknown outcome 可能产生第二 POST；
- publication pending 仍可能被删除；
- exact 目标节点的已选模型不 eligible，或必需 kind 没有 published eligible model却仍允许创建 run；
- 当前方案需要扩大到无关大重构；
- formal full 权限已消费却想无理由重复；
- 候选仍有 P0/P1；
- 需要版本、GitHub、发布或生产权限。

执行过程中不要中途向用户询问普通工程问题；只在上述真实权限/身份/安全边界阻断时停。

## 10. 最终交付

用简单中文先说结果，再给：

1. 实际改动文件和合同；
2. 每阶段 Matrix 状态；
3. 定向测试和唯一 full 原始结果；
4. Review denominator 与 P0/P1/P2；
5. 没做的生产/Provider/OSS/版本动作；
6. 唯一下一步：请求用户另行确认版本号和发布/生产/真实 canary 权限。

---
