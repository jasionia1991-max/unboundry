# INC-UI-008：文字节点画布级全屏

状态：`PRODUCTION_PUBLISHED_USER_PASS`
版本：`v0.6.10`
日期：`2026-08-17`

## 用户确认的问题

文字节点点「全屏」会进浏览器系统全屏，顶上出现「按 esc 退出全屏」。图片节点是网页里的画布遮罩。用户要文字和图片一样。

## 冻结合同

- 文字「全屏」复用图片那套画布层：半透明黑底、圆角面板、标题、关闭。
- 不走浏览器/系统 Fullscreen API。
- 中间是只读正文，字多了在面板里滚。
- 动作按钮是「复制」，不是「下载」。
- Escape、点暗处、点 × 只关这一层，不取消选中，不改保存、生成、连线。

## 自动验证

- 类型检查通过。
- 定向 `m2-text-node` 8/8、`m98` 5/5 通过。
- 正式安全全量 `118/118 specs、969/969 tests PASS`，失败/跳过/重试/blocked/reportErrors均为0。
- 源码快照 528 文件，SHA-256 `7fdaf45751b2ff259c2ba9fc63e975ecd64bfeb8a5a823bb0e152ea094ded0c8`。

## 生产发布

- 精确源码commit`7f85e608d4580f43d67beeaabe19ee0fac29787f`、tree`7985ed65468bab9bea5b77621e1974be2273f526`。
- 生产current已切到`/opt/unboundry/releases/v0.6.10-inc-ui-008-20260817`；上一不可变release `v0.6.9-inc-gen-003-20260817`完整保留。
- 冻结备份`/var/lib/unboundry-rollbacks/inc-ui-008-frozen-20260817T142433Z`：冻结源与恢复副本均365文件，清单SHA-256同为`251f6eb0929a314baaf7de3230188573adf67cc453db520604c2c56a11e533c4`。
- 公网version为0.6.10；入口JS/CSS及CanvasShell与release逐字节一致。
- 数据不变：切换后schema39、quick_check ok、FK0、tasks246、attempts248、active0、公共模板47（46 published）。
- GitHub：注释标签`v0.6.10`指向`7f85e608d4580f43d67beeaabe19ee0fac29787f`；PR #16已合并，merge commit`97f94292ce811c752a4c6b84f9370fed0abfd2cb`。
- 发布与验证期间真实Provider请求、付费生成和OSS写入均为0。
- 用户于 2026-08-18 明确回复文字全屏也通过，本项正式收口为`PRODUCTION_PUBLISHED_USER_PASS`。

详细凭证：`spec/INC_UI_008_PRODUCTION_RECEIPT_2026-08-17.json`。
