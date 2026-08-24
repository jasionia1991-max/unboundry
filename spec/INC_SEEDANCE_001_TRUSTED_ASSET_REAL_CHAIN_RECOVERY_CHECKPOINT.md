# INC-SEEDANCE-001 Seedance 可信素材真实链路恢复 Checkpoint

更新日期：2026-08-25

当前阶段：`R6_REAL_H5_BLOCKED_EXTERNAL_CAPABILITY`

状态：`PRODUCTION_V0_6_40_TECHNICAL_PASS / PROJECT_PERMISSION_APPLIED / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / BLOCKED_EXTERNAL_CAPABILITY / USER_RECHECK`

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
- 补权前IAM用户仅有`TapNowArkCatalogReadOnly`，Project `default`授权数为0；这是操作前基线，后续状态见下方新增证据。
- Project补权向导曾精确选择Project `default`、该IAM用户和系统策略`ArkFullAccess`并停在最终确认前；此后用户已在动作时确认并完成提交，结果见下方新增证据。
- commit`70e3730`、PR #92、Quality CI、merge`21eb483`、tag/GitHub Release `v0.6.40`完成；tag与main tree均为`1defaa5`。
- 生产fresh build、冻结备份、原子切换和健康门完成。release 5952文件/inventory`1f440381…a4084`；冻结source/restore各366文件/清单`f88135d5…b51a`；公网/回环v0.6.40、ready active/schema40、数据与媒体计数不变、5资源一致、service/NGINX新增告警0。
- 生产回执与权威文档同步后只运行m38，`15/15 PASS`，source/snapshot`b1567963…3717`，4173 listener unchanged；未重复full，Provider/OSS请求0。
- 用户于动作时明确回复“确认授权”。正确的Project授权页最终摘要只包含Project `default`、IAM用户`tapnow-ark-catalog-ro-20260803`和系统策略`ArkFullAccess`；提交结果为1个权限修改成功、0失败，用户详情中的该策略明确受`default(默认项目)`限制，原`TapNowArkCatalogReadOnly`仍保留。
- 操作中曾从不显示Project范围的“用户添加权限”入口误加一条用户级`ArkFullAccess`；发现范围超出授权后立即停止、撤销并核验用户级条目归零，再从Project `default`正确入口提交。该临时越界没有留下用户级权限，没有触发任何方舟控制面请求、Generation或OSS写入。
- 生产选择不同于v0.6.39失败幂等记录的已就绪图片后，仅提交一次`CreateVisualValidateSession`。应用于`2026-08-24T16:08:12Z`返回HTTP503；受限诊断持久化为`CREATE_SESSION_FAILED|PERMISSION|HTTP_403|PROVIDER_SubscriptionRequired|REQUEST_202608250008127B4DD9D53F9A85BDEFF9`。session为`FAILED`，无Provider session ID、H5Link或BytedToken。
- `SubscriptionRequired`证明当前账号未开通该Assets API能力；Project补权不是根因。根据不购买、不重试和H5创建`1/1`门，认证查询、Asset创建/查询、服务端`asset://`复核均未进入，Generation/OSS/费用继续为0。

## 未完成 / 外部阻断

- 当前账号没有方舟Assets API订阅，无法取得H5Link，因此生产H5→Group→Asset→Active→服务端`asset://`真实链没有完成。
- 现网v0.6.40仍按已配置凭证展示A分支入口；真实控制面已证明有效能力分支应按C分支/`BLOCKED_EXTERNAL_CAPABILITY`处理。修改现网能力探测或入口需要新的版本号、发布授权和独立工程事件，不能改写已冻结的v0.6.40 tag/release。

## v0.6.40 请求与费用账本

- `CreateVisualValidateSession`：`1/1`。
- `GetVisualValidateResult`：`0/15`。
- `CreateAsset`：`0/1`。
- `GetAsset`：`0/33`。
- 控制面合计：`1/50`。
- Generation task/attempt：0；费用：0；OSS测试写入：0。
- 本次远端明确返回`403 SubscriptionRequired`；H5创建预算已耗尽，禁止重提。没有H5链接，不存在可交给用户完成的真人认证步骤。

## 当前阻塞与回滚点

- Project `default`最小补权已完成并保留；用户级误授权已撤销，无持久越界权限。
- 真实链被当前账号未订阅Assets API明确阻断；购买或开通新服务不在本事件授权内。
- 当前生产回滚点为v0.6.39不可变release及v0.6.40冻结备份`/var/lib/unboundry-rollbacks/v0.6.40-cutover-frozen-OtzczQ`。

## 唯一下一动作

停止所有本事件Provider请求，不购买、不重试、不进入Asset阶段。只同步v0.6.40回执与权威文档并运行文档治理最小复验；若未来用户另行决定开通Assets API，必须以新版本、新发布授权和新请求预算启动独立事件。
