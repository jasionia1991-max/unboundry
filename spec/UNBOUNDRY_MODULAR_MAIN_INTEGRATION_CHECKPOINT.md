# Unboundry 模块化成果主线集成 Checkpoint

更新日期：2026-08-22

状态：`D0_LOCAL_COMMIT_PASS / D1_AUTO_PASS / D2_AUTO_PASS / D3_AUTO_PASS / D4_AUTO_PASS / D5_IN_PROGRESS / MAIN_UNCHANGED / PUSH_NOT_AUTHORIZED / PRODUCTION_FORBIDDEN`

## 1. 权威入口

1. `spec/UNBOUNDRY_MODULAR_MAIN_INTEGRATION_PLAN_2026-08-22.md`
2. `spec/UNBOUNDRY_MODULAR_MAIN_INTEGRATION_ACCEPTANCE_MATRIX_2026-08-22.md`
3. 本 Checkpoint
4. `UNBOUNDRY_MODULAR_WORKTREE.md`
5. 既有离线隔离合同、方案、矩阵、Checkpoint 和 receipt

本 Checkpoint 是后续集成阶段唯一持续更新的状态文件。聊天、摘要和记忆不能覆盖这里的状态与实时 Git 证据。

## 2. 当前冻结身份

- 当前工作根：`/Users/mymy/Documents/unboundry-modular-main-integration-2026-08-22`
- 当前分支：`codex/modular-main-integration-2026-08-22`
- 当前 HEAD / tree：`dcffba32d57af9accaa25bf01feb40f1e7828092` / `1c3f93da712ea1c9ee823166c41ca09714c889f6`
- 冻结产品源：`1030790983ff3282330f6efea0613447dc2900c4`
- 离线 D0 文档提交：`92a57e49ec89aa1e7550e8109fe1b870069792c8`
- 2026-08-22 D1 重新核对的远端 main：`dcffba32d57af9accaa25bf01feb40f1e7828092`
- 冻结产品源相对远端 main：ahead 45、103 个文件
- 当前 Git 冲突证据：merge-base 等于远端 main；只读 merge-tree 无冲突标记
- 当前 package/schema：`0.6.30 / schema39`
- 原工作树：`/Users/mymy/Documents/unboundry/app`，只读且禁止施工
- 受保护 JSON：保持未读、未改、未暂存

正式施工前以上远端和工作树事实必须重新核对，不得直接沿用本文时间点。

## 3. 当前授权

用户已通过本 Goal 授权：D0～D6 本地施工、分阶段本地提交、安全静态/定向/full/页面验证；D7 等待用户四项验收，通过后自动执行 D8 文档和本地提交收口。

用户尚未授权：修改或合入 `main`、push、PR、tag、升版、发布、部署，以及任何真实 Provider、OSS、SSH、生产、真实数据、真实媒体、备份或秘密访问。

## 4. 已完成

- D0 在离线分支只提交六份治理文档：`92a57e49ec89aa1e7550e8109fe1b870069792c8`；
- 使用 `git ls-remote` 重新确认远端 main 仍为 `dcffba32d57af9accaa25bf01feb40f1e7828092`；
- 确认 merge-base 等于远端 main，冻结产品源为 45 个提交、103 个文件，merge-tree 无冲突标记；
- 从远端 main 建立独立 worktree `/Users/mymy/Documents/unboundry-modular-main-integration-2026-08-22` 和分支 `codex/modular-main-integration-2026-08-22`；
- 原工作树仍在 `codex/view-005-dense-canvas-performance-2026-08-21`，只存在既有未跟踪受保护 JSON，未读取、未改、未暂存；
- 审计原六批重放方案，确认其会增加重复组装风险；
- 决定保留原分支完整历史，在独立集成分支一次性导入最终产品状态并清除施工舱外壳；
- 落地总方案、验收矩阵和本 Checkpoint；
- D1 没有运行产品测试、构建、页面或外部系统动作。
- D2 从冻结产品源一次性恢复 93 个文件；其中产品代码、产品测试和通用合同与冻结源逐文件一致，未逐提交重放；
- 明确排除 AGENTS 离线顶部闸门、`UNBOUNDRY_MODULAR_WORKTREE.md`、identity script/JSON、离线 isolation/plan/matrix/checkpoint/receipt 共 10 项；
- 保留 main 的 `AGENTS.md`，重写 `package.json`、architecture CLI/config、safe runner、source coverage、CURRENT_STATE、TASKS 和模块化合同文档；
- 运行时代码、package、scripts、tests、AGENTS 中固定离线路径/分支、identity、`NOT_MAIN` 命中 0；仅三份集成治理文档保留来源和排除项文字；
- `git diff --cached 103079...` 只剩上述明确排除/改写文件和三份集成治理文档；`git diff --cached --check` 退出 0；
- 未导入 `.env`、Cookie、secret、SQLite、备份、真实媒体、Provider/OSS配置或受保护 JSON。
- D3 依赖准备：新 worktree 初始无 `node_modules`，使用 Node `22.23.1` 执行 `npm ci --offline --ignore-scripts`，185 packages、audit 0 vulnerability；没有联网安装；
- TypeScript：`./node_modules/.bin/tsc --noEmit` exit 0；
- Architecture：`node scripts/check-architecture.mjs` exit 0，198 source files、627 runtime edges、119 type edges、76 baseline exceptions；
- Source coverage：exit 0，399 source、356/356 TypeScript、43/43 JavaScript、operational 15 behavior + 13 frozen；
- Production build：`npm run build` exit 0，Vite 248 modules；仅既有大 chunk warning；
- Safe preflight 初次因 main-safe 改写遗漏的报告变量 `branch` 在产品测试前 fail-closed；补回只读报告变量且不恢复白名单，更新 runner hash 后只复验 source coverage 与 preflight；最终120 specs分区 75/4/30/2/9、skipSites0、exit 0，4173 listener hash `24c91e57...47b8244` unchanged。
- D4 首次合并定向覆盖 Canvas、Generation、Media/Provider、owner transaction、registry/composition 共44个 specs、666 tests；结果665通过、1失败，失败仅为 `m22-group-execution` 在适应视图/缩放后立即删除运行外节点时节点数仍为7；失败快照 `c1e9f999...6286bb7`、4173 unchanged、临时目录已清理，其余43个 specs 未重复运行；
- 同一源码快照只复验 `m22-group-execution` 仍为36/37，证明不是偶发抖动。根因是 Canvas 的250ms相机静默窗把显式键盘 `remove` 与相机重排噪声一起过滤；最小修复只允许 `remove` 通过，仍拒绝相机诱发的坐标/结构噪声；
- 修复后只运行直接受影响的 `m1-delete-undo`、`m1-viewport`、`m22-group-execution`，共3 specs、40/40 tests PASS，失败/跳过/重试/reportErrors均0；Node `22.23.1`、npm `10.9.8`，source/snapshot `7bc40867...874fe` unchanged，4173 listener unchanged，临时目录已清理；
- D4 其余域以首次合并定向的全绿结果为准，没有为安心重复。外网、真实 Provider、真实 OSS、真实数据和生产访问均为0。

## 5. 当前动作

`D5_IN_PROGRESS`：冻结当前 main-safe 集成树为第一个本地候选提交，并且只对该冻结候选执行一次 safe full。

## 6. 下一步

形成本地候选提交并核对 HEAD/tree/clean 后执行唯一一次 `node scripts/run-safe-tests.mjs full`；失败时只复验最小失败项，不运行第二次 full。

## 7. 后续每阶段记录模板

```text
阶段：D?
开始 HEAD / tree：
目标 worktree / branch：
允许修改：
禁止修改：
实际修改：
命令与环境：
exit / 结果：
外网 / Provider / OSS / 4173 / 临时目录：
失败与最小复验：
残余风险：
矩阵状态变化：
下一步：
```

## 8. 当前状态边界

- `D0_LOCAL_COMMIT_PASS`：达到，只提交六份治理文档；
- `D1_AUTO_PASS`：达到，远端 main、分叉、冲突和独立 worktree 身份均已核对；
- `D2_AUTO_PASS`：一次性最终态导入、离线外壳清场和内容审计完成；
- `D3_AUTO_PASS`：TypeScript、architecture、source coverage、build 与 safe preflight 全部通过；
- `D4_AUTO_PASS`：44-spec 首轮除一个可复现 Canvas 删除缺陷外均绿；最小修复后的3-spec直接闭环40/40通过，未重复其余成功项；
- `D5_IN_PROGRESS`：当前唯一施工阶段，full 尚未开始；
- `LOCAL_AGENT_PAGE_PASS`：只属于旧离线候选，本轮未运行页面；
- `USER_PASS`：只属于旧离线候选，本轮新集成候选尚不存在；
- `MAIN_UNCHANGED / PUSH_NOT_AUTHORIZED / PRODUCTION_FORBIDDEN`：确定。
