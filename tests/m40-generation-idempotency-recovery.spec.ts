import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import {
  clearGenerationSubmissionIntent,
  ensureGenerationTask,
  recoverPendingGenerationTask,
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
    setItem: (key: string, value: string) => values.set(key, value),
  } satisfies Storage;
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
        idempotencyKey: string;
        kind: GenerationTaskKind;
        nodeId: string;
      };
      submittedKey = body.idempotencyKey;
      serverTask = task(body.kind, body.nodeId, "task-created-before-response-loss");
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

  try {
    const first = await ensureGenerationTask("text", input);
    expect(first).toMatchObject({
      recovered: true,
      task: { id: "task-created-before-response-loss" },
    });
    const second = await ensureGenerationTask("text", {
      ...input,
      // Autosave revisions are deliberately not part of the semantic key.
      canvasRevision: 8,
    });
    expect(second.task.id).toBe(first.task.id);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(submissionPosts).toBe(1);
    expect(preflights).toBe(1);
    expect(providerRequests).toBe(0);
    expect(await recoverPendingGenerationTask(
      "text",
      input.canvasId,
      input.nodeId,
    )).toMatchObject({ id: first.task.id });
  } finally {
    clearGenerationSubmissionIntent("text", input.canvasId, input.nodeId);
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

test("terminal cleanup and semantic input changes issue a fresh key while failed work stays recoverable", async () => {
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
      idempotencyKey: string;
      kind: GenerationTaskKind;
      nodeId: string;
    };
    postedKeys.push(body.idempotencyKey);
    const created = task(body.kind, body.nodeId, `task-${postedKeys.length}`, "failed");
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

  try {
    const failed = await ensureGenerationTask("image", base);
    expect((await ensureGenerationTask("image", base)).task.id).toBe(failed.task.id);
    expect(postedKeys).toHaveLength(1);
    expect(await recoverPendingGenerationTask(
      "image",
      base.canvasId,
      base.nodeId,
      undefined,
      base,
    )).toMatchObject({ id: failed.task.id });
    expect(await recoverPendingGenerationTask(
      "image",
      base.canvasId,
      base.nodeId,
      undefined,
      { ...base, prompt: "changed prompt" },
    )).toBeUndefined();

    const changed = await ensureGenerationTask("image", {
      ...base,
      prompt: "changed prompt",
    });
    expect(changed.idempotencyKey).not.toBe(failed.idempotencyKey);
    expect(postedKeys).toHaveLength(2);

    const changedInput = { ...base, prompt: "changed prompt" };
    for (const mutation of [
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
    ]) {
      expect(await recoverPendingGenerationTask(
        "image",
        base.canvasId,
        base.nodeId,
        undefined,
        mutation,
      )).toBeUndefined();
      await ensureGenerationTask("image", changedInput);
    }
    expect(postedKeys).toHaveLength(5);

    clearGenerationSubmissionIntent("image", base.canvasId, base.nodeId);
    const afterTerminalCleanup = await ensureGenerationTask("image", {
      ...base,
      prompt: "changed prompt",
    });
    expect(afterTerminalCleanup.idempotencyKey).not.toBe(changed.idempotencyKey);
    expect(postedKeys).toHaveLength(6);
  } finally {
    clearGenerationSubmissionIntent("image", base.canvasId, base.nodeId);
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

test("Text Image Video and Audio all use the shared recoverable submit path", async () => {
  const nodes = [
    ["TextNode.tsx", "text"],
    ["ImageNode.tsx", "image"],
    ["VideoNode.tsx", "video"],
    ["AudioNode.tsx", "audio"],
  ] as const;
  for (const [file, kind] of nodes) {
    const source = await readFile(
      join(process.cwd(), "client/src/canvas", file),
      "utf8",
    );
    expect(source).toMatch(
      new RegExp(`ensureGenerationTask\\(\\s*"${kind}",\\s*[a-zA-Z][a-zA-Z0-9]*`),
    );
    expect(source).not.toMatch(/idempotencyKey:\s*crypto\.randomUUID\(\)/);
  }
});
