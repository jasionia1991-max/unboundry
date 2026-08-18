# Unboundry 项目级 Agent 施工守则

本文件适用于 `/Users/mymy/Documents/unboundry/app` 全仓库。用户最新明确指令优先；若与仓库状态或本文冲突，先停止并向用户报告，不得猜测。

人和 AI 共用的上线拍板规矩见仓库根目录 `上线规矩.md`。发布前必须分别获得版本号确认和允许发布；一次授权只用一次。

## 1. 每次开始或上下文恢复必读

按顺序完整阅读：

1. `上线规矩.md`
2. `spec/UNBOUNDRY_CURRENT_STATE.md`
3. `README.md`
4. `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md`
5. `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`
6. `spec/UNBOUNDRY_HANDOFF_2026-08-09.md`
7. `TASKS.md` 当前区块
8. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 当前区块

然后只读核对 `pwd`、Git 分支、HEAD、工作树、package 版本和 Node 版本。与施工断点不一致时停止，不得继续施工。

## 2. 当前授权边界

- **2026-08-19 当前权威状态**：生产运行`v0.6.17/schema39`，`/opt/unboundry/current -> /opt/unboundry/releases/v0.6.17-inc-gen-008-009-20260819`。`INC-GEN-008 = PRODUCTION_PUBLISHED_AUTO_PASS`（待用户复验），`INC-GEN-009 = PRODUCTION_PUBLISHED_AUTO_PASS`（待用户复验），`INC-UI-010 = PRODUCTION_PUBLISHED_USER_PASS`。`INC-GEN-007/006/005/004 = PRODUCTION_PUBLISHED_USER_PASS`，`INC-UI-009～001 = PRODUCTION_PUBLISHED_USER_PASS`，`INC-GEN-003/002/001 = PRODUCTION_PUBLISHED_USER_PASS`，`INC-VIDEO-001 = PRODUCTION_PUBLISHED_REAL_VIDEO_PASS / USER_PASS`，`REM-000～011（含009A/009B） = PASS`。站着的产品合同和条目表见`spec/UNBOUNDRY_CURRENT_STATE.md`；
- v0.6.17生产源码commit为`e6b187bce50bb4189e029ab3389e316a3eb65501`、tree为`8f6208a6c7354063f5a057bf747ea409f21cbe1d`；注释标签`v0.6.17`精确指向该源码。PR #31已于2026-08-19合并到`main`，merge commit为`18e66ce39decdeb70b076cdd07b13abf1f243a80`。生产凭证为`spec/INC_GEN_008_009_PRODUCTION_RECEIPT_2026-08-19.json`；
- v0.6.17正式安全全量为`118/118 specs、983/983 tests PASS`，异常0。优创专用协议按文档像素发 1K/2K/4K，生产默认画质已改为 1K，管理员后台可自改尺寸映射；
- 冻结备份位于`/var/lib/unboundry-rollbacks/v0.6.17-frozen-RVxeGA`，冻结源与恢复副本均365文件且清单SHA-256同为`2d9ff809fd4a32e68e1252ecbe2ed63bc46b0e224b3b62965d917012d7d44562`。发布与验证期间真实Provider请求、付费生成和OSS写入均为0；上一不可变release `v0.6.16-inc-ui-010-20260818`及对应冻结备份继续保留；
- 既有v0.6.0～v0.6.16、真实工作流与视频证据继续作为历史记录保留；其历史时点字段不得改写。用户于2026-08-18回复「全通过」只覆盖当时列出的待复验旧项；其他仍为`USER_RECHECK / PARTIAL / PAUSED / BLOCK / NOT_STARTED`的独立条目不自动升级。v0.6.17生产与GitHub授权已经消费完毕，不是未来继续改生产、数据、Provider、OSS、push/tag/PR或发布的永久授权；

- REM-000 施工文档已于 2026-08-09 获用户确认，状态为 `PASS`；
- 用户已于 2026-08-09 明确启动一次性离线 Goal，合并授权 REM-001～010 与 REM-011 离线工程部分；各 REM 仍按施工总方案依赖顺序分析、实施、测试、review 和更新文档，中途不再逐项询问；
- 允许修改项目代码、测试、脚本、配置、文档、package/锁文件和必要测试依赖，允许本地专用分支与本地 checkpoint/功能/candidate commit；
- 允许动态 loopback 端口、本轮新临时目录、本地假 Provider/OSS/服务器和 Docker 测试容器；只允许终止/清理由本 Goal 创建且已核实身份的资源；
- 上述旧 Goal/bridge/final 授权均为历史已消费授权，不得复用；绝不允许擅自 push、tag、PR、SSH、生产读取/修改、真实备份、真实 Provider/OSS 或发布。

## 3. 永久红线

- 测试绝不使用 `4173`、`app/data`、`/var/lib/unboundry`、真实媒体或真实备份；
- 测试只使用本轮新建的系统临时目录和动态端口，并验证端口不等于 4173；
- REM-001 安全入口完成前，不运行默认 `npm run verify` 或自称“全量”的组合测试；
- 测试不得读取真实 Provider、OSS、代理或云账号凭据，不得访问非 loopback 网络；
- 不发起任何真实或付费 Provider 请求；
- 不修改、删除或清理真实数据和历史孤儿；只读报告也要先获得相应授权；
- 不 `git reset --hard`、不 `git clean`、不覆盖已有改动；
- 未经用户明确授权不 commit；绝不擅自 push、tag、部署、改云权限；
- 发布前必须分别获得“版本号确认”和“允许发布”；
- 数据库迁移前必须有只读一致备份、临时恢复和迁移演练。

## 4. 产品合同保护

- 站着的结果：用户上传一张图，工作流自己跑完，用户下载。中间不要再发明必须人手点的步骤。
- DATA-005：跨标签保持“最后保存者胜并同步”；只拒绝同一标签迟到旧请求。不得改成跨标签全局 CAS。
- 普通账号默认五项权限不可撤销，只维护额外授予集。
- 不恢复金额/额度/订阅功能。
- PAUSED/PARTIAL 项不得借修复改为 PASS；团队、打光、真实 Agent、社区、插件等不得擅自扩 scope。

## 5. 施工工作流

每个 REM 项必须：

1. 只读分析真实代码和影响范围；
2. 把证据、方案、风险和验收标准写入施工记录；
3. 核对动作落在用户已确认的一次性离线授权内；超出范围的分支只登记并继续其他不依赖工作；
4. 只在隔离工作区实施；
5. 运行安全专项与受影响回归；
6. 更新 `TASKS.md`、验收矩阵和施工断点；
7. 文档/工程证据完成只标 `USER_REVIEW`，需要实页的产品行为标 `USER_RECHECK`；用户确认后才标 `PASS`。

同时只允许一个 REM 项处于 IN_PROGRESS。新发现且不改变既有产品合同的 P0/P1 先登记再直接修复；无关 P2 重构、视觉改版、新功能、真实数据/外部服务或产品语义变化只登记，不扩张范围。

## 6. 恢复与失败关闭

- 内部记忆、压缩摘要和历史自动报告不是权威；
- 以用户指令、施工总方案、施工断点、Git 与当前测试证据恢复；
- 无法证明当前状态、隔离条件或授权时，默认停止；
- 不得以“应该”“大概”“历史上通过”代替当前证据；
- 定向验证不能表述为全量回归，健康接口正常不能表述为数据库或用户验收通过。
