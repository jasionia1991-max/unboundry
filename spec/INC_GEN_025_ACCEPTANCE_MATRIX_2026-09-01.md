# INC-GEN-025 服务端权威整组执行验收矩阵

状态：`HISTORICAL_CLAIM_SNAPSHOT / POST_RELEASE_AUDIT_INVALIDATED_CURRENT_GO / SUPERSEDED_BY_INC_GEN_026`

> 本表中的 `AUTO_PASS/GO` 是 INC-GEN-025 当时时点声明，后置审计已证明它们不能作为当前可靠性或再次发布依据。不得逐项继承到 INC-GEN-026；当前验收以 `spec/INC_GEN_026_ACCEPTANCE_MATRIX_2026-09-01.md` 为准。

状态定义：

- `DOC_PASS`：事实或方案已由本轮代码审计和用户接受确认；不代表实现完成。
- `AUTO_PASS`：本 Goal 内已由当前只读证据或明确授权自动确认；不代表后续技术门已通过。
- `NOT_RUN`：尚未实施或验证。
- `USER_RECHECK`：只能由用户在真实页面完成的主观验收。
- `NO_GO`：条件未满足时禁止进入发布或真实付费验收。

## A. 权威与范围

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG25-001 | 最终审计与架构方向 | DOC_PASS | 用户接受最终审计；文档冻结为当前方案 |
| IG25-002 | 当前生产身份 | DOC_PASS | v0.6.69/schema41；最近真实点击0新POST、0费用、无素材 |
| IG25-003 | 目标分母 | DOC_PASS | 精确 Canvas/group；11 nodes/24 edges；7 text/3 image/1 video |
| IG25-004 | 音频口径 | DOC_PASS | 无独立Audio节点；以目标视频音轨为验收对象 |
| IG25-005 | INC-GEN-024 候选结论 | DOC_PASS | 保留诊断证据，标记SUPERSEDED_NO_GO，不发布 |
| IG25-006 | 当前授权边界 | AUTO_PASS | 最新 `/goal` 已一次性授权实现、v0.6.70、发布、成对生产迁移/回退及门通过后的唯一真实点击 |

## B. 不变计划与共享语义

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG25-007 | 共享纯语义编译器 | AUTO_PASS | client/server共用node、DAG、fingerprint与冻结输入逻辑 |
| IG25-008 | 语义指纹排除运行字段 | AUTO_PASS | 输出、状态、错误、projection不参与run identity |
| IG25-009 | immutable run plan | AUTO_PASS | 准入后prompt/model revision/edges/input refs不再随Canvas变化 |
| IG25-010 | 下游输入解析 | AUTO_PASS | frozen plan + authoritative upstream task results；不等Canvas回填 |
| IG25-011 | Canvas编辑隔离 | AUTO_PASS | 运行中编辑只影响下一run |
| IG25-012 | 生产形状一致性 | AUTO_PASS | 目标11节点/24边的client预览与server plan完全一致 |

## C. 编排、状态与并发

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG25-013 | 最小workflow schema | AUTO_PASS | run/node只拥有编排、task link、projection、reservation字段 |
| IG25-014 | 不复制权威状态机 | AUTO_PASS | Provider/task/media/publication仍由原表决定 |
| IG25-015 | 原子node claim | AUTO_PASS | 多worker只能一个调度者；repeat no-op |
| IG25-016 | group与lock-set互斥 | AUTO_PASS | same group/overlap冲突，disjoint groups可并行 |
| IG25-017 | runtime复用 | AUTO_PASS | 复用现有role/startup recovery/shutdown drain，无第二scheduler |
| IG25-018 | stop语义 | AUTO_PASS | 未提交future nodes停止；accepted原任务继续收口 |
| IG25-019 | 浏览器退出恢复 | AUTO_PASS | close/refresh/device change不终止或复制run |

## D. Admission、幂等与Provider

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG25-020 | 内部admission application service | AUTO_PASS | HTTP与workflow runner共用；runner不自调HTTP |
| IG25-021 | 确定性idempotency key | AUTO_PASS | 相同run/node/semantic identity只关联一个task |
| IG25-022 | 崩溃后原task收敛 | AUTO_PASS | claim/admission/response各崩溃点恢复后无第二task/POST |
| IG25-023 | 所有Provider POST计数 | AUTO_PASS | 统计全部真实outbound POST，不缩窄为create语义 |
| IG25-024 | 结果不明围栏 | AUTO_PASS | OUTCOME_UNKNOWN只核对原task/attempt，0 retry POST |
| IG25-025 | Provider恢复等级 | AUTO_PASS | 目标每个text/image/video adapter均有代码/合同证据 |
| IG25-026 | workflow资格隔离 | AUTO_PASS | 不合格模型只阻止强保证workflow，不误伤普通单节点 |
| IG25-027 | 目标真实POST上限 | NO_GO | 新授权后一次点击，全部Provider POST总数≤11且无重试 |

## E. Media、容量与发布

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG25-028 | media-owned容量估算 | AUTO_PASS | 计入结果、staging、pending publication与并发峰值 |
| IG25-029 | 持久容量reservation | AUTO_PASS | 整组准入前预留，workflow只保存reservation id |
| IG25-030 | 每POST前容量复核 | AUTO_PASS | 不足在付费POST前fail-closed |
| IG25-031 | 三媒体durable staging | AUTO_PASS | Provider返回字节先可恢复，再标task完成 |
| IG25-032 | publication恢复 | AUTO_PASS | 同一字节自动续传，attempt/Provider POST不增加 |
| IG25-033 | reservation释放 | AUTO_PASS | 成功/终止/过期路径均可审计释放，无泄漏或过度释放 |

## F. Projection与用户体验

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG25-034 | projection与node success解耦 | AUTO_PASS | projection失败不降级、不阻塞、不触发Provider |
| IG25-035 | projection串行与恢复 | AUTO_PASS | per-Canvas序列化、CAS冲突可恢复、重复幂等 |
| IG25-036 | 浏览器一次创建 | AUTO_PASS | UI只create run一次并轮询服务端状态 |
| IG25-037 | localStorage降级为缓存 | AUTO_PASS | 缓存丢失仍能从服务端找回run |
| IG25-038 | 稳定错误与费用文案 | AUTO_PASS | 用户明确知道系统在核对/保存且不会重复扣费 |

## G. 迁移、测试与Review

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG25-039 | schema冻结副本演练 | AUTO_PASS | migration/repeat/integrity/FK/counts通过，生产未被测试写入 |
| IG25-040 | bridge与旧checkpoint | AUTO_PASS | 旧缓存不能调度Provider或永久阻止新server run |
| IG25-041 | drain与rollback pair | NOT_RUN | 关闭新准入；accepted run继续收口；旧runtime不读新schema |
| IG25-042 | 故障注入矩阵 | AUTO_PASS | 容量、claim、admission、Provider、publication、projection、restart全覆盖 |
| IG25-043 | 风险驱动测试 | AUTO_PASS | 唯一formal full原始1149/1154永久保留；5失败仅跑最小子集关闭，未运行第二次full |
| IG25-044 | 冻结候选完整Review | AUTO_PASS | R6为67 files/277 tracked hunks+15 untracked全文；R7同一Reviewer复审最终增量11文件并盘点当前72 files/299 tracked hunks，完整调用链与目标3模型分支，P0/P1/P2=0/GO |
| IG25-045 | 不过度审计 | AUTO_PASS | 不引入无关重构/基础设施，不用重复全量测试换取安心 |

## H. 发布与真实验收

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG25-046 | 版本确认 | AUTO_PASS | 用户已明确确认目标版本 v0.6.70；本次一次性使用 |
| IG25-047 | 发布授权 | AUTO_PASS | 用户已明确允许 v0.6.70 的 GitHub/Release/生产发布；只可在技术门后消费一次 |
| IG25-048 | 生产零付费门 | NOT_RUN | service/schema/data/model/capacity/plan preflight全绿且POST=0 |
| IG25-049 | 唯一真实整组 | NO_GO | 新真实授权后指定Canvas/group仅点击一次，CNY≤300等值 |
| IG25-050 | 图片交付 | NOT_RUN | 3个图片结果可见、可读、刷新后仍在 |
| IG25-051 | 视频与音轨交付 | NOT_RUN | 视频可播放，ffprobe存在音频流，刷新后仍在 |
| IG25-052 | 无用户手工回收 | NOT_RUN | 全程无需重复点击或访问Provider平台 |
| IG25-053 | 自动技术验收 | NOT_RUN | 只可写AUTO_PASS/TECHNICAL_PASS，不替代用户判断 |
| IG25-054 | 用户主观验收 | USER_RECHECK | 用户实页观看并明确确认后才可写USER_PASS |

当前汇总：`DOC_PASS 5 / AUTO_PASS 40 / NOT_RUN 6 / NO_GO 2 / USER_RECHECK 1`。R1-R5实现、R6完整Review、R7唯一formal safe full失败最小子集关闭及同一Reviewer增量GO已完成；原始full仍诚实记录为1149/1154，不冒充全绿。发布、生产成对迁移与真实点击尚未完成，因此IG25-041/048/050-053仍未通过，IG25-027/049继续`NO_GO`。
