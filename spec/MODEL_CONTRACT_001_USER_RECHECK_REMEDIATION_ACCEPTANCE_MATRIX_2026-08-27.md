# MODEL-CONTRACT-001 用户复验失败修复验收矩阵

状态：`BASELINE_15_OF_27_PASS / PRODUCTION_V0_6_51_TECHNICAL_PASS / REVIEW_P0_0_P1_0_GO / FORMAL_FULL_EXECUTED_ONCE_1077_OF_1079 / USER_RECHECK`

R0与版本A/B证据保持不变。独立Review最终`P0=0/P1=0/GO`；唯一正式full在`e56df4e`执行一次为1077/1079，唯二陈旧断言定向通过且没有第二次full。PR #116及main Quality通过并合并为`0c63938536a3056b1b1f652486d2ea5c72ad283f`；注释tag/GitHub Release v0.6.51、fresh build、冻结恢复、原子切换与回滚门、数据/33静态文件/66秒稳定门和四视口零付费生产浏览器均通过。生产为v0.6.51/schema41，真实Provider POST、Generation、OSS写和新费用均0；一次性发布授权已消费。权威回执为`spec/V0_6_51_PRODUCTION_RECEIPT_2026-08-27.json`，用户状态仍为`USER_RECHECK`。

### 27项候选执行账本

| 项目 | 候选结论 | 证据/边界 |
|---|---|---|
| 1、2、3、4、6、7、8、9、25 | CANDIDATE_COMPUTER_USE_PASS | 11张模型卡、三列八区、三态、零写本地校验、脱敏预览、草稿持久、内部ID不可编辑、四视口m102 |
| 5 | USER_RECHECK | 已执行未保存编辑与重载；浏览器运行时未暴露beforeunload对话框类型，不能冒充通过 |
| 10、11 | USER_RECHECK / API_AUTO_PASS | 发布/回滚自动合同有证据；浏览器确认对话框导致运行时重置，缺少完整UI确认 |
| 12、13、14、15、19、20、21、22、23、24、26、27 | USER_RECHECK / INSUFFICIENT_BROWSER_EVIDENCE | 已到候选或前置边界；缺少真实节点/键盘/双管理员/旧任务或截图闭环 |
| 16 | BLOCKED_BY_EXACT_EVIDENCE | GK文生视频为`UNKNOWN/BLOCKED`，零POST是当前正确结果 |
| 17 | BLOCKED_BY_REAL_PROVIDER_FEE_GATE | 既有`⚡2.182`不能换算人民币，未获可核验费用前不发真实请求 |
| 18 | BLOCKED_NO_NEW_PAID_VIDEO | 没有为截图或验收发起新付费视频 |

这张账本表示“已经执行并诚实记录结果”，不表示27项全部通过；任何候选/自动证据都不能升级为`USER_PASS`。

本矩阵只管理 2026-08-27 用户真实验收暴露的返工，不改写 v0.6.50 的历史生产技术回执。`AUTO_PASS`、真实 Provider、生产技术、Computer Use 和 `USER_PASS` 分层记录；任何一层不能替代另一层。

## A. 付费安全与任务恢复

| ID | 优先级 | 验收合同 | 最低证据 | 当前状态 |
|---|---:|---|---|---|
| MCR-A-001 | P0 | Provider 请求可能越过付费边界但无 task ID 时进入 unknown，禁止第二次 POST | fake Provider 响应丢失/计数 | TARGETED_AUTO_PASS |
| MCR-A-002 | P0 | 平台搜索/用量匹配为空不能证明未提交 | fake 查询空 + retry decision | TARGETED_AUTO_PASS |
| MCR-A-003 | P0 | “核对结果”只查询原任务，不创建新 attempt | API/浏览器 POST 计数0 | API_TARGETED_AUTO_PASS / BROWSER_PENDING |
| MCR-A-004 | P0 | 只有权威未受理/未计费或已退款证据才允许重新生成 | recovery policy矩阵 | TARGETED_AUTO_PASS |
| MCR-A-005 | P0 | 刷新、重启、双标签和重复点击不增加 Provider POST | task/attempt幂等回归 | TARGETED_AUTO_PASS / BROWSER_PENDING |
| MCR-A-006 | P0 | 429、超时、5xx、格式异常不自动重提或换端点 | Mureka/fake错误矩阵 | TARGETED_AUTO_PASS |
| MCR-A-007 | P0 | unknown 显示“可能已扣费、禁止重试”和脱敏恢复证据 | Computer Use + DOM/a11y | UI_LOGIC_AUTO_PASS / COMPUTER_USE_PENDING |
| MCR-A-008 | P0 | GPT Image 已知成功结构正确进入安全结果提交链 | 脱敏真实结构fixture + fake | TARGETED_AUTO_PASS |
| MCR-A-009 | P0 | GPT Image 未知成功结构不丢证据、不付费重提 | fake未知结构 | TARGETED_AUTO_PASS |
| MCR-A-010 | P1 | 每次 attempt 记录 revision、指纹、关联号、确定性和重试原因且不泄密 | DB/API/secret scan | DB_TARGETED_AUTO_PASS / UI_EVIDENCE_PENDING |

## B. 模式级合同与运行中任务

| ID | 优先级 | 验收合同 | 最低证据 | 初始状态 |
|---|---:|---|---|---|
| MCR-B-001 | P0 | 证据等级落到具体模式，不能用一个模型级 EXACT 覆盖不确定模式 | schema/compiler/API | TARGETED_AUTO_PASS |
| MCR-B-002 | P0 | GK 文生视频在正式证据恢复前 `UNKNOWN/BLOCKED`、零 POST | admission + fake计数 | TARGETED_AUTO_PASS / REAL_DOC_BLOCKED |
| MCR-B-003 | P0 | GK 首帧模式仅接受 Prompt + 恰好1张 first-frame，进入 `params.images` | compiler/request快照 | TARGETED_AUTO_PASS |
| MCR-B-004 | P0 | GK 多图、尾帧、参考视频、空 Prompt 和未知角色均客户端/服务端零 POST | 负向矩阵 | TARGETED_AUTO_PASS |
| MCR-B-005 | P0 | 发布、回滚只影响新任务，运行中任务冻结原 revision | 双revision重启恢复 | INSUFFICIENT_EVIDENCE |
| MCR-B-006 | P1 | Suno 专用有序多结果不被通用单结果吞掉 | specialized connector回归 | RECHECK_REQUIRED |

## C. 合同工作台状态与 CAS

| ID | 优先级 | 验收合同 | 最低证据 | 初始状态 |
|---|---:|---|---|---|
| MCR-C-001 | P1 | 页面分别显示未保存内容、已保存草稿和当前发布版本 | Computer Use四视口 | CANDIDATE_AUTO_PASS / USER_RECHECK |
| MCR-C-002 | P1 | 无草稿时明确显示“已保存草稿：无” | UI/API fixture | CANDIDATE_AUTO_PASS |
| MCR-C-003 | P0 | 本地校验当前页面零保存、零发布、零 Provider、零 CAS | API/Network计数0 | CANDIDATE_AUTO_PASS |
| MCR-C-004 | P0 | 仅保存草稿/发布使用草稿 CAS | service/API测试 | CANDIDATE_AUTO_PASS |
| MCR-C-005 | P0 | 只有稳定错误码 `MODEL_CONTRACT_DRAFT_CONFLICT` 显示冲突 | 409/error-code矩阵 | CANDIDATE_AUTO_PASS |
| MCR-C-006 | P1 | 真实双管理员旧 revision 写入不覆盖，支持重载/差异/复制未保存内容 | 双标签 Computer Use | RECHECK_REQUIRED |
| MCR-C-007 | P1 | 本地校验按钮始终显示可执行或不可执行的精确原因 | UI/DOM/键盘 | CANDIDATE_AUTO_PASS / USER_RECHECK |
| MCR-C-008 | P1 | 当前页面、草稿、发布版均有可发现的脱敏只读预览 | Computer Use + secret scan | CANDIDATE_AUTO_PASS |

## D. 文档、模式/角色与 UI

| ID | 优先级 | 验收合同 | 最低证据 | 初始状态 |
|---|---:|---|---|---|
| MCR-D-001 | P1 | 官方文档必须是精确来源；占位符、首页、营销页不能支持 EXACT | seed/source审查 | CANDIDATE_AUTO_PASS |
| MCR-D-002 | P1 | 文档建议只进入新草稿，不静默修改发布 revision | API/DB不变证据 | NOT_PROVEN |
| MCR-D-003 | P1 | 模式 ID 和角色 ID 自动生成；普通管理员只操作中文语义 | Computer Use | CANDIDATE_AUTO_PASS |
| MCR-D-004 | P1 | 修改稳定内部 ID 前校验历史 revision、模板和引用完整性 | API负向测试 | NOT_PROVEN |
| MCR-D-005 | P1 | checkbox/select/input 对齐项目 UI，无原生蓝色控件 | 四视口截图/DOM | CANDIDATE_AUTO_PASS / SCREENSHOT_RECHECK |
| MCR-D-006 | P1 | 只读值不用可编辑输入框，不靠隐藏 caret 掩盖 | DOM/键盘/读屏语义 | CANDIDATE_AUTO_PASS |
| MCR-D-007 | P1 | Tab/Shift+Tab/focus return/inert/error association/非仅颜色状态通过 | 键盘 Computer Use | RECHECK_REQUIRED |
| MCR-D-008 | P1 | 1280×720、1440×900、1920×1080、900×900、≤928px无溢出遮挡 | Computer Use | RECHECK_REQUIRED |

## E. 兼容、数据与发布门

| ID | 优先级 | 验收合同 | 最低证据 | 初始状态 |
|---|---:|---|---|---|
| MCR-E-001 | P0 | Text/Image/Video/Audio 四节点不回归 | fake Provider + 浏览器 | RECHECK_REQUIRED |
| MCR-E-002 | P0 | 图片工具源图/reference/mask/operation identity 与 owner 边界不回归 | fake/ownership矩阵 | RECHECK_REQUIRED |
| MCR-E-003 | P0 | 旧 Canvas、旧模板、历史 success 和带 task ID 旧任务不被改写/重提 | 恢复兼容测试 | VERSION_A_TARGETED_AUTO_PASS / FINAL_RECHECK_PENDING |
| MCR-E-004 | P0 | 合同草稿 CAS 不改变 Canvas DATA-005 跨标签语义 | m20/Canvas回归 | NOT_PROVEN |
| MCR-E-005 | P0 | schema 不变或完成真实恢复副本、旧 runtime 拒绝与回滚演练 | DB/release gate | SCHEMA41_UNCHANGED / RELEASE_GATE_PENDING |
| MCR-E-006 | P0 | 全量 Review 为 `P0=0 / P1=0 / GO` | 冻结候选独立只读review | PASS / P0_0_P1_0_GO |
| MCR-E-007 | P0 | 本 Goal 唯一正式 safe full 完成，失败后不重复刷 full | safe receipt | EXECUTED_ONCE_1077_OF_1079 / TWO_STALE_ASSERTIONS_TARGETED_PASS / NO_SECOND_FULL |
| MCR-E-008 | P0 | 27 项旧用户清单由 Computer Use 全部重跑并记录请求/费用 | 逐项浏览器证据 | EXECUTED_WITH_BLOCKERS / USER_RECHECK |
| MCR-E-009 | P0 | 发布前停在授权门，未取得授权不 merge/tag/Release/生产写入 | Git/生产零写账本 | PASS / AUTHORIZATION_RECEIVED_AND_CONSUMED / PRODUCTION_V0_6_51_TECHNICAL_PASS |
| MCR-E-010 | P0 | 最终状态不超过生产技术通过；无用户复验不得升级USER_PASS | 文档一致性 | PASS / PRODUCTION_V0_6_51_TECHNICAL_PASS / USER_RECHECK |

## F. 费用与停止条件

- 本轮此前可追溯平台单位合计 `⚡2.182`，不能换算为人民币时不得虚构金额。
- 新 Goal 的真实生成总费用上限为人民币 20 元，且必须包含本轮此前能够证明的人民币费用；无法证明换算时，真实付费分支保持阻断。
- fake Provider、既有任务和只读 Provider 查询可以证明的，不得调用真实生成。
- 任一请求进入 `OUTCOME_UNKNOWN` 立即停止该 Provider 的后续付费验收，继续完成所有不依赖工作。
- 自动证据、Computer Use、真实 Provider、生产技术和用户质量分别记账；只有用户明确确认才能写 `USER_PASS`。
