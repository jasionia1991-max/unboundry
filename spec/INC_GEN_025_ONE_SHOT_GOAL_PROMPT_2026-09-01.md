# INC-GEN-025 新 Session 一次性 Goal 提示词

状态：`COPYABLE / NOT_ACTIVE_UNTIL_USER_PASTES_IN_NEW_SESSION`

使用方法：在新的 Codex Session 中完整复制并发送下面代码块。不要删减权限、恢复顺序、Review、预算或 NO-GO 条款。

```text
/goal

目标：一次性完成 INC-GEN-025「服务端权威整组执行」的实施、验证、全链路 Review、全部问题修复、v0.6.70 不可变发布、生产迁移/回滚验证和指定 Canvas/group 的唯一一次真实整组验收。最终必须让普通用户只点击一次，系统自动完成文字、图片、视频和视频音轨的生成、原任务核对、结果保存、发布与 Canvas 回填；用户不得反复点击重试，也不得去 Provider 平台回收结果。

这是一个强文档驱动 Goal。项目文档和当前代码/证据是事实来源；聊天上下文、会话摘要和记忆只作次要线索，不能覆盖文档或冒充当前事实。不要从历史 Goal、历史授权或旧候选恢复权限。

一、开始和每次上下文恢复的强制顺序

1. 先只读核对当前 cwd、Git root、branch、HEAD、origin/main、worktree status、package版本、schema、Node/npm和生产身份。
2. 当前文档源位于：
   `/Users/mymy/Documents/unboundry-inc-gen-024-v0.6.70-candidate`
3. 按以下顺序完整阅读，不得只读摘要：
   - `AGENTS.md`
   - `上线规矩.md`
   - `spec/UNBOUNDRY_CURRENT_STATE.md`
   - `spec/INC_GEN_025_CHECKPOINT.md`
   - `spec/INC_GEN_025_SERVER_AUTHORITATIVE_GROUP_RUN_PLAN_2026-09-01.md`
   - `spec/INC_GEN_025_ACCEPTANCE_MATRIX_2026-09-01.md`
   - `TASKS.md` 的 INC-GEN-025 区块
   - 由上述文件直接路由的实现相关源码、测试和架构边界文件
4. 权威优先级：我在本 Goal 中的最新明确指令 > `AGENTS.md`与`上线规矩.md`安全边界 > INC-GEN-025 Checkpoint > Plan > Matrix > CURRENT_STATE/TASKS > 当前代码、数据库和运行证据 > 聊天上下文/摘要/记忆。
5. 若发生上下文压缩、换 Agent 或恢复 Session，先把当前真实进度写入唯一 Checkpoint、Matrix、TASKS 和 CURRENT_STATE，再按上述顺序重新完整读取；不得靠“我记得”继续施工。
6. `spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json` 永久禁止读取、哈希、修改、暂存、移动或删除。任何工具或测试可能读取它时，必须先改用独立脱敏 fixture。

二、施工身份与旧工作树隔离

1. 当前已核对的基线是生产/main/tag `v0.6.69 @ 74dc9d9307abee9169a2d2aefc4b01add96114c9`；开始时必须重新 fetch 并验证，不能把这条历史快照当成不变事实。
2. INC-GEN-024 的 v0.6.70 窄候选是 `SUPERSEDED_NO_GO`，只保留诊断证据，严禁发布、合并或把其中产品代码带入新候选。
3. 从最新 `origin/main` 新建干净工作树：
   `/Users/mymy/Documents/unboundry-inc-gen-025-server-authoritative-2026-09-01`
   分支建议：`codex/inc-gen-025-server-authoritative-group-run`
4. 只把 INC-GEN-025 的 Plan、Matrix、Checkpoint、Goal 提示词和必要治理路由以可审计方式落入新工作树；不得复制 INC-GEN-024 的产品代码改动。
5. 新工作树若不干净、基线不等于实时 origin/main、目标路径/分支已被其他任务占用或身份冲突，必须在任何写入前查清并 fail-closed；不要覆盖用户工作。

三、这一次 Goal 的明确授权

我授权你在本 Goal 内连续完成以下动作，中途不要因普通工程问题、依赖安装、测试失败、Review 发现或文档同步来询问我：

- 阅读项目文件和必要的只读生产证据，但不得触碰上述受保护文件正文。
- 创建上述隔离 worktree/branch；修改项目代码、测试、脚本、配置、文档、package/lockfile和必要 schema migration。
- 安装项目依赖；创建动态 loopback、临时目录、假 Provider/OSS、测试数据库和必要测试资源；只清理由本 Goal 创建且身份已核实的临时资源。
- 执行类型检查、架构门、source coverage、风险定向测试、故障注入、构建和一次正式 safe full。
- 创建本地提交；push Goal 分支；创建 PR；等待并修复 CI；合并 PR。
- 创建不可移动 annotated tag `v0.6.70` 和 GitHub Release；从精确 tag 做 fresh build 与 inventory 校验。
- 通过 SSH 对生产执行本 Goal 必需的只读检查、停服/启动、冻结备份、恢复副本演练、schema migration、原子 release 切换、成对 rollback/forward、健康/数据/静态资源/稳定门。
- 允许本 Goal 所需的生产 schema 变更，但必须先在冻结生产副本完整演练并验证 old-runtime 拒绝和 runtime+DB pair 回滚；不得让旧 runtime 读取新 schema。
- 允许新 workflow 的真实 OSS 结果写入、publication 和 Canvas projection；不得删除既有用户素材、历史 task、旧 release、rollback、backup 或 OSS 对象。
- 允许使用已有普通 Chrome 登录态，在 `canvas.mymy.ltd` 指定 Canvas/group 点击一次“整组执行”并完成真实验收。

版本与发布授权在本 Goal 中明确给出且只允许消费一次：

确认版本 v0.6.70。
允许发布 v0.6.70。

开始时必须重新证明本地 tag、远端 tag 和 GitHub Release `v0.6.70` 均未占用。若已占用，不得移动、覆盖或自动换版本，必须在版本动作前停止并报告身份冲突。

四、真实整组验收的付费与副作用授权

1. 指定 Canvas：`3b3cb4f8-56c3-49f5-ad42-1a00748ba33a`。
2. 指定 group：`group-fe8ea3c2-981d-4377-80e7-33aef9d38f35`。
3. 当前冻结分母：11个可执行节点、24条组内边；7个文字、3个图片、1个视频。没有独立Audio节点，音频以视频文件内音轨验收。
4. 真实整组总预算上限为 CNY 300 等值。点击前必须用可核验价格或保守配置上限证明不会超预算；无法证明则在付费前停止。
5. 最多允许全部真实 outbound Provider POST 合计 11 次。统计所有 POST，不得把口径缩成“create POST”。
6. 每个逻辑节点最多一个原始 Provider 提交；禁止自动重试 Provider POST。
7. 结果不明、响应丢失、账单不明或 task identity 不唯一时，进入 `OUTCOME_UNKNOWN_BILLING_RISK`，只核对原 task/attempt；绝不创建第二个 Provider POST。
8. 只允许在发布、生产零付费门、容量 reservation、模型恢复资格和目标 plan 全部通过后点击一次。不要把 preflight 当真实执行。
9. 若浏览器登录过期、出现必须由我完成的验证码/2FA，停止在付费点击之前并给出唯一明确阻塞；不得换账号、绕过登录或使用特殊测试身份。

五、必须严格实现的架构合同

严格按 INC-GEN-025 Plan 和 54 项 Matrix 实施，尤其不得回退以下决策：

- 服务端 durable workflow run 是唯一编排权威；浏览器只 create 一次并轮询。
- 准入时冻结 immutable semantic run plan；当前 run 不再读取可变 Canvas 改变 prompt、模型、边或输入身份。
- 提取 client/server 共用的纯 semantic compiler；React、localStorage、Web Locks 和 UI 代码不得迁到服务端。
- HTTP 单节点入口与 workflow runner 共用内部 generation admission application service；runner 不得通过 HTTP 调自己，也不得复制 admission。
- workflow run/node 只拥有编排状态、task link、projection state 和 media reservation id；generation task、Provider attempt、media asset、publication 仍是各自权威，禁止第二套状态机。
- node success 由原 generation task 结果和 durable publication 决定；Canvas projection 是最终一致副作用，失败不得降级成功、阻塞下游或触发 Provider POST。
- 下游从 frozen plan + authoritative upstream task results 解析输入，不等待 Canvas 回填。
- media 域拥有整组容量 estimate/reserve/recheck/release；整组准入和每次付费 POST 前都 fail-closed。workflow 不得硬编码 20/50/500 MiB。
- 每个 node 使用 deterministic idempotency key 和 DB atomic claim；crash/restart 只能收敛到同一个 task。
- 逐个目标 text/image/video adapter 查证 Provider 恢复等级；不得猜测。资格不足只限制强保证 workflow，不得误伤普通单节点生成。
- same Canvas/group 和重叠 lock set 互斥；disjoint group 保留并行；projection 只按 Canvas 串行。
- 复用现有 runtime role coordinator、generation worker、startup recovery 和 shutdown drain；不引入微服务、消息队列、Redis/Kafka、第二 scheduler 或 SSE。
- CNY 300 只是本次真实验收门，不建设产品级人民币预算系统。

若实现查证发现 Plan 中某个技术细节与当前代码事实冲突：先把代码证据、影响和最小修订写入 Checkpoint/Plan/Matrix；只能修正实现细节，不能擅自放宽用户合同、幂等、费用、数据安全、Review或验收门。拿不准的地方必须继续查代码、schema、测试或Provider合同，禁止猜测。

六、连续实施与测试纪律

1. 按 Plan 的 R0-R8 顺序连续执行，每个阶段完成即更新 Checkpoint、Matrix、TASKS 和 CURRENT_STATE。
2. 先写 characterization/红测冻结真实行为，再实现最简单可靠方案；不得用最小 diff 跳过必要的跨模块一致性。
3. 先跑类型/静态和直接依赖测试；失败只诊断并复跑最小受影响子集，不得反复跑全量测试。
4. 本任务跨 schema、workflow、generation、Provider、media、Canvas 和 client，属于真正的跨切面 release candidate。所有定向测试、故障注入和 Review 修复关闭后，运行一次且仅一次正式 safe full，永久保留原始结果。
5. 正式 full 若暴露失败：逐项定位、修复本次范围内的真实问题，只复验失败项和受影响最小集合；不得为了改写数字再跑第二次 full。所有已知失败必须有代码修复或证据充分的非本次回归归因与最小复验闭环，否则 NO-GO。
6. 测试只能使用临时数据、动态 loopback和假Provider/OSS；不得使用4173、生产数据路径、真实Provider或真实OSS完成代码测试。
7. 正式 full 后若还有任何产品源码修复，必须由同一独立 Review Agent 复审该增量并重新冻结最终Review身份；不得拿修复前的GO覆盖修复后的代码。

七、上线前强制全局 Review，所有问题关闭

候选实现和定向验证完成后，必须先冻结候选身份，再执行一次完整、非抽样的全链路 Review；没有 Review GO 绝不进入 GitHub/版本/生产。

Review 必须同时包含主线程逐代码审查和一个独立只读 Review Agent。独立 Agent 只在候选冻结后启动；发现问题后由主线程修复，并由同一 Review Agent 复审增量，循环直到范围内所有发现全部关闭。

Review 分母必须记录并覆盖：

- 100% changed files 和 100% diff hunks；
- shared semantic compiler、immutable plan、workflow schema/store/runner/recovery；
- generation admission/task/attempt、全部实际 Provider POST 入口和目标 workflow 使用的每一个 text/image/video adapter/model branch；
- media capacity reservation、staging、publication、cleanup；
- Canvas projection/CAS、客户端 create/poll/stop/刷新/换设备恢复；
- schema migration、bridge、startup/drain、rollback runtime+DB pair；
- owner/auth、并发/锁、幂等、费用、数据安全、日志脱敏和错误状态；
- 54项 Matrix 的逐项证据和全部 NO-GO 条件。

Review 要从过度耦合、风险、隐患、可能导致 bug、失败恢复、费用重复、数据损坏、并发竞态、兼容与回滚等方面审查，但不得为了迎合“全局Review”扩成与本功能无关的全仓重构。凡属于本次变更或受影响完整调用链的问题，不论 P0/P1/P2 都必须修复、定向复验并复审为 0；无关历史问题只记录证据，不借题扩项，除非它会破坏本次合同或上线安全。

最终 Review 门必须是：完整分母已覆盖，范围内 `P0=0 / P1=0 / P2=0 / GO`。任何遗留问题、未审文件/hunk/model分支、仅凭测试通过替代代码审查，均为 NO-GO。

八、发布与生产门

只有实现、风险定向测试、故障注入、完整 Review、Review修复复审和正式 safe full 闭环全部通过后，才能消费 v0.6.70 的 GitHub和发布授权：

1. 生成candidate commit并复核精确diff/manifest。
2. push、PR、final-head CI、合并、main CI全部通过。
3. 创建不可移动 annotated tag和GitHub Release；tag必须精确指向批准的merge。
4. 从精确tag fresh build；校验inventory、dist和版本身份。
5. 生产先quiet gate，再做root-owned冻结备份和恢复副本；在副本演练schema migration、repeat no-op、integrity/FK/counts、old-runtime拒绝和rollback/forward pair。
6. 原子切换生产；验证current/API/version/schema、service active/enabled/NRestarts、静态文件逐字节、关键业务计数和稳定窗口。
7. 发布/回滚不得删除旧release、backup、历史task、publication、Canvas或用户素材。
8. 生产零付费 preflight 必须证明目标 immutable plan、11节点/24边、模型精确revision、Provider恢复资格和media reservation均通过，且新增Provider POST/费用为0。
9. 只有上述门全绿后，才执行第四节授权的唯一一次真实整组点击。

九、真实结果验收和最终回执

- 核对11个节点的run/node/task/attempt/publication/projection链，证明没有第二task、第二attempt或重试POST。
- 3张图片逐项检查成功、可读取、已持久化，刷新和重新打开后仍在。
- 视频可播放且已持久化；用 `ffprobe` 证明成品包含音频流，刷新和重新打开后仍在。
- 浏览器关闭/刷新、服务端恢复和Canvas projection不得要求用户再次点击或去Provider平台处理。
- 记录全部Provider POST、task/attempt、费用、OSS/publication、服务和数据前后计数；总费用不得超过CNY300等值，POST不得超过11。
- 自动证据只能写 `AUTO_PASS / PRODUCTION_TECHNICAL_PASS / REAL_PROVIDER_PASS`；我没有亲自观看并明确确认前必须保持 `USER_RECHECK`，不得自升 `USER_PASS`。
- 最终交付必须更新Plan、Matrix、Checkpoint、CURRENT_STATE、TASKS和不可变生产receipt，写明精确commit/PR/CI/tag/Release/build/backup/migration/rollback/production/Provider/媒体证据、Review分母与残余风险。

十、只允许真正的硬停止

不要因普通实现选择、依赖、测试失败、CI失败、Review发现、文档同步或耗时而中途询问我；自行查代码、修复、验证并继续。

只有以下情况允许停止并报告唯一明确阻塞：

- Git/项目/生产身份冲突且无法安全消解；
- 受保护文件可能已被触碰；
- v0.6.70 tag/Release已被占用；
- 必须由我完成登录、验证码、2FA或法律/购买/订阅决定；
- 真实预算无法证明≤CNY300、POST将超过11；
- Provider结果/费用不明，只能继续核对原任务且已到Provider合同允许的最长可靠等待边界；
- 备份、迁移、数据完整性、rollback pair、Review或发布门无法满足；
- 任一动作需要删除既有用户数据、素材、旧release或backup。

除上述硬停止外，持续工作到：代码完成、全部范围内Review问题修复、测试闭环、v0.6.70发布、生产技术门通过、唯一真实整组执行完成并拿到图片/视频/音轨，最后把状态准确停在 `USER_RECHECK` 等我观看确认。
```
