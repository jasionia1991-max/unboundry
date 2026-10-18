# INC-ECOM-008｜服装一键自动上新提示词包（本地候选）

状态：`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`。源提示词包继续保留 `local-candidate` 标记，表示它本身是不可直接自动发布的审阅输入；经用户授权后，发布器已将其转换并写入线上三份公共模板。发布与修复过程均未调用真实生成 API。

## 目标

用户只上传一张手拍图、白底图或模特图，工作流先抽取“可确认事实”，再生成标准化服装参考图，随后把同一份事实和参考图分流到：

- P0：货架电商主图、试穿主图、详情页组图；
- P1：OOTD 种草图、动作封面组、抖音 15–25 秒视频、发布文案。

每个下游生成节点都声明自己的入参，生成式节点必须等待所有入参上游成功后再启动；同一层互不依赖的分支才允许并行。

## 文件

- `spec/ecommerce-apparel-auto-launch-prompt-pack.json`：声明式提示词、节点、边、输出和成本策略。
- `scripts/verify-ecommerce-apparel-auto-launch.mjs`：零请求静态校验，检查 DAG、节点类型、提示词、入参链和本地候选状态。

## 验收边界

源包只负责保存可审阅的提示词与编排，不具备自动发布能力。实际发布必须通过 `scripts/apply-ecommerce-apparel-auto-launch.mjs` 的显式参数、数据库与模型前置检查以及事务写入；本批已经在用户授权后完成发布。当前线上模板及空位落位修复证据见 `INC_ECOM_009_TEMPLATE_PLACEMENT_GUARD_2026-08-16.md` 与对应生产回执。

## 本地验证

```bash
npm run verify:apparel-auto-launch
```

该命令只读取本地 JSON，不发起网络请求、不提交生成任务、不修改 OSS 或线上数据库。
