# Unboundry 版本更新推送（方案 A）实施计划

状态：IMPLEMENTED（2026-08-08）

## 1. 目标

- 版本号规范化：v0.1.0 起步；修 bug 加补丁位（v0.1.1）、加功能加次版本（v0.2.0）、大改加主版本（v1.0.0）；每次发布打 git 标签。
- 正在使用的页面无需轮询：服务器通过 SSE 实时通道推送当前版本；旧页面自动弹出「已更新到 vX.Y.Z」提示。
- 点「刷新」前先等画布保存完成，再整页刷新，刷新后回到同一画布/项目（URL 不变）。
- 发布脚本一键完成：改版本号 → 测试/构建 → 同步服务器 → 构建 → 重启 → 健康检查 → 推送标签。

## 2. 实现

### 服务端

- `server/version.ts`：
  - `GET /api/version` → `{ version }`（版本号读 package.json，随构建/重启生效）；
  - `GET /api/updates` → SSE 流：连接即发送当前版本，之后每 25s 心跳保活；客户端断开自动清理。
- `vite.config.ts`：注册 `/api/version` 与 `/api/updates`（放在 `/api` 鉴权门之前，公开只读）；`define.__UNBOUNDRY_VERSION__` 把构建时版本号嵌入前端。
- OpenAPI：登记 `/api/version`（m20 同步）。
- nginx：canvas 站点 `proxy_buffering off`（SSE 不被缓冲）。

### 前端

- `client/src/updates/UpdateNotice.tsx`：
  - EventSource 连接 `/api/updates`；收到版本号与构建时版本（`__UNBOUNDRY_VERSION__`）不一致时显示底部提示条；
  - 提示条：「已更新到 vX.Y.Z」+「刷新」按钮（灰色紧凑风格，`data-testid="update-notice"`）；
  - 点击刷新：先 `flushCanvasSave()` 等待画布落盘（超时兜底），再 `location.reload()`。
- `CanvasSurface` 在 `GenerationCanvasContext.Provider` 内挂载提示条（复用真实 flush）。

### 发布脚本 `scripts/deploy.mjs`

`node scripts/deploy.mjs --version 0.2.0 [--ssh live-cockpit]`：

1. 本地 `npm version <版本> --no-git-tag-version`（更新 package.json/package-lock）；
2. 本地 `npm run build`；
3. git 提交 + 打标签 `v<版本>`；
4. rsync（删除模式、排除数据/依赖）同步到服务器 `/opt/unboundry`；
5. 服务器构建 + `systemctl restart unboundry.service` + `/api/version` 健康检查；
6. `git push origin main --tags`。

## 3. 体验与边界

- 开着的旧页面：服务器重启后 SSE 自动重连 → 新版本号 → 弹提示 → 点刷新 → 保存后整页刷新，回到同一画布；
- 新打开/刷新的页面：构建版本 == 服务器版本，不弹提示；
- 多标签页各自弹一次；未开页面下次打开即新版本；
- 重启 2-3 秒窗口内刚好提交的操作可能报一次网络错误，刷新/重试即可；后台生成任务有断点恢复。

## 4. 测试

- m82：`/api/version` 返回 package.json 版本；SSE 首帧携带版本；页面在版本变化时弹提示、同版本不弹。
- 回归：m20 OpenAPI 列表 +v/api/version；tsc/build。

## 5. 风险与应对

- SSE 被反代缓冲 → nginx `proxy_buffering off` + `X-Accel-Buffering: no`；
- 刷新丢最后几秒 → 点击前 `flushCanvasSave` 等待落盘（超时 4s 兜底）；
- 版本号不一致误弹 → 只对比「构建时版本 vs 服务器当前版本」，新页面天然相等；
- 发布失败 → git 标签/提交可回退，服务器旧版本可通过 git 恢复。
