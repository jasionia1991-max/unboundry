# INC-IMGEDIT-003 新 Session 单 Goal 提示词

> 使用前必须把下面两处 `__USER_FILL__` 替换为用户亲自确认的具体内容。没有具体版本号和独立“允许发布”句子时，Goal 可以连续完成 D0～D12，但必须停在 D13 前，不得自行发布。

```text
/goal

继续 Unboundry 项目，执行 INC-IMGEDIT-003 图片工具栏剩余能力单 Goal。

项目真实 Git 仓库：
/Users/mymy/Documents/unboundry/app

这是一个长任务，必须严格由项目文档和实时 Git 驱动。聊天记录、内部记忆、自动摘要、旧 Goal 和历史授权都不是施工事实源。上下文压缩、换 Agent 或自动续跑后，必须重新读文档、核对 Git，并从 Checkpoint 的“唯一下一动作”继续，禁止凭记忆猜进度。

【本 Goal 的两个发布门】

版本号确认：__USER_FILL_EXACT_VERSION__
允许发布：__USER_FILL_EXACT_RELEASE_SENTENCE，例如“按 v0.7.0 上线吧”__

如果上述任一行没有被替换成明确内容：
- 允许连续完成 D0～D12、本地 checkpoint commit、候选冻结和文档收口；
- 不得自行选择版本号；
- 不得 push、PR、merge、tag、SSH 或发布；
- 必须在 D13 前停下，报告缺少哪一项发布门。

【开始前按顺序完整阅读】

1. /Users/mymy/Documents/unboundry/app/AGENTS.md
2. /Users/mymy/Documents/unboundry/app/上线规矩.md
3. /Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_CURRENT_STATE.md
4. /Users/mymy/Documents/unboundry/app/README.md
5. /Users/mymy/Documents/unboundry/app/TASKS.md 顶部当前区块
6. /Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_PLAN_2026-08-23.md
7. /Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_CHECKPOINT.md
8. /Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md 顶部及 IMGEDIT-001～020
9. /Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md
10. /Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_CHECKPOINT.md
11. /Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_002_CROP_LOADING_EXPERIENCE_PLAN_2026-08-23.md
12. /Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_GOAL_PROMPT_2026-08-23.md

如果 AGENTS.md 要求其他文件，继续按它的顺序完整阅读，不得用本清单缩减项目规则。

【第一步只做只读核对】

- pwd
- git branch --show-current
- git rev-parse HEAD
- git status --short
- git fetch origin main --prune
- git rev-parse origin/main
- git log -5 --oneline --decorate
- node --version
- npm --version
- 读取 package.json 版本
- 核对计划、Checkpoint、矩阵、TASKS 和 CURRENT_STATE 是否一致
- 如需陈述生产现状，再实时检查 /api/version、/api/health/live、/api/health/ready

立项参考基线是：
- main / origin/main：14777b5dc5cf48de8b21b6eb3ee27da45070b537
- package：0.6.33
- 生产：v0.6.33 / schema39
- 生产状态：PRODUCTION_PUBLISHED_USER_PASS / USER_PASS
- 当前无候选
- v0.6.33 版本号和历史授权已消费

这些只用于识别漂移，实际施工身份以新 Session 的实时 Git、当前状态文档和 Checkpoint 为准。不得为了匹配旧基线 reset、clean、checkout 覆盖用户数据。

【Goal总目标】

严格执行主方案 D0～D13，在同一个 Goal 中连续完成：
- 图片工具应用层最小解耦；
- 颜色标记；
- 调整像素；
- 快速分割；
- 标注和显式导出；
- 个人素材库；
- 多角度；
- 遮罩基础；
- 重绘；
- 扩图；
- 擦除；
- 保守增强；
- 创意增强；
- 主体抠图；
- Seedance 素材校验；
- 下载、全屏和既有裁剪回归；
- 受影响测试、独立审查、候选冻结、文档收口；
- 只有两个发布门有效时，继续 commit/push/PR/CI/merge/tag/SSH/生产发布。

打光继续保持 IMGEDIT-007 / PAUSED，不得偷渡解除暂停。

【严格文档驱动】

1. 同时最多一个 D 阶段为 IN_PROGRESS。
2. 开始阶段前，先把 Checkpoint 对应阶段改成 IN_PROGRESS，记录实时 branch/HEAD/工作树和唯一目标。
3. 每完成一个阶段，必须先更新：
   - INC-IMGEDIT-003 Checkpoint；
   - UNBOUNDRY_ACCEPTANCE_MATRIX 对应 IMGEDIT 条目；
   - TASKS.md 顶部当前区块；
   - CURRENT_STATE（仅版本、候选、GitHub或生产事实变化时）；
   - 主方案的实际偏差/证据（有偏差时）。
4. 文档更新完成后才能进入下一阶段。
5. Checkpoint 每次必须记录：时间、阶段、状态、branch/HEAD、工作树、产品/测试/文档文件、package/schema/version、外部请求数、付费预算、测试命令/环境/退出码、风险、阻断、回滚点和唯一下一动作。
6. 不允许代码已经进入下一阶段，而 Checkpoint 仍停在上一阶段。
7. 上下文压缩后立即停止继续编辑，重新执行阅读和只读核对；确认树未变化后复用有效测试，不为安心重复 full。
8. 文档、Git和代码不一致时，先恢复真实断点；不得用摘要覆盖真实文件。

【架构目标】

- 不建立一个新的大 ImageToolController；使用轻量 Dispatcher + 小 use case。
- 优先复用 CanvasGraphCommandPort、现有单节点 Generation task port、安全图片读取链、GenerationResultCommit 和 Provider registry。
- ImageNode.tsx 不新增 fetch、任务轮询、Provider分支和媒体上传编排。
- CanvasSurface.tsx 不增加按图片工具名称的分支。
- 本地工具不进入 Generation。
- Provider adapter 不导入 Canvas、TaskStore、Media具体实现、OSS或数据库。
- Media 不写 Generation 状态；Library 不直接操作 OSS。
- generationTasks.ts 不为每项操作堆独立大分支。
- 服务端是能力和操作启用状态的唯一权威来源。
- 默认零新增跨领域 SQL/架构例外；确需原子事务时只能增加精确、单向、带测试的公开边界。
- 本次真实功能触发模块化路线图第四批，但只施工图片工具需要的最小边界，不重做整个 Canvas。

【操作级启用】

服务端必须提供 available / unavailable / paused / disabled_by_operator / stale 的权威操作状态。生产必须能只关闭单项工具。除打光和不存在官方接口的 Seedance 远端校验外，目标操作未全部 available 时，不得把 Goal 标为完整成功或自动部分发布。

【数据与 migration】

- Canvas拥有节点和派生关系；Generation拥有task/attempt；Media拥有媒体与发布；Library拥有个人素材条目。
- 不保存 OSS 签名 URL；遮罩不得无界 Base64 入库/日志。
- 付费结果回填失败时保留 task/media 并提供重新挂接，不得盲删。
- schema变化只允许 expand-first：新增表/可空字段/安全默认值，不删除旧字段、不改变旧语义。
- 新schema必须允许旧release安全启动；应用回滚不要求立即数据库降级。
- migration前必须备份、临时恢复、演练，并验证旧版本读取新schema。

【授权范围】

本 Goal 明确允许：
- 修改代码、测试、脚本、配置、文档、package/lock和必要依赖；
- 创建 codex/ 专用分支或安全隔离 worktree；
- 在专用分支创建阶段性本地 checkpoint commits，便于长任务恢复；
- 修改schema并编写可回滚、向前兼容的migration；
- 使用当前已有Provider profile做受限真实技术冒烟；
- 使用隔离OSS前缀验证本Goal创建的测试对象；
- 两个发布门有效且D12通过后，commit、push、PR、CI修复、merge、tag、SSH和生产发布。

本 Goal 不允许：
- 输出或提交任何密钥；
- 注册外部账号或购买新套餐；
- 无上限真实生成、批量生成或视频生成；
- 修改用户历史生产项目或随意删除生产OSS对象；
- 无备份生产migration；
- 自动声明 USER_PASS；
- 用历史授权代替本 Goal 的明确边界。

【真实请求预算】

fake与零请求测试全部通过后才可真实调用。成功付费请求总上限8次：多角度1、重绘1、扩图1、擦除1、创意增强1、保守增强1（若付费）、主体抠图1（若付费）、必要兼容复核1。每次数量1、最小可验证分辨率、只用安全测试图片。失败后只有明确未计费且修复直接相关原因时最多补一次；无法判断是否计费时禁止重试。

真实调用只可记 REAL_PROVIDER_TECHNICAL_SMOKE_PASS，不得冒充生成质量PASS。最终生产最多记 PRODUCTION_PUBLISHED_AUTO_PASS / USER_QUALITY_RECHECK，只有我亲自线上确认后才可记 USER_PASS。

【永久红线】

- spec/public-templates-director-split-revision.json 是受保护未跟踪文件：不读取、不修改、不格式化、不暂存、不提交、不删除、不改名。
- 不执行 git reset --hard、git clean 或覆盖用户数据。
- 测试不得使用4173、本地app/data、/var/lib/unboundry、真实Provider、真实OSS或真实媒体。
- 自动测试只用新临时目录、动态loopback和fake服务。
- 不借用优创凭据给云腾，也不新增“天空”计费Provider。
- 自动测试、真实技术冒烟、生产技术通过和USER_PASS严格分开。

【测试纪律】

- 使用Node 22.23.1、npm 10.9.8。
- 使用 node scripts/run-safe-tests.mjs。
- 每阶段先跑最小受影响范围；不为安心重复成功测试。
- 测试失败先诊断和复验最小失败集合。
- 冻结候选后最多一次安全full，除非新的相关失败证明必须重跑。
- 修改测试/validator/script后按规则同步source coverage manifest。
- 记录真实命令、环境、范围、退出码和原始结果；不得把定向测试写成全量。

【不得中途停下的情况】

普通设计选择、代码复杂、测试失败、类型错误、局部架构调整、fake实现、UI修正、migration编写、CI普通失败、阶段完成和上下文压缩都由你自行处理并继续。流程固定为：调查 → 修复 → 最小复验 → 更新文档断点 → 继续。

【只有这些才是真阻断】

- 当前所有安全可用方案都缺真实执行能力；
- 缺少必须由我提供的账号、权限或凭证；
- 需要购买服务或新增外部账号；
- 付费状态无法判断；
- 第三方许可证不兼容；
- 生产资源无法承载真实引擎；
- migration不能保持旧版本兼容；
- 用户已有修改无法安全隔离；
- 受保护文件发生冲突；
- 备份/回滚不能证明安全；
- GitHub或生产基础设施出现无法自行修复的外部故障。

真实阻断时，先把BLOCKED原因、证据、已尝试方案和恢复条件写入Checkpoint，再报告。不要用禁用按钮或弱实现冒充完成。

【最终完成状态】

工程和发布理想终态：
LOCAL_ENGINEERING_COMPLETE
TARGETED_AUTO_PASS
SAFE_FULL_PASS
REAL_PROVIDER_TECHNICAL_SMOKE_PASS
PR_MERGED
PRODUCTION_PUBLISHED_AUTO_PASS
USER_QUALITY_RECHECK

USER_PASS 必须等待我线上确认。

现在启动 Goal 后先只读核对并用大白话报告真实基线、工作树、版本/发布门是否有效、是否存在阻断；随后立即把D0写入Checkpoint并连续施工，不自动启动任何历史任务。
```
