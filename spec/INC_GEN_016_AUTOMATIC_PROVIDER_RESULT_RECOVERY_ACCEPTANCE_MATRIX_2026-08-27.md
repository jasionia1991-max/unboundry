# INC-GEN-016 验收矩阵

状态：`R1-R5_AUTO_PASS / CANDIDATE_FREEZE_PENDING / RELEASE_GATE_CLOSED`

| ID | Priority | 验收项 | 必须证据 | 当前状态 |
|---|---:|---|---|---|
| APR-001 | P0 | 一次用户动作最多一次 Provider POST | 并发/双击/超时/重启账本 | AUTO_PASS |
| APR-002 | P0 | 提交前持久化完整 paid boundary 身份 | DB事务与故障注入 | AUTO_PASS |
| APR-003 | P0 | Provider task ID 在首次 poll 前原子持久化 | response→store crash matrix | AUTO_PASS |
| APR-004 | P0 | 有限响应路径兼容真实外壳及无害附加字段 | 脱敏真实fixture + 负向合同 | AUTO_PASS |
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
| APR-015 | P0 | 全部当前已发布模型身份与能力无计划漂移 | 生产脱敏baseline diff | R0_BASELINE_CAPTURED |
| APR-016 | P0 | 未修改专用connector保持原请求/响应行为 | per-connector golden replay | AUTO_PASS |
| APR-017 | P0 | 历史任务按冻结Revision继续 | old-task restart/rollback fixture | AUTO_PASS |
| APR-018 | P0 | 旧Canvas和模板无需手工迁移 | 真实冻结引用矩阵 | AUTO_PASS |
| APR-019 | P0 | schema/Worker/rollback不丢在途任务 | expand-contract rehearsal | AUTO_PASS |
| APR-020 | P1 | 明确失败/拒绝/退款只在项目内表达 | response/UI matrix | AUTO_PASS |
| APR-021 | P0 | GK原始首帧场景真实结果自动回画布 | 单次付费生产证据 | AUTHORIZED_NOT_CONSUMED |
| APR-022 | P0 | 真实结果刷新后仍可播放且任务中心/素材库可找 | Browser + DB/asset evidence | NOT_RUN |
| APR-023 | P0 | 实际修改的每个connector family有真实端到端证据 | connector release ledger | AUTHORIZED_NOT_CONSUMED |
| APR-024 | P0 | 独立终审P0=0/P1=0 | frozen candidate review | NOT_RUN |
| APR-025 | P0 | 风险驱动验证完成且正式full最多一次 | test receipts | TARGETED_AUTO_PASS_FULL_NOT_RUN |
| APR-026 | P0 | 版本、发布、费用授权分别有效且未复用 | authority ledger | AUTHORIZED_IN_PROGRESS |
| APR-027 | P0 | 用户明确确认生产项目内结果 | ordinary-user checklist | USER_RECHECK |

## 放行规则

- APR-001～020、024～025 未全部有证据：不得进入真实 Provider 门。
- APR-021～023 未通过：不得进入版本发布门。
- APR-026 未授权：不得 commit/push/PR/tag/Release/SSH/生产写或真实生成。
- APR-027 未由用户明确确认：不得写 `USER_PASS`。
- 任何当前已发布模型、历史任务、Canvas、模板或不可变 Revision 回归：立即 `NO-GO`，不能以 GK 成功抵消。
