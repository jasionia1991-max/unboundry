# VIEW-005 密集画布性能证据回执

日期：2026-08-21
状态：`AUTO_PASS`
范围：精确98/171/200节点的视口虚拟化与拖拽、快速平移、缩放性能证据
边界：仅测试与证据；无产品代码、版本、tag、release或生产变更

## 1. Git与基线

- 仓库：`/Users/mymy/Documents/unboundry/app`
- 功能分支：`codex/view-005-dense-canvas-performance-2026-08-21`
- 会话起始HEAD：`c649300317429d9ef668e007fa28c0026a0118c1`
- 起始HEAD tree：`7ee468162985b040aefe1b5c4983814c17164920`
- 起始`origin/main`：`48cb6ee6eb8811c72912e7e2cebd1f0ca7ba16d4`
- 起始`origin/main` tree：`7ee468162985b040aefe1b5c4983814c17164920`，与起始HEAD tree一致
- 最终被测实现commit：`7d436b89e34a77b01b84de4e764d49044ba25fd2`
- 最终被测实现tree：`3e3bed64ccab8bc8328c63cbb32f12b04802d32c`
- 文档闭环commit是包含本回执的后续语义commit；commit对象不能在自身内容中硬编码自身SHA，精确值以Git历史、PR和最终回报为准。
- package版本：`0.6.30`，未变。

## 2. 实施范围

- `tests/m79-canvas-smoothness.spec.ts`：把旧60/200节点代表性案例替换为精确98/171/200三档；每档在真实drag/pan/zoom窗口中采集rAF帧、long task、挂载和视口内可见节点。
- `scripts/run-safe-tests.mjs`：允许本Goal功能分支并把冻结发现数从1037更新为1038。
- `scripts/source-coverage-manifest.json`：同步`run-safe-tests.mjs`行为目标SHA，保持source-coverage闸门闭合。
- 未修改任何`client/`、`server/`或其他产品实现文件。

## 3. 命令、环境与执行记录

正式命令：

```text
node scripts/run-safe-tests.mjs run --spec m79-canvas-smoothness
```

环境与隔离：

- macOS `sandbox-exec`安全闸门；Node `22.23.1`；npm `10.9.8`。
- m79使用生产构建/preview模式，测试根位于系统临时目录，数据、HOME、浏览器缓存与网络审计均位于该隔离根。
- 最终运行动态loopback端口：`44818/46953`；禁止端口`4173`未被使用。
- 最终运行临时根：`/private/var/folders/3f/ckfmzck51612dwqng3kcnyyr0000gn/T/unboundry-safe-suite-CitMeD`，结束时由safe runner清理。
- source/snapshot SHA-256：`12351f710df4c7a37492803fe533e35cf3176b3b07a86b5d71ac5ccaf5e22e1b`，前后一致；596个source files。
- 4173 listener SHA-256前后均为`24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244`。

执行节奏：

1. 第一次启动在任何产品spec执行前被source-coverage闸门拒绝：`scripts/run-safe-tests.mjs`已变更但三个行为目标`targetSha256`仍为旧值；exit code `1`，snapshot和4173 listener均不变，临时根已清理。
2. 只同步上述三个manifest hash后，按合同只复验同一m79命令；exit code `0`，`3/3 passed`，failed/skipped/retries/blocked/reportErrors均为0。
3. 没有运行full，没有运行m1，也没有重复任何已成功的产品测试。

## 4. 精确三档指标

共同阈值：long task（>=100ms）数量`0`；frame p95 `<=25ms`；max frame `<100ms`；dropped frames（>24ms）`<=5`。

| 节点档位 | 数据层 | normal zoom / mounted / visible | drag位移 | pan mounted / visible | fit zoom / mounted / visible | 帧数 / 时长 / FPS | p95 / max / dropped | >=100ms long task |
|---:|---:|---|---:|---|---|---|---|---:|
| 98 | 98 | 1 / 12 / 12 | 199.01px | 12→16 / 12→16 | 0.15 / 98 / 98 | 531 / 4459.1ms / 120 | 9.3ms / 25ms / 1 | 0 |
| 171 | 171 | 1 / 12 / 12 | 199.01px | 12→16 / 12→16 | 0.15 / 171 / 171 | 577 / 4874.8ms / 119 | 9.2ms / 25ms / 1 | 0 |
| 200 | 200 | 1 / 12 / 12 | 199.01px | 12→16 / 12→16 | 0.15 / 200 / 200 | 580 / 4891.6ms / 119 | 9.3ms / 17.6ms / 0 | 0 |

分阶段指标：

| 档位 | drag：frames / p95 / max / dropped / visibleMin | pan：frames / p95 / max / dropped / visibleMin | zoom：frames / p95 / max / dropped / visibleMin |
|---:|---|---|---|
| 98 | 336 / 9.3 / 25 / 1 / 12 | 135 / 9.2 / 9.3 / 0 / 12 | 60 / 8.7 / 9.4 / 0 / 18 |
| 171 | 382 / 9.2 / 25 / 1 / 12 | 133 / 9.2 / 9.3 / 0 / 12 | 62 / 9.3 / 16.7 / 0 / 20 |
| 200 | 385 / 9.3 / 16.8 / 0 / 12 | 134 / 9.1 / 9.4 / 0 / 12 | 61 / 9.2 / 17.6 / 0 / 20 |

所有时长单位均为毫秒。FPS为信息性指标，不参与通过判定。

## 5. 虚拟化、移动集合与无空白证据

- 正常zoom=1时，三档均只有12个mounted DOM节点，满足`0 < mounted < N`，直接证明`onlyRenderVisibleElements`实际生效。
- 三档真实拖拽均移动约199.01px；真实性由拖拽前后节点bounding box位移断言保证。
- 三档快速平移均把viewport Y从`0`移动到约`-432`；mounted ID集合和视口内visible ID集合均发生变化。
- 三档平移前visible IDs相同：`smooth-node-1..4`、`smooth-node-21..24`、`smooth-node-41..44`。
- 三档平移后visible IDs相同：`smooth-node-21..24`、`smooth-node-41..44`、`smooth-node-61..64`、`smooth-node-81..84`。
- drag、pan、zoom每个rAF采样帧的mounted与viewport-intersecting visible节点最小值均大于0，没有空白视口采样。
- fit后zoom=0.15时，全部节点确实位于视口并分别挂载/可见98、171、200；该合法全挂载场景没有被误判为虚拟化失效。

## 6. 错误、副作用与清理

- 三档`pageErrors=[]`、`consoleErrors=[]`。
- 三档`externalRequests=[]`；safe-test和离线网络闸门同时阻断非loopback请求。
- 三档`forbiddenApiRequests=[]`，没有generation、Provider、OSS、media、asset、upload、file或relay写请求。
- 没有真实Provider调用、付费请求、OSS写入、生产访问或生产数据读写。
- 每档都在`finally`删除本次canvas/project；只有清理成功后才输出`cleanup="passed"`指标，清理失败会使测试失败。
- 临时账号和SQLite数据只存在于safe runner fresh系统临时根，整套运行结束后临时根已清理。

## 7. 审查与残余风险

- 实现子代理只修改m79且未运行正式测试；主代理逐项修正浏览器上下文函数序列化、真实drag证明、visible ID集合、尾部PerformanceObserver记录与cleanup后输出。
- 基准只读审计：无blocker。审计确认三档、Playwright序列化、TypeScript形态、真实交互、虚拟化/可见集合、cleanup与零外部副作用断言成立。
- 独立最终只读review（2026-08-22）：无blocker；确认三档测试、指标回执、Git范围、状态边界和受保护文件边界一致，补入本结论后实现与文档闭环均可合并。review未重复运行测试。
- 残余风险：rAF采样器每帧执行DOM几何读取，会给结果加入采样器自身开销；因此本回执是“包含采样器开销”的保守浏览器证据，不等于所有硬件上的普适基准。FPS以采样帧数而非区间数估算，有约一帧信息性偏差，但不参与阈值断言。

## 8. 状态边界

- `VIEW-005: NOT_RUN -> AUTO_PASS`。
- v0.6.30既有`PRODUCTION_PUBLISHED_USER_PASS / USER_PASS`保持不变。
- 本次没有新的用户主观验收，不产生`USER_PASS`、`USER_RECHECK`或`AGENT_PAGE_PASS`的新结论。
- 未升级版本，未创建tag或release，未访问、修改或发布生产。
