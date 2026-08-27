# MODEL-CONTRACT-002 验收矩阵

状态：`PRODUCTION_V0_6_54_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / FINAL_REVIEW_GO / SAFE_FULL_PASS / USER_RECHECK`

| ID | 验收项 | 自动证据 | 当前状态 |
|---|---|---|---|
| MC2-001 | 合法 revision 1 不受当前 GK 政策漂移影响 | 脱敏 revision 1 fixture 校验通过，并明确报告 current policy drift | TARGETED_AUTO_PASS |
| MC2-002 | 篡改 document/compiler hash 与不支持版本 fail-closed | 稳定内部错误码覆盖 document、compiler、identity、runtime version；执行边界对外安全码、对内保留causeCode | TARGETED_AUTO_PASS |
| MC2-003 | GK revision 2 同时支持文字与恰好一张首帧 | fake compiler/request 快照；首帧绑定为 `params.images` 单元素数组 | TARGETED_AUTO_PASS |
| MC2-004 | 空 Prompt、非法角色/数量、任意网络/secret/未知字段零 POST | compiler、release policy 与 transport 负向用例 | TARGETED_AUTO_PASS |
| MC2-005 | 执行语义变化必须提升合同版本 | 请求合同或capability schema同版本变化均被 `EXECUTION_CONTRACT_VERSION_REQUIRED` 阻断 | TARGETED_AUTO_PASS |
| MC2-006 | 显式升级原子、CAS、幂等且不改 revision 1 | 合成激活故障整事务回滚；成功生成 revision 2；重复执行零新增 | TARGETED_AUTO_PASS |
| MC2-007 | 22 模板/34 GK 节点语义兼容 | m102读取R0生产只读脱敏冻结矩阵，逐真实模板/节点ID校验参数、来源、ready状态、显式角色/顺序及旧/新唯一模式，incompatible=0 | TARGETED_AUTO_PASS |
| MC2-008 | 11 模型升级治理与零 Provider 账本 | schema41、精确模型身份集合、Provider/profile/config/credential完整脱敏快照hash及事务CAS；固定staging allowlist、私有只读manifest摘要与数据库SHA；plan/apply/repeat、GK rev2、费用0 | TARGETED_AUTO_PASS |
| MC2-009 | `kwvideo-v2` 不伪造文字证据并从普通列表下架 | 无文字基础时 archive；默认/模板/active task 引用存在则阻断；历史 Canvas 保留 | TARGETED_AUTO_PASS |
| MC2-010 | 旧任务按 revision 1，新任务按 active revision 2 | task snapshot/历史首帧执行与 immutable revision 边界 | TARGETED_AUTO_PASS |
| MC2-011 | unknown outcome 与付费重试边界不回退 | m57 丢失响应仍保持 outcome-unknown 并阻断再次付费 | TARGETED_AUTO_PASS |
| MC2-012 | 模型管理、模板、relay 直接依赖无回归 | m12、m22、m57 定向通过 | TARGETED_AUTO_PASS |
| MC2-013 | schema41、owner、credential、SSRF、secret 与旧 runtime | 安全 runner 前置门、m102负向门及唯一正式full `122/122 specs、1085/1085 tests PASS` | AUTO_PASS |
| MC2-014 | 独立终审无 P0/P1 | 同一审查线程第四轮复核 `P0=0 / P1=0 / GO` | AUTO_PASS |
| MC2-015 | 真实 Provider/Generation/OSS/新费用 | 本 Goal 全程账本必须为0 | AUTO_PASS |
| MC2-016 | 用户真实成片质量 | 仅未来单独授权后由用户确认 | USER_RECHECK |
| MC2-017 | 共享Provider下无关账户无效凭证不全局阻断 | 凭证计数进入plan快照与CAS；模型级升级可完成，但账户真实任务仍按自身凭证fail-closed | TARGETED_AUTO_PASS |
| MC2-018 | v0.6.54不可变发布与生产切换 | PR/main CI、tag/Release、fresh build、候选和生产冻结副本双幂等演练、备份、原子切换、回滚门、33静态文件与66秒稳定门 | PRODUCTION_AUTO_PASS |
| MC2-019 | 生产零付费实页 | 普通已发布列表无kwvideo-v2；GK revision2/EXACT、文字与单首帧可见；console 0 error/warn，页面写动作0 | PRODUCTION_AUTO_PASS |

说明：自动通过只证明代码和 fake 合同，不代表真实 Provider 成片质量，也不等于 `USER_PASS`。正式 safe full 已在候选冻结、独立 Review 放行后执行且仅执行一次。
