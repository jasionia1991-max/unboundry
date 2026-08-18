# INC-UI-002 画布框选、OSS 素材显示与节点长标题修复

日期：2026-08-16  
状态：`PRODUCTION_PUBLISHED_USER_PASS`
候选版本：`v0.6.2`（真实 package 仍为 `0.6.1`）

## 1. 用户问题与施工边界

用户确认一次性修复三项全局 UI 问题，并要求所有新增或调整的 UI 对齐现有灰阶、圆角、字号、间距和交互规范：

1. 框选三个节点时误选巨大 Group，视觉上变成大面积选区，无法按预期只对三个节点打组；
2. OSS 素材上传后出现浏览器原生损坏媒体图标，失败状态破坏节点边框和视觉一致性；
3. Text、Image、Video、Audio、Playlist、Group、Storyboard 七类节点的长标题被直接裁断。

本项只修改本地候选代码、测试与项目底稿，不改 schema、不读取或修改生产数据、不调用真实 Provider、不执行真实 OSS 写入、不发布、不 commit/push/tag/更新 PR。

## 2. 已确认根因

### 2.1 框选误选 Group

`CanvasSurface` 使用 `SelectionMode.Partial`；只要拖拽框与 Group 的巨大可选表面相交，React Flow 就会选中整个 Group。现有打组候选又明确排除 Group，因此误选会扩大选区并阻断预期打组。

### 2.2 OSS 素材显示失败

线上坏图对应素材已完成 `POST /api/assets = 201`，媒体登记为 `ready / oss`，后续 `GET /api/assets/:id = 307` 跳转至阿里云 OSS。当前 CSP 仅允许 `img-src/media-src 'self' blob: data:`，浏览器因此拒绝最终 OSS URL。图片节点同时缺少 `onError`，所以显示原生损坏图片图标；视频和音频存在相同的全局风险。

### 2.3 长标题直接裁断

七类节点分别实现标题容器；多数只在父级设置 `overflow: hidden`，文字 span 没有统一的 `min-width: 0 / text-overflow: ellipsis`，Group 与 Storyboard 还缺少稳定宽度约束和完整标题提示。

## 3. 修复合同

1. 普通节点继续使用 React Flow 的局部相交框选语义；只有 Group 在框选结束时执行“完整包含”过滤。直接点击 Group、Shift 多选和四方向框选保持可用，避免为修复巨大 Group 而破坏普通节点既有框选手感。
2. 仅在 CSP 的 `img-src` 与 `media-src` 放行现有服务端已严格校验的 `https://*.aliyuncs.com`；不放宽脚本、连接、frame 或默认来源，不改为服务器媒体代理。
3. 图片、视频、音频读取失败时保留原 asset/source，不自动删除、不重新上传；统一显示灰阶错误占位、`重新加载`和`重新上传`。
4. 重新加载只重建当前媒体元素并为同源 `/api/` 地址获取新签名，不创建新资产。
5. 七类标题默认单行省略，悬停显示完整值；编辑 input 仍保留完整内容和现有 IME/提交语义。
6. 新 UI 复用现有 `#1f1f1f` 卡片、半透明白边、8px 小圆角、12px 次级字号和 32px 控件节奏，不引入新的品牌色或高饱和错误面板。

## 4. 验收标准

- 大 Group 背景附近完整框住三个独立节点后，选中数量严格为 3，点击打组后新 Group 也严格包含这三个节点；
- 只与 Group 相交但未完整包住 Group 时，不得选中 Group；
- CSP 允许阿里云 OSS 图片、视频、音频媒体来源，同时继续拒绝任意其他外部来源；
- 媒体 `error` 后不出现原生损坏图标，节点边框保持实线；重新加载不触发上传，重新上传仍走现有事务；
- 七类标题 span 均为省略显示且具有完整 `title`，单选进入 input 后完整标题可编辑；
- 受影响专项、TypeScript、production build 与安全全量通过，真实 Provider/OSS/付费请求为 0；
- 自动证据完成后状态只到 `USER_RECHECK`，不得代替用户实页确认。用户于 2026-08-18 明确回复「全通过」，本项现收口为 `PRODUCTION_PUBLISHED_USER_PASS`。

## 5. 已完成实现

1. `CanvasSurface` 记录空白画布上的框选起点，并在框选结束时只剔除未被选框完整包含的 Group；普通节点仍按原 `SelectionMode.Partial` 处理。
2. 服务端 CSP 只给 `img-src` 与 `media-src` 增加 `https://*.aliyuncs.com`，没有放宽 `script-src`、`connect-src`、frame 或默认来源；OSS endpoint、签名和读取校验仍由既有服务端规则负责。
3. Image、Video、Audio 共用媒体读取恢复组件。失败后保留原媒体 DOM 和 asset/source，隐藏浏览器原生坏媒体视觉并覆盖统一灰阶状态；`重新加载`只重建媒体元素，同源 `/api/` 地址追加一次性重载参数以取得新签名，外部已签名 URL 不被改写；`重新上传`复用原上传入口。
4. 媒体恢复状态使用 `role=status`，任务/上传错误仍使用 `role=alert` 并位于恢复层上方，避免遮挡既有“重试生成/重新检查任务状态”。
5. Text、Image、Video、Audio、Playlist、Group、Storyboard 七类标题统一使用单行省略、`min-width: 0` 和完整 `title`，编辑输入与 IME 语义不变。
6. 新增 `m98-canvas-ui-recovery.spec.ts`，并把它纳入安全测试清单；安全测试库存现为 `118 specs / 965 tests`。

## 6. 自动验证结果

- Node `22.23.1` / npm `10.9.8`；production build PASS，232 modules；仅保留既有大 chunk warning。
- 新回归与生成恢复交叉验证：`m41 + m98 = 54/54 PASS`。证明媒体占位不会遮挡生成任务重试，并覆盖三项本次需求。
- 非冻结发布运维集合：`114/114 specs、938/938 tests PASS`；failed/skipped/retries/reportErrors/blocked 全 0，source snapshot 前后相同，安全 runner 完成隔离清理，生产 `4173` listener identity 前后不变。
- 其中框选相关 `m1-selection-drag + m63 + m98 = 12/12 PASS`；媒体既有节点、上传、持久化、重试、CSP 和 UI 规范均已包含在上面的 938 项中。
- 全程没有真实 Provider、真实 OSS 或付费请求，没有创建生产任务，没有访问或修改生产数据，也没有发布、commit、push、tag 或更新 PR。

## 7. 证据边界与下一步

- 发布准入已补齐：`m10 / m92 / m94 / m96` 继续验证冻结的备份、版本兼容、不可变制品与发布运维合同，runner只投影合成历史`0.5.2→0.6.0`source-pair，不修改冻结合同。最终正式安全full为`118/118 specs、965/965 PASS`，异常计数均为0。
- 生产已于2026-08-16原子切换到`/opt/unboundry/releases/v0.6.2-inc-ui-002-20260816`；公网version/live/ready、标题、favicon、CSP和静态资源哈希均通过。生产数据与安全配置前后不变，发布期间Provider/付费调用与OSS写入0。
- 用户于 2026-08-18 明确回复「全通过」，本项收口为 `PRODUCTION_PUBLISHED_USER_PASS`。
