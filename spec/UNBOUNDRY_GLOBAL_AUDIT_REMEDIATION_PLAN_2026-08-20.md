# Unboundry 全局审计结论与修复实施方案

更新日期：2026-08-20
状态：`IMPLEMENTED_AUTO_PASS / RELEASE_AUTHORIZED_NOT_RELEASED`
用途：本轮全局审计修复的实施记录与验收门。当前一页状态以 `spec/UNBOUNDRY_CURRENT_STATE.md` 为准；**本地已实施不等于已发布，也不等于用户实页验收**。

## 0. 当前指令与边界

- 用户要求把本轮全局审计和详细修复方案固化为文档，避免上下文丢失。
- 用户已说明网站尚未正式投入使用，可以先修代码；因此不把“临时线上止血”单独列为施工批次。
- 初始施工授权不包含生产、真实数据、真实媒体、真实付费生成、commit、push、tag、PR 或发布。用户随后在 2026-08-20 明确一次性授权 v0.6.25、发布和最小真实页面/11MB 模板验证；删除生产数据、删除备份或不受控重复付费仍不在授权内。
- `spec/public-templates-director-split-revision.json` 不提交、不删除、不改名。
- 用户先明确说“那就开始吧”，因此 A～E 进入本地实施；完成自动门后又明确把本次版本号、发布和真实页面验证全部授权给 agent，版本采用 v0.6.25。该授权只适用于本次并在完成后失效。

## 1. 基线与证据边界

### 1.1 本地基线

- 仓库：`/Users/mymy/Documents/unboundry/app`
- 分支：`codex/unboundry-offline-remediation-2026-08-09`
- HEAD：`ca73afe49a72c0a0a1950e21116e690f3c5be799`
- package：`0.6.24`
- 本机默认 Node：`v25.9.0`；安全测试入口会切到项目固定的 Node `22.23.1`。
- 工作树原本就有其他 agent 的未提交改动。本文不得把这些改动当成自己完成的工作，也不得清理或覆盖。

### 1.2 已执行的自动验证

本轮审计已经通过唯一安全入口运行：

```bash
node scripts/run-safe-tests.mjs full
```

结果：`119/119 specs、1007/1007 tests PASS`；failed、skipped、retries、reportErrors、blocked 均为 0；4173 listener 和源码快照前后不变；未访问真实 Provider、生产数据或真实媒体。

这个结果只说明现有测试全部通过，**不能反证下列问题不存在**。其中多项正是测试覆盖缺口。

### 1.3 生产只读事实（本轮审计已核实，后续可能随生产变化）

- 生产当时为 `v0.6.24 / schema39`，`UNBOUNDRY_ARK_FILES_API=1`。
- 2026-08-19 15:00–16:00Z 的失败画布为 `9dd7c462-cc1e-40e9-90c7-8e0131df490e`：上游“服装主体标准化”图片任务成功，输出 PNG 为 `11,596,744` 字节；随后四次文字预检返回 200，但没有正式任务 POST 202。结合当时 v0.6.23 的 10MB 文字输入上限，已确认是四个下游文字节点被预检拦下，继而阻塞五个后代节点，不是客户端 DAG 漏发。
- 红字把错误归到“服装主体标准化”，但该图片节点实际成功；真正失败的是下游文字节点读取这张 11MB 图片时不兼容，属于错误归因不准。
- 2026-08-19 18:33–18:37Z 同一画布的 7 个图片任务和 4 个文字任务均 success，请求日志存在正式 202 提交；“2:33 三张主图从未提交”的旧结论已被证据否定。
- 长期排队任务为 `c479826f-a426-4a11-854c-79ecc802bcbc`。其事件为 queued → running → failed（平台退款）→ retrying → queued，之后没有再次启动，也没有 `provider_task_id`。

## 2. 审计结论总览

| 优先级 | 范围 | 已核实问题 | 当前状态 |
|---|---|---|---|
| P0 | Ark Files 生命周期 | 上传取得 `fileId` 后，轮询失败或取消不会自动 DELETE，可能留下临时文件 | 本地已修；m99 18/18 |
| P0 | Ark Files 超时/取消 | `Promise.race` 只让调用方超时，不会中止底层 fetch；轮询单次 GET 可无限挂住 | 本地已修；m99 18/18 |
| P0 | 排队任务恢复 | 裸 `setTimeout(0)` 补启动、巡逻按 `createdAt` 判断，并缺真实竞态测试 | 本地已修；m38 15/15 |
| P1 | Ark Files 内存与并发 | 限流晚于整图入内存、OSS 无流式上限、跨账号 gate 耦合 | 本地已修；m99 18/18 |
| P1 | 可观测性 | 缺少 `ark-files-upload/poll/delete` 结构化日志；清理失败静默 | 本地已修；m99 18/18 |
| P1 | 保存重试 | 15 秒退避项从未执行 | 本地已修；m38 15/15 |
| P1 | 整组使用手感 | “取消整组执行”误导，实际只停止后续 | 本地已修为“停止后续”；m22 26/26 |
| P1 | 整组失败反馈 | 摘要缺失败节点、原因、计数、定位与手动关闭 | 本地已修；m22 26/26 |
| P1 | 文档治理 | 多份文档同时播报“当前”导致漂移 | 已收口到 CURRENT_STATE；全量 119/1018 |

### 2.1 本地实施证据（尚未发布）

- 排队恢复：defer 登记在旧执行 `finally` 中直接接力，teardown fence 纳入待重启表；stale queued 改看 `updatedAt`；测试已从回调计数加强为真实 SQLite `queued → running → failed` 状态/事件迁移，并断言新鲜 queued 不被误启动。
- Ark Files：`prepareArkImageFile` 在读取大图前按 `ownerId + profileId` 取得槽位；OSS 流式限制 20MiB；上传、单次 poll、整体 poll、读取与 DELETE 都会真正 abort 底层传输；拿到 `fileId` 后的 cleanup 为 single-flight 且最多一次 DELETE。本地素材改为单一 `FileHandle`、末级 `O_NOFOLLOW`、前后 `fstat`、精确大小/校验和/PNG 校验与分块有界读取；gate 释放直接原子转交 waiter，响应体异常会 cancel/release reader，并区分 `CANCELLED` 与 `NETWORK`。
- 保存重试：首次保存加五轮退避后重试，总计最多六次；等待严格为 1/2/4/8/15 秒，测试注入 sleep 精确断言。
- 整组交互：按钮与通知改为“停止后续”；当前已开始节点不被伪装成已取消。会话级摘要显示成功/失败/未运行/处理中数量、首个真实失败节点、错误码与原因，可关闭并可选中聚焦该节点；刷新后消失，不写画布 document。摘要 scope 统一为 `accountId + canvasId + fixtureScopeId`，缓存上限 128、关闭记录上限 256，`runSequence` 阻止旧轮次迟到覆盖新轮次；任务面板只从规范 scope 取画布并标注“最近一轮”。
- 独立子 agent 复核补获并修正：gate 超时/取消 waiter 残留吞掉后续空位、槽位释放与 waiter 唤醒非原子导致的超并发、响应体阶段取消/断流误分类与 reader 未清理、静态预检双击重复启动、并行失败节点与原因/错误码错配、skipped 原因只存在于短 toast、摘要跨账号/画布/fixture 串线与旧轮次覆盖。相应反例已纳入 m99/m22；修正后独立终审未发现新的 P1/P2。
- 定向结果：m38 `15/15`（含文档一致性门）、m99 `18/18`、m22 `26/26`、m57 `14/14`，均为安全入口、异常计数 0、4173 listener 不变。
- 实现后正式安全全量：`119/119 specs、1018/1018 tests PASS`；failed、skipped、retries、reportErrors、blocked 均为 0，未访问真实 Provider、生产数据或真实媒体。证据绑定 HEAD `ca73afe49a72c0a0a1950e21116e690f3c5be799` 下 567-file 冻结工作树，source/snapshot SHA-256 均为 `e015b2d2fd7a86e4b75c46be2169296359bf9318cc04e4ec0efc776aa952e0e0`；4173 listener 前后哈希均为 `24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244`。
- 全量证据之后只做了 m22 测试常量去硬编码与状态文档回填；产品代码和安全 runner 未再变化。同步后的 m22/m38 会单独复跑，避免把文档后的工作树冒充为同一个全量源码快照。

## 3. 批次 A：修正 Ark Files 生命周期、超时和内存边界

### 3.1 目标

做到以下合同：

1. 只要客户端明确拿到 `fileId`，后续轮询失败、取消、配置变化、Provider 请求失败或任务结束，都只能触发一次幂等清理。
2. 每个网络阶段都有真正会 abort 底层请求的 deadline；不能只让上层 Promise 先返回。
3. 并发槽位在读取整张 10–20MB 图片之前取得，避免并发任务先把多张大图全部装进内存。
4. OSS 读取有独立超时和流式上限，超过 20MiB 立刻中止，不先无限制 `arrayBuffer()`。
5. 不持有 Provider 配置锁做任何上传、轮询、删除或素材下载。

### 3.2 实施设计

#### A1. 用一个高层生命周期函数统一所有权

在 `server/arkFileUploader.ts` 增加高层入口（建议名 `prepareArkImageFile`），由它统一完成：

1. 以 `ownerId + profileId` 取得并发槽位；
2. 在槽位内读取并校验图片；
3. 上传并解析 `fileId`；
4. 一拿到 `fileId` 就建立本地清理所有权；
5. 轮询到 active；
6. 返回 `{ fileId, cleanup }`；
7. 任何中途异常都在抛出前执行独立清理。

`cleanup` 必须幂等并 single-flight：同一文件无论被失败分支、任务 finally 或重复回调调用多少次，最多发一个 DELETE，其余调用等待同一个结果。

不能承诺的边界必须保留：如果上传 POST 已被服务器接收，但连接在客户端收到 `fileId` 前断开，客户端不知道文件编号，无法定向 DELETE。该分支记录“上传结果未知”，依赖方舟临时文件过期回收，不能虚报为“绝不留孤儿”。

#### A2. 用真正的 deadline 替换 `raceWithTimeout`

增加统一 `requestWithDeadline`：

- 为每次请求创建内部 `AbortController`；
- 把任务取消信号与内部超时信号联动；
- deadline 到达时调用 `abort()`，确保底层 fetch 和响应体读取一起停止；
- 将任务取消映射为 `CANCELLED`，阶段超时映射为 `TIMEOUT`，普通断网映射为 `NETWORK`；
- 响应体读取也必须落在同一 deadline 内。

建议初始阶段上限：

- OSS 读取：30 秒；
- Files 上传：60 秒；
- 单次 poll GET：10 秒；
- 整体 poll：120 秒；
- DELETE：10 秒。

整体 poll deadline 与单次 GET deadline 必须同时存在；某次 GET 挂住不能绕过整体 120 秒限制。

#### A3. 提前限流并限制内存

- `generationTasks.ts` 不再先调用 `readArkImageBytes`、再进入上传 gate；把素材描述传给高层入口，由入口先拿 gate 再读取。
- OSS 响应按流读取，累计超过 20MiB 立即 cancel；完成后再做实际字节数、PNG 头和 SHA-256 校验。
- 本地文件保留 20MiB 上限和 checksum 校验；首版可以继续用 Buffer，但必须发生在 gate 内。
- gate key 改为 `${ownerId}:${profileId}`，避免不同账号因共享 profile UUID 被全局串行；同一账号同一连接仍限制为 2。

#### A4. 结构化日志与清理失败

增加不含秘密的结构化事件：

- `ark-files-upload`
- `ark-files-poll`
- `ark-files-delete`

字段只包含：taskId、owner/profile 的非敏感标识或稳定脱敏标识、字节数、耗时、轮询次数、结果、错误码。不得记录 API Key、Authorization、签名 URL、提示词或完整 `fileId`。

任务 finally 中 DELETE 失败不能继续静默吞掉：记录 `ark-files-delete` failure，但不能把已经成功的推理反转为失败；依赖服务端过期回收。

### 3.3 必须补的测试

- 成功推理后 DELETE；
- 上传成功、poll 返回 failed 时 DELETE；
- poll 期间取消时 DELETE；
- 单次 GET 永不返回时真正 abort；
- 整体 poll 超时；
- 上传超时真正 abort；
- OSS 读取超时；
- OSS 流超过 20MiB 时中止且不上传；
- 同账号同 profile 第三个任务等待；
- 不同账号同 profile 不互相占槽；
- 第三个任务在取得槽位前不能开始读取大图；
- cleanup 重复调用只发一个 DELETE；
- DELETE 失败只记录，不反转成功任务；
- 配置变化阻止 Provider 请求但仍 DELETE。

## 4. 批次 B：完成“排队中”恢复闭环

### 4.1 对现有脏树修复的判断

现有 `pendingGenerationRelauches` + recovery sweep 方向正确，但还不能直接视为完成：

- 名称拼写错误，应改为 `pendingGenerationRelaunches`；
- old execution 的 finally 使用 `setTimeout(..., 0)`，在运行时进入 draining/teardown 的窗口可能再次丢启动；
- stale queued 判断使用 `createdAt`。自动重试会更新任务的 `updatedAt`，因此老任务刚刚重新排队也可能立刻被巡逻捞起；应该按最后状态更新时间判断；
- 新增测试只证明“巡逻挑中旧 queued、忽略新 queued”，没有复现这次真实的“旧执行挡住重启 → 旧执行退场 → 必须恰好启动一次”。

### 4.2 实施设计

1. `launchGenerationTask` 遇同 taskId 已在 launched set 时，只登记一个 pending relaunch；重复请求合并，不累计次数。
2. 旧执行 finally 先从 launched set 退场，再同步取走 pending 项并立即走统一的受控 launch 函数，不使用裸 `setTimeout(0)`。
3. 如果 runtime 已 draining，不在旧 owner 上强启；保留 queued 状态，让下一 active runtime 的启动恢复或 sweep 接管，并记录明确 diagnostic。
4. recovery sweep 以 `updatedAt <= graceDeadline` 判断 stale queued，不以 `createdAt` 判断。
5. sweep 只 launch `state=queued` 且当前不在受控执行中的任务；所有付费防重、幂等和 Provider attempt 规则保持不变。

### 4.3 必须补的真实事故回归

构造确定性 barrier：

1. 第一次执行保持在 launched set；
2. 模拟平台退款并进入自动重试；
3. retry admission 把同一任务变回 queued；
4. relaunch 请求因旧执行仍在而 defer；
5. 释放旧执行；
6. 断言同一 task 恰好进入一次第二次 running/Provider 边界。

另补：重复 defer 合并、drain 竞态、下一 runtime 恢复、fresh queued 不巡逻、非 queued 不巡逻、以 updatedAt 而非 createdAt 判旧。

## 5. 批次 C：修正整组执行反馈与用户预期

### 5.1 取消按钮说真话

当前 `cancelGroup` 只设置本地 `cancelled=true`；已经提交或正在运行的节点会继续完成，只阻止后续节点调度。这是既有行为，不应伪装为“全部取消”。

最小可靠改法：

- 按钮“取消”改为“停止后续”；
- aria-label/title 改为“停止后续节点”；
- 点击后提示：“已停止后续节点；当前已开始的 N 个任务仍会继续并保存结果。”

本批不扩成批量调用服务端 cancel API。真正取消不同 Provider 的语义不一致，会引入付费结果未知和重复扣费风险，必须另立产品合同。

### 5.2 把已有摘要升级为可排障摘要

纠正旧说法：项目已经有 `groupRunSummary.ts`，并在 Group 和“生成任务”面板显示上次整组用时；但它目前只存 canvasId、groupId、nodeCount、status、elapsedMs，且仅存在页面内存。

扩展为：

- failedNodeIds / blockedNodeIds；
- 首个真实失败节点标题与 nodeId；
- 原始安全错误码和面向用户的原因；
- 失败、阻塞、成功、仍在运行的数量；
- “定位失败节点”动作；
- 用户手动关闭，不依赖 8 秒 toast；
- 仍只存页面/当前会话，不写入画布 document，避免改变持久化合同。

错误归因必须指向真正失败的目标节点。例如 11MB 事故应表达为“导演稿节点无法读取上游图片（11.06MiB，当前上限 10MiB）”，不能说已经成功的“服装主体标准化”节点失败。

### 5.3 测试

- “停止后续”不再启动新节点，但已运行节点完成并保存；
- UI 不使用“取消整组执行”误导文案；
- 失败摘要在 toast 消失后仍可见；
- 摘要列出失败/阻塞数和真实失败节点；
- “定位失败节点”选中并聚焦正确节点；
- 切换 canvas 不串摘要；刷新后摘要消失，符合仅会话内存合同。

## 6. 批次 D：修正保存退避的代码/文档不一致

`attemptProviderResultSave` 默认数组为 `[1s, 2s, 4s, 8s, 15s]`，但终止条件在 `attempt >= backoffMs.length - 1` 时直接返回，实际只等待前四项，15 秒永远不会执行。

先固定合同为“首次尝试 + 5 次等待后的重试”，总共最多 6 次 save 调用，等待严格为 1/2/4/8/15 秒。原因：当前 README/CURRENT_STATE/TASKS 已公开写成五次退避，修代码比再次改产品文案更一致。

测试使用注入式 sleep 或假时钟，精确断言：

- 瞬时失败五次后第六次成功；
- 六次都失败时返回 false；
- 等待序列恰好 `[1000, 2000, 4000, 8000, 15000]`；
- 明确终局错误仍立即抛出，不等待。

## 7. 批次 E：文档单一事实源

### 7.1 目标

- `spec/UNBOUNDRY_CURRENT_STATE.md` 是唯一“当前状态”入口；
- README 只链接 CURRENT_STATE，不再复制容易过期的“当前线上版本”；
- CHECKPOINT 与旧 remediation plan 保留历史证据，但不再给出会被误读为当前行动的命令；
- ACCEPTANCE_MATRIX 只记录验收状态，不承担当前版本播报；
- 每次事故只有一份当前实施卡，其他文档链接过去。

### 7.2 一致性检查

增加只读文档检查，至少验证：

- package 版本与 CURRENT_STATE 声明一致；
- README 不出现第二份“当前线上 vX”；
- 必读顺序能找到本文与当前事故文档；
- 仓库中只能有一个标记为当前的 recovery/implementation 入口；
- 历史 receipt 的时点字段不被改写。

## 8. 实施顺序与停止门

按以下顺序做，避免同时改太多相互影响的路径：

1. **B：排队恢复闭环**——已有脏树基础，先补真实事故测试并修正竞态/updatedAt；
2. **A：Ark Files 生命周期**——风险最高、改动集中，完成后跑 m99 与生成核心回归；
3. **D：保存退避**——小而独立，精确测试；
4. **C：整组 UX**——建立在正确后端状态和失败信息上；
5. **E：文档单一事实源**——以最终代码和测试结果收口。

每批都必须：先看当前 dirty diff → 补失败测试 → 实施 → 定向回归。不得为了测试变绿删除断言或放宽产品合同。

若发现下列任一情况，停止并报告：

- 需要改变“同一输入不重复付费”的合同；
- 需要修改 schema 或生产数据；
- 需要真实 Provider/OSS 请求才能判断；
- 与其他 agent 的未提交改动重叠且无法安全合并；
- 需要把“停止后续”扩成真正批量取消 Provider 任务。

## 9. 最终验收门

### 9.1 自动门

- 所有新增定向测试通过；
- `node scripts/run-safe-tests.mjs full` 全绿；
- failed、skipped、retry、reportErrors、blocked 均为 0；
- 4173 listener 前后不变；
- 测试不访问 `app/data`、`/var/lib/unboundry`、真实媒体、真实 Provider/OSS 或非 loopback 网络；
- `git diff --check` 通过；
- `spec/public-templates-director-split-revision.json` 保持未改、未删、未提交。

### 9.2 本地手工验收

使用本地假 Provider/假 Ark：

1. 退款自动重试不再长期 queued；
2. 11MB 假 PNG 的 upload/poll/delete 生命周期与结构化日志完整；
3. poll GET 挂死会按时 abort；
4. “停止后续”文案与实际行为一致；
5. 整组失败摘要不会 8 秒后消失，能定位真实失败节点。

### 9.3 仍需单独授权的真实验证

真实 Ark 11MB 端到端模板验证仍是独立付费/外部操作，必须用户单独点头。它用于验证 Provider 当前协议和真实日志，不是本地代码施工的前置条件，也不能用本地假 Provider 结果冒充。

## 10. 完成定义

本轮已经满足以下自动完成条件；当前状态为 `IMPLEMENTED_AUTO_PASS / RELEASE_AUTHORIZED_NOT_RELEASED`：

- A～E 的代码/文档按最终实际范围完成；
- 所有新增测试和正式安全全量通过；
- 当前工作树改动归属与证据清楚；
- TASKS、CURRENT_STATE 和本文已同步；验收矩阵继续只保留历史验收账本并指向 CURRENT_STATE；
- 没有把真实 Provider、发布或用户实页验收写成已完成。

真实页面技术验证由 agent 代做并记录证据；它不能替代用户主观使用感受的 `USER_PASS`。本次 v0.6.25 版本号与发布授权已取得，完成后立即失效；本文不提供永久授权。
