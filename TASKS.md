# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见 [当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：v0.7.17 节点恢复发布收尾

任务ID：`VIDEO-BALANCE-RETRY-20260907`。V3/V4 本地修复、撤销演练、相关回归和用户验收已完成；V4 第1、2、3项均获 `USER_PASS`，仍未上线。证据、未测范围和入口见[恢复方案第10节](spec/VIDEO_BALANCE_SINGLE_NODE_RECOVERY_PLAN_2026-09-07.md#10-第4版本地实施与验证2026-09-08)。

用户已授权：发布 v0.7.17；并于 2026-09-09 同意保留旧未知请求的停服备份方案。授权包含发布检查、备份、回退演练及上线，不包含真实付费生成、Provider/OSS 写入、旧任务清账或取消、schema 迁移、备份删除和云权限变更。维护功能继续默认关闭。

## 受影响合同与必须保留的行为

依据[生成架构合同](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)第2节/2.3、[UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9/6.2/6.3，以及发布阶段的[发布手册](RELEASE_RUNBOOK.md)和[备份合同](ops/production/README.md)：

- 9个成功节点的结果、素材、位置、连线和既有模板/菜单/白框保持；正常整组自动推进、回填、保存和刷新保持。
- 四节点有限重查、原结果找回、单节点/工作流互斥、取消、完整身份与模型合同保持；未知或已受理付费边界不得被新任务ID、输入修改或刷新绕过。
- 失败 run 不复活，不因恢复自动新增 Provider POST；DATA-005 继续保持跨标签最后保存者胜、同标签迟到请求拒绝。
- 测试只走 `scripts/run-safe-tests.mjs`，使用临时数据和动态 loopback；保护 JSON 必须在访问前按路径排除。

## 已完成的本地实现与验证

施工根：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`；分支 `codex/v0717-node-recovery-release`；本轮冻结 HEAD `38709d2b878e8546daa06e9ea20d2a82a2ae91b8`，保留 dirty 工作树。

- V4 持久维护记录、严格 admin、原结果受保护找回、四节点进展、管理页及重启接续已实现；维护开关默认关闭，schema 仍为 43。
- `quiesced-active-preservation` 已实现：在停服证明与既有 active lease 下保留精确旧 task/attempt 的未知事实，完整核验事件、付费围栏、媒体/secret 和 logical SHA；不改 task 终态，额外活动边界或证据不一致即拒绝。
- verification-72 安全入口通过：`tests/m10-backup.spec.ts` 21/21、`tests/m93-runtime-role.spec.ts` 8/8，共 29/29；发现清单 134 specs/1368 tests，类型、架构、构建、隔离和 loopback 前置通过。回执：[verification-72](../node-recovery-v0717-release-ops-20260908/verification-72-m10-m93.json)。
- 已有发布增量 95 项与 71 号存储层演练证据继续有效，范围不扩大；本轮独立后端复审未见待处理 P0/P1，不等于全仓安全审计。
- 本地用户验收已完成；第3项修复后的真实页面顺序、未知保护、刷新和媒体可读性均按方案10.6记账。

## 生产事实与发布断点

正式站仍为 `v0.7.16/schema43`。只读核对的唯一旧 task `9c93f308-bb77-4935-a4e3-37dd72e6cd28` 仍是 `recovering/AUTOMATIC_RESULT_RECOVERY`，attempt 为 `outcome-unknown` 且无平台 task ID；原始 Provider code/msg 未保存。充值、`finished_at`、假回执或维护 phase 都不能证明未受理、未扣费或可取消；不得清账、改码或整组重跑。正式站没有本轮生产写入或 Provider 请求。

ops 切换/回退脚本的独立复审正在完成；完整 Linux 真实安装包、真实备份、systemd 停服切换和线上回退尚未执行，不能把本地 29/29、95/71 或合成演练写成生产放行。完成精确身份、CI/tag、停服保留式备份、verify/fresh restore、回退门和文档回执后，才执行提交、PR、CI、tag、部署；任一失败保留旧站和 CURRENT。

## 下一步

只收口 ops 脚本复审及其真实发布专属证据，保持 v0.7.16 生产、v0.7.17 本地候选和维护默认关闭；不新增产品功能，不改变旧 task/attempt 事实。每日自动备份及视频/音频空工具按钮仍暂缓。
