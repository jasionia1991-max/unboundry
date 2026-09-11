# Unboundry 当前状态

文档角色：`CURRENT_STATE`。正式回执：[v0.7.20 发布回执](V0_7_20_PRODUCTION_RECEIPT_2026-09-12.json)；历史失败：[v0.7.19 失败回执](V0_7_19_FAILED_RELEASE_RECEIPT_2026-09-11.json)。

当前代码包版本：**v0.7.20**
本地候选代码版本：**v0.7.20**
正式身份：tag `v0.7.20`，commit `ccac7564e2ec045d62f8beb675cfeadb18e0f3e9`，schema44。

## 现在怎么样

**最近核验的生产是 v0.7.20 / schema44**，本轮没有数据库迁移。
生产观测日期：2026-09-12
授权、收尾及下一步见[当前任务](../TASKS.md)。

v0.7.20 是同 schema44 的性能修复补丁，不执行数据库迁移。正式回执记录的 CURRENT 指向 `/opt/unboundry/releases/v0.7.20-media-save-performance-20260911`，应用健康运行，公网维护解除；静态资源、数据库和云端对象结果均以回执为准。

原工作流 `ea47f2a5-bc7e-4a73-8e24-3336ea164528` 已完成技术恢复：前 9 个成功节点及 Canvas 投影保持；视频 task `fc2cb668-654d-4c1c-8052-5c450c0ea114` 沿原 attempt 1、provider attempt 1178、远端任务 `133398023` 找回结果，结果素材为 `4dbc0b7b-a8c0-4090-ab89-971a252585ad.mp4`；尾文字 task `50740684-43c2-45fa-a394-25f2e76d6768` 成功并已投影。本轮视频 Provider POST 为 0，新增尾文字 attempt 为 1 次（本轮授权已消费）。

## 数据与回退边界

旧未知任务及其事件、原 Provider 身份、前 9 个成功节点、画布位置与连线保持。另两个旧失败图片任务正常自动查询各新增9条状态事件，没有新增Provider请求或结果；精确附录复审通过，不表示历史图片已恢复。找回视频的新历史记录及当前项目更新时间按精确两行审核；其余41表差异保护不放宽。v0.7.19 的下载超时、停服失败、桥接回退及历史记录变化保留在失败回执中，不改写成无故障发布。schema44 不得降回 schema43，备份不得覆盖 CURRENT；回退仍使用重新绑定最新数据的 schema44 只读维护桥。

当前产品验收标记：`CURRENT_V0_7_20_USER_RECHECK`。技术发布通过不等于用户验收通过，用户主观状态仍为 `PRODUCTION_USER_RECHECK`，不得写成 `USER_PASS`。

每日自动备份、视频/音频空工具按钮继续 `USER_DEFERRED`；手动事故保全、fresh restore 或本次云端备份不代表每日定时任务已修复。GitHub [v0.7.20 Release](https://github.com/jasionia1991-max/unboundry/releases/tag/v0.7.20) 已发布。服务器治理文档与产品包分开；最终文档提交和文件校验以 `/opt/unboundry/governance/current/.governance-manifest.json` 为准，不能把产品 tag 当成治理文档最新提交。
