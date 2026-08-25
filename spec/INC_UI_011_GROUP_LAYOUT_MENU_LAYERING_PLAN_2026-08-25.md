# INC-UI-011：节点排序菜单层级最小修复方案

状态：`PRODUCTION_V0_6_43_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / LOCAL_USER_PASS / USER_RECHECK`
日期：`2026-08-25`
基线：`origin/main@b84c509`，发布前现网 `v0.6.42 / schema41`
目标版本：`v0.6.43 / schema41`
版本门：`VERSION_CONFIRMED`
发布门：`RELEASE_AUTHORIZED_ONCE`

## 结论

采用一个小范围的前端修复：只把「节点排序」弹出的「宫格 / 水平」菜单通过 React Portal 挂到 `document.body`，按按钮的屏幕坐标定位，并补齐视口避让、关闭和键盘行为。

不提高整个组合框的层级。提高组合框会让组合框本体反过来盖住组内节点，影响范围更大；单独给当前菜单继续加 `z-index` 也无效，因为菜单仍受组合框父级层叠上下文限制。

## 已核实的原因

- `GroupNode.tsx`中的工具条和`group-layout-menu`都是组合框节点的后代。
- 新建组合框时，组合框是`zIndex: 0`，组内节点是`zIndex: 1`。
- 工具条虽然有`z-index: 8`，但它不能脱离父级组合框的层叠上下文；菜单向下展开后仍会被组内节点盖住。
- 当前`m2-group-node.spec.ts`只证明菜单可见、宫格和水平操作可执行，没有证明菜单在密集节点上方是真正可点击的最上层元素。
- `GroupNode.tsx`已经使用`createPortal`渲染模板弹窗，本修复不需要增加依赖或新建一套弹层框架。

## 最小实施范围

仅允许修改以下直接范围：

1. `client/src/canvas/GroupNode.tsx`
   - 给「组合框布局」按钮增加引用。
   - 打开菜单时读取按钮`getBoundingClientRect()`，把菜单 Portal 到`document.body`。
   - 菜单使用屏幕坐标和`position: fixed`，不再继承画布缩放或组合框层级。
   - 菜单根节点保留`role="menu"`，并增加`nodrag nopan nowheel`，避免点击被解释为节点拖动、画布平移或缩放。
   - `Escape`、点击外部、滚轮/画布缩放或平移、组合框失选、切换画布、组件卸载时关闭菜单；键盘关闭后焦点返回触发按钮。
   - 触发按钮补齐`aria-haspopup="menu"`、`aria-expanded`和稳定的菜单关联。

2. `client/src/styles.css`
   - 只把节点排序菜单拆出独立的 Portal 样式。
   - 保留现有尺寸、颜色和按钮样式；增加明确的弹层层级。
   - 菜单默认向下打开；底部空间不足时向上翻转，左右至少保留安全边距，不能跑出视口。

3. `tests/m2-group-node.spec.ts`及必要的本地 fixture
   - 保留现有宫格/水平行为断言。
   - 在密集组合框场景中打开菜单，用`document.elementFromPoint()`检查菜单按钮是其中心点最上层可点击元素，不能只检查`toBeVisible()`。
   - 增加零副作用断言：仅打开、关闭菜单不改变节点数据，不产生画布保存`PUT`。

## 明确不做

- 不提高整个组合框的`z-index`，不降低组内节点层级。
- 不修改宫格/水平排序算法、节点坐标合同或组合框尺寸算法。
- 不修改`CanvasSurface`的组合框创建、拖动、持久化或整组执行逻辑。
- 不抽象全局弹层系统，不顺手迁移颜色菜单或其他工具条菜单。
- 不修改后端、数据库、schema、OpenAPI、Provider、Generation、OSS或账号权限。
- 用户随后已独立确认版本号`v0.6.43`，并一次性授权push、PR、合并、tag、GitHub Release、SSH和生产发布；授权不扩大到真实Provider、Generation、OSS写入、购买/订阅、费用或schema变更。

## 安全合同

- 打开或关闭菜单时，节点、边、组合框数据和revision必须不变，画布保存`PUT`必须为0。
- 点击「宫格 / 水平」继续复用现有`layout()`行为；不得改变其历史结果或额外触发生成任务。
- Portal菜单必须拦住画布手势，不得触发节点拖动、组合框拖动、画布平移或滚轮缩放。
- 菜单位置不得使用画布内部坐标猜测；每次打开都从当前按钮屏幕矩形重新计算。
- 画布发生会使锚点失效的移动时，首版直接关闭菜单；不引入常驻逐帧定位器。
- 任何真实Provider请求、Generation任务、OSS写入和费用都必须为0。

## 验收标准

- `LAYOUT-MENU-001`：在`legacy.node.group-dense-selected`密集场景、zoom约15.6%时，「宫格 / 水平」完整显示且位于所有节点之上；两个按钮中心点的`elementFromPoint()`均命中菜单自身。
- `LAYOUT-MENU-002`：菜单点击正常，现有宫格和水平重排测试继续通过，排序结果无行为变化。
- `LAYOUT-MENU-003`：只打开、Escape关闭、点击外部关闭时，节点和边快照不变，画布保存`PUT=0`。
- `LAYOUT-MENU-004`：`1280×720`、`1440×900`、`1920×1080`三视口均不越界；下方空间不足时向上翻转，左右边缘会收回视口。
- `LAYOUT-MENU-005`：菜单带`nodrag nopan nowheel`；菜单交互不触发节点/组合框拖动、画布平移或缩放。
- `LAYOUT-MENU-006`：`Escape`关闭后焦点回到「组合框布局」按钮；组合框失选、切换画布和组件卸载无残留菜单、监听器或控制台错误。

任一项失败都不能把本事件写为`AUTO_PASS`；若菜单仍被节点遮挡、打开菜单产生保存请求或引发画布手势，按No-Go处理。

## 风险驱动验证

实施时按以下最小顺序执行，不默认跑全量：

1. 先为密集fixture补`elementFromPoint()`断言，并证明旧实现预期红。
2. 完成Portal最小实现后，只复跑`m2-group-node.spec.ts`。
3. 运行前端类型/构建检查，确认Portal类型和样式产物正常。
4. 在三个视口做本地浏览器零付费检查，记录遮挡、边缘避让、Escape和零`PUT`证据。
5. 只有发现共享合同传播、项目强制发布门或定向证据无法解释的失败时，才扩大测试范围；不为了安心重复safe full。

## 分阶段入口

- `R0 EXPECTED_RED`：核对身份和未提交改动，补密集场景最上层命中测试，冻结旧实现失败证据。
- `R1 MINIMAL_IMPLEMENTATION`：只落Portal、屏幕定位、避让、关闭与无画布手势合同。
- `R2 TARGETED_AUTO_PASS`：完成m2、类型/构建和零副作用验证。
- `R3 LOCAL_USER_RECHECK`：本地三视口证据通过后交给用户复验；用户已于2026-08-25在可见本地测试页明确回复「通过 继续」，本阶段完成为`USER_PASS`。
- `R4 RELEASE_GATE`：用户已另行确认v0.6.43并明确允许发布；按候选验证、PR/main CI、tag/Release、冻结备份/恢复演练、fresh build、原子切换和发布后技术门顺序推进。

## 当前授权边界与唯一下一步

原Goal只授权本地实施、定向验证和本地提交；用户最新独立指令已确认`v0.6.43`，并一次性授权push、PR、合并、tag、GitHub Release、SSH和生产发布。该链已完成且授权已消费；用户已完成本地人工复验，当前为`PRODUCTION_V0_6_43_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / LOCAL_USER_PASS / USER_RECHECK`。

唯一下一步：用户刷新生产涉事页，选中密集组合框并打开布局菜单，确认「宫格 / 水平」不再被节点遮挡后回复是否通过。

## 本地实施与验证证据（2026-08-25）

### 实际修改

- `GroupNode.tsx`：给「组合框布局」按钮增加稳定ref与`aria-haspopup/aria-expanded/aria-controls`；每次打开从当前`getBoundingClientRect()`取屏幕锚点，将菜单Portal到`document.body`；实测菜单尺寸后二次校准，默认向下、空间不足向上，并在四边保留8px安全边距。
- Portal根节点带`nodrag nopan nowheel`，使用`position: fixed`；Escape关闭并返焦，外部pointer、滚轮/缩放手势、组合框失选、画布切换、执行态和组件卸载均关闭。没有引入逐帧定位器或通用Overlay框架。
- `styles.css`只拆分节点排序菜单的fixed Portal定位和弹层层级；颜色菜单保持原实现。
- `CanvasSurface.tsx`只调整`legacy.node.group-dense-selected`本地fixture中首个子节点的位置，使其精确覆盖两个菜单按钮中心点；没有修改生产画布逻辑。
- `m2-group-node.spec.ts`在既有5个测试库存内增加Portal归属、按钮中心`elementFromPoint()`、ARIA/焦点、外部/失选/切换/滚轮关闭、无拖动平移缩放、图快照不变、零画布PUT及三视口翻转/收边断言；既有宫格和水平重排断言继续保留。

### 预期红与最终自动证据

- 新隔离工作树首次安全入口因本地尚无`node_modules`在产品测试前以`typescript`缺失停止，产品测试执行数为0；随后只执行`PATH=/Users/mymy/.local/bin:$PATH npm ci --offline --ignore-scripts`，离线安装185个包、退出0。
- 预期红命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m2-group-node.spec.ts`。旧实现精确为`4/5 PASS`，唯一失败是密集fixture中菜单按钮中心`elementFromPoint()`收到其他上层元素；source/snapshot均为`16cf3b19c8ab0f476cf47e2cb58a9996984c74162699fbfdbbe2147316c5f5d2`，4173监听者不变。
- 最终同一命令：`5/5 PASS`，failed/skipped/retries/blocked/reportErrors均0；Node`22.23.1`、npm`10.9.8`，source/snapshot均为`d729b63551eaf56a9704ffb8d252800f4bd41c15ed4fa6ac9ce5fe8fd61d6d4f`，4173监听者不变。
- 同一次安全入口的源码门完成TypeScript `408/408`跟踪文件类型检查，Vite生产构建退出0；没有重复运行相同树的独立type/build或safe full。
- 本地浏览器视口`1280×720`、`1440×900`、`1920×1080`全部通过：默认向下、底部不足向上、左右8px收边、菜单按钮中心为最上层自身、Escape返焦、应用console/pageerror为0。fixture页面重载产生的浏览器通用资源404不计为应用异常。
- 打开、Escape关闭、外部关闭、滚轮关闭的节点/边/组合框图快照和保存指纹不变，画布保存`PUT=0`；Portal空白区pointer手势与wheel均未改变viewport，菜单交互未触发节点/组合框拖动、画布平移或缩放。
- 真实Provider请求`0`、Generation任务`0`、OSS写入`0`、购买/订阅`0`、费用`0`；原本地功能证据冻结于package `0.6.42`，随后仅将package/lock与最终runtime角色同步为候选`0.6.43`，schema仍为`41`，产品逻辑未再改动。

### 验收结论

- `LAYOUT-MENU-001`：`PRODUCTION_AUTO_PASS / LOCAL_USER_PASS / USER_RECHECK`
- `LAYOUT-MENU-002`：`PRODUCTION_AUTO_PASS / LOCAL_USER_PASS / USER_RECHECK`
- `LAYOUT-MENU-003`：`PRODUCTION_AUTO_PASS / LOCAL_USER_PASS / USER_RECHECK`
- `LAYOUT-MENU-004`：`PRODUCTION_AUTO_PASS / LOCAL_USER_PASS / USER_RECHECK`
- `LAYOUT-MENU-005`：`PRODUCTION_AUTO_PASS / LOCAL_USER_PASS / USER_RECHECK`
- `LAYOUT-MENU-006`：`PRODUCTION_AUTO_PASS / LOCAL_USER_PASS / USER_RECHECK`

人工验收：用户于2026-08-25在可见本地密集组合框测试页完成复验并明确回复「通过 继续」，因此本地候选收口为`USER_PASS`。同步权威文档后，定向safe m38为`15/15 PASS`，failed/skipped/retries/blocked/reportErrors均0，4173监听者不变。用户随后独立确认v0.6.43并给出本次GitHub、SSH和生产发布授权；该授权只覆盖本版本，发布完成即消费。

### v0.6.43候选版本门

- 仅同步package/lock到`0.6.43`并将该版本加入最终runtime角色白名单及m81断言；schema仍为41，菜单产品逻辑没有再修改。
- 定向命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m81-deployment-hardening.spec.ts`；结果`41/41 PASS`，failed/skipped/retries/blocked/reportErrors均0，TypeScript 408/408、Vite生产构建通过。
- Node`22.23.1`、npm`10.9.8`；source/snapshot均为`51840be8a56240185e59d80391f242751cbbbe5169bfcfc6643396de9f91fa0e`，4173监听者保持PID 21403且哈希不变。
- 唯一safe full命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs full`；在精确候选commit`92e8325bbc4b102c9e9d3b655ce141beaa9b8389`/tree`89cf2beeaf55a39956a7c484dbb052a5d3e8c465`上完成`121/121 specs、1061/1061 tests PASS`，failed/skipped/retries/blocked/reportErrors均0。
- safe full source/snapshot均为`e8f7e47bb7ddaf7ec25ff46ab70c75c8516197141ac82e588ca8fdd65e996507`，immutable release builder `1/1 PASS`，4173监听哈希不变；真实外部网络、Provider、Generation、OSS写入和费用仍为0。后续仅同步证据文档，不重复full。
- full证据同步后只运行定向safe m38并`15/15 PASS`，failed/skipped/retries/blocked/reportErrors均0；source/snapshot`0868c6a84f3a404475fa045a9f93a12d1f2d2f6221dc2aafd1906b59d8eaac01`，4173监听哈希不变。该文档证据同步不重复业务测试或full。

### v0.6.43 GitHub与生产收口

- PR #100的Quality run `32826816134`与main run `32826897761`均成功；squash merge为`0f7a41d7fc644d66371a1b660c119dc9c333ee24`，merge tree与候选证据tree一致。
- 注释tag `v0.6.43`对象`6d58e02d3b3dc6398a082e3d63c55e21e745ff0a`精确剥离到merge commit；GitHub Release非draft、非prerelease，正式源码归档sha256为`54b3c0e6…ccd6`。
- fresh production release共5973文件，inventory`d9e0886…d0291`；权威冻结备份source/restore各366文件且清单`31dd802…caa`一致，恢复副本schema41/integrity ok/FK0。两次受控失败切换均回滚并在最终尝试前恢复pointer/runtime一致性，最终原子切换成功。
- 公网/回环version/live/ready均200并返回v0.6.43/active/schema41；service active+enabled、NRestarts0。tasks799、attempts807、active0、media841、publications431、canvases66及合规三表0在权威切换前后不变，8项公开静态资源哈希通过。
- 生产零付费浏览器：目标组合框菜单「宫格/水平」可见，宫格中心命中菜单按钮自身，z-index 1000；Escape关闭并返焦。canvas revision 233、graph revision 92、updated_at在打开关闭前后不变，写入0。
- 真实Provider、Generation、OSS写入、购买/订阅和费用均0。权威回执：`spec/V0_6_43_PRODUCTION_RECEIPT_2026-08-25.json`。本地`USER_PASS`保留；生产明确保持`USER_RECHECK`。
