# INC-UI-009：整组下载改走数据盘

状态：`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`
版本：`v0.6.11`
日期：`2026-08-17`

## 用户确认的问题

单节点生成的素材能下，模板/组「整组下载」提示 `Insufficient storage for media processing`。根因是打包去问系统临时目录（线上是很小的 `/run` 内存盘），1GB 保底过不去。

## 冻结合同

- 整组下载借空间、云端临时落盘都走数据目录，和播放列表导出同一套。
- 1GB 保底、500MB/200 个文件、同时 2 个重活 / 2GB、每账号 2 个，全部不降。
- 盘上只用随机目录 + `spool.扩展名`，节点标题只出现在压缩包里。
- 不改生成、保存、单节点下载、systemd 临时目录。
- 空间不够 / 太忙时，按钮说中文，服务器错误码保持原样。

## 自动验证

- 类型检查通过。
- 定向 `m72` 8/8、`m80` 7/7、`m90` 20/20 通过。
- 正式安全全量 `118/118 specs、969/969 tests PASS`，失败/跳过/重试/blocked/reportErrors均为0。
- 源码快照 530 文件，SHA-256 `5c76e8a3d557a83bfb8519be2847bf2539775ccabec80b8d588e10f13379fd10`。

## 生产发布

- 精确源码commit`321668e1adf692e356b1e504230721451af8ddcf`、tree`3ea47f74267ec1e5c1b5c0d80fef51115161e021`。
- 生产current已切到`/opt/unboundry/releases/v0.6.11-inc-ui-009-20260817`；上一不可变release `v0.6.10-inc-ui-008-20260817`完整保留。
- 冻结备份`/var/lib/unboundry-rollbacks/inc-ui-009-frozen-20260817T161145Z`：冻结源与恢复副本均365文件，清单SHA-256同为`c835cdcd7eb112696115cbf7528c4aab206517838ecc11fc6e59a91aad5c8e4f`。
- 公网version为0.6.11；入口JS/CSS及CanvasShell与release逐字节一致。
- 数据不变：切换后schema39、quick_check ok、FK0、tasks246、attempts248、active0、公共模板47（46 published）。
- GitHub：注释标签`v0.6.11`指向`321668e1adf692e356b1e504230721451af8ddcf`；PR #18已合并，merge commit`749e45cb68feabd11b4ffc721e06df4cd46a2b77`。
- 发布与验证期间真实Provider请求、付费生成和OSS写入均为0。
- 自动验证不代替用户肉眼验收。请打开网站强制刷新后，看模板/组「整组下载」是否还能打出 zip。

详细凭证：`spec/INC_UI_009_PRODUCTION_RECEIPT_2026-08-17.json`。
