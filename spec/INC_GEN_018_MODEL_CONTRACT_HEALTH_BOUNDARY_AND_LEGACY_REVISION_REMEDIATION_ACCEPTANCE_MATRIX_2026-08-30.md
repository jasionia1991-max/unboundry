# INC-GEN-018 验收矩阵

状态：`GOAL_ACTIVE / R0_COMPLETE / R1_TARGETED_PASS / R2_TARGETED_PASS / R3_TARGETED_PASS / R4_TARGETED_PASS / R5_REHEARSAL_PASS / R6_REVIEW_GO / R7_COMPLETE / R8_LOCAL_CANDIDATE`

更新时间：2026-08-31

状态定义：

- `EVIDENCE_PASS`：只证明2026-08-30只读诊断事实。
- `NOT_RUN`：修复、测试、Review或发布尚未执行。
- `USER_RECHECK`：必须由用户在真实页面确认，自动证据不能代替。
- `R2_TARGETED_PASS`：只证明 canonical/planner 及生产形状临时库的最小定向行为，不代表正式full、冻结生产副本、Review或生产通过。
- `R4_TARGETED_PASS`：只证明最小直接依赖、10模型目录与7节点整组预检，不代表冻结生产副本、正式full、Review或生产通过。
- `R5_REHEARSAL_PASS`：只证明新冻结生产数据库source/restore及独立工作副本的attested dry-run/apply/health/repeat通过，生产库仍未迁移，不代表Review、正式full、GitHub或生产发布通过。
- `R6_MAIN_REVIEW_GO`：主线程已完成非抽样逐代码Review并清零P0/P1；独立冻结候选终审未完成前不等于R6完成或正式full授权门通过。
- `R7_COMPLETE`：唯一正式safe full原始`1131/1135`与4项失败永久保留；4项均由最小直接复验关闭，5-hunk独立复审`P0=0/P1=0/P2=0/GO`，隔离浏览器AUTO_PASS。不得改写成正式full全绿。

R0证据：实施分支/HEAD、生产v0.6.63/schema41、安全/任务/费用基线与10/10 exact identities已冻结；脱敏快照SHA-256=`fa6a498aeb697277e8f6cdef15d1a0b9e21123a75495c90c1b74b96131090457`。safe m32预期红=`6 PASS / 1 expected FAIL`，唯一失败精确证明enabled平台开关下合同漂移尚未返回`MODEL_CONTRACT_OUT_OF_SYNC`；source/snapshot=`07fae080…f8ebe`，4173 unchanged，Provider/OSS/费用0。

| ID | 验收项 | 必须证据 | 当前状态 |
|---|---|---|---|
| IG18-001 | 真实平台开关状态 | 生产只读证明`globalEnabled=1/emergencyStop=0` | EVIDENCE_PASS |
| IG18-002 | 浏览器缓存排除 | 登录态`/api/models`使用no-store返回HTTP 200且刷新后结果一致 | EVIDENCE_PASS |
| IG18-003 | 模型影响分母 | 10个published中8个available，仅Seed/TTS返回伪全局关闭 | R0_EVIDENCE_PASS |
| IG18-004 | active revision漂移 | 两模型活动revision缺当前canonical `inputPolicy`，其余8个identity active/expected schema一致 | R0_EVIDENCE_PASS |
| IG18-005 | 错误边界根因 | `modelCatalog`把`globalEnabled && contractHealthy`传给availability，后者返回全局关闭 | EVIDENCE_PASS |
| IG18-006 | 迁移遗漏根因 | semantic upgrade集合遗漏Doubao Seed与Doubao TTS 2.0 | EVIDENCE_PASS |
| IG18-007 | 回归来源 | 组合逻辑进入`46a9abf…8c78`并发布到v0.6.63 | EVIDENCE_PASS |
| IG18-008 | 本轮零任务/零费用 | tasks1026、attempts1037、active0、current unknown0；新增Provider POST/OSS/费用=0 | R0_EVIDENCE_PASS |
| IG18-009 | 历史状态不改写 | INC-GEN-017发布时Review/技术/真实Provider事实保留，本事件独立编号 | EVIDENCE_PASS |
| IG18-010 | 方案审计边界诚实 | 根因已查实；实现、迁移、测试、Review、生产验证明确为NOT_RUN | EVIDENCE_PASS |
| IG18-011 | 全局开关只由平台安全状态决定 | global off返回`GLOBAL_GENERATION_DISABLED`；合同状态不能改变该字段 | R1_TARGETED_PASS |
| IG18-012 | 模型合同错误独立分类 | global on + contract drift返回`MODEL_CONTRACT_OUT_OF_SYNC`或等价稳定模型级码 | R1_TARGETED_PASS |
| IG18-013 | emergency stop优先级 | 紧急停止仍优先且不被合同、Provider或credential状态掩盖 | R1_TARGETED_PASS |
| IG18-014 | Provider/credential/adapter错误不回退 | 既有稳定错误码、优先级和fail-closed行为保持 | R1_TARGETED_PASS |
| IG18-015 | canonical resolver单一真相 | catalog/health/bootstrap/publish/migration使用同一effective schema和fingerprint | R2_TARGETED_PASS |
| IG18-016 | planner枚举全部published模型 | 实施时全部logical models和exact identities都有唯一action | R2_TARGETED_PASS |
| IG18-017 | 未分类drift阻断 | 任一published模型出现未批准差异时plan/apply在写入前停止 | R2_TARGETED_PASS |
| IG18-018 | Seed legacy exact识别 | 完整model/provider/revision/hash/schema身份精确匹配才允许迁移 | R3_TARGETED_PASS |
| IG18-019 | TTS legacy exact识别 | 完整model/provider/revision/hash/schema身份精确匹配才允许迁移 | R3_TARGETED_PASS |
| IG18-020 | near-miss全部拒绝 | model ID、profile、driver、protocol、hash、schema、version任一近似均阻断 | R3_TARGETED_PASS |
| IG18-021 | 历史revision不可变 | 新建revision并保留旧document/compiler hash；无原地修改 | R3_TARGETED_PASS |
| IG18-022 | active revision CAS | from active/revision/hash/configuration变化导致整事务停止 | R3_TARGETED_PASS |
| IG18-023 | 事务与故障回滚 | revision写入、激活、审计和最终健康检查任一步失败均零半状态 | R3_TARGETED_PASS |
| IG18-024 | repeat幂等 | 干净兄弟副本repeat全模型none、升级0、数据库字节不变 | R3_TARGETED_PASS |
| IG18-025 | 其余模型零迁移 | 另外8个published logical models及其exact identities均为none | R3_TARGETED_PASS |
| IG18-026 | 模板/Canvas/任务不改 | 默认数据diff只含revision、active pointer和脱敏audit；其他域计数与内容不变 | R3_TARGETED_PASS |
| IG18-027 | 旧任务仍按冻结revision | 历史task/result/recovery不被current active revision重释或误投影 | R3_TARGETED_PASS |
| IG18-028 | 生产形状legacy fixture | m102直接回放缺inputPolicy的Seed/TTS旧revision，不只创建current revision | R2_TARGETED_PASS |
| IG18-029 | availability直接测试 | global off、global on+drift、emergency/provider/credential/adapter矩阵全覆盖 | R1_TARGETED_PASS |
| IG18-030 | API模型目录 | 代表性快照10/10健康；合同异常时显示模型级原因 | R4_TARGETED_PASS |
| IG18-031 | 整组预检恢复 | 目标7节点不再因伪全局关闭阻断；预检不创建task/attempt | R4_TARGETED_PASS |
| IG18-032 | 零Provider/OSS/费用与受保护文件边界 | Provider POST=0、OSS写0、费用0；当前runner/fixture不再读取受保护文件，历史误访问事件永久保留 | R4_TARGETED_PASS / HISTORICAL_INCIDENT_RETAINED |
| IG18-033 | 冻结生产副本演练 | attestation、dry-run/apply/health/repeat、schema/integrity/FK和计数门全通过 | R5_REHEARSAL_PASS |
| IG18-034 | 完整逐代码Review | 全改动文件/hunk/分支/调用链/全部published模型/exact identities/Provider分支；P0=0/P1=0 | R6_REVIEW_GO / P0=0 / P1=0 / P2=7 |
| IG18-035 | 唯一正式safe full | Review GO后执行一次；结果、异常、source/snapshot和4173边界完整记录 | FORMAL_FULL_RECORDED_1131_OF_1135 / 4_TARGETED_CLOSED / BROWSER_AUTO_PASS |
| IG18-036 | GitHub与不可变发布 | 已授权的PR/main CI、tag/Release、fresh build | PR_134_OPEN / INITIAL_HEAD_CI_PASS / FINAL_HEAD_PENDING |
| IG18-037 | 生产备份与可回滚迁移 | quiet、冻结source/restore、生产副本幂等、原子切换、paired rollback/forward | NOT_RUN |
| IG18-038 | 生产10/10模型健康 | 当前10个published模型逐一核对，不抽样 | NOT_RUN |
| IG18-039 | 生产任务与费用计数不变 | 页面预检前后tasks/attempts/active/unknown/Provider POST均不变 | NOT_RUN |
| IG18-040 | 用户真实页面确认 | 用户确认不再出现该错误且产品行为符合预期 | USER_RECHECK |

## NO-GO 门

以下任一项成立即保持NO-GO：

1. `IG18-011～039`中进入相应阶段的硬门未通过。
2. Seed/TTS差异不止已批准的legacy语义元数据修复。
3. 需要批量改模板、Canvas、任务、媒体或用户数据。
4. 迁移缺exact identity、CAS、事务、审计或repeat no-op。
5. 任一Provider POST、OSS写、secret/受保护JSON读取或新费用。
6. 候选P0/P1未清零。
7. 用户尚未在新Session完整发送一次性Goal，却进入代码、GitHub或生产；Goal启动后则按其已明确的版本选择与发布授权执行。

说明：一次性Goal已在本Session启动；R0～R4已有对应只读/定向证据。R4最终m102 30/30与m12 6/6的source/snapshot=`23a006b7…0eae9`，m38 16/16=`9b86a69f…f824b`，并复用同一直接依赖阶段中未受后续修复影响的m22 44/44、m32 7/7、m94 4/4证据；它仍不代表R5～R8、正式full、真实冻结生产副本、生产迁移或用户验收通过。受保护fixture历史事件不删除、不降级，也不再作为当前runner输入。
