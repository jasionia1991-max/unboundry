# MODEL-CONTRACT-001 验收矩阵

状态：`R0-R6_IMPLEMENTED / REVIEW_P0_0_P1_0_GO / TARGETED_AUTO_PASS / FORMAL_FULL_PENDING / USER_RECHECK`

说明：`AUTO_PASS`表示当前候选已有自动工程证据；`USER_RECHECK`保留给生产实页和成片主观验收。定向测试不是full，生产技术和用户质量不得由本矩阵自动升级。

| ID | 优先级 | 验收合同 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| MC-ARCH-001 | P0 | 产品能力、connector family、模型执行合同三层分离 | schema/port/import审查 | AUTO_PASS |
| MC-ARCH-002 | P0 | `ModelReleaseRevision`原子包含能力、执行、connector版本与Provider身份 | 事务与并发测试 | AUTO_PASS |
| MC-ARCH-003 | P0 | 已发布revision不可原地修改，变更只产生新revision | API/DB测试 | AUTO_PASS |
| MC-ARCH-004 | P0 | task在提交时冻结完整revision；发布/回滚不改变运行中任务 | 重启/漂移测试 | AUTO_PASS |
| MC-ARCH-005 | P0 | 管理员配置不能越过秘密、SSRF、计费、事务、媒体归属和合规代码边界 | 安全审查 | AUTO_PASS |
| MC-ARCH-006 | P1 | 四类生成节点与图片工具都进入R0分类，非Provider节点不被误纳入 | 只读清单与影响图 | AUTO_PASS |
| MC-ARCH-007 | P1 | 现有专用多结果能力不回归；通用v1只接一个主结果 | Suno等回归 | AUTO_PASS |
| MC-ARCH-008 | P0 | capability和execution不能分次发布或形成混合版本 | 故障注入/事务测试 | AUTO_PASS |
| MC-ARCH-009 | P1 | connector不足时明确要求代码升级，不允许配置猜测绕过 | 编译拒绝测试 | AUTO_PASS |
| MC-ARCH-010 | P1 | 本最终方案、矩阵、checkpoint、未来Goal相互一致并纳入权威路由 | 文档diff与链接检查 | DOC_PASS |
| MC-INPUT-001 | P0 | 一个模型可配置多个角色，一份具体输入只能选择一个角色 | schema/UI/API测试 | AUTO_PASS |
| MC-INPUT-002 | P0 | 同角色支持min/max/order/shape，数量越界提交为0 | 编译器与运行时测试 | AUTO_PASS |
| MC-INPUT-003 | P0 | 多种组合使用互斥显式模式；零命中或多命中均阻断 | 正反fixture | AUTO_PASS |
| MC-INPUT-004 | P0 | 禁止静默截断、丢弃、重排或未知角色降级 | request快照/零POST | AUTO_PASS |
| MC-INPUT-005 | P1 | final Prompt来源规则可声明且无文字时准确阻断 | 四节点fixture | AUTO_PASS |
| MC-INPUT-006 | P1 | 已发布角色ID不可复用；旧角色保留标签并显式修复 | 兼容迁移测试 | AUTO_PASS |
| MC-BIND-001 | P0 | 绑定来源只限模型ID、Prompt、参数、按角色输入、常量、task ID | compiler拒绝测试 | AUTO_PASS |
| MC-BIND-002 | P0 | 只允许冻结的有限转换集合 | property/fuzz测试 | AUTO_PASS |
| MC-BIND-003 | P0 | 目标只限connector开放的JSON/query/form槽位和基址下相对路径 | 编译与SSRF测试 | AUTO_PASS |
| MC-BIND-004 | P0 | 禁止JS、函数、循环、env、文件、任意Header/域名/JSONPath | 恶意合同fixture | AUTO_PASS |
| MC-BIND-005 | P1 | 后台以来源→转换→目标编辑；JSON仅脱敏只读预览 | 三视口/DOM测试 | AUTO_PASS |
| MC-BIND-006 | P0 | 相同revision与假输入产生相同规范请求和哈希 | 确定性快照 | AUTO_PASS |
| MC-TASK-001 | P0 | POST前重验active revision/profile/credential/model/hash，漂移即零POST | 并发测试 | AUTO_PASS |
| MC-TASK-002 | P0 | POST outcome unknown禁止重提，只允许有证据恢复 | 故障注入/POST计数0 | AUTO_PASS |
| MC-TASK-003 | P0 | provider task ID在首次poll前原子绑定task/attempt/revision | 事务顺序测试 | AUTO_PASS |
| MC-TASK-004 | P0 | 重启/刷新只查原task ID，不按新合同重新提交 | 恢复测试 | AUTO_PASS |
| MC-TASK-005 | P0 | 未知状态、缺task ID、格式异常全部fail-closed | fake Provider矩阵 | AUTO_PASS |
| MC-TASK-006 | P0 | poll并发、间隔、退避、次数与总时长受代码硬上限 | 时钟与负载测试 | AUTO_PASS |
| MC-TASK-007 | P1 | 回滚只影响新任务；旧任务继续冻结修订 | 双revision测试 | AUTO_PASS |
| MC-TASK-008 | P1 | 紧急停止阻断新POST，安全时不阻断旧任务poll | revoke测试 | AUTO_PASS |
| MC-TASK-009 | P1 | cancel仅在connector正式支持时出现并调用 | 能力/UI/fake测试 | AUTO_PASS |
| MC-SAFE-001 | P0 | 合同不能读取或显示秘密、Authorization、Cookie、签名URL | 扫描与reflection测试 | AUTO_PASS |
| MC-SAFE-002 | P0 | 结果仍经过公网HTTPS、SSRF/DNS、重定向、类型和大小门 | 恶意URL矩阵 | AUTO_PASS |
| MC-SAFE-003 | P0 | 401/403/429/网络/超时/5xx/格式错误不触发fallback | fake Provider计数 | AUTO_PASS |
| MC-SAFE-004 | P1 | fallback仅显式声明且通常限404/405 | endpoint矩阵 | AUTO_PASS |
| MC-SAFE-005 | P0 | cost/refund只作审计，不改余额、不单独触发重试 | 账本与重试测试 | AUTO_PASS |
| MC-SAFE-006 | P0 | Provider profile与账号凭据不跨商业身份回退 | 多profile隔离测试 | AUTO_PASS |
| MC-SAFE-007 | P0 | 所有测试使用临时目录、动态loopback、fake Provider/OSS，4173与生产零触碰 | safe runner回执 | AUTO_PASS |
| MC-UI-001 | P1 | 使用独立模型合同工作台，不继续堆进长卡片/弹窗 | 路由与组件审查 | AUTO_PASS |
| MC-UI-002 | P1 | 列表展示Provider/能力/状态/revision/健康/模板影响/新任务可用性 | 三视口验收 | AUTO_PASS |
| MC-UI-003 | P1 | 详情八区块渐进披露，桌面三栏、≤928px单列 | 1280/1440/1920/窄屏 | AUTO_PASS |
| MC-UI-004 | P0 | 保存草稿、本地验证、发布、回滚、停止新任务严格分离 | UI/API副作用测试 | AUTO_PASS |
| MC-UI-005 | P0 | 编辑后旧验证失效；未保存离开警告；Enter不能发布 | 键盘/导航测试 | AUTO_PASS |
| MC-UI-006 | P0 | 发布确认准确说明新旧任务、模板影响且Provider调用0 | network与文案断言 | AUTO_PASS |
| MC-UI-007 | P0 | 草稿使用CAS；冲突可重载、看diff、复制未保存内容且不静默覆盖 | 并发管理员测试 | AUTO_PASS |
| MC-UI-008 | P1 | 对齐深色灰阶、圆角、控件、focus；警告橙、危险红、无原生蓝 | 视觉基线 | AUTO_PASS / USER_RECHECK |
| MC-UI-009 | P1 | 键盘、焦点回归、inert、字段错误关联、非仅颜色状态通过 | a11y/实页测试 | AUTO_PASS / USER_RECHECK |
| MC-UI-010 | P1 | 无横溢、裁切、菜单遮挡、sticky覆盖 | 四视口截图/命中测试 | AUTO_PASS / USER_RECHECK |
| MC-COMPAT-001 | P0 | 旧参数不被新默认值静默归一化 | 旧Canvas fixture | AUTO_PASS |
| MC-COMPAT-002 | P0 | 旧枚举/角色保留原值和标签，不支持时友好阻断 | 迁移/UI测试 | AUTO_PASS |
| MC-COMPAT-003 | P0 | 发布只检查模板，不自动改写；不兼容模板阻断或独立版本化/停用 | 模板diff=0与发布测试 | AUTO_PASS |
| MC-COMPAT-004 | P0 | 历史任务/结果继续按原合同可读和恢复 | 双版本恢复测试 | AUTO_PASS |
| MC-COMPAT-005 | P1 | 普通用户不看到JSON/hash/connector技术信息 | 普通账号DOM测试 | AUTO_PASS |
| MC-GK-001 | P0 | GK文生视频发送Prompt且无媒体字段 | request快照 | AUTO_PASS |
| MC-GK-002 | P0 | GK首帧模式只接受恰好1张`first-frame`图片 | 正反fixture/零POST | AUTO_PASS |
| MC-GK-003 | P0 | 首帧URL按顺序进入`params.images`数组 | request快照 | AUTO_PASS |
| MC-GK-004 | P0 | 创建POST `/v1/media/generate`，task=`task_id`，查询GET `/v1/media/status?task_id=`，结果=`result_url` | fake Provider端到端 | AUTO_PASS |
| MC-GK-005 | P0 | 无证据的尾帧、多图、视频/音频参考等均不可发布 | compiler拒绝 | AUTO_PASS |
| MC-GK-006 | P1 | 旧/新本地shadow compare不产生第二个Provider POST | 请求捕获计数 | AUTO_PASS |
| MC-GK-007 | P1 | 请求正确与服装视觉一致性分开记账，不能自动写质量PASS | receipt/状态审查 | AUTO_PASS / USER_RECHECK |
| MC-MIG-001 | P0 | R0列全四节点、图片工具、模型、模板和恢复路径，分类EXACT/SPECIALIZED/GENERIC_GUESS/UNKNOWN | `MODEL_CONTRACT_001_R0_INVENTORY_2026-08-26.md` | AUTO_PASS |
| MC-MIG-002 | P0 | R1底座完成前不切运行时 | feature gate/回归 | AUTO_PASS |
| MC-MIG-003 | P0 | GK先行，其他relay逐模型迁移，不按共用端点推断共用字段 | 分批清单 | AUTO_PASS |
| MC-MIG-004 | P1 | 文字/GPT Image/Ark/Mureka在各自connector内迁移，专用能力不降级 | 相邻回归 | AUTO_PASS |
| MC-MIG-005 | P0 | 只有全部发布模型、模板、恢复、安全、回滚和终审完成才关闭猜测式路径 | 关闭门报告 | FIXED / SAME_REVIEWER_RECHECK_PENDING |
| MC-RELEASE-001 | P0 | 草稿必须先静态编译、模板兼容、脱敏预览和fake矩阵才可发布 | 发布门集成测试 | AUTO_PASS |
| MC-RELEASE-002 | P0 | 发布前影响清单完整，发布动作本身Provider调用0 | audit/network记录 | AUTO_PASS |
| MC-RELEASE-003 | P0 | 候选冻结后独立只读终审P0=0/P1=0/GO | 审查回执 | FIRST_NO_GO / FIXED / RECHECK_PENDING |
| MC-RELEASE-004 | P1 | 风险驱动定向测试；无相关变化不重复full；正式safe full最多一次 | 测试账本 | TARGETED_AUTO_PASS / FULL_NOT_RUN |
| MC-RELEASE-005 | P0 | 自动、真实Provider、生产技术、用户质量状态严格分离 | 状态/receipt审查 | AUTO_PASS / PRODUCTION_NOT_RUN / USER_RECHECK |
| MC-RELEASE-006 | P0 | 未获新授权前无commit/push/PR/tag/Release/SSH/生产/真实Provider | Git/网络/费用账本 | AUTHORIZED / NOT_EXECUTED |

## 当前总判定

- 方案与实现：`R0-R6_IMPLEMENTED / TARGETED_AUTO_PASS`
- GK-video-3请求合同：`AUTO_PASS`；服装款式与成片视觉：`USER_RECHECK`
- 定向测试：首轮终审修复后的受影响组合5 specs、40/40通过；最终参数/文档最小复验2 specs、22/22通过；正式safe full：`NOT_RUN`
- 独立终审：首轮`P0=3 / P1=8 / NO-GO`，修复候选等待同一审查线程复核
- 真实Provider控制面/生成、OSS写入、费用：`0 / 0 / 0 / 0`
- 发布：`AUTHORIZED_NOT_STARTED`
- 生产技术：`NOT_RUN`
- 用户成片质量：`USER_RECHECK`
