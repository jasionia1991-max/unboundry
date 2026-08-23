# INC-IMGEDIT-003 图片工具栏剩余能力施工 Checkpoint

## 0. 当前断点

- 更新时间：2026-08-23 21:30:34 +0800
- 状态：`GOAL_ACTIVE / D7_TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PENDING_D13`
- 当前阶段：`D7 多角度 / TARGETED_AUTO_PASS`
- 唯一允许的下一动作：提交 D7 本地 checkpoint commit；随后先把 D8 标为 `IN_PROGRESS`，再施工遮罩基础与重绘；真实 Provider 冒烟因合同把 SSH/生产运行限定在 D12 后，统一留到 D13 精确候选的隔离 staging/生产技术门，不得用 v0.6.33 通用图片生成冒充 D7 证据
- 当前仓库：`/Users/mymy/Documents/unboundry-inc-imgedit-003-v0.6.34-2026-08-23`
- 记录时分支：`codex/inc-imgedit-003-v0.6.34-2026-08-23`
- 记录时 HEAD：`7a161da9f2cb862fc2e7e6898c5b51de56335258`
- 记录时 `origin/main`：`14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- package：`0.6.33`
- 生产：`v0.6.33 / schema39 / PRODUCTION_PUBLISHED_USER_PASS / USER_PASS`
- 新版本：`v0.6.34 / VERSION_GATE_VALID`
- 候选：无
- 本轮代码施工：D7 已把水平/垂直/距离/广角结构化参数、成本与过期能力门、来源/参数/model/operation ownership、派生占位节点和来源边接入既有 SingleNodeGenerationLifecycle；付费 admission 前强制保存占位，持久 task 绑定后复用既有恢复、取消、重试、终态回填和重新挂接，不新增轮询或第二套任务系统。原图不覆盖；服务端 capability 现返回内部 model id，Provider 判定仍只看独立 provider model id
- 本轮验证：安全定向 m100 `13/13`、m2 `10/10 PASS`；fake task 精确为一次，Canvas 持久化包含来源边、结构化参数、operation/source/task identity，Provider 请求 0。合并复验中 D7 用例已通过，后续两个既有 m2 用例因测试删除共享 fixture 后未恢复而失败；增加 `afterEach` 清理后只复验 m2 并 `10/10 PASS`。架构既有例外 76、新增 0，TypeScript/build/source coverage/离线网络门通过；未运行 full
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
| D3 | 颜色标记、调整像素、快速分割 | AUTO_PASS |
| D4 | 标注 | AUTO_PASS |
| D5 | 个人素材库 | AUTO_PASS |
| D6 | 模型和处理引擎调查 | AUTO_PASS |
| D7 | 多角度 | TARGETED_AUTO_PASS / REAL_SMOKE_PENDING_D13 |
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
| IMGEDIT-010 | 图片工具应用边界、状态和操作启用 | AUTO_PASS |
| IMGEDIT-011 | 颜色标记 | AUTO_PASS |
| IMGEDIT-012 | 个人素材库 | AUTO_PASS |
| IMGEDIT-013 | 调整像素 | AUTO_PASS |
| IMGEDIT-014 | 快速分割 | AUTO_PASS |
| IMGEDIT-015 | 标注与导出 | AUTO_PASS |
| IMGEDIT-016 | 多角度真实生成 | TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PENDING_D13 / USER_QUALITY_RECHECK |
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

提交 D7 本地 checkpoint commit；随后先把 D8 标为 `IN_PROGRESS`，再施工遮罩基础与重绘。真实 Provider 冒烟统一留到 D13 的精确候选环境，不提前 SSH，也不拿当前生产 v0.6.33 的通用图片任务冒充新功能证据。

## 20. D7 多角度完成记录

- 时间：2026-08-23 21:30:34 +0800
- 阶段：`D7`
- 状态：`TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PENDING_D13 / USER_QUALITY_RECHECK`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / 阶段起点 `7a161da9f2cb862fc2e7e6898c5b51de56335258` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D7 未提交树已完成结构化多角度任务、内部 model identity 修正、占位持久屏障、task binding 和 fake UI/端口证据；未进入 D8
- 产品文件：`types/imageTools.ts`、`client/src/canvas/ProbeNode.tsx`、`ImageNode.tsx`、`client/src/generation/imageGenerationAdapter.ts`、`singleNodeGenerationLifecycle.ts`、`client/src/imageTools/generationImageToolUseCase.ts`、`multiAngleImageToolUseCase.ts`、`client/src/styles.css`、`server/generationApplicationApi.ts`、`server/imageToolCapabilityRegistry.ts`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`tests/m2-image-node.spec.ts`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：多角度 `0/1`，总计 `0/8`；真实 OSS `0`；GitHub/SSH/生产写入 `0`。真实请求仍未消费
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 `node scripts/run-safe-tests.mjs run --spec ...`。m100+m2 合并执行时 m100 `13/13` 且新增多角度用例通过，m2 后续两个既有用例因测试删除共享 fixture 后未恢复而形成 `8/10`；加入 multi-angle 专属 `afterEach` 清理后只复验受影响 m2，退出 0、`10/10 PASS`，source/snapshot `1696804d…b79b`，4173 listener 不变。未运行 full
- 架构与数据风险：结构化参数、唯一 operationId、source asset/node、account/canvas、model/参数、prompt/质量共同构成 ownership；任何来源或语义变化均 fail-closed。派生占位先通过 Canvas fence 创建并保存，再允许持久 task admission；task 绑定后现有 ImageNode lifecycle 继续拥有恢复、取消、重试、终态 Media 回填和已付费结果重新挂接。ImageNode 没有新增 fetch、Provider 分支或轮询；通用 adapter 从组件抽到 generation 模块以避免复制
- 设计偏差：主方案原写 D7 fake 后立即真实冒烟，但 Goal 同时明确 GitHub/SSH/生产运行须等 D12。当前本机没有可安全使用且不读取禁区数据的专用真实 profile；因此不提前 SSH、不读取 `app/data`、不拿 v0.6.33 的普通图片生成冒充新代码证据。所有生成式操作的真实技术冒烟统一放到 D13 精确 v0.6.34 候选的隔离 staging/生产门执行，届时仍逐项受预算和未知计费禁止重试约束
- 阻断：无；这是授权顺序下的证据延后，不是能力缺失。自动证据不等于真实 Provider、生产或用户质量验收
- 回滚点：D6 提交 `7a161da9f2cb862fc2e7e6898c5b51de56335258`；本阶段无 schema、Provider、真实 OSS、GitHub 或生产写入
- 唯一下一动作：提交 D7 本地 checkpoint commit；随后进入 D8 前先把 D8 标为 `IN_PROGRESS`

## 19. D7 多角度

- 时间：2026-08-23 21:01:29 +0800
- 阶段：`D7`
- 状态：`IN_PROGRESS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `7a161da9f2cb862fc2e7e6898c5b51de56335258` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D6 已提交为 `7a161da`，提交后工作树 clean；D7 仅写入阶段开始断点，尚无 D7 产品或测试改动
- 产品文件：待复用 `generationImageToolUseCase`、`singleNodeGenerationLifecycle` 和现有多角度面板后按最小范围冻结
- 测试文件：先扩既有 m100/m2 fake 和零请求证据，再决定真实技术冒烟最小路径
- 文档文件：本 Checkpoint
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：多角度 `0/1`，总计 `0/8`；真实 OSS `0`；GitHub/SSH/生产写入 `0`。fake 与零请求门通过前禁止真实提交
- 测试命令、环境、结果、退出码：复用未变 D6 commit 的 m100+m2 `23/23 PASS` 与 m20 `1/1 PASS`；D7 尚未运行测试，不重复 full
- 架构与数据风险：多角度必须进入现有持久任务、attempt、恢复、幂等、成本和 ownership 栅栏；结构化水平/垂直/距离/广角不得只拼一段无身份提示词后伪装成独立能力；结果保留原图并生成派生节点
- 设计偏差：待施工
- 阻断：无；当前生产能力快照已确认 GPT Image 2 编辑协议可用，但真实请求必须等 fake/零请求通过且付费状态可判断
- 回滚点：D6 提交 `7a161da9f2cb862fc2e7e6898c5b51de56335258`；本阶段尚无 Provider、OSS、schema 或生产写入
- 唯一下一动作：实现多角度结构化任务与完整生命周期，先完成 fake/零请求验证，不得进入 D8

## 18. D6 真实模型和处理引擎调查

- 时间：2026-08-23 20:58:06 +0800
- 阶段：`D6`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `6c6e0c32d8974568ea813201a3d9570dfbc45c8a` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D5 已提交为 `6c6e0c3`；D6 未提交树新增服务端 operation 能力注册/快照/API、Generation 安全查询、composition/Vite 路由、OpenAPI 和客户端 capability Context，ImageNode 只消费 DTO；未进入 D7 功能执行
- 产品文件：`server/imageToolCapabilityRegistry.ts`、`imageToolApplicationApi.ts`、`generationApplicationApi.ts`、`applicationComposition.ts`、`openApi.ts`、`vite.config.ts`、`client/src/imageTools/ImageToolCapabilityContext.tsx`、`CanvasShell.tsx`、`ImageNode.tsx`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`tests/m20-api-contract.spec.ts`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；GitHub/SSH写入和生产写入 `0`。生产管理页只读确认默认图片模型为优创 `gpt-image-2` / GPT Image 协议、全局真实生成开启且紧急停止关闭；一次“读取余额/用量”诊断明确未创建生成任务。Ark SSO 到期后按登录流程刷新，价格只读确认 Seedream 5.0 Lite/4.5/4.0 当前账号单价分别为 CNY `0.22/0.25/0.20` 每图，未创建资源或任务
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 safe runner。m100 首轮先暴露 TypeScript tuple 窄化，修复后第二轮仅旧组合根精确计数 7 未随新增应用 API 改为 8，最小复验最终 `13/13 PASS`；m20 `1/1 PASS`；m2 首轮前 7 项通过后因能力服务在 fixture 中正确返回管理员停用而旧面板入口被禁用，主动中止退出 130，改为“入口可查看参数、实际提交再按 capability fail-closed”后最终 `10/10 PASS`。客户端增加精确过期定时 fail-closed 后，合并复验 m100+m2 `23/23 PASS`、退出 0，最终 source/snapshot `ff928f42…1cfb`，4173 listener 不变；未运行 full
- 架构与数据风险：服务端是五态、单项停用和过期的唯一权威，客户端失败即 stale；DTO 不含凭据、余额或 Provider 配置。官方 GPT Image 2 文档确认 edits、参考图、mask、高保真输入和透明 PNG/WebP；mask 与输入需同格式同尺寸且小于 50 MiB，产品继续采用更严的 20 MiB/4000 万像素界限。ByteDance 官方 Seedream 资料确认单/多参考图编辑，但未核实独立 mask API，因此不为其声明 mask。Real-ESRGAN 代码为 BSD-3-Clause但生产资源成本未冻结；rembg 本体虽 MIT，其模型权重许可证分离且 BRIA 商用另需授权，并存在旧版路径穿越修复边界，当前不引入
- 设计偏差：没有为每个按钮硬编码 Provider 名或把生产余额下发浏览器；只注册一个 `gpt-image-edit` 能力适配器并由当前账号安全模型查询决定可用性。多角度/重绘入口即使 Provider 暂停仍可打开查看本地参数，真正提交由后续阶段按 capability 拒绝，既保留既有面板合同也不伪造可生成。D10 主体抠图优先复用已核实的 GPT Image 透明输出，不捆绑许可证未闭环的 rembg 权重
- 阻断：无。`agent-reach` 的 Exa MCP 和本机 `agent-reach` CLI 均不可用，但已按失败链改用 OpenAI、ByteDance、Volc、rembg、Real-ESRGAN 官方一手页面和生产只读管理页完成交叉核实；这不影响已冻结能力合同
- 回滚点：D5 提交 `6c6e0c32d8974568ea813201a3d9570dfbc45c8a`；D6 没有 schema、Provider任务、OSS、GitHub 或生产写入
- 唯一下一动作：提交 D6 本地 checkpoint commit；随后进入 D7 前先把 D7 标为 `IN_PROGRESS`，只施工多角度结构化生成与恢复，不提前进入 D8

## 17. D5 个人素材库

- 时间：2026-08-23 20:38:01 +0800
- 阶段：`D5`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `fb0f3eba6c1ea5c7f4785367be864dd277413aa5` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D4 已提交；D5 未提交树完成真实个人素材库、主库/sidecar 锁序、Media 删除保护、备份/恢复、账号清理、OpenAPI、图片工具栏保存和素材面板真实数据；尚未进入 D6
- 产品文件：`server/library/internal/libraryStore.ts`、`libraryCatalog.ts`、`libraryApplicationApi.ts`、`libraryBackup.ts`、`mediaLibraryReferencePort.ts`、`mediaApplicationApi.ts`、`accountTransactionCommands.ts`、`auth.ts`、`applicationComposition.ts`、`backupPackage.ts`、`openApi.ts`、`vite.config.ts`、`client/src/imageTools/saveLibraryAssetUseCase.ts`、`ImageNode.tsx`、`CanvasShell.tsx`、`styles.css`、架构边界
- 测试文件：`tests/m10-backup.spec.ts`、`m11-auth.spec.ts`、`m2-image-node.spec.ts`、`m20-api-contract.spec.ts`、`m25-library-contract.spec.ts`、`m8-assets-drag.spec.ts`、source coverage manifest
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；GitHub/SSH/生产操作 `0`
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 `node scripts/run-safe-tests.mjs run --spec ...`；m10 `17/17`、m11 `8/8`、m2 `10/10`、m20 `1/1`、m25 `2/2`、m8 `1/1`、m88 `36/36` 均退出 0。m8 首轮因测试对不存在媒体先 DELETE 建立安全墓碑而上传 409，移除错误预清理后最小复验通过；m20 首轮只因 OpenAPI 新增 1 路径/2 操作后旧 UI 精确计数 23/32 未同步而失败，同步为 24/34 后最小复验通过。最终受影响代码复验 m25 source/snapshot `ee3b21b4…9de8`，4173 listener 不变
- 架构与数据风险：主库继续精确 schema39；Library 独立 sidecar schema1、0600、拒绝符号链接/非常规文件/不可信权限，固定锁序为主库后 Library。保存先验证 owner/ready/delete intent，再建立 durable Media 引用和幂等 Library 行；删除条目只解除 Library 引用，实际媒体删除仍由 Media 管；项目/节点删除不触碰 Library，账号删除在 claim 后先清 Library 再物理媒体清理。两库无法原子提交时只允许“主库保留安全引用但 Library 行未提交”的可重试安全泄漏，不允许悬空 Library 行
- 设计偏差：没有给主库升 schema40，因为当前精确 schema39 门会使 v0.6.33 回滚启动失败；改用旧 release 完全忽略的独立 `library.sqlite`。备份格式增加可选加密 `library` entry，旧备份没有 sidecar 仍兼容。精确 D4 commit `fb0f3eba…` 的 v0.6.33 数据层已在临时 schema39 主库旁存在真实 schema1 sidecar 时打开并 `quick_check=ok`
- 阻断：无；自动证据不等于生产或用户验收，D5 未运行 full，未访问真实 Provider/OSS/生产
- 回滚点：D4 提交 `fb0f3eba6c1ea5c7f4785367be864dd277413aa5`；主库仍为 schema39，新增 sidecar 仅在测试临时数据中创建；本阶段无 Provider、真实 OSS 或生产写入
- 唯一下一动作：提交 D5 本地 checkpoint commit；随后进入 D6 前先把 D6 标为 `IN_PROGRESS`，按官方资料核实真实模型和处理引擎

## 16. D4 标注与显式导出

- 时间：2026-08-23 20:02:36 +0800
- 阶段：`D4`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `0d0c0a4f58c5075b650ada8df1bd48626076f5b8` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D3 已提交；D4 未提交树已加入版本化矢量标注文档、选择/画笔/矩形/箭头/编号/中文文字/删除/会话撤销重做/路径简化、刷新恢复和显式导出，未进入 D5
- 产品文件：`types/imageTools.ts`、`client/src/imageTools/imageAnnotations.ts`、`renderAnnotatedImage.ts`、`ImageAnnotationEditor.tsx`、`client/src/canvas/ProbeNode.tsx`、`ImageNode.tsx`、`client/src/styles.css`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`tests/m2-image-node.spec.ts`
- 文档文件：本 Checkpoint
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；GitHub/SSH/生产操作 `0`
- 测试命令、环境、结果、退出码：pinned Node `22.23.1`、npm `10.9.8`；容量实验使用 100 个矩形、1 条 1000 点画笔和中文文字，共 102 个元素，JSON `29,460` bytes（512 KiB 上限的 `5.62%`），1000 次 stringify `61.476ms`、1000 次 structuredClone `200.448ms`，退出 0。`node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts` 调试期先后暴露 SVG 空白点击未稳定命中及 IME composition 状态缺口；只修根因并复验，最终退出 0、`10/10 PASS`。`node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts` 退出 0、`13/13 PASS`；最终 source/snapshot `c2a4a5e1…b85d`，4173 listener 不变
- 架构与数据风险：容量实验支持把版本化矢量文档保存在 Canvas 节点元数据；实现仍强制 500 元素、单路径 2000 点、总点数 20000 和 512 KiB，上屏路径结束时简化。标注不改原图，只有显式导出才走 owner-scoped 同站安全源并生成派生资产；中文文字和路径简化不得丢失
- 设计偏差：容量结果支持直接使用 Canvas 元数据，没有建立独立标注资产；单击编号/文字改由 SVG `click` 提交，拖拽工具继续使用 pointer capture，避免空白 SVG 命中差异；中文输入明确记录 composition 状态
- 阻断：无；自动证据不等于生产或用户验收
- 回滚点：D3 提交 `0d0c0a4f58c5075b650ada8df1bd48626076f5b8`；本阶段无 Provider、OSS、schema 或生产写入
- 唯一下一动作：提交 D4 本地 checkpoint commit，然后进入 D5 前先把 D5 标为 `IN_PROGRESS`

## 15. D3 颜色标记、调整像素、快速分割

- 时间：2026-08-23 19:45:13 +0800
- 阶段：`D3`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `9b33114047862d375a0dd288cd44dae0b4750965` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：颜色标记写入节点元数据并进入 Canvas 自动保存/历史，筛选只隐藏不匹配图片及相连边；像素调整复用同站安全编辑源并生成 PNG 派生节点；快速分割先完整生成 4/9/16 个 PNG，再登记媒体并以单一 Canvas command 提交全部 node+edge，任一失败精确 discard 本批资产
- 产品文件：`client/src/canvas/CanvasGraphMutationContext.ts`、`CanvasSurface.tsx`、`ImageNode.tsx`、`ProbeNode.tsx`、`client/src/styles.css`、`client/src/imageTools/LocalImageToolPanels.tsx`、`batchDerivedImageToolUseCase.ts`、`localImageProcessing.ts`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`tests/m2-image-node.spec.ts`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；GitHub/SSH/生产操作 `0`
- 测试命令、环境、结果、退出码：pinned Node `22.23.1`、npm `10.9.8`；`node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts` 最终退出 0、`13/13 PASS`，覆盖 2/3/4 网格批量原子提交和 stale 后 4 资产精确补偿；`node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts` 最终退出 0、`10/10 PASS`，覆盖标记保存/筛选/撤销/刷新、640×360 像素派生、2×2 四节点持久落图、3×3/4×4 入口和零生成请求。调试期首轮 m100 由缺少媒体宽高类型失败；m2 两轮分别发现裁剪既有错误文案漂移和 React Flow 虚拟化导致的 DOM 计数假设，均只修复根因/测试观测并复验 m2；最终 source/snapshot `f9e65bc9…ba04` 不变，4173 listener 不变
- 架构与数据风险：本地工具未创建 Generation task；输入/输出继续受 20 MiB、4000 万像素和单边 8192 限制；批量提交 fence 绑定 revision/source/operation/run/ownership。页面只会渲染视口内节点，因此完整 4/9/16 数量由持久 Canvas 和端口原子测试证明，不用 DOM 虚拟化数量冒充数据量
- 设计偏差：断点在压缩前未先切到 D3 `IN_PROGRESS` 即已有 D3 初稿；恢复后先暂停编辑并补正真实断点。为不增加测试总数，D3 断言并入既有 m100/m2，用持久 Canvas 观测替代视口 DOM 总数
- 阻断：无；HEAD、origin/main、package、版本门和发布门均未漂移，受保护文件不在本 worktree
- 回滚点：D2 提交 `9b33114047862d375a0dd288cd44dae0b4750965`；本阶段无 schema、Provider、OSS 或生产写入
- 唯一下一动作：进入 D4，先把 D4 标为 `IN_PROGRESS`，完成标注容量实验并冻结存储方案

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
