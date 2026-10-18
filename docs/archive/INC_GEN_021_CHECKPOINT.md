> **历史断点路由（2026-09-06）**：本文保留对应事件的当时证据和独立未决项，不承担当前生产身份或执行授权。接手先读 [UNBOUNDRY_CURRENT_STATE.md](../../spec/UNBOUNDRY_CURRENT_STATE.md) 与 [文档索引](../../spec/PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)；不得因本文旧“当前/Goal/允许发布”重启操作。未确认项目不自动升级PASS。

# INC-GEN-021 Checkpoint

状态：`V0_6_67_RELEASED_TO_PRODUCTION / PRE_CLICK_P0_FOUND / REAL_GROUP_CLICK_NOT_CONSUMED / SUPERSEDED_BY_INC_GEN_022`

- v0.6.67 已完成 candidate `8728659ca93b8b7225039ce0cd3fd3268bd60484`、PR #140、PR/main CI、merge `78332c50473be83ff678e0f344cfcb6004c98081`、annotated tag/GitHub Release、精确tag Linux fresh build、冻结source/restore与生产原子切换；生产v0.6.67/schema41健康。
- 真实整组点击前发现terminal-detach application identity客户端/服务端不一致，合法旧任务解绑被HTTP 400拒绝。整组点击0/1、Provider POST0/11、费用0，真实多媒体结果仍未验收。
- 后续权威断点转为`spec/INC_GEN_022_CHECKPOINT.md`；不得把v0.6.67生产技术通过写成真实整组通过。

- 工作树：`/Users/mymy/Documents/unboundry-inc-gen-016-v0.6.56-2026-08-28`。
- 分支：`codex/inc-gen-021-cross-media-one-click-reliability`；基线 HEAD `968870189d160dba4374a00b03784eb37d8f58d3`；候选 package 为 `0.6.67`。
- 用户既有未跟踪受保护文件 `spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json` 未读取、未修改、未暂存、未移动、未删除。
- 现网事实：v0.6.66/schema41，service active、NRestarts0、磁盘约 41% 使用；目标 Canvas 截图为文字 1 成功、图片 1 失败、其余 9 未运行，不能写真实整组通过。
- 原失败任务：`8b6e5b71-c45f-485d-a6a7-7f83dc7be3f1`，image/attempt1/`RESULT_SAVE_FAILED_NO_RETRY`；不得重提该任务。
- 根因：v0.6.66 的 OSS 图片保存没有 durable staging；视频/音频已有 staging 但失败时补偿删除；pending generated publication 只在启动时恢复。
- 已实现：三种媒体在 Provider 返回后统一保留 staging；临时 OSS/提交失败抛出 deferred 信号，由后台恢复同一 publication，不重新进入 Provider 提交。
- 已实现：运行时 sweep 优先恢复 pending publication，并阻止同一 recovering task 同时轮询/匹配 Provider；relay 完成候选后只恢复同一 Provider task id。
- 已实现：`RESULT_SAVE_FAILED_NO_RETRY` 终态覆盖旧 recovery checkpoint 文案。
- 定向证据：TypeScript `npx tsc --noEmit`、`git diff --check`通过；safe m22 `44/44`；safe m38+m57+m88+m90 `94/94`；最终 m38+m88 `56/56`。最后一次 source/snapshot=`df09537d…b1f09`，4173 unchanged、临时目录已清理。
- 新增核心故障注入：图片、视频、音频首次 OSS 上传确定性失败，后台均读取逐字节相同 staging 恢复；三任务均 attempt1 成功，paid Provider request 计数只随原任务累计为1/2/3，无额外 Provider submission，临时媒体文件清零。
- m57继续覆盖图片/视频/音频已发布协议；m88直接覆盖三种媒体的 publication staging、失败保留和运行时续传。剩余真实环境风险将在发布后唯一整组中关闭。
- 本地测试使用 Node 22.23.1 safe runner、动态 loopback 和临时数据；真实 Provider POST、真实 OSS、生产数据写和新费用均为 0。
- 当前生产仍是 v0.6.66，用户此刻访问的网站还没有本候选修复。
- 用户已确认并允许发布 v0.6.67；发布后真实整组授权为预算上限 CNY 300 等值、只点击一次、最多 11 次 Provider POST、不重试、结果不明时只核对原任务。该点击权限尚未消费。
- v0.6.67占用门：本地/远端tag与GitHub Release均未占用，`origin/main`与基线HEAD同为`968870189d160dba4374a00b03784eb37d8f58d3`。
- 版本定向门：m81 `41/41 PASS`；m38首轮`17/18`只暴露三份渐进模块化文档仍为`CURRENT_V0_6_66`，精确同步后m38 `18/18 PASS`，source/snapshot=`26606992…9b71b5`。业务测试没有失败，4173 unchanged。
- 本轮唯一正式 safe full 已执行全部 `122 specs / 1140 tests`，原始结果 `1139/1140 PASS`、退出1；唯一失败是未改动 m69 的删除后立即 `Meta+Z` 恢复节点观测超时。完全相同的832-file source/snapshot `1adf761b…926d5`只复验 m69，`6/6 PASS`、退出0；未运行第二次full。4173 listener前后不变，隔离临时目录已清理，真实Provider/OSS/生产写入仍为0。
