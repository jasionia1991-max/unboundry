# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见 [当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：发布已验收修复 v0.7.15

任务 ID：`BUG-UI-REMAINDER-RELEASE-001`。状态：`RELEASE_PREPARING / LOCAL_USER_PASS / NOT_DEPLOYED`。

用户授权：2026-09-07用户在本地全部验收后明确“允许上线，各种流程都允许”。据此委托完成本次发布必要的版本选择、提交/推送、PR/合并、CI、tag/Release、生产备份与恢复验证、加密备份上传与GET核验、维护/切换/必要回退、生产检查和文档同步；核对未占用的下一个patch为v0.7.15。仅发布本轮已验收修复，仍不恢复每日自动备份、视频/音频空按钮或其他暂停功能；不做真实付费生成、schema迁移、云权限变更或历史数据/备份删除。

身份：根 `/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`，分支 `codex/video-node-preview-containment`，准备起点HEAD及远端main `41757e95ea1dbfc92d917abc68d4104140e115a2`，origin `https://github.com/jasionia1991-max/unboundry.git`。既有dirty均属本轮已验收修复及其文档/测试，显式清单提交；两份永久保护JSON全程排除。候选v0.7.15/schema43；生产只读核对仍为v0.7.14/schema43，current为`/opt/unboundry/releases/v0.7.14-media-aspect-20260906`。

## 受影响合同

- [上线规则](上线规矩.md)、[发布手册](RELEASE_RUNBOOK.md) 1～8节、[备份合同](ops/production/README.md)：不可变tag、CI、冻结备份/verify/fresh restore、保留CURRENT的配对演练与切换、数据静态资源核对和治理镜像同步。
- [UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)6.3～6.6及[验收账本](spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md)受本轮修复影响条目；本地已验收范围见[修复方案7～9节](spec/REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md)。

## 必须保留的行为

保持已验收产品增量：模板保存隔离、列表筛选分页、来源菜单与保存、图片菜单层级、分组/多选及媒体几何、更新通知草稿保护、历史预览和性能修复。发布准备只新增精确版本准入；不借发布改产品。保持schema43、CURRENT数据与媒体、默认五项权限及自动回填。备份失败不切换，回退保持新数据，禁止回旧v0.7.13。永久保护两JSON不访问。

验证方法：保存已验收产品哈希；版本准入修改运行安全runner定向m81，文档门禁m38；复用未变业务测试与用户验收证据。PR及main必须CI通过；从精确tag导出新包，Linux隔离forward→rollback→forward与DELETE保存检查；真实冻结备份verify/fresh restore，切换前后数据/媒体保持，公开及loopback全静态资源逐项核验。真实Provider请求为0；工程与用户验收分开。

## 当前结果与断点

当前：已核对源码/远端main/生产身份，版本v0.7.15未占用。已保存已验收产品哈希并新增版本准入，发布定向m81+m38共61项通过，已验收产品13文件哈希保持；独立审查范围/兼容性与发布脚本准备并行，尚未提交、推送、切换。

工程检查：本地修复证据见方案7～9节，最近图片菜单4spec/42项有效PASS及Chrome工程复验完成，之前214/75项保留历史；不声称全量1271通过。本次发布m81 42+m38 19共61项PASS，failed/skipped/retries/blocked/reportErrors均0，源快照b4b1367ec6a005f70413411e1942556786a664e3497cb2b7207f9f195e9bde18保持，临时清理及4173不变通过；日志为外层release-gates.log。CI/备份/配对/切换门继续执行。

独立复核：先前修复与最终菜单均已复审通过；本次发布范围/回退兼容性及操作脚本独立复审进行中。

用户验收：2026-09-07明确“通过了 收尾吧”，本轮全部本地修复LOCAL_USER_PASS。发布后技术核对与用户生产复验单独记录；暂缓项仍USER_DEFERRED。

## 下一步

你现在不用操作。继续完成本次发布全部流程；遇真实备份/兼容性/CI失败先修复或保留现场，不绕过门禁。当前证据目录为外层 `bug-ui-v0715-release-ops-20260907`。
