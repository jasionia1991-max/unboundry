# Unboundry 模块化成果主线集成 Checkpoint

更新日期：2026-08-23

状态：`D0_LOCAL_COMMIT_PASS / D1-D5_AUTO_PASS / D6_LOCAL_AGENT_PAGE_PASS / D7_USER_PASS / D8_AUTO_PASS / LOCAL_MAIN_MERGED / PUSH_NOT_AUTHORIZED / PRODUCTION_FORBIDDEN`

## 1. 权威入口

1. `spec/UNBOUNDRY_MODULAR_MAIN_INTEGRATION_PLAN_2026-08-22.md`
2. `spec/UNBOUNDRY_MODULAR_MAIN_INTEGRATION_ACCEPTANCE_MATRIX_2026-08-22.md`
3. 本 Checkpoint
4. `UNBOUNDRY_MODULAR_WORKTREE.md`
5. 既有离线隔离合同、方案、矩阵、Checkpoint 和 receipt

本 Checkpoint 是后续集成阶段唯一持续更新的状态文件。聊天、摘要和记忆不能覆盖这里的状态与实时 Git 证据。

## 2. 当前冻结身份

- 当前本地 main 工作根：`/Users/mymy/Documents/unboundry-local-main-merge-2026-08-23`
- 当前分支：`main`
- 集成候选工作根/分支：`/Users/mymy/Documents/unboundry-modular-main-integration-2026-08-22` / `codex/modular-main-integration-2026-08-22`
- 已测试产品 HEAD / tree：`7e868939959e90fd4a7fc786fc60b94aee3f1a68` / `bda78d3456d583b89588827af9d59955e9b88294`
- 第一个 main-safe 本地候选提交：`7e868939959e90fd4a7fc786fc60b94aee3f1a68`（`refactor(modular): integrate main-safe module boundaries`）
- 第二个本地提交：本 Checkpoint、方案、矩阵和 `TASKS.md` 所在的 D8 证据文档提交（`docs(modular): record main integration acceptance`）；提交后的精确 HEAD/tree 由最终实时 Git 输出记录，避免文档自引用提交哈希造成递归改写；
- 集成候选最终 HEAD / tree：`d42a62ea84f1151af6e35690b11cf7280fbadc77` / `4018d9c43e10a87e0124e24c11e9f2a8c50ff4de`；
- 本地 main 合入提交：`5476522c28139329deeb81e465dca0106543a68c`（parents `dcffba32d57af9accaa25bf01feb40f1e7828092`、`d42a62ea84f1151af6e35690b11cf7280fbadc77`），tree 同为 `4018d9c43e10a87e0124e24c11e9f2a8c50ff4de`；
- 本次四份状态文档提交：`docs(modular): record local main merge`；精确最终 HEAD/tree 由提交后的实时 Git 输出记录，避免自引用递归改写；
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

用户已通过本 Goal 授权并完成 D0～D8：本地施工、分阶段本地提交、安全静态/定向/full/页面验证、D7 用户四项验收与 D8 文档提交收口。

用户于2026-08-23明确授权“允许本地合入main，不push”。该授权只覆盖本地 main 快进、合入及必要状态文档提交，现已消费。用户仍未授权 push、PR、tag、升版、发布、部署，以及任何真实 Provider、OSS、SSH、生产、真实数据、真实媒体、备份或秘密访问。

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
- D5 在 D3/D4 全绿后形成第一个 main-safe 本地候选提交 `7e868939959e90fd4a7fc786fc60b94aee3f1a68`，tree `bda78d3456d583b89588827af9d59955e9b88294`；提交共97个文件、`+13468/-5807`，原离线分支及45个施工提交未改写；
- 唯一一次 `node scripts/run-safe-tests.mjs full` 在 Node `22.23.1` / npm `10.9.8`、上述 HEAD/tree 和 source/snapshot `16477c4fff8131d40c7be409a0c085076368d304719ff41f0ff75040862c5193` 上执行；120/120 specs、1050/1050 tests PASS，failed/skipped/retries/blocked/reportErrors 均0，exit 0；immutable builder 为1次 attempt、5次 invocations、1 passed、0 failed；
- D5 full 前后 source/snapshot 未变化，4173 listener hash `24c91e57...47b8244` 未变化，安全临时目录已清理；没有运行第二次 full，外网、真实 Provider、真实 OSS、真实数据、SSH和生产访问均为0。
- D6 使用系统临时根 `/private/var/folders/3f/ckfmzck51612dwqng3kcnyyr0000gn/T/unboundry-main-integration-page.wvrAPU` 和动态 loopback `127.0.0.1:57359` 启动本地页面；当前验收 URL 为 `http://127.0.0.1:57359/canvas`，服务器继续保持运行供 D7 使用；
- D6 网络闸门拒绝了 Vite 对 `0.0.0.0`、`::` 和其展开形式的3次宽地址监听尝试，随后只注册 `127.0.0.1:57359`；这3条 `node_network_blocked` 是 fail-closed 生效证据，不是外连。CDP 刷新窗口记录112个请求事件、100个 HTTP URL，HTTP URL 全部为 `http://127.0.0.1:57359/`；另有 Chrome 扩展资源和 data URL，没有非 loopback HTTP、Provider或OSS请求；
- D6 页面可打开，`Failed to fetch` 计数0，console error/warn 计数0。刷新时6个 loopback Fetch 被 React 开发态重复请求取消，均为 `net::ERR_ABORTED / canceled=true`，对应 auth/models/templates/agent-config/project-title/canvas，不是未解释外连错误；
- D6 通过 Chrome 原生选择器上传系统临时2x2 PNG，实际本地 `POST /api/assets` 为201，形成1个图片节点；适应视图前后节点/边/组保持 `1/0/0`，删除后 `1 -> 0`、撤销后 `0 -> 1`，保存后刷新恢复为1个节点且标题 `d6-finder-drag` 保持；
- D6 的跨应用鼠标自动化无法把 Finder 窗口中的文件越过应用窗口边界交给 Chrome，因此没有把该手势伪装成 Agent 已执行。Agent 随后在同一真实页面以同一临时 PNG 构造浏览器 `File` drop，`dragover` 和 `drop` 都被画布取消默认行为，节点 `1 -> 2`、URL 始终为 `/canvas`、`Failed to fetch` 为0，保存刷新后仍为2个节点；这是页面 drop 合同证据，实际 Finder 鼠标手势仍明确保留给 D7 用户复验；
- D6 两节点适应视图前后节点/边/组保持 `2/0/0`，缩放滑块为 `1.8912529550827424`；最终 console error/warn 为0，页面保持可用。当前源码自候选提交后未变化，未重复 build、定向测试或 full。
- D7 用户于 2026-08-23 对明确列出的四项回复“通过”：页面打开且无 `Failed to fetch`、Finder 图片拖入且页面不跳转、适应视图正常、删除/撤销/保存后刷新恢复正常；MP-070 因用户明确确认从 `USER_RECHECK` 升为 `USER_PASS`，没有用旧离线候选或自动测试代替本次验收；
- D7 本地运行日志同时记录到用户复验期间新的 `POST /api/assets 201`、`GET /api/assets 200`、多次 `PUT /api/canvas 200` 和刷新后的 `GET /api/canvas 200`；这些只作本地技术旁证，`USER_PASS` 的权威依据仍是用户本轮明确回复；
- D8 没有修改产品源码、测试、package、schema 或版本号；`git diff 7e868...` 在提交前只包含 `TASKS.md` 和三份主线集成治理文档，因此 D3-D6 的源码绑定证据继续有效，没有重复 TypeScript、build、定向测试或 safe full；
- D8 最终只读审计确认：远端跟踪引用 `origin/main` 仍为 `dcffba32d57af9accaa25bf01feb40f1e7828092`，本地 `main` 仍为 `d3923e850f439d7ab023e6d7d9755f169a9a8420`，集成产品提交的 merge-base 仍为审计 main；冻结产品源相对该 main 仍为45个提交，`103079...` 仍是离线文档提交 `92a57e...` 的祖先；
- D8 再次确认8项离线施工舱文件全部不在候选中：`UNBOUNDRY_MODULAR_WORKTREE.md`、identity JSON、offline isolation/plan/matrix/checkpoint/receipt、identity script；AGENTS/package/scripts/client/server/tests 内固定离线路径、固定分支、`OFFLINE_WORKTREE_ONLY`、`NOT_MAIN` 和 identity script 命中0；
- D8 直接读取 `scripts/architecture-boundaries.json` 得到3组 baseline entries、76个展开 fingerprint；这只确认最终配置数量与已通过的 D3 architecture 证据一致，不冒充重新运行 architecture；
- D8 在确认 owner、`0700` 权限、`.unboundry-safe-owner` 和精确动态端口后，向本轮 server 发送中断；日志为 `SHUTDOWN_STARTED / SHUTDOWN_DRAINED`，57359 listener 已消失。系统临时根已可恢复地移动到 `/Users/mymy/.Trash/unboundry-main-integration-page.wvrAPU-D8-20260823`，没有删除或触碰真实数据；
- D8 当时没有 push、PR、tag、升版、发布、部署、main 写入、Provider、OSS、SSH、生产或真实数据动作；其历史残余边界是尚未获准本地合入 main。该边界随后仅由用户本轮明确授权关闭；真实 Provider/OSS/生产仍是 `NOT_RUN`，本次也不要求运行。
- MP-090 开始前再次确认集成候选 clean、HEAD/tree 为 `d42a62e...` / `4018d9c...`，merge-base 与远端 main 均为 `dcffba3...`，远端不存在集成分支；
- 新建独立 main worktree `/Users/mymy/Documents/unboundry-local-main-merge-2026-08-23`，初始本地 main 为 `d3923e8...` 且落后远端165个提交；使用 `git merge --ff-only origin/main` 快进到 `dcffba3...`，没有切换或修改原工作树；
- 使用 `git merge --no-ff codex/modular-main-integration-2026-08-22 -m "merge: integrate modular main-safe boundaries"` 形成 `5476522...`；两个 parent 精确为 `dcffba3...` 与 `d42a62e...`，tree 精确等于候选 `4018d9c...`，候选到 merge commit 的文件 diff 为空；
- 因 merge tree 与已测试候选 tree 逐字节相同，本次没有重复 TypeScript、build、定向测试或 safe full；merge 后只更新 `TASKS.md` 与三份本集成治理文档；
- 本次没有 push、PR、tag、升版、发布、部署、Provider、OSS、SSH、生产或真实数据动作；远端 main 的最终只读核验记录在提交后实时 Git 输出中。

## 5. 当前动作

`LOCAL_MAIN_MERGED / PUSH_NOT_AUTHORIZED`：本地 main 合入与状态文档已完成，产品树等于已测试候选；停止在本地，不 push。

## 6. 下一步

停止施工。任何 push、PR、tag、升版、发布或部署都需要新的明确授权。

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
- `D5_AUTO_PASS`：唯一 safe full 为120/120 specs、1050/1050 tests PASS，源码与snapshot未变化；
- `D6_LOCAL_AGENT_PAGE_PASS`：动态 loopback 实页的打开、File drop合同、适应视图、删除/撤销、保存刷新、console和网络审计均通过；Finder跨应用实际鼠标手势没有冒充Agent证据，明确留在D7；
- `D7_USER_PASS`：用户已对新集成候选四项实际页面验收明确回复“通过”；
- `D8_AUTO_PASS`：最终文档、Git事实、76条例外、排除项、残余风险和安全资源清理已同步；
- `READY_FOR_LOCAL_MAIN_DECISION`：历史阶段已达到，随后用户给出单独本地 main 授权；
- `LOCAL_MAIN_MERGED`：达到；本地 main 已以明确 merge commit 合入，产品树与已测试候选相同；
- `USER_PASS`：本轮新集成候选已达到；
- `PUSH_NOT_AUTHORIZED / PRODUCTION_FORBIDDEN`：确定。
