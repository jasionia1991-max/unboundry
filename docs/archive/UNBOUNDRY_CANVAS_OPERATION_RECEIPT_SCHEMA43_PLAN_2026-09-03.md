# Unboundry Canvas Operation Receipt schema 43 迁移、备份与回滚附件

状态：`V0_7_8_PUBLISHED_NOT_DEPLOYED / V0_7_9_PRODUCTION_PREFLIGHT_DELTA_R9_PASS_R10_READY`

日期：2026-09-03

目标版本：`v0.7.9`（v0.7.8 保留为已发布未部署历史版本）

依赖方案：`spec/UNBOUNDRY_CANVAS_DOCUMENT_WRITE_BOUNDARY_DECOUPLING_PLAN_2026-09-03.md`

## 1. 决策

schema 42 不足以实现 Canvas typed command 的 durable operation receipt。现有 `canvas_save_session_high_water` 是 SQLite 连接级 TEMP table，进程重启后丢失；`saveAttemptId` 只作为当前 writer/TEMP high-water 元数据；`workflow_run_nodes.projection_state` 与节点内 legacy marker 不能表达每个 command 的原始 payload hash、原始 outcome、request ID 与 revision 。

因此追加 schema 43，不改写 schema 42，不批量重写现有 Canvas/task/media 数据。

## 2. 新增物理合同

新增 `canvas_operation_receipts`：

```sql
CREATE TABLE canvas_operation_receipts (
  owner_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64
    AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  command_type TEXT NOT NULL CHECK (command_type IN (
    'canvas.create',
    'node.user-field.change',
    'topology.change',
    'layout.change',
    'upload.adopt',
    'edited-result.adopt',
    'server.projection',
    'legacy.put',
    'legacy.terminal-detach',
    'document.migration'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('browser', 'server', 'legacy')),
  save_session_id TEXT CHECK (
    save_session_id IS NULL OR length(save_session_id) BETWEEN 8 AND 80
  ),
  save_sequence INTEGER CHECK (save_sequence IS NULL OR save_sequence > 0),
  baseline_kind TEXT NOT NULL CHECK (baseline_kind IN ('create', 'existing')),
  base_document_revision INTEGER CHECK (
    base_document_revision IS NULL OR base_document_revision >= 0
  ),
  base_input_revision INTEGER CHECK (
    base_input_revision IS NULL OR base_input_revision >= 0
  ),
  baseline_load_token_sha256 TEXT CHECK (
    baseline_load_token_sha256 IS NULL OR (
      length(baseline_load_token_sha256) = 64
      AND baseline_load_token_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  baseline_epoch TEXT CHECK (
    baseline_epoch IS NULL OR length(baseline_epoch) BETWEEN 1 AND 128
  ),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('APPLIED', 'NO_OP', 'REJECTED_CONFLICT')
  ),
  conflict_code TEXT CHECK (
    conflict_code IS NULL OR length(conflict_code) BETWEEN 1 AND 100
  ),
  http_status INTEGER NOT NULL CHECK (http_status IN (200, 409)),
  original_request_id TEXT NOT NULL CHECK (
    length(original_request_id) BETWEEN 8 AND 128
  ),
  result_document_revision INTEGER NOT NULL CHECK (result_document_revision >= 0),
  result_input_revision INTEGER NOT NULL CHECK (result_input_revision >= 0),
  result_document_sha256 TEXT NOT NULL CHECK (
    length(result_document_sha256) = 64
    AND result_document_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  result_input_sha256 TEXT NOT NULL CHECK (
    length(result_input_sha256) = 64
    AND result_input_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  affected_subgraph_sha256 TEXT CHECK (
    affected_subgraph_sha256 IS NULL OR (
      length(affected_subgraph_sha256) = 64
      AND affected_subgraph_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  changed_paths TEXT NOT NULL DEFAULT '[]' CHECK (
    length(changed_paths) <= 32768
    AND json_valid(changed_paths) AND json_type(changed_paths) = 'array'
  ),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  settled_at TEXT NOT NULL CHECK (length(settled_at) BETWEEN 20 AND 40),
  CHECK (length(canvas_id) BETWEEN 1 AND 200),
  CHECK (length(operation_id) BETWEEN 8 AND 200),
  CHECK (
    (actor_type = 'browser' AND save_session_id IS NOT NULL AND save_sequence IS NOT NULL)
    OR (actor_type = 'server' AND save_session_id IS NULL AND save_sequence IS NULL)
    OR (actor_type = 'legacy' AND (
      (save_session_id IS NULL AND save_sequence IS NULL)
      OR (save_session_id IS NOT NULL AND save_sequence IS NOT NULL)
    ))
  ),
  CHECK (
    (command_type = 'canvas.create'
      AND actor_type = 'browser' AND baseline_kind = 'create')
    OR (command_type IN (
        'node.user-field.change', 'topology.change', 'layout.change',
        'upload.adopt', 'edited-result.adopt'
      ) AND actor_type = 'browser' AND baseline_kind = 'existing')
    OR (command_type IN ('server.projection', 'document.migration')
      AND actor_type = 'server' AND baseline_kind = 'existing')
    OR (command_type = 'legacy.put'
      AND actor_type = 'legacy' AND baseline_kind = 'existing'
      AND save_session_id IS NOT NULL AND save_sequence IS NOT NULL
      AND operation_id GLOB 'legacy-save:*')
    OR (command_type = 'legacy.terminal-detach'
      AND actor_type = 'legacy' AND baseline_kind = 'existing')
  ),
  CHECK (
    (baseline_kind = 'create'
      AND base_document_revision IS NULL
      AND base_input_revision IS NULL
      AND baseline_load_token_sha256 IS NULL
      AND baseline_epoch IS NULL)
    OR (baseline_kind = 'existing'
      AND base_document_revision IS NOT NULL
      AND base_input_revision IS NOT NULL
      AND baseline_load_token_sha256 IS NOT NULL
      AND baseline_epoch IS NOT NULL)
  ),
  CHECK (
    (outcome IN ('APPLIED', 'NO_OP')
      AND http_status = 200 AND conflict_code IS NULL)
    OR (outcome = 'REJECTED_CONFLICT'
      AND http_status = 409 AND conflict_code IS NOT NULL)
  ),
  PRIMARY KEY (owner_id, canvas_id, operation_id),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, canvas_id)
    REFERENCES canvas_documents(owner_id, id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX canvas_operation_receipts_owner_created
  ON canvas_operation_receipts (owner_id, canvas_id, created_at DESC);
```

### 2.1 不变量

- `(owner_id, canvas_id, operation_id)` 唯一且不可变；身份只来自认证与 route path。
- receipt 不存 prompt、secret、signed URL 或整份 Canvas document，只存 canonical SHA-256、受控 path 名与结果元数据。
- `baseline_kind=create` 时 document/input revision、load-token digest 与 epoch 全为 null；`existing` 时四项全部非 null。browser receipt 保存已验证浏览器 token 的 digest/epoch；server/legacy 内部命令保存同一事务内读取的 server-observed current-load-token digest/epoch，不伪造浏览器观测。
- `command_type`、`actor_type` 与 `baseline_kind` 由表级 CHECK 绑定：公开 typed command 只能是 browser；`server.projection`/`document.migration` 只能是 server existing；legacy command 只能是 legacy existing。无 capability 的旧 PUT（包括 create）在观察窗内沿用旧响应且不创建 durable receipt；它不能进入此表。
- browser receipt 的 save session/sequence 必须同时非 null，server 必须同时为 null，legacy 只允许两者同时存在或同时缺失。
- capability `legacy.put` 只有在 header 精确等于 `legacy-put-v1` 且 `saveSessionId/saveSequence/saveAttemptId` 完整合法时才能进入 gateway；adapter 在 high-water 检查前按 length-prefixed canonical tuple 派生 `legacy-save:<sha256(owner,canvas,session,sequence,attempt)>`，把完整 tuple 纳入 payload hash，并将 session/sequence 落表。SQL 同时要求其 `legacy-save:` 前缀与 non-null session/sequence；缺任一项返回 `CANVAS_LEGACY_WRITE_IDENTITY_INVALID` 且不写 receipt。
- `APPLIED`/`NO_OP` 回放为 HTTP 200；`REJECTED_CONFLICT` 回放保持原 HTTP 409 与原 code。相同 operationId 另一 payload 稳定返回 `CANVAS_OPERATION_REUSED`，不改原 receipt。
- receipt lookup、Canvas 读取、command 重放、revision 决策、Canvas 写入与 receipt 写入在同一 `BEGIN IMMEDIATE` 事务。内部 projection 复用调用方已有事务，gateway 不自行 commit。
- 只有 document fingerprint 变化才更新 Canvas row 并使 document revision `+1`；只有 input fingerprint 变化才使 graph/input revision `+1`；两者都不变则 Canvas row 与 `updated_at` 不动。
- outcome、HTTP status、conflict code 为 SQL 约束的一个联合状态机：成功/no-op 只能 200 且 code 为 null；冲突只能 409 且必须有 code。
- project/account/Canvas 删除沿用原事务与 FK cascade，同时删除对应 receipt；普通上线不删任何历史 receipt。

### 2.2 单节点生成投影状态

实施中确认 `canvas_operation_receipts` 只保存已结算 command outcome，不能把一次投影异常伪装成 receipt；而现代单节点生成又需要在 task 已成功、Canvas 投影回滚后跨连接和重启保留可重试的 `failed` 事实。因此 migration 43 同时新增只服务于现代单节点任务的 `generation_canvas_projection_states`：

```sql
CREATE TABLE generation_canvas_projection_states (
  task_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  operation_id TEXT CHECK (
    operation_id IS NULL OR length(operation_id) BETWEEN 8 AND 200
  ),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'applied', 'conflict', 'failed')
  ),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_error_class TEXT CHECK (
    last_error_class IS NULL OR last_error_class IN ('B', 'D')
  ),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 20 AND 40),
  CHECK (
    (state = 'failed' AND failure_count > 0 AND last_error_class IS NOT NULL)
    OR (state IN ('pending', 'applied', 'conflict')
      AND last_error_class IS NULL)
  ),
  CHECK (state IN ('pending', 'failed') OR operation_id IS NOT NULL),
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, canvas_id)
    REFERENCES canvas_documents(owner_id, id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX generation_canvas_projection_states_owner_state
  ON generation_canvas_projection_states (owner_id, state, updated_at DESC);
```

该表不替代 workflow 的 `workflow_run_nodes.projection_state`，也不改变 generation task 终态。约束如下：

- 只记录 generation identity v2 且没有 workflow binding 的现代单节点 task；workflow 继续使用既有 node projection state。
- task/result/publication 成功先保持 durable；Canvas mutation、operation receipt 和投影状态成功结算位于同一投影 savepoint。该 savepoint 失败时三者中的 Canvas/receipt 写整体回滚，但 task success 不被降级。
- 投影异常在外层 task 事务内另行 upsert 为 `failed`，递增 `failure_count` 并记录受控 server class `B` 或 `D`；不得记录 prompt、URL、secret 或任意异常正文。
- `applied`/`conflict` 必须带 operation ID，并把 failure count/error class 清零；已结算状态不再进入 retry census。
- restart sweep 只选择状态缺失、`pending` 或 `failed` 的成功 task；receipt/proof replay 保证同一结果最多形成一次实际 Canvas revision 变化，不触发 Provider。
- task、account 或 Canvas 的精确删除通过 FK cascade 同步删除状态；普通上线和观察期不做 GC。

## 3. 迁移策略

1. 在 `server/database.ts` 的 append-only ledger 中新增 migration 43 `durable-canvas-operation-receipts`，一次建立 receipt 与单节点 projection-state 两组表/index 合同。
2. migration 只执行 `CREATE TABLE`/`CREATE INDEX`，不读取或改写 Canvas JSON，不发出 Provider/OSS 请求。
3. 增加 exact `currentSchemaContract` 列表、table SQL hash、index SQL hash和 schema42 向后读取合同。
4. 新增 one-shot `42 -> 43` 迁移入口；只接受 exact schema42 source，迁移事务失败必须整体 rollback。`server/schemaMigration.ts` 的历史 37->39 通道显式固定 target 39；`server/schema41To42Migration.ts` 显式固定 target 42；两者不得因 `currentSchemaVersion=43` 穿透执行新 migration。
5. 生产不由常驻进程偷跑 migration；先停 writer/拿排他锁，执行 exact backup 与 fresh restore，再由 one-shot 服务迁移，结束后重启 schema43 主服务。

## 4. 备份、恢复与 downlevel

- `BackupSchemaVersion` 追加 43；current capture purpose 改为 `current-schema43`；仍允许 37..42 历史恢复包验证。同步更新 `scripts/backup-data.mjs`、`scripts/report-media-integrity.mjs`、`server/backupInspection.ts`和发布 final-candidate schema 断言，不只更新 `server/backupPackage.ts`。
- 上线前，在生产 writer 冻结与 Provider quiet-window 下生成 locked-exact schema42 backup，验证签名、DB logical SHA-256、media 完整性，并恢复到新临时目录。
- 迁移后再生成 locked-exact schema43 backup，同样 verify + fresh restore。两份 backup ID 都写入发布回执。
- 回滚不执行 `DROP TABLE`、不伪造 `user_version=42`、不反向破坏数据。previous v0.7.7 可通过恢复上线前 exact schema42 backup 回退；若 schema43 期间已有新写，保留 schema43 DB，仅在独立故障计划下决定数据处理，不用本发布脚本自动降级。
- forward -> previous -> forward 演练在恢复副本/候选 release 目录中完成；正式数据的最终原子切换只在证据齐全后执行。

## 5. 兼容性与 retention

- schema43 代码可读既有 schema42 Canvas/task/media 行；迁移不要求批量变形。
- schema42 中不存在单节点 projection-state 行；升级后由成功 task 的 bounded retry census 按需建立，不批量改写 task 或 Canvas。
- 常驻 v0.7.8 进程对 schema42 保持 standby/fail-closed，只有 one-shot migration 能进行升级。
- v0.7.7 必须在 schema43 database 上因 `user_version`/exact physical contract 不匹配而 fail-closed，禁止启动 writer；独立测试覆盖这一 downlevel 行为。它的唯一安全回退介质是上线前 schema42 exact backup。
- v0.7.8 观察期不自动 GC receipt。它们随 exact project/account/Canvas 删除的 FK 生命周期清理。新 operation 的 hard capacity 为每 Canvas 50,000、每 owner 250,000；超限时在 Canvas mutation 前 fail-closed 返回 503 `CANVAS_OPERATION_RECEIPT_CAPACITY`，不删除旧 receipt、不降级为无 receipt 写入。相同 operation replay 不受容量门影响。未来如需时间保留策略，必须先证明不会破坏延迟回放再另案实施。
- `document.migration` 只能是 server 命令；`operation_id` 固定由 `canvas-migration:<migrationId>:<oldDocumentSha256>` 计算，必须带旧文档版本/指纹前置，目标版本和 stable migration application ID。相同目标指纹为 NO_OP；退役条件是对象 census 无待迁移项、current build producer=0、回滚点和独立 Review 齐全。

## 6. 必须验证

- exact schema42 -> 43 成功；非 exact source、重复 migration、DDL 故障全部 fail-closed/rollback。
- greenfield schema43 与 migrated schema43 通过同一 manifest/physical SQL hash/foreign-key/integrity 合同。
- receipt 的 nullable create baseline、CHECK、owner 级联、project 级删除、同 operationId 约束和事务 rollback。
- schema42 历史 backup 可验证/恢复；schema43 exact backup 可验证/恢复；包内 schema 编号与实际 DB 必须一致。
- 相同 payload replay 在 response loss、新 DB connection 与进程重启后不第二次增 revision；异 payload 不改原 receipt。
- Canvas write 成功但 receipt insert 故障，receipt 成功但 Canvas write 故障，都必须整体 rollback。
- 新 operationId 但语义同值的 command 为 NO_OP，只落 receipt/high-water，Canvas row、updated_at、两类 revision 全不动；单独验证 layout-only、viewport-only、server-projection-only、input-only 的 document/input revision 转移。
- 并发 create 只一个 APPLIED，其他各自写入稳定 `CANVAS_ALREADY_EXISTS` conflict receipt；测试 server projection gateway 复用调用方事务并与 projection_state 共同 rollback。
- payload mismatch 稳定从原 receipt 推导 `CANVAS_OPERATION_REUSED`，且在同事务追加不含 payload/prompt/URL 的 security audit event；原 receipt 不改。
- 容量门覆盖 per-canvas/per-owner 边界、replay 例外、删除释放与超限前无 Canvas 半写。
- DATA-005 覆盖不同 save session 对不同 user-owned path 的 rebase、同 path 受控覆盖及 server-owned 字段保留；same-session high-water 覆盖低/同 sequence 拒绝、跨 connection/重启不回退，以及 create 不被残留 high-water 拒绝。
- legacy capability 测试覆盖 header/三元组缺失时无 receipt、canonical 派生 operation ID、同 tuple+同 payload replay、同 tuple+异 payload 409，以及 high-water 前 receipt lookup；无 capability PUT create 保持表外兼容且不能生成 receipt。
- v0.7.7 进程面对 schema43 database 必须 standby/fail-closed，且只能借助上线前 exact schema42 backup 回滚。
- 单节点 projection savepoint 在 Canvas 已更新且 receipt 已插入之后发生故障时，Canvas 与 receipt 必须同时回滚，task 保持 success，状态 durable 为 `failed`；关闭并重开数据库后仍可见，下一次 sweep 只重试原投影且不重发 Provider。成功后状态为 `applied`、receipt 恰好一条，后续 sweep 为 0 candidate。

## 7. Review 门

独立 reviewer 必须逐项审查 table/constraint、migration、backup/restore、downlevel、retention 和测试覆盖，并给出 `P0/P1/P2`。只有 `P0=0 / P1=0`（P2 已有 owner/处置）才能解除 runtime implementation stop。

2026-09-04 独立 Review 共四轮修订加最终确认：最终 `P0=0 / P1=0 / P2=0`。确认 schema/actor/baseline 联合约束、server-observed token proof、DATA-005/high-water、capacity error、downlevel fail-closed，以及 legacy capability 唯一 operation identity 均与主 Plan 一致；runtime implementation stop 已解除。

实现已落入 schema 43 migration、exact schema contract、42→43 one-shot migration、backup/restore/downlevel gates 与单节点 projection service。定向证据：`tests/m91-schema-migration.spec.ts` 覆盖 migration/physical contract/backup/downlevel；`tests/m103-server-authoritative-workflow.spec.ts` 12/12 覆盖 workflow projection savepoint fault/retry；`tests/m104-canvas-command-gateway.spec.ts` 9/9 覆盖单节点 durable failed state、restart、单次 retry 和 receipt no-op。上述只代表定向验证；候选冻结后的唯一 formal full、发布与生产迁移仍未执行。

## 8. 生产 preflight 修订（2026-09-05）

v0.7.8 发布后、生产切换前的只读 census 发现：active task/run/publication/capacity 全 0，但 schema42 合法保留 23 条 failed/cancelled 终态 task 的 Provider boundary 历史证据。原 `assertQuiescentSource` 只按 attempt outcome 计数，会要求删除或改写这些计费/恢复记录才能迁移，与本附件“历史证据原样保留”以及 Goal 禁止清理历史数据冲突。

v0.7.9 修订为：执行静默由 active task、active workflow run、active publication、active capacity 与 generation freeze 共同证明；terminal task 的 accepted、response-received、outcome-unknown attempt 是永久 billing/recovery evidence，不是 live work。42→43 migration 只追加 DDL，既不 settlement 这些行，也不触发 Provider。新增测试用 production-shaped 三条历史行证明 dry-run 不写 source、apply 后全部字段相同；五个 active/freeze 门原样保留。该 delta 必须独立 Review 和变更后 formal full 后才能发布。

首轮增量 Review 的 `P2=2 / NO_GO` 已转为直接回归：历史 fixture 扩展为 failed/cancelled task 的 accepted、response-received、outcome-unknown，并比较 `generation_provider_attempts` 全部字段；active task、active workflow run、active publication、active capacity 与 generation-unfrozen 五个 schema42 门均验证精确 fail-closed、source bytes 不变及 schema42 不变。m91 当前 `12/12 PASS`；同一 Reviewer 已确认原两项 P2 和文档同步 P2 全部关闭，最终 `P0=0 / P1=0 / P2=0 / GO`。变更后 formal full 为 `127` specs、`1229/1229 PASS`、0 failed、0 skipped、exit `0`，source/snapshot SHA-256 `3b1fcd369e292c272183e3db7ee8316a38f700b96847f83e0370d2a0ebcbb9ea`，4173 listener unchanged；R9 已通过并进入 R10。
