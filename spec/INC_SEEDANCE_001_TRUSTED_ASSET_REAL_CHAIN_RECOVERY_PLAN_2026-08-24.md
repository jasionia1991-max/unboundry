# INC-SEEDANCE-001 Seedance 可信素材真实链路恢复方案

更新日期：2026-08-24

状态：`PRODUCTION_V0_6_39_TECHNICAL_PASS / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / H5_CREATE_BUDGET_EXHAUSTED`

版本门：`v0.6.39 / VERSION_GATE_VALID`

发布门：`v0.6.39 / RELEASE_GATE_VALID`

## 1. 目标和边界

本事件只处理 v0.6.38 已经 fail-closed 的 Seedance A 分支真实控制链：

`CreateVisualValidateSession → GetVisualValidateResult → CreateAsset → GetAsset(Active) → 服务端 asset://`

v0.6.39 已完成 commit、push、PR、合并、tag、GitHub Release、SSH生产发布与 CallbackURL 配置；生产当前运行 v0.6.39/schema40 且技术健康。INC-IMGEDIT-006 的 v0.6.38 `USER_PASS` 继续作为历史事实保留，不自动覆盖本事件的真实Provider结果。真实控制面严格受第5节账本约束，付费Generation和OSS测试写入固定为0。

## 2. 已确认的协议偏差与本次真实结果

v0.6.38 的真实 H5 创建返回 503 后，代码与 2026-08-24 火山方舟正式合同逐字段对照，确认请求存在两项确定性协议偏差：

1. Ark 控制面请求被发送并签名到历史通用主机 `open.volcengineapi.com`；当前正式管控面 Base URL 与私域素材 API 主机均为 `ark.cn-beijing.volcengineapi.com`。
2. `CreateVisualValidateSession` 发送空业务体，仅补 `ProjectName`；正式接口要求必填、可公网访问的 HTTPS `CallbackURL`。

官方合同：

- 拉起真人认证 H5：<https://docs.volcengine.com/docs/82379/2333587?lang=zh>
- 管控面 Base URL 与鉴权：<https://docs.volcengine.com/docs/82379/1298459?lang=zh>
- 获取真人认证结果：<https://docs.volcengine.com/docs/82379/2333588?lang=zh>
- 创建素材资产：<https://docs.volcengine.com/docs/82379/2318271?lang=zh>
- 管理私域素材库 / GetAsset 示例：<https://docs.volcengine.com/docs/82379/2333589?lang=zh>

v0.6.39 已修复上述两项协议偏差，并再次按正式合同复核主机、Body和响应字段。官方私域人像指南还明确：调用AK必须具备对应Project的 `ArkFullAccess`；本次没有获得该权限的可验证证据，因此它是下一轮的必核前提，但不能写成本次已证实根因。

生产唯一一次 `CreateVisualValidateSession` 于 `2026-08-24T13:54:10Z` 返回本地HTTP503，耗时约150ms，session保存为 `FAILED/CREATE_FAILED`，没有Provider session ID、H5Link或BytedToken。当前实现丢弃Provider HTTP状态、错误码和RequestId，所以只能分类为 `REMOTE_CREATE_REJECTED_UNCLASSIFIED`；不得猜成权限、参数、签名或响应格式中的任一项。

## 3. 最小修复

### R1 正式地域 Base URL

- 目录发现和四个可信素材 Action 全部使用正式控制面主机 `ark.cn-beijing.volcengineapi.com`。
- URL、`Host` 和 V4 canonical request 使用同一个主机，避免签名与传输目标漂移。

### R2 CallbackURL fail-closed

- 新增运行时配置 `UNBOUNDRY_SEEDANCE_ARK_CALLBACK_URL`。
- 只接受非空 HTTPS URL；缺失、HTTP 或非法值时不发布 A 分支能力，不发 Provider 请求。
- `CreateVisualValidateSession` 必须发送 `CallbackURL + ProjectName`。
- 生产已设置 `https://canvas.mymy.ltd/`，并随v0.6.39服务启动生效。

### R3 回归与安全门

- m42 直接断言目录发现与可信素材均使用正式地域控制面主机。
- m42 直接断言四个可信素材 Action 的 URL 和 `Host` 均为地域 Ark 主机。
- m42 直接断言 H5 创建体包含 HTTPS CallbackURL；非法 CallbackURL 在 transport 前拒绝。
- 测试使用假 fetch、临时数据和动态 loopback；真实 Provider、Generation、费用与 OSS 均为 0。

## 4. 真实验收门

真实链只有同时满足以下证据才可写 `PROVIDER_PROTOCOL_REAL_PASS`：

1. 新版本与发布授权有效，候选已按正式流程部署，生产配置已显式设置 CallbackURL；
2. 仅一次 H5 创建返回有效 H5Link 和 BytedToken；
3. 真人在 H5 完成认证，`GetVisualValidateResult` 返回同项目的 GroupId；
4. 对已确认 owner/source/checksum 的图片仅一次 CreateAsset，随后 GetAsset 达到 Active；
5. 服务端在 owner/profile/account/region/project/checksum/Active 全部匹配时构造 `asset://`；
6. 不提交付费视频生成、不新增 OSS 测试写入；
7. 请求计数、状态转换和失败关闭写入新回执，用户验收与 Provider 协议验收分层。

## 5. 外部请求预算（已授权）

用户已授权本事件固定上限 50 次控制面请求；截至本回执实际账本为：

- `CreateVisualValidateSession`：`1/1`，已耗尽；
- `GetVisualValidateResult`：`0/15`；
- `CreateAsset`：`0/1`；
- `GetAsset`（含 Active 最终复核）：`0/33`；
- 付费 Generation：0；
- OSS 测试写入：0；
- 购买、开通、新账号、云权限修改：0。

任何创建请求返回超时、5xx 或结果未知时禁止自动重提；先记录并停止。H5 必须由真人完成，不得自动化绕过。

## 6. 阶段

| 阶段 | 内容 | 当前状态 |
| --- | --- | --- |
| R0 | 恢复权威状态、核对 Git、生产历史与旧预算 | PASS |
| R1 | 官方合同对照与根因冻结 | PASS |
| R2 | 正式地域Base URL、CallbackURL 和回归测试 | TARGETED_AUTO_PASS |
| R3 | 文档、验收矩阵与检查点对齐 | PASS |
| R4 | 候选冻结、commit/GitHub/发布 | PASS |
| R5 | 生产真实 H5/Group/Asset/Active 链 | REAL_FAIL_CLOSED / H5_CREATE_BUDGET_EXHAUSTED |
| R6 | 生产健康、数据、零付费账本与新回执 | PASS |

## 7. 回滚

生产不可变release为 `/opt/unboundry/releases/v0.6.39-seedance-trusted-chain-20260824`；切换冻结备份为 `/var/lib/unboundry-rollbacks/v0.6.39-cutover-frozen-OFeGIs`。source/restore各366文件且双清单SHA一致；回滚仍须保留schema40、现有数据和CallbackURL安全配置。

## 8. 当前硬门与下一步

1. 本事件H5创建预算已耗尽，禁止重试，也不得移动v0.6.39 tag；
2. 新一轮必须先让Provider失败安全保留可审计类别与RequestId，并由用户确认当前AK对应Project的 `ArkFullAccess`；
3. 只有取得新版本、权限处置范围、发布授权和新H5预算后，才能继续 `H5 → Group → Asset → Active → asset://`；
4. 在上述链真正完成前，状态必须保持 `PROVIDER_PROTOCOL_REAL_FAIL_CLOSED`。
