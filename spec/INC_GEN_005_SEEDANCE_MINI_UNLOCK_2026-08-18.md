# INC-GEN-005：解开 Seedance Mini 付费验证锁

状态：`PRODUCTION_PUBLISHED_USER_PASS`
版本：`v0.6.13`
日期：`2026-08-18`

## 用户确认的问题

模型中心把 Seedance 2.0 Mini 的 6～15 秒和 720p 从「显示但禁用」改成「可用」后，保存看起来成功，再打开又弹回去。根因是代码里把这两档写成「尚未完成本项目真实付费验证」，保存时被上限拒绝；编辑框仍会收起。

## 冻结合同

- 去掉我们自己加的「没验过就禁」。Mini 的 4～15 秒、480p/720p 全部可用。
- 默认值仍是 5 秒 / 480p，不改现有画布里已经选好的档。
- Mini 没有的档继续拦住：1080p、16 秒以上。
- 不拆模型中心「选项状态」整套开关。
- 不改 Grok / GPT / 豆包文字 / Mureka 的参数。
- 保存失败时编辑框不关，并说明没存上。
- 线上只改 Seedance 2.0 Mini 这一条已存配置，清掉旧的禁用标记。

## 本发布范围

- `seedanceParameterSchema` 不再禁用 Mini 的 6～15 秒和 720p。
- 模型参数保存失败不再假装成功。
- 包版本升到 `0.6.13`。

## 自动验证

- 类型检查通过。
- 定向 `m17` 15/15、`m81` 41/41 通过。
- 正式安全全量 `118/118 specs、971/971 tests PASS`，失败/跳过/重试/blocked/reportErrors均为0。4173 listener 不变。
- 源码快照 536 文件，SHA-256 `81daa1592df7536d79fbcf79f62cf632fb64af0733578e45195232c1987d3b62`。

## 生产发布

- 精确源码commit`e113c64333242df923b60cac4d83214f015a14d9`、tree`bc59883a2b8bdb6610dfe6e1a160b79b62c7a229`。
- 生产current已切到`/opt/unboundry/releases/v0.6.13-inc-gen-005-20260818`；上一不可变release `v0.6.12-inc-gen-004-20260818`完整保留。
- 冻结备份`/var/lib/unboundry-rollbacks/inc-gen-005-frozen-20260818T051111Z`：冻结源与恢复副本均363文件，清单SHA-256同为`4e31aa610272a14b900804357068e39ca5c673a91bea486a004248f1e52f9fc3`。
- 公网version为0.6.13；入口JS/CSS及CanvasShell与release逐字节一致。
- 切换前后schema39、quick_check ok、FK0、tasks278、attempts280、active0、公共模板47（46 published）。
- 只改了 Seedance 2.0 Mini 这一条已存配置：清掉 6～15 秒和 720p 的禁用标记；默认仍是 5 秒/480p。
- GitHub：注释标签`v0.6.13`指向`e113c64333242df923b60cac4d83214f015a14d9`；PR #22已合并，merge commit`ed53a0aaef187aeecd3048a2f00314f16bbb4a81`。
- 发布与验证期间真实Provider请求、付费生成和OSS写入均为0。
- 自动验证不代替用户肉眼验收。请打开网站强制刷新后，到模型中心改 Seedance Mini 的时长/清晰度并保存，确认能存住、编辑框不会假装成功后关掉。

详细凭证：`spec/INC_GEN_005_PRODUCTION_RECEIPT_2026-08-18.json`。
