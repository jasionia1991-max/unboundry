# MODEL-CONTRACT-002 历史 revision 与当前发布政策解耦方案

状态：`V0_6_52_VERSION_GATE_PASS / FINAL_REVIEW_GO / SAFE_FULL_PASS / RELEASE_AUTHORIZED / USER_RECHECK`

## 问题与边界

生产 v0.6.51/schema41 的失败任务 `da761fff-6a65-46fd-84cf-4dc5bddbc985` 使用冻结的 GK revision 1。该快照在创建时允许“文生视频”和“恰好一张首帧”两种模式，但 v0.6.51 代码把当前 GK 默认合同改成了只允许首帧，并错误地用当前默认合同校验历史快照，导致在 Provider POST 前以完整性失败阻断。目标不是删除完整性校验，而是把“冻结快照有没有被篡改”与“今天允许发布什么新合同”分开。

本轮只形成本地候选。真实 Provider、Generation、OSS、生产写、merge、tag、Release、SSH 写和发布均不在当前授权内；失败任务不得自动重跑。生产技术状态继续是 `PRODUCTION_V0_6_51_TECHNICAL_PASS / USER_RECHECK`。

## 决策

1. `ContractCompiler` 只编译有限声明式合同；合同版本支持 1 和 2。
2. `CurrentReleasePolicy` 单独拥有当前发布政策。GK 当前合同必须是 version 2，明确支持文字与单首帧；其他模型不得冒充 GK 的声明式 runtime。
3. `RevisionStore` 校验历史 revision 时只检查身份、document hash、compiler hash、有限安全规则和 connector/contract 支持表，不再要求历史合同等于当前 GK 默认合同。
4. 执行签名改变必须提升 `executionContract.version`。新 GK 发布为 revision 2，revision 1 不改写；升级使用 active revision CAS、单事务验证/激活/审计，失败零半状态，重复执行不新增 revision。
5. 模板影响改为逐模板、逐节点匹配旧/新合同。无法解析、旧可执行而新不可执行、或新合同匹配不唯一均 fail-closed；新增文字模式是兼容扩展。
6. 11 模型治理 dry-run 输出活动 revision、自身完整性、当前政策漂移、文字基础模式、from/to hash、模板矩阵和 `paidProviderRequests=0`。GK 满足 22 模板/34 节点门后才可升级。
7. `kwvideo-v2` 没有可核验的文字基础模式证据，不伪造 `EXACT`；升级路径将它停用并归档、关闭普通用户绑定，同时保留历史任务、Canvas 引用和合同 revision。
8. TaskAdmission 继续冻结任务创建时的 revision；TaskExecution 按该快照执行。历史首帧任务中的文字 instruction 已合成 Prompt，不再被错误当成未声明媒体角色；非法媒体角色、数量、空 Prompt、未知结果和付费重试门均不放宽。

## 升级和回滚

- dry-run：`npm run model-contracts:upgrade -- --data-dir <绝对隔离数据目录>`，只读打开 schema41 数据库并输出计划。
- apply：仅在未来发布授权和恢复副本门内增加 `--apply`；必须精确满足 schema41、11 个治理模型、GK 22/34 兼容和 GK 之外零意外漂移。
- 合同回滚：用新 immutable revision 指向上一份已验证合同，不修改 revision 1。
- 二进制回滚：可恢复服务，但 v0.6.51 会恢复已知 GK 阻断，只能标记为降级并快速前滚。
- 数据：不升 schema，不直接 SQL 改合同 JSON/hash，不静默 bootstrap 重写历史。

## 验收

详细门见 `spec/MODEL_CONTRACT_002_ACCEPTANCE_MATRIX_2026-08-27.md`；实时断点见 `spec/MODEL_CONTRACT_002_CHECKPOINT.md`。自动测试只使用临时目录、动态 loopback、fake Provider/OSS 和假数据，禁止 4173、生产路径、真实密钥与真实媒体。
