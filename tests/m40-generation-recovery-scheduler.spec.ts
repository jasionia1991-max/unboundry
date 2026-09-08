import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import { createGenerationTaskStore, type GenerationTask } from "../server/generationTaskStore";
import { deferAutomaticRecoveryCheck, listRecoveryTaskIds, originalRecoveryWindow, automaticRecoveryCheckpoint, claimAutomaticRecoveryCheck } from "../server/generationRecoveryTaskQueries";
import { recoverGenerationTasksAtStartupForRuntimeTest, runGenerationRecoverySweep } from "../server/generationTasks";

test("automatic lookup keeps original attempt deadline and persists exponential backoff across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-original-check-"));
  const tasks = createGenerationTaskStore(directory); const db = openAppDatabase(directory);
  try {
    const now = Date.now(); const started = new Date(now - 90 * 60_000).toISOString();
    db.prepare(`INSERT OR IGNORE INTO users(id,login_name,display_name,password_hash,role,status,protected,created_at,updated_at)
      VALUES('recovery-owner','recovery-owner','Synthetic','none','user','active',0,?,?)`).run(started, started);
    const task = tasks.create({ canvasId: "case-canvas", nodeId: "video", idempotencyKey: "original-budget",
      ownerId: "recovery-owner", kind: "video", prompt: "Synthetic",
      modelConfiguration: { providerProtocol: "media-generate", providerDriver: "multi-protocol-relay" }, providerProfileId: "fake-provider", providerModelId: "fake-model" }).task;
    tasks.transition(task.id, "running");
    db.prepare(`INSERT INTO generation_provider_attempts(task_id,execution_attempt,provider_profile_id,provider_model_id,
      kind,evidence,created_at,owner_id,credential_revision,outcome)
      VALUES (?,1,'fake-provider','fake-model','video','provider-boundary',?,'recovery-owner',0,'outcome-unknown')`).run(task.id, started);
    tasks.transition(task.id, "recovering", { code: "AUTOMATIC_RESULT_RECOVERY", message: "原请求" });
    db.prepare("UPDATE generation_provider_attempts SET created_at = ? WHERE task_id = ?").run(started, task.id);
    const before = tasks.get(task.id)!;
    const window = originalRecoveryWindow(db, task.id)!;
    expect(window.attemptStartedAt).toBe(started); expect(window.providerWindowMs).toBe(75 * 60_000);
    const input = { taskId: task.id, ownerId: "recovery-owner", executionAttempt: 1, now };
    const one = claimAutomaticRecoveryCheck(db, input)!;
    expect(one.count).toBe(1); expect(Date.parse(one.nextCheckAt) - now).toBe(30_000);
    expect(claimAutomaticRecoveryCheck(db, input)).toBeUndefined();
    const reopened = openAppDatabase(directory);
    try {
      expect(claimAutomaticRecoveryCheck(reopened, { ...input, now: now + 29_999 })).toBeUndefined();
      const two = claimAutomaticRecoveryCheck(reopened, { ...input, now: now + 30_000 })!;
      expect(two.count).toBe(2); expect(Date.parse(two.nextCheckAt) - now).toBe(90_000);
      deferAutomaticRecoveryCheck(reopened, { ...input, check: two, retryAfterSeconds: 120 });
      const delayed = automaticRecoveryCheckpoint(reopened, task.id, 1)!;
      expect(delayed.count).toBe(2); expect(Date.parse(delayed.nextCheckAt)).toBeGreaterThanOrEqual(now + 120_000);
      deferAutomaticRecoveryCheck(reopened, { ...input, check: two, retryAfterSeconds: 1 });
      expect(automaticRecoveryCheckpoint(reopened, task.id, 1)?.nextCheckAt).toBe(delayed.nextCheckAt);
      expect(originalRecoveryWindow(reopened, task.id)).toEqual(window);
    } finally { reopened.close(); }
    expect(tasks.get(task.id)?.updatedAt).toBe(before.updatedAt);
    expect(tasks.get(task.id)?.attempt).toBe(1);
    const malformed = { ...one, lastCheckedAt: new Date(now + 20_000).toISOString(),
      nextCheckAt: new Date(now + 10_000).toISOString(), leaseUntil: new Date(now + 30_000).toISOString() };
    db.prepare(`INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at)
      VALUES(?,'recovering','RECOVERY_AUTOMATIC_CHECK_V1',?,?)`)
      .run(task.id, JSON.stringify(malformed), malformed.lastCheckedAt);
    expect(() => automaticRecoveryCheckpoint(db, task.id, 1)).toThrow("checkpoint is damaged");
    db.prepare(`DELETE FROM generation_task_events
      WHERE task_id = ? AND error_code = 'RECOVERY_AUTOMATIC_CHECK_V1' AND error_message = ?`)
      .run(task.id, JSON.stringify(malformed));
    expect(claimAutomaticRecoveryCheck(db, { ...input, now: Date.parse(window.automaticDeadlineAt) })).toBeUndefined();
    db.prepare("DELETE FROM generation_provider_attempts WHERE task_id = ?").run(task.id);
    expect(originalRecoveryWindow(db, task.id)).toBeUndefined();
    expect(claimAutomaticRecoveryCheck(db, { ...input, now: now + 1_000_000 })).toBeUndefined();
  } finally { db.close(); tasks.close(); await rm(directory, { recursive: true, force: true }); }
});

test("recovery task pagination covers more than two hundred incidents without new paid attempts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-original-pages-"));
  const tasks = createGenerationTaskStore(directory); const db = openAppDatabase(directory);
  try {
    const ids = new Set<string>();
    for (let i = 0; i < 241; i++) {
      const task = tasks.create({ canvasId: "pagination", nodeId: `node-${i}`, idempotencyKey: `recovery-page-${i}`,
        kind: (["text", "image", "video", "audio"] as const)[i % 4], prompt: "Synthetic" }).task;
      tasks.transition(task.id, "running"); tasks.transition(task.id, "recovering", { code: "AUTOMATIC_RESULT_RECOVERY", message: "待核对" });
      ids.add(task.id);
    }
    const first = listRecoveryTaskIds(db, "", 200); const second = listRecoveryTaskIds(db, first.at(-1)!, 200);
    expect(first).toHaveLength(200); expect(second).toHaveLength(41);
    expect(new Set([...first, ...second])).toEqual(ids);
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM generation_provider_attempts").get() as { count: number }).count)).toBe(0);
  } finally { db.close(); tasks.close(); await rm(directory, { recursive: true, force: true }); }
});

test("original-only recovery cannot fall into generic resume, startup or sweep execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-original-fence-"));
  const tasks = createGenerationTaskStore(directory); const db = openAppDatabase(directory);
  try {
    const task = tasks.create({ canvasId: "original-only", nodeId: "video", idempotencyKey: "original-only",
      kind: "video", prompt: "Synthetic", providerProfileId: "fake-provider", providerModelId: "fake-model" }).task;
    tasks.transition(task.id, "running"); tasks.recordProviderAttempt(task.id);
    tasks.setProviderTaskId(task.id, "original-provider-id");
    tasks.transition(task.id, "recovering", { code: "AUTOMATIC_RESULT_RECOVERY", message: "原请求" });
    const marker = { version: 1, marker: "original-only", taskId: task.id, executionAttempt: 1,
      ownerId: "__test__", caseId: "synthetic-case", operationId: "synthetic-command" };
    db.prepare(`INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at) VALUES(?,'recovering','RECOVERY_ORIGINAL_ONLY_V1',?,?)`)
      .run(task.id, JSON.stringify(marker), new Date().toISOString());
    const launches: string[] = [];
    expect(tasks.hasOriginalRecoveryOnly(task.id)).toBe(true);
    expect(() => tasks.resume(task.id)).toThrow("Original-only");
    recoverGenerationTasksAtStartupForRuntimeTest({ store: tasks, launch: (id) => launches.push(id) });
    await runGenerationRecoverySweep({ store: tasks, launch: (id) => launches.push(id) });
    expect(launches).toEqual([]); expect(tasks.get(task.id)?.attempt).toBe(1);
    db.prepare("UPDATE generation_task_events SET error_message = 'broken' WHERE error_code = 'RECOVERY_ORIGINAL_ONLY_V1'").run();
    expect(tasks.hasOriginalRecoveryOnly(task.id)).toBe(true);
    expect(() => tasks.resume(task.id)).toThrow("Original-only");
  } finally { db.close(); tasks.close(); await rm(directory, { recursive: true, force: true }); }
});

test("actual sweep fairly visits 241 unknown requests with four reads in flight while ordinary tasks launch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-recovery-fairness-"));
  const tasks = createGenerationTaskStore(directory); const db = openAppDatabase(directory);
  const previous = process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED;
  process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED = "1";
  try {
    const started = new Date(Date.now() - 90 * 60_000).toISOString();
    db.prepare(`INSERT INTO users(id,login_name,display_name,password_hash,role,status,created_at,updated_at)
      VALUES('fair-owner','fair-owner','Synthetic','none','user','active',?,?)`).run(started, started);
    const ids = new Set<string>();
    for (let i = 0; i < 241; i++) {
      const task = tasks.create({ canvasId: "fair-canvas", nodeId: `video-${i}`, idempotencyKey: `fair-original-${i}`,
        ownerId: "fair-owner", kind: "video", prompt: "Synthetic", providerProfileId: "fake-provider", providerModelId: "fake-model",
        modelConfiguration: { providerProtocol: "media-generate", providerDriver: "multi-protocol-relay" } }).task;
      tasks.transition(task.id, "running");
      db.prepare(`INSERT INTO generation_provider_attempts(task_id,execution_attempt,provider_profile_id,provider_model_id,
        kind,evidence,created_at,owner_id,credential_revision,outcome)
        VALUES (?,1,'fake-provider','fake-model','video','provider-boundary',?,'fair-owner',0,'outcome-unknown')`).run(task.id, started);
      tasks.transition(task.id, "recovering", { code: "AUTOMATIC_RESULT_RECOVERY", message: "原请求" }); ids.add(task.id);
    }
    const ordinary = tasks.create({ canvasId: "fair-canvas", nodeId: "normal-text", idempotencyKey: "ordinary-text",
      kind: "text", prompt: "Synthetic" }).task;
    db.prepare("UPDATE generation_tasks SET updated_at = ? WHERE id = ?").run(started, ordinary.id);
    const seen = new Set<string>(); let inFlight = 0; let maximum = 0; let ordinaryLaunched = false;
    const options = { store: tasks, launch: (id: string) => { if (id === ordinary.id) ordinaryLaunched = true; },
      match: async (task: GenerationTask) => {
        expect(ordinaryLaunched).toBe(true); seen.add(task.id); inFlight++; maximum = Math.max(maximum, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2)); inFlight--;
        return { status: "many" as const };
      } };
    for (let i = 0; i < 32; i++) await runGenerationRecoverySweep(options);
    expect(seen).toEqual(ids); expect(maximum).toBe(4); expect(inFlight).toBe(0);
    expect(tasks.get(ordinary.id)?.attempt).toBe(ordinary.attempt);
    expect((db.prepare("SELECT COUNT(*) AS n FROM generation_provider_attempts").get() as { n: number }).n).toBe(241);
    expect(tasks.listRecovering()).toHaveLength(241);
    expect((db.prepare("SELECT COUNT(*) AS n FROM generation_task_events WHERE error_code = 'RECOVERY_CASE_V1'").get() as { n: number }).n).toBe(241);
  } finally {
    if (previous === undefined) delete process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED;
    else process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED = previous;
    db.close(); tasks.close(); await rm(directory, { recursive: true, force: true });
  }
});
