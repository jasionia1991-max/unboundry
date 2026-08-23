# Unboundry 治理、仓库卫生与 nginx 加固回执

日期：2026-08-23
状态：`PR_DELIVERY / CI_PENDING / PRODUCTION_NGINX_HARDENED / GITHUB_HYGIENE_APPLIED / NO_APP_RELEASE`

## 范围

本轮只处理五项已获用户同意的建议：权威文档一致性、轻量CI、仓库卫生、需求触发式模块化治理和nginx加固。package继续为`0.6.31`，没有业务代码、schema、数据库、Provider、OSS或应用release变化。

## 本地候选

- worktree：`/Users/mymy/Documents/unboundry-governance-hardening-2026-08-23`
- branch：`codex/governance-hardening-2026-08-23`
- base：`origin/main@32b129fc9b338d7619d40f72c9089735f613e7e7`
- `AGENTS.md`、模块化审计/路线图/checkpoint统一声明当前v0.6.31。
- m38同时核对package版本、AGENTS当前生产版本和三份模块化文档的`CURRENT_V0_6_31_USER_PASS`标记。
- `.github/workflows/quality-gates.yml`包含safe preflight、TypeScript、架构边界、source coverage和`npm audit --audit-level=high`；safe full不在每次提交运行。
- `deploy/nginx.template.conf`和其fail-closed validator新增`server_tokens off`、敏感源码路径404与robots 404合同。
- 没有真实功能触发；第三至第七模块化批次未启动，也没有机械拆分大文件。

## 自动验证

- 环境：Node `22.23.1`、npm `10.9.8`。
- safe preflight：120 specs，skip 0，4173 listener不变。
- m38：`15/15 PASS`。
- m96：修改运维脚本后source coverage先按设计阻止旧hash；同步行为目标hash后，首轮暴露新增两个404的directive精确计数未更新。只修该计数并最小复验，最终`4/4 PASS`。
- architecture：198 source files、627 runtime edges、119 type edges、76条精确baseline，PASS。
- source coverage：399文件稳定，TypeScript 356/356、JavaScript 43/43、运维脚本28项，PASS。
- 安全入口附带TypeScript、build、离线依赖安装和源码快照门均通过；没有运行safe full。

## GitHub与本地仓库卫生

- 关闭冲突草稿PR #68，保留其审计记录。
- 删除8条已有merged PR或已被v0.6.31取代的远端分支。
- 仓库设置为合并后自动删除分支；Vulnerability Alerts启用。
- main分支保护API仍因当前私有仓库套餐返回403，本轮没有冒充已开启。
- prune 6条指向已不存在临时目录的worktree元数据。
- 删除2个工作树干净、位于`/private/tmp`且提交可由main或已合并PR恢复的旧worktree；没有使用`--force`。
- 使用安全的`git branch -d`删除21条已合入main且未被有效worktree占用的本地分支；未强删未合并分支，未删除用户目录中的有效worktree。

## 生产 nginx

- 主机：`101.43.77.14`；站点：`canvas.mymy.ltd`。
- 原配置：`/etc/nginx/sites-available/canvas-mymy-ltd`，SHA-256 `2c6e90d1e558ac9b9bbc27f54f58620dfdbd863ea9383b2e2aac5c2c29c6020f`。
- 原配置备份：`/etc/nginx/sites-available/canvas-mymy-ltd.before-hardening-20260823`。
- 新配置与仓库`ops/production/canvas-mymy-ltd.nginx.conf`逐字节SHA-256：`bdc06386c924547949cb8c1bf592aa9eb1dce9a536037c841d7a59db8f5a47ed`。
- 先保存原配置，再安装候选；`nginx -t`通过后执行reload。没有重启应用服务。
- reload后：nginx active、`unboundry.service` active、`NRestarts=0`、current仍为`/opt/unboundry/releases/v0.6.31-modular-main-20260823`。
- 公网结果：`/`、`/api/version`、`/api/health/live`、`/api/health/ready`均200；`/.env`、`/.git/config`、`/server/database.ts`、`/package.json`、`/robots.txt`均404；响应只显示`Server: nginx`，不再显示详细版本。

## 交付边界

用户已明确授权commit、push和提PR，候选通过`codex/governance-hardening-2026-08-23`专用分支与PR交付。merge、tag和应用release不在本次授权内；GitHub Actions结果必须以PR checks为准，不得在检查完成前预写PASS。应用版本与release没有变化，也不得把本轮nginx运维加固冒充v0.6.32发布。
