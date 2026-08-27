# MODEL-CONTRACT-001 用户复验失败修复验收矩阵

状态：`BASELINE_15_OF_27_PASS / 12_FAIL_OR_INSUFFICIENT / VERSION_A_TARGETED_AUTO_PASS / VERSION_A_COMMIT_PENDING / USER_RECHECK`

R0证据：真实checkout/HEAD/tree、14 tracked + 3 untracked进入时差异、4173历史工作树归属、生产v0.6.50/schema41健康、GitHub版本占用和费用不可换算边界均已只读冻结。版本A当前源码已通过最小受影响safe定向：m5 `22/22`、m38 `15/15`、m22 `41/41`，以及未受后续改动影响的m102 `7/7`、m26 `10/10`、m53 `26/26`；本Goal到当前为真实Provider POST 0、OSS写0、生产写0、新费用0。Computer Use和正式full尚未执行。

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
| MCR-C-001 | P1 | 页面分别显示未保存内容、已保存草稿和当前发布版本 | Computer Use四视口 | FAIL_REAL / FIX_REQUIRED |
| MCR-C-002 | P1 | 无草稿时明确显示“已保存草稿：无” | UI/API fixture | FAIL_REAL / FIX_REQUIRED |
| MCR-C-003 | P0 | 本地校验当前页面零保存、零发布、零 Provider、零 CAS | API/Network计数0 | FAIL_REAL / FIX_REQUIRED |
| MCR-C-004 | P0 | 仅保存草稿/发布使用草稿 CAS | service/API测试 | FAIL_REAL / FIX_REQUIRED |
| MCR-C-005 | P0 | 只有稳定错误码 `MODEL_CONTRACT_DRAFT_CONFLICT` 显示冲突 | 409/error-code矩阵 | FAIL_REAL / FIX_REQUIRED |
| MCR-C-006 | P1 | 真实双管理员旧 revision 写入不覆盖，支持重载/差异/复制未保存内容 | 双标签 Computer Use | RECHECK_REQUIRED |
| MCR-C-007 | P1 | 本地校验按钮始终显示可执行或不可执行的精确原因 | UI/DOM/键盘 | FAIL_REAL / FIX_REQUIRED |
| MCR-C-008 | P1 | 当前页面、草稿、发布版均有可发现的脱敏只读预览 | Computer Use + secret scan | FAIL_REAL / FIX_REQUIRED |

## D. 文档、模式/角色与 UI

| ID | 优先级 | 验收合同 | 最低证据 | 初始状态 |
|---|---:|---|---|---|
| MCR-D-001 | P1 | 官方文档必须是精确来源；占位符、首页、营销页不能支持 EXACT | seed/source审查 | FAIL_REAL / FIX_REQUIRED |
| MCR-D-002 | P1 | 文档建议只进入新草稿，不静默修改发布 revision | API/DB不变证据 | NOT_PROVEN |
| MCR-D-003 | P1 | 模式 ID 和角色 ID 自动生成；普通管理员只操作中文语义 | Computer Use | FAIL_REAL / FIX_REQUIRED |
| MCR-D-004 | P1 | 修改稳定内部 ID 前校验历史 revision、模板和引用完整性 | API负向测试 | NOT_PROVEN |
| MCR-D-005 | P1 | checkbox/select/input 对齐项目 UI，无原生蓝色控件 | 四视口截图/DOM | FAIL_REAL / FIX_REQUIRED |
| MCR-D-006 | P1 | 只读值不用可编辑输入框，不靠隐藏 caret 掩盖 | DOM/键盘/读屏语义 | FAIL_REAL / FIX_REQUIRED |
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
| MCR-E-006 | P0 | 全量 Review 为 `P0=0 / P1=0 / GO` | 冻结候选独立只读review | NOT_STARTED |
| MCR-E-007 | P0 | 本 Goal 唯一正式 safe full 完成，失败后不重复刷 full | safe receipt | NOT_STARTED |
| MCR-E-008 | P0 | 27 项旧用户清单由 Computer Use 全部重跑并记录请求/费用 | 逐项浏览器证据 | NOT_STARTED |
| MCR-E-009 | P0 | 发布前停在授权门，未取得授权不 merge/tag/Release/生产写入 | Git/生产零写账本 | ACTIVE_GATE |
| MCR-E-010 | P0 | 最终状态不超过 `RELEASE_CANDIDATE_READY / USER_RECHECK` | 文档一致性 | ACTIVE_GATE |

## F. 费用与停止条件

- 本轮此前可追溯平台单位合计 `⚡2.182`，不能换算为人民币时不得虚构金额。
- 新 Goal 的真实生成总费用上限为人民币 20 元，且必须包含本轮此前能够证明的人民币费用；无法证明换算时，真实付费分支保持阻断。
- fake Provider、既有任务和只读 Provider 查询可以证明的，不得调用真实生成。
- 任一请求进入 `OUTCOME_UNKNOWN` 立即停止该 Provider 的后续付费验收，继续完成所有不依赖工作。
- 自动证据、Computer Use、真实 Provider、生产技术和用户质量分别记账；只有用户明确确认才能写 `USER_PASS`。
