# INC-GEN-001：生成用时与画布核对结果

状态：`PRODUCTION_PUBLISHED_USER_PASS`
版本：`v0.6.7`
日期：`2026-08-17`

## 用户确认的问题

1. 生成结束后看不到这次用了多久。
2. 平台已经出图，但画布空着；或平台没有成片，用户却不知道能不能安全重试。
3. 不能让用户自己去平台找图再上传。

## 冻结合同

- 选中节点、组、任务面板显示已完成生成用时；用时不写进画布文档。
- 失败且结果对不上时，节点上先出「核对结果」，只查询已保存的平台任务，不新开付费请求。
- 核对到成片就收回节点；确认没有成片才解锁重试。
- 账号错误等普通失败继续直接出重试，避免挡住原来的安全重试。

## 完成结果

- 自动门：正式安全全量`118/118 specs、969/969 tests PASS`，失败/跳过/重试/blocked/reportErrors均为0；4173 listener不变。
- 生产：current已切到`/opt/unboundry/releases/v0.6.7-inc-gen-001-20260817`，公网version为0.6.7，入口JS/CSS及CanvasShell与release逐字节一致。
- 数据不变：切换前后schema39、quick_check ok、FK0、tasks220、attempts221、active0、公共模板47（46 published）。
- GitHub：注释标签`v0.6.7`指向`a4dc45f4cdfa30547dac401fc29d6796ba233832`；PR #8已合并。
- 用户随后在生产实页明确回复“看了 也通过了”，本事件正式收口为`PRODUCTION_PUBLISHED_USER_PASS`。
