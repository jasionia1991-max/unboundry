# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见 [当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：文档事实对齐与生成状态查询加固方案

任务ID：`GENERATION-STATUS-QUERY-PLAN-001`。状态：`PLAN_REVIEW_PASS / NOT_IMPLEMENTED`。

用户授权：2026-09-07用户回复“可以 同意你的建议”，同意先更正架构说明中的旧状态，再将外部生成任务材料中有价值的检查点整理成本项目方案；并已明确要求“文档得先对齐项目现状再同步，项目现状不能靠猜”。按本次文档范围完成事实核对、独立复核、文档PR/CI及私有治理镜像同步，不扩大为产品实施、付费生成或新一轮产品上线授权。

身份：代码根`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`，查证起点分支`codex/v0715-user-acceptance`、HEAD `8bae2c50f01ef6c4800dbafc7269e2ee85b7d308`、工作区干净；本次文档分支`codex/generation-status-query-plan`。origin为`https://github.com/jasionia1991-max/unboundry.git`。不为匹配旧记录强行切分支或撤销合法改动。

## 受影响合同

- [生成架构合同](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)第1、4、5节：将旧现状陈述改为引用当前事实来源，历史扫描计数保留日期和范围。
- [发布手册](RELEASE_RUNBOOK.md)“独立文档同步”：明确先核实事实、更新对应文档、复核，再同步；哈希一致不代表内容准确。
- [UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9与现行生成架构第2、3节：作为查询加固设计必须保留的约束。[本次方案](spec/GENERATION_STATUS_QUERY_HARDENING_PLAN_2026-09-07.md)为选中的审查对象，尚未实施；本次不改变生效的产品行为。

## 必须保留的行为

原任务与结果继续自动找回、自动回填；未知生成结果不得重新提交付费请求；查询故障不等于任务失败；任务完成、素材发布与画布显示分别判断。保留DATA-005、现有权限、取消/切换身份隔离以及所有暂停项；不恢复金额、额度、订阅功能。两份永久保护JSON先按路径排除，禁止访问。

验证方法：按当前源码和既有发布证据核对文档陈述；检查修改范围、文档链接/锚点、入口角色/长度和状态；独立复核方案的证据、恢复边界及验收用例。业务代码未变则复用原验证，不重跑无关本地业务测试；最终PR/main执行现有CI。从精确合并提交导出、校验私有镜像，核对产品current、版本、PID/restarts前后不变。产品实现与模拟故障验收保持NOT_RUN，不能用文档审查或同步代替。

## 当前结果

文档修正：架构说明中的旧版性能/维护/依赖待办已改为引用当前状态，历史扫描保留日期与范围；同步手册已补事实核对前置要求。方案仅设计原任务有限自动重查，没有把静态发现记成付费任务丢失或已复现线上故障。

工程检查：本地相对链接/锚点、入口角色/长度/版本、历史payload与变更范围检查PASS；git diff --check PASS。产品代码、依赖、版本与schema未修改。本次未运行本地产品测试；PR/main CI的实际运行身份与结论由下述governance-ci.json记录，不将配置存在写成运行通过。

独立复核：文档事实与权限边界PASS；生成查询技术方案最终复核PASS。补齐四类节点兼容路径、严格错误分类、取消/身份/Canvas admission边界与m41/m40/m27回归要求后，无阻断项。具体首批设计与Q01～Q11验收要求由本次方案维护。

用户验收：本次只有整理方案的授权，尚无新功能验收。上一轮修复的正式站验收已完成，记录保留于 [发布回执](spec/V0_7_15_PRODUCTION_RECEIPT_2026-09-07.json)；每日自动备份、视频/音频空工具按钮和其他暂停项维持原状态。

同步结果的唯一身份来源为服务器`/opt/unboundry/governance/current/.governance-manifest.json`。本次CI/同步证据存于`/var/lib/unboundry-v0715-bug-ui-20260907/evidence/generation-status-query-plan-20260907/governance-ci.json`、`governance-sync.json`；本地副本在外层`generation-status-query-plan-20260907/`。只有其中成功记录与当前镜像提交一致时，才可确认本轮同步；旧镜像结果不能代替。保留前一治理镜像，产品包不替换、不重启。

## 下一步

方案已完成并通过审查，产品实现尚未开始。按精确提交完成上述文档同步与核验后交付；下一项由用户决定是否按已审方案本地实施，暂缓项不自动恢复。
