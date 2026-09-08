import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import { openGenerationRecoveryCaseStore } from "../server/generationRecoveryCaseStore";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const syntheticCaseTime = "2026-01-01T00:00:00.000Z";
async function start(directory: string, enabled = true, bypass = false) {
  const output: string[] = [];
  const processHandle = spawn(process.execPath,
    [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
      env: { ...process.env, UNBOUNDRY_DATA_DIR: directory,
        UNBOUNDRY_TEST_AUTH_BYPASS: bypass ? "1" : undefined,
        UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED: enabled ? "1" : "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  processHandle.stdout?.on("data", (chunk) => output.push(String(chunk)));
  processHandle.stderr?.on("data", (chunk) => output.push(String(chunk)));
  for (let i = 0; i < 100; i++) {
    if (processHandle.exitCode !== null) break;
    try { if ((await fetch(`${origin}/api/auth/status`)).ok) return processHandle; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  processHandle.kill("SIGTERM");
  throw new Error(`Recovery HTTP server did not start: ${output.join("").slice(-3000)}`);
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM"); await stopped;
}
function cookie(response: Response) { return response.headers.get("set-cookie")?.split(";")[0] ?? ""; }
function request(path: string, session = "", body?: unknown, headers: Record<string, string> = {}) {
  return fetch(origin + path, { method: body === undefined ? "GET" : "POST",
    headers: { ...(session ? { Cookie: session } : {}), ...(body === undefined ? {} : {
      "Content-Type": "application/json", "X-Unboundry-Recovery-Command": "v1", Origin: origin,
    }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function bootstrap() {
  const result = await request("/api/auth/bootstrap", "", {
    displayName: "维护验收管理员", loginName: "recovery-admin", password: "synthetic-admin-pass-123",
  });
  expect(result.status).toBe(201); return cookie(result);
}

function seedRecoveryCase(directory: string, ownerId: string, suffix: string) {
  const tasks = createGenerationTaskStore(directory, { recoverRunning: false });
  const task = tasks.create({
    canvasId: `recovery-http-canvas-${suffix}`,
    idempotencyKey: `recovery-http-key-${suffix}`,
    kind: "video",
    model: "recovery-http-model",
    nodeId: `recovery-http-node-${suffix}`,
    ownerId,
    parameters: { safeFixture: true },
    prompt: "safe recovery HTTP fixture",
    providerModelId: "recovery-http-provider-model",
    providerProfileId: "recovery-http-provider",
  }).task;
  tasks.close();

  const database = openAppDatabase(directory);
  try {
    database.prepare(`
      UPDATE generation_tasks
      SET state = 'failed', attempt = 1,
          error_code = 'OUTCOME_UNKNOWN_BILLING_RISK',
          created_at = ?, updated_at = ?
      WHERE id = ?
    `).run(syntheticCaseTime, syntheticCaseTime, task.id);
    database.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, created_at, owner_id, credential_revision, outcome
      ) VALUES (?, 1, ?, ?, 'video', 'provider-boundary', ?, ?, 0, 'outcome-unknown')
    `).run(
      task.id,
      "recovery-http-provider",
      "recovery-http-provider-model",
      syntheticCaseTime,
      ownerId,
    );
  } finally { database.close(); }

  const recovery = openGenerationRecoveryCaseStore(directory, { enabled: true });
  try {
    return {
      taskId: task.id,
      case: recovery.ensureCase({
        taskId: task.id,
        ownerId,
        executionAttempt: 1,
        reason: "outcome_unknown",
        operationId: `recovery-http-open-${suffix}`,
        now: syntheticCaseTime,
      }),
    };
  } finally { recovery.closeDatabase(); }
}

test("recovery HTTP keeps admin role, session, origin and strict command boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-recovery-http-"));
  let child: ChildProcess | undefined;
  try {
    child = await start(directory);
    expect((await request("/api/admin/generation-recovery")).status).toBe(401);
    const admin = await bootstrap();
    const created = await request("/api/admin/users", admin, {
      displayName: "普通验收账号", loginName: "recovery-user", password: "synthetic-user-pass-123",
    });
    expect(created.status).toBe(201);
    const ownerId = (await created.json()).user.id as string;
    const userLogin = await request("/api/auth/login", "", { loginName: "recovery-user", password: "synthetic-user-pass-123" });
    expect(userLogin.status).toBe(200); const user = cookie(userLogin);
    const permissions = await request(`/api/admin/users/${ownerId}/permissions`, admin);
    expect(permissions.status).toBe(200);
    const permissionBody = await permissions.json() as {
      defaultPermissions: string[]; effectivePermissions: string[]; extraPermissions: string[];
    };
    const expectedDefaultPermissions = ["manage_projects", "generate", "group_download", "manage_own_templates", "manage_own_credentials"];
    expect(permissionBody.defaultPermissions).toEqual(expectedDefaultPermissions);
    expect(permissionBody.effectivePermissions).toEqual(expectedDefaultPermissions);
    expect(permissionBody.extraPermissions).toEqual([]);
    expect((await request("/api/admin/generation-recovery", user)).status).toBe(403);
    const grant = await fetch(`${origin}/api/admin/users/${ownerId}/permissions`, {
      method: "PUT", headers: { Cookie: admin, "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ extraPermissions: ["manage_generation_safety"] }),
    });
    expect(grant.ok).toBe(true);
    expect((await request("/api/admin/generation-recovery", user)).status).toBe(403);
    const list = await request("/api/admin/generation-recovery", admin);
    expect(list.status).toBe(200); expect(await list.json()).toMatchObject({ enabled: true, cases: [] });
    expect((await request("/api/admin/generation-recovery?after=", admin)).status).toBe(200);
    expect((await request("/api/admin/generation-recovery?after=invalid-cursor", admin)).status).toBe(400);
    const command = { commandId: "test-command", expectedCaseEventId: 1 };
    expect((await request("/api/admin/generation-recovery/missing/claim", admin, command, { Origin: "https://other.invalid" })).status).toBe(403);
    expect((await request("/api/admin/generation-recovery/missing/claim", admin, command, { "X-Unboundry-Recovery-Command": "" })).status).toBe(403);
    for (const forged of [{ providerTaskId: "injected" }, { evidenceSha256: "a".repeat(64) },
      { resultUrl: "https://other.invalid/result.mp4" }, { ownerId }, { feeDisposition: "refunded" }]) {
      const response = await request("/api/admin/generation-recovery/missing/claim", admin, { ...command, ...forged });
      expect(response.status).toBe(400); expect(await response.text()).not.toContain("https://");
    }
    expect((await request("/api/admin/generation-recovery/missing/progress", admin, { ...command, phase: "ready_for_user" })).status).toBe(400);
    const otherCreated = await request("/api/admin/users", admin, {
      displayName: "另一普通验收账号", loginName: "recovery-other", password: "synthetic-other-pass-123",
    });
    expect(otherCreated.status).toBe(201);
    const otherLogin = await request("/api/auth/login", "", { loginName: "recovery-other", password: "synthetic-other-pass-123" });
    expect(otherLogin.status).toBe(200); const other = cookie(otherLogin);
    const fixture = seedRecoveryCase(directory, ownerId, "http");
    const regularTasks = createGenerationTaskStore(directory, { recoverRunning: false });
    const regular = regularTasks.create({ canvasId: "healthy-recovery-http-canvas", nodeId: "healthy-node",
      kind: "text", ownerId, model: "fixture-model", prompt: "normal task without maintenance",
      parameters: {}, idempotencyKey: "healthy-http-no-maintenance" }).task;
    regularTasks.close();
    const mixedList = await request(`/api/generation-recovery?taskIds=${regular.id},${fixture.taskId}`, user);
    expect(mixedList.status).toBe(200);
    expect((await mixedList.json()).cases).toHaveLength(1);
    const ownerList = await request(`/api/generation-recovery?taskIds=${fixture.taskId}`, user);
    expect(ownerList.status).toBe(200);
    const ownerListBody = await ownerList.json() as { enabled: boolean; cases: Array<Record<string, unknown>> };
    expect(ownerListBody.enabled).toBe(true); expect(ownerListBody.cases).toHaveLength(1);
    const opened = ownerListBody.cases[0];
    expect(opened.taskId).toBe(fixture.taskId); expect(opened.caseId).toBe(fixture.case.caseId);
    expect(opened.phase).toBe("queued"); expect(opened.progressVersion).toBe(0);
    const adminCases = await request("/api/admin/generation-recovery?limit=100", admin);
    expect(adminCases.status).toBe(200);
    const adminCasesBody = await adminCases.json() as { cases: Array<Record<string, unknown>> };
    expect(adminCasesBody.cases.some((item) => item.taskId === fixture.taskId)).toBe(true);
    const otherList = await request(`/api/generation-recovery?taskIds=${fixture.taskId}`, other);
    expect(otherList.status).toBe(200); expect((await otherList.json()).cases).toEqual([]);
    const otherDetail = await request(`/api/generation-recovery/${fixture.taskId}`, other);
    expect(otherDetail.status).toBe(200); expect((await otherDetail.json()).case).toBeNull();

    const frozenClaim = await request(`/api/admin/generation-recovery/${fixture.taskId}/claim`, admin, {
      commandId: "http-frozen-claim", expectedCaseEventId: opened.caseEventId,
    });
    expect(frozenClaim.status).toBe(503);
    expect(await frozenClaim.json()).toMatchObject({ code: "RECOVERY_FROZEN" });
    const syntheticDatabase = openAppDatabase(directory);
    try { syntheticDatabase.prepare("UPDATE generation_safety_settings SET global_enabled = 1 WHERE id = 1").run(); }
    finally { syntheticDatabase.close(); }
    const claim = await request(`/api/admin/generation-recovery/${fixture.taskId}/claim`, admin, {
      commandId: "http-claim", expectedCaseEventId: opened.caseEventId,
    });
    expect(claim.status).toBe(200);
    const claimed = (await claim.json() as { case: Record<string, unknown> }).case;
    expect(claimed.phase).toBe("claimed");
    expect(typeof claimed.claimLeaseUntil).toBe("string");
    expect(Date.parse(String(claimed.claimLeaseUntil))).toBeGreaterThan(Date.now());
    const progress = await request(`/api/admin/generation-recovery/${fixture.taskId}/progress`, admin, {
      commandId: "http-progress", expectedCaseEventId: claimed.caseEventId, phase: "waiting_provider",
    });
    expect(progress.status).toBe(200);
    const progressed = (await progress.json() as { case: Record<string, unknown> }).case;
    expect(progressed.phase).toBe("waiting_provider"); expect(progressed.progressVersion).toBe(Number(claimed.progressVersion) + 1);
    expect(progressed.unread).toBe(true);
    const read = await request(`/api/generation-recovery/${fixture.taskId}/read`, user, {
      commandId: "http-read", expectedCaseEventId: progressed.caseEventId, progressVersion: progressed.progressVersion,
    });
    expect(read.status).toBe(200);
    const readCase = (await read.json() as { case: Record<string, unknown> }).case;
    expect(readCase.progressVersion).toBe(progressed.progressVersion); expect(readCase.unread).toBe(false);
    expect(readCase.claimLeaseUntil).toBeUndefined();
    const staleRead = await request(`/api/generation-recovery/${fixture.taskId}/read`, user, {
      commandId: "http-stale-read", expectedCaseEventId: progressed.caseEventId, progressVersion: 1,
    });
    expect(staleRead.status).toBe(409); expect((await staleRead.json()).code).toBe("RECOVERY_CONFLICT");
    expect((await request("/api/generation-recovery/missing/claim", user, command)).status).toBe(404);
    const unknown = await request("/api/generation-recovery/missing", user);
    expect(unknown.status).toBe(200); expect(await unknown.json()).toMatchObject({ case: null });
    const tooMany = Array.from({ length: 51 }, (_, i) => `task-${i}`).join(",");
    expect((await request(`/api/generation-recovery?taskIds=${tooMany}`, user)).status).toBe(400);
    for (const permission of ["manage_accounts", "manage_permissions", "manage_generation_recovery"]) {
      const elevate = await fetch(`${origin}/api/admin/users/${ownerId}/permissions`, {
        method: "PUT", headers: { Cookie: admin, "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ extraPermissions: [permission] }),
      });
      expect(elevate.status).toBe(400);
    }
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});

test("disabled recovery leaves ordinary permissions and generation status available", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-recovery-off-http-"));
  let child: ChildProcess | undefined;
  try {
    child = await start(directory, false); const admin = await bootstrap();
    for (const path of ["/api/generation-recovery?taskIds=missing", "/api/admin/generation-recovery"]) {
      const result = await request(path, admin);
      expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ enabled: false, cases: [] });
    }
    const change = await request("/api/admin/generation-recovery/missing/claim", admin,
      { commandId: "off-command", expectedCaseEventId: 1 });
    expect(change.status).toBe(503); expect(await change.json()).toMatchObject({ code: "RECOVERY_DISABLED" });
    expect((await request("/api/generation-tasks/status", admin)).ok).toBe(true);
    expect((await request("/api/auth/status", admin)).ok).toBe(true);
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});

test("recovery endpoints refuse the legacy test identity bypass", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-recovery-bypass-http-"));
  let child: ChildProcess | undefined;
  try {
    child = await start(directory, true, true);
    for (const path of ["/api/generation-recovery", "/api/admin/generation-recovery"]) {
      const result = await request(path); expect(result.status).toBe(401);
      expect(await result.json()).toMatchObject({ code: "RECOVERY_SESSION_REQUIRED" });
    }
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});
