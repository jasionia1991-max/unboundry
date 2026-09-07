# Unboundry 当前状态

文档角色：`CURRENT_STATE`。本页只维护项目现状；当前授权、工作进度和验收见 [当前任务](../TASKS.md)。本地、GitHub 和服务器入口于 2026-09-06 核对。下面产品验收及备份详情沿用同日既有证据；本次文档同步另行核对产品版本、current 指针与服务状态，具体范围由当前任务和同步回执记录。

## 项目现在怎么样

**最近核验的生产是 v0.7.14 / schema43。** 媒体比例、视频完整预览、选中模板置前已在上一轮获用户验收。生产遗留问题与本地修复状态见下表；不能把该版本通过理解成全部功能通过。

当前代码包版本：**v0.7.15**
本地候选代码版本：**v0.7.15**
本地候选 schema：**43**
生产观测日期：2026-09-06。
当前产品验收标记：`CURRENT_V0_7_14_USER_PASS`
产品验收证据：[v0.7.14 发布回执](V0_7_14_PRODUCTION_RECEIPT_2026-09-06.json)、[媒体比例验收记录](MEDIA_ASPECT_RATIO_LOCAL_CHECKPOINT_2026-09-06.md)。具体行为规则由 [UI 合同 6.3](UNBOUNDRY_UI_DESIGN_SYSTEM.md) 维护。本页只记录产品验收；文档治理的验收结果由 [当前任务](../TASKS.md) 维护。

本地候选的模板保存隔离、其余12项修复及后续三项验收反馈修正，2026-09-07已获用户“其他的都通过”确认；证据见 [修复方案第9节](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#9-图片更多工具菜单遮挡修正2026-09-07)。最后一项图片顶部「浏览全部」菜单遮挡修复，在完成相关测试、独立复审与Chrome工程复验后，同日获用户明确“通过了 收尾吧”确认；本轮已授权的本地修复全部验收收尾，状态为 `LOCAL_USER_PASS / NOT_DEPLOYED`，验收临时环境已关闭并清理。每日自动备份与视频/音频空按钮按用户要求暂缓。本轮授权、完成记录与边界见 [当前任务](../TASKS.md)。2026-09-07用户新增“允许上线，各种流程都允许”授权，正在准备v0.7.15发布；已只读核对生产仍为v0.7.14，尚未切换。上线进度只看当前任务，既有本地通过不代替新版本生产验收。

## 各环境入口

- 开发工作树：以当前 checkout 的 `git rev-parse --show-toplevel`、HEAD、分支和 dirty 状态为准；不按历史路径或旧分支强制切换。
- GitHub 源仓库：`jasionia1991-max/unboundry`，默认分支 `main`。文档发布从通过 CI 的精确提交导出。
- 服务器治理入口：`/opt/unboundry/AGENTS.md` → `/opt/unboundry/governance/current/AGENTS.md`。导出文件清单与来源提交由镜像根目录 `.governance-manifest.json` 维护；同步结果见当前任务及 [同步回执](DOC_GOVERNANCE_SYNC_RECEIPT_2026-09-06.json)。
- 产品运行目录：`/opt/unboundry/current`；文档镜像与产品 release 分开。该 release 内旧说明只代表构建时点，不作为当前治理入口。
- 本机外层 `/Users/mymy/Documents/unboundry` 是独立资料 Git；其中导航负责定位本机开发工作树，不适用于其他机器。其他历史副本不自动成为当前入口。
- 已验收产品 commit：`c9d414a32613a28b5e013ee671223fcc219c7e05`。治理提交可比产品提交更新；不能把最新文档 SHA 当成产品构建身份。

## 未决事项

| 项目 | 最后已知状态与证据 | 后续处理入口 |
| --- | --- | --- |
| 每日自动备份 | OPEN / USER_DEFERRED（2026-09-07）。旧作业仍硬编码 schema41，当前 schema43，报 Backup database validation failed；手动备份成功不表示每日作业成功 | 保留问题，待用户恢复该项；见发布回执及备份合同 |
| 历史图与首次画布性能 | LOCAL_TARGET_PASS / LOCAL_USER_PASS / NOT_DEPLOYED。本地180样本目标通过；2026-09-07用户确认其余验收通过，旧生产性能未重测 | [最终本地测量](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#72-性能结论与范围)；用户已确认本地使用，不宣称已对齐竞品 |
| 维护后更新通知 | LOCAL_TEST_REVIEW_PASS / LOCAL_USER_PASS / NOT_DEPLOYED。连接恢复、35秒模拟维护及草稿保护本地验证通过，2026-09-07用户确认；生产旧问题未因本地修复自动关闭 | [本地实现与证据](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#7-本地实施与交付2026-09-07) |
| 依赖告警 | LOCAL_TEST_REVIEW_PASS / NOT_DEPLOYED。本地锁文件qs6.16.0，离线依赖与相关边界/SDK测试通过；生产依赖未更新 | [修补与证据](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#71-逐项实现与有效验证)；原公告来源见方案B4历史基线 |
| 已暂停或未验收功能 | 维持各项原状态，含真实 Agent、团队、打光、Mureka 真实生成、Storyboard 完整生命周期等 | [验收账本](UNBOUNDRY_ACCEPTANCE_MATRIX.md) 中相关条目，不默认开启 |

这些是项目问题登记，不是正在同时施工的任务，也不授予产品修复或上线权限。

## 备份与回退约束

上次发布的手动冻结备份已完成本地 verify、独立恢复及云端 1004 文件的 GET 哈希核对；98 条历史媒体提示仍保留。确切包名和数量以发布回执为证据。

v0.7.14 只能使用已审核的 `v0.7.14-compat.1` 兼容包并保持 CURRENT 数据；**禁止直接切旧 v0.7.13**。v0.7.11 的 Git 检查点只保留代码，不证明旧包或旧数据库可安全恢复。任何实际回退前仍须读取 [发布手册](../RELEASE_RUNBOOK.md) 和 [备份合同](../ops/production/README.md)，重新确认兼容性与授权。

## 阅读范围

默认接手只读 [工作规则](../AGENTS.md)、本页、[当前任务](../TASKS.md)。按工作规则的主题表选合同章节，不默认读完整方案、历史账本或全仓审计。

需要查旧事实时才进入 [历史状态原文](UNBOUNDRY_CURRENT_STATE.history.md) 或 [2026-09-06 查阅报告](PROJECT_DOCUMENTATION_AUDIT_2026-09-06.md)。旧报告与清单保持当时快照，不是新的指令来源。
