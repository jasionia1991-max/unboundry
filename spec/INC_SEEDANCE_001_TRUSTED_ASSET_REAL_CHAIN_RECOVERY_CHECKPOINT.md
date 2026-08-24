# INC-SEEDANCE-001 Seedance 可信素材真实链路恢复 Checkpoint

更新日期：2026-08-24

当前阶段：`R5_GITHUB_AND_PRODUCTION_RELEASE`

状态：`PRODUCTION_V0_6_39_TECHNICAL_PASS / V0_6_40_CANDIDATE_FROZEN / PROJECT_PERMISSION_CONFIRMATION_PENDING / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED`

## 实时身份

- 真实仓库：`/Users/mymy/Documents/unboundry/app`
- 隔离工作树：`/private/tmp/unboundry-inc-seedance-002-v0640-HdGrer`
- 分支：`codex/inc-seedance-002-provider-diagnostics-v0.6.40`
- 基线：`origin/main@8d38bd8e0e7275b90b9f21b22df84bf667807ae6`
- package/schema：`0.6.40 / 40`
- 版本门：`v0.6.40 / VERSION_GATE_VALID`
- 发布门：`v0.6.40 / RELEASE_GATE_VALID`
- 生产：`v0.6.39 / schema40 / /opt/unboundry/releases/v0.6.39-seedance-trusted-chain-20260824`
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

## 未完成

- 浏览器动作时最终确认与最小Project补权提交。
- commit、push、PR、CI、merge、tag、GitHub Release和SSH生产发布。
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
- 真实链必须在v0.6.40发布并通过健康门后才能开始；此前禁止消费新控制面预算。
- 当前生产回滚点为v0.6.39不可变release及`/var/lib/unboundry-rollbacks/v0.6.39-cutover-frozen-OFeGIs`；v0.6.40必须另建release与冻结备份。

## 唯一下一动作

提交并发布冻结的v0.6.40候选；收到用户动作时“确认授权”后，重新核对最终摘要并只点击一次Project `default`补权“确定”。生产健康门通过且权限补齐后，按新账本执行唯一H5创建。
