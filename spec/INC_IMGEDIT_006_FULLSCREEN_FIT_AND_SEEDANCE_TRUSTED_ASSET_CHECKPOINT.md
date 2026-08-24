# INC-IMGEDIT-006 图片全屏完整适配与 Seedance 可信素材 Checkpoint

> 更新时间：2026-08-24
>
> 当前阶段：`R11_COMPLETE_USER_PASS`
>
> 当前结论：v0.6.38已完成GitHub、schema40生产发布和零付费生产浏览器门。全屏技术验收通过；唯一授权的真实H5会话创建返回503并以`CREATE_FAILED`收口，因创建预算`1/1`且远端副作用未知没有重试，未进入Asset创建。用户已在生产实页明确回复“通过”，当前为`PRODUCTION_PUBLISHED_USER_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / USER_PASS`；用户验收不改写真实协议失败。

## 1. 实时身份

- 仓库：`/Users/mymy/Documents/unboundry/app`
- 隔离工作树：`/private/tmp/unboundry-inc006-v0.6.38-2026-08-24`
- 分支：`codex/inc-imgedit-006-v0.6.38-2026-08-24`
- 起点 HEAD：`349a9157947aa3f65164d433376507982bac681d`
- `origin/main`：`349a9157947aa3f65164d433376507982bac681d`
- 起点 package：`0.6.37`
- 起点 schema：`39`
- Node/npm：`22.23.1 / 10.9.8`
- 方案文件：661行，SHA-256 `972f47931e127f2dd549ce6411673d477e0a772e6dba843bb7baf216a09f990c`
- 受保护文件：只允许在原工作树 `git status` 看到；本工作树不得读取、修改、暂存、提交、复制、删除或改名。

## 2. 版本、生产与发布门

- 版本门：`v0.6.38 / VERSION_GATE_VALID`
- 发布门：用户明确给出“允许发布：v0.6.38 上线”，状态 `RELEASE_GATE_VALID`
- R0核对：本地tag、远端tag和GitHub Release均不存在 `v0.6.38`
- 当前生产：`v0.6.38 / schema40 / live / ready active`
- 当前release：`/opt/unboundry/releases/v0.6.38-inc-imgedit-006-20260824`
- 当前用户层：`USER_PASS`；用户于2026-08-24在生产实页明确回复“通过”，覆盖全屏完整显示与Seedance失败态的准确呈现。

## 3. R0 能力分流

```text
ACTIVE_BRANCH=A
OFFICIAL_API_CONTRACT=CONFIRMED
ACCOUNT_ENTITLEMENT=CONFIRMED
CONTROL_REQUEST_AUTHORIZATION=VALID
PURCHASE_REQUIRED=NO
```

证据边界：

- 当前profile为账号级 `platform_cn-beijing_accountwide`，实名认证为个人已验证；正式Assets API文档确认AK/SK、`ServiceName=ark`、`Version=2024-01-01`和 `cn-beijing` 合同。
- 当前账号真实只读权益返回Assets/Asset Groups/shared pool总额各50、已用0、剩余50、write QPM 3；`aigc_readable=true`、`liveness_readable=true`、`liveness_writable=true`。
- 官方合同确认H5授权会话、Group、Asset创建与查询正式Action；不得复制ComfyUI私有代理。
- 生产 `volcengine-ark` Provider配置元数据有效，已发布Seedance 2.0 Mini；正式控制面使用服务端AK/SK，不使用客户端或普通ARK API Key冒充。
- 不输出、不记录、不返回任何完整密钥或完整账号标识；账号、地域、项目、owner和source checksum仍须在R4合同与R5A实现中严格隔离。

## 4. Provider请求与费用账本

| 项目 | 已用/上限 | 说明 |
|---|---:|---|
| 权益、能力和接口只读核对 | `1/10` | `GetAssetQuota`等价稳定产品命令，只读成功 |
| H5授权会话创建 | `1/1` | 生产唯一一次创建返回HTTP503；本地会话`FAILED/CREATE_FAILED`，未返回H5 URL；不重试未知副作用写请求 |
| H5会话状态查询 | `0/60` | 未执行 |
| Asset创建 | `0/1` | 未执行 |
| Asset状态查询 | `0/120` | 未执行 |
| 发布前/提交前最终只读核验 | `0/5` | 未执行 |
| Provider控制面总计 | `2/200` | 权益只读1 + H5创建1；未突破分项或总上限 |
| 付费生成尝试/成功/费用 | `0/0/0` | 固定为0 |
| Seedance视频/图片/音频生成 | `0/0/0` | 固定为0 |
| OSS写入 | `0` | 全Goal真实协议与生产浏览器均为0 |
| 购买/新账号/云权限或套餐修改 | `0/0/0` | 永久禁止 |

## 5. 阶段状态

| 阶段 | 状态 | 已有证据/退出条件 |
|---|---|---|
| R0 | `AUTO_PASS` | Git、生产、版本、正式API和账号权益已核对；Checkpoint、矩阵、TASKS同步且`git diff --check`通过 |
| R1 | `EXPECTED_RED_COMPLETE` | safe m2 13项执行，11通过/2预期失败：1086×1448图片bottom=1237而viewer bottom=699；旧“Seedance 素材校验”菜单仍为1项 |
| R2 | `TARGETED_AUTO_PASS` | Grid行、viewer双轴与img最小尺寸根因修复；safe m2全屏/透明及其余既有用例12项通过，唯一失败为R3预留旧Seedance入口 |
| R3 | `TARGETED_AUTO_PASS` | 图片旧入口与旧请求均为0；旧记录摘要永远注明非方舟远端；Video Seedance参考图自动附带local-technical-preflight |
| R4 | `TARGETED_AUTO_PASS` | schema40 Group/Asset/Session分表、组合外键、owner查询、稳定账号指纹、幂等upsert与五条OpenAPI路径已冻结；safe m100+m20 14/14通过 |
| R5A | `TARGETED_AUTO_PASS` | 仅允许CreateVisualValidateSession/GetVisualValidateResult/CreateAsset/GetAsset；V4签名、A分支状态映射、10秒上限、QPM门、身份锁与脱敏错误fake通过 |
| R5B/R5C | `NOT_APPLICABLE_CURRENT_BRANCH` | 仅保留能力降级合同，不作为当前实现分支 |
| R6 | `TARGETED_AUTO_PASS` | owner/source/profile/account/region/project/checksum与远端Active共同构造可信引用；伪造asset://、错账号、失效、旧快照均在生成Provider边界前拒绝 |
| R7 | `TARGETED_AUTO_PASS` | modal入口、A分支授权/处理/Active、错误状态、刷新恢复、双击幂等、三视口与零外网矩阵通过 |
| R8 | `SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS` | 唯一safe full原始1053/1055；两个精确合同遗漏修正后m10+m9 18/18，未重复full |
| R9 | `COMPLETE` | tag`v0.6.38`、PR #87、Quality CI SUCCESS、merge`1a1756a`、GitHub Release完成；tag/main-at-merge tree均`c8e1e19` |
| R10 | `PRODUCTION_PUBLISHED_AUTO_PASS / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED` | 双备份、schema39→40副本演练、旧runtime拒绝且不改写、fresh build、原子切换和生产技术门通过；唯一H5创建真实请求失败后停止，未创建Asset |
| R11 | `PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_PASS` | 三视口全屏几何、详情、A分支失败诚实呈现、console和零生成/零OSS门通过；用户已在生产实页明确回复“通过” |

## 6. 验收状态

- `IMGEDIT-039 = PRODUCTION_VIEWPORT_PASS / USER_PASS`；`IMGEDIT-040 / 042 / 043 / 044 / 045 = TARGETED_AUTO_PASS`并已随schema40生产发布；`IMGEDIT-041 = ACTIVE_BRANCH_A / REAL_CREATE_FAIL_CLOSED`；`IMGEDIT-046 = PRODUCTION_PUBLISHED_USER_PASS / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / USER_PASS`。
- 自动、浏览器、Provider协议、生产技术和用户主观验收继续分层；本次`USER_PASS`来自用户明确生产实页确认，不得扩张为`PROVIDER_PROTOCOL_REAL_PASS`。

## 7. 测试与浏览器证据

- R1命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts`；Node22.23.1/npm10.9.8，13项中11通过、2项预期失败，退出1。
- 全屏失败：1086×1448素材的渲染bottom为1237，viewer bottom为699，精确证明下半部分被边界裁掉。
- Seedance失败：期望旧“Seedance 素材校验”入口为0，实际仍为1，精确证明本地预检仍以可信素材校验产品语义出现。
- source/snapshot同为`ad7aff0cce84ba1ff4bc1c050521bc0e407b8a9d3694f7b0104d3bcfdbdc1789`，4173 listener unchanged；Provider/Generation/OSS/费用0。
- 测试库存随两项直接红证据由1053增至1055，并同步safe runner及source coverage manifest；最初两次尝试分别在缺本地依赖和manifest同步门停止，产品spec均未执行，不记作产品结果。
- R2同一safe m2执行13项，12项通过，唯一失败是R3预留的旧“Seedance 素材校验”入口；全屏新矩阵覆盖1086×1448、3:4、9:16、16:9、1:1、超宽图×1280×720/1440×900/1728×900，全部四边在viewer内且比例不变。
- 长提示词形成内部滚动且图片几何逐字不变；透明棋盘格只在img border box，viewer无棋盘格；全屏下载字节与原始透明PNG逐字节相等。source/snapshot`e104f1d82248418fc67505edd85da4a320c3e193c25c22640670c1de2a70ada4`，4173 unchanged，Provider/OSS/费用0。
- R3 safe m100+m2+m30合计`35/35 PASS`、退出0；旧入口、旧panel和旧HTTP请求为0，旧记录摘要明确“不代表方舟可信素材或真人授权”；Seedance视频参考图由现有输入解析自动产生`scope=local-technical-preflight`，该状态不进入可信Asset或task snapshot。source/snapshot`378e9526044fe266db472f34e5269571d77eefe383c5c326468d8161e4a26b5d`，4173 unchanged，Provider/OSS/费用0。
- R4新增schema40三表及精确物理schema合同；Group/Session/Binding分别保存，组合外键绑定owner、profile、稳定账号指纹、地域和项目，Binding另绑定`image + asset id + checksum`。H5完整URL仅允许创建响应一次性返回，status DTO与数据库均无该字段，摄像头/活体/人脸/密钥不落库。
- R4新增五条OpenAPI路径与2KiB绑定请求上限，创建返回202，读取严格owner scope；客户端DTO不返回Provider账号指纹、Group/Session/Asset内部标识。稳定账号指纹不包含可轮换AK/SK，Group/Session/Asset幂等键由owner/profile/account/region/project/source共同派生。
- R4 build通过；最终safe m100+m20=`14/14 PASS`、退出0，fresh schema40精确合同、FK、Group幂等复用、跨owner不可读、无持久H5 URL及OpenAPI隐私断言通过。source/snapshot`c505e70f07b0cc7ee4a633c7b13de4baa6ba1f5fcfafb13210e5d594f0288f03`，4173 unchanged，真实Provider/Generation/OSS/费用0。
- R5A复用既有方舟V4签名、固定`Service=ark / Version=2024-01-01 / region=cn-beijing`，新增严格四Action allowlist；H5创建只返回一次短期HTTPS链接并保存不透明BytedToken，认证结果只接受匹配Group ID，Asset只接受服务端准备的HTTPS图片URL并轮询到Active。
- R5A适配器把Pending/Processing/Active/一致性失败/撤销/删除/过期映射到冻结状态机；profile/account/region/project变化在请求前失败，QPM默认3，单请求最长10秒，AK/SK和远端详情继续由既有响应扫描与固定错误屏蔽。build通过；safe m42=`15/15 PASS`、source/snapshot`be3b5f87b6c514517f21742c3dc90fdb1f3581c20b849a50552d009bd401d62c`，4173 unchanged，真实Provider/Generation/OSS/费用0。
- R6新增应用编排：H5链接只在首次POST返回，重复点击复用同一session；真人授权完成后绑定同一owner/profile/account/region/project/source checksum创建Asset，Provider URL仅来自owner-scoped短期签名引用，远端不确定结果不自动重复创建。
- Ark视频媒体引用升级为`inline-data / public-url / trusted-asset`判别联合；`asset://`只由服务端用已持久Binding构造，普通HTTPS/Data URL保持原路径。任务快照冻结binding ID、profile、Provider Asset ID、source checksum、checkedAt和角色；初次提交与实际Provider提交前都重新核验远端Active，身份/校验和/过期/撤销/删除/伪造快照均fail-closed。
- R6 build通过；safe m100+m16+m20+m5=`46/46 PASS`、退出0，测试库存仍为120 specs/1055 tests，architecture76既有例外且新增0，source/snapshot`c0266eaa022251a063c10ecfb688f9392815bc9064ec7e5d3438fe7a2b41592b`，4173 unchanged，真实Provider/Generation/OSS/费用0。
- R7新增图片更多菜单“角色可信素材”入口，使用共享modal Host与inert/focus/Escape合同；A分支同步预开H5页面避免异步弹窗被拦，客户端与服务端共同防重复，sessionStorage只保存不透明session ID用于同页刷新恢复，完整H5 URL仍不落库也不进入状态读取。
- 状态UI从共享状态机显示等待、处理中、Active、拒绝、过期、撤销、删除、来源变化和失败；当前方舟账号免责声明固定显示，A/B/C文案不冒充能力，面板不显示预计金额。自动轮询改为20秒以服从write QPM3；Asset Processing由服务端后续只读inspect推进到Active，不会停在创建响应。
- R7首轮稳定m2为`11/13`，精确暴露关闭按钮定位歧义与新增第8行仍沿用272px旧菜单高度；修正后m2 `13/13 PASS`。最终build通过，safe m100+m2+m20=`27/27 PASS`、退出0，source/snapshot`f22637b7e76184207552213434ba7cf1bd826c71586399432a87f975daf2d0d1`，architecture新增例外0、4173 unchanged，自动化真实Provider/Generation/OSS/费用0。
- R8只读审查发现Active绑定读取仍可能只信本地旧状态，已改为用户主动读取时重新执行Provider只读inspect；远端错误直接显式失败，不再吞错并保留伪绿。m100精确断言Active读复核与生成边界再次复核，最终受影响批次通过。
- schema40发布审查发现备份、媒体完整性、exact-v0.5.1 attestation、one-shot迁移、最终候选恢复、Linux生产验证和合成发布切换仍有schema39时代常量。已同步schema40支持、三张新表逻辑指纹、40迁移失败回滚checkpoint、final/bridge rollback合同与source coverage哈希；没有绕过历史schema37/38/39兼容。
- 首轮schema40诊断批次原始为`35/56 PASS`，第二轮为`45/48 PASS`，失败均精确落在上述旧版本常量与三张新表断言；修正后m10+m92 `19/19 PASS`、source/snapshot`f4ad5418…11ffb`，m81+m88+m91+m95 `90/90 PASS`、source/snapshot`a3c12005…898fb`，新增schema40 checkpoint精确复验m91 `8/8 PASS`、source/snapshot`8a70ffaa…90b2f`。诊断失败保留为原始事实，不改写为全绿。
- R8版本字段已同步为package/lock `0.6.38`、final runtime allowlist含0.6.38、当前schema40；P0/P1只读审查无剩余。真实Provider、Generation、OSS、费用和生产写入仍为0，控制面账本仍`1/200`。
- 本Goal唯一一次safe full在冻结提交`d5c5840413d5b2ebe4f60ab270e4817a273cc743`执行120 specs/1055 tests，原始`1053/1055 PASS`、退出1；blocked/skipped/retries/reportErrors均0，source/snapshot`7798d77ec41581d437523b96f5b10b98be5297589eb1d0c1418c180a05784d0f`，4173 unchanged。
- full两个失败均为新增合同覆盖遗漏：m10的迁移子进程错误白名单缺`SCHEMA_MIGRATION_FAILED_SCHEMA40_APPLY`；m9旧正则把客户端合法的`AuthorizationSession/authorizationUrl`产品语义误判为发送Authorization凭据。前者补入精确白名单，后者收紧为实际HTTP header/Bearer发送形态且继续保留运行时出站header断言。
- 只复验直接失败的m10+m9，最终`18/18 PASS`、退出0，source/snapshot`ad6bc903eea8af495481b50193d309593642963020f229672db8516e6c760dd3`，4173 unchanged。按Goal与测试重复控制没有运行第二次full；原始full不改写为全绿。
- R8收口`LOCAL_ENGINEERING_COMPLETE / P0_P1_REVIEW_PASS / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS`；真实Provider/Generation/OSS/费用0，生产未改。
- R8治理提交`34893db135cc11a2664ed4c120a2634465aa1120`后只复验m38=`15/15 PASS`、退出0，source/snapshot`7c05244de80fd3a2d6bc817febd5975338785a653a1fa361e821d6b9a579e8aa`，4173 unchanged；文档结果同步不触发业务测试重跑。
- 自动化必须使用Node22.23.1/npm10.9.8、fresh临时data/runtime/cache和动态loopback端口，禁止4173、生产数据、真实Provider、真实OSS和任何付费生成。
- R9冻结候选`ff8b80c0628f94ecf1b5cf7bdb8445433aed8a6c`/tree`c8e1e19b55cac6e50150cf2ee2160234d5a33726`，注释tag对象`c2efd0187adc0c808c7b3a2caba34f317314f579`；PR #87 Quality run`32723496747`/job`97419689399` SUCCESS，squash merge`1a1756ae98138d8885d9043ca93d81e4d4ade67b`，GitHub Release已发布。
- R10 fresh生产包SHA`20ab54b58d608e1f83a8d321fb01ae7d0bf9147cc393cecdc6674e33d4a85e9e`；第一次build因npm子进程继承系统Node18在Vite前失败，固定`PATH=/opt/node22/bin`后同源码typecheck/build通过。inventory 5942行/5943文件，SHA`afb607703c3b8a8ae772f1983f760a7dc54367548b190358750920f285fcffa3`。
- schema40副本演练通过integrity/FK0，新三表0/0/0；v0.6.37对迁移副本在writer前失败且数据库SHA保持`e998135a…44cd`。切换冻结source/restore各366文件、双清单`5ebe6ef5…b7a7`；生产迁移在停服且4173无监听时于单个`BEGIN IMMEDIATE`完成，切换后NRestarts0。
- 发布前后既有计数保持tasks785、attempts793、active0、media817/1478854132 bytes、publication407/active0、canvas63、templates50/48、Library2；新三表在真实请求前均0。公网与回环均v0.6.38/live/ready active/schema40，5项公网资源逐字节等于release。
- 唯一H5创建真实请求后新三表各1行：group保持`NOT_STARTED`，session为`FAILED/CREATE_FAILED`且无Provider session ID，binding未创建远端Asset。账本因此为权益1、H5创建1、其余0、总2/200；付费生成、Generation task/attempt增量和OSS写入均0。
- R11生产浏览器三视口几何：444×818自然比`0.542787`，渲染比`0.542786/0.542778/0.542778`且四边均在viewport内；755×1332自然比`0.566817`、渲染比`0.566808`，`object-fit:contain`且四边完整。详情字段、旧本地预检免责声明、modal inert、A分支未核验/失败态与console 0 error/warn通过。
- R11发布回执同步后的治理复验诚实保留三步：错误selector在选择阶段0产品测试；首次有效m38为`14/15`，发现测试仍把当前生产写死为schema39；改成从权威生产标记动态读取后第二次`14/15`，继续发现三份渐进治理文档顶部仍为`CURRENT_V0_6_37_USER_RECHECK`。精确同步AGENTS与三份治理头后最终m38 `15/15 PASS`、退出0，source/snapshot`08ab2c7ee3e579f5f509dc8abbdee322fd4afdcab0ad64d421645a839a235142`，4173 unchanged；未改发布tag内产品runtime，未运行第二次full。
- 用户明确通过后的权威文档同步只运行m38治理定向，最终`15/15 PASS`、退出0，source/snapshot`1a1a92174ce07a74dc73fbdb944f9f21ac0fa3842742ecd5338980facd35a05a`，4173 unchanged；没有产品runtime改动、full、Provider请求或生产写入。

## 8. GitHub、生产、阻断与回滚

- GitHub：注释tag `v0.6.38`→`ff8b80c`/tree`c8e1e19`；PR #87 Quality CI SUCCESS后合并为`1a1756a`，merge时main tree与tag tree一致；GitHub Release已发布。
- 生产：fresh artifact SHA-256`20ab54b5…a85e9e`，release inventory`afb60770…cffa3`；current已原子切到`/opt/unboundry/releases/v0.6.38-inc-imgedit-006-20260824`。公网/回环version、live、ready、service、schema40、integrity/FK、Library、数据计数和5项静态资源均通过。
- 备份与回滚：副本演练备份`/var/lib/unboundry-rollbacks/v0.6.38-frozen-z7c9W6`；切换冻结备份`/var/lib/unboundry-rollbacks/v0.6.38-cutover-frozen-hoN2aM`，source/restore各366文件且双清单SHA`5ebe6ef5…b7a7`。v0.6.37对schema40副本在writer前拒绝且数据库SHA不变；旧release和两份备份均保留。
- Provider真实协议：唯一H5创建已消费`1/1`并返回应用HTTP503，session为`FAILED/CREATE_FAILED`且没有Provider session ID或H5 URL；远端副作用未知，按合同不重试。Asset创建/查询、最终读、视频/图片/音频生成、付费和OSS写入均0。
- 生产浏览器：目标项目`v0.6.34 图片工具技术冒烟副本 2026-08-23`；444×818图片在1280×720、1440×900、1728×900均四边在viewport内、`object-fit:contain`且渲染比例等于自然比例；755×1332第二竖图同样通过。角色可信素材modal准确显示未关联/远端未核验，创建失败后没有伪Active，console error/warn 0。
- 当前阻断：真实可信素材协议被唯一H5创建失败阻断；因为创建预算已耗尽且写请求副作用未知，本Goal不得继续重试或进入Asset阶段。全屏与生产发布不受该外部协议失败影响。
- 回滚点：上一不可变release`/opt/unboundry/releases/v0.6.37-inc-imgedit-005-20260824`与切换冻结备份完整保留；本次没有触发回滚。

## 9. 收口

用户已在已发布的v0.6.38生产实页明确回复“通过”，INC-IMGEDIT-006用户层正式收口为`USER_PASS`。本Goal不再发起任何Provider控制面写请求；唯一H5创建失败仍保持`PROVIDER_PROTOCOL_REAL_FAIL_CLOSED`。
