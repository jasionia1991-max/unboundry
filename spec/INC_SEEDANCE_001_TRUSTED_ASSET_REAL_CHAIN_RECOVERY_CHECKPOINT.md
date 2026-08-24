# INC-SEEDANCE-001 Seedance 可信素材真实链路恢复 Checkpoint

更新日期：2026-08-24

当前阶段：`R6_PRODUCTION_RECEIPT_AND_DOC_ALIGNMENT`

状态：`PRODUCTION_V0_6_39_TECHNICAL_PASS / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / H5_CREATE_BUDGET_EXHAUSTED`

## 实时身份

- 真实仓库：`/Users/mymy/Documents/unboundry/app`
- 产品候选工作树：`/private/tmp/unboundry-inc006-v0.6.38-2026-08-24`
- 产品分支：`codex/inc-seedance-001-trusted-chain-2026-08-24`
- 候选commit/tree：`8bc89c0fa5c7fbf4f37de000facd01f8de181282` / `4c5049197c40785786db4fc6a0221ecea12c5244`
- PR #90 / merge：`1540d6bddc6ce70f788eacbb535ccc015419f1a2`，main tree与候选一致
- package/schema：`0.6.39 / 40`
- tag：`v0.6.39`，tag object `7e26cabd703d76c8d7ec4a8a67037eb9065e127a`，精确指向候选commit；禁止移动
- GitHub Release：`https://github.com/jasionia1991-max/unboundry/releases/tag/v0.6.39`
- 生产release：`/opt/unboundry/releases/v0.6.39-seedance-trusted-chain-20260824`
- 回执文档工作树：`/private/tmp/unboundry-inc-seedance-001-v0639-receipt-20260824`

## 已完成

- 正式地域Ark主机、URL/Host/V4签名一致性、H5必填HTTPS CallbackURL及运行时fail-closed修复已发布。
- m42 `16/16`、m81 `41/41`、最终m38 `15/15 PASS`。
- 回执文档同步后m38首轮`14/15`只发现治理标记不符合既有机器语法；修正为`CURRENT_V0_6_39_USER_RECHECK`并同步三份模块化治理文档后，同一m38复验`15/15 PASS`。没有重复产品full。
- 唯一safe full执行120 specs/1056 tests，原始`1055/1056`；唯一失败是m1密集画布p95 `25.10ms`相对`25.00ms`门槛的`0.10ms`抖动，长任务0、外部请求0。同源码只复验m1并`1/1 PASS`，没有第二次full。
- PR #90 Quality CI成功；候选tag/Release与合并后main tree一致。
- fresh build、5951文件inventory、冻结备份恢复副本、schema40 quick_check/FK、公网/回环/service/ready门全部通过。
- release inventory SHA：`1c938bc1a0f709248c373340542bcfd676d513a7645d8a8e0d9a29f0fdb0902c`。
- 冻结备份：`/var/lib/unboundry-rollbacks/v0.6.39-cutover-frozen-OFeGIs`；source/restore各366文件，双清单SHA `fcb8791d128655581ace932343a21b37dfad64f949043dc6c8148d8cd2848e20`。
- `UNBOUNDRY_SEEDANCE_ARK_CALLBACK_URL=https://canvas.mymy.ltd/` 已写入root-only生产环境文件；账号密钥未暴露。
- 切换前后业务数据不变：generation tasks 785、attempts 793、active 0、media 833、publication attempts 423、canvas 63。

## 真实 H5 结果

- 目标source asset：`82cb1dcc-0ba6-4b9c-a2a4-1bf1f45d5c62`。
- source checksum：`631ba0264ecc3799abf1d1bed1aca049c4385c910e2835e99065142e9cbb8a1d`。
- 本地session：`cfbdf650-a807-4a86-ab9b-9174544dfa08`，创建于`2026-08-24T13:54:10.690Z`。
- 唯一创建返回本地HTTP503，约150ms；session为`FAILED`，provider_status为`CREATE_FAILED`，没有provider_session_id、H5Link或BytedToken。
- 当前实现未保留Provider HTTP状态、错误码和RequestId，因此只能分类为`REMOTE_CREATE_REJECTED_UNCLASSIFIED`。
- 正式文档复核确认v0.6.39主机、Body与响应字段匹配；同一指南明确AK必须具有对应Project的`ArkFullAccess`，但生产权限证据尚未获得，不能把权限写成本次确证根因。

## 请求与费用账本

- `CreateVisualValidateSession`：`1/1`，已耗尽；禁止重试。
- `GetVisualValidateResult`：`0/15`。
- `CreateAsset`：`0/1`。
- `GetAsset`：`0/33`。
- 控制面合计：`1/50`。
- Generation task/attempt：0；费用：0；OSS测试写入：0。

## 当前硬阻塞

没有H5Link/BytedToken，无法由真人完成认证，也无法继续Group、Asset、Active与服务端`asset://`。本次允许的唯一H5创建已消费；购买、开通、新账号和云权限修改均未授权。

## 唯一下一动作

先在新版本中安全保留Provider失败类别与RequestId，并由用户确认当前AK在对应Project具备`ArkFullAccess`；随后必须另行取得新版本、发布、权限处置范围和新H5创建预算，才能重新发起真实链。此前只允许完成本回执和文档同步，禁止任何方舟、Generation或OSS写请求。
