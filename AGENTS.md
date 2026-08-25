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
8. `spec/INCIDENT_2026-08-20_TEMPLATE_GROUP_FAILURE_AND_QUEUED_TASK_HANDOFF.md`（2026-08-20 事一/事二交接，接手必读）
9. `spec/UNBOUNDRY_GLOBAL_AUDIT_REMEDIATION_PLAN_2026-08-20.md`（事一/事二查证后的全局审计结论、修复设计与验收门）
10. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 当前区块

然后只读核对 `pwd`、Git 分支、HEAD、工作树、package 版本和 Node 版本。与施工断点不一致时停止，不得继续施工。

## 2. 当前授权边界

- **2026-08-25 INC-UI-011 当前权威状态**：生产运行`v0.6.43/schema41`且技术健康；节点排序菜单Portal层级修复已完成本地`USER_PASS`、唯一safe full `121/121 specs、1061/1061 tests PASS`、PR #100与PR/main Quality CI、不可移动tag/GitHub Release、冻结恢复演练、fresh build、原子切换、公网/回环/数据/inventory/静态资源和生产零付费浏览器验证。生产菜单「宫格/水平」可见且中心点命中自身，Escape返焦，画布revision/graph_revision/updated_at不变；真实Provider、Generation、OSS写入、购买/订阅和费用为0。当前为`PRODUCTION_V0_6_43_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / LOCAL_USER_PASS / USER_RECHECK`，回执`spec/V0_6_43_PRODUCTION_RECEIPT_2026-08-25.json`；v0.6.43一次性发布授权已消费，生产用户实页确认前不得写生产`USER_PASS`；
- **2026-08-25 INC-GEN-013 当前权威状态**：生产运行`v0.6.42/schema41`且技术健康；accepted-only恢复、原生组合框拖动、定向验收、P0/P1终审、唯一safe full原始`1060/1061`及相同源码m0定向`23/23 PASS`均已记录。PR #98、PR/main Quality CI、merge、不可移动tag/GitHub Release、冻结双副本、schema41恢复副本验证、fresh build、原子发布、公网/回环/数据/inventory/全静态资源和三视口零付费浏览器均通过；真实Provider/Generation/OSS写入/费用为0。当前是`PRODUCTION_V0_6_42_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_RECHECK`；v0.6.42一次性GitHub与生产授权已消费，后续新代码、Provider或发布动作需要新授权；
- **2026-08-25 INC-SEEDANCE-002 当前权威状态**：生产运行`v0.6.41/schema41`且技术健康；C分支「角色风险预检」在菜单层准确禁用并保留独立的「角色可信素材」入口，PR #96、Quality CI、tag/GitHub Release、冻结双副本、schema40→41副本演练、fresh build、原子发布、公网/回环/数据/inventory/资源门和三视口零付费浏览器均已完成，回执为`spec/V0_6_41_PRODUCTION_RECEIPT_2026-08-25.json`。Provider控制面、真实审核、状态查询、Generation、OSS、订阅/购买和费用均0；当前是`PRODUCTION_V0_6_41_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_RECHECK`，不得写`USER_PASS`。v0.6.41一次性实施和发布授权已消费，后续新代码、Provider或发布动作需要新授权；
- **2026-08-25 INC-SEEDANCE-001 当前权威状态**：生产运行`v0.6.40/schema40`且健康；PR #92、Quality CI、tag、GitHub Release、冻结备份、fresh build、原子切换、公网/回环、数据不变和5资源门均已完成，回执为`spec/V0_6_40_PRODUCTION_RECEIPT_2026-08-24.json`。受限Provider诊断只保存HTTP状态、错误码和RequestId，不保存远端Message、Body或密钥。Project `default`已只为IAM用户`tapnow-ark-catalog-ro-20260803`补`ArkFullAccess`，用户详情显示项目限制；一次用户级误授权已立即撤销且无残留。唯一H5创建`1/1`返回远端`403 SubscriptionRequired`，无Provider session ID/H5Link/BytedToken；认证查询、Asset创建/查询、Generation、费用和OSS写入均0。当前是`PRODUCTION_V0_6_40_TECHNICAL_PASS / PROJECT_PERMISSION_APPLIED / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / BLOCKED_EXTERNAL_CAPABILITY / USER_RECHECK`；不得购买、重试、移动历史tag或复用预算，下一动作只以INC-SEEDANCE-001 Checkpoint为准；
- **2026-08-24 当前权威状态**：生产运行`v0.6.38/schema40`且技术健康，状态`PRODUCTION_PUBLISHED_USER_PASS / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / USER_PASS`。INC-IMGEDIT-006已完成R0～R11、GitHub PR #87/CI/Release、双冻结备份、schema39→40副本演练与旧runtime拒绝门、fresh build、原子发布和生产零付费浏览器复验；全屏两张高图在三视口均完整contain。真实控制链只消费1次entitlement read与唯一1次H5 create；H5 create返回503且没有H5 URL，因写请求远端副作用未知而未重试，未执行asset create、paid generation或OSS写入。用户已在生产实页明确回复“通过”，用户验收已收口，但这不把真实Provider协议失败改写为成功。权威方案为`spec/INC_IMGEDIT_006_FULLSCREEN_FIT_AND_SEEDANCE_TRUSTED_ASSET_PLAN_2026-08-24.md`，实时断点为对应Checkpoint，回执为`spec/V0_6_38_PRODUCTION_RECEIPT_2026-08-24.json`。v0.6.38发布授权和H5 create预算已消费；
- **v0.6.28 历史时点**：精确源码commit`ee6ce437730cf78ef4488217b778f6b0ef2aaee5`、tree`2811ada65140779d4a5e10cbd8ed6fa54893638b`，tag`v0.6.28`，PR #58 merge`753d24f8ee6e4facb3c88e876c4a38b456addc75`；正式safe full执行`1032/1034`，两个失败分别为0.3ms性能抖动与候选文档精确字符串，修正文档后只复验失败spec并`16/16 PASS`，未重复full。生产回执`spec/V0_6_28_PRODUCTION_RECEIPT_2026-08-21.json`；
- v0.6.18生产源码commit为`e47f50c0bde0ee23585f27b71ad8df240973161a1`、tree为`48bee3c2c050ced3d2854390ca1ef1d0aba8fae5`；注释标签`v0.6.18`精确指向该源码。PR #32已于2026-08-19合并到`main`，merge commit为`265c8f63e867e122ecab2f145c362d5bdab3bd19`。生产凭证为`spec/INC_GEN_009_UI_ALIGN_PRODUCTION_RECEIPT_2026-08-19.json`；
- v0.6.18正式安全全量为`118/118 specs、983/983 tests PASS`，异常0。管理员后台「优创尺寸映射」面板样式对齐暗黑 UI、比例下拉、文案大白话；出图逻辑不变。优创专用协议按文档像素发 1K/2K/4K，生产默认画质保持 1K；
- 冻结备份位于`/var/lib/unboundry-rollbacks/v0.6.18-frozen-vctAv7`，冻结源与恢复副本均365文件且清单SHA-256同为`b3bb61a68e03b810e8573f52d81c331f06b825feb3d67f9f4b202e3310aa7ca8`。发布与验证期间真实Provider请求、付费生成和OSS写入均为0；上一不可变release `v0.6.17-inc-gen-008-009-20260819`及对应冻结备份继续保留；
- 既有v0.6.0～v0.6.17、真实工作流与视频证据继续作为历史记录保留；其历史时点字段不得改写。用户于2026-08-18回复「全通过」只覆盖当时列出的待复验旧项；其他仍为`USER_RECHECK / PARTIAL / PAUSED / BLOCK / NOT_STARTED`的独立条目不自动升级。v0.6.17与v0.6.18生产及GitHub授权已经消费完毕，不是未来继续改生产、数据、Provider、OSS、push/tag/PR或发布的永久授权；

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
