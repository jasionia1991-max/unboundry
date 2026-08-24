# INC-SEEDANCE-001 Seedance 可信素材真实链路恢复方案

更新日期：2026-08-24

状态：`PRODUCTION_V0_6_39_TECHNICAL_PASS / V0_6_40_CANDIDATE_FROZEN / PROJECT_PERMISSION_CONFIRMATION_PENDING / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED`

版本门：`v0.6.40 / VERSION_GATE_VALID`

发布门：`v0.6.40 / RELEASE_GATE_VALID`

## 1. 目标和边界

本事件只处理v0.6.38已经fail-closed的Seedance A分支真实控制链：

`CreateVisualValidateSession → GetVisualValidateResult → CreateAsset → GetAsset(Active) → 服务端 asset://`

v0.6.39已经完成正式地域主机与CallbackURL修复并运行于生产/schema40。v0.6.40续作只补可审计Provider诊断、当前Project最小权限前提，并重启一次受预算约束的真实链。INC-IMGEDIT-006的v0.6.38 `USER_PASS`继续作为历史事实保留，不自动覆盖本事件的Provider结果。付费Generation和OSS测试写入固定为0。

## 2. 历史失败与v0.6.40续作诊断

v0.6.38存在两项已确认协议偏差：控制面使用历史通用主机`open.volcengineapi.com`，且`CreateVisualValidateSession`未发送必填公网HTTPS `CallbackURL`。v0.6.39已把目录发现和四个可信素材Action统一到`ark.cn-beijing.volcengineapi.com`，让URL、Host与V4签名主机一致，并配置`UNBOUNDRY_SEEDANCE_ARK_CALLBACK_URL=https://canvas.mymy.ltd/`。

v0.6.39生产唯一一次`CreateVisualValidateSession`于`2026-08-24T13:54:10Z`返回本地HTTP503，约150ms，session保存为`FAILED/CREATE_FAILED`，没有Provider session ID、H5Link或BytedToken。旧实现丢弃Provider HTTP状态、错误码和RequestId，所以只能分类为`REMOTE_CREATE_REJECTED_UNCLASSIFIED`；不得猜成权限、参数、签名或响应格式中的任一项。

v0.6.40候选：

- 在不改变固定用户错误文案的前提下，只保留受限的Provider HTTP状态、错误码和RequestId，并写入既有`provider_status`；禁止保存远端Message、Body、AK或SK。
- H5创建、认证结果查询、Asset创建和Asset查询四个失败边界均使用同一安全分类；无诊断时继续fail-closed。
- 最终定向m42+m100+m81+m9为4 specs、`71/71 PASS`。唯一safe full原始`1055/1056`，唯一失败为AGENTS治理精确短语，产品1055项均通过；修正后m38 `15/15 PASS`，未重复full。测试库存仍为120 specs/1056 tests，真实Provider、Generation、OSS和费用0。
- 只读核验已把生产AK精确匹配到IAM用户`tapnow-ark-catalog-ro-20260803`；该身份只有`TapNowArkCatalogReadOnly`，Project `default`当前授权数为0。
- Project级补权向导已选中唯一目标用户与系统策略`ArkFullAccess`，当前停在最终“确定”前；浏览器动作时确认完成前不得提交。

官方合同：

- 拉起真人认证H5：<https://docs.volcengine.com/docs/82379/2333587?lang=zh>
- 管控面Base URL与鉴权：<https://docs.volcengine.com/docs/82379/1298459?lang=zh>
- 获取真人认证结果：<https://docs.volcengine.com/docs/82379/2333588?lang=zh>
- 创建素材资产：<https://docs.volcengine.com/docs/82379/2318271?lang=zh>
- 管理私域素材库/GetAsset示例：<https://docs.volcengine.com/docs/82379/2333589?lang=zh>

## 3. 安全实现合同

### R1 受限诊断

- 非成功HTTP与Provider业务错误只提取有界HTTP状态、清洗后的错误码和RequestId。
- 应用层把安全分类持久化到失败session/binding状态；外部响应继续使用固定文案。
- 远端Message、完整Body、Authorization、AK、SK及其他凭据不得进入异常message、API响应、数据库或日志。

### R2 身份与Project权限

- 只在生产端安全解密并比较AK尾号，不输出完整Access Key。
- 只为实际拥有生产AK的IAM用户补对应Project的`ArkFullAccess`。
- 本事件目标被精确冻结为Project=`default`、IAM用户=`tapnow-ark-catalog-ro-20260803`、系统策略=`ArkFullAccess`；不得扩大到其他用户、Project或策略。

### R3 回归与安全门

- 测试使用假fetch、临时数据和动态loopback；不得访问真实Provider、生产数据或OSS。
- 最终候选只运行直接受影响定向、版本/发布合同、唯一safe full和文档治理门；成功证据不因纯文档同步而重复业务测试。

## 4. 真实验收门

真实链只有同时满足以下证据才可写`PROVIDER_PROTOCOL_REAL_PASS`：

1. v0.6.40候选按正式流程部署，生产配置显式保留合法CallbackURL；
2. 仅一次H5创建返回有效H5Link和BytedToken；
3. 真人在H5完成认证，`GetVisualValidateResult`返回同项目GroupId；
4. 对已确认owner/source/checksum的图片仅一次CreateAsset，随后GetAsset达到Active；
5. 服务端在owner/profile/account/region/project/checksum/Active全部匹配时构造`asset://`；
6. 不提交付费视频生成、不新增OSS测试写入；
7. 请求计数、状态转换和失败关闭写入v0.6.40新回执，用户验收与Provider协议验收分层。

## 5. 外部请求预算（v0.6.40新事件，已授权且尚未消费）

该账本不复用v0.6.39的历史失败请求，截至当前为：

- `CreateVisualValidateSession`：`0/1`；
- `GetVisualValidateResult`：`0/15`；
- `CreateAsset`：`0/1`；
- `GetAsset`（含Active最终复核）：`0/33`；
- 控制面合计：`0/50`；
- 付费Generation：0；
- OSS测试写入：0；
- 购买、开通、新账号：0；只允许在缺失时为当前方舟身份补对应Project的`ArkFullAccess`。

任何创建请求返回超时、5xx或结果未知时禁止自动重提；先记录并停止。H5必须由真人完成，不得自动化绕过。

## 6. 阶段

| 阶段 | 内容 | 当前状态 |
| --- | --- | --- |
| R0 | 恢复权威状态、核对Git、生产历史与v0.6.40新预算 | PASS |
| R1 | 受限Provider诊断实现与定向回归 | TARGETED_AUTO_PASS |
| R2 | 当前生产AK身份与Project权限只读核验 | PASS |
| R3 | 仅为Project `default`的当前IAM用户补`ArkFullAccess` | PROJECT_PERMISSION_CONFIRMATION_PENDING |
| R4 | 文档、验收矩阵、候选测试与检查点对齐 | PASS |
| R5 | commit/GitHub/CI/merge/tag/Release与生产发布 | PASS |
| R6 | 生产真实H5/Group/Asset/Active/asset://链 | IN_PROGRESS / USER_CONFIRMATION_PENDING |
| R7 | 生产健康、数据、零付费账本与v0.6.40新回执 | TECHNICAL_PASS / REAL_CHAIN_PENDING |

## 7. 回滚

当前生产不可变release为`/opt/unboundry/releases/v0.6.40-seedance-provider-diagnostics-20260824`；切换冻结备份为`/var/lib/unboundry-rollbacks/v0.6.40-cutover-frozen-OtzczQ`。source/restore各366文件且双清单SHA一致。上一release v0.6.39继续保留；回滚须保留schema40、现有数据和CallbackURL安全配置。

## 8. 当前硬门与下一步

1. 不得移动v0.6.39 tag，也不得把v0.6.39的`1/50`写入v0.6.40新账本；
2. 浏览器补权提交前必须再次显示Project=`default`、用户=`tapnow-ark-catalog-ro-20260803`、策略=`ArkFullAccess`并取得动作时确认；
3. 候选冻结、GitHub、生产发布与生产健康门通过后，H5只允许创建一次；任何创建超时、5xx或结果未知都停止，不重提；
4. 真人H5完成后最多查询15次；取得同Project GroupId后只创建一次Asset，最多查询33次直到Active并完成服务端`asset://`复核；
5. 在上述链真正完成前，状态必须保持`PROVIDER_PROTOCOL_REAL_FAIL_CLOSED`；付费Generation和OSS测试写入始终为0。
