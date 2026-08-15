# INC-ECOM-005：第二批电商工作流模板包

日期：2026-08-15  
当前状态：`PRODUCTION_PUBLISHED_USER_PASS`

## 1. 目标与边界

- 补齐此前已经给用户列出的第二批12条服装电商工作流，保持P0=5、P1=6、P2=1。
- 模板不是前端组件中的条件分支。运行时仍由通用模板目录读取`public_templates.graph` JSON；应用模板时为每个节点和连线生成新ID并复制到用户当前画布。
- 每条模板作为数据固定默认节点、连线、元提示词、输出规格和明确模型ID。这是可复用模板的默认内容，不是把业务逻辑写死在页面代码里。
- 本批不修改并发、频率、Provider、OSS、模型目录或生成任务，不发起真实/付费生成。
- 封面零新增成本：复用第一批已取得来源/授权记录并已上线的12张实图；后续可独立替换，不影响工作流图。

## 2. 第二批清单

| 优先级 | ID | 模板 |
|---|---|---|
| P0 | 201 | 服装上新｜一套素材全渠道交付 |
| P0 | 202 | 女装/男装｜多身材多尺码试穿对照 |
| P0 | 203 | 抖音服装｜UGC开箱试穿口播 |
| P0 | 204 | 抖音服装｜一衣三穿场景切换 |
| P0 | 205 | 电商图片｜商品真实性与平台合规质检 |
| P1 | 206 | 抖音带货｜评论区问题回复视频 |
| P1 | 207 | 服装带货｜痛点—解决方案演示 |
| P1 | 208 | 服装选购｜两款/三款对比指南 |
| P1 | 209 | 抖音服装｜所见即所得试穿证明 |
| P1 | 210 | 品牌内容｜设计、制作与打包幕后 |
| P1 | 211 | 抖音创意工厂｜单SKU七套素材测试 |
| P2 | 212 | 服装商品页｜退货风险预防详情组 |

## 3. 数据包与发布器

- 声明式模板数据：`spec/ecommerce-workflow-batch-2.json`
  - SHA-256：`53fa501eb88b8d926714e23541d2bea720ee6a3b276c2afaee311aa5a2ca8cde`
  - 包含12条工作流的商品事实输入、元提示词、图片/视频输出提示词、分镜、发布文案和封面路径。
- 受控发布器：`scripts/apply-ecommerce-workflow-batch-2.mjs`
  - 默认只读dry-run；只有显式`--apply`才写入。
  - 只接受schema39、`quick_check=ok`、FK=0、活动生成任务=0的数据库。
  - 精确核对三种已发布且启用的模型；图片输出只接文字+参考图，视频输出固定只接一张参考图。
  - 校验节点/连线唯一性、输入顺序、父子关系、无环、模型ID、封面文件和既有行冲突。
  - 事务内只插入缺失的12条`public_templates`；存在且完全一致时幂等跳过，任一差异立即失败并回滚。
- 物化图集合SHA-256：`4735ec3235bdbf571ce08e468a9f8c28899cd7a942564d9d053de7c57de017b8`。

## 4. 当前验证证据

- 生产主库只读dry-run：schema39、quick_check ok、FK0、active generation 0；12条当前全部missing，未写库。
- 精确模型合同：Doubao Seed文字、GPT Image 2专用协议图片、grok-video-3.5视频均为published+enabled；12张封面均存在，总字节1,763,736。
- 对线上主库创建一致副本，在副本中事务导入12条后，调用当前生产代码`auditStoredPublicTemplates`：`12/12 PASS`，兼容问题0。
- 本地Node22.23.1/npm10.9.8：source coverage PASS（330源码，293 TS，37 JS，24运维脚本）；production build PASS。
- 安全入口m77公共模板专项：发现117 specs/954 tests，本次执行1 spec/9 tests，`9/9 PASS`；失败、跳过、重试、report error和blocked均为0；源码snapshot前后不变。
- 上述检查没有调用Provider、没有创建生成任务、没有修改并发/OSS，也不是full regression或用户实页验收。

## 5. 生产发布结果

- 用户已明确确认继续显示`v0.6.0`并允许发布，两道生产门均已满足。
- 停机一致备份与恢复验证目录：`/var/lib/unboundry-rollbacks/inc-ecom-005-20260815T092428Z`；恢复数据库SHA-256 `5a4df10e…c3de`，最终凭证清单SHA-256 `8313a3b6…f503`。
- 2026-08-15T09:26:27.412Z单事务插入12条；生产精确兼容审计`PASS=12 / NEEDS_MODEL=0 / INVALID=0 / issues=0`。
- 当前运行时模板目录：published共30条，第二批12/12均可解析graph且有preview；生产数据库共31条（含既有1条archived），30条published均有preview。
- 公网live/ready/version/root正常，版本仍为`0.6.0`；12张复用封面均HTTP200、`image/jpeg`。service active/enabled、NRestarts0。
- 发布前后generation tasks均109、Provider attempts均107、active0；每用户/RPM/Text/Image/Video/Audio并发仍全部500。Provider请求0、付费生成0、OSS变化0。
- 生产receipt：`spec/ecommerce-workflow-batch-2-production-receipt.json`。用户随后明确第二批实页验收“通过1”，本批生产内容与视觉验收收口为USER PASS。
