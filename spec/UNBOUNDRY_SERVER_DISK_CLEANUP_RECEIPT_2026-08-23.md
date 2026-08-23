# Unboundry 服务器系统盘低风险清理回执（2026-08-23）

## 结论

- 状态：`LOW_RISK_DISK_CLEANUP_COMPLETE / APPLICATION_UNCHANGED`
- 系统盘占用从 `76%` 降至 `61%`，可用空间从 `28G` 增至 `45G`。
- `canvas.mymy.ltd` 及同机服务清理前后均正常；未变更应用代码、数据库、发布版本、Nginx/Caddy 配置或业务数据。
- 本次只处理已核对的过期临时文件、APT 下载缓存和旧 journal 日志。
- 时间顺序：P0安全加固检查点为服务器时间`10:03`，磁盘清理检查点为`10:50`；安全加固回执中的`76% / 28G`是清理前状态，本回执中的`61% / 45G`是后续清理完成状态，两者不冲突。

## 清理范围

清理前基线：

```text
/dev/vda2 ext4 118G 86G 28G 76% /
```

已处理：

1. `/var/tmp` 下超过 7 天的顶层 `unboundry-*` 临时项：
   - 截止时间：`2026-08-16 10:49:45`（服务器时间）
   - 数量：`65`
   - 精确字节数：`17,418,280,177`（约 `16.22 GiB`）
2. APT 下载缓存：清理前约 `931M`，清理后 `36K`。
3. systemd journal：按 `500M` 上限压缩，本次释放约 `44.1M`。

明确未处理：

- `/var/lib/unboundry`（应用数据，复核时 `289M`）
- `/var/lib/lumino-web`（应用数据，复核时 `3.6G`）
- `/var/lib/unboundry-backups`（备份，复核时 `5.7G`）
- `/var/lib/unboundry-rollbacks`（回滚包，复核时 `21G`）
- `/opt/unboundry/releases`、当前发布软链接、构建目录、密钥、OSS/Provider 数据
- 所有应用配置、Nginx/Caddy 配置、数据库和业务记录

## 安全检查与执行记录

删除前对候选集合执行了以下检查：

- 仅允许 `/var/tmp/unboundry-*` 顶层路径，拒绝越界路径。
- 候选集合固定为清单，不使用未解析的通配删除。
- 候选中无符号链接、无挂载点。
- `lsof` 未发现打开文件。
- systemd 单元未引用候选路径。
- 当前发布仍为 `/opt/unboundry/releases/v0.6.31-modular-main-20260823`。
- 先移动至隔离目录，完成服务与 HTTP 验证后，再删除隔离目录。

服务器检查点：

```text
/var/backups/codex-disk-cleanup-20260823-105052
```

检查点保留了候选清单、清理前后磁盘数据、服务状态和执行结果。临时文件实体在最终确认后已永久删除，因此这些临时文件本身不能从本机检查点恢复；业务数据、备份和回滚包从未进入删除范围。

## 清理后验证

磁盘：

```text
/dev/vda2 ext4 118G 69G 45G 61% /
/var/tmp                         730M
/var/cache/apt/archives           36K
```

服务状态：

- `unboundry`、`lumino-web`、`live-cockpit`、`live-cockpit-media`、`caddy`、`nginx`、`fail2ban`、`ssh`：`active`
- 核心服务 `NRestarts=0`
- `unboundry-backup.timer`：`active + enabled`
- 最近一次备份：`Result=success`、`ExecMainStatus=0`

Canvas 验证：

- `https://canvas.mymy.ltd/`：HTTP `200`
- `/api/version`：HTTP `200`，版本 `0.6.31`
- `/api/health/live`：HTTP `200`，`live`
- `/api/health/ready`：HTTP `200`，`ready`，schema `39`
- `/api/auth/status`：HTTP `200`，未登录状态返回正常
- `https://mymy.ltd/`：仍返回 HTTP `401`
- 同机 `8080`、`8420` 页面：HTTP `200`

包管理状态：`dpkg --audit` 无异常输出。

## 线上只读复核（2026-08-23 11:24 CST）

- 系统盘仍为`118G / 69G used / 45G available / 61%`，当前release仍为`/opt/unboundry/releases/v0.6.31-modular-main-20260823`。
- `ssh`、`nginx`、`unboundry`、`fail2ban`、`live-cockpit`、`caddy`和`lumino-web`均为`active + enabled`；关键服务`NRestarts=0`。
- `unboundry-backup.timer`为`active + enabled`，最近一次服务结果仍为`Result=success / ExecMainStatus=0`。
- 公网root、version、live、ready和auth status均为HTTP 200；点文件、Git配置、服务端源码、package和robots路径均为HTTP 404；`mymy.ltd`仍为HTTP 401。
- 复核只执行HTTP GET/HEAD、SSH状态读取和只读系统查询，没有删除文件、修改配置、重启服务、访问业务数据、发起Provider请求或写入OSS。

## 变更边界

- 用户已授权将本回执与安全加固回执通过`codex/server-ops-receipts-2026-08-23`专用分支和docs-only PR交付；这不构成应用发布。
- 未启用 WAF、MFA 或密码哈希升级。
- 未设置自动删除策略；后续若要建立保留周期，应另行盘点并先做可回滚方案。
