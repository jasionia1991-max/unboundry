import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import {
  clearGenerationSubmissionIntent,
  ensureGenerationTask,
  GENERATION_TASK_MUTATION_TIMEOUT_MS,
  recoverPendingGenerationTask,
  retryGenerationTask,
  type GenerationTaskKind,
  type GenerationTaskSummary,
} from "../client/src/generation/generationTasks";
import {
  createGenerationTaskStore,
  GenerationTaskConflictError,
} from "../server/generationTaskStore";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } satisfies Storage;
}

function accelerateMutationDeadline() {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((
    handler: (...args: unknown[]) => void,
    timeout?: number,
    ...args: unknown[]
  ) => {
    if (timeout === GENERATION_TASK_MUTATION_TIMEOUT_MS) {
      queueMicrotask(() => handler(...args));
      return 0 as unknown as ReturnType<typeof globalThis.setTimeout>;
    }
    return originalSetTimeout(handler, timeout, ...args);
  }) as typeof globalThis.setTimeout;
  return () => {
    globalThis.setTimeout = originalSetTimeout;
  };
}

function task(
  kind: GenerationTaskKind,
  nodeId: string,
  id: string,
  state: GenerationTaskSummary["state"] = "running",
): GenerationTaskSummary {
  return {
    attempt: 1,
    canvasId: "canvas-idempotency-test",
    costCurrency: "CNY",
    createdAt: "2026-08-03T06:00:00.000Z",
    id,
    kind,
    nodeId,
    prompt: "safe prompt",
    state,
    updatedAt: "2026-08-03T06:00:01.000Z",
  };
}

test("generation submission fails closed before preflight when localStorage rejects a new intent", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
  const storage = memoryStorage();
  let storageWrites = 0;
  storage.setItem = () => {
    storageWrites += 1;
    throw new DOMException("storage denied", "QuotaExceededError");
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  let preflights = 0;
  let submissionPosts = 0;
  let exactReads = 0;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (parsed.pathname.endsWith("/by-idempotency")) exactReads += 1;
    if (parsed.pathname.endsWith("/preflight")) preflights += 1;
    if (parsed.pathname === "/api/generation-tasks" && init?.method === "POST") {
      submissionPosts += 1;
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };
  const input = {
    canvasId: "canvas-idempotency-test",
    canvasRevision: 1,
    inputSchemaVersion: 1 as const,
    inputs: [],
    model: "text-model-storage-unavailable",
    nodeId: "text-storage-unavailable-new-intent",
    ownPrompt: "fail closed",
    parameters: { thinking: "disabled" },
    prompt: "fail closed",
  };

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(ensureGenerationTask("text", input)).rejects.toMatchObject({
        code: "GENERATION_INTENT_STORAGE_UNAVAILABLE",
        status: 503,
      });
    }
    expect(storageWrites).toBe(2);
    expect(exactReads).toBe(0);
    expect(preflights).toBe(0);
    expect(submissionPosts).toBe(0);
  } finally {
    clearGenerationSubmissionIntent("text", input.canvasId, input.nodeId, undefined, "", "");
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

for (const [label, corruptRaw] of [
  ["empty", ""],
  ["malformed", "{not-json"],
] as const) {
  test(`a ${label} durable intent repairs only from exact server authority and never posts again`, async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = (globalThis as typeof globalThis & { window?: Window })
      .window;
    const storage = memoryStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage },
    });
    const accountId = `account-corrupt-${label}`;
    const input = {
      canvasId: "canvas-idempotency-test",
      canvasRevision: 2,
      inputSchemaVersion: 1 as const,
      inputs: [],
      model: "text-model-corrupt-intent",
      nodeId: `text-corrupt-intent-${label}`,
      ownPrompt: "recover exact accepted task",
      parameters: { thinking: "disabled" },
      prompt: "recover exact accepted task",
    };
    const identity = {
      generationInputKey: `input-corrupt-${label}`,
      generationOwnershipKey: `ownership-corrupt-${label}`,
      modelInputContractFingerprint: `contract-corrupt-${label}`,
      modelConfigurationRevision: `config-corrupt-${label}`,
      modelReleaseRevision: `revision-corrupt-${label}`,
    };
    const authoritative = {
      ...task("text", input.nodeId, `task-corrupt-${label}`),
      ...identity,
      generationIdentityVersion: 2 as const,
      idempotencyKey: `idempotency-corrupt-${label}`,
    } satisfies GenerationTaskSummary;
    const slot = `unboundry:generation-submission:v2:${encodeURIComponent(accountId)}:${encodeURIComponent(input.canvasId)}:text:${encodeURIComponent(input.nodeId)}`;
    storage.setItem(slot, corruptRaw);
    let authorityReads = 0;
    let exactReads = 0;
    let preflights = 0;
    let submissionPosts = 0;
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(String(url), "http://127.0.0.1");
      if (parsed.pathname.endsWith("/by-idempotency")) {
        exactReads += 1;
        return Response.json({ error: "unexpected exact read" }, { status: 500 });
      }
      if (parsed.pathname.endsWith("/preflight")) {
        preflights += 1;
        return Response.json({ canEnqueue: true, canSubmit: true, problems: [] });
      }
      if (parsed.pathname === "/api/generation-tasks" && init?.method === "POST") {
        submissionPosts += 1;
        return Response.json(authoritative, { status: 202 });
      }
      if (parsed.pathname === "/api/generation-tasks") {
        authorityReads += 1;
        return Response.json({ tasks: [authoritative] });
      }
      throw new Error(`Unexpected request: ${parsed.pathname}`);
    };

    try {
      await expect(ensureGenerationTask(
        "text",
        input,
        accountId,
        undefined,
        identity,
      )).resolves.toMatchObject({
        idempotencyKey: authoritative.idempotencyKey,
        recovered: true,
        task: { id: authoritative.id },
      });
      expect(authorityReads).toBe(1);
      expect(exactReads).toBe(0);
      expect(preflights).toBe(0);
      expect(submissionPosts).toBe(0);
      expect(JSON.parse(storage.getItem(slot) ?? "null")).toMatchObject({
        idempotencyKey: authoritative.idempotencyKey,
        taskId: authoritative.id,
      });
    } finally {
      clearGenerationSubmissionIntent(
        "text",
        input.canvasId,
        input.nodeId,
        undefined,
        accountId,
        "",
      );
      globalThis.fetch = originalFetch;
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
}

test("an existing same-page intent remains exact-GET recoverable when storage becomes unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
  const storage = memoryStorage();
  const durableGet = storage.getItem.bind(storage);
  const durableSet = storage.setItem.bind(storage);
  let storageUnavailable = false;
  storage.getItem = (key) => {
    if (storageUnavailable) throw new DOMException("storage denied", "SecurityError");
    return durableGet(key);
  };
  storage.setItem = (key, value) => {
    if (storageUnavailable) throw new DOMException("storage denied", "SecurityError");
    durableSet(key, value);
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  const input = {
    canvasId: "canvas-idempotency-test",
    canvasRevision: 3,
    inputSchemaVersion: 1 as const,
    inputs: [],
    model: "image-model-memory-recovery",
    nodeId: "image-memory-intent-recovery",
    ownPrompt: "same page recovery",
    parameters: { quality: "high" },
    prompt: "same page recovery",
  };
  let serverTask: GenerationTaskSummary | undefined;
  let exactReads = 0;
  let preflights = 0;
  let submissionPosts = 0;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (parsed.pathname.endsWith("/by-idempotency")) {
      exactReads += 1;
      return serverTask
        ? Response.json(serverTask)
        : Response.json({ error: "not found" }, { status: 404 });
    }
    if (parsed.pathname.endsWith("/preflight")) {
      preflights += 1;
      return Response.json({ canEnqueue: true, canSubmit: true, problems: [] });
    }
    if (parsed.pathname === "/api/generation-tasks" && init?.method === "POST") {
      submissionPosts += 1;
      serverTask = task("image", input.nodeId, "task-memory-intent-recovery");
      return Response.json(serverTask, { status: 202 });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };

  try {
    const created = await ensureGenerationTask("image", input);
    storageUnavailable = true;
    await expect(ensureGenerationTask("image", input)).resolves.toMatchObject({
      idempotencyKey: created.idempotencyKey,
      recovered: true,
      task: { id: created.task.id },
    });
    expect(exactReads).toBe(2);
    expect(preflights).toBe(1);
    expect(submissionPosts).toBe(1);
  } finally {
    storageUnavailable = false;
    clearGenerationSubmissionIntent("image", input.canvasId, input.nodeId, undefined, "", "");
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("shared four-node submission recovers a lost Text POST response and never creates a second task", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  let serverTask: GenerationTaskSummary | undefined;
  let providerRequests = 0;
  let submissionPosts = 0;
  let preflights = 0;
  let submittedKey = "";
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (/volces|openrouter|mureka/i.test(parsed.href)) providerRequests += 1;
    if (parsed.pathname.endsWith("/by-idempotency")) {
      const key = parsed.searchParams.get("idempotencyKey") ?? "";
      return serverTask && key === submittedKey
        ? Response.json(serverTask)
        : Response.json({ error: "not found" }, { status: 404 });
    }
    if (parsed.pathname.endsWith("/preflight")) {
      preflights += 1;
      return Response.json({ canEnqueue: true, canSubmit: true, problems: [] });
    }
    if (parsed.pathname === "/api/generation-tasks" && init?.method === "POST") {
      submissionPosts += 1;
      const body = JSON.parse(String(init.body)) as {
        generationInputKey: string;
        generationOwnershipKey: string;
        idempotencyKey: string;
        kind: GenerationTaskKind;
        modelInputContractFingerprint: string;
        modelReleaseRevision: string;
        nodeId: string;
      };
      submittedKey = body.idempotencyKey;
      serverTask = {
        ...task(body.kind, body.nodeId, "task-created-before-response-loss"),
        ...identity,
      };
      throw new TypeError("simulated lost POST response");
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };

  const input = {
    canvasId: "canvas-idempotency-test",
    canvasRevision: 7,
    inputSchemaVersion: 1 as const,
    inputs: [],
    model: "text-model-idempotency-test",
    nodeId: "text-idempotency-target",
    ownPrompt: "safe prompt",
    parameters: { thinking: "disabled" },
    prompt: "safe prompt",
  };
  const identity = {
    generationInputKey: "input:text-idempotency-target:v1",
    generationOwnershipKey: "ownership:text-idempotency-target:v1",
    modelInputContractFingerprint: "contract:text-idempotency-target:v1",
    modelConfigurationRevision: "config:text-idempotency-target:v1",
    modelReleaseRevision: "revision:text-idempotency-target:v1",
  };

  try {
    const first = await ensureGenerationTask(
      "text",
      input,
      "",
      undefined,
      identity,
    );
    expect(first).toMatchObject({
      generationOwnershipKey: identity.generationOwnershipKey,
      recovered: true,
      task: {
        generationOwnershipKey: identity.generationOwnershipKey,
        id: "task-created-before-response-loss",
      },
    });
    const second = await ensureGenerationTask("text", {
      ...input,
      // Autosave revisions are deliberately not part of the semantic key.
      canvasRevision: 8,
    }, "", undefined, identity);
    expect(second.task.id).toBe(first.task.id);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(submissionPosts).toBe(1);
    expect(preflights).toBe(1);
    expect(providerRequests).toBe(0);
    expect(await recoverPendingGenerationTask(
      "text",
      input.canvasId,
      input.nodeId,
      undefined,
      undefined,
      "",
      identity,
    )).toMatchObject({
      generationOwnershipKey: identity.generationOwnershipKey,
      id: first.task.id,
    });
    expect(await recoverPendingGenerationTask(
      "text",
      input.canvasId,
      input.nodeId,
      undefined,
      {
        ...input,
        // Catalog-derived submission defaults may drift; the caller compares
        // the persisted catalog-independent ownership key instead.
        parameters: { thinking: "catalog-default-drift" },
      },
      "",
      identity,
    )).toMatchObject({
      generationOwnershipKey: identity.generationOwnershipKey,
      id: first.task.id,
    });
  } finally {
    clearGenerationSubmissionIntent("text", input.canvasId, input.nodeId, undefined, "", "");
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("initial submission reconciles one committed task after its response returns 500", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage() },
  });
  let serverTask: GenerationTaskSummary | undefined;
  let submittedKey = "";
  let exactReads = 0;
  let preflights = 0;
  let submissionPosts = 0;
  let providerRequests = 0;
  const order: string[] = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (/volces|openrouter|mureka/i.test(parsed.href)) providerRequests += 1;
    if (parsed.pathname.endsWith("/by-idempotency")) {
      exactReads += 1;
      order.push("exact-get");
      const key = parsed.searchParams.get("idempotencyKey") ?? "";
      return serverTask && key === submittedKey
        ? Response.json(serverTask)
        : Response.json({ error: "not found" }, { status: 404 });
    }
    if (parsed.pathname.endsWith("/preflight")) {
      preflights += 1;
      order.push("preflight");
      return Response.json({ canEnqueue: true, canSubmit: true, problems: [] });
    }
    if (parsed.pathname === "/api/generation-tasks" && init?.method === "POST") {
      submissionPosts += 1;
      order.push("submission-post");
      const body = JSON.parse(String(init.body)) as {
        generationInputKey: string;
        generationOwnershipKey: string;
        idempotencyKey: string;
        kind: GenerationTaskKind;
        modelInputContractFingerprint: string;
        modelReleaseRevision: string;
        nodeId: string;
      };
      submittedKey = body.idempotencyKey;
      serverTask = {
        ...task(
          body.kind,
          body.nodeId,
          "initial-task-committed-before-500",
          "queued",
        ),
        ...identity,
      };
      return Response.json({
        code: "GENERATION_TASK_ACCEPTED_RESPONSE_FAILED",
        error: "accepted task summary failed",
      }, { status: 500 });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };
  const input = {
    canvasId: "canvas-idempotency-test",
    canvasRevision: 11,
    inputSchemaVersion: 1 as const,
    inputs: [],
    model: "text-model-initial-500",
    nodeId: "text-initial-500-target",
    ownPrompt: "recover committed initial task",
    parameters: { thinking: "disabled" },
    prompt: "recover committed initial task",
  };
  const identity = {
    generationInputKey: "input:text-initial-500:v1",
    generationOwnershipKey: "ownership:text-initial-500:v1",
    modelInputContractFingerprint: "contract:text-initial-500:v1",
    modelConfigurationRevision: "config:text-initial-500:v1",
    modelReleaseRevision: "revision:text-initial-500:v1",
  };

  try {
    const recovered = await ensureGenerationTask(
      "text",
      input,
      "",
      undefined,
      identity,
    );
    expect(recovered).toMatchObject({
      idempotencyKey: submittedKey,
      recovered: true,
      task: {
        generationOwnershipKey: identity.generationOwnershipKey,
        id: "initial-task-committed-before-500",
        state: "queued",
      },
    });
    const same = await ensureGenerationTask(
      "text",
      input,
      "",
      undefined,
      identity,
    );
    expect(same.idempotencyKey).toBe(submittedKey);
    expect(same.task.id).toBe(recovered.task.id);
    expect(submissionPosts).toBe(1);
    expect(preflights).toBe(1);
    expect(exactReads).toBe(3);
    expect(order).toEqual([
      "exact-get",
      "preflight",
      "submission-post",
      "exact-get",
      "exact-get",
    ]);
    expect(providerRequests).toBe(0);
  } finally {
    clearGenerationSubmissionIntent("text", input.canvasId, input.nodeId, undefined, "", "");
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("the same ownership key reuses one idempotency intent across catalog-derived signature drift", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage() },
  });
  const tasksByKey = new Map<string, GenerationTaskSummary>();
  const postedKeys: string[] = [];
  let preflights = 0;
  let providerRequests = 0;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (/volces|openrouter|mureka/i.test(parsed.href)) providerRequests += 1;
    if (parsed.pathname.endsWith("/by-idempotency")) {
      const found = tasksByKey.get(parsed.searchParams.get("idempotencyKey") ?? "");
      return found
        ? Response.json(found)
        : Response.json({ error: "not found" }, { status: 404 });
    }
    if (parsed.pathname.endsWith("/preflight")) {
      preflights += 1;
      return Response.json({ canEnqueue: true, canSubmit: true, problems: [] });
    }
    if (parsed.pathname === "/api/generation-tasks" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        generationOwnershipKey?: string;
        idempotencyKey: string;
        kind: GenerationTaskKind;
        nodeId: string;
      };
      postedKeys.push(body.idempotencyKey);
      const created = {
        ...task(body.kind, body.nodeId, "task-ownership-catalog-drift"),
        generationOwnershipKey: body.generationOwnershipKey,
      };
      tasksByKey.set(body.idempotencyKey, created);
      return Response.json(created, { status: 202 });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };
  const input = {
    canvasId: "canvas-idempotency-test",
    canvasRevision: 21,
    inputSchemaVersion: 1 as const,
    inputs: [],
    model: "image-model-ownership-drift",
    nodeId: "image-ownership-drift-target",
    ownPrompt: "same raw ownership",
    parameters: { catalogDefault: "old" },
    prompt: "same raw ownership",
  };
  const generationOwnershipKey = "ownership:image-drift:v1";

  try {
    const first = await ensureGenerationTask(
      "image",
      input,
      "",
      undefined,
      { generationOwnershipKey },
    );
    const drifted = await ensureGenerationTask(
      "image",
      {
        ...input,
        parameters: { catalogDefault: "new" },
      },
      "",
      undefined,
      { generationOwnershipKey },
    );
    expect(drifted).toMatchObject({
      generationOwnershipKey,
      idempotencyKey: first.idempotencyKey,
      recovered: true,
      task: {
        generationOwnershipKey,
        id: first.task.id,
      },
    });
    expect(postedKeys).toEqual([first.idempotencyKey]);
    expect(preflights).toBe(1);
    expect(providerRequests).toBe(0);
  } finally {
    clearGenerationSubmissionIntent("image", input.canvasId, input.nodeId, undefined, "", "");
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("legacy intents without complete durable identity remain fail-closed", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage() },
  });
  const tasksByKey = new Map<string, GenerationTaskSummary>();
  const postedByNode = new Map<string, string[]>();
  let providerRequests = 0;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (/volces|openrouter|mureka/i.test(parsed.href)) providerRequests += 1;
    if (parsed.pathname.endsWith("/by-idempotency")) {
      const found = tasksByKey.get(parsed.searchParams.get("idempotencyKey") ?? "");
      return found
        ? Response.json(found)
        : Response.json({ error: "not found" }, { status: 404 });
    }
    if (parsed.pathname.endsWith("/preflight")) {
      return Response.json({ canEnqueue: true, canSubmit: true, problems: [] });
    }
    if (parsed.pathname === "/api/generation-tasks" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        idempotencyKey: string;
        kind: GenerationTaskKind;
        nodeId: string;
      };
      const keys = postedByNode.get(body.nodeId) ?? [];
      keys.push(body.idempotencyKey);
      postedByNode.set(body.nodeId, keys);
      const created = task(
        body.kind,
        body.nodeId,
        `task-legacy-ownership-${body.nodeId}-${keys.length}`,
      );
      tasksByKey.set(body.idempotencyKey, created);
      return Response.json(created, { status: 202 });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };
  const base = {
    canvasId: "canvas-idempotency-test",
    canvasRevision: 22,
    inputSchemaVersion: 1 as const,
    inputs: [],
    model: "text-model-legacy-ownership",
    ownPrompt: "legacy ownership",
    parameters: { thinking: "disabled" },
    prompt: "legacy ownership",
  };
  const exactInput = { ...base, nodeId: "text-legacy-exact-target" };
  const mismatchInput = { ...base, nodeId: "text-legacy-mismatch-target" };

  try {
    const legacyExact = await ensureGenerationTask("text", exactInput);
    const upgraded = await recoverPendingGenerationTask(
      "text",
      exactInput.canvasId,
      exactInput.nodeId,
      undefined,
      exactInput,
      "",
      { generationOwnershipKey: "ownership:legacy-exact:v1" },
    );
    expect(upgraded).toBeUndefined();
    expect(postedByNode.get(exactInput.nodeId)).toEqual([
      legacyExact.idempotencyKey,
    ]);
    await expect(recoverPendingGenerationTask(
      "text",
      exactInput.canvasId,
      exactInput.nodeId,
      undefined,
      undefined,
      "",
      { generationOwnershipKey: "ownership:legacy-exact:v1" },
    )).resolves.toBeUndefined();

    const legacyMismatch = await ensureGenerationTask("text", mismatchInput);
    await expect(recoverPendingGenerationTask(
      "text",
      mismatchInput.canvasId,
      mismatchInput.nodeId,
      undefined,
      {
        ...mismatchInput,
        parameters: { thinking: "catalog-signature-drift" },
      },
      "",
      { generationOwnershipKey: "ownership:legacy-mismatch:v1" },
    )).resolves.toBeUndefined();
    expect(postedByNode.get(mismatchInput.nodeId)).toEqual([
      legacyMismatch.idempotencyKey,
    ]);
    await expect(recoverPendingGenerationTask(
      "text",
      mismatchInput.canvasId,
      mismatchInput.nodeId,
      undefined,
      mismatchInput,
      "",
      { generationOwnershipKey: "ownership:legacy-mismatch:v1" },
    )).resolves.toBeUndefined();
    expect(providerRequests).toBe(0);
  } finally {
    clearGenerationSubmissionIntent("text", exactInput.canvasId, exactInput.nodeId, undefined, "", "");
    clearGenerationSubmissionIntent(
      "text",
      mismatchInput.canvasId,
      mismatchInput.nodeId,
      undefined,
      "",
      "",
    );
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("intent-free recovery adopts exactly one full task identity and never a node-only candidate", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage() },
  });
  const identity = {
    generationInputKey: "strict-input",
    generationOwnershipKey: "strict-owner",
    modelInputContractFingerprint: "strict-contract",
    modelConfigurationRevision: "strict-config",
    modelReleaseRevision: "strict-revision",
  };
  let reads = 0;
  const exact = {
    ...task("video", "strict-node", "strict-task"),
    ...identity,
  };
  let candidates: GenerationTaskSummary[] = [
    {
      ...task("video", "strict-node", "wrong-task"),
      ...identity,
      modelInputContractFingerprint: "wrong-contract",
    },
    exact,
  ];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (parsed.pathname === "/api/generation-tasks") {
      reads += 1;
      return Response.json({ tasks: candidates });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };
  try {
    await expect(recoverPendingGenerationTask(
      "video",
      "canvas-idempotency-test",
      "strict-node",
      undefined,
      undefined,
      "",
      identity,
    )).resolves.toMatchObject({ id: "strict-task" });
    candidates = [exact, { ...exact, id: "strict-task-duplicate" }];
    await expect(recoverPendingGenerationTask(
      "video",
      "canvas-idempotency-test",
      "strict-node",
      undefined,
      undefined,
      "",
      identity,
    )).resolves.toBeUndefined();
    await expect(recoverPendingGenerationTask(
      "video",
      "canvas-idempotency-test",
      "strict-node",
      undefined,
      undefined,
      "",
      { generationOwnershipKey: identity.generationOwnershipKey },
    )).resolves.toBeUndefined();
    expect(reads).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("a deterministic 409 never adopts an old idempotency task and the next click mints a new key", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage() },
  });
  const lookupCounts = new Map<string, number>();
  const postedKeys: string[] = [];
  let conflictReturned = false;
  let providerRequests = 0;
  const input = {
    canvasId: "canvas-idempotency-test",
    canvasRevision: 9,
    inputSchemaVersion: 1 as const,
    inputs: [],
    model: "text-model-idempotency-conflict",
    nodeId: "text-idempotency-conflict-target",
    ownPrompt: "deterministic conflict",
    parameters: { thinking: "disabled" },
    prompt: "deterministic conflict",
  };
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (/volces|openrouter|mureka/i.test(parsed.href)) providerRequests += 1;
    if (parsed.pathname.endsWith("/by-idempotency")) {
      const key = parsed.searchParams.get("idempotencyKey") ?? "";
      lookupCounts.set(key, (lookupCounts.get(key) ?? 0) + 1);
      if (conflictReturned && key === postedKeys[0]) {
        return Response.json(task(
          "text",
          input.nodeId,
          "old-task-behind-deterministic-409",
        ));
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }
    if (parsed.pathname.endsWith("/preflight")) {
      return Response.json({ canEnqueue: true, canSubmit: true, problems: [] });
    }
    if (parsed.pathname === "/api/generation-tasks" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        idempotencyKey: string;
        kind: GenerationTaskKind;
        nodeId: string;
      };
      postedKeys.push(body.idempotencyKey);
      if (postedKeys.length === 1) {
        conflictReturned = true;
        return Response.json({
          code: "IDEMPOTENCY_CONFLICT",
          error: "key belongs to an incompatible request",
        }, { status: 409 });
      }
      return Response.json(
        task(body.kind, body.nodeId, "new-task-after-deterministic-409"),
        { status: 202 },
      );
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };

  try {
    await expect(ensureGenerationTask("text", input)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    });
    expect(postedKeys).toHaveLength(1);
    expect(lookupCounts.get(postedKeys[0])).toBe(1);

    await expect(ensureGenerationTask("text", input)).resolves.toMatchObject({
      recovered: false,
      task: { id: "new-task-after-deterministic-409" },
    });
    expect(postedKeys).toHaveLength(2);
    expect(postedKeys[1]).not.toBe(postedKeys[0]);
    expect(providerRequests).toBe(0);
  } finally {
    clearGenerationSubmissionIntent("text", input.canvasId, input.nodeId, undefined, "", "");
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("durable failed work keeps one key across semantic drift until terminal cleanup", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage() },
  });
  const tasksByKey = new Map<string, GenerationTaskSummary>();
  const postedKeys: string[] = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (parsed.pathname.endsWith("/by-idempotency")) {
      const found = tasksByKey.get(parsed.searchParams.get("idempotencyKey") ?? "");
      return found
        ? Response.json(found)
        : Response.json({ error: "not found" }, { status: 404 });
    }
    if (parsed.pathname.endsWith("/preflight")) {
      return Response.json({ canEnqueue: true, canSubmit: true, problems: [] });
    }
    const body = JSON.parse(String(init?.body)) as {
      generationOwnershipKey?: string;
      idempotencyKey: string;
      kind: GenerationTaskKind;
      nodeId: string;
    };
    postedKeys.push(body.idempotencyKey);
    const created = {
      ...task(body.kind, body.nodeId, `task-${postedKeys.length}`, "failed"),
      generationOwnershipKey: body.generationOwnershipKey,
    };
    tasksByKey.set(body.idempotencyKey, created);
    return Response.json(created, { status: 202 });
  };
  const base = {
    canvasId: "canvas-idempotency-test",
    canvasRevision: 10,
    nodeId: "image-idempotency-target",
    parameters: { quality: "high" },
    prompt: "first prompt",
  };
  const baseOwnershipKey = "ownership:image:first:v1";
  const changedOwnershipKey = "ownership:image:changed:v1";

  try {
    const failed = await ensureGenerationTask(
      "image",
      base,
      "",
      undefined,
      { generationOwnershipKey: baseOwnershipKey },
    );
    expect((await ensureGenerationTask(
      "image",
      base,
      "",
      undefined,
      { generationOwnershipKey: baseOwnershipKey },
    )).task.id).toBe(failed.task.id);
    expect(postedKeys).toHaveLength(1);
    expect(await recoverPendingGenerationTask(
      "image",
      base.canvasId,
      base.nodeId,
      undefined,
      base,
      "",
      { generationOwnershipKey: baseOwnershipKey },
    )).toBeUndefined();
    expect(await recoverPendingGenerationTask(
      "image",
      base.canvasId,
      base.nodeId,
      undefined,
      { ...base, prompt: "changed prompt" },
      "",
      { generationOwnershipKey: changedOwnershipKey },
    )).toBeUndefined();

    const changed = await ensureGenerationTask(
      "image",
      { ...base, prompt: "changed prompt" },
      "",
      undefined,
      { generationOwnershipKey: changedOwnershipKey },
    );
    expect(changed.idempotencyKey).toBe(failed.idempotencyKey);
    expect(changed.task.id).toBe(failed.task.id);
    expect(postedKeys).toHaveLength(1);

    const changedInput = { ...base, prompt: "changed prompt" };
    for (const [index, mutation] of [
      { ...changedInput, model: "another-image-model" },
      { ...changedInput, parameters: { quality: "low" } },
      {
        ...changedInput,
        inputs: [{
          assetId: "asset-new-reference",
          kind: "image" as const,
          order: 1,
          role: "reference-image" as const,
          sourceNodeId: "new-reference-node",
        }],
      },
    ].entries()) {
      expect(await recoverPendingGenerationTask(
        "image",
        base.canvasId,
        base.nodeId,
        undefined,
        mutation,
        "",
        { generationOwnershipKey: `ownership:image:mutation:${index}` },
      )).toBeUndefined();
      await ensureGenerationTask(
        "image",
        changedInput,
        "",
        undefined,
        { generationOwnershipKey: changedOwnershipKey },
      );
    }
    expect(postedKeys).toHaveLength(1);

    clearGenerationSubmissionIntent("image", base.canvasId, base.nodeId, undefined, "", "");
    const afterTerminalCleanup = await ensureGenerationTask(
      "image",
      { ...base, prompt: "changed prompt" },
      "",
      undefined,
      { generationOwnershipKey: changedOwnershipKey },
    );
    expect(afterTerminalCleanup.idempotencyKey).not.toBe(changed.idempotencyKey);
    expect(postedKeys).toHaveLength(2);
  } finally {
    clearGenerationSubmissionIntent("image", base.canvasId, base.nodeId, undefined, "", "");
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

for (const hungAt of ["fetch", "body"] as const) {
  test(`shared generation submission reconciles after a permanently hung POST ${hungAt}`, async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = (globalThis as typeof globalThis & { window?: Window })
      .window;
    const restoreDeadline = accelerateMutationDeadline();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: memoryStorage() },
    });
    let serverTask: GenerationTaskSummary | undefined;
    let submittedKey = "";
    let submissionPosts = 0;
    let providerRequests = 0;
    const identity = {
      fixtureScopeId: "fixture-a",
      generationInputKey: `input-hung-${hungAt}`,
      generationOwnershipKey: `owner-hung-${hungAt}`,
      modelInputContractFingerprint: `contract-hung-${hungAt}`,
      modelConfigurationRevision: `config-hung-${hungAt}`,
      modelReleaseRevision: `revision-hung-${hungAt}`,
    };
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(String(url), "http://127.0.0.1");
      if (/volces|openrouter|mureka/i.test(parsed.href)) providerRequests += 1;
      if (parsed.pathname.endsWith("/by-idempotency")) {
        const key = parsed.searchParams.get("idempotencyKey") ?? "";
        expect(parsed.searchParams.get("fixtureScopeId")).toBe("fixture-a");
        return serverTask && key === submittedKey
          ? Response.json(serverTask)
          : Response.json({ error: "not found" }, { status: 404 });
      }
      if (parsed.pathname.endsWith("/preflight")) {
        return Response.json({ canEnqueue: true, canSubmit: true, problems: [] });
      }
      if (parsed.pathname === "/api/generation-tasks" && init?.method === "POST") {
        submissionPosts += 1;
        const body = JSON.parse(String(init.body)) as {
          idempotencyKey: string;
          kind: GenerationTaskKind;
          nodeId: string;
        };
        submittedKey = body.idempotencyKey;
        serverTask = {
          ...task(body.kind, body.nodeId, `task-hung-${hungAt}`),
          ...identity,
          fixtureScopeId: hungAt === "body" ? "fixture-b" : "fixture-a",
        };
        if (hungAt === "fetch") {
          return await new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(new DOMException("Aborted", "AbortError"));
            if (init.signal?.aborted) abort();
            else init.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        const response = Response.json(serverTask, { status: 202 });
        Object.defineProperty(response, "json", {
          configurable: true,
          value: () => new Promise<never>(() => undefined),
        });
        return response;
      }
      throw new Error(`Unexpected request: ${parsed.pathname}`);
    };
    const input = {
      canvasId: "canvas-idempotency-test",
      canvasRevision: 12,
      inputSchemaVersion: 1 as const,
      inputs: [],
      model: "audio-model-hung-response",
      nodeId: `audio-hung-${hungAt}`,
      ownPrompt: "safe prompt",
      parameters: { outputCount: 1 },
      prompt: "safe prompt",
    };

    try {
      const submission = ensureGenerationTask(
        "audio",
        input,
        "",
        undefined,
        identity,
      );
      if (hungAt === "fetch") {
        await expect(submission).resolves.toMatchObject({
          recovered: true,
          task: { id: `task-hung-${hungAt}` },
        });
      } else {
        await expect(submission).rejects.toMatchObject({
          code: "GENERATION_RESPONSE_TIMEOUT",
        });
      }
      expect(submissionPosts).toBe(1);
      expect(providerRequests).toBe(0);
    } finally {
      clearGenerationSubmissionIntent(
        "audio",
        input.canvasId,
        input.nodeId,
        undefined,
        "",
        identity.fixtureScopeId,
      );
      globalThis.fetch = originalFetch;
      restoreDeadline();
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
}

test("retry reconciles one accepted task after its POST response is lost", async () => {
  const originalFetch = globalThis.fetch;
  const failed = {
    ...task("text", "retry-lost-node", "retry-lost-task", "failed"),
    generationInputKey: "retry-lost-input-key",
    generationOwnershipKey: "retry-lost-ownership-key",
    modelInputContractFingerprint: "mic2:retry-lost",
    modelConfigurationRevision: "config-revision-retry-lost",
    modelReleaseRevision: "00000000-0000-4000-8000-000000000401",
    retryAllowed: true,
  } satisfies GenerationTaskSummary;
  let current: GenerationTaskSummary = failed;
  let retryPosts = 0;
  let exactReads = 0;
  let retryBody: Record<string, unknown> | undefined;
  let providerRequests = 0;
  const order: string[] = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (/volces|openrouter|mureka/i.test(parsed.href)) providerRequests += 1;
    if (
      parsed.pathname === "/api/generation-tasks/retry-lost-task" &&
      (init?.method ?? "GET") === "GET"
    ) {
      exactReads += 1;
      order.push("exact-get");
      return Response.json(current);
    }
    if (
      parsed.pathname === "/api/generation-tasks/retry-lost-task/retry" &&
      init?.method === "POST"
    ) {
      retryPosts += 1;
      order.push("retry-post");
      retryBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      current = {
        ...failed,
        state: "queued",
        updatedAt: "2026-08-03T06:00:02.000Z",
      };
      throw new TypeError("accepted retry response was lost");
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };

  try {
    for (const identityDrift of [
      { generationInputKey: "other-input" },
      { generationOwnershipKey: "other-ownership" },
      { modelInputContractFingerprint: "mic2:other-contract" },
      { modelConfigurationRevision: "other-config-revision" },
      { modelReleaseRevision: "00000000-0000-4000-8000-000000000499" },
    ]) {
      await expect(retryGenerationTask({
        accountId: "",
        canvasId: failed.canvasId,
        fixtureScopeId: "",
        generationInputKey: failed.generationInputKey,
        generationOwnershipKey: failed.generationOwnershipKey,
        kind: failed.kind,
        modelInputContractFingerprint: failed.modelInputContractFingerprint,
        modelConfigurationRevision: failed.modelConfigurationRevision!,
        modelReleaseRevision: failed.modelReleaseRevision,
        nodeId: failed.nodeId,
        taskId: failed.id,
        ...identityDrift,
      }, async () => 16)).rejects.toMatchObject({
        code: "RETRY_BINDING_STALE",
        status: 409,
      });
    }
    expect(retryPosts).toBe(0);
    expect(exactReads).toBe(5);
    exactReads = 0;
    order.length = 0;
    await expect(retryGenerationTask({
      accountId: "",
      canvasId: failed.canvasId,
      fixtureScopeId: "",
      generationInputKey: failed.generationInputKey,
      generationOwnershipKey: failed.generationOwnershipKey,
      kind: failed.kind,
      modelInputContractFingerprint: failed.modelInputContractFingerprint,
      modelConfigurationRevision: failed.modelConfigurationRevision!,
      modelReleaseRevision: failed.modelReleaseRevision,
      nodeId: failed.nodeId,
      taskId: failed.id,
    }, async () => {
      order.push("save-gate");
      return 17;
    })).resolves.toMatchObject({
      id: failed.id,
      state: "queued",
    });
    expect(retryPosts).toBe(1);
    expect(exactReads).toBe(2);
    expect(order).toEqual([
      "save-gate",
      "exact-get",
      "retry-post",
      "exact-get",
    ]);
    expect(retryBody).toEqual({
      canvasId: failed.canvasId,
      expectedAttempt: failed.attempt,
      expectedCanvasRevision: 17,
      expectedFixtureScopeId: "",
      expectedGenerationInputKey: failed.generationInputKey,
      expectedGenerationOwnershipKey: failed.generationOwnershipKey,
      expectedModelConfigurationRevision: failed.modelConfigurationRevision,
      expectedModelInputContractFingerprint:
        failed.modelInputContractFingerprint,
      expectedModelReleaseRevision: failed.modelReleaseRevision,
      expectedUpdatedAt: failed.updatedAt,
      kind: failed.kind,
      nodeId: failed.nodeId,
    });
    expect(providerRequests).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retry reconciles the exact queued task after a committed retry returns 500", async () => {
  const originalFetch = globalThis.fetch;
  const failed = {
    ...task("image", "retry-500-node", "retry-500-task", "failed"),
    generationInputKey: "retry-500-input-key",
    generationOwnershipKey: "retry-500-ownership-key",
    modelInputContractFingerprint: "mic2:retry-500",
    modelConfigurationRevision: "config-revision-retry-500",
    modelReleaseRevision: "00000000-0000-4000-8000-000000000402",
    retryAllowed: true,
  } satisfies GenerationTaskSummary;
  let current: GenerationTaskSummary = failed;
  let exactReads = 0;
  let retryPosts = 0;
  let providerRequests = 0;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    if (/volces|openrouter|mureka/i.test(parsed.href)) providerRequests += 1;
    if (
      parsed.pathname === "/api/generation-tasks/retry-500-task" &&
      (init?.method ?? "GET") === "GET"
    ) {
      exactReads += 1;
      return Response.json(current);
    }
    if (
      parsed.pathname === "/api/generation-tasks/retry-500-task/retry" &&
      init?.method === "POST"
    ) {
      retryPosts += 1;
      current = {
        ...failed,
        attempt: failed.attempt + 1,
        retryAllowed: false,
        state: "queued",
        updatedAt: "2026-08-03T06:00:03.000Z",
      };
      return Response.json({
        code: "GENERATION_RETRY_ACCEPTED_RESPONSE_FAILED",
        error: "retry committed but summary failed",
      }, { status: 500 });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };

  try {
    await expect(retryGenerationTask({
      accountId: "",
      canvasId: failed.canvasId,
      fixtureScopeId: "",
      generationInputKey: failed.generationInputKey,
      generationOwnershipKey: failed.generationOwnershipKey,
      kind: failed.kind,
      modelInputContractFingerprint: failed.modelInputContractFingerprint,
      modelConfigurationRevision: failed.modelConfigurationRevision!,
      modelReleaseRevision: failed.modelReleaseRevision,
      nodeId: failed.nodeId,
      taskId: failed.id,
    }, async () => 19)).resolves.toMatchObject({
      attempt: 2,
      id: failed.id,
      state: "queued",
    });
    expect(retryPosts).toBe(1);
    expect(exactReads).toBe(2);
    expect(providerRequests).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("server idempotency keys are owner scoped and payload conflicts stay local", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-idempotency-owner-"));
  try {
    const store = createGenerationTaskStore(directory);
    const request = {
      canvasId: "canvas-owner-scope",
      idempotencyKey: "owner-scope-key-001",
      kind: "text" as const,
      nodeId: "text-owner-scope",
      ownerId: "owner-alpha",
      prompt: "owner scoped",
    };
    const alpha = store.create(request);
    const alphaDuplicate = store.create(request);
    const beta = store.create({
      ...request,
      ownerId: "owner-beta",
    });

    expect(alpha.created).toBe(true);
    expect(alphaDuplicate.created).toBe(false);
    expect(alphaDuplicate.task.id).toBe(alpha.task.id);
    expect(beta.created).toBe(true);
    expect(beta.task.id).not.toBe(alpha.task.id);
    expect(store.getByIdempotencyForOwner(
      "canvas-owner-scope",
      "owner-scope-key-001",
      "owner-alpha",
    )?.id).toBe(alpha.task.id);
    expect(store.getByIdempotencyForOwner(
      "canvas-owner-scope",
      "owner-scope-key-001",
      "owner-beta",
    )?.id).toBe(beta.task.id);
    expect(() => store.create({
      ...request,
      prompt: "same owner cannot change the payload behind one key",
    })).toThrow(GenerationTaskConflictError);
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("Text Image Video and Audio all use the shared recoverable task port", async () => {
  const nodes = [
    ["TextNode.tsx", "text"],
    ["ImageNode.tsx", "image"],
    ["VideoNode.tsx", "video"],
    ["AudioNode.tsx", "audio"],
  ] as const;
  for (const [file] of nodes) {
    const source = await readFile(
      join(process.cwd(), "client/src/canvas", file),
      "utf8",
    );
    expect(source).toContain("createBrowserSingleNodeGenerationTaskPort");
    expect(source).toContain("taskMatchesSingleNodeGenerationIdentity");
    expect(source).not.toMatch(/idempotencyKey:\s*crypto\.randomUUID\(\)/);
  }
  const taskPort = await readFile(
    join(
      process.cwd(),
      "client/src/generation/browserSingleNodeGenerationTaskPort.ts",
    ),
    "utf8",
  );
  expect(taskPort).toMatch(/ensureGenerationTask\(\s*plan\.kind\s*,/);
  expect(taskPort).toContain("generationOwnershipKey: plan.ownershipKey");
  expect(taskPort.indexOf("const existing = await getGenerationTask("))
    .toBeLessThan(taskPort.indexOf("const cancelled = await cancelGenerationTask("));
  const server = await readFile(
    join(process.cwd(), "server/generationTasks.ts"),
    "utf8",
  );
  expect(server).toContain("imageTool: body.imageTool");
  expect(server).toContain(
    "workflowBinding: body.workflowBinding",
  );
});
