# Unboundry 生产服务器 P0 安全加固回执（2026-08-23）

## 1. 结论

- 状态：`PRODUCTION_HOST_P0_HARDENED / APPLICATION_UNCHANGED`
- 目标主机：腾讯云 `101.43.77.14`（SSH 别名 `live-cockpit`）
- 生产站点：`https://canvas.mymy.ltd`
- 生产版本：`0.6.31`，数据库 schema `39`
- 本次只修改服务器入口、运维面板暴露面、防火墙和系统软件包。
- 未修改 Unboundry 业务代码、数据库、用户数据、Provider 配置、OSS 数据或业务发布指针。
- 本次不是 `v0.6.32` 应用发布。
- 时间顺序：本回执的安全加固检查点为服务器时间`10:03`；随后`10:50`开始的低风险磁盘清理把系统盘从`76% / 28G available`改善为`61% / 45G available`，详见同日磁盘清理回执。

## 2. 加固前主要风险

1. 最近 7 天 SSH 失败记录约 22,698 次，公网暴力扫描明显。
2. SSH 有效配置允许密码登录和 root 登录。
3. 主机没有 Fail2ban。
4. `live-cockpit` 直接监听 `0.0.0.0:8420`，UFW 对公网开放该端口。
5. UFW 还开放了未使用的 `6901`。
6. 系统存在 154 个待更新包，其中审计识别出大量安全更新。

审计未发现成功的 root/密码入侵记录；观察到的成功 SSH 登录均为已配置密钥登录。

## 3. 变更前检查点

服务器检查点：

```text
/var/backups/codex-security-hardening-20260823-100349
```

目录权限为 `0700 root:root`。其中保存了变更前的：

- `/etc/ssh/sshd_config`
- `/etc/ssh/sshd_config.d/`
- `/etc/ufw/`
- `/opt/live-cockpit/.env`
- `/etc/systemd/system/live-cockpit.service`
- UFW 与 SSH 有效状态
- Fail2ban 安装后的基准配置

该检查点含敏感配置，不得复制到 Git、聊天记录或公开位置。

## 4. 已实施变更

### 4.1 SSH 只允许指定用户使用密钥登录

新增：

```text
/etc/ssh/sshd_config.d/00-codex-security-hardening.conf
```

关键策略：

```text
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
AllowUsers ubuntu
MaxAuthTries 3
X11Forwarding no
GatewayPorts no
ClientAliveInterval 300
ClientAliveCountMax 2
```

保留 `AllowTcpForwarding yes`，用于经过 SSH 认证的运维隧道。

验收：

- `sshd -t` 通过。
- `sshd -T` 确认密码登录、root 登录、键盘交互登录均为 `no`。
- 使用现有 `ubuntu` 密钥建立全新、独立 SSH 会话成功。
- 系统更新和重启后再次验收通过。

### 4.2 安装并启用 Fail2ban

安装 `fail2ban` 与 `whois`，新增：

```text
/etc/fail2ban/jail.d/sshd.local
```

策略：5 次失败/10 分钟触发封禁，初始封禁 1 小时，重复攻击递增封禁时间并加入随机抖动。

验收：

- `fail2ban.service` 为 `active + enabled`。
- `sshd` jail 为活动状态。
- 重启后自动恢复。

### 4.3 隔离 live-cockpit 运维面板

将：

```text
HOST=0.0.0.0
```

改为：

```text
HOST=127.0.0.1
```

结果：

- `live-cockpit` 仅监听 `127.0.0.1:8420`。
- 公网不能直接连接 `101.43.77.14:8420`。
- SSH 隧道端到端访问返回 HTTP 200。
- 面板需要先通过服务器 SSH 密钥认证后才能访问。

使用方式：

```bash
ssh -N -L 127.0.0.1:18420:127.0.0.1:8420 live-cockpit
```

然后在本机打开 `http://127.0.0.1:18420`；使用结束后在终端按 `Ctrl+C` 关闭隧道。

### 4.4 收紧公网防火墙

删除 `8420` 和未使用的 `6901` 的 IPv4/IPv6 放行规则。

重启后 UFW 仅保留：

- `22/tcp`：SSH
- `80/tcp`：HTTP 跳转/证书入口
- `443/tcp`：HTTPS

UFW 状态为 `active`，默认拒绝其他入站连接。

### 4.5 安装系统安全更新并切换新内核

执行 Ubuntu 官方/腾讯云镜像的软件包更新：

- 153 个软件包升级
- 8 个新依赖/内核包安装
- 0 个软件包删除
- 新内核：`6.8.0-138-generic`
- `dpkg --audit` 无异常输出
- `open-vm-tools` 有 1 个 Ubuntu 分阶段发布更新暂缓，不强行越过 phased rollout

服务器完成一次计划内重启。重启后：

- 当前内核为 `6.8.0-138-generic`
- `/var/run/reboot-required` 不存在
- SSH、Nginx、Unboundry、Fail2ban、live-cockpit、Caddy、Lumino 均为 `active + enabled`
- 关键服务 `NRestarts=0`

## 5. 生产验收证据

### 5.1 Canvas

当前发布指针：

```text
/opt/unboundry/releases/v0.6.31-modular-main-20260823
```

重启后探测：

| 检查项 | 结果 |
| --- | --- |
| `/` | HTTP 200 |
| `/api/version` | HTTP 200，`0.6.31` |
| `/api/health/live` | HTTP 200，`live` |
| `/api/health/ready` | HTTP 200，`ready`，schema `39` |
| `/api/auth/status` | HTTP 200，未登录状态正常 |
| `/.env` | HTTP 404 |
| `/.git/config` | HTTP 404 |
| Nginx 配置 | `nginx -t` 通过 |

HTTPS 响应继续包含 CSP、HSTS、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、严格 Referrer Policy 等安全响应头；`Server` 仅显示 `nginx`，不暴露版本号。

### 5.2 同机服务与备份

- Unboundry 仅监听 `127.0.0.1:4173`，由 Nginx 反向代理。
- Lumino 仅监听 `127.0.0.1:3017`，服务正常。
- Caddy 仅监听 `127.0.0.1:8080`，服务正常。
- live-cockpit 仅监听 `127.0.0.1:8420`。
- Unboundry 备份 timer 为 `active + enabled`。
- 最近一次备份服务结果为 `Result=success / ExecMainStatus=0`。
- 安全加固完成、磁盘清理开始前，系统盘使用率约76%，剩余约28 GiB；后续磁盘清理完成并只读复核为61%、剩余45G。
- 本次未重复执行 OSS 备份，也未产生 Provider 请求或付费生成。

### 5.3 主域名隔离

`https://mymy.ltd/` 继续返回纯 HTTP 401，不包含 Basic Auth 挑战头，因此浏览器不会再弹出账号密码框。该域名位于另一台服务器，本次 Canvas 主机加固未改变它。

## 6. 剩余风险与下一批建议

本次 P0 显著减少公网攻击面，但不等于“绝对安全”。建议后续按风险继续处理：

1. 收紧本地备份目录和媒体文件权限，并验证恢复流程。
2. 提升账号密码哈希参数并设计平滑迁移，避免强制用户重置密码。
3. 为管理员登录增加 MFA/通行密钥或可信网络限制。
4. 收紧 live-cockpit 的 30 天会话、Cookie 策略和 systemd 沙箱权限。
5. 持续监控磁盘、水位、登录失败、5xx、备份失败与证书到期。
6. 评估腾讯云 WAF/CDN/DDoS 防护；应基于实际流量和业务价值启用，不能替代应用鉴权与补丁管理。
7. 修复主机 locale 配置不一致（当前仅产生运维命令警告，不影响站点服务）。

## 7. 回滚边界

如 SSH、UFW 或 live-cockpit 出现回归，应先通过腾讯云控制台/VNC 保持救援入口，再使用检查点逐项恢复并分别执行：

```bash
sudo sshd -t
sudo systemctl restart ssh
sudo ufw status numbered
sudo systemctl daemon-reload
sudo systemctl restart live-cockpit
```

不得把整个检查点目录不加区分地覆盖回系统；应按故障项恢复单个配置并在重载前完成语法检查。

## 8. 线上只读复核（2026-08-23 11:24 CST）

- 内核仍为`6.8.0-138-generic`，`/var/run/reboot-required`不存在，`dpkg --audit`无异常输出。
- SSH有效配置继续满足：密码、root、键盘交互和空密码登录均禁用，只允许`ubuntu`公钥登录；`MaxAuthTries=3`，`sshd -t`通过。
- UFW仍为active，公网仅放行SSH、80和443的IPv4/IPv6规则；Fail2ban为`active + enabled`，`sshd` jail活动。
- `live-cockpit`仍只监听`127.0.0.1:8420`；Unboundry、Lumino和Caddy分别只监听`127.0.0.1:4173`、`3017`和`8080`。
- `ssh`、`nginx`、`unboundry`、`fail2ban`、`live-cockpit`、`caddy`和`lumino-web`均为`active + enabled`，关键服务`NRestarts=0`；备份timer为`active + enabled`且最近一次结果成功。
- Canvas公网root、version、live、ready和auth status均为HTTP 200，schema39；敏感路径均为404，安全响应头与隐藏详细Server版本继续生效。
- 复核仅执行只读HTTP和SSH状态查询，没有修改生产配置、重启服务、读取业务数据、发起Provider请求或写入OSS。

本回执与磁盘清理回执已通过docs-only PR #73于2026-08-23 squash merge为`c16139ce3a59092b6ac796ab8953fd3dc243bd27`，对应main Quality gates run `32615533816`已完成且`SUCCESS`；专用远端分支、本地分支和worktree均已清理。没有tag、应用release或新的生产写操作。

## 9. 最终状态

```text
PRODUCTION_HOST_P0_HARDENED
APPLICATION_UNCHANGED
CANVAS_VERSION=0.6.31
SCHEMA_VERSION=39
KERNEL=6.8.0-138-generic
SSH_KEY_ONLY=PASS
ROOT_SSH_DISABLED=PASS
FAIL2BAN=PASS
PUBLIC_8420_CLOSED=PASS
UFW_22_80_443_ONLY=PASS
CANVAS_LIVE_READY=PASS
BACKUP_LAST_RESULT=PASS
```
