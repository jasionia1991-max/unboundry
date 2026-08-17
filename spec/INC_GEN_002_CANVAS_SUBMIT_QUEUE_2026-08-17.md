# INC-GEN-002：同层生成提交排队

状态：`PRODUCTION_PUBLISHED_USER_PASS`
版本：`v0.6.8`
日期：`2026-08-17`

## 用户确认的问题

同一组里同层几个节点一起跑时，后提交的节点报「画布还在保存，请稍等保存完成后再试」。不是画布卡死，是先成功的那个把任务号写回画布后版本号加一，旁边的节点还拿着旧号。

## 冻结合同

- 同一张画布上，「等保存 → 提交任务 → 把任务号存回画布」一个接一个。
- 平台出图、出字、出视频仍然同时进行。
- 真没存完、中途改了词，服务器照旧拒绝。
- 不改模板连线、不改保存规则、不改付费/幂等恢复。

## 本发布范围

- 图/字/视频/音频首次生成、节点重试、任务面板重试/核对结果走同一条按画布排队的入口。
- 上线规矩页入库，README/AGENTS 指向该页。
- 包版本升到 `0.6.8`，运行时承认该版本为 final。

## 自动验证

- 类型检查通过。
- `m22` 18/18、`m40` 14/14、`m27` 20/20、`m41` 51/51。
- 正式安全全量 `118/118 specs、969/969 tests PASS`，失败/跳过/重试/blocked/reportErrors均为0。
- 源码快照 523 文件，SHA-256 `d6c4fd2c8f4308e628883705b2c9fc3cbcf296c5cb7431f9e7520a3d193a5d4c`。

## 生产发布

- 精确源码commit`c2e05d142a5556446d96a8532ca7297cba4e03a5`、tree`d8c8609be69c969ad7bef7db05b8656351726e33`。
- 生产current已切到`/opt/unboundry/releases/v0.6.8-inc-gen-002-20260817`；上一不可变release `v0.6.7-inc-gen-001-20260817`完整保留。
- 冻结备份`/var/lib/unboundry-rollbacks/inc-gen-002-frozen-20260817T104142Z`：冻结源与恢复副本均363文件，清单SHA-256同为`c99566ef9823e495fcc82c7084cda65be171c9b82abc8356852cf2280dfd08ac`。
- 公网version为0.6.8；入口JS/CSS及CanvasShell与release逐字节一致。
- 数据不变：切换后schema39、quick_check ok、FK0、tasks230、attempts232、active0、公共模板47（46 published）。
- GitHub：注释标签`v0.6.8`指向`c2e05d142a5556446d96a8532ca7297cba4e03a5`；PR #10已合并，merge commit`1e1d5b482148240409e283fc19e6f3ffa66202a4`。
- 发布与验证期间真实Provider请求、付费生成和OSS写入均为0。
- 用户随后在生产实页明确回复“看了 也通过了”，本事件正式收口为`PRODUCTION_PUBLISHED_USER_PASS`。

详细凭证：`spec/INC_GEN_002_PRODUCTION_RECEIPT_2026-08-17.json`。
