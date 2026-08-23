# INC-IMGEDIT-001：OSS 图片裁剪同站编辑源方案

更新日期：2026-08-23
项目：Unboundry
基线：`main` / `a29ac82793c2887bd252e7de16d7913fc07f026c` / 生产 package `0.6.31` / schema39
候选版本：`v0.6.32`（GitHub 交付候选，尚未发布生产）
施工分支：`codex/image-edit-source-2026-08-23`
隔离工作区：`/Users/mymy/Documents/unboundry-image-edit-source-2026-08-23`
当前状态：`VERSIONED_V0_6_32 / LOCAL_ENGINEERING_COMPLETE / TARGETED_AUTO_PASS / FORMAL_FULL_1049_OF_1050 / M22_ISOLATED_RECHECK_PASS / GITHUB_PR_75_OPEN / TAG_V0_6_32 / USER_RECHECK`

## 1. 用户结果

当前账号拥有的本地或 OSS 图片都能在画布中完成裁剪，确认后生成新的持久图片节点；原图保留，新节点与原节点连接，不再出现 `Tainted canvases may not be exported`。

本轮只修复图片裁剪读取链路，不改变上传、生成、下载、画布文档或媒体归属语义。

## 2. 已确认根因

1. `ImageCropEditor` 直接以节点 `imageSrc` 创建 `Image`，画入 Canvas 后调用 `toBlob()`。
2. 本地素材的 `/api/assets/:id` 返回同站 PNG，因此现有测试通过。
3. OSS 素材的同一路径返回 `307`，浏览器最终从阿里云签名 URL 解码图片。
4. 图片能显示，但未满足 Canvas CORS 导出条件，Canvas 被浏览器污染并拒绝 `toBlob()`。

## 3. 冻结方案

### 3.1 服务端编辑源

新增只读接口：

```text
GET /api/image-edit-sources/:assetId
```

合同：

- 复用现有 `/api` 登录闸门；只允许当前账号读取自己的 `ready` 图片。
- `assetId` 只接受既有安全字符集，不接受 URL、对象键或签名地址。
- 只接受规范 `image/png`，物理文件上限保持现有 20 MiB，像素上限保持 4000 万。
- 经 `MediaBlobStore` 从 local 或 OSS 读取，不在 HTTP handler 写死具体存储。
- 校验实际字节数、SHA-256 与 PNG 结构后，直接以同站 `200 image/png` 返回。
- 绝不向浏览器返回 OSS 签名 URL，绝不 `307`。
- 成功响应使用 `Cache-Control: private, no-store` 和精确 `Content-Length`。
- 不存在、不属于当前账号、非 ready 统一为 404；忙为 429；存储不可用为 503；超时为 504。

初始资源边界：

- 单张最多 20 MiB；
- 全进程同时最多 2 个编辑源读取；
- 同一账号同时最多 1 个；
- OSS 读取 deadline 60 秒；
- 浏览器取消、关闭裁剪或断开响应时，终止尚未完成的读取；
- 不形成无界等待队列，容量满时 fail-fast 并提示重试。

### 3.2 存储端口

将 `MediaBlobStore.read(reference, maximumBytes)` 收敛为带可选取消信号的读取参数，并同步 local、memory、OSS 和 routed adapter。

本轮仍使用最多 20 MiB 的有界内存结果，不引入零拷贝流式 HTTP 重构。取消必须真实传到 OSS fetch/响应体读取；本地短读至少在读前、读后检查取消并正确释放文件句柄。

### 3.3 客户端可替换解析器

新增 `client/src/canvas/editableImageSource.ts`，冻结客户端端口：

```ts
type EditableImageSource = {
  url: string;
  sourceAssetId: string;
  crossOrigin?: "anonymous";
  release: () => void;
};
```

当前 resolver：`assetId -> 同站接口 -> Blob -> blob: URL`。

裁剪窗口只消费 resolver 的结果，不感知 local、OSS 或 CDN。预览和 Canvas 使用同一个 Blob；取消、关闭、组件卸载时 abort 请求并 revoke object URL。

### 3.4 来源身份栅栏

打开裁剪时固定 `sourceAssetId`。派生图上传完成、落节点之前必须再次确认：

- 原节点仍存在；
- 原节点的 `assetId` 仍等于打开裁剪时的值；
- 画布持久化仍 ready；
- upload operation 与 media adoption scope 未变化。

任一条件失败，派生图不得落画布，并调用既有删除补偿清理已上传资产。

## 4. 用户界面合同

- 取图期间显示“正在准备图片…”，确认按钮不可用。
- 404：`这张图片已不存在或尚未保存`。
- 429：`正在处理其他图片，请稍后重试`。
- 503/504：`图片暂时无法读取，请稍后重试`。
- 完整性失败：`图片文件不完整，暂时无法裁剪`。
- 不再把浏览器英文 Canvas/CORS 错误直接展示给用户。
- 现有比例、拖动、取消、派生节点布局与连线语义不变。

## 5. 明确不做

- 不新增 `media.mymy.ltd`、CDN、CORS 或证书配置；
- 不修改数据库 schema、历史画布或既有 assetId；
- 不把私有素材改成公共素材；
- 不把单图上限从 20 MiB 扩到 200 MiB；
- 不做真实 Provider 请求、真实 OSS 读写或生产访问；
- 不顺手重构其他图片工具、视频/音频读取或暂停功能；
- 不 commit、push、tag、PR 或发布，除非用户后续单独授权。

## 6. TapNow 式后续升级

后续可增加 `CorsMediaDomainEditableImageSourceResolver`：符合条件时返回 `media.mymy.ltd` URL 与 `crossOrigin="anonymous"`，失败、私密或历史素材继续回退本轮同站接口。

画布始终保存 `assetId`，不保存短期签名 URL，因此未来无需批量迁移画布或重新上传图片。本轮同站接口长期保留为安全兜底，不是一次性补丁。

## 7. 预计代码与测试范围

实现文件：

- `server/mediaEditSource.ts`（新增）
- `server/mediaBlobStore.ts`
- `server/mediaBlobStores.ts`
- `vite.config.ts`
- `client/src/canvas/editableImageSource.ts`（新增）
- `client/src/canvas/ImageNode.tsx`

测试：

- 扩展 `tests/m100-modular-ports.spec.ts`，承载编辑源服务/端口专项；
- 扩展 `tests/m2-image-node.spec.ts`；
- 扩展 `tests/m37-media-upload-transactions.spec.ts`；
- 扩展 `tests/m80-storage-read-rule.spec.ts`；
- safe runner 的固定 120-spec 分区保持不变，不为本轮增加新的测试文件。

若实际依赖传播超出上述范围，必须先回写本文件的“实际偏差”，再继续实施。

## 8. 验收门

### 8.1 服务端

- local 与 fake OSS 都从新接口返回同站 200 PNG；
- fake OSS 路径不向浏览器暴露 Location/签名 URL；
- owner、ready、大小、长度、哈希、PNG、方法和错误码合同有反例测试；
- 超时、断开与取消会终止底层 fake OSS 读取；
- 全局 2、单账号 1 的 fail-fast 边界有确定性测试。

### 8.2 浏览器

- 即使普通 `/api/assets/:id` 模拟为跨域 307，裁剪仍成功；
- 编辑源只请求一次，Canvas 使用 blob URL，确认后生成正确派生节点；
- 取消或错误不上传；上传失败不改变原图；
- 原图被替换或画布持久化关闭时，派生上传被清理且不落节点；
- 页面无 tainted Canvas、未处理异常或新增 Provider/Generation 请求。

### 8.3 分层验证

1. safe preflight；
2. TypeScript/build；
3. m100、m2、m37、m80、m99 与必要 auth/security 定向；
4. 候选冻结后，因本轮修改共享媒体读取端口，允许且只运行一次 safe full；
5. 成功的 full 不重复。失败时只复验最小失败范围，修正后是否再跑 formal full 以项目硬门和新变更风险决定。

## 9. 文档与状态纪律

- 每完成服务端、客户端、专项测试、正式验证任一阶段，更新本文件的施工记录与 `TASKS.md`。
- 自动通过只记 `AUTO_PASS`；本地页面由 Agent 验证只记 `LOCAL_AGENT_PAGE_PASS`；用户没有亲测前保留 `USER_RECHECK`。
- `spec/UNBOUNDRY_CURRENT_STATE.md` 仍以 v0.6.31 生产为当前事实，本地候选不得改写成已发布。
- 原 main 工作树中的 `spec/public-templates-director-split-revision.json` 保持未改、未删、未提交。

## 10. 施工记录

### 2026-08-23 文档前置

- 用户明确同意最终方案并要求先落地文档，随后再实施。
- 已从 main `a29ac827` 建立独立 worktree/branch；原 main 受保护未跟踪 JSON 未进入隔离工作区。
- 本文件已在任何产品代码修改之前建立。
- 下一步：先补服务端失败测试与存储读取取消合同，再实施同站编辑源。

### 2026-08-23 服务端与客户端初版（历史检查点）

- 已新增 `server/mediaEditSource.ts`：owner-scoped GET、local/OSS port、长度/哈希/PNG/尺寸验证、全局2/单账号1 fail-fast admission、60秒deadline、断开取消和无签名URL响应。
- `MediaBlobStore.read` 已改为参数对象并传递可选 `AbortSignal`；local、memory、OSS、routed adapter 与既有 Provider reference consumer 已同步。TypeScript 首轮发现 m100 fake driver 仍使用旧参数及 Vite handler 第三参数冲突，均按新合同最小修正；第二轮 TypeScript 退出0。
- 已新增客户端 `editableImageSource.ts` resolver，固定 `redirect: error`、PNG/长度上限、Blob URL 与幂等 release；`ImageCropEditor` 改为加载同站 Blob、单次解码、取消/retry/revoke，并将固定 `sourceAssetId` 传入派生上传。
- 派生上传前后均核对来源 assetId；来源变化、持久化关闭或 operation/scope 漂移时不落节点并走既有删除补偿。
- 服务端专项最初新建为 m101；safe preflight 在执行产品测试前按设计 fail-close，指出固定清单必须是精确 120-spec 分区。为避免只因一个局部功能扩大 runner/manifest/全仓固定计数，本轮撤回自建 m101，并把四个编辑源专项合入既有 node-mode `m100-modular-ports.spec.ts`。这是测试归位，不是删除覆盖；safe runner 本身未修改。
- m2 关键裁剪用例已改为：普通资产 GET 若再次发生将模拟 307 到无 CORS 跨域图片，同时断言编辑器只使用 `blob:`。本条记录的是初版尚未验证的历史时点；当前结果以紧随其后的“定向验证与候选冻结”为准。

### 2026-08-23 定向验证与候选冻结

- safe preflight 已在 Node 22.23.1 / npm 10.9.8 下通过：固定 120 specs、1050 tests，4173 listener 未变化。
- m100 首次执行发现新增四个顶层测试会把冻结总数改成1054；未修改 runner/manifest，而是把断言并入既有 m100 端口测试，恢复精确1050。第二次发现 node-mode 测试自开随机端口触发网络审计，改成不联网的合成 request/response 后通过；这两次均发生在对应产品断言完成后或审计门，未掩盖失败。
- m100 最终11/11通过，覆盖：同站200 PNG、无 Location/签名URL、未登录/跨账号/非ready、方法、大小、类型、实际长度、哈希、PNG结构、503、504、同账号并发、全局并发、浏览器断开取消及容量释放。
- m2 首轮发现 React StrictMode 的开发态 effect 重挂会短暂产生重复编辑源请求；客户端把启动延后一轮可取消任务后，单次打开只发一次请求。随后来源竞态测试又证明仅把当前 prop 传入编辑器不足以冻结身份，已增加 `cropSourceAssetId` 打开时快照。最终 m2 10/10通过：普通素材路径被强制307到无CORS跨域图片时仍以 `blob:` 裁剪；取消、上传失败、成功派生、来源替换拒绝且零额外派生上传均通过。
- 共享读取端口与安全边界定向：m11 8/8、m37 35/35、m80 7/7、m99 18/18，共68/68通过；m100 11/11、m2 10/10另行通过。每次 safe runner 均附带 TypeScript、架构76条基线、source coverage、生产build与离线/凭据/网络保护，均通过；只有既有 chunk 体积提示。
- 预计范围曾写明可能扩展 m37/m80；实际检查证明既有 m37/m80 已覆盖共享读取与存储安全合同，无需改动测试文件。只运行其既有用例复验，避免为凑改动而改动。
- 当前候选已停止功能修改并冻结，下一步只运行一次正式 safe full。未访问真实 OSS、Provider 或生产；未 commit、push、tag、PR 或发布。

### 2026-08-23 正式验证收口

- 冻结候选只运行了一次正式 safe full：固定 `120/120` specs 均执行，`1049/1050` tests 通过，失败、重试和跳过分别为 `1/0/0`；source 与 snapshot SHA-256 均为 `d85e34be4ab1259df381f2b62268f72e3739d6b72dde12dd385f7ef7a58af239`，4173 listener 未变化，临时测试目录已清理，外网/凭据/真实 Provider/OSS 门禁均保持通过。
- 唯一失败是未改动的 `tests/m22-group-execution.spec.ts` 中既有画布缩放时序断言：期望 `0.72`，当次得到 `0.6830357142857143`。它不经过本轮新增编辑源、媒体读取或裁剪链路，因此没有把本次 full 记成 `FULL_PASS`。
- 按风险分层纪律，没有重跑 full；在同一份未改源码和同一 source SHA 上只复验失败规格 m22，结果 `37/37 PASS`，其中原失败用例通过。这支持“无关偶发时序波动”的判断，但不篡改正式 full 的 `1049/1050` 原始记录。
- 本轮最终自动证据为：图片修复及直接依赖定向 `89/89 PASS`；一次正式 full `1049/1050`；唯一失败规格隔离复验 `37/37 PASS`。本地工程候选完成，仍需用户实际页面复验后才能记 `USER_PASS`。
- 未访问真实 OSS、Provider 或生产；未 commit、push、tag、PR 或发布。生产当前事实仍是 v0.6.31，本候选尚未上线。

### 2026-08-23 v0.6.32 GitHub 交付授权

- 用户明确授权 commit、tag、push、PR，并允许按需更新版本；本候选版本确定为 v0.6.32。
- 授权仅覆盖 Git/GitHub 交付，不包含 SSH、生产备份、生产切换、真实 OSS/Provider 或付费生成；生产继续保持 v0.6.31。
- package/lock、final runtime 版本放行和对应部署测试同步为 0.6.32；权威状态文档明确拆分“候选代码版本”和“当前生产版本”，不得因 tag/PR 提前写成已上线。
- 版本同步后只运行直接受影响的 m38+m81：`56/56 PASS`；同一次安全入口附带 preflight、TypeScript、架构76条基线、source coverage、生产build与离线/凭据/网络保护，全部通过。source/snapshot SHA-256 均为 `55708bb8e7b11750f023c1840686054c9e6af8fb60d5a9a2f321223b0488c3ca`，4173 listener 未变化。
- 版本和文档同步没有改变已冻结的图片业务行为，因此没有重复正式 full；v0.6.32 继续继承本文件上一节如实记录的一次 full `1049/1050` 与失败规格隔离复验 `37/37 PASS`，不改写成全绿。

### 2026-08-23 GitHub 交付结果

- 功能与版本候选提交：`ca6bddb fix(canvas): add same-origin image editing for v0.6.32`。
- 分支 `codex/image-edit-source-2026-08-23` 已推送到 origin；GitHub PR #75 已创建并以 main 为目标分支。
- 注释标签 `v0.6.32` 绑定包含本记录的冻结候选分支头；标签和 PR 仅代表 GitHub 候选交付，不代表生产发布或用户验收。
- PR 的 GitHub Quality gates 结果以 GitHub 实际检查为准；本地证据不冒充远端 CI。
