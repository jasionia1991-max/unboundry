# Unboundry 同一中转站三媒体模型接入 Checkpoint

更新日期：2026-08-21

状态：`HISTORICAL_V0_6_28_CHECKPOINT / SUPERSEDED_BY_V0_6_29_30 / CURRENT_V0_6_33_USER_PASS`

当前收口：本 Checkpoint 的 package、发布源码和 `USER_RECHECK` 是 v0.6.28 冻结时点。当前生产为 v0.6.33/schema39；三模型只归属云腾 Provider，v0.6.29 已完成三次有界真实创建，v0.6.30 以零新增 POST 恢复 Nano PNG 与 Suno 两个 MP3 并获用户验收。后续恢复只读 `spec/UNBOUNDRY_CURRENT_STATE.md`，不得从本文件重启旧 Goal。

## 1. v0.6.28 冻结身份

- 仓库：`/Users/mymy/Documents/unboundry/app`；
- 分支：`codex/unboundry-offline-remediation-2026-08-09`；
- 用户指定文档基线：`80820cb8ae9df7069837406707d4181d818b6847`；
- 第一工程提交：`3144d7a3297251d2ba97fd585daa18b804a0c325`（结果提交所有权）；
- 发布源码：commit`ee6ce437730cf78ef4488217b778f6b0ef2aaee5` / tree`2811ada65140779d4a5e10cbd8ed6fa54893638b` / tag`v0.6.28`；
- package：`0.6.28`；
- 工程运行时：Node `22.23.1` / npm `10.9.8`；
- 当前 shell 默认 Node/npm 可能仍为 v25/11，施工命令必须显式切换；
- 允许存在的唯一未跟踪文件：`spec/public-templates-director-split-revision.json`；
- 该 JSON 受保护，禁止读取、修改、格式化、移动、删除、暂存、提交或进入任何测试/构建产物。

## 2. v0.6.28 时点事实

- 同步文字 Provider port 第一批已在本地提交 `e7016eb` 完成，并随v0.6.28发布，状态 `PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`；
- 本三媒体工程已随v0.6.28发布，状态`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`；
- 已核实三模型共用 `https://api.lk888.ai`、`POST /v1/media/generate` 和异步 task_id/status/result_url 合同；
- 已核实参数差异、轮询路径歧义、无稳定退款字段、无取消接口；
- Kling已使用paid attempt `created_at`承载75分钟持久窗口；Nano/Suno分别10/15分钟，未新增schema；
- `gemini-3-pro-image-preview`已在Gemini文本规则前精确分类为image并由m55固定；
- MediaLifecycle/MediaRegistry已移除对generation task/attempt的SQL所有权，GenerationResultCommit在同一BEGIN IMMEDIATE内编排publication、attempt、task和event；
- 三模型继续使用现有`multi-protocol-relay/media-generate`；没有新driver、Storage第三批、Canvas节点或平行registry；
- 提交响应丢失、已有providerTaskId恢复、404/405路径回退、严格result_type与无退款不重试均已本地固化。

## 3. 权威文档顺序

1. `AGENTS.md`；
2. `上线规矩.md`；
3. `spec/UNBOUNDRY_CURRENT_STATE.md`；
4. `README.md`；
5. `TASKS.md`顶部当前区块；
6. `spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md`；
7. `spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_CHECKPOINT.md`；
8. `spec/UNBOUNDRY_MODULAR_MONOLITH_AUDIT_2026-08-21.md`；
9. `spec/UNBOUNDRY_RELAY_MEDIA_MODELS_INTEGRATION_PLAN_2026-08-21.md`；
10. `spec/UNBOUNDRY_RELAY_MEDIA_MODELS_ACCEPTANCE_MATRIX_2026-08-21.md`；
11. 本文；
12. `spec/UNBOUNDRY_RELAY_MEDIA_MODELS_GOAL_PROMPT_2026-08-21.md`。

历史文档只能解释过去；当前事实以用户最新指令、Git、当前代码、当前测试和 CURRENT_STATE 为准。

## 4. 新 Session 第一个动作

```bash
cd /Users/mymy/Documents/unboundry/app
pwd
git status --porcelain=v1 -b
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git log -5 --oneline --decorate
node --version
npm --version
node -p "require('./package.json').version"
git diff --quiet HEAD origin/main --
```

确认：

1. 仓库、分支、HEAD、package与本Checkpoint一致，或新文档commit是HEAD的唯一预期前进；
2. 除受保护JSON外无未说明改动；
3. 第一批文字port提交仍在历史中；
4. 未复用旧发布、Provider、OSS、生产或GitHub授权；
5. Node/npm切换只通过现有本地运行时，不改package/lock。

如果身份冲突、用户改动与目标文件重叠或受保护JSON进入暂存区，停止施工并报告；禁止reset、clean、stash、强制checkout或覆盖。

## 5. 当前执行点

```text
Stage 0 identity/call-chain freeze: COMPLETE
  -> Stage 1 GenerationResultCommit + cycle removal: COMPLETE
  -> Stage 2 relay media model contracts: COMPLETE
  -> Stage 3 durable long-task recovery: COMPLETE
  -> Stage 4 result/error normalization: COMPLETE
  -> Stage 5 targeted verification + docs + two local commits: COMPLETE
  -> PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK
```

版本、push/PR/tag、发布与生产技术验收均已完成；本次授权已消费。真实Provider smoke仍为`PAUSED`，不得自动执行。

## 6. 测试回执

- Node `22.23.1` / npm `10.9.8`；safe runner统一集合为m5/m14/m38/m40/m44/m53/m54/m55/m57/m88。
- 前四次启动均在产品spec前被TypeScript、测试清单或source-coverage闸门阻止；修正后第一次执行产品spec为`145/148`，失败仅在m53/m57。
- 只重跑失败文件m53+m57，退出0、`40/40`；因此最终有效十spec为`148/148`，且最终代码下TypeScript、构建、source coverage和外网门禁均绿。
- m37/m80/m87/m90未追加：底层存储合同未改变，生成保存token与publication事务由m54/m88直接覆盖。
- full未运行：没有Canvas/Workflow/schema/release改动，冻结定向集合已覆盖实际风险传播。
- 全部自动执行使用新临时目录、动态loopback与fake fetch；真实路径操作0，4173 listener不变，真实Provider/OSS/生产未触碰。

## 7. 当前停止点

v0.6.28已发布到`/opt/unboundry/releases/v0.6.28-relay-media-models-20260821`，生产与GitHub回执见`spec/V0_6_28_PRODUCTION_RECEIPT_2026-08-21.json`。`REAL_PROVIDER_SMOKE_PAUSED`，页面选择与真实结果由用户线上复验；下一次Provider、版本、push/PR/tag、发布、SSH或生产动作需要新的明确授权。

## 8. 历史施工停止条件

只有以下真实阻断可以中断自动推进：

- 仓库身份冲突；
- 用户改动与目标文件直接重叠且无法安全保留；
- 受保护JSON被已存在流程强制读取/打包；
- 保持原子性被证明必须新增schema，但当前Goal明确禁止且无法用paid attempt created_at承载；
- 无法保证已有providerTaskId恢复时POST=0；
- 测试只能通过访问真实数据、真实密钥、OSS或生产才能运行。

普通编译错误、定向测试失败、实现困难或耗时不是停止理由；应诊断、修复并重跑最小相关测试。

## 9. 交付边界

- 两个本地commit：结果提交边界；三模型合同；
- commit只包含本Goal代码、测试和文档；
- 受保护JSON必须保持untracked且不进入index；
- 最终报告列明实际文件、调用链、测试命令/结果、未跑full原因、真实Provider状态和剩余风险；
- 本地自动证据不能写成USER PASS、生产验收或发布完成。
