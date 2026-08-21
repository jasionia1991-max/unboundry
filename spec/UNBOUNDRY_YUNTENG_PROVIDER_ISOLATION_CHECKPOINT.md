# Unboundry 云腾 Provider 隔离 Goal Checkpoint

更新日期：2026-08-21

当前状态：`GOAL_ACTIVE / PRODUCTION_CODE_PUBLISHED / YUNTENG_CREDENTIAL_GATE_BLOCKED / USER_RECHECK`

本文件是新 Goal 的唯一可变施工续接点。方案合同以 `spec/UNBOUNDRY_YUNTENG_PROVIDER_ISOLATION_PLAN_2026-08-21.md` 为准；发生上下文压缩、subagent交接或中断后，先核对真实Git/生产现场，再更新本文件，不得从旧聊天推断进度。

## 冻结身份

- 仓库：`/Users/mymy/Documents/unboundry/app`
- 分支：`codex/unboundry-offline-remediation-2026-08-09`
- 文档落笔 HEAD：生产回执提交前的 v0.6.29 发布分支
- 文档落笔 origin/main：`af8493cdf710dc9f899aa098d725e9d034bdb032`
- 发布 tag commit：`d4ccc360e2645e43005c8bdf9a05ec984d48e655`；tree：`a291420309236f2b2bb53653301b2b1f1395dbfd`
- package：`0.6.29`
- 生产：`v0.6.29 / schema39`；current=`/opt/unboundry/releases/v0.6.29-yunteng-provider-isolation-20260821`
- 目标：`v0.6.29`（已发布，不进入 v0.6.30）
- 受保护文件：`spec/public-templates-director-split-revision.json`，禁止读取/修改/暂存/提交

新 Goal 开始时必须用实际命令刷新上述漂移项。文档未提交导致的预期 Markdown 差异可以接管，其他用户改动不得覆盖。

## 当前事实

- 优创与云腾是独立商业 Provider，余额、key、账号凭据和账单不互通；
- 两者只是在技术上使用天空兼容中转 API；
- 生产有彼此独立的优创和云腾 profile；云腾元数据 profile driver=`multi-protocol-relay`、base URL=`https://api.lk888.ai`，但 key/catalog 均 unchecked；
- 三个 Provider 模型 ID 只在优创历史目录快照中被观察到；生产仍没有对应精确 model profile 和节点 binding，因为云腾自己的 key 未在安全入口取得；
- v0.6.29 代码在线，但云腾 credential/model/binding/task/attempt 均为0；状态为 `PRODUCTION_CODE_PUBLISHED_CONFIGURATION_BLOCKED / USER_RECHECK`；
- schema39 已能表达 profile、credential、model、task 和 attempt 隔离，默认无需 migration；
- 普通 `/api/models` 和节点下拉的 Provider 标签代码已上线；因云腾尚无已发布模型，生产页面目录可见性仍须在凭据门通过后验收。

## 阶段清单

- [x] Stage 0：重新冻结Git、运行时和生产只读基线
- [x] Stage 1：公共模型目录返回安全 Provider 身份
- [x] Stage 1：节点下拉与ARIA可辨认同名 Provider 模型
- [x] Stage 2：固定目录/凭据/task/attempt/recovery跨Provider隔离测试
- [x] Stage 2：管理端术语和操作确认不混淆商业平台与技术通道
- [x] Stage 3：TypeScript、构建和直接定向spec通过
- [x] Stage 3：一次独立subagent review完成且发现已处理
- [ ] Stage 4：验收矩阵P0全部有证据（代码和不依赖密钥项已完成；P0-02/03/06/09受凭据门阻断）
- [x] Stage 4：至少两个语义独立本地commit完成
- [x] Stage 4：冻结候选后唯一一次正式安全full完成；9项旧测试夹具/可访问名称失败已最小复验转绿，未重复full
- [x] Stage 5：v0.6.29 tag/PR/merge/tree/release一致
- [x] Stage 5：冻结备份、fresh build、原子生产切换完成
- [ ] Stage 6：独立云腾profile和账号凭据安全配置完成
- [ ] Stage 6：三模型只在云腾下导入、发布、绑定
- [x] Stage 6：优创前后不变证据完成
- [ ] Stage 7：零付费生产门全部通过（版本/服务/数据/日志/优创门已过；云腾credential/model/UI门受阻）
- [x] Stage 7：最多三次有界真实smoke完成或因明确凭据门BLOCKED（实际0 POST，未进入付费阶段）
- [x] Stage 8：上线后不依赖密钥的生产技术验收和阻断回执完成
- [ ] Stage 8：状态停在`PRODUCTION_PUBLISHED_AGENT_REAL_PAGE_PASS / USER_RECHECK`

## 测试账本

已完成风险定向验证和唯一一次正式 full。full 退出1，`1025/1034`通过；9项失败全部是旧测试夹具或可访问名称没有跟随已验证的新隔离语义。按合同只复验失败spec：首个最小集合`30/31`，再修唯一剩余m43并`6/6`通过，未第二次运行full。不得把这组证据改写成“full全绿”。

新 Goal 每次只追加有效记录：

| 时间 | 源码 SHA | 环境 | 命令/范围 | 结果/退出码 | 为什么需要 | 是否允许重跑 |
|---|---|---|---|---|---|---|
| 2026-08-21 | `8f4a2b6`前后实现树 | Node 22.23.1 / npm 10.9.8 | TypeScript；m9/m12/m16/m18/m46/m47/m50/m56/m57/m73/m88风险定向 | review后核心有效78/78；直接相邻集合均绿 | Provider/API/UI/凭据/recovery/result commit | 已绿不重复 |
| 2026-08-21 | `8f4a2b6` + v0.6.29文档/版本树，source `c75e3520…a84c` | Node 22.23.1 / npm 10.9.8 | m38 + m81 | 56/56，退出0 | 当前状态与package一致；0.6.29 final runtime allowlist | 已绿不重复 |
| 2026-08-21 | HEAD `0f23b19`；source/snapshot `40da52cc…20a` | Node 22.23.1 / npm 10.9.8；隔离safe runner | `node scripts/run-safe-tests.mjs full`，119 specs / 1034 tests | 1025通过、9失败，退出1；快照和4173 listener不变 | 唯一正式发布full；失败为旧fixture/ARIA按钮名称 | 已消费，禁止重复 |
| 2026-08-21 | full后测试兼容树 | 同上 | m15/m2-image/m43/m44/m58最小失败集合 | 30/31，退出1；只剩m43旧导入按钮名称 | 只复验full失败spec | 不重复已绿项 |
| 2026-08-21 | 最终测试兼容树，提交`19ec414` | 同上 | m43单spec | 6/6，退出0；source/snapshot `12b428e2…83ed`，4173 listener不变 | 复验唯一剩余失败项 | 已绿不重复 |
| 2026-08-21 | 生产阻断回执树，source/snapshot `c9560566…0bf2` | Node 22.23.1 / npm 10.9.8；隔离safe runner | m38 + m81 | 56/56，退出0；4173 listener不变 | 当前状态、版本、发布治理和生产阻断回执一致 | 已绿不重复 |

## Review 账本

独立 review 预算已消费一次。发现4项：owner凭据回退全局key、relay恢复上下文未按profile隔离、result/retry/resume未完整核对attempt profile、既有model可原地跨profile重绑。主agent已全部修复并完成m12/m56/m57/m73/m88最小复验；不得再启动第二次独立review。

## 真实调用账本

创建 POST 总预算：最多3次，且只在全部零付费门通过后执行。

| 模型 | 上限 | 实际POST | task/attempt/providerTaskId | 结果 |
|---|---:|---:|---|---|
| Nano 1K文字图 | 1 | 0 | 待执行 | 待执行 |
| Kling 5秒standard | 1 | 0 | 待执行 | 待执行 |
| Suno instrumental | 1 | 0 | 待执行 | 待执行 |

三项均为 `NOT_RUN_CREDENTIAL_GATE`。云腾 key 缺失使零付费门不完整，故没有发起目录请求、预检任务或创建 POST；这不是smoke PASS。

未知结果、失败或超时不得自动重试，不得切换优创或其他账号。

## 授权账本

- 用户已在当前会话以`/goal`明确启动完整合同，并授权 v0.6.29、发布、SSH、生产配置、最多3次真实POST、一次review和必要回滚；
- 当前Goal已经完成代码、定向测试、一次review、唯一一次full及其最小失败复验、GitHub、备份、fresh build、生产切换和不依赖密钥的生产验收；真实调用授权仍仅限本合同；
- 新 Goal 授权只在该 Goal 存续期间有效，完成或BLOCKED后立即消费，不延续到其他版本或Provider；
- 用户没有在聊天中提供云腾key；key必须走安全入口，缺失时不得借用优创或伪造完成。

## 下一动作

等待授权用户在生产 `/connections`（「我的连接」）加密表单中填写云腾自己的 API key，并只告知“已填写”，不得把 key 发到聊天、Git、文档、测试或终端。收到后先只读核对云腾 credential identity，再继续目录同步、三模型只在云腾导入/发布/绑定、普通目录/ARIA和最多三次真实smoke。不得再次运行full、不得移动v0.6.29 tag、不得进入v0.6.30，也不得借用优创key。
