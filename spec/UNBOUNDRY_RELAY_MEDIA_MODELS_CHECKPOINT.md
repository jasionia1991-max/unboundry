# Unboundry 同一中转站三媒体模型接入 Checkpoint

更新日期：2026-08-21

状态：`PLAN_FROZEN / IMPLEMENTATION_NOT_STARTED`

## 1. 当前身份

- 仓库：`/Users/mymy/Documents/unboundry/app`；
- 分支：`codex/unboundry-offline-remediation-2026-08-09`；
- 方案冻结 HEAD：`e7016eb26ad3a7ae9829067a057b1206d3c2b3c4`；
- package：`0.6.27`；
- 工程运行时：Node `22.23.1` / npm `10.9.8`；
- 当前 shell 默认 Node/npm 可能仍为 v25/11，施工命令必须显式切换；
- 允许存在的唯一未跟踪文件：`spec/public-templates-director-split-revision.json`；
- 该 JSON 受保护，禁止读取、修改、格式化、移动、删除、暂存、提交或进入任何测试/构建产物。

## 2. 当前事实

- 同步文字 Provider port 第一批已在本地提交 `e7016eb` 完成，状态 `AUTO_PASS / USER_REVIEW`，未发布；
- 本三媒体接入尚未修改产品代码、测试、schema、版本或运行配置；
- 已核实三模型共用 `https://api.lk888.ai`、`POST /v1/media/generate` 和异步 task_id/status/result_url 合同；
- 已核实参数差异、轮询路径歧义、无稳定退款字段、无取消接口；
- 已核实现有 Kling 通用恢复窗口短于平台文档的约70分钟上限；
- 已核实现有 `server/multiProtocolRelay.ts` 图片识别正则不能匹配 `gemini-3-pro-image-preview`，会误入Gemini文本分类；
- 已核实现有 MediaLifecycle/MediaRegistry 在 reserve、finalize、fail、recovery、delete 多处直接查询或更新 generation 表，不是只改 finalize 即可；
- 已核实现有音频丢失提交响应分支没有图片/视频同等级恢复能力；
- 已裁决：使用现有 `multi-protocol-relay/media-generate`，不新增driver、不启动Storage第三批、不新增Canvas节点；
- 已触发路线图第二批：先完成Task/Media结果提交边界，再接模型合同。

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
PLAN_FROZEN
  -> Stage 0 identity/call-chain freeze
  -> Stage 1 GenerationResultCommit + cycle removal
  -> Stage 2 relay media model contracts
  -> Stage 3 durable long-task recovery
  -> Stage 4 result/error normalization
  -> Stage 5 targeted verification + docs + local commits
  -> LOCAL_ENGINEERING_COMPLETE / AUTO_PASS / USER_REVIEW
```

不得自动进入真实Provider、版本、push/PR/tag、发布或生产。

## 6. 测试续接

- 先完成全部相关实现并静态检查，不按阶段反复启动runner；
- 最终一次统一定向集合：m5/m14/m38/m40/m44/m53/m54/m55/m57/m88；模型合同优先写进这些直接spec，确有职责隔离才新增一个合同spec并加入同一命令；
- 仅在storage直接合同受影响时追加对应m37/m80/m87/m90；
- 使用一次 `node scripts/run-safe-tests.mjs run --spec <exact spec> ...`；runner已包含preflight、TypeScript、构建、临时数据、动态loopback和外网门禁，不额外重复跑这些阶段；
- 默认不跑 full；
- 每次回执记录Node/npm、spec、tests、退出码、临时目录、动态端口、4173前后身份和外部请求计数；
- 测试失败只诊断并重跑失败spec或更小子集；成功后没有新相关代码变化不得重复。

## 7. 停止条件

只有以下真实阻断可以中断自动推进：

- 仓库身份冲突；
- 用户改动与目标文件直接重叠且无法安全保留；
- 受保护JSON被已存在流程强制读取/打包；
- 保持原子性被证明必须新增schema，但当前Goal明确禁止且无法用paid attempt created_at承载；
- 无法保证已有providerTaskId恢复时POST=0；
- 测试只能通过访问真实数据、真实密钥、OSS或生产才能运行。

普通编译错误、定向测试失败、实现困难或耗时不是停止理由；应诊断、修复并重跑最小相关测试。

## 8. 交付要求

- 推荐两个本地commit：结果提交边界；三模型合同；
- commit只包含本Goal代码、测试和文档；
- 受保护JSON必须保持untracked且不进入index；
- 最终报告列明实际文件、调用链、测试命令/结果、未跑full原因、真实Provider状态和剩余风险；
- 本地自动证据不能写成USER PASS、生产验收或发布完成。
