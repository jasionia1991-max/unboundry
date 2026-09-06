# Unboundry 当前状态

文档角色：`CURRENT_STATE`。本页只维护项目现状；当前授权、工作进度和验收见 [当前任务](../TASKS.md)。本地身份于 2026-09-06 核对；下面生产和远端信息是同日上一轮已有证据的快照，本次文档治理没有重新访问生产或 GitHub。

## 项目现在怎么样

**最近核验的生产是 v0.7.14 / schema43。** 媒体比例、视频完整预览、选中模板置前已在上一轮获用户验收。日常自动备份、部分性能和更新通知仍有未决问题，见下表；不能把该版本通过理解成全部功能通过。

当前代码包版本：**v0.7.14**
本地候选代码版本：**v0.7.14**
本地候选 schema：**43**
生产观测日期：2026-09-06。
当前产品验收标记：`CURRENT_V0_7_14_USER_PASS`
产品验收证据：[v0.7.14 发布回执](V0_7_14_PRODUCTION_RECEIPT_2026-09-06.json)、[媒体比例验收记录](MEDIA_ASPECT_RATIO_LOCAL_CHECKPOINT_2026-09-06.md)。具体行为规则由 [UI 合同 6.3](UNBOUNDRY_UI_DESIGN_SYSTEM.md) 维护。本页只记录产品验收；文档治理的验收结果由 [当前任务](../TASKS.md) 维护。

## 实际代码目录

- 代码 Git 根目录：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`。
- 核对时分支：`codex/video-node-preview-containment`；本轮起始 HEAD：`038ee8444e1b0901b28b5a2a65c08eca5c9400b9`。每次接手重新查 Git，不根据这里强行切分支。
- 工作区已有上一轮未提交文档更新；本项文档治理改动也位于此工作树。具体进度只看当前任务，不能将 HEAD 当作全部未提交内容。
- `/Users/mymy/Documents/unboundry` 是有独立 Git 的资料外层；其中 app 和其他历史副本不是上述代码入口。
- 最近核验产品 commit、远端 main 和 v0.7.14 tag：`c9d414a32613a28b5e013ee671223fcc219c7e05`。生产 release 目录、备份清单和运行时观察详见发布回执；实际操作前重新核对。

## 未决事项

| 项目 | 最后已知状态与证据 | 后续处理入口 |
| --- | --- | --- |
| 每日自动备份 | OPEN。旧作业仍硬编码 schema41，当前 schema43，报 Backup database validation failed；手动备份成功不表示每日作业成功 | 单独任务处理完整备份、校验、恢复和上传链路；见发布回执及备份合同 |
| 历史图与首次画布性能 | PARTIAL。旧 v0.7.13 测量：27 小图冷加载 11.682 秒、首次新建 1.214 秒；本次未重测 | [性能断点](PERFORMANCE_REMEDIATION_CHECKPOINT_2026-09-06.md)，按任务重新测量，不能声称已对齐竞品 |
| 维护后更新通知 | OPEN。v0.7.14 发布时旧 EventSource 遇 502 未恢复；手动刷新和数据保留已通过 | 单独处理重连与断线测试；见发布回执 |
| 依赖告警 | OPEN。上轮记录 qs6.15.3 两条 medium 告警，修复建议 6.16.0；本次未联网复核 | 单独核对现状，再评估 ali-oss/urllib 链路升级 |
| 已暂停或未验收功能 | 维持各项原状态，含真实 Agent、团队、打光、Mureka 真实生成、Storyboard 完整生命周期等 | [验收账本](UNBOUNDRY_ACCEPTANCE_MATRIX.md) 中相关条目，不默认开启 |

这些是项目问题登记，不是正在同时施工的任务，也不授予产品修复或上线权限。

## 备份与回退约束

上次发布的手动冻结备份已完成本地 verify、独立恢复及云端 1004 文件的 GET 哈希核对；98 条历史媒体提示仍保留。确切包名和数量以发布回执为证据。

v0.7.14 只能使用已审核的 `v0.7.14-compat.1` 兼容包并保持 CURRENT 数据；**禁止直接切旧 v0.7.13**。v0.7.11 的 Git 检查点只保留代码，不证明旧包或旧数据库可安全恢复。任何实际回退前仍须读取 [发布手册](../RELEASE_RUNBOOK.md) 和 [备份合同](../ops/production/README.md)，重新确认兼容性与授权。

## 阅读范围

默认接手只读 [工作规则](../AGENTS.md)、本页、[当前任务](../TASKS.md)。按工作规则的主题表选合同章节，不默认读完整方案、历史账本或全仓审计。

需要查旧事实时才进入 [历史状态原文](UNBOUNDRY_CURRENT_STATE.history.md) 或 [2026-09-06 查阅报告](PROJECT_DOCUMENTATION_AUDIT_2026-09-06.md)。旧报告与清单保持当时快照，不是新的指令来源。
