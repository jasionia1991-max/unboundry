# INC-GEN-017 验收矩阵

状态：`GOAL_ACTIVE / FORMAL_SAFE_FULL_CONSUMED_FAILED_REMEDIATION_REVIEW_P0_0_P1_0_P2_1_GO_R7_COMPOSITE_BROWSER_TARGETED_PASS_R8_VERSION_V0_6_57_TARGETED_PASS_CANDIDATE_COMMIT_READY / PRODUCTION_V0_6_56_UNCHANGED`

| ID | 验收项 | 必须证据 | 当前状态 |
|---|---|---|---|
| IG17-001 | 同画布不重叠组互不阻塞 | A组interrupted时B/C组可启动；各自run/lease/task计数独立 | R1_TARGETED_AUTO_PASS |
| IG17-002 | 同组自动接管原run | 刷新/重连后无需再次点击；不新建并行run；页面无需任务面板操作 | R1_TARGETED_AUTO_PASS |
| IG17-003 | 零accepted且不可修复自动收口 | checkpoint只按精确run清理；下一轮可直接开始；Provider POST=0 | R1_TARGETED_AUTO_PASS |
| IG17-004 | accepted原任务只恢复不重提 | 刷新/重启/双击后同taskId；新Provider POST=0 | EIGHTEENTH_REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-005 | accepted恢复后安全继续pending | snapshot一致才继续旧run；变化时关闭旧run、当前图新run自动继续 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-006 | 部分失败只阻断后代 | 独立分支继续；成功proof保留；失败分支可恢复 | R1_TARGETED_AUTO_PASS |
| IG17-007 | 同组多run冲突安全 | 仅核对已有任务、禁止新POST；其他组不受影响 | R1_TARGETED_AUTO_PASS |
| IG17-008 | outcome unknown费用围栏 | 任意点击/刷新/worker循环都不产生新paid attempt | R1_TARGETED_AUTO_PASS |
| IG17-009 | 明确退款/未受理最多安全重试一次 | 持久retrySafetyDecision和attempt/POST精确计数 | R1_TARGETED_AUTO_PASS |
| IG17-010 | 结果成功与Canvas投影解耦 | 投影冲突时asset/task成功保持，后台只重试投影 | R1_TARGETED_AUTO_PASS |
| IG17-011 | Seedance纯文字模式 | 无媒体唯一选择text，Provider前合同通过 | R3_TARGETED_AUTO_PASS |
| IG17-012 | Seedance单图全能参考 | 一图自动为multimodal/reference-image，不出现ROLE_UNSUPPORTED | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-013 | Seedance多模态全能参考 | 图/视频/音频按各自参考角色完整消费 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-014 | Seedance首尾帧 | 明确两图首尾角色、顺序、数量和请求映射正确 | R3_TARGETED_AUTO_PASS |
| IG17-015 | 首尾帧→全能参考原子迁移 | node参数和edge角色同一undo/save；媒体/边/order不变 | R3_TARGETED_AUTO_PASS |
| IG17-016 | 模型切换无半状态 | 保存失败回到切换前；成功后旧contract错误被清除 | EIGHTEENTH_REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-017 | 无法无损迁移时精确阻断 | 所有素材和边保留；Provider POST=0；错误指出具体原因 | R2_TARGETED_AUTO_PASS |
| IG17-018 | 共享语义与独立adapter一致 | 同revision语义/fingerprint一致；Canvas/Provider各自适配；漂移fail-closed | EIGHTEENTH_REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-019 | schema合法组合全部唯一编译 | 每个published revision合法组合命中execution mode恰好1条 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-020 | 无未消费字段/角色 | compiler消费清单与schema输入全集相等 | R4_TARGETED_AUTO_PASS |
| IG17-021 | Grok合同闭合 | UI合法的每个模式/角色都有精确执行路径；无证据能力不可选 | R3_TARGETED_AUTO_PASS |
| IG17-022 | Mureka固定单结果 | UI/API/task/adapter/result asset均为1；2/3不可配置 | R3_TARGETED_AUTO_PASS |
| IG17-023 | 专用adapter精确注册 | 每个specialized模型绑定revision/mode/roles/parameters/results | R4_TARGETED_AUTO_PASS |
| IG17-024 | 未知模型不靠通用兜底发布 | 只有protocol、没有精确合同的假模型发布被拒绝 | R5_FUTURE_MODEL_AUTO_PASS |
| IG17-025 | 当前全部published模型覆盖 | 实施时真实清单逐一有schema/compiler/adapter/result/recovery证据 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-026 | 动态N×N有向模型切换矩阵 | 从真实published快照生成；当前10模型全覆盖；新增模型自动进入 | R5_DYNAMIC_MATRIX_AUTO_PASS |
| IG17-027 | 旧Canvas兼容 | v1 checkpoint、旧edge角色只按需无损规范化，不批量改图 | R2_TARGETED_AUTO_PASS |
| IG17-028 | 旧任务/revision兼容 | 历史任务按冻结connector/revision/profile/credential恢复 | R6_FAULT_AUTO_PASS |
| IG17-029 | 安全边界不回退 | owner/run/task/ownership/node/kind/revision/CAS与SSRF/secret门通过 | EIGHTEENTH_REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-030 | 浏览器三组真实规模fixture | A可恢复失败、B/C继续、Seedance自动迁移，下游全部完成 | R7_COMPOSITE_BROWSER_TARGETED_PASS |
| IG17-031 | 风险定向回归 | 新spec和直接依赖全绿，命令/环境/源码hash/异常数完整记录 | R7_TARGETED_REGRESSION_PASS |
| IG17-032 | 唯一正式safe full | 仅候选冻结+Review GO后按风险执行一次；原始结果诚实记录 | CONSUMED_FAILED_1023_PASS_95_FAIL_4_NOT_RUN |
| IG17-033 | 独立终审 | 冻结候选P0=0/P1=0/GO | REMEDIATION_REVIEW_P0_0_P1_0_P2_1_GO |
| IG17-034 | GitHub/不可变发布 | 当前Goal已授权：PR/main CI、tag/Release、fresh build | VERSION_V0_6_57_TARGETED_PASS_COMMIT_READY |
| IG17-035 | 生产备份/恢复/回滚 | 当前Goal已授权：冻结备份、恢复副本、原子切换、稳定门 | AUTHORIZED_NOT_RUN |
| IG17-036 | 真实Provider最小验收 | 当前Goal累计USD100内已授权；unknown禁止第二POST | AUTHORIZED_NOT_RUN |
| IG17-037 | 用户实页验收 | 产品发布后由用户按五步清单确认；当前尚未实施 | NOT_RUN |
| IG17-038 | checkpoint降为缓存 | 缺失/损坏/清空后由Canvas绑定+服务端task重建；无关组不阻塞 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-039 | snapshot变化安全自动续作 | accepted只恢复原task；旧pending POST=0；当前图新run自动继续 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-040 | Canvas模型切换真原子 | 一个before/after图事务、一个undo、一个保存版本；失败完整回滚 | EIGHTEENTH_REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-041 | 三层边界无过度耦合 | 共享语义层无React/HTTP；UI无Provider字段；adapter不改Canvas | R2_BOUNDARY_REVIEW_PASS |
| IG17-042 | 用户通知不骚扰 | 30次轮询最多1个中性状态；恢复成功红错0；终态红错最多1 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-043 | 结果不去外部找 | 正常结果自动回原节点；普通UI无Provider URL/task ID/外部核对文案 | R6_EXPERIENCE_REVIEW_PASS |
| IG17-044 | 不可恢复失败诚实收口 | 不换模型、不改Prompt、不绕审核；仅受影响分支终止且其他结果保留 | R6_FAULT_AUTO_PASS |
| IG17-045 | 当前模型先注册再关兜底 | 全部published显式registry+零Provider shadow一致；历史runtime保留 | R4_MIGRATION_REVIEW_PASS |
| IG17-046 | 灰度回退不放宽安全 | 两个V2开关可止损；unknown始终零新POST；稳定后有清理门 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |

说明：历史候选与唯一正式full原始结论不改写。第十九候选两路完整只读终审曾合并为`P0=0/P1=0/P2=1/GO`；随后唯一正式full暴露`95 FAIL / 4 NOT_RUN`并永久消费。现27个失败spec及4项NOT_RUN均已逐项执行闭合；最后m73 `16/16`、m77 `11/11`，合计`27/27 PASS`，source/snapshot`720b0ea6…a9499c`，异常0、4173 unchanged。失败映射P1已关闭，但整改后独立增量终审仍待执行；GitHub、版本、生产和真实Provider仍未运行，Provider POST/费用仍为0。

冻结证据：六份治理同步后safe m38 `16/16 PASS`，库存1124、source/snapshot`7246af43…45b11`、异常0、4173 unchanged；产品/测试候选以`720b0ea6…a9499c`冻结，当前仅等待独立只读增量终审。

独立增量终审最终覆盖96/96个安全范围改动文件（产品/类型60、测试36）及六份治理文档，结论`P0=0/P1=0/P2=1/GO`。P2仅为legacy terminal reconciliation未显式消费cache corruption信号；零新task/Provider POST且有现存admission/scope/fresh-match围栏，已登记为非阻断。R7现可开始，正式full不重跑。

R7组合浏览器证据为m22 `44/44`、m68 `4/4`与最终m30 `13/13 PASS`，有效合计`61/61`；m22覆盖三组真实规模fixture、失败/停止/刷新与零重复task，m68覆盖任务面板/兄弟组恢复，m30覆盖Seedance遗留首帧角色原子迁移。最终m30 source/snapshot`5fc0da23…8d35`，失败/重试/跳过/reportErrors0，4173 unchanged。首轮`60/61`仅为测试断言落后于更严格的产品上传门；只对齐断言后通过。此证据标为组合验收，不宣称单一monolithic场景。

R7治理safe m38随后`16/16 PASS`，库存1124、source/snapshot`26bbf3a8…82c3`、异常0、4173 unchanged；R8前置治理门闭合。

R8版本门已确认`v0.6.57`为最低未占用patch；origin/main与基线一致，本地/远端tag和GitHub Release均未占用。package/lock与final runtime版本门已同步，生产仍为v0.6.56/schema41；版本定向测试待执行。

版本safe m38+m81 `57/57 PASS`，source/snapshot`2e0c5fee…0c3a5`、库存1124、异常0、4173 unchanged；候选提交前治理m38待执行。

候选提交前治理m38 `16/16 PASS`，source/snapshot`d82e3545…b945b`、库存1124、异常0、4173 unchanged；本地候选提交就绪。
