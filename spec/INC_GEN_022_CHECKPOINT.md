> **历史断点路由（2026-09-06）**：本文保留对应事件的当时证据和独立未决项，不承担当前生产身份或执行授权。接手先读 [UNBOUNDRY_CURRENT_STATE.md](UNBOUNDRY_CURRENT_STATE.md) 与 [文档索引](PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)；不得因本文旧“当前/Goal/允许发布”重启操作。未确认项目不自动升级PASS。

# INC-GEN-022 Checkpoint

状态：`V0_6_67_DEPLOYED / PRE_CLICK_P0_FOUND / V0_6_68_RELEASE_AUTHORIZED / RELEASE_IN_PROGRESS`

- 工作树：`/Users/mymy/Documents/unboundry-inc-gen-016-v0.6.56-2026-08-28`。
- 分支：`codex/inc-gen-022-terminal-detach-contract`；基线为 `origin/main@78332c50473be83ff678e0f344cfcb6004c98081`。
- 生产 v0.6.67/schema41 已部署且 service active/enabled、NRestarts0；tag、Release、fresh Linux build、冻结 source/restore 与静态文件门均已通过。
- 目标 Canvas：`3b3cb4f8-56c3-49f5-ad42-1a00748ba33a`；目标 group：`group-fe8ea3c2-981d-4377-80e7-33aef9d38f35`。
- 原失败任务：`8b6e5b71-c45f-485d-a6a7-7f83dc7be3f1`，image/attempt1/`RESULT_SAVE_FAILED_NO_RETRY`。未重试、未新增 task/attempt/Provider POST。
- 点击前精确加入目标 Canvas reconciliation allowlist，并通过页面放弃一条旧续跑缓存；历史任务没有删除。客户端随后只核对原任务并调用 `generation-terminal-detach`。
- 生产证据：同一合法请求连续返回 HTTP 400，节点仍保持原 task/run/ownership/input binding；真实整组点击 0/1，Provider POST 0/11，费用 0。
- 根因已由代码合同确认：客户端 `legacyTerminalDetachApplicationId` 对整个 candidate 展开，错误包含 `fixtureScopeId`；服务端 `legacyTerminalDetachApplicationIdForBinding` 不包含该浏览器缓存字段。两端稳定指纹必然不同。
- 目标 allowlist 已撤回并保留在 `/opt/unboundry/staging/95-inc-gen-021-recovery.disabled-after-contract-mismatch.conf`；生产恢复原两条 allowlist，v0.6.67 继续健康运行。
- 本地修复：客户端显式选择与服务端一致的十个合同字段；m22 新增跨层相等性与 fixture scope 非参与回归。服务端任何安全校验未放宽。
- 定向 safe runner：m22 `44/44`、m85 `27/27`，合计 `71/71 PASS`；source/snapshot `28763e322d0f9c81188a982a241facc34e91c40b7a209bccec88d790b8c3b21d`，4173 unchanged，Provider/OSS/生产写为0。
- 版本/治理门：m81 `41/41 PASS`；m38首轮`17/18`只暴露治理标记格式未同步，修正四份治理文档后只复验m38并`18/18 PASS`，source/snapshot `adb9910e25f305c96792ee47f45d3f8785ecabe1bb6bb2b992d68ea483e30e39`。两轮safe preflight均完成TypeScript与production build，`git diff --check`通过，4173 unchanged。
- 用户已明确确认版本 v0.6.68 并允许发布 v0.6.68；commit/push/PR/CI/tag/Release、冻结备份和生产切换进入本次一次性授权。真实整组点击仍未消费。
- 用户既有未跟踪受保护文件 `spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json` 未读取、未修改、未暂存、未移动、未删除。
