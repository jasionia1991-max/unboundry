# INC-GEN-019 实施断点

状态：`R0_R7_COMPLETE / R7_FORMAL_FULL_RECORDED_WITH_TARGETED_CLOSURE / R8_VERSION_V0_6_65_VALIDATED / ZERO_NEW_TASK_ADMISSION_ATTEMPT_PROVIDER_POST / USER_RECHECK`

更新时间：2026-08-31T21:05:00+08:00

## 1. 当前结论

- 用户已在本 Session 显式启动 INC-GEN-019 一次性 Goal；Goal 工具状态为 active，墙钟起点为 `2026-08-31T17:56:51+08:00`，总硬门为 6 小时。
- 唯一实施 checkout 为 `/Users/mymy/Documents/unboundry-inc-gen-016-v0.6.56-2026-08-28`。已从实时 `origin/main@86685471092941a31c30621233b9238ce6b1c393` 建立分支 `codex/inc-gen-019-group-admission-2026-08-31`；候选 package=`0.6.65`，本机 Node/npm=`25.9.0/11.12.1`。
- 生产实时为 `/opt/unboundry/releases/v0.6.64-inc-gen-018-20260831`、version=`0.6.64`、schema=`41`，service active/running/enabled、MainPID=`2859331`、NRestarts=`0`，Node/npm=`22.23.2/10.9.8`；公网 `/api/version`、`/api/health/live`、`/api/health/ready` 通过。
- R0 只读基线为 tasks=`1026`、admissions=`946`、attempts=`1037`、paid Provider requests=`1025`、active=`0`、current unknown=`0`、media=`956`、publications=`547`。本 Goal 新增 task/admission/attempt/Provider POST/OSS/费用均为 `0`。
- R1～R7 已完成；唯一 independent Review 线程已消费，初始冻结候选和 formal 后唯一产品增量均给出 `P0=0/P1=0/P2=0/GO`。本事件唯一 formal full 已消费并永久保留原始 `1133/1135`；两个失败已用最小集合 `62/62` 关闭，未运行第二次 full。v0.6.65 四个版本身份文件已同步且版本直接门 `m81+m38=57/57 PASS`；GitHub、发布、生产写和真实 Provider 点击均未执行。

## 2. 冻结的真实失败证据

- 日志窗口：`2026-08-31T17:09:45+08:00`～`17:10:30+08:00`。
- 请求顺序：preflight `200/4149ms` → formal admission `409/5003ms` → preflight `200/4166ms` → formal admission `409/2486ms`。
- 同窗口 Canvas PUT=`34`，延迟 min/p50/p95/p99/max=`7/8/26/36/36ms`；preflight 样本 p50/p95/p99=`4149/4166/4166ms`；formal 409 样本 p50/p95/p99=`2486/5003/5003ms`。
- 目标 Canvas 最终 revision=`95`、graphRevision=`62`、saveSequence=`66`、nodes=`53`、edges=`98`、updatedAt=`2026-08-31T09:10:19.867Z`，脱敏全图 digest=`431d9ee74e41c0b8789457f73f292efa66a69c9b7ea4f9fa172acea9ec7418cd`。
- 失败点击后 tasks/admissions/attempts/Provider POST 均未增加，证明两次 409 均在付费准入前 fail-closed。
- R2 使用一个集中式 monotonic deadline，初始冻结为 `30_000ms`：覆盖 save/quiet/preflight/confirm/formal POST/revision retry；依据为两轮最坏实测约 `2 × (4.166s + 5.003s)` 加保存确认与约 10 秒安全余量。R1 fake clock 将直接验证不产生嵌套 deadline。

## 3. 生产模型与目标 group 身份

- 生产 published model denominator=`10/10`，全部 binding enabled、未 revoked；exact identity 脱敏 digest=`fbae1e71515eba951add7b2cf191ad754341938567b82347c196782400de9405`。
- Provider/协议分母：`volcengine-ark/native`、`multi-protocol-relay/media-generate`、`multi-protocol-relay/gpt-image`、`mureka/native`；能力分母 text/image/video/audio。
- 目标 Canvas：`3b3cb4f8-56c3-49f5-ad42-1a00748ba33a`。
- 目标 group：`group-736e7a8d-be5e-48f7-8927-8a2d6b92f46a`。
- exact executable allowlist=`11`，依赖边=`22`，唯一 root=`text-d4c47a06-c82e-43eb-bc59-ab24d218b90a`，脱敏 allowlist+dependency digest=`dbb2d0aa9010f0a994a8cce2244238d5fb1b10a5b35f5d758c1c9a084ef24da0`。

| logical node | kind | model | driver/protocol |
| --- | --- | --- | --- |
| `text-d4c47a06-c82e-43eb-bc59-ab24d218b90a` | text | `ee51d65e-c924-4a9a-b224-6c4ee180a0ce` | volcengine-ark/native |
| `image-f1483481-1d7b-44c4-8263-6c87e90af5ed` | image | `cbaf438c-1c36-48e2-807d-4ce78367d0cf` | multi-protocol-relay/gpt-image |
| `text-695c78a0-e212-4ed1-9cc8-e13911fc584d` | text | `ee51d65e-c924-4a9a-b224-6c4ee180a0ce` | volcengine-ark/native |
| `text-b1f2bc1d-05a3-4b40-8341-d2b96a976243` | text | `ee51d65e-c924-4a9a-b224-6c4ee180a0ce` | volcengine-ark/native |
| `text-b8e0eda7-bf00-44b0-8e0f-d7291be2d8d6` | text | `ee51d65e-c924-4a9a-b224-6c4ee180a0ce` | volcengine-ark/native |
| `text-eea25fa5-d1e2-4c0d-aeb5-37b38c4cfd6b` | text | `ee51d65e-c924-4a9a-b224-6c4ee180a0ce` | volcengine-ark/native |
| `image-b9c3bb60-0c76-4a4f-8928-0305bd0438cd` | image | `cbaf438c-1c36-48e2-807d-4ce78367d0cf` | multi-protocol-relay/gpt-image |
| `image-bb59fbfe-9287-4b44-a343-0c034e2668a3` | image | `cbaf438c-1c36-48e2-807d-4ce78367d0cf` | multi-protocol-relay/gpt-image |
| `text-8c3774d2-0b6d-4dc1-80dd-b3c07e851948` | text | `ee51d65e-c924-4a9a-b224-6c4ee180a0ce` | volcengine-ark/native |
| `video-46188a0b-3045-469d-aa9f-860805d4ccb3` | video | `624827c6-5541-4cc8-93ac-4f9d5ce79602` | multi-protocol-relay/media-generate |
| `text-3cc0f6de-9f9d-4c4f-9e49-4ddc583985b7` | text | `ee51d65e-c924-4a9a-b224-6c4ee180a0ce` | volcengine-ark/native |

依赖图：

```text
text-d4c -> image-f148, text-695c, text-b1f2, text-b8e0, text-eea2, text-8c37, text-3cc0
image-f148 -> image-b9c3, image-bb59, text-695c, text-b1f2, text-b8e0, text-eea2, video-4618
text-695c -> image-bb59
text-b1f2 -> text-8c37, video-4618
text-eea2 -> image-b9c3
image-b9c3 -> text-3cc0
image-bb59 -> text-3cc0
text-8c37 -> text-3cc0
video-4618 -> text-3cc0
```

- 生产 profile 的三项 GPT Image 单 task `max_cost_microunits` 安全上限合计为 USD 30，属于允许单任务的配置硬顶而不是可靠实际报价；其保守折算 CNY 300 高于本 Goal CNY 100 上限。真实点击前必须从零 Provider preflight/当前价格合同取得可靠逐节点 estimate 并证明 `CNY + 10×USD <= 100`，否则在点击前停止；当前真实提交权限保持未消费。

## 4. 阶段、预算与访问纪律

### R1～R5 实施与定向证据

- 旧代码稳定红：safe m22 库存 `122 specs / 1135 tests`，执行 `44` 项为 `43 PASS / 1 EXPECTED_RED`；生产形状 fake 精确得到两轮 `preflight 200 → formal 409`、两个不同 key、首节点失败、10 个下游 blocked、task/admission/attempt/Provider POST 全为 0。
- writer 归因完整复现 `53 nodes / 98 edges / 34 Canvas PUT`：`33` 次为已挂载节点的旧 generation binding 逐节点 durable reconciliation，`1` 次为 root workflow model-contract normalization，`other=0`。34 次均为不同字段补丁、observedRevision/saveSequence 单调，不是同 fingerprint no-op，因此未修改全局 Canvas writer；既有 fingerprint 抑制继续保护真正 no-op。
- 客户端现在以单个 monotonic `30_000ms` deadline 覆盖 group admission：preflight 返回 revision 必须为安全整数且等于请求 revision；preflight network/5xx 只重做零付费 preflight；确定性 `CANVAS_NOT_SAVED` 先 exact-key lookup，为空且语义未变才同 key 重取 revision；formal 请求一旦开始后超时按 unknown outcome 只 reconcile 原 key，绝不二次 POST。
- 服务端事务 revision fence、任务/准入/Provider 边界、accepted-only binding/refresh/recovery、DATA-005、四类节点共享 port 均未放宽。deadline、cancel、semantic change、business reject 与 unknown outcome 保持不同 reason。
- 定向证据：m40=`17/17 PASS`；m22=`44/44 PASS`；m2+m33+m41+m85+m100=`117/117 PASS`；最后受 deadline 传播直接影响的 m100+m22+m40 为 `76` 项，其中首次 `75/76` 仅暴露测试误把成功后的正常一次持久化当重试写，收窄断言后 m22 `44/44 PASS`。补齐 formal deadline 单 POST/原 key reconcile、250ms 有界 preflight backoff 与准确的 `PREFLIGHT_TIMEOUT` 文案后，最终 m22 仍为 `44/44 PASS`，source/snapshot=`06185cc6bf2a99701c29351bcc689d5b969ebc8ab623ab9f425d325b2ba4951d`；全部安全运行 retries/reportErrors=0、动态 loopback/temp、4173 unchanged。

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| R0 | COMPLETE | 身份、失败日志、实时生产计数、10-model denominator、11-node allowlist/依赖图已冻结 |
| R1 | COMPLETE | 旧代码稳定红；34/34 PUT 精确归因，other=0 |
| R2-R4 | COMPLETE | shared monotonic deadline、preflight revision 校验、同 key 收敛、unknown 原 key reconcile 与退出文案已实现 |
| R5 | COMPLETE | 直接依赖定向验证通过；唯一测试断言误判已最小关闭 |
| R6 | COMPLETE | 主线程与唯一独立代理覆盖10/10文件、62/62 hunks、完整调用链、10/10 published denominator、11个exact identities与全部4类Provider/protocol分支；初报P1经原代理重核撤回，P2文案已关闭，最终P0=0/P1=0/P2=0/GO；Review代理1/1 |
| R7 | COMPLETE | 唯一 formal full 1/1：原始1133/1135、2失败、0重试/跳过/blocked/reportErrors；最小m22+m36+m38=62/62关闭，未重跑full；同一Review线程复核增量P0/P1/P2=0/0/0、GO |
| R8 | IN_PROGRESS | v0.6.65身份与版本直接门通过；GitHub/发布/生产/真实流待执行；真实 group click 0/1，task/admission/attempt/POST/OSS 0/11，费用 0/100 CNY-equivalent |

- 产品+测试改动文件=`10/10`；产品代码 `247 insertions / 48 deletions`，净新增=`199/450`；schema/dependency=`0`。
- R7最终冻结身份：base HEAD=`86685471092941a31c30621233b9238ce6b1c393`；精确产品+测试 binary diff SHA-256=`9925eda31219fcaac4302d48f20c82f87d1b42ba3c0d810e0e791cf2a97d16ed`；hunks=`62`。候选现为`FROZEN / REVIEW_GO`，唯一 independent Review 线程与 formal full 额度均已消费。
- 唯一 formal full 原始证据：Node/npm=`22.23.1/10.9.8`，122/122 specs、1135 tests，`1133 PASS / 2 FAIL / 0 skipped / 0 retries / 0 blocked / 0 reportErrors`，source/snapshot=`ae7289ecdd89bf5dec8303fe2c5d536ce157bf0fff91cad16d7ff5e2dad41976`，4173 listener unchanged。失败一为 m36 业务拒绝 fake 缺新增 `canvasRevision`，失败二为 m38 发现三份当前治理标记仍为 v0.6.63；原始结果不得改写成全绿。
- 最小关闭证据：业务拒绝在正式 POST 前保留具体原因，只有 `canSubmit=true && canEnqueue=true` 的成功 preflight 才强制校验安全非负且精确相等的 revision；三份治理标记同步到 v0.6.64。safe m22=`44/44`、m36=`2/2`、m38=`16/16`，合计 `62/62 PASS`，失败/重试/跳过/reportErrors均0，source/snapshot=`18a991e92a79b4c809b33ae12ee5c71b2d7512a2876836133d36d518fccf9ca4`，4173 unchanged。一次错误的多 spec 命令在参数解析阶段即被拒绝，产品测试执行数为0；随后用正确 `run --spec` 完成上述最小集合。
- 初次身份命令使用了宽泛 `git status --short`，因此永久记录一次受保护 fixture **文件名枚举**；content/stat/hash/copy/edit/stage 均为 `0`。随后所有文件查询改为显式 allowlist，禁止把本 Goal 写成“受保护文件访问完全为 0”。
- 两份受保护 JSON 继续禁止 content/stat/hash/copy/edit/enumeration/stage/move/delete；本 Goal 不触碰它们。

## 5. 下一步

R8 版本身份只读门已通过并先行冻结：本地 tag `v0.6.65` 无匹配；`git ls-remote` 对精确 tag 与 peeled tag 均为空且退出0；GitHub refs API与Release-by-tag API均返回404；GitHub main=`86685471092941a31c30621233b9238ce6b1c393`，与本地HEAD/origin-main一致；package/main与生产公网均为`0.6.64`，生产ready/schema41。首选 `v0.6.65` 因此为高于实时生产的最低未占用 patch，版本门与本Goal内发布授权门均有效。首次 `git fetch origin main` 遇到TLS连接失败且无写入，随后GitHub API、精确ls-remote和公网接口均成功完成身份核对。

四个版本身份文件（package、lock、final runtime allowlist、m81断言）已同步；版本直接相关safe m81+m38=`57/57 PASS`（m81 `41/41`、m38 `16/16`），失败/重试/跳过/blocked/reportErrors均0，source/snapshot=`7749d8dd95221cc1ce576b68057ede2dc5890001ce7257e89aa7bd2ed35e5210`，4173 listener unchanged。最终治理同步后只复验m38=`16/16 PASS`，source/snapshot=`6f87c7f4b41ea11386291c4b09f44caa9eb4989011b7d49777f7878b92b65776`，异常0、4173 unchanged。四个版本身份文件属于Goal明确排除在10个业务产品+测试文件分母之外的版本/lock文件，业务分母仍为10/10、产品净新增199/450；formal full未重跑。

唯一下一步：完成显式stage allowlist、候选提交与GitHub PR/CI，不得使用`git add .`。真实 group 点击前仍必须以可靠逐节点 estimate 证明 `CNY + 10×USD <= 100`；无法证明则在点击前硬停止。
