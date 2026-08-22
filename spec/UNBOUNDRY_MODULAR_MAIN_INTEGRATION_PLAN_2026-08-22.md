# Unboundry 模块化成果主线集成方案

状态：`D0_LOCAL_COMMIT_PASS / D1-D5_AUTO_PASS / D6_LOCAL_AGENT_PAGE_PASS / D7_USER_PASS / D8_AUTO_PASS / LOCAL_MAIN_MERGED / PUSH_NOT_AUTHORIZED / PRODUCTION_FORBIDDEN`

更新日期：2026-08-23

## 1. 大白话目标

当前模块化成果已经像一套组装完成的盔甲，但外面还带着只适用于离线施工舱的固定路径、固定分支和启动闸门。

本方案不是重新拆开 45 个提交再组装，也不是继续扩大重构。正确做法是：

1. 完整保留当前离线分支作为施工档案和回滚源；
2. 从届时重新确认的最新远端 `main` 建立独立本地集成工作树；
3. 一次性导入最终产品代码状态，但不导入离线施工舱外壳；
4. 将混合脚本改写成普通 checkout、构建和测试都可运行的 main-safe 形态；
5. 先定向验证，再对冻结候选执行最多一次 safe full；
6. Agent 先完成实页检查，再交给用户验收四个可见行为；
7. 即使全部通过，也必须等待用户单独授权，才能本地合入 `main`。

最终用户看到的产品功能和界面应基本不变；变化主要发生在内部模块边界、维修范围和回滚能力。

## 2. 当前冻结输入

- 离线成果工作树：`/Users/mymy/Documents/unboundry-modular-offline-2026-08-22`
- 离线成果分支：`codex/modular-monolith-offline-refactor-2026-08-22`
- 离线成果 HEAD：`1030790983ff3282330f6efea0613447dc2900c4`
- 冻结 base / 2026-08-22 只读核对的远端 `main`：`dcffba32d57af9accaa25bf01feb40f1e7828092`
- 相对远端 `main`：45 个线性提交，103 个文件，约 `+13,986/-5,800`
- 只读 `merge-tree` 结果：当前没有文本冲突
- package 版本：`0.6.30`
- 数据库：仍为 `schema39`；候选没有 schema、migration 或生产数据变更
- 本地原 `main` 引用落后远端，不得作为集成起点

以上 hash 只描述本方案落地时的输入。正式施工前必须重新只读核对远端 `main`；若远端 hash 已变化，停止导入并重新做差异与冲突审计。

## 3. 本方案必须完成的结果

1. 得到一条独立、可丢弃的本地集成分支，整个过程不修改 `main`。
2. 最终集成源码保留当前模块化产品行为和 `bebe08b` 的适应视图、Finder 图片拖入修复。
3. 普通 checkout 可以执行 `dev/build/preview`，不依赖本机固定绝对路径或离线专用分支名。
4. 通用架构检查、安全测试和 source coverage 能在正常项目环境运行。
5. 离线身份文件、临时数据、秘密、受保护文件和施工专用页面闸门不进入最终集成候选。
6. 自动证据、Agent 实页证据和用户验收状态严格分开记录。
7. 最终候选可以作为一个清晰、容易回退的集成单元等待用户决定是否本地合入 `main`。

## 4. 明确不做

- 不把项目拆成微服务；
- 不继续拆细 `CanvasSurface` 或 `CanvasShell`；
- 不要求把 76 条受控架构例外一次清零，只要求不新增并重新核对；
- 不新增功能、节点、模型、模板或 Provider；
- 不改变 UI 视觉和既有产品语义；
- 不修改 schema、数据库迁移或生产数据；
- 不修改版本号；
- 不运行真实或付费 Provider；
- 不访问真实 OSS、SSH 或生产；
- 不 push、PR、tag、发布或部署；
- 不在 `/Users/mymy/Documents/unboundry/app` 施工；
- 不读取、复制或触碰原工作树受保护的未跟踪 JSON。

## 5. 文档驱动规则

后续施工必须由以下三份文档共同驱动：

1. 本方案：冻结目标、边界、顺序和停止条件；未经用户确认不得改变方向。
2. `spec/UNBOUNDRY_MODULAR_MAIN_INTEGRATION_ACCEPTANCE_MATRIX_2026-08-22.md`：逐项定义什么证据才算通过。
3. `spec/UNBOUNDRY_MODULAR_MAIN_INTEGRATION_CHECKPOINT.md`：唯一可持续更新的当前状态、Git 身份、执行记录和下一步。

每个阶段开始前必须在 Checkpoint 写明：允许修改范围、禁止范围、预计验证和停止条件。每个阶段结束后必须同步：实际文件、命令、环境、exit、结果、残余风险和下一状态。

聊天记录、记忆和摘要不能替代上述文档与实时 Git 状态。

## 6. 执行阶段

### D0：方案与治理文档

本阶段已在冻结离线分支只提交六份治理文档，提交为 `92a57e49ec89aa1e7550e8109fe1b870069792c8`，message 为 `docs(modular): define main integration workflow`；没有代码、测试、构建或外部系统动作。

完成门：三份文档互相引用；当前授权和禁止动作明确；状态只能是 `PLAN_DOCUMENTED / EXECUTION_NOT_STARTED`。

### D1：重新核对输入并建立独立集成工作树

用户已通过 2026-08-22 Goal 明确授权 D1～D6 本地施工、分阶段本地提交和隔离验证；本授权不包含 main 写入、push、PR、tag、升版、发布或生产动作。

必须先重新核对：

- 当前离线候选仍指向冻结 HEAD，且工作区没有未解释改动；
- 远端 `main` 实际 SHA；
- 候选与最新远端 `main` 的 merge-base、提交计数、文件差异和 `merge-tree`；
- 原工作树及受保护文件未被触碰；
- 没有 schema、数据、秘密、Provider/OSS 或生产内容混入。

随后从最新远端 `main` 建立新的本地 worktree 和 `codex/` 前缀集成分支。不得切换或修改原工作树的 `main`。

停止条件：远端 `main` 变化后出现新冲突、候选变脏、身份不明、发现秘密/真实数据、必须访问外部系统，或新 worktree 会覆盖现有路径。

### D2：一次性导入最终产品状态并清除施工舱外壳

不逐个重放 45 个提交，不重新制造六个半成品阶段。原分支完整保留全部历史；集成分支只导入最终成品状态。

导入按内容分三类：

#### A. 直接导入

- Canvas、Generation、Media、Provider、owner transaction、registry、composition root 等最终产品代码；
- 对应测试和通用架构合同；
- `bebe08b` 的适应视图和 Finder 图片拖入修复。

#### B. 必须人工改写后导入

- `scripts/check-architecture.mjs`：保留通用架构检查，移除离线身份硬调用；
- `scripts/run-safe-tests.mjs`：保留临时数据、动态 loopback、外网和 Provider/OSS 禁止合同，移除固定工作树/分支依赖；
- source coverage manifest：按最终 main-safe 文件和行为重新生成或精确更新；
- `package.json`：不得保留依赖固定离线身份脚本的 `predev/prebuild/prepreview`；
- 项目说明、TASKS 和状态文档：改写为集成候选事实，不继承离线 `USER_PASS`。

#### C. 不进入集成候选

- `UNBOUNDRY_MODULAR_WORKTREE.md`；
- `spec/UNBOUNDRY_MODULAR_WORKTREE_IDENTITY.json`；
- `spec/UNBOUNDRY_MODULAR_OFFLINE_ISOLATION_CONTRACT.md`；
- 离线施工 plan、matrix、checkpoint、receipt；
- `scripts/check-modular-worktree-identity.mjs`；
- `AGENTS.md` 顶部的固定 worktree/branch 闸门；
- 离线页面专用启动限制、固定临时端口/路径和任何施工现场数据；
- `.env`、密钥、Cookie、数据库、真实媒体、备份和受保护 JSON。

最终集成分支不得出现一个已提交的“产品代码正确但 main 会被离线闸门阻断”的中间状态。

### D3：最小静态和启动门

在执行产品回归前依次证明：

1. TypeScript 通过；
2. 通用 architecture checker 通过；
3. source coverage 通过；
4. production build 通过；
5. 普通 checkout 的 dev/build/preview 不读取固定离线路径；
6. 架构 baseline 已按最终树重新核对，没有新增例外；
7. 数据与网络安全 preflight 仍然 fail-closed。

任一失败只诊断和复验最小受影响范围，不运行 full。

### D4：风险驱动的产品回归

只验证清场和最终组合实际影响的领域：

- Canvas graph、保存、冲突、刷新恢复、适应视图、Finder 拖放、删除和撤销；
- 四模态 Generation 的 Generate/Retry/Cancel/Reconcile/Recovery；
- Provider reference、Blob Store、Publication 和删除补偿；
- Generation runtime readiness、worker、恢复与 composition 初始化顺序；
- 账号删除、项目/媒体/模板等 owner transaction 的同事务回滚；
- registry 三层一致性与 fake replacement drill。

成功证据不因无关文档变化重复。失败先保留原貌，再只复验失败 spec 或最小受影响集合。

### D5：冻结集成候选并执行唯一 safe full

只有 D3、D4 全绿且工作树冻结后，才允许执行本集成候选唯一一次 safe full。

必须记录命令、Node/npm、HEAD/tree、source snapshot、spec/test 数量、exit、失败/跳过/重试、4173、临时目录、外网、Provider、OSS 和工作树变化。

如果 full 失败：保留首次结果，修复后只复验失败项；除非新的源码变化或强制发布门提供具体理由，不运行第二次 full，也不得把定向复验写成全量通过。

### D6：Agent 真实页面验收

使用系统临时数据和动态 loopback 端口，且端口不得为 4173。Agent 必须真实打开页面并检查：

1. 页面启动且没有 `Failed to fetch`；
2. Canvas 保存、刷新恢复；
3. Finder 图片拖入不会触发浏览器导航；
4. 适应视图不破坏节点、边和组；
5. 删除、撤销正常；
6. console 和网络记录中没有未解释错误、非 loopback、Provider 或 OSS 请求。

通过后只能标 `LOCAL_AGENT_PAGE_PASS / USER_RECHECK`。

### D7：用户验收

用户只需要验收四项：

1. 页面能打开且无 `Failed to fetch`；
2. Finder 图片能拖入画布且页面不跳转；
3. 适应视图正常；
4. 删除、撤销、保存后刷新恢复正常。

只有用户明确回复通过，才能标 `USER_PASS`。旧离线候选的 `USER_PASS` 继续作为历史证据，但不自动升级为新集成候选的用户通过。

### D8：文档收口与等待 main 授权

同步最终差异、架构 baseline、测试证据、页面证据、用户状态、残余边界和 Git 状态。集成候选内部建议只保留两个容易审计的本地提交：

1. main-safe 模块化产品代码与测试；
2. 集成证据和权威文档。

原离线分支继续保留 45 个施工提交，不重写历史。

即使 D0～D8 全部通过，也只能进入 `READY_FOR_LOCAL_MAIN_DECISION`。必须等待用户明确说“允许本地合入 main，不 push”，才能执行 main 写操作。

## 7. 测试和成本预算

- 文档阶段不运行测试；
- 每次代码变化先跑最小静态门和 1～3 个直接 spec；
- 只有共享合同、事务、恢复、Provider/Media 或 composition 风险提供证据时才扩大；
- 冻结候选最多一次 safe full；
- 不为安心重复已经成功且源码未变化的测试；
- 多 Agent 不得重复同一调查、build 或测试；
- 最终独立审查在候选冻结后执行，不与实现并行。

## 8. 回滚和失败关闭

- 原离线分支始终保留，不在其上重写或清场；
- 每个集成提交必须只存在于独立集成分支；
- 某阶段失败时优先修复最小范围；若候选身份或安全性无法证明，放弃该集成 worktree，重新从冻结输入建立，不动 `main`；
- 禁止使用 `git reset --hard`、`git clean` 或覆盖用户改动；
- 在用户授权本地合入 main 前，线上项目始终不变；
- 将来即使本地合入 main，也不包含 push、PR、tag、升版或发布授权；
- 真正发布必须另外确认版本号和“允许发布”，并按发布规矩执行冻结备份、独立 release 和回滚验证。

## 9. 停止并报告的条件

遇到以下任一项必须停止，不得猜测：

- 最新远端 `main` 不再是已审计基线且产生冲突或语义覆盖；
- 候选或目标 worktree 出现来源不明的脏改动；
- 导入需要读取原工作树受保护文件；
- 发现 schema、migration、真实数据、秘密或生产配置；
- 需要真实 Provider、OSS、SSH、生产或非 loopback 网络；
- 无法证明 transaction、任务幂等、结果归属或恢复合同保持；
- 必须扩大为新功能、视觉改版或新的模块化重构；
- 测试隔离、4173 保护或回滚能力失效；
- 需要 commit、main 写入、push、PR、tag、升版或发布但没有对应明确授权。

普通类型错误、构建错误或定向测试失败不是自动终止整个方案的理由，应记录、最小诊断并按边界修复。

## 10. 当前授权边界

用户已明确启动本 Goal，一次性授权按 D0～D8 推进到 `READY_FOR_LOCAL_MAIN_DECISION`：

- 允许建立独立集成 worktree/branch；
- 允许在集成 worktree 修改产品代码、脚本、配置、package、测试和权威文档；
- 允许使用 Node `22.23.1` / npm `10.9.8`、动态 loopback、系统临时目录和本地假 Provider/OSS 完成 D3～D6；
- 允许形成 D0 文档提交以及后续 main-safe 产品提交、证据文档提交；
- D7 必须等待用户明确验收；通过后自动执行 D8。

用户于2026-08-23另行明确说“允许本地合入main，不push”。该一次性授权已用于：在新的独立 main worktree 中把过期本地 main 以 `--ff-only` 快进到审计远端 main，再以明确 merge commit 合入集成候选并提交本次状态文档。它不扩张为远端、发布或外部系统授权。

当前仍不允许：

- push、PR、tag、升版、发布或部署；
- 访问真实 Provider、OSS、SSH、生产、真实数据、真实媒体、备份或秘密；
- 读取、改动、暂存原工作树受保护的未跟踪 JSON。

本地 main 合入已完成；下一步停止，不 push。任何远端 main、PR、tag、版本或发布动作都必须另获明确授权。
