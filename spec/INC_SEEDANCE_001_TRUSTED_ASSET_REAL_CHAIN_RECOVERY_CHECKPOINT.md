# INC-SEEDANCE-001 Seedance 可信素材真实链路恢复 Checkpoint

更新日期：2026-08-24

当前阶段：`R6_PROJECT_PERMISSION_AND_REAL_H5`

状态：`PRODUCTION_V0_6_40_TECHNICAL_PASS / PROJECT_PERMISSION_CONFIRMATION_PENDING / PROVIDER_PROTOCOL_REAL_RECHECK_PENDING / USER_RECHECK`

## 实时身份

- 真实仓库：`/Users/mymy/Documents/unboundry/app`
- 隔离工作树：`/private/tmp/unboundry-inc-seedance-002-v0640-HdGrer`
- 分支：`codex/inc-seedance-002-provider-diagnostics-v0.6.40`
- 基线：`origin/main@8d38bd8e0e7275b90b9f21b22df84bf667807ae6`
- package/schema：`0.6.40 / 40`
- 版本门：`v0.6.40 / VERSION_GATE_VALID`
- 发布门：`v0.6.40 / RELEASE_GATE_VALID`
- 生产：`v0.6.40 / schema40 / /opt/unboundry/releases/v0.6.40-seedance-provider-diagnostics-20260824`
- v0.6.39历史tag、Release与回执保持不可变。

## 已完成

- 复核v0.6.39唯一H5创建的历史事实：本地HTTP503、`FAILED/CREATE_FAILED`、无Provider session ID/H5Link/BytedToken，历史账本`1/50`已封存。
- 新增受限Provider诊断，只保留HTTP状态、错误码与RequestId；远端Message、Body、AK/SK不进入固定应用错误或数据库。
- H5创建、认证结果查询、Asset创建与Asset查询失败均持久化安全分类；无远端诊断时继续fail-closed。
- 最终定向m42+m100+m81+m9为4 specs、`71/71 PASS`；source/snapshot `ce05428c92f2bafd363011edec263598e1e2af664ae532ed79786df917e31c64`。唯一safe full执行120 specs/1056 tests，原始`1055/1056`；唯一失败为AGENTS当前生产短语多一个“仍”字，产品1055项均通过；同source/snapshot，4173 listener不变。修正后m38 `15/15 PASS`，source/snapshot `c62658c62410ca34dec0d7b6e75c0fee39bb035e4bf0390b43c9e67eb1d18c70`，未重复full。Node22.23.1/npm10.9.8，Provider/Generation/OSS/费用0。
- 一次m100+m81组合批次因运行中源码变化被safe runner判为无效，不计入最终证据；此后只按最小受影响范围重跑m100。
- 生产AK只读解密后仅比较尾号，精确匹配IAM用户`tapnow-ark-catalog-ro-20260803`（显示名`TapNow 方舟目录只读`）；没有输出完整密钥。
- IAM用户当前仅有`TapNowArkCatalogReadOnly`；Project `default`授权数为0。
- Project补权向导已精确选择Project `default`、该IAM用户和系统策略`ArkFullAccess`，停在最终“确定”前，尚未产生外部权限写入。
- commit`70e3730`、PR #92、Quality CI、merge`21eb483`、tag/GitHub Release `v0.6.40`完成；tag与main tree均为`1defaa5`。
- 生产fresh build、冻结备份、原子切换和健康门完成。release 5952文件/inventory`1f440381…a4084`；冻结source/restore各366文件/清单`f88135d5…b51a`；公网/回环v0.6.40、ready active/schema40、数据与媒体计数不变、5资源一致、service/NGINX新增告警0。
- 生产回执与权威文档同步后只运行m38，`15/15 PASS`，source/snapshot`b1567963…3717`，4173 listener unchanged；未重复full，Provider/OSS请求0。

## 未完成

- 浏览器动作时最终确认与最小Project补权提交。
- 生产H5→Group→Asset→Active→服务端`asset://`真实链与v0.6.40生产回执。

## v0.6.40 请求与费用账本

- `CreateVisualValidateSession`：`0/1`。
- `GetVisualValidateResult`：`0/15`。
- `CreateAsset`：`0/1`。
- `GetAsset`：`0/33`。
- 控制面合计：`0/50`。
- Generation task/attempt：0；费用：0；OSS测试写入：0。
- H5创建超时、5xx或结果未知时禁止重提；真人认证不可自动化绕过。

## 当前阻塞与回滚点

- 外部权限写入受浏览器最终动作时确认门约束；确认前保持页面停在最终“确定”前。
- 真实链只差Project补权与用户真人认证；确认前禁止消费新控制面预算。
- 当前生产回滚点为v0.6.39不可变release及v0.6.40冻结备份`/var/lib/unboundry-rollbacks/v0.6.40-cutover-frozen-OtzczQ`。

## 唯一下一动作

收到用户动作时“确认授权”后，重新核对最终摘要并只点击一次Project `default`补权“确定”；验证权限生效后，按新账本执行唯一H5创建并把H5链接交给用户真人认证。
