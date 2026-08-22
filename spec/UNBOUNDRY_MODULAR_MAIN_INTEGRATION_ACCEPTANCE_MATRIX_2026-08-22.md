# Unboundry 模块化成果主线集成验收矩阵

状态：`D0-D8_PASS / LOCAL_MAIN_MERGED / REMOTE_MAIN_SYNCED / V0_6_31_PRODUCTION_PUBLISHED_USER_PASS / USER_PASS`

更新日期：2026-08-23

权威方案：`spec/UNBOUNDRY_MODULAR_MAIN_INTEGRATION_PLAN_2026-08-22.md`

状态词：

- `DOC_PASS`：文档合同已落地，不代表代码或测试通过；
- `NOT_STARTED`：没有开始，不得写成通过；
- `IN_PROGRESS`：已有授权且正在执行，同时只能有一个阶段处于此状态；
- `AUTO_PASS`：命令、环境、范围和 exit 均有记录；
- `LOCAL_AGENT_PAGE_PASS`：Agent 已在隔离实页完成指定场景；
- `USER_RECHECK`：等待用户检查新集成候选；
- `USER_PASS`：仅限用户明确确认的条目；
- `LOCAL_MAIN_MERGED`：用户已单独授权，候选已合入本地 `main`，不代表 push、PR、tag 或发布；
- `BLOCKED`：真实停止条件成立并已写入 Checkpoint。

| ID | 验收项 | 必须证据 | 当前状态 |
|---|---|---|---|
| MP-000 | 冻结源候选 | 分支、HEAD、base、工作树状态记录 | `AUTO_PASS` |
| MP-001 | 文档驱动合同 | 总方案、矩阵、Checkpoint 互相引用，授权和非目标明确 | `AUTO_PASS` |
| MP-010 | 最新 main 输入 | 施工前重新核对远端 SHA、merge-base、计数、diff、merge-tree | `AUTO_PASS` |
| MP-011 | 独立集成身份 | 新 worktree/branch 不等于原工作树或 main，路径明确、状态干净 | `AUTO_PASS` |
| MP-020 | 最终产品状态导入 | 以最终候选为源，不逐个重放 45 个提交；原分支未改写 | `AUTO_PASS` |
| MP-021 | 离线外壳清场 | 固定路径、固定分支、NOT_MAIN、identity/pre-script/page gate 不进入候选 | `AUTO_PASS` |
| MP-022 | main-safe 工具链 | 普通 checkout 的 architecture、safe runner、source coverage、dev/build/preview 可运行 | `AUTO_PASS` |
| MP-023 | 内容安全 | 无秘密、真实数据、受保护 JSON、临时文件、Provider/OSS/生产配置 | `AUTO_PASS` |
| MP-030 | TypeScript | 冻结树命令、环境和 exit 0 | `AUTO_PASS` |
| MP-031 | Architecture | 通用闸门通过，baseline 重新核对且无新增例外 | `AUTO_PASS` |
| MP-032 | Source coverage | 最终 source/manifest/hash 一致，exit 0 | `AUTO_PASS` |
| MP-033 | Production build | main-safe production build exit 0 | `AUTO_PASS` |
| MP-040 | Canvas 回归 | graph/save/conflict/refresh/fit/drop/delete/undo 直接测试 | `AUTO_PASS` |
| MP-041 | Generation 回归 | 四模态 Generate/Retry/Cancel/Reconcile/Recovery 直接测试 | `AUTO_PASS` |
| MP-042 | Media/Provider 回归 | reference/blob/publication/compensation/recovery，外部请求0 | `AUTO_PASS` |
| MP-043 | 数据事务回归 | owner transaction 与失败注入 rollback 保持原合同 | `AUTO_PASS` |
| MP-044 | Registry/Composition | replacement drill、启动顺序、runtime readiness | `AUTO_PASS` |
| MP-050 | 唯一 safe full | 冻结 HEAD/tree/snapshot；spec/test/exit/异常；4173、临时目录和网络审计 | `AUTO_PASS` |
| MP-060 | Agent 实页 | 动态 loopback 页面；六个场景；console/网络证据 | `LOCAL_AGENT_PAGE_PASS` |
| MP-070 | 用户验收 | 页面、Finder 拖图、适应视图、删除撤销保存刷新四项明确确认 | `USER_PASS` |
| MP-080 | 文档收口 | Checkpoint、矩阵、状态、残余风险与 Git 事实同步 | `AUTO_PASS` |
| MP-090 | main 决策门 | 用户单独明确允许本地合入 main；merge parents/tree 与远端未变化证据；不自动包含 push | `LOCAL_MAIN_MERGED` |
| MP-091 | 远端与发布门 | 用户另行确认版本号 v0.6.31 并允许 push、PR/tag 与发布；远端 main、候选测试、生产回执和用户生产实页确认分层记录 | `USER_PASS` |

## 失败规则

- 没有命令和 exit 的自动项不得标 `AUTO_PASS`；
- 定向复验不得冒充 full；
- 旧离线候选的 `USER_PASS` 不自动覆盖 MP-070；
- health 或页面可打开不代表数据库、任务或用户验收通过；
- 任一秘密、真实数据、外部请求或身份不明立即停止并更新 Checkpoint；
- `MP-090` 只覆盖已完成的本地 main 合入；后续远端 main 与 v0.6.31 发布只由用户对 `MP-091` 的新授权覆盖。
