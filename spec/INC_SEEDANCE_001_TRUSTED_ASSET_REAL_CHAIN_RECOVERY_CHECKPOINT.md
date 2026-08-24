# INC-SEEDANCE-001 Seedance 可信素材真实链路恢复 Checkpoint

更新日期：2026-08-24

当前阶段：`R4_V0_6_39_RELEASE_CANDIDATE_IN_PROGRESS`

状态：`V0_6_39_RELEASE_CANDIDATE_AUTHORIZED / TARGETED_AUTO_PASS / PROVIDER_BUDGET_VALID / HUMAN_H5_PENDING`

## 实时身份

- 工作树：`/private/tmp/unboundry-inc006-v0.6.38-2026-08-24`
- 分支：`codex/inc-seedance-001-trusted-chain-2026-08-24`
- 基线 HEAD / origin/main：`b94e01edb207072906e102b5234b6290b338cd2e`
- package：`0.6.39`
- schema：`40`
- 生产：实时只读确认 `v0.6.38/schema40 / live / ready active / service active+enabled / NRestarts0`；本事件尚未发布
- 版本门：`v0.6.39 / VERSION_GATE_VALID`；本地/远端tag和GitHub Release均不存在v0.6.39
- 发布门：`v0.6.39 / RELEASE_GATE_VALID`；commit、push、PR、合并、tag、Release、SSH、生产发布和CallbackURL配置已授权

## 根因与修复

- 正式管控面 Base URL 与四个私域素材 Action 必须走 `ark.cn-beijing.volcengineapi.com`；v0.6.38 错误使用了历史通用主机 `open.volcengineapi.com`。
- `CreateVisualValidateSession` 必须携带公网 HTTPS `CallbackURL`；v0.6.38 未发送。
- 已修正控制面签名/传输主机，并新增 `UNBOUNDRY_SEEDANCE_ARK_CALLBACK_URL` fail-closed 配置。
- 本地 m42 初始红：TypeScript 明确拒绝尚不存在的 `callbackUrl` 合同，产品测试 0；修复后 m42 `15/15 PASS`。补齐正式地域Base URL与非法CallbackURL时，首轮`15/16`只暴露旧主机对应的固定签名断言；同步正式主机签名后最终 m42 `16/16 PASS`，Node22.23.1/npm10.9.8，source/snapshot`23946d2b…b5ff5a`，4173 listener unchanged。
- v0.6.39发布候选定向门：m42 `16/16`、m81 `41/41`；m38因治理文档机器标记格式两次`14/15`，只修正文档格式后`15/15 PASS`。产品代码、Provider合同和测试阈值均未因治理失败改动。
- 本事件唯一safe full在source/snapshot`277252945a773811884d399a2ab3e67aaa605d00d3e167308c15c3172c12d80f`执行120 specs/1056 tests，原始`1055/1056`、退出1；唯一失败为既有m1密集画布p95 `25.10ms`相对`25.00ms`门槛的`0.10ms`抖动，长任务0、外部请求0。未改产品或阈值，同源码只复验m1并`1/1 PASS`；没有第二次full，4173 listener unchanged。

## 请求与费用账本

- 本事件真实 Provider 请求：0/50
- 本事件 Generation task/attempt：0
- 本事件费用：0
- 本事件 OSS 写入：0
- v0.6.38 历史账本仍为控制面 `2/200`，其中唯一 H5 create `1/1` 已消费；不得复用
- 新预算已授权：控制面最多50；Create H5 1、Get Visual 15、Create Asset 1、Get Asset 33；付费Generation 0、OSS测试写入0

## 文件

- `server/volcengineArkControlPlane.ts`
- `server/volcengineArkSeedanceTrustedAssetPort.ts`
- `server/seedanceTrustedAssetRuntimeApi.ts`
- `tests/m42-volcengine-ark-control-plane.spec.ts`
- `spec/INC_SEEDANCE_001_TRUSTED_ASSET_REAL_CHAIN_RECOVERY_PLAN_2026-08-24.md`
- 本 Checkpoint 及顶层治理文档

## 当前人工门

1. H5 真人认证必须由用户本人完成；
2. H5创建只允许一次，创建成功后必须立即交给用户，不得自动化绕过；
3. 任何创建请求超时、5xx或副作用未知时禁止重提。

## 唯一下一动作

提交冻结的v0.6.39候选，完成push、PR、CI、合并、tag与GitHub Release；随后按schema40不变发布门备份并发布，CallbackURL生效后仅创建一次H5并立即交给用户真人认证。
