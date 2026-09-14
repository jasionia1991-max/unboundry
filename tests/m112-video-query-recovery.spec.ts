import { expect, test } from "./safe-test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "../server/database";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import { generationDiagnosticSourceErrorCode, recoverGenerationTasksAtStartupForRuntimeTest } from "../server/generationTasks";
import { defaultModelReleaseDocument } from "../server/modelReleaseDefaults";
import { inspectModelReleaseDocument } from "../server/modelReleaseRevisionStore";
import { knownModelParameterSchema } from "../types/modelParameters";
import { compileFrozenWorkflowSemanticPlan } from "../types/workflowSemanticPlan";
import { originalRecoveryWindow } from "../server/generationRecoveryTaskQueries";

// These tests start from an accepted task snapshot and exercise the durable
// recovery boundary. The acceptance worker scenario owns POST/query/publication
// integration; a seeded snapshot is not evidence of that lifecycle.
async function withAcceptedWorkflow(work: (fixture: {
  directory: string;
  database: ReturnType<typeof openAppDatabase>;
  store: ReturnType<typeof createGenerationTaskStore>;
  taskId: string;
  configuration: Record<string, unknown>;
}) => Promise<void> | void) {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-m112-recovery-"));
  const database = openAppDatabase(directory);
  const store = createGenerationTaskStore(directory, { recoverRunning: false });
  try {
    const profileId = "m112-profile";
    const modelId = "m112-model";
    const providerModelId = "grok-imagine-video-1.5-preview";
    const capabilitySchema = knownModelParameterSchema({
      capability: "video", providerDriver: "multi-protocol-relay", providerModelId,
    });
    const document = defaultModelReleaseDocument({
      capability: "video", capabilitySchema, modelId,
      providerDriver: "multi-protocol-relay", providerModelId,
      providerProfileId: profileId, providerProtocol: "media-generate",
    });
    const proof = inspectModelReleaseDocument(document);
    const revision = {
      createdAt: "2026-09-01T00:00:00.000Z", document,
      hash: proof.documentHash, modelId,
      revisionId: "00000000-0000-4000-8112-000000000001", revisionNumber: 1,
      validation: { compilerHash: proof.compilerHash,
        impact: { incompatibleTemplateIds: [], templateIds: [] }, paidProviderRequests: 0,
        preview: { modes: [] }, validatedAt: "2026-09-01T00:00:00.000Z" },
    };
    const graph = {
      groupId: "m112-group", edges: [],
      nodes: [
        { id: "m112-group", type: "group", data: {} },
        { id: "m112-video", type: "video", parentId: "m112-group", data: {
          videoModelId: modelId, videoPrompt: "local recovery evidence",
          videoPromptReady: true, videoParameters: {},
        } },
      ],
    };
    const semantic = compileFrozenWorkflowSemanticPlan(graph);
    const planNode = { ...semantic.nodes[0]!, modelId,
      modelConfigurationRevision: "m112-config", modelReleaseRevision: revision,
      providerDriver: "multi-protocol-relay", providerProfileId: profileId,
      providerModelId, providerProtocol: "media-generate",
      costCurrency: "USD", recoveryGrade: "TASK_ID_QUERY", recoveryEvidence: "test" };
    const plan = { ...semantic, version: 1, externalNodes: [], nodes: [planNode],
      clientSemanticFingerprint: semantic.semanticFingerprint };
    const configuration: Record<string, unknown> = {
      credentialVersion: 1, modelCapability: "video", modelId,
      modelExecutionAdapterId: "relay-media", providerDriver: "multi-protocol-relay",
      providerProfileId: profileId, providerModelId, providerProtocol: "media-generate",
      modelConfigurationRevision: "m112-config", modelReleaseRevision: revision,
      modelInputContractFingerprint: "m112-input-contract",
    };
    const created = store.create({
      canvasId: "m112-canvas", nodeId: "m112-video", kind: "video", model: modelId,
      modelConfiguration: configuration, parameters: {}, prompt: "local recovery evidence",
      idempotencyKey: "m112-idempotency", ownerId: "__test__",
      credentialRevision: 1, providerModelId, providerProfileId: profileId,
    }).task;
    store.transition(created.id, "running");
    store.recordProviderAttempt(created.id);
    store.setProviderTaskId(created.id, "m112-original-remote-id");
    const timestamp = new Date().toISOString();
    configuration.generationIdentityVersion = 2;
    configuration.generationInputKey = "m112-input";
    configuration.generationOwnershipKey = "m112-ownership";
    configuration.workflowBinding = {
      runId: "m112-run", groupId: graph.groupId, reservationId: "00000000-0000-4000-8112-000000000002",
      generationInputKey: configuration.generationInputKey,
      generationOwnershipKey: configuration.generationOwnershipKey,
      modelConfigurationRevision: "m112-config", modelReleaseRevision: revision.revisionId,
    };
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`INSERT OR IGNORE INTO users
        (id, login_name, display_name, password_hash, role, status, created_at, updated_at)
        VALUES ('__test__','__test__','local','safe','user','active',?,?)`).run(timestamp,timestamp);
      database.prepare(`INSERT INTO canvas_documents
        (owner_id,id,revision,graph_revision,nodes,edges,viewport,updated_at,save_sequence)
        VALUES ('__test__','m112-canvas',1,1,?,'[]','{"x":0,"y":0,"zoom":1}',?,0)`)
        .run(JSON.stringify(graph.nodes),timestamp);
      database.prepare(`INSERT INTO workflow_runs
        (id,owner_id,canvas_id,group_id,graph_revision,semantic_fingerprint,plan_json,state,
         stop_requested,reservation_id,created_at,updated_at)
        VALUES ('m112-run','__test__','m112-canvas','m112-group',1,?,?,'running',0,
          '00000000-0000-4000-8112-000000000002',?,?)`).run(semantic.semanticFingerprint,JSON.stringify(plan),timestamp,timestamp);
      database.prepare(`INSERT INTO workflow_run_nodes
        (run_id,owner_id,node_id,kind,plan_index,dependencies_json,semantic_identity,
         idempotency_key,state,task_id,projection_state,created_at,updated_at)
        VALUES ('m112-run','__test__','m112-video','video',0,'[]',?,'m112-idempotency',
          'admitted',?,'pending',?,?)`).run(planNode.semanticIdentity,created.id,timestamp,timestamp);
      database.prepare(`INSERT INTO workflow_run_locks
        (owner_id,canvas_id,node_id,run_id,created_at)
        VALUES ('__test__','m112-canvas','m112-video','m112-run',?)`).run(timestamp);
      database.prepare(`INSERT INTO media_capacity_reservations
        (id,owner_id,workflow_run_id,reserved_bytes,state,expires_at,created_at,updated_at)
        VALUES ('00000000-0000-4000-8112-000000000002','__test__','m112-run',1024,'active',?,?,?)`)
        .run(new Date(Date.now()+7*86400000).toISOString(),timestamp,timestamp);
      database.prepare("UPDATE generation_tasks SET model_configuration = ? WHERE id = ?")
        .run(JSON.stringify(configuration),created.id);
      database.exec("COMMIT");
    } catch(error) { database.exec("ROLLBACK"); throw error; }
    store.transition(created.id, "recovering", { code: "AUTOMATIC_RESULT_RECOVERY", message: "recovering" });
    await work({ directory, database, store, taskId: created.id, configuration });
  } finally { store.close(); database.close(); await rm(directory,{recursive:true,force:true}); }
}

test("M112 original Provider clock governs expiry across restart and cancellation", async () => {
  await withAcceptedWorkflow(({ directory, database, store, taskId }) => {
    expect(store.isEligibleActiveWorkflowVideo(taskId)).toBe(true);
    const original = store.get(taskId)!;
    database.prepare("UPDATE generation_provider_attempts SET created_at = ? WHERE task_id = ?")
      .run("2026-01-01T00:00:00.000Z",taskId);
    const expired = store.markRecoveryWindowExhaustedIfDue(taskId,new Date("2026-01-03T00:00:00.000Z"));
    expect(expired).toMatchObject({ attempt:1, state:"recovering",
      providerTaskId:"m112-original-remote-id",errorCode:"AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED" });
    expect(expired?.createdAt).toBe(original.createdAt);
    const events = store.listEvents(taskId);
    store.markRecoveryWindowExhaustedIfDue(taskId,new Date("2026-01-04T00:00:00.000Z"));
    expect(store.listEvents(taskId)).toEqual(events);
    expect(store.claimRecovering(taskId,expired!.updatedAt,new Date("2026-01-04T00:00:00.000Z"))).toBeUndefined();
    expect(store.resume(taskId)).toBeUndefined();
    const restarted = createGenerationTaskStore(directory,{recoverRunning:false});
    try {
      const launched: string[]=[];
      recoverGenerationTasksAtStartupForRuntimeTest({store:restarted,launch:id=>launched.push(id)});
      expect(launched).toEqual([]);
      expect(restarted.getProviderAttemptForTask(taskId)).toMatchObject({executionAttempt:1,
        outcome:"accepted",providerTaskId:"m112-original-remote-id"});
    } finally { restarted.close(); }
    store.transition(taskId,"cancelled",{code:"USER_ABANDONED",message:"cancelled"});
    const cancelledEvents = store.listEvents(taskId);
    store.markRecoveryWindowExhaustedIfDue(taskId,new Date("2026-01-05T00:00:00.000Z"));
    expect(store.get(taskId)?.state).toBe("cancelled");
    expect(store.listEvents(taskId)).toEqual(cancelledEvents);
  });
});

test("M112 absent attempt timing stops durably without buying a new query window", async () => {
  await withAcceptedWorkflow(({database,store,taskId})=>{
    database.prepare("UPDATE generation_provider_attempts SET created_at = 'bad-time' WHERE task_id = ?").run(taskId);
    expect(originalRecoveryWindow(database,taskId)).toBeUndefined();
    expect(store.markRecoveryWindowExhaustedIfDue(taskId)).toMatchObject({
      state:"recovering",errorCode:"AUTOMATIC_RECOVERY_PENDING",attempt:1,
    });
    expect(store.isAutomaticRecoveryStopped(taskId)).toBe(true);
    expect(store.resume(taskId)).toBeUndefined();
    const before=store.listEvents(taskId);
    store.markRecoveryWindowExhaustedIfDue(taskId);
    expect(store.listEvents(taskId)).toEqual(before);
  });
});

test("M112 recovery claim is fenced and keeps original attempt and Provider identity", async () => {
  await withAcceptedWorkflow(({database,store,taskId})=>{
    const current=store.get(taskId)!;
    const clock=Date.parse(current.updatedAt)+1000;
    const claimed=store.claimRecovering(taskId,current.updatedAt,new Date(clock));
    expect(claimed).toMatchObject({state:"recovering",attempt:1,providerTaskId:current.providerTaskId});
    expect(store.claimRecovering(taskId,current.updatedAt,new Date(clock))).toBeUndefined();
    expect(store.claimRecovering(taskId,claimed!.updatedAt,new Date(clock+1000))).toBeUndefined();
    expect(database.prepare("SELECT COUNT(*) AS n FROM generation_provider_attempts WHERE task_id = ?").get(taskId)).toEqual({n:1});
    expect(store.resume(taskId)).toMatchObject({state:"running",attempt:1,providerTaskId:current.providerTaskId});
  });
});

test("M112 stopped workflow and mismatched ownership cannot enter the candidate recovery policy", async () => {
  await withAcceptedWorkflow(({database,store,taskId,configuration})=>{
    database.prepare("UPDATE workflow_runs SET stop_requested = 1 WHERE id = 'm112-run'").run();
    expect(store.isEligibleActiveWorkflowVideo(taskId)).toBe(false);
    database.prepare("UPDATE workflow_runs SET stop_requested = 0 WHERE id = 'm112-run'").run();
    database.prepare("UPDATE generation_tasks SET model_configuration = ? WHERE id = ?")
      .run(JSON.stringify({...configuration,workflowBinding:{...(configuration.workflowBinding as object),runId:"other-run"}}),taskId);
    expect(store.isEligibleActiveWorkflowVideo(taskId)).toBe(false);
    expect(store.markRecoveryWindowExhaustedIfDue(taskId,new Date("2027-01-01T00:00:00.000Z"))).toBeUndefined();
  });
});

test("M112 recovery diagnostics retain safe source codes without leaking arbitrary error data", () => {
  for (const code of ["EACCES", "EPERM", "PROVIDER_CONFIGURATION_MISMATCH", "PROVIDER_LOCK_BUSY"]) {
    expect(generationDiagnosticSourceErrorCode(Object.assign(new Error("secret path or response"), { code }))).toBe(code);
  }
  for (const code of ["sk-private-token", "https://private.invalid/?token=secret", "UNRECOGNIZED_SECRET_VALUE", 123]) {
    expect(generationDiagnosticSourceErrorCode(Object.assign(new Error("secret"), { code }))).toBeNull();
  }
  expect(generationDiagnosticSourceErrorCode(new Error("EACCES secret response"))).toBeNull();
});
