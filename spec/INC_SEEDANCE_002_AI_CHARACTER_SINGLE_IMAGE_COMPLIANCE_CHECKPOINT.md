# INC-SEEDANCE-002：AI角色单图合规验证实时断点

更新时间：2026-08-25

状态：`BRANCH_C_SELECTED / PRODUCTION_V0_6_41_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_RECHECK`

权威方案：`spec/INC_SEEDANCE_002_AI_CHARACTER_SINGLE_IMAGE_COMPLIANCE_PLAN_2026-08-25.md`

## 1. 当前结论

- 正式一手合同只证明 Seedance 私域真人素材的 H5/Group/Asset/`asset://` 链；没有证明第三方角色审核票据能进入 Seedance `CreateContentsGenerationsTasks` 正式提交合同。
- 方舟私域虚拟人像权益需要额外付费开通，公开价格超出本事件预算；Sightengine/Hive公开合同也不足以同时证明人物、公众人物、版权IP、未成年人/敏感分类与本事件隐私要求。
- 因此 B 不成立；A 也没有合法、可用且合同覆盖完整的正式Provider。已按用户规则自动实施最高诚实层级 C：产品名固定为「角色风险预检」，入口准确关闭，不显示蓝勾，不声称Seedance验证、版权认证或法律合规。
- INC-SEEDANCE-001真人可信素材三表、状态和历史请求完全独立；没有迁移信任、重新提交H5或改写其历史结果。

## 2. 工作区身份

| 项目 | 当前值 |
|---|---|
| 真实仓库 | `/Users/mymy/Documents/unboundry/app` |
| 隔离工作树 | `/private/tmp/unboundry-seedance-ai-character-plan-20260825-vpJ0CN` |
| 分支 | `codex/seedance-ai-character-compliance-plan-2026-08-25` |
| 基线 / origin/main | `73f63adfa294f0d13c55d9998100115baa967c44`（2026-08-25冻结前复核一致） |
| package | `0.6.41` |
| schema | `41` |
| 生产 | `v0.6.41 / schema41 / /opt/unboundry/releases/v0.6.41-seedance-character-compliance-20260825` |

主工作树未清理；受保护`spec/public-templates-director-split-revision.json`未读取、修改、移动、删除、stage或提交。

## 3. R0～R8完成事实

- R0：官方合同核验完成并选择C；没有用通用视觉模型冒充正式审核。
- R1：预期红只暴露新spec/模块/库存尚不存在，产品测试执行0；随后进入最小实现。
- R2～R6：完成独立Port/Application/Store、fake Provider、16态、风险码、Check/Attempt/Disclosure schema41、owner/checksum/model/config/provider身份绑定、API/OpenAPI；C分支在菜单层禁用「角色风险预检」且保留INC-SEEDANCE-001「角色可信素材」入口。
- R7：Generation在task-create与provider-submit两处支持正式B快照复核；A票据在付费前拒绝，当前C没有票据或入口。Ark adapter在没有官方翻译合同时拒绝第三方ticket字段。
- R8：备份、恢复、媒体完整性、版本/bridge/release门同步schema41；新增严格schema40→41 dry-run/apply迁移，源逻辑SHA、物理合同、BEGIN IMMEDIATE、事务回滚、目标精确合同和专用runtime锁均由m91覆盖。

## 4. R9独立审查与定向验证

独立只读终审原始发现`1 P0 + 5 P1`，已逐项关闭：正式B票据现同时绑定并双重重查Generation模型/配置、Provider profile/账号指纹/配置版本/凭据版本/策略版本；INC-SEEDANCE-001入口已恢复且C入口在菜单层直接禁用；Attempt使用全局递增编号、显式outcome和仅限“明确未接收”的三次内手动重试；媒体删除不再删除合规审计；C入口不再先可点击再弹关闭面板。关闭后无剩余P0/P1。

固定环境均为Node `22.23.1`、npm `10.9.8`、fresh临时数据和动态loopback；4173 listener unchanged；没有读取`app/data`、`/var/lib/unboundry`、真实备份或真实媒体。

| 范围 | 最终结果 |
|---|---:|
| m101 角色合规应用/fake/Generation双门 | `4/4 PASS` |
| m2 Image菜单层禁用、保留真人可信入口、零请求与既有Image回归 | `13/13 PASS` |
| m20 API/OpenAPI | `1/1 PASS` |
| m5 Generation任务 | `21/21 PASS` |
| m10 备份恢复 | `17/17 PASS` |
| m91 schema迁移（含40→41 dry-run/CLI/apply） | `9/9 PASS` |
| m92版本兼容 | `2/2 PASS` |
| m95切换 | `5/5 PASS` |

历史诊断红均按最小范围修复：m91新增迁移最初因SQLite同连接事务backup及inspection root约束失败，修正为写锁连接+独立只读snapshot，并只复验m91；R9修复后受影响6-spec原始`63/65`，仅m2菜单项计数与m20新增retry路径展示计数失败，精确修正期望后只复验m2+m20并`14/14 PASS`，其余`51/51`有效通过未重复。

冻结功能候选commit `9f4ed1589bb4d8d65619186035a076f572409255`上已执行本Goal唯一safe full：`121/121 specs、1061/1061 tests PASS`，failed/skipped/retries/blocked/reportErrors均0，退出码0。source/snapshot均为`07a69e52e9b10cf5fcab53a576792ccd23cf5fcbd129f3830fc7b9a2a60c2863`，4173 listener unchanged。本次文档收口不改产品代码，不再运行第二次full。

## 5. R10～R11 GitHub与生产发布

- PR #96在Quality CI通过后squash merge为`59599df43898d45b25fadb422cfa3bfc8bc42dfb`，tree `2e7f1cd61da8e729a69b15d0299c71ab54f84eb6`；main Quality run `32776214629`成功。
- 注释tag `v0.6.41`精确指向merge commit，GitHub Release已发布；历史tag/Release未移动。
- 精确tag源码archive SHA-256 `b924bd6e…c6edfc1`；生产Node `22.23.2`、npm `10.9.8`完成fresh install/typecheck/build。release共5968文件，inventory `7a2f12dd…e884b3`。
- 冻结备份`/var/lib/unboundry-rollbacks/v0.6.41-cutover-frozen-K1ASo1`的source/restore各366文件，双清单SHA `5a5b2f9e…adb5a`。旧host wrapper因硬编码schema39拒绝schema40后，其本事件目录已原位隔离为`.legacy-backup-rejected-schema40`，未用于恢复或发布。
- 恢复副本完成schema40→41 dry-run与apply，源逻辑SHA `900f0df5…ad73`，目标schema41、integrity ok、FK0；同一源SHA的生产迁移成功，随后原子切换。
- 公网/回环version `0.6.41`、live/ready 200 active/schema41；service active+enabled、NRestarts0，新增service warning与NGINX error均0；release inventory与5项公网资源逐字节一致。
- 切换前后tasks785、attempts793、active0、media833、publications423、canvases63、data files366、media files355不变；新合规三表均0行，INC-SEEDANCE-001 sessions/groups/bindings仍为3/1/3。
- 生产浏览器三视口`1280×720 / 1440×900 / 1920×1080`均显示disabled「角色风险预检（当前不可用）」与enabled「角色可信素材」，刷新后状态一致；console error/warn 0，任务/attempt/合规行增量0，未点击真实审核或生成。
- 完整生产回执：`spec/V0_6_41_PRODUCTION_RECEIPT_2026-08-25.json`。

## 6. 请求、费用与数据账本

| 动作 | 已用 / 上限 |
|---|---:|
| 能力/目录/只读正式合同核验 | `0 Provider控制面请求；仅公开网页读取 / 20` |
| 真实合规审核创建 | `0 / 3` |
| 真实合规状态查询 | `0 / 30` |
| 其他受限只读核验 | `0 / 7` |
| 真实Seedance Generation | `0 / 1`（B未成立，门未打开） |
| OSS结果写入 | `0 / 1`（B未成立，门未打开） |
| 合规审核/Generation费用 | `0元 / 100元、0元 / 150元` |
| 订阅、套餐、席位、云权限 | `0` |

没有发送用户附件或任何真人、明星、公众人物、未成年人、版权IP图片；没有生成测试图，因为C分支不需要外部审核。

## 7. 下一动作

自动技术链已完成，当前仅进入`USER_RECHECK`。下一动作是用户打开v0.6.41生产图片工具菜单，确认disabled「角色风险预检（当前不可用）」与保留的enabled「角色可信素材」；无需新增授权。用户明确回复通过前不得写`USER_PASS`。
