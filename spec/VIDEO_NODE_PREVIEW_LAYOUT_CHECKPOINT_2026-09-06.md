# 视频节点预览布局修复唯一断点（2026-09-06）

状态：LOCAL_IMPLEMENTATION_AND_TARGETED_REVIEW_PASS / USER_RECHECK / DEPLOYMENT_PENDING_USER_CONFIRMATION。

用户已授权本地修复、定向测试和审查；禁止修改线上或付费生成。当前分支codex/video-node-preview-containment，基线e3617807a0c118d46bc1d2149454f16f30d56a45，未commit/push/登记版本。最后实查生产v0.7.13/schema43（来自此前诊断，本轮不重新探测）。v0.7.11恢复分支39c6385保留不动。

产品只改styles.css两处选择器、4条声明。未修复实测836px视频溢出418px容器；修复后618×418完整容纳，四角像素检查通过。816×1104、9:16、16:9、1:1及32%/100%代表组合通过；620×420拖为380×540后完整显示、保存与刷新恢复通过，纯查看刷新无新增Canvas写。m2 3项、m98 5项、扩展m4 1项（含4场景步骤）有效通过，共9项。不是1266全量回归；先前失败和测试脚本修正记录保留。类型检查、正式前端构建及最终主代理审查通过，未伪称独立子代理审查。

权威回执：spec/VIDEO_NODE_PREVIEW_LAYOUT_LOCAL_RECEIPT_2026-09-06.json。
详细结果与待确认上线/回退方案：/Users/mymy/Documents/unboundry/VIDEO_NODE_PREVIEW_LOCAL_RESULT_AND_RELEASE_PLAN_2026-09-06.md。
已审行动方案：/Users/mymy/Documents/unboundry/VIDEO_NODE_PREVIEW_LAYOUT_PLAN_AND_AUDIT_2026-09-06.md。
日志和合成截图：/Users/mymy/Documents/unboundry/video-preview-local-verification-20260906/。

下一步：用户确认上线后才进入版本登记、commit/PR/CI和部署。建议下一未占用patch（预计v0.7.14，发布前核实），不得移动既有tag。发布前核实生产身份、活动任务和当前数据备份门；代码切换后用既有素材零付费核对节点/全屏及刷新零写。若失败回退v0.7.13代码，保留CURRENT与新数据，不恢复旧数据库。性能慢点和自动备份失败继续由原性能断点记录，本次不扩修。
