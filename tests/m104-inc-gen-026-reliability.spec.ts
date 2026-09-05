import { createServer as createHttpServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import {
  openAppDatabase,
  setDuringCurrentDatabaseOpenForTests,
} from "../server/database";
import {
  generationInputKey,
  generationOwnershipEvidence,
  generationOwnershipKey,
} from "../types/generationIdentity";
import {
  createGenerationTaskStore,
  GenerationTaskWorkflowLockedError,
} from "../server/generationTaskStore";
import {
  generationTaskApplication,
  recoverGenerationTasksAtStartupForRuntimeTest,
  runGenerationRecoverySweep,
} from "../server/generationTasks";
import { bootstrapPublishedModelContracts } from
  "../server/modelReleaseBootstrap";
import {
  compileFrozenWorkflowSemanticPlan,
  workflowSemanticDigest,
} from
  "../types/workflowSemanticPlan";
import {
  parseImmutableWorkflowPlan,
  parseWorkflowRunsEnvelope,
  WorkflowPlanValidationError,
} from "../types/workflowRuns";
import {
  getWorkflowRun,
  listWorkflowRuns,
  runFairWorkflowBatch,
  runWorkflowSweep,
  settleWorkflowAdmissionFailureForRuntimeTest,
  workflowSweepCoordinatorForRuntimeTest,
} from "../server/workflowRunService";
import { buildAuthoritativeGenerationModelConfiguration } from
  "../server/authoritativeGenerationModelConfiguration";
import {
  AliyunOssPublicationQuarantineError,
  aliyunOssGenerationIdentityHeaders,
  uploadPrivateAliyunOssObject,
  type AliyunOssGenerationObjectIdentity,
  type AliyunOssUrllib,
} from "../server/aliyunOss";
import {
  classifyGenerationProviderOutcome,
  generationOutcomeAdapterIds,
} from "../server/generationProviderOutcome";
import { defaultModelReleaseDocument } from "../server/modelReleaseDefaults";
import { inspectModelReleaseDocument } from
  "../server/modelReleaseRevisionStore";
import { registeredModelExecution } from "../server/modelExecutionRegistry";
import { knownModelParameterSchema } from "../types/modelParameters";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";
import {
  activeServerWorkflowNodeIds,
  createServerWorkflowRun,
  getServerWorkflowRun,
  listServerWorkflowRuns,
  mergeServerWorkflowRuns,
  parseServerWorkflowRunUpdatedEventDetail,
  reattachSubmittedServerWorkflowRun,
  stopServerWorkflowRunAndConfirm,
  waitForServerWorkflowRun,
  workflowRunCreateOutcomeIsUncertain,
  workflowRunStatusReadIsRetryable,
} from "../client/src/generation/workflowRuns";

const appPort = Number(process.env.UNBOUNDRY_TEST_PORT);
const executeFile = promisify(execFile);
const providerPort = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const appOrigin = `http://127.0.0.1:${appPort}`;
const providerOrigin = `http://127.0.0.1:${providerPort}`;
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function stableFixtureValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableFixtureValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableFixtureValue(child)]));
  }
  return value;
}

function fixtureFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableFixtureValue(value)))
    .digest("hex");
}

const safetySettings = {
  audioConcurrency: 1,
  cooldownMinutes: 30,
  emergencyStop: false,
  failureThreshold: 3,
  globalEnabled: true,
  imageConcurrency: 1,
  perUserConcurrency: 1,
  requestsPerMinute: 10,
  runningTaskPolicy: "wait",
  textConcurrency: 1,
  videoConcurrency: 1,
};

function authoritativeBuilderInputs() {
  const fixtures = [
    {
      kind: "text",
      providerDriver: "volcengine-ark",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProtocol: "native",
    },
    {
      kind: "image",
      providerDriver: "multi-protocol-relay",
      providerModelId: "tt-image-2",
      providerProtocol: "media-generate",
    },
    {
      kind: "video",
      providerDriver: "volcengine-ark",
      providerModelId: "doubao-seedance-2-0-mini-260615",
      providerProtocol: "native",
    },
    {
      kind: "audio",
      providerDriver: "mureka",
      providerModelId: "mureka-9",
      providerProtocol: "native",
    },
  ] as const;
  return fixtures.map((fixture, index) => {
    const modelId = `inc-gen-026-${fixture.kind}-model`;
    const providerProfileId = `inc-gen-026-${fixture.kind}-provider`;
    const parameterSchema = knownModelParameterSchema({
      capability: fixture.kind,
      providerDriver: fixture.providerDriver,
      providerModelId: fixture.providerModelId,
    });
    const document = defaultModelReleaseDocument({
      capability: fixture.kind,
      capabilitySchema: parameterSchema,
      modelId,
      providerDriver: fixture.providerDriver,
      providerModelId: fixture.providerModelId,
      providerProfileId,
      providerProtocol: fixture.providerProtocol,
    });
    const proof = inspectModelReleaseDocument(document);
    const revision: ModelReleaseRevision = Object.freeze({
      createdAt: "2026-09-01T00:00:00.000Z",
      document,
      hash: proof.documentHash,
      modelId,
      revisionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      revisionNumber: 1,
      validation: Object.freeze({
        compilerHash: proof.compilerHash,
        impact: Object.freeze({
          incompatibleTemplateIds: Object.freeze([]),
          templateIds: Object.freeze([]),
        }),
        paidProviderRequests: 0,
        preview: Object.freeze({ modes: Object.freeze([]) }),
        validatedAt: "2026-09-01T00:00:00.000Z",
      }),
    });
    const execution = registeredModelExecution({
      capability: fixture.kind,
      providerDriver: fixture.providerDriver,
      providerModelId: fixture.providerModelId,
      providerProtocol: fixture.providerProtocol,
    });
    if (!execution) throw new Error("INC-GEN-026 fixture adapter is missing");
    return {
      credentialVersion: 1,
      fixtureScopeId: "inc-gen-026-safe-fixture",
      generationInputKey: `inc-gen-026-${fixture.kind}-input`,
      generationOwnershipKey: `inc-gen-026-${fixture.kind}-ownership`,
      modelCapability: fixture.kind,
      modelConfigurationRevision: `inc-gen-026-${fixture.kind}-configuration`,
      modelExecutionAdapterId: execution.adapterId,
      modelId,
      modelInputContractFingerprint: `inc-gen-026-${fixture.kind}-contract`,
      modelReleaseRevision: revision,
      modelResultCount: execution.resultCount,
      parameterSchema,
      providerConfigurationVersion: 1,
      providerDriver: fixture.providerDriver,
      providerModelId: fixture.providerModelId,
      providerProfileId,
      providerProtocol: fixture.providerProtocol,
    };
  });
}

test("INC-GEN-026 authoritative builder is opaque, complete, and exact for four media", () => {
  const inputs = authoritativeBuilderInputs();
  for (const input of inputs) {
    const configuration = buildAuthoritativeGenerationModelConfiguration(input);
    expect(configuration).toMatchObject({
      generationIdentityVersion: 2,
      modelCapability: input.modelCapability,
      modelId: input.modelId,
      modelReleaseRevision: input.modelReleaseRevision,
      providerDriver: input.providerDriver,
      providerModelId: input.providerModelId,
      providerProfileId: input.providerProfileId,
    });
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.modelReleaseRevision.document)).toBe(true);
    expect(Object.isFrozen(configuration.parameterSchema.fields)).toBe(true);
  }
  const { modelId: _modelId, ...missingModelId } = inputs[0];
  if (false) {
    // @ts-expect-error The opaque builder contract requires nested modelId.
    buildAuthoritativeGenerationModelConfiguration(missingModelId);
  }
  expect(() => Reflect.apply(
    buildAuthoritativeGenerationModelConfiguration,
    undefined,
    [missingModelId],
  )).toThrow("Authoritative generation model configuration is invalid");
  expect(() => buildAuthoritativeGenerationModelConfiguration({
    ...inputs[0],
    modelExecutionAdapterId: "relay-media",
  })).toThrow();
  expect(() => buildAuthoritativeGenerationModelConfiguration({
    ...inputs[0],
    generationInputKey: "",
  })).toThrow("Authoritative generation model configuration is invalid");
});

test("INC-GEN-026 one pure outcome table governs all six adapters and isolates legacy Canvas repair", async () => {
  expect(generationOutcomeAdapterIds).toEqual([
    "ark-text",
    "ark-video",
    "mureka-audio",
    "openrouter-image",
    "relay-gpt-image",
    "relay-media",
  ]);
  for (const adapterId of generationOutcomeAdapterIds) {
    const base = {
      adapterId,
      publication: { state: "none" as const },
      task: {
        providerTaskId: "provider-task-1",
        state: "recovering" as const,
      },
    };
    expect(classifyGenerationProviderOutcome({
      ...base,
      attempt: {
        outcome: "accepted",
        providerTaskId: "provider-task-1",
      },
      observation: { kind: "none" },
    })).toEqual({
      action: "inspect-original-task",
      providerTaskId: "provider-task-1",
    });
    expect(classifyGenerationProviderOutcome({
      ...base,
      attempt: { outcome: "accepted" },
      observation: {
        failureCode: "PROVIDER_FAILED",
        kind: "provider-terminal-failed",
        providerTaskId: "provider-task-1",
      },
    })).toEqual({
      action: "settle-terminal-failure",
      failureCode: "PROVIDER_FAILED",
    });
    expect(classifyGenerationProviderOutcome({
      ...base,
      attempt: {
        failureCode: "PROVIDER_FAILED",
        finishedAt: "2026-09-01T00:00:00.000Z",
        outcome: "provider-failed",
        providerTaskId: "provider-task-1",
      },
      observation: { kind: "provider-running", providerTaskId: "provider-task-1" },
    })).toEqual({ action: "no-new-fact" });
    expect(classifyGenerationProviderOutcome({
      ...base,
      attempt: {
        failureCode: "ORIGINAL_TERMINAL",
        finishedAt: "2026-09-01T00:00:00.000Z",
        outcome: "provider-failed",
        providerTaskId: "provider-task-1",
      },
      observation: {
        failureCode: "STALE_LATER_FAILURE",
        kind: "provider-terminal-failed",
        providerTaskId: "provider-task-1",
      },
    })).toEqual({ action: "no-new-fact" });
    expect(classifyGenerationProviderOutcome({
      ...base,
      observation: { kind: "none" },
      publication: { state: "pending" },
    })).toEqual({ action: "recover-publication" });
    expect(classifyGenerationProviderOutcome({
      ...base,
      observation: { kind: "billing-unknown" },
    })).toEqual({ action: "preserve-billing-unknown" });
    expect(classifyGenerationProviderOutcome({
      ...base,
      observation: { kind: "evidence-conflict", reason: "tuple mismatch" },
    })).toEqual({
      action: "quarantine-operator-incident",
      reason: "tuple mismatch",
    });
  }
  expect(classifyGenerationProviderOutcome({
    adapterId: "removed-adapter",
    observation: { kind: "none" },
    publication: { state: "pending" },
    task: { state: "recovering" },
  })).toEqual({ action: "recover-publication" });
  expect(classifyGenerationProviderOutcome({
    adapterId: "ark-text",
    attempt: {
      failureCode: "STALE_TERMINAL",
      finishedAt: "2026-09-01T00:00:00.000Z",
      outcome: "provider-failed",
    },
    observation: { kind: "provider-succeeded" },
    publication: { state: "published" },
    task: { state: "recovering" },
  })).toEqual({ action: "commit-provider-success" });
  const legacySource = await readFile(
    "server/canvasLegacyGenerationReconciliation.ts",
    "utf8",
  );
  expect(legacySource).not.toContain("generationProviderOutcome");
  expect(legacySource).not.toContain("runGenerationRecoverySweep");
});

test("INC-GEN-026 generated OSS exact HEAD adopts while mismatch quarantines without PUT or DELETE", async () => {
  const identity: AliyunOssGenerationObjectIdentity = {
    byteSize: 4,
    checksumSha256: "a".repeat(64),
    contentType: "image/png",
    executionAttempt: 1,
    format: "png",
    kind: "image",
    objectKey: "objects/2026/09/image/inc-gen-026.png",
    ownerId: "inc-gen-026-owner",
    publicationId: "inc-gen-026-publication",
    storageProfileId: "inc-gen-026-storage-profile",
    taskId: "inc-gen-026-task",
  };
  const credentials = {
    accessKeyId: "inc-gen-026-access-key",
    accessKeySecret: "inc-gen-026-secret-key",
    bucket: "inc-gen-026-private-bucket",
    endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    region: "oss-cn-hangzhou",
  };
  const resolver = (async () => [{
    address: "93.184.216.34",
    family: 4 as const,
  }]) as never;
  const run = async (taskId: string) => {
    const methods: string[] = [];
    const transport: AliyunOssUrllib = {
      async request(_url, options = {}) {
        const method = String(options.method ?? "GET").toUpperCase();
        methods.push(method);
        const headers = {
          "content-length": String(identity.byteSize),
          "content-type": identity.contentType,
          ...aliyunOssGenerationIdentityHeaders({ ...identity, taskId }),
          etag: "inc-gen-026-etag",
          "x-oss-request-id": "inc-gen-026-request",
        };
        return {
          data: Buffer.alloc(0),
          headers,
          res: { headers } as never,
          status: 200,
        };
      },
    };
    const action = uploadPrivateAliyunOssObject({
      byteSize: identity.byteSize,
      bytes: Buffer.from("data"),
      checksumSha256: identity.checksumSha256,
      contentType: identity.contentType,
      credentials,
      generationIdentity: identity,
      network: { resolver, urllib: transport },
      objectKey: identity.objectKey,
    });
    return { action, methods };
  };
  const exact = await run(identity.taskId);
  await expect(exact.action).resolves.toMatchObject({ status: "adopted" });
  expect(exact.methods).toEqual(["HEAD"]);
  const mismatch = await run("different-task");
  await expect(mismatch.action).rejects.toBeInstanceOf(
    AliyunOssPublicationQuarantineError,
  );
  expect(mismatch.methods).toEqual(["HEAD"]);
});

test("INC-GEN-026 persisted plan is recursively immutable and fair scheduling isolates slow or damaged runs", async () => {
  const model = authoritativeBuilderInputs()[0];
  const plan = parseImmutableWorkflowPlan({
    clientSemanticFingerprint: "wf1-plan-client",
    edges: [],
    executableNodeIds: ["text-node"],
    externalNodes: [],
    groupId: "group",
    nodes: [{
      costCurrency: "CNY",
      dependencies: [],
      id: "text-node",
      kind: "text",
      modelConfigurationRevision: model.modelConfigurationRevision,
      modelId: model.modelId,
      modelReleaseRevision: model.modelReleaseRevision,
      ownPrompt: "write",
      parameters: { outputCount: 1 },
      planIndex: 0,
      providerDriver: model.providerDriver,
      providerModelId: model.providerModelId,
      providerProfileId: model.providerProfileId,
      providerProtocol: model.providerProtocol,
      recoveryEvidence: "durable stored response retrieval and billing fence evidence",
      recoveryGrade: "STORED_RESPONSE_OR_FENCED_UNKNOWN",
      semanticIdentity: "wf1-text-node",
    }],
    semanticFingerprint: "wf1-plan",
    version: 1,
  });
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan.nodes)).toBe(true);
  expect(Object.isFrozen(plan.nodes[0]?.parameters)).toBe(true);
  expect(Object.isFrozen(plan.nodes[0]?.modelReleaseRevision.document)).toBe(true);
  expect(() => parseImmutableWorkflowPlan({
    ...plan,
    nodes: [{ ...plan.nodes[0], dependencies: ["missing-node"] }],
  })).toThrow(WorkflowPlanValidationError);
  expect(() => parseImmutableWorkflowPlan({
    ...plan,
    nodes: [{
      ...plan.nodes[0],
      modelReleaseRevision: {
        ...plan.nodes[0]?.modelReleaseRevision,
        document: {
          ...plan.nodes[0]?.modelReleaseRevision.document,
          executionContract: {},
        },
      },
    }],
  })).toThrow(WorkflowPlanValidationError);

  const semanticNodes = [{ id: "group", type: "group" }, {
    data: { content: "first" }, id: "source-a", type: "text",
  }, {
    data: { content: "second" }, id: "source-b", type: "text",
  }, {
    data: {
      imageModelId: "image-model",
      imagePrompt: "compose",
      imagePromptReady: true,
    },
    id: "image-node",
    parentId: "group",
    type: "image",
  }];
  const semanticEdges = [{ id: "edge-b", source: "source-b", target: "image-node" }, {
    id: "edge-a", source: "source-a", target: "image-node",
  }];
  const semanticA = compileFrozenWorkflowSemanticPlan({
    edges: semanticEdges,
    groupId: "group",
    nodes: semanticNodes,
  });
  const semanticB = compileFrozenWorkflowSemanticPlan({
    edges: [...semanticEdges].reverse(),
    groupId: "group",
    nodes: semanticNodes,
  });
  expect(semanticB.semanticFingerprint).toBe(semanticA.semanticFingerprint);
  expect(() => compileFrozenWorkflowSemanticPlan({
    edges: [...semanticEdges, {
      id: "edge-unknown",
      source: "missing",
      target: "image-node",
    }],
    groupId: "group",
    nodes: semanticNodes,
  })).toThrow();
  const validWorkflowRun = {
    canvasId: "canvas",
    clientSemanticFingerprint: "wf1-client",
    createdAt: "2026-09-01T00:00:00.000Z",
    groupId: "group",
    id: "run",
    lockedNodeIds: ["image-node"],
    nodes: [{
      id: "image-node",
      kind: "image",
      projectionState: "applied",
      state: "success",
    }],
    semanticFingerprint: "wf1-authoritative",
    state: "success",
    updatedAt: "2026-09-01T00:00:01.000Z",
  };
  const parsedWorkflowRuns = parseWorkflowRunsEnvelope({
    runs: [validWorkflowRun],
  });
  expect(parsedWorkflowRuns.runs[0]).toMatchObject({
    canvasId: "canvas",
    id: "run",
    state: "success",
  });
  expect(Object.isFrozen(parsedWorkflowRuns.runs[0])).toBe(true);
  expect(() => parseWorkflowRunsEnvelope(null)).toThrow();
  expect(() => parseWorkflowRunsEnvelope({ runs: [{
    ...validWorkflowRun,
    nodes: [{ ...validWorkflowRun.nodes[0], projectionState: "unknown" }],
  }] })).toThrow();
  expect(() => parseWorkflowRunsEnvelope({ runs: [{
    ...validWorkflowRun,
    errorCode: null,
  }] })).toThrow();
  expect(() => parseWorkflowRunsEnvelope({ runs: [{
    ...validWorkflowRun,
    nodes: [{ ...validWorkflowRun.nodes[0], taskId: 42 }],
  }] })).toThrow();
  expect(() => parseWorkflowRunsEnvelope({ runs: [{
    ...validWorkflowRun,
    createdAt: "not-a-timestamp",
  }] })).toThrow();
  expect(() => parseWorkflowRunsEnvelope({ runs: [{
    ...validWorkflowRun,
    unexpected: true,
  }] })).toThrow();

  let releaseSlow!: () => void;
  const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
  const started: string[] = [];
  const batch = runFairWorkflowBatch(
    ["slow", "broken", "fast"],
    async (id) => {
      started.push(id);
      if (id === "slow") await slow;
      if (id === "broken") throw new Error("injected damaged run");
    },
    2,
  );
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(started).toContain("fast");
  releaseSlow();
  await batch;
  expect(started.sort()).toEqual(["broken", "fast", "slow"]);

  let releaseActivePass!: () => void;
  const activePass = new Promise<void>((resolve) => {
    releaseActivePass = resolve;
  });
  let passes = 0;
  const coordinatedSweep = workflowSweepCoordinatorForRuntimeTest(async () => {
    passes += 1;
    if (passes === 1) await activePass;
  });
  const firstSweep = coordinatedSweep();
  const concurrentStopKick = coordinatedSweep();
  expect(concurrentStopKick).toBe(firstSweep);
  releaseActivePass();
  await firstSweep;
  expect(passes).toBe(2);
});

test("INC-GEN-026 browser workflow client validates exact identities and confirms a lost stop response read-only", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const run = (
    state: "running" | "stopping" = "running",
    overrides: Record<string, unknown> = {},
  ) => ({
    canvasId: "canvas-a",
    clientSemanticFingerprint: "wf1-client-a",
    createdAt: "2026-09-01T00:00:00.000Z",
    groupId: "group-a",
    id: "run-a",
    lockedNodeIds: ["node-a"],
    nodes: [{
      id: "node-a",
      kind: "text",
      projectionState: "pending",
      state: "pending",
    }],
    semanticFingerprint: "wf1-server-a",
    state,
    updatedAt: "2026-09-01T00:00:01.000Z",
    ...overrides,
  });
  const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
  const replies: Array<Response | Error> = [
    jsonResponse(run()),
    jsonResponse(run("running", { canvasId: "foreign-canvas" })),
    jsonResponse({ runs: [run("running", { canvasId: "foreign-canvas" })] }),
    jsonResponse(run("running", { id: "foreign-run" })),
    new TypeError("injected lost stop response"),
    jsonResponse(run("stopping")),
  ];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected workflow client request");
    if (reply instanceof Error) throw reply;
    return reply;
  }) as typeof fetch;
  try {
    await expect(createServerWorkflowRun({
      canvasId: "canvas-a",
      clientSemanticFingerprint: "wf1-client-a",
      groupId: "group-a",
    })).resolves.toMatchObject({ id: "run-a", state: "running" });
    await expect(createServerWorkflowRun({
      canvasId: "canvas-a",
      clientSemanticFingerprint: "wf1-client-a",
      groupId: "group-a",
    })).rejects.toThrow("create response identity");
    await expect(listServerWorkflowRuns("canvas-a")).rejects.toThrow(
      "list response identity",
    );
    await expect(getServerWorkflowRun("run-a")).rejects.toThrow(
      "get response identity",
    );
    await expect(stopServerWorkflowRunAndConfirm("run-a")).resolves.toMatchObject({
      id: "run-a",
      state: "stopping",
    });
    expect(requested.slice(-2)).toEqual([
      "/api/workflow-runs/run-a/stop",
      "/api/workflow-runs/run-a",
    ]);
    expect(workflowRunStatusReadIsRetryable(
      new DOMException("status timeout", "TimeoutError"),
    )).toBe(true);
    expect(workflowRunStatusReadIsRetryable(
      new DOMException("scope changed", "AbortError"),
    )).toBe(false);
    replies.push(
      new DOMException("status timeout", "TimeoutError"),
      jsonResponse(run("running", { state: "failed" })),
    );
    const observedStates: string[] = [];
    await expect(waitForServerWorkflowRun(
      "run-a",
      undefined,
      5_000,
      (update) => observedStates.push(update.state),
    ))
      .resolves.toMatchObject({ id: "run-a", state: "failed" });
    expect(observedStates).toEqual(["failed"]);
    const activeRun = parseServerWorkflowRunUpdatedEventDetail({
      accountId: "account-a",
      canvasId: "canvas-a",
      fixtureScopeId: "",
      run: run("running", {
        nodes: [{
          id: "node-a",
          kind: "text",
          projectionState: "pending",
          state: "admitted",
        }, {
          id: "node-b",
          kind: "image",
          projectionState: "pending",
          state: "pending",
        }],
      }),
    }).run;
    expect(activeServerWorkflowNodeIds(activeRun)).toEqual(new Set(["node-a"]));
    expect(parseServerWorkflowRunUpdatedEventDetail({
      accountId: "account-a",
      canvasId: "canvas-a",
      fixtureScopeId: "",
      run: run(),
    })).toMatchObject({
      accountId: "account-a",
      canvasId: "canvas-a",
      run: { id: "run-a" },
    });
    expect(() => parseServerWorkflowRunUpdatedEventDetail({
      accountId: "account-a",
      canvasId: "foreign-canvas",
      fixtureScopeId: "",
      run: run(),
    })).toThrow("event identity");
    replies.push(
      new Response(JSON.stringify({ error: "temporary list failure" }), {
        headers: { "Content-Type": "application/json" },
        status: 503,
      }),
      jsonResponse({ runs: [] }),
      jsonResponse({ runs: [run()] }),
    );
    await expect(reattachSubmittedServerWorkflowRun({
      canvasId: "canvas-a",
      clientSemanticFingerprint: "wf1-client-a",
      groupId: "group-a",
      pollIntervalMs: 1,
      startedAt: Date.parse("2026-09-01T00:00:00.000Z"),
    })).resolves.toMatchObject({ id: "run-a", state: "running" });
    replies.push(new Response(JSON.stringify({ error: "invalid list request" }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    }));
    await expect(reattachSubmittedServerWorkflowRun({
      canvasId: "canvas-a",
      clientSemanticFingerprint: "wf1-client-a",
      groupId: "group-a",
      pollIntervalMs: 1,
      startedAt: Date.parse("2026-09-01T00:00:00.000Z"),
    })).rejects.toThrow("invalid list request");
    replies.push(jsonResponse({ runs: [run("running", {
      canvasId: "foreign-canvas",
    })] }));
    await expect(reattachSubmittedServerWorkflowRun({
      canvasId: "canvas-a",
      clientSemanticFingerprint: "wf1-client-a",
      groupId: "group-a",
      pollIntervalMs: 1,
      startedAt: Date.parse("2026-09-01T00:00:00.000Z"),
    })).rejects.toThrow("list response identity");
    const fetchBeforeDeadline = globalThis.fetch;
    let deadlineReads = 0;
    try {
      globalThis.fetch = ((_input, init) => {
        deadlineReads += 1;
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const rejectForAbort = () => reject(
            signal?.reason ?? new DOMException("Aborted", "AbortError"),
          );
          if (signal?.aborted) rejectForAbort();
          else signal?.addEventListener("abort", rejectForAbort, { once: true });
        });
      }) as typeof fetch;
      const deadlineStartedAt = Date.now();
      await expect(reattachSubmittedServerWorkflowRun({
        canvasId: "canvas-a",
        clientSemanticFingerprint: "wf1-client-a",
        deadlineMs: 10,
        groupId: "group-a",
        pollIntervalMs: 1,
        startedAt: Date.parse("2026-09-01T00:00:00.000Z"),
      })).rejects.toThrow("服务端接收结果仍不明确");
      expect(Date.now() - deadlineStartedAt).toBeLessThan(1_000);
      expect(deadlineReads).toBe(1);
    } finally {
      globalThis.fetch = fetchBeforeDeadline;
    }
    expect(workflowRunCreateOutcomeIsUncertain(
      new TypeError("lost create response"),
    )).toBe(true);
    replies.push(new Response(JSON.stringify({ error: "invalid request" }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    }));
    let definitiveCreateError: unknown;
    try {
      await createServerWorkflowRun({
        canvasId: "canvas-a",
        clientSemanticFingerprint: "wf1-client-a",
        groupId: "group-a",
      });
    } catch (error) {
      definitiveCreateError = error;
    }
    expect(workflowRunCreateOutcomeIsUncertain(definitiveCreateError)).toBe(false);
    const stale = parseWorkflowRunsEnvelope({ runs: [run()] }).runs[0];
    const terminal = parseWorkflowRunsEnvelope({
      runs: [run("running", {
        state: "success",
        updatedAt: "2026-09-01T00:00:02.000Z",
      })],
    }).runs[0];
    expect(mergeServerWorkflowRuns([terminal], [stale])[0]).toMatchObject({
      id: "run-a",
      state: "success",
    });
    expect(replies).toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("INC-GEN-026 workflow reservation is selected by the locked run, never by input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-inc-gen-026-reservation-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  const textInput = authoritativeBuilderInputs()[0];
  const runId = "00000000-0000-4000-8000-000000000101";
  const reservationId = "00000000-0000-4000-8000-000000000102";
  const forgedReservationId = "00000000-0000-4000-8000-000000000103";
  const timestamp = new Date().toISOString();
  const idempotencyKey = "inc-gen-026-reservation-task";
  const nodeSemanticIdentity = "wf1-inc-gen-026-reservation-node";
  const database = openAppDatabase(directory);
  try {
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('__test__', 'inc-gen-026-reservation', 'INC-GEN-026',
        'fixture', 'user', 'active', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES ('__test__', 'inc-gen-026-reservation-canvas', 1, 1,
        '[]', '[]', '{}', ?, NULL, 0)
    `).run(timestamp);
    const plan = {
      clientSemanticFingerprint: "wf1-inc-gen-026-reservation-client",
      edges: [],
      executableNodeIds: ["inc-gen-026-reservation-node"],
      externalNodes: [],
      groupId: "inc-gen-026-reservation-group",
      nodes: [{
        costCurrency: "CNY",
        dependencies: [],
        id: "inc-gen-026-reservation-node",
        kind: "text",
        modelConfigurationRevision: textInput.modelConfigurationRevision,
        modelId: textInput.modelId,
        modelReleaseRevision: textInput.modelReleaseRevision,
        ownPrompt: "bind the server reservation",
        parameters: {},
        planIndex: 0,
        providerDriver: textInput.providerDriver,
        providerModelId: textInput.providerModelId,
        providerProfileId: textInput.providerProfileId,
        providerProtocol: textInput.providerProtocol,
        recoveryEvidence: "durable stored response retrieval and billing fence evidence",
        recoveryGrade: "STORED_RESPONSE_OR_FENCED_UNKNOWN",
        semanticIdentity: nodeSemanticIdentity,
      }],
      semanticFingerprint: "wf1-inc-gen-026-reservation-plan",
      version: 1,
    };
    database.prepare(`
      INSERT INTO workflow_runs (
        id, owner_id, canvas_id, group_id, graph_revision,
        semantic_fingerprint, plan_json, state, stop_requested,
        reservation_id, created_at, updated_at
      ) VALUES (?, '__test__', 'inc-gen-026-reservation-canvas',
        'inc-gen-026-reservation-group', 1,
        'wf1-inc-gen-026-reservation-plan', ?, 'running', 0, ?, ?, ?)
    `).run(runId, JSON.stringify(plan), reservationId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO workflow_run_nodes (
        run_id, owner_id, node_id, kind, plan_index, dependencies_json,
        semantic_identity, idempotency_key, state, projection_state,
        created_at, updated_at
      ) VALUES (?, '__test__', 'inc-gen-026-reservation-node', 'text', 0,
        '[]', ?, ?, 'admitting', 'pending', ?, ?)
    `).run(runId, nodeSemanticIdentity, idempotencyKey, timestamp, timestamp);
    database.prepare(`
      INSERT INTO workflow_run_locks (
        owner_id, canvas_id, node_id, run_id, created_at
      ) VALUES ('__test__', 'inc-gen-026-reservation-canvas',
        'inc-gen-026-reservation-node', ?, ?)
    `).run(runId, timestamp);
    database.prepare(`
      INSERT INTO media_capacity_reservations (
        id, owner_id, workflow_run_id, reserved_bytes, state, expires_at,
        created_at, updated_at
      ) VALUES (?, '__test__', ?, 1, 'active', ?, ?, ?)
    `).run(
      reservationId,
      runId,
      new Date(Date.now() + 60_000).toISOString(),
      timestamp,
      timestamp,
    );
    database.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 1, emergency_stop = 0,
        per_user_concurrency = 2, text_concurrency = 2,
        requests_per_minute = 10, updated_at = ?
      WHERE id = 1
    `).run(timestamp);
  } finally {
    database.close();
  }
  const store = createGenerationTaskStore(directory);
  const binding = {
    generationInputKey: textInput.generationInputKey,
    generationOwnershipKey: textInput.generationOwnershipKey,
    groupId: "inc-gen-026-reservation-group",
    modelConfigurationRevision: textInput.modelConfigurationRevision,
    modelReleaseRevision: textInput.modelReleaseRevision.revisionId,
    runId,
  };
  const taskInput = (modelConfiguration: ReturnType<
    typeof buildAuthoritativeGenerationModelConfiguration
  >) => {
    const requestIntent = {
      canvasId: "inc-gen-026-reservation-canvas",
      fixtureScopeId: modelConfiguration.fixtureScopeId,
      generationIdentityVersion: 2,
      generationInputKey: modelConfiguration.generationInputKey,
      generationOwnershipKey: modelConfiguration.generationOwnershipKey,
      kind: "text",
      model: textInput.modelId,
      modelConfigurationRevision: modelConfiguration.modelConfigurationRevision,
      modelInputContractFingerprint:
        modelConfiguration.modelInputContractFingerprint,
      modelReleaseRevision: modelConfiguration.modelReleaseRevision.revisionId,
      nodeId: "inc-gen-026-reservation-node",
      parameters: {},
      prompt: "bind the server reservation",
      ...(modelConfiguration.workflowBinding
        ? { workflowBinding: modelConfiguration.workflowBinding }
        : {}),
    };
    return ({
    canvasId: "inc-gen-026-reservation-canvas",
    credentialRevision: 1,
    idempotencyKey,
    kind: "text" as const,
    model: textInput.modelId,
    modelConfiguration,
    nodeId: "inc-gen-026-reservation-node",
    ownerId: "__test__",
    parameters: { inputSchemaVersion: 1, inputs: [] },
    prompt: "bind the server reservation",
    providerModelId: textInput.providerModelId,
    providerProfileId: textInput.providerProfileId,
    requestIntent,
    });
  };
  try {
    const unboundConfiguration = buildAuthoritativeGenerationModelConfiguration({
      ...textInput,
      workflowBinding: binding,
    });
    const forgedOuter = taskInput(unboundConfiguration);
    expect(() => store.admitAuthoritativeOrGet({
      ...forgedOuter,
      requestIntent: {
        ...forgedOuter.requestIntent,
        modelConfigurationRevision: "forged-outer-revision",
      },
    })).toThrow("Authoritative generation task binding is invalid");
    expect(() => store.admitAuthoritativeOrGet(taskInput(
      buildAuthoritativeGenerationModelConfiguration(textInput),
    ))).toThrow(GenerationTaskWorkflowLockedError);
    expect(() => store.admitAuthoritativeOrGet(taskInput(
      buildAuthoritativeGenerationModelConfiguration({
        ...textInput,
        workflowBinding: { ...binding, reservationId: forgedReservationId },
      }),
    ))).toThrow(GenerationTaskWorkflowLockedError);
    const before = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    expect(before.prepare("SELECT COUNT(*) AS count FROM generation_tasks")
      .get()).toEqual({ count: 0 });
    before.close();
    const admitted = store.admitAuthoritativeOrGet(taskInput(
      buildAuthoritativeGenerationModelConfiguration({
        ...textInput,
        workflowBinding: binding,
      }),
    ));
    expect(admitted.created).toBe(true);
    expect(admitted.task.modelConfiguration.workflowBinding).toMatchObject({
      reservationId,
      runId,
    });
    await runWorkflowSweep();
    const linked = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    expect(linked.prepare(`
      SELECT state, task_id AS taskId FROM workflow_run_nodes
      WHERE run_id = ? AND node_id = 'inc-gen-026-reservation-node'
    `).get(runId)).toEqual({ state: "admitted", taskId: admitted.task.id });
    expect(linked.prepare("SELECT COUNT(*) AS count FROM generation_tasks").get())
      .toEqual({ count: 1 });
    linked.close();
    const stopping = openAppDatabase(directory);
    stopping.prepare(`
      UPDATE workflow_runs SET state = 'stopping', stop_requested = 1
      WHERE id = ?
    `).run(runId);
    stopping.prepare(`
      UPDATE workflow_run_nodes SET state = 'admitting', task_id = NULL
      WHERE run_id = ? AND node_id = 'inc-gen-026-reservation-node'
    `).run(runId);
    settleWorkflowAdmissionFailureForRuntimeTest({
      database: stopping,
      error: new Error("admission lost the stop race"),
      nodeId: "inc-gen-026-reservation-node",
      runId,
    });
    expect(stopping.prepare(`
      SELECT state, error_code AS errorCode FROM workflow_run_nodes
      WHERE run_id = ? AND node_id = 'inc-gen-026-reservation-node'
    `).get(runId)).toEqual({
      errorCode: "WORKFLOW_STOP_REQUESTED",
      state: "cancelled",
    });
    expect(stopping.prepare(`
      SELECT error_code AS errorCode FROM workflow_runs WHERE id = ?
    `).get(runId)).toEqual({ errorCode: "WORKFLOW_STOP_REQUESTED" });

    stopping.prepare(`
      UPDATE workflow_runs
      SET state = 'running', stop_requested = 0,
          error_code = NULL, error_message = NULL
      WHERE id = ?
    `).run(runId);
    stopping.prepare(`
      UPDATE workflow_run_nodes
      SET state = 'admitting', error_code = NULL, error_message = NULL
      WHERE run_id = ? AND node_id = 'inc-gen-026-reservation-node'
    `).run(runId);
    settleWorkflowAdmissionFailureForRuntimeTest({
      database: stopping,
      error: new Error("first decisive failure"),
      nodeId: "inc-gen-026-reservation-node",
      runId,
    });
    stopping.prepare(`
      UPDATE workflow_run_nodes
      SET state = 'admitting', error_code = NULL, error_message = NULL
      WHERE run_id = ? AND node_id = 'inc-gen-026-reservation-node'
    `).run(runId);
    settleWorkflowAdmissionFailureForRuntimeTest({
      database: stopping,
      error: new Error("later decisive failure"),
      nodeId: "inc-gen-026-reservation-node",
      runId,
    });
    expect(stopping.prepare(`
      SELECT error_code AS errorCode, error_message AS errorMessage
      FROM workflow_runs WHERE id = ?
    `).get(runId)).toEqual({
      errorCode: "WORKFLOW_ADMISSION_FAILED",
      errorMessage: "first decisive failure",
    });
    stopping.close();
  } finally {
    store.close();
    generationTaskApplication.taskStore().close();
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

function request(path: string, init: RequestInit = {}) {
  return fetch(`${appOrigin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

async function listen(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

async function close(server: Server | undefined) {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
}

async function waitForReady() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await request("/api/health/ready");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("INC-GEN-026 app server did not become ready");
}

async function expectOk(response: Response, label: string) {
  if (response.ok) return response;
  throw new Error(
    `${label} failed (${response.status}): ${await response.text()}`,
  );
}

async function createPublishedTextModel() {
  const providerResponse = await expectOk(await request(
    "/api/admin/providers",
    {
      body: JSON.stringify({
        apiKey: "inc-gen-026-fake-ark-key",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
        label: "INC-GEN-026 loopback fake Ark",
      }),
      method: "POST",
    },
  ), "provider");
  const provider = (await providerResponse.json()) as {
    profile: { id: string };
  };
  await expectOk(await request(
    `/api/account-credentials/${provider.profile.id}`,
    {
      body: JSON.stringify({ apiKey: "inc-gen-026-fake-ark-key" }),
      method: "PUT",
    },
  ), "provider credential");
  await expectOk(await request(
    `/api/admin/providers/${provider.profile.id}/test`,
    { method: "POST" },
  ), "provider read-only verification");
  const modelResponse = await expectOk(await request("/api/admin/models", {
    body: JSON.stringify({
      capability: "text",
      displayName: "INC-GEN-026 HTTP text",
      isDefault: false,
      maxCostMicrounits: 0,
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: provider.profile.id,
      sortOrder: 1,
      status: "draft",
    }),
    method: "POST",
  }), "model");
  const model = (await modelResponse.json()) as { model: { id: string } };
  const contractResponse = await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract`,
  ), "model contract");
  const contract = (await contractResponse.json()) as {
    suggestedDocument: Record<string, unknown>;
  };
  await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract/draft`,
    {
      body: JSON.stringify({
        document: contract.suggestedDocument,
        expectedDraftVersion: 0,
      }),
      method: "POST",
    },
  ), "model contract draft");
  await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract/publish`,
    {
      body: JSON.stringify({ expectedDraftVersion: 1 }),
      method: "POST",
    },
  ), "model contract publish");
  await expectOk(await request(`/api/admin/models/${model.model.id}`, {
    body: JSON.stringify({ isDefault: true, status: "published" }),
    method: "PATCH",
  }), "model publish");
  const database = openAppDatabase(String(process.env.UNBOUNDRY_DATA_DIR));
  try {
    bootstrapPublishedModelContracts(database, "__test__");
  } finally {
    database.close();
  }
  return model.model.id;
}

async function createPublishedTtImageModel() {
  const providerResponse = await expectOk(await request(
    "/api/admin/providers",
    {
      body: JSON.stringify({
        apiKey: "inc-gen-027-fake-relay-key",
        baseUrl: "https://api.lk888.test/v1",
        driver: "multi-protocol-relay",
        label: "INC-GEN-027 loopback fake relay",
      }),
      method: "POST",
    },
  ), "relay provider");
  const provider = (await providerResponse.json()) as {
    profile: { id: string };
  };
  await expectOk(await request(
    `/api/account-credentials/${provider.profile.id}`,
    {
      body: JSON.stringify({ apiKey: "inc-gen-027-fake-relay-key" }),
      method: "PUT",
    },
  ), "relay account credential");
  const verifiedFixtureStore = openAppDatabase(
    String(process.env.UNBOUNDRY_DATA_DIR),
  );
  try {
    const timestamp = new Date().toISOString();
    const verified = verifiedFixtureStore.prepare(`
      UPDATE provider_profiles
      SET status = 'enabled', key_status = 'valid', key_checked_at = ?,
        catalog_key_status = 'valid', catalog_checked_at = ?, updated_at = ?
      WHERE id = ? AND driver = 'multi-protocol-relay'
    `).run(timestamp, timestamp, timestamp, provider.profile.id);
    if (verified.changes !== 1) {
      throw new Error("safe-test relay verification fixture did not bind exactly once");
    }
  } finally {
    verifiedFixtureStore.close();
  }
  const modelResponse = await expectOk(await request("/api/admin/models", {
    body: JSON.stringify({
      capability: "image",
      displayName: "TT Image 2 · 异步可恢复",
      isDefault: false,
      maxCostMicrounits: 0,
      providerModelId: "tt-image-2",
      providerProfileId: provider.profile.id,
      providerProtocol: "media-generate",
      sortOrder: 1,
      status: "draft",
    }),
    method: "POST",
  }), "TT Image model");
  const model = (await modelResponse.json()) as { model: { id: string } };
  const contractResponse = await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract`,
  ), "TT Image model contract");
  const contract = (await contractResponse.json()) as {
    suggestedDocument: Record<string, unknown>;
  };
  await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract/draft`,
    {
      body: JSON.stringify({
        document: contract.suggestedDocument,
        expectedDraftVersion: 0,
      }),
      method: "POST",
    },
  ), "TT Image model contract draft");
  await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract/publish`,
    {
      body: JSON.stringify({ expectedDraftVersion: 1 }),
      method: "POST",
    },
  ), "TT Image model contract publish");
  await expectOk(await request(`/api/admin/models/${model.model.id}`, {
    body: JSON.stringify({ isDefault: true, status: "published" }),
    method: "PATCH",
  }), "TT Image model publish");
  const database = openAppDatabase(String(process.env.UNBOUNDRY_DATA_DIR));
  try {
    bootstrapPublishedModelContracts(database, "__test__");
  } finally {
    database.close();
  }
  return model.model.id;
}

async function createPublishedGrokVideoModel(providerProfileId: string) {
  const modelResponse = await expectOk(await request("/api/admin/models", {
    body: JSON.stringify({
      capability: "video",
      displayName: "Grok Video 3 dynamic first-frame",
      isDefault: false,
      maxCostMicrounits: 0,
      providerModelId: "grok-video-3",
      providerProfileId,
      providerProtocol: "media-generate",
      sortOrder: 1,
      status: "draft",
    }),
    method: "POST",
  }), "Grok Video model");
  const model = (await modelResponse.json()) as { model: { id: string } };
  const contractResponse = await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract`,
  ), "Grok Video model contract");
  const contract = (await contractResponse.json()) as {
    suggestedDocument: Record<string, unknown>;
  };
  await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract/draft`,
    {
      body: JSON.stringify({
        document: contract.suggestedDocument,
        expectedDraftVersion: 0,
      }),
      method: "POST",
    },
  ), "Grok Video model contract draft");
  await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract/publish`,
    {
      body: JSON.stringify({ expectedDraftVersion: 1 }),
      method: "POST",
    },
  ), "Grok Video model contract publish");
  await expectOk(await request(`/api/admin/models/${model.model.id}`, {
    body: JSON.stringify({ isDefault: true, status: "published" }),
    method: "PATCH",
  }), "Grok Video model publish");
  const database = openAppDatabase(String(process.env.UNBOUNDRY_DATA_DIR));
  try {
    bootstrapPublishedModelContracts(database, "__test__");
  } finally {
    database.close();
  }
  return model.model.id;
}

async function createPublishedSeedanceModel() {
  const providerResponse = await expectOk(await request(
    "/api/admin/providers",
    {
      body: JSON.stringify({
        apiKey: "inc-gen-028-fake-ark-video-key",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
        label: "INC-GEN-028 loopback fake Ark video",
      }),
      method: "POST",
    },
  ), "Seedance provider");
  const provider = (await providerResponse.json()) as {
    profile: { id: string };
  };
  await expectOk(await request(
    `/api/account-credentials/${provider.profile.id}`,
    {
      body: JSON.stringify({ apiKey: "inc-gen-028-fake-ark-video-key" }),
      method: "PUT",
    },
  ), "Seedance provider credential");
  await expectOk(await request(
    `/api/admin/providers/${provider.profile.id}/test`,
    { method: "POST" },
  ), "Seedance provider read-only verification");
  const modelResponse = await expectOk(await request("/api/admin/models", {
    body: JSON.stringify({
      capability: "video",
      displayName: "INC-GEN-028 Seedance canonical inputs",
      isDefault: false,
      maxCostMicrounits: 0,
      providerModelId: "doubao-seedance-2-0-mini-260615",
      providerProfileId: provider.profile.id,
      sortOrder: 1,
      status: "draft",
    }),
    method: "POST",
  }), "Seedance model");
  const model = (await modelResponse.json()) as { model: { id: string } };
  const contractResponse = await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract`,
  ), "Seedance model contract");
  const contract = (await contractResponse.json()) as {
    suggestedDocument: Record<string, unknown>;
  };
  await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract/draft`,
    {
      body: JSON.stringify({
        document: contract.suggestedDocument,
        expectedDraftVersion: 0,
      }),
      method: "POST",
    },
  ), "Seedance model contract draft");
  await expectOk(await request(
    `/api/admin/models/${model.model.id}/contract/publish`,
    {
      body: JSON.stringify({ expectedDraftVersion: 1 }),
      method: "POST",
    },
  ), "Seedance model contract publish");
  await expectOk(await request(`/api/admin/models/${model.model.id}`, {
    body: JSON.stringify({ isDefault: true, status: "published" }),
    method: "PATCH",
  }), "Seedance model publish");
  const database = openAppDatabase(String(process.env.UNBOUNDRY_DATA_DIR));
  try {
    bootstrapPublishedModelContracts(database, "__test__");
  } finally {
    database.close();
  }
  return model.model.id;
}

async function waitForTerminalRun(runId: string, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  let lastState = "unknown";
  let lastNodeStates: string[] = [];
  while (Date.now() < deadline) {
    const response = await expectOk(
      await request(`/api/workflow-runs/${runId}`),
      "workflow run",
    );
    const run = await response.json() as {
      errorCode?: string;
      errorMessage?: string;
      nodes: Array<{
        errorCode?: string;
        errorMessage?: string;
        state: string;
        taskId?: string;
      }>;
      state: string;
    };
    lastState = run.state;
    lastNodeStates = run.nodes.map(({ state }) => state);
    if (["success", "failed", "cancelled"].includes(run.state)) return run;
    // Poll four times faster than the real client's 1-second interval so this
    // path remains a deliberate read/write-isolation stress test on slow CI.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `INC-GEN-026 workflow run did not become terminal: ${lastState} [${lastNodeStates.join(",")}]`,
  );
}

test("INC-GEN-026 true HTTP workflow admits once and reaches a loopback fake Provider", async () => {
  const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
  const originalFetch = globalThis.fetch;
  const providerRequests: Array<{
    body: string;
    method: string;
    originalUrl: string;
  }> = [];
  let app: ViteDevServer | undefined;
  let provider: Server | undefined;
  try {
    process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
    provider = createHttpServer(async (incoming, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      await new Promise((resolve) => setTimeout(resolve, 100));
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      if (incoming.method === "GET") {
        response.end(JSON.stringify({ items: [] }));
        return;
      }
      response.end(JSON.stringify({
        id: "resp_inc-gen-026-http",
        output: [{
          content: [{
            text: "INC-GEN-026 loopback result",
            type: "output_text",
          }],
          status: "completed",
          type: "message",
        }],
        status: "completed",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }));
    });
    await listen(provider, providerPort);
    globalThis.fetch = (async (input, init) => {
      const originalUrl = input instanceof Request ? input.url : String(input);
      const url = new URL(originalUrl);
      if (url.hostname === "ark.cn-beijing.volces.com") {
        const body = typeof init?.body === "string" ? init.body : "";
        providerRequests.push({
          body,
          method: init?.method ?? "GET",
          originalUrl,
        });
        const target = new URL(url.pathname + url.search, providerOrigin);
        return await originalFetch(target, init);
      }
      return await originalFetch(input, init);
    }) as typeof fetch;

    app = await createViteServer({
      configFile: "vite.config.ts",
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        hmr: false,
        port: appPort,
        strictPort: true,
        ws: false,
      },
    });
    await app.listen();
    await waitForReady();
    await expectOk(await request("/api/admin/generation-safety", {
      body: JSON.stringify(safetySettings),
      method: "PUT",
    }), "generation safety");
    const modelId = await createPublishedTextModel();
    const canvasId = "inc-gen-026-http";
    const groupId = "inc-gen-026-group";
    const graph = {
      edges: [],
      nodes: [
        {
          data: { title: "INC-GEN-026 Group" },
          id: groupId,
          type: "group",
        },
        {
          data: {
            textModelId: modelId,
            textParameters: { outputCount: 1, responseFormat: "text" },
            textPrompt: "Complete this workflow exactly once",
            textPromptReady: true,
            title: "HTTP Text",
          },
          id: "inc-gen-026-text",
          parentId: groupId,
          type: "text",
        },
      ],
    };
    const canvasResponse = await expectOk(await request(
      `/api/canvas/${canvasId}`,
      {
        body: JSON.stringify({
          ...graph,
          revision: 0,
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
        method: "PUT",
      },
    ), "canvas");
    expect((await canvasResponse.json()).revision).toBeGreaterThan(0);
    const semantic = compileFrozenWorkflowSemanticPlan({
      ...graph,
      groupId,
    });
    const createBody = JSON.stringify({
      canvasId,
      clientSemanticFingerprint: semantic.semanticFingerprint,
      groupId,
    });
    const createResponse = await expectOk(await request("/api/workflow-runs", {
      body: createBody,
      method: "POST",
    }), "workflow create");
    expect(createResponse.status).toBe(202);
    const created = await createResponse.json() as { id: string };
    const duplicateResponse = await expectOk(
      await request("/api/workflow-runs", {
        body: createBody,
        method: "POST",
      }),
      "duplicate workflow create",
    );
    expect((await duplicateResponse.json() as { id: string }).id).toBe(created.id);
    const terminal = await waitForTerminalRun(created.id);
    const database = new DatabaseSync(
      `${process.env.UNBOUNDRY_DATA_DIR}/unboundry.sqlite`,
      { readOnly: true },
    );
    const evidence = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM generation_tasks
          WHERE canvas_id = ?) AS tasks,
        (SELECT COUNT(*) FROM generation_provider_attempts AS attempt
          JOIN generation_tasks AS task ON task.id = attempt.task_id
          WHERE task.canvas_id = ?) AS attempts,
        (SELECT COUNT(*) FROM workflow_runs
          WHERE canvas_id = ?) AS runs
    `).get(canvasId, canvasId, canvasId) as {
      attempts: number;
      runs: number;
      tasks: number;
    };
    database.close();
    expect({
      attempts: evidence.attempts,
      errorCode: terminal.errorCode ?? terminal.nodes[0]?.errorCode,
      errorMessage: terminal.errorMessage ?? terminal.nodes[0]?.errorMessage,
      providerPosts: providerRequests.filter(({ method }) => method === "POST").length,
      runs: evidence.runs,
      state: terminal.state,
      tasks: evidence.tasks,
    }).toEqual({
      attempts: 1,
      errorCode: undefined,
      errorMessage: undefined,
      providerPosts: 1,
      runs: 1,
      state: "success",
      tasks: 1,
    });
    expect(providerRequests.find(({ method }) => method === "POST")?.originalUrl)
      .toBe("https://ark.cn-beijing.volces.com/api/v3/responses");
  } finally {
    await app?.close();
    await close(provider);
    globalThis.fetch = originalFetch;
    if (previousBypass === undefined) {
      delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    } else {
      process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
    }
  }
});

test("INC-GEN-028 legacy Seedance inputs stay canonical from frozen plan through Provider submission", async () => {
  const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
  const originalFetch = globalThis.fetch;
  const providerRequests: Array<{
    body: string;
    method: string;
    originalUrl: string;
  }> = [];
  let app: ViteDevServer | undefined;
  let provider: Server | undefined;
  try {
    const referencePng = await readFile(new URL(
      "../spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
      import.meta.url,
    ));
    process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
    provider = createHttpServer(async (incoming, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const url = new URL(incoming.url ?? "/", providerOrigin);
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      if (
        incoming.method === "POST" &&
        url.pathname === "/api/v3/contents/generations/tasks"
      ) {
        response.end(JSON.stringify({ id: "cgt-inc-gen-028-canonical" }));
        return;
      }
      if (
        incoming.method === "GET" &&
        url.pathname ===
          "/api/v3/contents/generations/tasks/cgt-inc-gen-028-canonical"
      ) {
        response.end(JSON.stringify({
          error: { code: "SAFE_FIXTURE_STOP", message: "fixture terminal" },
          status: "failed",
        }));
        return;
      }
      response.end(JSON.stringify({ items: [] }));
    });
    await listen(provider, providerPort);
    globalThis.fetch = (async (input, init) => {
      const originalUrl = input instanceof Request ? input.url : String(input);
      const url = new URL(originalUrl);
      if (url.hostname === "ark.cn-beijing.volces.com") {
        const body = typeof init?.body === "string" ? init.body : "";
        providerRequests.push({
          body,
          method: input instanceof Request
            ? input.method
            : init?.method ?? "GET",
          originalUrl,
        });
        const target = new URL(url.pathname + url.search, providerOrigin);
        return await originalFetch(target, init);
      }
      return await originalFetch(input, init);
    }) as typeof fetch;

    app = await createViteServer({
      configFile: "vite.config.ts",
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        hmr: false,
        port: appPort,
        strictPort: true,
        ws: false,
      },
    });
    await app.listen();
    await waitForReady();
    await expectOk(await request("/api/admin/generation-safety", {
      body: JSON.stringify(safetySettings),
      method: "PUT",
    }), "generation safety");
    const modelId = await createPublishedSeedanceModel();
    const canvasId = "inc-gen-028-seedance-canonical";
    const groupId = "inc-gen-028-seedance-group";
    const referenceAssetId = "inc-gen-028-seedance-reference";
    await expectOk(await request(`/api/assets/${referenceAssetId}`, {
      body: referencePng,
      headers: {
        "Content-Type": "image/png",
        "X-File-Name": "reference.png",
      },
      method: "POST",
    }), "Seedance reference upload");
    const ownPrompt = "生成一段商品展示视频";
    const graph = {
      edges: [{
        data: { inputOrder: 1, inputRole: "instruction" },
        id: "inc-gen-028-seedance-text-edge",
        source: "inc-gen-028-seedance-text",
        target: "inc-gen-028-seedance-video",
      }, {
        data: { inputOrder: 2, inputRole: "first-frame" },
        id: "inc-gen-028-seedance-image-edge",
        source: "inc-gen-028-seedance-image",
        target: "inc-gen-028-seedance-video",
      }],
      nodes: [
        { data: { title: "INC-GEN-028 Group" }, id: groupId, type: "group" },
        {
          data: { content: "保持服装颜色和主体一致", title: "Legacy Text" },
          id: "inc-gen-028-seedance-text",
          type: "text",
        },
        {
          data: {
            assetId: referenceAssetId,
            imageSrc: `/api/assets/${referenceAssetId}`,
            inputState: "ready",
            title: "Legacy first frame",
          },
          id: "inc-gen-028-seedance-image",
          type: "image",
        },
        {
          data: {
            title: "Legacy Seedance target",
            videoModelId: modelId,
            videoParameters: {
              aspectRatio: "16:9",
              duration: 5,
              generateAudio: true,
              inputMode: "text",
              outputCount: 1,
              resolution: "480p",
            },
            videoPrompt: ownPrompt,
            videoPromptReady: true,
          },
          id: "inc-gen-028-seedance-video",
          parentId: groupId,
          type: "video",
        },
      ],
    };
    const canvasResponse = await expectOk(await request(`/api/canvas/${canvasId}`, {
      body: JSON.stringify({
        ...graph,
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      method: "PUT",
    }), "Seedance legacy canvas");
    const canvasRevision = (await canvasResponse.json() as { revision: number }).revision;
    const semantic = compileFrozenWorkflowSemanticPlan({ ...graph, groupId });
    const createResponse = await expectOk(await request("/api/workflow-runs", {
      body: JSON.stringify({
        canvasId,
        clientSemanticFingerprint: semantic.semanticFingerprint,
        groupId,
      }),
      method: "POST",
    }), "Seedance canonical workflow create");
    const created = await createResponse.json() as { id: string };
    const terminal = await waitForTerminalRun(created.id);

    const resolvedModel = generationTaskApplication.resolveModel(
      "video",
      modelId,
      "__test__",
    );
    if (!resolvedModel) throw new Error("Seedance fixture model was not resolved");
    const expectedPreflight = generationTaskApplication.strictGenerationPreflight({
      body: {
        canvasId,
        canvasRevision,
        inputSchemaVersion: 1,
        kind: "video",
        model: modelId,
        nodeId: "inc-gen-028-seedance-video",
        ownPrompt,
        parameters: graph.nodes[3]!.data.videoParameters,
      },
      bypass: true,
      model: resolvedModel,
      ownerId: "__test__",
      requireFreshRevision: true,
      targetKind: "video",
    });
    expect(expectedPreflight.canSubmit).toBe(true);
    expect(expectedPreflight.parameters).toMatchObject({ inputMode: "multimodal" });
    expect(expectedPreflight.inputs.find(({ kind }) => kind === "image"))
      .toMatchObject({ role: "reference-image" });
    const expectedContractFingerprint = expectedPreflight.contractFingerprint;
    if (!expectedContractFingerprint) {
      throw new Error("Seedance canonical preflight contract is missing");
    }

    const database = new DatabaseSync(
      `${process.env.UNBOUNDRY_DATA_DIR}/unboundry.sqlite`,
      { readOnly: true },
    );
    const row = database.prepare(`
      SELECT run.plan_json AS planJson,
        node.semantic_identity AS storedSemanticIdentity,
        task.model_configuration AS modelConfiguration,
        task.parameters AS parameters
      FROM workflow_runs AS run
      JOIN workflow_run_nodes AS node ON node.run_id = run.id
      JOIN generation_tasks AS task ON task.id = node.task_id
      WHERE run.id = ? AND node.node_id = 'inc-gen-028-seedance-video'
    `).get(created.id) as {
      modelConfiguration: string;
      parameters: string;
      planJson: string;
      storedSemanticIdentity: string;
    };
    database.close();
    const plan = JSON.parse(row.planJson) as {
      nodes: Array<{
        dependencies: string[];
        id: string;
        kind: "video";
        modelConfigurationRevision: string;
        modelId: string;
        ownPrompt: string;
        parameters: Record<string, unknown>;
        planIndex: number;
        semanticIdentity: string;
      }>;
    };
    const planNode = plan.nodes.find(({ id }) =>
      id === "inc-gen-028-seedance-video"
    )!;
    const taskParameters = JSON.parse(row.parameters) as {
      inputMode?: string;
      inputs?: Array<{ kind: string; role: string }>;
    };
    const modelConfiguration = JSON.parse(row.modelConfiguration) as {
      generationInputKey: string;
      generationOwnershipKey: string;
      modelInputContractFingerprint: string;
      workflowBinding: {
        generationInputKey: string;
        generationOwnershipKey: string;
      };
    };
    expect(planNode.parameters).toMatchObject({ inputMode: "multimodal" });
    expect(planNode.semanticIdentity).toBe(workflowSemanticDigest({
      dependencies: planNode.dependencies,
      id: planNode.id,
      kind: planNode.kind,
      modelId: planNode.modelId,
      ownPrompt: planNode.ownPrompt,
      parameters: planNode.parameters,
      planIndex: planNode.planIndex,
    }));
    expect(row.storedSemanticIdentity).toBe(planNode.semanticIdentity);
    expect(taskParameters).toMatchObject({ inputMode: "multimodal" });
    expect(taskParameters.inputs?.find(({ kind }) => kind === "image"))
      .toMatchObject({ role: "reference-image" });
    const expectedInputKey = generationInputKey({
      inputs: expectedPreflight.inputs,
      modelConfigurationRevision: planNode.modelConfigurationRevision,
      modelId,
      modelReleaseRevision: String(
        expectedPreflight.modelReleaseRevision?.revisionId ?? "",
      ),
      ownPrompt,
      parameters: expectedPreflight.parameters,
      prompt: expectedPreflight.finalPrompt,
    });
    const expectedOwnershipKey = generationOwnershipKey(
      generationOwnershipEvidence({
        contractFingerprint: expectedContractFingerprint,
        inputs: expectedPreflight.inputs,
        kind: "video",
        modelConfigurationRevision: planNode.modelConfigurationRevision,
        modelId,
        modelReleaseRevision: String(
          expectedPreflight.modelReleaseRevision?.revisionId ?? "",
        ),
        parameters: expectedPreflight.parameters,
        prompt: ownPrompt,
      }),
    );
    expect(modelConfiguration).toMatchObject({
      generationInputKey: expectedInputKey,
      generationOwnershipKey: expectedOwnershipKey,
      modelInputContractFingerprint: expectedContractFingerprint,
      workflowBinding: {
        generationInputKey: expectedInputKey,
        generationOwnershipKey: expectedOwnershipKey,
      },
    });
    const providerPosts = providerRequests.filter(({ method, originalUrl }) =>
      method === "POST" &&
      new URL(originalUrl).pathname === "/api/v3/contents/generations/tasks"
    );
    expect(providerPosts).toHaveLength(1);
    const providerBody = JSON.parse(providerPosts[0]!.body) as {
      content: Array<{ role?: string; type: string }>;
    };
    expect(providerBody.content).toContainEqual(expect.objectContaining({
      role: "reference_image",
      type: "image_url",
    }));
    expect(providerBody.content).not.toContainEqual(expect.objectContaining({
      role: "first_frame",
    }));
    expect(terminal.state).toBe("failed");
  } finally {
    await app?.close();
    await close(provider);
    globalThis.fetch = originalFetch;
    if (previousBypass === undefined) {
      delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    } else {
      process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
    }
  }
});

test("v0.7.1 TT Image workflow submits once, polls the official route and survives refresh", async () => {
  const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
  const previousRelayMediaFetcher =
    process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER;
  const originalFetch = globalThis.fetch;
  const providerRequests: Array<{
    body: string;
    method: string;
    originalUrl: string;
  }> = [];
  let app: ViteDevServer | undefined;
  let provider: Server | undefined;
  try {
    process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
    process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = "1";
    provider = createHttpServer(async (incoming, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const url = new URL(incoming.url ?? "/", providerOrigin);
      if (incoming.method === "GET" && url.pathname === "/v1/skills/models") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          models: [{
            display_name: "TT Image 2",
            name: "tt-image-2",
            output_modalities: ["image"],
            protocols: ["media-generate"],
            type: "图片",
          }],
          total: 1,
          type: "list",
        }));
        return;
      }
      if (incoming.method === "GET" && url.pathname === "/v1/models") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ data: [{ id: "tt-image-2" }] }));
        return;
      }
      if (
        incoming.method === "POST" &&
        url.pathname === "/v1/media/generate"
      ) {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ task_id: "tt_image_task_v071_once" }));
        return;
      }
      if (
        incoming.method === "GET" &&
        url.pathname === "/v1/skills/task-status"
      ) {
        response.statusCode = 404;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "official route required" }));
        return;
      }
      if (
        incoming.method === "GET" &&
        url.pathname === "/v1/media/status" &&
        url.searchParams.get("task_id") === "tt_image_task_v071_once"
      ) {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          is_final: true,
          result_type: "image",
          result_url: "https://api.lk888.test/v1/results/tt-image-v071.png",
          state: "success",
        }));
        return;
      }
      if (
        incoming.method === "GET" &&
        url.pathname === "/v1/results/tt-image-v071.png"
      ) {
        response.statusCode = 200;
        response.setHeader("Content-Length", String(tinyPng.byteLength));
        response.setHeader("Content-Type", "image/png");
        response.end(tinyPng);
        return;
      }
      response.statusCode = 404;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "unknown safe-test route" }));
    });
    await listen(provider, providerPort);
    globalThis.fetch = (async (input, init) => {
      const originalUrl = input instanceof Request ? input.url : String(input);
      const url = new URL(originalUrl);
      if (url.hostname === "api.lk888.test") {
        const body = typeof init?.body === "string" ? init.body : "";
        providerRequests.push({
          body,
          method: input instanceof Request
            ? input.method
            : init?.method ?? "GET",
          originalUrl,
        });
        const target = new URL(url.pathname + url.search, providerOrigin);
        return await originalFetch(target, init);
      }
      return await originalFetch(input, init);
    }) as typeof fetch;

    app = await createViteServer({
      configFile: "vite.config.ts",
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        hmr: false,
        port: appPort,
        strictPort: true,
        ws: false,
      },
    });
    await app.listen();
    await waitForReady();
    await expectOk(await request("/api/admin/generation-safety", {
      body: JSON.stringify(safetySettings),
      method: "PUT",
    }), "generation safety");
    const modelId = await createPublishedTtImageModel();
    const canvasId = "inc-gen-027-tt-image-http";
    const groupId = "inc-gen-027-tt-image-group";
    const referenceAssetId = "inc-gen-027-tt-image-reference";
    const referenceUpload = await expectOk(await request(
      `/api/assets/${referenceAssetId}`,
      {
        body: tinyPng,
        headers: {
          "Content-Type": "image/png",
          "X-File-Name": "reference.png",
        },
        method: "POST",
      },
    ), "TT Image reference upload");
    expect(referenceUpload.status).toBe(201);
    const prompt = "Create one clean portrait product image";
    const graph = {
      edges: [{
        data: { inputOrder: 1, inputRole: "reference-image" },
        id: "inc-gen-027-tt-image-reference-edge",
        source: "inc-gen-027-tt-image-reference",
        target: "inc-gen-027-tt-image",
      }],
      nodes: [
        {
          data: { title: "INC-GEN-027 TT Image Group" },
          id: groupId,
          type: "group",
        },
        {
          data: {
            assetId: referenceAssetId,
            imageSrc: `/api/assets/${referenceAssetId}`,
            inputState: "ready",
            title: "TT Image reference",
          },
          id: "inc-gen-027-tt-image-reference",
          parentId: groupId,
          type: "image",
        },
        {
          data: {
            imageModelId: modelId,
            imageParameters: {
              aspectRatio: "9:16",
              inputMode: "image",
              outputCount: 1,
              quality: "2k",
            },
            imagePrompt: prompt,
            imagePromptReady: true,
            title: "TT Image HTTP",
          },
          id: "inc-gen-027-tt-image",
          parentId: groupId,
          type: "image",
        },
      ],
    };
    const canvasResponse = await expectOk(await request(
      `/api/canvas/${canvasId}`,
      {
        body: JSON.stringify({
          ...graph,
          revision: 0,
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
        method: "PUT",
      },
    ), "TT Image canvas");
    expect((await canvasResponse.json()).revision).toBeGreaterThan(0);
    const semantic = compileFrozenWorkflowSemanticPlan({ ...graph, groupId });
    const createBody = JSON.stringify({
      canvasId,
      clientSemanticFingerprint: semantic.semanticFingerprint,
      groupId,
    });
    const createResponse = await expectOk(await request("/api/workflow-runs", {
      body: createBody,
      method: "POST",
    }), "TT Image workflow create");
    expect(createResponse.status).toBe(202);
    const created = await createResponse.json() as { id: string };
    const duplicateResponse = await expectOk(
      await request("/api/workflow-runs", {
        body: createBody,
        method: "POST",
      }),
      "TT Image duplicate workflow create",
    );
    expect((await duplicateResponse.json() as { id: string }).id).toBe(created.id);
    const terminal = await waitForTerminalRun(created.id, 45_000);
    const refreshedResponse = await expectOk(
      await request(`/api/workflow-runs/${created.id}`),
      "TT Image refreshed workflow",
    );
    const refreshed = await refreshedResponse.json() as typeof terminal;
    const database = new DatabaseSync(
      `${process.env.UNBOUNDRY_DATA_DIR}/unboundry.sqlite`,
      { readOnly: true },
    );
    const evidence = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM generation_tasks
          WHERE canvas_id = ?) AS tasks,
        (SELECT COUNT(*) FROM generation_provider_attempts AS attempt
          JOIN generation_tasks AS task ON task.id = attempt.task_id
          WHERE task.canvas_id = ?) AS attempts,
        (SELECT COUNT(*) FROM workflow_runs
          WHERE canvas_id = ?) AS runs,
        task.provider_task_id AS providerTaskId,
        task.result_asset_id AS resultAssetId,
        task.state AS taskState
      FROM generation_tasks AS task
      WHERE task.canvas_id = ?
    `).get(canvasId, canvasId, canvasId, canvasId) as {
      attempts: number;
      providerTaskId: string;
      resultAssetId: string;
      runs: number;
      tasks: number;
      taskState: string;
    };
    database.close();
    const mediaPosts = providerRequests.filter(({ method, originalUrl }) =>
      method === "POST" &&
      new URL(originalUrl).pathname === "/v1/media/generate"
    );
    expect(mediaPosts).toHaveLength(1);
    const mediaBody = JSON.parse(mediaPosts[0]!.body) as {
      images?: string[];
      model?: string;
      params?: Record<string, unknown>;
      prompt?: string;
    };
    expect(mediaBody).toMatchObject({
      model: "tt-image-2",
      params: { n: 1, quality: "auto", size: "1440x2560" },
      prompt,
    });
    expect((mediaBody.params as { images?: string[] }).images).toHaveLength(1);
    expect(providerRequests.filter(({ originalUrl }) =>
      new URL(originalUrl).pathname === "/v1/skills/task-status"
    )).toHaveLength(1);
    expect(providerRequests.filter(({ originalUrl }) =>
      new URL(originalUrl).pathname === "/v1/media/status"
    )).toHaveLength(1);
    expect(providerRequests.filter(({ originalUrl }) =>
      new URL(originalUrl).pathname === "/v1/results/tt-image-v071.png"
    )).toHaveLength(1);
    expect({
      attempts: evidence.attempts,
      providerTaskId: evidence.providerTaskId,
      refreshedState: refreshed.state,
      refreshedTaskId: refreshed.nodes[0]?.taskId,
      resultAssetReady: Boolean(evidence.resultAssetId),
      runs: evidence.runs,
      state: terminal.state,
      taskState: evidence.taskState,
      tasks: evidence.tasks,
      terminalTaskId: terminal.nodes[0]?.taskId,
    }).toEqual({
      attempts: 1,
      providerTaskId: "tt_image_task_v071_once",
      refreshedState: "success",
      refreshedTaskId: terminal.nodes[0]?.taskId,
      resultAssetReady: true,
      runs: 1,
      state: "success",
      taskState: "success",
      tasks: 1,
      terminalTaskId: expect.any(String),
    });
  } finally {
    await app?.close();
    await close(provider);
    globalThis.fetch = originalFetch;
    if (previousRelayMediaFetcher === undefined) {
      delete process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER;
    } else {
      process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = previousRelayMediaFetcher;
    }
    if (previousBypass === undefined) {
      delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    } else {
      process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
    }
  }
});

test("v0.7.4 dynamic image output satisfies Grok Video first-frame admission", async () => {
  const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
  const previousRelayMediaFetcher =
    process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER;
  const originalFetch = globalThis.fetch;
  const providerRequests: Array<{
    body: string;
    method: string;
    originalUrl: string;
  }> = [];
  let app: ViteDevServer | undefined;
  let provider: Server | undefined;
  try {
    const resultVideo = await readFile(new URL(
      "../client/public/fixtures/video-success.mp4",
      import.meta.url,
    ));
    process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
    process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = "1";
    provider = createHttpServer(async (incoming, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const url = new URL(incoming.url ?? "/", providerOrigin);
      response.setHeader("Content-Type", "application/json");
      if (incoming.method === "GET" && url.pathname === "/v1/skills/models") {
        response.statusCode = 200;
        response.end(JSON.stringify({
          models: [{
            display_name: "TT Image 2",
            name: "tt-image-2",
            output_modalities: ["image"],
            protocols: ["media-generate"],
            type: "图片",
          }, {
            display_name: "Grok Video 3",
            name: "grok-video-3",
            output_modalities: ["video"],
            protocols: ["media-generate"],
            type: "视频",
          }],
          total: 2,
          type: "list",
        }));
        return;
      }
      if (incoming.method === "GET" && url.pathname === "/v1/models") {
        response.statusCode = 200;
        response.end(JSON.stringify({
          data: [{ id: "tt-image-2" }, { id: "grok-video-3" }],
        }));
        return;
      }
      if (incoming.method === "POST" && url.pathname === "/v1/media/generate") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          model?: string;
        };
        response.statusCode = 200;
        response.end(JSON.stringify({
          task_id: body.model === "grok-video-3"
            ? "grok_video_dynamic_first_frame_once"
            : "tt_image_dynamic_first_frame_once",
        }));
        return;
      }
      if (incoming.method === "GET" && url.pathname === "/v1/skills/task-status") {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "official route required" }));
        return;
      }
      if (incoming.method === "GET" && url.pathname === "/v1/media/status") {
        const video = url.searchParams.get("task_id") ===
          "grok_video_dynamic_first_frame_once";
        response.statusCode = 200;
        response.end(JSON.stringify({
          is_final: true,
          result_type: video ? "video" : "image",
          result_url: video
            ? "https://api.lk888.test/v1/results/dynamic-first-frame.mp4"
            : "https://api.lk888.test/v1/results/dynamic-first-frame.png",
          state: "success",
        }));
        return;
      }
      if (incoming.method === "GET" && url.pathname === "/v1/results/dynamic-first-frame.png") {
        response.statusCode = 200;
        response.setHeader("Content-Length", String(tinyPng.byteLength));
        response.setHeader("Content-Type", "image/png");
        response.end(tinyPng);
        return;
      }
      if (incoming.method === "GET" && url.pathname === "/v1/results/dynamic-first-frame.mp4") {
        response.statusCode = 200;
        response.setHeader("Content-Length", String(resultVideo.byteLength));
        response.setHeader("Content-Type", "video/mp4");
        response.end(resultVideo);
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "unknown safe-test route" }));
    });
    await listen(provider, providerPort);
    globalThis.fetch = (async (input, init) => {
      const originalUrl = input instanceof Request ? input.url : String(input);
      const url = new URL(originalUrl);
      if (url.hostname === "api.lk888.test") {
        providerRequests.push({
          body: typeof init?.body === "string" ? init.body : "",
          method: input instanceof Request ? input.method : init?.method ?? "GET",
          originalUrl,
        });
        return originalFetch(
          new URL(url.pathname + url.search, providerOrigin),
          init,
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    app = await createViteServer({
      configFile: "vite.config.ts",
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        hmr: false,
        port: appPort,
        strictPort: true,
        ws: false,
      },
    });
    await app.listen();
    await waitForReady();
    await expectOk(await request("/api/admin/generation-safety", {
      body: JSON.stringify(safetySettings),
      method: "PUT",
    }), "generation safety");
    const imageModelId = await createPublishedTtImageModel();
    const fixtureDatabase = openAppDatabase(
      String(process.env.UNBOUNDRY_DATA_DIR),
    );
    const providerRow = fixtureDatabase.prepare(`
      SELECT provider_profile_id AS providerProfileId
      FROM model_profiles WHERE id = ?
    `).get(imageModelId) as { providerProfileId: string };
    fixtureDatabase.close();
    const videoModelId = await createPublishedGrokVideoModel(
      providerRow.providerProfileId,
    );
    const canvasId = "inc-gen-028-dynamic-first-frame";
    const groupId = "inc-gen-028-dynamic-first-frame-group";
    const imageNodeId = "inc-gen-028-dynamic-first-frame-image";
    const videoNodeId = "inc-gen-028-dynamic-first-frame-video";
    const graph = {
      edges: [{
        data: { inputOrder: 1, inputRole: "first-frame" },
        id: "inc-gen-028-dynamic-first-frame-edge",
        source: imageNodeId,
        target: videoNodeId,
      }],
      nodes: [{
        data: { title: "Dynamic first-frame group" },
        id: groupId,
        type: "group",
      }, {
        data: {
          imageModelId,
          imageParameters: {
            aspectRatio: "9:16",
            inputMode: "text",
            outputCount: 1,
            quality: "2k",
          },
          imagePrompt: "Create the first frame",
          imagePromptReady: true,
          title: "Generated first frame",
        },
        id: imageNodeId,
        parentId: groupId,
        type: "image",
      }, {
        data: {
          title: "Grok video from dynamic first frame",
          videoModelId,
          videoParameters: {
            aspectRatio: "9:16",
            duration: 6,
            generateAudio: true,
            inputMode: "image",
            outputCount: 1,
            resolution: "720p",
          },
          videoPrompt: "Animate the generated first frame",
          videoPromptReady: true,
        },
        id: videoNodeId,
        parentId: groupId,
        type: "video",
      }],
    };
    await expectOk(await request(`/api/canvas/${canvasId}`, {
      body: JSON.stringify({
        ...graph,
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      method: "PUT",
    }), "dynamic first-frame canvas");
    const semantic = compileFrozenWorkflowSemanticPlan({ ...graph, groupId });
    const createStartedAt = Date.now();
    const createResponse = await expectOk(await request("/api/workflow-runs", {
      body: JSON.stringify({
        canvasId,
        clientSemanticFingerprint: semantic.semanticFingerprint,
        groupId,
      }),
      method: "POST",
    }), "dynamic first-frame workflow create");
    expect(createResponse.status).toBe(202);
    expect(Date.now() - createStartedAt).toBeLessThan(15_000);
    const created = await createResponse.json() as { id: string };
    const terminal = await waitForTerminalRun(created.id, 45_000);
    const readCheckpoints: string[] = [];
    setDuringCurrentDatabaseOpenForTests((checkpoint) => {
      readCheckpoints.push(checkpoint);
    });
    try {
      expect(getWorkflowRun("__test__", created.id)?.id).toBe(created.id);
      expect(listWorkflowRuns("__test__", canvasId).map(({ id }) => id))
        .toContain(created.id);
    } finally {
      setDuringCurrentDatabaseOpenForTests(undefined);
    }
    expect(readCheckpoints).toContain("inspection-schema-validated");
    expect(readCheckpoints).not.toContain("before-writer-sidecar-validation");
    const evidenceDatabase = new DatabaseSync(
      `${process.env.UNBOUNDRY_DATA_DIR}/unboundry.sqlite`,
      { readOnly: true },
    );
    const evidence = evidenceDatabase.prepare(`
      SELECT
        (SELECT COUNT(*) FROM generation_tasks WHERE canvas_id = ?) AS tasks,
        (SELECT COUNT(*) FROM generation_provider_attempts AS attempt
          JOIN generation_tasks AS task ON task.id = attempt.task_id
          WHERE task.canvas_id = ?) AS attempts,
        (SELECT COUNT(*) FROM workflow_runs WHERE canvas_id = ?) AS runs
    `).get(canvasId, canvasId, canvasId) as {
      attempts: number;
      runs: number;
      tasks: number;
    };
    const videoTask = evidenceDatabase.prepare(`
      SELECT parameters FROM generation_tasks
      WHERE canvas_id = ? AND node_id = ?
    `).get(canvasId, videoNodeId) as { parameters: string };
    evidenceDatabase.close();
    const videoParameters = JSON.parse(videoTask.parameters) as {
      inputs?: Array<{ kind: string; role: string }>;
    };
    const mediaPosts = providerRequests.filter(({ method, originalUrl }) =>
      method === "POST" &&
      new URL(originalUrl).pathname === "/v1/media/generate"
    );
    expect({
      attempts: evidence.attempts,
      providerPosts: mediaPosts.length,
      runs: evidence.runs,
      state: terminal.state,
      tasks: evidence.tasks,
      videoFirstFrameRole: videoParameters.inputs?.find(({ kind }) =>
        kind === "image"
      )?.role,
    }).toEqual({
      attempts: 2,
      providerPosts: 2,
      runs: 1,
      state: "success",
      tasks: 2,
      videoFirstFrameRole: "first-frame",
    });
    const videoPost = mediaPosts.find(({ body }) =>
      JSON.parse(body).model === "grok-video-3"
    );
    expect(JSON.parse(videoPost!.body)).toMatchObject({
      model: "grok-video-3",
      params: { images: [expect.any(String)] },
    });
  } finally {
    await app?.close();
    await close(provider);
    globalThis.fetch = originalFetch;
    if (previousRelayMediaFetcher === undefined) {
      delete process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER;
    } else {
      process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = previousRelayMediaFetcher;
    }
    if (previousBypass === undefined) {
      delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    } else {
      process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
    }
  }
});

test("INC-GEN-026 terminal Provider failure is monotonic across every recovery sweep", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-inc-gen-026-terminal-"));
  const store = createGenerationTaskStore(directory);
  try {
    const task = store.create({
      canvasId: "inc-gen-026-terminal-canvas",
      idempotencyKey: "inc-gen-026-terminal-task",
      kind: "video",
      model: "inc-gen-026-terminal-model",
      modelConfiguration: {
        modelId: "inc-gen-026-terminal-model",
        providerDriver: "volcengine-ark",
        providerModelId: "inc-gen-026-terminal-provider-model",
        providerProfileId: "inc-gen-026-terminal-provider",
        providerProtocol: "native",
      },
      nodeId: "inc-gen-026-terminal-node",
      ownerId: "__test__",
      parameters: { inputSchemaVersion: 1, inputs: [] },
      prompt: "terminal Provider failure must not restart",
      providerModelId: "inc-gen-026-terminal-provider-model",
      providerProfileId: "inc-gen-026-terminal-provider",
    }).task;
    const running = store.transition(task.id, "running")!;
    store.recordProviderAttempt(running.id);
    store.setProviderTaskId(running.id, "inc-gen-026-terminal-provider-task");
    store.transition(running.id, "failed", {
      code: "PROVIDER_FAILED",
      message: "Provider reported a terminal failed state",
    });
    const database = new DatabaseSync(join(directory, "unboundry.sqlite"));
    const aged = new Date(Date.now() - 3 * 60_000).toISOString();
    database.prepare(`
      UPDATE generation_tasks SET updated_at = ? WHERE id = ?
    `).run(aged, task.id);
    const before = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM generation_task_events WHERE task_id = ?) AS events,
        attempt.outcome,
        attempt.failure_code AS failureCode,
        attempt.finished_at AS finishedAt,
        task.state,
        task.updated_at AS updatedAt
      FROM generation_tasks AS task
      JOIN generation_provider_attempts AS attempt
        ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
      WHERE task.id = ?
    `).get(task.id, task.id);
    database.close();
    const launched: string[] = [];
    await runGenerationRecoverySweep({
      launch: (taskId) => launched.push(taskId),
      store,
    });
    const verify = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    const after = verify.prepare(`
      SELECT
        (SELECT COUNT(*) FROM generation_task_events WHERE task_id = ?) AS events,
        attempt.outcome,
        attempt.failure_code AS failureCode,
        attempt.finished_at AS finishedAt,
        task.state,
        task.updated_at AS updatedAt
      FROM generation_tasks AS task
      JOIN generation_provider_attempts AS attempt
        ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
      WHERE task.id = ?
    `).get(task.id, task.id);
    verify.close();
    expect(launched).toEqual([]);
    expect(after).toEqual({
      ...(before as Record<string, unknown>),
      failureCode: "PROVIDER_FAILED",
      finishedAt: expect.any(String),
      outcome: "provider-failed",
      state: "failed",
    });
    const writable = new DatabaseSync(join(directory, "unboundry.sqlite"));
    writable.prepare(`
      UPDATE generation_tasks SET state = 'recovering' WHERE id = ?
    `).run(task.id);
    writable.close();
    const startupLaunches: string[] = [];
    recoverGenerationTasksAtStartupForRuntimeTest({
      launch: (taskId) => startupLaunches.push(taskId),
      store,
    });
    expect(startupLaunches).toEqual([]);
    expect(store.get(task.id)).toMatchObject({
      errorCode: "PROVIDER_FAILED",
      state: "failed",
    });
    const repaired = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    const repairedEvents = repaired.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?
    `).get(task.id);
    repaired.close();
    recoverGenerationTasksAtStartupForRuntimeTest({
      launch: (taskId) => startupLaunches.push(taskId),
      store,
    });
    const repeated = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    expect(repeated.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?
    `).get(task.id)).toEqual(repairedEvents);
    repeated.close();

    const cancelledTask = store.create({
      canvasId: "inc-gen-026-cancelled-canvas",
      idempotencyKey: "inc-gen-026-cancelled-task",
      kind: "audio",
      modelConfiguration: {
        modelExecutionAdapterId: "mureka-audio",
        providerDriver: "mureka",
        providerProtocol: "native",
      },
      nodeId: "inc-gen-026-cancelled-node",
      ownerId: "__test__",
      prompt: "Provider cancellation is terminal",
      providerModelId: "inc-gen-026-cancelled-provider-model",
      providerProfileId: "inc-gen-026-cancelled-provider",
    }).task;
    const cancelledRunning = store.transition(cancelledTask.id, "running")!;
    store.recordProviderAttempt(cancelledRunning.id);
    store.setProviderTaskId(
      cancelledRunning.id,
      "inc-gen-026-cancelled-provider-task",
    );
    store.transition(cancelledRunning.id, "cancelled", {
      code: "PROVIDER_CANCELLED",
      message: "Provider confirmed cancellation",
    });
    expect(store.get(cancelledTask.id)).toMatchObject({ state: "cancelled" });
    expect(store.getProviderAttemptForTask(cancelledTask.id)).toMatchObject({
      failureCode: "PROVIDER_CANCELLED",
      finishedAt: expect.any(String),
      outcome: "provider-failed",
    });
  } finally {
    store.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("INC-GEN-026 historical terminal settlement is manifest-fenced and repeat apply is a no-op", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-inc-gen-026-inspect-"));
  const databasePath = join(directory, "unboundry.sqlite");
  const evidencePath = join(directory, "terminal-evidence.json");
  const blockedManifestPath = join(directory, "blocked-attempt-settlement-manifest.json");
  const manifestPath = join(directory, "attempt-settlement-manifest.json");
  const store = createGenerationTaskStore(directory);
  let taskId = "";
  try {
    const task = store.create({
      canvasId: "inc-gen-026-inspect-canvas",
      idempotencyKey: "inc-gen-026-inspect-task",
      kind: "video",
      model: "inc-gen-026-inspect-model",
      modelConfiguration: {
        modelId: "inc-gen-026-inspect-model",
        providerDriver: "volcengine-ark",
        providerModelId: "inc-gen-026-inspect-provider-model",
        providerProfileId: "inc-gen-026-inspect-provider",
        providerProtocol: "native",
      },
      nodeId: "inc-gen-026-inspect-node",
      ownerId: "__test__",
      prompt: "settle historical terminal evidence",
      providerModelId: "inc-gen-026-inspect-provider-model",
      providerProfileId: "inc-gen-026-inspect-provider",
    }).task;
    taskId = task.id;
    const running = store.transition(task.id, "running")!;
    store.recordProviderAttempt(running.id);
    store.setProviderTaskId(running.id, "inc-gen-026-inspect-provider-task");
    store.transition(running.id, "failed", {
      code: "GENERATION_FAILED",
      message: "Provider returned a terminal failed state",
    });
    const database = new DatabaseSync(databasePath);
    database.prepare(`
      UPDATE generation_provider_attempts
      SET outcome = 'response-received', failure_code = 'GENERATION_FAILED',
        finished_at = NULL
      WHERE task_id = ? AND execution_attempt = 1
    `).run(task.id);
    const evidenceRow = database.prepare(`
      SELECT
        task.id AS task_id, task.owner_id, task.state AS task_state,
        task.error_code, task.error_message, task.provider_task_id AS task_provider_task_id,
        task.updated_at, attempt.execution_attempt, attempt.provider_profile_id,
        attempt.provider_model_id, attempt.outcome,
        attempt.provider_task_id AS attempt_provider_task_id,
        attempt.failure_code, attempt.finished_at
      FROM generation_tasks AS task
      JOIN generation_provider_attempts AS attempt
        ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
      WHERE task.id = ?
    `).get(task.id) as Record<string, unknown>;
    const rowEvidence = {
      attempt: {
        executionAttempt: Number(evidenceRow.execution_attempt),
        failureCode: evidenceRow.failure_code,
        finishedAt: evidenceRow.finished_at,
        outcome: evidenceRow.outcome,
        providerModelId: evidenceRow.provider_model_id,
        providerProfileId: evidenceRow.provider_profile_id,
        providerTaskId: evidenceRow.attempt_provider_task_id,
      },
      task: {
        errorCode: evidenceRow.error_code,
        errorMessage: evidenceRow.error_message,
        id: evidenceRow.task_id,
        ownerId: evidenceRow.owner_id,
        providerTaskId: evidenceRow.task_provider_task_id,
        state: evidenceRow.task_state,
        updatedAt: evidenceRow.updated_at,
      },
    };
    const before = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM generation_task_events WHERE task_id = ?) AS events,
        attempt.provider_task_id AS attemptProviderTaskId,
        task.provider_task_id AS taskProviderTaskId
      FROM generation_tasks AS task
      JOIN generation_provider_attempts AS attempt
        ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
      WHERE task.id = ?
    `).get(task.id, task.id);
    database.close();
    store.close();
    const databaseDetails = await stat(databasePath, { bigint: true });
    const terminalObservation = {
      adapterId: "ark-video",
      executionAttempt: 1,
      failureCode: "GENERATION_FAILED",
      kind: "provider-terminal-failed",
      providerTaskId: "inc-gen-026-inspect-provider-task",
      rowFingerprint: fixtureFingerprint(rowEvidence),
      taskId: task.id,
    };
    const evidenceBase = {
      database: {
        device: databaseDetails.dev.toString(),
        inode: databaseDetails.ino.toString(),
        path: databasePath,
        schemaVersion: 43,
      },
      evidenceSchemaVersion: 1,
      observations: [terminalObservation],
      sourceReports: [{
        pathLabel: "synthetic-safe-test-provider-terminal-observation",
        sha256: fixtureFingerprint(terminalObservation),
      }],
    };
    await writeFile(evidencePath, `${JSON.stringify({
      ...evidenceBase,
      observations: [],
    }, null, 2)}\n`, { mode: 0o600 });
    const blockedInspection = JSON.parse((await executeFile(process.execPath, [
      join(process.cwd(), "scripts/inspect-inc-gen-026-attempt-settlements.mjs"),
      "--data-dir",
      directory,
      "--evidence",
      evidencePath,
      "--manifest-out",
      blockedManifestPath,
    ], { cwd: process.cwd(), env: process.env })).stdout);
    expect(blockedInspection).toMatchObject({
      blockedCount: 1,
      entryCount: 0,
      ok: true,
    });
    await writeFile(evidencePath, `${JSON.stringify({
      ...evidenceBase,
      observations: [terminalObservation],
    }, null, 2)}\n`, { mode: 0o600 });

    const inspected = await executeFile(process.execPath, [
      join(process.cwd(), "scripts/inspect-inc-gen-026-attempt-settlements.mjs"),
      "--data-dir",
      directory,
      "--evidence",
      evidencePath,
      "--manifest-out",
      manifestPath,
    ], { cwd: process.cwd(), env: process.env });
    const inspection = JSON.parse(inspected.stdout);
    expect(inspection).toMatchObject({ blockedCount: 0, entryCount: 1, ok: true });
    const applyArguments = [
      join(process.cwd(), "scripts/apply-inc-gen-026-attempt-settlements.mjs"),
      "--apply",
      "--data-dir",
      directory,
      "--manifest",
      manifestPath,
      "--manifest-sha256",
      inspection.manifestSha256,
    ];
    const first = JSON.parse((await executeFile(process.execPath, applyArguments, {
      cwd: process.cwd(),
      env: process.env,
    })).stdout);
    const second = JSON.parse((await executeFile(process.execPath, applyArguments, {
      cwd: process.cwd(),
      env: process.env,
    })).stdout);
    expect(first).toMatchObject({ applied: 1, historyPreserved: true, noOp: 0, ok: true });
    expect(second).toMatchObject({ applied: 0, historyPreserved: true, noOp: 1, ok: true });
    const verify = new DatabaseSync(join(directory, "unboundry.sqlite"), { readOnly: true });
    const after = verify.prepare(`
      SELECT
        (SELECT COUNT(*) FROM generation_task_events WHERE task_id = ?) AS events,
        attempt.failure_code AS failureCode,
        attempt.finished_at AS finishedAt,
        attempt.outcome,
        attempt.provider_task_id AS attemptProviderTaskId,
        task.provider_task_id AS taskProviderTaskId,
        task.state
      FROM generation_tasks AS task
      JOIN generation_provider_attempts AS attempt
        ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
      WHERE task.id = ?
    `).get(taskId, taskId) as Record<string, unknown>;
    verify.close();
    expect(after).toEqual({
      ...(before as Record<string, unknown>),
      failureCode: "GENERATION_FAILED",
      finishedAt: expect.any(String),
      outcome: "provider-failed",
      state: "failed",
    });
  } finally {
    try {
      store.close();
    } catch {
      // The test closes the store before the read-only manifest inspection.
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test("INC-GEN-026 OpenRouter image uses the durable deferred-publication result-save path", async () => {
  const source = await readFile("server/generationTasks.ts", "utf8");
  const start = source.indexOf("if (protocol === \"native\")");
  const end = source.indexOf(
    "throw new RelayProviderError(\"FORMAT\")",
    start,
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const openRouterNativeBranch = source.slice(start, end);
  expect(openRouterNativeBranch).toContain("attemptProviderResultSave({");
  expect(openRouterNativeBranch).toContain(
    "synchronousResponseExecutionAttempt: running.attempt",
  );
  const gateStart = openRouterNativeBranch.indexOf(
    "const saved = await attemptProviderResultSave({",
  );
  const gateEnd = openRouterNativeBranch.indexOf(
    "if (!saved) return;",
    gateStart,
  );
  expect(gateStart).toBeGreaterThan(-1);
  expect(gateEnd).toBeGreaterThan(gateStart);
  const openRouterSaveGate = openRouterNativeBranch.slice(gateStart, gateEnd);
  expect(openRouterSaveGate).toContain("await saveGeneratedPng({");
  expect(openRouterSaveGate).toContain(
    "await commitSavedGenerationMedia(savedMedia)",
  );
  expect(openRouterNativeBranch.slice(gateEnd)).not.toContain(
    "commitSavedGenerationMedia(savedMedia)",
  );

  const relayStart = source.indexOf("async function executeRelayGptImageTask");
  const relayEnd = source.indexOf("async function executeImageTask", relayStart);
  expect(relayStart).toBeGreaterThan(-1);
  expect(relayEnd).toBeGreaterThan(relayStart);
  expect(source.slice(relayStart, relayEnd)).toContain(
    "synchronousResponseExecutionAttempt: running.attempt",
  );
});
