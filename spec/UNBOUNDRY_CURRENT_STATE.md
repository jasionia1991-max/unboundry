# Unboundry 当前状态

文档角色：`CURRENT_STATE`。本页维护项目现状；当前授权、进度和验收见 [当前任务](../TASKS.md)。本地代码、GitHub和生产于2026-09-07实测核对。发布身份、备份、回退与验证数据由 [v0.7.16发布回执](V0_7_16_PRODUCTION_RECEIPT_2026-09-07.json) 维护。

## 项目现在怎么样

**最近核验的生产是 v0.7.16 / schema43，发布工程检查通过，等待用户确认正式站体验。** 生成状态查询加固已上线；本地三项查询恢复及保存工具修复均已由用户确认通过。工程检查、生产部署和用户验收分别记账，当前状态为`DEPLOYED / PRODUCTION_TECHNICAL_PASS / LOCAL_USER_PASS / PRODUCTION_USER_RECHECK`。

当前代码包版本：**v0.7.16**
本地候选代码版本：**v0.7.16**
当前 schema：**43**
生产观测日期：2026-09-07。
当前产品验收标记：`CURRENT_V0_7_16_USER_RECHECK`

本次保留原任务，仅在查询网络错误、超时或5xx时有限自动重查；持续失败仍可手动检查。未新增生成提交、持久字段或schema迁移。行为合同见 [生成架构](UNBOUNDRY_GENERATION_ARCHITECTURE.md)，验收和回退范围见 [查询加固方案](GENERATION_STATUS_QUERY_HARDENING_PLAN_2026-09-07.md)。用户遇到的验收画布保存报错来自临时素材未登记，已修复验收工具；没有放宽产品保存校验。

生产已核对：精确tag独立构建，current及健康/租约正常；33项公网与loopback静态资源与安装包一致。冻结切换前后业务表、媒体及secret文件保持；已有画布刷新后27个节点、位置和revision44不变，图片/视频可读，显示已保存到云端，额外Canvas写入和生成请求均0。服务重启导致loadToken/saveEpoch按既有进程合同变化，不是画布内容变化。未执行真实生成。

此前模板保存、其余12项及图片「浏览全部」等修复仍保留v0.7.15的用户通过状态，见 [v0.7.15回执](V0_7_15_PRODUCTION_RECEIPT_2026-09-07.json)；本次不扩大其他历史条目的验收。

## 各环境入口

- 开发工作树：以实际checkout的Git根、HEAD、分支和dirty状态为准，不按历史路径强制切分支。
- GitHub：`jasionia1991-max/unboundry`，默认分支`main`。产品tag为`v0.7.16`；精确commit/tree由发布回执维护。后续治理提交不改变产品构建身份。
- 产品current：`/opt/unboundry/releases/v0.7.16-status-query-20260907`。
- 服务器治理：`/opt/unboundry/AGENTS.md` → `/opt/unboundry/governance/current/AGENTS.md`。镜像根`.governance-manifest.json`拥有实际文档提交和逐项哈希；产品release内文档仅代表构建时点。
- 本机外层`/Users/mymy/Documents/unboundry`是独立资料Git，仅负责导航；其他历史副本不是当前开发入口。

## 未决事项

| 项目 | 当前状态与边界 | 后续入口 |
| --- | --- | --- |
| v0.7.16正式站体验 | USER_RECHECK。技术检查已通过，用户尚未确认新版正式站 | [发布回执](V0_7_16_PRODUCTION_RECEIPT_2026-09-07.json) |
| 每日自动备份 | OPEN / USER_DEFERRED。旧schema41作业未修复，手动发布备份不代表timer生效 | [备份合同](../ops/production/README.md) |
| 视频/音频空工具按钮 | USER_DEFERRED，继续按用户要求跳过 | [既有修复方案](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md) |
| 历史图与首次画布性能 | DEPLOYED / LOCAL_TARGET_PASS / LOCAL_USER_PASS；未重测正式站性能基准 | [性能证据7.2](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#72-性能结论与范围) |
| 维护后更新通知 | DEPLOYED / LOCAL_USER_PASS；本次人工刷新加载新版，不冒充真实维护后的自动重连通过 | [既有本地证据](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#7-本地实施与交付2026-09-07) |
| 依赖告警及已暂停功能 | qs修补已部署；CI的high阈值通过不代表无全部告警。真实Agent、团队、打光、Mureka真实生成、Storyboard等不改变原状态 | [验收账本](UNBOUNDRY_ACCEPTANCE_MATRIX.md)对应条目 |

这些是项目登记，不提供同时施工或新的发布授权。

## 备份与回退约束

此次最新冻结加密备份、verify和独立fresh restore均通过；云端上传/GET的最终状态、精确计数和路径以发布回执为准。保留98条历史非阻断媒体提示，不宣称所有历史素材完好。

v0.7.16固定回退至本次核验的精确旧v0.7.15，并保留CURRENT数据。RB05隔离Linux新→旧→新、同数据保存/刷新、原合成任务记录和客户端草稿/构建身份已通过；不是实际线上systemd回退或真实Provider恢复。实际回退使用本次回执绑定的操作单和脚本，重新执行当次静默、最新备份与恢复校验；失败维持维护，不自动切回问题新包，不恢复数据库。禁止跳过本次兼容身份直接切更老包，尤其旧v0.7.13。

## 阅读范围

默认只读 [工作规则](../AGENTS.md)、本页、当前任务，再按主题进入合同。旧事实按需见 [历史状态](UNBOUNDRY_CURRENT_STATE.history.md) 或 [查阅报告](PROJECT_DOCUMENTATION_AUDIT_2026-09-06.md)，不以历史记录替代当前事实。
