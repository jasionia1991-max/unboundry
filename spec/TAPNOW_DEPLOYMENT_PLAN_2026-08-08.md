# TapNow 私有复刻「部署到云服务器」详细方案

状态：已上线（2026-08-08 完成阶段 2-4；阶段 5 备份定时已装、首次备份与恢复演练已通过；剩余事项见 §10）
日期：2026-08-08
目标：把当前单机应用部署到用户的云服务器，任何设备用浏览器访问域名即可登录和操作，数据只有一份。

## 1. 目标与边界

### 1.1 目标

- 云服务器上运行同一套应用（前端 + 服务端 API + 数据库 + 媒体 + OSS），公网域名 + HTTPS 访问；
- MacBook / Win11 / 手机等设备浏览器打开同一网址，登录后操作同一份项目数据；
- 账号权限、生成安全、费用保护、媒体隔离等现有机制在公网部署下继续生效；
- 每日自动备份到阿里云，可恢复；服务器故障时可快速重建。

### 1.2 边界（明确不做）

- 不做多机分布式、不做数据库主从、不做实时多人协同（现有 409/重试保护已够「轮流操作」）；
- 不做公网注册、公共分享、搜索引擎入口（工程约束 §4 只供本人和受邀朋友使用）；
- 不在此方案中切换数据库（SQLite 足够个人/好友规模，保持 WAL 单机架构）；
- 不在此方案中改产品功能，只做「可部署」所需的最小加固。

## 2. 项目现状完整盘点（证据）

### 2.1 运行方式

- 无独立 Node 服务入口：全部 API 是 `vite.config.ts` 里的插件中间件，dev 和 preview 都注册同一套 API（`configureServer` / `configurePreviewServer` 成对出现，`vite.config.ts:120-520`）；
- 生产运行 = `npm run build`（产物 `dist/client`）+ `npm run preview`（`vite preview --host 127.0.0.1 --port 4173`），launchd 当前即此形态（`~/Library/LaunchAgents/com.tapnow-replica.4173.plist`，现在是 dev 模式参数，之前曾切过 preview）；
- `devFixtureApi` 只在 dev 生效（`vite.config.ts:57`），生产 preview 不带测试夹具；
- `testDataDirectoryApi` 在 preview 也注册，但需要 `TAPNOW_TEST_AUTH_BYPASS=1` 才响应（服务器不设此变量即可）。

### 2.2 数据

- 全部在 `data/`：`tapnow.sqlite`（约 2MB + WAL）+ `media/`（130MB、308 个本地文件）+ `secrets/`（20KB、AES-256-GCM 加密的 OSS/Provider 密钥）；
- 数据库：SQLite WAL、`busy_timeout=5000`、schema v34（`server/database.ts:1621-1689`），迁移用 `schema_migrations` 台账，天然适合整目录备份；
- 媒体：本地 + 阿里云 OSS（bucket `tapfk`，上海）；读取按素材自身 `storage_backend`（本次已修复）；v34 已记录每个 OSS 素材所属配置；
- 备份：`scripts/backup-data.mjs`（SQLite + media + secrets + manifest）、`verify-backup.mjs`（恢复演练）、`backup-to-oss.mjs`（上传 OSS `backups/` 前缀，含干跑与保留清理）、`mirror-oss-to-local.mjs`（OSS `objects/*` 镜像回本地，含 SHA-256 核对）；`.gitignore` 已排除 data/media/secrets/backups/tmp。

### 2.3 鉴权与安全现状

- 会话 Cookie：`HttpOnly; Path=/; SameSite=Strict; Max-Age`，`Secure` 仅当 `TAPNOW_SECURE_COOKIES=1` 或 `NODE_ENV=production`（`server/auth.ts:76-92`）——部署时必须显式设 Secure；
- 跨站保护：`SameSite=Strict` + 服务端 Origin/Host 校验（`server/auth.ts:185-197`）；
- 首管理员：仅当用户表为 0 时可用；默认只允许本机回环创建，除非 `TAPNOW_BOOTSTRAP_REMOTE=1`（`server/auth.ts:380-391`）；
- 存储管理写操作：要求本机回环或 HTTPS（`server/storageAdmin.ts:61-77,193`）；
- 权限：六类管理接口 + 前端路由均有 `manage_*` 权限守卫（PERM-001～012 已 PASS）；
- 出站请求：强制 HTTPS + 证书校验 + DNS 防重绑定 + 私网/环回拦截；代理只允许本机回环代理（`server/outboundNetwork.ts:149-169,354-357`，`TAPNOW_OUTBOUND_HTTPS_PROXY` / `HTTPS_PROXY`）；
- 密钥：OSS/Provider 密钥不落浏览器、不落 SQLite、不落日志，加密存 `data/secrets`；
- 测试后门：`TAPNOW_TEST_AUTH_BYPASS`、`TAPNOW_TEST_PROVIDER_PROFILE_BARRIER` 仅测试用，服务器一律不设。

### 2.4 已知公网化缺口（部署前必须处理）

1. **反代后「本机回环」判定失效**：nginx/Caddy 与应用同机时，应用看到的远端地址恒为 127.0.0.1，`isLoopback`（`auth.ts:175-183`）和 `localRequest`（`storageAdmin.ts:61-68`）会把公网请求也当成本机 → 首管理员可被远程创建、存储写操作可绕过 HTTPS 要求。需新增 `TAPNOW_TRUST_PROXY=1` 语义：使用 `X-Forwarded-For` 判断真实来源，且存储写操作必须同时满足 `X-Forwarded-Proto: https`。
2. **Cookie Secure 不默认**：`vite preview` 进程默认 `NODE_ENV` 未定义，Secure Cookie 不会开；需在 systemd 环境变量里设 `TAPNOW_SECURE_COOKIES=1`（或 `NODE_ENV=production`）。
3. **上传体积上限**：视频单文件最大 500MB（`server/videoStorage.ts`），反代默认请求体上限（nginx 1M）必须调大（`client_max_body_size 600m`；Caddy 默认无此限制但建议显式设置），代理超时也要放宽。
4. **首管理员初始化流程**：现有数据库直接带过去时已有 mymy 管理员，bootstrap 天然关闭；若全新服务器需先通过 SSH 在服务器本机创建管理员，再开公网防火墙。
5. **测试残留**：真实库还有一条 `__test__` 测试用户（TASKS 2026-08-07 记录）；部署前应清理。
6. **代理策略**：当前 Mac 的 launchd 给服务配了本地代理（HTTP(S)_PROXY=127.0.0.1:49111），且出站代码只接受本机回环代理；云服务器上 OpenRouter/火山方舟能否直连取决于服务器区域——需决策「直连」或「服务器上再跑一个本机代理」。
7. **Cookie 域名/路径**：当前 Cookie 是 Host 无关的相对 Cookie，部署后同域自动匹配，无需改代码。
8. **数据目录**：应用默认 `process.cwd()/data`，服务器上用 `TAPNOW_DATA_DIR=/var/lib/tapnow` 显式指定，避免部署目录误写。
9. **Node 版本**：本机 v25.9；服务器建议 Node 22 LTS（engines `>=22`，Vite 8 要求 `^20.19 || >=22.12`）。
10. **备案/区域**：中国大陆服务器 + 域名公网服务需要 ICP 备案；不想备案可选中国香港/新加坡区域（此时 OpenRouter 通常可直连，OSS 上海跨区访问延迟可接受或改用加速域名）。

## 3. 目标架构

```text
MacBook / Win11 / 手机 浏览器
        │  HTTPS（域名，443）
        ▼
  云服务器（Ubuntu 24.04 LTS，建议 2C4G/50G）
   ├─ Caddy 2（自动 HTTPS 证书，反代 127.0.0.1:4173）
   ├─ vite preview --host 127.0.0.1 --port 4173（systemd 常驻）
   │    ├─ dist/client（前端产物）
   │    ├─ /var/lib/tapnow（SQLite + media + secrets）
   │    └─ 后台生成任务 / 费用保护 / 权限
   ├─ systemd timer：每日备份 → 阿里云 OSS backups/（保留 30 天）
   └─ systemd timer：OSS objects/* 镜像回本地（双保险）
        │
        ▼
  阿里云 OSS tapfk（上海）：新素材路由 + 每日备份 + 素材镜像
```

要点：

- 应用继续只监听 127.0.0.1，公网入口只有 Caddy 443（80 一律 301 跳 443）；
- 数据唯一事实源在服务器 `/var/lib/tapnow`；任何设备访问的都是同一份；
- 新素材在服务器上建议开启「云路由」直接进 OSS（服务器磁盘只留旧本地素材），旧本地素材保持原位并进入每日备份；
- 若用户在服务器本机跑代理（如 clash/xray 127.0.0.1:xxxx），设 `TAPNOW_OUTBOUND_HTTPS_PROXY=http://127.0.0.1:xxxx`，否则不设。

## 4. 分阶段实施步骤

### 阶段 0：信息确认（需要用户提供）

- 云服务器：哪家、区域、配置（建议 Ubuntu 24.04，2C4G/50G 起步）；
- 域名：是否已有、是否需要新购；是否已备案（中国大陆）或选择香港/海外区域；
- Provider 网络：OpenRouter / 火山方舟在服务器上能否直连，是否需要本机代理；
- 是否把现有数据（账号、画布、素材、配置）整体迁移到服务器（推荐：是）。

### 阶段 1：代码最小加固（已完成，提交见 git log）

1. `TAPNOW_TRUST_PROXY=1` 支持：
   - `server/auth.ts isLoopback` 与 `server/storageAdmin.ts localRequest/secureMutationTransport` 在信任反代时改用 `X-Forwarded-For` 首个 IP 判定真实客户端；
   - 存储写操作在信任反代时要求 `X-Forwarded-Proto === "https"`；
   - 文档写明：只有 Caddy/nginx 在应用前面时才设此变量。
2. Cookie 加固：`TAPNOW_SECURE_COOKIES` 保持现有语义，部署文档强制设置。
3. 清理 `__test__` 测试用户（备份后执行，审计记录）。
4. 生产模式确认：`devFixtureApi` 不进 preview（已确认），无需改。
5. 回归：tsc、build、m11/m13/m78/m80 + 全量相关模块；验收矩阵新增 DEP-001～DEP-010。

阶段 1 完成情况（2026-08-08）：

- `server/auth.ts` 新增 `clientAddress()`：`TAPNOW_TRUST_PROXY=1` 时按 `X-Forwarded-For` 首个 IP 判定真实客户端，`isLoopback` 改用该函数（防止反代后被当成环回）；
- `server/storageAdmin.ts` `localRequest`/`secureMutationTransport` 同步支持：信任反代时，经反代进来的存储写操作必须带 `X-Forwarded-Proto: https`；直连本机（SSH/curl，无转发头）仍放行；
- `.env.example` 补充 `TAPNOW_SECURE_COOKIES` / `TAPNOW_TRUST_PROXY` / `TAPNOW_DATA_DIR` / `TAPNOW_BACKUP_DIR` 部署说明；
- 新增 `tests/m81-deployment-hardening.spec.ts` 2 项：远程伪造环回被拒、存储写操作要求 HTTPS 转发头、直连本机管理流不受影响；
- 测试残留核对：真实库 `__test__` 账号及关联行已为 0（此前已被删除，仅保留历史审计记录 id=151，属正常历史，不删）；
- 回归：tsc、build 通过；m81 2/2、m13 5/6（1 项真实 OSS 专项默认跳过）、m80 4/4。

### 阶段 2：服务器基础准备

1. 购买/开通服务器，Ubuntu 24.04 LTS，安全组只放行 22（SSH）、80、443；其余全关；
2. SSH 加固：密钥登录、禁用密码登录、禁止 root 直接登录（或仅密钥）；
3. 安装：Node 22 LTS、git、Caddy、rsync、curl；
4. 创建运行用户 `tapnow`（非 root），工作目录 `/opt/tapnow-app`，数据目录 `/var/lib/tapnow`；
5. 从仓库拷贝代码（不含 .git、data、node_modules），`npm ci` 后 `npm run build` 产出 `dist/client`；
6. 首次以 127.0.0.1 启动，SSH 内确认 `/api/auth/status` 正常。

### 阶段 3：数据迁移（从 MacBook → 服务器）

1. Mac 上先 `npm run data:backup`（备份含 secrets）；
2. `rsync -a data/ 服务器:/var/lib/tapnow/`（或先同步备份目录再恢复），对账 manifest；
3. 服务器上 `scripts/verify-backup.mjs` 校验 SQLite/media/secrets；
4. 配置 `TAPNOW_DATA_DIR=/var/lib/tapnow` 启动 systemd，SSH 内 `curl http://127.0.0.1:4173/api/auth/status` 确认 `bootstrapRequired=false`、旧账号可登录；
5. 服务器本机浏览器登录旧 mymy 账号验证画布/素材/任务；
6. 服务器上复用现有 OSS 加密配置，先在「路由关闭」下确认旧 OSS 素材可读，再决定开启「新素材云路由」；
7. 清理 `__test__` 用户（备份后执行）。

### 阶段 4：域名 + HTTPS + 公网

1. DNS：`app.<你的域名>` A 记录指向服务器 IP；
2. Caddyfile 示例（自动申请/续期证书）：

```caddyfile
app.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4173 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-For {remote_host}
    }
    request_body {
        max_size 600MB
    }
}
```

3. `TAPNOW_TRUST_PROXY=1` + `TAPNOW_SECURE_COOKIES=1` 写入 systemd 环境；
4. 公网验收：手机流量（非 Wi-Fi）+ Win11 浏览器分别访问域名 → 登录 → 看画布/生成/下载/管理员页；
5. 验证安全边界：未登录访问 `/api/admin/*` 403；普通账号越权 403；HTTP 80 自动跳 HTTPS；错误页不泄露密钥/路径。

### 阶段 5：运维（定时备份 / 监控 / 恢复）

1. systemd timer（每天 03:30）：先 `backup-data.mjs` 到 `/var/lib/tapnow-backups`，再 `backup-to-oss.mjs --retain-days 30` 上传 OSS `backups/`；
2. systemd timer（每天 04:30 或每周）：`mirror-oss-to-local.mjs --dest-dir /var/lib/tapnow-oss-mirror`，把 OSS `objects/*` 拉回本地核对；
3. 日志：systemd journal + `journalctl -u tapnow-replica`；日志轮转；
4. 健康检查：每 5 分钟 `curl -fsS http://127.0.0.1:4173/api/auth/status`（失败告警按用户偏好）；
5. 恢复演练（每季度或每次大改前）：用最新备份在临时目录 `verify-backup.mjs --runtime-port 4198` 起服务并抽查画布/媒体；
6. 升级流程：备份 → 拉新代码 → `npm run build` → 重启 systemd → 冒烟 → 记录。

### 阶段 6：收口

- TASKS.md 部署章节、验收矩阵 DEP-001～DEP-010、OpenAPI 如涉及；
- 备份/恢复文档、Caddy/systemd 配置归档到 `scripts/deploy/`（模板，不含真实密钥）；
- 用户逐项实页验收后转 PASS。

## 5. 服务器与网络选型建议

| 项目 | 建议 | 理由 |
| --- | --- | --- |
| 系统 | Ubuntu 24.04 LTS | 生态成熟、systemd 原生 |
| 规格 | 2 核 4G / 50G SSD 起步 | SQLite + 130MB 媒体 + 500MB 上传缓冲够用；后续不够再升 |
| 区域 | 中国香港/新加坡（免备案、OpenRouter 通常直连）或上海（需备案、OSS 同区最快） | 关键决策，见 §6 |
| 反代 | Caddy 2 | 自动 HTTPS，配置最短，适合个人项目 |
| Node | 22 LTS | 与 engines/Vite 要求一致，比本机 25 更稳 |
| 数据库 | SQLite（保持） | 单机单写者，WAL + 每日备份足够 |
| OSS | 继续用 tapfk（上海） | 已有全部素材与配置；跨区使用可后续加加速域名 |

## 6. 需要用户决策的问题（含影响）

1. **服务器区域/备案**：大陆服务器必须 ICP 备案（周期数天-数周），域名解析才能正式对外；香港/新加坡免备案但 OSS 跨区。→ 决定后我按对应流程细化。
2. **Provider 访问**：OpenRouter 在国内服务器通常连不上；火山方舟国内直连正常。→ 要么选香港/新加坡，要么在服务器本机跑一个只允许回环的代理并设置 `TAPNOW_OUTBOUND_HTTPS_PROXY`。
3. **预算**：服务器月费、OSS 存储/流量（个人量级很低，备份 30 天约 4GB）。
4. **现有数据是否整体迁移**：推荐整体迁移（账号/画布/素材/密钥原样带过去，首次登录即旧账号）。
5. **新素材存储策略**：推荐服务器上开启云路由（新素材直接进 OSS，服务器磁盘压力小）；旧本地素材保持本地 + 每日备份 + 镜像。
6. **域名**：有无现成域名；子域名偏好（如 `tap.yourdomain.com`）。

## 7. 风险与应对

| 风险 | 等级 | 应对 |
| --- | --- | --- |
| 反代后回环判定失效导致安全边界被绕过 | 高 | 阶段 1 的 `TAPNOW_TRUST_PROXY` 加固 + 公网验收清单 |
| Cookie 不带 Secure，公网明文传输会话 | 高 | systemd 强制 `TAPNOW_SECURE_COOKIES=1`；验收用浏览器 DevTools 检查 Set-Cookie |
| 大视频上传被反代截断/超时 | 中 | `request_body max_size 600MB`、代理超时放宽、上传前确认 Content-Length |
| 数据迁移出错（半拷贝） | 高 | 先 Mac 备份 → rsync 完整 `data/` → verify-backup 校验 → 旧库暂不删除，保留回退 |
| OSS 密钥在服务器泄露 | 高 | secrets 目录 0700、RAM 最小权限、不落日志/环境变量/仓库 |
| 备份定时任务失败无人知 | 中 | 备份脚本失败退出非 0 + journal + 每日健康检查；恢复演练定期做 |
| 服务器被爆破 | 中 | 仅 22/80/443、SSH 密钥、fail2ban（可选）、Caddy 自动 HTTPS |
| 生成费用失控（多设备同时操作） | 中 | 现有生成安全并发/频率/费用上限在服务端生效；部署后复测 m14 场景 |
| SQLite 写锁在多人并发时排队 | 低 | WAL + busy_timeout；个人/好友规模无压力；真到瓶颈再评估迁移 |
| 域名/证书到期 | 低 | Caddy 自动续期；DNS 提醒 |

## 8. 验收清单（DEP）

| ID | 验收项 |
| --- | --- |
| DEP-001 | 公网 HTTPS 访问，手机/Win11 浏览器登录并操作同一份数据 |
| DEP-002 | 首管理员不可远程创建；未登录/越权访问管理接口 403 |
| DEP-003 | 存储写操作在公网只能 HTTPS；Cookie 带 Secure |
| DEP-004 | 旧本地素材 + 旧 OSS 素材 + 新素材（云路由开启后）全部可读 |
| DEP-005 | 上传 500MB 级视频成功；批量下载、播放、Range 正常 |
| DEP-006 | 每日备份自动执行并上传 OSS；恢复演练通过 |
| DEP-007 | 生成安全（并发/频率/费用上限）在公网场景生效 |
| DEP-008 | 服务器重启后服务自恢复，数据/会话/任务不丢 |
| DEP-009 | 测试后门变量未设置；测试夹具/测试账号不存在 |
| DEP-010 | 文档（TASKS/矩阵/部署手册）收口，用户逐项确认 |

## 9. 本批行动边界

- 本文件只是方案，未改任何代码；
- 等用户确认信息与决策后，先做阶段 1 代码加固 + 回归，再做服务器与迁移，每阶段验收后再继续；
- 所有真实服务器/域名/备案操作需用户显式授权；付费与密钥操作单独确认。

## 10. 部署实施记录（2026-08-08）

已完成：

- 服务器：腾讯云轻量上海（101.43.77.14，4C8G/120G，Ubuntu），Node v22.23.2 装于 /opt/node22；应用位于 /opt/tapnow-app，数据位于 /var/lib/tapnow（schema v34，378 素材，mymy 管理员）；systemd `tapnow-replica.service` 开机自启（127.0.0.1:4173）；
- 域名：`canvas.mymy.ltd` A → 101.43.77.14（阿里云云解析）；Let's Encrypt 证书已签发（2026-11-05 到期，certbot 自动续期）；nginx 新增 canvas 站点（80→301，443→应用），live-cockpit 保持 `default_server` 不受影响；nginx/certbot 配置均已备份；
- 安全：`TAPNOW_TRUST_PROXY=1`、`TAPNOW_SECURE_COOKIES=1`；公网 bootstrap 实测 403；未登录访问素材 401；测试后门变量未设置；
- 备份：`tapnow-backup.timer` 每日 03:30（Persistent=true 开机补跑）；首次真实备份已上传 OSS `objects/backups/2026-08-07T20-18-27-167Z/`（317 文件，HEAD 抽查通过）；`verify-backup.mjs` 恢复演练通过（临时目录恢复 + 启动读取画布）；
- `vite.config.ts` 增加 `preview.allowedHosts: ["canvas.mymy.ltd"]`（Vite 防 DNS 重绑定需要）。

待办/延期：

1. 阿里云 RAM 无 `oss:ListObjects` 权限：每日备份可正常上传，但「旧备份自动清理」与「OSS→本地镜像」会跳过（脚本已 fail-soft）；需在 RAM 策略放行 `oss:ListObjects`（bucket 级）与 `backups/*` 前缀后启用 30 天清理；当前备份前缀为 `objects/backups/` 以兼容现有最小权限；
2. 服务器代理（OpenRouter）：用户决定延期，先用火山方舟；代理方案保持 `TAPNOW_OUTBOUND_HTTPS_PROXY`（仅回环）待命；
3. 待用户实页验收：旧 OSS 素材在服务器上可见（DEP-004）、手机/Win11 多设备访问、500MB 级视频上传、Cookie Secure（浏览器 DevTools）、火山方舟公网生成；
4. 本地暂存备份目录（/var/lib/tapnow-backups）暂不自动清理，后续随 RAM 权限一并处理；
5. 正式部署后 OpenAPI/文档继续按 DEP 验收清单收口。
