# Unboundry v0.6.2 发布说明

状态：`PRODUCTION LIVE / AUTOMATED PASS / USER RECHECK`

## 本次上线内容

- 设置页“返回画布”返回进入前的真实项目，并新增“返回工作空间”。
- 浏览器显示无央 favicon；画布、工作空间、设置页和登录页使用准确动态标题。
- 框选巨大 Group 附近节点时，只有完整包含 Group 才会把 Group 选中，避免打组范围异常扩大。
- 图片、视频、音频读取失败时不再显示浏览器坏媒体图标；保留原素材引用，提供统一重载/重新上传恢复层。
- Text、Image、Video、Audio、Playlist、Group、Storyboard 长标题统一省略显示，悬停可查看完整标题。

## 技术与上线证据

- 正式安全全量：`118/118 specs、965/965 tests PASS`，所有异常计数为0。
- 生产：`/opt/unboundry/current -> /opt/unboundry/releases/v0.6.2-inc-ui-002-20260816`，公网version/live/ready与静态资源哈希通过。
- 数据：schema39、quick_check ok、FK0，生成任务、Provider attempt、模板和安全阈值切换前后相同。
- 成本：本次发布没有真实Provider调用、没有付费生成、没有OSS写入。
- 回滚：`/var/lib/unboundry-rollbacks/inc-ui-002-20260815T180956Z`的源备份和独立恢复副本均通过逻辑与清单检查。

## 验收边界

自动测试和生产健康检查已经通过，但导航、favicon、框选手感、坏媒体恢复层和长标题仍需用户在真实浏览器进行最终肉眼确认。确认前保持`USER_RECHECK`，不冒充`USER PASS`。

四份此前所称“冻结发布测试”是：`m10`备份/恢复、`m92`跨版本兼容、`m94`不可变发布制品、`m96`发布运维配置。它们冻结的是历史发布安全合同，不是四份待用户操作的测试；v0.6.2通过合成历史版本对复验了这些合同，没有改写旧合同。
