# 存储读取规则（方案 A）详细实施计划

状态：`IMPLEMENTED / USER_PASS / HISTORICAL_PLAN`（代码、真实配置修复、生产部署、备份与恢复演练均已完成）
日期：2026-08-08
历史施工仓库：`/Users/mymy/Documents/unboundry1_1复刻/app`（HEAD `554d036`，工作树干净）；当前权威仓库为 `/Users/mymy/Documents/unboundry/app`，生产版本 v0.6.33/schema39

当前说明：本文件保留方案 A 的原始实施时点；后续真实 OSS 备份上传、生产部署与恢复演练已经完成。当前存储和发布事实以 `spec/UNBOUNDRY_CURRENT_STATE.md`、`spec/UNBOUNDRY_DEPLOYMENT_PLAN_2026-08-08.md`及版本回执为准，文中的“首次真实运行待授权”不得再解释为当前总状态。

## 1. 背景与目标

用户诉求：

1. 修复画布节点图片「无法显示图片」问题（真实 503）。
2. 以后部署服务器时避免素材丢失。
3. 希望实现「又本地又 OSS」的存储方式。

方案 A 目标语义：**「新素材云路由」开关只决定新素材写到哪里；读取永远按素材自身 `storage_backend` 读取，不被开关关断。** 本地优先为默认，OSS 作为扩展/备份。

## 2. 现状核验结果（本次只读审计证据）

### 2.1 真实配置状态（只读解密 `data/secrets/storage-profiles.enc.json`）

```json
{
  "activeProfileId": "5dd96684-6c16-4fff-ac90-f6e8b8502829",
  "mediaRoutingEnabled": true,
  "profiles": [{
    "id": "5dd96684-6c16-4fff-ac90-f6e8b8502829",
    "label": "TapFK上海OSS",
    "status": "verified",
    "bucket": "tapfk",
    "region": "oss-cn-shanghai",
    "lastVerifiedAt": "2026-08-06T12:59:55.064Z"
  }]
}
```

关键异常：`activeProfileId` 指向的配置状态是 `verified`（不是 `active`），而原始开关是 `true`。

### 2.2 直接根因（503 链路）

`server/secureStorageProfiles.ts:239` 的 `activeStorageProfile()` 要求：

```ts
profile.id === document.activeProfileId && profile.status === "active"
```

当前状态不满足 → 返回 `undefined` → 所有依赖它的 OSS 操作失败：

| 调用点 | 后果 |
| --- | --- |
| `server/assetStorage.ts:318-343` 图片 GET | 返回 503 `Cloud asset is temporarily unavailable`（即用户看到的现象） |
| `server/assetStorage.ts:361-375` 图片 DELETE | 503，云端对象成为孤儿 |
| `server/videoStorage.ts:184-198`、`243-258` | 视频读取/删除 503 |
| `server/audioStorage.ts:331-345`、`392-405` | 音频读取/删除 503 |
| `server/providerMedia.ts:354-362` | 真实生成时 OSS 参考素材不可用 |
| `server/groupDownload.ts:177` | 批量下载跳过 OSS 结果 |
| `server/auth.ts:866-877` | 删账号时 OSS 素材清理被跳过 |
| `server/generatedMediaCleanup.ts:24-32` | 取消任务时 OSS 补偿删除失败 |

### 2.3 为什么此前界面显示「本机存储 / 云请求关闭」

`server/storageAdmin.ts:113-124` 的 `statusBody()` 用同一套「必须 active」逻辑推算 `mediaRoutingEnabled`，于是把原始 `true` 掩盖成 `false`，并据此显示 `activeBackend: "local"`。`client/src/App.tsx:5456-5530` 直接消费该字段 → 管理员页显示「当前仍使用本机存储 / 云请求关闭」。

### 2.4 新素材实际写到哪里

`storageMediaRoutingState()`（`server/secureStorageProfiles.ts:249`）同样要求 status=`active`，所以当前原始开关虽然为 `true`，实际新素材仍写本机。也就是说：

- 旧 OSS 素材（70 个：41 图 / 21 视频 / 8 音频）不可读；
- 新素材全部写本机；
- 界面显示与真实意图相反，且无法从 UI 修复（点「开启」会因无 active 配置而 400）。

### 2.5 结论修正（诚实说明）

此前口头结论「开关同时控制新素材写哪和老 OSS 素材能否读，管得太宽」**不准确**。逐行审计后：读取路径本来就不查 `mediaRoutingEnabled`，真正的故障是**配置状态机被破坏**：对「正式配置」再次点击「测试连接」（`markStorageProfileVerified`，`server/secureStorageProfiles.ts:314`）会把 `active` 降级为 `verified`，但 `activeProfileId` 和原始开关保持不变，导致全部 OSS 读取失效，且状态接口掩盖了原始状态。

方案 A 的语义（开关只管写入、读取按素材后端）**本来就在代码里成立**，缺的是：状态不变量保护、读取容错、真实状态暴露和回归测试。

## 3. 详细实施方案

### L0：先救真实数据（不修代码前的前置步骤）

1. 再次全量备份（SQLite + 本地 media + secrets + manifest），备份前记录 378 条 media_assets 分布（local 308 / oss 70）。
2. 在临时目录演练同一修复逻辑（复制真实 secrets 到 temp 数据目录，不打印密钥），确认状态机修复后 `readableStorageProfile()` 可用。
3. 对真实库执行一次性修复：
   - `activeProfileId` 指向的 `verified` 配置恢复为 `active`；
   - `mediaRoutingEnabled` 从 `true` 改为 `false`（**保持用户当前看到的本地优先行为**，不静默恢复云路由）；
   - 写入 `admin_audit_events` 审计记录。
4. 重启 4173（用户重启或授权重启），抽查 3-5 个此前 503 的素材 ID：图片 GET 应为 307 → OSS 签名地址，视频/音频同理；新上传素材仍写本机。

### L1：代码语义固化（方案 A 本体）

1. `server/secureStorageProfiles.ts`
   - 新增 `readableStorageProfile()`：`activeProfileId` 命中且 `status ∈ {active, verified}` 即返回（`draft` 仍不可读）。读取/删除/下载/清理路径全部改用该函数：`assetStorage`、`videoStorage`、`audioStorage`、`providerMedia`、`groupDownload`、`auth.removeAccountMediaFiles`、`generatedMediaCleanup`。
   - `storageMediaRoutingState()` 语义收紧为「**原始开关 true 且存在 active 配置**」才开启；原始 true 但无 active 配置时按关闭处理，并由状态接口暴露警告（不静默）。
   - `markStorageProfileVerified()`：若目标配置正是 `activeProfileId` 且状态为 `active`，重测后保持 `active`，只刷新 `lastVerifiedAt/updatedAt`。彻底封死当前事故的触发路径。
   - 增加一致性守卫：任何写配置的路径结束时，若 `activeProfileId` 存在但指向非 `active` 配置，拒绝写入或自动清理并记录审计（二选一，推荐后者但要审计）。
2. `server/storageAdmin.ts` 状态接口
   - 保留全部旧字段（`activeBackend`、`cloudRequestsEnabled`、`oss.mediaRoutingEnabled`）防止 UI/测试破坏；
   - 新增：`oss.rawMediaRoutingEnabled`、`oss.effectiveMediaRoutingEnabled`、`oss.readableProfileAvailable`、`oss.objectCounts`（按 backend/kind）、`warning`（如「存在 70 个 OSS 素材但当前读取配置不可用」）。
3. `client/src/App.tsx` 管理员存储页
   - 显示一致性警告（存在 OSS 素材但读取配置不可用 / 原始开关与生效状态不一致）；
   - 「测试连接」按钮对正式配置改为「重新测试（保持正式）」；
   - 文案准确区分「新素材写哪里」与「旧素材读哪里」。

### L2：回归测试（m13 扩展 + 新增 m80）

新增 `tests/m80-storage-read-rule.spec.ts`（临时数据目录 + 独立端口 4198 + 自清理，不碰 4173）：

1. 合成配置：save → verify → activate → **再次 verify**，断言 `readableStorageProfile()` 仍可用、`markStorageProfileVerified` 不再降级 active。
2. HTTP 层：真实登录管理员（bootstrap）→ 直接在临时库插入一条 `storage_backend='oss'` 的媒体行 → `GET /api/assets/:id` 断言 307 且 `Location` 含 V4 签名（纯离线签名，不发起真实 OSS 请求）。
3. 路由关闭时存量 OSS 素材仍可读（语义固化）。
4. 路由开启时新上传仍按原逻辑走 OSS（沿用 m13 既有断言，不重复真实上传）。
5. 账号删除在「profile verified 但可读」状态下不报错、清理路径走通。
6. 状态接口在无可用读取配置时返回 `warning`。

m13 旧断言全部保留；其中真实 OSS 专项（`UNBOUNDRY_REAL_OSS_VERIFY=1`）修复后应重新可用，但默认仍跳过。

### L3：部署防丢（本地 + OSS 双保险）

1. 本地优先默认不变（L0 已把真实库修正为本地优先）。
2. 每日备份到 OSS：扩展 `scripts/backup-data.mjs`（或新增 `scripts/backup-to-oss.mjs`），把备份目录（SQLite + media + secrets + manifest）上传到 `backups/YYYY/MM/DD/` 前缀，使用独立备份凭证或最小权限 RAM（仅 `backups/*`），保留 30 天自动清理。不占产品上传关键路径。
3. 反向镜像（推荐一并做）：每日任务把 OSS 产品对象（`objects/*`）下载到本地备份目录并校验 SHA-256，解决「OSS 素材是唯一副本」的风险；不改变产品读写路径。
4. 恢复演练：`verify-backup.mjs` 扩展校验 OSS 对象清单；文档写明「新备份新 schema、旧备份恢复校验差异」规则。

## 4. 风险 / 隐患 / 应对

| # | 隐患 | 严重度 | 应对 |
| --- | --- | --- | --- |
| 1 | 修复时把原始 `mediaRoutingEnabled=true` 与用户所见「本地」搞混，误恢复云路由 → 新素材悄悄进 OSS | 高 | L0 显式改为 `false` 并审计；测试锁定生效状态；报告中向用户明示 |
| 2 | `media_assets` 未记录素材所属 OSS 配置/桶；以后换桶后旧 OSS 素材会按新桶签名而失读 | 高（远期） | 建议本批加 v34 迁移：`media_assets.storage_profile_id`，回填当前 70 条为 TapFK 配置；读取优先按行内 profile_id 解析；若用户暂缓，则文档明确「换桶前必须迁移或保留旧配置」 |
| 3 | 删除路径在配置不可用时静默失败 → OSS 孤儿对象 | 中 | readable 容错 + 审计；补孤儿对象清单工具（延后） |
| 4 | 当前备份不含 OSS 对象，OSS 丢失 = 素材丢失 | 高 | L3 反向镜像 + manifest |
| 5 | secrets 备份丢失 → 无法签名读取 OSS | 中 | 备份含 secrets；AK/SK 可在阿里云控制台找回 |
| 6 | 服务器时钟偏移 → V4 签名失败 | 低 | 已有错误分类；部署要求 NTP |
| 7 | 多管理员并发改配置（无文件锁，last-writer-wins） | 低 | 单管理员场景可接受；记录延后，不做过度设计 |
| 8 | 测试误触真实 OSS/4173 | 高 | 全部测试：temp 数据目录 + 独立端口 + 自清理；签名测试离线；真实 OSS 专项默认跳过 |
| 9 | UI 继续显示误导状态 | 中 | 新字段 + warning；旧字段兼容保留 |
| 10 | 修复后忘记重启 4173 → 用户仍看到 503 | 中 | 交付时明确提醒重启；L0 步骤 4 已含 |

## 5. 是否有更优方案（诚实对比）

- **A + 异步镜像（推荐）**：读取按素材后端 + 开关只管写入 + 每日备份/反向镜像。等价于「又本地又 OSS」，且不增加上传关键路径延迟/费用；冗余粒度是「天」。
- **B 双写（产品路径同步写本地 + OSS）**：只有需要近实时冗余才值得；上传延迟翻倍、费用翻倍、删除/ACL 复杂化，**不建议**作为产品路径。
- **C OSS 主存**：不适合本地优先和单机使用（离线/网络依赖/成本），仅多人远程部署时再评估。
- **未来可选项**：OSS 网关代理（服务端鉴权 + 缓存 + Range），多人公网部署时再评估；本次不做。

## 6. 实施顺序与验收清单

1. L0 备份 → 临时演练 → 真实修复 → 重启 → 抽查（图片/视频/音频各 1-2 个）。
2. L1 代码（readable 函数 + 状态机保护 + 状态接口 + UI）。
3. `npx tsc --noEmit` + `npm run build`（仅 chunk 体积 warning）。
4. m13 + m80 + m10 + 相关 m 系列回归（临时目录、独立端口、自清理）。
5. TASKS.md / 验收矩阵 / OpenAPI（如涉及）同步；commit（不 push）。
6. 用户实页验收：旧 OSS 图片/视频/音频恢复、新素材仍写本机、管理员页警告与开关行为、重启后仍正常。

## 7. 待用户确认的决策点

1. 修复后新素材默认写哪里：推荐**保持本机（routing=false）**，与当前界面一致；确认后实施。
2. 是否本批加 v34（`media_assets.storage_profile_id` 回填）：推荐加，防止以后换桶失读。
3. 每日 OSS 备份 + 反向镜像脚本：推荐做（可与主修复同批或紧随其后）。

## 8. 实施记录（2026-08-08）

用户已确认三项决策：①新素材默认本机（本地优先）；②本批加 v34 并回填；③做每日 OSS 备份与反向镜像脚本。

已完成：

- 代码：`readableStorageProfile()` / `storageProfileById()` / `storageProfileForMedia()`；7 条读取/删除/下载/清理路径按素材所属配置解析；`markStorageProfileVerified` 不再降级正式配置；v34 `media_assets.storage_profile_id`；状态接口新增 `rawMediaRoutingEnabled` / `effectiveMediaRoutingEnabled` / `readableProfileAvailable` / `objectCounts` / `warning`；管理页警告横幅与「重新测试（保持正式）」文案。
- 真实库：备份 `backups/2026-08-07T19-04-25-352Z`（v33，977 行 / 308 本地素材）；4173 热重载后 v34 已应用；secrets 已修复（TapFK 恢复 active、routing=false）；70 个 OSS 素材已回填 `storage_profile_id`；审计 2 条（repair + backfill）。
- 脚本：`scripts/repair-storage-state.mjs`（含 --backfill）；`scripts/backup-to-oss.mjs`（本地备份 → OSS `backups/` 前缀，含干跑与保留清理，首次真实上传待用户授权）；`scripts/mirror-oss-to-local.mjs`（OSS `objects/*` 镜像回本地，含 SHA-256 核对，首次真实运行待授权）。
- 测试：`tests/m80-storage-read-rule.spec.ts` 4 项；m10/m13/m31/m72 回归 30 通过、1 跳过（真实 OSS 专项需 `UNBOUNDRY_REAL_OSS_VERIFY=1`）；tsc 与生产构建通过（仅既有 chunk 体积提示）。
- 顺带修复：m10「trusted-duration migration」用例的老库 fixture 漏建 `project_metadata`（既有遗漏，与本批无关但导致该用例失败），已补齐。

待用户：

1. 4173 实页刷新，确认此前裂图的 OSS 图片/视频恢复显示；
2. 授权首次真实 OSS 备份上传与反向镜像（脚本已就绪，建议 RAM 策略允许 `backups/*` 前缀）；
3. 如需要可再次手动重启 4173（本次热重载已生效，重启仅为稳妥）。
