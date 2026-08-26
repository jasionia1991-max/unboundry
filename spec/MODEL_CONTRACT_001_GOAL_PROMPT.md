# MODEL-CONTRACT-001 未来开发 Goal 提示词

状态：`READY_FOR_FUTURE_GOAL / NOT_AUTHORIZED`

说明：本文件是未来用户复制到新 Session 的授权模板。它不是当前授权，当前 Session 不得据此开始代码、测试、Git、Provider或生产动作。启动前应根据当时真实状态复核并更新版本与发布范围。

```text
/goal 严格按 MODEL-CONTRACT-001 权威方案完成模型执行合同治理的 R0 只读盘点、分阶段实现、风险驱动验证、独立终审和文档同步。默认只做到本地工程候选与用户审阅；本 Goal 不自动包含真实 Provider、commit/push/PR/tag/Release、SSH或生产发布，除非我在启动本 Goal 时另行逐项明确授权。

一、先确认真实项目身份

不要复用文档里旧分支或旧SHA。先从当时最新的 `main = origin/main` 创建新的干净隔离worktree；核对仓库身份、pwd、branch、HEAD/tree、origin/main/tree、git status和所有差异归属。若main已前进，先审查新提交与本方案的冲突，不得丢弃用户改动。

核对package版本、schema、`.node-version`、npm packageManager、默认Node/npm、生产Node/npm、当前生产版本、tag/Release占用和4173监听身份。身份冲突时停止并报告证据。

永远禁止读取、修改、暂存、提交、移动或删除：
spec/public-templates-director-split-revision.json

禁止reset --hard、git clean、checkout覆盖、清理其他工作树或用户数据。

二、完整阅读顺序

1. AGENTS.md
2. 上线规矩.md
3. spec/UNBOUNDRY_CURRENT_STATE.md
4. spec/MODEL_CONTRACT_001_CHECKPOINT.md
5. spec/MODEL_CONTRACT_001_MODEL_EXECUTION_CONTRACT_GOVERNANCE_PLAN_2026-08-26.md
6. spec/MODEL_CONTRACT_001_ACCEPTANCE_MATRIX_2026-08-26.md
7. TASKS.md顶部MODEL-CONTRACT-001区块
8. spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md顶部当前区块
9. spec/UNBOUNDRY_RELAY_MEDIA_MODELS_INTEGRATION_PLAN_2026-08-21.md
10. spec/UNBOUNDRY_RELAY_PROVIDER_INTEGRATION_PLAN.md
11. spec/UNBOUNDRY_ADMIN_MODEL_OSS_PLAN.md
12. spec/UNBOUNDRY_UPSTREAM_INPUT_REPLICATION_PLAN.md
13. spec/INC_GEN_014_WORKFLOW_SELF_HEALING_AND_CREDENTIAL_VERIFY_DECOUPLING_PLAN_2026-08-25.md
14. AGENTS.md要求的其余权威文档

三、冻结范围

严格实现主方案与验收矩阵，不得自行改成万能脚本平台。

覆盖：Text/Image/Video/Audio生成节点；图片工具的模型调用输入；产品能力合同、代码connector family、模型执行合同、不可变ModelReleaseRevision；模式/角色/数量；白名单请求绑定；task冻结、恢复、回滚、紧急停止；管理员独立工作台；兼容与模板检查。

不覆盖：非Provider节点的工作流脚本；任意JS/函数/循环/env/Header/域名/JSONPath；新协议/鉴权/模态；自动改写旧Canvas或模板；通用多主结果；无关UI改版；真实数据清理。

四、阶段顺序

R0 全量只读盘点：列出四类节点、图片工具、全部已发布模型、Provider profile、connector、schema、输入、task/poll/result/error、模板依赖和恢复路径；逐模型对照正式文档，分类EXACT/SPECIALIZED/GENERIC_GUESS/UNKNOWN并形成影响图。R0完成并写入checkpoint前不改运行时代码。

R1 底座：先补预期红；实现合同schema、connector-specific compiler、不可变revision、原子发布、task snapshot和审计，但不切旧运行时。

R2 后台工作台：独立路由；草稿服务端保存与CAS；模式/角色/数量/参数/绑定/任务结果编辑；脱敏预览；影响分析；发布/回滚/停止新任务；版本历史；可访问性与四视口。

R3 GK-video-3：只支持文生视频和单首帧生视频。首帧恰好1张，角色first-frame，目标params.images URL数组；POST /v1/media/generate；task_id；GET /v1/media/status?task_id=；result_url。先本地shadow compare且Provider POST=0，再只切GK新任务。

R4 其他relay media逐模型迁移，不按共用端点猜字段。

R5 文字与GPT Image按各自connector迁移，保留Files API、同步图片和专用尺寸合同。

R6 Ark native与Mureka native只迁移纯声明式差异；签名、资产、回调、多结果保留代码。

R7 只有全部发布模型、模板、恢复、安全、回滚和独立终审完成，才关闭generic guessing。

每阶段同步主方案实施记录、checkpoint、TASKS、CURRENT_STATE和两份验收矩阵。不得把计划、代码完成、AUTO_PASS、真实Provider、生产技术或USER_PASS混写。

五、安全与实现红线

- 管理员只能描述平台已支持的合同；新协议、新鉴权、新模态、新节点语义必须停在“需要代码升级”。
- Secret、Authorization、SSRF/DNS、域名、Header、重定向、硬大小限制、商业Provider隔离、计费幂等、unknown outcome、事务、Media/OSS ownership与合规永远由代码拥有。
- 一份输入只能一个角色；模式必须唯一命中；任何超量、歧义、未消费输入或未知角色均在Provider前阻断；不得静默截断、丢弃或猜测。
- published revision不可变；capability与execution原子发布；task冻结提交时revision；回滚只影响新任务。
- POST已发送但结果未知时禁止重提。provider task ID在首次poll前原子绑定；重启只查原task ID。
- 旧参数/枚举/角色不静默归一化；模板发布检查只读，不自动改写。
- 通用v1只接一个主结果，既有Suno等专用多结果不得回归。
- 请求合同正确只证明输入交付，不代表服装款式或视觉质量USER_PASS。

六、测试与审查

使用项目安全入口、动态loopback、本轮新临时目录、fake Provider/fake OSS。不得使用4173、app/data、生产路径、真实凭据、真实Provider、真实OSS或生产网络。

按风险先跑直接相关定向：schema/compiler/revision/API/admin UI、relay adapter、generation task/recovery、template compatibility、安全与deployment。失败只复验最小受影响集合；无新相关代码变化不重复成功测试；不得把定向称为full。

候选冻结后，如项目强制门要求，最多执行一次正式safe full。随后启动一个独立只读终审，检查P0/P1、重复付费、合同漂移、SSRF/秘密、任务恢复、模板/旧Canvas、并发管理员、UI可访问性和测试缺口。终审不得与实现并行；全部P0/P1关闭且结论GO后才形成可交用户审阅的候选。

七、权限边界

本模板默认授权本地只读盘点、直接相关代码/测试/fixture/OpenAPI/文档修改、临时fake服务、风险驱动测试和独立只读终审。

默认不授权：真实Provider或控制面、付费请求、生产读取/写入、真实OSS、用户数据操作、commit、push、PR、合并、tag、GitHub Release、SSH、备份、部署、版本号升级。

如需这些动作，必须以我启动Goal时的最新明确文字为准，分别核对版本号、费用/请求预算和发布授权。本文件中的旧状态或历史授权都不能复用。

八、停止条件与完成定义

普通代码bug、预期红、可修复测试失败不属于停止条件。只有身份/差异无法解释、受保护文件风险、需要扩展协议或安全边界、可能重复付费、需要真实凭据/Provider/生产、预算或发布权限缺失时停止。

本地完成必须满足：验收矩阵直接相关项有证据；GK精确合同通过fake端到端；四类节点和图片工具不存在未分类模型；模板与旧Canvas兼容门通过；候选无已知P0/P1且独立终审GO；文档与checkpoint同步；真实Provider=0、生产=0。最后停在USER_REVIEW，不得冒充发布或USER_PASS。
```
