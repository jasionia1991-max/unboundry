# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见 [当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：生成状态查询加固 v0.7.16 发布收尾

任务ID：`GENERATION-STATUS-QUERY-LOCAL-001`。状态：`DEPLOYED / TEST_REVIEW_PASS / LOCAL_USER_PASS / PRODUCTION_TECHNICAL_PASS / PRODUCTION_USER_RECHECK`。发布身份、CI、测试、备份、回退、生产验证和限制统一由 [v0.7.16发布回执](spec/V0_7_16_PRODUCTION_RECEIPT_2026-09-07.json) 维护。

用户授权：2026-09-07明确“允许自行递增一个小版本，完成发布检查、备份和回退演练，通过后上线。”本次版本/GitHub/构建、隔离演练、生产备份和切换已执行。该授权仅覆盖此次发布及其收尾和已核验旧包的失败处置，不扩展为下一版本、真实/付费生成、schema迁移、历史数据或备份删除、云权限变更。每日自动备份及视频/音频空按钮继续暂停。

## 受影响合同

选中 [第2版查询加固方案](spec/GENERATION_STATUS_QUERY_HARDENING_PLAN_2026-09-07.md)第3、5、7节；生成任务、结果发布/投影由 [生成架构](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)约束，提示交互由 [UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9、第9节约束；发布/备份按 [发布手册](RELEASE_RUNBOOK.md)执行。

## 必须保留的行为

保留取消、观察身份隔离、单节点/工作流互斥、未知付费结果保护、手动检查、结果自动回填、DATA-005和已验收模板/UI行为。只在WithPause原任务GET遇网络错误、超时或5xx时最多额外重查两次，直接wait默认不变。没有新增生成POST、Canvas admission或持久字段。两个永久保护JSON始终按路径排除。

验证方法：仅按受影响范围经safe runner验证，使用系统临时数据、动态loopback；发布按精确包隔离演练与真实冻结备份门分别验证，保留失败记录及独立审查。

## 已完成

- 工程检查：本地实现、139项受影响回归、类型/架构/构建/文档检查，以及RB01～RB04撤销演练、独立复审通过。产品两模块在用户验收后保持原SHA，未重复跑无关full。
- 用户验收：三项查询恢复验收通过。后续保存报错已真实复现为helper未登记临时媒体，已用合法本地上传/登记替代模拟路由；缩放/平移/刷新及保存通过，未放宽产品校验。此前失败日志保留。
- 发布时补齐版本准入和m81负例，定向m38=19、m81=42通过。helper旧基线与候选HEAD分开校验；最终提交后的真实启动和清理通过。
- PR #171最终head及合并main CI通过，annotated tag和GitHub Release已建立；精确包937份源码独立构建，未复用旧dist或触碰保护文件。
- RB05精确v0.7.16→v0.7.15→v0.7.16隔离Linux演练通过。同一合成SQLite、草稿、素材和原任务记录保留，三个新浏览器上下文实际加载对应bundle并核对SHA。三次授权布局command与零额外写入分开计数；合成任务由停服后的明确fixture步骤结算，不冒充真实Provider恢复。第一轮布局no-op测试步骤及汇总脚本路径问题均已修正，失败证据保留。
- 独立复核：正向发布和回退脚本独立复核通过，服务器只读回退身份/保留证据预检通过；正式冻结备份、verify/fresh restore、原子切换和33项静态资源检查通过，原安全设置恢复。仅执行真实正向切换，未执行真实线上回退。
- 正式Chrome原画布刷新后内容/位置/revision保持，显示已保存，图片视频正常，额外写入及生成请求0。生产用户体验仍待用户确认。

## 证据与收尾路线

代码工作树：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`。产品tag身份与文档提交分开；收尾分支为`codex/v0716-release-closeout`，不强制后续任务切回此历史分支。

本地实现的原始证据根由外层`generation-status-query-local-20260907/evidence-location.json`定位；本次发布证据根为外层`status-query-v0716-release-ops-20260907`，内含先前完整任务快照、各轮失败/通过记录及独立审查。服务器证据根为`/var/lib/unboundry-v0716-status-query-20260907/evidence`。回退所需五份RB05原始JSON已额外保留，不依赖临时目录长期存在。

此次收尾文档先按实际代码、运行和用户验收对齐，再按发布手册独立同步。文档main提交、逐文件哈希和同步检查由服务器治理manifest及发布回执所指的governance-sync/CI记录拥有，不能把治理HEAD写成产品commit。文档同步不重新构建或重启产品。

## 下一步

打开正式站已有画布，刷新后确认内容和位置还在、图片视频正常且没有保存报错，然后反馈“通过”或具体问题。无需再操作本地故障注入按钮，也无需为了此次验收付费生成。
