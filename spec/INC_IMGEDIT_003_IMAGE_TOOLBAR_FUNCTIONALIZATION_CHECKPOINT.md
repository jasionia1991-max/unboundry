# INC-IMGEDIT-003 图片工具栏剩余能力施工 Checkpoint

## 0. 当前断点

- 更新时间：2026-08-23 19:29:05 +0800
- 状态：`GOAL_ACTIVE / D2_AUTO_PASS`
- 当前阶段：`D2 最小图片工具应用层 / AUTO_PASS`
- 唯一允许的下一阶段：`D3 颜色标记、调整像素、快速分割`
- 当前仓库：`/Users/mymy/Documents/unboundry-inc-imgedit-003-v0.6.34-2026-08-23`
- 记录时分支：`codex/inc-imgedit-003-v0.6.34-2026-08-23`
- 记录时 HEAD：`6a1606cdafd3b38c1333ca6c46baecfae690bd35`
- 记录时 `origin/main`：`14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- package：`0.6.33`
- 生产：`v0.6.33 / schema39 / PRODUCTION_PUBLISHED_USER_PASS / USER_PASS`
- 新版本：`v0.6.34 / VERSION_GATE_VALID`
- 候选：无
- 本轮代码施工：未开始
- 本轮验证：`git diff --check` 退出 0；定向 safe runner 尝试在产品 spec 执行前被 main 既有 ignored `backups/` 文件隔离负控以 `EISDIR` 阻断，0 个产品测试执行，不能记为自动 PASS；不删除或移动该目录
- 真实 Provider/付费请求：0/8
- 真实 OSS 测试对象：0
- GitHub/SSH/生产操作：0

## 1. 权威恢复顺序

每次新 Session、上下文压缩、换 Agent 或执行中断后，必须按顺序完整阅读：

1. `/Users/mymy/Documents/unboundry/app/AGENTS.md`
2. `/Users/mymy/Documents/unboundry/app/上线规矩.md`
3. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_CURRENT_STATE.md`
4. `/Users/mymy/Documents/unboundry/app/README.md`
5. `/Users/mymy/Documents/unboundry/app/TASKS.md` 顶部当前区块
6. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_PLAN_2026-08-23.md`
7. 本 Checkpoint
8. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 顶部与 `IMGEDIT-001～020`
9. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md`
10. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_CHECKPOINT.md`
11. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_002_CROP_LOADING_EXPERIENCE_PLAN_2026-08-23.md`
12. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_GOAL_PROMPT_2026-08-23.md`

如果根 `AGENTS.md` 要求额外权威文件，继续完整阅读，不得用本清单缩减项目规则。

## 2. 恢复后只读核对

```bash
pwd
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin main --prune
git rev-parse origin/main
node --version
npm --version
node -p "require('./package.json').version"
```

随后比较实际 branch、HEAD、工作树、package、schema、当前阶段、外部请求计数和测试证据。任何冲突先更新真实断点，不得凭记忆继续。

## 3. 文档驱动纪律

- 同时最多一个 D 阶段为 `IN_PROGRESS`；
- 开始阶段前先把本文件的阶段改为 `IN_PROGRESS`；
- 完成阶段后先回写本文件、验收矩阵和 TASKS，再进入下一阶段；
- CURRENT_STATE 只在版本、候选、GitHub或生产事实改变时更新；
- 不允许代码已经跨入下一阶段而 Checkpoint 仍停在上一阶段；
- 每次更新必须记录真实命令、结果和退出码；
- 树未变化时复用有效测试证据，不为安心重复 full；
- 聊天、内部记忆和压缩摘要不是状态依据；
- 每次恢复只从“唯一下一动作”继续。

## 4. 阶段总表

| 阶段 | 内容 | 状态 |
|---|---|---|
| D0 | 实时基线和文档恢复 | AUTO_PASS |
| D1 | 合同、矩阵和架构门 | AUTO_PASS |
| D2 | 最小图片工具应用层 | AUTO_PASS |
| D3 | 颜色标记、调整像素、快速分割 | NOT_STARTED |
| D4 | 标注 | NOT_STARTED |
| D5 | 个人素材库 | NOT_STARTED |
| D6 | 模型和处理引擎调查 | NOT_STARTED |
| D7 | 多角度 | NOT_STARTED |
| D8 | 遮罩基础与重绘 | NOT_STARTED |
| D9 | 扩图与擦除 | NOT_STARTED |
| D10 | 增强与主体抠图 | NOT_STARTED |
| D11 | Seedance 素材校验 | NOT_STARTED |
| D12 | 候选冻结和统一验证 | NOT_STARTED |
| D13 | GitHub和生产发布 | NOT_STARTED / AUTH_GATED |

## 5. 验收条目状态

历史 `IMGEDIT-001～009` 保持原状态，不改写历史证据。新功能条目初始状态：

| 条目 | 内容 | 状态 |
|---|---|---|
| IMGEDIT-010 | 图片工具应用边界、状态和操作启用 | PARTIAL / APPLICATION_LAYER_AUTO_PASS |
| IMGEDIT-011 | 颜色标记 | NOT_STARTED |
| IMGEDIT-012 | 个人素材库 | NOT_STARTED |
| IMGEDIT-013 | 调整像素 | NOT_STARTED |
| IMGEDIT-014 | 快速分割 | NOT_STARTED |
| IMGEDIT-015 | 标注与导出 | NOT_STARTED |
| IMGEDIT-016 | 多角度真实生成 | NOT_STARTED |
| IMGEDIT-017 | 重绘真实生成 | NOT_STARTED |
| IMGEDIT-018 | 扩图与擦除 | NOT_STARTED |
| IMGEDIT-019 | 增强与主体抠图 | NOT_STARTED |
| IMGEDIT-020 | Seedance 素材校验 | NOT_STARTED |

## 6. 当前工作树保护

落档开始时已有多份用户文档修改和两个未跟踪文件。本任务只窄改图片工具计划、Checkpoint、Goal 提示词、TASKS 当前区块、CURRENT_STATE 当前区块和验收矩阵图片工具行；所有其他修改继续视为用户已有工作。

受保护的未跟踪文件：`spec/public-templates-director-split-revision.json`。永久禁止读取、修改、格式化、暂存、提交、删除或改名。禁止 `git reset --hard`、`git clean` 和覆盖用户数据。

## 7. 版本、Git和发布门

- 本 Goal 的目标版本由用户明确确认为 `v0.6.34`，`VERSION_GATE_VALID`；`v0.6.33` 不复用；
- 用户已独立明确“按 v0.6.34 上线吧”，`RELEASE_GATE_VALID`；
- 只有 D12 冻结与统一验证通过后才可进入 D13，版本与发布门有效不等于提前获得发布成功结论；
- 本次版本号和发布授权只覆盖 INC-IMGEDIT-003 当前合同，不扩大到历史任务或暂停项；
- 自动测试、真实技术冒烟、生产技术通过和 `USER_PASS` 必须分开。

## 8. 真实请求预算账本

| 操作 | 成功上限 | 已用 | 备注 |
|---|---:|---:|---|
| 多角度 | 1 | 0 | fake先通过 |
| 重绘 | 1 | 0 | fake先通过 |
| 扩图 | 1 | 0 | fake先通过 |
| 擦除 | 1 | 0 | fake先通过 |
| 创意增强 | 1 | 0 | fake先通过 |
| 保守增强 | 1 | 0 | 仅付费引擎计入 |
| 主体抠图 | 1 | 0 | 仅付费引擎计入 |
| 兼容复核 | 1 | 0 | 有明确理由才用 |
| 合计 | 8 | 0 | 无法判断计费时禁止重试 |

## 9. 阶段更新模板

每次阶段切换在本文件追加：

```text
时间：
阶段：D?
状态：IN_PROGRESS / AUTO_PASS / BLOCKED
branch / HEAD / origin-main：
工作树摘要：
产品文件：
测试文件：
文档文件：
package / schema / candidate：
外部请求和付费预算：
测试命令、环境、结果、退出码：
架构与数据风险：
设计偏差：
阻断：
回滚点：
唯一下一动作：
```

## 10. 当前唯一下一动作

进入 D3：先把 D3 标为 `IN_PROGRESS`，实现颜色标记、调整像素和快速分割；本地确定性处理必须零 Generation、零 Provider、零真实 OSS。

## 12. D0 实时基线和文档恢复

- 时间：2026-08-23 19:15:37 +0800
- 阶段：`D0`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：写入前为 `main` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：启动分支 `6a1606c` 已显式提交 18 个治理文档；受保护 JSON 未暂存且只保留在原工作树；隔离 worktree 创建后为 clean，产品代码差异为 0
- 产品文件：无
- 测试文件：无；发现现有 `m2-image-node` 已覆盖多角度占位参数与重绘本地遮罩取消语义，后续只扩展不把占位证据冒充真实能力
- 文档文件：现有 v0.6.33 状态对齐文档与 INC-IMGEDIT-003 三份合同文档；受保护 JSON 不在施工范围
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；OSS 测试对象 `0`；本阶段只有生产只读 GET 探针，无写请求
- 测试命令、环境、结果、退出码：Node `22.23.1`、npm `10.9.8`；D0 为文档和只读恢复阶段，未执行产品测试；`git diff --cached --check` 退出 0；生产 `/api/version`、`/api/health/live`、`/api/health/ready` 三个只读 GET 均退出 0，返回 `0.6.33 / live / ready active schema39`
- 架构与数据风险：现有 Provider 支持 Ark、OpenRouter、OpenAI-compatible 和 multi-protocol relay，图片 relay 已有 `generation/edit` 端点边界；Storage 已有 local/OSS `MediaBlobStore`、owner-scoped 读取、profile 路由与有界 PNG 校验。尚无 INC-IMGEDIT-003 操作级权威状态，也不能把现有普通 edit 直接宣称为 mask/outpaint/erase/Alpha 能力
- 设计偏差：无；已采用“启动分支承接现有文档 → 干净隔离 worktree 继续”的恢复路径，未读取任何 profile 密钥或受保护文件
- 阻断：无；分支、版本门、发布门、生产探针和工具链均有效
- 回滚点：`origin/main@14777b5dc5cf48de8b21b6eb3ee27da45070b537` 与文档启动提交 `6a1606cdafd3b38c1333ca6c46baecfae690bd35`；原工作树和受保护文件保持原位
- 唯一下一动作：进入 D1，先在本文件把 D1 标为 `IN_PROGRESS`

## 13. D1 合同、矩阵和架构门

- 时间：2026-08-23 19:22:23 +0800
- 阶段：`D1`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / 阶段起点 `43ccd32fdf674724d96dcc84f6739c101bac05f2` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：新增共享图片工具合同；扩展架构域与 Library 未来表所有权；扩展 m100 两个合同测试；安全测试总清单由 1050 精确同步为 1052，source coverage manifest 同步
- 产品文件：`types/imageTools.ts`、`scripts/architecture-boundaries.json`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`scripts/run-safe-tests.mjs`、`scripts/source-coverage-manifest.json`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本仍为 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；测试网络只允许动态 loopback
- 测试命令、环境、结果、退出码：Node `22.23.1`、npm `10.9.8`；`node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts` 首次在 TypeScript 收窄处失败、修复后发现精确测试清单需同步为 1052；同步 runner 与 source coverage manifest 后最小复验退出 0，m100 `13/13 PASS`，架构 `76` 个既有例外且新增例外 `0`，TypeScript/build/source coverage/网络门均通过，source/snapshot `028ad751...` 不变，4173 listener 不变
- 架构与数据风险：operation、result、capability、状态、失败码、owner/revision/run/task 身份均已冻结；input/mask/annotation 有界，Library 表预分配独立 owner。尚未实现权威服务或 Dispatcher，因此 `IMGEDIT-010～020` 仍为 `NOT_STARTED`
- 设计偏差：没有新建 m101 文件，两个合同测试并入现有模块化端口 m100；为维持安全 runner 的精确清单，同步 1052 与三个行为目标 SHA
- 阻断：无
- 回滚点：阶段起点 `43ccd32fdf674724d96dcc84f6739c101bac05f2`；本阶段无 schema、Provider、OSS 或生产写入
- 唯一下一动作：进入 D2，先把 D2 标为 `IN_PROGRESS`

## 14. D2 最小图片工具应用层

- 时间：2026-08-23 19:29:05 +0800
- 阶段：`D2`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / 阶段起点 `6cbd2e2bdf675853ae14c96f44bf2eac979f742b` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：新增轻量 Dispatcher、派生图片 use case、viewer use cases 和对既有 single-node Generation lifecycle 的薄适配；CanvasGraphCommandPort 增加 image-tool 原子 fence；裁剪改为媒体登记后一次原子提交 node+edge，失败精确 discard
- 产品文件：`client/src/imageTools/imageToolDispatcher.ts`、`derivedImageToolUseCase.ts`、`viewerImageToolUseCases.ts`、`generationImageToolUseCase.ts`、`client/src/canvas/canvasPorts.ts`、`client/src/canvas/ImageNode.tsx`
- 测试文件：`tests/m100-modular-ports.spec.ts`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；m100 fake media/fake Generation，m2 仅临时本地媒体和动态 loopback
- 测试命令、环境、结果、退出码：Node `22.23.1`、npm `10.9.8`；m100 首轮 TypeScript 因测试 fake 未收窄 union 失败，修复后 `node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts` 退出 0、`13/13 PASS`；`node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts` 退出 0、`10/10 PASS`；最终 m100 最小复验在 Generation 薄适配加入后仍 `13/13 PASS`。各次架构新增例外 0，TypeScript/build/source coverage/网络门通过；最终 source/snapshot `8ed05373...` 不变，4173 listener 不变
- 架构与数据风险：ImageNode 未新增 fetch、Provider 分支或轮询；Dispatcher 只做 operation→use case 路由；派生提交使用 revision+sourceAssetId+runId+ownershipKey fence；Generation 复用现有 SingleNodeGenerationLifecycle，没有第二套任务系统。操作级服务端权威状态将在 D6 完成，因此 IMGEDIT-010 暂记 `PARTIAL`
- 设计偏差：把原裁剪 node 与 edge 两步 React 写入收口为 CanvasGraphCommandPort 一次提交；下载和全屏通过 viewer use cases，行为和 UI 不变
- 阻断：无
- 回滚点：阶段起点 `6cbd2e2bdf675853ae14c96f44bf2eac979f742b`；本阶段无 schema、Provider、OSS 或生产写入
- 唯一下一动作：进入 D3，先把 D3 标为 `IN_PROGRESS`

## 11. PRE_GOAL 文档落档记录

- 日期：2026-08-23
- 范围：只落主方案、Checkpoint、Goal 提示词，并同步 TASKS、CURRENT_STATE 和验收矩阵；产品代码、测试、schema、package、Provider、OSS、GitHub和生产均未改变
- Git：`main` / HEAD 与 `origin/main` 均为 `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 静态验证：`git diff --check`，退出码 0
- 定向测试尝试：Node `22.23.1` / npm `10.9.8`，`node scripts/run-safe-tests.mjs run --spec tests/m38-generation-runtime-incidents.spec.ts`，退出码 1；safe preflight 和架构检查先通过，随后在运行 m38 前因 main 既有 ignored `backups/` 目录的 direct-write 负控返回 `EISDIR` 而停止；产品测试执行数 0，source snapshot 与 4173 listener 均未变化
- 结论：这是既有测试隔离环境阻断，不是文档断言失败；本轮不绕过 safe runner、不删除用户备份、不重复 full，也不把本次尝试写成测试 PASS
- 受保护文件：`spec/public-templates-director-split-revision.json` 保持未读、未改、未暂存
- 唯一下一动作：仍是新 Goal 的 D0；在安全隔离 worktree 先恢复实时基线，再按风险执行当阶段最小测试
