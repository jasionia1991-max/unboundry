# INC-IMGEDIT-006 图片全屏完整适配与 Seedance 可信素材 Checkpoint

> 更新时间：2026-08-24
>
> 当前阶段：`R1_IN_PROGRESS`
>
> 当前结论：R0已以当前账号真实权益和官方正式接口冻结 `ACTIVE_BRANCH=A`；R1只补全屏裁切和旧Seedance伪校验红证据，红证据成立前不改产品实现。

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
| R1 | `IN_PROGRESS` | 1086×1448裁切与旧伪校验精确红证据 |
| R2 | `NOT_STARTED` | 六类素材、三视口双轴完整与透明矩形 |
| R3 | `NOT_STARTED` | 旧预检仅历史语义，视频节点自动本地预检 |
| R4 | `NOT_STARTED` | Group/Asset/Session、schema、API、OpenAPI、隐私和幂等合同 |
| R5A | `NOT_STARTED` | 正式Provider adapter及fake合同；本Goal冻结A分支 |
| R5B/R5C | `NOT_APPLICABLE_CURRENT_BRANCH` | 仅保留能力降级合同，不作为当前实现分支 |
| R6 | `NOT_STARTED` | asset://服务端可信引用、任务恢复与失效门 |
| R7 | `NOT_STARTED` | UI、错误、刷新、幂等、三视口浏览器矩阵 |
| R8 | `NOT_STARTED` | 候选冻结、独立只读审查、唯一一次safe full |
| R9 | `NOT_STARTED` | v0.6.38 GitHub交付 |
| R10 | `NOT_STARTED` | 备份、必要迁移、fresh build、生产与真实控制面协议验收 |
| R11 | `NOT_STARTED` | 生产零付费浏览器、回执、`USER_RECHECK` |

## 6. 验收状态

- `IMGEDIT-041 = R0_AUTO_PASS / ACTIVE_BRANCH_A`；`IMGEDIT-039 / 042 = R1_IN_PROGRESS`；其余仍为 `NOT_STARTED`。
- 自动、浏览器、Provider协议、生产技术和用户主观验收必须分层，任何Agent不得写 `USER_PASS`。

## 7. 测试与浏览器证据

- R0仅执行只读身份与能力核对，尚未运行产品spec、浏览器验收或safe full。
- 本Goal唯一一次safe full保留给R8冻结候选；文档同步不触发业务全量测试。
- 自动化必须使用Node22.23.1/npm10.9.8、fresh临时data/runtime/cache和动态loopback端口，禁止4173、生产数据、真实Provider、真实OSS和任何付费生成。

## 8. GitHub、生产、阻断与回滚

- GitHub：未push、未创建PR、未merge、未tag、未创建Release。
- 生产：R0仅只读，无生产写入；生产仍为v0.6.37/schema39。
- 当前阻断：无。A分支权益已确认；后续若身份、地域、项目或正式合同不能严格绑定，必须fail-closed，不得退化为伪可信状态。
- 回滚点：工程施工起点为 `349a9157947aa3f65164d433376507982bac681d`；生产回滚点仍为现行v0.6.37 release。尚无schema或生产变更。

## 9. 唯一下一动作

只补1086×1448全屏裁切与旧Seedance伪校验的精确失败证据；在两项红证据成立并落档前不修改产品实现。
