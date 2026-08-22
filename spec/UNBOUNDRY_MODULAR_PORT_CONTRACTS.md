# Unboundry 模块化窄 Port 合同

状态：`P2_AUTO_PASS / P6_AUTO_PASS / P7_AUTO_PASS / P8_AUTO_PASS / P9_AUTO_PASS / OFFLINE_HISTORY / INTEGRATION_RECHECK_IN_PROGRESS`

## 1. P2 交付

P2 只先建立可迁移、可替换的窄合同，不提前实施 P3～P8：

- `client/src/canvas/canvasPorts.ts`：`CanvasGraphCommandPort` 与 `CanvasSavePort` 分开；graph write 显式携带 runId、nodeId、kind、ownershipKey、可选 taskId 与 expectedRevision。
- `server/providerReferenceStore.ts`：只管理 Provider 临时引用租约及 release；不拥有 durable bytes、publication 或 Generation 状态。
- `server/mediaBlobStore.ts`：只管理 local/OSS/memory 物理对象的 put/head/read/delete/signRead；不拥有 publication、history 或 task。
- `server/mediaGenerationProvider.ts`：统一 media submit/inspect/recover/cancel/normalize，保留 attempt、absoluteDeadline、providerTaskId、mayStillRun 与 refunded 表达；registry 按商业 driver/protocol/kind 精确解析。
- `server/generationQueryPort.ts`：只读 task identity/owner/state/attempt/providerTaskId；没有 mutation 方法。
- `server/transactionCommand.ts`：command 只能加入调用者已持有的 SQLite 事务；无事务、异步返回或提前结算事务均失败关闭。
- `types/providerVocabulary.ts`：只抽取无秘密的 Provider driver 纯词汇，避免新 public port 反向依赖 Provider profile 具体实现。

## 2. 明确未做

- P2 没有迁移 `NodeExecutorContext`、React Dispatch 或 Canvas persistence；由 P3/P4 负责。
- 没有把现有 Provider/Media/Generation runtime 接到新 port；由 P6/P7 分层迁移并删除旧入口。
- 没有迁移跨域 SQL；P8 必须逐项接入 transaction-scoped owner command 并做失败注入。
- 没有修改 schema、data、HTTP、UI、版本、Provider/OSS 配置或产品行为。

这意味着 P2 的 PASS 只证明合同可独立替换且安全证据没有在接口层丢失，不代表后续调用方已经解耦。

## 3. 验收证据

命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec m100-modular-ports`

环境：开始 HEAD `af68ca024a2bb1157b150f3e953ef883af99ad09` 加 P2 dirty tree，Node 22.23.1/npm 10.9.8。最终退出 0：

- P2 replacement drills 6/6：Canvas graph/save、reference/blob 分层、sync media Provider、async media Provider、Generation query、SQLite transaction command；
- 架构图 167 files、556 runtime、79 type，精确 baseline 131，无新增或 stale 违规；
- source coverage 369 files，TypeScript 325/325，JavaScript 44/44，operational 28；production build 通过；
- 发现 120 specs/1044 tests，只执行 `m100` 6 tests；failed/skipped/retries/blocked/reportErrors 均 0；
- 外网、真实 Provider、真实 OSS、SSH、生产访问均为 0；源码 snapshot 与 4173 listener unchanged；临时目录已清理。

诊断过程先后发现并修复：新增 spec 未登记 manifest、新 public port 反向 type-import Provider internal、夹具缺必填 label、冻结 test count 未同步。每次只重跑同一新增专项，没有重复既有成功产品测试或 full。

## 4. P6-A 运行时接线

P6-A 已把 `providerMedia.ts` 的 owner/media/本机文件/OSS profile 具体读取全部移出 Provider 域：

- Provider 只调用 `ProviderReferenceStore.acquire/release`，检查模型规则与 inline header，取出短期 locator 后必定 release；
- `mediaProviderReferenceStore.ts` 是 Media-owned adapter，只返回 signed URL 或精确大小/checksum 复核后的 inline data，不泄漏凭据、publication 或 Generation task；
- `generationTasks.ts` 在当前组合入口装配 adapter；P10 再把装配收口到 composition root；
- Provider→Storage 精确 baseline 删除 3 条、Provider→Media 删除 1 条，baseline 从 131 缩到 127，没有新增豁免。

定向证据：`m31-provider-media-safety 11/11 PASS`，`m100-modular-ports 7/7 PASS`；后者实际把 fake reference port 注入 Provider payload helper，并证明 acquire 参数与 release 生命周期。P6 整体仍须等 P6-C，不能提前标为 PASS。

## 5. P6-B Blob adapters

`mediaBlobStores.ts` 实现并连接三种可替换 backend：

- local：对象名只能是单层安全文件名，open 使用 no-follow，put 后复核字节数与 SHA-256，read 有硬上限，local sign 明确不支持；
- OSS：profile resolver 与低层 driver 均可注入，read/sign 可读 legacy profile，put/delete 必须有精确 profile id；默认 read 使用安全 signed URL、声明大小预检和 bounded stream；
- memory：完整支持 put/head/read/sign/delete，作为零网络 replacement fake；
- routed store：只按 reference backend 或明确 storageProfileId 路由，不拥有 publication/history/task。

Provider reference 的 local read 与 OSS sign 已改经 `MediaBlobStore`；publication 的数据库编排不由 blob port 承担。

证据：最终 P6-B tree 上 `m100 7/7 PASS`，覆盖 local/OSS/memory 全方法，snapshot `ed210754…384cb` unchanged；同一实现的 `m16 11/11 PASS` 覆盖可信本机 MP3 → Base64，snapshot `92443fd2…26deb` unchanged。两轮均发现120 specs/1046 tests，source374/TS330/JS44/ops28，架构172/569/91/baseline127，build PASS，异常0、4173 unchanged、temp cleaned、外部请求0。

## 6. P6-C Publication facade

`mediaPublicationService.ts` 是 Media-owned 公开边界，收口 reserve/stage/finalize/compensate/recover/delete intent，同时保留可注入工厂供 replacement drill 使用。上传、三类媒体删除、Canvas adoption、playlist、relay publication 与启动恢复调用方只依赖该 facade。

该 facade 不暴露 Generation task mutation。`generationResultCommit.ts` 继续直接加入既有 SQLite 事务完成 task/publication/history/event/journal 原子提交；这是刻意保留的内部安全边界，不把网络、OSS 或异步工作夹入事务。

证据：`m100 7/7`、`m88 36/36` 与八个受影响 spec `135/135 PASS`；source375/TS331/JS44/ops28，架构173/572/91，精确 baseline 127→121，snapshot `49a986ab…15cb8a` unchanged，异常0、4173 unchanged、temp cleaned、外部请求0。P6 达到 `AUTO_PASS`。

## 7. P7 Generation runtime 接线

`generationTasksApi.ts` 独占 Node HTTP、身份、body/query/status 与 JSON 映射。`providerGenerationTextRuntime.ts`、`providerGenerationRelayMediaRuntime.ts`、`providerGenerationArkVideoRuntime.ts`、`providerGenerationMurekaAudioRuntime.ts` 提供协议窄 seam；真实 relay/Ark/Mureka adapter 统一实现 `MediaGenerationProvider` 的 submit/inspect/recover/cancel/normalize。Generation application 仍独占持久 task、attempt、profile/credential lease、absolute deadline、providerTaskId、退款/重试证据与 publication 原子协调。

`m100 8/8` 证明 HTTP 隔离、sync/async fake 与真实 registry 组合可替换；P7 风险域 13 specs 初轮 194/196，两个失败分别定位 Text 恢复状态覆盖规范文案与 P5 后陈旧源码断言，最小修复后 m33+m40 22/22。其余 174 项无需重复，最终受影响域全部绿色；source381/TS337/JS44/ops28，架构179/587/104，baseline 121→120，外部请求、真实 Provider/OSS、4173 均为0/unchanged。P7 达到 `AUTO_PASS`。

## 8. P8 数据所有权接线

`accountTransactionCommands.ts`、`canvasTransactionCommands.ts`、`generationTransactionCommands.ts`、`mediaTransactionCommands.ts`、`modelTransactionCommands.ts`、`projectTransactionCommands.ts` 与 `templateTransactionCommands.ts` 只拥有各自表的同步 SQL command。调用方继续持有 `BEGIN IMMEDIATE / COMMIT / ROLLBACK`，通过 `executeTransactionScopedCommand` 把多域写加入同一连接；command 无权创建/结算事务，也不能返回 Promise。

账号删除仍分 durable intent、事务内转移/隐藏、事务外物理删除、最终事务清根与 audit；网络和 OSS 没有进入 SQLite transaction。m100 9/9 包含多 owner command 写到中途后注入失败并整体 rollback；P8 八个风险 spec 113/113。架构门 186 files、611 runtime、111 type、baseline 83，原26条跨域写例外全部删除，另有11条不再发生的读取例外删除；保留读取不是写授权。外部请求、真实 Provider/OSS、4173 均为0/unchanged。P8 达到 `AUTO_PASS`。

## 9. P9 分层节点注册表

`types/nodeVocabulary.ts` 只提供纯数据 ID 与类型；`CanvasNodeRegistry` 只拥有 React Flow renderer，`GenerationCapabilityRegistry` 只拥有服务端可生成 capability，`PersistedNodeSchemaRegistry` 只拥有声明了节点类型时的持久化校验。模板从同一 vocabulary 取得允许类型，但不把 renderer、executor、Provider 或模板对象塞进共享 descriptor。

三个 registry 可独立构造和登记测试节点：m100 分别加入 canvas-only、generation-only、persisted-only 节点，并证明其余层不可见。现有无 `type` 的最小持久化文档继续按既有兼容合同接受；一旦文档声明 `type`，则必须命中 persisted registry 并通过对应校验。`probe` 不进入模板类型。

证据：`m100 10/10`、`m22 37/37`、`m71 14/14`、修复兼容边界后的 `m85 26/26`；发现120 specs/1049 tests，source392/TS348/JS44/ops28，架构190/621/118/baseline83，build PASS，最终失败/跳过/重试/blocked/reportErrors均0，snapshot `a491ce42…208c` unchanged，4173 unchanged，临时目录清理，外部请求0。P9 达到 `AUTO_PASS`。

## 10. P10 Composition root

`applicationComposition.ts` 只导入六个公开 application/runtime API，由这里完成 Media reference store、四类 Provider runtime、Generation emergency-stop policy 和 auth legacy Provider migration 的一次性装配。Vite 只消费冻结的组合面；Generation readiness SQL 已移入 Generation-owned query adapter，组合根不持有业务 SQL。

旧 auth dynamic import 反向装配、Generation 顶层 Provider/Media 注册、Vite internal 直连与无调用方 `mediaProviderRequest` 已删除。实时架构图无 runtime cycle，baseline 83→76，没有新增例外。最终 `m100 11/11` 与 m5/m11/m14/m57/m81/m93 `97/97 PASS`；source400/TS356/JS44/ops28，架构198/627/119/baseline76，build PASS，snapshot `24e138cd…a7299ca` unchanged，4173 unchanged，外部请求0。P10 达到 `AUTO_PASS`。
