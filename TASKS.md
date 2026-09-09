# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见 [当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：v0.7.17 节点恢复发布收尾

任务ID：`VIDEO-BALANCE-RETRY-20260907`。V3/V4 本地修复、撤销演练、相关回归和用户验收已完成；V4 第1、2、3项均获 `USER_PASS`，已上线，生产用户确认另记。证据、未测范围和入口见[恢复方案第10节](spec/VIDEO_BALANCE_SINGLE_NODE_RECOVERY_PLAN_2026-09-07.md#10-第4版本地实施与验证2026-09-08)。

用户授权：发布 v0.7.17；并于 2026-09-09 同意保留旧未知请求的停服备份方案。授权包含发布检查、备份、回退演练及上线，不包含真实付费生成、旧任务清账或取消、schema 迁移、备份/历史素材删除和云权限变更；本次新加密备份的私有上传及下载哈希核验属于已授权发布备份范围。维护功能继续默认关闭。

## 受影响合同

依据[生成架构合同](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)第2节/2.3、[UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9/6.2/6.3，以及发布阶段的[发布手册](RELEASE_RUNBOOK.md)和[备份合同](ops/production/README.md)：

## 必须保留的行为

- 9个成功节点的结果、素材、位置、连线和既有模板/菜单/白框保持；正常整组自动推进、回填、保存和刷新保持；普通账号默认五项权限不减少。
- 四节点有限重查、原结果找回、单节点/工作流互斥、取消、完整身份与模型合同保持；未知或已受理付费边界不得被新任务ID、输入修改或刷新绕过。
- 失败 run 不复活，不因恢复自动新增 Provider POST；DATA-005 继续保持跨标签最后保存者胜、同标签迟到请求拒绝。
- 测试只走 `scripts/run-safe-tests.mjs`，使用临时数据和动态 loopback；保护 JSON 必须在访问前按路径排除。

验证方法：冻结候选、safe runner临时合成数据和动态loopback核验原自动恢复、单节点互斥与付费保护、四节点UI及数据保存；精确完整包隔离Linux回退门另行执行，不用模拟结果替代生产事实。

## 已完成的本地实现与验证

施工根：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`；原实施分支 `codex/v0717-node-recovery-release`；发布基线 HEAD `38709d2b878e8546daa06e9ea20d2a82a2ae91b8`；91份已验收及发布增量文件已提交为 `c3d21e39c0ece8ac400b00345b5e2aed13199dbc`。后续文档提交属于发布收尾，最终head以PR实际记录为准，不改变已验收产品行为。

- V4 持久维护记录、严格 admin、原结果受保护找回、四节点进展、管理页及重启接续已实现；维护开关默认关闭，schema 仍为 43。
- `quiesced-active-preservation` 已实现：在停服证明与既有 active lease 下保留精确旧 task/attempt 的未知事实，完整核验事件、付费围栏、媒体/secret 和 logical SHA；不改 task 终态，额外活动边界或证据不一致即拒绝。
- 工程检查：verification-72 安全入口通过：`tests/m10-backup.spec.ts` 21/21、`tests/m93-runtime-role.spec.ts` 8/8，共 29/29；发现清单 134 specs/1368 tests，类型、架构、构建、隔离和 loopback 前置通过。回执位于本地证据目录 `/Users/mymy/Documents/unboundry/node-recovery-v0717-release-ops-20260908/verification-72-m10-m93.json`。
- 已有发布增量 95 项与 71 号存储层演练证据继续有效，范围不扩大；独立复核：本轮独立后端复审未见待处理 P0/P1，不等于全仓安全审计。
- 用户验收：本地用户验收已完成；第3项修复后的真实页面顺序、未知保护、刷新和媒体可读性均按方案10.6记账。

## 生产发布与收尾断点

GitHub付费限制已解除；PR #173及合并main检查通过，精确v0.7.17 tag/Release、Linux不可变包构建和完整隔离新→旧→新演练通过。第四次生产切换已成功，正式站为v0.7.17/schema43。最新停服保全备份、verify/fresh restore、静态资源逐字节检查与原画布只读打开/刷新通过。新加密备份私有上传及GET哈希/大小核验已通过；正式站工程结果为PRODUCTION_TECHNICAL_PASS，生产用户验收仍USER_RECHECK。

前三次失败及补偿保留：等待期间原后台查询事件、Node loader启动顺序、网页检查命令缺少身份参数。外层工具已修复并独立复核；第三次实际新→旧systemd补偿通过，第四次成功；这些不是产品功能变更，也不构成已执行正式rollback.py。精确日志、哈希、范围和回退身份统一见[本次发布回执](spec/V0_7_17_PRODUCTION_RECEIPT_2026-09-09.json)。

## 下一步

本次文档按实测更新并经独立复核；文档提交必须通过最终PR head/main CI后同步私有治理镜像，不重建或重启产品包。当前收尾分支为`codex/v0717-production-receipt`；精确文档身份由服务器`.governance-manifest.json`拥有，同步检查由本次运维目录`evidence/governance-sync.json`拥有，本页不自证自身提交已经同步。

用户下一步：刷新正式站并继续原画布工作，确认已完成节点保持、失败节点仍可按真实状态单独继续；不要求为验收额外付费生成。未确认前保持生产USER_RECHECK。

本地验收为USER_PASS；生产用户确认仍为USER_RECHECK，本轮不执行真实付费生成。每日自动备份、视频/音频空工具按钮仍暂缓，维护功能默认关闭。用户取消的自托管CI路线保持取消，不重复索要现有发布授权。
