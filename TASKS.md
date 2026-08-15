# Unboundry 绿地复刻当前任务

更新时间：2026-08-15
状态：`生产已运行 v0.6.0/schema39；REM-000 = PASS、REM-001～REM-009B = USER_REVIEW、REM-010/011 = PASS；G7（本次 v0.6.0）= PASS；PRODUCTION = LIVE / USER ACCEPTED；真实生成已开启，DEP-003/005/006/007/010 与 OPS-002 已完成。最终切换为人工受控 bounded cutover，不冒充新的 formal controller/full regression PASS；切换期间 Provider/付费生成调用仍为0，后续获明确授权的唯一真实生成另行记录。`

### 2026-08-15 电商参考图工作流完整修复（INC-ECOM-002）

- 状态：`PRODUCTION_STATIC_REPAIR_PASS / REAL_GENERATION_PENDING`。正式候选已部署，生产19条模板静态兼容均为`PASS`；真实图片/视频生成和用户结果验收仍未执行。
- 权威断点：`spec/INC_ECOM_002_REFERENCE_WORKFLOW_REMEDIATION_2026-08-15.md`。任何上下文压缩或换Agent后必须先读该文件恢复，不得依赖聊天记忆继续。
- 硬边界：用户设置的并发`500`不动；`mediaRoutingEnabled`、OSS配置/密钥/对象和真实数据不动；历史失败任务不自动重提。
- 已确认根因：GPT Image执行先持有Provider generation lease，再为本地`data:`参考图申请Storage reservation；两者使用同一`provider-profile-write-lock.sqlite`，在Provider `fetch`前形成同锁自锁并于约5秒超时，Provider请求尚未发出。
- 已完成实现：参考图`prepare/send/cleanup`拆锁；Storage busy/上传/签名、Provider请求/结果格式分阶段错误；整组先扫描全部节点并以失败数量/首节点阻止任何task POST；模型缺失/停用不再静默默认；模板edge角色/顺序导入保留；公共模板发布/恢复/更新语义门和管理页状态。
- 模板矩阵：生产19条模板（18 published、1 archived）已为99个执行节点保存明确模型，其中published模板87个；`PASS=19 / NEEDS_MODEL=0 / INVALID=0`。目标模板「服装详情页｜面料与工艺拆解」2个Text与3个Image节点均已绑定，详见`spec/INC_ECOM_002_TEMPLATE_COMPATIBILITY_MATRIX_2026-08-15.md`。
- 当前自动与生产证据：m88含确定性Storage busy与1/5/20并行参考图`34/34 PASS`；修复一次旧Text输入提示误伤后，m22/m29/m36/m50/m65 `28/28 PASS`；生产只读审计后修复`text→storyboard`误报，m77更新为`9/9 PASS`。正式bridge `45e9cefe489ffea23970517c420bf9c64a49896b`与final `e1e0e0d33809a519e8856d11135237a6a30ff912`已形成，B→F仅package/lock三个版本值；clean final正式full `117/117 specs、954/954 PASS`，异常0，builder `1/5/1/0`，source/snapshot `0720f06d14e8c3d85ee22e596a28c51f7a1f68b6c1dceb46f66b7bc8633e27e8`。生产formal artifact manifest `692995bc9f6fc6833b314afeaea65bc5d367142aa03234299c4ab02b76aa56ff`、inventory `a2b685f64e1f3acab915e6b22d1f6dc05b2ffd75f6d5345e006f5bcb6af96151`已切换到`/opt/unboundry/releases/v0.6.0`。停机备份`/var/lib/unboundry-rollbacks/inc-ecom-002-20260815`完整可读，模板事务后schema39 integrity ok/FK0。零付费复核前后generation tasks=`106`、provider attempts=`104`、active=`0`，未产生新任务或Provider请求；公网live/ready/version/root正常，登录实页可见目标模板且控制台无warning/error。并发和OSS未改；真实生成仍须单独授权。

### 2026-08-15 电商模板生成故障热修复（INC-ECOM-001）

- 状态：`USER_RECHECK`。用户已明确授权“修复并恢复结果”；本项未创建新的生成任务，也未重新提交或重新付费生成，等待用户刷新原画布确认。
- 已确认三条独立故障路径：首次失败发生在 Provider 请求前；整组执行遇到不支持图片上游的模型时以 `skipped` 静默停止；任务 `9687eb96-b4b3-44c6-bf40-7fb31a854137` 的 Provider 任务 `105388646` 已成功，但同一结果 URL 同时出现在 `result_url` 与 `result_urls`，本地适配器误判为多结果并报 `FORMAT`。
- 当前施工范围：Provider 结果别名去重；整组执行将模型/输入不兼容持久化为节点错误并返回明确失败；只恢复 Provider 已完成的既有任务及结果，不重新提交 Provider。
- 自动验收：重复别名只产生一个输出；不兼容整组执行不产生 generation task POST/Provider 请求，节点错误保存并可重载；定向测试、类型检查与构建通过。
- 用户验收：恢复后刷新原画布可看到既有黑猫结果；模型不兼容时组运行明确失败并在图片节点保留红色原因。自动检查通过后仅记 `USER_RECHECK`，由用户实页确认后才能记 `PASS`。
- 完成证据：Node `22.23.1` / npm `10.9.8` 下两份零费用定向 spec `34/34 PASS`，TypeScript 与 production build PASS，Provider 请求为0；生产不可变运维热修复已切换到 `releases/v0.6.1-hotfix-inc-ecom-001-20260815`，应用公开版本仍为 `0.6.0`。
- 恢复证据：原任务仍为 `9687eb96-b4b3-44c6-bf40-7fb31a854137`，只轮询原 Provider 任务 `105388646`；Provider attempt 仍恰好1条、execution attempt 仍为1且已从 `response-received` 收口为 `completed`，没有第二次 Provider 提交。任务本地恢复轮次为 attempt2并成功，结果素材 `860bccb1-bb24-4683-9985-4335a5f95b81` 已绑定原图片节点。
- 结果完整性：PNG `1254×1254`、`1,758,108` bytes、SHA-256 `71589ac18b2802d6bface50963c1a2c69f3ae7e8f491ea651d83483b001e36b8`，数据库记录与实际文件逐字节一致；schema39 integrity ok / FK0 / active generation0。服务 active、NRestarts0，公网 live/ready/version 均正常。
- 回滚证据：恢复前数据库备份 SHA-256 `b47e76052d89901dc1158acaee43406ac112b27f0ee7baaa399db73c157fb807`；Provider 结果成功后、画布绑定前数据库备份 SHA-256 `f2d6170cd67a9960c9493fe324943e493c64815f7285d2321e5235639c529869`。

F14本地正式门证据绑定 HEAD `eb4f99ea525390b0dd7a39d3cad55d882ffea41d`、source/snapshot `6af5b891ebf9a460e941485d12934a4a217ed3e2d6feece90d7c6d1b5ac856b1`。日志SHA-256：targeted `b9d260babe051c1f89ef86256ade2d57fda19b57009ec02e6973be441b5585bf`；full `1f6f958d57ee855b0272ddd2576277deef6ea3e299e5ccdc597d4ca1d4559741` / `903096ed64412e184dcefecfc28c6fedda809c17a570d3fa8729a3d176560b0b` / `adecd5164828a87452bf5974a594c19da2e00e54f4aed281c113d57240b7917a`；race `3d1b64868ef60e769158b31ee4f94efbed0015d251cfdac8b48f27f8918c5a18` / `fc08356cf3bc9eb96e8b18abdd9789b96aa615361897a205240537e2ba29eb46`。五轮异常0、4173不变、suite cleaned、exit0。
唯一产品目标：从空仓库完整复刻 Unboundry 画布，不复用 Lumino/Lumino Web 的代码、组件、CSS、数据、后端、测试或部署。

### 2026-08-15 v0.6.0/schema39 最终生产收口

- F14 生产制品：commit `eb4f99ea525390b0dd7a39d3cad55d882ffea41d`、tree `86b4e424b6d6324c5f24d4c633b0cd35baf0d626`、manifest `46e2365c48b8e8bdaa1847b1767ef2974a71f2d2b47c87743793c116e5ec2adf`、inventory `ac8ca43a9f8f6724ca67bd0899185fa3952e762e0400a1f9ce34f3ecfefc2bac`、tar `0e3a96a13299efba407ba98dc6501ae97297c9a82c067827b9f9befeb2c18944`；生产 current 已指向 `releases/v0.6.0`。
- 最终核验：service active/enabled、NRestarts=0、4173 单监听；nginx 配置 SHA `2c6e90d1e558ac9b9bbc27f54f58620dfdbd863ea9383b2e2aac5c2c29c6020f` 且 `nginx -t=0`；公网 live/ready/version/auth/root 均 200，version0.6.0，ready active/schema39。
- 数据：schema39、integrity ok、FK0、row14 absent、active generation=0；99 tasks / 99 provider attempts / 416 ready media（local346 + OSS70）/ pending0；globalEnabled1、emergencyStop0、每用户及每类型并发1、每分钟5。
- 回滚证据：原 schema37 raw backup SHA `7f14c611faab136c1ae8e9579bc47755f7298e4ea6e2bba516c71e85670f8fca`，离机恢复 inspection SHA `b4d58243e88efe1c2c967ffab5f63ed6704d18324a80e8449ec9d3ad77e28e1d` 为 PASS；生产 schema39 inspection SHA `a18f8224dd651b8217cb3d778845ee3f42b5bf91a5ff68291bfad4d4cb3ffa61`。
- 封存技术凭证 SHA `5c78e7bca9af1c099e2d94e5120b63f867e4ea3b25bb61a18f751dfc8a46c2d8`，状态 `TECHNICAL_CUTOVER_VERIFIED`。凭证生成时的 `userAcceptance=PENDING` 保持不变；用户随后确认生成任务状态已可读取，并结合此前确认老项目大量生成/上传素材仍在、第4项正常，生产验收另记为 `USER PASS`。不扩大为“全部历史素材逐一验证”。
- 五条历史 outcome-unknown attempt 86/108/116/120/122 已行政取消、禁止重试；`PROVIDER_FAILED` 仅是迁移/备份门 surrogate，原 REMOTE/TIMEOUT 事件保留。三条音频 duration 元数据 12.656→12.696，媒体字节/checksum未变。切换期间 Provider/付费生成调用均为0。
- 状态结论：`REM-010 = PASS / REM-011 = PASS / G7 = PASS / PRODUCTION = LIVE / USER ACCEPTED / DEP-010 = PASS`。REM-001～009B继续`USER_REVIEW`，既有外部或延后项不自动升级；七份最终文档完成一致性收口后，用户于2026-08-15明确“文档确认通过”。

### 2026-08-15 上线后真实能力与灾备收口

- 用户明确要求真实生成必须可用。生产开关已改为 `globalEnabled=1 / emergencyStop=0`，并把遗留的500并发收紧为每用户1、文字/图片/视频/音频各1、每分钟5、连续失败阈值3、冷却30分钟。唯一一次 Doubao Seed 文字请求任务 `77d3feec-35c1-4b1e-87a2-c457983a8046` 一次成功、无重试，返回“真实生成验收通过”；审计成本字段为 `10,000,000 microunits CNY`。
- `DEP-003 = PASS`：用一次性临时账号对公网 HTTPS 登录响应实测 `Set-Cookie` 具有 `Secure / HttpOnly / SameSite=Strict / Path=/`；临时账号与会话已删除。
- `DEP-005 = PASS`：513,802,240 字节 MP4 公网上传201、Range206、完整下载SHA与源同为 `db3b808e…abd1`、ffprobe正常；测试素材删除204，库内素材回到416。
- `DEP-006 / OPS-002 = PASS`：修复schema39日常备份入口后，最终自动任务向 `objects/backups/2026-08-14T23-15-59-569Z/` 上传356文件/267,091,270字节；30天保留改为本地签名清单精确删除，不再依赖被RAM拒绝的ListObjects。整机离机包保存于 `/Users/mymy/Documents/unboundry/recovery/2026-08-15`，874,823,680字节、SHA `d3b6023f…ae109`，fresh restore核对release/Node/systemd/nginx、schema39/integrity/FK0、99 tasks/99 attempts、416 media和生成开关全部PASS，receipt SHA `151c7886…f3962`。
- `DEP-007 = PASS`：公网真实Provider生成已成功且安全门仍生效；本次只提交一次，不为测试熔断而制造额外付费失败。未来Agent再次发付费请求仍需新的明确授权。

### 2026-08-09 状态收口与交接索引

- 验收状态收口（用户 2026-08-09 确认）：`GEN-010 / SAFETY-004 / CANVAS-019 / AUTH-004 / AUTH-005 / AUTH-006 / AUTH-007` 已由 `USER_RECHECK` 改为 `PASS`。
- 第二批验收状态收口（用户 2026-08-09 确认）：`STORAGE-004 / PERF-002 / PERF-003 / PERF-004 / PERF-005 / DEP-004` 已由 `USER_RECHECK` 改为 `PASS`；该时点原有产品验收矩阵无 `USER_RECHECK` 项。随后新增的施工治理项 `REM-000` 也已于同日获用户确认并改为 `PASS`。
- 当时线上状态（2026-08-09）：生产服务器 `canvas.mymy.ltd` 运行 v0.5.1；该历史状态已被上方 2026-08-15 最终收口覆盖。本地开发 4173 使用 `app/data`，与服务器 `/var/lib/unboundry` 是两份数据。
- **新接手 agent 必读**：`AGENTS.md` → `README.md` → `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md` → `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md` → `spec/UNBOUNDRY_HANDOFF_2026-08-09.md` → 本文件当前 REM 区块 → 验收矩阵当前 REM 区块。

### 2026-08-09 全量修复施工治理（历史；REM-000 用户已确认 PASS）

以下表格和随后 2026-08-14 原生产预检段保留切换前施工时点；其中 `IN_PROGRESS / HOLD / 当前动作 / 尚未完成` 均为历史事实，最终状态以本文顶部 2026-08-15 收口段为准。

- 用户明确要求先做施工文档，防止上下文压缩、换 Agent 或长任务后失忆和范围漂移；本批授权只包含文档，不包含业务代码、测试配置、脚本、commit、push 或发布。
- 新建 `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md`：冻结线上 v0.5.1、schema 37、红线、既有产品合同、34 类审计风险、REM-000～011 施工顺序、G0～G7 绿灯、数据库桥梁版本和回滚规则；首选保持 v0.5.1 双向兼容、仅一次最终发布，若不兼容必须单独说明并获得桥梁/最终版两次生产授权。
- 新建 `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`：记录当前唯一施工项、Git 基线、已有脏文件、授权、外部动作计数、未决决策和恢复硬停止点。
- 新建项目级 `AGENTS.md`，并更新 README、交接文档和验收矩阵入口；恢复后不得凭内部记忆继续，必须先核对仓库文档和 Git。
- 文档建立基线：`main`、HEAD `262c66c4087d915b03971191ee00a9bfba74da65`、相对远端 ahead 1、package/线上 `v0.5.1`、数据库 v37；一次性 Goal 的本地基线 commit 为 `34909f283e417c6772dcbdfebb6e717db85d0605`。REM-001 已固定离线施工 Node `v22.23.1`、npm `10.9.8`；这只是本地候选基线，历史生产记录仍为 `v22.23.2`，原生产未获 SSH 授权复核当前版本。
- 已有 `TASKS.md`、验收矩阵、交接文档三份未提交修改来自用户已确认的六项 PASS，本批保留并在其上追加，没有 reset、clean 或覆盖。
- 用户已于 2026-08-09 明确启动一次性离线 Goal，并把 REM-001～010 与 REM-011 离线工程部分合并授权；中途按施工文档依赖顺序连续实施，不再逐项询问。2026-08-13 用户又确认桥梁 `v0.5.2`、最终 `v0.6.0` 的版本方案；该确认不授权生产、真实数据、原生产连接/迁移、push/tag/PR、tag/release 或发布。

| ID | 施工包 | 切换前状态（历史） | 当时下一道门 |
|---|---|---|---|
| REM-000 | 施工文档与防漂移机制 | PASS | 2026-08-09 用户确认通过 |
| REM-001 | 测试安全底座与真正全量发现 | USER_REVIEW | 安全入口、105/520 清单、源码覆盖和首轮全绿证据已完成；Goal 结束时集中交用户复核 |
| REM-002 | API、进程与可观测性基础 | USER_REVIEW | 统一异常边界、严格维护/关闭、只读 readiness、脱敏日志与进程生命周期已完成；Goal 结束时集中交用户复核 |
| REM-003 | 画布持久化与 DATA-005 语义保护 | USER_REVIEW | 加载/保存基线、每标签高水位、跨标签收敛、原子墓碑、持久草稿及生成门禁已完成；Goal 结束时集中交用户复核 |
| REM-004 | 统一媒体生命周期 | USER_REVIEW | 原子发布/补偿、ready-only、权威尺寸、adoption ACK 与完整性报告完成；F-004/F-036 和 F-005 媒体发布子范围关闭 |
| REM-005 | 生成、幂等与付费边界 | USER_REVIEW | 原子 admission、最终付费闸、凭据 epoch、未知结果保护、deadline 与持久队列完成；单 active process 前提 |
| REM-006 | 账号删除、模板、权限与清理 | USER_REVIEW | PERM-011/KEY-008/AUTH-006 下的可重试删除 saga、转交、权限/凭据和 actor fence 已完成；等待用户复核 |
| REM-007 | 前端生成恢复与失败体验 | USER_REVIEW | 四类 ownership/exact GET/终态 ACK、transport/retry fail-closed 与 mutation 失败体验已完成；等待用户复核 |
| REM-008 | 资源、安全、性能和运维脚本 | USER_REVIEW | 登录/SSE、媒体资源、出站、安全头、依赖、脚本及必要性能治理已完成；等待用户复核 |
| REM-009A | 只读备份、恢复与数据库兼容前置底座 | USER_REVIEW | 加密签名包、合成库恢复、损坏拒绝、权限/路径/OSS 完整性与三轮/全量证据已完成；Goal 结束时集中交用户复核 |
| REM-009B | 最终候选备份、恢复与双向兼容演练 | USER_REVIEW | 自动实现及同源自动证据完成；等待用户复核，不是 USER PASS |
| REM-010 | 不可变发布、切换与回滚 | IN_PROGRESS | B14 `3b48f61c…` / F14 `eb4f99ea…` source pair与proof `517d2d24…`已形成；只追加两个完整exact hash，未做trim/normalize，schema37/38/39正负例、两版m81 41/41、tsc/source coverage/build PASS。formal Linux artifacts/receipt与Node22.23.2恢复副本门待完成 |
| REM-011 | 候选全量验收与正式发布门 | IN_PROGRESS | 旧B13/F13证据只作回归基线。F14 clean targeted `81/81`、full `2832/2832`、race `1420/1420` 全部PASS，异常0、snapshot/listener不变、suite cleaned；Linux production-validation尚未完成。真实OSS HEAD/GET、bwrap、正式备份、条件修复与bridge切换均已获授权，按门禁顺序执行中；完成前production HOLD |

### 2026-08-14 原生产 bridge 只读预检与 B14/F14 重铸（历史）

- 用户最新明确“全部授权”，范围按最近的五道 bridge 门解释：允许连续完成 `v0.5.2` 的 formal Linux/bwrap、真实OSS只读HEAD/GET、维护停服、完整备份/恢复、严格rowid14修复、Node22.23.2副本补证、切换与必要回滚；不含 `v0.6.0`、schema39 migration、真实 Provider、push/tag/PR。当前动作尚未执行完成。
- 只读现场确认 `unboundry.service`、`/opt/unboundry`、Node `22.23.2`、schema37。用户显式接受 Node22.23.2 production-specific waiver；formal manifest 的22.23.1绑定保持不变，后续必须在恢复副本用同一22.23.2二进制/SHA补充验证，不能把旧formal receipt直接冒充实际生产runtime证据。
- 数据库 `integrity_check` 正常，但 `foreign_key_check` 精确发现 `project_metadata rowid=14` 一条孤儿。用户仅授权在维护、旧服务停止、无写者、可恢复原始备份与精确前后复核全部成立后删除该行；这些先决条件尚未满足，故尚未执行。
- B13 readiness 对两个历史等价 sqlite_schema 原文 fail-close：`asset_history=0053af18…65300`、`provider_profiles=47a50d88…d87e2`。已证明差异仅为空白/标识符引号且完整 pragma 语义一致；选择 B14/F14 exact full-hash allowlist，而不是重建生产表。候选同时在 runtime 与 backup inspection 两门追加 exact hash，并保留未知空白/语义近似拒绝。
- 正式备份仍需覆盖70个 ready OSS对象及可信 versionId；本地字节不等于正式镜像。真实 OSS HEAD/GET 与 bwrap 已获授权，但必须先取得逐对象version-pinned镜像并通过完整性门；不得以不完整备份启动维护或删除 row14。
- 最新只读复核重新锁定原生产身份且未产生状态变更：SSH host key严格匹配；hostname `VM-0-5-ubuntu`，unit `/etc/systemd/system/unboundry.service` SHA `7a675665…`，app `/opt/unboundry` package `0.5.1`，Node22.23.2二进制SHA `3517c2df…`；schema37、integrity ok、唯一FK仍为rowid14、ready local346/OSS70、pending/failed/active generation均0。主库/WAL SHA为 `ba600dab…` / `c862a1ea…` 且查询前后identity不变。服务仍active并持有可写WAL，nginx仍正常代理，正式备份目录不存在、OSS staging为空；所以在formal/镜像/备份门完成前未启维护、未停服、未写库。
- bwrap 预置门已关闭：生产 apt candidate `0.9.0-1ubuntu0.1` 的 deb SHA `1b506492…`；安装前先解包确认 `/usr/bin/bwrap`与B14 manifest的binary/version-output SHA `52231e1c…` / `768cbc12…`精确一致，安装后再次复核并完成root outer、inner全capability set=0、NoNewPrivs=1、仅loopback私网smoke PASS。安装前后`unboundry.service` tuple不变，未进维护或访问数据/OSS。

### 2026-08-12 REM-009B 最终候选恢复与兼容演练（自动证据完成）

- 只用合成富数据、媒体、密钥和假 OSS 完成格式 2 create/verify/restore、one-shot exact-v37→schema39 maintenance migration、写锁内来源复核、中间 schema38/39 与回填故障恢复、假 OSS 重建、正常启动及冻结 exact-v0.5.1→current bridge→schema39 数据格式与安全拒绝边界矩阵；exact v0.5.1 对 schema39 安全拒绝，迁移后不能回滚到 v0.5.1；旧一体化 `deploy.mjs` 已 fail-close。
- 提交前同内容功能树 SHA-256 `7cf46804f952e580e9574a08a93f42ad53c051d4fcd5f2705691f82c8330326b`：核心 8-spec 三轮 `399/399`（deniedViteWildcardProbes `567`），安全全量 `114/114 spec、912/912 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0（full deniedViteWildcardProbes `516`）；Node `22.23.1` / npm `10.9.8`；源码 303，TS/TSX `283/283`、JS/MJS `20/20`，运维脚本 15；snapshot 不变，4173 listener 前后均为 `1be6a5d9061f3be72e5d45a0acf7cb70f5fe86ac645fceff60138b4b718d35dd`。
- 功能提交 `9a158a92563814791fefb8d4e6c5531eca610d78` 包含相同功能内容；未在该 commit 后或文档后树重跑。REM-009B 进入 `USER_REVIEW`，不是用户 PASS，也不是对真实数据、真实 Provider/OSS、生产迁移、发布或 REM-011 最终门的证明。
- 残余边界：current-database-open reservation 可序列化协作打开，但同 UID 非协作进程仍可能替换这个极窄路径；不宣称该风险已消除。一次独立只读审计曾越权对 `app/data` 执行 immutable 聚合查询；结果未纳入证据，写入/外部请求为 0，之后未再访问。
- 在 REM-009B 收口的历史时点，REM-010 刚进入完整离线候选施工，当时为 `IN_PROGRESS`、REM-011 为 `NOT_STARTED`；这些历史 REM-009B 数字不代表本文顶部的最新状态。

### 2026-08-13 REM-010/011 旧固定离线候选证据（现仅作产品 core 历史基线）

- runtime role、跨进程 active lease、请求/SSE/generation drain 已接入应用启动、请求、worker 与关闭生命周期；m81/m93 覆盖这些合同。legacy `deploy.mjs` 继续立即 fail-close，不可作为替代发布入口。
- Darwin 合成环境的不可变 builder/rehearsal 已实现；nginx/systemd 静态运维合同与严格校验器已加入，但不冒充真实生产主机或同版本工具验证。
- 该历史候选的发现清单为 `117 specs / 931 tests`；源码覆盖为 `309 = 286 TS/TSX + 23 JS/MJS`；运维脚本为 `18 = 15 行为验证 + 3 哈希冻结`。此前修复后 targeted m81/m93/m94/m95/m96 为 `49/49 PASS`，其历史证据继续保留；该时点 full 证据见下方。
- 用户随后授权隔离 Docker Ubuntu 子门。受控联网镜像/lock 依赖准备后，正式验证容器使用 `--network none`、无端口、无 host bind、非 privileged；联网准备只持有 package/lock 和私有 cache，不含项目源码、凭据或真实数据。429-file 候选归档 SHA-256 `08917263ed588d77c03d4a9123017119c86121a01b72d65b3e2a0fe11e8ecd01`，容器一次性 clean commit `6e1e9eef95e3c1f45cb0c5d11faa7c6cd16650fb` 仅标记为 `isolated-docker-ubuntu-amd64-ephemeral-candidate`，`formalReleaseCommit=false`。
- Ubuntu 24.04.4 amd64/glibc 2.39、Node `22.23.1` / npm `10.9.8` 下，隔离 cache 的 `npm ci --offline` 安装 185 packages 并 PASS；active/maintenance 两份渲染配置均由 nginx `1.24.0` 真实 `nginx -t` PASS，systemd `255` 的 `systemd-analyze verify` PASS。未启动 nginx/systemd/Vite、未监听或连接 4173。
- production builder 以普通 `unboundry` 用户、0 effective capabilities 动态执行正式 Linux 分支；Docker Desktop 拒绝 bwrap 建立 rootless user namespace，builder 返回 `RELEASE_COMMAND_FAILED` 并明确 `fail-closed incomplete release reservation retained`。release 只含 0700 目录与 0600 `.incomplete`，没有完整产物；这是 `ENVIRONMENT BLOCK` 和失败关闭证据，不是 builder PASS。
- 用户随后单独授权仅通过 SSH 在第二台、非原项目生产的 Ubuntu 24.04 x86_64 服务器执行隔离验证。`isolated-server-ubuntu-amd64-ephemeral-candidate` 的 429-file tar SHA-256 为 `a322ec21affe7c2e73c510fceb74d5c953bee213b25084954b735f18d7be494b`，一次性 clean commit `ef206cd3dcc94ea6657a12ab7963580fe4e9bb5c` / tree `ab68ce7d3725869e674a7b7a7c3fdb0b74e5d29e`，`formalReleaseCommit=false`。
- 首次 production builder 将 `npm ci --omit=dev` 留下的空 `node_modules/@playwright` scope 目录误判为运行时开发依赖，按设计 fail-close 并保留 `.incomplete`。窄修复后仅允许该空目录，继续拒绝非目录或任一 `@playwright/*` 子项；r2 以普通 `unboundry` 用户、0 effective capabilities 在 Linux x64/glibc + bwrap 断网路径真实 PASS。manifest SHA-256 `79e5d45dfbb9e51ec7fc60e1f5527a11f30f1d3d9638b682741c4306a25db02a`，5270 条 inventory 独立精确复核一致，release 为 0500、无 `.incomplete`，`networkSandboxVerified=true`，网络 namespace 拒绝探针通过，构建步骤未观察到外网尝试。active/maintenance `nginx -t` 与 `systemd-analyze verify` 真实 PASS，未启动服务；现有 nginx/Docker 配置和服务未修改、未 reload/restart，4173 listener 为 0。
- 修复后当前树在 Node `22.23.1` / npm `10.9.8` 下重跑 m81/m93/m94/m95/m96：`49/49 PASS`，所有异常计数为 0，`deniedViteWildcardProbes=198`；snapshot SHA-256 `7bf6b035e3b909098ae64fd255d14ddef7258b6bf3860c75970f344434b58038` 前后不变，4173 listener 身份前后不变。
- 随后的第一轮 full 为 `117/117 specs、930/931 PASS`；唯一失败是 m92 bridge fixture 显式传入空 `UNBOUNDRY_MAINTENANCE_MODE`，严格 runtime role 合同按设计报 `RUNTIME_ROLE_INVALID`。产品 parser 未放宽；仅把 fixture 改为 `UNBOUNDRY_RUNTIME_ROLE=active`、maintenance `0`，并在 m93 增补空串拒绝断言。m92+m93 targeted 随后 `9/9 PASS`。
- fresh full 在 Node `22.23.1` / npm `10.9.8` 下为 `117/117 specs、931/931 PASS`，failed/skipped/retries/reportErrors/blocked 全 0，`deniedViteWildcardProbes=534`；builder operational `attempts=1 / builderInvocations=3 / passed=1 / failed=0`。证据绑定 HEAD `9a76edc3deadad7fe1552977bb3f92baad019542` 下 429-file tested source snapshot `1e96e26feb6334611e9c2205e22d25c6eacbac54b224f44bd3b26bdcfd6f030b`，前后不变；4173 listener `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae` 前后不变，suite cleaned、exit 0。
- `1e96e26f…` 属于 m92 fixture 窄修复后、上一轮六文档同步前脏功能树的历史 full，不绑定 commit，也不是 fixed clean/formal candidate、REM-011 三轮、G0～G6、原生产主机运行/迁移/切换、用户 PASS 或发布授权。该历史时点 REM-010 仍为 `IN_PROGRESS`、REM-011 为 `NOT_STARTED`；现行状态以顶部状态和本节后续 fixed candidate 证据为准。production HOLD 从未放开；仅第二验证机 SSH 获本次授权，未连接/修改原生产。真实数据只读越界披露仍以紧邻的 REM-009B 残余边界记录为准。
- 用户随后在端口 58352 的隔离手工验收页发现两个既有 PASS 未覆盖的真实路径：虚拟 `default` 项目卡片进入 `/canvas/default` 后被缺失项目保护弹回工作空间；`Text → Video` 连线和文字均已持久化，但旧规则仍强制 Video 重复填写本节点 Prompt。当前候选把 default 的工作空间/返回画布入口统一到规范 `/canvas`；Video 改为“已就绪上游 Text 或本节点 Prompt 任一即可，两者都有则合并，两者都无仍阻止”，客户端与服务端共享同一解析器。
- m11 绿地默认卡片正向跳转与 m30 `Text + Image → Video` 上游文字、无文字负边界、服务端持久图重解析和零任务/零付费请求均已覆盖；唯一安全入口定向 `17/17 PASS`，Node `22.23.1` / npm `10.9.8`，failed/skipped/retries/reportErrors/blocked 为 0，snapshot `f714feb259dae032d61ad751feb5e67bb0bde07ea6cb0e6d026ecf07b903f9be` 与 4173 listener 均前后不变，suite cleaned。用户随后在端口 58352 的同一隔离实页明确确认默认画布不再回跳、空本节点 Prompt 的 Video 正确接收已就绪上游 Text，两项均通过，`CANVAS-019 / INPUT-005` 恢复为 `PASS`。
- 页面修复后的首轮 full 为 `117/117 specs、930/931 PASS`，唯一失败是 m44 两个协作进程并发打开 exact-current DB 时暴露 reservation 创建/释放竞态，snapshot `84ddf2b9d74b551fecad7fb1e325055be3f8c42103bcf5018e06e2730030eb76`。产品并发协议修复后，m44+m91 targeted `15/15 PASS`；fresh full 为 `117/117 specs、931/931 PASS`，failed/skipped/retries/reportErrors/blocked 全 0，`deniedViteWildcardProbes=534`，builder operational `attempts=1 / builderInvocations=3 / passed=1 / failed=0`。证据绑定 HEAD `9a76edc3deadad7fe1552977bb3f92baad019542` 下 429-file tested source snapshot `db91d80b2605d638f5cb2df296a81292b52dcf4b98fa874e934e83737495532f`，前后不变；4173 listener `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae` 前后不变，suite cleaned、exit 0。
- 上述脏树证据首先冻结为 clean candidate `b9b4691`，但两个 OS 进程 Provider save 压力运行暴露 `Application database sidecars changed before writer open`，确认为 SQLite 最后旧 writer 关闭时的真实 WAL/SHM 交接竞态；`b9b4691` 因此失效，不得再当作候选。
- 替代候选 HEAD `8b639ffe6c5f091c51e1914f2e2c18edf9333d90`、tree `219c4df072426cfe92f33dc4045f021064972e9c` 使用 held-reader 窄修复：完整 WAL/SHM 对（包括零字节 WAL）走普通只读检查，inspection 读事务保持到新 writer 取得 `BEGIN IMMEDIATE`并完成 identity/sidecar/schema/digest 复核后才释放；symlink/hardlink/unsafe/orphan/journal 继续 fail-close。m91 确定性覆盖 hot-WAL 与 zero-WAL 的旧最后连接关闭。
- 最终 fixed clean offline candidate 含 429 files，source/snapshot SHA-256 `652b946441ee46e43bcbfbfc635dfc5aaacf5e640529ebec5bc7bd34c798dbb0`。三个独立 fresh full 每轮均为 `117/117 specs、931/931 PASS`，合计 `2793/2793`；各轮异常计数全 0、`deniedViteWildcardProbes=534`、builder `1/3/1/0`，合计 builder `3/9/3/0`；日志 SHA-256 前缀依次 `c5a8da15…`、`06aed03d…`、`edbb4550…`。
- 关键包压力两轮各为 `5 specs × repeat 10 = 570/570`，合计 `1140/1140`，每轮异常计数全 0、`deniedViteWildcardProbes=1980`，各关键场景累计 20 次；日志 SHA-256 前缀 `881023af…`、`edefe9ea…`。五轮均为 Node `22.23.1` / npm `10.9.8`，snapshot unchanged，4173 listener `dfd25fc2…` unchanged，suite cleaned、exit 0。
- 该时点曾按旧合同记录候选绑定 G0～G6 全绿并把 REM-010/011 置为 `USER_REVIEW`。F-054 后这些数字只保留为 `8b639ffe…` 产品 core、安全 runner、runtime/lease/drain 与合成运维底座的历史基线，不得转移为 `v0.5.2` bridge 或 `v0.6.0` final 的正式 release 门。

### 2026-08-13 F-054 双引擎桥梁纠偏与版本方案确认（REM-010/011 重新施工）

- 审计确认现有 source 在 schema37 仅进入 `schema37-health-only-standby`，除健康接口外的业务 API 返回 `503 SERVICE_SCHEMA_STANDBY`；m95/rehearsal 中的 bridge、exact、candidate 为合成夹具，未执行一个能在 schema37 正常营业、在 schema39 作回滚目标的真实 release runtime。因此 `8b639ffe…` 不是可发布桥梁，REM-010/011 回到 `IN_PROGRESS`，登记 P0 `F-054`。
- 用户确认版本方案：兼容桥梁 `v0.5.2`，最终候选 `v0.6.0`。该确认时 package 仍为 `0.5.1`；该确认只关闭 DEC-REM-005，不是 tag/release 或任一原生产授权，DEC-REM-006 仍 pending，production HOLD。
- 冻结 `v0.5.2` 为单一不可变双引擎产物：共享外层 supervisor 是唯一公网 listener，并统一执行 runtime role、active lease、request/SSE/generation drain；启动先只读探测 `user_version`。schema37 路由到内嵌 exact-v0.5.1-compatible 引擎，只开放登录/会话、项目/画布等基础业务读写与既有媒体读取，生成提交/重试/取消、上传/删除/发布等高风险 generation/media mutation 全部 fail-close，离线验证 `generation_provider_attempts=0` 且成功外部出站0；schema39 路由到内嵌 v0.6.0-compatible 业务引擎并可作迁移后回滚；schema38/未知版本只允许维护态 fail-close。健康检查/启动不得迁移，显式 one-shot migrator 仅可在维护、排空和备份完成后运行。
- bridge manifest 必须分别绑定并哈希 supervisor、两个引擎、lock/build 输入与静态资源；运行时不得拉 Git 或联网组装。`v0.6.0` 是独立不可变最终产物，只以 schema39 完整营业，不把 health-only schema37 standby 冒充 bridge。
- 双阶段离线门冻结如下：第一阶段对 `v0.5.2` 证明 schema37 基础业务允许面真实读写、所有高风险 generation/media mutation 确定性拒绝、`generation_provider_attempts=0` 且成功外部出站0，schema39 完整业务回滚，schema38/未知 fail-close、无启动迁移、唯一 writer/worker 与排空/恢复、不可变构建清单和跨引擎旧静态资源；第二阶段对 `v0.6.0` 证明显式 v37→v39 迁移、schema39 完整业务、失败恢复与回滚到同一 `v0.5.2`、三轮全新环境、关键竞态压力和全部发现测试零异常。两个阶段都只用临时合成数据、动态 loopback 与假 Provider/OSS；测试完成前不得继承旧 G0～G6 结论。
- 离线两阶段全部通过也只可进入 `USER_REVIEW`；先连接/发布 `v0.5.2`、再迁移/发布 `v0.6.0` 是两次独立生产动作。该历史时点尚未连接原生产；现已只读预检并取得bridge准备窄授权，现行边界以本文顶部B14/F14段为准。

### 2026-08-13 F-054 双引擎桥梁源码定向门（历史 pre-formal）

- 本轮桥梁源码证据快照将 `package.json`、`package-lock.json` 顶层和 lock 根的三个版本值统一为 `0.5.2`。当前安全清单发现 `117 specs / 938 tests`，源码 `319 = 292 TS/TSX + 27 JS/MJS`，运维脚本 `18 = 15 行为验证 + 3 哈希冻结`。
- P1-A 关闭 duration owner 漂移：exact-v0.5.1 child 使用不含 ffmpeg/ffprobe 的受控 PATH，warmup 只补 checksum，唯一有效 PCM WAV duration 在 bridge 启动前后都保持 pending；显式 migrator 恰好回填 1 条，final 恰好读到 1 条 ready。
- P1-B 关闭先决件生命周期漂移：safe runner 按 iteration 持有 bridge/final 共用的 ffmpeg/ffprobe，在构建、运行和清理前重复核对 path/inode/uid/mode/nlink/size/time/hash/version，只在 suite 末统一清理。
- P1-C 关闭版本改写伪直子关系：新 source-pair 证明 `0.6.0` 是 `0.5.2` 直接子提交，且唯一变化是 package/lock 三个版本值。本轮 Mac 门使用隔离临时 Git 中的 `synthetic-direct-child-fixture`；formal 门始终必须从 Git 现场证明 `0.6.0` 为 clean HEAD、唯一真实父提交是 formal `0.5.2`，且只改三个版本值，不允许重写 bridge。
- P1-D 关闭 m92 来源伪证：m92 只读认证 operational release attestation，从 admitted manifest 启动 bridge/final，并调用 bridge 产物内 migrator，不再使用当前 checkout、手写 final shim 或 checkout migrator。
- 首轮七个关键 spec 为 `74/75`，唯一失败是 m92 夹具的 `fetch` 未保留显式 `Host: canvas.mymy.ltd`。产品代理头规则未放宽；夹具改用 `node:http` 后 m92 `2/2 PASS`。最终重跑发现 `117/938`，执行 `7 specs / 75 tests`且 `75/75 PASS`，failed/skipped/retries/reportErrors/blocked 全0，`deniedViteWildcardProbes=186`，builder `1/5/1/0`。证据绑定 HEAD `8f607cdb5f70d760033699077dab738575a4ea69` 下文档同步前 440-file source/snapshot `47fc53b93eaa6af2379484211979d7cec5199bc21dada1b424b0561f59d4c084`，log SHA-256 `4e41ed6f23795eb161746c8d370bc75bf4570a0e3798f0358e2f7832a7a334db`；snapshot 前后不变，4173 listener `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae` 不变，suite cleaned、exit0。
- 该 `47fc53b9… / 75/75` 证据形成于 B/F 提交之前，永久只是 Mac synthetic direct-child/artifact 定向门，不是 full、三轮全新环境、关键竞态压力、formal `v0.5.2` artifact、formal `v0.6.0` direct child、Linux production-class builder、原生产核验或发布。该历史时点 REM-010/011 保持 `IN_PROGRESS`；现行状态以下一节为准。

### 2026-08-14 formal B13/F13 离线候选收口

- formal bridge B13 为 commit `51ef51ad18ae7cb7053147ba3c1dc8577fcd771d` / tree `663228d401a03e0afaa4d644aa54347f065f3eaa` / `v0.5.2`；formal final F13 为其唯一直接子 commit `a9051ce896cb6dda8e1ec6d1593f1de128484378` / tree `94bd8ccd8febb61aaa07304423f9c2242f4e96ac` / `v0.6.0`。B13→F13 仅 `package.json`、`package-lock.json` 三个版本值变化，source-pair proof 为 `960f50b3bee454a30f148ca9db13379d3ad5275cb3109349285def71fbffb7e5`。
- formal targeted 为 `79/79 PASS`（日志 SHA-256 `0549e23d15e950b7c89138365b8ddf4e452d7d039e906e0dd71021251d0f7852`）。三个独立 fresh full 每轮均为 `117/117 specs、942/942 PASS`，合计 `2826/2826`；两轮关键包均为 `6 specs × repeat 10 = 690/690`，合计 `1380/1380`。每轮 failed/skipped/retries/reportErrors/blocked 均为 0，Node `22.23.1` / npm `10.9.8`，F13 下 443-file source/snapshot `b36a20db6fe3c75f20e59d5ed96bc98ed8737bbe85c4d05e0f7e3c59364e2436` 前后不变，4173 listener `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae` 不变且 suite cleaned。full 日志/摘要 SHA-256 为 `34291275… / 79015673… / 70269938…`，race 日志为 `8500e51a… / 00f16e7f…`。
- 第二台非原生产 Ubuntu 验证机的隔离 Linux production-validation 对本轮 B13/F13 正式 PASS，receipt SHA-256 `8f1ea00385828327d81bc7c9f9f7ef71a48fe87c58d6cb190ce45953a59c36eb`。它实际完成 schema37→39、B37→B39→F39→B39 rollback→F39 reswitch、真实 60 秒 drain、2 次 native duration probe、1 条 backfill、备份/验签/恢复与零成功外部出站；`/var/lib/unboundry`、current pointer、4173、宿主服务与旧证据根均未改变。
- F13 lock 的 234 个非根依赖节点与 REM-008 历史 audit=0 提交 `ff9a2adbb9ba93c9646935b2b22b318fb5503f21` 的精确图逐项相同；本轮没有新的 advisory 数据库，因此不得写成 fresh audit。
- G6 用户 A/B/C+final 四阶段实页验收已最终 USER PASS：B13/schema37 确认登录、文字编辑/保存/刷新、250×250 自动换行与既有图片；F13/schema39 追加 `-F39通过` 并刷新保持；回滚 B13/schema39 追加 `-B39回滚通过` 并刷新保持；最终重切 F13/schema39 后两次修改、图片与换行均保持。证据 SHA-256 `d9f781600e169b93da6955fbc3395a24747edde148942b12fdcec7fa3d85358d`。期间合成禁用 Provider 的一次检查连接返回 HTTP 400；无付费生成或成功外部出站，`generation_provider_attempts=0`，但确有一次失败的 Provider 检查尝试。
- G5 已在 DEC-REM-007 单次不可变审批绑定下完成 formal Linux supplement：executionId `61b1b5dfab2e78ec4fd8d93a2caa13af3f3e724cadb489133ff6b0e191d8e755`，outer receipt `PASS / formalG5Evidence=true` SHA `ed319a33611c8b0454fdab16e0ae85cc27bb1711a5c10a6df389bc57ee8d620b`，inner candidate `380ec25897f8d642c379301a313a572eb20d31e75a1ffefcc454a89487b64ad0`，requests `15d69b90ffdd4a686fd3653f664c0ec90f933281e16757f57ce07f13e5f43a92`。B37/B39/F39/B39_ROLLBACK/F39_RESWITCH 共`700/700`且传输错误0，G5 coverage为`PASS`。该B13/F13证据现只作B14/F14回归基线；REM-010/011为`IN_PROGRESS`，G7/production HOLD。

### 2026-08-09 REM-001 离线安全底座（工程候选已完成）

- 固定本地施工运行时：Node `22.23.1`、npm `10.9.8`；`.node-version`、`packageManager`、engines 与安全入口相互校验。依赖在隔离快照内执行 `npm ci --offline --ignore-scripts`，安装前后 package/lock 哈希不变。
- 新增唯一安全入口 `scripts/run-safe-tests.mjs`、Node 网络守卫、浏览器守卫、源码覆盖清单和逐 spec 模式清单。105 个 Playwright spec 精确分区，运行时发现 `105/105` 文件、`520/520` 唯一测试；`skip/only/fixme/retry` 均为 0。
- 每个 spec 使用新的系统临时目录、独立 HOME/cache/report/data 和两个动态 loopback 端口；Node 与浏览器只允许本轮登记端口，4173 的 bind/connect 均会失败。真实 Provider/OSS/代理凭据不进入子进程，Vite 安全模式不读取仓库 `.env`。
- 内核文件负控对真实数据、备份、密钥等受保护路径完成 24 次拒绝验证，测试子进程成功访问真实路径为 0；网络负控 24 类全部通过。所有受管命令均有独立进程组、超时 TERM→KILL、进程组消失与端口释放证明。
- 源码门动态覆盖当前 272 个源文件：TS/TSX `258/258` 纳入类型检查，JS/MJS `14/14` 语法检查；9 个运维脚本为 4 个行为验证 + 5 个哈希冻结。生产构建、绿地检查、两次重启持久化均在隔离沙箱中通过。
- 第一次诚实全量运行暴露 18 个失败和 1 个串行连带未执行项；逐项归因后修正陈旧路由/文案、等待假绿、坐标时序和本地模块误计，并修复 4 个 review 新发现问题：F-035 权威媒体元数据预检、F-037 账号浮层重渲染覆盖选择、F-038 render 内重定向、F-039 模板动画期间保存风暴。
- F-035 定向安全测试 `8/8`；m17/m70 修复后五轮 `120/120`；修复后首轮全量为 `520/520 PASS`，`failed/skipped/retries/reportErrors/blocked = 0`，临时目录已清理，4173 监听身份哈希前后不变。
- 新增 F-036：参考图片宽高仍未从 `media_assets` 以权威字段进入通用预检，图片尺寸/比例规则可能静默绕过；已登记到 REM-004/005，未在 REM-001 擅自扩张持久化施工。
- `GOV-001`：一名只读 reviewer 曾用仓库级文件枚举只看到被忽略的备份/密钥文件名，没有读取内容、stat/hash、修改或网络动作。故最终只能声称“安全 runner/测试子进程真实路径访问为 0”，不能声称整个 Goal 所有 agent 行为绝对为 0。
- 本项保持 schema `37`、package `0.5.1`，未访问真实数据、4173、真实 Provider/OSS、生产、SSH，也未 push/tag/PR/发布。工程状态进入 `USER_REVIEW`；本轮合并授权允许继续 REM-002。

### 2026-08-09 REM-002 API、进程与可观测性基础（工程候选已完成）

- 新增统一 HTTP 请求边界：13 处 JSON body reader 收敛到相同的大小、Content-Type、UTF-8 和中止规则；20 个服务路径入口及 3 个编码文件名改为安全解码；畸形 `%`、过大请求、错误媒体类型和异步异常只返回结构化 4xx/5xx，不再形成未处理 Promise。
- 每个请求使用 UUID request ID，并只写固定 8 字段的脱敏结构化日志；业务 4xx/5xx 不再被错误记录成 `OK`。维护和关闭期间只放行已证明无副作用的 health/version 路由，其余 API（包括会懒迁移、回填或恢复任务的 GET）统一返回 `503 + Retry-After`。
- 就绪检查不调用 `openAppDatabase`、不初始化任务存储、不创建业务行。它只读核验 schema 37 的完整迁移账本、19 张表、27 个显式索引、5 个触发器及 SQLite 完整性；活跃 WAL 有 SHM 时读取已提交快照，无 SHM 时 fail-closed。已登记且逐项验证 v21 目录修复与 v31→v32 模板补列的有限历史物理形态，未知或语义损坏形态一律不就绪。
- 优雅关闭同时等待响应、handler 清理、请求体和 SSE；大/慢请求体会被安全排空，SSE 收到维护事件后结束。Vite dev/preview 的 SIGTERM/SIGINT 处理改为精确捕获并恢复自己的监听器，不删除宿主监听器；超时或 close 失败有硬截止。生成任务的 3 个后台启动点统一吸收同步 throw、Promise rejection 和失败回写异常，避免未处理 rejection 杀进程。
- 登记并关闭 F-041～F-047：维护 GET 副作用旁路、只看响应的假排空、后台生成 rejection、readiness 假阳性/WAL 语义、Vite 信号所有权、错误日志记成 OK、JSON/URL 错误边界不一致。
- 专项 `m81` 为 `17/17 PASS`。最终安全全量在固定 Node `22.23.1` / npm `10.9.8` 下发现并执行 `105/105 spec、536/536 PASS`；`failed/skipped/retries/reportErrors/blocked = 0`；源码门为 274 个文件、TS/TSX `260/260`、JS/MJS `14/14`，构建、重启持久化、临时目录清理均通过。
- 一次诊断全量中，安全入口检测到本轮之外的 4173 守护服务监听身份在运行期间变化并正确 fail-closed；没有连接、终止或重启该服务。外部监听稳定后重新完整执行为 `536/536 PASS`，前后监听身份 SHA-256 均为 `0bbb8e5874e169f362481f626b49123e554ae478e4c261b7691e2eb30e80c14f`。
- 本项保持 schema `37`、package `0.5.1`；未读取/修改真实数据，未操作 4173，未请求真实 Provider/OSS，未连接生产，未 push/tag/PR/发布。工程状态进入 `USER_REVIEW`，当前施工切换到 REM-009A。
- REM-002 本地功能提交固定为 `c7b2af01b5441fe9532d7f1e2696cd4fc2ceac89`；仅存在于专用本地分支，未 push/tag/PR。

### 2026-08-09 REM-009A 只读备份、验签与恢复底座（工程候选已完成）

- 新增格式 2 加密备份包：数据库、媒体、密钥和假 OSS 镜像逐文件 AES-256-GCM 加密，恢复密钥使用 RSA-3072 OAEP-SHA256 包裹，整个包由 Ed25519 独立签名；恢复私钥与可信签名公钥始终在包外。
- 源库不再调用 `openAppDatabase`、不做 checkpoint 或迁移；只把 SQLite main/WAL/journal 原样复制到本轮私有临时目录，再在副本上生成一致快照。检查覆盖 schema 37 完整迁移账本、19 张业务表、`sqlite_sequence`、完整 schema、行级逻辑指纹、integrity/FK、三类密钥文档真实解密能力。
- 媒体同时覆盖已登记本地文件、孤儿本地文件和 ready OSS 对象内容镜像；每个 OSS 镜像强制绑定 `object_key + versionId + byte_size + checksum`。任何带 `object_key` 的 pending/failed OSS 行直接拒绝备份，不能静默遗漏。
- 所有数据、包、工作目录、密钥和镜像路径均核验完整可信父链；输入文件读取前、打开后、读取后复核 owner、权限、inode、大小、时间与硬链接数。私钥必须 0600 等价最小权限，签名私钥不能被伪装成 OSS 镜像打包。
- 创建和恢复使用独占目录预留、不可覆盖的逐项发布与 incomplete marker；运行时 readiness 会拒绝任何残留恢复 marker（含悬空符号链接）。损坏签名、manifest、任一密文对象、外来文件、竞态替换或中途故障都不会覆盖既有目标。
- 旧的真实 OSS 上传/镜像脚本继续 fail-closed 冻结；新增显式绝对路径、显式 `--source-frozen` 的 backup/verify/restore 薄入口，不存在默认 `app/data` 或仓库 backups 路径。
- 新登记并关闭 F-050～F-053；REM-003 只读复核另登记 F-048/F-049。专项 `m10 9/9`；最终快照三轮 `27/27`；最终安全全量 `105/105 spec、542/542 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0；源码 277，TS/TSX `262/262`，JS/MJS `15/15`，4173 监听身份不变。
- 两路独立终审均确认剩余 P0/P1 为 0。保持 schema `37`、package `0.5.1`；未读取/修改真实数据，未请求真实 Provider/OSS，未连接生产/SSH，未 push/tag/PR/发布。
- REM-009A 本地功能提交固定为 `ee998db80414cabb211fdc590712a0c257a25e50`；仅存在于专用本地分支。工程状态进入 `USER_REVIEW`，当前唯一施工项切换到 REM-003。

### 2026-08-09 REM-003 画布持久化与 DATA-005 语义保护（工程候选已完成）

- 服务端把 canvas、项目更新时间、删除墓碑复核与每账号/画布/会话高水位放入同一 `BEGIN IMMEDIATE` 事务；同标签旧 sequence、同 sequence 异 attempt、进程重启后的旧 load token 和 legacy 高风险交接均 fail-closed，不同标签继续保留 DATA-005 最后保存者胜。
- GET/PUT 使用进程 epoch、owner/canvas/revision 绑定的加载凭据；candidate 保存、revision 0、404/create、项目删除、账号物理删除、容量上限和 SQLite 故障均有稳定结构化合同。OpenAPI 同步 GET/PUT/DELETE、401/403/409/503 精确响应。
- 客户端只有当前账号+画布成功 hydration 后才开放编辑、保存和生成；保存 journal 以 session/sequence/attempt/epoch 严格 CAS 持久化，覆盖普通保存、pagehide、丢响应、超时、重载、BFCache 状态机、跨标签广播与外部基线重放。未知提交结果重试同一 payload，确定性冲突保留草稿且停止付费入口。
- 节点生成轮询、重试、任务面板和媒体结果均绑定当前 scope、输入 key 与 task owner；旧 scope、旧请求、取消迟到响应或旧任务成功不能覆盖新输入。ReactFlow 在 loading 期只接受纯被动 dimensions 测量，避免首个标题提交把已水化节点隐藏/失焦，同时不产生额外保存。
- 固定 Node `22.23.1` / npm `10.9.8`，测试源码指纹 `2ae382d4b0bed4cfa1e570d1e0172c2b84365dba4abf38ea095eb68e7c59875a`：13-spec 专项 `205/205`，m28 十轮 `30/30`，m41/m85/m86 三轮 `450/450`，安全全量发现并执行 `107/107 spec、687/687 PASS`；failed/skipped/retries/reportErrors/blocked 均为 0。源码 279，TS/TSX `264/264`、JS/MJS `15/15`；构建、两次重启持久化、临时目录清理均通过，4173 监听身份前后均为 `d57f27dc87024c26184ab9233355cabd31cd48d39c03bbe1d301fef586e4470c`。
- 独立终审未发现剩余 P0/P1。schema `37`、package `0.5.1` 不变；测试只用临时合成数据、假 Provider/OSS 和动态 loopback，未读取/修改真实数据，未操作 4173、生产或外部服务。
- REM-003 功能内容提交为 `2a0b7f9819d3075d5fd339e20c5badd389cd51ae`；测试运行于提交前相同文件内容的上述源码指纹，不冒充运行时已经位于该 commit。仅存在于专用本地分支，未 push/tag/PR。工程状态进入 `USER_REVIEW`，当前唯一施工项切换到 REM-004。

### 2026-08-11 REM-004 统一媒体生命周期（工程候选已完成）

- 离线 schema 38 候选新增媒体发布 attempt、媒体删除 intent、账号删除 intent 与约束触发器；本地和假 OSS 统一执行 reserve → stage → publish → finalize，并用持久 journal 完成失败补偿、进程启动恢复、单飞删除与 profile 固定。
- 所有媒体读取、历史、项目/模板封面、生成结果与下载只消费 owner/kind 精确匹配的 ready 素材；F-036 改为以服务端权威尺寸重建输入。客户端只有同步 adoption ACK 成功才采用新素材，否则按精确 ID 补偿；只读媒体完整性 CLI 与格式 2 备份共同核对 schema 37/38、媒体、publication、密钥和假 OSS 证据。
- 本项只关闭 `F-004`、`F-036` 与 `F-005` 的媒体发布/补偿/恢复子范围。Provider 付费、任务幂等、限额、停止重查与未知结果保护继续归 REM-005；账号任务、模板、权限、凭据、审计及完整删除合同继续归 REM-006。
- 固定 Node `22.23.1` / npm `10.9.8`，冻结源码指纹 `f6974d0456eb09b864e7302b85d47172d93d57182610ec42b95c42be4427454c`：8-spec 专项 `158/158`，同组核心三轮 `474/474`，安全全量发现/执行 `109/109 spec、762/762 PASS`；failed/skipped/retries/reportErrors/blocked 均为 0。源码 284，TS/TSX `268/268`、JS/MJS `16/16`；11 个运维脚本为 6 个行为验证 + 5 个哈希冻结。4173 监听身份前后均为 `c9663ffd4e9e26c675482e713e301f681f172b976a50df952d903fac9f00da0e`，本 Goal 未连接、终止或重启该监听。
- 两路独立终审未发现剩余即时产品 P0/P1。REM-004 功能提交为 `9f1019e5686ccce4f646b54a2be6ccd5ab4864d0`；测试绑定提交前相同功能内容的冻结工作区指纹，文档修改后的新指纹不得冒充已运行证据。工程状态进入 `USER_REVIEW`，当前唯一施工项切换到 REM-005。
- schema 38 只是必要 P0 的离线候选，线上 v0.5.1/schema 37 未读取或改动，生产发布保持 HOLD。本段在 REM-004 时登记的富数据备份恢复、one-shot migration、写锁内复核和回填故障恢复要求，现已由 REM-009B 用合成数据完成；结论是 exact-v0.5.1→current bridge→schema39 数据格式与安全拒绝边界成立，exact v0.5.1 对 schema39 安全拒绝，迁移后不能回滚到 v0.5.1。生产 bridge 接线、切换、回滚及必要的两版本/两次独立生产授权仍归 REM-010。

### 2026-08-11 REM-005 生成、幂等与付费边界（工程候选已完成）

- schema 39 在 schema 38 媒体底座上新增 owner-scoped idempotency、generation admission 账本、credential epoch 高水位及带 outcome/revision/scope 的 Provider attempt 账本；schema 37/38 加密备份继续由各自冻结合同精确检查。
- `BEGIN IMMEDIATE` 内原子完成稳定意图幂等命中、安全开关、RPM/并发/熔断 admission 与任务插入；最终付费边界再次核验停止状态、owner/model/profile/credential revision 与权威参数，排队后急停不能越过 Provider 边界。
- Provider 已 accepted、response-received 或 outcome-unknown 时不得自动创建新付费 attempt；只有全部既有 paid evidence 均为 definitive-rejected/provider-failed 时才允许新付费重试。失败且结果可能已存在的任务可由用户显式 abandon，账本与 remote ID 保留且 Provider 请求为 0。
- 关闭 `F-008`、`F-009`、`F-010`，并与 REM-004 一起关闭 `F-005`；`F-014` 只关闭 Provider deadline 子范围，结果 URL 出站保护仍归 REM-008。上述结论以单一 active process 为前提，`F-023` 仍归 REM-010。
- migration 39 的 admission 表不从历史任务推断回填。REM-009B/010 必须演练：冻结新生成、排空活动任务、自最后一次可能 Provider admission 起至少 60 秒无新 admission，再执行 one-shot exact-v37→schema39 迁移并只启动唯一 active worker。
- 固定 Node `22.23.1` / npm `10.9.8`，冻结功能树指纹 `6a1363df8a6977e996db4b9e45aa823a89e28d6fe3955d85d6ea0ca9b315fcf9`：m81 `23/23`、6-spec 受影响组三轮 `207/207`、安全全量 `109/109 spec、790/790 PASS`；failed/skipped/retries/reportErrors/blocked 均为 0，`deniedViteWildcardProbes=474`。源码 285，TS/TSX `269/269`、JS/MJS `16/16`；11 个运维脚本为 6 个行为验证 + 5 个哈希冻结。4173 listener 前后均为 `6fb8de970741a8dee0ab4c8790e237f3fe5a4c0a3cd4c1cd6a89af12fd6e16c7`。
- 三路独立终审未发现剩余即时产品 P0/P1。测试运行于功能提交前、HEAD `2beaec585d2d33a11341b98349b31b89b41d3a62` 的上述冻结脏工作树；REM-005 功能提交 `b3ceba04b5ddcf781dd58ce355be0e0f7665450e` 包含相同功能文件内容，未在该 commit 后或文档后树重跑。本项进入 `USER_REVIEW`，当前唯一施工项切换到 REM-006；这不是用户 PASS、真实数据迁移、真实 Provider/OSS、生产发布或 REM-011 最终三轮。

### 2026-08-11 REM-006 账号删除、模板、权限与清理（工程候选已完成）

- 账号删除以持久 intent 和可重试 saga 收口：先禁用账号并撤销 session，活动或结果未知生成任务阻止删除，公共模板及必要媒体转交受保护最高权限账号，本地/假 OSS 物理媒体逐项清理失败可重试，最终数据库收口再验证 actor、intent、任务、媒体和模板状态。
- 继续严格遵守 `PERM-011 / KEY-008 / AUTH-006`：被删账号的权限、凭据和相关旧审计按原合同清理，仅保留由操作管理员写入的唯一 `delete_user` 记录；受保护最高权限账号不可删除。F-006/F-007/F-017A/F-033 已在离线候选修复，F-032 仅是对上述旧 PERM-011 语义的确认，未改成保留旧审计。
- 权限页仅保存服务端返回的有效额外授予集，GET 失败不开放破坏性保存，同账号保存在途时复选框与保存按钮禁用。账号凭据、Provider profile/catalog 与存储文档真实 HTTP 变更都在最终线性化点重查 actor 删除 fence，SQLite 业务元数据与审计同一事务成败；加密文档在锁内写入，并在确定性审计失败时按快照恢复；远程 probe 在锁外完成后再持锁重查。
- 测试运行于功能提交前、HEAD `731b984d7e32a0b9ee648c0e7fa1bd49e59deb14` 下 403-file 冻结脏工作树，SHA-256 为 `9873952efd5a7b1f0d84d65698be79069a89aae47ab25ff277dabf6b4ef2016d`：14-spec 定向 `112/112`，核心 7-spec `repeat=3` 共 `222/222`，安全全量 `109/109 spec、804/804 PASS`；failed/skipped/retries/reportErrors/blocked 均为 0，`deniedViteWildcardProbes=477`。源码 286，TS/TSX `270/270`、JS/MJS `16/16`；11 个运维脚本为 6 个行为验证 + 5 个哈希冻结。4173 listener 前后均为 `38911ab014a12dd3353ee0897359ebfb26f075144de1ce0b35e760f2df6dea3d`。
- 独立终审未发现剩余即时产品 P0/P1。功能提交 `67cc39302d756bc00bff7ac31e31de7a7f574574` 包含相同的 23 个功能/测试/runner 文件，未在该 commit 后或文档后树重跑。本项进入 `USER_REVIEW`，当前唯一施工项切换到 REM-007；这不是用户 PASS、真实数据、真实 Provider/OSS、生产迁移、发布许可或 REM-011 最终三轮。
- 上述结论仅在单一 active process 前提下成立，进程内 lease/文档锁不关闭 F-023，仍归 REM-010。账号删除不是跨物理媒体的单事务；加密文档与 SQLite 只证明确定性审计失败时不留文档变更，不声称跨文件系统/SQLite 的进程崩溃原子性。线上 v0.5.1/schema 37 保持不变，schema 39 仅离线候选，production HOLD；未读取/修改真实数据，未操作 4173，未请求真实 Provider/OSS，未连接生产。

### 2026-08-12 REM-007 前端生成恢复与失败体验（工程候选已完成）

- F-016/F-017B/F-018 已在离线候选修复。文字/图片/视频/音频节点以持久 `*GenerationOwnershipKey`、exact task/idempotency GET 和完整 model/name/normalized parameters 快照绑定 active task；付费 POST 前先把 effective 快照持久到 canvas 并取得 fresh revision，新任务期间保留旧预览。对仍匹配当前 ownership 的 active task，success/failed/cancelled 节点状态先持久并获得 canvas ACK，再按 taskId 清 submission intent；preflight 拒绝保留 intent；恢复调用缺失或不同于已有 raw ownership proof 时不认领并保留。显式输入或新 ownership 会撤销/替换旧 intent；legacy signature 无法升级、恢复路径确认持久绑定已失效、提交前 exact GET 命中 cancelled，以及正式付费任务 POST 的确定性 4xx 等不可复用分支，按对应 guard 清理 intent；复制节点会清 generation binding。
- 正式付费任务 POST 及其响应体共用 deadline；该 POST 出现网络/status 0/5xx 未知结果时只按原 idempotency key exact GET reconcile，绝不重发付费任务 POST。retry 先保存取得 revision，再由服务端最终 `BEGIN IMMEDIATE` 核验 live canvas/node/kind/taskId/inputKey/attempt/updatedAt；响应丢失只对同 task exact GET reconcile。localStorage ownership/intent 写失败在付费前 fail-closed。
- Workspace create/rename/delete、CanvasShell create/clone/delete 与 UpdateNotice reload-after-save 各自具 in-flight fence 和显式失败处理；Workspace DELETE 与删除后核验所用列表 GET 具 deadline（列表覆盖 response body）。Workspace 删除向 ConfirmDialog 传入 busy，ConfirmDialog 负责 focus/Escape/a11y；CanvasShell 删除依靠外层 fence。真实 Mureka `INPUT-006 / AUDIO-REAL-001` 未恢复，继续 PARTIAL/暂停。
- 测试运行于功能提交前、HEAD `26ff9396194499365c79e5bc85238631ed44ef7a` 下 403-file 冻结脏工作树 `ce7b4856b00b3ab12ee4853ece0b07b01dec86619bbca7865daa4edb659cc957`：adjacency 12-spec `142/142`、target 10-spec `255/255`、核心 8-spec `repeat=3` 共 `606/606`、安全全量 `109/109 spec、841/841 PASS`；failed/skipped/retries/reportErrors/blocked 均为 0，full `deniedViteWildcardProbes=477`。固定 Node `22.23.1` / npm `10.9.8`；源码 286，TS/TSX `270/270`、JS/MJS `16/16`；11 个运维脚本为 6 个行为验证 + 5 个哈希冻结；4173 listener 前后均为 `91689b3fefccfb3fe32ffc44e2b10a3146976b76d497183f56f7457924a7e219`。
- 功能提交 `138f7ff0f9481e73355fbd9a9fd2c548ee9cee1a` 包含相同功能文件，未在该 commit 后或文档后树重跑。本项进入 `USER_REVIEW`，当时唯一施工项切换到 REM-008；不是用户 PASS、真实数据/真实 Provider/OSS、生产迁移、发布许可或 REM-011 最终三轮。REM-007 无 schema 迁移；新增 ownership 是可选 canvas JSON/localStorage 字段，其旧数据格式与安全拒绝边界后来已由 REM-009B 矩阵覆盖。结论只在单一 active process 前提下成立，F-023 留 REM-010；不宣称跨标签分布式互斥。package `0.5.1`、线上 schema 37 不变，schema 39 仅离线候选，production HOLD。

### 2026-08-12 REM-008 资源、安全、性能和运维脚本（工程候选已完成）

- `F-012`～`F-015` 的离线候选范围已收口：登录使用有界 token bucket 和 fail-fast 密码校验并发，SSE 使用全局/每键连接准入并限制慢客户端；请求体、播放列表导出和缩略图改为受控流式路径；Provider 结果与 OSS endpoint 使用私网/保留地址/IPv6 拒绝、DNS pinning、redirect fail-closed 和 deadline。以上只由动态 loopback 与假 Provider/OSS 证明。
- 保留 `DEP-005` 的 500MiB 视频合同，不用降上限规避资源治理。上传、生成结果、播放列表和缩略图统一受进程/账号/磁盘 reservation 约束；ffmpeg/ffprobe 使用有界队列、超时、TERM→KILL 进程组收口和 stderr/output 上限；压力与故障后 permit、子进程和临时资源回落。
- 安全响应头覆盖 CSP、Permissions-Policy、Referrer-Policy、nosniff 与 HTTPS 条件 HSTS；锁文件把 `nanoid` 固定为 `3.3.18`，隔离 `npm ci --offline`、生产构建和离线 audit 均通过。`F-029` 只按当前 lock snapshot 与离线候选收口，不冒充生产供应链证明。
- 密码重置和存储修复默认 dry-run，apply 要求显式可信绝对路径、私密密码文件与有效管理员 actor，并以审计、锁、补偿和恢复收口；`F-025` 只关闭这两个脚本子范围。真实 OSS mirror/backup-to-OSS 继续哈希冻结，最终远端恢复材料仍归 REM-009B/010。
- `F-030` 本轮可验证子范围已处理：App/Workspace 按需包拆分、历史素材游标分页、图片/视频懒加载、缩略图缓存上限与 object URL 回收；不宣称消灭所有后续 P2 优化空间。`F-028/F-034` 继续由固定 Node 22 和全源码门禁满足。
- 测试运行于功能提交前、HEAD `d63af1224bbadfab00cdd65256c16afaf4195fa1` 下冻结脏工作树 `79625ac9768e99351f00190389a76e19945355405a3235608f219afd4d2d81be`：核心 15-spec `repeat=3` 共 `588/588`，安全全量 `111/111 spec、891/891 PASS`；failed/skipped/retries/reportErrors/blocked 均为 0，full `deniedViteWildcardProbes=492`。Node `22.23.1` / npm `10.9.8`；源码 294，TS/TSX `277/277`、JS/MJS `17/17`；12 个运维脚本为 9 个行为验证 + 3 个哈希冻结；4173 listener 前后均为 `09d55bc82aab1e1f04aae60397395befd6d17c41b5b2622bcde7c4c7b1b8ec2`。
- 功能提交 `ff9a2adbb9ba93c9646935b2b22b318fb5503f21` 包含相同功能文件，未在该 commit 后或文档后树重跑。本项进入 `USER_REVIEW`，当前唯一施工项切换到 REM-009B；不是用户 PASS、真实 500MiB 上传、真实数据/Provider/OSS、浏览器 TLS/生产安全头、生产迁移、发布许可或 REM-011 最终三轮。资源/SSE/进程/出站合同只在单一 active process 内成立，磁盘 reservation 不是 OS 全局配额，脚本不声称文件系统/SQLite 跨介质崩溃原子；F-020/F-024 留 REM-009B，F-022/F-023 留 REM-010。package `0.5.1`、线上 schema 37 不变，schema 39 仅离线候选，production HOLD。

### 2026-08-06 多项目（项目制画布）功能

- 用户已审阅并确认最终开发方案，权威文档：`spec/UNBOUNDRY_MULTI_PROJECT_PLAN.md`（状态 APPROVED BY USER 2026-08-06）。实施时**以此文档为准**，避免上下文漂移。
- 范围：项目工作空间、新建/打开/重命名/删除、封面三级优先级、搜索/排序/Grid/List、`projectId` 与 fixture 解耦、删除防复活（服务端墓碑）、默认项目保护；v1 不做文件夹与团队项目。
- 当前状态：按方案实施完成（Step 1-5 + 选择功能 + 多轮 UI 调整），自动化与 CUA 实测均通过，证据见 `spec/UNBOUNDRY_MULTI_PROJECT_EVIDENCE.md`；延后修复清单 0 条；2026-08-06 用户确认后一次 commit 提交收尾。

## 当前阶段

阶段：`生产 v0.6.0/schema39 LIVE / REM-001～009B USER_REVIEW / REM-010/011 PASS / G7（本次v0.6.0）PASS / USER ACCEPTED / 无IN_PROGRESS REM / 后续生产修改、Provider、push/tag/PR或新版本发布均需新授权`

画布、固定界面、Text、Image、Video、Audio、Playlist、Group、外围面板、账号、管理员模型中心、生成安全和新图片私有OSS链路已通过当前范围验收；Comment、社区、TapTV、竞技场、额度和链接分享已按用户决定取消。OpenRouter GPT Image 2已完成一次用户授权的历史真实生成，图片连线参考图及真实结果零费用重启恢复均已通过；本次 cutover 未发起 Provider 或付费生成请求。

### 2026-08-08 小地图拖动与点击跳转修复（已验收并进入 v0.4.7 发布）

- 用户报告两个问题：小地图拖动非常慢；小地图无法点击跳转。
- 根因一：旧的 200×150 自定义拖动层把鼠标位移固定按 ×2 反向平移主画布，没有按小地图与画布的真实比例换算，画布越大慢得越多（示例：3000px 宽画布缩小到 200px 小地图时比例约 15 倍，正确应平移约 15px，旧代码只移 2px）。
- 根因二：旧实现只有“按下/移动/抬起”，从未实现单击跳转；且小地图自身 `pointer-events:none`，本体收不到任何事件。
- 修复方案（用户已批准）：删除自定义拖动层，改用 ReactFlow 官方 `MiniMap` 的 `pannable`（按真实比例拖动、取景框跟手）与 `onClick`（按现有“聚焦节点”同一居中公式跳转）；`zoomable` 保持关闭，外层薄壳吞掉滚轮，维持“小地图上滚轮不缩放画布”；小地图改为可交互光标。
- 涉及文件：`client/src/canvas/CanvasSurface.tsx`（删除 `minimapDrag` 与拖动层、新增 `handleMiniMapClick`、MiniMap 包滚轮壳并加 `pannable/onClick`）、`client/src/styles.css`（删拖动层样式、`pointer-events` 改可交互）、`tests/m1-minimap-edge.spec.ts`（拖动断言改为真实比例、新增点击跳转断言）。
- 顺带加固：`fit view brings five distant nodes` 原先断言 `.react-flow__node` 数量=5，依赖“首次全量渲染瞬态”，在本批次首个测试运行时序变化后偶发失败；已改为断言文档级 `data-node-count=5` + 视口内稳定 3 节点，再验证 fit view 后全部可见，语义不变且确定。
- 验证：`npx tsc --noEmit` 与 `npm run build` 通过（仅既有 chunk 体积 warning）；`m1-minimap-edge` 7/7 连续 3 次通过；`m0-shell + m1-dense-canvas + m1-viewport` 25 通过、1 项为已知基线失败（m0 P1 creator，与本批次无关）；全程独立端口 4174 + 临时数据目录，未触碰 4173 真实服务与数据。
- 用户已在本地 4173 实页确认“可以，通过了”（拖动跟手、单击跳转、滚轮不缩放），`CANVAS-013` 已由 `USER_RECHECK` 改为 `PASS`。
- 发布前全量回测（独立端口 4174/4192/4193/4197/4198 + 临时数据目录，未触碰 4173 真实服务与数据）：
  - 绿地检查通过；构建通过（仅 chunk 体积 warning）。
  - `m1-*` 画布全套 25/25；`m79` 丝滑度专项 2/2；`test:restart` 通过；`fixture-production` 通过。
  - `m75-full`：272 通过 / 16 失败 / 1 未运行；基线同套件为 273 通过 / 15 失败，15 项失败清单完全一致（m0 P1 creator、m14 端口冲突、m17/m24/m25/m30/m33/m62/m63/m7 等既有环境或顺序问题），唯一多出的 m2 图片裁剪用例为一次性偶发，单独复跑 3/3、整文件复跑 9/9 均通过，判定非本次改动回归。
  - `m71-regression`：89 通过 / 2 失败（m0 P1 creator、m63 打组偶发，均为已知基线项）。
  - `m74-regression`：110 通过 / 1 失败（m46 外部请求端口过滤，已知基线项；本轮 m26/m38 已知项恰好通过）。
  - 结论：小地图改动无功能回归，进入发布。

### 2026-08-08 三个真实使用问题修复（等用户实页确认后再发布）

- 问题 1：普通账号在画布生成素材后，从工作空间重新进入项目卡片找不到素材与节点。
  - 根因排查（只读服务器数据库与访问日志）：用户生成的内容本身没有丢失——普通账号 `zzx` 的项目画布节点、素材文件和任务记录都在库里；实际使用中用户主要工作在“默认画布”，而默认画布在工作空间没有任何卡片，只有两个同名“未命名项目”卡片，容易点错；另一个项目的 17 个图片节点都是未生成的模板占位（无任务、无素材），看起来像“空的”。
  - 修复：工作空间固定显示“默认画布”卡片（不可删除、不可选择），默认画布内容始终有入口；同时 v35 迁移把遗留的旧品牌默认标题清为“默认画布”。
  - 补充说明：数据未丢失，旧项目仍可正常打开；若打开后某张生成图不在视野内，可平移/适应视图查看（画布会记住离开时的视口）。
- 问题 2：普通账号有全局消耗上限，修改上限后仍不提示“已到上限”，且需要账号独立设置上限。
  - 根因一：费用统计 SQL 没有按 `owner_id` 过滤，所有账号的消耗被加在一起计算，账号隔离失效。
  - 根因二：系统只有管理员全局一条限额，普通账号无法设置自己的每日/每月预算，也没有独立页面查看已用额度。
- 修复：v35 新增 `account_consumption_limits`；admission 按账号统计已用并支持账号独立限额（0 = 跟随全局，全局 0 仍为阻止所有生成）；新增 `/api/account-safety` 自服务接口，并把“我的消耗上限”区块并入「我的连接」页（不再占用头像菜单独立项），展示今日/本月已用并在超限时标红“已到上限”；生成被拦截时节点显示“费用额度已用完”提示。
- 问题 3：账号登录后要求直接进入工作空间。
  - 修复：登录（含首次创建管理员）成功后强制跳转 `/canvas/projects`，不再停在登录前的画布 URL。
- 验证：m81 专项 5/5、m66 14/14、m14 6/6、m11 4/4、m20 契约 1/1、m44 迁移 1/1、m77 6/6、m78 7/7、m1 画布 25/25；m75 全量 274 通过 / 15 失败（与基线失败清单完全一致，无新增）；m71 回归 90 通过 / 2 已知基线失败；m74 回归 110 通过 / 1 已知基线失败；m79 丝滑度 2/2；重启持久化与生产 fixture 通过；tsc/构建通过。全程独立端口与临时数据目录，未触碰 4173 真实服务。
- 状态：验收矩阵新增 `SAFETY-002 / SAFETY-003 / CANVAS-019 / AUTH-004` 均为 `USER_RECHECK`，等待用户在实页确认后再发布。

### 2026-08-08 图片生成结果“要刷新才出现”根因与修复（GEN-010）

- 现象：生成图片节点后，结果要刷新一次才显示；用户反馈此前也出现过同类问题。
- 根因（服务器访问日志 + 客户端代码双重确认）：任务 `c1bbe0c5` 18:00:29 提交、18:01:32 服务端成功，但浏览器 18:00:42 页面重载后轮询永久停止；挂载恢复逻辑在 `ImageNode` 里只把节点标成“生成中”，**没有恢复轮询**，而 `TextNode / AudioNode / VideoNode` 的恢复分支都会继续轮询，唯独图片节点遗漏。
- 修复：`ImageNode` 恢复分支发现运行中任务后，与文字/音频/视频一致地继续 `waitForGenerationTaskWithPause` 轮询，成功后立即 `applyGeneratedImage`，失败/取消/暂停按既有规则处理；同一任务用模块级 Set 去重，避免重挂载产生重复轮询器。
- 预防：新增 m41 回归用例“图片节点运行中重载后自动继续轮询并显示结果（无需再刷新）”；`m41` 15/15、`m2-image-node` 全过、tsc/构建通过。
- 状态：验收矩阵新增 `GEN-010` 为 `USER_RECHECK`，等待用户实页复测。

### 2026-08-08 移除全部生成金额限制/上限功能（v0.5.0）

- 用户决定：取消项目里所有生成金额限制/上限功能；任务成本记账保留；相关 UI/入口彻底删除；`model_profiles.max_cost_microunits` 列保留但不再使用。
- 数据库 v36：重建 `generation_safety_settings` 去掉 6 个成本列（每日/每月 CNY、每日/每月 USD、单次默认、汇率），保留总开关/紧急停止/并发/频率/熔断/失败阈值/运行策略；删除 `account_consumption_limits` 表；`generation_tasks` 成本列保留（记账）。
- 服务端：`admission` 只保留开关/频率/并发/熔断；删除账号限额 API、`costUsage`、`effectiveSingleTaskCostMicrounits`；预检不再返回/使用成本；`paidArkVideo/paidArkText/paidMurekaAudio` 改为按驱动类型判定（不再依赖“有效成本>0”），保住 Base64/时长/参考素材等安全校验；任务创建仍写审计估算值（¥10/$10 常量，不展示不拦截）；`/api/generation-tasks/status` 不再受预算 gating；模型中心不再返回/写入单次费用。
- 前端：管理员生成安全中心删除「全局额度（人民币）」区块；模型中心删除「单次费用保护/单次上限」；「我的连接」删除「我的消耗上限」区块；错误文案删除 COST_LIMIT/COST_UNKNOWN。
- 测试：删除 m81（登录落地用例迁至 m11）；重写 m14（3/3，含“设置无成本字段、旧成本字段被忽略”）；m20 路径 20→19、操作 29→27；m44 迁移清单加 v36；m22/m27/m68 相关断言更新；m11 5/5、m27 20/20、m38/m49/m52/m55/m56/m65/m10 全过；m74 110 通过仅剩已知 m46。
- 真实库迁移演练：基于 `data:backup` 生成的备份副本完整演练 v33→v36，成功且非成本设置值原样保留。
- 状态：验收矩阵 `SAFETY-001/002/003` 标记为已移除，新增 `SAFETY-004`（整体移除）为 `USER_RECHECK`，等待用户实页确认后发布。

### 2026-08-08 多管理员 + 受保护根账号 + 密码重置（v0.5.1）

- 用户决定：可以再创建管理员账号；第一个创建的管理员（mymy/麦哥）自动成为受保护的最高权限账号，其他管理员永远不能停用/删除/降级/重置/改权限它；补上密码重置能力。
- 数据库 v37：`users.protected` 列；把“创建时间最早的管理员”置为受保护（演练确认麦哥被标记、zzx 不受影响）。
- 服务端：
  - `POST /api/admin/users` 支持 `role: admin|user`，创建管理员写审计；
  - PATCH 支持 `role` 变更（不能改自己、不能改受保护账号）；
  - DELETE / PATCH status / 权限 PUT / 重置密码五处统一拦截受保护账号（403）；自己改自己权限仍为 400（自锁）；
  - `POST /api/auth/password` 自己改密码（需旧密码，吊销其他会话，保留当前会话）；
  - `POST /api/admin/users/{id}/password` 管理员重置他人密码（受保护账号 403，吊销目标全部会话）；
  - 应急脚本 `scripts/reset-account-password.mjs`（SSH 执行，可重置任意账号含 root，写审计）。
- 前端：账号管理支持创建管理员（角色选择）、最高权限徽标、受保护账号操作禁用、重置密码弹窗、角色切换；头像菜单新增“修改密码”。
- 测试：m11 7/7（新增受保护矩阵、自改/重置密码、会话吊销）、m78 7/7、m20 21 路径/29 操作、m44 迁移清单加 v37；v37 真实库副本演练通过。
- 状态：验收矩阵新增 `AUTH-005 / AUTH-006 / AUTH-007` 为 `USER_RECHECK`，等待用户实页确认后发布。

### 2026-08-04 当前快照

- 当前状态清单包含82个fixture、30个开放/裁决记录和176条验收记录；已通过项目不得重做或擅自推翻。
- `GEN-009`已获用户实页确认：图片连线是参考关系事实来源，目标输入区显示缩略片，删除缩略片同步删除连线，`⌘Z`同时恢复二者。
- 前置参考图提交只保存当前账号的素材ID；执行时才换成5分钟私有OSS签名地址或经过大小、SHA-256和PNG结构校验的数据地址，不把短时地址写入画布或任务。
- OpenRouter `openai/gpt-image-2`当前按官方能力最多接收16张参考图；不支持参考图、数量超限、素材不归属当前账号或素材未ready时均在Provider调用前拒绝。
- 当前真实图片成功链路已经覆盖：管理员连接和发布模型、图片参数、提交、持久任务、OpenRouter执行、私有OSS结果、画布引用、刷新、服务重启恢复、历史、全屏和下载。
- 已关闭：`GEN-007/DATA-004`的真实结果服务重启恢复、任务/历史去重和私有OSS持续读取。
- `GEN-006/OPEN-007`已经用真实任务覆盖取消、超时、重试成功及服务重启后的`recovering→failed`，退款因用户取消额度体系而不适用，2026-08-01由用户确认PASS。
- 火山方舟Seedance 2.0 Mini真实视频任务`788ebeaa-b37d-499a-becc-64ae16f2a9f5`已成功，结果进入私有OSS；播放、下载、历史预览/操作、刷新和服务重启恢复均通过用户验收。
- `OPS-001`已确认服务只绑定`127.0.0.1:4173`，局域网地址不可访问；这不代表已经部署服务器。
- `API-001～006`均已通过：自有OpenAPI 3.1现在覆盖画布、项目标题、安全模型配置、当前账号、模板、Agent界面配置、AI角色与素材目录，共8条路径、10个操作；不复用Unboundry私有接口。
- Agent模型菜单只读取管理员明确设为默认的已发布文字模型；新增普通文字模型不会自动污染Agent菜单，真实Agent执行继续关闭。
- `AUDIO-REAL-001` Audio真实生成暂列待办：Mureka只读连接可用，但原任务`766c1ae9-3c7b-4235-93fa-d40e99c268c1`两次提交均以`RATE_LIMIT / Mureka 暂未接受本次请求`结束，没有Provider任务ID、结果素材、重复任务或新增历史。恢复验收前先由用户在Mureka官网确认余额、生成额度、频率限制和音乐生成权限；未经再次明确授权不得重试。
- Unboundry节点入参已经完成两轮实页勘测：第一轮确认9条Unboundry当前直接连线及7条拒绝组合；第二轮向Image、Video、Audio来源上传非敏感测试素材，确认ready预览、目标引用卡、删除/撤销、提示词条件和刷新恢复。刷新前后均为8节点/9边，未点击Generate、未产生生成任务或收费请求。
- 用户进一步确定本项目Text目标应扩展接受Text、Image、Video、Audio四类上游，因此本项目目标矩阵为11条允许、5条禁止；该产品增强与Unboundry当前实测事实分开记录。
- 统一类型化连线、edge事实来源、引用卡状态、前后端提交前检查和P1“Text母版+Image参考→Image”已有本地候选实现与回归；Text/Video/Audio的全组合真实链路尚未逐项人工验收，因此`INPUT-001～007`仍统一保持PARTIAL。
- 多协议中转站的真实连接、Key与只读目录、129模型完整组合目录、分类筛选和模型中心草稿已由用户实页确认，`RELAY-001～005`正式PASS。目录实测由增强目录101条与基础目录55条合并去重为129条：文字55、图片17、视频50、音频7。
- 优创真实Video任务`8275d86c-602e-42ab-b444-969224dea601`已完成零费用刷新、服务重启恢复和去重复验；任务、attempt、events、素材和历史哈希稳定，素材仍唯一，SHA-256为`969acbb31c7eed3ab82ecb3df88c7a2394fb5a1813ee094353a3dbeccbe9f412`、1,493,430字节、5.042秒。用户确认该单节点生成成功，`RELAY-010`正式PASS。
- 在用户逐次授权下，又完成7次真实API自动验证：OpenAI Chat、OpenAI Responses、Claude Messages、Gemini GenerateContent、GPT Image、通用图片`media-generate`及Doubao TTS均成功，无失败和重复；收费Provider边界计数由1增至8。用户已先后确认四条文字结果及两张图片、Doubao TTS、安全删除保护报告，`RELAY-006～009、011、012`全部正式`PASS`。
- 两张`reply ok`图片和`reply hello` Doubao TTS已在真实画布、历史、刷新及本项目服务重启后复验；3个任务、3个素材、3条历史和3个画布节点均唯一，任务均为`success / attempt 1`。音频为1.632秒并实际播放成功；`emotion=auto`没有持久化或发送`emotionScale`。
- 安全删除隔离草稿`relay-delete-fixture-20260804`已完成“创建→归档→永久删除”且无残留；本次没有重新创建或删除真实数据。真实模型中心13个模型、8个中转模型、4个默认保护项在刷新和服务重启后保持不变，未出现错误的“永久删除”入口；隔离自动检查31/31通过，收费Provider请求0、新生成任务0。
- 2026-08-04画布搜索/缩放回归已统一收口：搜索定位只消费一次；光标位于节点、文本输入或打开的生成面板时仍可缩放；纯viewport保存不再触发“画布正在保存”生成门禁，输入面板不再闪烁。用户实页确认通过。
- 2026-08-04多选与已验收Group集成回归已通过：多选只显示一条画布级公共工具栏，全部单节点工具栏、Creator、标题输入、播放器和resize chrome收起；画布非编辑区不产生浏览器蓝色文字选区，输入框内`Cmd+A`仍只选文字。公共“打组”入口继续复用已PASS的Group能力，建组、撤销、刷新、删除Group、撤销删除和再刷新均保持父子关系、edge和唯一性。
- 下一执行顺序：中转站`RELAY-001～012`不再重复验收；返回现有P0/P1全局持久化、Text四类上游、Video多模态参考、Audio文字合并和模型切换不兼容保留验收。Mureka真实生成和正式部署仍暂停。
- 验收文档采用批量同步：第二批10次成功验收已于2026-08-02统一写入六份权威文件；2026-08-04用户明确要求提前同步后，当前下一批为6/10。第6项是`RELAY-009/011/012`的两张现有图片、Doubao TTS、安全删除保护及刷新/服务重启联合复验；本次一次用户确认按1项计数，不按验收行数重复累加。
- 明确保留后期：`IMGEDIT-007`打光、`AUTH-002/OPEN-009`团队与多人、`OPEN-019`Storyboard/Table完整创建编辑、`OPEN-021`真实Agent协议。

### 2026-08-05 M65 紧凑上游引用UI 与 INPUT-005 实页验收

- 2026-08-05 用户先在 4173 真实本地页确认 M65“紧凑上游引用 UI”通过：Text 节点四类上游只占一行，详情浮层同时只开一个，第五个及以上收进 +N，“暂不可生成”提示可收起；全程零付费请求。
- 随后用户在隔离验收服务 4185（独立临时数据目录，与 4173 运行同一份代码）实页确认 `INPUT-005` Video 全能参考场景：文字/图片/视频/音频四类引用卡、主体/参考图片/参考视频/参考音频/生成指令角色、输入模式切“首尾帧”时的角色策略切换、切换到“仅文字视频模型”时媒体引用保留并显示不兼容原因、刷新后引用与顺序保持；提交保持禁用、`paidProviderRequests=0`，未触碰 4173 真实数据。
- 自动检查：TypeScript 无错误；M65 专项 3/3；被改动回归测试 62/62（隔离端口 4174、临时数据目录）。
- 证据边界：9图/3视频/3音频超限与“提交前参数/费用/Provider能力预检”的真实超限和真实提交证据仍未产生；`INPUT-004` 真实四类上游分协议调用证据仍未产生。因此 `INPUT-004/INPUT-005` 保持 PARTIAL，人工已确认部分已写入验收矩阵。
- 2026-08-05 用户在隔离验收服务 4186 实页确认 `INPUT-006` Audio 文字合并：上游 Text 母版、自身 Prompt、歌词三者区分显示，最终提示词合并正确且歌词不混入；角色切换（生成指令/文字上下文）、删除/撤销/刷新持久化均通过，零付费请求。Mureka 真实生成仍由 `AUDIO-REAL-001` 暂缓，`INPUT-006` 保持 PARTIAL。
- 2026-08-05 全局下拉 UI 修复经用户实页确认：新增公共 `GrayMenuSelect`（自绘灰色菜单）替换全部 7 处原生 `<select>`（引用角色、Provider 目录筛选/行选、模型中心协议选择）；引用角色按“面板内少量固定选项”规则改为公共 `InlineOptionGroup` 内联选项组，与创作器参数面板同源样式，不再出现浏览器蓝色下拉、浮层遮挡或选项换行。规则已写入 `spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md` §5.5；相关测试 m12/m16/m27/m29/m43/m46/m56/m64/m65 全通过，TypeScript 无错误。
- 2026-08-05 用户在隔离验收服务 4187 实页确认 `INPUT-007` 模型切换与完整持久化：全能参考模型下 4 个视频引用超 3 上限时显示“当前模型最多支持3个video输入，引用已保留”，删除/撤销后提示同步恢复；切换“仅文字视频模型”时图片/视频/音频引用全部保留并显示不兼容原因，切回后恢复；输入模式切“首尾帧”后图片角色变为首帧/尾帧，其他媒体保留并显示不兼容；刷新和服务重启后模型、角色、顺序、超限提示全部保持；全程 `paidProviderRequests=0`、无新增任务/历史/媒体。`INPUT-007` 的复制目标、素材上传中/失效等剩余边界仍保持 PARTIAL。
- 2026-08-05 用户在隔离验收服务 4188 实页确认 `INPUT-007` 剩余边界收口：复制目标产生唯一副本且不复制引用、不新增任务；上传中断/来源缺失/校验失败三类异常状态在引用卡上显示明确原因且 edge 保留；删除/撤销与刷新持久化正常。数据库核对：副本节点唯一、生成任务 0、媒体 1、`paidProviderRequests=0`。失败/取消/超时/重试、历史去重、余额保护分别由既有 `OPEN-007/DATA-004/SAFETY-001` 等 PASS 覆盖，`INPUT-007` 正式由 PARTIAL 改为 PASS。
- 2026-08-05 用户在隔离验收服务 4189 fixture 实页确认 `INPUT-001` 连线矩阵与 `INPUT-003` Image 闭环：11 种允许组合落线、5 种禁止组合不落线且打开来源感知菜单、自连/重复/反向环/源到源无效；Text 母版+Image 参考在自身 Prompt 为空时直接使用母版、补充后显示合并最终提示词，删卡/撤销/刷新保持，零付费请求。`INPUT-001/INPUT-003` 正式改为 PASS。
- 2026-08-05 用户结合 4188 状态场景与 `INPUT-007` 持久化证据确认 `INPUT-002` 统一状态：就绪/上传中断/来源缺失/校验失败状态卡清晰、edge 保留，删卡/撤销/刷新持久化正常；`INPUT-002` 正式改为 PASS。
- 2026-08-05 用户实测 Unboundry 同画布双标签行为后，确认本项目多标签策略从“旧版本写入 409 拒绝”改为“最后修改者胜”：不同标签的保存始终接受并按最后写入生效，其他标签通过本地广播自动载入最新内容；同一标签乱序的旧保存仍被拒绝，避免单页内旧快照覆盖新快照；Generate 前先强制保存并等待成功再提交。服务端/客户端改动已完成，相关测试（m3 重写为双标签收敛、m27 同会话乱序+跨标签最后写入）全部通过；2026-08-06 用户在 4173 双标签实页复验通过，`DATA-005` 正式由 USER_RECHECK 改为 PASS。
- 2026-08-05 参考素材规则改为“按模型配置生效”，修复 Seedance 2~15 秒规则被误用到 Gemini 文字任务的问题：火山方舟官方文档确认“单段音频 [2,15]s、最多3段、合计≤15s、单段≤15MB”是 Seedance 2.0 官方限制；文字节点 + Gemini 3.5 Flash Lite 的 184 秒音频被误拦，根因是共享素材读取函数对全部任务类型套用了 Seedance 视频规则。现改为：参考素材的格式/大小/单段时长/总时长/音频必须搭配视觉等规则进入模型参数注册表（`referenceMediaRules`），Seedance 2.0 Mini 默认值与官方一致，管理员可在模型配置页的“参考素材文件规则”里在 Provider 上限内调整；文字/其他中转模型只按各自模型规则校验，不再套用 2~15 秒。火山适配器的生成时长/素材数量/大小上限也改为从模型快照读取，Seedance 家族后续模型（如 2.5 的 30 秒）无需改适配器，只需后台配置。相关新增/更新测试 m16/m17/m30/m31/m45 等通过，TypeScript 无错误，收费 Provider 请求 0。等待用户在 4173 用原 184 秒音频重新生成验证。
- 2026-08-05 `INPUT-004` 正式由 PARTIAL 改为 PASS：用户在 4173 真实环境用文字节点 + Gemini 3.5 Flash Lite，连接 Image（PNG 396KB）、Video（MP4 5.08秒）、Audio（MP3 184秒）三个上游后点击 Generate，真实任务`09ec3592-69d7-4dab-8f41-cf7d7c97f784`成功并返回结果。任务快照确认三类入参均以 context-image/context-video/context-audio 完整提交；期间一次失败为代理环境变量缺失（PROXY_CONFIGURATION），补齐本机代理环境后恢复。用户宣布该轮验收通过。
- 2026-08-05 `INPUT-005` 正式由 PARTIAL 改为 PASS：用户在 4173 真实画布以 Seedance 2.0 Mini（全能参考模式、9图/3视频/3音频、4秒、有声、480p）点击 Generate，方舟任务`cgt-20260805223417-9jrxf`成功，结果视频进入私有 OSS（`d0107b51-064a-4ede-986b-797179a86ab6.mp4`，1,768,886 字节，4.096 秒），实际费用 2,536,940 微单位（¥2.54），任务快照三视频/九图/三音频与 prompt、参数完整。本轮排障过程也暴露并修复两处全局问题：①方舟返回的具体错误此前被适配器吞成笼统“火山方舟暂时无法处理视频任务”，现视频/文字两条方舟链路都会透传方舟错误原文（本次抓到的真实原因是“参考视频总像素必须 ≥409600”，测试素材 640×360 不达标）；②服务端此前不校验参考视频分辨率，现已把媒体分辨率（宽/高）纳入服务端元数据（上传时 ffprobe、`media_assets.media_width/media_height`、迁移 v25），Seedance 参考视频在 Provider 调用前即按官方 409600 总像素下限拦截并给出明确提示，全部 110 条存量视频已完成回填。用户在 4173 实页确认结果并宣布验收通过。
- 2026-08-05/08-06 参考素材规则全面参数化（用户实页确认通过）：模型配置页「参考素材文件规则」新增图片最小/最大宽高、宽高比上下限、视频最小/最大总像素等可选项（留空=不限，UI 按 `UNBOUNDRY_UI_DESIGN_SYSTEM.md` 紧凑控件规范）；规则对任何配置了 `referenceMediaRules` 的模型生效（Gemini 等不再只走 Seedance 专用逻辑），Seedance 专属的“视频必须入私有 OSS、Base64 预算、总时长”等保持独立；服务端 `arkVideoMediaProblem` 同时校验图片尺寸/宽高比与视频总像素上下限。图片上传开始记录宽高，存量 174 张图片与 110 条视频全部回填。已发布模型预填官方默认：Gemini 3.5 Flash Lite 图片格式放宽到 PNG/JPEG/WEBP/HEIC/HEIF、音频放宽到 WAV/MP3/AIFF/AAC/OGG/FLAC 且最长 9.5 小时；Seedance 2.0 Mini 默认含图片 300~6000px、宽高比 0.4~2.5、视频总像素 409600~8295044；Mureka 输出≤3、prompt/歌词长度校验已在服务端。平台真实报错透传扩展到 OpenRouter 图片、中转站（优创）与 Mureka（安全截断）；节点失败横幅改为中文摘要 +「查看原文/复制」（`ProviderErrorNotice`，按 UI 规范 §5.9）。后台「按生成方式设置角色与必填」和「参考素材组合」的数字框统一为同页 31px 紧凑样式（原 46px 通用输入框），Seedance 角色策略保持 Provider 固定。m16/m18/m31 共 15/15 通过，TypeScript 无错误，零 Provider 请求。
- 2026-08-05 修复“无限画布缩放导致整页 UI 一起放大”的问题：普通浏览器下画布缩放不影响四周 UI（实测 0.15~2 倍坐标不变），根因是内置浏览器把捏合/Ctrl+滚轮当作整页缩放。已在应用根部捕获并拦截浏览器整页缩放手势，并为画布区域设置 `touch-action: none`，缩放只作用于画布内容；m1/m62 专项 7/7 通过，用户在 4173 实页确认“可以了”。该项记入验收矩阵（CANVAS-017）。

### 2026-08-03 多协议中转站插入项

- 本地候选已按用户批准的`spec/UNBOUNDRY_RELAY_PROVIDER_INTEGRATION_PLAN.md`完成：把简单OpenAI兼容连接升级为可配置的多协议中转站；当前只进入人工实页复验。
- 首个目标站按第三方中转站管理；支持只读模型目录、OpenAI Chat/Responses、Claude Messages、Gemini GenerateContent、GPT Image和通用图片/视频/音频任务适配。
- 目录同步只生成管理员候选草稿，不自动发布、不改变默认模型、不发起真实生成。
- 候选实现包含连接安全、目录回退、搜索筛选、固定批量操作栏、模型草稿、协议适配、异步媒体任务、余额/用量只读展示和模型安全删除。
- `RELAY-001～012`已完成本地候选代码、fixture和零Provider自动检查，统一进入`USER_RECHECK`；未经用户实页确认不得标PASS，也不得把本次自动检查计入成功人工验收。
- 自动检查没有创建真实聊天、图片、视频或音频任务，收费Provider请求数为0；第三方真实Key和真实生成仍须用户在本机后台配置并逐次授权。
- 本次文档同步由用户明确要求提前执行，不计入“每10次成功人工验收”的常规批量同步；`INPUT-001～007`状态不变。

### 2026-08-04 优创完整目录与真实链路复验

- 真实Key检查与目录同步均在管理员页面主动触发；连接状态为有效，Key不在聊天、浏览器响应、业务数据库或日志中回显。
- 优创目录不再只取`/v1/models`的55条文字模型。服务端先读取`/v1/skills/models`的101条多模态目录，再读取`/v1/models`的55条基础目录，按模型ID与能力合并去重，最终保存129条：文字55、图片17、视频50、音频7；分类筛选已由用户确认正常。
- 目录同步、分类筛选和“添加到模型中心”只读/草稿流程通过；已选Video模型先建立草稿，再由管理员手动发布，没有自动发布或改变默认模型。`RELAY-001～005`由`USER_RECHECK`改为`PASS`。
- 用户随后使用已发布的`grok-video-3.5`完成真实单节点Video任务`8275d86c-602e-42ab-b444-969224dea601`。事件为`queued→running→success`、attempt 1，第三方任务ID为`93467467`；结果`f5ae0f1d-0e97-4923-88ef-6a39f292eea6.mp4`为1,493,430字节、5.042秒，SHA-256为`969acbb31c7eed3ab82ecb3df88c7a2394fb5a1813ee094353a3dbeccbe9f412`，已进入私有OSS并登记唯一历史。
- 该结果后续完成零费用刷新、服务重启恢复和去重复验，任务、attempt、events、素材与历史哈希稳定，任务/历史/媒体均唯一；用户确认单节点生成成功，`RELAY-010`改为`PASS`。
- 用户授权的7次真实API自动验证全部成功，收费Provider边界由1增至8；完整任务/素材ID写入验收矩阵、证据目录和fixture。自动真实验证不代替用户可见验收。
- 用户后续在真实画布找到四条文字结果，确认内容完整、刷新恢复且无重复；`RELAY-006～008`正式改为`PASS`。在该过渡时点，`RELAY-009/011/012`仍为`USER_RECHECK`，其后已由下一节收口为PASS；`INPUT-001～007`继续保持`PARTIAL`，Mureka Audio真实生成和正式部署仍暂停。

### 2026-08-04 中转站图片、音频与安全删除收口

- 两张既有真实图片在画布和图片历史中完整加载，均为1254×1254；两个节点、任务、素材和历史均各1份。刷新及只重启本项目4173服务后仍可见、唯一，`RELAY-009`经用户确认`PASS`。
- Doubao TTS既有结果在音频历史和画布节点均只有1份，1.632秒媒体就绪并实际播放成功；刷新和服务重启后仍可播放且无重复，`RELAY-011`经用户确认`PASS`。Mureka `RATE_LIMIT`任务没有被重试。
- 原隔离草稿已有创建/归档/永久删除审计且无残留，本次不重新造数据或删真实模型。真实管理页与重启后数据均显示13个模型、8个中转模型、4个默认保护，无错误永久删除入口；服务端/UI/媒体隔离检查31/31通过，`RELAY-012`经用户确认`PASS`。
- 本轮收费Provider请求0、新生成任务0、真实数据删除0；页面无控制台报错，项目工作树未因验收操作产生变化。`RELAY-001～012`至此全部PASS，`INPUT-001～007`仍全部PARTIAL。

### 2026-08-04 画布缩放、多选与打组回归

- 搜索定位请求现在只消费一次，不会在后续每次缩放时把画布拉回。节点、文字输入和已打开Creator上的缩放统一交给画布处理；viewport保存与节点/edge内容版本拆分，不再显示保存生成门禁或引起面板闪烁。`m62-canvas-zoom-persistence`专项5/5、画布/文字/撤销/刷新组合37/37、入参/生成安全/迁移53/53通过，收费Provider请求0；用户实页确认通过。
- 多选状态不再把每个节点当成单选编辑态。Text、Image、Video、Audio、Playlist、Group、Probe全部共用同一运行时选择上下文；多选只显示一条公共工具栏，收起单节点工具栏、Creator、标题输入、播放器和resize chrome。画布`Cmd+A`选中顶层节点且不产生原生文字选区，真实输入控件内`Cmd+A`仍只选文字。
- 公共工具栏的“打组”继续使用已人工PASS的Group链路，仅在全部已选项均为可打组的顶层普通节点时启用，避免混合选中后静默遗漏。建组、撤销建组、刷新、删除Group、撤销删除和再刷新均保持父子关系、edge与唯一性。新增`m63-multiselect-group-ui`专项3/3，相关回归45/45，原缩放专项5/5，构建和绿地检查通过，收费Provider请求0；用户实页确认通过。这是对`CANVAS-010/011`和既有`NODE-010/016、OPEN-020`的集成回归，不重做或扩大已验收Group能力。

## 已完成

- 旧 Lumino 复用计划已标记废止。
- 2026-07-28 用户明确取消私有版Comment评论功能；保留历史勘测证据，但不实现评论模式、评论节点、评论持久化或评论协作。
- 私有版左侧工具栏已移除评论入口，历史Unboundry截图和坐标证据不改写。
- 2026-07-30 用户决定项目仅供小范围自用，取消额度、积分、订阅和费用计算；顶部额度入口、各生成/编辑面板费用文字及相关状态字段已移除，历史Unboundry证据中的数值仅作参考。
- 独立 `app` Git 仓库已建立。
- 绿地约束已冻结。
- 当前 Unboundry 全量勘测已转为状态夹具和验收矩阵。
- 历史 Stage 0、像素基线、40图清单和36类功能矩阵已只读提取。
- 当前82个状态夹具、30个开放/裁决记录和176条验收记录已建立；冻结基线文档中的68/146仍只代表2026-07-27当时快照，不回写历史。
- 40张历史 Unboundry PNG 已复制到 `spec/reference/unboundry-v2.12.2-dense/`。
- 本地40张图片的文件名、数量和SHA已与机器清单及上游源逐一验证。
- 40张图片已逐图视觉复核；每张均已关联fixture或标为仅视觉参考。
- 图片高级编辑、Video工具栏、来源感知菜单、Storyboard/Table、Group、Agent、麦克风、素材/模板/历史闭环及1512视口缺口已登记。
- 验收矩阵中的节点类型已由“六节点”修正为“八节点”。
- G0.2 第一批活体补测已完成：
  - 当前创建菜单、Search 高度规则、Text 14项工具栏。
  - Playlist 新建空态时间尺、引导和部分 resize。
  - Group 外层16px/内层12px圆角及当前新建组工具栏。
  - Image/Video/Audio 来源感知菜单完整项目与取消清理。
  - Text、Playlist resize 下限样本。
  - `1512×982@1x`固定锚点和页面溢出；DPR2及最小宽度未完成。
- G0.2 第二批已在专用沙盒 `Codex Unboundry G0.2 Sandbox 0727` 完成：
  - 合成PNG/MP4/WAV经真实文件选择器上传；Video/Audio播放成功。
  - Image上传后由250×250派生为444×250；当前Image/Video/Audio均无resize control。
  - Image+Video Group由1034×290缩至组合下限样本312×147；Group删除级联到成员。
  - Comment输入、0/200、空提交禁用、48×48锚点及无resize control。
  - self、source→source、重复、二节点环的稳定edge规则和临时command清理。
  - Audio节点右键复制/粘贴使用画布内部缓存；系统虚拟剪贴板保持不变并已恢复。
  - 沙盒结束状态为0 nodes / 0 edges并已保存到云端。
- G0.2 第三批已完成：
  - 普通edge可单独选中；Backspace只删除edge，两端节点ID均保留。
  - 当前普通edge选中后没有显式端点updater。
  - 从原target或可见edge末端拖向第三节点会产生临时command，原edge保持；Fit View清理临时状态。
  - Video“下载”按钮tooltip和enabled态已确认；内置浏览器未捕获下载事件、文件或反馈，文件结果继续开放。
  - 专用沙盒3节点保存后刷新恢复3节点；最终再次清理为0 nodes / 0 edges并保存。
- G0.2 第四批已完成：
  - 当前双击创建菜单没有Storyboard/Table；公共“分镜大师”模板落下1 Group、1 Text、15 Image、9 Video及31条边，没有独立Storyboard/Table节点。
  - Text扩大到2671×3530、Playlist扩大到2057×3785，均未观察到clamp；这些是大型样本，不冒充全局最大值。
  - 大型Text+Playlist按子节点包围盒四周20px建组，初始4887.67×3898，可扩到5047×4024，子节点尺寸不随Group向外resize变化。
  - 模板和尺寸样本均已删除；沙盒最终0 nodes / 0 edges并保存到云端。
- G0.2 实现基线已冻结：
  - `spec/UNBOUNDRY_G0_2_BASELINE_FREEZE_2026-07-27.md` 记录68夹具、25未知项、146验收条目、40张PNG及权威证据SHA。
  - 冻结时产品代码为0；后续实现不得反向改写已冻结事实。
- M0 第一增量已完成：
  - 独立 React 19、TypeScript 7、Vite 8 工程和锁文件已建立。
  - `/__fixture/:fixtureId` 仅开发环境可加载确定性状态；生产构建明确拒绝且不返回fixture数据。
  - `shell.empty.primary` 已实现项目区、右上动作、左侧Dock、中央快捷入口、底部控制、帮助、Agent气泡和20px点阵。
  - 绿地污染检查、TypeScript/生产构建、29个固定元素坐标检查、网格令牌检查和生产fixture隔离检查通过。
  - 当前仅是自动检查通过的M0空壳首版，尚未获得用户真实浏览器视觉PASS。
- M0 内置浏览器活体验收校正已完成：
  - 在同一内置浏览器中只读打开当前 Unboundry 专用沙盒与本地 `shell.empty.primary`，核对项目区、右上动作、左Dock、中央快捷入口、底部控制和Agent入口。
  - 依据当前实页修正标题/云端保存排版、12px控件圆角、Dock底色与24px blur、白底添加按钮、快捷入口14/18px字号与图标、底部控制及Agent入口深色外观。
  - 校正后再次通过绿地检查、生产构建、29项≤1px坐标检查、网格令牌检查和生产fixture隔离检查。
  - Unboundry品牌图形与用户头像仍使用绿地占位图形。
  - 用户已在内置浏览器中确认继续，M0空壳视觉验收记为PASS。
- M0 已冻结：
  - `1440×900@1x`、`1920×1080@1x` 共58个固定元素锚点检查通过。
  - 两个1x视口截图与冻结PNG逐字节一致。
  - 连同 `1135×917@2x`，当前共87个固定元素坐标检查均满足≤1 CSS px。
  - 冻结记录：`spec/UNBOUNDRY_M0_FREEZE_2026-07-27.md`。
- M1 第一增量已完成：
  - 独立安装并锁定 `@xyflow/react@12.11.2`，未读取或复用 Lumino/Lumino Web 画布实现。
  - 已实现受控 viewport `x/y/zoom`、screen/world 双向换算、真指针pan、滚轮/pinch zoom、缩放滑杆和空画布Fit View复位。
  - 点阵随viewport平移和缩放；screen-space Shell在pan/zoom前后坐标不变。
  - zoom=1.3换算、pan、wheel zoom、slider、Fit View自动检查通过；M0的87项坐标及两张冻结截图继续原样通过。
- M1 第二、三增量已完成：
  - 交互夹具已支持单选、Shift多选、四个拖拽方向框选和主选择ID；选中节点提升到z-index 1000。
  - 键盘方向键移动5 world px、Shift+方向键移动20 world px。
  - 真指针拖拽、zoom=1.3下screen delta/world delta换算和可切换20px snap-to-grid已通过自动检查。
  - 选中节点显示八向resize control；右下resize保持位置不变且宽高比不锁定。
  - 当前完整验证为10项测试PASS；M0冻结坐标和截图未回归。
  - resize 自动检查已改为一次真实指针移动后等待浏览器完成一帧；尺寸结果不变，原先由同一瞬间连续注入6次移动事件造成的 `ResizeObserver loop` 测试噪声已消失。
- M1 第四增量已完成：
  - 小地图空态固定为198×148、左16、底60；节点夹具可显示3个node rect，支持pan/zoom。
  - 连线使用cubic bezier、20px透明命中线，可单独选择；Backspace只删连线并保留两端节点的键盘路径仍存在。
  - 普通edge选中后无重连updater，符合当前活体证据。
  - 合法source→target连接落稳定edge；允许不同source连接同一target。
  - self、source→source、重复和二节点环不落稳定edge；拖到空白或Escape均清理连接预览。
  - 当前完整验证为13项测试PASS；M0冻结坐标和截图继续逐字节通过。
- M1 用户视觉校正第一批已部分通过用户复查：
  - 点击连线会立即显示中央32×32剪刀按钮；鼠标停留约0.7秒也会显示；点击剪刀只删连线并保留节点。
  - 点阵改为SVG世界坐标渲染，基础间距20、基础半径0.5，放大时更清晰、缩小时更弱。
  - 节点静止时两侧连接点隐藏；鼠标悬浮节点即显示24px加号，选中后移开鼠标仍常态显示。
  - 仅由连线悬浮触发的剪刀，在鼠标移出连线/剪刀区域后消失；点击连线触发的剪刀保持显示。
  - 从起点节点连接点拖出后，松到目标节点身体任意位置即可连接；不再要求对准目标连接点。
  - 用户提供的三张验收截图已保存到 `spec/reference/user-acceptance-2026-07-27/`，并写入状态夹具与验收矩阵。
  - M0两张1x截图仅因点阵事实修正而更新；58个固定Shell锚点继续满足≤1 CSS px。
  - 当前13项自动检查重新通过；按验收规则仍不将M1记为用户PASS。
  - 用户已确认连线悬浮/点击出现剪刀、悬浮移出后消失、点击剪刀仅删除连线、拖到目标节点身体任意位置即可连接，以及放大时点阵更清晰、缩小时更弱。
- M1 用户视觉校正第二批已通过用户复查：
  - Unboundry 活体实测选中节点为 `#7a7a7a` 的2px圆角外描边，不使用蓝色高亮。
  - 四角缩放区域仍保留，但与 Unboundry 一样完全透明，不再显示蓝色方块。
  - 用户提供的本地/Unboundry选中态对比截图已保存到 `spec/reference/user-acceptance-2026-07-27/`；用户已确认“很好”。
- M1 冻结前补齐第一批已完成：
  - Shift再次点击已选节点会取消该节点选择；点击空白清空选择。
  - 新增五节点适应视图夹具，两个初始位于屏幕外的节点在点击适应视图后均完整可见。
  - 小地图已自动验证节点矩形、选中状态、遮罩和自定义拖动导航。
  - 当前完整验证增至14项。
- M1 用户视觉校正第三批已通过用户复查：
  - 用户已确认 Shift反选、五节点适应视图和小地图节点/选中/遮罩显示通过。
  - Unboundry 活体实测多选整体框为半透明灰底、灰色1px实线、16px圆角且无蓝色阴影；本地已按同值修正。
  - 小地图保持原有 `198×148 @ (16,709)` 内容坐标，并改为外侧1px连续描边和裁切内部SVG，避免图层盖断边线。
- M1 画布平移手势校正已通过用户复查：
  - Unboundry 活体实测左键拖空白用于框选，普通触控板双指横向/纵向滑动用于平移且 zoom 不变。
  - Unboundry 同输入的平移系数为1.2；本地已将普通滚动从缩放改为相同速度的平移，触控板捏合仍用于缩放。
- M1 小地图拖动校正已通过用户复查：
  - Unboundry 小地图本体不接收事件，其上方有200×150自定义拖动层。
  - 拖动层按固定2倍系数反向平移主画布且zoom不变；单击和滚轮不改变画布。
  - 本地已移除随内容范围变化的默认小地图pan/zoom，改用相同自定义规则。
  - 用户已确认“可以，通过”。
- M1 多选批量连线及其回归修复已通过用户复查：
  - 多选节点时隐藏各节点左右加号，只在整体选择框右侧中线外12px显示一个20×20共用加号。
  - 拖动时按已选节点数显示多条连接预览；松到额外目标节点身体后，每个已选节点各生成一条稳定连线。
  - Unboundry活体还确认松到空白会打开“引用所有选中的节点生成”菜单；该菜单属于后续 `CANVAS-014` 来源感知菜单实现，不在本增量伪造未完成业务。
  - 当前完整验证增至16项，绿地检查、构建、既有M0/M1检查和生产fixture隔离均通过。
  - 用户首次确认批量连线通过；随后发现框选已连线节点会误显示剪刀，证明原验收覆盖不足。
  - 根因是把“框选节点时连线被系统附带标记”为“用户直接点击连线”；现已拆分点击、悬浮和附带选中三种状态。
  - 新增自动回归检查：框选已连线节点不显示剪刀；直接点击和悬浮仍按原规则显示。
  - 用户已再次确认通过，`CANVAS-017` 恢复为正式 PASS。
- M1 节点删除级联与撤销恢复已通过用户复查：
  - 删除夹具初始为3个节点和2条与A相关的连线；选中A按Backspace后只保留B、C，相关2条连线同时删除。
  - Cmd+Z恢复A及两条连线；恢复节点使用新ID、保持同一asset引用并处于选中状态。
  - 当前完整验证增至17项；重复重做仍按既有实测记录保持开放，不在本增量臆造。
  - 用户已确认验收通过，`CANVAS-008`、`CANVAS-009` 正式记为 PASS。
- M1 非法连线矩阵已通过用户复查：
  - 夹具预置A→B；A→A、再次A→B、B→A反向成环和source→source均保持1条稳定连线。
  - 无冲突的B→C仍能正常新增为第2条连线；当前普通连线继续不显示端点重接控制。
  - 当前完整验证增至18项。
  - 用户已确认验收通过，`CANVAS-015` 正式记为 PASS。
- M1 来源感知连线菜单已实现，等待用户复查：
  - Image显示文本生成、图片生成、视频生成、图片编辑器、3D世界Beta共5项。
  - Video显示文本生成、音频生成、视频编辑、3D世界Beta共4项；Audio显示视频生成、数字人视频共2项。
  - 已按Unboundry活体修正为288外框、4内边距、40标题区、278×52菜单行、36图标框；说明文字在悬浮时出现。
  - 菜单固定在松手点；拖动来源节点时临时线起点继续跟随节点，不再断开。
  - 点击外部取消后临时线和菜单消失，保持3节点/0正式连线；当前完整验证增至22项。
  - 用户随后发现点击其他节点未关闭菜单和临时线；已补齐该关闭条件并加入回归检查，当前完整验证增至23项。
  - 用户已重新确认验收通过，`CANVAS-014` 正式记为 PASS。
- M1 “文字生视频”快捷流程及固定UI已通过用户复查：
  - 空态点击入口后生成250×250 Text、444×250 Video和一条Text→Video连线，快捷入口随即隐藏。
  - Text预填英文电影镜头Prompt；连线无箭头，白色高光按2秒周期循环。
  - 当前完整验证增至24项。
  - 用户确认功能通过；空态“双击”徽标已替换为Unboundry当前20×20蓝色鼠标指针图标并通过视觉复查。
  - 用户要求所有固定UI均与Unboundry对齐；左侧Dock外框、坐标、按钮圆角、颜色、阴影及六个图标已按当前活体DOM重测并修正，头像内容继续作为登录用户动态数据。
  - 用户已确认左侧Dock与中央快捷入口通过，`CANVAS-007`、`UI-005`、`UI-006` 正式记为 PASS。
- M1 复杂大画布性能门禁已通过用户复查：
  - `legacy.dense-canvas.neutral` 已装入62节点、58条连线和5个组，并恢复历史观测到的0.15初始缩放。
  - 自动检查覆盖节点拖动、缩放和小地图开关；操作期间无≥250ms长任务，也没有产生保存或其他XHR/fetch请求。
  - 完整验证现为25项，绿地检查、构建、既有M0/M1检查和生产fixture隔离全部通过。
  - 用户确认主要功能通过，但发现小地图上触摸板横滑会触发浏览器返回；已在页面根层禁止横向回退手势，并加入小地图横滑不离开当前画布的回归检查。
  - 用户复查横滑修复通过，`CANVAS-016` 正式记为 PASS；`CANVAS-001～CANVAS-017` 全部通过，M1冻结。
- 固定界面复核候选已完成：
  - 左下控制条、三个按钮状态、缩放条、帮助按钮、小地图底色已按同视口 Unboundry 活体 DOM 校准。
  - 右上社区/分享按钮、左上身份标记和右下 Agent 气泡已校准；项目标题、头像内容保留为本地动态数据。
  - `1135×917@2x` 的底栏、帮助、右上三按钮及 Agent 气泡坐标与 Unboundry 实测一致；25项完整验证通过。
  - 用户确认后已进入 Text 节点。
- M2 Text 当前范围已通过用户复查：
  - 当前 Unboundry 活体重新确认默认250×250、空态提示、灰色选中边框、标题输入、第一次 Escape 仅退出正文编辑，以及617×48的14项工具栏。
  - 本地已实现普通、悬浮、选中、正文编辑和标题编辑状态；保留左右连接点、8个调整大小区域及250×250下限。
  - 14项工具栏已具备背景色、标题级别、正文、粗斜体、列表、分割线、Pin、复制、保存标记和原生全屏动作。
  - 已修复正文永久禁止拖动导致节点不能移动的问题：普通状态可拖动，编辑状态正文不带动节点。
  - 已修复双击已有文字后光标跳到最前面的问题：现在按双击坐标放置输入光标。
  - 用户已确认节点内功能、拖动和光标行为通过；`NODE-001`、`NODE-002`、`NODE-004` 记为 PASS，中文 IME 与真实持久化仍留在 `NODE-003`。
- M2 Image 基础候选已完成：
  - 新增独立 Image 组件，不复用 Probe 占位卡；空态为250×250、标题在卡片上方、中央图片图标、左右连接点且无resize control。
  - 第一候选经用户实页复查被拒绝：发现图片上传未进入撤回记录、图片覆盖层阻止节点拖动、缺少替换按钮、上传后左侧加号错误保留、竖图比例错误及标题不可编辑。
  - 撤回已从“仅记录最后一次删除”改为统一画布历史：当前覆盖键盘/指针移动、resize、连接、剪刀删线、节点/连线删除、图片上传/替换和Image标题修改；删除恢复继续保持新node ID和同asset引用。
  - 图片状态已从组件内部临时状态移入节点数据，上传和替换现在可由Cmd+Z恢复。
  - 图片本体改为禁止浏览器原生拖图但允许拖动画布节点；上传后鼠标悬浮右上角显示“替换”。
  - 上传后隐藏左侧加号、保留右侧加号；横图、竖图和方图均保持原始比例并以短边250派生，16:9为444×250、9:16为250×444。
  - 选中Image后标题切换为可编辑输入框，改名进入撤回记录。
  - 用户已确认上传、替换、端口、拖动、横竖比例和多步Cmd+Z通过；随后发现受控标题输入在中文输入法组词期间被节点刷新打断。
  - Image标题已改为组词期间保持本地草稿、组词结束后一次写入节点数据；新增中文组合输入及撤回回归检查。
  - 自动检查覆盖空态、选中态、无resize control、上传、替换、中英文标题、拖动、横竖比例及多步Cmd+Z。
  - 用户已确认中文标题修复通过，`NODE-005`正式记为PASS。
- M2 Image 图片生成输入区候选已完成：
  - 新增独立 `node.image.prompt-ready` 状态，保持Image节点选中并在下方显示图片生成输入区。
  - 提示词控件为678×80，placeholder为“描述任何你想要生成的内容”。
  - 当前冻结参数为 `Nano Banana 2 Lite`、`自适应 · 1K`、`1×`，不显示或计算额度。
  - 空提示词时Generate禁用；输入非空提示词后启用。本阶段不触发真实生成。
  - 用户首轮实页复查确认输入区外观与启用逻辑满意，但发现取消选中后输入区未消失、空Image节点主体无法稳定拖动。
  - 输入区现仅在Image节点选中时显示；空态上传区域同时作为节点拖动区域，普通点击仍保留上传行为。
  - 新增取消选中自动收起及空态主体拖动回归检查。
  - 用户已确认输入区外观、启用逻辑、取消选中收起及节点拖动修复通过，`NODE-006`正式记为PASS。
- M2 Video 基础候选已完成：
  - 新增独立 `node.video.empty` 状态和Video组件；空态固定444×250、标题在节点上方、中央上传图标、左右连接点且无resize control。
  - 本地视频上传后仍保持444×250，使用静音、无原生controls的video元素及自绘播放按钮。
  - 支持悬浮“替换”、节点拖动、中英文标题修改以及上传、改名、移动的Cmd+Z撤回。
  - 用户首轮实页复查确认其余功能通过，但发现竖向视频未随原始比例调整、上传后左侧加号错误保留。
  - Image与Video现共用已冻结的视觉媒体尺寸规则：横向素材高250、竖向素材宽250；576×1024视频为250×444。
  - Video上传后隐藏左侧加号并保留右侧加号；规则、复用边界及防回归要求已写入强制工程约束。
  - 用户指出Unboundry节点内没有中央大播放按钮，并要求实测节点播放器和放大详情；已在当前登录的真实Unboundry页完成只读DOM、坐标及播放状态采集。
  - 节点播放器现按实测改为：无中央大图标；选中或悬浮时显示左上28×28静音按钮及底部播放、当前时间、0.1秒进度条、总时长和放大按钮；普通状态自动隐藏。
  - 放大详情现包含播放器、进度、音量、浏览器全屏、252×180提示词区、八项视频信息、应用到画布、下载及关闭；1135×917样本的对话框为1087×876、信息栏宽284。
  - 用户已确认播放器、放大详情及全部Video基础范围通过，`NODE-007`正式记为PASS。
- M2 Audio 基础候选已完成：
  - 新增独立 `node.audio.empty` 状态和Audio组件；空态与上传态均固定444×250、标题在节点上方、左右连接点且无resize control。
  - 用户实页复查否决固定波形、常驻替换、节点内下载、上传后左侧加号及卡顿进度。
  - 真实Unboundry活体复查确认：上传态左侧加号强制隐藏；替换仅节点悬浮显示；下载位于选中态上方48px胶囊工具栏，工具栏共颜色、素材检查、下载、保存到素材库4项。
  - 本地WAV现经Web Audio解码为64段真实采样波形，播放位置由浏览器逐帧刷新；不再使用固定假波形。
  - 支持节点拖动、中英文标题以及上传、改名、移动的Cmd+Z撤回；当前等待用户复验。
  - 同步复查全部已实现节点的上方工具栏：Text已有独立格式栏，Audio已按活体补齐；Image与Video仍缺各自完整上方工具栏，继续归入未完成的 `NODE-012`，不得误报已对齐。
  - 用户已确认Audio全部功能及修正后的215×48工具栏通过，`NODE-008`正式记为PASS。
  - 当前Unboundry活体确认Image工具栏为400×48/9按钮；Video为442×48/10按钮，逐项指针悬浮确认顺序为剪辑、增强、替换、移除、截帧、浏览全部、Pin、保存到素材库、下载、全屏查看。
  - 本地已补同尺寸、顺序、分隔、tooltip和选中态显示候选；下载及Video放大沿用现有真实动作，其余高级动作仍按独立功能阶段实现。
  - 用户已确认Image与Video工具栏候选通过；`NODE-012`仍保持进行中，因为Playlist、Group等其余节点的统一工具栏状态尚未完成。
  - `NODE-013` 已新增 `legacy.node-geometry.families` 综合页：默认尺寸、素材比例派生尺寸和用户调整后的尺寸分行展示；同一套默认尺寸常量供该页和产品节点基线使用。自动检查通过，等待用户实页复验后才可标记为PASS。
  - 用户已确认三类节点尺寸规则通过，`NODE-013` 正式记为PASS。
  - `NODE-011` 代码审查确认当前七类产品节点分别由 Text、Image、Video、Audio、Playlist、Group、Storyboard/Table 独立组件承载；Probe仅用于画布测试样本，不承担产品节点条件分支，正式记为PASS。
  - 用户已确认文字节点标题的中文输入法、保存反馈和撤回通过，`NODE-003`正式记为PASS。
  - Text、Image、Video、Audio、Playlist与Group各自工具栏/选中外框已在前序实页逐项通过；Storyboard历史只读态无工具栏，`NODE-012`按累计证据正式记为PASS。
  - `legacy.node.group-dense-selected` 已接入3443×2111模板组候选，保留390×48工具栏、24×24八向控制点和“更新模板”状态，等待用户实页复验。
- M2 Playlist 第一候选已完成：
  - 新增独立 `node.playlist.empty` 状态和Playlist组件，不使用Probe占位卡。
  - 默认尺寸960×104、背景#1f1f1f、16px圆角；时间尺从00:00到01:00，每10秒一个标记。
  - 空态显示48×48“添加片段”按钮和“轻点 + 在画布上选取视频”；点击进入选片提示，Escape无写入退出。
  - 选中后显示八向调整区域；宽度下限250、高度下限104，宽高可独立改变且不设未经证实的最大值。
  - 首轮实页复查发现标题无法修改；现已补齐与Image/Video/Audio一致的中英文标题编辑、中文输入法组合输入及Cmd+Z撤回。
  - 用户确认Playlist不应显示左右连接加号；本地保留不可见连接锚点以免封死后续兼容性，但所有状态均隐藏加号。
  - 真实Unboundry内置浏览器实测：只有已含片段且被选中的Playlist，左侧才出现两个50×50按钮；空Playlist选中时不显示。按钮距节点左侧58px、纵向间隔8px；上方为切割、下方为导出播放列表，12px圆角和白色12%底色。
  - 用户指出首尾时间文字被16px圆角裁切；按Unboundry空节点活体的左右8px内边距修正，时间文字与全部刻度共同内收，节点尺寸和圆角不变。
  - `node.playlist.workflow` 现提供两个空Video和一个空Playlist，供真实本地视频完成整条人工验收。
  - 选片模式按Unboundry补齐顶部蓝色提示、连续点选、来源节点锁定、添加反馈、退出和Escape零写入；片段按时长进入时间轴并可拖动换序。
  - 已补播放头、连续视频预览、播放/暂停、静音、进度、全屏和关闭；选中有片段的Playlist才打开预览。
  - 2026-07-28 用户实页复查指出空Video父节点204px与卡片250px不一致、混合中文输入末尾英文重复、Playlist有内容后难以移动、预览固定尺寸黑边、播放头不跟随鼠标、无双侧裁剪柄/空格播放/时间轴内部缩放、切割缩略图相同和导出缺少可见结果。
  - 已统一两个空Video为444×250；Image/Video/Audio/Playlist标题组合输入均延迟到输入法完成后提交，避免“测试a”变“测试aa”。
  - Playlist现按真实Unboundry规则：选中有内容节点显示自适应比例播放器，取消选中关闭；鼠标在片段上移动时预览与白色播放头逐帧跟随，点击时间尺提交播放位置，空格播放/暂停。
  - 时间轴在节点内拦截滚轮/触控板缩放并以光标所在时间为中心，节点外仍交给整张画布；最大放大到逐帧刻度，缩略图按当前片段起点和缩放等级采样，不再把切割后的两段都画成原视频第一帧。
  - 片段选中后显示左右白色裁剪柄并实时改变起止点、时长和宽度；原有C/Q/E与Cmd+Z保留。排序改为拖动经过时即时让位并增加过渡反馈；时间尺、片段和按钮之外的空白仍可拖动整个节点。
  - 已按真实快捷键面板补齐 `C=切割`、`Q=向左裁切`、`E=向右裁切`，三个动作及顺序变更均写入同一撤回历史。
  - 导出菜单按Unboundry实测为224×106和三项原文；原始片段逐个触发真实下载并显示结果，合并视频由本机FFmpeg按当前顺序和裁剪点生成真实MP4，“导出到画布”在当前视野中央创建Video；处理中、完成和失败均使用固定可见提示，请求中断会终止FFmpeg并清理临时目录。
  - 自动检查现使用一个9:16和一个16:9真实带声音MP4，覆盖空态、选片、连续添加、来源锁定、自适应预览、鼠标预览、空格播放、时间轴缩放、双侧裁剪柄、排序、按钮切割、C/Q/E、Cmd+Z、三种导出、FFmpeg合并和ffprobe成片时长；全量32项检查通过，当前等待用户整轮复验。
  - 用户已确认输入法、双播放头优先级、固定胶片式裁剪、缩略帧密度与比例、片段删除不级联删除Playlist等修正通过；`NODE-009`正式记为PASS。
- M2 Group 第一候选已完成，等待用户复查：
  - Unboundry当前活体重新确认多选后“打组”会按子节点包围盒四周增加20px，子节点原位置不跳动。
  - 新增独立Group组件；外层16px、内层12px圆角，选中态显示8个调整区域和固定390×48工具栏。
  - 支持中文标题、颜色、宫格/水平布局、整体移动、独立调整外框、解组和已有媒体下载；外框调整不缩放内部节点。
  - 删除Group会级联删除组内节点及相关连线，Cmd+Z恢复时同步恢复新的Group与正确父子关系；解组保留子节点绝对位置。
  - “整组执行”和“创建模板”分别属于后续生成与模板阶段，当前显示禁用且不伪造成功结果。
  - 新增2项Group自动检查；全量验证现为34项并全部通过。
  - 用户已确认标题、颜色/布局、整体移动、外框调整、解组及删除/撤回主链通过；`NODE-010`正式记为PASS。
  - 用户已确认3443×2111模板组、390×48工具栏、24×24角控件和布局/颜色动作通过；`NODE-016`正式记为PASS，M2节点阶段全部关闭。
  - 用户已确认节点、连线、素材引用、音频时长与视野刷新后恢复；`DATA-001`正式记为PASS。
  - `DATA-002`新增`persistence.final-clean-canvas`候选：删除全部测试节点后空态即时恢复，并把0节点/0连线写入同一SQLite文档，等待用户刷新实页复验。
  - 用户确认清空与刷新通过，并指出评论功能移除后左侧栏遗留空槽；左侧栏已收短44px，历史与头像同步上移并重新垂直居中。
  - 用户确认空画布刷新不回流、无首屏节点闪现及收拢后的左侧栏通过；`DATA-002`正式记为PASS。
- M2 Storyboard/Table 历史载入候选已完成：
  - 新增独立Storyboard/Table节点，只通过历史fixture载入，不向当前创建菜单添加无证据入口。
  - 固定逻辑尺寸1200×1000，显示两张完成卡和一张独立加载卡。
  - 图表视图与创意视图共享同一组三条历史数据，覆盖媒体、分镜编号、时长、景别、内容摘要、对白和备注。
  - 未实现当前尚无活体证据的创建、编辑、卡片增删改和resize。
  - 构建、3项固定界面检查和2项Storyboard/Table专项检查通过；当前等待用户实页验收。
  - 用户已确认历史载入、完成/加载卡和双视图候选通过；`NODE-014`正式记为PASS。
- 系统剪贴板与跨画布仍不足以裁决；同画布内部复制/粘贴已确认。
- 已登记刷新后回流两个未知 Image 和一条 edge 的持久化/并发异常。

## M1 冻结结论

`CANVAS-001～CANVAS-017` 全部 PASS。后续节点开发不得破坏画布选择、拖动、缩放、连线、小地图和复杂画布性能。

下一阶段：七类节点的统一最小内容模型与独立组件；Comment已按用户决定移出产品范围。

## 后续阶段前仍需补测

1. Storyboard/Table当前可达创建、编辑和resize生命周期；在找到入口前只把历史1200×1000状态作为载入/渲染规格。
2. Text、Playlist、Group是否存在高于第四批大型样本的全局硬上限；只有观察到clamp才登记最大值。
3. edge成功重连，或确认当前普通edge设计上不支持重连。
4. 使用可确认原生快捷键事件的系统剪贴板与跨画布补测。
5. 使用系统下载UI或下载管理器确认Video/Audio下载文件结果。
6. `1512×982@2x`及最小支持宽度。
7. 原项目刷新后远端状态回流异常的revision/多标签排查。

## G0.1 已满足的退出条件

- 新仓库包含40张且仅包含真实 Unboundry参考PNG。
- 本地PNG文件名、数量和SHA全部与机器清单一致。
- 40张图片全部有视觉复核记录。
- 每张图片至少关联一个fixture或明确记录“仅视觉参考”。
- 所有新发现的逻辑缺口均进入状态夹具和验收矩阵。
- Lumino Web工作树保持只读、状态不变。
- G0.2冻结时产品代码为0；M0现已按授权开始写入绿地实现。

## G0.2 当前执行记录

`spec/UNBOUNDRY_G0_2_LIVE_SURVEY_2026-07-27.md`

冻结记录：`spec/UNBOUNDRY_G0_2_BASELINE_FREEZE_2026-07-27.md`

## 需要额外授权后才能做

- Agent真实发送或可能触发生成的工具调用。
- 麦克风权限。
- 第二账号/朋友参与的多人协作验证。
- 公开分享、团队移动或其他外部状态变更。
- `AUTH-001/002`登录、项目访问、邀请和成员管理：用户于2026-07-31明确暂停，后期再做；不得遗忘、删除或擅自标记完成。
- `AUTH-003`已完成：源码与生产浏览器包未发现Provider密钥形态，客户端未读取敏感环境变量或发送Authorization，空画布没有外部网络请求，Canvas/Image/Audio/Video四类错误响应不含密钥、环境变量名或本机路径；仓库忽略`.env/.env.*`和密钥文件检查通过。专项自动检查1项及项目构建通过，正式记为PASS。

## 当前阻塞

M1、Text、Image、Video、Audio及Image/Video上方工具栏已通过。M2 Playlist第一候选等待用户复查。

`OPEN-025`的原Unboundry项目异常来源仍不可追溯，但本地复刻不再阻塞：`DATA-002`已由用户确认清空0节点/0连线后刷新不复活，`DATA-005`已由用户确认旧标签页revision冲突返回409且不能覆盖新状态。2026-07-31重新运行持久化与双标签共5项检查全部通过，故按当前实现关闭为`RESOLVED-CURRENT`，不重复要求用户验收。

边界提示：Lumino Web 工作树在本轮结束时出现11个外部修改文件；本轮未写入该仓库，也不读取或并入这些实现。

## M3 当前执行

- 已把文字节点创作区补成独立验收项 `GEN-008` / `node.text.creator-open`，覆盖参考素材、提示词、模型、数量、提交状态和失焦关闭；未授权前禁止真实付费生成。
- 当前继续 `DATA-003`：账号级历史必须独立于画布文档，删除画布节点不得删除历史素材。
- `DATA-003`候选已完成：历史素材存入独立SQLite表；`panel.history.final`按Unboundry证据显示图片2、视频1、音频4、3D 0，删除画布素材节点及刷新均不改变历史数量。构建、历史专项、持久化回归和外壳回归共7项自动检查通过，等待用户实页复验。
- 用户已确认删除画布节点、历史数量不变及刷新保持通过；`DATA-003`正式记为PASS。
- `DATA-004`已完成当前真实边界：自动启动服务写入画布、视野、媒体引用和账号历史，完全停止进程后重新启动，四项均从同一SQLite恢复。生成任务尚未进入M5队列，故本项保持PARTIAL而不虚报PASS。
- `DATA-005`候选已完成：两个页面从同一版本开始编辑，第一页保存后第二页的旧版本写入会收到409，并显示“另一页面已经保存了更新”；服务端保留第一页内容，点击重新载入后第二页恢复最新版本。构建、双页冲突、持久化及历史共5项检查通过，等待用户实页复验。
- 用户已确认双页面冲突提示、禁止旧版本覆盖及重新载入恢复通过；`DATA-005`正式记为PASS。M3只剩依赖M5任务队列的`DATA-004`任务恢复部分，当前不虚报关闭。
- M4图片上传候选已完成：双击画布打开当前7项创建菜单，从“添加资源/上传”选择PNG后，文件写入自有服务器媒体目录，再创建Image节点；标题自动去扩展名，尺寸随比例派生，保留替换入口，不写入生成历史，刷新后图片仍可用。
- 非图片MIME已确认不会创建节点、不会写入媒体文件；20MB上限和深度解码攻击仍归`MEDIA-003`后续检查。构建、上传、Image、持久化和双页冲突共7项自动检查通过，等待用户实页复验`MEDIA-001/002`。
- M4首轮实页复查发现三个问题：创建菜单被空画布快捷入口遮挡、双击节点标题会误开创建菜单、上传两个节点并替换第二个后刷新可能串换第一张图片。
- 图片串换根因已定位：上传测试页曾让所有新图片复用同一个媒体编号，后一次上传会覆盖前一次文件；节点替换又只保存了临时浏览器地址。现已改为每次上传和每次替换都创建独立媒体编号并写入服务器，节点只更新自己的引用。
- 创建菜单打开时画布层级现高于空画布快捷入口；双击创建只接受画布空白，不再接受节点、标题、输入框或按钮。
- 新增“两张不同图片→只替换第二张→刷新”的完整回归检查，并验证第一张文件内容、两个节点媒体编号及刷新后的节点引用均互相独立。构建、M4上传3项和Image 2项自动检查通过，等待用户复验后再决定`MEDIA-001/002`状态。
- 用户已确认菜单层级、节点标题不误开菜单、两张图片独立上传/替换/刷新全部通过；`MEDIA-001/002`正式记为PASS。
- `MEDIA-003`已补服务器信任边界检查：20MB传输上限、PNG完整分块与CRC、合法色彩/位深、4000万像素和128MB解压上限、完整解压长度；非法MIME、伪造/截断PNG和超限文件均返回失败且无节点、无媒体残留。M4上传4项检查通过，正式记为PASS。
- `MEDIA-004`音频上传候选已完成：`interaction.upload-media-sandbox-current`提供可持久化Audio节点；WAV通过真实文件选择器写入自有服务器，节点保存独立媒体编号、真实64段波形、时长和文件信息。
- 音频服务器支持按需分段读取，播放、暂停、前后10秒、进度和下载不依赖临时浏览器地址；完全刷新后仍从服务器恢复同一WAV、波形及00:00/00:01。
- 构建、Audio基础、WAV持久化及图片上传共6项自动检查通过；`MEDIA-004`保持IN_PROGRESS，等待用户实页复验。
- 按用户真实素材情况，Audio持久化范围扩展为WAV、MP3、M4A和AAC；服务器按格式校验并返回正确媒体类型，四类文件都使用独立媒体编号和分段播放。
- 自动生成的真实1秒MP3与M4A已通过上传、真实波形、服务器读取和刷新恢复检查；WAV、MP3、M4A共3条持久化检查及Audio基础检查通过，等待用户使用自己的常见音频复验。
- 用户已使用自己的常见音频确认上传、播放与刷新恢复通过；`MEDIA-004`正式记为PASS。
- `MEDIA-005`视频上传候选已完成：同一上传沙盒现提供Audio与Video两个独立节点；MP4先经浏览器解码，再以独立媒体编号流式写入自有服务器，500MB上限且失败不留临时文件。
- 视频服务器支持按需分段读取；节点持久化原始宽高、时长、文件大小和服务器地址。静音、自绘播放、0.1秒进度、全屏详情、替换、下载及刷新恢复继续沿用已通过的Video交互。
- 真实320×180/1秒带声音MP4已通过上传、元数据、进度、播放、分段读取、下载文件逐字节一致和刷新恢复检查；Video基础、Audio及Image回归共10项通过。`MEDIA-005`保持IN_PROGRESS，等待用户实页复验。
- M4实页复验仅余“改标题后立刻刷新会回到旧标题”：第一层根因是中文输入法结束组合输入时只更新输入框，没有把最终文字写回节点；Text、Image、Video、Audio、Playlist统一在输入完成时写回，Group也改为相同保存时机。
- 用户二次复验发现真正的零等待刷新仍会抢在50ms保存计时前发生；现已在网页离开瞬间取消等待并强制提交当前节点，且保留revision冲突保护。内置浏览器已复现“输入后不等待直接刷新”并确认标题保留。
- 用户三次复验进一步暴露中文输入法候选词尚未正式落字时刷新：此时React节点数据尚无最终文字。离页保存现直接读取当前可见标题输入框，再写入对应节点，覆盖输入法仍在组合中的刷新场景。
- 彻查发现前三次修复没有覆盖真正主因：一次标题编辑只在第一个字符建立撤销记录并标记待保存；50ms保存完成后，后续字符只更新页面内节点却不再标记待保存，所以刷新会回到第一个字符。
- 现已把“建立一次撤销记录”和“每次标题变化都标记待保存”拆开；Text、Image、Video、Audio、Playlist、Group每个字符及中文输入法组合过程都会进入同一SQLite revision保存链，保存状态只在服务器确认后显示完成。
- 新增逐字符慢速输入回归检查，验证五类可持久化节点在第一个字符已经保存后继续输入并立刻刷新仍保留完整标题；中文输入法未结束刷新、慢速输入、双页冲突及节点/媒体共23项回归和构建全部通过，等待用户最终实页复验。
- 用户已确认视频标题修改后直接刷新保持正确；`MEDIA-005`正式记为PASS。此前PNG、MP4及WAV/MP3/M4A均已分别使用真实本地素材验收且无失败残留，重复的综合上传项`MEDIA-006`同步关账，不再重做一遍相同功能。
- 图片结果上方400×48、九个40×40按钮工具栏此前已获用户实页确认，`IMGEDIT-001`正式记为PASS。
- `IMGEDIT-002`图片更多菜单候选已按Unboundry参考26实现：238×272、16px圆角、8px/4px内边距，含扩图、擦除、标注、增强、调整像素、抠图、快速切分2×2/3×3/4×4及Seedance合规验证；高级处理尚无真实后端，菜单项保持无写入，等待用户实页复验。
- 用户已确认图片更多菜单的外观、内容及开合交互通过；`IMGEDIT-002`正式记为PASS。
- `IMGEDIT-003/004`图片裁剪候选已完成：全屏遮罩、最大987×552图片区、四角裁剪柄、移动/调整选区、252×42底栏和128×275八比例菜单已接入。
- 取消裁剪不修改节点和素材；确认裁剪在浏览器内按原图像素生成PNG，再上传为新的独立素材编号。此前错误地在原节点中替换为裁剪结果，原素材文件虽保留但画布关系不符合Unboundry。
- 首轮实页复查发现裁剪框内多出无Unboundry证据的构图细线，且确认按钮文字换行；已移除内部细线，仅保留Unboundry可见的四角拖动手柄，并把勾选图标与“确认裁剪”固定为单行居中。
- 用户已确认裁剪外观及取消逻辑通过；随后用真实Unboundry对比发现确认裁剪应保留原节点，在右侧新建裁剪结果节点并由原图自动连线。`IMGEDIT-003`保持PASS，`IMGEDIT-004`重新进入实页复验。
- `IMGEDIT-005`图片多角度候选已按参考23实现600×308面板：拖拽方块、旋转/倾斜/缩放、广角镜头、重置及提交位齐全；真实生成服务尚未授权，提交按钮保持禁用且自动检查确认零生成请求。
- 多角度首轮实页复查发现三面模型在部分角度会全部背向视点，拖拽产生的浮点数也会溢出数值栏；现改为Unboundry式图片面加L/B参考面并允许双面可见，旋转/倾斜按0.5°归整且最多显示一位小数。
- 用户已确认图片多角度的参考面、角度显示和其余交互通过；`IMGEDIT-005`正式记为PASS。
- `IMGEDIT-006`图片重绘候选已按参考24实现：图片编辑区、385×58顶部工具条、画笔/框选/橡皮、画笔大小、蒙版撤销/恢复及500×122提示词卡均已接入。
- 蒙版按图片原始像素保存坐标，缩放后的指针会换算回原图；取消重绘不修改节点或素材。真实生成服务未授权，提交按钮保持禁用且零生成请求。构建及Image 5项自动检查通过，等待用户实页复验。
- 用户已确认图片重绘的外观、蒙版工具及取消逻辑通过；`IMGEDIT-006`正式记为PASS。
- `IMGEDIT-007`图片打光候选已按参考25实现602×340设计面板：322×322预览、透视/正面、亮度、色温、六方向主光源、轮廓光、重置及提交位齐全。
- 用户认为当前投入收益过低，决定暂停`IMGEDIT-007`，后期再继续；现保留全部实现代码，但图片工具栏“打光”入口保持禁用并标注“暂未开放”。
- 打光参数只保存在本地编辑状态，关闭不修改原图；真实生成服务未授权，提交按钮继续禁用且零生成请求。暂停期间不得把`IMGEDIT-007`记为PASS。
- `IMGEDIT-008`安全候选已完成：裁剪取消保持原素材；派生素材保存失败时保留编辑器、显示错误且不修改节点或原素材；保存过程中禁止关闭，避免关闭后异步覆盖原图。
- 裁剪确认现改为保留原节点，新建独立Image结果节点并建立原图到结果的连线；原节点的素材编号、图片和尺寸均不改变。
- 多角度、重绘及已暂停的打光均无可提交后端，继续保持零发布；服务器只在PNG完整校验并原子落盘后才发布素材。构建和Image 6项自动检查通过，等待用户实页复验后再决定`IMGEDIT-008`状态。
- 用户已确认取消裁剪、原节点保留、新建裁剪结果节点及自动连线通过；`IMGEDIT-004`和`IMGEDIT-008`正式记为PASS。
- `IMGEDIT-009`候选已完成：多角度生成、重绘提交、打光入口/生成及图片更多菜单8项未接入能力均使用真实禁用状态；无按钮会伪造成功或发起Provider请求，等待用户实页复验。
- 用户已确认所有未接入的图片高级编辑入口均处于不可点击状态；`IMGEDIT-009`正式记为PASS。当前`IMGEDIT-001～006、008、009`均PASS，`IMGEDIT-007`按用户决定保持PAUSED。
- `GEN-001`图片生成中候选已按冻结事实实现：250×250节点暗色覆盖层、18×18点阵、背景放大1.9、模糊42px、透明度0.22及指定缓动；Prompt、模型、尺寸、数量和Generating按钮全部禁用。
- 该状态只由开发夹具展示，不会启动任务、扣除额度或调用Provider；项目构建及Image 7项自动检查通过，等待用户实页复验。
- 用户已确认图片生成中效果符合预期并认可其动效表现；`GEN-001`正式记为PASS。
- `GEN-002`图片成功态候选已按冻结事实实现：250×250结果节点、`img`的contain展示、左上角28×28收藏按钮，以及成功后保留的Prompt、模型、尺寸和数量。
- 当前仅展示冻结成功态，不会伪造生成任务或扣费；真实生成按钮继续禁用。项目构建及Image 8项自动检查通过，等待用户实页复验。
- 用户已确认图片成功态符合预期；`GEN-002`正式记为PASS。
- `GEN-003`视频生成中候选已实现：444×250视频节点内显示loading，Prompt、模型、模式、参数、数量和Generating按钮全部禁用。
- 该状态只由开发夹具展示，不会启动任务、扣除额度或调用Provider；项目构建及Video 2项自动检查通过，等待用户实页复验。
- 用户反馈旋转loading容易产生“素材显示失败”的不安感；按用户决定改为与图片生成中一致的18×18点阵流动动效，等待重新复验。
- 用户要求视频流动幅度稍微增强；已为视频单独调整为45%～55%，不改动已经通过的图片生成动效。
- 用户复验后要求再增强两档；视频流动范围进一步调整为35%～65%，速度不变，图片生成动效仍不改动。
- 实页检查确认动画处于running，但单独移动模糊背景位置的视觉变化几乎不可见；视频背景层已改为同时做±8%水平、±4%垂直位移，使流动可被明确感知。
- 用户及多人复验仍无法感知背景流动；视频点阵现改为自身横向36px、纵向12px缓慢漂移，并在0.5～0.9透明度间变化，确保人眼能明确感知生成中动效。
- 用户认为点阵漂移动效不美观；已替换为呼吸动效，点阵只做轻微缩放和明暗变化，背景同步柔和呼吸，不再横向滑动。
- 用户已确认视频生成中的呼吸动效通过；`GEN-003`正式记为PASS。
- 用户随后发现当前验收页改节点名后刷新会复原。根因是普通`node.*`验收页未进入既有SQLite画布保存链路；现已统一接入共享持久化，不增加localStorage旁路，并新增视频生成页立即刷新回归检查。
- 项目构建通过；Text、Image、Video、Audio、Playlist、Group及SQLite持久化共21项相关自动检查通过。
- 用户已确认节点改名后直接刷新能够保留，标题持久化问题通过人工复验。
- `GEN-004`视频成功态候选已按冻结事实实现：本地5.08秒、836×480可播放结果，保留Prompt与参数，视频历史独立增加1项。
- 该页面只回放本地开发素材和冻结状态，不会创建生成任务、真实扣费或调用Provider；真实Generate按钮继续禁用。项目构建及Video/History 4项自动检查通过，等待用户实页复验。
- 用户已确认视频成功态通过；本地验收样片按安排不含音轨并默认静音，声音播放能力沿用已通过的媒体播放验收。`GEN-004`正式记为PASS。
- `GEN-005`音频成功态已按冻结事实实现：一次展示2个本地03:04结果，均保留下载、±10秒、播放/暂停和进度，视频历史之外独立增加2条音频历史。
- 用户已确认音频成功态通过，`GEN-005`正式记为PASS；页面不会创建生成任务或调用Provider。随后按用户决定移除全项目额度入口、费用文字和计算字段，结果数量及历史记录逻辑保持不变。
- `GEN-006`要求的失败、取消、重试和恢复仍在`OPEN-007`明确缺少真实Unboundry证据；当前Unboundry实页也没有可复核样本，禁止凭空补画面，因此`GEN-006`保持BLOCK。`GEN-007`依赖尚不存在的真实任务队列，同步保持BLOCK。
- `GEN-008`文字创作区候选依据参考38–39实现628×200面板：参考素材位、提示词、Gemini 3.1 Flash Lite、语音、数量和提交位齐全；按当前私有版规则不显示额度，所有动作按钮保持禁用且零Provider请求，等待用户实页复验。
- 用户已确认文字创作区外观和禁用边界通过，`GEN-008`正式记为PASS。
- 为便于`PLAY-001`人工复验，新增只使用本地样片的`node.playlist.pick-ready`验收页；两个来源Video已就绪，不需上传即可测试进入选片、连续添加、反馈和退出，且不会触发Provider。
- 用户已确认播放列表进入选片、连续添加、反馈和退出流程通过，`PLAY-001`正式记为PASS。
- `PLAY-002`人工验收页新增一个4秒9:16本地样片，并与既有5.088秒16:9样片组成双片段Playlist；用于直接复验节点移动、片段换序、总时长和播放器按片段比例自适应。
- `PLAY-002`首轮实页复验确认比例、换序和移动通过，但发现第一片播放结束切换第二片时旧播放器的暂停事件会误把整个播放列表改为暂停，必须再次点击播放。
- 已移除这个多余的暂停回写；用户主动暂停仍由播放按钮控制，片段切换时保持播放状态并自动开始下一片。新增第一片末尾自动切到第二片且继续播放的回归检查，等待用户复验后再决定`PLAY-002`状态。
- 用户已确认比例、换序、移动和片段连续播放全部通过，`PLAY-002`正式记为PASS。
- 用户已确认逐帧预览、播放头、空格播放、时间轴缩放、双侧裁剪、`C/Q/E`及撤回通过，`PLAY-003`正式记为PASS。
- `PLAY-004`实页复验发现导出到画布的新Video使用临时浏览器地址，地址失效后节点会黑屏；现改为先保存到项目自己的视频存储，再创建Video节点，并新增刷新后从5.5秒继续播放的回归检查，等待用户复验。
- 用户已确认三类导出和修复后的画布Video持续播放通过；`PLAY-004`正式记为PASS。
- `AGENT-001`候选已按冻结坐标实现：右侧480px Agent面板、左侧画布裁切到655px、双建议卡、底部输入区、手动确认、模型、语音和空内容禁用发送；构建、M0外壳3项及Agent坐标检查通过，等待用户实页复验。
- `AGENT-001`实页复查时发现从创建菜单新建Text/Image/Video只落了空节点，没有写入各自已通过的创作区状态，导致底部创作框不可达；现已让三类新建节点直接进入对应创作态。Text选中仍显示顶部格式栏；空Image/Video继续不伪造只有结果素材才可用的顶部结果工具栏。构建、Text/Image/Video 13项及Agent 2项自动检查通过。
- 用户已确认Agent面板以及修复后的节点上下工具栏通过；`AGENT-001`正式记为PASS。
- `AGENT-002`候选已依据状态夹具并再次对照Unboundry v2.12.4实页实现：添加菜单5项、从画布引用模式与蓝色退出提示、引用缩略图、手动/自动确认、Auto switch、可选/锁定/即将上线模型及帮助入口齐全。
- 引用选择期间节点不可拖动且不会弹出节点结果工具栏；所有Agent菜单只改变本地界面状态，不会上传附件、运行插件、启动生成或调用Provider。项目构建及Agent 3项自动检查通过，等待用户实页复验后再决定`AGENT-002`状态。
- `AGENT-002`首轮用户复验确认其余交互通过，但指出手动确认/自动生成使用表情字符，与项目灰白细线图标规范不一致；现已替换为统一的单色线性确认和循环图标，文字、状态和交互不变，等待用户复验。
- 用户已确认统一后的确认模式图标及`AGENT-002`其余交互通过；`AGENT-002`正式记为PASS。
- 用户随后发现双击画布打开添加节点菜单时，浏览器会把刚出现的菜单文字误选成蓝色；现已阻止双击默认文字选择，并对整个添加节点菜单禁用文字选择，菜单点击功能保持不变。
- 用户已确认双击空白画布后添加节点菜单不再出现蓝色文字选中，该回归问题通过人工复验。
- `AGENT-003`候选已依据参考28和冻结坐标实现：Agent左侧叠加320×200文件抽屉，与Agent保留12px间隔，包含“文件”、收起按钮和“暂无输出”空态；Agent标题栏可重新展开。
- 文件抽屉当前只展示真实空态，不伪造Agent输出或文件；项目构建及Agent 4项自动检查通过，等待用户实页复验后再决定`AGENT-003`状态。
- `AGENT-003`首轮用户复验确认位置、空态和展开/收起均正常，但要求文件框与本项目UI规范一致使用圆角卡片；现已改为16px圆角并补充轻微边框，其余状态和交互不变，等待复验。
- 用户已确认圆角文件框、空态及展开/收起全部通过；`AGENT-003`正式记为PASS。
- `AGENT-004/005`需要真实Agent消息、工具调用、确认/拒绝及权限协议；`OPEN-021`仍未取得对应证据，项目也没有真实Agent执行能力。为避免伪造“执行成功”或猜测失败界面，两项暂记BLOCK。
- 下一可真实验收项切换到`SURF-001`：左侧添加节点按钮现可展开与双击空白一致的七项菜单，再次点击可关闭；双击仍按点击位置打开，3D世界保持禁用，且不会再出现蓝色文字误选。
- 项目构建通过；外壳与Agent共8项自动检查通过，等待用户实页复验后再决定`SURF-001`状态。
- 用户已确认左侧加号、空白双击、七项菜单、3D世界禁用及无蓝色误选/横向滚动条全部通过；`SURF-001`正式记为PASS。
- `SURF-002`节点搜索空态已依据冻结夹具、参考03及Unboundry v2.12.4活体再次核对：640×440居中面板、搜索输入、七个分类、空画布提示和背景遮罩均已接入。
- 节点搜索支持左侧按钮开合、分类切换、输入无匹配提示、Escape及点击遮罩关闭；当前不伪造任何节点结果，真正的标题/Prompt/正文搜索与定位留在下一项`SURF-003`。
- 项目构建通过，外壳5项自动检查全部通过；`SURF-002`等待用户实页复验，未提前记为PASS。
- 用户已确认节点搜索面板尺寸、分类、输入框、空态及关闭交互通过；`SURF-002`正式记为PASS。
- `SURF-003`节点搜索已接入画布当前真实节点索引，不使用写死的假结果：标题、图片/视频Prompt、文字正文及Storyboard文本均进入搜索范围，类型分类会同步过滤。
- 点击搜索结果会关闭面板、选中对应节点，并把画布平滑定位到该节点；新增确定性验收页同时提供Text、Image、Video三类真实节点数据，便于分别复验标题、Prompt和正文。
- 项目构建通过，外壳6项自动检查全部通过；`SURF-003`等待用户实页复验，未提前记为PASS。
- `SURF-003`首轮实页复验发现：结果点击后节点会选中，但在用户把画布拖到很远时，受控画布没有接收React Flow内部的视图定位，因此视觉上不会跳回节点。
- 搜索定位现改为按节点真实绝对坐标、当前画布可见尺寸和安全缩放值直接更新受控视图；自动检查新增“先把画布拖远，再搜索正文并确认节点回到画面正中心”，构建及外壳6项均通过，等待用户重新复验。
- 用户已确认把画布拖远后，搜索结果能够自动定位并选中对应节点；`SURF-003`正式记为PASS。
- `SURF-004`素材库个人空态已依据冻结夹具、参考04及Unboundry v2.12.8活体再次核对：320px宽面板、个人/团队、搜索、收藏、六个冻结文件夹及“该文件夹暂无素材”空态均已接入。
- Unboundry活体较旧参考新增的“主体库”已同步保留；AI角色属于下一项`SURF-005`，新建文件夹也没有真实存储契约，两者本项只展示真实禁用状态，不伪造创建或打开成功。
- 面板可从左侧素材库按钮开合、切换个人/团队、选择文件夹并筛选文件夹名称；项目构建通过，外壳7项自动检查全部通过，`SURF-004`等待用户实页复验。
- 用户已确认素材库面板、个人/团队、搜索、文件夹及空态交互通过；`SURF-004`正式记为PASS。
- `SURF-005`AI角色库已再次对照Unboundry v2.12.8活体实现：全屏深色覆盖层、六类侧栏、九组筛选、1135基线五列/当前窄视口四列、首批60张角色卡及加载更多均已接入。
- 角色卡使用项目内即时绘制的本地矢量人物和Unboundry活体角色名称/属性结构，不调用收费生图服务、不下载或依赖Unboundry角色图片；筛选和加载更多只操作本地目录，自动检查确认零Provider请求。
- 关闭按钮和Escape均可返回素材库，筛选复选、分类切换及从60张加载到80张均已覆盖；项目构建通过，外壳8项自动检查全部通过，`SURF-005`等待用户实页复验。
- 用户已确认AI角色库的覆盖层、分类、筛选、响应式卡片、加载更多和关闭交互通过；`SURF-005`正式记为PASS。
- `SURF-006`候选已依据冻结夹具、参考05及Unboundry v2.12.8活体重新实现：500×500工作流模板面板、首次使用提示、公共/我的模板、资产包搜索、三列卡片和1100×700“浏览全部”界面均已接入。
- 模板卡片与分类只提供本地浏览和筛选；“创建”保持禁用，不执行模板、不新增画布节点、不触发生成或Provider请求。项目构建及外壳9项自动检查全部通过，`SURF-006`等待用户实页复验，未提前记为PASS。
- 用户已确认首次模板提示、公共/我的模板、搜索、三列卡片及“浏览全部”界面通过；`SURF-006`正式记为PASS。评论功能已按用户范围决定取消，因此继续跳过`SURF-007`，进入`SURF-008`历史素材面板。
- `SURF-008`候选已再次对照Unboundry v2.12.8活体和参考06实现：420×420历史面板按日期展示，图片/视频/音频/3D四类Tab及2/1/4/0计数与冻结夹具一致。
- “浏览全部”现为1135×700基线的独立历史覆盖层，带左侧媒体分类、日期分组、80–175缩略图缩放、正反日期排序、关闭与Escape；数据仍来自既有账号级历史，不会触发生成。项目构建及外壳10项自动检查全部通过，`SURF-008`等待用户实页复验。
- 用户已确认历史素材四类Tab与计数、日期分组、浏览全部、缩放、排序及关闭交互通过；`SURF-008`正式记为PASS。额度/免费计划功能已取消，继续跳过`SURF-009`，进入`SURF-010`项目菜单。
- `SURF-010`候选已依据冻结夹具并再次对照Unboundry v2.12.8活体实现：点击左上角项目图标打开16×62位置、200×286尺寸的项目菜单，包含返回工作空间、TapTV、竞技场、重命名、新建项目和删除六项及探索/项目分组。
- 当前只有“重命名”接入真实标题输入；工作空间、TapTV、竞技场、新项目及删除缺少本地能力或涉及破坏性操作，均保持明确禁用，不伪造跳转或删除成功。外点、再次点击图标和Escape均可关闭；项目构建及外壳11项自动检查全部通过，`SURF-010`等待用户实页复验。
- 用户复验发现项目标题改名后刷新会恢复默认值。现已补上本机数据库持久化和浏览器即时草稿保护，覆盖中文输入结束后立即刷新、输入框未失焦直接刷新，以及旧保存请求晚到时不得覆盖新标题；项目菜单检查、外壳11项检查和全节点中文标题立即刷新回归均通过，`SURF-010`仍等待用户亲自确认。
- 用户确认项目标题重命名已正常，但指出刷新后项目菜单仍保持展开。现已改为所有页面首次进入或刷新后菜单默认收起，并新增“改名后刷新时名称保留、菜单收起”的回归检查；`SURF-010`继续等待用户复验。
- 用户确认项目菜单、重命名持久化及刷新后默认收起均通过；`SURF-010`正式记为PASS。订阅功能已取消，继续跳过`SURF-011`，进入`SURF-012`社区弹窗。
- `SURF-012`候选已在Unboundry v2.12.8活体重新测量：258×386弹窗右对齐社区按钮，包含224×40 Discord入口、224×240二维码卡、微信社群提示及参与奖励说明。Escape、外点、刷新后默认收起和焦点返回均已接入；Discord使用Unboundry当前公开入口，私有版没有微信群二维码资产，二维码区域明确为未配置，不伪造可扫码入口。项目构建及外壳12项自动检查全部通过，等待用户实页复验。
- 用户决定当前私有版完全取消社区功能和UI。右上角社区按钮、Discord入口、二维码弹窗及相关活动状态已从运行界面移除；Unboundry活体测量和冻结夹具仅作为历史证据保留，`SURF-012`改为N/A。下一项为`SURF-013`分享浮层。
- `SURF-013`候选已在Unboundry v2.12.8活体重新测量并实现：350×266浮层、24px圆角、三行入口、分隔线和右侧按钮位置与活体一致。私有版没有TapTV发布及团队项目能力，两项保持禁用；“通过链接分享”替换为真实复制当前本地地址，成功后明确显示“已复制”，不伪造外网分享。Escape、外点、再次点击和刷新后默认收起均已覆盖；项目构建及外壳12项自动检查通过，等待用户实页复验。
- 用户进一步裁定取消“在TapTV上发布”和“通过链接分享”，浮层现缩减为350×94，只保留“移动到团队项目”。团队项目计划以后再做，因此“移动”继续禁用；历史三项结构保留为Unboundry证据，不再作为当前私有版界面。`SURF-013`等待用户复验。
- 用户确认继续下一项，`SURF-013`按精简后的单项团队入口正式记为PASS。
- `SURF-014`候选已在Unboundry v2.12.8活体重新打开并测量：帮助菜单包含使用教程、反馈问题、快捷键，快捷键面板为640×566、距画布底15px、24px圆角、两列五分组。基础、缩放、移动画布、时间轴和其他全部当前文案及Mac键帽已复刻；教程和反馈缺少本地能力保持禁用。Escape、帮助按钮关闭、菜单外点和刷新后默认收起均已覆盖；项目构建及外壳13项自动检查通过，等待用户实页复验。
- 用户确认快捷键面板通过；`SURF-014`正式记为PASS。
- `SURF-015`候选已在Unboundry v2.12.8活体重新右键测量并实现：240×357菜单、230×347列表、16px圆角、4px padding、三条分隔线和七项顺序一致。上传、添加资产、添加节点和添加辅助工具均接入真实本地入口；空白初始状态下撤销、重做、粘贴保持禁用，不伪造操作。Escape、外点、刷新关闭及空间边界约束均已覆盖；项目构建及外壳14项自动检查通过，等待用户实页复验。
- 用户复验发现鼠标悬停其他菜单项时“上传”仍保持默认高亮，形成双重高亮。现已调整为任意时刻只突出当前悬停/聚焦项；鼠标未指向其他项时才显示首项默认选中，`SURF-015`继续等待用户确认。
- 用户确认双重高亮问题已修复，空白右键菜单全部通过；`SURF-015`正式记为PASS，进入`SURF-016`节点右键菜单与画布内部复制粘贴。
- `SURF-016`候选已在Unboundry v2.12.8活体重新右键测量并实现：240×463外框、230×453列表、16px圆角、九项和五条分隔线与当前Image节点一致。下载、内部复制、画布空白处粘贴、直接创建副本和删除均接入真实本地动作；保存到素材库、应用所有历史、节点菜单内粘贴、复制到系统剪贴板及反馈问题因缺少真实能力保持禁用。
- 复制只写画布内部缓存，不修改浏览器或系统剪贴板；空白处粘贴及“副本”都会创建同尺寸、同内容、向右下偏移40px并自动选中的新节点。快捷键`⌘C/⌘V`、Escape、外点、刷新关闭及删除后节点数量均已覆盖；项目构建、专项1项、外壳15项和基础交互9项自动检查通过，`SURF-016`等待用户实页复验。
- 用户确认节点右键菜单、内部复制粘贴、副本、删除和禁用逻辑通过；`SURF-016`正式记为PASS。
- `SURF-017`候选已统一补齐临时弹窗和悬浮面板的关闭规则：节点搜索、素材库、模板、历史、AI角色库、模板浏览全部和历史浏览全部均支持当前适用的Escape或外点关闭，关闭后焦点返回对应入口；全屏子界面关闭时优先返回其父面板按钮，不会把父面板一并误关。项目构建、专项1项和外壳16项自动检查通过，等待用户实页复验。
- 用户确认弹窗和面板的Escape、外点关闭及焦点返回通过；`SURF-017`正式记为PASS，`M7`当前可验收项完成。
- 回看M0冻结记录，空画布整体和点阵缩放早已分别获得用户实页确认，因此将矩阵中遗留的`UI-001/UI-002`状态同步修正为PASS，不重复要求用户验收。下一项进入尚未单独确认的`UI-010`：页面不得出现浏览器原生滚动，画布空白区域保持正确交互光标和画布语义。
- 用户确认页面无原生滚动、画布空白区域光标和窗口固定行为通过；`UI-010`正式记为PASS。下一项为`UI-011`复杂画布同屏：62个节点、58条连线、5个分组与固定Shell同时显示。
- 用户确认62节点、58连线、5分组的复杂画布与固定Shell同屏显示通过；`UI-011`正式记为PASS。下一项为`UI-012`的`1440×900@1x`响应式固定锚点验收。
- 用户确认`1440×900`宽屏下项目区、右上入口、左侧工具栏、底部控制和Agent锚点均正常；`UI-012`正式记为PASS。下一项为`UI-013`的`1920×1080@1x`大屏布局。
- `UI-013`首轮展示后用户虽表示视觉通过，但随即质疑页面没有明显尺寸变化。实测用户正在看的内置浏览器标签页仍为`952×883 CSS px @ DPR2`，并非`1920×1080`视口；此前1920×1080只应用在不可见的自动检查标签页。该轮不能作为真实大屏人工验收，`UI-013`继续保持USER_RECHECK，后续必须使用明确可见且带尺寸证据的验收方式。
- 用户要求`1920`和`1440`两种大屏布局全部重新验收，因此`UI-012`也从PASS重新打开为USER_RECHECK，之前的人工确认仅作为历史记录保留。
- 新增两张明确标注目标尺寸的可见验收页：内部画布分别保持精确的`1440×900 CSS px`和`1920×1080 CSS px`布局，外层只做等比缩小以适应当前内置浏览器窗口，页首会直接显示目标尺寸与当前缩放比例。自动检查同时确认两种内部视口、固定入口可见及既有`@1x`锚点误差均符合冻结契约；人工状态仍保持USER_RECHECK，必须按1440、1920顺序由用户重新确认。
- 用户已在带目标尺寸与缩放提示的可见验收页重新确认`1440×900`布局通过；`UI-012`恢复为PASS。继续展示`1920×1080`验收页，`UI-013`仍保持USER_RECHECK。
- 用户已在带目标尺寸与缩放提示的可见验收页重新确认`1920×1080`布局通过；`UI-013`正式记为PASS。`UI-012/UI-013`两种响应式大屏尺寸的重新验收均已完成。
- `OPEN-001`已在Unboundry `1280×720@2x`专用沙盒完成活体补测：顶层节点拖到左/右/上/下四边时，画布会沿对应方向自动移动且zoom不变；把一个顶层Image拖向另一顶层Image时不会覆盖，而是停在最后一个未碰撞位置。本轮没有把结论扩大到Group与内部子节点。
- 本地新增`interaction.edge-auto-scroll-and-collision`验收入口，显式启用四边自动移动并为顶层普通节点加入最后有效位置碰撞保护；Group背景及Group内部子节点不参与该保护，避免破坏已验收的分组布局。
- 项目构建通过；基础交互11项、Image 8项、Video 3项、Audio 2项、Group 3项、Playlist 4项及Viewport 2项均通过。Playlist回归首轮出现一次播放空格键时序波动，原样重跑4项全部通过；`OPEN-001`保持USER_RECHECK，等待用户实页验收，不提前记为PASS。
- 用户人工验收指出上一轮碰撞结论错误，并提供Unboundry左下角“网格吸附”按钮截图：普通状态本来就允许节点重叠；只有开启网格吸附后才应同时吸附网格并阻止重叠。上一轮“全局防重叠”结论撤回，不得据此记PASS。
- 本地碰撞保护现已改为只在左下角网格吸附开启时生效；关闭时可自由重叠，开启时继续使用20px网格和最后一个未碰撞位置。`OPEN-001`继续保持USER_RECHECK，等待修正版实页重新验收。
- 用户已确认修正版全部通过：普通状态允许重叠、开启网格吸附后吸附并防重叠、四边自动移动均符合预期；`OPEN-001`正式记为PASS。当前确定性验收页刷新后会故意恢复两个节点的起始位置，便于重复测试；这不代表带真实保存的正式画布，后者继续遵循已通过的`DATA-001`刷新持久化规则。
- `OPEN-002`复核确认不应重新要求用户验收已经PASS的节点尺寸项目：Text、Playlist、Image+Video Group、Text+Playlist Group及媒体比例均已有Unboundry活体、自动检查和用户实页确认。大型Text/Playlist/Group样本未观察到clamp，因此继续只记录“至少可达”的尺寸，不臆造全局最大值。
- Storyboard/Table当前创建菜单没有入口，“分镜大师”也只生成普通Group/Text/Image/Video；其历史1200×1000载入显示已通过，创建、编辑、resize和刷新生命周期继续由`OPEN-019`单独保持OPEN。`OPEN-002`据此关闭为RESOLVED-CURRENT，不重复展示已验收页面。
- `OPEN-003`复核确认当前Unboundry普通edge选中后没有显式端点updater，失败或取消的端点拖动保留原edge；本地普通edge也明确设置为不可重连。非法连接和独立删线此前已获用户实页确认，因此本项按“当前普通edge不支持成功重连”关闭为RESOLVED-CURRENT，不凭空增加Unboundry未观察到的重连功能；仅在以后发现其他可重连特殊edge时重新打开。
- `OPEN-004`已用两个现有Unboundry真实画布标签完成补测：源画布执行“复制”后在原标签按`⌘V`，节点数由4变5；切到另一个画布标签按相同快捷键，节点数保持5不变。源画布临时副本随后删除并恢复4节点。当前节点“复制”因此确认是单画布内部缓存，不通过系统剪贴板跨画布；本地继续保留此前已通过的内部复制，不发明Unboundry未观察到的跨画布节点格式，本项关闭为RESOLVED-CURRENT。
- `OPEN-006`本地候选已确认视频与音频下载都会产生真实文件：`Video.mp4`和`audio-result-1.mp3`的文件名正确，下载字节及SHA-256与项目内可播放源文件完全一致。新增媒体下载专项检查2项全部通过，项目构建通过；当前状态为USER_RECHECK，必须等用户通过可见内置浏览器下载管理器确认后才可记PASS。
- 用户首轮复验确认下载功能正常，但指出Audio顶部工具栏与其他节点UI不一致。Audio现改为复用Image/Video的48px深色圆角工具栏和40×40纯图标按钮，下载改为图标加悬浮提示而非宽文字按钮；构建及Audio/下载4项检查通过，等待用户重新复验后再决定`OPEN-006`状态。
- 用户已确认统一后的Audio顶部工具栏及视频/音频真实下载全部通过；`OPEN-006`正式记为PASS。
- `OPEN-007`按当前真实产品边界收口为BLOCK：项目没有获准接入真实Provider和持久任务队列，所有生成动作继续禁用，因此取消、失败、超时、重试和恢复没有可诚实验收的任务生命周期，禁止补造失败画面或假重试；用户已取消全项目额度功能，退款/退额度同时不再适用。以后只有真实生成与任务队列获准接入时才重新打开。
- `OPEN-008`不重复验收：同账号双标签写冲突已经由`DATA-005`完整覆盖并获用户实页确认，旧revision写入返回409、服务端保留最新内容、重新载入恢复当前版本，故关闭为RESOLVED-CURRENT。下一项进入`OPEN-009`多人实时协作的当前私有版范围裁决。
- `OPEN-009`随当前个人小范围自用及“团队项目以后再做”的用户范围决定暂停；本项必须等团队项目和两个真实授权账号可用后再补测，不在当前私有首版伪造多人协作。
- `OPEN-016`由已经逐项人工通过的`IMGEDIT-001～006、008、009`覆盖；打光按用户决定保留实现、禁用入口并由`IMGEDIT-007`单独保持PAUSED，因此关闭为RESOLVED-CURRENT，不重复推翻图片高级编辑验收。
- `OPEN-017`与已经人工通过的Video顶部工具栏重复；Unboundry活体十项顺序、`442×48`尺寸和tooltip证据已经冻结，本地未接入动作继续禁用，因此关闭为RESOLVED-CURRENT。
- `OPEN-019`当前仍找不到Storyboard/Table的真实创建入口；空白创建菜单没有该项，“分镜大师”只实例化普通Group/Text/Image/Video。历史1200×1000节点的载入显示已通过，因此本项改为BLOCK并保留历史只读能力，不凭空补创建、编辑、resize或刷新契约。
- `OPEN-020`按当前真实能力拆分：整组执行依赖尚不存在的生成队列，更新模板依赖尚不存在的模板后端，两项继续保持禁用；“下载全部”已对模板Group内6个本地SVG素材逐一触发真实下载，6个独立文件均成功完成。Group专项4项自动检查通过，等待用户实页复验下载全部，不提前记PASS。
- 用户已确认Group当前动作边界和“下载全部”通过；`OPEN-020`正式记为PASS。整组执行、更新模板仍保持禁用，不因本次下载验收扩大为已实现。
- `OPEN-021`依赖真实Agent后端、工具调用和权限协议，当前未获准接入；确认、拒绝、失败和恢复都没有可诚实验收的真实命令，继续保持输入/执行禁用并改为BLOCK，不制作假消息或假工具结果。
- 用户明确授权测试麦克风后，`OPEN-022`新增`panel.agent.voice`候选：只有点击语音按钮才申请权限；允许后使用浏览器本机录音，可见计时、停止、预览、清除及取消；拒绝权限显示明确提示和重试。录音只存在当前页面，不上传，不产生Provider请求。
- 当前没有获准的转写服务，因此停止后明确显示“转写暂未接入”，不把假文字写入输入框。麦克风允许/拒绝双路径及Agent回归共6项自动检查通过，项目构建通过；`OPEN-022`保持USER_RECHECK，等待用户在可见内置浏览器亲自允许并录一小段。
- 用户实测确认录音功能正常，但指出录音浮层像独立大号插件、没有对齐当前项目UI规范。现已缩为项目统一的紧凑深色14px圆角浮层，取消使用轻量文字态，停止改为灰色按钮加小红色停止标记，红色只承担录音状态提示；构建和麦克风/Agent 6项检查通过，继续等待用户复验UI后再记PASS。
- 用户已确认修正版录音浮层和录音功能通过；`OPEN-022`正式记为PASS。当前通过范围仍是本机录音、停止、预览、清除、取消和权限反馈，未获准的转写服务继续不接入。
- `OPEN-023`已获用户实页确认通过：素材库Others文件夹提供图片、视频、音频三个本地素材，拖到画布任意位置会建立对应节点，源素材继续保留，刷新后三个节点仍恢复，且没有Provider请求。用户复查发现的音频空波形已修复为真实MP3解码与64段波形显示；Audio基础及素材拖放共3项自动检查、项目构建和最终人工复验均通过。
- 模板搜索/预览、Unboundry“分镜大师”26节点31边实例证据及账号历史恢复已由既有项目覆盖；模板创建/更新和失败回滚没有模板后端，继续保持禁用，不在`OPEN-023`候选中伪造。
- `OPEN-024`已获用户分两步实页确认通过：新增可见`1512×982`和`1280×720`真实布局预览，页头会显示内层画布实际DPR。根据冻结清单中28张`1280×720@2x` Unboundry真实参考图，将`1280px`定为当前最小可靠支持宽度；两个DPR2尺寸的固定锚点、页面无溢出、截图及预览共2项自动检查、项目构建和最终人工复验均通过。
- 2026-07-31用户确认在画布工作流具备真实生成能力前暂不部署服务器；ICP备案和域名先保留，不进入OPS/上线阶段。
- 用户授权先建设“真实生成前基础层”，但没有授权接入或调用任何收费Provider。现已新增SQLite持久任务表、图片/视频/音频任务类型、受限状态转换、请求指纹和画布级幂等键；相同请求重复提交只返回同一任务，不同请求复用同一键会被拒绝。
- 运行中任务在数据库或服务重新打开后只转为`recovering`，不会自动重复执行或伪报成功。生成任务状态接口明确报告`providerConfigured=false`、`submissionEnabled=false`和零付费请求；提交接口继续返回`GENERATION_DISABLED`。
- 任务存储幂等/冲突/恢复2项专项检查和真实服务进程重启恢复检查通过。`GEN-007`与`OPEN-007`仍保持BLOCK，`DATA-004`保持PARTIAL，必须等用户选择并授权真实Provider、任务执行器和真实结果发布后才能继续。
- 用户要求先完善生成链路结构，并明确希望前端、后端和数据库都做好，同时继续对齐Unboundry。当前裁决是：对齐Unboundry可观察的创作、生成中、成功、历史和刷新行为；Unboundry内部数据库表、队列、Provider路由、失败分类和重试策略不可见，不得假装已知或反写为Unboundry事实。
- 新增`spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md`作为Provider无关结构边界；新增服务端Provider提交/查询/取消/结果解析接口、前端只读任务客户端和SQLite追加式状态事件。具体Provider、任务执行器、结果原子发布及前端提交仍未启用，所有生成按钮和`POST /api/generation-tasks`继续保持禁用，付费请求为零。
- 用户批准管理员统一管理模型和自有OSS的产品方向：普通用户只在各节点选择管理员已发布的模型，不看Provider、密钥、接口地址或OSS设置；用户侧继续取消额度UI，但服务器必须保留并发、频率、费用和紧急停止保护。
- `AUTH-001`据此从PAUSED恢复为NOT_STARTED，范围只包括登录、管理员/普通用户两级角色、账号启停、数据归属和服务端逐请求鉴权。团队项目、邀请、成员协作和多人实时仍由`AUTH-002/OPEN-009`保持PAUSED，不随本次决定扩大。
- 新增`spec/UNBOUNDRY_ADMIN_MODEL_OSS_PLAN.md`，实施顺序冻结为：数据保护与迁移→账号权限→管理员模型中心→私有OSS→后台保护→一个真实Image Provider→Video/Audio与部署。规划获批不等于收费授权，A～E完成前Provider请求继续为零。
- 阶段A数据保护底座已完成：新增三版SQLite迁移记录，现有21个画布、10条历史、3条项目标题及零生成任务/事件在补登记迁移后数量不变；迁移可重复打开且不会重复执行。
- 首份真实备份位于`backups/2026-07-31T02-49-51-809Z`，包含独立SQLite快照和264个媒体文件（87,983,991字节），数据库与每个媒体文件均有SHA-256清单。备份已恢复到临时新目录并真实启动应用，画布、媒体和任务状态接口均可读取。
- `OPS-002`据此从NOT_STARTED改为PARTIAL；完整登录与播放恢复必须等`AUTH-001`实现后继续验证。首个管理员和数据归属尚未创建，进入阶段B前还会再次备份，当前没有改写现有画布、历史或媒体内容。
- 阶段A最终自动检查通过：迁移/校验备份2项、全量画布回归94项、真实进程重启恢复及生产fixture隔离均通过；Provider提交仍为禁用且付费请求为零。下一阶段是B账号与两级权限，不提前进入模型、OSS或真实生成。
- 全量回归在本地媒体目录新增9个测试媒体文件但没有改变画布、历史或任务数量；未删除首份备份，并追加最终状态备份`backups/2026-07-31T02-54-24-526Z`。最终备份包含273个媒体文件（89,682,302字节），再次通过逐文件校验、新目录恢复及恢复目录真实启动检查。
- 阶段B变更前新增备份`backups/2026-07-31T02-58-46-364Z`，包含21个画布、10条历史、3条标题和273个媒体文件；数据库、逐文件校验、新目录恢复及恢复目录启动均通过。
- 阶段B账号候选已完成：首管理员只能在服务器本机且仅在零账号时创建；不会自动创建管理员或默认密码。公开注册关闭，普通账号只能由管理员创建；管理员可启用/停用账号，停用会立即删除该账号全部服务器会话。
- 新增管理员/普通用户两级角色、HttpOnly服务器会话、安全密码摘要和管理审计；前端隐藏不作为权限依据，画布、标题、历史、图片、视频、音频和任务接口均逐请求鉴权。
- 画布和标题改为账号联合归属，普通用户可拥有与管理员同ID的画布且互不覆盖；历史按当前登录账号读取，媒体增加归属登记，其他账号直接请求素材地址也不可读取。
- 首管理员创建时才会把当前所有无归属画布、标题、历史、任务和273个现有媒体登记一次性归给该管理员；当前用户表仍为空，既有数据尚未被自动改归属。
- 自动检查改用独立临时数据目录和显式测试身份，后续全量回归不再向真实`data/media`写测试文件。
- 账号初始化、普通账号创建、同ID画布隔离、媒体隔离和停用会话专项`1/1`通过；全量自动回归`95/95`、真实进程重启恢复和生产fixture隔离均通过。阶段B候选备份`backups/2026-07-31T03-14-05-911Z`再次通过完整恢复检查。
- `AUTH-001`只更新为USER_RECHECK，必须等用户在内置浏览器亲自创建首管理员、确认旧画布/素材、创建并停用普通账号后才可PASS。`AUTH-002`团队邀请继续PAUSED；模型中心、OSS、真实生成和部署均未开始，Provider请求仍为零。
- 用户已在内置浏览器亲自创建首位管理员；数据库核对确认21个画布、10条历史、3条标题和273个媒体登记全部归给该管理员，数量无丢失。
- 管理员已创建一个普通测试账号；用户亲自登录普通账号后，实页确认用户菜单没有账号管理入口，直接访问`/admin/accounts`会被拦回画布，图片/视频/音频/3D历史全部为0，没有读取管理员数据。
- 管理员停用普通账号后，服务端立即清除该账号已有会话；用户亲自用该普通账号重新登录并确认被拒绝。`AUTH-001`完成自动与人工验收，正式记为PASS。
- 2026-08-06 新增管理员删除账号功能：`DELETE /api/admin/users/:id` 会级联清理该账号的会话、项目、画布、生成任务、历史与素材登记，并尽力删除其本地/OSS素材文件；禁止删除当前登录管理员和最后一个管理员。账号管理页每个账号新增「删除」按钮与确认弹窗，登录名改为显式「登录名：」标注。专项测试 `m11` 2/2 通过，待用户实页验收后记 PASS。
- 2026-08-06 普通账号默认画布修复批：多账号隔离守卫误伤 `default`（首管理员拥有 is_project=1 的 default 项目行时，其他账号连自己的 default 画布都无法创建）已在 `hasOtherOwnerProject` 内豁免 default，画布与项目名四个调用点一次修复；本地标题草稿、生成提交草稿键与标签页同步频道全部改为按账号隔离（v2 命名空间）；普通账号工作空间入口补齐（头像菜单常驻、项目菜单常驻、工作空间页新增「返回画布」）；409 冲突提示改为显示服务端真实原因并同时提供「返回工作空间」与「重新载入」。专项 m11 3/3、m66 11/11、m3/m40/m21 11/11 通过，生产构建通过；m2 网络捕获型失败在基线 e9049f5 同样复现，属既有环境抖动而非本次回归。
- 2026-08-06 账号停用/删除接口的 ID 校验从“仅 UUID”放宽为兼容 `__test__`、`cua-tester` 等历史非 UUID 账号 ID（`^[a-z0-9._-]{1,80}$`），PATCH/DELETE 均适用；m11 非 UUID 账号停用/删除专项通过（4/4）。
- 2026-08-06 真实付费生成全链路验收（CUA + 真实浏览器，预算 20 元内）：文字 Gemini 3.5 Flash Lite（优创）3/3 通过（纯文字、文字+图片、文字+视频+音频）；图片 GPT Image 2（OpenRouter）4/4 通过（纯文生图、图生图参考、双图参考、文字→图片链路）；视频 Seedance 2.0 Mini（火山方舟）6/6 通过（文生视频、图生视频、视频续编、图+视频、图+视频+音频全能参考、图+音频）。任务入参逐条核对（roles：context-image/context-video/context-audio、reference-image/reference-video/reference-audio、instruction），全部与连接边一致；视频真实成本约 ¥7.9、图片约 ¥0.4，合计远低于预算。期间发现并当场修复「项目画布生成门禁」；另发现两个待修问题：历史加入的图片节点无 imagePromptReady 导致创作区不可用；生成成功后节点 Generate 持续禁用无法复用同一节点再生成。
- 2026-08-06 修复两个真实生成相关 bug：①历史/素材加入的图片、视频、音频节点补齐 `*PromptReady`（`addDroppedLibraryAsset` 与图片上传路径），创作区可直接打开；②图片/视频节点生成成功后在“当前输入未变”时才禁用 Generate（提示“当前节点已生成”），修改提示词/参数/参考后自动恢复可用，且成功时保留 `*GenerationInputKey` 供跨刷新判断；防重复付费与可再生成两不误。已在真实浏览器复验：历史加入图片节点创作区可用；同节点生成成功后未改输入为禁用，改提示词后恢复可用。m3/m40/m66 回归 21/21 通过，生产构建通过；m2 失败仍为既有网络捕获抖动（基线同样复现）。
- 阶段B最终状态备份为`backups/2026-07-31T03-26-40-934Z`，包含当前账号及完整归属数据、273个媒体文件，已通过数据库/逐文件校验、新目录恢复和恢复目录启动检查。
- 阶段A、B完成；下一阶段是C管理员模型中心，但尚未开始。`AUTH-002`团队邀请仍保持PAUSED，OSS、真实生成和部署也未开始，Provider请求继续为零。
- 阶段C管理员模型中心已完成候选：管理员可创建草稿、发布/停用模型和设置节点默认模型；普通用户只读取已发布的安全目录，Text/Image/Video及新建Audio节点均从服务端目录选择并保存模型。Provider仍显示未连接，所有生成按钮保持禁用，付费请求为零。
- 阶段C新增Provider、模型目录和节点绑定持久结构，不保存密钥，也不向普通用户返回Provider或内部模型编号。`API-003`仍不提前通过，因为Agent技能和建议尚未服务端化；本次单列`MODEL-001`为USER_RECHECK。
- 模型权限与节点联动专项`2/2`、全量自动回归`97/97`、真实进程重启恢复和生产fixture隔离均通过。占位模型清理前备份`backups/2026-07-31T03-41-49-017Z`保留为可恢复记录。
- 阶段C必须等用户在内置浏览器亲自验收后才能记PASS；阶段D OSS、后台费用保护、真实Provider和部署均未开始，`AUTH-002`继续PAUSED。
- 用户确认右侧四个模型并非自己配置；现已通过schema 6只清除四条明确的未配置占位模型及其绑定，停止向真实数据库自动写入示例模型。真实目录当前为0模型/0绑定，示例模型只在隔离自动测试中临时创建；未发布真实模型时，普通用户节点显示“暂无可用模型”且生成继续禁用。
- 管理员节点类型下拉已从浏览器原生蓝色选中样式改为项目统一的灰色菜单、灰色悬停和白色勾选。项目构建及模型/迁移/权限/密钥安全相关6项检查通过。
- 清理后的阶段C当前候选备份`backups/2026-07-31T03-55-21-141Z`包含schema 6、320行数据库记录和273个媒体文件，已通过数据库/逐文件校验、新目录恢复及恢复目录启动检查。
- 用户已确认阶段C空模型目录、灰色节点类型下拉菜单和管理员模型中心整体通过；`MODEL-001`正式记为PASS。下一阶段进入D自有私有OSS安全结构，但尚未授权或填写真实OSS密钥，不上传真实云对象、不产生云费用。
- 阶段D安全底座候选已完成：新增管理员专属存储中心，当前明确固定使用本机私有存储和关闭云请求；普通用户无入口且直接请求管理接口返回403。管理接口只返回OSS五项配置状态的布尔值，不回传Endpoint、Bucket、AccessKey或Secret。
- schema 7为媒体补充存储后端、对象键、内容类型、SHA-256和发布状态；273个既有本机素材已全部补齐校验值，新上传图片/视频/音频会同步登记内容类型与校验值，既有归属隔离、Range和下载逻辑不变。
- 存储/权限/上传专项`16/16`、全量自动回归`99/99`、真实进程重启恢复和生产fixture隔离均通过。阶段D安全底座候选备份`backups/2026-07-31T04-08-06-273Z`包含schema 7、321行数据库记录、273个媒体文件及273条媒体校验值，已通过完整恢复检查。
- `STORAGE-001`只更新为USER_RECHECK，等待用户亲自在内置浏览器验收“存储中心”。真实OSS SDK、私有Bucket、匿名访问、短时签名地址、云端原子上传及旧媒体迁移均未开始，阶段D真实OSS接入不提前标记PASS，也不产生云费用。
- 用户已确认管理员存储中心和本机存储安全底座通过；`STORAGE-001`正式记为PASS。阶段D剩余真实OSS SDK、私有Bucket、短时签名、云端原子上传和迁移仍需独立实施与验收，不随底座通过而提前完成。
- 用户确认真实对象存储使用阿里云OSS。现已固定安装阿里云官方`ali-oss@6.23.0`服务端SDK，并增加随机无隐私对象键、私有ACL、防覆盖、SHA-256元数据、上传失败清理及V4短时读取签名适配器；SDK只存在服务端。
- 用户确认私有Bucket和RAM身份已经创建，并决定不再使用手动`.env`流程。管理员现在可以在“存储中心”网页新增或替换OSS配置；AK/SK使用密码输入，保存后不回显，服务端以AES-256-GCM写入`data/secrets`专用加密配置。
- 管理接口只返回Endpoint、Region、Bucket、AK末四位掩码和是否保存SK；完整密钥不进入浏览器、SQLite或审计。普通账号直接读写存储配置仍返回403，非本机管理写操作要求HTTPS。
- “加密保存”不会连接阿里云；只有用户明确点击“测试连接”才上传、短时读取并删除一个临时文件。测试通过后才可“选为正式配置”，而云端素材路由仍保持关闭，273个现有素材不迁移。
- 项目构建、加密配置/权限/备份兼容/Provider密钥安全专项`7/7`、全量自动回归`100/100`、重启恢复及正式构建隔离检查通过。自动检查使用虚构密钥且未点击连接测试，没有发起OSS请求。`STORAGE-003`更新为USER_RECHECK，必须等用户实页确认后才能PASS；`STORAGE-002`继续BLOCK，等待真实连接和云端Range/下载验收。
- 用户保存首个OSS配置后发现页面无法向下查看“已保存配置”；原因是画布所需的全局滚动锁定同时覆盖了管理员页面。现只为`.admin-page`增加独立纵向滚动，不修改全局锁定或画布结构；存储页滚动及画布坐标、拖拽、边缘平移、吸附、缩放等针对性`28/28`检查通过，等待用户实页复验。
- 用户已确认网页加密配置保存和管理员页面独立滚动正常；`STORAGE-003`正式记为PASS。下一项进入`STORAGE-002`真实OSS连接测试：仅上传、短时读取并删除一个临时小文件，不迁移273个现有素材，也不启用云端素材路由。
- 用户首次手动授权真实OSS连接测试后返回失败；旧页面把通用英文错误放在顶部，用户停留在配置卡片时看不到反馈。配置仍为“待测试”，“选为正式配置”保持禁用，现有素材和云端路由未改变。
- 连接测试反馈现直接显示在对应配置卡片，并只返回中文安全原因分类：AK无效、签名/区域不匹配、权限不足、Bucket不存在、网络、服务器时间、短时读取或临时清理失败；不返回完整Provider错误、密钥、签名或本机路径。失败后若临时对象清理失败会明确报告。
- 项目全量自动回归`100/100`、重启恢复、正式构建隔离和最终存储/密钥专项`4/4`通过；自动检查没有重试真实OSS。`STORAGE-002`继续BLOCK，等待用户再次手动点击“测试连接”并根据卡片内原因处理。
- 用户第二次手动测试得到明确安全原因：“RAM账号没有完成测试所需的上传、读取或删除权限”。下一步为该RAM身份添加仅限当前Bucket `objects/*`前缀的`oss:PutObject`、`oss:GetObject`、`oss:DeleteObject`自定义策略；不得直接授予`AliyunOSSFullAccess`。
- 用户已改用上海私有Bucket和独立RAM服务身份，真实连接、短时读取及临时清理成功；Bucket启用阻止公共访问、TLS 1.2/1.3和AES256服务端加密，生命周期仅清理1天未完成分片，不自动删除正式素材。
- 新图片OSS路由候选已完成：管理员开关默认关闭，开启后只处理新上传图片，273个旧本机文件不迁移，Video/Audio仍走本机；关闭后已有云图片仍可读和删除。新图片完成私有上传与大小校验后才发布数据库，数据库发布失败会回滚删除云对象。
- 第一张真实验收图片已保存为随机无隐私对象键，数据库状态为OSS/ready，本机媒体文件仍为273个；真实根画布已补齐持久保存，刷新后新图片节点和素材仍正常显示。真实Range返回206，完整下载大小与SHA-256一致。项目构建、全量自动回归103项、重启恢复、生产fixture隔离和真实OSS专项1项通过。2026-07-31用户已在内置浏览器确认开关、新图、刷新及下载通过，`STORAGE-002`正式记为PASS；视频和音频云路由不在本次通过范围内。
- 用户随后明确允许清理3张未被任何画布引用的早期OSS验收临时图片；已按精确ID先删除云端对象再删除媒体登记，共释放1,926,291字节。正式验收图片继续保留，273个旧本机素材数量不变。
- 阶段E“后台费用与安全保护”候选已完成：新增管理员专属“生成安全”页面和schema 8持久设置；普通用户没有入口或接口权限，用户侧不恢复额度、积分或费用UI。
- 真实生成总开关默认关闭，紧急停止优先级最高；服务端提交前保护覆盖每用户并发、每分钟频率、图片/视频/音频并发、连续失败冷却、每日/月度后台费用停止线。费用上限为0或单次成本未知时固定拒绝，避免产生不可控费用。
- 管理员可选择紧急停止后等待已运行任务完成或安全取消，所有配置修改均写入管理审计。当前Provider仍未连接，生成提交仍返回禁用，付费请求保持为0。
- 阶段E变更前备份为`backups/2026-07-31T07-00-21-295Z`（schema 7、329行、273个媒体文件）；候选备份为`backups/2026-07-31T07-11-14-556Z`（schema 8、330行、273个媒体文件）。
- 项目构建、生成安全/权限/任务/密钥专项`7/7`、全量自动回归`106项通过、1项受控真实OSS检查跳过`、重启恢复和正式构建隔离检查通过。`SAFETY-001`更新为USER_RECHECK，必须等用户在内置浏览器亲自确认后才能PASS；真实Provider尚未开始。
- 2026-07-31用户已在内置浏览器确认“生成安全”页面和默认保护状态通过；`SAFETY-001`正式记为PASS。下一阶段为F“一个真实Image Provider”，必须先由用户明确选择图片生成平台；在此之前不保存Provider密钥、不启用提交、不调用收费接口。
- 用户随后决定先建设可扩展但简单的管理员平台结构，避免未来每增加一个模型都暴露不同厂商的复杂接口。管理员操作冻结为三步：“平台连接→添加模型→发布给节点”；普通用户仍只看管理员已发布的模型。
- `PROVIDER-001`候选已完成：新增管理员专属“平台连接”页，第一版提供OpenRouter、火山方舟和OpenAI兼容中转站三类连接；特殊非标准接口明确保留为以后单独适配，不要求管理员填写原始JSON或复杂路由规则。
- Provider API Key只在密码输入框中出现一次，服务端使用AES-256-GCM写入`data/secrets/provider-profiles.enc.json`；浏览器只收到末四位掩码，SQLite仅保存非敏感元数据，管理审计不记录密钥或接口地址。管理员可以修改名称、地址或更换密钥；修改时不填写密钥会安全保留原密钥。
- “加密保存”和“修改”均只写入本机服务器，不连接外部平台、不同步模型、不执行生成、不产生费用。普通用户直接访问管理接口返回403，真实生成总开关和所有节点生成按钮继续保持禁用。
- 项目构建、Provider/模型/密钥专项`5/5`及全量回归`108项通过、1项受控真实OSS检查跳过`，真实进程重启恢复和正式构建隔离通过；`PROVIDER-001`保持USER_RECHECK，必须等用户在内置浏览器亲自确认页面简洁性后才能PASS。
- 2026-07-31用户已在内置浏览器确认平台连接页通过；`PROVIDER-001`正式记为PASS。
- `PROVIDER-002`候选已完成：OpenRouter和OpenAI兼容中转站在管理员主动点击后只用GET读取模型列表，成功只记录连接已验证、模型数量和耗时；不会提交提示词、素材或生成任务。火山方舟未确认适合本轮的公开只读模型列表，因此页面明确改为“添加模型时验证”，不伪造连接成功。
- 连接失败只返回安全中文分类，不回传远端正文、密钥、签名或本机路径；保存连接不会自动触发测试，真实生成开关和节点生成按钮继续禁用。
- 项目构建、Provider/模型/密钥/生成安全专项`9/9`、全量自动回归`109项通过、1项受控真实OSS检查跳过`、真实进程重启恢复和正式构建隔离检查通过；`PROVIDER-002`保持USER_RECHECK，等待用户实页确认说明与交互边界。
- 用户发现真实画布节点底部的模型选择仍使用浏览器原生下拉，展开后出现蓝色选中背景，与项目灰度UI不一致。现已替换为项目自绘灰色菜单：深灰菜单、灰色悬停、灰色选中和白色勾选，同时保留模型绑定、键盘ESC关闭、点击外部关闭及禁用生成边界；不改节点坐标和已通过的画布结构。
- 项目构建、模型目录与图片/视频/文字/音频节点相关`17/17`检查通过；另增真实灰色选中颜色和模型切换检查`2/2`通过。最新无缓存画布已在内置浏览器展开菜单，等待用户复验外观。
- 用户授权修复全量UI巡检确认的三处灰度不一致：账号管理新增用户表单已禁止复用当前登录凭据并为新密码使用专用自动填充语义；登录及管理员表单即使被浏览器自动填充，也继续显示项目统一的深灰背景和浅色文字。
- 管理员模型中心“创建后立即发布”已替换为自绘灰色复选框；画布通用按钮的键盘聚焦圈已由亮蓝改为可见浅灰。未修改画布坐标、交互或已通过功能；项目构建及账号/模型/画布/灰度UI相关`21/21`检查通过，当前保持人工复验候选，不提前记为PASS。
- 2026-07-31用户已在内置浏览器确认上述全量UI巡检修复通过：账号表单、管理员模型发布复选框和画布键盘聚焦状态均纳入当前已接受灰度UI基线，后续不得擅自恢复浏览器蓝色原生样式。
- 2026-07-31用户确认平台只读连接和节点模型设置均已完成并通过；`PROVIDER-002`正式记为PASS。真实图片生成执行器仍未接入，生成按钮、真实生成总开关和付费Provider提交继续保持禁用，后续第一次真实生成必须另行获得用户明确授权。
- 2026-07-31用户在最新版真实画布发现项目菜单仍显示已经取消或尚未实现的占位入口，并发现管理员账号浮层无法通过Escape或点击空白处关闭。该问题不是旧缓存：TapTV、竞技场和返回工作空间此前仍被硬编码为禁用项，账号浮层也缺少统一关闭规则且覆盖了账号按钮。
- 当前私有版项目菜单已精简为重命名、新建项目和删除三项，其中未实现的新建与删除继续禁用；TapTV、竞技场和返回工作空间不再显示。账号浮层改到左侧工具栏右侧且不再遮住账号按钮，支持再次点击账号、Escape和点击画布空白处关闭，Escape后焦点返回账号按钮。项目构建及外壳`18/18`项自动检查通过；`SURF-010`按用户新裁决重新进入USER_RECHECK，等待实页确认后再恢复PASS。
- 2026-07-31用户已在最新版真实画布确认精简项目菜单与账号浮层关闭修复通过；`SURF-010`恢复为PASS。后续不得恢复TapTV、竞技场、社区或无真实工作空间能力的占位入口。
- 2026-07-31用户发现真实图片节点的“自适应 · 1K”仍是单一占位按钮，无法像Unboundry一样选择画质和比例。当前候选只改真实根画布：参数弹层按灰度UI提供画质与比例两区，并把选择值真实写入节点和生成请求；既有`NODE-006`冻结验收夹具继续保持不变。OpenRouter当前对`openai/gpt-image-2`公开支持`auto/low/medium/high`画质及`auto、1:1、4:3、3:4、16:9、9:16、3:2、2:3、21:9`比例，但不公开1K/2K分辨率参数，因此不伪造1K/2K选项。管理员费用停止线的币种文字同步由“元”修正为“美元”；单次入口仍在模型中心，每日/月度入口仍在生成安全。`MODEL-002`保持USER_RECHECK，等待用户实页确认。
- 2026-07-31用户进一步确定图片参数采用折中规则：画质与比例使用一套固定布局，当前模型不支持的选项继续显示但灰显且不可点击；风格、摄影机控制、组图等特殊参数只在模型能力明确支持时出现。当前候选据此把自动/低/中/高及1K/2K/3K/4K画质、Unboundry已观察到的11种比例统一放入参数面板，是否可用仍严格由服务端模型能力清单决定；切换模型时只落入该模型真实支持的默认值，不会把灰色参数写入节点或Provider请求。`MODEL-002`继续保持USER_RECHECK，等待实页确认。
- 2026-07-31用户已在内置浏览器确认统一图片参数面板通过：画质与比例固定展示，GPT Image 2不支持的1K/2K/3K/4K及5:4、4:5保持灰显不可交互；生成按钮仍禁用且零收费请求。`MODEL-002`正式记为PASS。
- 2026-07-31用户确认首次真实图片生成成功。数据库核对到任务`438b50dd-cd9c-42ed-8321-1fcbd49adf35`使用`openai/gpt-image-2`依次完成`queued→running→success`，实际费用为`0.005960美元`；结果PNG为`1,269,206`字节，已写入私有OSS并处于`ready`，SHA-256为`9690d085e95e520751d96924499ea81cece6812bd3417fbbc2dc1ac29b9ea853`，结果素材引用也已保存到`default`画布。该证据只确认真实图片成功链路，`GEN-007`更新为PARTIAL；失败、取消、超时、重试和恢复仍在`GEN-006/OPEN-007`保持BLOCK，不追加第二次收费生成。下一步先做刷新、下载和真实结果恢复的零费用复验。
- 2026-07-31用户确认真实生成结果刷新保留和下载通过；该零费用复验已补入`GEN-007`证据。当前只剩对这条真实结果执行一次服务重启后的恢复、不重复任务和不重复历史检查，完成前`GEN-007/DATA-004`继续保持PARTIAL，不把尚未验证的可靠性范围提前记为PASS。
- 2026-07-31继续补齐前置图片真实入参：Unboundry活体页面确认连线是参考关系的事实来源，目标图片生成区显示同一素材的缩略片；移除缩略片会同步删除连线，撤销会同时恢复二者。本地新增`GEN-009`与`node.image.reference-ready`候选，当前只覆盖图片到图片生成，不扩大到视频、音频或文字。
- 本地提交仅保存`assetId/sourceNodeId`，服务端在创建任务前校验素材归属当前账号、类型为图片且状态ready；真正执行前才把私有OSS对象换成5分钟签名地址，或把经过大小、SHA-256和PNG结构校验的本机素材换成数据地址。OpenRouter请求按官方`input_references`结构发送，当前`openai/gpt-image-2`最多16张；不支持参考图的模型会在客户端和服务端同时拒绝。
- 本轮没有点击生成或发送任何付费请求。项目构建通过；图片节点9项以及Provider序列化、非法参考图零请求、任务幂等、上传安全和模型目录共13项自动检查通过。`GEN-009`保持USER_RECHECK，必须等用户在最新本地页面亲自确认缩略片、删除连线和撤销恢复后才能PASS。
- 2026-08-01用户已在最新本地验收页确认图片连线参考图通过；`GEN-009`正式记为PASS。该通过只确认连线、缩略片、删除/撤销同步、模型能力上限和安全传参，不代表再次执行了收费生成，也不提前关闭`GEN-006/GEN-007/DATA-004`。
- 2026-08-01已对真实任务`438b50dd-cd9c-42ed-8321-1fcbd49adf35`完成零费用服务重启恢复验收：重启前后任务均为3条，原任务保持`success/attempt 1`且事件仍为3条；历史均为13条且该结果只占1条；媒体均为280条且结果素材`4c41d5cc-37c9-48df-a569-fb721906048d`只占1条；`default`画布保持9节点/4连线并保留该素材引用。私有OSS图片在重启、刷新、全屏和下载后均可读取，服务进程只出现本机回环连接，OpenRouter图片生成请求为0，没有新建或重新提交真实任务。期间发现历史卡未渲染真实图片及图片节点“全屏查看”按钮无动作，已分别补齐真实缩略图/创建日期和全屏详情；图片历史、下载与全屏均由用户确认通过。`GEN-007`与`DATA-004`正式记为PASS；`GEN-006/OPEN-007`的真实失败、取消、超时和重试证据仍为BLOCK，且本轮没有部署服务器。
- 2026-08-01批量同步第1/10项：真实取消任务`6a9fbe16-d234-4a0e-badf-d19f2b54ffae`按`queued→running→cancelled`结束，`attempt 1/USER_CANCELLED`，没有发布结果素材；用户确认取消态通过。
- 第2/10项：真实任务`327c2051-c2d4-4c96-9c41-f30525cd9556`首次执行按`queued→running→failed`得到`TIMEOUT`，错误经过安全清洗并保留同一任务；用户确认超时态通过。
- 第3/10项：用户直接点击同一任务的“重试”，事件按`retrying→queued→running→success`追加，最终`attempt 2`，没有创建第二条任务；结果素材`f6649f18-a944-4b39-82b3-1970fd1a89d0`进入私有OSS并处于ready，用户确认重试成功通过。
- 第4/10项：真实任务`6a1ecfa4-a9f8-4c04-adc1-d6548982cbf8`在服务重启时由`running→recovering→failed`，错误为`SERVICE_RESTARTED`，没有自动重新提交或发布假结果；用户确认恢复失败态通过。结合前3项，`GEN-006/OPEN-007`正式由BLOCK改为PASS；退款因额度/积分已取消而不适用。
- 第5/10项：节点几何统一为“首次按素材比例自动适配，之后允许用户独立拉大拉小”；文字、图片、视频、音频及其他当前可达节点均恢复八向缩放，手动尺寸刷新后保留。失败卡“重试”文字排版同时恢复为单行居中；用户确认通过。
- 第6/10项：Text/Image/Video/Audio全部改为共享、可扩展的模型参数注册结构；管理员可为当前和以后新增模型选择参数、默认值和参考素材上限，普通用户输入框只显示该模型允许的真实参数。管理员所有下拉已改为项目自绘圆角灰色菜单，用户确认通过。
- 第7/10项：项目所有页面、展开菜单、下拉项和跳转界面统一使用macOS原生系统字体；任一界面最多只有12px与14px两档文字，用户确认通过。
- 第8/10项：图片、视频和音频历史素材支持真实预览、下载及重新添加到画布；小面板和“浏览全部”均可操作，旧占位素材会明确提示不可用。用户确认历史操作通过。
- 第9/10项：火山方舟Seedance 2.0 Mini真实视频任务`788ebeaa-b37d-499a-becc-64ae16f2a9f5`按16:9、480p、5秒、关闭音频、1个结果成功，方舟任务ID为`cgt-20260801165221-6fsd7`，实际费用`0.708932 CNY`。结果`f8820894-6445-4276-8914-dac91889f769.mp4`为802735字节，SHA-256为`2a57db544db15161f08976acd701ffbd2ecf52530ab7d0df8ab62ae641dbacc9`，私有OSS、画布、历史、播放、下载及服务重启恢复均通过；真实数据库保持7条任务且只有1条视频任务。随后`OPS-001`确认服务只监听`127.0.0.1:4173`、局域网不可访问，用户一并确认通过，未部署服务器。
- 第10/10项：`API-001`新增本项目自有OpenAPI 3.1契约`/api/openapi.json`和管理员只读说明页`/admin/api-contract`，记录3条路径、5个读写操作，覆盖画布节点/连线/视口/revision、项目标题和已发布模型参数配置；接口需要登录且不返回密钥。端到端检查真实完成保存再读取，项目全量回归`131项通过、1项受控真实OSS检查跳过`、重启持久化和生产fixture隔离均通过；全局生成开关保持关闭，本项Provider请求为0。用户理解并确认通过，10次批量同步完成，下一批从0/10重新计数。

### 2026-08-02 第二批10次验收同步

- 第1～4/10项：完成各类节点上游入参规则复核、Seedance 2.0 Mini比例与参考素材数量修正、Doubao Seed 2.0 Lite文字模型参数/上游输入及未来自定义规则、文字创作栏冗余标签与选中连线显示层级修正；均由用户在真实本地页面确认通过。新增模型继续使用共享参数第2版规则，不要求改写节点。
- 第5/10项：`API-006`当前账号、个人workspace和权限改由项目自己的`/api/account-context`提供；不依赖Unboundry，也不恢复额度或积分接口。用户确认通过。
- 第6/10项：`API-002`模板分类、搜索、分页与可选graph数据接入`/api/templates`；“分镜大师”模板可返回26节点/31连线，模板创建、更新与失败回滚仍不伪造。用户确认通过。
- 第7/10项：`API-003`Agent模型、暂停技能与建议接入`/api/agent-config`；界面只显示管理员明确设为默认的已发布文字模型，当前为Doubao Seed，真实Agent执行保持关闭。用户确认通过。
- 第8/10项：`API-004`AI角色分类、筛选、分页和总数接入`/api/characters`；默认60张，可加载至80张，Provider请求为0。用户确认通过。
- 第9/10项：`API-005`素材库个人/团队空间、文件夹、搜索、分页和总数接入`/api/library`；个人Others保持3个可拖动本地素材，团队空间为空且不会混入个人素材。用户确认通过。
- 第10/10项：管理员接口总览扩展为8条路径、10个操作。首次全量回归发现临时文字模型会污染Agent菜单和播放列表空格监听重挂两个真实问题，分别收紧为默认文字模型及稳定快捷键监听；最终绿地检查、构建、`144项通过、1项受控真实OSS检查跳过`、重启恢复及生产fixture隔离均通过。全部自动检查未发起收费请求；用户于2026-08-02确认接口总览通过，第二批完成并重置为0/10。

### 2026-08-02 节点入参两轮勘测与实施决定

- 新增证据文件`spec/UNBOUNDRY_UPSTREAM_INPUT_SURVEY_2026-08-02.md`，状态为`SECOND_PASS_COMPLETE / NOT_ACCEPTANCE_PASS`。Unboundry实测允许：Text→Image/Video/Audio、Image→Text/Image/Video、Video→Text/Video、Audio→Video；不允许的拖线只打开来源感知菜单，不留下正式edge。
- 第二轮成功上传项目内非敏感图片、视频和音频；来源节点分别显示图片预览、视频时间轴和音频波形。Image目标的上游Text可直接提供生成指令，Text目标对媒体仍要求自身Prompt，Audio目标可直接使用上游Text；Video目标保留四类引用和全能参考模式。
- 删除Image目标的真实参考图卡时edge由9降至8，`Cmd+Z`恢复为9；整页刷新后8节点、9边、三类ready素材、Text/Video目标Prompt和引用均恢复。没有点击Generate，没有新增结果节点或历史。
- 新增`spec/UNBOUNDRY_UPSTREAM_INPUT_REPLICATION_PLAN.md`，按P0～P6实施：统一规则与UI→Image闭环→Text四类上游→Video全能参考→Audio文字合并→未来模型配置→持久化与回归。
- 用户明确把Text目标扩展为接受Text、Image、Video、Audio四类上游；因此本项目最终矩阵为11条允许、5条禁止。这是本产品决定，不改写Unboundry当前只允许Image/Video直连Text的实测事实。
- 本次是用户明确要求的提前文档同步，不计入下一批人工验收，计数继续为0/10；`GEN-001～009`、`DATA-004`、`API-001～006`等既有PASS均保持不变。

### 2026-08-06 模板库换血：两个真实电商模板 + 占位模板清除

- 从Unboundry官方公开模板目录（`/api/canvas/v1/official-templates`）取回两个真实模板的完整节点/连线数据：`电商详情页工作流`（11节点/29边）与`213.电商图片生成专家`（13节点/12边），来源模板ID分别为`0786e042-095e-4551-b91b-365492e91241`、`aaf7cc53-a595-45da-a6bb-7c93309e0962`；原始数据固化到`server/templateCatalogData.json`。
- `server/templateCatalog.ts`移除原12个占位模板，只保留这两个模板；分类收缩为`最近使用/我的模板/全部/电商`。`includeGraph=true`时返回可直接铺画布的分组图：每组含1个Group、子节点（Text/Image）相对坐标、尺寸、文案/提示词/画幅参数，边统一为`cuttable`左右handle。
- 模板图片节点不绑定Unboundry远程素材，参考入参节点保留为空上传态（用户传自己的产品图/模特图/Logo）；文字节点保留Unboundry原文案并标记可生成；模型不写死，沿用管理员发布的默认文字/图片模型。
- 入参有效性已用当前真实默认模型（Doubao Seed文字 + GPT Image 2图片）逐节点模拟校验：两个模板的所有生成节点均无结构性问题，仅参考图节点等待用户上传素材。期间修正两点：213模板补上“生成商品详情图指令→生成商品详情图”的缺失连线（官方模板本身漏连，否则该节点在我们项目会卡缺提示词）；纯上传位图片节点关闭生成按钮，避免被误当成生成节点。
- 前端模板卡片改为真实预览图（本地`/templates/*.png`），点击卡片即把模板铺到当前项目画布（新Group+子节点+连线，自动保存并适应视图），面板与“浏览全部”均可点击；`创建`按钮仍保持禁用。
- 契约测试`m22-template-contract.spec.ts`与外壳测试`m0-shell.spec.ts`已同步为两个新模板断言；类型检查通过，模板API与点击铺图已在临时测试环境实测（12/14节点、29/11边与Group均正确，预览图加载成功）。
- 注意：`m0-shell.spec.ts`中的“项目菜单”与“P1文字创作栏”两项在标准测试环境仍失败，属于与本批无关的既有差异（项目菜单当前含“工作空间”、文字创作栏在无模型测试库下不出现），未在本批改动范围内。

### 2026-08-06 整组执行（Group Run）方案批准与实施

- 用户明确项目本质是“工作流”：整组执行应按依赖流水自动执行，而不是逐个手动点击。依据Unboundry前端代码（`run_group` → `buildDependencyGraph` → `getLayeredExecutionOrder` → 逐层`Promise.all`并行、失败/跳过即停、可取消、层进度提示）与Dify官方文档（串行链+并行分支）确认行为。
- 完整方案已固化为`spec/UNBOUNDRY_GROUP_EXECUTION_PLAN_2026-08-06.md`（状态`APPROVED`）：可复用执行层（纯函数分层引擎+节点运行登记表）、可执行节点判定、组内连线依赖、并行/取消/失败语义、UI与安全边界、验收标准、明确不做项。
- 打组功能无需新增：多选→打组、Group标题/颜色/布局/解组/下载全部此前已验收（NODE-016、OPEN-020）。
- 实施批从0/10开始计数；完成后先做纯逻辑单测与fixture零请求检查，再交用户真实验收。
- 实施进度：`workflowExecution.ts`（可执行节点判定/Kahn分层/逐层并行执行/取消）与`WorkflowExecutionProvider.tsx`（节点运行登记表、组执行入口、执行中集合、toast回调）已落地；Text/Image/Video/Audio四个节点已登记运行函数（复用现有生成逻辑，不改手动交互）；GroupNode“整组执行”已启用：无可执行子节点或验收页禁用、执行中变“取消”+spinner、完成/失败/未就绪/取消toast；CanvasSurface接入Provider与toast渲染；样式已补齐。
- 自动验证：`tsc`与生产构建通过；新增`m22-group-execution.spec.ts`（分层、外部边/自环、循环检测、可执行判定、同层并行、取消、fixture零付费请求）7项全部通过，Group专项`m2-group-node.spec.ts`4项回归全部通过。真实验收待用户执行（模板组：文字先生成→多图并行→完成提示）。
- 真实验收前用户报告：素材已上传仍提示“有节点未就绪，整组执行已停止”。排查数据库确认根因：用户画布（`540c9b2f…`）是旧版模板铺图，三个上传位节点（平铺图/模特上身图/品牌logo）仍带旧生成标记`imagePromptReady=true`，整组执行把它们当作第一层生成节点，因无提示词且无上游文字全部判跳过，工作流第一层即停；素材本身（src/assetId/ready）和连线全部正常。
- 已全局修正：`isExecutableWorkflowNode`改为“自身提示词 或 有上游文字节点”双条件，上传位/参考位永不参与执行；执行器与Group按钮同步使用同一判定（含外部文字源），对旧画布无需重新铺模板即可生效；测试补充旧标记上传位、上游文字图片/视频等用例，11项全过。
- 2026-08-06真机复现（系统Chrome + CUA）锁定“未就绪”真实根因：整组执行第一个文字节点时，服务端在创建任务前以`费用保护已阻止本次任务`拦截（当日人民币花费7,921,312微元≈7.92元已超过每日5元上限）；该错误原被节点内部吞掉并误报“未就绪”。已全局修复：生成函数返回真实结果（成功/失败+文案），整组执行直接把原因透传为toast，例如“整组执行失败：今日费用额度已用完，请明天再试，或联系管理员调整上限”；新增`friendlyGenerationMessage`统一文案层（短中文保留、长英文/技术串/专业词汇替换为各类型友好回退），Text/Image/Video/Audio四处生成入口全部接入。相关自动测试（消息透传+文案层+Group回归+模板契约）14项全过。
- 问题记录（暂不修，待复现再讨论）：系统Chrome中“点整组执行报错后，触摸板双指滑动偶发变成画布缩放，之后又恢复正常”。已在用户真实Chrome实测：普通双指滑动=平移（缩放0.22不变）、左键拖空白=无反应（`panOnDrag=[1,2]`排除左键，与Unboundry不一致）、仅捏合/Ctrl+滚轮会缩放。最可能是Chrome/触摸板偶发把滑动识别成捏合；相关候选修复为“空白左键拖动对齐Unboundry（平移/框选）”，列入待办。
- 2026-08-06全局额度管理（方案A）已实施：方案与预审计见`spec/UNBOUNDRY_GLOBAL_QUOTA_PLAN_2026-08-06.md`。生成安全中心收敛为“每日/每月全局预算（人民币）+ 单次任务默认上限（¥20）+ 汇率（1美元=7.2人民币可改）”；美元上限按汇率自动派生；新增“分币种线 + 合并折算线”双检查，美元与人民币任务共享同一预算；模型单次费用改为可选覆盖（0=全局默认），移除`COST_LIMIT_NOT_CONFIGURED`；提交链、安全标志（paidX）、任务估算全部统一使用“有效单次成本”。数据库迁移v27已在4173实库生效（默认¥20、汇率7.2）。相关测试（m14新增美元线派生/合并检查/旧接口兼容、m32移除费用未配置用例、整组执行与模板回归）共25项全过；构建通过。`m38`重试快照与`m10`迁移两条失败经提交基线复验为既有问题，与本批无关。
- 2026-08-06画布保存机制：用户确认按“第一步 + 完整复刻待办”执行，完整方案见`spec/UNBOUNDRY_CANVAS_SAVE_REPLICATION_PLAN_2026-08-06.md`。第一步已实施（待用户验收后提交）：生成与保存解绑（节点登记入口先`waitForCanvasRevision`：排空队列→确认revision→等一帧渲染→取最新ref；8s超时友好失败，Text/Image/Video/Audio四类节点经共享`createSaveGateRun`接入）、防抖1000ms→500ms、文档指纹去重+pending合并、409跨会话只自动重试一次（采用服务端最新revision，无revision的409直接提示，不再弹刷新）、冲突/保存失败改为toast（3.5s自动关闭）、`beforeunload`未保存提醒；不改变服务端存储结构。回归：m3-revision-conflict、m22-group-execution（含新增2条等待契约测试）、m2-group-node、m22-template-contract、m14-generation-safety、m32-model-runtime-availability 共28项全过；`tsc`与生产构建通过；已做全量备份（819行/279媒体文件/约96MB）。待办（未来，可能做）：服务端增量操作接口（create/update/delete + session_id）、操作幂等与重放、跨标签节点级合并、本地队列持久化、与`canvas_documents`兼容迁移、改前commit+全量备份+机制开关三道保险。
- 2026-08-06 Unboundry 对照与差距实施：完整对照表与审计结论写入`spec/UNBOUNDRY_COMPARISON_2026-08-06.md`。本批实施（未提交）：①平台连接配置锁死锁修复——`acquireDocumentLock` 增加进程内异步队列，同进程并行生成不再因同步 SQLite 锁卡死事件循环（并发复现脚本：B 由 5s 失败变为 203ms 正常获取；m15 回归 4 项全过）；②全局“生成任务”面板——左侧 Dock 新增“生成任务”，展示进行中/失败/最近完成、可取消/重试，3s 轮询；③结构化错误码→中文映射——`friendlyGenerationCodeMessage` 覆盖额度/并发/连接/模型/重试等 30+ 错误码，四节点失败文案按错误码优先翻译；④轮询失败轻恢复——四节点 `waitForGenerationTaskWithPause` + 节点“重新检查”按钮续查，不清任务；⑤克隆项目——服务端 `POST /api/projects/:id/clone`（复制画布、标题加“副本”），工作空间卡片菜单与画布项目菜单加入口；⑥组自动布局复核（已有宫格/水平，补自动化测试锁定）。新增/更新测试：m2 组布局、m66 克隆、m68 任务面板（经`/api/test-data-directory`定位服务端数据目录）、m15 等回归。用户明确不做：真实分享/撤占位、3D/音效/智能分析、Yjs 协作、社区/插件市场。
- 2026-08-06 工作空间“返回画布”来源修复：画布项目菜单进入工作空间时携带`?from=<项目id>`；工作空间返回按钮优先回来源项目（先校验项目仍存在），其次回本标签页 sessionStorage 最近打开的项目，最后回落默认画布；克隆/新建入口保持原有跳转。多标签页各带各的来源互不串。m66 新增“返回来源项目”测试，连同 m0 仅剩基线已知失败（P1 文字节点选中保持）外全绿。
- 2026-08-07 打组节点外观对齐 Unboundry：组背景由 React Flow 默认 `rgba(240,240,240,.25)`（黑底偏亮灰）改为 `rgba(83,83,83,.3)`（几乎融入黑底）；外框统一 `1px rgba(255,255,255,.2)`，去掉内层 40% 白边框消除双重描边；圆角统一 16px；选中态 `2px rgba(255,255,255,.32)`。仅样式改动，m2 打组与 m16 灰阶一致性回归全过。
- 2026-08-07 连接线 1:1 对齐 Unboundry：实机复现确认“断断续续”是连线被不透明节点卡片遮挡（edges 在 nodes 下层，与 Unboundry 层级一致），非渲染断线。样式对齐：线色 `#7a7a7a`→`#ffffff60`（白 38% 透明）、线宽 1.5→1、禁用 React Flow 虚线动画（`stroke-dasharray:0`）、选中态纯白 1px。无头截图验证为低对比银灰连续实线。密集区节点盖线现象仍可能残留（层级设计所致），如需彻底避免需将连线改画到节点上层（偏离 Unboundry，待用户拍板）。
- 2026-08-07 节点选中关联线高亮+层级流动（Unboundry 没有的新功能）：选中节点时，与其直接相连的边温柔提亮（`rgba(255,255,255,.68)` + 1.25px + 极淡光晕，180ms 过渡），并叠加“低层→高层”方向的流动高光（短亮段 1.8s 循环，≤10 条上限，`prefers-reduced-motion` 下禁用）。分层复用 `buildWorkflowLayers`，环/异常图安全回退为源→目标；多选按并集高亮。实现走“渲染派生”（visibleEdges），不写边 data/className 落库，选中不触发任何画布保存（有测试断言）。顺带修复既有问题：`defaultEdgeOptions.style` 与 `connectionLineStyle` 内联旧色导致 CSS 对齐不生效，已移除内联样式并在加载时清理历史边样式，使线色统一走 CSS。新增 m69 专项 4 项；回归 83 项通过（仅剩 m0 P1 基线已知失败）。
- 2026-08-07 修复“删除→撤销后高亮/流动常驻”bug：根因是 `onDelete` 把 React Flow 内部边对象（携带渲染层临时类名/flow 数据）原样存入删除历史，撤销时又原样还原进真实边状态，导致取消选中后仍渲染。修复：删除入历史前、撤销/重做还原时、画布加载时统一 `stripSelectionFlowMarkers` 剥除 `connected-to-selected-node` 类名与 `flowAnimated/flowDirection` 字段；visibleEdges 类名去重；保留“撤销后节点保持选中”既有行为（m1-delete-undo 测试不变）。新增回归 2 项（撤销后点空白高亮/流动归零、剥除后持久化指纹稳定）；回归 85 项通过（仅剩 m0 P1 基线已知失败）。
- 2026-08-07 模板导入自动找空位：新增 `client/src/canvas/templatePlacement.ts` 纯函数模块，实现 Unboundry 同款算法（模板包围盒→锚点→网格扫描 8列×±10行→整块平移），空画布中心±50随机、有选中放右侧；导入后镜头 800ms 平滑 fitView 到新模板。接入 `apply-template` effect，历史/撤销与持久化语义不变。方案见`spec/UNBOUNDRY_TEMPLATE_PLACEMENT_PLAN_2026-08-07.md`；新增 m70 专项 7 项（含连续导入不重叠集成测试）；回归 94 项通过（仅剩 m0 P1 基线已知失败）。
- 2026-08-07 修复“导入模板后镜头不动/瞬移”：根因是受控 viewport 下 React Flow 的 `fitView` 动画会被 `useViewportSync` 的受控同步瞬间覆盖（采样证实：导入后 viewport 直接从 0,0,1 瞬移到终点，无中间帧）。改为自己计算目标视野（`viewportForBounds`，语义与 React Flow 相同）并用 rAF 平滑插值 800ms（`animateViewport`），彻底绕开受控冲突；配合找空位后镜头会平缓移动到新模板，画布占满时也不会“导入到屏幕外看不见”。新增 viewportForBounds 单测；回归 43 项通过（仅剩 m0 P1 基线已知失败）。
- 2026-08-07 模板镜头修复二次返工（用户两次验收失败后全量预审）：①镜头目标原用“模板原始坐标”包围盒，改为“平移后实际落位”包围盒；②动画期间给保存调度加“动画闸门”（`templateViewportAnimating`），动画最后一帧先关闸再提交最终镜头，保证只触发一次保存，不再卡「保存中…」；③逐帧动画通过 `onViewportChange` 驱动，ReactFlow 回显用 1e-6/1e-9 容差识别并忽略，用户滚轮/拖拽通过 wrapper 立即取消动画；④预审发现并移除一个会与 React 渲染时序竞争的“外部镜头变化检测”effect（旧渲染帧的 prop 会误判为外部修改而取消动画）。已知取舍：动画进行中点击“适应视图”按钮会被动画覆盖，动画结束可再点。新增真实项目画布集成测试（镜头居中完整进屏、保存状态收敛、保存请求 ≤3 次）；回归 46 项通过（仅剩 m0 P1 基线已知失败）。
- 2026-08-07 修复“添加模板后误弹添加节点菜单”：根因是统一菜单命令 effect 对 `dismiss` 之外的任何命令都当成“切换添加节点菜单”，`apply-template` 也误入该分支（真实点击复现 count=1）。改为显式分发：`toggle-add` 才切换菜单，`apply-template`/未知命令只清理浮层；添加节点按钮与空白双击路径不受影响。m70 新增回归断言“导入模板后不出现添加节点菜单”；回归 46 项通过（仅剩 m0 P1 基线已知失败）。
- 2026-08-07 修复“模板导入后一直卡在保存中”：根因有主次两层。主因：常规保存请求误带 `keepalive: true`，Chrome 对 keepalive 请求有约 64KB 硬上限，画布负载超过后每次 fetch 立刻 `Failed to fetch`，进入每 1 秒重试、永远失败的死循环（探针实测：12 节点 25KB/24 节点 51KB 正常，36 节点 77KB 必失败）。改为常规保存不用 keepalive；`pagehide` 兜底保存保留 keepalive 但限制在 60KB 内并吞掉异常（大负载依赖常规防抖保存）。次因：镜头动画闸门若遇 rAF 被节流/暂停可能一直卡住，新增 1600ms 硬性期限，超时后强制放行并直接补一次保存。探针验证 36 节点 + rAF 卡死场景约 1.25s 恢复；m3/m22/m68/m69/m70 共 35 项回归通过，构建通过。

### 2026-08-07 三个新功能方案定稿（待实施）

- 用户确认三功能与全量审计结论：①我的模板（账号私有）②打组/模板工作流批量下载（ZIP）③账号私有平台密钥（普通账号只看平台、每平台填自己的 key，管理员管平台与模型，绝对无跨账号回退）。
- 权威方案已写入 `spec/UNBOUNDRY_FEATURES_PLAN_2026-08-07.md`（状态 `APPROVED BY USER`），含数据模型（v28 user_templates / v29 account_provider_credentials）、API、生成链路 owner 维度改造、鉴权统计按账号隔离、迁移/备份、测试与风险预审计。
- 用户已逐项确认的决策：普通账号只见有已发布模型的平台；同类型多连接各占一行各自填 key；我的模板允许 Audio/Playlist/Storyboard 节点；模板不保留已生成结果只保留提示词/参数/上传素材；ZIP 采用 `archiver` 依赖；备份纳入加密凭据；密钥变更后排队任务友好失败重提交；封面复用项目空间三级规则；下载命名“节点标题-序号.扩展名”、上限 500MB/200 文件。
- 实施顺序：功能1（我的模板）→ 功能2（批量下载）→ 功能3（账号私 key，内部分“数据与接口 → 生成链路 → UI 与收口”三步）。每个里程碑完成 tsc/构建/回归/CUA 实页测试后交用户验收。当前只更新文档，未改任何代码。

### 2026-08-07 功能1：我的模板（已实施，待用户实页验收）

- 小点1 v28 迁移 + 模板 API 扩展：`user_templates` 表（owner_id/title/category/graph/cover_asset_id/时间戳 + owner 索引）；`GET /api/templates?space=mine` 按 owner 过滤并支持 q/category/limit/offset/includeGraph；`POST /api/templates` 校验标题 1–40 字符、分类白名单、图结构（节点≤500、边≤1000、7 种类型）；`DELETE /api/templates/:id` 仅本人可删（他人/不存在均 404）；OpenAPI 新增 create/delete 操作与 11 条路径。数据层导出 `listUserTemplates/saveUserTemplate/deleteUserTemplate` 供隔离单测。
- 小点2 序列化器 `client/src/canvas/groupTemplate.ts`：纯函数 `serializeGroupTemplate`，只收集组内节点与两端都在组内的边，组节点归一化到 (0,0)、子节点保持相对坐标；保留提示词/`*Parameters`/边角色与顺序/上传素材 assetId 与可信媒体元数据/组标题与 groupColor；剥离 `*Src`、`*Generating`、`*Generation*` 任务/错误/重试、`audioGeneratedResult`、`imageGeneratedSuccess`、`inputState`、`audioWaveform`、`playlistPicking`、`groupTemplate` 等；拒绝缺失组与 probe 子节点。
- 小点3 模板图类型放宽：服务端 `TemplateGraphNode.type`、OpenAPI enum、CanvasShell 卡片类型、CanvasSurface 导入命令类型统一扩为 audio/group/image/playlist/storyboard/text/video；公共模板数据不变（m22 契约通过）。
- 小点4 UI：GroupNode「创建模板/更新模板」启用（fixture 与空组禁用），弹窗（标题≤40、分类 GrayMenuSelect 可选、Escape/外点关闭、toast 成功反馈），保存时带上 canvasId+nodeIds 用于封面；模板面板「我的模板」卡片支持 hover 删除并自动刷新，全屏浏览「我的模板」同样可删；导入继续复用既有 `apply-template`（找空位+平滑镜头链路）。
- 小点5 封面三级规则：保存时先查画布内 success 的 image/video 生成任务（owner 过滤）→ 模板图内第一个图片/视频 assetId → 无则浅蓝渐变占位；列表返回 cover + previewImage（视频封面用 `<video>` 渲染）。
- 验证：`tsc --noEmit` 与生产构建通过；新增 m71 专项 9 项（保存/分页/搜索/删除、非法输入、数据层 owner 隔离、封面三级、序列化器清洗/归一化/角色顺序、7 类型模板、真实画布保存→面板列出→删除、空组禁用）；相关回归 m0/m2-group/m20/m22-template/m22-group-execution/m63/m66/m69/m70 共 79/81 通过，2 项失败均为非本批问题：m0 P1 文字创作栏基线已知失败；m63「建组撤销恢复」首次运行偶发坐标时序失败、单独复跑通过（已记录为抖动）。
- 延后问题清单：无阻塞项。m63 偶发时序抖动暂不修（低危、复跑通过、与本批无关）。

### 2026-08-07 功能2：批量下载 ZIP（已实施，待用户实页验收）

- 小点1 依赖：新增运行时依赖 `archiver@8.0.0`（ESM、ZipArchive）；本仓库自写最小类型声明 `types/archiver.d.ts`（官方类型缺失默认导出）。
- 小点2 服务端 `POST /api/canvas/:id/group-download`（`server/groupDownload.ts` + vite 中间件路由）：owner 校验画布与任务；body 支持 `{groupId}` 或 `{nodeIds}`；以 `generation_tasks` 为准只查 `state='success'` 且结果非空的任务；命名“节点标题-序号.扩展名”（清洗非法字符、中文保留、80 字符上限、序号去重）；文字转 `.txt`；上限 500MB/200 个文件；空结果 400 中文提示；本地文件缺失/大小不一致跳过，OSS 结果先流式落临时盘再校验字节数（失败跳过）；跳过项写入 ZIP 内 `下载说明.txt` 并返回 `X-Download-Skipped` 头；响应流式 `application/zip` + RFC5987 文件名。
- 小点3 GroupNode「下载全部」接入接口：真实画布 POST → blob → 浏览器下载，toast「正在打包生成结果…/下载完成/失败原因」；验收 fixture 保留原逐素材下载行为；空组禁用。
- 小点4 集成测试：`unzip` 解包 + SHA-256 内容哈希逐项比对（image/video/audio/text 混合）、缺失文件跳过并生成说明、nodeIds 直传、空组/未知画布/非法请求、真实画布按钮点击下载。
- OpenAPI 新增 `downloadGroupResults`（12 条路径/16 个操作），m20 契约同步。
- 验证：`tsc --noEmit` 与生产构建通过；m72 专项 7/7；回归 m0/m2-group/m20/m22/m63/m66/m69/m70/m71/m72 共 87/88 通过（唯一失败仍为 m0 P1 基线）。
- 延后问题清单：OSS 中途断流按“临时文件字节数不符→跳过”处理，无内存整包缓冲；极端情况下断流前的临时文件会清理。其余无阻塞项。

### 2026-08-07 功能3：账号私有平台密钥（已实施，待用户实页验收）

- 第一步 数据与接口：v29 迁移新增 `account_provider_credentials`（AES-256-GCM + `config-master.key` 加密，永不返回明文）与 `generation_provider_attempts.owner_id`（存量按任务回填）；新增 `GET/PUT/DELETE /api/account-credentials/:profileId` 与 `POST .../verify`（只读校验，零生成费用），仅返回掩码；`account-context` 增加 `manageOwnCredentials`；OpenAPI 同步（15 路径/20 操作）；旧全局 key 迁移到全部活跃管理员账号凭据并清空文档（幂等、无管理员时延后），迁移在首管理员创建与管理员平台 API 上触发；`composeExecutionProfile` 以“连接定义（全局）+ 当前账号 key”合成执行 profile。
- 第二步 生成链路 owner 维度：`resolveModel/generationAvailability/modelRuntimeAvailability/publicModelsApi` 全部按 owner 过滤鉴权/成功/尝试统计并纳入 `ACCOUNT_CREDENTIAL_MISSING/INVALID` 原因码；任务提交在 `model_configuration.credentialVersion` 快照；执行侧 `getProviderProfileForGeneration/acquireProviderGenerationRequestLease` 改为 owner 感知，`requireTaskProviderSnapshot` 校验版本，不符即友好失败「你的平台密钥已变更，请重新提交」；`recordProviderAttempt` 的 AUTH/成功/恢复槽与 `generationSafety.admission` 连续失败熔断全部按 owner 隔离；管理员目录同步/只读资料/连接检查使用管理员自己的凭据（方舟 AK/SK 保留在全局）。
- 第三步 UI 与收口：账号浮层新增「我的连接」入口 + `/connections` 页面（只显示有已发布模型的平台，每行填/存/校验/删自己的 key，顶部说明密钥仅本人可见）；管理员平台连接页移除生成 API Key 字段与掩码展示（方舟目录 AK/SK 页保留）；删除账号级联清理凭据；备份脚本纳入 `data/secrets` 加密凭据并在 manifest 记录/恢复校验。
- 验证：`tsc --noEmit` 与生产构建通过；m73 专项 5/5（加密往返/版本/owner 隔离/verify AUTH→invalid、success→valid/API 掩码与删除/我的连接页与管理员页无 key 字段）；m74 专项 3/3（旧 key 迁移仅给管理员且文档无 key、credentialVersion 不符在 Provider 调用前失败、A 坏 key 不影响 B/管理员且无回退、删除账号级联清凭据）；Provider/账号大回归 107/111（隔离端口 4197）：4 项失败均为既有基线或端口差异——m26 Mureka 错误文案/回显 2 项（基线代码即透传远端 message）、m38 重试快照 1 项（TASKS 已记录基线）、m46 大目录外部请求计数 1 项（4197 端口过滤差异，4174 配置复跑通过）；功能1/2 回归 86/88（m0 P1 基线 + m63 偶发时序复跑通过）。
- 延后问题清单：①m26 两项与 m38 重试快照为既有基线失败，未纳入本批修复（触发条件/影响已记录）；②组合大跑时 m2/m7/m8/m24/m25 等“零 Provider 请求”计数会把 `/src/generation/*` 模块 URL 计入（文件名含 Provider/generation），属测试过滤脆弱性，未改产品行为；③m14 账号权限测试需无 bypass 环境（其独立配置语义），组合跑配置差异已记录；④m30 纯函数单测在当前 Node 25 环境基线失败（与服务器无关，待环境回 Node 22 复核）。

### 2026-08-07 用户验收 t-03 修复：全屏「浏览全部」我的模板卡片 hover 删除

- 用户验收发现：左侧面板「我的模板」卡片可 hover 删除，但放大后的全屏浏览列表里我的模板卡片没有 hover 删除按钮。
- 根因：全屏浏览里删除按钮的显隐条件写成 `templateBrowseCategory === "我的模板"`（只认左侧分类选中态），用户从「我的模板」标签页进入浏览全部时分类默认是「全部」，因此按钮不渲染。
- 修复：全屏浏览删除按钮与删除守卫统一改为以 `templateTab === "我的模板"` 为准；只要是从「我的模板」标签页进入，任何分类下的卡片都有 hover 删除。
- 验证：m71 新增断言（浏览全部卡片删除按钮存在、初始透明、hover 后可见、可点击）；m71 9/9 通过；tsc/构建通过。

### 2026-08-07 用户首轮实页验收结果（部分通过）

- 用户已确认 PASS：T-01/T-02/T-04/T-06/T-07（我的模板 保存/列表搜索/跨项目导入/封面/隔离）、D-01（空结果提示）、K-01～K-05/K-07（我的连接页面、填改删、校验、无 key 禁止、坏 key 隔离、排队任务 key 变更友好失败）。验收矩阵已同步为 PASS。
- T-03 部分通过：发现全屏「浏览全部」我的模板卡片无 hover 删除（根因与修复见上节），待用户重启服务后复测。
- 待验收：T-05（素材引用，操作步骤已提供）、D-02～D-06（批量下载各场景，操作步骤已提供）、K-06（旧 key 迁移）、K-08（删除账号级联）、R-01（全量回归）。

### 2026-08-07 用户第二轮验收修复：素材导入立即显示、方舟 key 迁移与无回退加固

- T-05 当场修：导入模板时立即对落画布节点执行 `normalizePersistedMediaNodes`（与文档 hydration 同一规则），模板只保存 assetId，导入后立即重建 durable src，不再需要刷新才显示图片/视频/音频。m71 新增“导入后不刷新即渲染素材图、刷新仍保留”断言，m71 10/10 通过。
- K-06 当场修（两类问题）：①迁移遗漏火山方舟——旧迁移显式排除了 `volcengine-ark` 的生成 apiKey（只保留 AK/SK），导致方舟 key 未迁到管理员凭据；已改为迁移全部驱动（方舟 AK/SK 仍留在文档）。②迁移会覆盖已手动重填的 key——改为 `INSERT OR IGNORE`，管理员已保存的 key 不被旧 key 覆盖。m74 迁移测试新增“方舟 apiKey 迁移 + AK/SK 保留 + 手动 key 不被覆盖”断言，m74 3/3 通过。
- 安全加固（K-06 延伸）：移除生成链路的“文档 key 回退”——此前无凭据账号可能回退使用全局文档里的 key（跨账号风险）；现在生成链路只认当前账号凭据，缺失即 `ACCOUNT_CREDENTIAL_MISSING`；管理员连接检查仍可用文档旧 key（仅管理员路径）。m38/m44 相关测试按新语义补齐凭据，回归 107/111（余 4 项既有基线/端口差异）。
- 真实库只读核对（不改数据）：管理员账号 `02c9dbba…` 四个平台凭据均 valid（含火山方舟，07:03:22，用户手动重填）；画布 `fbf11bd8…` 的文字节点 `text-af5bb050…` 有两条 success 任务（06:31、06:35），图片节点一条（06:36），与用户 D-03 观察一致——批量下载按方案打包组内全部 success 任务，同一节点多次成功即多个文件（序号去重）。

### 2026-08-07 用户第三轮决定与验收收口

- 产品决定：批量下载改为“每个节点只打包最近一次成功结果”。`groupDownloadApi` 在查询后按 `node_id` 去重（`updated_at ASC` 排序下 Map 覆盖即保留最新），文件数上限/序号按去重后口径计算。m72 新增“同节点两条成功只打包最新”集成断言（ZIP 仅 4 个文件，文字为最新内容），m72 8/8 通过。
- 用户确认通过：T-03（全屏删除复测）、T-05（导入即显示复测）、D-02、D-05、D-06、K-06（方舟迁移复测）、K-08、R-01；验收矩阵已同步 PASS。
- 真实库清理（用户授权）：删除 `account_provider_credentials WHERE account_id='__test__'` 3 条测试残留；删除前一致性备份 `backups/before-test-credential-cleanup-2026-08-07T07-26-54-491Z.sqlite`。`users` 表仍有 1 条 `__test__` 测试用户行，不影响真实登录，是否删除待用户决定。
- 用户复测通过：D-03/D-04（每节点最新一次成功结果、命名与去重、文件数量均符合预期）。三功能 21 条验收全部 PASS，M11 放行门达成。

### 2026-08-07 下一阶段方案（公共模板 × 账号权限）决策定稿，未开始实施

- 已完成：现状调研（`spec/UNBOUNDRY_NEXT_PHASE_INVESTIGATION_2026-08-07.md`）、多步骤 WBS（`spec/UNBOUNDRY_NEXT_PHASE_WBS_2026-08-07.md`）、逐小点详拆（`spec/UNBOUNDRY_NEXT_PHASE_WBS_DETAIL_2026-08-07.md`）。
- 8 项决策点已由用户确认：权限表 v30 / 公共模板表 v31；account-context 先加权限数组并暂留布尔字段；公共模板删除用归档+恢复且种子不可物理删除；最近使用先做本地版；`manage_accounts/manage_permissions` 不授予非管理员；P2（普通能力收回）本批不纳入；不加环境开关；不做投稿。
- 第二批 6 项决策已由用户确认（含全量影响分析结论）：公共模板本期不携带私有素材；`public_templates` 增加 `preview_image` 列；默认能力不可撤销、权限写接口只维护额外授予集；禁止管理员修改自己的权限；公共模板管理接口对无权限账号返回 403；种子模板允许编辑但不可物理删除。
- 当前状态：`DECISIONS CONFIRMED / IMPLEMENTATION NOT STARTED`。未经用户明确说“开始”，不实施任何代码改动。

### 2026-08-07 权限管理 P0 实施（第 0 批前置 + P0-1～P0-10）

- 第 0 批前置：真实数据一致性备份 `backups/2026-08-07T09-17-45-833Z`（schema v29，含 secrets/media/manifest）；新增 `REAL_CATEGORIES` 真实分类白名单（电商/广告/影视/生活/工具/有趣/ACG/Seedance 2.0）并让私有模板保存校验改用；导出 `validTemplateGraph/categories/userTemplateCard`；`vite.config.ts` 把 `/api/admin/users` 注册移到 `/api` authGate 之后（与其余管理 API 统一）；`adminUsersApi` 改走 `requestIdentity`；m45 固定计数 12 → 动态断言；新增 `tests/m11-auth.config.ts`（m11 自起 4194，避开 4173 真实服务）。
- P0-1 权限类型：`types/accountPermissions.ts` 12 项枚举 + `DEFAULT_USER_PERMISSIONS`（5 项默认）+ `ADMIN_ONLY_PERMISSIONS` + 中文文案 + 白名单校验；前后端共用单一来源。
- P0-2 v30 迁移：`account_permissions`（account_id/permission/granted_by/created_at；复合主键；account_id ON DELETE CASCADE；索引）；迁移幂等 + 级联断言。
- P0-3 权限服务：`server/permissions.ts` 提供 `hasPermission`（管理员恒真；普通账号=默认集∪额外授予集）、`accountPermissionSet`、`setAccountPermissions`（事务+审计；默认权限不可写不可撤销；禁止自改；管理员目标恒全量且拒绝写入；`manage_accounts/manage_permissions` 禁止授予普通账号）；审计函数统一到 `server/audit.ts`。
- P0-4 account-context：新增 `permissions: AccountPermission[]`（管理员全量；普通账号默认∪授予集，按枚举序排序）+ 保留 `legacyPermissions` 布尔对象一个版本；m21 双断言。
- P0-5 权限 API：`GET/PUT /api/admin/users/:id/permissions`（守卫 `manage_permissions`；未知值 400、账号不存在 404、无权限 403、自改/管理员目标/超级权限 400）；OpenAPI 登记 AccountPermission schema 与新路径。
- P0-6 六处守卫替换：auth(`manage_accounts`)、modelCatalog(`manage_models`)、providerProfiles+providerCatalog(`manage_providers`)、storageAdmin(`manage_storage`)、generationSafety(`manage_generation_safety`)；`adminUsersApi` 收敛为 authGate + requestIdentity。
- P0-7 前端权限消费：新增 `hasClientPermission`（管理员恒真）；六个 `/admin/*` 路由按权限守卫；账号浮层按权限显隐；`AuthenticatedApplication` 加载 account-context 权限数组（失败降级不阻塞画布）。
- P0-8 权限编辑 UI：`AdminAccounts` 每行新增权限区（12 项 `admin-compact-checkbox` 网格；`manage_accounts/manage_permissions` 禁用并标注“仅管理员”；管理员行只读“管理员（全部权限）”；保存按钮 + 加载/错误/未保存反馈；保存后刷新保持）。
- P0-9 级联删除：删除事务显式 `DELETE FROM account_permissions`（account_id 与 granted_by 双方向）并在删除后断言 0 行残留。
- P0-10 回归与收口：tsc/构建通过；m78 专项 7/7（枚举/迁移/服务/API/UI/路由/级联删除）；m11 4/4；m74 大回归 106/111（失败 4 项均为既有基线：m26 Mureka 2 项、m38 重试快照 1 项、m46 4197 端口过滤 1 项且 4174 复跑通过；m44 迁移列表已随 v30 更新转绿）；m0 22/23（唯一失败为既有 P1 creator 基线）；m12/m13/m14/m15/m20/m21/m45/m46（4174）全绿。
- 延后问题清单：①m26/m38/m46 端口类与 m0 P1 creator 为既有基线失败，未纳入本批；②m44 迁移测试固定迁移列表，后续每新增迁移需同步（已纳入文档连锁）；③`granted_by` 指向已删除管理员的极端场景由显式 DELETE 兜底（当前产品流程只能存在一个管理员，路径不可达）。
- 状态：P0 已实现并经用户实页逐项验收 `PASS`（PERM-001～012，验收矩阵已同步）。

### 2026-08-07 公共模板 P1 实施（P1-1～P1-9）

- P1-1 v31 迁移：`public_templates`（id/title/description/category JSON 数组/ graph/cover_asset_id/preview_image/status 三态/created_by/updated_by/archived_at + 状态索引）。种子来源：由 `templateCatalogData.json` 经 `buildTemplateGraph` 生成静态 `server/publicTemplateSeeds.json`（2 条，图结构与 m22 契约一致：12/29 与 14/12 含 group），迁移内 `INSERT OR IGNORE`，`created_by` 为空表示内置种子。选静态种子文件是为避免 database ↔ templateCatalog 的模块循环导致 vite 配置打包失败（vite 实测报 `init_database is not a function`）；改种源后需重新生成该文件（m77 迁移测试锁数量/标题/图尺寸，防止漂移）。
- P1-2 存储层：`templateCatalog.ts` 新增导出 `listPublicTemplates/publicTemplateCard/parsePublicCategory`（封面优先级 preview_image → cover 素材 URL → 渐变占位；结构对齐 userTemplateCard 并保留 description）；`server/adminTemplates.ts` 提供 `savePublicTemplate/updatePublicTemplate/archivePublicTemplate/restorePublicTemplate/deletePublicTemplate`（校验复用 `validTemplateGraph`/`isRealCategory`；状态任意流转；种子不可物理删除；全部写审计 `public_template.*`）。
- P1-3 管理员 CRUD API：`GET/POST /api/admin/templates`、`PATCH/DELETE /api/admin/templates/:id`（守卫 `manage_public_templates`，无权限 403；DELETE=归档可恢复；OpenAPI 登记）；路由注册在 `/api` authGate 之后。
- P1-4 公共 GET 改库：`space=public` 只读 `public_templates WHERE status='published'`，响应结构（categories/items/pagination/description/previewImage/graph）与改造前一致；静态 JSON 不再作为运行时数据源。
- P1-5 管理页：`/admin/templates` 路由（守卫 `manage_public_templates`）+ `AdminTemplatesPage`（列表卡：封面/标题/分类/状态胶囊/更新时间；新建/编辑弹窗：标题/说明/分类多选（`admin-compact-checkbox`）/封面路径/状态/模板图 JSON/基于现有模板；发布/下架/归档(ConfirmDialog)/恢复；12/14px 灰阶紧凑样式）。
- P1-6 浏览全部管理入口：`CanvasShell` 新增 `permissions/role` 入参（App 渲染点同步），浏览全部侧栏对具备 `manage_public_templates` 的账号显示「管理公共模板」；公共卡片永不显示删除按钮（既有行为不变）。
- P1-7 上传位兼容：m77 UI 集成测试——管理员发布含上传位节点（无 assetId 的 image/text/group）的公共模板 → 普通账号导入 → 节点正常显示、刷新保持、封面来自 preview_image。
- P1-8 最近使用本地版：localStorage `unboundry-template-recent:v2:<userId>` 记录最近导入（公共+私有），「最近使用」分类按记录倒序过滤排序；失效（归档/删除）模板静默跳过；无记录回落空态。
- P1-9 回归收口：tsc/构建通过；m77 专项 6/6（迁移/存储/API 403+CRUD/公共 GET 契约/上传位导入+封面/管理页 CRUD/入口权限+最近使用）；m22/m70/m71/m20/m45/m0 模板批 45/46（唯一失败为既有 m0 P1 creator 基线）；m74 大回归 107/111（失败 4 项均为既有基线：m26 Mureka 2、m38 重试快照 1、m46 4197 端口过滤 1 且 4174 复跑通过；m44 迁移列表已含 v30/v31 转绿）；m78 7/7。
- 延后问题清单：①既有基线失败 4 项 + m0 P1 creator 未纳入本批；②m46 大目录测试的请求过滤在 4197 端口配置下会把本地资源计入（4174 复跑通过），与本批新增的 account-context 请求无关；③公共模板本期不携带私有素材（决策 9），带图公共模板需等公共素材复制功能立项。
- 状态：P1 已实现并经用户实页逐项验收 `PASS`（PUB-001～011，验收矩阵已同步）。

### 2026-08-07 线上 4173 崩溃修复：v32 补列迁移（public_templates.description）

- 现象：用户打开 127.0.0.1:4173 报 `ERR_CONNECTION_REFUSED`；launchd 服务 `com.unboundry-replica.4173`（KeepAlive）反复拉起后再次退出。
- 根因：真实库的 v31 迁移是开发服务在 09:29 热重载时写入的早期版本，`public_templates` 缺少后来补进的 `description` 列；新代码 `listPublicTemplates` 的 SELECT 引用 description → 每次登录页加载模板目录即抛 `no such column: description`，Node 进程退出。日志证据：`/tmp/unboundry-4173.log` 连续 7 次同类崩溃。
- 处置：新增 v32 幂等迁移 `addColumnIfMissing(public_templates, description, TEXT)`；先在真实库副本（sqlite3 `.backup`）上演练（副本 user_version 31→32、列补齐、2 条种子保留、`/api/templates` 带 bypass 实测 200/2 条），再 `launchctl kickstart -k` 重启 launchd 服务。重启后真实库 user_version=32、description 列存在、种子 2 条、服务持续存活无新错误。
- 文档连锁：m44 迁移列表 +v32；m77/m78 改断言 `currentSchemaVersion`。
- 教训：真实库已热重载执行过的迁移版本，其定义在开发中不能再修改；后续改表一律新增迁移。种子行的 description 为 NULL，公共卡片按 `?? ""` 输出，不影响契约。
- 验证：m77 6/6、m78 7/7、m44 迁移 1/1、tsc 通过；4173 页面与 `/api/auth/status` 均 200。

### 2026-08-07 用户验收修复：浏览全部「我的模板」筛选桶为空

- 现象：普通账号新建「我的模板」后，左侧面板「我的模板」标签可见该模板；打开浏览全部后，侧栏「我的模板」分类为空，「全部」分类才可见（用户实页截图 + arkcli 读取确认：图 1 空、图 2 显示「测试子账号模板」）。
- 根因：浏览全部把侧栏分类原样传给服务端，`space=mine&category=我的模板` 时 `listUserTemplates` 把「我的模板」当字面分类过滤（`category = '我的模板'`），而模板保存的是真实分类，结果恒为空。
- 处置：`listUserTemplates` 把「我的模板」与「全部/最近使用」一样视为筛选桶（不过滤）；`listPublicTemplates` 保持原语义（公共空间下「我的模板」桶仍为空）。
- 回归：m71 该用例新增侧栏「我的模板」→ 卡片可见、「全部」→ 仍可见断言；m71/m0 模板段通过，tsc 通过；4173 服务热重载即可复测。
- 用户确认：2026-08-07 用户在 4173 实页复测通过（普通账号浏览全部「我的模板」分类可见刚新建模板），该回归修复关闭。

### 2026-08-07 生成安全「并发与频率」上限放宽（v33）

- 现象：管理员在生成安全「并发与频率」输入 500 后无法保存，截图确认 6 个字段均无法写入；服务端校验上限为 20（请求频率 120），且数据库表 CHECK 约束同为 `BETWEEN 1 AND 20`，双重拦截。
- 处置：服务端 `cleanInteger` 上限放宽至 1000（per_user/text/image/video/audio 并发 + requests_per_minute），前端 max 同步 1000；新增 v33 迁移重建 `generation_safety_settings` 表，把 6 个字段的 CHECK 放宽到 `BETWEEN 1 AND 1000`（其余列与约束保持不变、数据原样保留）。真实库副本演练通过（v32→v33、原值 5/5/1/5/5/5 保留、20 列完整）后重启 launchd 服务，真实库 user_version=33、页面 200。
- 验证：m14 新增「高并发/频率可保存、超 1000 拒绝」用例，m14 6/6（新配置自带 4176 webServer 供 UI 用例，其余用例自起 4198）；m44 迁移列表 +v33；tsc 通过。
- 用户确认：2026-08-07 用户在 4173 实页把「并发与频率」各项调整为 500 并保存成功，该配置调整关闭。

### 2026-08-08 画布丝滑度修复（方案已确认，STEP 1 进行中）

- 背景：用户与 4 人实测反馈 Unboundry 画布缩放/拖动显著更丝滑；真实 Chrome 实测确认差距（我们 28 节点缩放有 3 次 55–91ms 长任务、60 节点拖拽 94fps/6 丢帧；Unboundry 0 长任务、最大帧 <28ms，且节点按视口挂载/卸载）。
- 权威方案：`spec/UNBOUNDRY_CANVAS_SMOOTHNESS_PLAN_2026-08-08.md`（含证据、三步计划、风险应对、测量方法）。
- 用户已确认两项决策：①推翻“200 节点不引入虚拟化”旧决策，同意可视区域+缓冲带+缓存渲染；②按“第一步→实测→第二步→实测→第三步→实测”推进，每步先给实测再继续。
- STEP 1 已实施并提交（`c87e3e6`）：viewport 下沉到 CanvasSurface（外壳只留低频缩放摘要+命令式滑块/适应视图）；持久化 watcher 增加 250ms 交互安静期（拖动/缩放期间跳过指纹与保存调度，停手后照常 500ms 防抖保存，多标签/revision/pagehide 语义不变）；m71 新增“拖动中不写库、停手后必然保存”断言。
- STEP 1b 已实施并提交（`11aadf3`）：ReactFlow 改真正非受控（移除受控 viewport prop，instance.setViewport 生效）；普通缩放/平移只更新 ref+DOM 属性，仅多选状态同步 React 状态供工具栏定位（进入多选时同步实时视口）；程序化视口变化显式调度交互安静期保证保存；镜头动画期间不触发保存重查，动画结束只保存一次。
- STEP 1/1b 实测（真实 Chrome、28 节点临时项目，同手势，两轮稳定）：缩放 120/121fps、0 长任务、最大帧 9ms（达标）；平移 120fps、0 长任务、最大帧 9ms（达标）；拖动 104–106fps、2 次长任务（81/85ms，p95 9ms）。拖动残留归因：节点组件无 memo，位置更新全量重渲染（jsxDEV+节点组件渲染），列入 STEP 2。
- STEP 1 验收结论：缩放/平移达标；拖动优化转入 STEP 2（React.memo + 稳定 data 引用），完成后再同法复测。
- STEP 2a 已实施并提交（`33b1964`）：8 种节点组件与 CuttableEdge 包 React.memo（未变节点不再重渲染，profile 中节点组件耗时消失）；onNodesChange 拖动中的每次位置变化重置交互安静期，杜绝长拖中途保存。回归 m1/m2-group/m62/m69/m70/m71 37/37。
- STEP 2 实测结论（真实 Chrome）：开发模式（vite dev）28 节点拖动 101fps/3 长任务（94-111ms）、60 节点 72fps——剩余成本为 dev 模式 React 元素检查（jsxDEV）；生产构建（vite preview）28/60 节点拖动 119-120fps、0 长任务、最大帧 9-17ms（达标），200 节点 66fps/22 掉帧（超大画布仍需可视区域渲染）。
- 待用户决策：4173 真实服务由 launchd 运行 `vite dev`，dev 模式固有 jsxDEV 开销让拖动仍有卡顿；切 `vite preview`（生产构建）即可在日常使用中达标。涉及真实服务配置，待用户确认后执行（改前备份 plist，改后需 rebuild+重启）。
- STEP 2b 已实施并提交（`e42795e`）：ReactFlow 启用 `onlyRenderVisibleElements`（可视区域渲染）；m1-dense/m2-geometry 的 DOM 全量计数断言改为 data-* 属性 + 可见节点断言。生产构建实测：200 节点拖动 119fps/0 掉帧/p95 9ms（此前 66fps/22 掉帧）；快速平移节点实时挂载、无空白；缩小视图全量挂载。
- STEP 3 已实施：m1-dense 性能门禁收紧（长任务 <100ms、p95 帧 ≤25ms、最大帧 <100ms，dev 模式仍绿）；新增 `tests/m79-canvas-smoothness.spec.ts`（生产构建专项：60 节点拖动丝滑、快速平移节点实时挂载 + 缩小全量挂载），m79 2/2。
- 最终一步（用户已按推荐同意在收尾时执行）：4173 由 `vite dev` 切换为 `vite preview`（生产构建）并重启；切换后每次改代码需 rebuild+重启。执行时先备份 plist。
- 已执行：4173 切换为 `vite preview`（launchd plist 已备份为 `~/Library/LaunchAgents/com.unboundry-replica.4173.plist.bak-20260808`，仅新增 `preview` 参数），服务重启后页面/接口 200。真实 Chrome 60 节点最终复测：缩放 121fps、平移 120fps、拖动 119fps，全部 0 掉帧、0 长任务、最大帧 ≤17ms。
- 运维约定（切换后生效）：4173 服务生产构建模式，改代码后需 `npm run build` 并 `launchctl kickstart -k gui/$(id -u)/com.unboundry-replica.4173` 生效；开发调试请用独立端口（4174/419x）。
- 已切回开发模式（用户选择，因后续功能开发需要即时生效/HMR）：4173 launchd 移除 `preview` 参数，服务以 `vite dev` 运行，页面/接口 200；所有性能优化代码仍在，仅 dev 模式检查开销会让拖动手感回退（日常使用建议等功能批次完成后切回成品模式，plist 备份仍在）。
- 2026-08-08 对齐 Unboundry 交互：拖动节点过程中隐藏该节点的功能栏/创作框，松手后恢复（`useSingleNodeChrome` 增加 `dragging` 判定，7 个节点组件传参）。实测：开发模式 28 节点拖动 101→104fps、长任务 3→2（94-111→68-104ms），拖动中创作框/功能栏 DOM 为 0；成品模式维持 0 长任务。新增回归“Text toolbar and creator hide while dragging and return after release”。已知批量跑时 m2-image/audio/video 的“零 Provider 请求”计数会把 /src/generation/* 模块 URL 计入（既有过滤脆弱性，与本次改动无关，单独复跑/单跑通过）。
- 用户确认：2026-08-08 用户在 4173 实页确认“拖动中隐藏功能栏/创作框、松手恢复”通过（提交 `f2f86f9`）。
- 延后问题（与 STEP 1 无关，既有）：m27 `allowed Video media edges pass zero-cost preflight` 在改动前主干同样失败（期望 0 实得 2,777,778，疑似模型成本/默认单任务费用口径，另行排查）；m0 P1 creator 基线。
- 延后问题（既有）：m63 `group create, undo, delete recovery` 在完全未改动的主干上稳定失败——快照显示“保存中…”与 GET 竞态（第二次打组后保存未落库即被读取），属测试竞态，另行排查。

### 2026-08-08 存储读取规则修复（方案 A，用户已确认三项决策后实施）

- 现象：多个图片节点显示「无法显示图片」，服务端返回 503 `Cloud asset is temporarily unavailable`；用户此前已确认不是手动删除。
- 根因（本次逐行审计修正）：读取路径本来就不查云路由开关；真正损坏的是配置状态机——`activeProfileId` 指向 TapFK 配置但其状态是 `verified`（不是 `active`），`activeStorageProfile()` 返回空导致全部 OSS 读取/删除/下载/清理失败；触发点是「正式配置」再次点「测试连接」被 `markStorageProfileVerified` 降级；状态接口又用同一「必须 active」逻辑把原始开关 `true` 掩盖成界面上的「本机存储/云请求关闭」，导致无法从 UI 发现与修复。
- 处置（代码）：新增 `readableStorageProfile` / `storageProfileById` / `storageProfileForMedia`，7 条读取/删除/下载/清理路径按素材所属配置解析（assetStorage、videoStorage、audioStorage、providerMedia、groupDownload、auth 删账号、generatedMediaCleanup）；`markStorageProfileVerified` 对正式配置只刷新验证时间、不再降级；v34 `media_assets.storage_profile_id` + 新 OSS 写入登记所属配置；状态接口新增 raw/effective/objectCounts/warning（旧字段兼容）；管理页警告横幅与「重新测试（保持正式）」。
- 处置（真实库）：修复前备份 `backups/2026-08-07T19-04-25-352Z`（v33，977 行/308 本地素材）；4173 热重载后 v34 自动应用；secrets 已修复（TapFK 恢复 active、`mediaRoutingEnabled=false` 保持本地优先）；`scripts/repair-storage-state.mjs --backfill` 回填 70 个 OSS 素材的 `storage_profile_id`；`admin_audit_events` 记录 repair/backfill 共 2 条。
- 脚本（L3）：`scripts/backup-to-oss.mjs`（本地备份后上传 OSS `backups/` 前缀，含干跑与 retain-days 清理，首次真实上传待用户授权）；`scripts/mirror-oss-to-local.mjs`（OSS `objects/*` 镜像回本地并核对 SHA-256，首次真实运行待授权）；npm scripts `data:repair-storage` / `data:backup:oss` / `data:mirror-oss`。
- 验证：tsc、`npm run build` 通过（仅既有 chunk 体积提示）；m80 专项 4/4（重测不降级、路由关闭存量 OSS 仍 307 读取、无可用配置告警、新素材登记所属配置）；m10/m13/m31/m72 回归合计 30 通过、1 跳过（m13 真实 OSS 专项需 `UNBOUNDRY_REAL_OSS_VERIFY=1`）。
- 顺带修复：m10「trusted-duration migration」用例的老库 fixture 漏建 `project_metadata`（既有遗漏，与本批无关但导致该用例失败），已补齐；m31 媒体构造补 `storageProfileId`。
- 后续确认：2026-08-09 用户实页确认旧 OSS 素材已恢复显示，`STORAGE-004` 正式转为 `PASS`。首次真实 OSS 备份上传与反向镜像仍属于独立授权事项，不随本项验收扩大。

### 2026-08-08 部署方案立项（DRAFT，未改代码）

- 用户确认最终目标：所有开发/优化/修改都是为了以后部署到云服务器，让其他设备（MacBook/Win11/手机）用浏览器访问同一网站操作同一份数据。
- 已全量盘点现状并产出 `spec/UNBOUNDRY_DEPLOYMENT_PLAN_2026-08-08.md`：运行方式（vite preview + 中间件插件）、数据（SQLite WAL + media + 加密 secrets，约 138MB）、鉴权/安全现状、10 项公网化缺口（反代后回环判定失效、Secure Cookie、上传上限、首管理员初始化、测试残留、代理策略、备案/区域等）、分阶段实施（代码加固→服务器准备→数据迁移→域名 HTTPS→运维备份→收口）、风险与 DEP-001～010 验收清单。
- 当前仅新增方案文档与 TASKS 记录；等待用户补充信息（域名、服务器区域/配置、Provider 访问方式、是否整体迁移数据）并下令后实施。

### 2026-08-08 部署阶段 1 安全加固（已完成）

- 用户确认「开始加固」，其余服务器/域名信息稍后提供。
- `UNBOUNDRY_TRUST_PROXY=1` 支持：`auth.ts clientAddress()` 按 `X-Forwarded-For` 首个 IP 判定真实客户端；`storageAdmin` 信任反代时存储写操作必须带 `X-Forwarded-Proto: https`，直连本机（SSH/curl）仍放行；`.env.example` 补充部署环境变量说明。
- 新增 `tests/m81-deployment-hardening.spec.ts` 2/2：远程伪造环回创建管理员被 403；反代 HTTP 存储写被 400、HTTPS 转发头 201；直连本机管理流不受影响。
- 测试残留核对：真实库 `__test__` 账号及关联行已为 0（此前删除完成），仅剩历史审计记录 id=151（delete_user 历史，保留）；无需再清理。
- 回归：tsc、build 通过；m81 2/2、m13 5/6（1 项真实 OSS 专项默认跳过）、m80 4/4。
- 下一步：等用户提供服务器/域名信息后进入阶段 2（服务器准备）与阶段 3（数据迁移）。

### 2026-08-08 部署上线（canvas.mymy.ltd）

- 服务器与域名：腾讯云轻量上海 101.43.77.14（4C8G/120G，Ubuntu），域名 mymy.ltd 为阿里云购买、备案已迁腾讯云通过；子域名 canvas.mymy.ltd（阿里云云解析 A 记录 → 101.43.77.14）。
- 部署：Node v22.23.2（/opt/node22）；应用 /opt/unboundry-app（npm ci + build 通过）；数据整体迁移 /var/lib/unboundry（v34、378 素材、mymy 管理员，来自备份 2026-08-07T20-03-01-864Z）；systemd unboundry-replica 开机自启。
- 公网：nginx 新增 canvas 站点（80→301 HTTPS，443→127.0.0.1:4173，client_max_body_size 600m），Let's Encrypt 证书自动续期；live-cockpit 设为 default_server 保持原样；nginx/certbot 配置已备份。
- 安全验证：公网 POST /api/auth/bootstrap 实测 403；未登录素材 401；UNBOUNDRY_TRUST_PROXY/SECURE_COOKIES=1；服务环境无任何 UNBOUNDRY_TEST_*；vite preview.allowedHosts 放行 canvas.mymy.ltd。
- 备份：unboundry-backup.timer 每日 03:30（Persistent=true）；首次真实备份已上传 OSS `objects/backups/2026-08-07T20-18-27-167Z/`（317 文件，HEAD 抽查 OK）；恢复演练通过（verify-backup --runtime-port 4198）。
- 脚本修复：backup-to-oss 干跑 flag、`--backup-root` 参数、改用 OSS client.put（`objects/backups/` 前缀兼容 RAM 最小权限）、list 签名修复、清理 fail-soft；mirror 跳过备份前缀、list 修复。
- 延期/待办：① ~~服务器代理（OpenRouter）~~ **已取消**（用户决定：云服务器不装代理软件，避免云厂商风控与合规风险；OpenRouter 不启用，火山方舟为当前生成平台）；② RAM 无 ListObjects，旧备份清理与镜像待放行权限后启用；③ 多设备、大视频上传、Cookie Secure、火山方舟公网生成仍按验收矩阵各自状态推进。`DEP-004` 已于 2026-08-09 获用户实页确认并转为 `PASS`。
- 用户确认：2026-08-08 用户已在 https://canvas.mymy.ltd 登录成功。

### 2026-08-08 品牌更名与图标（中文「无央」、英文「Unboundry」）

- 用户定名：中文「无央」、英文「Unboundry」；画布左上角图标选定「无界环」方案（白→冰蓝渐变无穷环 + 深色圆角底，替换原四色柔化渐变圆斑）。
- 全量改名（134+ 文件）：代码/文档/测试/文件名的旧品牌名统一改为 Unboundry/unboundry/UNBOUNDRY_；数据库文件、登录 Cookie、加密文件 AAD（storage-profiles / provider-profiles，旧文件保留 `.pre-aad-rename` 备份）、环境变量、本地 launchd、服务器 systemd、目录全部迁移。
- 参照资料：`spec/reference/` 与 `upstream-reference-*.json` 按约定保留为上游参照，新增 `spec/reference/README.md` 标注「私有、不随开源发布」；其余位置 `rg` 验证零旧品牌残留。
- 回归：tsc、`npm run build` 通过；m10/m13/m80/m81 共 14 通过、1 跳过（真实 OSS 专项）；本地 4173 数据完好（schema v34、2 用户、378 素材、secrets 新 AAD 可读）。
- 服务器：`https://canvas.mymy.ltd` 公网 200；备份干跑通过（319 文件）；旧服务单元与 launchd plist 均已退役改名（带 `.retired-rename` 后缀保留）。
- 一次性迁移脚本 `scripts/migrate-secrets-aad.mjs` 使用后移出仓库（旧加密 AAD 迁移已分别在本机与服务器执行，脚本可随时从 git 历史找回）。
- 版本号：待 GitHub 私有仓库建立后按 v0.1.0 打标（见下一节）。

### 2026-08-08 GitHub 私有仓库与 v0.1.0

- GitHub 账号 jasionia1991-max 重新授权（设备码流程，浏览器确认）；私有仓库 `github.com/jasionia1991-max/unboundry` 已创建并推送 main（359 个跟踪文件，无密钥/数据库被跟踪）。
- 版本标签 `v0.1.0` 已推送，对应当前公网部署（canvas.mymy.ltd）。
- 后续发布规则：修 bug 加补丁位（v0.1.1）、加功能加次版本（v0.2.0）、大改动加主版本（v1.0.0）；每次发版前先本地测试，发版脚本后续随「版本更新推送」功能一并完善。

### 2026-08-08 版本更新推送功能（v0.2.0）

- 方案：`spec/UNBOUNDRY_VERSION_UPDATE_PLAN_2026-08-08.md`；实现 `GET /api/version`（package.json 版本号）+ `GET /api/updates`（SSE 实时通道，连接即发当前版本，25s 心跳，nginx `proxy_buffering off`）。
- 前端：`UpdateNotice` 挂在画布生成上下文内；构建时通过 `__UNBOUNDRY_VERSION__` 嵌入版本号，SSE 版本不一致时底部弹「已更新到 vX.Y.Z + 刷新」；点刷新先 `flushCanvasSave()` 等画布落盘再 `location.reload()`（回到同画布）。
- OpenAPI：`/api/version` 已登记，m20 断言同步（18→19 条路径、卡片 26→27）。
- 发布脚本：`scripts/deploy.mjs --version X.Y.Z`（改版本号→本地构建→提交打标→rsync→服务器构建重启→版本校验→推 GitHub）。
- 测试：m82 4/4（版本接口、SSE 首帧、版本变化弹提示、同版本不弹）；m20 1/1；tsc/build 通过。
- 发布：以 v0.2.0 首次走完整发布流程（见 git 记录）。

### 2026-08-08 主页与图标尺寸（v0.3.0）

- 登录后默认进入主页（`/` = 工作空间项目网格）；默认画布入口为 `/canvas`，项目画布为 `/canvas/:id`。
- 主页左上角：无界环图标 36px + 「无央」22px 粗体白字（间距 8px、垂直居中），按上游参照主页比例实现；工作空间页头部改造为品牌区 + 标题 + 工具栏。
- 画布左上角图标 28→34px（点击区 46×42，项目区 320→344px，标题区右移）；管理页图标统一 32px。
- 冻结坐标基线同步：m0 shell 与响应式基线更新 logoButton/titleInput/projectArea；测试根路径统一为 `/canvas`。
- 测试：m83 2/2（主页品牌与尺寸、画布 34px/管理页 32px）；m0-shell 22/23（唯一失败为既有 P1 creator 基线）；m66 13/13、m82 4/4。
- 发布：以 v0.3.0 走 `scripts/deploy.mjs` 全自动发布。

### 2026-08-08 品牌升级：霞鹜文楷 + 无框大图标 + 主页铺满（v0.4.0）

- 字体：自托管 LXGW WenKai（OFL 授权，两个 unicode-range 分片覆盖「无」「央」），「无央」保持 22px、白→冰蓝渐变 + 0.12em 字距，下加小字 `UNBOUNDRY`（0.42em 字距）。
- 图标：去掉深色底框，改为白→冰蓝渐变无界环 + 柔光（drop-shadow）；主页 60px、画布左上角 60px（画布内不出现「无央」文字）、管理页 32px。
- 主页铺满：去掉 `max-width:1100px` 居中，网格 `minmax(220px,1fr)` + 18px 间距。
- 画布顶栏几何：project-area 364×64、logo-button 72×64、标题区 76/12、项目菜单下移至 y=84；m0 冻结基线（projectArea/logoButton/titleInput/menu）同步。
- 测试：m83 2/2（60px 图标尺寸）、m0-shell 24/25（唯一失败为既有 P1 creator 基线）、m66 13/13、m82 4/4；tsc/build 通过。
- 发布：以 v0.4.0 走 `scripts/deploy.mjs` 全自动发布。

### 2026-08-08 线上事故：账号密钥解密失败（改名时加密串迁移漏了数据库行）

- 现象：节点提示「未配置平台连接」；「我的连接」里 4 个平台的 API Key 全部为空、无法校验（截图确认平台预设接口均「有效」，仅账号密钥缺失）。
- 根因：品牌改名时把加密文件的 AAD（storage/provider profiles）迁移了，但**账号私有密钥存在 SQLite 的 `account_provider_credentials.encrypted_key` 行里**（`iv$tag$ciphertext`，使用 `account-credentials:v1` AAD），这些行没有迁移；改名后代码用新 AAD 解密旧行失败 → 密钥视为未配置。
- 处置：新增一次性脚本 `scripts/migrate-account-credential-aad.mjs`（先备份，再逐行尝试新 AAD→跳过、旧 AAD→解密后用新 AAD 重写）；服务器 5/5、本机 5/5 迁移成功并逐行验证新 AAD 可解；`unboundry.service` 已重启，`/api/version` 正常；m73/m13 回归 10 通过 1 跳过。
- 教训：涉及加密 AAD 的改名必须枚举全部持久化位置（加密文件 + 数据库加密列）；迁移脚本使用后移出仓库（可从 git 历史找回），仓库保持零旧品牌残留。
- 待用户实页确认：刷新「我的连接」后密钥恢复显示并可校验；节点恢复生成（火山方舟）。

### 2026-08-08 全量回归审计（v0.4.1 收口）

- 触发：用户要求全量分析近期动作（改名/主页/品牌升级/事故修复）是否影响既有功能。
- 全量回归 514 项：452 过 / 58 失败，逐项隔离复跑后分类：
  - 已修复（本审计）：测试内参照图片路径未随改名更新（`upstream-v2.12.2-dense` 等，9 文件）；m18 字号契约未纳入品牌字号；m44 迁移列表缺 v34；5 个“零 Provider 请求”测试的过滤器把 `/src/generation/*` 本地模块误计为请求（13 处）；管理页「返回画布」在主页路由后仍跳 `/`（改为 `/canvas`）。
  - 既有基线（隔离复跑仍失败，与本次无关）：m0 P1 creator、m26 Mureka 2、m27 zero-cost、m30 Node25 基线 5、m38 retry-snapshot、m63 打组竞态、m79 需生产构建配置、m2-storyboard 2（v0.3.0 同样失败）。
  - 批量共存伪失败（单跑通过）：m77/m78 共享临时库 bootstrap 409、m17/m33 共享状态、m24/m25/m37/m41 计数口径。
- 结论：**近期动作未引入新的功能回归**；已顺手修复测试基建与一处导航行为。
- 发布：v0.4.1（含「返回画布」修复）。

### 2026-08-08 六项真实缺陷修复（v0.4.2）

- **Mureka 密钥泄漏（安全）**：远端错误文本可能回显 API Key；现在 AUTH 一律用本地友好文案，其余错误只要包含密钥就丢弃远端文本（`murekaAudioProvider.ts`）。m26 5/5。
- **成本预检算错**：平台未配置/适配器不支持时预检费用仍按模型计价（曾出现 2,777,778）；现改为未配置即 0（`generationTasks.ts`）。m27 20/20。
- **重试快照误报等待确认**：重试兼容性预检给快照素材补可信元数据标记，不再把已保存素材误判为“等待服务端确认”（`generationTasks.ts`）。m38 8/8。
- **取消结果未知任务跟踪（测试键过期）**：客户端意图键已升级 v2（含账号/画布），测试仍按 v1 读取；已同步测试。产品逻辑本身正确，m41 5/5。
- **上传失败提示混链路**：图片/视频/音频的上传错误不再套 Provider 通用文案，直接显示原始错误（三节点）。m37 3/3。
- **夹具画布初始视口未应用**：非受控画布初始化时未把初始视口应用到实例，导致 data-viewport-zoom 与实际渲染不一致、故事板节点尺寸换算失真；改用 ReactFlow `defaultViewport` 在初始化时可靠应用（不影响节点测量）。m2-storyboard 2/2、m2-group 5/5、m62 5/5、m1 2/2。
- 其余：m27 1020 为间歇性（复跑 20/20）；m0 P1/m30 Node25/m63 竞态/m79 需生产配置仍为既有基线。
- 全量回归最终：490/514 通过；剩余 22 项 = 既有基线 8 项（m0 P1、m30 Node25、m63、m79）+ 批量共存伪失败 14 项（单跑全过：m17/m24/m25/m33/m62/m7/m66/m70/m77/m78 等）。

### 2026-08-08 优创「GPT Image 2 · 专用协议」本地参考图修复（v0.4.3）

- 现象：优创专用协议带本地参考图生成图片失败，错误为优创返回 `image 参数格式错误：'data:image/png;base64,...'`；纯文生图（无参考图）正常；整组运行停在图片节点失败后（运行器“首错即停”是设计行为，与上游一致）。
- 根因：本地参考图在适配器里以 `data:` URL 塞进 `/v1/images/edits` 的 `image` 参数，优创不接受；历史成功样本要么无参考图，要么走 OpenRouter（接受 data URL）。
- 处置：`requestRelayGptImage` 发送前把 `data:` 参考图临时上传到私有 OSS（objects/ 前缀），换成 300 秒短时签名 HTTPS URL 再发给优创；请求结束后删除临时对象与本地临时文件；无 OSS 配置时保持原行为回退。
- 验证：tsc/build 通过；m53 21/21、m58 3/3、m55 1/1（无法自动发起真实付费生成，待用户实页复测）。
- 备注：若优创仍拒绝签名 URL（理论上可公网 GET），下一步备选为裸 base64 或公共下载地址。

### 2026-08-08 复制粘贴增强（组复制 + 粘贴到光标，v0.4.4）

- 问题：复制组只复制空框（子节点/连线没带）；粘贴固定在原位置 +40px，不在光标处。
- 处置（`CanvasSurface` 内部）：
  - 剪贴板升级为「节点数组 + 连线数组」；复制组时递归收集所有层级子节点与组内连线；复制组内单节点时粘贴为独立节点（相对坐标换算成世界坐标）；
  - 粘贴/副本用 idMap 重建节点与连线、保留组内相对布局、组外连线不复制；粘贴后只选中新顶层节点并同步主节点；
  - 记录鼠标最后的世界坐标：键盘 ⌘V 粘贴到光标，空白右键「粘贴」用菜单坐标；落点语义为「左上角对准光标」；无指针时回退原位置 +40px；
  - 历史/撤销沿用整图快照机制，保存/持久化走既有管线。
- 测试：新增 m84 2/2（组复制粘贴子节点与连线、光标落点、组内单节点独立粘贴）；m0 复制粘贴专项更新为新语义（22/23，唯一失败为既有 P1 基线）；m1/m2-group/m66/m82/m83 相关回归全绿。

### 2026-08-08 生成中「呼吸点阵」统一动效（v0.4.5）

- 需求：所有节点生成中用同一套点阵；原图片点阵静止、视频/音频呼吸太弱，需要强烈呼吸感；文字节点补同一套。
- 处置：
  - 图片点阵新增 `image-generating-grid-breathe`（1.3s，透明度 0.16↔1、缩放 0.94↔1.05）；
  - 视频/音频呼吸加快并加大幅度（背景 1.8s、点阵 1.3s，明暗 0.16↔1）；
  - 文字节点新增 `.text-node-generating` 覆盖层（复用同一背景与点阵，pointer-events:none 不挡操作），`data-textGenerating/submitting` 时显示。
- 验证：m2-image/video/audio/text + m84 共 24 项全过；tsc/build 通过；两帧截图确认点阵明暗差异明显、四类节点均有。
