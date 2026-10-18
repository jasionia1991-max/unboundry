# INC-GEN-019 验收矩阵

状态：`PRODUCTION_V0_6_65_TECHNICAL_PASS / REAL_GROUP_FLOW_NOT_RUN_BUDGET_ESTIMATE_BLOCKED / USER_RECHECK`

更新：2026-08-31T21:37:30+08:00

证据状态只允许：`NOT_RUN`、`EXPECTED_RED`、`TARGETED_PASS`、`REVIEW_GO`、`FORMAL_FULL_RECORDED`、`PRODUCTION_ZERO_PAID_TECHNICAL_PASS`、`REAL_GROUP_FLOW_PASS`、`REAL_GROUP_FLOW_FAIL`、`OUTCOME_UNKNOWN_BILLING_RISK`、`USER_RECHECK`、`USER_PASS`。

| ID | 验收项 | 当前状态 | 权威证据 |
| --- | --- | --- | --- |
| IG19-001 | 旧代码稳定复现 200→409→200→409 | EXPECTED_RED | m22 43/44；两轮200→409、10 downstream blocked、零付费边界 |
| IG19-002 | 客户端读取并校验 preflight canvasRevision | TARGETED_PASS | m22 valid/mismatch/invalid revision fake |
| IG19-003 | preflight 后 revision 变化不带旧 revision POST | TARGETED_PASS | preflight revision mismatch 在 formal POST 前阻断 |
| IG19-004 | 最终竞态由服务端事务 409 且零准入 | TARGETED_PASS | m22 两次 formal 409 后同 key 第三次收敛；server fence 保留 |
| IG19-005 | 确定性 409、exact 空、语义同用同 key 收敛 | TARGETED_PASS | m22 3 preflight/3 formal、post key unique=1 |
| IG19-006 | deadline 明确未创建时单次失败且无泄漏 | TARGETED_PASS | fake monotonic timeout + SAVE_STABILITY_TIMEOUT |
| IG19-007 | preflight 业务拒绝不正式 POST | TARGETED_PASS | m22/m41 既有 model/input preflight 分支 |
| IG19-008 | preflight network/5xx 只重做 preflight 且 key 不变 | TARGETED_PASS | m22 network→503→200，formal=1、key unique=1、重试间 PUT=0 |
| IG19-009 | formal network/5xx 只 reconcile 原 key，POST=1 | TARGETED_PASS | m40 lost/hung/500 + m22 shared-deadline formal timeout POST=1 |
| IG19-010 | accepted response loss 恢复 exact task | TARGETED_PASS | m40 committed response loss/hung body exact recovery |
| IG19-011 | semantic change 不在同次点击换 key/内容 | TARGETED_PASS | m100 semantic edit fence + m40 durable intent identity |
| IG19-012 | conflict/cancelled/ambiguous identity fail-closed | TARGETED_PASS | m40 identity conflict/cancelled/incomplete/ambiguous branches |
| IG19-013 | accepted binding 失败不二次 Provider POST | TARGETED_PASS | m22 accepted binding/checkpoint + m41 recovery paths |
| IG19-014 | 单 root 恰一 task/admission | TARGETED_PASS | m22 controlled root submission |
| IG19-015 | 两同层 root 各自一 task/admission | TARGETED_PASS | m22 production-shape layer denominator + parallel-root runner coverage |
| IG19-016 | 11-node dependency graph 每节点一个 intent | TARGETED_PASS | m22 11-node graph/layer/failure denominator；真实流待R8 |
| IG19-017 | accepted 上游满足 projection/save 后才启下游 | TARGETED_PASS | m22 graph/save/projection ordering |
| IG19-018 | 独立分支失败不误阻兄弟分支 | TARGETED_PASS | m22 branch isolation tests |
| IG19-019 | cancel/lease/navigation/unmount/exception/deadline 全清理 | TARGETED_PASS | m22 cancellation/navigation/lease/checkpoint/deadline exits |
| IG19-020 | R1 每个 PUT 已归因且 other=0 | TARGETED_PASS | 34=33 stale-binding reconciliation +1 root normalization；other=0 |
| IG19-021 | 同 epoch no-op 不增 graph revision/PUT | TARGETED_PASS | 34次均为distinct durable patch；既有 fingerprint no-op tests保持通过 |
| IG19-022 | binding/projection/checkpoint/pagehide 不被吞 | TARGETED_PASS | m22+m85 direct dependencies |
| IG19-023 | DATA-005 同标签拒旧、跨标签 last-writer | TARGETED_PASS | m85 27/27 |
| IG19-024 | 当前节点语义编辑安全停止且零 task | TARGETED_PASS | m100 semantic fence 15/15组合内通过 |
| IG19-025 | 非语义 revision 漂移同 intent 有界收敛 | TARGETED_PASS | m22 repeated drift convergence |
| IG19-026 | text/image/video/audio 共用安全准入合同 | TARGETED_PASS | m2/m33/m41/m40 shared port |
| IG19-027 | single/group/retry/task panel 无旁路 | TARGETED_PASS | m22/m40/m41/m100 complete direct call chain |
| IG19-028 | published models/exact identities/provider branches 100% Review | REVIEW_GO | 主线程与唯一独立代理覆盖10/10文件、62/62 hunks、10/10 published models、11个exact identities及全部Provider分支；最终P0/P1/P2=0/0/0、GO |
| IG19-029 | INC-GEN-018 错误优先级不回退 | TARGETED_PASS | m22 model incompatibility优先级 + m41 UI回归 |
| IG19-030 | accepted-only refresh/startup 只恢复原 task | TARGETED_PASS | m22/m41 accepted-only recovery |
| IG19-031 | 稳定 Canvas 一次点击自动 running | TARGETED_PASS | fake admission running；真实流待R8 |
| IG19-032 | 内部收敛不刷错且 reason 文案准确区分 | TARGETED_PASS | m22 retry/timeout/cancel reason 分支；生产文案待R8 |
| IG19-033 | 测试/零付费/真实流/主观验收严格分层 | TARGETED_PASS | Matrix保持分层；真实流/USER_RECHECK未冒充 |
| IG19-034 | 唯一 formal full 原始结果永久保留 | FORMAL_FULL_RECORDED | 原始122 specs/1135 tests=`1133/1135`、2失败、0重试/跳过/blocked/reportErrors、source=`ae7289ec…1976`；最小m22+m36+m38=`62/62`关闭，source=`18a991e9…9ca4`，未运行第二次full |
| IG19-035 | release/DB/service/counts/rollback/forward 完整回执 | PRODUCTION_ZERO_PAID_TECHNICAL_PASS | PR #136、双CI、v0.6.65 tag/Release、fresh build、冻结source/restore、forward→rollback→final forward、33/33静态、schema41/service/counts/10模型/11节点preflight通过；回执V0_6_65_PRODUCTION_RECEIPT |
| IG19-036 | 用户真实页面明确确认 | USER_RECHECK | 技术证据不得升级 |

## R0 计数与硬门

- baseline：tasks1026/admissions946/attempts1037/paidProviderRequests1025/active0/currentUnknown0/media956/publications547。
- target allowlist：11 logical executable nodes；exact digest=`dbb2d0aa9010f0a994a8cce2244238d5fb1b10a5b35f5d758c1c9a084ef24da0`。
- formal full=`1/1`（已消费，禁止重跑）；Review agent=`1/1`（同一线程完成formal后增量复核）；真实 group click=`0/1`且因CNY300保守上限超过CNY100未消费；新 task/admission/attempt/POST/OSS=`0/11`；新增费用=`0`。
- 产品+测试文件=`10/10`；产品净新增=`199/450`（247增/48删）；schema/dependency=`0`；最终冻结diff=`9925eda3…d16ed`、62 hunks；最终最小关闭 source/snapshot=`18a991e9…9ca4`。
- v0.6.65四个版本身份文件已同步并按Goal排除在业务10文件分母外；版本直接safe m81+m38=`57/57 PASS`（41+16），source/snapshot=`7749d8dd…5210`；最终治理同步后m38=`16/16 PASS`、source/snapshot=`6f87c7f4…5776`，异常0、4173 unchanged；formal full未重跑。
