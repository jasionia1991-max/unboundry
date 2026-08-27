import { expect, test } from "./safe-test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compileModelContractPoll,
  compileModelContractRequest,
  compileModelExecutionContract,
  selectExecutionMode,
} from "../server/modelExecutionContractCompiler";
import {
  assertModelReleaseRevisionIntegrity,
  ModelContractConflictError,
  markModelContractsRequired,
  modelContractsRequired,
  modelContractState,
  publishModelContract,
  rollbackModelContract,
  saveModelContractDraft,
  setModelContractRevoked,
  validateModelContractDocument,
  validateModelContractDraft,
} from "../server/modelReleaseRevisionStore";
import { defaultModelReleaseDocument } from "../server/modelReleaseDefaults";
import { defaultParameterSchema } from "../types/modelParameters";
import {
  pollContractRelayMediaTask,
  submitContractRelayMedia,
} from "../server/relayProviderAdapters";
import { modelReleaseBootstrapActorUserId } from "../server/modelReleaseBootstrap";

const gkContract = {
  connectorFamily: "generic-async-media",
  connectorVersion: 1,
  create: { method: "POST", path: "/v1/media/generate", taskIdPath: "task_id" },
  modes: [
    {
      evidence: "UNKNOWN",
      id: "text-to-video",
      prompt: "required",
      roles: [],
      bindings: [
        { source: { kind: "model-id" }, target: { location: "json", path: "model" } },
        { source: { kind: "prompt" }, target: { location: "json", path: "prompt" } },
      ],
      runtime: "blocked",
    },
    {
      evidence: "EXACT",
      id: "first-frame-to-video",
      prompt: "required",
      roles: [{ id: "first-frame", kind: "image", minItems: 1, maxItems: 1, ordered: true, shape: "url" }],
      bindings: [
        { source: { kind: "model-id" }, target: { location: "json", path: "model" } },
        { source: { kind: "prompt" }, target: { location: "json", path: "prompt" } },
        { source: { kind: "role", roleId: "first-frame" }, transform: "array", target: { location: "json", path: "params.images" } },
      ],
      runtime: "declarative",
    },
  ],
  poll: { method: "GET", path: "/v1/media/status", taskIdTarget: { location: "query", path: "task_id" } },
  result: { resultPath: "result_url", states: { failed: ["failed"], running: ["pending", "running"], succeeded: ["success"] } },
  version: 1,
} as const;

test("GK contract compiles deterministically and selects exactly one explicit mode", () => {
  const fixtures = [
    ["doubao-seed-2-0-lite-260428", "text", "www.volcengine.com"],
    ["doubao-seedance-2-0-mini-260615", "video", "www.volcengine.com"],
    ["gemini-3-pro-image-preview", "image", "ai.google.dev"],
    ["gpt-image-2", "image", "platform.openai.com"],
    ["grok-imagine-video-1.5-preview", "video", "docs.x.ai"],
    ["kling-v3-omni-cankao", "video", "app.klingai.com"],
    ["mureka-9", "audio", "platform.mureka.ai"],
  ] as const;
  for (const [providerModelId, capability, hostname] of fixtures) {
    const document = defaultModelReleaseDocument({
      capability,
      capabilitySchema: defaultParameterSchema(capability),
      modelId: `model-${providerModelId}`,
      providerDriver: providerModelId.startsWith("doubao-") ? "volcengine-ark" : "multi-protocol-relay",
      providerModelId,
      providerProfileId: "provider-fixture",
      providerProtocol: providerModelId === "gpt-image-2" ? "gpt-image" : "media-generate",
    });
    expect(new URL(document.documentation[0]!.url).hostname).toBe(hostname);
  }
  expect(defaultModelReleaseDocument({
    capability: "video",
    capabilitySchema: defaultParameterSchema("video"),
    modelId: "model-unknown",
    providerDriver: "multi-protocol-relay",
    providerModelId: "kwvideo-v2",
    providerProfileId: "provider-fixture",
    providerProtocol: "media-generate",
  }).documentation).toEqual([]);
  for (const [providerModelId, capability] of [
    ["doubao-tts-2.0", "audio"],
    ["grok-video-3", "video"],
    ["suno-v4.5", "audio"],
  ] as const) {
    expect(defaultModelReleaseDocument({
      capability,
      capabilitySchema: defaultParameterSchema(capability),
      modelId: `model-no-exact-doc-${providerModelId}`,
      providerDriver: "multi-protocol-relay",
      providerModelId,
      providerProfileId: "provider-fixture",
      providerProtocol: "media-generate",
    }).documentation).toEqual([]);
  }
  const first = compileModelExecutionContract(gkContract);
  const second = compileModelExecutionContract(structuredClone(gkContract));
  expect(first.hash).toBe(second.hash);
  expect(first.preview).toMatchObject({
    method: "POST",
    path: "/v1/media/generate",
  });
  expect(() => selectExecutionMode(first.contract, { prompt: "衣服转身", inputs: [] }))
    .toThrow(/缺少精确Provider证据/);
  expect(selectExecutionMode(first.contract, {
    prompt: "衣服转身",
    inputs: [{ kind: "image", order: 1, roleId: "first-frame", value: "https://example.invalid/source.png" }],
  }).id).toBe("first-frame-to-video");
  expect(() => selectExecutionMode(first.contract, {
    prompt: "衣服转身",
    inputs: [
      { kind: "image", order: 1, roleId: "first-frame", value: "https://example.invalid/a.png" },
      { kind: "image", order: 2, roleId: "first-frame", value: "https://example.invalid/b.png" },
    ],
  })).toThrow(/唯一输入模式/);
  expect(compileModelContractRequest(first.contract, {
    inputs: [{ kind: "image", order: 1, roleId: "first-frame", value: "https://example.invalid/source.png" }],
    modelId: "grok-video-3",
    parameters: {},
    prompt: "衣服转身",
  })).toEqual({
    body: {
      model: "grok-video-3",
      params: { images: ["https://example.invalid/source.png"] },
      prompt: "衣服转身",
    },
    method: "POST",
    path: "/v1/media/generate",
    query: {},
  });
  expect(compileModelContractPoll(first.contract, "task-example")).toEqual({
    body: {}, method: "GET", path: "/v1/media/status", query: { task_id: "task-example" },
  });
  const capabilitySchema = defaultParameterSchema("video");
  const release = defaultModelReleaseDocument({
    capability: "video",
    capabilitySchema,
    modelId: "model-gk-video-3",
    providerDriver: "multi-protocol-relay",
    providerModelId: "grok-video-3",
    providerProfileId: "provider-relay",
    providerProtocol: "media-generate",
  });
  const compiledRelease = compileModelExecutionContract(release.executionContract);
  expect(() => compileModelContractRequest(compiledRelease.contract, {
    inputs: [],
    modelId: "grok-video-3",
    parameters: {
      aspectRatio: "16:9",
      duration: 5,
      generateAudio: true,
      resolution: "480p",
    },
    prompt: "衣服转身",
  })).toThrow(/缺少精确Provider证据/);
  expect(compiledRelease.contract.modes).toEqual(expect.arrayContaining([
    expect.objectContaining({ evidence: "UNKNOWN", id: "text-to-video", runtime: "blocked" }),
    expect.objectContaining({ evidence: "EXACT", id: "first-frame-to-video", runtime: "declarative" }),
  ]));
});

test("compiler rejects executable, secret, arbitrary network and ambiguous contracts", () => {
  for (const mutation of [
    { ...gkContract, create: { ...gkContract.create, path: "https://evil.invalid/v1" } },
    { ...gkContract, create: { ...gkContract.create, path: "/v1/%2e%2e/admin" } },
    { ...gkContract, poll: undefined },
    { ...gkContract, modes: [{ ...gkContract.modes[0], bindings: [{ source: { kind: "env", name: "SECRET" }, target: { location: "header", path: "Authorization" } }] }] },
    { ...gkContract, modes: [gkContract.modes[0], { ...gkContract.modes[1], bindings: gkContract.modes[1].bindings.slice(0, 2) }] },
    { ...gkContract, modes: [gkContract.modes[0], { ...gkContract.modes[1], roles: [{ ...gkContract.modes[1].roles[0], shape: "file-id" }] }] },
    { ...gkContract, modes: [gkContract.modes[0], { ...gkContract.modes[1], bindings: gkContract.modes[1].bindings.map((item, index) => index === 2 ? { ...item, target: { location: "query", path: "params.images" } } : item) }] },
    { ...gkContract, modes: [{ ...gkContract.modes[0], bindings: [...gkContract.modes[0].bindings, { source: { kind: "constant", value: "bearer-secret-token" }, target: { location: "json", path: "params.mode" } }] }, gkContract.modes[1]] },
    { ...gkContract, modes: [...gkContract.modes, { ...gkContract.modes[0], id: "duplicate-text" }] },
    {
      ...gkContract,
      modes: [
        gkContract.modes[0],
        { ...gkContract.modes[0], id: "overlapping-optional", prompt: "optional" },
      ],
    },
  ]) {
    expect(() => compileModelExecutionContract(mutation as never)).toThrow();
  }
  const stringRole = compileModelExecutionContract({
    ...gkContract,
    modes: [gkContract.modes[0], {
      ...gkContract.modes[1],
      bindings: gkContract.modes[1].bindings.map((item, index) =>
        index === 2 ? { ...item, transform: "string" as const } : item
      ),
      roles: [{ ...gkContract.modes[1].roles[0], maxItems: 2 }],
    }],
  });
  expect(() => compileModelContractRequest(stringRole.contract, {
    inputs: [
      { kind: "image", order: 1, roleId: "first-frame", value: "https://example.invalid/a.png" },
      { kind: "image", order: 2, roleId: "first-frame", value: "https://example.invalid/b.png" },
    ],
    modelId: "grok-video-3",
    parameters: {},
    prompt: "衣服转身",
  })).toThrow(/多值素材/);
});

test("release validation binds runtime ownership and rejects credential-bearing sources", () => {
  const store = contractStore();
  try {
    const spoofed = {
      ...releaseDocument("model-suno"),
      providerModelId: "suno-v4",
    } as const;
    const spoofedDraft = saveModelContractDraft(store, "admin-a", spoofed, 0);
    expect(() => validateModelContractDraft(
      store,
      "admin-a",
      spoofed.modelId,
      spoofedDraft.draftVersion,
    )).toThrow(/runtime/);
    const secretUrl = {
      ...releaseDocument("model-gk-secret-url"),
      documentation: [{
        checkedAt: "2026-08-26",
        url: "https://provider.invalid/docs?api_key=secret",
      }],
    } as const;
    const secretDraft = saveModelContractDraft(store, "admin-a", secretUrl, 0);
    expect(() => validateModelContractDraft(
      store,
      "admin-a",
      secretUrl.modelId,
      secretDraft.draftVersion,
    )).toThrow(/官方来源/);
    const schema = defaultParameterSchema("video");
    const exact = defaultModelReleaseDocument({
      capability: "video",
      capabilitySchema: schema,
      modelId: "model-gk-exact-role",
      providerDriver: "multi-protocol-relay",
      providerModelId: "grok-video-3",
      providerProfileId: "provider-relay",
      providerProtocol: "media-generate",
    });
    const extraRole = {
      ...exact,
      executionContract: {
        ...exact.executionContract,
        modes: [...exact.executionContract.modes, {
          bindings: [
            { source: { kind: "model-id" as const }, target: { location: "json" as const, path: "model" } },
            { source: { kind: "prompt" as const }, target: { location: "json" as const, path: "prompt" } },
            ...exact.executionContract.modes[0].bindings.filter((item) => item.source.kind === "parameter"),
            { source: { kind: "role" as const, roleId: "last-frame" }, transform: "array" as const, target: { location: "json" as const, path: "params.images" } },
          ],
          id: "last-frame-to-video",
          prompt: "required" as const,
          roles: [{ id: "last-frame", kind: "image" as const, maxItems: 1, minItems: 1, ordered: true, shape: "url" as const }],
        }],
      },
    };
    const extraRoleDraft = saveModelContractDraft(store, "admin-a", extraRole, 0);
    expect(() => validateModelContractDraft(
      store,
      "admin-a",
      extraRole.modelId,
      extraRoleDraft.draftVersion,
    )).toThrow(/GK执行合同/);
    const wrongTarget = {
      ...exact,
      modelId: "model-gk-wrong-target",
      executionContract: {
        ...exact.executionContract,
        modes: exact.executionContract.modes.map((mode) => ({
          ...mode,
          bindings: mode.bindings.map((item) =>
            item.source.kind === "parameter" && item.source.key === "duration"
              ? { ...item, target: { ...item.target, path: "params.not_provider_field" } }
              : item
          ),
        })),
      },
    };
    const wrongTargetDraft = saveModelContractDraft(store, "admin-a", wrongTarget, 0);
    expect(() => validateModelContractDraft(
      store,
      "admin-a",
      wrongTarget.modelId,
      wrongTargetDraft.draftVersion,
    )).toThrow(/GK执行合同/);
  } finally {
    store.close();
  }
});

function contractStore() {
  const store = new DatabaseSync(":memory:");
  store.exec(`
    CREATE TABLE admin_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_user_id TEXT,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  return store;
}

function releaseDocument(modelId = "model-gk-video-3") {
  const baseSchema = defaultParameterSchema("video");
  return {
    capability: "video",
    capabilitySchema: {
      ...baseSchema,
      fields: baseSchema.fields.filter((field) =>
        field.key === "inputMode" || field.key === "outputCount"
      ),
    },
    connectorFamily: "generic-async-media",
    connectorVersion: 1,
    documentation: [{ checkedAt: "2026-08-26", url: "https://provider.invalid/docs" }],
    evidence: "EXACT",
    executionContract: gkContract,
    modelId,
    providerModelId: "grok-video-3",
    providerProfileId: "provider-relay",
    providerProtocol: "media-generate",
    runtime: "declarative",
  } as const;
}

test("draft CAS, validation and atomic immutable publish are audit-backed", () => {
  const actorStore = new DatabaseSync(":memory:");
  try {
    actorStore.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO users (id, role, status, created_at) VALUES
        ('disabled-admin', 'admin', 'disabled', '2026-01-01T00:00:00Z'),
        ('ordinary-user', 'user', 'active', '2026-01-01T00:00:00Z'),
        ('admin-newer', 'admin', 'active', '2026-02-01T00:00:00Z'),
        ('admin-oldest', 'admin', 'active', '2026-01-15T00:00:00Z');
    `);
    expect(modelReleaseBootstrapActorUserId(actorStore)).toBe("admin-oldest");
    actorStore.exec("UPDATE users SET status = 'disabled' WHERE role = 'admin'");
    expect(() => modelReleaseBootstrapActorUserId(actorStore)).toThrow(/活跃管理员/);
  } finally {
    actorStore.close();
  }
  const store = contractStore();
  try {
    store.exec("CREATE TABLE release_target (revision_id TEXT NOT NULL)");
    const directValidation = validateModelContractDocument(releaseDocument());
    expect(directValidation.paidProviderRequests).toBe(0);
    expect(store.prepare("SELECT COUNT(*) AS count FROM admin_audit_events").get())
      .toEqual({ count: 0 });
    const draft = saveModelContractDraft(store, "admin-a", releaseDocument(), 0);
    expect(draft.draftVersion).toBe(1);
    expect(() => saveModelContractDraft(
      store,
      "admin-b",
      releaseDocument(),
      0,
    )).toThrow(ModelContractConflictError);
    const validated = validateModelContractDraft(
      store,
      "admin-a",
      draft.modelId,
      draft.draftVersion,
    );
    expect(validated.validation?.paidProviderRequests).toBe(0);
    expect(validated.validation?.preview.modes).toHaveLength(2);
    expect(validated.validation?.preview.modes[1]).toMatchObject({
      body: {
        model: "grok-video-3",
        params: { images: ["https://example.invalid/first-frame-1"] },
        prompt: "示例提示词",
      },
      method: "POST",
      modeId: "first-frame-to-video",
      path: "/v1/media/generate",
      query: {},
    });
    expect(() => publishModelContract(
      store,
      "admin-a",
      draft.modelId,
      draft.draftVersion,
      (candidate) => {
        store.prepare("INSERT INTO release_target (revision_id) VALUES (?)")
          .run(candidate.revisionId);
        throw new Error("synthetic activation failure");
      },
    )).toThrow(/synthetic activation failure/);
    expect(modelContractState(store, draft.modelId).history).toHaveLength(0);
    expect(store.prepare("SELECT COUNT(*) AS count FROM release_target").get())
      .toEqual({ count: 0 });
    const revision = publishModelContract(
      store,
      "admin-a",
      draft.modelId,
      draft.draftVersion,
      (candidate) => {
        store.prepare("INSERT INTO release_target (revision_id) VALUES (?)")
          .run(candidate.revisionId);
      },
    );
    expect(revision.revisionNumber).toBe(1);
    expect(modelContractState(store, draft.modelId).active?.hash).toBe(revision.hash);
    expect(() => assertModelReleaseRevisionIntegrity(revision)).not.toThrow();
    expect(() => assertModelReleaseRevisionIntegrity({
      ...revision,
      document: {
        ...revision.document,
        documentation: [{
          checkedAt: "2026-08-26",
          url: "https://provider.invalid/tampered-doc",
        }],
      },
    })).toThrow(/哈希/);
    expect(markModelContractsRequired(store, "admin-a", {
      modelIds: [draft.modelId],
      total: 1,
    })).toBe(true);
    expect(modelContractsRequired(store)).toBe(true);
    expect(markModelContractsRequired(store, "admin-a", {
      modelIds: [draft.modelId],
      total: 1,
    })).toBe(false);
    expect(() => publishModelContract(
      store,
      "admin-a",
      draft.modelId,
      draft.draftVersion,
    )).toThrow();
  } finally {
    store.close();
  }
});

test("rollback creates a new revision and revoke affects only new submissions", () => {
  const store = contractStore();
  try {
    const firstDraft = saveModelContractDraft(store, "admin-a", releaseDocument(), 0);
    validateModelContractDraft(store, "admin-a", firstDraft.modelId, 1);
    const first = publishModelContract(store, "admin-a", firstDraft.modelId, 1);
    const secondDocument = {
      ...releaseDocument(),
      documentation: [{ checkedAt: "2026-08-26", url: "https://provider.invalid/docs/v2" }],
    };
    const secondDraft = saveModelContractDraft(store, "admin-a", secondDocument, 1);
    validateModelContractDraft(store, "admin-a", secondDraft.modelId, 2);
    const second = publishModelContract(store, "admin-a", secondDraft.modelId, 2);
    const reusedRoleDocument = {
      ...releaseDocument(),
      executionContract: {
        ...gkContract,
        modes: [
          gkContract.modes[0],
          {
            ...gkContract.modes[1],
            roles: [{ ...gkContract.modes[1].roles[0], kind: "video" }],
          },
        ],
      },
    } as const;
    const reusedRoleDraft = saveModelContractDraft(
      store,
      "admin-a",
      reusedRoleDocument,
      2,
    );
    expect(() => validateModelContractDraft(
      store,
      "admin-a",
      second.modelId,
      reusedRoleDraft.draftVersion,
    )).toThrow(/GK执行合同/);
    setModelContractRevoked(store, "admin-a", second.modelId, true);
    expect(modelContractState(store, second.modelId).active).toBeUndefined();
    const rolledBack = rollbackModelContract(
      store,
      "admin-a",
      second.modelId,
      first.revisionId,
    );
    expect(rolledBack.revisionNumber).toBe(3);
    expect(rolledBack.predecessorRevisionId).toBe(second.revisionId);
    expect(modelContractState(store, second.modelId).revoked).toBe(true);
    expect(modelContractState(store, second.modelId).active).toBeUndefined();
    const frozenTaskSnapshot = structuredClone(second);
    expect(frozenTaskSnapshot.revisionId).toBe(second.revisionId);
    setModelContractRevoked(store, "admin-a", second.modelId, false);
    expect(modelContractState(store, second.modelId).active?.revisionId)
      .toBe(rolledBack.revisionId);
  } finally {
    store.close();
  }
});

test("GK transport accepts only exact task, status and single-result fields", async () => {
  const calls: Array<{ body?: unknown; url: string }> = [];
  const responses = [
    { task_id: "task-gk-001" },
    { result_url: "https://cdn.example.test/result.mp4", state: "success" },
  ];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      url: String(input),
    });
    return new Response(JSON.stringify(responses.shift()), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };
  const connection = { apiKey: "fixture-secret", baseUrl: "https://api.example.test" };
  const submission = await submitContractRelayMedia(connection, {
    capability: "video",
    model: "grok-video-3",
    params: { images: ["https://cdn.example.test/first.png"] },
    prompt: "转身展示服装",
    providerProtocol: "media-generate",
  }, gkContract, { fetcher });
  expect(submission.externalTaskId).toBe("task-gk-001");
  const result = await pollContractRelayMediaTask(connection, {
    capability: "video",
    externalTaskId: submission.externalTaskId,
    providerProtocol: "media-generate",
  }, gkContract, { fetcher });
  expect(result).toMatchObject({
    outputs: [{ transientUrl: "https://cdn.example.test/result.mp4" }],
    state: "success",
  });
  expect(calls).toEqual([
    {
      body: {
        model: "grok-video-3",
        params: { images: ["https://cdn.example.test/first.png"] },
        prompt: "转身展示服装",
      },
      url: "https://api.example.test/v1/media/generate",
    },
    { url: "https://api.example.test/v1/media/status?task_id=task-gk-001" },
  ]);
});

test("admin contract workbench is separate, structured and responsive with zero Provider calls", async ({ page }) => {
  const app = readFileSync(join(process.cwd(), "client/src/App.tsx"), "utf8");
  const styles = readFileSync(join(process.cwd(), "client/src/styles.css"), "utf8");
  expect(app).toContain("model-contract-workbench");
  expect(app).toContain("本地验证当前页面｜零写入");
  expect(app).toContain("草稿发生并发冲突，没有覆盖另一位管理员");
  expect(app).toContain("已保存草稿：{hasSavedDraft ? `版本 ${draftVersion}` : \"无\"}");
  expect(app).toContain('code === "MODEL_CONTRACT_DRAFT_CONFLICT"');
  expect(app).toContain("无需先保存，不会发布，也不会调用 Provider");
  expect(app).toContain("发布不会调用 Provider");
  expect(app).toContain("脱敏只读预览");
  expect(app).toContain("三份脱敏只读预览");
  expect(app).not.toContain("模式标识（系统使用）");
  expect(app).not.toContain("角色标识（系统使用）");
  expect(app).toContain("查看差异");
  expect(app).toContain("错误映射");
  expect(app).toContain("fallback合同");
  expect(styles).toContain("@media (max-width: 928px)");
  expect(styles).toContain("grid-template-columns: 210px minmax(0, 1fr) 290px");
  const contractStyles = styles.slice(
    styles.indexOf(".model-contract-page"),
    styles.indexOf(".model-lifecycle-reason"),
  );
  expect(contractStyles).not.toContain("#1fa2dc");
  expect(contractStyles).toContain("appearance: none");
  expect(contractStyles).toContain(".model-contract-page input.admin-compact-checkbox");
  expect(contractStyles).toContain("caret-color: transparent");

  const providerResponse = await page.request.post("/api/admin/providers", {
    data: {
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Contract Fixture Provider",
    },
  });
  expect(providerResponse.status()).toBe(201);
  const provider = (await providerResponse.json()).profile as { id: string };
  const modelResponse = await page.request.post("/api/admin/models", {
    data: {
      capability: "image",
      displayName: "Contract Fixture Model",
      isDefault: true,
      providerModelId: "fixture-image-model",
      providerProfileId: provider.id,
      sortOrder: 1,
      status: "published",
    },
  });
  expect(modelResponse.status()).toBe(201);
  const model = (await modelResponse.json()).model as { id: string };
  await page.goto("/admin/models");
  await expect(
    page.locator("article").filter({ hasText: "Contract Fixture Model" })
      .getByRole("button", { name: "合同工作台" }),
  ).toBeVisible();
  for (const viewport of [
    { height: 720, width: 1280 },
    { height: 900, width: 1440 },
    { height: 1080, width: 1920 },
    { height: 900, width: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/admin/models/${model.id}/contract`);
    await expect(page.getByTestId("model-contract-workbench")).toBeVisible();
    await expect(page.getByRole("button", { name: "新增模式" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新增角色" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新增绑定" }).first()).toBeVisible();
    expect(await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))).toEqual({ client: viewport.width, scroll: viewport.width });
    const actions = await page.locator(".model-contract-actions").boundingBox();
    const editor = await page.locator(".model-contract-editor").boundingBox();
    expect(actions).not.toBeNull();
    expect(editor).not.toBeNull();
    expect(actions!.y).toBeGreaterThan(0);
  }
  const validateButton = page.getByRole("button", { name: "本地验证当前页面｜零写入" });
  await expect(page.getByText("当前页面：无未保存修改 · 已保存草稿：无 · 当前发布版本：无")).toBeVisible();
  await expect(validateButton).toBeEnabled();
  await expect(page.getByText(/当前页面可直接本地验证/).first()).toBeVisible();
  const checkbox = page.locator(".model-contract-page input.admin-compact-checkbox").first();
  await expect(checkbox).toBeVisible();
  expect(await checkbox.evaluate((element) => ({
    appearance: getComputedStyle(element).appearance,
    background: getComputedStyle(element).backgroundColor,
  }))).toEqual({ appearance: "none", background: "rgb(236, 236, 238)" });
  const parameterTrigger = page.locator(".model-contract-page .admin-parameter-select-trigger").first();
  await expect(parameterTrigger).toBeVisible();
  expect(await parameterTrigger.evaluate((element) => ({
    caret: getComputedStyle(element).caretColor,
    height: getComputedStyle(element).height,
  }))).toEqual({ caret: "rgba(0, 0, 0, 0)", height: "34px" });
  await validateButton.click();
  await expect(page.getByText("本地验证通过；Provider 请求为 0。")).toBeVisible();
  await expect(page.getByText("当前页面：无未保存修改 · 已保存草稿：无 · 当前发布版本：无")).toBeVisible();
  await expect(page.locator("#model-contract-preview")).toContainText("fixture-image-model");
  await page.getByRole("button", { name: "已保存草稿", exact: true }).click();
  await expect(page.locator("#model-contract-preview")).toContainText("已保存草稿：无");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存；本次没有调用 Provider。")).toBeVisible();
  await page.getByRole("button", { name: "已保存草稿", exact: true }).click();
  await expect(page.locator("#model-contract-preview")).toContainText("fixture-image-model");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.getByText("当前页面：无未保存修改 · 已保存草稿：无 · 当前发布版本：1")).toBeVisible();
  await expect(validateButton).toBeEnabled();
  await expect(page.getByText("草稿发生并发冲突，没有覆盖另一位管理员。")).toHaveCount(0);
});
