# Unboundry 渐进式模块化 Checkpoint

更新日期：2026-08-21
状态：`FIRST_AND_SECOND_BATCH_PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`

## 1. 当前权威文件

按顺序阅读：

1. `AGENTS.md`
2. `上线规矩.md`
3. `spec/UNBOUNDRY_CURRENT_STATE.md`
4. `README.md`
5. `spec/UNBOUNDRY_HANDOFF_2026-08-09.md`
6. `TASKS.md`顶部当前区块
7. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md`顶部当前区块
8. `spec/UNBOUNDRY_MODULAR_MONOLITH_AUDIT_2026-08-21.md`
9. `spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md`
10. `spec/UNBOUNDRY_PROVIDER_PORT_BATCH_ACCEPTANCE_MATRIX_2026-08-21.md`
11. 本文
12. `spec/UNBOUNDRY_CANVAS_EXECUTION_DECOUPLING_PLAN_2026-08-21.md`
13. `spec/UNBOUNDRY_CANVAS_EXECUTION_ACCEPTANCE_MATRIX_2026-08-21.md`
14. `spec/UNBOUNDRY_CANVAS_EXECUTION_CHECKPOINT.md`
15. `spec/V0_6_27_PRODUCTION_RECEIPT_2026-08-21.json`

历史文档只用于追溯；当前事实以Git、当前代码、测试和`UNBOUNDRY_CURRENT_STATE.md`为准。

## 2. 记录基线

- 仓库：`/Users/mymy/Documents/unboundry/app`
- 分支：`codex/unboundry-offline-remediation-2026-08-09`
- HEAD：`4cad6fc45d9db1937fbc90475180181b69745aa4`
- `origin/main`：`3c967157b6fd257264556cc02f3ebceb3d033922`
- 两者文件树一致，提交历史不同
- package：`0.6.27`
- package约束：Node `>=22.23.1 <23`、npm `10.9.8`
- shell默认：Node `v25.9.0`、npm `11.12.1`
- 第一批施工/验证：显式使用Node `22.23.1`、npm `10.9.8`
- 线上状态：`v0.6.28 / PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`
- 受保护未跟踪文件：`spec/public-templates-director-split-revision.json`

基线会漂移，新Session必须重新只读核对；冲突时停止，不得reset、clean、checkout覆盖或自行修复。

## 3. 已完成

- 全项目只读模块审计；
- 当前模块地图、主要调用链和跨表访问复核；
- v0.6.27 Canvas/Workflow核心解耦事实复核；
- 百分比计算基线；
- 渐进式路线图及功能触发条件；
- 第一施工批范围和验收矩阵。
- 同步文字`TextGenerationProvider` port与`TextProviderRegistry`；
- Ark native和四类relay同步文字实现登记到唯一registry；
- Generation Task同步文字分支移除具体driver/adapter调用，只保留任务状态、输入物化、lease、attempt和结果写回；
- 原未使用的媒体形态`GenerationProvider`假抽象已收敛，不保留第二套抽象；
- fake Provider注入、未知实现零网络、provider-boundary attempt测试；
- 一次TypeScript noEmit及m33/m39/m44/m53/m57定向安全测试；
- 审计、路线图、验收矩阵、Checkpoint、CURRENT_STATE与TASKS当前区块同步。

## 4. 第一批本地交付

状态：第一批已随v0.6.28发布，`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`。这不是USER PASS。

- 调用链：`HTTP/API → Generation Task → 输入物化 → profile/credential lease + task snapshot校验 → TextProviderRegistry → Ark/relay文字adapter → 规范化text/usage → provider response evidence → Task complete`。
- driver选择：只在`server/providerRegistry.ts`按已解析的`profile.driver + protocol`进行；Generation Task不再按具体文字driver分支。
- attempt边界：仍由adapter在真正POST前调用`beforeProviderRequest`；TaskStore先记录provider-boundary attempt，relay pinned transport继续在同一边界释放lease，native fetch wrapper继续在fetch接管后释放。
- profile/credential：继续由`providerProfiles`解析与租赁，adapter不获得数据库、TaskStore、Canvas或MediaLifecycle。
- 结果：port只返回`text + providerUsageTokens`；Task协调器负责匹配原task/owner/model快照并写回。
- 回滚：无schema、数据、版本或生产变化；可对本批单一提交执行正常revert，但本Goal未授权push/PR/发布。

验证证据：

- `PATH=/Users/mymy/.local/bin:$PATH npx tsc --noEmit --pretty false`：退出0，只运行一次；
- m33：`8/8 PASS`，含fake port完成task、fetch 0、attempt 1、未知实现fetch 0；
- m39：`3/3 PASS`；
- m44：`8/8 PASS`；
- m53：`23/23 PASS`；
- m57：`14/14 PASS`；
- 每次定向测试均由安全runner使用新临时数据与动态loopback端口，4173 listener hash不变，failed/skipped/retries/blocked/reportErrors为0；
- 冻结发现清单为`119 specs / 1030 tests`；本批没有运行full，也不得把该数字写成全量PASS。

未触碰：真实Provider、付费生成、OSS、SSH、生产、4173、`app/data`、`/var/lib/unboundry`、版本、schema、Canvas、Workflow、Media publication。受保护JSON未读取、修改、格式化、暂存或提交。

## 5. 后续批次触发条件

- 异步Provider、任务恢复或Media result commit变化前：第二批；已由2026-08-21三媒体Goal完成并随v0.6.28发布，状态`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`；
- 第三种Storage backend前：第三批；
- 新生成节点、Canvas保存协议或单节点retry变化前：第四批；
- 新节点/模板类型前：第五批；
- 账号删除、用户生命周期、任务表或领域schema变化前：第六批；
- v0.6.28正式发布前已执行第七批只读追踪，确认现行safe runner、Git archive、fresh build、冻结备份与原子切换路径可用；下一次正式发布仍需重新触发和核对。

这些批次不得遗忘或绕过，也不得在没有触发时为了“完成架构”提前施工。

## 6. 红线

- 受保护JSON禁止读取、提交、删除、改名、覆盖或格式化；
- 禁止默认`npm run verify`；
- 测试只用新临时数据目录和动态loopback端口；
- 禁止4173、`app/data`、`/var/lib/unboundry`、真实媒体、真实密钥；
- 禁止真实Provider、付费生成和OSS请求，除非新Goal明确授权且验收无法由fake证明；
- 禁止SSH、生产读取或修改，除非新Goal明确授权对应阶段；
- 禁止reset、clean、强制checkout或覆盖用户改动；
- 未明确授权不得commit、push、PR、合并、tag、发布或部署；
- 自动测试、Agent验收、生产技术验收和USER PASS必须保持区别；
- 不得复用旧Goal、旧发布授权或历史会话授权。

## 7. 新Session第一个动作

```bash
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

随后确认当前HEAD是否为本批本地交付提交、工作树除受保护JSON外是否干净，并将Node/npm切换到package约束。不要自动开始第三至第七批；第一、第二批若要发布、推送或继续USER验收，必须获得新的明确授权。

## 8. 续接规则

- 第一、第二批Goal完成后授权均已失效；
- 第三至第七批必须等待各自触发条件和新的明确Goal；
- 正常的代码、测试、文档、版本、Git和授权交付动作按Goal提示词执行；
- 只有身份冲突、用户改动重叠、数据风险、真实外部调用状态未知、重复付费风险或无法安全回滚的真实阻断才停；
- 任务困难、耗时或测试失败不是自动停下询问的理由，应先自行诊断、修复和重跑最小相关测试；
- Goal完成后，旧授权立即失效；后续触发批次需要新的Goal。
