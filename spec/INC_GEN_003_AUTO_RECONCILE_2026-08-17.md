# INC-GEN-003：失败生成自动核对

状态：`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`
版本：`v0.6.9`
日期：`2026-08-17`

## 用户确认的问题

平台已经出图，画布空着。旧核对要用户自己填平台任务号。用户不要填号，要系统自己查，且不能认错别人的图，也不能再扣一次费。

## 冻结合同

- 用户永远不填平台任务号。
- 能唯一对上就收回，不再花钱。
- 对不上或多条相近，宁可停下，也不瞎认、不自动重跑。
- 不改保存规则、不改模板连线、不改付费提交本身。

## 本发布范围

- 中转站用量明细自动配对；已有任务号的视频/音频仍走原来的查询。
- GPT Image 收回只查已有任务并落盘，不新开付费请求。
- 拿掉节点和任务面板上的任务号输入框。

## 自动验证

- 类型检查通过。
- 正式安全全量 `118/118 specs、969/969 tests PASS`，失败/跳过/重试/blocked/reportErrors均为0。
- 源码快照 526 文件，SHA-256 `99c93abc1cc99be3fa852c5bb3db5f03f960e8cb8bf1adb09e6ad07de4a300cb`。

## 生产发布

- 精确源码commit`5517eb6e4d38bbca7530562503bb962b89ba029d`、tree`0bad75ec1b9c175ce301287879d41272bc7656d7`。
- 生产current已切到`/opt/unboundry/releases/v0.6.9-inc-gen-003-20260817`；上一不可变release `v0.6.8-inc-gen-002-20260817`完整保留。
- 冻结备份`/var/lib/unboundry-rollbacks/inc-gen-003-frozen-20260817T122251Z`：冻结源与恢复副本均365文件，清单SHA-256同为`11ea901611aefe9120af96812c46a2f31ec61fae03972a4bb1628a49a0bf51c2`。
- 公网version为0.6.9；入口JS/CSS及CanvasShell与release逐字节一致。
- 数据不变：切换后schema39、quick_check ok、FK0、tasks237、attempts239、active0、公共模板47（46 published）。
- GitHub：注释标签`v0.6.9`指向`5517eb6e4d38bbca7530562503bb962b89ba029d`；PR #12已合并，merge commit`e077d09e36530a5c6830ebce9f28482a3fce0667`。
- 发布与验证期间真实Provider请求、付费生成和OSS写入均为0。
- 自动验证不代替用户肉眼验收。请打开网站强制刷新后，看失败节点点「核对结果」是否还要填任务号。

详细凭证：`spec/INC_GEN_003_PRODUCTION_RECEIPT_2026-08-17.json`。
