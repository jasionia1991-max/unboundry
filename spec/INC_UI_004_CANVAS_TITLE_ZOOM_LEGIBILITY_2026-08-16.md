# INC-UI-004 画布标题缩放可读性

状态：`PRODUCTION_PUBLISHED_USER_PASS`

## 用户问题

节点标题当前使用世界坐标随画布一起缩放。画布缩小时，12px 标题会继续缩成不足以辨认的屏幕像素，且灰度过低；复杂工作流无法在总览视图中快速识别节点。

## 修复合同

- Text、Image、Video、Audio、Playlist、Storyboard 标题在 `zoom < 1` 时使用屏幕空间反向缩放；低于 35% 时保持约 12px，35% 及以上保持约 14px。
- 标题颜色提升到中高对比灰白、字重 500，并只增加轻微暗色文字阴影；不增加彩色状态或标题底板。
- 标题宽度按当前节点屏幕宽度计算，并限制在 96～180px；Storyboard 上限 220px。长标题继续单行省略，DOM `title` 保留完整值。
- Group 继续使用既有屏幕空间标题定位，只做轻度提亮，避免重复反向缩放。
- 总览档标题默认不拦截画布指针；选中节点仍可进入标题编辑。节点尺寸、位置、连线与保存文档均不改变。

## 验收方法

- 自动验证三个缩放档的 DOM 标记、反向缩放值、字体档位、颜色/字重、宽度、指针命中和七类标题省略合同。
- 在隔离动态端口打开真实 React 页面，分别以 100%、60%、15% 检查标题屏幕高度、截断和节点几何不变。
- 自动化、本地页面与上线技术验证不能代替用户肉眼验收；本次生产发布授权不包含 commit、push、tag 或 PR。

## 自动验证结果

- 相关6份spec：`16/16 PASS`，覆盖viewport、密集画布、两档字体、Group、Storyboard和INC-UI-004标题合同。
- 正式安全全量：`118/118 specs、968/968 tests PASS`；failed/skipped/retries/blocked/reportErrors均0。
- 生产构建PASS；source/snapshot SHA-256均为`e1bfb993cf6f4cb4d9567912b0b82487b63809875d881e8d8c3fb79b9417a843`；4173 listener前后不变，临时suite已清理。
- 自动浏览器断言已在真实React页面验证15%/60%档位、字体屏幕高度、反向缩放、颜色/字重/阴影、ellipsis、Group无双补偿与总览指针命中。
- 本轮真实Provider、付费生成和真实OSS请求均为0；未修改数据库、模型、模板或存储配置。

## 生产发布结果

- 生产已切到不可变目录`/opt/unboundry/releases/v0.6.3-inc-ui-004-20260816`，上一版`v0.6.3-inc-ui-003-r2-20260816`完整保留；公网版本仍为0.6.3，service active+enabled、`NRestarts=0`、ready active/schema39。
- 候选先在服务器隔离数据目录和动态端口通过version/live/ready/root/CSS及schema39绿地启动；发布后公网JS/CSS与候选包SHA-256逐字节一致，构建资源包含`data-title-zoom-band`与`--canvas-title-counter-scale`特征。
- 冻结备份及恢复副本位于`/var/lib/unboundry-rollbacks/inc-ui-004-frozen-20260816T114458Z`；文件清单一致，恢复副本`quick_check=ok`、外键违约0、schema39、活动生成任务0。
- 切换前后均为tasks153、Provider attempts152、active0、公共模板46/已发布45；没有schema迁移，没有真实Provider、付费生成或OSS写入。
- 详细发布凭证：`spec/INC_UI_004_PRODUCTION_RECEIPT_2026-08-16.json`。

## 用户验收状态

- `TITLE-ZOOM-001`：15%总览标题肉眼可辨——`PASS`。
- `TITLE-ZOOM-002`：60%及100%标题清晰且不过度抢眼——`PASS`。
- `TITLE-ZOOM-003`：长标题省略与完整值查看——`PASS`。
- `TITLE-ZOOM-004`：缩放/拖拽/框选不被未选中标题拦截——`PASS`。
- `TITLE-ZOOM-005`：选中节点仍可编辑标题——`PASS`。
- `TITLE-ZOOM-006`：Group与Storyboard视觉层级符合灰阶UI规范——`PASS`。

用户于 2026-08-18 明确回复「全通过」，以上条目收口为 PASS。
