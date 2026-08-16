# INC-ECOM-006：第三批服装电商工作流

状态：`PRODUCTION_PUBLISHED_USER_PASS`

## 1. 本批目标与边界

- 面向女装、男装货架电商和抖音带货，补齐前两批28条模板尚未覆盖的“搜索意图、SKU变体、洗护预期、直播台本、达人Brief、系列Lookbook、天气场景、FAQ、搜索型短视频、直播预热、三视图一致性、跨境本地化”。
- 生产技术门全部通过后，用户于2026-08-15明确“都通过了”，第三批可见性与视觉验收收口为PASS；该确认没有触发任何图片或视频Provider请求。
- 只制作声明式模板数据、元提示词、节点图和复用封面映射；不把模板写进前端业务条件分支。
- 当前只允许本地包与零付费验证。禁止生产写入、真实Provider/OSS、生成任务、push/tag/PR；生产发布仍需新的版本号确认和独立“允许发布”。

## 2. 调研依据

### 官方规则与创意框架

- Google Merchant Center服饰建议要求高质量图片、准确颜色/尺码/材质/版型数据，并把重要属性放在标题前部；变体应使用对应的单一颜色图片和一致商品页信息：
  - <https://support.google.com/merchants/answer/7348545?hl=en>
  - <https://support.google.com/merchants/answer/7380908?hl=en>
  - <https://support.google.com/merchants/answer/6324350?hl=en>
- Google商品主图规范建议商品占画面约75%至90%，主图不得混入非售卖商品；服饰应展示真实穿着状态，并为颜色/尺码变体提供准确素材：
  - <https://support.google.com/merchants/answer/12473903?hl=en>
  - <https://support.google.com/merchants/answer/6324507?hl=en>
- TikTok官方Fashion 2.0创意指南反复使用商品演示、试穿、评论、GRWM、OOTD、Lookbook、用户指南、Virtual vs Real、单品多场景，并推荐Hook→Key Message→CTA的结构化生产方式：
  - <https://ads.tiktok.com/business/creativecenter/quicktok/online/Fashion_2024/pc/en>
  - <https://ads.tiktok.com/business/creativecenter/quicktok/online/creative-tips-fashion-apparel/pc/en>

### 中文内容侧检索

通过agent-reach可用的Bilibili后端检索“服装电商主图、服装带货短视频、女装直播话术、达人Brief、直播预热”等关键词。结果持续出现以下可复用结构：一套工作流出白底/细节/主图/海报、服装展示与爆款视频复刻、单款循环话术、主播话术底层逻辑、达人建联Brief、直播预告与服装详情页设计。Bilibili结果用于需求发现，不把教程标题或内容直接复制进模板。

## 3. 与既有28条的去重结论

既有第一批覆盖白底主图、生活方式、五图详情、面料工艺、版型尺码、颜色搭配、竖版封面、主图动效、15秒穿搭/卖点、微距、四镜头批量、直播切片；第二批覆盖全渠道交付、多身材试穿、UGC开箱、一衣三穿、图片合规、评论回复、痛点演示、多款对比、连续试穿、品牌幕后、七套素材测试、退货风险详情。

第三批不重复上述产物，按“输入业务问题不同、核心决策不同、输出交付物不同”三项同时去重：

| ID | 优先级 | 候选模板 | 新增业务闭环 |
|---|---|---|---|
| 301 | P0 | 货架电商｜搜索词—标题—主图协同 | 从真实搜索意图生成标题结构与首图视觉，不等于普通白底主图 |
| 302 | P0 | 服装上新｜SKU颜色尺码变体交付 | 建立颜色×尺码SKU事实和逐变体准确素材，不等于颜色搭配图 |
| 303 | P0 | 服装详情页｜洗护与耐用预期说明 | 洗涤、晾晒、收纳和风险边界，不等于面料工艺或泛退货说明 |
| 304 | P0 | 服装直播｜单款5分钟循环讲解台本 | 直播循环、异议处理、演示动作和上链接节奏，不等于直播切片 |
| 305 | P0 | 达人合作｜服装带货Brief与必拍镜头包 | 达人交付合同、必拍/可选镜头、禁说项和素材验收 |
| 306 | P1 | 服装系列｜胶囊衣橱Lookbook | 多SKU系列关系与成套造型，不等于单SKU一衣三穿 |
| 307 | P1 | 服装投放｜节气天气场景迁移 | 同款在温度、天气和时段中的可验证场景适配 |
| 308 | P1 | 服装商品页｜高频FAQ五图答疑 | 商品页常见问题卡和证据字段，不等于评论回复视频 |
| 309 | P1 | 抖音搜索｜关键词首帧与答案型短视频 | 针对搜索问题直接给答案并回到商品证据 |
| 310 | P1 | 直播上新｜预热封面、预告片与场次商品卡 | 直播前引流素材，不等于直播中的讲解或直播后切片 |
| 311 | P1 | 服装商品图｜模特、平铺、挂拍三视图一致性 | 同一SKU三种展示方式的结构、颜色和比例一致核验 |
| 312 | P2 | 跨境服装｜多语言尺码制式与渠道素材包 | 尺码制式、本地化字段、渠道主图与人工复核清单 |

优先级分布：`P0=5 / P1=6 / P2=1`，共12条。

## 4. 验收标准

1. JSON包恰好12条，ID 301～312唯一有序，标题与既有28条不重复。
2. 每条包含商品事实输入、元提示词导演、至少一个图片或视频输出、发布/人工核验节点。
3. 所有执行节点保存明确的生产模型ID；Image只接Text+Image，Video只接Text+恰好1张Image。
4. 封面只复用已留存授权证据的本地静态图，不下载、不生成、不增加成本。
5. 仅在新建系统临时目录和动态端口执行安全检查；Provider、生成任务、真实OSS与生产写入为0。
6. 本地候选通过不等于生产发布或用户实页PASS。

## 5. 本地包与零付费验证结果

- 声明式数据包：`spec/ecommerce-workflow-batch-3.json`，恰好12条，ID 301～312，`P0=5 / P1=6 / P2=1`；SHA-256为`796fd6287df501d1647f131513b772f1f798ba0effa59002eee48d8897826f42`。
- 沿用通用数据库模板物化器，不新增前端条件分支；物化图集合SHA-256为`9dd99f8bfdae25dbadd4dc7473301110b92eba258b0e6c39837c97b86c317ade`，每条6～10个节点、6～18条连线。
- 新建系统临时schema39数据库完成只读dry-run、事务插入12条和写后幂等dry-run；最终`existing=12 / missing=0`，`quick_check=ok / FK=0 / active generation=0`，临时目录随后清理。
- 12条分别复用12张已有来源/授权记录的本地JPG封面，共1,349,498 bytes；下载0、图片生成0。
- 安全入口执行`m77-public-templates`专项：source coverage PASS（330源码、293/293 TS、37/37 JS、24运维脚本），production build PASS；发现117 specs/954 tests，本次只执行1 spec/9 tests，`9/9 PASS`且异常计数全0。该结果是专项验证，不是full regression。
- 本地验证阶段没有读取生产数据库，因此当时的生产现时模型合同、兼容审计和目录/HTTP状态仍保持待发布授权；这些门已在后续授权发布时另行执行并记录于第6节，不用本地候选冒充生产PASS。
- 本地凭证：`spec/ecommerce-workflow-batch-3-local-receipt.json`。Provider请求0、付费生成0、OSS变化0、生产写入0、并发变化0。

## 6. 生产发布结果

- 用户明确“确定 发布”，本次按数据模板发布处理，线上显示版本继续为`v0.6.0`；未构建或切换新的应用release。
- 生产只读dry-run确认schema39、quick_check ok、FK0、active0、第三批existing0/missing12；三种精确模型为GPT Image 2专用协议、Doubao Seed、grok-video-3.5，均published+enabled；12张封面齐全。
- 首次恢复副本精确审计因临时审计根没有`node_modules`解析路径而在生产写入前停止；服务自动重启，生产第三批仍为0。补齐临时依赖路径后，恢复副本全库43/43 PASS、第三批12/12 PASS、问题0。
- 最终停机一致备份：`/var/lib/unboundry-rollbacks/inc-ecom-006-20260815T101814Z`；数据库SHA-256 `1d606cdf…f8d9d`，数据清单SHA-256 `07be6b05…a274`、证据清单SHA-256 `432aa233…70b6`且全量验签PASS。
- 2026-08-15T10:18:15.284Z单事务插入12条；写后生产全库43/43兼容PASS、第三批12/12 PASS、问题0。生产共43条模板，其中42条published；第三批12条均有可解析graph与preview。
- 服务active/enabled、NRestarts0，公网根页面HTTP200、版本仍为0.6.0；12张封面均HTTP200、`image/jpeg`，总字节1,349,498。未登录访问live/ready/templates返回既有认证401，不冒充匿名健康PASS。
- 发布前后generation tasks均109、Provider attempts均107、active0；per-user/RPM/Text/Image/Video/Audio均保持500。Provider请求0、付费生成0、OSS变化0。
- 生产凭证：`spec/ecommerce-workflow-batch-3-production-receipt.json`。当前只记技术发布PASS，仍需用户刷新模板面板确认第三批可见性与视觉效果后才能记USER PASS。
