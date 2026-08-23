# Unboundry 第一施工批：同步文字Provider Port验收矩阵

更新日期：2026-08-21
状态：`PRODUCTION_PUBLISHED / CURRENT_RELEASE_INHERITED / ORIGINAL_AUTO_PASS_EVIDENCE_PRESERVED`
关联路线图：`spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md`

当前说明：本矩阵记录第一批施工的自动证据，不改写当时未执行真实 Provider/生产的事实；该代码后来随 v0.6.28 发布，并持续包含在当前 v0.6.33 生产版本中。当前线上版本和用户验收由 `spec/UNBOUNDRY_CURRENT_STATE.md` 与最新版本回执负责，本矩阵不再是待发布清单。

## 1. 本批目标

同步文字生成经过真实的Provider registry/port执行；通用Generation任务协调器不再按具体文字driver编排Provider协议，同时保持现有task、attempt、幂等、凭据租约、reconcile和错误语义不变。

本批不是：

- 新增真实Provider；
- 修改图片、视频、音频执行；
- 修改Canvas或Workflow；
- 修改Media publication或Storage；
- 修改SQLite schema；
- 运行真实Provider、OSS或生产验收。

## 2. 状态纪律

- `PLANNED`：已定义，未施工；
- `NOT_RUN`：已实现，当前证据未执行；
- `AUTO_PASS`：有命令、临时环境、退出码和零外部副作用证据；
- `BLOCKED`：真实阻断，必须附原因；
- `NOT_APPLICABLE`：经明确裁决不适用。

不得把代码审查或静态推断写成`AUTO_PASS`。

## 3. 架构验收

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| PORT-001 | P0 | 同步文字执行只能通过一个Provider registry/port入口 | import/call graph + 定向测试 | AUTO_PASS |
| PORT-002 | P0 | 通用task协调器不按具体文字driver调用adapter | 代码审查 + 反向测试 | AUTO_PASS |
| PORT-003 | P0 | registry可注入fake Provider，且不需要真实网络 | fake adapter测试 + 请求计数0 | AUTO_PASS |
| PORT-004 | P0 | Provider只返回规范化文字结果/usage，不修改task或Canvas | 类型与调用链审查 | AUTO_PASS |
| PORT-005 | P1 | 不为本批建立图片/视频/音频双轨架构 | diff范围审查 | AUTO_PASS |
| PORT-006 | P1 | 原`GenerationProvider`接口被实际采用或被明确收敛，不保留第二套假抽象 | 全仓引用检查 | AUTO_PASS |

## 4. 任务与付费安全验收

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| TASK-001 | P0 | 同一idempotency key不产生第二个task | m33/m57或新增直接断言 | AUTO_PASS |
| TASK-002 | P0 | 每个付费请求仍先记录provider boundary attempt | attempt顺序断言 | AUTO_PASS |
| TASK-003 | P0 | credential/profile lease释放时机不变 | m44并发测试 | AUTO_PASS |
| TASK-004 | P0 | 响应未知、超时和取消不盲目重复提交 | m33/m39/m57 | AUTO_PASS |
| TASK-005 | P0 | reconcile恢复已有任务时Provider POST=0 | fixture请求计数 | AUTO_PASS |
| TASK-006 | P0 | Provider结果只落到匹配的task/owner/model配置 | task断言 | AUTO_PASS |
| TASK-007 | P1 | 错误码和用户可见文字不发生无意漂移 | 现有错误fixture | AUTO_PASS |

## 5. 替换性验收

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| REPL-001 | P0 | fake文字Provider可完成submit并返回规范化结果 | 零网络单元测试 | AUTO_PASS |
| REPL-002 | P1 | 新增同能力fake Provider只新增adapter和registry登记 | 测试fixture diff审查 | AUTO_PASS |
| REPL-003 | P1 | Provider profile/credential解析仍由原owner完成 | 调用链审查 | AUTO_PASS |
| REPL-004 | P1 | Provider adapter不获得数据库连接或TaskStore | 类型/import规则 | AUTO_PASS |

## 6. 回归与范围验收

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| REG-001 | P0 | TypeScript noEmit通过 | Node22/npm10命令、退出码0 | AUTO_PASS |
| REG-002 | P0 | m33文字任务运行时通过 | safe runner、临时目录、动态端口 | AUTO_PASS |
| REG-003 | P0 | m39 Ark文字错误分类通过 | 同上 | AUTO_PASS |
| REG-004 | P0 | m44 Provider profile原子性通过 | 同上 | AUTO_PASS |
| REG-005 | P0 | m53 relay adapter文字路径通过 | 同上 | AUTO_PASS |
| REG-006 | P0 | m57 relay文字运行时通过 | 同上 | AUTO_PASS |
| REG-007 | P0 | 测试期间真实Provider/OSS请求为0 | 请求计数与环境审计 | AUTO_PASS |
| REG-008 | P0 | 4173 listener、仓库数据和受保护JSON不变 | 前后只读快照 | AUTO_PASS |
| REG-009 | P1 | 未修改Canvas、Workflow、Media、schema和生产配置 | diff allowlist | AUTO_PASS |

## 7. 当前证据

- 运行时：所有施工与验证命令显式使用Node `22.23.1`、npm `10.9.8`。
- 类型：`PATH=/Users/mymy/.local/bin:$PATH npx tsc --noEmit --pretty false`，退出码0，只运行一次。
- 定向测试：m33 `8/8`、m39 `3/3`、m44 `8/8`、m53 `23/23`、m57 `14/14`；failed、skipped、retries、blocked、reportErrors均为0。
- 测试隔离：安全runner为每份spec创建新临时目录和动态loopback端口；每次回执均显示4173 listener hash未变、测试快照unchanged。
- 零网络替换：m33 fake `TextGenerationProvider`经registry完成task，网络fetch计数0，provider-boundary attempt恰好1；缺少实现时在本地抛错且网络计数仍为0。
- 调用链：`executeTextTaskWithDependencies → TextProviderRegistry.generate → Ark/relay TextGenerationProvider → 规范化text/usage → Task complete`；任务协调器不再导入或调用Ark/relay文字submit函数。
- 范围：没有Canvas、Workflow、Media publication、schema、版本、生产配置、Provider profile解析或credential owner变化；没有真实Provider、付费生成、OSS、SSH或生产调用。
- 安全清单：新增1条registry测试后冻结发现数由1029更新为1030，并同步source-coverage行为目标hash；未运行默认`npm run verify`或full。
- 受保护文件：`spec/public-templates-director-split-revision.json`始终仅作为未跟踪文件名出现在Git状态中，未读取、修改、格式化、暂存或提交。

## 8. 完成闸门

本批只有同时满足以下条件才能写`COMPLETE`：

1. 所有P0不再是`PLANNED/NOT_RUN/BLOCKED`；
2. P1未完成项有明确不阻断证明；
3. Provider port成为同步文字执行唯一入口；
4. task、attempt、idempotency、reconcile和credential lease行为没有弱化；
5. 定向测试在Node22/npm10、新临时目录和动态端口下退出码0；
6. 真实Provider、OSS、生产、4173和真实数据均未触碰；
7. 受保护JSON未读取、未修改、未进入任何提交或artifact；
8. 主Agent完成调用链、数据安全和测试证据三类独立复核；
9. 文档与Checkpoint同步当前事实；
10. 没有把后续Storage、Canvas、Auth或Release路线图顺手并入本批。
