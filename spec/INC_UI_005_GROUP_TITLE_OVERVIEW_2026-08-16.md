# INC-UI-005 组标题总览层级

状态：`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`
目标版本：`v0.6.4`

## 用户问题

普通节点标题在低缩放下已经可读，但多个Group/模板同时出现时，Group标题和组内节点标题会在屏幕空间堆叠；缩放时Group标题看起来还会相对组框漂移。

## 冻结修复合同

- Group标题继续使用屏幕空间补偿，与组框顶部保持约20px屏幕间隔，宽度限制为72～180px并保留省略。
- 15%总览时，组内节点标题默认隐藏；鼠标进入组或选中组时恢复，退出且未选中时重新隐藏。
- 不增加组标题栏，不增加组内视觉内边距或边框，不移动组内节点。
- 不改变Group/节点持久坐标、尺寸、连线、保存文档和普通未分组节点标题。

## 验收合同

- `GROUP-TITLE-001`：15%总览Group标题与组框间隔约20px，缩放后不漂移。
- `GROUP-TITLE-002`：Group标题屏幕宽度始终在72～180px内，长标题省略。
- `GROUP-TITLE-003`：组内节点标题总览默认隐藏，组hover或选中时恢复。
- `GROUP-TITLE-004`：没有新增标题栏、视觉边距、边框或节点位移。

## 自动与生产凭证

- 精确源码commit：`ba5805c4448e504d33238947ea9aec1dfa160166`，tree：`89dbef401b9ca9dd347e9127e1f309e3559cf2ce`。
- 正式安全全量：`118/118 specs、968/968 tests PASS`；失败、跳过、重试、blocked与reportErrors均0，真实Provider、付费生成与OSS请求0。
- 首个发布产物夹带旧dist，被真实浏览器门发现并拒绝；最终使用精确源码fresh build发布，未把错误产物作为完成结果。
- 生产current：`/opt/unboundry/releases/v0.6.4-inc-ui-005-20260816-r2`；公网版本与JS/CSS哈希、隔离启动、冻结备份恢复、service active+enabled、NRestarts0、schema39及数据不变门均通过。
- 登录Chrome在约27%缩放验证7个组的标题间距约22.69px、组内标题默认0可见；hover指定组后仅该组14个标题恢复。在15%最小缩放验证间距约21.5px、组内39个标题默认0可见、宽度保持102.59～180px。
- 详细回执：`spec/INC_UI_005_PRODUCTION_RECEIPT_2026-08-16.json`。自动与生产技术验证不代替用户肉眼验收。

## 发布边界

本次已获得并消费`v0.6.4`版本号和上线、commit、push、tag、合并PR授权。真实Provider、付费生成、OSS写入和schema迁移均未执行；后续新发布仍需新授权。
