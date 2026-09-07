# Unboundry 当前状态

文档角色：`CURRENT_STATE`。本页维护项目现状；当前授权、进度和验收见 [当前任务](../TASKS.md)。本地、GitHub和生产入口于2026-09-07核对。发布身份与验证证据由 [v0.7.15发布回执](V0_7_15_PRODUCTION_RECEIPT_2026-09-07.json) 维护。

当前新增的生成状态查询加固已完成本地实现，受影响139项回归通过，撤销演练与独立复审结果由当前任务维护。用户已确认本次三项本地验收通过；新增保存报错已定位为验收工具的素材登记问题并修复，证据见当前任务。用户已授权递增小版本并上线，当前准备v0.7.16，发布门执行结果见当前任务；尚未切换生产，不改变下述已发布修复的验收状态。

## 项目现在怎么样

**最近核验的生产是 v0.7.15 / schema43。** 本轮模板保存隔离、其余12项修复及后续反馈全部本地验收通过，现已发布。生产工程检查通过，用户于2026-09-07回复“通过”，本轮正式站验收完成。

当前代码包版本：**v0.7.16**
本地候选代码版本：**v0.7.16**
本地候选 schema：**43**
生产观测日期：2026-09-07。
当前产品验收标记：`CURRENT_V0_7_15_USER_PASS`

最近交付的修复状态：`DEPLOYED / LOCAL_USER_PASS / PRODUCTION_USER_PASS`。本地用户明确“其他的都通过”“通过了 收尾吧”，范围见 [修复方案7～9节](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md)。随后授权“允许上线，各种流程都允许”；发布见 [方案第10节](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#10-v0715发布2026-09-07)。本地验收临时环境已正常关闭清理。生产确认原话与范围见发布回执；不扩大为付费生成、真实维护演练或生产性能基准通过。

生产已核对：精确tag独立构建；CURRENT数据、schema43、媒体及secret清单保持；33个静态资源公网/loopback全部匹配。原生Chrome已有画布正常打开，图片更多菜单九项无遮挡，快速切分能打开/取消，模板状态筛选使用项目控件；查看、刷新和菜单操作后原画布行、保存版本及生成计数不变。未执行真实生成。旧v0.7.14页面维护后仍需人工刷新，不把旧客户端现象作为新v0.7.15重连验证。

## 各环境入口

- 开发工作树：以当前checkout的Git根、HEAD、分支和dirty状态为准，不按历史路径或分支强制切换。
- GitHub：`jasionia1991-max/unboundry`，默认分支`main`。生产产品tag为`v0.7.15`，commit为`8ac75ca79d525d34e8a9b1b8b5fb820c020cd402`；后续治理提交不改变产品构建身份。
- 服务器治理：`/opt/unboundry/AGENTS.md` → `/opt/unboundry/governance/current/AGENTS.md`。镜像根目录`.governance-manifest.json`拥有实际文档提交与逐项哈希；历史 [同步回执](DOC_GOVERNANCE_SYNC_RECEIPT_2026-09-06.json) 只证明当次同步。
- 产品current：`/opt/unboundry/releases/v0.7.15-bug-ui-20260907`。release内文档仅代表构建时点，当前治理入口与产品构建分开。
- 本机外层`/Users/mymy/Documents/unboundry`是独立资料Git，导航负责定位本机开发工作树；其他历史副本不是当前代码入口。

## 未决事项

| 项目 | 当前状态与边界 | 后续入口 |
| --- | --- | --- |
| 每日自动备份 | OPEN / USER_DEFERRED。旧作业要求schema41，当前schema43，报Backup database validation failed；手动备份不修复timer | [备份合同](../ops/production/README.md)，待用户恢复此项 |
| 视频/音频空工具按钮 | USER_DEFERRED，按用户要求跳过 | [修复方案](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md) |
| 历史图与首次画布性能 | DEPLOYED / LOCAL_TARGET_PASS / LOCAL_USER_PASS。本地180样本目标通过；未重测正式站基准，不宣称对齐竞品 | [性能证据7.2](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#72-性能结论与范围) |
| 维护后更新通知 | DEPLOYED / LOCAL_USER_PASS。35秒模拟维护及草稿保护已验证；新客户端真实维护场景尚未独立复验 | [本地证据](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#7-本地实施与交付2026-09-07) |
| 依赖告警修补 | DEPLOYED / TEST_REVIEW_PASS。锁文件qs6.16.0，发布CI通过；high阈值CI绿色不等于完全无告警 | [发布回执](V0_7_15_PRODUCTION_RECEIPT_2026-09-07.json) |
| 已暂停或未验收功能 | 真实Agent、团队、打光、Mureka真实生成、Storyboard完整生命周期等维持原状态 | [验收账本](UNBOUNDRY_ACCEPTANCE_MATRIX.md)对应条目 |

这些是项目登记，不是同时施工的任务，也不提供新的授权。

## 备份与回退约束

本次最新冻结加密备份已完成verify、独立fresh restore及云端逐文件GET核验；确切计数与路径见发布回执。保留98条历史非阻断媒体提示，不声称历史素材全部完好。

v0.7.15已审核可切回精确旧v0.7.14包并保留CURRENT，隔离Linux新→旧→新及两包DELETE保存均通过；没有执行真实systemd回退。包/脚本身份由 [发布回执](V0_7_15_PRODUCTION_RECEIPT_2026-09-07.json) 维护。**禁止直接切旧v0.7.13**。实际回退前按 [发布手册](../RELEASE_RUNBOOK.md) 和备份合同重新核对身份、兼容性及当次授权；Git检查点不等于数据备份。

## 阅读范围

默认接手只读 [工作规则](../AGENTS.md)、本页、当前任务。按主题选合同，不默认读取完整方案、账本或全仓审计。旧事实按需进入 [历史状态原文](UNBOUNDRY_CURRENT_STATE.history.md) 或 [2026-09-06查阅报告](PROJECT_DOCUMENTATION_AUDIT_2026-09-06.md)；旧报告保持当时快照，不是新指令。
