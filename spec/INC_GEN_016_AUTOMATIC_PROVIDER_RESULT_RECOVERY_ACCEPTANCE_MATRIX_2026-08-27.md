# INC-GEN-016 验收矩阵

状态：`V0_6_56_TARGETED_PASS / REVIEW_PENDING / RELEASE_GATE_CLOSED / USER_RECHECK`

| ID | Priority | 验收项 | 必须证据 | 当前状态 |
|---|---:|---|---|---|
| APR-001 | P0 | 一次用户动作最多一次 Provider POST | 并发/双击/超时/重启账本 | AUTO_PASS |
| APR-002 | P0 | 提交前持久化完整 paid boundary 身份 | DB事务与故障注入 | AUTO_PASS |
| APR-003 | P0 | Provider task ID 在首次 poll 前原子持久化 | response→store crash matrix | AUTO_PASS |
| APR-004 | P0 | 有限响应路径兼容真实外壳及无害附加字段 | 脱敏真实fixture + 负向合同 | AUTO_PASS_13_OF_13 |
| APR-005 | P0 | 响应证据脱敏且不泄露secret/prompt/签名URL | secret/source gate | AUTO_PASS |
| APR-006 | P0 | 异步connector具备正式可恢复能力 | idempotency/request-id/ledger/owned-relay证据 | AUTO_PASS |
| APR-007 | P0 | 响应丢失自动进入RECONCILING且零新POST | network fault + paid ledger | AUTO_PASS |
| APR-008 | P0 | 关页、刷新、服务重启后后台继续 | crash/restart端到端 | AUTO_PASS |
| APR-009 | P1 | 恢复按Provider窗口退避并进入管理员事故队列 | clock/lease/queue测试 | AUTO_PASS |
| APR-010 | P0 | Provider success先形成正式result asset | store/media integration | AUTO_PASS |
| APR-011 | P0 | 资产和投影重放幂等、不复制结果 | repeated delivery matrix | AUTO_PASS |
| APR-012 | P0 | Canvas冲突不降级成功、不重新生成 | projection CAS + POST=0 | AUTO_PASS |
| APR-013 | P0 | 普通用户无人工核对/中转站步骤 | client contract + 浏览器验收 | AUTO_PASS |
| APR-014 | P0 | unknown outcome永远禁止新付费attempt | API/store/worker负向测试 | AUTO_PASS |
| APR-015 | P0 | 全部当前已发布模型身份与能力无计划漂移 | 生产脱敏baseline diff | PRODUCTION_BASELINE_UNCHANGED |
| APR-016 | P0 | 未修改专用connector保持原请求/响应行为 | per-connector golden replay | AUTO_PASS |
| APR-017 | P0 | 历史任务按冻结Revision继续 | old-task restart/rollback fixture | AUTO_PASS |
| APR-018 | P0 | 旧Canvas和模板无需手工迁移 | 真实冻结引用矩阵 | AUTO_PASS |
| APR-019 | P0 | schema/Worker/rollback不丢在途任务 | expand-contract rehearsal | AUTO_PASS |
| APR-020 | P1 | 明确失败/拒绝/退款只在项目内表达 | response/UI matrix | REAL_PROVIDER_REFUND_UI_PASS |
| APR-021 | P0 | GK原始首帧场景真实结果自动回画布 | 单次付费生产证据 | V0_6_56_AUTHORIZED_NOT_CONSUMED |
| APR-022 | P0 | 真实结果刷新后仍可播放且任务中心/素材库可找 | Browser + DB/asset evidence | V0_6_56_NOT_RUN |
| APR-023 | P0 | 实际修改的每个connector family有真实端到端证据 | connector release ledger | V0_6_56_AUTHORIZED_NOT_CONSUMED |
| APR-024 | P0 | 独立终审P0=0/P1=0 | frozen candidate review | V0_6_56_REVIEW_PENDING |
| APR-025 | P0 | 风险驱动验证完成且正式full最多一次 | test receipts | V0_6_56_TARGETED_PASS_132 / FULL_NOT_REQUIRED_YET |
| APR-026 | P0 | 版本、发布、费用授权分别有效且未复用 | authority ledger | V0_6_56_AUTHORIZED_NOT_CONSUMED |
| APR-027 | P0 | 用户明确确认生产项目内结果 | ordinary-user checklist | USER_RECHECK |

## 放行规则

- APR-001～020、024～025 未全部有证据：不得进入GitHub、发布、生产或真实Provider门。
- APR-021～023只能在v0.6.56生产技术门通过后执行；未通过时不得写`REAL_PROVIDER_PASS`或关闭事故，但不倒置为“发布前必须先有生产结果”。
- APR-026 未授权：不得 commit/push/PR/tag/Release/SSH/生产写或真实生成。
- APR-027 未由用户明确确认：不得写 `USER_PASS`。
- 任何当前已发布模型、历史任务、Canvas、模板或不可变 Revision 回归：立即 `NO-GO`，不能以 GK 成功抵消。

## 2026-08-28 生产结果

- v0.6.55 的PR/main CI、不可移动tag/Release、fresh build、冻结备份、恢复演练、原子切换、回滚和66秒稳定门均通过，生产技术状态为`PRODUCTION_TECHNICAL_PASS`。
- 历史attempt2经平台完整当日账本证明未受理且未扣费；只在此证据成立后消费唯一替代提交。attempt3由Provider返回HTTP 200，但没有可提取的字符串task ID；平台账本随后明确显示`已退款`、金额0.924、成功0、退款1，且没有结果作品。
- Unboundry已把attempt2收口为`PROVIDER_NOT_ACCEPTED_NO_CHARGE`，把attempt3收口为`PROVIDER_REFUNDED`，实际费用均为0；项目内显示“平台未完成本次生成，费用已全额退回；未再次提交”。
- APR-021、APR-022和APR-023的成功条件未满足，真实结果门失败；版本、发布和唯一替代提交授权均已消费，禁止再次Provider POST。v0.6.55技术发布事实保留，但不得写`REAL_PROVIDER_PASS`或`USER_PASS`。

## v0.6.56 续作放行

- 新Goal新增USD20总预算；首单预估上限USD10，只有明确未受理/未扣费或退款时最多替代一次，任何unknown禁止第二次POST。
- APR-004必须用真实脱敏形状fixture证明数字双路径唯一一致，并用零/多/冲突/危险值负向证明fail-closed。
- v0.6.56候选、独立Review、CI、冻结备份/恢复/回滚和生产技术门全部通过前，APR-021～023预算不得消费。
