# INC-IMGEDIT-006 图片全屏完整适配与 Seedance 可信素材 Checkpoint

> 更新时间：2026-08-24
>
> 当前阶段：`R8_COMPLETE_R9_READY`
>
> 当前结论：R8只读P0/P1审查与本Goal唯一一次safe full已执行；full原始`1053/1055`，两个精确合同遗漏已修正并定向`18/18 PASS`，没有重复full。v0.6.38候选进入R9 GitHub交付门。

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
- 当前生产：`v0.6.37 / schema39 / live / ready active`
- 当前release：`/opt/unboundry/releases/v0.6.37-inc-imgedit-005-20260824`
- 当前用户层：v0.6.37历史状态保持 `USER_RECHECK`；INC-IMGEDIT-006不得继承旧PASS。

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
| H5授权会话创建 | `0/1` | 未执行 |
| H5会话状态查询 | `0/60` | 未执行 |
| Asset创建 | `0/1` | 未执行 |
| Asset状态查询 | `0/120` | 未执行 |
| 发布前/提交前最终只读核验 | `0/5` | 未执行 |
| Provider控制面总计 | `1/200` | 未突破分项或总上限 |
| 付费生成尝试/成功/费用 | `0/0/0` | 固定为0 |
| Seedance视频/图片/音频生成 | `0/0/0` | 固定为0 |
| OSS写入 | `0` | R0无写入 |
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
| R9 | `READY` | v0.6.38 GitHub交付 |
| R10 | `NOT_STARTED` | 备份、必要迁移、fresh build、生产与真实控制面协议验收 |
| R11 | `NOT_STARTED` | 生产零付费浏览器、回执、`USER_RECHECK` |

## 6. 验收状态

- `IMGEDIT-039 / 040 / 042 / 043 / 044 / 045 = TARGETED_AUTO_PASS`；`IMGEDIT-041 = R0_AUTO_PASS / ACTIVE_BRANCH_A`；`IMGEDIT-046`仍为 `NOT_STARTED`。
- 自动、浏览器、Provider协议、生产技术和用户主观验收必须分层，任何Agent不得写 `USER_PASS`。

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
- 自动化必须使用Node22.23.1/npm10.9.8、fresh临时data/runtime/cache和动态loopback端口，禁止4173、生产数据、真实Provider、真实OSS和任何付费生成。

## 8. GitHub、生产、阻断与回滚

- GitHub：未push、未创建PR、未merge、未tag、未创建Release。
- 生产：R0仅只读，无生产写入；生产仍为v0.6.37/schema39。
- 当前阻断：无。A分支权益已确认；后续若身份、地域、项目或正式合同不能严格绑定，必须fail-closed，不得退化为伪可信状态。
- 回滚点：工程施工起点为 `349a9157947aa3f65164d433376507982bac681d`；生产回滚点仍为现行v0.6.37 release。尚无schema或生产变更。

## 9. 唯一下一动作

提交R8精确修正与治理收口，定向复验m38后进入R9：push分支、创建不可变注释tag v0.6.38、PR/CI/merge与GitHub Release。
