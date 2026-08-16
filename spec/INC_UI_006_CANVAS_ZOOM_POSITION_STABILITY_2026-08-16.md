# INC-UI-006：画布缩放坐标稳定性

状态：`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`
版本：`v0.6.5`
日期：`2026-08-16`

## 生产复现与根因

- 目标画布：`14601b3e-3073-443f-9799-7a4fc02362c1`。
- 目标组：`group-dc249a6d-4e99-40fa-b8bf-da570f0570e6`。
- 同一视口从15%缩放到27%再回到15%后，组DOM世界坐标从`(-1080,-1080)`漂移到`(-1128,-1128)`，子节点同步偏移48；视口数值没有变化，因此不是正常镜头效果。
- v0.6.4 Group直接订阅viewport并在每次缩放时重算标题、工具栏与缩放手柄；React Flow的被动position change随后被通用保存路径当作真实拖动持久化。
- 生产数据同时发现历史模板根组存在`parentId === id`自引用。该拓扑不被React Flow支持，会放大负坐标组在测量/缩放时的不确定性。

## v0.6.5 修复

- Group不再订阅viewport；标题和工具栏只读取CanvasSurface命令式维护的CSS变量，NodeResizer恢复官方单层autoScale。
- 视口缩放/平移安静期过滤非拖拽position change；真实节点拖动、键盘移动、resize、dimensions和selection继续生效。
- 画布载入和模板应用在进入React Flow前去除根节点自引用；保存个人组模板时也强制删除根组parentId，防止旧坏数据继续传播。
- 目标生产组只在停机冻结备份、数据库前置值和页面实测都吻合后，恢复为无父级根组及世界坐标`(-1080,-1080)`；其他自引用根仅移除自引用并保留其已保存坐标，不猜测位置。

## 验证合同

- 负坐标自引用Group及子节点在`15%→27%→15%→60%→15%→100%→15%`后DOM transform不变。
- 保存后的节点位置不随镜头缩放变化；真实拖动和resize回归继续通过。
- 个人模板序列化和公共模板应用均不得生成`parentId === id`。
- 正式发布必须通过安全全量118份spec/968项测试、冻结备份可恢复、schema39完整性、公网资源哈希、生产实页多轮缩放及服务/数据不变门。
- 不运行真实Provider、付费生成或OSS写入；自动测试与线上技术复验不代替用户`USER_RECHECK`。

## 发布结果

- 精确生产源码为`d19e9dbf564f5806adface7807fbf7182bcdafc8`，正式安全全量`118/118 specs、968/968 tests PASS`，失败、跳过、重试、blocked与reportErrors均为0。
- 生产已切换至`/opt/unboundry/releases/v0.6.5-inc-ui-006-20260816`；公网`version=0.6.5`、ready active/schema39、service active+enabled、NRestarts0，公网JS/CSS与fresh build逐字节一致。
- 冻结备份及恢复副本均为363个文件，清单SHA-256均为`ba6baec6408f1a34d542cffc87cdf69717b82138154af4b049979a413657633e`，恢复库`quick_check=ok / FK0`。
- 目标画布仅修复两个历史自引用根：目标组恢复为无父级`(-1080,-1080)`；另一组只移除自引用并保留`(-1354.7552083333335,-1468.1145833333335)`。节点89、边145和viewport保持不变。
- 登录生产实页对72个已挂载节点执行`.27→.6→.15→1→.27→.15`连续缩放，所有DOM transform前后完全一致，`movedIds=[]`，浏览器错误日志为空；数据库坐标及revision保持不变。
- 完整生产凭证见`spec/INC_UI_006_PRODUCTION_RECEIPT_2026-08-16.json`；仍需用户在原画布肉眼复验，自动结论不替代`USER_RECHECK`。
