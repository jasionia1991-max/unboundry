# INC-IMGEDIT-002 图片裁剪准备态体验优化行动方案

更新日期：2026-08-23
项目：Unboundry
基线：`main` / `b66e9f1216fc66e1b870ef8e480ef83b8e9a447a` / package `0.6.32` / 生产 `v0.6.32` / schema39
当前状态：`PRODUCTION_PUBLISHED_USER_PASS / USER_PASS / VERSION_V0_6_33`
发布版本：`v0.6.33`（commit、tag、push、PR、合并和生产发布均已完成；本次授权已消费）

## 1. 用户要看到的结果

用户点击“裁剪”后，不再先看到一块突兀的大黑框。页面应立即给出清楚、稳定的准备反馈：

1. 优先显示当前节点已经渲染出来的图片作为**视觉占位**；
2. 图片轻微变暗/模糊，中间显示小型加载动画和“正在准备高清原图”；
3. 安全原图完成读取、校验和浏览器解码后，平滑切换到可操作裁剪画面；
4. 准备期间只允许取消，宽高比和确认裁剪保持禁用；
5. 读取失败时保留明确错误和重试入口，不出现空白大框，也不误导为已经可以裁剪。

如果“复用当前已渲染图片”在真实浏览器中会额外下载一次 OSS 原图，则不得为了视觉效果接受双下载；该场景自动退回紧凑加载卡片。**体验优化不能以重复读取大图、增加服务器压力或削弱 v0.6.32 安全边界为代价。**

## 2. 已确认基线

- 用户已在 v0.6.32 生产实页成功裁剪原先会触发 tainted Canvas 的 OSS 图片，`INC-IMGEDIT-001` 用户验收通过。
- 当前准备画面不是错误：裁剪弹窗先进入 `sourceBusy`，同站接口完整读取并校验原图，浏览器收到完整 PNG 后创建 `blob:` URL；期间组件按默认 1280×720 比例显示最大约 987×552 的深色舞台。
- 当前安全主链必须保留：owner-scoped 同站读取、20 MiB 上限、长度/哈希/PNG校验、全局2/单账号1、超时/取消、Blob URL、来源assetId冻结、派生上传补偿。
- 当前编辑源请求使用 `cache: no-store`；本轮不伪造下载百分比，不偷偷改成缓存旧签名URL。
- 当前普通 OSS 图片展示路径可能是 `/api/assets/:id -> 307 -> 临时签名URL`。视觉占位不得被实际导出Canvas消费。

## 3. 本轮范围

### 3.1 要做

- 把裁剪准备态从“大黑框+一行字”改成缩略图/紧凑卡片加载体验；
- 明确区分视觉占位图和安全裁剪原图；
- 增加“安全原图已下载”和“图片已解码”两个阶段，只有解码完成才进入ready；
- 为失败、重试、取消、快速开关、StrictMode重挂和来源替换保留确定行为；
- 增加直接受影响的浏览器回归和无额外请求证明；
- 同步本文件、`TASKS.md`和当前权威状态文档。

### 3.2 不做

- 不改 `server/mediaEditSource.ts`、`MediaBlobStore`、并发上限或20 MiB合同；
- 不新增媒体域名、CDN、CORS、缩略图服务、数据库字段或存量迁移；
- 不显示虚假的下载百分比；
- 不把普通OSS地址、签名URL或视觉占位图交给实际导出Canvas；
- 不触发真实Provider、付费生成或新的OSS写入；
- 本计划不授权commit、push、PR、tag、版本升级、SSH或生产发布。

## 4. 交互状态机

| 状态 | 中央内容 | 底部控制 | 可以做什么 | 禁止事项 |
| --- | --- | --- | --- | --- |
| `loading-preview` | 已有视觉占位图；不可安全复用时显示紧凑暗色卡片 | 取消可用；比例/确认禁用 | 取消 | 不裁剪、不上传 |
| `loading-secure-source` | 占位图变暗/轻微模糊；18～20px加载动画；“正在准备高清原图” | 同上 | 取消 | 不使用占位图导出 |
| `decoding` | 安全Blob图开始淡入；文案改为“正在打开高清原图” | 同上 | 取消 | 图片未`onLoad`前不得ready |
| `ready` | 只显示安全Blob图和裁剪框 | 比例/确认启用 | 调整并确认 | 不再引用占位图作为数据源 |
| `saving` | 保持裁剪画面 | 全部操作禁用；显示“处理中” | 等待 | 不重复提交 |
| `error` | 占位图或紧凑暗色卡片；明确错误文案 | 取消、重试可用；确认禁用 | 重试或退出 | 不自动无限重试 |

## 5. 视觉规格

- 全屏遮罩沿用当前层级和背景，不改变画布操作边界。
- 有可安全复用的已渲染预览时，准备舞台沿用可信媒体宽高比，最大尺寸仍受视口限制，避免加载完成后明显跳动。
- 占位图：`opacity`约0.55、`filter: blur(3px)`、轻微缩放避免模糊边缘露白；仅作视觉展示。
- 加载层：居中垂直排列18～20px单色环形动画与“正在准备高清原图”，文字使用现有灰白体系，不使用高饱和色。
- 无可复用预览时：显示约320×180的紧凑暗色卡片，不提前撑开987×552大舞台；安全图解码后再平滑扩展到真实舞台。
- 切换动画：透明度/轻微缩放约160ms；`prefers-reduced-motion: reduce`下取消旋转以外的非必要过渡，仍保留明确文字状态。
- 准备态确认按钮继续禁用，并保留可理解的禁用外观；取消按钮始终可用，保存中除外。

## 6. 技术设计

### 6.1 数据源严格分层

组件内必须保留两个互不混用的概念：

- `visualPreview`：只负责准备态展示，来源为当前节点已经渲染的图片；
- `editableSource`：只来自 `resolveEditableImageSource(assetId)`，实际裁剪唯一允许的数据源。

实际 `drawImage`、`toBlob`、来源assetId核对和派生上传只能读取 `editableSource` 对应的独立 `secureImageRef`。视觉占位不得复用该ref，不得传入confirm函数，也不得调用`toBlob/getImageData`。

### 6.2 优先复用、失败降级

1. 给当前节点预览图片增加只读ref，打开裁剪时读取其`currentSrc`、naturalWidth和naturalHeight；
2. 实现阶段确认：把HTTP(S)地址再交给第二个`<img>`无法在所有真实缓存头下证明零请求，因此只允许`blob:`/`data:`这类已在内存中的URL成为视觉占位；
3. 普通`/api/assets/:id`和OSS图片确定性降级为320×180紧凑加载卡片，不尝试第二次加载，因此不会新增普通资产/OSS原图请求；
4. 测试同时覆盖HTTP地址的零额外请求反例，以及内存URL的缩略图展示；
5. 未来如有上传期生成的小缩略图/独立媒体域名，可替换`visualPreview`提供者，不改变安全编辑源resolver。

### 6.3 ready时机

当前`editableSource`创建完成只代表Blob已经取得，不代表`<img>`完成解码。本轮增加明确的`sourceDecoded`或等价状态：

- resolver成功：进入`decoding`；
- 安全图片`onLoad`：记录真实宽高、设置`sourceDecoded=true`、进入`ready`；
- 安全图片`onError`：释放Blob、进入`error`；
- confirm启用条件：`editableSource && sourceDecoded && !busy`。

### 6.4 生命周期

- 关闭、assetId变化、重试或组件卸载时继续Abort底层请求并revoke旧Blob URL；
- React StrictMode重挂后仍只允许一次有效编辑源读取；
- 快速打开后立即关闭不得留下请求、定时器、Blob URL或未处理Promise；
- 来源assetId在打开时继续冻结；加载期间替换原图时，旧裁剪不得落图；
- 不增加全局常驻大图缓存，避免20 MiB图片长期占用浏览器内存。

## 7. 预计改动范围

实际产品文件：

- `client/src/canvas/ImageNode.tsx`：视觉占位快照、解码状态、状态机与严格ref分离；
- `client/src/styles.css`：紧凑卡片、遮罩、加载动画、淡入和reduced-motion；
- `client/src/canvas/editableImageSource.ts`：未修改；v0.6.32安全读取合同保持原样。

测试文件：

- `tests/m2-image-node.spec.ts`：主要浏览器行为与安全反例；
- 只有实际依赖传播命中其他既有规格时才扩展最小受影响集合，不新增safe runner分区，不改冻结测试总数。

若产品实现需要修改服务端、普通资产缓存策略、媒体域名或缩略图生成，视为超出本计划，必须先停下并回写新方案，不得边做边扩张。

## 8. 验收矩阵

### 8.1 准备体验

- 点击裁剪后100ms内出现可理解的加载反馈，不再显示空白大黑框；
- 有可复用视觉占位时立即展示，无占位时使用紧凑卡片；
- 安全图解码完成后平滑切换，舞台无明显闪烁或错误比例跳动；
- loading/decoding阶段确认按钮不可点击，取消可用；
- reduced-motion模式下无不必要动画，但状态仍清楚。

### 8.2 安全与请求

- 实际裁剪图片`src`仍为`blob:`，普通素材路径即使307到无CORS跨域图片也不会进入导出Canvas；
- 视觉占位与安全图片使用不同ref，测试证明confirm只读取安全ref；
- 打开一次只产生一次`/api/image-edit-sources/:id`请求；
- 视觉占位不得新增普通资产或OSS大图请求；若做不到，必须使用紧凑卡片降级；
- 取消、失败、重试、来源替换时派生上传数和补偿边界与v0.6.32一致；
- Provider/Generation请求0，真实OSS写入0。

### 8.3 错误与恢复

- 401/404/409/429/503/504继续显示现有友好文案；
- 安全图解码失败时不能进入ready；
- 点击重试只启动一轮新读取，旧轮次已取消并释放；
- 快速开关10次后没有未处理异常、重复有效请求、残留Blob或控制台error/warn。

## 9. 实施顺序

1. **D0 文档冻结：完成。** 本文件和`TASKS.md`先记录范围、红线、验收门。
2. **D1 失败测试：完成。** 产品实现前m2以缺少`image-crop-visual-preview`确定性失败，证明新断言确实能拦住旧实现。
3. **D2 最小实现：完成。** 只改`ImageNode.tsx`和样式；HTTP(S)采用紧凑卡片，内存URL采用缩略图，安全源与视觉源严格分离。
4. **D3 定向验证：完成。** safe preflight、TypeScript/build和m2通过；初版z-index拦截比例菜单后只修复层叠上下文并复验m2。
5. **D4 本地实页：完成。** loopback/local素材下暂停安全源读取，检查loading和恢复后的ready；真实Provider/OSS写入0。
6. **D5 候选冻结：完成。** 实际改动、偏差、命令、结果与残余风险已回写；没有共享服务端合同变化，未运行full。
7. **D6 用户验收：完成。** 用户在v0.6.33生产页面完成复验并明确回复“通过”。
8. **D7 Git/发布：完成。** 用户明确授权commit、push、PR和小版本发布；v0.6.33已通过GitHub与生产技术终门，授权已消费。

## 10. 测试策略与停止条件

- 本轮是纯客户端局部交互变化，直接受影响规格为m2；安全入口附带的TypeScript/build/preflight作为工程门。
- 冻结候选按发布门运行一次正式full；原始结果`1049/1050`，同源码只复验唯一失败m22并`37/37 PASS`，没有重复full。
- 若实际改到共享编辑源resolver、MediaBlobStore、鉴权、上传补偿或持久化事务，再根据传播范围增加m100/m37/m80/m99等最小集合，并重新评估是否需要一次full。
- 下列任一情况必须停止并先更新方案：需要服务端缩略图、普通资产缓存策略改变、额外OSS读取不可避免、安全图片与占位图片无法证明隔离、测试总数/runner需要变化。

## 11. 成本、时间与后续升级

- 预计实现与定向验证：约半天；用户验收、GitHub和生产发布时间另计。
- 当前方案不需要新增服务器、域名、CDN或付费服务；不会发起付费Provider请求。
- 后续升级为`media.mymy.ltd + CDN/CORS`时，只替换视觉预览/编辑源resolver；画布仍保存assetId，本轮UI状态机和安全兜底可以继续使用，不需要推倒重做。

## 12. 当前停点

- 本地产品候选、直接受影响测试、本地Agent实页、冻结候选full、GitHub CI、生产备份与切换终门均已完成。
- v0.6.33已在生产运行；用户主观复验加载画面通过，状态收口为`USER_PASS`。
- 原main工作树中的`spec/public-templates-director-split-revision.json`保持未读、未改、未暂存、未提交。
- safe验证使用与main HEAD tree相同的既有干净linked worktree；三个产品/测试文件与main候选逐字节一致。main原有ignored `backups/`目录未删除、未移动、未用于凑绿。

## 13. 实施与验证记录

### 13.1 实际改动

- `client/src/canvas/ImageNode.tsx`：新增视觉预览快照、`sourceDecoded`解码门、独立安全图片ref、loading/decoding/ready切换、失败释放和确认禁用条件。
- `client/src/styles.css`：新增320×180紧凑舞台、视觉预览暗化/模糊、安全图淡入、18px加载环、reduced-motion和舞台隔离层叠上下文。
- `tests/m2-image-node.spec.ts`：在同一既有裁剪用例内覆盖HTTP零额外读取、内存缩略图、请求延迟、解码门、`blob:`安全源和既有取消/失败/派生/来源替换边界，没有增加spec或测试总数。

### 13.2 测试先行与纠偏

- D1产品实现前的safe m2为`9/10`：裁剪用例因找不到`image-crop-visual-preview`失败，其他9项通过；source/snapshot SHA-256为`bd219e1c…`。这份失败证明确认测试不是随实现一起“自证通过”。
- 初版产品实现后m2仍为`9/10`：新增selection z-index越出舞台层叠上下文，拦截了1:1比例菜单点击。只在`.image-crop-stage`增加`isolation:isolate`后复验最小m2，问题关闭。
- 随后加强零重复下载合同：HTTP(S)视觉预览明确降级紧凑卡片，只有`blob:`/`data:`内存URL显示缩略图；再次只运行受影响m2。

### 13.3 最终自动证据

- 命令：`node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts`（`/Users/mymy/.local/bin` Node 22.23.1 / npm 10.9.8；既有干净linked worktree）。
- 结果：`10/10 PASS`，retries0、skipped0、failed0、reportErrors0；120 specs/1050 tests清单未变。
- safe入口附带preflight、TypeScript 358/358、架构边界、source coverage、生产build、文件/凭据/离线网络保护全部通过；只有既有大chunk提示。
- source/snapshot SHA-256均为`425ff6ab1114589272f792c0cef28fc6171b82b0c6c355e1f6d8de22af8f603c`；4173 listener保持`24c91e57…8244`不变。
- 自动反例：HTTP预览打开裁剪后`redirectedAssetReads=0`且无视觉`<img>`；舞台320×180。内存预览显示缩略图；准备阶段确认禁用、裁剪框不存在；解码后安全源`src`为`blob:`、确认启用。既有保存失败补偿、成功派生图和来源替换栅栏均通过。

### 13.4 本地实页证据

- 仅使用loopback `127.0.0.1:57361`、临时隔离data/runtime、本地fixture和本地PNG；没有真实Provider请求或OSS写入。
- 通过浏览器调试协议暂停`/api/image-edit-sources/:id`：实测舞台320×180、文案“正在准备高清原图…”，确认禁用，visual preview/secure source/selection数量均为0。
- 恢复同一请求后：安全图片协议为`blob`、selection为1、loading为0、确认启用；控制台error/warn为0。
- 验收页、服务和临时数据均已关闭清理；浏览器节流/拦截也已恢复/清空。

### 13.5 验证范围与残余风险

- 没有服务端、鉴权、MediaBlobStore、上传、持久化、schema或发布合同变化，因此未为安心重复safe full；直接行为由m2及safe入口附带门覆盖。
- 本地Agent页面证据只记`LOCAL_AGENT_PAGE_PASS`；后续用户已在v0.6.33生产页面独立完成复验并确认通过。
- 当前生产v0.6.33已包含紧凑加载体验，用户确认后已记`USER_PASS`。

## 14. 文档落地记录

- 已同步`AGENTS.md`、`README.md`、`TASKS.md`、`上线规矩.md`、当前状态、handoff/checkpoint和INC-IMGEDIT-001引用；v0.6.33生产状态为`PRODUCTION_PUBLISHED_USER_PASS / USER_PASS`。

## 15. v0.6.33 发布结果

- 冻结候选commit `669958f4e325cc182c31cf0f27861e26b64736b1`，注释tag `v0.6.33`；PR #77 squash merge `8675a34b14b17fdf69b5e08b0469c520e4df79cb`，main Quality gates run `32628346283`为`SUCCESS`，tag tree与main tree一致。
- 唯一一次正式safe full执行120 specs/1050 tests，原始`1049/1050`；唯一失败为未改动m22多标签页提示5秒时序，同一冻结源码只复验m22后`37/37 PASS`。source/snapshot SHA-256均为`1b6b6bf31bf18d739143563158c600eac791881a3552e8737205c33605c03571`，没有第二次full。
- 生产从精确tag fresh build，release `/opt/unboundry/releases/v0.6.33-crop-loading-20260823`；冻结备份 `/var/lib/unboundry-rollbacks/v0.6.33-frozen-sLmph1` 与恢复副本各365文件，双清单SHA均为`50ccbb8d7baa4b27bf2762258a85b7218931c2460308af1d44e3b333a5a31256`。
- 切换前后schema39/integrity ok/FK0及全部业务计数一致；service active/enabled、NRestarts0，公网/回环version/live/ready、inventory和5个公网资源逐字节一致，日志异常0。发布自身Provider请求和OSS写入0。
- 权威生产回执：`spec/V0_6_33_PRODUCTION_RECEIPT_2026-08-23.json`。技术发布通过后，用户已在线上复验并明确回复“通过”，状态收口为`PRODUCTION_PUBLISHED_USER_PASS / USER_PASS`；本次发布授权已消费。生产回执中的`USER_RECHECK`保留其生成时点事实。

## 16. 用户线上验收

- 2026-08-23，用户在v0.6.33生产页面完成裁剪加载体验复验并明确回复“通过”。
- 本项由`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`正式收口为`PRODUCTION_PUBLISHED_USER_PASS / USER_PASS`。
- 这次确认只覆盖v0.6.33裁剪准备态体验，不自动改变其他历史`USER_RECHECK / PARTIAL / PAUSED / BLOCK`项目。
- main safe runner早先在测试前因既有ignored `backups/`目录被文件隔离负控以`EISDIR`停止；没有删除/移动该目录。最终测试改在与main HEAD tree相同的既有clean linked worktree执行，并在冻结前核对产品/测试文件哈希。
