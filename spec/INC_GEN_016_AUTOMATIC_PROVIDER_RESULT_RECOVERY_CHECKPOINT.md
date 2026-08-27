# INC-GEN-016 实时断点

状态：`FINAL_AUDITED_PLAN / DOCUMENTATION_ONLY / IMPLEMENTATION_NOT_STARTED / INCIDENT_OPEN / RELEASE_GATE_CLOSED`

更新时间：2026-08-27

## 当前事实

- 工作树：`/Users/mymy/Documents/unboundry-model-contract-002-2026-08-27`
- 当前 Git：`main@384c27f`，开始落档前与 `origin/main` 一致且工作树干净。
- 当前生产：`v0.6.54 / schema41 / service healthy / USER_RECHECK`。
- 目标画布：`67bfb2ee-f895-4308-9111-9de188306514`，名称“MODEL-CONTRACT-001 真实生成验收 2026-08-27”。
- 目标节点：`video-019c3604-bae5-4880-b7ac-8410231df6a0`，`grok-video-3`，Prompt + 恰好一张首帧，9:16、720p、10秒、音频开启、输出1。
- 原任务：`da761fff-6a65-46fd-84cf-4dc5bddbc985`；2026-08-27 22:33 左右只增加一次 `new-paid-retry`，execution attempt 2 越过 `provider-boundary`。
- 最终状态：`failed / OUTCOME_UNKNOWN_BILLING_RISK`；`provider_task_id=null`、`result_asset_id=null`、`actual_cost_microunits=null`，预估 USD 10；两次原任务核对没有唯一账本匹配，未再次提交。
- 用户截图确认普通页面只显示“核对太频繁，请稍后再试/核对结果”，没有图片或视频结果；这违反产品“工作流自动跑完”的核心合同。

## 最终审计结论

- 直接原因不是单一 UI 文案，而是声明式成功响应白名单、合同路径恢复旁路、用户触发 reconcile 和有界内存 recovery 共同形成的架构缺口。
- 修复必须同时覆盖有限响应合同、持久任务号、后台自动恢复、结果资产、Canvas投影和普通用户体验。
- 修复共享任务生命周期时，全部当前已发布模型、专用 connector、历史任务、旧 Canvas/模板和不可变 Revision 必须通过非回归门。
- 没有正式恢复能力的异步 connector 不得切换为可用新路径；旧路径在新路径验收成功前保持不动。
- 真实结果没有自动回到生产项目，就不能发布或关闭事故。

## 当前授权与账本

- 本轮用户只授权最终审计结果落地成文档，并明确“先别改代码”。
- 用户随后要求生成新Session一次性Goal并提前写明实施所需权限；Goal模板现已冻结v0.6.55、GitHub/生产、目标画布、真实费用USD 20上限和一次最终全量Review。只有用户在新Session完整发送该Goal时才生效，本Session仍不启动开发。
- 已修改范围只能是 Markdown 权威文档；产品代码、测试、schema、package/lock 均不得修改。
- 本轮 Provider/Generation/OSS/生产/GitHub/费用预算均为 0。
- 历史一次真实生成授权已经消费，不能复用；下一次真实验收、版本号和发布均需未来明确授权。

## 文档落地验证

- `git diff --check` 通过；变更范围只有 Markdown 权威文档，没有产品代码、测试、schema、package 或锁文件变化。
- 受保护 `spec/public-templates-director-split-revision.json` 未读取、未修改、未暂存。
- 文档治理与生成事故定向 safe m38：`15/15 PASS`，failed/skipped/retries/blocked/reportErrors 均为 0；Node `22.23.1`、npm `10.9.8`，动态 loopback 与新临时目录，4173 listener unchanged。
- m38 source/snapshot SHA-256 均为 `8c72526267b8a8a1742a37a1823b1447a745bed390c7d01cc81be2c987c8a0fe`；它是文档落档时的定向证据，不是 INC-GEN-016 产品实现或完整回归。

## 恢复顺序

1. `AGENTS.md`
2. `上线规矩.md`
3. `spec/UNBOUNDRY_CURRENT_STATE.md`
4. 本文件
5. `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_PLAN_2026-08-27.md`
6. `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_ACCEPTANCE_MATRIX_2026-08-27.md`
7. `TASKS.md` 的 INC-GEN-016 区块

只有用户未来明确发起新的 `/goal` 或明确要求开始开发，才可使用 Goal 模板进入 R0；不得从本 Checkpoint、历史 Goal、聊天摘要或旧授权自动开始代码。

## 唯一下一步

等待用户未来明确启动实施。启动后第一步仍是只读核对真实 Git/生产/package/schema/模型清单和费用授权，先写 R0 证据与预期红，再修改产品代码。
