# Unboundry v0.6.1 发布说明

发布日期：2026-08-15

## 发布内容

- 整组执行改为事件驱动DAG流水：多直接生成式上游严格AND，分流独立推进，汇流等待全部，失败只阻塞后代。
- Text、Image、Video、Audio在实际提交前统一刷新运行时输入和兼容预检，避免把本轮尚未完成的上游误判为下游失败。
- 完成三批服装电商模板、真实封面、参考图拆锁、GPT Image同步超时修复、既有结果恢复和模板模型兼容门。
- 模板以`public_templates.graph`声明式数据保存，应用时复制为新画布节点，不是前端组件条件硬编码。

## 生产与验证

- 生产源commit：`f3d3fc8b2d4cb846b446fa4a46afbdcd796e2ccf`
- 生产tree：`dd1180077032a42f1ab7ce7ca614906898d1f414`
- 生产目录：`/opt/unboundry/releases/v0.6.1-inc-ecom-007-20260815`
- 正式full基线：`117/117 specs、959/959 PASS`
- v0.6.1准入修复后相关验证：`8 specs、110/110 PASS`
- 精确发布HEAD build：PASS
- 生产核验：version/live/ready/root、主JS哈希、schema39 quick_check、FK0、恢复副本清单全部通过
- 发布过程真实Provider/付费请求：0

## 用户验收与延期边界

- 用户已确认工作流流水执行、三批电商模板、模板封面、原结果恢复和现有真实图片结果通过；REM-000～011（含009A/009B）收口为PASS。
- `服装详情页｜面料与工艺拆解`的`工艺拆解·完整商品`完成一次1K真实技术smoke并获用户确认；另外两个图片输出未再次付费生成。
- 该模板本身没有Video节点。其他电商视频模板的真实生成抽验与上述另外两图均作为可选付费验收延期，不冒充真实生成PASS，也不阻塞本版本。
- Mureka真实音频、打光、团队多人、Storyboard/Agent等既有PARTIAL/PAUSED/BLOCK/NOT_STARTED范围不在本版本内。

## 回滚与凭证

- 生产凭证：`spec/INC_ECOM_007_PRODUCTION_RECEIPT_2026-08-15.json`
- 停机备份：`/var/lib/unboundry-rollbacks/inc-ecom-007-20260815T135418Z`
- 备份与恢复清单SHA-256：`73554c0a84001d953c27f55c011f77fff8b873db2918ea3e4eca0b19a7535f24`

## GitHub发布

- 分支：`codex/unboundry-offline-remediation-2026-08-09`
- 注释标签：`v0.6.1`，目标为生产源commit `f3d3fc8b2d4cb846b446fa4a46afbdcd796e2ccf`
- Draft PR：[#1 Release v0.6.1 workflow execution and ecommerce templates](https://github.com/jasionia1991-max/unboundry/pull/1)
