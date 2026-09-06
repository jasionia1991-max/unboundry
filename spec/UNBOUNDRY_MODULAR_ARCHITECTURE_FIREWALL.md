> **2026-09-06 当前结构核对：** 模块端口和架构门已存在于已发布v0.7.14；本次静态图298应用文件、1039 runtime/274 type边、88登记例外（73跨域SQL、12internal、3Provider/Storage），新增/失效/过期例外0、runtime SCC0。历史P1/D3计数与INTEGRATION_RECHECK不是当前集成状态；不把静态门等同于所有调用语义或生产验收。详见 [查阅记录](PROJECT_DOCUMENTATION_AUDIT_2026-09-06.md)。

# Unboundry TypeScript 架构防火墙

状态：`IMPLEMENTED / HISTORICAL_AUTO_PASS / INTEGRATION_RECHECK_IN_PROGRESS`

## 1. 目标与边界

本闸门用 TypeScript Compiler API 解析真实模块图，不用正则猜测 import。它只阻止新的非法依赖和未登记跨域 SQL，不在 P1 修改业务代码、schema 或产品语义。

实现使用当前锁定的 TypeScript `7.0.2` 所提供的 `typescript/unstable/sync` Compiler API 和 `typescript/unstable/ast` AST API。路径别名和模块解析由 compiler/checker 完成，分析器不自行拼接文件后缀。

## 2. 可执行合同

- 入口：`scripts/check-architecture.mjs`；配置：`scripts/architecture-boundaries.json`。
- CLI 直接以当前 checkout 根和显式 Node/npm 工具链运行，不依赖固定 worktree 路径或分支身份脚本。
- 识别普通 import、`import type`、`import { type X }`、re-export、dynamic import 和 import-equals。
- 每条边记录 `type` 或 `runtime`；运行时 SCC 只使用 runtime 边。
- Provider→Storage、Media→Generation 和他域 internal 禁止同时适用于 type/runtime 边：具体实现类型泄漏也会锁死调用方；只有 runtime-cycle 规则排除 type-only 边。
- 阻止 `UI_SERVER`、`CROSS_DOMAIN_INTERNAL`、`PROVIDER_STORAGE`、`MEDIA_GENERATION_WRITE`、`CROSS_DOMAIN_SQL`、`UNCLASSIFIED_SQL`、`RUNTIME_CYCLE`；新文件不能靠“未分类”逃过 SQL owner 闸门。
- baseline 是精确 fingerprint 集合，每组必须有 owner/reason/expiry；新违规、过期记录、重复记录和已消失但未删除的 stale 记录均非零退出。
- `run-safe-tests.mjs run/full` 在快照与产品测试前执行实时架构闸门；负向夹具在隔离快照的 source validation 内执行。
- 当前平铺 `server/` 没有通用的 `internal/` 目录语义；配置只把已确认为具体实现的 generation/media/provider/canvas 目标列为 internal。P2–P10 建立新模块目录时必须同批扩展该精确目标表，不得把该限制冒充为当前所有平铺文件的可见性证明。
- SQL 闸门解析已登记业务域中静态 string/template SQL 对已登记业务表的 read/write；它不是 SQLite 运行时追踪器。P8 仍需用 transaction failure injection 证明原子性，不得只凭静态闸门宣称数据所有权完成。

## 3. P1 冻结基线

P1 开始 HEAD `9b9ba4b6cf680a19137d8d35027c3b4a8feae08b` 上共解析 160 个应用 TypeScript/TSX 文件、556 条 runtime 边和 71 条 type 边。冻结例外共 131 条：

| 类别 | 数量 | 后续 owner |
|---|---:|---|
| 他域 internal import | 24 | P2–P10 对应边界迁移 |
| 跨域 SQL read | 72 | P8 owner query |
| 未分类 SQL read | 1 | P10 composition-root query port |
| 跨域 SQL write | 26 | P8 transaction-scoped command |
| Provider→Storage 具体实现 | 7 | P6 三层边界 |
| runtime SCC | 1 | P2–P10 分阶段缩减 |

Compiler API 还发现一个由 16 个 server 文件组成的既有 runtime SCC，其中包含 `auth.ts` 和 `generationSafety.ts` 的 dynamic import。这纠正了旧静态扫描“反向边均为 type-only”的不完整结论。P1 不为消除循环而扩大改造；它只冻结这一个精确 SCC，任何新 SCC 或 SCC 成员变化均立即失败。

## 4. 缩减规则

1. P2–P10 迁移一条旧边或 SQL 后，同一批必须删除对应 fingerprint；否则 stale baseline 会失败。
2. 不得用通配符、目录免检或永不过期的记录绕过闸门。
3. 新公开 contract/port 应放在配置允许的 owner 边界；不应把新 contract 加入 internal baseline。
4. 数据所有权迁移必须保留同一 SQLite transaction，闸门通过不代表可以拆散原子事务。

## 5. P1 验收边界

安全定向命令为 `PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec fixture-production`。在开始 HEAD `9b9ba4b6` 加 P1 dirty tree、Node 22.23.1/npm 10.9.8 上退出 0：10/10 架构夹具、source coverage 361 files（TypeScript 317/317、JavaScript 44/44、operational 28）、production build 与 `fixture-production` 1/1 均通过；发现 119 specs/1038 tests，仅执行 1 个产品测试。源码快照与 4173 listener 均未变化。

夹具覆盖：类型专用导入和路径别名合法；普通/dynamic UI→server、他域 internal、Provider→Storage、Media→Generation、跨域 SQL read/write、未分类 SQL、runtime cycle 必须失败；type-only cycle 必须合法；baseline 精确匹配、stale 与元数据失效必须被检出。

本阶段没有运行 full，没有修改产品代码、schema、data 或 version，没有访问真实 Provider、OSS、SSH 或生产。

上文 P1 数字是离线施工历史证据。主线集成候选已移除 identity 前置依赖；D3 已以 Node `22.23.1` 重新执行 main-safe CLI，结果为 198 source files、627 runtime edges、119 type edges、76条精确 baseline，new/stale/invalid 均为0，exit 0。
