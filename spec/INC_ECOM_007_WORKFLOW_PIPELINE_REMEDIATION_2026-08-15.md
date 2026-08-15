# INC-ECOM-007：整组工作流流水线全局修复

更新时间：2026-08-15
状态：`PRODUCTION_PUBLISHED_USER_PASS`

## 1. 用户确认的执行合同

- 整组运行必须是依赖驱动的有向无环图流水线，不是开始前要求所有下游已有输入，也不是全局逐层屏障。
- 节点只在本轮运行的所有直接生成式上游均成功、结果已落到画布并完成保存后才能提交。
- 多入参使用严格 AND：任一入参仍在生成时继续等待；任一生成式上游失败时，本节点不提交并标记为被上游阻塞。
- 分流后，每个分支在自己的依赖完成后立即继续，不等待无关慢分支；汇流节点等待自己的全部直接上游。
- 一个分支运行失败只阻塞其后代，其他无依赖关系的分支继续；整组最终报告部分失败。
- 手动单节点运行合同不放宽：空、上传中、无效或缺失的上游仍阻止用户直接运行下游。
- 整组开始前仍执行零任务静态门：循环、图错误、模型缺失/停用、类型/角色/顺序/数量不兼容、缺失的人工上传和无提示词根节点均在任何生成任务 POST 前阻止。
- 本修复和发布不调整并发/RPM，不修改模板、Provider、OSS或数据库；验证与切换不得产生真实或付费请求。

## 2. 已确认根因

1. `WorkflowExecutionProvider` 在运行第一层前动态预检所有可执行节点，因此下游把本应由本轮上游生成的空输出当成当前错误。
2. `workflowSubmissionPreflightProblem` 先看到 resolver 的 `compatibility=blocked` 就返回，导致“可执行上游的未来输出应延后”分支永远到不了。
3. 原测试人为构造了 `state=empty + compatibility=compatible`，与真实 `resolveNodeInputs` 会把空输入标为 blocked 的行为不一致。
4. `runWorkflowLayers` 使用整层 `Promise.all` 屏障；快分支不能在自身完成后继续，必须等待同层慢分支。
5. 四类节点的运行函数读取 React render 闭包中的 `inputPreflight`；上游完成后必须重新检查最新输入，不能沿用整组开始时的快照。

## 3. 实施设计

1. 保留静态全图门，但把来自本轮可执行上游的 `EMPTY/UPLOADING/INVALID` 分类为 `WAITING_UPSTREAM`，不创建错误、不提交任务。
2. 用事件驱动的 `runWorkflowGraph` 替换生产调用路径：维护 pending/running/success/failed/blocked；每次任一节点完成后立刻调度新就绪节点。
3. 每个节点提交前执行 runtime preflight；若 React 输入快照仍未刷新，则短暂等待最新 render，超时后失败关闭，不盲目提交。
4. 调度依赖状态本身构成本轮身份：下游只能由本轮调度器记录的上游 success 解锁；历史 ready 内容不能提前解锁仍处于 pending/running 的上游。
5. 取消只阻止新节点提交；已提交节点允许安全收口。

## 4. 必须通过的验收

- 真实 resolver：空 Text（有生成 Prompt）→ Image 在静态整组预检中为等待，不再阻止整组。
- 串行：Text→Image、Text→Image→Video、Text→Audio。
- 分流：快分支下游可在慢分支完成前启动。
- 汇流/多入参：两个上游中一个完成、一个运行时，目标节点绝不启动；两者全部成功后只启动一次。
- 失败隔离：失败分支后代不运行，独立分支继续。
- 取消后不再派发新节点。
- 静态模型/类型/角色/顺序/数量错误仍在任务 POST 前阻止整组。
- 四类节点共同使用 runtime preflight；定向测试、TypeScript、production build和安全回归通过；Provider请求为0。

## 5. 状态记录

- 2026-08-15：用户确认上述合同并授权一次性完成本地修复、验证与报告；不要求中途重复询问。
- 2026-08-15：生产整组执行路径已切换为事件驱动 `runWorkflowGraph`；四类生成节点统一执行 static/runtime 两阶段预检，runtime waiting 不再持久化为错误，最终不变量失败仍失败关闭。
- 2026-08-15：真实 resolver、分流流水、严格多入参 AND、分支失败隔离和取消语义已加入 `m22-group-execution.spec.ts`；冻结测试清单由954更新为959。
- 2026-08-15：Node `22.23.1` / npm `10.9.8` 下，7份相关spec定向 `69/69 PASS`；TypeScript、source coverage和production build均PASS，Provider/真实请求为0。
- 2026-08-15：在临时洁净直接父子候选上完成正式安全full：`117/117 specs、959/959 PASS`，failed/skipped/retries/reportErrors/blocked全0；immutable builder `attempts=1 / invocations=5 / passed=1`，source/snapshot `28b203bb76275b9566727e51e2384674c7ddcf9851cc98c80fd3aed11b8a30c4`前后不变，4173 listener不变，safe suite已清理。
- 临时验证身份仅用于满足不可变release测试：bridge `7cbce6dd26c99ea25cf88ffddb8c34694bdc06ec`、final `8013ebc12b70cae98bcc1277b4701d79370d3a32`；不是实际仓库commit、发布候选或生产授权。
- 2026-08-15：正式源已冻结为commit `f3d3fc8b2d4cb846b446fa4a46afbdcd796e2ccf` / tree `dd1180077032a42f1ab7ce7ca614906898d1f414`；v0.6.1明确运行时准入后相关8份spec `110/110 PASS`，精确HEAD production build PASS。
- 2026-08-15：生产已切换到不可变目录`/opt/unboundry/releases/v0.6.1-inc-ecom-007-20260815`；release inventory `c467c7c2…d2237f`。公网version为0.6.1，live/ready正常，主JS SHA-256 `8bc2ebb6…e1204`与release相同；service active/enabled、NRestarts0。
- 2026-08-15：停机备份`/var/lib/unboundry-rollbacks/inc-ecom-007-20260815T135418Z`已完成全树清单与恢复副本核验，二者SHA-256同为`73554c0a…535f24`。发布前后schema39、quick_check ok、FK0、tasks109、attempts107、active0、模板43/42和并发/RPM 500均不变，Provider/付费请求0。
- 2026-08-15：用户在v0.6.1线上实页完成复验并明确回复“通过通过”；流水、多入参AND、分流推进和失败隔离的本轮用户验收记为PASS。
- 当前结论：`PRODUCTION_PUBLISHED_USER_PASS`。代码、生产技术发布与用户线上验收均已完成；生产凭证SHA-256为`91c05297…5f819c`并已封存到本轮备份目录。未push/tag/PR。

## 6. 用户复验方式

1. 强制刷新`https://canvas.mymy.ltd`并从模板创建一份新工作流；`/api/version`应显示`0.6.1`。
2. 运行 `Text → Image` 整组：Text先生成；Image等待且不显示“Text还没有生成正文”的提前失败，Text成功保存后Image自动开始。
3. 对含两个生成式上游的目标节点：一个完成、一个仍运行时目标必须保持等待；两个均成功后只启动一次。
4. 对分流图：快分支后代应在无关慢分支结束前启动；某分支失败时只阻塞该分支后代，独立分支继续，整组最终报告部分失败。
5. 人工上传缺失、模型缺失/停用、类型/角色/顺序/数量不兼容仍应在任何生成任务提交前阻止整组。
