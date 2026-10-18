# 文档总索引（先看这里）

这一页用大白话告诉你：项目是什么、怎么跑、怎么测、怎么上线，以及哪些文档是“现在有效”的、哪些只是“历史留档”。
本页只做导航，不记录当前版本号、待办或授权；这些只以 [项目现在怎么样](../spec/UNBOUNDRY_CURRENT_STATE.md) 和 [当前任务](../TASKS.md) 为准。两处说法不一致时，以它们为准。

## 1. 这是什么项目

无央 Unboundry 是一个本地优先的“无限画布 + AI 生成”网页应用：在画布上放文本、图片、视频、音频等节点，连线组成工作流，调用各家模型生成内容。

代码大致分三块：

| 目录 | 内容 |
| --- | --- |
| `client/src/` | 前端（React + Vite）。`App.tsx` 只负责路由和登录外壳；后台管理页面在 `client/src/admin/`，账号相关页面在 `client/src/app/`，画布在 `client/src/canvas/`。 |
| `server/` | 后端（Node + TypeScript），开发时由 Vite 插件挂载；数据库用 Node 自带的 SQLite（`node:sqlite`）。 |
| `tests/` | Playwright 端到端测试和若干 Node 测试。必须通过安全测试脚本运行（见下文）。 |

## 2. 常用命令

| 想做什么 | 命令 | 说明 |
| --- | --- | --- |
| 安装依赖 | `npm ci` | 按 `package-lock.json` 安装。 |
| 本地开发 | `npm run dev` | 启动开发服务器（只监听 127.0.0.1），前后端一起跑。 |
| 类型检查 | `npx tsc --noEmit --pretty false -p tsconfig.check.json` | 与 CI 相同的类型检查。 |
| 构建 | `npm run build` | 类型检查 + 生产构建，产物在 `dist/`。 |
| 架构检查 | `npm run check:architecture` | 检查模块之间有没有越界依赖。 |
| 测试环境自检 | `npm run test:safe:preflight` | 确认 Node 22、依赖和隔离环境可用。 |
| 只跑一个测试文件 | `node scripts/run-safe-tests.mjs run --spec tests/m0-shell.spec.ts` | 推荐的日常做法：改哪里就跑相关的几个文件。 |
| 列出所有测试 | `npm run test:safe:list` | |
| 源码覆盖检查 | `node scripts/check-source-coverage.mjs` | CI 必跑；检查每个源码文件都被类型检查或测试覆盖。 |
| 全量测试 | `npm run verify` | 很慢，只在发布门确实需要时跑。 |
| 备份 / 校验 / 恢复数据 | `npm run data:backup` / `npm run data:verify-backup` / `npm run data:restore-backup` | 生产上要用当前发布包里的同名脚本，详见发布手册第 5 节。 |

注意：

- 测试一律用 `scripts/run-safe-tests.mjs`。它会把源码复制到临时隔离目录、用随机端口和合成数据运行，不会碰你的真实画布、真实模型或 OSS。
- 测试和源码覆盖检查要用 **Node 22.23.1 / npm 10.9.8**；日常开发和构建用 `.node-version` 里的 Node 25。
- `package.json` 里其余脚本大多是给某个专项或 CI 用的，不要随手删；不确定时先全局搜索它在哪里被引用。

## 3. 怎么上线（只读摘要）

上线规则以 [上线规矩](../上线规矩.md) 和 [发布手册 RELEASE_RUNBOOK](../RELEASE_RUNBOOK.md) 为准，这里只做提要：

1. **需要两件事都明确**：版本号 + “允许发布”。“改吧 / 继续”不等于可以上线；一次授权只用一次。
2. **本地先验证**：跑与改动相关的安全测试、类型检查、构建；UI 变化先给用户看本地效果。
3. **GitHub 留身份**：commit → push → PR 的 CI 通过 → 合并 → main 的 CI 通过 → 打 tag → GitHub Release。
4. **从精确 tag 重新构建**到全新目录，不上传脏工作区。旧的 `scripts/deploy.mjs` 已停用（会直接报 `LEGACY_DEPLOY_DISABLED`），不要用。
5. **先备份并验证可恢复，再切换**；数据库结构变化要按发布手册里的备份门和回退方案执行。生产备份合同见 [ops/production/README.md](../ops/production/README.md)。
6. 只改公共模板数据或只同步文档时，走上线规矩里的“轻量路径”或发布手册里的“独立文档同步”，不需要产品版本号。

默认**不包括**：用真实账号付费生成、删备份、删旧版本、动 OSS 素材。

## 4. 哪些文档是现在有效的

| 文档 | 用途 |
| --- | --- |
| [README](../README.md) | 项目入口。 |
| [AGENTS.md](../AGENTS.md) | AI 工作规则和按需阅读路线。 |
| [CURRENT_STATE](../spec/UNBOUNDRY_CURRENT_STATE.md) | 项目现在怎么样：当前版本、未发布内容、待验收项。 |
| [TASKS](../TASKS.md) | 当前任务和下一步。 |
| [上线规矩](../上线规矩.md)、[RELEASE_RUNBOOK](../RELEASE_RUNBOOK.md) | 上线授权和发布步骤。 |
| [ops/production/README.md](../ops/production/README.md) | 生产备份合同。 |
| [REPLICA_CONSTRAINTS](../REPLICA_CONSTRAINTS.md) | 复刻约束。 |
| [生成架构](../spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)、[UI 设计系统](../spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)、[验收矩阵](../spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md) | 长期有效的技术和界面约定。 |
| `spec/` 里其余文档 | 专题方案、当前任务计划（文件头写着角色，如 `TASK_PLAN`）和仍被其他文档或测试引用的历史记录。打开时先看文件开头的“角色/状态”说明。 |

## 5. 历史文档

- [`docs/archive/`](archive/) 里是已经结束的事件记录、旧方案、旧断点、旧版本发布说明和一次性 Goal 提示词。它们只用来查证“当时发生了什么”，**不代表现在的状态，也不构成任何授权**。
- `README.history.md`、`TASKS.history.md`、`spec/UNBOUNDRY_CURRENT_STATE.history.md` 是带哈希校验的冻结快照，不能修改。快照里写的 `spec/某文件.md` 如果已经找不到，请到 `docs/archive/某文件.md` 查看。
- `spec/PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv` 和各版本回执 JSON 是当时的原始记录，里面的路径保持原样。
- 仍留在 `spec/` 的历史文档，是因为还被测试、脚本、当前文档或其他留在原地的文档引用；移动它们需要一起改引用，留待以后逐步处理。
