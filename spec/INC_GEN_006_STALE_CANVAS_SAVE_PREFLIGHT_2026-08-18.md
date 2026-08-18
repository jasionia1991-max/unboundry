# INC-GEN-006：过期「画布还在保存」不再挡整组

状态：`PRODUCTION_PUBLISHED_USER_PASS`
版本：`v0.6.14`
日期：`2026-08-18`

## 用户确认的问题

新拖模板跑完一轮后再点整组，弹出「发现 N 个不兼容节点；首个生成P1带货导演稿：画布还在保存（未提交任何生成任务）」。节点上的旧报错把整组卡死，刷新、再拖模板也不能当正式用法。

## 冻结合同

- 开跑前检查不再把上次的「画布还在保存」当成不兼容。
- 整组开跑并已存稳后，清掉组里这类过期红字。
- 模型不对、缺不会被这次整组补上的输入、连线角色不对，继续整组拦截，零新任务。
- 真还在保存：继续等存完；整组里这类失败最多再试 1 次。
- 不放宽 409，不多标签最后保存者胜，不改模板/默认模型/下载/核对结果。

## 本发布范围

- 文字节点上次生成失败只给节点自己看，不进整组开跑前检查。
- 开跑前/开跑时遇到「画布还在保存」这类过期句直接跳过，不再写成不兼容。
- 整组开跑后清掉组内过期保存红字，再存稳一次。
- 包版本升到 `0.6.14`。

## 自动验证

- 类型检查通过。
- 定向 `m22` 22/22、`m81` 41/41 通过。
- 正式安全全量 `118/118 specs、973/973 tests PASS`，失败/跳过/重试/blocked/reportErrors均为0。4173 listener 不变。
- 源码快照 537 文件，SHA-256 `3173884e4d4c2c219b44106d75d47434cb16792c71f5ae43766017f998d328fb`。

## 生产发布

- 精确源码commit`ce3bf7c4481c1cc549bec6e512fe3c5f7fb8273e`、tree`da25dd2c1333c15235f1a791b99102736ee564a7`。
- 生产current已切到`/opt/unboundry/releases/v0.6.14-inc-gen-006-20260818`；上一不可变release `v0.6.13-inc-gen-005-20260818`完整保留。
- 冻结备份`/var/lib/unboundry-rollbacks/inc-gen-006-frozen-20260818T061517Z`：冻结源与恢复副本均363文件，清单SHA-256同为`524ab8fc2292bac179709baf2c46814b132bbf7a9fbe1683c0ad6165ac06dd5b`。
- 公网version为0.6.14；入口JS/CSS及CanvasShell与release逐字节一致。
- 切换前后schema39、quick_check ok、FK0、tasks294、attempts296、active0、公共模板47（46 published）。
- GitHub：注释标签`v0.6.14`指向`ce3bf7c4481c1cc549bec6e512fe3c5f7fb8273e`；PR #24已合并，merge commit`8d5ae4e0423b71898a08c0a5612d2776767f5b62`。
- 发布与验证期间真实Provider请求、付费生成和OSS写入均为0。
- 用户已于 2026-08-18 明确回复「全通过」，本项收口为 `PRODUCTION_PUBLISHED_USER_PASS`。

详细凭证：`spec/INC_GEN_006_PRODUCTION_RECEIPT_2026-08-18.json`。
