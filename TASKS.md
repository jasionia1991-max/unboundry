# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见 [当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：发布已验收修复 v0.7.15

任务ID：`BUG-UI-REMAINDER-RELEASE-001`。状态：`DEPLOYED / RELEASE_TECHNICAL_PASS / LOCAL_USER_PASS / PRODUCTION_USER_RECHECK`。

用户授权：2026-09-07用户在本地全部验收后明确“允许上线，各种流程都允许”。据此授权本次必要的版本选择、提交/推送、PR/合并、CI、tag/Release、生产备份/恢复验证、加密备份上传GET核验、维护/切换/必要回退、生产检查和文档同步；核对未占用的下一patch为v0.7.15。仅发布本轮已验收修复，不恢复每日自动备份、视频/音频空按钮或其他暂停功能；不做真实付费生成、schema迁移、云权限变更或历史数据/备份删除。本次授权不提供下一次发布权限。

身份：实际根`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`，当前分支`codex/bug-ui-v0715-release-closeout`，origin为`https://github.com/jasionia1991-max/unboundry.git`。起点HEAD/main为41757e95ea1dbfc92d917abc68d4104140e115a2；产品merge为8ac75ca79d525d34e8a9b1b8b5fb820c020cd402。原有dirty按显式清单提交；两份永久保护JSON始终先排除再访问其他文件。

## 受影响合同

- [上线规则](上线规矩.md)、[发布手册](RELEASE_RUNBOOK.md)、[备份合同](ops/production/README.md)：不可变tag、CI、冻结备份/verify/fresh restore、保留CURRENT的配对/切换、数据与静态资源核对、治理镜像同步。
- [UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)6.3～6.6及[验收账本](spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md)本轮条目；修复证据见[方案7～9节](spec/REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md)。

## 必须保留的行为

保持模板保存隔离、筛选分页、来源菜单及保存、图片菜单层级、分组/多选及媒体几何、更新通知草稿保护、历史预览和性能增量。候选冻结后仅新增精确版本准入，不借发布改功能。保持schema43、CURRENT数据与媒体、默认五项权限及自动回填。备份失败不切换，回退保持新数据，禁止旧v0.7.13。

验证方法：已验收产品13文件哈希保持；safe runner定向m81/m38，复用未变业务及用户证据；PR/main CI；精确tag独立构建；隔离Linux新→旧→新与两包DELETE保存；真实冻结backup/verify/fresh restore、切换前后表与媒体清单；公网/loopback全静态资源；原生Chrome菜单/刷新/重新打开与无额外保存。真实Provider请求为0；工程、发布、用户验收分开记录。

## 当前结果与断点

产品已发布：PR #166合并、v0.7.15 annotated tag和Release已创建，生产current为`/opt/unboundry/releases/v0.7.15-bug-ui-20260907`，active/running、PID1088583、NRestarts0、schema43；冻结已解除。最新加密备份verify/fresh restore通过，数据库及媒体保持；云端加密备份上传及逐文件GET核验通过。完整身份、计数及证据由 [发布回执](spec/V0_7_15_PRODUCTION_RECEIPT_2026-09-07.json) 维护；外层操作目录为`bug-ui-v0715-release-ops-20260907`，服务器证据目录为`/var/lib/unboundry-v0715-bug-ui-20260907/evidence`。

工程检查：版本准入m81 42+m38 19共61项有效PASS，无失败/跳过/重试/阻断/报告错误。已验收产品13文件未漂移，934源码文件精确tag导出/新建构建通过。最终菜单4spec/42及此前214/75项修复证据按方案保留，不声称全量1271通过。产品PR CI34080454345成功；main CI34080686396首次在用例前隔离清理kill EPERM，日志保留，同一提交第2次成功。Linux隔离配对、两包DELETE、33个静态资源及生产菜单检查通过。Chrome九项图片菜单无遮挡，快速切分打开/取消、模板筛选样式正常；原画布行、revision、生成task/attempt及命令计数不变，无浏览器error。

独立复核：本地修复及最后菜单已独立复审；发布范围/持久字段兼容性、prepare/build、配对/切换/rollback均独立审查通过。治理导出/安装脚本已独立核对精确提交、保护路径、tar清单/哈希及原子切换，无阻断点。备用回退脚本未在真实线上执行，只有隔离演练PASS。

用户验收：2026-09-07“其他的都通过”及“通过了 收尾吧”确认本轮全部本地修复LOCAL_USER_PASS。允许上线不等于生产用户验收；当前PRODUCTION_USER_RECHECK。每日备份及视频/音频空按钮继续USER_DEFERRED。

## 下一步

用户下一步：刷新正式站，在常用画布确认模板、拖线菜单/页面稳定性和图片「浏览全部」，统一回复结果。

本次收尾文档须在最终PR head及main CI通过后同步私有治理镜像；最终文档身份由服务器`.governance-manifest.json`维护，对应CI/同步结果由发布证据目录的`governance-ci.json`、`governance-sync.json`维护。产品commit仍为8ac75ca79d525d34e8a9b1b8b5fb820c020cd402；文档同步保持产品构建和进程。
