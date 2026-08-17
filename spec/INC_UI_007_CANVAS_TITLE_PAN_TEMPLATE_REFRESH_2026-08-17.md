# INC-UI-007：组标题、文字节点平移与模板目录刷新

状态：`PRODUCTION_PUBLISHED_USER_PASS`
版本：`v0.6.6`
日期：`2026-08-17`

## 用户确认的问题

1. Group/公共模板标题与主体间隔过大，长标题再次被单行省略。
2. 光标位于Text正文时，触控板/滚轮不能平移画布；其他节点区域可以。
3. 管理员修改公共模板标题后返回画布，左侧模板目录仍显示旧标题。

## 冻结修复合同

- Group标题以主体上边缘为唯一锚点，保持约8px屏幕间隔；短标题按内容宽度显示，长标题最大320px并自然换行，完整40字符标题可见。
- 不给Group增加标题栏、内边距或新边框，不移动Group或组内节点，不修改持久化坐标、尺寸、连线或模板graph。
- Text非编辑态移除`nowheel`，使触控板/滚轮事件交还画布；双击进入编辑态后恢复`nowheel nodrag`，正文滚动与编辑不带动画布。
- 每次打开模板目录都从服务端重新读取；BFCache恢复时再次刷新；请求显式`no-store`。服务端仍是唯一标题真相源，不新增客户端标题副本。

## 风险、应对与检测

| 风险 | 应对 | 必须通过的检测 |
| --- | --- | --- |
| 标题改成多行后因高度变化带动Group位置 | 标题继续绝对定位并以主体上边缘向上锚定，只改CSS呈现 | 多轮缩放前后Group、子节点DOM transform和服务端坐标完全不变 |
| 长标题扩大后总览层互相遮挡 | 短标题使用内容宽度，只有长标题扩到320px；组内节点标题继续沿用总览隐藏规则 | 15%/60%标题尺寸、完整文本、组内标题显隐和指针合同回归 |
| Text恢复画布平移后影响正文编辑 | 仅非编辑态交还滚轮；编辑态保留`nowheel nodrag` | 正文上方非编辑态滚轮实际改变viewport，编辑态不改变viewport；既有IME/拖动测试继续通过 |
| 模板目录刷新产生缓存旧值或竞态 | 打开即刷新、BFCache恢复刷新、AbortController取消旧请求、HTTP显式no-store | 同一画布先看到旧名，后台改名后返回，dock无需硬刷新显示新名 |
| 发布误触生成/Provider/OSS | 本事件只运行安全测试和只读/本地UI验证 | 发布前后generation task、provider attempt、active generation计数不变，真实Provider/付费/OSS写入为0 |
| 生产切换破坏数据 | 先冻结备份并验证恢复副本，保留上一不可变release，失败立即回切 | schema39、quick_check、FK0、核心表计数、公网hash、service状态全部通过 |

## 发布门

1. 新增三项产品回归，以及已有标题、Text编辑、公共模板、坐标稳定性回归全部通过。
2. Node `22.23.1` / npm `10.9.8` 下安全全量与fresh build通过，失败、跳过、重试、blocked和reportErrors均为0。
3. 生产冻结备份可恢复；新release隔离启动、公网JS/CSS哈希、版本/ready、schema39和数据不变门通过。
4. 线上登录实页重复缩放坐标不变，Text正文区域可平移，公共模板标题改名返回画布后自动刷新。
5. 任一门失败不切换或立即回滚；自动验证通过只记`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`，不代替用户肉眼验收。

## 完成结果

- 实现：Group标题改为约8px屏幕间隔、72～320px内容宽度并完整换行；Text仅在编辑态持有`nowheel nodrag`；模板目录在每次打开、BFCache恢复时以`no-store`重新读取服务端标题。
- 自动门：最终定向`m77+m79+m98 = 17/17 PASS`；正式安全全量`118/118 specs、969/969 tests PASS`，失败、跳过、重试、blocked和reportErrors均为0；source snapshot与4173 listener前后不变。
- 发布门：精确源码commit`31bb1e9aa6bbdf08f84fd7d5c95ab5d5ee00dbec` fresh build通过；冻结备份与恢复副本清单一致，恢复库schema39、quick_check ok、FK0。
- 生产：current已切到`/opt/unboundry/releases/v0.6.6-inc-ui-007-20260817`，service active+enabled、NRestarts0；公网version为0.6.6，入口JS/CSS及CanvasShell动态chunk与release逐字节一致。
- 数据不变：切换前后tasks153、Provider attempts152、active generation0、公共模板47（46 published）；真实Provider、付费生成和OSS写入均为0。
- GitHub：`v0.6.6`标签精确指向生产源码；PR #6已合并到`main`，merge commit`6581a88c044db4e5efb8e694c4da1681defca730`。
- 用户随后对本轮三项修复明确回复“通过”，当前正式收口为`PRODUCTION_PUBLISHED_USER_PASS`。
